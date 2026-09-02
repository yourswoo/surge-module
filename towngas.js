/*
 * 港华燃气账户查询·Surge 抓取与面板
 * v1.1.1
 *
 * capture: 保存 preCheck / gasStepFee / queryHistoryFee 完整签名 URL、
 *          Authorization、Cookie、UA、Referer、subsId 和 orgId。
 * panel:   读取 BoxJS 共享键，查询账户余额、表数、阶梯和最近账单。
 * refresh: 每隔指定分钟静默查询，并把响应中的新 Cookie 合并回 BoxJS。
 * cron:    查询账户数据并推送 Surge 通知。
 */

'use strict';

const VERSION = '1.1.1';
const SESSION_RUN_KEY = 'towngas_session_refresh_at';
const KEYS = {
  authorization: 'towngas_authorization',
  cookie: 'towngas_cookie',
  userAgent: 'towngas_ua',
  referer: 'towngas_referer',
  subsId: 'towngas_subs_id',
  orgId: 'towngas_org_id',
  precheckUrl: 'towngas_precheck_url',
  stepUrl: 'towngas_step_url',
  historyUrl: 'towngas_history_url',
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

function endpointName(url) {
  const match = String(url || '').match(/\/charge\/(preCheck|gasStepFee|queryHistoryFee)(?:\?|$)/);
  return match ? match[1] : '';
}

function endpointKey(name) {
  if (name === 'preCheck') return KEYS.precheckUrl;
  if (name === 'gasStepFee') return KEYS.stepUrl;
  if (name === 'queryHistoryFee') return KEYS.historyUrl;
  return '';
}

function mask(value) {
  const text = String(value || '');
  if (!text) return '缺失';
  if (text.length < 9) return '已获取';
  return text.slice(0, 4) + '…' + text.slice(-4);
}

function finish(value) {
  if (typeof $done === 'function') $done(value || {});
}

function capture() {
  try {
    if (typeof $request === 'undefined') throw new Error('抓取模式未获取请求');
    const url = String($request.url || '');
    const name = endpointName(url);
    const urlKey = endpointKey(name);
    if (!urlKey) throw new Error('不是受支持的燃气查询接口');

    const params = queryParams(url);
    const authorization = header($request.headers, 'Authorization');
    const cookie = header($request.headers, 'Cookie');
    const userAgent = header($request.headers, 'User-Agent');
    const referer = header($request.headers, 'Referer');
    const previousAuth = read(KEYS.authorization);
    const firstEndpointCapture = !read(urlKey);

    write(url, urlKey);
    write(authorization, KEYS.authorization);
    write(cookie, KEYS.cookie);
    write(userAgent, KEYS.userAgent);
    write(referer, KEYS.referer);
    write(params.subsId, KEYS.subsId);
    write(params.orgId, KEYS.orgId);
    write(new Date().toISOString(), KEYS.capturedAt);

    const authChanged = authorization && authorization !== previousAuth;
    if (read(KEYS.captureNotify) !== '0' && (firstEndpointCapture || authChanged) && typeof $notification !== 'undefined') {
      const complete = [KEYS.precheckUrl, KEYS.stepUrl, KEYS.historyUrl].every(key => !!read(key));
      $notification.post(
        '燃气查询配置已更新',
        name + ' · 户号 ' + mask(params.subsId || read(KEYS.subsId)),
        complete ? '余额、阶梯和历史账单配置已齐全' : '请继续打开充值购气/历史账单页补齐接口'
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

function requestJson(url, label) {
  return new Promise((resolve, reject) => {
    if (!url) return reject(new Error('缺少 ' + label + ' 签名 URL'));
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
  if (!read(KEYS.authorization)) throw new Error('请先在微信中打开燃气页面抓取配置');
  const results = await Promise.all([
    requestJson(read(KEYS.precheckUrl), '账户概览'),
    requestJson(read(KEYS.stepUrl), '阶梯气价'),
    read(KEYS.historyUrl) ? requestJson(read(KEYS.historyUrl), '历史账单').catch(() => []) : Promise.resolve([]),
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
  if (MODE === 'refresh') return await refresh();
  if (MODE === 'cron') return await cron();
  return await panel();
})();
