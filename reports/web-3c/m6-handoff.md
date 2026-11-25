# M6 交接

主入口加载 `test-room@1`。固定路线从 R07 储藏室出发，穿过 C04 的 2 米宽转角廊，左转后可射击右墙的练习靶，再开门进入 R14 杂物间。灰盒按目录第 4 版的 2 米网格落位。目录平面坐标映射到世界 X/Z，R07 旋转 270° 后平移到格 (-2, 1)，C04 原位，R14 平移到格 (4, -2)。R07 D1 与 C04 P1 组成开放门框，C04 P2 与 R14 D1 组成可开关门。门扇和练习靶为本轮原创几何。来源见 [资产清单](../../map-demo/ASSET_CATALOG.md) 和 [目录数据](../../map-demo/dist/catalog.js)。

## 变更路径

| 路径 | 交付 |
| --- | --- |
| [web-3c/src/levels/test-room.json](../../web-3c/src/levels/test-room.json) | `LevelDefinition`、出生位姿、渲染和碰撞描述。门为 `door-exit`，碰撞体为 `door-exit-panel`。靶为 `target-practice`，碰撞体为 `target-practice-face`。 |
| [web-3c/src/level.ts](../../web-3c/src/level.ts)、[web-3c/src/preview-scene.ts](../../web-3c/src/preview-scene.ts) | 加载关卡并复用 Rapier 查询。开门或关门时同步更新门扇显示与碰撞。开门范围为 1.55 米，角色占据门槛时阻止关门。已确认的开火使用当前固定步准星射线，首个碰撞体为靶面且在射程内时发布命中，靶面亮 24 步。 |
| [web-3c/src/hud.ts](../../web-3c/src/hud.ts)、[web-3c/src/main.ts](../../web-3c/src/main.ts)、[web-3c/index.html](../../web-3c/index.html)、[web-3c/src/style.css](../../web-3c/src/style.css) | 主页面接入路线、门提示、命中反馈和弹量 HUD。弹量以每步提交的 `ActionState` 为准。 |
| [web-3c/src/contracts.ts](../../web-3c/src/contracts.ts)、[web-3c/src/simulation.ts](../../web-3c/src/simulation.ts) | 共享事件新增 `target.hit`。固定步阶段增加可选的 `resolveSceneEvents`，在相机更新后、发布前用原有 `emit` 追加同一步事件。 |
| [web-3c/tests/m6.test.ts](../../web-3c/tests/m6.test.ts)、[web-3c/README.md](../../web-3c/README.md) | 路线回归和浏览器复现步骤。 |

## 验证与复现

在仓库根目录运行。

```powershell
cd web-3c
npm ci
node --test tests/m6.test.ts
npm test
npm run build
npm run preview -- --host 127.0.0.1 --port 4173
```

- M6 固定步回归通过。第 344 步命中靶，HUD 所用弹量为 7/16。第 345 步补弹到 8/15。第 429–462 步覆盖关门阻挡、开门后同一步射线畅通、拒绝在门槛关门、进入杂物间及从内侧关门。第 487–513 步覆盖回程阻挡、重开与通过。逐步输入和断言见 [路线用例](../../web-3c/tests/m6.test.ts)。
- 全量测试通过，生产构建通过。Vite 仍报告大于 500 KB 的代码块。
- 无头 Chromium 147.0.7727.15 的生产预览已验证 WebGL、鼠标锁定、路线、靶反馈、弹量 8/16 → 7/16 → 8/15，以及开门和进入后关门。关门后角色落点为 (8.93, 0.03, −0.86) 米，页面异常为 0。
- 手动复现时用 Chromium 打开 `http://127.0.0.1:4173/`。点击进入后沿走廊左转，在右墙橙色靶前急停，右键瞄准后左键单发，按 R 换弹。前往尽头按 E 开门，迈过门槛后按 E 关门。

## 共享接口与待补项

- M0 的步长、步内序号、`LevelDefinition` 与 `SceneQueries` 保持第 1 版。靶命中事件的 `subjectId` 为靶 ID，门变更事件的 `subjectId` 为门 ID。M3 的输入与移动已接入。M7 第 1 版回放继续使用自己的预览场景。
- M4 待接 `web-3c/src/camera.ts` 和镜头默认参数。保持 `CameraPose` 的朝向约定，使命中射线继续正对准星。
- M5 待接 `web-3c/src/actions.ts` 和 `reports/web-3c/action-rules.md`。命中只消费玩家的 `weapon.fired`。联调时由动作阶段和门确定一次交互接受与恢复的归属，避免重复发布。当前门由 `level.ts` 确认，动作占位阶段记录交互请求。
- M7 接入该路线时需以 `test-room@1` 生成固定步输入和新事件基线，包含 `door.changed` 与 `target.hit`。M8 待用正式镜头、动作和回放验证完整流程。
