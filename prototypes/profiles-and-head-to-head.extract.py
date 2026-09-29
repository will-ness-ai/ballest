import json, glob, collections, os, sys
os.chdir(sys.argv[1])
ws = json.load(open('data/workshop.json', encoding='utf-8'))['maps']
maps = {m['pfid']: m for m in ws}
idx = json.load(open('data/index.json', encoding='utf-8'))['boards']
runs = collections.defaultdict(dict); names = {}; boards = {}
for f in glob.glob('data/workshop/*.json'):
    b = json.load(open(f, encoding='utf-8'))
    pf = b['name'].split('_')[1]; boards[pf] = b['rows']
    for r in b['rows']:
        runs[r['steam_id']][pf] = (r['rank'], r['score_ms']); names[r['steam_id']] = r.get('persona')
authored = collections.defaultdict(list)
for m in ws: authored[m['cid']].append(m['pfid'])

shards = {}
def shard(sid):
    d = sid[-1]
    if d not in shards: shards[d] = json.load(open(f'data/players/{d}.json', encoding='utf-8'))
    return shards[d]
def circuit(sid):
    s = shard(sid); p = s['players'].get(sid)
    if not p: return None
    meta = {b['name']: b for b in idx}
    out = []
    for i, rank, score in p['rows']:
        b = s['boards'][i]; m = meta.get(b['name'])
        if m: out.append([m['group'], m['display'], rank, m['entry_count'], score, b['lead']])
    return out

def byname(n):
    return next(s for s, v in names.items() if v == n)
cands = sorted(runs, key=lambda s: -len(runs[s]))
regular = next(s for s in cands if 35 <= len(runs[s]) <= 45 and shard(s)['players'].get(s))
casual = next(s for s in cands if len(runs[s]) == 3 and shard(s)['players'].get(s) and s not in authored)
wo=[s for s in cands if not shard(s)["players"].get(s)]; print("ws-only",len(wo),[len(runs[s]) for s in wo[:10]]); wsonly = wo[0]
# circuit only
circonly = None
for d in '0123':
    for sid in shard('x' + d)['players']:
        if sid not in runs and sid not in authored: circonly = sid; break
    if circonly: break
people = {
    'grinder': byname('Slati Jnr'), 'maker': maps[authored and next(p for p in maps if maps[p]['creator']=='Action Jackson')]['cid'],
    'regular': regular, 'casual': casual, 'wsonly': wsonly, 'circonly': circonly,
    'pamzei': byname('Pamzei'), 'laney': byname('123JLaney123'), 'bill': byname('Bill Lumbergh'),
}

# circuit runs per player: board name -> score, for shared-map counts
cruns = {}
def crun(sid):
    if sid not in cruns:
        sh = shard(sid); p = sh['players'].get(sid)
        cruns[sid] = {sh['boards'][i]['name']: sc for i, rk, sc in p['rows'] if not sh['boards'][i]['name'].startswith('Overall')} if p else {}
    return cruns[sid]
def h2h(a, b):
    aw = bw = n = 0
    for pf, (rk, sc) in runs.get(a, {}).items():
        o = runs.get(b, {}).get(pf)
        if o: n += 1; aw += sc < o[1]; bw += sc > o[1]
    ca, cb = crun(a), crun(b)
    for k, sc in ca.items():
        if k in cb: n += 1; aw += sc < cb[k]; bw += sc > cb[k]
    return n, aw, bw
everyone = set(runs)
for d in '0123456789': everyone |= set(shard('x' + d)['players'])
rivals = {}; load = set(people.values())
for key, sid in people.items():
    mine = set(runs.get(sid, {}))
    cand = sorted((s for s in runs if s != sid), key=lambda s: -len(mine & set(runs[s])))[:60]
    if not mine:  # circuit-only: rank by circuit overlap
        cand = sorted((s for s in everyone if s != sid and crun(s)), key=lambda s: -len(set(crun(sid)) & set(crun(s))))[:60]
    scored = [(s,) + h2h(sid, s) for s in cand]
    common = sorted(scored, key=lambda x: -x[1])[:6]
    close = sorted([x for x in scored if x[1] >= 15], key=lambda x: (abs(x[2] - x[3]) / max(1, x[2] + x[3]), -x[1]))[:6]
    rivals[sid] = {'common': [list(x) for x in common], 'close': [list(x) for x in close]}
    load |= {x[0] for x in common + close}
players = {}; used = set()
for sid in load:
    sp = shard(sid)['players'].get(sid) or {}
    r = runs.get(sid, {})
    used |= set(r); used |= set(authored.get(sid, []))
    players[sid] = {'id': sid, 'name': sp.get('persona') or names.get(sid) or '?',
                    'runs': [[pf, rk, sc] for pf, (rk, sc) in r.items()],
                    'authored': authored.get(sid, []), 'circuit': circuit(sid)}
out_maps = {}
for pf in used:
    m = maps[pf]
    rows = boards.get(pf, [])
    out_maps[pf] = [m['display'], m['creator'], [round(x, 3) for x in m['medals']], m['entry_count'],
                    m.get('subs', 0), (rows[0]['persona'] if rows else None), (rows[0]['score_ms'] if rows else None),
                    m.get('created', 0), m.get('author_beaten', 0), (rows[0]['steam_id'] if rows else None)]
json.dump({'maps': out_maps, 'players': players, 'subjects': people, 'rivals': rivals}, open(sys.argv[2], 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print(len(players), len(out_maps), os.path.getsize(sys.argv[2]))
for k, sid in people.items(): print(k, players[sid]['name'], [players[x[0]]['name'] + f" {x[1]} {x[2]}-{x[3]}" for x in rivals[sid]['close'][:3]])
