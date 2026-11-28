# M5 举枪、单发、换弹与分层

主测试场已接入 M5。每个 60 Hz 固定步以 M3 碰撞后的 `CharacterState` 判定动作，以 `ActionState.aiming` 驱动 M4，并通过 M0 的 `emit` 发布有序事件。M6 按开火当步的 M4 准星射线判定靶命中。M2 原创 GLB 用于网页角色，素材缺失时以胶囊显示，并沿用下表的默认动作时序。

已核对 M0 的 `contracts.ts`、`simulation.ts` 和 `main.ts`，M2 的 `assets/clips.json` 和 GLB，以及 M3/M4 的 `movement.ts`、`camera.ts`。RE9 静态研究确认举枪的射击处理分支、独立上身层以及普通手枪换弹路径。RE4 时间表将输入请求、许可、出弹和退出分开。网页的缓冲、优先级、提交点和取消窗口均为 `tuned`，其中开火和补弹标记参考 M2 原创轨道的后坐峰值与弹匣接触点。原作的有效时刻仍待同步实机数据。 [RE9 3C 静态拆解第 3、6、7 节](../3c/leon_tps_handgun_3c_zh.md) · [RE4 动作时间表](../RE4/combat_loop/action_timeline.csv) · [M2 姿态回读](pose-check.md)

## 固定步规则

同一步先记录输入请求（瞄准边沿、开火、换弹、交互），再处理在途动作的提交、完成或取消，最后选择可接受的新动作。下表用接受步 `t` 为起点，秒数向上取整到固定步。单发与换弹的标记在轨道替换时按当前轨道时长缩放，分别为 0.06/0.24 与 0.72/1.40。发布不同动作时需重新核对标记。

| 动作 | 接受与优先级 | 提交与恢复 | 缓冲与取消 |
| --- | --- | --- | --- |
| 举枪 | 按住瞄准时由 `ready` 进入 `raising`。镜头从接受当步开始过渡，瞄准减速从下个移动步生效。 | 原创轨 0.44 s，完整举枪在 `t+27` 恢复到 `aiming`。若有有效开火缓冲，同一步先发举枪恢复、再发单发接受。 | 举枪中暂存最新一次有效开火边沿，保留至请求后第 30 步（含该步）。松开瞄准即清空缓冲，从当前姿态收枪。 |
| 单发 | 需要按住瞄准、完成举枪且弹匣有弹。符合条件时，单发优先于同一步换弹。 | `t+4` 按 `weapon.fired`、`ammo.committed` 的顺序提交，每次扣 1 发。场景命中事件随后发布。`t+15` 发单发恢复。 | 接受后走完开火与恢复，松开瞄准的收枪请求到恢复步处理。忙碌期间的开火边沿只记录请求，恢复步的新边沿可重新判定。空弹匣可显式换弹。 |
| 换弹 | 低枪或已完成举枪，且弹匣未满、备用有弹、没有优先的单发或奔跑取消条件时可接受。 | `t+44` 提交 `min(弹匣缺额, 备用弹)`，从备用转入弹匣。`t+84` 发换弹恢复。 | 忙碌期间的开火和重复换弹只记录请求。未瞄准、按住奔跑、着地且实际水平速度大于 0.1 m/s 才会取消。提交前取消保留原弹量，同一步取消时先提交，提交后取消保留新弹量。松开瞄准和普通移动可继续换弹。 |
| 收枪 | 稳定瞄准时松开右键，或在举枪中途松开右键。单发和换弹完成后根据当前瞄准键处理。 | 完整过程 0.30 s（18 步），中途反向按余下姿态比例缩短。 | 再按瞄准可从当前位置反向举枪，已取消的动作省略 `action.recovered`。 |

各步用 `ActionState.phase` 区分 `raising`、`aiming`、`firing`、`reloading`、`lowering` 和 `ready`。取消表现为阶段退出且缺少对应的恢复事件。门请求独立处理，沿用 M6 的门状态与事件。

## 分层与接口交接

- `web-3c/src/actions.ts` 读取现有 `InputSnapshot`、`CharacterState` 和 `ClipManifest`，输出 `ActionState`，由模拟入口给 `GameEvent` 编号。`web-3c/src/action-view.ts` 读取模块内固定步姿态。持枪站姿和举枪为普通轨，缺收枪轨时倒放举枪。步态由碰撞后的水平速度和位移相位驱动，单发在 M2 指定的 `Raise` 0.44 s 基准和双臂遮罩上叠加，保留下肢步态。已烘焙的换弹轨用普通混合，包含弹匣和固定腿姿。换弹轨占用下肢姿态时，角色位移仍由 M3 控制。
- `web-3c/src/level.ts` 将动作接入主关卡，并向 `web-3c/src/main.ts` 提供角色显示所需的姿态读取。M3 继续读上一步瞄准，M4 读本步瞄准，M6 HUD 读提交弹量和确认开火事件。`contracts.ts`、`ClipManifest`、`ActionState`、`GameEvent` 与 `ReplayTrace` 沿用既有数据结构和版本。
- M7 回放使用 `test-room@1` 的 `move`、`act`、`camera`、`resolveSceneEvents`。出弹、扣弹、补弹与命中步号见 [M7 交接](m7-handoff.md)。

## 里昂站立瞄准与转向

用仓库播放器的逐帧按钮读取 60 Hz 源轨。下表是各关节相对本轨首帧的最大局部旋转，左右配对列以左／右排列。脊柱、锁骨、上臂和双手的变化来自旋转轨，局部平移维持绑定值。 [播放器逐帧数据](../../runtime/web-3c-leon-aim.tmp/source-frames.json)

| 源轨 | 采样点 | 脊柱 `0/1/2` | 锁骨 | 上臂 | 双手 | 根骨骼偏航 |
| --- | ---: | --- | --- | --- | --- | --- |
| `100/160` 持枪 | 308 | 1.37°／1.06°／1.53° | 1.06°／1.73° | 2.52°／2.80° | 3.20°／2.66° | 固定 |
| `100/165` 左转 | 78 | 1.76°／1.66°／1.56° | 0.33°／1.11° | 1.20°／1.06° | 0.91°／1.75° | 源轨中帧 +91.17°，左转 |
| `100/167` 右转 | 78 | 1.07°／0.65°／0.88° | 0.33°／1.11° | 1.20°／1.06° | 0.91°／1.75° | 源轨中帧 −91.17°，右转 |

`160` 的上身首尾闭合。`165` 和 `167` 的上身首尾也回到持枪底姿，所查关节首尾最大差约 0.003°。两条转向轨的手臂幅度相近，方向差主要表现在根骨骼和躯干。试玩的角色朝向跟随镜头，所取的转向动作通过 Mask 4 驱动上身。

每个固定步在镜头提交后计算有符号偏航差，跨 ±π 取最短角。用 75 ms 低通滤波，再把约 6.3–24.6°/s 映射到平滑混合权重。微小反复抖动保持 `160` 循环。转动时按符号混入 `165` 或 `167`，停下后权重随滤波衰减。持枪相位连续推进，起步和停步时由步态权重在站立循环和全身方向轨之间淡化。`ActionPose.aim` 是渲染状态，由 `level.ts` 在镜头阶段更新、`main.ts` 插值、`leon-view.ts` 消费。角色移动、相机、动作事件和回放契约沿用既有接口。

单发 `1100` 继续使用原增量，在当前持枪姿态上做局部平移相加和四元数右乘。源轨首尾回零，开火开始和结束可以沿用当前持枪相位。将持枪限定在 `160` 首帧时，回归用原 `previewOnBasePose` 合成进行逐骨对照。换弹沿用 Mask 2 与原提交点。

固定步路线以每步 2 px 慢转，左右的转向混合峰值均约 47%，停转 4 步后退回 `160` 循环。相对同一持枪相位，左／右转带来的躯干变化约 0.48°／0.50°，右锁骨变化约 0.75°／1.18°。单发之外，两手相对位姿的最大偏移约 0.066 mm／0.010°。单发接受当步相对当步持枪姿态的右手角差约 0.0003°，从最后一帧后坐到恢复帧的角差约 1.45°。 [固定步骨骼和事件读回](../../runtime/web-3c-leon-aim.tmp/fixed-aim.json)

本轮全量 28/28 通过，包含本机武器挂点、移动瞄准、固定单发基准和完整路线。正式路线的 616 步、31 条事件一致。第 375 步按顺序开火、扣至 `7/16`、命中练习靶，第 431 步补至 `8/15`。Chromium 生产页键鼠复测通过。 [全量日志](../../runtime/web-3c-leon-aim.tmp/tests.log) · [正式路线事件](../../runtime/web-3c-leon-aim.tmp/fixed-route.json) · [浏览器验收](../../runtime/web-3c-leon-aim.tmp/browser-test.log)

```powershell
$out = Join-Path $PWD 'runtime/web-3c-leon-aim.tmp'
$env:LEON_AIM_EVIDENCE = Join-Path $out 'fixed-aim.json'
$env:LEON_ROUTE_EVIDENCE = Join-Path $out 'fixed-route.json'
$env:LEON_WEAPON_GLB = Join-Path $PWD 'runtime/web-3c-weapon.tmp/wp0100.glb'
npm.cmd --prefix web-3c test
npm.cmd --prefix web-3c run build
node web-3c/tests/record-leon-aim.mjs audit
node web-3c/tests/record-leon-aim.mjs before
node web-3c/tests/record-leon-aim.mjs after
```

录像用相同的逐步鼠标输入。改前 `21f1545a525f` 和改后 `48fc8641aabf` 的 138 帧试玩状态和事件一致。片段从稳定瞄准开始，0.60 s 左转，1.60 s 停住，2.30 s 右转，3.30 s 停住，4.00 s 单发。改前模式读取本轮冻结的 `runtime/web-3c-leon-aim.tmp/before-dist`，改后模式读取 `web-3c/dist`。`CAMERA_FFMPEG` 指向支持 MJPEG 输入和 VP8 输出的 ffmpeg。Chromium 环境变量沿用下节设置。 [改前](../../runtime/web-3c-leon-aim.tmp/before.webm) · [改后](../../runtime/web-3c-leon-aim.tmp/after.webm) · [同帧对照](../../runtime/web-3c-leon-aim.tmp/comparison.png)

## 里昂瞄准移动全身混合

改前 `73ea1a3547da`，改后 `5816694f2427`。前、左、后、右 `100/120`、`122`、`124`、`126` 共同驱动髋腿、脊柱、锁骨、肩臂和双手。上下身复用 `WalkPose` 的方向权重与 `leonWalkTime` 的落地相位。站立循环和方向轨随步态权重淡化，移动举枪在 `lift` 从 `0.65` 到 `1.0` 之间交接上身。`1100` 叠到当帧方向姿态，换弹使用 Mask 2，并回到当前方向相位。普通低枪与一次性鞋底校准沿用既有实现。 [姿态合成](../../web-3c/src/leon-view.ts) · [角色回归](../../web-3c/tests/leon-route.test.ts)

改前改后各采集 393 个固定步。动作、实际位移、步态相位、两脚趾世界坐标及有序事件逐步一致。纯 A 第 78 步，改后的 `Spine_0`、右锁骨、右手相对改前分别变化约 6.86°、0.88°、1.36°，改后与 `122` 的同相位局部姿态匹配。八方向逐骨对照的最大旋转误差小于 0.001°，包含 `R_Wep`。有本机枪模时，握把和挂点矩阵的最大分量误差约 `4.5e-16`，两版蒙皮组的垂直偏移变化均为 0 mm。 [改前骨骼](../../runtime/web-3c-leon-aim-walk.tmp/before.json) · [改后骨骼](../../runtime/web-3c-leon-aim-walk.tmp/after.json) · [对照摘要](../../runtime/web-3c-leon-aim-walk.tmp/comparison.json) · [八方向逐骨回归](../../runtime/web-3c-leon-aim-walk.tmp/directions.json)

| 路段 | 固定步 | 改后肩线／枪口单步角差峰值 | 支撑阶段脚趾水平最大行程 |
| --- | ---: | ---: | ---: |
| 起步至纯 A | 43–92 | 1.52°／1.70° | 3.17 cm |
| A → D | 93–142 | 0.47°／0.23° | 2.07 cm |
| D → W+D | 143–192 | 0.35°／0.10° | 4.70 cm |
| 停步 | 193–210 | 1.27°／1.17° | 脚趾最大收步距离 34.75 cm |
| 移动中举枪完成 | 272 | 0.15°／0.06° | 与连续左移动画同相 |

A、D、W+D 各段双手相对位置变化最多约 0.24 mm，单发过程中约 6.0 mm。单发恢复相邻步的枪口角差约 1.55°。换弹恢复帧和当前 `122` 匹配，退出原有 Mask 2 淡出时仍可看到约 8.5° 的单步枪口变化，改前约 8.4°。脚趾收步及斜向支撑滑移仍可见，原作混合权重和防滑 IK 待实机证据校准。

全量测试 29/29，站立及移动动作恢复的补充逐骨验证 2/2，Chromium 试玩和门户静态测试均通过。本地预览与门户的 22 个构建文件逐字节一致。正式路线 616 步、31 条事件一致，第 375 步依次开火、扣至 `7/16`、命中，第 431 步补至 `8/15`。 [全量日志](../../runtime/web-3c-leon-aim-walk.tmp/tests.log) · [恢复复测](../../runtime/web-3c-leon-aim-walk.tmp/transition-recheck.log) · [正式路线](../../runtime/web-3c-leon-aim-walk.tmp/route.json) · [门户验收](../../runtime/web-3c-leon-aim-walk.tmp/portal.log)

```powershell
$out = Join-Path $PWD 'runtime/web-3c-leon-aim-walk.tmp'
$env:LEON_AIM_WALK_EVIDENCE = Join-Path $out 'after.json'
$env:LEON_DIRECTION_EVIDENCE = Join-Path $out 'directions.json'
$env:LEON_ROUTE_EVIDENCE = Join-Path $out 'route.json'
$env:LEON_WEAPON_GLB = Join-Path $PWD 'runtime/web-3c-weapon.tmp/wp0100.glb'
npm.cmd --prefix web-3c test
npm.cmd --prefix web-3c run build
node web-3c/tests/check-leon-browser.mjs
npm.cmd --prefix web-3c run build:portal
node web-3c/tests/check-m8-static.mjs
```

## 验证与复现

`web-3c/tests/m5.test.ts` 和更新后的 `web-3c/tests/m6.test.ts` 覆盖精确事件顺序和实际关卡命中、补弹、门交互。全量测试 18/18 通过。同一组输入在模拟的 60 Hz 和 120 Hz 渲染节奏产生完全一致的状态、姿态采样与事件。M2 GLB 回读验证单发峰值约 +13°，步态相位改变时大腿摆幅翻转而单发峰值保持，换弹时弹匣从约 0.154 m 脱离到接触误差小于 1e-5 m。TypeScript 和 Vite 生产构建通过，Vite 提示共享包体积超过 500 kB。

在仓库根目录运行。首次安装依赖执行 `npm.cmd --prefix web-3c ci`。

```powershell
New-Item -ItemType Directory -Path runtime/web-3c-m5.tmp -Force | Out-Null
$env:M5_TRACE = Join-Path $PWD 'runtime/web-3c-m5.tmp/action-trace.csv'
$env:M5_POSES = Join-Path $PWD 'runtime/web-3c-m5.tmp/pose-readback.json'
npm.cmd --prefix web-3c test
npm.cmd --prefix web-3c run build
npm.cmd --prefix web-3c run preview -- --host 127.0.0.1
```

在 Chromium 打开 `http://127.0.0.1:4173/`，按住 W 和右键，在举枪中点按左键。等单发恢复后按 R，换弹中再点按左键一次。事件和 HUD 应依次记录扣弹到 `7/16`、补弹到 `8/15`，并维持该弹量。`web-3c/tests/check-m5-browser.mjs` 对生产入口自动执行这组键鼠操作。该脚本与 M2 浏览器检查使用同一 `PLAYWRIGHT_MODULE` 和 `CHROMIUM_EXECUTABLE` 配置。 [本机 Chromium 配置](pose-check.md#复现)

```powershell
node web-3c/tests/check-m5-browser.mjs
```

| 本地记录 | 片段 |
| --- | --- |
| [action-trace.csv](../../runtime/web-3c-m5.tmp/action-trace.csv) | `moving-fire-reload` 第 1–43 步请求、接受、开火、扣弹及恢复，第 45–129 步换弹和两次无效开火，第 131–149 步收枪。`sprint-44`、`sprint-45`、`sprint-46` 的第 43–47 步为补弹边界。 |
| [pose-readback.json](../../runtime/web-3c-m5.tmp/pose-readback.json) | `recoil` 和 `oppositeStep` 为相同后坐峰值的两种步态，`removedMagazine` 和 `reloadContact` 为弹匣拆出与接触，`lowering` 为反播中点。 |
| [browser-check.json](../../runtime/web-3c-m5.tmp/browser-check.json) · [practice.png](../../runtime/web-3c-m5.tmp/practice.png) | Chromium 147.0.7727.15 的 16 条有序事件、一次 GLB 200 响应，以及收枪后的主测试场。 |
| [web-3c-tests.log](../../runtime/web-3c-m5.tmp/web-3c-tests.log) | 末尾为全量测试汇总。 |
| [build.log](../../runtime/web-3c-m5.tmp/build.log) | 生产构建的入口、资源体积和完成状态。 |

## 待补项

- M2 需要提供适用同一骨架的持枪前移、瞄准侧移与收枪正式轨。当前持枪前移用程序化占位，移动换弹按已烘焙轨保留固定腿姿。原作的基准姿态、有效遮罩与层权重仍需 M2 的本地组合回读证据。 [M2 待补项](pose-check.md#待补)
- M7 需要同步实机录像与输入记录，含举枪中接受开火、出弹、补弹及换弹取消片段。需要给出路径、帧率、片段边界和对齐锚点，以校准当前 `tuned` 时序。 [M7 时基与待补项](m7-handoff.md#时基与待补项)
