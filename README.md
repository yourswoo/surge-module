# 港华燃气账户查询（Surge 模块 + Scripting 小组件）

自动抓取港华燃气（Towngas）微信/支付宝小程序的登录凭证，在 Surge 面板与 iOS 小组件中展示余额、待缴、表数、阶梯气价与历史账单。

## 工作原理

- **双端 Bearer 自动抓取**：
  - 微信端：打开港华小程序 → oauth `accessToekn` 响应自动换新 Bearer
  - 支付宝端：打开支付宝内港华小程序 → oauth `union` 响应自动换新 Bearer
  - 两端后端相同（`weixin.towngasvcc.com/nv1/vcc-cbs`），签名均为 `MD5(排序参数 + "hbasesoft.com-prod")`
- **无限接力续签（v1.4.0 新增）**：
  - oauth 响应中的 `refresh_token` 一并抓取保存，调度器每 100 分钟自动调用隐藏端点
    `oauth/authorize2/refreshToken` 换全新的 access_token + refresh_token（滚动签发）
  - token 寿命 2 小时（固定过期，非滑动），接力间隔 100 分钟留 20 分钟余量
  - refresh_token 为一次性令牌（消费即失效、旧 access 同步吊销），脚本严格串行使用最新一代
  - 接力链断开时（如设备长时间关机）推送提醒，重新打开一次小程序即可恢复；面板查询时也会自愈接力
- **账户 ID 抓取**：首次使用需进入「充值购气」页，从 `preCheck`/`gasStepFee` 请求补齐 `subsId` 和 `orgId`
- **查询链路**：面板刷新 / 静默续期 / 定时通知三种模式，均实时生成 `timestamp + sign`
- **小组件**：每次刷新从 BoxJS 读取凭证，查询失败时回退到最近缓存并标记

## 使用步骤

1. Surge 安装 `towngas.sgmodule` 模块（BoxJS 配置页 `towngas.boxjs.json`）
2. 打开微信或支付宝里的港华燃气小程序 → 自动抓取 Bearer（会收到通知）
3. 进入「充值购气」页 → 补齐户号 ID 和燃气公司 ID
4. 面板/小组件即显示余额、表数、阶梯用量等信息；之后每 100 分钟自动接力续签 token，无需再打开小程序
5. 若收到「接力链已断开」通知（如设备长时间关机导致），打开一次小程序即自动恢复

## 文件结构

- `towngas.sgmodule` — Surge 模块（MITM 抓包 + 面板 + cron）
- `towngas.js` — 核心脚本（capture / capture-oauth / panel / refresh / token-refresh / cron 六种模式）
- `towngas.boxjs.json` — BoxJS 配置面板
- `towngas.png` — 图标
- `scripting-towngas-widget/` — Scripting 小组件源码（`package.py` 打包为 `towngas-widget.scripting`）

## 安全提醒

- 身份凭证仅在运行时从 BoxJS 读取，不写入 Scripting 设置或结果缓存
- `抓包数据/` 目录含真实凭证，已在 `.gitignore` 中排除，请勿上传 GitHub

