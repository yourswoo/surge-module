import { fetch } from "scripting"

const HOST = "http://lsep.wegist.cn"

export type Account = {
  label: string
  number: string
  token: string
  openid: string
  wechaId: string
}

export type BalanceInfo = {
  value: number
  owe: number
  prepay: number
  name: string
  code: string
  meterTime: number
}

export type BillInfo = {
  month: string
  money: number
  amount: number
  isPaid: boolean
}

export type AccountConfig = {
  numbers: string
  tokens: string
  openids: string
  wechaIds: string
  labels: string
  title: string
}

function splitList(value: string, preserveEmpty = false): string[] {
  if (!value?.trim()) return []
  const values = value.split(/[,|]/).map(item => item.trim())
  return preserveEmpty ? values : values.filter(Boolean)
}

function pick(values: string[], index: number): string {
  if (!values.length) return ""
  if (values.length === 1) return values[0]
  return values[index] ?? values[values.length - 1]
}

export function buildAccounts(config: AccountConfig): Account[] {
  const numbers = splitList(config.numbers)
  const tokens = splitList(config.tokens, true)
  const openids = splitList(config.openids, true)
  const wechaIds = splitList(config.wechaIds, true)
  const labels = splitList(config.labels, true)

  return numbers.map((number, index) => {
    const openid = pick(openids, index) || pick(wechaIds, index)
    const wechaId = pick(wechaIds, index) || openid
    return {
      number,
      token: pick(tokens, index),
      openid,
      wechaId,
      label: labels[index] || (numbers.length > 1 ? `户 ${index + 1}` : config.title),
    }
  })
}

function pageUrl(account: Account): string {
  return `${HOST}/index.php?g=Wap&m=Payment&a=all&token=${encodeURIComponent(account.token)}&wecha_id=${encodeURIComponent(account.wechaId)}&number=${encodeURIComponent(account.number)}`
}

function gateUrl(account: Account, method: string): string {
  return `${HOST}/index.php?g=Wap&m=Bound&a=getApi&token=${encodeURIComponent(account.token)}&method=${encodeURIComponent(method)}`
}

function parseCookie(value: string): Record<string, string> {
  const result: Record<string, string> = {}
  value.split(";").forEach(part => {
    const index = part.indexOf("=")
    if (index > 0) result[part.slice(0, index).trim()] = part.slice(index + 1).trim()
  })
  return result
}

export function normalizeCookie(value: string): string {
  const parsed = parseCookie(value)
  return ["PHPSESSID", "tgw_l7_route"]
    .filter(key => parsed[key])
    .map(key => `${key}=${parsed[key]}`)
    .join("; ")
}

function mergeResponseCookies(current: string, response: any): string {
  const merged = parseCookie(current)
  for (const cookie of response.cookies ?? []) {
    if (cookie.name === "PHPSESSID" || cookie.name === "tgw_l7_route") {
      merged[cookie.name] = cookie.value
    }
  }
  return normalizeCookie(Object.entries(merged).map(([key, value]) => `${key}=${value}`).join("; "))
}

async function request(url: string, init: any = {}): Promise<any> {
  const response = await fetch(url, {
    ...init,
    allowInsecureRequest: true,
    timeout: init.timeout ?? 12,
  })
  const body = await response.text()
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${body.slice(0, 80)}`)
  return { response, body }
}

function parseJson(body: string, label: string): any {
  try {
    return JSON.parse(body)
  } catch (_) {
    throw new Error(`${label} 返回非 JSON`)
  }
}

async function fetchGate(account: Account, cookie: string, userAgent: string, method: string): Promise<{ gate: any; cookie: string }> {
  const headers: Record<string, string> = {
    "User-Agent": userAgent,
    Accept: "application/json, text/javascript, */*; q=0.01",
    "Accept-Language": "zh-CN,zh;q=0.9",
    "X-Requested-With": "XMLHttpRequest",
    Referer: pageUrl(account),
  }
  if (cookie) headers.Cookie = cookie

  const { response, body } = await request(gateUrl(account, method), { headers, debugLabel: `乐电通 ${method} getApi` })
  const nextCookie = mergeResponseCookies(cookie, response)
  const json = parseJson(body, "getApi")
  if (String(json.code) !== "9999" || !json.data?.url || !json.data?.extend) {
    throw new Error(`${method} getApi：${String(json.msg ?? "会话无效").slice(0, 60)}`)
  }
  return { gate: json.data, cookie: nextCookie }
}

async function visitPaymentPage(account: Account, cookie: string, userAgent: string): Promise<string> {
  const headers: Record<string, string> = {
    "User-Agent": userAgent,
    Accept: "text/html,application/xhtml+xml",
    "Accept-Language": "zh-CN,zh;q=0.9",
  }
  if (cookie) headers.Cookie = cookie
  const { response } = await request(pageUrl(account), { headers, debugLabel: "乐电通缴费页" })
  return mergeResponseCookies(cookie, response)
}

function formBody(gate: any, account: Account): string {
  const extend = gate.extend ?? {}
  const preferred = ["reqtime", "secret", "channelCode", "clientid", "proxyId"]
  const keys = [...preferred.filter(key => extend[key] !== undefined)]
  Object.keys(extend).forEach(key => {
    if (!keys.includes(key)) keys.push(key)
  })
  const parts = keys.map(key => `${encodeURIComponent(key)}=${encodeURIComponent(String(extend[key]))}`)
  parts.push(`code=${encodeURIComponent(account.number)}`)
  parts.push(`openid=${encodeURIComponent(account.openid)}`)
  parts.push(`company=${encodeURIComponent(account.token)}`)
  return parts.join("&")
}

function normalizeBalance(data: any, fallbackNumber: string): BalanceInfo {
  const owe = Number.parseFloat(data.Money) || 0
  const prepay = Number.parseFloat(data.PrepayAmt) || 0
  return {
    value: owe > 0 ? -owe : prepay,
    owe,
    prepay,
    name: String(data.Name ?? ""),
    code: String(data.Code ?? fallbackNumber),
    meterTime: (Number.parseInt(data.Update_time, 10) || 0) * 1000,
  }
}

export async function queryAccount(account: Account, initialCookie: string, userAgent: string): Promise<{ info: BalanceInfo; cookie: string }> {
  let cookie = normalizeCookie(initialCookie)
  let gate: any

  try {
    const result = await fetchGate(account, cookie, userAgent, "queryArrears")
    gate = result.gate
    cookie = result.cookie
  } catch (_) {
    cookie = await visitPaymentPage(account, cookie, userAgent)
    const result = await fetchGate(account, cookie, userAgent, "queryArrears")
    gate = result.gate
    cookie = result.cookie
  }

  const { body } = await request(gate.url, {
    method: "POST",
    headers: {
      "User-Agent": userAgent,
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Accept: "application/json, text/javascript, */*; q=0.01",
      Origin: HOST,
      Referer: `${HOST}/`,
    },
    body: formBody(gate, account),
    debugLabel: "乐电通 queryArrears",
  })
  const json = parseJson(body, "queryArrears")
  if (String(json.code) !== "9999" || !json.data) {
    throw new Error(`查询失败：${String(json.msg ?? "未知错误").slice(0, 60)}`)
  }
  return { info: normalizeBalance(json.data, account.number), cookie }
}

function previousMonthKey(date = new Date()): string {
  const previous = new Date(date.getFullYear(), date.getMonth() - 1, 1)
  return `${previous.getFullYear()}${String(previous.getMonth() + 1).padStart(2, "0")}`
}

function normalizeBill(data: any): BillInfo {
  return {
    month: String(data.month ?? data.Month ?? ""),
    money: Number.parseFloat(data.allMoney ?? data.Money) || 0,
    amount: Number.parseFloat(data.allAmount ?? data.Amount) || 0,
    isPaid: Boolean(data.allStatus ?? data.IsPay),
  }
}

export async function queryLatestBill(account: Account, initialCookie: string, userAgent: string): Promise<{ bill: BillInfo | null; cookie: string }> {
  let cookie = normalizeCookie(initialCookie)
  let gate: any

  try {
    const result = await fetchGate(account, cookie, userAgent, "waterChargesQuery")
    gate = result.gate
    cookie = result.cookie
  } catch (_) {
    cookie = await visitPaymentPage(account, cookie, userAgent)
    const result = await fetchGate(account, cookie, userAgent, "waterChargesQuery")
    gate = result.gate
    cookie = result.cookie
  }

  const { body } = await request(gate.url, {
    method: "POST",
    headers: {
      "User-Agent": userAgent,
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Accept: "application/json, text/javascript, */*; q=0.01",
      Origin: HOST,
      Referer: `${HOST}/`,
    },
    body: formBody(gate, account),
    debugLabel: "乐电通 waterChargesQuery",
  })
  const json = parseJson(body, "waterChargesQuery")
  if (String(json.code) !== "9999") {
    throw new Error(`账单查询失败：${String(json.msg ?? "未知错误").slice(0, 60)}`)
  }
  const target = previousMonthKey()
  const rows = Array.isArray(json.data) ? json.data : []
  const match = rows.find(item => String(item?.month ?? item?.Month ?? "") === target)
  return { bill: match ? normalizeBill(match) : null, cookie }
}

export function formatMoney(value: number): string {
  return (Math.round(value * 100) / 100).toFixed(2)
}
