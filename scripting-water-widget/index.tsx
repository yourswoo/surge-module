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
import { formatMoney, formatUsage, queryWater } from "./water-api"

const SETTINGS_KEY = "water_widget_settings_v1"

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
      setMessage(`读取成功：${config.label}；身份参数完整；Cookie ${config.credentials.cookie ? "已获取" : "为空（可正常查询）"}`)
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
      const result = await queryWater(config.credentials, config.months)
      const latest = result.bills[0]
      setOutput([
        `${config.label}（${result.account.customerNo || "户号未提供"}）`,
        `账户余额：¥${formatMoney(result.account.balance)}`,
        `本期应收：¥${formatMoney(result.account.receivable)}`,
        latest ? `最近账单：${latest.month} · ${formatUsage(latest.usage)} 吨 · ¥${formatMoney(latest.amount)} · ${latest.status}` : "最近账单：暂无",
        `共读取 ${result.bills.length} 条历史账单（请求最近 ${config.months} 个月）`,
      ].join("\n"))
      setMessage("查询成功")
    } catch (error) {
      setOutput(`查询失败：${String((error as any)?.message ?? error)}`)
      setMessage("请检查 Surge 是否已抓取配置以及 BoxJS 是否可访问")
    } finally {
      setQuerying(false)
    }
  }

  return (
    <NavigationStack>
      <Form navigationTitle="夹江水费查询">
        <Section
          header={<Text>BoxJS 实时配置</Text>}
          footer={<Text>身份参数、Cookie、账户标签、查询月数和刷新间隔均在小组件运行时从 BoxJS 读取，不复制到本地设置。</Text>}
        >
          <TextField title="BoxJS 地址" value={boxJsUrl} onChanged={setBoxJsUrl} prompt="https://boxjs.com" />
          <Button title="测试读取配置" systemImage="arrow.triangle.2.circlepath" action={testBoxJs} />
        </Section>

        <Section>
          <Button title={querying ? "正在查询…" : "立即查询水费"} systemImage="drop.fill" action={queryNow} />
          <Button title="保存并刷新小组件" systemImage="arrow.clockwise" action={save} />
          <Button title="预览中号小组件" systemImage="rectangle" action={async () => { save(); await Widget.preview({ family: "systemMedium" }) }} />
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
