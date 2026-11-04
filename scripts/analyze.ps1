$ErrorActionPreference='Stop'
function U64($b,$o){[BitConverter]::ToInt64($b,$o)}
function U32($b,$o){[BitConverter]::ToUInt32($b,$o)}
function W($b,$o){if($o -le 0){return ''};$end=$o;while($end+1 -lt $b.Length -and ($b[$end] -ne 0 -or $b[$end+1] -ne 0)){$end+=2};[Text.Encoding]::Unicode.GetString($b,$o,$end-$o)}
$lists=@();$motions=@();$banks=@()
$files=Get-ChildItem reports/samples -Recurse -File | Sort-Object FullName
foreach($f in $files){$b=[IO.File]::ReadAllBytes($f.FullName);$rel=$f.FullName.Substring((Resolve-Path reports/samples).Path.Length+1)
if($f.Name -match '\.motlist\.'){if((U32 $b 4) -ne 0x74736c6d){throw 'bad magic'};$n=U32 $b 56;$ptr=U64 $b 16;$idx=U64 $b 24;$pack=U64 $b 48;$packpath=if($pack){W $b (U64 $b $pack)}else{''}
$lists += [pscustomobject]@{File=$rel;Name=(W $b (U64 $b 32));Count=$n;Base=(W $b (U64 $b 40));Motpack=$packpath}
for($i=0;$i -lt $n;$i++){ $off=U64 $b ($ptr+8*$i);$j=$idx+72*$i;$name='';$frames='';$fps='';$tracks='';$kind='empty';if($off){$ver=U32 $b $off;$magic=U32 $b ($off+4);$kind=('{0:X8}' -f $magic);if($ver -eq 1){$kind='link';$name=W $b ($off+4)}elseif($magic -eq 0x20746f6d){$kind='mot';$name=W $b ($off+(U64 $b ($off+88)));$frames=[BitConverter]::ToSingle($b,$off+96);$fps=[BitConverter]::ToUInt16($b,$off+120);$tracks=[BitConverter]::ToUInt16($b,$off+114)}}
$motions += [pscustomobject]@{File=$rel;Slot=$i;ID=[BitConverter]::ToUInt16($b,$j+8);Switch=[BitConverter]::ToUInt16($b,$j+10);Mask=(U32 $b ($j+12));Flags=$b[$j+21];Kind=$kind;Name=$name;Frames=$frames;FPS=$fps;BoneTracks=$tracks}
}
}else{if((U32 $b 4) -ne 0x6b6e626d){throw 'bad bank'};$n=U32 $b 40;$ptr=U64 $b 16;for($i=0;$i -lt $n;$i++){$j=$ptr+$i*24;$banks += [pscustomobject]@{File=$rel;ID=(U32 $b ($j+8));Type=(U32 $b ($j+12));Path=(W $b (U64 $b $j));Jmap=(W $b (U64 $b 32))}}}
}
$lists | Export-Csv reports/lists.csv -NoTypeInformation -Encoding utf8
$motions | Export-Csv reports/motions.csv -NoTypeInformation -Encoding utf8
$banks | Export-Csv reports/banks.csv -NoTypeInformation -Encoding utf8
"Lists=$($lists.Count) Motions=$($motions.Count) BankRefs=$($banks.Count)"
$motions | Group-Object Kind | Select-Object Name,Count
$motions | Where-Object Name -match 'start|stop|reload|walk|run' | Select-Object -First 18 Name,Frames,FPS,BoneTracks
$lists | Where-Object Base | Select-Object -First 5 Name,Base

