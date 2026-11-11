using ReeLib; using ReeLib.Common; using ReeLib.Mot; using System.Numerics; using System.Text.Json; using System.Security.Cryptography;
if(args.Length != 1) throw new ArgumentException("Pass research root");
var root=Path.GetFullPath(args[0]);
var source="natives/stm/_chainsaw/animation/ch/cha0/motlist/cha0_wp4000h.motlist.663";
var input=Path.Combine(root,"runtime/ue5_asset_probe/re4_wp4000/source",source);
var output=Path.Combine(root,"runtime/ue5_asset_probe/re4_wp4000/decoded"); Directory.CreateDirectory(output);
float[] V(Vector3 v)=>[v.X,v.Y,v.Z];
float[] Q(Quaternion q) { if(q.LengthSquared()<1e-12f)throw new Exception("Zero quaternion"); q=Quaternion.Normalize(q);return [q.X,q.Y,q.Z,q.W]; }
object? TrackData(Track? t,bool rot=false){
 if(t==null)return null;
 var values=rot?t.rotations?.Select(Q).ToArray():t.translations?.Select(V).ToArray();
 if(values==null||values.Length==0)return null;
 if(values.SelectMany(x=>x).Any(x=>!float.IsFinite(x)))throw new Exception("Nonfinite track");
 if(t.frameIndexes is {Length:>0} && t.frameIndexes.Length!=values.Length)throw new Exception("Timestamp/sample length mismatch");
 var fps=t.frameRate>0?t.frameRate:60;
 var times=Enumerable.Range(0,values.Length).Select(i=>(t.frameIndexes is {Length:>0}?t.frameIndexes[i]:i)/(float)fps).ToArray();
 if(times.Zip(times.Skip(1),(a,b)=>b>=a).Any(x=>!x))throw new Exception("Nonmonotonic times");
 return new{times,values,trackFPS=t.frameRate,fallbackFPSUsed=t.frameRate<=0};
}
using var list=new MotlistFile(new FileHandler(input)); if(!list.Read())throw new Exception("Read false");
var modelBones=new Dictionary<uint,string>();
foreach(var part in new[]{"00","10","20"}){
 var path=Path.Combine(root,$"runtime/ue5_asset_probe/re4_wp4000/source/natives/stm/_chainsaw/character/ch/cha0/cha000/{part}/cha000_{part}.mesh.221108797");
 using var mesh=new MeshFile(new FileHandler(path));if(!mesh.Read())throw new Exception("Mesh read failed");
 foreach(var bone in mesh.BoneData!.Bones){var hash=MurMur3HashUtils.GetHash(bone.name);if(modelBones.TryGetValue(hash,out var previous)&&previous!=bone.name)throw new Exception("Bone hash collision");modelBones[hash]=bone.name;}
}
var wanted=new HashSet<int>{140,141,158,159,160,165,167,403,500,501,502};var reports=new List<object>();var seen=new HashSet<int>();
foreach(var e in list.Motions){
 if(!wanted.Contains(e.motNumber))continue;
 if(e.MotFile is not MotFile m)throw new Exception("Not a local MOT: "+e.motNumber);
 if(!seen.Add(e.motNumber))throw new Exception("Ambiguous motion ID");
 var bones=m.Bones; var hashes=bones.Select(b=>b.boneHash).ToHashSet();
 var unmapped=m.BoneClips.Where(c=>!hashes.Contains(c.ClipHeader.boneHash) && !modelBones.ContainsKey(c.ClipHeader.boneHash)).Select(c=>c.ClipHeader.boneHash).ToArray();
 var tracks=m.BoneClips.Select(c=>new{boneHash=c.ClipHeader.boneHash,boneName=modelBones.GetValueOrDefault(c.ClipHeader.boneHash) ?? bones.FirstOrDefault(b=>b.boneHash==c.ClipHeader.boneHash)?.boneName,bone=bones.FindIndex(b=>b.boneHash==c.ClipHeader.boneHash),position=TrackData(c.Translation),rotation=TrackData(c.Rotation,true),scale=TrackData(c.Scale)}).ToArray();
 var name=$"RE4_wp4000H_{e.motNumber:D4}.json";
 var clip=new{source,sourceSHA256=Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(input))).ToLowerInvariant(),id=e.motNumber,e.Switch,name=m.Header.motName,frames=m.Header.frameCount,fps=m.Header.FrameRate,nominalDurationSeconds=(double)m.Header.frameCount/Math.Max(1,(int)m.Header.FrameRate),unmappedBoneHashes=unmapped,semantics="Raw decoded tracks; no layer composition, IK, retargeting, axis conversion or UE validation",bones=bones.Select(b=>new{name=b.boneName,parent=b.Parent==null?-1:bones.IndexOf(b.Parent),position=V(b.translation),rotation=Q(b.quaternion)}).ToArray(),tracks};
 File.WriteAllText(Path.Combine(output,name),JsonSerializer.Serialize(clip));
 reports.Add(new{id=e.motNumber,name=m.Header.motName,frames=m.Header.frameCount,fps=m.Header.FrameRate,bones=bones.Count,tracks=tracks.Length,unmappedBoneHashes=unmapped,output=name,status=unmapped.Length==0?"DECODED_FINITE_TIMESTAMPS_CHECKED_NOT_PLAYBACK_VERIFIED":"DECODED_WITH_UNRESOLVED_BONE_REFERENCES"});
 Console.WriteLine($"Decoded {e.motNumber}: {bones.Count} bones, {tracks.Length} tracks");
}
if(!wanted.SetEquals(seen))throw new Exception("Missing selected motions");
File.WriteAllText(Path.Combine(root,"reports/ue5/re4_motion_decode_validation.json"),JsonSerializer.Serialize(new{source,baseList=list.Header.BaseMotListPath,clips=reports,ueVerified=false},new JsonSerializerOptions{WriteIndented=true}));

