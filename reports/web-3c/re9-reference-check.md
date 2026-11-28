# 安魂曲里昂与网页灰盒对照

此页记录 2026-11-25 的双栏界面。当前试玩画幅和加载方式见 [Web 3C 使用说明](../../web-3c/README.md#试玩画面与里昂灰模)。

2026-11-25。Web 3C 首页并排显示测试场和里昂灰模，窄窗口改为上下排列。参考区复用 `docs/player` 的源数据、播放器与 CPU 蒙皮。

| 参考片段 | 源帧率 | 自动定位 |
| --- | ---: | --- |
| 持枪 `100/160` | 60 fps | 初次打开 |
| 举枪 `100/140` | 60 fps | 接受举枪 |
| 单发 `100/1100` | 60 fps | 接受单发，可从开火或扣弹记录点回看 |
| 换弹 `100/1200` | 60 fps | 接受换弹，可从补弹记录点回看 |

定位后停在该片段的起始帧。可逐帧、播放或拖动源动画时间轴。网页事件区分别显示举枪、开火、扣弹与补弹最近一次的 `GameEvent.timeS`、步号和步内顺序。弹量记录另带提交后的弹匣和备用弹数量。事件定位只选择相应片段，现有资料尚缺原作事件与源动画帧的同步测量。

单发轨由 TPSAdd 引用，首帧的 67 条四元数通道均接近单位四元数，髋部位置也接近零。直接用作绝对姿态会使灰模贴地。对照视图将 100/1100 的局部位移加到 100/160 第 0 帧，局部旋转按基准四元数乘增量四元数。时间轴沿用 100/1100。画面标为「单发叠加示意」，原作有效遮罩、基准采样、混合顺序和权重仍待确认。[TPSAdd 记录](../phase2/leon_handgun_animation_rules_zh.md)

## 实现路径

- [播放器](../../docs/player/app.js)、[样式](../../docs/player/style.css) 和 [姿态计算](../../docs/player/math.js) 支持嵌入视图、源帧步进和单发叠加示意。独立播放器继续使用原布局与原始轨道。
- [灰盒首页](../../web-3c/index.html)、[样式](../../web-3c/src/style.css)、[事件桥接](../../web-3c/src/re9-reference.ts) 与 [固定步入口](../../web-3c/src/main.ts) 消费已有 `GameEvent`，按逐步弹匣变化识别扣弹和补弹。指针锁定取得后保留已送达的输入，解锁时清空。[输入实现](../../web-3c/src/input.ts)
- [Vite 配置](../../web-3c/vite.config.ts) 和 [参考资源中间件](../../web-3c/reference-assets.ts) 在本机开发和生产预览中读取仓库里的参考资产。静态灰盒可继续独立发布，页面会在素材不可用时提示本机启动方式。

## 复现

在仓库根目录运行。使用仓库外已安装的 Playwright 时，通过 `PLAYWRIGHT_MODULE` 指定入口；需要自选 Chromium 时，通过 `CHROMIUM_EXECUTABLE` 指定程序。当前机器路径与 [M2 浏览器检查](pose-check.md#复现) 相同。

```powershell
npm --prefix web-3c run build
npm --prefix web-3c test
node web-3c/tests/check-re9-reference.mjs
```

[浏览器脚本](../../web-3c/tests/check-re9-reference.mjs) 重复检查四段灰模、前后逐帧和末帧边界。通过灰盒指针锁定实际举枪、单发和换弹，再用四类事件标记回跳。检查源时间变化时，网页模拟时间与步内顺序仍可独立读取。

## 验收记录

生产构建通过。Chromium 147.0.7727.15 对四段各执行两轮切换和步进，均回读六分件、72,346 顶点的灰模。换弹末帧可回退至第 311 帧。四类事件跳转、桌面并排和窄窗口堆叠通过，页面无浏览器错误。M2 姿态页的 12 个采样和 Web 3C 的 18 项测试均通过。[测试日志](evidence/web-3c-reference/web-3c-tests.log)

记录中的网页开火与扣弹均在 2.617 s，分别位于步号 157 的第 0、1 个事件。扣弹后为 7/16。补弹在 3.550 s，步号 213 的第 0 个事件，补弹后为 8/15。把参考单发跳至第 6 帧时，源时间显示 0.100 s，上述模拟时间保持原值。

本机证据保存在 [reference-check.json](evidence/web-3c-reference/reference-check.json) 的 `samples`、`shotPose` 和 `events`。并排截图为 comparison.png（本机 `runtime/web-3c-reference.tmp/comparison.png`，138 KB，未入库），取自单发第 6 帧，含开火、扣弹与补弹的模拟时间。
