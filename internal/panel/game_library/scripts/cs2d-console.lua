-- MIT. Dashboard console adapter using the publisher's native Lua API.
-- A private, single-consumer mailbox is owned by the launcher, never a socket.
local mailbox = "../.voltra/cs2d/console-command"
function voltra_native_console_poll()
    local source = io.open(mailbox, "rb")
    if source == nil then return end
    local command = source:read(65537)
    source:close()
    os.remove(mailbox)
    if command == nil or #command > 65536 then return end
    for line in command:gmatch("[^\r\n]+") do
        local ok = pcall(parse, line)
        if not ok then print("Voltra native console command failed.") end
    end
end
addhook("second", "voltra_native_console_poll")
print("VOLTRA_CS2D_CONSOLE_READY")
