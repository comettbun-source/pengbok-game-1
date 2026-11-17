# 펭귄 원화 → 게임 조각

원본: `assets/penguin/source_sheet.png` (8개 포즈 × [합성 / 눈·날개·발 / 몸]).

저장소 루트에서 차례로 실행 (numpy, scipy, Pillow 필요):

1. `mkdir -p tools/penguin_art/work && python3 tools/penguin_art/match2.py` — 조각 찾기 + 1차 위치
2. `python3 tools/penguin_art/place.py` — 눈·발 위치 보정, `work/reassembled.png` 로 원본과 비교
3. `python3 tools/penguin_art/atlas.py` — `assets/penguin/penguin_atlas.png/.json`, `penguin_art.js` 생성

포즈 1 날개 위치는 `place.py` 끝에서 수동 보정.
