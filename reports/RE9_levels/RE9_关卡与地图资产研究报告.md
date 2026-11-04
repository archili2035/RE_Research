# RE9（生化危机9：安魂曲）关卡与地图资产研究报告

> 研究对象：`G:\SteamLibrary\steamapps\common\RESIDENT EVIL requiem BIOHAZARD requiem`
> 引擎：CAPCOM RE Engine（DX12，`re9.exe`）
> 日期：2026-11-04

---

## 1. 结论速览

- 游戏为《Resident Evil 9: Requiem》（生化危机9：安魂曲），Steam 版，标准 RE 引擎打包。
- 全部数据打包在 `re_chunk_000.pak` 系列，共约 **78 GB**（主 pak + sub pak + 6 组 patch）。
- 关卡采用 RE 引擎开放关卡流式加载架构，分三层：
  - **章节层（chapter）**：`chap1 / chap3 / chap4 / chap5 / ff`，无 `chap2`。
  - **舞台层（stage 流式区块）**：`st10 / st30 / st40 / st50 / st90`，共 1340 个 layout 区块。
  - **资源层**：`environment/sm/sm0x~sm9x` 静态网格库 + 纹理 + 材质 + 碰撞 + 光照。
- 解包工具链已验证可用：`REE.PAK.Tool`（Ekey）+ `RE9_STM_Release.list`，成功解出真实文件名路径。

---

## 2. pak 资产总览

| 文件 | 大小 | 说明 |
|---|---|---|
| re_chunk_000.pak | 20.2 GB | 主 pak |
| re_chunk_000.pak.sub_000.pak | 57.5 GB | sub pak（流式加载内容） |
| re_chunk_000.pak.patch_001.pak | 1.43 GB | 补丁 |
| re_chunk_000.pak.patch_002.pak | 20.1 MB | 补丁 |
| re_chunk_000.pak.patch_003.pak | 1.22 GB | 补丁 |
| re_chunk_000.pak.patch_004.pak | 86.2 MB | 补丁 |
| re_chunk_000.pak.patch_005.pak | 26.5 MB | 补丁 |
| re_chunk_000.pak.sub_000.pak.patch_001~005 | 144 B ~ 74.9 MB | sub 补丁 |

- 文件名清单 `RE9_STM_Release.list` 共 **183,361** 个条目，全部位于 `natives/stm/...`。
- 其余为运行时文件（`shader.cache2`、`piplinelist.bin`、D3D12/DLSS 等），与关卡资产无关。

---

## 3. 目录结构（natives/stm/ 下一级）

| 目录 | 文件数 | 与关卡的关系 |
|---|---|---|
| environment | 52,687 | **关卡环境几何/纹理的主体** |
| gameassets | 46,256 | 游戏内容（角色/武器/道具/机关） |
| streaming | 33,914 | **流式加载（关卡分区数据）** |
| character | 14,453 | 角色 |
| animation | 8,827 | 动画 |
| event | 6,940 | 事件（含 6,772 个过场 cutscene） |
| vfx | 4,791 | 特效 |
| sound | 3,714 | 音频 |
| light | 2,787 | 光照 |
| gui | 2,677 | UI |
| leveldesign | 2,342 | **关卡设计逻辑（章节/机关/道具）** |
| appsystem | 2,231 | 应用系统 |
| systems / materialshader / develop / materiallibrary_2 / message / config 等 | 少量 | 支撑 |

---

## 4. 关卡 / 地图结构

### 4.1 章节层（chapter）—— 技术命名 vs 剧情对照

RE 引擎按"物理可玩地图"组织 chapter，而非按剧情分章。

| 技术名 | stage | layout 区块数 | 剧情对应（据攻略） |
|---|---|---|---|
| chap1（chap1_00/01/10） | st10 | 110 | 鹪木市·鹪木旅馆（格蕾丝，教学关） |
| chap3（chap3_01~40，11 个子关） | st30 | 457 | 罗兹山护理中心（格蕾丝+里昂，游戏最长章节） |
| chap4（chap4_00~50，7 个子关） | st40 | 594 | 浣熊市废墟 + RPD 警察局（里昂线） |
| chap5（chap5_02~10，5 个子关） | st50 | 162 | 地下方舟 ARK（最终） |
| ff_01 / ff_02 | st90 | 1 | 最终战 / 结局 |
| cleargame | — | — | 通关结算 |

- **无 chap2**：`leveldesign` 下不存在 `chap2`，但 `environment/sm/sm2x`（3,670 个文件）仍在——环境资产残留，疑似开发中被合并/砍掉的内容（见 §7）。
- 双主角：格蕾丝（FBI 分析员，第一人称潜行解谜）+ 里昂（特工，第三人称枪战）。

### 4.2 舞台层（stage 流式区块）

`environment/layout/exec/` 共 **1,340** 个布局区块，命名形如 `st40_209`：

| stage | 区块数 | 备注 |
|---|---|---|
| st10 | 110 | 第 1 章 |
| st11 | 2 | 第 1 章附加 |
| st30 | 457 | 第 3 章（最大） |
| st31 | 2 | 第 3 章附加 |
| st40 | 594 | 第 4 章（最大） |
| st41 | 12 | 第 4 章附加 |
| st50 | 162 | 第 5 章 |
| st90 | 1 | 最终战 |

每个区块是关卡的流式分区（composite scene），如 `st40_202 / st40_209 / st40_233` 等，运行时按需加载——典型 RE 引擎开放关卡做法（同 RE4 重制、RE Village）。

### 4.3 资源层（environment/sm 静态网格）

| 分组 | 文件数 | 对应 |
|---|---|---|
| sm0x | 14 | 序章 |
| sm1x | 16,085 | 第 1 章环境 |
| sm2x | 3,670 | 第 2 章环境（关卡逻辑缺失，见 §7） |
| sm3x | 7,826 | 第 3 章环境 |
| sm4x | 308 | 第 4 章环境（少量，几何多走 streaming） |
| sm5x | 539 | 第 5 章环境 |
| sm7x | 29 | — |
| sm8x | 4,146 | 终章（ARK / 最终战） |
| sm9x | 341 | 终章附加 |
| （无 sm6x） | — | 第 6 章环境不存在 |

`sm` 目录文件构成：`.mdf2`（材质 11,650）+ `.mesh`（网格 10,162）+ `.sdftex`（SDF 纹理 8,753）+ `.mcol` 等。

---

## 5. 关卡相关文件类型

| 扩展名 | 数量 | 说明 |
|---|---|---|
| .mesh | 22,027 | 模型网格（含骨架），关卡几何主体 |
| .tex | 48,601 | 纹理（DDS 容器） |
| .mdf2 | 13,642 | 材质定义（引用纹理） |
| .sdftex | 8,914 | SDF 纹理（近距离烘焙/字体/杂项） |
| .pfb | 8,844 | 预制体（决定物件用哪些 mesh/mdf/chain） |
| .scn | 5,974 | 场景文件（关卡布局/灯光/触发器） |
| .rcol | 312 | 碰撞体 |
| .chain / .chain2 | 175 | 骨骼物理 |
| .rmesh | 556 | 渲染网格（角色/皮肤专用） |
| .efx | 2,268 | 特效 |
| .fsmv2 / .motlist / .motbank | — | 动画 / 动作列表 |

---

## 6. 解包工作流（已验证）

工具：`REE.PAK.Tool`（Ekey，GitHub），内含 `REE.Unpacker` / `REE.Packer`。

```bash
# 1. 下载工具 + 文件名清单
# release 包: REE.Unpacker-x86.zip（含 REE.Unpacker.exe）
# Projects 文件夹: git clone --depth 1 https://github.com/Ekey/REE.PAK.Tool.git
# 确认 Projects/ 内有 RE9_STM_Release.list（Steam 版）与 RE9_EGS_Release.list

# 2. 解包（需在 exe 同目录运行，否则报 ZSTD 缺失）
cd <工具目录>/unpacker
./REE.Unpacker.exe "RE9_STM_Release" \
  "G:/SteamLibrary/steamapps/common/RESIDENT EVIL requiem BIOHAZARD requiem/re_chunk_000.pak" \
  "G:/_RE9_research/extract"
```

验证结果：已用 `re_chunk_000.pak.patch_005.pak`（26.5 MB）成功解出 253 个文件，`RE9_STM_Release.list` 与 Steam 版哈希完全匹配，文件名解析正确。

注意事项：
- 必须先 `cd` 到 exe 所在目录（`libzstd.dll` 依赖当前工作目录）。
- `.NET Framework 4.7.2` 依赖，Windows 默认满足。
- RE9 属较新 RE 引擎（同 MH Wilds）：**不支持自定义 PAK**（放入会崩溃），`.tex` 必须进 patch pak，需 REFramework 的 Loose File Loader 加载。

---

## 7. 值得关注的发现

1. **被砍掉的"第 2 章"**：`leveldesign/chapter` 无 `chap2`，但 `environment/sm/sm2x`（3,670 文件）与 `animation/ch/ch02` 仍在——第 2 章环境与角色资产已做，关卡逻辑被移除/合并。这是 cut content 的直接证据，符合攻略中"初代洋馆回归被删减，仍残留场景文件"的说法。
2. **sm6x 整体缺失**：第 6 章环境资产不存在，但 `sm7x`（29）、`sm8x`（4,146）、`sm9x`（341）存在——章节编号与环境编号存在系统性错位，指向开发中期章节重组。
3. **最终章双命名**：`ff_01/ff_02`（final fight）+ `st90`，与剧情"地下方舟 ARK + 释放/毁灭 Elpis 双结局"对应。
4. **过场规模**：`event/cutscene` 6,772 个，命名 `cXXXsXXX`（如 `c311s900` = 第 3 章场景区 11 第 900 号镜头），覆盖 c1/c3/c4/c5 四章。

---

## 8. 完整解包成本估算

- 数据总量约 78 GB（含压缩），解包后约 **100~120 GB**（zstd 解压膨胀约 1.2~1.5 倍）。
- G 盘可用 2.8 TB，空间充足。
- 时间：机械盘约 40~80 分钟，SSD 约 15~30 分钟（取决于 CPU 核数与 zstd 解压速度）。
- 建议按需解包：仅研究关卡 → 优先解 `sub_000.pak`（含 streaming/environment）；仅研究过场 → 解主 pak。

---

## 9. 下一步建议

| 优先级 | 动作 | 用途 |
|---|---|---|
| P0 | 完整解包 `re_chunk_000.pak.sub_000.pak` | 拿到 environment 关卡几何与 streaming 分区 |
| P1 | 用 Noesis + RE Engine 插件 / Blender + RE-Mesh-Editor 查看 `.mesh` | 可视化具体关卡场景 |
| P1 | 用 RE-Asset-Library 按名检索模型 | 定位特定关卡/角色资产 |
| P2 | 解析 `gui/message` 下的本地化文本 | 提取章节标题、地图名、剧情文本 |
| P2 | 对比 `sm2x` 与 `chap3` 的几何重叠 | 确认被砍内容的边界 |
