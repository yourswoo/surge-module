import {
  Button,
  Form,
  Navigation,
  NavigationStack,
  Script,
  Section,
  Text,
  TextField,
  Widget,
  useState,
} from "scripting"
import { buildAccounts, formatMoney, queryAccount } from "./lsep-api"
import { readRuntimeConfigFromBoxJs } from "./boxjs"

const SETTINGS_KEY = "lsep_widget_settings_v2"
const DEFAULT_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.49(0x18003123) NetType/WIFI Language/zh_CN"

type LocalSettings = {
  boxJsUrl: string
  refreshMinutes: number
  lowBalanceThreshold: number
  criticalBalanceThreshold: number
}

function readSettings(): LocalSettings {
  return {
    boxJsUrl: "https://boxjs.com",
    refreshMinutes: 30,
    lowBalanceThreshold: 20,
    criticalBalanceThreshold: 10,
    ...(Storage.get<LocalSettings>(SETTINGS_KEY) ?? {}),
  }
}

function SettingsView() {
  const saved = readSettings()
  const [boxJsUrl, setBoxJsUrl] = useState(saved.boxJsUrl)
  const [refreshMinutes, setRefreshMinutes] = useState(String(saved.refreshMinutes))
  const [lowBalanceThreshold, setLowBalanceThreshold] = useState(String(saved.lowBalanceThreshold))
  const [criticalBalanceThreshold, setCriticalBalanceThreshold] = useState(String(saved.criticalBalanceThreshold))
  const [message, setMessage] = useState("")
  const [queryOutput, setQueryOutput] = useState("")
  const [querying, setQuerying] = useState(false)

  function save() {
    const low = Math.max(0, Number(lowBalanceThreshold) || 0)
    const critical = Math.max(0, Number(criticalBalanceThreshold) || 0)
    if (critical > low) {
      setMessage("余额不足阈值不能高于余额偏低阈值")
      return
    }
    Storage.set(SETTINGS_KEY, {
      boxJsUrl: boxJsUrl.trim() || "https://boxjs.com",
      refreshMinutes: Math.max(0, Number(refreshMinutes) || 0),
      lowBalanceThreshold: low,
      criticalBalanceThreshold: critical,
    } as LocalSettings)
    Widget.reloadAll()
    setMessage("已保存显示阈值和刷新设置，并请求刷新小组件")
  }

  async function testBoxJs() {
    setMessage("正在从 BoxJs 临时读取全部查询配置…")
    try {
      const runtime = await readRuntimeConfigFromBoxJs({ baseUrl: boxJsUrl })
      const accounts = buildAccounts({
        numbers: runtime.numbers,
        tokens: runtime.tokens,
        openids: runtime.openids,
        wechaIds: runtime.wechaIds,
        labels: runtime.labels,
        title: runtime.title,
      })
      const valid = accounts.filter(account => account.number && account.token && account.openid).length
      const cookieFields = runtime.cookie.split(";").map(item => item.split("=")[0].trim()).filter(Boolean)
      setMessage(`BoxJs 读取成功：${valid} 户；${cookieFields.join("、")}`)
    } catch (error) {
      setMessage(String((error as any)?.message ?? error))
    }
  }

  async function queryNow() {
    if (querying) return
    setQuerying(true)
    setMessage("正在读取 BoxJs 并即时查询…")
    setQueryOutput("")

    try {
      const runtime = await readRuntimeConfigFromBoxJs({ baseUrl: boxJsUrl })
      const accounts = buildAccounts({
        numbers: runtime.numbers,
        tokens: runtime.tokens,
        openids: runtime.openids,
        wechaIds: runtime.wechaIds,
        labels: runtime.labels,
        title: runtime.title,
      })
      if (!accounts.length || accounts.some(account => !account.number || !account.token || !account.openid)) {
        throw new Error("BoxJs 中的户号、Token、OpenID/身份标识数量或内容不完整")
      }

      let activeCookie = runtime.cookie
      const activeUserAgent = runtime.userAgent || DEFAULT_UA
      const lines = ["BoxJs：全部查询配置实时读取成功"]

      for (const account of accounts) {
        try {
          const result = await queryAccount(account, activeCookie, activeUserAgent)
          activeCookie = result.cookie || activeCookie
          const balance = result.info.owe > 0
            ? `欠费 ¥${formatMoney(result.info.owe)}`
            : `余额 ¥${formatMoney(result.info.prepay)}`
          const meterTime = result.info.meterTime
            ? new Date(result.info.meterTime).toLocaleString()
            : "接口未提供"
          lines.push(`${account.label}（${account.number}）\n${balance}\n户名：${result.info.name || "未提供"}\n电表更新时间：${meterTime}`)
        } catch (error) {
          lines.push(`${account.label}（${account.number}）\n查询失败：${String((error as any)?.message ?? error)}`)
        }
      }

      setQueryOutput(lines.join("\n\n"))
      setMessage("即时查询完成；账户配置和 Cookie 仅在本轮运行中使用")
    } catch (error) {
      setQueryOutput(`读取或查询失败：${String((error as any)?.message ?? error)}`)
      setMessage("即时查询失败；未使用任何本地账户配置或 Cookie")
    } finally {
      setQuerying(false)
    }
  }

  return (
    <NavigationStack>
      <Form navigationTitle="乐电通电费">
        <Section
          header={<Text>BoxJs 实时读取</Text>}
          footer={<Text>户号、标签、身份标识、Token、OpenID、Cookie、UA 和标题均从 BoxJs 实时读取。</Text>}
        >
          <TextField
            title="BoxJs 地址"
            value={boxJsUrl}
            onChanged={setBoxJsUrl}
            prompt="https://boxjs.com"
          />
          <Button
            title="测试读取全部配置"
            systemImage="arrow.triangle.2.circlepath"
            action={testBoxJs}
          />
        </Section>

        <Section
          header={<Text>余额状态阈值</Text>}
          footer={<Text>所有账户统一使用：余额达到偏低阈值为绿色；低于偏低阈值但高于不足阈值为橙色；达到或低于不足阈值为红色并提示及时充值。</Text>}
        >
          <TextField
            title="余额偏低阈值（元）"
            value={lowBalanceThreshold}
            onChanged={setLowBalanceThreshold}
          />
          <TextField
            title="余额不足阈值（元）"
            value={criticalBalanceThreshold}
            onChanged={setCriticalBalanceThreshold}
          />
        </Section>

        <Section
          header={<Text>小组件刷新</Text>}
          footer={<Text>刷新时间只是向 iOS WidgetKit 发出的请求，系统可能延后执行。填 0 表示不主动指定刷新时间。</Text>}
        >
          <TextField
            title="刷新间隔（分钟）"
            value={refreshMinutes}
            onChanged={setRefreshMinutes}
          />
        </Section>

        <Section>
          <Button
            title={querying ? "正在查询…" : "立即查询电费"}
            systemImage="bolt.fill"
            action={queryNow}
          />
          <Button
            title="保存并刷新小组件"
            systemImage="arrow.clockwise"
            action={save}
          />
          <Button
            title="预览中号小组件"
            systemImage="rectangle"
            action={async () => {
              save()
              await Widget.preview({ family: "systemMedium" })
            }}
          />
          {message ? <Text foregroundStyle="secondaryLabel">{message}</Text> : null}
        </Section>

        {queryOutput ? (
          <Section header={<Text>即时查询结果</Text>}>
            <Text>{queryOutput}</Text>
          </Section>
        ) : null}
      </Form>
    </NavigationStack>
  )
}

async function run() {
  await Navigation.present({ element: <SettingsView /> })
  Script.exit()
}

run()
