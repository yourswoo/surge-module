# 港华燃气 Surge + BoxJS + Scripting 小组件

本模块复用 LSEP 电费查询的工作流：Surge 负责在微信港华燃气页面抓取已签名的查询请求，BoxJS 保存运行时凭证，Scripting 小组件每次刷新时读取 BoxJS 并查询余额、待缴、表数、阶梯额度和历史账单。

## 文件

- `towngas.sgmodule`：Surge 模块，包含直连、面板、请求抓取和 MITM 规则。
- `towngas.js`：Surge 抓取/面板脚本。
- `towngas.boxjs.json`：BoxJS 订阅配置，所有敏感默认值均为空。
- `towngas-widget.scripting`：可直接导入 Scripting App 的小组件包。
- `scripting-towngas-widget/`：小组件源码和打包脚本。

## 安装顺序

1. 在 BoxJS 添加 `https://raw.githubusercontent.com/yourswoo/surge-module/refs/heads/gasbill/towngas.boxjs.json`。
2. 在 Surge 安装 `https://raw.githubusercontent.com/yourswoo/surge-module/refs/heads/gasbill/towngas.sgmodule`，确认 MITM 主机名包含 `weixin.towngasvcc.com`，并已信任 Surge 证书。
3. 保持 Surge 开启，在微信港华燃气页面中进入“充值购气”，抓取 `preCheck` 和 `gasStepFee`。
4. 再进入“历史账单”，抓取 `queryHistoryFee`。收到“余额、阶梯和历史账单配置已齐全”通知后，可在 BoxJS 中检查配置。
5. 下载并导入 `https://raw.githubusercontent.com/yourswoo/surge-module/refs/heads/gasbill/towngas-widget.scripting`，打开脚本后先点“测试读取配置”，再点“立即查询燃气账户”。
6. 查询成功后，从 iOS 桌面添加 Scripting 小组件并选择“港华燃气”。

## 数据与安全

- GitHub 仓库只保存 BoxJS 键名和空默认值，不包含 Bearer、Cookie、户号、签名 URL、姓名、地址或抓包响应。
- Bearer、Cookie、UA、Referer、`subsId`、`orgId` 和三个已签名 URL 均由 Surge 在用户设备上写入 BoxJS。
- Scripting 每次运行时从 BoxJS 读取凭证，查询结果缓存不包含 Bearer、Cookie 或签名 URL。
- 接口 URL 在发送前会校验为 `https://weixin.towngasvcc.com/nv1/vcc-cbs/charge/*`，防止将授权头发送到其他域名。
- 已签名 URL 可能过期。如出现签名或授权失效，重新打开上述两个微信页面即可刷新 BoxJS。

## 小组件行为

- 小号：余额、表数、未出账用量和当前阶梯进度。
- 中号：余额、最近账单、当前阶梯区间、阶梯内已用/总额度进度条和距下一阶梯余量。
- 大号：余额、阶梯进度和最近六期燃气账单。
- 实时查询失败时使用最近一次成功结果，并显示橙色缓存状态点。

## 第一版限制

- 当前为单户版。
- 依赖 Surge 抓取官方 H5 生成的完整 `timestamp + sign` URL，未在脚本中复制或猜测服务端签名算法。
- 只调用三个 GET 查询接口，不执行充值、缴费或账户修改。

## 重新打包

```bash
python3 scripting-towngas-widget/package.py
```

生成文件为 `towngas-widget.scripting`。
