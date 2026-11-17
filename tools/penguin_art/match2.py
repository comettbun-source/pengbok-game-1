import numpy as np, json
from PIL import Image
from scipy import ndimage
SRC = 'assets/penguin/source_sheet.png'
OUT = 'tools/penguin_art/work/'
im = np.array(Image.open(SRC)).astype(np.float32) / 255.0
A = im[..., 3]; m = A > 0.03
lab, n = ndimage.label(ndimage.binary_dilation(m, iterations=3))
objs = ndimage.find_objects(lab)
comps = []
for i, sl in enumerate(objs):
    mm = (lab[sl] == i + 1) & m[sl]
    if mm.sum() < 50: continue
    comps.append(dict(i=i + 1, y0=sl[0].start, y1=sl[0].stop, x0=sl[1].start, x1=sl[1].stop, area=int(mm.sum()), lum=float(im[sl][..., :3][mm].mean())))
top = sorted([c for c in comps if c['y0'] < 1000], key=lambda c: c['x0'])
bot = [c for c in comps if c['y0'] > 1580]; mid = [c for c in comps if 1000 < c['y0'] < 1580]
cols = [(c['x0'] + c['x1']) / 2 for c in top]
colof = lambda c: int(np.argmin([abs((c['x0'] + c['x1']) / 2 - x) for x in cols]))
def crop(c):
    sl = (slice(c['y0'], c['y1']), slice(c['x0'], c['x1']))
    mm = (lab[sl] == c['i'])
    out = im[sl].copy(); out[~mm] = 0
    return out
def over(top_, bot_):   # straight alpha "over"
    ta = top_[..., 3:4]; ba = bot_[..., 3:4]
    oa = ta + ba * (1 - ta)
    oc = (top_[..., :3] * ta + bot_[..., :3] * ba * (1 - ta)) / np.maximum(oa, 1e-6)
    return np.concatenate([oc, oa], -1)
def prem(x): return np.concatenate([x[..., :3] * x[..., 3:4], x[..., 3:4]], -1)
res = []
for k, t in enumerate(top):
    PAD = 120
    comp = np.zeros((t['y1'] - t['y0'] + 2 * PAD, t['x1'] - t['x0'] + 2 * PAD, 4), np.float32)
    comp[PAD:-PAD, PAD:-PAD] = crop(t)
    parts = [c for c in mid + bot if colof(c) == k]
    body = [c for c in parts if c['y0'] > 1580][0]
    bimg = crop(body)
    base = np.zeros_like(comp); base[PAD:PAD + bimg.shape[0], PAD:PAD + bimg.shape[1]] = bimg   # body at comp top-left (matched earlier)
    entry = dict(col=k, comp=[t['y0'], t['x0'], t['y1'], t['x1']], body=dict(src=[body['y0'], body['x0'], body['y1'], body['x1']], at=[t['y0'], t['x0']]), parts=[])
    for c in parts:
        if c is body: continue
        kind = 'eye' if c['area'] < 400 else ('flipper' if c['lum'] > 0.6 else 'foot')
        P = crop(c); h, w = P.shape[:2]
        win = ndimage.binary_dilation(P[..., 3] > 0.05, iterations=10 if kind == 'eye' else 6)
        best = None
        for s, rng_ in ((4, None), (1, 6)):
            Pd = P[::s, ::s]; wd = win[::s, ::s]; Cd = prem(comp)[::s, ::s]; Bd = base[::s, ::s]
            hh, ww = Pd.shape[:2]
            if rng_ is None: cand = [(y, x) for y in range(0, Cd.shape[0] - hh) for x in range(0, Cd.shape[1] - ww)]
            else: cand = [(best[0] + dy, best[1] + dx) for dy in range(-rng_, rng_ + 1) for dx in range(-rng_, rng_ + 1)]
            sc = []
            for (y, x) in cand:
                if y < 0 or x < 0 or y + hh > Cd.shape[0] or x + ww > Cd.shape[1]: sc.append(1e9); continue
                b = Bd[y:y + hh, x:x + ww]
                exp = over(b, Pd) if kind == 'foot' else over(Pd, b)
                d = (prem(exp) - Cd[y:y + hh, x:x + ww]) ** 2
                sc.append(float(d.sum(-1)[wd].mean()))
            i = int(np.argmin(sc)); best = (cand[i][0] * (s if rng_ is None else 1), cand[i][1] * (s if rng_ is None else 1)); err = sc[i]
        entry['parts'].append(dict(kind=kind, src=[c['y0'], c['x0'], c['y1'], c['x1']], at=[int(best[0] - PAD + t['y0']), int(best[1] - PAD + t['x0'])], err=round(err, 5)))
        print(k, kind, entry['parts'][-1]['at'], 'dy', entry['parts'][-1]['at'][0] - c['y0'], 'dx', entry['parts'][-1]['at'][1] - c['x0'], err)
    res.append(entry)
json.dump(res, open(OUT + 'match.json', 'w'), indent=1)
