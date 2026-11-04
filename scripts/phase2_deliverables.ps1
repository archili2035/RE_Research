$ErrorActionPreference='Stop'
$dir='reports/phase2'
$resolved=Import-Csv "$dir/all_resolved.csv"
$specs=@(
@('瞄准移动-前',100,120,'ch0100_handgun00h.motlist.1047','TPSBase → Bank10/Motion2','动作树节点 Mask0'),
@('瞄准移动-左',100,122,'ch0100_handgun00h.motlist.1047','TPSBase → Bank10/Motion2','动作树节点 Mask0'),
@('瞄准移动-后',100,124,'ch0100_handgun00h.motlist.1047','TPSBase → Bank10/Motion2','动作树节点 Mask0'),
@('瞄准移动-右',100,126,'ch0100_handgun00h.motlist.1047','TPSBase → Bank10/Motion2','动作树节点 Mask0'),
@('抬枪进入',100,140,'ch0100_handgun00h.motlist.1047','TPSUpper → Wp0000H_140_Hold_Start_L0','Mask4：53个关节'),
@('持枪维持',100,160,'ch0100_handgun00h.motlist.1047','TPSBase → Bank10/Motion4','与165、167混合'),
@('持枪向左转',100,165,'ch0100_handgun00h.motlist.1047','TPSBase → Bank10/Motion4','WheelBlendRate / WheelSpeed'),
@('持枪向右转',100,167,'ch0100_handgun00h.motlist.1047','TPSBase → Bank10/Motion4','WheelBlendRate / WheelSpeed'),
@('放下枪',100,161,'ch0100_handgun00h.motlist.1047','TPSUpper → Hold_End分支','具体分支控制'),
@('单次射击',100,1100,'ch0100_handgun00h.motlist.1047','TPSAdd → Shot/SemiAuto/Normal','附加状态机；精确层混合数学未复演'),
@('常规换弹主体',100,1200,'ch0100_handgun00h.motlist.1047','TPSUpper → Handgun00H_1200_Reload','Reload父节点 AutoSetJointMask2'),
@('常规换弹躯干补偿',2100,1200,'ch0100_handgun00h_add.motlist.1047','UpperBodyPreAddConfiguration：层3 → 层2','Mask11：Hip 0.3，其余六关节0.5'),
@('另一换弹变体',100,1201,'ch0100_handgun00h.motlist.1047','TPSUpper → Handgun00H_1201_Reload_All','与1200分开制作，不强猜All枚举语义'),
@('换弹变体补偿',2100,1201,'ch0100_handgun00h_add.motlist.1047','Bank偏移+2000 / Motion偏移0','Mask11')
)
$rows=foreach($s in $specs){$r=$resolved|Where-Object {$_.List -eq $s[3] -and [int]$_.ID -eq $s[2] -and $_.Switch -eq '0'}|Select-Object -First 1;if(!$r -or $r.Kind -ne 'mot'){throw "missing selected motion $s"};[pscustomobject]@{Stage=$s[0];BankID=$s[1];MotionID=$s[2];Name=$r.Name;Frames=$r.Frames;FPS=$r.FPS;Controller=$s[4];Application=$s[5];Source=$r.Source}}
$rows | Export-Csv "$dir/handgun_production_breakdown.csv" -NoTypeInformation -Encoding utf8
$md=@('|用途|Bank / Motion|源动作名|frameCount / FPS|调用入口与应用范围|','|---|---|---|---|---|')
$md+=foreach($r in $rows){"|$($r.Stage)|$($r.BankID) / $($r.MotionID)|$($r.Name)|$($r.Frames) / $($r.FPS)|$($r.Controller)；$($r.Application)|"}
$md | Set-Content "$dir/production_table.md" -Encoding utf8
$evidence=[ordered]@{}
foreach($fsm in @('tpsbase','tpsupper','tpsadd')){$f=Get-Content "$dir/full/$fsm.motfsm2.45.json" -Raw | ConvertFrom-Json;$g=Get-Content "$dir/parsed/$fsm.motfsm2.45.json" -Raw | ConvertFrom-Json;$ids=switch($fsm){'tpsbase'{@(3296484976,3872436775)}'tpsupper'{@(2145220387,695556244,360106824,3487399072,322495786)}'tpsadd'{@(827603261,1269213751,502402705,3293163594)}};$evidence[$fsm]=@($f.Nodes | Where-Object {($_.ID -split ' ')[0] -in $ids});$evidence[$fsm+'_hierarchy']=@($g.Graph.Nodes|Where-Object ID -in $ids)}
$evidence['PreAddSetting']=(Get-Content "$dir/full/playercommonpreaddsetting.user.3.json" -Raw|ConvertFrom-Json).Objects
$evidence['Configuration']=(Get-Content "$dir/full/cp_a000configuration.user.3.json" -Raw|ConvertFrom-Json).Objects[0].Fields._UpperBodyPreAddConfiguration
$evidence['IdentityLipSync']=(Get-Content "$dir/full/cp_a000configuration.user.3.json" -Raw|ConvertFrom-Json).Objects[0].Fields._LipSyncConfiguration
$evidence['Masks']=@((Get-Content "$dir/parsed/cp_a0jointmap.jmap.28.json" -Raw|ConvertFrom-Json).Groups|Where-Object ID -in @(2,4,11))
$evidence['Trees']=@((Get-Content "$dir/full/ch0100_motiontree.typed.json" -Raw|ConvertFrom-Json)|Where-Object ID -in @(2,4,5000))
$evidence|ConvertTo-Json -Depth 60|Set-Content "$dir/handgun_evidence.json" -Encoding utf8
$manifest=Import-Csv "$dir/effective_files.csv"|Where-Object {$_.Path -match 'cp_a000configuration.user|cp_a000montagepresetdata|cp_a0jointmap\.jmap|playercommonpreaddsetting|playercommonmotionuservariables|tps(base|upper|add)\.motfsm|ch0100_(handgun00[hm](_add)?|motiontree)\.motlist|/ch0100\.motbank'}
$manifest|ForEach-Object {[pscustomobject]@{Path=$_.Path;Pak=$_.Pak;SHA256=(Get-FileHash -LiteralPath $_.File).Hash}}|Export-Csv "$dir/evidence_manifest.csv" -NoTypeInformation
'Created production table, curated evidence and source hashes.'
