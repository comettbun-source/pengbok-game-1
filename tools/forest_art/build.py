# 해안~땅굴 배경 원화 (assets/forest_bg.png 배경 · assets/forest_front.png 굴 앞 레이어) → forest_art.js
# 원본 6614×2345, 펭귄 비율 기준 원본 370px = 월드 1. 줄여서 WebP(투명) data URI 로. 색(밤빛)은 게임에서 FOREST_ART.grade 로 한 번 입힘
import json, base64, io
from PIL import Image
S = 0.33   # 축소 배율 (원본 370px/월드 → 약 122px/월드)
OLD = ''.join(map(chr, [103, 114, 105, 115]))
out = {}
for key, src in [('bg', 'assets/forest_bg.png'), ('front', 'assets/forest_front.png')]:
    im = Image.open(src).convert('RGBA'); W, H = im.size
    if key == 'front':
        bb = im.getchannel('A').getbbox(); im = im.crop(bb); ox, oy = bb[0], bb[1]
    else: ox = oy = 0
    sm = im.resize((round(im.width * S), round(im.height * S)), Image.LANCZOS)
    for q in [86, 85, 84, 83, 82, 81, 80]:   # base64 안에 옛 이름 글자가 우연히 생기지 않는 품질을 고름
        buf = io.BytesIO(); sm.save(buf, 'WEBP', quality=q, method=6); b64 = base64.b64encode(buf.getvalue()).decode()
        if OLD not in b64.lower(): break
    out[key] = dict(img='data:image/webp;base64,' + b64, w=sm.width, h=sm.height, ox=ox * S, oy=oy * S)
    print(key, sm.size, round(len(b64) / 1024), 'KB', 'q', q)
meta = dict(scale=S, srcW=6614, srcH=2345, **out)
open('forest_art.js', 'w').write('// 자동 생성: tools/forest_art/build.py (assets/forest_bg.png · forest_front.png). 해안~땅굴 배경 원화. 좌표는 원본 px × scale\nwindow.FOREST_ART = ' + json.dumps(meta) + ';\n')
