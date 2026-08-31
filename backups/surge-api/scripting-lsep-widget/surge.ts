import { fetch } from "scripting"

export type SurgeSyncConfig = {
  enabled: boolean
  apiUrl: string
  apiKey: string
}

export type SurgeCookieResult = {
  cookie: string
  userAgent: string
}

const COOKIE_STORE_KEY = "lsep_balance_cookie"
const UA_STORE_KEY = "lsep_balance_ua"

function normalizeApiUrl(value: string): string {
  const url = value.trim().replace(/\/+$/, "")
  if (!/^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/i.test(url)) {
    throw new Error("Surge API 地址只能使用本机 127.0.0.1 或 localhost")
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

function readScript(): string {
  return `
const payload = {
  cookie: $persistentStore.read(${JSON.stringify(COOKIE_STORE_KEY)}) || "",
  userAgent: $persistentStore.read(${JSON.stringify(UA_STORE_KEY)}) || ""
};
$done({
  response: {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(payload)
  }
});`
}

function findPayload(value: unknown, depth = 0): SurgeCookieResult | null {
  if (depth > 8 || value == null) return null

  if (typeof value === "string") {
    const cookie = normalizeCookie(value)
    let parsed: unknown = null
    const trimmed = value.trim()
    if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
      try { parsed = JSON.parse(trimmed) } catch (_) {}
    }
    const nested = parsed == null ? null : findPayload(parsed, depth + 1)
    return nested ?? (cookie ? { cookie, userAgent: "" } : null)
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findPayload(item, depth + 1)
      if (found) return found
    }
    return null
  }

  if (typeof value === "object") {
    const object = value as Record<string, unknown>
    const cookie = normalizeCookie(String(object.cookie ?? ""))
    if (cookie) {
      return {
        cookie,
        userAgent: typeof object.userAgent === "string" ? object.userAgent : "",
      }
    }
    for (const item of Object.values(object)) {
      const found = findPayload(item, depth + 1)
      if (found) return found
    }
  }
  return null
}

export async function readCookieFromSurge(config: SurgeSyncConfig): Promise<SurgeCookieResult> {
  if (!config.enabled) throw new Error("尚未启用 Surge 自动同步")
  if (!config.apiKey.trim()) throw new Error("请填写 Surge API 密钥")

  const response = await fetch(`${normalizeApiUrl(config.apiUrl)}/v1/scripting/evaluate`, {
    method: "POST",
    headers: {
      "X-Key": config.apiKey.trim(),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      script_text: readScript(),
      mock_type: "http-request",
      timeout: 5,
    }),
    allowInsecureRequest: true,
    timeout: 8,
  })

  const text = await response.text()
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new Error("Surge API 密钥不正确")
    throw new Error(`Surge API 返回 HTTP ${response.status}`)
  }

  let body: unknown = text
  try { body = JSON.parse(text) } catch (_) {}
  const result = findPayload(body)
  if (!result?.cookie) {
    throw new Error("Surge 已连接，但没有返回已抓取的 Cookie")
  }
  return result
}
