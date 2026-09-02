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
import { BillInfo, WaterResult, formatMoney, formatUsage, queryWater } from "./water-api"

const SETTINGS_KEY = "water_widget_settings_v1"
const CACHE_KEY = "water_widget_cache_v1"

type LocalSettings = { boxJsUrl: string }
type CacheData = {
  result: WaterResult
  label: string
  title: string
  savedAt: number
}

type DisplayData = {
  result: WaterResult | null
  label: string
  title: string
  source: "live" | "cache" | "none"
  lowBalanceThreshold: number
  criticalBalanceThreshold: number
  error?: string
}

type BalanceVisual = {
  color: string
  tint: any
  status: string
}

const COLORS = {
  background: { light: "#EAF6FF", dark: "#071923" },
  card: { light: "#FFFFFF", dark: "#102A38" },
  cardSoft: { light: "#DDF1FF", dark: "#103447" },
  texture: { light: "#2A96D8", dark: "#39BCEB" },
  text: { light: "#102A3A", dark: "#EAF8FF" },
  muted: { light: "#617887", dark: "#91B4C8" },
  accent: "#1D9BF0",
  cyan: "#34C7F3",
  good: "#19A974",
  warning: "#FF9F0A",
  danger: "#FF453A",
}

function loadLocalSettings(): LocalSettings {
  return { boxJsUrl: "https://boxjs.com", ...(Storage.get<LocalSettings>(SETTINGS_KEY) ?? {}) }
}

function shortNumber(value: string): string {
  const text = value.replace(/\s+/g, "")
  if (!text) return "户号未提供"
  if (text.length <= 4) return `户号 ${text}`
  return `户号 ${text.slice(0, 2)}••${text.slice(-2)}`
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

function paidColor(bill: BillInfo): string {
  return bill.paid ? COLORS.good : COLORS.warning
}

function balanceVisual(result: WaterResult, lowThreshold: number, criticalThreshold: number): BalanceVisual {
  const balance = result.account.balance
  if (criticalThreshold > 0 && balance <= criticalThreshold) {
    return {
      color: "#FF453A",
      tint: { light: "#FFF0F0", dark: "#321819" },
      status: "余额不足，尽快充值",
    }
  }
  if (lowThreshold > 0 && balance < lowThreshold) {
    return {
      color: "#FF9F0A",
      tint: { light: "#FFF7E8", dark: "#302511" },
      status: "余额偏低",
    }
  }
  return {
    color: COLORS.accent,
    tint: { light: "#E3F3FF", dark: "#0E3146" },
    status: "余额正常",
  }
}

function displayTitle(value: string): string {
  return !value || value === "水费" ? "水费查询" : value
}

function displayLabel(value: string): string {
  return !value || value === "我家水费" ? "四川濯缨科技" : value
}

function PlusTexture({ compact = false }: { compact?: boolean }) {
  const counts = compact
    ? [3, 4, 3, 4, 5, 6, 7, 8]
    : [7, 8, 7, 6, 5, 4, 3, 2]
  const offsets = compact
    ? [0, 4, 1, 5, 2, 6, 3, 7]
    : [0, 5, 1, 6, 2, 7, 3, 8]
  const gap = compact ? "   " : "    "
  return (
    <VStack
      alignment="trailing"
      spacing={compact ? 6 : 8}
      frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "topTrailing" }}
      modifiers={modifiers().padding({ leading: 5, trailing: 3, top: 3, bottom: 2 }).opacity(0.14)}
    >
      {counts.map((count, index) => (
        <Text
          key={`texture-${index}-${count}`}
          modifiers={modifiers()
            .padding({ trailing: offsets[index] })
            .font(8)
            .foregroundStyle(COLORS.texture) as any}
        >
          {Array(count).fill("+").join(gap)}
        </Text>
      ))}
    </VStack>
  )
}

function StatusDot({ source }: { source: DisplayData["source"] }) {
  const live = source === "live"
  return (
    <Text modifiers={modifiers().font(Widget.family === "systemSmall" ? 9 : 10).foregroundStyle((live ? "#30D158" : "#FF9F0A") as any) as any}>●</Text>
  )
}

function Header({ data, compact = false }: { data: DisplayData; compact?: boolean }) {
  return (
    <HStack alignment="center" spacing={6} frame={{ maxWidth: "infinity" }}>
      <Image
        systemName="drop.fill"
        modifiers={modifiers().font(compact ? 12 : 14).foregroundStyle(COLORS.accent as any) as any}
      />
      <VStack alignment="leading" spacing={0}>
        <Text lineLimit={1} modifiers={modifiers().font(compact ? 10 : 12).fontWeight("bold").foregroundStyle(COLORS.text) as any}>
          {displayTitle(data.title)}
        </Text>
        <Text lineLimit={1} modifiers={modifiers().font(7).foregroundStyle(COLORS.muted) as any}>
          {displayLabel(data.label)}
        </Text>
      </VStack>
      <Spacer />
      {data.source !== "none" ? <StatusDot source={data.source} /> : null}
    </HStack>
  )
}

function BalanceBlock({
  result,
  lowThreshold,
  criticalThreshold,
  compact = false,
}: {
  result: WaterResult
  lowThreshold: number
  criticalThreshold: number
  compact?: boolean
}) {
  const due = result.account.receivable
  const visual = balanceVisual(result, lowThreshold, criticalThreshold)
  return (
    <HStack
      alignment="center"
      spacing={compact ? 6 : 8}
      frame={{ maxWidth: "infinity" }}
      modifiers={modifiers()
        .padding({
          leading: compact ? 7 : 9,
          trailing: compact ? 7 : 9,
          top: compact ? 5 : 7,
          bottom: compact ? 5 : 7,
        })
        .background({ style: visual.tint, shape: { type: "rect", cornerRadius: compact ? 12 : 14 } } as any)}
    >
      <VStack
        modifiers={modifiers()
          .frame({ width: compact ? 3 : 4, height: compact ? 43 : 52 })
          .background({ style: visual.color as any, shape: { type: "rect", cornerRadius: 999 } } as any)}
      />
      <VStack alignment="leading" spacing={compact ? 1 : 2} frame={{ maxWidth: "infinity" }}>
        <HStack alignment="center" spacing={4} frame={{ maxWidth: "infinity" }}>
          <Text modifiers={modifiers().font(compact ? 7 : 8).foregroundStyle(COLORS.muted) as any}>账户余额</Text>
          <Spacer />
          <Text lineLimit={1} modifiers={modifiers().font(compact ? 7 : 8).foregroundStyle(visual.color as any) as any}>
            {visual.status}
          </Text>
        </HStack>
        <Text
          lineLimit={1}
          modifiers={modifiers().font(compact ? 19 : 26).fontWeight("bold").foregroundStyle(visual.color as any) as any}
        >
          ¥{formatMoney(result.account.balance)}
        </Text>
        <Text lineLimit={1} modifiers={modifiers().font(compact ? 7 : 8).foregroundStyle(due > 0 ? COLORS.warning as any : COLORS.muted) as any}>
          {due > 0 ? `本期应收 ¥${formatMoney(due)}` : "本期暂无应收"}
        </Text>
      </VStack>
    </HStack>
  )
}

function LatestBillCard({ bill, compact = false }: { bill: BillInfo | null; compact?: boolean }) {
  return (
    <VStack
      alignment="leading"
      spacing={compact ? 3 : 4}
      frame={{ maxWidth: "infinity" }}
      modifiers={modifiers()
        .padding({
          leading: compact ? 7 : 8,
          trailing: compact ? 7 : 8,
          top: compact ? 5 : 7,
          bottom: compact ? 5 : 7,
        })
        .background({ style: COLORS.cardSoft, shape: { type: "rect", cornerRadius: 12 } } as any)}
    >
      <HStack spacing={4} frame={{ maxWidth: "infinity" }}>
        <Text modifiers={modifiers().font(compact ? 7 : 8).foregroundStyle(COLORS.muted) as any}>最近账单</Text>
        <Spacer />
        <Text modifiers={modifiers().font(compact ? 7 : 8).foregroundStyle(bill ? paidColor(bill) as any : COLORS.muted) as any}>
          {bill?.status || "暂无"}
        </Text>
      </HStack>
      <Text lineLimit={1} modifiers={modifiers().font(compact ? 11 : 13).fontWeight("semibold").foregroundStyle(COLORS.text) as any}>
        {bill ? `${formatUsage(bill.usage)} 吨 · ¥${formatMoney(bill.amount)}` : "等待账单"}
      </Text>
      <Text lineLimit={1} modifiers={modifiers().font(7).foregroundStyle(COLORS.muted) as any}>
        {bill ? `${bill.month} · 表数 ${formatUsage(bill.startReading)} → ${formatUsage(bill.endReading)}` : "历史账单接口未返回记录"}
      </Text>
    </VStack>
  )
}

function BillRow({ bill }: { bill: BillInfo }) {
  return (
    <HStack
      alignment="center"
      spacing={7}
      frame={{ maxWidth: "infinity" }}
      modifiers={modifiers()
        .padding({ leading: 8, trailing: 8, top: 5, bottom: 5 })
        .background({ style: COLORS.card, shape: { type: "rect", cornerRadius: 10 } } as any)}
    >
      <Text modifiers={modifiers().font(9).fontWeight("semibold").foregroundStyle(COLORS.text) as any}>{bill.month.slice(5)}月</Text>
      <Text modifiers={modifiers().font(8).foregroundStyle(COLORS.muted) as any}>{formatUsage(bill.usage)} 吨</Text>
      <Spacer />
      <Text modifiers={modifiers().font(10).fontWeight("semibold").foregroundStyle(COLORS.text) as any}>¥{formatMoney(bill.amount)}</Text>
      <Text modifiers={modifiers().font(7).foregroundStyle(paidColor(bill) as any) as any}>{bill.status}</Text>
    </HStack>
  )
}

function EmptyWidget({ data }: { data: DisplayData }) {
  return (
    <ZStack widgetBackground={COLORS.background} frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
      <PlusTexture />
      <VStack
        alignment="leading"
        spacing={10}
        frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" }}
        modifiers={modifiers().padding(12)}
      >
        <Header data={data} />
        <VStack
          alignment="leading"
          spacing={6}
          modifiers={modifiers().padding(10).background({ style: COLORS.card, shape: { type: "rect", cornerRadius: 12 } } as any)}
        >
          <Image systemName="exclamationmark.triangle.fill" modifiers={modifiers().foregroundStyle(COLORS.warning as any) as any} />
          <Text modifiers={modifiers().font(9).foregroundStyle(COLORS.muted) as any}>{data.error || "尚无水费数据"}</Text>
        </VStack>
      </VStack>
    </ZStack>
  )
}

function SmallWidget({ data }: { data: DisplayData }) {
  const result = data.result as WaterResult
  const latest = result.bills[0] || null
  return (
    <ZStack widgetBackground={COLORS.background} frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
      <PlusTexture compact />
      <VStack
        alignment="leading"
        spacing={6}
        frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" }}
        modifiers={modifiers().padding({ leading: 10, trailing: 10, top: 8, bottom: 8 })}
      >
        <Header data={data} compact />
        <BalanceBlock result={result} lowThreshold={data.lowBalanceThreshold} criticalThreshold={data.criticalBalanceThreshold} compact />
        <Spacer />
        <LatestBillCard bill={latest} compact />
      </VStack>
    </ZStack>
  )
}

function MediumWidget({ data }: { data: DisplayData }) {
  const result = data.result as WaterResult
  return (
    <ZStack widgetBackground={COLORS.background} frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
      <PlusTexture />
      <VStack
        alignment="leading"
        spacing={8}
        frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" }}
        modifiers={modifiers().padding({ leading: 11, trailing: 11, top: 9, bottom: 9 })}
      >
        <Header data={data} />
        <HStack alignment="top" spacing={9} frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
          <VStack alignment="leading" spacing={8} frame={{ maxWidth: "infinity" }}>
            <BalanceBlock result={result} lowThreshold={data.lowBalanceThreshold} criticalThreshold={data.criticalBalanceThreshold} />
            <LatestBillCard bill={result.bills[0] || null} />
          </VStack>
          <VStack alignment="leading" spacing={5} frame={{ maxWidth: "infinity" }}>
            <Text modifiers={modifiers().font(8).foregroundStyle(COLORS.muted) as any}>近期账单</Text>
            {result.bills.slice(0, 3).map(bill => <BillRow key={bill.month} bill={bill} />)}
            {!result.bills.length ? <Text modifiers={modifiers().font(8).foregroundStyle(COLORS.muted) as any}>暂无历史账单</Text> : null}
          </VStack>
        </HStack>
      </VStack>
    </ZStack>
  )
}

function LargeWidget({ data }: { data: DisplayData }) {
  const result = data.result as WaterResult
  return (
    <ZStack widgetBackground={COLORS.background} frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
      <PlusTexture />
      <VStack
        alignment="leading"
        spacing={8}
        frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" }}
        modifiers={modifiers().padding(13)}
      >
        <Header data={data} />
        <HStack spacing={10} frame={{ maxWidth: "infinity" }}>
          <BalanceBlock result={result} lowThreshold={data.lowBalanceThreshold} criticalThreshold={data.criticalBalanceThreshold} />
          <Spacer />
          <VStack alignment="trailing" spacing={2}>
            <Text modifiers={modifiers().font(8).foregroundStyle(COLORS.muted) as any}>{result.account.customerName || "水费账户"}</Text>
            <Text modifiers={modifiers().font(8).foregroundStyle(COLORS.muted) as any}>{shortNumber(result.account.customerNo)}</Text>
            <Text modifiers={modifiers().font(7).foregroundStyle(COLORS.muted) as any}>更新 {timeText(result.queriedAt)}</Text>
          </VStack>
        </HStack>
        <LatestBillCard bill={result.bills[0] || null} />
        <Text modifiers={modifiers().font(9).fontWeight("semibold").foregroundStyle(COLORS.text) as any}>历史账单</Text>
        <VStack alignment="leading" spacing={5}>
          {result.bills.slice(0, 6).map(bill => <BillRow key={bill.month} bill={bill} />)}
          {!result.bills.length ? <Text modifiers={modifiers().font(8).foregroundStyle(COLORS.muted) as any}>所选月份内暂无账单</Text> : null}
        </VStack>
      </VStack>
    </ZStack>
  )
}

function AccessoryWidget({ data }: { data: DisplayData }) {
  const result = data.result as WaterResult
  if (Widget.family === "accessoryCircular") {
    return (
      <VStack spacing={1}>
        <Image systemName="drop.fill" />
        <Text font="caption" lineLimit={1}>{formatMoney(result.account.balance)}</Text>
      </VStack>
    )
  }
  return (
    <VStack alignment="leading" spacing={2}>
      <Text font="caption">{displayLabel(data.label)}</Text>
      <Text font="headline">余额 ¥{formatMoney(result.account.balance)}</Text>
      <Text font="caption">{result.bills[0] ? `${result.bills[0].month} · ${formatUsage(result.bills[0].usage)} 吨` : "暂无账单"}</Text>
    </VStack>
  )
}

function WaterWidget({ data }: { data: DisplayData }) {
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

  try {
    runtime = await readRuntimeConfig(local.boxJsUrl)
  } catch (caught) {
    error = caught
  }

  const refreshMinutes = runtime?.refreshMinutes ?? 30
  if (runtime) {
    try {
      const result = await queryWater(runtime.credentials, runtime.months)
      const nextCache: CacheData = { result, label: runtime.label, title: runtime.title, savedAt: Date.now() }
      Storage.set(CACHE_KEY, nextCache)
      Widget.present(<WaterWidget data={{
        result,
        label: runtime.label,
        title: runtime.title,
        source: "live",
        lowBalanceThreshold: runtime.lowBalanceThreshold,
        criticalBalanceThreshold: runtime.criticalBalanceThreshold,
      }} />, reloadPolicy(refreshMinutes))
      return
    } catch (caught) {
      error = caught
    }
  }

  if (cache?.result) {
    Widget.present(
      <WaterWidget data={{
        result: cache.result,
        label: runtime?.label || cache.label,
        title: runtime?.title || cache.title,
        source: "cache",
        lowBalanceThreshold: runtime?.lowBalanceThreshold ?? 100,
        criticalBalanceThreshold: runtime?.criticalBalanceThreshold ?? 50,
        error: String((error as any)?.message ?? error ?? "实时查询失败"),
      }} />,
      reloadPolicy(refreshMinutes),
    )
    return
  }

  Widget.present(
    <WaterWidget data={{
      result: null,
      label: runtime?.label || "四川濯缨科技",
      title: runtime?.title || "水费查询",
      source: "none",
      lowBalanceThreshold: runtime?.lowBalanceThreshold ?? 100,
      criticalBalanceThreshold: runtime?.criticalBalanceThreshold ?? 50,
      error: String((error as any)?.message ?? error ?? "请先通过 Surge 抓取配置"),
    }} />,
    reloadPolicy(refreshMinutes),
  )
}

main()
