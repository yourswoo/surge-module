# 港华燃气账户查询（Surge 模块 + Scripting 小组件）

自动抓取港华燃气（Towngas）微信/支付宝小程序的登录凭证，在 Surge 面板与 iOS 小组件中展示余额、待缴、表数、阶梯气价与历史账单。

## 工作原理

- **双端 Bearer 自动抓取**：
  - 微信端：打开港华小程序 → oauth `accessToekn` 响应自动换新 Bearer
  - 支付宝端：打开支付宝内港华小程序 → oauth `union` 响应自动换新 Bearer
  - 两端后端相同（`weixin.towngasvcc.com/nv1/vcc-cbs`），签名均为 `MD5(排序参数 + "hbasesoft.com-prod")`
- **账户 ID 抓取**：首次使用需进入「充值购气」页，从 `preCheck`/`gasStepFee` 请求补齐 `subsId` 和 `orgId`
- **查询链路**：面板刷新 / 静默续期 / 定时通知三种模式，均实时生成 `timestamp + sign`
- **小组件**：每次刷新从 BoxJS 读取凭证，查询失败时回退到最近缓存并标记

## 使用步骤

1. Surge 安装 `towngas.sgmodule` 模块（BoxJS 配置页 `towngas.boxjs.json`）
2. 打开微信或支付宝里的港华燃气小程序 → 自动抓取 Bearer（会收到通知）
3. 进入「充值购气」页 → 补齐户号 ID 和燃气公司 ID
4. 面板/小组件即显示余额、表数、阶梯用量等信息

## 文件结构

- `towngas.sgmodule` — Surge 模块（MITM 抓包 + 面板 + cron）
- `towngas.js` — 核心脚本（capture / capture-oauth / panel / refresh / cron 五种模式）
- `towngas.boxjs.json` — BoxJS 配置面板
- `towngas.png` — 图标
- `scripting-towngas-widget/` — Scripting 小组件源码（`package.py` 打包为 `towngas-widget.scripting`）

## 安全提醒

- 身份凭证仅在运行时从 BoxJS 读取，不写入 Scripting 设置或结果缓存
- `抓包数据/` 目录含真实凭证，已在 `.gitignore` 中排除，请勿上传 GitHub

