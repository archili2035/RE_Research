using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using REE.Unpacker;
public class Research {
[UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate UIntPtr ZD(byte[] dst, UIntPtr cap, byte[] src, UIntPtr size); static ZD ZSTD_decompress=Marshal.GetDelegateForFunctionPointer<ZD>(NativeLibrary.GetExport(NativeLibrary.Load(@"E:\CodexPepo\RE_Research\tools\zstd\zstd-v1.5.7-win64\dll\libzstd.dll"),"ZSTD_decompress"));
static byte[] Inflate(byte[] b,int n){ var o=new byte[n];var r=ZSTD_decompress(o,(UIntPtr)n,b,(UIntPtr)b.Length).ToUInt64();if(r>(ulong)n)throw new Exception("zstd error "+r);Array.Resize(ref o,(int)r);return o; }
public static void Run(string game,string list,string output){
Directory.CreateDirectory(output);var names=new Dictionary<ulong,string>();foreach(var p in File.ReadLines(list)){if(!p.Contains("/animation/"))continue;ulong h=((ulong)PakHash.iGetStringHash(p.ToUpperInvariant())<<32)|PakHash.iGetStringHash(p.ToLowerInvariant());names[h]=p;}
using var csv=new StreamWriter(Path.Combine(output,"inventory.tsv"));csv.WriteLine("pak\tpath\tsize\tattributes\textracted");
foreach(var pak in Directory.GetFiles(game,"*.pak").OrderBy(x=>x)){using var f=File.OpenRead(pak);using var r=new BinaryReader(f);if(r.ReadUInt32()!=0x414b504b)throw new Exception();r.ReadUInt16();int flags=r.ReadUInt16();int count=r.ReadInt32();r.ReadUInt32();var table=r.ReadBytes(count*48);table=PakCipher.iDecryptData(table,r.ReadBytes(128));var chunks=new List<(long,int)>();if(flags==40){r.ReadInt32();int nc=r.ReadInt32();for(int j=0;j<nc;j++){uint lo=r.ReadUInt32(),hi=r.ReadUInt32();chunks.Add((lo+((long)(hi&1023)<<32),(int)(hi>>10)));}}
using var tr=new BinaryReader(new MemoryStream(table));int matches=0,ex=0;for(int i=0;i<count;i++){ulong h=tr.ReadUInt64();long off=tr.ReadInt64(),cs=tr.ReadInt64(),ds=tr.ReadInt64(),attr=tr.ReadInt64();tr.ReadUInt64();if(!names.TryGetValue(h,out var name))continue;matches++;bool extract=name.Contains("/ch0100/")&&(name.Contains(".motlist.")||name.Contains(".motbank."))&&ds<30000000;
if(extract){byte[] data;if(flags==40&&(attr&0x1000000)!=0){using var ms=new MemoryStream();long remaining=cs;int idx=(int)off;while(remaining>0){var c=chunks[idx++];f.Position=c.Item1;var b=r.ReadBytes(c.Item2);var d=c.Item2==524288?b:Inflate(b,524288);ms.Write(d);remaining-=c.Item2;}data=ms.ToArray();Array.Resize(ref data,(int)ds);}else {f.Position=off;data=r.ReadBytes((int)cs);if((attr&15)==2)data=Inflate(data,(int)ds);else if((attr&15)!=0)throw new Exception("unsupported compression");}if(data.Length!=ds)throw new Exception("size");string target=Path.Combine(output,"samples",Path.GetFileName(pak),name);Directory.CreateDirectory(Path.GetDirectoryName(target));File.WriteAllBytes(target,data);ex++;}
csv.WriteLine($"{Path.GetFileName(pak)}\t{name}\t{ds}\t{attr:X}\t{extract}");}Console.WriteLine($"{Path.GetFileName(pak)} entries={count} animation={matches} samples={ex}");}
}}


