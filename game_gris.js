// 펭귄 탐험 — 첫 구간 프로토타입
// 그림은 전부 draw* 함수 안의 단색 실루엣. 판정(터치 영역·이동·발판)은 그림과 분리되어 있어
// 나중에 그림을 바꿔도 layout / hit / surface / 물리 로직은 그대로 유지됨.
(() => {
  'use strict';

  // ── 설정 (URL ?water=normal&cfg=a.b=1,c.d=2 덮어쓰기) ─────
  const C = window.CONFIG;
  try {
    const qs = new URLSearchParams(location.search);
    const wp = qs.get('water'); if (wp && C.WATER_PRESETS[wp]) C.water = C.WATER_PRESETS[wp];
    if (qs.get('debug') === 'terrain') C.debugTerrain = true;   // ?debug=terrain : 지형 디버그 오버레이
    const lf = qs.get('lf'); if (lf && C.LAND_FIREFLY && C.LAND_FIREFLY.presets[lf]) C.LAND_FIREFLY.preset = lf;   // ?lf=blue : 땅 반딧불이 색 비교
    const q = qs.get('cfg');
    if (q) q.split(',').forEach((kv) => {
      const [path, val] = kv.split('=');
      const keys = path.split('.');
      let o = C;
      for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]];
      const k = keys[keys.length - 1];
      o[k] = typeof o[k] === 'boolean' ? val === 'true' : parseFloat(val);
    });
  } catch (e) { /* 잘못된 cfg 는 무시 */ }
  const P = C.PHYSICS, IF = C.ICE_FIELD;
  const SIM = C.WATER_SIM;
  let sim = null;                                            // 물 엔진 (water.js)
  const WC = () => C.water;   // 프리셋 교체를 즉시 반영

  // 색은 모두 CONFIG.palette 에서
  const PAL = C.palette, rgbS = (a) => a.join(',');
  const COL = {
    bg: `rgb(${rgbS(PAL.sea)})`,
    mountNear: PAL.mount.near, mountFar: PAL.mount.far,
    black: PAL.penguin.black, white: PAL.penguin.white, beak: PAL.penguin.beak,
    ink: PAL.ui.ink, water: rgbS(PAL.waterLine),
  };
  const WLA = PAL.waterLineAlpha;                            // 물결선 alpha 배율

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const safeProbe = document.getElementById('safe');
  let W = 0, H = 0, DPR = 1;
  const layout = { ring: { x: 0, y: 0 }, action: { x: 0, y: 0 } };

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    const cs = getComputedStyle(safeProbe);
    const sl = parseFloat(cs.paddingLeft) || 0, sr = parseFloat(cs.paddingRight) || 0, sb = parseFloat(cs.paddingBottom) || 0;
    const r = C.ui.ring, a = C.ui.action;
    layout.ring.x = sl + r.insetX + r.radius; layout.ring.y = H - sb - r.insetY - r.radius;
    layout.action.x = W - sr - a.insetX - a.radius; layout.action.y = H - sb - a.insetY - a.radius;
  }
  window.addEventListener('resize', resize);

  // ── 유틸 ────────────────────────────────────────────────
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = (rate, dt) => 1 - Math.exp(-rate * dt);
  const deg = (d) => d * Math.PI / 180;
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const angDiff = (a, b) => ((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
  // 빙하 윤곽: 꼭짓점 12~18개, 극좌표 노이즈 r = 1 + Σ a·cos(kθ+φ). 10% 만 직선 변 (부드러운 최소로 모서리를 둥글게)
  function floeOutline(rx, ry, c) {
    const SH = C.floe.shape, r = rng(c.seed + 3);
    const n = c.big ? SH.vertices[1] : Math.round(lerp(SH.vertices[0], SH.vertices[1], r()));
    const hs = [];
    for (let k = SH.harmonics[0]; k <= SH.harmonics[1]; k++) hs.push([k, lerp(SH.amp[0], SH.amp[1], r()) / (k - 1) * (c.start ? 0.6 : 1), r() * 6.283]);
    const straight = !c.start && r() < SH.straightShare;
    const ca = r() * 6.283, cn = [Math.cos(ca), Math.sin(ca)], kr = lerp(SH.round[0], SH.round[1], r());
    const smin = (a, b, k) => { const h = clamp(0.5 + 0.5 * (b - a) / k, 0, 1); return lerp(b, a, h) - k * h * (1 - h); };
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2;
      let rad = 1; for (const [k, am, ph] of hs) rad += am * Math.cos(k * a + ph);
      let x = Math.cos(a) * rad, y = Math.sin(a) * rad;
      if (straight) { const t = x * cn[0] + y * cn[1], t2 = smin(t, SH.straightAt, kr); x += cn[0] * (t2 - t); y += cn[1] * (t2 - t); }
      pts.push([x * rx, y * ry]);
    }
    return pts;
  }
  function blob(rx, ry, n, jitter, seed) {
    const r = rng(seed), pts = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, k = 1 + (r() - 0.5) * 2 * jitter;
      pts.push([Math.cos(a) * rx * k, Math.sin(a) * ry * k]);
    }
    return pts;
  }
  function inPoly(pts, x, y) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  const penH = () => C.penguin.height * C.penguin.scale;   // 펭귄 키 (월드)
  const STEP = 1 / P.hz;
  const omegaB = () => Math.sqrt(P.buoyancyStiffness);
  // 스프링-댐퍼 한 단계 (반암시적 오일러). s = {h, v}
  function spring(s, target, dt) {
    const w = omegaB(), z = WC().settle.dampingRatio;
    s.v += (-w * w * (s.h - target) - 2 * z * w * s.v) * dt;
    s.h += s.v * dt;
  }
  // 정지 상태에서 속도 v0 를 주었을 때 최대 변위 ≈ k·v0 → 원하는 px 만큼 가라앉히는 초기 속도
  function impulseFor(px) {
    const w = omegaB(), z = WC().settle.dampingRatio, wd = w * Math.sqrt(1 - z * z);
    const tp = Math.atan2(wd, z * w) / wd;
    return px / (Math.exp(-z * w * tp) * Math.sin(wd * tp) / wd);
  }
  function springW(s, target, dt, w, z) { s.v += (-w * w * (s.h - target) - 2 * z * w * s.v) * dt; s.h += s.v * dt; }
  function impulseW(depth, w, z) {
    const wd = w * Math.sqrt(1 - z * z), tp = Math.atan2(wd, z * w) / wd;
    return depth / (Math.exp(-z * w * tp) * Math.sin(wd * tp) / wd);
  }
  const jumpAir = () => 2 * P.jumpVelocity / P.gravity;
  const jumpMaxDist = () => P.jumpForwardSpeed * jumpAir();

  // ── 부드러운 파문 스프라이트 ─────────────────────────────
  function makeSprite(stops) {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d'), gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    stops.forEach(([o, col]) => gr.addColorStop(o, col));
    g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
    return c;
  }
  let ringSprite = null, ringSoft = -1;
  function getRingSprite() {
    const s = clamp(WC().ripple.softness, 0.1, 0.9);
    if (ringSoft !== s) {
      ringSoft = s;
      ringSprite = makeSprite([
        [0, 'rgba(255,255,255,0)'], [1 - s, 'rgba(255,255,255,0)'],
        [1 - s * 0.62, 'rgba(255,255,255,0.85)'],
        [1 - s * 0.3, `rgba(${COL.water},0.85)`],
        [1, `rgba(${COL.water},0)`],
      ]);
    }
    return ringSprite;
  }

  // 지면(수면) 위에 이미지를 원근에 맞게 눕혀 그림: 중심, 한 축 방향(ax, ay), 두 축 반지름(la, lb)
  // 낮은 각도 보정 배율 (pitch 에서 파생): 바닥 그림이 납작해진 만큼 세로로 키움
  function groundLift() { const V = C.camera.view; return V ? clamp(Math.sin(deg(V.refPitchDeg)) / Math.max(0.02, Math.sin(cam.pitch)), 1, V.groundLiftMax) : 1; }
  function drawGroundImage(img, x, y, ax, ay, la, lb, alpha, z = 0, oy = 0, noLift = false) {
    if (alpha <= 0.003) return false;
    const c = camSpace(x, y, z);
    if (c[1] < rig.near + 0.3) return false;
    const pc = toScreen(c), pa = project(x + ax * la, y + ay * la, z), pb = project(x - ay * lb, y + ax * lb, z);
    const gl = noLift ? 1 : groundLift(), ux = pa[0] - pc[0], uy = (pa[1] - pc[1]) * gl, vx = pb[0] - pc[0], vy = (pb[1] - pc[1]) * gl;   // 낮은 각도: 세로만 키움
    if (Math.abs(ux) + Math.abs(vx) > W * 2) return false;
    const S2 = img.width / 2;
    ctx.save();
    ctx.setTransform(DPR * ux / S2, DPR * uy / S2, DPR * vx / S2, DPR * vy / S2, DPR * (pc[0] - ux - vx), DPR * (pc[1] + oy - uy - vy));
    ctx.globalAlpha = Math.min(1, alpha); ctx.drawImage(img, 0, 0);
    ctx.restore();
    return true;
  }
  const shadeBright = makeSprite([[0, 'rgba(255,255,255,1)'], [0.45, 'rgba(255,255,255,0.55)'], [1, 'rgba(255,255,255,0)']]);
  const shadeDark = makeSprite([[0, 'rgba(0,0,0,1)'], [0.45, 'rgba(0,0,0,0.5)'], [1, 'rgba(0,0,0,0)']]);
  // 명암 고리: 안쪽 밝은 띠 + 바깥 어두운 띠 (선이 아닌 부드러운 면)
  const shadeRing = makeSprite([[0, 'rgba(255,255,255,0)'], [0.5, 'rgba(255,255,255,0)'], [0.68, 'rgba(255,255,255,0.7)'], [0.82, 'rgba(0,0,0,0.55)'], [1, 'rgba(0,0,0,0)']]);
  // 부드러운 그림자 원판: 경계 번짐 폭 = 반지름 × SHADOW_BLUR.ratio
  let softDisc = null, softDiscR = -1;
  function getSoftDisc() {
    const r = C.SHADOW_BLUR.ratio;
    if (r !== softDiscR) { softDiscR = r; softDisc = makeSprite([[0, 'rgba(0,0,0,1)'], [Math.max(0, 1 - r * 2), 'rgba(0,0,0,0.85)'], [1 - r * 0.5, 'rgba(0,0,0,0.3)'], [1, 'rgba(0,0,0,0)']]); }
    return softDisc;
  }
  // 다각형을 크기를 바꿔 여러 겹으로 옅게 쌓아 경계를 번지게 (ctx.filter 없이)
  function softPolys(makePts, baseScale, alpha) {
    const B = C.SHADOW_BLUR, n = Math.max(1, B.layers);
    for (let i = 0; i < n; i++) {
      const s = baseScale * (1 + B.ratio * ((i + 0.5) / n - 0.5));
      ctx.globalAlpha = alpha / n * (n === 1 ? 1 : 1.6);
      fillPoly(makePts(s));
    }
  }

  // ── 상태 ────────────────────────────────────────────────
  const S = {};
  const cam = { x: 0, y: 0, yaw: 0, yawT: 0, pitch: 0, pitchT: 0 };

  function makeIsland(side, seed) {
    const w = C.world, r = rng(seed);
    const shoreX = side * w.islandDistance, cx = side * (w.islandDistance + w.islandHalfWidth);
    // 바다 쪽 해안선: 타원 + 노이즈 두 개(파장 6~12)로 구불구불한 만과 곶
    const DP = C.DEPTH, l1 = DP.shoreWave[1], l2 = DP.shoreWave[0], o1 = r() * 50, o2 = r() * 50;
    const shoreNoise = (y) => DP.shoreAmp * (0.6 * noise1(y / l1 + o1) + 0.4 * noise1(y / l2 + o2));
    const ry = w.islandHalfLength, rx = w.islandHalfWidth;
    const shoreAt = (y) => { const ys = clamp((y) / ry, -1, 1); return cx - side * rx * Math.sqrt(Math.max(0, 1 - ys * ys)) - side * shoreNoise(y) * Math.sqrt(Math.max(0, 1 - ys * ys)); };
    const sea = []; for (let y = -ry * 0.995; y <= ry * 0.995; y += 0.6) sea.push([shoreAt(y), y]);
    const land = blob(rx, ry, 48, 0.04, seed).map(([x, y]) => [x + cx, y]).filter(([x]) => (x - cx) * -side < 0).sort((a, b) => b[1] - a[1]);
    const shape = sea.concat(land);
    const peaks = [];
    const peak = (dist, y, h, rWant) => {
      let rad = Math.min(rWant, dist - 2.5);
      const MS = w.mountainScale; h *= MS.height; rad = Math.min(rad * MS.radius, dist - MS.beach);   // 커져도 해변(물이 올라오는 곳)은 덮지 않게
      if (C.ISLAND_TERRAIN) dist += C.ISLAND_TERRAIN.mountains.offset;   // 산은 원경으로만
      peaks.push({ x: shoreX + side * dist, y, h, r: rad,
        ax: (r() - 0.5) * rad * 0.5, ay: (r() - 0.5) * rad * 0.5, sh: 0.35 + r() * 0.25, so: (r() - 0.5) * 0.5 });
    };
    peak(15, 0, w.summitHeight, 11);
    for (let k = 1; k <= 9; k++) for (const sg of [-1, 1]) {
      const y = sg * k * 4.2 + (r() - 0.5) * 1.5;
      const h = w.summitHeight * (0.8 * Math.exp(-Math.pow(k / 5.5, 2)) + 0.2) * (0.8 + r() * 0.3);
      peak(11 + r() * 4 + k * 0.4, y, h, 4 + h * 0.22);
      peak(21 + r() * 5, y + sg * 2, h * (0.75 + r() * 0.3), 6 + h * 0.2);
    }
    if (!C.ISLAND_TERRAIN || C.ISLAND_TERRAIN.mountains.nearPeaks) for (let y = -w.islandHalfLength + 6; y <= w.islandHalfLength - 6; y += 4 + r() * 2) peak(6 + r() * 1.5, y, 3 + r() * 4, 3);
    return { side, shoreX, cx, cy: 0, rx: w.islandHalfWidth, ry: w.islandHalfLength, shape, peaks, shoreAt };
  }

  // ── 빙하 배치 (시드 고정 후보 목록) ─────────────────────────
  const baseRX = () => C.floe.radiusX * C.floe.scale, baseRY = () => C.floe.radiusY * C.floe.scale;
  function genField() {
    const r = rng(IF.seed), D = C.world.islandDistance;
    const list = IF.fixed.map((f, i) => ({ x: f.x, y: f.y, size: f.size, start: !!f.start, big: !!f.big, fixed: true, seed: 7 + i * 101 }));
    const radOf = (c) => baseRX() * c.size;
    const ip = introPoint(0, 0);
    const clear = (x, y, rr) => !list.some((c) => Math.hypot(c.x - x, c.y - y) < radOf(c) + rr + IF.keepClear)
      && Math.hypot(ip[0] - x, ip[1] - y) > rr + IF.keepClear + 1;
    const offShore = (x, y, rr) => shoreDist(x, y) - rr >= IF.shoreClear;   // 해안선까지 거리 − 반지름
    // 고정 빙하: 해안에 너무 가까우면 바다 쪽(출발 쪽)으로 옮기고, 그러다 다른 고정 빙하와 겹치면 크기를 줄임
    { const is = S.islands[0];
      for (const c of list) {
        if (c.start || !is) continue;
        for (let it = 0; it < 80 && !offShore(c.x, c.y, radOf(c)); it++) {
          const nx = c.x - is.side * 0.25;
          const hit = list.some((o) => o !== c && Math.hypot(o.x - nx, o.y - c.y) < radOf(o) + radOf(c) + 1);
          if (hit) c.size *= 0.95; else c.x = nx;
        }
      } }
    for (const side of [-1, 1]) {
      const dens = side < 0 ? IF.density.left : IF.density.right;
      const end = D - IF.openSea;
      let x = 9 + r() * 3;
      while (x < end) {
        const p = x / D;                                      // 0 = 출발, 1 = 섬
        let n = IF.perColumn * dens * (1 - 0.6 * p);
        n = Math.floor(n) + (r() < n % 1 ? 1 : 0);
        for (let k = 0; k < n; k++) {
          const big = r() < IF.bigShare * (1 - p);
          const size = big ? lerp(IF.sizeStart[0], IF.sizeStart[1], r()) * (1 - 0.4 * p)
            : lerp(IF.sizeEnd[0], IF.sizeEnd[1], r()) * (1.4 - 0.4 * p);
          const rr = baseRX() * size;
          const cx = x + (r() - 0.5) * 4, cy = (r() - 0.5) * 2 * IF.spreadY;
          if (cx + rr > end) continue;
          if (clear(side * cx, cy, rr) && offShore(side * cx, cy, rr)) list.push({ x: side * cx, y: cy, size, seed: (r() * 1e9) | 0 });
        }
        x += lerp(IF.spacing[0], IF.spacing[1], p) * (0.8 + 0.4 * r()) / Math.sqrt(dens);
      }
    }
    list.forEach((c, i) => { c.id = i; c.vx = 0; c.vy = 0; c.floe = null; });
    return list;
  }
  // 시작 연출 자리: 펭귄 왼쪽 앞 수면 (시작 시선 기준)
  function introPoint(px, py) {
    const I = C.intro, [Fx, Fy] = startForward(), Rx = -Fy, Ry = Fx;
    return [px - Rx * I.left + Fx * I.ahead, py - Ry * I.left + Fy * I.ahead];
  }
  // 시작 시선 방향(지면, 단위 벡터)
  function startForward() { const [lx, ly] = C.camera.startLookAt, l = Math.hypot(lx, ly) || 1; return [lx / l, ly / l]; }
  const yawFromForward = (fx, fy) => Math.atan2(-fx, -fy);

  // 빙하 풀 (최대 IF.maxActive 개 재사용)
  function newFloeObj() { return { active: false, heave: { h: 0, v: 0 }, tilt: { x: 0, y: 0, vx: 0, vy: 0 }, hist: new Float32Array(64) }; }
  function activateFloe(c) {
    let f = S.floePool.find((o) => !o.active);
    if (!f) return null;
    const rx = baseRX() * c.size, ry = baseRY() * c.size, r = rng(c.seed);
    Object.assign(f, {
      active: true, cand: c, x: c.x, y: c.y, vx: c.vx, vy: c.vy,
      contour: null, shape: c.shape || (c.shape = floeOutline(rx, ry, c)),
      rx, ry, born: S.time === 0 ? -10 : S.time, grab: null, lastEmit: null, peakSpeed: 0, prevSpeed: 0, aLong: 0, dir: [1, 0],
      ph: [r() * WC().bob.phaseSpread, r() * WC().bob.phaseSpread, r() * 6.28, r() * 6.28],
    });
    f.R = Math.max(...f.shape.map(([x, y]) => Math.hypot(x, y)));
    makeRelief(f, c);
    f.cr = (rx + ry) / 2 * 0.92;                              // 충돌 원 반지름
    f.mass = Math.PI * rx * ry * P.floeDensity;
    f.heave.h = 0; f.heave.v = 0; f.tilt.x = f.tilt.y = f.tilt.vx = f.tilt.vy = 0; f.hist.fill(0);
    c.floe = f;
    return f;
  }
  // 윗면 굴곡: 꼭짓점(산마루) 하나 + 가장자리 높이로 삼각형 부채를 만들고, 이웃 삼각형을 묶어 3~6개 면으로
  // 윗면 높이장: 가장자리 판(slab) + 둔덕/쐐기/능선/골/계단형 단차. 메시·명암·그림자는 생성 때 한 번만 계산
  const FIXED_LIGHT = (() => { const [lx, ly] = C.camera.startLookAt, l = Math.hypot(lx, ly) || 1, Fx = lx / l, Fy = ly / l, Rx = -Fy, Ry = Fx; const x = -0.6 * Rx + 0.3 * Fx, y = -0.6 * Ry + 0.3 * Fy, z = 0.75, q = Math.hypot(x, y, z); return [x / q, y / q, z / q]; })();
  function makeRelief(f, c) {
    if (c.relief) { f.relief = c.relief; return; }
    const R = C.floe.relief, r = rng(c.seed + 11), big = !!c.big;
    const H = Math.min(2 * Math.max(f.rx, f.ry), 6) * lerp(R.heightFrac[0], R.heightFrac[1], r()) * (c.start ? R.startScale : 1);
    const pick = (k) => [(r() - 0.5) * 2 * f.rx * k, (r() - 0.5) * 2 * f.ry * k], feats = [];
    const wedge = !big && !c.start && r() < R.wedgeShare;
    if (wedge) { const a = r() * 6.283; feats.push({ t: 'plane', d: [Math.cos(a), Math.sin(a)], amp: H * (1 - R.slab) }); }
    else if (!big) { const a = r() * 6.283; feats.push({ t: 'mound', c: c.start ? [Math.cos(a) * f.rx * 0.35, Math.sin(a) * f.ry * 0.35] : pick(0.4), r: f.R * 0.55, amp: H * (1 - R.slab) }); }
    if (!big && !c.start && c.size >= R.mid.minSize) {      // 중형: 위아래로 완만하게 출렁이는 능선 1~2개 + 골 1개
      const M = R.mid, cnt = (rg) => rg[0] + ((r() * (rg[1] - rg[0] + 1)) | 0);
      for (let i = cnt(M.ridges); i > 0; i--) feats.push({ t: 'ridge', a: pick(0.55), b: pick(0.55), w: f.R * lerp(M.width[0], M.width[1], r()), amp: H * lerp(M.ridgeAmp[0], M.ridgeAmp[1], r()) });
      for (let i = cnt(M.valleys); i > 0; i--) feats.push({ t: 'ridge', a: pick(0.5), b: pick(0.5), w: f.R * lerp(M.width[0], M.width[1], r()) * 0.8, amp: -H * lerp(M.valleyAmp[0], M.valleyAmp[1], r()) });
    }
    else {
      const B = R.big, cnt = (rg) => rg[0] + ((r() * (rg[1] - rg[0] + 1)) | 0);
      for (let i = cnt(B.ridges); i > 0; i--) feats.push({ t: 'ridge', a: pick(0.55), b: pick(0.55), w: f.R * (0.12 + 0.08 * r()), amp: H * (0.45 + 0.4 * r()) });
      for (let i = cnt(B.valleys); i > 0; i--) feats.push({ t: 'ridge', a: pick(0.5), b: pick(0.5), w: f.R * (0.1 + 0.06 * r()), amp: -H * (0.25 + 0.15 * r()) });
      feats.push({ t: 'mound', c: pick(0.3), r: f.R * 0.35, amp: H * 0.5 });
      for (let i = cnt(B.steps); i > 0; i--) { const a = r() * 6.283; feats.push({ t: 'step', d: [Math.cos(a), Math.sin(a)], off: (r() - 0.5) * f.R * 0.6, w: 0.08, amp: lerp(B.stepHeight[0], B.stepHeight[1], r()) }); }
    }
    const base = H * R.slab;
    // 가장자리: 둘레 따라 옆면 높이 ±sideVar, 안쪽으로 불규칙한 폭의 어깨 경사 → 윗면이 뚝 잘리지 않음
    const shp0 = f.shape, nV = shp0.length, angs = [], rads = [];
    for (const [x, y] of shp0) { angs.push(Math.atan2(y / f.ry, x / f.rx)); rads.push(Math.hypot(x / f.rx, y / f.ry)); }
    const contourR = (th) => {                                // 정규화 좌표에서 그 각도의 윤곽 반지름
      for (let i = 0; i < nV; i++) {
        const j = (i + 1) % nV; let a0 = angs[i], a1 = angs[j]; if (a1 < a0) a1 += Math.PI * 2;
        let t = th; while (t < a0) t += Math.PI * 2;
        if (t <= a1) return lerp(rads[i], rads[j], (t - a0) / Math.max(1e-6, a1 - a0));
      }
      return 1;
    };
    const sv = [r() * 6.283, r() * 6.283, r() * 6.283, r() * 6.283];
    const sideK = (th) => 1 + R.sideVar * (0.6 * Math.sin(2 * th + sv[0]) + 0.4 * Math.sin(3 * th + sv[1]));
    const shW = (th) => lerp(R.shoulder[0], R.shoulder[1], 0.5 + 0.3 * Math.sin(2 * th + sv[2]) + 0.2 * Math.sin(5 * th + sv[3]));
    const fnIn = (x, y) => {
      let h = 0;
      for (const q of feats) {
        if (q.t === 'mound') { const dx = x - q.c[0], dy = y - q.c[1]; h += q.amp * Math.exp(-(dx * dx + dy * dy) / (q.r * q.r)); }
        else if (q.t === 'plane') h += q.amp * clamp(0.5 + 0.5 * (x * q.d[0] + y * q.d[1]) / f.R, 0, 1);
        else if (q.t === 'ridge') {
          const ex = q.b[0] - q.a[0], ey = q.b[1] - q.a[1], L2 = ex * ex + ey * ey || 1, u = clamp(((x - q.a[0]) * ex + (y - q.a[1]) * ey) / L2, 0, 1);
          const dx = x - q.a[0] - ex * u, dy = y - q.a[1] - ey * u; h += q.amp * Math.exp(-(dx * dx + dy * dy) / (q.w * q.w));
        } else if (q.t === 'step') h += q.amp * smooth(-q.w, q.w, x * q.d[0] + y * q.d[1] - q.off);
      }
      return base + clamp(h, 0.02 - base, H - base);        // 겹친 지형도 전체 높이 H 를 넘지 않게
    };
    const fn = (x, y) => {
      const nx = x / f.rx, ny = y / f.ry, th = Math.atan2(ny, nx), rho = Math.hypot(nx, ny) / contourR(th);
      const edge = base * sideK(th);
      return edge + (fnIn(x, y) - edge) * smooth(0, shW(th), 1 - rho);
    };
    // 메시: 윤곽을 줄여 가며 만든 고리들 (가장 안쪽은 중심점)
    const K = big ? R.bigRings : R.rings, shp = f.shape, n = shp.length, ex = R.reliefExaggerate;
    const rings = [];
    for (let k = 0; k <= K; k++) { const s = 1 - k / K; rings.push(shp.map(([x, y]) => [x * s, y * s, fn(x * s, y * s) * ex])); }
    // 칸마다 명암: 빛(왼쪽 위 고정)을 향하면 밝게, 반대면 어둡게 + 둔덕 뒤로 길게 드리운 그림자
    const L = FIXED_LIGHT, lh = Math.hypot(L[0], L[1]) || 1, lx = L[0] / lh, ly = L[1] / lh, rise = L[2] / lh / R.shadowLength;
    const cols = [];
    for (let k = 0; k < K; k++) for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, p = [rings[k][i], rings[k][j], rings[k + 1][j], rings[k + 1][i]];
      const cx = (p[0][0] + p[1][0] + p[2][0] + p[3][0]) / 4, cy = (p[0][1] + p[1][1] + p[2][1] + p[3][1]) / 4, e = 0.08;
      const gx = (fn(cx + e, cy) - fn(cx - e, cy)) / (2 * e) * ex, gy = (fn(cx, cy + e) - fn(cx, cy - e)) / (2 * e) * ex;
      const nl = Math.hypot(gx, gy, 1), b0 = (-gx * L[0] - gy * L[1] + L[2]) / nl;
      let b = smooth(0.3, 0.8, b0);                          // 평평한 면은 거의 흰색
      const h0 = fn(cx, cy) * ex;
      for (let st = 1; st <= 10; st++) { const t = st * f.R * 0.09; if (fn(cx + lx * t, cy + ly * t) * ex > h0 + t * rise + 0.02) { b *= 0.5; break; } }
      cols.push(b < 0.5 ? R.shadeDark.map((v, q) => Math.round(v + (R.shadeMid[q] - v) * b * 2)) : R.shadeMid.map((v, q) => Math.round(v + (R.shadeLight[q] - v) * (b - 0.5) * 2)));
    }
    c.relief = f.relief = { H, base, fn, K, rings, cols, wedge, big };
  }
  // 빙하 윗면 높이(표시 배율 포함)와 기울기 (지역 좌표)
  function reliefAt(f, lx, ly) {
    const rf = f.relief, ex = C.floe.relief.reliefExaggerate, e = 0.06;
    return { h: rf.fn(lx, ly) * ex, gx: (rf.fn(lx + e, ly) - rf.fn(lx - e, ly)) / (2 * e) * ex, gy: (rf.fn(lx, ly + e) - rf.fn(lx, ly - e)) / (2 * e) * ex };
  }
  function deactivateFloe(f) {
    const c = f.cand; c.x = f.x; c.y = f.y; c.vx = 0; c.vy = 0; c.floe = null; f.active = false; f.cand = null;
  }
  const activeFloes = () => S.floePool.filter((f) => f.active);
  function manageField() {
    const p = S.p, keep = p.floe;
    const near = S.cands.map((c) => ({ c, d: Math.hypot(c.x - S.p.x, c.y - S.p.y) - baseRX() * c.size }))
      .filter((o) => o.d < IF.activeRange).sort((a, b) => a.d - b.d).slice(0, IF.maxActive).map((o) => o.c);
    if (keep && !near.includes(keep.cand)) { near.pop(); near.unshift(keep.cand); }
    for (const f of activeFloes()) if (!near.includes(f.cand)) deactivateFloe(f);
    for (const c of near) if (!c.floe) activateFloe(c);
  }

  function reset() {
    S.time = 0; S.finished = false; S.stepN = 0; S.wentWater = false;
    sim = SIM.enabled && window.WaterSim ? window.WaterSim.create(SIM) : null;
    S.islands = [makeIsland(-1, 57)];                        // 왼쪽 섬만. 오른쪽은 안개에 녹는 열린 바다 (빙하 배치가 해안 거리를 보므로 먼저)
    S.cands = genField();
    buildTerrainProps();
    S.floePool = Array.from({ length: IF.maxActive }, newFloeObj);
    const [sfx, sfy] = startForward();
    cam.x = 0; cam.y = 0; cam.z = 0; cam.yaw = cam.yawT = yawFromForward(sfx, sfy);
    cam.pitch = cam.pitchT = deg(C.camera.pitchDeg);
    S.lastCamTouch = -99;
    S.p = {
      x: 0, y: 0, z: C.floe.topHeight, vx: 0, vy: 0, vz: 0, cvx: 0, cvy: 0,
      face: C.intro.startSide === 'left' ? Math.atan2(-sfx, sfy) : C.intro.startSide === 'right' ? Math.atan2(sfx, -sfy) : Math.atan2(sfy, sfx), mode: 'floe', floe: null, lx: 0, ly: 0, air: false,   // face: 시작 옆모습 (intro.startSide)
      sliding: false, sit: true, sink: 0, wobble: 0, phase: 0, idleRing: 0, ripple: 0,
      heave: { h: 0, v: 0 }, dive: { h: 0, v: 0 }, driftAng: Math.random() * 6.28, lean: { h: 0, v: 0 }, peakSpeed: 0, prevSpeed: 0, aLong: 0, lastEmit: null,
    };
    manageField();
    S.p.floe = S.cands[0].floe;
    S.ripples = []; S.swimShade = []; S.softRipples = []; S.vortex = []; S.prints = []; S.printI = 0; S.icePrints = []; S.icePrintI = 0; S.slideTrail = []; S.grooves = []; S.washRipples = []; S.wash = null; S.camGroundZ = 0;
    S.wake = Array.from({ length: WC().wake.maxParticles }, () => ({ on: false }));
    S.streams = []; S.glints = []; S.swell = null;
    S.lastTapUp = 0; S.tapPulse = 0; S.jumpAt = 0; S.jumpReq = false;
    S.intro = { t: 0, started: false, x: 0, y: 0 };
    const r0 = C.FIREFLY.route[0];
    const FF = C.FIREFLY, fr = rng(4242), G = FF.guide;
    S.ff = { i: 0, x: r0[0], y: r0[1], cx: r0[0], cy: r0[1], s: 0, sTarget: 0, speed: 0, mode: 'mill', path: null, lastDist: 0, vApp: 0,
      hist: new Float32Array(128), histI: 0, trailAcc: 0, px: r0[0], py: r0[1],
      members: Array.from({ length: FF.members }, () => {
        const u = Math.pow(fr(), 1.6), size = lerp(FF.size[0], FF.size[1], u), CL = FF.cloud;
        const nl = CL.lobes[0] + ((fr() * (CL.lobes[1] - CL.lobes[0] + 1)) | 0), np = CL.pins[0] + ((fr() * (CL.pins[1] - CL.pins[0] + 1)) | 0);
        const lobes = Array.from({ length: nl }, (_, k) => ({ ox: k ? (fr() - 0.5) * 0.5 : 0, oy: k ? (fr() - 0.5) * 0.35 : 0, s: k ? 0.55 + fr() * 0.35 : 1, st: lerp(1, CL.stretch, fr()) }));
        const pins = Array.from({ length: np }, () => ({ ox: (fr() - 0.5) * 0.6, oy: (fr() - 0.5) * 0.4, s: 0.6 + fr() * 0.7 }));
        return { x: r0[0], y: r0[1], px: r0[0], py: r0[1], vx: 0, vy: 0, streak: 0, ang: 0, lobes, pins, size, alpha: lerp(FF.alpha[0], FF.alpha[1], u), ph: fr() * 6.283, w: (0.15 + fr() * 0.35) * (fr() < 0.5 ? -1 : 1),
          rad: G.millRadius * Math.sqrt(fr()), delay: lerp(G.memberDelay[0], G.memberDelay[1], fr()), bp: lerp(FF.breath.period[0], FF.breath.period[1], fr()),
          depth: lerp(FF.depth[0], FF.depth[1], fr()), wob: 0.1 + fr() * 0.2 };
      }) };
    S.spark = Array.from({ length: FF.sparkle.max }, () => ({ on: false })); S.sparkI = 0;
    S.events = [];
  }
  const log = (type) => { S.events.push({ type, t: S.time }); if (S.events.length > 60) S.events.shift(); };

  // ── 투영: 펭귄 등 뒤 낮은 원근 카메라 ─────────────────────
  // 화면 기준 방향: R = 화면 오른쪽, F = 화면 위(카메라 앞). yaw 규칙은 이전과 같아 입력 매핑을 재사용
  const rig = { f: 1, cy0: 0, cx: 0, cy: 0, cz: 0, F: [0, -1], R: [1, 0], cp: 1, sp: 0, near: 0.35, horizon: 0 };
  function updateRig() {
    const K = C.camera, c = Math.cos(cam.yaw), s = Math.sin(cam.yaw);
    rig.R = [c, -s]; rig.F = [-s, -c];
    const phi = cam.pitch, cp = Math.cos(phi), sp = Math.sin(phi);
    rig.cp = cp; rig.sp = sp; rig.near = K.near;
    rig.f = K.focal * H;
    rig.cy0 = K.horizonY * H + rig.f * Math.tan(deg(K.pitchDeg));       // 주점은 기본 pitch 기준으로 고정
    // 펭귄 발이 penguinScreenY, 키가 penguinScreenH 가 되도록 카메라 거리·높이 계산
    const sH = Math.max(K.penguinScreenH / (K.viewHeight || 1), K.penguinMinScreenH || 0);   // 시야를 넓혀도 펭귄은 최소 크기 유지
    const D = rig.f * penH() * cp / (sH * H);
    // 위에서 내려다볼수록 펭귄이 화면 중앙 쪽으로
    const lift = smooth(deg(K.pitchDeg), deg(K.pitchMaxDeg), phi);
    const V = (rig.cy0 - lerp(K.penguinScreenY, K.penguinScreenYTop, lift) * H) * D / rig.f;
    // pitch ≤ 0 이어도 tan·나눗셈은 그대로 성립. 다만 카메라가 수면 아래로 내려가지 않게 최소 높이를 둠
    const back = D * cp + V * sp, up = Math.max(K.minCamHeight || 0, D * sp - V * cp);
    rig.cx = cam.x - rig.F[0] * back; rig.cy = cam.y - rig.F[1] * back; rig.cz = cam.z + up;
    rig.horizon = rig.cy0 - rig.f * Math.tan(phi);
  }
  // 카메라 좌표: [오른쪽, 깊이, 위]
  function camSpace(x, y, z) {
    const dx = x - rig.cx, dy = y - rig.cy, h = z - rig.cz;
    const xr = dx * rig.R[0] + dy * rig.R[1], zf = dx * rig.F[0] + dy * rig.F[1];
    return [xr, zf * rig.cp - h * rig.sp, zf * rig.sp + h * rig.cp];
  }
  const toScreen = (c) => { const d = Math.max(c[1], 1e-3); return [W / 2 + rig.f * c[0] / d, rig.cy0 - rig.f * c[2] / d, c[1]]; };
  function project(x, y, z = 0) { return toScreen(camSpace(x, y, z)); }
  const pxPerUnit = (depth) => rig.f / Math.max(depth, rig.near);
  function screenDirToWorld(sx, sy) {
    const c = Math.cos(cam.yaw), s = Math.sin(cam.yaw);
    return [c * sx + s * sy, -s * sx + c * sy];
  }
  // 화면에서 끈 거리 → 그 자리(펭귄 발) 기준 월드 거리
  function screenDeltaToWorld(dsx, dsy, at) {
    const [x, y] = at, p0 = project(x, y), pr = project(x + rig.R[0], y + rig.R[1]), pf = project(x + rig.F[0], y + rig.F[1]);
    const kr = Math.max(1, Math.abs(pr[0] - p0[0])), kf = Math.max(1, Math.abs(pf[1] - p0[1]));
    const a = dsx / kr, b = -dsy / kf;
    return [rig.R[0] * a + rig.F[0] * b, rig.R[1] * a + rig.F[1] * b];
  }
  // 안개: 깊이에 따라 미색으로 섞이는 비율
  const fogAt = (d, fg = C.FOG.dist) => fg.max * smooth(fg.start, fg.end, d);
  const BG = PAL.sea, FOGC = PAL.fog;
  const mixTo = (rgb, t, to) => `rgb(${rgb.map((v, i) => Math.round(v + (to[i] - v) * t)).join(',')})`;
  const mixSea = (rgb, t) => `rgb(${rgb.map((v, i) => Math.round(v + (BG[i] - v) * t)).join(',')})`;
  const mixFog = (rgb, t) => mixTo(rgb, t, FOGC);        // 거리 안개: 청흑색으로 수렴
  // 앞쪽 잘림면(near)으로 다각형 자르기 → 화면 좌표
  function projPoly(pts3) {
    const cs = pts3.map(([x, y, z]) => camSpace(x, y, z)), out = [], n = rig.near;
    for (let i = 0; i < cs.length; i++) {
      const a = cs[i], b = cs[(i + 1) % cs.length], ina = a[1] >= n, inb = b[1] >= n;
      if (ina) out.push(a);
      if (ina !== inb) { const t = (n - a[1]) / (b[1] - a[1]); out.push([a[0] + (b[0] - a[0]) * t, n, a[2] + (b[2] - a[2]) * t]); }
    }
    return out.map(toScreen);
  }
  function fillPoly(pts) {
    if (pts.length < 3) return;
    ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.fill();
  }

  // ── 지형 판정 (빙하 = 그림과 같은 다각형, 충돌 = 원·타원) ──────
  // 윗면 높이: 화면에 그린 메시(고리 × 꼭짓점 사각형)를 그대로 보간. 높이 함수(fn)를 직접 쓰면
  // 메시보다 가는 능선·어깨에서 펭귄이 그려진 면보다 최대 0.5 떠 보였음 (공중 부양 버그)
  function meshTopAt(f, lx, ly) {
    const rf = f.relief, shp = f.shape, n = shp.length, K = rf.K, R = rf.rings;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, A = shp[i], B = shp[j];
      const cAB = A[0] * B[1] - A[1] * B[0], cAp = A[0] * ly - A[1] * lx, cpB = lx * B[1] - ly * B[0];
      if (cAB > 0 ? (cAp < -1e-9 || cpB < -1e-9) : (cAp > 1e-9 || cpB > 1e-9)) continue;   // 이 쐐기(중심·A·B) 밖
      const ex = B[0] - A[0], ey = B[1] - A[1], den = ex * ly - ey * lx;
      const t = Math.abs(den) < 1e-9 ? 0 : clamp(-cAp / den, 0, 1);
      const qx = A[0] + ex * t, qy = A[1] + ey * t, s = clamp(Math.hypot(lx, ly) / (Math.hypot(qx, qy) || 1), 0, 1);
      const u = (1 - s) * K, k0 = Math.min(K - 1, Math.floor(u)), fr = u - k0;
      return lerp(lerp(R[k0][i][2], R[k0][j][2], t), lerp(R[k0 + 1][i][2], R[k0 + 1][j][2], t), fr);
    }
    return R[0][0][2];
  }
  const floeTopAt = (f, lx, ly) => C.floe.topHeight + (f.relief ? meshTopAt(f, lx, ly) : 0) + f.tilt.x * lx + f.tilt.y * ly;
  const onFloe = (f, x, y, scale = 1) => f && f.active && inPoly(f.shape, (x - f.x) / scale, (y - f.y) / scale);
  const floeAt = (x, y, scale = 1) => S.floePool.find((f) => f.active && onFloe(f, x, y, scale)) || null;
  const islandAt = (x, y) => S.islands.find((is) => inPoly(is.shape, x, y));
  // ── 섬 지형 ─────────────────────────────────────────────
  const IT = C.ISLAND_TERRAIN;
  const TSTEP = 0.1, terrainTab = (() => {                   // 단면을 0.1 간격 표로 (캣멀롬 보간)
    if (!IT) return null;
    const P = IT.profile, n = Math.ceil(P[P.length - 1][0] / TSTEP) + 1, T = new Float32Array(n);
    const cr = (p0, p1, p2, p3, t) => 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
    let k = 0;
    for (let i = 0; i < n; i++) {
      const d = i * TSTEP; while (k < P.length - 2 && P[k + 1][0] < d) k++;
      const a = P[Math.max(0, k - 1)], b = P[k], c2 = P[k + 1], e = P[Math.min(P.length - 1, k + 2)], t = clamp((d - b[0]) / (c2[0] - b[0]), 0, 1);
      T[i] = Math.max(0, cr(a[1], b[1], c2[1], e[1], t));
    }
    return T;
  })();
  function profileAt(d) {                                    // 해안선에서 안쪽 거리 d 의 지형 높이 (해변 기준 0)
    if (!(d > 0)) return 0;
    const u = d / TSTEP, i = Math.floor(u); if (i >= terrainTab.length - 1) return terrainTab[terrainTab.length - 1];
    return lerp(terrainTab[i], terrainTab[i + 1], u - i);
  }
  const inlandDist = (x, y) => { const sd = shoreDist(x, y); return sd === Infinity ? -1 : -sd; };
  // 구역 값을 경계에서 부드럽게 섞어 읽음 (key: speed / color / trees)
  function zoneAt(d) {
    const Z = IT.zones; let i = 0; while (i < Z.length - 1 && d > Z[i].to) i++;
    const z = Z[i], nb = i < Z.length - 1 ? Z[i + 1] : null, k = nb ? smooth(z.to - IT.zoneBlend, z.to + IT.zoneBlend, d) : 0;
    return { z, nb, k };
  }
  const zoneNum = (d, key) => { const { z, nb, k } = zoneAt(d); const v = (q) => (Array.isArray(q[key]) ? lerp(q[key][0], q[key][1], clamp((d - (IT.zones[IT.zones.indexOf(q) - 1] || { to: 0 }).to) / (q.to - (IT.zones[IT.zones.indexOf(q) - 1] || { to: 0 }).to), 0, 1)) : q[key]); return nb ? lerp(v(z), v(nb), k) : v(z); };
  const zoneColor = (d) => { const { z, nb, k } = zoneAt(d); return nb ? z.color.map((v, i) => v + (nb.color[i] - v) * k) : z.color; };
  // 모난 바위 메시: 바닥 고리(들쭉날쭉한 꼭짓점) → 중간 고리 → 꼭대기(한쪽으로 치우침). 고리는 꼭대기 쪽으로 줄어든 같은 모양
  function makeRockMesh(cx, cy, R, Ry, H, seed) {
    const SH = IT.rocks.shape, r = rng(seed), n = Math.round(lerp(SH.verts[0], SH.verts[1], r()));
    const ax = cx + (r() - 0.5) * 2 * SH.apexOffset * R, ay = cy + (r() - 0.5) * 2 * SH.apexOffset * Ry;
    const base = [], mid = [];
    for (let i = 0; i < n; i++) {
      const a = (i + (r() - 0.5) * 0.5) / n * Math.PI * 2, k = 1 + (r() - 0.5) * 2 * SH.radiusVar;
      base.push([cx + Math.cos(a) * R * k, cy + Math.sin(a) * Ry * k]);
    }
    const rings = [base.map(([x, y]) => [x, y, 0]), base.map(([x, y]) => [ax + (x - ax) * (1 - SH.midAt), ay + (y - ay) * (1 - SH.midAt), H * lerp(SH.midHeight[0], SH.midHeight[1], r())]), base.map(() => [ax, ay, H])];
    return { ax, ay, rings, n };
  }
  // 메시 위 높이 (그린 면 그대로): 꼭대기를 중심으로 쐐기 찾아 고리 사이를 보간
  function rockMeshHeight(m, x, y) {
    const B = m.rings[0], n = m.n, lx = x - m.ax, ly = y - m.ay;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, A = [B[i][0] - m.ax, B[i][1] - m.ay], Bb = [B[j][0] - m.ax, B[j][1] - m.ay];
      const cAB = A[0] * Bb[1] - A[1] * Bb[0], cAp = A[0] * ly - A[1] * lx, cpB = lx * Bb[1] - ly * Bb[0];
      if (cAB > 0 ? (cAp < -1e-9 || cpB < -1e-9) : (cAp > 1e-9 || cpB > 1e-9)) continue;
      const ex = Bb[0] - A[0], ey = Bb[1] - A[1], den = ex * ly - ey * lx, t = Math.abs(den) < 1e-9 ? 0 : clamp(-cAp / den, 0, 1);
      const qx = A[0] + ex * t, qy = A[1] + ey * t, s = Math.hypot(lx, ly) / (Math.hypot(qx, qy) || 1);
      if (s >= 1) return 0;
      const u = (1 - s) * 2, k0 = Math.min(1, Math.floor(u)), fr = u - k0, R = m.rings;
      return lerp(lerp(R[k0][i][2], R[k0][j][2], t), lerp(R[k0 + 1][i][2], R[k0 + 1][j][2], t), fr);
    }
    return 0;
  }
  function rockHeightAt(x, y) {
    let h = 0;
    for (const r of S.rocks || []) { if (Math.abs(x - r.x) > r.R * 1.4 || Math.abs(y - r.y) > r.Ry * 1.4) continue; h = Math.max(h, rockMeshHeight(r.mesh, x, y)); }
    return h;
  }
  // 지형 높이 (섬 위 어디든): 해변 높이 + 단면 + 바위. 펭귄·발자국·그림자·나무·물막이 모두 이 값을 씀
  function terrainHeightAt(x, y = C.lane ? C.lane.y : 0) {
    if (!IT) return C.world.shoreHeight;
    const d = inlandDist(x, y);
    return C.world.shoreHeight + profileAt(d) + rockHeightAt(x, y);
  }
  function terrainGrad(x, y) { const e = 0.15; return { gx: (terrainHeightAt(x + e, y) - terrainHeightAt(x - e, y)) / (2 * e), gy: (terrainHeightAt(x, y + e) - terrainHeightAt(x, y - e)) / (2 * e) }; }
  // 바위·나무 배치 (리셋 때 한 번)
  function buildTerrainProps() {
    S.rocks = []; S.trees = []; S.snow = []; S.drops = []; S.sheets = [];
    const is = S.islands[0]; if (!IT || !is) return;
    const RK = IT.rocks;
    for (const r of RK.list) {
      const x = is.shoreAt(r.y) + is.side * r.d, R = RK.width / 2, Ry = RK.width / 2 * RK.depthScale, rr0 = rng(r.seed || 1);
      const rock = { x, y: r.y, d: r.d, h: r.h, R, Ry, mesh: makeRockMesh(x, r.y, R, Ry, r.h, r.seed || 1), pebbles: [] };
      const PB = RK.pebbles, np = Math.round(lerp(PB.count[0], PB.count[1], rr0()));
      for (let k = 0; k < np; k++) { const a = rr0() * Math.PI * 2, dd = lerp(PB.spread[0], PB.spread[1], rr0()) * R, s = lerp(PB.size[0], PB.size[1], rr0());
        rock.pebbles.push(makeRockMesh(x + Math.cos(a) * dd, r.y + Math.sin(a) * dd * 0.7, s, s * 0.8, lerp(PB.height[0], PB.height[1], rr0()), (r.seed || 1) * 31 + k)); }
      S.rocks.push(rock);
    }
    // 나무: 해변 바로 뒤 야자수 줄 · 덤불 · 정글. 군락 노이즈로 뭉쳐 자람
    const T = IT.trees, rr = rng(T.seed), laneY = C.lane ? C.lane.y : 0, CL = T.cluster;
    const clump = (x, y) => 1 + CL.gain * smooth(CL.low, CL.high, 0.5 + 0.5 * noise2(x * CL.scale + 5.3, y * CL.scale - 2.1));
    const put = (type, d, y, extra) => { const x = is.shoreAt(y) + is.side * d; S.trees.push(Object.assign({ type, x, y, d }, extra)); };
    for (let d = T.palm.d[0]; d < IT.ground.maxDist; d += 0.5) {
      for (let y = laneY - T.laneGap; y > laneY - T.back; y -= 0.5) {
        const xx = is.shoreAt(y) + is.side * d, cl = clump(xx, y), jy = y + (rr() - 0.5) * 0.4, jd = d + (rr() - 0.5) * 0.45;
        if (d < T.palm.d[1] && rr() < T.palm.density * 0.25 * cl * Math.exp(-Math.pow((d - T.palm.peak) / 3.5, 2)))
          put('palm', jd, jy, { h: lerp(T.palm.height[0], T.palm.height[1], rr()), lean: (rr() - 0.5) * 2 * T.palm.lean, fl: lerp(T.palm.frondLen[0], T.palm.frondLen[1], rr()), ph: rr() * 6.28 });
        if (d > T.bush.d[0] && d < T.bush.d[1] && rr() < T.bush.density * 0.25 * cl)
          put('bush', jd, jy, { w: lerp(T.bush.size[0], T.bush.size[1], rr()), h: lerp(T.bush.height[0], T.bush.height[1], rr()), ph: rr() * 6.28 });
        if (d > IT.zones[0].to + 2 && rr() < zoneNum(d, 'trees') * 0.25 * cl)
          put('jungle', jd, jy, { h: lerp(T.jungle.height[0], T.jungle.height[1], rr()), w: lerp(T.jungle.width[0], T.jungle.width[1], rr()), lean: (rr() - 0.5) * 0.2, ph: rr() * 6.28 });
      }
      if (d > T.front.d[0] && d < T.front.d[1] && rr() < T.front.density * 2) {          // 이동 선 앞쪽 실루엣 (드물게)
        const y = laneY + lerp(T.front.y[0], T.front.y[1], rr());
        put('jungle', d, y, { h: lerp(T.jungle.height[0], T.jungle.height[1], rr()) * 1.1, w: lerp(T.jungle.width[0], T.jungle.width[1], rr()), lean: (rr() - 0.5) * 0.2, ph: rr() * 6.28, front: true });
      }
    }
    buildLandFireflies();
  }
  function surfaceAt(x, y) {
    if (islandAt(x, y)) return { mode: 'island', z: terrainHeightAt(x, y) };
    const f = floeAt(x, y, 0.95);
    if (f) return { mode: 'floe', floe: f, z: floeTopAt(f, x - f.x, y - f.y) };
    return { mode: 'water', z: 0 };
  }
  // 수심: 해안선에서 바다 쪽 거리로 0 → 1 (smoothstep^power). 섬 위는 0, 섬에서 먼 바다는 1
  function shoreDist(x, y) {
    const is = S.islands[0];
    if (!is || Math.abs(y - is.cy) >= is.ry) return Infinity;
    return (x - is.shoreAt(y)) * -is.side;
  }
  function depthAt(x, y) {
    const d = shoreDist(x, y);
    if (d === Infinity) return 1;
    if (d <= 0) return 0;
    return Math.pow(smooth(0, C.DEPTH.slope, d), C.DEPTH.power);
  }
  // 걷기(0~0.25) · 허우적(0.25~0.55) · 헤엄(0.55~). 히스테리시스로 경계에서 떨리지 않게
  function depthClass(p, dep) {
    const D = C.DEPTH, h = D.hysteresis, cur = p.wclass || 'swim';
    const up1 = D.walkMax + (cur === 'walk' ? h : -h), up2 = D.wadeMax + (cur === 'swim' ? -h : h);
    return dep < up1 ? 'walk' : dep < up2 ? 'wade' : 'swim';
  }
  const surfKey = (m) => (m === 'floe' ? 'ice' : m === 'island' ? 'shore' : 'water');

  // ── 물결 ────────────────────────────────────────────────
  function ripple(x, y, maxR, life, alpha) {
    const R = WC().ripple;
    if (sim) { sim.drop(x, y, Math.max(0.2, maxR * SIM.drop.radius), SIM.drop.amp * (alpha == null ? 1 : alpha / R.alpha)); return; }   // 물 엔진: 충격만 주면 파문은 계산으로
    S.ripples.push({ x, y, t: 0, maxR, life: life || R.life, alpha: alpha == null ? R.alpha : alpha, ph: Math.random() * 6.28, ph2: Math.random() * 6.28 });
  }
  // V자 항적 입자 (풀 재사용, 가득 차면 가장 오래된 것 교체)
  function wakeLimit() { return Math.max(8, Math.round(WC().wake.maxParticles * S.quality)); }
  function emitWake(hull, x, y, ang, speed, maxSp, halfW) {
    const Wk = WC().wake, s = clamp(speed / maxSp, 0, 1);
    const spacing = lerp(Wk.spacing[0], Wk.spacing[1], s);
    if (hull.lastEmit && Math.hypot(x - hull.lastEmit[0], y - hull.lastEmit[1]) < spacing) return;
    if (hull.lastEmit) hull.vtxDist = (hull.vtxDist || 0) + Math.hypot(x - hull.lastEmit[0], y - hull.lastEmit[1]);
    hull.lastEmit = [x, y];
    if (sim) {                                                  // 물 엔진: 항적은 계산으로 생김. 푸른 점만 남김
      for (let k = 0; k < C.FIREFLY.sparkle.wakeCount; k++) { const sd = k % 2 ? 1 : -1, o = halfW * (1 + Math.random() * 0.6); spawnSpark(x - Math.sin(ang) * o * sd, y + Math.cos(ang) * o * sd, 0.05 + Math.random() * 0.1, C.FIREFLY.sparkle.waveLife); }
      return;
    }
    // 지나간 자리 양옆에 작게 말려 도는 와류
    const V = WC().curve.vortex;
    if (hull.vtxDist > V.every && s > 0.25) {
      hull.vtxDist = 0;
      const px = -Math.sin(ang), py = Math.cos(ang), side = (S.vtxFlip = -(S.vtxFlip || 1));
      if (S.vortex.length >= V.max) S.vortex.shift();
      S.vortex.push({ x: x + px * halfW * 1.3 * side, y: y + py * halfW * 1.3 * side, t: 0, dir: side, ph: ang + Math.PI, r: V.radius * (0.7 + 0.6 * s) * (0.6 + halfW), a: V.alpha * (0.5 + 0.5 * s) });
    }
    const lim = wakeLimit();
    let slot = null, oldest = null;
    for (let i = 0; i < lim; i++) {
      const w = S.wake[i] || (S.wake[i] = { on: false });
      if (!w.on) { slot = w; break; }
      if (!oldest || w.t > oldest.t) oldest = w;
    }
    slot = slot || oldest;
    for (let k = 0; k < C.FIREFLY.sparkle.wakeCount; k++) {      // 물결을 일으킨 자리에서 푸른 점이 반짝
      const sd = k % 2 ? 1 : -1, o = halfW * (1 + Math.random() * 0.6);
      spawnSpark(x - Math.sin(ang) * o * sd, y + Math.cos(ang) * o * sd, 0.05 + Math.random() * 0.1, C.FIREFLY.sparkle.waveLife);
    }
    Object.assign(slot, { on: true, x, y, ang, speed, t: 0, r0: halfW, s,
      alpha: Wk.alphaMax * (0.25 + 0.75 * s), span: deg(lerp(Wk.arcDeg[0], Wk.arcDeg[1], s)) });
  }

  // ── 입력 ────────────────────────────────────────────────
  const pointers = new Map();
  const keys = new Set();

  function pickRole(x, y) {
    const rg = layout.ring, a = layout.action;
    if (C.ui.ring.hidden) return Math.hypot(x - a.x, y - a.y) <= C.ui.action.hitRadius ? 'action' : 'ring';   // GRIS: 발바닥 말고는 전부 이동
    if (Math.hypot(x - rg.x, y - rg.y) <= C.ui.ring.hitRadius) return 'ring';
    if (Math.hypot(x - a.x, y - a.y) <= C.ui.action.hitRadius) return 'action';
    const p = S.p;
    if (p.mode === 'floe' && p.floe && !p.air) {
      const [sx, sy, d] = project(p.x, p.y, p.z), u = penH() * pxPerUnit(d) * rig.cp;
      if (Math.hypot(x - sx, y - (sy + penOffset() - u * 0.45)) <= Math.max(C.input.penguinHitPx * C.penguin.scale, u * 0.6)) return 'drag';
    }
    return 'camera';
  }

  let triedFullscreen = false;
  function pointerDown(id, x, y, isTouch) {
    if (C.fullscreenOnFirstTouch && !triedFullscreen && isTouch) {
      triedFullscreen = true;
      const el = document.documentElement;
      if (el.requestFullscreen) el.requestFullscreen().then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape')).catch(() => {});
    }
    const role = id === 'kb' ? 'action' : pickRole(x, y);
    const ptr = { role, x, y, ox: x, oy: y, t0: performance.now(), long: false };
    if (role === 'ring' && !C.ui.ring.hidden && Math.hypot(x - layout.ring.x, y - layout.ring.y) <= C.ui.ring.radius * 1.15) { ptr.ox = layout.ring.x; ptr.oy = layout.ring.y; }
    if (role === 'drag') { ptr.floe = S.p.floe; const f = ptr.floe; f.grab = f.grab || [f.x, f.y]; f.grabN = (f.grabN || 0) + 1; }
    pointers.set(id, ptr);
    if (role === 'action') { S.tapPulse = 1; actionPress(ptr); }
  }
  function release(id, cancelled) {
    const ptr = pointers.get(id);
    if (!ptr) return;
    pointers.delete(id);
    if (ptr.role === 'camera') S.lastCamTouch = S.time;
    if (ptr.role === 'drag' && ptr.floe) { const f = ptr.floe; f.grabN = Math.max(0, (f.grabN || 1) - 1); if (!f.grabN) f.grab = null; }
    if (ptr.role === 'action' && !ptr.long && !cancelled) shortTap(ptr);
  }
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
    pointerDown(e.pointerId, e.clientX, e.clientY, e.pointerType === 'touch');
  });
  canvas.addEventListener('pointermove', (e) => {
    const ptr = pointers.get(e.pointerId);
    if (!ptr) return;
    const dx = e.clientX - ptr.x, dy = e.clientY - ptr.y;
    ptr.x = e.clientX; ptr.y = e.clientY;
    if (ptr.role === 'ring' && C.ui.ring.hidden) {          // GRIS: 기준점이 손가락을 따라옴 → 아무리 길게 끌어도 계속 이동
      const R = C.ui.ring, ddx = ptr.x - ptr.ox, ddy = ptr.y - ptr.oy, l = Math.hypot(ddx, ddy);
      if (l > R.maxPush) { ptr.ox = ptr.x - ddx / l * R.maxPush; ptr.oy = ptr.y - ddy / l * R.maxPush; }
    } else if (ptr.role === 'camera') {
      S.lastCamTouch = S.time;
      if (C.camera.lockRotation) return;                       // GRIS: 각도 고정
      cam.yawT = clamp(cam.yawT + dx * C.camera.rotateSensX, -deg(C.camera.yawLockDeg), deg(C.camera.yawLockDeg));   // GRIS: 좌우 ±yawLockDeg 안에서만
      cam.pitchT = clamp(cam.pitchT + dy * C.camera.rotateSensY, deg(C.camera.pitchMinDeg), deg(C.camera.pitchMaxDeg));
    } else if (ptr.role === 'drag' && ptr.floe && ptr.floe.grab) {
      const [wx, wy] = screenDeltaToWorld(dx, dy, [S.p.x, S.p.y]);
      ptr.floe.grab[0] += wx; ptr.floe.grab[1] += wy;          // 손가락 목표점만 옮김 → 스프링 힘으로 끌림
    }
  });
  canvas.addEventListener('pointerup', (e) => release(e.pointerId, false));
  ['pointercancel', 'lostpointercapture'].forEach((t) => canvas.addEventListener(t, (e) => release(e.pointerId, true)));
  function releaseAll() { [...pointers.keys()].forEach((id) => release(id, true)); keys.clear(); }
  window.addEventListener('blur', releaseAll);
  document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAll(); });
  window.addEventListener('pagehide', releaseAll);
  ['contextmenu', 'gesturestart', 'dblclick'].forEach((t) => document.addEventListener(t, (e) => e.preventDefault()));
  document.getElementById('reset').addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); releaseAll(); reset(); if (C.INTRO_HINT && C.INTRO_HINT.showOnReset) showHint(); });
  // 시작 안내 문구: 페이드인 → 첫 터치(키 입력)까지 유지 → 페이드아웃
  const hintEl = document.getElementById('hint'); let hintTimer = 0, hintShown = false;
  function showHint() {
    const H = C.INTRO_HINT; if (!hintEl || !H || !H.enabled) return;
    hintEl.textContent = H.text; hintEl.style.transition = 'none'; hintEl.classList.remove('on'); void hintEl.offsetWidth;
    hintEl.style.transition = `opacity ${H.fadeIn}s ease`; hintShown = true;
    clearTimeout(hintTimer); hintTimer = setTimeout(() => { if (hintShown) hintEl.classList.add('on'); }, H.delay * 1000);
  }
  function hideHint() {
    if (!hintShown || !hintEl) return; hintShown = false; clearTimeout(hintTimer);
    hintEl.style.transition = `opacity ${C.INTRO_HINT.fadeOut}s ease`; hintEl.classList.remove('on');
  }
  canvas.addEventListener('pointerdown', hideHint);
  window.addEventListener('keydown', hideHint);
  showHint();

  const KEYMAP = { arrowleft: 'l', a: 'l', arrowright: 'r', d: 'r', arrowup: 'u', w: 'u', arrowdown: 'dn', s: 'dn' };
  window.addEventListener('keydown', (e) => {
    if (e.key === ' ') { if (!e.repeat) pointerDown('kb', 0, 0, false); e.preventDefault(); return; }
    const k = KEYMAP[e.key.toLowerCase()];
    if (k) { keys.add(k); e.preventDefault(); }
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === ' ') { release('kb', false); return; }
    const k = KEYMAP[e.key.toLowerCase()]; if (k) keys.delete(k);
  });

  // GRIS: 좌우만 — 위아래 입력은 버림 (화면 기준 → yaw 0 이라 월드 ±x)
  function readMove() { const m = readMove2D(); return C.lane ? [m[0], 0] : m; }
  function readMove2D() {
    const R = C.ui.ring;
    for (const ptr of pointers.values()) {
      if (ptr.role !== 'ring') continue;
      const dx = ptr.x - ptr.ox, dy = ptr.y - ptr.oy, len = Math.hypot(dx, dy);
      if (len > R.releasePush || len < R.deadZone) return [0, 0];
      const m = clamp((len - R.deadZone) / (R.maxPush - R.deadZone), 0, 1);
      return [(dx / len) * m, (dy / len) * m];
    }
    if (keys.size) {
      const kx = (keys.has('r') ? 1 : 0) - (keys.has('l') ? 1 : 0), ky = (keys.has('dn') ? 1 : 0) - (keys.has('u') ? 1 : 0);
      const l = Math.hypot(kx, ky);
      if (l) return [kx / l, ky / l];
    }
    return [0, 0];
  }

  // 발자국: 짧은 탭 = 버튼 반응만 / 짧은 탭 두 번 = 두 번째를 뗄 때 점프 / 길게 = 누르는 동안 슬라이딩
  // 한 번 탭(뗄 때) = 점프. 첫 탭을 뗀 뒤 doubleTapMs 안에 다시 누르면 = 슈퍼점프 (체공 중이면 이어 붙임)
  function shortTap(ptr) {
    log('tap');
    if (ptr.superTap) return;                                // 슈퍼점프로 쓰인 두 번째 탭은 다시 세지 않음
    S.lastTapUp = performance.now();
    if (C.input.jumpDelayMs > 0) S.jumpAt = S.lastTapUp + C.input.jumpDelayMs;   // 옵션: 잠깐 기다렸다 점프
    else S.jumpReq = 'jump';
  }
  function actionPress(ptr) {
    if (S.lastTapUp && ptr.t0 - S.lastTapUp <= C.input.doubleTapMs) {
      S.lastTapUp = 0; S.jumpAt = 0; ptr.superTap = true; S.jumpReq = 'super';
    }
  }
  const slideHeld = () => { for (const p of pointers.values()) if (p.role === 'action' && p.long) return true; return false; };

  // ── 시작 연출: 파문 하나 → 그 자리에서 반딧불이 군집이 서서히 밝아짐 (조작은 바로 가능) ──
  function updateIntro(dt) {
    const I = C.intro, it = S.intro;
    it.t += dt;
    if (it.started || it.t < I.delay) return;
    it.started = true;
    let [x, y] = introPoint(S.p.x, S.p.y);
    const [Fx, Fy] = screenDirToWorld(0, -1);
    for (let i = 0; i < 12 && floeAt(x, y); i++) { x += Fx * 0.6; y += Fy * 0.6; }   // 빙하 위가 아닌 수면에서
    it.x = x; it.y = y;
    ripple(x, y, I.rippleRadius, WC().ripple.life, WC().ripple.alpha * 1.2);
    buildGuidePath(x, y);
    log('intro');
  }
  // 군집 밝기 배율: 연출 전 0, 파문 뒤 fadeIn 동안 서서히 1
  const introVis = () => (S.intro.started ? smooth(0, C.intro.fadeIn, S.intro.t - C.intro.delay) : 0);

  // ── 물리 한 단계 (60Hz 고정) ──────────────────────────────
  function bobTarget(ph, scale) {
    const B = WC().bob, t = S.time;
    const v = Math.sin(t * 2 * Math.PI / B.periods[0] + ph[0]) * B.ampsPx[0] + Math.sin(t * 2 * Math.PI / B.periods[1] + ph[1]) * B.ampsPx[1];
    return clamp(v * scale, -B.maxPx, B.maxPx);
  }
  // 가속·감속을 추적해 관성 기울기 목표와 멈춤 출렁임을 만든다
  function trackInertia(h, speed, maxSp, dt) {
    const a = (speed - h.prevSpeed) / dt;
    h.prevSpeed = speed;
    h.aLong += (a - h.aLong) * ease(10, dt);
    const I = WC().inertiaTilt, k = clamp(Math.abs(h.aLong) / I.accelRef, 0, 1);
    h.inertia = h.aLong > 0 ? -deg(I.accelDeg) * k : deg(I.stopDeg) * k;   // + = 앞으로 숙임
    if (speed > 0.6) h.peakSpeed = Math.max(h.peakSpeed, speed);
    if (speed < 0.2 && h.peakSpeed > 0.6) {                                 // 멈춤: 한 번 눌러 주고 스프링으로 가라앉힘
      const px = Math.min(WC().settle.maxPx, WC().settle.maxPx * clamp(h.peakSpeed / maxSp, 0, 1) * 0.6);
      h.heave.v -= impulseFor(px);
      h.peakSpeed = 0;
    }
  }

  const ellR = (f, nx, ny) => 0.95 * f.rx * f.ry / Math.hypot(f.ry * nx, f.rx * ny);
  function stepFloes(dt) {
    const B = WC().bob, start = S.cands[0], startMass = Math.PI * baseRX() * baseRY() * P.floeDensity;
    const fl = activeFloes();
    for (const f of fl) {
      // 끌기: 손가락 목표점으로 스프링 힘 → 무거울수록 천천히 가속
      if (f.grab) {
        const k = P.dragStiffness, c = 2 * Math.sqrt(k * f.mass);
        f.vx += ((k * (f.grab[0] - f.x) - c * f.vx) / f.mass) * dt;
        f.vy += ((k * (f.grab[1] - f.y) - c * f.vy) / f.mass) * dt;
      } else {
        const drag = P.floeWaterDrag * Math.pow(startMass / f.mass, 0.3);
        const k = Math.exp(-drag * dt); f.vx *= k; f.vy *= k;
      }
      const sp = Math.hypot(f.vx, f.vy);
      if (sp > C.floe.maxSpeed) { f.vx *= C.floe.maxSpeed / sp; f.vy *= C.floe.maxSpeed / sp; }
      f.x += f.vx * dt; f.y += f.vy * dt;
    }
    // 빙하끼리 원 판정으로 살짝 밀어내기
    for (let i = 0; i < fl.length; i++) for (let j = i + 1; j < fl.length; j++) {
      const a = fl[i], b = fl[j], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1e-3;
      if (d > a.R + b.R) continue;
      const nx = dx / d, ny = dy / d;
      const o = ellR(a, nx, ny) + ellR(b, nx, ny) - d;         // 타원 판정: 마주 보는 방향의 반지름
      if (o <= 0) continue;
      const ma = a.grab ? a.mass * 4 : a.mass, mb = b.grab ? b.mass * 4 : b.mass, tot = ma + mb;
      const push = o * P.collisionPush;
      a.x -= nx * push * mb / tot; a.y -= ny * push * mb / tot; b.x += nx * push * ma / tot; b.y += ny * push * ma / tot;
      const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (rv < 0) { const j2 = -rv * 0.6; a.vx -= nx * j2 * mb / tot; a.vy -= ny * j2 * mb / tot; b.vx += nx * j2 * ma / tot; b.vy += ny * j2 * ma / tot; }
    }
    const BD = C.bounds;
    for (const f of fl) {
      f.vx += (Math.max(0, BD.x[0] - f.x) - Math.max(0, f.x - BD.x[1])) * BD.push * dt;
      f.vy += (Math.max(0, BD.y[0] - f.y) - Math.max(0, f.y - BD.y[1])) * BD.push * dt;
      // 섬: 타원 판정
      for (const is of S.islands) {
        const a = is.rx + f.R * 0.8, b = is.ry + f.R * 0.8, dx = f.x - is.cx, dy = f.y - is.cy;
        const q = (dx * dx) / (a * a) + (dy * dy) / (b * b);
        if (q < 1) {
          const s = 1 / Math.sqrt(q); f.x = is.cx + dx * s; f.y = is.cy + dy * s;
          let nx = dx / (a * a), ny = dy / (b * b); const nl = Math.hypot(nx, ny); nx /= nl; ny /= nl;
          const vn = f.vx * nx + f.vy * ny; if (vn < 0) { f.vx -= vn * nx; f.vy -= vn * ny; }
        }
      }
      // 부력 출렁임: 수면 높이(사인파 목표)로 돌아가는 스프링. 작을수록 가볍게 더 흔들림
      const light = clamp(Math.pow(startMass / f.mass, 0.25), 1, B.lightBoost);
      spring(f.heave, bobTarget(f.ph, light) + (sim ? SIM.feedback.floePx * sim.around(f.x, f.y, f.rx * 1.12, f.ry * 1.12) : 0), dt);
      f.hist[S.stepN % 64] = f.heave.h;
      // 기울기 = 파도 + 펭귄 무게중심 + 관성
      const sp = Math.hypot(f.vx, f.vy);
      if (sp > 0.05) f.dir = [f.vx / sp, f.vy / sp];
      trackInertia(f, sp, 4, dt);
      const wt = deg(B.tiltDeg) * 0.7;
      let tx = Math.sin(S.time * 2 * Math.PI / B.periods[0] + f.ph[2]) * wt, ty = Math.sin(S.time * 2 * Math.PI / B.periods[1] + f.ph[3]) * wt;
      const p = S.p;
      if (p.floe === f && p.mode === 'floe' && !p.air) {
        let wx = p.lx / f.rx, wy = p.ly / f.ry; const wl = Math.hypot(wx, wy); if (wl > 1) { wx /= wl; wy /= wl; }
        tx -= deg(P.weightTiltDeg) * wx; ty -= deg(P.weightTiltDeg) * wy;   // 펭귄 쪽이 내려감
      }
      tx += f.inertia * f.dir[0]; ty += f.inertia * f.dir[1];
      const tz = { h: f.tilt.x, v: f.tilt.vx }; spring(tz, tx, dt); f.tilt.x = tz.h; f.tilt.vx = tz.v;
      const tw = { h: f.tilt.y, v: f.tilt.vy }; spring(tw, ty, dt); f.tilt.y = tw.h; f.tilt.vy = tw.v;
      // 항적
      if (sp > 0.25) emitWake(f, f.x - f.dir[0] * f.R * 0.6, f.y - f.dir[1] * f.R * 0.6, Math.atan2(f.dir[1], f.dir[0]), sp, 4, f.cr * 0.6);
      else f.lastEmit = null;
    }
  }

  function stepPenguin(dt) {
    const p = S.p, pm = P.penguin;
    const [mx, my] = readMove();
    const [wx, wy] = screenDirToWorld(mx, my);
    const mag = Math.hypot(mx, my);
    const surf = surfKey(p.mode), WP = P.water;
    const DP = C.DEPTH;
    p.waterDepth = p.mode === 'water' ? depthAt(p.x, p.y) : 0;
    p.wclass = p.mode === 'water' ? depthClass(p, p.waterDepth) : null;
    p.depth = p.wclass === 'swim' ? 'deep' : p.wclass ? 'shallow' : null;
    const shallow = p.depth === 'shallow', deep = p.depth === 'deep';
    // 이번 단계의 최고 속도·미는 힘: 걷기 → 허우적(깊어질수록 느려짐) → 헤엄
    const wadeK = p.wclass === 'wade' ? clamp((p.waterDepth - DP.walkMax) / (DP.wadeMax - DP.walkMax), 0, 1) : 0;
    let maxSp = shallow ? lerp(DP.walkSpeed, DP.wadeMinSpeed, wadeK) : deep ? WP.deepMaxSpeed : pm.maxSpeed[surf];
    // 오르막은 최고 속도가 최대 25% 줄어듦
    p.slopeG = null;
    if (IT && p.mode === 'island' && !p.air) {               // 섬: 구역별 속도 배율 + 오르막 감속 (경사에 맞춰 몸도 기욺)
      const d = inlandDist(p.x, p.y), gr = terrainGrad(p.x, p.y), v0 = Math.hypot(p.vx, p.vy);
      const zs = zoneNum(d, 'speed'); maxSp *= zs; p.zoneForce = Math.max(1, zs);   // 구역 속도 (빨라지는 구역은 미는 힘도 같은 배율로)
      p.slopeG = gr;
      if (v0 > 0.05) maxSp *= 1 - IT.slope.uphillSlow * clamp((gr.gx * p.vx + gr.gy * p.vy) / v0 / Math.tan(deg(IT.walkableMaxSlope)), 0, 1);
    }
    if (p.mode === 'floe' && p.floe && p.floe.relief && !p.air) {
      const RL = C.floe.relief, gr = reliefAt(p.floe, p.lx, p.ly), v0 = Math.hypot(p.vx, p.vy);
      p.slopeG = gr;
      if (v0 > 0.05) maxSp *= 1 - RL.uphillSlow * clamp((gr.gx * p.vx + gr.gy * p.vy) / v0 / RL.uphillRef, 0, 1);
    }
    let force = (shallow ? WP.shallowForce : pm.moveForce[surf]) * (p.mode === 'island' && !p.air && IT ? p.zoneForce || 1 : 1);
    // 땅 ↔ 얕은 물 ↔ 헤엄: 최고 속도와 미는 힘을 서서히 이어 붙여 입수·상륙 때 멈칫하지 않게
    if (!p.air && !p.sliding) {
      const kb = ease(DP.speedBlend, dt);
      p.maxSpS = p.maxSpS == null ? maxSp : p.maxSpS + (maxSp - p.maxSpS) * kb;
      p.forceS = p.forceS == null ? force : p.forceS + (force - p.forceS) * kb;
      maxSp = p.maxSpS; force = p.forceS;
    } else { p.maxSpS = maxSp; p.forceS = force; }

    if (S.jumpAt && performance.now() >= S.jumpAt) { S.jumpAt = 0; S.jumpReq = 'jump'; }
    if (S.jumpReq) {                                        // 점프: 중력 + 초기 속도의 포물선
      const kind = S.jumpReq; S.jumpReq = false;
      const SJ = P.superJump, h0 = P.jumpVelocity * P.jumpVelocity / (2 * P.gravity);
      // 물에서 점프: 깊은 물은 낮게(25%)·슈퍼점프 불가·쿨다운, 얕은 물은 60%. 안 나가면 작은 허우적 파문만
      const inW = p.mode === 'water' && !p.air;
      let jumpMul = 1, blocked = false;
      if (inW && deep) { jumpMul = WP.deepJumpMul; if (kind === 'super' || S.time < (p.waterJumpCD || 0)) blocked = true; }
      else if (inW && shallow) jumpMul = WP.shallowJumpMul;
      const BL = WP.bellyLaunch, bellyOn = BL && BL.enabled && inW;
      let bellyT = null;
      if (bellyOn) {   // 배치기 상륙: 앞쪽에 올라설 곳이 있는지 (입력 방향, 없으면 바라보는 방향)
        // 링을 밀고 있으면 그 방향 ±BL.fanDeg 안에서, 아니면 사방에서 가장 가까운 가장자리를 찾음
        const d0 = mag > 0.1 ? Math.atan2(wy, wx) : p.face, fan = mag > 0.1 ? deg(BL.fanDeg) : Math.PI;
        for (let k = 0; k <= 24; k++) {
          const dir = d0 + (k ? (k % 2 ? 1 : -1) * Math.ceil(k / 2) / 12 * fan : 0), dx = Math.cos(dir), dy = Math.sin(dir);
          for (let d = 0.2; d <= BL.reach; d += 0.1) { const su = surfaceAt(p.x + dx * d, p.y + dy * d);
            if (su.mode !== 'water') { if (!bellyT || d < bellyT.edge) { const td = d + BL.inward, s2 = surfaceAt(p.x + dx * td, p.y + dy * td); bellyT = { dir, edge: d, d: s2.mode !== 'water' ? td : d + 0.15, z: s2.mode !== 'water' ? s2.z : su.z }; } break; } }
        }
        if (!bellyT || S.time < (p.waterJumpCD || 0)) blocked = true;
      }
      if (kind === 'super' && p.air && p.superUsed && P.superJump.oncePerAir) { blocked = true; log('superChainBlocked'); }   // 공중에서 슈퍼점프 연속 금지 (둥둥 뜨는 느낌 방지)
      else if (bellyT && !blocked && !p.air) {
        // 통! 배를 내밀고 튀어올라 빙하·섬 위로 배치기 착지 (포물선을 착지점에 맞춤)
        startAir(p, mag, wx, wy); p.superUsed = true; p.belly = true; p.bellyT = null;
        const g0 = P.gravity, peak = Math.max(0.15, bellyT.z - p.z + BL.clearance), vz = Math.sqrt(2 * g0 * peak);
        const T = vz / g0 + Math.sqrt(2 * Math.max(0.02, peak - (bellyT.z - p.z)) / g0), hs = Math.max(BL.minSpeed, bellyT.d / T);
        p.g = g0; p.vz = vz; p.vx = Math.cos(bellyT.dir) * hs; p.vy = Math.sin(bellyT.dir) * hs; p.face = bellyT.dir;
        p.jumpHS = hs; p.airCap = hs; p.waterJumpCD = S.time + WP.deepJumpCooldown;
        splashDrops(p.x, p.y, BL.splash);
        log('bellyLaunch');
      }
      else if (blocked) { if (!p.air) ripple(p.x, p.y, 0.55, 0.9, WC().ripple.alpha * 0.5); log('jumpBlocked'); }
      else if (kind === 'super') {
        // 슈퍼점프: 높이 ×heightMul, 거리 ×distanceMul, 체공 ≈ airtime. 공중이면 지금 높이에서 이어 붙임
        const Hs = h0 * SJ.heightMul, gS = 8 * Hs / (SJ.airtime * SJ.airtime);
        const base = p.air ? (p.jumpBase || 0) : p.z, dz = Math.max(0, p.z - base);
        if (!p.air) startAir(p, mag, wx, wy);
        p.superUsed = true;
        p.g = gS; p.vz = Math.sqrt(2 * gS * Math.max(0.05, Hs - dz));
        // 거리 ×distanceMul: 일반 점프의 수평 속도 × 배율 × (일반 체공 / 슈퍼 체공)
        if (!p.jumpHS && mag > 0.1) p.jumpHS = Math.max(Math.hypot(p.vx, p.vy), P.jumpForwardSpeed * mag);
        const tEl = p.air ? (p.airT || 0) : 0, tRem = Math.max(0.3, SJ.airtime - tEl);
        const hs = Math.max(0, (p.jumpHS || 0) * (SJ.distanceMul * jumpAir() - tEl) / tRem);
        const dir = mag > 0.1 ? Math.atan2(wy, wx) : Math.atan2(p.vy, p.vx);
        if (hs > 0.05) { p.vx = Math.cos(dir) * hs; p.vy = Math.sin(dir) * hs; }
        p.airCap = hs;
        log('superJump');
      } else if (!p.air) {
        startAir(p, mag, wx, wy); p.superUsed = false;
        const soil = p.mode === 'island', SJm = soil ? P.shoreJump : { velocityMul: 1, forwardMul: 1 };   // 흙: 짧고 무겁게
        p.g = P.gravity; p.vz = P.jumpVelocity * SJm.velocityMul * Math.sqrt(jumpMul);   // 높이 배율 = 속도 배율²
        if (inW && deep) p.waterJumpCD = S.time + WP.deepJumpCooldown;
        if (mag > 0.1) { const s = Math.max(Math.hypot(p.vx, p.vy), P.jumpForwardSpeed * SJm.forwardMul * Math.sqrt(jumpMul) * mag); p.vx = wx / mag * s; p.vy = wy / mag * s; }
        p.jumpHS = Math.hypot(p.vx, p.vy); p.airCap = p.jumpHS;
        log('jump');
      }
    }
    const held = slideHeld();
    if (held && !p.sliding && !p.air) {
      p.sliding = true; p.sit = false;
      const dir = mag > 0.01 ? Math.atan2(wy, wx) : p.face, s = Math.max(Math.hypot(p.vx, p.vy), P.slideInitialSpeed * (p.mode === 'island' ? P.shoreSlideMul : 1));
      p.vx = Math.cos(dir) * s; p.vy = Math.sin(dir) * s;
      log('slideStart'); p.slideStroke = (S.strokeN = (S.strokeN || 0) + 1);
    }
    if (!held && p.sliding) { p.sliding = false; log('slideEnd'); }
    if (p.sliding && p.mode === 'island') {} else { p.tobT = 0; }
    p.tobKick = Math.max(0, (p.tobKick || 0) - dt / 0.25);
    if (p.belly && !p.air) {   // 배치기 착지: 잠깐 배로 미끄러진 뒤 일어섬
      const BL = WP.bellyLaunch;
      if (p.bellyT == null) { p.bellyT = BL.landSlide; const s = Math.hypot(p.vx, p.vy), d = s > 0.01 ? Math.atan2(p.vy, p.vx) : p.face, ns = Math.max(s, BL.landSlideSpeed); p.vx = Math.cos(d) * ns; p.vy = Math.sin(d) * ns; log('bellyLand'); }
      p.bellyT -= dt; if (p.bellyT <= 0 || p.mode === 'water') { p.belly = false; p.bellyT = null; }
    }

    const sp0 = Math.hypot(p.vx, p.vy);
    if (p.air) {
      p.vx += wx * pm.airForce / pm.mass * dt; p.vy += wy * pm.airForce / pm.mass * dt;
      // 공중 조작은 방향만 살짝 바꿈: 도약 때의 수평 속도를 넘지 않음
      const sa = Math.hypot(p.vx, p.vy), cap = Math.max(p.airCap || 0, 0.6);
      if (sa > cap) { p.vx *= cap / sa; p.vy *= cap / sa; }
    } else if (p.sliding) {
      // 슬라이딩: 지면 마찰로 감속. 링을 밀면 그 방향으로 힘 + 방향이 부드럽게 따라감
      let dir = sp0 > 0.01 ? Math.atan2(p.vy, p.vx) : p.face, s = sp0;
      if (mag > 0.01) { dir += angDiff(dir, Math.atan2(wy, wx)) * ease(P.slideTurnRate, dt); s += P.slideForce * mag / pm.mass * dt; }
      const TB = P.toboggan && P.toboggan.enabled && p.mode === 'island' ? P.toboggan : null;
      if (TB) {   // 육지 터보건: 배로 미끄러지며 주기적으로 발로 차서 밀고 나감
        const inl = IT ? inlandDist(p.x, p.y) : 0, onSand = !IT || inl < IT.zones[0].to;
        p.tobT = (p.tobT || 0) + dt;
        if (p.tobT >= TB.kick.period && (!TB.kick.needInput || mag > 0.1)) { p.tobT = 0; p.tobKick = 1; s += TB.kick.impulse; tobPuff(p.x - Math.cos(dir) * 0.25, p.y - Math.sin(dir) * 0.25, p.z); }
        s *= Math.exp(-(onSand ? TB.friction.sand : TB.friction.forest) * dt);
        s = Math.min(s, TB.maxSpeed);
        const GR = TB.groove; p.grT = (p.grT || 0) + dt;   // 배가 지나간 홈
        if (GR && p.grT >= GR.every && s > 0.15) { p.grT = 0; S.grooves = S.grooves || []; const g0 = S.grooves[S.grooves.length - 1];
          S.grooves.push({ x: p.x, y: p.y, t: 0, k: Math.min(1, s / 1.5), cont: !!(g0 && g0.t < GR.every * 2.5 && Math.hypot(g0.x - p.x, g0.y - p.y) < 0.6) });
          if (S.grooves.length > GR.max) S.grooves.shift(); }
      } else {
      s *= Math.exp(-P.slideFriction[surf] * dt);
      s = Math.min(s, deep ? WP.slideMaxSpeed : shallow ? WP.shallowMaxSpeed * 1.6 : P.slideMaxSpeed);   // 깊은 물 슬라이딩 헤엄이 가장 빠름
      }
      p.vx = Math.cos(dir) * s; p.vy = Math.sin(dir) * s;
      p.face = dir;
    } else {
      // 이동: 입력은 힘. 가속도 = 힘/질량, 지면 마찰로 감쇠, 최고 속도 부드럽게 제한
      p.vx += wx * force / pm.mass * dt; p.vy += wy * force / pm.mass * dt;
      const idleFloat = p.mode === 'water' && mag < 0.01 && Math.hypot(p.vx, p.vy) < 0.5;   // 떠다니기는 물 저항에 묻히지 않게
      const k = idleFloat ? 1 : Math.exp(-P.friction[surf] * dt); p.vx *= k; p.vy *= k;
      // 최고 속도: 입력으로는 넘지 않음. 슬라이딩 등으로 이미 빠르면 부드럽게 줄어듦
      const s = Math.hypot(p.vx, p.vy), mxs = maxSp * (p.inWash ? C.SHORE_WASH.slowMul : 1);
      if (s > mxs) { const ns = sp0 > mxs ? Math.max(mxs, Math.min(s, sp0) * Math.exp(-3 * dt)) : mxs; p.vx *= ns / s; p.vy *= ns / s; }
      if (mag > 0.01) { p.sit = false; p.face += angDiff(p.face, Math.atan2(wy, wx)) * ease(P.turnRate, dt); }
      else if (p.sit && C.intro.watchFirefly !== false && S.intro.started && S.intro.t < C.intro.delay + 4) {          // 앉아서 빛을 바라봄
        p.face += angDiff(p.face, Math.atan2(S.ff.y - p.y, S.ff.x - p.x)) * ease(3, dt);
      }
      // 물에서 가만히 있으면 느리게 떠다님 (방향은 천천히 바뀜). 입력을 주면 자연히 사라짐
      if (p.mode === 'water' && mag < 0.01) {
        const DR = P.drift;
        p.driftAng += noise1(S.time * 0.15 + 7.3) * DR.turnRate * dt;
        const k = ease(DR.blend, dt);
        p.vx += (Math.cos(p.driftAng) * DR.speed - p.vx) * k; p.vy += (Math.sin(p.driftAng) * DR.speed - p.vy) * k;
      }
      if (IT && p.mode === 'island' && p.slopeG) {             // 섬 내리막: 살짝 미끄러짐
        const gr = p.slopeG, sl = Math.hypot(gr.gx, gr.gy);
        if (sl > IT.slope.slideSlope) { const a = (sl - IT.slope.slideSlope) * IT.slope.slideAccel * dt; p.vx -= gr.gx / sl * a; p.vy -= gr.gy / sl * a; }
      }
      // 빙하 경사: 내리막은 살짝 미끄러져 내려옴
      if (p.mode === 'floe' && p.floe && p.floe.relief) {
        const RL = C.floe.relief, gr = reliefAt(p.floe, p.lx, p.ly), sl = Math.hypot(gr.gx, gr.gy);
        if (sl > RL.slideSlope) { const a = (sl - RL.slideSlope) * RL.slideAccel * dt; p.vx -= gr.gx / sl * a; p.vy -= gr.gy / sl * a; }
      }
      if (Math.abs(p.vx) + Math.abs(p.vy) < 1e-5) { p.vx = 0; p.vy = 0; }
    }

    const f = p.floe;
    if (p.mode === 'floe' && !p.air && f) {
      p.lx += p.vx * dt; p.ly += p.vy * dt;
      p.x = f.x + p.lx; p.y = f.y + p.ly;
    } else {
      p.x += (p.vx + (p.air ? p.cvx : 0)) * dt; p.y += (p.vy + (p.air ? p.cvy : 0)) * dt;
    }

    // GRIS: 이동 선(lane) 근처로 부드럽게 되밀기 (공중 제외, 빙하 위에서도)
    if (C.lane && !p.air) {
      const LN = C.lane, off = p.y - LN.y, ex = Math.abs(off) - LN.halfWidth;
      if (ex > 0) p.vy -= Math.sign(off) * ex * LN.push * dt;
    }
    // 바다 이동 한계: 밖으로 나가면 부드럽게 되밀기
    const B = C.bounds;
    if (!(p.mode === 'floe' && !p.air)) {
      if (p.x < B.x[0]) p.vx += (B.x[0] - p.x) * B.push * dt; if (p.x > B.x[1]) p.vx -= (p.x - B.x[1]) * B.push * dt;
      if (p.y < B.y[0]) p.vy += (B.y[0] - p.y) * B.push * dt; if (p.y > B.y[1]) p.vy -= (p.y - B.y[1]) * B.push * dt;
    }

    // 발판 전환
    if (p.air) {
      p.vz -= (p.g || P.gravity) * dt; p.z += p.vz * dt; p.airT = (p.airT || 0) + dt;
      const s = surfaceAt(p.x, p.y);
      if (p.vz < 0 && p.z <= s.z) { const vz = p.vz; p.air = false; p.superUsed = false; p.z = s.z; p.vz = 0; setMode(s.mode, s.floe, vz); }
    } else if (p.mode === 'floe') {
      if (!onFloe(f, p.x, p.y)) {
        const other = floeAt(p.x, p.y);
        if (islandAt(p.x, p.y)) setMode('island');
        else if (other) setMode('floe', other, 0);
        else setMode('water', null, -1.5);
      }
    } else if (p.mode === 'water') {
      if (islandAt(p.x, p.y)) setMode('island');
      else { const o = floeAt(p.x, p.y, 0.88); if (o) setMode('floe', o, 0); }
    } else if (p.mode === 'island') {
      if (!islandAt(p.x, p.y)) { const o = floeAt(p.x, p.y); setMode(o ? 'floe' : 'water', o, -1); }
    }
    if (!p.air && p.mode === 'water') {
      // 부력 스프링: 잠겼다가 동동동 떠오름. 위로 지나갈 때마다 작은 파문
      const WE = P.waterEntry, prevH = p.dive.h;
      springW(p.dive, 0, dt, 2 * Math.PI / WE.period, WE.dampingRatio);
      if (prevH < 0 && p.dive.h >= 0 && p.dive.v > 0.15) { ripple(p.x, p.y, 0.9, 1.1, WC().ripple.alpha * 0.6); log('bob'); }
      p.z = p.dive.h;
      if (sim && deep) p.z += SIM.feedback.penguin * sim.around(p.x, p.y, 0.55, 0.55);   // 주변 물결을 타고 오르내림
    } else if (!p.air) {
      p.dive.h = p.dive.v = 0;
      const tz = p.mode === 'island' ? terrainHeightAt(p.x, p.y) : p.mode === 'floe' && p.floe ? floeTopAt(p.floe, p.lx, p.ly) : 0;
      p.z += (tz - p.z) * ease(14, dt);
    }

    // 펭귄 자체 출렁임: 물에선 수면 사인파, 빙하 위에선 0 으로 돌아가는 스프링 (멈춤·입수 충격만)
    const sp = Math.hypot(p.vx, p.vy);
    const inWater = p.mode === 'water' && !p.air;
    spring(p.heave, inWater ? bobTarget([1.3, 4.2], 0.8) : 0, dt);
    if (!p.air) trackInertia(p, sp, maxSp, dt);
    // 관성 기울기 (화면에서 보이는 진행 방향 기준)
    const c = Math.cos(cam.yaw), s2 = Math.sin(cam.yaw), vxs = c * p.vx - s2 * p.vy;
    const dirSign = Math.abs(vxs) > 0.05 ? Math.sign(vxs) : (p.leanSign || 1); p.leanSign = dirSign;
    let iceLean = p.mode === 'floe' && !p.sliding ? deg(C.penguin.iceLeanDeg) * clamp(vxs / pm.maxSpeed.ice, -1, 1) : 0;   // 빙하: 진행 방향으로 살짝
    if (p.slopeG) iceLean += -Math.atan(p.slopeG.gx * c + p.slopeG.gy * -s2) * deg(C.floe.relief.slopeLeanDeg) / 0.6;      // 경사에 맞춰 몸이 기욺
    spring(p.lean, p.air ? 0 : (p.inertia || 0) * dirSign + iceLean, dt);

    // 그림용 값
    // 헤엄 자세: 깊은 물에서 나아가면 진행 방향으로 약 60° 눕고(슬라이딩 헤엄은 80°), 멈추면 천천히 일어섬
    const layT = inWater && deep ? (p.sliding ? WP.slideLayDeg : sp > 0.3 ? WP.layDeg * clamp((sp - 0.3) / 0.9, 0, 1) : 0) : 0;
    p.lay = (p.lay || 0) + (layT - (p.lay || 0)) * ease(3 / (layT > (p.lay || 0) ? WP.layTime : WP.standTime), dt);
    const sinkT = !inWater ? 0 : shallow ? Math.min(0.5, p.waterDepth * C.DEPTH.sinkPerDepth) : p.sliding ? 0.06 : C.penguin.swimSink + 0.2 * (p.lay / 90);   // 걸을 땐 수심만큼, 누우면 등만 수면 위
    p.sink += (sinkT - p.sink) * ease(8, dt);
    S.tapPulse = Math.max(0, S.tapPulse - dt * 5);
    const WK = shallow ? { ...WP.shallowWalk, wobbleDeg: p.wclass === 'wade' ? C.DEPTH.wadeWobbleDeg : WP.shallowWalk.wobbleDeg, stepSinkPx: 0 } : C.penguin.walk[p.mode === 'island' ? 'shore' : 'ice'];
    if (!p.air && (p.mode !== 'water' || shallow) && !p.sliding && sp > 0.12) {
      p.phase += sp * dt * WK.wobbleFreq;
      const amt = Math.min(1, sp / maxSp);
      p.wobble = Math.sin(p.phase) * deg(WK.wobbleDeg) * amt;
      p.stepSink = WK.stepSinkPx * Math.abs(Math.sin(p.phase)) * amt;       // 한 걸음마다 푹
      const stepN = Math.floor((p.phase + Math.PI / 2) / Math.PI);   // |sin| 최대(몸이 기울어 발이 닿고 푹 꺼지는 순간)마다 바뀜
      if (shallow && stepN !== p.stepN) {                  // 얕은 물: 한 걸음마다 발목 둘레 부드러운 파문 하나
        p.stepN = stepN;
        S.softRipples.push({ x: p.x, y: p.y, t: 0 });
        if (S.softRipples.length > 12) S.softRipples.shift();
      }
      if (stepN !== p.stepN && (p.mode === 'island' || (p.mode === 'floe' && p.floe))) {   // 발자국: 흙은 눌린 자국, 빙하는 긁힘 자국
        p.stepN = stepN;
        // 기운 쪽 발 하나: wobble>0 = 화면 오른쪽으로 기움 → 화면 오른쪽에 있는 발
        const FP = C.FOOTPRINTS, fx = Math.cos(p.face), fy = Math.sin(p.face), o = penH() * FP.stride / 2;
        const leftOnRight = -fy * rig.R[0] + fx * rig.R[1] >= 0, side = (Math.sin(p.phase) > 0) === leftOnRight ? 1 : -1;
        const ox = -fy * o * side, oy = fx * o * side;
        if (p.mode === 'island') {
          const slot = S.prints[S.printI++ % FP.max] || (S.prints[(S.printI - 1) % FP.max] = {});
          Object.assign(slot, { on: true, x: p.x + ox, y: p.y + oy, ang: p.face, side, t: 0 });
        } else {                                           // 빙하 좌표계에 저장 → 빙하와 함께 움직임
          const slot = S.icePrints[S.icePrintI++ % FP.ice.max] || (S.icePrints[(S.icePrintI - 1) % FP.ice.max] = {});
          Object.assign(slot, { on: true, cand: p.floe.cand, lx: p.lx + ox, ly: p.ly + oy, ang: p.face, side, t: 0 });
        }
      }
    } else if (inWater && !p.sliding && !(shallow && sp > 0.12)) {   // 물에 떠 있을 때 살짝 기우뚱
      p.wobble += (Math.sin(S.time * 2 * Math.PI / P.drift.rockPeriod) * deg(P.drift.rockDeg) - p.wobble) * ease(3, dt);
      p.stepSink = 0;
    } else { p.wobble *= Math.exp(-10 * dt); p.stepSink = (p.stepSink || 0) * Math.exp(-10 * dt); }
    // 해안 물결: 물이 올라온 곳에 서 있으면 작은 파문 + 느려짐
    p.inWash = p.mode === 'island' && !p.air && washDepthAt(p.x, p.y) > 0;
    if (p.inWash) { p.washRip = (p.washRip || 0) - dt; if (p.washRip <= 0) { p.washRip = C.SHORE_WASH.rippleEvery; S.washRipples.push({ x: p.x, y: p.y, t: 0 }); } }
    if (inWater) {
      if (sp > 0.3) {
        // 헤엄: 선(항적 호) 대신 부드러운 명암 얼룩을 0.12초 간격으로 남김
        const SS = WC().swimShade;
        p.shadeT = (p.shadeT || 0) - dt;
        if (deep && p.shadeT <= 0) {
          p.shadeT = SS.every;
          const hx = Math.cos(Math.atan2(p.vy, p.vx)), hy = Math.sin(Math.atan2(p.vy, p.vx));
          S.swimShade.push({ x: p.x - hx * 0.3, y: p.y - hy * 0.3, hx, hy, t: 0, bright: (S.shadeN = (S.shadeN || 0) + 1) % 3 === 0 });
          if (S.swimShade.length > SS.max) S.swimShade.shift();
        }
        if (!deep) emitWake(p, p.x - Math.cos(p.face) * 0.2, p.y - Math.sin(p.face) * 0.2, Math.atan2(p.vy, p.vx), sp, pm.maxSpeed.water, 0.22 * C.penguin.scale);
        // 헤엄 물보라: 물을 가르는 머리 양옆으로 작은 방울
        const SWS = C.SWIM_SPRAY;
        if (SWS && SWS.enabled && sp > SWS.minSpeed && !p.air) {
          p.sprayAcc = (p.sprayAcc || 0) + SWS.rate * (p.sliding ? SWS.slideMul : 1) * clamp((sp - SWS.minSpeed) / (pm.maxSpeed.water - SWS.minSpeed), 0, 1.5) * dt;
          const SD = C.SPLASH_DROPS, hx = p.vx / sp, hy = p.vy / sp; S.drops = S.drops || [];
          while (p.sprayAcc >= 1) { p.sprayAcc -= 1;
            const side = Math.random() < 0.5 ? 1 : -1, R = Math.random(), o = lerp(SWS.out[0], SWS.out[1], R), fw = (Math.random() - 0.8) * SWS.head, al = SWS.back ? -lerp(SWS.back[0], SWS.back[1], Math.random()) : (Math.random() * 2 - 0.7) * (SWS.along || 0);
            if (S.drops.length >= SD.max) S.drops.shift();
            S.drops.push({ x: p.x + hx * (SWS.head * 0.6 + fw) - hy * SWS.sideOffset * side, y: p.y + hy * (SWS.head * 0.6 + fw) + hx * SWS.sideOffset * side, z: 0.03,
              vx: -hy * side * o + p.vx * SWS.forward + hx * al, vy: hx * side * o + p.vy * SWS.forward + hy * al, vz: lerp(SWS.up[0], SWS.up[1], Math.random()) * (0.6 + 0.4 * R), size: lerp(SWS.size[0], SWS.size[1], Math.random() * Math.random()), t: 0 });
          }
        }
        // 몸 뒤로 촘촘하게 길게 이어지는 푸른 점 꼬리
        const SPK = C.FIREFLY.sparkle, dx = p.vx / sp, dy = p.vy / sp;
        p.swimAcc = (p.swimAcc || 0) + SPK.swimRate * clamp(sp / pm.maxSpeed.water, 0, 1) * dt;
        while (p.swimAcc >= 1) {
          p.swimAcc--;
          const back = 0.15 + Math.random() * 0.35, side = (Math.random() * 2 - 1) * SPK.swimSpread * (0.4 + back);
          spawnSpark(p.x - dx * back - dy * side, p.y - dy * back + dx * side, 0.03 + Math.random() * 0.15, lerp(SPK.swimLife[0], SPK.swimLife[1], Math.random()));
        }
      }
      else {
        p.lastEmit = null;
      }
    } else p.lastEmit = null;

    // 반영 일렁임 세기
    let rip = inWater && sp > 0.3 ? 0.35 : 0.08;
    for (const r of S.ripples) {
      const k = clamp(r.t / r.life, 0, 1), rad = r.maxR * (1 - Math.pow(1 - k, 3));     // 링이 지나갈 때 반영이 잔잔히 흔들림
      rip += (1 - k) * Math.max(0, 1 - Math.abs(Math.hypot(p.x - r.x, p.y - r.y) - rad) / 0.8);
    }
    p.ripple += (clamp(rip, 0, 1) - p.ripple) * ease(6, dt);
  }

  function startAir(p) {
    if (p.mode === 'floe' && !p.air) snowPuff(p.x, p.y, p.z, false);   // 빙하에서 뛰어오름: 눈가루
    if (p.sliding) { p.sliding = false; log('slideEnd'); }
    p.air = true; p.sit = false; p.jumpBase = p.z; p.jumpHS = 0; p.airT = 0;
    const f = p.mode === 'floe' ? p.floe : null;
    p.cvx = f ? f.vx : 0; p.cvy = f ? f.vy : 0;
    if (p.mode === 'water') ripple(p.x, p.y, 1.4, 1.2);
  }

  function setMode(mode, floe, vz = 0) {
    const p = S.p, prev = p.mode, W2 = WC();
    if (mode === 'water') S.wentWater = true;
    if (mode === 'floe' && (prev !== 'floe' || vz < -1 || p.floe !== floe)) snowPuff(p.x, p.y, p.z, vz < -2.5);   // 빙하에 올라섬·착지: 눈가루
    else if (prev === 'floe' && mode !== 'floe') snowPuff(p.x, p.y, p.z, false);                       // 빙하에서 내려섬
    p.mode = mode;
    if (mode === 'floe') {
      const changed = p.floe !== floe;
      p.floe = floe; p.lx = p.x - floe.x; p.ly = p.y - floe.y;
      if (vz < -1 || prev === 'water' || changed) {         // 착지·올라탐: 빙하가 살짝 가라앉았다 복원
        const startMass = Math.PI * baseRX() * baseRY() * P.floeDensity;
        const px = Math.min(W2.settle.maxPx, P.landingSinkPx * (vz < -1 ? 1 : 0.5) * Math.sqrt(startMass / floe.mass));
        floe.heave.v -= impulseFor(px);
        if (sim && vz < -1) sim.drop(floe.x, floe.y, Math.max(floe.rx, floe.ry) * 1.1, -SIM.body.landingImpulse * Math.sqrt(startMass / floe.mass));   // 착지 충격: 빙하 둘레 수면
      }
    } else p.floe = null;
    if (vz < -1 && mode !== 'water') p.heave.v -= impulseFor(P.landingSquashPx);   // 착지: 몸이 2px 눌렸다 돌아옴
    const wadeIn = mode === 'water' && prev === 'island' && vz >= -1 && depthAt(p.x, p.y) < C.DEPTH.wadeMax;   // 걸어 들어감: 가라앉는 입수 없음
    if (!wadeIn && (mode === 'water' && prev !== 'water' || (mode === 'water' && vz < -1))) {
      // 입수: 원형 물결 1회 + 낙하 속도에 비례해 가라앉았다 부력으로 떠오름 (물보라 없음)
      ripple(p.x, p.y, W2.splash.ringRadius, W2.splash.ringLife, W2.ripple.alpha * 1.4);
      const WE = P.waterEntry, depth = Math.min(WE.maxSinkBody * penH(), WE.minSink + WE.sinkPerSpeed * Math.abs(vz));
      p.dive.h = 0; p.dive.v = -impulseW(depth, 2 * Math.PI / WE.period, WE.dampingRatio);
      if (sim) sim.drop(p.x, p.y, SIM.body.penguinRadius * C.penguin.scale * 1.6, -SIM.body.entryImpulse * Math.abs(vz));
      splashDrops(p.x, p.y, Math.abs(vz));               // 둘레로 튀는 작은 물방울
      log('splash');
    }
    if (mode !== 'water' && prev === 'water') ripple(p.x, p.y, 1.2, 1.2, W2.ripple.alpha * 0.5);
    if (mode === 'island' && !S.finished) { S.finished = true; log('arrive'); }   // 도착 판정만 (화면 표시 없음)
  }

  function stepCamera(dt) {
    const p = S.p, f = p.floe, onF = p.mode === 'floe' && !p.air && f;
    const tvx = p.vx + (onF ? f.vx : 0), tvy = p.vy + (onF ? f.vy : 0);
    const kc = ease(C.camera.followRate, dt);
    cam.x += (p.x + tvx * C.camera.lead - cam.x) * kc;
    cam.y += (p.y + tvy * C.camera.lead - cam.y) * kc;
    if (!p.air) S.camGroundZ = p.mode === 'water' ? 0 : p.z;
    cam.z += ((S.camGroundZ || 0) - cam.z) * ease(3, dt);
    // 손을 뗀 뒤 잠시 지나면 다음 목표 방향으로 천천히 돌아옴
    const K = C.camera;
    let camHeld = false; for (const q of pointers.values()) if (q.role === 'camera') camHeld = true;
    if (K.autoTurn && !camHeld && S.time - S.lastCamTouch > K.autoTurnDelay && !S.finished) {
      const tg = turnTarget(), dx = tg[0] - p.x, dy = tg[1] - p.y, da = angDiff(cam.yawT, yawFromForward(dx, dy));
      // 일부러 크게 돌려 다른 쪽(열린 바다)을 보고 있으면 끌어오지 않음
      if (Math.hypot(dx, dy) > 3 && Math.abs(da) < deg(K.autoTurnMaxDeg)) cam.yawT += da * ease(K.autoTurnRate, dt);
    }
    // 기울기 복귀 (옵션)
    if (K.pitchReturn && !camHeld && S.time - S.lastCamTouch > K.pitchReturnDelay) cam.pitchT += (deg(K.pitchDeg) - cam.pitchT) * ease(K.pitchReturnRate, dt);
    const kr = ease(K.rotateSmooth, dt);
    cam.yaw += (cam.yawT - cam.yaw) * kr;
    cam.pitch += (cam.pitchT - cam.pitch) * kr;
    updateRig();
  }
  // 다음 목표: 반딧불이 웨이포인트
  function turnTarget() { return [S.ff.cx, S.ff.cy]; }
  // ── 반딧불이 길 안내: 경로 진행도 s 로 관리 ──
  function buildGuidePath(x, y) {
    const FF = C.FIREFLY, G = FF.guide, ff = S.ff, is = S.islands[0], route = FF.route;
    const last = route[route.length - 1], ly = last[1];
    const shore = is ? [is.shoreAt(ly) - is.side * G.shoreGap, ly] : last;   // 마지막: 해안선 바로 앞 수면
    const pts = [[x, y]].concat(route.slice(0, -1)).concat([shore]), cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    ff.path = pts; ff.cum = cum; ff.L = cum[cum.length - 1];
    ff.s = ff.sTarget = 0; ff.cx = x; ff.cy = y; ff.x = x; ff.y = y; ff.mode = 'mill'; ff.vis = 1; ff.respawn = 0; ff.swayS = 0;
    ff.lastDist = Math.hypot(S.p.x - x, S.p.y - y); ff.vApp = 0;
    for (let i = 0; i < 64; i++) { ff.hist[i * 2] = x; ff.hist[i * 2 + 1] = y; }
    for (const m of ff.members) { m.x = x; m.y = y; }
  }
  function pathAt(s) {
    const ff = S.ff, P2 = ff.path, cum = ff.cum;
    s = clamp(s, 0, ff.L);
    let i = 1; while (i < cum.length - 1 && cum[i] < s) i++;
    const u = (s - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]), a = P2[i - 1], b = P2[i];
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    return { x: a[0] + dx * u, y: a[1] + dy * u, tx: dx / l, ty: dy / l };
  }
  function projectOnPath(x, y) {
    const ff = S.ff, P2 = ff.path; let best = 0, bd = Infinity;
    for (let i = 1; i < P2.length; i++) {
      const a = P2[i - 1], b = P2[i], ex = b[0] - a[0], ey = b[1] - a[1], L2 = ex * ex + ey * ey || 1;
      const u = clamp(((x - a[0]) * ex + (y - a[1]) * ey) / L2, 0, 1), px = a[0] + ex * u, py = a[1] + ey * u, d = Math.hypot(x - px, y - py);
      if (d < bd) { bd = d; best = ff.cum[i - 1] + Math.sqrt(L2) * u; }
    }
    return best;
  }
  // 땅 위로 절대 올라가지 않게: 수심이 shoreMinDepth 이상인 물 위로 밀어냄
  function keepInWater(q) {
    const is = S.islands[0], md = C.FIREFLY.guide.shoreMinDepth;
    if (!is) return;
    for (let k = 0; k < 40 && depthAt(q.x, q.y) < md; k++) q.x -= is.side * 0.25;
  }
  // 물 엔진 수면 기울기 (없으면 0)
  function simGrad(x, y) {
    if (!sim) return [0, 0];
    const e = 0.15;
    return [(sim.sample(x + e, y) - sim.sample(x - e, y)) / (2 * e), (sim.sample(x, y + e) - sim.sample(x, y - e)) / (2 * e)];
  }
  // 경로 진행도 s 의 군집 중심이 화면에서 펭귄 머리보다 minScreen 이상 위에 보이는 최소 lead
  function screenLead(sPen, lead) {
    const ff = S.ff, p = S.p, LD = C.FIREFLY.guide.lead, [, py, pd] = project(p.x, p.y, p.z), head = py + penOffset() - penScale(pd) - LD.minScreen * H;
    if (!(LD.minScreen > 0)) return lead;                    // 화면 간격 조건 끔 (GRIS: 앞쪽 바다라 늘 머리보다 아래에 보임)
    let l = lead;
    while (l < LD.screenMaxLead && sPen + l < ff.L) {
      const q = pathAt(sPen + l), c = camSpace(q.x, q.y, -0.15);
      if (c[1] > rig.near && toScreen(c)[1] <= head) break;
      l += 0.35;
    }
    return l;
  }
  function stepFirefly(dt) {
    const F = C.FIREFLY, G = F.guide, LD = G.lead, SEP = G.separation, ff = S.ff, p = S.p;
    if (!S.intro.started || !ff.path) return;
    const dist = Math.hypot(p.x - ff.cx, p.y - ff.cy), spd = p.air ? Math.hypot(p.vx + (p.cvx || 0), p.vy + (p.cvy || 0)) : Math.hypot(p.vx, p.vy);
    ff.vApp += ((ff.lastDist - dist) / dt - ff.vApp) * ease(4, dt); ff.lastDist = dist;   // 다가오는 속도 (+)
    const sPen = projectOnPath(p.x, p.y);
    // lead: 속도에 비례, 화면 간격과 월드 간격 중 큰 쪽
    const lead = screenLead(sPen, clamp(LD.rest + LD.gain * spd, LD.min, LD.max));
    // GRIS: 시작 연출 동안은 정면 바다에서 밝아질 때까지 기다림 (펭귄이 lead 안으로 다가오면 평소처럼 물러남)
    const waitWater = C.intro.holdUntilWater && !S.wentWater;   // 펭귄이 물에 들어올 때까지 둥글게 맴돌며 기다림
    ff.hold = waitWater;
    const hold = (C.intro.holdFirefly && introVis() < 0.95 && dist > G.fleeTrigger) || waitWater;
    const sMin = hold ? ff.s : Math.min(ff.L, sPen + lead);
    // 펭귄이 군집을 확 지나침 (슬라이딩 등): 사라졌다가 펭귄 앞 lead 지점에서 다시 나타남. 가로지르는 이동 없음
    if (ff.respawn > 0) {
      ff.respawn -= dt; ff.vis = Math.max(0, ff.respawn / SEP.respawnFade);
      if (ff.respawn <= 0) {
        ff.s = ff.sTarget = Math.max(ff.s, sMin);
        const q = pathAt(ff.s), c0 = { x: q.x, y: q.y }; keepInWater(c0);
        ff.cx = ff.px = c0.x; ff.cy = ff.py = c0.y; ff.lastDist = Math.hypot(p.x - c0.x, p.y - c0.y);
        for (let i = 0; i < 64; i++) { ff.hist[i * 2] = c0.x; ff.hist[i * 2 + 1] = c0.y; }
        for (const m of ff.members) { m.x = m.px = c0.x; m.y = m.py = c0.y; m.vx = m.vy = 0; m.streak = 0; }
        ff.mode = ff.s >= ff.L - 0.05 ? 'shore' : 'mill'; log('fireflyRespawn');
      }
    } else {
      ff.vis = Math.min(1, (ff.vis ?? 1) + dt / SEP.respawnFade);
      if (dist < SEP.minDist && sPen > ff.s && ff.s < ff.L - 0.05) { ff.respawn = SEP.respawnFade; log('fireflyFade'); }
    }
    const atEnd = ff.s >= ff.L - 0.05;
    let snap = false;
    if (!ff.respawn && !atEnd) {
      if (dist < SEP.minDist) {                                // 하드 최소 간격: 완충 없이 즉시 펭귄 속도 × 1.3 으로 앞으로
        ff.s = Math.min(ff.L, ff.s + SEP.retreatMul * Math.max(spd, 0.6) * dt);
        ff.sTarget = Math.max(ff.sTarget, ff.s); ff.mode = 'flee'; ff.speed = Math.max(ff.speed || 0, SEP.retreatMul * spd); snap = true;
      } else if (dist < G.fleeTrigger && ff.mode !== 'flee' && !hold) {   // (물에 들어오기 전엔 물러나지 않고 맴돎) // 다가오면 경로를 따라 물러남 (천천히 오면 살짝, 빠르면 멀리)
        const va = Math.max(0, ff.vApp);
        ff.mode = 'flee'; ff.sTarget = Math.min(ff.L, Math.max(sMin, ff.s + clamp(G.fleeBase + G.fleeGain * va, G.fleeStepMin, G.fleeStepMax)));
        ff.speed = clamp(va * G.speedGain, G.speedMin, G.speedMax); log('fireflyFlee');
      }
      if (ff.sTarget < sMin) { ff.sTarget = sMin; if (ff.mode !== 'flee') { ff.mode = 'flee'; ff.speed = Math.max(G.speedMin, spd * 1.1); } }
      if (ff.mode === 'flee') {
        const rem = ff.sTarget - ff.s;
        let v = Math.min(Math.max(ff.speed, spd), Math.max(0.3, rem * 2.5));
        if (ff.s < sMin) v = Math.max(v, spd * SEP.retreatMul + (sMin - ff.s) * (LD.catchUp ?? 1.5));   // GRIS: 점프로 확 앞질러도 바로 따라잡게   // lead 보다 가까우면 펭귄보다 빠르게 따라잡아 앞섬
        ff.s = Math.min(ff.sTarget, ff.s + v * dt);           // 단조 증가
        if (ff.sTarget - ff.s < 0.02) ff.mode = ff.s >= ff.L - 0.05 ? 'shore' : 'mill';
      }
    }
    if (ff.s >= ff.L - 0.05) ff.mode = 'shore';
    ff.i = Math.min(F.route.length - 1, ff.cum.findIndex((c) => c >= ff.s));
    const pt = pathAt(ff.s), nx = -pt.ty, ny = pt.tx, SH = G.shore, is = S.islands[0];
    let tgt;
    if (ff.mode === 'shore') {
      // 해안: 중심 고정 + 파도 위상 따라 법선 방향 ±swayAmp (올라오면 해안 쪽, 빠지면 바다 쪽)
      const lvl = washLevelAt(pt.x, pt.y);
      ff.swayS = (ff.swayS || 0) + (SH.swayAmp * (2 * lvl - 1) - (ff.swayS || 0)) * ease(1.5, dt);
      tgt = { x: pt.x + (is ? is.side : 0) * ff.swayS, y: pt.y };
    } else tgt = { x: pt.x + nx * G.sway * Math.sin(ff.s * 0.8 + S.time * 0.25), y: pt.y + ny * G.sway * Math.sin(ff.s * 0.8 + S.time * 0.25) };
    keepInWater(tgt);
    const k = snap ? ease(8, dt) : ease(ff.mode === 'shore' ? 1.2 : 2.2, dt);   // 모드가 바뀌어도 같은 빠르기로 따라가 덜컥거리지 않게
    ff.cx += (tgt.x - ff.cx) * k; ff.cy += (tgt.y - ff.cy) * k;
    const c0 = { x: ff.cx, y: ff.cy }; keepInWater(c0); ff.cx = c0.x; ff.cy = c0.y;
    ff.x = ff.cx; ff.y = ff.cy;
    // 점마다 반응 지연: 중심의 지난 위치를 따라가며 각자 반경 안에서 맴돎 (앞쪽 반원으로 치우침)
    ff.histI = (ff.histI + 1) % 64; ff.hist[ff.histI * 2] = ff.cx; ff.hist[ff.histI * 2 + 1] = ff.cy;
    const penR = penH() * 0.6 + SEP.memberGap;
    // 해안 궤도 축: 해안선 방향(장축) · 법선
    let stx = 0, sty = 1;
    if (is && ff.mode === 'shore') { stx = is.shoreAt(pt.y + 0.5) - is.shoreAt(pt.y - 0.5); const l = Math.hypot(stx, 1); stx /= l; sty = 1 / l; }
    else if (ff.hold) { stx = 1; sty = 0; }                      // 기다리는 동안: 같은 궤도 운동 (화면 가로가 장축)
    for (const m of ff.members) {
      let tx, ty;
      if (ff.mode === 'shore' || ff.hold) {
        if (m.orbR == null) { m.orbR = lerp(SH.orbitR[0], SH.orbitR[1], Math.random()); m.orbW = lerp(SH.orbit[0], SH.orbit[1], Math.random()) * (Math.random() < 0.7 ? 1 : -1); m.orb = Math.random() * 6.283; m.wox = 0; m.woy = 0; }
        m.orb += m.orbW * dt;
        const rr = m.orbR * (1 + 0.35 * noise1(S.time * 0.17 + m.ph * 4.3));   // 반경이 느리게 숨쉬어 똑같은 원이 되지 않게
        const ca = Math.cos(m.orb) * rr * SH.ellipse, sa = Math.sin(m.orb) * rr;
        // 수면 기울기에 실리고 curl 노이즈로 휨 → 제자리로 서서히 돌아옴
        const WF = SH.waveFollow, gr = simGrad(m.x, m.y), fa = flowAng(m.x, m.y, S.time);
        m.wox = (m.wox + (-gr[0] * WF.slope + Math.cos(fa) * WF.curl) * dt) * Math.exp(-WF.decay * dt);
        m.woy = (m.woy + (-gr[1] * WF.slope + Math.sin(fa) * WF.curl) * dt) * Math.exp(-WF.decay * dt);
        tx = ff.cx + stx * ca + sty * sa + m.wox; ty = ff.cy + sty * ca - stx * sa + m.woy;
      } else {
        const back = Math.round(m.delay * P.hz) % 64, hi = ((ff.histI - back) % 64 + 64) % 64;
        // 원을 그리며 돌지 않고(로딩 표시처럼 보여서) 각자 느리게 떠다님: 축마다 다른 박자의 노이즈
        const wf = 0.1 + Math.abs(m.w) * 0.35, tt = S.time * wf;
        const along = noise1(tt + m.ph * 3.1) * m.rad * 1.5 + m.rad * 0.6 * SEP.frontBias, lat = noise1(tt * 0.83 + m.ph * 5.7 + 31) * m.rad * 1.4;
        tx = ff.hist[hi * 2] + pt.tx * along + nx * lat + Math.sin(S.time * 0.3 + m.ph) * m.wob;
        ty = ff.hist[hi * 2 + 1] + pt.ty * along + ny * lat + Math.cos(S.time * 0.27 + m.ph) * m.wob;
      }
      const km = ease(2.2, dt); m.x += (tx - m.x) * km; m.y += (ty - m.y) * km;
      // 점별 분리: 펭귄 반경 + memberGap 안으로는 못 들어옴
      const ddx = m.x - p.x, ddy = m.y - p.y, dd = Math.hypot(ddx, ddy);
      if (dd < penR) { const ux = dd > 1e-3 ? ddx / dd : pt.tx, uy = dd > 1e-3 ? ddy / dd : pt.ty; m.x = p.x + ux * penR; m.y = p.y + uy * penR; }
      keepInWater(m);
      // 속도와 진행 방향 (빛 구름이 길쭉해지는 방향, 빠를 때 꼬리)
      const mvx = (m.x - m.px) / dt, mvy = (m.y - m.py) / dt; m.px = m.x; m.py = m.y;
      m.vx += (mvx - m.vx) * ease(6, dt); m.vy += (mvy - m.vy) * ease(6, dt);
      const spm = Math.hypot(m.vx, m.vy);
      if (spm > 0.15) m.ang = Math.atan2(m.vy, m.vx);
      const SK = F.streak, want = clamp((spm - 0.8) / SK.speedRef, 0, 1);
      m.streak = want > m.streak ? want : Math.max(want, m.streak - dt / SK.life);
    }
    // 움직이면 지나간 자리에 아주 은은한 빛을 조금 남김
    const v = Math.hypot(ff.cx - ff.px, ff.cy - ff.py) / dt; ff.px = ff.cx; ff.py = ff.cy;
    if (v > 0.4) {
      ff.trailAcc += F.sparkle.trailRate * dt;
      while (ff.trailAcc >= 1) { ff.trailAcc--; const m = ff.members[(Math.random() * ff.members.length) | 0]; spawnSpark(m.x, m.y, m.depth, lerp(F.sparkle.trailLife[0], F.sparkle.trailLife[1], Math.random())); }
    }
    for (const s of S.spark) if (s.on && (s.t += dt) >= s.life) s.on = false;
  }
  // 푸른 점 풀 (최대 150, 가장 오래된 것부터 재사용)
  function spawnSpark(x, y, depth, life, z0 = 0) {
    let on = 0; for (const q of S.spark) if (q.on) on++;
    if (on >= (C.FIREFLY.sparkle.maxActive || 1e9)) return;   // 동시에 12개 이하
    const SP = C.FIREFLY.sparkle, s = S.spark[S.sparkI++ % S.spark.length];
    Object.assign(s, { on: true, x, y, depth, z0, life, t: 0, size: lerp(SP.size[0], SP.size[1], Math.random()), hue: (Math.random() * 3) | 0 });
  }

  // ── 해안 물결 ─────────────────────────────────────────
  // 해안선을 0.5 간격 구간으로 나눠 구간마다 도착 지연·세기를 다르게. 파도는 2~3번 연달아 오는 묶음
  function washShape() {
    if (S.wash) return S.wash;
    const is = S.islands[0], Wsh = C.SHORE_WASH, raw = [];
    is.shape.forEach(([x, y]) => {
      let nx = (x - is.cx) / (is.rx * is.rx), ny = (y - is.cy) / (is.ry * is.ry); const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
      if (nx * -is.side > 0.05) raw.push({ x, y, nx, ny });                // 바다를 향한 쪽만
    });
    raw.sort((a, b) => a.y - b.y);
    const segs = [];
    let acc = 0;
    for (let i = 0; i < raw.length - 1; i++) {
      const a = raw[i], b = raw[i + 1], len = Math.hypot(b.x - a.x, b.y - a.y);
      for (let s = 0; s < len; s += Wsh.segment) {
        const u = s / len, nx = lerp(a.nx, b.nx, u), ny = lerp(a.ny, b.ny, u), nl = Math.hypot(nx, ny) || 1;
        segs.push({ x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u), nx: nx / nl, ny: ny / nl, s: acc + s, reach: 0, wetExt: 0, wetT: 99, peak: 0, mark: 0, markA: 0, falling: false,
          str: 1 + Wsh.strengthVar * noise1((acc + s) * 0.33 + 17.1) });
      }
      acc += len;
    }
    // 파면 도착 시차: 바다 쪽 직선에서 같은 때 출발 → 해안선이 바다 쪽으로 튀어나온(곶) 만큼 일찍 도착
    for (const q of segs) q.prot = (q.x - is.shoreX) * -is.side;
    return (S.wash = { is, segs, waves: [], nextSet: 0.5, rivs: [], level: 0, table: trainTable() });
  }
  // 수심 → 이동 시간 표: T(d) = ∫ dd / (c0 √수심). 해안선에서 d 떨어진 곳의 파면이 해안에 닿기까지 남은 시간
  function trainTable() {
    const TR = C.SHORE_WASH.train, D = C.DEPTH, step = 0.05, n = Math.ceil(TR.startDist / step) + 1, T = new Float32Array(n);
    const dep = (d) => Math.max(TR.minDepth, Math.pow(smooth(0, D.slope, d), D.power));
    const vMin = C.SHORE_WASH.swash ? C.SHORE_WASH.swash.speedShoreMin : 0;   // 해안 근처에서 느려지지 않게 속도 하한
    for (let i = 1; i < n; i++) { const d = (i - 0.5) * step; T[i] = T[i - 1] + step / Math.max(vMin, TR.speedDeep * Math.sqrt(dep(d))); }
    return { T, step, n, dep, Tmax: T[n - 1] };
  }
  // 남은 시간 τ → 해안선에서의 거리 d (표 이분 탐색)
  function trainDist(tb, tau) {
    if (tau <= 0) return 0;
    if (tau >= tb.Tmax) return (tb.n - 1) * tb.step;
    let lo = 0, hi = tb.n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (tb.T[m] < tau) lo = m; else hi = m; }
    return (lo + (tau - tb.T[lo]) / Math.max(1e-6, tb.T[hi] - tb.T[lo])) * tb.step;
  }
  // 파도 w 가 구간 q 의 물가에 닿는 시각
  const waveArrive = (w, q) => w.t0 - q.prot / C.SHORE_WASH.train.speedDeep + 0.15 * noise1(q.s * 0.21 + w.seed);
  // 묶음 예약: t0 = 물가 도착 시각. 바다 쪽 먼 곳에서 미리 보이도록 이동 시간만큼 앞서 만듦
  function scheduleWaves(ws) {
    const TR = C.SHORE_WASH.train, ahead = ws.table.Tmax + 4;
    while (S.time + ahead >= ws.nextSet) {
      const big = Math.random() < TR.bigChance;
      const n = big ? 1 : TR.count[0] + ((Math.random() * (TR.count[1] - TR.count[0] + 1)) | 0);
      for (let i = 0; i < n; i++) {
        const amp = big ? TR.bigAmp : lerp(TR.amp[0], TR.amp[1], Math.random()) * (i === 0 ? 0.9 : 1);
        const SW = C.SHORE_WASH.swash;
        ws.waves.push({ t0: ws.nextSet + i * TR.gap * (0.9 + 0.2 * Math.random()), amp, big, seed: Math.random() * 100, tl: lerp(TR.tongueLength[0], TR.tongueLength[1], Math.random()),
          tu: SW ? lerp(SW.rise[0], SW.rise[1], Math.random()) : 0, td: SW ? lerp(SW.fall[0], SW.fall[1], Math.random()) : 0 });
      }
      const lull = lerp(TR.setInterval[0], TR.setInterval[1], Math.random());
      ws.nextSet += (n - 1) * TR.gap + (C.SHORE_WASH.swash ? Math.min(C.SHORE_WASH.swash.lullMax, lull) : lull);
    }
  }
  // 새 끝선 모델: 올라올 때 1−(1−t/Tu)², 머묾, 빠질 때 1−(t/Td)^fallExp
  function swashEnv(tau, w) {
    const SW = C.SHORE_WASH.swash;
    if (tau <= 0) return 0;
    if (tau < w.tu) { const u = 1 - tau / w.tu; return 1 - u * u; }
    tau -= w.tu;
    if (tau < SW.hold) return 1;
    tau -= SW.hold;
    if (tau < w.td) return 1 - Math.pow(tau / w.td, SW.fallExp);
    return 0;
  }
  function waveEnv(tau) {
    const Wsh = C.SHORE_WASH;
    if (tau <= 0) return 0;
    if (tau < Wsh.rise) return 1 - Math.pow(1 - tau / Wsh.rise, 3);                      // 빠르게 올라옴 (ease-out)
    tau -= Wsh.rise;
    if (tau < Wsh.hold) return 1;                                                          // 정점에서 잠깐 머묾
    tau -= Wsh.hold;
    if (tau < Wsh.fall) { const k = tau / Wsh.fall; return 1 - k * k * (3 - 2 * k); }      // 천천히 빠지며 스밈
    return 0;
  }
  // 물가에 닿을 때의 진폭 배율 (얕아지며 커진 만큼, 상한 shoalMax)
  const shoreShoal = () => { const TR = C.SHORE_WASH.train; return Math.min(TR.shoalMax, Math.pow(TR.minDepth * 2, -TR.shoal)); };
  function stepWash(dt) {
    const ws = washShape(), Wsh = C.SHORE_WASH, TR = Wsh.train, max = Wsh.shoreWidth * Wsh.reach;
    scheduleWaves(ws);
    ws.waves = ws.waves.filter((w) => S.time - w.t0 < 30);
    const bigMax = Wsh.shoreWidth * TR.bigReach;
    let lv = 0;
    const B = Wsh.bins, maxIn = max * Wsh.binReach, SW = Wsh.swash;
    if (SW) {                                                  // 새 끝선 모델 + 임계 감쇠 스프링, 젖음·물막은 연속 경계
      const om = 2 * Math.PI * SW.smoothHz, ex = Math.exp(-om * dt);
      for (const q of ws.segs) {
        let r = 0, tgt = 0;
        for (const w of ws.waves) {
          const e = swashEnv(S.time - waveArrive(w, q), w);
          if (e <= 0) continue;
          r = Math.max(r, e);
          const tg = 1 + TR.tongue * noise1(q.s / w.tl + w.seed);   // 파도마다 고정된 혀 모양 (프레임마다 안 바뀜)
          tgt = Math.max(tgt, Math.min(w.big ? bigMax : Infinity, e * w.amp * q.str * tg * max));
        }
        if (q.sx == null) { q.sx = tgt; q.sv = 0; q.wetR = 0; q.filmR = 0; q.peak = 0; }
        const e0 = q.sx - tgt, tmp = (q.sv + om * e0) * dt;   // 임계 감쇠 스프링 (해석해, dt 와 무관하게 안정)
        q.sx = tgt + (e0 + tmp) * ex; q.sv = (q.sv - om * tmp) * ex;
        const reach = Math.max(0, q.sx);
        if (q.sv > 0.02) q.peak = Math.max(q.peak, reach); else if (reach < 0.02) q.peak = 0;
        q.foam = q.sv > 0.05 ? Math.min(1, (q.foam || 0) + dt * 8) : Math.max(0, (q.foam || 0) - dt / Wsh.foam.life);
        q.thin = q.sv > 0 || q.peak <= 0 ? 1 : Math.pow(clamp(reach / q.peak, 0, 1), SW.thinExp);   // 빠질수록 얇아짐
        q.wetR = Math.max(reach, q.wetR - dt * max / Wsh.dryTime);    // 먼 곳부터 마름
        q.filmR = Math.max(reach, q.filmR - dt * max / Wsh.filmTime);
        q.reach = reach; q.level = r; lv = Math.max(lv, r);
      }
    } else for (const q of ws.segs) {
      // swash: 파면 진폭에 비례해 올라옴. 구간별 ±30% + 파도마다 혀 모양 요철
      let r = 0, reach = 0;
      for (const w of ws.waves) {
        const e = waveEnv(S.time - waveArrive(w, q));
        if (e <= 0) continue;
        r = Math.max(r, e);
        const tg = 1 + TR.tongue * noise1(q.s / w.tl + w.seed);
        reach = Math.max(reach, Math.min(w.big ? bigMax : Infinity, e * w.amp * q.str * tg * max));
      }
      q.foam = reach > (q.reach || 0) + 1e-4 ? 1 : Math.max(0, (q.foam || 0) - dt / Wsh.foam.life);   // 올라오는 동안 거품, 이후 서서히 사라짐
      q.reach = reach; q.level = r;
      lv = Math.max(lv, r);
      // 젖음 맵: 물이 닿은 칸은 1, 이후 dryTime 동안 옅어짐 (가장 최근이 가장 진함). 물막은 filmTime 동안
      if (!q.wet || q.wet.length !== B) { q.wet = new Float32Array(B); q.film = new Float32Array(B); }
      for (let b = 0; b < B; b++) {
        const dep = (b + 0.5) / B * maxIn;
        if (q.reach > dep) { q.wet[b] = 1; q.film[b] = 1; }
        else { q.wet[b] = Math.max(0, q.wet[b] - dt / Wsh.dryTime); q.film[b] = Math.max(0, q.film[b] - dt / Wsh.filmTime); }
      }
    }
    ws.level = lv;
    // 물 끝선을 따라 반짝이는 푸른 점 (펭귄 근처 해안)
    const SPK = C.FIREFLY.sparkle;
    S.shoreAcc = (S.shoreAcc || 0) + SPK.shoreRate * dt;
    while (S.shoreAcc >= 1) {
      S.shoreAcc--;
      const near = ws.segs.filter((q) => q.reach > 0.05 && Math.abs(q.y - S.p.y) < 14);
      if (!near.length) break;
      const q = near[(Math.random() * near.length) | 0], dep = q.reach * (0.6 + 0.45 * Math.random());
      spawnSpark(q.x - q.nx * dep, q.y - q.ny * dep, 0.01, lerp(SPK.shoreLife[0], SPK.shoreLife[1], Math.random()), terrainHeightAt(q.x - q.nx * dep, q.y - q.ny * dep) + 0.01);
    }
  }
  // 물가에서 안쪽으로 몇 만큼 물이 덮였는지 (>0 이면 물 속)
  function washDepthAt(x, y) {
    if (sim && SIM.shore.draw) return sim.filmAt(x, y) > SIM.shore.filmMin ? 1 : -1;
    const ws = washShape(); if (!ws.segs.length) return -1;
    let best = null, bd = Infinity;
    for (const q of ws.segs) { const d = Math.hypot(q.x - x, q.y - y); if (d < bd) { bd = d; best = q; } }
    const inland = (best.x - x) * best.nx + (best.y - y) * best.ny;
    return best.reach - inland;
  }

  // 물 엔진 한 단계: 격자를 펭귄 앞쪽에 맞추고, 빙하·펭귄이 밀어낸 물을 넣은 뒤 파동 계산
  function stepSim(dt) {
    if (!sim) return;
    const p = S.p, B = SIM.body, ld = SIM.size * SIM.lead;
    sim.recenter(p.x - Math.sin(cam.yaw) * ld, p.y - Math.cos(cam.yaw) * ld, simTerrain);
    sim.begin();
    for (const f of S.floePool) {
      if (!f.active) { if (f._w) sim.body(f, null); continue; }
      sim.body(f, { x: f.x, y: f.y, rx: f.rx, ry: f.ry, draft: Math.max(0.02, B.floeDraft - f.heave.h / B.floeHeavePx), solid: true, gain: B.gain * clamp(Math.hypot(f.vx, f.vy) / B.floeSpeedRef, 0, 1) });   // 멈춘 빙하는 고리 없음
    }
    { const r = B.penguinRadius * C.penguin.scale, hh = penH();          // 물 밖에 있어도 계속 추적 (잠긴 부피 0) → 들어가는 순간부터 물을 밀어냄
      sim.body(p, { x: p.x, y: p.y, rx: r, ry: r, zc: p.z + hh * (0.5 - (p.sink || 0)), rz: hh * 0.45, gain: B.gain * clamp(Math.hypot(p.vx, p.vy) / B.speedRef, 0, 1) }); }   // 멈춰 떠 있으면 고리 없음, 입수 충격은 drop 으로
    // 해안으로 밀려오는 파도 묶음 (해안이 격자 안에 있을 때만)
    if (sim.hasShore && SIM.shore.wave.amp > 0) {
      const WV = SIM.shore.wave, sw = S.simWave || (S.simWave = { next: 1.5, left: 0, seed: 0 });
      sw.next -= dt;
      if (sw.next <= 0) {
        if (sw.left <= 0) sw.left = Math.round(lerp(WV.count[0], WV.count[1], Math.random()));
        sw.left--;
        sw.next = sw.left > 0 ? WV.gap * (0.85 + 0.3 * Math.random()) : lerp(WV.setInterval[0], WV.setInterval[1], Math.random());
        const sd0 = (sw.seed += 7.3), k = 1 / WV.varLength, a0 = 0.75 + 0.5 * Math.random();
        sim.shoreWave(WV.offshore, WV.width, WV.amp * a0, (x, y) => Math.max(0, 1 + WV.ampVar * 2 * noise2(y * k + sd0, x * k * 0.3)));
      }
    }
    sim.step(dt);
  }
  // 물 엔진용 지형: [수심 0~1, 해안선까지 거리(+바다, −뭍)]
  function simTerrain(x, y, o) {
    const d = shoreDist(x, y);
    if (d === Infinity) { o[0] = 1; o[1] = 1e9; return; }
    if (d <= 0) { const SHc = SIM.shore, kb = 1 / SHc.bumpLength; o[0] = 0; o[1] = d * (1 + SHc.bumpy * noise2(y * kb + 3.1, x * kb)); return; }   // 모래 높낮이가 고르지 않아 물이 혀 모양으로 올라옴
    o[1] = d; o[0] = Math.pow(smooth(0, C.DEPTH.slope, d), C.DEPTH.power);
  }

  function step(dt) {
    S.time += dt; S.stepN++;
    const now = performance.now();
    for (const ptr of pointers.values()) if (ptr.role === 'action' && !ptr.long && now - ptr.t0 >= C.input.longPressMs) { ptr.long = true; S.lastTapUp = 0; }
    updateIntro(dt);
    stepFloes(dt);
    stepPenguin(dt);
    stepCamera(dt);
    stepSim(dt);
    stepFirefly(dt);
    if (IT) { stepLandFireflies(dt); stepSnow(dt); }
    stepDrops(dt);
    if (S.stepN % 12 === 0) manageField();
    { const RP = WC().ripple, SPK = C.FIREFLY.sparkle;
      S.ripples = S.ripples.filter((r) => (r.t += dt) < r.life + (RP.rings - 1) * RP.ringGap);
      for (const r of S.ripples) {                               // 파문 링 위에서도 푸른 점이 반짝
        if (r.t > r.life || Math.random() > SPK.ringRate * dt) continue;
        const k = r.t / r.life, rad = r.maxR * (1 - Math.pow(1 - k, 3)), th = Math.random() * 6.283;
        spawnSpark(r.x + Math.cos(th) * rad, r.y + Math.sin(th) * rad, 0.05, SPK.waveLife);
      } }
    stepStreams(dt);
    const life = WC().wake.life;
    for (const w of S.wake) if (w.on && (w.t += dt) >= life) w.on = false;
    S.vortex = S.vortex.filter((v) => (v.t += dt) < WC().curve.vortex.life);
    if (S.grooves) { for (const q of S.grooves) q.t += dt; while (S.grooves.length && S.grooves[0].t >= C.PHYSICS.toboggan.groove.life) S.grooves.shift(); }
    for (const q of S.prints) if (q.on && (q.t += dt) >= (C.FOOTPRINTS.sand ? Math.max(C.FOOTPRINTS.sand.life, C.FOOTPRINTS.forest.life) : C.FOOTPRINTS.life)) q.on = false;
    S.softRipples = S.softRipples.filter((q) => (q.t += dt) < P.water.stepRipple.life);
    S.swimShade = S.swimShade.filter((q) => (q.t += dt) < WC().swimShade.life);
    for (const q of S.icePrints) if (q.on && (q.t += dt) >= C.FOOTPRINTS.ice.life) q.on = false;
    { // 빙하 위 슬라이딩: 끊기지 않는 가는 활주 자국 (빙하 좌표계)
      const p = S.p, ST = C.FOOTPRINTS.slideTrail;
      for (const q of S.slideTrail) q.t += dt;
      while (S.slideTrail.length && S.slideTrail[0].t >= ST.life) S.slideTrail.shift();
      if (p.sliding && p.mode === 'floe' && p.floe && !p.air) {
        const last = S.slideTrail[S.slideTrail.length - 1];
        if (!last || last.stroke !== p.slideStroke || last.cand !== p.floe.cand || Math.hypot(last.lx - p.lx, last.ly - p.ly) >= ST.spacing) {
          S.slideTrail.push({ cand: p.floe.cand, lx: p.lx, ly: p.ly, t: 0, stroke: p.slideStroke });
          if (S.slideTrail.length > ST.max) S.slideTrail.shift();
        }
      }
    }
    S.washRipples = S.washRipples.filter((q) => (q.t += dt) < 1.2);
    if (!(sim && SIM.shore.draw)) stepWash(dt);
  }

  // ── 그리기 ──────────────────────────────────────────────
  // 출렁임(px)은 화면 세로 오프셋. 위로 뜨면 음수
  function floeOffset(f) { return -f.heave.h; }
  function penOffset() {
    const p = S.p;
    let h = p.heave.h - (p.stepSink || 0);
    if (p.mode === 'floe' && p.floe && !p.air) {
      const lag = Math.round(WC().bob.penguinLag * P.hz), hist = p.floe.hist;
      h += hist[((S.stepN - lag) % 64 + 64) % 64];           // 빙하보다 0.25초 늦게 따라감
    }
    return -h;
  }
  // 지면 위 원 → 화면 타원 (원근 근사)
  function groundEllipse(x, y, r, z = 0) {
    const c = project(x, y, z);
    if (c[2] < rig.near + 0.15) return null;
    const a = project(x + rig.R[0] * r, y + rig.R[1] * r, z);
    const b = project(x + rig.F[0] * r, y + rig.F[1] * r, z), b2 = camSpace(x - rig.F[0] * r, y - rig.F[1] * r, z);
    const ry = b2[1] > rig.near ? Math.abs(toScreen(b2)[1] - b[1]) / 2 : Math.abs(c[1] - b[1]);
    return { x: c[0], y: b2[1] > rig.near ? (b[1] + toScreen(b2)[1]) / 2 : c[1], rx: Math.abs(a[0] - c[0]), ry, d: c[2] };
  }
  function groundSprite(img, x, y, r, alpha) {
    if (alpha <= 0.003) return;
    const e = groundEllipse(x, y, r);
    if (!e || e.x + e.rx < 0 || e.x - e.rx > W || e.y + e.ry < 0 || e.y - e.ry > H) return;
    const a = alpha * (1 - fogAt(e.d));
    if (a <= 0.003) return;
    ctx.globalAlpha = Math.min(1, a);
    const ry = e.ry * groundLift();                          // 낮은 각도: 세로만 키움
    ctx.drawImage(img, e.x - e.rx, e.y - ry, e.rx * 2, ry * 2);
  }
  // 앞으로 나아가는 정도 (카메라에서 멀어지는 방향이면 1)
  const forwardness = (dx, dy) => { const l = Math.hypot(dx, dy) || 1; return clamp((dx * rig.F[0] + dy * rig.F[1]) / l, 0, 1); };

  // 하늘·수평선: 위는 조금 더 밝은 미색, 수평선 근처는 안개 띠
  function drawSky() {
    const hz = rig.horizon, top = rgbS(PAL.skyTop), hzc = rgbS(PAL.skyHorizon);
    ctx.fillStyle = COL.bg; ctx.fillRect(0, 0, W, H);
    // 하늘: 위 → 수평선으로 밝아짐. 수평선 아래로는 먼 수면이 같은 색으로 이어지다 바다색으로
    const y0 = Math.min(0, hz - H * 0.6), y1 = hz + H * 0.22, g = ctx.createLinearGradient(0, y0, 0, y1), kh = (hz - y0) / (y1 - y0);
    g.addColorStop(0, `rgba(${top},1)`); g.addColorStop(clamp(kh, 0.01, 0.98), `rgba(${hzc},1)`); g.addColorStop(1, `rgba(${hzc},0)`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, Math.max(0, y1));
  }

  // 별: 하늘에 아주 작은 점이 반짝임 (카메라가 좌우로 돌면 같이 흐름, 수평선 위에만)
  const starList = (() => { const ST = C.STARS; if (!ST) return []; const r = rng(ST.seed); return Array.from({ length: ST.count }, () => ({ u: r(), e: Math.pow(r(), 1.6), s: lerp(ST.size[0], ST.size[1], Math.pow(r(), 2)), a: lerp(ST.alpha[0], ST.alpha[1], r()), f: lerp(ST.twinkle[0], ST.twinkle[1], r()), ph: r() * 6.283 })); })();
  function drawStars() {
    const ST = C.STARS; if (!ST) return;
    const hz = rig.horizon, span = W * ST.spread, shift = (cam.yaw / (Math.PI * 2)) * span * 2;
    ctx.fillStyle = `rgb(${ST.color.join(',')})`;
    for (const s of starList) {
      const y = hz - lerp(ST.minElev, ST.maxElev, s.e) * H; if (y < -2 || y > hz - 2) continue;
      const x = ((s.u * span - shift) % span + span) % span - (span - W) / 2; if (x < -2 || x > W + 2) continue;
      const tw = 1 - ST.depth * (0.5 + 0.5 * Math.sin(S.time * s.f * 6.283 + s.ph));
      ctx.globalAlpha = s.a * tw * smooth(0, 0.08, (hz - y) / H);   // 수평선 근처는 안개에 묻힘
      ctx.beginPath(); ctx.arc(x, y, s.s, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // 1차원 값 노이즈 (부드럽게 보간)
  const hash1 = (i) => { const s = Math.sin(i * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
  const noise1 = (x) => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return lerp(hash1(i), hash1(i + 1), u) * 2 - 1; };

  // 2차원 값 노이즈와 유동장
  const hash2 = (i, j) => { const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return s - Math.floor(s); };
  function noise2(x, y) {
    const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    return lerp(lerp(hash2(i, j), hash2(i + 1, j), ux), lerp(hash2(i, j + 1), hash2(i + 1, j + 1), ux), uy) * 2 - 1;
  }
  const flowAng = (x, y, t) => { const K = WC().streams; return noise2(x * K.fieldScale + t * K.morph, y * K.fieldScale - t * K.morph * 0.7) * Math.PI * K.curl; };
  // 장애물(빙하·수영하는 펭귄) 주변에서는 윤곽을 따라 감돌도록 접선 성분을 섞은 흐름 방향
  function flowAvoid(x, y, t, off = 0) {
    const K = WC().streams;
    let a = flowAng(x, y, t) + off, bx = Math.cos(a), by = Math.sin(a);
    for (const o of S.obstacles || []) {
      const dx = x - o.x, dy = y - o.y, d = Math.hypot(dx, dy) || 1e-3;
      if (d > o.r * K.avoid) continue;
      const rx = dx / d, ry = dy / d; let tx = -ry, ty = rx;
      if (tx * bx + ty * by < 0) { tx = -tx; ty = -ty; }
      const w = 1 - smooth(o.r, o.r * K.avoid, d), push = d < o.r ? 0.6 : 0;
      bx = bx * (1 - w) + tx * w + rx * push; by = by * (1 - w) + ty * w + ry * push;
    }
    return Math.atan2(by, bx);
  }
  function updateObstacles() {
    const p = S.p, obs = activeFloes().map((f) => ({ x: f.x, y: f.y, r: f.R }));
    if (p.mode === 'water' && !p.air) obs.push({ x: p.x, y: p.y, r: penH() * 0.4 });
    S.obstacles = obs;
  }

  // ② 중간 물결선: 짧은 선 70% + 긴 선 30%, 흐름 방향 ±60° 분산, 수명 2~6초 (풀 재사용)
  function spawnStream(sl) {
    const K = WC().streams;
    for (let tries = 0; tries < 6; tries++) {
      const d = lerp(K.depth[0], K.depth[1], Math.pow(Math.random(), 0.8)), half = d * W / (2 * rig.f) * 1.1, lat = (Math.random() * 2 - 1) * half;
      let x = rig.cx + rig.F[0] * d + rig.R[0] * lat, y = rig.cy + rig.F[1] * d + rig.R[1] * lat;
      if (floeAt(x, y) || islandAt(x, y)) continue;
      // 원근: 먼 곳은 짧게, 가까운 곳은 길게
      const longOne = Math.random() > K.shortShare, LR = longOne ? K.longLen : K.shortLen;
      const len = lerp(LR[0], LR[1], Math.random()) * clamp(1.35 - d / 40, 0.5, 1.3);
      const n = Math.max(3, Math.round(len / K.stepLen)), off = deg((Math.random() * 2 - 1) * K.dirSpread), pts = [[x, y]];
      for (let s = 0; s < n; s++) { const a = flowAvoid(x, y, S.time, off); x += Math.cos(a) * K.stepLen; y += Math.sin(a) * K.stepLen; pts.push([x, y]); }
      Object.assign(sl, { on: true, pts, t: 0, life: lerp(K.life[0], K.life[1], Math.random()), a: lerp(K.alpha[0], K.alpha[1], Math.random()),
        off, spd: lerp(K.speed[0], K.speed[1], Math.random()) });
      return;
    }
    sl.on = false;
  }
  function stepStreams(dt) {
    updateObstacles();
    const K = WC().streams, lim = Math.max(10, Math.round(K.max * S.quality));
    while (S.streams.length < K.max) S.streams.push({ on: false, t: 0, life: 0 });
    for (let i = 0; i < S.streams.length; i++) {
      const sl = S.streams[i];
      if (i >= lim) { sl.on = false; continue; }
      if (!sl.on || (sl.t += dt) >= sl.life) { if (Math.random() < 0.05 || !sl.on && S.time < 0.1) spawnStream(sl); else sl.on = false; continue; }
      const a = flowAvoid(sl.pts[0][0], sl.pts[0][1], S.time, sl.off), mx = Math.cos(a) * sl.spd * dt, my = Math.sin(a) * sl.spd * dt;
      for (const q of sl.pts) { q[0] += mx; q[1] += my; }
    }
    // ③ 미세 반짝
    const G = WC().glints;
    S.glints = S.glints || [];
    S.glintAcc = (S.glintAcc || 0) + G.rate * S.quality * dt;
    while (S.glintAcc >= 1) {
      S.glintAcc--;
      if (S.glints.length >= G.max) S.glints.shift();
      const d = lerp(G.depth[0], G.depth[1], Math.random()), lat = (Math.random() * 2 - 1) * d * W / (2 * rig.f);
      const x = rig.cx + rig.F[0] * d + rig.R[0] * lat, y = rig.cy + rig.F[1] * d + rig.R[1] * lat;
      if (floeAt(x, y) || islandAt(x, y)) continue;
      S.glints.push({ x, y, t: 0, a: lerp(G.alpha[0], G.alpha[1], Math.random()), dash: Math.random() < 0.5, ang: flowAng(x, y, S.time) });
    }
    S.glints = S.glints.filter((q) => (q.t += dt) < G.life);
  }
  function drawStreams() {
    const K = WC().streams;
    ctx.lineCap = 'round';
    for (const sl of S.streams) {
      if (!sl.on) continue;
      const u0 = clamp(sl.t / sl.life, 0, 1), env = smooth(0, 0.3, u0) * (1 - smooth(0.7, 1, u0));   // smoothstep 으로 나타났다 사라짐
      const sp = [];
      let ok = true, dsum = 0;
      for (const [x, y] of sl.pts) { const c = camSpace(x, y, 0); if (c[1] < rig.near + 0.5) { ok = false; break; } sp.push(toScreen(c)); dsum += c[1]; }
      if (!ok || sp.length < 2) continue;
      const d = dsum / sp.length, a = sl.a * env * (1 - fogAt(d));
      if (a < 0.004) continue;
      const w = clamp(K.width * pxPerUnit(d) / 110, 0.3, K.width * 1.6), gap = K.pairGap * clamp(pxPerUnit(d) / 110, 0.4, 1.2);
      // 양 끝이 가늘어지도록 선을 4토막으로 나눠 굵기를 달리함 (토막마다 한 번에 그려 가볍게)
      const n = sp.length - 1, parts = 4;
      ctx.lineJoin = 'round';
      for (let pIdx = 0; pIdx < parts; pIdx++) {
        const k0 = Math.floor(pIdx * n / parts), k1 = Math.floor((pIdx + 1) * n / parts);
        if (k1 <= k0) continue;
        const u = (pIdx + 0.5) / parts, lw = Math.max(0.25, w * Math.sin(Math.PI * u));
        let nx = -(sp[k1][1] - sp[k0][1]), ny = sp[k1][0] - sp[k0][0]; const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
        if (nx + ny > 0) { nx = -nx; ny = -ny; }            // 밝은 선은 왼쪽 위(빛) 쪽에 붙임
        ctx.lineWidth = lw; ctx.strokeStyle = `rgba(${COL.water},${(((a * (K.darkMul ?? 1))) * WLA).toFixed(3)})`;
        ctx.beginPath(); ctx.moveTo(sp[k0][0], sp[k0][1]); for (let k = k0 + 1; k <= k1; k++) ctx.lineTo(sp[k][0], sp[k][1]); ctx.stroke();
        ctx.lineWidth = lw * 0.9; ctx.strokeStyle = `rgba(${rgbS(PAL.pairDark)},${Math.min(PAL.pairDarkAlpha, a * K.pairAlpha * 3).toFixed(3)})`;   // 밝은 선 옆 어두운 짝
        ctx.beginPath(); ctx.moveTo(sp[k0][0] + nx * gap, sp[k0][1] + ny * gap); for (let k = k0 + 1; k <= k1; k++) ctx.lineTo(sp[k][0] + nx * gap, sp[k][1] + ny * gap); ctx.stroke();
      }
    }
    // 빙하 하류 쪽 작은 소용돌이 곡선 1~2개
    for (const f of activeFloes()) {
      const fa = flowAng(f.x, f.y, S.time), fx = Math.cos(fa), fy = Math.sin(fa), seed = (f.cand.seed % 997) / 997;
      for (let e = 0; e < 2; e++) {
        const side = e ? 1 : -1, cx = f.x + fx * f.R * 1.25 - fy * f.R * 0.45 * side, cy = f.y + fy * f.R * 1.25 + fx * f.R * 0.45 * side;
        const c0 = camSpace(cx, cy, 0); if (c0[1] < rig.near + 0.5) continue;
        const life = 4, u = ((S.time / life + seed + e * 0.5) % 1), a = K.eddyAlpha * Math.sin(Math.PI * u) * (1 - fogAt(c0[1]));
        if (a < 0.004) continue;
        const pts = [], rr0 = f.R * 0.28;
        for (let i = 0; i <= 12; i++) {
          const v = i / 12, th = seed * 6.28 + side * (v * 4.4 + S.time * 0.5), rr = rr0 * (0.35 + 0.65 * (1 - v)) * (0.7 + 0.3 * u);
          const c = camSpace(cx + Math.cos(th) * rr, cy + Math.sin(th) * rr, 0); if (c[1] > rig.near) pts.push(toScreen(c));
        }
        if (pts.length < 2) continue;
        ctx.lineWidth = clamp(pxPerUnit(c0[1]) / 110, 0.4, 1.4); ctx.strokeStyle = `rgba(${COL.water},${((a) * WLA).toFixed(3)})`;
        ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
      }
    }
    // ③ 미세 반짝: 작은 흰 점·짧은 선 조각
    const G = WC().glints;
    for (const q of S.glints || []) {
      const c = camSpace(q.x, q.y, 0); if (c[1] < rig.near + 0.5) continue;
      const [sx, sy] = toScreen(c), a = q.a * Math.sin(Math.PI * q.t / G.life) * (1 - fogAt(c[1])), s = clamp(pxPerUnit(c[1]) / 110, 0.4, 1.4);
      ctx.strokeStyle = ctx.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`;
      if (q.dash) {
        const L = 4 * s, dx = Math.cos(q.ang + cam.yaw) * L, dy = Math.sin(q.ang + cam.yaw) * L * Math.max(0.05, rig.sp);
        ctx.lineWidth = 1 * s; ctx.beginPath(); ctx.moveTo(sx - dx, sy - dy); ctx.lineTo(sx + dx, sy + dy); ctx.stroke();
      } else { ctx.beginPath(); ctx.arc(sx, sy, 1.1 * s, 0, Math.PI * 2); ctx.fill(); }
    }
  }

  // ① 너울: 화면 폭 30~60% 길이의 아주 옅은 명암 띠가 8~14초 주기로 천천히 지나감
  function drawSwell() {
    const SW = WC().swell;
    if (!S.swell) { const r = rng(321); S.swell = Array.from({ length: SW.count }, (_, i) => ({ ph: r(), per: lerp(SW.period[0], SW.period[1], r()), w: lerp(SW.width[0], SW.width[1], r()), a: lerp(SW.alpha[0], SW.alpha[1], r()), d: 4 + i * 7 + r() * 5, lat: (r() - 0.5) * 0.8 })); }
    const dir = flowAng(cam.x, cam.y, S.time * 0.2);
    for (const b of S.swell) {
      const u = ((S.time / b.per + b.ph) % 1 + 1) % 1, env = Math.sin(Math.PI * u);
      const d = b.d + (u - 0.5) * SW.travel * 0.6;
      const cx = rig.cx + rig.F[0] * d + rig.R[0] * b.lat * d, cy = rig.cy + rig.F[1] * d + rig.R[1] * b.lat * d;
      const c = camSpace(cx, cy, 0); if (c[1] < rig.near + 1) continue;
      const halfL = b.w * W / 2, [sx, sy] = toScreen(c), th = clamp(SW.thick * pxPerUnit(c[1]), 2, 40) * Math.max(0.08, rig.sp);
      const a = b.a * env * (1 - fogAt(c[1]));
      if (a < 0.003) continue;
      const tilt = Math.sin(dir) * 0.15;
      for (const [col, off, k] of [[rgbS(PAL.pairDark), 0, 2.2], [COL.water, -th * 0.6, 1.1]]) {   // 어두운 띠 + 그 위 밝은 띠
        const gr = ctx.createLinearGradient(sx - halfL, 0, sx + halfL, 0);
        gr.addColorStop(0, `rgba(${col},0)`); gr.addColorStop(0.5, `rgba(${col},${Math.min(1, a * k).toFixed(3)})`); gr.addColorStop(1, `rgba(${col},0)`);
        ctx.strokeStyle = gr; ctx.lineWidth = th; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(sx - halfL, sy + off + halfL * tilt); ctx.quadraticCurveTo(sx, sy + off - th * 0.4, sx + halfL, sy + off - halfL * tilt); ctx.stroke();
      }
    }
  }

  // 수면 전체 밝기: 아주 느린 노이즈로 ±4% (낮은 해상도 캔버스를 키워 덮음)
  const toneCv = document.createElement('canvas'), toneG = toneCv.getContext('2d');
  const TONE_W = (C.quality && C.quality.toneSize[0]) || 24, TONE_H = (C.quality && C.quality.toneSize[1]) || 12;
  toneCv.width = TONE_W; toneCv.height = TONE_H;
  function drawWaterTone() {
    const T = WC().tone, hz = Math.max(0, rig.horizon);
    if (!S.toneT || S.time - S.toneT > 0.25) {
      S.toneT = S.time;
      const img = toneG.createImageData(TONE_W, TONE_H), ys = cam.yaw * 3, sx = 24 / TONE_W, sy = 12 / TONE_H;
      for (let j = 0; j < TONE_H; j++) for (let i = 0; i < TONE_W; i++) {
        const n = noise2(i * sx * T.scale + ys, j * sy * T.scale * 1.6 + S.time / T.period), v = 1 + n * T.amp, k = (j * TONE_W + i) * 4;
        img.data[k] = Math.min(255, BG[0] * v); img.data[k + 1] = Math.min(255, BG[1] * v); img.data[k + 2] = Math.min(255, BG[2] * v); img.data[k + 3] = 255;
      }
      toneG.putImageData(img, 0, 0);
    }
    ctx.imageSmoothingEnabled = true; ctx.globalAlpha = 0.85;
    ctx.drawImage(toneCv, 0, hz + H * 0.04, W, H - hz);
    const gr = ctx.createLinearGradient(0, hz, 0, hz + H * 0.1);            // 수평선 쪽은 자연스럽게 이어지게
    gr.addColorStop(0, `rgba(${rgbS(PAL.skyHorizon)},1)`); gr.addColorStop(1, `rgba(${rgbS(PAL.skyHorizon)},0)`);
    ctx.globalAlpha = 1; ctx.fillStyle = gr; ctx.fillRect(0, hz, W, H * 0.1);
  }

  // 빙하·펭귄 둘레: 윤곽을 따라 번지는 가는 등고선 링 2~3겹 (노이즈로 일렁이고 끊어진 호)
  // 빙하·펭귄 둘레: 선 대신 천천히 바깥으로 번지는 명암 고리 2~3겹 (빙하 모양에 맞춰 타원)
  function drawContours() {
    const K = WC().contours, t = S.time;
    const halo = (x, y, rx, ry, seed) => {
      const cc = camSpace(x, y, 0); if (cc[1] < rig.near + 0.5) return;
      const fog = fogAt(cc[1]);
      for (let k = 0; k < K.rings; k++) {
        const u = ((t / K.life + k / K.rings + seed) % 1 + 1) % 1, off = 1.05 + K.spread * (1 - Math.pow(1 - u, 2)) / Math.max(rx, 0.4);
        const a = K.alpha * 0.8 * (1 - u) * Math.min(1, u * 5) * (1 - fog);
        drawGroundImage(shadeRing, x, y, 1, 0, rx * off, ry * off, a);
      }
    };
    for (const f of activeFloes()) halo(f.x, f.y, f.rx * 1.05, f.ry * 1.05, (f.cand.seed % 1000) / 1000);
    const p = S.p;
    if (p.mode === 'water' && !p.air && Math.hypot(p.vx, p.vy) < 0.4) halo(p.x, p.y, penH() * 0.4, penH() * 0.4, 0.37);
  }


  // 물 엔진 그리기: 화면 아래쪽을 낮은 해상도로 훑어, 각 점의 수면 기울기를 밝은 면/그늘로 칠함
  const simCv = document.createElement('canvas'), simG = simCv.getContext('2d');
  let simImg = null;
  function drawSimWater() {
    const R = SIM.render, L = FIXED_LIGHT, ll = Math.hypot(L[0], L[1]) || 1;
    sim.computeShade(L[0] / ll, L[1] / ll);
    if (sim.maxShade < R.slope[0]) return;
    const lineOn = R.line.alpha > 0;
    const y0 = Math.max(0, Math.floor(rig.horizon) + 2);
    if (y0 >= H) return;
    const rr = offRes(R.resolution), w = Math.max(8, Math.ceil(W * rr)), h = Math.max(4, Math.ceil((H - y0) * rr));
    if (!simImg || simImg.width !== w || simImg.height !== h) { fitCv(simCv, w, h); simImg = simG.createImageData(w, h); }
    const LN = R.line, cr = sim.crest, lc = LN.color;
    const D = simImg.data, N = sim.N, sh = sim.shade, inv = 1 / sim.dx, lo = R.slope[0], span = 1 / R.slope[1];
    const far = SIM.size * 1.5, FGd = C.FOG.dist;
    // 빙하 둘레 (반지름 × floeLightRadius) 안에서는 밝은 면을 줄임: 격자 좌표의 타원 목록
    const fz = [], fr = R.floeLightRadius;
    for (const f of activeFloes()) fz.push([(f.x * inv) - sim.ox - 0.5, (f.y * inv) - sim.oy - 0.5, 1 / (f.rx * fr * inv), 1 / (f.ry * fr * inv)]);
    let any = false, o = 0;
    for (let j = 0; j < h; j++) {
      const sy = y0 + (j + 0.5) * (H - y0) / h, u = (rig.cy0 - sy) / rig.f;
      const hr = -rig.sp + u * rig.cp, t = hr < -1e-4 ? rig.cz / -hr : Infinity;        // 화면 줄 → 수면까지의 깊이
      if (t > far) { for (let i = 0; i < w; i++, o += 4) D[o + 3] = 0; continue; }
      const zf = (rig.cp + u * rig.sp) * t, fogK = 1 - fogAt(t, FGd);
      // 줄 양 끝의 월드 좌표 → 격자 좌표. 줄 안에서는 직선으로 변함
      const xl = -W / 2 / rig.f * t, xs = W / rig.f * t / w;
      let gx = ((rig.cx + rig.F[0] * zf + rig.R[0] * (xl + xs * 0.5)) * inv) - sim.ox - 0.5, gy = ((rig.cy + rig.F[1] * zf + rig.R[1] * (xl + xs * 0.5)) * inv) - sim.oy - 0.5;
      const dgx = rig.R[0] * xs * inv, dgy = rig.R[1] * xs * inv;
      for (let i = 0; i < w; i++, o += 4, gx += dgx, gy += dgy) {
        if (gx < 0 || gy < 0 || gx >= N - 1 || gy >= N - 1) { D[o + 3] = 0; continue; }
        const ci = gx | 0, cj = gy | 0, fx = gx - ci, fy = gy - cj, q = cj * N + ci;
        const s = (sh[q] * (1 - fx) + sh[q + 1] * fx) * (1 - fy) + (sh[q + N] * (1 - fx) + sh[q + N + 1] * fx) * fy;
        let k = (s < 0 ? -s : s) - lo;
        // 물마루 흰 선: 명암 위에 얹음 (더 진한 쪽을 씀)
        const ln = lineOn ? ((cr[q] * (1 - fx) + cr[q + 1] * fx) * (1 - fy) + (cr[q + N] * (1 - fx) + cr[q + N + 1] * fx) * fy) * LN.alpha * fogK : 0;
        if (k <= 0) { if (ln > 0.01) { D[o] = lc[0]; D[o + 1] = lc[1]; D[o + 2] = lc[2]; D[o + 3] = 255 * ln; any = true; } else D[o + 3] = 0; continue; }
        k = (1 - Math.exp(-k * span)) * fogK;                                // 잔물결도 보이고 큰 물결은 과하지 않게
        const c = s > 0 ? R.light : R.dark;
        let la = R.lightAlpha;
        if (s > 0) for (const z of fz) { const ux = (gx - z[0]) * z[2], uy = (gy - z[1]) * z[3], q2 = ux * ux + uy * uy; if (q2 < 1.4) { la *= 1 - (1 - R.floeLightMul) * (1 - smooth(0.8, 1.4, q2)); break; } }
        const ka = k * (s > 0 ? la : R.darkAlpha);
        if (ln > ka) { D[o] = lc[0]; D[o + 1] = lc[1]; D[o + 2] = lc[2]; D[o + 3] = 255 * ln; }
        else { D[o] = c[0]; D[o + 1] = c[1]; D[o + 2] = c[2]; D[o + 3] = 255 * ka; }
        any = true;
      }
    }
    if (!any) return;
    simG.putImageData(simImg, 0, 0);
    ctx.imageSmoothingEnabled = true; ctx.globalAlpha = 1;
    ctx.drawImage(simCv, 0, y0, W, H - y0);
  }

  // 해안 그리기: 젖은 모래 → 모래 위 물막 → 거품을 한 장으로 합쳐 칠함 (섬 바닥 위)
  const shoreCv = document.createElement('canvas'), shoreG = shoreCv.getContext('2d');
  let shoreImg = null;
  function drawSimShore() {
    if (!sim.hasShore) return;
    const R = SIM.shore.render, RS = SIM.render;
    const y0 = Math.max(0, Math.floor(rig.horizon) + 2);
    if (y0 >= H) return;
    const rr = offRes(RS.resolution * 1.4), w = Math.max(8, Math.ceil(W * rr)), h = Math.max(4, Math.ceil((H - y0) * rr));
    if (!shoreImg || shoreImg.width !== w || shoreImg.height !== h) { fitCv(shoreCv, w, h); shoreImg = shoreG.createImageData(w, h); }
    const D = shoreImg.data, N = sim.N, inv = 1 / sim.dx, F = sim.foam, Wt = sim.wet, Fm = sim.film, K = sim.k;
    const far = SIM.size * 1.5, FGd = C.FOG.dist, eC = 1 / SIM.edgeCells, ls = R.laceScale, l0 = R.lace[0], l1 = 1 / (R.lace[1] - R.lace[0]);
    const wc = R.wetColor, fc = R.filmColor, mc = R.foamColor, fref = 1 / R.filmRef;
    let any = false, o = 0;
    for (let j = 0; j < h; j++) {
      const sy = y0 + (j + 0.5) * (H - y0) / h, u = (rig.cy0 - sy) / rig.f;
      const hr = -rig.sp + u * rig.cp, t = hr < -1e-4 ? rig.cz / -hr : Infinity;
      if (t > far) { for (let i = 0; i < w; i++, o += 4) D[o + 3] = 0; continue; }
      const zf = (rig.cp + u * rig.sp) * t, fogK = 1 - fogAt(t, FGd);
      const xl = -W / 2 / rig.f * t, xs = W / rig.f * t / w;
      let gx = ((rig.cx + rig.F[0] * zf + rig.R[0] * (xl + xs * 0.5)) * inv) - sim.ox - 0.5, gy = ((rig.cy + rig.F[1] * zf + rig.R[1] * (xl + xs * 0.5)) * inv) - sim.oy - 0.5;
      const dgx = rig.R[0] * xs * inv, dgy = rig.R[1] * xs * inv;
      for (let i = 0; i < w; i++, o += 4, gx += dgx, gy += dgy) {
        if (gx < 0 || gy < 0 || gx >= N - 1 || gy >= N - 1) { D[o + 3] = 0; continue; }
        const ci = gx | 0, cj = gy | 0, q = cj * N + ci;
        if (K[q] >= 0.999 && K[q + 1] >= 0.999 && K[q + N] >= 0.999) { D[o + 3] = 0; continue; }   // 깊은 바다는 건너뜀
        const fx = gx - ci, fy = gy - cj, w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
        const fade = Math.min(1, Math.min(gx, gy, N - 1 - gx, N - 1 - gy) * eC) * fogK;
        const wet = (Wt[q] * w00 + Wt[q + 1] * w10 + Wt[q + N] * w01 + Wt[q + N + 1] * w11);
        const film = (Fm[q] * w00 + Fm[q + 1] * w10 + Fm[q + N] * w01 + Fm[q + N + 1] * w11);
        let foam = (F[q] * w00 + F[q + 1] * w10 + F[q + N] * w01 + F[q + N + 1] * w11);
        // 아래부터: 젖은 모래 → 물막 → 거품 (알파 합성)
        let a = wet * wet * R.wetAlpha, cr = wc[0], cg = wc[1], cb = wc[2];
        if (film > 0) {
          const fa = (1 - Math.exp(-film * fref)) * R.filmAlpha, na = fa + a * (1 - fa);
          if (na > 0) { const kb = a * (1 - fa) / na, kt = fa / na; cr = fc[0] * kt + cr * kb; cg = fc[1] * kt + cg * kb; cb = fc[2] * kt + cb * kb; a = na; }
        }
        if (foam > 0.02) {
          const wxp = (gx + sim.ox) * sim.dx, wyp = (gy + sim.oy) * sim.dx;
          const nz = 0.5 + 0.5 * (0.65 * noise2(wxp * ls, wyp * ls) + 0.35 * noise2(wxp * ls * 2.7 + 9, wyp * ls * 2.7));   // 레이스 무늬
          let fk = (foam * (0.45 + 0.9 * nz) - l0) * l1;
          if (fk > 0) {
            if (fk > 1) fk = 1;
            const fa = fk * fk * (3 - 2 * fk) * R.foamAlpha, na = fa + a * (1 - fa), kb = a * (1 - fa) / na, kt = fa / na;
            cr = mc[0] * kt + cr * kb; cg = mc[1] * kt + cg * kb; cb = mc[2] * kt + cb * kb; a = na;
          }
        }
        a *= fade;
        if (a < 0.004) { D[o + 3] = 0; continue; }
        D[o] = cr; D[o + 1] = cg; D[o + 2] = cb; D[o + 3] = 255 * a;
        any = true;
      }
    }
    if (!any) return;
    shoreG.putImageData(shoreImg, 0, 0);
    ctx.imageSmoothingEnabled = true; ctx.globalAlpha = 1;
    ctx.drawImage(shoreCv, 0, y0, W, H - y0);
  }

  function drawWater() {
    if (sim) drawSimWater();
    const K = WC().curve;
    ctx.lineCap = 'round';
    // 얕은 물 걸음 파문: 선이 아닌 부드러운 명암 고리
    { const SR = P.water.stepRipple, spr = getRingSprite();
      for (const q of S.softRipples) { const k = q.t / SR.life; groundSprite(spr, q.x, q.y, SR.radius * (0.4 + 0.8 * (1 - Math.pow(1 - k, 2))), SR.alpha * (1 - k) * Math.min(1, k * 10)); }
      ctx.globalAlpha = 1; }
    // 원형 파문: 선 링이 아닌 명암 고리가 차례로 퍼짐 (3~6겹, ease-out)
    const RP = WC().ripple;
    for (const r of S.ripples) {
      for (let j = 0; j < RP.rings; j++) {
        const tj = r.t - j * RP.ringGap;
        if (tj <= 0 || tj >= r.life) continue;
        const k = tj / r.life, rad = r.maxR * (1 - Math.pow(1 - k, 3)) * (1 - 0.6 * j / RP.rings);
        const a = r.alpha * Math.min(1, tj / RP.fadeIn) * Math.pow(1 - k, 1.6) * (1 - 0.35 * j / RP.rings) * 0.9;
        const wob = 1 + RP.wobble * noise1(r.ph + j * 3 + tj * 0.5);
        const cc = camSpace(r.x, r.y, 0);
        if (cc[1] < rig.near + 0.3 || rad < 0.03) continue;
        drawGroundImage(shadeRing, r.x, r.y, Math.cos(r.ph), Math.sin(r.ph), rad * wob, rad / wob, a * (1 - fogAt(cc[1])));
      }
    }
    // 헤엄: 앞쪽 밝은 물 덩어리, 양옆·뒤 어두운 골, 뒤로 길쭉한 얼룩 (명암 면, pitch 에 맞게 납작)
    { const SS = WC().swimShade, p = S.p;
      for (const q of S.swimShade) {
        const k = q.t / SS.life, s = lerp(SS.scale[0], SS.scale[1], 1 - Math.pow(1 - k, 2)), cc = camSpace(q.x, q.y, 0);
        if (cc[1] < rig.near + 0.3) continue;
        const fade = Math.pow(1 - k, 1.4) * Math.min(1, q.t * 8) * (1 - fogAt(cc[1]));
        drawGroundImage(q.bright ? shadeBright : shadeDark, q.x, q.y, q.hx, q.hy, s * 0.5 * SS.length * 0.5, s * 0.35, (q.bright ? SS.brightAlpha : SS.darkAlpha) * fade, 0, 0, true);
      }
      if (p.mode === 'water' && !p.air && p.depth === 'deep') {
        const sp = Math.hypot(p.vx, p.vy), m = clamp(sp / P.penguin.maxSpeed.water, 0, 1);
        if (m > 0.05) {
          const hx = p.vx / sp, hy = p.vy / sp, r0 = penH() * 0.42;
          drawGroundImage(shadeBright, p.x + hx * r0, p.y + hy * r0, hx, hy, r0 * 0.9, r0 * 1.1, SS.brightAlpha * 1.4 * m, 0, 0, true);            // 앞쪽 밝은 물 덩어리
          for (const sd of [1, -1]) drawGroundImage(shadeDark, p.x - hy * r0 * sd * 1.1 - hx * r0 * 0.3, p.y + hx * r0 * sd * 1.1 - hy * r0 * 0.3, hx, hy, r0 * 1.2, r0 * 0.45, SS.darkAlpha * 1.3 * m, 0, 0, true);   // 양옆 골
          drawGroundImage(shadeDark, p.x - hx * r0 * 1.6, p.y - hy * r0 * 1.6, hx, hy, r0 * 1.3, r0 * 0.6, SS.darkAlpha * m, 0, 0, true);     // 뒤 골
        }
      }
    }
    // 와류: 둥글게 말려 드는 작은 호
    for (const v of S.vortex) {
      const k = v.t / K.vortex.life, a = v.a * Math.sin(Math.PI * Math.min(1, k * 1.2)) * (1 - k);
      const cc = camSpace(v.x, v.y, 0);
      if (a < 0.004 || cc[1] < rig.near + 0.3) continue;
      const pts = [];
      for (let i = 0; i <= 10; i++) {
        const u = i / 10, th = v.ph + v.dir * (u * 4.2 + v.t * 2.2), rr = v.r * (0.45 + 0.55 * k) * (1 - 0.55 * u);
        const cs = camSpace(v.x + Math.cos(th) * rr, v.y + Math.sin(th) * rr, 0);
        if (cs[1] > rig.near) pts.push(toScreen(cs));
      }
      if (pts.length < 2) continue;
      ctx.lineWidth = clamp(pxPerUnit(cc[1]) * 0.022, 0.6, 2.2);
      ctx.strokeStyle = `rgba(${COL.water},${(((a * (1 - fogAt(cc[1])))) * WLA).toFixed(3)})`;
      ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // V자 항적: 방출점을 중심으로 퍼지는 얇은 호. 반지름 = 진행거리 × tan(반각) → 팔이 반각 19°
    const Wk = WC().wake, tanA = Math.tan(deg(Wk.halfAngleDeg));
    ctx.lineCap = 'round';
    for (const w of S.wake) {
      if (!w.on) continue;
      const k = w.t / Wk.life, a = w.alpha * Math.pow(1 - k, 1.4) * Math.min(1, w.t * 10);
      if (a < 0.004) continue;
      const rad = w.r0 + w.t * w.speed * tanA, fw = forwardness(Math.cos(w.ang), Math.sin(w.ang));
      for (const sd of [1, -1]) {
        const c0 = w.ang + sd * (Math.PI / 2 + 0.18);
        const pts = [];
        let dsum = 0;
        for (let i = 0; i <= 6; i++) {                       // 카메라 바로 앞에서 잘린 부분만 빼고 그림
          // 바깥(뒤)쪽 끝으로 갈수록 뒤로 살짝 휘는 곡선 호
          const u = i / 6, th = c0 - w.span / 2 + w.span * u + sd * K.wakeBend * u * u * (0.5 + k);
          const rr = rad * (1 + 0.08 * Math.sin(u * 3.1 + w.t * 1.5));
          const cs = camSpace(w.x + Math.cos(th) * rr, w.y + Math.sin(th) * rr, 0);
          if (cs[1] < rig.near) continue;
          pts.push(toScreen(cs)); dsum += cs[1];
        }
        if (pts.length < 2) continue;
        const d = dsum / pts.length, aa = a * (1 - fogAt(d));
        if (aa < 0.004) continue;
        // 가까울수록·앞으로 나아갈수록 굵게 (낮은 시점에서 전진이 잘 보이도록)
        ctx.lineWidth = Wk.lineWidth * clamp(pxPerUnit(d) / 45, 0.6, 2.4) * (1 + 0.5 * fw);
        ctx.strokeStyle = `rgba(${COL.water},${((aa) * WLA).toFixed(3)})`;
        ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
      }
    }
  }

  // 선체 뒤로 흐르는 가는 흐름선 (2~3줄). 앞으로 나아갈 때 더 길게
  function drawFlowLines(x, y, dir, speed, maxSp, halfW, rear, dy) {
    const F = WC().flowLines, s = clamp(speed / maxSp, 0, 1);
    if (s < 0.08 || F.count < 1) return;
    const fw = forwardness(dir[0], dir[1]);
    const len = speed * F.lengthSec * (1 + 0.8 * fw), px = -dir[1], py = dir[0];
    ctx.lineCap = 'round';
    for (let i = 0; i < F.count; i++) {
      const o = F.count === 1 ? 0 : (i / (F.count - 1) - 0.5) * 2 * halfW * 0.7;
      const shimmer = Math.sin(S.time * 3 + i * 1.7) * 0.08;
      const bx = x - dir[0] * rear + px * o, by = y - dir[1] * rear + py * o;
      const l = len * (0.75 + 0.25 * Math.sin(S.time * 1.3 + i));
      for (let seg = 0; seg < 3; seg++) {
        const t0 = seg / 3, t1 = (seg + 1) / 3;
        const c0 = camSpace(bx - dir[0] * l * t0 + px * shimmer * t0, by - dir[1] * l * t0 + py * shimmer * t0, 0);
        const c1 = camSpace(bx - dir[0] * l * t1 + px * shimmer * t1, by - dir[1] * l * t1 + py * shimmer * t1, 0);
        if (c0[1] < rig.near || c1[1] < rig.near) continue;
        const [x0, y0] = toScreen(c0), [x1, y1] = toScreen(c1);
        ctx.lineWidth = clamp(pxPerUnit(c0[1]) / 60, 0.7, 2) * (1 + 0.4 * fw);
        ctx.strokeStyle = `rgba(${COL.water},${(((F.alpha * (1 + fw) * s * (1 - t0) * (1 - fogAt(c0[1])))) * WLA).toFixed(3)})`;
        ctx.beginPath(); ctx.moveTo(x0, y0 + dy * 0.3); ctx.lineTo(x1, y1 + dy * 0.3); ctx.stroke();
      }
    }
  }

  const FLOE_SIDE_RGB = PAL.floe.side, FLOE_SUNK_RGB = PAL.floe.sunk, FLOE_SHADOW_RGB = PAL.floe.glow;   // '그림자' 자리는 옅은 반사광
  // 빛 방향: 화면 왼쪽 위에서 (월드 기준 단위 벡터)
  function lightDir() { return FIXED_LIGHT; }              // 빛은 월드에 고정 (시작 시선의 왼쪽 위)
  // 고정된 빛(시작 시선의 왼쪽 위)으로 윗면 면 음영을 칠하고, 작게 그렸다 키워 경계를 흐린 텍스처 (빙하마다 한 번)
  const topCv = document.createElement('canvas'), topG = topCv.getContext('2d');
  function floeAlpha(f) { return f === S.p.floe ? 1 : clamp((S.time - f.born) / IF.fadeInTime, 0, 1); }
  // 빙하 윤곽 샘플(cover.samples 개)에서 수면 높이를 읽어 꼭짓점마다 수면선 높이(월드)로. 양수 = 물이 올라와 옆면을 가림
  function floeWaterline(f, topZ) {
    const n = f.shape.length, out = new Float32Array(n);
    if (!sim) return out;
    const CV = SIM.cover, m = CV.samples, hs = new Float32Array(m), capW = coverCapW();
    for (let k = 0; k < m; k++) { const an = k / m * Math.PI * 2; hs[k] = sim.sample(f.x + Math.cos(an) * f.rx * 1.05, f.y + Math.sin(an) * f.ry * 1.05) * CV.gain; }
    for (let i = 0; i < n; i++) {
      const [x, y] = f.shape[i], u = ((Math.atan2(y / f.ry, x / f.rx) / (Math.PI * 2)) % 1 + 1) % 1 * m, k0 = Math.floor(u) % m, k1 = (k0 + 1) % m, t = u - Math.floor(u);
      const cap = Math.min(capW, Math.max(0, topZ(i)) * CV.sideFrac);
      out[i] = clamp(hs[k0] * (1 - t) + hs[k1] * t, -cap, cap);
    }
    return out;
  }
  // 가림 최대 폭(월드): 펭귄 거리에서 maxPx 가 되는 길이 → 멀리 있는 것은 원근만큼 작게 보임
  const coverCapW = () => SIM.cover.maxPx / pxPerUnit(Math.max(rig.near, camSpace(S.p.x, S.p.y, 0)[1]));

  // 빙하: 물에 반쯤 잠긴 덩어리. 접촉 그림자 → 잠긴 몸(아래로 옅어짐) → 수면 위 옆면 → 수면 흰 링 → 윗면(그라데이션·면 분할선)
  const floeHalo = (() => { const FF = C.FOG.floe, col = (FF ? FF.color : [28, 35, 45]).join(','); return makeSprite([[0, `rgba(${col},0.9)`], [0.4, `rgba(${col},0.6)`], [0.7, `rgba(${col},0.22)`], [1, `rgba(${col},0)`]]); })();
  const maskCv = document.createElement('canvas'), maskG = maskCv.getContext('2d');
  function drawFloe(f, d) {
    const a = floeAlpha(f);
    if (a <= 0.01) return;
    const FF = C.FOG.floe, FL = C.floe, dy = floeOffset(f), fog = FF ? FF.max * smooth(FF.start, FF.end, d) : fogAt(d), shp = f.shape;   // GRIS: 빙하 전용 안개
    const tilt = (x, y) => f.tilt.x * x + f.tilt.y * y;
    const poly = (scale, zf, shift = dy) => projPoly(shp.map(([x, y]) => [f.x + x * scale, f.y + y * scale, zf(x * scale, y * scale)])).map(([sx, sy]) => [sx, sy + shift]);
    // 접촉 그림자 (수면, 출렁임에 반만 따라감)
    ctx.fillStyle = `rgb(${FLOE_SHADOW_RGB.join(',')})`;
    softPolys((s) => poly(1.08 * s, () => 0, dy * 0.5), 1, a * FL.contactShadowAlpha * (1 - fog));
    // 잠긴 몸: 깊을수록 옅게, 경계는 번지게
    ctx.fillStyle = `rgb(${FLOE_SUNK_RGB.join(',')})`;
    for (let k = 3; k >= 1; k--) softPolys((s) => poly((1 + 0.035 * k) * s, (x, y) => -FL.sunkDepth * k / 3 + tilt(x, y)), 1, a * FL.sunkAlpha * (1 - (k - 1) / 3) * 0.55 * (1 - fog));
    // 검은 물에 비치는 옆면: 수면선에서 아래로 옅어지는 흰 면 (선 없음)
    if (PAL.floe.reflectAlpha > 0 && f.relief) {
      const rf0 = f.relief, tz = (i) => (C.floe.topHeight + rf0.rings[0][i][2]) * PAL.floe.reflectLength, nn = shp.length;
      for (let i = 0; i < nn; i++) {
        const j = (i + 1) % nn, [x0, y0] = shp[i], [x1, y1] = shp[j];
        const q = projPoly([[f.x + x0, f.y + y0, 0], [f.x + x1, f.y + y1, 0], [f.x + x1, f.y + y1, -tz(j)], [f.x + x0, f.y + y0, -tz(i)]]).map(([sx, sy]) => [sx, sy + dy * 0.5]);
        if (q.length < 3) continue;
        const yT = Math.min(...q.map((v) => v[1])), yB = Math.max(...q.map((v) => v[1]));
        if (yB - yT < 0.5) continue;
        const gr = ctx.createLinearGradient(0, yT, 0, yB);
        gr.addColorStop(0, `rgba(255,255,255,${(PAL.floe.reflectAlpha * 0.5 * (1 - fog)).toFixed(3)})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.globalAlpha = a; ctx.fillStyle = gr; fillPoly(q);
      }
    }
    // 옆면: 가장자리마다 수면 → 윗면 높이까지. 높은 쪽(쐐기)은 깎아지른 절벽 면으로 어둡게
    const RL = FL.relief, rf = f.relief, n = shp.length;
    const L = lightDir(), shadeOf = (nv, lo, hi) => { const b = smooth(-0.1, 0.85, nv[0] * L[0] + nv[1] * L[1] + nv[2] * L[2]); return mixFog(lo.map((v, i) => v + (hi[i] - v) * b), fog); };
    const P3 = (x, y, z) => { const cs = camSpace(f.x + x, f.y + y, z); return cs; };
    const topZ = (i) => C.floe.topHeight + rf.rings[0][i][2] + tilt(shp[i][0], shp[i][1]);
    ctx.globalAlpha = a;
    const wl = floeWaterline(f, topZ);                        // 꼭짓점마다 수면선 높이 (파도에 잠겼다 드러남)
    const covers = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, [x0, y0] = shp[i], [x1, y1] = shp[j];
      const pts = projPoly([[f.x + x0, f.y + y0, topZ(i)], [f.x + x1, f.y + y1, topZ(j)], [f.x + x1, f.y + y1, tilt(x1, y1) - 0.01 + wl[j]], [f.x + x0, f.y + y0, tilt(x0, y0) - 0.01 + wl[i]]]).map(([sx, sy]) => [sx, sy + dy]);
      if (wl[i] > 0.001 || wl[j] > 0.001) covers.push([i, j]);
      let ex = y1 - y0, ey = -(x1 - x0); const el = Math.hypot(ex, ey) || 1; ex /= el; ey /= el;   // 바깥 방향 수평 법선
      const tall = (rf.rings[0][i][2] + rf.rings[0][j][2]) / 2 > rf.H * 0.35 * RL.reliefExaggerate;
      if (pts.length < 3) continue;
      // 절벽면: 위에서 아래(수면)로 번지듯 이어지는 음영
      const topC = shadeOf([ex, ey, 0.15], tall ? RL.cliffDark : FLOE_SIDE_RGB, tall ? FLOE_SIDE_RGB : PAL.floe.sideLight);
      const yTop = Math.min(pts[0][1], pts[1][1]), yBot = Math.max(...pts.map((q) => q[1]));
      const gr = ctx.createLinearGradient(0, yTop, 0, yBot + 1);
      gr.addColorStop(0, topC); gr.addColorStop(1 - C.SHADOW_BLUR.ratio, topC); gr.addColorStop(1, mixFog(FLOE_SUNK_RGB, fog));
      ctx.fillStyle = gr; fillPoly(pts);
    }
    // 잠긴 띠: 선 없이 물색 그라데이션 (수면선 0 → 아래 cover.alpha). 그 아래 잠긴 몸(sunk)은 그대로 비쳐 보임
    for (const [i, j] of covers) {
      const [x0, y0] = shp[i], [x1, y1] = shp[j];
      const band = projPoly([[f.x + x0, f.y + y0, tilt(x0, y0) + wl[i]], [f.x + x1, f.y + y1, tilt(x1, y1) + wl[j]], [f.x + x1, f.y + y1, tilt(x1, y1)], [f.x + x0, f.y + y0, tilt(x0, y0)]]).map(([sx, sy]) => [sx, sy + dy]);
      if (band.length < 3) continue;
      const yT = Math.min(...band.map((q) => q[1])), yB = Math.max(...band.map((q) => q[1]));
      if (yB - yT < 0.3) continue;
      const gr = ctx.createLinearGradient(0, yT, 0, yB);
      gr.addColorStop(0, `rgba(${BG.join(',')},0)`); gr.addColorStop(1, `rgba(${BG.join(',')},${SIM.cover.alpha * (1 - fog)})`);
      ctx.globalAlpha = a; ctx.fillStyle = gr; fillPoly(band);
    }
    // 수면과 만나는 흰 물결 링
    const ring = poly(1.03, (x, y) => tilt(x, y) - 0.005);
    if (ring.length > 2 && FL.waterlineAlpha > 0) {
      ctx.globalAlpha = a * FL.waterlineAlpha * (1 - fog);
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = clamp(pxPerUnit(d) * 0.025, 0.8, 2.6); ctx.lineJoin = 'round';
      ctx.beginPath(); ring.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.stroke();
    }
    // 윗면: 높이장 메시의 칸별 명암을 저해상도 캔버스에 그려 키움 (면 경계가 부드럽게 번짐), 윤곽으로 잘라 얹음
    const outline = projPoly(shp.map(([x, y], i) => [f.x + x, f.y + y, topZ(i)])).map(([sx, sy]) => [sx, sy + dy]);
    // 윗면 실루엣 = 가장자리 윤곽 ∪ 메시 사각형 전부. 가장자리 윤곽으로만 자르면 가운데 둔덕·능선이 잘려
    // 옆에서 볼 때 윗면이 평평해 보이고 펭귄만 떠 보였음 (낮은 각도에서 특히)
    const topPolys = [outline];
    if (rf) for (let k = 0; k < rf.K; k++) for (let i = 0, n2 = shp.length; i < n2; i++) {
      const j = (i + 1) % n2, q = projPoly([rf.rings[k][i], rf.rings[k][j], rf.rings[k + 1][j], rf.rings[k + 1][i]].map(([x, y, z]) => [f.x + x, f.y + y, C.floe.topHeight + z + tilt(x, y)])).map(([sx, sy]) => [sx, sy + dy]);
      if (q.length > 2) topPolys.push(q);
    }
    // 합집합 채우기: 다각형을 하나씩 따로 채움. (한 경로로 묶어 nonzero 로 채우면, 낮은 각도에서 뒤집혀 꼬인
    // 사각형이 다른 면을 상쇄해 검은 구멍이 뚫려 보였음)
    const fillUnion = (g2) => { for (const q of topPolys) { g2.beginPath(); q.forEach(([x, y], m) => (m ? g2.lineTo(x, y) : g2.moveTo(x, y))); g2.closePath(); g2.fill(); } };
    if (outline.length > 2) {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const qq of topPolys) for (const q of qq) { minX = Math.min(minX, q[0]); maxX = Math.max(maxX, q[0]); minY = Math.min(minY, q[1]); maxY = Math.max(maxY, q[1]); }
      ctx.globalAlpha = a;
      if (maxX - minX < 18) { ctx.fillStyle = mixFog(RL.shadeMid, fog); fillUnion(ctx); }
      else {
        const res = RL.shadeResolution, w = Math.max(8, Math.ceil(W * res)), h = Math.max(8, Math.ceil(H * res));
        if (topCv.width !== w || topCv.height !== h) { topCv.width = w; topCv.height = h; }
        // 화면에 보이는 윤곽 범위만 지우고 그려서 옮김 (전체 화면 복사 대신)
        const bx0 = clamp(Math.floor(minX * res) - 2, 0, w), by0 = clamp(Math.floor(minY * res) - 2, 0, h), bx1 = clamp(Math.ceil(maxX * res) + 2, 0, w), by1 = clamp(Math.ceil(maxY * res) + 2, 0, h);
        topG.setTransform(1, 0, 0, 1, 0, 0); topG.clearRect(bx0, by0, bx1 - bx0, by1 - by0); topG.setTransform(res, 0, 0, res, 0, 0);
        topG.fillStyle = `rgb(${RL.shadeMid.join(',')})`; fillUnion(topG);
        const n2 = shp.length, order = [];
        // 먼 사각형부터 그림 (낮은 각도에서 둔덕 너머 면이 앞면 위에 덮여 검은 조각처럼 보이지 않게)
        for (let k = 0; k < rf.K; k++) for (let i = 0; i < n2; i++) { const j = (i + 1) % n2, c0 = rf.rings[k][i], c1 = rf.rings[k + 1][j]; order.push([camSpace(f.x + (c0[0] + c1[0]) / 2, f.y + (c0[1] + c1[1]) / 2, (c0[2] + c1[2]) / 2)[1], k, i]); }
        order.sort((u, v) => v[0] - u[0]);
        for (const [, k, i] of order) {
          const j = (i + 1) % n2, q = [rf.rings[k][i], rf.rings[k][j], rf.rings[k + 1][j], rf.rings[k + 1][i]];
          const pts = projPoly(q.map(([x, y, z]) => [f.x + x, f.y + y, C.floe.topHeight + z + tilt(x, y)]));
          if (pts.length < 3) continue;
          topG.fillStyle = `rgb(${rf.cols[k * n2 + i].join(',')})`; topG.strokeStyle = topG.fillStyle; topG.lineWidth = 1.5;
          topG.beginPath(); pts.forEach(([x, y], m) => (m ? topG.lineTo(x, y + dy) : topG.moveTo(x, y + dy))); topG.closePath(); topG.fill(); topG.stroke();
        }
        // 또렷한 가장자리: 실해상도 마스크 캔버스에 합집합을 불투명하게 채운 뒤 그 안에만 명암 캔버스를 얹음
        const mx0 = Math.floor(minX) - 1, my0 = Math.floor(minY) - 1, mw = Math.ceil(maxX) + 1 - mx0, mh = Math.ceil(maxY) + 1 - my0;
        if (mw > 0 && mh > 0 && bx1 > bx0 && by1 > by0) {
          const pw = Math.ceil(mw * DPR), ph = Math.ceil(mh * DPR);
          if (maskCv.width < pw || maskCv.height < ph) { maskCv.width = Math.max(maskCv.width, pw); maskCv.height = Math.max(maskCv.height, ph); }
          maskG.setTransform(1, 0, 0, 1, 0, 0); maskG.globalCompositeOperation = 'source-over'; maskG.clearRect(0, 0, pw, ph);
          maskG.setTransform(DPR, 0, 0, DPR, -mx0 * DPR, -my0 * DPR); maskG.fillStyle = '#000'; fillUnion(maskG);
          maskG.globalCompositeOperation = 'source-in'; maskG.imageSmoothingEnabled = true;
          maskG.drawImage(topCv, bx0, by0, bx1 - bx0, by1 - by0, bx0 / res, by0 / res, (bx1 - bx0) / res, (by1 - by0) / res);
          if (fog > 0.01) { maskG.globalCompositeOperation = 'source-atop'; maskG.globalAlpha = fog; maskG.fillStyle = mixFog([255, 255, 255], 1); maskG.fillRect(mx0, my0, mw, mh); maskG.globalAlpha = 1; }
          maskG.globalCompositeOperation = 'source-over';
          ctx.drawImage(maskCv, 0, 0, pw, ph, mx0, my0, mw, mh);
        }
      }
    }
    // GRIS: 먼 빙하는 안개색(수평선 안개)으로 녹아 흐려지고, 둘레를 부드러운 안개가 감쌈
    if (FF && fog > 0.02) {
      const outline2 = projPoly(shp.map(([x, y]) => [f.x + x, f.y + y, 0])).map(([sx, sy]) => [sx, sy + dy]);
      if (outline2.length > 2) {
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        for (const q of outline2) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); }
        const top = outline.length > 2 ? Math.min(...outline.map((q) => q[1])) : y0;
        ctx.save(); ctx.globalAlpha = a * fog; ctx.fillStyle = `rgb(${FF.color.join(',')})`;
        fillPoly(hull(outline2.concat(...topPolys).map((q) => [q[0], q[1]])));   // 옆면·윗면을 안개색으로 덮음 (윤곽의 볼록 껍질)
        const cx = (x0 + x1) / 2, cy = (top + y1) / 2, rx = (x1 - x0) / 2 * FF.haloSize, ry = Math.max(6, (y1 - top) / 2 * FF.haloSize * 1.6);
        ctx.globalAlpha = a * fog * FF.halo; ctx.drawImage(floeHalo, cx - rx, cy - ry, rx * 2, ry * 2);   // 둘레를 감싸는 안개
        ctx.restore();
      }
    }
    // 빙하 위 긁힘 발자국과 활주 자국 (빙하 좌표계)
    const FP = C.FOOTPRINTS;
    ctx.fillStyle = `rgb(${FP.ice.color.join(',')})`;
    const iceSet = pawPrints(FP.ice.color);
    for (const q of S.icePrints) {
      if (!q.on || q.cand !== f.cand) continue;
      const cs = camSpace(f.x + q.lx, f.y + q.ly, floeTopAt(f, q.lx, q.ly) + 0.004);
      if (cs[1] < rig.near) continue;
      drawPawPrint(iceSet, f.x + q.lx, f.y + q.ly, q.ang, q.side, FP.size, q.t, FP.ice.life, a * FP.ice.alpha * (1 - fog), floeTopAt(f, q.lx, q.ly) + 0.004, dy);
    }
    { const ST = FP.slideTrail; let prev = null;
      ctx.strokeStyle = `rgb(${FP.ice.color.join(',')})`; ctx.lineCap = 'butt';   // 이음매가 점선처럼 겹치지 않게
      for (const q of S.slideTrail) {
        if (q.cand !== f.cand) { prev = null; continue; }
        const c2 = camSpace(f.x + q.lx, f.y + q.ly, floeTopAt(f, q.lx, q.ly) + 0.004);
        if (c2[1] < rig.near) { prev = null; continue; }
        const s2 = toScreen(c2);
        if (prev && prev.stroke === q.stroke) {
          ctx.globalAlpha = a * ST.alpha * (1 - q.t / ST.life) * (1 - fog); ctx.lineWidth = Math.max(0.6, ST.width * pxPerUnit(c2[1]));
          ctx.beginPath(); ctx.moveTo(prev.s[0], prev.s[1] + dy); ctx.lineTo(s2[0], s2[1] + dy); ctx.stroke();
        }
        prev = { s: s2, stroke: q.stroke };
      } }
    ctx.globalAlpha = a;
    ctx.globalAlpha = 1;
  }

  // 섬 지면: (안쪽 거리 d, 화면 안쪽 y) 칸을 먼 것부터 단색 면으로 + 가는 균열선. 경사가 빛을 향하면 살짝 밝게
  function drawTerrain() {
    const is = S.islands[0], G = IT.ground; if (!is) return;
    const L = FIXED_LIGHT, cells = [], shoreCache = new Map();
    const shoreY = (yy) => { let v = shoreCache.get(yy); if (v === undefined) { v = is.shoreAt(clamp(yy, -is.ry + 0.01, is.ry - 0.01)); shoreCache.set(yy, v); } return v; };   // 띠 경계마다 한 번만
    for (let y = G.yRange[0]; y < G.yRange[1]; y += G.yStep) {
      const y1 = y + G.yStep;
      if (Math.abs(y) >= is.ry && Math.abs(y1) >= is.ry) continue;
      for (let d = 0; d < G.maxDist; d += G.dStep) {
        const d1 = d + G.dStep, xs = (dd, yy) => shoreY(yy) + is.side * dd;
        const P4 = [[xs(d, y), y, profileAt(d)], [xs(d1, y), y, profileAt(d1)], [xs(d1, y1), y1, profileAt(d1)], [xs(d, y1), y1, profileAt(d)]];
        const cx = (P4[0][0] + P4[2][0]) / 2, cyy = (y + y1) / 2, cs = camSpace(cx, cyy, 0);
        if (cs[1] < -G.dStep * 2 || cs[1] > G.view) continue;
        cells.push({ P4, depth: cs[1], d, d1 });
      }
    }
    cells.sort((a, b) => b.depth - a.depth);
    const sh = C.world.shoreHeight;
    for (const c of cells) {
      const pts = projPoly(c.P4.map(([x, y, z]) => [x, y, sh + z]));
      if (pts.length < 3) continue;
      // 빛: 경사(안쪽으로 오르면 바다 쪽을 향함)와 고정 빛 방향
      const slope = (profileAt(c.d1) - profileAt(c.d)) / (c.d1 - c.d), nx = -is.side * -slope, nl = Math.hypot(nx, 1);
      const lit = clamp(0.5 + (nx * L[0] + L[2]) / nl * 0.5 - 0.5, -1, 1) * IT.ground.light;
      const col = zoneColor((c.d + c.d1) / 2).map((v) => clamp(v * (1 + lit), 0, 255));
      const fog = fogAt(Math.max(c.depth, 0));
      ctx.globalAlpha = 1; ctx.fillStyle = mixFog(col, fog); ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 0.8;
      ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.fill(); ctx.stroke();
      // 가는 균열선 (칸마다 정해진 무늬)
      const hsh = hash2(Math.round(c.d * 3), Math.round(c.P4[0][1] * 3));
      if (hsh < IT.ground.crack && c.depth < G.view * 0.6) {
        const t0 = hash2(c.d + 7, c.P4[0][1]), t1 = hash2(c.d, c.P4[0][1] + 9), u0 = 0.2 + 0.6 * t0, u1 = 0.2 + 0.6 * t1;
        const A = c.P4[0], B = c.P4[3], Cc = c.P4[1];
        const p0 = [lerp(A[0], B[0], u0), lerp(A[1], B[1], u0)], p1 = [lerp(Cc[0], c.P4[2][0], u1), lerp(Cc[1], c.P4[2][1], u1)];
        const q0 = project(p0[0], p0[1], terrainHeightAt(p0[0], p0[1]) + 0.01), q1 = project(p1[0], p1[1], terrainHeightAt(p1[0], p1[1]) + 0.01);
        if (q0[2] > rig.near && q1[2] > rig.near) { ctx.globalAlpha = 0.5 * (1 - fog); ctx.strokeStyle = `rgb(${IT.ground.crackColor.join(',')})`; ctx.lineWidth = 0.7; ctx.beginPath(); ctx.moveTo(q0[0], q0[1]); ctx.lineTo((q0[0] + q1[0]) / 2 + (t0 - 0.5) * 6, (q0[1] + q1[1]) / 2); ctx.lineTo(q1[0], q1[1]); ctx.stroke(); }
      }
    }
    ctx.globalAlpha = 1;
  }
  // 나무·바위·땅 반딧불이: 깊이 순서로 다른 것들과 함께 그림 (임시 도형)
  function terrainItems(items) {
    if (!IT) return;
    for (const t of S.trees || []) {
      const c = camSpace(t.x, t.y, 0); if (c[1] < rig.near + 0.5 || c[1] > IT.ground.view) continue;
      const sp = project(t.x, t.y, 0), reach = (t.h || 1) * pxPerUnit(c[1]) * 1.2 + 40;
      if (sp[0] < -reach || sp[0] > W + reach) continue;
      items.push({ d: c[1], draw: () => drawTree(t, c[1]) });
    }
    for (const r of S.rocks || []) {
      const c = camSpace(r.x, r.y, 0); if (c[1] < rig.near + 0.3) continue;
      items.push({ d: c[1] - 0.01, draw: () => drawRock(r, c[1]) });
    }
    landFireflyItems(items);
  }
  function drawTree(t, depth) {
    const T = IT.trees, fog = fogAt(depth), ppu = pxPerUnit(depth), z0 = terrainHeightAt(t.x, t.y), b = project(t.x, t.y, z0);
    ctx.globalAlpha = t.front ? T.front.alpha : 1;
    const sway = Math.sin(S.time * 0.6 + (t.ph || 0)) * 0.04;
    if (t.type === 'palm') {                                   // 야자수: 휘어진 밝은 줄기 + 늘어진 잎 여러 갈래
      const top = project(t.x + t.lean + sway * t.h, t.y, z0 + t.h), mid = project(t.x + t.lean * 0.15, t.y, z0 + t.h * 0.55);
      ctx.strokeStyle = mixFog(T.palmTrunk, fog); ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(1, 0.16 * ppu); ctx.beginPath(); ctx.moveTo(b[0], b[1]); ctx.quadraticCurveTo(mid[0], mid[1], top[0], top[1]); ctx.stroke();
      ctx.strokeStyle = mixFog(T.frond, fog); ctx.lineWidth = Math.max(1, 0.13 * ppu);
      const n = T.palm.fronds;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + (t.ph || 0), dx = Math.cos(a), dz = Math.sin(a) * 0.35 + 0.2, L = t.fl * (0.8 + 0.3 * Math.sin(k * 2.3 + (t.ph || 0)));
        const e1 = [top[0] + dx * L * 0.55 * ppu, top[1] - dz * L * 0.4 * ppu], e2 = [top[0] + dx * L * ppu, top[1] + L * 0.45 * ppu - dz * L * 0.2 * ppu];   // 위로 솟았다 아래로 늘어짐
        ctx.beginPath(); ctx.moveTo(top[0], top[1]); ctx.quadraticCurveTo(e1[0], e1[1], e2[0], e2[1]); ctx.stroke();
      }
      ctx.fillStyle = mixFog(T.frond, fog); ctx.beginPath(); ctx.arc(top[0], top[1], Math.max(1.5, 0.18 * ppu), 0, Math.PI * 2); ctx.fill();
    } else if (t.type === 'bush') {                            // 덤불: 낮은 둥근 덩어리 2~3개
      ctx.fillStyle = mixFog(T.bushColor, fog);
      for (let k = 0; k < 3; k++) { const o = (k - 1) * t.w * 0.32, q = project(t.x + o, t.y, z0 + t.h * (0.45 + 0.15 * Math.sin(k + (t.ph || 0)))); ctx.beginPath(); ctx.ellipse(q[0], q[1], t.w * 0.38 * ppu, t.h * 0.55 * ppu, 0, 0, Math.PI * 2); ctx.fill(); }
    } else {                                                   // 정글 나무: 줄기 + 둥근 잎 뭉치 3~4개 (빽빽하게 겹침)
      const top = project(t.x + (t.lean || 0) * t.h + sway, t.y, z0 + t.h);
      ctx.strokeStyle = mixFog(T.trunk, fog); ctx.lineWidth = Math.max(1, 0.22 * ppu); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(b[0], b[1]); ctx.lineTo(top[0], top[1] + t.w * 0.3 * ppu); ctx.stroke();
      ctx.fillStyle = mixFog(T.color, fog);
      for (let k = 0; k < 4; k++) {
        const a = (t.ph || 0) + k * 1.7, ox = Math.cos(a) * t.w * 0.28 * ppu, oy = Math.sin(a) * t.w * 0.16 * ppu - (k === 3 ? t.w * 0.18 * ppu : 0);
        ctx.beginPath(); ctx.ellipse(top[0] + ox, top[1] + oy, t.w * (0.36 - k * 0.03) * ppu, t.w * (0.3 - k * 0.02) * ppu, 0, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }
  // 바위: 모난 면(평면 명암) + 둘레 작은 돌. 파도가 닿으면 둘레에 흰 물결, 반딧불이가 앉아 있으면 윗면에 옅은 빛
  function drawMeshFaces(m, depth, col0, col1, zBase) {
    const fog = fogAt(depth), L = FIXED_LIGHT, faces = [], R = m.rings, n = m.n;
    for (let k = 0; k < 2; k++) for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, q = k === 1 ? [R[1][i], R[1][j], R[2][i]] : [R[0][i], R[0][j], R[1][j], R[1][i]];
      const P3 = q.map(([x, y, z]) => [x, y, z + zBase(x, y)]);
      const ux = P3[1][0] - P3[0][0], uy = P3[1][1] - P3[0][1], uz = P3[1][2] - P3[0][2], vx = P3[P3.length - 1][0] - P3[0][0], vy = P3[P3.length - 1][1] - P3[0][1], vz = P3[P3.length - 1][2] - P3[0][2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const nl = Math.hypot(nx, ny, nz) || 1; if (nz < 0) { nx = -nx; ny = -ny; nz = -nz; }
      const lit = clamp((nx * L[0] + ny * L[1] + nz * L[2]) / nl, 0, 1);
      const cxm = P3.reduce((s, p) => s + p[0], 0) / P3.length, cym = P3.reduce((s, p) => s + p[1], 0) / P3.length, czm = P3.reduce((s, p) => s + p[2], 0) / P3.length;
      faces.push({ P3, lit, dd: camSpace(cxm, cym, czm)[1] });
    }
    faces.sort((a, b) => b.dd - a.dd);
    for (const f of faces) {
      const pts = projPoly(f.P3); if (pts.length < 3) continue;
      const col = col0.map((v, i) => v + (col1[i] - v) * Math.pow(f.lit, 1.4));
      ctx.globalAlpha = 1; ctx.fillStyle = mixFog(col, fog); ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 0.6;
      ctx.beginPath(); pts.forEach(([x, y], q) => (q ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
  }
  function drawRock(r, depth) {
    const RK = IT.rocks, fog = fogAt(depth), sh = C.world.shoreHeight, base = sh + profileAt(r.d);
    const zBase = (x, y) => sh + profileAt(inlandDist(x, y));
    // 둘레 물결: 그 자리 끝선이 바위 앞쪽에 닿은 만큼
    const ws = S.wash; if (ws && RK.washRing > 0) { let q = null, bd = Infinity; for (const s of ws.segs) { const dd = Math.abs(s.y - r.y); if (dd < bd) { bd = dd; q = s; } }
      const k = q ? smooth(r.d - r.R, r.d + r.R * 0.3, q.reach) : 0;
      if (k > 0.02) { const e = groundEllipse(r.x, r.y, r.R * 1.25, base + 0.01); if (e) { ctx.globalAlpha = RK.washRing * k * (1 - fog); ctx.drawImage(shadeRing, e.x - e.rx, e.y - e.ry * 0.8, e.rx * 2, e.ry * 2 * 0.8); } } }
    const ordered = r.pebbles.concat([r.mesh]).map((m) => ({ m, dd: camSpace(m.ax, m.ay, 0)[1] })).sort((a, b) => b.dd - a.dd);
    for (const { m } of ordered) drawMeshFaces(m, depth, RK.color, RK.light, zBase);
    // 반딧불이가 앉아 있으면 윗면에 아주 옅은 빛
    const LF = C.LAND_FIREFLY;
    if (LF && r.glow > 0.01) {
      const top = project(r.mesh.ax, r.mesh.ay, base + r.h * 0.85), ppu = pxPerUnit(depth), spr = lfSprites().outer;
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = LF.rockGlow * r.glow * (1 - fog);
      ctx.drawImage(spr, top[0] - r.R * 1.4 * ppu, top[1] - r.R * 0.7 * ppu, r.R * 2.8 * ppu, r.R * 1.4 * ppu); ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  // ── 땅 반딧불이 ─────────────────────────────────────────
  let lfSpriteCache = null, lfSpriteKey = '';
  function lfSprites() {                                       // 프리셋 색으로 가우시안 번짐 스프라이트 (core · mid · outer)
    const LF = C.LAND_FIREFLY, P = LF.presets[LF.preset] || LF.presets.amber;
    if (lfSpriteCache && lfSpriteKey === LF.preset) return lfSpriteCache;
    const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).join(',');
    const glow = (col) => { const st = []; for (let i = 0; i <= 8; i++) { const t = i / 8; st.push([t, `rgba(${hex(col)},${((Math.exp(-3.2 * t * t) - Math.exp(-3.2)) / (1 - Math.exp(-3.2))).toFixed(4)})`]); } return makeSprite(st); };
    lfSpriteKey = LF.preset; lfSpriteCache = { core: glow(P.core), mid: glow(P.mid[0]), outer: glow(P.outer[0]), P };
    return lfSpriteCache;
  }
  function buildLandFireflies() {
    const LF = C.LAND_FIREFLY; S.lf = { flies: [], pins: 0 }; if (!LF || !IT) return;
    const r = rng(777), is = S.islands[0], laneY = C.lane ? C.lane.y : 0;
    S.lf.pinMax = Math.round(lerp(LF.forestPins[0], LF.forestPins[1], r()));
    let t = LF.arriveDelay;
    for (const rock of S.rocks) {
      rock.glow = 0; rock.fled = false;
      const n = Math.round(lerp(LF.perRock[0], LF.perRock[1], r()));
      for (let k = 0; k < n && S.lf.flies.length < LF.max; k++) {
        t += lerp(LF.arriveGap[0], LF.arriveGap[1], r());
        // 앉을 자리: 바위 윗면 (꼭대기 근처 무작위)
        const a = r() * Math.PI * 2, u = 0.15 + r() * 0.4, sx = rock.mesh.ax + Math.cos(a) * rock.R * u, sy = rock.mesh.ay + Math.sin(a) * rock.Ry * u;
        const fd = lerp(LF.forest.d[0], LF.forest.d[1], r()), fy = laneY - lerp(LF.forest.yBack[0], LF.forest.yBack[1], r());
        const from = [is.shoreAt(fy) + is.side * fd, fy];   // 숲 가장자리에서 날아옴
        const per = LF.blink.on + lerp(LF.blink.off[0], LF.blink.off[1], r());
        S.lf.flies.push({ rock, state: 'wait', tArrive: t, x: from[0], y: from[1], z: 1.5, sx, sy, from, per, ph: r(), sync: r() < LF.blink.syncShare,
          size: lerp(LF.size[0], LF.size[1], r()), seed: r() * 100, zf: lerp(LF.zigzag.freq[0], LF.zigzag.freq[1], r()), trail: [], vis: 0 });
      }
    }
  }
  function stepLandFireflies(dt) {
    const LF = C.LAND_FIREFLY, lf = S.lf; if (!LF || !lf) return;
    const p = S.p, is = S.islands[0], laneY = C.lane ? C.lane.y : 0;
    for (const rock of S.rocks) {
      // 트리거: 펭귄이 반경 안으로 → 가까운 것부터 0~0.4초 지연 두고 날아오름 (한 번만)
      const toR = Math.atan2(rock.y - p.y, rock.x - p.x), facing = Math.abs(angDiff(p.face, toR)) < deg(LF.facing);   // 바위 쪽을 바라볼 때만
      if (!rock.fled && facing && Math.hypot(p.x - rock.x, p.y - rock.y) < LF.trigger) {
        rock.fled = true;
        const PG = LF.pop ? LF.pop.group : 0;   // 퐁: 근처 바위들도 다 같이
        if (PG) for (const r2 of S.rocks) if (Math.hypot(r2.x - p.x, r2.y - p.y) < PG) r2.fled = true;
        const fl = lf.flies.filter((f) => (f.rock === rock || (PG && f.rock && f.rock.fled && Math.hypot(f.rock.x - p.x, f.rock.y - p.y) < PG)) && (f.state === 'sit' || f.state === 'arrive' || f.state === 'wait'));
        fl.sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y));
        const DL = LF.pop ? LF.pop.stagger : LF.delay;
        fl.forEach((f, i) => { if (f.state === 'wait') { f.x = f.sx; f.y = f.sy; f.z = terrainHeightAt(f.sx, f.sy) + 0.02; f.vis = 0.6; } f.state = 'pre'; f.wait = lerp(DL[0], DL[1], fl.length > 1 ? i / (fl.length - 1) : 0) + Math.random() * 0.04;
          const fd = lerp(LF.forest.d[0], LF.forest.d[1], Math.random()), fy = laneY - lerp(LF.forest.yBack[0], LF.forest.yBack[1], Math.random());
          f.tx = is.shoreAt(fy) + is.side * fd; f.ty = fy; f.tz = terrainHeightAt(f.tx, fy) + 1 + Math.random() * 2; f.ft = 0; f.bend = (Math.random() - 0.5) * 3; });
        log('landFireflyFlee');
      }
      rock.glow = 0;
    }
    const flashed = new Map();
    for (const f of lf.flies) {
      f.trail.push([f.x, f.y, f.z]); if (f.trail.length > Math.max(2, Math.round(LF.tail.time / dt))) f.trail.shift();
      if (f.state === 'wait') { if (S.time >= f.tArrive) f.state = 'arrive'; else continue; }
      if (f.state === 'arrive') {                              // 숲에서 바위로 곡선을 그리며 날아와 앉음
        const tz = terrainHeightAt(f.sx, f.sy) + 0.02, dx = f.sx - f.x, dy = f.sy - f.y, dz = tz - f.z, dd = Math.hypot(dx, dy, dz);
        f.vis = Math.min(1, f.vis + dt * 2);
        if (dd < 0.06) { f.state = 'sit'; f.x = f.sx; f.y = f.sy; f.z = tz; }
        else { const v = Math.min(dd, LF.arriveSpeed * dt * (0.6 + 0.4 * Math.min(1, dd))); f.x += dx / dd * v; f.y += dy / dd * v + Math.sin(S.time * 3 + f.seed) * 0.01; f.z += dz / dd * v; }
      } else if (f.state === 'sit') {                          // 깜빡임: 0.25초 켜짐 → 2~4초 꺼짐. 일부는 이웃이 켜질 때 박자를 당김
        const prev = f.ph; f.ph += dt / f.per;
        if (f.ph >= 1) { f.ph -= 1; flashed.set(f, true); }
        f.rock.glow = Math.max(f.rock.glow, lfBright(f));
      } else if (f.state === 'pre' || f.state === 'pop') {
        if (f.state === 'pre') { f.wait -= dt; if (f.wait > 0) continue;
          if (LF.pop) { const PP = LF.pop, a = Math.random() * Math.PI * 2;   // 퐁: 하늘로 솟으며 살짝 흩어짐
            f.state = 'pop'; f.popT = 0; f.z0 = f.z; f.rise = lerp(PP.rise[0], PP.rise[1], Math.random()); f.svx = Math.cos(a) * PP.scatter; f.svy = Math.sin(a) * PP.scatter * 0.6; continue; } }
        if (f.state === 'pop') { const PP = LF.pop; f.popT += dt; const u = Math.min(1, f.popT / PP.time), e = 1 - (1 - u) * (1 - u) * (1 - u);
          f.z = f.z0 + f.rise * e; const dk = (1 - u) * (1 - u); f.x += f.svx * dk * dt * 2; f.y += f.svy * dk * dt * 2;
          if (u < 1) continue; }
        {
          const DR = LF.drift;                                 // 살짝 떠오른 뒤 펭귄 속도에 맞춰 옆(안쪽)으로 앞서감 → 그대로 숲 안내
          f.state = 'pin'; f.px = f.x; f.py = f.y; f.pz = f.z + DR.lift; f.ft = 0; f.lead = lerp(DR.ahead[0], DR.ahead[1], Math.random()); f.gy = lerp(LF.guide.yBack[0], LF.guide.yBack[1], Math.random()); f.gd = inlandDist(f.x, f.y);
          f.per = LF.pinBlink.on + lerp(LF.pinBlink.off[0], LF.pinBlink.off[1], Math.random()); f.ph = Math.random();
          if (f.popT != null) { f.pz = f.z; f.swarmUntil = S.time + LF.pop.swarmGlow; }   // 퐁 다음엔 솟은 높이에서 그대로 무리 지어 감 (한동안 계속 반짝이며)
          if (lf.pins < lf.pinMax) lf.pins++; else f.fadeAt = S.time + lerp(DR.fadeAfter[0], DR.fadeAfter[1], Math.random());
        } }
      else if (f.state === 'flee') {                           // 퍄다닷: 0.15초 급상승 → 지그재그, 들쭉날쭉한 속도로 숲까지 곡선
        f.ft += dt;
        if (f.ft < LF.burst.time) { f.z += LF.burst.rise / LF.burst.time * dt; continue; }
        const dx = f.tx - f.x, dy = f.ty - f.y, dz = f.tz - f.z, dd = Math.hypot(dx, dy, dz);
        const spd = lerp(LF.speed[0], LF.speed[1], 0.5 + 0.5 * noise1(S.time * 3 + f.seed));
        if (dd < 0.4) {
          if (lf.pins < lf.pinMax) { lf.pins++; f.state = 'pin'; f.px = f.x; f.py = f.y; f.pz = f.z; f.per = LF.pinBlink.on + lerp(LF.pinBlink.off[0], LF.pinBlink.off[1], Math.random()); f.ph = Math.random(); }
          else f.state = 'fade';
        } else {
          const ux = dx / dd, uy = dy / dd, side = Math.sin(f.ft * f.zf * Math.PI * 2) * LF.zigzag.amp;   // 지그재그: 진행 방향 옆으로
          f.x += (ux * spd + -uy * f.bend * 0.3) * dt; f.y += (uy * spd + ux * f.bend * 0.3) * dt + (-ux) * side * dt * 4; f.z += dz / dd * spd * dt;
        }
      } else if (f.state === 'pin') {                          // 숲 안으로 길 안내: 펭귄보다 앞(안쪽)에서 맴돌다 다가오면 더 안쪽으로
        f.ph += dt / f.per; if (f.ph >= 1) f.ph -= 1;
        const GD = LF.guide;
        if (f.lead == null) { f.lead = lerp(GD.lead[0], GD.lead[1], Math.random()); f.gy = lerp(GD.yBack[0], GD.yBack[1], Math.random()); f.gd = inlandDist(f.px, f.py); }
        const pd = Math.max(0, inlandDist(p.x, p.y));
        f.gd = Math.min(GD.endD, Math.max(f.gd, pd + f.lead));   // 뒤로 물러나지 않고 앞으로만
        const tx = is.shoreAt(laneY - f.gy) + is.side * f.gd, ty = laneY - f.gy + Math.sin(S.time * 0.4 + f.seed) * GD.wander;
        const tz = terrainHeightAt(tx, ty) + (GD.height || 0.9) + Math.sin(S.time * 0.7 + f.seed * 2) * GD.wander;
        const DR = LF.drift, ps = Math.hypot(p.vx, p.vy);    // 펭귄 속도에 맞춰 (확 가버리지 않게)
        const dx = tx - f.px, dy = ty - f.py, dz = tz - f.pz, dd = Math.hypot(dx, dy, dz), v = Math.min(dd, clamp(Math.max(ps * DR.speedMul, dd * 0.6), DR.minSpeed, DR.maxSpeed) * dt);
        if (f.fadeAt && S.time > f.fadeAt) { f.state = 'fade'; continue; }
        if (dd > 1e-4) { f.px += dx / dd * v; f.py += dy / dd * v; f.pz += dz / dd * v; }
        f.x = f.px + Math.sin(S.time * 0.5 + f.seed) * LF.pinDrift; f.y = f.py; f.z = f.pz;
      } else if (f.state === 'fade') { f.vis = Math.max(0, f.vis - dt * 2); }
    }
    // 서서히 박자 맞추기: 같은 바위에서 누가 켜지면, sync 인 이웃의 위상을 조금 앞당기고 주기도 평균 쪽으로
    if (flashed.size) for (const f of lf.flies) {
      if (f.state !== 'sit' || !f.sync || flashed.has(f)) continue;
      for (const g2 of flashed.keys()) if (g2.rock === f.rock) { f.ph = Math.min(0.999, f.ph + LF.blink.nudge * f.ph); f.per += (g2.per - f.per) * LF.blink.periodPull; }
    }
  }
  function lfBright(f) {                                       // 깜빡임 밝기 (부드러운 켜짐·꺼짐)
    const LF = C.LAND_FIREFLY, on = (f.state === 'pin' ? LF.pinBlink.on : LF.blink.on) / f.per, x = f.ph;
    if (f.state === 'pop') return (C.LAND_FIREFLY.pop.flash || 1) * Math.max(0.6, f.vis);
    if (f.state === 'arrive' || f.state === 'flee' || f.state === 'pre') return 0.75 * f.vis;
    if (f.state === 'fade') return 0.6 * f.vis;
    const bl = x < on ? Math.sin(Math.PI * x / on) : 0.04;        // 꺼진 동안도 아주 희미하게
    if (f.swarmUntil && S.time < f.swarmUntil + 1.5) {          // 우르르르 무리: 한동안 켜진 채 일렁이다 서서히 깜빡임으로
      const k = 1 - smooth(f.swarmUntil - 1.5, f.swarmUntil + 1.5, S.time);
      return Math.max(bl, k * (0.62 + 0.25 * Math.sin(S.time * 7 + f.seed * 5)));
    }
    return bl;
  }
  function landFireflyItems(items) {
    const LF = C.LAND_FIREFLY, lf = S.lf; if (!LF || !lf) return;
    for (const f of lf.flies) {
      if (f.state === 'wait' || f.vis <= 0.01 && f.state !== 'sit' && f.state !== 'pin') continue;
      const c = camSpace(f.x, f.y, f.z); if (c[1] < rig.near + 0.2) continue;
      items.push({ d: c[1] - 0.02, draw: () => drawLandFirefly(f, c) });
    }
  }
  function drawLandFirefly(f, c) {
    const LF = C.LAND_FIREFLY, sp = lfSprites(), b = lfBright(f) * (1 - fogAt(c[1]) * 0.7);
    if (b < 0.01) return;
    const [sx, sy] = toScreen(c), ppu = pxPerUnit(c[1]), R = Math.max(0.7, f.size * ppu);
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    // 아주 짧은 꼬리 (움직일 때만)
    const t0 = f.trail[0];
    if (t0 && (f.state === 'flee' || f.state === 'arrive' || f.state === 'pop')) { const q = project(t0[0], t0[1], t0[2]); ctx.globalAlpha = LF.tail.alpha * b; ctx.strokeStyle = sp.P.mid[0]; ctx.lineWidth = Math.max(0.8, R * 0.6); ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(q[0], q[1]); ctx.lineTo(sx, sy); ctx.stroke(); }
    const go = R * LF.glowScale[0] * 2, gm = R * LF.glowScale[1] * 2;
    ctx.globalAlpha = sp.P.outer[1] * b; ctx.drawImage(sp.outer, sx - go, sy - go, go * 2, go * 2);
    ctx.globalAlpha = sp.P.mid[1] * b; ctx.drawImage(sp.mid, sx - gm, sy - gm, gm * 2, gm * 2);
    ctx.globalAlpha = Math.min(1, b); ctx.drawImage(sp.core, sx - R, sy - R, R * 2, R * 2);
    ctx.restore();
  }

  // ── 눈가루: 빙하에 오르내릴 때 발밑에서 흩날림 ───────────
  // 터보건: 발로 찰 때 모래 알갱이 (눈가루 입자 재사용, 색만 다르게)
  function tobPuff(x, y, z) {
    const TB = C.PHYSICS.toboggan, SP = C.SNOW_PUFF; if (!SP || !TB) return;
    S.snow = S.snow || [];
    const n = Math.round(lerp(TB.puff.count[0], TB.puff.count[1], Math.random()));
    for (let i = 0; i < n; i++) {
      if (S.snow.length >= SP.max) S.snow.shift();
      const a = Math.random() * Math.PI * 2, sp = lerp(0.3, 1.0, Math.random());
      S.snow.push({ x, y, z: z + 0.02, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.6, vz: lerp(0.8, 1.6, Math.random()), t: 0, life: lerp(0.35, 0.6, Math.random()), size: lerp(0.012, 0.026, Math.random()), col: TB.puff.color });
    }
  }
  function snowPuff(x, y, z, big) {
    const SP = C.SNOW_PUFF; if (!SP) return;
    S.snow = S.snow || [];
    const n = Math.round(lerp(...(big ? SP.landCount : SP.count), Math.random()));
    for (let i = 0; i < n; i++) {
      if (S.snow.length >= SP.max) S.snow.shift();
      const a = Math.random() * Math.PI * 2, s = lerp(SP.speed[0], SP.speed[1], Math.random());
      S.snow.push({ x: x + Math.cos(a) * 0.15, y: y + Math.sin(a) * 0.12, z: z + 0.03, vx: Math.cos(a) * s, vy: Math.sin(a) * s * 0.6, vz: lerp(SP.up[0], SP.up[1], Math.random()), t: 0, life: lerp(SP.life[0], SP.life[1], Math.random()), size: lerp(SP.size[0], SP.size[1], Math.random()) });
    }
  }
  // 물방울: 빠진 자리 둘레로 튀었다 떨어짐. 수면에 닿으면 아주 작은 파문
  function splashDrops(x, y, vz) {
    const SD = C.SPLASH_DROPS; if (!SD) return;
    S.drops = S.drops || [];
    const k = clamp(vz / 5, 0.3, 1.4), R = Math.random, add = (q) => { if (S.drops.length >= SD.max) S.drops.shift(); S.drops.push(q); };
    const n = Math.round(lerp(SD.count[0], SD.count[1], R()) + vz * SD.perSpeed);
    for (let i = 0; i < n; i++) {
      const a = R() * Math.PI * 2, s = lerp(SD.speed[0], SD.speed[1], R()) * k, r0 = 0.2 + R() * 0.2;
      add({ x: x + Math.cos(a) * r0, y: y + Math.sin(a) * r0 * 0.8, z: 0.05, vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: lerp(SD.up[0], SD.up[1], R()) * k * (1 - 0.5 * R()), size: lerp(SD.size[0], SD.size[1], Math.pow(R(), 2)), t: 0 });
    }
    if (SD.crown) {                                            // 물 왕관: 둘레 고리에서 위로 솟는 큰 방울들 (고르게 퍼진 각도)
      const CR = SD.crown, nc = Math.round(lerp(CR.count[0], CR.count[1], R()) * Math.min(1.3, 0.6 + k * 0.5));
      for (let i = 0; i < nc; i++) { const a = (i + R() * 0.6) / nc * Math.PI * 2, r0 = lerp(CR.radius[0], CR.radius[1], R()), o = lerp(CR.out[0], CR.out[1], R()) * k;
        add({ x: x + Math.cos(a) * r0, y: y + Math.sin(a) * r0 * 0.8, z: 0.04, vx: Math.cos(a) * o, vy: Math.sin(a) * o * 0.8, vz: lerp(CR.up[0], CR.up[1], R()) * k, size: lerp(CR.size[0], CR.size[1], Math.pow(R(), 1.5)), t: 0, big: true }); }
      const SP2 = SD.spray, ns = Math.round(lerp(SP2.count[0], SP2.count[1], R()) * k);   // 잔 물보라: 빠르고 작게, 사방으로
      for (let i = 0; i < ns; i++) { const a = R() * Math.PI * 2, o = lerp(SP2.out[0], SP2.out[1], R()) * k;
        add({ x: x + Math.cos(a) * 0.15, y: y + Math.sin(a) * 0.12, z: 0.08, vx: Math.cos(a) * o, vy: Math.sin(a) * o * 0.8, vz: lerp(SP2.up[0], SP2.up[1], R()) * k, size: lerp(SP2.size[0], SP2.size[1], R()), t: 0 }); }
      S.sheets = S.sheets || []; S.sheets.push({ x, y, t: 0, k, ph: R() * 6.28 });
    }
  }
  function stepDrops(dt) {
    const SD = C.SPLASH_DROPS; if (!SD || !S.drops || !S.drops.length) return;
    for (const q of S.drops) { q.t += dt; q.vz -= SD.gravity * dt; q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
      if (q.z <= 0 && q.vz < 0) { q.dead = true; if (sim && SD.ring > 0 && q.size > 0.012) sim.drop(q.x, q.y, 0.12, -0.004 * SD.ring); } }
    S.drops = S.drops.filter((q) => !q.dead && q.t < 2);
    if (S.sheets) { for (const s of S.sheets) s.t += dt; S.sheets = S.sheets.filter((s) => s.t < SD.sheet.life); }
  }
  function stepSnow(dt) {
    const SP = C.SNOW_PUFF; if (!SP || !S.snow) return;
    const k = Math.exp(-SP.drag * dt);
    const sw = SP.swirl || 0;
    for (const q of S.snow) { q.t += dt; if (sw && !q.col) { q.vx += (Math.random() - 0.5) * sw * 6 * dt; q.vy += (Math.random() - 0.5) * sw * 6 * dt; q.vz += (Math.random() - 0.5) * sw * 4 * dt; } q.vx *= k; q.vy *= k; q.vz = q.vz * k - (q.col ? 3.5 : SP.gravity) * dt; q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt; }
    S.snow = S.snow.filter((q) => q.t < q.life);
  }
  function dropItems(items) {
    const SD = C.SPLASH_DROPS; if (!SD || ((!S.drops || !S.drops.length) && (!S.sheets || !S.sheets.length))) return;
    items.push({ d: camSpace(S.p.x, S.p.y, 0)[1] - 0.06, draw: () => {
      const col = SD.color.join(',');
      // 물 왕관: 둘레 고리에서 들쭉날쭉한 윗선까지 옅은 막 + 윗선은 밝게 (솟았다 무너짐)
      if (SD.sheet && S.sheets) for (const s of S.sheets) {
        const SH = SD.sheet, u = s.t / SH.life, hgt = SH.height * s.k * Math.sin(Math.PI * Math.min(1, u * 1.1)), rad = lerp(SH.radius[0], SH.radius[1], Math.sqrt(u)) * (0.7 + 0.3 * s.k), n = SH.points;
        const base = [], top = [];
        for (let i = 0; i <= n; i++) {
          const a = i / n * Math.PI * 2 + s.ph, j = 0.55 + 0.45 * Math.abs(Math.sin(a * 2.5 + s.ph * 3) * Math.cos(a * 4.1 - s.ph));   // 들쭉날쭉한 높이
          const bx = s.x + Math.cos(a) * rad, by = s.y + Math.sin(a) * rad * 0.8, ro = rad * (1 + SH.lean * u);
          base.push(camSpace(bx, by, 0)); top.push(camSpace(s.x + Math.cos(a) * ro, s.y + Math.sin(a) * ro * 0.8, hgt * j));
        }
        if (base.some((c2) => c2[1] < rig.near) || top.some((c2) => c2[1] < rig.near)) continue;
        const B = base.map(toScreen), T = top.map(toScreen), fade = (1 - u) * (1 - u);   // 빠르게 사라짐
        ctx.fillStyle = `rgb(${col})`; ctx.globalAlpha = SH.alpha * fade;
        for (let i = 0; i < n; i++) { ctx.beginPath(); ctx.moveTo(B[i][0], B[i][1]); ctx.lineTo(B[i + 1][0], B[i + 1][1]); ctx.lineTo(T[i + 1][0], T[i + 1][1]); ctx.lineTo(T[i][0], T[i][1]); ctx.closePath(); ctx.fill(); }
        ctx.strokeStyle = `rgb(${col})`; ctx.globalAlpha = SH.rimAlpha * fade; ctx.lineWidth = Math.max(0.7, SH.width * pxPerUnit(base[0][1])); ctx.lineJoin = 'round';
        ctx.beginPath(); T.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
      }
      ctx.fillStyle = `rgb(${col})`;
      for (const q of S.drops || []) { const c = camSpace(q.x, q.y, q.z); if (c[1] < rig.near) continue; const [sx, sy] = toScreen(c), r = Math.max(SD.minPx || 0.6, q.size * pxPerUnit(c[1]));
        ctx.globalAlpha = SD.alpha * Math.min(1, q.t * 20); ctx.beginPath(); ctx.ellipse(sx, sy, r, r * (1 + Math.min(1.2, Math.abs(q.vz) * 0.15)), 0, 0, Math.PI * 2); ctx.fill();   // 빠를수록 세로로 살짝 늘어남
        if (q.big && SD.highlight && r > 1.4) { ctx.fillStyle = '#ffffff'; ctx.globalAlpha = SD.highlight * SD.alpha * Math.min(1, q.t * 20); ctx.beginPath(); ctx.arc(sx - r * 0.3, sy - r * 0.3, r * 0.35, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = `rgb(${col})`; } }
      ctx.globalAlpha = 1;
    } });
  }
  function snowItems(items) {
    const SP = C.SNOW_PUFF; if (!SP || !S.snow || !S.snow.length) return;
    items.push({ d: camSpace(S.p.x, S.p.y, S.p.z)[1] - 0.05, draw: () => {
      ctx.fillStyle = `rgb(${SP.color.join(',')})`;
      const base = `rgb(${SP.color.join(',')})`;
      for (const q of S.snow) { const c = camSpace(q.x, q.y, q.z); if (c[1] < rig.near) continue; const [sx, sy] = toScreen(c), r = Math.max(q.col ? 0.7 : (SP.minPx || 0.7), q.size * pxPerUnit(c[1]) * (q.col ? 1 : 1 + ((SP.grow || 1) - 1) * q.t / q.life));
        ctx.fillStyle = q.col ? `rgb(${q.col.join(',')})` : base;
        ctx.globalAlpha = SP.alpha * (1 - q.t / q.life) * Math.min(1, q.t * 12); ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill(); }
      ctx.globalAlpha = 1;
    } });
  }

  // 디버그 오버레이 (?debug=terrain): 지면 선 · 구역 색 · 해안선 · 바위 (반투명)
  function drawTerrainDebug() {
    const is = S.islands[0]; if (!is) return;
    const laneY = C.lane ? C.lane.y : 0, DC = IT.debugColors;
    ctx.save(); ctx.globalAlpha = 0.75; ctx.lineWidth = 2.5;
    let prev = null;
    for (let d = 0; d <= IT.ground.maxDist; d += 0.5) {
      const x = is.shoreAt(laneY) + is.side * d, c = camSpace(x, laneY, terrainHeightAt(x, laneY)); if (c[1] < rig.near) { prev = null; continue; }
      const sp = toScreen(c), zn = zoneAt(d).z.name;
      if (prev) { ctx.strokeStyle = `rgb(${DC[zn].join(',')})`; ctx.beginPath(); ctx.moveTo(prev[0], prev[1]); ctx.lineTo(sp[0], sp[1]); ctx.stroke(); }
      prev = sp;
    }
    for (const z of IT.zones) { if (z.to > IT.ground.maxDist) continue; const x = is.shoreAt(laneY) + is.side * z.to, a = project(x, laneY, terrainHeightAt(x, laneY)); if (a[2] < rig.near) continue; ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.font = '11px sans-serif'; ctx.fillText(z.name + ' |', a[0] - 40, a[1] - 8); }
    { const x = is.shoreAt(laneY), a = project(x, laneY, 0), b = project(x, laneY, 3); if (a[2] > rig.near) { ctx.strokeStyle = 'rgba(80,200,255,0.9)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); ctx.fillStyle = 'rgba(80,200,255,0.9)'; ctx.fillText('shoreX ' + x.toFixed(1), b[0] + 4, b[1]); } }
    for (const r of S.rocks || []) { const e = groundEllipse(r.x, r.y, r.R, terrainHeightAt(r.x, r.y)); if (!e) continue; ctx.strokeStyle = 'rgba(255,90,90,0.9)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.ellipse(e.x, e.y, e.rx, Math.max(2, e.ry), 0, 0, Math.PI * 2); ctx.stroke(); ctx.fillStyle = 'rgba(255,90,90,0.9)'; ctx.fillText('rock d' + r.d, e.x + e.rx + 3, e.y); }
    ctx.restore();
  }
  function drawIslandGround() {
    if (IT) { drawTerrain(); return; }
    const h = C.world.shoreHeight;
    for (const is of S.islands) {
      const d = camSpace(is.shoreX, clamp(cam.y, -is.ry, is.ry), 0)[1];
      if (d < -is.rx * 2) continue;
      const fog = fogAt(Math.max(d, 0), C.FOG.mountain);
      ctx.fillStyle = mixFog(C.DEPTH.dryColor, fog); fillPoly(projPoly(is.shape.map(([x, y]) => [x, y, h])));   // 마른 모래 (완만해서 옆면 없음)
    }
  }

  // 해안: 젖은 땅(어둡게) → 얇은 물막 → 물 끝선의 옅은 흰 선 → 물막 위 작은 파문 → 발자국
  // 해안 그라데이션: 해안선을 따라 놓인 띠들을 한 장씩 채움 (선 없이 색·투명도만)
  function shoreBand(d0, d1, z, segs) {
    const outer = [], inner = [];
    for (const q of segs) { outer.push([q.x + q.nx * d0, q.y + q.ny * d0, z]); inner.push([q.x + q.nx * d1, q.y + q.ny * d1, z]); }
    return projPoly(outer.concat(inner.reverse()));
  }
  // 띠 사이에 이음선이 생기지 않도록, 모두 물가에서 시작하는 겹친 면을 바깥부터 쌓아 목표 알파를 만듦
  // A_i = 1 - (1 - A_{i+1})(1 - α_i)  →  α_i = 1 - (1 - A_i) / (1 - A_{i+1})
  function nestedBands(n, edgeOf, targetOf, polyOf) {
    let outer = 0;
    for (let i = n - 1; i >= 0; i--) {
      const A = clamp(targetOf(i), 0, 0.99), al = 1 - (1 - A) / (1 - outer);
      if (al > 0.002) { ctx.globalAlpha = al; fillPoly(polyOf(edgeOf(i))); }
      outer = Math.max(outer, A);
    }
  }
  function visibleShore() {
    const ws = washShape(), R = C.DEPTH.viewRange;
    return ws.segs.filter((q) => Math.hypot(q.x - cam.x, q.y - cam.y) < R);
  }
  // 얕은 물: 모래색이 비치다가(alpha 0.65) 깊어질수록 투명 → 깊은 물
  function drawShallows() {
    const D = C.DEPTH, segs = visibleShore();
    if (segs.length < 2) return;
    const d0c = camSpace(segs[segs.length >> 1].x, segs[segs.length >> 1].y, 0)[1], fog = fogAt(Math.max(d0c, 0), C.FOG.mountain);
    if (fog > 0.97) return;
    ctx.fillStyle = `rgb(${D.sandColor.join(',')})`;
    const n = D.strips, maxD = D.slope, target = (d) => D.sandAlpha * (1 - smooth(0, D.shallowEnd, Math.pow(smooth(0, D.slope, d), D.power))) * (1 - fog);
    nestedBands(n, (i) => (i + 1) / n * maxD, (i) => target((i + 0.5) / n * maxD), (d1) => shoreBand(-0.3, d1, 0, segs));
    ctx.globalAlpha = 1;
  }
  // 파도 열차 그리기: 파면마다 밝은 띠 + 바로 뒤 어두운 골 (선 없이 명암 면). 저해상도 두 장에 그려 부드럽게 키움
  const crestCv = document.createElement('canvas'), crestG = crestCv.getContext('2d');
  const troughCv = document.createElement('canvas'), troughG = troughCv.getContext('2d');
  function drawShoreTrain() {
    const ws = washShape(), TR = C.SHORE_WASH.train, tb = ws.table, segs = visibleShore().filter((_, i) => i % 2 === 0);   // 파면은 완만해서 구간 2개마다 하나로 충분
    if (segs.length < 2 || !ws.waves.length) return;
    const res = offRes(TR.resolution), w = Math.max(8, Math.ceil(W * res)), h = Math.max(8, Math.ceil(H * res));
    for (const cv of [crestCv, troughCv]) fitCv(cv, w, h);
    for (const g2 of [crestG, troughG]) { g2.setTransform(1, 0, 0, 1, 0, 0); g2.clearRect(0, 0, w, h); g2.setTransform(res, 0, 0, res, 0, 0); g2.fillStyle = '#000'; }
    const a0 = TR.alpha[0], a1 = TR.alpha[1], peak = TR.alpha[1] * TR.steepBoost;
    const quad = (g2, a, b, d0a, d1a, d0b, d1b, al) => {
      const pts = [[a.x + a.nx * d0a, a.y + a.ny * d0a, 0], [b.x + b.nx * d0b, b.y + b.ny * d0b, 0], [b.x + b.nx * d1b, b.y + b.ny * d1b, 0], [a.x + a.nx * d1a, a.y + a.ny * d1a, 0]].map((q) => camSpace(...q));
      if (pts.some((c) => c[1] < rig.near + 0.2)) return false;
      g2.globalAlpha = Math.min(1, al / peak);
      g2.beginPath(); pts.forEach((c, j) => { const s = toScreen(c); j ? g2.lineTo(s[0], s[1]) : g2.moveTo(s[0], s[1]); }); g2.closePath(); g2.fill();
      return true;
    };
    let any = false;
    for (const wv of ws.waves) {
      // 구간마다 파면 위치 d (해안선에서 바다 쪽 거리), 그 자리 수심·파장·진하기
      const st = segs.map((q) => {
        const tau = waveArrive(wv, q) - S.time;
        if (tau <= 0 || tau >= tb.Tmax) return null;
        const SW = C.SHORE_WASH.swash, acc = SW && tau < SW.accelTime;   // 도달 직전: 가속하며 앞이 가팔라짐
        const d = acc ? trainDist(tb, SW.accelTime) * Math.pow(tau / SW.accelTime, SW.accelPow) : trainDist(tb, tau), dep = tb.dep(d), lam = TR.speedDeep * Math.sqrt(dep) * TR.gap;
        const sh = Math.min(TR.shoalMax, Math.pow(dep, -TR.shoal));
        const steep = Math.exp(-Math.pow((dep - TR.steepDepth) / 0.09, 2));            // 수심 0.2 부근에서 가팔라짐
        const cd = camSpace(q.x + q.nx * d, q.y + q.ny * d, 0)[1], fade = smooth(TR.fadeDepth, TR.fadeDepth * 2.5, dep) * (1 - smooth(TR.startDist * 0.7, TR.startDist, d)) * (1 - fogAt(cd)) * (TR.nearFade ? smooth(TR.nearFade[0], TR.nearFade[1], cd) : 1);
        const al = lerp(a0, a1, clamp((sh - 1) / (TR.shoalMax - 1), 0, 1)) * Math.min(1.2, wv.amp) * (1 + (TR.steepBoost - 1) * steep) * fade;
        return { d, cw: lam * TR.crest * (1 - TR.steepNarrow * steep) * (acc ? 0.5 + 0.5 * tau / SW.accelTime : 1), tw: lam * TR.trough, al };
      });
      for (let i = 0; i < segs.length - 1; i++) {
        const A = st[i], B = st[i + 1];
        if (!A || !B || (A.al < 0.004 && B.al < 0.004)) continue;
        const a = segs[i], b = segs[i + 1], al = (A.al + B.al) / 2;
        // 밝은 띠: 가운데가 진하고 양끝이 옅은 3겹 (해안 쪽 앞면이 가파름)
        for (const [u0, u1, k] of [[-0.5, 0.5, 0.45], [-0.3, 0.35, 0.35], [-0.12, 0.18, 0.3]]) any = quad(crestG, a, b, A.d + A.cw * u0, A.d + A.cw * u1, B.d + B.cw * u0, B.d + B.cw * u1, al * k) || any;
        // 어두운 골: 밝은 띠 바로 뒤 (바다 쪽)
        for (const [u0, u1, k] of [[-0.1, 1, 0.4], [0.1, 0.8, 0.35], [0.25, 0.6, 0.3]]) quad(troughG, a, b, A.d + A.cw * 0.5 + A.tw * u0, A.d + A.cw * 0.5 + A.tw * u1, B.d + B.cw * 0.5 + B.tw * u0, B.d + B.cw * 0.5 + B.tw * u1, al * TR.troughAlpha * k);
      }
    }
    if (!any) return;
    // 알파 마스크(검정) → 색 입히기: source-in 으로 색을 채운 뒤 화면에 얹음
    for (const [g2, col] of [[troughG, TR.dark], [crestG, TR.light]]) {
      g2.setTransform(1, 0, 0, 1, 0, 0); g2.globalAlpha = 1; g2.globalCompositeOperation = 'source-in';
      g2.fillStyle = `rgb(${col.join(',')})`; g2.fillRect(0, 0, w, h); g2.globalCompositeOperation = 'source-over';
    }
    ctx.imageSmoothingEnabled = true; ctx.globalAlpha = peak;
    ctx.drawImage(troughCv, 0, 0, W, H); ctx.drawImage(crestCv, 0, 0, W, H);
    ctx.globalAlpha = 1;
  }
  // 해안 파도 위상 (반딧불이용): 그 자리 가까운 구간의 swash 진행 0~1 과 올라오는 중인지
  function washLevelAt(x, y) {
    const ws = washShape(); let best = null, bd = Infinity;
    for (const q of ws.segs) { const d = Math.abs(q.y - y); if (d < bd) { bd = d; best = q; } }
    return best ? (best.level || 0) : 0;
  }
  const wetCv = document.createElement('canvas'), wetG = wetCv.getContext('2d');
  const filmCv = document.createElement('canvas'), filmG = filmCv.getContext('2d');
  function drawShoreWash() {
    const ws = washShape(), Wsh = C.SHORE_WASH, z = C.world.shoreHeight + 0.004, zIn = (dep) => (IT ? C.world.shoreHeight + profileAt(dep) : C.world.shoreHeight) + 0.004;   // 지형 높이를 따라
    if (ws.segs.length < 2) return;
    const d0 = camSpace(ws.is.shoreX, clamp(cam.y, -ws.is.ry, ws.is.ry), 0)[1];
    if (d0 < -ws.is.rx) return;
    const fog = fogAt(Math.max(d0, 0), C.FOG.mountain);
    if (fog > 0.97) return;
    const D = C.DEPTH, segsV = visibleShore();
    // 젖은 모래: 물가 쪽이 가장 어둡고 안쪽으로 갈수록 마른 모래로 (띠 그라데이션)
    ctx.fillStyle = `rgb(${D.wetColor.join(',')})`;
    if (segsV.length > 1) nestedBands(8, (i) => -(i + 1) / 8 * D.wetSandWidth, (i) => (1 - (i + 0.5) / 8) * 0.85 * (1 - fog), (d1) => shoreBand(0.05, d1, z - 0.002, segsV));
    // 파도 젖음 맵 + 물막: 낮은 해상도 오프스크린 두 장에 칸별 면으로 그려 부드럽게 키움 (선 없음)
    const B = Wsh.bins, maxIn = Wsh.shoreWidth * Wsh.reach * Wsh.binReach;
    const SW = Wsh.swash, res = SW ? offRes(Wsh.resolution) : C.SHADOW_BLUR.wetResolution, w = Math.max(8, Math.ceil(W * res)), h = Math.max(8, Math.ceil(H * res));
    const SHT = Wsh.sheet, fres = SHT ? offRes(SHT.resolution) : res, fw2 = Math.max(8, Math.ceil(W * fres)), fh2 = Math.max(8, Math.ceil(H * fres));
    fitCv(wetCv, w, h); fitCv(filmCv, fw2, fh2);
    wetG.setTransform(1, 0, 0, 1, 0, 0); wetG.clearRect(0, 0, w, h); wetG.setTransform(res, 0, 0, res, 0, 0);
    filmG.setTransform(1, 0, 0, 1, 0, 0); filmG.globalAlpha = 1; filmG.clearRect(0, 0, fw2, fh2); filmG.setTransform(fres, 0, 0, fres, 0, 0);
    wetG.fillStyle = `rgb(${rgbS(PAL.wetSand)})`; filmG.fillStyle = `rgb(${rgbS(PAL.film)})`;
    let anyW = false, anyF = false;
    const at = (q, dep) => camSpace(q.x - q.nx * dep, q.y - q.ny * dep, zIn(dep));
    if (!SW) for (let i = 0; i < segsV.length - 1; i++) {
      const a = segsV[i], b = segsV[i + 1];
      if (!a.wet || !b.wet) continue;
      for (let k = 0; k < B; k++) {
        const d0 = k / B * maxIn, d1 = (k + 1) / B * maxIn;
        const wv = (a.wet[k] + b.wet[k]) / 2;
        // 올라오는 물 앞쪽 밝은 막(해안 쪽으로 갈수록 투명) + 빠진 뒤 남는 얇은 막
        const reach = (a.reach + b.reach) / 2, front = SHT ? 0 : reach > d0 ? Wsh.waterAlpha * clamp(d1 / Math.max(reach, 0.01), 0, 1) : 0;
        const fv = Math.max(front, (SHT ? SHT.residue : Wsh.filmAlpha) * smooth(0, 1, (a.film[k] + b.film[k]) / 2) * (SHT && reach > d1 ? 0 : 1));   // GRIS: 칸 단위 막은 빠진 뒤 남는 얇은 막만
        if (wv < 0.01 && fv < 0.01) continue;
        const pts = [at(a, d0), at(b, d0), at(b, d1), at(a, d1)];
        if (pts.some((c) => c[1] < rig.near)) continue;
        const sp = pts.map(toScreen);
        const path = (g2) => { g2.beginPath(); sp.forEach(([x, y], j) => (j ? g2.lineTo(x, y) : g2.moveTo(x, y))); g2.closePath(); g2.fill(); };
        if (wv >= 0.01) { wetG.globalAlpha = wv * (1 - k / B * 0.5); path(wetG); anyW = true; }   // 가장자리로 갈수록 넓게 옅어짐
        if (fv >= 0.01) { filmG.globalAlpha = Math.min(1, fv); path(filmG); anyF = true; }
      }
    }
    // 이웃 구간 사이를 코사인 보간으로 쪼갬 → 끝선·젖음 경계에 계단이 안 생김
    let segsS = segsV;
    if (SW && segsV.length > 1) {
      segsS = [];
      const ci = (u, v, t) => u + (v - u) * (1 - Math.cos(Math.PI * t)) / 2;
      for (let i = 0; i < segsV.length - 1; i++) {
        const a = segsV[i], b = segsV[i + 1];
        for (let m = 0; m < SW.sub; m++) {
          const t = m / SW.sub, nx = lerp(a.nx, b.nx, t), ny = lerp(a.ny, b.ny, t), nl = Math.hypot(nx, ny) || 1;
          segsS.push({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), nx: nx / nl, ny: ny / nl, s: lerp(a.s, b.s, t), reach: ci(a.reach, b.reach, t),
            wetR: ci(a.wetR || 0, b.wetR || 0, t), filmR: ci(a.filmR || 0, b.filmR || 0, t), thin: ci(a.thin ?? 1, b.thin ?? 1, t), foam: ci(a.foam || 0, b.foam || 0, t) });
        }
      }
      segsS.push(segsV[segsV.length - 1]);
      // 젖은 모래: [0, wetR] 를 채우고 가장자리 wetEdge 만큼 알파 경사 (먼 곳부터 마름)
      const strip = (g2, a, b, da0, da1, db0, db1) => {
        const pts = [at(a, da0), at(b, db0), at(b, db1), at(a, da1)];
        if (pts.some((c) => c[1] < rig.near)) return false;
        g2.beginPath(); pts.forEach((c, j) => { const sp = toScreen(c); j ? g2.lineTo(sp[0], sp[1]) : g2.moveTo(sp[0], sp[1]); }); g2.closePath(); g2.fill(); return true;
      };
      const E = 5;
      for (let i = 0; i < segsS.length - 1; i++) {
        const a = segsS[i], b = segsS[i + 1], wa = a.wetR || 0, wb = b.wetR || 0;
        if (wa > 0.02 || wb > 0.02) {
          const ea = Math.min(SW.wetEdge, wa), eb = Math.min(SW.wetEdge, wb);
          wetG.globalAlpha = 1; if (strip(wetG, a, b, 0, wa - ea, 0, wb - eb)) anyW = true;
          for (let k = 0; k < E; k++) { wetG.globalAlpha = 1 - (k + 0.5) / E; strip(wetG, a, b, wa - ea * (1 - k / E), wa - ea * (1 - (k + 1) / E), wb - eb * (1 - k / E), wb - eb * (1 - (k + 1) / E)); }
        }
        // 빠진 뒤 남는 얇은 막: [끝선, filmR] 에 옅게, 바깥으로 갈수록 0
        const fa = Math.max(0, (a.filmR || 0) - a.reach), fb = Math.max(0, (b.filmR || 0) - b.reach);
        if (SHT && (fa > 0.02 || fb > 0.02)) for (let k = 0; k < E; k++) {
          filmG.globalAlpha = SHT.residue * (1 - (k + 0.5) / E);
          if (strip(filmG, a, b, a.reach + fa * k / E, a.reach + fa * (k + 1) / E, b.reach + fb * k / E, b.reach + fb * (k + 1) / E)) anyF = true;
        }
      }
    }
    // GRIS: 올라온 물막 — 물가(투명) → 앞선(은은하게)으로 이어지는 얇은 면 + 군데군데 끊기는 가는 앞선 테두리
    if (SHT) {
      const n = SHT.strips, quad = (a, b, da0, da1, db0, db1) => {
        const pts = [at(a, da0), at(b, db0), at(b, db1), at(a, da1)];
        if (pts.some((c) => c[1] < rig.near)) return false;
        filmG.beginPath(); pts.forEach((c, j) => { const s = toScreen(c); j ? filmG.lineTo(s[0], s[1]) : filmG.moveTo(s[0], s[1]); }); filmG.closePath(); filmG.fill(); return true;
      };
      for (let i = 0; i < segsS.length - 1; i++) {
        const a = segsS[i], b = segsS[i + 1], thin = ((a.thin ?? 1) + (b.thin ?? 1)) / 2;
        if (a.reach < 0.03 && b.reach < 0.03) continue;
        for (let k = 0; k < n; k++) {                          // 물가 → 앞선: 진하기가 서서히 올라감 (겹치지 않는 띠). 빠질수록 얇아짐
          const u0 = k / n, u1 = (k + 1) / n;
          filmG.globalAlpha = lerp(SHT.alpha[0], SHT.alpha[1], Math.pow(u1, 1.5)) * thin;
          if (quad(a, b, a.reach * u0, a.reach * u1, b.reach * u0, b.reach * u1)) anyF = true;
        }
        const brk = smooth(0.25, 0.6, 0.5 + 0.5 * noise1(a.s / 0.6 + S.time * 0.4));   // 앞선 테두리: 군데군데 끊김
        if (brk > 0.02) { filmG.globalAlpha = SHT.lipAlpha * brk * thin; quad(a, b, a.reach, Math.max(0, a.reach - SHT.lip), b.reach, Math.max(0, b.reach - SHT.lip)); }
      }
    }
    ctx.imageSmoothingEnabled = true;
    if (anyW) { ctx.globalAlpha = Wsh.wetAlpha * (1 - fog); ctx.drawImage(wetCv, 0, 0, W, H); }
    if (anyF) { ctx.globalAlpha = (SHT ? 1 : Math.max(Wsh.waterAlpha, Wsh.filmAlpha)) * (1 - fog); ctx.drawImage(filmCv, 0, 0, W, H); }
    // 거품: 물막 앞선의 흰 띠 + 그 뒤 성긴 띠 (노이즈로 끊김). 올라올 때 진하고 빠지면서 사라짐
    if (SHT) {                                                 // GRIS: 거품 = 앞선을 따라 가늘게 끊기는 레이스 조각 (구간을 쪼개 무늬를 잘게)
      const FO = Wsh.foam, L = SHT.lace, fr = offRes(SHT.resolution), fw = Math.max(8, Math.ceil(W * fr)), fh = Math.max(8, Math.ceil(H * fr));
      fitCv(crestCv, fw, fh); crestG.setTransform(1, 0, 0, 1, 0, 0); crestG.globalCompositeOperation = 'source-over'; crestG.clearRect(0, 0, fw, fh); crestG.setTransform(fr, 0, 0, fr, 0, 0);
      crestG.fillStyle = `rgb(${rgbS(FO.color)})`;
      let anyFo = false;
      for (let i = 0; i < segsS.length - 1; i++) {
        const a = segsS[i], b = segsS[i + 1], fo = ((a.foam || 0) + (b.foam || 0)) / 2;
        if (fo < 0.03 || (a.reach < 0.03 && b.reach < 0.03)) continue;
        for (let m = 0, nsub = SW ? 1 : L.sub; m < nsub; m++) {
          const t0 = m / nsub, t1 = (m + 1) / nsub, s = lerp(a.s, b.s, (t0 + t1) / 2);
          const nz = 0.5 + 0.5 * noise1(s / lerp(L.length[0], L.length[1], 0.5) + 13.7), nz2 = 0.5 + 0.5 * noise1(s * 2.3 - S.time * 0.25 + 71);
          if (nz < L.gap) continue;                            // 끊긴 자리
          const wdt = lerp(L.width[0], L.width[1], nz2) * fo, off = (nz2 - 0.5) * 0.08;
          const P = (q0, q1, t) => ({ x: lerp(q0.x, q1.x, t), y: lerp(q0.y, q1.y, t), nx: lerp(q0.nx, q1.nx, t), ny: lerp(q0.ny, q1.ny, t), reach: lerp(q0.reach, q1.reach, t) });
          const A = P(a, b, t0), Bq = P(a, b, t1);
          const pts = [at(A, Math.max(0, A.reach + off)), at(Bq, Math.max(0, Bq.reach + off)), at(Bq, Math.max(0, Bq.reach + off - wdt)), at(A, Math.max(0, A.reach + off - wdt))];
          if (pts.some((c) => c[1] < rig.near)) continue;
          crestG.globalAlpha = Math.min(1, fo * smooth(L.gap, L.gap + 0.2, nz));
          crestG.beginPath(); pts.forEach((c, j) => { const sp = toScreen(c); j ? crestG.lineTo(sp[0], sp[1]) : crestG.moveTo(sp[0], sp[1]); }); crestG.closePath(); crestG.fill();
          anyFo = true;
        }
      }
      if (anyFo) { ctx.globalAlpha = L.alpha * (1 - fog); ctx.drawImage(crestCv, 0, 0, W, H); }
    } else { const FO = Wsh.foam, fr = Wsh.train.resolution, fw = Math.max(8, Math.ceil(W * fr)), fh = Math.max(8, Math.ceil(H * fr));
      fitCv(crestCv, fw, fh); crestG.setTransform(1, 0, 0, 1, 0, 0); crestG.globalCompositeOperation = 'source-over'; crestG.clearRect(0, 0, fw, fh); crestG.setTransform(fr, 0, 0, fr, 0, 0);
      crestG.fillStyle = `rgb(${rgbS(FO.color)})`;
      let anyFo = false;
      for (let i = 0; i < segsV.length - 1; i++) {
        const a = segsV[i], b = segsV[i + 1], fo = ((a.foam || 0) + (b.foam || 0)) / 2;
        if (fo < 0.02 || (a.reach < 0.03 && b.reach < 0.03)) continue;
        const lace = 0.5 + 0.5 * noise1(a.s / FO.laceLength + S.time * 0.15);
        for (const [u0, u1, al] of [[-0.15, 1, fo * (1 - FO.lace * (1 - lace))], [1, 1 + FO.trail / FO.width, fo * FO.trailAlpha / FO.alpha * smooth(0.45, 0.75, noise1(a.s / FO.laceLength * 1.7 + 40 - S.time * 0.1) * 0.5 + 0.5)]]) {
          if (al < 0.02) continue;
          const pts = [at(a, Math.max(0, a.reach - FO.width * u0)), at(b, Math.max(0, b.reach - FO.width * u0)), at(b, Math.max(0, b.reach - FO.width * u1)), at(a, Math.max(0, a.reach - FO.width * u1))];
          if (pts.some((c) => c[1] < rig.near)) continue;
          crestG.globalAlpha = Math.min(1, al);
          crestG.beginPath(); pts.forEach((c, j) => { const s = toScreen(c); j ? crestG.lineTo(s[0], s[1]) : crestG.moveTo(s[0], s[1]); }); crestG.closePath(); crestG.fill();
          anyFo = true;
        }
      }
      if (anyFo) { ctx.globalAlpha = FO.alpha * (1 - fog); ctx.drawImage(crestCv, 0, 0, W, H); } }
    // 물 끝선을 따라 반짝이는 푸른 점
    for (const s of S.spark) {
      if (!s.on || !s.z0) continue;
      const k = s.t / s.life, env = Math.min(1, s.t / 0.08) * Math.pow(1 - k, 1.3) * (1 - fog);
      drawUnderwaterLight(s.x, s.y, s.depth, s.size, s.size * 3, s.hue, env, 3, s.z0);
    }
    // 물막 위 작은 파문 (펭귄 발밑)
    for (const r of S.washRipples) {
      const k = r.t / 1.2, e = groundEllipse(r.x, r.y, 0.15 + 0.5 * k, terrainHeightAt(r.x, r.y) + 0.004);
      if (!e) continue;
      ctx.globalAlpha = 0.3 * (1 - k); ctx.drawImage(shadeRing, e.x - e.rx, e.y - e.ry, e.rx * 2, e.ry * 2);
    }
    // 모래 발자국: 버튼과 같은 발바닥 모양, 팔자로 벌어지고 부드럽게 번짐
    if (!IT) { const FP = C.FOOTPRINTS, sand = pawPrints(FP.color);
      for (const q of S.prints) { if (!q.on) continue; drawPawPrint(sand, q.x, q.y, q.ang, q.side, FP.size, q.t, FP.life, FP.alpha * (1 - fog), terrainHeightAt(q.x, q.y) + 0.004); } }
    ctx.globalAlpha = 1;
  }

  // 산 하나: 바닥 원 + 꼭짓점의 볼록 껍질. 멀수록 안개에 녹아 연회색
  function hull(pts) {
    pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], up = [];
    for (const p of pts) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
    for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
    return lo.slice(0, -1).concat(up.slice(0, -1));
  }
  function mountainItems(items) {
    for (const is of S.islands) for (const pk of is.peaks) {
      const cb = camSpace(pk.x, pk.y, 0);
      if (cb[1] < pk.r + rig.near) continue;
      const ap = camSpace(pk.x + pk.ax, pk.y + pk.ay, pk.h);
      const base = [];
      for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2; base.push(camSpace(pk.x + Math.cos(a) * pk.r, pk.y + Math.sin(a) * pk.r, 0)); }
      if (base.some((c) => c[1] < rig.near)) continue;
      const sb = base.map(toScreen), sa = toScreen(ap);
      const minX = Math.min(...sb.map((q) => q[0]), sa[0]), maxX = Math.max(...sb.map((q) => q[0]), sa[0]);
      if (maxX < 0 || minX > W) continue;
      items.push({ d: cb[1], draw: () => {
        const fog = fogAt(cb[1], C.FOG.mountain);
        const shape = hull(sb.concat([sa, toScreen(camSpace(pk.x + pk.ax * 0.5 - pk.r * 0.35 * pk.so, pk.y, pk.h * pk.sh))]));
        ctx.fillStyle = mixTo(COL.mountNear, fog, COL.mountFar); fillPoly(shape);   // 멀수록 밝은 능선, 가까울수록 순흑
        // 한쪽 면을 살짝 밝게 (양감)
        const right = sb.reduce((m, q) => (q[0] > m[0] ? q : m)), low = sb.reduce((m, q) => (q[1] > m[1] ? q : m));
        ctx.fillStyle = mixTo(COL.mountNear.map((v) => v + (255 - v) * PAL.mount.faceLift), fog, COL.mountFar.map((v) => v + (255 - v) * PAL.mount.faceLift));
        fillPoly([sa, right, low]);
      } });
    }
  }

  function penguinView() {
    const p = S.p, c = Math.cos(cam.yaw), s = Math.sin(cam.yaw);
    const fx = Math.cos(p.face), fy = Math.sin(p.face);
    const squash = p.sit ? 0.22 : (S.tapPulse * 0.08 + (slideHeld() && !p.sliding ? 0.1 : 0)) - (p.air && p.vz > 0 ? 0.08 : 0);
    return { fvx: c * fx - s * fy, fvy: s * fx + c * fy, squash };
  }
  // part: 'above' = 수면 위만, 'below' = 수면 아래만. cut = 몸을 감싸는 수면 타원 (지역 좌표)
  // 앞쪽 호(아래로 볼록) 위가 물 밖, 그 아래가 물속
  function drawPenguinFigure(g, u, v, part = 'above', cut = null) {
    const p = S.p;
    if (cut && p.mode === 'water' && !p.air) {
      const { cx, cy, rx, ry } = cut, big = u * 6;
      g.beginPath();
      g.moveTo(cx - big, cy); g.lineTo(cx - rx, cy);
      g.ellipse(cx, cy, rx, ry, 0, Math.PI, 0, true);          // 앞쪽(아래) 반원
      g.lineTo(cx + big, cy);
      if (part === 'below') { g.lineTo(cx + big, cy + big); g.lineTo(cx - big, cy + big); } else { g.lineTo(cx + big, cy - big); g.lineTo(cx - big, cy - big); }
      g.closePath(); g.clip();
      g.translate(0, p.sink * u);
    } else if (part === 'below') return;
    const { fvx, fvy } = v;
    const lm = deg(Math.max(WC().inertiaTilt.accelDeg, C.penguin.iceLeanDeg, C.floe.relief.slopeLeanDeg)); g.rotate(clamp(p.lean.h, -lm, lm));
    if (artReady()) { drawPenguinArt(g, u, v, p); return; }
    if (p.sliding || p.belly) {
      const ax = Math.abs(fvx), len = (0.45 + 0.55 * ax) * (p.mode === 'water' && p.depth === 'deep' ? 1.2 : 1);   // 물속 슬라이딩은 길게 늘어남
      g.scale(fvx < 0 ? -1 : 1, 1);
      g.rotate(clamp(Math.atan2(fvy * Math.sin(cam.pitch) * 0.5, ax), -0.35, 0.35));
      g.fillStyle = COL.black; g.beginPath(); g.ellipse(0, -u * 0.15, u * 0.55 * len, u * 0.2, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = COL.white; g.beginPath(); g.ellipse(-u * 0.02 * len, -u * 0.07, u * 0.42 * len, u * 0.1, 0, 0, Math.PI * 2); g.fill();
      if (fvy > -0.5) { g.beginPath(); g.arc(u * 0.38 * len, -u * 0.21, u * 0.035, 0, Math.PI * 2); g.fill(); }
      if (p.mode === 'water' && C.SWIM_FEET && C.SWIM_FEET.slide) drawSwimFeet(g, u, p, -u * 0.5 * len, -u * 0.13, Math.PI);   // 슬라이딩 헤엄: 뒤로 쭉 뻗은 발
      if (p.mode === 'island' && C.PHYSICS.toboggan) {   // 터보건: 발가락 끝을 바닥에 딛고(준비) → 뒤로 빵! 차고 → 제자리
        const TB = C.PHYSICS.toboggan, FT = TB.feet, kk = p.tobKick || 0, ph = clamp((p.tobT || 0) / TB.kick.period, 0, 1);
        const snap = kk > 0 ? Math.pow(kk, 0.6) : 0;           // 차는 순간 확 → 천천히 돌아옴
        const ang = deg(snap > 0 ? lerp(FT.rest, FT.kick, snap) : lerp(FT.rest, FT.plant, smooth(0.5, 1, ph)));   // + = 아래(바닥 쪽)
        const reach = u * (FT.reach * snap - FT.tuck * smooth(0.5, 1, ph) * (snap > 0 ? 0 : 1));
        g.fillStyle = COL.black;
        for (const o of [0, 1]) {
          const a2 = ang + (o ? deg(8) : 0), dx = -Math.cos(a2), dy = Math.sin(a2), L = u * FT.length;
          g.save(); g.translate(-u * 0.46 * len - reach * (o ? 0.8 : 1), -u * (0.09 + o * 0.035)); g.rotate(Math.atan2(dy, dx));
          g.beginPath(); g.ellipse(L * 0.5, 0, L * 0.55, u * 0.03, 0, 0, Math.PI * 2); g.fill();   // 다리
          g.beginPath(); g.ellipse(L * 1.0, 0, u * 0.05, u * 0.032, 0, 0, Math.PI * 2); g.fill();   // 발 (끝이 바닥을 짚음)
          g.restore();
        }
      }
      return;
    }
    g.rotate(p.wobble);
    let swimFeetLater = null;
    const SWP = C.PENGUIN_RIG && C.PENGUIN_RIG.enabled && C.PENGUIN_RIG.swim;
    if (SWP && p.mode === 'water' && !p.air && p.lay > SWP.fromDeg) { drawPenguinSwim(g, u, v, p); return; }
    if (p.lay > 0.5) {
      // 헤엄 자세: 화면에서 보이는 진행 방향으로 눕힘. 카메라 쪽/반대쪽으로 갈 때는 짧아 보이게
      const sp2 = Math.hypot(p.vx, p.vy), c2 = Math.cos(cam.yaw), s2 = Math.sin(cam.yaw);
      const hx = sp2 > 0.05 ? (c2 * p.vx - s2 * p.vy) / sp2 : (p.layDirX || 0);
      if (sp2 > 0.05) p.layDirX = hx;
      const a = deg(p.lay), side = hx >= 0 ? 1 : -1, sideShare = Math.abs(hx);
      g.translate(0, -u * 0.45);
      g.rotate(side * a * sideShare);
      g.scale(1, 1 - (1 - Math.cos(a)) * (1 - sideShare) * 0.75);
      g.translate(0, u * 0.45);
      if (p.mode === 'water') {   // 몸 뒤쪽에서 거의 수평(살짝 위)으로 뻗은 발 — 물 위로 보이게 (몸을 그린 뒤 그림)
        // 엉덩이 끝(몸 아래)에서 몸 축을 따라 뒤로 쭉 뻗음. liftDeg 만큼 등 쪽으로 살짝 들림
        const SF = C.SWIM_FEET, up = deg(SF ? SF.liftDeg : 0);
        swimFeetLater = [0, -u * (SF ? SF.rootY : 0.04), Math.PI / 2 + side * up];
      }
    }
    g.scale(1 + v.squash * 0.6, 1 - v.squash);
    if (C.PENGUIN_RIG && C.PENGUIN_RIG.enabled) { drawPenguinRig(g, u, v, p, swimFeetLater); return; }
    g.fillStyle = COL.black;
    g.beginPath(); g.ellipse(0, -u * 0.5, u * 0.3, u * 0.5, 0, 0, Math.PI * 2); g.fill();
    if (swimFeetLater) drawSwimFeet(g, u, p, ...swimFeetLater);
    const bw = u * 0.22 * clamp(0.3 + 0.7 * fvy, 0, 1);
    if (bw > 0.5) { g.fillStyle = COL.white; g.beginPath(); g.ellipse(fvx * u * 0.1, -u * 0.4, bw, u * 0.34, 0, 0, Math.PI * 2); g.fill(); }
    if (fvy > -0.35) {
      g.fillStyle = COL.white;
      for (const e of [-1, 1]) {
        const ex = fvx * u * 0.16 + e * u * 0.09 * Math.max(0.15, fvy);
        g.beginPath(); g.arc(ex, -u * 0.8, u * 0.04, 0, Math.PI * 2); g.fill();
      }
      g.fillStyle = COL.beak;
      const bx = fvx * u * 0.24;
      g.beginPath(); g.moveTo(bx - u * 0.05, -u * 0.74); g.lineTo(bx + fvx * u * 0.12, -u * 0.71); g.lineTo(bx - u * 0.05, -u * 0.68); g.fill();
    }
  }

  // ── 펭귄 몸 틀 (PENGUIN_RIG): 부위별로 그림. 화면에서 보이는 방향(fvx 옆, fvy 카메라 쪽)에 따라 앞·옆·뒤 모습이 섞임 ──
  // 걸음 위상 p.phase, 몸 기울기 p.wobble(이미 몸 전체에 적용됨), 공중 p.air/p.vz, 숨쉬기 S.time 을 읽기만 함 (물리 상태는 바꾸지 않음)
  function drawPenguinRig(g, u, v, p, swimFeetLater) {
    const R = C.PENGUIN_RIG, K = R.colors, { fvx, fvy } = v;
    const sideShare = Math.abs(fvx), fs = fvx >= 0 ? 1 : -1, front = clamp(fvy, -1, 1);   // front: +1 정면, −1 뒷모습
    const sp = Math.hypot(p.vx, p.vy), walking = !p.air && p.lay < 0.5 && !(p.mode === 'water' && p.depth === 'deep') && sp > 0.12;
    const amt = walking ? clamp(sp / 1.2, 0.25, 1) : 0, ph = p.phase || 0, st = Math.sin(ph);
    const swim = p.lay > 0.5 || (p.mode === 'water' && p.depth === 'deep' && !p.air);
    const ell = (x, y, rx, ry, rot = 0) => { g.beginPath(); g.ellipse(x * u, y * u, Math.max(0.01, rx * u), Math.max(0.01, ry * u), rot, 0, Math.PI * 2); g.fill(); };
    const backX = -fvx;                                                 // 화면에서 등 쪽 방향 (옆모습일수록 큼)
    // 날개: 어깨 위치. 정면/뒷모습 = 양옆, 옆모습 = 가까운 날개는 몸 가운데 앞에, 먼 날개는 몸 뒤에 가려짐
    const F = R.flipper, breath = Math.sin(S.time * 2.2) * deg(F.idleBreath);
    const airK = p.air ? clamp(0.4 + p.vz / 4, 0, 1) : 0;
    const flipperAng = (e) => {                                        // e = −1 왼쪽, +1 오른쪽 (화면 기준). 0 = 아래로 늘어뜨림, + = 바깥으로 벌림
      const walkOut = walking ? deg(F.swing) * amt * Math.max(0, -st * e) : 0;   // 몸이 반대쪽으로 기울 때 이쪽 날개가 벌어져 균형
      return deg(F.out) * (walking ? 0.6 + 0.4 * amt : 0.5) + walkOut + breath + deg(F.airUp) * airK;
    };
    const drawFlipper = (e, near) => {
      const sx = F.shoulderX * Math.max(0, 1 - sideShare * 1.1) * e - fvx * (near ? 0.03 : 0.07), sy = F.shoulderY - (near ? 0 : 0.02 * sideShare);   // 옆으로 돌수록 가까운 날개는 몸 가운데로, 먼 날개는 몸 뒤로
      let a = flipperAng(e) * e * (1 - sideShare);                      // 정면: 좌우로 벌어짐
      if (sideShare > 0.01) {                                          // 옆모습: 앞뒤로 흔듦 (걸음과 반대 위상) + 뛰면 뒤로 젖힘
        const sw = (walking ? Math.sin(ph + (near ? 0 : Math.PI)) * deg(F.sideSwing) * amt : 0) - deg(F.airUp) * 0.6 * airK + breath * 0.5;
        a += (-fs) * (deg(F.out) * 0.4 + sw) * sideShare * (near ? 1 : 0.8);
      }
      g.save(); g.translate(sx * u, sy * u); g.rotate(-a); g.fillStyle = K.flipper;
      g.beginPath(); g.moveTo(-F.w * 0.5 * u, 0); g.quadraticCurveTo(-F.w * 0.9 * u, F.len * 0.55 * u, 0, F.len * u); g.quadraticCurveTo(F.w * 0.9 * u, F.len * 0.55 * u, F.w * 0.5 * u, 0); g.closePath(); g.fill();
      g.restore();
    };
    // 발: 번갈아 들림. 앞모습 = 좌우로 벌어짐, 옆모습 = 발끝이 앞을 향함
    const FT = R.feet;
    const drawFoot = (i) => {
      if (swim) return;
      const e = i ? 1 : -1, lift = walking ? Math.max(0, Math.sin(ph + (i ? Math.PI : 0))) * FT.lift * amt : 0;
      const fwd = walking ? Math.sin(ph + (i ? Math.PI : 0) + Math.PI / 2) * FT.stride * amt : 0;
      const x = FT.x * e * (1 - sideShare * 0.7) + fvx * (0.06 + fwd), y = -lift + (sideShare * e * 0.012);
      const L = FT.len * (0.55 + 0.45 * sideShare) + 0.02 * Math.max(0, front), W = FT.w;
      g.save(); g.translate(x * u, y * u); g.rotate(sideShare > 0.3 ? -fs * lift * 2 : e * deg(FT.toeOut) * (1 - sideShare) * 0.4);
      g.fillStyle = K.feet; ell(fvx * L * 0.35, 0, L * 0.5, W * 0.5); g.restore();
    };
    // 꼬리: 엉덩이 뒤. 정면에선 몸에 가려 안 보이고, 옆·뒷모습에서 보임
    const TL = R.tail;
    const drawTail = () => {
      const wag = walking ? -st * deg(TL.wag) * amt : Math.sin(S.time * 1.3) * deg(3);
      const tx = backX * TL.back * Math.max(0.35, sideShare) , ty = TL.y;
      g.save(); g.translate(tx * u, ty * u); g.rotate(wag + (sideShare > 0.2 ? -fs * 0.15 : 0)); g.fillStyle = K.body;
      g.beginPath(); g.moveTo(-TL.w * 0.5 * u, -TL.w * 0.4 * u); g.lineTo((backX >= 0 ? 1 : -1) * TL.len * u * Math.max(0.4, sideShare), TL.len * 0.35 * u); g.lineTo(TL.w * 0.5 * u, -TL.w * 0.4 * u); g.closePath(); g.fill();
      g.restore();
    };
    const butt = walking ? st * R.buttSway * amt : 0;
    // 그리는 순서: 먼 날개 → (정면이면 꼬리) → 발 → 엉덩이·몸통 → 배 → 머리·얼굴 → 가까운 날개 → (뒷모습이면 꼬리)
    const nearE = -fs, farE = fs;   // 오른쪽을 보면 카메라엔 펭귄의 오른쪽 옆구리(화면 왼쪽 날개)가 보임
    if (sideShare > 0.05) drawFlipper(farE, false);
    if (front >= 0 && !swim) drawTail();
    drawFoot(0); drawFoot(1);
    g.fillStyle = K.body;
    ell(backX * R.hips.back + butt, R.hips.y, R.hips.rx, R.hips.ry, butt * 2);   // 엉덩이 (걸음마다 실룩)
    ell(0, R.torso.y, R.torso.rx, R.torso.ry);
    if (swimFeetLater) drawSwimFeet(g, u, p, ...swimFeetLater);
    // 배: 카메라 쪽을 볼수록 넓게, 옆모습이면 앞쪽으로
    const B = R.belly, bw = B.rx * clamp(0.45 + 0.55 * front, 0, 1);
    if (bw > 0.02) { g.fillStyle = K.belly; ell(fvx * B.side + butt * 0.5, B.y, bw, B.ry); }
    // 머리: 몸 기울기를 일부 되돌려 수평 유지 + 걸음마다 살짝 끄덕
    const H = R.head, bob = walking ? Math.abs(st) * H.bob * amt : 0;
    g.save(); g.translate(fvx * H.front * u, (H.y + H.r * 0.6) * u); g.rotate(-(p.wobble || 0) * H.counter); g.translate(0, -(H.r * 0.6 - bob) * u);
    g.fillStyle = K.body; ell(0, 0, H.r, H.r * 0.95);
    if (front > -0.35) {                                                 // 얼굴 흰 가면 + 눈 + 부리 (뒷모습이면 안 보임)
      const FC = R.face, fx = fvx * FC.front, mw = FC.rx * clamp(0.35 + 0.65 * front + 0.3 * sideShare, 0.3, 1);
      g.fillStyle = K.face; ell(fx, FC.y - H.y, mw, FC.ry);
      g.fillStyle = K.eye;
      for (const e of [-1, 1]) { const ex = fx + e * FC.eyeGap * clamp(front, 0.1, 1) + fvx * 0.02; if (sideShare > 0.75 && e === -fs) continue; ell(ex, FC.y - H.y - 0.01, FC.eyeR, FC.eyeR * 1.15); }
      const BK = R.beak, bx = fvx * (H.r * 0.85), by = BK.y - H.y;
      g.fillStyle = K.beak; g.beginPath(); g.moveTo((bx - fvx * 0.02 - BK.w * 0.5 * (1 - sideShare)) * u, (by - BK.w * 0.5) * u); g.lineTo((bx + fvx * BK.len) * u, (by + 0.01 + BK.len * 0.25 * front) * u); g.lineTo((bx - fvx * 0.02 + BK.w * 0.5 * (1 - sideShare)) * u, (by + BK.w * 0.5) * u); g.closePath(); g.fill();
    }
    g.restore();
    // 날개: 정면/뒷모습이면 양쪽, 옆모습이면 가까운 쪽만 몸 위에
    if (sideShare <= 0.05) { drawFlipper(-1, true); drawFlipper(1, true); }
    else drawFlipper(nearE, true);
    if (front < 0 && !swim) drawTail();
  }

  // ── 펭귄 원화 (PENGUIN_ART): 포즈별 몸 + 눈 + 날개 + 발 조각을 아틀라스에서 그림 ──
  let artImg = null;
  function artReady() {
    const PA = C.PENGUIN_ART, D = window.PENGUIN_ART; if (!PA || !PA.enabled || !D) return false;
    if (!artImg) { artImg = new Image(); artImg.src = D.img; }
    return artImg.complete && artImg.naturalWidth > 0;
  }
  function drawPenguinArt(g, u, v, p) {
    const PA = C.PENGUIN_ART, D = window.PENGUIN_ART, PO = PA.pose, t = S.time;
    const sp = Math.hypot(p.vx, p.vy), inW = p.mode === 'water' && !p.air;
    // 포즈 고르기
    let pose = PO.idle, swimK = 0;
    if (p.sliding || p.belly) pose = PO.belly;
    else if (p.air) pose = p.vz > 0 ? PO.air : PO.fall;
    else if (inW) { swimK = clamp((p.lay || 0) / PO.swimMaxDeg, 0, 1); pose = Math.round(swimK * 7); }
    else if (sp > 0.12) pose = PO.walk;
    const F = D.frames[clamp(pose, 0, D.frames.length - 1)];
    // 방향: 원화는 왼쪽을 봄 → 오른쪽을 보면 좌우 뒤집기. 정면·뒷모습 가까우면 마지막 옆 방향 유지
    if (Math.abs(v.fvx) > 0.15) p.artSide = v.fvx > 0 ? 1 : -1;
    const side = p.artSide || -1;
    const walking = !p.air && !inW && !p.sliding && !p.belly && sp > 0.12, ph = p.phase || 0, amt = walking ? clamp(sp / 1.2, 0.3, 1) : 0;
    g.save();
    g.scale(PA.scale, PA.scale);
    if (walking) g.rotate(p.wobble || 0);
    // 물에 떠 있을 때: 그림 높이의 waterline 비율만큼만 물속에 (p.sink 만큼 내려가 있던 것을 되돌림)
    if (inW) {
      let top = 0, bot = 0; for (const q of F.parts) { top = Math.min(top, q.y); bot = Math.max(bot, q.y + q.h); }
      const fh = bot - top, wl = lerp(PA.waterline.stand, PA.waterline.swim, swimK);
      g.translate(0, (-(p.sink || 0) + fh * wl + Math.sin(t * 1.8) * 0.01) * u);
    }
    if (walking) g.translate(0, -Math.abs(Math.sin(ph)) * PA.walk.bob * amt * u);
    g.scale(-side, 1);                                          // side = −1(왼쪽) → 그대로
    // 눈 깜빡임
    if (!p.blinkAt || t > p.blinkAt + PA.blink.time) p.blinkAt = (p.blinkAt ? t : t + 1) + lerp(PA.blink.every[0], PA.blink.every[1], Math.random());   // 다음 깜빡임
    const blink = t >= p.blinkAt && t < p.blinkAt + PA.blink.time;
    let footI = 0;
    for (const q of F.parts) {
      const [rx, ry, rw, rh] = q.r, x = q.x * u, y = q.y * u, w = q.w * u, h = q.h * u;
      let ang = 0, dy = 0;
      if (q.kind === 'foot') {
        const e = footI++ ? Math.PI : 0;
        if (walking) { dy = -Math.max(0, Math.sin(ph + e)) * PA.walk.footLift * amt; ang = Math.sin(ph + e) * deg(PA.walk.footSwingDeg) * amt; }
        else if (inW && swimK > 0.3) ang = Math.sin(t * PA.swim.paddleHz * Math.PI * 2 + e) * deg(PA.swim.paddleDeg);
        else if ((p.sliding && p.mode === 'island') || p.belly) ang = -(p.tobKick || 0) * deg(PA.toboggan.kickDeg) * (e ? 0.8 : 1);
      } else if (q.kind === 'flipper') {
        if (p.air) ang = -deg(PA.air.flipperUpDeg) * clamp(0.5 + p.vz / 4, 0, 1) - Math.sin(t * 14) * 0.15;
        else if (walking) ang = Math.sin(ph) * deg(PA.walk.flipperSwingDeg) * amt;
        else if (inW && swimK > 0.3) ang = Math.sin(t * PA.swim.flipperHz * Math.PI * 2) * deg(PA.swim.flipperDeg);
        else ang = Math.sin(t * PA.idle.breathHz * Math.PI * 2) * deg(PA.idle.breathDeg);
      } else if (q.kind === 'eye' && blink) {
        g.drawImage(artImg, rx, ry + rh * 0.45, rw, Math.max(1, rh * 0.15), x, y + h * 0.45, w, Math.max(1, h * 0.15)); continue;
      }
      if (ang || dy) {
        const pxp = x + (q.px ?? 0.5) * w, pyp = y + (q.py ?? 0.5) * h;
        g.save(); g.translate(pxp, pyp + dy * u); g.rotate(ang); g.drawImage(artImg, rx, ry, rw, rh, x - pxp, y - pyp, w, h); g.restore();
      } else g.drawImage(artImg, rx, ry, rw, rh, x, y, w, h);
    }
    g.restore();
  }

  // 기본 헤엄 자세 (사진 참고): 몸은 수면에 수평으로 떠 있고 엉덩이(등 뒤쪽)가 물 위로 올라옴, 목은 뽁 세워 머리를 들고, 발은 뒤 아래에서 파닥파닥
  // 지역 좌표: 수면 = y −p.sink (그림이 p.sink 만큼 아래로 옮겨져 있음). 위는 −
  function drawPenguinSwim(g, u, v, p) {
    const R = C.PENGUIN_RIG, W = R.swim, K = R.colors;
    const sp2 = Math.hypot(p.vx, p.vy), c2 = Math.cos(cam.yaw), s2 = Math.sin(cam.yaw);
    const hx = sp2 > 0.05 ? (c2 * p.vx - s2 * p.vy) / sp2 : (p.layDirX || 0);
    if (sp2 > 0.05) p.layDirX = hx;
    const side = hx >= 0 ? 1 : -1, sideShare = Math.abs(hx), len = lerp(W.foreshorten, 1, sideShare), front = clamp(v.fvy, -1, 1);
    const ell = (x, y, rx, ry, rot = 0) => { g.beginPath(); g.ellipse(x * u, y * u, Math.max(0.01, rx * u), Math.max(0.01, ry * u), rot, 0, Math.PI * 2); g.fill(); };
    const yw = -(p.sink || 0), bob = Math.sin(S.time * W.bobHz * Math.PI * 2) * W.bob;
    // 목 뽁: 헤엄 자세로 바뀌는 동안 목이 살짝 지나치게 솟았다 자리잡음 (lay 진행도로 계산, 상태 저장 없음)
    const x = clamp((p.lay - W.fromDeg) / (C.PHYSICS.water.layDeg - W.fromDeg), 0, 1), pop = x + Math.sin(Math.PI * x) * W.popOvershoot;
    const L = len, P = (x, y) => [x * L * u, (yw + W.bodyDepth + bob + y) * u];   // 수면 기준 몸 좌표 → 캔버스 (+x = 앞)
    const nk = W.neck.up * pop;                                         // 목이 솟은 정도 (뽁)
    g.save(); g.scale(side, 1);
    // 실루엣 (스케치 참고): 꼬리 → 낮은 등 → 엉덩이 살짝 봉긋 → 부드럽게 솟는 목 → 둥근 머리 → 위로 향한 부리 → 목 앞 → 깊고 둥근 가슴 → 긴 배 → 꼬리
    const sil = () => {
      g.beginPath();
      g.moveTo(...P(-0.52, 0.02));
      g.bezierCurveTo(...P(-0.42, -0.06 - W.rump.up), ...P(-0.24, -0.07 - W.rump.up), ...P(-0.08, -0.04));   // 엉덩이
      g.bezierCurveTo(...P(0.06, -0.03), ...P(0.12, -0.12 - nk * 0.5), ...P(0.16, -0.2 - nk));                // 목 뒤
      g.bezierCurveTo(...P(0.18, -0.34 - nk), ...P(0.3, -0.38 - nk), ...P(0.38, -0.33 - nk));                  // 머리 위
      g.bezierCurveTo(...P(0.43, -0.3 - nk), ...P(0.44, -0.24 - nk), ...P(0.42, -0.2 - nk));                   // 머리 앞
      g.bezierCurveTo(...P(0.4, -0.12 - nk * 0.4), ...P(0.42, -0.04), ...P(0.42, 0.04));                      // 목 앞
      g.bezierCurveTo(...P(0.42, 0.18), ...P(0.3, 0.26), ...P(0.12, 0.27));                                     // 가슴 (깊고 둥글게)
      g.bezierCurveTo(...P(-0.12, 0.28), ...P(-0.38, 0.16), ...P(-0.52, 0.02));                                 // 배 → 꼬리
      g.closePath();
    };
    // 발: 몸 뒤 아래에서 뒤로 뻗어 파닥파닥 (몸보다 먼저 = 뒤에 깔림)
    { const [fx, fy] = P(-0.4, 0.12); drawSwimFeet(g, u, p, fx, fy, Math.PI - deg(W.feetDownDeg), true); }
    g.fillStyle = K.body; sil(); g.fill();
    // 배·가슴·목 앞의 흰 부분: 실루엣 안에서만
    g.save(); sil(); g.clip();
    g.fillStyle = K.belly;
    g.beginPath(); { const [cx, cy] = P(0.02, 0.24); g.ellipse(cx, cy, 0.5 * L * u, 0.1 * u, -0.08, 0, Math.PI * 2); } g.fill();            // 배 아래
    if (front > -0.5) {
      g.beginPath(); { const [cx, cy] = P(0.39, -0.06 - nk * 0.5); g.ellipse(cx, cy, 0.05 * u, (0.16 + nk * 0.5) * u, -0.1, 0, Math.PI * 2); } g.fill();   // 목 앞 흰 줄
      g.fillStyle = K.face; g.beginPath(); { const [cx, cy] = P(0.34, -0.25 - nk); g.ellipse(cx, cy, 0.07 * L * u + 0.02 * u, 0.06 * u, 0, 0, Math.PI * 2); } g.fill();   // 볼
    }
    g.restore();
    if (front > -0.5) { g.fillStyle = K.eye; const [ex, ey] = P(0.36, -0.28 - nk); g.beginPath(); g.ellipse(ex, ey, R.face.eyeR * u, R.face.eyeR * 1.15 * u, 0, 0, Math.PI * 2); g.fill(); }
    // 부리: 살짝 위로
    { g.fillStyle = K.beak; const [b0x, b0y] = P(0.41, -0.3 - nk), [b1x, b1y] = P(0.41 + R.beak.len * 1.3 / L, -0.35 - nk), [b2x, b2y] = P(0.42, -0.25 - nk);
      g.beginPath(); g.moveTo(b0x, b0y); g.lineTo(b1x, b1y); g.lineTo(b2x, b2y); g.closePath(); g.fill(); }
    // 날개: 가슴 옆에서 뒤로 길게 붙인 고리 모양 (물가에서 천천히 저음)
    { const [rx0, ry0] = P(0.24, 0.02), sw = Math.sin(S.time * W.flipper.hz * Math.PI * 2) * 0.12;
      g.save(); g.translate(rx0, ry0); g.rotate(0.12 + sw); g.fillStyle = K.flipper;
      const fl = W.flipper.len * L * u, fw = W.flipper.w * u;
      g.beginPath(); g.moveTo(0, -fw * 0.6); g.bezierCurveTo(-fl * 0.4, -fw * 1.1, -fl * 0.9, -fw * 0.4, -fl, fw * 0.2); g.bezierCurveTo(-fl * 0.8, fw * 1.2, -fl * 0.3, fw * 1.1, 0, fw * 0.6); g.closePath(); g.fill();
      g.restore(); }
    g.restore();
  }

  // 헤엄 발: (x0, y0)에서 방향 base(라디안, 캔버스 좌표)로 두 발을 뻗고, 번갈아 위아래로 파닥임
  function drawSwimFeet(g, u, p, x0, y0, base, paddle = false) {
    const F = C.SWIM_FEET; if (!F || !F.enabled) return;
    const sp = Math.hypot(p.vx, p.vy), k = clamp(sp / 1.5, F.idleFlutter, 1.3);
    const fd = paddle && F.paddle ? F.paddle.deg : F.flutterDeg, fh = paddle && F.paddle ? F.paddle.hz : F.flutterHz;
    const ph = S.time * fh * Math.PI * 2 * (0.5 + 0.5 * k), L = u * F.length, W = u * F.width;
    g.save(); g.fillStyle = COL.black;
    for (const e of [-1, 1]) {
      const a = base + e * 0.08 + Math.sin(ph + (e > 0 ? Math.PI : 0)) * deg(fd) * k;
      const ox = x0 + Math.cos(base + Math.PI / 2) * e * u * F.spread * 0.5, oy = y0 + Math.sin(base + Math.PI / 2) * e * u * F.spread * 0.5;
      g.save(); g.translate(ox, oy); g.rotate(a);
      g.beginPath(); g.ellipse(L * 0.45, 0, L * 0.5, W * 0.55, 0, 0, Math.PI * 2); g.fill();            // 다리
      g.beginPath(); g.moveTo(L * 0.75, -W * 0.6); g.lineTo(L * 1.15, -W * 1.1); g.lineTo(L * 1.15, W * 1.1); g.lineTo(L * 0.75, W * 0.6); g.closePath(); g.fill();   // 물갈퀴 발 (끝이 넓게)
      g.restore();
    }
    g.restore();
  }

  const rimCv = document.createElement('canvas'), rimG = rimCv.getContext('2d');
  const penScale = (d) => penH() * pxPerUnit(d) * rig.cp;   // 펭귄 키 (px)
  function drawPenguin() {
    const p = S.p, v = penguinView(), dy = penOffset();
    const [sx, sy0, d] = project(p.x, p.y, p.z), sy = sy0 + dy, u = penScale(d);
    if (p.mode !== 'water' || p.air) {
      const e = groundEllipse(p.x, p.y, penH() * 0.32, p.air ? surfaceAt(p.x, p.y).z : p.z);
      if (e) {
        const oy = p.floe && !p.air ? floeOffset(p.floe) : 0, k = 1 + C.SHADOW_BLUR.ratio / 2;   // 번지는 그림자
        ctx.globalAlpha = 0.16; ctx.drawImage(getSoftDisc(), e.x - e.rx * k, e.y + oy - e.ry * k, e.rx * 2 * k, e.ry * 2 * k); ctx.globalAlpha = 1;
      }
    }
    const cut = waterCut(sx, sy);
    // 수영: 몸 둘레 물결 고리를 뒤쪽 절반 → 몸 → 앞쪽 절반 순서로 (몸 위로 고리가 비쳐 보이지 않게)
    const e = p.sink > 0.2 && C.penguin.swimRingAlpha > 0 ? groundEllipse(p.x, p.y, penH() * 0.45) : null;
    const ringHalf = (front) => {
      if (!e) return;
      ctx.save(); ctx.beginPath();
      if (front) ctx.rect(e.x - e.rx, e.y, e.rx * 2, e.ry + 1); else ctx.rect(e.x - e.rx, e.y - e.ry - 1, e.rx * 2, e.ry + 1);
      ctx.clip(); ctx.globalAlpha = C.penguin.swimRingAlpha;
      ctx.drawImage(getRingSprite(), e.x - e.rx, e.y - e.ry, e.rx * 2, e.ry * 2);
      ctx.restore();
    };
    ringHalf(false);
    if (p.sink > 0.01 && cut) drawSubmerged(sx, sy, u, v, cut);   // 잠긴 몸: 푸른 회색, 아래로 옅어지고 굴절로 일렁임
    if (cut) waterlineArc(cut, sx, sy, false);
    // 림 라이트: 물에 있을 때만 몸 윤곽 바깥으로 번지는 얇은 흰 빛 (검은 바다에 묻히지 않게). 빙하·땅 위에선 꺼짐
    { const PP = PAL.penguin, want = p.mode === 'water' ? 1 : 0;
      p.rimK = (p.rimK || 0) + (want - (p.rimK || 0)) * 0.12;
      if (p.rimK > 0.02 && PP.rimAlpha > 0) {
        const rw = Math.ceil(u * 2.6), rh = Math.ceil(u * 1.9), pw = Math.ceil(rw * DPR), ph = Math.ceil(rh * DPR);
        if (rimCv.width < pw || rimCv.height < ph) { rimCv.width = Math.max(rimCv.width, pw); rimCv.height = Math.max(rimCv.height, ph); }
        rimG.setTransform(DPR, 0, 0, DPR, 0, 0); rimG.globalCompositeOperation = 'source-over'; rimG.clearRect(0, 0, rw, rh);
        rimG.save(); rimG.translate(rw / 2, rh - u * 0.45); drawPenguinFigure(rimG, u, v, 'above', cut); rimG.restore();
        rimG.globalCompositeOperation = 'source-in'; rimG.fillStyle = '#fff'; rimG.fillRect(0, 0, rw, rh);
        const bw = Math.max(1, u * PP.rimWidth);
        ctx.save(); ctx.imageSmoothingEnabled = true;
        for (const [rad, al] of [[bw, 0.5], [bw * 2, 0.3], [bw * 3.2, 0.2]]) {
          ctx.globalAlpha = PP.rimAlpha * p.rimK * al / 3;
          for (let t = 0; t < 8; t++) { const an = t * 0.7854; ctx.drawImage(rimCv, 0, 0, pw, ph, sx - rw / 2 + Math.cos(an) * rad, sy - (rh - u * 0.45) + Math.sin(an) * rad, rw, rh); }
        }
        ctx.restore();
      } }
    ctx.save(); ctx.translate(sx, sy); drawPenguinFigure(ctx, u, v, 'above', cut); ctx.restore();
    if (cut) waterlineArc(cut, sx, sy, true);
    ringHalf(true);
  }
  // 몸을 감싸는 수면 타원: 원근에 맞게 납작하게, 출렁임에 따라 1~2px 흔들림
  function waterCut(sx, sy) {
    const p = S.p;
    if (p.mode !== 'water' || p.air) return null;
    const e = groundEllipse(p.x, p.y, penH() * 0.33);
    if (!e) return null;
    const t = S.time;
    // 주변 수면 높이만큼 수면선이 오르내림 (오르면 아랫몸이 더 잠김). 최대 cover.maxPx. 반사도 같은 선을 씀
    const lift = penLiftPx(e.d);
    return { cx: e.x - sx + Math.sin(t * 2.3) * 0.8, cy: e.y - sy - lift + Math.sin(t * 3.1) * 1.2 + Math.sin(t * 5.3) * 0.5, rx: e.rx * (1 + 0.03 * Math.sin(t * 2.7)), ry: e.ry };
  }
  // 펭귄 자리 수면선이 수면 높이로 오르내리는 양 (px, 위로 +)
  function penLiftPx(d) {
    const p = S.p;
    return sim ? clamp(sim.around(p.x, p.y, 0.55, 0.55) * SIM.cover.gain, -coverCapW(), coverCapW()) * pxPerUnit(d) * rig.cp : 0;
  }
  // 합성용 오프스크린 (슬라이스를 모으는 곳, 재사용)
  const compCv = document.createElement('canvas'), compG = compCv.getContext('2d');
  function compCanvas(w, h) {
    const pw = Math.ceil(w * DPR), ph = Math.ceil(h * DPR);
    if (compCv.width < pw || compCv.height < ph) { compCv.width = Math.max(compCv.width, pw); compCv.height = Math.max(compCv.height, ph); }
    compG.setTransform(DPR, 0, 0, DPR, 0, 0); compG.globalAlpha = 1; compG.globalCompositeOperation = 'source-over'; compG.clearRect(0, 0, w, h);
    return compG;
  }
  // compCv(css w×h) 를 화면 (x, y) 에 정수 장치 픽셀 줄 묶음 n 개로 나눠, 줄마다 shift(줄 가운데 y) 만큼 가로로 밀어 그림
  function bandBlit(w, h, x, y, alpha, n, shift) {
    const sw = Math.ceil(w * DPR), shd = Math.ceil(h * DPR), X0 = Math.round(x * DPR), Y0 = Math.round(y * DPR);
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = alpha; ctx.imageSmoothingEnabled = true;
    for (let i = 0; i < n; i++) {
      const y0 = Math.round(i * shd / n), y1 = Math.round((i + 1) * shd / n);
      if (y1 <= y0) continue;
      const dx = Math.round(shift((y0 + y1) / 2 / DPR) * DPR);
      ctx.drawImage(compCv, 0, y0, sw, y1 - y0, X0 + dx, Y0 + y0, sw, y1 - y0);
    }
    ctx.restore();
  }
  // 잠긴 몸: 'below' 부분을 오프스크린에 그려 푸른 회색으로 물들이고, 수면선 0.5 → 깊이 0 으로 옅게, 세로 압축, 가로 굴절
  const subCv = document.createElement('canvas'), subG = subCv.getContext('2d');
  function drawSubmerged(sx, sy, u, v, cut) {
    const RS = C.reflect.submerged, RR = C.reflect.refract, p = S.p;
    const w = Math.ceil(u * 2.4), top = Math.ceil(cut.ry + 2), dep = Math.ceil(u * RS.depth), h = top + dep + 2;
    const pw = Math.ceil(w * DPR), ph = Math.ceil(h * DPR);
    if (subCv.width < pw || subCv.height < ph) { subCv.width = Math.max(subCv.width, pw); subCv.height = Math.max(subCv.height, ph); }
    subG.setTransform(DPR, 0, 0, DPR, 0, 0); subG.globalCompositeOperation = 'source-over'; subG.clearRect(0, 0, w, h);
    subG.save(); subG.translate(w / 2, top - cut.cy); drawPenguinFigure(subG, u, v, 'below', cut); subG.restore();
    subG.globalCompositeOperation = 'source-atop'; subG.fillStyle = `rgba(${RS.tint.join(',')},${RS.tintAmount})`; subG.fillRect(0, 0, w, h);
    subG.globalCompositeOperation = 'destination-in';
    const gr = subG.createLinearGradient(0, top, 0, top + dep);
    gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    subG.fillStyle = gr; subG.fillRect(0, 0, w, h);
    subG.globalCompositeOperation = 'source-over';
    // 슬라이스: 수면선 아래는 세로 squash, 깊을수록 가로 굴절이 커짐
    const N = RS.slices, wy = sy + cut.cy, ppu = Math.max(1, pxPerUnit(camSpace(p.x, p.y, 0)[1]) * Math.max(0.2, rig.sp));
    // 한 장으로 세로 압축 → 정수 픽셀 줄 단위로 가로 굴절만 (줄 경계가 겹치거나 비지 않음)
    const dq = dep * RS.squash, cw = w + 8, chh = top + Math.ceil(dq) + 2, G2 = compCanvas(cw, chh);
    if (top > 0) G2.drawImage(subCv, 0, 0, pw, Math.round(top * DPR), 4, 0, w, top);   // 수면선 위(뒤쪽 반원 안) 부분
    G2.drawImage(subCv, 0, Math.round(top * DPR), pw, Math.round(dep * DPR), 4, top, w, dq);
    bandBlit(cw, chh, sx - w / 2 - 4, wy - top, RS.alpha, N + 4, (yc) => {
      const fr = clamp((yc - top) / Math.max(1, dq), 0, 1), dw = (yc - top) / ppu;
      if (fr <= 0) return 0;
      const gg = simGrad(p.x - rig.F[0] * dw, p.y - rig.F[1] * dw), gR = gg[0] * rig.R[0] + gg[1] * rig.R[1];
      return clamp(gR * RR.gain, -RR.maxPx, RR.maxPx) * fr;
    });
  }
  // 젖은 모래·물막 강도 (0~1): 해안 젖음 맵 / 올라온 물
  function wetAt(x, y) {
    const ws = washShape(), Wsh = C.SHORE_WASH; if (!ws.segs.length) return 0;
    let q = null, bd = Infinity;
    for (const s of ws.segs) { const d = Math.abs(s.y - y) + Math.abs(s.x - x) * 0.2; if (d < bd) { bd = d; q = s; } }
    const inland = (q.x - x) * q.nx + (q.y - y) * q.ny;
    if (inland < 0) return 1;
    if (q.reach > inland) return 1;
    if (Wsh.swash && q.wetR != null) return inland < q.wetR ? 0.7 * (1 - smooth(q.wetR - Wsh.swash.wetEdge, q.wetR, inland)) : 0;
    if (!q.wet) return 0;
    const maxIn = Wsh.shoreWidth * Wsh.reach * Wsh.binReach, b = Math.floor(inland / maxIn * q.wet.length);
    return b < q.wet.length ? Math.max(q.wet[b] * 0.7, q.film[b]) : 0;
  }
  // 수면선 가장자리의 얇은 밝은 물결선: 뒤쪽 호는 몸 뒤, 앞쪽 호는 몸 앞
  function waterlineArc(cut, sx, sy, front) {
    // 선 대신 넓고 옅은 띠를 3겹 겹쳐 번지게 (합쳐서 waterlineAlpha 이하)
    const PG = C.penguin, a0 = Math.min(0.15, PG.waterlineAlpha) * (front ? 1 : 0.6), bw = penScale(camSpace(S.p.x, S.p.y, 0)[1]) * PG.waterlineWidth;
    ctx.save(); ctx.translate(sx, sy); ctx.strokeStyle = '#ffffff'; ctx.lineCap = 'round';
    for (const k of [1, 0.6, 0.3]) {
      ctx.globalAlpha = a0 / 3; ctx.lineWidth = Math.max(1, bw * k);
      ctx.beginPath(); ctx.ellipse(cut.cx, cut.cy, cut.rx * 1.04, cut.ry * 1.04, 0, front ? 0 : Math.PI, front ? Math.PI : Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }

  const off = document.createElement('canvas'), og = off.getContext('2d');
  const blurCv = document.createElement('canvas'), blurG = blurCv.getContext('2d');
  function drawReflection() {
    const RF = C.reflect, p = S.p;
    if (!(RF.alpha > 0)) return;
    const onLand = p.mode === 'island' && !p.air;
    const wetK = onLand ? wetAt(p.x, p.y) : 1;
    if (onLand && wetK < 0.02) return;                         // 마른 땅: 반사 없음
    const v = penguinView(), dy = penOffset(), inWater = p.mode === 'water' && !p.air;
    const [sx, sy0, d] = project(p.x, p.y, p.z), sy = sy0 + dy, u = penScale(d);
    // 반사 기준면: 실제 수면 (물 엔진 높이 = 물 가림과 같은 선). 땅 위는 발밑 지면
    const [, wy0] = project(p.x, p.y, onLand ? p.z : 0), wy = wy0 + (onLand ? dy : 0) - (inWater ? penLiftPx(d) : 0);
    const cut = inWater ? waterCut(sx, sy) : null;
    const rise = Math.max(0, wy - sy);                        // 발(빙하 위·공중)이 수면에서 떠 있는 높이 (px)
    const reach = rise + u * RF.fadeLength;                   // 거울상 길이 = 빙하 높이 + 몸 높이 × 0.9
    const w = Math.ceil(u * 2.4), oy = Math.ceil(Math.min(rise + u * 1.1, reach + 2)), ox = w / 2;
    const pw = Math.ceil(w * DPR), ph = Math.ceil(oy * DPR);
    if (off.width < pw || off.height < ph) { off.width = Math.max(off.width, pw); off.height = Math.max(off.height, ph); }
    og.setTransform(DPR, 0, 0, DPR, 0, 0); og.globalCompositeOperation = 'source-over';
    og.clearRect(0, 0, w, oy + 1);
    og.save(); og.translate(ox, oy - (wy - sy)); drawPenguinFigure(og, u, v, 'above', cut); og.restore();
    og.globalCompositeOperation = 'destination-in';
    const gr = og.createLinearGradient(0, oy, 0, oy - reach);
    gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    og.fillStyle = gr; og.fillRect(0, 0, w, oy + 1);
    og.globalCompositeOperation = 'source-over';
    // 거울상 슬라이스: 슬라이스마다 그 자리(카메라 쪽 수면) 기울기 ∇h 로 가로 변위 → 파문이 지나가면 흩어졌다 모임
    // 한 장으로 뒤집은 뒤(수면선이 맨 위), 줄 묶음 N 개마다 그 자리(카메라 쪽 수면) 기울기 ∇h 로 가로 변위
    // → 파문이 지나가면 흩어졌다 모임. 줄 경계는 정수 픽셀이라 겹침 줄무늬 없음
    const N = RF.slices, RR = RF.refract, ppu = Math.max(1, pxPerUnit(camSpace(p.x, p.y, 0)[1]) * Math.max(0.2, rig.sp));
    const cw = w + 8, chh = oy + 2, G2 = compCanvas(cw, chh);
    G2.save(); G2.translate(ox + 4, 0); G2.scale(1, -1); G2.drawImage(off, 0, 0, pw, ph, -ox, -oy, w, oy); G2.restore();
    if (!onLand) {
      bandBlit(cw, chh, sx - ox - 4, wy, RF.alpha, N, (yc) => {
        const fr = clamp(yc / oy, 0, 1), dw = yc / ppu;
        const gg = simGrad(p.x - rig.F[0] * dw, p.y - rig.F[1] * dw), gR = gg[0] * rig.R[0] + gg[1] * rig.R[1];
        return clamp(gR * RR.gain, -RR.maxPx, RR.maxPx) * (0.4 + 0.6 * fr);
      });
      return;
    }
    // 젖은 모래: 작은 캔버스에 줄여 그렸다 키워서 번지게 (blur 대신), 젖음 강도 비례로 아주 옅게
    const sc = Math.min(1, 1 / Math.max(1, RF.wetBlurPx * 0.5)), bw = Math.ceil((cw + 8) * sc), bh = Math.ceil((chh + 8) * sc);
    if (blurCv.width < bw || blurCv.height < bh) { blurCv.width = Math.max(blurCv.width, bw); blurCv.height = Math.max(blurCv.height, bh); }
    blurG.setTransform(1, 0, 0, 1, 0, 0); blurG.clearRect(0, 0, blurCv.width, blurCv.height); blurG.imageSmoothingEnabled = true;
    blurG.drawImage(compCv, 0, 0, Math.ceil(cw * DPR), Math.ceil(chh * DPR), 4 * sc, 4 * sc, cw * sc, chh * sc);
    ctx.save(); ctx.globalAlpha = RF.wetAlpha * wetK; ctx.imageSmoothingEnabled = true;
    ctx.drawImage(blurCv, 0, 0, bw, bh, sx - ox - 8, wy - 4, bw / sc, bh / sc);
    ctx.restore();
  }

  // 바다반딧불이: 수면 아래의 부드러운 빛 덩이(보케) 몇 개 + 아주 작고 흐린 입자. 일반 합성, 코어·그림자·깜빡임 없음
  const bokehCache = new Map();
  function bokehSprite(h, s, l) {
    const key = `${Math.round(h)}_${Math.round(s)}_${Math.round(l)}`;
    let sp = bokehCache.get(key);
    if (!sp) {                                              // 중심은 흰빛에 가까운 푸른 번짐 → 맑은 청록 → 투명
      sp = makeSprite([[0, `hsla(${h},${s * 0.7}%,84%,1)`], [0.3, `hsla(${h},${s}%,${l}%,0.85)`], [0.65, `hsla(${h},${s}%,${l - 4}%,0.32)`], [1, `hsla(${h},${s}%,${l}%,0)`]]);   // 미색 바탕에서도 보이도록 중심은 아주 옅은 푸른 흰빛
      bokehCache.set(key, sp);
    }
    return sp;
  }
  const farFade = (d) => { const FF = C.FIREFLY.farFade; return 1 - (1 - FF[2]) * smooth(FF[0], FF[1], d); };
  const breath = (q) => 1 + C.FIREFLY.breath.amount * Math.sin(S.time * 6.283 / q.bp + q.ph);   // 숨쉬듯 ±25%
  // 수면 아래 빛 하나 (납작하게 물 위로 번진 모양)
  function drawBokeh(x, y, z, r, alpha, h, s, l) {
    const c = camSpace(x, y, z);
    if (c[1] < rig.near + 0.3 || alpha < 0.004) return;
    const [sx, sy] = toScreen(c), ppu = pxPerUnit(c[1]), flat = clamp(0.35 + rig.sp * 0.9, 0.4, 0.9);
    const g = clamp(r * ppu / 0.6, 3, 90);                 // 스프라이트의 보이는 반지름이 약 60% 라 r 이 실제 번짐 크기가 되게
    ctx.globalAlpha = clamp(alpha * farFade(c[1]), 0, 0.35);
    ctx.drawImage(bokehSprite(h, s, l), sx - g, sy - g * flat, g * 2, g * 2 * flat);
  }
  // 물을 휘저은 자리의 은은한 빛 (꼬리·항적·파문)
  function drawUnderwaterLight(x, y, depth, size, glow, hue, b, parts = 3, z0 = 0) {
    const F = C.FIREFLY, hh = lerp(F.hue[0], F.hue[1], hue / 2);
    drawBokeh(x, y, z0 - depth, size, b * F.sparkle.alpha, hh, (F.sat[0] + F.sat[1]) / 2, (F.light[0] + F.light[1]) / 2);
  }
  // 반딧불이 한 점: 바깥 #9c9cf4 · 중간 #b9b9fb · 중심 #f0f0ff 알파 합성. 숨쉬듯 ±25%, 큰 것일수록 옅게
  // 바다반딧불이 층별 스프라이트: 색마다 크기 단계(32·64·128px)로 미리 만들어 재사용
  const ffLayerSprites = (() => {
    const K = C.FIREFLY.colors, out = {};
    const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    for (const key of Object.keys(K)) {
      const [col, , , ] = K[key], [r, g2, b] = rgb(col);
      out[key] = [32, 64, 128].map((N) => {
        const cv = document.createElement('canvas'); cv.width = cv.height = N;
        const gg = cv.getContext('2d'), gr = gg.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2);
        if (key === 'rim') { gr.addColorStop(0, `rgba(${r},${g2},${b},0)`); gr.addColorStop(0.55, `rgba(${r},${g2},${b},0.15)`); gr.addColorStop(0.78, `rgba(${r},${g2},${b},1)`); gr.addColorStop(1, `rgba(${r},${g2},${b},0)`); }   // 가장자리 테두리
        else {                                                // 가우시안 모양: alpha × exp(−k r²), 끝은 0 (가장자리가 안 보임)
          const kk = C.FIREFLY.gauss, e1 = Math.exp(-kk);
          for (let i = 0; i <= 8; i++) { const t = i / 8; gr.addColorStop(t, `rgba(${r},${g2},${b},${((Math.exp(-kk * t * t) - e1) / (1 - e1)).toFixed(4)})`); }
        }
        gg.fillStyle = gr; gg.fillRect(0, 0, N, N); return cv;
      });
    }
    return out;
  })();
  const ffSprite = (key, px) => { const L = ffLayerSprites[key]; return px < 24 ? L[0] : px < 64 ? L[1] : L[2]; };
  // 화면에 기울어진 타원으로 한 겹 (중심, 반지름 rx·ry, 각도)
  function ffEllipse(key, sx, sy, rx, ry, ang, alpha, blend) {
    if (alpha < 0.004 || rx < 0.4) return;
    const img = ffSprite(key, rx * 2), c = Math.cos(ang), s = Math.sin(ang), k = img.width / 2;
    ctx.save(); ctx.globalCompositeOperation = blend; ctx.globalAlpha = Math.min(1, alpha);
    ctx.setTransform(DPR * c * rx / k, DPR * s * rx / k, DPR * -s * ry / k, DPR * c * ry / k, DPR * sx, DPR * sy);
    ctx.drawImage(img, -k, -k); ctx.restore();
  }
  // 빛 구름 하나: ① 그림자 풀(multiply) ② 바깥 번짐(multiply) ③ 본 번짐 ④ 테두리 ⑤ 핀포인트. 빠를 땐 뒤로 가는 꼬리
  function drawMember(m, k = 1, pinsOnly = false) {
    const c0 = camSpace(m.x, m.y, -m.depth);
    if (c0[1] < rig.near + 0.3) return;
    const F = C.FIREFLY, K = F.colors, [sx, sy] = toScreen(c0);
    // 펭귄 윤곽 × overlapScale 안에서는 옅게 (펭귄 뒤 레이어라도 번짐이 몸에 얹혀 보이지 않게)
    const pb = S.penBox, SEP = F.guide.separation;
    if (pb) { const qx = (sx - pb[0]) / pb[2], qy = (sy - pb[1]) / pb[3]; k *= lerp(SEP.overlapAlpha, 1, smooth(0.8, 1.25, qx * qx + qy * qy)); }
    const a = m.alpha * breath(m) * introVis() * farFade(c0[1]) * k * (S.ff.vis ?? 1);
    if (a < 0.004) return;
    const ppu = pxPerUnit(c0[1]), R = clamp(m.size * ppu, 2, 140), flat = clamp(0.35 + rig.sp * 0.9, 0.4, 0.9), big = m.size >= F.bigSize;
    // 진행 방향의 화면 각도
    const hx = Math.cos(m.ang), hy = Math.sin(m.ang), cv = Math.cos(cam.yaw), sv = Math.sin(cam.yaw);
    const ang = Math.atan2((sv * hx + cv * hy) * flat, cv * hx - sv * hy);
    if (!pinsOnly) {
      if (!big) ffEllipse('outer', sx, sy, R * K.outer[2] * 1.1, R * K.outer[2] * flat, ang, K.outer[1] * a, K.outer[3]);   // 바깥 번짐 (가산)
      // 꼬리: 진행 반대쪽으로 가늘게 늘어남 (길이 ∝ 속도, 최대 크기 × 3)
      if (m.streak > 0.02) {
        const len = R * F.streak.maxLen * m.streak, bx = sx - Math.cos(ang) * len * 0.5, by = sy - Math.sin(ang) * len * 0.5;
        ffEllipse('body', bx, by, len * 0.55 + R * 0.3, R * 0.16, ang, K.body[1] * a * m.streak * 0.8, K.body[3]);
      }
      if (big) ffEllipse('body', sx, sy, R * K.body[2] * 1.4, R * K.body[2] * 1.4 * flat, ang, F.bigBodyAlpha * a, K.body[3]);   // 본 번짐 하나
      else for (const L of m.lobes) {
        const lx = sx + (Math.cos(ang) * L.ox - Math.sin(ang) * L.oy) * R, ly = sy + (Math.sin(ang) * L.ox + Math.cos(ang) * L.oy) * R * flat;
        ffEllipse('body', lx, ly, R * K.body[2] * L.s * L.st, R * K.body[2] * L.s * flat, ang, K.body[1] * a / Math.sqrt(m.lobes.length), K.body[3]);
      }
      if (m.size <= F.rimMaxSize) ffEllipse('rim', sx, sy, R * K.rim[2] * 1.08, R * K.rim[2] * flat, ang, K.rim[1] * a, K.rim[3]);
    }
    for (const q of m.pins) {
      const px = sx + (Math.cos(ang) * q.ox - Math.sin(ang) * q.oy) * R, py = sy + (Math.sin(ang) * q.ox + Math.cos(ang) * q.oy) * R * flat;
      const pr = Math.max(0.8, R * K.core[2] * q.s);
      ffEllipse('core', px, py, pr, pr * Math.max(flat, 0.7), 0, K.core[1] * a, K.core[3]);
    }
  }
  // 수면 아래 층: 은은한 빛 + 군집 (빙하·파문은 이 위에 그려져 일부를 가림)
  function drawPlankton() {
    { const p = S.p, [psx, psy, pd] = project(p.x, p.y, p.z), u = penScale(pd), SEP = C.FIREFLY.guide.separation;   // 펭귄 윤곽 (반딧불이 옅게)
      S.penBox = [psx, psy + penOffset() - u * 0.5, u * 0.32 * SEP.overlapScale, u * 0.55 * SEP.overlapScale]; }
    for (const s of S.spark) {
      if (!s.on || s.z0) continue;
      const k = s.t / s.life, env = smooth(0, 0.25, k) * (1 - smooth(0.4, 1, k));
      drawUnderwaterLight(s.x, s.y, s.depth, s.size, 0, s.hue, env);
    }
    // 군집 근처 물 면에만 옅은 푸른 반사 (빙하는 이 위에 그려져 물들지 않음)
    { const FP = PAL.firefly, ff = S.ff, vis = introVis() * (ff.vis ?? 1);
      if (vis > 0.01 && FP.waterGlowAlpha > 0) {
        const e = groundEllipse(ff.cx, ff.cy, FP.waterGlowRadius);
        if (e) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = FP.waterGlowAlpha * vis * (1 - fogAt(e.d)); ctx.drawImage(ffGlow, e.x - e.rx, e.y - e.ry, e.rx * 2, e.ry * 2); ctx.restore(); }
      } }
    for (const m of S.ff.members) drawMember(m);
    ctx.globalAlpha = 1;
  }
  const ffGlow = (() => { const kk = C.FIREFLY.gauss, e1 = Math.exp(-kk), col = rgbS(PAL.firefly.waterGlow), st = []; for (let i = 0; i <= 8; i++) { const t = i / 8; st.push([t, `rgba(${col},${((Math.exp(-kk * t * t) - e1) / (1 - e1)).toFixed(4)})`]); } return makeSprite(st); })();
  // 안개 위로 한 번 더 비치는 큰 빛 (안개에 묻히지 않게). 빙하 밑이거나 펭귄 몸 뒤면 건너뜀
  function drawPlanktonOverFog() {
    const F = C.FIREFLY, p = S.p, [psx, psy, pd] = project(p.x, p.y, p.z), u = penScale(pd);
    for (const m of S.ff.members) {
      if (floeAt(m.x, m.y)) continue;
      const c = camSpace(m.x, m.y, -m.depth); if (c[1] < rig.near + 0.3) continue;
      const [sx, sy] = toScreen(c);
      if (c[1] > pd && Math.abs(sx - psx) < u * 0.35 && sy < psy + 4 && sy > psy - u * 1.05) continue;
      drawMember(m, F.overFogAlpha, true);                   // 안개 위로는 중심 핀포인트만
    }
    ctx.globalAlpha = 1;
  }

  // ── UI ─────────────────────────────────────────────────
  const sampler = document.createElement('canvas'); sampler.width = sampler.height = 6;
  const sg = sampler.getContext('2d', { willReadFrequently: true });
  const lum = { ring: 0.06, action: 0.06, target: { ring: 0.06, action: 0.06 }, lastSample: 0 };
  function sampleLum(cx, cy, r) {
    const x = clamp(cx - r, 0, W - 1), y = clamp(cy - r, 0, H - 1), w = Math.min(r * 2, W - x), h = Math.min(r * 2, H - y);
    if (w < 2 || h < 2) return 0.93;
    sg.drawImage(canvas, x * DPR, y * DPR, w * DPR, h * DPR, 0, 0, 6, 6);
    const d = sg.getImageData(0, 0, 6, 6).data;
    let s = 0;
    for (let i = 0; i < d.length; i += 4) s += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
    return s / 36;
  }
  function uiColor(l, strength = 1) {
    const A = C.ui.adapt, t = 1 - smooth(A.threshold[0], A.threshold[1], l);
    const c = COL.ink.map((v) => Math.round(v + (255 - v) * t));
    const a = (A.lightAlpha + (A.darkAlpha - A.lightAlpha) * t) * strength;
    return `rgba(${c[0]},${c[1]},${c[2]},${a.toFixed(3)})`;
  }
  function updateUiLum(dt) {
    const now = performance.now();
    if (now - lum.lastSample > C.ui.adapt.sampleMs) {
      lum.lastSample = now;
      try {
        lum.target.ring = sampleLum(layout.ring.x, layout.ring.y, C.ui.ring.radius * 1.8);
        lum.target.action = sampleLum(layout.action.x, layout.action.y, C.ui.action.radius * 1.8);
      } catch (_) { /* 읽기 실패 시 이전 값 유지 */ }
    }
    const k = ease(C.ui.adapt.smooth, dt);
    lum.ring += (lum.target.ring - lum.ring) * k;
    lum.action += (lum.target.action - lum.action) * k;
  }
  function drawUI(dt) {
    updateUiLum(dt);
    const R = C.ui.ring, rg = layout.ring;
    let active = null;
    for (const ptr of pointers.values()) if (ptr.role === 'ring') { active = ptr; break; }
    if (R.hidden) active = null;                               // GRIS: 링 그림 없음
    else {
    ctx.lineWidth = R.lineWidth;
    ctx.strokeStyle = uiColor(lum.ring, active ? 1.4 : 1);
    ctx.beginPath(); ctx.arc(rg.x, rg.y, R.radius, 0, Math.PI * 2); ctx.stroke();
    if (active) {
      let dx = active.x - active.ox, dy = active.y - active.oy;
      const l = Math.hypot(dx, dy), lim = R.radius;
      if (l > lim) { dx *= lim / l; dy *= lim / l; }
      ctx.fillStyle = uiColor(lum.ring, 1.2);
      ctx.beginPath(); ctx.arc(rg.x + dx, rg.y + dy, R.radius * 0.32, 0, Math.PI * 2); ctx.fill();
    }
    }
    const A = C.ui.action, a = layout.action;
    let pressed = false;
    for (const ptr of pointers.values()) if (ptr.role === 'action') pressed = true;
    const sc = A.radius * (pressed ? 0.9 : 1) * (1 + S.tapPulse * 0.06);
    // 진하기: 누르면 touch, 뗀 뒤 hold 초까지 유지 → 평소 alphaScale → after 초 동안 안 만지면 idle 로 (fade 초에 걸쳐)
    let want = (pressed ? 1.4 : 1) * A.alphaScale;
    const ID = A.idle;
    if (ID) {
      const now = performance.now() / 1000;
      if (pressed || S.pawLast == null) S.pawLast = now;
      const since = now - S.pawLast;
      want = pressed || since < ID.hold ? ID.touch : since > ID.after ? ID.alpha : A.alphaScale;
      const cur = S.pawK ?? want, rate = want > cur ? 1 / 0.12 : Math.abs(cur - want) / Math.max(0.05, ID.fade - 0) * 1.0;
      S.pawK = want > cur ? Math.min(want, cur + (want - cur) * Math.min(1, dt * 12)) : Math.max(want, cur - Math.max(rate, (A.alphaScale - ID.alpha) / ID.fade) * dt);
      want = S.pawK;
    }
    drawPaw(a.x, a.y + sc * 0.04, sc, lum.action, want);
  }

  // 발바닥 모양 (버튼·발자국 공용): 베지어 구간, 그리고 다각형으로 샘플링한 것
  const PAW_SEGS = [[-0.35, -0.75], [-0.18, -0.89, -0.05, -1.0, 0.165, -1.0], [0.375, -1.0, 0.475, -0.765, 0.55, -0.615],
    [0.775, -0.565, 0.885, -0.39, 0.885, -0.14], [0.885, 0.36, 0.275, 1.0, -0.15, 1.0], [-0.625, 1.0, -0.885, 0.46, -0.885, -0.14],
    [-0.885, -0.64, -0.675, -0.8, -0.5, -0.8], [-0.43, -0.8, -0.38, -0.76, -0.35, -0.75]];
  const PAW_POLY = (() => {
    const out = []; let [x0, y0] = PAW_SEGS[0];
    for (let s = 1; s < PAW_SEGS.length; s++) {
      const [a, b, c2, d2, e2, f2] = PAW_SEGS[s];
      for (let i = 1; i <= 5; i++) {
        const t = i / 5, m = 1 - t;
        out.push([m * m * m * x0 + 3 * m * m * t * a + 3 * m * t * t * c2 + t * t * t * e2, m * m * m * y0 + 3 * m * m * t * b + 3 * m * t * t * d2 + t * t * t * f2]);
      }
      x0 = e2; y0 = f2;
    }
    return out;
  })();
  // 발자국 스프라이트: 선명·보통·흐림 3단계를 미리 만들어 둠 (중심이 진한 방사형 그라데이션)
  const pawPrintSprites = new Map();
  function pawPrints(rgb) {
    const key = rgb.join(',');
    if (pawPrintSprites.has(key)) return pawPrintSprites.get(key);
    const N = 96, make = (down) => {
      const s = Math.max(8, Math.round(N / down)), sm = document.createElement('canvas'); sm.width = sm.height = s;
      const g2 = sm.getContext('2d'), k = s / 2 * 0.82;
      const gr = g2.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, k * 1.05);
      gr.addColorStop(0, `rgba(${key},1)`); gr.addColorStop(1, `rgba(${key},0.5)`);
      g2.fillStyle = gr; g2.beginPath(); PAW_POLY.forEach(([x, y], i) => (i ? g2.lineTo(s / 2 + x * k, s / 2 + y * k) : g2.moveTo(s / 2 + x * k, s / 2 + y * k))); g2.closePath(); g2.fill();
      const big = document.createElement('canvas'); big.width = big.height = N;
      const bg2 = big.getContext('2d'); bg2.imageSmoothingEnabled = true; bg2.imageSmoothingQuality = 'high'; bg2.drawImage(sm, 0, 0, N, N);
      return big;
    };
    const set = { sharp: make(1), mid: make(3), blur: make(7) };
    pawPrintSprites.set(key, set);
    return set;
  }
  // 발자국 하나: 찍힐 때 흐림 → 선명, 사라질 때 선명 → 흐림으로 교차 페이드
  // GRIS 섬 발자국: 모래는 깊게 (진한 안쪽 + 빛 쪽으로 살짝 밀려난 밝은 테), 숲·언덕은 옅게. 해안 그림과 따로 그려 숲에서도 보임
  function drawIslandPrints() {
    const FP = C.FOOTPRINTS; if (!IT || !FP.sand) return;
    const GR = C.PHYSICS.toboggan && C.PHYSICS.toboggan.groove;
    if (GR && S.grooves && S.grooves.length > 1) {   // 터보건 홈: 끊김 없는 띠 하나로. 배 가까이(최근) 진하고 넓게 → 멀어질수록 연하고 가늘게, 양끝은 뾰족하게 모음
      const runs = []; let run = null;
      for (const q of S.grooves) { if (!q.cont || !run) { run = []; runs.push(run); } run.push(q); }
      const col = GR.color.join(',');
      for (const rn of runs) {
        if (rn.length < 2) continue;
        const P2 = [];
        for (let i = 0; i < rn.length; i++) { const q = rn[i], c = camSpace(q.x, q.y, terrainHeightAt(q.x, q.y) + 0.004); if (c[1] < rig.near + 0.3) { P2.length = 0; break; }
          const sp = toScreen(c), age = q.t, endK = Math.min(1, (i + 0.5) / GR.taper, (rn.length - 1 - i + 0.5) / GR.taper);
          P2.push({ x: sp[0], y: sp[1], w: GR.width * pxPerUnit(c[1]) * 0.5 * Math.sqrt(Math.max(0, endK)) * (0.55 + 0.45 * Math.exp(-age / GR.fadeTime)) * (0.6 + 0.4 * q.k),
            a: GR.alpha * q.k * (0.2 + 0.8 * Math.exp(-age / GR.fadeTime)) * (1 - smooth(0.6, 1, age / GR.life)) * smooth(0, 0.1, age) * (1 - fogAt(c[1])) }); }
        if (P2.length < 2) continue;
        const L2 = [], R2 = [];
        for (let i = 0; i < P2.length; i++) { const a = P2[Math.max(0, i - 1)], b = P2[Math.min(P2.length - 1, i + 1)]; let nx = -(b.y - a.y), ny = b.x - a.x; const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
          L2.push([P2[i].x + nx * P2[i].w, P2[i].y + ny * P2[i].w]); R2.push([P2[i].x - nx * P2[i].w, P2[i].y - ny * P2[i].w]); }
        const h = P2[P2.length - 1], t0 = P2[0], gx = h.x - t0.x, gy = h.y - t0.y, gl2 = gx * gx + gy * gy || 1;
        const grd = ctx.createLinearGradient(t0.x, t0.y, h.x, h.y);   // 오래된 끝(연함) → 배 쪽(진함)
        const step = Math.max(1, Math.floor(P2.length / 12)); let last = -1;
        for (let i = 0; i < P2.length; i += step) { const u = clamp(((P2[i].x - t0.x) * gx + (P2[i].y - t0.y) * gy) / gl2, 0, 1); if (u <= last) continue; last = u; grd.addColorStop(u, `rgba(${col},${P2[i].a.toFixed(3)})`); }
        grd.addColorStop(1, `rgba(${col},${h.a.toFixed(3)})`);
        ctx.fillStyle = grd; ctx.beginPath(); ctx.moveTo(L2[0][0], L2[0][1]);
        for (let i = 1; i < L2.length; i++) ctx.lineTo(L2[i][0], L2[i][1]);
        for (let i = R2.length - 1; i >= 0; i--) ctx.lineTo(R2[i][0], R2[i][1]);
        ctx.closePath(); ctx.fill();
      }
    }
    const SDp = FP.sand, FR = FP.forest, sandSet = pawPrints(SDp.color), forSet = pawPrints(FR.color), rimSet = pawPrints(SDp.rim), L = FIXED_LIGHT;
    for (const q of S.prints) {
      if (!q.on) continue;
      const c = camSpace(q.x, q.y, 0); if (c[1] < rig.near + 0.3) continue;
      const fog = fogAt(c[1]), z = terrainHeightAt(q.x, q.y) + 0.004, onSand = inlandDist(q.x, q.y) < IT.zones[0].to;
      const Z = onSand ? SDp : FR, life = Z.life;
      if (q.t >= life) { q.on = false; continue; }
      if (onSand) drawPawPrint(rimSet, q.x + L[0] * SDp.rimOffset, q.y + L[1] * SDp.rimOffset, q.ang, q.side, FP.size * Z.size * 1.12, q.t, life, SDp.rimAlpha * (1 - fog), z);
      drawPawPrint(onSand ? sandSet : forSet, q.x, q.y, q.ang, q.side, FP.size * Z.size, q.t, life, Z.alpha * (1 - fog), z);
    }
    ctx.globalAlpha = 1;
  }
  function drawPawPrint(set, x, y, ang, side, size, t, life, alpha, z, oy = 0) {
    const FP = C.FOOTPRINTS, a = ang + side * deg(FP.toeOutDeg), rx = Math.sin(a), ry = -Math.cos(a);
    size *= 1 + (FP.pressFrom - 1) * (1 - smooth(0, FP.pressTime, t));   // 찍히는 순간 110% → 100%
    const kin = smooth(0, FP.fadeIn, t), kout = smooth(0.45, 1, t / life), fade = 1 - smooth(0.6, 1, t / life);
    const wSharp = kin * (1 - kout), wMid = Math.min(kin, kout) * 0.8 + (1 - kin) * 0.4, wBlur = Math.max(1 - kin, kout);
    const tot = wSharp + wMid + wBlur || 1;
    for (const [img, wv] of [[set.blur, wBlur], [set.mid, wMid], [set.sharp, wSharp]]) {
      if (wv / tot < 0.02) continue;
      drawGroundImage(img, x, y, rx * side, ry * side, size, -size * side, alpha * fade * wv / tot * 1.3, z, oy);
    }
  }
  // 둥근 물갈퀴 발바닥: 작은 캔버스에 불투명하게 그린 뒤 한 번에 반투명으로 얹음 (겹친 곳도 같은 농도)
  const pawCv = document.createElement('canvas'), pawG = pawCv.getContext('2d');
  function drawPaw(cx, cy, sc, l, strength) {
    const A = C.ui.adapt, t = 1 - smooth(A.threshold[0], A.threshold[1], l);
    const rgb = COL.ink.map((v) => Math.round(v + (255 - v) * t));
    const alpha = clamp((A.lightAlpha + (A.darkAlpha - A.lightAlpha) * t) * strength, 0, 1);
    const size = Math.ceil(sc * 2.2 * DPR);
    if (pawCv.width !== size) { pawCv.width = pawCv.height = size; }
    const g2 = pawG;
    g2.setTransform(1, 0, 0, 1, 0, 0); g2.clearRect(0, 0, size, size);
    g2.setTransform(size / 2.2, 0, 0, size / 2.2, size / 2, size / 2);
    g2.fillStyle = `rgb(${rgb.join(',')})`;
    // 보내 준 그림처럼 하나로 이어진 둥근 물갈퀴 발자국 (위쪽에 둥근 봉우리 세 개, 아래는 둥글게)
    g2.beginPath();
    g2.moveTo(-0.35, -0.75);
    g2.bezierCurveTo(-0.18, -0.89, -0.05, -1.0, 0.165, -1.0);
    g2.bezierCurveTo(0.375, -1.0, 0.475, -0.765, 0.55, -0.615);
    g2.bezierCurveTo(0.775, -0.565, 0.885, -0.39, 0.885, -0.14);
    g2.bezierCurveTo(0.885, 0.36, 0.275, 1.0, -0.15, 1.0);
    g2.bezierCurveTo(-0.625, 1.0, -0.885, 0.46, -0.885, -0.14);
    g2.bezierCurveTo(-0.885, -0.64, -0.675, -0.8, -0.5, -0.8);
    g2.bezierCurveTo(-0.43, -0.8, -0.38, -0.76, -0.35, -0.75);
    g2.closePath();
    const AO = C.ui.action;
    if (AO.outline) {                                          // 가는 외곽선 + 아주 옅은 채움 (임시 도형, 나중에 그림으로 교체)
      g2.globalAlpha = clamp(AO.fillAlpha / Math.max(alpha, 0.01), 0, 1); g2.fill(); g2.globalAlpha = 1;
      g2.lineWidth = AO.outline * DPR / (size / 2.2); g2.lineJoin = 'round'; g2.strokeStyle = g2.fillStyle; g2.stroke();
    } else g2.fill();
    ctx.globalAlpha = alpha;
    ctx.drawImage(pawCv, cx - sc * 1.1, cy - sc * 1.1, sc * 2.2, sc * 2.2);
    ctx.globalAlpha = 1;
  }

  // 안개: 옅은 거리 안개 + 수평선 띠 + fbm 타일을 스크롤하는 안개덩이 (낮은 해상도 오프스크린)
  const fogTile = (() => {
    const FC = C.FOG.clumps, N = FC.tileSize, cv = document.createElement('canvas'); cv.width = cv.height = N;
    const g2 = cv.getContext('2d'), img = g2.createImageData(N, N), r = rng(FC.seed);
    const grids = [];
    for (let o = 0; o < FC.octaves; o++) { const P = 4 << o, gr = new Float32Array(P * P); for (let i = 0; i < gr.length; i++) gr[i] = r(); grids.push({ P, gr }); }
    const sample = ({ P, gr }, x, y) => {                      // 주기적으로 이어지는(타일) 값 노이즈
      const fx = x * P, fy = y * P, i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j;
      const at = (a, b) => gr[((b % P) + P) % P * P + ((a % P) + P) % P];
      const su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
      return lerp(lerp(at(i, j), at(i + 1, j), su), lerp(at(i, j + 1), at(i + 1, j + 1), su), sv);
    };
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      let v = 0, amp = 0.5, tot = 0;
      for (const gdat of grids) { v += sample(gdat, x / N, y / N) * amp; tot += amp; amp *= 0.5; }
      v /= tot;
      const a = smooth(FC.threshold[0], FC.threshold[1], v), k = (y * N + x) * 4;
      img.data[k] = 255; img.data[k + 1] = 255; img.data[k + 2] = 255; img.data[k + 3] = Math.round(a * 255);
    }
    g2.putImageData(img, 0, 0);
    // 2톤: 같은 무늬에 색만 입힌 타일 두 장 (층마다 번갈아)
    return PAL.fogClumps.map((col) => {
      const c2 = document.createElement('canvas'); c2.width = c2.height = N; const q = c2.getContext('2d');
      q.drawImage(cv, 0, 0); q.globalCompositeOperation = 'source-in'; q.fillStyle = `rgb(${rgbS(col)})`; q.fillRect(0, 0, N, N);
      return c2;
    });
  })();
  const fogCv = document.createElement('canvas'), fogG = fogCv.getContext('2d');
  const layCv = document.createElement('canvas'), layG = layCv.getContext('2d');
  const nearCv = document.createElement('canvas'), nearG = nearCv.getContext('2d');
  const fitCv = (cv, w, h) => { if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; } };
  // 한 겹: 타일을 스크롤해 깔고, 세로 띠 모양으로 잘라 냄
  function drawClumpLayer(dst, L, li, w, h) {
    const hz = rig.horizon / H, tw = Math.max(4, L.scale * w), th = tw;
    layG.setTransform(1, 0, 0, 1, 0, 0); layG.globalCompositeOperation = 'source-over'; layG.clearRect(0, 0, w, h);
    const ox = ((-(S.time * L.speed * w) - cam.yaw / (Math.PI * 2) * w * 2.2 * (1 / L.scale)) % tw + tw) % tw - tw;
    const oy = ((S.time * L.speed * w * 0.15 + li * 37) % th + th) % th - th;
    layG.globalAlpha = L.alpha;
    for (let x = ox; x < w; x += tw) for (let y = oy; y < h; y += th) layG.drawImage(fogTile[li % fogTile.length], x, y, tw + 0.5, th + 0.5);
    layG.globalAlpha = 1; layG.globalCompositeOperation = 'destination-in';
    const cy = (hz + L.y) * h, hh = L.height * h / 2, gr = layG.createLinearGradient(0, cy - hh, 0, cy + hh);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.35, 'rgba(0,0,0,1)'); gr.addColorStop(0.65, 'rgba(0,0,0,1)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    layG.fillStyle = gr; layG.fillRect(0, 0, w, h);
    layG.globalCompositeOperation = 'source-over';
    dst.drawImage(layCv, 0, 0);
  }
  // 먼 층 (먼 산·섬을 가렸다 드러냄): 펭귄·가까운 빙하보다 먼저
  function drawFogLayers() {
    const FG = C.FOG, w = Math.max(8, Math.ceil(W * FG.resolution)), h = Math.max(8, Math.ceil(H * FG.resolution));
    fitCv(fogCv, w, h); fitCv(layCv, w, h);
    fogG.setTransform(1, 0, 0, 1, 0, 0); fogG.clearRect(0, 0, w, h);
    const hz = rig.horizon / H, bh = FG.horizonBand.height, gb = fogG.createLinearGradient(0, (hz - bh) * h, 0, (hz + bh) * h);
    const fb = rgbS(PAL.fogBand);
    gb.addColorStop(0, `rgba(${fb},0)`); gb.addColorStop(0.5, `rgba(${fb},${FG.horizonBand.alpha})`); gb.addColorStop(1, `rgba(${fb},0)`);
    fogG.fillStyle = gb; fogG.fillRect(0, (hz - bh) * h, w, bh * 2 * h);
    FG.clumps.layers.forEach((L, li) => { if (!L.near) drawClumpLayer(fogG, L, li, w, h); });
    ctx.imageSmoothingEnabled = true; ctx.globalAlpha = 1; ctx.drawImage(fogCv, 0, 0, W, H);
  }
  // 가까운 층: 빠르고 작게 펭귄 앞을 지나감. 펭귄 둘레는 농도를 줄여 조작이 보이게
  function drawNearFog() {
    const FG = C.FOG, w = Math.max(8, Math.ceil(W * FG.resolution)), h = Math.max(8, Math.ceil(H * FG.resolution));
    fitCv(nearCv, w, h); fitCv(layCv, w, h);
    nearG.setTransform(1, 0, 0, 1, 0, 0); nearG.globalCompositeOperation = 'source-over'; nearG.clearRect(0, 0, w, h);
    let has = false;
    FG.clumps.layers.forEach((L, li) => { if (L.near) { drawClumpLayer(nearG, L, li, w, h); has = true; } });
    if (!has) return;
    const p = S.p, [sx, sy, d] = project(p.x, p.y, p.z), u = penScale(d), cx = sx / W * w, cy = (sy - u * 0.5) / H * h, rr = FG.penguinClear.radius * h;
    nearG.globalCompositeOperation = 'destination-out';
    const gr = nearG.createRadialGradient(cx, cy, 0, cx, cy, rr);
    gr.addColorStop(0, `rgba(0,0,0,${1 - FG.penguinClear.keep})`); gr.addColorStop(0.6, `rgba(0,0,0,${(1 - FG.penguinClear.keep) * 0.7})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
    nearG.fillStyle = gr; nearG.fillRect(0, 0, w, h);
    nearG.globalCompositeOperation = 'source-over';
    ctx.imageSmoothingEnabled = true; ctx.globalAlpha = 1; ctx.drawImage(nearCv, 0, 0, W, H);
  }

  // 오프스크린 해상도 배율: 기본값 × 기기 픽셀비(최대 dprMax) × 품질 단계
  const offRes = (base) => { const Q = C.quality; return Q ? base * Math.min(Q.dprMax, DPR) * Q.tiers[S.qTier || 0] : base; };
  // 디더: ±1 레벨 노이즈 타일 (어두운 그라데이션의 띠·계단 숨김)
  const ditherPat = (() => { const N = 128, cv = document.createElement('canvas'); cv.width = cv.height = N; const g2 = cv.getContext('2d'), img = g2.createImageData(N, N), r = rng(91);
    for (let i = 0; i < N * N; i++) { const up = r() < 0.5, k = i * 4; img.data[k] = img.data[k + 1] = img.data[k + 2] = up ? 255 : 0; img.data[k + 3] = 2; }
    g2.putImageData(img, 0, 0); return cv; })();
  let ditherFill = null;
  function drawDither() {
    const Q = C.quality; if (!Q || !Q.dither) return;
    if (!ditherFill) ditherFill = ctx.createPattern(ditherPat, 'repeat');
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = Math.min(1, Q.dither); ctx.fillStyle = ditherFill; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.restore();
  }
  function draw(dt) {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.imageSmoothingQuality = C.quality && C.quality.smoothHigh && !(S.qTier > 0) ? 'high' : 'low';   // 고품질 보간은 최고 단계에서만 (느린 기기에선 비쌈). 캔버스 크기가 바뀌면 초기화되므로 매 프레임
    ctx.globalAlpha = 1;
    updateRig();
    drawSky();
    drawStars();
    // 수면에 붙은 것: 잔물결 → 파문·항적 → 흐름선 → 반영
    drawWaterTone();
    drawShallows();
    drawShoreTrain();
    drawSwell();
    drawPlankton();
    drawStreams();
    drawContours();
    drawWater();
    const fl = activeFloes();
    for (const f of fl) drawFlowLines(f.x, f.y, f.dir, Math.hypot(f.vx, f.vy), 4, f.cr, f.R * 0.7, floeOffset(f));
    const p = S.p;
    if (p.mode === 'water' && !p.air) {
      const sp = Math.hypot(p.vx, p.vy);
      if (sp > 0.05 && p.depth !== 'deep') drawFlowLines(p.x, p.y, [p.vx / sp, p.vy / sp], sp, P.penguin.maxSpeed.water, 0.25 * C.penguin.scale, 0.15, 0);   // 헤엄 중엔 선 대신 명암
    }
    drawReflection();
    drawIslandGround();
    if (sim && SIM.shore.draw) drawSimShore(); else drawShoreWash();
    drawIslandPrints();
    // 서 있는 것: 깊이 순서대로 먼 것부터
    const items = [];
    const pd = camSpace(p.x, p.y, p.z)[1];
    for (const f of fl) {
      const d = camSpace(f.x, f.y, 0)[1];
      // 펭귄이 올라선 빙하는 항상 펭귄보다 먼저 (빙하가 발을 덮지 않게)
      const sd = f === p.floe && !p.air ? Math.max(d, pd + 0.01) : d;
      if (d > -f.R) items.push({ d: sd, draw: () => drawFloe(f, Math.max(d, 0)) });
    }
    mountainItems(items);
    terrainItems(items);
    snowItems(items);
    dropItems(items);
    items.push({ d: pd, draw: drawPenguin });
    items.sort((a, b) => b.d - a.d);
    // 먼 것 → 안개 층 → 가까운 것 (펭귄·가까운 빙하는 선명하게)
    let fogged = false;
    for (const it of items) {
      if (!fogged && it.d < C.FOG.keepClearDepth) { drawFogLayers(); fogged = true; }
      it.draw();
    }
    if (!fogged) drawFogLayers();
    drawNearFog();
    drawPlanktonOverFog();
    ctx.globalAlpha = 1;
    drawDither();
    if (IT && C.debugTerrain) drawTerrainDebug();
    drawUI(dt);
  }

  // ── 루프: 60Hz 고정 단계 + 프레임 저하 시 입자 수 줄이기 ──────
  let last = performance.now(), acc = 0, frameAvg = 1 / 60, qBad = 0, qGood = 0;
  S.quality = 1;
  function frame(now) {
    const real = Math.max(0, (now - last) / 1000);
    last = now;
    frameAvg += (Math.min(real, 0.1) - frameAvg) * 0.05;
    if (frameAvg > 1 / 45) S.quality = Math.max(0.5, S.quality - 0.01);
    else if (frameAvg < 1 / 56) S.quality = Math.min(1, S.quality + 0.002);
    { const Q = C.quality;                                     // 품질 단계: 느리면 해상도 한 단계 낮춤, 넉넉하면 올림
      if (Q) {
        qBad = frameAvg > 1 / Q.downFps ? qBad + real : 0; qGood = frameAvg < 1 / Q.upFps ? qGood + real : 0;
        if (qBad > Q.downAfter && (S.qTier || 0) < Q.tiers.length - 1) { S.qTier = (S.qTier || 0) + 1; qBad = 0; }
        if (qGood > Q.upAfter && (S.qTier || 0) > 0) { S.qTier--; qGood = 0; }
      } }
    acc += Math.min(real, 0.1);
    let n = 0;
    while (acc >= STEP && n < 6) { step(STEP); acc -= STEP; n++; }
    if (n === 6) acc = 0;
    draw(real);
    requestAnimationFrame(frame);
  }

  resize();
  reset();
  requestAnimationFrame(frame);

  window.__game = { drawPenguinFigure, penguinView, surfaceAt, get sim() { return sim; }, drawFrame: () => draw(1 / 60), step, keys, STEP, penScale, floeTopAt, terrainHeightAt, depthAt, S, C, cam, layout, pointers, project, reset, screenDirToWorld, lum, activeFloes, jumpMaxDist };
})();
