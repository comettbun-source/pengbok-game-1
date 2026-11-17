import numpy as np, json
from PIL import Image
from scipy import ndimage
SRC = 'assets/penguin/source_sheet.png'
OUT = 'tools/penguin_art/work/'
im = np.array(Image.open(SRC)).astype(np.float32) / 255.0
M = json.load(open(OUT + 'match.json'))
prem = lambda x: np.concatenate([x[..., :3] * x[..., 3:4], x[..., 3:4]], -1)
def over(t, b):
    ta = t[..., 3:4]; ba = b[..., 3:4]; oa = ta + ba * (1 - ta)
    return np.concatenate([(t[..., :3] * ta + b[..., :3] * ba * (1 - ta)) / np.maximum(oa, 1e-6), oa], -1)
def get(src):
    y0, x0, y1, x1 = src; P = im[y0:y1, x0:x1].copy()
    # 같은 상자 안 다른 조각 제거: 가장 큰 연결 성분만
    lab, n = ndimage.label(ndimage.binary_dilation(P[..., 3] > 0.03, iterations=3))
    if n > 1:
        sizes = ndimage.sum(np.ones_like(lab), lab, range(1, n + 1)); keep = 1 + int(np.argmax(sizes)); P[lab != keep] = 0
    return P
PAD = 60
for e in M:
    y0, x0, y1, x1 = e['comp']
    comp = np.zeros((y1 - y0 + 2 * PAD, x1 - x0 + 2 * PAD, 4), np.float32); comp[PAD:-PAD, PAD:-PAD] = im[y0:y1, x0:x1]
    body = get(e['body']['src']); base = np.zeros_like(comp); base[PAD:PAD + body.shape[0], PAD:PAD + body.shape[1]] = body[:comp.shape[0] - PAD, :comp.shape[1] - PAD]
    d = np.abs(prem(comp) - prem(base)).max(-1)
    mask = ndimage.binary_opening(d > 0.12, iterations=2)
    lab, n = ndimage.label(mask); objs = ndimage.find_objects(lab)
    blobs = []
    for i, sl in enumerate(objs):
        a = int((lab[sl] == i + 1).sum());
        if a < 40: continue
        cy, cx = ndimage.center_of_mass(lab == i + 1)
        lum = float(comp[..., :3][lab == i + 1].mean())
        blobs.append(dict(a=a, cy=cy, cx=cx, lum=lum, sl=(sl[0].start, sl[0].stop, sl[1].start, sl[1].stop)))
    e['blobs'] = blobs
    Cp = prem(comp)
    dark = [b for b in blobs if b['lum'] < 0.45]
    # 눈: 합성에서 '밝은 테두리에 둘러싸인 작은 어두운 점'
    lumc = comp[..., :3].mean(-1); dm = (lumc < 0.25) & (comp[..., 3] > 0.8)
    dl, dn = ndimage.label(dm); eyec = None; bestr = 0
    for i in range(dn):
        r = dl == i + 1; a_ = int(r.sum())
        if a_ < 40 or a_ > 900: continue
        ring = ndimage.binary_dilation(r, iterations=7) & ~ndimage.binary_dilation(r, iterations=2)
        rl = float(lumc[ring].mean()) * float((comp[..., 3][ring] > 0.8).mean())
        if rl > bestr: bestr = rl; eyec = ndimage.center_of_mass(r)
    eyeb = [dict(cy=eyec[0], cx=eyec[1])] if eyec else []
    diag = np.hypot(*comp.shape[:2])
    footb = [b for b in dark if b['a'] >= 150 and (not eyec or np.hypot(b['cy'] - eyec[0], b['cx'] - eyec[1]) > 0.33 * diag)]
    feet = [p for p in e['parts'] if p['kind'] == 'foot']
    # 발 덩어리가 발 개수보다 적으면(붙어 있으면) 큰 덩어리를 x 중앙에서 둘로 나눔
    fm = np.zeros(mask.shape, bool)
    for b in footb: y0b, y1b, x0b, x1b = b['sl']; fm[y0b:y1b, x0b:x1b] |= mask[y0b:y1b, x0b:x1b]
    fl, fn = ndimage.label(fm)
    fbl = [np.argwhere(fl == i + 1) for i in range(fn)]
    fbl = [q for q in fbl if len(q) > 150]
    while len(fbl) < len(feet) and fbl:
        q = max(fbl, key=len); fbl.remove(q); mx = np.median(q[:, 1]); fbl += [q[q[:, 1] < mx], q[q[:, 1] >= mx]]
    fbl.sort(key=lambda q: q[:, 1].mean())
    fsorted = sorted(feet, key=lambda p: p['src'][1])
    for p in e['parts']:
        P = get(p['src']); h, w = P.shape[:2]; kind = p['kind']
        al = P[..., 3] > 0.3
        if kind == 'eye' and eyeb:
            b0 = eyeb[0]; ys, xs = np.nonzero(al); p['at'] = [int(b0['cy'] - ys.mean() - PAD + y0), int(b0['cx'] - xs.mean() - PAD + x0)]; print(e['col'], 'eye*', p['at']); continue
        if kind == 'foot' and len(fbl) >= len(feet):
            q = fbl[fsorted.index(p)]; ys, xs = np.nonzero(al)
            by = q[:, 0].max(); bx = q[:, 1].mean(); p['at'] = [int(by - ys.max() - PAD + y0), int(bx - xs[ys > ys.max() - 0.4 * (ys.max() - ys.min())].mean() - PAD + x0)]; print(e['col'], 'foot*', p['at']); continue
        # 후보 중심: 눈 = 작은 어두운 덩어리, 발 = 아래쪽 어두운 덩어리, 날개 = 밝은 덩어리(없으면 전체 탐색)
        if kind == 'eye': cands = [b for b in blobs if b['a'] < 2500 and b['lum'] < 0.4]
        elif kind == 'foot': cands = [b for b in blobs if b['lum'] < 0.45 and b['a'] >= 300]
        else: cands = [b for b in blobs if b['lum'] >= 0.45 and b['a'] >= 300]
        win = ndimage.binary_dilation(P[..., 3] > 0.05, iterations=6)
        vis = mask  # 부위가 보이는 곳에서만 비교
        best = (1e9, None)
        centers = [(b['cy'] - h / 2, b['cx'] - w / 2, 30) for b in cands] + [(b['sl'][1] - h, b['cx'] - w / 2, 30) for b in cands if kind == 'foot']
        if not centers: centers = [(comp.shape[0] / 2 - h / 2, comp.shape[1] / 2 - w / 2, 150)]
        for cy0, cx0, R in centers:
            for step, R2 in ((4, R), (1, 4)):
                if step == 1: cy0, cx0 = best[1]
                for dy in range(-R2, R2 + 1, step):
                    for dx in range(-R2, R2 + 1, step):
                        y, x = int(cy0 + dy), int(cx0 + dx)
                        if y < 0 or x < 0 or y + h > comp.shape[0] or x + w > comp.shape[1]: continue
                        b = base[y:y + h, x:x + w]
                        exp = over(b, P) if kind == 'foot' else over(P, b)
                        diff = ((prem(exp) - Cp[y:y + h, x:x + w]) ** 2).sum(-1)
                        sc = float(diff[win].mean()) - 0.02 * float((vis[y:y + h, x:x + w] & (P[..., 3] > 0.5)).mean())
                        if sc < best[0]: best = (sc, (y, x))
        p['at'] = [int(best[1][0] - PAD + y0), int(best[1][1] - PAD + x0)]; p['err'] = best[0]
        print(e['col'], kind, p['at'], round(best[0], 5), len(cands))
for p in M[1]['parts']:
    if p['kind'] == 'flipper': p['at'] = [487, 1131]   # 수동 보정 (자동 매칭이 몸 위 날개를 너무 아래로 잡음)
json.dump(M, open(OUT + 'place.json', 'w'), indent=1)
# 재조립 확인: 원본 합성 | 재조립
tiles = []
for e in M:
    y0, x0, y1, x1 = e['comp']; H, W = y1 - y0 + 2 * PAD, x1 - x0 + 2 * PAD
    can = np.zeros((H, W, 4), np.float32)
    def put(P, at, under=False):
        global can
        y, x = at[0] - y0 + PAD, at[1] - x0 + PAD; h, w = P.shape[:2]
        layer = np.zeros_like(can); layer[y:y + h, x:x + w] = P[:H - y, :W - x]
        can = over(can, layer) if under else over(layer, can)
    for p in e['parts']:
        if p['kind'] == 'foot': put(get(p['src']), p['at'])
    put(get(e['body']['src']), e['body']['at'])
    for p in e['parts']:
        if p['kind'] != 'foot': put(get(p['src']), p['at'])
    orig = np.zeros_like(can); orig[PAD:-PAD, PAD:-PAD] = im[y0:y1, x0:x1]
    row = np.concatenate([orig, can], 0)
    bg = np.array([0.35, 0.43, 0.55]); rgb = row[..., :3] * row[..., 3:4] + bg * (1 - row[..., 3:4])
    tiles.append(Image.fromarray((rgb * 255).astype(np.uint8)).resize((W // 3, 2 * H // 3)))
o = Image.new('RGB', (sum(t.width for t in tiles), max(t.height for t in tiles))); x = 0
for t in tiles: o.paste(t, (x, 0)); x += t.width
o.save(OUT + 'reassembled.png')
