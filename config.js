// ─────────────────────────────────────────────────────────────
//  조작감 조정 값 모음 — 이 파일만 고치면 됩니다.
//  거리 단위: 월드 1 = 펭귄 키(약 0.75)보다 조금 큰 길이. 화면 높이에 camera.viewHeight 만큼 보임.
//  UI 단위: CSS px (안전 영역 inset 은 자동으로 더해짐).
//  URL 로 임시 덮어쓰기: index.html?cfg=move.walkSpeed=3,input.doubleTapMs=200
// ─────────────────────────────────────────────────────────────
window.CONFIG = {
  ui: {
    // 왼쪽 아래 이동 패드. inset = 화면 가장자리 ~ 패드 그림 가장자리 간격(엄지 하나 정도)
    dpad: {
      insetX: 64, insetY: 40,  // 가장자리에서 안쪽으로
      radius: 56,              // 그림 반지름
      hitRadius: 100,          // 실제 터치 판정 반지름 (그림보다 넉넉하게)
      releaseRadius: 160,      // 손가락이 중심에서 이만큼 벗어나면 입력 0 (역할은 손 뗄 때까지 유지)
      deadZone: 0.15,          // 반지름 대비 무시 구간
      fullAt: 0.7,             // 반지름 대비 이 지점부터 최대 속도
    },
    // 오른쪽 아래 점프·슬라이딩 버튼
    action: {
      insetX: 64, insetY: 40,
      radius: 44,
      hitRadius: 92,
    },
    opacity: 0.4,             // 버튼 반투명도
  },

  move: {
    walkSpeed: 2.2,           // 빙하·섬 위 걷기 최고 속도 (월드/초)
    swimSpeed: 2.8,           // 수영 최고 속도
    accel: 10,                // 가속 (클수록 즉각적)
    turnRate: 14,             // 몸 돌리는 속도
    airControl: 0.35,         // 공중에서 방향 조절 비율 (0~1)
  },

  jump: {
    height: 0.9,              // 점프 높이 (월드)
    gravity: 22,
    crouchDepth: 0.22,        // 첫 터치 시 몸 낮추는 정도 (0~1)
  },

  slide: {
    distance: 4.0,            // 배 슬라이딩 거리 (월드)
    duration: 0.6,            // 슬라이딩 시간 (초)
  },

  input: {
    doubleTapMs: 220,         // 더블탭 판정 시간. 단일 탭 점프는 이 시간 뒤 발동
    penguinHitPx: 48,         // 펭귄 잡기 터치 반경 (px, 최소값)
    floeDragScale: 1.0,       // 펭귄 끌 때 빙하 이동 배율
  },

  camera: {
    viewHeight: 12,           // 화면 세로에 보이는 월드 길이 (작을수록 확대)
    followRate: 2.6,          // 추적 속도 (클수록 빨리 따라옴)
    lead: 0.35,               // 진행 방향으로 앞서 보는 시간 (초)
    rotateSensX: -0.006,      // 가로 드래그 → 회전 감도 (rad/px, 부호 반대로 하면 방향 반전)
    rotateSensY: 0.004,       // 세로 드래그 → 기울기 감도
    rotateSmooth: 14,         // 회전 부드러움 (클수록 즉각적)
    pitchDeg: 52,             // 기본 내려다보는 각도 (90 = 정수리 위)
    pitchMinDeg: 28,
    pitchMaxDeg: 82,
    screenY: 0.52,            // 펭귄이 놓일 화면 세로 위치 (0 위 ~ 1 아래)
  },

  floe: {
    radiusX: 2.4, radiusY: 1.8, // 빙하 크기
    damping: 1.4,             // 손 뗀 뒤 미끄러짐 감쇠
    maxSpeed: 8,
  },

  world: {
    islandDistance: 40,       // 출발점 ~ 섬 해안까지 거리 (좌우 모두)
    islandHalfWidth: 9,       // 섬 가로 반폭
    islandHalfLength: 30,     // 섬 세로 반길이 (넉넉해야 대각선으로 흘러도 도착)
    islandHeight: 0.45,
  },

  penguin: {
    height: 0.75,
    swimSink: 0.5,            // 수영 시 몸이 잠기는 비율
    walkWobbleDeg: 7,         // 걷기 좌우 흔들림 각도
    walkWobbleFreq: 9,        // 흔들림 빈도 (이동 거리당)
  },

  fullscreenOnFirstTouch: true, // 안드로이드: 첫 터치에 전체화면 + 가로 고정 시도
};
