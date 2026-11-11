# UE5 生化危机 3C 验证计划与资产路线调研

日期：2026-11-08。状态：已确定 RE4 首轮样本与 UE 5.8.4；用户正在安装引擎，资产准备已开始。UE 导入尚未验收。

## 1. 目标与选型结论

建立一个可测量、可切换实现方案的 UE5 3C 实验场，验证现有角色（Character）、镜头（Camera）、操作（Control）研究结论，解决位移驱动、动画分层、转向、瞄准及动作打断等技术问题。

角色外观不是前置要求。建议采用组合方案：

1. 用 UE 默认角色 Manny / Quinn 搭建控制、镜头、碰撞、状态与日志底座。
2. 复用本地 ReExtractor，经 Blender 导出 FBX，把少量原作模型、原骨架和动画作为保真对照组导入 UE。
3. 原骨架导入通过后，再用 UE IK Rig / IK Retargeter 将需要的动作重定向到默认角色。
4. 如果原作资产转换暂时失败，默认角色路线继续推进；原资源相关的保真结论标为未验证。

这是基于当前项目资料和公开工具文档作出的工程建议，不是本机 UE 导入成功报告。资产导入不等于恢复原作状态机、事件、IK、镜头和射击逻辑，这些需要单独重建及验证。

## 2. 当前项目已经有什么

本轮读取了项目 README、播放器模型说明、3C 报告、动画规则报告及 ReExtractor 文档，并检索了工具源码中的 Blender 调用相关实现。

| 已有成果 | 对本项目的价值 | 边界 |
| --- | --- | --- |
| 14 条手枪动作播放器 | 已有动作样本和逐帧查看入口 | 未还原完整运行时混合 |
| 六个真实身体灰模分件及绑定检查记录 | 可作为骨架、蒙皮和姿态转换的参照 | 自定义 model.js 数据，尚非通用 GLB/FBX |
| Requiem 里昂手枪 3C 静态报告 | 可复用状态、镜头和动作引用关系 | 输入延迟、取消窗口及最终镜头仍待实测 |
| ReExtractor 与 RE-Engine-Lib 本地源码快照 | 已有 FBX 导出能力及本地适配基础 | 支持范围依具体游戏和格式版本；须测试本次样本 |
| 独立 RE4 研究目录 | 可开展另一组对照实验 | 不与 Requiem 的动作 ID、参数混用 |

最终决策：首个垂直切片采用 RE4 主线 _chainsaw、里昂 cha000 / ch0a0z0 与 wp4000 手枪。根据用户优先考虑资产解析程度的要求，优先利用 RE4 已有射击基础姿态与增量组合、继承解析和导出实现。Requiem 保留为第二阶段迁移验证；下文第 8 节的 Requiem 编号仅属后续研究，不作为 RE4 样本清单。

相关本地资料：

- [项目说明](../README.md)
- [播放器模型与验证说明](../player/MODEL_README.md)
- [里昂第三人称手枪 3C](3c/leon_tps_handgun_3c_zh.md)
- [手枪动画规则](phase2/leon_handgun_animation_rules_zh.md)
- [既有跨游戏研究计划](tps_3c_research_plan_and_toolchain_zh.md)
- [ReExtractor 文档](../tools/ReExtractor/README.md)
- [工具来源与固定提交](../tools/UPSTREAM.md)

## 3. 角色方案比较

以下成本和适用性为工程判断。

| 方案 | 初始成本 | 适合验证 | 限制 | 建议 |
| --- | --- | --- | --- | --- |
| UE 默认角色 + 替代动画 | 低 | 输入、镜头、碰撞、速度、状态调度 | 不能据此确认原作足接触、姿态和混合效果；模板动作也不覆盖完整持枪闭环 | 首先启动 |
| 原作网格 + 原骨架 + 原动画 | 中，取决于格式兼容性 | 原始姿态、根轨迹、遮罩、动作衔接 | 仍缺运行时 IK、层混合、事件语义 | 保真对照首选 |
| UE 默认角色 + 重定向原动画 | 中，额外需要映射和校准 | 可复用的原型、通用角色上的动作表现 | 身材比例、根运动、手脚接触和武器位置会引入误差 | 对照组通过后接入 |
| 原作网格 + UE 替代动画 | 中 | 外观演示 | 对研究原作动作机制帮助有限 | 不作为首要任务 |

默认角色足够启动 3C 研究，但需要把“行为逻辑验证”和“原动画保真验证”分别记账。重定向后的姿态差异也不能直接用于否定原作研究结论。

## 4. 资产导入工具路线

### 4.1 首选：本地 ReExtractor → Blender → FBX → UE5

本地 ReExtractor README 已说明模型 FBX、单动画及多列表动画导出；转换依赖 Blender。动画 FBX 携带参考蒙皮以保留 Bind Pose，导入动画时应选择已有 Skeleton 并关闭 Import Mesh。单列表保留源帧率及有效范围，多列表批量路径按 60 FPS 烘焙。

选择它的原因是已有解析和研究链路就在本项目中，便于追踪资源来源及定位转换误差；无须先把网页播放器的专用数据结构再造为通用格式。

初次验证流程：

1. 固定游戏版本、源路径、工具提交、Blender 与 UE 小版本；保存原文件哈希。
2. 加载正确的模型分件、配套 streaming 数据及匹配的 MotionList，先保留原始骨架和骨名。
3. 首轮 RE4 清单：160 持枪、140 举枪（配套 141）、403 前移循环、165/167 转身、500/501/502 射击增量，收枪使用 158（配套 159）。RE4 的 161 是 hold_danger_loop，不能套用 RE9 的收枪编号。先导出原始片段供审计，再按已验证的层规则准备组合样本。
4. 先导入模型并创建独立 Skeleton，再把动画导入到该 Skeleton。不要直接指定 Manny 的 Skeleton。
5. 使用固定 FBX 导入路径与预设；记录实际轴向、单位、帧率、采样和压缩设置，不能只依赖工具声明。
6. 先在 Animation Editor 验证单片段，再接入运行时 AnimBP。材质先统一灰模。
7. 小样本通过后才扩展四向移动、换弹、武器和 Add 动作。

当前网页播放器可作姿态比较基准，但它与 ReExtractor 可能共享解析基础，不能当作完全独立的正确性证明；仍需结合原作录像或运行时采样。

### 4.2 备用：RE Mesh Editor → Blender → FBX

[RE Mesh Editor 上游](https://github.com/NSACloud/RE-Mesh-Editor)列出 mesh、mdf2、纹理及 RE4/RE9 支持，适合作为模型/骨架转换与检查的备用工具。上游已宣布停止维护。其文档没有提供可据以确认本次 MOTLIST 动画完整导入的通路，因此不把它作为模型和动画的一站式方案。

使用前固定兼容的 Blender 与插件版本；网格成功并不证明动画、原材质和毛发成功。

### 4.3 备用：Noesis + alphaZomega RE 插件

[插件上游](https://github.com/alphazolam/fmt_RE_MESH-Noesis-Plugin)明确提供 RE 模型、纹理与动画处理，并列出 RE4。当前查看的支持列表未明确列出 Requiem，因此适合 RE4 小样本交叉检查，不能直接承诺本次 Requiem 动画可用。

批量切片和时间基准须额外验证。[相关 Maya 包装工具](https://github.com/AtomAntzzz/RE-Engine-Mesh-Animtion-Noesis-Tool/blob/main/README.en.md)说明了合并动画切片及默认 30 FPS 引起半速的问题；它也已归档。不建议为了首轮验证引入额外 Maya 管线。

### 4.4 自建转换器的触发条件

仅在现有工具无法保留必要轨道、根骨、事件关联或准确时基时，再考虑扩展现有 C# 导出器，或经 Blender Python 构造骨架和动作再输出 FBX。优先修复已定位的小问题，不在启动阶段重写完整资源转换器。

## 5. UE 默认角色重定向路线

UE IK Rig / IK Retargeter 支持在不同骨数、骨名和朝向的骨架间转移动画，但仍需要明确链条和参考姿势。[Epic IK Rig Retargeting](https://dev.epicgames.com/documentation/unreal-engine/ik-rig-animation-retargeting-in-unreal-engine?lang=en-US)

实施顺序：

1. 为导入的原骨架和 Manny / Quinn 各建 IK Rig。
2. 设置 pelvis/hip 对应的 Retarget Root，映射脊柱、颈头、双臂和双腿，手指按需要补充。
3. 校准两侧参考姿势、肩宽和肢体朝向，先不依赖自动映射处理特殊骨名。
4. 分别验证根轨迹传递、腿长差异、脚接触、手部持枪及武器附着。
5. 将合格结果烘焙为独立 Animation Sequence，保留原动画不覆盖。
6. A/B 比较时共享控制与镜头参数，明确记录模型比例差异和重定向设置。

Retarget Root 与负责世界位移的动画根骨不是一个必须同名的概念，不能混淆。IK Retargeter 不会自动迁移原作关节 Mask、状态机、事件、武器逻辑或增量动画语义。[Epic 双足重定向说明](https://dev.epicgames.com/documentation/unreal-engine/retargeting-bipeds-with-ik-rig-in-unreal-engine)

## 6. 分阶段实施计划

| 阶段 | 工作 | 交付与通过条件 |
| --- | --- | --- |
| P0 证据盘点 | 固定角色、武器、视角与游戏版本；列出静态事实和未决问题 | 证据—假设—实验表及源资产清单 |
| P1 实验底座 | 默认角色、白盒地图、输入记录、状态日志、参数资产 | 同一输入序列可重复运行和导出日志 |
| P2 资产小样本 | 原骨架灰模与五至六条动作导入 | 比例、姿态、时长和根轨迹通过抽样检查 |
| P3 基础 3C | 移动、起停、转向、镜头跟随、瞄准与碰撞 | 两种候选实现可切换，误差可定位 |
| P4 手枪闭环 | 举枪、瞄准移动、射击、收枪及打断规则 | 连续操作稳定，关键事件可测 |
| P5 对照验证 | 原作采样、原骨架及默认角色对照、不同帧率回归 | 假设获得支持、否定或证据不足结论 |
| P6 扩展 | 重定向、换弹、Add、武器动画和 IK | 每项独立验收后纳入实验配置 |

P1 无须等待 P2 成功。建议给 P2 设置两个工作日的首轮诊断时间盒，这是排查预算，不是成功保证；超出后记录阻塞原因，继续默认角色路线。

首个里程碑：白盒场景中完成“走—停—转身—举枪—瞄准移动—射击—收枪”，导出日志并切换候选实现。完整战斗、敌人 AI、场景美术与材质还原暂不进入首轮范围。

## 7. 工程结构与控制边界

建议固定 UE 小版本，采用 ACharacter + CharacterMovementComponent 起步。核心记录、运动策略和可替换逻辑可用 C++；蓝图、AnimBP、数据资产负责状态展示和参数试验。

- 输入层：同时记录原始和处理后输入；明确死区、灵敏度、缓冲和状态限制。
- 移动层：速度、加减速、转向、碰撞，明确当前位移来自代码、Root Motion 或显式组合。
- 动作层：片段选择、状态条件、层混合、遮罩和事件。
- 镜头层：目标点、偏移、FOV、平滑、碰撞及恢复，支持独立关闭每项处理。
- 实验层：输入回放、时间戳、配置切换、日志和误差统计。

同一自由度的位移和旋转必须有明确所有者，避免代码运动与根运动无意叠加。日志记录输入、移动、动画与最终镜头的采样阶段，避免把更新顺序导致的一帧偏差误认为原作设计。

建议新增目录（后续实施时创建）：

- reports/ue5/：实验报告、假设表、验收记录。
- references/ue5/：资产清单、骨骼映射、导入预设和来源信息。
- runtime/ue5_asset_probe/：转换临时文件与样本输出。
- UE 工程内部：Core、Experiments、Characters/Mannequin、Characters/REReference、Data、Maps。

本计划放在 reports 下，与已有研究计划并列；不将策划文档混入发布站点 docs。

## 8. 优先验证的现有结论

| 问题 | 已有证据 | 实验与注意事项 |
| --- | --- | --- |
| 抬枪期间能否触发射击分支 | HoldStartShoot 关系与后续 1040 片段 | 对比立即射击、延迟射击与末帧射击；分支存在不等于已知输入窗口 |
| 持枪移动与转身怎样混合 | 120/122/124/126；160/165/167 及关联变量 | 先复演片段，再校准相位、速度和阈值；不猜 Operation 枚举 |
| 射击如何协调角色和武器 | 角色 1100、武器 5000、ShotFire、SetWaitRefire | 独立记录发射、动作起点和再次允许发射时刻；动画 30 帧不等于射速 |
| 镜头 Normal/Hold 如何生效 | 位置资源、FOV 存值及覆盖配置 | 对比状态切换与最终镜头，核对宽高比、FOV 定义和覆盖顺序 |
| 换弹与 Add 如何组合 | 100/1200、2100/1200、Mask2/11 | 第二轮处理；确认参考姿势、局部/网格空间、权重与层顺序后再叠加 |
| 位移与防滑由谁驱动 | 存在 AnimSlipReductionIK 配置；驱动方式未决 | 切换代码/根运动候选及 IK 开关，测量轨迹和足滑 |

保留报告已有修正：基础手枪换弹查 Handgun/Once；不能因为 Rifle 分支节点名称含 Handgun 就沿用其转移边。Bank 定位要包含 Type、变体和来源，MotionID 不作全局唯一键。

TPSAdd 名称不能直接映射成 UE Additive 设置；MinContinueTime 等值在单位未确认前不能当作秒或帧。

## 9. 资产与行为验收

### 9.1 导入验收

- 模型尺寸、前向、参考姿势、Root/骨盆层级一致，无额外根节点造成的偏移。
- 检查每顶点骨骼权重是否因导入配置被截断；现有灰模样本曾保留最多 7 个权重。
- 每条动作抽查开始、25%、50%、75%、结束附近姿态；循环末端处理单独记录。
- 比较原数据与 UE 中的实际时长和采样时间，不简单把 frameCount/FPS 当作所有导出器的最终时长定义。
- 比较根部累计位移/转角，以及骨盆、手脚的局部和世界变换。
- 先在关闭重定向、IK、混合和强动画压缩的条件下做基线，再逐项启用并记录变化。
- 多列表 60 FPS 烘焙、单列表源帧率及压缩造成的差异分别记录。
- 单片段正确不等于运行时最终姿态正确。

### 9.2 固定行为用例

1. 静止前进两秒后松开：速度曲线、响应和停止距离。
2. 移动中切换 90°、180°方向：转向耗时、轨迹和足滑。
3. 静止转镜头后开始移动：输入坐标系与角色朝向关系。
4. 行走中举枪、瞄准移动、收枪：动作、速度和镜头切换顺序。
5. 举枪期间切换射击和瞄准输入：缓冲、打断、首次可射击时刻。
6. 靠墙、绕角、坡道：胶囊运动、镜头压缩/恢复和姿态稳定性。

每次记录输入、位置、速度、加速度、角色朝向、镜头位置/朝向/FOV、动作及状态、动画时间、关键逻辑事件、配置版本和时间戳。

固定设备、灵敏度、视角、宽高比、初始状态与帧率采样条件，再检查 30/60/120 FPS 下的稳定性。输入回放是可重复实验工具，不承诺不同帧率下逐位确定性。

误差阈值在获得原作采样精度和波动范围后确定。结果分为静态确认、运行时测得、工程近似、未决四类；行为拟合成功不证明原作采用同一内部实现。

## 10. 下一步执行清单

- [ ] 确认 UE、Blender、本地 ReExtractor 的实际可用版本和构建依赖。
- [ ] 固定 RE4 里昂 wp4000 的小样本清单与来源哈希。
- [ ] 建立默认角色白盒项目及输入/镜头/状态日志。
- [ ] 用现有工具导出一套灰模与五至六条动作，完成 UE 原骨架导入验收。
- [ ] 填写资产探针结果：成功项、失败项、误差和阻塞原因。
- [ ] 通过后补完整手枪闭环；按需要重定向到 Manny / Quinn。
- [ ] 采样原作固定用例，对照研究假设并更新结论。

## 11. 调研来源与适用边界

公开来源核对日期为 2026-11-08；本地材料详见第 2 节。工具功能声明与本机样本成功分别记录。

- [ReExtractor 上游](https://github.com/PieceMetal/ReExtractor)：本次具体导出判断主要依据工作区源码快照 README，不假定与上游最新版本一致。
- [RE Mesh Editor](https://github.com/NSACloud/RE-Mesh-Editor)：模型/材质路线、游戏支持列表及停止维护声明。
- [Noesis RE 插件](https://github.com/alphazolam/fmt_RE_MESH-Noesis-Plugin)：备用 RE4 模型/动画路线。
- [Maya/Noesis 动画工具](https://github.com/AtomAntzzz/RE-Engine-Mesh-Animtion-Noesis-Tool/blob/main/README.en.md)：切片和时基问题参考。
- [Epic FBX Skeletal Mesh Pipeline](https://dev.epicgames.com/documentation/en-us/unreal-engine/fbx-skeletal-mesh-pipeline-in-unreal-engine)：FBX 骨骼网格通路。文档注明 FBX 2020.2；实际 Blender 导出仍需样本兼容性验证。
- [Epic IK Rig Retargeting](https://dev.epicgames.com/documentation/unreal-engine/ik-rig-animation-retargeting-in-unreal-engine?lang=en-US)：跨骨架重定向能力。
- [Epic 双足重定向](https://dev.epicgames.com/documentation/unreal-engine/retargeting-bipeds-with-ik-rig-in-unreal-engine)：链条和 Retarget Root 设置。
- [Epic Root Motion](https://dev.epicgames.com/documentation/unreal-engine/root-motion-in-unreal-engine?lang=en-US)：动画驱动位移机制。

## 12. 已确认的启动安排（2026-11-08）

- 引擎：UE 5.8.4 正式版，用户正在安装；首轮固定版本。
- 初始工程：第三人称蓝图实验项目，保留 Manny / Quinn；原作模型创建独立 Skeleton。首轮无需先配置 C++ 编译环境。
- 第一里程碑：灰模与原骨架在 UE 动画编辑器正确显示，并播放持枪、举枪和一条射击组合。
- 第二里程碑：原始增量在 UE 中重新组合，与烘焙样本比较；通过后再重定向到默认角色。
- Blender：复用用户提供的 `G:/_RE9_research/tools/blender-5.0.1-windows-x64/blender.exe`，不必重复安装。
- 工具环境差异：工作区已有 .NET 8；ReExtractor 完整工程要求 .NET 10 且缺 GDeflateNet 子模块，不能把源码中已有导出能力写成当前可直接运行。先准备源样本和独立灰模通路，记录采用的实际转换器。
- [本次资产准备状态](ue5/re4_asset_preparation_zh.md)
- [源资产清单](ue5/re4_wp4000_source_manifest.json)
- [RE4 动作选择](ue5/re4_wp4000_clip_selection.json)
