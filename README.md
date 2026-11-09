# gamelib

<img src="src/renderer/branding/logo.svg" alt="gamelib" width="480">

把 Steam 游戏库摆成一排游戏盒：侧边朝外立在架子上，选中的抽出来露出封面；
点开后盒子翻开，右边托盘上是光盘（或卡带），点它就让 Steam 启动这个游戏。

用 Electron 做壳，界面是纯 HTML / CSS / JS，没有前端框架，也没有别的运行时依赖。

书架的斜投影画法参考了 [Wenku8_Flutter](https://github.com/mikufoxxx/Wenku8_Flutter) 的
`lib/archive_wave.dart`：侧边正对观众，正面用一个错切矩阵斜着往右上方退。

## 怎么读 Steam

**找全游戏**（几个来源合起来）：

| 来源 | 拿到什么 |
| --- | --- |
| `steamapps/libraryfolders.vdf` + 各库的 `appmanifest_*.acf` | 已安装的游戏、安装位置、大小 |
| `userdata/<所选账号>/config/localconfig.vdf` | 该账号玩过的游戏（包括已卸载的）、上次游玩、游玩时长 |
| `appcache/librarycache/` | Steam 缓存过封面的游戏，库里浏览过的基本都在 |
| Steam Web API `GetOwnedGames`（可选，设置里填 Key） | 所选账号可见的已拥有游戏和时长，包括从没装过的游戏 |

Steam 安装目录优先从 Windows 注册表读取。统计账号可以自动识别，也可以在设置里选择或填写 SteamID64。
填写 Key 并保存后，应用会同步该账号并自动打开更新后的数据面板。无法自动确定账号时，需要先选定账号。
Steam API 不可用时仍可查看该账号的本机游玩记录；其他账号的记录不会进入个人统计。

**游戏信息和图片**：商店接口 `IStoreBrowseService/GetItems`（不用 Key，50 个一批）按界面语言拿游戏名称、简介、开发商、
发行商、发售日期、标签、截图、分级、功能（单人 / 手柄 / 成就 / 云存档），并用它给的图片地址下载封面、
大图、logo、截图。软件、DLC、原声带会被过滤掉。图片优先用 Steam 自己缓存在本机的。

- 设置和商店信息缓存：`%APPDATA%\gamelib\`（`config.json`、`store_cache.json` 14 天、`tags.json`）
- 图片缓存：`%LOCALAPPDATA%\gamelib\art\`

**启动**：装了就打开 `steam://rungameid/<AppID>`，没装就打开 `steam://install/<AppID>`，
由本机的 Steam 客户端去启动（Steam 没开会先打开 Steam）。

找不到 Steam 时（比如在 Mac 上开发）自动用 13 款演示游戏，信息和图片仍然从商店接口取，点光盘只弹提示。

## 数据与隐私

gamelib 在本机读取 Steam 安装信息和所选账号的游玩记录。Steam Web API Key 可选，保存在本机配置中。启用同步后，应用将 Key 和所选 SteamID 发给 Steam 官方 API，用于读取该账号的游戏库。游戏资料和图片由应用向 Steam 获取并在本机缓存。分享源码或截图时，请勿附上本机设置、缓存或带个人信息的面板截图。

## 两种盒子

顶栏切换，记在 `config.json` 里。

- **光盘盒**：135 × 170 × 14 mm，半透明蓝色塑料。右边透明托盘下透出插页背面的双色调印刷，
  中间花瓣卡扣上放光盘；点光盘，光盘拿起来转着飞走。
- **卡带盒**：105 × 170 × 11 mm，红色塑料、白色书脊。右边上方卡槽里放卡带；点卡带，卡带抬起来往上插走。

## 开盒的 3D

用 CSS 3D：一个带 `perspective` 的舞台，里面一个 `preserve-3d` 的"相机"，盒子的每块面
（托盘、四条边沿、书脊、封面、封面边沿、光盘、影子）是一个 `div`，每帧用 `matrix3d` 摆到位置上。
遮挡排序、背面剔除交给浏览器。

盒子按真的 DVD 盒建模：书脊绕后铰链转 90°，封面绕前铰链转 180°，打开后三块平铺，
相机从斜前方俯下来，打开后还会跟着鼠标轻轻转一点。

立体感靠这几样（CSS 没有光照，都是 JS 算的）：

- **按朝向打光**：光从左上方来，每个面按法线和光的夹角盖一层深浅不同的暗色，边沿的明暗面就出来了
- **桌面阴影**：盒子下面一块模糊的影子，跟着翻开的范围变宽
- **投影**：光盘 / 卡带拿起来时，影子落在托盘上，拿得越高越偏、越虚、越淡
- **环境遮蔽**：托盘和封面内侧四周压暗

封面内侧的插页按印刷品排：上半张印大图和 logo，下面是标题、开发发行、简介、标签、截图小样、
功能图标、分级标、EAN-13 条形码（200 开头的店内码 + AppID）和版权小字；纸有颗粒，图片有 45° 网点。

## 数据面板

顶栏「数据面板」或按 D 打开，Esc 返回。看的是整个游戏库（不受"只看已安装"影响）：

- **游戏人格**：按游玩时长加权，算出最突出的两个口味方向当称号，再加上口碑、小众、年代、专一度这些标签
- **指标**：总时长、游戏数、库存价值（按当前商店价）、每小时花费
- **时长排行**、**品味雷达**（硬核 / 动作 / 探索 / 叙事 / 策略 / 社交 / 独立 / 休闲，由标签 ID 归类）、**品味 DNA**（标签时长占比）、
  **年代偏好**、**本命厂商**、**小众 or 大众**（商店评测数 × 游玩时长）、**库存透视**（深度 / 体验 / 待开封、吃灰清单、最划算）、**最近在玩**
- 点任意一款游戏就回到架子并选中它

价格和评测来自商店接口的 `best_purchase_option`、`reviews`；缓存带格式版本号，升级后第一次会重新拉一遍。
统计在 `src/renderer/stats.js`（纯计算，有测试），画图在 `dashboard.js` / `dashboard.css`，没有图表库。

## 插进主机

点光盘 / 卡带后，盒子画面淡出，换成一台主机（three.js 渲染）：

- **光盘盒 → PS5**：光盘从托盘拿起来，飞到主机前面，转成竖直，对准右侧白面板上那条光驱缝推进去，机身透出蓝光。
- **卡带盒 → Switch**：卡带飞到卡槽上方，从顶部插进去，屏幕亮起来显示这款游戏的大图。

插到底的那一刻让 Steam 启动游戏，停一会儿再淡回盒子画面、合上。模型加载不了时退回原来的动画（光盘转着飞走、卡带往上插走）。
插到位时还会播放对应盒型的提示音：光盘是进碟声和短电子提示音，卡带是卡扣声和明亮的确认音。两段声音由 `node scripts/build-insertion-sounds.js` 生成。

用到的模型（[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)）：

- [PS5](https://sketchfab.com/3d-models/ps5-d788de3735964151a3e24fd59c0f1956)，作者 rtql8d，Sketchfab
- [Nintendo Switch (Simple Ver.)](https://gintoki1234.itch.io/nintendo-switch-simple-ver)，作者 Gintoki1234，itch.io

完整的素材许可和署名见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

three.js（MIT）拷在 `src/renderer/vendor/three/`，升级后运行 `node scripts/vendor-three.js` 重新拷。

## 运行和打包

需要 Node.js 22.12 或更新版本。国内网络可以把 `.npmrc` 里的镜像留着。

```
npm install
npm start            # 运行
npm test             # 测试 VDF 解析和本机扫描
npm run dist:win     # 打 Windows 单文件便携版，产物在 dist\gamelib-<版本>-portable.exe
```

Windows 版双击便携文件即可启动。在 Mac 上也能直接打 Windows 包。

## 操作

- ← → / 滚轮 / 拖动：浏览；点旁边的盒子：跳过去
- Enter / 点选中的盒子：打开
- 点光盘或卡带 / Enter：启动游戏（没装的打开 Steam 安装）
- 顶栏：全部 / 已安装、光盘盒 / 卡带盒、设置、重新读取
- 设置中的「界面语言」可切换简体中文和 English，保存后生效，下次打开沿用。
- Esc / 点空白处：合上

## 代码在哪

主进程（Node，读本机文件、联网）：

- `src/main/main.js`：窗口、`app://` 界面文件、`art://` 图片、和界面通信
- `src/main/steam.js`：找 Steam、合并各来源的游戏、演示数据、启动地址
- `src/main/vdf.js`：Steam 的 VDF 文本格式解析
- `src/main/store.js`：商店接口、标签名、已拥有列表、缓存
- `src/main/art.js`：图片的本地缓存和下载
- `src/main/paths.js`：数据目录、设置读写
- `src/main/preload.js`：给界面开放的几个接口
- `src/main/snapshots.js`：调试用自动截图（设 `GAMELIB_SNAP=<目录>` 才生效）

界面（`src/renderer/`）：

- `app.js`：顶栏、读取进度、底部信息、设置、键盘
- `shelf.js`：游戏架（斜投影、选中抽出、滚轮 / 拖动吸附）
- `open.js`：开盒的 3D 场景和动画（相机、打光、阴影、拿起光盘 / 卡带）
- `console3d.js`：插进主机的动画（PS5 / Switch 模型、光盘和卡带的贴图、开机亮灯）
- `models.js`：加载主机模型（`models/ps5.glb`、`models/switch.fbx`）
- `parts.js`：盒子正面、书脊、边沿、印刷插页、托盘、光盘、卡带
- `print.js`：条形码、分级标、功能图标
- `styles.js`：两种盒子的尺寸；配色在 `style.css`
- `stats.js` / `dashboard.js`：数据面板的统计和界面
