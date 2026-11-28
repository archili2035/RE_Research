# 试玩场里昂灰模

2026-11-25。从仓库启动 Web 3C，在测试场上方选择「角色外观」中的「里昂灰模」。默认显示灰盒。随时可切回，鼠标锁定期间可先按 Esc。

## 数据与接入

[共享蒙皮](../../docs/player/skinning.js) 读取 `docs/player/model.js` 的六分件、72,346 顶点和原有蒙皮权重。[独立播放器](../../docs/player/model-view.js) 和试玩场共用蒙皮实现，各自在自己的 Three.js 场景绘制。试玩场现在直接读取灰模数据。[灰模加载](../../web-3c/src/leon-assets.ts) · [本机 Vite 资源入口](../../web-3c/reference-assets.ts)

[玩家外观控制](../../web-3c/src/player-view.ts) 在同一渲染根节点切换模型，根节点使用[主入口](../../web-3c/src/main.ts)插值后的世界脚底坐标和偏航，复用近镜头淡出。[里昂动作视图](../../web-3c/src/leon-view.ts) 将源 +Z 前向转到世界 −Z，加载时用 `100/140` 站姿校准模型子节点的鞋底高度，把源根位移留在蒙皮之外。步行时固定鞋底校准量，骨盆和腿随动作轨上下移动。M5 的 `ActionPose` 按下表驱动姿态，Rapier、准星射线、弹量和事件发布沿用试玩场的固定步。

| 试玩姿态 | 源轨与采样 |
| --- | --- |
| 站立与前移 | `100/140` 第 0 帧提供站姿。`100/120` 提供髋、脊柱、肩臂、双手和腿的全身步态。源轨每循环 1.60 s、前进约 1.76 m。采样相位由着地时的碰撞后前向位移驱动，世界位移由 Rapier 提交。 |
| 举枪与瞄准 | 按 Mask 4 混入 `100/140`。瞄准完成后，站立和移动共用 `100/160` 持枪循环。脊柱入口补偿步态的骨盆旋转，使双手握姿与瞄准朝向保持稳定。 |
| 单发 | `100/1100` 的局部增量按 Mask 4 叠到当前持枪姿态。M5 动作进度驱动采样。 |
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

逐步骨骼与事件记录（本机 `runtime/web-3c-leon-forward.tmp/forward-trace.json`，693 KB，未入库） 的 `samples` 包含世界脚趾、髋、脊柱、肩、双手和握姿读回。支撑脚数字取水平位移，稳态样本使用 `100/120` 的左脚第 42–70 帧和右脚第 3–31 帧。Chromium 生产页用实际键鼠验证急停、举枪前移和移动单发，后续换弹及外观往返切换保留最终弹量。 [浏览器事件和位移](evidence/web-3c-leon/browser-check.json) · 站立（本机 `runtime/web-3c-leon.tmp/leon-standing.png`，235 KB，未入库） · 急停（本机 `runtime/web-3c-leon.tmp/leon-stopped.png`，147 KB，未入库） · 举枪前移（本机 `runtime/web-3c-leon.tmp/leon-aim.png`，136 KB，未入库）

全量测试 23/23 通过，TypeScript 和生产构建通过，Vite 报告两个共享包超过 500 kB。 [测试日志](evidence/web-3c-leon-forward/tests.log) · [构建日志](evidence/web-3c-leon-forward/build.log)

从仓库根目录运行。浏览器复用下文的 Playwright 配置。

```powershell
$env:LEON_FORWARD_EVIDENCE = Join-Path $PWD 'runtime/web-3c-leon-forward.tmp/forward-trace.json'
node --test --test-name-pattern 'full-body forward' web-3c/tests/leon-route.test.ts
npm.cmd --prefix web-3c run build
node web-3c/tests/check-leon-browser.mjs
```

## 验收与复现

### 四向解码轨接入

构建 `34abcc3ef8e2`。里昂前、左、后、右移动分别采样 `100/120`、`100/122`、`100/124`、`100/126`。举枪和低枪共用髋与腿轨，举枪／收枪移动时延续同一相位。斜移按 Rapier 提交的局部前后与横向速度混合相邻轨，将左右脚落地对齐到同一循环相位。移动时忽略低于水平速度 2% 的副轴分量，以过滤碰撞求解的细小扰动。急停或顶墙时冻结相位，约 0.13 s 淡回站姿。四向采样取代了旧的程序摆脚、髋偏移与脚部 IK。

`WalkPose` 现在传递循环相位、淡化权重和四向源轨权重，由 `actions.ts` 提交、`main.ts` 插值，`leon-view.ts` 采样。`CharacterState`、`ActionState`、`GameEvent` 及枪械时间轴沿用原接口。低枪的上身、举枪和单发的 Mask 4、换弹的 Mask 2 继续按原层级合成。 [轨道及相位](../../web-3c/src/leon-locomotion.ts) · [技术说明](../../web-3c/TECHNICAL.md)

Web 3C 全量测试 25/25 通过。举枪 602 步和低枪 616 步测试都逐骨比对了四个纯方向及四组斜向。髋和腿的局部位置误差小于 0.001 mm，旋转误差小于 0.001°。Chromium 键鼠与研究首页静态包验收通过。正式 616 步路线的 31 条事件保持一致，第 375 步依次开火、扣至 `7/16`、命中，第 431 步补至 `8/15`。 举枪轨迹（本机 `runtime/web-3c-leon-authored.tmp/final/aimed-steps.json`，3611 KB，未入库） · 低枪轨迹（本机 `runtime/web-3c-leon-authored.tmp/final/ready-steps.json`，3709 KB，未入库） · 事件轨迹（本机 `runtime/web-3c-leon-authored.tmp/final/route.json`，1151 KB，未入库） · [全量日志](evidence/web-3c-leon-authored/final/tests.log) · [门户日志](evidence/web-3c-leon-authored/final/portal.log)

固定步举枪 A→D 期间，相邻步的脚尖位移峰值为 12.6 cm。持续顶墙从第 509 步冻结相位，第 516 步淡回站姿。急停和顶墙回站姿时，脚尖从首个停止样本开始的最大三维位移分别约 31 cm 和 55 cm，包含抬脚和收脚，当前版本可看到这段收脚。 最终试玩短片（本机 `runtime/web-3c-leon-authored.tmp/final/authored.webm`，595 KB，未入库） · [录像逐帧状态](evidence/web-3c-leon-authored/final/authored-browser.json)

```powershell
$out = Join-Path $PWD 'runtime/web-3c-leon-authored.tmp/final'
$env:LEON_DIRECTION_EVIDENCE = Join-Path $out 'aimed-steps.json'
$env:LEON_READY_EVIDENCE = Join-Path $out 'ready-steps.json'
$env:LEON_ROUTE_EVIDENCE = Join-Path $out 'route.json'
npm.cmd --prefix web-3c test
npm.cmd --prefix web-3c run build:portal
node web-3c/tests/check-leon-browser.mjs
node web-3c/tests/check-m8-static.mjs
```

### 举枪方向步态一期

2026-11-26。`actions.ts` 把 Rapier 提交的水平速度转为角色局部前后、左右分量。满足着地条件时用实际位移累积相位。完全受阻时相位冻结，髋和摆动脚约 0.13 s 退出步态。纯 W 沿用既有前移轨，其余方向使用本项目原创的支撑、摆动和落步轨迹。A→D 及斜向反转可缩短接续步，延续原相位和现有支撑脚。`leon-view.ts` 用原有腿部解算约束支撑脚并补偿髋部旋转，沿用举枪与单发的 Mask 4 和换弹的 Mask 2。`main.ts` 以相同渲染比例插值角色位置、步态相位和脚目标。

Steam 官方商店的第 4 段短预览约 0.9–1.8 s，以及 PlayStation 的公开举枪画面可用于核对上身姿态。现有片段没有足够长的全身镜头与同步键位。侧移领步脚、横移时是否交叉、后退脚尖离地高度、斜向骨盆偏角、A→D 换重心和顶墙收步的时刻仍需实机录像校准。 [Steam 官方预览](https://store.steampowered.com/app/3764200/Resident_Evil_Requiem/) · [PlayStation 举枪画面](https://www.playstation.com/en-us/games/resident-evil-requiem/)

固定步路线逐帧记录碰撞位移、角色局部两条腿的四个关节、世界脚趾位置、髋旋转、肩线和双手握姿。Chromium 生产页在鼠标锁定后按住右键，用实际 W、A、S、D、W+D、S+A、A→D 输入走过同类路径，保持 D 顶墙时检查相位和步态权重。原 W、急停、开火与换弹回归仍在同一测试套件中。 固定步轨迹（本机 `runtime/web-3c-leon-direction.tmp/fixed-steps.json`，2709 KB，未入库） · [浏览器记录](evidence/web-3c-leon-direction/browser-check.json) · W 和弹量回归（本机 `runtime/web-3c-leon-direction.tmp/forward-regression.json`，903 KB，未入库）

458 步路线中，程序化步态的连续支撑区间内，脚趾水平最大偏移约 0.52 mm，两脚趾最小横向间距约 9 cm。第 319 步 A→D 时相位继续推进，原支撑脚水平位移低于 1 mm。第 423–430 步顶墙淡出期间相位恒定，支撑脚水平偏移低于 1 mm。持枪肩线与两手朝向变化均低于 0.001°。这些数值来自项目灰盒路线，用来检查是否滑脚、交叉或将骨盆旋转传给上身。 [测试日志](evidence/web-3c-leon-direction/tests.log) · [构建日志](evidence/web-3c-leon-direction/build.log)

```powershell
$env:LEON_DIRECTION_EVIDENCE = Join-Path $PWD 'runtime/web-3c-leon-direction.tmp/fixed-steps.json'
npm.cmd --prefix web-3c test
npm.cmd --prefix web-3c run build
node web-3c/tests/check-leon-browser.mjs
```

### 举枪横移解码轨

举枪持续左移使用 `100/122`，持续右移使用 `100/126`。按两轨的落脚和离地时刻映射到现有步态相位。髋、腿和摆脚采用解码姿态，Rapier 的实际位移继续驱动相位，支撑脚沿用世界空间锚点。方向翻转和急停时淡出解码轨，延续当前相位及支撑脚。髋部转动由现有脊柱补偿抵消，持枪、开火和换弹沿用现有遮罩。

改前构建 `83d3168276c1` 使用程序步态，改后本地试玩包和门户静态包均为 `20fd13abbf44`。短片同为 5.1 秒、960×540、30 fps，153 帧的试玩状态读数逐帧一致。持续左移从 0.27 秒开始，1.50 秒换向右移，2.47 秒松键急停，2.90 秒再向左移动直至贴墙。 改前（本机 `runtime/web-3c-leon-strafe.tmp/before.webm`，359 KB，未入库） · 改后（本机 `runtime/web-3c-leon-strafe.tmp/after.webm`，382 KB，未入库） · 同帧对照（本机 `runtime/web-3c-leon-strafe.tmp/comparison-samples.png`，133 KB，未入库） · [改前浏览器记录](evidence/web-3c-leon-strafe/before-browser.json) · [改后浏览器记录](evidence/web-3c-leon-strafe/after-browser.json)

| 固定步读数 | 改前 | 改后 |
| --- | ---: | ---: |
| A／D 持续横移时，两脚趾的最大横向间距 | 91.6／90.7 cm | 91.6／90.7 cm |
| A 段双膝屈曲范围，伸直为 0° | 44–89° | 40–98° |
| D 段双膝屈曲范围，伸直为 0° | 28–88° | 16–92° |
| 稳态最小横向脚间距 | 9.0 cm | 9.0 cm |
| 连续支撑区间最大脚趾水平偏移 | 0.63 mm | 3.30 mm |

改后第 319 步 A→D 继续推进相位，原支撑脚偏移小于 1 mm。第 423–430 步贴墙淡出时相位冻结，支撑脚偏移小于 1 mm。附加急停段在第 495 步冻结相位，7 个固定步后站稳，支撑脚偏移小于 1 mm。肩线和双手角度变化小于 0.001°。换向路线中仍有个别近伸直的膝盖帧，左右转接时的膝屈曲和落脚节奏需实机同机位短片校准。 改前 458 步（本机 `runtime/web-3c-leon-strafe.tmp/before-steps.json`，2796 KB，未入库） · 改后 518 步（本机 `runtime/web-3c-leon-strafe.tmp/after-steps.json`，3740 KB，未入库） · 普通持枪回归（本机 `runtime/web-3c-leon-strafe.tmp/ready-regression.json`，3847 KB，未入库）

全量 25 项测试、Chromium 键鼠回归和研究首页静态包验收通过。正式 616 步路线的 31 条有序事件一致。第 375 步按顺序开火、扣至 `7/16`、命中练习靶，第 431 步补至 `8/15`。 [全量日志](evidence/web-3c-leon-strafe/tests.log) · 正式路线（本机 `runtime/web-3c-leon-strafe.tmp/route-regression.json`，1162 KB，未入库） · [键鼠测试](evidence/web-3c-leon-strafe/browser-test.log) · [门户测试](evidence/web-3c-leon-strafe/portal-test.log) · [构建日志](evidence/web-3c-leon-strafe/build.log)

```powershell
$out = Join-Path $PWD 'runtime/web-3c-leon-strafe.tmp'
$env:LEON_DIRECTION_EVIDENCE = Join-Path $out 'after-steps.json'
$env:LEON_ROUTE_EVIDENCE = Join-Path $out 'route-regression.json'
npm.cmd --prefix web-3c test
npm.cmd --prefix web-3c run build:portal
node web-3c/tests/check-leon-browser.mjs
node web-3c/tests/check-m8-static.mjs
# 录像使用 $out 中冻结的 before-dist 和 after-dist。CAMERA_FFMPEG 指向支持 MJPEG 和 VP8 的 ffmpeg。
node web-3c/tests/record-leon-strafe.mjs before
node web-3c/tests/record-leon-strafe.mjs after
```

### 普通持枪方向步态补充

普通持枪与举枪共用步态相位。A、S、D 和斜向沿用原创程序化步态，纯 W 维持原前移轨。`actions.ts` 从 Rapier 提交的实际水平速度计算步幅和落脚位置，方向循环的基准步幅从瞄准速度下的 0.86 m 过渡到普通速度下的 1.14 m。换向和支撑腿接近伸展上限时缩短接续步。顶墙时相位冻结，髋与摆动脚约 0.13 s 淡出，支撑腿保留站稳所需的重心偏移。

`leon-view.ts` 在普通方向步态中补偿骨盆旋转，保持普通持枪上身。移动中举枪和收枪继续使用既有 Mask 4，换弹沿用 Mask 2。`main.ts` 将速度相关的步态参数与相位、脚目标一起插值。`CharacterState`、`ActionState`、`GameEvent` 及关卡移动参数沿用现有接口，`WalkPose` 的 `pace` 仅供角色渲染。`100/122`、`100/124`、`100/126` 保留在研究播放器作为参照，本轮方向动画继续由程序生成。

构建 `258cd4cb0bb5` 已同步到 `web-3c/dist/` 和 `docs/web-3c/`，14 个文件逐字节一致。Chromium 在生产预览和研究首页入口均用真实键鼠验证两种持枪状态下的方向移动。普通持枪路线在不按右键时检查了 W、A、S、D、W+D、S+A、A→D 和顶墙，离墙侧移后继续按下、松开右键。浏览器直接读回渲染使用的脚趾矩阵，原有前移与弹量回归通过。 [本地试玩记录](evidence/web-3c-leon-ready/browser-check.json) · [静态入口记录](evidence/web-3c-leon-ready/portal-check.json)

532 步固定路线记录了实际碰撞位移、局部腿骨、世界脚趾和上身姿态。连续支撑区间中，脚趾水平最大偏移 4.10 cm。第 319 步 A→D 时原支撑脚水平偏移小于 1 mm。第 396–403 步顶墙淡出时，相位恒定，支撑脚水平最大偏移 1.03 cm。第 477–532 步边走边举枪、收枪时，每步保留至少一只连续支撑脚，相邻步支撑脚水平最大偏移 1.94 cm。 普通持枪轨迹（本机 `runtime/web-3c-leon-ready.tmp/fixed-steps.json`，3256 KB，未入库） · 举枪步态回归（本机 `runtime/web-3c-leon-ready.tmp/aimed-regression.json`，2796 KB，未入库） · 前移与弹量回归（本机 `runtime/web-3c-leon-ready.tmp/forward-regression.json`，917 KB，未入库）

Web 3C 全量测试 25/25 通过。正式路线仍为 616 步、31 条有序事件，扣弹和补弹顺序通过回归。生产构建通过，Vite 报告共享包超过 500 kB。 [测试日志](evidence/web-3c-leon-ready/tests.log) · [构建日志](evidence/web-3c-leon-ready/build.log) · [静态验收日志](evidence/web-3c-leon-ready/portal-test.log)

复现命令从仓库根目录运行，浏览器使用下文的 Playwright 配置。

```powershell
$env:LEON_READY_EVIDENCE = Join-Path $PWD 'runtime/web-3c-leon-ready.tmp/fixed-steps.json'
$env:LEON_DIRECTION_EVIDENCE = Join-Path $PWD 'runtime/web-3c-leon-ready.tmp/aimed-regression.json'
npm.cmd --prefix web-3c test
npm.cmd --prefix web-3c run build:portal
node web-3c/tests/check-leon-browser.mjs
node web-3c/tests/check-m8-static.mjs
```

实机待校准项包括普通持枪的左右领步顺序、后退步长与抬脚高度、斜向和反向时的换重心幅度，以及边走边举枪或收枪时上下身过渡的时机。需要能看清双脚并带同步的 WASD 和右键状态的实机录像。

### 完整路线及外观切换

- 生产构建和 19 项回归测试通过。双外观路线的 616 个固定步及 31 个有序事件逐项一致。第 375 步依次开火、扣弹至 7/16、命中练习靶。第 431 步补弹至 8/15。两次均撞到关闭的门板、开门并在第 564 步走进下一间房。
- 修复参考 iframe 创建的顶点和法线数组无法通过试玩页 Three.js 类型检查的问题。共享蒙皮现在使用目标 Three.js 的 `Float32BufferAttribute` 分配 GPU 上传数组。路线测试在独立 JavaScript 上下文加载源数据及蒙皮，并验证顶点、法线和索引的数组类型。
- Chromium 147.0.7727.15 的生产预览通过实际切换、移动、开火、换弹和状态保留检查。试玩视口实测里昂单个网格绘制 38,493 个索引，测试捕获的浏览器错误为零。独立参考视图的四个片段与 M2 的 12 个姿态也通过回归。

在仓库根目录运行。Playwright 的现有配置见[浏览器路径和启动说明](re9-reference-check.md#复现)。

```powershell
npm --prefix web-3c run build
$env:LEON_ROUTE_EVIDENCE = Join-Path (Get-Location).Path 'runtime/web-3c-leon.tmp/route-comparison.json'
node --test web-3c/tests/leon-route.test.ts
node web-3c/tests/check-leon-browser.mjs
node web-3c/tests/check-playfield-layout.mjs
npm --prefix web-3c test
```

[路线测试](../../web-3c/tests/leon-route.test.ts) 逐步比较两次模拟，覆盖绕过 L 形走廊、命中、扣弹、换弹、门板阻挡和开门穿越。[浏览器测试](../../web-3c/tests/check-leon-browser.mjs) 检查试玩视口中的里昂网格绘制、前移、切换及弹量状态。

路线记录（本机 `runtime/web-3c-leon.tmp/route-comparison.json`，1146 KB，未入库） 的 `ticks`、`events` 和 `checkpoints` 保存逐步数据。[浏览器记录](evidence/web-3c-leon/browser-check.json) 保存绘制索引、页面错误和弹量观测。举枪截图（本机 `runtime/web-3c-leon.tmp/leon-aim.png`，136 KB，未入库） · 试玩页截图（本机 `runtime/web-3c-leon.tmp/leon-playfield.png`，162 KB，未入库）

### 门户构建复测

旧的 `docs/web-3c/` 仍引用 `main-DnO3k6dg.js`。从研究首页进入旧试玩，在鼠标锁定并按住右键后，A 键确实改变角色位置，但模型局部的两脚趾坐标保持原值。W 键改变脚趾坐标。本机 Vite 预览使用另一份较新的 `web-3c/dist/`，因此它的原验收没有覆盖旧入口。 [旧入口读回](evidence/web-3c-leon-direction/portal-before.json)

`npm.cmd --prefix web-3c run build:portal` 生成并同步门户包。当轮 `docs/web-3c/` 和 `web-3c/dist/` 的 14 个文件逐字节一致，构建号为 `4253fc6a4e54`。静态验收从研究首页点击试玩，核对页头版本并在实际渲染的里昂灰模上读取左右脚趾矩阵，覆盖 W、A、S、D、两组斜向、A→D 和顶墙停止。 [静态验收](../../web-3c/tests/check-m8-static.mjs) · [腿骨读回入口](../../web-3c/tests/leon-browser-directions.mjs)

## v5：按解包数据驱动的速度、朝向与混合

2026-11-28。依据与逐项结果见 [动作与镜头对齐原作 · 第 3 节](character-camera-fidelity.md#3-第二轮已落地feelconfig-v5)，这里只记录试玩场行为变化。

- 速度改为片段根速度：瞄准 1.10、步行 1.80、奔跑 3.60 m/s。正式路线的步行段按 2.55／1.80 拉长，基线 815 步、31 条事件，开火、扣弹、命中、补弹和三次开关门的顺序不变。
- 不瞄准时角色转向按键方向，举枪时转向镜头偏航 −9°。按 D 时角色先转身再前行，脚下多数时候走正前轨；侧移、后退轨主要出现在举枪移动和转身过程中。
- 四向混合改为相邻两轨圆周插值。W+D 时前、右各占 0.5，旧算法按每循环根位移加权约为 0.46／0.54。
- 本机导出额外轨后，低枪站立混入 `200/0` 待机，低枪行走用 `200/2202` 等四向轨，Shift 混入 `200/5102` 跑步；门户线上没有这批轨，退回举枪组四向轨。
- 举枪时上身随镜头俯仰；开火后镜头按 `arm0000` 曲线上抬最多 1.35°。

```powershell
cd web-3c
..\tools\dotnet\dotnet.exe run -c Release --project ..\scripts\web-3c\Leon3CExport
node tests/record-m7-route.ts
npm test
$env:LEON_EXTRA_MOTIONS = (Resolve-Path ..\runtime\web-3c-leon-extra.tmp\motions-extra.js).Path
$env:LEON_WEAPON_GLB = (Resolve-Path ..\runtime\web-3c-weapon.tmp\wp0100.glb).Path
node --test --test-name-pattern "optional carry-gun|local wp0100" tests/leon-v5.test.ts tests/leon-route.test.ts
node tests/record-muzzle-offset.ts
npm run build:portal
node tests/check-leon-v5-browser.mjs
```

## v6：起停、原地转身与举枪细节

2026-11-28。依据与逐项结果见 [动作与镜头对齐原作 · 第 4 节](character-camera-fidelity.md#4-第三轮已落地feelconfig-v6)。试玩场行为变化：

- 起步和停步有 0.25 s 加减速；低枪起步播放 `Handgun00M` 起步片段（按实际位移取样），松键播放停步片段并收到待机。
- 举枪会按身体与镜头的偏航差选带角度的举枪片段；举枪 0.25 s 后按开火立即生效（`1040` 姿态），收枪播放 `161`。
- 举枪站定转动镜头时，脊柱先扭向镜头，身体以 0.5 s 时间常数追上，同时按原作曲线播放左右转向步。
- 换弹时躯干叠加 `2100/1200` 增量；手枪套筒和弹匣随动作运动。
- 门只能在低枪时开关。
- 网址加 `?camera=source` 切到原作结构镜头档。

浏览器生产预览走查两档镜头（低枪待机、右移、停步、后退、奔跑、举枪、抬头、开火、收枪），无报错。快照数值见 [v6-browser-check.json](evidence/v6-browser-check.json)，截图在本机 `runtime/web-3c-leon-v6.tmp/`。

```powershell
cd web-3c
..\tools\dotnet\dotnet.exe run -c Release --project ..\scripts\web-3c\Leon3CExport
node ..\scripts\web-3c\extract_camera_source.mjs
node tests/record-m7-route.ts
npm test
npm run test:browser
node tests/record-muzzle-offset.ts
npm run build:portal
```
