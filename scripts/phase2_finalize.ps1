$ErrorActionPreference='Stop'
$files=Import-Csv reports/phase2/effective_files.csv
$effective=@{};foreach($e in $files){$effective[$e.Path]=$e}
$lists=@{};foreach($l in Import-Csv reports/lists.csv){$rel=$l.File.Replace('\','/');$cut=$rel.IndexOf('/');$path=$rel.Substring($cut+1);if($effective.ContainsKey($path) -and $effective[$path].Pak -eq $rel.Substring(0,$cut)){$lists[$path]=$l}}
$data=@{};$rows=@{};$packs=@{};$mapping=[Collections.Generic.List[object]]::new()
foreach($path in $lists.Keys){$obj=Get-Content ('reports/phase2/parsed/'+[IO.Path]::GetFileName($path)+'.json') -Raw | ConvertFrom-Json;$data[$path]=$obj;$rows[$path]=@{};foreach($r in $obj.Rows){$key="$($r.ID):$($r.Switch)";if($rows[$path].ContainsKey($key)){throw "duplicate $path $key"};$rows[$path][$key]=$r}}
foreach($e in $files | Where-Object Path -match '\.motpack\.'){ $obj=Get-Content ('reports/phase2/parsed/'+[IO.Path]::GetFileName($e.Path)+'.json') -Raw | ConvertFrom-Json;$packs[$e.Path]=@{};foreach($r in $obj.Rows){$packs[$e.Path][[int]$r.ID]=$r}}
function Resolve-Row($path,$key,$trail='',$depth=0){if($depth -gt 24){throw 'reference loop'};if(!$rows.ContainsKey($path)){return $null};$r=$rows[$path][$key];if(!$r){return $null};if($r.Payload){return [pscustomobject]@{Origin=$path;Name=$r.Payload.Name;Payload=$r.Payload;Route=($trail+'local');Depth=$depth}}
$pack=$lists[$path].Motpack
if($pack -and $r.PackIndex -ge 0 -and $r.ReferenceSelector -eq 0){$pp='natives/stm/'+$pack.ToLower()+'.1012';if(!$packs.ContainsKey($pp) -or !$packs[$pp].ContainsKey([int]$r.PackIndex)){throw "missing pack entry $pp $($r.PackIndex) owner=$path key=$key type=$($r.Type) offset=$($r.Offset)"};$p=$packs[$pp][[int]$r.PackIndex];return [pscustomobject]@{Origin=$pp;Name=$p.Payload.Name;Payload=$p.Payload;Route=($trail+'pack['+$r.PackIndex+']');Depth=$depth}}
if($r.PackIndex -ge 0 -and $r.ReferenceSelector -ne 0){return $null}
$base=$lists[$path].Base;if($base){return Resolve-Row ('natives/stm/'+$base.ToLower()+'.1047') $key ($trail+'base>') ($depth+1)};return $null}
$all=foreach($path in $lists.Keys | Sort-Object){foreach($r in $data[$path].Rows){$key="$($r.ID):$($r.Switch)";$a=Resolve-Row $path $key;$row=[pscustomobject]@{List=[IO.Path]::GetFileName($path);ID=$r.ID;Switch=$r.Switch;PackIndex=$r.PackIndex;Source=if($a){$a.Origin}else{''};Route=if($a){$a.Route}else{'unresolved'};Name=if($a){$a.Name}else{''};Kind=if($a){$a.Payload.Kind}else{'unresolved'};Frames=if($a){$a.Payload.Frames}else{''};FPS=if($a){$a.Payload.FPS}else{''}};if($row.Route -match 'pack\['){$mapping.Add($row)};$row}}
$all | Export-Csv reports/phase2/all_resolved.csv -NoTypeInformation -Encoding utf8
$mapping | Export-Csv reports/phase2/external_pack_mapping.csv -NoTypeInformation -Encoding utf8
$summary=$all | Group-Object List | ForEach-Object {[pscustomobject]@{List=$_.Name;Slots=$_.Count;Local=@($_.Group|Where-Object Route -eq 'local').Count;Inherited=@($_.Group|Where-Object Route -like 'base>*').Count;External=@($_.Group|Where-Object Route -like 'pack*').Count;Unresolved=@($_.Group|Where-Object Kind -eq unresolved).Count}}
$summary | Export-Csv reports/phase2/resolution_summary.csv -NoTypeInformation -Encoding utf8
$checks=[Collections.Generic.List[object]]::new()
foreach($e in $files | Where-Object Path -match '\.motfsm2\.'){ $name=[IO.Path]::GetFileName($e.Path);$a=Get-Content "reports/phase2/parsed/$name.json" -Raw | ConvertFrom-Json;$b=Get-Content "reports/phase2/full/$name.json" -Raw | ConvertFrom-Json;$good=$a.Graph.Nodes.Count -eq $b.Nodes.Count -and $a.Transitions.Count -eq $b.Transitions.Count;for($i=0;$i -lt $a.Transitions.Count;$i++){if($a.Transitions[$i].BlendFrames -ne $b.Transitions[$i].interpolationFrame -or $a.Transitions[$i].Bits -ne $b.Transitions[$i].data){$good=$false}};for($i=0;$i -lt $a.Graph.Nodes.Count;$i++){if($a.Graph.Nodes[$i].Name -ne $b.Nodes[$i].Name){$good=$false}};if(!$good){throw "cross-check failed $name"};$checks.Add([pscustomobject]@{File=$name;Nodes=$a.Graph.Nodes.Count;Transitions=$a.Transitions.Count;IndependentParserAgreement=$good})}
$checks | Export-Csv reports/phase2/validation.csv -NoTypeInformation
[pscustomobject]@{EffectiveFiles=$files.Count;Lists=$lists.Count;Packs=$packs.Count;Slots=@($all).Count;Unresolved=@($all|Where-Object Kind -eq unresolved).Count;ExternalMappings=$mapping.Count;FSMCrossChecks=$checks.Count} | ConvertTo-Json | Tee-Object -FilePath reports/phase2/summary.json
$summary | Where-Object List -match 'handgun(00[hm]|01h|30h|40h)\.motlist' | ConvertTo-Json


