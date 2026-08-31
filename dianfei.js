#!name=电费余额监控(乐电通)
#!desc=面板实时查询电费余额（支持多户）；默认每 9 分钟静默续期 Cookie；每天定时推送；微信打开缴费页时自动抓取账户配置、Cookie、UA 与余额。
#!category=Utility
#!arguments=panel_refresh:540,session_refresh:1,session_cron:*/9 * * * *,cronexp:0 9 * * *
#!arguments-desc=panel_refresh: 面板刷新间隔（秒），默认 540；填 -1 关闭面板自动刷新。\nsession_refresh: Cookie 自动续期，1 开启、0 关闭。\nsession_cron: Cookie 静默续期频率，默认每 9 分钟；五段 cron 表达式，修改后需重新加载模块。\ncronexp: 余额通知时间，默认每天 09:00；只有此任务会定时发送余额通知。\n户号、Token、OpenID、户名、提醒阈值和标题请在 BoxJS 的“乐电通电费”中编辑，也可通过微信缴费页自动抓取。

[Rule]
# 脚本查询与微信访问保持一致的直连出口(http 明文也不该走代理)
DOMAIN-SUFFIX,wegist.cn,DIRECT

[Panel]
lsep-balance-panel = script-name=lsep-balance-panel, update-interval={{{panel_refresh}}}

[Script]
# 面板:打开 Surge 首页即实时查询(多户并发),刷新间隔由模块参数控制;单户显示详细信息,多户逐行聚合
lsep-balance-panel = type=generic, timeout=20, script-path=https://raw.githubusercontent.com/yourswoo/surge-module/refs/heads/modules/lsep-balance.js, argument=mode=panel

# 会话保活:默认每 9 分钟查询一次并续期 Cookie;全程静默,可在模块参数中开关和修改频率
lsep-balance-refresh = type=cron, cronexp="{{{session_cron}}}", timeout=30, wake-system=1, script-path=https://raw.githubusercontent.com/yourswoo/surge-module/refs/heads/modules/lsep-balance.js, argument=mode=refresh&autorefresh={{{session_refresh}}}

# 每日提醒:默认每天 09:00,在模块参数 cronexp 里改时间(改后需重新加载模块);需 Surge 保持在后台运行
lsep-balance-cron = type=cron, cronexp="{{{cronexp}}}", timeout=30, wake-system=1, script-path=https://raw.githubusercontent.com/yourswoo/surge-module/refs/heads/modules/lsep-balance.js, argument=mode=cron

# 微信兜底:在微信里打开任一监控户的缴费页时,把 queryArrears 返回的余额按户静默存入缓存
lsep-balance-capture = type=http-response, pattern=^http://lsepapi\.wegist\.cn/index\.php/api/Customerapi/queryArrears, requires-body=1, max-size=131072, timeout=10, script-path=https://raw.githubusercontent.com/yourswoo/surge-module/refs/heads/modules/lsep-balance.js, argument=mode=capture

# 会话续借:在微信里打开缴费页时,自动保存账户配置、共享 Cookie 与微信 UA,供后续查询复用
lsep-balance-cookie = type=http-request, pattern=^http://lsep\.wegist\.cn/index\.php\?.*g=Wap, requires-body=0, timeout=10, script-path=https://raw.githubusercontent.com/yourswoo/surge-module/refs/heads/modules/lsep-balance.js, argument=mode=cookie
