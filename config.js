// ─────────────────────────────────────────────────────────────
//  조작감·물·물리·빙하 배치 조정 값 모음 — 이 파일만 고치면 됩니다.
//  거리 단위: 월드 (화면 세로에 camera.viewHeight 만큼 보임). UI·출렁임 단위: CSS px.
//  로컬 실행 시 URL 로 임시 덮어쓰기: index.html?water=normal&cfg=PHYSICS.gravity=20,ICE_FIELD.seed=7
// ─────────────────────────────────────────────────────────────

// ── 물결·출렁임 프리셋 ─────────────────────────────────────
// 잔잔함: 바람 거의 없는 물, 큰 파도 없음
const WATER_CALM = {
  bob: {
    periods: [3.2, 5.1],      // 상시 출렁임 사인파 두 개의 주기 (초)
    ampsPx: [1.4, 0.9],       // 각 진폭 (px). 합산 최대치는 maxPx 로 제한
    maxPx: 3,                 // 합산 진폭 상한 (작은 빙하가 더 흔들려도 이 값 이하)
    lightBoost: 1.3,          // 작은(가벼운) 빙하일수록 진폭 배율, 최대 이 값
    tiltDeg: 0.8,             // 파도에 의한 빙하 롤/피치 최대 각도
    penguinLag: 0.25,         // 펭귄이 빙하 출렁임을 따라가는 지연 (초)
    phaseSpread: 6.28,        // 빙하마다 다른 위상 범위 (rad)
  },
  surfaceLines: {             // 수면 잔물결 (아주 옅은 가로선)
    count: 6,
    alpha: [0.08, 0.15],
    speed: 0.12,              // 흐르는 속도 (월드/초)
    length: [1.2, 2.8],       // 길이 (월드)
  },
  wake: {                     // 이동 항적 (V자 얇은 호)
    halfAngleDeg: 19,
    life: 1.8,                // 사라지기까지 (초)
    spacing: [0.45, 1.0],     // 느릴 때 ~ 빠를 때 호 간격 (월드)
    arcDeg: [14, 34],         // 느릴 때 ~ 빠를 때 호 길이 (도)
    alphaMax: 0.3,            // 최고 속도일 때 시작 불투명도
    lineWidth: 1.1,
    maxParticles: 40,         // 풀 크기 (프레임 저하 시 자동으로 줄어듦)
  },
  flowLines: {                // 선체 뒤로 흐르는 가는 흐름선
    count: 3,
    alpha: 0.16,
    lengthSec: 0.45,          // 길이 = 속도 × 이 값
  },
  inertiaTilt: {
    accelDeg: 2,              // 가속 시 뒤로 기울기 최대
    stopDeg: 1.5,             // 멈출 때 앞으로 기울기 최대
    accelRef: 3,              // 이 가속도(월드/초²)에서 최대 각도
  },
  settle: {
    dampingRatio: 0.5,        // 스프링-댐퍼 감쇠비 (출렁임·기울기·멈춤 공통)
    maxPx: 4,                 // 멈춤 출렁임 최대 폭
  },
  splash: {
    ringRadius: 2.6,          // 입수 원형 물결 반지름
    ringLife: 1.8,
    sinkPx: 6,                // 걸어서 빠질 때 가라앉는 깊이 (낙하 속도에 비례해 증가)
    sinkMaxPx: 10,
  },
  ripple: { life: 1.8, alpha: 0.3, softness: 0.45 },   // 원형 파문 (입수·물고기·제자리 수영)
};

// 보통: 약한 바람
const WATER_NORMAL = {
  bob: { periods: [2.6, 4.1], ampsPx: [2.4, 1.6], maxPx: 5, lightBoost: 1.4, tiltDeg: 1.6, penguinLag: 0.25, phaseSpread: 6.28 },
  surfaceLines: { count: 10, alpha: [0.12, 0.22], speed: 0.3, length: [1.5, 3.5] },
  wake: { halfAngleDeg: 19, life: 2.4, spacing: [0.4, 0.9], arcDeg: [18, 42], alphaMax: 0.42, lineWidth: 1.3, maxParticles: 40 },
  flowLines: { count: 3, alpha: 0.24, lengthSec: 0.6 },
  inertiaTilt: { accelDeg: 3, stopDeg: 2.2, accelRef: 3 },
  settle: { dampingRatio: 0.4, maxPx: 6 },
  splash: { ringRadius: 3.2, ringLife: 2.2, sinkPx: 8, sinkMaxPx: 13 },
  ripple: { life: 2.2, alpha: 0.4, softness: 0.5 },
};

// ── 경량 물리 ──────────────────────────────────────────────
const PHYSICS = {
  hz: 60,                     // 고정 시간 단계
  gravity: 22,
  penguin: {
    mass: 1,
    moveForce: { ice: 10, shore: 16, water: 9 },   // 링 입력이 주는 힘
    maxSpeed: { ice: 2.2, shore: 2.0, water: 2.8 },
    airForce: 3,
  },
  friction: { ice: 1.4, shore: 7, water: 3.2 },    // 걷기·수영 감쇠 (1/초). 빙하는 미끄럽고 해안은 뻑뻑
  slideFriction: { ice: 0.35, shore: 3.5, water: 1.4 },
  jumpVelocity: 6.6,          // 점프 초기 속도 → 체공 = 2v/g ≈ 0.6초
  jumpForwardSpeed: 3.4,      // 링을 민 채 점프할 때 수평 속도 (점프 최대 거리 = 이 값 × 체공)
  slideInitialSpeed: 4.6,     // 슬라이딩 시작 속도
  slideForce: 6,              // 링을 민 채 슬라이딩할 때 미는 힘
  slideMaxSpeed: 5.2,
  slideTurnRate: 3.5,         // 링 방향을 따라 슬라이딩 방향이 도는 빠르기
  turnRate: 14,               // 몸 돌리는 속도
  floeDensity: 0.5,           // 빙하 질량 = 넓이 × 밀도 (펭귄 질량 1)
  floeWaterDrag: 0.9,         // 손 뗀 뒤 물 저항 (시작 빙하 기준, 작을수록 오래 미끄러짐)
  dragStiffness: 160,         // 손가락이 빙하를 끄는 스프링 (질량이 클수록 천천히 가속)
  buoyancyStiffness: 55,      // 수면 높이로 돌아가는 스프링 강도 (ω²)
  landingSinkPx: 2,           // 시작 빙하에 착지할 때 가라앉는 깊이 (작은 빙하일수록 더)
  weightTiltDeg: 1.5,         // 펭귄이 가장자리에 서면 빙하가 기우는 최대 각도
  collisionPush: 0.5,         // 빙하끼리 밀어내는 세기 (0~1)
};

// ── 빙하 배치 ──────────────────────────────────────────────
const ICE_FIELD = {
  seed: 20261115,             // 같은 시드 = 같은 배치
  maxActive: 14,              // 동시에 존재하는 빙하 상한
  activeRange: 24,            // 카메라 주변 이 거리 안에서만 생성
  fadeRange: [14, 21],        // 이 거리에서 진함 → 옅음
  fadeInTime: 1.2,            // 새로 나타날 때 서서히 진해지는 시간
  sizeStart: [0.6, 1.0],      // 시작 빙하 대비 지름 비율 (출발 근처)
  sizeEnd: [0.15, 0.3],       // 섬 근처
  gapEarly: [0.25, 0.7],      // 초반 간격 = 점프 최대 거리 × 이 비율 (0.7 이하 = 점프로 건넘)
  gapLate: [0.95, 1.9],       // 중반 이후 (1 근처 = 겨우 닿음, 그 이상 = 수영)
  earlyUntil: 0.3,            // 진행률(0~1) 이 지점까지 초반
  openSea: 7,                 // 상륙 직전 빙하 없는 열린 바다 길이
  density: { left: 1.3, right: 0.75 },  // 클수록 촘촘 (왼쪽 = 물고기 쪽)
  pathWobble: 0.8,            // 경로 빙하가 위아래로 흩어지는 폭
  sideFloes: 2,               // 경로 한 칸당 곁 빙하 수 (출발 근처 기준, 갈수록 줄어듦)
  sideScatter: [3, 7],        // 곁 빙하가 경로에서 떨어진 거리
};

window.CONFIG = {
  WATER_PRESETS: { calm: WATER_CALM, normal: WATER_NORMAL },
  water: WATER_CALM,          // ← WATER_NORMAL 로 바꿔 끼우면 보통 물결 (URL ?water=normal 도 가능)
  PHYSICS,
  ICE_FIELD,

  ui: {
    // 왼쪽 아래 이동 링. inset = 화면 가장자리 ~ 링 바깥선 간격(엄지 하나 정도)
    ring: {
      insetX: 70, insetY: 46,
      radius: 34,
      lineWidth: 3,
      hitRadius: 100,          // 실제 터치 판정 반지름 (표시보다 넉넉하게)
      maxPush: 46,             // 엄지를 이만큼 밀면 최대 힘 (px)
      deadZone: 6,
      releasePush: 170,        // 터치 시작점에서 이만큼 벗어나면 입력 0 (역할은 뗄 때까지 유지)
    },
    action: { insetX: 70, insetY: 46, radius: 38, hitRadius: 100 },
    adapt: { lightAlpha: 0.42, darkAlpha: 0.5, threshold: [0.35, 0.6], smooth: 3, sampleMs: 120 },
  },

  input: {
    doubleTapMs: 260,
    longPressMs: 220,
    penguinHitPx: 48,
  },

  camera: {
    viewHeight: 12, followRate: 2.6, lead: 0.35,
    rotateSensX: -0.006, rotateSensY: 0.004, rotateSmooth: 14,
    pitchDeg: 52, pitchMinDeg: 28, pitchMaxDeg: 82, screenY: 0.5,
  },

  penguin: {
    scale: 1.3,               // ★ 펭귄 크기 배율 (그림·잡기 영역·반영 함께)
    height: 0.75,
    swimSink: 0.5,            // 수영 시 몸이 잠기는 비율 (그림)
    walkWobbleDeg: 7, walkWobbleFreq: 9,
  },

  floe: {
    scale: 1.25,              // ★ 시작 빙하 크기 배율 (그림·발판 판정 함께)
    radiusX: 2.4, radiusY: 1.8,
    maxSpeed: 8,
  },

  reflect: { alpha: 0.3, fadeLength: 0.95, wobblePx: 2.2, slices: 10 },

  fish: {
    delay: 1.8, startSide: 1.8, front: 0.7, landSide: 2.4,
    jump1: { height: 2.0, duration: 0.95 }, pause: 0.35,
    jump2: { distance: 3.6, height: 0.9, duration: 0.6, rise: 0.8 }, size: 0.75,
  },

  world: {
    islandDistance: 40, islandHalfWidth: 16, islandHalfLength: 40,
    shoreHeight: 0.22, summitHeight: 34, nearDist: 9, farDist: 34,
    farRidgeParallax: 0.1, farRidgeShow: [30, 16],
  },

  fullscreenOnFirstTouch: true,
};
