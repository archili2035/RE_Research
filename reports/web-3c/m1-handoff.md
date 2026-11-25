# M1 两代手枪资产样本

[资产审计](asset-audit.json)记录当前 Steam 安装的 RE4 build 22377325 和 RE9 build 23634047。读取了计划列出的四份输入，并按两代相同的六项用途选样。每项的 `sourcePaths` 在同一游戏的 `sources` 中找到 PAK 路径、补丁、长度、哈希和提取结果。`resultFiles` 使用仓库相对路径，动作通过 `selector` 定位；`stages` 分别记录提取、解码、绑定和回读。相同 MOTLIST 的提取耗时共用一条来源记录。

| 用途 | RE4 cha000 / wp4000 | RE9 ch0100 / Handgun00H |
| --- | --- | --- |
| 持枪站立 | 160 | 100/160 |
| 持枪前移 | 403 | 100/120 |
| 举枪 | 140，配套 141 | 100/140 |
| 单发 | 500，增量候选 | 100/1100，TPSAdd 层引用 |
| 换弹 | 810，配套 811 | 100/1200，配套 2100/1200 |
| 收枪 | 158，配套 159 | 100/161 |

## 验证和交接

- 从两套安装读取 19 个 PAK 的目录及选中数据，26 个来源的提取和 SHA-256 核对通过。两代的持枪镜头配置均可定位并回读。每代一组角色服装基础色与法线 TEX 已转 DDS，复核尺寸、格式和各 mip 的数据长度。RE9 的两个 TEX 在 PAK 中保留了容器内部压缩的字节，审计同时记录提取长度和解码后的逻辑长度。
- 16 条动作轨道文件或记录通过时基、键值、四元数和骨架层级检查。RE4 新解码 810 和 811，各有 59 条轨道。160 和 500 仍有骨哈希 2749258283 待映射，141 和 159 各有 2540998253、1595776407 待映射。RE4 灰模引用已有 FBX 回读记录，对照了本轮提取的源文件哈希。
- Chromium 对 RE9 的六条主轨和一条配套增量轨各采样五次。6 分件灰模共 72,346 顶点，主轨与模型同名关节误差最大约 4.55e-7。2100/1200 回读覆盖骨架显示。采样时间与结果保存在 `runtime/web-3c-m1.tmp/re9-browser.json` 的 `clips`，按 `bank` 和 `id` 查找。
- RE4 `wp4000` 和 RE9 `wp0111` 网格分别解析出 16 和 22 个骨骼。两代角色均有 `R_Wep`、`L_Wep`，RE9 武器另有 `C_Attach_Hand_A`。这些名称用于定位后续需要验证的挂点。
- M2 可先取 RE9 的 `character-rig`（`docs/player/model.js`）和 `docs/player/motions.json` 中 100/160、100/140、100/1200。RE4 对照取同用途的 FBX 和 160、140、810 原始轨道。添加的共享接口仅为 M1 的 `asset-audit.json` 第 1 版，由 M2 消费。M0 的 `ClipManifest` 签名无需调整。
- M2 待补原创或授权的 GLB、游戏参考动作的层基准和遮罩、武器挂点映射与局部变换，以及标准 GLB 的站姿、尺度、前向、射击峰值和换弹接触帧回读。RE9 `wp0111` 用作实测网格候选，仍需证实它与当前 Handgun00H 角色动作的装备绑定关系。M7 待补同输入顺序的两代实机录像和同步事件记录。

新增的轨道、DDS、武器解析结果与浏览器采样留在本机 `runtime/web-3c-m1.tmp/`。审计记录保留相对路径和片段选择器。

## 复现

在仓库根目录运行。PowerShell 中的 Playwright 与 Chromium 路径按本机安装填写；常规 Playwright 安装可使用默认解析。构建依赖本机 .NET 8、既有 CameraAudit 的 REE-Lib DLL 和仓库工具目录中的 Zstd DLL。武器和纹理解码使用现有 RE Mesh Editor，异机可通过 `RE_MESH_EDITOR`、`RE_MESH_PYTHON` 和 `STEAMAPPS` 指定路径。

```powershell
$env:DOTNET_CLI_HOME = (Resolve-Path tools/dotnet-home).Path
& tools/dotnet/dotnet.exe build scripts/ue5/DecodeRe4Motions -c Release -p:UseAppHost=false
& tools/dotnet/dotnet.exe scripts/ue5/DecodeRe4Motions/bin/Release/net8.0/DecodeRe4Motions.dll (Get-Location).Path --reload-audit

$env:PLAYWRIGHT_MODULE = 'C:/Users/archili/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core'
$env:CHROMIUM_EXECUTABLE = 'C:/Users/archili/AppData/Local/ms-playwright/chromium-1217/chrome-win64/chrome.exe'
node scripts/web-3c/check_m1_player.cjs
node player/verify.cjs
python scripts/web-3c/build_asset_audit.py
```
