# M4 越肩镜头与准星

主入口和 `?level=m3` 共用 M4 镜头，按固定 60 Hz 读取输入、角色脚底位置和当前已提交的 `ActionState.aiming`。移动与瞄准各有肩偏移、距离、高度和垂直 FOV，切换用指数阻尼。镜头沿角色锚点到目标机位做半径 0.16 m 的球扫，碰撞时沿镜头臂保留 0.05 m 余量。急剧收近时优先限速，对过渡机位重扫，净空不足时立即收近。空间打开后用 0.16 s 时间常数逐步外移。`CameraPose.obstructed` 表示当前球扫受限，可以在镜头仍在恢复时变为 `false`。

| 变更路径 | 交付 |
| --- | --- |
| [camera.ts](../../web-3c/src/camera.ts)、[feel.json 的镜头参数](../../web-3c/src/feel.json) | 镜头阶段、碰撞收近与恢复、准星中心射线及默认参数的来源与证据等级。移动和瞄准垂直 FOV 分别为 58°、45°。 |
| [level.ts](../../web-3c/src/level.ts)、[main.ts](../../web-3c/src/main.ts) | 接入 M3 角色位姿、M5 瞄准状态和 M6 场景查询。M6 用镜头射线处理已确认的开火。视图使用同一固定步位姿，保留角色插值，镜头靠得过近时淡出角色以保持准星可见。 |
| [m4.test.ts](../../web-3c/tests/m4.test.ts)、[m4-camera-trace.csv](m4-camera-trace.csv)、[入口说明](../../web-3c/README.md) | 三段验收、逐步轨道及浏览器复现。 |

## 验收

| 场景 | 结果与轨道片段 |
| --- | --- |
| 靠墙举枪 | `wall-aim` 第 2–45 步，距西墙约 0.35 m 处举枪，镜头臂约 0.148 m，FOV 平滑趋近 45°。`wall-depart` 和 `wall-recovered` 第 46–225 步离墙，镜头臂恢复到 2.414 m。 |
| L 形拐角 | `corner-turn` 第 278–307 步转 90°，镜头臂从转前的 3.546 m 缩至 0.733 m，镜头位置单步最大位移 0.180 m。整段轨道在 60/120 Hz 渲染时的固定步结果一致。第 372 步准星射线命中靶面，命中点投影在屏幕中心。 |
| 开门与出门 | `door-closed` 第 45 步镜头臂 0.366 m，门扇为球扫命中物。第 46 步开门后先恢复到 0.569 m，第 47–100 步过门槛，第 190 步恢复到 2.414 m。 |

轨道的 `clearance_m` 为镜头中心到最近启用碰撞体的距离，三段各步均达到球扫半径。无头 Chromium 147.0.7727.15 生产预览通过鼠标锁定、58°/45° 切换、转角准星可见、单发命中及开门穿越。浏览器记录和截图保存在本地 [smoke.json](evidence/web-3c-m4/smoke.json)、贴墙 45 步（本机 `runtime/web-3c-m4.tmp/wall-aim.png`，20 KB，未入库）、转角 403 步（本机 `runtime/web-3c-m4.tmp/l-corner.png`，10 KB，未入库）、命中 499 步（本机 `runtime/web-3c-m4.tmp/target-hit.png`，11 KB，未入库）、出门 653 步（本机 `runtime/web-3c-m4.tmp/door-exit.png`，11 KB，未入库）。页面错误为 0。全量 18 项测试通过，生产构建通过，Vite 报告大于 500 KB 的代码块。

在仓库根目录运行以下命令。浏览器打开 `http://127.0.0.1:4173/` 后锁定鼠标，在出生点按右键验证 FOV 与遮挡，沿走廊左转、瞄准右墙练习靶并单发，最后按 E 开门穿过门槛。

```powershell
cd web-3c
$env:M4_TRACE = '../reports/web-3c/m4-camera-trace.csv'
node --test tests/m4.test.ts
Remove-Item Env:M4_TRACE
npm test
npm run build
npm run preview -- --host 127.0.0.1 --port 4173
```

## 共享接口与待补项

- M0/M3/M5/M6 继续使用第 1 版共享类型和原有阶段顺序。M4 在 M6 的命中阶段集中提供 `castCrosshair`，在主入口使用相同镜头位姿渲染。M5 的举枪、单发和换弹阶段已接入，通过全量回归。
- M7 的 `m7-preview-route@1` 仍使用自己的预览场景与 `feel.json` 基线。后续接入 `test-room@1` 时，把 M4 参数纳入对应版本的 `FeelConfig.camera`，并生成包含门与靶事件的回放。
- RE9 参考提供 Normal/Hold 的静态偏移、注视距离和 FOV 模板。M4 用其中的高度作为调参起点，参数证据均标为 `tuned`。仍需 M7 的 T01、T09、T10 实机短片和同步输入，用于校准举枪时序、碰撞收缩及最终 FOV 和位姿曲线。 [镜头研究 §5](../3c/leon_tps_handgun_3c_zh.md#5-camera已连接到里昂状态表的基础镜头参数) · [参数原值](../3c/parameters.csv) · [采样计划](reference-timings.csv)
