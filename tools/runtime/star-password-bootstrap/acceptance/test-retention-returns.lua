-- MIT. Execute actual candidate with mocked native calls and real Lua GC.
local file=assert(io.open(assert(arg[1]),'rb'));local code=file:read('a');file:close()
local count=0
for _,mode in ipairs({'good','invalid_second','second_resolve_error','invoke_error'}) do
    collectgarbage('collect')
    local calls,finalized,logs,queue=0,0,{},{}
    local function returned()
        return setmetatable({}, {__gc=function()finalized=finalized+1 end,__tostring=function()error('Return stringification forbidden')end})
    end
    local methods={}
    for _,name in ipairs({'SetPassword','SetPlayerPassword'}) do
        methods[name]=setmetatable({type=function()return'UFunction'end,IsValid=function()return not(mode=='invalid_second' and name=='SetPlayerPassword')end},{__call=function(_,value)
            calls=calls+1
            if mode=='invoke_error' then error('SECRET_FROM_NATIVE',0) end
            if calls==2 then collectgarbage('collect');assert(finalized==0,'Admin returns collected before player invocation')end
            if calls==1 then return returned(),nil,returned() end
            return returned(),returned()
        end})
    end
    local object=setmetatable({IsValid=function()return true end,CallFunction=function()error('Legacy wrong route')end},{__index=function(_,name)
        if mode=='second_resolve_error' and name=='SetPlayerPassword' then error('SECRET_RESOLVE',0) end
        return methods[name]
    end})
    local packet='VSPB1\n'..string.pack('<I4',6)..'SECRET'..string.pack('<I4',7)..'SECRET2'
    local env=setmetatable({
        print=function(message)
            logs[#logs+1]=message
            if message:find('native_call_returned',1,true) or message:find('methods_returned_pending_native_file_verification',1,true) or message:find('native_returns_retained_through_safe_marker',1,true) then
                collectgarbage('collect');assert(finalized==0,'Returns collected before safe output marker')
            elseif message:find('native_return_refs_released',1,true) then
                collectgarbage('collect');assert(finalized==4,'All multiple returns were not released after safe marker')
            end
        end,
        io={open=function()return{read=function()return packet end,close=function()end}end},
        os={remove=function()return true end},
        FindAllOf=function()return{object}end,
        ExecuteInGameThread=function(fn)queue[#queue+1]=fn end,
        ExecuteWithDelay=function()error('Unexpected retry')end,
    },{__index=_G})
    assert(load(code,'@/owned/VoltraReturnRetentionProbe/Scripts/main.lua','t',env))()
    while #queue>0 do table.remove(queue,1)() end
    local text=table.concat(logs)
    assert(not text:find('SECRET',1,true),'Secret leaked')
    if mode=='good' then
        assert(calls==2 and finalized==4)
        assert(text:find('methods_returned_pending_native_file_verification',1,true)<text:find('native_return_refs_released',1,true))
    elseif mode=='invoke_error' then assert(calls==1 and text:find('native_call_or_binding_failed',1,true))
    else assert(calls==0,'Method validation allowed partial setters') end
    count=count+1
end
print('PASS '..count..' actual Lua retained-multiple-return/GC cases; engine mocked, no crash cause proof')
