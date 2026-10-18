# PROTOTYPE (grill-design round 4): leader graphs for the Daily card, drawn with PIL as stand-ins
# for what the bot would draw with Satori. The lead history is illustrative, built around the real
# final podium of Daily #60 (the drop): the bot keeps no history yet.
from PIL import Image, ImageDraw, ImageFont
import sys
F = "/home/user/ballest/web/assets/share/"
font = lambda n, s: ImageFont.truetype(F + n, s)
BG, GRID, DIM, TEXT, FAINT = "#121628", "#262c46", "#9aa3c7", "#eef0fb", "#5b648a"
COL = {"MitchPlease": "#3987e5", "FEDUS": "#d95926", "airman": "#199e70", "snayK": "#c98500"}
h = lambda s: int(s[:2]) + int(s[3:]) / 60 - 1  # hours since 01:00 open
NOW = h("17:20")
# lead changes: (hours, leader, time)
LEAD = [(h("01:24"), "MitchPlease", 8.912), (h("02:10"), "FEDUS", 8.701), (h("03:40"), "MitchPlease", 8.640),
        (h("06:05"), "FEDUS", 8.566), (h("09:17"), "airman", 8.532)]
TIE = (h("13:48"), "snayK")
PB = {"FEDUS": [(h("02:10"), 8.701), (h("06:05"), 8.566)],
      "airman": [(h("04:00"), 8.712), (h("07:30"), 8.601), (h("09:17"), 8.532)],
      "snayK": [(h("05:00"), 8.664), (h("11:00"), 8.581), (h("13:48"), 8.532)]}
fmt = lambda t: f"0:0{t:.3f}"

def frame(w, hgt, l=90, r=30, t=30, b=46, y0=8.50, y1=8.95, yticks=(8.55, 8.70, 8.85)):
    im = Image.new("RGB", (w, hgt), BG); d = ImageDraw.Draw(im)
    X = lambda x: l + x / 24 * (w - l - r)
    Y = lambda y: hgt - b - (y - y0) / (y1 - y0) * (hgt - t - b)  # round 4 verdict: faster is lower
    for y in yticks:
        d.line([(l, Y(y)), (w - r, Y(y))], fill=GRID, width=1)
        d.text((l - 10, Y(y)), fmt(y), font=font("ChakraPetch-Medium.ttf", 15), fill=DIM, anchor="rm")
    xaxis(d, X, hgt - b + 10)
    return im, d, X, Y

def xaxis(d, X, y):
    for x, lab in [(0, "opened"), (6, "+6h"), (12, "+12h"), (18, "+18h"), (24, "closes")]:
        d.text((X(x), y + 8), lab, font=font("ChakraPetch-Medium.ttf", 15), fill=DIM, anchor={0: "lm", 24: "rm"}.get(x, "mm"))
    d.line([(X(NOW), y - 8), (X(NOW), y - 2)], fill=TEXT, width=2)

def now_mark(d, X, top, bottom):
    for yy in range(int(top), int(bottom), 8):
        d.line([(X(NOW), yy), (X(NOW), yy + 4)], fill=FAINT, width=1)
    d.text((X(NOW) + 6, top), "now", font=font("ChakraPetch-SemiBold.ttf", 14), fill=DIM, anchor="lt")

def title(d, s, x=24, y=14):
    d.text((x, y), s, font=font("ChakraPetch-SemiBold.ttf", 17), fill=DIM)

def A():
    im, d, X, Y = frame(1000, 380, t=56)
    title(d, "THE LEAD THROUGH THE DAY")
    now_mark(d, X, 50, 380 - 46)
    pts = LEAD + [(NOW, None, None)]
    for (x, who, t), (nx, _, _) in zip(pts, pts[1:]):
        c = COL[who]
        d.line([(X(x), Y(t)), (X(nx), Y(t))], fill=c, width=3)
        d.ellipse([X(x) - 5, Y(t) - 5, X(x) + 5, Y(t) + 5], fill=c, outline=BG, width=2)
        d.text((X(x) + 4, Y(t) + 22), who, font=font("ChakraPetch-SemiBold.ttf", 16), fill=TEXT, anchor="lb")
    for i, (x, who, t) in enumerate(LEAD[1:], 1):
        d.line([(X(x), Y(LEAD[i - 1][2])), (X(x), Y(t))], fill=COL[LEAD[i - 1][1]], width=2)
    x, who = TIE
    d.ellipse([X(x) - 5, Y(8.532) - 5, X(x) + 5, Y(8.532) + 5], fill=COL[who], outline=BG, width=2)
    d.text((X(x) + 4, Y(8.532) - 10), "snayK ties", font=font("ChakraPetch-SemiBold.ttf", 16), fill=TEXT, anchor="lb")
    d.text((X(NOW) + 10, Y(8.532)), "0:08.532", font=font("ChakraPetch-Bold.ttf", 18), fill=TEXT, anchor="lm")
    return im

def B():
    w, hgt = 1000, 170
    im = Image.new("RGB", (w, hgt), BG); d = ImageDraw.Draw(im)
    title(d, "WHO HELD THE LEAD")
    l, r = 24, 24; X = lambda x: l + x / 24 * (w - l - r)
    top, bot = 52, 104
    d.rounded_rectangle([X(0), top, X(24), bot], radius=6, outline=GRID, width=1)
    segs = [(LEAD[i][0], LEAD[i + 1][0] if i + 1 < len(LEAD) else NOW, LEAD[i][1]) for i in range(len(LEAD))]
    for a, z, who in segs:
        if who == "airman":
            z1 = TIE[0]
            d.rectangle([X(a) + 1, top + 1, X(z1) - 1, bot - 1], fill=COL[who])
            d.rectangle([X(z1) + 1, top + 1, X(z) - 1, (top + bot) / 2 - 1], fill=COL["airman"])
            d.rectangle([X(z1) + 1, (top + bot) / 2 + 1, X(z) - 1, bot - 1], fill=COL["snayK"])
            d.text(((X(a) + X(z1)) / 2, (top + bot) / 2), "airman", font=font("ChakraPetch-Bold.ttf", 17), fill="#0b0e1a", anchor="mm")
            d.text(((X(z1) + X(z)) / 2, (top + bot) / 2), "airman + snayK", font=font("ChakraPetch-Bold.ttf", 15), fill="#0b0e1a", anchor="mm")
            continue
        d.rectangle([X(a) + 1, top + 1, X(z) - 1, bot - 1], fill=COL[who])
        lab = who if X(z) - X(a) > 70 else who[:3]
        d.text(((X(a) + X(z)) / 2, (top + bot) / 2), lab, font=font("ChakraPetch-Bold.ttf", 15), fill="#0b0e1a", anchor="mm")
    now_mark(d, X, top - 6, bot + 6)
    xaxis(d, X, bot + 22)
    return im

def C():
    im, d, X, Y = frame(1000, 380, t=56, y0=8.50, y1=8.75, yticks=(8.55, 8.65))
    title(d, "THE PODIUM'S RUNS THROUGH THE DAY")
    now_mark(d, X, 50, 380 - 46)
    for who, runs in PB.items():
        c = COL[who]; pts = runs + [(NOW, runs[-1][1])]
        for (x, t), (nx, nt) in zip(pts, pts[1:]):
            d.line([(X(x), Y(t)), (X(nx), Y(t))], fill=c, width=3)
            if nt != t: d.line([(X(nx), Y(t)), (X(nx), Y(nt))], fill=c, width=2)
        for x, t in runs:
            d.ellipse([X(x) - 5, Y(t) - 5, X(x) + 5, Y(t) + 5], fill=c, outline=BG, width=2)
    labels = {"airman": -14, "snayK": 14, "FEDUS": 0}
    for who, dy in labels.items():
        t = PB[who][-1][1]
        d.text((X(NOW) + 10, Y(t) + dy), f"{who} {fmt(t)}", font=font("ChakraPetch-SemiBold.ttf", 15), fill=TEXT, anchor="lm")
    return im

def D():
    w, hgt = 1000, 120
    im = Image.new("RGB", (w, hgt), BG); d = ImageDraw.Draw(im)
    l, r = 24, 150; X = lambda x: l + x / 24 * (w - l - r)
    Y = lambda y: 22 + (y - 8.50) / 0.45 * 60
    d.line([(X(0), 96), (X(24), 96)], fill=GRID, width=1)
    pts = LEAD + [(NOW, None, None)]
    for i, ((x, who, t), (nx, _, _)) in enumerate(zip(pts, pts[1:])):
        d.line([(X(x), Y(t)), (X(nx), Y(t))], fill="#9ee34b", width=3)
        if i: d.line([(X(x), Y(LEAD[i - 1][2])), (X(x), Y(t))], fill="#9ee34b", width=2)
        d.ellipse([X(x) - 4, Y(t) - 4, X(x) + 4, Y(t) + 4], fill="#9ee34b", outline=BG, width=2)
    d.ellipse([X(TIE[0]) - 4, Y(8.532) - 4, X(TIE[0]) + 4, Y(8.532) + 4], fill=TEXT, outline=BG, width=2)
    d.text((X(NOW) + 14, Y(8.532)), "0:08.532", font=font("ChakraPetch-Bold.ttf", 22), fill=TEXT, anchor="lm")
    d.text((X(NOW) + 14, Y(8.532) + 24), "5 lead changes", font=font("ChakraPetch-Medium.ttf", 14), fill=DIM, anchor="lm")
    d.text((X(0), 104), "opened", font=font("ChakraPetch-Medium.ttf", 13), fill=DIM, anchor="lt")
    d.text((X(24), 104), "closes", font=font("ChakraPetch-Medium.ttf", 13), fill=DIM, anchor="rt")
    return im

def E():
    held = {"airman": 8.05, "FEDUS": 4.70, "snayK": 3.53, "MitchPlease": 3.18}
    w, hgt = 1000, 250
    im = Image.new("RGB", (w, hgt), BG); d = ImageDraw.Draw(im)
    title(d, "TIME IN THE LEAD")
    l = 170; mx = 10
    for i, (who, hrs) in enumerate(held.items()):
        y = 56 + i * 46
        d.text((l - 14, y + 13), who, font=font("ChakraPetch-SemiBold.ttf", 18), fill=TEXT, anchor="rm")
        x1 = l + hrs / mx * (w - l - 150)
        d.rounded_rectangle([l, y, x1, y + 26], radius=4, fill=COL[who])
        hh, mm = int(hrs), round((hrs - int(hrs)) * 60)
        lab = f"{hh}h {mm:02d}m" + (" · leads now" if who in ("airman", "snayK") else "")
        d.text((x1 + 10, y + 13), lab, font=font("ChakraPetch-Medium.ttf", 16), fill=DIM, anchor="lm")
    return im

out = sys.argv[1]
for k, f in dict(A=A, B=B, C=C, D=D, E=E).items():
    f().save(f"{out}/graph-{k}.png")
