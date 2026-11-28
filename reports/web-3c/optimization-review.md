# Web 3C 评审与优化清单

2026-11-26 评审。范围为 [web-3c](../../web-3c/) 的 README、[技术文档](../../web-3c/TECHNICAL.md)、[实施方案](../web_3c_implementation_plan_zh.md) 及 `src/` 核心源码。

同日 16:00 按工作区更新复核。期间新增方向步态（[actions.ts](../../web-3c/src/actions.ts) `createWalk`）、本机武器挂载（[leon-weapon.ts](../../web-3c/src/leon-weapon.ts)）、`build:portal` 发布脚本，并更新了 [里昂试玩记录](leon-playfield.md)。`movement.ts`、`camera.ts`、`level.ts`、`input.ts`、`feel.json` 未改。复核时本地 `npm test` 25/25 通过（Node 22.23.4）。下文各项已按复核结果更新。

2026-11-28 第三轮：完成全部不依赖实机录像的项（`FeelConfig` v6），下表第 4、6–12、14–19 项已处理，详见 [动作与镜头对齐原作 · 第 4 节](character-camera-fidelity.md#4-第三轮已落地feelconfig-v6)。

2026-11-28 第二轮：动作与镜头按解包数据落地 `FeelConfig` v5，详见 [动作与镜头对齐原作](character-camera-fidelity.md#3-第二轮已落地feelconfig-v5)。第 1、9 项相应更新，全量测试 38 项通过、2 项为需本机资源的可选用例（指定资源后通过）。

## 结论

整体框架搭得对，比一般原型规整：固定步加分阶段的模拟流程、带版本号的数据接口、616 步回放基线，每个手感参数都标了来源和证据等级。

离「安魂曲手感」目标还有三个缺口：

- **操控模式待定**：不瞄准时，角色也始终朝镜头方向。方向步态已补上侧移、后退的腿部表现，但这是不是原作的操控方式还没确认。
- **手感参数没有实测依据**：[feel.json](../../web-3c/src/feel.json) 全是手调值（`tuned`），没有一条 `measured`。
- **画面和性能有隐患**：画面里镜头没有做帧间平滑；性能数据区分不出三种配置的差别。

## 需求理解

目标是一段约 60 秒的原创测试场，复刻安魂曲里昂的第三人称手枪操作（角色、镜头、操控），包括走廊转角、贴墙举枪、单发、换弹、开门。原作资产只用于对照，网页本身只读原创模型和参数。M0–M8 九个模块都已落地，试玩页和回放页共用 `createTestRoom` 关卡装配。

## 做得好的

- [simulation.ts](../../web-3c/src/simulation.ts) 流程干净：输入 → 移动 → 动作 → 镜头 → 命中判定 → 发布。事件带步号和步内顺序，试玩和回放走同一份代码。
- [camera.ts](../../web-3c/src/camera.ts) 避障细致：从角色实时锚点球扫，过渡中的机位再扫一次，擦墙时用恢复余量抑制小幅回弹。
- 参数记录来源、证据等级和测量条件，应一直保持。

## 优化项

### P0：直接决定像不像

| # | 问题 | 位置 | 建议 |
| --- | --- | --- | --- |
| 1 | ~~不瞄准时角色朝向锁死镜头。~~ **11-28 已处理**：实机截帧确认不瞄准时转身；`movement.ts` 改为不瞄准转向按键方向、举枪转向镜头偏航 −9°（`arm0000` 持枪偏移），共用 450°/s 限速。 | [movement.ts](../../web-3c/src/movement.ts) | 转向速度 450°/s 取自配置数值、语义未验证，待录像校准；起步、停步、原地转身片段见第二轮文档待办 1–2。 |
| 2 | 没有加速和减速，目标速度直接变成位移，「急停无脚滑」验收测不出东西。方向步态的落脚和接续步都按瞬时速度算，加入加减速后需复测脚趾偏移。 | [movement.ts](../../web-3c/src/movement.ts)（未改） | 补起步加速度和急停减速度参数，改后重跑方向步态的固定步轨迹。 |
| 3 | 手感参数全为手调值，实机样本 T01–T10 未采。 | [feel.json](../../web-3c/src/feel.json) · [reference-timings.csv](reference-timings.csv) | OBS 120／240 fps 录屏加按键显示叠加，逐帧数出举枪时长、开火响应、换弹时长、起步和急停距离、举枪镜头切换时长，先补这 5 项。录像要能看清双脚并同步 WASD 和右键状态，顺带核对第 1 项的操控模式，以及 [leon-playfield.md](leon-playfield.md) 列出的方向步态待校准项（领步脚、后退步长与抬脚高度、换向重心）。 |

### P1：技术正确性

| # | 问题 | 位置 | 建议 |
| --- | --- | --- | --- |
| 4 | 镜头没有做帧间平滑。角色按 `alpha` 插值绘制，镜头直接用最新一步机位。120／144 Hz 屏或掉帧时，角色相对镜头会抖。 | [main.ts](../../web-3c/src/main.ts) 渲染回调 `const pose = current.camera` | 镜头位置也插值；渲染时把尚未被模拟消费的鼠标增量先叠到朝向上，可少约一步输入延迟。命中判定仍用模拟位姿，误差在一帧以内。 |
| 5 | 性能数据测不出问题。记录环境是已断开的远程会话、59 Hz 显示，三种配置 p50 都是 18.0 ms、p95 都是 18.3 ms，测到的是会话刷新节奏而非渲染开销。 | [integration-check.md](integration-check.md#性能) · [check-m8-performance.mjs](../../web-3c/tests/check-m8-performance.mjs) | 改测每帧实际 CPU 耗时，加 `renderer.info`（draw call、三角形）和每帧模拟步数分布，再在实体 144 Hz 屏复测一次。 |
| 6 | 命中只做镜头射线。贴墙角射击会出现「看得见打不到」或「能打到墙后」。 | [level.ts](../../web-3c/src/level.ts) `resolveSceneEvents` · [camera.ts](../../web-3c/src/camera.ts) `castCrosshair` | 越肩标准两段式：先从镜头打射线得到瞄准点（起点推到角色前方），再从枪口向瞄准点打一条判断遮挡。 |
| 7 | 模拟层直接改画面对象：开门改门板 `visible`，靶子改 `emissiveIntensity`。 | [level.ts](../../web-3c/src/level.ts) `setDoorOpen`、`resolveSceneEvents` | 模拟层只输出状态和事件，画面层自己响应。 |
| 8 | 有不在 `SimulationState` 里的隐藏状态：举枪进度、开火缓冲、镜头跟随位置、镜头臂长度等存在闭包里。**复核更新**：新增的 `createWalk` 又加了步态相位、双脚世界锚点和换向计时。无法存档或直接跳到第 N 步，回放页只能从第 0 步重跑；对比两版参数在第 375 步的差异会卡住。 | [actions.ts](../../web-3c/src/actions.ts) · [camera.ts](../../web-3c/src/camera.ts) | 把这些状态并入可序列化的模拟快照，支持保存与跳步。 |
| 9 | 手感常量写死在代码，调参面板改不了：0.5 s 开火缓冲、步态淡入淡出时间、俯仰上下限、开火和补弹时间点比例（0.06/0.24、0.72/1.40）。~~`AIM_WALK_MPS`、`READY_WALK_MPS` 与 `feel.json` 重复~~（11-28：步态改为按实际速度和源轨根位移计算，重复常量已去掉；原创外观腿摆仍写死 `speed / 2.55`）；另有步幅 0.86／1.14 m、`FORWARD_STRIDE_M`、`SUPPORT_FRACTION` 等。 | [actions.ts](../../web-3c/src/actions.ts) · [camera.ts](../../web-3c/src/camera.ts) | 时间点写进 [clips.json](../../web-3c/public/assets/clips.json) 作为动作事件标记；速度直接读 `feel.movement`；步态常量并入 `feel.json` 新分组或单独的步态配置。 |
| 10 | 规则漏洞：瞄准、换弹、开火过程中也能按 E 开门。 | [level.ts](../../web-3c/src/level.ts) `act` | 交互前检查动作阶段，非 `ready` 时拒绝或缓冲。 |

### P2：工程整理

| # | 问题 | 建议 |
| --- | --- | --- |
| 11 | M0 的 [preview-stages.ts](../../web-3c/src/preview-stages.ts)、[preview-scene.ts](../../web-3c/src/preview-scene.ts)、[preview-input.ts](../../web-3c/src/preview-input.ts) 只剩 `m0.test` 在用；`feel.json` 有 9 处 `source` 仍写 `preview-stages.ts`，参数溯源失真。 | 清理遗留代码或迁成测试夹具，修正 `source` 字段。 |
| 12 | 构建包偏大：Rapier wasm 内嵌，`simulation` 包 2.25 MB；Three.js 被打进名为 `clip-manifest` 的 668 KB 包。复核时仍是这样，构建日志也报了超过 500 kB 的警告。 | 用 `manualChunks` 把 Rapier 与 Three.js 单独拆包。 |
| 13 | 当前 Rapier 版本不保证跨平台结果完全一致。基线只比事件，目前稳定。 | 以后要逐步比坐标或跨浏览器对比时，换 `@dimforge/rapier3d-deterministic-compat`。 |
| 14 | 浏览器验收依赖本机 npx 缓存路径（`PLAYWRIGHT_MODULE`、`CHROMIUM_EXECUTABLE`），换机器跑不起来。**复核更新**：发布已由 `npm run build:portal` 解决，它会同步到 `docs/web-3c` 并只删除过期的 Vite 哈希文件。 | Playwright 加入 devDependencies，新增 `test:browser` 脚本。 |
| 15 | 鼠标锁定未绕过系统加速，`lookRadPerPx` 的意义随系统设置变化。 | `requestPointerLock({ unadjustedMovement: true })`，并过滤偶发异常大位移。 |
| 16 | 工作树有未提交改动。复核时范围扩大：`TECHNICAL.md`、`scripts/`、`src/leon-weapon.ts`、`tests/leon-browser-directions.mjs` 未纳入版本管理；`actions.ts`、`leon-view.ts`、`main.ts` 等源码和 `docs/web-3c` 的新构建（旧哈希文件已删）都未提交。 | 门户发布包已经换了，源码却没提交，两边容易对不上。建议尽快按「源码 + docs 构建」一起提交。 |
| 17 | **复核新增**：武器挂载读 `runtime/web-3c-weapon.tmp/wp0100.glb`。这个路径被 `.gitignore` 的 `*.tmp` 排除，本机当前也不存在（中间件返回 204，静默不挂枪）。`wp0100` 是原作武器资产，生成步骤和来源没有登记。 | [leon-weapon.ts](../../web-3c/src/leon-weapon.ts) · [reference-assets.ts](../../web-3c/reference-assets.ts) | 在 [asset-audit.json](asset-audit.json) 登记来源、提取命令和产物路径；文档写明生成步骤；页面在缺武器时显示状态提示，不要静默跳过。 |
| 18 | **复核新增**：报告的证据链接大量指向 `runtime/*.tmp/`（固定步轨迹、浏览器记录、测试日志），这些目录被 git 忽略，换机器或在门户上打开会断链。 | [leon-playfield.md](leon-playfield.md) · [integration-check.md](integration-check.md) | 关键证据摘要写进报告正文，或把精简版移到 `reports/web-3c/evidence/` 纳入版本管理。 |
| 19 | **复核新增**：本机主机名判断不一致。`re9-reference.ts` 用 `'::1'`，`leon-weapon.ts` 用 `'[::1]'`；浏览器的 `location.hostname` 是带方括号的形式，前者在 IPv6 本机访问时会误判为非本机。另外，加载成功后默认外观会自动切到里昂，性能和路线验收的默认基线因此变了。 | [re9-reference.ts](../../web-3c/src/re9-reference.ts) · [player-view.ts](../../web-3c/src/player-view.ts) | 抽一个共用的 `isLocalHost()`；确认默认切里昂是否有意为之，有意的话同步更新 README 和性能验收的配置说明。 |

## 建议顺序

1. 先提交当前改动（第 16 项），并处理第 9 项里的速度重复定义：都是小改动，能避免调参后步态和移动对不上。
2. 再做 4 + 15：改动小，马上能感觉到。
3. 采实机录像时先确认第 1 项的操控模式，再决定是否加转身；然后做第 2 项，`FeelConfig` 升到 v4，重录回放基线。
4. 用同一批录像补第 3 项，把参数从 `tuned` 换成 `measured`。
5. 最后做 6–8 和 17–19 的结构与工程整理。

## 第三轮处理结果（2026-11-28）

| # | 结果 |
| --- | --- |
| 2 | 已加：`accelS`／`decelS` = 0.25 s（第一人称配置值），作用于意图速度；停步片段据此预测剩余位移。数值是否适用第三人称待录像。 |
| 3 | 未处理，需要实机录像。 |
| 4 | 已由「M4 角色与镜头渲染时序」处理：角色、步态和镜头同一时刻取样（[m4-render-timing.md](m4-render-timing.md)）。 |
| 5 | 未处理，需要实体高刷显示器复测。 |
| 6 | 已改为两段射线，枪口取 `wp0100` 举枪姿态的 `vfx_muzzle1`。 |
| 7 | 已分离：模拟只改碰撞和状态，`syncView(tick)` 同步门板与靶面。 |
| 8 | 已处理：动作、镜头、朝向、门和靶的内部状态可 `snapshot()`／`restore()`，回放每 60 步存关键帧，`seek(N)` 跳步并与线性回放逐项一致。 |
| 9 | 已并入 `feel.json` v6：`fireBufferS`、`walkBlendInS`／`walkBlendOutS`、`holdStartShootS`；原创外观腿摆改读步行速度。俯仰上下限改由原作 ±60° 决定。 |
| 10 | 已处理：门只在低枪 `ready` 阶段响应 E。 |
| 11 | 已清理：`createBoxScene` 移到 `src/box-scene.ts`，M0 预览与 v4 回归参数移到 `tests/legacy-fixtures.ts`，`feel.json` 的来源字段已更正。 |
| 12 | 已拆包：`vendor-rapier`（含内联 wasm，2.2 MB）与 `vendor-three` 单独成块。 |
| 13 | 未处理，目前只比对事件，无需切换。 |
| 14 | 已处理：`playwright-core` 1.65.0 为开发依赖，新增 `npm run test:browser`；首次需 `npx playwright-core install chromium`。旧报告里的 `PLAYWRIGHT_MODULE`／`CHROMIUM_EXECUTABLE` 不再需要。 |
| 15 | 已处理：鼠标锁定请求 `unadjustedMovement`（不支持时退回普通锁定），单次超过 400 px 的位移丢弃。 |
| 16 | 已提交。 |
| 17 | 已处理：武器改为蒙皮导出，与元数据（源文件 SHA-256、骨骼表）一同发布到 `docs/player/`，生成步骤见 [weapon-attachment.md](weapon-attachment.md)。 |
| 18 | 已处理：65 个小于 300 kB 的证据文件复制到 `reports/web-3c/evidence/` 并改写链接，其余大文件标注为本机路径（[归档脚本](../../scripts/web-3c/archive_evidence.mjs)）。 |
| 19 | 已合并为 `src/local-host.ts` 的 `isLocalHost()`。默认切到里昂外观保留（有意为之）。 |
