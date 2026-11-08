今日热榜 · iPhone Safari 网页 App
=================================

这不是 Safari 浮窗/插件，而是独立全屏网页应用。安装到 iPhone 主屏幕后，点击图标即可打开。

一、文件内容
- index.html：应用主页面
- style.css：手机优先的浅色界面
- app.js：六个信息源、数据解析、缓存、5 分钟刷新与点击跳转
- manifest.webmanifest / sw.js：网页应用配置与离线页面壳
- icons：主屏幕图标

二、先部署成一个 HTTPS 网页
Safari 的主屏幕网页 App 需要一个可访问的网址。不能只把 ZIP 留在“文件”App 中就完成安装。
建议把整个文件夹内容上传到 GitHub 仓库，再用 GitHub Pages 免费发布静态网页：
1. 登录 GitHub，创建一个 Public repository，例如 today-hotboard。
2. 将本文件夹内的所有文件和 icons 文件夹上传到仓库根目录（不是把整个文件夹再套一层）。
3. 打开仓库 Settings → Pages。
4. 在 Build and deployment 中选择 Deploy from a branch；Branch 选择 main，目录选择 /(root)，保存。
5. 等待 GitHub Pages 显示发布地址，通常形如 https://你的用户名.github.io/today-hotboard/。
6. 用 iPhone Safari 打开该地址。

三、添加到 iPhone 主屏幕
1. Safari 打开刚发布的网址。
2. 点击分享按钮。
3. 选择“添加到主屏幕”。
4. 保持“作为网页 App 打开”开启。
5. 点击“添加”。

四、数据源与限制
- 百度热搜、微博热搜、今日头条、华尔街见闻：沿用原扩展使用的 NewsNow 公共接口。
- 历史上的今天：沿用原扩展的百度百科历史 JSON 接口。
- 历史上的今天（维基百科）：调用中文维基百科 Action API，并补充 origin=* 跨域参数。
- 数据源若不允许网页跨域访问（CORS）、接口限流、改版或不可用，该来源会显示失败提示；若有旧数据则保留旧缓存。脚本不会把旧数据标成新数据。
- 5 分钟刷新只在网页处于前台/可运行时执行。iOS 不保证网页 App 在后台持续运行或后台自动刷新。
- 点击新闻标题会在新标签/窗口打开来源网页。

五、重要
这是静态前端，没有用户账号、收费或自己的后端。NewsNow 为公共接口，稳定性取决于上游服务。第一次发布后请逐一测试六个来源；若某个来源出现“网络或跨域访问受限”，说明对方当前 CORS 策略不允许该网页直连，需要换该来源的可浏览器访问 API 或增加自己的代理后端。
