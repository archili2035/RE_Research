# 试玩场里昂灰模

2026-11-25。从仓库启动 Web 3C，在测试场上方选择「角色外观」中的「里昂灰模」。默认显示灰盒。随时可切回，鼠标锁定期间可先按 Esc。

## 数据与接入

[共享蒙皮](../../docs/player/skinning.js) 读取 `docs/player/model.js` 的六分件、72,346 顶点和原有蒙皮权重。[独立播放器](../../docs/player/model-view.js) 和试玩场共用蒙皮实现，各自在自己的 Three.js 场景绘制。试玩场复用同页参考窗口已读取的原始数据，本机 Vite 资源入口见 [reference-assets.ts](../../web-3c/reference-assets.ts)。

[玩家外观控制](../../web-3c/src/player-view.ts) 在同一渲染根节点切换模型，根节点使用[主入口](../../web-3c/src/main.ts)插值后的世界脚底坐标和偏航，复用近镜头淡出。[里昂动作视图](../../web-3c/src/leon-view.ts) 将源 +Z 前向转到世界 −Z，在模型子节点校准脚底，把源根位移留在蒙皮之外。M5 的 `ActionPose` 按下表驱动姿态，Rapier、准星射线、弹量和事件发布沿用试玩场的固定步。

| 试玩姿态 | 源轨与采样 |
| --- | --- |
| 站立与前移 | `100/140` 第 0 帧提供站姿。`100/120` 提供髋、脊柱、肩臂、双手和腿的全身步态。源轨每循环 1.60 s、前进约 1.76 m。采样相位由着地时的碰撞后前向位移驱动，世界位移由 Rapier 提交。 |
| 举枪与瞄准 | 按 Mask 4 混入 `100/140`，瞄准完成切到 `100/160` 首帧。脊柱入口补偿步态的骨盆旋转，使双手握姿与瞄准朝向保持稳定。 |
| 单发 | `100/1100` 先和 `100/160` 首帧合成，按 Mask 4 叠加上身。M5 动作进度驱动采样。 |
| 换弹 | `100/1200` 以绝对轨按 Mask 2 叠加，首尾与当前持枪姿态融合。 |

单发基准与动作时间映射用于试玩。原作有效混合权重、武器网格和换弹附加层仍待实测或接入。

## 前移验收

2026-11-26。前向移动在约 0.10 s 内淡入，急停在约 0.13 s 内回到站姿。停步时保留最后的步态相位，起步和急停的过渡通过腿部约束保持支撑脚。正向移动受阻后，步频随实际速度降至零。渲染以同一插值比例采样角色脚底位置与步态相位。侧移和后退轨留待下一轮。

| 路线片段 | 固定步读回 |
| --- | --- |
| 站立 → 前走，第 12–20 步 | 起步左支撑脚趾水平最大偏移 1.67 cm。稳态步态可读到髋、脊柱、右肩和右手的旋转变化。 |
| 前走 → 急停，第 132–140 步 | 角色停止平移后步态相位冻结，右支撑脚趾水平最大偏移 0.83 cm。稳态支撑相位内最大偏移 1.68 cm。 |
| 举枪前移，第 152–240 步 | 第 179 步举枪恢复。稳态支撑脚趾水平最大偏移 1.68 cm。右手坐标系中的左手位置变化小于 0.01 mm，两手朝向变化均小于 0.001°。 |
| 单发及换弹，第 241–314 步 | 第 241 步接受单发，第 245 步顺序 0 开火、顺序 1 扣至 `7/16`，第 256 步恢复。第 314 步补至 `8/15`。相同前移相位下，两个遮罩均保留髋姿态和脚趾水平位置。 |

[逐步骨骼与事件记录](../../runtime/web-3c-leon-forward.tmp/forward-trace.json) 的 `samples` 包含世界脚趾、髋、脊柱、肩、双手和握姿读回。支撑脚数字取水平位移，稳态样本使用 `100/120` 的左脚第 42–70 帧和右脚第 3–31 帧。Chromium 生产页用实际键鼠验证急停、举枪前移和移动单发，后续换弹及外观往返切换保留最终弹量。 [浏览器事件和位移](../../runtime/web-3c-leon.tmp/browser-check.json) · [站立](../../runtime/web-3c-leon.tmp/leon-standing.png) · [急停](../../runtime/web-3c-leon.tmp/leon-stopped.png) · [举枪前移](../../runtime/web-3c-leon.tmp/leon-aim.png)

全量测试 23/23 通过，TypeScript 和生产构建通过，Vite 报告两个共享包超过 500 kB。 [测试日志](../../runtime/web-3c-leon-forward.tmp/tests.log) · [构建日志](../../runtime/web-3c-leon-forward.tmp/build.log)

从仓库根目录运行。浏览器复用下文的 Playwright 配置。

```powershell
$env:LEON_FORWARD_EVIDENCE = Join-Path $PWD 'runtime/web-3c-leon-forward.tmp/forward-trace.json'
node --test --test-name-pattern 'full-body forward' web-3c/tests/leon-route.test.ts
npm.cmd --prefix web-3c run build
node web-3c/tests/check-leon-browser.mjs
```

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
