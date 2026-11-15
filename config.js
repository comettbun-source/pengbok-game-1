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
  // 수면 물결 3겹: ① 너울 띠 ② 중간 물결선(어두운 선 + 밝은 선 쌍) ③ 미세 반짝
  swell: {                    // ① 아주 옅은 명암 띠가 천천히 지나감
    count: 4,
    width: [0.3, 0.6],        // 띠 길이 = 화면 폭 × 이 범위
    alpha: [0.04, 0.07],
    period: [8, 14],          // 한 띠가 지나가는 주기 (초)
    thick: 0.5,               // 띠 두께 (월드)
    travel: 6,                // 한 주기 동안 이동 거리 (월드)
  },
  streams: {                  // ② 노이즈 유동장을 따라 흐르는 곡선. 짧은 선 70% + 긴 선 30%
    max: 70,                  // 풀 (미세 반짝과 합쳐 전체 최대 90)
    shortShare: 0.7,
    shortLen: [0.6, 2.2], longLen: [2.2, 4.5],   // 길이 (월드)
    stepLen: 0.2,
    life: [2, 6],             // 수명을 크게 흩뜨려 한꺼번에 나타나고 사라지지 않게 (alpha 는 smoothstep)
    alpha: [0.08, 0.15],
    width: 1.2,               // 가까운 곳 선 굵기 (px)
    pairGap: 2.5,             // 어두운 선 옆 밝은 선 간격 (px)
    pairAlpha: 0.8,           // 밝은 선 진하기 (어두운 선 대비)
    fieldScale: 0.11, curl: 2.0, morph: 0.04,
    dirSpread: 60,            // 흐름 방향 ± 분산 (도)
    speed: [0.05, 0.15],      // 떠가는 속도 (월드/초)
    depth: [3, 45],           // 생성 거리 (먼 곳은 짧고 촘촘, 가까운 곳은 크고 듬성)
    avoid: 1.5,               // 빙하·펭귄 윤곽 × 이 반경 안에서는 윤곽을 따라 감돌아 흐름
    eddyAlpha: 0.12,          // 빙하 하류의 작은 소용돌이 곡선
  },
  glints: { max: 20, rate: 14, life: 0.6, alpha: [0.1, 0.2], depth: [2, 22] },   // ③ 미세 반짝 (흰 점·짧은 선)
  tone: { amp: 0.04, period: 24, scale: 0.35 },   // 수면 전체 밝기를 아주 느린 노이즈로 ±4%
  contours: {                 // 빙하·펭귄 둘레의 번지는 등고선 링
    rings: 3, life: 3.2,      // 동시에 2~3겹, 한 겹 수명 (초)
    spread: 0.9,              // 바깥으로 퍼지는 거리 (월드)
    alpha: 0.2, width: 1.1,
    noise: 0.1,               // 윤곽이 일렁이는 정도
    gaps: 0.3,                // 끊어진 호 비율
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
  },
  ripple: {                   // 원형 파문: 채운 원판 없이 가는 선 링만 (빛의 아이들 느낌)
    life: 2.4,                // 퍼지는 시간 (ease-out)
    rings: 6, ringGap: 0.12,  // 한 번에 6겹(촘촘하게), 0.12초 간격
    centerLight: 0.35,        // 안쪽 겹일수록 밝게 (가운데가 환한 느낌)
    widthFrom: 2, widthTo: 0.5,   // 선 굵기 (px, 가까운 거리 기준)
    fadeIn: 0.1,              // 나타나는 시간, 이후 길게 사라짐
    alpha: 0.32,
    wobble: 0.06,             // 노이즈 일그러짐 (반지름 비율)
    thickVar: 0.4,            // 링 가장자리 두께가 물결처럼 변하는 정도
    breaks: 0.22,             // 끊어진 부분 비율
    lightSide: 0.6,           // 빛 방향(왼쪽 위) 쪽이 밝은 정도
    softness: 0.45,           // (수영 중 몸 둘레 고리 스프라이트용)
  },
  curve: {
    wakeBend: 0.35,           // 항적 호가 바깥으로 갈수록 휘는 정도 (rad)
    vortex: { every: 1.4, life: 1.6, radius: 0.32, alpha: 0.2, max: 8 },  // 지나간 뒤 양옆에 말려 도는 와류
  },
};

// 보통: 약한 바람
const WATER_NORMAL = {
  bob: { periods: [2.6, 4.1], ampsPx: [2.4, 1.6], maxPx: 5, lightBoost: 1.4, tiltDeg: 1.6, penguinLag: 0.25, phaseSpread: 6.28 },
  swell: { count: 5, width: [0.3, 0.6], alpha: [0.06, 0.1], period: [6, 10], thick: 0.6, travel: 8 },
  streams: { max: 70, shortShare: 0.6, shortLen: [0.8, 2.6], longLen: [2.6, 5], stepLen: 0.2, life: [2, 5], alpha: [0.12, 0.2], width: 1.5, pairGap: 2.5, pairAlpha: 0.8,
    fieldScale: 0.13, curl: 2.4, morph: 0.07, dirSpread: 60, speed: [0.1, 0.25], depth: [3, 45], avoid: 1.5, eddyAlpha: 0.16 },
  glints: { max: 20, rate: 20, life: 0.6, alpha: [0.14, 0.26], depth: [2, 22] },
  tone: { amp: 0.05, period: 18, scale: 0.35 },
  contours: { rings: 3, life: 2.6, spread: 1.1, alpha: 0.26, width: 1.3, noise: 0.14, gaps: 0.3 },
  wake: { halfAngleDeg: 19, life: 2.4, spacing: [0.4, 0.9], arcDeg: [18, 42], alphaMax: 0.42, lineWidth: 1.3, maxParticles: 40 },
  flowLines: { count: 3, alpha: 0.24, lengthSec: 0.6 },
  inertiaTilt: { accelDeg: 3, stopDeg: 2.2, accelRef: 3 },
  settle: { dampingRatio: 0.4, maxPx: 6 },
  splash: { ringRadius: 3.2, ringLife: 2.2 },
  ripple: { life: 2.6, rings: 6, ringGap: 0.12, centerLight: 0.4, widthFrom: 2.4, widthTo: 0.6, fadeIn: 0.1, alpha: 0.4, wobble: 0.09, thickVar: 0.5, breaks: 0.25, lightSide: 0.6, softness: 0.5 },
  curve: { wakeBend: 0.5, vortex: { every: 1.1, life: 2.0, radius: 0.4, alpha: 0.26, max: 8 } },
};

// ── 안개 ───────────────────────────────────────────────────
const FOG = {
  dist: { start: 8, end: 75, max: 0.55 },        // 바탕에 고르게 깔린 거리 안개 (낮춤)
  mountain: { start: 12, end: 48, max: 0.9 },    // 섬의 산: 멀리선 거의 안 보이다가 가까워질수록 드러남
  horizonBand: { height: 0.12, alpha: 0.3 },     // 수평선 부근 옅은 안개띠
  // 흘러가는 안개덩이: fbm 노이즈 타일 하나를 만들어 여러 겹으로 스크롤
  clumps: {
    tileSize: 128, octaves: 5, seed: 7,
    threshold: [0.42, 0.8],   // 이 구간에서 옅음→진함 (진한 곳과 빈 곳이 섞이게)
    // scale = 타일 한 장이 덮는 화면 폭 비율, speed = 흐르는 속도(화면 폭/초), alpha = 진한 곳 농도
    layers: [
      { scale: 2.4, speed: 0.004, alpha: 0.42, y: -0.08, height: 0.55 },   // 먼 층: 느리고 크게
      { scale: 1.4, speed: 0.01, alpha: 0.32, y: 0.0, height: 0.6 },
      { scale: 0.75, speed: 0.024, alpha: 0.26, y: 0.12, height: 0.9, near: true },  // 가까운 층: 빠르고 작게, 펭귄 앞을 지나감
    ],
  },
  penguinClear: { radius: 0.24, keep: 0.6 },     // 펭귄 중심 반경(화면 높이 비율)에서 가까운 층 농도를 60% 로
  resolution: 0.125,          // 안개 오프스크린 해상도 (화면 대비)
  keepClearDepth: 9,          // 이보다 가까운 것은 먼 안개 층 위에 그림
};

// ── 반딧불이 (바다 야광 플랑크톤 같은 푸른빛 무리) ─────────────────
const FIREFLY = {
  route: [                    // 섬까지 안내 경로 웨이포인트 [x, y]. 마지막 = 낮은 해안
    [-9, 1.5], [-15, -2.5], [-21.5, 1.5], [-28, -1.5], [-34, 0.5], [-43.5, 0],
  ],
  reachDist: 5,               // 펭귄이 이만큼 다가오면 다음 웨이포인트로
  speed: 3.2,                 // 군집 이동 속도
  curve: 0.45,                // 물살처럼 곡선으로 흐르는 정도 (rad)
  curveFreq: 0.35,
  inertia: 1.6,               // 방향·속도가 바뀌는 부드러움 (작을수록 크게 휨)
  depth: [0.1, 0.5],          // 수면 아래 깊이
  // 형태: 부드러운 빛 덩이(보케) 5~7개 + 주변의 아주 작고 흐린 입자
  blobs: [5, 7],
  blobSize: [0.08, 0.25],     // 빛 덩이 반지름 (월드)
  blobAlpha: [0.2, 0.35],     // 중심 alpha (0.35 이하)
  blobSpread: 0.55,           // 군집 중심에서 퍼진 정도 (가우시안 σ, 월드)
  particles: 34, particleSize: [0.01, 0.028], particleAlpha: [0.12, 0.28], particleSpread: 0.75,
  follow: 1.1,                // 입자가 군집 중심을 따라가는 빠르기 (느리게)
  breath: { period: [3, 6], amount: 0.25 },     // 깜빡임 없이 숨쉬듯 ±25%
  hue: [190, 200], sat: [65, 75], light: [62, 70],   // 채도를 낮춘 맑은 청록, 중심은 흰빛에 가까운 푸른 번짐
  shadowAlpha: 0,             // 수중 그림자 없음
  overFogAlpha: 0.45,         // 안개 위로 한 번 더 비치는 빛 덩이
  farFade: [10, 45, 0.5],
  // 꼬리·반짝임은 아주 은은하게: 펭귄·빙하가 물을 휘저은 자리에서만
  sparkle: {
    max: 150,
    trailRate: 8, trailLife: [2, 3.5],
    swimRate: 10, swimLife: [2, 3.5], swimSpread: 0.35,
    ringRate: 2, wakeCount: 1, waveLife: 2.5,
    shoreRate: 0, shoreLife: [0.8, 1.6],
    size: [0.04, 0.09],       // 작은 빛 번짐 반지름 (월드)
    alpha: 0.18,              // 최대 진하기
  },
};


// ── 경량 물리 ──────────────────────────────────────────────
const PHYSICS = {
  hz: 60,                     // 고정 시간 단계
  gravity: 22,
  penguin: {
    mass: 1,
    moveForce: { ice: 3.5, shore: 5.5, water: 9 },  // 링 입력이 주는 힘 (빙하·흙은 작게 → 천천히 가속)
    maxSpeed: { ice: 2.2, shore: 1.2, water: 2.8 },  // 흙(해안)은 물·빙하의 약 50%
    airForce: 3,
  },
  friction: { ice: 0.56, shore: 4.5, water: 3.2 },  // 걷기·수영 감쇠 (1/초). 빙하는 미끌미끌(이전의 40%), 흙은 뻑뻑
  slideFriction: { ice: 0.15, shore: 6, water: 1.4 }, // 슬라이딩 감쇠: 빙하 위는 길게, 흙에선 금방 멈춤
  shoreJump: { velocityMul: 0.72, forwardMul: 0.6 },  // 흙에서 점프: 낮고 짧게
  shoreSlideMul: 0.55,        // 흙에서 슬라이딩 시작 속도 배율
  jumpVelocity: 6.6,          // 점프 초기 속도 → 체공 = 2v/g ≈ 0.6초
  superJump: { heightMul: 1.8, distanceMul: 1.6, airtime: 1.0 },  // 두 번 탭: 높이·거리 배율, 체공(초)
  jumpForwardSpeed: 3.4,      // 링을 민 채 점프할 때 수평 속도 (점프 최대 거리 = 이 값 × 체공)
  slideInitialSpeed: 4.6,     // 슬라이딩 시작 속도
  slideForce: 6,              // 링을 민 채 슬라이딩할 때 미는 힘
  slideMaxSpeed: 5.2,
  slideTurnRate: 3.5,         // 링 방향을 따라 슬라이딩 방향이 도는 빠르기
  turnRate: 14,               // 몸 돌리는 속도
  floeDensity: 0.5,           // 빙하 질량 = 넓이 × 밀도 (펭귄 질량 1)
  // 물에 빠질 때: 낙하 속도에 비례해 잠겼다가 부력 스프링으로 동동동 (주기 약 1초, 감쇠비 0.25)
  waterEntry: { period: 1.0, dampingRatio: 0.25, maxSinkBody: 0.5, minSink: 0.18, sinkPerSpeed: 0.05 },
  // 물에서 가만히 있을 때 느리게 떠다님 (수영 입력을 주면 사라짐)
  drift: { speed: 0.15, turnRate: 0.35, blend: 0.6, rockDeg: 3, rockPeriod: 4.2 },
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
  perColumn: 1.8,             // 열마다 평균 빙하 수 (출발 근처 기준, 섬 쪽으로 갈수록 줄어듦)
  density: { left: 1.0, right: 0 },     // 오른쪽은 고정 조각 하나 뒤로 열린 바다만
  spreadY: 22,                // 바다 위아래로 흩어지는 폭
  bigShare: 0.3,              // 큰 빙하 비율 (섬 쪽으로 갈수록 줄어듦)
  sizeStart: [0.6, 1.0],      // 큰 빙하 크기 (시작 빙하 대비)
  sizeEnd: [0.15, 0.3],       // 작은 조각 크기
  openSea: 8,                 // 상륙 직전 빙하 없는 열린 바다 길이
  keepClear: 3,               // 고정 빙하·물고기 구역 주변 여백
};

// ── 해안 물결 (섬 위로 물이 쏴아 들어왔다 나감) ─────────────────────
const SHORE_WASH = {
  segment: 0.5,               // 해안선을 나누는 구간 길이 (구간마다 위상·세기가 다름)
  sweep: 0.12,                // 구간 사이 도착 지연 (초/월드) → 물의 혀가 해안을 따라 옆으로 번지듯 들어옴
  strengthVar: 0.4,           // 구간마다 도달 거리 ±40%
  waves: [2, 3],              // 한 묶음에 연달아 올라오는 파도 수
  waveGap: 2.2,               // 묶음 안 파도 간격 (초)
  setInterval: [7, 11],       // 묶음 간격 (초, 무작위)
  rise: 1.6, fall: 3.2,       // 올라올 때(ease-out) / 빠질 때 (초)
  shoreWidth: 5,              // 해안(물가 ~ 산 밑) 폭 (월드)
  reach: 0.25,                // 최대로 올라오는 폭 = 해안 폭 × 이 값
  dryTime: 6,                 // 젖은 땅이 마르는 시간 (초)
  markLife: 4,                // 최대로 올라왔던 자리의 얇은 곡선 자국 수명
  rivulets: [2, 3], rivuletLife: 2.5,   // 물 빠질 때 물줄기 자국 가닥 수·수명
  edgeLineAlpha: 0.35,        // 물 끝선의 얇고 옅은 흰 선
  waterAlpha: 0.3,            // 땅 위로 올라온 얇은 물막
  wetAlpha: 0.32,             // 젖은 땅이 어두워지는 정도
  resolution: 0.25,           // 젖음 표시 오프스크린 해상도 (화면 대비)
  slowMul: 0.7,               // 물이 올라온 곳에 서 있으면 속도 배율
  rippleEvery: 0.45,          // 그때 생기는 작은 파문 간격 (초)
};

// ── 모래 발자국 (발바닥 버튼과 같은 모양) ─────────────────────────────
const FOOTPRINTS = {
  size: 0.11,                 // 발자국 크기 (월드)
  stride: 0.5,                // 왼발·오른발 좌우 간격 = 펭귄 키 × 이 값 (몸 폭 정도)
  pressTime: 0.1,             // 찍힐 때 80% → 100% 로 커지는 시간 (초)
  pressFrom: 0.8,
  life: 6,                    // 모래: 서서히 사라지는 시간 (초)
  max: 30,                    // 모래 발자국 풀
  alpha: 0.3,                 // 모래 발자국 진하기
  innerAlpha: 0.16,           // 눌린 안쪽이 더 어두운 정도
  ice: { alpha: 0.14, life: 2.5, max: 30, color: [140, 146, 152] },   // 빙하: 옅은 회색 긁힘 자국 (빙하 좌표계에 저장)
  slideTrail: { alpha: 0.2, life: 3, width: 0.03, spacing: 0.08, max: 90 },  // 빙하 위 슬라이딩 활주 자국 한 줄
};

// ── 명암·그림자 블러 (ctx.filter 없이 스프라이트·겹 그리기·축소 캐시로) ─────────
const SHADOW_BLUR = {
  ratio: 0.25,                // 경계 번짐 폭 = 그림자 크기 × 이 값 (20~30%)
  layers: 5,                  // 다각형 그림자를 크기를 바꿔 겹쳐 그리는 횟수 (클수록 부드럽게)
  facetTexture: 96,           // 빙하 윗면 음영 캐시 크기 (px)
  facetDownscale: 6,          // 음영을 이만큼 줄였다 키워 경계를 흐림 (생성 때 한 번)
  wetResolution: 0.15,        // 젖은 땅 오프스크린 해상도
};

window.CONFIG = {
  WATER_PRESETS: { calm: WATER_CALM, normal: WATER_NORMAL },
  water: WATER_CALM,          // ← WATER_NORMAL 로 바꿔 끼우면 보통 물결 (URL ?water=normal 도 가능)
  PHYSICS,
  ICE_FIELD,
  FOG,
  FIREFLY,
  SHORE_WASH,
  FOOTPRINTS,
  SHADOW_BLUR,

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
    pitchDeg: 23, pitchMinDeg: 10, pitchMaxDeg: 55,   // 기본 23° (멀리 위에서), 아래로 끌면 최대 55° 까지 내려다봄
    focal: 0.88,              // 초점 거리 (화면 높이 배수). 작을수록 넓게 보이고 원근이 강해짐
    horizonY: 0.35,           // 기본 pitch 일 때 수평선 위치 (위에서부터 비율)
    penguinScreenY: 0.78,     // 펭귄 발 위치 (위에서부터 비율, 기본 각도)
    penguinScreenYTop: 0.56,  // 최대 각도에서 펭귄 발 위치 (올릴수록 화면 중앙 쪽으로)
    viewHeight: 1.3,          // 시야 배율: 기존(펭귄 키 = 화면의 26%) 대비 이만큼 넓게 봄
    penguinScreenH: 0.26,     // 기준 펭귄 키 / 화면 높이 (viewHeight 로 나눠 씀)
    penguinMinScreenH: 0.18,  // 펭귄이 이보다 작아지지 않게 (화면 높이 비율)
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
    // 걸음 흔들림: 빙하 위는 작게, 흙 위는 느리고 크게 (뒤뚱뒤뚱)
    walk: {
      ice: { wobbleDeg: 3, wobbleFreq: 7, stepSinkPx: 0 },
      shore: { wobbleDeg: 12, wobbleFreq: 5, stepSinkPx: 2.5 },   // 한 걸음마다 2~3px 가라앉았다 올라옴
    },
    iceLeanDeg: 6,            // 빙하 위에서 진행 방향으로 기우는 각도 (최대 속도일 때)
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
    facetAlpha: 0.09,         // (사용 안 함, relief 로 대체)
    // 윗면 굴곡: 빙하마다 시드로 둔덕·경사·쐐기 모양. 면 정보는 생성 때 한 번만 계산
    relief: {
      heightFrac: [0.07, 0.13], // 높이 = 빙하 지름 × 이 범위
      slab: 0.75,               // 판형: 가장자리도 이만큼 높아 옆면이 깎아지른 절벽, 윗면은 넓고 평평하게
      startScale: 0.55,         // 시작 빙하는 완만하게
      wedgeShare: 0.35,         // 한쪽이 높고 비스듬히 내려오는 쐐기 모양 비율
      lip: 0.04,                // 가장자리 기본 높이
      facets: [3, 6],           // 윗면 면 수
      slideSlope: 0.3,          // 이보다 가파르면 미끄러져 내려옴 (높이/거리)
      slideAccel: 4,            // 미끄러져 내려오는 가속
      ridgeAlpha: 0.55,         // 능선의 얇은 밝은 선
      shadeLight: [255, 255, 255], shadeDark: [202, 205, 208],   // 빛(왼쪽 위)을 향한 면 ~ 반대 면
      cliffDark: [186, 189, 192],                                // 깎아지른 절벽 옆면
    },
  },

  reflect: { alpha: 0.3, fadeLength: 0.95, wobblePx: 2.2, slices: 10 },

  fish: null,                 // 시작 물고기 연출 (비활성, 코드 삭제됨)
  // 시작 연출: 펭귄 왼쪽 앞 수면에 파문 링 하나 → 그 자리에서 반딧불이 군집이 서서히 밝아지며 첫 빙하 쪽으로 흘러감
  intro: {
    delay: 1.5,               // 시작 후 파문까지 (초)
    left: 4.5, ahead: 3.5,    // 펭귄 기준 왼쪽·앞 거리 (화면 기준)
    rippleRadius: 2.4,
    fadeIn: 2,                // 군집이 밝아지는 시간 (초)
  },

  world: {
    islandDistance: 40, islandHalfWidth: 16, islandHalfLength: 40,
    shoreHeight: 0.22, summitHeight: 34,
  },

  fullscreenOnFirstTouch: true,
};
