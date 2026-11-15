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
  const finishEl = document.getElementById('finish');
  let W = 0, H = 0, DPR = 1, zoom = 30;
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
    zoom = H / C.camera.viewHeight;
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
  const penU = () => zoom * C.penguin.height * C.penguin.scale;
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
    const ridge = [];
    for (let y = -220; y <= 220; y += 26 + r() * 18) ridge.push({ y, d: r() * 60, h: 9 + r() * 6 + 7 * Math.exp(-Math.pow(y / 90, 2)), r: 3 + r() * 2, ax: (r() - 0.5) * 2 });
    return { side, shoreX, cx, cy: 0, rx: w.islandHalfWidth, ry: w.islandHalfLength, shape, peaks, ridge };
  }

  // ── 빙하 배치 (시드 고정 후보 목록) ─────────────────────────
  const baseRX = () => C.floe.radiusX * C.floe.scale, baseRY = () => C.floe.radiusY * C.floe.scale;
  function genField() {
    const r = rng(IF.seed), D = C.world.islandDistance, J = jumpMaxDist();
    const list = [{ x: 0, y: 0, size: 1, seed: 7, start: true }];
    const radOf = (c) => ({ rx: baseRX() * c.size, ry: baseRY() * c.size });
    const overlaps = (x, y, rr) => list.some((c) => { const q = radOf(c); return Math.hypot(c.x - x, c.y - y) < (q.rx + q.ry) / 2 + rr + 0.6; });
    const sizeAt = (p) => lerp(lerp(IF.sizeStart[0], IF.sizeEnd[0], p), lerp(IF.sizeStart[1], IF.sizeEnd[1], p), r());
    for (const side of [-1, 1]) {
      const dens = side < 0 ? IF.density.left : IF.density.right;
      const end = D - IF.openSea;
      let edge = baseRX();                        // 직전 빙하의 바깥 가장자리 |x|
      for (let n = 0; n < 60; n++) {
        const p = clamp(edge / D, 0, 1);
        const early = p < IF.earlyUntil;
        const g = early ? IF.gapEarly : [lerp(IF.gapEarly[1], IF.gapLate[0], smooth(IF.earlyUntil, IF.earlyUntil + 0.2, p)), IF.gapLate[1]];
        let gap = J * lerp(g[0], g[1], r()) / dens;
        if (early) gap = Math.min(gap, J * 0.7);
        const size = sizeAt(p), rx = baseRX() * size;
        const cx = edge + gap + rx;
        if (cx + rx > end) break;
        const cy = (r() - 0.5) * 2 * IF.pathWobble;
        list.push({ x: side * cx, y: cy, size, seed: (r() * 1e9) | 0 });
        // 곁 빙하: 출발 근처에 많고 갈수록 줄어듦
        const nSide = Math.round(IF.sideFloes * dens * (1 - p) * (0.5 + r()));
        for (let k = 0; k < nSide; k++) {
          const s2 = size * (0.45 + 0.5 * r()), rr = baseRX() * s2;
          const sy = (r() < 0.5 ? -1 : 1) * lerp(IF.sideScatter[0], IF.sideScatter[1], r()) + cy;
          const sx = side * (cx + (r() - 0.5) * rx * 3);
          // 물고기 연출 구역(시작 빙하 앞쪽)은 비워 둠
          if (Math.abs(sx) < 12 && sy > 0) continue;
          if (!overlaps(sx, sy, rr)) list.push({ x: sx, y: sy, size: s2, seed: (r() * 1e9) | 0 });
        }
        edge = cx + rx;
      }
      // 마지막 작은 조각 1~2개 (경로 옆, 열린 바다 직전)
      for (let k = 0; k < 2; k++) {
        const s2 = IF.sizeEnd[0] * (0.7 + 0.3 * r()), rr = baseRX() * s2;
        const sx = side * (end - 1 - r() * 3), sy = (r() < 0.5 ? -1 : 1) * (2 + r() * 3);
        if (!overlaps(sx, sy, rr)) list.push({ x: sx, y: sy, size: s2, seed: (r() * 1e9) | 0 });
      }
    }
    list.forEach((c, i) => { c.id = i; c.vx = 0; c.vy = 0; c.floe = null; });
    return list;
  }

  // 빙하 풀 (최대 IF.maxActive 개 재사용)
  function newFloeObj() { return { active: false, heave: { h: 0, v: 0 }, tilt: { x: 0, y: 0, vx: 0, vy: 0 }, hist: new Float32Array(64) }; }
  function activateFloe(c) {
    let f = S.floePool.find((o) => !o.active);
    if (!f) return null;
    const rx = baseRX() * c.size, ry = baseRY() * c.size, r = rng(c.seed);
    Object.assign(f, {
      active: true, cand: c, x: c.x, y: c.y, vx: c.vx, vy: c.vy,
      shape: c.shape || (c.shape = blob(rx, ry, c.start ? 14 : 9 + ((r() * 5) | 0), c.start ? 0.1 : 0.12 + r() * 0.1, c.seed)),
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
    const near = S.cands.map((c) => ({ c, d: Math.hypot(c.x - cam.x, c.y - cam.y) - baseRX() * c.size }))
      .filter((o) => o.d < IF.activeRange).sort((a, b) => a.d - b.d).slice(0, IF.maxActive).map((o) => o.c);
    if (keep && !near.includes(keep.cand)) { near.pop(); near.unshift(keep.cand); }
    for (const f of activeFloes()) if (!near.includes(f.cand)) deactivateFloe(f);
    for (const c of near) if (!c.floe) activateFloe(c);
  }

  function reset() {
    S.time = 0; S.finished = false; S.stepN = 0;
    S.cands = genField();
    S.floePool = Array.from({ length: IF.maxActive }, newFloeObj);
    S.islands = [makeIsland(1, 31), makeIsland(-1, 57)];
    cam.x = 0; cam.y = 0; cam.yaw = cam.yawT = 0;
    cam.pitch = cam.pitchT = deg(C.camera.pitchDeg);
    S.p = {
      x: 0, y: 0, z: 0.12, vx: 0, vy: 0, vz: 0, cvx: 0, cvy: 0,
      face: Math.PI / 2, mode: 'floe', floe: null, lx: 0, ly: 0, air: false,
      sliding: false, sit: true, sink: 0, wobble: 0, phase: 0, idleRing: 0, ripple: 0,
      heave: { h: 0, v: 0 }, lean: { h: 0, v: 0 }, peakSpeed: 0, prevSpeed: 0, aLong: 0, lastEmit: null,
    };
    manageField();
    S.p.floe = S.cands[0].floe;
    S.ripples = [];
    S.wake = Array.from({ length: WC().wake.maxParticles }, () => ({ on: false }));
    S.lines = null;
    S.lastTapUp = 0; S.tapPulse = 0;
    S.fish = { state: 'wait', t: 0 };
    S.events = [];
    finishEl.classList.remove('show');
  }
  const log = (type) => { S.events.push({ type, t: S.time }); if (S.events.length > 60) S.events.shift(); };

  // ── 투영 ───────────────────────────────────────────────
  function project(x, y, z = 0, par = 1, zs = 1) {
    const dx = (x - cam.x) * par, dy = (y - cam.y) * par, c = Math.cos(cam.yaw), s = Math.sin(cam.yaw);
    const vx = c * dx - s * dy, vy = s * dx + c * dy;
    return [W / 2 + vx * zoom, H * C.camera.screenY + (vy * Math.sin(cam.pitch) - z * zs * Math.cos(cam.pitch)) * zoom, vy];
  }
  function screenDirToWorld(sx, sy) {
    const c = Math.cos(cam.yaw), s = Math.sin(cam.yaw);
    return [c * sx + s * sy, -s * sx + c * sy];
  }
  function screenDeltaToWorld(dsx, dsy) { return screenDirToWorld(dsx / zoom, dsy / (zoom * Math.sin(cam.pitch))); }

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
      const u = penU();
      const [sx, sy] = project(p.x, p.y, p.z);
      if (Math.hypot(x - sx, y - (sy + penOffset() - u * 0.45)) <= Math.max(C.input.penguinHitPx * C.penguin.scale, u * 0.9)) return 'drag';
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
    if (role === 'action') S.tapPulse = 1;
  }
  function release(id, cancelled) {
    const ptr = pointers.get(id);
    if (!ptr) return;
    pointers.delete(id);
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
      cam.yawT += dx * C.camera.rotateSensX;
      cam.pitchT = clamp(cam.pitchT - dy * C.camera.rotateSensY, deg(C.camera.pitchMinDeg), deg(C.camera.pitchMaxDeg));
    } else if (ptr.role === 'drag' && ptr.floe && ptr.floe.grab) {
      const [wx, wy] = screenDeltaToWorld(dx, dy);
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
  function shortTap(ptr) {
    log('tap');
    if (S.lastTapUp && ptr.t0 - S.lastTapUp <= C.input.doubleTapMs) { S.lastTapUp = 0; S.jumpReq = true; }
    else S.lastTapUp = performance.now();
  }
  const slideHeld = () => { for (const p of pointers.values()) if (p.role === 'action' && p.long) return true; return false; };

  // ── 물고기 연출 ─────────────────────────────────────────
  function startFish() {
    const p = S.p, f = C.fish, rx = baseRX(), ry = baseRY();
    const R = screenDirToWorld(1, 0), D = screenDirToWorld(0, 1);
    const at = (r, d) => {                                   // 빙하 위가 아니라 물이 되도록 앞쪽으로 밀어냄
      let q = [p.x + R[0] * r + D[0] * d, p.y + R[1] * r + D[1] * d];
      for (let i = 0; i < 12 && floeAt(q[0], q[1]); i++) q = [q[0] + D[0] * 0.5, q[1] + D[1] * 0.5];
      return q;
    };
    const p0 = at(rx + f.startSide, ry + f.front);
    const p1 = at(-(rx + f.landSide), ry + f.front * 0.6);
    const p2 = at(-(rx + f.landSide + f.jump2.distance), ry + f.front * 0.6 - f.jump2.rise);
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
    for (const f of fl) {
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

    if (S.jumpReq) {                                        // 점프: 중력 + 초기 속도의 포물선
      S.jumpReq = false;
      if (!p.air) {
        if (p.sliding) { p.sliding = false; log('slideEnd'); }
        p.air = true; p.sit = false; p.vz = P.jumpVelocity;
        if (mag > 0.1) { const s = Math.max(Math.hypot(p.vx, p.vy), P.jumpForwardSpeed * mag); p.vx = wx / mag * s; p.vy = wy / mag * s; }
        const f = p.mode === 'floe' ? p.floe : null;
        p.cvx = f ? f.vx : 0; p.cvy = f ? f.vy : 0;
        if (p.mode === 'water') ripple(p.x, p.y, 1.4, 1.2);
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
        const [sx, sy] = project(p.x, p.y), [fx, fy] = project(S.fish.x, S.fish.y);
        const [ex, ey] = screenDirToWorld(fx - sx, fy - sy);
        p.face += angDiff(p.face, Math.atan2(ey, ex)) * ease(4, dt);
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

    // 발판 전환
    if (p.air) {
      p.vz -= P.gravity * dt; p.z += p.vz * dt;
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
    if (mode === 'island' && !S.finished) { S.finished = true; log('arrive'); finishEl.classList.add('show'); }
  }

  function stepCamera(dt) {
    const p = S.p, f = p.floe, onF = p.mode === 'floe' && !p.air && f;
    const tvx = p.vx + (onF ? f.vx : 0), tvy = p.vy + (onF ? f.vy : 0);
    const kc = ease(C.camera.followRate, dt);
    cam.x += (p.x + tvx * C.camera.lead - cam.x) * kc;
    cam.y += (p.y + tvy * C.camera.lead - cam.y) * kc;
    const kr = ease(C.camera.rotateSmooth, dt);
    cam.yaw += (cam.yawT - cam.yaw) * kr;
    cam.pitch += (cam.pitchT - cam.pitch) * kr;
  }

  function step(dt) {
    S.time += dt; S.stepN++;
    const now = performance.now();
    for (const ptr of pointers.values()) if (ptr.role === 'action' && !ptr.long && now - ptr.t0 >= C.input.longPressMs) { ptr.long = true; S.lastTapUp = 0; }
    updateFish(dt);
    stepFloes(dt);
    stepPenguin(dt);
    stepCamera(dt);
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
  function polyPath(g, pts, zf, ox, oy, dy) {
    g.beginPath();
    pts.forEach(([x, y], i) => { const [sx, sy] = project(x + ox, y + oy, zf(x, y)); i ? g.lineTo(sx, sy + dy) : g.moveTo(sx, sy + dy); });
    g.closePath();
  }
  function groundSprite(img, x, y, r, alpha) {
    if (alpha <= 0.003) return;
    const [sx, sy] = project(x, y, 0), rx = r * zoom, ry = rx * Math.sin(cam.pitch);
    if (sx + rx < 0 || sx - rx > W || sy + ry < 0 || sy - ry > H) return;
    ctx.globalAlpha = Math.min(1, alpha);
    ctx.drawImage(img, sx - rx, sy - ry, rx * 2, ry * 2);
  }

  // 수면 잔물결: 아주 옅은 가로선 몇 개가 월드에 떠서 천천히 흐름 (카메라 주변에서 순환)
  function drawSurfaceLines() {
    const L = WC().surfaceLines, n = Math.max(2, Math.round(L.count * S.quality)), T = 26;
    if (!S.lines || S.lines.length !== L.count) {
      const r = rng(99); S.lines = Array.from({ length: L.count }, () => ({ x: r() * T, y: r() * T, len: lerp(L.length[0], L.length[1], r()), a: lerp(L.alpha[0], L.alpha[1], r()), ph: r() * 6.28 }));
    }
    ctx.lineWidth = 1; ctx.lineCap = 'round';
    for (let i = 0; i < n; i++) {
      const l = S.lines[i];
      const wx = ((l.x + S.time * L.speed - cam.x) % T + T * 1.5) % T - T / 2 + cam.x;
      const wy = ((l.y - cam.y) % T + T * 1.5) % T - T / 2 + cam.y;
      if (floeAt(wx, wy) || islandAt(wx, wy)) continue;
      const [sx, sy] = project(wx, wy), hw = l.len * zoom / 2;
      const edge = Math.min(1, Math.min(sx, W - sx, sy, H - sy) / 60);   // 화면 가장자리에서 자연스럽게 사라짐
      const a = l.a * (0.55 + 0.45 * Math.sin(S.time * 0.4 + l.ph)) * Math.max(0, edge);
      if (a <= 0.004) continue;
      ctx.strokeStyle = `rgba(${COL.water},${a.toFixed(3)})`;
      ctx.beginPath(); ctx.moveTo(sx - hw, sy); ctx.quadraticCurveTo(sx, sy + 1.5, sx + hw, sy); ctx.stroke();
    }
  }

  function drawFarRidges() {
    const par = C.world.farRidgeParallax;
    ctx.fillStyle = COL.farRidge;
    for (const is of S.islands) {
      const X = is.shoreX + is.side * (8 / par);
      const near = 1 - smooth(C.world.farRidgeShow[1], C.world.farRidgeShow[0], Math.hypot(cam.x - is.shoreX, Math.max(0, Math.abs(cam.y) - is.ry)));
      if (near <= 0.01) continue;
      ctx.globalAlpha = near;
      const list = is.ridge.map((pk) => ({ pk, b: project(X + is.side * pk.d, pk.y, 0, par) })).sort((a, b) => a.b[2] - b.b[2]);
      for (const { pk, b: [bx, by] } of list) {
        const ex = pk.r * zoom, ey = ex * Math.sin(cam.pitch);
        if (bx + ex < 0 || bx - ex > W) continue;
        const ty = by - pk.h * Math.cos(cam.pitch) * zoom, tx = bx + pk.ax * zoom;
        ctx.beginPath(); ctx.moveTo(bx - ex, by); ctx.lineTo(tx, ty); ctx.lineTo(bx + ex, by);
        ctx.ellipse(bx, by, ex, ey, 0, 0, Math.PI); ctx.closePath(); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawWater() {
    const rs = getRingSprite();
    for (const r of S.ripples) {
      const k = r.t / r.life, rad = r.maxR * (0.15 + 0.85 * (1 - Math.pow(1 - k, 2.2)));
      groundSprite(rs, r.x, r.y, rad, r.alpha * Math.pow(1 - k, 1.3) * Math.min(1, k * 8));
    }
    ctx.globalAlpha = 1;
    // V자 항적: 방출점을 중심으로 퍼지는 얇은 호. 반지름 = 진행거리 × tan(반각) → 팔이 반각 19°
    const Wk = WC().wake, tanA = Math.tan(deg(Wk.halfAngleDeg)), sinP = Math.sin(cam.pitch);
    ctx.lineWidth = Wk.lineWidth; ctx.lineCap = 'round';
    for (const w of S.wake) {
      if (!w.on) continue;
      const k = w.t / Wk.life, a = w.alpha * Math.pow(1 - k, 1.4) * Math.min(1, w.t * 10);
      if (a < 0.004) continue;
      const rad = w.r0 + w.t * w.speed * tanA;
      const [sx, sy] = project(w.x, w.y);
      const rx = rad * zoom, ry = rx * sinP;
      if (sx + rx < 0 || sx - rx > W || sy + ry < 0 || sy - ry > H) continue;
      ctx.strokeStyle = `rgba(${COL.water},${a.toFixed(3)})`;
      const va = w.ang + cam.yaw;                            // 화면(뷰) 기준 진행 각도
      for (const sd of [1, -1]) {
        const c0 = va + sd * (Math.PI / 2 + 0.18);           // 옆, 살짝 뒤쪽으로 휜 호
        ctx.beginPath(); ctx.ellipse(sx, sy, rx, ry, 0, c0 - w.span / 2, c0 + w.span / 2); ctx.stroke();
      }
    }
  }

  // 선체 뒤로 흐르는 가는 흐름선 (2~3줄)
  function drawFlowLines(x, y, dir, speed, maxSp, halfW, rear, dy) {
    const F = WC().flowLines, s = clamp(speed / maxSp, 0, 1);
    if (s < 0.08 || F.count < 1) return;
    const len = speed * F.lengthSec, px = -dir[1], py = dir[0];
    ctx.lineWidth = 1; ctx.lineCap = 'round';
    for (let i = 0; i < F.count; i++) {
      const o = F.count === 1 ? 0 : (i / (F.count - 1) - 0.5) * 2 * halfW * 0.7;
      const shimmer = Math.sin(S.time * 3 + i * 1.7) * 0.08;
      const bx = x - dir[0] * rear + px * o, by = y - dir[1] * rear + py * o;
      const l = len * (0.75 + 0.25 * Math.sin(S.time * 1.3 + i));
      for (let seg = 0; seg < 3; seg++) {                    // 뒤로 갈수록 옅게
        const t0 = seg / 3, t1 = (seg + 1) / 3;
        const [x0, y0] = project(bx - dir[0] * l * t0 + px * shimmer * t0, by - dir[1] * l * t0 + py * shimmer * t0);
        const [x1, y1] = project(bx - dir[0] * l * t1 + px * shimmer * t1, by - dir[1] * l * t1 + py * shimmer * t1);
        ctx.strokeStyle = `rgba(${COL.water},${(F.alpha * s * (1 - t0)).toFixed(3)})`;
        ctx.beginPath(); ctx.moveTo(x0, y0 + dy * 0.3); ctx.lineTo(x1, y1 + dy * 0.3); ctx.stroke();
      }
    }
  }

  function floeAlpha(f) {
    const d = Math.hypot(f.x - cam.x, f.y - cam.y) - f.R;
    return Math.min(1, (S.time - f.born) / IF.fadeInTime) * (1 - smooth(IF.fadeRange[0], IF.fadeRange[1], d));
  }
  function drawFloe(f) {
    const a = f === S.p.floe ? 1 : floeAlpha(f);
    if (a <= 0.01) return;
    const dy = floeOffset(f);
    ctx.globalAlpha = a;
    ctx.fillStyle = COL.floeSide; polyPath(ctx, f.shape, (x, y) => -0.18 + f.tilt.x * x + f.tilt.y * y, f.x, f.y, dy); ctx.fill();
    ctx.fillStyle = COL.floeTop; polyPath(ctx, f.shape, (x, y) => floeTopAt(f, x, y), f.x, f.y, dy); ctx.fill();
    ctx.globalAlpha = 1;
  }

  function drawIslandGround() {
    const h = C.world.shoreHeight;
    for (const is of S.islands) {
      if (Math.abs(project(is.shoreX, cam.y)[0] - W / 2) > W * 2 + is.rx * 2 * zoom) continue;
      ctx.fillStyle = COL.shoreSide; polyPath(ctx, is.shape, () => -0.1, 0, 0, 0); ctx.fill();
      ctx.fillStyle = COL.shoreTop; polyPath(ctx, is.shape, () => h, 0, 0, 0); ctx.fill();
    }
  }

  function drawMountains() {
    const list = [], w = C.world;
    for (const is of S.islands) for (const pk of is.peaks) {
      const [bx, by, vy] = project(pk.x, pk.y, 0);
      const ex = pk.r * zoom;
      if (bx + ex < -20 || bx - ex > W + 20 || by - pk.r * zoom > H + 20) continue;
      list.push({ pk, bx, by, vy });
    }
    list.sort((a, b) => a.vy - b.vy);
    const sinP = Math.sin(cam.pitch);
    for (const { pk, bx, by } of list) {
      const [ax, ay] = project(pk.x + pk.ax, pk.y + pk.ay, pk.h);
      const ex = pk.r * zoom, ey = ex * sinP;
      const n = 1 - smooth(w.nearDist, w.farDist, Math.hypot(pk.x - cam.x, pk.y - cam.y));
      const c = COL.mountFar.map((v, i) => Math.round(v + (COL.mountNear[i] - v) * n));
      const lx = bx - ex, rx2 = bx + ex;
      const shx = lx + (ax - lx) * pk.sh - ex * 0.12 * pk.so, shy = by + (ay - by) * pk.sh;
      ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
      ctx.beginPath(); ctx.moveTo(lx, by); ctx.lineTo(shx, shy); ctx.lineTo(ax, ay); ctx.lineTo(rx2, by);
      ctx.ellipse(bx, by, ex, ey, 0, 0, Math.PI); ctx.closePath(); ctx.fill();
      const l = c.map((v) => Math.round(v + (255 - v) * 0.1));
      ctx.fillStyle = `rgb(${l[0]},${l[1]},${l[2]})`;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(rx2, by); ctx.ellipse(bx, by, ex, ey, 0, 0, Math.PI * 0.35); ctx.closePath(); ctx.fill();
    }
  }

  // 펭귄 실루엣: 원점 = 발. 본 화면과 반영에서 함께 사용 (항상 선명하게, 블러 없음)
  function penguinView() {
    const p = S.p, c = Math.cos(cam.yaw), s = Math.sin(cam.yaw);
    const fx = Math.cos(p.face), fy = Math.sin(p.face);
    const squash = p.sit ? 0.22 : (S.tapPulse * 0.08 + (slideHeld() && !p.sliding ? 0.1 : 0)) - (p.air && p.vz > 0 ? 0.08 : 0);
    return { fvx: c * fx - s * fy, fvy: s * fx + c * fy, squash };
  }
  function drawPenguinFigure(g, u, v) {
    const p = S.p;
    if (p.sink > 0.01) {
      g.beginPath(); g.rect(-u * 2, -u * 3, u * 4, u * 3); g.clip();
      g.translate(0, p.sink * u);
    }
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

  function drawPenguin() {
    const p = S.p, u = penU(), v = penguinView(), dy = penOffset();
    const gz = p.air ? surfaceAt(p.x, p.y).z : p.z;
    const [gx, gy] = project(p.x, p.y, gz);
    const [sx, sy0] = project(p.x, p.y, p.z), sy = sy0 + dy;
    if (p.mode !== 'water' || p.air) {
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.beginPath(); ctx.ellipse(gx, gy + (p.floe && !p.air ? floeOffset(p.floe) : 0), u * 0.3, u * 0.3 * Math.sin(cam.pitch), 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.save(); ctx.translate(sx, sy); drawPenguinFigure(ctx, u, v); ctx.restore();
    if (p.sink > 0.2) {
      ctx.globalAlpha = 0.5;
      ctx.drawImage(getRingSprite(), sx - u * 0.45, sy0 - u * 0.45 * Math.sin(cam.pitch), u * 0.9, u * 0.9 * Math.sin(cam.pitch));
      ctx.globalAlpha = 1;
    }
  }

  const off = document.createElement('canvas'), og = off.getContext('2d');
  function drawReflection() {
    if (!(C.reflect.alpha > 0)) return;
    const p = S.p, u = penU(), v = penguinView(), dy = penOffset();
    const [sx, sy0] = project(p.x, p.y, p.z), [, wy] = project(p.x, p.y, 0), sy = sy0 + dy;
    const size = Math.ceil(u * 3), oy = Math.ceil(u * 2.2), ox = size / 2;
    if (off.width !== Math.ceil(size * DPR)) { off.width = off.height = Math.ceil(size * DPR); }
    og.setTransform(DPR, 0, 0, DPR, 0, 0); og.globalCompositeOperation = 'source-over';
    og.clearRect(0, 0, size, size);
    og.save(); og.translate(ox, oy + (sy - wy)); drawPenguinFigure(og, u, v); og.restore();
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

  function drawFish() {
    const F = S.fish;
    if (!F.visible) return;
    const s = C.fish.size * zoom;
    const [sx, sy] = project(F.x, F.y, F.z);
    ctx.save(); ctx.translate(sx, sy); ctx.rotate(F.ang);
    ctx.fillStyle = COL.fish;
    ctx.beginPath(); ctx.ellipse(0, 0, s * 0.5, s * 0.17, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-s * 0.4, 0); ctx.lineTo(-s * 0.72, -s * 0.2); ctx.lineTo(-s * 0.72, s * 0.2); ctx.closePath(); ctx.fill();
    ctx.restore();
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
    ctx.save(); ctx.translate(a.x, a.y + sc * 0.05); ctx.scale(sc, sc);
    ctx.fillStyle = uiColor(lum.action, pressed ? 1.5 : 1);
    ctx.beginPath();
    ctx.moveTo(0, 0.62);
    ctx.quadraticCurveTo(-0.22, 0.42, -0.62, -0.42);
    ctx.quadraticCurveTo(-0.28, -0.28, -0.04, -0.78);
    ctx.lineTo(0.04, -0.78);
    ctx.quadraticCurveTo(0.28, -0.28, 0.62, -0.42);
    ctx.quadraticCurveTo(0.22, 0.42, 0, 0.62);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  function draw(dt) {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = COL.bg; ctx.fillRect(0, 0, W, H);
    drawFarRidges();
    drawSurfaceLines();
    drawWater();
    drawReflection();
    // 빙하 + 흐름선 (먼 것부터)
    const fl = activeFloes().map((f) => ({ f, vy: project(f.x, f.y)[2] })).sort((a, b) => a.vy - b.vy);
    for (const { f } of fl) {
      const sp = Math.hypot(f.vx, f.vy);
      drawFlowLines(f.x, f.y, f.dir, sp, 4, f.cr, f.R * 0.7, floeOffset(f));
      drawFloe(f);
    }
    const p = S.p;
    if (p.mode === 'water' && !p.air) {
      const sp = Math.hypot(p.vx, p.vy);
      if (sp > 0.05) drawFlowLines(p.x, p.y, [p.vx / sp, p.vy / sp], sp, P.penguin.maxSpeed.water, 0.25 * C.penguin.scale, 0.15, 0);
    }
    drawIslandGround();
    drawMountains();
    drawPenguin();
    drawFish();
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
