# 里昂手枪动画播放器 v2：身体灰模

打开 `dist/index.html` 可离线使用；现有本机服务器地址 http://127.0.0.1:8765 。刷新已打开页面即可看到灰模。需要支持 WebGL 的浏览器；全部依赖和资产均在本地。

## 新功能

- 六个真实网格分件：双臂、头部、头发、上衣、裤鞋；LOD2，72,346 顶点。
- 身体灰模 / 灰模＋骨架 / 骨架三种显示模式；线框和绑定姿态对照。
- 保留14条动画的播放、暂停、逐帧、倍速、循环、视角、根节点跟随和遮罩着色。
- 两条 Add 片段自动使用骨架模式，不将未验证的增量动作直接套在模型上。

## 验证

- 原模型局部绑定矩阵累积后与逆绑定矩阵相乘，最大单位矩阵误差 2.27e-7。
- 持枪160、抬枪140、换弹1200各5个时间点，共15个姿态：模型与动画的同名骨骼位置最大差 4.55e-7；网格范围正常且坐标有限。
- `reports/model/playback_validation.json` 保存数值结果；`player/model-140.png`、`model-160.png`、`model-1200.png` 保存截图。
- 已验证浏览器模式切换、线框、Add回退；原时间轴等播放功能继续保留。

## 实现与范围

模型来自主 Mesh 与配套 streaming 数据。导出器 `scripts/ModelExport/Program.cs` 保留完整权重（本样本最多7个），按名称匹配模型与动画骨骼。模型辅助骨保留绑定局部变换并随父骨运动。CPU 蒙皮使用 world × inverseBind；Three.js负责WebGL显示。

此版使用 `dist/model.js` 的专用数据结构，尚未输出通用 GLB。Three.js 0.160.1 与其许可证放在 `dist/vendor`，不使用CDN。`model.js`约11MB；后续可改为二进制或GLB资源，改善加载与内存使用。

灰模分件装配用于验证绑定，不代表某一套完整游戏服装。当前没有贴图、头发透明裁切、武器、表情 BlendShape、IK或布料模拟；局部服装接缝和头发片面仍可见。未制作表情的骨骼保留参考姿态。Mask仅为骨架范围着色，不参与模型分层混合。

技术说明已更新到 `dist/technical.html`。游戏安装目录未修改。

## 指定验证页面

模型 HTTP 检查默认访问 8765；已有服务器可能仍提供旧版文件，可通过 PLAYER_URL 指定当前页面。Playwright 和 Chromium 路径目前仍是本机环境路径，换机器需要调整。

```powershell
$env:PLAYER_URL = ([System.Uri](Resolve-Path player/dist/index.html).Path).AbsoluteUri
node player/model-validation.cjs
node player/browser-check.cjs
```
