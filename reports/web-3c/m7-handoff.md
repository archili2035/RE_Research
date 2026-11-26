# M7 实机录像、回放与调参

试玩与回放共用 `test-room@1`、`ClipManifest` v1 和 `FeelConfig` v3。两个页面都由 `createTestRoom` 装配移动与碰撞、越肩镜头、动作、门与靶事件。试玩从键鼠采样，回放从 fixture 读取已有固定步输入。版本化参数合并了试玩的镜头默认值，并包含本轮镜头调参。各项参数保留来源与条件，证据等级均为 `tuned`。数据契约仍为第 1 版。

回放为 616 步（固定 60 Hz，约 10.267 秒），发布 31 条有序事件，最终弹匣 8 发、备用 15 发。模拟 60 Hz 和 120 Hz 渲染节奏下，逐步角色、镜头、动作、碰撞接触、门状态、靶反馈与事件一致。使用同一个回放实例，在完整播放后重置两次，每次重放的状态、事件和最终弹量均与首次一致。重置关闭门并恢复碰撞，清除靶闪烁和移动诊断，以出生点重建镜头及动作状态，并清空回放时钟和事件。另从射击当步重置，验证镜头过渡、在途动作和靶反馈均回到初始状态。

## 交付文件

| 路径 | 内容 |
| --- | --- |
| `web-3c/src/level.ts`、`web-3c/src/feel.json` | 共享关卡运行时及重置入口，运动、镜头和动作共 23 项参数。 |
| `web-3c/src/main.ts`、`web-3c/src/clip-manifest.ts`、`web-3c/src/clip-assets.ts` | 两页读取同一份动作清单。试玩使用 GLB 绘制姿态，GLB 读取失败时用胶囊显示，仍可使用有效清单提供的时序。 |
| `web-3c/m7.html`、`web-3c/src/m7-panel.ts`、`web-3c/src/m7-replay.ts` | 显示试玩关卡的俯视图、门状态、镜头、轨迹和事件。支持单步、播放、暂停、重置、会话调参和 JSON 导出。 |
| `web-3c/fixtures/route.replay.json`、`web-3c/tests/record-m7-route.ts` | 从 Leon 回归使用的 `web-3c/tests/test-room-route.mjs` 生成新版 `ReplayTrace`。 |
| `web-3c/tests/m7.test.ts`、`web-3c/tests/leon-route.test.ts` | 核对版本、固定步与重置，比较试玩灰盒和 Leon 外观跑出的全部输入、事件和新版 fixture。 |
| `reports/web-3c/reference-timings.csv` | 15 个网页检查点，证据为 `tuned`。T01–T10 为实机待采集。 |

## 关键验收步

| 步号或事件顺序 | 结果 |
| --- | --- |
| 344.2、371.0–371.1 | 接受举枪，举枪恢复当步接受缓冲的开火请求。 |
| 375.0–375.2 | 开火、扣弹至 7/16、练习靶 `target-practice` 命中。 |
| 387.1、431.0、471.0 | 接受换弹、补弹至 8/15、换弹恢复。 |
| 532、533.2、544.0、564 | 关门时碰到 `door-exit-panel`，停在 C04 一侧。开门后通过门槛，门槛上的关门请求只记录输入，第 564 步进入 R14（z 约 −0.840 m）。 |
| 565.2、590、591.2、616 | 关门，在 R14 一侧返回时受阻。再次开门后回到 C04（z 约 0.627 m），弹量 8/15。 |

## 复现

在仓库根目录执行。已安装依赖时可跳过第一条。

```powershell
npm.cmd --prefix web-3c ci
node web-3c/tests/record-m7-route.ts
npm.cmd --prefix web-3c test
npm.cmd --prefix web-3c run build
npm.cmd --prefix web-3c run preview -- --host 127.0.0.1
```

打开 [回放页](http://127.0.0.1:4173/m7.html)。连续两轮执行「重置 → 单步 → 播放」，每轮都应显示「完成 · 事件与基线一致」和弹量 8/15。把「初始备用弹」改为 0 并应用，参数升为本次会话的 v4，重播后弹量为 7/0，事件中只有扣弹提交。分享调参结果时一起保留导出的参数和轨迹 JSON。

全量自动测试 23/23 通过。Chromium 147.0.7727.15 的生产预览通过单步、暂停、两轮重置播放、基线轨迹导出、调参和两类 JSON 导出检查。两轮导出的 616 步输入和 31 条事件均逐项等于 fixture。TypeScript 和 Vite 构建通过，Vite 提示共享包超过 500 kB。

## 时基与待补项

- T01–T10 未找到可对应的游戏录像和同步输入，状态保持 `pending`，证据和实机时间列留空。用例与 [实机采样计划](../3c/runtime_test_plan.csv) 对应。
- 获得实机样本后，记录录像路径、片段起止、帧率和视频时钟，并附独立的输入日志、输入时钟和同步锚点。可从画面确认的变化标为 `observed`，同步输入与已验证采集字段共同确认的用时标为 `measured`。
- 网页使用独立的 `web_sim_60hz` 时基，按 `web_time_s = web_tick × STEP_S` 填写，事件另外填写从零起算的 `web_order`。模拟 60 Hz、120 Hz 渲染节奏用于验证确定性。
