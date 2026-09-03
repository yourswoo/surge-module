/*
 * 港华燃气账户查询·Surge 抓取与面板
 * v1.4.1
 *
 * capture:        从港华主业务请求保存 Authorization、Cookie、UA、Referer、
 *                 subsId 和 orgId；保险接口使用另一套 Token，不参与抓取。
 * capture-oauth:  从 oauth authorize2（微信 accessToekn / 支付宝 union）响应
 *                 中提取最新 access_token + refresh_token，自动更新 Bearer 并
 *                 启动无限接力链。
 * panel:          读取 BoxJS 共享键，查询账户余额、表数、阶梯和最近账单。
 * refresh:        每隔指定分钟静默查询，并把响应中的新 Cookie 合并回 BoxJS。
 * token-refresh:  接力模式。用最新 refresh_token 换全新的 access_token +
 *                 refresh_token（滚动签发，一次性令牌，须严格串行）。
 * cron:           查询账户数据并推送 Surge 通知。
 */

'use strict';

const VERSION = '1.4.1';
const API_BASE = 'https://weixin.towngasvcc.com/nv1/vcc-cbs';
const OAUTH_BASE = 'https://weixin.towngasvcc.com/vcc-oauth/oauth/authorize2';
const SIGN_SUFFIX = 'hbasesoft.com-prod';
const SESSION_RUN_KEY = 'towngas_session_refresh_at';
const CHAIN_RUN_KEY = 'towngas_chain_refresh_at';
// 接力安全间隔：access/refresh token 均为 2 小时固定过期，80 分钟刷新留 40 分钟余量，
// 容忍 cron 延迟或一次失败重试；失败不写门控，下个周期（10 分钟后）即重试。
const CHAIN_INTERVAL_MS = 80 * 60 * 1000;
const KEYS = {
  authorization: 'towngas_authorization',
  refreshToken: 'towngas_refresh_token',
  oauthClient: 'towngas_oauth_client',
  tokenIssuedAt: 'towngas_token_issued_at',
  chainBrokeNotifiedAt: 'towngas_chain_broke_notified_at',
  cookie: 'towngas_cookie',
  userAgent: 'towngas_ua',
  referer: 'towngas_referer',
  subsId: 'towngas_subs_id',
  orgId: 'towngas_org_id',
  label: 'towngas_label',
  title: 'towngas_title',
  balanceThreshold: 'towngas_balance_threshold',
  criticalThreshold: 'towngas_balance_critical_threshold',
  capturedAt: 'towngas_captured_at',
  captureNotify: 'towngas_capnotify',
  debug: 'towngas_debug',
};

function parseArgs(value) {
  const out = {};
  String(value || '').split('&').forEach(part => {
    if (!part) return;
    const index = part.indexOf('=');
    const key = index < 0 ? part : part.slice(0, index);
    let raw = index < 0 ? '1' : part.slice(index + 1);
    try { raw = decodeURIComponent(raw); } catch (_) {}
    if (key) out[key] = raw;
  });
  return out;
}

const ARGS = parseArgs(typeof $argument === 'string' ? $argument : '');
const MODE = ARGS.mode || (typeof $request !== 'undefined' ? 'capture' : 'panel');

function read(key) {
  try { return $persistentStore.read(key) || ''; } catch (_) { return ''; }
}

function write(value, key) {
  if (value === null || value === undefined || String(value) === '') return false;
  const next = String(value);
  if (read(key) === next) return false;
  try { return $persistentStore.write(next, key); } catch (_) { return false; }
}

function header(headers, name) {
  const target = String(name).toLowerCase();
  const keys = Object.keys(headers || {});
  for (let i = 0; i < keys.length; i += 1) {
    if (keys[i].toLowerCase() === target) return String(headers[keys[i]] || '');
  }
  return '';
}

function cookieMap(value) {
  const out = {};
  String(value || '').split(';').forEach(part => {
    const index = part.indexOf('=');
    if (index <= 0) return;
    const name = part.slice(0, index).trim();
    if (name) out[name] = part.slice(index + 1).trim();
  });
  return out;
}

// Surge 可能将多个 Set-Cookie 返回为数组，也可能合并为一个字符串。
function mergeResponseCookies(headers) {
  const fresh = {};
  Object.keys(headers || {}).forEach(key => {
    if (String(key).toLowerCase() !== 'set-cookie') return;
    const values = Array.isArray(headers[key]) ? headers[key] : [headers[key]];
    values.forEach(value => {
      const text = String(value || '');
      const pattern = /(?:^|,\s*)([^=;,\s]+)=([^;,]*)/g;
      let match;
      while ((match = pattern.exec(text))) fresh[match[1]] = match[2].trim();
    });
  });
  if (!Object.keys(fresh).length) return false;
  const merged = Object.assign({}, cookieMap(read(KEYS.cookie)), fresh);
  return write(Object.keys(merged).map(name => name + '=' + merged[name]).join('; '), KEYS.cookie);
}

function queryParams(url) {
  const out = {};
  const query = String(url || '').split('?')[1] || '';
  query.split('&').forEach(part => {
    if (!part) return;
    const index = part.indexOf('=');
    const rawKey = index < 0 ? part : part.slice(0, index);
    const rawValue = index < 0 ? '' : part.slice(index + 1);
    try { out[decodeURIComponent(rawKey)] = decodeURIComponent(rawValue); }
    catch (_) { out[rawKey] = rawValue; }
  });
  return out;
}

// 从抓到的 oauth 请求 URL 推断 clientid，供后续 refreshToken 接力复用。
// 微信端: accessToekn?authCode=…&clientid=pe92a8wechat11118LSJJ0105…
// 支付宝端: union?authCode=…&clientid=ghaliminipg&orgCode=…
function oauthClientId(url) {
  const params = queryParams(url);
  if (params.clientid) return String(params.clientid);
  // 微信端进入时 union 请求不带 authCode，redirectUri 里也没有 clientid；
  // 真正签发发生在 accessToekn，正常流程都能取到。
  return '';
}

function endpointName(url) {
  const text = String(url || '');
  const oauth = text.match(/\/oauth\/authorize2\/(accessToekn|union)(?:\?|$)/);
  if (oauth) return oauth[1];
  const charge = text.match(/\/charge\/(preCheck|gasStepFee|queryHistoryFee)(?:\?|$)/);
  if (charge) return charge[1];
  const usersubs = text.match(/\/usersubs\/(getLoginUserInfo|queryBindList)(?:\?|$)/);
  if (usersubs) return usersubs[1];
  return '';
}

// 判断 oauth 响应来自哪个端：支付宝 union 响应直接带 access_token；
// 微信端 accessToekn 响应同样返回 access_token。两者都从这里换 Bearer。
function oauthSource(url) {
  const text = String(url || '');
  if (/\/oauth\/authorize2\/accessToekn/.test(text)) return '微信端';
  if (/\/oauth\/authorize2\/union/.test(text)) return '支付宝端';
  return '';
}

function mask(value) {
  const text = String(value || '');
  if (!text) return '缺失';
  if (text.length < 9) return '已获取';
  return text.slice(0, 4) + '…' + text.slice(-4);
}

function notifyCapture(title, subtitle, body) {
  if (read(KEYS.captureNotify) !== '0' && typeof $notification !== 'undefined') {
    $notification.post(title, subtitle, body);
  }
}

// 从 oauth 响应体提取 access_token 并更新 Bearer。
// 微信端: POST /vcc-oauth/oauth/authorize2/accessToekn?authCode=… → {access_token, refresh_token, expires_in}
// 支付宝端: POST /vcc-oauth/oauth/authorize2/union?authCode=… → {access_token, refresh_token, expires_in}
function captureOauth() {
  try {
    if (typeof $request === 'undefined') throw new Error('oauth 抓取模式未获取请求');
    const url = String($request.url || '');
    const source = oauthSource(url);
    if (!source) throw new Error('不是受支持的港华 oauth 接口');

    const body = typeof $response !== 'undefined' && $response ? String($response.body || '') : '';
    let payload;
    try { payload = JSON.parse(body); } catch (_) { throw new Error('oauth 响应非 JSON'); }
    const token = String(payload && payload.access_token || '');
    if (!token) throw new Error('oauth 响应缺少 access_token');

    const refreshToken = String(payload && payload.refresh_token || '');
    const bearer = 'Bearer ' + token;
    const previousAuth = read(KEYS.authorization);
    // 原子更新：一次写入 access + refresh + clientid + 签发时间。
    // refresh_token 一次性，旧 access 在 refresh 后立即吊销，任何一步都不可回退。
    write(bearer, KEYS.authorization);
    write(refreshToken, KEYS.refreshToken);
    write(oauthClientId(url), KEYS.oauthClient);
    write(String(Date.now()), KEYS.tokenIssuedAt);
    // 重新点火即新一代链：重置接力门控，下次接力在 CHAIN_INTERVAL 之后。
    write(String(Date.now()), CHAIN_RUN_KEY);
    write(new Date().toISOString(), KEYS.capturedAt);

    if (bearer !== previousAuth) {
      notifyCapture(
        '燃气 Bearer 已自动更新（' + source + '）',
        'access_token ' + mask(token),
        refreshToken
          ? '接力链已启动，有效期约 ' + (Number(payload.expires_in) || 7200) / 3600 + ' 小时，之后自动续签'
          : '新 Bearer 已写入 BoxJS，有效期约 ' + (Number(payload.expires_in) || 7200) / 3600 + ' 小时'
      );
    }
    if (read(KEYS.debug) === '1') console.log('[towngas ' + VERSION + '] oauth token captured from ' + source);
  } catch (error) {
    const message = String((error && error.message) || error);
    console.log('[towngas ' + VERSION + '] ' + message);
    if (read(KEYS.debug) === '1' && typeof $notification !== 'undefined') {
      $notification.post('燃气 oauth 抓取失败', '', message);
    }
  } finally {
    finish({});
  }
}

function finish(value) {
  if (typeof $done === 'function') $done(value || {});
}

function capture() {
  try {
    if (typeof $request === 'undefined') throw new Error('抓取模式未获取请求');
    const url = String($request.url || '');
    const name = endpointName(url);
    if (!name) throw new Error('不是受支持的港华主业务接口');

    const params = queryParams(url);
    const authorization = header($request.headers, 'Authorization');
    const cookie = header($request.headers, 'Cookie');
    const userAgent = header($request.headers, 'User-Agent');
    const referer = header($request.headers, 'Referer');
    const previousAuth = read(KEYS.authorization);
    const beforeComplete = !!(previousAuth && read(KEYS.subsId) && read(KEYS.orgId));

    if (/^Bearer\s+\S+/i.test(authorization)) write(authorization, KEYS.authorization);
    write(cookie, KEYS.cookie);
    write(userAgent, KEYS.userAgent);
    write(referer, KEYS.referer);
    write(params.subsId, KEYS.subsId);
    write(params.orgId, KEYS.orgId);
    write(new Date().toISOString(), KEYS.capturedAt);

    const currentAuth = read(KEYS.authorization);
    const authChanged = currentAuth && currentAuth !== previousAuth;
    const complete = !!(currentAuth && read(KEYS.subsId) && read(KEYS.orgId));
    if (authChanged || (!beforeComplete && complete)) {
      notifyCapture(
        '燃气查询配置已更新',
        name + ' · 户号 ' + mask(params.subsId || read(KEYS.subsId)),
        complete ? 'Bearer、户号 ID 和燃气公司 ID 已齐全' : '请进入充值购气页补齐账户 ID'
      );
    }
    if (read(KEYS.debug) === '1') console.log('[towngas ' + VERSION + '] captured ' + name);
  } catch (error) {
    const message = String((error && error.message) || error);
    console.log('[towngas ' + VERSION + '] ' + message);
    if (typeof $notification !== 'undefined') $notification.post('燃气配置抓取失败', '', message);
  } finally {
    finish({});
  }
}

function numberValue(value) {
  const parsed = parseFloat(String(value === null || value === undefined ? '0' : value));
  return isFinite(parsed) ? parsed : 0;
}

function md5(input) {
  const text = unescape(encodeURIComponent(String(input)));
  const words = [];
  for (let i = 0; i < text.length; i += 1) {
    words[i >> 2] = (words[i >> 2] || 0) | (text.charCodeAt(i) << ((i % 4) * 8));
  }
  words[text.length >> 2] = (words[text.length >> 2] || 0) | (0x80 << ((text.length % 4) * 8));
  const lengthIndex = (((text.length + 8) >> 6) + 1) * 16 - 2;
  words[lengthIndex] = text.length * 8;
  words[lengthIndex + 1] = Math.floor(text.length / 0x20000000);

  const shifts = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  const constants = [];
  for (let i = 0; i < 64; i += 1) constants[i] = (Math.abs(Math.sin(i + 1)) * 0x100000000) | 0;
  let state = [0x67452301, -0x10325477, -0x67452302, 0x10325476];
  const add = (a, b) => (a + b) | 0;
  const rotate = (value, bits) => (value << bits) | (value >>> (32 - bits));

  for (let offset = 0; offset < words.length; offset += 16) {
    let a = state[0]; let b = state[1]; let c = state[2]; let d = state[3];
    for (let i = 0; i < 64; i += 1) {
      let f; let g; let shift;
      if (i < 16) { f = (b & c) | (~b & d); g = i; shift = shifts[i % 4]; }
      else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16; shift = shifts[4 + (i % 4)]; }
      else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16; shift = shifts[8 + (i % 4)]; }
      else { f = c ^ (b | ~d); g = (7 * i) % 16; shift = shifts[12 + (i % 4)]; }
      const previousD = d;
      d = c; c = b;
      b = add(b, rotate(add(add(a, f), add(words[offset + g] || 0, constants[i])), shift));
      a = previousD;
    }
    state = [add(state[0], a), add(state[1], b), add(state[2], c), add(state[3], d)];
  }

  return state.map(value => {
    let out = '';
    for (let i = 0; i < 4; i += 1) out += ((value >>> (i * 8)) & 0xff).toString(16).padStart(2, '0');
    return out;
  }).join('');
}

function requestSign(params) {
  let source = '';
  Object.keys(params).sort().forEach(key => {
    if (key !== 'sign' && params[key] !== undefined && params[key] !== null && String(params[key]) !== '') {
      source += key + String(params[key]);
    }
  });
  return md5(source + SIGN_SUFFIX).toUpperCase();
}

function signedUrl(path, params) {
  const all = Object.assign({}, params, { timestamp: String(Date.now()) });
  const query = Object.keys(all).map(key => encodeURIComponent(key) + '=' + encodeURIComponent(String(all[key])));
  query.push('sign=' + requestSign(all));
  return API_BASE + path + '?' + query.join('&');
}

function signedOauthUrl(path, params) {
  const all = Object.assign({}, params, { timestamp: String(Date.now()) });
  const query = Object.keys(all).map(key => encodeURIComponent(key) + '=' + encodeURIComponent(String(all[key])));
  query.push('sign=' + requestSign(all));
  return OAUTH_BASE + path + '?' + query.join('&');
}

// ===== 无限接力链 =====
// refreshToken 接口用最新 refresh_token 换全新一对 token（滚动签发）。
// 规则（均已实测）：
//   1. refresh_token 一次性，消费即失效 → 只能用最新一代，写入必须原子；
//   2. refresh 成功后旧 access_token 立即吊销 → 先写 refresh 结果再写 access，
//      确保任何时刻读到的都是可用的一代；
//   3. 双端 clientid 不同（微信 pe92a8wechat…/支付宝 ghaliminipg），
//      clientid 从抓到的 oauth 请求自动记录，接力时复用。
function postOauth(path, params) {
  return new Promise((resolve, reject) => {
    const url = signedOauthUrl(path, params);
    const headers = {
      Accept: '*/*',
      'Content-Type': 'application/json',
      'User-Agent': read(KEYS.userAgent) || 'Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.76(0x18004c31) NetType/WIFI Language/zh_CN',
      Origin: 'https://weixin.towngasvcc.com',
      Referer: read(KEYS.referer) || 'https://weixin.towngasvcc.com/h5-gas/pages/transitionPage/index',
    };
    const cookie = read(KEYS.cookie);
    if (cookie) headers.Cookie = cookie;
    $httpClient.post({ url: url, headers: headers, body: '', timeout: 15 }, (error, response, body) => {
      if (error) return reject(new Error('refresh 请求失败: ' + error));
      mergeResponseCookies((response && response.headers) || {});
      let payload;
      try { payload = JSON.parse(body || ''); }
      catch (_) { return reject(new Error('refresh 返回非 JSON')); }
      resolve(payload);
    });
  });
}

// 执行一次接力；成功则原子更新两个 token 并返回新 access。
async function chainRefresh() {
  const refreshToken = read(KEYS.refreshToken);
  if (!refreshToken) throw new Error('没有 refresh_token，请打开港华小程序重新抓取');
  const params = { refreshToken: refreshToken };
  const clientId = read(KEYS.oauthClient);
  if (clientId) params.clientid = clientId;
  const payload = await postOauth('/refreshToken', params);
  const access = String(payload && payload.access_token || '');
  const nextRefresh = String(payload && payload.refresh_token || '');
  if (!access || !nextRefresh) {
    throw new Error('refresh 失败: ' + String(payload && (payload.resultMsg || payload.resultCode) || '响应缺少 token'));
  }
  // 先写新 refresh_token（接力链下一代），再写 access，最后刷时间戳。
  write(nextRefresh, KEYS.refreshToken);
  write('Bearer ' + access, KEYS.authorization);
  write(String(Date.now()), KEYS.tokenIssuedAt);
  return access;
}

function notifyChainBroken(reason) {
  // 断链提醒限流：同一根断链只提醒一次（1 小时内），重新抓取后自动复位。
  const last = numberValue(read(KEYS.chainBrokeNotifiedAt));
  if (last && Date.now() - last < 60 * 60000) return;
  write(String(Date.now()), KEYS.chainBrokeNotifiedAt);
  if (typeof $notification !== 'undefined') {
    $notification.post(
      '燃气接力链已断开',
      reason,
      '请打开一次微信或支付宝里的港华小程序，自动重新抓取'
    );
  }
}

// token-refresh 模式：cron 每 10 分钟检查，距上次成功接力满 CHAIN_INTERVAL 才刷新。
// 门控只在接力成功后写入：失败时下个周期立即重试，既不掉链子，也意味着
// 用户重新打开小程序点火后，10 分钟内 cron 会自动用新 token 接回链。
async function tokenRefresh() {
  const now = Date.now();
  const last = numberValue(read(CHAIN_RUN_KEY));
  if (last && now - last < CHAIN_INTERVAL_MS) return finish({});
  if (!read(KEYS.refreshToken)) return finish({}); // 还没抓到过 oauth，静默等待首次打开小程序
  try {
    const access = await chainRefresh();
    write(String(Date.now()), CHAIN_RUN_KEY);
    if (read(KEYS.debug) === '1') console.log('[towngas ' + VERSION + '] 接力成功 access ' + mask(access));
  } catch (error) {
    const message = String((error && error.message) || error);
    console.log('[towngas ' + VERSION + '] 接力失败（10 分钟后重试）: ' + message);
    notifyChainBroken(message);
  }
  finish({});
}

function requestJson(path, params, label) {
  return new Promise((resolve, reject) => {
    const url = signedUrl(path, params);
    const headers = {
      Accept: 'application/json, text/plain, */*',
      Authorization: read(KEYS.authorization),
      'User-Agent': read(KEYS.userAgent),
    };
    const cookie = read(KEYS.cookie);
    const referer = read(KEYS.referer);
    if (cookie) headers.Cookie = cookie;
    if (referer) headers.Referer = referer;
    $httpClient.get({ url: url, headers: headers, timeout: 15 }, (error, response, body) => {
      if (error) return reject(new Error(label + '查询失败: ' + error));
      mergeResponseCookies((response && response.headers) || {});
      const status = Number(response && (response.status || response.statusCode)) || 0;
      if (status < 200 || status >= 300) return reject(new Error(label + ' HTTP ' + status));
      let payload;
      try { payload = JSON.parse(body || ''); }
      catch (_) { return reject(new Error(label + '返回非 JSON'));
      }
      if (String(payload.resultCode) !== '0') return reject(new Error(label + ': ' + String(payload.resultMsg || payload.message || payload.resultCode)));
      resolve(payload.datas);
    });
  });
}

function currentTier(amount, tiers) {
  const rows = Array.isArray(tiers) ? tiers : [];
  let lower = 0;
  for (let i = 0; i < rows.length; i += 1) {
    const upper = numberValue(rows[i].maxMount);
    if (upper < 0 || amount <= upper) {
      return {
        name: rows[i].stepName || ('第' + (i + 1) + '阶梯'),
        price: numberValue(rows[i].price),
        lower: lower,
        upper: upper,
        used: Math.max(0, amount - lower),
        remaining: upper < 0 ? null : Math.max(0, upper - amount),
      };
    }
    lower = upper;
  }
  return { name: '阶梯未知', price: 0, lower: 0, upper: -1, used: amount, remaining: null };
}

function latestGasBill(history) {
  const months = Array.isArray(history) ? history : [];
  for (let i = 0; i < months.length; i += 1) {
    const rows = Array.isArray(months[i].gasFeeList) ? months[i].gasFeeList : [];
    for (let j = 0; j < rows.length; j += 1) {
      if (String(rows[j].feetype) === '燃气费') return rows[j];
    }
  }
  return null;
}

function money(value) { return numberValue(value).toFixed(2); }

async function queryAccount() {
  const authorization = read(KEYS.authorization);
  const subsId = read(KEYS.subsId);
  const orgId = read(KEYS.orgId);
  const missing = [];
  if (!/^Bearer\s+\S+/i.test(authorization)) missing.push('Bearer');
  if (!subsId) missing.push('subsId');
  if (!orgId) missing.push('orgId');
  if (missing.length) throw new Error('缺少 ' + missing.join('、') + '，请打开港华燃气和充值购气页');
  // 自愈：若 access_token 年龄超过安全间隔且手上有 refresh_token，先接力再查。
  // 覆盖 cron 停摆（设备关机/休眠）后 token 过期的场景，面板仍能自动恢复。
  const issuedAt = numberValue(read(KEYS.tokenIssuedAt));
  if (issuedAt && Date.now() - issuedAt > CHAIN_INTERVAL_MS && read(KEYS.refreshToken)) {
    try { await chainRefresh(); } catch (error) {
      const message = String((error && error.message) || error);
      console.log('[towngas ' + VERSION + '] 面板自愈接力失败: ' + message);
      if (/90143|refreshToken/.test(message)) notifyChainBroken(message);
    }
  }
  const results = await Promise.all([
    requestJson('/charge/preCheck', { subsId: subsId }, '账户概览'),
    requestJson('/charge/gasStepFee', { subsId: subsId, orgId: orgId }, '阶梯气价'),
    requestJson('/charge/queryHistoryFee', { orgId: orgId, subsId: subsId, pageSize: '30', pageIndex: '1' }, '历史账单').catch(() => []),
  ]);
  const account = results[0] || {};
  const step = results[1] || {};
  const bill = latestGasBill(results[2]);
  const reading = Array.isArray(account.readingRptList) && account.readingRptList[0] ? account.readingRptList[0].currReading : '--';
  const amount = numberValue(step.buyamount);
  return {
    account: account,
    bill: bill,
    reading: reading,
    amount: amount,
    tier: currentTier(amount, step.stepList),
    label: read(KEYS.label) || '燃气账户',
  };
}

function tierText(data) {
  return data.tier.remaining === null
    ? data.tier.name + ' · ¥' + money(data.tier.price) + '/方'
    : data.tier.name + ' · ¥' + money(data.tier.price) + '/方 · 距下一阶 ' + data.tier.remaining + ' 方';
}

function billText(bill) {
  return bill
    ? String(bill.yrMonth || '').slice(0, 4) + '-' + String(bill.yrMonth || '').slice(4) + '  ' + bill.amount + '方  ¥' + money(bill.chrgSum)
    : '暂无历史账单';
}

async function panel() {
  try {
    const data = await queryAccount();
    finish({
      title: data.label,
      content: '余额 ¥' + money(data.account.savingSum) + '  ·  待缴 ¥' + money(data.account.totalFee) + '\n' +
        '当前表数 ' + data.reading + '  ·  年度累计 ' + data.amount + ' 方\n' +
        tierText(data) + '\n最近账单 ' + billText(data.bill),
      icon: 'flame.fill',
      'icon-color': '#FF7A00',
    });
  } catch (error) {
    finish({
      title: '港华燃气',
      content: String((error && error.message) || error),
      icon: 'exclamationmark.triangle.fill',
      'icon-color': '#FF9F0A',
    });
  }
}

// cron 每 10 分钟唤醒一次；时间门控保证只有满指定间隔才真正访问接口。
async function refresh() {
  const minutes = Math.max(0, numberValue(ARGS.minutes || '80'));
  if (!minutes) return finish({});
  const now = Date.now();
  const last = numberValue(read(SESSION_RUN_KEY));
  if (last && now - last < minutes * 60000) return finish({});
  write(String(now), SESSION_RUN_KEY);
  try {
    await queryAccount();
    if (read(KEYS.debug) === '1') console.log('[towngas ' + VERSION + '] 静默续期完成');
  } catch (error) {
    if (read(KEYS.debug) === '1') console.log('[towngas ' + VERSION + '] 静默续期失败: ' + String((error && error.message) || error));
  }
  finish({});
}

async function cron() {
  try {
    const data = await queryAccount();
    const balance = numberValue(data.account.savingSum);
    const due = numberValue(data.account.totalFee);
    const low = numberValue(read(KEYS.balanceThreshold) || '100');
    const critical = numberValue(read(KEYS.criticalThreshold) || '50');
    const mark = due > 0 || balance <= critical ? '❗️' : (low > 0 && balance < low ? '⚠️' : '🔥');
    const title = mark + ' ' + (read(KEYS.title) || '港华燃气') + '：余额 ¥' + money(balance);
    const subtitle = due > 0 ? '待缴 ¥' + money(due) : data.label;
    const body = '当前表数 ' + data.reading + ' · 年度累计 ' + data.amount + ' 方\n' +
      tierText(data) + '\n最近账单 ' + billText(data.bill);
    if (typeof $notification !== 'undefined') $notification.post(title, subtitle, body);
  } catch (error) {
    if (typeof $notification !== 'undefined') {
      $notification.post((read(KEYS.title) || '港华燃气') + '：查询失败', '', '[' + VERSION + '] ' + String((error && error.message) || error));
    }
  }
  finish({});
}

(async function main() {
  if (MODE === 'capture') return capture();
  if (MODE === 'capture-oauth') return captureOauth();
  if (MODE === 'refresh') return await refresh();
  if (MODE === 'token-refresh') return await tokenRefresh();
  if (MODE === 'cron') return await cron();
  return await panel();
})();
