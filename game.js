// 펭귄 탐험 — 첫 구간 프로토타입
// 그림은 전부 draw* 함수 안의 단색 실루엣. 판정(터치 영역·이동·발판)은 그림과 분리되어 있어
// 나중에 그림을 바꿔도 layout / hit / surface 로직은 그대로 유지됨.
(() => {
  'use strict';

  // ── 설정 (URL ?cfg=a.b=1,c.d=2 덮어쓰기) ─────────────────
  const C = window.CONFIG;
  try {
    const q = new URLSearchParams(location.search).get('cfg');
    if (q) q.split(',').forEach((kv) => {
      const [path, val] = kv.split('=');
      const keys = path.split('.');
      let o = C;
      for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]];
      const k = keys[keys.length - 1];
      o[k] = typeof o[k] === 'boolean' ? val === 'true' : parseFloat(val);
    });
  } catch (e) { /* 잘못된 cfg 는 무시 */ }

  const COL = {
    bg: '#f3eee3', chip: 'rgba(170, 160, 140, 0.10)',
    floeTop: '#ffffff', floeSide: '#d9d5cc',
    shoreTop: '#9c9890', shoreSide: '#4a4a4d',
    mountNear: [38, 38, 42], mountFar: [214, 209, 199], farRidge: '#e4dfd4',
    black: '#1b1b1d', white: '#ffffff', beak: '#7a7a7a', fish: '#2c2c30',
    ink: [40, 40, 44],
  };

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const safeProbe = document.getElementById('safe');
  const finishEl = document.getElementById('finish');
  let W = 0, H = 0, DPR = 1, zoom = 30;
  const safe = { l: 0, r: 0, t: 0, b: 0 };
  const layout = { ring: { x: 0, y: 0 }, action: { x: 0, y: 0 } };

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    const cs = getComputedStyle(safeProbe);
    safe.l = parseFloat(cs.paddingLeft) || 0; safe.r = parseFloat(cs.paddingRight) || 0;
    safe.t = parseFloat(cs.paddingTop) || 0; safe.b = parseFloat(cs.paddingBottom) || 0;
    const r = C.ui.ring, a = C.ui.action;
    layout.ring.x = safe.l + r.insetX + r.radius;
    layout.ring.y = H - safe.b - r.insetY - r.radius;
    layout.action.x = W - safe.r - a.insetX - a.radius;
    layout.action.y = H - safe.b - a.insetY - a.radius;
    zoom = H / C.camera.viewHeight;
  }
  window.addEventListener('resize', resize);

  // ── 유틸 ────────────────────────────────────────────────
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
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
  const penU = () => zoom * C.penguin.height * C.penguin.scale;   // 펭귄 키 (px)

  // ── 부드러운 파문 스프라이트 (한 번 만들어 재사용: 모바일에서 가벼움) ──
  function makeSprite(stops) {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d'), gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    stops.forEach(([o, col]) => gr.addColorStop(o, col));
    g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
    return c;
  }
  let ringSprite = null, ringSoft = -1;
  function getRingSprite() {
    const s = clamp(C.water.rippleSoftness, 0.1, 0.9);
    if (ringSoft !== s) {
      ringSoft = s;
      ringSprite = makeSprite([
        [0, 'rgba(255,255,255,0)'], [1 - s, 'rgba(255,255,255,0)'],
        [1 - s * 0.62, 'rgba(255,255,255,0.85)'],         // 물마루의 밝은 띠
        [1 - s * 0.3, 'rgba(96,106,118,0.85)'],           // 바깥쪽 그늘
        [1, 'rgba(96,106,118,0)'],
      ]);
    }
    return ringSprite;
  }
  const discSprite = makeSprite([[0, 'rgba(96,106,118,1)'], [0.5, 'rgba(96,106,118,0.55)'], [1, 'rgba(96,106,118,0)']]);

  // ── 상태 ────────────────────────────────────────────────
  const S = {};
  const cam = { x: 0, y: 0, yaw: 0, yawT: 0, pitch: 0, pitchT: 0 };

  function makeIsland(side, seed) {
    const w = C.world, r = rng(seed);
    const shoreX = side * w.islandDistance, cx = side * (w.islandDistance + w.islandHalfWidth);
    const shape = blob(w.islandHalfWidth, w.islandHalfLength, 48, 0.04, seed).map(([x, y]) => [x + cx, y]);
    const peaks = [];
    // 산 = 바닥 원(섬 안쪽에만 놓임) + 꼭짓점. 바닥 반지름은 물가까지 거리보다 작게 → 물 위로 튀어나오지 않음
    const peak = (dist, y, h, rWant) => {
      const rad = Math.min(rWant, dist - 2.5);
      peaks.push({ x: shoreX + side * dist, y, h, r: rad,
        ax: (r() - 0.5) * rad * 0.5, ay: (r() - 0.5) * rad * 0.5, sh: 0.35 + r() * 0.25, so: (r() - 0.5) * 0.5 });
    };
    // 정상 + 양옆 능선 + 뒷줄 + 물가 앞 낮은 절벽
    peak(15, 0, w.summitHeight, 11);
    for (let k = 1; k <= 9; k++) for (const sg of [-1, 1]) {
      const y = sg * k * 4.2 + (r() - 0.5) * 1.5;
      const h = w.summitHeight * (0.8 * Math.exp(-Math.pow(k / 5.5, 2)) + 0.2) * (0.8 + r() * 0.3);
      peak(11 + r() * 4 + k * 0.4, y, h, 4 + h * 0.22);
      peak(21 + r() * 5, y + sg * 2, h * (0.75 + r() * 0.3), 6 + h * 0.2);
    }
    for (let y = -w.islandHalfLength + 6; y <= w.islandHalfLength - 6; y += 4 + r() * 2) {
      peak(6 + r() * 1.5, y, 3 + r() * 4, 3);
    }
    // 먼 능선 (시차 레이어)
    const ridge = [];
    for (let y = -220; y <= 220; y += 26 + r() * 18) ridge.push({ y, d: r() * 60, h: 9 + r() * 6 + 7 * Math.exp(-Math.pow(y / 90, 2)), r: 3 + r() * 2, ax: (r() - 0.5) * 2 });
    return { side, shoreX, cx, cy: 0, rx: w.islandHalfWidth, ry: w.islandHalfLength, shape, peaks, ridge };
  }

  function reset() {
    S.time = 0; S.finished = false;
    const fs = C.floe.scale;
    S.floe = { x: 0, y: 0, vx: 0, vy: 0, bob: 0, dragDX: 0, dragDY: 0, dragging: 0,
      shape: blob(C.floe.radiusX * fs, C.floe.radiusY * fs, 14, 0.1, 7), lastWake: null, ringT: 0 };
    S.floe.R = Math.max(...S.floe.shape.map(([x, y]) => Math.hypot(x, y)));
    S.p = {
      x: 0, y: 0, z: 0.12, vx: 0, vy: 0, vz: 0, cvx: 0, cvy: 0,
      face: Math.PI / 2, mode: 'floe', lx: 0, ly: 0, air: false,
      sliding: false, slideDir: 0, slideSpeed: 0, sit: true, sink: 0,
      wobble: 0, phase: 0, idleRing: 0, lastWake: null, ringT: 0, ripple: 0,
    };
    S.islands = [makeIsland(1, 31), makeIsland(-1, 57)];
    S.ripples = []; S.wakes = []; S.drops = [];
    S.lastTapUp = 0; S.tapPulse = 0;
    S.fish = { state: 'wait', t: 0 };
    S.events = [];
    cam.x = 0; cam.y = 0; cam.yaw = cam.yawT = 0;
    cam.pitch = cam.pitchT = deg(C.camera.pitchDeg);
    finishEl.classList.remove('show');
  }
  const log = (type) => { S.events.push({ type, t: S.time }); if (S.events.length > 60) S.events.shift(); };

  // ── 투영 (지면 평면 + 높이, yaw 회전·pitch 기울기 직교 투영) ──
  function project(x, y, z = 0, par = 1, zs = 1) {
    const dx = (x - cam.x) * par, dy = (y - cam.y) * par, c = Math.cos(cam.yaw), s = Math.sin(cam.yaw);
    const vx = c * dx - s * dy, vy = s * dx + c * dy;
    return [W / 2 + vx * zoom, H * C.camera.screenY + (vy * Math.sin(cam.pitch) - z * zs * Math.cos(cam.pitch)) * zoom, vy];
  }
  function screenDirToWorld(sx, sy) {
    const c = Math.cos(cam.yaw), s = Math.sin(cam.yaw);
    return [c * sx + s * sy, -s * sx + c * sy];
  }
  function screenDeltaToWorld(dsx, dsy) {
    return screenDirToWorld(dsx / zoom, dsy / (zoom * Math.sin(cam.pitch)));
  }

  // ── 지형 판정 ───────────────────────────────────────────
  const floeH = () => 0.12 + S.floe.bob;
  const onFloe = (x, y, scale = 1) => inPoly(S.floe.shape, (x - S.floe.x) / scale, (y - S.floe.y) / scale);
  const islandAt = (x, y) => S.islands.find((is) => inPoly(is.shape, x, y));
  function surfaceAt(x, y) {
    if (islandAt(x, y)) return { mode: 'island', z: C.world.shoreHeight };
    if (onFloe(x, y, 0.95)) return { mode: 'floe', z: floeH() };
    return { mode: 'water', z: 0 };
  }

  // ── 물결 ────────────────────────────────────────────────
  function ripple(x, y, maxR, life, alpha) {
    S.ripples.push({ x, y, t: 0, maxR, life: life || C.water.rippleLife, alpha: alpha == null ? C.water.rippleAlpha : alpha });
  }
  function splash(x, y) {
    ripple(x, y, C.water.splashRadius, C.water.splashLife, C.water.rippleAlpha * 1.5);
    ripple(x, y, C.water.splashRadius * 0.55, C.water.splashLife * 0.75, C.water.rippleAlpha);
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * Math.PI * 2, sp = 0.6 + Math.random() * 1.0;
      S.drops.push({ x, y, z: 0.1, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: 2.4 + Math.random() * 1.5 });
    }
    log('splash');
  }
  // 물자국: 부드러운 원을 경로를 따라 겹쳐 찍어 길게 번지는 자국을 만듦
  function emitWake(owner, x, y, spacing, r0, alpha, life, spread) {
    const last = owner.lastWake;
    if (last && Math.hypot(x - last.x, y - last.y) < spacing) return;
    owner.lastWake = { x, y };
    S.wakes.push({ x, y, t: 0, r0, alpha, life: life || C.water.wakeLife, spread: spread == null ? C.water.wakeSpread : spread });
  }

  // ── 입력 ────────────────────────────────────────────────
  const pointers = new Map();   // pointerId → { role, x, y, ox, oy, t0, long }
  const keys = new Set();

  function pickRole(x, y) {
    const rg = layout.ring, a = layout.action;
    if (Math.hypot(x - rg.x, y - rg.y) <= C.ui.ring.hitRadius) return 'ring';
    if (Math.hypot(x - a.x, y - a.y) <= C.ui.action.hitRadius) return 'action';
    const p = S.p;
    if (p.mode === 'floe' && !p.air) {
      const u = penU();
      const [sx, sy] = project(p.x, p.y, p.z);
      if (Math.hypot(x - sx, y - (sy - u * 0.45)) <= Math.max(C.input.penguinHitPx * C.penguin.scale, u * 0.9)) return 'drag';
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
    // 링: 링 안쪽을 눌렀으면 링 중심 기준, 넉넉한 바깥 영역이면 닿은 지점 기준 (누르자마자 튀지 않게)
    if (role === 'ring' && Math.hypot(x - layout.ring.x, y - layout.ring.y) <= C.ui.ring.radius * 1.15) { ptr.ox = layout.ring.x; ptr.oy = layout.ring.y; }
    pointers.set(id, ptr);
    if (role === 'action') S.tapPulse = 1;
    if (role === 'drag') S.floe.dragging++;
  }
  function release(id, cancelled) {
    const ptr = pointers.get(id);
    if (!ptr) return;
    pointers.delete(id);
    if (ptr.role === 'drag') S.floe.dragging = Math.max(0, S.floe.dragging - 1);
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
    } else if (ptr.role === 'drag') {
      const [wx, wy] = screenDeltaToWorld(dx, dy);
      S.floe.dragDX += wx * C.input.floeDragScale; S.floe.dragDY += wy * C.input.floeDragScale;
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

  // 데스크톱 디버깅용 키보드: 방향키/WASD 이동, Space = 발자국 버튼
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

  // 이동 링 입력: 화면 기준 벡터 (크기 0~1)
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

  // 발자국 버튼: 짧은 탭 = 버튼 반응만, 짧은 탭 두 번 = 두 번째를 뗄 때 점프 1회,
  //             길게 누름 = 누르는 동안 슬라이딩 (뗄 때 탭으로 세지 않음)
  function shortTap(ptr) {
    const now = performance.now();
    log('tap');
    if (S.lastTapUp && ptr.t0 - S.lastTapUp <= C.input.doubleTapMs) { S.lastTapUp = 0; doJump(); }
    else S.lastTapUp = now;
  }
  const slideHeld = () => { for (const p of pointers.values()) if (p.role === 'action' && p.long) return true; return false; };
  function doJump() {
    const p = S.p;
    if (p.air) return;
    if (p.sliding) endSlide();
    p.air = true; p.sit = false;
    p.vz = Math.sqrt(2 * C.jump.gravity * C.jump.height);
    p.cvx = p.mode === 'floe' ? S.floe.vx : 0; p.cvy = p.mode === 'floe' ? S.floe.vy : 0;
    if (p.mode === 'water') ripple(p.x, p.y, 1.4, 1.2);
    log('jump');
  }
  function startSlide(wx, wy, mag) {
    const p = S.p;
    p.sliding = true; p.sit = false;
    p.slideDir = mag > 0.01 ? Math.atan2(wy, wx) : p.face;
    p.slideSpeed = Math.max(Math.hypot(p.vx, p.vy), C.slide.startSpeed);
    log('slideStart');
  }
  function endSlide() { S.p.sliding = false; log('slideEnd'); }

  // ── 물고기 연출 ─────────────────────────────────────────
  function startFish() {
    const p = S.p, f = C.fish, fs = C.floe.scale;
    const rx = C.floe.radiusX * fs, ry = C.floe.radiusY * fs;
    const R = screenDirToWorld(1, 0), D = screenDirToWorld(0, 1);
    const at = (r, d) => [p.x + R[0] * r + D[0] * d, p.y + R[1] * r + D[1] * d];
    const p0 = at(rx + f.startSide, ry + f.front);
    const p1 = at(-(rx + f.landSide), ry + f.front * 0.6);
    const p2 = at(-(rx + f.landSide + f.jump2.distance), ry + f.front * 0.6 - f.jump2.rise);
    S.fish = { state: 'hop', t: 0, hops: [
      { a: p0, b: p1, h: f.jump1.height, dur: f.jump1.duration },
      { a: p1, b: p2, h: f.jump2.height, dur: f.jump2.duration, delay: f.pause },
    ], i: 0, x: p0[0], y: p0[1], z: 0, ang: 0, visible: false };
    ripple(p0[0], p0[1], 1.1, 1.3, C.water.rippleAlpha * 0.8);
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
    if (hop.delay && !hop.started) { hop.started = true; ripple(hop.a[0], hop.a[1], 0.9, 1.1, C.water.rippleAlpha * 0.7); }
    const s = clamp(t / hop.dur, 0, 1);
    const nx = hop.a[0] + (hop.b[0] - hop.a[0]) * s, ny = hop.a[1] + (hop.b[1] - hop.a[1]) * s, nz = 4 * hop.h * s * (1 - s);
    const [sx0, sy0] = project(F.x, F.y, F.z), [sx1, sy1] = project(nx, ny, nz);
    if (Math.hypot(sx1 - sx0, sy1 - sy0) > 0.01) F.ang = Math.atan2(sy1 - sy0, sx1 - sx0);
    F.x = nx; F.y = ny; F.z = nz; F.visible = true;
    if (s >= 1) {
      ripple(hop.b[0], hop.b[1], 1.3, 1.5, C.water.rippleAlpha);
      log('fishLand');
      F.i++; F.t = 0;
      if (F.i >= F.hops.length) { F.state = 'done'; F.visible = false; }
    }
  }

  // ── 업데이트 ────────────────────────────────────────────
  function update(dt) {
    S.time += dt;
    const p = S.p, f = S.floe, now = performance.now();
    updateFish(dt);

    // 발자국 길게 누르기 판정
    for (const ptr of pointers.values()) {
      if (ptr.role === 'action' && !ptr.long && now - ptr.t0 >= C.input.longPressMs) { ptr.long = true; S.lastTapUp = 0; }
    }

    // 빙하: 끌기 / 관성 / 섬 충돌
    f.bob = Math.sin(S.time * 1.3) * 0.015;
    if (f.dragging > 0 || f.dragDX || f.dragDY) {
      const k = ease(18, dt);
      f.vx += (f.dragDX / dt - f.vx) * k; f.vy += (f.dragDY / dt - f.vy) * k;
      f.x += f.dragDX; f.y += f.dragDY; f.dragDX = f.dragDY = 0;
      const sp = Math.hypot(f.vx, f.vy);
      if (sp > C.floe.maxSpeed) { f.vx *= C.floe.maxSpeed / sp; f.vy *= C.floe.maxSpeed / sp; }
    } else {
      const k = Math.exp(-C.floe.damping * dt);
      f.vx *= k; f.vy *= k; f.x += f.vx * dt; f.y += f.vy * dt;
    }
    for (const is of S.islands) {
      const a = is.rx + f.R * 0.8, b = is.ry + f.R * 0.8, dx = f.x - is.cx, dy = f.y - is.cy;
      const q = (dx * dx) / (a * a) + (dy * dy) / (b * b);
      if (q < 1) {
        const s = 1 / Math.sqrt(q); f.x = is.cx + dx * s; f.y = is.cy + dy * s;
        let nx = dx / (a * a), ny = dy / (b * b); const nl = Math.hypot(nx, ny); nx /= nl; ny /= nl;
        const vn = f.vx * nx + f.vy * ny; if (vn < 0) { f.vx -= vn * nx; f.vy -= vn * ny; }
      }
    }
    const fsp = Math.hypot(f.vx, f.vy);
    if (fsp > 0.25) {
      const dx = f.vx / fsp, dy = f.vy / fsp;
      emitWake(f, f.x - dx * f.R * 0.7, f.y - dy * f.R * 0.7, 0.3, f.R * 0.55, C.water.wakeAlpha * clamp(fsp / 2.5, 0.35, 1.2));
      f.ringT -= dt;
      if (f.ringT <= 0) { ripple(f.x + dx * f.R * 0.6, f.y + dy * f.R * 0.6, f.R * 1.1, 1.4, C.water.rippleAlpha * 0.45); f.ringT = 0.5; }
    } else f.lastWake = null;

    // 펭귄 이동
    const [mx, my] = readMove();
    const [wx, wy] = screenDirToWorld(mx, my);
    const mag = Math.hypot(mx, my);
    const maxSp = p.mode === 'water' ? C.move.swimSpeed : C.move.walkSpeed;

    const held = slideHeld();
    if (held && !p.sliding && !p.air) startSlide(wx, wy, mag);
    if (!held && p.sliding) endSlide();

    if (p.sliding) {
      if (mag > 0.01) {
        p.slideDir += angDiff(p.slideDir, Math.atan2(wy, wx)) * ease(C.slide.turnRate, dt);
        p.slideSpeed += (C.slide.speed * mag - p.slideSpeed) * ease(C.slide.accel, dt);
      } else p.slideSpeed = Math.max(0, p.slideSpeed - C.slide.coastDecel * dt);
      p.face = p.slideDir;
      p.vx = Math.cos(p.slideDir) * p.slideSpeed; p.vy = Math.sin(p.slideDir) * p.slideSpeed;
    } else {
      if (mag > 0.01) { p.sit = false; p.face += angDiff(p.face, Math.atan2(wy, wx)) * ease(C.move.turnRate, dt); }
      else if (p.sit && S.fish.visible) {                       // 앉아 있을 땐 물고기를 눈으로 좇음
        const [sx, sy] = project(p.x, p.y), [fx, fy] = project(S.fish.x, S.fish.y);
        const [ex, ey] = screenDirToWorld(fx - sx, fy - sy);
        p.face += angDiff(p.face, Math.atan2(ey, ex)) * ease(4, dt);
      }
      const rate = p.air ? C.move.accel * C.move.airControl : (mag > 0.01 ? C.move.accel : C.move.stopRate);
      const k = ease(rate, dt);
      p.vx += (wx * maxSp - p.vx) * k; p.vy += (wy * maxSp - p.vy) * k;
    }

    if (p.mode === 'floe' && !p.air) {
      p.lx += p.vx * dt; p.ly += p.vy * dt;
      p.x = f.x + p.lx; p.y = f.y + p.ly;
    } else {
      p.x += (p.vx + (p.air ? p.cvx : 0)) * dt; p.y += (p.vy + (p.air ? p.cvy : 0)) * dt;
    }

    // 발판 전환 (빙하는 보이는 가장자리 = 그림과 같은 다각형으로 판정)
    if (p.air) {
      p.vz -= C.jump.gravity * dt; p.z += p.vz * dt;
      const s = surfaceAt(p.x, p.y);
      if (p.vz < 0 && p.z <= s.z) { p.air = false; p.z = s.z; p.vz = 0; setMode(s.mode, true); }
    } else if (p.mode === 'floe') {
      if (!onFloe(p.x, p.y)) setMode(islandAt(p.x, p.y) ? 'island' : 'water');
    } else if (p.mode === 'water') {
      if (islandAt(p.x, p.y)) setMode('island');
      else if (onFloe(p.x, p.y, 0.88)) setMode('floe');
    } else if (p.mode === 'island') {
      if (!islandAt(p.x, p.y)) setMode(onFloe(p.x, p.y) ? 'floe' : 'water');
    }
    if (!p.air) {
      const tz = p.mode === 'island' ? C.world.shoreHeight : p.mode === 'floe' ? floeH() : 0;
      p.z += (tz - p.z) * ease(14, dt);
    }

    // 애니메이션 값
    const sp = Math.hypot(p.vx, p.vy);
    p.sink += ((p.mode === 'water' && !p.air ? (p.sliding ? 0.06 : C.penguin.swimSink) : 0) - p.sink) * ease(8, dt);
    S.tapPulse = Math.max(0, S.tapPulse - dt * 5);
    if (!p.air && p.mode !== 'water' && !p.sliding && sp > 0.15) {
      p.phase += sp * dt * C.penguin.walkWobbleFreq;
      p.wobble = Math.sin(p.phase) * deg(C.penguin.walkWobbleDeg) * Math.min(1, sp / C.move.walkSpeed);
    } else p.wobble *= Math.exp(-10 * dt);
    if (p.mode === 'water' && !p.air) {
      if (sp > 0.3) {
        emitWake(p, p.x - Math.cos(p.face) * 0.25, p.y - Math.sin(p.face) * 0.25, 0.22, 0.28 * C.penguin.scale, C.water.swimWakeAlpha, C.water.wakeLife * 0.6, C.water.wakeSpread * 0.4);
        p.ringT -= dt; if (p.ringT <= 0) { ripple(p.x, p.y, 1.0 * C.penguin.scale, 1.3, C.water.rippleAlpha * 0.5); p.ringT = 0.55; }
      } else {
        p.lastWake = null; p.idleRing -= dt;
        if (p.idleRing <= 0) { ripple(p.x, p.y, 0.9 * C.penguin.scale, 1.8, C.water.rippleAlpha * 0.45); p.idleRing = 1.7; }
      }
    } else p.lastWake = null;

    // 반영 일렁임 세기: 펭귄 근처를 지나는 파문 띠
    let rip = p.mode === 'water' && sp > 0.3 ? 0.35 : 0.08;
    for (const r of S.ripples) {
      const k = r.t / r.life, rad = r.maxR * (0.15 + 0.85 * (1 - Math.pow(1 - k, 2.2)));
      rip += (1 - k) * Math.max(0, 1 - Math.abs(Math.hypot(p.x - r.x, p.y - r.y) - rad) / 1.2);
    }
    p.ripple += (clamp(rip, 0, 1) - p.ripple) * ease(6, dt);

    // 카메라
    const onF = p.mode === 'floe' && !p.air;
    const tvx = p.vx + (onF ? f.vx : 0), tvy = p.vy + (onF ? f.vy : 0);
    const kc = ease(C.camera.followRate, dt);
    cam.x += (p.x + tvx * C.camera.lead - cam.x) * kc;
    cam.y += (p.y + tvy * C.camera.lead - cam.y) * kc;
    const kr = ease(C.camera.rotateSmooth, dt);
    cam.yaw += (cam.yawT - cam.yaw) * kr;
    cam.pitch += (cam.pitchT - cam.pitch) * kr;

    S.ripples = S.ripples.filter((r) => (r.t += dt) < r.life);
    S.wakes = S.wakes.filter((w) => (w.t += dt) < w.life);
    S.drops = S.drops.filter((d) => { d.vz -= 14 * dt; d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt; return d.z > 0; });
  }

  function setMode(mode, landed = false) {
    const p = S.p, prev = p.mode;
    p.mode = mode;
    if (mode === 'floe') { p.lx = p.x - S.floe.x; p.ly = p.y - S.floe.y; }
    if (mode === 'water' && (prev !== 'water' || landed)) { splash(p.x, p.y); if (!landed) p.z -= 0.15; }
    if (mode !== 'water' && prev === 'water' && !landed) ripple(p.x, p.y, 1.2, 1.2, C.water.rippleAlpha * 0.6);
    if (mode === 'island' && !S.finished) {
      S.finished = true; log('arrive');
      finishEl.classList.add('show');
    }
  }

  // ── 그리기 ──────────────────────────────────────────────
  function polyPath(g, pts, z, ox = 0, oy = 0) {
    g.beginPath();
    pts.forEach(([x, y], i) => { const [sx, sy] = project(x + ox, y + oy, z); i ? g.lineTo(sx, sy) : g.moveTo(sx, sy); });
    g.closePath();
  }
  function groundSprite(img, x, y, r, alpha) {
    if (alpha <= 0.003) return;
    const [sx, sy] = project(x, y, 0), rx = r * zoom, ry = rx * Math.sin(cam.pitch);
    if (sx + rx < 0 || sx - rx > W || sy + ry < 0 || sy - ry > H) return;
    ctx.globalAlpha = Math.min(1, alpha);
    ctx.drawImage(img, sx - rx, sy - ry, rx * 2, ry * 2);
  }

  // 먼 바다 조각: 시차 0.55 로 천천히 흐름 (잔잔할 땐 거의 보이지 않게)
  const CHIPS = (() => { const r = rng(5); return Array.from({ length: 50 }, () => [r() * 48, r() * 48, 0.04 + r() * 0.08]); })();
  function drawChips() {
    const T = 48, par = 0.55, c = Math.cos(cam.yaw), s = Math.sin(cam.yaw);
    ctx.fillStyle = COL.chip;
    for (const [cx, cy, r] of CHIPS) {
      const dx = ((cx - cam.x * par) % T + T * 1.5) % T - T / 2;
      const dy = ((cy - cam.y * par) % T + T * 1.5) % T - T / 2;
      const vx = c * dx - s * dy, vy = s * dx + c * dy;
      const sx = W / 2 + vx * zoom * 0.7, sy = H * C.camera.screenY + vy * Math.sin(cam.pitch) * zoom * 0.7;
      ctx.beginPath(); ctx.ellipse(sx, sy, r * zoom * 1.6, r * zoom * Math.sin(cam.pitch), 0, 0, Math.PI * 2); ctx.fill();
    }
  }

  // 먼 연회색 능선: 큰 시차로 실제 섬보다 먼저 화면 가장자리에 나타남
  function drawFarRidges() {
    const par = C.world.farRidgeParallax;
    ctx.fillStyle = COL.farRidge;
    for (const is of S.islands) {
      const X = is.shoreX + is.side * (8 / par);            // 도착 시 물가에서 약 8 월드 바깥(가까운 산 뒤)에 오도록
      // 섬에 다가갈수록 서서히 드러남 (출발 지점의 여백은 비워 둠)
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
    for (const w of S.wakes) {
      const k = w.t / w.life;
      groundSprite(discSprite, w.x, w.y, w.r0 + w.t * w.spread, w.alpha * Math.pow(1 - k, 1.6));
    }
    const rs = getRingSprite();
    for (const r of S.ripples) {
      const k = r.t / r.life, rad = r.maxR * (0.15 + 0.85 * (1 - Math.pow(1 - k, 2.2)));
      groundSprite(rs, r.x, r.y, rad, r.alpha * Math.pow(1 - k, 1.3) * Math.min(1, k * 8));
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(110, 122, 135, 0.45)';
    for (const d of S.drops) { const [sx, sy] = project(d.x, d.y, d.z); ctx.beginPath(); ctx.arc(sx, sy, 1.8, 0, Math.PI * 2); ctx.fill(); }
  }

  function drawFloe() {
    const f = S.floe;
    ctx.fillStyle = COL.floeSide; polyPath(ctx, f.shape, -0.18, f.x, f.y); ctx.fill();
    ctx.fillStyle = COL.floeTop; polyPath(ctx, f.shape, floeH(), f.x, f.y); ctx.fill();
  }

  function drawIslandGround() {
    const h = C.world.shoreHeight;
    for (const is of S.islands) {
      if (Math.abs(project(is.shoreX, cam.y)[0] - W / 2) > W * 2 + is.rx * 2 * zoom) continue;
      ctx.fillStyle = COL.shoreSide; polyPath(ctx, is.shape, -0.1); ctx.fill();
      ctx.fillStyle = COL.shoreTop; polyPath(ctx, is.shape, h); ctx.fill();
    }
  }

  // 산: 바닥점에서 위로 선 실루엣. 가까울수록 짙은 먹색, 멀수록 연회색
  function drawMountains() {
    const list = [];
    const w = C.world;
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
      const d = Math.hypot(pk.x - cam.x, pk.y - cam.y);
      const n = 1 - smooth(w.nearDist, w.farDist, d);
      const c = COL.mountFar.map((v, i) => Math.round(v + (COL.mountNear[i] - v) * n));
      const lx = bx - ex, rx2 = bx + ex;
      // 왼쪽 어깨 (능선이 한 번 꺾이게)
      const shx = lx + (ax - lx) * pk.sh - ex * 0.12 * pk.so, shy = by + (ay - by) * pk.sh;
      ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
      ctx.beginPath();
      ctx.moveTo(lx, by); ctx.lineTo(shx, shy); ctx.lineTo(ax, ay); ctx.lineTo(rx2, by);
      ctx.ellipse(bx, by, ex, ey, 0, 0, Math.PI);             // 앞쪽 바닥 곡선
      ctx.closePath(); ctx.fill();
      // 한쪽 면을 살짝 밝게 (양감)
      const l = c.map((v) => Math.round(v + (255 - v) * 0.1));
      ctx.fillStyle = `rgb(${l[0]},${l[1]},${l[2]})`;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(rx2, by);
      ctx.ellipse(bx, by, ex, ey, 0, 0, Math.PI * 0.35);
      ctx.closePath(); ctx.fill();
    }
  }

  // 펭귄 실루엣: 원점 = 발. 본 화면과 반영에서 함께 사용
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
      g.translate(0, p.sink * u + Math.sin(S.time * 3) * u * 0.03);
    }
    const { fvx, fvy } = v;
    if (p.sliding) {
      // 배를 댄 자세: 좌우는 뒤집기, 앞뒤 방향은 몸 길이를 줄여 표현 (위아래가 뒤집히지 않게)
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
    const p = S.p, u = penU(), v = penguinView();
    const [gx, gy] = project(p.x, p.y, p.air ? surfaceAt(p.x, p.y).z : p.z);
    const [sx, sy] = project(p.x, p.y, p.z);
    if (p.mode !== 'water' || p.air) {
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.beginPath(); ctx.ellipse(gx, gy, u * 0.3, u * 0.3 * Math.sin(cam.pitch), 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.save(); ctx.translate(sx, sy); drawPenguinFigure(ctx, u, v); ctx.restore();
    if (p.sink > 0.2) {                                       // 몸 둘레 수면선
      ctx.globalAlpha = 0.5;
      ctx.drawImage(getRingSprite(), sx - u * 0.45, sy - u * 0.45 * Math.sin(cam.pitch), u * 0.9, u * 0.9 * Math.sin(cam.pitch));
      ctx.globalAlpha = 1;
    }
  }

  // 반영: 같은 실루엣을 작은 캔버스에 그려 수면 기준으로 뒤집고, 위로 갈수록 흐리게, 띠별로 일렁이게
  const off = document.createElement('canvas'), og = off.getContext('2d');
  function drawReflection() {
    if (!(C.reflect.alpha > 0)) return;
    const p = S.p, u = penU(), v = penguinView();
    const [sx, sy] = project(p.x, p.y, p.z), [, wy] = project(p.x, p.y, 0);
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
      const dx = Math.sin(S.time * 5 + i * 0.9) * C.reflect.wobblePx * (0.3 + p.ripple * 1.7) * (0.4 + far);
      ctx.drawImage(off, 0, srcY * DPR, size * DPR, sh * DPR, -ox + dx, srcY - oy, size, sh + 0.6);
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

  // ── UI: 링 / 물갈퀴 발자국. 판정은 layout + hitRadius 만 사용 ──
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
    const A = C.ui.adapt, t = 1 - smooth(A.threshold[0], A.threshold[1], l);  // t=1 어두운 배경
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
    // 이동 링
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

    // 물갈퀴 발자국 (세 발가락이 막으로 이어짐)
    const A = C.ui.action, a = layout.action;
    let pressed = false;
    for (const ptr of pointers.values()) if (ptr.role === 'action') pressed = true;
    const sc = A.radius * (pressed ? 0.9 : 1) * (1 + S.tapPulse * 0.06);
    ctx.save(); ctx.translate(a.x, a.y + sc * 0.05); ctx.scale(sc, sc);
    ctx.fillStyle = uiColor(lum.action, pressed ? 1.5 : 1);
    ctx.beginPath();
    ctx.moveTo(0, 0.62);                                       // 뒤꿈치
    ctx.quadraticCurveTo(-0.22, 0.42, -0.62, -0.42);           // 왼쪽 발가락 끝
    ctx.quadraticCurveTo(-0.28, -0.28, -0.04, -0.78);          // 물갈퀴 → 가운데 발가락 끝
    ctx.lineTo(0.04, -0.78);
    ctx.quadraticCurveTo(0.28, -0.28, 0.62, -0.42);            // 물갈퀴 → 오른쪽 발가락 끝
    ctx.quadraticCurveTo(0.22, 0.42, 0, 0.62);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  function draw(dt) {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = COL.bg; ctx.fillRect(0, 0, W, H);
    drawFarRidges();
    drawChips();
    drawWater();
    drawReflection();
    drawFloe();
    drawIslandGround();
    drawMountains();
    drawPenguin();
    drawFish();
    drawUI(dt);
  }

  // ── 루프 ────────────────────────────────────────────────
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(1 / 30, Math.max(0, (now - last) / 1000));
    last = now;
    update(dt);
    draw(dt);
    requestAnimationFrame(frame);
  }

  resize();
  reset();
  requestAnimationFrame(frame);

  window.__game = { S, C, cam, layout, pointers, project, reset, screenDirToWorld, lum };
})();
