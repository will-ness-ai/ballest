import mmap

P = r"C:/Program Files (x86)/Steam/steamapps/common/Ballest of Them All/Ballest/Content/Paks/Ballest-Windows.ucas"

def printable(b):
    return "".join(chr(c) if 32 <= c < 127 else "." for c in b)

# wide context dumps around the circuit level-list regions
regions = [217355300, 252998650]
with open(P, "rb") as f:
    mm = mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ)
    for r in regions:
        print(f"\n===== region @{r} =====")
        print(printable(mm[r:r+600]))

    print("\n===== all Map_Track* tokens =====")
    seen = set()
    start = 0
    while True:
        i = mm.find(b"Map_Track", start)
        if i == -1: break
        # read up to 40 bytes, cut at first non-name char
        raw = mm[i:i+40]
        tok = ""
        for c in raw:
            if 48 <= c < 58 or 65 <= c < 91 or 97 <= c < 123 or c == 95:
                tok += chr(c)
            else:
                break
        if tok and tok not in seen:
            seen.add(tok)
            print(tok)
        start = i + 1

    print("\n===== OverallLeaderboard tokens =====")
    seen = set()
    start = 0
    while True:
        i = mm.find(b"OverallLeaderboard", start)
        if i == -1: break
        raw = mm[i:i+40]
        tok = ""
        for c in raw:
            if 48 <= c < 58 or 65 <= c < 91 or 97 <= c < 123 or c == 95:
                tok += chr(c)
            else:
                break
        if tok not in seen:
            seen.add(tok); print(tok)
        start = i + 1
    mm.close()
