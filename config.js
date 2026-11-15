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
  curve: {                    // 물결을 직선 대신 유동적인 곡선으로
    lineAmp: 0.16,            // 잔물결선이 휘는 폭 (월드)
    lineWaves: [0.9, 2.2],    // 사인 두 개의 파수 (길이 1당)
    noiseAmp: 0.1,            // 저주파 노이즈 휨 폭
    noiseScale: 0.6,          // 노이즈 주파수
    flowSpeed: 0.35,          // 물결선 모양이 흘러가는 속도
    morphSpeed: 0.22,         // 모양이 서서히 바뀌는 속도
    farCount: 14,             // 먼 곳 물결선 수 (먼 곳일수록 촘촘·옅게)
    wakeBend: 0.35,           // 항적 호가 바깥으로 갈수록 휘는 정도 (rad)
    rippleWobble: 0.07,       // 원형 파문의 일그러짐 (반지름 비율)
    rippleThickVar: 0.45,     // 파문 가장자리 두께 변화 비율
    vortex: { every: 1.4, life: 1.6, radius: 0.32, alpha: 0.2, max: 8 },  // 지나간 뒤 양옆에 말려 도는 와류
  },
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
  curve: { lineAmp: 0.26, lineWaves: [0.8, 2.0], noiseAmp: 0.18, noiseScale: 0.7, flowSpeed: 0.6, morphSpeed: 0.4, farCount: 20,
    wakeBend: 0.5, rippleWobble: 0.1, rippleThickVar: 0.6, vortex: { every: 1.1, life: 2.0, radius: 0.4, alpha: 0.26, max: 8 } },
};

// ── 안개 ───────────────────────────────────────────────────
const FOG = {
  dist: { start: 8, end: 75, max: 0.82 },        // 거리 안개: 수면·빙하·물결
  mountain: { start: 12, end: 48, max: 0.98 },   // 섬의 산: 멀리선 거의 안 보이다가 가까워질수록 드러남
  horizonBand: { height: 0.14, alpha: 0.55 },    // 수평선 부근 옅은 안개띠 (화면 높이 비율)
  layers: [                                      // 천천히 흐르는 큰 안개 층 (y = 수평선 기준 화면 높이 비율)
    { alpha: 0.12, y: -0.02, height: 0.22, speed: 0.012, scale: 1.0 },
    { alpha: 0.08, y: 0.1, height: 0.26, speed: -0.008, scale: 1.4 },
    { alpha: 0.05, y: -0.14, height: 0.3, speed: 0.005, scale: 2.0 },
  ],
  resolution: 0.125,          // 안개 층 오프스크린 해상도 (화면 대비)
  keepClearDepth: 9,          // 이보다 가까운 것(펭귄·가까운 빙하)은 안개 층 위에 그려 선명하게
};

// ── 반딧불이 (바다 야광 플랑크톤 같은 푸른빛 무리) ─────────────────
const FIREFLY = {
  route: [                    // 섬까지 안내 경로 웨이포인트 [x, y, 높이]. 마지막 = 낮은 해안
    [-9, 1.5, 1.1], [-15, -2.5, 1.2], [-21.5, 1.5, 1.2], [-28, -1.5, 1.1], [-34, 0.5, 1.0], [-43.5, 0, 1.1],
  ],
  reachDist: 5,               // 펭귄이 이만큼 다가오면 다음 웨이포인트로
  speed: 3.2,                 // 비행 속도
  hover: 0.25,                // 무리 전체가 제자리에서 맴도는 폭
  count: 16,                  // 무리 점 수 (12~20 권장)
  mobileMax: 30,              // 상한
  hue: [195, 215], sat: 95, light: 58,   // 청색 계열, 채도 높게
  size: [0.025, 0.07],        // 빛 알맹이 크기 범위 (월드)
  glow: [0.18, 0.5],          // 번짐 크기 범위 (월드)
  brightness: [0.45, 1],      // 밝기 범위
  flickerHz: [0.5, 2.2],      // 깜빡임 빠르기 범위
  swarmRadius: [0.2, 1.3],    // 무리 퍼짐 반경 범위
  haloAlpha: 0.2,             // 미색 바탕에서도 보이도록 깔아 주는 푸른 번짐 (일반 합성)
  reflectAlpha: 0.32,         // 수면 반사
  trail: { life: 0.5, every: 0.05, alpha: 0.3, size: 0.8, max: 24 },  // 이동할 때 수면을 따라 번지는 잔광
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
  superJump: { heightMul: 1.8, distanceMul: 1.6, airtime: 1.0 },  // 두 번 탭: 높이·거리 배율, 체공(초)
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
// 빙하는 길이 아니라 쉬어 가는 징검다리. 바다 곳곳에 하나둘 떠 있고 대부분은 열린 바다.
const ICE_FIELD = {
  seed: 20261115,             // 같은 시드 = 같은 배치
  maxActive: 8,               // 동시에 존재하는 빙하 상한
  activeRange: 26,            // 펭귄 주변 이 거리 안에서만 생성
  fadeInTime: 1.2,            // 새로 나타날 때 서서히 진해지는 시간
  // 위치 고정 빙하 (월드 좌표, size = 시작 빙하 대비 지름 비율)
  fixed: [
    { x: 0, y: 0, size: 1, start: true },     // 시작 빙하
    { x: -5.2, y: 2.6, size: 0.72 },          // 왼쪽 앞 첫 빙하 (점프 한 번으로 건넘)
    { x: -3, y: -4.6, size: 0.28 },           // 오른쪽 조각
  ],
  spacing: [7, 12],           // 시드 배치 열 간격: 출발 근처 ~ 섬 근처 (점점 넓어짐)
  perColumn: 2.2,             // 열마다 평균 빙하 수 (출발 근처 기준, 섬 쪽으로 갈수록 줄어듦)
  density: { left: 1.0, right: 0 },     // 오른쪽은 고정 조각 하나 뒤로 열린 바다만
  spreadY: 22,                // 바다 위아래로 흩어지는 폭
  bigShare: 0.3,              // 큰 빙하 비율 (섬 쪽으로 갈수록 줄어듦)
  sizeStart: [0.6, 1.0],      // 큰 빙하 크기 (시작 빙하 대비)
  sizeEnd: [0.15, 0.3],       // 작은 조각 크기
  openSea: 8,                 // 상륙 직전 빙하 없는 열린 바다 길이
  keepClear: 3,               // 고정 빙하·물고기 구역 주변 여백
};

window.CONFIG = {
  WATER_PRESETS: { calm: WATER_CALM, normal: WATER_NORMAL },
  water: WATER_CALM,          // ← WATER_NORMAL 로 바꿔 끼우면 보통 물결 (URL ?water=normal 도 가능)
  PHYSICS,
  ICE_FIELD,
  FOG,
  FIREFLY,

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
    // 오른쪽 물갈퀴 발바닥 버튼 (반지름·터치 영역 약 1.4배, 알파 약 70%)
    action: { insetX: 70, insetY: 46, radius: 53, hitRadius: 140, alphaScale: 0.7 },
    adapt: { lightAlpha: 0.42, darkAlpha: 0.5, threshold: [0.35, 0.6], smooth: 3, sampleMs: 120 },
  },

  input: {
    doubleTapMs: 260,         // 첫 탭을 뗀 뒤 이 시간 안에 다시 누르면 슈퍼점프
    jumpDelayMs: 0,           // 0 = 탭 즉시 점프. 값을 주면 그만큼 기다렸다 점프(그 사이 두 번째 탭이면 땅에서 바로 슈퍼점프)
    longPressMs: 220,
    penguinHitPx: 48,
  },

  // 펭귄 등 뒤 낮은 시점 (원근 투영). 펭귄 화면 위치·크기와 수평선에 맞춰 카메라 거리·높이를 자동 계산
  camera: {
    pitchDeg: 18, pitchMinDeg: 10, pitchMaxDeg: 55,   // 아래로 끌면 위에서 내려다보는 쪽으로 (최대 55°)
    focal: 1.0,               // 초점 거리 (화면 높이 배수, 클수록 망원)
    horizonY: 0.35,           // 기본 pitch 일 때 수평선 위치 (위에서부터 비율)
    penguinScreenY: 0.78,     // 펭귄 발 위치 (위에서부터 비율, 기본 각도)
    penguinScreenYTop: 0.56,  // 최대 각도에서 펭귄 발 위치 (올릴수록 화면 중앙 쪽으로)
    penguinScreenH: 0.26,     // 펭귄 키 / 화면 높이
    near: 0.35,               // 이보다 가까운 것은 잘라냄
    followRate: 2.6, lead: 0.35,
    rotateSensX: -0.005,      // 가로 드래그 회전 감도 (부호 반대 = 방향 반전)
    rotateSensY: 0.0026,      // 세로 드래그 기울기 감도 (아래로 끌면 내려다봄, 부호 반대 = 방향 반전)
    rotateSmooth: 10,
    startLookAt: [-40, 4],    // 시작 시 바라보는 점 (왼쪽 앞 첫 빙하와 먼 섬이 화면에 들어오게)
    autoTurn: true,           // 손을 떼고 잠시 뒤 다음 목표(반딧불이) 방향으로 천천히 돌아옴
    autoTurnDelay: 2,         // 초
    autoTurnRate: 0.45,       // 돌아오는 빠르기 (작을수록 천천히)
    autoTurnMaxDeg: 100,      // 이보다 크게 돌려 다른 쪽을 보고 있으면 끌어오지 않음
    pitchReturn: false,       // 손을 떼면 기본 각도로 천천히 돌아오기 (기본 끔)
    pitchReturnDelay: 2, pitchReturnRate: 0.5,
  },

  // 바다 이동 한계 (펭귄·빙하가 이 밖으로 나가지 않게 부드럽게 밀어 줌)
  bounds: { x: [-75, 75], y: [-36, 36], push: 6 },

  penguin: {
    scale: 1.3,               // ★ 펭귄 크기 배율 (그림·잡기 영역·반영 함께)
    height: 0.75,
    swimSink: 0.5,            // 수영 시 몸이 잠기는 비율 (그림)
    underwaterAlpha: 0.28,    // 수면 아래 잠긴 몸의 진하기
    swimRingAlpha: 0.5,       // 수영 중 몸 둘레 물결 고리 진하기
    walkWobbleDeg: 7, walkWobbleFreq: 9,
  },

  floe: {
    scale: 1.25,              // ★ 시작 빙하 크기 배율 (그림·발판 판정 함께)
    radiusX: 2.4, radiusY: 1.8,
    maxSpeed: 8,
    topHeight: 0.05,          // 윗면 높이 (수면 위로 아주 낮게)
    sunkDepth: 0.55,          // 물속으로 내려가며 옅어지는 깊이
    sunkAlpha: 0.32,          // 잠긴 부분 진하기 (반투명 회색, 푸른기 약간)
    waterlineAlpha: 0.75,     // 수면과 만나는 흰 물결 링
    contactShadowAlpha: 0.14, // 바로 아래 수면의 접촉 그림자
    facetAlpha: 0.09,         // 윗면 면 분할선
  },

  reflect: { alpha: 0.3, fadeLength: 0.95, wobblePx: 2.2, slices: 10 },

  fish: {
    delay: 1.8,
    startRight: 3.5, ahead: 8,  // 펭귄 기준 오른쪽·앞 (화면 기준)
    landLeft: 4,                // 왼쪽 착수
    jump1: { height: 2.0, duration: 0.95 }, pause: 0.35,
    jump2: { distance: 3.2, ahead: 2, height: 0.9, duration: 0.6 }, size: 0.75,
  },

  world: {
    islandDistance: 40, islandHalfWidth: 16, islandHalfLength: 40,
    shoreHeight: 0.22, summitHeight: 34,
  },

  fullscreenOnFirstTouch: true,
};
