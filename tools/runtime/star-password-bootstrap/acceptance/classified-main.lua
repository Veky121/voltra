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

-- Classify privately using only exact833 C++ constant prefixes. Never stringify.
local function classify_binding_error(value)
    if type(value) ~= "string" or #value > 65536 then return "binding_error_unknown" end
    local message = value:sub(1, 512)
    -- Lua may add this exact owned chunk location. No generic prefix stripping.
    local owned = source:sub(2) .. ":"
    if message:sub(1, #owned) == owned then
        local tail = message:sub(#owned + 1)
        local _, finish = tail:find("^%d+: ")
        if finish then message = tail:sub(finish + 1) end
    end
    local rules = {
        {"[UFunction::setup_metamethods -> __call] Attempted to call a UFunction without UFunction userdata attached", "binding_error_missing_userdata"},
        {"[UFunction::call_ufunction_from_lua] Tried calling function without both UFunction and calling context", "binding_error_no_context"},
        {"[UFunction::setup_metamethods -> __call] UFunction expected ", "binding_error_parameter_count_mismatch"},
        {"Tried storing reference to a Lua table for an 'Out' parameter when calling a UFunction but no table was on the stack", "binding_error_out_parameter_requires_table"},
        {"Tried calling UFunction without a registered handler for parameter. Parameter '", "binding_error_unsupported_parameter_property"},
        {"Tried calling UFunction without a registered handler 'Out' param. Type '", "binding_error_unsupported_out_property"},
        {"Tried calling UFunction without a registered handler for return value. Return value of type '", "binding_error_unsupported_return_property"},
        {"[push_strproperty] Error:\n StrProperty can only be set to a string or FString\n", "binding_error_invalid_string_type"},
        {"[push_strproperty] Error:\n data pointer is nullptr\n", "binding_error_string_storage_null"},
        {"[push_strproperty] Error:\n Unhandled Operation\n", "binding_error_string_operation_unsupported"},
        {"[push_strproperty] Error:\n Operation not supported\n", "binding_error_string_operation_unsupported"},
    }
    for _, rule in ipairs(rules) do
        if message:find(rule[1], 1, true) == 1 then return rule[2] end
    end
    return "binding_error_unknown"
end

local function guarded_attempt()
    -- Never let UE4SS's automatic error reporter print a password-bearing exception.
    local ok, private_error = pcall(attempt)
    if not ok then completed = true; os.remove(request); status(classify_binding_error(private_error)); status("native_call_or_binding_failed") end
    private_error = nil
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
