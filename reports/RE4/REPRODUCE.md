# RE4 流水线复现与目录说明

研究根目录：`E:/CodexPepo/RE_Research`。脚本内固定了本机游戏路径、工作区路径和 zstd DLL 路径；迁移机器前需修改。

## 依赖

- Python 3.12，标准库即可；zstd 通过 ctypes 调用 `tools/zstd/zstd-v1.5.7-win64/dll/libzstd.dll`。
- 本地 `.NET 8`：`tools/dotnet/dotnet.exe`。
- Parser 工程引用现有 `scripts/CameraAudit/bin/Release/net8.0` 下的 REE-Lib、ZstdSharp 和 xxHash DLL。它是当前本地编译依赖，不是独立可移植发行包；如清理构建目录，需先从本仓库 ReeLib 源码重建这些依赖。
- 初始名称表 `tools/REE.PAK.Tool/Projects/RE4_STM_Release.list`。
- 补充名称表 `references/RE4/RE4_STM_REasy.list`。
- 正式结构字典 `references/RE4/rszre4_reasy.json` 和修正 `rsz_patch.json`。
- `references/RE4/rszre4.json` 是初始参考字典，未作为正式批处理最终字典。

## 输入来源

- https://raw.githubusercontent.com/seifhassine/REasy/refs/heads/master/resources/data/lists/RE4_STM.list
- https://raw.githubusercontent.com/seifhassine/REasy/refs/heads/master/resources/data/dumps/rszre4.json
- https://raw.githubusercontent.com/kagenocookie/REE-Lib-Resources/refs/heads/master/re4/rsz_patch.json
- https://raw.githubusercontent.com/alphazolam/RE_RSZ/main/rszre4.json

下载文件与解析 DLL 的 SHA-256 见 `source_hashes.json`；本次保存快照，无需为了复现重新下载远程最新文件。

## 执行

在研究根目录执行，所有产物只写 `reports/RE4`、`scripts/re4` 和 `references/RE4`。将重新生成对应研究产物，避免同时对同一个输出目录运行两轮相同命令。

```powershell
python scripts/re4/inventory_extract.py
python scripts/re4/supplement.py
$env:DOTNET_CLI_HOME='E:/CodexPepo/RE_Research/tools/dotnet-home'
& tools/dotnet/dotnet.exe build scripts/re4/Parser/Parser.csproj -c Release
& tools/dotnet/dotnet.exe scripts/re4/Parser/bin/Release/net8.0/Parser.dll all
& tools/dotnet/dotnet.exe scripts/re4/Parser/bin/Release/net8.0/Parser.dll animation
& tools/dotnet/dotnet.exe scripts/re4/Parser/bin/Release/net8.0/Parser.dll fsm
python scripts/re4/analyze.py
python scripts/re4/refresh_fsm.py
python scripts/re4/write_report.py
python scripts/re4/verify.py
```

`supplement.py` 消费已保存的 `supplemental_name_matches.json`。若换游戏版本或名称表，应先重新计算该文件，不能将当前哈希映射盲用于另一版本。`name_hashes.json` 也是当前名称表的缓存；修改名称表时应换用新的研究输出目录或重新生成缓存。

## 产物语义

- `summary.json`：补充名称表前的首轮基线。
- `research_summary.json`：最终汇总；FSM 专项刷新包含完整转移种类。
- `parse_log_all.jsonl` 和 `parse_log_animation.jsonl`：按文件统计，不含专项复查次数。
- `parse_log_fsm.jsonl`：FSM 补充审计，不应与前两者相加当作唯一资源数。
- `schema_mismatches.csv`：结构类型 CRC 差异；没有差异也不等于全部语义已经验证。
- `state_edges.csv`：序列化关系，Children、States、EntryTransitions、AllStates 分列；节点以文件路径和 ID 标识。
- `enemy_rank_curves.csv`：曲线控制点可读摘要，不包含全部切线语义，不应直接替代游戏插值函数。
- `research.sqlite`：玩法查询便利库；保存筛选后的 chainsaw 类型，全部原始结构仍以 parsed JSON / extracted 二进制为准。

动作数据未展开所有继承链，也没有把树、镜像、链接强行当作独立 MOT。骨骼轨道采样、模型导出、关卡可视化和运行时验证未在本轮交付中完成。
