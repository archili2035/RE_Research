# M4 越肩镜头第一轮视频校准

参考原片为 `E:/WorkBuddyRepo/RE_Research/downloads/生化危机9安魂曲_第二集_720P.mp4`。原尺寸解码确认瞄准帧 PTS 为 820.500 s，移动帧为 785.100 s，两帧均为 1280×720。网页用现有单栏试玩、里昂灰模和本机 `wp0100`，画布及缓冲均为 1280×720。固定步输入为 W 175 步、松 W 按住右键 90 步、松右键 24 步。第 175 步为平地前行（约 2.55 m/s），第 265 步为站定瞄准。两版的移动状态、步态相位、站定姿态和取样位置相同。第 175–289 步逐步核对遮挡均为「否」。 [抽帧时间](evidence/web-3c-camera-calibration/reference.json) · [改前采样](evidence/web-3c-camera-calibration/before-capture.json) · [改后采样](evidence/web-3c-camera-calibration/after-capture.json)

## 构图

头部横向取可见头发外轮廓的左右中点，占画面宽度百分比。头顶取距画面上缘的高度百分比。肩部占幅取「头顶向下 1.25 倍可见头宽」所在行的可见上肩轮廓宽度，占画面宽度百分比，贴边截断按可见宽度计。原片手工估读，网页用灰模投影复核。原片服装、手臂姿态和明暗会影响肩部读数。

| 画面 | 头部横向 | 头顶距上缘 | 肩部占幅 | 截图 |
| --- | ---: | ---: | ---: | --- |
| 原片瞄准 13:40.50 | 约 20.9% W | 约 20.3% H | 约 39.5% W | 参考（本机 `runtime/web-3c-camera-calibration.tmp/reference-aim.png`，837 KB，未入库） |
| 网页瞄准改前 | 34.7% W | 38.0% H | 14.7% W | 第 265 步（本机 `runtime/web-3c-camera-calibration.tmp/before-aim.png`，93 KB，未入库） |
| 网页瞄准改后 | 21.7% W | 20.2% H | 36.6% W | 第 265 步（本机 `runtime/web-3c-camera-calibration.tmp/after-aim.png`，147 KB，未入库） |
| 原片移动 13:05.10 | 约 33.5% W | 约 29.9% H | 约 22% W | 参考（本机 `runtime/web-3c-camera-calibration.tmp/reference-move.png`，575 KB，未入库） |
| 网页移动改前 | 41.0% W | 42.9% H | 6.8% W | 第 175 步（本机 `runtime/web-3c-camera-calibration.tmp/before-move.png`，45 KB，未入库） |
| 网页移动改后 | 33.5% W | 30.1% H | 21.0% W | 第 175 步（本机 `runtime/web-3c-camera-calibration.tmp/after-move.png`，114 KB，未入库） |

原片瞄准时，枪管前端在中心准星左约 9–10% W、下约 4–5% H。网页以 `vfx_muzzle1` 投影，改前枪口在准星左 10.5% W、上 4.2% H，改后在左 17.0% W、上 2.0% H。改后枪口纵向更接近画面中心，横向仍比原片偏左。移动参考帧的持枪手腕也比当前网页前进样本更直立。这两处差异留待实机姿态与枪口读数确认。 [武器挂点](weapon-attachment.md) · 瞄准原片（本机 `runtime/web-3c-camera-calibration.tmp/reference-aim.png`，837 KB，未入库） · 瞄准改后（本机 `runtime/web-3c-camera-calibration.tmp/after-aim.png`，147 KB，未入库）

## 参数

Normal 的 `_Offset=(0.5, 1.47, 0)`、Hold 的 `_Offset=(0.4, 1.50, 0.1)` 提供侧向和高度候选。两者 `_GazeDistance` 存值为 1.7／1.1，FOV 模板类型为 0／1，覆盖存值均为 63。网页结合距离和垂直 FOV 拟合实际头肩占幅，参数在 `FeelConfig v4` 标为 `tuned`、条件注明「视频视觉拟合」。 [静态配置](../3c/leon_tps_handgun_3c_zh.md) · [运行参数](../../web-3c/src/feel.json)

| 网页参数 | 普通移动 v3 → v4 | 举枪瞄准 v3 → v4 |
| --- | ---: | ---: |
| 沿视线反向的取景距离 | 3.30 → 1.95 m | 2.10 → 1.60 m |
| 右肩侧移 | 0.72 → 0.46 m | 0.60 → 0.44 m |
| 脚底到锚点高度 | 1.470 → 1.470 m | 1.530 → 1.538 m |
| 垂直 FOV | 58° → 32° | 46° → 23° |
| 共用初始俯仰 | −0.16 → −0.06 rad | −0.16 → −0.06 rad |
| 过渡到该模式的时间常数 | 0.15 → 0.13 s | 0.11 → 0.11 s |

## 退出瞄准与回归

原片 13:41.20–13:41.60 用于对照人物占幅随镜头拉开的过程。该段同时有收枪、起步和取景转向，实际松键时刻待输入记录确认。网页在无遮挡时让机位与 FOV 走同一条过渡曲线，墙体压缩单独以 0.22 s 恢复。松右键后 0.133／0.250／0.400 s，改后垂直 FOV 为 28.8°／30.7°／31.6°。至 0.400 s，沿视线后移 0.334 m，约完成稳定距离变化的 95%，改前约 66%。 原片窗口首帧（本机 `runtime/web-3c-camera-calibration.tmp/reference-release-00.png`，654 KB，未入库） · 原片窗口末帧（本机 `runtime/web-3c-camera-calibration.tmp/reference-release-24.png`，728 KB，未入库） · 改前末帧（本机 `runtime/web-3c-camera-calibration.tmp/before-release-24.png`，66 KB，未入库） · 改后末帧（本机 `runtime/web-3c-camera-calibration.tmp/after-release-24.png`，151 KB，未入库）

- M4 靠墙举枪、L 角与穿门的轨道中，最小机位净空为 0.171 m，球扫半径为 0.160 m，L 角最大单步位移为 0.140 m。角色停步后的跟随以世界机位连续性检查。 [碰撞轨道](evidence/web-3c-camera-calibration/after-collision.csv)
- 独立穿门路线在第 645 步带鼠标微调开火，实际命中点 `(9.790, 1.721, 1.467) m` 投影到准星中心，归一化误差小于 `10⁻⁶`。渲染与射线继续读取同一固定步镜头位姿。 开火轨道（本机 `runtime/web-3c-camera-calibration.tmp/after-shot-route.json`，339 KB，未入库）
- M6／M7 共用固定路线的靶前瞄准输入按新镜头标定。M7 回放 v4 为 616 步、31 条事件，第 375 步顺序保持开火、扣弹、命中，60／120 Hz 固定步结果一致。 [固定输入](../../web-3c/tests/test-room-route.mjs) · [回放](../../web-3c/fixtures/route.replay.json)
- M4、命中路线与 M7 定向回归 11 项通过。Web 3C 全量 26 项通过，默认跳过的本地枪模用例指定 GLB 后单独通过。生产构建和 Chromium 单栏布局检查通过。Vite 保留大代码块警告。

待实机验证的数值包括普通与瞄准的实际机位、有效垂直 FOV、肩偏移和锚点、俯仰以及枪口与目标射线的相对位置。还需要同步输入与相机读数验证收枪的触发帧、拉开曲线、碰撞压缩和恢复时间。

在仓库根目录运行下列命令。浏览器采样脚本使用 Playwright 及本机 Chromium，改前构建保存在 `runtime/web-3c-camera-calibration.tmp/before-dist`，改后采样读取该目录下的 `after-dist`。

```powershell
cd web-3c
node --test tests/m4.test.ts tests/camera-tune.test.ts tests/m6.test.ts tests/m7.test.ts
npm test
$env:LEON_WEAPON_GLB = (Resolve-Path '../runtime/web-3c-weapon.tmp/wp0100.glb').Path
node --test --test-name-pattern 'local wp0100' tests/leon-route.test.ts
npm run build
Copy-Item -Path 'dist/*' -Destination '../runtime/web-3c-camera-calibration.tmp/after-dist' -Recurse -Force
$env:PLAYWRIGHT_MODULE = "$env:LOCALAPPDATA/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core"
$env:CHROMIUM_EXECUTABLE = "$env:LOCALAPPDATA/ms-playwright/chromium-1217/chrome-win64/chrome.exe"
node tests/capture-camera-calibration.mjs before
node tests/capture-camera-calibration.mjs after
node tests/check-playfield-layout.mjs
```
