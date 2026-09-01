# 乐电通电费

这是乐电通电费 Scripting 小组件，通过 BoxJs HTTP 查询接口实时读取全部查询配置，并提供自适应明暗主题、双户余额和月度用电金额统计。

## 工作方式

每次点击“测试读取全部配置”“立即查询电费”或刷新小组件时，脚本都会读取：

`lsep_balance_number`、`lsep_balance_label`、`lsep_balance_token`、`lsep_balance_openid`、`lsep_balance_wechaId`、`lsep_balance_cookie`、`lsep_balance_ua`、`lsep_balance_title`、`lsep_balance_threshold`、`lsep_balance_critical_threshold`、`lsep_balance_monthly_opening` 和 `lsep_balance_monthly_opening_month`。

这些值只在当前一次查询中使用。脚本不会把账户字段、Cookie、余额阈值或每月初始余额写入 Scripting 的 Keychain 或设置存储，也不会使用这些字段的本地配置兜底。Scripting 本地仅保存 BoxJs 地址、刷新间隔、余额显示缓存和月度统计账本。

余额状态由 BoxJs 中的两个全局阈值控制：默认低于 20 元显示橙色“余额偏低”，达到或低于 10 元显示红色“余额不足，请及时充值”，其余显示绿色“余额正常”。

标题栏使用结果变化状态提示：最近 12 小时内余额或电表更新时间发生过变化时只显示绿色圆点；连续超过 12 小时没有变化，或本轮查询失败而使用缓存时，显示黄色圆点及上次数据变化时间。旧版缓存会自动沿用最近一次成功查询时间，不需要清除数据。

中号小组件显示 BoxJs 中前两户的信息。每户分别记录本月用电金额：余额下降计入用电，余额增加视为充值且不会冲减累计值。可在 BoxJs 中按账户顺序填写每月初始余额，并填写对应月份；留空或月份不匹配时采用当月首次成功查询的余额。组件还会通过 `waterChargesQuery` 查询上一个自然月账单；账单尚未出现在接口列表中时显示“账单未出”。

## 测试步骤

1. 确认 BoxJs 的 `lsep_balance_cookie` 已有有效值。
2. 导入 `lsep-electricity-widget.scripting`。
3. 保持 BoxJs 地址为 `https://boxjs.com`。
4. 点击“测试读取全部配置”。
5. 读取成功后，点击“立即查询电费”。

原 Surge API 版本已在仓库的 `backups/surge-api/` 中保留。
