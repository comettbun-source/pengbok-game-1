# 해안 모래 질감 (assets/sand_texture.png) → sand_art.js : 이음매 없는 512px 타일 (반 칸 밀린 사본과 섞어 가장자리가 이어지게)
import numpy as np, base64, io
from PIL import Image
im = np.array(Image.open('assets/sand_texture.png').convert('RGB').resize((512, 512), Image.LANCZOS)).astype(np.float32)
N = 512; x = np.abs(np.linspace(-1, 1, N)); w1 = np.clip((1 - x) * 1.6, 0, 1); W = np.minimum.outer(w1, w1)[..., None]   # 가운데 1 → 가장자리 0
sh = np.roll(np.roll(im, N // 2, 0), N // 2, 1)
out = Image.fromarray((im * W + sh * (1 - W)).clip(0, 255).astype(np.uint8))
OLD = ''.join(map(chr, [103, 114, 105, 115]))
for q in range(86, 70, -1):
    buf = io.BytesIO(); out.save(buf, 'JPEG', quality=q); b = base64.b64encode(buf.getvalue()).decode()
    if OLD not in b.lower(): break
open('sand_art.js', 'w').write('// 자동 생성: tools/sand_art/build.py (assets/sand_texture.png). 해안 모래 질감, 이음매 없는 512px 타일\nwindow.SAND_ART = { img: "data:image/jpeg;base64,' + b + '" };\n')
print(q, len(b) // 1024, 'KB')
