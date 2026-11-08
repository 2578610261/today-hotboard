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

四、数据怎么来的（v2 修复版）
- 百度/微博/头条/华尔街见闻：由 GitHub Actions 在服务器端抓取（先官方接口，失败再用 NewsNow），
  生成同域的 data/*.json 再部署；网页只读自己的 JSON，不再受浏览器跨域（CORS）限制。
- 若 data 文件缺失或超过 30 分钟，网页才会尝试直连 NewsNow；仍失败则显示带真实时间的旧数据。
- 历史上的今天（百度百科 / 维基百科）：仍由网页直接请求，原本就正常。
- 定时频率：工作流设为每 5 分钟，但 GitHub 定时任务是“尽力而为”，实际常延迟 5–15 分钟，高峰更久。
  网页上显示的“更新于”是数据真实生成时间。
- 公开仓库 60 天无活动，GitHub 会自动停用定时任务；到 Actions 页面点 Enable 即可恢复。
- 5 分钟刷新只在网页处于前台时执行，iOS 不保证后台刷新。

五、升级步骤（已部署过的仓库）
1. 把本文件夹的全部内容覆盖上传到仓库根目录（注意包含隐藏文件夹 .github 和 scripts、data）。
2. 删除仓库里旧的 Static HTML 工作流文件（.github/workflows/ 下原来的 static.yml），
   只保留本包的 pages.yml，否则两个工作流会互相覆盖部署。
3. Settings → Pages → Source 必须是 “GitHub Actions”。
4. Actions 页 → “抓取热榜并部署到 GitHub Pages” → Run workflow，跑完点进运行记录，
   页面底部 Summary 里有一张表，写明四个来源各自成功/失败及原因。
5. 手机上打开网页；若还显示旧界面，关闭后台重开一次（旧缓存已升级为 v2）。
