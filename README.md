# 펭귄 탐험 — 첫 구간 프로토타입

모바일 가로 화면용 웹 프로토타입. 빌드 없음 (index.html + config.js + game.js).

## 실행

```sh
python3 -m http.server 8000
```

- 휴대폰: 같은 Wi‑Fi에서 `http://<PC IP>:8000` 접속 후 가로로 돌리기
- PC: 방향키/WASD 이동, Space 탭 = 점프 / 두 번 = 슈퍼점프 / 꾹 = 슬라이딩
- 수치 임시 비교: `?water=normal&cfg=PHYSICS.gravity=20,ICE_FIELD.seed=7`

## 조작감 수치

모두 `config.js` 한 곳에 있음 (버튼 위치·크기, 이동 속도, 카메라 감도·추적, 더블탭 시간, 점프 높이, 슬라이딩 거리, 섬 거리).

## 물 엔진

`water.js` — 펭귄 주변 수면을 격자(높이장)로 계산. 펭귄·빙하가 밀어낸 물이 파문·항적·되튕김을 만든다.
수치는 `config.js` 의 `WATER_SIM`. 끄고 비교: `?cfg=WATER_SIM.enabled=false`

## 색 · 물리 스냅샷

- 색은 `config.js` 맨 위 `PALETTE` (`CONFIG.palette`) 한 곳.
- 그림·색·카메라를 바꾼 뒤 물리가 그대로인지: `node tools/physics-snapshot.js > snap.json` 으로 전후 비교 (서버는 8123 포트).
