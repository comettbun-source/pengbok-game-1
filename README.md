# 펭귄 탐험 — 첫 구간 프로토타입

모바일 가로 화면용 웹 프로토타입. 빌드 없음 (index.html + config.js + game.js).

## 실행

```sh
python3 -m http.server 8000
```

- 휴대폰: 같은 Wi‑Fi에서 `http://<PC IP>:8000` 접속 후 가로로 돌리기
- PC: 방향키/WASD 이동, Space 점프(두 번 = 슬라이딩)
- 수치 임시 비교: `?cfg=move.walkSpeed=3,input.doubleTapMs=180`

## 조작감 수치

모두 `config.js` 한 곳에 있음 (버튼 위치·크기, 이동 속도, 카메라 감도·추적, 더블탭 시간, 점프 높이, 슬라이딩 거리, 섬 거리).
