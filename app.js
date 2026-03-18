const state = {
  meta: null,
  contexts: null,
  xgbDo: null,
  xgbSh: null,
  profile: 'IPE400',
  grade: 'S275',
  lh: '9',
  preset: 'Balanced',
  criterion: 'J3',
  j3Tau: 0.05,
  controls: {},
};

const prettyMap = {
  'M0.04/Mp': 'M<sub>0.04</sub>/M<sub>p</sub>',
  'M0.06/M0.06,FS': 'M<sub>0.06</sub>/M<sub>0.06,FS</sub>',
  'Ed/Ed,FS': 'E<sub>d</sub>/E<sub>d,FS</sub>',
  'σvm,CF/fy': 'σ<sub>vm,CF</sub>/f<sub>y</sub>',
  'PEEQCF': 'PEEQ<sub>CF</sub>',
  'Lph/h': 'L<sub>ph</sub>/h',
  'θu,LB (rad)': 'θ<sub>u,LB</sub> (rad)',
};

const dataKeyMap = {
  'M0.04/Mp': 'M004_Mp',
  'M0.06/M0.06,FS': 'M006_M006FS',
  'Ed/Ed,FS': 'Ed_ratio',
  'σvm,CF/fy': 'sigma_ratio',
  'PEEQCF': 'PEEQCF',
  'Lph/h': 'Lph_h',
  'θu,LB (rad)': 'theta_u_LB',
};

const beneficialMetrics = new Set([
  'M0.04/Mp',
  'M0.06/M0.06,FS',
  'Ed/Ed,FS',
  'Lph/h',
  'θu,LB (rad)'
]);

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

function criterionLabel() {
  if (state.criterion === 'None') return 'None';
  if (state.criterion === 'J3') return `J3 (τ=${fmt(state.j3Tau, 3)})`;
  return state.criterion;
}

function passBadge(flag) {
  return `<span class="pass-badge ${flag ? 'pass' : 'fail'}">${flag ? 'Pass' : 'Fail'}</span>`;
}

function passSymbol(flag) {
  return `<span class="${flag ? 'status-yes' : 'status-no'}">${flag ? '✓' : '✕'}</span>`;
}

function featureVectorFromControls() {
  const section = state.meta.section_lookup[state.profile];
  const fy = state.meta.grade_lookup[state.grade];
  return [
    section.h_mm,
    section.b_mm,
    section.tw_mm,
    section.tf_mm,
    fy,
    Number(state.lh),
    state.controls['M0.04/Mp'],
    state.controls['M0.06/M0.06,FS'],
    state.controls['Ed/Ed,FS'],
    state.controls['σvm,CF/fy'],
    state.controls['PEEQCF'],
    state.controls['Lph/h'],
    state.controls['θu,LB (rad)'],
  ];
}

function evaluateTree(node, features) {
  if (Object.prototype.hasOwnProperty.call(node, 'leaf')) {
    return Number(node.leaf);
  }
  const splitIndex = typeof node.split === 'string' && node.split.startsWith('f')
    ? Number(node.split.slice(1))
    : state.meta.feature_order.indexOf(node.split);
  const value = features[splitIndex];
  const nextId = value < Number(node.split_condition) ? node.yes : node.no;
  const child = node.children.find((c) => Number(c.nodeid) === Number(nextId));
  return evaluateTree(child, features);
}

function predictXgb(model, features) {
  let out = Number(model.base_score);
  for (const tree of model.trees) {
    out += evaluateTree(tree, features);
  }
  return out;
}

function currentContextKey() {
  return `${state.profile}|${state.grade}|${state.lh}`;
}

function currentCandidates() {
  return state.contexts[currentContextKey()] || [];
}

function candidateFlags(candidate) {
  const j1 = Number(candidate.M004_Mp) >= 0.8;
  const j2 = j1 && Number(candidate.sigma_ratio) <= 1.0;
  const j3 = j2 && Number(candidate.PEEQCF) <= Number(state.j3Tau);
  return { j1, j2, j3 };
}

function activeCriterionFlag(flags) {
  if (state.criterion === 'None') return true;
  return flags[state.criterion.toLowerCase()];
}

function scoreCandidate(candidate) {
  const weights = state.meta.score_meta[state.preset].weights;
  let score = 0;
  Object.entries(weights).forEach(([metric, weight]) => {
    const key = dataKeyMap[metric];
    const target = state.controls[metric];
    const actual = candidate[key];
    const [lo, hi] = state.meta.metric_ranges[metric];
    const span = Math.max(hi - lo, 1e-9);
    let penalty;
    if (beneficialMetrics.has(metric)) {
      penalty = Math.max(0, target - actual) / span;
    } else {
      penalty = Math.max(0, actual - target) / span;
    }
    score += weight * penalty * penalty;
  });
  return score;
}

function nearestGeometryCandidate(candidates, doPred, shPred) {
  let best = null;
  let bestDist = Infinity;
  candidates.forEach((row) => {
    const d = Math.hypot(Number(row.doh) - doPred, Number(row.Sh) - shPred);
    if (d < bestDist) {
      bestDist = d;
      best = row;
    }
  });
  return { row: best, distance: bestDist };
}

function median(values) {
  const arr = [...values].sort((a, b) => a - b);
  const m = Math.floor(arr.length / 2);
  return arr.length % 2 ? arr[m] : 0.5 * (arr[m - 1] + arr[m]);
}

function buildSelectOptions() {
  const profiles = Object.keys(state.meta.section_lookup);
  const grades = Object.keys(state.meta.grade_lookup);
  const lhs = [...new Set(Object.keys(state.contexts).map((k) => k.split('|')[2]))].sort((a, b) => Number(a) - Number(b));

  const profileSelect = document.getElementById('profileSelect');
  const gradeSelect = document.getElementById('gradeSelect');
  const lhSelect = document.getElementById('lhSelect');

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

  profileSelect.addEventListener('change', (e) => {
    state.profile = e.target.value;
    resetControlsToContextMedians();
    refresh();
  });
  gradeSelect.addEventListener('change', (e) => {
    state.grade = e.target.value;
    resetControlsToContextMedians();
    refresh();
  });
  lhSelect.addEventListener('change', (e) => {
    state.lh = e.target.value;
    resetControlsToContextMedians();
    refresh();
  });
  document.getElementById('presetSelect').addEventListener('change', (e) => {
    state.preset = e.target.value;
    refresh();
  });
  document.getElementById('criterionSelect').addEventListener('change', (e) => {
    state.criterion = e.target.value;
    refresh();
  });
  document.getElementById('j3TauInput').addEventListener('change', (e) => {
    state.j3Tau = clamp(Number(e.target.value), 0.005, 0.150);
    e.target.value = state.j3Tau;
    refresh();
  });
}

function resetControlsToContextMedians() {
  const rows = currentCandidates();
  Object.keys(state.meta.metric_ranges).forEach((metric) => {
    const key = dataKeyMap[metric];
    const values = rows.map((r) => Number(r[key]));
    const med = values.length ? median(values) : 0.5 * (state.meta.metric_ranges[metric][0] + state.meta.metric_ranges[metric][1]);
    state.controls[metric] = med;
  });
  renderControls();
}

function renderControls() {
  const stack = document.getElementById('controlStack');
  stack.innerHTML = '';
  Object.entries(state.meta.metric_ranges).forEach(([metric, range]) => {
    const [lo, hi] = range;
    const wrap = document.createElement('div');
    wrap.className = 'control-block';

    const top = document.createElement('div');
    top.className = 'control-top';
    const lab = document.createElement('label');
    lab.innerHTML = prettyMap[metric] || metric;
    const span = document.createElement('span');
    span.id = `label-${metric}`;
    span.textContent = fmt(state.controls[metric], 3);
    span.style.fontSize = '12px';
    span.style.color = 'var(--muted)';
    top.appendChild(lab);
    top.appendChild(span);
    wrap.appendChild(top);

    const inline = document.createElement('div');
    inline.className = 'control-inline';
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = lo;
    slider.max = hi;
    slider.step = (hi - lo) / 200;
    slider.value = state.controls[metric];
    slider.id = `slider-${metric}`;

    const numeric = document.createElement('input');
    numeric.type = 'number';
    numeric.min = lo;
    numeric.max = hi;
    numeric.step = (hi - lo) / 200;
    numeric.value = state.controls[metric];
    numeric.id = `num-${metric}`;

    const updateValue = (raw) => {
      const v = clamp(Number(raw), lo, hi);
      state.controls[metric] = v;
      slider.value = v;
      numeric.value = v;
      span.textContent = fmt(v, 3);
      refresh();
    };
    slider.addEventListener('input', (e) => updateValue(e.target.value));
    numeric.addEventListener('change', (e) => updateValue(e.target.value));

    inline.appendChild(slider);
    inline.appendChild(numeric);
    wrap.appendChild(inline);
    stack.appendChild(wrap);
  });
}

function updateBeamPropsCards() {
  const section = state.meta.section_lookup[state.profile];
  const fy = state.meta.grade_lookup[state.grade];
  const data = [
    ['h (mm)', fmt(section.h_mm, 0)],
    ['b (mm)', fmt(section.b_mm, 0)],
    ['t<sub>w</sub> (mm)', fmt(section.tw_mm, 1)],
    ['t<sub>f</sub> (mm)', fmt(section.tf_mm, 1)],
    ['f<sub>y</sub> (MPa)', fmt(fy, 0)],
    ['2L/h', state.lh],
  ];
  const wrap = document.getElementById('beamPropsCard');
  wrap.innerHTML = data.map(([k, v]) => `<div class="card"><span class="k">${k}</span><span class="v">${v}</span></div>`).join('');
}

function rankRows(rows) {
  const enriched = rows.map((r) => {
    const flags = candidateFlags(r);
    return {
      ...r,
      __flags: flags,
      __criterion_ok: activeCriterionFlag(flags),
      __score: scoreCandidate(r),
    };
  });

  const passing = state.criterion === 'None' ? enriched : enriched.filter((r) => r.__criterion_ok);
  const activeRows = (passing.length ? passing : enriched).sort((a, b) => a.__score - b.__score);
  const allRows = enriched.sort((a, b) => a.__score - b.__score);
  return { allRows, activeRows, hasPass: passing.length > 0 };
}

function contextRates(allRows) {
  const n = Math.max(allRows.length, 1);
  return {
    j1: allRows.filter((r) => r.__flags.j1).length / n,
    j2: allRows.filter((r) => r.__flags.j2).length / n,
    j3: allRows.filter((r) => r.__flags.j3).length / n,
  };
}

function plotBackbone(topRows) {
  const traces = topRows.slice(0, 3).map((row, idx) => ({
    x: state.meta.rotations,
    y: row.backbone,
    mode: 'lines',
    name: `Rank ${idx + 1} · ${row.id}`,
    line: { width: idx === 0 ? 4 : 2.6 },
  }));
  const layout = {
    margin: { l: 60, r: 25, t: 25, b: 55 },
    xaxis: { title: 'Rotation (rad)', zeroline: true },
    yaxis: { title: 'Moment (kN·m)', zeroline: true },
    legend: { orientation: 'h', y: -0.22 },
    paper_bgcolor: 'white',
    plot_bgcolor: 'white',
  };
  Plotly.newPlot('backbonePlot', traces, layout, { responsive: true, displayModeBar: false });
}

function plotScoreMap(allRows, doPred, shPred, topRow, hasPass) {
  const x = state.meta.levels_do;
  const y = state.meta.levels_sh;
  const z = y.map((sh) => x.map((doh) => {
    const row = allRows.find((r) => Number(r.doh) === Number(doh) && Number(r.Sh) === Number(sh));
    if (!row) return null;
    if (state.criterion !== 'None' && hasPass && !row.__criterion_ok) return null;
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
    marker: { symbol: 'x', size: 12, color: 'white', line: { color: 'black', width: 2 } },
    name: 'XGB estimate',
    hovertemplate: 'XGB estimate<br>d<sub>o</sub>/h=%{x:.3f}<br>S/h=%{y:.3f}<extra></extra>'
  };
  const topTrace = {
    x: [topRow.doh],
    y: [topRow.Sh],
    mode: 'markers',
    marker: { symbol: 'star', size: 14, color: '#ffb000', line: { color: '#222', width: 1 } },
    name: `Top FE case ${topRow.id}`,
    hovertemplate: `Top FE case ${topRow.id}<br>d<sub>o</sub>/h=%{x}<br>S/h=%{y}<extra></extra>`
  };
  const layout = {
    margin: { l: 55, r: 25, t: 20, b: 50 },
    xaxis: { title: 'd<sub>o</sub>/h' },
    yaxis: { title: 'S/h' },
    legend: { orientation: 'h', y: -0.22 },
    paper_bgcolor: 'white',
    plot_bgcolor: 'white',
  };
  Plotly.newPlot('scoreMap', [heat, predTrace, topTrace], layout, { responsive: true, displayModeBar: false });
}

function updateCandidateTable(rows) {
  const tbody = document.querySelector('#candidateTable tbody');
  tbody.innerHTML = rows.slice(0, 8).map((row, idx) => `
    <tr class="${row.__criterion_ok ? '' : 'dimmed'}">
      <td>${idx + 1}</td>
      <td>${row.id}</td>
      <td>${fmt(row.doh, 2)}</td>
      <td>${fmt(row.Sh, 2)}</td>
      <td>${fmt(row.__score, 4)}</td>
      <td>${passSymbol(row.__flags.j1)}</td>
      <td>${passSymbol(row.__flags.j2)}</td>
      <td>${passSymbol(row.__flags.j3)}</td>
      <td>${fmt(row.M004_Mp, 3)}</td>
      <td>${fmt(row.sigma_ratio, 3)}</td>
    </tr>`).join('');
}

function updateEstimateCards(doPred, shPred, nearest, topRows, allRows, rates) {
  const top = topRows[0];
  const activeCount = allRows.filter((r) => r.__criterion_ok).length;
  const cards = [
    ['XGB d<sub>o</sub>/h', fmt(doPred, 3)],
    ['XGB S/h', fmt(shPred, 3)],
    ['Nearest FE case', nearest.row ? nearest.row.id : '—'],
    ['Active criterion', criterionLabel()],
    ['Passing FE cases', `${activeCount}/${allRows.length}`],
    ['Top ranked case', top.id],
  ];
  document.getElementById('estimateCards').innerHTML = cards.map(([k, v]) => `<div class="card"><span class="k">${k}</span><span class="v">${v}</span></div>`).join('');
}

function updateCriteriaCards(rates) {
  const cards = [
    ['J1 rate', pct(rates.j1)],
    ['J2 rate', pct(rates.j2)],
    [`J3 rate`, pct(rates.j3)],
    ['J3 τ', fmt(state.j3Tau, 3)],
  ];
  document.getElementById('criteriaCards').innerHTML = cards.map(([k, v]) => `<div class="card"><span class="k">${k}</span><span class="v">${v}</span></div>`).join('');
}

function updateNotice(hasPass, allRows, activeRows) {
  const box = document.getElementById('criterionNotice');
  const scoreMapNote = document.getElementById('scoreMapNote');
  if (state.criterion === 'None') {
    box.className = 'notice-box';
    box.textContent = '';
    scoreMapNote.textContent = 'Lower score indicates closer agreement with the selected target set';
    return;
  }
  if (hasPass) {
    box.className = 'notice-box ok';
    box.textContent = `${criterionLabel()} is active. ${activeRows.length} of ${allRows.length} FE-backed geometries in this beam context satisfy the criterion.`;
    scoreMapNote.textContent = `Blank cells fail ${criterionLabel()}; coloured cells satisfy it and are ranked by inverse ML score`;
  } else {
    box.className = 'notice-box warn';
    box.textContent = `No FE-backed geometry in this beam context satisfies ${criterionLabel()}. The table therefore shows the lowest-penalty alternatives instead of an empty result.`;
    scoreMapNote.textContent = `No cell satisfies ${criterionLabel()} in this context; the map shows all cells by inverse ML score`;
  }
}

function updateBestCandidateDetail(top) {
  const items = [
    ['Mechanism', `<span class="badge">${top.mechanism}</span>`],
    ['Model', top.model],
    ['J1', passBadge(top.__flags.j1)],
    ['J2', passBadge(top.__flags.j2)],
    ['J3', passBadge(top.__flags.j3)],
    ['M<sub>0.04</sub>/M<sub>p</sub>', fmt(top.M004_Mp, 3)],
    ['M<sub>0.06</sub>/M<sub>0.06,FS</sub>', fmt(top.M006_M006FS, 3)],
    ['E<sub>d</sub>/E<sub>d,FS</sub>', fmt(top.Ed_ratio, 3)],
    ['σ<sub>vm,CF</sub>/f<sub>y</sub>', fmt(top.sigma_ratio, 3)],
    ['PEEQ<sub>CF</sub>', fmt(top.PEEQCF, 3)],
    ['L<sub>ph</sub>/h', fmt(top.Lph_h, 3)],
    ['θ<sub>u,LB</sub> (rad)', fmt(top.theta_u_LB, 4)],
  ];
  document.getElementById('bestCandidateDetail').innerHTML = items.map(([k, v]) => `<div class="card"><span class="k">${k}</span><span class="v">${v}</span></div>`).join('');
}

function refresh() {
  if (!state.meta || !state.contexts) return;
  updateBeamPropsCards();
  const features = featureVectorFromControls();
  const doPred = clamp(predictXgb(state.xgbDo, features), state.meta.levels_do[0], state.meta.levels_do[state.meta.levels_do.length - 1]);
  const shPred = clamp(predictXgb(state.xgbSh, features), state.meta.levels_sh[0], state.meta.levels_sh[state.meta.levels_sh.length - 1]);

  const { allRows, activeRows, hasPass } = rankRows(currentCandidates());
  const nearest = nearestGeometryCandidate(activeRows, doPred, shPred);
  const rates = contextRates(allRows);

  updateEstimateCards(doPred, shPred, nearest, activeRows, allRows, rates);
  updateCriteriaCards(rates);
  updateNotice(hasPass, allRows, activeRows);
  updateCandidateTable(activeRows);
  updateBestCandidateDetail(activeRows[0]);
  plotBackbone(activeRows);
  plotScoreMap(allRows, doPred, shPred, activeRows[0], hasPass);
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
    resetControlsToContextMedians();
    refresh();
  } catch (err) {
    console.error(err);
    document.body.innerHTML = `<div style="padding:24px;font-family:Arial,sans-serif"><h2>Failed to load inverse ML explorer assets</h2><p>${err}</p></div>`;
  }
}

init();
