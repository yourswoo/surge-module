import {
  HStack,
  Image,
  Spacer,
  Text,
  VStack,
  Widget,
  modifiers,
} from "scripting"
import { Account, BalanceInfo, buildAccounts, formatMoney, queryAccount } from "./lsep-api"
import { readCookieFromSurge } from "./surge"

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
  surgeApiEnabled: boolean
  surgeApiUrl: string
  surgeApiKey: string
}

type PublicSettings = {
  title: string
  labels: string
  threshold: number
  refreshMinutes: number
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

function loadSecrets(): SecretConfig | null {
  try {
    const raw = Keychain.get(SECRET_KEY)
    return raw ? {
      userAgent: DEFAULT_UA,
      surgeApiEnabled: false,
      surgeApiUrl: "http://127.0.0.1:6171",
      surgeApiKey: "",
      ...JSON.parse(raw),
    } : null
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

type Theme = {
  cardBg: any
  pageText: any
  mutedText: any
}

type RowVisual = {
  color: string
  amount: string
  status: string
}

const THEME: Theme = {
  cardBg: { light: "#FFFFFF", dark: "#1C1C1E" },
  pageText: { light: "#111827", dark: "#FFFFFF" },
  mutedText: { light: "#6B7280", dark: "#A1A1A6" },
}

function shortNumber(number: string): string {
  if (number.length <= 6) return number
  return `${number.slice(0, 4)} · ${number.slice(-4)}`
}

function latestUpdate(results: DisplayResult[]): number {
  const times = results.map(result => result.updatedAt).filter(time => time > 0)
  return times.length ? Math.max(...times) : 0
}

function updateLabel(time: number): string {
  if (!time) return "等待首次查询"
  const diffMinutes = Math.max(0, Math.floor((Date.now() - time) / 60000))
  if (diffMinutes < 1) return "刚刚更新"
  if (diffMinutes < 60) return `${diffMinutes} 分钟前更新`
  const date = new Date(time)
  const hour = String(date.getHours()).padStart(2, "0")
  const minute = String(date.getMinutes()).padStart(2, "0")
  return `更新于 ${hour}:${minute}`
}

function queryStatusColor(results: DisplayResult[]): string {
  if (!results.length || results.some(result => result.source !== "live")) return "#FF9F0A"
  return "#30D158"
}

function rowVisual(result: DisplayResult, threshold: number): RowVisual {
  if (!result.info) {
    return { color: "#8E8E93", amount: "¥ --", status: "等待查询" }
  }
  if (result.info.owe > 0) {
    return { color: "#FF453A", amount: `¥${formatMoney(result.info.owe)}`, status: "欠费" }
  }
  if (threshold > 0 && result.info.prepay < threshold) {
    return { color: "#FF9F0A", amount: `¥${formatMoney(result.info.prepay)}`, status: "余额偏低" }
  }
  return {
    color: result.source === "live" ? "#30D158" : "#8E8E93",
    amount: `¥${formatMoney(result.info.prepay)}`,
    status: result.source === "live" ? "余额正常" : "缓存数据",
  }
}

function Header({ results, compact = false }: { results: DisplayResult[]; compact?: boolean }) {
  const iconSize = compact ? 25 : 30
  return (
    <HStack alignment="center" spacing={7}>
      <Image
        imageUrl="https://yong.ing/ldt.PNG"
        resizable
        scaleToFit
        frame={{ width: iconSize, height: iconSize }}
      />
      <Text
        modifiers={modifiers()
          .font(compact ? 11 : 12)
          .foregroundStyle(THEME.pageText)
          .fontWeight("semibold") as any}
      >
        乐电通
      </Text>
      <Spacer />
      <HStack alignment="center" spacing={5}>
        <Text modifiers={modifiers().font(compact ? 11 : 12).foregroundStyle(queryStatusColor(results) as any) as any}>
          ●
        </Text>
        {!compact ? (
          <Text modifiers={modifiers().font(9).foregroundStyle(THEME.mutedText) as any}>
            {updateLabel(latestUpdate(results))}
          </Text>
        ) : null}
      </HStack>
    </HStack>
  )
}

function SmallRow({ result, threshold }: { result: DisplayResult; threshold: number }) {
  const visual = rowVisual(result, threshold)
  return (
    <HStack
      alignment="center"
      spacing={7}
      modifiers={modifiers()
        .padding({ leading: 9, trailing: 9, top: 7, bottom: 7 })
        .background({ style: THEME.cardBg, shape: { type: "rect", cornerRadius: 12 } } as any)}
    >
      <VStack
        modifiers={modifiers()
          .frame({ width: 3, height: 25 })
          .background({ style: visual.color as any, shape: { type: "rect", cornerRadius: 999 } } as any)}
      />
      <VStack alignment="leading" spacing={1}>
        <Text modifiers={modifiers().font(11).foregroundStyle(THEME.pageText).fontWeight("semibold") as any}>
          {result.account.label}
        </Text>
        <Text modifiers={modifiers().font(8).foregroundStyle(THEME.mutedText) as any}>
          {visual.status}
        </Text>
      </VStack>
      <Spacer />
      <Text modifiers={modifiers().font(11).foregroundStyle(visual.color as any).fontWeight("bold") as any}>
        {visual.amount}
      </Text>
    </HStack>
  )
}

function MediumRow({ result, threshold }: { result: DisplayResult; threshold: number }) {
  const visual = rowVisual(result, threshold)
  return (
    <HStack
      alignment="center"
      spacing={9}
      modifiers={modifiers()
        .padding({ leading: 11, trailing: 11, top: 7, bottom: 7 })
        .background({ style: THEME.cardBg, shape: { type: "rect", cornerRadius: 13 } } as any)}
    >
      <VStack
        modifiers={modifiers()
          .frame({ width: 4, height: 27 })
          .background({ style: visual.color as any, shape: { type: "rect", cornerRadius: 999 } } as any)}
      />
      <VStack alignment="leading" spacing={2}>
        <Text modifiers={modifiers().font(12).foregroundStyle(THEME.pageText).fontWeight("semibold") as any}>
          {result.account.label}
        </Text>
        <Text modifiers={modifiers().font(9).foregroundStyle(THEME.mutedText) as any}>
          户号 {shortNumber(result.account.number)} · {visual.status}
        </Text>
      </VStack>
      <Spacer />
      <Text modifiers={modifiers().font(16).foregroundStyle(visual.color as any).fontWeight("bold") as any}>
        {visual.amount}
      </Text>
    </HStack>
  )
}

function EmptyWidget({ message }: { message: string }) {
  return (
    <VStack
      alignment="leading"
      spacing={8}
      modifiers={modifiers().padding({ leading: 11, trailing: 11, top: 10, bottom: 10 })}
    >
      <Header results={[]} />
      <HStack
        modifiers={modifiers()
          .padding(11)
          .background({ style: THEME.cardBg, shape: { type: "rect", cornerRadius: 13 } } as any)}
      >
        <Text modifiers={modifiers().font(10).foregroundStyle(THEME.mutedText) as any}>{message}</Text>
      </HStack>
    </VStack>
  )
}

function AccessoryWidget({ result, threshold }: { result: DisplayResult; threshold: number }) {
  const visual = rowVisual(result, threshold)
  return Widget.family === "accessoryCircular" ? (
    <VStack spacing={1}>
      <Image systemName="bolt.fill" />
      <Text font="caption" lineLimit={1}>{result.info ? formatMoney(result.info.prepay) : "--"}</Text>
    </VStack>
  ) : (
    <VStack alignment="leading" spacing={2}>
      <Text font="caption">{result.account.label}</Text>
      <Text font="headline" foregroundStyle={visual.color as any}>{visual.amount}</Text>
      <Text font="caption">{visual.status}</Text>
    </VStack>
  )
}

function BalanceWidget({ results, settings }: { results: DisplayResult[]; settings: PublicSettings }) {
  const family = Widget.family
  if (family === "accessoryCircular" || family === "accessoryRectangular") {
    return <AccessoryWidget result={results[0]} threshold={settings.threshold} />
  }

  const small = family === "systemSmall"
  const limit = small ? 2 : family === "systemLarge" ? 7 : 4
  const visible = results.slice(0, limit)

  return small ? (
    <VStack
      alignment="leading"
      spacing={8}
      modifiers={modifiers().padding({ leading: 9, trailing: 9, top: 9, bottom: 9 })}
    >
      <Header results={results} compact />
      <VStack alignment="leading" spacing={6}>
        {visible.map(result => (
          <SmallRow key={result.account.number} result={result} threshold={settings.threshold} />
        ))}
      </VStack>
    </VStack>
  ) : (
    <VStack
      alignment="leading"
      spacing={8}
      modifiers={modifiers().padding({ leading: 11, trailing: 11, top: 10, bottom: 10 })}
    >
      <Header results={results} />
      <VStack alignment="leading" spacing={6}>
        {visible.map(result => (
          <MediumRow key={result.account.number} result={result} threshold={settings.threshold} />
        ))}
      </VStack>
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
    return
  }

  const accounts = buildAccounts({
    numbers: secrets.numbers,
    tokens: secrets.tokens,
    openids: secrets.openids,
    wechaIds: secrets.wechaIds,
    labels: settings.labels,
    title: settings.title,
  })
  if (!accounts.length || accounts.some(account => !account.number || !account.token || !account.openid)) {
    Widget.present(<EmptyWidget message="账户配置不完整，请检查户号、Token 和 OpenID。" />, policy)
    return
  }

  const cache = Storage.get<CacheData>(CACHE_KEY) ?? { items: {} }
  const nextCache: CacheData = { items: { ...cache.items } }
  const results: DisplayResult[] = []
  let cookie = secrets.cookie || ""
  let userAgent = secrets.userAgent || DEFAULT_UA

  if (secrets.surgeApiEnabled && secrets.surgeApiKey) {
    try {
      const synced = await readCookieFromSurge({
        enabled: true,
        apiUrl: secrets.surgeApiUrl,
        apiKey: secrets.surgeApiKey,
      })
      cookie = synced.cookie || cookie
      userAgent = synced.userAgent || userAgent
    } catch (_) {
      // Surge 关闭、API 不可达或尚未抓取 Cookie 时继续使用钥匙串中的备用值。
    }
  }

  for (const account of accounts) {
    try {
      const queried = await queryAccount(account, cookie, userAgent)
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
  if ((cookie && cookie !== secrets.cookie) || userAgent !== secrets.userAgent) {
    Keychain.set(SECRET_KEY, JSON.stringify({ ...secrets, cookie, userAgent }), {
      accessibility: "first_unlock_this_device",
    })
  }

  Widget.present(<BalanceWidget results={results} settings={settings} />, policy)
}

main()
