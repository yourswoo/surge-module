# 乐电通电费

这是乐电通电费 Scripting 小组件，通过 BoxJs HTTP 查询接口实时读取全部查询配置，并提供自适应明暗主题、双户余额和月度用电金额统计。

## 工作方式

每次点击“测试读取全部配置”“立即查询电费”或刷新小组件时，脚本都会读取：

`lsep_balance_number`、`lsep_balance_label`、`lsep_balance_token`、`lsep_balance_openid`、`lsep_balance_wechaId`、`lsep_balance_cookie`、`lsep_balance_ua` 和 `lsep_balance_title`。

这些值只在当前一次查询中使用。脚本不会把账户字段或 Cookie 写入 Scripting 的 Keychain 或 Storage，也不会使用本地账户配置或 Cookie 兜底。Scripting 本地仅保存 BoxJs 地址、刷新间隔、统一余额阈值、手动设置的当月初始金额、余额显示缓存和月度统计账本。

余额状态由两个全局阈值控制：默认低于 20 元显示橙色“余额偏低”，达到或低于 10 元显示红色“余额不足，请及时充值”，其余显示绿色“余额正常”。

中号小组件显示 BoxJs 中前两户的信息。每户分别记录本月用电金额：余额下降计入用电，余额增加视为充值且不会冲减累计值。配置页可按账户顺序手动校准当前月份的月初金额；留空则采用当月首次成功查询的余额。

## 测试步骤

1. 确认 BoxJs 的 `lsep_balance_cookie` 已有有效值。
2. 导入 `lsep-electricity-widget.scripting`。
3. 保持 BoxJs 地址为 `https://boxjs.com`。
4. 点击“测试读取全部配置”。
5. 读取成功后，点击“立即查询电费”。

原 Surge API 版本已在仓库的 `backups/surge-api/` 中保留。
