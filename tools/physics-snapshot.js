// 물리 스냅샷: 그림·색·카메라를 바꿔도 물리가 그대로인지 전후 비교용
// 사용: python3 -m http.server 8123 &  →  node tools/physics-snapshot.js > snap.json
// 고정 단계(step)를 직접 돌려 프레임 속도와 무관. 무작위(떠다니기 방향 등)는 Math.random 을 고정 시드로 바꿔 재현
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 1 })).newPage();
  await page.addInitScript(() => { let s = 12345; Math.random = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); window.requestAnimationFrame = () => 0; });
  await page.goto('http://localhost:8123/' + (process.argv[2] || ''));
  const out = await page.evaluate(() => {
    const g = window.__game, S = g.S, C = g.C, P = C.PHYSICS, r3 = (v) => +v.toFixed(3);
    const run = (n, each) => { for (let i = 0; i < n; i++) { g.step(g.STEP); if (each) each(i); } };
    const res = {};
    // 정의값
    res.jumpAir = r3(2 * P.jumpVelocity / P.gravity); res.jumpMaxDist = r3(g.jumpMaxDist());
    const start = () => { g.reset(); run(5); };
    const startFloe = () => g.activeFloes().find((f) => f.cand.start);
    // ① 빙하 위 걷기: 2초 뒤 속도, 손 떼고 1초 뒤 속도 (마찰)
    start(); g.keys.add('u'); run(120); let p = S.p; res.iceWalkSpeed = r3(Math.hypot(p.vx, p.vy));
    g.keys.clear(); run(60); res.iceCoastSpeed = r3(Math.hypot(p.vx, p.vy));
    // ② 제자리 점프: 최고 높이, 체공 시간
    start(); p = S.p; const z0 = p.z; S.jumpReq = 'jump'; let zmax = 0, air = 0; run(90, () => { if (p.air) { air++; zmax = Math.max(zmax, p.z - z0); } });
    res.jumpHeight = r3(zmax); res.jumpAirMeasured = r3(air * g.STEP);
    // ③ 슈퍼점프
    start(); p = S.p; S.jumpReq = 'super'; zmax = 0; air = 0; run(120, () => { if (p.air) { air++; zmax = Math.max(zmax, p.z - z0); } });
    res.superHeight = r3(zmax); res.superAir = r3(air * g.STEP);
    // ④ 착지: 시작 빙하 출렁임 (최대 가라앉음 px, 첫 복귀 시간)
    start(); p = S.p; const f = startFloe(); S.jumpReq = 'jump'; let hmin = 0, tBack = null, landed = null;
    run(240, (i) => { if (!p.air && landed == null && i > 5) landed = i; if (landed != null) { hmin = Math.min(hmin, f.heave.h); if (tBack == null && i > landed + 3 && f.heave.h >= 0) tBack = (i - landed) * g.STEP; } });
    res.landSinkPx = r3(hmin); res.landReturn = tBack && r3(tBack);
    // ⑤ 입수 (깊은 바다 한가운데에 0.8 높이에서 떨어뜨림): 최대 잠김, 다시 수면까지 시간, 3초 뒤 높이
    start(); p = S.p; p.x = 6; p.y = 9; p.mode = 'water'; p.floe = null; p.air = true; p.z = 0.8; p.vz = 0; p.g = P.gravity; p.vx = p.vy = 0; p.cvx = p.cvy = 0;
    let zmin = 0, tIn = null, tUp = null; run(240, (i) => { if (!p.air && tIn == null) tIn = i; if (tIn != null) { zmin = Math.min(zmin, p.dive.h); if (tUp == null && i > tIn + 2 && p.dive.h >= 0) tUp = (i - tIn) * g.STEP; } });
    res.diveDepth = r3(zmin); res.diveReturn = tUp && r3(tUp); res.diveEndH = r3(p.dive.h);
    // ⑥ 헤엄: 2초 뒤 속도, 손 떼고 1초 뒤
    p.driftAng = 1;                                          // 떠다니는 방향은 시작 때 무작위라 고정해서 비교
    g.keys.add('u'); run(150); res.swimSpeed = r3(Math.hypot(p.vx, p.vy)); g.keys.clear(); run(60); res.swimCoast = r3(Math.hypot(p.vx, p.vy));
    // ⑦ 빙하 질량 공식 (시작 빙하), 밀도, 부력
    start(); const f2 = startFloe(); res.startFloeMass = r3(f2.mass); res.massPerArea = r3(f2.mass / (Math.PI * f2.rx * f2.ry)); res.buoyancy = P.buoyancyStiffness;
    // ⑧ 빙하 끌기: 0.5초 동안 2 만큼 떨어진 곳으로 당겼을 때 이동 거리 (질량·끌림 강성)
    f2.grab = [f2.x + 2, f2.y]; const x0 = f2.x; run(30); res.floeDrag05 = r3(f2.x - x0); f2.grab = null;
    // ⑨ 물리 설정 전체 해시용
    res.PHYSICS = JSON.stringify(P); res.DEPTHphys = JSON.stringify(['slope', 'power', 'walkMax', 'wadeMax', 'walkSpeed', 'wadeMinSpeed', 'sinkPerDepth'].map((k) => C.DEPTH[k]));
    res.simPhys = JSON.stringify(['waveSpeed', 'damping', 'dispersion', 'viscosity', 'restore'].map((k) => C.WATER_SIM[k]));
    res.guide = JSON.stringify(C.FIREFLY.guide);
    return res;
  });
  console.log(JSON.stringify(out, null, 1));
  await browser.close();
})();
