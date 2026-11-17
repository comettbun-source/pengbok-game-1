# 빙하 원화 (assets/floe_sheet.png, 4개 옆모습) → floe_art.js
# 수면선: assets/floe_sheet_ref.png 의 회색 바다 띠 시작 행 (y = 716)
import numpy as np, json, base64, io
from PIL import Image
from scipy import ndimage
SRC = 'assets/floe_sheet.png'; WL = 716; S = 0.42; N = 96
im = np.array(Image.open(SRC).convert('RGBA'))
m = im[..., 3] > 10
lab, n = ndimage.label(ndimage.binary_dilation(m, iterations=3))
comps = []
for i, sl in enumerate(ndimage.find_objects(lab)):
    if ((lab[sl] == i + 1) & m[sl]).sum() < 1000: continue
    comps.append((sl[1].start, sl, i + 1))
comps.sort()
sprites, imgs = [], []
for x0, sl, li in comps:
    y0, y1, x0, x1 = sl[0].start, sl[0].stop, sl[1].start, sl[1].stop
    P = im[y0:y1, x0:x1].copy(); P[lab[y0:y1, x0:x1] != li] = 0
    a = P[..., 3] > 60; H, W = a.shape
    top = []; bot = []
    for k in range(N):
        c = min(W - 1, int((k + 0.5) / N * W)); ys = np.nonzero(a[:, c])[0]
        top.append(float(WL - (y0 + ys.min())) if len(ys) else None); bot.append(float((y0 + ys.max()) - WL) if len(ys) else None)
    img = Image.fromarray(P).resize((round(W * S), round(H * S)), Image.LANCZOS); imgs.append(img)
    sprites.append(dict(w=W, h=H, wl=WL - y0, top=top, bot=bot))
    print('sprite', len(sprites) - 1, 'w', W, 'h', H, 'above', WL - y0, 'maxTop', max(t for t in top if t is not None))
GAP = 12; Wt = sum(i.width for i in imgs) + GAP * (len(imgs) + 1); Ht = max(i.height for i in imgs) + GAP * 2
atlas = Image.new('RGBA', (Wt, Ht)); x = GAP
for sp, img in zip(sprites, imgs):
    atlas.paste(img, (x, GAP)); sp['r'] = [x, GAP, img.width, img.height]; x += img.width + GAP
atlas.save('assets/floe_atlas.png', optimize=True)
buf = io.BytesIO(); atlas.save(buf, 'PNG', optimize=True)
open('floe_art.js', 'w').write('// 자동 생성: tools/floe_art/build.py (assets/floe_sheet.png). 빙하 원화 4장: 0 작음 · 1 납작 · 2 높음 · 3 큼. top/bot = 열마다 수면선 위·아래 높이(원본 px)\nwindow.FLOE_ART = ' + json.dumps(dict(sprites=sprites, img='data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode())) + ';\n')
print(atlas.size, round(len(buf.getvalue()) / 1024), 'KB')
