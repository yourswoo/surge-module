import {
  HStack,
  Image,
  Spacer,
  Text,
  VStack,
  Widget,
  ZStack,
  modifiers,
} from "scripting"
import { Account, BalanceInfo, buildAccounts, formatMoney, queryAccount } from "./lsep-api"
import { readRuntimeConfigFromBoxJs } from "./boxjs"

const SETTINGS_KEY = "lsep_widget_settings_v2"
const CACHE_KEY = "lsep_widget_cache_v2"
const USAGE_KEY = "lsep_widget_monthly_usage_v1"
const DEFAULT_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.49(0x18003123) NetType/WIFI Language/zh_CN"

type LocalSettings = {
  boxJsUrl: string
  refreshMinutes: number
  lowBalanceThreshold: number
  criticalBalanceThreshold: number
  monthlyOpeningBalances: Array<number | null>
  monthlyOpeningMonth: string
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
  monthlyUsed: number
  error?: string
}

type CacheData = {
  items: Record<string, { info: BalanceInfo; updatedAt: number }>
}

type MonthlyUsageRecord = {
  month: string
  openingBalance: number
  lastBalance: number
  used: number
  updatedAt: number
  manualOpening?: boolean
}

type MonthlyUsageData = {
  items: Record<string, MonthlyUsageRecord>
}

function loadLocalSettings(): LocalSettings {
  return {
    boxJsUrl: "https://boxjs.com",
    refreshMinutes: 30,
    lowBalanceThreshold: 20,
    criticalBalanceThreshold: 10,
    monthlyOpeningBalances: [null, null],
    monthlyOpeningMonth: "",
    ...(Storage.get<LocalSettings>(SETTINGS_KEY) ?? {}),
  }
}

type Theme = {
  pageBg: any
  cardRaised: any
  usagePill: any
  accentSoft: any
  texture: any
  pageText: any
  mutedText: any
}

type RowVisual = {
  color: string
  tint: any
  amount: string
  status: string
}

const THEME: Theme = {
  pageBg: { light: "#EAF4F2", dark: "#061310" },
  cardRaised: { light: "#FFFFFF", dark: "#112A25" },
  usagePill: { light: "#FFFFFF", dark: "#1B493D" },
  accentSoft: { light: "#D8F5EC", dark: "#123A31" },
  texture: { light: "#288F78", dark: "#3BC49F" },
  pageText: { light: "#102A25", dark: "#E8FFF8" },
  mutedText: { light: "#5C756F", dark: "#83A99E" },
}

function shortNumber(number: string): string {
  const clean = number.replace(/\s+/g, "")
  if (clean.length <= 4) return "****"
  return `${clean.slice(0, 2)}****${clean.slice(-2)}`
}

function currentMonthKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
}

function moneyValue(value: number): number {
  return Math.round(value * 100) / 100
}

function monthlyUsedFor(accountNumber: string, usage: MonthlyUsageData): number {
  const record = usage.items[accountNumber]
  return record?.month === currentMonthKey() ? moneyValue(record.used) : 0
}

function recordMonthlyUsage(accountNumber: string, balance: number, usage: MonthlyUsageData, now: number, manualOpening: number | null): number {
  const month = currentMonthKey(new Date(now))
  const current = moneyValue(balance)
  const previous = usage.items[accountNumber]
  const hasManualOpening = manualOpening != null && Number.isFinite(manualOpening)
  const opening = hasManualOpening ? moneyValue(manualOpening as number) : current
  const openingChanged = hasManualOpening
    ? !previous?.manualOpening || previous.openingBalance !== opening
    : !!previous?.manualOpening

  if (!previous || previous.month !== month || openingChanged) {
    const used = hasManualOpening && opening > current ? moneyValue(opening - current) : 0
    usage.items[accountNumber] = {
      month,
      openingBalance: opening,
      lastBalance: current,
      used,
      updatedAt: now,
      manualOpening: hasManualOpening,
    }
    return used
  }

  const decrease = moneyValue(previous.lastBalance - current)
  const used = decrease > 0 ? moneyValue(previous.used + decrease) : previous.used
  usage.items[accountNumber] = {
    ...previous,
    lastBalance: current,
    used,
    updatedAt: now,
  }
  return used
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

function TechTexture({ compact = false }: { compact?: boolean }) {
  const pattern = compact
    ? "+    +    +    +    +    +"
    : "+    +    +    +    +    +    +    +    +    +    +    +"
  return (
    <VStack
      alignment="leading"
      spacing={compact ? 9 : 12}
      frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" }}
      modifiers={modifiers().padding({ leading: 5, trailing: 5, top: 2, bottom: 2 }).opacity(0.16)}
    >
      <Text modifiers={modifiers().font(8).foregroundStyle(THEME.texture) as any}>{pattern}</Text>
      <Text modifiers={modifiers().font(8).foregroundStyle(THEME.texture) as any}>  {pattern}</Text>
      <Text modifiers={modifiers().font(8).foregroundStyle(THEME.texture) as any}>{pattern}</Text>
      <Text modifiers={modifiers().font(8).foregroundStyle(THEME.texture) as any}>  {pattern}</Text>
      <Text modifiers={modifiers().font(8).foregroundStyle(THEME.texture) as any}>{pattern}</Text>
      {!compact ? <Text modifiers={modifiers().font(8).foregroundStyle(THEME.texture) as any}>  {pattern}</Text> : null}
      {!compact ? <Text modifiers={modifiers().font(8).foregroundStyle(THEME.texture) as any}>{pattern}</Text> : null}
    </VStack>
  )
}

function rowVisual(result: DisplayResult, lowThreshold: number, criticalThreshold: number): RowVisual {
  if (!result.info) {
    return { color: "#8E8E93", tint: { light: "#F0F3F2", dark: "#172321" }, amount: "¥ --", status: "等待查询" }
  }
  if (result.info.owe > 0) {
    return { color: "#FF453A", tint: { light: "#FFF0F0", dark: "#321819" }, amount: `¥${formatMoney(result.info.owe)}`, status: "欠费，请及时充值" }
  }
  if (criticalThreshold > 0 && result.info.prepay <= criticalThreshold) {
    return { color: "#FF453A", tint: { light: "#FFF0F0", dark: "#321819" }, amount: `¥${formatMoney(result.info.prepay)}`, status: "余额不足，请及时充值" }
  }
  if (lowThreshold > 0 && result.info.prepay < lowThreshold) {
    return { color: "#FF9F0A", tint: { light: "#FFF7E8", dark: "#302511" }, amount: `¥${formatMoney(result.info.prepay)}`, status: "余额偏低" }
  }
  return {
    color: result.source === "live" ? "#22C997" : "#8E8E93",
    tint: result.source === "live"
      ? { light: "#ECFBF6", dark: "#0D2B23" }
      : { light: "#F0F3F2", dark: "#172321" },
    amount: `¥${formatMoney(result.info.prepay)}`,
    status: result.source === "live" ? "余额正常" : "缓存数据",
  }
}

function Header({ results, compact = false }: { results: DisplayResult[]; compact?: boolean }) {
  const iconSize = compact ? 23 : 28
  return (
    <VStack alignment="leading" spacing={compact ? 4 : 6}>
      <HStack alignment="center" spacing={8}>
        <HStack modifiers={modifiers()
          .padding(compact ? 4 : 5)
          .background({ style: THEME.accentSoft, shape: { type: "rect", cornerRadius: compact ? 10 : 12 } } as any)}>
          <Image
            imageUrl="https://yong.ing/ldt.PNG"
            resizable
            scaleToFit
            frame={{ width: iconSize, height: iconSize }}
          />
        </HStack>
        <VStack alignment="leading" spacing={1}>
          <Text modifiers={modifiers()
            .font(compact ? 11 : 13)
            .foregroundStyle(THEME.pageText)
            .fontWeight("bold") as any}>
            乐电通
          </Text>
          {!compact ? (
            <Text modifiers={modifiers().font(7).foregroundStyle(THEME.mutedText) as any}>
              LESHAN POWER
            </Text>
          ) : null}
        </VStack>
        <Spacer />
        <HStack alignment="center" spacing={4}>
          <Text modifiers={modifiers().font(compact ? 9 : 10).foregroundStyle(queryStatusColor(results) as any) as any}>●</Text>
          <Text modifiers={modifiers().font(compact ? 7 : 8).foregroundStyle(THEME.mutedText) as any}>
            {compact ? "在线" : updateLabel(latestUpdate(results))}
          </Text>
        </HStack>
      </HStack>
    </VStack>
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
        .background({ style: visual.tint, shape: { type: "rect", cornerRadius: 13 } } as any)}
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
        <Text lineLimit={1} modifiers={modifiers().font(8).foregroundStyle(THEME.mutedText) as any}>
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
        .background({ style: visual.tint, shape: { type: "rect", cornerRadius: 14 } } as any)}
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
        <Text lineLimit={1} modifiers={modifiers().font(9).foregroundStyle(THEME.mutedText) as any}>
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

function MediumAccountCard({ result, lowThreshold, criticalThreshold }: { result: DisplayResult; lowThreshold: number; criticalThreshold: number }) {
  const visual = rowVisual(result, lowThreshold, criticalThreshold)
  return (
    <VStack
      alignment="leading"
      spacing={3}
      frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" }}
      modifiers={modifiers()
        .padding({ leading: 9, trailing: 9, top: 7, bottom: 7 })
        .background({ style: visual.tint, shape: { type: "rect", cornerRadius: 14 } } as any)}
    >
      <HStack alignment="center" spacing={6}>
        <VStack modifiers={modifiers()
          .frame({ width: 4, height: 28 })
          .background({ style: visual.color as any, shape: { type: "rect", cornerRadius: 999 } } as any)} />
        <VStack alignment="leading" spacing={1}>
          <Text lineLimit={1} modifiers={modifiers().font(11).foregroundStyle(THEME.pageText).fontWeight("bold") as any}>
            {result.account.label}
          </Text>
          <Text lineLimit={1} modifiers={modifiers().font(7).foregroundStyle(THEME.mutedText) as any}>
            户号 {shortNumber(result.account.number)}
          </Text>
        </VStack>
        <Spacer />
        <Text modifiers={modifiers().font(22).foregroundStyle("#30D158").opacity(0.14) as any}>⚡︎</Text>
      </HStack>
      <Text modifiers={modifiers().font(17).foregroundStyle(visual.color as any).fontWeight("bold") as any}>
        {visual.amount}
      </Text>
      <Text lineLimit={1} modifiers={modifiers().font(7).foregroundStyle(THEME.mutedText) as any}>
        {visual.status}
      </Text>
      <HStack
        alignment="center"
        spacing={2}
        modifiers={modifiers()
          .padding({ leading: 6, trailing: 6, top: 4, bottom: 4 })
          .background({ style: THEME.usagePill, shape: { type: "rect", cornerRadius: 8 } } as any)}
      >
        <Text lineLimit={1} modifiers={modifiers().font(7).foregroundStyle(THEME.mutedText) as any}>本月已用电：</Text>
        <Spacer />
        <Text lineLimit={1} modifiers={modifiers().font(9).foregroundStyle(THEME.pageText).fontWeight("semibold") as any}>
          ¥{formatMoney(result.monthlyUsed)}
        </Text>
      </HStack>
    </VStack>
  )
}

function EmptyWidget({ message }: { message: string }) {
  return (
    <ZStack
      widgetBackground={THEME.pageBg}
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
    >
      <TechTexture />
      <VStack
        alignment="leading"
        spacing={8}
        frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" }}
        modifiers={modifiers().padding({ leading: 11, trailing: 11, top: 10, bottom: 10 })}
      >
        <Header results={[]} />
        <HStack
          modifiers={modifiers()
            .padding(11)
            .background({ style: THEME.cardRaised, shape: { type: "rect", cornerRadius: 14 } } as any)}
        >
          <Text modifiers={modifiers().font(10).foregroundStyle(THEME.mutedText) as any}>{message}</Text>
        </HStack>
      </VStack>
    </ZStack>
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
  if (family === "systemMedium") {
    const mediumResults = results.slice(0, 2)
    return (
      <ZStack
        widgetBackground={THEME.pageBg}
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      >
        <TechTexture />
        <VStack
          alignment="leading"
          spacing={7}
          frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" }}
          modifiers={modifiers().padding({ leading: 11, trailing: 11, top: 9, bottom: 9 })}
        >
          <Header results={results} />
          <HStack alignment="top" spacing={8} frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
            {mediumResults.map(result => (
              <MediumAccountCard
                key={result.account.number}
                result={result}
                lowThreshold={settings.lowBalanceThreshold}
                criticalThreshold={settings.criticalBalanceThreshold}
              />
            ))}
          </HStack>
        </VStack>
      </ZStack>
    )
  }

  const limit = small ? 2 : 7
  const visible = results.slice(0, limit)

  return small ? (
    <ZStack
      widgetBackground={THEME.pageBg}
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
    >
      <TechTexture compact />
      <VStack
        alignment="leading"
        spacing={8}
        frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" }}
        modifiers={modifiers().padding({ leading: 9, trailing: 9, top: 9, bottom: 9 })}
      >
        <Header results={results} compact />
        <VStack alignment="leading" spacing={6}>
          {visible.map(result => (
            <SmallRow key={result.account.number} result={result} lowThreshold={settings.lowBalanceThreshold} criticalThreshold={settings.criticalBalanceThreshold} />
          ))}
        </VStack>
      </VStack>
    </ZStack>
  ) : (
    <ZStack
      widgetBackground={THEME.pageBg}
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
    >
      <TechTexture />
      <VStack
        alignment="leading"
        spacing={8}
        frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" }}
        modifiers={modifiers().padding({ leading: 11, trailing: 11, top: 10, bottom: 10 })}
      >
        <Header results={results} />
        <VStack alignment="leading" spacing={6}>
          {visible.map(result => (
            <MediumRow key={result.account.number} result={result} lowThreshold={settings.lowBalanceThreshold} criticalThreshold={settings.criticalBalanceThreshold} />
          ))}
        </VStack>
      </VStack>
    </ZStack>
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
  const usage = Storage.get<MonthlyUsageData>(USAGE_KEY) ?? { items: {} }
  const nextUsage: MonthlyUsageData = { items: { ...usage.items } }
  const results: DisplayResult[] = []
  let cookie = runtime.cookie
  const userAgent = runtime.userAgent || DEFAULT_UA

  for (let accountIndex = 0; accountIndex < accounts.length; accountIndex += 1) {
    const account = accounts[accountIndex]
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
      const monthlyUsed = recordMonthlyUsage(
        account.number,
        queried.info.value,
        nextUsage,
        updatedAt,
        localSettings.monthlyOpeningMonth === currentMonthKey()
          ? localSettings.monthlyOpeningBalances?.[accountIndex] ?? null
          : null,
      )
      nextCache.items[account.number] = { info: queried.info, updatedAt }
      results.push({ account, info: queried.info, source: "live", updatedAt, monthlyUsed })
    } else {
      const cached = cache.items[account.number]
      results.push({
        account,
        info: cached?.info ?? null,
        source: cached ? "cache" : "none",
        updatedAt: cached?.updatedAt ?? 0,
        monthlyUsed: monthlyUsedFor(account.number, nextUsage),
        error: String((queryError as any)?.message ?? queryError ?? "未知错误"),
      })
    }
  }

  Storage.set(CACHE_KEY, nextCache)
  Storage.set(USAGE_KEY, nextUsage)

  Widget.present(<BalanceWidget results={results} settings={settings} />, policy)
}

main()
