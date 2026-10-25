-- MIT. Stock Lua reference/GC experiment only; no Unreal objects or native calls.
local count=0
for _,retain in ipairs({false,true}) do
    collectgarbage('collect')
    local finalized=0
    local retained={}
    local function mock_return()
        return setmetatable({}, {
            __gc=function() finalized=finalized+1 end,
            __tostring=function() error('Native return stringification forbidden') end,
        })
    end
    local function first_call()
        if retain then retained[1]=mock_return() else mock_return() end
    end
    first_call()
    -- Models a later allocation's collection boundary; does not claim that
    -- the actual UE4SS allocator caused the observed game access violation.
    collectgarbage('collect')
    assert(finalized==(retain and 0 or 1))
    count=count+1
    retained={}
    collectgarbage('collect')
    assert(finalized==1)
    count=count+1
end
print('PASS '..count..' Lua return lifetime cases; synthetic GC only, no native cause claim')
