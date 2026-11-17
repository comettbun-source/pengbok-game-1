// pengbok 물리 스냅샷: 60Hz 고정 단계로 3초 전진(왼쪽) → 점프 → 입수 → 슬라이딩 헤엄 → 상륙
// 30단계(0.5초)마다 펭귄 좌표·속도·높이와 활성 빙하 기울기를 기록. 그림·UI 수정 전후 비교용
// 사용: python3 -m http.server 8123 &  →  node tools/pengbok-snapshot.js out.json   (비교: node tools/pengbok-snapshot.js out2.json out.json)
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 1 })).newPage();
  await page.addInitScript(() => { let s = 12345; Math.random = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); window.requestAnimationFrame = () => 0; });
  await page.goto('http://localhost:8123/index_pengbok.html');
  const rec = await page.evaluate(() => {
    const g = window.__game, S = g.S, r5 = (v) => +v.toFixed(5), out = [];
    g.reset(); S.p.driftAng = 1;
    let n = 0;
    const snap = (tag) => { const p = S.p; out.push({ n, tag, x: r5(p.x), y: r5(p.y), vx: r5(p.vx), vy: r5(p.vy), z: r5(p.z), mode: p.mode,
      tilt: g.activeFloes().map((f) => [f.cand.id, r5(f.tilt.x), r5(f.tilt.y), r5(f.heave.h)]) }); };
    const run = (k, tag) => { for (let i = 0; i < k; i++) { g.step(g.STEP); n++; if (n % 30 === 0) snap(tag); } };
    g.keys.add('l'); run(180, 'forward3s');                  // ① 3초 전진
    S.jumpReq = 'jump'; run(60, 'jump');                     // ② 점프
    run(120, 'dive');                                         // ③ 입수 (물에 떨어져 있거나 빙하 끝에서 계속 전진)
    g.pointers.set(99, { role: 'action', long: true, t0: 0 }); run(150, 'slideSwim'); g.pointers.delete(99);   // ④ 슬라이딩 헤엄
    const is = S.islands[0]; S.p.x = is.shoreAt(0.3) - is.side * 3; S.p.y = 0.3; S.p.vx = S.p.vy = 0; run(240, 'landing');   // ⑤ 상륙
    g.keys.clear();
    return out;
  });
  fs.writeFileSync(process.argv[2], JSON.stringify(rec));
  if (process.argv[3]) {                                   // 비교: 1% 넘게 다르면 보고
    const base = JSON.parse(fs.readFileSync(process.argv[3], 'utf8')); let bad = 0, worst = 0;
    const cmp = (a, b, where) => { const d = Math.abs(a - b), tol = Math.max(0.01 * Math.abs(a), 1e-3); if (d > tol) { bad++; if (bad <= 15) console.log('DIFF', where, a, b); } worst = Math.max(worst, d / Math.max(Math.abs(a), 1e-3)); };
    base.forEach((s, i) => { const t = rec[i]; if (!t) { bad++; return; }
      for (const k of ['x', 'y', 'vx', 'vy', 'z']) cmp(s[k], t[k], `${s.tag}@${s.n}.${k}`);
      if (s.mode !== t.mode) { bad++; console.log('DIFF mode', s.tag, s.n, s.mode, t.mode); }
      s.tilt.forEach((f, j) => { const u = t.tilt[j]; if (!u || u[0] !== f[0]) { bad++; return; } cmp(f[1], u[1], `${s.tag}@${s.n}.tilt${f[0]}x`); cmp(f[2], u[2], `${s.tag}@${s.n}.tilt${f[0]}y`); }); });
    console.log(bad ? `1% 넘게 다른 값 ${bad}개` : `전부 1% 이내 (체크포인트 ${base.length}개)`);
  } else console.log('saved', rec.length, 'checkpoints');
  await browser.close();
})();
