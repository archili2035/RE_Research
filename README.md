# RE_Research

RE Engine 动画资源研究、解析报告及里昂手枪动作骨架播放器。

## 网页播放器

直接打开 `player/dist/index.html`，无需安装依赖或联网。首页的“技术实现说明”链接通向 `player/dist/technical.html`。

也可以执行：

```powershell
node player/server.cjs
```

然后访问 `http://127.0.0.1:8765`。

播放器包含 14 条动作，支持播放、暂停、逐帧、时间轴、倍速、视角调整及骨骼范围着色。当前展示骨架轨道，尚未加载角色网格、贴图、武器及游戏运行时 IK 和动画混合。

## 目录

- `player/`：离线网页、动画数据、说明页与验证脚本。
- `scripts/`：C# / PowerShell 资源解析、审计及动画导出脚本。
- `reports/`：研究报告、资源索引、样本及解析结果。
- `references/`：资源列表及格式参考数据。
- `tools/`：研究使用的第三方工具源码快照及安装脚本。

## 工具来源与本地修改

`tools/ReExtractor` 和 `tools/REE.PAK.Tool` 按源码快照保存，不作为 Git 子模块。各工具的原始许可证保留在对应目录内；第三方代码遵循各自许可证。本仓库未为所有内容统一声明新的许可证。

上游地址与精确版本见 `tools/UPSTREAM.md`。ReExtractor 所含 RE-Engine-Lib 保留了当前工作区的本地兼容性修改；已有补丁另见 `reports/phase2/reelib_net8_compat.patch`。上游子模块声明文件未纳入快照，尚未在本机初始化的 GDeflateNet 依赖也不包含在快照中。

本地 .NET SDK、NuGet 缓存、构建产物及下载的运行工具已通过 `.gitignore` 排除。重新运行研究脚本需要 .NET 8 SDK 和相应依赖，部分脚本含本机绝对路径，迁移后需要调整。研究报告中的本机资源路径作为溯源信息保留。

## 验证

```powershell
node player/verify.cjs
```

浏览器检查脚本依赖本机 Playwright / Chromium 环境，详见 `player/README.md`。
