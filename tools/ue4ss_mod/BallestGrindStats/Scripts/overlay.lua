-- On-screen card for BallestGrindStats, built as a UMG widget from Lua.
-- Four rows top-left: TOTAL, SESSION, ATTEMPTS (+session), FINISHES (+session).
-- Design settled 2026-09-20: "small" size, session deltas in the game's lime.
--
-- Overlay.update(data) creates the widget on demand and refreshes the text;
-- data = { total=, session=, attempts=, finishes=, sessionAttempts=, sessionFinishes= }
-- (seconds / counts), or nil to hide it. Overlay.toggle() flips user visibility.
-- Overlay.fmtTime(sec) is the card's clock format, shared with main.lua's log lines.

local UEHelpers = require("UEHelpers")

local Overlay = { visible = true }

local FONT  = "/Game/UI/Fonts/CocogoosePro.CocogoosePro"   -- the game's own UI face
local LIME  = { R = 0.80, G = 1.00, B = 0.00, A = 1 }        -- the menu highlight colour
local WHITE = { R = 1, G = 1, B = 1, A = 1 }
local DIM   = { R = 1, G = 1, B = 1, A = 0.65 }
local PANEL = { R = 0.08, G = 0.08, B = 0.09, A = 0.72 }
local LABEL_SIZE, VALUE_SIZE, GAP = 12, 15, 18
local ORIGIN = { X = 40, Y = 110 }        -- below the game's pause-screen PB box
local ROOT_NAME = "GrindStats_Root"      -- how sweep() recognises our widgets

-- UMG enum literals: the Lua API takes the raw values
local VIS_HIDDEN, VIS_HIT_TEST_INVISIBLE = 1, 3   -- ESlateVisibility
local VALIGN_CENTER = 2                            -- EVerticalAlignment
local SIZE_RULE_FILL = 1                           -- ESlateSizeRule
local COLOR_USE_SPECIFIED = 0                      -- ESlateColorStylingMode

local function log(f, ...) print(string.format("[GrindStats.Overlay] " .. f .. "\n", ...)) end

local widget, tree, texts

local function new(cls, name)
    return StaticConstructObject(StaticFindObject("/Script/UMG." .. cls), tree, FName(name))
end

local function text(name, size, color)
    local t = new("TextBlock", name)
    local f = t.Font
    f.Size = size
    local fo = StaticFindObject(FONT)
    if fo and fo:IsValid() then f.FontObject = fo end
    t:SetFont(f)
    t:SetColorAndOpacity({ SpecifiedColor = color, ColorUseRule = COLOR_USE_SPECIFIED })
    texts[name] = t
    return t
end

local function row(vbox, key, label, valueKeys)
    local h = new("HorizontalBox", "H_" .. key)
    local l = h:AddChildToHorizontalBox(text("l_" .. key, LABEL_SIZE, DIM))
    l:SetSize({ SizeRule = SIZE_RULE_FILL, Value = 1 })   -- pushes the values to the right edge
    l:SetVerticalAlignment(VALIGN_CENTER)
    texts["l_" .. key]:SetText(FText(label))
    for i, vk in ipairs(valueKeys) do
        local s = h:AddChildToHorizontalBox(text(vk[1], VALUE_SIZE, vk[2]))
        s:SetPadding({ Left = i == 1 and GAP or 10, Top = 0, Right = 0, Bottom = 0 })
        s:SetVerticalAlignment(VALIGN_CENTER)
    end
    vbox:AddChildToVerticalBox(h)
end

local function build()
    local pc = UEHelpers.GetPlayerController()
    if not pc:IsValid() then return false end
    local WBL = StaticFindObject("/Script/UMG.Default__WidgetBlueprintLibrary")
    widget = WBL:Create(pc, StaticFindObject("/Script/UMG.UserWidget"), pc)
    tree = widget.WidgetTree
    texts = {}

    local canvas = new("CanvasPanel", ROOT_NAME)
    tree.RootWidget = canvas
    local v = new("VerticalBox", "Rows")
    row(v, "total",    "TOTAL",    { { "total", WHITE } })
    row(v, "session",  "SESSION",  { { "session", WHITE } })
    row(v, "attempts", "ATTEMPTS", { { "attempts", WHITE }, { "attemptsPlus", LIME } })
    row(v, "finishes", "FINISHES", { { "finishes", WHITE }, { "finishesPlus", LIME } })
    local card = new("Border", "Card")
    card:SetBrushColor(PANEL)
    card:SetPadding({ Left = 14, Top = 8, Right = 14, Bottom = 8 })
    card:SetContent(v)
    local slot = canvas:AddChildToCanvas(card)
    slot:SetAutoSize(true)
    slot:SetPosition(ORIGIN)

    widget:AddToViewport(50)
    widget:SetVisibility(VIS_HIT_TEST_INVISIBLE)   -- never eats the mouse
    return true
end

-- Widgets built before a hot reload outlive the Lua state that made them.
local function sweep()
    for _, w in ipairs(FindAllOf("UserWidget") or {}) do
        pcall(function()
            local root = w.WidgetTree and w.WidgetTree.RootWidget
            if root and root:IsValid() and root:GetFName():ToString() == ROOT_NAME then w:RemoveFromParent() end
        end)
    end
end

function Overlay.fmtTime(sec)
    sec = math.floor(sec or 0)
    if sec >= 3600 then return string.format("%d:%02d:%02d", sec // 3600, (sec % 3600) // 60, sec % 60) end
    return string.format("%d:%02d", sec // 60, sec % 60)
end

local function set(name, str)
    local t = texts[name]
    if t and t:IsValid() then t:SetText(FText(str)) end
end

local function hide()
    if widget and widget:IsValid() then pcall(function() widget:SetVisibility(VIS_HIDDEN) end) end
end

function Overlay.update(data)
    if not Overlay.visible or not data then hide() return end
    local ok, err = pcall(function()
        if not widget or not widget:IsValid() or not widget:IsInViewport() then
            if not build() then return end
        end
        widget:SetVisibility(VIS_HIT_TEST_INVISIBLE)
        set("total", Overlay.fmtTime(data.total))
        set("session", Overlay.fmtTime(data.session))
        set("attempts", tostring(data.attempts))
        set("finishes", tostring(data.finishes))
        set("attemptsPlus", "+" .. data.sessionAttempts)
        set("finishesPlus", "+" .. data.sessionFinishes)
    end)
    if not ok then log("update failed: %s", tostring(err)) end
end

function Overlay.toggle()
    Overlay.visible = not Overlay.visible
    if not Overlay.visible then hide() end
    log("visible = %s", tostring(Overlay.visible))
end

sweep()
return Overlay
