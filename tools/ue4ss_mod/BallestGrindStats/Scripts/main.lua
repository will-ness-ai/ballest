-- BallestGrindStats: a UE4SS Lua mod that keeps per-map grind stats for
-- Ballest of Them All, in the spirit of Trackmania's Grinding Stats plugin.
--
-- Per map it tracks time played, attempts and finishes, all-time and for the
-- current session, and shows them on a small card (overlay.lua). F6 hides the
-- card, F8 writes the current map's line to ue4ss/UE4SS.log.
--
-- Data lives in ue4ss/Mods/BallestGrindStats/grindstats.txt, one tab-separated
-- line per map: name, seconds, attempts, finishes (see save()). Tabs in a map
-- title are replaced with spaces so the line stays parseable.
--
-- Game signals (Blueprint events, found 2026-09-20; see tools/ue4ss_mod/README.md):
--   map       BP_MyPlayerController_C.NameOfMap, set once the ball exists
--   attempt   BP_RollingBall_C:RaceStarted — first spawn and every restart
--   finish    BP_BallGameState_C:RaceHasEnded_Handler — never fired by restarts
--   paused    BP_BallGameState_C.CurrentGameContext ~= 0
--   session   one per level load: InitGameState fires for menu <-> track, not for R
-- Time counts once a second while the ball exists, the game is not paused and the
-- ball has moved within IDLE_AFTER_S — the same rule Grinding Stats uses.

local UEHelpers = require("UEHelpers")

local SCRIPT_DIR = (debug.getinfo(1, "S").source:gsub("^@", ""):match("^(.*)[/\\]") or ".")
local DATA_FILE = SCRIPT_DIR .. "/../grindstats.txt"
local Overlay = dofile(SCRIPT_DIR .. "/overlay.lua")

local IDLE_AFTER_S = 5
local SAVE_EVERY_S = 10     -- Lua gets no shutdown callback, so quitting mid-map loses at most this
local BALL_CLASS = "BP_RollingBall_C"
local CONTROLLER_CLASS = "BP_MyPlayerController_C"
local CONTEXT_RACING = 0    -- BP_BallGameState_C.CurrentGameContext; 1 = editor, 2 = paused/finished
local MOVING_SPEED_SQ = 4   -- (cm/s)^2; below this the ball counts as idle

local function log(fmt, ...)
    print(string.format("[GrindStats] " .. fmt .. "\n", ...))
end

local function className(obj)
    if not obj or not obj:IsValid() then return "" end
    local ok, c = pcall(function() return obj:GetClass():GetFName():ToString() end)
    return ok and c or ""
end

-- ---------------------------------------------------------------- persistence
local function newCounters() return { time = 0, attempts = 0, finishes = 0 } end

local stats = {}      -- map name -> counters, all-time

local function loadStats()
    local f = io.open(DATA_FILE, "r")
    if not f then return end
    for line in f:lines() do
        -- earlier files carried a fifth "best" column; anything past finishes is ignored
        local name, t, a, fin = line:match("^(.-)\t(%d+)\t(%d+)\t(%d+)")
        if name then
            stats[name] = { time = tonumber(t), attempts = tonumber(a), finishes = tonumber(fin) }
        end
    end
    f:close()
end

local function save()
    local f = io.open(DATA_FILE, "w")
    if not f then log("cannot write %s", DATA_FILE) return end
    for name, s in pairs(stats) do
        f:write(string.format("%s\t%d\t%d\t%d\n", (name:gsub("[\t\r\n]", " ")), s.time, s.attempts, s.finishes))
    end
    f:close()
end

local function entry(name)
    if not stats[name] then stats[name] = newCounters() end
    return stats[name]
end

-- ---------------------------------------------------------------- session
local cur = nil          -- current map name, nil outside a map
local session = nil      -- counters for cur since it loaded
local lastMoveT = 0

local function report(tag)
    if not cur then log("%s: no map", tag) return end
    local t = entry(cur)
    log("%s  %s | total %s  session %s | attempts %d (+%d) | finishes %d (+%d)",
        tag, cur, Overlay.fmtTime(t.time), Overlay.fmtTime(session.time), t.attempts, session.attempts,
        t.finishes, session.finishes)
end

local function mapName()
    local pc = UEHelpers.GetPlayerController()
    if not pc:IsValid() or className(pc) ~= CONTROLLER_CLASS then return nil end
    local ok, n = pcall(function() return pc.NameOfMap:ToString() end)
    if ok and n and n ~= "" then return n end
    return nil
end

local function ball()
    local pawn = UEHelpers.GetPlayer()
    if pawn:IsValid() and className(pawn) == BALL_CLASS then return pawn end
    return nil
end

local function enterMap(name)
    cur = name
    session = newCounters()
    lastMoveT = os.time()
    log("enter %s", name)
end

local function leaveMap()
    if not cur then return end
    report("leave")
    save()
    cur, session = nil, nil
end

local function overlayData()
    if not cur then return nil end
    local e = entry(cur)
    return { total = e.time, session = session.time, attempts = e.attempts, finishes = e.finishes,
             sessionAttempts = session.attempts, sessionFinishes = session.finishes }
end

-- ---------------------------------------------------------------- startup
-- Read the file before any hook can create an entry the file would then replace.
loadStats()
do
    local n = 0
    for _ in pairs(stats) do n = n + 1 end
    log("loaded, %d maps on record", n)
end

-- ---------------------------------------------------------------- game hooks
local function onRaceStarted()
    local name = mapName()
    if name and name ~= cur then enterMap(name) end
    if not cur then return end
    local e = entry(cur)
    e.attempts = e.attempts + 1
    session.attempts = session.attempts + 1
    lastMoveT = os.time()
    report("attempt")
end

local function onRaceEnded()
    if not cur then return end
    local e = entry(cur)
    e.finishes = e.finishes + 1
    session.finishes = session.finishes + 1
    report("finish")
    save()
end

-- Blueprint classes only exist once a map that uses them has loaded, so hooking
-- is retried on every level load and remembered by path.
local HOOKS = {
    ["/Game/Core/Gameplay/BP_RollingBall.BP_RollingBall_C:RaceStarted"] = onRaceStarted,
    ["/Game/Core/GameState/BP_BallGameState.BP_BallGameState_C:RaceHasEnded_Handler"] = onRaceEnded,
}
local hooked = {}
local function hookAll()
    for path, fn in pairs(HOOKS) do
        if not hooked[path] and pcall(function() RegisterHook(path, fn) end) then
            hooked[path] = true
        end
    end
end

RegisterInitGameStatePostHook(function()
    leaveMap()
    hookAll()
end)
hookAll()   -- hot reload inside a map: the classes are already there

-- ---------------------------------------------------------------- time
LoopAsync(1000, function()
    local ok, err = pcall(function()
        local pawn = ball()
        if not pawn then Overlay.update(nil) return end
        local name = mapName()
        if name and name ~= cur then enterMap(name) end
        if not cur then return end
        Overlay.update(overlayData())

        local gs = UEHelpers.GetGameStateBase()
        if gs:IsValid() and gs.CurrentGameContext ~= CONTEXT_RACING then return end
        local v = pawn:GetVelocity()
        if v.X * v.X + v.Y * v.Y + v.Z * v.Z > MOVING_SPEED_SQ then lastMoveT = os.time() end
        if os.time() - lastMoveT > IDLE_AFTER_S then return end

        local e = entry(cur)
        e.time = e.time + 1
        session.time = session.time + 1
        if session.time % SAVE_EVERY_S == 0 then save() end
    end)
    if not ok then log("tick failed: %s", tostring(err)) end
    return false
end)

RegisterKeyBind(Key.F6, function() Overlay.toggle(); Overlay.update(overlayData()) end)
RegisterKeyBind(Key.F8, function() report("F8") end)
