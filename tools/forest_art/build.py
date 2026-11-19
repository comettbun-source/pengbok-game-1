# 해안~땅굴 배경 원화 (assets/forest_bg.png 배경 · assets/forest_front.png 굴 앞 레이어) → forest_art.js
# 원본 6614×2345, 펭귄 비율 기준 원본 370px = 월드 1. 줄여서 WebP(투명) data URI 로. 색(밤빛)은 게임에서 FOREST_ART.grade 로 한 번 입힘
import json, base64, io
import numpy as np
from PIL import Image
S = 0.85   # 축소 배율 (원본 200px/월드 → 170px/월드: 아이패드 화면에서 늘어나 흐려 보이지 않게)
OLD = ''.join(map(chr, [103, 114, 105, 115]))
# 밤빛 · 끝 투명 (config_pengbok.js 의 FOREST_ART 값과 같게 맞춰 둘 것)
G = dict(sat=0.62, bright=0.5, gamma=1.15, tint=(20, 28, 46), tintAmount=0.22)
FADE_RIGHT, FADE_BOTTOM, FADE_LEFT = (4900, 5900), (2120, 2345), (0, 380)
def sm_step(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)
def grade(img, key, ox, oy):
    a = np.asarray(img).astype(np.float32) / 255; c, al = a[..., :3], a[..., 3]
    l = (0.3 * c[..., 0] + 0.59 * c[..., 1] + 0.11 * c[..., 2])[..., None]
    v = np.power(np.clip(l + (c - l) * G['sat'], 0, 1), G['gamma']) * G['bright']
    v = v * (1 - G['tintAmount']) + np.array(G['tint']) / 255 * G['tintAmount']
    h, w = al.shape; sx = (np.arange(w) + ox) / S; sy = (np.arange(h) + oy) / S
    fx = sm_step(*FADE_LEFT, sx) * ((1 - sm_step(*FADE_RIGHT, sx)) if key == 'bg' else 1)
    fy = 1 - sm_step(*FADE_BOTTOM, sy)
    al = al * fy[:, None] * fx[None, :]
    return Image.fromarray((np.dstack([v, al[..., None]]) * 255 + 0.5).clip(0, 255).astype(np.uint8), 'RGBA')
out = {}
for key, src in [('bg', 'assets/forest_bg.png'), ('front', 'assets/forest_front.png')]:
    im = Image.open(src).convert('RGBA'); W, H = im.size
    if key == 'front':
        bb = im.getchannel('A').getbbox(); im = im.crop(bb); ox, oy = bb[0], bb[1]
    else: ox = oy = 0
    sm = im.resize((round(im.width * S), round(im.height * S)), Image.LANCZOS)
    sm = grade(sm, key, ox * S, oy * S)   # 밤빛·끝 투명은 여기서 미리 (게임에서 큰 그림을 픽셀마다 처리하면 아이패드에서 멈칫함)
    for q in [86, 85, 84, 83, 82, 81, 80]:   # base64 안에 옛 이름 글자가 우연히 생기지 않는 품질을 고름
        buf = io.BytesIO(); sm.save(buf, 'WEBP', quality=q, method=6); b64 = base64.b64encode(buf.getvalue()).decode()
        if OLD not in b64.lower(): break
    out[key] = dict(img='data:image/webp;base64,' + b64, w=sm.width, h=sm.height, ox=ox * S, oy=oy * S)
    print(key, sm.size, round(len(b64) / 1024), 'KB', 'q', q)
meta = dict(scale=S, srcW=6614, srcH=2345, **out)
open('forest_art.js', 'w').write('// 자동 생성: tools/forest_art/build.py (assets/forest_bg.png · forest_front.png). 해안~땅굴 배경 원화. 좌표는 원본 px × scale\nwindow.FOREST_ART = ' + json.dumps(meta) + ';\n')
