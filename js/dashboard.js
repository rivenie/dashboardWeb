const SUPABASE_URL = "https://ffiuayjfnhlvxgktxbal.supabase.co";
const SUPABASE_KEY = "sb_publishable_F8h3Zay5r9pVATEnvAIa-Q_bnaXgj1U";
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const C = {
  gold: "#1E3A5F", goldLight: "#3B82F6", goldDark: "#0F2942",
  orange: "#DC2626", amber: "#B45309",
  green: "#15803D", red: "#DC2626", blue: "#1D4ED8", cyan: "#0E7490",
  other: "#CBD5E1", text: "#1E293B", dim: "#5B6B7F", faint: "#94A3B8",
  grid: "rgba(91, 107, 127, 0.14)", panel: "#FFFFFF",
};
const PALETTE = [C.gold, C.orange, C.blue, C.amber, C.green, C.cyan, C.red, C.goldLight];

Chart.register(ChartDataLabels);
Chart.defaults.font.family = "'IBM Plex Sans', system-ui, sans-serif";
Chart.defaults.font.size = 11;
Chart.defaults.color = C.dim;
Chart.defaults.animation.duration = 450;
Chart.defaults.plugins.datalabels.display = false;
Chart.defaults.plugins.legend.display = false;

const state = { data: null };
const charts = {};
const filtros = { kpi: new Set(), sede: new Set(), mes: new Set() };
let listenersReady = false;
let subActualC = "resumen";

const fmt = (v, d = 0) => Number(v).toLocaleString("es-PE", { maximumFractionDigits: d, minimumFractionDigits: 0 });
const round = (v, d = 1) => Number(Number(v).toFixed(d));
const truncar = (s, n = 30) => (s && s.length > n ? s.slice(0, n - 1) + "…" : s || "");
const $ = (id) => document.getElementById(id);

async function cargarHoja(nombre) {
  const { data, error } = await supabaseClient.from("dashboard_data").select("row_index, data").eq("sheet_name", nombre).order("row_index", { ascending: true }).limit(1);
  if (error) throw error;
  if (!data || data.length === 0) return null;
  return data[0].data;
}

const centerText = {
  id: "centerText",
  afterDraw(chart, _args, opts) {
    if (!opts || !opts.title) return;
    const { ctx, chartArea: a } = chart;
    const x = (a.left + a.right) / 2, y = (a.top + a.bottom) / 2;
    ctx.save(); ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = C.text; ctx.font = "700 20px Sora, sans-serif";
    ctx.fillText(opts.title, x, y - 8);
    ctx.fillStyle = C.dim; ctx.font = "500 11px 'IBM Plex Sans', sans-serif";
    ctx.fillText(opts.sub || "", x, y + 16); ctx.restore();
  },
};

function tooltipStyle() {
  return {
    backgroundColor: "#FFFFFF", titleColor: C.text, bodyColor: C.text,
    borderColor: "#DDE3EC", borderWidth: 1, padding: 10, cornerRadius: 8, boxPadding: 4,
    callbacks: { label: (c) => ` ${c.dataset.label ? c.dataset.label + ": " : c.label ? c.label + ": " : ""}${fmt(c.parsed.y !== undefined ? c.parsed.y : c.parsed, 2)}` },
  };
}
function mount(id, config) {
  const canvas = $(id); if (!canvas) return;
  if (charts[id]) { charts[id].destroy(); delete charts[id]; }
  const vacio = !config.data.labels || config.data.labels.length === 0;
  canvas.parentElement.classList.toggle("is-empty", vacio);
  if (vacio) return;
  charts[id] = new Chart(canvas, config);
}
function gradV(c1, c2) { return (ctx) => { const a = ctx.chart.chartArea; if (!a) return c1; const g = ctx.chart.ctx.createLinearGradient(0, a.top, 0, a.bottom); g.addColorStop(0, c1); g.addColorStop(1, c2); return g; }; }
function gradH(c1, c2) { return (ctx) => { const a = ctx.chart.chartArea; if (!a) return c1; const g = ctx.chart.ctx.createLinearGradient(a.left, 0, a.right, 0); g.addColorStop(0, c1); g.addColorStop(1, c2); return g; }; }
const scaleX = () => ({ grid: { display: false }, border: { color: "#DDE3EC" }, ticks: { color: C.dim, maxRotation: 0, autoSkipPadding: 14 } });
const scaleY = (max, decimals = 0) => ({ beginAtZero: true, suggestedMax: max, grid: { color: C.grid }, border: { display: false }, ticks: { color: C.faint, callback: (v) => fmt(v, decimals), maxTicksLimit: 6 } });
const labelBase = { color: C.text, font: { family: "'IBM Plex Sans', sans-serif", weight: "600", size: 10.5 } };

function renderColumns(id, labels, data, color1 = C.goldLight, color2 = C.goldDark, decimals = 0) {
  const max = Math.max(...data, 0);
  mount(id, {
    type: "bar",
    data: { labels, datasets: [{ data, borderRadius: { topLeft: 7, topRight: 7 }, borderSkipped: false, maxBarThickness: 54, backgroundColor: gradV(color1, color2) }] },
    options: { responsive: true, maintainAspectRatio: false, layout: { padding: { top: 14 } },
      plugins: { tooltip: tooltipStyle(), datalabels: { ...labelBase, display: labels.length <= 14, anchor: "end", align: "end", offset: 3, formatter: (v) => fmt(v, decimals) } },
      scales: { x: scaleX(), y: scaleY(max * 1.22, decimals) } },
  });
}
function renderGrouped(id, labels, datasets, decimals = 0) {
  const maxAll = Math.max(...datasets.flatMap(d => d.data), 0);
  mount(id, {
    type: "bar",
    data: { labels, datasets: datasets.map(d => ({
      label: d.label, data: d.data, backgroundColor: gradV(d.color1 || d.color, d.color2 || d.color),
      borderRadius: { topLeft: 6, topRight: 6 }, borderSkipped: false, maxBarThickness: 34,
    })) },
    options: { responsive: true, maintainAspectRatio: false, layout: { padding: { top: 18 } },
      plugins: {
        legend: { display: true, position: "bottom", labels: { color: C.dim, usePointStyle: true, pointStyle: "circle", boxWidth: 8, padding: 14 } },
        tooltip: tooltipStyle(),
        datalabels: { ...labelBase, display: true, anchor: "end", align: "end", offset: 3, formatter: (v) => fmt(v, decimals) },
      },
      scales: { x: scaleX(), y: scaleY(maxAll * 1.22, decimals) } },
  });
}
function renderScrollHBar(id, labels, data, color1 = C.goldDark, color2 = C.goldLight, decimals = 0) {
  const ctx = $(id); if (!ctx) return;
  if (charts[id]) charts[id].destroy();
  const wrap = ctx.parentElement;
  wrap.style.maxHeight = "420px"; wrap.style.overflowY = "auto"; wrap.style.overflowX = "hidden";
  ctx.style.height = Math.max(420, labels.length * 32) + "px"; ctx.style.maxHeight = "none";
  const max = Math.max(...data, 0);
  charts[id] = new Chart(ctx, {
    type: "bar",
    data: { labels, datasets: [{ data, borderRadius: 6, borderSkipped: false, barThickness: 16, backgroundColor: gradH(color1, color2) }] },
    options: { indexAxis: "y", responsive: true, maintainAspectRatio: false, layout: { padding: { right: 12 } },
      plugins: { tooltip: tooltipStyle(), datalabels: { ...labelBase, display: true, anchor: "end", align: "right", offset: 4, formatter: (v) => fmt(v, decimals) } },
      scales: { x: { ...scaleY(max * 1.18), ticks: { color: C.faint, callback: (v) => fmt(v), maxTicksLimit: 5 } }, y: { grid: { display: false }, border: { display: false }, ticks: { color: C.text, callback(v) { return truncar(this.getLabelForValue(v), 30); } } } } },
  });
}
function renderDoughnut(id, labels, data, centerTitle, centerSub, decimals = 0) {
  const total = data.reduce((a, b) => a + Number(b), 0);
  const colores = labels.map((l, i) => PALETTE[i % PALETTE.length]);
  mount(id, {
    type: "doughnut",
    data: { labels, datasets: [{ data, backgroundColor: colores, borderColor: "#FFFFFF", borderWidth: 3, hoverOffset: 5 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: "68%",
      plugins: {
        tooltip: { ...tooltipStyle(), callbacks: { label: (c) => ` ${c.label}: ${fmt(c.parsed, decimals)} (${total ? Math.round((c.parsed / total) * 100) : 0}%)` } },
        datalabels: { ...labelBase, display: (c) => total > 0 && c.dataset.data[c.dataIndex] / total >= 0.06, color: "#1E293B", font: { family: "'IBM Plex Sans', sans-serif", weight: "700", size: 11 }, formatter: (v) => Math.round((v / total) * 100) + "%" },
        centerText: { title: centerTitle, sub: centerSub },
      } },
    plugins: [centerText],
  });
  const lg = $(id + "Legend");
  if (lg) lg.innerHTML = labels.map((l, i) => `<div class="legend-item"><i style="background:${colores[i]}"></i><span title="${l}">${truncar(l, 22)}</span><b>${total ? Math.round((data[i] / total) * 100) : 0}%</b></div>`).join("");
}
function renderLine(id, labels, datasets, decimals = 1) {
  const maxAll = Math.max(...datasets.flatMap(d => d.data), 0);
  mount(id, {
    type: "line",
    data: { labels, datasets: datasets.map(d => ({
      label: d.label, data: d.data, borderColor: d.color, borderWidth: 2.5, tension: 0.35, fill: false,
      pointBackgroundColor: d.color, pointBorderColor: "#FFFFFF", pointBorderWidth: 2, pointRadius: 4, pointHoverRadius: 6,
    })) },
    options: { responsive: true, maintainAspectRatio: false, layout: { padding: { top: 22, right: 10 } },
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: datasets.length > 1, position: "bottom", labels: { color: C.dim, usePointStyle: true, pointStyle: "circle", boxWidth: 8, padding: 14 } },
        tooltip: tooltipStyle(),
        datalabels: { display: true, align: "top", anchor: "end", offset: 6, color: (c) => c.dataset.borderColor, font: { family: "'IBM Plex Sans', sans-serif", weight: "600", size: 10 }, formatter: (v) => fmt(v, decimals) },
      },
      scales: { x: scaleX(), y: scaleY(maxAll * 1.18, decimals) } },
  });
}

function heroCard({ title, value, unit, badge, note }) {
  return `<article class="card hero span-3">
    <span class="eyebrow">Indicador principal</span>
    <h3>${title}</h3>
    <div class="hero-val">${value}<small>${unit}</small></div>
    <p class="hero-note">${note}</p>
    <span class="pill pill-orange">${badge}</span>
  </article>`;
}
function kpiCard({ icon, tone, title, value, unit, pct, barLabel, foot }) {
  return `<article class="card kpi tone-${tone} span-3">
    <div class="kpi-head"><span class="kpi-ico"><i class="fas ${icon}"></i></span><h3>${title}</h3></div>
    <div class="kpi-val">${value}<small>${unit}</small></div>
    <div class="bar"><i style="width:${Math.min(100, Math.max(0, pct))}%"></i></div>
    <div class="kpi-foot"><span>${barLabel}</span><b>${fmt(pct, 1)}%</b></div>
    <p class="kpi-note">${foot}</p>
  </article>`;
}
function plotCard(id, titulo, sub, span, size = "") {
  return `<article class="card span-${span}"><div class="card-head"><h3>${titulo}</h3><p>${sub}</p></div>
    <div class="plot ${size}"><canvas id="${id}"></canvas><div class="plot-empty"><i class="fas fa-chart-simple"></i><span>Sin datos para mostrar</span></div></div></article>`;
}
function donutCard(id, titulo, sub, span) {
  return `<article class="card span-${span}"><div class="card-head"><h3>${titulo}</h3><p>${sub}</p></div>
    <div class="plot donut"><canvas id="${id}"></canvas><div class="plot-empty"><i class="fas fa-chart-pie"></i><span>Sin datos para mostrar</span></div></div>
    <div class="legend" id="${id}Legend"></div></article>`;
}
function slotCard(id, titulo, sub, span) {
  return `<article class="card span-${span}"><div class="card-head"><h3>${titulo}</h3><p>${sub}</p></div><div id="${id}" class="mini-table"></div></article>`;
}
function tabla(encabezados, filas) {
  return `<div class="tbl-wrap"><table class="tbl"><thead><tr>${encabezados.map((h) => `<th class="${h.num ? "num" : ""}">${h.t}</th>`).join("")}</tr></thead><tbody>${filas.map((f) => `<tr>${f.map((c, i) => `<td class="${encabezados[i].num ? "num" : ""} ${i === 0 ? "name" : ""}">${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}
function vacioMensaje(span = 12) {
  return `<article class="card span-${span}"><div class="plot-empty" style="display:flex;position:static;min-height:200px"><i class="fas fa-database"></i><span>No se encontraron datos.</span></div></article>`;
}

/* ================= FILTROS ================= */
function llenarMulti(id, opciones, setDestino) {
  const cont = $(id); if (!cont) return;
  cont.innerHTML = opciones.map(o =>
    `<label class="filter-multi-item"><input type="checkbox" value="${o}" ${setDestino.has(o) ? "checked" : ""}><span>${o}</span></label>`
  ).join("");
  cont.querySelectorAll("input").forEach(inp => {
    inp.addEventListener("change", () => {
      if (inp.checked) setDestino.add(inp.value);
      else setDestino.delete(inp.value);
      renderSeccionActual();
    });
  });
}
function renderSeccionActual() {
  if (subActualC === "resumen") renderResumen();
  else if (subActualC === "sedes") renderSedes();
  else if (subActualC === "mensual") renderMensual();
  else if (subActualC === "rondas") renderRondas();
  else if (subActualC === "detalle") renderDetalle();
}
function filtrarFilas(filas) {
  return filas.filter(f => {
    if (filtros.kpi.size && !filtros.kpi.has(f.kpi)) return false;
    if (filtros.sede.size && !filtros.sede.has(f.sede)) return false;
    if (filtros.mes.size) {
      const tiene = Object.keys(f.meses || {}).some(m => filtros.mes.has(m));
      if (!tiene) return false;
    }
    return true;
  });
}
function filtrarMeses(arr) {
  if (!filtros.mes.size) return arr;
  return arr.filter(m => filtros.mes.has(m.mes));
}

function construirLayoutInterno() {
  const filtrosHTML = `
    <div class="filter-multi" id="fKpi"><span class="filter-multi-title">KPI</span><div class="filter-multi-list" id="fKpiList"></div></div>
    <div class="filter-multi" id="fSede"><span class="filter-multi-title">Sede VLV</span><div class="filter-multi-list" id="fSedeList"></div></div>
    <div class="filter-multi" id="fMes"><span class="filter-multi-title">Mes</span><div class="filter-multi-list" id="fMesList"></div></div>
    <button id="clearFiltros" class="btn-clear-chips"><i class="fas fa-eraser"></i> Limpiar</button>`;
  $("filtersGlobales").innerHTML = filtrosHTML;

  $("gridResumen").innerHTML = [
    plotCard("rKPI", "Total por KPI", "Cantidad acumulada", 6, "tall"),
    donutCard("rSede", "Distribución por sede", "Chincha · Virú · Fundo Bravo", 6),
    plotCard("rMes", "Evolución mensual", "Abr - Set · Total por mes", 12, "tall"),
  ].join("");

  $("gridSedes").innerHTML = [
    donutCard("sDist", "Total por sede", "Distribución acumulada", 6),
    plotCard("sKPISede", "KPIs por sede", "Top por impacto", 6, "tall"),
  ].join("");

  $("gridMensual").innerHTML = [
    plotCard("mIntrusiones", "Intrusiones por mes", "Abr - Set", 6, "tall"),
    plotCard("mCelulares", "Celulares decomisados por mes", "Abr - Set", 6, "tall"),
    plotCard("mAnimales", "Animales retirados por sede y mes", "Chincha · Virú · Fundo Bravo", 12, "tall"),
  ].join("");

  $("gridRondas").innerHTML = [
    plotCard("rnPerim", "Rondas perimétricas: real vs proyectado", "Por sede", 6, "tall"),
    plotCard("rnInternas", "Rondas internas: real vs proyectado", "Por sede", 6, "tall"),
  ].join("");

  $("gridDet").innerHTML = [
    slotCard("dTabla", "Detalle de KPIs", "Item · KPI · Sede · Total · Por sede · Proyectada · Mensual", 12),
  ].join("");
}

function llenarSegmentadores() {
  if (!state.data) return;
  const kpis = state.data.porKPI.map(k => k.nombre);
  const sedes = state.data.porSede.map(s => s.nombre);
  const meses = state.data.porMes.map(m => m.mes);
  llenarMulti("fKpiList", kpis, filtros.kpi);
  llenarMulti("fSedeList", sedes, filtros.sede);
  llenarMulti("fMesList", meses, filtros.mes);
}

/* ---------- RESUMEN ---------- */
function renderResumen() {
  if (!state.data) { $("kpiResumen").innerHTML = ""; $("gridResumen").innerHTML = vacioMensaje(12); return; }
  const filas = filtrarFilas(state.data.filas);
  const k = state.data.kpis;

  // Totales generales aplicados con filtros
  const sedesPorKPI = {};
  filas.forEach(f => {
    if (!sedesPorKPI[f.kpi]) sedesPorKPI[f.kpi] = new Set();
    sedesPorKPI[f.kpi].add(f.sede);
  });
  const totalCantidad = Object.keys(sedesPorKPI).reduce((a, kpi) => {
    const fila = filas.find(f => f.kpi === kpi);
    return a + (fila?.total || 0);
  }, 0);
  const totalProyectado = filas.reduce((a, f) => a + (f.proyectada || 0), 0);
  const pctCumplimiento = totalProyectado ? (totalCantidad / totalProyectado) * 100 : 0;
  const totalSedes = new Set(filas.map(f => f.sede)).size;

  $("kpiResumen").innerHTML = [
    heroCard({
      title: "Total", value: fmt(totalCantidad), unit: "",
      note: `${fmt(filas.length)} registros · ${fmt(totalSedes)} sedes`,
      badge: `Proyectado: ${fmt(totalProyectado)}`,
    }),
    kpiCard({ icon: "fa-bullseye", tone: "gold", title: "Total proyectado", value: fmt(totalProyectado), unit: "",
      pct: 100, barLabel: "Meta del periodo",
      foot: `Sobre el proyecto` }),
    kpiCard({ icon: "fa-percent", tone: "amber", title: "% Cumplimiento", value: fmt(pctCumplimiento, 1), unit: "%",
      pct: Math.min(100, pctCumplimiento), barLabel: "Real / Proyectado",
      foot: `${fmt(totalCantidad)} de ${fmt(totalProyectado)}` }),
    kpiCard({ icon: "fa-map-location-dot", tone: "green", title: "Total sedes", value: fmt(totalSedes), unit: "",
      pct: 100, barLabel: "Sedes activas",
      foot: `Chincha · Virú · Fundo Bravo` }),
  ].join("");

  // Total por KPI (con filtros)
  const aggKPI = {};
  filas.forEach(f => { aggKPI[f.kpi] = (aggKPI[f.kpi] || 0) + (f.porSede || 0); });
  const kpiArr = Object.entries(aggKPI).sort((a, b) => b[1] - a[1]);
  renderScrollHBar("rKPI", kpiArr.map(x => truncar(x[0], 28)), kpiArr.map(x => x[1]), C.goldDark, C.goldLight, 0);

  // Distribución por sede
  const aggSede = {};
  filas.forEach(f => { aggSede[f.sede] = (aggSede[f.sede] || 0) + (f.porSede || 0); });
  const sedeArr = Object.entries(aggSede).sort((a, b) => b[1] - a[1]);
  renderDoughnut("rSede", sedeArr.map(s => s[0]), sedeArr.map(s => s[1]), fmt(sedeArr.reduce((a, b) => a + b[1], 0)), "total");

  // Evolución mensual (con filtros)
  const aggMes = {};
  filas.forEach(f => {
    Object.entries(f.meses || {}).forEach(([m, v]) => {
      if (filtros.mes.size && !filtros.mes.has(m)) return;
      aggMes[m] = (aggMes[m] || 0) + v;
    });
  });
  const mesesOrden = ["ABR","MAY","JUN","JUL","AGO","SET","OCT","NOV","DIC"];
  const mesesArr = mesesOrden.filter(m => aggMes[m] !== undefined).map(m => ({ mes: m, valor: aggMes[m] }));
  renderLine("rMes", mesesArr.map(m => m.mes), [
    { label: "Total", color: C.gold, data: mesesArr.map(m => m.valor) },
  ], 0);
}

/* ---------- SEDES ---------- */
function renderSedes() {
  if (!state.data) { $("gridSedes").innerHTML = vacioMensaje(12); return; }
  const filas = filtrarFilas(state.data.filas);

  const aggSede = {};
  filas.forEach(f => { aggSede[f.sede] = (aggSede[f.sede] || 0) + (f.porSede || 0); });
  const sedeArr = Object.entries(aggSede).sort((a, b) => b[1] - a[1]);
  renderDoughnut("sDist", sedeArr.map(s => s[0]), sedeArr.map(s => s[1]), fmt(sedeArr.reduce((a, b) => a + b[1], 0)), "total");

  const aggKPI = {};
  filas.forEach(f => { aggKPI[f.kpi] = (aggKPI[f.kpi] || 0) + (f.porSede || 0); });
  const kpiArr = Object.entries(aggKPI).sort((a, b) => b[1] - a[1]).slice(0, 10);
  renderScrollHBar("sKPISede", kpiArr.map(x => truncar(x[0], 28)), kpiArr.map(x => x[1]), C.orange, C.amber, 0);
}

/* ---------- MENSUAL ---------- */
function renderMensual() {
  if (!state.data) { $("gridMensual").innerHTML = vacioMensaje(12); return; }
  const filas = filtrarFilas(state.data.filas);
  const mesesOrden = ["ABR","MAY","JUN","JUL","AGO","SET","OCT","NOV","DIC"];

  // Agg por KPI y mes
  const agg = {};
  filas.forEach(f => {
    Object.entries(f.meses || {}).forEach(([m, v]) => {
      if (filtros.mes.size && !filtros.mes.has(m)) return;
      const key = `${f.kpi}|${m}`;
      agg[key] = (agg[key] || 0) + v;
    });
  });

  const meses = mesesOrden.filter(m => Object.keys(agg).some(k => k.endsWith("|" + m)));

  // Intrusiones
  renderColumns("mIntrusiones", meses, meses.map(m => agg[`Intrusiones en VLV|${m}`] || 0), C.goldLight, C.goldDark, 0);

  // Celulares
  renderColumns("mCelulares", meses, meses.map(m => agg[`Celulares decomisados|${m}`] || 0), C.orange, C.amber, 0);

  // Animales por sede y mes
  const sedes = [...new Set(filas.filter(f => f.kpi === "Animales retirados").map(f => f.sede))];
  const datosPorSede = {};
  sedes.forEach(s => datosPorSede[s] = meses.map(() => 0));
  filas.forEach(f => {
    if (f.kpi !== "Animales retirados") return;
    meses.forEach((m, i) => {
      if (filtros.mes.size && !filtros.mes.has(m)) return;
      datosPorSede[f.sede][i] += (f.meses[m] || 0);
    });
  });
  renderGrouped("mAnimales", meses, sedes.map((s, i) => ({
    label: s, color: PALETTE[i % PALETTE.length], data: datosPorSede[s],
  })), 0);
}

/* ---------- RONDAS ---------- */
function renderRondas() {
  if (!state.data) { $("gridRondas").innerHTML = vacioMensaje(12); return; }
  const filas = filtrarFilas(state.data.filas);

  const rp = {}, ri = {};
  filas.forEach(f => {
    if (f.kpi.toUpperCase().includes("RONDAS PERIM")) {
      rp[f.sede] = { real: f.porSede, proyectada: f.proyectada };
    }
    if (f.kpi.toUpperCase().includes("RONDAS INTERN")) {
      ri[f.sede] = { real: f.porSede, proyectada: f.proyectada };
    }
  });

  const sedes = [...new Set([...Object.keys(rp), ...Object.keys(ri)])];

  renderGrouped("rnPerim", sedes, [
    { label: "Real", color: C.gold, data: sedes.map(s => rp[s]?.real || 0) },
    { label: "Proyectado", color: C.amber, data: sedes.map(s => rp[s]?.proyectada || 0) },
  ], 0);

  renderGrouped("rnInternas", sedes, [
    { label: "Real", color: C.blue, data: sedes.map(s => ri[s]?.real || 0) },
    { label: "Proyectado", color: C.cyan, data: sedes.map(s => ri[s]?.proyectada || 0) },
  ], 0);
}

/* ---------- DETALLE ---------- */
function renderDetalle() {
  if (!state.data) { $("gridDet").innerHTML = vacioMensaje(12); return; }
  const filas = filtrarFilas(state.data.filas);
  const meses = ["ABR","MAY","JUN","JUL","AGO","SET"];
  $("dTabla").innerHTML = filas.length
    ? tabla(
        [{ t: "KPI" }, { t: "Sede" }, { t: "Total", num: 1 }, { t: "Por sede", num: 1 }, { t: "Proyectada", num: 1 },
         ...meses.map(m => ({ t: m, num: 1 }))],
        filas.map(f => [
          truncar(f.kpi, 28), f.sede, fmt(f.total), fmt(f.porSede), fmt(f.proyectada),
          ...meses.map(m => fmt(f.meses[m] || 0)),
        ])
      )
    : `<div class="plot-empty" style="display:flex;position:static;min-height:120px"><i class="fas fa-chart-simple"></i><span>Sin datos</span></div>`;
}

function cambiarSubC(sub) {
  subActualC = sub;
  document.querySelectorAll("#subTabsC .subtab").forEach(t => t.classList.toggle("active", t.dataset.sub === sub));
  ["resumen", "sedes", "mensual", "rondas", "detalle"].forEach(s => {
    const el = document.getElementById("subC-" + s);
    if (el) el.style.display = s === sub ? "block" : "none";
  });
  renderSeccionActual();
  requestAnimationFrame(() => Object.values(charts).forEach(c => c.resize()));
}

function engancharEventos() {
  if (listenersReady) return;
  listenersReady = true;

  document.querySelectorAll("#subTabsC .subtab").forEach(t => {
    t.addEventListener("click", () => cambiarSubC(t.dataset.sub));
  });
  const btnClear = $("clearFiltros");
  if (btnClear) btnClear.addEventListener("click", () => {
    filtros.kpi.clear(); filtros.sede.clear(); filtros.mes.clear();
    document.querySelectorAll(".filter-multi-item input").forEach(i => i.checked = false);
    renderSeccionActual();
  });

  document.querySelectorAll(".js-refresh").forEach((b) =>
    b.addEventListener("click", async () => {
      document.querySelectorAll(".js-refresh").forEach((x) => { x.disabled = true; x.classList.add("is-loading"); });
      try { await cargarTodo(); } catch (err) { console.error(err); }
      document.querySelectorAll(".js-refresh").forEach((x) => { x.disabled = false; x.classList.remove("is-loading"); });
    })
  );
}

async function cargarTodo() {
  const data = await cargarHoja("SEGURIDAD_DATA").catch(() => null);
  state.data = data;

  const count = data ? 1 : 0;
  $("stRegistros").textContent = `${count} / 1`;
  $("stSync").textContent = new Date().toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" });

  $("chipRegistros").textContent = fmt(state.data?.kpis?.totalKPIs || 0);
  $("chipSync").textContent = new Date().toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" });

  llenarSegmentadores();
  cambiarSubC(subActualC);
}

(async function init() {
  construirLayoutInterno();
  try {
    await cargarTodo();
    $("loading").hidden = true;
    $("topbar").hidden = false;
    $("shell").hidden = false;
    $("vlv").hidden = false;
    engancharEventos();
    cambiarSubC(subActualC);
  } catch (err) {
    console.error(err);
    $("loading").innerHTML = `<div class="error-box"><i class="fas fa-triangle-exclamation"></i><h3>No se pudieron cargar los datos</h3><p>${err.message || err}</p></div>`;
  }
})();