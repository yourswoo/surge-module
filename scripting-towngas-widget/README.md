# 港华燃气 Scripting 小组件

小组件每次刷新时从 BoxJS 读取 Surge 抓取的 Bearer、Cookie、UA、Referer、`subsId` 和 `orgId`，现场生成 `timestamp + sign` 后查询余额、待缴、表数、阶梯额度与历史账单。

- 中号组件包含当前阶梯内的额度进度条。
- 查询失败时显示最近一次成功结果，并标记为缓存数据。
- 身份凭证仅在运行时从 BoxJS 读取，不写入 Scripting 设置或结果缓存。
- 请勿将 BoxJS 备份、抓包文件或查询凭证上传到 GitHub。
