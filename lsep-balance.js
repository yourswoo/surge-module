/*
 * lsep-balance-boxjs.js — 乐电通电费余额监控 · 多户共享 Cookie / BoxJS 版
 * v7-session-keepalive
 *
 * 所有户号共用同一份 Cookie，持久化键：lsep_balance_cookie
 * Cookie 固定格式：PHPSESSID=xxx; tgw_l7_route=xxx
 *
 * BoxJS 可编辑户号、token、openid、户名、阈值等配置，也可查看、备份和同步。
 * Surge 打开微信缴费页时会自动提取 URL 中的 token / 户号 / wecha_id，并更新 BoxJS；
 * Cookie 会过滤无关字段后覆盖/补全共享键，所有账户查询统一读取这些持久化设置。
 *
 * 模式（由 argument 的 mode 指定）：
 *   panel   面板：实时查询余额并展示（单户详细 / 多户聚合）
 *   refresh 会话保活：静默查询并续期 Cookie
 *   cron    定时任务：推送余额通知
 *   capture 被动抓取：保存 queryArrears 返回的余额快照
 *   cookie  会话续借：抓取共享 Cookie 与微信 UA
 *   dump    调试面板：展示上一次查询轨迹
 *
 * BoxJS 设置与模块参数均支持多户（逗号或 | 分隔；模块参数优先）：
 *   number=户号1,户号2
 *   label=我家,父母家
 *   token / openid / wechaId：单值广播，多值按户对应
 *   threshold=100&title=电费余额&capnotify=1&debug=0
 */

'use strict';

const VER = 'v7-session-keepalive';

const DEFAULTS = {
  mode: '',
  token: '',
  number: '',
  openid: '',
  wechaId: '',
  label: '',
  threshold: '100',
  title: '电费余额',
  capnotify: '1',
  autorefresh: '1',
  debug: '0',
};

function parseArgs(s) {
  const o = {};
  String(s || '').split('&').forEach(kv => {
    if (!kv) return;
    const i = kv.indexOf('=');
    if (i < 0) {
      o[kv.trim()] = '1';
      return;
    }
    const k = kv.slice(0, i).trim();
    let v = kv.slice(i + 1).trim();
    try { v = decodeURIComponent(v); } catch (e) {}
    if (k) o[k] = v;
  });
  return o;
}

const CONF_KEYS = {
  token: 'lsep_balance_token',
  number: 'lsep_balance_number',
  openid: 'lsep_balance_openid',
  wechaId: 'lsep_balance_wechaId',
  label: 'lsep_balance_label',
  threshold: 'lsep_balance_threshold',
  title: 'lsep_balance_title',
  capnotify: 'lsep_balance_capnotify',
  debug: 'lsep_balance_debug',
};

function readBoxConf() {
  const o = {};
  if (typeof $persistentStore === 'undefined') return o;
  Object.keys(CONF_KEYS).forEach(k => {
    try {
      const v = $persistentStore.read(CONF_KEYS[k]);
      if (v !== null && v !== undefined && String(v) !== '') o[k] = String(v);
    } catch (e) {}
  });
  return o;
}

const ARGS = parseArgs(typeof $argument === 'string' ? $argument : '');
// 优先级：模块参数 > BoxJS > 内置默认值，兼容原有模块配置。
const CONF = Object.assign({}, DEFAULTS, readBoxConf(), ARGS);
const THRESHOLD = parseFloat(CONF.threshold) || 0;

const MODE = (function () {
  if (CONF.mode) return CONF.mode;
  if (typeof $response !== 'undefined') return 'capture';
  if (typeof $request !== 'undefined') return 'cookie';
  if (typeof $script !== 'undefined' && $script.type === 'cron') return 'cron';
  return 'panel';
})();

const HOST = 'http://lsep.wegist.cn';
const UA_BUILTIN = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.49(0x18003123) NetType/WIFI Language/zh_CN';

// BoxJS 与脚本共用此唯一 Cookie 键。
const COOKIE_KEY = 'lsep_balance_cookie';
const UA_KEY = 'lsep_balance_ua';
const DBG_KEY = 'lsep_balance_debuglog';
function stKey(number) { return 'lsep_st_' + number; }

function splitList(s, preserveEmpty) {
  if (String(s || '').trim() === '') return [];
  const arr = String(s).split(/[,|]/).map(x => x.trim());
  return preserveEmpty ? arr : arr.filter(x => x !== '');
}

function pick(arr, i) {
  if (!arr.length) return '';
  if (arr.length === 1) return arr[0];
  return arr[i] !== undefined ? arr[i] : arr[arr.length - 1];
}

function buildAccounts() {
  const numbers = splitList(CONF.number);
  const labels = splitList(CONF.label, true);
  const tokens = splitList(CONF.token, true);
  const openids = splitList(CONF.openid, true);
  const wechaIds = splitList(CONF.wechaId, true);
  const n = Math.max(numbers.length, 1);
  const accts = [];
  for (let i = 0; i < n; i++) {
    let openid = pick(openids, i);
    let wechaId = pick(wechaIds, i);
    if (!openid) openid = wechaId;
    if (!wechaId) wechaId = openid;
    accts.push({
      idx: i,
      label: labels[i] || (numbers.length > 1 ? '户' + (i + 1) : (CONF.title || '电费余额')),
      token: pick(tokens, i),
      number: numbers[i] || '',
      openid: openid,
      wechaId: wechaId,
    });
  }
  return accts;
}

function pageUrl(a) {
  return HOST + '/index.php?g=Wap&m=Payment&a=all&token=' + encodeURIComponent(a.token) +
    '&wecha_id=' + encodeURIComponent(a.wechaId) + '&number=' + encodeURIComponent(a.number);
}

function gateUrl(a) {
  return HOST + '/index.php?g=Wap&m=Bound&a=getApi&token=' + encodeURIComponent(a.token) + '&method=queryArrears';
}

const DBG = [];
function dlog(line) { DBG.push(line); }
function redact(v) {
  v = String(v);
  return v.length <= 8 ? v : v.slice(0, 5) + '…' + v.length;
}
function flushDbg() {
  if (MODE !== 'panel' && MODE !== 'cron' && MODE !== 'refresh') return;
  const dump = VER + ' ' + fmtTime(Date.now()) + '\n' + DBG.join('\n');
  try { $persistentStore.write(dump, DBG_KEY); } catch (e) {}
  if (CONF.debug === '1') console.log('[lsep-balance ' + VER + ']\n' + dump);
}

function decodeU(s) {
  return String(s).replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}
function bodyHead(b) { return decodeU(String(b)).replace(/\s+/g, ' ').slice(0, 110); }
function getUA() { return $persistentStore.read(UA_KEY) || UA_BUILTIN; }

function http(method, req, ms, label) {
  const ck = (req.headers && (req.headers.Cookie || req.headers.cookie)) || '';
  dlog(label + ' ' + method.toUpperCase() + ' ' + String(req.url).replace(/^https?:\/\//, '').slice(0, 55));
  dlog('  ↑ck:[' + ckSummary(ck) + ']');
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        dlog('  ✗ 超时');
        reject(new Error(label + '超时'));
      }
    }, ms || 10000);
    $httpClient[method](req, (err, resp, data) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) {
        dlog('  ✗ ' + err);
        return reject(new Error(label + '失败: ' + err));
      }
      const headers = (resp && resp.headers) || {};
      const status = (resp && (resp.status || resp.statusCode)) || 0;
      dlog('  ↓' + status + ' SC:[' + ckSummary(serializeCookies(harvestSetCookie(headers))) + '] ' + bodyHead(data));
      resolve({ status: status, headers: headers, body: data || '' });
    });
  });
}

function asJson(body, label) {
  try { return JSON.parse(body); }
  catch (e) { throw new Error(label + '返回非 JSON: ' + bodyHead(body).slice(0, 80)); }
}

function pad(n) { return (n < 10 ? '0' : '') + n; }
function fmtTime(ms) {
  if (!ms) return '未知';
  const d = new Date(ms);
  return pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}
function fmtMoney(x) { return (Math.round(x * 100) / 100).toFixed(2); }
function srcLabel(s) { return s === 'wechat' ? '微信抓取' : s === 'live' ? '实时查询' : '缓存'; }
function errText(e) { return String((e && e.message) || e).slice(0, 120); }

/* ---------- 共享 Cookie 罐 / BoxJS ---------- */

const COOKIE_ATTRS = /^(path|domain|expires|max-age|secure|httponly|samesite)$/i;

function parseCookieStr(s) {
  const o = {};
  String(s || '').split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > 0) {
      const k = p.slice(0, i).trim();
      if (k) o[k] = p.slice(i + 1).trim();
    }
  });
  return o;
}

function serializeCookies(o) {
  return Object.keys(o).map(k => k + '=' + o[k]).join('; ');
}

function normalizeLsepCookie(s) {
  const src = parseCookieStr(s);
  const out = {};
  if (src.PHPSESSID) out.PHPSESSID = src.PHPSESSID;
  if (src.tgw_l7_route) out.tgw_l7_route = src.tgw_l7_route;
  return serializeCookies(out);
}

function ckSummary(cookieStr) {
  const o = parseCookieStr(cookieStr);
  const ks = Object.keys(o);
  return ks.length ? ks.map(k => k + '=' + redact(o[k])).join(' ') : '-';
}

function harvestSetCookie(headers) {
  const jar = {};
  for (const k in headers) {
    if (String(k).toLowerCase() !== 'set-cookie') continue;
    const v = Array.isArray(headers[k]) ? headers[k].join(',') : String(headers[k]);
    v.split(/,(?=\s*[^;,=\s]+=)/).forEach(sc => {
      const m = sc.match(/^\s*([^=;,\s]+)=([^;]*)/);
      if (m && !COOKIE_ATTRS.test(m[1])) jar[m[1]] = m[2].trim();
    });
  }
  return jar;
}

// 所有查询只从这个共享键读取；BoxJS 的修改会在下一次运行时立即生效。
function readCookieStr() {
  return normalizeLsepCookie($persistentStore.read(COOKIE_KEY) || '');
}

function writeCookieStr(cookie) {
  const clean = normalizeLsepCookie(cookie);
  if (!clean) return '';
  $persistentStore.write(clean, COOKIE_KEY);
  return clean;
}

function mergeSharedCookie(cookie) {
  const old = parseCookieStr(readCookieStr());
  const fresh = parseCookieStr(cookie);
  const relevant = {};
  if (fresh.PHPSESSID) relevant.PHPSESSID = fresh.PHPSESSID;
  if (fresh.tgw_l7_route) relevant.tgw_l7_route = fresh.tgw_l7_route;
  if (!Object.keys(relevant).length) return serializeCookies(old);
  return writeCookieStr(serializeCookies(Object.assign({}, old, relevant)));
}

function updateCookieStore(headers) {
  return mergeSharedCookie(serializeCookies(harvestSetCookie(headers || {})));
}

/* ---------- 从微信缴费页自动同步账户配置到 BoxJS ---------- */

function queryParams(url) {
  const out = {};
  const q = String(url || '').split('?')[1] || '';
  q.split('&').forEach(part => {
    if (!part) return;
    const i = part.indexOf('=');
    const rawK = i < 0 ? part : part.slice(0, i);
    const rawV = i < 0 ? '' : part.slice(i + 1);
    try {
      const k = decodeURIComponent(rawK.replace(/\+/g, ' '));
      const v = decodeURIComponent(rawV.replace(/\+/g, ' '));
      if (k) out[k] = v;
    } catch (e) {}
  });
  return out;
}

function readStoreList(key, preserveEmpty) {
  try { return splitList($persistentStore.read(key) || '', preserveEmpty); }
  catch (e) { return []; }
}

function writeStoreList(key, arr) {
  const value = arr.join(',');
  let old = '';
  try { old = $persistentStore.read(key) || ''; } catch (e) {}
  if (old === value) return false;
  $persistentStore.write(value, key);
  return true;
}

function alignList(arr, count) {
  if (arr.length === 1 && count > 1) {
    while (arr.length < count) arr.push(arr[0]);
  } else {
    while (arr.length < count) arr.push(arr.length ? arr[arr.length - 1] : '');
  }
  return arr;
}

function syncAccountFromUrl(url) {
  if (!/^https?:\/\/lsep\.wegist\.cn\//i.test(String(url || ''))) return false;
  const p = queryParams(url);
  const number = String(p.number || p.code || '').trim();
  const token = String(p.token || p.company || '').trim();
  const openid = String(p.wecha_id || p.openid || '').trim();
  if (!number) return false;

  const numbers = readStoreList(CONF_KEYS.number, false);
  let idx = numbers.indexOf(number);
  if (idx < 0) {
    numbers.push(number);
    idx = numbers.length - 1;
  }
  const count = numbers.length;
  let changed = writeStoreList(CONF_KEYS.number, numbers);

  function updateField(key, value) {
    if (!value) return;
    const arr = alignList(readStoreList(key, true), count);
    arr[idx] = value;
    if (writeStoreList(key, arr)) changed = true;
  }

  updateField(CONF_KEYS.token, token);
  updateField(CONF_KEYS.openid, openid);
  updateField(CONF_KEYS.wechaId, openid);
  return changed;
}

/* ---------- 查询链路 ---------- */

async function fetchGate(acct, cookie, tag) {
  const headers = {
    'User-Agent': getUA(),
    'Accept': 'application/json, text/javascript, */*; q=0.01',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    'X-Requested-With': 'XMLHttpRequest',
    'Referer': pageUrl(acct),
  };
  if (cookie) headers.Cookie = cookie;
  const r = await http('get', { url: gateUrl(acct), headers: headers }, 10000, tag || 'getApi');
  updateCookieStore(r.headers);
  const j = asJson(r.body, 'getApi');
  if (String(j.code) !== '9999' || !j.data || !j.data.url || !j.data.extend) {
    throw new Error('getApi: ' + decodeU(String(j.msg || r.body)).slice(0, 60));
  }
  return j.data;
}

async function visitPage(acct, cookie) {
  const headers = {
    'User-Agent': getUA(),
    'Accept': 'text/html,application/xhtml+xml',
    'Accept-Language': 'zh-CN,zh;q=0.9',
  };
  if (cookie) headers.Cookie = cookie;
  const r = await http('get', { url: pageUrl(acct), headers: headers }, 12000, '缴费页');
  const merged = updateCookieStore(r.headers);
  if (!/PHPSESSID=/.test(merged)) dlog('  ⚠️ 页面未发 PHPSESSID（可能有重定向或响应头未透出）');
  return merged || cookie || '';
}

async function queryArrears(acct) {
  dlog('=== ' + acct.label + '(' + acct.number + ') token:' + (acct.token ? '✓' : '✗') +
    ' openid:' + (acct.openid ? '✓' : '✗') + ' ua:' + ($persistentStore.read(UA_KEY) ? '微信续借' : '内置'));
  let gate;
  let cookie = readCookieStr();
  try {
    gate = await fetchGate(acct, cookie, 'A1.getApi');
  } catch (e) {
    dlog('A1 失败:' + errText(e) + ' → 走建会话兜底');
    cookie = await visitPage(acct, cookie);
    try {
      gate = await fetchGate(acct, cookie, 'A2.getApi');
    } catch (e2) {
      const m = errText(e2);
      throw new Error(m + (/身份|登录|用户/.test(m) ? '（在微信里打开一次缴费页续会话）' : ''));
    }
  }

  const ex = gate.extend || {};
  const order = ['reqtime', 'secret', 'channelCode', 'clientid', 'proxyId'];
  const parts = [];
  order.forEach(k => { if (ex[k] !== undefined) parts.push(k + '=' + encodeURIComponent(ex[k])); });
  Object.keys(ex).forEach(k => { if (order.indexOf(k) < 0) parts.push(k + '=' + encodeURIComponent(ex[k])); });
  parts.push('code=' + encodeURIComponent(acct.number));
  parts.push('openid=' + encodeURIComponent(acct.openid));
  parts.push('company=' + encodeURIComponent(acct.token));

  const r = await http('post', {
    url: gate.url,
    body: parts.join('&'),
    headers: {
      'User-Agent': getUA(),
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'Origin': HOST,
      'Referer': HOST + '/',
    },
  }, 12000, 'B.queryArrears');
  const j = asJson(r.body, 'queryArrears');
  if (String(j.code) !== '9999' || !j.data) {
    throw new Error('查询失败: ' + decodeU(String(j.msg || r.body)).slice(0, 80));
  }
  return normalize(j.data, acct.number);
}

function normalize(d, fallbackNumber) {
  const owe = parseFloat(d.Money) || 0;
  const prepay = parseFloat(d.PrepayAmt) || 0;
  return {
    v: owe > 0 ? -owe : prepay,
    owe: owe,
    prepay: prepay,
    name: d.Name || '',
    code: d.Code ? String(d.Code) : (fallbackNumber || ''),
    meterTime: (parseInt(d.Update_time, 10) || 0) * 1000,
  };
}

/* ---------- 状态存储与用量估算 ---------- */

function loadState(number) {
  try {
    const s = JSON.parse($persistentStore.read(stKey(number)) || 'null');
    return (s && typeof s === 'object') ? s : { hist: [] };
  } catch (e) {
    return { hist: [] };
  }
}

function saveSnapshot(number, info, src) {
  const st = loadState(number);
  const prev = st.last || null;
  const now = Date.now();
  st.last = { v: info.v, owe: info.owe, prepay: info.prepay, name: info.name, mt: info.meterTime, t: now, src: src };
  st.hist = Array.isArray(st.hist) ? st.hist : [];
  const h = st.hist;
  if (!h.length || Math.abs(h[h.length - 1].v - info.v) > 0.005 || now - h[h.length - 1].t > 12 * 3600e3) {
    h.push({ t: now, v: info.v });
  }
  if (h.length > 90) st.hist = h.slice(-90);
  $persistentStore.write(JSON.stringify(st), stKey(number));
  return prev;
}

function cachedInfo(last, number) {
  return {
    v: last.v,
    owe: last.owe || 0,
    prepay: last.prepay != null ? last.prepay : (last.v > 0 ? last.v : 0),
    name: last.name || '',
    code: number,
    meterTime: last.mt || 0,
  };
}

function usageStats(st, cur) {
  const h = (st.hist || []).filter(e => Date.now() - e.t < 30 * 86400e3);
  let drop = 0;
  let span = 0;
  for (let i = 1; i < h.length; i++) {
    const dv = h[i - 1].v - h[i].v;
    const dt = h[i].t - h[i - 1].t;
    if (dt <= 0) continue;
    if (dv > 0) {
      drop += dv;
      span += dt;
    }
  }
  if (drop < 0.01 || span < 6 * 3600e3) return null;
  const perDay = drop / (span / 86400e3);
  if (!(perDay > 0.01)) return null;
  return { perDay: perDay, daysLeft: cur > 0 ? cur / perDay : null };
}

function missingConf() {
  const accts = buildAccounts();
  const bad = accts.filter(a => !(a.token && a.number && a.openid));
  if (!bad.length) return null;
  return '缺少配置：请在 BoxJS 或模块参数中填写 token / number / openid（多户用逗号分隔）';
}

async function queryOne(acct) {
  try {
    const info = await queryArrears(acct);
    saveSnapshot(acct.number, info, 'live');
    return { acct: acct, info: info, src: 'live', at: Date.now(), err: null };
  } catch (e) {
    const st = loadState(acct.number);
    if (st.last) {
      return {
        acct: acct,
        info: cachedInfo(st.last, acct.number),
        src: st.last.src === 'wechat' ? 'wechat' : 'cache',
        at: st.last.t,
        err: errText(e),
      };
    }
    return { acct: acct, info: null, src: null, at: 0, err: errText(e) };
  }
}

function colorOf(results) {
  let anyOwe = false;
  let anyLow = false;
  let anyLive = false;
  let anyOther = false;
  results.forEach(r => {
    if (!r.info) {
      anyOther = true;
      return;
    }
    if (r.info.owe > 0) anyOwe = true;
    else if (THRESHOLD > 0 && r.info.prepay < THRESHOLD) anyLow = true;
    if (r.src === 'live') anyLive = true;
    else anyOther = true;
  });
  if (anyOwe) return '#FF3B30';
  if (anyLow) return '#FF9500';
  if (!anyLive && anyOther) return '#8E8E93';
  return '#34C759';
}

function buildPanelSingle(r) {
  const info = r.info;
  const lines = [];
  if (info.owe > 0) lines.push('欠费：' + fmtMoney(info.owe) + ' 元，请尽快充值');
  else lines.push('余额：' + fmtMoney(info.prepay) + ' 元');
  const u = usageStats(loadState(info.code), info.v);
  if (u) {
    lines.push('日均 ≈' + fmtMoney(u.perDay) + ' 元' +
      (u.daysLeft != null ? ' · 约可用 ' + Math.floor(u.daysLeft) + ' 天' : ''));
  }
  lines.push('户号 ' + info.code + (info.name ? ' · ' + info.name : ''));
  lines.push('抄表 ' + fmtTime(info.meterTime));
  lines.push(srcLabel(r.src) + ' ' + fmtTime(r.at));
  if (r.err) lines.push('实时查询失败：' + r.err);
  return {
    title: (CONF.title || '电费余额') + ' ' + (info.owe > 0 ? '欠费 ' + fmtMoney(info.owe) : fmtMoney(info.prepay)) + ' 元',
    content: lines.join('\n'),
    icon: 'bolt.fill',
    'icon-color': colorOf([r]),
  };
}

function buildPanelMulti(results) {
  const lines = [];
  results.forEach(r => {
    if (!r.info) {
      lines.push(r.acct.label + '：查询失败');
      return;
    }
    const info = r.info;
    let seg = info.owe > 0 ? '欠费 ' + fmtMoney(info.owe) + ' 元' : fmtMoney(info.prepay) + ' 元';
    if (info.owe <= 0 && THRESHOLD > 0 && info.prepay < THRESHOLD) seg += ' ⚠️';
    if (r.src !== 'live') seg += '（' + srcLabel(r.src) + ' ' + fmtTime(r.at) + '）';
    lines.push(r.acct.label + '：' + seg);
  });
  lines.push('刷新时间：' + fmtTime(Date.now()));
  return {
    title: (CONF.title || '电费余额') + '（共' + results.length + '户）',
    content: lines.join('\n'),
    icon: 'bolt.fill',
    'icon-color': colorOf(results),
  };
}

async function runPanel() {
  const miss = missingConf();
  if (miss) {
    return $done({
      title: (CONF.title || '电费余额') + ' 未配置',
      content: '[' + VER + '] ' + miss,
      icon: 'gearshape.fill',
      'icon-color': '#FF3B30',
    });
  }
  const results = await Promise.all(buildAccounts().map(queryOne));
  flushDbg();
  if (results.length === 1) {
    const r = results[0];
    if (!r.info) {
      return $done({
        title: (CONF.title || '电费余额') + ' 获取失败',
        content: '[' + VER + '] ' + r.err + '\n可先在微信里打开一次缴费页，让脚本抓取 Cookie',
        icon: 'bolt.slash.fill',
        'icon-color': '#FF3B30',
      });
    }
    return $done(buildPanelSingle(r));
  }
  $done(buildPanelMulti(results));
}

async function runCron() {
  const miss = missingConf();
  if (miss) {
    $notification.post((CONF.title || '电费余额') + '：未配置', '', miss);
    return $done();
  }
  const results = await Promise.all(buildAccounts().map(queryOne));
  flushDbg();
  const lowNames = results
    .filter(r => r.info && (r.info.owe > 0 || (THRESHOLD > 0 && r.info.prepay < THRESHOLD)))
    .map(r => r.acct.label);

  if (results.length === 1) {
    const r = results[0];
    if (!r.info) {
      $notification.post((CONF.title || '电费余额') + '：查询失败', '', '[' + VER + '] ' + r.err);
      return $done();
    }
    const info = r.info;
    const u = usageStats(loadState(info.code), info.v);
    const title = info.owe > 0
      ? '❗️' + (CONF.title || '电费余额') + '：欠费 ' + fmtMoney(info.owe) + ' 元'
      : '⚡️ ' + (CONF.title || '电费余额') + '：' + fmtMoney(info.prepay) + ' 元';
    const sub = u
      ? '日均 ≈' + fmtMoney(u.perDay) + ' 元' + (u.daysLeft != null ? ' · 约可用 ' + Math.floor(u.daysLeft) + ' 天' : '')
      : '户号 ' + info.code + (info.name ? '（' + info.name + '）' : '');
    let body = '户号 ' + info.code + (info.name ? '（' + info.name + '）' : '') + ' · 抄表 ' + fmtTime(info.meterTime);
    if (r.src !== 'live') body += '\n（' + srcLabel(r.src) + ' ' + fmtTime(r.at) + '，实时查询失败）';
    if (info.owe <= 0 && THRESHOLD > 0 && info.prepay < THRESHOLD) {
      body += '\n⚠️ 余额低于 ' + THRESHOLD + ' 元，记得充值';
    }
    $notification.post(title, sub, body);
    return $done();
  }

  const bodyLines = results.map(r => {
    if (!r.info) return r.acct.label + '：查询失败';
    let seg = r.info.owe > 0 ? '欠费 ' + fmtMoney(r.info.owe) + ' 元' : fmtMoney(r.info.prepay) + ' 元';
    if (r.info.owe <= 0 && THRESHOLD > 0 && r.info.prepay < THRESHOLD) seg += ' ⚠️';
    if (r.src !== 'live') seg += '（' + srcLabel(r.src) + '）';
    return r.acct.label + '：' + seg;
  });
  const title = (lowNames.length ? '⚠️ ' : '⚡️ ') + (CONF.title || '电费余额') + '（共' + results.length + '户）';
  const sub = lowNames.length ? lowNames.join('、') + ' 需充值' : '各户余额正常';
  $notification.post(title, sub, bodyLines.join('\n'));
  $done();
}

// 仅用于维持服务端会话：成功、失败都不弹通知。
async function runRefresh() {
  if (String(CONF.autorefresh) === '0') return $done();
  const miss = missingConf();
  if (miss) {
    dlog('静默续期跳过：' + miss);
    flushDbg();
    return $done();
  }
  await Promise.all(buildAccounts().map(queryOne));
  flushDbg();
  $done();
}

function runCapture() {
  try {
    const body = (typeof $response !== 'undefined' && typeof $response.body === 'string') ? $response.body : '';
    if (body) {
      const j = JSON.parse(body);
      if (j && String(j.code) === '9999' && j.data && j.data.PrepayAmt !== undefined) {
        const code = j.data.Code ? String(j.data.Code) : '';
        const accts = buildAccounts();
        const numbers = accts.map(a => a.number);
        if (!code || numbers.indexOf(code) >= 0 || numbers.length === 0) {
          const number = code || (accts[0] && accts[0].number) || '';
          const info = normalize(j.data, number);
          saveSnapshot(number, info, 'wechat');
        }
      }
    }
  } catch (e) {
    // 抓取失败保持静默，不影响原请求。
  }
  $done({});
}

// 微信打开任一缴费页时，抓取共享 Cookie；户号不再参与 Cookie 存储。
function runCookieHarvest() {
  try {
    const h = (typeof $request !== 'undefined' && $request.headers) || {};
    const requestUrl = (typeof $request !== 'undefined' && $request.url) || '';
    let cookie = '';
    let ua = '';
    syncAccountFromUrl(requestUrl);
    let cookieChanged = false;
    for (const k in h) {
      const lk = String(k).toLowerCase();
      if (lk === 'cookie') cookie = String(h[k]);
      if (lk === 'user-agent') ua = String(h[k]);
    }
    if (cookie && (/(?:^|;\s*)PHPSESSID=/.test(cookie) || /(?:^|;\s*)tgw_l7_route=/.test(cookie))) {
      const before = readCookieStr();
      const after = mergeSharedCookie(cookie);
      cookieChanged = !!(after && after !== before);
    }
    if (ua && /MicroMessenger/i.test(ua)) {
      const oldUa = $persistentStore.read(UA_KEY) || '';
      if (oldUa !== ua) {
        $persistentStore.write(ua, UA_KEY);
      }
    }
    if (CONF.capnotify !== '0' && cookieChanged) {
      $notification.post('已抓取到乐电通 Cookie', '', '');
    }
  } catch (e) {
    // 抓取失败保持静默，不影响微信页面。
  }
  $done({});
}

function runDump() {
  const dump = $persistentStore.read(DBG_KEY) || '暂无调试记录。请先运行一次 panel 或 cron 模式。';
  const cookie = readCookieStr();
  $done({
    title: (CONF.title || '电费余额') + ' 调试信息',
    content: '共享 Cookie：' + (cookie ? ckSummary(cookie) : '未保存') + '\n键名：' + COOKIE_KEY + '\n\n' + dump,
    icon: 'ladybug.fill',
    'icon-color': cookie ? '#34C759' : '#FF9500',
  });
}

(async function main() {
  try {
    if (MODE === 'capture') return runCapture();
    if (MODE === 'cookie') return runCookieHarvest();
    if (MODE === 'dump') return runDump();
    if (MODE === 'refresh') return await runRefresh();
    if (MODE === 'cron') return await runCron();
    return await runPanel();
  } catch (e) {
    try { flushDbg(); } catch (_) {}
    const msg = '[' + VER + '] ' + errText(e);
    if (MODE === 'panel' || MODE === 'dump') {
      return $done({
        title: (CONF.title || '电费余额') + ' 脚本错误',
        content: msg,
        icon: 'exclamationmark.triangle.fill',
        'icon-color': '#FF3B30',
      });
    }
    if (MODE === 'cron') $notification.post((CONF.title || '电费余额') + '：脚本错误', '', msg);
    $done({});
  }
})();
