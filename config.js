// ─────────────────────────────────────────────────────────────
//  조작감·연출 조정 값 모음 — 이 파일만 고치면 됩니다.
//  거리 단위: 월드 (화면 세로에 camera.viewHeight 만큼 보임). UI 단위: CSS px.
//  로컬 실행 시 URL 로 임시 덮어쓰기: index.html?cfg=move.walkSpeed=3,input.doubleTapMs=200
// ─────────────────────────────────────────────────────────────
window.CONFIG = {
  ui: {
    // 왼쪽 아래 이동 링. inset = 화면 가장자리 ~ 링 바깥선 간격(엄지 하나 정도)
    ring: {
      insetX: 70, insetY: 46,
      radius: 34,              // 링 표시 반지름
      lineWidth: 3,
      hitRadius: 100,          // 실제 터치 판정 반지름 (표시보다 넉넉하게)
      maxPush: 46,             // 엄지를 이만큼 밀면 최고 속도 (px)
      deadZone: 6,             // 이보다 덜 밀면 무시 (px)
      releasePush: 170,        // 터치 시작점에서 이만큼 벗어나면 입력 0 (역할은 뗄 때까지 유지)
    },
    // 오른쪽 아래 물갈퀴 발자국 버튼
    action: {
      insetX: 70, insetY: 46,
      radius: 38,              // 표시 크기
      hitRadius: 100,
    },
    // 배경 밝기에 따른 색 전환
    adapt: {
      lightAlpha: 0.42,        // 밝은 배경 위 옅은 먹색 농도
      darkAlpha: 0.5,          // 어두운 배경 위 흰색 농도
      threshold: [0.35, 0.6],  // 이 밝기 구간에서 먹색↔흰색이 섞임
      smooth: 3,               // 전환 속도 (작을수록 천천히, 물결에 깜빡이지 않음)
      sampleMs: 120,           // 배경 밝기 측정 주기
    },
  },

  move: {
    walkSpeed: 2.2,           // 빙하·섬 위 걷기 최고 속도 (월드/초)
    swimSpeed: 2.8,           // 수영 최고 속도
    accel: 10,                // 가속
    stopRate: 16,             // 링에서 손 뗐을 때 멈추는 빠르기
    turnRate: 14,             // 몸 돌리는 속도
    airControl: 0.35,
  },

  input: {
    doubleTapMs: 260,         // 첫 탭을 뗀 뒤 두 번째 탭을 누르기까지 허용 간격
    longPressMs: 220,         // 이 시간 이상 누르면 길게 누르기(슬라이딩)로 판정
    penguinHitPx: 48,         // 펭귄 잡기 터치 반경 기본값 (펭귄 배율이 곱해짐)
    floeDragScale: 1.0,
  },

  jump: { height: 0.9, gravity: 22 },

  slide: {
    speed: 5.2,               // 이동 링을 밀고 있을 때 슬라이딩 속도
    startSpeed: 3.8,          // 슬라이딩 시작 순간 최소 속도
    accel: 6,                 // 슬라이딩 속도까지 붙는 빠르기
    turnRate: 3.5,            // 링 방향을 따라 슬라이딩 방향이 도는 빠르기 (작을수록 부드럽게)
    coastDecel: 2.5,          // 링 없이 발자국만 누를 때 감속 (멈춰도 배는 댄 채 유지)
  },

  camera: {
    viewHeight: 12,           // 화면 세로에 보이는 월드 길이 (줌)
    followRate: 2.6,
    lead: 0.35,
    rotateSensX: -0.006,      // 가로 드래그 회전 감도 (부호 반대 = 방향 반전)
    rotateSensY: 0.004,
    rotateSmooth: 14,
    pitchDeg: 52,
    pitchMinDeg: 28,
    pitchMaxDeg: 82,
    screenY: 0.5,             // 펭귄의 화면 세로 위치
  },

  penguin: {
    scale: 1.3,               // ★ 펭귄 크기 배율 (그림·잡기 영역·반영 모두 함께)
    height: 0.75,             // 배율 1 일 때 키
    swimSink: 0.5,
    walkWobbleDeg: 7,
    walkWobbleFreq: 9,
  },

  floe: {
    scale: 1.25,              // ★ 빙하 크기 배율 (그림·발판 판정 함께)
    radiusX: 2.4, radiusY: 1.8, // 배율 1 일 때 크기
    damping: 1.4,
    maxSpeed: 8,
  },

  water: {
    rippleLife: 1.8,          // 일반 파문 지속 시간 (초)
    rippleAlpha: 0.34,        // 파문 진하기
    rippleSoftness: 0.45,     // 파문 띠 폭 (반지름 대비, 클수록 넓고 부드럽게)
    splashRadius: 3.4,        // 퐁당 파문 최대 반지름
    splashLife: 2.4,
    wakeLife: 3.2,            // 빙하 물자국 지속 시간
    wakeAlpha: 0.11,          // 물자국 한 점의 진하기 (겹쳐서 길게 보임)
    wakeSpread: 0.9,          // 물자국이 옆으로 번지는 속도
    swimWakeAlpha: 0.1,
  },

  reflect: {
    alpha: 0.3,               // 반영 진하기 (0 = 끔)
    fadeLength: 0.95,         // 몸 높이 대비 이 길이에 걸쳐 흐려짐
    wobblePx: 2.2,            // 파문이 지날 때 윤곽 일렁임 폭
    slices: 10,
  },

  fish: {
    delay: 1.8,               // 시작 후 첫 점프까지 (초)
    startSide: 1.8,           // 빙하 오른쪽 끝에서 더 바깥으로
    front: 0.7,               // 빙하 앞 가장자리에서 더 앞으로 (펭귄 몸에 가리지 않게)
    landSide: 2.4,            // 빙하 왼쪽 끝에서 더 바깥으로 착수
    jump1: { height: 2.0, duration: 0.95 },
    pause: 0.35,
    jump2: { distance: 3.6, height: 0.9, duration: 0.6, rise: 0.8 },
    size: 0.75,
  },

  world: {
    islandDistance: 40,       // 출발점 ~ 섬 물가 거리 (좌우 모두)
    islandHalfWidth: 16,
    islandHalfLength: 40,     // 섬 세로 반길이 (넉넉해야 대각선으로 흘러도 도착)
    shoreHeight: 0.22,        // 완만한 물가 높이
    summitHeight: 34,         // 산 정상 높이 (화면 밖으로 이어지는 규모)
    nearDist: 9,              // 이보다 가까운 산은 짙은 먹색
    farDist: 34,              // 이보다 먼 산은 연회색
    farRidgeParallax: 0.1,    // 먼 능선 시차 (작을수록 먼저·천천히 보임)
    farRidgeShow: [30, 16],   // 섬까지 거리가 30 이하부터 먼 능선이 드러나 16 에서 완전히 보임
  },

  fullscreenOnFirstTouch: true,
};
