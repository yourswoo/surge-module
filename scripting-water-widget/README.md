# 夹江水费查询 Scripting 小组件

小组件每次刷新时从 BoxJS 读取 Surge 抓取的 `appId`、`openId`、`customerId`、Cookie 和 User-Agent，然后查询账户余额、当期应收与历史账单。

- 支持小号、中号和大号桌面组件。
- 查询失败时显示最近一次成功查询的缓存，并明确标记为缓存数据。
- Cookie 会随请求携带，但不是必填项；当前接口实际依赖三个表单身份参数。
- 身份参数只在运行时从 BoxJS 读取，不写入 Scripting 的本地设置或查询缓存。
