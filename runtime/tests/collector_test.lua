local callbacks, stored, fail = {}, {}, false
re={on_frame=function(f) callbacks.frame=f end,on_draw_ui=function(f) callbacks.ui=f end,
    on_script_reset=function(f) callbacks.reset=f end}
json={load_file=function(p) return stored[p] end,
    dump_file=function(p,v) if fail then return false end stored[p]=v return true end}
local function obj(name, methods)
    local td={get_full_name=function() return name end,get_parent_type=function() return nil end}
    function td:get_method(n)
        local fn=methods[n]; if not fn then return nil end
        return {is_static=function() return false end,
            get_num_params=function() return (n=='getLayer' or n=='getComponent(System.Type)') and 1 or 0 end,
            call=function(_,self,...) return fn(...) end}
    end
    function td:get_methods() return {} end
    return {get_type_definition=function() return td end}
end
local manager=nil
sdk={get_managed_singleton=function() return manager end,typeof=function(n) return n end}
local C=dofile('runtime/re9_3c_collector.lua')
assert(C.start()); C.sample()
assert(C.frames[1].status=='player_unavailable')
assert(C.frames[1].layer_count==nil)
assert(C.save())
local layer=obj('via.motion.Layer',{get_MotionID=function() return 1200 end,
    get_MotionBankID=function() return 100 end,get_Frame=function() return 0 end,
    get_Weight=function() error('unsupported getter') end})
local motion=obj('via.motion.Motion',{get_LayerCount=function() return 200 end,getLayer=function() return layer end})
local transform=obj('via.Transform',{get_Position=function() return {x=1,y=2,z=3} end})
local go=obj('via.GameObject',{['getComponent(System.Type)']=function() return motion end,get_Transform=function() return transform end})
local updater=obj('app.Cp_A000Updater',{get_GameObject=function() return go end})
local context=obj('app.PlayerContext',{get_Updater=function() return updater end})
manager=obj('app.CharacterManager',{get_PlayerContextFast=function() return context end})
assert(C.start()); C.sample()
assert(C.frames[1].character_hint=='Leon_candidate')
assert(C.frames[1].position.y==2 and #C.frames[1].layers==16)
assert(C.frames[1].layers[1].get_Frame==0)
assert(C.frames[1].layers[1].get_Weight==nil)
local first=C.session_path
fail=true; assert(not C.save()); assert(C.pending and #C.frames==1)
assert(not C.start())
fail=false; assert(C.save()); assert(not C.pending)
C.limit=2; assert(C.start()); assert(C.session_path~=first)
C.sample(); manager=nil; C.sample()
assert(not C.active and not C.pending and #C.frames==2)
assert(C.frames[2].status=='player_unavailable')
local p=C.probe(); assert(p.objects.updater.type=='unavailable')
assert(C.start()); C.sample(); callbacks.reset(); assert(not C.active)
print('PASS: missing player, bounded layers, zero vs missing, getter error, save retry, unique names, cap, reset')
