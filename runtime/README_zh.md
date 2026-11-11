# RE9 3C 运行时采集器 v0.1

这是可运行的 REFramework Lua 脚本原型，配有安装脚本和 CSV 转换器。**本地模拟测试通过，尚未在游戏中验证接口与数据。** 当前游戏目录没有检测到 REFramework；本次没有安装框架或向游戏目录写入文件。

## 第一版能做什么

- 在 REFramework 面板开始、停止采集；每次 `on_frame` 回调记录一份样本，最多 3600 份后自动停止保存。
- 尝试识别当前角色上下文、角色类型、位置、动画层的动作库 ID、动作 ID、动画帧、结束帧、速度和权重。最多读取 16 层。
- 导出对象实际类型与方法列表，供下一轮补齐运行时接口。只枚举元数据，不会逐个执行列表中的方法。
- 读不到的数据留空；标题界面、切场景等情况保留缺失样本，不补零。记录文件可转 CSV。
- 不调用游戏 setter，不安装 hook，不改动作状态。`pcall` 可处理 Lua 异常，但不保证能捕获引擎原生崩溃；这是待实机验证的研究原型。

**暂时没有：** 已验证的弹药数、武器对象路径、游戏实际接受的输入、相机参数、状态树节点、混合关系、精确毫秒计时。不能用本版直接声称“输入后多少毫秒开枪”或“换弹在第几帧允许打断”。

## 如何使用

1. 从 [REFramework 官方发布页](https://github.com/praydog/REFramework/releases) 选支持 Resident Evil Requiem / RE9 的构建，按其说明安装。不要使用其他游戏的构建。
2. 在项目根目录 PowerShell 运行 `powershell -ExecutionPolicy Bypass -File .\runtime\install.ps1`。脚本只复制本项目 Lua；已有同名脚本会备份。它检测 `dinput8.dll` 是否存在，但该检测不能证明 DLL 就是正确的 REFramework。
3. 启动游戏，进入可操作的 Leon 场景，打开 REFramework 的 **Script Generated UI → RE9 3C Collector**。
4. 先点 **Probe interfaces**，再点 **Start capture**。关闭面板后做一次短测试：站立约 2 秒 → 举枪 → 单发 → 换弹 → 收枪。
5. 打开面板，点 **Stop and save**。面板显示 `Saved:` 才代表写入成功。写入失败时保留内存缓冲，点击 **Retry save**；重置脚本或退出进程仍可能丢失未保存数据。
6. 文件位于游戏目录 `reframework\data\`，分别为 `re9_3c_probe_*.json` 与 `re9_3c_capture_*.json`。文件名含 UTC 时间与序号，避免覆盖既有有效 JSON。

CSV 转换示例（输入路径替换为实际采集文件）：

```powershell
node .\runtime\capture_to_csv.cjs "G:\SteamLibrary\steamapps\common\RESIDENT EVIL requiem BIOHAZARD requiem\reframework\data\re9_3c_capture_实际文件名.json"
```

CSV 默认生成在 JSON 旁边；已有 CSV 时拒绝覆盖。每个动画层占一行，缺失数据保持空白。

## 怎样理解数据

| 字段 | 含义与限制 |
|---|---|
| sample_index | 本次采集的回调序号，不是录像帧号，也不是动画帧号；与录像需要另行对齐 |
| unix_seconds | 系统整秒时间，仅粗略定位，不用于毫秒延迟计算 |
| updater_type / character_hint | 运行时类型及候选角色。Cp_A000Updater 对应 Leon 的映射有第三方作者示例，仍需结合实际操控角色验证 |
| position | 候选 `get_Position` 返回的 XYZ，坐标空间与单位尚未验证 |
| layer_count | 候选接口报告的层数；缺失时仍试读第 0 层，不把这个尝试当成已知层数 |
| get_MotionBankID / get_MotionID | 候选动作库 / 动作编号，需要与已有静态索引及录像交叉验证，不能只按动作编号判断 |
| get_Frame / get_EndFrame | 候选动画时间值；单位、循环、混合时行为待验证，不假定为 60 fps |
| get_Speed / get_Weight | 原始候选返回值，未验证单位与语义，不直接当作最终播放速度或最终混合权重 |
| status | 找到角色、角色不可用或采样出错；player_found 不意味着所有字段都成功读取 |

这里的“候选”表示：脚本按明确允许的名称寻找方法，并检查参数个数后尝试调用；方法存在及返回数字，都不等于我们已经验证了它在 RE9 中的具体含义。诊断报告也不会自动触发新发现的方法。

对象链初版采用 CharacterManager → PlayerContextFast → Updater → GameObject → Motion。任何一环不成立都会产生缺失；拿到第一份 probe 后应针对实际类型修正，不能把缺失解释为“游戏没有动画”。

## 下一次实机验证的验收条件

1. Leon 场景报告实际 updater 类型；切到标题界面或加载时不反复报错。
2. 举枪、单发、换弹期间至少一层的动作库、动作编号、动画时间发生合理变化。
3. 对照短录像确认动作编号与静态资源关系，确认动画帧的单位。
4. 再定位武器与弹药对象、输入状态、相机参数，扩展精确计时与网页时间轴。

现在最有用的产物是 **probe JSON + 一段短 capture JSON**。即使 capture 的动画字段全空，probe 仍可以帮助定位当前版本正确的接口。

## 开发验证与来源

本地测试命令：`tools\lua-test\node_modules\.bin\fengari.cmd runtime/tests/collector_test.lua`。
模拟测试覆盖无玩家、异常 getter、缺失值与真实零值、层数上限、保存失败重试、文件名冲突、样本上限和脚本重置。它不模拟 RE 引擎原生内存访问，不能替代实机测试。

- [REFramework 回调](https://refdocs.praydog.com/api/re.html)、[方法元数据](https://refdocs.praydog.com/api/types/REMethodDefinition.html)、[类型元数据](https://refdocs.praydog.com/api/types/RETypeDefinition.html)、[JSON 保存接口](https://refdocs.praydog.com/api/json.html)。
- [RExtender 作者的 RE9 对象访问示例](https://www.nexusmods.com/residentevilrequiem/mods/2279?tab=description)：角色上下文和实际 updater 类型；本采集器不依赖 RExtender。
