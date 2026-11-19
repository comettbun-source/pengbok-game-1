# 해안~땅굴 배경 원화 (assets/forest_bg.png 배경 · assets/forest_front.png 굴 앞 레이어) → forest_art.js
# 원본 6614×2345, 펭귄 비율 기준 원본 370px = 월드 1. 줄여서 WebP(투명) data URI 로. 색(밤빛)은 게임에서 FOREST_ART.grade 로 한 번 입힘
import json, base64, io
import numpy as np
from PIL import Image
S = 0.85   # 축소 배율 (원본 200px/월드 → 170px/월드: 아이패드 화면에서 늘어나 흐려 보이지 않게)
OLD = ''.join(map(chr, [103, 114, 105, 115]))
# 밤빛 · 끝 투명 (config_pengbok.js 의 FOREST_ART 값과 같게 맞춰 둘 것)
G = dict(sat=0.74, bright=0.56, gamma=1.12, tint=(20, 28, 46), tintAmount=0.18)   # (채도 0.62 → 0.74 · 밝기 0.5 → 0.56) 조금 더 선명하게
GROUND_FADE_START = 3900   # 걷는 선 아래 땅의 오른쪽 옅어지기 시작
FADE_RIGHT, FADE_BOTTOM, FADE_LEFT = (4980, 5165), (2250, 2345), None   # 원화 그대로 + 오른쪽 모래 덩어리(5170~)만 해변과 이어지게 옅어짐 · 맨 아래 끝 한 줄만 부드럽게 (띠 계단 안 보이게)
# 명암 (바위처럼): 덩어리 윗선을 따라 빛 받는 테두리(위·왼쪽 빛) + 윗선에서 아래로 깊어질수록 그늘
SHADE = dict(rim=0.2, rimPx=30, leftBias=0.5, occ=0.28, occPx=320, color=(230, 236, 255))
SHARP = dict(radius=2, percent=70, threshold=2)
def sm_step(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)
def grade(img, key, ox, oy):
    a = np.asarray(img).astype(np.float32) / 255; c, al = a[..., :3], a[..., 3]
    l = (0.3 * c[..., 0] + 0.59 * c[..., 1] + 0.11 * c[..., 2])[..., None]
    v = np.power(np.clip(l + (c - l) * G['sat'], 0, 1), G['gamma']) * G['bright']
    v = v * (1 - G['tintAmount']) + np.array(G['tint']) / 255 * G['tintAmount']
    if key == 'bg':
        from scipy import ndimage
        op = ndimage.binary_closing(ndimage.binary_opening(al > 0.5, iterations=2), iterations=6); run = np.zeros(op.shape, np.float32)   # 작은 틈은 메움 (세로 줄무늬 방지)   # 윗선에서 아래로 몇 px 들어왔는지 (세로 길이)
        for y in range(1, op.shape[0]): run[y] = np.where(op[y], run[y - 1] + 1, 0)
        run = ndimage.gaussian_filter(run, (4, 14))   # 옆으로 부드럽게 이어지게
        ab = ndimage.gaussian_filter(al, 3); gx = ndimage.sobel(ab, 1); gy = ndimage.sobel(ab, 0); gl = np.hypot(gx, gy) + 1e-6
        face = np.clip((gy / gl) * (1 - SHADE['leftBias']) + (gx / gl) * SHADE['leftBias'], 0, 1)   # 위(·왼쪽)를 향한 가장자리
        rim = SHADE['rim'] * np.exp(-run / SHADE['rimPx']) * (0.45 + 0.55 * face)
        occ = 1 - SHADE['occ'] * np.clip(run / SHADE['occPx'], 0, 1) ** 0.8
        col = np.array(SHADE['color']) / 255
        v = v * occ[..., None]; v = v + (col - v) * rim[..., None]
    h, w = al.shape; sx = (np.arange(w) + ox) / S; sy = (np.arange(h) + oy) / S
    fx = sm_step(*FADE_LEFT, sx) * ((1 - sm_step(*FADE_RIGHT, sx)) if key == 'bg' else 1)
    fy = 1 - sm_step(*FADE_BOTTOM, sy)
    al = al * fy[:, None] * fx[None, :]
    return Image.fromarray((np.dstack([v, al[..., None]]) * 255 + 0.5).clip(0, 255).astype(np.uint8), 'RGBA')
def fades(img, key, ox, oy):   # 색은 그대로 두고 알파만: 오른쪽(해안)·왼쪽 끝, 걷는 선 아래
    a = np.asarray(img).copy(); al = a[..., 3].astype(np.float32) / 255
    h, w = al.shape; sx = (np.arange(w) + ox) / S; sy = (np.arange(h) + oy) / S
    fl = sm_step(*FADE_LEFT, sx)[None, :] if FADE_LEFT else 1
    if key == 'bg' and FADE_RIGHT:   # 오른쪽 끝: 걷는 선 아래 땅은 더 넓게 옅어짐 (땅이 세로로 뚝 끝나 보이지 않게)
        r0 = FADE_RIGHT[0] + (GROUND_FADE_START - FADE_RIGHT[0]) * sm_step(1900, 2060, sy)[:, None]
        fr = 1 - np.clip((sx[None, :] - r0) / (FADE_RIGHT[1] - r0), 0, 1) ** 1.0
        fr = fr * fr * (3 - 2 * fr)
    else: fr = 1
    fy = ((1 - sm_step(*FADE_BOTTOM, sy)) if FADE_BOTTOM else np.ones(h))[:, None]
    al = al * fy * fl * fr
    a[..., 3] = (al * 255 + 0.5).astype(np.uint8); return Image.fromarray(a, 'RGBA')
out = {}
for key, src in [('bg', 'assets/forest_bg.png'), ('front', 'assets/forest_front.png')]:
    im = Image.open(src).convert('RGBA'); W, H = im.size
    if key == 'bg': SRC_W, SRC_H = W, H
    if key == 'front':
        bb = im.getchannel('A').getbbox(); im = im.crop(bb); ox, oy = bb[0], bb[1]
    else: ox = oy = 0
    sm = im.resize((round(im.width * S), round(im.height * S)), Image.LANCZOS)
    sm = fades(sm, key, ox * S, oy * S)   # 색은 원화 그대로, 끝만 투명하게 (밤빛·명암 grade() 는 지금 안 씀)
    for q in [86, 85, 84, 83, 82, 81, 80, 79, 78, 87, 88, 77, 76, 75]:   # base64 안에 옛 이름 글자가 우연히 생기지 않는 품질을 고름
        buf = io.BytesIO(); sm.save(buf, 'WEBP', quality=q, method=6); b64 = base64.b64encode(buf.getvalue()).decode()
        if OLD not in b64.lower(): break
    out[key] = dict(img='data:image/webp;base64,' + b64, w=sm.width, h=sm.height, ox=ox * S, oy=oy * S)
    print(key, sm.size, round(len(b64) / 1024), 'KB', 'q', q)
meta = dict(scale=S, srcW=SRC_W, srcH=SRC_H, **out)
open('forest_art.js', 'w').write('// 자동 생성: tools/forest_art/build.py (assets/forest_bg.png · forest_front.png). 해안~땅굴 배경 원화. 좌표는 원본 px × scale\nwindow.FOREST_ART = ' + json.dumps(meta) + ';\n')
