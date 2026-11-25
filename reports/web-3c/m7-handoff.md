# M7 实机录像、回放与调参

网页侧已接入 M0 的固定步循环、预览阶段和 Rapier 查询。占位关卡为 `m7-preview-route` v1，同一输入在模拟的 60 Hz、120 Hz 渲染节奏下均完成 300 步（5 s），逐步角色、动作、镜头状态完全相同，16 条事件与基线一致。最终角色位置约为 (3.389, 0.025, -5.867) m，弹匣 8 发、备用 15 发。

## 交付文件

| 路径 | 内容 |
| --- | --- |
| `reports/web-3c/reference-timings.csv` | T01–T10 为实机待采集项。P01–P09 是网页占位路线检查点，证据标为 `tuned`。 |
| `web-3c/fixtures/route.replay.json` | `ReplayTrace` v1，含 300 步输入快照、16 条基线事件、关卡版本和手感参数版本。 |
| `web-3c/src/feel.json` | `FeelConfig` v1，按运动、镜头、动作组织 12 项参数，每项记录来源、证据等级和条件。 |
| `web-3c/m7.html`、`web-3c/src/m7-panel.ts`、`web-3c/src/m7.css` | 播放、暂停、单步、重置，显示输入、角色轨迹、相机和事件。应用参数时创建本次会话的新版本并从起点重放，可导出当前轨迹和参数 JSON。 |
| `web-3c/src/m7-replay.ts`、`web-3c/tests/m7.test.ts` | 固定步回放适配、事件比较，以及节奏一致性、调参、版本和输入连续性测试。 |
| `web-3c/src/preview-stages.ts`、`web-3c/src/preview-scene.ts` | M0 预览阶段增加参数化工厂，原有默认值和导出名称保留。预览场景导出同一组灰盒方块供回放俯视图绘制。 |
| `web-3c/index.html`、`web-3c/src/style.css`、`web-3c/vite.config.ts` | M0 灰盒页增加回放入口，生产构建同时输出两个页面。 |

`contracts.ts`、`ReplayTrace` 和 `FeelConfig` 的结构与版本号沿用 M0。M0 主循环仍使用默认阶段导出。M8 可直接读取三个 M7 交付文件，并在接入正式关卡及阶段后重新录制该版本的基线。

## 复现与片段

在仓库根目录运行以下命令。开发环境已安装依赖时可从测试命令开始。

```powershell
Set-Location web-3c
npm.cmd ci
npm.cmd test
npm.cmd run build
npm.cmd run preview -- --host 127.0.0.1
```

打开 `http://127.0.0.1:4173/m7.html`。播放两次都应显示「完成 · 事件与基线一致」。将初始备用弹改为 0、应用参数并重播，应显示参数 v2，换弹步没有补弹提交，最终弹匣 7 发、备用 0 发。导出时将该次的参数 JSON 与轨迹 JSON 一同保留。

CSV 核验通过，10 项实机用例留空待采集，9 个网页检查点的路径、步号和时基均与基线一致。自动测试 7 项通过。生产构建通过，Vite 报告共享包超过 500 kB 的大小警告。Edge Chromium 无头验收覆盖单步、播放、暂停、重置、基线完成、应用参数及两类导出 JSON 的内容。60 Hz / 120 Hz 指自动测试注入的渲染节奏，性能测量留待 M8。

| `route.replay.json` 输入步号 | 可复查的片段 |
| --- | --- |
| 1–137 | 穿过第一段走廊并急停。第 137 步验证水平速度小于 0.002 m/s。 |
| 153–197 | L 形转向和镜头遮挡变化。第 159 步开始收近，第 197 步解除遮挡。 |
| 198–249 | 移动举枪、单发、停步换弹、收枪。第 207 步顺序 2 开火、顺序 3 扣弹。第 235 步顺序 2 补弹。 |
| 255–300 | 继续前行。第 278 步顺序 0 记录交互请求，门状态和靶反馈待 M6。 |

## 时基与待补项

- `reports/3c/runtime_test_plan.csv` 的十项本轮仍待采集。仓库和已核查的游戏安装目录缺少可对应的录像和输入日志。RE9 安装目录有 REFramework 文件，未找到采集 JSON，也未运行采集器。
- 实机样本交接需提供录像文件路径、对应片段起止、帧率和时间戳来源，以及独立的同步输入日志与两者的对齐锚点。视频帧号或 PTS 填入视频列，输入时间填入输入列，网页条目按 `web_tick`、`web_order` 和 `web_time_s = tick × STEP_S` 记录。画面可见变化标为 `observed`，经同步输入与已验证采集字段确认的时间标为 `measured`。未获得的数据留空。
- 网页联调待接 M3 的 `input.ts`、`movement.ts`，M4 的 `camera.ts`，M5 的 `actions.ts`、`reports/web-3c/action-rules.md`，以及 M6 的 `levels/test-room.json` 和 `level.ts`。当前灰盒动作在同一步完成，镜头随扫掠结果即时调整。缓冲、取消、动作分层、阻尼恢复、靶反馈和开门行为须在正式产物到位后核验。接入时替换回放适配器中的场景查询和阶段实现，更新关卡及参数引用，并生成对应事件基线。
