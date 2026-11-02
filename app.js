'use strict';

const SECTIONS = [
  ['s-overview', '总览', '01'],
  ['s-field', '三维场重建', '02'],
  ['s-radiation', '辐射热流', '03'],
  ['s-path', '反应路径诊断', '04'],
  ['s-sensor', '传感器设计', '05'],
  ['s-mpc', 'MPC 策略', '06'],
  ['s-shots', '现场截图', '07'],
];

const COLORS = {
  red: '#e60008',
  cyan: '#22c7d0',
  blue: '#4f8bff',
  amber: '#ffb020',
  green: '#2ec27e',
};

function el(id) { return document.getElementById(id); }

async function loadJSON(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`加载失败 ${path}: ${res.status}`);
  return res.json();
}

function buildStepper() {
  const nav = el('stepper');
  nav.innerHTML = '';
  SECTIONS.forEach(([id, label, num], i) => {
    const a = document.createElement('a');
    a.className = 'step unlocked';
    a.href = '#' + id;
    a.innerHTML = `<span class="num">${num}</span>${label}`;
    nav.appendChild(a);
  });
}

function fmt(v, digits = 3) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '—';
  return Number(v).toFixed(digits);
}

function renderKPIs(summary, tech1) {
  const rec = tech1 && tech1.sensor_design ? tech1.sensor_design.recommended_n : '—';
  const cards = [
    ['温度重建 R²', fmt(summary.tech1_temperature_r2), '核心技术一'],
    ['组分重建 R²', fmt(summary.tech1_species_r2), '核心技术一'],
    ['辐射重建 R²', fmt(summary.tech1_radiation_r2), '核心技术一'],
    ['GNN 路径 R²', fmt(summary.tech2_gnn_test_r2), '核心技术二'],
    ['策略平均奖励', fmt(summary.tech3_greedy_reward, 4), '核心技术三'],
    ['较 CO₂ 路径增益', (summary.tech3_gain_over_CO2_pct ?? 0) + '%', '核心技术三'],
    ['燃料', summary.fuel, '现场'],
    ['推荐测点数', rec, '传感器设计'],
  ];
  el('kpiGrid').innerHTML = cards.map(([k, v, s]) =>
    `<div class="kpi accent"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${s}</div></div>`
  ).join('');
}

function thermalColorscale(fieldKey) {
  if (fieldKey === 'T_sim_K') return 'Inferno';
  return 'Viridis';
}

function renderField(fieldData) {
  const phis = fieldData.phis.map(String);
  const phiSelect = el('phiSelect');
  phiSelect.innerHTML = phis.map(p => `<option value="${p}">φ = ${p}</option>`).join('');

  const fields = fieldData.fields;
  const fieldSelect = el('fieldSelect');
  fieldSelect.innerHTML = fields.map(f =>
    `<option value="${f}">${fieldData.field_labels[f] || f}</option>`).join('');

  function draw() {
    const phi = phiSelect.value;
    const field = fieldSelect.value;
    const slice = fieldData.slices[phi];
    if (!slice || !slice.fields || !slice.fields[field]) return;
    const matrix = slice.fields[field];
    const trace = {
      type: 'heatmap',
      x: slice.r_mm,
      y: slice.z_mm,
      z: matrix,
      colorscale: thermalColorscale(field),
      colorbar: { title: { text: fieldData.field_labels[field] || field, font: { color: '#8b96a8' } }, tickfont: { color: '#8b96a8' } },
      hovertemplate: 'r=%{x:.1f} mm<br>z=%{y:.1f} mm<br>' + field + '=%{z:.3g}<extra></extra>',
    };
    const layout = {
      paper_bgcolor: '#080b0e',
      plot_bgcolor: '#080b0e',
      font: { color: '#8b96a8' },
      margin: { l: 70, r: 30, t: 20, b: 55 },
      xaxis: { title: 'r / mm', gridcolor: 'rgba(255,255,255,.06)', zeroline: false },
      yaxis: { title: 'z / mm', gridcolor: 'rgba(255,255,255,.06)', zeroline: false, scaleanchor: 'x', scaleratio: 1 },
    };
    Plotly.react('fieldPlot', [trace], layout, { responsive: true, displayModeBar: false });
  }
  phiSelect.addEventListener('change', draw);
  fieldSelect.addEventListener('change', draw);
  draw();
}

function renderRadiation(radData) {
  const traces = [];
  const phis = radData.phis.map(String);
  phis.forEach((p, i) => {
    const prof = radData.profiles[p];
    if (!prof) return;
    const col = ['#e60008', '#22c7d0', '#ffb020'][i % 3];
    traces.push({
      type: 'scatter',
      mode: 'lines+markers',
      x: prof.z_mm,
      y: prof.q_mean_W_m2,
      name: 'φ=' + p,
      line: { color: col, width: 2.5 },
      marker: { size: 5 },
      error_y: { type: 'data', array: prof.q_std_W_m2, color: col, thickness: 1.2, width: 4 },
    });
  });
  const layout = {
    paper_bgcolor: '#080b0e', plot_bgcolor: '#080b0e', font: { color: '#8b96a8' },
    margin: { l: 80, r: 30, t: 20, b: 55 },
    legend: { orientation: 'h', y: 1.08 },
    xaxis: { title: 'z / mm', gridcolor: 'rgba(255,255,255,.06)', zeroline: false },
    yaxis: { title: 'q / W·m⁻²', gridcolor: 'rgba(255,255,255,.06)', zeroline: false },
  };
  Plotly.react('radPlot', traces, layout, { responsive: true, displayModeBar: false });
}

function renderGraph(graph) {
  const nodes = graph.nodes;
  const n = nodes.length;
  const R = 1;
  const positions = {};
  nodes.forEach((node, i) => {
    const ang = (2 * Math.PI * i) / n - Math.PI / 2;
    positions[node.species] = { x: R * Math.cos(ang), y: R * Math.sin(ang) };
  });

  const maxAbs = Math.max(...nodes.map(d => Math.abs(d.value)), 1e-6);
  const nodeTrace = {
    type: 'scatter',
    mode: 'markers+text',
    x: nodes.map(d => positions[d.species].x),
    y: nodes.map(d => positions[d.species].y),
    text: nodes.map(d => d.species),
    textposition: 'top center',
    textfont: { color: '#e6ebf2', size: 11 },
    marker: {
      size: 18,
      color: nodes.map(d => d.value),
      colorscale: 'RdBu',
      cmin: -maxAbs, cmax: maxAbs,
      line: { color: '#0a0d10', width: 2 },
    },
    hovertemplate: '%{text}<br>贡献=%{marker.color:.3f}<extra></extra>',
  };

  const edgeTraces = graph.edges.map(e => {
    const a = positions[e.source], b = positions[e.target];
    const alpha = Math.min(0.9, 0.15 + 0.75 * Math.abs(e.value));
    const color = e.value >= 0 ? `rgba(230,0,8,${alpha})` : `rgba(79,139,255,${alpha})`;
    return {
      type: 'scatter',
      mode: 'lines',
      x: [a.x, b.x], y: [a.y, b.y],
      line: { color, width: 1 + 5 * Math.abs(e.value) },
      hoverinfo: 'text',
      text: `${e.rxn_label || (e.source + '→' + e.target)}<br>贡献=${fmt(e.value, 4)}`,
      showlegend: false,
    };
  });

  const layout = {
    paper_bgcolor: '#080b0e', plot_bgcolor: '#080b0e', font: { color: '#8b96a8' },
    margin: { l: 30, r: 30, t: 20, b: 30 },
    xaxis: { visible: false, range: [-1.4, 1.4] },
    yaxis: { visible: false, range: [-1.4, 1.4] },
    showlegend: false,
  };
  Plotly.react('graphPlot', [nodeTrace, ...edgeTraces], layout, { responsive: true, displayModeBar: false });
}

function renderPaths(tech3) {
  const p1 = tech3.key_path_H2O, p2 = tech3.key_path_CO2;
  el('pathH2O').textContent = p1 ? `${p1.path}  ·  奖励 ${fmt(p1.mean_reward, 4)}` : '—';
  el('pathCO2').textContent = p2 ? `${p2.path}  ·  奖励 ${fmt(p2.mean_reward, 4)}` : '—';
}

function renderSensor(tech1) {
  const sd = tech1.sensor_design;
  const curve = (sd && sd.greedy_curve) || [];
  const nArr = curve.map(d => d.n_sensors);
  const maeArr = curve.map(d => d.mae);
  const rmseArr = curve.map(d => d.rmse);

  const traces = [
    { type: 'scatter', mode: 'lines+markers', name: 'MAE', x: nArr, y: maeArr, line: { color: COLORS.red, width: 2.5 }, marker: { size: 5 } },
    { type: 'scatter', mode: 'lines+markers', name: 'RMSE', x: nArr, y: rmseArr, line: { color: COLORS.cyan, width: 2, dash: 'dot' }, marker: { size: 4 } },
  ];
  if (sd && sd.recommended_n) {
    traces.push({
      type: 'scatter', mode: 'lines', name: '推荐 N=' + sd.recommended_n,
      x: [sd.recommended_n, sd.recommended_n],
      y: [0, Math.max(...maeArr) * 1.1],
      line: { color: COLORS.amber, width: 1.5, dash: 'dash' },
    });
  }
  const layout = {
    paper_bgcolor: '#080b0e', plot_bgcolor: '#080b0e', font: { color: '#8b96a8' },
    margin: { l: 70, r: 30, t: 20, b: 55 },
    legend: { orientation: 'h', y: 1.08 },
    xaxis: { title: '传感器数量 N', gridcolor: 'rgba(255,255,255,.06)', zeroline: false },
    yaxis: { title: '误差', gridcolor: 'rgba(255,255,255,.06)', zeroline: false },
  };
  Plotly.react('sensorPlot', traces, layout, { responsive: true, displayModeBar: false });
}

function renderMPC(tech3) {
  const z = tech3.z, T = tech3.T, phi = tech3.phi;
  const traces = [
    { type: 'scatter', mode: 'lines', name: '温度 T', x: z, y: T, line: { color: COLORS.red, width: 2.5 }, yaxis: 'y' },
    { type: 'scatter', mode: 'lines', name: '当量比 φ', x: z, y: phi, line: { color: COLORS.cyan, width: 2.5 }, yaxis: 'y2' },
  ];
  const layout = {
    paper_bgcolor: '#080b0e', plot_bgcolor: '#080b0e', font: { color: '#8b96a8' },
    margin: { l: 70, r: 70, t: 20, b: 55 },
    legend: { orientation: 'h', y: 1.08 },
    xaxis: { title: 'z / mm', gridcolor: 'rgba(255,255,255,.06)', zeroline: false },
    yaxis: { title: 'T / K', gridcolor: 'rgba(255,255,255,.06)', zeroline: false },
    yaxis2: { title: 'φ', overlaying: 'y', side: 'right', gridcolor: 'rgba(255,255,255,.06)', zeroline: false, showgrid: false },
  };
  Plotly.react('mpcPlot', traces, layout, { responsive: true, displayModeBar: false });

  const gp = tech3.greedy_policy || {};
  el('mpcGreedy').textContent = fmt(gp.mean_reward, 4);
  el('mpcGain').textContent = gp.gain_over_CO2_pct != null ? gp.gain_over_CO2_pct + '%' : '—';
}

function renderGallery() {
  const shots = [
    ['overview.png', '工作台总览'],
    ['field.png', '三维场重建'],
    ['radiation?', ''],
  ];
  // use fixed known list
  const files = ['overview.png', 'field.png', 'path.png', 'sensor.png', 'export.png', 'stage0_new.png', 'stage3_check.png'];
  const captions = { 'overview.png': '工作台总览', 'field.png': '三维场重建', 'path.png': '反应路径诊断', 'sensor.png': '传感器设计', 'export.png': '结果导出', 'stage0_new.png': '阶段 0 · 数据接入', 'stage3_check.png': '阶段 3 · 安全校验' };
  el('gallery').innerHTML = files.map(f =>
    `<figure><img src="screenshots/${f}" alt="${captions[f] || f}" /><figcaption>${captions[f] || f}</figcaption></figure>`
  ).join('');
}

(async function init() {
  buildStepper();
  renderGallery();
  try {
    const [summary, tech1, field, rad, graph, tech3] = await Promise.all([
      loadJSON('data/summary.json'),
      loadJSON('data/tech1_metrics.json'),
      loadJSON('data/field_slices.json'),
      loadJSON('data/radiation_profiles.json'),
      loadJSON('data/tech2_graph.json'),
      loadJSON('data/tech3_policy.json'),
    ]);
    renderKPIs(summary, tech1);
    renderField(field);
    renderRadiation(rad);
    renderGraph(graph);
    renderPaths(tech3);
    renderSensor(tech1);
    renderMPC(tech3);
    el('engineStatus').textContent = '静态演示版 · 已加载全部数据';
  } catch (err) {
    console.error(err);
    el('engineStatus').textContent = '数据加载失败';
    el('engineStatus').parentElement.classList.remove('online');
  }
})();
