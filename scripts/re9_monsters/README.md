# re9_monsters — RE9 怪物纹理解码脚本

从 RE9（生化危机9：安魂曲，RE Engine，Steam 版）的 PAK 包中提取怪物角色纹理并解码为 PNG，生成怪物图鉴。全部为纯 Python 实现，除 TEX 解码外无第三方运行时依赖。

## 脚本链

| 脚本 | 作用 | 输入 → 输出 |
|---|---|---|
| `scan_paks.py` | 扫描 PAK 入口表，生成全局路径哈希索引 | `re_chunk_*.pak` → `pak_index.json` |
| `pak_extract.py` | 解包单个资源（chunked 资源 ZSTD/DEFLATE 解压） | pak + hash → 原始字节 |
| `batch_extract.py` | 按 `pak_index.json` 批量解包指定条目 | `pak_index.json` → 原始文件 |
| `test_extract.py` | 解包连通性自检 | — |
| `msg_parse.py` | 解析 `.msg.23` 本地化文本（XOR-CBC 解密） | `.msg.23` → 文本 |
| `dump_msg.py` / `search_msg.py` | 转储 / 检索 msg 内容 | `.msg.23` → 文本 |
| `tex2png.py` | 解析 `.tex.250813143` 容器头，提取 mipmap 信息 | `.tex` → 头信息 |
| `dds2png.py` | DDS(DXT10/BC1) → PNG（numpy 解 BC1） | `.dds` → `.png` |
| `build_atlas.py` | 生成怪物图鉴 HTML（内嵌 base64 缩略图） | PNG 列表 → `RE9_monster_atlas.html` |
| `monster_albd.txt` | 已成功定位的怪物 albedo 纹理路径清单（17 条） | — |

## 复现步骤

1. 用 `REE.PAK.Tool` + `RE9_STM_Release.list` 获取文件名（见 `reports/RE9_levels/` 报告 §6）。
2. `scan_paks.py` 生成 `pak_index.json`（14MB，不入库，需本地重新生成）。
3. `batch_extract.py` 解出目标 `.tex`。
4. `REToolCustom` 的 `REtool.exe -tex` 转 DDS，`dds2png.py` 解 BC1 出 PNG。
5. `build_atlas.py` 拼图鉴。

> 注意：`pak_index.json` 由 `scan_paks.py` 生成、`batch_extract.py` 消费，是中间产物，未纳入版本控制。

## 关键格式要点

- **PAK**：`KPKA` 头，入口表 RSA 解密 + 异或；路径哈希 = Murmur3 x86_32 对 UTF-16LE 路径做 upper/lower 两次组合成 64 位。
- **GMSG（`.msg.23`）**：XOR-CBC 解密，KEY 索引基于 `(i - dataOffset) & 0xF`（非绝对偏移）。语言 13 = 简体中文。
- **TEX（`.tex.250813143`）**：RE9 特有，mipmap 用 **GDeflate** 压缩（magic `04 FB`），非旧版裸 BC 数据；转 DDS 后为 DXT10 扩展头（148 字节），只取顶层 mip。

## 怪物编号映射

| 角色编号 | 中文名 | 备注 |
|---|---|---|
| ch4000 | 丧尸 | 93+ 职业变体 |
| ch1200 | 女孩 | — |
| ch4310 | 主厨丧尸 | — |
| ch4400 | 肥硕丧尸 | — |
| ch5110 | 维克多变异 | — |
| ch7700 | 加姆 | CM-G-002 |
| ch7600 | 泰坦巨蛛 | — |
| ch3100 | 43号植物 | CX-P-001 |
| ch5600 | 暴君 T-50 | CM-T-501 |
| ch5205 | 超级暴君 | — |
| ch9808 | 蜘蛛 | — |
| ch9806 | 蛆虫 | — |
| ch9807 | 蟑螂 | — |

- 怪物图鉴来自 `bonus.msg.23` 的 bo20 条目，共 23 种。
- 舔食者 β2（CM-LB-110）未定位到角色纹理。
- ch47/48/49 仅有 prefab 无纹理（复合敌人，引用他处）；boss 纹理可被 streaming 目录复用。

## 产出

- `reports/RE9_monsters/RE9_monster_atlas.html`：18 张解码贴图 + 23 种怪物清单，内嵌 base64 缩略图。
- `reports/RE9_monsters/gallery/`：全尺寸 PNG。
