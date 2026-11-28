# 越肩镜头改前改后

同一段 665 步输入在 Chromium 147.0.7727.15 的改前、改后生产构建上各录一次。两段均为 768×432、60 fps、约 11.08 秒。固定步角色落点逐步相同，浏览器事件序列相同。录像左上角标有场景、步号、FOV 和遮挡状态。 改前录像（本机 `runtime/web-3c-camera-tune.tmp/before.webm`，807 KB，未入库） · 改后录像（本机 `runtime/web-3c-camera-tune.tmp/after.webm`，833 KB，未入库） · [共用输入](../../web-3c/tests/camera-tune-route.mjs)

| 片段 | 改前 → 改后 |
| --- | --- |
| 0:00–0:01.50，靠墙举枪与松开 | 移动 FOV 保持 58°，瞄准由 45° 改为 46°。移动镜头臂由 3.65 改为 3.30 m，瞄准由 2.35 改为 2.10 m。瞄准肩偏移从 0.55 增至 0.60 m，锚点从 1.50 抬至 1.53 m。在墙边举枪时，机位保持在球扫允许范围内。 |
| 0:03.92–0:04.42，直走急停 | 水平跟随时间常数 0.09 s，高度 0.16 s。停步首帧镜头速度改前由 2.59 降至 0.04 m/s，改后由 2.49 降至 2.12 m/s，再于 0.5 s 内降至 0.01 m/s。单独给角色脚底 4 cm 的高度变化，改后镜头首步上移约 4 mm。 |
| 0:06.62–0:08.93，擦墙转 L 角并离开 | 转角最大单步机位位移由 0.180 降至 0.140 m。擦墙时用 0.018 m 余量抑制小幅回弹，离墙后用 0.22 s 时间常数恢复。改后整段路线镜头中心距最近碰撞体至少 0.179 m，球扫半径为 0.160 m。 |
| 0:08.93–0:11.08，开门、穿门后回身瞄靶 | 第 537 步开门，第 565 步走到门内约 0.75 m。第 645 步输入鼠标 `(+1, −1)` 像素，同时发布开火、扣弹和命中。改后实际碰撞点为 `(9.790, 1.478, 1.481) m`，投影至屏幕中心的归一化误差小于 `10⁻⁶`。浏览器同一帧的中心像素也从橙色靶面变为绿色命中闪光。 改前开火帧（本机 `runtime/web-3c-camera-tune.tmp/before-fire.jpg`，17 KB，未入库） · 改后开火帧（本机 `runtime/web-3c-camera-tune.tmp/after-fire.jpg`，17 KB，未入库） |

水平位置、高度、构图切换和离墙恢复分别使用各自的时间常数。偏航和俯仰在收到鼠标输入的固定步提交。球扫仍从角色实时锚点出发，视图与准星仍共用最新提交的镜头位姿。M7 参数升为 v3，正式回放仍为 616 步、31 条事件。全量 23 项测试和生产构建通过。Vite 仍报告大于 500 KB 的代码块。 [镜头实现](../../web-3c/src/camera.ts) · [参数](../../web-3c/src/feel.json)

逐步数据包含机位、角色脚底、净空和命中坐标。浏览器逐帧记录包含中心像素、画面快照和同一步事件。 改前轨道（本机 `runtime/web-3c-camera-tune.tmp/before-track.json`，339 KB，未入库） · 改后轨道（本机 `runtime/web-3c-camera-tune.tmp/after-track.json`，339 KB，未入库） · [改前浏览器记录](evidence/web-3c-camera-tune/before-browser.json) · [改后浏览器记录](evidence/web-3c-camera-tune/after-browser.json)

## 复现

在仓库根目录执行。改前构建已保存在 `runtime/web-3c-camera-tune.tmp/before-dist/`。录制器使用 Playwright 和支持 MJPEG 解码、VP8 编码的 ffmpeg。

```powershell
cd web-3c
$env:CAMERA_TUNE_TRACE = '../runtime/web-3c-camera-tune.tmp/after-track.json'
node --test tests/camera-tune.test.ts tests/m4.test.ts tests/m7.test.ts
npm run build -- --outDir ../runtime/web-3c-camera-tune.tmp/after-dist
$env:PLAYWRIGHT_MODULE = "$env:LOCALAPPDATA/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core"
$env:CHROMIUM_EXECUTABLE = "$env:LOCALAPPDATA/ms-playwright/chromium-1217/chrome-win64/chrome.exe"
$env:CAMERA_FFMPEG = "$env:LOCALAPPDATA/ms-playwright/ffmpeg-1011/ffmpeg-win64.exe"
node tests/record-camera-tune.mjs before
node tests/record-camera-tune.mjs after
```
