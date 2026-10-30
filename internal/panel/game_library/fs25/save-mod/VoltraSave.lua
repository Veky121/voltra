-- Server-only command handling. No sockets, player events, or executable input.
VoltraSave = {}

function VoltraSave:loadMap()
    if g_server == nil then return end
    self.directory = getUserProfileAppPath() .. "modSettings/VoltraSave/"
    createFolder(getUserProfileAppPath() .. "modSettings/")
    createFolder(self.directory)
    self.request = self.directory .. "request.xml"
    -- Never replay a pending request from a previous game session.
    if fileExists(self.request) then deleteFile(self.request) end
    print("[VoltraSave] ready protocol=1")
    local info = g_currentMission and g_currentMission.missionInfo
    if info ~= nil then
        print("[VoltraSave] loaded slot=" .. tostring(info.savegameIndex) .. " playTime=" .. tostring(info.playTime) .. " name=" .. tostring(info.savegameName))
    end
end

function VoltraSave:update(dt)
    if self.request == nil or g_server == nil or g_currentMission == nil then return end
    if not fileExists(self.request) then return end
    local xml = loadXMLFile("voltraSaveRequest", self.request)
    if xml == nil or xml == 0 then return end
    local id = getXMLString(xml, "voltraSave#id")
    local action = getXMLString(xml, "voltraSave#action")
    delete(xml)
    deleteFile(self.request)
    if id == nil or #id ~= 32 or id:match("^[a-f0-9]+$") == nil or action ~= "save" then
        print("[VoltraSave] rejected malformed request")
        return
    end
    if id == self.lastId then return end
    self.lastId = id
    local mission = g_currentMission
    if mission.dediSave_allowSave == false then
        print("[VoltraSave] rejected " .. id .. " DediAutoSave blocks saves while empty; disable that conflicting mod before using Voltra save")
        return
    end
    if mission.startSaveCurrentGame == nil then
        print("[VoltraSave] rejected " .. id .. " save API unavailable")
        return
    end
    if mission.isSaving then
        print("[VoltraSave] rejected " .. id .. " save already running")
        return
    end
    print("[VoltraSave] requested " .. id)
    local ok, message = pcall(mission.startSaveCurrentGame, mission, true)
    if not ok then print("[VoltraSave] rejected " .. id .. " " .. tostring(message)) end
end

addModEventListener(VoltraSave)

-- Mod update listeners are suspended when an empty dedicated server pauses.
-- Poll from the mission's base update as well; requests are consumed once.
if BaseMission ~= nil and type(BaseMission.update) == "function" then
    BaseMission.update = Utils.appendedFunction(BaseMission.update, function()
        VoltraSave:update(0)
    end)
end
