import {
  Button,
  Form,
  Keychain,
  Navigation,
  NavigationStack,
  Script,
  Section,
  SecureField,
  Storage,
  Text,
  TextField,
  Widget,
  useState,
} from "scripting"

const SECRET_KEY = "lsep_widget_secrets_v1"
const SETTINGS_KEY = "lsep_widget_settings_v1"

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

const DEFAULT_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.49(0x18003123) NetType/WIFI Language/zh_CN"

function readSecrets(): SecretConfig {
  try {
    const raw = Keychain.get(SECRET_KEY)
    if (raw) return { userAgent: DEFAULT_UA, ...JSON.parse(raw) }
  } catch (_) {}
  return {
    numbers: "",
    tokens: "",
    openids: "",
    wechaIds: "",
    cookie: "",
    userAgent: DEFAULT_UA,
  }
}

function readSettings(): PublicSettings {
  return {
    title: "电费余额",
    labels: "",
    threshold: 20,
    refreshMinutes: 30,
    ...(Storage.get<PublicSettings>(SETTINGS_KEY) ?? {}),
  }
}

function SettingsView() {
  const savedSecrets = readSecrets()
  const savedSettings = readSettings()

  const [numbers, setNumbers] = useState(savedSecrets.numbers)
  const [tokens, setTokens] = useState(savedSecrets.tokens)
  const [openids, setOpenids] = useState(savedSecrets.openids)
  const [wechaIds, setWechaIds] = useState(savedSecrets.wechaIds)
  const [cookie, setCookie] = useState(savedSecrets.cookie)
  const [userAgent, setUserAgent] = useState(savedSecrets.userAgent)
  const [title, setTitle] = useState(savedSettings.title)
  const [labels, setLabels] = useState(savedSettings.labels)
  const [threshold, setThreshold] = useState(String(savedSettings.threshold))
  const [refreshMinutes, setRefreshMinutes] = useState(String(savedSettings.refreshMinutes))
  const [message, setMessage] = useState("")

  function save() {
    if (!numbers.trim() || !tokens.trim() || !openids.trim()) {
      setMessage("请至少填写户号、Token 和 OpenID")
      return
    }

    const secretConfig: SecretConfig = {
      numbers: numbers.trim(),
      tokens: tokens.trim(),
      openids: openids.trim(),
      wechaIds: wechaIds.trim(),
      cookie: cookie.trim(),
      userAgent: userAgent.trim() || DEFAULT_UA,
    }
    const publicSettings: PublicSettings = {
      title: title.trim() || "电费余额",
      labels: labels.trim(),
      threshold: Math.max(0, Number(threshold) || 0),
      refreshMinutes: Math.max(0, Number(refreshMinutes) || 0),
    }

    const saved = Keychain.set(SECRET_KEY, JSON.stringify(secretConfig), {
      accessibility: "first_unlock_this_device",
    })
    Storage.set(SETTINGS_KEY, publicSettings)

    if (!saved) {
      setMessage("钥匙串保存失败，请解锁设备后重试")
      return
    }

    Widget.reloadAll()
    setMessage("已保存，并请求刷新小组件")
  }

  return (
    <NavigationStack>
      <Form navigationTitle="乐电通小组件">
        <Section
          header={<Text>账户配置</Text>}
          footer={<Text>多户配置使用英文逗号分隔，并按相同顺序对应；单个 Token 或 OpenID 会自动用于所有户。</Text>}
        >
          <TextField
            title="户号"
            value={numbers}
            onChanged={setNumbers}
            prompt="例如：12345,67890"
          />
          <TextField
            title="户名"
            value={labels}
            onChanged={setLabels}
            prompt="例如：我家,父母家"
          />
          <SecureField
            title="Token"
            value={tokens}
            onChanged={setTokens}
            prompt="缴费页 URL 中的 token"
          />
          <SecureField
            title="OpenID"
            value={openids}
            onChanged={setOpenids}
            prompt="微信身份标识"
          />
          <SecureField
            title="wechaId（可选）"
            value={wechaIds}
            onChanged={setWechaIds}
            prompt="留空时使用 OpenID"
          />
        </Section>

        <Section
          header={<Text>会话</Text>}
          footer={<Text>Cookie 格式：PHPSESSID=xxx; tgw_l7_route=xxx。可从 Surge BoxJS 中复制；数据只保存在当前 Scripting 项目的系统钥匙串里。</Text>}
        >
          <SecureField
            title="共享 Cookie"
            value={cookie}
            onChanged={setCookie}
            prompt="PHPSESSID=...; tgw_l7_route=..."
          />
          <TextField
            title="微信 User-Agent"
            value={userAgent}
            onChanged={setUserAgent}
            prompt="留空时使用内置微信 UA"
          />
        </Section>

        <Section
          header={<Text>显示与刷新</Text>}
          footer={<Text>刷新时间只是向 iOS WidgetKit 发出的请求，系统可能延后执行。填 0 表示不主动指定刷新时间。</Text>}
        >
          <TextField
            title="标题"
            value={title}
            onChanged={setTitle}
          />
          <TextField
            title="低余额阈值（元）"
            value={threshold}
            onChanged={setThreshold}
          />
          <TextField
            title="刷新间隔（分钟）"
            value={refreshMinutes}
            onChanged={setRefreshMinutes}
          />
        </Section>

        <Section>
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
      </Form>
    </NavigationStack>
  )
}

async function run() {
  await Navigation.present({ element: <SettingsView /> })
  Script.exit()
}

run()
