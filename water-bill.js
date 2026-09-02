/*
 * 云润水费 · Surge 抓取脚本
 *
 * 在微信中打开水费账单或缴费页面时，从接口请求中提取查询所需配置并写入
 * Surge 持久化存储。BoxJS 与 Scripting 小组件读取同一组键。
 */

'use strict';

const VERSION = '1.0.0';
const PREFIX = 'water_bill_';
const KEYS = {
  appId: PREFIX + 'appid',
  openId: PREFIX + 'openid',
  customerId: PREFIX + 'customerid',
  cookie: PREFIX + 'cookie',
  userAgent: PREFIX + 'ua',
  capturedAt: PREFIX + 'captured_at',
  captureNotify: PREFIX + 'capnotify',
};

function decode(value) {
  try {
    return decodeURIComponent(String(value || '').replace(/\+/g, ' '));
  } catch (_) {
    return String(value || '');
  }
}

function parseForm(body) {
  const result = {};
  String(body || '').split('&').forEach(part => {
    if (!part) return;
    const index = part.indexOf('=');
    const key = decode(index < 0 ? part : part.slice(0, index));
    const value = decode(index < 0 ? '' : part.slice(index + 1));
    if (key) result[key] = value;
  });
  return result;
}

function header(headers, name) {
  const target = String(name).toLowerCase();
  const keys = Object.keys(headers || {});
  for (let i = 0; i < keys.length; i += 1) {
    if (keys[i].toLowerCase() === target) return String(headers[keys[i]] || '');
  }
  return '';
}

function normalizeCookie(cookie, appId) {
  const parts = String(cookie || '').split(';').map(item => item.trim()).filter(Boolean);
  if (!parts.length) return '';
  const preferred = appId + '_openId';
  const selected = parts.filter(part => part.slice(0, part.indexOf('=')).trim() === preferred);
  return (selected.length ? selected : parts).join('; ');
}

function read(key) {
  try { return $persistentStore.read(key) || ''; } catch (_) { return ''; }
}

function write(value, key) {
  if (!value) return false;
  try { return $persistentStore.write(String(value), key); } catch (_) { return false; }
}

function masked(value) {
  const text = String(value || '');
  if (text.length <= 8) return text ? '已获取' : '缺失';
  return text.slice(0, 4) + '…' + text.slice(-4);
}

function finish() {
  if (typeof $done === 'function') $done({});
}

try {
  if (typeof $request === 'undefined') throw new Error('此脚本只能由 Surge HTTP 请求规则触发');

  const form = parseForm($request.body);
  const appId = form.appId || form.appid || '';
  const openId = form.openId || form.openid || '';
  const customerId = form.customerId || form.customerid || '';
  const userAgent = header($request.headers, 'User-Agent');
  const cookie = normalizeCookie(header($request.headers, 'Cookie'), appId);

  if (!appId || !openId || !customerId) {
    throw new Error('请求中缺少 appId、openId 或 customerId，请进入水费账单/缴费页面后重试');
  }

  const previousAppId = read(KEYS.appId);
  const previousOpenId = read(KEYS.openId);
  const previousCustomerId = read(KEYS.customerId);
  const previousCookie = read(KEYS.cookie);
  const previous = [previousAppId, previousOpenId, previousCustomerId, previousCookie].join('|');
  const accountChanged = previousAppId !== appId || previousOpenId !== openId || previousCustomerId !== customerId;
  write(appId, KEYS.appId);
  write(openId, KEYS.openId);
  write(customerId, KEYS.customerId);
  if (cookie) write(cookie, KEYS.cookie);
  else if (accountChanged) {
    try { $persistentStore.write('', KEYS.cookie); } catch (_) {}
  }
  write(userAgent, KEYS.userAgent);
  write(new Date().toISOString(), KEYS.capturedAt);

  const current = [appId, openId, customerId, cookie || (accountChanged ? '' : previousCookie)].join('|');
  const notify = read(KEYS.captureNotify) !== '0';
  if (notify && previous !== current && typeof $notification !== 'undefined') {
    $notification.post(
      '水费查询配置已更新',
      '身份参数 ' + masked(customerId),
      cookie ? 'Cookie 与查询参数已写入 BoxJS' : '查询参数已写入 BoxJS（该接口不强制 Cookie）'
    );
  }
  console.log('[water-bill ' + VERSION + '] captured appId/openId/customerId; cookie=' + (cookie ? 'yes' : 'no'));
} catch (error) {
  const message = String((error && error.message) || error);
  console.log('[water-bill ' + VERSION + '] ' + message);
  if (typeof $notification !== 'undefined') {
    $notification.post('水费配置抓取失败', '', message);
  }
} finally {
  finish();
}
