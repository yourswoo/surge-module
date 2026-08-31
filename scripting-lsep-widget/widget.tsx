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
import { readRuntimeConfigFromBoxJs } from "./boxjs"

const SETTINGS_KEY = "lsep_widget_settings_v2"
const CACHE_KEY = "lsep_widget_cache_v2"
const DEFAULT_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.49(0x18003123) NetType/WIFI Language/zh_CN"

type LocalSettings = {
  boxJsUrl: string
  refreshMinutes: number
  lowBalanceThreshold: number
  criticalBalanceThreshold: number
}

type PublicSettings = {
  title: string
  labels: string
  lowBalanceThreshold: number
  criticalBalanceThreshold: number
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

function loadLocalSettings(): LocalSettings {
  return {
    boxJsUrl: "https://boxjs.com",
    refreshMinutes: 30,
    lowBalanceThreshold: 20,
    criticalBalanceThreshold: 10,
    ...(Storage.get<LocalSettings>(SETTINGS_KEY) ?? {}),
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

function rowVisual(result: DisplayResult, lowThreshold: number, criticalThreshold: number): RowVisual {
  if (!result.info) {
    return { color: "#8E8E93", amount: "¥ --", status: "等待查询" }
  }
  if (result.info.owe > 0) {
    return { color: "#FF453A", amount: `¥${formatMoney(result.info.owe)}`, status: "欠费，请及时充值" }
  }
  if (criticalThreshold > 0 && result.info.prepay <= criticalThreshold) {
    return { color: "#FF453A", amount: `¥${formatMoney(result.info.prepay)}`, status: "余额不足，请及时充值" }
  }
  if (lowThreshold > 0 && result.info.prepay < lowThreshold) {
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

function SmallRow({ result, lowThreshold, criticalThreshold }: { result: DisplayResult; lowThreshold: number; criticalThreshold: number }) {
  const visual = rowVisual(result, lowThreshold, criticalThreshold)
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

function MediumRow({ result, lowThreshold, criticalThreshold }: { result: DisplayResult; lowThreshold: number; criticalThreshold: number }) {
  const visual = rowVisual(result, lowThreshold, criticalThreshold)
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

function AccessoryWidget({ result, lowThreshold, criticalThreshold }: { result: DisplayResult; lowThreshold: number; criticalThreshold: number }) {
  const visual = rowVisual(result, lowThreshold, criticalThreshold)
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
    return <AccessoryWidget result={results[0]} lowThreshold={settings.lowBalanceThreshold} criticalThreshold={settings.criticalBalanceThreshold} />
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
          <SmallRow key={result.account.number} result={result} lowThreshold={settings.lowBalanceThreshold} criticalThreshold={settings.criticalBalanceThreshold} />
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
          <MediumRow key={result.account.number} result={result} lowThreshold={settings.lowBalanceThreshold} criticalThreshold={settings.criticalBalanceThreshold} />
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
  const localSettings = loadLocalSettings()
  const policy = reloadPolicy(localSettings.refreshMinutes)
  let runtime: Awaited<ReturnType<typeof readRuntimeConfigFromBoxJs>>
  try {
    runtime = await readRuntimeConfigFromBoxJs({ baseUrl: localSettings.boxJsUrl })
  } catch (error) {
    Widget.present(<EmptyWidget message={`BoxJs 读取失败：${String((error as any)?.message ?? error)}`} />, policy)
    return
  }

  const accounts = buildAccounts({
    numbers: runtime.numbers,
    tokens: runtime.tokens,
    openids: runtime.openids,
    wechaIds: runtime.wechaIds,
    labels: runtime.labels,
    title: runtime.title,
  })
  if (!accounts.length || accounts.some(account => !account.number || !account.token || !account.openid)) {
    Widget.present(<EmptyWidget message="BoxJs 账户配置不完整，请检查户号、Token 和 OpenID/身份标识。" />, policy)
    return
  }

  const settings: PublicSettings = {
    title: runtime.title,
    labels: runtime.labels,
    lowBalanceThreshold: Math.max(localSettings.lowBalanceThreshold, localSettings.criticalBalanceThreshold),
    criticalBalanceThreshold: Math.min(localSettings.lowBalanceThreshold, localSettings.criticalBalanceThreshold),
    refreshMinutes: localSettings.refreshMinutes,
  }

  const cache = Storage.get<CacheData>(CACHE_KEY) ?? { items: {} }
  const nextCache: CacheData = { items: { ...cache.items } }
  const results: DisplayResult[] = []
  let cookie = runtime.cookie
  const userAgent = runtime.userAgent || DEFAULT_UA

  for (const account of accounts) {
    let queried: Awaited<ReturnType<typeof queryAccount>> | null = null
    let queryError: unknown = null
    try {
      queried = await queryAccount(account, cookie, userAgent)
    } catch (error) {
      queryError = error
    }

    if (queried) {
      cookie = queried.cookie || cookie
      const updatedAt = Date.now()
      nextCache.items[account.number] = { info: queried.info, updatedAt }
      results.push({ account, info: queried.info, source: "live", updatedAt })
    } else {
      const cached = cache.items[account.number]
      results.push({
        account,
        info: cached?.info ?? null,
        source: cached ? "cache" : "none",
        updatedAt: cached?.updatedAt ?? 0,
        error: String((queryError as any)?.message ?? queryError ?? "未知错误"),
      })
    }
  }

  Storage.set(CACHE_KEY, nextCache)

  Widget.present(<BalanceWidget results={results} settings={settings} />, policy)
}

main()
