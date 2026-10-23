AddPrefabPostInit("world", function(inst)
    if not inst.ismastersim then return end
    inst:AddComponent("voltraacceptance")
    print("VOLTRA_DST_MOD_READY", inst.worldprefab)
end)
