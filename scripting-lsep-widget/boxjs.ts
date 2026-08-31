import { fetch } from "scripting"

export type BoxJsConfig = {
  baseUrl: string
}

export type BoxJsRuntimeConfig = {
  numbers: string
  tokens: string
  openids: string
  wechaIds: string
  labels: string
  cookie: string
  userAgent: string
  title: string
  threshold: number
}

const KEYS = {
  numbers: "lsep_balance_number",
  tokens: "lsep_balance_token",
  openids: "lsep_balance_openid",
  wechaIds: "lsep_balance_wechaId",
  labels: "lsep_balance_label",
  cookie: "lsep_balance_cookie",
  userAgent: "lsep_balance_ua",
  title: "lsep_balance_title",
  threshold: "lsep_balance_threshold",
} as const

function normalizeBaseUrl(value: string): string {
  const url = value.trim().replace(/\/+$/, "")
  if (!/^https?:\/\/boxjs\.com$/i.test(url)) {
    throw new Error("BoxJs 地址只能使用 http://boxjs.com 或 https://boxjs.com")
  }
  return url
}

function normalizeCookie(value: string): string {
  const selected: Record<string, string> = {}
  value.split(";").forEach(part => {
    const index = part.indexOf("=")
    if (index <= 0) return
    const name = part.slice(0, index).trim()
    if (name === "PHPSESSID" || name === "tgw_l7_route") {
      selected[name] = part.slice(index + 1).trim()
    }
  })
  return ["PHPSESSID", "tgw_l7_route"]
    .filter(name => selected[name])
    .map(name => `${name}=${selected[name]}`)
    .join("; ")
}

async function readBoxJsValue(baseUrl: string, key: string): Promise<string> {
  const response = await fetch(`${normalizeBaseUrl(baseUrl)}/query/data/${encodeURIComponent(key)}`, {
    headers: { Accept: "application/json" },
    timeout: 8,
  } as any)
  if (!response.ok) throw new Error(`读取 ${key} 时 BoxJs 返回 HTTP ${response.status}`)

  const payload = await response.json() as any
  const value = payload?.val ?? payload?.value ?? ""
  return typeof value === "string" ? value.trim() : String(value ?? "").trim()
}

export async function readRuntimeConfigFromBoxJs(config: BoxJsConfig): Promise<BoxJsRuntimeConfig> {
  const names = Object.keys(KEYS) as Array<keyof typeof KEYS>
  const values = await Promise.all(names.map(name => readBoxJsValue(config.baseUrl, KEYS[name])))
  const raw = Object.fromEntries(names.map((name, index) => [name, values[index]])) as Record<keyof typeof KEYS, string>
  const cookie = normalizeCookie(raw.cookie)

  const missing: string[] = []
  if (!raw.numbers) missing.push(KEYS.numbers)
  if (!raw.tokens) missing.push(KEYS.tokens)
  if (!raw.openids && !raw.wechaIds) missing.push(`${KEYS.openids}/${KEYS.wechaIds}`)
  if (!cookie) missing.push(KEYS.cookie)
  if (missing.length) throw new Error(`BoxJs 配置缺失或无效：${missing.join("、")}`)

  const parsedThreshold = Number(raw.threshold)
  return {
    numbers: raw.numbers,
    tokens: raw.tokens,
    openids: raw.openids,
    wechaIds: raw.wechaIds,
    labels: raw.labels,
    cookie,
    userAgent: raw.userAgent,
    title: raw.title || "电费余额",
    threshold: Number.isFinite(parsedThreshold) ? Math.max(0, parsedThreshold) : 20,
  }
}
