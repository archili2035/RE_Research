# 3C 灰盒

当前实现、数据流和模块验收入口见 [Web 3C 技术文档](TECHNICAL.md)。

使用 Node.js 22.18 或更新版本。在仓库根目录运行：

```powershell
cd web-3c
npm ci
npm test
npm run build
npm run preview -- --host 127.0.0.1 --port 4173
```

用桌面 Chromium 打开 `http://127.0.0.1:4173/`，点击「进入测试场」。开发时可运行 `npm run dev`。灰盒使用原创几何、M3 输入与移动、M4 越肩镜头和 M5 动作阶段，角色使用 M2 的原创占位轨道。

- 从储藏室直走进入 L 形走廊，到拐角左转。走到右墙的橙色练习靶前，按住右键，把准星移到靶面后按左键。靶面闪亮，HUD 显示命中，弹量从 8/16 降为 7/16。按 R 换弹后变为 8/15。
- 走到尽头按 E 开门，穿过门槛后可按 E 关门。按住移动键时释放鼠标锁定，下一步的移动轴应归零。切换窗口也会清除输入。
- 点击「碰撞测试场」检查急停、贴墙、门框和台阶。逐步位移、接触法线和复现命令见 [M3 交接](../reports/web-3c/m3-handoff.md)。
- 靠墙按住右键，观察「当前固定步」中的镜头位置、垂直 FOV 和遮挡。沿走廊转过 L 角并开门，观察镜头收近和恢复。构图截图、参数和回归轨道见 [M4 视频校准](../reports/web-3c/m4-video-calibration.md)。
- `npm test` 覆盖固定步、Rapier 查询、移动、镜头、动作分层与事件顺序、M6 路线和 M7 回放。M5 时序与当前主测试场的验证见 [M5 动作规则](../reports/web-3c/action-rules.md)。

生产预览已通过 Chromium 147.0.7727.15 的操作和路线验收。构建体积、Vite 大包提示以及可见窗口帧时间见 [M8 集成与性能验收](../reports/web-3c/integration-check.md)。

## 核对本地与发布版本

在仓库根目录执行 `npm.cmd --prefix web-3c run build:portal` 生成本地预览并同步 `docs/web-3c/`。研究首页的试玩链接读取这份静态产物。双击 `start-web-3c.cmd` 后，可对照本地预览和个人站页头的「版本」编号，或打开页面同目录的 `build-info.json` 比较完整的 `sha256`。发布后若页头仍显示旧编号，先强制刷新再核对。

编号由生产构建的 HTML、脚本、样式和随包素材生成。相同产物重复构建时编号相同。通过 `npm run dev` 打开的页面显示「开发预览」。独立提供的 `docs/player/` 参考资源有自己的发布路径，需另行核对。

## M9 研究 JSON 浏览器

启动 3C 灰盒后，在首页页头点击「研究 JSON 浏览器」。开发时运行 `npm run dev` 并打开 `http://localhost:5173/`，生产预览见上方启动命令。在「站内样本」下拉框中选择下表任意文件，即可直接加载。四份样本随网站构建，在选中时读取。自己的 JSON 也可以通过选择文件、拖入或粘贴来导入，文件内容在浏览器中解析。

| 样本 | 默认视图 |
| --- | --- |
| `web-3c/src/feel.json` | 手感参数表按运动、镜头和动作分组，显示值、来源、证据等级和条件。 |
| `reports/web-3c/asset-audit.json` | 资源审计表按游戏、资源用途和验证状态筛选。展开样本可查看来源文件及提取、解码、绑定和回读证据。 |
| `web-3c/fixtures/route.replay.json` 和 `docs/player/motions.json` | JSON 树。对象和数组可以折叠，数组展开后每页显示至多 50 项。 |

工具按内容字段识别视图。任何文档都能切换到 JSON 树，并按字段名、值或两者搜索。点击搜索结果会展开对应分支并跳到匹配节点。选中节点后可以复制字段路径或源文本中的原始 JSON 值。表格将缺失字段标为「未记录」，保留显式的 `null`。

## 试玩画面与里昂灰模

测试场按 16:9 显示，最宽时渲染 1280 × 720 像素，窄窗等比缩小。准星和弹量以测试场为边界定位。

测试场上方的「角色外观」可在灰盒和里昂灰模之间切换。试玩角色用模拟脚底位置和朝向，随 M5 姿态举枪、单发、换弹。需要操作下拉框时先按 Esc 释放鼠标。里昂外观随本机参考资产可用。[试玩外观与复现](../reports/web-3c/leon-playfield.md)

Vite 本机预览及同源门户直接读取现有 `docs/player` 灰模资源，独立静态包可运行灰盒占位角色。源动作逐帧查看可打开[独立动画播放器](../docs/player_index.html)。生产预览的画幅、准星和灰模加载可用 [Chromium 验收脚本](tests/check-playfield-layout.mjs) 检查。

## 共享接口

`src/contracts.ts` 定义第 1 版接口。右手坐标使用米，+Y 向上，偏航零点为 −Z，正偏航向左，正俯仰向上。角色位置指脚底，移动轴为 −1 至 +1，视角增量保留原始鼠标像素。状态初值步号为 0，首份输入为第 1 步。每步消费一份快照，持续状态保留，鼠标增量和按下边沿消费一次。同一按钮在一步内多次按下会合并为一个边沿。

`src/main.ts` 将浏览器帧接入 `src/simulation.ts`。每步依次采样输入、移动、判定动作与门交互、更新镜头、判定靶命中、发布状态与事件。移动读取上一步提交的瞄准状态及镜头偏航。事件使用同一步号、从零起算的步内顺序、步末时间 `tick * STEP_S`，以及状态或场景对象 ID。渲染插值角色位置与朝向，视图和准星射线共用最新提交的镜头位姿。单帧最多追赶 250 ms，页面可见性变化时重置帧时钟。

| 模块 | 接入点与待补产物 |
| --- | --- |
| M1–M2 | M1 的 `asset-audit.json` 为 M2 提供样本定位。M2 按 `ClipManifest` 提供 `public/assets/clips.json`、GLB 和姿态检查。 |
| M3 | 主入口使用 `src/input.ts` 与 `src/movement.ts`，继续生成 `InputSnapshot` 并通过 `SceneQueries.moveCapsule` 得到 `CharacterState`。 |
| M4 | `src/level.ts` 已接入 `src/camera.ts`。镜头默认值见 `src/feel.json` 的 `camera` 组，沿用 `CameraPose`、球扫和射线查询。 |
| M5 | 主测试场使用 `src/actions.ts` 的举枪、单发及换弹时序，`src/action-view.ts` 读取 M2 轨道。规则、证据与复现见 [M5 动作规则](../reports/web-3c/action-rules.md)。 |
| M6 | 主入口加载 `src/levels/test-room.json`。`src/level.ts` 发布门和靶事件，`src/hud.ts` 消费状态与事件。 |
| M7 | 通过输入采样和发布入口接入 `ReplayTrace` 和版本化 `FeelConfig`。试玩与回放共用 `test-room@1`、动作清单和 `FeelConfig` v3。回放基线为 616 步、31 条事件。实机对照待采集。 |
| M8 | 生产构建输出为本地 `dist/`。在 M2–M7 汇合后验收路线、性能并接研究站导航。 |

这些类型是新接口。接入时在主入口替换预览实现即可，现有研究站、播放器和地图工程无需迁移。
