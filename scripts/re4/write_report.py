import pathlib,json,csv,collections
O=pathlib.Path('reports/RE4');s=json.loads((O/'research_summary.json').read_text())
def table(headers,rows):return '| '+' | '.join(headers)+' |\n|'+'|'.join(['---']*len(headers))+'|\n'+'\n'.join('| '+' | '.join(str(x).replace('|','/') for x in r)+' |' for r in rows)+'\n'
def link(p):return '[原始解析](parsed/natives/stm/_chainsaw/'+p+'.json)'
text=f'''# RE4 解包与玩法结构研究：3C、动作、关卡、怪物、战斗

研究日期：2026-11-07。来源是本机 `G:/SteamLibrary/steamapps/common/RESIDENT EVIL 4  BIOHAZARD RE4` 的 7 个 PAK；安装目录未写入任何文件。所有产物独立保存在 `reports/RE4`，没有把此前 RE9 数据混入本报告。

## 1. 本轮结论与证据边界

已经建立可继续钻取的资源底座，并完成五个维度的第一轮静态分析。最值得深入的不是孤立的动作时长，而是 **动作优先级与切换条件 → 分层动画 → 相机状态 → 敌人 Rank 与群体限制 → 关卡空间约束** 这条链。

以下“确认”只表示在本机资源里读到了对应结构或字段，不代表已经验证运行时执行顺序、单位、覆盖优先级或最终游戏表现。没有运行游戏、注入采集器或修改存档。

{table(['项目','结果'],[['合并补丁后的资源哈希',f"{s['effective_entries']:,}"],['已还原路径',f"{s['resolved_effective']:,}（{s['resolved_effective']/s['effective_entries']:.2%}）"],['未知哈希',s['unknown']],['已提取文件',f"{s['extracted_files']:,}，{s['extracted_bytes']:,} 字节（约 2.38 GB）"],['解析成功 / 尝试',f"{s['parse_success']:,} / {s['parse_attempts']:,}"],['结构解析失败','26 个，均位于 _vr 分支'],['存在类型 CRC 差异的资源',f"{s['schema_mismatch_resources']:,}；可读不等于布局已经核实"],['动作列表 / 内嵌 MOT 记录',f"{s['motion_lists']:,} / {s['motion_records']:,}"],['状态节点 / 导出的转移记录',f"{s['state_nodes']:,} / {s['state_edges']:,}"]])}

索引按主包、patch_001 至 patch_006 顺序以哈希覆盖；这是静态安装快照的覆盖模型，不是已抓取的运行时加载追踪。已提取文件逐个核对解压长度并保存 SHA-256。未全量提取纹理、模型和音频；首轮优先全量配置、场景、预制体、动作库及动作列表，另补提了新识别的 966 个资源。

`_chainsaw`、`_anotherorder`、`_mercenaries`、`_vr` 等内容分支分别保留。资源存在不能单独证明对应内容已授权、已加载或可游玩。下文案例默认取 `_chainsaw`，避免主线、追加内容和佣兵模式混算。

## 2. 3C：Character、Camera、Control

### 2.1 相机是按行为配置的状态集合

从同一玩家相机目录直接读取：

{table(['资源','_FieldOfView','_GazeDistance','_Offset'],[['chbattlenormal',64,1.6,'<0.35, 1.5, 0>'],['chholdhandgun',44,0.9,'<0.42, 0.495, 0>'],['chholdshotgun',44,1.05,'<0.4, 0.46, 0>'],['chcrouchdefault',60,1.4,'<0.4, 0.45, 0>']])}

证据：{link('appsystem/camera/playercameracontroller/ch0a0z0/chbattlenormal.user.2')}、{link('appsystem/camera/playercameracontroller/ch0a0z0/chholdhandgun.user.2')}、{link('appsystem/camera/playercameracontroller/ch0a0z0/chholdshotgun.user.2')}、{link('appsystem/camera/playercameracontroller/ch0a0z0/chcrouchdefault.user.2')}。这四个文件本轮未发现类型 CRC 差异。字段保留原名；没有擅自把距离标成米，也没有认定 FOV 的轴向和最终屏幕视角。

**设计推断：**战斗观察和精确瞄准采用明显不同的取景配置；不同武器还调整镜头距离，蹲姿调整跟随基点和偏移。应把这些状态的过渡阻尼、目标骨骼、碰撞和输入响应一起研究，而不是只复刻一个 FOV 数字。

手枪配置还包含 `_JointName=Spine_1`、`_EnableTightFollow=true`，以及独立的输入、输出阻尼对象；蹲姿使用 `Hip`，紧跟随开关为 false。完整曲线和引用保存在 JSON 的 `Instances` 中，可用 `Ref` 找到相应对象。

### 2.2 控制手感有明确的动作仲裁层

`ch0commonactionpropertyuserdata` 存在 `_Priority`、`_Occupied`、`_OccupiedPriorityEnum`、`_Repeatable`、`_ThinkOff`、`_OverrideSamePriority`；`ch0commonactiontransitionuserdata` 存在 `_Action`、`_FsmStateHash`、`_AfterEnd`、`_Warp`、`_ConditionCheck`。

证据：{link('appsystem/character/ch0common/userdata/ch0commonactionpropertyuserdata.user.2')}、{link('appsystem/character/ch0common/userdata/ch0commonactiontransitionuserdata.user.2')}。

**设计推断：**能否打断、能否重复以及何时接受下一动作，有独立配置层。单看动画结束帧无法还原响应性。动作哈希尚未全部映射到人类可读名称，不能凭数值大小认定具体动作。

`inertiamoverun` 和 `inertiamovedash` 均启用 `_IsUseArmDelay`；但 `_IsUseBodyRotationLerp=false`。因此，即使身体旋转插值倍率有数值，也不能据此断言该功能在这份配置中启用。

证据：{link('appsystem/character/ch0a0z0/userdata/inertiamoverun.user.2')}、{link('appsystem/character/ch0a0z0/userdata/inertiamovedash.user.2')}。碰撞支持器还保存胶囊／球形参数与楼梯修正开关，见 {link('appsystem/character/ch0common/userdata/ch0commoncharactercontrollersupporteruserdata.user.2')}。

## 3. 动作：先还原组合规则，再讨论帧数

读取了 2,760 个 MOTLIST 和 672 个 MOTBANK，导出 31,365 条内嵌 MOT 元数据、2,010 条动作库引用。这里的 MOT 记录不是独立玩法动作数量：包括叠加轨道、不同角色／模式的重复、循环和局部姿态；空槽、树节点和继承引用另存于动作列表 JSON。

`cha0_wp4000h.motlist.663` 的直接证据：

{table(['动作 ID','名称片段','声明帧数 / fps','名义时长'],[[140,'hold_start','20 / 60','0.333 s'],[141,'hold_start_add','20 / 60','0.333 s'],[160,'hold_loop','432 / 60','7.200 s'],['500 / 501 / 502','shoot 三条变体','50 / 60','各 0.833 s'],[810,'reload','195 / 60','3.250 s'],[811,'reload_add','195 / 60','3.250 s'],[910,'reload_tac','195 / 60','3.250 s']])}

证据：{link('animation/ch/cha0/motlist/cha0_wp4000h.motlist.663')}、[所有内嵌动作](motions_animation.csv)。秒数只是 `frameCount / FrameRate`，不代表举枪生效点、射击间隔、换弹实际耗时或取消窗口。也不能把 start、reload、end 的片段时长机械相加。

玩家公共动作状态机分为 `ch0common`、`ch0commonarm`、`ch0commonupperbody`、`ch0commonupperbodyadd` 等资源。其中 `ch0common` 有 439 个节点，可直接看到 `HoldWalk`、`HoldIdle`、`Walk`、`Dash`、`Parry` 等节点。文件拆分和名称提供分层证据；实际层权重、遮罩和状态活跃情况还需追踪配置绑定／运行时。

证据：{link('appsystem/character/ch0common/motion/fsm/ch0common.motfsm2.43')}；[状态节点](state_nodes.csv)、[状态转移](state_edges.csv)、[动作库引用](motion_bank_refs.csv)、[动作列表继承入口](motion_lists.csv)。转移表含 Children、States、EntryTransitions、AllStates，使用文件路径＋节点 ID 区分同名节点。它是序列化关系，不是所有转移都可达的证明。

## 4. 关卡：场景拆分与战斗空间配置

共成功解析 24,524 个 SCN。按路径聚合有 109 个“内容分支＋loc 目录”组合；这两个数都不是游戏关卡数或房间数，包含子场景、环境、不同内容分支和重复组织。

`loc40` 是一个可验证的组织样本：存在 `level_loc40` 及多个后缀子场景，同时拆出 `player_loc40`、`item_loc40`、`think_loc40`、`camdemo_loc40`、`chcxattr_loc40`。这种拆分支持从加载场景、玩家条件、道具、敌人空间和镜头演出分别追踪同一区域。

在 `chcxattr_loc40.scn.20` 读到：

{table(['类型','实例数'],[['Ch1c0ReferencePoint.PointInfo',160],['Ch1c0ReferencePoint',8],['Ch1c0z0GroupUserData.FormationSetting',16],['Ch1c0GroupFormationOverwriteArea',8],['Ch1c0DetourWayPointRegister',1]])}

证据：{link('leveldesign/location/loc40/chcxattr_loc40.scn.20')}，该文件本轮无类型 CRC 差异。这些是配置实例数，不能当作同时存在的敌人数或独立战斗次数。

**设计推断：**关卡给敌人提供参考点、编队区域覆盖和绕行注册，空间可以主动塑造包围与接近方式。后续最有价值的工作是把这些对象的空间位置、触发条件和实际敌人刷出关联起来，逐个还原遭遇战，而不是按场景文件数量评价关卡复杂度。

数据入口：[场景目录与玩法类](scene_catalog.csv)、[loc 分组](location_catalog.csv)、检索库中的 `resources` / `instances`。本轮没有完成地图几何可视化、跨场景坐标变换、门连接图和完整遭遇时序。

## 5. 怪物：按角色 ID 研究行为与群体调度

已建立 107 个“内容分支＋character 目录”资源分组，排除嘴型资源后统计。包含玩家、敌人、变体及辅助角色，不能宣称发现了 107 种怪物。正式名称映射尚未逐项用本地文本／模型确认，因此保留原始角色 ID。

`ch1c0z0` 提供了较完整的样本：独立 Rank 曲线、默认／部位武器伤害倍率、弹反消耗、群体编队和复活／寄生相关配置。其 Rank 曲线中：

{table(['键','直接读到的部分控制点','解释边界'],[['CrossBowShotInterval','0→7；4→3；7→1.5；10→1','间隔随 Rank 变化；控制点之间求值规则需继续验证'],['FlashReactionTime_Base','0→8；4→6；12→4','闪光反应时间相关基值'],['NonCounterattackRate','0→80；4→40；8→30；11→20','按原键保存，不直接认定百分比语义'],['RevivalRate_Base / ParasitismRate_Base','0→-20；4→0；10→15；12→20','存在负值，不能当作最终概率；很可能需组合基值，但公式未证实']])}

证据：{link('appsystem/character/ch1c0z0/userdata/ch1c0z0rankparamdatauserdata.user.2')}；[全体敌人 Rank 曲线](enemy_rank_curves.csv)、[角色目录](character_catalog.csv)。曲线导出的字符串是可读控制点摘要；完整切线、插值与运行时修正还在原始资源中。

**设计推断：**怪物难度变化并不限于血量和伤害，还体现在攻击节奏、反击倾向、闪光控制时长与复活／寄生机制。数据库中另有 `Ch1c0GroupParasiteRestrictionUserData`、`Ch1c0GroupRevivalRestrictionUserData` 类型，说明还存在群体约束层；个体曲线不能直接推出同屏事件频率。

## 6. 战斗：把伤害、控制效果、资源消耗和 Rank 分开

### 6.1 动态 Rank 配置是独立系统

`gamerankparametercatalog` 的 `GameRankParameterData.IsRankEnable=true`，`RankSetDataClass` 同时保存点数区间与 `Easy / Normal / Hard / VeryHard` 映射。例如实例 8：点数 0–999，对应 1 / 4 / 7 / 10；实例 10：点数 2000–2999，对应 1 / 5 / 8 / 11。文件还包含 `RankSetData2nd`，所以不能将所有行混成一张唯一映射，也不能据此断定界面难度到 Rank 的最终运行规则。

证据：{link('appsystem/catalog/maincontents/gamerankparametercatalog.user.2')}、[Rank 原始映射行](rank_mapping.csv)。该文件还保存击杀、道具、重试等点数条目，具体生效条件尚未验证。

公共敌人配置 `RankNoAttackTime` 将 `_AttackType` 与 Rank 区间下的 `_LightTime / _MidleTime / _HeavyTime` 分开组织。以 `_AttackType=1` 的引用组为例：Rank 0 为 16 / 17 / 18，Rank 4 为 3 / 3.5 / 4，Rank 9 为 2 / 2.5 / 3.5。仅凭名称不能把它概括成每次攻击固定冷却；但能确认“时间预算随 Rank 调整”这一结构。

证据：{link('appsystem/character/userdata/enemycommonrankparamuserdata.user.2')}。

### 6.2 武器效果不止一个伤害数字

`CharacterWeaponDamageRateUserData.Data` 按 `_WeaponID` 分开保存 Damage、Wince、Break、Stopping 四组倍率，而且每组有 `HasValue`。例如 `ch1c0z0` 默认表中许多 `Value=0` 对应 `HasValue=false`，表示该可选值未设置，**不能解读为零伤害或免疫**。

证据：{link('appsystem/character/ch1c0z0/userdata/ch1c0z0weapondamagerateuserdatadefault.user.2')}、[9,516 条倍率记录](weapon_damage_rates.csv)。主线、佣兵、追加内容和部位覆盖均保留原路径，需要按实际绑定关系选表。

### 6.3 弹反消耗按攻击动作配置

`ch1c0z0parryknifereduceuserdata` 中 `_ActionHash=1636992343` 的 `_ParryWeaponReduceValue=500`、`_ParryFailedWeaponReduceValue=500`。这是一个动作条目的原值，不是“所有弹反统一扣 500”，也未换算成 UI 耐久百分比。

证据：{link('appsystem/character/ch1c0z0/userdata/ch1c0z0parryknifereduceuserdata.user.2')}、[弹反消耗表](parry_costs.csv)。当前尚未确认完美弹反窗口、有效帧、耐久计算链和受难度影响的最终值。

## 7. 数据入口与使用方法

- [最终统计](research_summary.json)：本报告统计入口。`summary.json` 是首轮文件名表下的基线，不能替代最终统计。
- [有效资源清单](effective_inventory.csv)：路径、来源包、偏移、压缩／解压大小、属性、哈希；[所有包条目](pak_entries.csv) 保留覆盖前历史。
- [提取审计](extraction_log.csv)与[补充提取审计](supplemental_extraction_log.csv)：每个成功文件的 SHA-256。
- [类型差异](schema_mismatches.csv)、[解析失败](parse_failures.json)、[未知资源](unknown_entries.csv)：后续兼容性工作的明确清单。
- [检索数据库](research.sqlite)：`resources` 保存资源元信息，`instances` 保存约 392 万个筛选后的玩法实例（排除路径中的 sound、lipsync）。有意不把它们叫“392 万个玩法对象”：大量是序列化配置和重复实例。
- `parsed/`：完整镜像路径的 JSON；普通 RSZ 的引用在本文件 Instances 中解析。FSM 另保存 RszSections，不在数据库 instances 中混合不同分区的局部索引。
- `extracted/`：提取出的二进制资源；动画骨骼曲线、导航和碰撞等仍可从这里继续深挖。

示例 SQL：

```sql
SELECT path, idx, class, fields FROM instances
WHERE class = 'chainsaw.PlayerCameraParam'
  AND path LIKE '%/_chainsaw/%/ch0a0z0/%';

SELECT path, idx, fields FROM instances
WHERE class LIKE '%GroupParasiteRestriction%';

SELECT path, schema_issues FROM resources
WHERE type = 'scn' AND path LIKE '%/location/loc40/%';
```

## 8. 未完成部分与下一步优先级

1. **3C 主链**：从主角输入／ActionHash 出发，联到动作优先级、FSM 条件、动画 BankID／MotionID、相机覆盖；测举枪、开火、换弹、转向、弹反的实际输入接受点。
2. **一个完整遭遇战**：先选 loc40 的一组 level 子场景，解析刷怪条件、编队点、绕行点、区域触发与退出条件，再建立空间与时序图。
3. **一种敌人的完整状态表**：先用 ch1c0z0，把个体攻击、反击、复活、寄生和群体限制串起来；名称映射、动作有效帧和身体部位关系必须补证。
4. **战斗公式**：沿武器基础值→升级→部位倍率→Rank→受击／硬直／破坏阈值追踪，避免把任一表当作最终伤害。
5. **兼容性与运行验证**：处理 612 个未知哈希、26 个 VR 解析失败和 1,645 个有类型 CRC 差异的资源。当前字段解释仍需通过运行时抽样交叉验证。

## 9. 工具来源与可复现性

PAK 解析复用本仓库 `scripts/re9_monsters/pak_extract.py` 的格式逻辑，但本轮建立 RE4 独立流水线；提取器对资源加密、未知压缩方式和大小不一致均报错，不静默输出。格式名称表使用 [Ekey/REE.PAK.Tool](https://github.com/Ekey/REE.PAK.Tool) 的本地快照，并以 [REasy](https://github.com/seifhassine/REasy) 的 RE4 名称表补充。

结构解析使用本地 ReeLib 编译库及 RE4 类型定义：[RE_RSZ](https://github.com/alphazolam/RE_RSZ) 作为初始参考，正式批处理采用 [REasy 类型数据](https://github.com/seifhassine/REasy/blob/master/resources/data/dumps/rszre4.json) 与 [REE-Lib-Resources 修正](https://github.com/kagenocookie/REE-Lib-Resources/blob/master/re4/rsz_patch.json)。远程文件的下载快照与 SHA-256 已保留在 [来源哈希](source_hashes.json)。没有用这些资料替代本机资源数值。

脚本在 `E:/CodexPepo/RE_Research/scripts/re4`。顺序：inventory_extract.py → supplement.py → Parser all → Parser animation → Parser fsm → analyze.py → refresh_fsm.py。Parser 使用本机 .NET 8；路径和工具 DLL 依赖见 [复现说明](REPRODUCE.md)。
'''
(O/'RE4_五维研究报告.md').write_text(text,encoding='utf8')
print('report chars',len(text))
