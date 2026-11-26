# 动作与镜头对齐原作：差距与待办

2026-11-26 评估。目标是让 Web 3C 试玩场中里昂的动作和镜头，在表现上与《生化危机：安魂曲》一致。本文只覆盖角色动作与镜头，不涉及场景、材质和音效。其他工程问题见 [评审与优化清单](optimization-review.md)。

## 结论

**能做到很接近，但做法要变：动作要直接用原作片段，镜头要按原作参数的结构重写。** 只靠现在的程序化步态和手调镜头，再怎么调也做不像。

| 层次 | 能否做到一样 | 依据 |
| --- | --- | --- |
| 单个动作的姿态 | 基本一样 | 原作骨架、蒙皮、动作数据都能读，14 条已在浏览器里播放。[播放器说明](../../player/MODEL_README.md) |
| 动作衔接和镜头运动 | 肉眼接近 | 动作清单和镜头参数都有，但动作之间怎么混合、镜头参数怎么换算成位置，代码里没有写明，要靠录像去猜、去校。 |
| 逐帧完全一致 | 要靠运行时采集 | [采集器 v0.1](../../runtime/README_zh.md) 已写好，还没在游戏里跑过。材质、头发和布料物理、表情不在本次范围内。 |

## 1. 现有资源盘点

| 资源 | 状态 | 位置 |
| --- | --- | --- |
| 里昂模型 | 六分件 LOD2 灰模，72,346 顶点，CPU 蒙皮。无贴图、无武器、无表情、无布料。 | [docs/player/model.js](../../docs/player/model.js) · [MODEL_README](../../player/MODEL_README.md) |
| 已解码动作 | 14 条：`100/120、122、124、126、140、160、161、165、167、1100、1200、1201`，`2100/1200、1201`。均为 69 根骨骼，包含 `C_Prop_Cam_A`、`R_Wep`、`L_Wep` 轨道。 | [docs/player/motions.json](../../docs/player/motions.json) |
| 动作索引 | 23,717 条，已解析名称、帧数与帧率，未解码轨道。 | [all_resolved.csv](../phase2/all_resolved.csv) |
| 状态机 | 3 套 TPS 状态机、3,836 条关系；手枪举枪、开火、换弹、收枪的调用链已串联。 | [3C 拆解](../3c/leon_tps_handgun_3c_zh.md) · [state_edges.csv](../3c/state_edges.csv) |
| 镜头配置 | 279 份全部解析成功，含普通与持枪的位置、旋转、FOV、碰撞、过渡与 5 组覆盖项。 | [parsed/](../3c/camera/parsed/) · [parameters.csv](../3c/parameters.csv) |
| 动作遮罩 | Mask 2、Mask 4 等已读出并接入试玩。 | [docs/player/masks.js](../../docs/player/masks.js) |
| 实机参考 | 公开视频截帧若干，无同步按键记录。 | `runtime/leon-re9-video-review.tmp/`（git 忽略） |
| 运行时采集 | REFramework Lua 原型，本地模拟测试通过，0 条实机记录。 | [runtime/README_zh.md](../../runtime/README_zh.md) |
| 武器模型 | `wp0100` 代码已能挂载，本机文件不存在，来源未登记。 | [leon-weapon.ts](../../web-3c/src/leon-weapon.ts) |

## 2. 动作：差距主要在没用原作片段

目前试玩只用到 14 条中的几条，其余靠程序化步态补。以下原作动作都有，但还没解码或没接入。

| 场景 | 原作做法 | 网页现状 | 需要的片段 |
| --- | --- | --- | --- |
| 不瞄准走路 | `GeneralM` 整套：起步按左右脚、四个方向分开，循环，停步也按左右脚分开 | 用持枪平移循环 `100/120` 加程序化方向步态 | 起步 `2000–2027`，循环 `2200–2207`、`2270`，停步 `2500–2527` |
| 不瞄准跑步 | 带角度起跑、循环、跑动转身 | 同上，Shift 只改速度 | 起跑 `5000–5007`，循环 `5100–5104`，跑动转身 `5355`、`5400`、`5405` |
| 原地转身 | 按角度播放转身动作 | 无 | `GeneralM 0310–0315` |
| 举枪后移动 | Motion2 按方向混合 `120/122/124/126` | 侧移、后退、斜向走程序化步态 | 已解码，只需接入 |
| 站着瞄准 | `160` 循环，按转向速度混 `165`、`167` | 静止取 `160` 首帧 | 已解码，只需接入 |
| 带角度举枪 | 角色与镜头朝向不一致时按角度举枪 | 只有正前方 `140` | `141`、`145`、`158`、`159` |
| 举枪途中开火 | `HoldStartShoot` 分支播放 `1040` | 缓冲到举枪完成再开火 | `1040` |
| 收枪 | `161` | 反向插值举枪进度 | 已解码，只需接入 |
| 换弹 | `1200` 加增量层 `2100/1200` | 只用 `1200` 绝对姿态 | 已解码，需验证增量基准 |
| 武器 | 角色动作之外单独请求武器动画 | 无武器动画 | 武器动画 `5000`，模型 `wp0100` |

需要解码的约 30 条，加上 Motion2（移动）、Motion4（持枪站立）两棵混合树的参数定义。混合树决定方向权重和速度阈值，是脚不滑的关键。

**操控模式已能确认。** 视频截帧 12:07.5–12:09 中，里昂不瞄准时朝镜头跑来、身体转向移动方向，不是背对镜头倒退。所以：

- 不瞄准时，角色转向移动方向。转向参数可先用配置里 `PlayerRotateCorrectorBySpeed` 的 `StartAccelTime 0.08`、`StartCompleteTime 0.19`，启用条件待验证。
- 举枪后，角色对齐镜头，并带 `_TPSHoldOffsetDeg −6` 的持枪角度偏移。
- 当前 [movement.ts](../../web-3c/src/movement.ts) 始终让角色朝镜头方向，需要改。

## 3. 镜头：参数结构本身就不同

原作参数都已解析，网页没有按这个结构做。

| 项 | 原作配置（静态值） | 网页现状 | 来源 |
| --- | --- | --- | --- |
| 位置 | 普通 `_Offset <0.5, 1.47, 0>`，`_GazeDistance 1.7`；持枪 `<0.4, 1.5, 0.1>`，`1.1`，跟随关节 `root` | 镜头距离 3.3 / 2.1 m，肩部偏移 0.72 / 0.6 m | [normal](../3c/camera/parsed/stm/gameassets/camera/userdata/playertpscamera/common/action/position/normal.user.3.json) · [hold](../3c/camera/parsed/stm/gameassets/camera/userdata/playertpscamera/common/action/position/hold.user.3.json) |
| 随俯仰变化 | 偏移与距离各有曲线。例如普通距离倍率在 −90° / 0° / 90° 时为 0.7 / 1 / 0.6；持枪为 1.36 / 1 / 1.42 | 无 | 同上，`_GazeDistanceXCurve` 等 |
| 阻尼 | 每个分量一对（时间, 比率）。普通跟随 0.1 / 0.9，持枪 0.05 / 0.95 | 单一指数衰减时间常数 | 同上，`_FollowOffset` 等 |
| 状态过渡 | 普通与持枪之间有过渡参数，含曲线 `0 → 0.6055:0.387 → 1` | 指数过渡 0.11 / 0.15 s | [hold.user](../3c/camera/parsed/stm/gameassets/camera/userdata/playertpscamera/common/action/hold.user.3.json) `_TransitionParam` |
| FOV | 两种都是 63，模板类型 0 / 1 不同。普通状态贴墙时 FOV 增加 5.5，近裁面 0.1 调整 −0.08 | 58° / 46° | [default](../3c/camera/parsed/stm/gameassets/camera/userdata/playertpscamera/common/action/fov/tps_default.user.3.json) · [hold](../3c/camera/parsed/stm/gameassets/camera/userdata/playertpscamera/common/action/fov/tps_hold.user.3.json) |
| 碰撞 | 半径 0.1，另有半径 0.35 的提前检测；避让偏移 `<0.3, 1.75, 0.2>` 带俯仰曲线；检测起点 0.25 | 半径 0.16 单次球扫 | [tps_normal](../3c/camera/parsed/stm/gameassets/camera/userdata/playertpscamera/common/action/collision/tps_normal.user.3.json) · [tps_hold](../3c/camera/parsed/stm/gameassets/camera/userdata/playertpscamera/common/action/collision/tps_hold.user.3.json) |
| 俯仰范围 | `_PitchRangeDeg Range(-60, 120)`，推测为 −60° 到 +60° | −48.7° 到 +37° | [rotation](../3c/camera/parsed/stm/gameassets/camera/userdata/playertpscamera/common/action/rotation/tps_default.user.3.json) |
| 动画驱动 | 旋转同步关节 `C_Prop_Cam_A`；`1100`、`1200` 等片段带该骨骼轨道，开火、换弹时镜头会晃 | 无 | 同上，`_SyncJointName` |
| 覆盖项 | 持枪状态另有 5 组覆盖配置 | 无 | [hold.user](../3c/camera/parsed/stm/gameassets/camera/userdata/playertpscamera/common/action/hold.user.3.json) `_OverrideParam` |

**换算语义需要验证。** 参数有了，但怎么换算成实际位置没有直接证据，例如：

- `_GazeDistance` 是从哪一点量到哪一点；
- `DampingParam` 的时间和比率具体怎么算；
- FOV 63 是水平还是垂直角度，模板类型 0 / 1 的含义；
- 俯仰曲线的横轴是否为俯仰角（度）。

做法是按假设实现，在同一姿态下截图，与录像叠在一起对比校准。

## 4. 待办（按顺序）

| # | 工作 | 产出 | 验收 |
| --- | --- | --- | --- |
| 1 | 补解码约 30 条动作（第 2 节列表），并解析 Motion2、Motion4 混合树参数 | 扩充的动作数据，混合树参数表 | 浏览器播放器能逐帧查看；骨骼与现有 14 条一致 |
| 2 | 重写角色动画层：不瞄准时为站立 → 带角度起步 → 循环 → 按左右脚停步，加原地转身；瞄准时为四方向混合、`160` 加 `165/167`、带角度举枪、`1040`、`161` | 新的 [leon-view.ts](../../web-3c/src/leon-view.ts) 与动作层 | 程序化步态只在缺片段时兜底；起停和换向脚趾偏移不超过现有记录 |
| 3 | 补操控：不瞄准时角色转向移动方向；加入加减速；移动速度按片段根骨骼位移反算 | 修改 [movement.ts](../../web-3c/src/movement.ts)，`FeelConfig` 升到 v4 | 重录回放基线，事件差异符合预期 |
| 4 | 按原作结构重写镜头：俯仰曲线、成对阻尼、状态过渡曲线、FOV 与近裁面避让、两层碰撞检测，并把 `C_Prop_Cam_A` 轨道叠到镜头上 | 新的 [camera.ts](../../web-3c/src/camera.ts)，参数直接读解析后的配置 | 靠墙举枪、L 角、出门三种场景不穿墙、不突跳 |
| 5 | 校准：录 120 fps 录像并叠加按键显示，覆盖 T01–T10；需要逐帧一致时，在游戏里跑采集器，拿到各动画层的动作编号、帧、权重和镜头变换 | [reference-timings.csv](reference-timings.csv) 填入实测值；参数证据等级改为 `measured` | 同一姿态下网页截图与录像叠图对齐 |
| 6 | 补武器：`wp0100` 模型加武器动画 `5000`；登记来源和生成步骤 | [asset-audit.json](asset-audit.json) 记录 | 握把对齐 `R_Wep`，开火时武器动作同步 |

第 1、2 步最快见效，建议先做。

## 5. 风险

- **公开分发。** `497a01c` 之后，门户线上会加载 `docs/player` 里的里昂模型（10.9 MB）和动作。接入更多原作资产，等于公开分发的更多。如果门户对外公开，建议原作资产只在本机研究时使用，公开版只放原创素材。
- **采集器未验证。** 对象链、方法名都是候选，第一次实机运行可能读不到数据，需要按 probe 结果修正。
- **混合语义未还原。** 混合树权重、覆盖项优先级、阻尼公式都要靠录像或运行时数据确认，静态配置只能给初值。
