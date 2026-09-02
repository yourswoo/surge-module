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
const LOGO_URL = "https://raw.githubusercontent.com/yourswoo/surge-module/refs/heads/gasbill/towngas.png"
const FRESH_RESULT_WINDOW = 12 * 60 * 60 * 1000

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

function formatChangedAt(timestamp: number, compact: boolean): string {
  if (!timestamp) return compact ? "等待更新" : "等待首次数据更新"
  return compact ? timeText(timestamp) : `上次更新 ${timeText(timestamp)}`
}

function dataFreshness(data: DisplayData): { fresh: boolean; changedAt: number } {
  const changedAt = data.result?.queriedAt ?? 0
  return {
    fresh: data.source === "live" && !!changedAt && Date.now() - changedAt < FRESH_RESULT_WINDOW,
    changedAt,
  }
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

function Texture({ compact = false, medium = false }: { compact?: boolean; medium?: boolean }) {
  const counts = compact
    ? [3, 4, 3, 4, 5, 6, 7, 8, 9, 10]
    : medium
      ? [8, 9, 8, 7, 6, 5, 4, 3, 2]
      : [10, 11, 10, 9, 8, 7, 6, 5, 4]
  const offsets = compact
    ? [0, 4, 1, 5, 2, 6, 3, 7, 4, 8]
    : [0, 5, 1, 6, 2, 7, 3, 8, 4]
  const gap = compact ? "   " : "    "
  return (
    <VStack alignment="trailing" spacing={compact ? 6 : 8} frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "topTrailing" }} modifiers={modifiers().padding({ leading: 5, trailing: 3, top: 2, bottom: 2 }).opacity(0.16)}>
      {counts.map((count, index) => (
        <Text key={`texture-${index}-${count}`} modifiers={modifiers().padding({ trailing: offsets[index] }).font(8).foregroundStyle(COLORS.texture) as any}>
          {Array(count).fill("+").join(gap)}
        </Text>
      ))}
    </VStack>
  )
}

function Header({ data, compact = false }: { data: DisplayData; compact?: boolean }) {
  const iconSize = compact ? 23 : 28
  const freshness = dataFreshness(data)
  return (
    <VStack alignment="leading" spacing={compact ? 4 : 6}>
      <HStack alignment="center" spacing={8}>
        <Image imageUrl={LOGO_URL} resizable scaleToFit frame={{ width: iconSize, height: iconSize }} />
        <VStack alignment="leading" spacing={1}>
          <Text modifiers={modifiers().font(compact ? 11 : 13).foregroundStyle(COLORS.text).fontWeight("bold") as any}>
            港 华 燃 气
          </Text>
          {!compact ? <Text modifiers={modifiers().font(7).foregroundStyle(COLORS.muted) as any}>Towngas</Text> : null}
        </VStack>
        <Spacer />
        <HStack alignment="center" spacing={4}>
          <Text modifiers={modifiers().font(compact ? 9 : 10).foregroundStyle((freshness.fresh ? "#30D158" : "#FF9F0A") as any) as any}>●</Text>
          <Text modifiers={modifiers().font(compact ? 7 : 8).foregroundStyle(COLORS.muted) as any}>
            {freshness.fresh ? " " : formatChangedAt(freshness.changedAt, compact)}
          </Text>
        </HStack>
      </HStack>
    </VStack>
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
        <Text modifiers={modifiers().font(compact ? 9 : 10).fontWeight("bold").foregroundStyle(COLORS.text) as any}>当前气阶：{tier.name}</Text>
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

function BillCard({ bill, compact = false }: { bill: GasBill | null; compact?: boolean }) {
  return (
    <VStack alignment="leading" spacing={compact ? 2 : 3} frame={{ maxWidth: "infinity" }} modifiers={modifiers().padding(compact ? 8 : 9).background({ style: COLORS.card, shape: { type: "rect", cornerRadius: 12 } } as any)}>
      <HStack frame={{ maxWidth: "infinity" }}>
        <Text modifiers={modifiers().font(8).foregroundStyle(COLORS.muted) as any}>最近账单</Text>
        <Spacer />
        <Text modifiers={modifiers().font(8).foregroundStyle((bill?.unpaid ? COLORS.warning : COLORS.good) as any) as any}>{bill?.state || "暂无"}</Text>
      </HStack>
      <Text lineLimit={1} modifiers={modifiers().font(compact ? 19 : 22).fontWeight("bold").foregroundStyle(COLORS.text) as any}>
        {bill ? `¥${formatMoney(bill.amount)}` : "¥ --"}
      </Text>
      <Text lineLimit={1} modifiers={modifiers().font(7).foregroundStyle(COLORS.muted) as any}>
        {bill ? `${monthText(bill.month)} · ${formatUsage(bill.usage)} 方 · ${bill.state}` : "历史账单暂无记录"}
      </Text>
    </VStack>
  )
}

function MediumTierCard({ result }: { result: GasResult }) {
  const tier = result.tier
  const quota = tier.quota === null ? "当前阶梯不限额" : `本阶梯 ${formatUsage(tier.usedInTier)} / ${formatUsage(tier.quota)} 方`
  const remaining = tier.remaining === null ? "最高阶梯" : `距下一阶 ${formatUsage(tier.remaining)} 方`
  return (
    <VStack alignment="leading" spacing={4} frame={{ maxWidth: "infinity" }} modifiers={modifiers().padding({ leading: 9, trailing: 9, top: 7, bottom: 7 }).background({ style: COLORS.cardSoft, shape: { type: "rect", cornerRadius: 13 } } as any)}>
      <HStack alignment="center" spacing={6} frame={{ maxWidth: "infinity" }}>
        <Text modifiers={modifiers().font(10).fontWeight("bold").foregroundStyle(COLORS.text) as any}>当前气阶：{tier.name}</Text>
        <Text modifiers={modifiers().font(9).fontWeight("semibold").foregroundStyle(COLORS.accent as any) as any}>¥{formatMoney(tier.price)}/方</Text>
        <Spacer />
        <Text modifiers={modifiers().font(8).foregroundStyle(COLORS.muted) as any}>年度 {formatUsage(result.annualUsage)} 方</Text>
      </HStack>
      <ProgressBar progress={tier.progress} width={288} />
      <HStack frame={{ maxWidth: "infinity" }}>
        <Text modifiers={modifiers().font(8).foregroundStyle(COLORS.muted) as any}>{quota}</Text>
        <Spacer />
        <Text modifiers={modifiers().font(8).foregroundStyle(COLORS.muted) as any}>{remaining} · {Math.round(tier.progress * 100)}%</Text>
      </HStack>
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
      <Texture medium />
      <VStack alignment="leading" spacing={7} frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" }} modifiers={modifiers().padding({ leading: 11, trailing: 11, top: 9, bottom: 9 })}>
        <Header data={data} />
        <HStack alignment="top" spacing={8} frame={{ maxWidth: "infinity" }}>
          <BalanceCard data={data} compact />
          <BillCard bill={result.bills[0] || null} compact />
        </HStack>
        <MediumTierCard result={result} />
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
          <BillCard bill={result.bills[0] || null} />
        </HStack>
        <TierCard result={result} />
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
