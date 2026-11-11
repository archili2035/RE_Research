const fs=require('fs'),p='scripts/detailed_statistics.cjs';let s=fs.readFileSync(p,'utf8');s=s.replace('骨骼头数量分布（前10项）','骨骼头数量分布（全部18种）').replace('bonehist.slice(0,10).map','bonehist.map');const insert=`
md=md.replace('Handgun00H 基准列表含 '+hand.length+' 个物理 MOT，按同一套用途规则得到：','Handgun00H 基准列表的102个槽位对应 '+hand.length+' 个物理 MOT。3组复用同一载荷的编号为：160 / 6001（Hold_Loop）、1110 / 1131（Shoot_Dotsight）、1203 / 1403（原名 Chanber_Check）。因此不能直接将102个槽位写成102条独立片段。按同一套用途规则得到：');
md=md.replace('没有执行逐轨道内容哈希或视觉相似度去重。','没有执行逐轨道内容哈希或视觉相似度去重。动作树122个由主 MotionTree 的112个、MotionTree_Add 的5个和面部列表内的5个组成；前文112棵类型化动作树特指主 MotionTree。');
md=md.replace('复现命令：在 E:/CodexPepo/RE_Research 运行','骨骼统计输入保存在 bone_statistics_source.json，由 scripts/BoneStatistics/Program.cs 直接读取保留的 Mesh 与 MOT 样本生成，不依赖网页资产目录。复现命令：在 E:/CodexPepo/RE_Research 运行');
`;
s=s.replace("const report=root+'/leon_handgun_animation_rules_zh.md';",insert+"const report=root+'/leon_handgun_animation_rules_zh.md';");fs.writeFileSync(p,s);
