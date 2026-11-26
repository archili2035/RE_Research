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
