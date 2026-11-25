# 试玩场里昂灰模

2026-11-25。从仓库启动 Web 3C，在测试场上方选择「角色外观」中的「里昂灰模」。默认显示灰盒。随时可切回，鼠标锁定期间可先按 Esc。

## 数据与接入

[共享蒙皮](../../docs/player/skinning.js) 读取 `docs/player/model.js` 的六分件、72,346 顶点和原有蒙皮权重。[独立播放器](../../docs/player/model-view.js) 和试玩场共用蒙皮实现，各自在自己的 Three.js 场景绘制。试玩场复用同页参考窗口已读取的原始数据，本机 Vite 资源入口见 [reference-assets.ts](../../web-3c/reference-assets.ts)。

[玩家外观控制](../../web-3c/src/player-view.ts) 在同一渲染根节点切换模型，根节点使用[主入口](../../web-3c/src/main.ts)插值后的世界脚底坐标和偏航，复用近镜头淡出。[里昂动作视图](../../web-3c/src/leon-view.ts) 将源 +Z 前向转到世界 −Z，在模型子节点校准脚底，把源根位移留在蒙皮之外。M5 的 `ActionPose` 按下表驱动姿态，Rapier、准星射线、弹量和事件发布沿用试玩场的固定步。

| 试玩姿态 | 源轨与采样 |
| --- | --- |
| 持枪与举枪 | `100/140` 随 `lift` 前进或反向采样，举枪完成后接到 `100/160` 第 0 帧。 |
| 行走 | `100/120` 按 `gaitPhaseRad` 和 `gaitWeight` 混入左右腿；丢弃该源片段的 1.76 m 根位移。 |
| 单发 | `100/1100` 的相对位移和旋转叠加在 `100/160` 第 0 帧，按 M5 动作进度取样。 |
| 换弹 | `100/1200` 按 M5 动作进度取样，与当前持枪姿态在首尾融合。 |

单发基准与动作时间映射用于试玩。原作有效混合权重、武器网格和换弹附加层仍待实测或接入。

## 验收与复现

- 生产构建和 19 项回归测试通过。双外观路线的 616 个固定步及 31 个有序事件逐项一致。第 375 步依次开火、扣弹至 7/16、命中练习靶。第 431 步补弹至 8/15。两次均撞到关闭的门板、开门并在第 564 步走进下一间房。
- 修复参考 iframe 创建的顶点和法线数组无法通过试玩页 Three.js 类型检查的问题。共享蒙皮现在使用目标 Three.js 的 `Float32BufferAttribute` 分配 GPU 上传数组。路线测试在独立 JavaScript 上下文加载源数据及蒙皮，并验证顶点、法线和索引的数组类型。
- Chromium 147.0.7727.15 的生产预览通过实际切换、移动、开火、换弹和状态保留检查。试玩视口实测里昂单个网格绘制 38,493 个索引，测试捕获的浏览器错误为零。独立参考视图的四个片段与 M2 的 12 个姿态也通过回归。

在仓库根目录运行。Playwright 的现有配置见[浏览器路径和启动说明](re9-reference-check.md#复现)。

```powershell
npm --prefix web-3c run build
$env:LEON_ROUTE_EVIDENCE = Join-Path (Get-Location).Path 'runtime/web-3c-leon.tmp/route-comparison.json'
node --test web-3c/tests/leon-route.test.ts
node web-3c/tests/check-leon-browser.mjs
node web-3c/tests/check-re9-reference.mjs
npm --prefix web-3c test
```

[路线测试](../../web-3c/tests/leon-route.test.ts) 逐步比较两次模拟，覆盖绕过 L 形走廊、命中、扣弹、换弹、门板阻挡和开门穿越。[浏览器测试](../../web-3c/tests/check-leon-browser.mjs) 检查试玩视口中的里昂网格绘制、前移、切换及弹量状态。

[路线记录](../../runtime/web-3c-leon.tmp/route-comparison.json) 的 `ticks`、`events` 和 `checkpoints` 保存逐步数据。[浏览器记录](../../runtime/web-3c-leon.tmp/browser-check.json) 保存绘制索引、页面错误和弹量观测。[举枪截图](../../runtime/web-3c-leon.tmp/leon-aim.png) · [试玩页截图](../../runtime/web-3c-leon.tmp/leon-playfield.png)
