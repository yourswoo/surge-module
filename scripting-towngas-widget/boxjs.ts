import { fetch } from "scripting"
import { GasCredentials } from "./towngas-api"

export type RuntimeConfig = {
  credentials: GasCredentials
  label: string
  title: string
  lowBalanceThreshold: number
  criticalBalanceThreshold: number
  refreshMinutes: number
  capturedAt: string
}

const KEYS = {
  authorization: "towngas_authorization",
  cookie: "towngas_cookie",
  userAgent: "towngas_ua",
  referer: "towngas_referer",
  subsId: "towngas_subs_id",
  orgId: "towngas_org_id",
  label: "towngas_label",
  title: "towngas_title",
  lowBalanceThreshold: "towngas_balance_threshold",
  criticalBalanceThreshold: "towngas_balance_critical_threshold",
  refreshMinutes: "towngas_refresh_minutes",
  capturedAt: "towngas_captured_at",
} as const

function normalizeBaseUrl(value: string): string {
  const url = value.trim().replace(/\/+$/, "")
  if (!/^https?:\/\/boxjs\.com$/i.test(url)) throw new Error("BoxJS 地址只能使用 http://boxjs.com 或 https://boxjs.com")
  return url
}

function numberSetting(value: string, fallback: number): number {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

async function readValue(baseUrl: string, key: string): Promise<string> {
  const response = await fetch(`${normalizeBaseUrl(baseUrl)}/query/data/${encodeURIComponent(key)}`, {
    headers: { Accept: "application/json" },
    timeout: 8,
  } as any)
  if (!response.ok) throw new Error(`读取 ${key} 时 BoxJS 返回 HTTP ${response.status}`)
  const payload = await response.json() as any
  const value = payload?.val ?? payload?.value ?? ""
  return typeof value === "string" ? value.trim() : String(value ?? "").trim()
}

export async function readRuntimeConfig(baseUrl: string): Promise<RuntimeConfig> {
  const names = Object.keys(KEYS) as Array<keyof typeof KEYS>
  const values = await Promise.all(names.map(name => readValue(baseUrl, KEYS[name])))
  const raw = Object.fromEntries(names.map((name, index) => [name, values[index]])) as Record<keyof typeof KEYS, string>
  const missing: string[] = []
  if (!/^Bearer\s+\S+/i.test(raw.authorization)) missing.push(KEYS.authorization)
  if (!raw.subsId) missing.push(KEYS.subsId)
  if (!raw.orgId) missing.push(KEYS.orgId)
  if (missing.length) throw new Error(`BoxJS 配置缺失：${missing.join("、")}`)

  const low = Math.max(0, numberSetting(raw.lowBalanceThreshold, 100))
  const critical = Math.max(0, numberSetting(raw.criticalBalanceThreshold, 50))
  return {
    credentials: {
      authorization: raw.authorization,
      cookie: raw.cookie,
      userAgent: raw.userAgent,
      referer: raw.referer,
      subsId: raw.subsId,
      orgId: raw.orgId,
    },
    label: raw.label || "我家燃气",
    title: raw.title || "港华燃气",
    lowBalanceThreshold: Math.max(low, critical),
    criticalBalanceThreshold: Math.min(low, critical),
    refreshMinutes: Math.max(0, numberSetting(raw.refreshMinutes, 30)),
    capturedAt: raw.capturedAt,
  }
}
