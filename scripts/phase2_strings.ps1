$ErrorActionPreference='Stop'
$latest=@{}
foreach($root in @('reports/samples','reports/phase2/samples')){foreach($f in Get-ChildItem $root -Recurse -File){$rel=$f.FullName.Substring((Resolve-Path $root).Path.Length+1).Replace('\','/');$cut=$rel.IndexOf('/');$pak=$rel.Substring(0,$cut);$path=$rel.Substring($cut+1);$rank=0;if($pak -match 'patch_(\d+)'){$rank=[int]$Matches[1]};if(!$latest.ContainsKey($path) -or $rank -gt $latest[$path].Rank){$latest[$path]=[pscustomobject]@{Path=$path;Pak=$pak;Rank=$rank;File=$f.FullName}}}}
$latest.Values | Sort-Object Path | Export-Csv reports/phase2/effective_files.csv -NoTypeInformation
$out=foreach($e in $latest.Values){if($e.Path -match '\.(user|motfsm2|uvar)\.'){ $b=[IO.File]::ReadAllBytes($e.File);foreach($m in [regex]::Matches([Text.Encoding]::Unicode.GetString($b),'[\x20-\x7e\u3000-\u9fff]{5,}')){[pscustomobject]@{Path=$e.Path;Offset=$m.Index*2;Text=$m.Value}}}}
$out | Export-Csv reports/phase2/strings.csv -NoTypeInformation -Encoding utf8
$out | Where-Object Text -match 'Leon|レオン|里昂|ch0100|ch0200' | Select-Object -First 30 Path,Text | Format-List
