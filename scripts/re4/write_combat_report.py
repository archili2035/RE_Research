import pathlib,json,csv,re
O=pathlib.Path('reports/RE4/combat_loop')
s=json.loads((O/'summary.json').read_text());v=json.loads((O/'validation.json').read_text())
report='''# RE4 手枪战斗链：从输入到射击、硬直与体术

日期：2026-11-07。研究对象：本机 RE4 的 `_chainsaw` 主线资源，玩家 `ch0a0z0`、武器 `wp4000`、敌人样本 `ch1c0z0`。仅分析解包数据，没有运行游戏或修改游戏文件。

## 结论先行

本轮把资源清单推进到了可追踪的引用链，最明确的设计结论有四个：

1. **一次射击由多套系统协作完成。** 输入树登记请求，动作状态机检查许可和武器分支，主层保持持枪／移动姿态，上半身叠加层播放射击表现，出弹和射速处理由独立动作参与。50 帧的射击片段不是完整操作周期。
2. **稳定瞄准与移动射击存在独立参数约束。** `wp4000` 的准星收束启用积分表；移动、转镜头和射击各有扣分参数，弹丸同时保存普通／Fit 两套散布与暴击相关值。
3. **造成伤害和制造体术机会是两条需要分别追踪的链。** 头部对 `wp4000` 显式覆盖 DamageRate=1.2，但同条目的 Wince/Break/Stopping 均未设置覆盖。不能只用伤害倍率推导硬直。
4. **体术接近经过空间和动画共同修正。** 同一个回旋踢动作，根据距离配置使用不同起始帧与插值帧，再对齐到动作内部的接近结束帧。它不是简单的“范围内播放整条动画”。

这些结论以静态结构为依据。最终伤害公式、必出硬直阈值、输入取消窗口和有效命中帧仍未完全闭合，报告没有把它们写成实测规律。

## 1. 本轮实际完成范围

专项引用 37 个源 JSON，均无已记录的类型 CRC 差异；另补解析 73 个独立 UVAR 文件和 4 个玩家 FSM 的嵌入表达式。四个 FSM 合计 823 个节点、2,192 条结构边、1,669 条动作挂载记录；4,457 条标量参数保留来源文件和实例索引。

输入树核验了 83 个节点、66 条动作信息、67 条条件信息。145 条带 GUID 的转移中，104 条在本轮文件内匹配到嵌入表达式名称；41 条仍保留未匹配标记，不代表游戏资源损坏。379 个表达式节点的连线和输出节点通过结构检查。

[专项统计](summary.json) · [校验结果](validation.json) · [源文件与 SHA-256](source_manifest.json) · [未匹配表达式边](unresolved_expression_edges.csv)

## 2. 关联图：已接上的部分与断点

实线代表本轮核实的引用或结构连接；虚线表示尚未闭合的玩法因果链。

```mermaid
flowchart TD
    A[输入树 Node 51] --> B[ShootTrigger / ResetDryFire / BookShoot]
    B -.请求如何被调度仍需结合回调实现.-> C[上半身叠加层 Shoot]
    C --> D[checkAmmo]
    D --> E[checkFullAutoGun]
    E --> F[普通射击节点 11708713]
    F --> G[Bank 2 / Motion 500 动作树]
    G --> H[Bank 2000 / 500、501、502]
    F --> I[GenerateShell / GunFire / Rapid]
    J[WeaponID 4000 目录] --> K[wp4000 预制体]
    K --> L[ShellGenerator UserData]
    L --> M[wp4000 ShellInfo]
    M -.最终命中公式尚未闭合.-> N[敌人 Damage / Wince / Break / Stopping]
    N -.硬直资格与体术开放条件尚未闭合.-> P[体术请求]
    P -.接近配置.-> Q[Bank 1000 / Motion 900]
    Q --> R[按距离选择起始帧和插值]
```

图不表示全部节点在同一帧执行，也不代表图上箭头都有固定耗时。[流程证据表](action_timeline.csv) 将每一步的已知内容和缺口分开保存。

## 3. 输入到射击：请求不是动画直接播放

### 3.1 输入树的明确结构

`ch0commoninput_cs.user.2` 中，Node 50 通过 ConditionInfo ID=42 连接 Node 51；该条件的类型是 `PlayerBehaviorTreeScriptCondition_CheckCommand`，字段为 `_CommandType=1785394695`、`_CheckType=0`。本轮不擅自给这两个枚举值命名。

Node 51 绑定 ActionInfo 40、41、42：

|表项|动作类型|本轮确认内容|
|---|---|---|
|40|RequestActionInstruct|引用 NameHash=129164298；与候选名称 `ShootTrigger` 的哈希一致|
|41|ResetDryFire|存在空击状态重置动作|
|42|BookShoot|存在登记射击请求动作|

这些动作的 ActionInfo 均设置 `_IsOverrideStart=true`；不是凭名称推测它们在任意更新帧反复执行。哈希匹配算法已用 `R_Wep` 的本地已知值交叉校验，但名称候选仍保留来源，不将哈希一致说成数学上唯一的反解。

证据：[按根表重新核验的输入树](input_tree_verified.json)。旧的 `input_tree_resolved.json` 保留初步导出；正式核对入口使用 verified 版本。

### 3.2 射击许可与退出条件

本轮补出了之前只有 GUID 的条件名称，包括：

- `Tree_checkShootEnable`：包含对 `ShootEnable` 变量、动作指令、动作条件、DryFire 检查的引用，并通过 Logic/MultiLogic/Not 节点组合。
- `Tree_checkShootCansel`：引用动画结束、角色状态和动作条件。
- `Tree_checkUnderlayerShootCansel`：引用下层结束、角色状态和动作条件。
- `Tree_checkShootToHoldEnd`：引用下层结束与动作条件。

其中条件键 2830214703 与 `CheckHold` 的哈希匹配；它在条件表内进一步连接 `MeleeBreak` 变量相关检查和 Hold 动作指令检查。条件键 3130057401 指向 Hold 命令检查，但 CheckType 的枚举解释尚未证实。

**这里的设计意义是：射击许可和退出是条件网络，不是简单等动画播完。** 本轮保留逻辑操作码，没有未经验证就把 Operation=0/1 翻译成 AND/OR，也没有忽略 `_ConditionType` 和 `v2_Condition` 的取反语义。

证据：[嵌入表达式及连线](ch0commonupperbodyadd.motfsm2.43.expressions.json)、[条件键展开](shoot_condition_keys.json)、[状态转移表](player_fsm_edges.csv)。

## 4. 动作层与时序：持枪底姿态＋射击叠加

### 4.1 里昂预制体中的层序

身体预制体的 `via.motion.MotionFsm2.v11_Layer` 按数组顺序绑定：0 为 `ch0Common`，1 为 `ch0CommonArm`，4 为 `ch0CommonUpperBody`，5 为 `ch0CommonUpperBodyAdd`。这里说的是序列化数组槽位；不要把每个对象中的 `ExecuteMotionLayerNo=0` 误读成所有 FSM 都处于同一个槽。

对应 `via.motion.Motion.Layer`：主层 0 的 BlendMode=0，上半身叠加层 5 的 BlendMode=1；两者 BlendRate=1、JointMaskID=0、WorldRotationBlend=false。里昂头部预制体明确引用默认及三份难度变体的公共参数文件。

证据：[身体层与资源绑定](leon_body_bindings.json)、[头部公共参数绑定](leon_head_bindings.json)。这证明静态绑定，不证明任一时间点所有层同时以权重 1 生效。

### 4.2 Bank 2 到手枪实际片段的两级跳转

公共 `ch0commonbank.motbank` 的 Bank 2 指向 `cha_HOLD.motlist`：

|公共树|叶子内容|作用判断|
|---|---|---|
|Motion 160 / HOLD_LOOP|Bank 2000 的 160、165、167；Blend 和 PlaySpeed 节点|持枪、左右转向底姿态混合|
|Motion 500 / SHOOT|RandomParameterNode 范围 0–2；SelectMotionNode 的 500、501、502|射击变体选择|

`cha0_wp4000.motbank` 的 Bank 2000、BankType=1 显式指向 `cha0_wp4000H`；另有 513、1025 等变体条目。这里只确认普通配置对应项，不擅自把所有 BankType 合并为一个最终选择。

证据：[动作库引用链](animation_bank_chain.json)、[HOLD／SHOOT 树](hold_shoot_trees.json)。

### 4.3 普通射击分支的执行内容

`Shoot → checkAmmo → checkFullAutoGun` 之后，普通分支到容器 1155618135，再进入叶节点 11708713。同名 `ch0_500_SHOOT` 节点有多个，因此表格必须用节点 ID 区分。

叶节点启用了 AppPlayMotion（Bank 2 / Motion 500）、GenerateShell、GenerateMuzzleFlash、PostShootSoundDetectionTable、GunFire、Rapid 等动作；同节点的底层 `Fsm2ActionPlayMotion` 记录为禁用，不能把它与启用的 AppPlayMotion 重复计算。

射击到 Hold 的一条转移保存 `exitFrame=30`、`interpolationFrame=20`；容器的下层取消转移另有 `exitFrame=5`。这些数字受 EndType、条件和当前动作时间域约束，**不能直接宣布第 5 帧／第 30 帧可以取消射击**。

同理，`cha0_wp4000H` 的 500/501/502 各声明 50 帧、60 fps，只得到名义片段长度 0.833 秒。装备参数还另有 `_RapidSpeed=2.3`；本轮没有将其倒数当成射击间隔。

证据：[四套 FSM 原始结构](player_fsms.json)、[动作挂载与启用状态](player_fsm_actions.csv)。

## 5. 手枪的稳定瞄准与反馈

WeaponEquipParamCatalog 中 `_WeaponID=4000` 的实例 32 显式引用实例 7 的收束表；表再引用实例 6 的参数。没有从其他武器条目借值。

|收束字段|原值|
|---|---:|
|_ReticleFitEnable|true|
|_PointRange|Range(0, 100)|
|_HoldAddPoint|120|
|_MoveSubPoint|1000|
|_CameraSubPoint|123|
|_KeepFitLimitPoint|99|
|_ShootSubPoint|100|

**设计推断：**移动、镜头操作、开火分别影响稳定瞄准，玩家需要在移动安全与瞄准收益之间取舍。但目前未找到这套积分的时间步长、归一化和完整更新代码，不能用 `100/120` 推导精确收束时间。

同一武器的 ShellInfo 还保存：

|字段|普通|Fit|
|---|---:|---:|
|_RandomRadius|0.007|0.004|
|_CriticalRate|5|7|

这是更小的随机半径参数与更高的暴击相关参数；没有证据时，不把它们标成屏幕角度或百分比。MoveInfo 另有 `_Speed=300`、`_Gravity=0`，但尚未确认这些字段的最终时间／空间单位和引擎实现，不能据此断言具体弹速或 hitscan 行为。

相机后坐力单独配置 `_YawRangeDeg=Range(0,2)`、`_PitchRangeDeg=Range(3.2,0.5999999)`，并有曲线；这与骨骼射击叠加是不同数据层。相机选择配置也显式引用 `chHoldHandgun` 和 `ChFatalKick`，并非只有动画改变视感。

`Range` 在本地解析器中打印的是字段 `(s,r)`，不是已证明的 `(min,max)`。因此本报告保留原值，不把 `Range(2,1)` 误写成上下限颠倒的区间。

证据：[wp4000 装备参数完整展开](wp4000_equipment_expanded.json)、[预制体→生成器→弹丸链](weapon_resource_chain.json)、[相机选择绑定](camera_bindings.json)。

## 6. 命中与硬直：当前接到哪里

### 6.1 头部伤害覆盖不能代替硬直公式

`ch1c0z0` 的头部武器倍率表中，WeaponID=4000：DamageRate.HasValue=true、Value=1.2；WinceRate、BreakRate、StoppingRate 的 HasValue 均为 false。腿部对应条目四者均未设置覆盖。false 不是倍率为零，更不是免疫。

此外 `Ch1c0EquipWeaponStatusRateUserData` 依据敌人持有的武器 ID 分别调整生命值／Wince／Stopping：例如 5815 与 5824 对应 1 / 0.5 / 0.5，5823 对应 1.2 / 1.5 / 1.5。敌人装备会进入另一层状态修正；这些是敌人武器 ID，不是玩家 wp4000。

### 6.2 受击反应具有等级与抗性分支

`CharacterDamageReactionUserdata` 按 AttackType 分别保存 Heavy/Midle/Light 动作哈希；`BreakResistReactionInfo` 又区分 Wince、NormallyStopping、CompletelyStopping，并保存 `[50,100]` 阈值相关数组。它提供明确的分支结构，但未完成枚举、伤害累计和阈值调用的闭合。

所以当前可以确认“多通道效果和多档反应共同参与”，还不能严谨回答“某难度用该枪打某部位几发必出体术”。这是本轮最重要的未闭合环节。

证据：[敌人倍率、装备状态与反应链](enemy_reaction_chain.json)。

## 7. 体术接近：距离改变动画进入方式

公共参数的 `FatalKickApproachData` 给回旋踢（原名 `回し蹴り`）配置 Bank 1000 / Motion 900、AdjustEndFrame=43、AdjustDistance=1.2，并引用三条 MotionInfo：

|Type 原值|DistanceRange 原值|BeginFrame|InterpolationFrame|
|---|---|---:|---:|
|2|Range(0, 2)|35|10|
|1|Range(2, 1)|25|15|
|0|Range(3, 2)|15|20|

同一套配置共有八种踢击接近数据、24 条距离记录。能确定的是不同配置段会采用不同动作切入帧和插值长度；把 `(s,r)` 解释成具体空间区间还需要核验引擎 Range 语义与距离计算基准。

**设计推断：**较远接近配置保留更多动作前段，较近配置从更后面切入，从而减少近距离等待并给远距离留出对位过程。这是对数值关系的解释，不是已运行验证的实际位移曲线。

`FatalRangeUserdata` 还把 Knife、Kick、RoundKick、Notice、StealthKill 分开；默认 Kick=3、RoundKick=3.5、Notice=8，并有 CharacterKind 覆盖表。CharacterKind=200000 的覆盖也保存相同三项值，但本轮没有只凭 ID 将其认定为所有 ch1c0z0 状态的唯一有效配置。

接近参数与“是否允许体术”的资格条件是两回事。不要把较远的接近配置段上限直接宣布为体术按钮触发距离。

证据：[24 条接近记录](kick_approach.csv)、[默认与角色覆盖范围展开](fatal_ranges_expanded.json)。

## 8. 关卡案例：loc40_100 的静态刷怪控制

本轮选了 `level_loc40_100.scn.20`，其结构无 CRC 警告；读到 6 个启用的 CharacterSpawnController，每个保存自己的 GUID、SpawnCondition、SpawnSkipCondition 以及 `_DifficutyParam=63`。

例如实例 660 的 SpawnCondition 引用旗标 `968d96da-ce9a-4a98-920a-02e26dc7d6e5`，比较值为 true；其 SkipCondition 的旗标列表为空。这里不把 63 擅自解释为“所有难度”，也不把空列表在未核验求值规则时认定为永远 false。

配套 `chcxattr_loc40` 保存敌人参考点、编队覆盖区域和绕行点注册。这说明关卡为战斗提供空间与条件约束，而不只是摆放敌人模型。

目前这仍是**一个遭遇区域的静态案例**：六个控制器不是同屏六名敌人的证明，旗标的写入方、子场景加载条件、刷怪波次和跨场景坐标尚未还原。本轮不虚构“进入→六人围攻→击杀后开门”的完整流程。

证据：[六个刷怪控制器与旗标](loc40_100_spawn_controls.json)、[空间控制实例](loc40_space_controls.json)。

## 9. 下一步最值得补的三个断点

1. **射击许可与实际射速**：解释剩余 GUID、CheckType/EndType 等枚举，追踪 ShootEnable 和 Rapid 的更新入口。目标是得到合法输入窗口，而不是再累计片段长度。
2. **命中到体术资格**：从敌人身体部位绑定、Wince/Stopping 累积阈值和状态切换继续追踪，验证哪些受击状态开放哪种体术。
3. **loc40 遭遇时序**：围绕已保存的 GUID 找旗标写入和加载条件，把空间节点挂到真实刷出对象，再决定是否需要地图展示。

本轮的主要成果是已核实引用链、参数与明确断点；尚未构成可完整执行的战斗模拟器，也不是游戏帧级实测报告。

## 10. 数据和复现入口

- [参数表](parameters.csv)：文件路径、实例索引、类、字段和值。
- [步骤与未决问题](action_timeline.csv)：没有虚构统一时间轴。
- [输入树核验版](input_tree_verified.json)、[FSM 边](player_fsm_edges.csv)、[FSM 动作](player_fsm_actions.csv)。
- [名称哈希候选](name_hash_candidates.csv)：候选匹配，不是未经碰撞检查的权威命名表。
- [来源审计](source_manifest.json)与[验证结果](validation.json)。

脚本：`scripts/re4/DeepParser` 导出独立与嵌入 UVAR；`combat_loop.py` 汇总专项证据；`finish_combat_loop.py` 重新核验输入表、连线和来源；`write_combat_report.py` 生成本报告。所有路径以 `E:/CodexPepo/RE_Research` 为工作区根，原始 PAK 不变。
'''
(O/'RE4_手枪战斗链深挖.md').write_text(report,encoding='utf8')
missing=[];links=[]
for x in re.findall(r'\]\(([^)]+)\)',report):
 if not x.startswith('http'):
  links.append(x)
  if not (O/x).exists():missing.append(x)
v.update(report_links_checked=len(links),missing_report_links=missing)
(O/'validation.json').write_text(json.dumps(v,indent=2),encoding='utf8')
assert not missing
print('report characters',len(report),'links checked',len(links))
