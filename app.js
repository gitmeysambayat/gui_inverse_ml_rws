const state = {
  meta: null,
  contexts: null,
  xgbDo: null,
  xgbSh: null,
  profile: 'IPE400',
  grade: 'S275',
  lh: '9',
  criterion: 'J3',
  controls: { My: null, Mc: null },
  selectedCaseId: null,
};

const THETA_U_J = 0.04;
const M004_THRESHOLD = 0.8;
const SIGMA_THRESHOLD = 1.0;
const MCCRIT_THRESHOLD = 0.8;
const PEEQ_ZERO_TOL = 1e-12;

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

function passesTheta(candidate) {
  if (candidate.theta_u !== null && candidate.theta_u !== undefined && !Number.isNaN(Number(candidate.theta_u))) {
    return Number(candidate.theta_u) >= THETA_U_J;
  }
  return Boolean(candidate.theta_ge_006);
}

function thetaDisplay(candidate) {
  if (candidate.theta_u !== null && candidate.theta_u !== undefined && !Number.isNaN(Number(candidate.theta_u))) {
    return Number(candidate.theta_u);
  }
  if (candidate.theta_ge_006) return 0.06;
  if (candidate.theta_u_LB !== null && candidate.theta_u_LB !== undefined && !Number.isNaN(Number(candidate.theta_u_LB))) {
    return Number(candidate.theta_u_LB);
  }
  return null;
}

function candidateFlags(candidate) {
  const j1 = Number(candidate.M004_Mp) >= M004_THRESHOLD && passesTheta(candidate);
  const j2 = j1 && Number(candidate.sigma_ratio) <= SIGMA_THRESHOLD && Math.abs(Number(candidate.PEEQCF)) <= PEEQ_ZERO_TOL;
  const j3 = j2 && Number(candidate.Mc_McFS) >= MCCRIT_THRESHOLD;
  return { j1, j2, j3 };
}

function criterionRuleText(criterion) {
  if (criterion === 'J1') return 'M0.04 ≥ 0.8Mp and θu ≥ 4%';
  if (criterion === 'J2') return 'J1 and σvm,CF/Fy ≤ 1 and PEEQCF ≈ 0.0';
  if (criterion === 'J3') return 'J2 and Mc ≥ 0.8Mc,FS';
  return 'No Chapter 5 screen';
}

function activeCriterionFlag(flags) {
  if (state.criterion === 'None') return true;
  return flags[state.criterion.toLowerCase()];
}

function featureVectorFromControls() {
  const section = state.meta.section_lookup[state.profile];
  const fy = state.meta.grade_lookup[state.grade];
  const ctx = currentContextMeta();
  const MyMp = Number(state.controls.My) / Math.max(Number(ctx.Mp), 1e-9);
  const OmegaS = Number(state.controls.Mc) / Math.max(Number(state.controls.My), 1e-9);
  return [
    section.h_mm,
    section.b_mm,
    section.tw_mm,
    section.tf_mm,
    fy,
    Number(state.lh),
    MyMp,
    OmegaS
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
    resetStrengthControls();
    refresh();
  });
  gradeSelect.addEventListener('change', (e) => {
    state.grade = e.target.value;
    resetStrengthControls();
    refresh();
  });
  lhSelect.addEventListener('change', (e) => {
    state.lh = e.target.value;
    resetStrengthControls();
    refresh();
  });
  document.getElementById('criterionSelect').addEventListener('change', (e) => {
    state.criterion = e.target.value;
    refresh();
  });
}

function strengthDomains() {
  const meta = currentContextMeta();
  const MyMin = Number(meta.My_min);
  const MyMax = Math.max(Number(meta.My_max), Number(meta.My_FS));
  const McMin = Number(meta.Mc_min);
  const McMax = Math.max(Number(meta.Mc_max), Number(meta.Mc_FS));
  return { MyMin, MyMax, McMin, McMax };
}

function median(values) {
  const arr = [...values].filter((v) => v !== null && v !== undefined && !Number.isNaN(Number(v))).sort((a, b) => a - b);
  const m = Math.floor(arr.length / 2);
  return arr.length % 2 ? arr[m] : 0.5 * (arr[m - 1] + arr[m]);
}

function resetStrengthControls() {
  const rows = currentCandidates();
  state.controls.My = median(rows.map((r) => Number(r.My)));
  state.controls.Mc = median(rows.map((r) => Number(r.Mc)));
  state.selectedCaseId = null;
  renderStrengthControls();
}

function renderStrengthControls() {
  const wrap = document.getElementById('strengthControlStack');
  wrap.innerHTML = '';
  const dom = strengthDomains();
  const defs = [
    {
      key: 'My',
      label: 'Target M<sub>y</sub> (kN·m)',
      lo: dom.MyMin,
      hi: dom.MyMax
    },
    {
      key: 'Mc',
      label: 'Target M<sub>c</sub> (kN·m)',
      lo: dom.McMin,
      hi: dom.McMax
    }
  ];
  defs.forEach((def) => {
    const block = document.createElement('div');
    block.className = 'control-block';

    const top = document.createElement('div');
    top.className = 'control-top';
    const lab = document.createElement('label');
    lab.innerHTML = def.label;
    const val = document.createElement('span');
    val.id = `value-${def.key}`;
    val.style.fontSize = '12px';
    val.style.color = 'var(--muted)';
    val.textContent = fmt(state.controls[def.key], 1);
    top.appendChild(lab);
    top.appendChild(val);

    const inline = document.createElement('div');
    inline.className = 'control-inline';

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = def.lo;
    slider.max = def.hi;
    slider.step = Math.max((def.hi - def.lo) / 400, 0.1);
    slider.value = state.controls[def.key];
    slider.id = `slider-${def.key}`;

    const numeric = document.createElement('input');
    numeric.type = 'number';
    numeric.min = def.lo;
    numeric.max = def.hi;
    numeric.step = Math.max((def.hi - def.lo) / 400, 0.1);
    numeric.value = state.controls[def.key];
    numeric.id = `num-${def.key}`;

    const note = document.createElement('div');
    note.className = 'control-range-note';
    const ctxMeta = currentContextMeta();
    if (def.key === 'My') {
      note.innerHTML = `Opening-domain range: ${fmt(ctxMeta.My_min, 1)} to ${fmt(ctxMeta.My_max, 1)} kN·m. Full section reference: ${fmt(ctxMeta.My_FS, 1)} kN·m.`;
    } else {
      note.innerHTML = `Opening-domain range: ${fmt(ctxMeta.Mc_min, 1)} to ${fmt(ctxMeta.Mc_max, 1)} kN·m. Full section reference: ${fmt(ctxMeta.Mc_FS, 1)} kN·m.`;
    }

    const updateValue = (raw) => {
      const v = clamp(Number(raw), def.lo, def.hi);
      state.controls[def.key] = v;
      slider.value = v;
      numeric.value = v;
      val.textContent = fmt(v, 1);
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
    ['M<sub>y</sub> opening range', `${fmt(ctx.My_min, 1)} to ${fmt(ctx.My_max, 1)}`],
    ['M<sub>c</sub> opening range', `${fmt(ctx.Mc_min, 1)} to ${fmt(ctx.Mc_max, 1)}`],
    ['Active filter', state.criterion],
  ];
  document.getElementById('rangeCards').innerHTML = ranges.map(([k, v]) => `<div class="card"><span class="k">${k}</span><span class="v">${v}</span></div>`).join('');
}

function rankRows(rows, doPred, shPred) {
  const ctx = currentContextMeta();
  const spanMy = Math.max(Number(ctx.My_max) - Number(ctx.My_min), 1e-9);
  const spanMc = Math.max(Number(ctx.Mc_max) - Number(ctx.Mc_min), 1e-9);
  const enriched = rows.map((r) => {
    const flags = candidateFlags(r);
    const myErr = (Number(r.My) - Number(state.controls.My)) / spanMy;
    const mcErr = (Number(r.Mc) - Number(state.controls.Mc)) / spanMc;
    const geomErr = ((Number(r.doh) - doPred) / Math.max(state.meta.levels_do[state.meta.levels_do.length - 1] - state.meta.levels_do[0], 1e-9)) ** 2
      + ((Number(r.Sh) - shPred) / Math.max(state.meta.levels_sh[state.meta.levels_sh.length - 1] - state.meta.levels_sh[0], 1e-9)) ** 2;
    const score = myErr * myErr + mcErr * mcErr + 1e-6 * geomErr;
    return {
      ...r,
      __flags: flags,
      __criterion_ok: activeCriterionFlag(flags),
      __score: score,
      __my_err: Number(r.My) - Number(state.controls.My),
      __mc_err: Number(r.Mc) - Number(state.controls.Mc),
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

function findSelectedRow(activeRows) {
  if (state.selectedCaseId) {
    const match = activeRows.find((r) => r.id === state.selectedCaseId);
    if (match) return match;
  }
  state.selectedCaseId = activeRows[0] ? activeRows[0].id : null;
  return activeRows[0];
}

function plotBackbone(selectedRow, topRow, fullSection) {
  const traces = [];
  if (fullSection) {
    traces.push({
      x: state.meta.rotations,
      y: fullSection.backbone,
      mode: 'lines',
      name: `Full section ${fullSection.id}`,
      line: { width: 2, dash: 'dash', color: '#767676' }
    });
  }
  if (topRow) {
    traces.push({
      x: state.meta.rotations,
      y: topRow.backbone,
      mode: 'lines',
      name: `Top FE ${topRow.id}`,
      line: { width: 3, color: '#2a5bd7' }
    });
  }
  if (selectedRow && (!topRow || selectedRow.id !== topRow.id)) {
    traces.push({
      x: state.meta.rotations,
      y: selectedRow.backbone,
      mode: 'lines',
      name: `Selected FE ${selectedRow.id}`,
      line: { width: 4, color: '#111827' }
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

function plotMismatchMap(allRows, doPred, shPred, selectedRow, topRow, hasPass) {
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
    marker: { symbol: 'x', size: 11, color: 'white', line: { color: 'black', width: 2 } },
    name: 'Inverse ML estimate',
    hovertemplate: 'Inverse ML estimate<br>d<sub>o</sub>/h=%{x:.3f}<br>S/h=%{y:.3f}<extra></extra>'
  };
  const topTrace = topRow ? {
    x: [topRow.doh],
    y: [topRow.Sh],
    mode: 'markers',
    marker: { symbol: 'star', size: 13, color: '#ffb000', line: { color: '#222', width: 1 } },
    name: `Top FE ${topRow.id}`,
    hovertemplate: `Top FE ${topRow.id}<br>d<sub>o</sub>/h=%{x}<br>S/h=%{y}<extra></extra>`
  } : null;
  const selectedTrace = (selectedRow && (!topRow || selectedRow.id !== topRow.id)) ? {
    x: [selectedRow.doh],
    y: [selectedRow.Sh],
    mode: 'markers',
    marker: { symbol: 'circle-open', size: 13, color: '#111827', line: { color: '#111827', width: 2 } },
    name: `Selected FE ${selectedRow.id}`,
    hovertemplate: `Selected FE ${selectedRow.id}<br>d<sub>o</sub>/h=%{x}<br>S/h=%{y}<extra></extra>`
  } : null;

  const traces = [heat, predTrace];
  if (topTrace) traces.push(topTrace);
  if (selectedTrace) traces.push(selectedTrace);

  const layout = {
    margin: { l: 55, r: 25, t: 20, b: 50 },
    xaxis: { title: 'd<sub>o</sub>/h' },
    yaxis: { title: 'S/h' },
    legend: { orientation: 'h', y: -0.22 },
    paper_bgcolor: 'white',
    plot_bgcolor: 'white'
  };
  Plotly.newPlot('mismatchMap', traces, layout, { responsive: true, displayModeBar: false });
}

function passBadge(flag) {
  return `<span class="pass-badge ${flag ? 'pass' : 'fail'}">${flag ? 'Pass' : 'Fail'}</span>`;
}

function passSymbol(flag) {
  return `<span class="${flag ? 'status-yes' : 'status-no'}">${flag ? '✓' : '✕'}</span>`;
}

function updateCandidateTable(rows, selectedRow) {
  const tbody = document.querySelector('#candidateTable tbody');
  tbody.innerHTML = rows.slice(0, 10).map((row, idx) => `
    <tr data-case-id="${row.id}" class="${row.__criterion_ok ? '' : 'dimmed'} ${selectedRow && selectedRow.id === row.id ? 'selected-row' : ''}">
      <td>${idx + 1}</td>
      <td>${row.id}</td>
      <td>${fmt(row.doh, 2)}</td>
      <td>${fmt(row.Sh, 2)}</td>
      <td>${fmt(row.My, 1)}</td>
      <td>${fmt(row.__my_err, 1)}</td>
      <td>${fmt(row.Mc, 1)}</td>
      <td>${fmt(row.__mc_err, 1)}</td>
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

function updateEstimateCards(doPred, shPred, topRow, selectedRow, allRows) {
  const cards = [
    ['Inverse ML d<sub>o</sub>/h', fmt(doPred, 3)],
    ['Inverse ML S/h', fmt(shPred, 3)],
    ['Top FE case', topRow ? topRow.id : '—'],
    ['Selected FE case', selectedRow ? selectedRow.id : '—'],
    ['Top FE M<sub>y</sub> (kN·m)', topRow ? fmt(topRow.My, 1) : '—'],
    ['Top FE M<sub>c</sub> (kN·m)', topRow ? fmt(topRow.Mc, 1) : '—'],
  ];
  document.getElementById('estimateCards').innerHTML = cards.map(([k, v]) => `<div class="card"><span class="k">${k}</span><span class="v">${v}</span></div>`).join('');
}

function updateCriteriaCards(rates) {
  const cards = [
    ['J1 rate', pct(rates.j1)],
    ['J2 rate', pct(rates.j2)],
    ['J3 rate', pct(rates.j3)],
    ['θ<sub>u</sub> rule', '≥ 4%'],
    ['PEEQ<sub>CF</sub> rule', '≈ 0.0'],
    ['M<sub>c</sub> rule', '≥ 0.8 M<sub>c,FS</sub>'],
  ];
  document.getElementById('criteriaCards').innerHTML = cards.map(([k, v]) => `<div class="card"><span class="k">${k}</span><span class="v">${v}</span></div>`).join('');
}

function updateNotices(hasPass, allRows, activeRows) {
  const box = document.getElementById('criterionNotice');
  const inputBox = document.getElementById('inputNotice');
  const ctx = currentContextMeta();
  const targetOutsideMy = Number(state.controls.My) < Number(ctx.My_min) || Number(state.controls.My) > Number(ctx.My_max);
  const targetOutsideMc = Number(state.controls.Mc) < Number(ctx.Mc_min) || Number(state.controls.Mc) > Number(ctx.Mc_max);
  const invalidStrengthOrdering = Number(state.controls.Mc) < Number(state.controls.My);

  const messages = [];
  if (invalidStrengthOrdering) {
    messages.push('Target Mc is below target My. That is mechanically odd, so the nearest FE opening will still be returned but the request is internally inconsistent.');
  }
  if (targetOutsideMy || targetOutsideMc) {
    messages.push('At least one target strength lies outside the opening-only FE range in this beam context. The closest opening case is shown, while the full section remains the strength reference.');
  }
  if (messages.length) {
    inputBox.className = 'notice-box warn';
    inputBox.innerHTML = messages.join(' ');
  } else {
    inputBox.className = 'notice-box ok';
    inputBox.innerHTML = 'Target strengths lie inside the opening-domain range for the selected beam context.';
  }

  const scoreMapNote = document.getElementById('mismatchMapNote');
  if (state.criterion === 'None') {
    box.className = 'notice-box';
    box.innerHTML = 'No Chapter 5 screening filter is active. FE cases are ranked only by strength mismatch against the target My and Mc values.';
    scoreMapNote.textContent = 'Lower score means closer agreement with the target My and Mc';
    return;
  }
  if (hasPass) {
    box.className = 'notice-box ok';
    box.innerHTML = `${activeRows.length} of ${allRows.length} FE-backed opening cases satisfy ${state.criterion}, defined here as ${criterionRuleText(state.criterion)}. The ranked list is filtered to those passing cases.`;
    scoreMapNote.textContent = `Blank cells fail ${state.criterion}; coloured cells satisfy it and are ranked by strength mismatch`;
  } else {
    box.className = 'notice-box warn';
    box.innerHTML = `No opening case in this beam context satisfies ${state.criterion}. The table therefore falls back to the closest strength matches instead of returning an empty list.`;
    scoreMapNote.textContent = `No case satisfies ${state.criterion}; the map therefore shows all cases by strength mismatch`;
  }
}

function updateSelectedCaseDetail(row, fullSection) {
  const items = [
    ['Model', row.model],
    ['Mechanism', `<span class="badge">${row.mechanism || '—'}</span>`],
    ['J1', passBadge(row.__flags.j1)],
    ['J2', passBadge(row.__flags.j2)],
    ['J3', passBadge(row.__flags.j3)],
    ['M<sub>y</sub> (kN·m)', fmt(row.My, 1)],
    ['M<sub>c</sub> (kN·m)', fmt(row.Mc, 1)],
    ['M<sub>0.04</sub>/M<sub>p</sub>', fmt(row.M004_Mp, 3)],
    ['θ<sub>u</sub> (rad)', fmt(row.theta_u, 4)],
    ['θ<sub>u</sub> ≥ 0.06', row.theta_ge_006 ? 'Yes' : 'No'],
    ['σ<sub>vm,CF</sub>/f<sub>y</sub>', fmt(row.sigma_ratio, 3)],
    ['PEEQ<sub>CF</sub>', fmt(row.PEEQCF, 3)],
    ['M<sub>c</sub>/M<sub>c,FS</sub>', fmt(row.Mc_McFS, 3)],
    ['M<sub>c,FS</sub> (kN·m)', fullSection ? fmt(fullSection.Mc, 1) : '—'],
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

  const { allRows, activeRows, hasPass } = rankRows(currentCandidates(), doPred, shPred);
  const fullSection = currentFullSection();
  const rates = contextRates(allRows);
  const topRow = activeRows[0];
  const selectedRow = findSelectedRow(activeRows);

  updateEstimateCards(doPred, shPred, topRow, selectedRow, allRows);
  updateCriteriaCards(rates);
  updateNotices(hasPass, allRows, activeRows);
  updateCandidateTable(activeRows, selectedRow);
  updateSelectedCaseDetail(selectedRow, fullSection);
  updateContours(selectedRow);
  plotBackbone(selectedRow, topRow, fullSection);
  plotMismatchMap(allRows, doPred, shPred, selectedRow, topRow, hasPass);
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
    resetStrengthControls();
    refresh();
  } catch (err) {
    console.error(err);
    document.body.innerHTML = `<div style="padding:24px;font-family:Arial,sans-serif"><h2>Failed to load inverse ML explorer assets</h2><p>${err}</p></div>`;
  }
}

init();
