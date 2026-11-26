/* =====================================================================
   dashboard.js · CORE Transporte · Transporte de personal agrícola
   Una fila del Excel = un trabajador transportado en una fecha (un "viaje").
   - Viajes = filas. Trabajadores únicos = DNI distintos (NRO. DOC. PASA.;
     si falta, el nombre).
   - Servicio = una salida de un bus: misma FECHA + PLACA (editable en
     CONFIG.SERVICIO). La ocupación de un servicio se calcula con TODOS sus
     trabajadores, aunque el tablero esté filtrado por actividad o lote.
   - % ocupación promedio = Σ trabajadores a bordo ÷ Σ capacidad de los
     servicios en vista (ponderado por asientos, no un promedio simple).
   - Todos los valores de los filtros salen de los datos: nada está escrito a mano.
   Sincronización: aviso entre pestañas (con número de versión), Realtime,
   sondeo liviano, al volver a la pestaña, al restaurar desde el historial
   (bfcache) y espera activa de la versión recién publicada.
   ===================================================================== */
"use strict";


/* =========================== CONFIGURACIÓN =========================== */
const CONFIG = {
  SUPABASE_URL: "https://szgzymjyfzcfouvtfzjh.supabase.co",
  SUPABASE_KEY: "sb_publishable_curmqHk2B8wNCqZ0pCd9QA_othBWAjS",
  TABLE: "dashboard_data",
  SHEET: "ALMACEN_DATA",       // sheet_name en Supabase (el mismo que usa index.js / worker.js)
  HOME_URL: "index.html",
  BUS: "core-dashboard",
  LS_UPLOAD: "core:lastUpload",
  LS_THEME: "core:theme",
  LS_DATASET: "core:tr:tablero",
  POLL_MS: 20000,

  // Reglas de cálculo (editables)
  META_OCUP: 85,               // % de ocupación de los buses: meta referencial
  SERVICIO: ["fecha", "placa"],// qué define una salida de bus (agrega "origen" si un bus hace varias rutas por día)
  MIN_SERVICIOS: 3,            // servicios mínimos para rankear la ocupación de un bus
  TOP_N: 15,
  PAGE_SIZE: 50,
};

const noStoreFetch = (input, init = {}) => fetch(input, { ...init, cache: "no-store" });
const sb = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY, {
  global: { fetch: noStoreFetch },
  auth: { persistSession: false },
});
const REDUCED = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;


/* =========================== CONSTANTES =========================== */
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const MES_CORTO = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const DIA_CORTO = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

// Catálogo de segmentadores
const DIMCAT = {
  sede: { label: "Sede", icon: "fa-building-wheat", empty: "(Sin sede)" },
  origen: { label: "Origen", icon: "fa-location-dot", empty: "(Sin origen)" },
  fundo: { label: "Fundo", icon: "fa-seedling", empty: "(Sin fundo)" },
  lote: { label: "Lote", icon: "fa-border-all", empty: "(Sin lote)" },
  actividad: { label: "Actividad", icon: "fa-person-digging", empty: "(Sin actividad)" },
  placa: { label: "Placa", icon: "fa-bus", empty: "(Sin placa)" },
  tbus: { label: "Tipo de bus", icon: "fa-van-shuttle", empty: "(Sin tipo)" },
  trabajador: { label: "Trabajador", icon: "fa-id-card", empty: "(Sin nombre)" },
  mes: { label: "Mes", icon: "fa-calendar-days", sort: "mes", empty: "(Sin fecha)" },
  sem: { label: "Semana", icon: "fa-calendar-week", sortBy: "_sk", empty: "(Sin semana)" },
};
const DIMS_TR = ["sede", "origen", "fundo", "lote", "actividad", "placa", "tbus", "trabajador", "mes", "sem"];

const FILES = { tr: { label: "Transporte de personal", icon: "fa-bus", excel: "Registro de viajes del personal" } };

/* ---------- El tablero ----------
   sheet = sheet_name en Supabase (el mismo que usa index.js) */
const DATASETS = {
  transporte: {
    file: "tr", sheet: CONFIG.SHEET, tab: "Viajes", engine: "tr",
    titulo: "Transporte de personal agrícola", icon: "fa-bus-simple", term: ["viaje", "viajes"], fechaLabel: "Fecha",
    dims: [["sede", "main"], ["origen", "main"], ["fundo", "main"], ["actividad", "main"], ["placa", "main"], ["tbus", "main"], ["mes", "main"], ["sem", "main"],
      ["lote", "more"], ["trabajador", "more"]],
    kpis: ["trViajes", "trTrab", "trOcup", "trBuses"],
    secs: [
      { k: "resumen", t: "Resumen", icon: "fa-gauge-high", desc: "Volumen de viajes, trabajadores transportados, ocupación de los buses y lo más destacado del período.", kpis: true,
        items: [["trDia", 12, "lg"], ["trActividad", 5, "donut"], ["trRutas", 7], ["xHall", 12]] },
      { k: "tiempo", t: "Evolución", icon: "fa-chart-line", desc: "Cómo cambia el transporte semana a semana y mes a mes, y qué días concentran la demanda.",
        items: [["trSemana", 6], ["trMes", 6], ["xCalor", 12], ["tPeriodo", 12]] },
      { k: "ocupacion", t: "Ocupación y flota", icon: "fa-bus", desc: "Qué tan llenos salen los buses, qué vehículos trabajan más y cuáles salen casi vacíos.",
        items: [["trOcupDia", 12, "lg"], ["trTipoBus", 5, "donut"], ["trPlaca", 7], ["trOcupPlaca", 6], ["trDistOcup", 6], ["tPlaca", 12]] },
      { k: "rutas", t: "Rutas y destinos", icon: "fa-map-location-dot", desc: "De dónde salen los trabajadores, a qué fundos y lotes llegan, y qué rutas pesan más.",
        items: [["trOrigen", 6], ["trFundo", 6], ["trParetoLote", 12, "lg"], ["tRuta", 12], ["tSede", 12], ["tLote", 12]] },
      { k: "trabajadores", t: "Trabajadores", icon: "fa-people-group", desc: "Quiénes usan más el transporte, cuántos días viajan y por cuántos lotes y buses pasan.",
        items: [["trFrecuentes", 12, "xl"], ["tTrabajador", 12]] },
      { k: "calidad", t: "Calidad de datos", icon: "fa-shield-halved", desc: "Registros sin nombre, sin documento, sin lote o repetidos: lo que conviene corregir en el Excel.",
        items: [["xCalidad", 12], ["tCalidad", 12]] },
      { k: "detalle", t: "Detalle de viajes", icon: "fa-table-list", desc: "Cada registro del Excel. Respeta los filtros.", items: [["tDetalle", 12]] },
    ],
  },
};
const DS_KEYS = Object.keys(DATASETS);
DS_KEYS.forEach((k) => { DATASETS[k].key = k; });
const dsOf = (sheet) => DS_KEYS.find((k) => DATASETS[k].sheet === sheet);

/* =========================== ESTADO =========================== */
const DS_FIELDS = ["payload", "filas", "dims", "rango", "filtros", "seccion", "signature", "uploadedAt", "sort", "page", "q", "moreOpen"];
const nuevoStore = () => ({ payload: null, filas: [], dims: {}, rango: { min: "", max: "" }, filtros: { desde: "", hasta: "" }, seccion: "", signature: null, uploadedAt: null, sort: {}, page: {}, q: {}, moreOpen: false });
const STORE = Object.fromEntries(DS_KEYS.map((k) => [k, nuevoStore()]));
const PUB = {};

const state = { ds: DS_KEYS[0], ...nuevoStore(), vista: [], d: null, lastSync: null, loading: null, pendiente: null, expect: 0, error: null, tk: null };
const charts = {};
const outs = {};
const tables = {};
const DS = () => DATASETS[state.ds];
const ENG = () => ENGINES[DS().engine];
/* =========================== UTILIDADES =========================== */
const $ = (id) => document.getElementById(id);
const NF = {};
const fmt = (v, d = 0) => (NF[d] || (NF[d] = new Intl.NumberFormat("es-PE", { maximumFractionDigits: d, minimumFractionDigits: d }))).format(Number(v || 0));
const compactNF = new Intl.NumberFormat("es-PE", { notation: "compact", maximumFractionDigits: 1 });
const fmtSC = (v) => compactNF.format(Number(v || 0));
const fmtD = (v) => fmt(v, 1) + " días";
const fmtPct = (v, d = 1) => fmt(v, d) + " %";
const fmtC = (v) => compactNF.format(Number(v || 0));
const fmtX = (v) => (v == null ? "—" : fmt(v, 2) + "×");
const signo = (v, f = (x) => fmt(x, 1)) => (v > 0 ? "+" : v < 0 ? "−" : "") + f(Math.abs(v));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cell = (v, f) => ({ v, f: f ? f(v) : v });
const slug = (s) => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const fold2 = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const maxBy = (arr, k) => arr.reduce((a, b) => (b[k] > a[k] ? b : a), arr[0]);
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const trunc = (s, n) => { s = String(s ?? ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
const nOpt = (d = 0) => (v) => (v == null ? "—" : fmt(v, d));
const pOpt = (v) => (v == null ? "—" : fmt(v, 1));
const si = (b) => (b ? "Sí" : "—");
const vacio = (s) => !s || String(s).startsWith("(");

function rgba(hex, a) {
  const h = String(hex).trim().replace("#", "");
  if (h.length !== 6) return hex;
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
function isObj(x) { return x && typeof x === "object" && !Array.isArray(x) && !(x instanceof Function); }
function merge(target, ...srcs) {
  srcs.forEach((src) => {
    Object.keys(src || {}).forEach((k) => {
      if (isObj(src[k]) && isObj(target[k])) merge(target[k], src[k]);
      else target[k] = src[k];
    });
  });
  return target;
}
function relTime(date) {
  if (!date) return "—";
  const s = Math.round((Date.now() - new Date(date).getTime()) / 1000);
  if (isNaN(s)) return "—";
  if (s < 10) return "recién";
  if (s < 60) return `hace ${s} s`;
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  return new Date(date).toLocaleDateString("es-PE", { day: "2-digit", month: "short" });
}
function tokens() {
  const cs = getComputedStyle(document.documentElement);
  const g = (n) => cs.getPropertyValue(n).trim();
  const series = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => g(`--series-${i}`));
  return {
    ink: g("--ink"), ink2: g("--ink-2"), ink3: g("--ink-3"), line: g("--line"), lineStrong: g("--line-strong"),
    grid: g("--grid"), surface: g("--surface"), brand: g("--brand"), series,
    neutral: g("--series-neutral"), good: g("--good"), warn: g("--warn"), crit: g("--crit"),
    // Colores fijos de significado en todo el dashboard
    stock: series[0], ing: series[2], egr: series[1],
  };
}

/* ---------- Fechas ---------- */
const parseISO = (s) => { const [y, m, d] = String(s).split("-").map(Number); return new Date(y, (m || 1) - 1, d || 1); };
const toISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (iso, n) => { const d = parseISO(iso); d.setDate(d.getDate() + n); return toISO(d); };
const fmtDia = (iso) => { if (!iso) return "—"; const d = parseISO(iso); return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`; };
const fdia = (v) => (v ? fmtDia(v) + "/" + v.slice(2, 4) : "—");
const fmtDiaLargo = (iso) => { if (!iso) return "—"; const d = parseISO(iso); return `${DIA_CORTO[d.getDay()]} ${d.getDate()} ${MES_CORTO[d.getMonth()]} ${d.getFullYear()}`; };
const diasEntre = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 86400000);
const mesLabel = (key, multi) => { const [y, m] = key.split("-").map(Number); const n = MESES[m - 1]; return n ? (multi ? `${MES_CORTO[m - 1]} ${y}` : n.charAt(0).toUpperCase() + n.slice(1)) : key; };
function lunesDe(iso) { const d = parseISO(iso); const day = d.getDay() || 7; d.setDate(d.getDate() - day + 1); return toISO(d); }

/* =========================== DATOS: DECODIFICACIÓN =========================== */
// El payload llega comprimido (data.z = gzip + base64) o en columnas planas (data.enc)
async function descomprimir(data) {
  if (data.enc) return data.enc;
  if (!data.z) return null;
  if (typeof DecompressionStream === "undefined") throw new Error("Este navegador no puede leer datos comprimidos. Actualizalo (Chrome, Edge, Firefox o Safari recientes).");
  const bin = atob(data.z);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return JSON.parse(await new Response(stream).text());
}
function decodificar(e) {
  if (!e || !e.n) return [];
  const D = e.dicts, C = e.cols, n = e.n;
  const dictF = Object.keys(D), numF = Object.keys(C).filter((f) => !(f in D));
  const filas = new Array(n);
  for (let i = 0; i < n; i++) {
    const r = {};
    for (const f of dictF) r[f] = D[f][C[f][i]] ?? "";
    for (const f of numF) r[f] = C[f][i] == null ? null : Number(C[f][i]);
    filas[i] = r;
  }
  return filas;
}

/* =========================== DIMENSIONES =========================== */
const dimDef = (k) => {
  const x = DS().dims.find((d) => d[0] === k);
  return x ? { ...DIMCAT[k], group: x[1], label: x[2] || DIMCAT[k].label } : DIMCAT[k] ? { ...DIMCAT[k], group: "" } : null;
};
const FILTER_KEYS = () => DS().dims.map((d) => d[0]);
const EXTRA_LABEL = { codigo: "Orden de trabajo", set: "Selección", flag: "Calidad de datos", mesKey: "Mes", item: "Ítem", _hora: "Hora de reporte", clave: "Equipo", _nombre: "Orden de trabajo", _bajoMeta: "Bajo meta", fecha: "Fecha", sem: "Semana", _w: "Trabajador", _ocBin: "Ocupación del servicio" };
const dimLabel = (k) => (dimDef(k) ? dimDef(k).label : EXTRA_LABEL[k] || k);
const term = (i = 1, cap = false) => { const s = DS().term[i]; return cap ? s.charAt(0).toUpperCase() + s.slice(1) : s; };

function rellenarDims(r, keys) {
  for (const k of keys) if (!r[k]) r[k] = (DIMCAT[k] && DIMCAT[k].empty) || "(Sin dato)";
}
function calcDims(filas) {
  const porTexto = (a, b) => (a.startsWith("(") ? 1 : b.startsWith("(") ? -1 : a.localeCompare(b, "es", { numeric: true, sensitivity: "base" }));
  const out = {};
  const keys = new Set([...FILTER_KEYS(), ...(ENG().dimsExtra || [])]);
  keys.forEach((k) => {
    if (ENG().dimValores && ENG().dimValores[k]) { out[k] = ENG().dimValores[k](filas); return; }
    if (!filas.length || !(k in filas[0])) { out[k] = []; return; }
    const vals = Array.from(new Set(filas.map((r) => r[k])));
    if (DIMCAT[k] && DIMCAT[k].sort === "mes") {
      const key = new Map(filas.map((r) => [r.mes, r._m || "9999"]));
      out[k] = vals.sort((a, b) => (key.get(a) < key.get(b) ? -1 : 1));
    } else if (DIMCAT[k] && DIMCAT[k].sortBy) {
      const sk = DIMCAT[k].sortBy, key = new Map(filas.map((r) => [r[k], r[sk] || "9999"]));
      out[k] = vals.sort((a, b) => (key.get(a) < key.get(b) ? -1 : key.get(a) > key.get(b) ? 1 : 0));
    } else out[k] = vals.sort(porTexto);
  });
  out.fechas = Array.from(new Set(filas.map((r) => r.fecha).filter(Boolean))).sort();
  return out;
}

/* =========================== AGREGACIÓN GENÉRICA =========================== */
function groupBy(rows, fn) {
  const m = new Map();
  for (const r of rows) { const k = fn(r); let a = m.get(k); if (!a) { a = []; m.set(k, a); } a.push(r); }
  return m;
}
function porDim(rows, dim, sortKey = "n") {
  const agg = ENG().agg;
  return Array.from(groupBy(rows, (r) => r[dim]).entries())
    .map(([label, v]) => ({ label, ...agg(v), _rows: v }))
    .sort((a, b) => b[sortKey] - a[sortKey]);
}
function porMes(rows) {
  const agg = ENG().agg;
  return Array.from(groupBy(rows.filter((r) => r._m), (r) => r._m).entries())
    .map(([key, v]) => ({ key, label: v[0].mes, short: MES_CORTO[+key.slice(5, 7) - 1] || key, ...agg(v), _rows: v }))
    .sort((a, b) => (a.key < b.key ? -1 : 1));
}
// Propiedades que se calculan solo si un gráfico las pide
function lazy(obj, defs) {
  Object.keys(defs).forEach((k) => {
    let val, done = false;
    Object.defineProperty(obj, k, { enumerable: true, get() { if (!done) { val = defs[k](); done = true; } return val; } });
  });
  return obj;
}

function filtrar(rows, f, except) {
  const usaFecha = except !== "fecha" && (f.desde || f.hasta);
  const vd = ENG().vistaDims || [], hook = ENG().rowOk;
  const dims = FILTER_KEYS().filter((k) => k !== except && f[k] && !vd.includes(k));
  if (!usaFecha && !dims.length && !hook) return rows;
  return rows.filter((r) => {
    if (hook && !hook(r, f, except)) return false;
    if (usaFecha && (!r.fecha || (f.desde && r.fecha < f.desde) || (f.hasta && r.fecha > f.hasta))) return false;
    for (const k of dims) if (r[k] !== f[k]) return false;
    return true;
  });
}
function matchCond(r, c) {
  if (c.dim === "codigo") return r._id === c.value;
  if (c.dim === "set") return c.value.includes(r._id);
  if (c.dim === "flag") return !!(r._f && r._f[c.value]);
  if (c.dim === "mesKey") return r._m === c.value;
  if (c.dim === "transf") return r._transf;
  return r[c.dim] === c.value;
}

/* Color por entidad (no por ranking): un filtro nunca repinta a los que quedan */
function colorOf(dim, value, t) {
  if (value === "Otros" || vacio(value)) return t.neutral;
  const list = (state.dims[dim] || []).filter((x) => !vacio(x));
  const i = list.indexOf(value);
  return i < 0 ? t.neutral : t.series[i % t.series.length];
}
function fold(list, max = 7, keys = []) {
  if (list.length <= max + 1) return list;
  const top = list.slice(0, max), rest = list.slice(max);
  const otros = { label: "Otros", _otros: rest.map((r) => r.label) };
  keys.forEach((k) => { otros[k] = rest.reduce((a, r) => a + (r[k] || 0), 0); });
  return [...top, otros];
}
const pctDe = (a, b) => (b ? (a / b) * 100 : null);


const fmtH = (v) => (v == null ? "—" : fmt(v, 1) + " h");
const pctOpt = (v) => (v == null ? "—" : fmt(v, 1) + " %");
function semanaISO(iso) { const d = parseISO(iso); d.setDate(d.getDate() + 4 - (d.getDay() || 7)); const y0 = new Date(d.getFullYear(), 0, 1); return Math.ceil(((d - y0) / 86400000 + 1) / 7); }

/* =========================== MOTOR · TRANSPORTE =========================== */
const pct0 = (a, b) => (b > 0 ? (a / b) * 100 : null);
let GR = { min: "", max: "" };                  // rango de fechas de todo el archivo
const capTxt = (s) => { s = String(s || "").toLowerCase(); return s ? s.charAt(0).toUpperCase() + s.slice(1) : ""; };
// Rangos de ocupación de un servicio (salida de bus)
const RANGOS_OC = [["0–25 %", 25], ["26–50 %", 50], ["51–75 %", 75], ["76–90 %", 90], ["91–100 %", 100], ["Sobrecupo (>100 %)", Infinity]];
const binOc = (p) => (p == null ? "(Sin capacidad)" : RANGOS_OC.find((x) => p <= x[1] + 1e-9)[0]);
const OC_COLORS = (t) => [t.series[4], t.series[3], t.series[1], t.series[0], t.series[2], t.series[4]];

const ENGINE_TR = {
  conFecha: true, unidad: "viajes", shareKey: "n", shareLabel: "los viajes en vista",
  dimsExtra: DIMS_TR,

  prep(filas) {
    const años = new Set(filas.map((r) => (r.fecha || "").slice(0, 4)).filter(Boolean));
    const multi = años.size > 1;
    const fs = filas.map((r) => r.fecha).filter(Boolean).sort();
    GR = { min: fs[0] || "", max: fs[fs.length - 1] || "" };
    const svc = new Map(), vistos = new Map();
    filas.forEach((r, i) => {
      r._i = i; r._id = String(i);
      r.doc = r.doc ? String(r.doc).trim() : "";
      r.trabajador = r.trabajador || "";
      r._m = r.fecha ? r.fecha.slice(0, 7) : "";
      r.mes = r._m ? mesLabel(r._m, multi) : capTxt(r.mes2);
      if (!r._m && r.mes) r._m = "9999-" + r.mes;   // sin fecha pero con MES2: se ordena al final
      r.anio = r.fecha ? r.fecha.slice(0, 4) : "";
      const sn = Number.isFinite(r.semana) && r.semana > 0 ? Math.round(r.semana) : r.fecha ? semanaISO(r.fecha) : null;
      const y = r.anio || "0000", nn = sn != null ? String(sn).padStart(2, "0") : "";
      r._sk = sn != null ? `${y}-${nn}` : "";
      r.sem = sn != null ? (multi ? `${y} · Sem ${nn}` : `Sem ${nn}`) : "";
      r._w = r.doc || (r.trabajador ? "N:" + r.trabajador : "");
      r._cap = Number(r.cap) > 0 ? Number(r.cap) : 0;
      r._sv = CONFIG.SERVICIO.map((k) => r[k] ?? "").join("|");
      let s = svc.get(r._sv);
      if (!s) { s = { n: 0, cap: 0 }; svc.set(r._sv, s); }
      s.n++; if (r._cap > s.cap) s.cap = r._cap;
      const quien = r.doc || r.trabajador;
      const dk = `${r.fecha}|${quien}|${r.lote || ""}`;
      const visto = quien ? vistos.has(dk) : false;
      if (quien && !visto) vistos.set(dk, 1);
      r._f = { sinT: !r.trabajador, sinD: !r.doc, sinL: !r.lote, dup: visto };
      r._f.any = r._f.sinT || r._f.sinD || r._f.sinL || r._f.dup;
    });
    filas.forEach((r) => {
      const s = svc.get(r._sv);
      r._sp = s.n; r._sc = s.cap;
      r._spct = s.cap ? (s.n / s.cap) * 100 : null;
      r._ocBin = binOc(r._spct);
    });
    filas.forEach((r) => rellenarDims(r, DIMS_TR));
    return filas;
  },

  // Indicadores de un grupo de filas
  agg(rows) {
    const W = new Set(), D = new Set(), P = new Map(), F = new Set(), L = new Set(), FU = new Set(), O = new Set(), A = new Set(), S = new Map();
    let sinT = 0, sinD = 0, sinL = 0, dup = 0, fMin = "", fMax = "";
    for (const r of rows) {
      if (r._w) W.add(r._w);
      if (r.doc) D.add(r.doc);
      if (!vacio(r.placa) && !P.has(r.placa)) P.set(r.placa, r._cap);
      if (r.fecha) { F.add(r.fecha); if (!fMin || r.fecha < fMin) fMin = r.fecha; if (!fMax || r.fecha > fMax) fMax = r.fecha; }
      if (!vacio(r.lote)) L.add(r.lote);
      if (!vacio(r.fundo)) FU.add(r.fundo);
      if (!vacio(r.origen)) O.add(r.origen);
      if (!vacio(r.actividad)) A.add(r.actividad);
      if (!S.has(r._sv)) S.set(r._sv, r);
      const f = r._f;
      if (f.sinT) sinT++; if (f.sinD) sinD++; if (f.sinL) sinL++; if (f.dup) dup++;
    }
    let pax = 0, capS = 0, full = 0, nCap = 0;
    S.forEach((r) => { if (r._sc > 0) { pax += r._sp; capS += r._sc; nCap++; if (r._sp >= r._sc) full++; } });
    const caps = [...P.values()].filter((c) => c > 0);
    const n = rows.length, ns = S.size, nb = P.size, dias = F.size;
    return {
      n, nt: W.size, nd: D.size, nb, ns, dias, nl: L.size, nf: FU.size, no: O.size, na: A.size,
      pax, capS, ocup: capS ? (pax / capS) * 100 : null, full, pFull: nCap ? (full / nCap) * 100 : null,
      capProm: caps.length ? caps.reduce((a, b) => a + b, 0) / caps.length : null,
      vDia: dias ? n / dias : null, vBus: nb ? n / nb : null, tServ: ns ? n / ns : null,
      sinT, sinD, sinL, dup, pT: pct0(n - sinT, n), pD: pct0(n - sinD, n), pL: pct0(n - sinL, n), pDup: pct0(dup, n),
      fMin, fMax,
    };
  },

  calc(v, filas) {
    const sinTiempo = filtrar(filas, { ...state.filtros, mes: "", sem: "", desde: "", hasta: "" });
    return lazy({ k: this.agg(v), base: v }, {
      dias: () => porDia(v),
      semanas: () => porSem(v),
      meses: () => porMes(v),
      tendencia: () => porSem(sinTiempo),
      placas: () => porDim(v, "placa", "n"),
      origenes: () => porDim(v, "origen", "n"),
      fundos: () => porDim(v, "fundo", "n"),
      lotes: () => porDim(v, "lote", "n"),
      actividades: () => porDim(v, "actividad", "n"),
      tbus: () => porDim(v, "tbus", "n"),
      trabajadores: () => porDim(v.filter((r) => r._w), "_w", "dias"),
      rutas: () => cruce(v, ["origen", "fundo"]),
      sedeFundo: () => cruce(v, ["sede", "fundo"]),
      loteAct: () => cruce(v, ["fundo", "lote", "actividad"]),
      ocupBins: () => binsOc(v),
    });
  },

  drillMini(k) {
    return [["Viajes", fmt(k.n)], ["Trabajadores únicos", fmt(k.nt)], ["Servicios de bus", fmt(k.ns)], ["% ocupación", fP1(k.ocup)],
      ["Buses", fmt(k.nb)], ["Días con viajes", fmt(k.dias)], ["Lotes", fmt(k.nl)], ["Viajes por día", f1(k.vDia)]];
  },
  drillDims: [["placa", "Placa"], ["origen", "Origen"], ["fundo", "Fundo"], ["lote", "Lote"], ["actividad", "Actividad"], ["tbus", "Tipo de bus"], ["sede", "Sede"], ["sem", "Semana"], ["trabajador", "Trabajador"]],
  drillCols: (x) => [["Viajes", x.n, fmt, 1], ["Trabajadores", x.nt, fmt], ["% ocup.", x.ocup, pOpt]],
};

function porDia(rows) {
  const agg = ENGINE_TR.agg;
  return Array.from(groupBy(rows.filter((r) => r.fecha), (r) => r.fecha).entries())
    .map(([key, v]) => ({ key, label: fdia(key), ...agg(v), _rows: v }))
    .sort((a, b) => (a.key < b.key ? -1 : 1));
}
function porSem(rows) {
  const agg = ENGINE_TR.agg;
  const L = Array.from(groupBy(rows.filter((r) => r._sk), (r) => r._sk).entries()).map(([key, v]) => {
    let ini = "";
    for (const r of v) if (r.fecha && (!ini || r.fecha < ini)) ini = r.fecha;
    return { key, label: v[0].sem, short: "S" + key.slice(-2), ini: ini ? lunesDe(ini) : "", ...agg(v), _rows: v };
  }).sort((a, b) => (a.key < b.key ? -1 : 1));
  L.forEach((x, i) => { x.varV = i ? varPct(x.n, L[i - 1].n) : null; x.varT = i ? varPct(x.nt, L[i - 1].nt) : null; });
  return L;
}
function binsOc(rows) {
  const seen = new Map();
  rows.forEach((r) => { if (!seen.has(r._sv) && r._spct != null) seen.set(r._sv, r._ocBin); });
  const c = new Map(RANGOS_OC.map((x) => [x[0], 0]));
  seen.forEach((b) => c.set(b, (c.get(b) || 0) + 1));
  return RANGOS_OC.map(([label]) => ({ label, n: c.get(label) || 0 }));
}
// Agrupa por varias dimensiones y agrega (d0, d1, d2… = valor de cada dimensión)
function cruce(rows, dims) {
  const agg = ENGINE_TR.agg;
  return Array.from(groupBy(rows, (r) => dims.map((d) => r[d]).join("\u0001")).values()).map((v) => {
    const o = { ...agg(v), _rows: v };
    dims.forEach((d, i) => { o["d" + i] = v[0][d]; });
    o.label = dims.map((d) => v[0][d]).join(" · ");
    return o;
  }).sort((a, b) => b.n - a.n);
}
const varPct = (a, b) => (b ? ((a - b) / Math.abs(b)) * 100 : null);
const condDim = (dim) => (x) => [{ dim, value: x.label }];

const ENGINES = { tr: ENGINE_TR };

/* =========================== CHART.JS: PLUGINS =========================== */
const bgPlugin = {
  id: "coreBg",
  beforeDraw(chart) {
    const { ctx, width, height } = chart;
    ctx.save(); ctx.globalCompositeOperation = "destination-over";
    ctx.fillStyle = (state.tk && state.tk.surface) || "#fff";
    ctx.fillRect(0, 0, width, height); ctx.restore();
  },
};
const crossPlugin = {
  id: "coreCross",
  afterDatasetsDraw(chart, _a, opts) {
    if (!opts || !opts.enabled) return;
    const act = chart.tooltip && chart.tooltip.getActiveElements ? chart.tooltip.getActiveElements() : [];
    if (!act.length) return;
    const x = act[0].element.x, a = chart.chartArea, ctx = chart.ctx;
    ctx.save(); ctx.strokeStyle = state.tk.lineStrong; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(x, a.top); ctx.lineTo(x, a.bottom); ctx.stroke(); ctx.restore();
  },
};
const refPlugin = {
  id: "coreRef",
  afterDatasetsDraw(chart, _a, opts) {
    if (!opts || !Array.isArray(opts.lines)) return;
    const { ctx, chartArea: a } = chart;
    opts.lines.forEach((l) => {
      const sc = chart.scales[l.axis || "y"];
      if (!sc || l.value == null || !isFinite(l.value)) return;
      const p = sc.getPixelForValue(l.value);
      const vertical = sc.axis === "x";
      if (vertical ? (p < a.left - 1 || p > a.right + 1) : (p < a.top - 1 || p > a.bottom + 1)) return;
      ctx.save();
      ctx.strokeStyle = l.color || state.tk.ink3; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]);
      ctx.beginPath();
      if (vertical) { ctx.moveTo(p, a.top); ctx.lineTo(p, a.bottom); } else { ctx.moveTo(a.left, p); ctx.lineTo(a.right, p); }
      ctx.stroke(); ctx.setLineDash([]);
      if (l.label) {
        ctx.font = "600 11px 'Instrument Sans', system-ui, sans-serif";
        const w = ctx.measureText(l.label).width + 12;
        const x = vertical ? Math.min(p + 4, a.right - w) : a.right - w;
        const y = vertical ? a.top : p - 20;
        ctx.fillStyle = state.tk.surface; ctx.globalAlpha = 0.92;
        ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, 18, 5) : ctx.rect(x, y, w, 18); ctx.fill();
        ctx.globalAlpha = 1; ctx.fillStyle = state.tk.ink2; ctx.textBaseline = "middle";
        ctx.fillText(l.label, x + 6, y + 9);
      }
      ctx.restore();
    });
  },
};
const centerPlugin = {
  id: "coreCenter",
  afterDraw(chart, _a, opts) {
    if (!opts || !opts.title) return;
    const meta = chart.getDatasetMeta(0);
    if (!meta || !meta.data || !meta.data[0]) return;
    const { x, y } = meta.data[0];
    const ctx = chart.ctx;
    ctx.save(); ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = state.tk.ink; ctx.font = "700 19px 'Bricolage Grotesque', system-ui, sans-serif";
    ctx.fillText(opts.title, x, y - 8);
    ctx.fillStyle = state.tk.ink3; ctx.font = "500 11px 'Instrument Sans', system-ui, sans-serif";
    ctx.fillText(opts.sub || "", x, y + 13);
    ctx.restore();
  },
};

/* =========================== CHART.JS: FÁBRICAS =========================== */
function setupChartDefaults() {
  Chart.register(ChartDataLabels, bgPlugin, crossPlugin, refPlugin, centerPlugin);
  Chart.defaults.font.family = "'Instrument Sans', system-ui, sans-serif";
  Chart.defaults.font.size = 11.5;
  Chart.defaults.plugins.datalabels.display = false;
  Chart.defaults.plugins.legend.display = false;
  if (REDUCED) Chart.defaults.animation = false;
}

function tooltipCfg(t) {
  return {
    backgroundColor: t.surface, titleColor: t.ink, bodyColor: t.ink2, footerColor: t.ink,
    borderColor: t.lineStrong, borderWidth: 1, padding: 12, cornerRadius: 10, caretSize: 6,
    titleFont: { weight: "700", size: 12.5 }, bodyFont: { size: 12 }, footerFont: { weight: "600", size: 12 },
    boxWidth: 9, boxHeight: 9, boxPadding: 5, usePointStyle: true, displayColors: true,
  };
}
function legendCfg(t, show) {
  return {
    display: !!show, position: "bottom", align: "start",
    labels: { color: t.ink2, usePointStyle: true, pointStyle: "circle", boxWidth: 8, boxHeight: 8, padding: 16, font: { size: 12 } },
  };
}
function baseOptions(t, o = {}) {
  const fmtAxis = o.axisFmt || ((v) => fmt(v));
  const valueAxis = {
    beginAtZero: o.min == null, min: o.min, max: o.max, suggestedMax: o.suggestedMax, suggestedMin: o.suggestedMin, stacked: !!o.stacked,
    grid: { color: t.grid, drawTicks: false }, border: { display: false },
    ticks: { color: t.ink3, padding: 8, maxTicksLimit: 6, callback: (v) => fmtAxis(v) },
    title: o.valueTitle ? { display: true, text: o.valueTitle, color: t.ink3, font: { size: 11 } } : undefined,
  };
  const catAxis = {
    stacked: !!o.stacked, grid: { display: false }, border: { color: t.line },
    ticks: {
      color: t.ink2, padding: 6, autoSkip: !o.horizontal, maxRotation: 0, autoSkipPadding: 12, font: { size: 11.5 },
      callback: o.horizontal ? function (v) { const l = this && this.getLabelForValue ? this.getLabelForValue(v) : v; return trunc(l, o.maxLabel || 30); } : undefined,
    },
  };
  return {
    responsive: true, maintainAspectRatio: false,
    animation: REDUCED ? false : { duration: 650, easing: "easeOutQuart" },
    interaction: { mode: o.mode || "index", intersect: false, axis: o.horizontal ? "y" : "x" },
    indexAxis: o.horizontal ? "y" : "x",
    layout: { padding: { top: o.padTop ?? 10, right: o.padRight ?? 8, left: 0, bottom: 0 } },
    scales: o.horizontal ? { x: valueAxis, y: catAxis } : { x: catAxis, y: valueAxis },
    plugins: { legend: legendCfg(t, o.legend), tooltip: tooltipCfg(t), datalabels: { display: false } },
  };
}

// Atenúa lo que no está bajo el cursor (enfoque visual)
const focusColor = (c, by = "index") => (ctx) => {
  const base = Array.isArray(c) ? c[ctx.dataIndex % c.length] : c;
  const f = ctx.chart.$focus;
  if (!f) return base;
  const hit = by === "dataset" ? ctx.datasetIndex === f.ds : by === "cell" ? (ctx.datasetIndex === f.ds && ctx.dataIndex === f.i) : ctx.dataIndex === f.i;
  return hit ? base : rgba(base, 0.28);
};
function barDs(t, label, data, color, o = {}) {
  return {
    label, data,
    backgroundColor: focusColor(color, o.by || "index"),
    hoverBackgroundColor: Array.isArray(color) ? color : color,
    borderRadius: o.stacked ? 3 : 5,
    borderSkipped: o.stacked ? false : "start",
    borderWidth: o.stacked ? 1 : 0,
    borderColor: t.surface,
    maxBarThickness: o.thick || 40,
    barPercentage: 0.78, categoryPercentage: 0.82,
    order: o.order || 1,
  };
}
function lineDs(t, label, data, color, o = {}) {
  return {
    label, data,
    borderColor: color, borderWidth: 2, tension: 0.35,
    borderDash: o.dashed ? [6, 5] : [],
    fill: o.fill ? "origin" : false,
    backgroundColor: o.fill
      ? (ctx) => {
          const { chart } = ctx; const a = chart.chartArea;
          if (!a) return rgba(color, 0.1);
          const g = chart.ctx.createLinearGradient(0, a.top, 0, a.bottom);
          g.addColorStop(0, rgba(color, 0.24)); g.addColorStop(1, rgba(color, 0));
          return g;
        }
      : color,
    pointStyle: o.dashed ? "line" : "circle",
    pointRadius: o.dashed ? 0 : 4, pointHoverRadius: o.dashed ? 0 : 7, pointHitRadius: 16,
    pointBackgroundColor: t.surface, pointBorderColor: color, pointBorderWidth: 2,
    pointHoverBackgroundColor: color, pointHoverBorderColor: t.surface, pointHoverBorderWidth: 3,
    spanGaps: true,
  };
}
const endLabels = (t, formatter) => ({
  display: (ctx) => ctx.dataset.data[ctx.dataIndex] != null,
  anchor: "end", align: "end", offset: 4, clamp: true,
  color: t.ink2, font: { weight: "600", size: 11 }, formatter,
});

/* =========================== INFO (botón "i") =========================== */
const INFO = {};
const txt = (x) => (typeof x === "function" ? x(DS()) : x);

/* =========================== CONSTRUCTORES DE GRÁFICOS =========================== */
// Ranking horizontal (un valor por categoría)
function ranking(d, t, o) {
  const all = o.list;
  const L = all.slice(0, o.top || CONFIG.TOP_N);
  const color = o.color || t.series[0];
  const colors = o.colorFn ? L.map((x) => o.colorFn(x)) : color;
  const lbl = (x) => (o.labelFn ? o.labelFn(x) : x.label);
  const cond = (x) => (x._otros ? null : o.condFn ? o.condFn(x) : [{ dim: o.dim, value: x.label, label: o.labelFn ? lbl(x) : undefined }]);
  return {
    empty: !L.length || (o.emptyIf && o.emptyIf(L)),
    emptyMsg: o.emptyMsg,
    sub: all.length > L.length ? `Top ${L.length} de ${fmt(all.length)}` : "",
    config: {
      type: "bar",
      data: { labels: L.map(lbl), datasets: [barDs(t, o.name, L.map((x) => x[o.key]), colors, { thick: 22 })] },
      options: merge(baseOptions(t, { horizontal: true, axisFmt: o.axisFmt || ((v) => fmtC(v)), padRight: 74, padTop: o.ref ? 22 : 10, mode: "nearest", maxLabel: o.maxLabel || 30, min: o.min, max: o.max }), {
        layout: o.padLeft ? { padding: { left: o.padLeft } } : {},
        plugins: {
          coreRef: o.ref ? { lines: [{ axis: "x", value: o.ref.value, label: o.ref.label }] } : undefined,
          datalabels: endLabels(t, o.endFmt || ((v) => fmtC(v))),
          tooltip: { callbacks: {
            title: (items) => (o.titleFn ? o.titleFn(L[items[0].dataIndex]) : L[items[0].dataIndex].label),
            label: (c) => ` ${o.name}: ${o.fmtV(c.parsed ? c.parsed.x : null)}`,
            afterLabel: (c) => (o.extra ? o.extra(L[c.dataIndex]) : []),
          } },
        },
      }),
    },
    table: {
      head: [{ t: o.colName || dimLabel(o.dim) }, ...o.cols.map((c) => ({ t: c[0], num: 1 }))],
      rows: all.map((x) => [o.labelFn ? cell(x.label, () => (o.titleFn ? o.titleFn(x) : lbl(x))) : x.label, ...o.cols.map((c) => cell(x[c[1]], c[2]))]),
      conds: all.map(cond),
      searchable: all.length > 20, pageSize: 25,
    },
    drill: (e) => { const x = L[e.index]; return x && cond(x); },
  };
}

// Barras agrupadas (dos o más series por categoría)
function grouped(d, t, o) {
  const all = o.list;
  const L = all.slice(0, o.top || 12);
  const lbl = (x) => (o.labelFn ? o.labelFn(x) : x.label);
  const cond = (x) => (x._otros ? null : o.condFn ? o.condFn(x) : [{ dim: o.dim, value: x.label }]);
  const h = !!o.horizontal;
  return {
    empty: !L.length,
    emptyMsg: o.emptyMsg,
    sub: all.length > L.length ? `Top ${L.length} de ${fmt(all.length)}` : "",
    config: {
      type: "bar",
      data: { labels: L.map(lbl), datasets: o.series.map((s) => barDs(t, s.name, L.map((x) => x[s.key]), s.color, { thick: h ? 13 : 30, stacked: o.stacked })) },
      options: merge(baseOptions(t, { horizontal: h, legend: true, stacked: o.stacked, axisFmt: o.axisFmt || fmtSC, mode: "index", maxLabel: o.maxLabel || 28, min: o.min, max: o.max, suggestedMax: o.suggestedMax, padTop: o.refs ? 24 : 10 }), {
        plugins: { coreRef: o.refs ? { lines: o.refs } : undefined, tooltip: { callbacks: {
          title: (items) => (o.titleFn ? o.titleFn(L[items[0].dataIndex]) : L[items[0].dataIndex].label),
          label: (c) => ` ${c.dataset.label}: ${o.fmtV(c.parsed ? (h ? c.parsed.x : c.parsed.y) : null)}`,
          footer: (items) => (o.extra ? o.extra(L[items[0].dataIndex]) : []),
        } } },
      }),
    },
    table: {
      head: [{ t: o.colName || dimLabel(o.dim) }, ...o.cols.map((c) => ({ t: c[0], num: 1 }))],
      rows: all.map((x) => [o.labelFn ? cell(x.label, () => lbl(x)) : x.label, ...o.cols.map((c) => cell(x[c[1]], c[2]))]),
      conds: all.map(cond), searchable: all.length > 20, pageSize: 25,
    },
    drill: (e) => { const x = L[e.index]; return x && cond(x); },
  };
}

// Anillo con leyenda directa (valor y %)
function donut(d, t, o) {
  const L = o.list.filter((x) => x[o.key] > 0);
  const total = L.reduce((a, x) => a + x[o.key], 0) || 1;
  const colors = L.map((x, i) => (o.colorFn ? o.colorFn(x, i) : colorOf(o.dim, x.label, t)));
  const cond = (x) => (x._otros ? null : o.condFn ? o.condFn(x) : [{ dim: o.dim, value: x.label }]);
  return {
    empty: !L.length, emptyMsg: o.emptyMsg,
    config: {
      type: "doughnut",
      data: { labels: L.map((x) => x.label), datasets: [{ data: L.map((x) => x[o.key]), backgroundColor: focusColor(colors), hoverBackgroundColor: colors, borderColor: t.surface, borderWidth: 3, hoverOffset: 10, borderRadius: 4 }] },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: "70%",
        animation: REDUCED ? false : { animateRotate: true, duration: 750, easing: "easeOutQuart" },
        layout: { padding: 10 },
        plugins: {
          legend: { display: false },
          tooltip: merge(tooltipCfg(t), { callbacks: { label: (c) => ` ${c.label}: ${o.fmtV(c.parsed)} (${fmtPct((c.parsed / total) * 100)})`, afterLabel: (c) => (o.extra ? o.extra(L[c.dataIndex]) : []) } }),
          coreCenter: o.center ? o.center(total) : undefined,
          datalabels: { display: false },
        },
      },
    },
    legend: L.map((x, i) => ({ label: x.label, full: x.label, color: colors[i], value: o.legendFmt ? o.legendFmt(x[o.key]) : o.fmtV(x[o.key]), pct: (x[o.key] / total) * 100, index: i })),
    table: {
      head: [{ t: o.colName || dimLabel(o.dim) }, { t: o.name, num: 1 }, { t: "%", num: 1 }, ...(o.cols || []).map((c) => ({ t: c[0], num: 1 }))],
      rows: L.map((x) => [x.label, cell(x[o.key], o.fmtV), cell((x[o.key] / total) * 100, fmtPct), ...(o.cols || []).map((c) => cell(x[c[1]], c[2]))]),
      conds: L.map(cond),
    },
    drill: (e) => { const x = L[e.index]; return x && cond(x); },
  };
}


// Histograma por rangos
function histo(t, o) {
  const total = o.bins.reduce((a, b) => a + b.n, 0) || 1;
  return {
    empty: !o.bins.some((b) => b.n), emptyMsg: o.emptyMsg,
    config: {
      type: "bar",
      data: { labels: o.bins.map((b) => b.label), datasets: [barDs(t, o.name, o.bins.map((b) => b.n), o.bins.map((b) => b.color || o.color || t.series[0]), { thick: 56 })] },
      options: merge(baseOptions(t, { axisFmt: (v) => fmt(v), padTop: 22, mode: "nearest" }), {
        plugins: { datalabels: endLabels(t, (v) => fmt(v)), tooltip: { callbacks: { label: (c) => ` ${fmt(c.parsed.y)} ${o.unit} (${fmtPct((c.parsed.y / total) * 100)})` } } },
      }),
    },
    table: {
      head: [{ t: o.colName || "Rango" }, { t: o.name, num: 1 }, { t: "%", num: 1 }],
      rows: o.bins.map((b) => [b.label, cell(b.n, fmt), cell((b.n / total) * 100, fmtPct)]),
      conds: o.bins.map((b) => (b.n ? [{ dim: o.dim, value: b.label, label: `${o.colName || "Rango"}: ${b.label}` }] : null)),
    },
    drill: (e) => { const b = o.bins[e.index]; return b && b.n && [{ dim: o.dim, value: b.label, label: `${o.colName || "Rango"}: ${b.label}` }]; },
  };
}


/* =========================== CONSTRUCTOR: COLUMNAS CON META =========================== */
// Una barra vertical por categoría (equipo) con línea de meta / óptimo
function columnas(d, t, o) {
  const L = o.list.filter((x) => o.val(x) != null);
  const lbl = (x) => (o.labelFn ? o.labelFn(x) : x.label);
  const cond = (x) => (o.condFn ? o.condFn(x) : [{ dim: o.dim, value: x.label }]);
  const colors = L.map((x) => (o.colorFn ? o.colorFn(x) : o.color || t.series[0]));
  return {
    empty: !L.length, emptyMsg: o.emptyMsg,
    sub: o.subFn ? o.subFn(L) : "",
    config: {
      type: "bar",
      data: { labels: L.map(lbl), datasets: [barDs(t, o.name, L.map(o.val), colors, { thick: 44 })] },
      options: merge(baseOptions(t, { axisFmt: o.axisFmt || ((v) => fmt(v)), padTop: 26, mode: "nearest", min: o.min, max: o.max, suggestedMax: o.suggestedMax }), {
        plugins: {
          coreRef: o.refs ? { lines: o.refs } : undefined,
          datalabels: endLabels(t, o.endFmt || ((v) => fmt(v, 1))),
          tooltip: { callbacks: { title: (it) => (o.titleFn ? o.titleFn(L[it[0].dataIndex]) : lbl(L[it[0].dataIndex])), label: (c) => ` ${o.name}: ${o.fmtV(c.parsed ? c.parsed.y : null)}`, afterLabel: (c) => (o.extra ? o.extra(L[c.dataIndex]) : []) } },
        },
      }),
    },
    table: {
      head: [{ t: o.colName || dimLabel(o.dim) }, ...o.cols.map((c) => ({ t: c[0], num: 1 }))],
      rows: o.list.map((x) => [lbl(x), ...o.cols.map((c) => cell(typeof c[1] === "function" ? c[1](x) : x[c[1]], c[2]))]),
      conds: o.list.map(cond),
    },
    drill: (e) => { const x = L[e.index]; return x && cond(x); },
  };
}

/* =========================== CONSTRUCTORES PROPIOS =========================== */
// Líneas sobre una lista de períodos (meses, semanas…)
function lineas(d, t, o) {
  const L = o.list;
  const lbl = (x) => (o.labelFn ? o.labelFn(x) : x.label);
  const tl = o.tableLabelFn || lbl;
  const cond = (x) => (o.condFn ? o.condFn(x) : null);
  const datasets = o.series.map((s) => lineDs(t, s.name, L.map((x) => x[s.key]), s.color, { fill: s.fill, dashed: s.dashed }));
  if (L.length > 45) datasets.forEach((ds) => { ds.pointRadius = 0; ds.pointHoverRadius = 5; });
  return {
    empty: !L.length, emptyMsg: o.emptyMsg, sub: o.subFn ? o.subFn(L) : "",
    config: {
      type: "line",
      data: { labels: L.map(lbl), datasets },
      options: merge(baseOptions(t, { axisFmt: o.axisFmt || ((v) => fmt(v)), padTop: 24, legend: o.series.length > 1, mode: "index", min: o.min, max: o.max, suggestedMax: o.suggestedMax }), {
        plugins: {
          coreCross: { enabled: true },
          coreRef: o.refs ? { lines: o.refs } : undefined,
          tooltip: { callbacks: {
            title: (it) => (o.titleFn ? o.titleFn(L[it[0].dataIndex]) : lbl(L[it[0].dataIndex])),
            label: (c) => ` ${c.dataset.label}: ${o.fmtV(c.parsed ? c.parsed.y : null)}`,
            footer: (items) => (o.extra && items.length ? o.extra(L[items[0].dataIndex]) : []),
          } },
        },
      }),
    },
    table: {
      head: [{ t: o.colName }, ...o.cols.map((c) => ({ t: c[0], num: 1 }))],
      rows: L.map((x) => [tl(x), ...o.cols.map((c) => cell(x[c[1]], c[2]))]),
      conds: L.map(cond), searchable: L.length > 20, pageSize: 25,
    },
    drill: (e) => { const x = L[e.index]; return x && cond(x); },
  };
}
// Pareto: barras (frecuencia) + línea de % acumulado en el eje derecho
function pareto(d, t, o) {
  const all = o.list.filter((x) => x[o.key] > 0);
  const tot = all.reduce((a, x) => a + x[o.key], 0) || 1;
  let acc = 0;
  all.forEach((x) => { acc += x[o.key]; x._acum = (acc / tot) * 100; x._pct = (x[o.key] / tot) * 100; });
  const L = all.slice(0, o.top || 15);
  const cond = (x) => [{ dim: o.dim, value: x.label }];
  const n80 = all.findIndex((x) => x._acum >= 80) + 1;
  const line = lineDs(t, "% acumulado", L.map((x) => x._acum), t.series[1]);
  line.yAxisID = "y1"; line.order = 0; line.tension = 0.2; line.type = "line";
  const bars = barDs(t, o.name, L.map((x) => x[o.key]), o.color || t.series[4], { thick: 34 });
  bars.yAxisID = "y";
  const base = baseOptions(t, { axisFmt: (v) => fmt(v), padTop: 28, mode: "index", maxLabel: 18 });
  return {
    empty: !L.length, emptyMsg: o.emptyMsg,
    sub: all.length ? `${fmt(n80)} de ${fmt(all.length)} ${o.plural} acumulan el 80 % · Top ${L.length}` : "",
    config: {
      type: "bar",
      data: { labels: L.map((x) => trunc(x.label, 22)), datasets: [bars, line] },
      options: merge(base, {
        scales: { y1: { position: "right", min: 0, max: 100, grid: { display: false }, border: { display: false }, ticks: { color: t.ink3, callback: (v) => v + " %", maxTicksLimit: 6 } } },
        plugins: {
          coreRef: { lines: [{ axis: "y1", value: 80, label: "80 %" }] },
          tooltip: { callbacks: {
            title: (it) => L[it[0].dataIndex].label,
            label: (c) => (c.datasetIndex === 1 ? ` % acumulado: ${fmt(c.parsed.y, 1)} %` : ` ${o.name}: ${fmt(c.parsed.y)} (${fmt(L[c.dataIndex]._pct, 1)} %)`),
            footer: (items) => (o.extra && items.length ? o.extra(L[items[0].dataIndex]) : []),
          } },
        },
      }),
    },
    table: {
      head: [{ t: o.colName }, { t: o.name, num: 1 }, { t: "% del total", num: 1 }, { t: "% acumulado", num: 1 }, ...(o.cols || []).map((c) => ({ t: c[0], num: 1 }))],
      rows: all.map((x) => [x.label, cell(x[o.key], fmt), cell(x._pct, pOpt), cell(x._acum, pOpt), ...(o.cols || []).map((c) => cell(x[c[1]], c[2]))]),
      conds: all.map(cond), searchable: all.length > 20, pageSize: 25,
    },
    drill: (e) => { const x = L[e.index]; return x && cond(x); },
  };
}

/* ---------- Ayudas ---------- */
const fP1 = (v) => (v == null ? "—" : fmt(v, 1) + " %");
const f1 = (v) => (v == null ? "—" : fmt(v, 1));
const fVar = (v) => (v == null ? "—" : (v >= 0 ? "+" : "−") + fmt(Math.abs(v), 1) + " %");
const fV = (v) => (v == null ? "—" : fmt(v) + (v === 1 ? " viaje" : " viajes"));
const fT = (v) => (v == null ? "—" : fmt(v) + (v === 1 ? " trabajador" : " trabajadores"));
const cV = (t) => t.series[0], cT = (t) => t.series[2], cOc = (t) => t.series[1];
// Mínimo del eje para porcentajes (cerca de los datos, sin exagerar)
const minPct = (vals, meta) => { const v = vals.filter((x) => x != null); if (!v.length) return 0; const m = Math.min(...v, meta ?? 100); return Math.max(0, Math.floor((m - 4) / 5) * 5); };
const condFecha = (x) => [{ dim: "fecha", value: x.key, label: fmtDiaLargo(x.key) }];
const condSem = (x) => [{ dim: "sem", value: x.label }];
const condMes = (x) => [{ dim: "mes", value: x.label }];
const condRuta = (x) => [{ dim: "origen", value: x.d0 }, { dim: "fundo", value: x.d1 }];
const nombreW = (x) => { const r = x._rows[0]; return vacio(r.trabajador) ? `DNI ${r.doc}` : r.trabajador; };
const condW = (x) => { const r = x._rows[0]; return vacio(r.trabajador) ? [{ dim: "_w", value: x.label, label: `DNI ${r.doc}` }] : [{ dim: "trabajador", value: r.trabajador }]; };
const metaRef = (axis = "y") => ({ axis, value: CONFIG.META_OCUP, label: `Meta ${CONFIG.META_OCUP} %` });
const extraV = (x) => [`${fT(x.nt)} · ${fmt(x.nb)} buses`, `Ocupación ${fP1(x.ocup)} · ${fmt(x.ns)} servicios`];
const colsV = [["Viajes", "n", fmt], ["Trabajadores", "nt", fmt], ["Buses", "nb", fmt], ["Servicios", "ns", fmt], ["% ocupación", "ocup", pOpt]];
const joinDistintos = (x, k, max = 3) => { const a = Array.from(new Set(x._rows.map((r) => r[k]).filter((v) => !vacio(v)))); return a.slice(0, max).join(", ") + (a.length > max ? ` +${a.length - max}` : ""); };

/* =========================== BIBLIOTECA DE GRÁFICOS =========================== */
const INFO_VIAJE = "Un viaje es una fila del Excel: un trabajador transportado en una fecha.";
const INFO_SERV = `Un servicio es una salida de un bus (misma ${CONFIG.SERVICIO.map((k) => (DIMCAT[k] ? DIMCAT[k].label.toLowerCase() : k)).join(" + ")}; se edita en CONFIG.SERVICIO).`;
const INFO_OCUP = "Ocupación de un servicio = trabajadores que subieron a ese bus ese día ÷ su CAPACIDAD. Se cuenta con todos los trabajadores del servicio, aunque filtres por actividad o lote. La ocupación promedio pondera por asientos: Σ trabajadores a bordo ÷ Σ capacidad de los servicios en vista.";
const CHARTLIB = {
  trDia: {
    size: "lg", focus: false,
    title: "Evolución diaria de viajes", sub: "Viajes y trabajadores únicos por día · la línea punteada es el promedio diario",
    info: { what: "Cuántos viajes y cuántos trabajadores distintos se movieron cada día.", how: "Viajes = filas por FECHA. Trabajadores únicos = DNI distintos (NRO. DOC. PASA.) por FECHA. Promedio = viajes ÷ días con viajes. " + INFO_VIAJE, tip: "Clic en un punto para ver el detalle de ese día." },
    build: (d, t) => lineas(d, t, { list: d.dias, colName: "Fecha", labelFn: (x) => fmtDia(x.key), tableLabelFn: (x) => fdia(x.key), titleFn: (x) => fmtDiaLargo(x.key), fmtV: (v) => fmt(v), axisFmt: (v) => fmtC(v),
      series: [{ name: "Viajes", key: "n", color: cV(t), fill: true }, { name: "Trabajadores únicos", key: "nt", color: cT(t) }],
      refs: d.k.vDia ? [{ axis: "y", value: d.k.vDia, label: `Prom. ${fmt(d.k.vDia, 0)} / día` }] : null, condFn: condFecha,
      extra: (x) => [`${fmt(x.nb)} buses · ${fmt(x.ns)} servicios · ocupación ${fP1(x.ocup)}`],
      cols: [["Viajes", "n", fmt], ["Trabajadores", "nt", fmt], ["Buses", "nb", fmt], ["Servicios", "ns", fmt], ["% ocupación", "ocup", pOpt]], emptyMsg: "No hay viajes con fecha en vista." }),
  },
  trActividad: {
    size: "donut", focus: true,
    title: "Viajes por actividad", sub: "% de los viajes en vista",
    info: { what: "Para qué labor se transportó a los trabajadores.", how: "Viajes por ACTIVIDAD ÷ total de viajes. A partir de la 8.ª actividad se agrupan en «Otros».", tip: "Clic en una actividad para ver su detalle." },
    build: (d, t) => donut(d, t, { list: fold(d.actividades, 7, ["n", "nt"]), key: "n", name: "Viajes", dim: "actividad", fmtV: fV, legendFmt: (v) => fmt(v), condFn: condDim("actividad"),
      extra: (x) => (x._otros ? [`${fmt(x._otros.length)} actividades`] : [fT(x.nt)]), center: () => ({ title: fmtC(d.k.n), sub: "viajes" }), cols: [["Trabajadores", "nt", fmt]] }),
  },
  trRutas: {
    size: "md", focus: true,
    title: "Top 10 rutas (origen → fundo)", sub: "Por cantidad de viajes",
    info: { what: "Los recorridos con más trabajadores transportados.", how: "Ruta = ORIGEN + FUNDO. Viajes = filas de esa combinación.", tip: "Clic en una ruta para ver qué buses y lotes la atienden." },
    build: (d, t) => ranking(d, t, { list: d.rutas, dim: "origen", key: "n", name: "Viajes", fmtV: fV, endFmt: (v) => fmtC(v), color: t.series[6], colName: "Ruta",
      labelFn: (x) => `${x.d0} → ${x.d1}`, titleFn: (x) => `${x.d0} → ${x.d1}`, condFn: condRuta, top: 10, maxLabel: 34, extra: extraV, cols: colsV }),
  },
  trSemana: {
    size: "md", focus: true,
    title: "Viajes por semana", sub: "Verde = subió frente a la semana anterior · rojo = bajó",
    info: { what: "El volumen de viajes de cada semana y cómo cambia respecto a la anterior.", how: "Viajes = filas por SEMANA (columna SEMANA del Excel; si falta, semana ISO de la fecha). Variación = (semana − semana anterior) ÷ semana anterior.", tip: "Clic en una barra para filtrar por esa semana." },
    build: (d, t) => columnas(d, t, { list: d.semanas, dim: "sem", name: "Viajes", val: (x) => x.n, fmtV: fV, axisFmt: (v) => fmtC(v), endFmt: (v) => fmtC(v), labelFn: (x) => x.short, titleFn: (x) => `${x.label}${x.ini ? " · desde " + fdia(x.ini) : ""}`,
      colorFn: (x) => (x.varV == null ? cV(t) : x.varV >= 0 ? t.series[2] : t.series[4]), condFn: condSem,
      extra: (x) => [`Variación: ${fVar(x.varV)}`, `${fT(x.nt)} · ${fmt(x.nb)} buses`], cols: [["Viajes", "n", fmt], ["Trabajadores", "nt", fmt], ["Variación %", "varV", pOpt], ["Buses", "nb", fmt]], emptyMsg: "No hay viajes con semana en vista." }),
  },
  trMes: {
    size: "md", focus: true,
    title: "Viajes y trabajadores por mes", sub: "Volumen mensual",
    info: { what: "Cuántos viajes y trabajadores distintos hubo en cada mes.", how: "Viajes = filas por mes de la FECHA (si no hay fecha, se usa MES2). Trabajadores = DNI distintos en el mes: quien viajó 20 días suma 20 viajes y 1 trabajador.", tip: "Clic en un mes para filtrar." },
    build: (d, t) => grouped(d, t, { list: d.meses, dim: "mes", fmtV: (v) => fmt(v), axisFmt: fmtSC, top: 24, series: [{ key: "n", name: "Viajes", color: cV(t) }, { key: "nt", name: "Trabajadores únicos", color: cT(t) }], condFn: condMes, colName: "Mes",
      extra: (x) => [`${fmt(x.dias)} días · ${fmt(x.vDia, 0)} viajes por día`], cols: [["Viajes", "n", fmt], ["Trabajadores", "nt", fmt], ["Días", "dias", fmt], ["Viajes / día", "vDia", f1]], emptyMsg: "No hay viajes con mes en vista." }),
  },
  trOcupDia: {
    size: "lg", focus: false,
    title: "Ocupación promedio por día", sub: () => `% de la capacidad usada · meta referencial ${CONFIG.META_OCUP} %`,
    info: { what: "Qué tan llenos salieron los buses cada día.", how: INFO_OCUP, tip: "Clic en un día para ver sus buses. La meta se edita en CONFIG.META_OCUP." },
    build: (d, t) => { const L = d.dias.filter((x) => x.ocup != null); return lineas(d, t, { list: L, colName: "Fecha", labelFn: (x) => fmtDia(x.key), tableLabelFn: (x) => fdia(x.key), titleFn: (x) => fmtDiaLargo(x.key), fmtV: fP1, axisFmt: (v) => v + " %", min: minPct(L.map((x) => x.ocup), CONFIG.META_OCUP), suggestedMax: 100,
      series: [{ name: "% ocupación", key: "ocup", color: cOc(t), fill: true }], refs: [metaRef(), { axis: "y", value: 100, label: "Capacidad 100 %" }], condFn: condFecha,
      extra: (x) => [`${fmt(x.pax)} trabajadores en ${fmt(x.capS)} asientos`, `${fmt(x.full)} de ${fmt(x.ns)} servicios llenos`],
      cols: [["% ocupación", "ocup", pOpt], ["Trabajadores a bordo", "pax", fmt], ["Asientos ofrecidos", "capS", fmt], ["Servicios", "ns", fmt], ["Servicios llenos", "full", fmt]], emptyMsg: "No hay buses con capacidad en vista." }); },
  },
  trTipoBus: {
    size: "donut", focus: true,
    title: "Viajes por tipo de bus", sub: "Tipos de vehículo según el Excel",
    info: { what: "Cómo se reparte el transporte entre los tipos de vehículo.", how: "Viajes por T. BUS ÷ total de viajes. Los tipos salen de los datos.", tip: "Clic en un tipo para filtrar." },
    build: (d, t) => donut(d, t, { list: fold(d.tbus, 7, ["n"]), key: "n", name: "Viajes", dim: "tbus", fmtV: fV, legendFmt: (v) => fmt(v), condFn: condDim("tbus"),
      extra: (x) => (x._otros ? [] : [`${fmt(x.nb)} buses · capacidad prom. ${nOpt(0)(x.capProm)}`, `Ocupación ${fP1(x.ocup)}`]), center: () => ({ title: fmt(d.k.nb), sub: "buses activos" }),
      cols: [["Buses", "nb", fmt], ["Capacidad prom.", "capProm", nOpt(0)], ["% ocupación", "ocup", pOpt]] }),
  },
  trPlaca: {
    size: "md", focus: true,
    title: "Viajes por placa", sub: "Color = tipo de bus",
    info: { what: "Cuánto trabajó cada bus.", how: "Viajes = filas por PLACA. El color indica el T. BUS de la placa.", tip: "Clic en una barra para ver las rutas de ese bus." },
    build: (d, t) => ranking(d, t, { list: d.placas.filter((x) => !vacio(x.label)), dim: "placa", key: "n", name: "Viajes", fmtV: fV, endFmt: (v) => fmtC(v), colorFn: (x) => colorOf("tbus", x._rows[0].tbus, t), colName: "Placa", condFn: condDim("placa"), top: CONFIG.TOP_N,
      titleFn: (x) => `${x.label} · ${x._rows[0].tbus}`, extra: (x) => [`${fT(x.nt)} · ${fmt(x.dias)} días operados`, `Ocupación ${fP1(x.ocup)} · capacidad ${nOpt(0)(x.capProm)}`], cols: colsV }),
  },
  trOcupPlaca: {
    size: "md", focus: true,
    title: "Ocupación por bus", sub: () => `Menor ocupación primero · buses con al menos ${CONFIG.MIN_SERVICIOS} servicios`,
    info: { what: "Qué buses salen más vacíos (o con sobrecupo).", how: INFO_OCUP + " Solo entran los buses con el mínimo de servicios de CONFIG.MIN_SERVICIOS.", tip: "Verde = en la meta · rojo = bajo la meta · óxido = sobrecupo." },
    build: (d, t) => ranking(d, t, { list: d.placas.filter((x) => !vacio(x.label) && x.ocup != null && x.ns >= CONFIG.MIN_SERVICIOS).sort((a, b) => a.ocup - b.ocup), dim: "placa", key: "ocup", name: "% ocupación", fmtV: fP1, axisFmt: (v) => v + " %", endFmt: (v) => fmt(v, 1) + " %", min: 0,
      ref: { value: CONFIG.META_OCUP, label: `Meta ${CONFIG.META_OCUP} %` }, colorFn: (x) => (x.ocup > 100 ? t.series[3] : x.ocup >= CONFIG.META_OCUP ? t.series[2] : t.series[4]), colName: "Placa", condFn: condDim("placa"), top: CONFIG.TOP_N,
      extra: (x) => [`${fmt(x.pax)} a bordo en ${fmt(x.capS)} asientos`, `${fmt(x.ns)} servicios · ${fmt(x.full)} llenos`], cols: [["% ocupación", "ocup", pOpt], ["Servicios", "ns", fmt], ["Capacidad", "capProm", nOpt(0)], ["Servicios llenos", "full", fmt]], emptyMsg: "Ningún bus alcanza el mínimo de servicios." }),
  },
  trDistOcup: {
    size: "md", focus: true,
    title: "Servicios por rango de ocupación", sub: "Cuántas salidas fueron casi vacías, llenas o con sobrecupo",
    info: { what: "La distribución de las salidas de bus según qué tan llenas fueron.", how: INFO_SERV + " " + INFO_OCUP, tip: "Clic en un rango para ver esos servicios." },
    build: (d, t) => { const C = OC_COLORS(t); return histo(t, { bins: d.ocupBins.map((b, i) => ({ ...b, color: C[i] })), name: "Servicios", unit: "servicios", colName: "Ocupación del servicio", dim: "_ocBin", emptyMsg: "No hay servicios con capacidad en vista." }); },
  },
  trOrigen: {
    size: "md", focus: true,
    title: "Viajes por origen", sub: "De dónde salen los trabajadores",
    info: { what: "Los puntos de recojo con más viajes.", how: "Viajes = filas por ORIGEN. En el detalle verás los trabajadores únicos de cada origen.", tip: "Clic en un origen para ver su desglose o filtrar." },
    build: (d, t) => ranking(d, t, { list: d.origenes.filter((x) => !vacio(x.label)), dim: "origen", key: "n", name: "Viajes", fmtV: fV, endFmt: (v) => fmtC(v), color: t.series[3], colName: "Origen", condFn: condDim("origen"), top: CONFIG.TOP_N, maxLabel: 32, extra: extraV, cols: colsV }),
  },
  trFundo: {
    size: "md", focus: true,
    title: "Viajes y trabajadores por fundo", sub: "Destino del transporte",
    info: { what: "A qué fundos se llevó a los trabajadores.", how: "Viajes = filas por FUNDO; trabajadores = DNI distintos por FUNDO.", tip: "Clic en un fundo para filtrar." },
    build: (d, t) => grouped(d, t, { list: d.fundos.filter((x) => !vacio(x.label)), dim: "fundo", fmtV: (v) => fmt(v), axisFmt: fmtSC, top: 10, horizontal: true, maxLabel: 26,
      series: [{ key: "n", name: "Viajes", color: cV(t) }, { key: "nt", name: "Trabajadores únicos", color: cT(t) }], condFn: condDim("fundo"), colName: "Fundo",
      extra: (x) => [`Sede: ${joinDistintos(x, "sede", 2)}`, `${fmt(x.nl)} lotes · ${fmt(x.nb)} buses`], cols: [["Viajes", "n", fmt], ["Trabajadores", "nt", fmt], ["Lotes", "nl", fmt], ["Buses", "nb", fmt]] }),
  },
  trParetoLote: {
    size: "lg", focus: false,
    title: "Pareto de viajes por lote", sub: "Qué pocos lotes concentran la mayoría del transporte",
    info: { what: "Los lotes que más trabajadores demandan (regla 80/20).", how: "Barras = viajes por LOTE de mayor a menor. Línea = % acumulado sobre el total de viajes con lote; la marca punteada es el 80 %.", tip: "Clic en un lote para ver su detalle." },
    build: (d, t) => pareto(d, t, { list: d.lotes.filter((x) => !vacio(x.label)), key: "n", name: "Viajes", dim: "lote", colName: "Lote", plural: "lotes", top: 20, color: t.series[2], extra: (x) => [`${fT(x.nt)} · ${fmt(x.nb)} buses`], cols: [["Trabajadores", "nt", fmt], ["Buses", "nb", fmt]], emptyMsg: "No hay viajes con lote en vista." }),
  },
  trFrecuentes: {
    size: "xl", focus: true,
    title: "Trabajadores más frecuentes", sub: "Top 15 por días transportados",
    info: { what: "Quiénes usan más el transporte.", how: "Días transportados = fechas distintas en que aparece el trabajador (por DNI). Si no tiene nombre, se muestra su DNI.", tip: "Clic en un trabajador para ver sus rutas, lotes y buses." },
    build: (d, t) => ranking(d, t, { list: d.trabajadores, dim: "trabajador", key: "dias", name: "Días transportados", fmtV: (v) => fmt(v) + " días", endFmt: (v) => fmt(v), color: t.series[0], colName: "Trabajador",
      labelFn: nombreW, titleFn: (x) => `${nombreW(x)} · DNI ${x._rows[0].doc || "—"}`, condFn: condW, top: 15, maxLabel: 34,
      extra: (x) => [`${fV(x.n)} · ${fmt(x.nl)} lotes · ${fmt(x.nb)} buses`, `${fdia(x.fMin)} → ${fdia(x.fMax)}`], cols: [["Días", "dias", fmt], ["Viajes", "n", fmt], ["Lotes", "nl", fmt], ["Buses", "nb", fmt]] }),
  },
};

/* =========================== TABLAS =========================== */
const condFila = (r) => [{ dim: "codigo", value: r._id, label: `${vacio(r.trabajador) ? "DNI " + (r.doc || "—") : r.trabajador} · ${fdia(r.fecha)}` }];
const pctViajes = (d) => ({ t: "% viajes", num: 1, get: (x) => pct0(x.n, d.k.n), f: pOpt });
const obsCal = (r) => [r._f.sinT && "Sin nombre del trabajador", r._f.sinD && "Sin documento de pase", r._f.sinL && "Sin lote", r._f.dup && "Repetido (misma fecha, DNI y lote)"].filter(Boolean).join(" · ");
const TLIB = {
  tDetalle: {
    title: "Detalle de viajes", sub: "Tabla 1 · una fila por trabajador transportado · busca por placa, trabajador, DNI, lote…",
    info: { what: "Cada registro del Excel, limpio y filtrado.", how: "Respeta todos los filtros. Textos en mayúsculas y sin espacios sobrantes; la fecha se normaliza a día/mes/año." },
    table: () => ({
      src: state.vista,
      cols: [
        { t: "Fecha", get: (r) => r.fecha, f: (v) => (v ? fdia(v) : "—") }, { t: "Mes", get: (r) => r.mes }, { t: "Semana", get: (r) => r.sem }, { t: "Sede", get: (r) => r.sede },
        { t: "Placa", get: (r) => r.placa }, { t: "Origen", get: (r) => r.origen }, { t: "Nro. doc. pase", get: (r) => r.doc || "—" }, { t: "Trabajador", get: (r) => r.trabajador },
        { t: "Fundo", get: (r) => r.fundo }, { t: "Lote", get: (r) => r.lote }, { t: "Actividad", get: (r) => r.actividad }, { t: "T. bus", get: (r) => r.tbus },
        { t: "Capacidad", num: 1, get: (r) => r._cap || null, f: nOpt(0) },
      ],
      condFn: condFila, searchable: true, pageSize: CONFIG.PAGE_SIZE, defaultSort: { col: 0, dir: "desc" },
    }),
  },
  tRuta: {
    title: "Resumen por ruta (origen → fundo)", sub: "Tabla 2 · viajes, trabajadores, buses y lotes de cada recorrido",
    info: { what: "Cada combinación de origen y fundo con su volumen y recursos.", how: "Agrupa por ORIGEN + FUNDO. Capacidad promedio = promedio de la CAPACIDAD de los buses distintos de la ruta. % viajes = viajes de la ruta ÷ viajes en vista." },
    table: (d) => ({ src: d.rutas,
      cols: [{ t: "Origen", get: (x) => x.d0 }, { t: "Fundo", get: (x) => x.d1 }, { t: "Viajes", num: 1, get: (x) => x.n, f: fmt }, { t: "Trabajadores únicos", num: 1, get: (x) => x.nt, f: fmt }, { t: "Buses", num: 1, get: (x) => x.nb, f: fmt },
        { t: "Lotes atendidos", num: 1, get: (x) => x.nl, f: fmt }, { t: "Capacidad prom.", num: 1, get: (x) => x.capProm, f: nOpt(0) }, { t: "% ocupación", num: 1, get: (x) => x.ocup, f: pOpt }, pctViajes(d)],
      condFn: condRuta, searchable: true, pageSize: 25, defaultSort: { col: 2, dir: "desc" } }),
  },
  tSede: {
    title: "Resumen por sede y fundo", sub: "Tabla 3 · volumen y diversidad de cada destino",
    info: { what: "Cada sede con sus fundos: cuántos viajes, trabajadores, lotes, buses y actividades.", how: "Agrupa por SEDE + FUNDO. Los conteos son valores distintos dentro del grupo." },
    table: (d) => ({ src: d.sedeFundo,
      cols: [{ t: "Sede", get: (x) => x.d0 }, { t: "Fundo", get: (x) => x.d1 }, { t: "Viajes", num: 1, get: (x) => x.n, f: fmt }, { t: "Trabajadores únicos", num: 1, get: (x) => x.nt, f: fmt }, { t: "Lotes", num: 1, get: (x) => x.nl, f: fmt },
        { t: "Buses", num: 1, get: (x) => x.nb, f: fmt }, { t: "Actividades", num: 1, get: (x) => x.na, f: fmt }, pctViajes(d)],
      condFn: (x) => [{ dim: "sede", value: x.d0 }, { dim: "fundo", value: x.d1 }], searchable: false, pageSize: 25, defaultSort: { col: 2, dir: "desc" } }),
  },
  tTrabajador: {
    title: "Resumen por trabajador", sub: "Tabla 4 · días transportados, lotes, fundos, actividades y buses",
    info: { what: "El recorrido de cada trabajador en el período en vista.", how: "Agrupa por DNI (o por nombre si no hay DNI). Días transportados = fechas distintas. Primera y última fecha = extremos del período en vista." },
    table: (d) => ({ src: d.trabajadores,
      cols: [{ t: "Trabajador", get: (x) => nombreW(x) }, { t: "Nro. doc. pase", get: (x) => x._rows[0].doc || "—" }, { t: "Días transportados", num: 1, get: (x) => x.dias, f: fmt }, { t: "Viajes", num: 1, get: (x) => x.n, f: fmt },
        { t: "Lotes", num: 1, get: (x) => x.nl, f: fmt }, { t: "Fundos", num: 1, get: (x) => x.nf, f: fmt }, { t: "Actividades", num: 1, get: (x) => x.na, f: fmt }, { t: "Placas", num: 1, get: (x) => x.nb, f: fmt },
        { t: "Primera fecha", get: (x) => x.fMin, f: (v) => (v ? fdia(v) : "—") }, { t: "Última fecha", get: (x) => x.fMax, f: (v) => (v ? fdia(v) : "—") }],
      condFn: condW, searchable: true, pageSize: 25, defaultSort: { col: 2, dir: "desc" } }),
  },
  tPlaca: {
    title: "Resumen por placa / bus", sub: "Tabla 5 · uso, ocupación y cobertura de cada vehículo",
    info: { what: "Lo que hizo cada bus en el período en vista.", how: "Agrupa por PLACA. " + INFO_SERV + " % ocupación como en las tarjetas. Días operados = fechas distintas con viajes." },
    table: (d) => ({ src: d.placas.filter((x) => !vacio(x.label)),
      cols: [{ t: "Placa", get: (x) => x.label }, { t: "T. bus", get: (x) => joinDistintos(x, "tbus", 1) }, { t: "Capacidad", num: 1, get: (x) => x.capProm, f: nOpt(0) }, { t: "Viajes", num: 1, get: (x) => x.n, f: fmt },
        { t: "Trabajadores", num: 1, get: (x) => x.nt, f: fmt }, { t: "Orígenes", num: 1, get: (x) => x.no, f: fmt }, { t: "Fundos", num: 1, get: (x) => x.nf, f: fmt }, { t: "Lotes", num: 1, get: (x) => x.nl, f: fmt },
        { t: "Días operados", num: 1, get: (x) => x.dias, f: fmt }, { t: "Servicios", num: 1, get: (x) => x.ns, f: fmt }, { t: "% ocupación", num: 1, get: (x) => x.ocup, f: pOpt }, pctViajes(d)],
      condFn: condDim("placa"), searchable: true, pageSize: 25, defaultSort: { col: 3, dir: "desc" } }),
  },
  tLote: {
    title: "Resumen por lote y actividad", sub: "Tabla 6 · demanda de transporte en cada lote",
    info: { what: "Cada combinación de fundo, lote y actividad.", how: "Agrupa por FUNDO + LOTE + ACTIVIDAD. Días atendidos = fechas distintas con viajes." },
    table: (d) => ({ src: d.loteAct,
      cols: [{ t: "Fundo", get: (x) => x.d0 }, { t: "Lote", get: (x) => x.d1 }, { t: "Actividad", get: (x) => x.d2 }, { t: "Viajes", num: 1, get: (x) => x.n, f: fmt }, { t: "Trabajadores únicos", num: 1, get: (x) => x.nt, f: fmt },
        { t: "Buses", num: 1, get: (x) => x.nb, f: fmt }, { t: "Días atendidos", num: 1, get: (x) => x.dias, f: fmt }, pctViajes(d)],
      condFn: (x) => [{ dim: "fundo", value: x.d0 }, { dim: "lote", value: x.d1 }, { dim: "actividad", value: x.d2 }], searchable: true, pageSize: 25, defaultSort: { col: 3, dir: "desc" } }),
  },
  tPeriodo: {
    title: "Resumen semanal / mensual", sub: "Tabla 7 · indicadores por semana con variación",
    info: { what: "Cada semana del período en vista con sus indicadores.", how: "Variación = (viajes de la semana − semana anterior) ÷ semana anterior. Mes = mes(es) de las fechas de esa semana." },
    table: (d) => ({ src: d.semanas,
      cols: [{ t: "Mes", get: (x) => joinDistintos(x, "mes", 2) }, { t: "Semana", get: (x) => x.key, f: (k) => (d.semanas.find((s) => s.key === k) || {}).label || k }, { t: "Desde", get: (x) => x.ini, f: (v) => (v ? fdia(v) : "—") },
        { t: "Viajes", num: 1, get: (x) => x.n, f: fmt }, { t: "Trabajadores únicos", num: 1, get: (x) => x.nt, f: fmt }, { t: "Buses activos", num: 1, get: (x) => x.nb, f: fmt }, { t: "Lotes atendidos", num: 1, get: (x) => x.nl, f: fmt },
        { t: "% ocupación", num: 1, get: (x) => x.ocup, f: pOpt }, { t: "Variación viajes %", num: 1, get: (x) => x.varV, f: (v) => (v == null ? "—" : fVar(v)) }],
      condFn: condSem, searchable: false, pageSize: 25, defaultSort: { col: 1, dir: "desc" } }),
  },
  tCalidad: {
    title: "Control de calidad de datos", sub: "Tabla 8 · solo los registros con alguna observación",
    info: { what: "Las filas del Excel que conviene revisar o corregir.", how: "Se marca una fila si no tiene nombre del trabajador, documento de pase o lote, o si repite la misma fecha + DNI + lote que otra (la primera no se marca)." },
    table: () => ({
      src: state.vista.filter((r) => r._f.any), empty: "Sin observaciones: todos los registros en vista están completos.",
      cols: [{ t: "Fecha", get: (r) => r.fecha, f: (v) => (v ? fdia(v) : "—") }, { t: "Placa", get: (r) => r.placa }, { t: "Nro. doc. pase", get: (r) => r.doc || "—" }, { t: "Trabajador", get: (r) => r.trabajador }, { t: "Lote", get: (r) => r.lote },
        { t: "Sin trabajador", get: (r) => si(r._f.sinT) }, { t: "Sin doc. pase", get: (r) => si(r._f.sinD) }, { t: "Sin lote", get: (r) => si(r._f.sinL) }, { t: "Duplicado", get: (r) => si(r._f.dup) }, { t: "Observación", get: obsCal }],
      condFn: condFila, searchable: true, pageSize: CONFIG.PAGE_SIZE, defaultSort: { col: 0, dir: "desc" },
    }),
  },
};

/* =========================== KPIs =========================== */
const estadoMeta = (ok, txtOk, txtMal, malo = "warn") => (ok ? ["good", "fa-circle-check", txtOk] : [malo, "fa-circle-exclamation", txtMal]);
const KLIB = {
  trViajes: { label: "Total viajes", icon: "fa-route", slot: 0, val: (k) => k.n, f: fmt, unit: "", delta: "pct", better: "up",
    sub: (k) => `<b>${fmt(k.nt)}</b> trabajadores transportados · <b>${fmt(k.vDia || 0, 0)}</b> viajes por día`,
    info: { what: "Cuántas veces se transportó a un trabajador.", how: "Total viajes = cantidad de filas (COUNT). " + INFO_VIAJE + " La flecha compara la última semana en vista con la anterior." } },
  trTrab: { label: "Trabajadores únicos", icon: "fa-people-group", slot: 2, val: (k) => k.nt, f: fmt, unit: "", delta: "pct", better: "up",
    sub: (k) => `<b>${fmt(k.nd)}</b> documentos de pase · <b>${fmt(k.sinT)}</b> registro${k.sinT === 1 ? "" : "s"} sin nombre`,
    info: { what: "Cuántas personas distintas usaron el transporte.", how: "DNI distintos (NRO. DOC. PASA.). Si una fila no trae DNI, se usa el nombre. Documentos de pase = DNI distintos con valor." } },
  trOcup: { label: "% Ocupación promedio", icon: "fa-gauge-high", slot: 1, val: (k) => k.ocup, f: (v) => (v == null ? "—" : fmt(v, 1)), unit: "%", delta: "pp", better: "up", bar: (k) => Math.min(100, k.ocup || 0),
    sub: (k) => `Capacidad prom. por bus <b>${nOpt(0)(k.capProm)}</b> · <b>${fmt(k.full)}</b> servicios llenos (${fP1(k.pFull)})`,
    status: (v) => (v == null ? null : v > 100 ? ["crit", "fa-triangle-exclamation", "Sobrecupo: más trabajadores que asientos"] : estadoMeta(v >= CONFIG.META_OCUP, `En la meta referencial (${CONFIG.META_OCUP} %)`, `${fmt(CONFIG.META_OCUP - v, 1)} pp bajo la meta (${CONFIG.META_OCUP} %)`)),
    info: { what: "Qué tan llenos salieron los buses.", how: INFO_OCUP + " " + INFO_SERV } },
  trBuses: { label: "Buses activos", icon: "fa-bus", slot: 3, val: (k) => k.nb, f: fmt, unit: "", delta: "pct", better: null,
    sub: (k) => `<b>${f1(k.vBus)}</b> viajes promedio por bus · <b>${fmt(k.ns)}</b> servicios`,
    info: { what: "Cuántos vehículos distintos se usaron.", how: "PLACAS distintas con al menos un viaje. Viajes promedio por bus = viajes ÷ buses activos." } },
};

/* =========================== HALLAZGOS =========================== */
function hallazgos(d) {
  const k = d.k, L = [];
  if (!k.n) return L;
  L.push({ icon: "fa-route", tone: "brand", html: `Se registraron <b>${fmt(k.n)}</b> viajes de <b>${fmt(k.nt)}</b> trabajadores en <b>${fmt(k.dias)}</b> días: <b>${fmt(k.vDia || 0, 0)}</b> viajes por día en promedio.` });
  if (d.dias.length > 1) { const p = maxBy(d.dias, "n"); L.push({ icon: "fa-calendar-day", tone: "brand", html: `El día de mayor demanda fue <b>${esc(fmtDiaLargo(p.key))}</b>, con <b>${fmt(p.n)}</b> viajes (${fVar(varPct(p.n, k.vDia))} sobre el promedio).`, cond: condFecha(p) }); }
  const S = d.semanas;
  if (S.length > 1) { const a = S[S.length - 1]; L.push({ icon: a.varV >= 0 ? "fa-arrow-trend-up" : "fa-arrow-trend-down", tone: a.varV >= 0 ? "good" : "warn", html: `En <b>${esc(a.label)}</b> hubo <b>${fmt(a.n)}</b> viajes: <b>${fVar(a.varV)}</b> frente a la semana anterior.`, cond: condSem(a) }); }
  const R = d.rutas;
  if (R.length) { const r = R[0]; L.push({ icon: "fa-map-location-dot", tone: "brand", html: `La ruta principal es <b>${esc(r.d0)} → ${esc(r.d1)}</b>: <b>${fP1(pct0(r.n, k.n))}</b> de los viajes (${fmt(R.length)} ruta${R.length === 1 ? "" : "s"} distinta${R.length === 1 ? "" : "s"}).`, cond: condRuta(r) }); }
  if (k.ocup != null) L.push({ icon: "fa-gauge-high", tone: k.ocup >= CONFIG.META_OCUP ? "good" : "warn", html: `Los buses salieron con <b>${fP1(k.ocup)}</b> de ocupación promedio (${k.ocup >= CONFIG.META_OCUP ? "sobre" : "bajo"} la meta de ${CONFIG.META_OCUP} %); <b>${fmt(k.full)}</b> de ${fmt(k.ns)} servicios salieron llenos.` });
  const sc = d.ocupBins[d.ocupBins.length - 1];
  if (sc && sc.n) L.push({ icon: "fa-triangle-exclamation", tone: "warn", html: `<b>${fmt(sc.n)}</b> servicio${sc.n === 1 ? "" : "s"} llevaron más trabajadores que su capacidad (sobrecupo).`, cond: [{ dim: "_ocBin", value: sc.label, label: sc.label }] });
  const P = d.placas.filter((x) => !vacio(x.label));
  if (P.length) { const p = P[0]; L.push({ icon: "fa-bus", tone: "brand", html: `El bus más usado es <b>${esc(p.label)}</b> (${esc(p._rows[0].tbus)}): <b>${fmt(p.n)}</b> viajes en ${fmt(p.dias)} días.`, cond: condDim("placa")(p) }); }
  const Pl = P.filter((x) => x.ocup != null && x.ns >= CONFIG.MIN_SERVICIOS).sort((a, b) => a.ocup - b.ocup);
  if (Pl.length > 1 && Pl[0].ocup < CONFIG.META_OCUP) L.push({ icon: "fa-chair", tone: "warn", html: `El bus con menor ocupación es <b>${esc(Pl[0].label)}</b>: <b>${fP1(Pl[0].ocup)}</b> en ${fmt(Pl[0].ns)} servicios. Revisa si conviene un vehículo más chico o unir rutas.`, cond: condDim("placa")(Pl[0]) });
  const Lo = d.lotes.filter((x) => !vacio(x.label));
  if (Lo.length > 2) { const tot = Lo.reduce((a, x) => a + x.n, 0); let a = 0, n = 0; for (const x of Lo) { a += x.n; n++; if (a / tot >= 0.8) break; } L.push({ icon: "fa-ranking-star", tone: "brand", html: `<b>${fmt(n)}</b> de ${fmt(Lo.length)} lotes concentran el 80 % de los viajes; el principal es <b>${esc(Lo[0].label)}</b> (${fP1(pct0(Lo[0].n, tot))}).`, cond: condDim("lote")(Lo[0]) }); }
  const A = d.actividades.filter((x) => !vacio(x.label));
  if (A.length) L.push({ icon: "fa-person-digging", tone: "brand", html: `<b>${esc(A[0].label)}</b> es la actividad con más viajes (${fP1(pct0(A[0].n, k.n))}).`, cond: condDim("actividad")(A[0]) });
  if (k.sinT || k.dup) L.push({ icon: "fa-shield-halved", tone: "warn", html: `Calidad de datos: <b>${fmt(k.sinT)}</b> registro${k.sinT === 1 ? "" : "s"} sin nombre del trabajador y <b>${fmt(k.dup)}</b> repetidos (misma fecha, DNI y lote).`, cond: [{ dim: "flag", value: k.sinT ? "sinT" : "dup", label: k.sinT ? "Sin nombre del trabajador" : "Repetidos" }] });
  return L;
}
function renderHallazgos(d, el) {
  const shown = hallazgos(d).slice(0, 10);
  el._conds = shown.map((x) => x.cond || null);
  el.innerHTML = shown.length
    ? `<ul class="insights cols-2">${shown.map((x, i) => `
        <li class="insight tone-${x.tone}" style="--i:${i}">
          ${x.cond ? `<button type="button" class="insight-btn" data-insight="${i}">` : `<div class="insight-btn is-static">`}
            <span class="insight-ico"><i class="fas ${x.icon}"></i></span>
            <span class="insight-text">${x.html}</span>
            ${x.cond ? `<i class="fas fa-chevron-right insight-go" aria-hidden="true"></i></button>` : `</div>`}
        </li>`).join("")}</ul>`
    : `<p class="table-empty">No hay suficientes datos en vista para generar hallazgos.</p>`;
}

/* ---------- Mapa de calor: día de la semana × semana ---------- */
function renderCalor(d, el) {
  const D = d.dias;
  if (!D.length) { el.innerHTML = `<p class="table-empty">No hay viajes con fecha en vista.</p>`; return; }
  const m = new Map(D.map((x) => [x.key, x]));
  const max = Math.max(...D.map((x) => x.n)) || 1;
  const semanas = [];
  for (let s = lunesDe(D[0].key); s <= D[D.length - 1].key; s = addDays(s, 7)) semanas.push(s);
  const W = semanas.slice(-53);
  const step = W.length > 26 ? 4 : W.length > 13 ? 2 : 1;
  const DOW = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
  const tot = Array(7).fill(0), cnt = Array(7).fill(0);
  D.forEach((x) => { const i = (parseISO(x.key).getDay() + 6) % 7; tot[i] += x.n; cnt[i]++; });
  const prom = tot.map((v, i) => (cnt[i] ? v / cnt[i] : 0));
  const iBest = prom.indexOf(Math.max(...prom));
  const pico = maxBy(D, "n");
  let h = `<div class="heat" style="--cols:${W.length}"><div class="heat-scroll"><div class="heat-grid"><span class="heat-corner"></span>`;
  h += W.map((s, i) => `<span class="heat-wk" title="Semana del ${fdia(s)}">${i % step ? "" : fmtDia(s)}</span>`).join("");
  for (let r = 0; r < 7; r++) {
    h += `<span class="heat-dow">${DOW[r]}</span>`;
    W.forEach((s) => {
      const f = addDays(s, r), x = m.get(f);
      h += x
        ? `<button type="button" class="heat-cell" data-fecha="${f}" style="--a:${(0.14 + 0.86 * (x.n / max)).toFixed(3)}" title="${esc(fmtDiaLargo(f))} · ${fmt(x.n)} viajes · ${fmt(x.nt)} trabajadores" aria-label="${esc(fmtDiaLargo(f))}: ${fmt(x.n)} viajes"></button>`
        : `<span class="heat-cell is-zero" title="${esc(fmtDiaLargo(f))} · sin viajes"></span>`;
    });
  }
  h += `</div></div><div class="heat-foot"><span>Menos</span><i style="--a:.15"></i><i style="--a:.4"></i><i style="--a:.65"></i><i style="--a:.95"></i><span>Más</span>
    <p class="heat-note">Día pico: <b>${esc(fmtDiaLargo(pico.key))}</b> (${fmt(pico.n)} viajes) · día de la semana más fuerte: <b>${DOW[iBest]}</b> (${fmt(prom[iBest], 0)} viajes en promedio)</p></div></div>`;
  el.innerHTML = h;
}

/* ---------- Indicadores de calidad ---------- */
function renderCalidad(d, el) {
  const k = d.k;
  if (!k.n) { el.innerHTML = `<p class="table-empty">No hay registros en vista.</p>`; return; }
  const items = [
    { flag: "sinT", label: "Con trabajador identificado", pct: k.pT, bad: k.sinT, txt: `${fmt(k.sinT)} sin nombre` },
    { flag: "sinD", label: "Con documento de pase", pct: k.pD, bad: k.sinD, txt: `${fmt(k.sinD)} sin documento` },
    { flag: "sinL", label: "Con lote asignado", pct: k.pL, bad: k.sinL, txt: `${fmt(k.sinL)} sin lote` },
    { flag: "dup", label: "Sin duplicados (fecha + DNI + lote)", pct: pct0(k.n - k.dup, k.n), bad: k.dup, txt: `${fmt(k.dup)} filas repetidas` },
  ];
  const tono = (p) => (p >= 99 ? "good" : p >= 95 ? "warn" : "crit");
  const indice = items.reduce((a, x) => a + (x.pct || 0), 0) / items.length;
  el.innerHTML = `<div class="q-head"><span class="q-score tone-${tono(indice)}"><b>${fmt(indice, 1)}</b><small>/ 100</small></span><p>Índice de calidad: promedio de los cuatro controles. Clic en un control para ver los registros observados.</p></div>
    <div class="qgrid">${items.map((x) => `<button type="button" class="q-item tone-${tono(x.pct)}" data-flag="${x.flag}" ${x.bad ? "" : "disabled"}>
      <span class="q-top"><span class="q-label">${x.label}</span><b>${fP1(x.pct)}</b></span>
      <span class="q-bar"><i style="width:${Math.max(0, Math.min(100, x.pct || 0))}%"></i></span>
      <span class="q-sub"><i class="fas ${x.bad ? "fa-magnifying-glass" : "fa-circle-check"}"></i>${x.bad ? x.txt + " · ver registros" : "Todo en orden"}</span></button>`).join("")}</div>`;
}

const XLIB = {
  xHall: { title: "Hallazgos automáticos", sub: "Lo que más se destaca con los filtros actuales",
    info: { what: "Frases que resumen lo más relevante del tablero con los filtros actuales.", how: "Se recalculan cada vez que cambias un filtro o llegan datos nuevos. Ninguna está escrita a mano.", tip: "Clic en un hallazgo para abrir su detalle." },
    render: renderHallazgos },
  xCalor: { title: "Mapa de calor de la demanda", sub: "Viajes por día · cada columna es una semana (lunes a domingo)",
    info: { what: "Qué días de la semana y qué semanas concentran más viajes.", how: "Color = viajes del día ÷ el día con más viajes en vista. Las celdas punteadas son días sin viajes.", tip: "Clic en un día para ver su detalle." },
    render: renderCalor },
  xCalidad: { title: "Indicadores de calidad de datos", sub: "Qué tan completo y limpio viene el Excel",
    info: { what: "El porcentaje de registros completos y sin repetir.", how: "% con trabajador = filas con nombre ÷ filas. Igual para documento de pase y lote. Duplicado = misma fecha + DNI + lote que una fila anterior." },
    render: renderCalidad },
};
/* =========================== KPIs: utilidades =========================== */
function sparkSVG(values, hi, color) {
  const v = values.filter((x) => isFinite(x));
  if (v.length < 2) return "";
  values = values.map((x) => (isFinite(x) ? x : Math.min(...v)));
  const W = 92, H = 32, pad = 3;
  const min = Math.min(...v), max = Math.max(...v), rng = max - min || 1;
  const pts = values.map((x, i) => [pad + (i / (values.length - 1)) * (W - pad * 2), H - pad - ((x - min) / rng) * (H - pad * 2)]);
  const dPath = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const area = `${dPath} L${pts[pts.length - 1][0].toFixed(1)},${H} L${pts[0][0].toFixed(1)},${H} Z`;
  const h = pts[Math.max(0, Math.min(pts.length - 1, hi))];
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">
    <path d="${area}" fill="${color}" opacity=".12"></path>
    <path d="${dPath}" fill="none" stroke="${color}" stroke-width="1.75" stroke-linejoin="round" stroke-linecap="round"></path>
    <circle cx="${h[0].toFixed(1)}" cy="${h[1].toFixed(1)}" r="3" fill="${color}" stroke="var(--surface)" stroke-width="1.5"></circle>
  </svg>`;
}
function animateNumber(el, to, f) {
  const from = typeof el._val === "number" ? el._val : 0;
  el._val = to;
  if (REDUCED || from === to) { el.textContent = f(to); return; }
  cancelAnimationFrame(el._raf);
  const t0 = performance.now(), dur = 750;
  const step = (now) => {
    const p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3);
    el.textContent = f(from + (to - from) * e);
    if (p < 1) el._raf = requestAnimationFrame(step);
  };
  el._raf = requestAnimationFrame(step);
}

/* =========================== KPIs: render =========================== */
function kpiTxt(def, key) { const v = def[key]; return typeof v === "function" ? v(DS()) : v; }
function renderKPIs() {
  const d = state.d, ds = DS();
  // Tendencia semanal con los filtros que no son de tiempo, hasta la última fecha en vista
  const fMax = d.k.fMax;
  const S = d.tendencia.filter((p) => !fMax || !p.ini || p.ini <= fMax).slice(-12);
  const cur = S.length - 1, prev = cur - 1;
  ds.kpis.forEach((id) => {
    const k = KLIB[id];
    const card = document.querySelector(`.kpi[data-kpi="${id}"]`);
    if (!card) return;
    const valor = k.val(d.k, d);
    const num = card.querySelector(".kpi-num");
    if (num.querySelector(".sk")) num.textContent = "";
    if (valor == null) { num._val = null; num.textContent = "—"; } else animateNumber(num, valor, k.f);
    const uni = card.querySelector(".kpi-val small");
    if (uni) uni.hidden = valor == null;
    num.title = valor == null ? "" : k.f(valor);

    let mid = `<p class="kpi-sub">${k.sub(d.k, d, ds)}</p>`;
    if (k.bar) mid += `<div class="kpi-bar" role="presentation"><i style="width:${Math.max(0, Math.min(100, k.bar(d.k, d) || 0))}%"></i></div>`;
    const st = k.status ? k.status(valor, d.k) : null;
    if (st) mid += `<span class="status status-${st[0]}"><i class="fas ${st[1]}"></i>${st[2]}</span>`;
    card.querySelector(".kpi-mid").innerHTML = mid;

    const foot = card.querySelector(".kpi-foot");
    let deltaHTML = `<span class="delta flat"><i class="fas fa-minus"></i>Sin semana anterior</span>`;
    if (cur >= 1) {
      const a = k.val(S[cur], d), b = k.val(S[prev], d);
      if (a == null || b == null) deltaHTML = `<span class="delta flat"><i class="fas fa-minus"></i>Sin dato para comparar</span>`;
      else {
        let diff, t;
        if (k.delta === "pct") { diff = b ? ((a - b) / Math.abs(b)) * 100 : 0; t = `${diff >= 0 ? "+" : "−"}${fmt(Math.abs(diff), 1)} %`; }
        else if (k.delta === "pp") { diff = a - b; t = `${diff >= 0 ? "+" : "−"}${fmt(Math.abs(diff), 1)} pp`; }
        else { diff = a - b; t = `${diff >= 0 ? "+" : "−"}${fmt(Math.abs(diff), k.dec ?? 1)}`; }
        const eps = 1e-6, up = diff > eps, down = diff < -eps;
        const good = (k.better === "up" && up) || (k.better === "down" && down);
        const bad = (k.better === "up" && down) || (k.better === "down" && up);
        const cls = !up && !down ? "flat" : good ? "good" : bad ? "bad" : "ref";
        const ico = up ? "fa-arrow-trend-up" : down ? "fa-arrow-trend-down" : "fa-minus";
        deltaHTML = `<span class="delta ${cls}" title="${esc(S[cur].label)} comparada con ${esc(S[prev].label)}"><i class="fas ${ico}"></i>${t}</span><span class="delta-ref">${esc(S[cur].short)} vs. ${esc(S[prev].short)}</span>`;
      }
    }
    foot.innerHTML = `<div class="delta-wrap">${deltaHTML}</div>${sparkSVG(S.map((p) => k.val(p, d) ?? NaN), cur, state.tk.series[k.slot] || state.tk.brand)}`;
  });
}

/* =========================== LAYOUT (se arma por tablero) =========================== */
let SPECS = [];     // gráficos del tablero actual
let XSPECS = [];    // tablas y hallazgos del tablero actual
const SEC_KEYS = () => DS().secs.map((s) => s.k);
const secDef = (k) => DS().secs.find((s) => s.k === k) || DS().secs[0];

function renderBoardNav() {
  const grupos = Object.keys(FILES).map((f) => ({ f, list: DS_KEYS.filter((k) => DATASETS[k].file === f) }));
  $("boardNav").innerHTML = grupos.map(({ f, list }) => `
    <div class="board-group">
      <p class="bg-label"><i class="fas ${FILES[f].icon}"></i>${FILES[f].label}</p>
      ${list.map((k) => {
        const ds = DATASETS[k], pub = PUB[ds.sheet], on = k === state.ds;
        const n = pub && pub.meta ? pub.meta.registros : null;
        const estado = pub ? (STORE[k].signature && STORE[k].signature !== firmaPub(pub) ? "stale" : "ok") : PUB._checked ? "empty" : "wait";
        return `<a href="#${k}/${(on ? state.seccion : "") || ds.secs[0].k}" class="board ${on ? "active" : ""}" data-ds="${k}" ${on ? 'aria-current="page"' : ""} title="${esc(FILES[f].excel)} · pestaña ${esc(ds.tab)}">
          <i class="fas ${ds.icon} board-ico"></i>
          <span class="board-txt"><b>${ds.titulo}</b><small>${esc(ds.tab)}${n != null ? ` · ${fmt(n)} filas` : estado === "empty" ? " · sin datos" : ""}</small></span>
          <span class="board-dot is-${estado}" aria-hidden="true"></span></a>`;
      }).join("")}
    </div>`).join("");
}

function construirLayout() {
  const ds = DS();
  Object.keys(charts).forEach((id) => { charts[id].destroy(); delete charts[id]; });
  Object.keys(outs).forEach((id) => delete outs[id]);
  Object.keys(tables).forEach((id) => delete tables[id]);
  Object.keys(INFO).forEach((k) => delete INFO[k]);
  SPECS = []; XSPECS = [];

  renderBoardNav();
  $("dashTabs").innerHTML = ds.secs.map((s, i) => `<a href="#${state.ds}/${s.k}" class="tab" role="tab" data-seccion="${s.k}" aria-selected="false"><i class="fas ${s.icon}"></i><span>${s.t}</span><kbd>${i + 1}</kbd></a>`).join("");
  $("boardHead").innerHTML = `
    <span class="bh-ico"><i class="fas ${ds.icon}"></i></span>
    <div class="bh-txt"><p class="bh-kicker"><i class="fas ${FILES[ds.file].icon}"></i>${FILES[ds.file].label} · pestaña «${esc(ds.tab)}»</p><h1>${ds.titulo}</h1></div>
    <span class="bh-meta" id="bhMeta"></span>`;
  $("stSheet").textContent = `${CONFIG.TABLE} · ${ds.sheet}`;

  $("sections").innerHTML = ds.secs.map((s) => {
    const items = s.items.map(([id, span, size]) => {
      const c = CHARTLIB[id];
      if (c) {
        const spec = { id, sec: s.k, span, size: size || c.size, focus: c.focus, title: txt(c.title), sub: txt(c.sub), subFn: typeof c.sub === "function" ? () => c.sub(DS()) : null, build: c.build.bind(c) };
        SPECS.push(spec);
        INFO["chart:" + id] = { title: spec.title, ...txt(c.info) };
        return chartCard(spec);
      }
      const x = TLIB[id] || XLIB[id];
      if (!x) return "";
      const xs = { id, sec: s.k, span, title: txt(x.title), sub: txt(x.sub), table: x.table, render: x.render };
      XSPECS.push(xs);
      INFO["extra:" + id] = { title: xs.title, ...txt(x.info) };
      return extraCard(xs);
    }).join("");
    const kpis = s.kpis ? `<div class="kpi-row" id="kpiRow">${ds.kpis.map((id) => {
      const k = KLIB[id], label = kpiTxt(k, "label");
      INFO["kpi:" + id] = { title: label, ...txt(k.info) };
      return `<article class="card kpi" data-kpi="${id}" style="--accent: var(--series-${k.slot + 1})">
        <header class="kpi-head"><span class="kpi-ico"><i class="fas ${k.icon}"></i></span><h3>${label}</h3>${infoBtn("kpi:" + id, label)}</header>
        <div class="kpi-val"><span class="kpi-num"><span class="sk sk-kpi"></span></span>${k.unit ? `<small>${k.unit}</small>` : ""}</div>
        <div class="kpi-mid"></div>
        <footer class="kpi-foot"><span class="sk sk-line"></span></footer>
      </article>`;
    }).join("")}</div>` : "";
    return `<section id="sec-${s.k}" class="dash-section" data-seccion="${s.k}" hidden>
      <header class="page-head"><div class="page-head-ico"><i class="fas ${s.icon}"></i></div><div><h2>${s.t}</h2><p>${s.desc}</p></div></header>
      ${kpis}<div class="grid" id="grid-${s.k}">${items}</div></section>`;
  }).join("");
  const nCharts = SPECS.length, nTablas = XSPECS.filter((x) => x.table).length;
  $("stContenido").textContent = `${ds.kpis.length} KPIs · ${nCharts} gráficos · ${nTablas} tablas`;
  $("kbdN").textContent = ds.secs.length;
}

function infoBtn(key, label) {
  return `<button type="button" class="card-btn info-btn js-info" data-info="${key}" aria-label="Qué significa: ${esc(label)}" aria-expanded="false"><i class="fas fa-circle-info"></i></button>`;
}
function chartCard(c) {
  return `
  <article class="card chart-card span-${c.span}" id="card-${c.id}" data-chart="${c.id}">
    <header class="card-head">
      <div class="card-titles"><h3>${c.title}</h3><p data-sub="${esc(c.sub)}">${c.sub}</p></div>
      <div class="card-actions">
        ${infoBtn("chart:" + c.id, c.title)}
        <button type="button" class="card-btn js-table" aria-pressed="false" title="Ver como tabla" aria-label="Ver ${esc(c.title)} como tabla"><i class="fas fa-table-list"></i></button>
        <button type="button" class="card-btn js-expand" title="Ampliar" aria-label="Ampliar ${esc(c.title)}"><i class="fas fa-up-right-and-down-left-from-center"></i></button>
        <button type="button" class="card-btn js-png" title="Descargar imagen PNG" aria-label="Descargar ${esc(c.title)} como imagen"><i class="fas fa-download"></i></button>
      </div>
    </header>
    <div class="card-body">
      <div class="plot plot-${c.size}">
        <canvas id="${c.id}" role="img" aria-label="${esc(c.title)}"></canvas>
        <div class="sk sk-plot" aria-hidden="true"></div>
      </div>
      ${c.size === "donut" ? `<ul class="donut-legend" data-legend="${c.id}"></ul>` : ""}
      <div class="table-view" data-tableview="${c.id}" hidden></div>
      <div class="empty-card" hidden>
        <i class="fas fa-filter-circle-xmark"></i>
        <p>No hay datos para esta combinación de filtros.</p>
        <button type="button" class="btn-chip js-clear">Limpiar filtros</button>
      </div>
    </div>
  </article>`;
}
function extraCard(x) {
  return `
  <article class="card extra-card span-${x.span}" id="card-${x.id}" data-extra="${x.id}">
    <header class="card-head">
      <div class="card-titles"><h3>${x.title}</h3><p>${x.sub}</p></div>
      <div class="card-actions">${infoBtn("extra:" + x.id, x.title)}${x.table ? `<button type="button" class="card-btn js-csv-table" data-table="${x.id}" title="Descargar esta tabla en CSV" aria-label="Descargar ${esc(x.title)} en CSV"><i class="fas fa-file-csv"></i></button>` : ""}</div>
    </header>
    <div class="card-body" id="${x.id}"><div class="sk sk-block"></div></div>
  </article>`;
}

/* =========================== MONTAJE DE GRÁFICOS =========================== */
function wire(spec, out, config) {
  config.options = config.options || {};
  config.options.onHover = (evt, els, chart) => {
    const e = els[0];
    const f = e ? { i: e.index, ds: e.datasetIndex } : null;
    const p = chart.$focus;
    if (spec.focus && ((p && p.i) !== (f && f.i) || (p && p.ds) !== (f && f.ds))) { chart.$focus = f; chart.update("none"); }
    chart.canvas.style.cursor = e && out.drill ? "pointer" : "default";
  };
  config.options.onClick = (evt, els) => {
    const e = els[0];
    if (!e || !out.drill) return;
    const cond = out.drill(e);
    if (cond) abrirDrill(cond.filter(Boolean));
  };
  return config;
}
function mountChart(spec, { force = false } = {}) {
  const canvas = $(spec.id);
  if (!canvas) return;
  const card = $("card-" + spec.id);
  let out;
  try { out = spec.build(state.d, state.tk, DS()); }
  catch (err) { console.error(`Gráfico ${spec.id}:`, err); out = { empty: true, emptyMsg: "No se pudo calcular este gráfico con los datos publicados." }; }
  outs[spec.id] = out;
  card.classList.toggle("is-empty", !!out.empty);
  card.querySelector(".empty-card").hidden = !out.empty;
  card.querySelector(".empty-card p").textContent = out.emptyMsg || "No hay datos para esta combinación de filtros.";
  card.querySelector(".empty-card .js-clear").hidden = !(filtrosActivos().length || hayFecha());
  const sub = card.querySelector(".card-titles p");
  const sb0 = spec.subFn ? spec.subFn() : sub.dataset.sub;
  sub.textContent = out.sub ? `${sb0} · ${out.sub}` : sb0;

  renderTabla(card.querySelector(`[data-tableview="${spec.id}"]`), "tv-" + spec.id, out.table);
  const leg = card.querySelector(`[data-legend="${spec.id}"]`);
  if (leg) renderDonutLegend(leg, spec, out);

  if (out.empty) { if (charts[spec.id]) { charts[spec.id].destroy(); delete charts[spec.id]; } return; }

  const config = wire(spec, out, out.config);
  const prev = charts[spec.id];
  if (prev && !force && prev.config.type === config.type && prev.data.datasets.length === config.data.datasets.length) {
    prev.data.labels = config.data.labels;
    config.data.datasets.forEach((ds, i) => { Object.assign(prev.data.datasets[i], ds); });
    prev.options = config.options;
    prev.$focus = null;
    prev.update();
    return;
  }
  if (prev) prev.destroy();
  charts[spec.id] = new Chart(canvas, config);
}
function renderDonutLegend(ul, spec, out) {
  if (!out.legend || out.empty) { ul.innerHTML = ""; return; }
  ul.innerHTML = out.legend.map((l) => `
    <li><button type="button" class="dl-item" data-chart="${spec.id}" data-index="${l.index}" title="${esc(l.full || l.label)}">
      <span class="dl-dot" style="background:${l.color}"></span>
      <span class="dl-label">${esc(l.label)}</span>
      <span class="dl-val">${l.value}</span>
      <span class="dl-pct">${fmt(l.pct, 1)} %</span>
    </button></li>`).join("");
}

/* =========================== TABLAS (orden, búsqueda y páginas) =========================== */
const COLL = new Intl.Collator("es", { numeric: true, sensitivity: "base" });
const cellVal = (c) => (c && typeof c === "object" && "v" in c ? c.v : c);
const cellTxt = (c) => (c && typeof c === "object" && "f" in c ? c.f : c);
/* Una tabla puede venir de dos formas:
   - rows: arreglo de filas ya armadas (tablas chicas)
   - src + cols: filas crudas y columnas {t, get, f, num, bar}; solo se formatea la página visible
     (así el detalle de 50 000 movimientos se abre al instante) */
function acceso(def) {
  if (def.src) {
    const C = def.cols;
    return {
      n: def.src.length,
      val: (i, c) => C[c].get(def.src[i]),
      txt: (i, c) => { const v = C[c].get(def.src[i]); return C[c].f ? C[c].f(v) : v ?? ""; },
      buscable: (i) => { const Q = def._qs || (def._qs = []); return Q[i] ?? (Q[i] = fold2(C.map((x) => x.get(def.src[i]) ?? "").join(" "))); },
      cond: (i) => (def.condFn ? def.condFn(def.src[i]) : null),
      head: C,
    };
  }
  return {
    n: def.rows.length,
    val: (i, c) => cellVal(def.rows[i][c]),
    txt: (i, c) => cellTxt(def.rows[i][c]),
    buscable: (i) => (def._txt || (def._txt = def.rows.map((r) => fold2(r.map(cellTxt).join(" ")))))[i],
    cond: (i) => (def.conds ? def.conds[i] : null),
    head: def.head,
  };
}
function renderTabla(container, id, def) {
  if (!container) return;
  tables[id] = { def, container };
  if (!def || !(def.src || def.rows) || !(def.src || def.rows).length) {
    container.innerHTML = `<p class="table-empty">${esc((def && def.empty) || "Sin filas para mostrar.")}</p>`;
    return;
  }
  def._a = acceso(def);
  let host = container.querySelector(":scope > .tbl-host");
  if (!host || !!container.querySelector(":scope > .tbl-tools") !== !!def.searchable) {
    container.innerHTML = (def.searchable
      ? `<div class="tbl-tools"><label class="tbl-search"><i class="fas fa-magnifying-glass"></i><input type="search" data-table="${id}" placeholder="Buscar en la tabla…" aria-label="Buscar en la tabla" autocomplete="off"></label><span class="tbl-count"></span></div>`
      : "") + `<div class="tbl-host"></div>`;
    host = container.querySelector(":scope > .tbl-host");
    const inp = container.querySelector(".tbl-search input");
    if (inp) inp.value = state.q[id] || "";
  }
  pintarTabla(id);
}

function pintarTabla(id) {
  const tb = tables[id]; if (!tb) return;
  const { def, container } = tb;
  const A = def._a;
  const host = container.querySelector(":scope > .tbl-host");
  if (!host || !A) return;
  const head = A.head;
  // Búsqueda (sin acentos ni mayúsculas)
  const q = fold2(state.q[id] || "").trim();
  let idx = [];
  for (let i = 0; i < A.n; i++) if (!q || A.buscable(i).includes(q)) idx.push(i);
  // Orden
  const s = state.sort[id] || def.defaultSort;
  if (s && s.col >= 0) {
    const vals = new Map(idx.map((i) => [i, A.val(i, s.col)]));
    idx.sort((a, b) => {
      const x = vals.get(a), y = vals.get(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      const r = typeof x === "number" && typeof y === "number" ? x - y : COLL.compare(String(x), String(y));
      return s.dir === "asc" ? r : -r;
    });
  }
  // Páginas
  const size = def.pageSize || idx.length || 1;
  const pages = Math.max(1, Math.ceil(idx.length / size));
  const page = Math.min(state.page[id] || 0, pages - 1);
  state.page[id] = page;
  const slice = idx.slice(page * size, page * size + size);

  const barCols = head.map((h, i) => (h.bar ? i : -1)).filter((i) => i >= 0);
  const maxes = {};
  barCols.forEach((c) => { let m = 1e-9; for (let i = 0; i < A.n; i++) { const v = Math.abs(Number(A.val(i, c)) || 0); if (v > m) m = v; } maxes[c] = m; });

  const count = container.querySelector(".tbl-count");
  if (count) count.textContent = q ? `${fmt(idx.length)} de ${fmt(A.n)} filas` : `${fmt(A.n)} filas`;

  host.innerHTML = (idx.length ? `<div class="tbl-wrap"><table class="tbl">
    <thead><tr>${head.map((h, i) => {
      const act = s && s.col === i;
      const dir = act ? (s.dir === "asc" ? "ascending" : "descending") : "none";
      return `<th class="${h.num ? "num" : ""}" aria-sort="${dir}"><button type="button" class="th-sort" data-table="${id}" data-col="${i}">${h.t}<i class="fas ${act ? (s.dir === "asc" ? "fa-arrow-up-short-wide" : "fa-arrow-down-wide-short") : "fa-sort"}"></i></button></th>`;
    }).join("")}</tr></thead>
    <tbody>${slice.map((ri) => {
      const cond = A.cond(ri);
      return `<tr ${cond ? `class="is-clickable" tabindex="0" data-table="${id}" data-row="${ri}"` : ""}>${head.map((h, ci) => {
        const f = A.txt(ri, ci);
        const bar = barCols.includes(ci) ? `<span class="cell-bar" style="--w:${Math.max(2, (Math.abs(Number(A.val(ri, ci)) || 0) / maxes[ci]) * 100)}%"></span>` : "";
        return `<td class="${h.num ? "num" : ""} ${ci === 0 ? "name" : ""}" ${String(f).length > 40 ? `title="${esc(f)}"` : ""}>${bar}<span>${esc(trunc(f, 60))}</span></td>`;
      }).join("")}</tr>`;
    }).join("")}</tbody></table></div>` : `<p class="table-empty">Ninguna fila coincide con «${esc(state.q[id])}».</p>`)
    + (pages > 1 ? `<div class="tbl-pager">
        <span>Filas ${fmt(page * size + 1)}–${fmt(Math.min(idx.length, page * size + size))} de ${fmt(idx.length)}</span>
        <div class="pager-btns">
          <button type="button" class="btn-chip js-page" data-table="${id}" data-page="0" ${page === 0 ? "disabled" : ""} aria-label="Primera página"><i class="fas fa-angles-left"></i></button>
          <button type="button" class="btn-chip js-page" data-table="${id}" data-page="${page - 1}" ${page === 0 ? "disabled" : ""} aria-label="Página anterior"><i class="fas fa-angle-left"></i></button>
          <span class="pager-n">Página ${fmt(page + 1)} de ${fmt(pages)}</span>
          <button type="button" class="btn-chip js-page" data-table="${id}" data-page="${page + 1}" ${page >= pages - 1 ? "disabled" : ""} aria-label="Página siguiente"><i class="fas fa-angle-right"></i></button>
          <button type="button" class="btn-chip js-page" data-table="${id}" data-page="${pages - 1}" ${page >= pages - 1 ? "disabled" : ""} aria-label="Última página"><i class="fas fa-angles-right"></i></button>
        </div></div>` : "");
}

/* =========================== FILTROS =========================== */
const conFecha = () => !!ENG().conFecha;
function filtrosActivos() { return FILTER_KEYS().filter((k) => state.filtros[k]); }
function hayFecha() { return !!(state.filtros.desde || state.filtros.hasta); }
function textoFecha() {
  const { desde, hasta } = state.filtros;
  if (!desde && !hasta) return "Todo el período";
  if (desde && desde === hasta) return fmtDiaLargo(desde);
  return `${fdia(desde || state.rango.min)} – ${fdia(hasta || state.rango.max)}`;
}
function fchip(k) {
  const cur = state.filtros[k], d = dimDef(k);
  return `<button type="button" class="fchip js-fopen ${cur ? "is-active" : ""}" data-dim="${k}" aria-haspopup="dialog" aria-expanded="false" title="${esc(cur || "Todos")}">
    <i class="fas ${d.icon}"></i><span class="fchip-label">${d.label}</span>
    <span class="fchip-value">${cur ? esc(cur) : "Todos"}</span><i class="fas fa-chevron-down fchip-caret" aria-hidden="true"></i></button>`;
}
function renderFiltros() {
  const fb = $("filterbar");
  const keys = FILTER_KEYS();
  const n = filtrosActivos().length + (hayFecha() ? 1 : 0);
  const more = keys.filter((k) => dimDef(k).group === "more");
  const masActivos = more.filter((k) => state.filtros[k]).length;
  fb.innerHTML = `
    <div class="fb-main">
      <span class="fb-title"><i class="fas fa-sliders"></i><span>Segmentadores</span>${n ? `<b class="fb-count">${n}</b>` : ""}</span>
      <div class="fb-chips">
        ${conFecha() ? `<button type="button" class="fchip js-fopen ${hayFecha() ? "is-active" : ""}" data-dim="fecha" aria-haspopup="dialog" aria-expanded="false">
          <i class="fas fa-calendar-days"></i><span class="fchip-label">${DS().fechaLabel || "Fecha"}</span><span class="fchip-value">${esc(textoFecha())}</span><i class="fas fa-chevron-down fchip-caret" aria-hidden="true"></i></button>` : ""}
        ${keys.filter((k) => dimDef(k).group === "main").map(fchip).join("")}
        ${more.length ? `<button type="button" class="fchip fchip-more js-more ${masActivos ? "is-active" : ""}" aria-expanded="${state.moreOpen}">
          <i class="fas ${state.moreOpen ? "fa-minus" : "fa-plus"}"></i><span class="fchip-value">${state.moreOpen ? "Menos filtros" : `Más filtros (${more.length})`}</span>${masActivos ? `<b class="fb-count">${masActivos}</b>` : ""}</button>` : ""}
      </div>
      <div class="fb-actions">
        <button type="button" class="btn-chip js-clear" ${n ? "" : "disabled"}><i class="fas fa-filter-circle-xmark"></i>Limpiar</button>
        <button type="button" class="btn-chip js-csv" title="Descargar el detalle en vista"><i class="fas fa-file-csv"></i>Exportar CSV</button>
      </div>
    </div>
    ${more.length ? `<div class="fb-more" ${state.moreOpen ? "" : "hidden"}>${more.map(fchip).join("")}</div>` : ""}`;
}

let fpState = { dim: null, btn: null };
const FP_MAX = 400; // opciones dibujadas a la vez; el buscador recorre todas
function abrirPanel(btn) {
  const dim = btn.dataset.dim;
  if (fpState.dim === dim) { cerrarPanel(); return; }
  cerrarPanel();
  const p = $("fpanel");
  if (dim === "fecha") {
    const meses = Array.from(new Set(state.dims.fechas.map((f) => f.slice(0, 7))));
    const { min, max } = state.rango;
    p.innerHTML = `
      <div class="fp-head"><b>${DS().fechaLabel || "Fecha"}</b><small>Datos del ${fdia(min)} al ${fdia(max)}</small></div>
      <div class="fp-presets">
        ${ENG().presetsFecha ? ENG().presetsFecha() : ""}
        <button type="button" class="fp-preset" data-preset="all">Todo el período</button>
        <button type="button" class="fp-preset" data-preset="30">Últimos 30 días</button>
        <button type="button" class="fp-preset" data-preset="90">Últimos 90 días</button>
        <button type="button" class="fp-preset" data-preset="year">Año de la última fecha</button>
        ${meses.map((m) => { const [y, mm] = m.split("-"); return `<button type="button" class="fp-preset" data-month="${m}">${MES_CORTO[+mm - 1]} ${y}</button>`; }).join("")}
      </div>
      <div class="fp-dates">
        <label>Desde<input type="date" id="fpDesde" min="${min}" max="${max}" value="${state.filtros.desde || min}"></label>
        <label>Hasta<input type="date" id="fpHasta" min="${min}" max="${max}" value="${state.filtros.hasta || max}"></label>
      </div>
      <div class="fp-foot"><button type="button" class="btn-primary js-fp-apply"><i class="fas fa-check"></i>Aplicar rango</button></div>`;
  } else {
    const def = dimDef(dim);
    const base = filtrar(state.filas, state.filtros, dim);
    const counts = new Map();
    base.forEach((r) => counts.set(r[dim], (counts.get(r[dim]) || 0) + 1));
    if ((ENG().vistaDims || []).includes(dim)) (state.dims[dim] || []).forEach((v) => counts.set(v, base.length));
    const all = (state.dims[dim] || []).slice();
    const vals = def.sort === "mes" || def.sortBy ? all : all.sort((a, b) => (counts.get(b) || 0) - (counts.get(a) || 0));
    const cur = state.filtros[dim];
    p._vals = vals; p._counts = counts; p._dim = dim;
    p.innerHTML = `
      <div class="fp-head"><b>${def.label}</b><small>${fmt(vals.length)} valores · el número es la cantidad de filas con los demás filtros</small></div>
      ${vals.length > 8 ? `<label class="fp-search"><i class="fas fa-magnifying-glass"></i><input type="search" id="fpSearch" placeholder="Buscar ${def.label.toLowerCase()}…" autocomplete="off" aria-label="Buscar"></label>` : ""}
      <ul class="fp-list" role="listbox" aria-label="${def.label}">
        <li><button type="button" role="option" class="fp-opt ${!cur ? "is-sel" : ""}" data-value="" aria-selected="${!cur}"><span>Todos</span><b>${fmt(base.length)}</b></button></li>
        ${fpOpciones(vals, counts, cur, "")}
      </ul>`;
  }
  p.dataset.dim = dim;
  p.hidden = false;
  fpState = { dim, btn };
  btn.setAttribute("aria-expanded", "true");
  posicionarPanel();
  requestAnimationFrame(() => {
    p.classList.add("show");
    const f = p.querySelector("#fpSearch") || p.querySelector(".fp-opt.is-sel") || p.querySelector(".fp-preset");
    if (f) f.focus({ preventScroll: true });
  });
}
function fpOpciones(vals, counts, cur, q) {
  const L = q ? vals.filter((v) => fold2(v).includes(q)) : vals;
  const shown = L.slice(0, FP_MAX);
  return shown.map((v) => { const c = counts.get(v) || 0; return `<li data-opt><button type="button" role="option" class="fp-opt ${v === cur ? "is-sel" : ""} ${c ? "" : "is-zero"}" data-value="${esc(v)}" aria-selected="${v === cur}" title="${esc(v)}"><span>${esc(v)}</span><b>${fmt(c)}</b></button></li>`; }).join("")
    + (L.length > shown.length ? `<li class="fp-more">Se muestran ${fmt(shown.length)} de ${fmt(L.length)}: escribí para encontrar el resto.</li>` : "")
    + (q && !L.length ? `<li class="fp-more">Ningún valor contiene «${esc(q)}».</li>` : "");
}
function filtrarPanel(q) {
  const p = $("fpanel");
  if (!p._vals) return;
  const list = p.querySelector(".fp-list");
  list.querySelectorAll("li[data-opt], li.fp-more").forEach((li) => li.remove());
  list.insertAdjacentHTML("beforeend", fpOpciones(p._vals, p._counts, state.filtros[p._dim], fold2(q).trim()));
}
function posicionarPanel() {
  const p = $("fpanel"), b = fpState.btn;
  if (!b || p.hidden) return;
  const r = b.getBoundingClientRect(), m = 10;
  const w = Math.min(fpState.dim === "fecha" ? 390 : 360, window.innerWidth - m * 2);
  p.style.width = w + "px";
  p.style.left = Math.min(window.innerWidth - w - m, Math.max(m, r.left)) + "px";
  const espacio = window.innerHeight - r.bottom - m - 8;
  p.style.top = r.bottom + 8 + "px";
  p.style.maxHeight = Math.max(240, espacio) + "px";
}
function cerrarPanel() {
  const p = $("fpanel");
  if (fpState.btn) fpState.btn.setAttribute("aria-expanded", "false");
  p.classList.remove("show"); p.hidden = true; p.dataset.dim = ""; p._vals = null;
  fpState = { dim: null, btn: null };
}
function aplicarPreset(btn) {
  const { min, max } = state.rango;
  let desde = "", hasta = "";
  const pr = btn.dataset.preset, mo = btn.dataset.month;
  if (btn.dataset.desde) { setFecha(btn.dataset.desde, btn.dataset.hasta); return; }   // período fijo (no se recorta al rango de datos)
  if (pr === "30") { desde = addDays(max, -29); hasta = max; }
  else if (pr === "90") { desde = addDays(max, -89); hasta = max; }
  else if (pr === "year") { desde = max.slice(0, 4) + "-01-01"; hasta = max; }
  else if (mo) { const [y, m] = mo.split("-").map(Number); desde = `${mo}-01`; hasta = toISO(new Date(y, m, 0)); }
  if (desde && desde < min) desde = min;
  if (hasta && hasta > max) hasta = max;
  if (desde === min && hasta === max) { desde = ""; hasta = ""; }
  setFecha(desde, hasta);
}
function setFecha(desde, hasta) {
  if (desde && hasta && desde > hasta) [desde, hasta] = [hasta, desde];
  state.filtros.desde = desde || "";
  state.filtros.hasta = hasta || "";
  cerrarPanel();
  render();
}
function setFiltro(k, v) {
  if (k === "fecha") { setFecha("", ""); return; }
  if (!FILTER_KEYS().includes(k)) return;
  state.filtros[k] = v || "";
  if (dimDef(k).group === "more" && v) state.moreOpen = true;
  cerrarPanel();
  render();
}
function limpiarFiltros() {
  state.filtros = { desde: "", hasta: "" };
  cerrarPanel();
  render();
}

/* =========================== CONTEXTO =========================== */

function renderContexto() {
  const s = secDef(state.seccion), ds = DS();
  const total = state.filas.length, enVista = state.vista.length;
  const chips = [];
  if (hayFecha()) chips.push({ k: "fecha", icon: "fa-calendar-days", label: "Fecha", val: textoFecha() });
  filtrosActivos().forEach((k) => chips.push({ k, icon: dimDef(k).icon, label: dimDef(k).label, val: state.filtros[k] }));

  $("crumbs").innerHTML = `
    <span class="crumb-sec"><i class="fas ${ds.icon}"></i>${ds.titulo}</span>
    <i class="fas fa-chevron-right crumb-sep" aria-hidden="true"></i>
    <span class="crumb-sec is-sub">${s.t}</span>
    <i class="fas fa-chevron-right crumb-sep" aria-hidden="true"></i>
    <span class="crumb-filters">${chips.length ? chips.map((c) => `${c.label}: <b>${esc(trunc(c.val, 28))}</b>`).join('<span class="crumb-dot"></span>') : "Todos los datos"}</span>`;

  $("contextBar").innerHTML = `
    <div class="ctx-main">
      <span class="ctx-pill"><i class="fas ${s.icon}"></i>Estás en <b>${ds.titulo} › ${s.t}</b></span>
      <span class="ctx-count">Mostrando <b>${fmt(enVista)}</b> de ${fmt(total)} ${ENG().unidad}${total ? ` · ${fmtPct((enVista / total) * 100, 0)}` : ""}${conFecha() ? ` · <b>${esc(textoFecha())}</b>` : ""}</span>
    </div>
    <div class="ctx-filters">
      ${chips.length
        ? chips.map((c) => `<button type="button" class="ctx-chip js-remove-filter" data-dim="${c.k}" title="Quitar este filtro"><i class="fas ${c.icon}"></i>${c.label}: <b>${esc(trunc(c.val, 34))}</b><i class="fas fa-xmark ctx-x"></i></button>`).join("")
        : `<span class="ctx-none"><i class="fas fa-layer-group"></i>Sin filtros: ves todos los datos</span>`}
    </div>`;
  $("contextBar").classList.toggle("has-filters", chips.length > 0);
  $("contextBar").classList.toggle("is-empty-view", total > 0 && enVista === 0);
  document.title = `${ds.titulo} · ${s.t}${chips.length ? " · " + chips.map((c) => trunc(c.val, 20)).join(" · ") : ""} | CORE Transporte`;
}

/* =========================== RENDER =========================== */
function render({ force = false } = {}) {
  if (!state.payload) return;
  state.tk = tokens();
  state.vista = filtrar(state.filas, state.filtros);
  state.d = ENG().calc(state.vista, state.filas);
  renderFiltros();
  renderContexto();
  writeHash();
  renderSeccion(state.seccion, { force });
}
function renderSeccion(sec, { force = false } = {}) {
  SEC_KEYS().forEach((k) => {
    const el = $("sec-" + k);
    const on = k === sec;
    if (on && el.hidden) { el.classList.remove("enter"); void el.offsetWidth; el.classList.add("enter"); }
    el.hidden = !on;
  });
  document.querySelectorAll("#dashTabs .tab").forEach((t) => {
    const on = t.dataset.seccion === sec;
    t.classList.toggle("active", on);
    t.setAttribute("aria-selected", on ? "true" : "false");
  });
  if (!state.payload || !state.d) return;
  if (secDef(sec).kpis) renderKPIs();
  SPECS.filter((c) => c.sec === sec).forEach((c) => mountChart(c, { force }));
  XSPECS.filter((x) => x.sec === sec).forEach((x) => {
    const el = $(x.id);
    try {
      if (x.render) x.render(state.d, el);
      else { if (el.querySelector(".sk")) el.innerHTML = ""; renderTabla(el, x.id, x.table(state.d)); }
    } catch (err) { console.error(`Tabla ${x.id}:`, err); el.innerHTML = `<p class="table-empty">No se pudo calcular esta tabla.</p>`; }
  });
}
function cambiarSeccion(sec) {
  if (!SEC_KEYS().includes(sec)) sec = SEC_KEYS()[0];
  const cambio = sec !== state.seccion;
  state.seccion = sec;
  cerrarPopover(); cerrarPanel();
  if (state.payload) renderContexto();
  writeHash();
  renderSeccion(sec, { force: cambio });
  renderBoardNav();
  if (cambio) window.scrollTo({ top: 0, behavior: REDUCED ? "auto" : "smooth" });
}

/* =========================== TABLEROS =========================== */
function guardarStore() { DS_FIELDS.forEach((f) => { STORE[state.ds][f] = state[f]; }); }
function cambiarDataset(key, { sec, filtros } = {}) {
  if (!DATASETS[key]) return;
  if (key === state.ds && !filtros) { if (sec) cambiarSeccion(sec); return; }
  cerrarPopover(); cerrarPanel(); cerrarDrill(); cerrarModal();
  guardarStore();
  state.ds = key;
  DS_FIELDS.forEach((f) => { state[f] = STORE[key][f]; });
  if (filtros) state.filtros = filtros;
  state.seccion = sec && SEC_KEYS().includes(sec) ? sec : state.seccion && SEC_KEYS().includes(state.seccion) ? state.seccion : SEC_KEYS()[0];
  state.vista = []; state.d = null;
  try { localStorage.setItem(CONFIG.LS_DATASET, key); } catch (_) {}
  construirLayout();
  const pub = PUB[DS().sheet];
  const vigente = state.payload && (!PUB._checked || (pub && firmaPub(pub) === state.signature));
  if (vigente) {
    mostrarEstadoGlobal(null);
    pintarStatus();
    render({ force: true });
  } else {
    if (PUB._checked && !pub) { state.payload = null; state.filas = []; pintarStatus(); mostrarEstadoGlobal("vacio"); writeHash(); renderSeccion(state.seccion); return; }
    document.body.classList.add("is-loading");
    mostrarEstadoGlobal(null);
    $("filterbar").innerHTML = ""; $("contextBar").innerHTML = "";
    renderSeccion(state.seccion);
    writeHash();
    cargarDatos("tablero");
  }
  window.scrollTo({ top: 0, behavior: "auto" });
}

/* =========================== URL (#tablero/sección?filtros) =========================== */
function leerHash() {
  const raw = location.hash.replace(/^#/, "");
  const [path, qs] = raw.split("?");
  const [ds, sec] = path.split("/").map((x) => decodeURIComponent(x || ""));
  const p = new URLSearchParams(qs || "");
  const filtros = {};
  p.forEach((v, k) => { filtros[k] = v; });
  return { ds: DATASETS[ds] ? ds : null, sec, filtros };
}
function writeHash() {
  const p = new URLSearchParams();
  ["desde", "hasta", ...FILTER_KEYS()].forEach((k) => { if (state.filtros[k]) p.set(k, state.filtros[k]); });
  const qs = p.toString();
  const url = new URL(location.href);
  url.searchParams.delete("t");
  url.searchParams.delete("v");
  url.hash = `${state.ds}/${state.seccion}` + (qs ? "?" + qs : "");
  if (url.href !== location.href) history.replaceState(null, "", url.href);
}

/* =========================== DRILL-DOWN =========================== */
let drillReturnFocus = null;

function abrirDrill(conds) {
  if (!conds || !conds.length || !state.d) return;
  cerrarPanel();
  const eng = ENG(), ds = DS();
  const rows = state.vista.filter((r) => conds.every((c) => matchCond(r, c)));
  const k = eng.agg(rows);
  const sk = eng.shareKey, tot = state.d.k[sk];
  const porValor = tot > 0 && k[sk] > 0;
  const share = porValor ? (k[sk] / tot) * 100 : state.d.k.n ? (k.n / state.d.k.n) * 100 : 0;
  $("drawerKicker").textContent = `${ds.titulo} · ${conds.map((c) => dimLabel(c.dim)).join(" · ")}`;
  $("drawerTitle").textContent = conds.map((c) => c.label || String(c.value)).join(" · ");

  const usados = new Set(conds.map((c) => (c.dim === "mesKey" ? "mes" : c.dim === "codigo" || c.dim === "set" ? "_nombre" : c.dim)));
  const [bdim, blabel] = eng.drillDims.find(([dm]) => !usados.has(dm) && rows.length && dm in rows[0] && new Set(rows.map((r) => r[dm])).size > 1) || [];
  let breakdown = null;
  if (bdim) {
    const list = bdim === "mes" ? porMes(rows) : porDim(rows, bdim, sk);
    const c0 = eng.drillCols(list[0]);
    breakdown = {
      head: [{ t: blabel }, ...c0.map((c, i) => ({ t: c[0], num: 1, bar: c[3] ? 1 : 0 }))],
      rows: list.map((x) => [bdim === "mes" ? cell(x.key, () => x.label) : x.label, ...eng.drillCols(x).map((c) => cell(c[1], c[2]))]),
      searchable: list.length > 15, pageSize: 15,
    };
  }
  $("drawerBody").innerHTML = `
    <div class="drill-share">
      <div class="drill-share-top"><span>Peso en ${porValor ? ENG().shareLabel : "las filas en vista"}</span><b>${fmtPct(share)}</b></div>
      <div class="kpi-bar"><i style="width:${Math.min(100, share)}%"></i></div>
      <small>${fmt(rows.length)} ${ENG().unidad} · ${conds.length > 1 ? "combinación seleccionada" : "dentro de los filtros actuales"}</small>
    </div>
    <dl class="drill-grid">${eng.drillMini(k).map(([a, b]) => `<div><dt>${a}</dt><dd>${b}</dd></div>`).join("")}</dl>
    ${breakdown ? `<h3 class="drill-sub">Desglose por ${blabel.toLowerCase()}</h3><div id="drillTable"></div>` : ""}`;
  if (breakdown) { state.page.drill = 0; state.q.drill = ""; renderTabla($("drillTable"), "drill", breakdown); }

  const aplicables = [];
  conds.forEach((c) => {
    if (c.dim === "mesKey") { if (FILTER_KEYS().includes("mes") && rows[0]) aplicables.push({ dim: "mes", value: rows[0].mes, label: rows[0].mes }); }
    else if (c.dim === "codigo" && FILTER_KEYS().includes("recurso") && rows[0]) aplicables.push({ dim: "recurso", value: rows[0].recurso, label: rows[0].recurso });
    else if (c.dim === "fecha" && conFecha()) aplicables.push({ dim: "fecha", value: c.value, label: fdia(c.value) });
    else if (FILTER_KEYS().includes(c.dim)) aplicables.push({ dim: c.dim, value: c.value, label: c.label || c.value });
  });
  $("drawerFoot").innerHTML = aplicables.length
    ? `<button type="button" class="btn-primary" id="drillApply"><i class="fas fa-filter"></i>Filtrar el tablero por ${esc(trunc(aplicables.map((a) => a.label).join(" + "), 56))}</button>
       <button type="button" class="btn-ghost" id="drillCancel">Cerrar</button>`
    : `<p class="drill-note"><i class="fas fa-circle-info"></i>${esc(dimLabel(conds[0].dim))} no es un segmentador de este tablero: esta vista es solo de detalle.</p>
       <button type="button" class="btn-ghost" id="drillCancel">Cerrar</button>`;
  const ap = $("drillApply");
  if (ap) ap.addEventListener("click", () => {
    aplicables.forEach((a) => { if (a.dim === "fecha") { state.filtros.desde = a.value; state.filtros.hasta = a.value; } else { state.filtros[a.dim] = a.value; if (dimDef(a.dim).group === "more") state.moreOpen = true; } });
    cerrarDrill(); render();
    toast(`Filtro aplicado: ${aplicables.map((a) => a.label).join(", ")}`, "info");
  });
  $("drillCancel").addEventListener("click", cerrarDrill);

  drillReturnFocus = document.activeElement;
  $("scrim").hidden = false;
  requestAnimationFrame(() => { document.body.classList.add("drawer-open"); $("drawer").setAttribute("aria-hidden", "false"); });
  setTimeout(() => $("drawerClose").focus(), 60);
}
function cerrarDrill() {
  if (!document.body.classList.contains("drawer-open")) return;
  document.body.classList.remove("drawer-open");
  $("drawer").setAttribute("aria-hidden", "true");
  setTimeout(() => { $("scrim").hidden = true; }, 280);
  if (drillReturnFocus && drillReturnFocus.focus) drillReturnFocus.focus();
}

/* =========================== POPOVER DE AYUDA =========================== */
let popState = { btn: null, pinned: false, timer: null };
function mostrarPopover(btn, pinned = false) {
  const info = INFO[btn.dataset.info];
  if (!info) return;
  const pop = $("popover");
  pop.innerHTML = `
    <p class="pop-title">${esc(info.title)}</p>
    <div class="pop-block"><span class="pop-label"><i class="fas fa-eye"></i>Qué muestra</span><p>${esc(info.what)}</p></div>
    <div class="pop-block"><span class="pop-label"><i class="fas fa-calculator"></i>Cómo se calcula</span><p>${esc(info.how)}</p></div>
    ${info.tip ? `<p class="pop-tip"><i class="fas fa-hand-pointer"></i>${esc(info.tip)}</p>` : ""}`;
  if (popState.btn && popState.btn !== btn) popState.btn.setAttribute("aria-expanded", "false");
  popState.btn = btn; popState.pinned = pinned;
  btn.setAttribute("aria-expanded", "true");
  pop.hidden = false;
  pop.classList.toggle("is-pinned", pinned);
  // Posición: debajo y alineado a la derecha del botón, sin salirse de la pantalla
  const r = btn.getBoundingClientRect(), pw = pop.offsetWidth, ph = pop.offsetHeight, m = 10;
  let left = Math.min(window.innerWidth - pw - m, Math.max(m, r.right - pw + 8));
  let top = r.bottom + 8, above = false;
  if (top + ph > window.innerHeight - m) { top = r.top - ph - 8; above = true; }
  pop.style.left = left + "px"; pop.style.top = Math.max(m, top) + "px";
  pop.style.setProperty("--arrow-x", Math.min(pw - 14, Math.max(14, r.left + r.width / 2 - left)) + "px");
  pop.classList.toggle("above", above);
  pop.classList.remove("show"); void pop.offsetWidth; pop.classList.add("show");
}
function cerrarPopover() {
  const pop = $("popover");
  if (popState.btn) popState.btn.setAttribute("aria-expanded", "false");
  popState = { btn: null, pinned: false, timer: null };
  pop.classList.remove("show"); pop.hidden = true;
}


/* =========================== MODAL (ampliar) =========================== */
let modalChart = null, modalReturnFocus = null;
function abrirModal(id) {
  const spec = SPECS.find((c) => c.id === id);
  if (!spec || !state.d) return;
  const out = spec.build(state.d, state.tk, DS());
  if (out.empty) { toast("No hay datos para ampliar con estos filtros.", "info"); return; }
  $("modalTitle").textContent = spec.title;
  const ctx = filtrosActivos().map((k) => `${dimLabel(k)}: ${state.filtros[k]}`).join(" · ");
  $("modalSub").textContent = `${DS().titulo} · ${spec.subFn ? spec.subFn() : spec.sub}${ctx ? " · " + ctx : ""}`;
  modalReturnFocus = document.activeElement;
  $("modal").hidden = false;
  document.body.classList.add("modal-open");
  if (modalChart) modalChart.destroy();
  const cfg = wire(spec, out, out.config);
  if (cfg.type === "doughnut") cfg.options.plugins.legend = merge(legendCfg(state.tk, true), { position: "right" });
  if (cfg.type === "bar" && cfg.options.indexAxis === "y") cfg.options.scales.y.ticks.callback = function (v) { const l = this && this.getLabelForValue ? this.getLabelForValue(v) : v; return trunc(l, 60); };
  modalChart = new Chart($("modalCanvas"), cfg);
  setTimeout(() => $("modalClose").focus(), 30);
}
function cerrarModal() {
  if ($("modal").hidden) return;
  $("modal").hidden = true;
  document.body.classList.remove("modal-open");
  if (modalChart) { modalChart.destroy(); modalChart = null; }
  if (modalReturnFocus && modalReturnFocus.focus) modalReturnFocus.focus();
}

/* =========================== EXPORTAR =========================== */
function descargarPNG(id) {
  const ch = charts[id];
  const spec = SPECS.find((c) => c.id === id);
  if (!ch || !spec) { toast("Este gráfico no tiene datos para exportar.", "info"); return; }
  const a = document.createElement("a");
  a.href = ch.toBase64Image("image/png", 1);
  a.download = `${slug(DS().titulo)}_${slug(spec.title)}_${new Date().toISOString().slice(0, 10)}.png`;
  document.body.appendChild(a); a.click(); a.remove();
  toast(`Imagen descargada: ${spec.title}`, "ok", 2600);
}
function descargarCSV(def, nombre) {
  const q = (v) => { const s = v == null ? "" : String(v); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const A = acceso(def);
  const val = (i, c) => { const v = A.val(i, c); return typeof v === "string" && v.startsWith("(") ? "" : v; };
  const lines = [A.head.map((h) => q(h.t)).join(",")];
  for (let i = 0; i < A.n; i++) lines.push(A.head.map((_, c) => q(val(i, c))).join(","));
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const suf = [state.filtros.desde, state.filtros.hasta, ...filtrosActivos().map((k) => slug(trunc(state.filtros[k], 24)))].filter(Boolean).join("_");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${nombre}${suf ? "_" + suf : ""}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast(`CSV descargado: ${fmt(A.n)} filas`, "ok", 2600);
}
function exportarCSV(id) {
  if (!state.d) return;
  const det = id || DS().secs.flatMap((s) => s.items.map((i) => i[0])).find((x) => /^tDet/.test(x));
  const x = TLIB[det];
  if (!x) return;
  descargarCSV(x.table(state.d), `${slug(DS().titulo)}_${slug(txt(x.title))}`);
}

/* =========================== TOASTS =========================== */
function toast(texto, tipo = "info", ms = 4200) {
  const t = document.createElement("div");
  t.className = `toast ${tipo}`;
  const ico = { ok: "fa-circle-check", error: "fa-circle-exclamation", info: "fa-circle-info", new: "fa-bolt" }[tipo] || "fa-circle-info";
  t.innerHTML = `<i class="fas ${ico}"></i><span>${esc(texto)}</span><button type="button" class="toast-x" aria-label="Cerrar aviso"><i class="fas fa-xmark"></i></button>`;
  const close = () => { t.classList.add("out"); setTimeout(() => t.remove(), 260); };
  t.querySelector(".toast-x").addEventListener("click", close);
  $("toasts").appendChild(t);
  setTimeout(close, ms);
}

/* =========================== DATOS: CARGA Y SINCRONIZACIÓN =========================== */
function firma(rowIndex, meta) { return `${rowIndex}|${(meta && meta.uploadedAt) || "legacy"}`; }
const firmaPub = (pub) => (pub ? firma(pub.row_index, pub.meta) : null);

// Consulta liviana: la última versión de cada tablero (sin traer los datos)
async function consultarPublicados() {
  const sheets = DS_KEYS.map((k) => DATASETS[k].sheet);
  const { data, error } = await sb.from(CONFIG.TABLE)
    .select("sheet_name, row_index, meta:data->meta")
    .in("sheet_name", sheets)
    .order("row_index", { ascending: false });
  if (error) throw error;
  const ult = {};
  (data || []).forEach((r) => { if (!ult[r.sheet_name]) ult[r.sheet_name] = r; });
  sheets.forEach((s) => { PUB[s] = ult[s] || null; });
  PUB._checked = true;
  // Los tableros guardados en memoria con una versión vieja se vuelven a leer al abrirlos
  DS_KEYS.forEach((k) => {
    if (k === state.ds) return;
    const st = STORE[k], pub = PUB[DATASETS[k].sheet];
    if (st.signature && (!pub || firmaPub(pub) !== st.signature)) { st.payload = null; st.filas = []; st.signature = null; }
  });
  renderBoardNav();
  return PUB;
}

async function fetchDataset(key) {
  const { data, error } = await sb.from(CONFIG.TABLE)
    .select("row_index, data")
    .eq("sheet_name", DATASETS[key].sheet)
    .order("row_index", { ascending: false })
    .limit(1);
  if (error) throw error;
  return data && data[0] ? data[0] : null;
}

function setSync(modo, texto) {
  const s = $("syncStatus");
  s.dataset.mode = modo;
  $("syncText").textContent = texto;
}
function pintarSync() {
  if (!state.lastSync) return;
  if ($("syncStatus").dataset.mode === "error") return;
  setSync("live", `En vivo · ${relTime(state.lastSync)}`);
  $("stSync").textContent = relTime(state.lastSync);
  if (state.uploadedAt) { $("stPublicado").textContent = relTime(state.uploadedAt); const bm = $("bhMeta"); if (bm) bm.innerHTML = `<i class="fas fa-cloud-arrow-up"></i>Publicado ${relTime(state.uploadedAt)}`; }
}
function pintarStatus() {
  const m = (state.payload && state.payload.meta) || {};
  $("stArchivo").textContent = m.archivo || "—";
  $("stArchivo").title = m.archivo || "";
  $("stHoja").textContent = m.hoja || DS().tab;
  $("stRegistros").textContent = state.payload ? fmt(state.filas.length) : "—";
  $("stPeriodo").textContent = state.rango.min ? `${fdia(state.rango.min)} – ${fdia(state.rango.max)}` : m.desde ? `${fdia(m.desde)} – ${fdia(m.hasta)}` : "—";
  $("stPublicado").textContent = state.uploadedAt ? relTime(state.uploadedAt) : "—";
  $("stPublicado").title = state.uploadedAt ? new Date(state.uploadedAt).toLocaleString("es-PE") : "";
  const bm = $("bhMeta");
  if (bm) bm.innerHTML = state.uploadedAt ? `<i class="fas fa-cloud-arrow-up"></i>Publicado ${relTime(state.uploadedAt)}${m.archivo ? ` · <span title="${esc(m.archivo)}">${esc(trunc(m.archivo, 34))}</span>` : ""}` : "";
}

/**
 * Carga completa del tablero actual desde Supabase.
 * motivo: "inicial" | "manual" | "nuevo" | "aviso" | "visible" | "tablero"
 * opts.expect: versión (row_index) que se acaba de publicar. Si Supabase todavía
 *   devuelve una anterior (lectura atrasada), se reintenta unos segundos.
 * Un pedido que llega mientras otro está en curso no se pierde: se repite al terminar.
 */
const versionDe = (row) => (row ? Number(row.row_index) || 0 : 0);
function cargarDatos(motivo = "inicial", opts = {}) {
  if (opts.expect) state.expect = Math.max(state.expect || 0, Number(opts.expect) || 0);
  if (state.loading) {
    state.pendiente = motivo === "manual" || !state.pendiente ? motivo : state.pendiente;
    return state.loading;
  }
  const key = state.ds;
  const inicial = !state.payload;
  document.body.classList.add(inicial ? "is-loading" : "is-refreshing");
  document.querySelectorAll(".js-refresh").forEach((b) => { b.disabled = true; b.classList.add("is-loading"); });
  setSync("syncing", "Sincronizando…");

  state.loading = (async () => {
    try {
      const firmaPrev = state.signature;
      await consultarPublicados().catch((e) => console.warn("Consulta de tableros falló:", e));
      let row = await fetchDataset(key);
      const atrasado = () => !!state.expect && (!row || (versionDe(row) > 0 && versionDe(row) < state.expect));
      const debeEsperar = () => (!row && (motivo === "aviso" || motivo === "nuevo" || !!state.payload)) || atrasado();
      for (let i = 0; debeEsperar() && i < 6; i++) {
        setSync("syncing", "Esperando la versión recién publicada…");
        await sleep(450 * (i + 1));
        row = await fetchDataset(key);
      }
      if (state.expect) { if (atrasado()) console.warn("Supabase todavía devuelve una versión anterior a", state.expect); state.expect = 0; }
      if (key !== state.ds) return;          // el usuario cambió de tablero mientras cargaba
      const nueva = row ? firma(row.row_index, row.data && row.data.meta) : null;
      const cambio = nueva !== firmaPrev;
      if (cambio || motivo === "manual" || !state.payload) await aplicarRow(row, { fresh: cambio && !!firmaPrev });
      state.lastSync = new Date();
      state.error = null;
      setSync("live", "En vivo");
      pintarSync();
      renderBoardNav();
      if (motivo === "manual") toast(cambio ? "Datos actualizados desde Supabase." : "Ya tienes los datos más recientes.", "ok", 2800);
      else if (motivo !== "inicial" && firmaPrev && cambio) toast(`Llegó una versión nueva de «${DS().titulo}»: el tablero se actualizó.`, "new", 5000);
    } catch (err) {
      console.error(err);
      state.error = err;
      setSync("error", "Sin conexión · reintentando");
      if (!state.payload) mostrarEstadoGlobal("error", err);
      else if (motivo === "manual") toast("No se pudo actualizar: " + (err.message || err), "error", 6000);
    } finally {
      document.body.classList.remove("is-loading", "is-refreshing");
      document.querySelectorAll(".js-refresh").forEach((b) => { b.disabled = false; b.classList.remove("is-loading"); });
      state.loading = null;
      if (state.pendiente) { const p = state.pendiente; state.pendiente = null; setTimeout(() => cargarDatos(p), 0); }
    }
  })();
  return state.loading;
}

async function aplicarRow(row, { fresh = false } = {}) {
  const ds = DS();
  const enc = row && row.data ? await descomprimir(row.data) : null;
  const filas = enc ? decodificar(enc) : [];
  if (!filas.length) {
    state.payload = null; state.filas = []; state.signature = row ? firma(row.row_index, row.data && row.data.meta) : null;
    state.rango = { min: "", max: "" }; state.uploadedAt = null;
    Object.keys(charts).forEach((id) => { charts[id].destroy(); delete charts[id]; });
    pintarStatus();
    mostrarEstadoGlobal("vacio");
    guardarStore();
    return;
  }
  const meta = row.data.meta || {};
  state.signature = firma(row.row_index, meta);
  state.payload = { meta, kpis: row.data.kpis };
  state.uploadedAt = meta.uploadedAt || null;
  state.filas = ENGINES[ds.engine].prep(filas, meta, ds);
  state.dims = calcDims(state.filas);
  state.rango = { min: state.dims.fechas[0] || "", max: state.dims.fechas[state.dims.fechas.length - 1] || "" };

  FILTER_KEYS().forEach((k) => { if (state.filtros[k] && !(state.dims[k] || []).includes(state.filtros[k])) state.filtros[k] = ""; });
  if (state.filtros.desde && state.filtros.desde > state.rango.max) state.filtros.desde = "";
  if (state.filtros.hasta && state.filtros.hasta < state.rango.min) state.filtros.hasta = "";
  Object.keys(state.page).forEach((k) => { state.page[k] = 0; });

  pintarStatus();
  mostrarEstadoGlobal(null);
  render({ force: true });
  guardarStore();
  if (fresh && !REDUCED) {
    document.body.classList.remove("is-fresh"); void document.body.offsetWidth;
    document.body.classList.add("is-fresh");
    setTimeout(() => document.body.classList.remove("is-fresh"), 1500);
  }
}

function mostrarEstadoGlobal(tipo, err) {
  const g = $("globalState");
  document.body.classList.toggle("no-data", !!tipo);
  if (!tipo) { g.innerHTML = ""; return; }
  SEC_KEYS().forEach((k) => { const s = $("sec-" + k); if (s) s.hidden = true; });
  $("filterbar").innerHTML = ""; $("contextBar").innerHTML = ""; cerrarPanel();
  const ds = DS();
  $("crumbs").innerHTML = `<span class="crumb-sec"><i class="fas ${ds.icon}"></i>${ds.titulo}</span><i class="fas fa-chevron-right crumb-sep"></i><span class="crumb-filters">Sin datos</span>`;
  const otros = DS_KEYS.filter((k) => k !== state.ds && PUB[DATASETS[k].sheet]);
  g.innerHTML = tipo === "vacio"
    ? `<div class="global-empty">
         <span class="ge-ico"><i class="fas fa-file-excel"></i></span>
         <h2>«${ds.titulo}» todavía no tiene datos</h2>
         <p>Cargá el Excel <b>${esc(FILES[ds.file].excel)}</b> (pestaña «${esc(ds.tab)}») en la pantalla de inicio. Apenas lo publiques, este tablero se actualiza solo.</p>
         <a class="btn-primary js-go-home" href="${CONFIG.HOME_URL}"><i class="fas fa-file-arrow-up"></i>Cargar Excel</a>
         ${otros.length ? `<p class="ge-alt">Con datos ahora: ${otros.map((k) => `<a href="#${k}/${DATASETS[k].secs[0].k}" class="ge-link" data-ds="${k}">${DATASETS[k].titulo}</a>`).join(" · ")}</p>` : ""}
       </div>`
    : `<div class="global-empty is-error">
         <span class="ge-ico"><i class="fas fa-plug-circle-xmark"></i></span>
         <h2>No se pudo leer el tablero</h2>
         <p>${esc((err && err.message) || "Revisá tu conexión a internet.")}</p>
         <button type="button" class="btn-primary js-refresh"><i class="fas fa-rotate"></i>Reintentar</button>
       </div>`;
}

/* Chequeo liviano: solo trae la versión de cada tablero, no los datos */
async function hayNovedades() {
  if (state.loading || document.visibilityState !== "visible") return;
  try {
    await consultarPublicados();
    state.lastSync = new Date();
    if (state.error) { state.error = null; setSync("live", "En vivo"); }
    const pub = PUB[DS().sheet];
    if (!pub) { if (state.payload) await cargarDatos("nuevo"); else pintarSync(); return; }
    if (firmaPub(pub) !== state.signature) await cargarDatos("nuevo");
    else pintarSync();
  } catch (err) {
    console.warn("Chequeo de novedades falló:", err);
    setSync("error", "Sin conexión · reintentando");
  }
}
const hayNovedadesDebounced = debounce(hayNovedades, 400);

function iniciarSincronizacion() {
  let ultimoAviso = 0;
  const alAviso = (msg) => {
    if (!msg || msg.type !== "data-updated" || msg.at === ultimoAviso) return;   // llega por BroadcastChannel y por storage
    ultimoAviso = msg.at;
    const sheets = msg.sheets || [];
    if (!sheets.length || sheets.includes(DS().sheet)) cargarDatos("aviso", { expect: msg.version });
    else consultarPublicados().catch(() => {});
  };
  // 1) Aviso inmediato desde la pestaña de carga (mismo navegador), con el número de versión publicado
  try { const bc = new BroadcastChannel(CONFIG.BUS); bc.onmessage = (e) => alAviso(e.data); } catch (_) {}
  window.addEventListener("storage", (e) => { if (e.key === CONFIG.LS_UPLOAD && e.newValue) { try { alAviso(JSON.parse(e.newValue)); } catch (_) {} } });
  // 2) Supabase Realtime (si está habilitado para la tabla; si no, no molesta)
  try { sb.channel("core-transporte-data").on("postgres_changes", { event: "*", schema: "public", table: CONFIG.TABLE }, () => hayNovedadesDebounced()).subscribe(); } catch (_) {}
  // 3) Al volver a la pestaña / ventana. Si estuvo oculta más que el sondeo, se relee completo
  let ocultaDesde = 0;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") { ocultaDesde = Date.now(); return; }
    if (ocultaDesde && Date.now() - ocultaDesde > CONFIG.POLL_MS) cargarDatos("visible"); else hayNovedadesDebounced();
    ocultaDesde = 0;
  });
  window.addEventListener("focus", hayNovedadesDebounced);
  // 4) Restaurado desde el historial (bfcache: botón Atrás/Adelante): siempre se relee
  window.addEventListener("pageshow", (e) => { if (e.persisted) cargarDatos("visible"); });
  // 5) Sondeo liviano (solo la versión, no los datos)
  setInterval(hayNovedades, CONFIG.POLL_MS);
  setInterval(pintarSync, 15000);
  // 6) Vuelve la red
  window.addEventListener("online", () => cargarDatos("visible"));
}

/* =========================== TEMA =========================== */
function setTheme(t, { rerender = true } = {}) {
  document.documentElement.setAttribute("data-theme", t);
  try { localStorage.setItem(CONFIG.LS_THEME, t); } catch (_) {}
  const b = $("btnTheme");
  b.innerHTML = `<i class="fas ${t === "dark" ? "fa-sun" : "fa-moon"}"></i>`;
  b.title = `Cambiar a tema ${t === "dark" ? "claro" : "oscuro"} (tecla T)`;
  if (rerender && state.payload) render({ force: true });
}
function toggleTheme() { setTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark"); }

/* =========================== EVENTOS =========================== */
function engancharEventos() {
  document.addEventListener("click", (e) => {
    const t = e.target;
    const board = t.closest(".board[data-ds], .ge-link[data-ds]");
    if (board) { e.preventDefault(); cambiarDataset(board.dataset.ds); return; }
    const tab = t.closest("#dashTabs .tab");
    if (tab) { e.preventDefault(); cambiarSeccion(tab.dataset.seccion); return; }

    const home = t.closest(".js-go-home");
    if (home) { e.preventDefault(); window.location.href = `${CONFIG.HOME_URL}?t=${Date.now()}`; return; }

    if (t.closest(".js-refresh")) { cargarDatos("manual"); return; }
    if (t.closest("#btnTheme")) { toggleTheme(); return; }

    const info = t.closest(".js-info");
    if (info) {
      e.stopPropagation();
      if (popState.btn === info && popState.pinned) cerrarPopover(); else mostrarPopover(info, true);
      return;
    }
    if (!t.closest("#popover") && popState.pinned) cerrarPopover();

    const fo = t.closest(".js-fopen");
    if (fo) { e.stopPropagation(); abrirPanel(fo); return; }
    if (t.closest(".js-more")) { state.moreOpen = !state.moreOpen; cerrarPanel(); renderFiltros(); return; }
    const opt = t.closest(".fp-opt");
    if (opt) { setFiltro($("fpanel").dataset.dim, opt.dataset.value); return; }
    const pre = t.closest(".fp-preset");
    if (pre) { aplicarPreset(pre); return; }
    if (t.closest(".js-fp-apply")) { setFecha($("fpDesde").value, $("fpHasta").value); return; }
    if (!t.closest("#fpanel") && fpState.dim) cerrarPanel();

    const pg = t.closest(".js-page");
    if (pg) { state.page[pg.dataset.table] = +pg.dataset.page; pintarTabla(pg.dataset.table); return; }

    if (t.closest(".js-clear")) { limpiarFiltros(); return; }
    if (t.closest(".js-csv")) { exportarCSV(); return; }
    const csvT = t.closest(".js-csv-table");
    if (csvT) { exportarCSV(csvT.dataset.table); return; }
    const rm = t.closest(".js-remove-filter");
    if (rm) { setFiltro(rm.dataset.dim, ""); return; }

    const card = t.closest(".chart-card");
    if (card && t.closest(".js-table")) {
      const btn = t.closest(".js-table");
      const on = !card.classList.contains("show-table");
      card.classList.toggle("show-table", on);
      card.querySelector(".table-view").hidden = !on;
      btn.setAttribute("aria-pressed", on ? "true" : "false");
      btn.innerHTML = `<i class="fas ${on ? "fa-chart-simple" : "fa-table-list"}"></i>`;
      btn.title = on ? "Ver como gráfico" : "Ver como tabla";
      return;
    }
    if (card && t.closest(".js-expand")) { abrirModal(card.dataset.chart); return; }
    if (card && t.closest(".js-png")) { descargarPNG(card.dataset.chart); return; }

    const dl = t.closest(".dl-item");
    if (dl) {
      const out = outs[dl.dataset.chart];
      const cond = out && out.drill && out.drill({ index: +dl.dataset.index, datasetIndex: 0 });
      if (cond) abrirDrill(cond);
      return;
    }
    const th = t.closest(".th-sort");
    if (th) {
      const id = th.dataset.table, col = +th.dataset.col;
      const s = state.sort[id];
      state.sort[id] = s && s.col === col ? { col, dir: s.dir === "desc" ? "asc" : "desc" } : { col, dir: "desc" };
      state.page[id] = 0;
      pintarTabla(id);
      return;
    }
    const tr = t.closest("tr.is-clickable");
    if (tr) { const tb = tables[tr.dataset.table]; const c = tb && tb.def._a && tb.def._a.cond(+tr.dataset.row); if (c) abrirDrill(c); return; }

    const ins = t.closest(".insight-btn[data-insight]");
    if (ins) { const host = ins.closest(".card-body"); const c = host && host._conds && host._conds[+ins.dataset.insight]; if (c) abrirDrill(c); return; }

    if (t.closest("#drawerClose") || t.closest("#scrim")) { cerrarDrill(); return; }
    if (t.closest("#modalClose") || t === $("modal")) { cerrarModal(); return; }
  });

  const buscarTabla = debounce((id) => { state.page[id] = 0; pintarTabla(id); }, 180);
  const buscarPanel = debounce((q) => filtrarPanel(q), 120);
  document.addEventListener("input", (e) => {
    const ts = e.target.closest(".tbl-search input");
    if (ts) { state.q[ts.dataset.table] = ts.value; buscarTabla(ts.dataset.table); return; }
    if (e.target.id === "fpSearch") buscarPanel(e.target.value);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.id === "fpSearch") {
      const first = document.querySelector("#fpanel .fp-list li[data-opt] .fp-opt");
      if (first) { e.preventDefault(); first.click(); }
    }
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && e.target.closest && e.target.closest("#fpanel")) {
      const items = Array.from(document.querySelectorAll("#fpanel .fp-opt, #fpanel #fpSearch"));
      const i = items.indexOf(document.activeElement);
      const nxt = items[Math.max(0, Math.min(items.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))];
      if (nxt) { e.preventDefault(); nxt.focus(); }
    }
  });

  document.addEventListener("mouseover", (e) => {
    const b = e.target.closest(".js-info");
    if (!b || popState.pinned) return;
    clearTimeout(popState.timer);
    popState.timer = setTimeout(() => mostrarPopover(b, false), 140);
  });
  document.addEventListener("mouseout", (e) => {
    const b = e.target.closest(".js-info");
    if (!b || popState.pinned) return;
    clearTimeout(popState.timer);
    if (!e.relatedTarget || !e.relatedTarget.closest || !e.relatedTarget.closest(".js-info")) cerrarPopover();
  });
  document.addEventListener("focusin", (e) => { const b = e.target.closest && e.target.closest(".js-info"); if (b && !popState.pinned) mostrarPopover(b, false); });
  document.addEventListener("focusout", (e) => { const b = e.target.closest && e.target.closest(".js-info"); if (b && !popState.pinned) cerrarPopover(); });
  window.addEventListener("scroll", () => { if (popState.btn && !popState.pinned) cerrarPopover(); posicionarPanel(); }, { passive: true });
  window.addEventListener("resize", debounce(() => { if (popState.btn) mostrarPopover(popState.btn, popState.pinned); posicionarPanel(); }, 100));

  document.addEventListener("mouseover", (e) => {
    const dl = e.target.closest(".dl-item");
    if (!dl) return;
    const ch = charts[dl.dataset.chart];
    if (!ch) return;
    const i = +dl.dataset.index;
    ch.$focus = { i, ds: 0 };
    ch.setActiveElements([{ datasetIndex: 0, index: i }]);
    ch.tooltip.setActiveElements([{ datasetIndex: 0, index: i }], { x: 0, y: 0 });
    ch.update("none");
  });
  document.addEventListener("mouseout", (e) => {
    const dl = e.target.closest(".dl-item");
    if (!dl || (e.relatedTarget && dl.contains(e.relatedTarget))) return;
    const ch = charts[dl.dataset.chart];
    if (!ch) return;
    ch.$focus = null; ch.setActiveElements([]); ch.tooltip.setActiveElements([], { x: 0, y: 0 }); ch.update("none");
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (fpState.dim) { const b = fpState.btn; cerrarPanel(); if (b) b.focus(); return; }
      cerrarPopover(); cerrarDrill(); cerrarModal(); return;
    }
    const tr = e.target.closest && e.target.closest("tr.is-clickable");
    if (tr && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); tr.click(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) || e.target.isContentEditable) return;
    if (document.body.classList.contains("drawer-open") || document.body.classList.contains("modal-open")) return;
    const secs = SEC_KEYS();
    if (e.key >= "1" && e.key <= String(secs.length)) cambiarSeccion(secs[+e.key - 1]);
    else if (e.key === "[" || e.key === "]") { const i = DS_KEYS.indexOf(state.ds); cambiarDataset(DS_KEYS[(i + (e.key === "]" ? 1 : DS_KEYS.length - 1)) % DS_KEYS.length]); }
    else if (e.key === "r" || e.key === "R") cargarDatos("manual");
    else if (e.key === "t" || e.key === "T") toggleTheme();
  });

  window.addEventListener("hashchange", () => {
    const h = leerHash();
    if (h.ds && h.ds !== state.ds) { cambiarDataset(h.ds, { sec: h.sec, filtros: { desde: "", hasta: "", ...h.filtros } }); return; }
    const f = { desde: "", hasta: "", ...h.filtros };
    const same = ["desde", "hasta", ...FILTER_KEYS()].every((k) => (state.filtros[k] || "") === (f[k] || ""));
    if (!same) { state.filtros = f; if (h.sec && SEC_KEYS().includes(h.sec)) state.seccion = h.sec; render(); }
    else if (h.sec && h.sec !== state.seccion) cambiarSeccion(h.sec);
  });

  try {
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (ev) => {
      let saved = null; try { saved = localStorage.getItem(CONFIG.LS_THEME); } catch (_) {}
      if (!saved) setTheme(ev.matches ? "dark" : "light");
    });
  } catch (_) {}
}

/* =========================== EXTRAS: enlace, pantalla completa, mapa de calor, calidad =========================== */
async function copiarEnlace() {
  const url = location.href;
  try { await navigator.clipboard.writeText(url); }
  catch (_) {
    const ta = document.createElement("textarea"); ta.value = url; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); } catch (__) {} ta.remove();
  }
  toast("Enlace copiado: abre el tablero con esta pestaña y estos filtros.", "ok", 3200);
}
function toggleFull() {
  try {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen();
  } catch (_) { toast("Tu navegador no permite pantalla completa aquí.", "info"); }
}
function engancharExtras() {
  document.addEventListener("click", (e) => {
    const hc = e.target.closest(".heat-cell[data-fecha]");
    if (hc) { abrirDrill([{ dim: "fecha", value: hc.dataset.fecha, label: fmtDiaLargo(hc.dataset.fecha) }]); return; }
    const q = e.target.closest(".q-item[data-flag]");
    if (q && !q.disabled) { abrirDrill([{ dim: "flag", value: q.dataset.flag, label: q.querySelector(".q-label").textContent }]); return; }
    if (e.target.closest("#btnLink")) { copiarEnlace(); return; }
    if (e.target.closest("#btnFull")) { toggleFull(); }
  });
  document.addEventListener("fullscreenchange", () => {
    const b = $("btnFull"); if (!b) return;
    const on = !!document.fullscreenElement;
    b.innerHTML = `<i class="fas ${on ? "fa-compress" : "fa-expand"}"></i>`;
    b.title = on ? "Salir de pantalla completa (tecla F)" : "Pantalla completa (tecla F)";
  });
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) || e.target.isContentEditable) return;
    if (document.body.classList.contains("drawer-open") || document.body.classList.contains("modal-open")) return;
    if (e.key === "f" || e.key === "F") toggleFull();
    else if (e.key === "l" || e.key === "L") copiarEnlace();
  });
}

/* =========================== INICIO =========================== */
(async function init() {
  setupChartDefaults();
  // Versión recién publicada: llega en la URL (?v=) desde index.html o en el aviso guardado
  const qs = new URLSearchParams(location.search);
  let expect = Number(qs.get("v")) || 0;
  try {
    const u = JSON.parse(localStorage.getItem(CONFIG.LS_UPLOAD) || "null");
    if (u && u.version && Date.now() - (u.at || 0) < 10 * 60000) expect = Math.max(expect, Number(u.version) || 0);
  } catch (_) {}
  const h = leerHash();
  let ini = h.ds;
  if (!ini) { try { ini = localStorage.getItem(CONFIG.LS_DATASET); } catch (_) {} }
  if (!DATASETS[ini]) ini = DS_KEYS[0];
  state.ds = ini;
  DS_FIELDS.forEach((f) => { state[f] = STORE[ini][f]; });
  if (h.ds) state.filtros = { desde: "", hasta: "", ...h.filtros };
  state.seccion = h.ds && SEC_KEYS().includes(h.sec) ? h.sec : SEC_KEYS()[0];
  construirLayout();
  setTheme(document.documentElement.getAttribute("data-theme") || "light", { rerender: false });
  engancharEventos();
  engancharExtras();
  renderSeccion(state.seccion);   // esqueletos mientras llega Supabase
  writeHash();                    // limpia ?t= y ?v= de la URL
  iniciarSincronizacion();
  await cargarDatos("inicial", { expect });
})();
