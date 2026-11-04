$ErrorActionPreference='Stop'
Add-Type -Path scripts/DeepAudit.cs
$files=Import-Csv reports/phase2/effective_files.csv
foreach($e in $files | Where-Object Path -match '\.(motlist|motpack)\.'){[DeepAudit]::Write($e.File,('E:/CodexPepo/RE_Research/reports/phase2/parsed/'+[IO.Path]::GetFileName($e.Path)+'.json'))}
[DeepAudit]::SaveNames('E:/CodexPepo/RE_Research/reports/phase2/bone_names.json')
foreach($e in $files | Where-Object Path -match '\.(jmap|motfsm2)\.'){[DeepAudit]::Write($e.File,('E:/CodexPepo/RE_Research/reports/phase2/parsed/'+[IO.Path]::GetFileName($e.Path)+'.json'))}
'parsed successfully'
