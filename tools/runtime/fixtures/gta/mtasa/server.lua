-- MIT. Exercises the actual MTA Lua and SQLite runtime without a game client.
local connection = dbConnect("sqlite", "voltra-acceptance.db")
assert(connection, "Native SQLite connection failed")
assert(dbExec(connection, "CREATE TABLE IF NOT EXISTS acceptance (marker INTEGER)"))
local previous = dbPoll(dbQuery(connection, "SELECT marker FROM acceptance LIMIT 1"), -1)
if previous and previous[1] and tonumber(previous[1].marker) == 517077 then
    outputServerLog("VOLTRA_SQLITE_RESTORED_517077")
end
assert(dbExec(connection, "DELETE FROM acceptance"))
assert(dbExec(connection, "INSERT INTO acceptance (marker) VALUES (?)", 517077))
local saved = dbPoll(dbQuery(connection, "SELECT marker FROM acceptance LIMIT 1"), -1)
assert(saved and saved[1] and tonumber(saved[1].marker) == 517077, "Native SQLite marker write failed")
outputServerLog("VOLTRA_SQLITE_SAVED_517077")
addEventHandler("onResourceStop", resourceRoot, function()
    outputServerLog("VOLTRA_SQLITE_SHUTDOWN_517077")
end)
