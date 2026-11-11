-- RE9 research collector v0.1. No hooks, setters, or gameplay modifications.
local C = { active = false, frames = {}, status = 'Ready (runtime fields unverified)',
    limit = 3600, tick = 0, sequence = 0, pending = false }
local VERSION = '0.1.0'
local function attempt(fn)
    local ok, value = pcall(fn)
    if ok then return value end
    return nil
end
local function typename(obj)
    return attempt(function() return obj:get_type_definition():get_full_name() end)
end
-- Only explicitly named read methods are called. Missing/throwing methods stay missing.
local function read(obj, name, ...)
    if not obj then return nil end
    local args = {...}
    return attempt(function()
        local method = obj:get_type_definition():get_method(name)
        if not method or method:is_static() or method:get_num_params() ~= #args then return nil end
        return method:call(obj, table.unpack(args))
    end)
end
local function scalar(obj, name)
    local v = read(obj, name)
    if type(v) == 'number' and v == v and math.abs(v) < math.huge then return v end
    if type(v) == 'boolean' or type(v) == 'string' then return v end
end
local function vector(v)
    return attempt(function()
        if not v then return nil end
        local x,y,z = v.x,v.y,v.z
        if type(x) ~= 'number' or type(y) ~= 'number' or type(z) ~= 'number' then return nil end
        if x~=x or y~=y or z~=z or math.abs(x)==math.huge or math.abs(y)==math.huge or math.abs(z)==math.huge then return nil end
        return {x=x,y=y,z=z}
    end)
end
local function resolve()
    local cm = attempt(function() return sdk.get_managed_singleton('app.CharacterManager') end)
    local pc = read(cm, 'get_PlayerContextFast')
    local updater = read(pc, 'get_Updater')
    local go = read(updater, 'get_GameObject')
    local transform = read(go, 'get_Transform')
    local motion_type = attempt(function() return sdk.typeof('via.motion.Motion') end)
    local motion = motion_type and read(go, 'getComponent(System.Type)', motion_type) or nil
    return {manager=cm, context=pc, updater=updater, game_object=go,
        transform=transform, motion=motion, camera=read(updater, 'getPlayerCameraController')}
end
local function inventory(obj)
    local result = {type=typename(obj) or 'unavailable', methods={}}
    attempt(function()
        local td = obj:get_type_definition()
        local seen = {}
        for depth=1,8 do
            if not td then break end
            for _, m in ipairs(td:get_methods()) do
                local name = m:get_name()
                local key = td:get_full_name() .. ':' .. name .. ':' .. m:get_num_params()
                if not seen[key] then
                    seen[key]=true
                    result.methods[#result.methods+1]={name=name, params=m:get_num_params(),
                        declaring_type=td:get_full_name()}
                end
            end
            td = td:get_parent_type()
        end
    end)
    return result
end
local function unique(prefix)
    repeat
        C.sequence=C.sequence+1
        C.path=prefix .. '_' .. os.date('!%Y%m%dT%H%M%SZ') .. '_' .. C.sequence .. '.json'
    until not json.load_file(C.path)
    return C.path
end
local function dump(path, payload)
    local ok, result=pcall(json.dump_file, path, payload, 2)
    return ok and result == true
end
function C.probe()
    local objects=resolve()
    local report={schema='re9-3c-probe/1',version=VERSION,objects={},
        note='Metadata only; presence of a method does not validate field semantics.'}
    for name,obj in pairs(objects) do report.objects[name]=inventory(obj) end
    for _,name in ipairs({'manager','context','updater','game_object','transform','motion','camera'}) do
        if not report.objects[name] then report.objects[name]={type='unavailable',methods={}} end
    end
    local layer=read(objects.motion,'getLayer',0)
    report.objects.layer0=inventory(layer)
    local path=unique('re9_3c_probe')
    C.status=dump(path, report) and ('Probe saved: '..path) or 'Probe save failed; retry'
    return report
end
function C.start()
    if C.active or C.pending then return false end
    C.frames={}; C.tick=0; C.active=true; C.started=os.date('!%Y-%m-%dT%H:%M:%SZ')
    C.session_path=unique('re9_3c_capture')
    C.status='Recording (max 3600 samples)'
    return true
end
function C.save()
    C.active=false
    if not C.session_path then return false end
    C.pending=true
    local payload={schema='re9-3c-capture/1',version=VERSION,started_utc=C.started,
        clock='sample_index: on_frame callback; unix_seconds: coarse wall clock; no latency measurement',
        field_status={motion='candidate getters; validate with video',position='candidate get_Position',
            ammo='unavailable',input='unavailable',camera='type only; values unavailable'},
        samples=C.frames}
    if dump(C.session_path,payload) then
        C.pending=false; C.status='Saved: '..C.session_path; C.session_path=nil
        return true
    end
    C.status='SAVE FAILED: buffer retained; press Retry save before reset/exit'
    return false
end
function C.sample()
    if not C.active then return end
    C.tick=C.tick+1
    local row={sample_index=C.tick,unix_seconds=os.time(),status='unavailable',layers={}}
    local ok, err=pcall(function()
        local o=resolve()
        row.updater_type=typename(o.updater)
        row.character_hint=row.updater_type == 'app.Cp_A000Updater' and 'Leon_candidate'
            or (row.updater_type == 'app.Cp_A100Updater' and 'Grace_candidate' or 'unknown')
        row.status=o.updater and 'player_found' or 'player_unavailable'
        row.position=vector(read(o.transform,'get_Position'))
        row.camera_type=typename(o.camera)
        row.layer_count=scalar(o.motion,'get_LayerCount')
        -- Try layer zero when count is missing; never infer a count from this fallback.
        local count=type(row.layer_count)=='number' and math.max(0,math.min(16,math.floor(row.layer_count))) or 1
        for i=0,count-1 do
            local layer=read(o.motion,'getLayer',i)
            local r={index=i,status=layer and 'found' or 'unavailable'}
            for _,name in ipairs({'get_MotionID','get_MotionBankID','get_Frame','get_EndFrame','get_Speed','get_Weight'}) do
                r[name]=scalar(layer,name)
            end
            row.layers[#row.layers+1]=r
        end
    end)
    if not ok then row.status='sample_error'; row.error=tostring(err) end
    C.frames[#C.frames+1]=row
    if #C.frames>=C.limit then C.save() end
end
re.on_frame(C.sample)
re.on_draw_ui(function()
    if not imgui.tree_node('RE9 3C Collector v'..VERSION) then return end
    imgui.text(C.status)
    imgui.text('Samples: '..#C.frames..' / '..C.limit)
    imgui.text('Candidate fields only. Missing data is not zero. No ammo/input timing yet.')
    if not C.active and not C.pending and imgui.button('Probe interfaces') then C.probe() end
    if not C.active and not C.pending and imgui.button('Start capture') then C.start() end
    if C.active and imgui.button('Stop and save') then C.save() end
    if C.pending and imgui.button('Retry save') then C.save() end
    imgui.tree_pop()
end)
re.on_script_reset(function() if C.active or C.pending then C.save() end end)
return C
