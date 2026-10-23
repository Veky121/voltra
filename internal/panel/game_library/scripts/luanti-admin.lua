-- SPDX-License-Identifier: MIT
-- Native first-account setup. Existing authentication records are never reset.
core.after(0, function()
    local pending = core.get_worldpath() .. "/.voltra-admin-bootstrap.json"
    local stream = assert(io.open(pending, "r"), "Administrator bootstrap metadata is unavailable")
    local data = core.parse_json(stream:read("*a"))
    stream:close()
    assert(type(data) == "table", "Invalid administrator bootstrap metadata")
    if data.enabled then
        assert(type(data.name) == "string" and data.name:match("^[A-Za-z0-9_-]+$"), "Invalid administrator name")
        assert(type(data.password) == "string" and #data.password > 0, "Choose an administrator password")
        local handler = core.get_auth_handler()
        if not handler.get_auth(data.name) then
            handler.create_auth(data.name, core.get_password_hash(data.name, data.password))
            assert(handler.get_auth(data.name), "The authentication provider could not create the administrator account")
            if data.generated then
                local receipt = "voltra-admin-password-" .. data.name .. ".json"
                assert(os.rename(pending, core.get_worldpath() .. "/" .. receipt), "Could not retain the generated administrator password")
                core.log("action", "Generated administrator password is in the world's private voltra-admin-password-NAME.json file. Read it through Files.")
            end
            core.log("action", "VOLTRA_LUANTI_ADMIN_CREATED")
        else
            core.log("action", "VOLTRA_LUANTI_ADMIN_RETAINED")
        end
    end
    os.remove(pending)
    core.log("action", "VOLTRA_LUANTI_ADMIN_READY")
end)
