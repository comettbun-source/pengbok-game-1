# 걷기 컷(포즈 2·3·9) 발: 잘리지 않은 발 조각(원화 가운데 줄)을 돌리고 옮겨, 합성 그림(완성본)에서 배 밖으로 보이는 발과 똑같이 맞춤
# → 배에 가려진 부분까지 온전한 발이라, 걸을 때 발이 움직여도 잘린 끝이 배 밖으로 튀어나오지 않음. 결과: work/feet_fit.json (atlas.py 가 사용)
import numpy as np, json
from PIL import Image
from scipy import ndimage
OUT = 'tools/penguin_art/work/'
M = json.load(open(OUT + 'place.json')); W = json.load(open(OUT + 'walk_place.json'))
prem = lambda x: np.concatenate([x[..., :3] * x[..., 3:4], x[..., 3:4]], -1)
def over(t, b):
    ta = t[..., 3:4]; ba = b[..., 3:4]; oa = ta + ba * (1 - ta)
    return np.concatenate([(t[..., :3] * ta + b[..., :3] * ba * (1 - ta)) / np.maximum(oa, 1e-6), oa], -1)
def get(im, src):
    y0, x0, y1, x1 = src; P = im[y0:y1, x0:x1].copy()
    lab, n = ndimage.label(ndimage.binary_dilation(P[..., 3] > 0.03, iterations=3))
    if n > 1: sizes = ndimage.sum(np.ones_like(lab), lab, range(1, n + 1)); P[lab != 1 + int(np.argmax(sizes))] = 0
    return P
def rot(P, a):   # 알파 곱한 상태로 돌림 (가장자리 번짐 없이)
    if a == 0: return P
    Q = ndimage.rotate(prem(P), a, reshape=True, order=1, mode='constant'); al = Q[..., 3:4]
    return np.concatenate([Q[..., :3] / np.maximum(al, 1e-6), al], -1).clip(0, 1)
res = {}
for name, e, path in [('2', M[2], 'assets/penguin/source_sheet.png'), ('3', M[3], 'assets/penguin/source_sheet.png'), ('9', W, 'assets/penguin/source_walk.png')]:
    im = np.array(Image.open(path)).astype(np.float32) / 255.0
    y0, x0, y1, x1 = e['comp']; PAD = 120
    comp = np.zeros((y1 - y0 + 2 * PAD, x1 - x0 + 2 * PAD, 4), np.float32); comp[PAD:-PAD, PAD:-PAD] = im[y0:y1, x0:x1]
    B = get(im, e['body']['src']); base = np.zeros_like(comp); by, bx = e['body']['at'][0] - y0 + PAD, e['body']['at'][1] - x0 + PAD
    hh = min(B.shape[0], comp.shape[0] - by); ww = min(B.shape[1], comp.shape[1] - bx); base[by:by + hh, bx:bx + ww] = B[:hh, :ww]
    Cp = prem(comp)
    lum = comp[..., :3].mean(-1); dark = (lum < 0.4) & (comp[..., 3] > 0.5); dark[:int(comp.shape[0] * 0.7)] = False
    lab, n = ndimage.label(dark); blobs = [np.argwhere(lab == i + 1) for i in range(n)]; blobs = [q for q in blobs if len(q) > 300]
    feet = sorted([p for p in e['parts'] if p['kind'] == 'foot'], key=lambda p: p['at'][1])
    while len(blobs) < len(feet):
        q = max(blobs, key=len); blobs.remove(q); mx = np.median(q[:, 1]); blobs += [q[q[:, 1] < mx], q[q[:, 1] >= mx]]
    blobs.sort(key=lambda q: q[:, 1].mean())
    fits = []
    for fi, (p, q) in enumerate(zip(feet, blobs)):
        P0 = get(im, p['src']); others = np.zeros(comp.shape[:2], bool)
        for q2 in blobs:
            if q2 is not q: others[q2[:, 0], q2[:, 1]] = True
        ry0, ry1, rx0, rx1 = q[:, 0].min() - 40, q[:, 0].max() + 40, q[:, 1].min() - 60, q[:, 1].max() + 60
        roi = ~ndimage.binary_dilation(others, iterations=4)[ry0:ry1, rx0:rx1]
        Cr = Cp[ry0:ry1, rx0:rx1]; Br = base[ry0:ry1, rx0:rx1]; cy, cx = q[:, 0].mean(), q[:, 1].mean()
        best = (1e9, None)
        def score(a, dy, dx, Pr):
            h, w = Pr.shape[:2]; ty, tx = int(cy - h / 2 + dy) - ry0, int(cx - w / 2 + dx) - rx0
            L = np.zeros(Cr.shape, np.float32); sy0, sx0 = max(0, -ty), max(0, -tx); ey, ex = min(h, L.shape[0] - ty), min(w, L.shape[1] - tx)
            if ey > sy0 and ex > sx0: L[ty + sy0:ty + ey, tx + sx0:tx + ex] = Pr[sy0:ey, sx0:ex]
            return float(((prem(over(Br, L)) - Cr) ** 2).sum(-1)[roi].mean()), (ty + ry0, tx + rx0)
        for a in range(-40, 41, 4):
            Pr = rot(P0, a)
            for dy in range(-40, 41, 4):
                for dx in range(-70, 71, 4):
                    sc, at = score(a, dy, dx, Pr)
                    if sc < best[0]: best = (sc, (a, dy, dx))
        a0, dy0, dx0 = best[1]
        for a in range(a0 - 3, a0 + 4):
            Pr = rot(P0, a)
            for dy in range(dy0 - 3, dy0 + 4):
                for dx in range(dx0 - 3, dx0 + 4):
                    sc, at = score(a, dy, dx, Pr)
                    if sc < best[0]: best = (sc, (a, dy, dx))
        a, dy, dx = best[1]; Pr = rot(P0, a); _, at = score(a, dy, dx, Pr)
        fits.append(dict(src=p['src'], angle=a, at=[int(at[0] - PAD + y0), int(at[1] - PAD + x0)], err=round(best[0], 5)))
        print(name, fi, fits[-1])
    res[name] = fits
    # 확인 그림: 원화 | 맞춘 발 + 몸
    can = base.copy()
    for f in fits:
        Pr = rot(get(im, f['src']), f['angle']); ty, tx = f['at'][0] - y0 + PAD, f['at'][1] - x0 + PAD
        L = np.zeros_like(can); L[ty:ty + Pr.shape[0], tx:tx + Pr.shape[1]] = Pr[:can.shape[0] - ty, :can.shape[1] - tx]; can = over(can, L)
    row = np.concatenate([comp, can], 1); bg = np.array([0.35, 0.43, 0.55]); rgb = row[..., :3] * row[..., 3:4] + bg * (1 - row[..., 3:4])
    Image.fromarray((rgb * 255).astype(np.uint8)).save(OUT + f'feet_fit_{name}.png')
json.dump(res, open(OUT + 'feet_fit.json', 'w'), indent=1)
