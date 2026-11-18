# 새 원화(IMG_6156)의 5번째 칸: 똑바로 선 걷기 자세 → assets/penguin/source_walk.png 로 잘라 둔 것
# 조각(몸·발 2·날개·눈)을 합성 그림에 맞춰 위치를 찾아 work/walk_place.json (place.json 과 같은 형식) 으로 저장 → atlas.py 가 포즈 9 로 붙임
import numpy as np, json
from PIL import Image
from scipy import ndimage
SRC = 'assets/penguin/source_walk.png'; OUT = 'tools/penguin_art/work/'
im = np.array(Image.open(SRC)).astype(np.float32) / 255.0
m = im[..., 3] > 0.03
lab, n = ndimage.label(ndimage.binary_dilation(m, iterations=3))
comps = []
for i, sl in enumerate(ndimage.find_objects(lab)):
    mm = (lab[sl] == i + 1) & m[sl]
    if mm.sum() < 50: continue
    comps.append(dict(i=i + 1, y0=sl[0].start, y1=sl[0].stop, x0=sl[1].start, x1=sl[1].stop, area=int(mm.sum()), lum=float(im[sl][..., :3][mm].mean())))
top = min([c for c in comps if c['y0'] < 1000], key=lambda c: -c['area'])
low = [c for c in comps if c['y0'] >= 1000]
body = max(low, key=lambda c: c['area'])
prem = lambda x: np.concatenate([x[..., :3] * x[..., 3:4], x[..., 3:4]], -1)
def over(t, b):
    ta = t[..., 3:4]; ba = b[..., 3:4]; oa = ta + ba * (1 - ta)
    return np.concatenate([(t[..., :3] * ta + b[..., :3] * ba * (1 - ta)) / np.maximum(oa, 1e-6), oa], -1)
def crop(c):
    sl = (slice(c['y0'], c['y1']), slice(c['x0'], c['x1'])); out = im[sl].copy(); out[lab[sl] != c['i']] = 0; return out
PAD = 80
comp = np.zeros((top['y1'] - top['y0'] + 2 * PAD, top['x1'] - top['x0'] + 2 * PAD, 4), np.float32); comp[PAD:-PAD, PAD:-PAD] = crop(top)
B = crop(body); Cp = prem(comp)
# 몸 위치: 합성 그림 왼쪽 위 근처에서 몸 안쪽(가장자리 제외)이 가장 잘 맞는 곳
core = ndimage.binary_erosion(B[..., 3] > 0.9, iterations=12); bbest = (1e9, None)
for dy in range(-60, 61, 2):
    for dx in range(-40, 41, 2):
        y, x = PAD + dy, PAD + dx
        if y < 0 or x < 0: continue
        hh = min(B.shape[0], comp.shape[0] - y); ww = min(B.shape[1], comp.shape[1] - x)
        cm = core[:hh, :ww]; sc = float(((prem(B[:hh, :ww]) - Cp[y:y + hh, x:x + ww]) ** 2).sum(-1)[cm].mean())
        if sc < bbest[0]: bbest = (sc, (dy, dx))
bdy, bdx = bbest[1]; print('body offset', bbest)
base = np.zeros_like(comp); hh = min(B.shape[0], comp.shape[0] - PAD - bdy); ww = min(B.shape[1], comp.shape[1] - PAD - bdx); base[PAD + bdy:PAD + bdy + hh, PAD + bdx:PAD + bdx + ww] = B[:hh, :ww]
entry = dict(col=9, comp=[top['y0'], top['x0'], top['y1'], top['x1']], body=dict(src=[body['y0'], body['x0'], body['y1'], body['x1']], at=[top['y0'] + bdy, top['x0'] + bdx]), parts=[])
# 발: 합성에서 몸 밖으로 보이는 어두운 덩어리 (x 순서대로 발 조각과 짝)
dmask = (np.abs(prem(comp) - prem(base)).max(-1) > 0.12) & (comp[..., :3].mean(-1) < 0.45) & (comp[..., 3] > 0.5)
dl, dn = ndimage.label(ndimage.binary_opening(dmask, iterations=2))
fbl = [np.argwhere(dl == i + 1) for i in range(dn)]; fbl = [q for q in fbl if len(q) > 150 and q[:, 0].mean() > comp.shape[0] * 0.6]
feetc = sorted([c for c in low if c is not body and c['area'] >= 400 and c['lum'] <= 0.6], key=lambda c: c['x0'])
while len(fbl) < len(feetc) and fbl:
    q = max(fbl, key=len); fbl.remove(q); mx = np.median(q[:, 1]); fbl += [q[q[:, 1] < mx], q[q[:, 1] >= mx]]
fbl.sort(key=lambda q: q[:, 1].mean()); print('foot blobs', [(int(q[:, 0].mean()), int(q[:, 1].mean()), len(q)) for q in fbl])
for c in low:
    if c is body: continue
    kind = 'eye' if c['area'] < 400 else ('flipper' if c['lum'] > 0.6 else 'foot')
    if kind == 'foot' and len(fbl) >= len(feetc):
        q = fbl[feetc.index(c)]; P = crop(c); al = P[..., 3] > 0.3; ys, xs = np.nonzero(al)
        by = q[:, 0].max(); bx = q[:, 1].mean()
        at = [int(by - ys.max() - PAD + top['y0']), int(bx - xs[ys > ys.max() - 0.4 * (ys.max() - ys.min())].mean() - PAD + top['x0'])]
        entry['parts'].append(dict(kind=kind, src=[c['y0'], c['x0'], c['y1'], c['x1']], at=at)); print('foot*', at); continue
    P = crop(c); h, w = P.shape[:2]; win = ndimage.binary_dilation(P[..., 3] > 0.05, iterations=10 if kind == 'eye' else 6)
    if kind == 'eye':   # 합성에서 밝은 테두리에 둘러싸인 작은 어두운 점
        lumc = comp[..., :3].mean(-1); dm = (lumc < 0.25) & (comp[..., 3] > 0.8); el, en = ndimage.label(dm); eyec = None; br = 0
        for i in range(en):
            r = el == i + 1; a_ = int(r.sum())
            if a_ < 40 or a_ > 900: continue
            ring = ndimage.binary_dilation(r, iterations=7) & ~ndimage.binary_dilation(r, iterations=2)
            rl = float(lumc[ring].mean()) * float((comp[..., 3][ring] > 0.8).mean())
            if rl > br: br = rl; eyec = ndimage.center_of_mass(r)
        ys, xs = np.nonzero(P[..., 3] > 0.3); at = [int(eyec[0] - ys.mean() - PAD + top['y0']), int(eyec[1] - xs.mean() - PAD + top['x0'])]
        entry['parts'].append(dict(kind=kind, src=[c['y0'], c['x0'], c['y1'], c['x1']], at=at)); print('eye*', at); continue
    if kind == 'flipper':   # 합성과 맨몸이 다른 곳 중 밝은 큰 덩어리 = 날개 자리 → 무게중심 맞춤 후 주변 정밀 탐색
        dm = ndimage.binary_opening((np.abs(prem(comp) - prem(base)).max(-1) > 0.04) & (comp[..., :3].mean(-1) >= 0.45), iterations=2)
        fl, fn = ndimage.label(dm); sizes = ndimage.sum(dm, fl, range(1, fn + 1)); k = 1 + int(np.argmax(sizes)); cy, cx = ndimage.center_of_mass(fl == k)
        ys, xs = np.nonzero(P[..., 3] > 0.3); y0g, x0g = int(cy - ys.mean()), int(cx - xs.mean()); best = (1e9, (y0g, x0g))
        for y in range(y0g - 30, y0g + 31, 2):
            for x in range(x0g - 30, x0g + 31, 2):
                if y < 0 or x < 0 or y + h > comp.shape[0] or x + w > comp.shape[1]: continue
                sc = float(((prem(over(P, base[y:y + h, x:x + w])) - Cp[y:y + h, x:x + w]) ** 2).sum(-1)[win].mean())
                if sc < best[0]: best = (sc, (y, x))
        at = [int(best[1][0] - PAD + top['y0']), int(best[1][1] - PAD + top['x0'])]
        entry['parts'].append(dict(kind=kind, src=[c['y0'], c['x0'], c['y1'], c['x1']], at=at)); print('flipper*', at, 'blob', int(cy), int(cx), best[0]); continue
    best = (1e9, None)
    for step, around in ((3, None), (1, 4)):
        ys = range(0, comp.shape[0] - h, step) if around is None else range(best[1][0] - around, best[1][0] + around + 1)
        xs = range(0, comp.shape[1] - w, step) if around is None else range(best[1][1] - around, best[1][1] + around + 1)
        for y in ys:
            for x in xs:
                if y < 0 or x < 0 or y + h > comp.shape[0] or x + w > comp.shape[1]: continue
                b = base[y:y + h, x:x + w]; exp = over(b, P) if kind == 'foot' else over(P, b)
                sc = float(((prem(exp) - Cp[y:y + h, x:x + w]) ** 2).sum(-1)[win].mean())
                if sc < best[0]: best = (sc, (y, x))
    entry['parts'].append(dict(kind=kind, src=[c['y0'], c['x0'], c['y1'], c['x1']], at=[int(best[1][0] - PAD + top['y0']), int(best[1][1] - PAD + top['x0'])], err=round(best[0], 5)))
    print(kind, entry['parts'][-1])
for p in entry['parts']:
    if p['kind'] == 'flipper': p['at'] = [627, 203]   # 수동 보정: 원화의 날개(회색)가 조각보다 진해 자동 맞춤이 어긋남 → 합성 그림 날개 자리에 맞춤
json.dump(entry, open(OUT + 'walk_place.json', 'w'), indent=1)
# 확인용: 원본 | 재조립
can = np.zeros_like(comp)
def put(P, at, under):
    global can
    y, x = at[0] - top['y0'] + PAD, at[1] - top['x0'] + PAD; layer = np.zeros_like(can); layer[y:y + P.shape[0], x:x + P.shape[1]] = P
    can = over(can, layer) if under else over(layer, can)
cmap = {(c['y0'], c['x0']): c for c in comps}
for p in entry['parts']:
    if p['kind'] == 'foot': put(crop(cmap[tuple(p['src'][:2])]), p['at'], False)
put(B, entry['body']['at'], False)
for p in entry['parts']:
    if p['kind'] != 'foot': put(crop(cmap[tuple(p['src'][:2])]), p['at'], False)
row = np.concatenate([comp, can], 1); bg = np.array([0.35, 0.43, 0.55]); rgb = row[..., :3] * row[..., 3:4] + bg * (1 - row[..., 3:4])
Image.fromarray((rgb * 255).astype(np.uint8)).save(OUT + 'walk_check.png')
