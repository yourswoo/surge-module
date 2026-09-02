import { fetch } from "scripting"

const API_HOST = "weixin.towngasvcc.com"
const DEFAULT_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.49 NetType/WIFI Language/zh_CN"

export type GasCredentials = {
  authorization: string
  cookie: string
  userAgent: string
  referer: string
  precheckUrl: string
  stepUrl: string
  historyUrl: string
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

function validateQueryUrl(raw: string, endpoint: string): string {
  let url: URL
  try { url = new URL(raw) } catch (_) { throw new Error(`${endpoint} URL 无效，请重新抓取`) }
  if (url.protocol !== "https:" || url.hostname !== API_HOST) {
    throw new Error(`${endpoint} URL 不属于港华燃气官方域名`)
  }
  const expected = `/nv1/vcc-cbs/charge/${endpoint}`
  if (url.pathname !== expected) throw new Error(`${endpoint} URL 路径不正确`)
  if (!url.searchParams.get("timestamp") || !url.searchParams.get("sign")) {
    throw new Error(`${endpoint} URL 缺少 timestamp/sign，请重新抓取`)
  }
  return url.toString()
}

async function getDatas(rawUrl: string, endpoint: string, credentials: GasCredentials): Promise<any> {
  const url = validateQueryUrl(rawUrl, endpoint)
  const headers: Record<string, string> = {
    Accept: "application/json, text/plain, */*",
    Authorization: credentials.authorization,
    "User-Agent": credentials.userAgent || DEFAULT_UA,
  }
  if (credentials.cookie) headers.Cookie = credentials.cookie
  if (credentials.referer) headers.Referer = credentials.referer

  const response = await fetch(url, { headers, timeout: 15 } as any)
  const text = await response.text()
  if (!response.ok) throw new Error(`${endpoint} HTTP ${response.status}: ${text.slice(0, 80)}`)
  let payload: any
  try { payload = JSON.parse(text) } catch (_) { throw new Error(`${endpoint} 返回非 JSON`) }
  if (String(payload?.resultCode) !== "0") {
    throw new Error(String(payload?.resultMsg ?? payload?.message ?? `${endpoint} 返回 ${payload?.resultCode ?? "未知错误"}`).slice(0, 100))
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
    getDatas(credentials.precheckUrl, "preCheck", credentials),
    getDatas(credentials.stepUrl, "gasStepFee", credentials),
    getDatas(credentials.historyUrl, "queryHistoryFee", credentials),
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
