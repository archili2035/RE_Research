# 研究网页目录

入口：[index.html](index.html)。可直接用浏览器打开。

| 主题 | HTML 入口 | 依赖 |
|---|---|---|
| 双层 PVE 地图与固定门模块 | re_pve_map_generator.html | 单文件，脚本与样式内嵌 |
| 完整通道设计与决策 | map_corridor_design.html | 单文件；对应 map_corridor_design.md |
| 固定模块与门规范 | map_module_catalog.html | 单文件；对应 map_module_catalog.md |
| 里昂手枪动作 | player_index.html | player/ 与 assets/theme/ |
| 3C 操作链 | player/3c.html | player/ 内脚本、样式与数据 |
| RE9 关卡资产报告 | re9_level_asset_research.html | 单文件 |
| RE9 怪物图鉴 | re9_monster_atlas.html | 单文件，纹理图像内嵌 |

`re_pve_map_generator.html` 可以单独复制并运行全部生成、探索与导出功能；“研究首页”和“规范”导航在相邻文件存在时可用。其余主题若需完整导航，请复制整个 docs 目录。

在仓库根运行 `node scripts/build_research_docs.cjs` 可重新生成首页、单文件地图、规范与报告。源文件分别在 map-demo/dist、map-demo/ASSET_CATALOG.md 和 reports 下。构建时使用本机 bundled marked；浏览器运行不需要构建工具或联网。

门户 entry 和本机服务器根路径均指向 index.html；旧 player_index.html 地址保留。
