// Exports the Leon TPS handgun 3C source data used by web-3c:
//   reports/web-3c/source-data/leon-3c-source.json  (motion trees, user variables, character and weapon configuration, clip root speeds)
//   docs/player/motions-extra.js                      (extra decoded clips, same format as docs/player/motions.js; personal research)
using System.Collections;
using System.Numerics;
using System.Text.Json;
using ReeLib;
using ReeLib.Common;
using ReeLib.Mot;
using ReeLib.MotTree;

const string Repo = "E:/CodexPepo/RE_Research";
Directory.SetCurrentDirectory(Repo);
ResourceRepository.LocalResourceRepositoryFolder = Repo + "/references/reelib-cache";
ResourceRepository.DisableOnlineUpdater = true;
var parser = new RszParser("references/rszre9.json");
parser.ReadPatch("references/rszre9_patch.json");
var option = new RszFileOption(GameName.re9, parser);

var effective = JsonDocument.Parse(File.ReadAllText("reports/phase2/effective_files.json")).RootElement
  .EnumerateArray().ToDictionary(e => e.GetProperty("Path").GetString()!, e => e.GetProperty("File").GetString()!);
string Source(string path) => effective.TryGetValue(path, out var file) ? file : throw new FileNotFoundException(path);
const string Motlist = "natives/stm/animation/ch/ch01/ch0100/motlist/";

// ---------- Motion trees ----------
var treeIds = new HashSet<int> { 2, 4, 6, 7, 21, 30, 101, 110, 111, 120, 121, 122, 123, 124, 125, 128, 140, 141, 142, 143 };
var trees = new List<object>();
using (var f = new MotlistFile(new FileHandler(Source(Motlist + "ch0100_motiontree.motlist.1047")))) {
  if (!f.Read()) throw new Exception("motiontree read failed");
  foreach (var e in f.Motions) {
    if (!treeIds.Contains(e.motNumber) || e.MotFile is not MotTreeFile t) continue;
    trees.Add(new {
      id = e.motNumber, name = t.Name,
      nodes = t.Nodes.Select((n, i) => new {
        index = i, type = n.TypeInfo?.classShortname ?? n.typeName, label = n.name, kind = n.nodeType.ToString(),
        parameters = n.Parameters.ToDictionary(p => p.name ?? p.hash.ToString(), p => p.value is byte[] bytes ? $"<{bytes.Length} bytes>" : p.value),
      }),
      links = t.Links.Select(l => new { type = l.type.ToString(), from = l.inputNodeIndex, fromPin = l.inputPinNo, to = l.outputNodeIndex, toPin = l.outputPinNo }),
    });
  }
}

// ---------- User variables ----------
object[] UserVariables(string path) {
  using var u = new UVarFile(new FileHandler(Source(path)));
  if (!u.Read()) throw new Exception("uvar read failed");
  return u.Variables.Select((v, i) => (object)new { index = i, name = v.Name, type = v.type.ToString(), value = v.Value?.ToString() }).ToArray();
}
var uvars = UserVariables("natives/stm/appsystem/character/characterprefab/playercommon/uservariables/playercommonmotionuservariables.uvar.3");

// ---------- RSZ user files ----------
object? Val(object? x, int depth = 0) {
  if (x is null) return null;
  if (x is RszInstance i) {
    if (depth > 0) return "#" + i.Index;
    var fields = new Dictionary<string, object?>();
    for (int k = 0; k < i.Values.Length; k++) fields[i.Fields[k].name] = Val(i.Values[k], depth + 1);
    return new { index = i.Index, @class = i.RszClass.name, userdata = i.RSZUserData?.Path, fields };
  }
  if (x is string || x.GetType().IsPrimitive || x is decimal) return x;
  if (x is IEnumerable a) return a.Cast<object?>().Select(v => Val(v, depth)).ToArray();
  return x.ToString();
}
object[] Instances(string file, Func<string, bool> keep) {
  using var f = new UserFile(option, new FileHandler(file));
  if (!f.Read()) throw new Exception("user read failed: " + file);
  return f.RSZ.InstanceList.Where(i => i != null && keep(i.RszClass.name)).Select(i => Val(i)!).ToArray();
}
const string Cp = "natives/stm/gameassets/character/characterprefab/cp_a0/cp_a000/userdata/";
const string Common = "natives/stm/appsystem/character/characterprefab/playercommon/userdata/";
var keepConfig = (string c) => c.StartsWith("app.PlayerRotateConfiguration") || c.StartsWith("app.PlayerRotateCorrectorBySpeed") ||
  c.StartsWith("app.PlayerLocomotionSetting") || c.StartsWith("app.MoveIntensityConfiguration") || c.StartsWith("app.PlayerInputConfiguration") ||
  c == "via.AnimationCurve" || c == "app.DampingParam";
var configuration = new Dictionary<string, object> {
  ["cp_a000configuration"] = Instances(Source(Cp + "cp_a000configuration.user.3"), keepConfig),
  ["cp_a000upperrotatestatedata"] = Instances(Source(Cp + "cp_a000upperrotatestatedata.user.3"), _ => true),
  ["cp_a000iklookatposture_holding"] = Instances(Source(Cp + "lookat/cp_a000iklookatposture_holding.user.3"), _ => true),
  ["playercommonmovementunituserdata"] = Instances(Source(Common + "playercommonmovementunituserdata.user.3"), _ => true),
};
var weaponFile = Directory.GetFiles("runtime/web-3c-wp0111.tmp/source", "arm0000parameter.user.3", SearchOption.AllDirectories).FirstOrDefault();
object weapon = weaponFile == null ? "missing runtime/web-3c-wp0111.tmp/source/**/arm0000parameter.user.3" :
  Instances(weaponFile, c => c.Contains("Camera") || c.Contains("Reticle") || c.Contains("ShootData") || c == "via.AnimationCurve");

// ---------- Extra clips ----------
// Five decimals keep 0.01 mm and ~1e-5 quaternion precision while roughly halving the file.
float R(float x) => MathF.Round(x, 5);
float[] V(Vector3 v) => [R(v.X), R(v.Y), R(v.Z)];
float[] Q(Quaternion q) { q = Quaternion.Normalize(q); return [R(q.X), R(q.Y), R(q.Z), R(q.W)]; }
object? Track(Track? t, bool rotation = false) {
  if (t == null) return null;
  float[][]? values = rotation ? t.rotations?.Select(Q).ToArray() : t.translations?.Select(V).ToArray();
  if (values == null || values.Length == 0) return null;
  var fps = t.frameRate > 0 ? t.frameRate : 60;
  var times = Enumerable.Range(0, values.Length).Select(i => R((t.frameIndexes is { Length: > 0 } ? t.frameIndexes[Math.Min(i, t.frameIndexes.Length - 1)] : i) / (float)fps)).ToArray();
  if (values.SelectMany(x => x).Any(x => !float.IsFinite(x))) throw new Exception("Non-finite track");
  return new { times, values };
}
var starts = Enumerable.Range(2000, 8).Concat(Enumerable.Range(2020, 8));
var ends = Enumerable.Range(2500, 8).Concat(Enumerable.Range(2520, 8));
var wanted = new Dictionary<string, (int bank, HashSet<int> ids)> {
  ["ch0100_handgun00h.motlist.1047"] = (100, [141, 145, 158, 159, 1040, 5000, 5001, 5002, 5003, 5004]),
  ["ch0100_handgun00m.motlist.1047"] = (200, [0, 1, 310, 311, 312, 313, 314, 315, 2200, 2201, 2202, 2203, 2270, 5100, 5101, 5102, 5103, 5104,
    .. starts, .. ends]),
  // Weapon wp0100 (arm0000) own clips, bank 9100 in the web data: default, shoot, reload.
  ["wp0100.motlist.1047"] = (9100, [0, 1100, 1200]),
};
string MotlistSource(string list) => list.StartsWith("wp0100")
  ? Directory.GetFiles("runtime/web-3c-wp0111.tmp/source", "wp0100.motlist.1047", SearchOption.AllDirectories).Single()
  : Source(Motlist + list);
var clips = new List<object>();
var speeds = new List<object>();
foreach (var (list, (bank, ids)) in wanted) {
  using var f = new MotlistFile(new FileHandler(MotlistSource(list)));
  if (!f.Read()) throw new Exception("read failed " + list);
  foreach (var entry in f.Motions) {
    if (!ids.Contains(entry.motNumber) || entry.MotFile is not MotFile m) continue;
    if (clips.Any(c => ((dynamic)c).bank == bank && ((dynamic)c).id == entry.motNumber)) continue;
    if (bank == 9100) { clips.Add(WeaponClip(entry.motNumber, m, list)); continue; }
    var bones = m.Bones;
    var tracks = m.BoneClips.Where(c => bones.Any(b => b.boneHash == c.ClipHeader.boneHash)).Select(c => new {
      bone = bones.FindIndex(b => b.boneHash == c.ClipHeader.boneHash),
      position = Track(c.Translation), rotation = Track(c.Rotation, true), scale = Track(c.Scale),
    }).ToArray();
    var duration = m.Header.frameCount / Math.Max(1f, m.Header.FrameRate);
    clips.Add(new {
      id = entry.motNumber, bank, name = m.Header.motName, additive = false, frames = m.Header.frameCount, fps = m.Header.FrameRate,
      duration, source = list.StartsWith("wp0100") ? "natives/stm/animation/wp/wp01/wp0100/motlist/" + list : Motlist + list,
      bones = bones.Select(b => new { name = b.boneName, parent = b.Parent == null ? -1 : bones.IndexOf(b.Parent), position = V(b.translation), rotation = Q(b.quaternion) }).ToArray(),
      tracks,
    });
    var root = m.BoneClips.FirstOrDefault(c => bones.FirstOrDefault(b => b.boneHash == c.ClipHeader.boneHash)?.boneName == "root")?.Translation?.translations;
    var travel = root is { Length: > 1 } ? root[^1] - root[0] : Vector3.Zero;
    speeds.Add(new { bank, id = entry.motNumber, name = m.Header.motName, duration, rootTravel = V(travel), horizontalMps = duration > 0 ? Math.Sqrt(travel.X * travel.X + travel.Z * travel.Z) / duration : 0 });
    Console.WriteLine($"{bank}/{entry.motNumber} {m.Header.motName} {duration:0.###}s travel {travel}");
  }
}
// Weapon clips carry no skeleton. Bone names come from the skinned weapon export and are matched by hash.
object WeaponClip(int id, MotFile m, string list) {
  var meta = JsonDocument.Parse(File.ReadAllText("runtime/web-3c-weapon.tmp/wp0100.json")).RootElement.GetProperty("skeleton");
  var names = meta.EnumerateArray().Select(b => (name: b.GetProperty("name").GetString()!, parent: b.GetProperty("parent").GetInt32())).ToList();
  var byHash = names.Select((b, i) => (hash: MurMur3HashUtils.GetHash(b.name), i)).ToDictionary(x => x.hash, x => x.i);
  var unmatched = m.BoneClips.Count(c => !byHash.ContainsKey(c.ClipHeader.boneHash));
  if (unmatched > 0) Console.WriteLine($"wp0100/{id}: {unmatched} unmatched bone hashes");
  var tracks = m.BoneClips.Where(c => byHash.ContainsKey(c.ClipHeader.boneHash)).Select(c => new {
    bone = byHash[c.ClipHeader.boneHash], position = Track(c.Translation), rotation = Track(c.Rotation, true), scale = Track(c.Scale),
  }).ToArray();
  var duration = m.Header.frameCount / Math.Max(1f, m.Header.FrameRate);
  Console.WriteLine($"9100/{id} {m.Header.motName}: {tracks.Length} weapon tracks");
  return new {
    id, bank = 9100, name = m.Header.motName, additive = false, frames = m.Header.frameCount, fps = m.Header.FrameRate, duration,
    source = "natives/stm/animation/wp/wp01/wp0100/motlist/" + list, bindFromModel = true,
    bones = names.Select(b => new { b.name, b.parent, position = new float[] { 0, 0, 0 }, rotation = new float[] { 0, 0, 0, 1 } }).ToArray(),
    tracks,
  };
}

// Existing four aimed loops for comparison.
using (var f = new MotlistFile(new FileHandler(Source(Motlist + "ch0100_handgun00h.motlist.1047")))) {
  f.Read();
  foreach (var entry in f.Motions) {
    if (entry.motNumber is not (120 or 122 or 124 or 126) || entry.MotFile is not MotFile m) continue;
    var root = m.BoneClips.First(c => m.Bones.First(b => b.boneHash == c.ClipHeader.boneHash).boneName == "root").Translation!.translations!;
    var travel = root[^1] - root[0];
    var duration = m.Header.frameCount / Math.Max(1f, m.Header.FrameRate);
    speeds.Add(new { bank = 100, id = entry.motNumber, name = m.Header.motName, duration, rootTravel = V(travel), horizontalMps = duration > 0 ? Math.Sqrt(travel.X * travel.X + travel.Z * travel.Z) / duration : 0 });
  }
}

var options = new JsonSerializerOptions { WriteIndented = true };
Directory.CreateDirectory("reports/web-3c/source-data");
File.WriteAllText("reports/web-3c/source-data/leon-3c-source.json", JsonSerializer.Serialize(new {
  version = 1, generatedBy = "scripts/web-3c/Leon3CExport",
  note = "Static values read from the local RE9 extraction. Field semantics are unverified unless stated in reports/web-3c/character-camera-fidelity.md.",
  motionTrees = trees, userVariables = uvars, configuration, weaponArm0000 = weapon, clipRootSpeeds = speeds,
}, options));
var json = JsonSerializer.Serialize(new { version = 1, character = "ch0100 / Leon (extra clips) + wp0100", clips });
File.WriteAllText("docs/player/motions-extra.js", "window.MOTION_EXTRA_DATA=" + json + ";");
Console.WriteLine($"Trees {trees.Count}, user variables {uvars.Length}, extra clips {clips.Count}");