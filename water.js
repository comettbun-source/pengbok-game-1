// 물 엔진 — 높이장(heightfield) 파동 시뮬레이션. 게임 코드와 독립 (window.WaterSim)
//
// 참고한 방식
//  · Evan Wallace "WebGL Water": 물체가 지나간 자리(이전 부피 − 새 부피)만큼 수면을 밀고, 이웃 평균으로 끌려가는 파동
//  · Matthias Müller "Height Field Water": 칸마다 물기둥 높이·속도, 물체가 차지한 높이의 변화량을 물에 돌려줘 부피 보존
//  · 얕은 물 파동(Fluid Flux 류): 파속² ∝ 수심 → 해안으로 갈수록 느려지고, 땅 높이보다 수면이 높은 칸만 젖음(젖음/마름 경계)
//
// 한 칸의 상태: h(수면 높이, 월드 단위. 뭍에서는 땅 높이 E 이상) · v(세로 속도)
//   a   = ∇·(k ∇(h + τ·v))           k = 수심 계수(0~1), τ = 점성(잔 떨림 제거). 얕아질수록 느려지고 높아짐
//   a'  = a + β·∇²a                  분산: 짧은 파장은 느리게 → 퍼질수록 링 간격이 벌어짐
//   v  += (c/dx)² · a' · dt ;  v *= e^(−감쇠·dt) ;  h += v·dt
// 해안: 뭍 칸은 h ≥ E. 이웃 수면이 내 땅보다 높으면 물이 올라오고(젖음), 낮아지면 빠짐(마름)
// 격자는 월드에 고정된 칸을 정수 칸 단위로 밀어(스크롤) 펭귄을 따라간다.
(function () {
  'use strict';
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

  function create(cfg) {
    const N = cfg.grid, dx = cfg.size / N, n = N * N, SH = cfg.shore;
    const h = new Float32Array(n), v = new Float32Array(n), a = new Float32Array(n), tmp = new Float32Array(n);
    const k = new Float32Array(n).fill(1);          // 수심 계수: 0 = 죽은 칸(먼 뭍), 1 = 깊은 바다
    const E = new Float32Array(n);                  // 땅 높이 (바다 0, 해변은 안쪽으로 갈수록 높아짐)
    const sd = new Float32Array(n).fill(1e9);       // 해안선까지 거리 (+ 바다, − 뭍)
    const solid = new Uint8Array(n);                // 빙하처럼 물결을 되튕기는 칸
    const edge = new Float32Array(n);               // 격자 가장자리 흡수대: 0(끝) → 1(안쪽)
    const shade = new Float32Array(n);              // 그리기용: 빛 방향 기울기 (부호 있음)
    const crest = new Float32Array(n);              // 그리기용: 물마루 (볼록하고 평평한 곳) 0~1
    const foam = new Float32Array(n), wet = new Float32Array(n), film = new Float32Array(n);   // 거품 · 젖은 모래 · 뭍 위 물막 두께
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const d = Math.min(i, j, N - 1 - i, N - 1 - j);
      edge[j * N + i] = smooth(0, cfg.edgeCells, d);
    }
    const sim = { N, dx, ox: 0, oy: 0, h, v, k, E, sd, solid, edge, shade, crest, foam, wet, film, ready: false, maxShade: 0, hasShore: false, bodies: [] };

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
    // terr(x, y, out): out[0] = 수심 0~1, out[1] = 해안선까지 거리 (+ 바다, − 뭍, 해안이 없으면 큰 값)
    const tout = [1, 1e9];
    function fillTerrain(terr) {
      let shore = false;
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const q = j * N + i;
        if (k[q] < 0) {
          terr(wx(i), wy(j), tout);
          const d = tout[1];
          sd[q] = d > 1e8 ? 1e9 : d;
          if (d >= 0) { k[q] = Math.max(SH.minSpeed, clamp(tout[0] / cfg.shallowRef, 0, 1)); E[q] = 0; }
          else if (-d < SH.maxInland) { k[q] = SH.minSpeed; E[q] = -d * SH.beachSlope; h[q] = E[q]; }
          else { k[q] = 0; E[q] = 0; }
        }
        if (k[q] < 0.999) shore = true;
      }
      sim.hasShore = shore;
    }
    // 격자 중심을 (cx, cy) 근처로. 한 칸 이상 벗어나면 칸 단위로 민다
    sim.recenter = function (cx, cy, terr) {
      const nox = Math.round(cx / dx - N / 2), noy = Math.round(cy / dx - N / 2);
      if (!sim.ready) { sim.ox = nox; sim.oy = noy; k.fill(-1); fillTerrain(terr); sim.ready = true; return; }
      const sx = nox - sim.ox, sy = noy - sim.oy;
      if (!sx && !sy) return;
      sim.ox = nox; sim.oy = noy;
      if (Math.abs(sx) >= N || Math.abs(sy) >= N) { h.fill(0); v.fill(0); foam.fill(0); wet.fill(0); k.fill(-1); }
      else {
        shift(h, sx, sy, 0); shift(v, sx, sy, 0); shift(k, sx, sy, -1); shift(E, sx, sy, 0); shift(sd, sx, sy, 1e9);
        if (sim.hasShore) { shift(foam, sx, sy, 0); shift(wet, sx, sy, 0); }
      }
      fillTerrain(terr);
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
      const cur = key._w, prev = key._w2, B = cfg.body, g = cur.gain === undefined ? B.gain : cur.gain;   // gain 을 물체마다 (속도에 비례) 줄 수 있음
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
        const open = !solid[q] && k[q] > 0 && E[q] === 0;                    // 물을 밀 수 있는 칸 (바다)
        const kk = disc ? 1 : k[q];                                          // 얕은 곳에선 몸이 덜 잠김
        const d = open || disc ? clamp((subAt(cur, px, py) - subAt(prev, px, py)) * kk * g, -B.maxStep, B.maxStep) : 0;
        if (d !== 0) { T += d; if (open) h[q] -= d; }
        if (!open) { tmp[q] = 0; continue; }
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
        const q = j * N + i; if (solid[q] || k[q] <= 0 || E[q] > 0) continue;
        const d = Math.hypot(wx(i) - x, wy(j) - y);
        const b1 = d < r ? 0.5 + 0.5 * Math.cos(Math.PI * d / r) : 0, b2 = d < R ? 0.5 + 0.5 * Math.cos(Math.PI * d / R) : 0;
        h[q] += amp * (b1 - 0.25 * b2);
      }
    };
    // 먼바다에서 해안으로 밀려오는 파도 한 줄: 해안선에서 off 떨어진 곳에 폭 w 의 마루를 놓고 해안 쪽으로 보냄
    // ampFn(x, y) = 해안을 따라 달라지는 세기 (0 이면 그 구간은 파도 없음)
    sim.shoreWave = function (off, w, amp, ampFn) {
      if (!sim.hasShore) return;
      const c = cfg.waveSpeed, lim = w * 2.2;
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const q = j * N + i, u = sd[q] - off;
        if (u > lim || u < -lim || solid[q] || E[q] > 0 || k[q] <= 0) continue;
        const g = Math.exp(-(u / w) * (u / w)) * amp * ampFn(wx(i), wy(j)) * edge[q];
        h[q] += g;
        v[q] += c * Math.sqrt(k[q]) * g * (-2 * u / (w * w));               // h(u + c·t): 해안(u 감소) 쪽으로 진행
      }
    };

    // ── 적분 ────────────────────────────────────────────────
    sim.step = function (dt) {
      for (const b of sim.bodies) if (b._w.gain !== 0) displace(b);
      const cour = Math.min(cfg.waveSpeed * dt / dx, 0.68);                  // 안정 조건 c·dt/dx < 1/√2
      const c2 = cour * cour / dt;                                           // (c/dx)²·dt
      const tau = Math.min(cfg.viscosity, 0.2 * dt / (cour * cour));         // 양해법 안정 한계
      const beta = 0.125 * clamp(cfg.dispersion, 0, 1);
      const shore = sim.hasShore;
      // 이웃 값: 막힌 칸·격자 밖·마른 높은 땅은 거울(자기 값 c) → 되튕김. 뭍 칸은 자기 땅보다 낮은 물에 끌려 내려가지 않음
      // 반환값 = 두 칸 사이 흐름: (이웃 − 나) × 경계의 수심 계수. 발산형이라 얕아질수록 파도가 높아짐(천수 효과)
      const nb = (m, ok, c, eq, kq) => {
        if (!ok || solid[m] || k[m] <= 0) return 0;
        let x = h[m] + tau * v[m];
        if (shore) {
          const em = E[m];
          if (em > 0 && em > c && h[m] <= em + 1e-5) return 0;               // 마른 땅이 내 수면보다 높음 = 벽
          if (x < eq) x = eq;
        }
        return (x - c) * 0.5 * (kq + k[m]);
      };
      // 1) a = ∇·(k ∇(h + τv))
      for (let j = 0; j < N; j++) {
        const row = j * N;
        for (let i = 0; i < N; i++) {
          const q = row + i;
          if (solid[q] || k[q] <= 0) { a[q] = 0; continue; }
          const c = h[q] + tau * v[q], eq = E[q], kq = k[q];
          a[q] = nb(q - 1, i > 0, c, eq, kq) + nb(q + 1, i < N - 1, c, eq, kq) + nb(q - N, j > 0, c, eq, kq) + nb(q + N, j < N - 1, c, eq, kq);
        }
      }
      // 2) 분산 + 속도·높이 갱신
      const dmp = cfg.damping, eD = cfg.edgeDamping, sD = cfg.shoreAbsorb, rest = Math.exp(-cfg.restore * dt);
      const drain = Math.exp(-SH.drain * dt), fric = SH.friction;
      for (let j = 0; j < N; j++) {
        const row = j * N;
        for (let i = 0; i < N; i++) {
          const q = row + i;
          if (solid[q]) { h[q] = 0; v[q] = 0; continue; }
          const kk = k[q];
          if (kk <= 0) { h[q] *= 0.8; v[q] = 0; continue; }
          let acc = a[q];
          if (beta > 0 && E[q] === 0) {
            const c = acc; let s = -4 * c, m;
            m = q - 1; s += i > 0 && !solid[m] ? a[m] : c;
            m = q + 1; s += i < N - 1 && !solid[m] ? a[m] : c;
            m = q - N; s += j > 0 && !solid[m] ? a[m] : c;
            m = q + N; s += j < N - 1 && !solid[m] ? a[m] : c;
            acc += beta * s;
          }
          const eq = E[q];
          let nv = v[q] + c2 * acc;
          nv *= Math.exp(-(dmp + (1 - edge[q]) * eD + (1 - kk) * sD + (eq > 0 ? fric : 0)) * dt);
          if (eq > 0) {                                                      // 뭍: 물막은 땅 위로만, 서서히 빠짐
            let nh = eq + (h[q] + nv * dt - eq) * drain;
            if (nh <= eq) { nh = eq; if (nv < 0) nv = 0; }
            h[q] = nh; v[q] = nv;
          } else { v[q] = nv; h[q] = (h[q] + nv * dt) * rest; }
        }
      }
      if (shore) stepShore(dt);
    };
    // 거품(부서지는 얕은 물·물막 앞쪽)과 젖은 모래
    function stepShore(dt) {
      const fd = Math.exp(-dt / SH.foamLife), dry = dt / SH.dryTime, vth = SH.breakSpeed, fg = SH.foamGain * dt;
      for (let q = 0; q < n; q++) {
        const kk = k[q];
        if (kk <= 0 || kk >= 0.999) { if (foam[q] > 0) foam[q] *= fd; continue; }
        let f = foam[q] * fd;
        const av = v[q] < 0 ? -v[q] : v[q];
        if (E[q] > 0) {
          const d = h[q] - E[q];
          film[q] = d;
          if (d > SH.filmMin) { wet[q] = 1; if (v[q] > 0) f += fg * SH.frontFoam * v[q] / (d + SH.frontDepth); }   // 밀려 올라올 때만 거품 (얇은 앞쪽일수록 많이)
          else if (wet[q] > 0) wet[q] = Math.max(0, wet[q] - dry);
        } else {
          film[q] = 0;
          if (av > vth) f += fg * (av - vth) * (1 - kk);
        }
        foam[q] = f > 1 ? 1 : f;
      }
      // 거품을 이웃으로 살짝 번지게 → 칸 모양 계단이 사라지고 가장자리가 부드러움
      const df = SH.foamSpread;
      if (df > 0) {
        tmp.set(foam);
        for (let j = 1; j < N - 1; j++) for (let i = 1, q = j * N + 1; i < N - 1; i++, q++) {
          if (k[q] <= 0 || k[q] >= 0.999) continue;
          foam[q] = tmp[q] * (1 - df) + (tmp[q - 1] + tmp[q + 1] + tmp[q - N] + tmp[q + N]) * 0.25 * df;
        }
      }
    }

    // ── 읽기 ────────────────────────────────────────────────
    function bil(arr, x, y) {
      const gx = x / dx - sim.ox - 0.5, gy = y / dx - sim.oy - 0.5;
      if (gx < 0 || gy < 0 || gx >= N - 1 || gy >= N - 1) return 0;
      const i = gx | 0, j = gy | 0, fx = gx - i, fy = gy - j, q = j * N + i;
      return (arr[q] * (1 - fx) + arr[q + 1] * fx) * (1 - fy) + (arr[q + N] * (1 - fx) + arr[q + N + 1] * fx) * fy;
    }
    sim.sample = (x, y) => bil(h, x, y);
    sim.filmAt = (x, y) => (sim.hasShore ? bil(film, x, y) : 0);
    // 물체 둘레(타원 rx, ry) 8점 평균 높이 — 물체가 물결을 타고 오르내리게
    sim.around = function (x, y, rx, ry) {
      let s = 0;
      for (let t = 0; t < 8; t++) { const an = t * 0.7854; s += bil(h, x + Math.cos(an) * rx, y + Math.sin(an) * ry); }
      return s / 8;
    };
    // 그리기용 명암 필드: 빛(lx, ly) 쪽으로 기운 면은 +, 반대는 −
    sim.computeShade = function (lx, ly) {
      let mx = 0; const inv = 0.5 / dx, inv2 = 1 / (dx * dx), LN = cfg.render.line, c0 = LN.curv[0], c1 = 1 / (LN.curv[1] - LN.curv[0]), fl2 = 1 / (LN.flat * LN.flat);
      for (let j = 1; j < N - 1; j++) {
        const row = j * N;
        for (let i = 1; i < N - 1; i++) {
          const q = row + i;
          if (solid[q] || k[q] <= 0 || E[q] > 0) { shade[q] = 0; crest[q] = 0; continue; }
          const gx = (h[q + 1] - h[q - 1]) * inv, gy = (h[q + N] - h[q - N]) * inv;
          const s = -(gx * lx + gy * ly) * edge[q];
          shade[q] = s; const as = s < 0 ? -s : s; if (as > mx) mx = as;
          // 물마루: −∇²h 가 크고(볼록) |∇h| 가 작은(꼭대기) 곳
          // (두 칸 간격으로 재서 격자 크기의 잔 떨림에는 반응하지 않음)
          if (i < 2 || j < 2 || i >= N - 2 || j >= N - 2) { crest[q] = 0; continue; }
          const cv = -(h[q + 2] + h[q - 2] + h[q + 2 * N] + h[q - 2 * N] - 4 * h[q]) * inv2 * 0.25;
          if (cv > c0) { const wx2 = (h[q + 2] - h[q - 2]) * inv * 0.5, wy2 = (h[q + 2 * N] - h[q - 2 * N]) * inv * 0.5, g2 = (wx2 * wx2 + wy2 * wy2) * fl2; let t = (cv - c0) * c1; if (t > 1) t = 1; crest[q] = t * Math.exp(-g2) * edge[q]; }
          else crest[q] = 0;
        }
      }
      sim.maxShade = mx;
      // 그리기 전용 거르기: 명암·물마루를 [1 2 1] 로 가로·세로 한 번씩 번지게 → 격자 크기의 거친 무늬가 화면에 안 보임 (계산값 h 는 그대로)
      for (const arr of [shade, crest]) {
        tmp.set(arr);
        for (let j = 1; j < N - 1; j++) for (let i = 1, q = j * N + 1; i < N - 1; i++, q++) a[q] = (tmp[q - 1] + 2 * tmp[q] + tmp[q + 1]) * 0.25;
        for (let j = 1; j < N - 1; j++) for (let i = 1, q = j * N + 1; i < N - 1; i++, q++) arr[q] = solid[q] ? 0 : (a[q - N] + 2 * a[q] + a[q + N]) * 0.25;
      }
    };
    sim.shadeAt = (x, y) => bil(shade, x, y);
    sim.reset = function () { h.fill(0); v.fill(0); foam.fill(0); wet.fill(0); sim.ready = false; };
    return sim;
  }

  const api = { create };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.WaterSim = api;
})();
