/* ==========================================================
   Dashboard Compras — Abastecimiento
   Datos: Supabase (tabla dashboard_data) · Gráficos: Chart.js
   ========================================================== */

const SUPABASE_URL = "https://qkkwvacltcmpgmtrvpjf.supabase.co";
const SUPABASE_KEY = "sb_publishable_UZnT5Fj2Hp8qLOyrWf4Ilw_1QcW_O5U";
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

/* ---------- Paleta ---------- */
const C = {
  cyan: "#10B981", blue: "#22D3EE", orange: "#F97316", green: "#34D399", gold: "#F5B942",
  purple: "#A06BFF", other: "#3A4A56", text: "#EAF2F5", dim: "#8FA3AE", faint: "#5F7480",
  grid: "rgba(143, 163, 174, 0.10)", panel: "#0F1A21",
};
const PALETTE = [C.cyan, C.gold, C.blue, C.orange, C.purple, C.green];

Chart.register(ChartDataLabels);
Chart.defaults.font.family = "'IBM Plex Sans', system-ui, sans-serif";
Chart.defaults.font.size = 11;
Chart.defaults.color = C.dim;
Chart.defaults.animation.duration = 450;
Chart.defaults.plugins.datalabels.display = false;
Chart.defaults.plugins.legend.display = false;

/* ---------- Estado ---------- */
const state = { compras: [] };
const cols = {};
const charts = {};
const ultimo = { resumen: [], proveedores: [], estado: [] };
let seccionActual = "resumen";
let listenersReady = false;
let ultimaCarga = null;

/* ---------- Helpers ---------- */
const fmt = (v, d = 0) =>
  Number(v).toLocaleString("es-PE", { maximumFractionDigits: d, minimumFractionDigits: 0 });
const fmtMoney = (v, d = 2) => {
  const n = Number(v) || 0;
  return "S/ " + n.toLocaleString("es-PE", { minimumFractionDigits: d, maximumFractionDigits: d });
};
const round = (v, d = 1) => Number(Number(v).toFixed(d));
const clamp = (v, a = 0, b = 100) => Math.min(b, Math.max(a, v));
const truncar = (s, n = 30) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const $ = (id) => document.getElementById(id);

function col(data, clave) {
  if (!data || data.length === 0) return null;
  const keys = Object.keys(data[0]);
  return keys.find((k) => k.trim().toLowerCase() === clave.trim().toLowerCase());
}
function norm(v) { return v !== undefined && v !== null ? v.toString().trim() : ""; }
function num(v) {
  if (typeof v === "number") return v;
  if (!v) return 0;
  if (v.toString().startsWith("#")) return 0;
  const s = v.toString().replace(",", ".").replace(/[^0-9.-]/g, "");
  return parseFloat(s) || 0;
}
function sumBy(data, keyFn, valFn) {
  const out = {};
  data.forEach((f) => {
    const k = keyFn(f);
    if (k === null) return;
    out[k] = (out[k] || 0) + valFn(f);
  });
  return out;
}
function countBy(data, keyFn) {
  const out = {};
  data.forEach((f) => {
    const k = keyFn(f);
    if (k === null) return;
    out[k] = (out[k] || 0) + 1;
  });
  return out;
}
function hexRgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
function topN(obj, n, agrupar = true) {
  const arr = Object.entries(obj).sort((a, b) => b[1] - a[1]);
  const top = arr.slice(0, n);
  if (agrupar && arr.length > n) {
    const resto = arr.slice(n).reduce((a, e) => a + e[1], 0);
    if (resto > 0) top.push(["Otros", resto]);
  }
  return top;
}
const argmax = (arr) => arr.reduce((bi, v, i) => (v > arr[bi] ? i : bi), 0);
const argmin = (arr) => arr.reduce((bi, v, i) => (v < arr[bi] ? i : bi), 0);

/* Fechas */
function parseFecha(valor) {
  const s = norm(valor).split(" ")[0].split("T")[0];
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]);
  m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (m) return Date.UTC(+m[3], +m[2] - 1, +m[1]);
  return null;
}
const etiquetaFecha = (ts) =>
  new Date(ts).toLocaleDateString("es-PE", { day: "2-digit", month: "short", timeZone: "UTC" }).replace(".", "");
function porFecha(data, colFecha, valFn, mode = "sum") {
  const acc = {};
  data.forEach((f) => {
    const ts = parseFecha(f[colFecha]);
    if (ts === null) return;
    const v = valFn(f);
    if (!acc[ts]) acc[ts] = { sum: 0, n: 0 };
    acc[ts].sum += v;
    acc[ts].n += 1;
  });
  const keys = Object.keys(acc).map(Number).sort((a, b) => a - b);
  return {
    keys,
    labels: keys.map(etiquetaFecha),
    values: keys.map((k) => (mode === "avg" ? (acc[k].n ? acc[k].sum / acc[k].n : 0) : acc[k].sum)),
  };
}
function rangoFechas(data, colFecha) {
  const t = data.map((f) => parseFecha(f[colFecha])).filter((x) => x !== null);
  if (!t.length) return "—";
  const a = Math.min(...t), b = Math.max(...t);
  const o = { day: "2-digit", month: "short", timeZone: "UTC" };
  const f = (ts, y) => new Date(ts).toLocaleDateString("es-PE", y ? { ...o, year: "numeric" } : o).replace(".", "");
  return a === b ? f(a, true) : `${f(a)} – ${f(b, true)}`;
}

/* ---------- Carga desde Supabase ---------- */
async function cargarHoja(nombre) {
  const TAMANO = 1000;
  let todos = [], desde = 0, seguir = true;
  while (seguir) {
    const { data, error } = await supabaseClient
      .from("dashboard_data")
      .select("row_index, data")
      .eq("sheet_name", nombre)
      .order("row_index", { ascending: true })
      .range(desde, desde + TAMANO - 1);
    if (error) throw error;
    if (data.length === 0) seguir = false;
    else {
      todos = todos.concat(data);
      desde += TAMANO;
      if (data.length < TAMANO) seguir = false;
    }
  }
  return todos.map((r) => r.data);
}

/* ---------- Plugins ---------- */
const centerText = {
  id: "centerText",
  afterDraw(chart, _args, opts) {
    if (!opts || !opts.title) return;
    const { ctx, chartArea: a } = chart;
    const x = (a.left + a.right) / 2, y = (a.top + a.bottom) / 2;
    ctx.save();
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = C.text; ctx.font = "700 22px Sora, sans-serif";
    ctx.fillText(opts.title, x, y - 8);
    ctx.fillStyle = C.dim; ctx.font = "500 11px 'IBM Plex Sans', sans-serif";
    ctx.fillText(opts.sub || "", x, y + 16);
    ctx.restore();
  },
};
const avgLine = {
  id: "avgLine",
  afterDatasetsDraw(chart, _args, opts) {
    if (!opts || opts.value === undefined || opts.value === null) return;
    const y = chart.scales.y.getPixelForValue(opts.value);
    const { left, right, top, bottom } = chart.chartArea;
    if (y < top || y > bottom) return;
    const ctx = chart.ctx;
    ctx.save();
    ctx.setLineDash([5, 4]); ctx.strokeStyle = C.orange; ctx.lineWidth = 1.25;
    ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = "600 10.5px 'IBM Plex Sans', sans-serif";
    const w = ctx.measureText(opts.label).width + 16, h = 20;
    const x = right - w, ty = Math.max(top, y - h - 5);
    ctx.fillStyle = "rgba(15, 26, 33, 0.95)"; ctx.strokeStyle = C.orange; ctx.lineWidth = 1;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, ty, w, h, 6); else ctx.rect(x, ty, w, h);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = C.orange; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(opts.label, x + w / 2, ty + h / 2 + 0.5);
    ctx.restore();
  },
};

/* ---------- Utilidades de gráfico ---------- */
function tooltipStyle() {
  return {
    backgroundColor: "#070B16", titleColor: C.text, bodyColor: C.text,
    borderColor: "#26323C", borderWidth: 1, padding: 10, cornerRadius: 8, boxPadding: 4,
    callbacks: {
      label: (c) => {
        const v = typeof c.parsed === "number" ? c.parsed : c.chart.options.indexAxis === "y" ? c.parsed.x : c.parsed.y;
        return ` ${c.dataset.label ? c.dataset.label + ": " : c.label ? c.label + ": " : ""}${fmt(v, 2)}`;
      },
    },
  };
}
function mount(id, config) {
  const canvas = $(id);
  if (!canvas) return;
  if (charts[id]) { charts[id].destroy(); delete charts[id]; }
  const vacio = !config.data.labels || config.data.labels.length === 0;
  canvas.parentElement.classList.toggle("is-empty", vacio);
  if (vacio) return;
  charts[id] = new Chart(canvas, config);
}
function gradV(c1, c2) {
  return (ctx) => {
    const a = ctx.chart.chartArea;
    if (!a) return c1;
    const g = ctx.chart.ctx.createLinearGradient(0, a.top, 0, a.bottom);
    g.addColorStop(0, c1); g.addColorStop(1, c2);
    return g;
  };
}
function gradH(c1, c2) {
  return (ctx) => {
    const a = ctx.chart.chartArea;
    if (!a) return c1;
    const g = ctx.chart.ctx.createLinearGradient(a.left, 0, a.right, 0);
    g.addColorStop(0, c1); g.addColorStop(1, c2);
    return g;
  };
}
const scaleX = () => ({
  grid: { display: false }, border: { color: "#21323D" },
  ticks: { color: C.dim, maxRotation: 0, autoSkipPadding: 14 },
});
const scaleY = (max) => ({
  beginAtZero: true, suggestedMax: max, grid: { color: C.grid }, border: { display: false },
  ticks: { color: C.faint, callback: (v) => fmt(v), maxTicksLimit: 6 },
});
const labelBase = {
  color: C.text, font: { family: "'IBM Plex Sans', sans-serif", weight: "600", size: 10.5 },
};

/* ---------- Gráficos ---------- */
function renderColumns(id, labels, data, { decimals = 0, avg = null, avgLabel = "" } = {}) {
  const max = Math.max(...data, 0);
  mount(id, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        data, borderRadius: { topLeft: 7, topRight: 7 }, borderSkipped: false, maxBarThickness: 54,
        backgroundColor: gradV("#34D399", "#0B8A62"),
        hoverBackgroundColor: gradV("#6EE7B7", "#10B981"),
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, layout: { padding: { top: 14 } },
      plugins: {
        tooltip: tooltipStyle(),
        datalabels: { ...labelBase, display: labels.length <= 14, anchor: "end", align: "end", offset: 3, formatter: (v) => fmt(v, decimals) },
        avgLine: avg === null ? {} : { value: avg, label: avgLabel },
      },
      scales: { x: scaleX(), y: scaleY(max * 1.22) },
    },
    plugins: [avgLine],
  });
}
function renderGrouped(id, labels, series, decimals = 0) {
  const max = Math.max(...series.flatMap((s) => s.data), 0);
  mount(id, {
    type: "bar",
    data: {
      labels,
      datasets: series.map((s) => ({
        label: s.label, data: s.data, backgroundColor: s.color,
        borderRadius: { topLeft: 6, topRight: 6 }, borderSkipped: false, maxBarThickness: 34,
      })),
    },
    options: {
      responsive: true, maintainAspectRatio: false, layout: { padding: { top: 12 } },
      plugins: {
        legend: { display: true, position: "bottom", labels: { color: C.dim, usePointStyle: true, pointStyle: "circle", boxWidth: 8, padding: 14 } },
        tooltip: tooltipStyle(),
        datalabels: { ...labelBase, display: labels.length * series.length <= 16, anchor: "end", align: "end", offset: 2, formatter: (v) => fmt(v, decimals) },
      },
      scales: { x: scaleX(), y: scaleY(max * 1.2) },
    },
  });
}
function renderHBar(id, labels, data, decimals = 0) {
  const max = Math.max(...data, 0);
  mount(id, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        data, borderRadius: 6, borderSkipped: false, barThickness: 18,
        backgroundColor: gradH("#0B8A62", "#34D399"),
      }],
    },
    options: {
      indexAxis: "y", responsive: true, maintainAspectRatio: false, layout: { padding: { right: 12 } },
      plugins: {
        tooltip: tooltipStyle(),
        datalabels: { ...labelBase, display: true, anchor: "end", align: "right", offset: 4, formatter: (v) => fmt(v, decimals) },
      },
      scales: {
        x: { ...scaleY(max * 1.18), ticks: { color: C.faint, callback: (v) => fmt(v), maxTicksLimit: 5 } },
        y: { grid: { display: false }, border: { display: false }, ticks: { color: C.text, callback(v) { return truncar(this.getLabelForValue(v), 28); } } },
      },
    },
  });
}
function renderDonut(id, labels, data, centerTitle, centerSub, decimals = 0) {
  const total = data.reduce((a, b) => a + Number(b), 0);
  const colores = labels.map((l, i) => (l === "Otros" ? C.other : PALETTE[i % PALETTE.length]));
  mount(id, {
    type: "doughnut",
    data: { labels, datasets: [{ data, backgroundColor: colores, borderColor: "#0F1A21", borderWidth: 3, hoverOffset: 5 }] },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: "68%",
      plugins: {
        tooltip: {
          ...tooltipStyle(),
          callbacks: { label: (c) => ` ${c.label}: ${fmt(c.parsed, decimals)} (${total ? Math.round((c.parsed / total) * 100) : 0}%)` },
        },
        datalabels: {
          ...labelBase, display: (c) => total > 0 && c.dataset.data[c.dataIndex] / total >= 0.06,
          color: "#04101C", font: { family: "'IBM Plex Sans', sans-serif", weight: "700", size: 11 },
          formatter: (v) => Math.round((v / total) * 100) + "%",
        },
        centerText: { title: centerTitle, sub: centerSub },
      },
    },
    plugins: [centerText],
  });
  const lg = $(id + "Legend");
  if (lg) {
    lg.innerHTML = labels.map((l, i) =>
      `<div class="legend-item"><i style="background:${colores[i]}"></i><span title="${l}">${truncar(l, 22)}</span><b>${total ? Math.round((data[i] / total) * 100) : 0}%</b></div>`
    ).join("");
  }
}
function renderArea(id, labels, datasets, { decimals = 0, avg = null, avgLabel = "" } = {}) {
  const maxAll = Math.max(...datasets.flatMap((d) => d.data), 0);
  mount(id, {
    type: "line",
    data: {
      labels,
      datasets: datasets.map((d) => {
        const mx = argmax(d.data), mn = argmin(d.data), last = d.data.length - 1;
        const marcados = new Set([mx, mn, last]);
        return {
          label: d.label, data: d.data, borderColor: d.color, borderWidth: 2.5, tension: 0.35, fill: true,
          backgroundColor: (ctx) => {
            const a = ctx.chart.chartArea;
            if (!a) return hexRgba(d.color, 0.15);
            const g = ctx.chart.ctx.createLinearGradient(0, a.top, 0, a.bottom);
            g.addColorStop(0, hexRgba(d.color, d.soft ? 0.12 : 0.34)); g.addColorStop(1, hexRgba(d.color, 0));
            return g;
          },
          pointBackgroundColor: d.color, pointBorderColor: "#0F1A21", pointBorderWidth: 2,
          pointRadius: (c) => (marcados.has(c.dataIndex) ? 4.5 : 0), pointHoverRadius: 5,
          datalabels: {
            ...labelBase, display: (c) => marcados.has(c.dataIndex),
            align: (c) => (c.dataIndex === mn && mn !== mx ? "bottom" : "top"), anchor: "center", offset: 9, clamp: true,
            backgroundColor: "rgba(15, 26, 33, 0.92)", borderColor: d.color, borderWidth: 1, borderRadius: 6,
            padding: { top: 3, bottom: 3, left: 6, right: 6 }, formatter: (v) => fmt(v, decimals),
          },
        };
      }),
    },
    options: {
      responsive: true, maintainAspectRatio: false, layout: { padding: { top: 24, right: 10 } },
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: datasets.length > 1, position: "bottom", labels: { color: C.dim, usePointStyle: true, pointStyle: "circle", boxWidth: 8, padding: 14 } },
        tooltip: tooltipStyle(),
        avgLine: avg === null ? {} : { value: avg, label: avgLabel },
      },
      scales: { x: scaleX(), y: scaleY(maxAll * 1.15) },
    },
    plugins: [avgLine],
  });
}

/* ---------- Plantillas ---------- */
function heroCard({ title, value, unit, badge, note }) {
  return `
    <article class="card hero span-3">
      <span class="eyebrow">Indicador principal</span>
      <h3>${title}</h3>
      <div class="hero-val">${value}<small>${unit}</small></div>
      <p class="hero-note">${note}</p>
      <span class="pill pill-orange">${badge}</span>
    </article>`;
}
function kpiCard({ icon, tone, title, value, unit, pct, barLabel, foot }) {
  return `
    <article class="card kpi tone-${tone} span-3">
      <div class="kpi-head"><span class="kpi-ico"><i class="fas ${icon}"></i></span><h3>${title}</h3></div>
      <div class="kpi-val">${value}<small>${unit}</small></div>
      <div class="bar"><i style="width:${clamp(pct)}%"></i></div>
      <div class="kpi-foot"><span>${barLabel}</span><b>${fmt(pct, 1)}%</b></div>
      <p class="kpi-note">${foot}</p>
    </article>`;
}
function plotCard(id, titulo, sub, span, size = "") {
  return `
    <article class="card span-${span}">
      <div class="card-head"><h3>${titulo}</h3><p>${sub}</p></div>
      <div class="plot ${size}"><canvas id="${id}"></canvas>
        <div class="plot-empty"><i class="fas fa-chart-simple"></i><span>Sin datos para mostrar</span></div></div>
    </article>`;
}
function donutCard(id, titulo, sub, span) {
  return `
    <article class="card span-${span}">
      <div class="card-head"><h3>${titulo}</h3><p>${sub}</p></div>
      <div class="plot donut"><canvas id="${id}"></canvas>
        <div class="plot-empty"><i class="fas fa-chart-pie"></i><span>Sin datos para mostrar</span></div></div>
      <div class="legend" id="${id}Legend"></div>
    </article>`;
}
function slotCard(id, titulo, sub, span, inner = "") {
  return `
    <article class="card span-${span}">
      <div class="card-head"><h3>${titulo}</h3><p>${sub}</p></div>
      <div id="${id}" class="${inner}"></div>
    </article>`;
}
function footCard(key, texto) {
  return `
    <footer class="card foot span-12">
      <div><h4>Metodología y fuentes</h4><p id="${key}Nota">${texto}</p></div>
      <div class="foot-side">
        <span class="foot-ref">Origen: <b id="${key}Origen">Supabase</b></span>
        <button type="button" class="btn-export js-export"><i class="fas fa-file-arrow-down"></i> Exportar CSV</button>
      </div>
    </footer>`;
}
function medidores(id, entradas, total, unidad, decimals = 0) {
  const el = $(id);
  if (!entradas.length) { el.innerHTML = `<div class="plot-empty" style="display:flex;position:static;min-height:120px"><i class="fas fa-chart-simple"></i><span>Sin datos para mostrar</span></div>`; return; }
  const max = Math.max(...entradas.map((e) => e[1]), 1);
  const N = 12;
  el.innerHTML = entradas.map(([n, v], i) => {
    const on = Math.max(1, Math.round((v / max) * N));
    const color = PALETTE[i % PALETTE.length];
    const share = total ? Math.round((v / total) * 100) : 0;
    return `<div class="seg-row" style="--c:${color}">
      <span class="seg-name" title="${n}">${truncar(n, 22)}</span>
      <div class="segs">${Array.from({ length: N }, (_, k) => `<i class="${k < on ? "on" : ""}"></i>`).join("")}</div>
      <span class="seg-pill">${fmt(v, decimals)}${unidad} · ${share}%</span>
    </div>`;
  }).join("");
}
function tabla(encabezados, filas) {
  return `<div class="tbl-wrap"><table class="tbl"><thead><tr>${encabezados
    .map((h) => `<th class="${h.num ? "num" : ""}">${h.t}</th>`).join("")}</tr></thead><tbody>${
    filas.map((f) => `<tr>${f.map((c, i) => `<td class="${encabezados[i].num ? "num" : ""} ${i === 0 ? "name" : ""}">${c}</td>`).join("")}</tr>`).join("")
  }</tbody></table></div>`;
}
const shareCell = (pct, ancho, tone = "cyan") =>
  `<div class="share"><div class="bar" style="--tone:var(--${tone})"><i style="width:${clamp(ancho)}%"></i></div><b>${fmt(pct, 1)}%</b></div>`;

function llenarSelect(id, data, columna, etiquetaTodos) {
  const select = $(id);
  if (!select) return;
  const actual = select.value;
  select.innerHTML = `<option value="">${etiquetaTodos}</option>`;
  if (!columna) return;
  const valores = [...new Set(data.map((f) => norm(f[columna])).filter((v) => v !== ""))];
  valores.sort((a, b) => a.localeCompare(b, "es", { numeric: true }));
  valores.forEach((v) => {
    const opt = document.createElement("option");
    opt.value = v; opt.textContent = v;
    select.appendChild(opt);
  });
  if (actual && valores.includes(actual)) select.value = actual;
}

/* ---------- Esqueleto ---------- */
function construirLayout() {
  $("gridResumen").innerHTML = [
    `<div class="contents" id="kpiResumen"></div>`,
    plotCard("rEvolucion", "Evolución diaria de compras", "Monto por fecha, con promedio", 8, "tall"),
    donutCard("rMoneda", "Compras por moneda", "MN vs ME", 4),
    donutCard("rUrgencia", "Compras por urgencia", "SI / NO", 4),
    plotCard("rSede", "Compras por sede", "Huachipa · Huaral · Otros", 4),
    plotCard("rMetodoPago", "Compras por método de pago", "Contado · Crédito · Sin dato", 4),
    footCard("resumen", ""),
  ].join("");

  $("gridProveedores").innerHTML = [
    `<div class="contents" id="kpiProveedores"></div>`,
    plotCard("pTopProvMonto", "Top proveedores por monto", "10 principales por monto total", 8, "tall"),
    donutCard("pConcentracion", "Concentración de proveedores", "Peso de los 5 principales sobre el total", 4),
    plotCard("pTopProvCant", "Top proveedores por N° de OCs", "Cantidad de órdenes emitidas", 6),
    plotCard("pTopAreas", "Top áreas por monto", "Áreas con mayor gasto", 6),
    slotCard("pProvTable", "Detalle de proveedores", "Monto · OCs · Ticket promedio", 12),
    footCard("proveedores", ""),
  ].join("");

  $("gridEstado").innerHTML = [
    `<div class="contents" id="kpiEstado"></div>`,
    donutCard("eEstadoDoc", "Compras por estado", "Emitida · Reg. Compras · Rec. Total", 4),
    donutCard("eMetodoDoc", "Compras por método de pago", "Contado · Crédito", 4),
    plotCard("eEstadoMonto", "Monto por estado", "Distribución del monto según estado", 4),
    plotCard("eResponsable", "Compras por responsable", "Top responsables por monto gestionado", 6),
    slotCard("eEstadoTable", "Detalle por estado", "Monto · Órdenes · Ticket promedio", 6),
    footCard("estado", ""),
  ].join("");
}

/* ---------- Columnas ---------- */
function resolverColumnas() {
  const c = state.compras;
  cols.oc = col(c, "OC");
  cols.fecha = col(c, "FECHA");
  cols.proveedor = col(c, "PROVEEDOR");
  cols.ruc = col(c, "RUC");
  cols.monto = col(c, "MONTO");
  cols.moneda = col(c, "MONEDA");
  cols.metodo = col(c, "METODO DE PAGO");
  cols.estado = col(c, "ESTADO");
  cols.responsable = col(c, "RESPONSABLE");
  cols.sede = col(c, "SEDE");
  cols.urgencia = col(c, "URGENCIA");
  cols.area = col(c, "AREA");
}

/* ---------- Render: Resumen ---------- */
function renderResumen(data) {
  const c = cols;
  let monto = 0;
  data.forEach((f) => { monto += num(f[c.monto]); });
  const totalOC = data.length;
  const ticket = totalOC ? monto / totalOC : 0;

  const evo = porFecha(data, c.fecha, (f) => num(f[c.monto]));
  const dias = evo.values.length;
  const avgDia = dias ? monto / dias : 0;
  const mi = dias ? argmax(evo.values) : 0;

  const monedaCount = countBy(data, (f) => norm(f[c.moneda]) || "Sin dato");
  const mn = monedaCount["MN"] || 0;
  const me = monedaCount["ME"] || 0;

  const urgenciaCount = countBy(data, (f) => norm(f[c.urgencia]).toUpperCase() || "Sin dato");
  const urgSI = urgenciaCount["SI"] || 0;
  const urgNO = urgenciaCount["NO"] || 0;
  const pctUrg = totalOC ? (urgSI / totalOC) * 100 : 0;

  $("kpiResumen").innerHTML = [
    heroCard({
      title: "Monto total de compras", value: fmtMoney(monto, 0), unit: "",
      note: `${totalOC} órdenes · ticket promedio ${fmtMoney(ticket, 0)}`,
      badge: dias ? `Mejor día: ${evo.labels[mi]} · ${fmtMoney(evo.values[mi], 0)}` : "Sin datos",
    }),
    kpiCard({
      icon: "fa-file-invoice", tone: "blue", title: "Órdenes de compra", value: fmt(totalOC), unit: "",
      pct: 100, barLabel: "Total del periodo",
      foot: `${fmt(totalOC ? monto / totalOC : 0, 0)} soles por OC`,
    }),
    kpiCard({
      icon: "fa-coins", tone: "green", title: "Compras en MN", value: fmt(mn), unit: "OCs",
      pct: totalOC ? (mn / totalOC) * 100 : 0, barLabel: "Soles (MN)",
      foot: `${fmt(me)} en ME · ${fmt(totalOC ? mn / totalOC * 100 : 0, 0)}% del total`,
    }),
    kpiCard({
      icon: "fa-triangle-exclamation", tone: "gold", title: "Compras urgentes", value: fmt(urgSI), unit: "",
      pct: pctUrg, barLabel: "Sobre el total",
      foot: `${fmt(urgNO)} no urgentes · ${pctUrg.toFixed(1)}% con urgencia`,
    }),
  ].join("");

  // Evolución (área)
  renderArea("rEvolucion", evo.labels,
    [{ label: "Monto", color: C.cyan, data: evo.values.map((v) => round(v, 2)) }],
    { decimals: 0, avg: dias ? avgDia : null, avgLabel: `Prom. ${fmt(avgDia, 0)}` });

  // Moneda (dona)
  const monedaArr = Object.entries(monedaCount).sort((a, b) => b[1] - a[1]);
  renderDonut("rMoneda", monedaArr.map((m) => m[0]), monedaArr.map((m) => m[1]), fmt(totalOC), "OCs");

  // Urgencia (dona)
  const urgArr = Object.entries(urgenciaCount).sort((a, b) => b[1] - a[1]);
  renderDonut("rUrgencia", urgArr.map((u) => u[0]), urgArr.map((u) => u[1]), fmt(totalOC), "OCs");

  // Sede (columnas)
  const porSede = sumBy(data, (f) => norm(f[c.sede]) || "Sin sede", (f) => num(f[c.monto]));
  const sedeArr = Object.entries(porSede).sort((a, b) => b[1] - a[1]);
  renderColumns("rSede", sedeArr.map((s) => s[0]), sedeArr.map((s) => round(s[1], 0)), { decimals: 0 });

  // Método de pago (columnas)
  const porMetodo = sumBy(data, (f) => norm(f[c.metodo]) || "Sin dato", (f) => num(f[c.monto]));
  const metodoArr = Object.entries(porMetodo).sort((a, b) => b[1] - a[1]);
  renderColumns("rMetodoPago", metodoArr.map((m) => m[0]), metodoArr.map((m) => round(m[1], 0)), { decimals: 0 });

  $("resumenNota").textContent =
    `Datos de la hoja COMPRAS (${fmt(data.length)} registros en el filtro actual). ` +
    `El monto está expresado en la moneda indicada (MN o ME) sin conversión. ` +
    `El promedio diario considera solo días con movimiento.`;
}

/* ---------- Render: Proveedores y Áreas ---------- */
function renderProveedores(data) {
  const c = cols;

  // Agregado por proveedor
  const agg = {};
  data.forEach((f) => {
    const p = norm(f[c.proveedor]) || "Sin proveedor";
    if (!agg[p]) agg[p] = { monto: 0, ocs: 0 };
    agg[p].monto += num(f[c.monto]);
    agg[p].ocs++;
  });
  const provArr = Object.entries(agg).sort((a, b) => b[1].monto - a[1].monto);

  const montoTotal = data.reduce((a, f) => a + num(f[c.monto]), 0);
  const totalOC = data.length;
  const top5Monto = provArr.slice(0, 5).reduce((a, e) => a + e[1].monto, 0);
  const concentracion = montoTotal ? (top5Monto / montoTotal) * 100 : 0;

  $("kpiProveedores").innerHTML = [
    heroCard({
      title: "Proveedores activos", value: fmt(provArr.length), unit: "",
      note: `${totalOC} órdenes repartidas en ${provArr.length} proveedores`,
      badge: `Top proveedor: ${truncar(provArr[0] ? provArr[0][0] : "—", 22)}`,
    }),
    kpiCard({
      icon: "fa-crown", tone: "gold", title: "Top proveedor", value: provArr[0] ? fmtMoney(provArr[0][1].monto, 0) : "—", unit: "",
      pct: provArr[0] && montoTotal ? (provArr[0][1].monto / montoTotal) * 100 : 0, barLabel: "Participación en monto",
      foot: provArr[0] ? `${provArr[0][1].ocs} OCs · ${truncar(provArr[0][0], 30)}` : "",
    }),
    kpiCard({
      icon: "fa-chart-pie", tone: "blue", title: "Concentración Top 5", value: concentracion.toFixed(1), unit: "%",
      pct: concentracion, barLabel: "Del monto total",
      foot: `${fmtMoney(top5Monto, 0)} de ${fmtMoney(montoTotal, 0)}`,
    }),
    kpiCard({
      icon: "fa-receipt", tone: "green", title: "Ticket promedio", value: fmtMoney(totalOC ? montoTotal / totalOC : 0, 0), unit: "",
      pct: 100, barLabel: "Por OC",
      foot: `${fmt(totalOC)} órdenes registradas`,
    }),
  ].join("");

  // Top proveedores por monto (barras horizontales)
  const top10Monto = provArr.slice(0, 10);
  renderHBar("pTopProvMonto", top10Monto.map((p) => p[0]), top10Monto.map((p) => round(p[1].monto, 0)), 0);

  // Concentración (dona Top 5 + Otros)
  const top5 = provArr.slice(0, 5);
  const otros = provArr.slice(5).reduce((a, e) => a + e[1].monto, 0);
  const donutData = top5.map((p) => round(p[1].monto, 0));
  const donutLabels = top5.map((p) => truncar(p[0], 25));
  if (otros > 0) { donutData.push(round(otros, 0)); donutLabels.push("Otros"); }
  renderDonut("pConcentracion", donutLabels, donutData, fmtMoney(montoTotal, 0), "monto total", 0);

  // Top proveedores por N° OCs (columnas)
  const provOCs = Object.entries(agg).sort((a, b) => b[1].ocs - a[1].ocs).slice(0, 10);
  renderColumns("pTopProvCant", provOCs.map((p) => truncar(p[0], 15)), provOCs.map((p) => p[1].ocs), { decimals: 0 });

  // Top áreas por monto (columnas)
  const porArea = sumBy(data, (f) => norm(f[c.area]) || "Sin área", (f) => num(f[c.monto]));
  const areaArr = Object.entries(porArea).sort((a, b) => b[1] - a[1]);
  renderColumns("pTopAreas", areaArr.map((a) => a[0]), areaArr.map((a) => round(a[1], 0)), { decimals: 0 });

  // Tabla detalle de proveedores
  const maxMonto = provArr[0] ? provArr[0][1].monto : 1;
  $("pProvTable").innerHTML = provArr.length
    ? tabla(
        [{ t: "Proveedor" }, { t: "OCs", num: 1 }, { t: "Monto total", num: 1 }, { t: "Ticket prom.", num: 1 }, { t: "Participación" }],
        provArr.slice(0, 15).map(([p, v]) => [
          truncar(p, 42),
          fmt(v.ocs),
          fmtMoney(v.monto, 2),
          fmtMoney(v.monto / v.ocs, 2),
          shareCell(montoTotal ? (v.monto / montoTotal) * 100 : 0, (v.monto / maxMonto) * 100, "cyan"),
        ])
      )
    : `<div class="plot-empty" style="display:flex;position:static;min-height:120px"><i class="fas fa-chart-simple"></i><span>Sin datos para mostrar</span></div>`;

  $("proveedoresNota").textContent =
    `Los proveedores se agrupan por columna PROVEEDOR (${fmt(provArr.length)} distintos en el filtro actual). ` +
    `La concentración mide el peso de los 5 proveedores con mayor monto sobre el total: ${concentracion.toFixed(1)}%.`;
}

/* ---------- Render: Estados y Pagos ---------- */
function renderEstado(data) {
  const c = cols;
  const montoTotal = data.reduce((a, f) => a + num(f[c.monto]), 0);
  const totalOC = data.length;
  const ticket = totalOC ? montoTotal / totalOC : 0;

  const porEstado = countBy(data, (f) => norm(f[c.estado]) || "Sin estado");
  const porMetodo = countBy(data, (f) => norm(f[c.metodo]) || "Sin dato");
  const estadoMonto = sumBy(data, (f) => norm(f[c.estado]) || "Sin estado", (f) => num(f[c.monto]));
  const porResp = sumBy(data, (f) => norm(f[c.responsable]) || "Sin responsable", (f) => num(f[c.monto]));

  const recTotal = porEstado["REC.TOTAL"] || 0;
  const regTotal = (porEstado["REG. COMPRAS TOTAL"] || 0) + (porEstado["REC. PARCIAL"] || 0);
  const anuladas = porEstado["ANULADA"] || 0;

  $("kpiEstado").innerHTML = [
    heroCard({
      title: "Monto gestionado", value: fmtMoney(montoTotal, 0), unit: "",
      note: `${totalOC} órdenes · ticket ${fmtMoney(ticket, 0)}`,
      badge: `Estado más común: ${truncar(Object.entries(porEstado).sort((a,b)=>b[1]-a[1])[0] ? Object.entries(porEstado).sort((a,b)=>b[1]-a[1])[0][0] : "—", 24)}`,
    }),
    kpiCard({
      icon: "fa-circle-check", tone: "green", title: "Recibidas Totales", value: fmt(recTotal), unit: "OCs",
      pct: totalOC ? (recTotal / totalOC) * 100 : 0, barLabel: "Del total",
      foot: `Registradas y completadas`,
    }),
    kpiCard({
      icon: "fa-clipboard-check", tone: "blue", title: "En proceso", value: fmt(regTotal), unit: "OCs",
      pct: totalOC ? (regTotal / totalOC) * 100 : 0, barLabel: "Registradas / parciales",
      foot: `Aún en flujo de recepción`,
    }),
    kpiCard({
      icon: "fa-ban", tone: "gold", title: "Anuladas", value: fmt(anuladas), unit: "OCs",
      pct: totalOC ? (anuladas / totalOC) * 100 : 0, barLabel: "Del total",
      foot: `Órdenes canceladas`,
    }),
  ].join("");

  // Dona estados
  const estadoArr = Object.entries(porEstado).sort((a, b) => b[1] - a[1]);
  renderDonut("eEstadoDoc", estadoArr.map((e) => truncar(e[0], 22)), estadoArr.map((e) => e[1]), fmt(totalOC), "OCs");

  // Dona método de pago
  const metodoArr = Object.entries(porMetodo).sort((a, b) => b[1] - a[1]);
  renderDonut("eMetodoDoc", metodoArr.map((m) => m[0]), metodoArr.map((m) => m[1]), fmt(totalOC), "OCs");

  // Monto por estado (columnas)
  const estadoMontoArr = Object.entries(estadoMonto).sort((a, b) => b[1] - a[1]);
  renderColumns("eEstadoMonto", estadoMontoArr.map((e) => truncar(e[0], 18)), estadoMontoArr.map((e) => round(e[1], 0)), { decimals: 0 });

  // Responsables (barras horizontales)
  const respArr = Object.entries(porResp).sort((a, b) => b[1] - a[1]).slice(0, 10);
  renderHBar("eResponsable", respArr.map((r) => r[0]), respArr.map((r) => round(r[1], 0)), 0);

  // Tabla resumen por estado
  const aggEstado = {};
  data.forEach((f) => {
    const e = norm(f[c.estado]) || "Sin estado";
    if (!aggEstado[e]) aggEstado[e] = { monto: 0, ocs: 0 };
    aggEstado[e].monto += num(f[c.monto]);
    aggEstado[e].ocs++;
  });
  const tablaArr = Object.entries(aggEstado).sort((a, b) => b[1].monto - a[1].monto);
  const maxMontoE = tablaArr[0] ? tablaArr[0][1].monto : 1;

  $("eEstadoTable").innerHTML = tablaArr.length
    ? tabla(
        [{ t: "Estado" }, { t: "OCs", num: 1 }, { t: "Monto", num: 1 }, { t: "Ticket", num: 1 }, { t: "Participación" }],
        tablaArr.map(([e, v]) => [
          truncar(e, 30),
          fmt(v.ocs),
          fmtMoney(v.monto, 2),
          fmtMoney(v.monto / v.ocs, 2),
          shareCell(montoTotal ? (v.monto / montoTotal) * 100 : 0, (v.monto / maxMontoE) * 100, "gold"),
        ])
      )
    : `<div class="plot-empty" style="display:flex;position:static;min-height:120px"><i class="fas fa-chart-simple"></i><span>Sin datos para mostrar</span></div>`;

  $("estadoNota").textContent =
    `Los estados provienen de la columna ESTADO (${fmt(Object.keys(aggEstado).length)} distintos en el filtro actual). ` +
    `El método de pago puede estar vacío en algunos registros (se agrupan en "Sin dato").`;
}

/* ---------- Filtros ---------- */
const SECCIONES = {
  resumen: {
    datos: () => state.compras, render: renderResumen,
    badge: "badgeResumen", clear: "clearResumen",
    filtros: [
      { id: "filterSedeR", col: () => cols.sede, todos: "Todas" },
      { id: "filterAreaR", col: () => cols.area, todos: "Todas" },
      { id: "filterMonedaR", col: () => cols.moneda, todos: "Todas" },
      { id: "filterUrgenciaR", col: () => cols.urgencia, todos: "Todas" },
    ],
  },
  proveedores: {
    datos: () => state.compras, render: renderProveedores,
    badge: "badgeProveedores", clear: "clearProveedores",
    filtros: [
      { id: "filterSedeP", col: () => cols.sede, todos: "Todas" },
      { id: "filterAreaP", col: () => cols.area, todos: "Todas" },
      { id: "filterMonedaP", col: () => cols.moneda, todos: "Todas" },
    ],
  },
  estado: {
    datos: () => state.compras, render: renderEstado,
    badge: "badgeEstado", clear: "clearEstado",
    filtros: [
      { id: "filterSedeE", col: () => cols.sede, todos: "Todas" },
      { id: "filterAreaE", col: () => cols.area, todos: "Todas" },
    ],
  },
};

function actualizarChips() {
  const filtrado = ultimo[seccionActual];
  const total = state.compras.length;
  let monto = 0;
  filtrado.forEach((f) => { monto += num(f[cols.monto]); });
  $("chipPeriodo").textContent = rangoFechas(filtrado, cols.fecha);
  $("chipMonto").textContent = fmtMoney(monto, 0);
}

function aplicar(key) {
  const s = SECCIONES[key];
  const activos = s.filtros
    .map((f) => ({ col: f.col(), val: $(f.id).value }))
    .filter((f) => f.val);
  s.filtros.forEach((f) => $(f.id).classList.toggle("is-active", !!$(f.id).value));

  const total = s.datos();
  const filtrado = activos.length ? total.filter((r) => activos.every((a) => norm(r[a.col]) === a.val)) : total;
  ultimo[key] = filtrado;
  s.render(filtrado);

  const badge = $(s.badge);
  badge.textContent = activos.length;
  badge.hidden = activos.length === 0;
  if (key === seccionActual) actualizarChips();
}

function prepararFiltros(key) {
  const s = SECCIONES[key];
  s.filtros.forEach((f) => llenarSelect(f.id, s.datos(), f.col(), f.todos));
}

/* ---------- Exportar CSV ---------- */
function exportarCSV() {
  const filas = ultimo[seccionActual];
  if (!filas.length) return;
  const cab = Object.keys(filas[0]);
  const esc = (v) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [cab.map(esc).join(","), ...filas.map((r) => cab.map((k) => esc(r[k])).join(","))].join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${seccionActual}_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ---------- Eventos ---------- */
function engancharEventos() {
  if (listenersReady) return;
  listenersReady = true;

  Object.entries(SECCIONES).forEach(([key, s]) => {
    s.filtros.forEach((f) => $(f.id).addEventListener("change", () => aplicar(key)));
    $(s.clear).addEventListener("click", () => {
      s.filtros.forEach((f) => ($(f.id).value = ""));
      aplicar(key);
    });
  });

  document.querySelectorAll("#dashTabs .tab").forEach((tab) =>
    tab.addEventListener("click", (e) => { e.preventDefault(); cambiarSeccion(tab.dataset.seccion); })
  );
  document.querySelectorAll(".js-export").forEach((b) => b.addEventListener("click", exportarCSV));
  document.querySelectorAll(".js-refresh").forEach((b) =>
    b.addEventListener("click", async () => {
      document.querySelectorAll(".js-refresh").forEach((x) => { x.disabled = true; x.classList.add("is-loading"); });
      try { await cargarTodo(); } catch (err) { console.error(err); }
      document.querySelectorAll(".js-refresh").forEach((x) => { x.disabled = false; x.classList.remove("is-loading"); });
    })
  );
}

/* ---------- Navegación ---------- */
function cambiarSeccion(seccion) {
  if (!SECCIONES[seccion]) seccion = "resumen";
  seccionActual = seccion;
  document.querySelectorAll("#dashTabs .tab").forEach((t) => t.classList.toggle("active", t.dataset.seccion === seccion));
  Object.keys(SECCIONES).forEach((k) => { $(k).hidden = k !== seccion; });
  try { history.replaceState(null, "", "#" + seccion); } catch (e) { /* entorno sin historial */ }
  actualizarChips();
  requestAnimationFrame(() => Object.values(charts).forEach((ch) => ch.resize()));
}

/* ---------- Carga completa ---------- */
async function cargarTodo() {
  const c = await cargarHoja("COMPRAS");
  state.compras = c;
  resolverColumnas();
  Object.keys(SECCIONES).forEach(prepararFiltros);
  Object.keys(SECCIONES).forEach(aplicar);
  ultimaCarga = new Date();
  $("stRegistros").textContent = fmt(c.length);
  $("stSync").textContent = ultimaCarga.toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" });
}

/* ---------- Inicio ---------- */
(async function init() {
  construirLayout();
  try {
    await cargarTodo();
    $("loading").hidden = true;
    $("topbar").hidden = false;
    $("shell").hidden = false;
    engancharEventos();
    cambiarSeccion(location.hash.replace("#", "") || "resumen");
  } catch (err) {
    console.error(err);
    $("loading").innerHTML = `
      <div class="error-box">
        <i class="fas fa-triangle-exclamation"></i>
        <h3>No se pudieron cargar los datos</h3>
        <p>${err.message || err}</p>
      </div>`;
  }
})();