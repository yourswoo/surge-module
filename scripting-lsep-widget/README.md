# 乐电通电费 · BoxJs 直读版

这是乐电通电费 Scripting 小组件，通过 BoxJs HTTP 查询接口实时读取乐电通的全部查询配置。

## 工作方式

每次点击“测试读取全部配置”“立即查询电费”或刷新小组件时，脚本都会读取：

`lsep_balance_number`、`lsep_balance_label`、`lsep_balance_token`、`lsep_balance_openid`、`lsep_balance_wechaId`、`lsep_balance_cookie`、`lsep_balance_ua`、`lsep_balance_title` 和 `lsep_balance_threshold`。

这些值只在当前一次查询中使用。脚本不会把账户字段或 Cookie 写入 Scripting 的 Keychain 或 Storage，也不会使用本地账户配置或 Cookie 兜底。Scripting 本地仅保存 BoxJs 地址、刷新间隔和余额显示缓存。

## 测试步骤

1. 确认 BoxJs 的 `lsep_balance_cookie` 已有有效值。
2. 导入 `lsep-electricity-widget.scripting`。
3. 保持 BoxJs 地址为 `https://boxjs.com`。
4. 点击“测试读取全部配置”。
5. 读取成功后，点击“立即查询电费”。

原 Surge API 版本已在仓库的 `backups/surge-api/` 中保留。
