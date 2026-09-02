# 港华燃气 Surge + BoxJS + Scripting 小组件

本模块使用 Surge 在微信港华燃气页面抓取主业务 Bearer 与账户 ID，BoxJS 保存运行时配置；Surge 和 Scripting 每次查询时现场生成 `timestamp + sign`，无需保存会过期的完整签名 URL。

## 文件

- `towngas.sgmodule`：Surge 模块，包含直连、面板、静默会话续期、定时通知、请求抓取和 MITM 规则。
- `towngas.js`：Surge 抓取/面板脚本。
- `towngas.boxjs.json`：BoxJS 订阅配置，所有敏感默认值均为空。
- `towngas-widget.scripting`：可直接导入 Scripting App 的小组件包。
- `scripting-towngas-widget/`：小组件源码和打包脚本。

## 安装顺序

1. 在 BoxJS 添加 `https://raw.githubusercontent.com/yourswoo/surge-module/refs/heads/gasbill/towngas.boxjs.json`。
2. 在 Surge 安装 `https://raw.githubusercontent.com/yourswoo/surge-module/refs/heads/gasbill/towngas.sgmodule`，确认 MITM 主机名包含 `weixin.towngasvcc.com`，并已信任 Surge 证书。
3. 保持 Surge 开启并进入微信港华燃气页面，`getLoginUserInfo` 会自动更新主业务 Bearer、Cookie、UA 和 Referer。
4. 进入一次“充值购气”，让模块从 `preCheck / gasStepFee` 补齐 `subsId` 与 `orgId`。收到“Bearer、户号 ID 和燃气公司 ID 已齐全”通知后，可在 BoxJS 中检查配置；无需再进入历史账单页抓取 URL。
5. 下载并导入 `https://raw.githubusercontent.com/yourswoo/surge-module/refs/heads/gasbill/towngas-widget.scripting`，打开脚本后先点“测试读取配置”，再点“立即查询燃气账户”。
6. 查询成功后，从 iOS 桌面添加 Scripting 小组件并选择“港华燃气”。

## Surge 后台任务

- `session_refresh` 默认值为 `80`，表示每满 80 分钟静默查询一次账户接口，并将响应中的新 Cookie 合并写回 BoxJS；填写 `0` 可关闭。
- Surge 每 10 分钟唤醒一次轻量检查，未满 80 分钟不会发起网络请求；默认每天实际查询约 18 次。
- `cronexp` 默认每天 `09:00`，用于查询账户并推送一次 Surge 通知；会话续期无论成功或失败都不会发送通知。
- 修改模块参数后，需要在 Surge 中重新加载模块。

## 数据与安全

- GitHub 仓库只保存 BoxJS 键名和空默认值，不包含 Bearer、Cookie、户号、姓名、地址或抓包响应。
- Bearer、Cookie、UA、Referer、`subsId` 和 `orgId` 仅由 Surge 在用户设备上写入 BoxJS。
- `timestamp` 与 `sign` 每次查询实时生成，完整查询 URL 不写入 BoxJS；旧版本遗留的三个 URL 键不再读取，也不会被代码上传。
- Scripting 查询目标由代码固定为 `https://weixin.towngasvcc.com/nv1/vcc-cbs/charge/*`，授权头不会发送到其他域名。
- 保险接口使用另一套 Authorization，抓取规则明确排除 `interInsure`，不会覆盖燃气主业务 Bearer。

## 小组件行为

- 小号：余额、表数、未出账用量和当前阶梯进度。
- 中号：余额、最近账单、当前阶梯区间、阶梯内已用/总额度进度条和距下一阶梯余量。
- 大号：余额、阶梯进度和最近六期燃气账单。
- 实时查询失败时使用最近一次成功结果，并显示橙色缓存状态点。

## 第一版限制

- 当前为单户版。
- Bearer 失效后仍需要打开一次微信港华燃气页面触发官方 OAuth；模块会从首个主业务请求自动更新，无需手工复制。
- 只调用三个 GET 查询接口，不执行充值、缴费或账户修改。

## 重新打包

```bash
python3 scripting-towngas-widget/package.py
```

生成文件为 `towngas-widget.scripting`。
