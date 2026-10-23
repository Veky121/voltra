local VoltraAcceptance = Class(function(self, inst)
    self.inst = inst
    self.marker = 517077
    self.loads = 0
end)

function VoltraAcceptance:OnSave()
    return { marker = self.marker, loads = self.loads }
end

function VoltraAcceptance:OnLoad(data)
    if data then
        self.marker = data.marker
        self.loads = (data.loads or 0) + 1
        print("VOLTRA_DST_PERSISTENCE", self.inst.worldprefab, self.marker, self.loads)
    end
end

return VoltraAcceptance
