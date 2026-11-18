import numpy as np, json, base64, io
from PIL import Image
from scipy import ndimage
SRC = 'assets/penguin/source_sheet.png'
OUT = 'tools/penguin_art/work/'
REPO = './'
WHITE = 218  # 레벨: 이 밝기 이상은 흰색으로 (원화 흰 몸 ≈ 205 → 게임 안개·밤빛 아래서도 얼굴이 하얗게). 검정은 그대로
src = Image.open(SRC); im = np.array(src)
im[..., :3] = np.clip(im[..., :3].astype(np.float32) * (255.0 / WHITE), 0, 255).astype(np.uint8)
M = json.load(open(OUT + 'place.json'))
S = 0.42   # 축소 배율 (원본 ≈ 600px 키 → 약 250px)
def get(r, opaque=False):
    y0, x0, y1, x1 = r; P = im[y0:y1, x0:x1].copy()
    if opaque:
        P[..., 3] = np.clip(P[..., 3].astype(np.float32) * 2.6, 0, 255).astype(np.uint8)   # 날개: 반투명 부분을 불투명하게 (들어 올려도 비치지 않게)
        core = ndimage.binary_erosion(P[..., 3] > 128, iterations=6); band = (P[..., 3] > 0) & ~core   # 날개 가장자리 띠의 어두운 윤곽선 → 밝게 (가로 날개일 때 가로선으로 보임)
        P[..., :3][band] = np.maximum(P[..., :3][band], 214)
    lab, n = ndimage.label(ndimage.binary_dilation(P[..., 3] > 8, iterations=3))
    if n > 1:
        sizes = ndimage.sum(np.ones_like(lab), lab, range(1, n + 1)); keep = 1 + int(np.argmax(sizes)); P[lab != keep] = 0
    return P
pieces = []; frames = []
unit = None
def lev(a):
    a = a.copy(); a[..., :3] = np.clip(a[..., :3].astype(np.float32) * (255.0 / WHITE), 0, 255).astype(np.uint8); return a
im_main = im
im_idle = lev(np.array(Image.open('assets/penguin/source_idle.png')))
IDLE = json.load(open(OUT + 'idle_place.json'))
im_walk = lev(np.array(Image.open('assets/penguin/source_walk.png')))
WALK = json.load(open(OUT + 'walk_place.json'))   # walk_place.py: 새 원화 5번째 칸 (똑바로 선 걷기 자세)
FEET_FROM_COMP = [2, 3]   # 걷기 컷(+ 포즈 9): 발을 합성 그림에서 떼어 씀
for e in M + [IDLE, WALK]:   # 포즈 0~7 + 8 = 가만히 서 있음 (source_idle.png, 같은 축척) + 9 = 똑바로 선 걷기 (source_walk.png)
    im = im_idle if e is IDLE else (im_walk if e is WALK else im_main)
    y0, x0, y1, x1 = e['comp']
    ca = im[y0:y1, x0:x1, 3] > 30
    ys, xs = np.nonzero(ca)
    by0, bx0, by1, bx1 = e['body']['src']; bA = im[by0:by1, bx0:bx1, 3] > 30; bys, bxs = np.nonzero(bA)
    anchor = (y0 + ys.max(), e['body']['at'][1] + (bxs.min() + bxs.max()) / 2)   # 발바닥(합성 맨 아래) · 몸 가운데 x
    if unit is None: unit = ys.max() - ys.min()   # 첫 포즈(서 있음) 키 = 1
    fr = dict(parts=[])
    def add(kind, r, at, pivot=None, P=None):
        if P is None: P = get(r, opaque=(kind == 'flipper'))
        img = Image.fromarray(P).resize((max(1, round(P.shape[1] * S)), max(1, round(P.shape[0] * S))), Image.LANCZOS)
        pieces.append(img); idx = len(pieces) - 1
        d = dict(kind=kind, i=idx, x=(at[1] - anchor[1]) / unit, y=(at[0] - anchor[0]) / unit, w=P.shape[1] / unit, h=P.shape[0] / unit)
        if pivot is not None: d['px'] = pivot[0] / P.shape[1]; d['py'] = pivot[1] / P.shape[0]
        fr['parts'].append(d)
    if e is IDLE:   # 가만히: 원본 합성 그림 한 장 그대로 (조각 재조립 시 발이 어긋나 보여서) + 눈 위치(깜빡임)
        add('whole', e['comp'], [y0, x0])
        ep = [p for p in e['parts'] if p['kind'] == 'eye'][0]; E = get(ep['src']); ea = E[..., 3] > 100; eyy, exx = np.nonzero(ea)
        P0 = im[y0:y1, x0:x1]; face = P0[..., :3][(P0[..., 3] > 250) & (P0[..., :3].mean(-1) > 225)].mean(0).astype(int).tolist()
        fr['parts'][-1]['eye'] = dict(x=(ep['at'][1] + exx.mean() - anchor[1]) / unit, y=(ep['at'][0] + eyy.mean() - anchor[0]) / unit, rx=(exx.max() - exx.min() + 1) / 2 / unit, ry=(eyy.max() - eyy.min() + 1) / 2 / unit, face=face)
        frames.append(fr); continue
    if (e is WALK or M.index(e) in FEET_FROM_COMP) if e is not IDLE else False:
        # 걷기 컷: 발을 합성 그림(원화 완성본)에서 바로 떼어 씀 → 조각 발의 각도·길이가 원화와 달라 발이 길어지거나 배에서 떨어져 보이던 문제 없음
        C0 = im[y0:y1, x0:x1].astype(np.float32); lum = C0[..., :3].mean(-1); hh = C0.shape[0]
        core = (lum < 90) & (C0[..., 3] > 120); core[:int(hh * 0.75)] = False
        lab2, n2 = ndimage.label(core); sizes = ndimage.sum(core, lab2, range(1, n2 + 1)); core = np.isin(lab2, 1 + np.nonzero(sizes > 300)[0])
        # 발 하나씩 따로 (걸을 때 번갈아 움직이게): 덩어리별로, 붙어 있으면 x 가운데에서 둘로
        lab3, n3 = ndimage.label(core); blobs = [lab3 == i + 1 for i in range(n3)]
        if len(blobs) == 1:
            ys_, xs_ = np.nonzero(blobs[0]); mx = np.median(xs_); L0 = blobs[0].copy(); L0[:, int(mx):] = False; R0 = blobs[0].copy(); R0[:, :int(mx)] = False; blobs = [L0, R0]
        blobs.sort(key=lambda b_: np.nonzero(b_)[1].mean())
        taken = np.zeros_like(core)
        for k_, b_ in enumerate(blobs):
            reg = ndimage.binary_dilation(b_, iterations=6) & ~taken
            if k_ < len(blobs) - 1: taken |= reg
            fy, fx = np.nonzero(reg)
            FP = im[y0:y1, x0:x1].copy(); FP[~reg] = 0; FP = FP[fy.min():fy.max() + 1, fx.min():fx.max() + 1]
            fl_ = FP[..., :3].astype(np.float32).mean(-1); FP[..., 3] = (FP[..., 3] * np.clip((170 - fl_) / 70, 0, 1)).astype(np.uint8)   # 흰 몸 가장자리는 빼고 검은 발만 (발이 움직일 때 흰 줄이 보이지 않게)
            ay, ax = np.nonzero(FP[..., 3] > 60); topy = ay.min()
            add('foot', None, [y0 + fy.min(), x0 + fx.min()], (ax[ay <= topy + 0.3 * (ay.max() - topy)].mean(), topy), P=FP)   # 회전축: 발 윗부분 (몸에 붙은 쪽)
    else:
      for p in e['parts']:
        if p['kind'] == 'foot':
            P = get(p['src']); a = P[..., 3] > 60; yy, xx = np.nonzero(a); top = yy.min() + 0.15 * (yy.max() - yy.min())
            add('foot', p['src'], p['at'], (xx[yy <= top].mean(), top))
    add('body', e['body']['src'], e['body']['at'])
    for p in e['parts']:
        if p['kind'] == 'flipper':
            P = get(p['src']); a = P[..., 3] > 60; yy, xx = np.nonzero(a); k = np.argmin(xx + yy * 0.6)   # 어깨 쪽 끝 (머리 쪽 위)
            add('flipper', p['src'], p['at'], (float(xx[k]) + 0.12 * (xx.max() - xx.min()), float(yy[k])))
        if p['kind'] == 'eye': add('eye', p['src'], p['at'])
    frames.append(fr)
# ── 정면 포즈 (assets/penguin/source_front.png): 0 = 앉아 있음, 1 = 서 있음(날개 하나 듦). 합성 그림을 통째로 + 눈 위치(깜빡임용)
FS = 'assets/penguin/source_front.png'
fim = np.array(Image.open(FS)); fim[..., :3] = np.clip(fim[..., :3].astype(np.float32) * (255.0 / WHITE), 0, 255).astype(np.uint8)
fm = fim[..., 3] > 8
flab, fn = ndimage.label(ndimage.binary_dilation(fm, iterations=3))
fcomps = []
for i, sl in enumerate(ndimage.find_objects(flab)):
    if sl is None: continue
    a_ = int(((flab[sl] == i + 1) & fm[sl]).sum())
    if a_ > 50000 and sl[0].start < 800: fcomps.append((sl, i + 1))
fcomps.sort(key=lambda c: c[0][1].start)
front = {}
FU = None
for name, (sl, li) in zip(['sit', 'stand'], fcomps):
    P = fim[sl].copy(); P[flab[sl] != li] = 0
    a = P[..., 3] > 30; ys, xs = np.nonzero(a)
    if name == 'stand' or FU is None: pass
    front[name] = dict(P=P, bottom=ys.max(), cx=(xs.min() + xs.max()) / 2, h=ys.max() - ys.min())
FU = front['stand']['h']   # 정면 서 있는 키 = 1
for name, d in front.items():
    P = d['P']; lum = P[..., :3].mean(-1); dm = (lum < 60) & (P[..., 3] > 200)
    el, en = ndimage.label(dm); eyes = []
    for i in range(en):
        r = el == i + 1; a_ = int(r.sum())
        if a_ < 60 or a_ > 1500: continue
        ring = ndimage.binary_dilation(r, iterations=6) & ~ndimage.binary_dilation(r, iterations=2)
        if lum[ring].mean() < 180: continue
        yy, xx = np.nonzero(r); eyes.append(dict(x=(xx.mean() - d['cx']) / FU, y=(yy.mean() - d['bottom']) / FU, rx=(xx.max() - xx.min() + 1) / 2 / FU, ry=(yy.max() - yy.min() + 1) / 2 / FU))
    face = P[..., :3][(P[..., 3] > 250) & (lum > 200)].mean(0).astype(int).tolist()
    img = Image.fromarray(P).resize((round(P.shape[1] * S * 597 / FU), round(P.shape[0] * S * 597 / FU)), Image.LANCZOS)
    pieces.append(img)
    d['out'] = dict(i=len(pieces) - 1, x=-d['cx'] / FU, y=-d['bottom'] / FU, w=P.shape[1] / FU, h=P.shape[0] / FU, eyes=eyes, face=face)
    print('front', name, 'eyes', len(eyes), 'h', round(d['h'] / FU, 3))
# 아틀라스로 묶기 (선반 배치)
W = 1024; GAP = 12; x = y = sh = 0; rects = []   # GAP: 조각 사이 여백 (줄여 그릴 때 이웃 조각이 번져 가로선으로 보이지 않게)
for img in pieces:
    if x + img.width + GAP > W: x = 0; y += sh + GAP; sh = 0
    rects.append((x, y, img.width, img.height)); x += img.width + GAP; sh = max(sh, img.height)
H = y + sh
atlas = Image.new('RGBA', (W, H))
for img, r in zip(pieces, rects): atlas.paste(img, (r[0], r[1]))
atlas.save(REPO + 'assets/penguin/penguin_atlas.png', optimize=True)
for fr in frames:
    for d in fr['parts']: d['r'] = list(rects[d.pop('i')])
frontOut = {}
for name, d in front.items():
    o = d['out']; o['r'] = list(rects[o.pop('i')]); frontOut[name] = o
meta = dict(front=frontOut, note='pengbok 펭귄 그림 (사용자 원화 IMG_6025). 포즈 0 = 서 있음 → 7 = 수평(헤엄·배치기). 좌표 단위 = 서 있는 키 1, 원점 = 발바닥, 그림은 왼쪽을 봄', unit=1, frames=frames)
json.dump(meta, open(REPO + 'assets/penguin/penguin_atlas.json', 'w'), ensure_ascii=False, indent=1)
OLD = ''.join(map(chr, [103, 114, 105, 115]))
for lvl in [None, 9, 8, 7, 6, 5]:   # base64 안에 우연히 옛 프로젝트 이름(OLD) 글자가 생기지 않는 압축을 고름
    buf = io.BytesIO(); atlas.save(buf, 'PNG', optimize=True) if lvl is None else atlas.save(buf, 'PNG', compress_level=lvl)
    if OLD not in base64.b64encode(buf.getvalue()).decode().lower(): break
js = '// 자동 생성: assets/penguin/penguin_atlas.png + .json (tools 없이 만든 결과). 단일 파일 배포용으로 그림을 data URI 로 포함\nwindow.PENGUIN_ART = ' + json.dumps(dict(meta, img='data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode()), ensure_ascii=False) + ';\n'
open(REPO + 'penguin_art.js', 'w').write(js)
print(atlas.size, len(pieces), round(len(js) / 1024), 'KB', 'unit', unit)
