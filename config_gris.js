// ─────────────────────────────────────────────────────────────
//  조작감·물·물리·빙하 배치 조정 값 모음 — 이 파일만 고치면 됩니다.
//  거리 단위: 월드 (화면 세로에 camera.viewHeight 만큼 보임). UI·출렁임 단위: CSS px.
//  로컬 실행 시 URL 로 임시 덮어쓰기: index.html?water=normal&cfg=PHYSICS.gravity=20,ICE_FIELD.seed=7
// ─────────────────────────────────────────────────────────────

// ── 물결·출렁임 프리셋 ─────────────────────────────────────
// 잔잔함: 바람 거의 없는 물, 큰 파도 없음
// ── 색 (한 곳에 모음): 흑백 + 푸른 포인트 ─────────────────────────────
// 위계: 빙하(순백) > 펭귄 > 반딧불이(유일한 색, 푸른색) > 나머지는 전부 검정 계열
const PALETTE = {
  skyTop: [5, 7, 10], skyHorizon: [28, 35, 45],       // 하늘: 위 → 수평선
  sea: [11, 15, 20],                                   // 바다 기본 (순흑 아님)
  fog: [13, 18, 25],                                   // 거리 안개가 수렴하는 색 (청흑)
  fogBand: [28, 35, 45],                               // 수평선 안개띠 (살짝 밝게)
  fogClumps: [[28, 35, 45], [10, 13, 18]],             // 안개 덩이 2톤 (층마다 번갈아)
  floe: {
    top: [255, 255, 255], mid: [232, 234, 237], shade: [170, 176, 184],   // 윗면 밝은 면 · 중간 · 그늘
    side: [214, 218, 224], sideLight: [240, 242, 245], cliff: [150, 156, 166],   // 옆면 · 빛 받는 옆면 · 높은 절벽
    sunk: [84, 100, 120],                              // 물에 잠긴 부분
    glow: [200, 222, 246], glowAlpha: 0.12,            // 빙하 아래 수면의 옅은 청백색 반사광 (그림자 대신)
    reflectAlpha: 0.4, reflectLength: 1.0,             // 검은 물에 비치는 빙하 옆면 (수면선 0.4 → 0, 길이 = 옆면 높이 × 이 값)
  },
  mount: { far: [42, 49, 59], near: [0, 0, 0], faceLift: 0.05 },   // 산: 멀수록 안개에 밝아지고(수평선 쪽) 가까울수록 순흑 실루엣
  sand: [58, 60, 64], wetSand: [21, 24, 28], shallowSand: [30, 34, 40],   // 해안 모래 · 젖은 곳 · 얕은 물에 비치는 모래
  waterLine: [170, 186, 208], waterLineAlpha: 0.6,     // 물결선 (밝은 선), 기존 alpha × 이 값
  pairDark: [0, 0, 0], pairDarkAlpha: 0.35,            // 밝은 선 옆에 짝으로 그리는 어두운 선
  simLight: [200, 214, 232], simLightAlpha: 0.5,       // 물 엔진: 빛 받는 면
  simDark: [0, 0, 0], simDarkAlpha: 0.35,              // 물 엔진: 그늘진 면
  crest: [255, 255, 255],                              // 물마루 흰 선
  film: [200, 214, 232], foam: [255, 255, 255],        // 해안 물막 · 거품
  penguin: { black: '#000000', white: '#ffffff', beak: '#7a7a7a',
    rimAlpha: 0.3, rimWidth: 0.03 },                   // 물에 있을 때 몸 윤곽의 얇은 흰 림 라이트 (폭 = 키 비율). 빙하 위에선 꺼짐
  firefly: { body: '#3fb4ff', outer: '#5a6cff', rim: '#9c9cf4', core: '#eaf9ff',
    waterGlow: [63, 180, 255], waterGlowAlpha: 0.1, waterGlowRadius: 2.4 },   // 군집 근처 물 면에만 번지는 푸른 반사
  ui: { ink: [40, 40, 44], buttonBg: 'rgba(255, 255, 255, 0.12)', buttonText: '#c9ced6' },
};

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
    count: 0,                 // (4 → 0) 실제로 쓰는 WATER_CALM: 화면을 가로지르는 긴 띠로 보여서 끔
    width: [0.3, 0.6],        // 띠 길이 = 화면 폭 × 이 범위
    alpha: [0.04, 0.07],
    period: [8, 14],          // 한 띠가 지나가는 주기 (초)
    thick: 0.5,               // 띠 두께 (월드)
    travel: 6,                // 한 주기 동안 이동 거리 (월드)
  },
  streams: {                  // ② 노이즈 유동장을 따라 흐르는 곡선. 짧은 선 70% + 긴 선 30%
    max: 0,                   // (70 → 0) 실제로 쓰는 WATER_CALM: 낮은 카메라에서 가는 가로선으로 보여서 끔. 풀 (미세 반짝과 합쳐 전체 최대 90)
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
    eddyAlpha: 0,             // (0.12 → 0) 빙하 하류 소용돌이 곡선: 낮은 카메라에서 떠다니는 가는 고리처럼 보여서 끔
    darkMul: 0.8,             // 어두운 선 진하기 배율
  },
  // 헤엄칠 때: 선 대신 부드러운 명암 면 (앞쪽 밝은 물 덩어리, 양옆·뒤 어두운 골, 뒤로 길쭉한 얼룩)
  swimShade: { every: 0.12, life: 1.2, scale: [0.4, 1.3], brightAlpha: 0.11, darkAlpha: 0.04, max: 10, length: 1.5 },   // (GRIS: 0.2/0.07, 길이 2.2 → 0.11/0.04, 1.5) 헤엄 자국이 V자로 강해 보여서 작고 옅게
  glints: { max: 20, rate: 14, life: 0.6, alpha: [0.1, 0.2], depth: [2, 22] },   // ③ 미세 반짝 (흰 점·짧은 선)
  tone: { amp: 0.04, period: 24, scale: 0.35 },   // 수면 전체 밝기를 아주 느린 노이즈로 ±4%
  contours: {                 // 빙하·펭귄 둘레의 번지는 등고선 링
    rings: 0, life: 3.2,      // 동시에 몇 겹 (0 = 끔), 한 겹 수명 (초)
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
    alphaMax: 0,              // 최고 속도일 때 시작 불투명도
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
    bigFade: [0.6, 1.8],      // 반지름이 이 범위로 커지면 옅어져 사라짐 (낮은 카메라에서 큰 고리가 긴 가로선처럼 보여서)
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
  swell: { count: 0,  /* (5 → 0) 화면을 가로지르는 긴 직선 띠로 보여서 끔 */ width: [0.3, 0.6], alpha: [0.06, 0.1], period: [6, 10], thick: 0.6, travel: 8 },
  streams: { max: 0,  /* (70 → 0) 카메라가 낮아 물결 흐름 선이 곳곳에 가는 가로선으로 보여서 끔 */ shortShare: 0.6, shortLen: [0.8, 2.6], longLen: [2.6, 5], stepLen: 0.2, life: [2, 5], alpha: [0.12, 0.2], width: 1.5, pairGap: 2.5, pairAlpha: 0.8,
    fieldScale: 0.13, curl: 2.4, morph: 0.07, dirSpread: 60, speed: [0.1, 0.25], depth: [3, 45], avoid: 1.5, eddyAlpha: 0.16 },
  glints: { max: 20, rate: 20, life: 0.6, alpha: [0.14, 0.26], depth: [2, 22] },
  tone: { amp: 0.05, period: 18, scale: 0.35 },
  contours: { rings: 3, life: 2.6, spread: 1.1, alpha: 0.26, width: 1.3, noise: 0.14, gaps: 0.3 },
  wake: { halfAngleDeg: 19, life: 2.4, spacing: [0.4, 0.9], arcDeg: [18, 42], alphaMax: 0,  /* (0.42 → 0) 카메라가 낮아 V자 항적 호가 바다를 가로지르는 긴 직선으로 보여서 끔 */ lineWidth: 1.3, maxParticles: 40 },
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
  // GRIS: 빙하 전용 안개. 멀수록 흐려지고(옅은 수평선 안개색으로 녹음) 둘레를 안개가 감쌈
  floe: { start: 12, end: 34, max: 0.65, color: PALETTE.fogBand, halo: 0.55, haloSize: 1.5 },
  mountain: { start: 12, end: 48, max: 0.9 },    // 섬의 산: 멀리선 거의 안 보이다가 가까워질수록 드러남
  horizonBand: { height: 0.12, alpha: 0.3 },     // 수평선 부근 옅은 안개띠
  // 흘러가는 안개덩이: fbm 노이즈 타일 하나를 만들어 여러 겹으로 스크롤
  clumps: {
    tileSize: 256, octaves: 5, seed: 7,   // (128 → 256) 크게 늘여 그려서 무늬가 깨지지 않게
    threshold: [0.42, 0.8],   // 이 구간에서 옅음→진함 (진한 곳과 빈 곳이 섞이게)
    // scale = 타일 한 장이 덮는 화면 폭 비율, speed = 흐르는 속도(화면 폭/초), alpha = 진한 곳 농도
    layers: [
      { scale: 2.4, speed: 0.004, alpha: 0.42, y: -0.08, height: 0.55 },   // 먼 층: 느리고 크게
      { scale: 1.4, speed: 0.01, alpha: 0.32, y: 0.0, height: 0.6 },
      { scale: 0.75, speed: 0.024, alpha: 0.26, y: 0.12, height: 0.9, near: true },  // 가까운 층: 빠르고 작게, 펭귄 앞을 지나감
    ],
  },
  penguinClear: { radius: 0.24, keep: 0.2, far: 0.15 },   /* far: 펭귄이 멀리 있을 때(시작 장면) 먼 안개도 펭귄 자리는 15% 만 */     // 펭귄 중심 반경(화면 높이 비율)에서 가까운 층 농도를 20% 로 (60% → 20%: 펭귄 얼굴이 안개에 묻혀 어둡지 않게)
  resolution: 0.25,           // (0.125 → 0.25) 안개 오프스크린 해상도 (화면 대비). 부드러운 게 맞아 낮게 두고, 고품질 보간 + 디더로 띠·계단을 숨김
  keepClearDepth: 9,          // 이보다 가까운 것은 먼 안개 층 위에 그림
};

// ── 반딧불이 (바다 야광 플랑크톤 같은 푸른빛 무리) ─────────────────
const FIREFLY = {
  route: [                    // 안내 경로 [x, y]. 마지막 점은 실행 때 해안선 바로 앞 수면으로 맞춰짐
    // GRIS: 이동 선 앞쪽(화면 쪽, y ≈ +3) 바다를 따라 왼쪽으로 → 해안 앞에서 이동 선 쪽으로 들어와 멈춤
    [-5, 3.0], [-14, 3.0], [-28, 3.0], [-34, 2.0], [-38, 0.3],
  ],
  reachDist: 5,
  speed: 3.2,
  depth: [0.04, 0.3],         // 수면 아래 깊이
  members: 9,                 // 빛 구름 수
  size: [0.06, 0.26],         // 빛 구름 크기 (다양하게). 큰 덩이일수록 옅게
  bigSize: 0.16,              // 이 크기 이상인 큰 구름은 multiply 층(pool·outer) 없이 본 번짐 하나만
  bigBodyAlpha: 0.3,          // 그 본 번짐 진하기
  rimMaxSize: 0.1,            // rim 테두리는 이 크기 이하에만 (큰 것에선 띠처럼 보여서 뺌)
  gauss: 3.2,                 // 번짐 모양: alpha × exp(−gauss·r²) (가장자리가 보이지 않게)
  alpha: [1, 0.55],           // 가장 작은 것 ~ 가장 큰 것의 진하기 배율
  cloud: { lobes: [2, 3], stretch: 1.35, pins: [3, 5] },   // 덩이마다 타원 2~3겹(진행 방향으로 길쭉) + 작은 핀포인트 3~5개
  streak: { speedRef: 2.5, maxLen: 3, life: 0.6 },          // 빠르게 움직일 때 진행 반대로 늘어나는 꼬리 (길이 ∝ 속도, 최대 크기×3, 0.6초에 사라짐)
  breath: { period: [3, 6], amount: 0.25 },     // 깜빡임 없이 숨쉬듯 ±25%
  // 색 (알파 합성): 바깥 번짐 #9c9cf4(0.35) · 중간 #b9b9fb(0.5) · 중심 #f0f0ff
  // 색: 밝기 대신 채도 대비 + 주변 어둠. 모두 방사형 그라데이션(중심 → 0), 가산 합성 없음
  // [색, alpha, 크기(빛 구름 대비), 합성]
  colors: {                                          // 색은 PALETTE.firefly. 어두운 바다 위라 전부 가산(lighter) 합성
    outer: [PALETTE.firefly.outer, 0.22, 1.0, 'lighter'],    // ① 바깥 번짐
    body: [PALETTE.firefly.body, 0.45, 0.55, 'lighter'],     // ② 본 번짐
    rim: [PALETTE.firefly.rim, 0.18, 1.2, 'lighter'],        // ③ 가장자리 테두리 (고른 색)
    core: [PALETTE.firefly.core, 0.9, 0.12, 'lighter'],      // ④ 중심 핀포인트
  },
  hue: [205, 212], sat: [80, 90], light: [62, 70],   // 물을 휘저은 자리의 작은 빛 번짐 색 (청색)
  overFogAlpha: 0.45,
  farFade: [10, 45, 0.5],
  // 길 안내: 펭귄 앞에서 맴돌다, 다가오면 경로를 따라 물러남
  guide: {
    holdDist: 4.0,            // 평소 펭귄 앞 이 거리(경로상)에서 맴돎
    fleeTrigger: 3.4,         // 펭귄이 이 안으로 오면 물러남
    fleeBase: 0.8, fleeGain: 1.6,       // 이동량 = clamp(0.8 + 1.6 × 접근속도, min, max)
    fleeStepMin: 1.2, fleeStepMax: 7,
    speedGain: 1.3, speedMin: 0.4, speedMax: 5,   // 군집 속도 = clamp(접근속도 × 1.3, 0.4, 5)
    millRadius: 0.9,          // 각자 맴도는 반경
    memberDelay: [0, 0.5],    // 점마다 반응 지연 (흩어졌다 모이며 흐름)
    sway: 0.9,                // 경로를 따라갈 때 좌우로 휘는 폭
    shoreMinDepth: 0.15,      // 이 수심 이상인 물 위로만 (땅 위로 절대 올라가지 않음)
    shoreGap: 1.6,            // 마지막 지점: 해안선에서 바다 쪽으로 이만큼
    // 항상 펭귄보다 앞: 경로 진행도 s ≥ 펭귄 진행도 + lead (뒤로 줄지 않음)
    lead: {
      rest: 2.4, gain: 0.45,  // (원본 3.6 / 0.9) GRIS: 앞쪽 바다는 카메라에 가까워 화면에서 크게 벌어지므로 짧게. lead = clamp(rest + gain × 펭귄 속도, min, max)
      min: 2.2, max: 3.6,     // (원본 2.8 / 6.5) 가장 멀어도 화면 안에 보이게
      catchUp: 4,             // (원본 1.5) lead 보다 뒤처졌을 때 따라잡는 세기. 점프·슬라이딩 뒤에도 앞서 있게
      followGain: 1.6,        // 군집 중심이 목표를 따라가는 빠르기에 + 펭귄 속도 × 이 값 (빨리 헤엄쳐도 뒤처지지 않게)
      minScreen: 0,           // (원본 0.12) GRIS: 가로로 앞서 있어 화면에서 겹치지 않으므로 세로 간격 조건은 끔
      screenMaxLead: 8,       // 화면 간격 때문에 늘어나는 lead 의 상한 (월드). 기본 카메라(23°)에서 12% 를 다 채우려면 약 30 이 필요해서 막아 둠
    },
    separation: {
      minDist: 2.8,           // 군집 중심 ~ 펭귄 하드 최소 간격. 더 가까우면 즉시 앞으로 물러남
      retreatMul: 1.3,        // 그때 속도 = 펭귄 속도 × 이 값
      memberGap: 1.4,         // 점마다: 펭귄 반경 + 이 값 안으로는 못 들어옴 (≈ 2.0)
      frontBias: 0.6,         // 점 분포를 군집 중심 앞쪽 반원으로 치우침 (0~1)
      overlapScale: 1.3, overlapAlpha: 0.4,   // 펭귄 윤곽 × 1.3 안에서는 번짐을 40% 로
      respawnFade: 0.4,       // 펭귄이 확 지나치면 이 시간 동안 사라졌다 앞에서 다시 나타남 (초)
    },
    // 해안 도착 후: 해안선 앞 shoreGap 지점에 중심 고정, 각자 그 둘레를 천천히 도는 타원 궤도 + 파도에 실려 흔들림
    shore: {
      orbit: [0.25, 0.5],     // 각속도 (rad/s), 점마다 방향도 다름
      orbitR: [0.5, 1.4],     // 궤도 반경
      ellipse: 1.6,           // 해안선 방향 장축 배율
      swayAmp: 0.8,           // 해안 파도 위상 따라 법선 방향으로 밀렸다 당겨짐 (파도가 올라오면 해안 쪽)
      waveFollow: { slope: 6, curl: 0.25, decay: 0.6 },   // 수면 기울기(∇h)에 실림 · curl 노이즈로 휨 · 제자리로 돌아오는 빠르기
    },
  },
  // 꼬리·반짝임은 아주 은은하게: 펭귄·빙하가 물을 휘저은 자리에서만
  sparkle: {
    max: 30, maxActive: 12,   // 풀 30, 동시에 12개 이하
    trailRate: 0, trailLife: [2, 3.5],
    swimRate: 10, swimLife: [2, 3.5], swimSpread: 0.35,
    ringRate: 2, wakeCount: 1, waveLife: 2.5,
    shoreRate: 0, shoreLife: [0.8, 1.6],
    size: [0.04, 0.09],
    alpha: 0.18,
  },
};


// ── 경량 물리 ──────────────────────────────────────────────
// ── 땅 반딧불이 (GRIS): 해안 바위에 앉아 깜빡이다, 펭귄이 다가오면 숲으로 날아감. 바다반딧불이(FIREFLY)와 별개 ─────
const LAND_FIREFLY = {
  perRock: [6, 9], max: 22,            // (3~5·12 → 6~9·22) 바위당 수 · 전체 상한
  arriveGap: [0.6, 1.5], arriveDelay: 1.2, arriveSpeed: 3.2,   // 하나둘씩 날아와 앉음 (간격 · 첫 도착 지연 · 날아오는 속도)
  blink: { on: 0.25, off: [2, 4], syncShare: 0.5, nudge: 0.07, periodPull: 0.03 },   // 0.25초 켜짐 → 2~4초 꺼짐. 일부는 이웃이 켜질 때 박자를 조금씩 당겨 서서히 맞춤
  trigger: 1.3, delay: [0, 0.3],       // (3.0 → 1.3) 펭귄이 만질 수 있을 만큼 다가오면, 가까운 것부터 0~0.3초 지연 뒤 날아오름
  drift: { lift: 0.35, ahead: [1.2, 2.6], speedMul: 1.1, minSpeed: 0.5, maxSpeed: 3.2, fadeAfter: [4, 7] },   // 확 가버리지 않고 펭귄 속도에 맞춰 옆(안쪽)으로 앞서감 · 남는 수를 넘으면 몇 초 뒤 사라짐
  facing: 55,                          // 그리고 펭귄이 바위 쪽을 바라볼 때만 (바라보는 방향 ± 이 각도 안에 바위)
  burst: { time: 0.15, rise: 0.6 },    // 처음 0.15초 급상승
  speed: [2, 5], zigzag: { amp: 0.35, freq: [5, 9] },   // 불규칙한 속도 · 지그재그
  forest: { d: [8, 12], yBack: [2.5, 6] },   // 날아가는 숲 가장자리 (해안선에서 안쪽 거리 · 이동 선 뒤쪽 거리)
  forestPins: [12, 16], pinBlink: { on: 0.6, off: [2.5, 4.5] }, pinDrift: 0.25,   // 숲에 남아 느리게 깜빡이는 수
  // 숲 안으로 길 안내: 남은 반딧불이들이 펭귄보다 앞(섬 안쪽)에서 맴돌다, 다가오면 더 안쪽으로 나아감
  guide: { lead: [1.4, 3.0], yBack: [0.8, 2.2], speed: 2.6, catchUp: 1.6, wander: 0.35, endD: 70, height: 1.15 },
  // 퐁 → 우르르르: 펭귄이 가까이 붙으면 근처 바위의 반딧불이가 다 같이 하늘로 퐁 솟았다가, 한 무리로 섬 안쪽(왼쪽)으로 흘러감 (속도는 펭귄에 맞춤 = drift)
  pop: { group: 6, stagger: [0, 0.22], time: 0.5, rise: [1.1, 1.9], scatter: 0.7, flash: 1, swarmGlow: 6 },   // 함께 날 반경 · 차례로 솟는 지연 · 솟는 시간 · 높이 · 옆으로 흩어짐 · 솟을 때 밝기 · 무리 지어 가는 동안 켜져 있는 시간(초)   // (앞서는 거리 3.5~7 → 1.6~3.8) 가까이서 함께 가는 느낌
  size: [0.012, 0.028], tail: { time: 0.08, alpha: 0.18 },   // (0.03~0.08 → 0.012~0.028) 바다반딧불이처럼 작고 섬세하게 · 아주 짧은 꼬리
  glowScale: [3.2, 1.8],               // 번짐 크기 배율 (바깥 · 중간). 점이 작아도 은은하게 보이게
  rockGlow: 0.1,                       // 바위 윗면에 비치는 아주 옅은 빛
  preset: 'amber',                     // 색 프리셋 (URL ?lf=blue 로 비교)
  presets: {
    amber: { core: '#fff2b0', mid: ['#ffd24d', 0.4], outer: ['#ff9a2e', 0.12] },
    blue: { core: PALETTE.firefly.core, mid: [PALETTE.firefly.body, 0.4], outer: [PALETTE.firefly.outer, 0.12] },
  },
};

// ── 물방울 (GRIS): 물에 빠질 때 둘레로 튀는 작은 방울들 ─────
const SPLASH_DROPS = {
  count: [10, 24], perSpeed: 3,        // 방울 수 = 기본 + 떨어지는 속도 × perSpeed
  speed: [0.5, 1.9], up: [1.2, 3.6],   // 옆으로 · 위로 튀는 속도 (빠르게 떨어질수록 큼)
  size: [0.004, 0.013], gravity: 13, alpha: 0.85, color: [190, 206, 228],   // 빨리 떨어져 퍄샤샥
  ring: 0.6,                           // 떨어진 자리 수면에 아주 작은 파문 (물 엔진 충격 세기 배율, 0 = 끔)
  max: 240,
  // 퍄샤샥: 사진처럼 빠진 자리 둘레로 물 왕관이 솟고, 큰 방울·잔 물보라가 사방으로 흩어짐
  crown: { count: [28, 42], radius: [0.22, 0.38], up: [2.0, 3.6], out: [0.7, 1.7], size: [0.005, 0.016] },   // (0.012~0.045 → 0.005~0.016) 방울 작게
  spray: { count: [20, 32], up: [2.4, 4.2], out: [1.6, 3.6], size: [0.003, 0.008] },
  minPx: 0.35,                         // 화면에서 방울 최소 반지름 (px). 이전 0.6
  sheet: { life: 0.16, height: 0.36, radius: [0.28, 0.6], points: 30, alpha: 0.16, rimAlpha: 0.3, width: 0.025, lean: 0.25 },   // 솟았다 무너지는 얇은 물 왕관 (들쭉날쭉한 윗선 + 옅은 막)   // 솟았다 무너지는 얇은 물 벽 (세로 줄무늬로 표현)
  highlight: 0.6,                      // 큰 방울 가운데 밝은 점
};

// ── 시작 안내 문구 (GRIS): '빛을 따라가세요' 페이드인 → 화면을 터치(또는 키 입력)할 때까지 유지 → 페이드아웃 ─────
const INTRO_HINT = {
  enabled: true,
  text: '빛을 따라가세요',
  delay: 0,         // 시작 후 나타나기까지 (초) — 바로
  fadeIn: 1.0,      // 페이드인 (초)
  fadeOut: 1.2,     // 터치 후 페이드아웃 (초)
  showOnReset: true // '처음으로' 누르면 다시 보여줌
};

// ── 헤엄 물보라 (GRIS, 참고 사진): 물을 가르며 헤엄칠 때 머리·몸 둘레로 작은 방울이 튐 (SPLASH_DROPS 입자·색 재사용) ─────
const SWIM_SPRAY = {
  enabled: true,
  minSpeed: 0.6,              // 이 속도 이상 헤엄칠 때만
  rate: 22,                   // (70 → 22) 조금만. 최고 속도일 때 초당 방울 수 (속도에 비례). 슬라이딩 헤엄이면 slideMul 배
  slideMul: 1.5,
  head: 0.2, sideOffset: 0.16,    // 머리에서 뒤쪽 거리까지 퍼져 생김 · 몸 옆으로 벌어진 거리
  out: [0.25, 0.9], forward: 0, back: [0.6, 1.7], up: [0.9, 1.9],   // 옆으로 흩어짐 · 펭귄 속도 따라감(0 = 물에 남음 → 뒤로 길게) · 뒤로 튀는 속도 · 위로
  size: [0.005, 0.013],
};

// ── 펭귄 몸 틀 (GRIS, 참고 GIF: 황제펭귄 새끼 뒤뚱 걸음) ─────
// 부위별로 나눈 기본 틀: 엉덩이·몸통·배·머리·얼굴·날개(팔) 2·발 2·꼬리. 나중에 각 부위를 그림으로 바꿀 수 있게 크기·회전축을 여기 모음
// 단위: 펭귄 키 = 1, 원점 = 발바닥 가운데, y 는 위가 − (캔버스 방향). x 는 펭귄이 화면 오른쪽을 볼 때 앞쪽이 +
const PENGUIN_RIG = {
  enabled: true,
  colors: { body: '#000000', belly: '#ffffff', face: '#ffffff', eye: '#000000', beak: '#2a2a2e', feet: '#5c5c5c', flipper: '#1d1f24' },   // 날개는 몸보다 아주 살짝 밝게 (몸 위에서도 형태가 읽히게)
  // 몸: 엉덩이(아래 넓게) + 몸통 두 타원을 겹쳐 서양배 모양
  hips: { y: -0.25, rx: 0.31, ry: 0.25, back: 0.03 },      // 엉덩이는 살짝 뒤로 빠짐
  torso: { y: -0.52, rx: 0.25, ry: 0.4 },
  belly: { y: -0.38, rx: 0.21, ry: 0.32, side: 0.12 },       // side: 옆모습일 때 앞쪽으로 치우침
  head: { y: -0.8, r: 0.19, front: 0.05, counter: 0.55, bob: 0.012 },   // counter: 몸이 기울 때 머리는 이만큼 반대로 버팀 (수평 유지) · bob: 걸음마다 끄덕임
  face: { y: -0.8, rx: 0.12, ry: 0.1, front: 0.1, eyeR: 0.014, eyeGap: 0.058 },   // 얼굴 흰 가면 + 눈 (아기 황제펭귄처럼 작은 눈)
  beak: { y: -0.755, len: 0.07, w: 0.035 },
  // 날개(팔): 어깨에서 매달림. 걸을 땐 살짝 벌리고(균형) 걸음 반대쪽이 더 벌어짐, 뛰면 위로 퍼덕
  flipper: { shoulderY: -0.6, shoulderX: 0.23, len: 0.36, w: 0.075, out: 16, swing: 14, airUp: 55, idleBreath: 3, sideSwing: 18 },
  // 발: 짧고 넓적. 한 걸음마다 번갈아 살짝 들고 앞으로
  feet: { x: 0.1, len: 0.12, w: 0.045, lift: 0.045, stride: 0.05, toeOut: 18 },
  // 꼬리: 엉덩이 뒤 아래 작은 쐐기. 걸음 반대 방향으로 살랑
  tail: { y: -0.1, back: 0.27, len: 0.08, w: 0.07, wag: 22 },
  buttSway: 0.018,             // 걸음마다 엉덩이가 옆으로 실룩 (몸통보다 크게)
  // 기본 헤엄 자세 (사진 참고, 슬라이딩 헤엄은 따로): 수평으로 떠서 엉덩이가 물 위로, 목은 뽁 세움, 발은 파닥파닥
  // 높이는 수면 기준 (+ = 물속 쪽)
  swim: {
    fromDeg: 20,                 // 눕는 각도(PHYSICS.water lay)가 이 이상이면 헤엄 자세
    foreshorten: 0.55,           // 카메라 쪽/반대쪽으로 헤엄칠 때 몸 길이 배율
    bodyDepth: 0.0,              // 몸 기준선(등 높이)이 수면보다 이만큼 아래. 등만 물 위, 가슴·배는 물속
    rump: { up: 0.03 },          // 엉덩이가 봉긋 올라오는 높이
    neck: { up: 0.06 },          // 목이 뽁 솟는 추가 높이 (기본 머리 높이 위로)
    popOvershoot: 0.35,          // 목 뽁: 헤엄 시작할 때 지나치게 솟았다 돌아오는 정도
    bob: 0.012, bobHz: 0.9,      // 둥둥 뜬 몸이 살짝 오르내림
    flipper: { len: 0.36, w: 0.05, hz: 1.4 },   // 가슴 옆에서 뒤로 길게 붙인 날개
    feetDownDeg: 30,             // 발이 뒤로 뻗으며 아래로 처지는 각도 (물속에서 파닥)
  },
};

// ── 빙하 원화 (assets/floe_sheet.png → floe_art.js): 0 작음 · 1 납작 · 2 높음 · 3 큼 ─────
// 고정 빙하 번호(ICE_FIELD.fixed 순서)마다 그림과 폭(월드)을 정함. 높이는 그림 비율대로 (heightMul 로 조절)
const FLOE_ART = {
  enabled: true,
  assign: {
    0: { sprite: 3, width: 4.6 },          // 시작 빙하: 큰 빙하
    1: { sprite: 2, width: 3.85, heightMul: 0.72 },   // 2번: 높은 빙하 (점프 배치기로 오를 수 있게 높이 살짝 낮춤)
    2: { sprite: 1, width: 10, far: true },  // 먼 배경: 납작한 빙하
    3: { sprite: 0, width: 3.5, far: true },  // 먼 배경: 작은 조각
  },
  depthRatio: 0.42,            // 발판 깊이(앞뒤) = 폭의 절반 × 이 값
  standInset: 0.03,            // 그림 윗선보다 이만큼 아래에 발이 닿음 (발이 떠 보이지 않게)
  start: -0.45,                // 시작 위치: 시작 빙하 가로 위치 (−1 왼쪽 끝 ~ 1 오른쪽 끝, 그림의 '시작위치')
  reflectSharp: true,          // 비친 모습을 펭귄처럼 또렷하게 (false = 흐린 그림)
  reflectSide: 0,              // 빙하 비친 모습 양옆 끝 흐림 폭 (빙하 폭 비율)
  sinkAlpha: 0, sinkFade: 0.12,  /* 물속 부분이 수면 바로 아래에서 금방 사라지게 (빙하 아래끝 선이 안 보이게) */ sinkColor: [10, 18, 28], sinkTint: [0.35, 0.8],   // 물속 부분: 수면 바로 아래 진하기 · 사라지는 깊이(물 위 높이 비율) · 바다색 물듦
  belowBlur: 0.06, sideFade: 0.12,   // 물속 부분·비친 모습 흐림(줄였다 키우는 배율) · 양옆 끝을 옅게 (폭 비율)
  saturation: 0.6,             // 빙하 채도 (1 = 원화 그대로)
  wet: null,   /* 수면선 위 젖은 띠: 빙하 아래 굴곡선이 한 줄 더 보여서 끔 (예: { height: 0.07, alpha: 0.35 }) */   // 수면선 위 젖은 띠 (높이 비율 · 진하기)
  reflectRipple: { row: 2, freq: 0.35, speed: 1.6, amp: 0.006, band: 0 },   // 펭귄 비침처럼 살짝만 일렁임   // 비친 모습 가로 물결: 띠 높이(px) · 띠 굴곡 · 움직임 · 좌우 흔들림(폭 비율)
  waterBulge: 0.06,            // 수면선 앞쪽 호가 가운데에서 내려오는 정도 (폭 비율, 최소값. 실제는 발판 깊이의 원근과 큰 쪽)
  reflectAlpha: 0.38, reflectLength: 0.85,   // 수면에 비친 모습: 진하기 · 길이(물 위 높이 비율), 아래로 갈수록 사라짐
  lineColor: [214, 228, 242], lineAlpha: 0, lineWidth: 0.03,   // 수면선 흰 띠 (끔)
  waterWave: { amp: 0.25, freq: [2.3, 5.1], speed: [0.9, 1.4], lap: 0.025, lapSpeed: 1.3 },   // lap: 파도가 빙하에 찰랑이며 수면선이 오르내리는 높이 (물 위 높이 비율)   // 수면선 일렁임: 호 깊이 대비 높낮이 · 굴곡 수 · 움직임 (완벽한 호가 아니라 실제 바다처럼)
  far: { blur: 0.18, alpha: 0.55, haze: 0.55 },   // 먼 배경 빙하: 흐림(줄였다 키우는 배율) · 진하기 · 안개색 덮기
  tiltMul: 0.6,                // 출렁일 때 그림 기울기 배율
};

// ── 펭귄 원화 (GRIS, 사용자 그림 IMG_6025 → assets/penguin/penguin_atlas.png, penguin_art.js) ─────
// 포즈 0(서 있음) → 7(수평). 몸·눈·날개·발을 따로 그려, 날개·발은 회전축(어깨·발목)에서 움직이고 눈은 깜빡임
// enabled: false 면 임시 도형(PENGUIN_RIG)으로 돌아감
const PENGUIN_ART = {
  enabled: true,
  scale: 1.2,                   // 키 배율 (원화 서 있는 키 = 펭귄 키 × 이 값)
  rimMul: 0.35,                 // 물에 있을 때 몸 둘레 흰 림 빛 배율 (흰 몸엔 약하게)
  edge: { color: 'rgba(14, 20, 30, 0.38)', blur: 0.03, onIce: false,   /* 끔: 아이패드 사파리에서 그림자가 엉뚱한 곳(하늘)에 펭귄 모양으로 찍혀서 */ inWater: false, parts: ['body', 'foot', 'front', 'whole'] },   // 몸 바깥쪽에만 아주 옅은 어두운 번짐
  pose: {
    idle: 8,                    // 가만히: 똑바로 선 자세 (source_idle.png)
    stand: 2,                   // 걷기 (날개 붙인 포즈, 사진 1)
    jump: { crouch: 3, rise: 1, top: 0, fall: 1, land: 2, topAt: 0.35, landTime: 0.12, lowNoTop: true },   // lowNoTop: 일반(낮은) 점프는 GIF 2단계(웅크림→오름)까지만, 날개 활짝은 슈퍼점프에서만   // 점프 (참고 GIF): 웅크림 → 오름 → 꼭대기(날개 펼침) → 떨어짐 → 착지. topAt = 올라가는 속도가 처음의 이 비율 아래면 꼭대기 포즈
    belly: 7,                   // 배로 미끄러짐 · 배치기 · 터보건
    swim: 6, swimSlide: 7,      // 물: 기본 헤엄 · 슬라이딩 헤엄 (발 뒤로 뻗고 파닥)
    blendRate: 16,              // 큰 자세 변화(서기 ↔ 헤엄)를 사이 포즈로 이어 보이는 빠르기 (포즈/초) — 상륙·입수가 자연스럽게
  },
  // 가만히 있으면 앉음 (정면 그림 source_front.png): 멈춘 뒤 delay 초 → 정면으로 서서 standTime → 앉음. 움직이면 정면으로 일어섰다(standTime) 옆으로 걸음
  sit: { enabled: false,   /* 정면 그림 사용 안 함 (true 로 바꾸면 다시 앉기) */ maxDrift: 0.6, delay: 1.0, standTime: 0.22, breath: 0.012, breathHz: 0.4, scale: 1.0 },
  waterline: { swim: 0.5, cutFit: 1.05, cutFitY: 1.3, slideEye: -0.03 },   // slideEye: 바다 슬라이딩 잠김 맞춤 (눈 아래끝 기준, − 일수록 더 깊이). 화면에서 수면이 눈 바로 아래에 오도록 맞춘 값   // cutFit: 수면 가림·수면 선을 그림 몸 폭에 맞춤 (예전 도형 폭 대신)
  submerged: { alphaMul: 0.45, blur: 0.22, hideDeep: true },   // hideDeep: 깊은 바다에선 물속 몸 안 그림 (얕은 물만)
  reflectDrop: 0.45,            // 물에 비친 모습 시작선을 수면 타원 앞쪽(보이는 몸 아래끝)으로 내림 (반지름 배율)
  reflectDeep: null,   /* 깊은 물 펭귄 비침 흐림: 이상해서 원래대로 (설정 예: { blur: 0.12, alpha: 0.75, fadeAt: 0.85, side: 0.15 }) */   // 깊은 물에서 펭귄이 비친 모습: 흐림 · 수면 바로 아래 진하기 · 사라지는 위치 · 양옆 옅게 (얕은 물은 그대로)
  reflectBlur: 1,               // 물에 비친 모습 흐림 (1 = 원래대로 선명. 흐리게 하면 버그가 있어 되돌림)
  // 캐릭터 빛 (그림 위에만): 그늘 = 아래·등 쪽 어둡게(땅에서 더), key = 위·앞 은은한 빛, face = 얼굴 밝게, firefly = 가까운 반딧불이 색이 비침
  light: { enabled: true, source: 'floe', upWeight: 0.35,   // source: 'floe' = 빙하와 같은 왼쪽 빛 / 'moon' = 달 방향 · upWeight: 빛의 위쪽 성분 비중
    shade: { color: [26, 34, 52], ice: 0.46, land: 0.5, water: 0.26, edge: [0.4, 0.66] },   // 그늘 진하기 · edge = 그늘이 시작·짙어지는 위치 (직전 버전 명암)
    faceStart: 0.6, faceRadius: 0.26,   // 시작 장면(물에 들어가기 전) 흰 얼굴 밝게 (검은 머리는 그대로)
    firefly: { range: 3.2, radius: 0.85, alpha: 0.4, sea: '63,180,255', land: '255,200,90', landMul: 0.45 } },   // landMul: 노란 반딧불이는 은은하게   // 물속 몸: 반사와 겹치지 않게 더 옅게 + 흐리게 (blur = 축소 배율, 작을수록 흐림)     // 물에 떠 있을 때 그림 높이 중 물속 비율
  walk: { waddleDeg: 3, waddleDegSand: 2.2, cyclesPerUnit: 1.25, minHz: 1.2, footLift: 0.022, footStride: 0.03, backMul: 0.4, footSwingDeg: 7, bob: 0.01, flipperSwayDeg: 5 },   // 뒤뚱 각도(빙하·모래) · 이동 1당 걸음 박자(빠를수록 빨리 뒤뚱) · 발 들림·보폭·각도(작게: 몸에서 안 떨어지게) · 들썩 · 날개 흔들
  run: { at: 0.85, flipperUpDeg: 34, flapHz: 4.5, feetSync: true, strideMul: 0.8 },   // 달릴 때 보폭은 짧게 (빠른 박자라 뒤꿈치가 멀리 안 가게)   // feetSync: 달릴 때 발도 날개 박자에 맞춰 빠르게   // 최고 속도의 85% 이상 = 달리기: 날개를 살짝 들고 파닥
  idle: { breathDeg: 1.5, breathHz: 0.35 },
  air: { flutterDeg: 7 },       // 점프 중 날개 떨림 (포즈 자체가 날개를 펼침)
  swim: { paddleDeg: 22, paddleHz: 3, flipperDeg: 5, flipperHz: 1.2 },
  flap: { time: 0.7, deg: 32, hz: 6 },   // 물에서 점프 = 날개 파닥 (최대 각도 작게: 반투명 부분이 안 보이게)
  toboggan: { kickDeg: 22, footDownDeg: 18, footDrop: 1.0, kickBack: 0.08, flipperDeg: 10, slapTime: 0.3, slapHop: 0,  /* 물가 배치기 통통 끔 */ paddleHz: 2.6, paddlePerSpeed: 1.3, paddleDeg: 16 },   // paddle: 차는 사이 발 파닥 (빠르기 = paddleHz + 속도 × paddlePerSpeed)   // flipperDeg: 발 박자에 맞춰 날개 살짝   // footDrop: 발 아래끝을 바닥(0)까지 내림 비율 · kickBack: 찰 때 뒤로 뻗는 거리   // 육지 배 슬라이딩: 발끝을 아래로(땅에 닿게) · 찰 때 뒤로
  climb: { time: 0.42, hop: 0.32, riseIn: 0.22, bellyUntil: 0.75 },   // 물 → 빙하 배치기로 퐁: 걸리는 시간 · 솟는 높이 · 빙하 윗면 높이까지 오르는 데 쓰는 비율(짧을수록 옆면을 빨리 지나감) · 배 자세 유지 비율   // 물 → 빙하 기어오름 (그림만): 걸리는 시간 · 살짝 들썩 · 이 비율까지 배를 대고
  blink: { every: [2.5, 5], time: 0.13 },
};

// ── 헤엄 발 (GRIS, 임시 도형): 헤엄칠 때 몸 뒤로 뻗은 두 발이 번갈아 파닥임 ─────
const SWIM_FEET = {
  enabled: true,
  length: 0.22, width: 0.05,    // 다리+발 길이 · 굵기 (펭귄 키 대비)
  spread: 0.08,                 // 두 발 사이 간격
  flutterDeg: 2.5, flutterHz: 1.6,  // 슬라이딩 헤엄: 뻗은 채 아주 살짝만 흔들림
  paddle: { deg: 18, hz: 3.2 },  // 기본 헤엄: 파닥파닥 (번갈아 차는 각도 · 빠르기)
  idleFlutter: 0.5,
  slide: true,                  // 슬라이딩 헤엄(엎드려 쭉)에도 뒤로 뻗은 발 표시
  liftDeg: 12, rootY: 0.03,     // 몸 축에서 등 쪽으로 드는 각도 · 엉덩이 끝에서 발이 시작하는 위치
};

// ── 물가루 (GRIS): 둘레로 낮게 퍼지는 아주 작은 물방울 (물기둥 없이) ─────
const WATER_MIST = {
  flap: { count: [55, 75], radius: [0.25, 0.55], speed: [1.0, 2.6], up: [0.8, 2.0], size: [0.008, 0.02], ripple: 0.9 },   // 물에서 점프(날개 파닥)
  belly: null,   // 물가 슬라이딩 배치기 물튐 끔 (발로 찰 때 뒤로 튀는 물방울은 그대로)
};

// ── 눈가루 (GRIS): 빙하에 오르내릴 때 발밑에서 흩날림 ─────
const SNOW_PUFF = {
  // (미스트) 굵은 알갱이 대신 아주 작은 점을 많이, 공기 저항 크게 → 퍼지며 천천히 흩어짐
  count: [280, 340], landCount: [420, 500],   // (36~50 · 55~75 → 80~105 · 120~150) 미스트 양 많이   // 오르내릴 때 · 높은 곳에서 착지할 때
  speed: [0.8, 2.4], up: [0.7, 1.8],      // 옆으로 · 위로 (이전 0.6~1.8 · 1.3~2.8): 낮게 퍼짐
  life: [0.9, 1.7], size: [0.0018, 0.005],  // (0.02~0.05 → 0.0018~0.005) 아주 작은 입자 미세하게, 조금 더 오래 떠 있음
  gravity: 0.5, drag: 3.4, alpha: 0.6, max: 1400, color: [196, 210, 230],   // 거의 안 떨어지고 공기에 멈춤
  swirl: 0.6, grow: 1.15, minPx: 0.3,      // 공기에 일렁임 · 사라지며 커지는 배율(번지는 느낌) · 화면 최소 반지름 px   // 흰 빙하 위에서도 보이게 살짝 푸른 회색
};

const PHYSICS = {
  hz: 60,                     // 고정 시간 단계
  gravity: 22.7,              // 일반 점프: 높이 0.5 · 체공 0.42초 → g = 8h/T²
  penguin: {
    mass: 1,
    moveForce: { ice: 3.5, shore: 5.5, water: 9 },  // 링 입력이 주는 힘 (빙하·흙은 작게 → 천천히 가속)
    maxSpeed: { ice: 2.2, shore: 1.2, water: 2.4 },  // 흙(해안)은 물·빙하의 약 50%, 물 = 깊은 물 헤엄
    airForce: 3,
  },
  friction: { ice: 0.56, shore: 4.5, water: 3.2 },  // 걷기·수영 감쇠 (1/초). 빙하는 미끌미끌(이전의 40%), 흙은 뻑뻑
  slideFriction: { ice: 0.15, shore: 6, water: 1.4 }, // 슬라이딩 감쇠: 빙하 위는 길게, 흙에선 금방 멈춤
  shoreJump: { velocityMul: 0.72, forwardMul: 0.6 },  // 흙에서 점프: 낮고 짧게
  shoreSlideMul: 0.55,        // 흙에서 슬라이딩 시작 속도 배율
  jumpVelocity: 4.76,         // 점프 초기 속도 = 4h/T → 높이 0.5, 체공 0.42초 (낮고 빠르게)
  superJump: { heightMul: 2.0, distanceMul: 2.33, airtime: 0.62, oncePerAir: true },   /* oncePerAir: 한 번 뜬 동안 슈퍼점프는 한 번만 (연속 두 번 탭으로 공중에 떠 있는 것 방지) */  // 두 번 탭: 높이 1.0 · 거리 4.2 · 체공 0.62초 (납작한 포물선)
  jumpForwardSpeed: 4.29,     // 링을 민 채 점프할 때 수평 속도 → 최대 거리 = 4.29 × 0.42 ≈ 1.8
  landingSquashPx: 2,         // 착지할 때 몸이 눌렸다 돌아오는 깊이 (px)
  slideInitialSpeed: 4.6,     // 슬라이딩 시작 속도
  slideForce: 6,              // 링을 민 채 슬라이딩할 때 미는 힘
  slideMaxSpeed: 5.2,
  // 육지 터보건 (GRIS, 참고 GIF): 섬에서 슬라이딩하면 배로 엎드려 미끄러지고, 발로 주기적으로 차서 밀고 나감.
  // 빙하·물 슬라이딩은 그대로. island 모드에서만 slideFriction.shore 대신 아래 값 사용
  toboggan: {
    enabled: true,
    friction: { sand: 2.4, forest: 3.0 },  // 감쇠 (1/초). 이전 흙 6 → 금방 멈추지 않고 쭉 미끄러짐
    kick: { period: 0.42, impulse: 0.9, needInput: false },   // 0.42초마다 발로 차서 +0.9 속도 (링을 안 밀어도 누르고 있으면 참)
    maxSpeed: 2.6,                         // 섬 슬라이딩 최고 속도
    waterSplash: 0.16,        // 물속 슬라이딩: 이 간격(초)마다 발 뒤로 물방울
    splash: { count: [6, 10], speed: [0.6, 1.6], up: [0.9, 1.9], spread: 1.1, size: [0.004, 0.009] },   // 젖은 모래·얕은 물에서 발로 찰 때 뒤로 튀는 물방울 (챱챱)
    groove: { every: 0.06, life: 2.2, alpha: 0.42, width: 0.17, color: [6, 7, 9], max: 60, fadeTime: 0.5, taper: 5 },   // (수명 7 → 2.2초, fadeTime 1.6 → 0.5) 짧게 남고 빨리 흐려짐.   // 배가 지나간 홈: 배 근처 진하게 → fadeTime(초)마다 연해짐 · 양끝 taper 점에 걸쳐 뾰족하게   // 모래에 배가 지나간 홈 (간격 초 · 수명 · 진하기 · 폭)
    puff: { count: [7, 11], color: [128, 130, 136] },   // 발로 찰 때마다 튀는 모래 알갱이 (SNOW_PUFF 재사용, 색만 모래 회색)
    feet: { rest: 14, plant: 62, kick: -18, reach: 0.12, tuck: 0.05, length: 0.16 },   // 그림 (도): 평소 · 딛기 직전 발끝이 바닥에 닿는 각 · 뒤로 빵 찬 각 (− = 위) · 찰 때 뻗는 길이 · 딛을 때 당기는 길이 · 다리 길이
  },
  // 물 속 이동 (걷기·허우적·헤엄 구분은 DEPTH 수심으로)
  water: {
    shallowMaxSpeed: 0.9, shallowForce: 5.5,      // 얕은 물 걷기: 미는 힘은 흙과 같게 (속도가 끊기지 않게)
    shallowWalk: { wobbleDeg: 8, wobbleFreq: 6 },
    shallowSink: 0.22,        // 얕은 물에서 잠기는 정도 (몸 높이 비율)
    stepRipple: { radius: 0.32, life: 1.1, alpha: 0.08 },   // 한 걸음마다 발목 둘레 부드러운 파문
    deepMaxSpeed: 2.4,        // 깊은 물 헤엄
    slideMaxSpeed: 3.8,       // 슬라이딩을 누른 채 헤엄 (가장 빠름)
    layDeg: 60, slideLayDeg: 80,   // 헤엄칠 때 진행 방향으로 눕는 각도 / 슬라이딩 헤엄
    layTime: 0.3, standTime: 1.0,  // 눕는 데 / 멈춰서 다시 일어서는 데 걸리는 시간 (초)
    deepJumpMul: 0.25, shallowJumpMul: 0.6,   // 물에서 점프 높이 배율 (깊은 물은 슈퍼점프 불가)
    deepJumpCooldown: 0.8,    // 깊은 물 점프 연타 방지 (초)
    wallReach: 0.56,          // 물에서 머리·꼬리 쪽(화면 가로) 몸 길이: 여기까지 빙하에 닿으면 막힘 (펭귄 키 0.975 기준, 그림에 맞춤)
    wallRadius: 0.95, /* 깊이(앞뒤) 방향 몸 범위: 이동 선 앞뒤로 비켜 지나가도 화면에서 빙하와 겹치지 않게 막음 */         // 물에서 몸 둘레 반지름: 이만큼 떨어진 곳에서 빙하에 막힘 (몸이 빙하에 겹치지 않게)
    bump: { push: 0.9 },      // 빙하에 부리가 부딪히면 뒤로 밀려나는 속도 (눈 깜빡)
    autoClimbMax: 0,  /* 모든 빙하: 부딪히면 막히고 콩 밀려남 → 점프로 배치기 올라감 (이전 0.46: 낮은 가장자리는 저절로) */        // 가장자리가 수면 가까이 낮은 빙하(첫 빙하 0.28~0.44)만 저절로 올라섬. 높은 빙하(두 번째 0.48~0.73)는 머리가 닿아 막히고 점프로       // 이 높이까지의 낮은 빙하 가장자리는 헤엄쳐 닿으면 저절로 올라섬. 더 높으면 벽처럼 막히고, 점프하면 배치기로 올라감
    climbAt: 1.0,             // 물 → 빙하 올라서는 지점 (빙하 크기 배율). 0.88 이었을 땐 빙하 안쪽까지 헤엄쳐 들어가 뚫어 보였음
    // 물에서 점프 = 배치기 상륙만 (GRIS): 앞쪽 가까이에 빙하·섬이 있을 때만 배를 내밀고 '통' 튀어올라 그 위에 배로 착지 → 잠깐 미끄러짐.
    // 근처에 올라설 곳이 없으면 점프 안 됨 (작은 파문만). enabled: false 면 예전 물 점프
    porpoise: { enabled: true, minHold: 0.35, dip: 0.18, dipKick: 1.6, angleDeg: 45, speed: 5.2, gravity: 9 },   // 바다 슬라이딩을 꾹(minHold초 이상) 누르다 떼면: dip초 쑥 잠겼다가 angleDeg 각도·speed 속도로 푸슝 (깊은 물에서만)
    waterJump: 'auto',  /* 'auto': 앞에 올라설 빙하·섬이 있으면 배치기, 없으면 날개 파닥 */        // 물에서 점프: 'flap' = 못 뛰어오르고 날개만 파닥 (빙하엔 헤엄쳐 부딪히면 올라섬) / 'belly' = 아래 배치기 상륙
    bellyLaunch: {
      enabled: true,
      reach: 1.2,             // 앞쪽으로 이 거리 안에 빙하·섬 가장자리가 있어야 함
      fanDeg: 40,             // 링을 민 방향 ± 이 각도 안에서 찾음 (링을 안 밀면 사방에서 가장 가까운 곳)
      inward: 0.55,           // 가장자리에서 이만큼 안쪽에 착지
      clearance: 0.32,        // 착지면보다 이만큼 더 높이 솟음
      minSpeed: 1.6,          // 수평 속도 최소 (가까워도 '통' 하고 힘 있게)
      landSlide: 0.45,        // 착지 후 배로 미끄러지는 자세 유지 시간 (초)
      landSlideSpeed: 1.4,    // 착지 직후 남기는 미끄럼 속도 최소
      splash: 3.2,            // 물에서 튀어나올 때 물방울 세기 (SPLASH_DROPS)
    },
  },
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
  maxActive: 7,               // 동시에 존재하는 빙하 상한
  activeRange: 30,            // 펭귄 주변 이 거리(빙하 가장자리까지) 안에서만 생성
  fadeInTime: 1.2,            // 새로 나타날 때 서서히 진해지는 시간
  // 위치 고정 빙하 (월드 좌표, size = 시작 빙하 대비 지름 비율)
  fixed: [
    // GRIS 가로 구도: 빙하는 3개만. 이동 선(y ≈ 0.3) 위에 시작 빙하 → 첫 빙하(점프 한 번), 그 뒤로는 헤엄쳐 섬까지
    { x: 0, y: 0, size: 1, start: true },        // 시작 빙하 (x −3 ~ 3)
    // 원화 빙하 순서 (보내준 그림): 큼(시작) → 2번 높음, 납작·작은 조각은 멀리 있는 배경 빙하
    { x: -9.5, y: 0.3, size: 0.6 },               // 1 두 번째: 높은 빙하
    { x: -26.5, y: -26, size: 1.8 },             // 2 먼 배경: 납작한 빙하 (안개에 싸여 흐리게, 위치 고정)
    { x: -15, y: -20, size: 0.6 },                // 3 먼 배경: 작은 조각
  ],


  spacing: [7, 12],           // 시드 배치 열 간격: 출발 근처 ~ 섬 근처 (점점 넓어짐)
  perColumn: 1.8,             // 열마다 평균 빙하 수 (출발 근처 기준, 섬 쪽으로 갈수록 줄어듦)
  density: { left: 0, right: 0 },   // GRIS: 무작위 빙하 없음 (이동 선에 걸리지 않게 고정 배치만)     // 오른쪽은 고정 조각 하나 뒤로 열린 바다만
  spreadY: 22,                // 바다 위아래로 흩어지는 폭
  bigShare: 0.3,              // 큰 빙하 비율 (섬 쪽으로 갈수록 줄어듦)
  sizeStart: [0.6, 1.0],      // 큰 빙하 크기 (시작 빙하 대비)
  sizeEnd: [0.15, 0.3],       // 작은 조각 크기
  openSea: 18,                // 상륙 직전 빙하 없는 열린 바다 길이
  shoreClear: 10,             // 판정: 해안선까지 거리 − 빙하 반지름 ≥ 이 값 (못 맞추는 고정 빙하는 바다 쪽으로 옮기거나 줄임)
  keepClear: 3,               // 고정 빙하·물고기 구역 주변 여백
};

// ── 해안 물결 (섬 위로 물이 쏴아 들어왔다 나감) ─────────────────────
// ── 섬 지형 (GRIS): 해안선에서 안쪽으로 [거리, 높이] 단면 → 해안 → 숲 → 오르락내리락 언덕 ─────────
// 높이는 terrainHeightAt(x, y) 하나로 읽음 (펭귄·발자국·그림자·나무·바위·해안 물막). 그림은 임시 도형(단색 면 + 가는 균열선)
const ISLAND_TERRAIN = {
  shoreX: -40,                // 해안선 위치 (월드 x). world.islandDistance 가 이 값을 읽음
  profile: [                  // [해안선에서 안쪽 거리, 높이]. 사이는 부드럽게(캣멀롬) 이음
    [0, 0], [3, 0.06], [6, 0.15],                       // 모래 해변: 아주 완만
    [10, 0.45], [14, 0.9],                              // 숲 입구: 완만한 오르막
    [17.5, 1.12], [21, 0.86], [24.5, 1.1], [28, 0.88], [31, 1.12], [34, 1.2],   // 깊은 숲: 작은 기복 ±0.25 (파장 약 7)
    [40, 2.4], [47, 1.0], [55, 2.8], [62, 1.3], [70, 2.6],   // 언덕: 진폭 0.7~1.4, 파장 14~16 (평균 경사 약 11°)
  ],
  walkableMaxSlope: 25,       // 걸을 수 있는 경사 (도). 오르막 감속의 기준
  slope: { uphillSlow: 0.25, slideSlope: 0.08, slideAccel: 1.6 },   // 오르막 최대 −25%, 이보다 가파른 내리막은 살짝 미끄러짐
  // 구역: 이동 속도 배율 · 나무 밀도(단위 넓이당 그루) · 지면 색
  zones: [
    { name: 'sand', to: 6, speed: 0.62,   // (0.5 → 0.62) 살짝 빠르게
      trees: 0, color: [58, 60, 64] },
    { name: 'forestEdge', to: 14, speed: 1.45, trees: [0.12, 0.2], color: [36, 40, 40] },   // 속도 0.8 → 1.15 (모래만 그대로)
    { name: 'forestDeep', to: 34, speed: 1.65, trees: [0.14, 0.24], color: [24, 28, 29] },   // 0.85 → 1.25
    { name: 'hills', to: 999, speed: 1.6, trees: 0.06, color: [31, 34, 38] },   // 0.9 → 1.3
  ],
  zoneBlend: 1.2,             // 구역 경계에서 속도·색이 이어지는 폭
  // 나무: 해변 바로 뒤 키 큰 야자수 줄 → 덤불 → 빽빽한 정글 (임시 도형). 뭉쳐서 자람(cluster)
  trees: {
    seed: 314, laneGap: 1.4, back: 26,
    cluster: { scale: 0.22, low: 0.35, high: 0.75, gain: 1.4 },   // 군락 노이즈: 이 범위에서 밀도가 확 올라감
    palm: { d: [4.6, 13], peak: 6.8, density: 0.32, height: [3.6, 5.4], lean: 0.9, fronds: 9, frondLen: [1.5, 2.3] },   // 해변 가장자리 야자수 (가까이·크게, 잎이 화면 안에 보이는 높이)
    bush: { d: [5.2, 9], density: 0.9, size: [0.9, 2.0], height: [0.6, 1.3] },        // 숲 입구 덤불
    jungle: { height: [6, 11], width: [2.6, 4.6] },                                     // 정글 나무 (둥근 잎 뭉치)
    front: { density: 0.05, y: [2.6, 5.5], d: [14, 60], alpha: 0.9 },                  // 이동 선 앞쪽 실루엣 (드물게)
    color: [11, 19, 16], frond: [22, 36, 30], trunk: [16, 20, 19], palmTrunk: [34, 40, 40], bushColor: [9, 16, 13],
  },
  ground: { dStep: 1, yStep: 4, yRange: [-40, 40], maxDist: 76, view: 70, crack: 0,  /* (0.35 → 0) 바닥 곳곳의 일직선 균열선 끔 */ crackColor: [10, 12, 14], light: 0.18 },   // 지면 칸 그리기
  mountains: { offset: 78, nearPeaks: false },   // 산은 원경으로만: 해안에서 이만큼 더 안쪽 (해안 바로 뒤 작은 봉우리 없음)
  // 해안 바위 (하와이 현무암처럼 낮고 둥근 검은 바위). d = 해안선에서 안쪽 거리, y = 화면 안쪽 위치
  rocks: {
    list: [{ d: 2.0, y: 0.3, h: 0.55, seed: 11 }, { d: 4.2, y: -1.55, h: 0.7, seed: 23 }],   // 왼쪽(안쪽) 바위는 이동 선 뒤로 비켜 둠 → 올라가지 않고 지나감
    width: 1.4,               // 폭 (지름)
    depthScale: 0.8,          // 안쪽 방향 폭 비율
    // 모양 (사진처럼 모난 바위): 바닥 꼭짓점 7~9개(반지름 들쭉날쭉) · 꼭대기는 한쪽으로 치우침 · 중간 고리 높이 들쭉날쭉 → 납작한 면들
    shape: { verts: [7, 9], radiusVar: 0.25, apexOffset: 0.3, midAt: 0.5, midHeight: [0.55, 0.85] },
    pebbles: { count: [2, 3], size: [0.14, 0.3], height: [0.08, 0.22], spread: [1.0, 1.6] },   // 둘레 작은 돌 (그림만)
    color: [16, 16, 18], light: [52, 54, 58],
    washRing: 0.4,            // 파도가 닿으면 바위 둘레로 갈라지는 흰 물결 진하기
  },
  sea: { slope: 7, fireflyMinDepth: 0.15 },   // 바다 쪽: 수심 경사 거리(DEPTH.slope) · 반딧불이가 머무는 최소 수심
  wash: { width: 5, reach: 0.45 },            // 파도 도달 (SHORE_WASH.shoreWidth · reach)
  debugColors: { sand: [230, 200, 120], forestEdge: [120, 200, 120], forestDeep: [60, 150, 90], hills: [220, 150, 90] },
};

const SHORE_WASH = {
  segment: 0.5,               // 해안선을 나누는 구간 길이 (구간마다 위상·세기가 다름)
  strengthVar: 0.3,           // 구간마다 도달 거리 ±30%
  rise: 1.1, hold: 0.3, fall: 4.5,   // 올라올 때(ease-out) / 정점에서 머묾 / 빠지며 모래로 스밈 (초)
  shoreWidth: ISLAND_TERRAIN.wash.width,   // 해안 폭 (월드). ISLAND_TERRAIN.wash 에서
  reach: ISLAND_TERRAIN.wash.reach,        // 보통 파도가 올라오는 폭 = 해안 폭 × 이 값 × 파면 진폭 (ISLAND_TERRAIN.wash)
  dryTime: 6,                 // 젖은 땅이 마르는 시간 (초)
  // 선 없이 면으로: 젖음 맵(최근일수록 진하게) + 얇은 물막. 자국 선·물줄기·흰 끝선은 없음
  bins: 5,                    // 물가 안쪽 방향 젖음 칸 수
  binReach: 1.5,              // 젖음 맵이 덮는 깊이 = 최대 도달 폭 × 이 값 (가장자리는 넓고 부드러운 경사)
  waterAlpha: 0.3,            // 올라오는 물의 앞쪽 밝은 물막 (해안 쪽으로 갈수록 투명)
  filmAlpha: 0.2,             // 물이 빠진 뒤 남는 얇은 투명 물막
  filmTime: 1.2,              // 물막이 남아 있는 시간 (마르는 순서대로 사라짐)
  wetAlpha: 0.32,             // 젖은 땅이 어두워지는 정도 (가장 최근이 가장 진함)
  resolution: 0.55,           // 젖음·물막·거품 오프스크린 해상도 (화면 대비 × 기기 픽셀비(최대 2) × 품질 단계)
  slowMul: 0.85,              // 물이 올라온 곳에 서 있으면 속도 배율 (물가에서 멈칫하지 않게 약하게)
  rippleEvery: 0.45, rippleAlpha: 0.08,   /* (0.3 → 0.08) 발밑 파문 옅게 */          // 그때 생기는 작은 파문 간격 (초)
  // 끝선 운동 (챠아아 → 머묾 → 사아아). 끝선 x(t): 올라올 때 R·(1−(1−t/Tu)²), 빠질 때 R·(1−(t/Td)^fallExp)
  // 여러 파도가 겹치면 끝선 = 그 순간 가장 큰 값 → 임계 감쇠 스프링(smoothHz)으로 한 번 더 부드럽게 (위치·속도 연속)
  swash: {
    rise: [0.9, 1.3],         // Tu: 올라오는 시간 (파도마다 무작위). 처음이 빠르고 정점에서 느려짐
    hold: 0.15,               // 정점에서 머무는 시간
    fall: [2.2, 3.0],         // Td: 빠지는 시간. 천천히 시작해 가속하다 모래로 스밈
    fallExp: 1.6,
    smoothHz: 1.9,            // 끝선 스프링 고유 진동수 (Hz). ω ≈ 12 rad/s. (12Hz 는 시간상수 13ms 라 60fps 에서 꺾임이 그대로 남았음)
    speedShoreMin: 1.4,       // 파면이 해안 근처에서 느려지지 않게 하는 속도 하한 (월드/초)
    accelTime: 0.3, accelPow: 0.7,   // 도달 직전 이 시간 동안 가속 (위치 ∝ 남은시간^accelPow), 앞이 가팔라짐
    lullMax: 5,               // 묶음 사이 잔잔한 구간 최대 (초)
    sub: 3,                   // 이웃 구간 사이를 코사인 보간으로 쪼개는 수 (계단 없애기)
    wetEdge: 0.35, filmEdge: 0.25,   // 젖은 모래·남은 물막 가장자리 알파 경사 폭 (월드)
    thinExp: 0.6,             // 빠질수록 물막이 얇아지는 정도 (남은 거리 비율^이 값)
  },
  // 물막 앞쪽 거품: 올라올 때 앞선에 생기고, 빠지면서 성긴 띠로 남았다 사라짐
  foam: { alpha: 0.6, width: 0.3, trail: 0.9, trailAlpha: 0.35, life: 1.6, lace: 0.55, laceLength: 0.7, color: PALETTE.foam },
  // GRIS: 둔탁한 흰 띠 대신 — 물막은 물가에서 투명 → 앞선 쪽으로 은은하게, 앞선은 가늘게 끊기는 레이스 거품
  sheet: {
    resolution: 0.55,         // 물막·거품을 그리는 오프스크린 해상도 (화면 대비 × 기기 픽셀비 × 품질 단계. 0.32 에선 앞선이 계단처럼 깨졌음)
    alpha: [0.02, 0.16],      // 물막 진하기: 물가 쪽 → 앞선 쪽 (그 사이를 strips 겹으로 이음)
    strips: 6,
    lip: 0.07, lipAlpha: 0.32,      // 앞선 물테두리: 폭(월드)·진하기. 노이즈로 군데군데 끊김
    lace: { width: [0.04, 0.14], alpha: 0.5, length: [0.35, 0.9], gap: 0.45, sub: 3 },   // 거품 레이스: 조각 폭·진하기·조각 길이·끊긴 비율·구간 쪼개기
    residue: 0.08,            // 물이 빠진 뒤 남는 얇은 막 (원래 filmAlpha 0.2)
  },
  // 파도 열차: 해안선과 나란한 파면이 바다에서 다가옴. 위치는 수심(DEPTH) 기준이라 해안선 굴곡을 따라 휘고,
  // 바다 쪽 직선에서 같은 때 출발하므로 곶(튀어나온 곳)에 먼저, 만에 늦게 닿음
  train: {
    speedDeep: 2.7,           // 깊은 곳 파면 속도 (월드/초). 얕아지면 √수심 에 비례해 느려짐
    minDepth: 0.06,           // 속도 계산에 쓰는 최소 수심 (물가에서 멈추지 않게)
    startDist: 22,            // 해안선에서 이 거리부터 파면이 보이기 시작
    count: [2, 4],            // 한 묶음에 연달아 오는 파면 수
    gap: 2.2,                 // 묶음 안 간격 (초) → 깊은 곳 간격 ≈ speedDeep × gap ≈ 6, 얕은 곳 ≈ 2.5
    setInterval: [3, 5.5],   // (7~11 → 3~5.5) 묶음 사이 잔잔한 구간 (초, swash.lullMax 로 최대 5초)
    amp: [0.75, 1.05],        // 파면 진폭 (무작위). swash 도달 거리에 비례
    bigChance: 0.18,          // 묶음 대신 큰 파도 하나가 올 확률
    bigAmp: 1.5, bigReach: 0.7,   // 큰 파도: 진폭 ×1.5, 도달은 해안 폭의 70% 까지
    shoal: 0.25,              // 얕아질수록 진폭 증가 (Green 법칙: 진폭 ∝ 수심^-0.25)
    shoalMax: 1.8,            // 그 증가 상한
    // 명암 면 (선 없음): 파면의 폭 넓은 밝은 띠 + 바로 뒤(바다 쪽) 어두운 골
    crest: 0.45,              // 밝은 띠 폭 = 그 자리 파장 × 이 값
    trough: 0.55,             // 어두운 골 폭 = 파장 × 이 값
    alpha: [0.08, 0.14],      // 진하기: 깊은 곳 → 얕은 곳 (진폭이 커질수록)
    troughAlpha: 1,           // 골 진하기 = 밝은 띠 진하기 × 이 값
    light: PALETTE.simLight, dark: PALETTE.simDark,
    steepDepth: 0.2,          // 이 수심 부근에서 파면 앞이 가팔라짐
    steepNarrow: 0.5,         // 그때 밝은 띠가 좁아지는 정도
    steepBoost: 1.35,         // 그때 진해지는 배율
    fadeDepth: 0.06,          // 이보다 얕으면 파면은 swash(물막) 로 넘어가며 사라짐
    tongue: 0.3,              // swash 끝선 혀 모양 요철 ±비율 (해안선 방향 노이즈)
    tongueLength: [1.5, 3],   // 요철 파장 (파도마다 무작위)
    resolution: 0.5,          // (0.18 → 0.5) 명암 면 오프스크린 해상도 (화면 대비 × 기기 픽셀비 × 품질 단계)
    nearFade: [4, 10],        // GRIS: 카메라에서 이 거리 안쪽의 파면은 옅게 (낮은 각도라 가까운 파면이 화면을 가로지르는 굵은 띠로 보여서)
  },
};

// ── 수심 지형: 해안선(구불구불)에서 바다 쪽으로 완만하게 깊어짐 ─────────────
const DEPTH = {
  slope: ISLAND_TERRAIN.sea.slope,   // 이 거리(월드)에 걸쳐 수심 0 → 1 (ISLAND_TERRAIN.sea)
  power: 1.4,                 // 수심 = smoothstep(거리/slope) ^ power
  shoreAmp: 1.5,              // 해안선 굴곡 진폭 (만·곶)
  shoreWave: [6, 12],         // 굴곡 파장 범위
  walkMax: 0.2,               // 0 ~ 0.2 걷기
  wadeMax: 0.45,              // 0.2 ~ 0.45 허우적 걷기, 그 이상 헤엄
  hysteresis: 0.04,           // 경계에서 떨리지 않게
  walkSpeed: 1.3, wadeMinSpeed: 1.2,    // 걷기 속도 → 허우적 걷기는 깊어질수록 이 값까지 줄어듦
  speedBlend: 4,              // 땅·얕은 물·헤엄 사이 최고 속도·미는 힘이 이어지는 빠르기 (1/초). 입수·상륙 때 멈칫하지 않게
  wadeWobbleDeg: 13,          // 허우적거리는 흔들림
  sinkPerDepth: 0.85,         // 걷는 동안 잠기는 정도 = 수심 × 이 값 (몸 높이 비율)
  // 4단 그라데이션: 마른 모래 → 젖은 모래 → 얕은 물(모래색이 비침) → 깊은 물
  dryColor: PALETTE.sand, wetColor: PALETTE.wetSand, sandColor: PALETTE.shallowSand,
  wetSandWidth: 1.8,          // 물가 안쪽 젖은 모래 폭
  sandAlpha: 0.65,            // 얕은 물에 비치는 모래색 (물가) → 0 (shallowEnd 수심에서)
  shallowEnd: 0.6,
  strips: 14,                 // 그라데이션을 이루는 띠 수 (선 없이 색·투명도만)
  viewRange: 40,              // 카메라에서 이 거리 안쪽 해안만 그림
};

// ── 모래 발자국 (발바닥 버튼과 같은 모양) ─────────────────────────────
const FOOTPRINTS = {
  size: 0.11,                 // 발자국 크기 (월드)
  stride: 0.5,                // 왼발·오른발 좌우 간격 = 펭귄 키 × 이 값 (몸 폭 정도)
  pressTime: 0.05,            // 찍힐 때 pressFrom → 100% 로 튕기는 시간 (초)
  pressFrom: 1.1,             // 찍히는 순간 크기 (110% 에서 100% 로 살짝 튕김)
  life: 3,                    // 모래: 서서히 사라지는 시간 (초)
  max: 40,                    // 모래 발자국 풀
  alpha: 0.3,                 // 모래 발자국 진하기
  innerAlpha: 0.16,           // 눌린 안쪽이 더 어두운 정도
  toeOutDeg: 20,              // 팔자: 왼발은 왼쪽, 오른발은 오른쪽으로 벌어짐
  fadeIn: 0.1,                // 찍힐 때 흐림 → 선명 교차 페이드 (초)
  color: [46, 43, 40],
  ice: { alpha: 0.14, life: 1.4, max: 30, color: [140, 146, 152] },   // 빙하: 옅은 회색 긁힘 자국 (빙하 좌표계에 저장)
  slideTrail: { alpha: 0.2, life: 1.8, width: 0.03, spacing: 0.08, max: 90 },  // 빙하 위 슬라이딩 활주 자국 한 줄
  // GRIS 섬 발자국: 모래는 깊게(진하고 오래, 가장자리에 밀려 올라온 밝은 테), 숲·언덕은 옅게
  sand: { alpha: 0.42, life: 5, size: 1.15, color: [6, 7, 9], rim: [120, 122, 128], rimAlpha: 0.09, rimOffset: 0.025 },   // (0.75 → 0.42) 더 연하게
  forest: { alpha: 0.28, life: 4, size: 1, color: [4, 6, 6] },   // (0.5 → 0.28)
};

// ── 명암·그림자 블러 (ctx.filter 없이 스프라이트·겹 그리기·축소 캐시로) ─────────
// ── 그리기 품질 (GRIS): 오프스크린 해상도 = 기본값 × 기기 픽셀비(최대 dprMax) × 품질 단계 ─────
// 프레임이 떨어지면(downFps 아래로 downAfter 초) 한 단계 낮추고, 넉넉하면(upFps 위로 upAfter 초) 올림
// ── 별 (GRIS): 하늘에 아주 작은 별이 반짝임 ─────
// ── 초승달 (GRIS): 하늘에 작게. 펭귄 명암은 달 쪽이 밝고 반대쪽이 어두움 (기본: 화면 왼쪽 위 → 왼쪽 밝고 오른쪽 어둠) ─────
const MOON = {
  enabled: false,              // 달 끔
  u: 0.43, elev: 0.25,         // 하늘 위치: 별과 같은 가로 좌표(0~1, 카메라가 돌면 같이 흐름) · 수평선 위 높이 (화면 높이 비율)
  radius: 4, phase: 0.42,      // 반지름(px) · 초승달 굵기 (가리는 원이 옆으로 비킨 정도, 0.5 = 얇음 ~ 1 = 반달 이상)
  tilt: -35,                   // 초승달이 기운 각도 (도)
  color: [236, 240, 250], alpha: 0.92,
  glow: { radius: 4, alpha: 0.07 },   // 둘레 은은한 번짐 (반지름 배수)
};

const STARS = {
  count: 160, seed: 5,
  size: [0.3, 1.0],            // 반지름 (px)
  alpha: [0.12, 0.7], twinkle: [0.3, 1.8], depth: 0.6,   // 진하기 · 반짝이는 빠르기(Hz) · 반짝임 깊이
  minElev: 0.04, maxElev: 0.9, // 수평선 위 높이 범위 (화면 높이 비율로 근사)
  color: [214, 226, 255], spread: 3.2,   // 좌우로 펼친 폭 (화면 폭 배수, 카메라가 돌면 같이 흐름)
};

const QUALITY = {
  tiers: [1, 0.75, 0.55],     // 품질 단계 3개 (해상도 배율)
  dprMax: 2,
  downFps: 45, downAfter: 2,
  upFps: 57, upAfter: 6,
  dither: 1,                  // 화면 전체에 ±1 레벨 디더 노이즈 (어두운 그라데이션 띠 숨김, 0 = 끔)
  smoothHigh: true,           // 저해상도 그림을 키울 때 고품질 보간 (품질 1단계에서만. 소프트웨어 렌더링에선 프레임당 약 16ms 들어서)
  toneSize: [96, 48],         // 수면 밝기 노이즈 해상도 (24×12 → 96×48)
};

const SHADOW_BLUR = {
  ratio: 0.25,                // 경계 번짐 폭 = 그림자 크기 × 이 값 (20~30%)
  layers: 14,  /* (5 → 14) 낮은 카메라에선 겹이 가로 띠(계단)로 보여서 촘촘하게 */                 // 다각형 그림자를 크기를 바꿔 겹쳐 그리는 횟수 (클수록 부드럽게)
  facetTexture: 96,           // 빙하 윗면 음영 캐시 크기 (px)
  facetDownscale: 6,          // 음영을 이만큼 줄였다 키워 경계를 흐림 (생성 때 한 번)
  wetResolution: 0.4,         // 젖은 땅·물막 오프스크린 해상도 (낮을수록 경계가 부드럽게 번짐)
};

// ── 물 엔진 (water.js): 펭귄 주변 수면을 격자로 계산 ─────────────
// 펭귄·빙하가 물을 밀어낸 만큼 수면이 꺼지고 둘레가 솟아, 파문·항적·되튕김이 저절로 생김
// 끄고 비교: URL ?cfg=WATER_SIM.enabled=false  (끄면 예전 링 파문·항적으로 돌아감)
const WATER_SIM = {
  enabled: true,
  grid: 128,                // 격자 칸 수 (한 변). 줄이면 가볍고 뭉툭, 늘리면 섬세하고 무거움
  size: 14,                 // 격자가 덮는 넓이 (월드 단위, 한 변)
  lead: 0.22,               // 격자 중심을 펭귄보다 시선 앞쪽으로 당기는 비율 (size 의)
  waveSpeed: 2.4,           // 물결이 퍼지는 속도 (월드/초). 영상은 4~6, 고요한 분위기라 낮춤
  damping: 0.35,            // 물결이 잦아드는 빠르기 (1/초). 클수록 금방 잔잔
  dispersion: 0.8,          // 0~1. 클수록 잔 물결이 뒤처져 링 간격이 바깥으로 벌어짐
  viscosity: 0.006,         // 잔 떨림 제거 (초). 클수록 매끈
  restore: 0.1,             // 수면이 평균 높이로 돌아오는 빠르기 (1/초)
  shallowRef: 0.5,          // 이 수심(DEPTH 0~1)보다 얕으면 물결이 느려짐
  shoreAbsorb: 0.4,         // 얕은 물에서 물결이 스러지는 세기
  edgeCells: 10,            // 격자 가장자리 흡수대 폭 (칸)
  edgeDamping: 6,           // 흡수대 감쇠
  body: {
    gain: 0.05,             // 밀어낸 부피 → 수면 높이 배율 (물결 전체 세기. 헤엄 물결이 V자로 커 보여서 0.16 → 0.05)
    ring: [0.9, 2.6],       // (1.7 → 2.6) 밀린 물이 넓게 퍼져 V 가 날카롭지 않게
    ringNote: 0,       // 펭귄이 밀어낸 물이 솟는 고리 (몸 반지름의 배수: 안쪽, 바깥)
    speedRef: 1.2,          // 펭귄 이동 속도가 이만큼일 때 gain 최대. 멈춰 있으면 0 (가만히 떠 있을 땐 고리 없음)
    floeSpeedRef: 0.8,      // 빙하도 같은 방식 (속도가 이만큼일 때 gain 최대)
    landingImpulse: 0.025,  // 빙하에 착지할 때 빙하 둘레 수면 충격 (높이)
    penguinRadius: 0.3,     // 펭귄 몸 반지름 (× penguin.scale)
    floeDraft: 0.25,        // 빙하가 물에 잠긴 깊이 (월드)
    floeHeavePx: 80,        // 빙하 출렁임 px → 월드 환산 (px / 이 값)
    floeRing: 0.12,         // 빙하가 밀어낸 물이 솟는 띠 폭 (월드)
    solidInset: 0.85,       // 빙하 반지름의 이 비율 안쪽은 물결을 되튕김
    maxStep: 0.05,          // 한 단계에 한 칸이 움직일 수 있는 최대 높이 (튀는 값 방지)
    entryImpulse: 0.008,    // 입수 속도 1 당 추가로 꺼지는 깊이 (찰싹)
  },
  // 해안: 파도가 밀려와 얕아지며 느려지고, 모래 위로 얇게 올라왔다 빠짐. 지나간 자리는 젖고 거품이 남음
  // (물 엔진이 켜져 있으면 SHORE_WASH 의 그림 대신 이쪽이 쓰임. 파도 묶음 간격만 SHORE_WASH 와 같은 뜻)
  shore: {
    draw: false,            // true = 해안 물막·거품을 물 엔진으로 (false = SHORE_WASH 파도 열차로 그림. 지금은 false)
    minSpeed: 0.2,          // 물가·모래 위 물의 최소 빠르기 계수 (0~1, 클수록 빨리 밀려오고 빨리 빠짐)
    beachSlope: 0.012,      // 모래 경사 (안쪽 1 당 높이). 작을수록 물이 멀리 올라옴
    bumpy: 0.5,             // 모래 높낮이 불규칙 (0~1). 클수록 물 끝선이 혀처럼 들쭉날쭉
    bumpLength: 2.2,        // 그 불규칙의 길이 (월드)
    maxInland: 6,           // 물가에서 이 거리 안쪽까지만 계산
    drain: 0.6,             // 모래 위 물막이 빠지는 빠르기 (1/초)
    friction: 1.5,          // 모래 위에서 물이 느려지는 정도
    dryTime: 6,             // 젖은 모래가 마르는 시간 (초)
    filmMin: 0.002,         // 이 두께 이상이면 젖은 것으로 봄
    foamLife: 0.9,          // 거품이 사라지는 시간 (초)
    foamGain: 6,            // 거품이 생기는 빠르기
    breakSpeed: 0.03,       // 얕은 물에서 수면이 이보다 빨리 움직이면 부서져 거품
    frontFoam: 0.5,         // 올라오는 물막 앞쪽 거품 세기
    frontDepth: 0.01,       // 물막이 이 정도로 얇은 앞쪽에 거품이 몰림
    foamSpread: 0.35,       // 거품이 옆으로 번지는 정도 (0~1, 클수록 부드럽고 넓게)
    wave: {
      offshore: 3.5,        // 물가에서 이만큼 떨어진 바다에서 파도가 시작
      width: 0.6,           // 파도 마루 폭
      amp: 0,               // 파도 높이 (0 = 물 엔진에 해안 파도를 넣지 않음. SHORE_WASH.train 이 담당) (올라오는 거리 ≈ 높이 ÷ beachSlope 의 1/3~1/2)
      ampVar: 0.6,          // 해안을 따라 세기 ±비율 → 물 끝선이 들쭉날쭉
      varLength: 3.5,       // 그 들쭉날쭉의 길이 (월드)
      count: [1, 2],        // 한 묶음의 파도 수
      gap: 3.4,             // 묶음 안 간격 (초)
      setInterval: [5, 8],  // 묶음 간격 (초)
    },
    render: {
      wetColor: [146, 140, 130], wetAlpha: 0.34,    // 젖은 모래
      filmColor: [240, 238, 232], filmAlpha: 0.42, filmRef: 0.015,   // 모래 위 물막 (filmRef 두께에서 63%)
      foamColor: [255, 255, 255], foamAlpha: 0.9,   // 거품
      lace: [0.4, 0.95],    // 거품 무늬 문턱 (낮을수록 꽉 찬 띠, 높을수록 성긴 레이스)
      laceScale: 1.6,       // 거품 무늬 크기 (클수록 잘게)
    },
  },
  // 파도가 칠 때 빙하 옆면·펭귄 아랫몸이 물에 가려졌다 드러남 (수면 높이를 윤곽에서 읽어 수면선을 위아래로)
  cover: {
    gain: 1,                // 수면 높이 → 수면선 이동 배율
    maxPx: 4,               // 가장 크게 움직이는 폭 (펭귄 거리 기준 px, 멀수록 원근만큼 작아짐)
    sideFrac: 0.2,          // 빙하 옆면 높이의 이 비율을 넘지 않음
    samples: 10,            // 빙하 윤곽에서 수면 높이를 읽는 점 수
    alpha: 0.5,             // 가려진 띠의 물색 그라데이션 (수면선 0 → 아래 이 값)
  },
  drop: { radius: 0.3, amp: 0.035 },   // 기존 파문 호출(점프·둥둥 등) → 물방울 충격으로 바꿀 때 (반지름 배율, 높이)
  feedback: {
    penguin: 1.0,           // 헤엄치는 펭귄이 주변 물결을 타고 오르내리는 정도 (0 = 끔)
    floePx: 60,             // 빙하가 주변 물결을 타는 정도 (물결 높이 1 당 px)
  },
  render: {
    resolution: 0.5,        // (0.22 → 0.5) 화면 대비 해상도 × 기기 픽셀비 × 품질 단계
    slope: [0.003, 0.12],   // (0.045 → 0.12) 작은 물결은 옅게 (헤엄 V 자국이 진하게 포화되지 않게)  // [이 기울기부터 보임, 이 기울기에서 진하기 63%] — 그 위로는 완만하게 포화
    light: PALETTE.simLight, lightAlpha: 0.35,   // (0.5 → 0.35)   // 빛 받는 면
    floeLightMul: 0.5, floeLightRadius: 1.2,    // 빙하 반지름 × floeLightRadius 안에서는 밝은 면을 이 배율로
    dark: PALETTE.simDark, darkAlpha: PALETTE.simDarkAlpha,     // 그늘진 면
    // 물마루를 따라가는 반투명 흰 선: 수면이 볼록하게 솟고(곡률) 평평한(기울기 0) 마루에만. 물결이 있을 때만 조금
    line: { color: PALETTE.crest, alpha: 0,  /* (0.4 → 0) 카메라가 낮아 물마루 선이 화면을 가로지르는 가는 직선으로 보여서 끔 */ curv: [0.35, 1.6], flat: 0.07 },   // curv = [보이기 시작, 가장 진함] 곡률, flat = 마루로 보는 기울기 한계
  },
};

FIREFLY.guide.shoreMinDepth = ISLAND_TERRAIN.sea.fireflyMinDepth;   // 반딧불이 최소 수심도 섬 지형 블록에서

window.CONFIG = {
  ISLAND_TERRAIN,
  LAND_FIREFLY,
  SNOW_PUFF, MOON, WATER_MIST, FLOE_ART, INTRO_HINT, SWIM_SPRAY, SWIM_FEET, PENGUIN_RIG, PENGUIN_ART,
  SPLASH_DROPS,
  STARS,
  palette: PALETTE,
  WATER_PRESETS: { calm: WATER_CALM, normal: WATER_NORMAL },
  water: WATER_CALM,          // ← WATER_NORMAL 로 바꿔 끼우면 보통 물결 (URL ?water=normal 도 가능)
  PHYSICS,
  ICE_FIELD,
  FOG,
  FIREFLY,
  SHORE_WASH,
  DEPTH,
  FOOTPRINTS,
  SHADOW_BLUR,
  quality: QUALITY,
  WATER_SIM,

  ui: {
    // 왼쪽 아래 이동 링. inset = 화면 가장자리 ~ 링 바깥선 간격(엄지 하나 정도)
    ring: {
      hidden: true,            // GRIS: 링 없음. 발바닥 버튼 말고 화면 어디든 눌러 끌면 좌우 이동 (누른 자리가 기준, 멀리 끌면 기준이 따라옴)
      insetX: 70, insetY: 46,
      radius: 34,
      lineWidth: 3,
      hitRadius: 100,          // 실제 터치 판정 반지름 (표시보다 넉넉하게)
      maxPush: 46,             // 엄지를 이만큼 밀면 최대 힘 (px)
      deadZone: 6,
      releasePush: 170,        // 터치 시작점에서 이만큼 벗어나면 입력 0 (역할은 뗄 때까지 유지)
    },
    // 오른쪽 물갈퀴 발바닥 버튼 (반지름·터치 영역 약 1.4배, 알파 약 70%)
    action: { insetX: 70, insetY: 46, radius: 30, hitRadius: 120, alphaScale: 0.28,   // 보이는 크기만 작게 (45 → 30), 터치 영역 120 은 그대로
      outline: 1.5, fillAlpha: 0.04,              // 채운 면 대신 가는 외곽선(px) + 아주 옅은 채움
      idle: { after: 3, fade: 1, alpha: 0.14, touch: 0.5, hold: 1 },   // 3초 안 만지면 1초에 걸쳐 0.14 로, 누르면 0.5, 뗀 뒤 1초 지나면 다시 연해짐
    },
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
    // GRIS 가로 구도: 낮고 납작하게 옆에서 봄 (index_gris.html 전용)
    pitchDeg: 3, pitchMinDeg: 1, pitchMaxDeg: 14,   // (원본 23 / -4 / 55, GRIS 처음 6 / 2) 거의 수평으로 봄   // 기본 23°. 위로 끌면 -4° 까지 올려다봄(수평선이 내려가 산·하늘이 더 보임), 아래로 끌면 55° 까지 내려다봄
    minCamHeight: 0.35,       // 낮은 각도에서도 카메라가 수면 아래로 내려가지 않게
    focal: 1.6,               // (원본 0.88) 초점 거리 (화면 높이 배수). 작을수록 넓게 보이고 원근이 강해짐
    horizonY: 0.35,           // 기본 pitch 일 때 수평선 위치 (위에서부터 비율)
    penguinScreenY: 0.62,     // (원본 0.78, GRIS 처음 0.74) 앞쪽 바다(반딧불이 길)가 보이게 올림. 펭귄 발 위치 (위에서부터 비율, 기본 각도)
    penguinScreenYTop: 0.66,  // (원본 0.56) 최대 각도에서 펭귄 발 위치 (올릴수록 화면 중앙 쪽으로)
    viewHeight: 1.7,          // 시야 배율: 펭귄 키 = 화면의 (penguinScreenH ÷ 이 값) ≈ 15%. 작게 하면 줌 인
    penguinScreenH: 0.26,     // 기준 펭귄 키 / 화면 높이 (viewHeight 로 나눠 씀)
    penguinMinScreenH: 0.14,  // 펭귄이 이보다 작아지지 않게 (화면 높이 비율)
    near: 0.35,               // 이보다 가까운 것은 잘라냄
    followRate: 2.6, lead: 0.35,
    rotateSensX: -0.005,      // 가로 드래그 회전 감도 (부호 반대 = 방향 반전)
    rotateSensY: 0.0026,      // 세로 드래그 기울기 감도 (아래로 끌면 내려다봄, 부호 반대 = 방향 반전)
    rotateSmooth: 10,
    yawLockDeg: 25,           // 드래그로 돌릴 수 있는 좌우 한계 (±도). 가로 구도가 깨지지 않게
    lockRotation: true,       // true = 카메라 드래그 회전·기울기 끔 (각도 고정)
    // 낮은 각도 보정 (GRIS 전용): 바닥에 붙는 그림(발자국·파문 고리·헤엄 명암)이 납작해져 안 보이는 만큼 세로로 키움
    // 배율 = clamp(sin(refPitchDeg) / sin(지금 pitch), 1, groundLiftMax). pitch 를 올리면 저절로 1 에 가까워짐
    view: { refPitchDeg: 23, groundLiftMax: 3 },
    startLookAt: [0, -40],    // (원본 [-40, 4]) yaw 0 → 섬(−x)이 화면 왼쪽. 시작 시 바라보는 점 (왼쪽 앞 첫 빙하와 먼 섬이 화면에 들어오게)
    autoTurn: false,          // (원본 true) 손을 떼고 잠시 뒤 다음 목표(반딧불이) 방향으로 천천히 돌아옴
    autoTurnDelay: 2,         // 초
    autoTurnRate: 0.45,       // 돌아오는 빠르기 (작을수록 천천히)
    autoTurnMaxDeg: 100,      // 이보다 크게 돌려 다른 쪽을 보고 있으면 끌어오지 않음
    pitchReturn: false,       // 손을 떼면 기본 각도로 천천히 돌아오기 (기본 끔)
    pitchReturnDelay: 2, pitchReturnRate: 0.5,
  },

  // 바다 이동 한계 (펭귄·빙하가 이 밖으로 나가지 않게 부드럽게 밀어 줌)
  bounds: { x: [-128, 75], y: [-36, 36], push: 6 },   // (−75 → −128) 섬 안쪽 언덕까지 걸어갈 수 있게
  // 좌우로만 이동 (GRIS 전용): 링·키의 위아래 입력은 무시하고, 펭귄을 lane 선 근처로 부드럽게 되밀어 둠
  lane: { y: 0.3, halfWidth: 0.6, push: 8 },   // y = 이동 선 (월드 y), halfWidth = 이만큼은 자유, push = 되미는 세기

  penguin: {
    scale: 1.3,               // ★ 펭귄 크기 배율 (그림·잡기 영역·반영 함께)
    height: 0.75,
    swimSink: 0.5,            // 수영 시 몸이 잠기는 비율 (그림)
    underwaterAlpha: 0.28,    // (사용 안 함: 잠긴 몸은 reflect.submerged)
    swimRingAlpha: 0,         // 수영 중 몸 둘레 물결 고리 진하기 (0 = 끔. 둥근 띠로 보여서 끔, 예전 값 0.5)
    waterlineAlpha: 0.12,     // 몸을 감싸는 수면선: 선 대신 넓게 번지는 밝은 띠 (0.15 이하)
    waterlineWidth: 0.04,     // 그 띠의 폭 (펭귄 키 비율, 아주 얇은 번짐)
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
    waterlineAlpha: 0,        // 수면과 만나는 흰 물결 링 (0 = 끔, 경계는 접촉 그림자 면으로만)
    contactShadowAlpha: PALETTE.floe.glowAlpha, // 바로 아래 수면의 옅은 반사광 (어두운 바다라 그림자 대신)
    facetAlpha: 0.09,         // (사용 안 함, relief 로 대체)
    // 윤곽: 극좌표 노이즈 r = R × (1 + Σ a·cos(kθ+φ)). 일부만 직선 변(둥근 모서리)
    shape: {
      vertices: [12, 18],     // 꼭짓점 수 (큰 빙하는 최대)
      harmonics: [2, 5],      // k 범위
      amp: [0.08, 0.18],      // 진폭 (k 가 클수록 1/(k−1) 로 줄어듦)
      straightShare: 0.1,     // 직선 변이 있는 빙하 비율
      straightAt: 0.74,       // 직선 변 위치 (반지름 비율)
      round: [0.15, 0.25],    // 모서리 둥근 정도 (반지름 비율)
    },
    // 윗면 굴곡: 빙하마다 시드로 둔덕·경사·쐐기 모양. 면 정보는 생성 때 한 번만 계산
    relief: {
      heightFrac: [0.18, 0.38], // 높이 = 지름(최대 6까지만 반영) × 이 범위
      slab: 0.2,                // 가장자리 높이 비율 (윗면 높낮이가 잘 드러나게 낮춤)
      startScale: 0.45,         // 시작 빙하는 완만하게
      wedgeShare: 0.35,         // 한쪽이 높고 비스듬히 내려오는 쐐기 모양 비율
      reliefExaggerate: 1.6,    // 표시용 높이 배율 (화면에서 높낮이가 읽히게, 펭귄도 같은 높이를 밟음)
      big: { ridges: [2, 3], valleys: [1, 2], steps: [1, 2], stepHeight: [0.04, 0.08] },   // 큰 빙하: 능선·골·계단형 단차
      mid: { ridges: [1, 2], valleys: [1, 1], ridgeAmp: [0.2, 0.35], valleyAmp: [0.15, 0.25], width: [0.22, 0.32], minSize: 0.4 },   // 중형: 완만한 능선·골
      shoulder: [0.15, 0.3],    // 가장자리로 흘러내리는 어깨 경사 폭 (반지름 비율, 둘레 따라 불규칙)
      sideVar: 0.4,             // 옆면 높이가 둘레 따라 ±이 비율로 달라짐
      rings: 4, bigRings: 7,    // 윗면 메시 고리 수 (높이·명암 계산용)
      // 명암: 밝은 면 · 중간 · 어두운 면, 둔덕 뒤로 길게 드리운 부드러운 그림자
      shadeLight: PALETTE.floe.top, shadeMid: PALETTE.floe.mid, shadeDark: PALETTE.floe.shade,
      cliffDark: PALETTE.floe.cliff,
      shadowLength: 3.5,        // 그림자가 드리우는 길이 (높이 대비)
      shadeResolution: 0.25,    // 윗면 명암을 그리는 저해상도 캔버스 (면 경계 블러)
      // 펭귄: 오르막 감속, 내리막은 살짝 미끄러짐, 몸이 경사에 맞춰 기욺
      uphillSlow: 0.25, uphillRef: 0.35,
      slideSlope: 0.08, slideAccel: 1.6,
      slopeLeanDeg: 14,
      ridgeAlpha: 0,            // (선 대신 명암으로 표현)
    },
  },

  // 물에 비침: 실제 수면선(물 엔진 높이 반영, 물 가림과 같은 선) 기준
  reflect: {
    alpha: 0.4, fadeLength: 0.9, slices: 14,   // 거울상: 수면선에서 몸 높이 × fadeLength 까지 옅어짐
    refract: { gain: 60, maxPx: 3 },           // 슬라이스마다 수면 기울기(∇h) × gain 만큼 가로로 흔들림 (최대 ±3px)
    submerged: { alpha: 0.5, depth: 0.6, squash: 0.85, tint: [118, 136, 156], tintAmount: 0.55, slices: 12 },   // 잠긴 몸: 푸른 회색, 몸 높이 × depth 까지 0.5 → 0, 세로 0.85 압축
    wetAlpha: 0.12, wetBlurPx: 5,              // 젖은 모래·물막 위 아주 옅은 반사 (젖음 강도 비례). 마른 땅은 없음
  },

  fish: null,                 // 시작 물고기 연출 (비활성, 코드 삭제됨)
  // 시작 연출: 펭귄 왼쪽 앞 수면에 파문 링 하나 → 그 자리에서 반딧불이 군집이 서서히 밝아지며 첫 빙하 쪽으로 흘러감
  intro: {
    delay: 1.5,               // 시작 후 파문까지 (초)
    left: 2.6, ahead: -3.0,   // (원본 4.5 / 3.5) GRIS: 펭귄 앞쪽(화면 쪽) 바다, 시작 빙하 앞 가장자리 바로 밖. 몸에 가리지 않게 살짝 왼쪽
    holdFirefly: true,        // 군집이 다 밝아질 때까지 그 자리에서 기다렸다가 왼쪽으로 출발 (펭귄이 다가오면 바로 물러남)
    holdUntilWater: true,     // 그리고 펭귄이 물에 처음 들어올 때까지 물속에서 둥글게 맴돌며 기다림
    rippleRadius: 2.4,
    fadeIn: 2,                // 군집이 밝아지는 시간 (초)
    startSpot: { maxR: 0.55, slopeW: 0.5, centerW: 0.05 },   // 시작 자리: 빙하 안쪽(반경 비율 ≤ maxR)에서 낮고(높이) 평평한(slopeW × 기울기) 곳
    startSide: 'left',        // 시작 때 펭귄이 바라보는 방향: 'left' / 'right' = 화면 옆모습, null = 예전처럼 화면 안쪽(뒷모습)
    watchFirefly: false,      // true 면 앉아서 반딧불이 쪽으로 몸을 돌림 (옆모습이 3/4로 바뀜)
  },

  world: {
    islandDistance: -ISLAND_TERRAIN.shoreX, islandHalfWidth: 60, islandHalfLength: 40,   // (폭 16 → 60) 언덕까지 섬이 이어지게
    shoreHeight: 0.03, summitHeight: 34,   // 물가는 수면과 거의 같은 높이 (완만한 해변)
    mountainScale: { height: 1.3, radius: 1.35, beach: 3.2 },   // 산 크기 배율 (그림만): 상륙 때 정상·양옆 능선이 화면 밖까지 이어지게
  },

  fullscreenOnFirstTouch: true,
};
