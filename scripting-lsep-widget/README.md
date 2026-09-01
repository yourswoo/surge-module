# 乐山电力电费小组件

在 iPhone 和 iPad 的 Scripting 小组件中查看乐山电力账户信息。账户配置由 Surge、Quantumult X 等支持脚本与 BoxJS 的网络工具从“乐电通公众号”保存到本机，Scripting 随后读取这些配置并查询电费。

## 主要功能

- 支持单户和多户电费账户。
- 显示当前余额、欠费和余额预警状态。
- 余额正常、偏低、余额不足或欠费时，金额、⚡符号和胶囊会显示对应颜色。
- 支持浅色与深色模式。
- 统计本月已用电金额，并查询上一个自然月的电费账单。
- 上月账单尚未生成时显示“账单未出”。
- 数据 12 小时内有变化时显示绿色圆点；超过 12 小时没有变化时显示黄色圆点和上次更新时间。
- 可在 BoxJS 中修改户名、余额阈值和每月初始余额。

## 使用方法

### 1. 准备网络工具和 BoxJS

安装一款支持脚本重写和 BoxJS 的网络工具，例如 Surge 或 Quantumult X，并安装 BoxJS。

本仓库当前直接提供 Surge 模块；使用其他网络工具时，需要按照对应工具的格式添加相同的脚本配置。

- [安装 Surge 乐电通模块](https://raw.githubusercontent.com/yourswoo/surge-module/refs/heads/modules/dianfei.js)
- [添加乐电通 BoxJS 配置](https://raw.githubusercontent.com/yourswoo/surge-module/refs/heads/modules/lsep.boxjs.json)

安装完成后，请启用对应模块和网络工具。

### 2. 从乐电通公众号保存配置

1. 打开微信中的“乐电通公众号”。
2. 进入电费查询页面并正常查询一次电费。
3. 看到“已抓取到乐电通 Cookie”的提示后，户号、Token、OpenID、Cookie 和微信 UA 等查询配置会保存到本机 BoxJS。
4. 打开 BoxJS 中的“乐电通电费”，确认账户信息已经出现。多户用户可分别查询一次，并在 BoxJS 中调整户名标签、余额阈值和每月初始余额。

### 3. 安装 Scripting 小组件脚本

先在 App Store 安装 Scripting，然后导入本项目脚本：

- [一键导入乐山电力电费小组件](https://scripting.fun/import_scripts?urls=%5B%22https%3A%2F%2Fraw.githubusercontent.com%2Fyourswoo%2Fsurge-module%2Frefs%2Fheads%2Fmodules%2Flsep-electricity-widget.scripting%22%5D)
- [直接下载安装包](https://raw.githubusercontent.com/yourswoo/surge-module/refs/heads/modules/lsep-electricity-widget.scripting)

导入后打开“乐电通电费”脚本：

1. 保持 BoxJS 地址为 `https://boxjs.com`。
2. 点击“测试读取全部配置”，确认能够读取账户和 Cookie。
3. 点击“立即查询电费”，检查余额查询是否成功。
4. 设置小组件刷新间隔，然后点击“保存并刷新小组件”。

### 4. 添加到桌面

1. 长按 iOS 桌面空白处并点击添加小组件。
2. 搜索并选择 Scripting。
3. 添加小号、中号或其他支持的尺寸。
4. 编辑小组件并选择“乐电通电费”脚本。

建议保持网络工具和乐电通模块启用。Surge 模块会静默维持 Cookie 会话，Scripting 小组件即可持续查询并及时显示电费信息。
