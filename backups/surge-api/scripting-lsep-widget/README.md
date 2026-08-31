# 乐电通电费小组件（Scripting App）

这是为 iOS **Scripting** App 编写的乐电通电费小组件项目，支持：

- 小号、中号、大号主屏幕小组件
- 锁屏圆形与矩形小组件
- 单户或多户余额展示
- 欠费、低余额状态颜色
- 查询失败时显示上次缓存
- 自定义刷新请求间隔
- 通过本机 Surge HTTP API 自动同步已抓取的 Cookie 与微信 UA
- 配置页明文检查 Cookie，并可立即查询逐户余额与错误原因
- 敏感配置保存到当前脚本独立的系统钥匙串，不写入源码

## 安装

### 远程安装（推荐）

在安装了 Scripting App 的 iPhone 上打开下面的链接：

[一键安装乐电通电费小组件](https://scripting.fun/import_scripts?urls=%5B%22https%3A%2F%2Fraw.githubusercontent.com%2Fyourswoo%2Fsurge-module%2Frefs%2Fheads%2Fmodules%2Flsep-electricity-widget.scripting%22%5D)

安装完成后运行一次“乐电通电费”，填写账户信息并保存。安装包内已配置每日检查一次远程更新。

如果安装过 `1.0.0` 或 `1.0.1` 且点击无法运行，请先删除旧的“乐电通电费”，再通过上面的链接安装最新版。旧版存在不兼容的 Scripting API 导入，不能依赖应用内更新自行修复。

### 手动安装

1. 在 Scripting App 中新建一个脚本项目，例如“乐电通电费”。
2. 将本目录的 `index.tsx`、`widget.tsx`、`lsep-api.ts`、`surge.ts` 和 `script.json` 放入该项目，覆盖同名文件。
3. 在 Scripting 中运行一次项目，填写账户信息并保存。
4. 在 iOS 主屏幕添加 Scripting 小组件，长按编辑并选择该脚本。

## 配置说明

- `户号`、`Token`、`OpenID`：必填。
- `wechaId`：通常可留空，脚本会使用 OpenID。
- `Cookie`：推荐从 Surge BoxJS 的 `lsep_balance_cookie` 复制，格式为：

  `PHPSESSID=xxx; tgw_l7_route=xxx`

- Surge 自动同步：在 Surge `[General]` 中启用 `http-api`，然后在 Scripting 中填写本机 API 地址与密钥。脚本只读取 `lsep_balance_cookie` 和 `lsep_balance_ua`，同步失败时使用手动 Cookie 或上次成功值。
- “立即查询电费”会使用配置页当前尚未保存的内容查询，并逐户显示余额、户名、电表更新时间或具体错误；查询过程中续借到的新 Cookie 会显示在明文输入框中，确认后再保存。

- 多户使用英文逗号分隔，各字段按相同顺序对应；Token/OpenID 只填一个时会广播给所有户。
- 刷新间隔填 `0` 时不主动指定刷新时间；非零值最低按 15 分钟请求。实际刷新由 iOS WidgetKit 调度，不能保证精确准点。

## 安全说明

户号、Token、OpenID、Cookie、UA 与 Surge API 密钥存在 Scripting 的每脚本独立 Keychain 中。仓库文件不包含任何真实账户值。Surge API 地址被限制为 `127.0.0.1` 或 `localhost`，避免把控制接口发送到外部主机。

乐电通接口使用明文 HTTP。本脚本仅对固定的 `lsep.wegist.cn` 查询链路启用 Scripting 的 `allowInsecureRequest`，不会向其他域名发送账户配置。
