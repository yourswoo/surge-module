import {
  HStack,
  Image,
  Keychain,
  Request,
  Script,
  Spacer,
  Storage,
  Text,
  VStack,
  Widget,
} from "scripting"

const HOST = "http://lsep.wegist.cn"
const SECRET_KEY = "lsep_widget_secrets_v1"
const SETTINGS_KEY = "lsep_widget_settings_v1"
const CACHE_KEY = "lsep_widget_cache_v1"
const DEFAULT_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.49(0x18003123) NetType/WIFI Language/zh_CN"

type SecretConfig = {
  numbers: string
  tokens: string
  openids: string
  wechaIds: string
  cookie: string
  userAgent: string
}

type PublicSettings = {
  title: string
  labels: string
  threshold: number
  refreshMinutes: number
}

type Account = {
  label: string
  number: string
  token: string
  openid: string
  wechaId: string
}

type BalanceInfo = {
  value: number
  owe: number
  prepay: number
  name: string
  code: string
  meterTime: number
}

type DisplayResult = {
  account: Account
  info: BalanceInfo | null
  source: "live" | "cache" | "none"
  updatedAt: number
  error?: string
}

type CacheData = {
  items: Record<string, { info: BalanceInfo; updatedAt: number }>
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

function loadSecrets(): SecretConfig | null {
  try {
    const raw = Keychain.get(SECRET_KEY)
    return raw ? { userAgent: DEFAULT_UA, ...JSON.parse(raw) } : null
  } catch (_) {
    return null
  }
}

function loadSettings(): PublicSettings {
  return {
    title: "电费余额",
    labels: "",
    threshold: 20,
    refreshMinutes: 30,
    ...(Storage.get<PublicSettings>(SETTINGS_KEY) ?? {}),
  }
}

function buildAccounts(secrets: SecretConfig, settings: PublicSettings): Account[] {
  const numbers = splitList(secrets.numbers)
  const tokens = splitList(secrets.tokens, true)
  const openids = splitList(secrets.openids, true)
  const wechaIds = splitList(secrets.wechaIds, true)
  const labels = splitList(settings.labels, true)

  return numbers.map((number, index) => {
    const openid = pick(openids, index) || pick(wechaIds, index)
    const wechaId = pick(wechaIds, index) || openid
    return {
      number,
      token: pick(tokens, index),
      openid,
      wechaId,
      label: labels[index] || (numbers.length > 1 ? `户 ${index + 1}` : settings.title),
    }
  })
}

function pageUrl(account: Account): string {
  return `${HOST}/index.php?g=Wap&m=Payment&a=all&token=${encodeURIComponent(account.token)}&wecha_id=${encodeURIComponent(account.wechaId)}&number=${encodeURIComponent(account.number)}`
}

function gateUrl(account: Account): string {
  return `${HOST}/index.php?g=Wap&m=Bound&a=getApi&token=${encodeURIComponent(account.token)}&method=queryArrears`
}

function parseCookie(value: string): Record<string, string> {
  const result: Record<string, string> = {}
  value.split(";").forEach(part => {
    const index = part.indexOf("=")
    if (index > 0) result[part.slice(0, index).trim()] = part.slice(index + 1).trim()
  })
  return result
}

function normalizeCookie(value: string): string {
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
  const response = await fetch(new Request(url, {
    ...init,
    allowInsecureRequest: true,
    timeout: init.timeout ?? 12,
  }))
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

async function fetchGate(account: Account, cookie: string, userAgent: string): Promise<{ gate: any; cookie: string }> {
  const headers: Record<string, string> = {
    "User-Agent": userAgent,
    Accept: "application/json, text/javascript, */*; q=0.01",
    "Accept-Language": "zh-CN,zh;q=0.9",
    "X-Requested-With": "XMLHttpRequest",
    Referer: pageUrl(account),
  }
  if (cookie) headers.Cookie = cookie

  const { response, body } = await request(gateUrl(account), { headers, debugLabel: "乐电通 getApi" })
  const nextCookie = mergeResponseCookies(cookie, response)
  const json = parseJson(body, "getApi")
  if (String(json.code) !== "9999" || !json.data?.url || !json.data?.extend) {
    throw new Error(`getApi：${String(json.msg ?? "会话无效").slice(0, 60)}`)
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

async function queryAccount(account: Account, initialCookie: string, userAgent: string): Promise<{ info: BalanceInfo; cookie: string }> {
  let cookie = normalizeCookie(initialCookie)
  let gate: any

  try {
    const result = await fetchGate(account, cookie, userAgent)
    gate = result.gate
    cookie = result.cookie
  } catch (_) {
    cookie = await visitPaymentPage(account, cookie, userAgent)
    const result = await fetchGate(account, cookie, userAgent)
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

function formatMoney(value: number): string {
  return (Math.round(value * 100) / 100).toFixed(2)
}

function formatTime(timestamp: number): string {
  if (!timestamp) return "未知"
  const date = new Date(timestamp)
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function statusColor(result: DisplayResult, threshold: number): string {
  if (!result.info || result.source === "none") return "systemGray"
  if (result.info.owe > 0) return "systemRed"
  if (threshold > 0 && result.info.prepay < threshold) return "systemOrange"
  return result.source === "live" ? "systemGreen" : "systemGray"
}

function balanceText(result: DisplayResult): string {
  if (!result.info) return "暂不可用"
  return result.info.owe > 0
    ? `欠费 ¥${formatMoney(result.info.owe)}`
    : `¥${formatMoney(result.info.prepay)}`
}

function EmptyWidget({ message }: { message: string }) {
  return (
    <VStack
      alignment="leading"
      spacing={8}
      padding={14}
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      widgetBackground={{ light: "#F4F7FF", dark: "#111827" }}
    >
      <Image systemName="bolt.slash.fill" foregroundStyle="systemOrange" />
      <Text font="headline">乐电通</Text>
      <Text font="caption" foregroundStyle="secondaryLabel">{message}</Text>
    </VStack>
  )
}

function AccountRow({ result, threshold }: { result: DisplayResult; threshold: number }) {
  return (
    <HStack spacing={8}>
      <Image
        systemName={result.info?.owe ? "exclamationmark.bolt.fill" : "bolt.fill"}
        foregroundStyle={statusColor(result, threshold)}
      />
      <VStack alignment="leading" spacing={2}>
        <Text font="headline" lineLimit={1}>{result.account.label}</Text>
        <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>
          {result.info?.name || `户号 ${result.account.number}`}
        </Text>
      </VStack>
      <Spacer />
      <VStack alignment="trailing" spacing={2}>
        <Text font="headline" foregroundStyle={statusColor(result, threshold)}>{balanceText(result)}</Text>
        <Text font="caption" foregroundStyle="secondaryLabel">
          {result.source === "live" ? "实时" : result.source === "cache" ? "缓存" : "失败"}
        </Text>
      </VStack>
    </HStack>
  )
}

function AccessoryWidget({ result, threshold }: { result: DisplayResult; threshold: number }) {
  const circular = Widget.family === "accessoryCircular"
  return circular ? (
    <VStack spacing={1}>
      <Image systemName="bolt.fill" />
      <Text font="caption" lineLimit={1}>{result.info ? formatMoney(result.info.prepay) : "--"}</Text>
    </VStack>
  ) : (
    <VStack alignment="leading" spacing={2}>
      <Text font="caption">{result.account.label}</Text>
      <Text font="headline" foregroundStyle={statusColor(result, threshold)}>{balanceText(result)}</Text>
      <Text font="caption">{formatTime(result.updatedAt)}</Text>
    </VStack>
  )
}

function BalanceWidget({ results, settings }: { results: DisplayResult[]; settings: PublicSettings }) {
  const family = Widget.family
  const first = results[0]
  if (family === "accessoryCircular" || family === "accessoryRectangular") {
    return <AccessoryWidget result={first} threshold={settings.threshold} />
  }

  const small = family === "systemSmall"
  const limit = small ? 1 : family === "systemLarge" ? 8 : 4
  const visible = results.slice(0, limit)
  const overallColor = results.some(result => result.info?.owe)
    ? "systemRed"
    : results.some(result => result.info && settings.threshold > 0 && result.info.prepay < settings.threshold)
      ? "systemOrange"
      : "systemGreen"

  return (
    <VStack
      alignment="leading"
      spacing={small ? 7 : 9}
      padding={14}
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      widgetBackground={{ light: "#F4F7FF", dark: "#111827" }}
    >
      <HStack>
        <Image systemName="bolt.circle.fill" foregroundStyle={overallColor} />
        <Text font="headline">{settings.title}</Text>
        <Spacer />
        <Text font="caption" foregroundStyle="secondaryLabel">{formatTime(Date.now())}</Text>
      </HStack>

      {small ? (
        <VStack alignment="leading" spacing={5}>
          <Text font="caption" foregroundStyle="secondaryLabel">{first.account.label}</Text>
          <Text font="largeTitle" foregroundStyle={statusColor(first, settings.threshold)} lineLimit={1}>
            {balanceText(first)}
          </Text>
          <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={2}>
            {first.info?.owe
              ? "账户已欠费，请及时充值"
              : first.source === "cache"
                ? `缓存于 ${formatTime(first.updatedAt)}`
                : `抄表 ${formatTime(first.info?.meterTime ?? 0)}`}
          </Text>
        </VStack>
      ) : visible.map(result => (
        <AccountRow key={result.account.number} result={result} threshold={settings.threshold} />
      ))}

      <Spacer />
      <Text font="caption" foregroundStyle="secondaryLabel">
        {results.some(result => result.source !== "live") ? "部分数据来自缓存 · " : ""}下次刷新由 iOS 安排
      </Text>
    </VStack>
  )
}

function reloadPolicy(minutes: number): any {
  if (!(minutes > 0)) return { policy: "atEnd" }
  return {
    policy: "after",
    date: new Date(Date.now() + Math.max(15, minutes) * 60 * 1000),
  }
}

async function main() {
  const settings = loadSettings()
  const secrets = loadSecrets()
  const policy = reloadPolicy(settings.refreshMinutes)

  if (!secrets) {
    Widget.present(<EmptyWidget message="请先在 Scripting 中运行本项目，填写账户配置。" />, policy)
    Script.exit()
    return
  }

  const accounts = buildAccounts(secrets, settings)
  if (!accounts.length || accounts.some(account => !account.number || !account.token || !account.openid)) {
    Widget.present(<EmptyWidget message="账户配置不完整，请检查户号、Token 和 OpenID。" />, policy)
    Script.exit()
    return
  }

  const cache = Storage.get<CacheData>(CACHE_KEY) ?? { items: {} }
  const nextCache: CacheData = { items: { ...cache.items } }
  const results: DisplayResult[] = []
  let cookie = secrets.cookie || ""

  for (const account of accounts) {
    try {
      const queried = await queryAccount(account, cookie, secrets.userAgent || DEFAULT_UA)
      cookie = queried.cookie || cookie
      const updatedAt = Date.now()
      nextCache.items[account.number] = { info: queried.info, updatedAt }
      results.push({ account, info: queried.info, source: "live", updatedAt })
    } catch (error) {
      const cached = cache.items[account.number]
      results.push({
        account,
        info: cached?.info ?? null,
        source: cached ? "cache" : "none",
        updatedAt: cached?.updatedAt ?? 0,
        error: String((error as any)?.message ?? error),
      })
    }
  }

  Storage.set(CACHE_KEY, nextCache)
  if (cookie && cookie !== secrets.cookie) {
    Keychain.set(SECRET_KEY, JSON.stringify({ ...secrets, cookie }), {
      accessibility: "first_unlock_this_device",
    })
  }

  Widget.present(<BalanceWidget results={results} settings={settings} />, policy)
  Script.exit()
}

main()
