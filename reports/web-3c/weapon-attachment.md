# M2 里昂本机武器灰模静态挂接

## 装备核对

装备目录把 `arm0000` 指向同名 prefab。该 prefab 的实例 3 引用 `wp0100_00.mesh`，实例 13 引用 `wp0100.motbank` 和 `wp0100.jmap`。`wp0100.motlist` 同时有 `Handgun00H_1100_Shoot` 和 `Handgun00H_1200_Reload`。`arm0007` 的实例 3 和 13 则引用 `wp0111`，它的对应射击和换弹轨为 `Handgun40H`。两者的装备参数都引用通用父节点 `R_Wep`，因此仅靠挂点名无法区分版本。[本机 prefab 解码](../../runtime/web-3c-wp0111.tmp/parsed/arm0000.pfb.18.json) · [wp0100 动作列表](../../runtime/web-3c-wp0111.tmp/parsed/wp0100.motlist.1047.json) · [wp0111 动作列表](../../runtime/web-3c-wp0111.tmp/parsed/wp0111.motlist.1047.json)

本机试玩采用 `wp0100`，与当前里昂 `Handgun00H` 动作同组。`arm0000parameter` 实例 1 的装备位置与旋转为零偏移、单位四元数，比例为 1。武器源网格和配套 streaming 均从 `re_chunk_000.pak` 提取，原始路径及 SHA-256 保存在本地来源记录。[装备参数](../../runtime/web-3c-wp0111.tmp/parsed/arm0000parameter.user.3.json) · [提取记录](../../runtime/web-3c-wp0111.tmp/sources.json)

## 挂接与范围

[导出脚本](../../scripts/web-3c/export_m2_weapon.py) 从解包网格取第 4 级 LOD（索引 3）的静态枪身和一份弹匣外形，导出 3,860 顶点、3,032 个三角形。GLB 保留源挂点 `C_Attach_Hand_A` 与校验节点 `vfx_muzzle1`。原二进制、GLB 和元数据保留在本地运行目录，由 Vite 的本机资源入口读取。[本地 GLB](../../runtime/web-3c-weapon.tmp/wp0100.glb) · [网格与挂点数据](../../runtime/web-3c-weapon.tmp/wp0100.json)

角色 LOD2 蒙皮省略 `R_Wep` 辅助骨。[里昂姿态视图](../../web-3c/src/leon-view.ts) 先用同一份动作混合求 `R_Wep` 的源局部姿态，再乘当前 `R_Arm_Hand` 的矩阵。[武器视图](../../web-3c/src/leon-weapon.ts) 将武器根矩阵设为 `R_Wep × inverse(C_Attach_Hand_A)`。两者随角色根移动和转向。首轮范围为静态网格及右手挂接，原作的武器内部动作、左手 IK 和换弹时的弹匣交接待后续接入。

## 验收记录

生产构建通过。指定本地武器 GLB 后，Web 3C 全量测试 26/26 通过。

| 姿态 | 模拟步 | 挂点矩阵最大元素差 | 枪口方向与角色前向的点积 |
| --- | ---: | ---: | ---: |
| 站立 | 1 | 8.88e-16 | 0.2050 |
| 举枪中段 | 14 | 0 | 0.8159 |
| 瞄准侧移 | 57 | 0 | 0.99999 |
| 单发 | 71 | 0 | 0.9523 |
| 换弹 | 131 | 8.88e-16 | 0.5022 |

五个采样都读取了角色身上的握把世界矩阵，侧移时枪口保持朝前。[握姿逐帧数据](../../runtime/web-3c-weapon.tmp/grip-poses.json)

灰盒与持 `wp0100` 的里昂使用同一条 616 步路线，逐步角色、相机和碰撞数据及全部 31 个事件一致。第 375 步依次开火、扣弹至 7/16、命中练习靶，第 431 步补弹至 8/15。[完整路线数据](../../runtime/web-3c-weapon.tmp/fixed-route.json)

Chromium 147.0.7727.15 在生产预览中请求一次本地 GLB，确认武器网格在左侧试玩视口绘制，完成移动、瞄准、单发、换弹及外观切换。用 [M8 浏览器路线驱动](../../web-3c/tests/m8-browser-route.mjs) 在同一试玩页重放相同的 616 步，回读全部 31 个事件，无浏览器错误。[浏览器记录](../../runtime/web-3c-leon.tmp/browser-check.json) · [浏览器路线](../../runtime/web-3c-weapon.tmp/browser-route.json) · [举枪截图](../../runtime/web-3c-leon.tmp/leon-aim.png)

## 复现

在仓库根目录运行。导出需要本机 RE Mesh Editor 与带 NumPy 的 Python，默认输入为上述解包记录中的数据。浏览器脚本的 Playwright 和 Chromium 路径见 [参考视图检查](re9-reference-check.md#复现)。

```powershell
& 'G:/_RE9_research/tools/blender-5.0.1-windows-x64/5.0/python/bin/python.exe' scripts/web-3c/export_m2_weapon.py
$env:LEON_WEAPON_GLB = (Resolve-Path runtime/web-3c-weapon.tmp/wp0100.glb).Path
$env:LEON_WEAPON_EVIDENCE = Join-Path (Get-Location).Path 'runtime/web-3c-weapon.tmp/grip-poses.json'
$env:LEON_ROUTE_EVIDENCE = Join-Path (Get-Location).Path 'runtime/web-3c-weapon.tmp/fixed-route.json'
node --test --test-name-pattern 'local wp0100|full fixed route' web-3c/tests/leon-route.test.ts
npm --prefix web-3c run build
node web-3c/tests/check-leon-browser.mjs
```
