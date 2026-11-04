# RE Requiem 角色动画拆分研究（首轮实证）

研究日期：2026-11-04。源目录：G:/SteamLibrary/steamapps/common/RESIDENT EVIL requiem BIOHAZARD requiem。

## 方法与覆盖范围

只读全部 12 个 PAK 的目录索引，以 Ekey 的 RE9_STM_Release.list 双大小写 Murmur3 哈希匹配路径。主包 134143 条目，匹配 animation 目录 8839 条；补丁包另有 279 条匹配记录（包含版本重复）。子包没有匹配到该清单下的 animation 路径，这不等于证明其中不存在未知动画资源。

按角色目录 /ch0100/ 提取 motlist 与 motbank，得到 324 个文件版本：320 个 motlist、4 个 motbank（包括补丁版本）。样本保存原始 PAK 来源，不进行覆盖。统计包含旧版与补丁重复，不能作为当前生效版本或全游戏动作总数。

依据 RE-Engine-Lib 的 RE9 格式定义，校验 motlist/motbank magic 并读取头部及索引。24926 个动作槽中：6764 个槽指向内嵌 MOT，122 个指向 MTRE 动作树，18040 个为空指针。空槽可能通过基础列表或外部 motpack 补全，不能判为缺失动作。71 个列表文件版本含 motpack 引用。本轮没有解析外部 motpack。

## 已验证的拆分规则

1. 角色目录 → 动画库 motbank → 多个动作列表 motlist → 动作槽 → 内嵌 MOT 或动作树。motbank 带 BankID、类型和列表路径；motlist 动作索引包含动作 ID、Switch、jointMaskId 和 flags。
2. 武器及变体分别组织，例如 handgun、revolver、shotgun、rifle、machinegun、chainsaw；列表名还有 fps、_add、verB 等后缀。存在这些分组是实证，fps/_add/H/M 的完整运行时语义尚未验证。
3. 单项行为进一步拆阶段。例如同一样本包含 Shoot_Short_Start、Shoot_Short_Loop、Shoot_Short_End；Hold 同样有 Start、Loop、End。并非每种动作都有三段。
4. 移动按方向与姿态拆分：Strafe_F/L/B/R_Loop；Crouch_walk_strafe_F/L/B/R_Loop；Hold_Start_L0/L90/L180/R90/R180。可解释为方向、角度与蹲姿的动画变体，不代表已经恢复运行时混合参数。
5. 列表支持继承与局部替换：ch0100_Handgun01H 的 BaseMotListPath 指向 ch0100_Handgun00H；ch0100_Handgun01HverB、verC、verD 又指向 Handgun01H。复用不是只靠复制整份动作。实际继承解析和空槽填充仍需进一步验证。
6. 面部库独立组织。解析出的库引用包括 Face_Emotion、Face_Mouth_LipSync、Face_Damage、Face_GrappleCommon、Face_Dead。身体与表情的资源组织分离已经确认，但各层叠加权重尚未读取。
7. 同一槽可以承载动作树，不能将 motlist 的每个条目都当作一个原始动画片段。

## 原始动作头部示例

| 动作 | frameCount | FrameRate | 骨骼动画轨道数 |
|---|---:|---:|---:|
| ch0100_Handgun01H_0141_Hold_Start_L90 | 30 | 60 | 67 |
| ch0100_Handgun01H_0200_Crouch_walk_strafe_F_Loop | 89 | 60 | 67 |
| ch0100_Handgun01H_1200_Reload | 312 | 60 | 67 |

frameCount 为源字段，未强行换算游戏实际播放时长；运行时变速、混合及帧端点约定会影响时长。轨道数不等于角色完整骨骼数。verD 对应 Hold_Start_L90 的 frameCount 为65，可见同一用途的变体也可能改变长度。

## 数据与复现

- inventory.tsv：所有匹配动画路径、所属 PAK、解压尺寸和存储属性。
- lists.csv：列表名、槽数、基础列表及 motpack 引用。
- motions.csv：动作槽、ID、Switch、Mask、flags、名称、帧数和骨骼轨道数。
- banks.csv：库到动作列表的引用。
- ../scripts/run.ps1 与 Research.cs：索引读取及定向提取。
- ../scripts/analyze.ps1：样本元数据解析。

## 证据边界与后续

尚未把 ch0100 映射为已验证的剧情人物名；尚未覆盖其他角色。未恢复状态机切换、完整动作树、身体骨骼遮罩、root motion、事件命中帧或引擎实际混合效果。要进一步解释“上半身射击如何叠到移动上”，需继续读取 motpack、jmap、motfsm2 及角色配置并追踪具体引用，而不能只凭 _add 后缀推断。

工具来源：
- https://github.com/Ekey/REE.PAK.Tool （PAK 解码、哈希及 RE9 路径清单）
- https://github.com/PieceMetal/ReExtractor
- https://github.com/PieceMetal/RE-Engine-Lib （MotlistFile/MotFile/MotbankFile 格式定义）
- https://github.com/facebook/zstd/releases/tag/v1.5.7 （x64 解压库）

游戏目录未写入文件。研究脚本仅支持本次观察到的 PAK 布局，不是通用解包器。
