# 云润水费 Surge + BoxJS + Scripting 小组件

本项目复用乐电通电费组件的工作流：Surge 负责在微信水费页面抓取查询身份参数，BoxJS 负责保存和编辑配置，Scripting 小组件实时读取 BoxJS 后查询余额和历史账单。

## 文件

- `water-bill.sgmodule`：Surge 模块，包含直连、请求抓取和 MITM 规则。
- `water-bill.js`：Surge HTTP 请求抓取脚本。
- `water-bill.boxjs.json`：BoxJS 订阅配置。
- `water-bill-widget.scripting`：可直接导入 Scripting App 的小组件包。
- `scripting-water-widget/`：小组件源代码及打包脚本。

## 安装顺序

1. 在 BoxJS 添加 `https://raw.githubusercontent.com/yourswoo/surge-module/refs/heads/waterbill/water-bill.boxjs.json`。
2. 在 Surge 安装 `https://raw.githubusercontent.com/yourswoo/surge-module/refs/heads/waterbill/water-bill.sgmodule`，确认模块的 MITM 主机名包含 `wx.chinayunrun.com`，并信任 Surge 证书。
3. 保持 Surge 开启，在微信中进入水费账单列表或缴费页面。出现“水费查询配置已更新”后，在 BoxJS 的“云润水费查询”中确认三个身份参数已经写入。
4. 下载并导入 `https://raw.githubusercontent.com/yourswoo/surge-module/refs/heads/waterbill/water-bill-widget.scripting`，打开脚本后先点“测试读取配置”，再点“立即查询水费”。
5. 查询成功后，从 iOS 桌面添加 Scripting 小组件并选择“云润水费”。

## 数据与安全

- 查询必需：`appId`、`openId`、`customerId`。
- 可选：Cookie、微信 User-Agent。Cookie 会被抓取并随请求携带，但实测接口不会校验 Cookie 值。
- `openId` 与 `customerId` 可以读取账户水费，属于敏感凭据。不要提交到仓库、截图分享或输出到公开日志。
- 小组件只缓存查询结果，不缓存身份参数；身份参数每次运行时从 BoxJS 读取。

## 小组件行为

- 小号：账户余额、最近一期用水量和水费。
- 中号：余额、最近账单和最近三期账单。
- 大号：余额、账户摘要和最近六期账单。
- 实时查询失败时使用最近一次成功结果，并显示“缓存”标记。
- 刷新间隔和查询月份可在 BoxJS 修改；iOS 可能根据系统调度延后刷新。

## 重新打包

在项目目录运行：

```bash
python3 scripting-water-widget/package.py
```

生成文件为 `water-bill-widget.scripting`。
