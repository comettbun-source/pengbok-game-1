# 서 있는 자세(가만히) 한 장: assets/penguin/source_idle.png → tools/penguin_art/work/idle_place.json
import numpy as np, json
from PIL import Image
from scipy import ndimage
SRC = 'assets/penguin/source_idle.png'; OUT = 'tools/penguin_art/work/'
im = np.array(Image.open(SRC)).astype(np.float32) / 255.0
A = im[..., 3]; m = A > 0.03
lab, n = ndimage.label(ndimage.binary_dilation(m, iterations=3))
comps = []
for i, sl in enumerate(ndimage.find_objects(lab)):
    mm = (lab[sl] == i + 1) & m[sl]
    if mm.sum() < 30: continue
    comps.append(dict(i=i + 1, y0=sl[0].start, y1=sl[0].stop, x0=sl[1].start, x1=sl[1].stop, area=int(mm.sum()), lum=float(im[sl][..., :3][mm].mean())))
comps.sort(key=lambda c: c['y0'])
top, body = comps[0], comps[-1]; mid = comps[1:-1]
def crop(c):
    sl = (slice(c['y0'], c['y1']), slice(c['x0'], c['x1'])); out = im[sl].copy(); out[lab[sl] != c['i']] = 0; return out
prem = lambda x: np.concatenate([x[..., :3] * x[..., 3:4], x[..., 3:4]], -1)
def over(t, b):
    ta = t[..., 3:4]; ba = b[..., 3:4]; oa = ta + ba * (1 - ta)
    return np.concatenate([(t[..., :3] * ta + b[..., :3] * ba * (1 - ta)) / np.maximum(oa, 1e-6), oa], -1)
PAD = 60
comp = np.zeros((top['y1'] - top['y0'] + 2 * PAD, top['x1'] - top['x0'] + 2 * PAD, 4), np.float32); comp[PAD:-PAD, PAD:-PAD] = crop(top)
Cp = prem(comp)
def search(P, base, under, cands, R, win):
    h, w = P.shape[:2]; best = (1e9, None)
    for cy0, cx0 in cands:
        for step, R2 in ((3, R), (1, 3)):
            if step == 1: cy0, cx0 = best[1]
            for dy in range(-R2, R2 + 1, step):
                for dx in range(-R2, R2 + 1, step):
                    y, x = int(cy0 + dy), int(cx0 + dx)
                    if y < 0 or x < 0 or y + h > comp.shape[0] or x + w > comp.shape[1]: continue
                    b = base[y:y + h, x:x + w]; exp = over(b, P) if under else over(P, b)
                    sc = float(((prem(exp) - Cp[y:y + h, x:x + w]) ** 2).sum(-1)[win].mean())
                    if sc < best[0]: best = (sc, (y, x))
    return best
B = crop(body); empty = np.zeros_like(comp)
bb = search(B, empty, False, [(PAD, PAD)], 20, B[..., 3] > 0.05)
base = np.zeros_like(comp); y, x = bb[1]; base[y:y + B.shape[0], x:x + B.shape[1]] = B
res = dict(comp=[top['y0'], top['x0'], top['y1'], top['x1']], body=dict(src=[body['y0'], body['x0'], body['y1'], body['x1']], at=[y - PAD + top['y0'], x - PAD + top['x0']]), parts=[])
print('body', res['body']['at'], bb[0])
Cfull = comp; lumc = comp[..., :3].mean(-1)
diff = np.abs(prem(comp) - prem(base)).max(-1); dmask = ndimage.binary_opening(diff > 0.12, iterations=2)
for c in mid:
    kind = 'eye' if c['area'] < 400 else ('flipper' if c['lum'] > 0.5 else 'foot')
    P = crop(c); h, w = P.shape[:2]; al = P[..., 3] > 0.3; ys, xs = np.nonzero(al)
    if kind == 'eye':   # 밝은 테두리에 둘러싸인 작은 어두운 점
        dm = (lumc < 0.25) & (comp[..., 3] > 0.8); el, en = ndimage.label(dm); bestr, ec = 0, None
        for i in range(en):
            r = el == i + 1; a_ = int(r.sum())
            if a_ < 40 or a_ > 900: continue
            ring = ndimage.binary_dilation(r, iterations=7) & ~ndimage.binary_dilation(r, iterations=2)
            rl = float(lumc[ring].mean()) * float((comp[..., 3][ring] > 0.8).mean())
            if rl > bestr: bestr, ec = rl, ndimage.center_of_mass(r)
        at = (ec[0] - ys.mean(), ec[1] - xs.mean())
    elif kind == 'foot':   # 보이는 발 덩어리의 아래 끝에 맞춤 (크기 순서 = 조각 순서 x)
        low = np.zeros_like(dmask); low[int(comp.shape[0] * 0.7):] = True
        fl, fn = ndimage.label(dmask & (lumc < 0.45) & low); bl = sorted([np.argwhere(fl == i + 1) for i in range(fn)], key=len)[-2:]
        if len(bl) == 1 or (len(bl) == 2 and len(bl[0]) < 0.25 * len(bl[1])):
            q0 = bl[-1]; mx = np.median(q0[:, 1]); bl = [q0[q0[:, 1] < mx], q0[q0[:, 1] >= mx]]
        bl.sort(key=lambda q: q[:, 1].mean()); feet = sorted([cc for cc in mid if cc['area'] >= 400 and cc['lum'] <= 0.5], key=lambda cc: cc['x0'])
        q = bl[feet.index(c)] if len(bl) == 2 else bl[0]
        at = (q[:, 0].max() - ys.max(), q[:, 1].mean() - xs[ys > ys.max() - 0.4 * (ys.max() - ys.min())].mean())
    else:   # 날개: 1/3 해상도에서 전체 탐색 → 원래 해상도에서 다듬기
        k = 3; Pd, Cd, Bd = P[::k, ::k], Cp[::k, ::k], base[::k, ::k]; wd = ndimage.binary_dilation(P[..., 3] > 0.05, iterations=6)[::k, ::k]
        hh, ww = Pd.shape[:2]; best = (1e9, None)
        for yy in range(0, Cd.shape[0] - hh):
            for xx in range(0, Cd.shape[1] - ww):
                ex = over(Pd, Bd[yy:yy + hh, xx:xx + ww]); sc = float(((prem(ex) - Cd[yy:yy + hh, xx:xx + ww]) ** 2).sum(-1)[wd].mean())
                if sc < best[0]: best = (sc, (yy * k, xx * k))
        b2 = search(P, base, False, [best[1]], 4, ndimage.binary_dilation(P[..., 3] > 0.05, iterations=6))
        at = b2[1]
    res['parts'].append(dict(kind=kind, src=[c['y0'], c['x0'], c['y1'], c['x1']], at=[int(at[0] - PAD + top['y0']), int(at[1] - PAD + top['x0'])]))
    print(kind, res['parts'][-1]['at'])
json.dump(res, open(OUT + 'idle_place.json', 'w'), indent=1)
# 확인 그림
can = np.zeros_like(comp)
def put(P, at, under=False):
    global can
    y, x = at[0] - top['y0'] + PAD, at[1] - top['x0'] + PAD; h, w = P.shape[:2]; L = np.zeros_like(can); L[y:y + h, x:x + w] = P[:can.shape[0] - y, :can.shape[1] - x]
    can = over(can, L) if under else over(L, can)
srcs = {tuple(c2['src']): c for c in mid for c2 in res['parts'] if c2['src'] == [c['y0'], c['x0'], c['y1'], c['x1']]}
for p in res['parts']:
    if p['kind'] == 'foot': put(crop(srcs[tuple(p['src'])]), p['at'])
put(B, res['body']['at'])
for p in res['parts']:
    if p['kind'] != 'foot': put(crop(srcs[tuple(p['src'])]), p['at'])
row = np.concatenate([comp, can], 1); bg = np.array([0.35, 0.43, 0.55])
Image.fromarray(((row[..., :3] * row[..., 3:4] + bg * (1 - row[..., 3:4])) * 255).astype(np.uint8)).resize((row.shape[1] // 2, row.shape[0] // 2)).save(OUT + 'idle_check.png')
