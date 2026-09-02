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
import { readRuntimeConfig } from "./boxjs"
import { formatMoney, formatUsage, queryGas } from "./towngas-api"

const SETTINGS_KEY = "towngas_widget_settings_v1"

type LocalSettings = { boxJsUrl: string }

function loadSettings(): LocalSettings {
  return { boxJsUrl: "https://boxjs.com", ...(Storage.get<LocalSettings>(SETTINGS_KEY) ?? {}) }
}

function SettingsView() {
  const saved = loadSettings()
  const [boxJsUrl, setBoxJsUrl] = useState(saved.boxJsUrl)
  const [message, setMessage] = useState("")
  const [output, setOutput] = useState("")
  const [querying, setQuerying] = useState(false)

  function save() {
    Storage.set(SETTINGS_KEY, { boxJsUrl: boxJsUrl.trim() || "https://boxjs.com" } as LocalSettings)
    Widget.reloadAll()
    setMessage("已保存 BoxJS 地址并请求刷新小组件")
  }

  async function testBoxJs() {
    setMessage("正在读取 BoxJS…")
    try {
      const config = await readRuntimeConfig(boxJsUrl)
      setMessage(`读取成功：${config.label}；Bearer 和三个签名接口已齐全`)
    } catch (error) {
      setMessage(String((error as any)?.message ?? error))
    }
  }

  async function queryNow() {
    if (querying) return
    setQuerying(true)
    setOutput("")
    setMessage("正在从 BoxJS 读取配置并查询…")
    try {
      const config = await readRuntimeConfig(boxJsUrl)
      const result = await queryGas(config.credentials)
      const latest = result.bills[0]
      const tierQuota = result.tier.quota === null
        ? "不限额"
        : `${formatUsage(result.tier.usedInTier)} / ${formatUsage(result.tier.quota)} 方`
      setOutput([
        `${config.label}（${result.account.subscriberCode || "户号未提供"}）`,
        `账户余额：¥${formatMoney(result.account.balance)}`,
        `当前待缴：¥${formatMoney(result.account.due)}`,
        `当前表数：${formatUsage(result.account.currentReading)}；未出账：${formatUsage(result.unbilledUsage)} 方`,
        `年度累计：${formatUsage(result.annualUsage)} 方；${result.tier.name}：${tierQuota}`,
        result.tier.remaining === null ? "当前阶梯无上限" : `距下一阶梯：${formatUsage(result.tier.remaining)} 方`,
        latest ? `最近账单：${latest.month} · ${formatUsage(latest.usage)} 方 · ¥${formatMoney(latest.amount)} · ${latest.state}` : "最近账单：暂无",
      ].join("\n"))
      setMessage("查询成功；凭证仅在本轮运行中从 BoxJS 读取")
    } catch (error) {
      setOutput(`查询失败：${String((error as any)?.message ?? error)}`)
      setMessage("请在 Surge 启用模块后，重新打开充值购气和历史账单页")
    } finally {
      setQuerying(false)
    }
  }

  return (
    <NavigationStack>
      <Form navigationTitle="港华燃气">
        <Section
          header={<Text>BoxJS 实时配置</Text>}
          footer={<Text>Bearer、Cookie、户号和签名 URL 由 Surge 抓取并保存在 BoxJS，不会写入 Scripting 本地设置或 GitHub。</Text>}
        >
          <TextField title="BoxJS 地址" value={boxJsUrl} onChanged={setBoxJsUrl} prompt="https://boxjs.com" />
          <Button title="测试读取配置" systemImage="arrow.triangle.2.circlepath" action={testBoxJs} />
        </Section>

        <Section>
          <Button title={querying ? "正在查询…" : "立即查询燃气账户"} systemImage="flame.fill" action={queryNow} />
          <Button title="保存并刷新小组件" systemImage="arrow.clockwise" action={save} />
          <Button title="预览中号阶梯进度组件" systemImage="rectangle" action={async () => { save(); await Widget.preview({ family: "systemMedium" }) }} />
          {message ? <Text foregroundStyle="secondaryLabel">{message}</Text> : null}
        </Section>

        {output ? <Section header={<Text>查询结果</Text>}><Text>{output}</Text></Section> : null}
      </Form>
    </NavigationStack>
  )
}

async function run() {
  await Navigation.present({ element: <SettingsView /> })
  Script.exit()
}

run()
