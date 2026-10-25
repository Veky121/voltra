-- SPDX-License-Identifier: MIT
-- Runs the actual mod in stock Lua. UE4SS/engine calls are explicitly mocked.
local original = assert(arg[1])
local base = assert(arg[2])
local input = assert(io.open(original, 'rb'))
local code = input:read('a'); input:close()
local count = 0
local function packet(a, b)
    local body = 'VSPB1\n'
    for index = 1, 2 do
        local v
        if index == 1 then v = a else v = b end
        body = body .. (v == nil and string.pack('<I4', 0xffffffff) or string.pack('<I4', #v) .. v)
    end
    return body
end
local function run(name, body, options)
    options = options or {}
    local directory = base .. '/' .. name
    -- Test directories created by the hidden runner, not by shell commands here.
    local request = directory .. '/request.bin'
    if body then local f = assert(io.open(request, 'wb')); f:write(body); f:close() end
    local queued, logs, calls, thread = {}, {}, {}, false
    local method = setmetatable({type = function() return 'UFunction' end, IsValid = function() return true end}, {__call=function(_,value) assert(thread);if options.throw then error(value) end;calls[#calls+1]=value end})
    local object = {IsValid = function() return not options.invalid end, SetPassword = method, SetPlayerPassword = method}
    if options.missing then object.SetPlayerPassword = nil end
    function object:CallFunction() error('Legacy object-first route forbidden') end
    local env = setmetatable({
        print = function(value) logs[#logs + 1] = value end,
        ExecuteWithDelay = function(delay, callback)
            assert(delay == 100); queued[#queued + 1] = {callback, false}
        end,
        ExecuteInGameThread = function(callback) queued[#queued + 1] = {callback, true} end,
        FindAllOf = function(class)
            assert(thread and class == 'CrDedicatedServerSettingsComp')
            if options.none then return nil end
            if options.ambiguous then return {object, object} end
            return {object}
        end,
    }, {__index = _G})
    if options.no_api then env.ExecuteInGameThread = false end
    if options.unlink_fail then
        env.os = {remove = function() return nil end}
    end
    local chunk = assert(load(code, '@' .. directory .. '/Scripts/main.lua', 't', env))
    chunk()
    for _ = 1, 1805 do
        local event = table.remove(queued, 1)
        if not event then break end
        thread = event[2]; event[1](); thread = false
    end
    assert(#queued == 0, 'unbounded retry')
    local log = table.concat(logs)
    assert(not log:find('SECRET', 1, true), 'secret logged')
    count = count + 1
    return calls, log, request
end
local function consumed(path)
    local f = io.open(path, 'rb'); if f then f:close() end
    assert(not f, 'request was not consumed')
end
local calls, log, request = run('unicode', packet('SECRET 密碼🔒', 'playeré'))
assert(calls[1] == 'SECRET 密碼🔒' and calls[2] == 'playeré')
assert(log:find('methods_returned_pending_native_file_verification', 1, true)); consumed(request)
calls, log = run('unicode', nil); assert(#calls == 0 and log:find('request_unavailable'))
calls = run('admin_only', packet('SECRET', nil)); assert(#calls == 1)
calls = run('long_original', packet(string.rep('x', 5000), nil)); assert(#calls == 1 and #calls[1] == 5000)
calls = run('explicit_empty', packet('', nil)); assert(#calls == 1 and calls[1] == '')
calls, log, request = run('bad_utf8', packet('\xffSECRET', nil)); assert(#calls == 0); consumed(request)
calls = run('control', packet('SECRET\0', nil)); assert(#calls == 0)
calls = run('allowed_controls', packet('SECRET\t\r\n\127', nil)); assert(calls[1] == 'SECRET\t\r\n\127')
calls = run('truncated', packet('SECRET', nil):sub(1, -2)); assert(#calls == 0)
calls = run('trailing', packet('SECRET', nil) .. 'x'); assert(#calls == 0)
calls = run('oversized', packet(string.rep('x', 4 * 1024 * 1024 + 1), nil)); assert(#calls == 0)
calls = run('no_operations', packet(nil, nil)); assert(#calls == 0)
calls, log, request = run('ambiguous', packet('SECRET', nil), {ambiguous=true}); assert(#calls == 0 and log:find('ambiguous_component')); consumed(request)
calls, log, request = run('timeout', packet('SECRET', nil), {none=true}); assert(#calls == 0 and log:find('component_timeout')); consumed(request)
calls, log = run('missing_method', packet('SECRET', 'SECRET2'), {missing=true}); assert(#calls == 0 and log:find('native_method_unavailable'))
calls, log, request = run('native_exception', packet('SECRET', nil), {throw=true}); assert(#calls == 0 and log:find('native_call_or_binding_failed')); consumed(request)
calls, log = run('unlink_fail', packet('SECRET', nil), {unlink_fail=true}); assert(#calls == 0 and log:find('request_unlink_failed'))
calls, log = run('no_api', packet('SECRET', nil), {no_api=true}); assert(#calls == 0 and log:find('required_ue4ss_api_unavailable'))
calls, log = run('no_request', nil); assert(#calls == 0 and log:find('request_unavailable'))
print('PASS ' .. count .. ' actual-Lua fixtures; engine mocked; no native generation claim')
