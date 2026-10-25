-- SPDX-License-Identifier: MIT
-- SOURCE ONLY. No packet I/O, credentials, setter/CallFunction/native UFunction calls.
-- The engine and methods are inspected through the exact pinned UE4SS Lua API.
local complete, attempts = false, 0
local function status(code) print("[VoltraReadOnlyBindingProbe] " .. code .. "\n") end
local function attempt()
    if complete then return end
    attempts = attempts + 1
    status("component_lookup_enter")
    local objects = FindAllOf("CrDedicatedServerSettingsComp") or {}
    status("component_lookup_returned")
    local live = {}
    for _, object in ipairs(objects) do
        status("component_validity_enter")
        local valid = object:IsValid()
        status("component_validity_returned")
        if valid then live[#live+1] = object end
    end
    if #live > 1 then complete = true; status("ambiguous_component"); return end
    if #live == 0 then
        if attempts >= 600 then complete = true; status("component_timeout") end
        return
    end
    complete = true
    for _, name in ipairs({"SetPassword", "SetPlayerPassword"}) do
        if name == "SetPassword" then status("admin_method_resolve_enter") else status("player_method_resolve_enter") end
        local method = live[1][name]
        status("method_resolve_returned")
        if not method then status("method_absent"); return end
        status("method_type_enter")
        local kind = method:type()
        status("method_type_returned")
        if kind ~= "UFunction" then status("method_type_unexpected"); return end
        status("method_validity_enter")
        local valid = method:IsValid()
        status("method_validity_returned")
        if not valid then status("method_invalid"); return end
    end
    status("read_only_surface_complete_not_native_call_proof")
end
local guarded
guarded = function()
    local ok = pcall(attempt) -- Error value intentionally discarded, never stringified.
    if not ok then complete = true; status("read_only_binding_failed") end
    if not complete then ExecuteWithDelay(100, function() ExecuteInGameThread(guarded) end) end
end
if type(ExecuteInGameThread) ~= "function" or type(ExecuteWithDelay) ~= "function" or type(FindAllOf) ~= "function" then
    status("required_ue4ss_api_unavailable")
else
    local ok = pcall(ExecuteInGameThread, guarded)
    if not ok then status("initial_dispatch_failed") end
end
