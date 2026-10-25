-- SPDX-License-Identifier: MIT
-- SOURCE-ONLY diagnostic derivative: constant progress only; no exception disclosure.
-- Engine-native password bootstrap. UE4SS supplies reflected FString marshaling.
-- No game SDK, offsets, cryptographic keys, remote endpoints, or password logging.
local source = debug.getinfo(1, "S").source
assert(source:sub(1, 1) == "@", "Bootstrap must run from its owned script file")
local directory = source:sub(2):match("^(.*)[/\\][Ss]cripts[/\\][^/\\]+$")
assert(directory, "Unexpected bootstrap installation directory")
local request = directory .. "/request.bin"
local completed, attempts = false, 0
local maximum_value = 4 * 1024 * 1024 -- Existing API request ceiling, not a new short password policy.
local maximum_packet = 14 + maximum_value * 2

local function status(code)
    -- Fixed status codes only: never stringify engine exceptions or return values.
    print("[VoltraPasswordBootstrap] " .. code .. "\n")
end

local function valid_password(value)
    -- Preserve tabs/newlines/DEL and other original string values. Embedded NUL
    -- cannot survive the pinned UE4SS FString c_str() conversion: fail explicitly.
    return #value <= maximum_value and utf8.len(value) ~= nil and not value:find("\0", 1, true)
end

local function decode(body)
    if #body > maximum_packet or body:sub(1, 6) ~= "VSPB1\n" then return nil end
    local result, offset = {}, 7
    for _, name in ipairs({"SetPassword", "SetPlayerPassword"}) do
        if offset + 3 > #body then return nil end
        local length
        length, offset = string.unpack("<I4", body, offset)
        if length ~= 0xffffffff then
            if length > maximum_value or offset + length - 1 > #body then return nil end
            local value = body:sub(offset, offset + length - 1)
            if not valid_password(value) then return nil end
            result[#result + 1] = {name = name, value = value}
            offset = offset + length
        end
    end
    if offset ~= #body + 1 or #result == 0 then return nil end
    return result
end

local function consume()
    status("packet_open_enter")
    local file = io.open(request, "rb")
    status("packet_open_returned")
    if not file then return nil, "request_unavailable" end
    local body = file:read(maximum_packet + 1)
    file:close()
    -- Unlink BEFORE invoking the engine: a failed/partial operation is never replayed.
    -- Lua strings/engine buffers cannot be promised to be securely erased from RAM.
    status("packet_unlink_enter")
    if not os.remove(request) then return nil, "request_unlink_failed" end
    status("packet_unlink_returned")
    status("packet_decode_enter")
    local decoded = decode(body)
    status("packet_decode_returned")
    return decoded, "request_invalid"
end

local function attempt()
    if completed then return end
    attempts = attempts + 1
    status("component_lookup_enter")
    local objects = FindAllOf("CrDedicatedServerSettingsComp") or {}
    status("component_lookup_returned")
    local live = {}
    for _, object in ipairs(objects) do
        status("component_validity_enter")
        local valid = object:IsValid()
        status("component_validity_returned")
        if valid then live[#live + 1] = object end
    end
    if #live > 1 then completed = true; os.remove(request); status("ambiguous_component"); return end
    if #live == 0 then
        if attempts >= 600 then completed = true; os.remove(request); status("component_timeout") end
        return
    end
    -- Do not retain UObject pointers between callbacks/world transitions.
    local object = live[1]
    local values, reason = consume()
    completed = true
    if not values then status(reason); return end
    -- Validate every reflected method before allowing any side effect.
    for _, item in ipairs(values) do
        if item.name == "SetPassword" then status("admin_method_resolve_enter") else status("player_method_resolve_enter") end
        local method = object[item.name]
        status("method_resolve_returned")
        if not method then status("native_method_unavailable"); return end
        status("method_type_enter")
        local function_type = method:type()
        status("method_type_returned")
        if function_type ~= "UFunction" then status("native_method_unavailable"); return end
        status("method_validity_enter")
        local valid_method = method:IsValid()
        status("method_validity_returned")
        if not valid_method then
            status("native_method_unavailable"); return
        end
        item.method = method
    end
    for _, item in ipairs(values) do
        status("invoke_component_validity_enter")
        local still_valid = object:IsValid()
        status("invoke_component_validity_returned")
        if not still_valid then status("component_invalidated"); return end
        -- UE4SS reads the real UFunction/FProperty parameter schema and converts
        -- UTF-8 Lua strings to the engine's FString. No hand-authored params layout.
        if item.name == "SetPassword" then status("admin_call_enter") else status("player_call_enter") end
        object:CallFunction(item.method, item.value)
        status("native_call_returned")
        item.value = nil
    end
    values = nil
    status("methods_returned_pending_native_file_verification")
end

local function guarded_attempt()
    -- Never let UE4SS's automatic error reporter print a password-bearing exception.
    local ok = pcall(attempt)
    if not ok then completed = true; os.remove(request); status("native_call_or_binding_failed") end
    if not completed then
        ExecuteWithDelay(100, function() ExecuteInGameThread(guarded_attempt) end)
    end
end

if type(ExecuteInGameThread) ~= "function" or type(ExecuteWithDelay) ~= "function" or type(FindAllOf) ~= "function" then
    os.remove(request)
    status("required_ue4ss_api_unavailable")
else
    ExecuteInGameThread(guarded_attempt)
end
