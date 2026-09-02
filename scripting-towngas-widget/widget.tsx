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
import { readRuntimeConfig, RuntimeConfig } from "./boxjs"
import { GasBill, GasResult, formatMoney, formatUsage, queryGas } from "./towngas-api"

const SETTINGS_KEY = "towngas_widget_settings_v1"
const CACHE_KEY = "towngas_widget_cache_v1"

type LocalSettings = { boxJsUrl: string }
type CacheData = { result: GasResult; label: string; title: string; savedAt: number }
type DisplayData = {
  result: GasResult | null
  label: string
  title: string
  source: "live" | "cache" | "none"
  lowBalanceThreshold: number
  criticalBalanceThreshold: number
  error?: string
}

const COLORS = {
  background: { light: "#FFF5E8", dark: "#201309" },
  card: { light: "#FFFFFF", dark: "#332013" },
  cardSoft: { light: "#FFE8CC", dark: "#422713" },
  text: { light: "#3A2414", dark: "#FFF4E8" },
  muted: { light: "#816B5A", dark: "#C9AA90" },
  texture: { light: "#E57B20", dark: "#FF9A3D" },
  accent: "#F27622",
  good: "#22A06B",
  warning: "#FF9F0A",
  danger: "#FF453A",
}

function loadLocalSettings(): LocalSettings {
  return { boxJsUrl: "https://boxjs.com", ...(Storage.get<LocalSettings>(SETTINGS_KEY) ?? {}) }
}

function timeText(timestamp: number): string {
  if (!timestamp) return "--"
  const date = new Date(timestamp)
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  const hour = String(date.getHours()).padStart(2, "0")
  const minute = String(date.getMinutes()).padStart(2, "0")
  return `${month}-${day} ${hour}:${minute}`
}

function monthText(value: string): string {
  const text = String(value || "")
  return text.length === 6 ? `${text.slice(0, 4)}-${text.slice(4)}` : text
}

function balanceColor(result: GasResult, low: number, critical: number): string {
  if (result.account.due > 0) return COLORS.danger
  if (critical > 0 && result.account.balance <= critical) return COLORS.danger
  if (low > 0 && result.account.balance < low) return COLORS.warning
  return COLORS.accent
}

function balanceStatus(result: GasResult, low: number, critical: number): string {
  if (result.account.due > 0) return `待缴 ¥${formatMoney(result.account.due)}`
  if (critical > 0 && result.account.balance <= critical) return "余额不足"
  if (low > 0 && result.account.balance < low) return "余额偏低"
  return "余额正常"
}

function Texture({ compact = false }: { compact?: boolean }) {
  const counts = compact ? [3, 4, 3, 5, 6, 7, 8] : [8, 9, 8, 7, 6, 5, 4, 3]
  return (
    <VStack alignment="trailing" spacing={compact ? 7 : 8} frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "topTrailing" }} modifiers={modifiers().opacity(0.12)}>
      {counts.map((count, index) => (
        <Text key={`texture-${index}`} modifiers={modifiers().padding({ trailing: index * 4 }).font(8).foregroundStyle(COLORS.texture) as any}>
          {Array(count).fill("+").join("    ")}
        </Text>
      ))}
    </VStack>
  )
}

function Header({ data, compact = false }: { data: DisplayData; compact?: boolean }) {
  return (
    <HStack alignment="center" spacing={7} frame={{ maxWidth: "infinity" }}>
      <Image systemName="flame.fill" modifiers={modifiers().font(compact ? 13 : 15).foregroundStyle(COLORS.accent as any) as any} />
      <VStack alignment="leading" spacing={0}>
        <Text lineLimit={1} modifiers={modifiers().font(compact ? 10 : 12).fontWeight("bold").foregroundStyle(COLORS.text) as any}>{data.title}</Text>
        <Text lineLimit={1} modifiers={modifiers().font(7).foregroundStyle(COLORS.muted) as any}>{data.label}</Text>
      </VStack>
      <Spacer />
      {data.source !== "none" ? <Text modifiers={modifiers().font(9).foregroundStyle((data.source === "live" ? COLORS.good : COLORS.warning) as any) as any}>●</Text> : null}
    </HStack>
  )
}

function BalanceCard({ data, compact = false }: { data: DisplayData; compact?: boolean }) {
  const result = data.result as GasResult
  const color = balanceColor(result, data.lowBalanceThreshold, data.criticalBalanceThreshold)
  return (
    <VStack alignment="leading" spacing={compact ? 2 : 3} frame={{ maxWidth: "infinity" }} modifiers={modifiers().padding(compact ? 8 : 10).background({ style: COLORS.card, shape: { type: "rect", cornerRadius: 14 } } as any)}>
      <HStack frame={{ maxWidth: "infinity" }}>
        <Text modifiers={modifiers().font(8).foregroundStyle(COLORS.muted) as any}>账户余额</Text>
        <Spacer />
        <Text modifiers={modifiers().font(8).foregroundStyle(color as any) as any}>{balanceStatus(result, data.lowBalanceThreshold, data.criticalBalanceThreshold)}</Text>
      </HStack>
      <Text lineLimit={1} modifiers={modifiers().font(compact ? 23 : 27).fontWeight("bold").foregroundStyle(color as any) as any}>¥{formatMoney(result.account.balance)}</Text>
      <Text lineLimit={1} modifiers={modifiers().font(8).foregroundStyle(COLORS.muted) as any}>
        表数 {formatUsage(result.account.currentReading)} · 未出账 {formatUsage(result.unbilledUsage)} 方
      </Text>
    </VStack>
  )
}

function ProgressBar({ progress, width = 118 }: { progress: number; width?: number }) {
  const safe = Math.max(0, Math.min(1, progress))
  return (
    <ZStack frame={{ width, height: 9, alignment: "leading" }}>
      <VStack modifiers={modifiers().frame({ width, height: 9 }).background({ style: { light: "#F2D8BB", dark: "#5A3820" }, shape: { type: "rect", cornerRadius: 999 } } as any)} />
      <VStack modifiers={modifiers().frame({ width: Math.max(5, Math.round(width * safe)), height: 9 }).background({ style: COLORS.accent as any, shape: { type: "rect", cornerRadius: 999 } } as any)} />
    </ZStack>
  )
}

function TierCard({ result, compact = false }: { result: GasResult; compact?: boolean }) {
  const tier = result.tier
  const quota = tier.quota === null ? "不限额" : `${formatUsage(tier.usedInTier)} / ${formatUsage(tier.quota)} 方`
  const remaining = tier.remaining === null ? "已进入最高阶梯" : `距下一阶 ${formatUsage(tier.remaining)} 方`
  return (
    <VStack alignment="leading" spacing={compact ? 4 : 6} frame={{ maxWidth: "infinity" }} modifiers={modifiers().padding(compact ? 8 : 10).background({ style: COLORS.cardSoft, shape: { type: "rect", cornerRadius: 14 } } as any)}>
      <HStack frame={{ maxWidth: "infinity" }}>
        <Text modifiers={modifiers().font(compact ? 9 : 10).fontWeight("bold").foregroundStyle(COLORS.text) as any}>{tier.name}</Text>
        <Spacer />
        <Text modifiers={modifiers().font(9).foregroundStyle(COLORS.accent as any) as any}>¥{formatMoney(tier.price)}/方</Text>
      </HStack>
      <ProgressBar progress={tier.progress} width={compact ? 105 : 118} />
      <HStack frame={{ maxWidth: "infinity" }}>
        <Text modifiers={modifiers().font(8).foregroundStyle(COLORS.muted) as any}>{quota}</Text>
        <Spacer />
        <Text modifiers={modifiers().font(8).foregroundStyle(COLORS.muted) as any}>{Math.round(tier.progress * 100)}%</Text>
      </HStack>
      <Text lineLimit={1} modifiers={modifiers().font(8).foregroundStyle(COLORS.muted) as any}>{remaining} · 年度 {formatUsage(result.annualUsage)} 方</Text>
    </VStack>
  )
}

function BillCard({ bill }: { bill: GasBill | null }) {
  return (
    <VStack alignment="leading" spacing={3} frame={{ maxWidth: "infinity" }} modifiers={modifiers().padding(8).background({ style: COLORS.card, shape: { type: "rect", cornerRadius: 12 } } as any)}>
      <HStack frame={{ maxWidth: "infinity" }}>
        <Text modifiers={modifiers().font(8).foregroundStyle(COLORS.muted) as any}>最近账单</Text>
        <Spacer />
        <Text modifiers={modifiers().font(8).foregroundStyle((bill?.unpaid ? COLORS.warning : COLORS.good) as any) as any}>{bill?.state || "暂无"}</Text>
      </HStack>
      <Text lineLimit={1} modifiers={modifiers().font(12).fontWeight("semibold").foregroundStyle(COLORS.text) as any}>
        {bill ? `${formatUsage(bill.usage)} 方 · ¥${formatMoney(bill.amount)}` : "等待账单"}
      </Text>
      <Text lineLimit={1} modifiers={modifiers().font(7).foregroundStyle(COLORS.muted) as any}>
        {bill ? `${monthText(bill.month)} · 表数 ${formatUsage(bill.previousReading)} → ${formatUsage(bill.currentReading)}` : "历史账单接口未返回记录"}
      </Text>
    </VStack>
  )
}

function BillRow({ bill }: { bill: GasBill }) {
  return (
    <HStack spacing={6} frame={{ maxWidth: "infinity" }} modifiers={modifiers().padding({ leading: 8, trailing: 8, top: 5, bottom: 5 }).background({ style: COLORS.card, shape: { type: "rect", cornerRadius: 10 } } as any)}>
      <Text modifiers={modifiers().font(9).fontWeight("semibold").foregroundStyle(COLORS.text) as any}>{monthText(bill.month).slice(5)}月</Text>
      <Text modifiers={modifiers().font(8).foregroundStyle(COLORS.muted) as any}>{formatUsage(bill.usage)}方</Text>
      <Spacer />
      <Text modifiers={modifiers().font(9).fontWeight("semibold").foregroundStyle(COLORS.text) as any}>¥{formatMoney(bill.amount)}</Text>
    </HStack>
  )
}

function EmptyWidget({ data }: { data: DisplayData }) {
  return (
    <ZStack widgetBackground={COLORS.background} frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
      <Texture />
      <VStack alignment="leading" spacing={10} frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" }} modifiers={modifiers().padding(12)}>
        <Header data={data} />
        <VStack alignment="leading" spacing={6} modifiers={modifiers().padding(10).background({ style: COLORS.card, shape: { type: "rect", cornerRadius: 12 } } as any)}>
          <Image systemName="exclamationmark.triangle.fill" modifiers={modifiers().foregroundStyle(COLORS.warning as any) as any} />
          <Text modifiers={modifiers().font(9).foregroundStyle(COLORS.muted) as any}>{data.error || "请先通过 Surge 抓取配置"}</Text>
        </VStack>
      </VStack>
    </ZStack>
  )
}

function SmallWidget({ data }: { data: DisplayData }) {
  const result = data.result as GasResult
  return (
    <ZStack widgetBackground={COLORS.background} frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
      <Texture compact />
      <VStack alignment="leading" spacing={6} frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" }} modifiers={modifiers().padding({ leading: 10, trailing: 10, top: 8, bottom: 8 })}>
        <Header data={data} compact />
        <BalanceCard data={data} compact />
        <TierCard result={result} compact />
      </VStack>
    </ZStack>
  )
}

function MediumWidget({ data }: { data: DisplayData }) {
  const result = data.result as GasResult
  return (
    <ZStack widgetBackground={COLORS.background} frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
      <Texture />
      <VStack alignment="leading" spacing={8} frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" }} modifiers={modifiers().padding({ leading: 11, trailing: 11, top: 9, bottom: 9 })}>
        <Header data={data} />
        <HStack alignment="top" spacing={9} frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
          <VStack alignment="leading" spacing={7} frame={{ maxWidth: "infinity" }}>
            <BalanceCard data={data} />
            <BillCard bill={result.bills[0] || null} />
          </VStack>
          <VStack alignment="leading" spacing={7} frame={{ maxWidth: "infinity" }}>
            <TierCard result={result} />
            <VStack alignment="leading" spacing={3} frame={{ maxWidth: "infinity" }} modifiers={modifiers().padding(8).background({ style: COLORS.card, shape: { type: "rect", cornerRadius: 12 } } as any)}>
              <Text modifiers={modifiers().font(8).foregroundStyle(COLORS.muted) as any}>当前阶梯区间</Text>
              <Text modifiers={modifiers().font(11).fontWeight("semibold").foregroundStyle(COLORS.text) as any}>
                {result.tier.upper === null ? `${formatUsage(result.tier.lower)} 方以上` : `${formatUsage(result.tier.lower)} – ${formatUsage(result.tier.upper)} 方`}
              </Text>
              <Text modifiers={modifiers().font(7).foregroundStyle(COLORS.muted) as any}>更新 {timeText(result.queriedAt)}</Text>
            </VStack>
          </VStack>
        </HStack>
      </VStack>
    </ZStack>
  )
}

function LargeWidget({ data }: { data: DisplayData }) {
  const result = data.result as GasResult
  return (
    <ZStack widgetBackground={COLORS.background} frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
      <Texture />
      <VStack alignment="leading" spacing={8} frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" }} modifiers={modifiers().padding(13)}>
        <Header data={data} />
        <HStack alignment="top" spacing={10} frame={{ maxWidth: "infinity" }}>
          <BalanceCard data={data} />
          <TierCard result={result} />
        </HStack>
        <BillCard bill={result.bills[0] || null} />
        <Text modifiers={modifiers().font(9).fontWeight("semibold").foregroundStyle(COLORS.text) as any}>近期燃气账单</Text>
        <VStack alignment="leading" spacing={5}>
          {result.bills.slice(0, 6).map(bill => <BillRow key={bill.month} bill={bill} />)}
        </VStack>
      </VStack>
    </ZStack>
  )
}

function AccessoryWidget({ data }: { data: DisplayData }) {
  const result = data.result as GasResult
  if (Widget.family === "accessoryCircular") {
    return <VStack spacing={1}><Image systemName="flame.fill" /><Text font="caption">{formatMoney(result.account.balance)}</Text></VStack>
  }
  return (
    <VStack alignment="leading" spacing={2}>
      <Text font="caption">{data.label}</Text>
      <Text font="headline">余额 ¥{formatMoney(result.account.balance)}</Text>
      <Text font="caption">{result.tier.name} · {formatUsage(result.annualUsage)} 方</Text>
    </VStack>
  )
}

function GasWidget({ data }: { data: DisplayData }) {
  if (!data.result) return <EmptyWidget data={data} />
  if (Widget.family === "accessoryCircular" || Widget.family === "accessoryRectangular") return <AccessoryWidget data={data} />
  if (Widget.family === "systemSmall") return <SmallWidget data={data} />
  if (Widget.family === "systemMedium") return <MediumWidget data={data} />
  return <LargeWidget data={data} />
}

function reloadPolicy(minutes: number): any {
  if (!(minutes > 0)) return { policy: "atEnd" }
  return { policy: "after", date: new Date(Date.now() + Math.max(15, minutes) * 60 * 1000) }
}

async function main() {
  const local = loadLocalSettings()
  const cache = Storage.get<CacheData>(CACHE_KEY)
  let runtime: RuntimeConfig | null = null
  let error: unknown = null
  try { runtime = await readRuntimeConfig(local.boxJsUrl) } catch (caught) { error = caught }
  const refreshMinutes = runtime?.refreshMinutes ?? 30

  if (runtime) {
    try {
      const result = await queryGas(runtime.credentials)
      const nextCache: CacheData = { result, label: runtime.label, title: runtime.title, savedAt: Date.now() }
      Storage.set(CACHE_KEY, nextCache)
      Widget.present(<GasWidget data={{
        result, label: runtime.label, title: runtime.title, source: "live",
        lowBalanceThreshold: runtime.lowBalanceThreshold,
        criticalBalanceThreshold: runtime.criticalBalanceThreshold,
      }} />, reloadPolicy(refreshMinutes))
      return
    } catch (caught) { error = caught }
  }

  if (cache?.result) {
    Widget.present(<GasWidget data={{
      result: cache.result,
      label: runtime?.label || cache.label,
      title: runtime?.title || cache.title,
      source: "cache",
      lowBalanceThreshold: runtime?.lowBalanceThreshold ?? 100,
      criticalBalanceThreshold: runtime?.criticalBalanceThreshold ?? 50,
      error: String((error as any)?.message ?? error ?? "实时查询失败"),
    }} />, reloadPolicy(refreshMinutes))
    return
  }

  Widget.present(<GasWidget data={{
    result: null,
    label: runtime?.label || "我家燃气",
    title: runtime?.title || "港华燃气",
    source: "none",
    lowBalanceThreshold: runtime?.lowBalanceThreshold ?? 100,
    criticalBalanceThreshold: runtime?.criticalBalanceThreshold ?? 50,
    error: String((error as any)?.message ?? error ?? "请先通过 Surge 抓取配置"),
  }} />, reloadPolicy(refreshMinutes))
}

main()
