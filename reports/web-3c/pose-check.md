# M2 骨架、动作与 GLB 回读

2026-11-25。生产预览的 `/m2.html` 可从 3C 灰盒首页进入，支持绑定姿态、动作播放和按时间拖动。页面读取第 1 版 `ClipManifest` 和一份原创 GLB。

## 上游核对

- M0 已提供 [共享接口](../../web-3c/src/contracts.ts) 和 [固定步入口](../../web-3c/src/main.ts)。M0 使用米、+Y 向上、脚底原点、偏航零点 −Z。GLB 按标准使用 +Z 前向，回读时由外层节点绕 +Y 旋转 π，再接入 M0 的角色朝向。[glTF 2.0 坐标约定](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#coordinate-system-and-units)
- M1 [资产审计](asset-audit.json) 第 1 版的目标文件均可定位。优先样本为 RE9 Steam build 23634047 的 `docs/player/model.js` 骨架和 `docs/player/motions.json`。站立、举枪、换弹对应 `bank/id/switch` 为 `100/160/0`、`100/140/0`、`100/1200/0`，射击参照为 `100/1100/0`。附加换弹轨 `2100/1200/0` 的 M1 证据覆盖骨架显示。
- [播放器说明](../../player/MODEL_README.md) 和 [既有姿态记录](../model/playback_validation.json) 分别说明专用 CPU 蒙皮和站立、举枪、换弹各五个采样点。M1 的 [RE9 浏览器记录](../../runtime/web-3c-m1.tmp/re9-browser.json) 中，这三个片段的最大同名关节差分别约为 2.20e-7、4.54e-7、3.96e-7 m。记录中的四个输入哈希均与当前本地文件相符。
- RE4 Steam build 22377325 的对照骨架是 `runtime/ue5_asset_probe/re4_wp4000/fbx/SK_RE4_Leon_Gray.fbx`。站立、举枪和射击在同目录 `decoded/` 的 `RE4_wp4000H_0160.json`、`RE4_wp4000H_0140.json`、`RE4_wp4000H_0500.json`，换弹在 `runtime/web-3c-m1.tmp/re4-reload/RE4_wp4000H_0810.json`。M1 已记录 160、500 的未映射骨哈希 `2749258283`。

## 动作与接口

[clips.json](../../web-3c/public/assets/clips.json) 的 GLB 路径相对于清单。所有 ID 都映射到同一自包含文件 [m2-rehearsal.glb](../../web-3c/public/assets/m2-rehearsal.glb)。几何、骨架、道具和关键帧均由 [生成脚本](../../scripts/web-3c/build_m2_assets.py) 原创编写。时间为占位动画时间。

| 动作 ID | GLB 动画名 | 混合 | 时长 | 验收片段 |
| --- | --- | --- | ---: | --- |
| `hold-idle` | `HoldIdle` | `normal` | 0.80 s | `hold`，0.40 s |
| `raise` | `Raise` | `normal` | 0.44 s | `raise-mid`，0.22 s；`aim`，0.44 s |
| `fire` | `Fire` | `additive` | 0.24 s | `fire-peak`，0.06 s，以 `Raise` 的 0.44 s 为基准 |
| `reload` | `Reload` | `baked` | 1.40 s | `reload-drop`，0.30 s；`reload-contact`，0.72 s |

- M5 可直接按 ID 读取 [浏览器加载器](../../web-3c/src/clip-assets.ts)。`Fire` 在 GLB 中保存绝对局部四元数。加载器按清单保留双臂六根骨的通道，用 `referencePose` 转成相对四元数一次；预览在指定瞄准基准上叠加它。`Reload` 的手臂、固定腿姿和弹匣位移已合为一条绝对轨，可按普通动画播放。
- M8 构建会发布 `m2.html`、`assets/clips.json` 和 `assets/m2-rehearsal.glb`。本轮的最小新增约定是清单的相对路径和增量轨的加载方式。M0 的类型与版本号保持原样，灰盒主循环仍走原有入口。

## 浏览器验收

使用 Chromium 147.0.7727.15、1280 × 900 和 Three.js 0.160.1，通过 Vite 生产预览从灰盒首页打开 M2。12 个姿态采样通过，共一次 GLB 请求，页面和资源加载无错误。切换动作后能恢复绑定姿态，单发可从头播放到 0.240 s 并停住。

| 检查 | 回读结果 |
| --- | --- |
| 绑定 | 17 根骨、456 个身体蒙皮顶点。逆绑定乘积对单位矩阵的最大元素差为 4.29e-8。绑定时蒙皮顶点最大偏差为 4.53e-8 m。 |
| 尺度与前向 | 身高 1.820 m；12 帧脚底高度均约 1.79e-9 m，脚部节点和根节点保持原位。角色水平前向为 (0, 0, −1)。 |
| 武器挂点 | 各帧为 `R_Hand → R_Wep → TrainingProp`，`R_Wep` 的手骨局部位移为 (0, −0.043, 0.046) m。 |
| 持枪与举枪 | 道具俯仰从 −18° 经中段 −8° 到瞄准 0°，挂点高度从 1.118 经 1.228 到 1.336 m。 |
| 单发增量 | 0.06 s 峰值为 +13°，起点和结束恢复瞄准的挂点与左右手姿态。 |
| 换弹接触 | 0.30 s 弹匣离弹匣口约 0.154 m。0.72 s 左手到弹匣口约 3.43e-8 m、弹匣到弹匣口约 1.05e-8 m。1.40 s 回到瞄准。 |

数值证据保存在 [pose-readback.json](../../runtime/web-3c-m2.tmp/pose-readback.json) 的 `poses`，含构建素材 SHA-256。截图按帧保存为 [hold.png](../../runtime/web-3c-m2.tmp/hold.png)、[raise-mid.png](../../runtime/web-3c-m2.tmp/raise-mid.png)、[fire-peak.png](../../runtime/web-3c-m2.tmp/fire-peak.png) 和 [reload-contact.png](../../runtime/web-3c-m2.tmp/reload-contact.png)。最终 Web 3C 测试 10/10 通过，[测试日志](../../runtime/web-3c-m2.tmp/web-3c-tests.log) 保存在本地。生成两次得到相同的文件哈希。生产构建通过，Vite 提示部分共享包超过 500 kB。

## 复现

在仓库根目录运行，依赖安装后可跳过 `npm ci`。浏览器脚本会自行启动和关闭生产预览。已安装 Playwright 时可直接解析；本机复现使用以下缓存路径。

```powershell
python scripts/web-3c/build_m2_assets.py
npm --prefix web-3c ci
npm --prefix web-3c test
npm --prefix web-3c run build
$env:PLAYWRIGHT_MODULE = 'C:/Users/archili/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core'
$env:CHROMIUM_EXECUTABLE = 'C:/Users/archili/AppData/Local/ms-playwright/chromium-1217/chrome-win64/chrome.exe'
node web-3c/tests/check-m2-browser.mjs
```

## 待补

- 原作组合对照仍需上游给出 RE9 射击和换弹增量的精确基准采样、有效骨骼遮罩与层权重，以及 RE4 目标未映射骨的名称。RE9 `Handgun00H` 的装备核对和 `wp0100` 静态武器挂接另有记录。两代骨架与完整动作组合的标准 GLB 对照仍待补。[里昂武器挂接](weapon-attachment.md)
- M5 后续接入持枪前移和收枪时需要对应发布轨。本轮占位清单提供持枪站立、举枪、单发和换弹。实机时序对照沿用 M7 的同步录像与输入记录需求。
