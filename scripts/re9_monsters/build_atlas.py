# -*- coding: utf-8 -*-
"""生成 RE9 怪物贴图图鉴 HTML 报告"""
import os, base64, io
from PIL import Image

OUT = "G:/re9_research"
GALLERY = os.path.join(OUT, "gallery")
os.makedirs(GALLERY, exist_ok=True)

# 怪物贴图映射：文件名 -> (中文名, 分类, 说明)
TEX = [
    ("natives/stm/character/ch/ch40/4000/textures/ch4000_00_00_00_body00_upperbody_albd", "鹪木市的丧尸（基础型）", "丧尸", "丧尸上半身皮肤，含血污与伤口，ch4000 含 93+ 职业变体（医生/病人/职员/保洁员/歌手等）"),
    ("natives/stm/character/ch/ch40/4000/textures/ch4000_00_00_00_body00_lowerbody_albd", "丧尸（下半身）", "丧尸", "丧尸下半身皮肤贴图"),
    ("natives/stm/character/ch/ch12/1200/textures/ch1200_00_00_00_upperbody_albd", "“女孩”", "感染体", "灰白带紫红色调，游戏中惧怕光的特殊感染体"),
    ("natives/stm/character/ch/ch43/4310/textures/ch4310_10_00_00_face_albd", "主厨丧尸（脸部）", "特殊丧尸", "主厨丧尸面部贴图，口鼻眼周带血迹"),
    ("natives/stm/character/ch/ch43/4310/textures/ch4310_00_00_00_arm_albd", "主厨丧尸（手臂）", "特殊丧尸", "主厨丧尸手臂皮肤，带大片血迹"),
    ("natives/stm/character/ch/ch44/4400/textures/ch4400_00_00_00_body_albd", "肥硕丧尸", "特殊丧尸", "肥硕丧尸身体，灰褐色皮肤带隆起鼓包（肿瘤）"),
    ("natives/stm/character/ch/ch51/5110/textures/ch5110_00_03_00_body00_albd", "维克多（变异）", "Boss", "红粉色口腔/内脏状纹理，血肉变异形态"),
    ("natives/stm/character/ch/ch77/7700/textures/ch7700_00_00_body00_body_albd", "加姆（身体）", "生物武器", "代号 CM-G-002，地狱犬改良，深色斑驳皮肤"),
    ("natives/stm/character/ch/ch77/7700/textures/ch7700_00_00_body00_fur_albd", "加姆（皮毛）", "生物武器", "深棕色细密皮毛纹理"),
    ("natives/stm/character/ch/ch76/7600/00/textures/ch7600_00_00_00_base_albd", "泰坦巨蛛", "Boss", "甲壳/外骨骼，多排牙齿口器与眼窝，具抓取(grapple)攻击"),
    ("natives/stm/character/ch/ch31/3100/texture/ch3100_00_00_00_sabplant_albd", "43号植物（茎叶）", "Boss", "代号 CX-P-001，染疫植物"),
    ("natives/stm/character/ch/ch31/3100/texture/ch3100_00_00_00_flower_albd", "43号植物（花）", "Boss", "六角星/海星状花部结构"),
    ("natives/stm/character/ch/ch31/3100/texture/ch3100_00_00_00_main_albd", "43号植物（主体）", "Boss", "深灰黑色斑驳主体纹理"),
    ("natives/stm/character/ch/ch56/5600/textures/ch5600_00_00_00_upperbody_albd", "暴君 T-50", "Boss", "代号 CM-T-501，苍白人形生物武器皮肤，含牙齿/缝合疤痕"),
    ("natives/stm/character/ch/ch52/5205/textures/ch5205_00_00_00_body00_upperbody_albd", "超级暴君 T-50（待确认）", "Boss", "灰褐色兽皮/疤痕组织躯干，含 body_damage/neck_damage 受伤态"),
    ("natives/stm/character/ch/ch98/9808/00/00/ch9808_00_00_spider_albd", "蜘蛛（幼蛛）", "小型生物", "灰白色蛛形身体与节肢，泰坦巨蛛所生"),
    ("natives/stm/character/ch/ch98/9806/textures/ch9806_00_maggot_albd", "蛆虫", "小型生物", "黄棕色小型蠕虫"),
    ("natives/stm/character/ch/ch98/9807/textures/ch9807_00_cockroach_albd", "蟑螂", "小型生物", "深棕色甲虫/蟑螂背部视图"),
]

THUMB = 260

def make_thumb(png_path):
    im = Image.open(png_path).convert("RGBA")
    im.thumbnail((THUMB, THUMB))
    buf = io.BytesIO()
    im.save(buf, "PNG")
    return base64.b64encode(buf.getvalue()).decode()

items = []
for rel, name, cat, desc in TEX:
    png = os.path.join("G:/re9_research/extract", rel + ".png")
    if not os.path.exists(png):
        print("MISS", png)
        continue
    b64 = make_thumb(png)
    # 拷贝全尺寸
    fname = rel.split("/")[-1] + ".png"
    Image.open(png).convert("RGBA").save(os.path.join(GALLERY, fname))
    items.append({"name": name, "cat": cat, "desc": desc, "b64": b64, "fname": fname})

# ===== 完整怪物清单（来自 bonus.msg.23 bo20 图鉴）=====
MONSTERS = [
    ("029", "鹪木市的丧尸", "ch4000", "丧尸"),
    ("030", "“女孩”", "ch1200", "感染体"),
    ("031", "医生丧尸", "ch4000 变体", "丧尸"),
    ("032", "病人丧尸", "ch4000 变体", "丧尸"),
    ("033", "职员丧尸", "ch4000 变体", "丧尸"),
    ("034", "保洁员丧尸", "ch4000 变体", "丧尸"),
    ("035", "主厨丧尸", "ch4310", "特殊丧尸"),
    ("036", "歌手丧尸", "ch4000 变体", "丧尸"),
    ("037", "手术室的丧尸", "ch4000 变体", "丧尸"),
    ("038", "肥硕丧尸", "ch4400", "特殊丧尸"),
    ("039", "疱头丧尸", "ch4000 变体", "丧尸"),
    ("040", "疱源丧尸", "ch4000 变体", "丧尸（肿瘤可爆裂使周围变异）"),
    ("041", "泰坦巨蛛", "ch7600", "Boss"),
    ("042", "浣熊市的丧尸", "ch4000 变体", "丧尸"),
    ("043", "加姆", "ch7700", "生物武器 CM-G-002"),
    ("044", "浣熊市警察局的丧尸", "ch4000 变体", "丧尸"),
    ("045", "孩童", "—", "感染体"),
    ("046", "暴君 T-50", "ch5600", "生物武器 CM-T-501"),
    ("047", "超级暴君 T-50", "ch5205", "Boss（心脏为弱点）"),
    ("048", "43号植物", "ch3100", "生物武器 CX-P-001"),
    ("049", "方舟的丧尸", "ch4000 变体", "丧尸"),
    ("050", "舔食者β", "—", "生物武器 CM-LB-110"),
    ("051", "维克多（变异）", "ch5110", "Boss"),
]

cats = {}
for m in MONSTERS:
    cats.setdefault(m[3], 0)
    cats[m[3]] += 1

rows = "".join(
    f'<tr><td>{m[0]}</td><td class="cn">{m[1]}</td><td><code>{m[2]}</code></td><td>{m[3]}</td></tr>'
    for m in MONSTERS
)

cards = "".join(
    f'''<div class="card">
      <div class="imgwrap"><img src="data:image/png;base64,{it['b64']}" alt="{it['name']}"></div>
      <div class="meta"><span class="cat">{it['cat']}</span><h3>{it['name']}</h3>
      <p>{it['desc']}</p></div>
    </div>'''
    for it in items
)

html = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>RE9 Requiem 怪物资产研究图鉴</title>
<style>
:root {{ --bg:#0f1115; --panel:#171a21; --panel2:#1e222b; --txt:#e6e8ec; --dim:#9aa3b2; --acc:#e5484d; --line:#2a2f3a; }}
* {{ box-sizing:border-box; }}
body {{ margin:0; background:var(--bg); color:var(--txt); font-family:-apple-system,"Segoe UI","Microsoft YaHei",sans-serif; line-height:1.6; }}
.wrap {{ max-width:1080px; margin:0 auto; padding:32px 20px 60px; }}
h1 {{ font-size:26px; margin:0 0 6px; }}
h2 {{ font-size:20px; margin:40px 0 14px; padding-bottom:8px; border-bottom:1px solid var(--line); }}
.sub {{ color:var(--dim); font-size:14px; margin-bottom:28px; }}
.tag {{ display:inline-block; background:var(--acc); color:#fff; font-size:11px; padding:2px 8px; border-radius:10px; margin-right:6px; vertical-align:middle; }}
table {{ width:100%; border-collapse:collapse; font-size:13.5px; background:var(--panel); border-radius:10px; overflow:hidden; }}
th,td {{ padding:8px 12px; text-align:left; border-bottom:1px solid var(--line); }}
th {{ background:var(--panel2); color:var(--dim); font-weight:600; font-size:12px; }}
tr:last-child td {{ border-bottom:none; }}
td.cn {{ font-weight:600; }}
code {{ background:var(--panel2); padding:1px 6px; border-radius:5px; font-size:12px; color:#8fd0ff; }}
.grid {{ display:grid; grid-template-columns:repeat(auto-fill,minmax(260px,1fr)); gap:16px; }}
.card {{ background:var(--panel); border:1px solid var(--line); border-radius:12px; overflow:hidden; }}
.imgwrap {{ background:#000; aspect-ratio:1; display:flex; align-items:center; justify-content:center; }}
.imgwrap img {{ width:100%; height:100%; object-fit:contain; image-rendering:auto; }}
.meta {{ padding:12px 14px; }}
.meta h3 {{ margin:6px 0 4px; font-size:15px; }}
.meta p {{ margin:0; color:var(--dim); font-size:12.5px; }}
.cat {{ font-size:11px; color:#ffb3b5; background:rgba(229,72,77,.15); padding:2px 8px; border-radius:8px; }}
.note {{ background:var(--panel); border-left:3px solid var(--acc); padding:14px 16px; border-radius:0 8px 8px 0; font-size:13px; color:var(--dim); margin:16px 0; }}
.note b {{ color:var(--txt); }}
</style>
</head>
<body>
<div class="wrap">
<h1>RE9 Requiem <span class="tag">怪物资产研究</span></h1>
<div class="sub">Resident Evil 9: Requiem · Capcom RE 引擎 · 从 re_chunk_000.pak 解包的图片与文本资产</div>

<h2>一、怪物清单（23 种 · 来自 bo20 图鉴）</h2>
<p class="sub">图鉴文本来自 <code>bonus.msg.23</code>（bo20 Models 画廊），简体中文。角色编号通过 <code>charaname.msg.23</code> 与纹理文件路径交叉确认。</p>
<table>
<thead><tr><th>图鉴#</th><th>中文名</th><th>角色编号</th><th>类型</th></tr></thead>
<tbody>{rows}</tbody>
</table>

<h2>二、贴图图鉴（已解码 {len(items)} 张）</h2>
<p class="sub">纹理为 RE9 特有的 <code>.tex.250813143</code> 格式，使用 <b>GDeflate</b> 压缩的 BC1 数据；经 GDeflate 解压 + BC1 解码还原为 PNG。</p>
<div class="grid">{cards}</div>

<h2>三、技术要点</h2>
<div class="note"><b>PAK 容器：</b><code>re_chunk_000.pak</code>（约 20GB）为 KPKA 格式，入口表需 RSA 解密 + 异或；chunked 资源以 ZSTD/DEFLATE 压缩。</div>
<div class="note"><b>文本资产：</b><code>.msg.23</code> 为 GMSG 格式（version 23），采用 XOR-CBC 加密，key 索引基于 dataOffset 偏移。语言索引 13=简体中文、1=英语、0=日语。</div>
<div class="note"><b>纹理资产：</b><code>.tex.250813143</code> 头部 magic <code>TEX\\x00</code>，mipmap 数据用 GDeflate 压缩（magic <code>04 FB</code>），而非旧版未压缩 BC 数据。albedo 多为 BC1_UNORM_SRGB，法线贴图为 BC7。</div>
<div class="note"><b>工具链：</b>REE.PAK.Tool（Ekey）提供文件清单 → 自研 Python 选择性提取 → REToolCustom（SlickAmogus）GDeflate 解压转 DDS → numpy BC1 解码转 PNG。</div>
</div>
</body>
</html>"""

path = os.path.join(OUT, "RE9_monster_atlas.html")
open(path, "w", encoding="utf-8").write(html)
print("已生成:", path)
print("图鉴卡片:", len(items), "张 · 怪物清单:", len(MONSTERS), "种")
