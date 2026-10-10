# X 粉丝数

Chrome Manifest V3 扩展，显示 X 页面已加载的账号数据：粉丝数、关注关系、账号年龄及统一详情卡。**1.2.0**。与 X / Twitter 无官方关联，目前尚未发布到 Chrome Web Store。

<img src="extension/icons/icon-128.png" alt="X 粉丝数：黑底白 X 与蓝色双人徽标" width="128" height="128">

## 安装和更新

1. 点击 **Code → Download ZIP** 并解压，或克隆本仓库。
2. 打开 `chrome://extensions`，开启开发者模式。
3. 加载已解压的扩展，选择项目的 **extension** 文件夹。
4. 刷新已打开的 X 页面。更新时先在扩展管理页重新加载插件，再刷新 X。

加载独立安装 ZIP 时，选择解压后的 `x-follower-count` 文件夹。商店专用 ZIP 用于上传开发者后台，`manifest.json` 位于根目录。

## 功能

- 标签位于账号和发布时间后：粉丝数、互相关注／关注了你／你已关注、账号年龄。注册未满90天显示「新号」，之后显示「8个月」「3年8个月」等。
- 粉丝数量分色：0–999灰、1,000–9,999蓝、10,000–99,999紫、100,000–999,999橙、100万及以上红。亮暗主题分别配色。
- 任意标签悬停约250毫秒、点击或键盘聚焦，打开同一详情卡。支持 Tab、Enter、Esc；关闭按钮可用键盘操作。
- 详情卡显示关注数、精确粉丝数、取整粉关比、总发帖数、账号年龄、UTC注册时间。关系标签位于名称旁；认证状态默认可见，媒体帖数、类别、个人网站可在工具栏设置选择。**总发帖数不是全历史原创数**。未知字段显示「—」，不推断成零。
- **可选本机粉丝趋势**默认关闭。在工具栏开启后记录已加载账号的粉丝快照；近七个北京时间自然日的每日最后一次观察值显示为柱状图，首个观察日靠左、数字直接显示，中间缺失日留空。没有记录时只显示标题和空图。
- 动态加载、用户列表、节点复用、亮暗主题及窄屏布局。关系只针对当前登录账号，检测账号切换后清空页面缓存。

## 数据和权限

只使用 `storage` 权限，页面注入范围仅为 HTTPS `x.com`、`www.x.com`、`twitter.com`、`www.twitter.com`。Chrome最低版本111。

只解析页面本身已发生的、明确允许的用户／时间线 GET 响应。不额外查询账号，不读取请求头、凭证或 Cookie，不解析私信接口、不提取或保存帖子正文，不上传数据，无广告和遥测。账号详情和关注关系仅保存在页面内存。

明确开启记录后，本机仅持久保存用户 ID、观察时间与粉丝数，保留30天、最多1,000个账号、预算8 MiB，超限淘汰较早记录。关闭后停止新记录及趋势展示，已有快照可清除或保留到期；工具栏支持确认清除全部记录。升级自动移除旧版存储的资料和帖子样本。

完整说明见 [隐私政策](PRIVACY.md)，也可从工具栏打开离线隐私页面。趋势是已观察数据，不是完整历史；颜色和粉关比不代表账号质量。

## 使用边界与排查

X 的字段或页面结构可能变化，缺失字段不猜测。正文 @提及及没有独立用户链接的引用卡片不加标签。网络桥接运行于页面环境，可被页面干预，显示不是独立认证的数据。

若没有显示，请检查插件已启用、站点访问允许 X，并刷新页面。重新加载扩展会使旧页面脚本失效；1.2.0已增加安全退出，更新后仍需刷新 X 才能运行新脚本。Chrome错误页的历史记录不会自动清空，可手动清除后观察是否再发生。

反馈问题请提供脱敏结构，勿提供请求头、Cookie、凭证或完整 HAR。

## 开发、验证和打包

原生 JS / CSS，无生产依赖和构建步骤。Node测试使用内置测试工具；浏览器验证使用 Python Playwright 与临时 Chrome 配置，全部页面和账号数据为合成数据。

```sh
pnpm test
python3 -m venv .test-venv
.test-venv/bin/python -m pip install -r requirements-dev.txt
.test-venv/bin/python -m playwright install chromium
.test-venv/bin/python tests/browser_test.py
.test-venv/bin/python tests/card_browser_test.py
.test-venv/bin/python tests/privacy_browser_test.py
pnpm package
```

使用已有 Python Playwright 时可运行 `pnpm test:browser`。支持 `CHROMIUM_EXECUTABLE` 指定浏览器，`EXTENSION_UNDER_TEST` 指定待测解压目录。测试覆盖 Fetch／XHR 原始响应保留、无额外请求、关系、年龄、布局、键盘、图表、重启持久化、默认不记录、明确开启、清除和失效上下文保护。新版真实登录 X 的完整兼容性仍需实际确认；合成测试不能代替这项检查。

打包命令生成本地安装包与 `dist/x-follower-count-1.2.0-webstore.zip`。商店提交材料与后台填写说明见 [发布准备](docs/chrome-web-store.md)。代码准备与本地测试不等于商店审核通过。

## 许可证

[MIT](LICENSE)。
