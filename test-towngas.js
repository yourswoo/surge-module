#!/usr/bin/env node
/*
 * towngas.js v1.5.0 模拟 Surge 环境测试
 * 覆盖：支付宝端签发（clientid+orgCode）→ 接力请求携带 orgCode；
 *       微信端 union(redirectUri) 预记 clientid → accessToekn 签发 → 接力不带 orgCode；
 *       并发锁、旧版数据回退、「户号不存在」提示。
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const CODE = fs.readFileSync(__dirname + '/towngas.js', 'utf8');

function makeEnv() {
  const store = {};
  return {
    store,
    notes: [],
    httpCalls: [],
    http(opts, cb) {
      this.httpCalls.push(opts.url);
      cb(null, { headers: {}, status: 200 }, this.nextBody || '{}');
    },
    nextBody: '{}',
    persistentStore: {
      read: k => (k in store ? store[k] : null),
      write: (v, k) => { store[k] = String(v); return true; },
    },
  };
}

async function run(env, overrides) {
  const sandbox = {
    console: { log: () => {} },
    $persistentStore: env.persistentStore,
    $notification: { post: (t, s, b) => env.notes.push([t, s, b]) },
    $httpClient: { post: (o, cb) => env.http(o, cb), get: (o, cb) => env.http(o, cb) },
    $done: () => {},
    Date, JSON, Math, RegExp, String, Number, Array, Object, Promise, Error, TypeError,
    parseFloat, isFinite, unescape, encodeURIComponent, decodeURIComponent,
  };
  if (overrides.$request) sandbox.$request = overrides.$request;
  if (overrides.$response) sandbox.$response = overrides.$response;
  if (overrides.$argument !== undefined) sandbox.$argument = overrides.$argument;
  vm.createContext(sandbox);
  vm.runInContext(CODE, sandbox, { timeout: 5000 });
  // main() 是 async IIFE；等一个微任务队列排空即可（所有路径都会同步走到网络回调）
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));
  return sandbox;
}

const OAUTH = 'https://weixin.towngasvcc.com/vcc-oauth/oauth/authorize2';

(async () => {
  // ---------- A. 支付宝端 union 签发 ----------
  let env = makeEnv();
  await run(env, {
    $argument: 'mode=capture-oauth',
    $request: { url: OAUTH + '/union?authCode=abc&clientid=ghaliminipg&orgCode=11118_LSJJ0105&sign=X&timestamp=1', headers: {} },
    $response: { body: '{"access_token":"ACC1","refresh_token":"REF1","expires_in":7200}' },
  });
  assert.strictEqual(env.store.towngas_authorization, 'Bearer ACC1');
  assert.strictEqual(env.store.towngas_refresh_token, 'REF1');
  assert.deepStrictEqual(JSON.parse(env.store.towngas_oauth_ctx), { clientid: 'ghaliminipg', orgCode: '11118_LSJJ0105' });
  assert.strictEqual(env.store.towngas_oauth_client, 'ghaliminipg');
  assert.strictEqual(env.store.towngas_oauth_org_code, '11118_LSJJ0105');
  console.log('A 支付宝签发: ctx/落盘 OK');

  // ---------- B. 接力（支付宝）必须带 orgCode ----------
  env.store.towngas_chain_refresh_at = String(Date.now() - 90 * 60 * 1000); // 门控已到期
  env.nextBody = '{"access_token":"ACC2","refresh_token":"REF2"}';
  await run(env, { $argument: 'mode=token-refresh' });
  const refUrl = env.httpCalls[0];
  assert.ok(refUrl.includes('refreshToken=REF1'), '应携带最新 refresh_token');
  assert.ok(refUrl.includes('clientid=ghaliminipg'), '应携带 clientid');
  assert.ok(refUrl.includes('orgCode=11118_LSJJ0105'), '【核心】支付宝接力必须携带 orgCode');
  assert.strictEqual(env.store.towngas_authorization, 'Bearer ACC2');
  assert.strictEqual(env.store.towngas_refresh_token, 'REF2');
  console.log('B 支付宝接力: orgCode 已携带, token 滚动 OK ->', refUrl.slice(refUrl.indexOf('/refreshToken')));

  // ---------- C. 并发锁：120 秒内的重复接力直接跳过 ----------
  env.httpCalls.length = 0;
  env.store.towngas_chain_refresh_at = String(Date.now() - 90 * 60 * 1000); // 门控仍到期
  await run(env, { $argument: 'mode=token-refresh' });
  assert.strictEqual(env.httpCalls.length, 0, '锁生效期内不应发出网络请求');
  console.log('C 并发锁: 120 秒内跳过 OK');

  // ---------- D. 微信端：union(redirectUri) 预记 clientid，accessToekn 签发 ----------
  env.store.towngas_chain_lock_at = String(Date.now() - 10 * 60 * 1000); // 解锁
  await run(env, {
    $argument: 'mode=capture-oauth',
    $request: { url: OAUTH + '/union?clientid=pe92a8wechat11118LSJJ0105&redirectUri=https%3A%2F%2Fweixin.towngasvcc.com%2Fh5-gas%2Fpages%2FtransitionPage%2Findex', headers: {} },
    $response: { body: '' },
  });
  assert.strictEqual(env.store.towngas_oauth_pending_client, 'pe92a8wechat11118LSJJ0105', 'union(redirectUri) 应预记 clientid');
  assert.strictEqual(env.store.towngas_refresh_token, 'REF2', '无 token 响不应改动 token');
  assert.deepStrictEqual(JSON.parse(env.store.towngas_oauth_ctx), { clientid: 'ghaliminipg', orgCode: '11118_LSJJ0105' }, '上下文应保持为支付宝（尚未签发）');
  console.log('D1 微信 union 预记: pending client OK, token 未受影响');

  await run(env, {
    $argument: 'mode=capture-oauth',
    $request: { url: OAUTH + '/accessToekn?authCode=Zfn&sign=Y&timestamp=2', headers: {} },
    $response: { body: '{"access_token":"ACC3","refresh_token":"REF3","expires_in":7200}' },
  });
  assert.deepStrictEqual(JSON.parse(env.store.towngas_oauth_ctx), { clientid: 'pe92a8wechat11118LSJJ0105', orgCode: '' }, '微信签发应整体替换上下文');
  assert.strictEqual(env.store.towngas_oauth_client, 'pe92a8wechat11118LSJJ0105');
  assert.strictEqual(env.store.towngas_authorization, 'Bearer ACC3');
  assert.strictEqual(env.store.towngas_refresh_token, 'REF3');
  console.log('D2 微信 accessToekn 签发: ctx 替换为微信 clientid OK');

  // ---------- E. 接力（微信）：clientid 内嵌城市，不应携带 orgCode ----------
  env.httpCalls.length = 0;
  env.store.towngas_chain_refresh_at = String(Date.now() - 90 * 60 * 1000);
  env.store.towngas_chain_lock_at = '0';
  env.nextBody = '{"access_token":"ACC4","refresh_token":"REF4"}';
  await run(env, { $argument: 'mode=token-refresh' });
  const wxUrl = env.httpCalls[0];
  assert.ok(wxUrl.includes('clientid=pe92a8wechat11118LSJJ0105'), '微信接力应携带预记的 clientid');
  assert.ok(!wxUrl.includes('orgCode'), '【核心】微信 clientid 已内嵌城市，不应携带残留 orgCode');
  console.log('E 微信接力: 无 orgCode OK ->', wxUrl.slice(wxUrl.indexOf('/refreshToken')));

  // ---------- F. 旧版数据回退：只有 oauth_client，无 ctx ----------
  env = makeEnv();
  Object.assign(env.store, {
    towngas_authorization: 'Bearer OLD',
    towngas_refresh_token: 'LEGACY',
    towngas_oauth_client: 'ghaliminipg',
    towngas_chain_refresh_at: String(Date.now() - 90 * 60 * 1000),
  });
  env.nextBody = '{"access_token":"N1","refresh_token":"N2"}';
  await run(env, { $argument: 'mode=token-refresh' });
  assert.ok(env.httpCalls[0].includes('clientid=ghaliminipg'), 'legacy 回退应仍携带 clientid');
  console.log('F 旧版回退: OK');

  // ---------- G. 「户号不存在」提示 ----------
  env = makeEnv();
  Object.assign(env.store, {
    towngas_authorization: 'Bearer X',
    towngas_refresh_token: 'R',
    towngas_subs_id: '8a8a82858a848f0f018ab570d17845d1',
    towngas_org_id: '2c90d88974c2dc8f0174ce4807b10074',
    towngas_token_issued_at: String(Date.now()),
  });
  env.nextBody = '{"resultCode":"90101","resultMsg":"户号不存在"}';
  let panelOut = null;
  const sb = {
    console: { log: () => {} },
    $persistentStore: env.persistentStore,
    $notification: { post: () => {} },
    $httpClient: { get: (o, cb) => cb(null, { headers: {}, status: 200 }, '{"resultCode":"90101","resultMsg":"户号不存在"}') },
    $done: v => { panelOut = v; },
    Date, JSON, Math, RegExp, String, Number, Array, Object, Promise, Error, TypeError,
    parseFloat, isFinite, unescape, encodeURIComponent, decodeURIComponent,
  };
  vm.createContext(sb);
  vm.runInContext(CODE, sb);
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));
  assert.ok(String(panelOut.content).includes('作用域异常'), '面板应给出作用域异常提示');
  assert.ok(String(panelOut.content).includes('户号不存在'));
  console.log('G 户号不存在提示: OK ->', JSON.stringify(panelOut.content));

  console.log('\n全部通过 ✅');
})().catch(e => { console.error('❌ 测试失败:', e.message); process.exit(1); });
