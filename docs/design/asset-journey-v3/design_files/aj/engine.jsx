const { useState: eS, useEffect: eE, useRef: eR } = React;

const easeOut = (p) => 1 - Math.pow(1 - p, 2.2);

/** Everything the live view needs at sim time t (pure, cheap enough at 10 fps). */
function deriveBuild(t) {
  const { STEPS, TOTAL, PLAN_T, RECORDS, EVENTS, LOGS, COLL } = AJ;
  const steps = STEPS.map((s) => {
    const status = t < s.start ? 'pending' : t < s.end ? 'running' : 'done';
    const p = Math.min(1, Math.max(0, (t - s.start) / s.dur));
    const live = {};
    for (const [k, v] of Object.entries(s.counts)) live[k] = Math.round(v * easeOut(p));
    const recTotal = Object.values(s.recs).reduce((a, b) => a + b, 0);
    return { ...s, status, p, live, recTotal, warnOn: s.warn && t >= s.start + s.dur * 0.4 };
  });
  const st = Object.fromEntries(steps.map((s) => [s.name, s]));
  const records = [];
  const collCount = Object.fromEntries(Object.keys(COLL).map((k) => [k, 0]));
  const collFirst = {};
  const stepRecs = {};
  for (const r of RECORDS) {
    if (r.at > t) break;
    records.push(r);
    collCount[r.coll]++;
    stepRecs[r.step] = (stepRecs[r.step] || 0) + 1;
    if (collFirst[r.coll] === undefined) collFirst[r.coll] = r.at;
  }
  const events = EVENTS.filter((e) => e.at <= t);
  const logs = LOGS.filter((l) => l.t <= t);
  const phase = t < PLAN_T ? 'planning' : t < TOTAL ? 'running' : 'done';
  const current = steps.find((s) => s.status === 'running') || null;
  const doneCount = steps.filter((s) => s.status === 'done').length;
  const srcSteps = steps.filter((s) => s.src);
  return {
    t, phase, steps, st, records, collCount, collFirst, stepRecs, events, logs, current, doneCount,
    srcDone: srcSteps.filter((s) => s.status === 'done').length, srcTotal: srcSteps.length,
    progress: Math.min(1, Math.max(0, (t - PLAN_T) / (TOTAL - PLAN_T))),
  };
}

const LS_T = 'aj.simT';
function useBuild(speed, playing, LS = LS_T, init = null) {
  const [t, setT] = eS(() => { if (init != null) return Math.min(init, AJ.TOTAL); const v = parseFloat(localStorage.getItem(LS)); return isFinite(v) ? Math.min(v, AJ.TOTAL) : 0; });
  const last = eR(performance.now());
  eE(() => {
    last.current = performance.now();
    const id = setInterval(() => {
      const now = performance.now(), dt = (now - last.current) / 1000;
      last.current = now;
      if (!playing) return;
      setT((x) => (x >= AJ.TOTAL ? x : Math.min(AJ.TOTAL, x + dt * speed)));
    }, 100);
    return () => clearInterval(id);
  }, [speed, playing]);
  const sec = Math.floor(t);
  eE(() => { if (init == null) localStorage.setItem(LS, String(t)); }, [sec, t >= AJ.TOTAL]);
  return [t, setT];
}

Object.assign(window, { deriveBuild, useBuild });
