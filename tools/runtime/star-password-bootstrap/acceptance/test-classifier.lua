-- MIT. Actual Lua execution; no UE4SS or native call. Errors never leave memory.
local input=assert(io.open(assert(arg[1]),'rb'));local code=input:read('a');input:close()
local source='@/owned/VoltraClassifiedTrace/Scripts/main.lua'
local start=assert(code:find('local function classify_binding_error',1,true))
local finish=assert(code:find('local function guarded_attempt()',start,true))
local classifier=assert(load('local source=...\n'..code:sub(start,finish-1)..'\nreturn classify_binding_error','@offline-classifier','t',_G))(source)
local cases={
    {'[UFunction::setup_metamethods -> __call] Attempted to call a UFunction without UFunction userdata attached','binding_error_missing_userdata'},
    {'[UFunction::call_ufunction_from_lua] Tried calling function without both UFunction and calling context','binding_error_no_context'},
    {'[UFunction::setup_metamethods -> __call] UFunction expected 1 parameters, received 2','binding_error_parameter_count_mismatch'},
    {"Tried storing reference to a Lua table for an 'Out' parameter when calling a UFunction but no table was on the stack",'binding_error_out_parameter_requires_table'},
    {"Tried calling UFunction without a registered handler for parameter. Parameter 'SECRET' of type 'SECRET' not supported.",'binding_error_unsupported_parameter_property'},
    {"Tried calling UFunction without a registered handler 'Out' param. Type 'SECRET' not supported.",'binding_error_unsupported_out_property'},
    {"Tried calling UFunction without a registered handler for return value. Return value of type 'SECRET' not supported.",'binding_error_unsupported_return_property'},
    {'[push_strproperty] Error:\n StrProperty can only be set to a string or FString\n    SECRET','binding_error_invalid_string_type'},
    {'[push_strproperty] Error:\n data pointer is nullptr\n    SECRET','binding_error_string_storage_null'},
    {'[push_strproperty] Error:\n Unhandled Operation\n    SECRET','binding_error_string_operation_unsupported'},
    {'[push_strproperty] Error:\n Operation not supported\n    SECRET','binding_error_string_operation_unsupported'},
}
local count=0
for _,row in ipairs(cases) do
    assert(classifier(row[1])==row[2]);count=count+1
    assert(classifier(source:sub(2)..':123: '..row[1])==row[2]);count=count+1
    -- Incidental tokens inside arbitrary data are never classified.
    assert(classifier('SECRET arbitrary '..row[1])=='binding_error_unknown');count=count+1
end
for _,value in ipairs({false,123,{},setmetatable({},{__tostring=function() error('Stringification forbidden') end}),'SECRET','[push_strproperty] Error:\n SECRET','SECRET'..string.rep('x',70000)}) do
    assert(classifier(value)=='binding_error_unknown');count=count+1
end
assert(classifier(nil)=='binding_error_unknown');count=count+1
assert(classifier(string.rep('x',513)..cases[1][1])=='binding_error_unknown');count=count+1

-- Execute actual guarded attempt with a mocked engine whose invocation raises
-- the pinned arity error plus sentinel-bearing content. Assert literal-only log.
local queue,logs={},{}
local method={type=function()return'UFunction'end,IsValid=function()return true end}
local object={IsValid=function()return true end,SetPassword=method}
object.CallFunction=function()error(cases[3][1]..' SECRET_PAYLOAD',0)end
local packet='VSPB1\n'..string.pack('<I4',6)..'SECRET'..string.pack('<I4',0xffffffff)
local env=setmetatable({
    print=function(v)logs[#logs+1]=v end,
    io={open=function()return{read=function()return packet end,close=function()end}end},
    os={remove=function()return true end},
    FindAllOf=function()return{object}end,
    ExecuteInGameThread=function(fn)queue[#queue+1]=fn end,
    ExecuteWithDelay=function()error('Unexpected retry')end,
},{__index=_G})
assert(load(code,source,'t',env))()
while #queue>0 do table.remove(queue,1)() end
local text=table.concat(logs)
assert(text:find('admin_call_enter',1,true))
assert(text:find('binding_error_parameter_count_mismatch',1,true))
assert(text:find('native_call_or_binding_failed',1,true))
assert(not text:find('SECRET',1,true))
assert(not text:find('UFunction expected',1,true))
assert(not text:find('native_call_returned',1,true))
count=count+1
print('PASS '..count..' classifier cases; actual Lua, engine mocked, no raw error output')
