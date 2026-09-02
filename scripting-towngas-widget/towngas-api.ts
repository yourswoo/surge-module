import { fetch } from "scripting"

const API_BASE = "https://weixin.towngasvcc.com/nv1/vcc-cbs"
const SIGN_SUFFIX = "hbasesoft.com-prod"
const DEFAULT_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.49 NetType/WIFI Language/zh_CN"

export type GasCredentials = {
  authorization: string
  cookie: string
  userAgent: string
  referer: string
  subsId: string
  orgId: string
}

export type GasAccount = {
  subscriberCode: string
  subscriberName: string
  address: string
  chargeType: string
  balance: number
  due: number
  currentReading: number
}

export type GasTier = {
  index: number
  name: string
  price: number
  lower: number
  upper: number | null
  usedInTier: number
  quota: number | null
  remaining: number | null
  progress: number
}

export type GasBill = {
  month: string
  usage: number
  amount: number
  unpaid: number
  paid: number
  state: string
  previousReading: number
  currentReading: number
  source: string
  tierLines: Array<{ price: number; usage: number; amount: number }>
}

export type GasResult = {
  account: GasAccount
  annualUsage: number
  tier: GasTier
  tiers: GasTier[]
  bills: GasBill[]
  unbilledUsage: number
  queriedAt: number
}

function numberValue(value: unknown): number {
  const parsed = Number.parseFloat(String(value ?? "0"))
  return Number.isFinite(parsed) ? parsed : 0
}

function md5(input: string): string {
  const text = unescape(encodeURIComponent(input))
  const words: number[] = []
  for (let i = 0; i < text.length; i += 1) {
    words[i >> 2] = (words[i >> 2] || 0) | (text.charCodeAt(i) << ((i % 4) * 8))
  }
  words[text.length >> 2] = (words[text.length >> 2] || 0) | (0x80 << ((text.length % 4) * 8))
  const lengthIndex = (((text.length + 8) >> 6) + 1) * 16 - 2
  words[lengthIndex] = text.length * 8
  words[lengthIndex + 1] = Math.floor(text.length / 0x20000000)

  const shifts = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21]
  const constants = Array.from({ length: 64 }, (_, index) => (Math.abs(Math.sin(index + 1)) * 0x100000000) | 0)
  let state = [0x67452301, -0x10325477, -0x67452302, 0x10325476]
  const add = (a: number, b: number) => (a + b) | 0
  const rotate = (value: number, bits: number) => (value << bits) | (value >>> (32 - bits))

  for (let offset = 0; offset < words.length; offset += 16) {
    let [a, b, c, d] = state
    for (let i = 0; i < 64; i += 1) {
      let f: number
      let g: number
      let shift: number
      if (i < 16) { f = (b & c) | (~b & d); g = i; shift = shifts[i % 4] }
      else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16; shift = shifts[4 + (i % 4)] }
      else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16; shift = shifts[8 + (i % 4)] }
      else { f = c ^ (b | ~d); g = (7 * i) % 16; shift = shifts[12 + (i % 4)] }
      const previousD = d
      d = c
      c = b
      b = add(b, rotate(add(add(a, f), add(words[offset + g] || 0, constants[i])), shift))
      a = previousD
    }
    state = [add(state[0], a), add(state[1], b), add(state[2], c), add(state[3], d)]
  }

  return state.map(value => {
    let output = ""
    for (let i = 0; i < 4; i += 1) output += ((value >>> (i * 8)) & 0xff).toString(16).padStart(2, "0")
    return output
  }).join("")
}

function requestSign(params: Record<string, string>): string {
  const source = Object.keys(params).sort().reduce((output, key) => {
    const value = params[key]
    return key === "sign" || value === "" ? output : output + key + value
  }, "")
  return md5(source + SIGN_SUFFIX).toUpperCase()
}

function signedUrl(path: string, params: Record<string, string>): string {
  const all: Record<string, string> = { ...params, timestamp: String(Date.now()) }
  const query = Object.keys(all).map(key => `${encodeURIComponent(key)}=${encodeURIComponent(all[key])}`)
  query.push(`sign=${requestSign(all)}`)
  return `${API_BASE}${path}?${query.join("&")}`
}

async function getDatas(path: string, params: Record<string, string>, label: string, credentials: GasCredentials): Promise<any> {
  const url = signedUrl(path, params)
  const headers: Record<string, string> = {
    Accept: "application/json, text/plain, */*",
    Authorization: credentials.authorization,
    "User-Agent": credentials.userAgent || DEFAULT_UA,
  }
  if (credentials.cookie) headers.Cookie = credentials.cookie
  if (credentials.referer) headers.Referer = credentials.referer

  const response = await fetch(url, { headers, timeout: 15 } as any)
  const text = await response.text()
  if (!response.ok) throw new Error(`${label} HTTP ${response.status}: ${text.slice(0, 80)}`)
  let payload: any
  try { payload = JSON.parse(text) } catch (_) { throw new Error(`${label} 返回非 JSON`) }
  if (String(payload?.resultCode) !== "0") {
    throw new Error(String(payload?.resultMsg ?? payload?.message ?? `${label} 返回 ${payload?.resultCode ?? "未知错误"}`).slice(0, 100))
  }
  return payload?.datas
}

function normalizeAccount(data: any): GasAccount {
  const report = Array.isArray(data?.readingRptList) ? data.readingRptList[0] : null
  return {
    subscriberCode: String(data?.subsCode ?? ""),
    subscriberName: String(data?.subsName ?? ""),
    address: String(data?.subsAddr ?? ""),
    chargeType: String(data?.chargeType ?? ""),
    balance: numberValue(data?.savingSum),
    due: numberValue(data?.totalFee),
    currentReading: numberValue(report?.currReading),
  }
}

function normalizeTiers(data: any, annualUsage: number): GasTier[] {
  const rows = Array.isArray(data?.stepList) ? data.stepList : []
  let lower = 0
  return rows.map((row: any, index: number) => {
    const rawUpper = numberValue(row?.maxMount)
    const upper = rawUpper < 0 ? null : rawUpper
    const quota = upper === null ? null : Math.max(0, upper - lower)
    const usedInTier = Math.max(0, upper === null
      ? annualUsage - lower
      : Math.min(annualUsage, upper) - lower)
    const remaining = upper === null ? null : Math.max(0, upper - annualUsage)
    const progress = quota === null ? (annualUsage >= lower ? 1 : 0) : Math.max(0, Math.min(1, usedInTier / Math.max(1, quota)))
    const tier: GasTier = {
      index: index + 1,
      name: String(row?.stepName ?? `第${index + 1}阶梯`),
      price: numberValue(row?.price),
      lower,
      upper,
      usedInTier,
      quota,
      remaining,
      progress,
    }
    if (upper !== null) lower = upper
    return tier
  })
}

function normalizeBill(row: any): GasBill {
  return {
    month: String(row?.yrMonth ?? ""),
    usage: numberValue(row?.amount),
    amount: numberValue(row?.chrgSum),
    unpaid: numberValue(row?.unpaidFee),
    paid: numberValue(row?.paidSum),
    state: String(row?.stateName ?? ""),
    previousReading: numberValue(row?.lastReading),
    currentReading: numberValue(row?.currReading),
    source: String(row?.datasource ?? ""),
    tierLines: (Array.isArray(row?.stepFeeResults) ? row.stepFeeResults : []).map((line: any) => ({
      price: numberValue(line?.price),
      usage: numberValue(line?.amount),
      amount: numberValue(line?.chrgSum),
    })),
  }
}

function normalizeBills(data: any): GasBill[] {
  const months = Array.isArray(data) ? data : []
  const bills: GasBill[] = []
  months.forEach((month: any) => {
    const rows = Array.isArray(month?.gasFeeList) ? month.gasFeeList : []
    rows.forEach((row: any) => {
      if (String(row?.feetype) === "燃气费") bills.push(normalizeBill(row))
    })
  })
  return bills.sort((a, b) => b.month.localeCompare(a.month))
}

export async function queryGas(credentials: GasCredentials): Promise<GasResult> {
  const [accountData, stepData, historyData] = await Promise.all([
    getDatas("/charge/preCheck", { subsId: credentials.subsId }, "账户概览", credentials),
    getDatas("/charge/gasStepFee", { subsId: credentials.subsId, orgId: credentials.orgId }, "阶梯气价", credentials),
    getDatas("/charge/queryHistoryFee", { orgId: credentials.orgId, subsId: credentials.subsId, pageSize: "30", pageIndex: "1" }, "历史账单", credentials),
  ])
  const account = normalizeAccount(accountData)
  const annualUsage = numberValue(stepData?.buyamount)
  const tiers = normalizeTiers(stepData, annualUsage)
  const tier = tiers.find(item => item.upper === null || annualUsage <= item.upper) ?? tiers[tiers.length - 1]
  if (!tier) throw new Error("阶梯气价接口未返回有效阶梯")
  const bills = normalizeBills(historyData)
  const latestReading = bills[0]?.currentReading ?? account.currentReading
  return {
    account,
    annualUsage,
    tier,
    tiers,
    bills,
    unbilledUsage: Math.max(0, account.currentReading - latestReading),
    queriedAt: Date.now(),
  }
}

export function formatMoney(value: number): string {
  return (Math.round(value * 100) / 100).toFixed(2)
}

export function formatUsage(value: number): string {
  const rounded = Math.round(value * 100) / 100
  return Number.isInteger(rounded) ? String(rounded) : String(rounded)
}
