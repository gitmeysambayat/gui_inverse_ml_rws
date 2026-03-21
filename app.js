const state = {
  meta: null,
  contexts: null,
  xgbDo: null,
  xgbSh: null,
  profile: 'IPE400',
  grade: 'S275',
  lh: '9',
  criterion: 'J3',
  controls: { My: null, Mc: null, Mu: null, theta: null },
  selectedCaseId: null,
  clampMessages: [],
};

const THETA_J = 0.04;
const M004_THRESHOLD = 0.8;
const SIGMA_THRESHOLD = 1.0;
const PEEQ_ZERO_TOL = 1e-12;
const MCCRIT_THRESHOLD = 0.8;
const FORWARD_BACKBONE_ROTATIONS = [-0.06, -0.04, -0.02, 0.02, 0.04, 0.06];

function fmt(value, digits = 3) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  return Number(value).toFixed(digits);
}

function pct(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  return `${(100 * Number(value)).toFixed(digits)}%`;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function currentContextKey() {
  return `${state.profile}|${state.grade}|${state.lh}`;
}

function currentContextData() {
  return state.contexts[currentContextKey()];
}

function currentCandidates() {
  const ctx = currentContextData();
  return ctx ? ctx.candidates : [];
}

function currentFullSection() {
  const ctx = currentContextData();
  return ctx ? ctx.full_section : null;
}

function currentContextMeta() {
  return state.meta.context_meta[currentContextKey()];
}

function thetaDisplay(candidate) {
  if (candidate.theta_eval !== null && candidate.theta_eval !== undefined && !Number.isNaN(Number(candidate.theta_eval))) {
    return Number(candidate.theta_eval);
  }
  if (candidate.theta_u !== null && candidate.theta_u !== undefined && !Number.isNaN(Number(candidate.theta_u))) {
    return Number(candidate.theta_u);
  }
  if (candidate.theta_u_LB !== null && candidate.theta_u_LB !== undefined && !Number.isNaN(Number(candidate.theta_u_LB))) {
    return Number(candidate.theta_u_LB);
  }
  return null;
}

function muDisplay(candidate) {
  if (candidate.Mu !== null && candidate.Mu !== undefined && !Number.isNaN(Number(candidate.Mu))) {
    return Number(candidate.Mu);
  }
  return null;
}

function candidateFlags(candidate) {
  const theta = thetaDisplay(candidate);
  const j1 = Number(candidate.M004_Mp) >= M004_THRESHOLD && theta !== null && theta >= THETA_J;
  const j2 = j1 && Number(candidate.sigma_ratio) <= SIGMA_THRESHOLD && Math.abs(Number(candidate.PEEQCF)) <= PEEQ_ZERO_TOL;
  const j3 = j2 && Number(candidate.Mc_McFS) >= MCCRIT_THRESHOLD;
  return { j1, j2, j3 };
}

function passesTargets(candidate) {
  return Number(candidate.My) >= Number(state.controls.My)
    && Number(candidate.Mc) >= Number(state.controls.Mc)
    && Number(muDisplay(candidate)) >= Number(state.controls.Mu)
    && Number(thetaDisplay(candidate)) >= Number(state.controls.theta);
}

function criterionRuleText(criterion) {
  if (criterion === 'J1') return 'M0.04 ≥ 0.8Mp and θu ≥ 4%';
  if (criterion === 'J2') return 'J1 and σvm,CF/Fy ≤ 1 and PEEQCF ≈ 0.0';
  if (criterion === 'J3') return 'J2 and Mc ≥ 0.8Mc,FS';
  return 'No J-screen';
}

function activeCriterionFlag(flags) {
  if (state.criterion === 'None') return true;
  return Boolean(flags[state.criterion.toLowerCase()]);
}

function featureVectorFromControls() {
  const section = state.meta.section_lookup[state.profile];
  const fy = state.meta.grade_lookup[state.grade];
  const ctx = currentContextMeta();
  const myFsRatio = Number(state.controls.My) / Math.max(Number(ctx.My_FS), 1e-9);
  const mcFsRatio = Number(state.controls.Mc) / Math.max(Number(ctx.Mc_FS), 1e-9);
  const muMc = Number(state.controls.Mu) / Math.max(Number(state.controls.Mc), 1e-9);
  const omegaS = Number(state.controls.Mc) / Math.max(Number(state.controls.My), 1e-9);
  return [
    section.h_mm,
    section.b_mm,
    section.tw_mm,
    section.tf_mm,
    fy,
    Number(state.lh),
    myFsRatio,
    mcFsRatio,
    muMc,
    Number(state.controls.theta),
    omegaS
  ];
}

function evaluateTree(node, features, featureNames) {
  if (Object.prototype.hasOwnProperty.call(node, 'leaf')) return Number(node.leaf);
  const split = node.split;
  const splitIndex = typeof split === 'string' && split.startsWith('f')
    ? Number(split.slice(1))
    : featureNames.indexOf(split);
  const value = features[splitIndex];
  const nextId = value < Number(node.split_condition) ? node.yes : node.no;
  const child = (node.children || []).find((c) => Number(c.nodeid) === Number(nextId));
  return evaluateTree(child, features, featureNames);
}

function predictXgb(model, features) {
  let out = Number(model.base_score);
  const names = model.feature_names || state.meta.feature_names;
  for (const tree of model.trees) {
    out += evaluateTree(tree, features, names);
  }
  return out;
}

function buildSelectOptions() {
  const profiles = Object.keys(state.meta.section_lookup);
  const grades = Object.keys(state.meta.grade_lookup);
  const lhs = [...new Set(Object.keys(state.contexts).map((k) => k.split('|')[2]))].sort((a, b) => Number(a) - Number(b));

  const profileSelect = document.getElementById('profileSelect');
  const gradeSelect = document.getElementById('gradeSelect');
  const lhSelect = document.getElementById('lhSelect');

  profileSelect.innerHTML = '';
  gradeSelect.innerHTML = '';
  lhSelect.innerHTML = '';

  profiles.forEach((profile) => {
    const opt = document.createElement('option');
    opt.value = profile;
    opt.textContent = profile;
    profileSelect.appendChild(opt);
  });
  grades.forEach((grade) => {
    const opt = document.createElement('option');
    opt.value = grade;
    opt.textContent = grade;
    gradeSelect.appendChild(opt);
  });
  lhs.forEach((lh) => {
    const opt = document.createElement('option');
    opt.value = lh;
    opt.textContent = lh;
    lhSelect.appendChild(opt);
  });

  if (!profiles.includes(state.profile)) state.profile = profiles[0];
  if (!grades.includes(state.grade)) state.grade = grades[0];
  if (!lhs.includes(state.lh)) state.lh = lhs[0];

  profileSelect.value = state.profile;
  gradeSelect.value = state.grade;
  lhSelect.value = state.lh;
  document.getElementById('criterionSelect').value = state.criterion;

  profileSelect.addEventListener('change', (e) => {
    state.profile = e.target.value;
    resetTargetControls();
    refresh();
  });
  gradeSelect.addEventListener('change', (e) => {
    state.grade = e.target.value;
    resetTargetControls();
    refresh();
  });
  lhSelect.addEventListener('change', (e) => {
    state.lh = e.target.value;
    resetTargetControls();
    refresh();
  });
  document.getElementById('criterionSelect').addEventListener('change', (e) => {
    state.criterion = e.target.value;
    state.selectedCaseId = null;
    refresh();
  });
}

function rawDomains() {
  const ctx = currentContextMeta();
  return {
    My: { lo: Number(ctx.My_min), hi: Math.max(Number(ctx.My_max), Number(ctx.My_FS)) },
    Mc: { lo: Number(ctx.Mc_min), hi: Math.max(Number(ctx.Mc_max), Number(ctx.Mc_FS)) },
    Mu: { lo: Number(ctx.Mu_min), hi: Math.max(Number(ctx.Mu_max), Number(ctx.Mu_FS)) },
    theta: { lo: THETA_J, hi: 0.06 }
  };
}

function targetDomains() {
  const dom = rawDomains();
  return {
    My: { lo: dom.My.lo, hi: dom.My.hi },
    Mc: { lo: Math.max(dom.Mc.lo, Number(state.controls.My ?? dom.My.lo)), hi: dom.Mc.hi },
    Mu: { lo: dom.Mu.lo, hi: Math.min(dom.Mu.hi, Number(state.controls.Mc ?? dom.Mc.hi)) },
    theta: { lo: dom.theta.lo, hi: dom.theta.hi }
  };
}

function median(values) {
  const arr = [...values]
    .map((v) => Number(v))
    .filter((v) => !Number.isNaN(v))
    .sort((a, b) => a - b);
  if (!arr.length) return null;
  const m = Math.floor(arr.length / 2);
  return arr.length % 2 ? arr[m] : 0.5 * (arr[m - 1] + arr[m]);
}

function enforceTargetConsistency() {
  const dom = rawDomains();
  const msgs = [];

  ['My', 'Mc', 'Mu', 'theta'].forEach((key) => {
    const lo = dom[key].lo;
    const hi = dom[key].hi;
    const before = Number(state.controls[key]);
    const after = clamp(before, lo, hi);
    if (after !== before) msgs.push(`${key} was clamped to the available domain for the selected beam context.`);
    state.controls[key] = after;
  });

  if (Number(state.controls.Mc) < Number(state.controls.My)) {
    state.controls.Mc = Number(state.controls.My);
    msgs.push('Mc cannot be below My, so Mc was raised to My.');
  }
  if (Number(state.controls.Mu) > Number(state.controls.Mc)) {
    state.controls.Mu = Number(state.controls.Mc);
    msgs.push('Mu cannot be above Mc, so Mu was reduced to Mc.');
  }
  if (Number(state.controls.theta) < THETA_J) {
    state.controls.theta = THETA_J;
    msgs.push('θu was raised to 0.04 rad because the J-screen definitions start there.');
  }
  state.clampMessages = msgs;
}

function resetTargetControls() {
  const rows = currentCandidates();
  state.controls.My = median(rows.map((r) => Number(r.My)));
  state.controls.Mc = median(rows.map((r) => Number(r.Mc)));
  state.controls.Mu = median(rows.map((r) => Number(r.Mu)));
  state.controls.theta = Math.max(THETA_J, median(rows.map((r) => Number(r.theta_eval))));
  enforceTargetConsistency();
  state.selectedCaseId = null;
  renderTargetControls();
}

function sliderStep(lo, hi, defaultStep = 0.1) {
  const span = Math.max(Number(hi) - Number(lo), 0);
  if (span <= 0) return defaultStep;
  return Math.max(span / 400, defaultStep);
}

function renderTargetControls() {
  const wrap = document.getElementById('targetControlStack');
  wrap.innerHTML = '';
  const dom = targetDomains();
  const ctxMeta = currentContextMeta();

  const defs = [
    { key: 'My', label: 'Minimum target M<sub>y</sub> (kN·m)', lo: dom.My.lo, hi: dom.My.hi, digits: 1 },
    { key: 'Mc', label: 'Minimum target M<sub>c</sub> (kN·m)', lo: dom.Mc.lo, hi: dom.Mc.hi, digits: 1 },
    { key: 'Mu', label: 'Minimum target M<sub>u</sub> (kN·m)', lo: dom.Mu.lo, hi: dom.Mu.hi, digits: 1 },
    { key: 'theta', label: 'Minimum target θ<sub>u</sub> (rad)', lo: dom.theta.lo, hi: dom.theta.hi, digits: 4 }
  ];

  defs.forEach((def) => {
    const block = document.createElement('div');
    block.className = 'control-block';

    const top = document.createElement('div');
    top.className = 'control-top';
    const lab = document.createElement('label');
    lab.innerHTML = def.label;
    const val = document.createElement('span');
    val.style.fontSize = '12px';
    val.style.color = 'var(--muted)';
    val.textContent = fmt(state.controls[def.key], def.digits);
    top.appendChild(lab);
    top.appendChild(val);

    const inline = document.createElement('div');
    inline.className = 'control-inline';

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = def.lo;
    slider.max = def.hi;
    slider.step = def.key === 'theta' ? 0.0001 : sliderStep(def.lo, def.hi, 0.1);
    slider.value = state.controls[def.key];
    slider.id = `slider-${def.key}`;

    const numeric = document.createElement('input');
    numeric.type = 'number';
    numeric.min = def.lo;
    numeric.max = def.hi;
    numeric.step = def.key === 'theta' ? 0.0001 : sliderStep(def.lo, def.hi, 0.1);
    numeric.value = state.controls[def.key];
    numeric.id = `num-${def.key}`;

    const note = document.createElement('div');
    note.className = 'control-range-note';
    if (def.key === 'My') {
      note.innerHTML = `Opening-only FE range: ${fmt(ctxMeta.My_min, 1)} to ${fmt(ctxMeta.My_max, 1)} kN·m. Full-section reference: ${fmt(ctxMeta.My_FS, 1)} kN·m.`;
    } else if (def.key === 'Mc') {
      note.innerHTML = `Opening-only FE range: ${fmt(ctxMeta.Mc_min, 1)} to ${fmt(ctxMeta.Mc_max, 1)} kN·m. Full-section reference: ${fmt(ctxMeta.Mc_FS, 1)} kN·m.`;
    } else if (def.key === 'Mu') {
      note.innerHTML = `Opening-only FE range: ${fmt(ctxMeta.Mu_min, 1)} to ${fmt(ctxMeta.Mu_max, 1)} kN·m. For run-out cases where the 0.8M<sub>c</sub> drop is not reached by 6% drift, M<sub>u</sub> is shown conservatively as M<sub>0.06</sub>.`;
    } else {
      note.innerHTML = `Allowed range: 0.04 to 0.06 rad. Cases that do not reach the 0.8M<sub>c</sub> drop by 6% drift are treated as θ<sub>u</sub> ≥ 0.06.`;
    }

    const updateValue = (raw) => {
      state.controls[def.key] = Number(raw);
      enforceTargetConsistency();
      state.selectedCaseId = null;
      renderTargetControls();
      refresh();
    };

    slider.addEventListener('input', (e) => updateValue(e.target.value));
    numeric.addEventListener('change', (e) => updateValue(e.target.value));

    inline.appendChild(slider);
    inline.appendChild(numeric);
    block.appendChild(top);
    block.appendChild(inline);
    block.appendChild(note);
    wrap.appendChild(block);
  });
}

function updateBeamCards() {
  const section = state.meta.section_lookup[state.profile];
  const fy = state.meta.grade_lookup[state.grade];
  const ctx = currentContextMeta();
  const props = [
    ['h (mm)', fmt(section.h_mm, 0)],
    ['b (mm)', fmt(section.b_mm, 0)],
    ['t<sub>w</sub> (mm)', fmt(section.tw_mm, 1)],
    ['t<sub>f</sub> (mm)', fmt(section.tf_mm, 1)],
    ['f<sub>y</sub> (MPa)', fmt(fy, 0)],
    ['2L/h', state.lh],
  ];
  document.getElementById('beamPropsCard').innerHTML = props.map(([k, v]) => `<div class="card"><span class="k">${k}</span><span class="v">${v}</span></div>`).join('');
  const ranges = [
    ['M<sub>p</sub> (kN·m)', fmt(ctx.Mp, 1)],
    ['M<sub>y,FS</sub> (kN·m)', fmt(ctx.My_FS, 1)],
    ['M<sub>c,FS</sub> (kN·m)', fmt(ctx.Mc_FS, 1)],
    ['M<sub>u,FS</sub> (kN·m)', fmt(ctx.Mu_FS, 1)],
    ['θ<sub>u,FS</sub> (rad)', fmt(ctx.theta_FS, 4)],
    ['Preferred filter', state.criterion],
  ];
  document.getElementById('rangeCards').innerHTML = ranges.map(([k, v]) => `<div class="card"><span class="k">${k}</span><span class="v">${v}</span></div>`).join('');
}

function rankRows(rows, doPred, shPred) {
  const ctx = currentContextMeta();
  const doSpan = Math.max(state.meta.levels_do[state.meta.levels_do.length - 1] - state.meta.levels_do[0], 1e-9);
  const shSpan = Math.max(state.meta.levels_sh[state.meta.levels_sh.length - 1] - state.meta.levels_sh[0], 1e-9);

  const mySpan = Math.max(Math.max(Number(ctx.My_max), Number(ctx.My_FS)) - Number(ctx.My_min), 1e-9);
  const mcSpan = Math.max(Math.max(Number(ctx.Mc_max), Number(ctx.Mc_FS)) - Number(ctx.Mc_min), 1e-9);
  const muSpan = Math.max(Math.max(Number(ctx.Mu_max), Number(ctx.Mu_FS)) - Number(ctx.Mu_min), 1e-9);
  const thetaSpan = Math.max(0.06 - THETA_J, 1e-9);

  const enriched = rows.map((r) => {
    const flags = candidateFlags(r);
    const targetOk = passesTargets(r);
    const criterionOk = activeCriterionFlag(flags);

    const shortMy = Math.max((Number(state.controls.My) - Number(r.My)) / mySpan, 0);
    const shortMc = Math.max((Number(state.controls.Mc) - Number(r.Mc)) / mcSpan, 0);
    const shortMu = Math.max((Number(state.controls.Mu) - Number(r.Mu)) / muSpan, 0);
    const shortTheta = Math.max((Number(state.controls.theta) - Number(thetaDisplay(r))) / thetaSpan, 0);

    const overMy = Math.max((Number(r.My) - Number(state.controls.My)) / mySpan, 0);
    const overMc = Math.max((Number(r.Mc) - Number(state.controls.Mc)) / mcSpan, 0);
    const overMu = Math.max((Number(r.Mu) - Number(state.controls.Mu)) / muSpan, 0);
    const overTheta = Math.max((Number(thetaDisplay(r)) - Number(state.controls.theta)) / thetaSpan, 0);

    const geomErr = ((Number(r.doh) - Number(doPred)) / doSpan) ** 2
      + ((Number(r.Sh) - Number(shPred)) / shSpan) ** 2;
    const shortfall = shortMy ** 2 + shortMc ** 2 + shortMu ** 2 + shortTheta ** 2;
    const overshoot = overMy ** 2 + overMc ** 2 + overMu ** 2 + overTheta ** 2;
    const damagePen = 0.10 * Math.min(Number(r.sigma_ratio) / 1.25, 2.0)
      + 0.10 * Math.min(Number(r.PEEQCF) / 0.05, 4.0);

    const feasibleScore = 0.65 * geomErr + 0.35 * overshoot + damagePen;
    const missScore = 50.0 * shortfall + (criterionOk ? 0 : 12.0) + 0.65 * geomErr + 0.15 * overshoot + damagePen;

    return {
      ...r,
      __flags: flags,
      __target_ok: targetOk,
      __criterion_ok: criterionOk,
      __score: (targetOk && criterionOk) ? feasibleScore : missScore,
      __geom_err: geomErr,
      __shortfall: shortfall,
      __overshoot: overshoot,
    };
  });

  const feasibleRows = enriched.filter((r) => r.__target_ok && r.__criterion_ok);
  const hasFeasible = feasibleRows.length > 0;
  const activeRows = (hasFeasible ? feasibleRows : enriched).sort((a, b) => a.__score - b.__score);
  const allRows = [...enriched].sort((a, b) => a.__score - b.__score);
  return { allRows, activeRows, hasFeasible, feasibleCount: feasibleRows.length };
}

function contextRates(allRows) {
  const n = Math.max(allRows.length, 1);
  return {
    j1: allRows.filter((r) => r.__flags.j1).length / n,
    j2: allRows.filter((r) => r.__flags.j2).length / n,
    j3: allRows.filter((r) => r.__flags.j3).length / n,
    target: allRows.filter((r) => r.__target_ok).length / n
  };
}

function findSelectedRow(activeRows) {
  if (state.selectedCaseId) {
    const match = activeRows.find((r) => r.id === state.selectedCaseId);
    if (match) return match;
  }
  state.selectedCaseId = activeRows[0] ? activeRows[0].id : null;
  return activeRows[0];
}

function plotBackbone(selectedRow, recommendedRow, fullSection) {
  const xPlot = FORWARD_BACKBONE_ROTATIONS;
  const traces = [];
  if (fullSection) {
    traces.push({
      x: xPlot,
      y: forwardStyleBackbone(fullSection.backbone),
      mode: 'lines+markers',
      connectgaps: false,
      name: `Full section ${fullSection.id}`,
      line: { width: 2, dash: 'dash', color: '#767676' },
      marker: { size: 6, color: '#767676' }
    });
  }
  if (recommendedRow) {
    traces.push({
      x: xPlot,
      y: forwardStyleBackbone(recommendedRow.backbone),
      mode: 'lines+markers',
      connectgaps: false,
      name: `Recommended FE ${recommendedRow.id}`,
      line: { width: 3, color: '#2a5bd7' },
      marker: { size: 7, color: '#2a5bd7' }
    });
  }
  if (selectedRow && (!recommendedRow || selectedRow.id !== recommendedRow.id)) {
    traces.push({
      x: xPlot,
      y: forwardStyleBackbone(selectedRow.backbone),
      mode: 'lines+markers',
      connectgaps: false,
      name: `Selected FE ${selectedRow.id}`,
      line: { width: 4, color: '#111827' },
      marker: { size: 7, color: '#111827' }
    });
  }
  const layout = {
    margin: { l: 60, r: 25, t: 25, b: 55 },
    xaxis: { title: 'Rotation (rad)', zeroline: true },
    yaxis: { title: 'Moment (kN·m)', zeroline: true },
    legend: { orientation: 'h', y: -0.22 },
    paper_bgcolor: 'white',
    plot_bgcolor: 'white'
  };
  Plotly.newPlot('backbonePlot', traces, layout, { responsive: true, displayModeBar: false });
}

function plotRecommendationMap(allRows, doPred, shPred, selectedRow, recommendedRow, hasFeasible) {
  const x = state.meta.levels_do;
  const y = state.meta.levels_sh;
  const z = y.map((sh) => x.map((doh) => {
    const row = allRows.find((r) => Number(r.doh) === Number(doh) && Number(r.Sh) === Number(sh));
    if (!row) return null;
    if (hasFeasible && !(row.__target_ok && row.__criterion_ok)) return null;
    return row.__score;
  }));

  const heat = {
    type: 'heatmap',
    x,
    y,
    z,
    colorscale: 'Viridis',
    hovertemplate: 'd<sub>o</sub>/h=%{x}<br>S/h=%{y}<br>Score=%{z:.4f}<extra></extra>',
    colorbar: { title: 'Score' }
  };
  const predTrace = {
    x: [doPred],
    y: [shPred],
    mode: 'markers',
    marker: { symbol: 'x', size: 11, color: 'white', line: { color: 'black', width: 2 } },
    name: 'Inverse ML estimate',
    hovertemplate: 'Inverse ML estimate<br>d<sub>o</sub>/h=%{x:.3f}<br>S/h=%{y:.3f}<extra></extra>'
  };
  const recTrace = recommendedRow ? {
    x: [recommendedRow.doh],
    y: [recommendedRow.Sh],
    mode: 'markers',
    marker: { symbol: 'star', size: 13, color: '#ffb000', line: { color: '#222', width: 1 } },
    name: `Recommended FE ${recommendedRow.id}`,
    hovertemplate: `Recommended FE ${recommendedRow.id}<br>d<sub>o</sub>/h=%{x}<br>S/h=%{y}<extra></extra>`
  } : null;
  const selectedTrace = (selectedRow && (!recommendedRow || selectedRow.id !== recommendedRow.id)) ? {
    x: [selectedRow.doh],
    y: [selectedRow.Sh],
    mode: 'markers',
    marker: { symbol: 'circle-open', size: 13, color: '#111827', line: { color: '#111827', width: 2 } },
    name: `Selected FE ${selectedRow.id}`,
    hovertemplate: `Selected FE ${selectedRow.id}<br>d<sub>o</sub>/h=%{x}<br>S/h=%{y}<extra></extra>`
  } : null;

  const traces = [heat, predTrace];
  if (recTrace) traces.push(recTrace);
  if (selectedTrace) traces.push(selectedTrace);

  const layout = {
    margin: { l: 55, r: 25, t: 20, b: 50 },
    xaxis: { title: 'd<sub>o</sub>/h' },
    yaxis: { title: 'S/h' },
    legend: { orientation: 'h', y: -0.22 },
    paper_bgcolor: 'white',
    plot_bgcolor: 'white'
  };
  Plotly.newPlot('recommendationMap', traces, layout, { responsive: true, displayModeBar: false });
}

function passBadge(flag) {
  return `<span class="pass-badge ${flag ? 'pass' : 'fail'}">${flag ? 'Pass' : 'Fail'}</span>`;
}

function passSymbol(flag) {
  return `<span class="${flag ? 'status-yes' : 'status-no'}">${flag ? '✓' : '✕'}</span>`;
}

function interpolateBackboneAt(backbone, xTarget) {
  const xs = state.meta.rotations.map((x) => Number(x));
  const pairs = xs
    .map((x, i) => ({ x, y: backbone ? backbone[i] : null }))
    .filter((p) => p.y !== null && p.y !== undefined && !Number.isNaN(Number(p.y)));
  if (!pairs.length) return null;

  const exact = pairs.find((p) => Math.abs(p.x - xTarget) < 1e-12);
  if (exact) return Number(exact.y);

  for (let i = 0; i < pairs.length - 1; i += 1) {
    const a = pairs[i];
    const b = pairs[i + 1];
    if ((a.x <= xTarget && xTarget <= b.x) || (b.x <= xTarget && xTarget <= a.x)) {
      if (Math.abs(b.x - a.x) < 1e-12) return Number(a.y);
      const t = (xTarget - a.x) / (b.x - a.x);
      return Number(a.y) + t * (Number(b.y) - Number(a.y));
    }
  }

  return null;
}

function forwardStyleBackbone(backbone) {
  return FORWARD_BACKBONE_ROTATIONS.map((x) => interpolateBackboneAt(backbone, x));
}

function updateCandidateTable(rows, selectedRow) {
  const tbody = document.querySelector('#candidateTable tbody');
  tbody.innerHTML = rows.slice(0, 10).map((row, idx) => `
    <tr data-case-id="${row.id}" class="${(row.__target_ok && row.__criterion_ok) ? '' : 'dimmed'} ${selectedRow && selectedRow.id === row.id ? 'selected-row' : ''}">
      <td>${idx + 1}</td>
      <td>${row.id}</td>
      <td>${fmt(row.doh, 2)}</td>
      <td>${fmt(row.Sh, 2)}</td>
      <td>${fmt(row.My, 1)}</td>
      <td>${fmt(row.Mc, 1)}</td>
      <td>${fmt(row.Mu, 1)}</td>
      <td>${fmt(thetaDisplay(row), 4)}</td>
      <td>${passSymbol(row.__target_ok && row.__criterion_ok)}</td>
      <td>${passSymbol(row.__flags.j1)}</td>
      <td>${passSymbol(row.__flags.j2)}</td>
      <td>${passSymbol(row.__flags.j3)}</td>
    </tr>`).join('');

  tbody.querySelectorAll('tr').forEach((tr) => {
    tr.addEventListener('click', () => {
      state.selectedCaseId = tr.getAttribute('data-case-id');
      refresh();
    });
  });
}

function updateEstimateCards(doPred, shPred, recommendedRow, selectedRow, feasibleCount, totalRows) {
  const cards = [
    ['Inverse ML d<sub>o</sub>/h', fmt(doPred, 3)],
    ['Inverse ML S/h', fmt(shPred, 3)],
    ['Recommended FE case', recommendedRow ? recommendedRow.id : '—'],
    ['Recommended d<sub>o</sub>/h', recommendedRow ? fmt(recommendedRow.doh, 2) : '—'],
    ['Recommended S/h', recommendedRow ? fmt(recommendedRow.Sh, 2) : '—'],
    ['Feasible FE cases', `${feasibleCount} / ${totalRows}`],
    ['Selected FE case', selectedRow ? selectedRow.id : '—'],
    ['Backbone source', 'Forward GUI FE grid']
  ];
  document.getElementById('estimateCards').innerHTML = cards.map(([k, v]) => `<div class="card"><span class="k">${k}</span><span class="v">${v}</span></div>`).join('');
}

function updateCriteriaCards(rates, feasibleCount, totalRows) {
  const cards = [
    ['J1 rate', pct(rates.j1)],
    ['J2 rate', pct(rates.j2)],
    ['J3 rate', pct(rates.j3)],
    ['Target-feasible rate', pct(feasibleCount / Math.max(totalRows, 1))],
    ['θ<sub>u</sub> rule', '≥ 0.04 rad'],
    ['PEEQ<sub>CF</sub> rule', '≈ 0.0']
  ];
  document.getElementById('criteriaCards').innerHTML = cards.map(([k, v]) => `<div class="card"><span class="k">${k}</span><span class="v">${v}</span></div>`).join('');
}

function updateNotices(hasFeasible, allRows, activeRows, feasibleCount) {
  const box = document.getElementById('criterionNotice');
  const inputBox = document.getElementById('inputNotice');
  const ctx = currentContextMeta();

  const targetOutsideMy = Number(state.controls.My) > Number(ctx.My_max);
  const targetOutsideMc = Number(state.controls.Mc) > Number(ctx.Mc_max);
  const targetOutsideMu = Number(state.controls.Mu) > Number(ctx.Mu_max);
  const messages = [...state.clampMessages];
  if (targetOutsideMy || targetOutsideMc || targetOutsideMu) {
    messages.push('At least one minimum target exceeds the opening-only FE range in this beam context. A recommendation is still returned, but an opening solution may not exist.');
  }
  messages.push('Mu is conservative for run-out cases: when the 0.8Mc degradation point is not reached by 6% drift, Mu is shown as M0.06 and θu is shown as a lower bound of 0.06 rad.');
  inputBox.className = messages.some((m) => m.toLowerCase().includes('not exist') || m.toLowerCase().includes('clamped') || m.toLowerCase().includes('cannot')) ? 'notice-box warn' : 'notice-box ok';
  inputBox.innerHTML = messages.join(' ');

  const mapNote = document.getElementById('recommendationMapNote');
  if (hasFeasible) {
    box.className = 'notice-box ok';
    box.innerHTML = `${feasibleCount} of ${allRows.length} FE-backed opening cases satisfy the user minimum targets and ${criterionRuleText(state.criterion)}. The recommendation is the lowest-score feasible case, where the score favours closeness to the inverse ML geometry estimate and low overshoot above the minimum targets.`;
    mapNote.textContent = 'Blank cells do not satisfy the user minima and the active J-screen. Coloured cells are feasible candidates ranked by score.';
  } else {
    box.className = 'notice-box warn';
    if (state.criterion === 'None') {
      box.innerHTML = `No opening case in this beam context satisfies all four user minimum targets simultaneously. The table therefore falls back to nearest misses ranked by target shortfall plus consistency with the inverse ML geometry estimate.`;
    } else {
      box.innerHTML = `No opening case in this beam context satisfies the user minimum targets together with ${state.criterion}. The table therefore falls back to nearest misses ranked by target shortfall plus consistency with the inverse ML geometry estimate.`;
    }
    mapNote.textContent = 'No fully feasible case exists for the current targets. The map therefore shows all cases, ranked by shortfall and geometry consistency.';
  }
}

function updateSelectedCaseDetail(row, fullSection) {
  const theta = thetaDisplay(row);
  const items = [
    ['Model', row.model],
    ['Mechanism', `<span class="badge">${row.mechanism || '—'}</span>`],
    ['Target + J-screen', passBadge(row.__target_ok && row.__criterion_ok)],
    ['J1', passBadge(row.__flags.j1)],
    ['J2', passBadge(row.__flags.j2)],
    ['J3', passBadge(row.__flags.j3)],
    ['M<sub>y</sub> (kN·m)', `${fmt(row.My, 1)} / target ${fmt(state.controls.My, 1)}`],
    ['M<sub>c</sub> (kN·m)', `${fmt(row.Mc, 1)} / target ${fmt(state.controls.Mc, 1)}`],
    ['M<sub>u</sub> (kN·m)', `${fmt(row.Mu, 1)} / target ${fmt(state.controls.Mu, 1)}`],
    ['θ<sub>u</sub> (rad)', `${fmt(theta, 4)} / target ${fmt(state.controls.theta, 4)}`],
    ['M<sub>0.04</sub>/M<sub>p</sub>', fmt(row.M004_Mp, 3)],
    ['σ<sub>vm,CF</sub>/f<sub>y</sub>', fmt(row.sigma_ratio, 3)],
    ['PEEQ<sub>CF</sub>', fmt(row.PEEQCF, 3)],
    ['M<sub>c</sub>/M<sub>c,FS</sub>', fmt(row.Mc_McFS, 3)],
    ['M<sub>c,FS</sub> (kN·m)', fullSection ? fmt(fullSection.Mc, 1) : '—'],
    ['M<sub>u</sub> basis', row.Mu_basis === '0.8Mc' ? '0.8M<sub>c</sub>' : 'M<sub>0.06</sub> lower bound'],
    ['θ<sub>u</sub> basis', row.theta_basis === 'exact' ? 'exact 0.8M<sub>c</sub> drop point' : 'lower bound / run-out'],
    ['r<sub>CF</sub>', fmt(row.rCF, 3)],
    ['L<sub>ph</sub>/h', fmt(row.Lph_h, 3)],
  ];
  document.getElementById('bestCandidateDetail').innerHTML = items.map(([k, v]) => `<div class="card"><span class="k">${k}</span><span class="v">${v}</span></div>`).join('');
}

function sectionNumber(profile) {
  return String(profile).replace(/[^\d]/g, '');
}

function buildContourUrls(row, kind) {
  const repo = state.meta.contour_repo;
  const sec = sectionNumber(row.profile);
  const file = `${row.model}_${kind}.png`;
  return {
    primary: `${repo.pages_base}/${kind}/${row.grade}/${sec}/${file}`,
    fallback: `${repo.raw_base}/${kind}/${row.grade}/${sec}/${file}`
  };
}

function setImageWithFallback(imgId, linkId, urls) {
  const img = document.getElementById(imgId);
  const link = document.getElementById(linkId);
  img.dataset.triedFallback = '0';
  img.onerror = () => {
    if (img.dataset.triedFallback === '0') {
      img.dataset.triedFallback = '1';
      img.src = urls.fallback;
      link.href = urls.fallback;
      return;
    }
    img.onerror = null;
    img.alt = 'Contour image could not be loaded';
  };
  link.href = urls.primary;
  img.src = urls.primary;
}

function updateContours(row) {
  document.getElementById('contourCaption').innerHTML = `Contour images for <strong>${row.model}</strong>`;
  setImageWithFallback('vonMisesImg', 'vonMisesLink', buildContourUrls(row, 'VonMises'));
  setImageWithFallback('peeqImg', 'peeqLink', buildContourUrls(row, 'PEEQ'));
}

function refresh() {
  if (!state.meta || !state.contexts) return;
  updateBeamCards();

  const features = featureVectorFromControls();
  const doPred = clamp(
    predictXgb(state.xgbDo, features),
    state.meta.levels_do[0],
    state.meta.levels_do[state.meta.levels_do.length - 1]
  );
  const shPred = clamp(
    predictXgb(state.xgbSh, features),
    state.meta.levels_sh[0],
    state.meta.levels_sh[state.meta.levels_sh.length - 1]
  );

  const { allRows, activeRows, hasFeasible, feasibleCount } = rankRows(currentCandidates(), doPred, shPred);
  const fullSection = currentFullSection();
  const rates = contextRates(allRows);
  const recommendedRow = activeRows[0];
  const selectedRow = findSelectedRow(activeRows);

  updateEstimateCards(doPred, shPred, recommendedRow, selectedRow, feasibleCount, allRows.length);
  updateCriteriaCards(rates, feasibleCount, allRows.length);
  updateNotices(hasFeasible, allRows, activeRows, feasibleCount);
  updateCandidateTable(activeRows, selectedRow);
  updateSelectedCaseDetail(selectedRow, fullSection);
  updateContours(selectedRow);
  plotBackbone(selectedRow, recommendedRow, fullSection);
  plotRecommendationMap(allRows, doPred, shPred, selectedRow, recommendedRow, hasFeasible);
}

async function init() {
  try {
    const [meta, cand, xgbDo, xgbSh] = await Promise.all([
      fetch('assets/inverse_meta.json').then((r) => r.json()),
      fetch('assets/inverse_candidates.json').then((r) => r.json()),
      fetch('assets/xgb_inverse_doh_dump.json').then((r) => r.json()),
      fetch('assets/xgb_inverse_Sh_dump.json').then((r) => r.json()),
    ]);
    state.meta = meta;
    state.contexts = cand.contexts;
    state.xgbDo = xgbDo;
    state.xgbSh = xgbSh;
    buildSelectOptions();
    resetTargetControls();
    refresh();
  } catch (err) {
    console.error(err);
    document.body.innerHTML = `<div style="padding:24px;font-family:Arial,sans-serif"><h2>Failed to load inverse ML explorer assets</h2><p>${err}</p></div>`;
  }
}

init();
