# 바닷가 바위 원화 (assets/rock_sheet.png) → rock_art.js. 0 = 왼쪽 바위 + 작은 돌, 1 = 오른쪽 큰 바위
import numpy as np, json, base64, io
from PIL import Image
from scipy import ndimage
SRC = 'assets/rock_sheet.png'; S = 0.6
im = np.array(Image.open(SRC).convert('RGBA'))
m = im[..., 3] > 10
lab, n = ndimage.label(ndimage.binary_dilation(m, iterations=40))   # 큰 바위 옆 작은 돌은 한 묶음으로
groups = []
for i, sl in enumerate(ndimage.find_objects(lab)):
    if ((lab[sl] == i + 1) & m[sl]).sum() < 1000: continue
    groups.append((sl[1].start, sl, i + 1))
groups.sort()
sprites, imgs = [], []
for x0, sl, li in groups:
    y0, y1, x0, x1 = sl[0].start, sl[0].stop, sl[1].start, sl[1].stop
    P = im[y0:y1, x0:x1].copy(); P[lab[y0:y1, x0:x1] != li] = 0
    a = P[..., 3] > 30; ys, xs = np.nonzero(a); P = P[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    # 큰 덩어리(작은 돌 제외)의 가로 범위 = 바위 몸통
    big = ndimage.label(P[..., 3] > 30)[0]; sizes = ndimage.sum(np.ones_like(big), big, range(1, big.max() + 1)); bl = big == 1 + int(np.argmax(sizes)); bys, bxs = np.nonzero(bl)
    img = Image.fromarray(P).resize((round(P.shape[1] * S), round(P.shape[0] * S)), Image.LANCZOS); imgs.append(img)
    sprites.append(dict(w=P.shape[1], h=P.shape[0], body=[float(bxs.min()), float(bxs.max()), float(bys.min())]))
    print('sprite', len(sprites) - 1, P.shape[1], P.shape[0])
GAP = 8; Wt = sum(i.width for i in imgs) + GAP * (len(imgs) + 1); Ht = max(i.height for i in imgs) + GAP * 2
atlas = Image.new('RGBA', (Wt, Ht)); x = GAP
for sp, img in zip(sprites, imgs): atlas.paste(img, (x, GAP)); sp['r'] = [x, GAP, img.width, img.height]; x += img.width + GAP
buf = io.BytesIO(); atlas.save(buf, 'PNG', optimize=True)
open('rock_art.js', 'w').write('// 자동 생성: tools/rock_art/build.py (assets/rock_sheet.png). 바닷가 바위 원화: 0 = 왼쪽 바위+작은 돌, 1 = 큰 바위. body = 바위 몸통 [왼쪽 x, 오른쪽 x, 꼭대기 y] (원본 px)\nwindow.ROCK_ART = ' + json.dumps(dict(sprites=sprites, img='data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode())) + ';\n')
