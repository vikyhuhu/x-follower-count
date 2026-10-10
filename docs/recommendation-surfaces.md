# 账号推荐页面覆盖 · 1.2.4

排查日期：2026-10-10。版本保持 1.2.4。本表记录当前登录会话实际出现的模块与请求，不将个性化页面上未出现的模块记作实测通过。

## 根因与处理

账号卡片能够被现有 `UserCell` 识别，但各页面的数据入口不同。侧栏来自 `SidebarUserRecommendations`；Explore 主列表来自 `ExplorePage`；个人主页帖子之间的推荐来自 `UserOriginalsTimeline`。若只接收侧栏响应，主列表仅有与侧栏重合的账号显示标签，造成「同一个模块部分显示」的现象。

本次加入实际观察到的四个公开账号读取接口：`ExplorePage`、`UserRepliesTimeline`、`UserRepostsTimeline`、`UserArticlesTweets`。后三个分别来自个人主页的回复、转发和文章标签页，响应含公开账号字段。继续按明确接口名称允许 GET／POST；沿用已有字段解析、账号合并、动态节点识别及列表布局，不增加账号请求。

## 实际观察的入口

| 页面／入口 | 账号推荐位置 | 读取接口与排查结果 |
| --- | --- | --- |
| Home：For you、Following | 侧栏；信息流可能插入推荐 | 侧栏当前三张均有标签；`SidebarUserRecommendations`、`HomeTimeline`、`HomeLatestTimeline` 已支持。此次首页首屏未出现嵌入推荐模块。 |
| Explore：Explore | 主列表与侧栏 | `ExplorePage` 加入后，重新加载插件并冷加载页面，主列表 3/3、侧栏 3/3；标签位于 @账号下方。 |
| Explore：Trending、News、Sports、Entertainment | 当前为侧栏 | 各分类当前三张侧栏推荐均有标签；此次分类主列表未出现账号推荐卡片。 |
| 自己和其他人的个人主页：Posts | 侧栏及帖子之间 | `UserOriginalsTimeline` 已支持；重新加载后自己的主页冷加载并滚动，嵌入推荐 3/3、侧栏 3/3。 |
| 个人主页：Replies、Reposts、Articles、Media | 当前为侧栏；主时间线携带账号数据 | 已观察并接收 `UserRepliesTimeline`、`UserRepostsTimeline`、`UserArticlesTweets`；`UserMedia` 已支持。此次这些主列表首屏未出现嵌入推荐模块。 |
| Follow：Who to follow | 主列表与侧栏 | `ConnectTabTimeline` 已支持；当前加载 19 张主列表、3 张侧栏卡片均有标签。 |
| Follow：Creators for you | 创作者列表与侧栏 | 同样使用 `ConnectTabTimeline`；修复后页面内切换，20 张主列表、3 张侧栏卡片均有标签。 |
| 侧栏 Show more | 带账号上下文的推荐页 | 实际页面使用 `ConnectTabTimeline`；修复后页面内导航，21 张主列表、3 张侧栏卡片均有标签。 |
| Search：Top、People | 侧栏；People 的账号列表 | `SearchTimeline` 已支持；当前 People 16 张主列表、3 张侧栏卡片均有标签，Top 侧栏三张均有标签。 |
| Notifications | 侧栏 | 当前三张推荐均有标签；此次主列表未出现账号推荐模块。 |
| 帖子详情 | Relevant people | `TweetDetail` 已支持；实际详情页的 Relevant people 账号有标签。 |
| Following、Followers、Verified Followers、Followers you know | 账号列表与侧栏 | `Following`、`Followers`、`BlueVerifiedFollowers`、`FollowersYouKnow` 已支持；各列表当前加载的账号和侧栏推荐均有标签。 |
| Lists、Communities | 侧栏 | 两页当前三张侧栏推荐均有标签。列表推荐和社区推荐本身不是账号粉丝数标签的目标。 |
| Bookmarks、Likes | 侧栏及帖子作者 | 已有 `Bookmarks`、`Likes` 支持和冷加载回归；此前真实页面已验证，本次未重新逐页实测。 |

X 官方说明账号推荐可出现于首页、通知、个人主页、搜索及其他页面，并有 Connect、相关账号等入口：[查找与关注账号](https://help.x.com/en/using-x/x-search-people)、[账号推荐系统](https://help.x.com/en/resources/recommender-systems/account-recommendations)。因此按卡片结构和数据来源覆盖，避免按页面名称分别写显示逻辑。

## 回归验证与边界

- 29 项 Node 测试通过；新增接口的 GET／POST 冷缓存响应能交付粉丝数、关系及注册时间，原响应保留且无额外请求；私信、认证和写操作继续被拒绝。
- 实际 MV3 扩展的合成浏览器回归覆盖九个读取接口、主列表与侧栏账号不同、交集账号先显示再补齐主列表、SPA 节点换账号清除旧标签、迟到的卡片、320／390／1280 像素、亮暗主题及键盘打开详情卡。页面错误和失败请求为空。
- 重新生成 1.2.4 安装包，18 个文件逐项核对与源码及浏览器已安装目录一致；解压后的安装包通过同一套推荐页面回归。
- 真实页面验证使用已安装的插件重新加载，Explore 使用冷页面加载，更多推荐及 Creators 使用页面内导航；自己的主页在冷加载后滚动到推荐模块。真实截图及响应内容不进入仓库或安装包。

新注册流程、关注操作后才触发的推荐及当前会话未出现的个性化变体未执行实测；没有为验证而创建账号、关注用户或订阅。已加载账号的字段缺失时不伪造数据；X 后续新增接口仍需补充明确的读取入口。

## 任务级 Review

核对本表及 README 的覆盖描述与实际请求、测试结果一致；区分已出现的模块、仅出现侧栏和此前验证的页面。四个新增接口沿用相同权限、字段提取和本机存储限制，无真实账号资料、原始响应、请求头、凭证或真实截图进入交付文件。manifest 与 package.json 均保持 1.2.4。
