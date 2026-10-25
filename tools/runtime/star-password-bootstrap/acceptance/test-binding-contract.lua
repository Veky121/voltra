-- SPDX-License-Identifier: MIT
-- Stock Lua only. Models exact-source binding contracts, never engine execution.
local path, base = assert(arg[1]), assert(arg[2])
local file = assert(io.open(path, 'rb'))
local code = file:read('a'); file:close()
local count = 0
for _, mode in ipairs({'good', 'truthy_missing', 'second_invalid', 'second_resolve_error', 'invoke_error', 'component_invalidated'}) do
    local directory = base .. '/' .. mode
    local request = directory .. '/request.bin'
    local f = assert(io.open(request, 'wb'))
    f:write('VSPB1\n' .. string.pack('<I4', 6) .. 'SECRET' .. string.pack('<I4', 7) .. 'SECRET2'); f:close()
    local queue, logs, calls, validity_checks = {}, {}, {}, 0
    local object, methods = {}, {}
    local thread = false
    for _, name in ipairs({'SetPassword', 'SetPlayerPassword'}) do
        methods[name] = {
            type = function() assert(thread); return 'UFunction' end,
            IsValid = function() assert(thread); return not (mode == 'second_invalid' and name == 'SetPlayerPassword') end,
        }
    end
    -- Exact source returns a truthy RemoteObject userdata for a missing reflected
    -- field, rather than nil. This table models its type behavior only.
    local missing = {type = function() return 'RemoteObject' end}
    setmetatable(object, {__index = function(_, name)
        if mode == 'truthy_missing' and name == 'SetPlayerPassword' then return missing end
        if mode == 'second_resolve_error' and name == 'SetPlayerPassword' then error('SECRET_EXCEPTION') end
        return methods[name]
    end})
    function object:IsValid()
        assert(thread); validity_checks = validity_checks + 1
        return not (mode == 'component_invalidated' and validity_checks > 1)
    end
    function object:CallFunction(method, value)
        assert(thread and self == object)
        -- Verify colon receiver and reflected function order; do not substitute
        -- a direct callable or a guessed native parameter layout.
        assert(method == methods[#calls == 0 and 'SetPassword' or 'SetPlayerPassword'])
        if mode == 'invoke_error' then error(value) end
        calls[#calls + 1] = value
    end
    local env = setmetatable({
        print = function(value) logs[#logs + 1] = value end,
        FindAllOf = function(name) assert(thread and name == 'CrDedicatedServerSettingsComp'); return {object} end,
        ExecuteInGameThread = function(fn) queue[#queue + 1] = fn end,
        ExecuteWithDelay = function() error('Unexpected retry') end,
    }, {__index = _G})
    assert(load(code, '@' .. directory .. '/Scripts/main.lua', 't', env))()
    while #queue > 0 do thread = true; table.remove(queue, 1)(); thread = false end
    local log = table.concat(logs)
    assert(not log:find('SECRET', 1, true), 'Secret leaked')
    local remaining = io.open(request, 'rb'); if remaining then remaining:close() end
    assert(not remaining, 'Packet remains')
    if mode == 'good' then
        assert(#calls == 2 and calls[1] == 'SECRET' and calls[2] == 'SECRET2')
        assert(log:find('methods_returned_pending_native_file_verification', 1, true))
    else
        assert(#calls == 0, 'Partial operation before both methods validated')
        local expected = ({truthy_missing='native_method_unavailable', second_invalid='native_method_unavailable', component_invalidated='component_invalidated'})[mode] or 'native_call_or_binding_failed'
        assert(log:find(expected, 1, true), 'Wrong fixed result')
    end
    count = count + 1
end
print('PASS ' .. count .. ' binding-contract fixtures; stock Lua, engine mocked, no native proof')
