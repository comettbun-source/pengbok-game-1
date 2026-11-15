// 펭귄 탐험 — 첫 구간 프로토타입
// 그림은 전부 draw* 함수 안의 단색 도형. 판정(터치 영역·이동·지면)은 그림과 분리되어 있어
// 나중에 스프라이트로 바꿔도 layout / hit / surface 로직은 그대로 유지됨.
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
    bg: '#f3eee3', chip: 'rgba(170, 160, 140, 0.18)',
    floeTop: '#ffffff', floeSide: '#d9d5cc',
    rockTop: '#2b2b2e', rockSide: '#141416', snow: '#fbfaf7',
    black: '#1b1b1d', white: '#ffffff', beak: '#7a7a7a',
    ripple: '110, 122, 135', ui: '40, 40, 44',
  };

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const safeProbe = document.getElementById('safe');
  const finishEl = document.getElementById('finish');
  let W = 0, H = 0, DPR = 1, zoom = 30;
  const safe = { l: 0, r: 0, t: 0, b: 0 };
  const layout = { dpad: { x: 0, y: 0 }, action: { x: 0, y: 0 } };

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    const cs = getComputedStyle(safeProbe);
    safe.l = parseFloat(cs.paddingLeft) || 0; safe.r = parseFloat(cs.paddingRight) || 0;
    safe.t = parseFloat(cs.paddingTop) || 0; safe.b = parseFloat(cs.paddingBottom) || 0;
    const d = C.ui.dpad, a = C.ui.action;
    layout.dpad.x = safe.l + d.insetX + d.radius;
    layout.dpad.y = H - safe.b - d.insetY - d.radius;
    layout.action.x = W - safe.r - a.insetX - a.radius;
    layout.action.y = H - safe.b - a.insetY - a.radius;
    zoom = H / C.camera.viewHeight;
  }
  window.addEventListener('resize', resize);

  // ── 유틸 ────────────────────────────────────────────────
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const ease = (rate, dt) => 1 - Math.exp(-rate * dt);
  const deg = (d) => d * Math.PI / 180;
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

  // ── 상태 ────────────────────────────────────────────────
  const S = {};
  const cam = { x: 0, y: 0, yaw: 0, yawT: 0, pitch: 0, pitchT: 0 };

  function reset() {
    const w = C.world;
    S.time = 0; S.finished = false;
    S.floe = { x: 0, y: 0, vx: 0, vy: 0, bob: 0, dragDX: 0, dragDY: 0, dragging: 0,
      shape: blob(C.floe.radiusX, C.floe.radiusY, 14, 0.1, 7), lastWake: null };
    S.floe.R = Math.max(...S.floe.shape.map(([x, y]) => Math.hypot(x, y)));
    S.p = {
      x: 0, y: 0, z: 0.12, vx: 0, vy: 0, vz: 0, cvx: 0, cvy: 0,
      face: Math.PI / 2, mode: 'floe', lx: 0, ly: 0, air: false,
      slideT: 0, slideV: 0, slideDecel: 0, crouch: 0, sit: true, sink: 0,
      wobble: 0, phase: 0, idleRing: 0, lastWake: null,
    };
    S.islands = [1, -1].map((side, i) => {
      const cx = side * (w.islandDistance + w.islandHalfWidth);
      const shape = blob(w.islandHalfWidth, w.islandHalfLength, 40, 0.05, 31 + i).map(([x, y]) => [x + cx, y]);
      const snow = blob(w.islandHalfWidth * 0.72, w.islandHalfLength * 0.8, 30, 0.12, 77 + i).map(([x, y]) => [x + cx, y]);
      return { cx, cy: 0, rx: w.islandHalfWidth, ry: w.islandHalfLength, shape, snow };
    });
    S.ripples = []; S.wakes = []; S.drops = [];
    S.actionPending = false; S.actionT = 0;
    S.events = []; // 테스트용 로그 (jump / slide / splash / arrive)
    cam.x = 0; cam.y = 0; cam.yaw = cam.yawT = 0;
    cam.pitch = cam.pitchT = deg(C.camera.pitchDeg);
    finishEl.classList.remove('show');
  }
  const log = (type) => { S.events.push({ type, t: S.time }); if (S.events.length > 50) S.events.shift(); };

  // ── 투영 (지면 평면 + 높이, yaw 회전·pitch 기울기 직교 투영) ──
  function project(x, y, z = 0) {
    const dx = x - cam.x, dy = y - cam.y, c = Math.cos(cam.yaw), s = Math.sin(cam.yaw);
    const vx = c * dx - s * dy, vy = s * dx + c * dy;
    return [W / 2 + vx * zoom, H * C.camera.screenY + (vy * Math.sin(cam.pitch) - z * Math.cos(cam.pitch)) * zoom];
  }
  // 화면 방향(오른쪽 +x, 아래 +y) → 월드 방향. 카메라가 돌아가도 화면 기준 유지
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
    if (islandAt(x, y)) return { mode: 'island', z: C.world.islandHeight };
    if (onFloe(x, y, 0.95)) return { mode: 'floe', z: floeH() };
    return { mode: 'water', z: 0 };
  }

  // ── 물결 ────────────────────────────────────────────────
  function ring(x, y, maxR, life, alpha = 0.55, width = 1.6) {
    S.ripples.push({ x, y, t: 0, maxR, life, alpha, width });
  }
  function splash(x, y) {
    ring(x, y, 2.4, 1.3, 0.6, 1.8);
    for (let i = 0; i < 7; i++) {
      const a = Math.random() * Math.PI * 2, sp = 0.6 + Math.random() * 0.9;
      S.drops.push({ x, y, z: 0.1, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: 2.2 + Math.random() * 1.4 });
    }
    log('splash');
  }
  // V자 꼬리 물결: 이동 방향의 수직 벡터를 함께 저장, 시간이 지나며 벌어지고 흐려짐
  function emitWake(owner, x, y, dirx, diry, spacing, w0, spread, life, alpha) {
    const last = owner.lastWake;
    if (last && Math.hypot(x - last.x, y - last.y) < spacing) return;
    const pt = { x, y, px: -diry, py: dirx, t: 0, w0, spread, life, alpha, link: last && S.time - last.born < 0.4 ? last : null, born: S.time };
    owner.lastWake = pt; S.wakes.push(pt);
  }

  // ── 입력 ────────────────────────────────────────────────
  const pointers = new Map();   // pointerId → { role, x, y }
  const keys = new Set();

  function pickRole(x, y) {
    const d = layout.dpad, a = layout.action;
    if (Math.hypot(x - d.x, y - d.y) <= C.ui.dpad.hitRadius) return 'dpad';
    if (Math.hypot(x - a.x, y - a.y) <= C.ui.action.hitRadius) return 'action';
    const p = S.p;
    if (p.mode === 'floe' && !p.air) {
      const u = zoom * C.penguin.height;
      const [sx, sy] = project(p.x, p.y, p.z);
      if (Math.hypot(x - sx, y - (sy - u * 0.45)) <= Math.max(C.input.penguinHitPx, u * 0.9)) return 'drag';
    }
    return 'camera';
  }

  let triedFullscreen = false;
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (C.fullscreenOnFirstTouch && !triedFullscreen && e.pointerType === 'touch') {
      triedFullscreen = true;
      const el = document.documentElement;
      if (el.requestFullscreen) el.requestFullscreen().then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape')).catch(() => {});
    }
    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
    const role = pickRole(e.clientX, e.clientY);
    pointers.set(e.pointerId, { role, x: e.clientX, y: e.clientY });
    if (role === 'action') actionDown();
    if (role === 'drag') S.floe.dragging++;
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
  function release(id) {
    const ptr = pointers.get(id);
    if (!ptr) return;
    if (ptr.role === 'drag') S.floe.dragging = Math.max(0, S.floe.dragging - 1);
    pointers.delete(id);
  }
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((t) => canvas.addEventListener(t, (e) => release(e.pointerId)));
  function releaseAll() { [...pointers.keys()].forEach(release); keys.clear(); }
  window.addEventListener('blur', releaseAll);
  document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAll(); });
  window.addEventListener('pagehide', releaseAll);
  ['contextmenu', 'gesturestart', 'dblclick'].forEach((t) => document.addEventListener(t, (e) => e.preventDefault()));

  document.getElementById('reset').addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); releaseAll(); reset(); });

  // 데스크톱 디버깅용 키보드: 방향키/WASD 이동, Space 점프(두 번 = 슬라이딩)
  const KEYMAP = { ArrowLeft: 'l', a: 'l', ArrowRight: 'r', d: 'r', ArrowUp: 'u', w: 'u', ArrowDown: 'dn', s: 'dn' };
  window.addEventListener('keydown', (e) => {
    if (e.key === ' ') { if (!e.repeat) actionDown(); e.preventDefault(); return; }
    const k = KEYMAP[e.key] || KEYMAP[e.key.toLowerCase && e.key.toLowerCase()];
    if (k) { keys.add(k); e.preventDefault(); }
  });
  window.addEventListener('keyup', (e) => { const k = KEYMAP[e.key] || KEYMAP[e.key.toLowerCase && e.key.toLowerCase()]; if (k) keys.delete(k); });

  // D패드 입력: 화면 기준 벡터 (크기 0~1)
  function readMove() {
    let mx = 0, my = 0;
    const d = C.ui.dpad;
    for (const ptr of pointers.values()) {
      if (ptr.role !== 'dpad') continue;
      const dx = ptr.x - layout.dpad.x, dy = ptr.y - layout.dpad.y, len = Math.hypot(dx, dy);
      if (len > d.releaseRadius || len < 1e-3) break;             // 너무 멀리 나가면 입력 해제
      const m = clamp((len / d.radius - d.deadZone) / (d.fullAt - d.deadZone), 0, 1);
      mx = (dx / len) * m; my = (dy / len) * m;
      break;                                                     // 이동 손가락은 하나만
    }
    if (keys.size) {
      let kx = (keys.has('r') ? 1 : 0) - (keys.has('l') ? 1 : 0), ky = (keys.has('dn') ? 1 : 0) - (keys.has('u') ? 1 : 0);
      const l = Math.hypot(kx, ky);
      if (l) { mx = kx / l; my = ky / l; }
    }
    return [mx, my];
  }

  // 점프/슬라이딩: 첫 터치 → 즉시 웅크림, doubleTapMs 안에 두 번째 터치 → 바로 슬라이딩(점프 취소)
  //               시간이 지나도록 두 번째가 없으면 → 점프
  function canAct() { return !S.p.air && S.p.slideT <= 0; }
  function actionDown() {
    const now = performance.now();
    if (S.actionPending && now - S.actionT <= C.input.doubleTapMs) {
      S.actionPending = false;
      doSlide();
      return;
    }
    if (!canAct()) return;
    S.actionPending = true; S.actionT = now;
  }
  function doJump() {
    const p = S.p;
    if (!canAct()) return;
    p.air = true; p.sit = false;
    p.vz = Math.sqrt(2 * C.jump.gravity * C.jump.height);
    p.cvx = p.mode === 'floe' ? S.floe.vx : 0; p.cvy = p.mode === 'floe' ? S.floe.vy : 0;
    if (p.mode === 'water') ring(p.x, p.y, 1.2, 0.8, 0.4);
    log('jump');
  }
  function doSlide() {
    const p = S.p;
    if (!canAct()) return;
    p.sit = false;
    const v = (2 * C.slide.distance) / C.slide.duration;
    p.slideT = C.slide.duration; p.slideV = v; p.slideDecel = v / C.slide.duration;
    log('slide');
  }

  // ── 업데이트 ────────────────────────────────────────────
  function update(dt) {
    S.time += dt;
    const p = S.p, f = S.floe;
    if (S.actionPending && performance.now() - S.actionT > C.input.doubleTapMs) { S.actionPending = false; doJump(); }

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
      emitWake(f, f.x - dx * f.R * 0.85, f.y - dy * f.R * 0.85, dx, dy, 0.25, f.R * 0.5, 0.9, 2.4, clamp(fsp / 3, 0.2, 0.7));
    } else f.lastWake = null;

    // 펭귄 이동
    const [mx, my] = readMove();
    const [wx, wy] = screenDirToWorld(mx, my);
    const mag = Math.hypot(mx, my);
    const maxSp = p.mode === 'water' ? C.move.swimSpeed : C.move.walkSpeed;
    if (mag > 0.01) {
      p.sit = false;
      const target = Math.atan2(wy, wx);
      let dA = ((target - p.face + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      if (p.slideT <= 0) p.face += dA * ease(C.move.turnRate, dt);
    }
    if (p.slideT > 0) {
      p.slideV = Math.max(0, p.slideV - p.slideDecel * dt);
      p.vx = Math.cos(p.face) * p.slideV; p.vy = Math.sin(p.face) * p.slideV;
      p.slideT -= dt;
      if (p.slideT <= 0) { p.slideT = 0; p.vx = p.vy = 0; }
    } else {
      const k = ease(C.move.accel, dt) * (p.air ? C.move.airControl : 1);
      p.vx += (wx * maxSp - p.vx) * k; p.vy += (wy * maxSp - p.vy) * k;
    }

    if (p.mode === 'floe' && !p.air) {
      p.lx += p.vx * dt; p.ly += p.vy * dt;
      p.x = f.x + p.lx; p.y = f.y + p.ly;
    } else {
      p.x += (p.vx + (p.air ? p.cvx : 0)) * dt; p.y += (p.vy + (p.air ? p.cvy : 0)) * dt;
    }

    // 지면 전환
    if (p.air) {
      p.vz -= C.jump.gravity * dt; p.z += p.vz * dt;
      const s = surfaceAt(p.x, p.y);
      if (p.vz < 0 && p.z <= s.z) {
        p.air = false; p.z = s.z; p.vz = 0;
        setMode(s.mode, true);
      }
    } else if (p.mode === 'floe') {
      if (!onFloe(p.x, p.y)) setMode(islandAt(p.x, p.y) ? 'island' : 'water');
    } else if (p.mode === 'water') {
      if (islandAt(p.x, p.y)) setMode('island');
      else if (onFloe(p.x, p.y, 0.88)) setMode('floe');
    } else if (p.mode === 'island') {
      if (!islandAt(p.x, p.y)) setMode(onFloe(p.x, p.y) ? 'floe' : 'water');
    }
    if (!p.air) {
      const tz = p.mode === 'island' ? C.world.islandHeight : p.mode === 'floe' ? floeH() : 0;
      p.z += (tz - p.z) * ease(14, dt);
    }

    // 애니메이션 값
    const sp = Math.hypot(p.vx, p.vy);
    p.sink += ((p.mode === 'water' && !p.air ? C.penguin.swimSink : 0) - p.sink) * ease(8, dt);
    p.crouch += ((S.actionPending ? 1 : 0) - p.crouch) * ease(30, dt);
    if (!p.air && p.mode !== 'water' && p.slideT <= 0 && sp > 0.15) {
      p.phase += sp * dt * C.penguin.walkWobbleFreq;
      p.wobble = Math.sin(p.phase) * deg(C.penguin.walkWobbleDeg) * Math.min(1, sp / C.move.walkSpeed);
    } else p.wobble *= Math.exp(-10 * dt);
    if (p.mode === 'water' && !p.air) {
      if (sp > 0.3) emitWake(p, p.x - Math.cos(p.face) * 0.2, p.y - Math.sin(p.face) * 0.2, p.vx / sp, p.vy / sp, 0.18, 0.08, 0.5, 1.6, 0.45);
      else { p.lastWake = null; p.idleRing -= dt; if (p.idleRing <= 0) { ring(p.x, p.y, 0.9, 1.6, 0.25, 1.1); p.idleRing = 1.6; } }
    } else p.lastWake = null;

    // 카메라: 펭귄을 화면 중앙 부근에 부드럽게
    const tvx = p.vx + (p.mode === 'floe' && !p.air ? f.vx : 0), tvy = p.vy + (p.mode === 'floe' && !p.air ? f.vy : 0);
    const kc = ease(C.camera.followRate, dt);
    cam.x += (p.x + tvx * C.camera.lead - cam.x) * kc;
    cam.y += (p.y + tvy * C.camera.lead - cam.y) * kc;
    const kr = ease(C.camera.rotateSmooth, dt);
    cam.yaw += (cam.yawT - cam.yaw) * kr;
    cam.pitch += (cam.pitchT - cam.pitch) * kr;

    // 물결 수명
    S.ripples = S.ripples.filter((r) => (r.t += dt) < r.life);
    S.wakes = S.wakes.filter((w) => (w.t += dt) < w.life);
    S.drops = S.drops.filter((d) => { d.vz -= 14 * dt; d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt; return d.z > 0; });
  }

  function setMode(mode, landed = false) {
    const p = S.p, prev = p.mode;
    p.mode = mode;
    if (mode === 'floe') { p.lx = p.x - S.floe.x; p.ly = p.y - S.floe.y; }
    if (mode === 'water' && (prev !== 'water' || landed)) { splash(p.x, p.y); if (!landed) p.z -= 0.15; }
    if (mode !== 'water' && prev === 'water' && !landed) ring(p.x, p.y, 1.0, 0.9, 0.4);
    if (mode === 'island' && !S.finished) {
      S.finished = true; log('arrive');
      finishEl.classList.add('show');
    }
  }

  // ── 그리기 ──────────────────────────────────────────────
  function polyPath(pts, z, ox = 0, oy = 0) {
    ctx.beginPath();
    pts.forEach(([x, y], i) => { const [sx, sy] = project(x + ox, y + oy, z); i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy); });
    ctx.closePath();
  }
  function groundEllipse(x, y, z, r) {
    const [sx, sy] = project(x, y, z);
    ctx.beginPath(); ctx.ellipse(sx, sy, r * zoom, r * zoom * Math.sin(cam.pitch), 0, 0, Math.PI * 2);
  }

  // 먼 배경 조각: 시차 0.55 로 천천히, 카메라와 반대로 흐름 (무한 타일)
  const CHIPS = (() => { const r = rng(5); return Array.from({ length: 70 }, () => [r() * 48, r() * 48, 0.04 + r() * 0.1]); })();
  function drawChips() {
    const T = 48, par = 0.55, c = Math.cos(cam.yaw), s = Math.sin(cam.yaw);
    ctx.fillStyle = COL.chip;
    for (const [cx, cy, r] of CHIPS) {
      let dx = ((cx - cam.x * par) % T + T * 1.5) % T - T / 2;
      let dy = ((cy - cam.y * par) % T + T * 1.5) % T - T / 2;
      const vx = c * dx - s * dy, vy = s * dx + c * dy;
      const sx = W / 2 + vx * zoom * 0.7, sy = H * C.camera.screenY + vy * Math.sin(cam.pitch) * zoom * 0.7;
      ctx.beginPath(); ctx.ellipse(sx, sy, r * zoom * 1.6, r * zoom * Math.sin(cam.pitch), 0, 0, Math.PI * 2); ctx.fill();
    }
  }

  function drawWater() {
    for (const r of S.ripples) {
      const k = r.t / r.life, rad = 0.2 + (r.maxR - 0.2) * (1 - Math.pow(1 - k, 2.2));
      ctx.strokeStyle = `rgba(${COL.ripple}, ${(1 - k) * r.alpha})`; ctx.lineWidth = r.width;
      groundEllipse(r.x, r.y, 0, rad); ctx.stroke();
    }
    ctx.lineCap = 'round';
    for (const w of S.wakes) {
      if (!w.link) continue;
      const a = (1 - w.t / w.life) * w.alpha;
      if (a <= 0.01) continue;
      ctx.strokeStyle = `rgba(${COL.ripple}, ${a})`; ctx.lineWidth = 1.2;
      for (const side of [1, -1]) {
        const o1 = (w.w0 + w.t * w.spread) * side, o0 = (w.link.w0 + w.link.t * w.link.spread) * side;
        const [x1, y1] = project(w.x + w.px * o1, w.y + w.py * o1, 0);
        const [x0, y0] = project(w.link.x + w.link.px * o0, w.link.y + w.link.py * o0, 0);
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      }
    }
    ctx.fillStyle = `rgba(${COL.ripple}, 0.5)`;
    for (const d of S.drops) { const [sx, sy] = project(d.x, d.y, d.z); ctx.beginPath(); ctx.arc(sx, sy, 1.6, 0, Math.PI * 2); ctx.fill(); }
  }

  function drawFloe() {
    const f = S.floe, top = floeH();
    ctx.fillStyle = COL.floeSide; polyPath(f.shape, -0.18, f.x, f.y); ctx.fill();
    ctx.fillStyle = COL.floeTop; polyPath(f.shape, top, f.x, f.y); ctx.fill();
  }
  function drawIslands() {
    const h = C.world.islandHeight;
    for (const is of S.islands) {
      ctx.fillStyle = COL.rockSide; polyPath(is.shape, -0.1); ctx.fill();
      ctx.fillStyle = COL.rockTop; polyPath(is.shape, h); ctx.fill();
      ctx.fillStyle = COL.snow; polyPath(is.snow, h + 0.01); ctx.fill();
    }
  }

  function drawPenguin() {
    const p = S.p, u = zoom * C.penguin.height;
    const c = Math.cos(cam.yaw), s = Math.sin(cam.yaw);
    const fx = Math.cos(p.face), fy = Math.sin(p.face);
    const fvx = c * fx - s * fy, fvy = s * fx + c * fy;      // 화면 기준 바라보는 방향
    const [gx, gy] = project(p.x, p.y, p.air ? surfaceAt(p.x, p.y).z : p.z);
    const [sx, sy] = project(p.x, p.y, p.z);

    if (p.mode !== 'water' || p.air) {                       // 그림자
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.beginPath(); ctx.ellipse(gx, gy, u * 0.3, u * 0.3 * Math.sin(cam.pitch), 0, 0, Math.PI * 2); ctx.fill();
    }

    ctx.save();
    ctx.translate(sx, sy);
    if (p.sink > 0.01) {                                      // 수영: 수면 아래는 잘라내고 수면선 표시
      ctx.beginPath(); ctx.rect(-u * 2, -u * 3, u * 4, u * 3); ctx.clip();
      ctx.translate(0, p.sink * u + Math.sin(S.time * 3) * u * 0.03);
    }

    if (p.slideT > 0) {                                      // 배 슬라이딩: 진행 방향으로 납작하게
      const ang = Math.atan2(fvy * Math.sin(cam.pitch), fvx);
      ctx.rotate(ang);
      ctx.fillStyle = COL.black; ctx.beginPath(); ctx.ellipse(0, -u * 0.12, u * 0.55, u * 0.2, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = COL.white; ctx.beginPath(); ctx.ellipse(-u * 0.02, -u * 0.06, u * 0.42, u * 0.1, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = COL.white; ctx.beginPath(); ctx.arc(u * 0.38, -u * 0.18, u * 0.035, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.rotate(p.wobble);
      const squash = p.sit ? 0.22 : p.crouch * C.jump.crouchDepth - (p.air && p.vz > 0 ? 0.08 : 0);
      ctx.scale(1 + squash * 0.6, 1 - squash);
      // 몸
      ctx.fillStyle = COL.black;
      ctx.beginPath(); ctx.ellipse(0, -u * 0.5, u * 0.3, u * 0.5, 0, 0, Math.PI * 2); ctx.fill();
      // 배 (정면일수록 넓게, 옆이면 그쪽으로 치우침)
      const bw = u * 0.22 * clamp(0.3 + 0.7 * fvy, 0, 1);
      if (bw > 0.5) {
        ctx.fillStyle = COL.white;
        ctx.beginPath(); ctx.ellipse(fvx * u * 0.1, -u * 0.4, bw, u * 0.34, 0, 0, Math.PI * 2); ctx.fill();
      }
      // 눈·부리
      if (fvy > -0.35) {
        ctx.fillStyle = COL.white;
        for (const e of [-1, 1]) {
          const ex = fvx * u * 0.16 + e * u * 0.09 * Math.max(0.15, fvy);
          ctx.beginPath(); ctx.arc(ex, -u * 0.8, u * 0.04, 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = COL.beak;
        const bx = fvx * u * 0.24;
        ctx.beginPath(); ctx.moveTo(bx - u * 0.05, -u * 0.74); ctx.lineTo(bx + fvx * u * 0.12, -u * 0.71); ctx.lineTo(bx - u * 0.05, -u * 0.68); ctx.fill();
      }
    }
    ctx.restore();

    if (p.sink > 0.2) {                                       // 수면선 고리
      ctx.strokeStyle = `rgba(${COL.ripple}, 0.45)`; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.ellipse(sx, sy, u * 0.36, u * 0.36 * Math.sin(cam.pitch), 0, 0, Math.PI * 2); ctx.stroke();
    }
  }

  // 발바닥 모양 UI. 판정은 layout + hitRadius 로만 결정되므로 그림을 바꿔도 터치 영역은 그대로
  function drawUI() {
    const op = C.ui.opacity;
    const d = layout.dpad, R = C.ui.dpad.radius;
    let active = null;
    for (const ptr of pointers.values()) if (ptr.role === 'dpad') { active = ptr; break; }
    const [mx, my] = readMove();
    ctx.fillStyle = `rgba(${COL.ui}, ${op * 0.35})`;
    ctx.beginPath(); ctx.arc(d.x, d.y, R, 0, Math.PI * 2); ctx.fill();
    // 가운데 큰 패드 + 네 방향 발가락
    ctx.fillStyle = `rgba(${COL.ui}, ${op})`;
    ctx.beginPath(); ctx.ellipse(d.x + mx * R * 0.25, d.y + my * R * 0.25, R * 0.34, R * 0.3, 0, 0, Math.PI * 2); ctx.fill();
    for (const [ax, ay] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const on = ax * mx + ay * my > 0.5;
      ctx.fillStyle = `rgba(${COL.ui}, ${on ? Math.min(1, op * 2) : op})`;
      ctx.beginPath(); ctx.ellipse(d.x + ax * R * 0.72, d.y + ay * R * 0.72, R * (ax ? 0.16 : 0.2), R * (ax ? 0.2 : 0.16), 0, 0, Math.PI * 2); ctx.fill();
    }
    if (active) {
      ctx.strokeStyle = `rgba(${COL.ui}, ${op})`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(d.x, d.y, R, 0, Math.PI * 2); ctx.stroke();
    }

    const a = layout.action, r = C.ui.action.radius * (S.actionPending || S.p.crouch > 0.5 ? 0.92 : 1);
    ctx.fillStyle = `rgba(${COL.ui}, ${op * 0.35})`;
    ctx.beginPath(); ctx.arc(a.x, a.y, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = `rgba(${COL.ui}, ${op})`;
    ctx.beginPath(); ctx.ellipse(a.x, a.y + r * 0.18, r * 0.36, r * 0.3, 0, 0, Math.PI * 2); ctx.fill();
    for (const [tx, ty] of [[-0.42, -0.2], [-0.15, -0.45], [0.15, -0.45], [0.42, -0.2]]) {
      ctx.beginPath(); ctx.ellipse(a.x + tx * r, a.y + ty * r, r * 0.12, r * 0.15, tx * 0.6, 0, Math.PI * 2); ctx.fill();
    }
  }

  function draw() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = COL.bg; ctx.fillRect(0, 0, W, H);
    drawChips();
    drawWater();
    drawFloe();
    drawIslands();
    drawPenguin();
    drawUI();
  }

  // ── 루프 ────────────────────────────────────────────────
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(1 / 30, Math.max(0, (now - last) / 1000));
    last = now;
    update(dt);
    draw();
    requestAnimationFrame(frame);
  }

  resize();
  reset();
  requestAnimationFrame(frame);

  // 테스트·디버깅용
  window.__game = { S, C, cam, layout, pointers, project, reset, screenDirToWorld };
})();
