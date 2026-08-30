#!name=电费余额监控(乐电通)
#!desc=面板实时查询电费余额（支持多户）；每天定时推送；微信打开缴费页时自动抓取账户配置、Cookie、UA 与余额。户号、Token、OpenID 等信息统一在 BoxJS 中管理。
#!category=Utility
#!arguments=cronexp:0 9 * * *
#!arguments-desc=cronexp: 每日提醒时间，五段“分 时 日 月 周”，默认 0 9 * * *；改后需重新加载模块生效。户号、Token、OpenID、户名、提醒阈值和标题请在 BoxJS 的“乐电通电费”中编辑，也可通过微信缴费页自动抓取。

[Rule]
# 脚本查询与微信访问保持一致的直连出口(http 明文也不该走代理)
DOMAIN-SUFFIX,wegist.cn,DIRECT

[Panel]
lsep-balance-panel = script-name=lsep-balance-panel, update-interval=540

[Script]
# 面板:打开 Surge 首页即实时查询(多户并发),9 分钟自动刷新;单户显示详细信息,多户逐行聚合
lsep-balance-panel = type=generic, timeout=20, script-path=https://raw.githubusercontent.com/yourswoo/surge-module/refs/heads/modules/lsep-balance.js, argument=mode=panel

# 每日提醒:默认每天 09:00,在模块参数 cronexp 里改时间(改后需重新加载模块);需 Surge 保持在后台运行
lsep-balance-cron = type=cron, cronexp="{{{cronexp}}}", timeout=30, wake-system=1, script-path=https://raw.githubusercontent.com/yourswoo/surge-module/refs/heads/modules/lsep-balance.js, argument=mode=cron

# 微信兜底:在微信里打开任一监控户的缴费页时,把 queryArrears 返回的余额按户存入缓存;是否通知可在 BoxJS 中设置
lsep-balance-capture = type=http-response, pattern=^http://lsepapi\.wegist\.cn/index\.php/api/Customerapi/queryArrears, requires-body=1, max-size=131072, timeout=10, script-path=https://raw.githubusercontent.com/yourswoo/surge-module/refs/heads/modules/lsep-balance.js, argument=mode=capture

# 会话续借:在微信里打开缴费页时,自动保存账户配置、共享 Cookie 与微信 UA,供后续查询复用
lsep-balance-cookie = type=http-request, pattern=^http://lsep\.wegist\.cn/index\.php\?.*g=Wap, requires-body=0, timeout=10, script-path=https://raw.githubusercontent.com/yourswoo/surge-module/refs/heads/modules/lsep-balance.js, argument=mode=cookie
