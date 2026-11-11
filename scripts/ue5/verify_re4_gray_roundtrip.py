import bpy,json,pathlib,math,hashlib
from mathutils import Vector
ROOT=pathlib.Path(__file__).resolve().parents[2];OUT=ROOT/'runtime/ue5_asset_probe/re4_wp4000';REPORT=ROOT/'reports/ue5'
def snapshot():
    arms=[o for o in bpy.context.scene.objects if o.type=='ARMATURE']; meshes=[o for o in bpy.context.scene.objects if o.type=='MESH']
    assert len(arms)==1 and len(meshes)==1,(len(arms),len(meshes))
    arm=arms[0];mesh=meshes[0]
    points=[mesh.matrix_world@v.co for v in mesh.data.vertices]
    return dict(bones={b.name:{'parent':b.parent.name if b.parent else None,'head':list(arm.matrix_world@b.head_local)} for b in arm.data.bones},vertices=len(mesh.data.vertices),polygons=len(mesh.data.polygons),bounds=[[min(v[i] for v in points) for i in range(3)],[max(v[i] for v in points) for i in range(3)]],armature_name=arm.name,armature_scale=list(arm.scale),unweighted=sum(not any(g.weight>0 for g in v.groups) for v in mesh.data.vertices))
bpy.ops.wm.open_mainfile(filepath=str(OUT/'blender/RE4_Leon_Gray.blend'));before=snapshot()
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
fbx=OUT/'fbx/SK_RE4_Leon_Gray.fbx';bpy.ops.import_scene.fbx(filepath=str(fbx),automatic_bone_orientation=False);after=snapshot()
assert before['bones'].keys()==after['bones'].keys(),'Bone name mismatch'
assert all(v['parent']==after['bones'][k]['parent'] for k,v in before['bones'].items()),'Bone hierarchy mismatch'
max_head=max((Vector(v['head'])-Vector(after['bones'][k]['head'])).length for k,v in before['bones'].items())
max_bound=max(abs(a-b) for x,y in zip(before['bounds'],after['bounds']) for a,b in zip(x,y))
assert before['vertices']==after['vertices'] and before['polygons']==after['polygons'],'Geometry count mismatch'
assert max_head<1e-4 and max_bound<1e-4,(max_head,max_bound)
assert after['unweighted']==0 and after['armature_name']=='Armature'
result=dict(status='PASS_BLENDER_FBX_ROUNDTRIP',bones=len(after['bones']),vertices=after['vertices'],polygons=after['polygons'],roots=[k for k,v in after['bones'].items() if v['parent'] is None],max_joint_head_error=max_head,max_bounds_error=max_bound,bounds=after['bounds'],armature_scale=after['armature_scale'],sha256=hashlib.sha256(fbx.read_bytes()).hexdigest(),ue_verified=False,animation_verified=False)
(REPORT/'re4_gray_model_roundtrip.json').write_text(json.dumps(result,indent=2),encoding='utf8');print(json.dumps(result))
