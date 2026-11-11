"""Blender background probe: original RE4 skeleton + gray mesh, no textures/animation."""
import bpy, sys, types, importlib, pathlib, json, math
from mathutils import Vector
ROOT=pathlib.Path(__file__).resolve().parents[2]
OUT=ROOT/'runtime/ue5_asset_probe/re4_wp4000'
REPORT=ROOT/'reports/ue5'
plugin=pathlib.Path(r'G:\_RE9_research\tools\re-mesh-editor')
pkg=types.ModuleType('re_mesh_probe'); pkg.__path__=[str(plugin)];sys.modules[pkg.__name__]=pkg
importer=importlib.import_module('re_mesh_probe.modules.mesh.blender_re_mesh').importREMeshFile
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
manifest=json.loads((REPORT/'re4_wp4000_source_manifest.json').read_text())
options=dict(clearScene=False,importAllLODs=False,createCollections=False,loadMDFData=False,rotate90=True,mergeArmature='',importArmatureOnly=False,importShadowMeshes=False,mergeGroups=False,importBoundingBoxes=False,loadMaterials=False,loadShellFur=False,mdfPath='',loadUnusedTextures=False,loadUnusedProps=False,useBackfaceCulling=False,reloadCachedTextures=False,importBlendShapes=False,importOcclusionMeshes=False)
imports=[]
for path in manifest['mesh_paths'][:3]:
    result=importer(str(OUT/'source'/path),options)
    arms=[o for o in bpy.context.scene.objects if o.type=='ARMATURE']
    if len(arms)!=1: raise RuntimeError('Expected one merged armature: '+str(len(arms)))
    options['mergeArmature']=arms[0].data.name
    imports.append({'path':path,'result':result})
arm=arms[0];arm.name='Armature'
meshes=[o for o in bpy.context.scene.objects if o.type=='MESH']
if not meshes:raise RuntimeError('No mesh')
mat=bpy.data.materials.new('M_RE4_Probe_Gray');mat.diffuse_color=(0.42,0.45,0.49,1)
for obj in meshes:
    obj.data.materials.clear();obj.data.materials.append(mat)
    for p in obj.data.polygons:p.material_index=0
    if not any(m.type=='ARMATURE' and m.object==arm for m in obj.modifiers):raise RuntimeError('Unbound mesh '+obj.name)
# Join visible geometry while preserving the shared armature and all vertex groups.
bpy.ops.object.select_all(action='DESELECT')
for o in meshes:o.select_set(True)
bpy.context.view_layer.objects.active=meshes[0]
bpy.ops.object.join();mesh=bpy.context.object;mesh.name='SK_RE4_Leon_Gray'
coords=[mesh.matrix_world@v.co for v in mesh.data.vertices]
lo=Vector(tuple(min(v[i] for v in coords) for i in range(3)));hi=Vector(tuple(max(v[i] for v in coords) for i in range(3)))
if not all(math.isfinite(x) for v in coords for x in v):raise RuntimeError('Nonfinite vertex')
bone_names={b.name for b in arm.data.bones}
unknown=[g.name for g in mesh.vertex_groups if g.name not in bone_names]
if unknown: raise RuntimeError('Unknown weight bones: '+str(unknown))
zero=sum(not any(g.weight>0 for g in v.groups) for v in mesh.data.vertices)
if zero:raise RuntimeError('Unweighted vertices: '+str(zero))
(OUT/'fbx').mkdir(exist_ok=True);(OUT/'blender').mkdir(exist_ok=True)
bpy.context.scene.unit_settings.system='METRIC';bpy.context.scene.unit_settings.scale_length=1.0
bpy.ops.object.select_all(action='DESELECT');mesh.select_set(True);arm.select_set(True);bpy.context.view_layer.objects.active=arm
fbx=OUT/'fbx/SK_RE4_Leon_Gray.fbx'
bpy.ops.export_scene.fbx(filepath=str(fbx),use_selection=True,object_types={'ARMATURE','MESH'},add_leaf_bones=False,use_armature_deform_only=False,bake_anim=False,axis_forward='-Y',axis_up='Z',apply_unit_scale=True,apply_scale_options='FBX_SCALE_UNITS',path_mode='AUTO')
# Save source scene, including bone hierarchy, before adding preview-only objects.
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'blender/RE4_Leon_Gray.blend'))
report=dict(blender=bpy.app.version_string,route='existing RE Mesh Editor -> Blender FBX (fallback; no ReExtractor full build)',imports=imports,mesh_vertices=len(mesh.data.vertices),mesh_polygons=len(mesh.data.polygons),bones=len(arm.data.bones),root_bones=[b.name for b in arm.data.bones if not b.parent],bounds_min=list(lo),bounds_max=list(hi),max_influences=max(len(v.groups) for v in mesh.data.vertices),unweighted_vertices=zero,fbx=str(fbx),ue_verified=False)
(REPORT/'re4_gray_model_export.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
# Orthographic preview.
center=(lo+hi)/2; extent=max(hi-lo)
bpy.ops.object.camera_add(location=center+Vector((extent*0.4,-extent*2.0,extent*0.25)))
cam=bpy.context.object;cam.rotation_euler=(center-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=extent*1.25;bpy.context.scene.camera=cam
scene=bpy.context.scene;scene.render.engine='BLENDER_WORKBENCH';scene.display.shading.light='STUDIO';scene.display.shading.color_type='MATERIAL';scene.display.shading.show_shadows=True;scene.display.shading.show_cavity=True;scene.display.shading.background_type='WORLD';scene.world.color=(0.08,0.08,0.08)
scene.render.resolution_x=900;scene.render.resolution_y=1100;scene.render.resolution_percentage=100;scene.render.filepath=str(REPORT/'re4_gray_model_preview.png');bpy.ops.render.render(write_still=True)
print('PROBE_MODEL_OK '+json.dumps(report,ensure_ascii=False))

