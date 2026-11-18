# 펭귄 원화 → 게임 조각

원본: `assets/penguin/source_sheet.png` (옆모습 8개 포즈 × [합성 / 눈·날개·발 / 몸]), `assets/penguin/source_front.png` (정면 앉음·서 있음, 합성 그림만 사용). 점프 참고: `assets/penguin/ref_jump.gif`.

저장소 루트에서 차례로 실행 (numpy, scipy, Pillow 필요):

1. `mkdir -p tools/penguin_art/work && python3 tools/penguin_art/match2.py` — 조각 찾기 + 1차 위치
2. `python3 tools/penguin_art/place.py` — 눈·발 위치 보정, `work/reassembled.png` 로 원본과 비교
3. `python3 tools/penguin_art/idle_place.py` — 가만히 선 자세(`assets/penguin/source_idle.png`) 조각 위치 → 포즈 8
4. `python3 tools/penguin_art/walk_place.py` — 새 원화(IMG_6156) 5번째 칸 = 똑바로 선 걷기 자세(`assets/penguin/source_walk.png`) 조각 위치 → 포즈 9
5. `python3 tools/penguin_art/feet_fit.py` — 걷기 컷(2·3·9) 발: 잘리지 않은 발 조각을 합성 그림의 발과 같은 각도·위치로 맞춤 (몇 분 걸림)
6. `python3 tools/penguin_art/atlas.py` — `assets/penguin/penguin_atlas.png/.json`, `penguin_art.js` 생성

포즈 1 날개 위치는 `place.py` 끝에서 수동 보정.
