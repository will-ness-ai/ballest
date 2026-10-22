# PROTOTYPE (grill-design, never merged): posts round 4's channel flows into the test server's
# sandbox channel as the dev bot. Ephemeral replies are mocked as plain messages marked so.
# Run: python post.py [F1 ... F5]
import json, os, sys, time, requests

CH = "1561424083114135624"
API = f"https://discord.com/api/v10/channels/{CH}/messages"
H = {"Authorization": f"Bot {os.environ['DISCORD_TOKEN']}"}
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = "https://ballestrecords.com/player/76561198008697957"
ACCENT = 0x9EE34B
V2 = 1 << 15
now = int(time.time())


def post(body, card=False):
    body = {"allowed_mentions": {"parse": []}, **body}
    if card:
        files = {"files[0]": ("card.png", open(os.path.join(HERE, "card.png"), "rb"), "image/png")}
        r = requests.post(API, headers=H, data={"payload_json": json.dumps(body)}, files=files)
    else:
        r = requests.post(API, headers=H, json=body)
    r.raise_for_status()
    time.sleep(0.6)


def say(t):
    post({"content": t})


def btn(label, url=None, cid=None, style=None):
    if url:
        return {"type": 2, "style": 5, "label": label, "url": url}
    return {"type": 2, "style": style or 1, "label": label, "custom_id": cid}


def row(*b):
    return {"type": 1, "components": list(b)}


def box(*parts, colour=ACCENT):
    return {"flags": V2, "components": [{"type": 17, "accent_color": colour, "components": list(parts)}]}


def text(t):
    return {"type": 10, "content": t}


def image():
    return {"type": 12, "items": [{"media": {"url": "attachment://card.png"}}]}


PANEL = box(
    text("## Your stat card\nLink your Steam once and Multiballs posts your card here: your Circuit ranks, World records and Medals, drawn from ballestrecords.com."),
    row(btn("Link Steam and get my card", cid="proto-link")),
)
EPHEMERAL = box(
    text("-# Only you can see this\n**Sign in with Steam** to link this Discord account. The link works once, for 10 minutes."),
    row(btn("Sign in with Steam", url="https://ballestrecords.com/api/auth/steam")),
    colour=0x5865F2,
)


def F1():
    say("### F1 · Panel, a fresh post each time\n-# A pinned panel; the card is a new message every time you press Update.")
    post(PANEL)
    post(EPHEMERAL)
    post({**box(text("**Action Jackson** linked their Steam"), image(), row(btn("Player page", url=SITE), btn("Update my card", cid="proto-up", style=2)))}, card=True)


def F2():
    say("### F2 · One living card each\n-# Posted once when you link, then edited after every Refresh, so it is always current; no Update button.")
    post(PANEL)
    post({**box(text("**Action Jackson**"), image(), text(f"-# Updated <t:{now}:R> · redrawn after every Refresh"), row(btn("Player page", url=SITE)))}, card=True)


def F3():
    say("### F3 · A slash command, no panel\n-# `/card` shows yours (an unlinked player gets the private Sign in link), `/card @someone` shows theirs if they have linked.")
    say("-# ↳ *Action Jackson used* `/card`")
    post({**box(image(), row(btn("Player page", url=SITE)))}, card=True)
    say("-# ↳ *TheDuster used* `/card` *(not linked yet)*")
    post(EPHEMERAL)


def F4():
    say("### F4 · A thread per player\n-# The first card starts a thread named after you; each Update posts into it with what changed, so the channel stays one line per player.")
    post(PANEL)
    post({**box(text("**Action Jackson** · thread: *Action Jackson's cards* (4 cards)"), image(), row(btn("Player page", url=SITE), btn("Update my card", cid="proto-up", style=2)))}, card=True)
    say("-# *in the thread:* Since 15 Oct: **+1** World record · **+12** Author medals · Season 2 Circuit **#47 → #43**")


def F5():
    say("### F5 · Card with what changed\n-# Like F1, but every card after your first says what changed since your last one.")
    post(PANEL)
    post({**box(text("**Action Jackson** · since 15 Oct: **+1** WR · **+12** Author · S2 Circuit **#47 → #43**"), image(), row(btn("Player page", url=SITE), btn("Update my card", cid="proto-up", style=2)))}, card=True)


which = sys.argv[1:] or ["F1", "F2", "F3", "F4", "F5"]
say("## Stat card · round 4\nHow the channel works. Pressing a button here does nothing; private replies are shown as plain messages marked *Only you can see this*. The card's date is in its footer here (dates: see the thread).")
for f in which:
    globals()[f]()
