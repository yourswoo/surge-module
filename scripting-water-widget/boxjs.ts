import { fetch } from "scripting"
import { WaterCredentials } from "./water-api"

export type RuntimeConfig = {
  credentials: WaterCredentials
  label: string
  title: string
  months: number
  refreshMinutes: number
  lowBalanceThreshold: number
  criticalBalanceThreshold: number
  capturedAt: string
}

const KEYS = {
  appId: "water_bill_appid",
  openId: "water_bill_openid",
  customerId: "water_bill_customerid",
  cookie: "water_bill_cookie",
  userAgent: "water_bill_ua",
  capturedAt: "water_bill_captured_at",
  label: "water_bill_label",
  title: "water_bill_title",
  months: "water_bill_months",
  refreshMinutes: "water_bill_refresh_minutes",
  lowBalanceThreshold: "water_bill_balance_threshold",
  criticalBalanceThreshold: "water_bill_balance_critical_threshold",
} as const

function normalizeBaseUrl(value: string): string {
  const url = value.trim().replace(/\/+$/, "")
  if (!/^https?:\/\/boxjs\.com$/i.test(url)) {
    throw new Error("BoxJS 地址只能使用 http://boxjs.com 或 https://boxjs.com")
  }
  return url
}

async function readValue(baseUrl: string, key: string): Promise<string> {
  const response = await fetch(`${normalizeBaseUrl(baseUrl)}/query/data/${encodeURIComponent(key)}`, {
    headers: { Accept: "application/json" },
    timeout: 8,
  } as any)
  if (!response.ok) throw new Error(`读取 ${key} 时 BoxJS 返回 HTTP ${response.status}`)
  const payload = await response.json() as any
  const value = payload?.val ?? payload?.value ?? ""
  return String(value ?? "").trim()
}

function boundedNumber(value: string, fallback: number, min: number, max: number): number {
  if (!value.trim()) return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.round(parsed))) : fallback
}

function thresholdNumber(value: string, fallback: number): number {
  if (!value.trim()) return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback
}

export async function readRuntimeConfig(baseUrl: string): Promise<RuntimeConfig> {
  const names = Object.keys(KEYS) as Array<keyof typeof KEYS>
  const values = await Promise.all(names.map(name => readValue(baseUrl, KEYS[name])))
  const raw = Object.fromEntries(names.map((name, index) => [name, values[index]])) as Record<keyof typeof KEYS, string>

  const missing: string[] = []
  if (!raw.appId) missing.push(KEYS.appId)
  if (!raw.openId) missing.push(KEYS.openId)
  if (!raw.customerId) missing.push(KEYS.customerId)
  if (missing.length) throw new Error(`BoxJS 配置缺失：${missing.join("、")}`)

  const configuredLow = thresholdNumber(raw.lowBalanceThreshold, 100)
  const configuredCritical = thresholdNumber(raw.criticalBalanceThreshold, 50)

  return {
    credentials: {
      appId: raw.appId,
      openId: raw.openId,
      customerId: raw.customerId,
      cookie: raw.cookie,
      userAgent: raw.userAgent,
    },
    label: !raw.label || raw.label === "我家水费" ? "四川濯缨科技" : raw.label,
    title: !raw.title || raw.title === "水费" ? "水费查询" : raw.title,
    months: boundedNumber(raw.months, 6, 1, 24),
    refreshMinutes: boundedNumber(raw.refreshMinutes, 30, 0, 1440),
    lowBalanceThreshold: Math.max(configuredLow, configuredCritical),
    criticalBalanceThreshold: Math.min(configuredLow, configuredCritical),
    capturedAt: raw.capturedAt,
  }
}
