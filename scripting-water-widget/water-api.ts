import { fetch } from "scripting"

const HOST = "https://wx.chinayunrun.com:80"
const DEFAULT_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.49 NetType/WIFI Language/zh_CN"

export type WaterCredentials = {
  appId: string
  openId: string
  customerId: string
  cookie: string
  userAgent: string
}

export type AccountInfo = {
  customerNo: string
  customerName: string
  customerAddress: string
  balance: number
  receivable: number
  currentAmount: number
  currentUsage: number
  billMonth: string
  createdAt: string
}

export type BillInfo = {
  month: string
  startReading: number
  endReading: number
  usage: number
  amount: number
  paid: boolean
  status: string
  meterCode: string
  meterState: string
  createdAt: string
}

export type WaterResult = {
  account: AccountInfo
  bills: BillInfo[]
  queriedAt: number
}

function form(values: Record<string, string>): string {
  return Object.keys(values)
    .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(values[key])}`)
    .join("&")
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
}

function monthRange(months: number): { start: string; end: string } {
  const now = new Date()
  const safeMonths = Math.max(1, Math.min(24, Math.round(months) || 6))
  return {
    start: monthKey(new Date(now.getFullYear(), now.getMonth() - safeMonths + 1, 1)),
    end: monthKey(now),
  }
}

function numberValue(value: unknown): number {
  const parsed = Number.parseFloat(String(value ?? "0"))
  return Number.isFinite(parsed) ? parsed : 0
}

async function post(path: string, credentials: WaterCredentials, values: Record<string, string>): Promise<any> {
  const headers: Record<string, string> = {
    Accept: "application/json, text/plain, */*",
    "Content-Type": "application/x-www-form-urlencoded",
    Origin: HOST,
    Referer: `${HOST}/water_bill?aid=${encodeURIComponent(credentials.appId)}`,
    "User-Agent": credentials.userAgent || DEFAULT_UA,
  }
  if (credentials.cookie) headers.Cookie = credentials.cookie

  const response = await fetch(`${HOST}${path}`, {
    method: "POST",
    headers,
    body: form(values),
    timeout: 15,
    allowInsecureRequest: true,
  } as any)
  const text = await response.text()
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 80)}`)

  let payload: any
  try { payload = JSON.parse(text) } catch (_) { throw new Error(`${path} 返回非 JSON 数据`) }
  if (Number(payload?.code) !== 200) {
    throw new Error(String(payload?.msg || `接口返回 code ${payload?.code ?? "未知"}`).slice(0, 100))
  }
  return payload.data
}

function baseValues(credentials: WaterCredentials): Record<string, string> {
  return {
    appId: credentials.appId,
    openId: credentials.openId,
    customerId: credentials.customerId,
  }
}

function normalizeAccount(data: any): AccountInfo {
  return {
    customerNo: String(data?.customerNo ?? ""),
    customerName: String(data?.customerName ?? ""),
    customerAddress: String(data?.customerAddress ?? ""),
    balance: numberValue(data?.restMoney),
    receivable: numberValue(data?.receivableMoney),
    currentAmount: numberValue(data?.waterMount),
    currentUsage: numberValue(data?.totaluse),
    billMonth: String(data?.billMonth ?? ""),
    createdAt: String(data?.createDate ?? data?.billTime ?? ""),
  }
}

function normalizeBill(data: any): BillInfo {
  return {
    month: String(data?.billMonth ?? ""),
    startReading: numberValue(data?.startNum),
    endReading: numberValue(data?.stopNum),
    usage: numberValue(data?.totaluse),
    amount: numberValue(data?.waterMount),
    paid: String(data?.chargeState) === "1" || String(data?.chargeStateValue).includes("已缴"),
    status: String(data?.chargeStateValue ?? data?.chargeStateName ?? "未知"),
    meterCode: String(data?.meterCode ?? ""),
    meterState: String(data?.meterState ?? ""),
    createdAt: String(data?.billSetDate ?? ""),
  }
}

export async function queryWater(credentials: WaterCredentials, months = 6): Promise<WaterResult> {
  const range = monthRange(months)
  const [accountData, billData] = await Promise.all([
    post("/wechat/billCharge", credentials, baseValues(credentials)),
    post("/wechat/billMsg/findBillList", credentials, {
      ...baseValues(credentials),
      billStartTime: range.start,
      billEndTime: range.end,
    }),
  ])

  const bills = (Array.isArray(billData) ? billData : [])
    .map(normalizeBill)
    .filter(item => item.month)
    .sort((a, b) => b.month.localeCompare(a.month))

  return { account: normalizeAccount(accountData), bills, queriedAt: Date.now() }
}

export function formatMoney(value: number): string {
  return (Math.round(value * 100) / 100).toFixed(2)
}

export function formatUsage(value: number): string {
  const rounded = Math.round(value * 1000) / 1000
  return Number.isInteger(rounded) ? String(rounded) : String(rounded)
}

