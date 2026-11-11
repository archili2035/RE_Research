# RE4 首轮资产准备：UE 5.8.4

日期：2026-11-08。目标：里昂 cha000 / ch0a0z0、wp4000 手枪、主线 _chainsaw。

## 本轮交付

- 已更新[主计划](../ue5_3c_validation_plan_and_asset_pipeline_zh.md)，确认先 RE4、后 RE9，使用 UE 5.8.4。
- 从当前安装的 7 个 PAK 重新读取目录，提取 288 个源文件，共 34,232,527 字节，写入独立工作区；不修改游戏文件。
- 样本含身体、头部、头发、手枪模型，匹配的材料定义，以及手枪动作列表和候选配置依赖。该集合不是全量贴图包，也未宣称全部依赖闭合。
- 每个提取文件记录 PAK、偏移、长度、路径哈希和内容 SHA-256，并回读校验。补丁覆盖是静态排序模型，尚非运行时加载追踪。
- 生成里昂灰模 FBX 和 Blender 源场景；已完成 Blender → FBX → Blender 回读验证和预览图检查。
- 解码 11 条原始动作，保存骨架、轨道、时间戳和来源哈希；不是动画 FBX，尚未进行动作组合或 UE 播放验收。

## 可用于首次模型导入的文件

- [灰模 FBX](../../runtime/ue5_asset_probe/re4_wp4000/fbx/SK_RE4_Leon_Gray.fbx)
- [Blender 源场景](../../runtime/ue5_asset_probe/re4_wp4000/blender/RE4_Leon_Gray.blend)
- [灰模预览](re4_gray_model_preview.png)
- [完整源资产清单](re4_wp4000_source_manifest.json)
- [导出记录](re4_gray_model_export.json)
- [FBX 回读检查](re4_gray_model_roundtrip.json)
- [动画解码诊断](re4_motion_decode_validation.json)
- [动作选择清单](re4_wp4000_clip_selection.json)

实际输出根目录：`E:/CodexPepo/RE_Research/runtime/ue5_asset_probe/re4_wp4000`。

## 模型验证结果

| 检查项 | 结果 |
| --- | --- |
| 模型来源 | 身体 cha000_00、头部 cha000_10、头发 cha000_20，LOD0 |
| 骨架 | 415 骨骼，一个真实根骨 root；容器名 Armature |
| 网格 | 合并为一个网格，178,993 顶点、247,459 面 |
| 权重 | 导出前最多 7 个影响；无零权重顶点；未做减骨或降权 |
| 尺寸 | 场景单位为米，高度范围约 1.846858；含装备、头发和模型最低点 |
| FBX 回读 | 骨名、父子层级、顶点数及面数保持一致 |
| 关节位置最大回读误差 | 5.962326831740902e-7 场景单位 |
| 包围盒最大回读误差 | 5.960464477539063e-8 场景单位 |
| UE 5.8.4 验收 | 未进行，等待引擎安装及实际导入 |

灰模使用统一材质。头发透明、贴图、表情、布料、武器挂接和运行时 IK 尚未还原。此次回读检查不能证明原游戏姿态保真，也未完成蒙皮变形和 UE 内权重检查。

## 实际转换路线及依赖

本轮使用用户已有的：

- `G:/_RE9_research/tools/blender-5.0.1-windows-x64/blender.exe`
- `G:/_RE9_research/tools/re-mesh-editor`

转换路线为：已解包 MESH → RE Mesh Editor 的模型导入函数 → Blender 5.0.1 → FBX 7400。

原定 ReExtractor 完整导出工程在当前工作区要求 .NET 10，并引用未包含的 GDeflateNet 子模块；当前工作区可用 SDK 是 .NET 8.0.427。因此模型先走现成备用路线，没有修改第三方工具源码或安装新的 SDK。

原始动画解码复用 `scripts/CameraAudit/bin/Release/net8.0` 中已编译的 REE-Lib、ZstdSharp 和 xxHash DLL；这是本机现有依赖，并非独立可移植工具发行包。

FBX 导出设置：保留全骨架、关闭 Add Leaf Bones、不烘焙动画、单位转换启用、轴向 -Y forward / Z up；未启用重定向。是否需要调整 UE 中的导入朝向，仍须实际验收。

## 动作清单与已发现问题

| ID | 用途 | 当前状态 |
| --- | --- | --- |
| 140 | 举枪主体 | 原始轨道已解码，骨名可定位；未组合 |
| 141 | 举枪配套 Add | 原始轨道已解码，2 个骨骼哈希尚未映射 |
| 158 | 收枪主体 | 原始轨道已解码，骨名可定位；未组合 |
| 159 | 收枪配套 Add | 原始轨道已解码，2 个骨骼哈希尚未映射 |
| 160 | 持枪循环 | 原始轨道已解码，1 个骨骼哈希尚未映射 |
| 165 / 167 | 持枪左／右转身 | 原始轨道已解码，各有同一个未映射哈希 |
| 403 | 持枪前移循环 | 原始轨道已解码，骨名可定位 |
| 500 / 501 / 502 | 三条射击增量候选 | 原始轨道已解码，各有同一个未映射哈希；不能直接视为完整射击姿态 |

未映射哈希共三个：2540998253、1595776407、2749258283。已尝试用动作骨架及身体/头部/头发模型骨名哈希匹配，仍未定位。下一步应检查关节映射表、其他相关骨架、辅助/武器骨与解析器规则；不按相近索引猜测，也不静默丢弃轨道。

原始 JSON 的 bone 索引只指当前动作自带 bones 数组；-1 表示该数组没有该骨。boneName 另可来自实际模型骨名；仍为空时按 unmappedBoneHashes 处理。轨道值和时间戳已检查有限值与单调性，但这不证明其坐标空间或增量语义。

特别更正：RE4 的 161 是 hold_danger_loop；本轮收枪使用 158，不能复用 RE9 的 161。举枪 140 / 收枪 158 也不能仅因能够播放就认定最终分层姿态正确。

## UE 安装完成后的第一次操作

1. 创建第三人称蓝图项目，保留默认角色作为对照。
2. 建立独立的 RE4Reference 目录，导入 SK_RE4_Leon_Gray.fbx。
3. 开启骨骼网格导入，新建 Skeleton，不选择 Manny 的 Skeleton；关闭动画导入，先用统一灰色材质。
4. 第一轮保持导入缩放为 1，记录使用的导入器及设置，不同时尝试多种轴向补偿。
5. 检查角色是否站立、尺寸是否约 185 cm、前向和单 root 层级是否正确，检查骨骼权重是否被截断。
6. 模型通过后再导入动画 FBX；当前 decoded/*.json 不直接拖入 UE。

## 下一步

优先补齐三个骨骼哈希的来源，得到可追踪的动画骨架；再通过现有 ReExtractor 导出能力或经过验证的备用转换器，生成持枪与射击组合 FBX。原始轨道与烘焙组合应分目录，避免把已组合片段再次当 Additive 叠加。

之后对原骨架回放、根运动、手脚和武器挂点做抽样验证，再进行 Manny 重定向。原作运行时的层权重、输入窗口和镜头验证仍属于后续工作。

## 复现入口

在研究根目录使用 PowerShell：

```powershell
python scripts/ue5/prepare_re4_sources.py
$env:DOTNET_CLI_HOME='E:/CodexPepo/RE_Research/tools/dotnet-home'
& tools/dotnet/dotnet.exe build scripts/ue5/DecodeRe4Motions -c Release -p:UseAppHost=false
& tools/dotnet/dotnet.exe scripts/ue5/DecodeRe4Motions/bin/Release/net8.0/DecodeRe4Motions.dll 'E:/CodexPepo/RE_Research'
& 'G:/_RE9_research/tools/blender-5.0.1-windows-x64/blender.exe' --background --factory-startup --python-exit-code 1 --python scripts/ue5/export_re4_gray_blender.py
& 'G:/_RE9_research/tools/blender-5.0.1-windows-x64/blender.exe' --background --factory-startup --python-exit-code 1 --python scripts/ue5/verify_re4_gray_roundtrip.py
```

脚本固定本机路径；迁移时需要调整。重新提取会刷新源清单，之前的导出应重新生成并验收。
