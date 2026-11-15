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
  const WC = () => C.water;   // 프리셋 교체를 즉시 반영

  const COL = {
    bg: '#f3eee3',
    floeTop: '#ffffff', floeSide: '#d9d5cc',
    shoreTop: '#9c9890', shoreSide: '#4a4a4d',
    mountNear: [38, 38, 42], mountFar: [214, 209, 199], farRidge: '#e4dfd4',
    black: '#1b1b1d', white: '#ffffff', beak: '#7a7a7a', fish: '#2c2c30',
    ink: [40, 40, 44], water: '96, 106, 118',
  };

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

  // ── 상태 ────────────────────────────────────────────────
  const S = {};
  const cam = { x: 0, y: 0, yaw: 0, yawT: 0, pitch: 0, pitchT: 0 };

  function makeIsland(side, seed) {
    const w = C.world, r = rng(seed);
    const shoreX = side * w.islandDistance, cx = side * (w.islandDistance + w.islandHalfWidth);
    const shape = blob(w.islandHalfWidth, w.islandHalfLength, 48, 0.04, seed).map(([x, y]) => [x + cx, y]);
    const peaks = [];
    const peak = (dist, y, h, rWant) => {
      const rad = Math.min(rWant, dist - 2.5);
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
    for (let y = -w.islandHalfLength + 6; y <= w.islandHalfLength - 6; y += 4 + r() * 2) peak(6 + r() * 1.5, y, 3 + r() * 4, 3);
    return { side, shoreX, cx, cy: 0, rx: w.islandHalfWidth, ry: w.islandHalfLength, shape, peaks };
  }

  // ── 빙하 배치 (시드 고정 후보 목록) ─────────────────────────
  const baseRX = () => C.floe.radiusX * C.floe.scale, baseRY = () => C.floe.radiusY * C.floe.scale;
  function genField() {
    const r = rng(IF.seed), D = C.world.islandDistance;
    const list = IF.fixed.map((f, i) => ({ x: f.x, y: f.y, size: f.size, start: !!f.start, fixed: true, seed: 7 + i * 101 }));
    const radOf = (c) => baseRX() * c.size;
    const fish = fishZone();
    const clear = (x, y, rr) => !list.some((c) => Math.hypot(c.x - x, c.y - y) < radOf(c) + rr + IF.keepClear)
      && !fish.some(([fx, fy]) => Math.hypot(fx - x, fy - y) < rr + IF.keepClear);
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
          if (clear(side * cx, cy, rr)) list.push({ x: side * cx, y: cy, size, seed: (r() * 1e9) | 0 });
        }
        x += lerp(IF.spacing[0], IF.spacing[1], p) * (0.8 + 0.4 * r()) / Math.sqrt(dens);
      }
    }
    list.forEach((c, i) => { c.id = i; c.vx = 0; c.vy = 0; c.floe = null; });
    return list;
  }
  // 물고기가 뛰고 착수하는 자리 (시작 시선 기준) — 빙하를 놓지 않음
  function fishZone() {
    const F = C.fish, [Fx, Fy] = startForward(), Rx = -Fy, Ry = Fx;
    const at = (r, d) => [Rx * r + Fx * d, Ry * r + Fy * d];
    return [at(F.startRight, F.ahead), at(-F.landLeft, F.ahead + 0.5), at(-(F.landLeft + F.jump2.distance), F.ahead + F.jump2.ahead)];
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
      shape: c.shape || (c.shape = blob(rx, ry, c.start ? 14 : 8 + ((r() * 6) | 0), c.start ? 0.1 : 0.1 + r() * 0.14, c.seed)),
      rx, ry, born: S.time === 0 ? -10 : S.time, grab: null, lastEmit: null, peakSpeed: 0, prevSpeed: 0, aLong: 0, dir: [1, 0],
      ph: [r() * WC().bob.phaseSpread, r() * WC().bob.phaseSpread, r() * 6.28, r() * 6.28],
    });
    f.R = Math.max(...f.shape.map(([x, y]) => Math.hypot(x, y)));
    f.cr = (rx + ry) / 2 * 0.92;                              // 충돌 원 반지름
    f.mass = Math.PI * rx * ry * P.floeDensity;
    f.heave.h = 0; f.heave.v = 0; f.tilt.x = f.tilt.y = f.tilt.vx = f.tilt.vy = 0; f.hist.fill(0);
    c.floe = f;
    return f;
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
    S.time = 0; S.finished = false; S.stepN = 0;
    S.cands = genField();
    S.floePool = Array.from({ length: IF.maxActive }, newFloeObj);
    S.islands = [makeIsland(-1, 57)];                        // 왼쪽 섬만. 오른쪽은 안개에 녹는 열린 바다
    const [sfx, sfy] = startForward();
    cam.x = 0; cam.y = 0; cam.z = 0; cam.yaw = cam.yawT = yawFromForward(sfx, sfy);
    cam.pitch = cam.pitchT = deg(C.camera.pitchDeg);
    S.lastCamTouch = -99;
    S.p = {
      x: 0, y: 0, z: 0.12, vx: 0, vy: 0, vz: 0, cvx: 0, cvy: 0,
      face: Math.atan2(sfy, sfx), mode: 'floe', floe: null, lx: 0, ly: 0, air: false,
      sliding: false, sit: true, sink: 0, wobble: 0, phase: 0, idleRing: 0, ripple: 0,
      heave: { h: 0, v: 0 }, lean: { h: 0, v: 0 }, peakSpeed: 0, prevSpeed: 0, aLong: 0, lastEmit: null,
    };
    manageField();
    S.p.floe = S.cands[0].floe;
    S.ripples = [];
    S.wake = Array.from({ length: WC().wake.maxParticles }, () => ({ on: false }));
    S.lines = null;
    S.lastTapUp = 0; S.tapPulse = 0; S.jumpAt = 0; S.jumpReq = false;
    S.fish = { state: 'wait', t: 0 };
    const r0 = C.firefly.route[0];
    S.ff = { i: 0, x: r0[0], y: r0[1], z: r0[2], comp: Array.from({ length: C.firefly.companions }, (_, k) => ({ ph: k * 2.4 + 1, rad: 0.5 + k * 0.25 })) };
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
    const D = rig.f * penH() * cp / (K.penguinScreenH * H);
    // 위에서 내려다볼수록 펭귄이 화면 중앙 쪽으로
    const lift = smooth(deg(K.pitchDeg), deg(K.pitchMaxDeg), phi);
    const V = (rig.cy0 - lerp(K.penguinScreenY, K.penguinScreenYTop, lift) * H) * D / rig.f;
    const back = D * cp + V * sp, up = D * sp - V * cp;
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
  const fogAt = (d, fg = C.camera.fog) => fg.max * smooth(fg.start, fg.end, d);
  const BG = [243, 238, 227];
  const mixFog = (rgb, t) => `rgb(${rgb.map((v, i) => Math.round(v + (BG[i] - v) * t)).join(',')})`;
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
  const FLOE_TOP = 0.12;
  const floeTopAt = (f, lx, ly) => FLOE_TOP + f.tilt.x * lx + f.tilt.y * ly;
  const onFloe = (f, x, y, scale = 1) => f && f.active && inPoly(f.shape, (x - f.x) / scale, (y - f.y) / scale);
  const floeAt = (x, y, scale = 1) => S.floePool.find((f) => f.active && onFloe(f, x, y, scale)) || null;
  const islandAt = (x, y) => S.islands.find((is) => inPoly(is.shape, x, y));
  function surfaceAt(x, y) {
    if (islandAt(x, y)) return { mode: 'island', z: C.world.shoreHeight };
    const f = floeAt(x, y, 0.95);
    if (f) return { mode: 'floe', floe: f, z: floeTopAt(f, x - f.x, y - f.y) };
    return { mode: 'water', z: 0 };
  }
  const surfKey = (m) => (m === 'floe' ? 'ice' : m === 'island' ? 'shore' : 'water');

  // ── 물결 ────────────────────────────────────────────────
  function ripple(x, y, maxR, life, alpha) {
    const R = WC().ripple;
    S.ripples.push({ x, y, t: 0, maxR, life: life || R.life, alpha: alpha == null ? R.alpha : alpha });
  }
  // V자 항적 입자 (풀 재사용, 가득 차면 가장 오래된 것 교체)
  function wakeLimit() { return Math.max(8, Math.round(WC().wake.maxParticles * S.quality)); }
  function emitWake(hull, x, y, ang, speed, maxSp, halfW) {
    const Wk = WC().wake, s = clamp(speed / maxSp, 0, 1);
    const spacing = lerp(Wk.spacing[0], Wk.spacing[1], s);
    if (hull.lastEmit && Math.hypot(x - hull.lastEmit[0], y - hull.lastEmit[1]) < spacing) return;
    hull.lastEmit = [x, y];
    const lim = wakeLimit();
    let slot = null, oldest = null;
    for (let i = 0; i < lim; i++) {
      const w = S.wake[i] || (S.wake[i] = { on: false });
      if (!w.on) { slot = w; break; }
      if (!oldest || w.t > oldest.t) oldest = w;
    }
    slot = slot || oldest;
    Object.assign(slot, { on: true, x, y, ang, speed, t: 0, r0: halfW, s,
      alpha: Wk.alphaMax * (0.25 + 0.75 * s), span: deg(lerp(Wk.arcDeg[0], Wk.arcDeg[1], s)) });
  }

  // ── 입력 ────────────────────────────────────────────────
  const pointers = new Map();
  const keys = new Set();

  function pickRole(x, y) {
    const rg = layout.ring, a = layout.action;
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
    if (role === 'ring' && Math.hypot(x - layout.ring.x, y - layout.ring.y) <= C.ui.ring.radius * 1.15) { ptr.ox = layout.ring.x; ptr.oy = layout.ring.y; }
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
    if (ptr.role === 'camera') {
      S.lastCamTouch = S.time;
      cam.yawT += dx * C.camera.rotateSensX;
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
  document.getElementById('reset').addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); releaseAll(); reset(); });

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

  function readMove() {
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

  // ── 물고기 연출 ─────────────────────────────────────────
  function startFish() {
    const p = S.p, f = C.fish;
    const R = screenDirToWorld(1, 0), Fw = screenDirToWorld(0, -1);
    const at = (r, d) => {                                   // 빙하 위가 아니라 물이 되도록 더 앞쪽으로 밀어냄
      let q = [p.x + R[0] * r + Fw[0] * d, p.y + R[1] * r + Fw[1] * d];
      for (let i = 0; i < 12 && floeAt(q[0], q[1]); i++) q = [q[0] + Fw[0] * 0.6, q[1] + Fw[1] * 0.6];
      return q;
    };
    const p0 = at(f.startRight, f.ahead);
    const p1 = at(-f.landLeft, f.ahead + 0.5);
    const p2 = at(-(f.landLeft + f.jump2.distance), f.ahead + f.jump2.ahead);
    S.fish = { state: 'hop', t: 0, hops: [
      { a: p0, b: p1, h: f.jump1.height, dur: f.jump1.duration },
      { a: p1, b: p2, h: f.jump2.height, dur: f.jump2.duration, delay: f.pause },
    ], i: 0, x: p0[0], y: p0[1], z: 0, ang: 0, visible: false };
    ripple(p0[0], p0[1], 1.1, 1.3, WC().ripple.alpha * 0.8);
    log('fishJump');
  }
  function updateFish(dt) {
    const F = S.fish;
    if (F.state === 'wait') { F.t += dt; if (F.t >= C.fish.delay) startFish(); return; }
    if (F.state !== 'hop') return;
    const hop = F.hops[F.i];
    F.t += dt;
    const t = F.t - (hop.delay || 0);
    if (t < 0) { F.visible = false; return; }
    if (hop.delay && !hop.started) { hop.started = true; ripple(hop.a[0], hop.a[1], 0.9, 1.1, WC().ripple.alpha * 0.7); }
    const s = clamp(t / hop.dur, 0, 1);
    const nx = lerp(hop.a[0], hop.b[0], s), ny = lerp(hop.a[1], hop.b[1], s), nz = 4 * hop.h * s * (1 - s);
    const [sx0, sy0] = project(F.x, F.y, F.z), [sx1, sy1] = project(nx, ny, nz);
    if (Math.hypot(sx1 - sx0, sy1 - sy0) > 0.01) F.ang = Math.atan2(sy1 - sy0, sx1 - sx0);
    F.x = nx; F.y = ny; F.z = nz; F.visible = true;
    if (s >= 1) {
      ripple(hop.b[0], hop.b[1], 1.3, 1.5, WC().ripple.alpha);
      log('fishLand');
      F.i++; F.t = 0;
      if (F.i >= F.hops.length) { F.state = 'done'; F.visible = false; }
    }
  }

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
      spring(f.heave, bobTarget(f.ph, light), dt);
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
    const surf = surfKey(p.mode);

    if (S.jumpAt && performance.now() >= S.jumpAt) { S.jumpAt = 0; S.jumpReq = 'jump'; }
    if (S.jumpReq) {                                        // 점프: 중력 + 초기 속도의 포물선
      const kind = S.jumpReq; S.jumpReq = false;
      const SJ = P.superJump, h0 = P.jumpVelocity * P.jumpVelocity / (2 * P.gravity);
      if (kind === 'super') {
        // 슈퍼점프: 높이 ×heightMul, 거리 ×distanceMul, 체공 ≈ airtime. 공중이면 지금 높이에서 이어 붙임
        const Hs = h0 * SJ.heightMul, gS = 8 * Hs / (SJ.airtime * SJ.airtime);
        const base = p.air ? (p.jumpBase || 0) : p.z, dz = Math.max(0, p.z - base);
        if (!p.air) startAir(p, mag, wx, wy);
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
        startAir(p, mag, wx, wy);
        p.g = P.gravity; p.vz = P.jumpVelocity;
        if (mag > 0.1) { const s = Math.max(Math.hypot(p.vx, p.vy), P.jumpForwardSpeed * mag); p.vx = wx / mag * s; p.vy = wy / mag * s; }
        p.jumpHS = Math.hypot(p.vx, p.vy); p.airCap = p.jumpHS;
        log('jump');
      }
    }
    const held = slideHeld();
    if (held && !p.sliding && !p.air) {
      p.sliding = true; p.sit = false;
      const dir = mag > 0.01 ? Math.atan2(wy, wx) : p.face, s = Math.max(Math.hypot(p.vx, p.vy), P.slideInitialSpeed);
      p.vx = Math.cos(dir) * s; p.vy = Math.sin(dir) * s;
      log('slideStart');
    }
    if (!held && p.sliding) { p.sliding = false; log('slideEnd'); }

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
      s *= Math.exp(-P.slideFriction[surf] * dt);
      s = Math.min(s, P.slideMaxSpeed);
      p.vx = Math.cos(dir) * s; p.vy = Math.sin(dir) * s;
      p.face = dir;
    } else {
      // 이동: 입력은 힘. 가속도 = 힘/질량, 지면 마찰로 감쇠, 최고 속도 부드럽게 제한
      p.vx += wx * pm.moveForce[surf] / pm.mass * dt; p.vy += wy * pm.moveForce[surf] / pm.mass * dt;
      const k = Math.exp(-P.friction[surf] * dt); p.vx *= k; p.vy *= k;
      // 최고 속도: 입력으로는 넘지 않음. 슬라이딩 등으로 이미 빠르면 부드럽게 줄어듦
      const s = Math.hypot(p.vx, p.vy), mxs = pm.maxSpeed[surf];
      if (s > mxs) { const ns = sp0 > mxs ? Math.max(mxs, Math.min(s, sp0) * Math.exp(-3 * dt)) : mxs; p.vx *= ns / s; p.vy *= ns / s; }
      if (mag > 0.01) { p.sit = false; p.face += angDiff(p.face, Math.atan2(wy, wx)) * ease(P.turnRate, dt); }
      else if (p.sit && S.fish.visible) {
        p.face += angDiff(p.face, Math.atan2(S.fish.y - p.y, S.fish.x - p.x)) * ease(4, dt);
      }
      if (Math.abs(p.vx) + Math.abs(p.vy) < 1e-4) { p.vx = 0; p.vy = 0; }
    }

    const f = p.floe;
    if (p.mode === 'floe' && !p.air && f) {
      p.lx += p.vx * dt; p.ly += p.vy * dt;
      p.x = f.x + p.lx; p.y = f.y + p.ly;
    } else {
      p.x += (p.vx + (p.air ? p.cvx : 0)) * dt; p.y += (p.vy + (p.air ? p.cvy : 0)) * dt;
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
      if (p.vz < 0 && p.z <= s.z) { const vz = p.vz; p.air = false; p.z = s.z; p.vz = 0; setMode(s.mode, s.floe, vz); }
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
    if (!p.air) {
      const tz = p.mode === 'island' ? C.world.shoreHeight : p.mode === 'floe' && p.floe ? floeTopAt(p.floe, p.lx, p.ly) : 0;
      p.z += (tz - p.z) * ease(14, dt);
    }

    // 펭귄 자체 출렁임: 물에선 수면 사인파, 빙하 위에선 0 으로 돌아가는 스프링 (멈춤·입수 충격만)
    const sp = Math.hypot(p.vx, p.vy);
    const inWater = p.mode === 'water' && !p.air;
    spring(p.heave, inWater ? bobTarget([1.3, 4.2], 0.8) : 0, dt);
    if (!p.air) trackInertia(p, sp, pm.maxSpeed[surf], dt);
    // 관성 기울기 (화면에서 보이는 진행 방향 기준)
    const c = Math.cos(cam.yaw), s2 = Math.sin(cam.yaw), vxs = c * p.vx - s2 * p.vy;
    const dirSign = Math.abs(vxs) > 0.05 ? Math.sign(vxs) : (p.leanSign || 1); p.leanSign = dirSign;
    spring(p.lean, p.air ? 0 : (p.inertia || 0) * dirSign, dt);

    // 그림용 값
    p.sink += ((inWater ? (p.sliding ? 0.06 : C.penguin.swimSink) : 0) - p.sink) * ease(8, dt);
    S.tapPulse = Math.max(0, S.tapPulse - dt * 5);
    if (!p.air && p.mode !== 'water' && !p.sliding && sp > 0.15) {
      p.phase += sp * dt * C.penguin.walkWobbleFreq;
      p.wobble = Math.sin(p.phase) * deg(C.penguin.walkWobbleDeg) * Math.min(1, sp / pm.maxSpeed.ice);
    } else p.wobble *= Math.exp(-10 * dt);
    if (inWater) {
      if (sp > 0.3) emitWake(p, p.x - Math.cos(p.face) * 0.2, p.y - Math.sin(p.face) * 0.2, Math.atan2(p.vy, p.vx), sp, pm.maxSpeed.water, 0.22 * C.penguin.scale);
      else {
        p.lastEmit = null; p.idleRing -= dt;
        if (p.idleRing <= 0) { ripple(p.x, p.y, 0.9 * C.penguin.scale, 1.8, WC().ripple.alpha * 0.4); p.idleRing = 2.2; }
      }
    } else p.lastEmit = null;

    // 반영 일렁임 세기
    let rip = inWater && sp > 0.3 ? 0.35 : 0.08;
    for (const r of S.ripples) {
      const k = r.t / r.life, rad = r.maxR * (0.15 + 0.85 * (1 - Math.pow(1 - k, 2.2)));
      rip += (1 - k) * Math.max(0, 1 - Math.abs(Math.hypot(p.x - r.x, p.y - r.y) - rad) / 1.2);
    }
    p.ripple += (clamp(rip, 0, 1) - p.ripple) * ease(6, dt);
  }

  function startAir(p) {
    if (p.sliding) { p.sliding = false; log('slideEnd'); }
    p.air = true; p.sit = false; p.jumpBase = p.z; p.jumpHS = 0; p.airT = 0;
    const f = p.mode === 'floe' ? p.floe : null;
    p.cvx = f ? f.vx : 0; p.cvy = f ? f.vy : 0;
    if (p.mode === 'water') ripple(p.x, p.y, 1.4, 1.2);
  }

  function setMode(mode, floe, vz = 0) {
    const p = S.p, prev = p.mode, W2 = WC();
    p.mode = mode;
    if (mode === 'floe') {
      const changed = p.floe !== floe;
      p.floe = floe; p.lx = p.x - floe.x; p.ly = p.y - floe.y;
      if (vz < -1 || prev === 'water' || changed) {         // 착지·올라탐: 빙하가 살짝 가라앉았다 복원
        const startMass = Math.PI * baseRX() * baseRY() * P.floeDensity;
        const px = Math.min(W2.settle.maxPx, P.landingSinkPx * (vz < -1 ? 1 : 0.5) * Math.sqrt(startMass / floe.mass));
        floe.heave.v -= impulseFor(px);
      }
    } else p.floe = null;
    if (mode === 'water' && prev !== 'water' || (mode === 'water' && vz < -1)) {
      // 입수: 원형 물결 1회 + 낙하 속도에 비례해 가라앉았다 부력으로 떠오름 (물보라 없음)
      ripple(p.x, p.y, W2.splash.ringRadius, W2.splash.ringLife, W2.ripple.alpha * 1.4);
      const px = Math.min(W2.splash.sinkMaxPx, W2.splash.sinkPx * Math.max(1, Math.abs(vz) / 3));
      p.heave.v = -impulseFor(px);
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
    cam.z += ((p.mode === 'island' ? C.world.shoreHeight : 0) - cam.z) * ease(3, dt);
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
  function turnTarget() { const r = C.firefly.route[S.ff.i]; return [r[0], r[1]]; }
  function stepFirefly(dt) {
    const F = C.firefly, ff = S.ff, p = S.p, route = F.route;
    if (ff.i < route.length - 1 && Math.hypot(route[ff.i][0] - p.x, route[ff.i][1] - p.y) < F.reachDist) { ff.i++; log('firefly' + ff.i); }
    const t = route[ff.i], dx = t[0] - ff.x, dy = t[1] - ff.y, dz = t[2] - ff.z, d = Math.hypot(dx, dy, dz);
    if (d > 0.01) { const m = Math.min(d, F.speed * dt * clamp(d / 1.5, 0.25, 1)); ff.x += dx / d * m; ff.y += dy / d * m; ff.z += dz / d * m; }
  }

  function step(dt) {
    S.time += dt; S.stepN++;
    const now = performance.now();
    for (const ptr of pointers.values()) if (ptr.role === 'action' && !ptr.long && now - ptr.t0 >= C.input.longPressMs) { ptr.long = true; S.lastTapUp = 0; }
    updateFish(dt);
    stepFloes(dt);
    stepPenguin(dt);
    stepCamera(dt);
    stepFirefly(dt);
    if (S.stepN % 12 === 0) manageField();
    S.ripples = S.ripples.filter((r) => (r.t += dt) < r.life);
    const life = WC().wake.life;
    for (const w of S.wake) if (w.on && (w.t += dt) >= life) w.on = false;
  }

  // ── 그리기 ──────────────────────────────────────────────
  // 출렁임(px)은 화면 세로 오프셋. 위로 뜨면 음수
  function floeOffset(f) { return -f.heave.h; }
  function penOffset() {
    const p = S.p;
    let h = p.heave.h;
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
    ctx.drawImage(img, e.x - e.rx, e.y - e.ry, e.rx * 2, e.ry * 2);
  }
  // 앞으로 나아가는 정도 (카메라에서 멀어지는 방향이면 1)
  const forwardness = (dx, dy) => { const l = Math.hypot(dx, dy) || 1; return clamp((dx * rig.F[0] + dy * rig.F[1]) / l, 0, 1); };

  // 하늘·수평선: 위는 조금 더 밝은 미색, 수평선 근처는 안개 띠
  function drawSky() {
    const hz = rig.horizon;
    ctx.fillStyle = COL.bg; ctx.fillRect(0, 0, W, H);
    // 하늘과 먼 수면이 같은 미색 안개로 이어져 수평선이 거의 구분되지 않게
    const g = ctx.createLinearGradient(0, hz - H * 0.5, 0, hz + H * 0.25);
    g.addColorStop(0, 'rgba(249,246,239,1)'); g.addColorStop(0.65, 'rgba(246,242,233,1)'); g.addColorStop(1, 'rgba(243,238,227,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, Math.max(0, hz + H * 0.25));
    const g2 = ctx.createLinearGradient(0, hz + H * 0.15, 0, H);
    g2.addColorStop(0, 'rgba(120,110,95,0)'); g2.addColorStop(1, 'rgba(120,110,95,0.05)');
    ctx.fillStyle = g2; ctx.fillRect(0, Math.max(0, hz), W, H);
  }

  // 수면 잔물결: 아주 옅은 가로선 몇 개가 월드에 떠서 천천히 흐름 (펭귄 앞쪽 주변에서 순환)
  function drawSurfaceLines() {
    const L = WC().surfaceLines, n = Math.max(2, Math.round(L.count * S.quality)), T = 30;
    if (!S.lines || S.lines.length !== L.count) {
      const r = rng(99); S.lines = Array.from({ length: L.count }, () => ({ x: r() * T, y: r() * T, len: lerp(L.length[0], L.length[1], r()), a: lerp(L.alpha[0], L.alpha[1], r()), ph: r() * 6.28 }));
    }
    const ox = cam.x + rig.F[0] * T * 0.35, oy = cam.y + rig.F[1] * T * 0.35;
    ctx.lineCap = 'round';
    for (let i = 0; i < n; i++) {
      const l = S.lines[i];
      const wx = ((l.x + S.time * L.speed - ox) % T + T * 1.5) % T - T / 2 + ox;
      const wy = ((l.y - oy) % T + T * 1.5) % T - T / 2 + oy;
      if (floeAt(wx, wy) || islandAt(wx, wy)) continue;
      const h = l.len / 2, a0 = camSpace(wx - rig.R[0] * h, wy - rig.R[1] * h, 0), a1 = camSpace(wx + rig.R[0] * h, wy + rig.R[1] * h, 0);
      if (a0[1] < rig.near + 0.5 || a1[1] < rig.near + 0.5) continue;
      const [x0, y0, d] = toScreen(a0), [x1, y1] = toScreen(a1);
      const edge = Math.min(1, Math.min((x0 + x1) / 2, W - (x0 + x1) / 2) / 80);
      const a = l.a * (0.55 + 0.45 * Math.sin(S.time * 0.4 + l.ph)) * Math.max(0, edge) * (1 - fogAt(d));
      if (a <= 0.004) continue;
      ctx.lineWidth = clamp(pxPerUnit(d) * 0.02, 0.6, 1.4);
      ctx.strokeStyle = `rgba(${COL.water},${a.toFixed(3)})`;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo((x0 + x1) / 2, (y0 + y1) / 2 + 1.5, x1, y1); ctx.stroke();
    }
  }

  function drawWater() {
    const rs = getRingSprite();
    for (const r of S.ripples) {
      const k = r.t / r.life, rad = r.maxR * (0.15 + 0.85 * (1 - Math.pow(1 - k, 2.2)));
      groundSprite(rs, r.x, r.y, rad, r.alpha * Math.pow(1 - k, 1.3) * Math.min(1, k * 8));
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
          const th = c0 - w.span / 2 + w.span * i / 6;
          const cs = camSpace(w.x + Math.cos(th) * rad, w.y + Math.sin(th) * rad, 0);
          if (cs[1] < rig.near) continue;
          pts.push(toScreen(cs)); dsum += cs[1];
        }
        if (pts.length < 2) continue;
        const d = dsum / pts.length, aa = a * (1 - fogAt(d));
        if (aa < 0.004) continue;
        // 가까울수록·앞으로 나아갈수록 굵게 (낮은 시점에서 전진이 잘 보이도록)
        ctx.lineWidth = Wk.lineWidth * clamp(pxPerUnit(d) / 45, 0.6, 2.4) * (1 + 0.5 * fw);
        ctx.strokeStyle = `rgba(${COL.water},${aa.toFixed(3)})`;
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
        ctx.strokeStyle = `rgba(${COL.water},${(F.alpha * (1 + fw) * s * (1 - t0) * (1 - fogAt(c0[1]))).toFixed(3)})`;
        ctx.beginPath(); ctx.moveTo(x0, y0 + dy * 0.3); ctx.lineTo(x1, y1 + dy * 0.3); ctx.stroke();
      }
    }
  }

  const FLOE_TOP_RGB = [255, 255, 255], FLOE_SIDE_RGB = [217, 213, 204];
  function floeAlpha(f) { return f === S.p.floe ? 1 : clamp((S.time - f.born) / IF.fadeInTime, 0, 1); }
  function drawFloe(f, d) {
    const a = floeAlpha(f);
    if (a <= 0.01) return;
    const dy = floeOffset(f), fog = fogAt(d);
    const off3 = (zf) => projPoly(f.shape.map(([x, y]) => [x + f.x, y + f.y, zf(x, y)])).map(([sx, sy]) => [sx, sy + dy]);
    ctx.globalAlpha = a;
    ctx.fillStyle = mixFog(FLOE_SIDE_RGB, fog); fillPoly(off3((x, y) => -0.18 + f.tilt.x * x + f.tilt.y * y));
    ctx.fillStyle = mixFog(FLOE_TOP_RGB, fog); fillPoly(off3((x, y) => floeTopAt(f, x, y)));
    ctx.globalAlpha = 1;
  }

  function drawIslandGround() {
    const h = C.world.shoreHeight;
    for (const is of S.islands) {
      const d = camSpace(is.shoreX, clamp(cam.y, -is.ry, is.ry), 0)[1];
      if (d < -is.rx * 2) continue;
      const fog = fogAt(Math.max(d, 0), C.camera.mountainFog);
      ctx.fillStyle = mixFog([112, 110, 106], fog); fillPoly(projPoly(is.shape.map(([x, y]) => [x, y, -0.05])));
      ctx.fillStyle = mixFog([156, 152, 144], fog); fillPoly(projPoly(is.shape.map(([x, y]) => [x, y, h])));
    }
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
        const fog = fogAt(cb[1], C.camera.mountainFog);
        const shape = hull(sb.concat([sa, toScreen(camSpace(pk.x + pk.ax * 0.5 - pk.r * 0.35 * pk.so, pk.y, pk.h * pk.sh))]));
        ctx.fillStyle = mixFog(COL.mountNear, fog); fillPoly(shape);
        // 한쪽 면을 살짝 밝게 (양감)
        const right = sb.reduce((m, q) => (q[0] > m[0] ? q : m)), low = sb.reduce((m, q) => (q[1] > m[1] ? q : m));
        ctx.fillStyle = mixFog(COL.mountNear.map((v) => v + (255 - v) * 0.1), fog);
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
  // part: 'above' = 수면 위만, 'below' = 수면 아래만, wl = 수면선(지역 좌표)
  function drawPenguinFigure(g, u, v, part = 'above', wl = 0) {
    const p = S.p;
    if (p.sink > 0.01) {
      g.beginPath();
      if (part === 'below') g.rect(-u * 2, wl, u * 4, u * 3); else g.rect(-u * 2, wl - u * 3, u * 4, u * 3);
      g.clip();
      g.translate(0, p.sink * u);
    } else if (part === 'below') return;
    const { fvx, fvy } = v;
    const lm = deg(WC().inertiaTilt.accelDeg); g.rotate(clamp(p.lean.h, -lm, lm));
    if (p.sliding) {
      const ax = Math.abs(fvx), len = 0.45 + 0.55 * ax;
      g.scale(fvx < 0 ? -1 : 1, 1);
      g.rotate(clamp(Math.atan2(fvy * Math.sin(cam.pitch) * 0.5, ax), -0.35, 0.35));
      g.fillStyle = COL.black; g.beginPath(); g.ellipse(0, -u * 0.15, u * 0.55 * len, u * 0.2, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = COL.white; g.beginPath(); g.ellipse(-u * 0.02 * len, -u * 0.07, u * 0.42 * len, u * 0.1, 0, 0, Math.PI * 2); g.fill();
      if (fvy > -0.5) { g.beginPath(); g.arc(u * 0.38 * len, -u * 0.21, u * 0.035, 0, Math.PI * 2); g.fill(); }
      return;
    }
    g.rotate(p.wobble);
    g.scale(1 + v.squash * 0.6, 1 - v.squash);
    g.fillStyle = COL.black;
    g.beginPath(); g.ellipse(0, -u * 0.5, u * 0.3, u * 0.5, 0, 0, Math.PI * 2); g.fill();
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

  const penScale = (d) => penH() * pxPerUnit(d) * rig.cp;   // 펭귄 키 (px)
  function drawPenguin() {
    const p = S.p, v = penguinView(), dy = penOffset();
    const [sx, sy0, d] = project(p.x, p.y, p.z), sy = sy0 + dy, u = penScale(d);
    if (p.mode !== 'water' || p.air) {
      const e = groundEllipse(p.x, p.y, penH() * 0.32, p.air ? surfaceAt(p.x, p.y).z : p.z);
      if (e) {
        ctx.fillStyle = 'rgba(0,0,0,0.12)';
        ctx.beginPath(); ctx.ellipse(e.x, e.y + (p.floe && !p.air ? floeOffset(p.floe) : 0), e.rx, e.ry, 0, 0, Math.PI * 2); ctx.fill();
      }
    }
    const wl = project(p.x, p.y, 0)[1] - sy;                // 수면선 (펭귄 지역 좌표)
    // 수영: 몸 둘레 물결 고리를 뒤쪽 절반 → 몸 → 앞쪽 절반 순서로 (몸 위로 고리가 비쳐 보이지 않게)
    const e = p.sink > 0.2 ? groundEllipse(p.x, p.y, penH() * 0.45) : null;
    const ringHalf = (front) => {
      if (!e) return;
      ctx.save(); ctx.beginPath();
      if (front) ctx.rect(e.x - e.rx, e.y, e.rx * 2, e.ry + 1); else ctx.rect(e.x - e.rx, e.y - e.ry - 1, e.rx * 2, e.ry + 1);
      ctx.clip(); ctx.globalAlpha = C.penguin.swimRingAlpha;
      ctx.drawImage(getRingSprite(), e.x - e.rx, e.y - e.ry, e.rx * 2, e.ry * 2);
      ctx.restore();
    };
    ringHalf(false);
    if (p.sink > 0.01) {                                      // 잠긴 몸: 수면선 아래를 옅게
      ctx.save(); ctx.globalAlpha = C.penguin.underwaterAlpha; ctx.translate(sx, sy); drawPenguinFigure(ctx, u, v, 'below', wl); ctx.restore();
    }
    ctx.save(); ctx.translate(sx, sy); drawPenguinFigure(ctx, u, v, 'above', wl); ctx.restore();
    ringHalf(true);
  }

  const off = document.createElement('canvas'), og = off.getContext('2d');
  function drawReflection() {
    if (!(C.reflect.alpha > 0)) return;
    const p = S.p, v = penguinView(), dy = penOffset();
    const [sx, sy0, d] = project(p.x, p.y, p.z), [, wy] = project(p.x, p.y, 0), sy = sy0 + dy, u = penScale(d);
    const size = Math.ceil(u * 3), oy = Math.ceil(u * 2.2), ox = size / 2;
    if (off.width !== Math.ceil(size * DPR)) { off.width = off.height = Math.ceil(size * DPR); }
    og.setTransform(DPR, 0, 0, DPR, 0, 0); og.globalCompositeOperation = 'source-over';
    og.clearRect(0, 0, size, size);
    og.save(); og.translate(ox, oy + (sy - wy)); drawPenguinFigure(og, u, v, 'above', wy - sy); og.restore();
    og.globalCompositeOperation = 'destination-in';
    const gr = og.createLinearGradient(0, oy, 0, oy - u * C.reflect.fadeLength);
    gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    og.fillStyle = gr; og.fillRect(0, 0, size, size);
    og.globalCompositeOperation = 'source-over';
    og.clearRect(0, oy, size, size - oy);
    ctx.save();
    ctx.globalAlpha = C.reflect.alpha;
    ctx.translate(sx, wy); ctx.scale(1, -1);
    const N = C.reflect.slices, sh = oy / N;
    for (let i = 0; i < N; i++) {
      const srcY = i * sh, far = 1 - srcY / oy;
      const ddx = Math.sin(S.time * 5 + i * 0.9) * C.reflect.wobblePx * (0.3 + p.ripple * 1.7) * (0.4 + far);
      ctx.drawImage(off, 0, srcY * DPR, size * DPR, sh * DPR, -ox + ddx, srcY - oy, size, sh + 0.6);
    }
    ctx.restore();
  }

  function drawFish(d) {
    const F = S.fish;
    const s = C.fish.size * pxPerUnit(d);
    const [sx, sy] = project(F.x, F.y, F.z);
    ctx.save(); ctx.translate(sx, sy); ctx.rotate(F.ang);
    ctx.globalAlpha = 1 - fogAt(d);
    ctx.fillStyle = COL.fish;
    ctx.beginPath(); ctx.ellipse(0, 0, s * 0.5, s * 0.17, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-s * 0.4, 0); ctx.lineTo(-s * 0.72, -s * 0.2); ctx.lineTo(-s * 0.72, s * 0.2); ctx.closePath(); ctx.fill();
    ctx.restore(); ctx.globalAlpha = 1;
  }

  // 반딧불이: 따뜻한 빛 알맹이 + 번짐, 수면에 옅은 반영. 곁에 작은 반딧불이가 맴돎
  const glowSprite = makeSprite([[0, 'rgba(255,240,190,1)'], [0.18, 'rgba(250,200,95,0.75)'], [0.5, 'rgba(240,175,70,0.22)'], [1, 'rgba(240,170,60,0)']]);
  function fireflyPoints() {
    const F = C.firefly, ff = S.ff, t = S.time;
    const x = ff.x + Math.sin(t * 1.3) * F.hover, y = ff.y + Math.cos(t * 1.7) * F.hover, z = ff.z + Math.sin(t * 2.1) * F.hover * 0.6;
    const pts = [{ x, y, z, k: 1, fl: 0.8 + 0.2 * Math.sin(t * 7.3) * Math.sin(t * 2.9) }];
    for (const c of ff.comp) pts.push({ x: x + Math.cos(t * 1.1 + c.ph) * c.rad, y: y + Math.sin(t * 0.9 + c.ph) * c.rad, z: z + Math.sin(t * 1.7 + c.ph) * 0.2, k: 0.55, fl: 0.6 + 0.4 * Math.sin(t * 5.1 + c.ph * 3) });
    return pts;
  }
  function drawGlow(x, y, z, k, a) {
    const c = camSpace(x, y, z);
    if (c[1] < rig.near + 0.3) return;
    const [sx, sy] = toScreen(c), ppu = pxPerUnit(c[1]);
    const g = clamp(C.firefly.glow * ppu, 10, 46) * k, core = clamp(C.firefly.size * ppu, 1.6, 6) * k;
    const aa = a * (1 - fogAt(c[1]) * 0.5);
    ctx.globalAlpha = aa; ctx.drawImage(glowSprite, sx - g, sy - g, g * 2, g * 2);
    ctx.globalAlpha = Math.min(1, aa * 1.2); ctx.fillStyle = '#fff8e0';
    ctx.beginPath(); ctx.arc(sx, sy, core, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }
  function drawFireflyReflection() {
    for (const q of fireflyPoints()) {
      const c = camSpace(q.x, q.y, -q.z);
      if (c[1] < rig.near + 0.3) continue;
      const [sx, sy] = toScreen(c), g = Math.max(8, C.firefly.glow * pxPerUnit(c[1])) * q.k * 0.7;
      ctx.globalAlpha = 0.22 * q.fl * (1 - fogAt(c[1]));
      ctx.drawImage(glowSprite, sx - g, sy - g * 0.6, g * 2, g * 1.2);
    }
    ctx.globalAlpha = 1;
  }
  function fireflyItems(items) {
    for (const q of fireflyPoints()) {
      const d = camSpace(q.x, q.y, q.z)[1];
      items.push({ d, draw: () => drawGlow(q.x, q.y, q.z, q.k, q.fl) });
    }
  }

  // ── UI ─────────────────────────────────────────────────
  const sampler = document.createElement('canvas'); sampler.width = sampler.height = 6;
  const sg = sampler.getContext('2d', { willReadFrequently: true });
  const lum = { ring: 0.93, action: 0.93, target: { ring: 0.93, action: 0.93 }, lastSample: 0 };
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
    const A = C.ui.action, a = layout.action;
    let pressed = false;
    for (const ptr of pointers.values()) if (ptr.role === 'action') pressed = true;
    const sc = A.radius * (pressed ? 0.9 : 1) * (1 + S.tapPulse * 0.06);
    drawPaw(a.x, a.y + sc * 0.04, sc, lum.action, (pressed ? 1.4 : 1) * A.alphaScale);
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
    const toes = [[-0.6, -0.4], [0, -0.68], [0.6, -0.4]], tr = 0.19;
    // 물갈퀴: 발가락 사이가 안쪽으로 오목하게 이어진 막 (조금 옅게)
    g2.globalAlpha = 0.55;
    g2.beginPath();
    g2.moveTo(-0.6, -0.4);
    g2.quadraticCurveTo(-0.24, -0.26, 0, -0.68);
    g2.quadraticCurveTo(0.24, -0.26, 0.6, -0.4);
    g2.quadraticCurveTo(0.36, -0.08, 0.34, 0.14);
    g2.lineTo(-0.34, 0.14);
    g2.quadraticCurveTo(-0.36, -0.08, -0.6, -0.4);
    g2.closePath(); g2.fill();
    // 큰 둥근 패드 + 둥근 발가락 3개
    g2.globalAlpha = 1;
    g2.beginPath(); g2.ellipse(0, 0.34, 0.46, 0.38, 0, 0, Math.PI * 2); g2.fill();
    for (const [x, y] of toes) { g2.beginPath(); g2.arc(x, y, tr, 0, Math.PI * 2); g2.fill(); }
    ctx.globalAlpha = alpha;
    ctx.drawImage(pawCv, cx - sc * 1.1, cy - sc * 1.1, sc * 2.2, sc * 2.2);
    ctx.globalAlpha = 1;
  }

  function draw(dt) {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.globalAlpha = 1;
    updateRig();
    drawSky();
    // 수면에 붙은 것: 잔물결 → 파문·항적 → 흐름선 → 반영
    drawSurfaceLines();
    drawWater();
    const fl = activeFloes();
    for (const f of fl) drawFlowLines(f.x, f.y, f.dir, Math.hypot(f.vx, f.vy), 4, f.cr, f.R * 0.7, floeOffset(f));
    const p = S.p;
    if (p.mode === 'water' && !p.air) {
      const sp = Math.hypot(p.vx, p.vy);
      if (sp > 0.05) drawFlowLines(p.x, p.y, [p.vx / sp, p.vy / sp], sp, P.penguin.maxSpeed.water, 0.25 * C.penguin.scale, 0.15, 0);
    }
    drawFireflyReflection();
    drawReflection();
    drawIslandGround();
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
    items.push({ d: pd, draw: drawPenguin });
    if (S.fish.visible) { const d = camSpace(S.fish.x, S.fish.y, S.fish.z)[1]; if (d > rig.near) items.push({ d, draw: () => drawFish(d) }); }
    fireflyItems(items);
    items.sort((a, b) => b.d - a.d);
    for (const it of items) it.draw();
    ctx.globalAlpha = 1;
    drawUI(dt);
  }

  // ── 루프: 60Hz 고정 단계 + 프레임 저하 시 입자 수 줄이기 ──────
  let last = performance.now(), acc = 0, frameAvg = 1 / 60;
  S.quality = 1;
  function frame(now) {
    const real = Math.max(0, (now - last) / 1000);
    last = now;
    frameAvg += (Math.min(real, 0.1) - frameAvg) * 0.05;
    if (frameAvg > 1 / 45) S.quality = Math.max(0.5, S.quality - 0.01);
    else if (frameAvg < 1 / 56) S.quality = Math.min(1, S.quality + 0.002);
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

  window.__game = { S, C, cam, layout, pointers, project, reset, screenDirToWorld, lum, activeFloes, jumpMaxDist };
})();
