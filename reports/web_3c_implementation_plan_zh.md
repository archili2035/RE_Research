# 生化危机网页 3C 原型技术方案

整理日期为 2026-11-25。对比对象为本机 Steam 版《生化危机 4 重制版》（RE4）和《生化危机：安魂曲》（RE9）。

## 1. 首版目标与版本选择

**先以《安魂曲》里昂的第三人称操作为手感目标，同时用 RE4 检查动作组合与导出链。** 两代的目标资源都已有成功提取记录。RE4 的批量索引、结构化解析和固定姿态组合导出证据更完整。RE9 已有能在浏览器播放的灰模与动作，也更符合当前积累。两代目前最缺的共同数据是游戏内输入、动作状态和最终镜头的同步测量。

首版做一段约 60 秒的原创测试场。玩家穿过 L 形走廊，急停、贴墙举枪、单发命中练习靶、换弹，再开门进入下一间房。3C 指角色（Character）、镜头（Camera）和操控（Control）。首发验证桌面键鼠。角色、场景和音效使用原创或授权资源，现有解包成果用于本地技术分析和参照。

## 2. 网页实现

| 系统 | 设计 | 首轮验收 |
| --- | --- | --- |
| 输入与更新 | TypeScript、Three.js（WebGL）、Rapier。键盘方向和 Pointer Lock 鼠标输入统一为动作命令。模拟固定 60 Hz，渲染做插值。失焦或退出鼠标锁定时清除按键状态。 | 同一输入回放在 60 Hz 和 120 Hz 显示设置下保持关键事件顺序一致，位移误差在项目约定范围内。 |
| 角色运动 | Rapier 胶囊控制器负责滑墙、过门与台阶。代码产生期望速度，移动动画跟随碰撞后的实际速度。行走、跑步和瞄准侧移分别可调。 | 急停无明显脚滑，反复贴墙和过门时无穿透或持续抖动。 |
| 越肩镜头 | 移动和瞄准分别配置偏移、距离、垂直 FOV 与阻尼。沿角色到目标机位做球形扫掠，入墙前收近，脱离遮挡后平滑恢复。 | 靠墙举枪、贴着 L 形拐角转向以及出门这三种情况下，镜头无穿墙和突跳。 |
| 动作与交互 | 用状态机管理举枪、收枪、单发和换弹，分开记录输入请求、动作接受、开火事件、弹药提交和恢复。下半身控制位移姿态，上半身控制持枪和换弹。射击增量记录基准姿态与遮罩，已烘焙的组合动作按普通轨道播放。 | 测举枪中按开火、移动中单发、换弹中再次按开火。每次合法单发只提交一次事件和一次扣弹，打断时保持弹药一致。 |
| 资产与场景 | Blender 导出 GLB。场景的渲染网格和简化碰撞体独立。现有地图生成器可提供原创门位和房间尺度，首版固定一条测试路线。 | 骨架和动作回读后站姿、尺度、前向、武器挂点与脚底高度一致。门有可重复的交互和碰撞行为。 |
| 调参与对照 | 时间轴记录输入、状态、速度、镜头和关键事件。调参面板读写版本化参数，保存回放与浏览器帧时间。每个手感参数记录来源和证据等级。 | 同一回放能反复定位问题。录像对齐后逐项检查转向、举枪、开火、换弹和镜头恢复。 |

渲染首轮以桌面 Chromium、1080p、60 fps 为目标，记录显卡、分辨率和 p95 帧时间。先用灰盒锁定操作，再加入原创角色、灯光与音效。独立的网页工程可沿用现有研究站点的导航入口。 [Three.js GLTFLoader](https://threejs.org/docs/pages/GLTFLoader.html) · [Three.js 动画](https://threejs.org/docs/pages/AnimationAction.html) · [Rapier 角色控制器](https://rapier.rs/docs/user_guides/javascript/character_controller/) · [Rapier 场景查询](https://rapier.rs/docs/user_guides/javascript/scene_queries/) · [Pointer Lock](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_Lock_API) · [地图模块](../map-demo/README.md)

## 3. RE4 与《安魂曲》的解包证据

包头是本轮直接从两套 Steam 安装只读核对的结果。提取与解析数字来自既有产物和日志。GB 按十进制计算，范围限于本地快照。

| 环节 | RE4 重制版 | 《安魂曲》 | 对实现难度的影响 |
| --- | --- | --- | --- |
| PAK 与布局 | 7 包，61.41 GB。全部是 KPKA 4.0、feature 8。研究已建立主包与 6 份补丁的有效条目视图。 [包记录](RE4/packages.json) | 12 包，80.68 GB。全部是 KPKA 4.2。主包和 5 个主补丁为 feature 40，子包和 5 个子补丁为 feature 8。子包约 57.55 GB。 [关卡与资源报告](RE9_levels/RE9_关卡与地图资产研究报告.md) | RE9 的现有工具还要处理主包分块布局、主包／子包及补丁配对。两代目录表都已有可用读取路径。 |
| 文件名与提取 | 153,964 个有效哈希，153,352 个路径已还原（99.60%）。主记录 77,972 条加补提 966 条，日志均记为成功，合计 78,938 个文件。 [汇总](RE4/research_summary.json) · [验证](RE4/validation.json) | 已读取全部 12 个包的目录索引，可定向提取。研究报告记录从一个主补丁解出 253 个文件，也有里昂动作和怪物纹理实例。全安装缺一份与 RE4 同口径的有效路径覆盖率及提取失败率。 [动画提取研究](animation_rules_zh.md) · [关卡与资源报告](RE9_levels/RE9_关卡与地图资产研究报告.md) | 重新找路径和依赖时，RE4 的覆盖和复现证据更强。RE9 首版只需检查手枪所需样本，按全游戏统计才需要补齐同口径审计。 |
| 结构和配置 | 77,104 次结构解析中成功 77,078 次，26 个失败都在 VR 分支，另有 1,645 个资源记录类型 CRC 差异。主线手枪已串联输入树、状态机、动作层、镜头与事件。 [五维报告](RE4/RE4_五维研究报告.md) · [手枪战斗链](RE4/combat_loop/RE4_手枪战斗链深挖.md) | 里昂样本已解析 3 套状态机、3,836 条结构关系和 279 份镜头配置。已串联抬枪中开火、角色和武器动画、换弹与镜头覆盖。 [3C 拆解](3c/leon_tps_handgun_3c_zh.md) · [验证](3c/validation.json) | RE4 有广度优势，RE9 已覆盖首版所需的设计线索。读到字段或转移边后，仍需验证它们在游戏中何时生效。 |
| 角色模型与动作导出 | 有回读验证的灰模 FBX 和 11 条解码轨道，早期样本记录了 3 个未映射骨骼哈希。较新的本地 ReExtractor 文档另外记录了 415 个固定组合的蒙皮与当前组合 GLB 回读检查，其中 198 个为普通枪械射击组合。仍需对选定的手枪和完整首版动作集单独验收。 [早期样本](ue5/re4_asset_preparation_zh.md) · [组合验证](../tools/ReExtractor/docs/RELEASE_NOTES_v1.4.7.md) | 里昂样本有 310 个 MOTLIST、6 个 MOTPACK、6,185 份物理 MOT 载荷及 106 个未解析槽位。六分件 LOD2 灰模与 14 条动作已经接入浏览器。现用专用数据和 CPU 蒙皮，两条 Add 片段只显示骨架。目标动作的分层组合、武器挂点与标准 GLB 回读待验收。 [动作统计](phase2/leon_handgun_animation_rules_zh.md) · [播放器验证](../player/MODEL_README.md) | RE9 更接近可见的浏览器演示，RE4 更接近可重复的组合动作导出。两边的轨道数、组合数与浏览器演示数各有统计口径。 |
| 纹理、材质与场景 | 提取日志包含 MESH、MDF2 和 TEX。主线灰模已导出，指定角色的完整材质和关卡组装仍需样本验收。 [灰模准备记录](ue5/re4_asset_preparation_zh.md) | 已完成部分怪物纹理的 TEX → DDS → PNG 研究样本。已观察到特定 TEX 的 mip 层使用 GDeflate 压缩。怪物图鉴链验证的是选定贴图，里昂全材质的通道、透明度、色彩空间和 streaming 引用待验证。 [怪物纹理说明](../scripts/re9_monsters/README.md) | 完整原作外观研究时，RE9 的纹理和流式依赖工作量更大。原创灰盒和授权 GLB 可独立开工。 |
| 最终实机行为 | 现有专题基于静态配置，尚未提供本任务所需的活跃层权重、最终镜头、输入接受点和取消窗口同步样本。 [RE4 手枪战斗链](RE4/combat_loop/RE4_手枪战斗链深挖.md) | 仓库有只读采集器原型及本地模拟测试。现有验证记录为 0 条实机测量，镜头、弹量和毫秒级时序尚待补齐。 [采集器现状](../runtime/README_zh.md) · [静态验证](3c/validation.json) | 两边都需要录像和输入对齐。能确认的录像帧与实际输入接受时间应分别标记，必要时再验证游戏内采样字段。 |

### 加密到底会卡在哪里

1. **包目录和路径识别。** 包目录表的加密、路径哈希与资源载荷可读性是三个问题。当前工具链已读出两代目录表。未匹配哈希首先代表缺少已知路径映射。用工具、清单和安装快照对应的记录判断覆盖率。 [本地工具版本](../tools/UPSTREAM.md) · [REE.PAK.Tool 支持清单](https://github.com/Ekey/REE.PAK.Tool)
2. **资源字节与压缩。** RE4 本地批处理对标记为不支持的资源加密与分块布局会报错，现有两份提取日志的成功记录覆盖了当时选中的样本。RE9 的主包分块布局及部分 TEX 的 GDeflate 增加的是读取和压缩处理工作。遇到失败，记录发生在定位、字节提取、解压还是格式解析哪一步。 [RE4 提取实现](../scripts/re4/inventory_extract.py) · [RE9 纹理链](../scripts/re9_monsters/README.md) · [微软 GDeflate 资料](https://devblogs.microsoft.com/directx/directstorage-gdeflate-reference-implementation-now-available/)
3. **资源解释与动作组合。** 已提取文件仍可能需要对应的 RSZ 字典、动作库继承、源骨架、武器挂点和 Additive 基准姿态。RE4 在本地有较完整的组合回读对照，RE9 已有浏览器的姿态参照。公开工具方面，RE Mesh Editor 列出两代的模型与材质支持，Noesis 插件文档明确列 RE4，ReExtractor 项目记录了 RE4 专用的射击分层。各工具的支持项应落实到指定样本。 [RE Mesh Editor](https://github.com/NSACloud/RE-Mesh-Editor) · [Noesis RE 插件](https://github.com/alphazolam/fmt_RE_MESH-Noesis-Plugin) · [ReExtractor](https://github.com/PieceMetal/ReExtractor)
4. **可执行程序与运行时。** 启动保护属于另一项依赖，本轮只读核对未验证其实现或版本差异。网页运行只读取自己的 GLB 和参数。原作对照可先用实机录像。REFramework 公布支持两代，实际采样字段与稳定性仍按安装版本验收。 [REFramework 支持列表](https://github.com/praydog/REFramework) · [本地采集器说明](../runtime/README_zh.md)

**对最终选型的影响。** 如果目标是《安魂曲》的操作手感，先继续采用 RE9。当前证据支持用其角色姿态、镜头配置和录像作为参考，网页本身可并行搭建。若项目优先级改成验证大量原作动作和材质的可重复转换，RE4 的成熟工具和本地回读证据更有优势。首轮应按同一组动作和同一验收条件跑一次小样本，保留结果供选型。

### 同口径小样本验收

每代只取一个里昂、对应的一把手枪、一套镜头配置，以及持枪站立、持枪前移、举枪、一次射击、换弹、收枪。定位一个对应武器模型／挂点，另抽查一组基础色和法线纹理。两代使用同样的输出规范，各自记录工具版本、资源版本及耗时。每项按以下顺序登记。

| 检查 | 通过条件 |
| --- | --- |
| 定位与提取 | 在同一安装快照确定来源路径、包和补丁，并记录字节长度及已有样本哈希。失败登记具体资源和阶段。 |
| 解码与绑定 | 时间戳单调，帧率与时长可解释，骨名、父子层级、绑定姿态和所需武器挂点对齐。未知骨当作缺项记录。 |
| 组合与浏览器读回 | 完整姿态与增量分开管理。用站姿、举枪中段、射击峰值和换弹接触帧对照，组合动作回读后关键骨位置与姿态在约定容差内。 |
| 实机对照 | 相同输入脚本或按键顺序在两代分别重演。至少记录录像帧率、瞄准设置、帧时间和关键动作的可见时刻。具备同步输入时，再填写输入到事件的延迟。 |

若 RE9 的标准 GLB 或组合动作在首轮样本中卡住，先用现有播放器做独立姿态核对，同时在网页里用授权替代动作完成整段流程。只有当**原作资产转换本身成为交付目标**时，再按两代的失败阶段、手工处理量和复现结果决定优先推进哪条导出链。

当前方案的证据核查包括本机 PAK 包头、仓库日志和工具文档。整包提取、两代 GLB 小样本和实机对照仍待执行。

## 4. M0–M8 模块总表

档位按 GPT 可选的**轻度、中、高、极高**填写。先用每行的首选档位，只有做到同一行列出的专项任务时再切档。

路径以仓库根目录为起点。「现有」是已在仓库里的资料。「上游」是前序模块的交付。`web-3c/` 和 `reports/web-3c/` 下的路径由对应模块创建。

| 模块 | GPT 档位 | 启动依赖 | 输入文件 | 共享接口 | 交付与验收 |
| --- | --- | --- | --- | --- | --- |
| **M0** 工程与接口 | **中** | 可直接开始 | 本文第 2 节及本节的共享接口约定。接研究站入口时加读现有 `docs/README.md`。 | 由 M0 定义，入口负责固定 60 Hz 更新。 | `web-3c/src/contracts.ts`、`web-3c/src/main.ts` 和可启动的灰盒入口。验收固定步循环、输入快照和事件顺序。 |
| **M1** 两代资产样本 | **中**。只整理已有证据用**轻度**，遇到可复现的格式异常用**极高**。 | 可直接开始 | 现有 `reports/RE4/research_summary.json`、`reports/ue5/re4_wp4000_clip_selection.json`、`reports/phase2/summary.json`、`reports/phase2/all_resolved.csv`。只取首轮动作，疑难排查附一个失败样本和最短复现日志。 | 定义 `asset-audit.json` 的记录项，包括游戏版本、用途、来源路径、包与补丁、耗时、结果文件、失败阶段和验证状态。 | `reports/web-3c/asset-audit.json`。两代同一组样本逐项记录提取、解码、绑定和回读证据，M2 能按路径定位样本。 |
| **M2** 骨架、动作与 GLB | **高**。增量基准、继承或绑定异常用**极高**。 | M0、M1。授权占位素材可先接入。 | 上游 `reports/web-3c/asset-audit.json` 指向的一个骨架和两三条代表动作。现有 `player/MODEL_README.md`、`reports/model/playback_validation.json`。 | 采用 M0 坐标约定和 `ClipManifest`。动作 ID 映射到 GLB 轨道，标记普通、增量或已烘焙组合。 | `web-3c/public/assets/clips.json`、所引用的原创或授权 GLB、`reports/web-3c/pose-check.md`。浏览器回读后核对绑定、尺度、前向、武器挂点和关键姿态。 |
| **M3** 输入、运动与碰撞 | **高** | M0。与 M6 并行，联调时接关卡。 | 上游 `web-3c/src/contracts.ts`、`web-3c/src/main.ts`。联调加读 `web-3c/src/levels/test-room.json`。 | 生成 `InputSnapshot`，读取已提交的视角和瞄准状态，通过 `SceneQueries` 做碰撞，输出 `CharacterState`。 | `web-3c/src/input.ts`、`web-3c/src/movement.ts`。验收急停、贴墙滑动、门框和台阶，并保留碰撞调试结果。 |
| **M4** 越肩镜头与准星 | **高** | M0。可先用固定角色位姿，联调接 M3。 | 上游 `web-3c/src/contracts.ts`，联调读 `web-3c/src/movement.ts`。现有 `reports/3c/leon_tps_handgun_3c_zh.md` 的镜头章节和 `reports/3c/parameters.csv` 的镜头行，有参考录像时附短片段。 | 读 `InputSnapshot`、`CharacterState`、`ActionState` 的瞄准状态和 `SceneQueries`，输出 `CameraPose`。 | `web-3c/src/camera.ts` 和镜头默认参数。验收靠墙举枪、L 形拐角和出门时的收近与恢复。 |
| **M5** 举枪、单发、换弹和分层 | **极高**设计优先级和联调。按已审定状态表补实现用**中**。 | M0。可用占位动作开工，联调接 M2–M4。 | 上游 `web-3c/src/contracts.ts`，联调接 `web-3c/public/assets/clips.json` 和 M3/M4 输出。现有 `reports/3c/leon_tps_handgun_3c_zh.md`、`reports/RE4/combat_loop/action_timeline.csv`。 | 读 `InputSnapshot`、`CharacterState`、`ClipManifest`，输出 `ActionState` 和有序 `GameEvent`。 | `web-3c/src/actions.ts`、`reports/web-3c/action-rules.md`。记录缓冲、优先级和取消窗口，验收动作接受、开火、扣弹、补弹和恢复的顺序。 |
| **M6** 场景、门、靶与 HUD | **中** | M0。可与 M3、M4 并行。 | 现有 `map-demo/ASSET_CATALOG.md`、`map-demo/dist/catalog.js`，只取选定房间和走廊。上游 `web-3c/src/contracts.ts`。 | 提供 `LevelDefinition` 和稳定的门、靶与碰撞体 ID。门发布 `GameEvent`，HUD 读取 `ActionState` 和事件。 | `web-3c/src/levels/test-room.json`、`web-3c/src/level.ts`、`web-3c/src/hud.ts`。验收固定路线、门交互、靶反馈和弹量显示。 |
| **M7** 实机录像、回放和调参 | **中**做回放、CSV 和面板。同步实机输入与时钟用**高**。 | 录像可直接开始。网页校准接 M0、M3–M5。 | 现有 `reports/3c/runtime_test_plan.csv` 和本轮录像及输入记录。用采集器时加读 `runtime/README_zh.md`。校准再读 `web-3c/src/contracts.ts`、`reports/web-3c/action-rules.md`。 | 网页使用 `ReplayTrace` 和 `FeelConfig`。视频帧、同步输入和网页事件各自保留时基及来源。 | `reports/web-3c/reference-timings.csv`、`web-3c/fixtures/route.replay.json`、`web-3c/src/feel.json`。验收固定路线可重复播放，数值标明实测、观察或调参来源。 |
| **M8** 集成、性能和发布 | **高**诊断集成和性能问题。常规构建用**中**，只整理验证清单用**轻度**。 | M2–M7 的发布所需产物。 | 上游 `web-3c/src/main.ts`、`web-3c/public/assets/clips.json`、`web-3c/src/levels/test-room.json`、`web-3c/fixtures/route.replay.json`、`web-3c/src/feel.json`。接研究导航时参考 `docs/README.md`。 | 走 M0 的更新入口，核对 `LevelDefinition`、`ClipManifest`、`ReplayTrace` 和 `FeelConfig` 的版本和引用。 | 可运行的 `web-3c/dist/` 和 `reports/web-3c/integration-check.md`。记录完整路线、关键用例、目标浏览器、帧时间和素材来源。 |

可先开 M0、M1 和 M7 的录像采集。其余模块按各行的启动依赖开聊。跨模块交接给出文件路径、接口和验收结果即可。

### M0 要落地的最小共享接口

世界坐标使用米和 Y 轴向上，模拟时间用秒，内部角度用弧度。每次固定步使用递增的 `tick` 与一份 `InputSnapshot`。每个事件带 `tick`、步内顺序、`timeS` 与对应的状态或对象 ID。每步按输入、角色运动、动作判定、相机、发布快照与事件更新。角色运动读取步进开始时已提交的瞄准状态和视角朝向。

- `InputSnapshot` 保存步号、移动轴、鼠标增量、奔跑与瞄准的持续状态，以及开火、换弹与交互的按下边沿。`CharacterState` 保存角色位置、朝向、碰撞修正后的速度和着地状态。
- `ActionState` 保存动作阶段、瞄准状态、弹匣与备用弹量。`GameEvent` 记录输入请求、动作接受、开火、弹药提交、动作恢复和门状态变化。
- `CameraPose` 保存镜头位置、朝向、垂直 FOV 和遮挡状态。`SceneQueries` 提供移动碰撞、镜头球形扫掠与准星射线的查询结果。
- `ClipManifest` 记录语义动作 ID、GLB 与轨道名、时长、混合方式、可选基准姿态和骨骼遮罩。`LevelDefinition` 定义出生点、渲染和碰撞描述、门和靶的稳定 ID 及交互范围。
- `ReplayTrace` 记录步长、事件与输入，以及回放、关卡和参数版本。`FeelConfig` 按运动、镜头和动作组织参数并附数值来源、证据等级和观测条件。

## 5. 新对话模板

档位按第 4 节在界面选择。开聊时只需替换模块编号。做子任务或附带新样本时，再写本轮目标和补充输入。

```text
在 RE_Research 仓库执行 M__。读取 reports/web_3c_implementation_plan_zh.md 第 4 节对应行，按该行的依赖、输入、共享接口和验收项完成交付。
本轮目标（可选，默认完成该行全部交付）：
补充输入（可选，只列本轮新增的样本、录像或问题日志）：
先核对上游文件。缺项时，在已有接口上用占位数据完成可独立验收的部分，并记录仍需哪项上游产物。影响共享接口时，写明受影响的模块和最小变更。
交接简要列出实际变更路径、验证结果、复现命令和待补项。长日志、轨道数据和录像保留文件路径与对应片段。
```

例如「在 RE_Research 仓库执行 M4，参照方案第 4 节。本轮先验证贴墙举枪和离墙恢复，用固定角色位姿覆盖两种取景。联调时接入 M3 的角色状态。」
