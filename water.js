// 물 엔진 — 높이장(heightfield) 파동 시뮬레이션. 게임 코드와 독립 (window.WaterSim)
//
// 참고한 방식
//  · Evan Wallace "WebGL Water": 물체가 지나간 자리(이전 부피 − 새 부피)만큼 수면을 밀고, 이웃 평균으로 끌려가는 파동
//  · Matthias Müller "Height Field Water": 칸마다 물기둥 높이·속도, 물체가 차지한 높이의 변화량을 물에 돌려줘 부피 보존
//  · 얕은 물 파동: 파속² ∝ 수심 → 해안으로 갈수록 느려지고 스러짐
//
// 한 칸의 상태: h(수면 높이 편차, 월드 단위) · v(세로 속도)
//   a   = k · ∇²(h + τ·v)            k = 수심 계수(0~1), τ = 점성(잔 떨림 제거)
//   a'  = a + β·∇²a                  분산: 짧은 파장은 느리게 → 퍼질수록 링 간격이 벌어짐
//   v  += (c/dx)² · a' · dt ;  v *= e^(−감쇠·dt) ;  h += v·dt
// 격자는 월드에 고정된 칸을 정수 칸 단위로 밀어(스크롤) 펭귄을 따라간다.
(function () {
  'use strict';
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

  function create(cfg) {
    const N = cfg.grid, dx = cfg.size / N, n = N * N;
    const h = new Float32Array(n), v = new Float32Array(n), a = new Float32Array(n), tmp = new Float32Array(n);
    const k = new Float32Array(n).fill(1);          // 수심 계수: 0 = 뭍, 1 = 깊은 바다
    const solid = new Uint8Array(n);                // 빙하처럼 물결을 되튕기는 칸
    const edge = new Float32Array(n);               // 격자 가장자리 흡수대: 0(끝) → 1(안쪽)
    const shade = new Float32Array(n);              // 그리기용: 빛 방향 기울기 (부호 있음)
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const d = Math.min(i, j, N - 1 - i, N - 1 - j);
      edge[j * N + i] = smooth(0, cfg.edgeCells, d);
    }
    const sim = { N, dx, ox: 0, oy: 0, h, v, k, solid, edge, shade, ready: false, maxShade: 0, bodies: [] };

    // new[i,j] = old[i+sx, j+sy]
    function shift(arr, sx, sy, fill) {
      tmp.set(arr);
      for (let j = 0; j < N; j++) {
        const sj = j + sy, row = j * N;
        if (sj < 0 || sj >= N) { arr.fill(fill, row, row + N); continue; }
        for (let i = 0; i < N; i++) { const si = i + sx; arr[row + i] = si < 0 || si >= N ? fill : tmp[sj * N + si]; }
      }
    }
    const wx = (i) => (sim.ox + i + 0.5) * dx, wy = (j) => (sim.oy + j + 0.5) * dx;
    function fillTerrain(depthFn) {
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const q = j * N + i;
        if (k[q] < 0) k[q] = clamp(depthFn(wx(i), wy(j)) / cfg.shallowRef, 0, 1);
      }
    }
    // 격자 중심을 (cx, cy) 근처로. 한 칸 이상 벗어나면 칸 단위로 민다
    sim.recenter = function (cx, cy, depthFn) {
      const nox = Math.round(cx / dx - N / 2), noy = Math.round(cy / dx - N / 2);
      if (!sim.ready) { sim.ox = nox; sim.oy = noy; k.fill(-1); fillTerrain(depthFn); sim.ready = true; return; }
      const sx = nox - sim.ox, sy = noy - sim.oy;
      if (!sx && !sy) return;
      sim.ox = nox; sim.oy = noy;
      if (Math.abs(sx) >= N || Math.abs(sy) >= N) { h.fill(0); v.fill(0); k.fill(-1); }
      else { shift(h, sx, sy, 0); shift(v, sx, sy, 0); shift(k, sx, sy, -1); }
      fillTerrain(depthFn);
    };

    // ── 물체 ────────────────────────────────────────────────
    // st = { x, y, rx, ry, zc, rz }            타원체 (펭귄): 수면(z=0) 아래 잠긴 길이
    //    | { x, y, rx, ry, draft, solid:true } 납작한 판 (빙하): 잠긴 깊이 draft, 가장자리는 완만
    // 같은 key 로 매 단계 불러 주면 이전 상태와의 차이만큼 물을 민다. st = null 이면 추적 끊기
    const subAt = (s, px, py) => {
      const ux = (px - s.x) / s.rx, uy = (py - s.y) / s.ry, q2 = ux * ux + uy * uy;
      if (q2 >= 1) return 0;
      if (s.draft !== undefined) return s.draft * (1 - smooth(0.72, 1, Math.sqrt(q2)));
      const hz = s.rz * Math.sqrt(1 - q2);
      return clamp(hz - s.zc, 0, 2 * hz);
    };
    sim.begin = function () { solid.fill(0); sim.bodies.length = 0; };
    sim.body = function (key, st) {
      if (!st) { key._w = null; return; }
      const prev = key._w;
      key._w = Object.assign(key._w2 || {}, st); key._w2 = prev || {};      // 두 상태 객체를 번갈아 재사용
      if (st.solid) {                                                        // 되튕김 마스크
        const i0 = Math.max(0, Math.floor((st.x - st.rx) / dx - sim.ox)), i1 = Math.min(N - 1, Math.ceil((st.x + st.rx) / dx - sim.ox));
        const j0 = Math.max(0, Math.floor((st.y - st.ry) / dx - sim.oy)), j1 = Math.min(N - 1, Math.ceil((st.y + st.ry) / dx - sim.oy));
        const m = cfg.body.solidInset;
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
          const ux = (wx(i) - st.x) / (st.rx * m), uy = (wy(j) - st.y) / (st.ry * m);
          if (ux * ux + uy * uy < 1) solid[j * N + i] = 1;
        }
      }
      if (prev && Math.hypot(prev.x - st.x, prev.y - st.y) < Math.min(st.rx, st.ry)) sim.bodies.push(key);   // 순간이동은 무시
    };
    function displace(key) {
      const cur = key._w, prev = key._w2, B = cfg.body, g = B.gain;
      const disc = cur.draft !== undefined, rmin = Math.min(cur.rx, cur.ry);
      const q0 = disc ? 1 : B.ring[0], q1 = disc ? 1 + B.floeRing / rmin : B.ring[1];   // 밀려난 물이 솟는 고리 (정규화 반지름)
      const ex = cur.rx * q1 + Math.abs(cur.x - prev.x) + dx, ey = cur.ry * q1 + Math.abs(cur.y - prev.y) + dx;
      const i0 = Math.max(0, Math.floor((cur.x - ex) / dx - sim.ox)), i1 = Math.min(N - 1, Math.ceil((cur.x + ex) / dx - sim.ox));
      const j0 = Math.max(0, Math.floor((cur.y - ey) / dx - sim.oy)), j1 = Math.min(N - 1, Math.ceil((cur.y + ey) / dx - sim.oy));
      if (i1 < i0 || j1 < j0) return;
      let T = 0, Wsum = 0;
      const qm = (q0 + q1) / 2, qh = (q1 - q0) / 2;
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const q = j * N + i, px = wx(i), py = wy(j);
        const kk = disc ? 1 : k[q];                                          // 얕은 곳에선 몸이 덜 잠김
        const d = clamp((subAt(cur, px, py) - subAt(prev, px, py)) * kk * g, -B.maxStep, B.maxStep);
        if (d !== 0) { T += d; if (!solid[q] && k[q] > 0) h[q] -= d; }
        if (solid[q] || k[q] <= 0) { tmp[q] = 0; continue; }
        const ux = (px - cur.x) / cur.rx, uy = (py - cur.y) / cur.ry, t = (Math.sqrt(ux * ux + uy * uy) - qm) / qh;
        const w = t > -1 && t < 1 ? (1 - t * t) * (1 - t * t) : 0;
        tmp[q] = w; Wsum += w;
      }
      if (Wsum <= 0 || Math.abs(T) < 1e-7) return;
      const s = T / Wsum;                                                    // 꺼진 만큼 둘레가 솟음 → 부피 보존
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const q = j * N + i; if (tmp[q]) h[q] += tmp[q] * s; }
    }

    // 물방울·충격: 가운데가 amp 만큼 솟고(음수면 꺼지고) 둘레가 반대로 → 부피 0
    sim.drop = function (x, y, r, amp) {
      const R = r * 2, i0 = Math.max(0, Math.floor((x - R) / dx - sim.ox)), i1 = Math.min(N - 1, Math.ceil((x + R) / dx - sim.ox));
      const j0 = Math.max(0, Math.floor((y - R) / dx - sim.oy)), j1 = Math.min(N - 1, Math.ceil((y + R) / dx - sim.oy));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const q = j * N + i; if (solid[q] || k[q] <= 0) continue;
        const d = Math.hypot(wx(i) - x, wy(j) - y);
        const b1 = d < r ? 0.5 + 0.5 * Math.cos(Math.PI * d / r) : 0, b2 = d < R ? 0.5 + 0.5 * Math.cos(Math.PI * d / R) : 0;
        h[q] += amp * (b1 - 0.25 * b2);
      }
    };

    // ── 적분 ────────────────────────────────────────────────
    sim.step = function (dt) {
      for (const b of sim.bodies) displace(b);
      const cour = Math.min(cfg.waveSpeed * dt / dx, 0.68);                  // 안정 조건 c·dt/dx < 1/√2
      const c2 = cour * cour / dt;                                           // (c/dx)²·dt
      const tau = Math.min(cfg.viscosity, 0.2 * dt / (cour * cour));         // 양해법 안정 한계
      const beta = 0.125 * clamp(cfg.dispersion, 0, 1);
      // 1) a = k · ∇²(h + τv)   — 막힌 칸·격자 밖은 거울(자기 값)로 → 되튕김
      for (let j = 0; j < N; j++) {
        const row = j * N;
        for (let i = 0; i < N; i++) {
          const q = row + i;
          if (solid[q] || k[q] <= 0) { a[q] = 0; continue; }
          const c = h[q] + tau * v[q];
          let s = -4 * c, m;
          m = q - 1; s += i > 0 && !solid[m] ? h[m] + tau * v[m] : c;
          m = q + 1; s += i < N - 1 && !solid[m] ? h[m] + tau * v[m] : c;
          m = q - N; s += j > 0 && !solid[m] ? h[m] + tau * v[m] : c;
          m = q + N; s += j < N - 1 && !solid[m] ? h[m] + tau * v[m] : c;
          a[q] = s * k[q];
        }
      }
      // 2) 분산 + 속도·높이 갱신
      const dmp = cfg.damping, eD = cfg.edgeDamping, sD = cfg.shoreAbsorb, rest = Math.exp(-cfg.restore * dt);
      for (let j = 0; j < N; j++) {
        const row = j * N;
        for (let i = 0; i < N; i++) {
          const q = row + i;
          if (solid[q]) { h[q] = 0; v[q] = 0; continue; }
          const kk = k[q];
          if (kk <= 0) { h[q] *= 0.8; v[q] = 0; continue; }
          let acc = a[q];
          if (beta > 0) {
            const c = acc; let s = -4 * c, m;
            m = q - 1; s += i > 0 && !solid[m] ? a[m] : c;
            m = q + 1; s += i < N - 1 && !solid[m] ? a[m] : c;
            m = q - N; s += j > 0 && !solid[m] ? a[m] : c;
            m = q + N; s += j < N - 1 && !solid[m] ? a[m] : c;
            acc += beta * s;
          }
          let nv = v[q] + c2 * acc;
          nv *= Math.exp(-(dmp + (1 - edge[q]) * eD + (1 - kk) * sD) * dt);
          v[q] = nv;
        }
      }
      for (let q = 0; q < n; q++) if (!solid[q] && k[q] > 0) h[q] = (h[q] + v[q] * dt) * rest;
    };

    // ── 읽기 ────────────────────────────────────────────────
    function bil(arr, x, y) {
      const gx = x / dx - sim.ox - 0.5, gy = y / dx - sim.oy - 0.5;
      if (gx < 0 || gy < 0 || gx >= N - 1 || gy >= N - 1) return 0;
      const i = gx | 0, j = gy | 0, fx = gx - i, fy = gy - j, q = j * N + i;
      return (arr[q] * (1 - fx) + arr[q + 1] * fx) * (1 - fy) + (arr[q + N] * (1 - fx) + arr[q + N + 1] * fx) * fy;
    }
    sim.sample = (x, y) => bil(h, x, y);
    // 물체 둘레(타원 rx, ry) 8점 평균 높이 — 물체가 물결을 타고 오르내리게
    sim.around = function (x, y, rx, ry) {
      let s = 0;
      for (let t = 0; t < 8; t++) { const an = t * 0.7854; s += bil(h, x + Math.cos(an) * rx, y + Math.sin(an) * ry); }
      return s / 8;
    };
    // 그리기용 명암 필드: 빛(lx, ly) 쪽으로 기운 면은 +, 반대는 −
    sim.computeShade = function (lx, ly) {
      let mx = 0; const inv = 0.5 / dx;
      for (let j = 1; j < N - 1; j++) {
        const row = j * N;
        for (let i = 1; i < N - 1; i++) {
          const q = row + i;
          if (solid[q] || k[q] <= 0) { shade[q] = 0; continue; }
          const s = -((h[q + 1] - h[q - 1]) * lx + (h[q + N] - h[q - N]) * ly) * inv * edge[q] * Math.min(1, k[q] * 3);
          shade[q] = s; const as = s < 0 ? -s : s; if (as > mx) mx = as;
        }
      }
      sim.maxShade = mx;
    };
    sim.shadeAt = (x, y) => bil(shade, x, y);
    sim.reset = function () { h.fill(0); v.fill(0); sim.ready = false; };
    return sim;
  }

  const api = { create };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.WaterSim = api;
})();
