# M3 输入、运动与碰撞交接

主入口在 60 Hz 固定步接入 M3 输入和运动。默认加载 M6 的 `test-room` v1，`?level=m3` 同时提供可复现的碰撞测试场。M6 的房间路线验证关门阻挡和开门通行，碰撞测试场提供 1.20 m 门框、0.18 m 低台阶和 0.55 m 高挡坎。

## 变更与接口

| 路径 | 交付 |
| --- | --- |
| `web-3c/src/input.ts`、`web-3c/src/preview-input.ts` | 浏览器输入与可独立采样的缓冲。每步输出一份冻结的 `InputSnapshot`，消费鼠标增量和按下边沿，保留持续状态。失焦、页面可见性变化或指针锁定变化时清空缓冲。旧入口转接同一实现。 |
| `web-3c/src/movement.ts`、`web-3c/src/preview-stages.ts` | 用上一步提交的镜头偏航和瞄准状态生成相对镜头的移动，限制对角线速度。无移动输入时立即取消水平移动请求。输出脚底位置、偏航、实际位移除以步长所得的速度和着地状态。 |
| `web-3c/src/preview-scene.ts`、`web-3c/src/level.ts` | Rapier 移动查询启用滑动、自动上台阶和贴地。场景适配器提供上一次查询的请求位移、实际位移、着地及接触 ID、世界坐标和法线。 |
| `web-3c/src/main.ts`、`web-3c/index.html`、`web-3c/fixtures/m3-greybox.json` | 主入口可切换碰撞测试场，实时显示速度和碰撞修正。测试场使用 `LevelDefinition` v1 和原创方块。 |
| `web-3c/tests/m3.test.ts`、`reports/web-3c/m3-collision-trace.csv` | 自动验收与六段共 248 步的碰撞轨迹。各段步号从 1 开始，时间为 `tick / 60` 秒。 |

M0 的 `InputSnapshot`、`CharacterState` 和 `SceneQueries` 沿用 v1，本轮的诊断数据由场景适配器读取。M4、M5 可继续按固定步消费角色状态。M6 的 `createTestRoom()` 增加可选关卡参数并返回 `readMovementDebug()`。M7 v1 回放沿用原关卡和接地策略，自动测试验证 300 步和 16 条事件基线。

运动速度沿用 `feel.json` 的灰盒调参值。碰撞测试采用半径 0.32 m、高 1.65 m 的胶囊，碰撞间距 0.025 m、接地探测 0.01 m、自动上台阶上限 0.25 m、最小可用宽度 0.30 m 和贴地范围 0.25 m。这些数值用于原型验收。

## 验收与复现

从仓库根目录运行。

```powershell
Set-Location web-3c
npm.cmd ci
npm.cmd test
npm.cmd run build
$env:M3_TRACE = '../reports/web-3c/m3-collision-trace.csv'
node --test tests/m3.test.ts
Remove-Item Env:M3_TRACE
npm.cmd run preview -- --host 127.0.0.1 --port 4173
```

已安装依赖时可从 `npm.cmd test` 开始。打开 `http://127.0.0.1:4173/?level=m3` 并进入测试场。按 W 直穿门框并上下低台阶，松开 W 查看水平速度。穿门后右移到高挡坎前再向前走，观察阻挡和碰撞体 ID。

自动测试 10 项通过，包含 M6 固定路线和 M7 回放。生产构建通过，Vite 报告有包超过 500 kB。无头 Edge 128.0.2739.67 验证默认关卡加载、测试场链接、指针锁定、W 穿门和上下低台阶、松键急停、右键瞄准、解锁清空输入，浏览器无控制台错误。浏览器这次取样第 129 步接触 `low-step`，第 175 步水平速度回到显示精度内的零。

| `m3-collision-trace.csv` 的 `case` 与 `tick` | 结果 |
| --- | --- |
| `stop` 12–20 | 第 12 步速度约 4.30 m/s，第 13 步松键后小于 0.002 m/s。 |
| `slide` 8–20 | 第 8 步触碰 `west-wall`。第 10–19 步贴墙保持 `x ≈ −2.035 m`，切向速度超过 1.5 m/s。 |
| `doorway` 20–44、`jamb` 5–28 | 中线方案第 20 步穿过门平面，第 44 步至 `z = −1.021 m`。偏置冲刺第 5 步撞到 `door-jamb-right`，最终停在 `z = 0.505 m`。 |
| `low` 13–84、`high` 12–32 | 低台阶第 13 步接触，第 24 步脚底达到 `y = 0.207 m`，第 84 步回到 `y = 0.025 m`。高挡坎第 12 步接触后持续阻挡，最终脚底在 `y = 0.025 m`。 |

## 待补项

- 正式镜头 `web-3c/src/camera.ts` 与动作 `web-3c/src/actions.ts` 到位后，联调瞄准速度切换和输入时序。当前使用 M0 预览阶段提交视角与瞄准状态。
- M7 补充实机录像、对应片段和同步输入时钟后，再校准速度与急停手感，并录制 M3/M6 集成路线的新回放基线。
