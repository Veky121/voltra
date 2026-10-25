-- MIT. Actual stock-Lua execution; all UE4SS/engine APIs explicitly mocked.
local readonly_path, trace_path, base = assert(arg[1]), assert(arg[2]), assert(arg[3])
local function source(path) local f=assert(io.open(path,'rb'));local s=f:read('a');f:close();return s end
local readonly, traced = source(readonly_path), source(trace_path)
local count = 0
local function run(name, code, options)
    options=options or {}
    local queue, log, thread, calls = {}, {}, false, 0
    local function fail(point) if options.fail==point then error('SECRET_IN_EXCEPTION_NEVER_PRINT') end end
    local method = {
        type=function() assert(thread);fail('type');return options.wrong_type and 'NotAFunction' or 'UFunction' end,
        IsValid=function() assert(thread);fail('method_validity');return not options.invalid_method end,
    }
    setmetatable(method,{__call=function() assert(thread);calls=calls+1;fail('invoke') end})
    local object=setmetatable({
        IsValid=function() assert(thread);fail('validity');return true end,
        CallFunction=function() error('Legacy object-first route forbidden') end,
    },{__index=function(_,key)
        if key=='SetPassword' or key=='SetPlayerPassword' then
            fail('resolve');if options.missing then return nil end;return method
        end
    end,__tostring=function() error('Object stringification forbidden') end})
    local env=setmetatable({
        print=function(value) log[#log+1]=value end,
        ExecuteWithDelay=function(delay,fn) assert(delay==100);queue[#queue+1]={fn,false} end,
        ExecuteInGameThread=function(fn) queue[#queue+1]={fn,true} end,
        FindAllOf=function(class)
            assert(thread and class=='CrDedicatedServerSettingsComp');fail('lookup')
            if options.none then return {} end
            if options.ambiguous then return {object,object} end
            return {object}
        end,
    },{__index=_G})
    if code==readonly then
        env.io=setmetatable({},{__index=function() error('Read-only probe attempted packet I/O') end})
        env.os=setmetatable({},{__index=function() error('Read-only probe attempted filesystem mutation') end})
    end
    if options.no_api then env.FindAllOf=false end
    local path=base..'/'..name..'/Scripts/main.lua'
    if code==traced then
        local packet='VSPB1\n'..string.pack('<I4',6)..'SECRET'..string.pack('<I4',0xffffffff)
        local file=assert(io.open(base..'/'..name..'/request.bin','wb'));file:write(packet);file:close()
    end
    assert(load(code,'@'..path,'t',env))()
    for _=1,1805 do
        local step=table.remove(queue,1);if not step then break end
        thread=step[2];step[1]();thread=false
    end
    assert(#queue==0,'Unbounded scheduling')
    local text=table.concat(log)
    assert(not text:find('SECRET',1,true),'Secret/exception leaked')
    if code==readonly then assert(calls==0,'Read-only probe invoked native UFunction') end
    count=count+1
    return text,calls
end
local text=run('readonly_good',readonly)
assert(text:find('read_only_surface_complete_not_native_call_proof',1,true))
local stages={lookup={'component_lookup_enter','component_lookup_returned'},validity={'component_validity_enter','component_validity_returned'},resolve={'admin_method_resolve_enter','method_resolve_returned'},type={'method_type_enter','method_type_returned'},method_validity={'method_validity_enter','method_validity_returned'}}
for point, pair in pairs(stages) do
    text=run('readonly_'..point,readonly,{fail=point})
    assert(text:find(pair[1],1,true) and not text:find(pair[2],1,true))
    assert(text:find('read_only_binding_failed',1,true))
    text=run('trace_'..point,traced,{fail=point})
    assert(text:find(pair[1],1,true) and not text:find(pair[2],1,true))
    assert(text:find('native_call_or_binding_failed',1,true))
    if point=='lookup' or point=='validity' then
        assert(not text:find('packet_decode_returned',1,true))
        local request=io.open(base..'/trace_'..point..'/request.bin','rb')
        assert(not request,'Error-path unlink did not occur')
    end
end
text=run('trace_invoke',traced,{fail='invoke'})
assert(text:find('admin_call_enter',1,true) and not text:find('native_call_returned',1,true))
assert(text:find('packet_unlink_returned',1,true) and text:find('packet_decode_returned',1,true))
for _,case in ipairs({{'none','component_timeout'},{'ambiguous','ambiguous_component'},{'missing','method_absent'},{'wrong_type','method_type_unexpected'},{'invalid_method','method_invalid'},{'no_api','required_ue4ss_api_unavailable'}}) do
    text=run('readonly_'..case[1],readonly,{[case[1]]=true})
    assert(text:find(case[2],1,true))
end
print('PASS '..count..' actual-Lua diagnostic fixtures; engine mocked; read-only/no native proof')
