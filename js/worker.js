/* =====================================================================
   worker.js · Lee el Excel de transporte de personal agrícola
   Una fila = un trabajador transportado en una fecha (un "viaje").
   Columnas usadas (se reconocen por el encabezado, sin importar el orden,
   mayúsculas, tildes ni espacios): FECHA · MES2 · SEMANA · SEDE · PLACA ·
   ORIGEN · NRO. DOC. PASA. · TRABAJADOR · FUNDO · LOTE · ACTIVIDAD ·
   T. BUS · CAPACIDAD.
   - Se abre la pestaña cuyos encabezados se parecen más a los esperados
     (las hojas de usuarios / claves nunca se abren).
   - Los textos se pasan a MAYÚSCULAS y sin espacios sobrantes ("SALAS " = "SALAS").
   - Ninguna categoría está escrita a mano: todo sale de los datos.
   Devuelve la hoja en columnas y comprimida (gzip + base64).
   ===================================================================== */

const DESTINO = { key: "transporte", sb: "ALMACEN_DATA", kind: "tr", nombre: "Transporte de personal · Viajes" };

// Encabezado normalizado → campo
const MAP = {
  fecha: "fecha", fechaviaje: "fecha", dia: "fecha",
  mes2: "mes2", mes: "mes2",
  semana: "semana", sem: "semana", nsemana: "semana",
  sede: "sede",
  placa: "placa", placabus: "placa",
  origen: "origen", paradero: "origen",
  nrodocpasa: "doc", nrodocpase: "doc", nrodoc: "doc", nrodocumento: "doc", dni: "doc", documento: "doc", docpase: "doc", pase: "doc",
  trabajador: "trabajador", nombres: "trabajador", apellidosynombres: "trabajador", apellidosnombres: "trabajador", nombre: "trabajador",
  fundo: "fundo",
  lote: "lote",
  actividad: "actividad", labor: "actividad",
  tbus: "tbus", tipobus: "tbus", tipodebus: "tbus", tipovehiculo: "tbus",
  capacidad: "cap", cap: "cap", asientos: "cap",
};
const CAMPOS = Array.from(new Set(Object.values(MAP)));
const TXT = ["fecha", "mes2", "sede", "placa", "origen", "doc", "trabajador", "fundo", "lote", "actividad", "tbus"];
const NUM = ["semana", "cap"];
const OBLIG = ["fecha", "placa"];
const CLAVES = Object.keys(MAP);

self.onmessage = async function (e) {
  const msg = e.data || {};
  const prog = (pct, label) => self.postMessage({ progress: true, pct, label });
  try {
    let sheet, rows;
    if (msg.buffer) {
      prog(4, "Cargando el lector de Excel…");
      if (typeof XLSX === "undefined") importScripts(msg.xlsxUrl);
      prog(10, "Leyendo los nombres de las pestañas…");
      const libro = XLSX.read(msg.buffer, { type: "array", bookSheets: true });
      const candidatas = libro.SheetNames.filter(permitida).slice(0, 15);
      if (!candidatas.length) throw new Error("El libro no tiene pestañas que se puedan leer.");
      prog(14, "Buscando la pestaña de viajes…");
      if (candidatas.length === 1) sheet = candidatas[0];
      else {
        const peek = XLSX.read(msg.buffer, { type: "array", sheetRows: 12, sheets: candidatas });
        let mejor = -1;
        candidatas.forEach((n) => { const s = puntaje(leerHoja(peek.Sheets[n])); if (s > mejor) { mejor = s; sheet = n; } });
      }
      prog(20, `Abriendo «${sheet}»… (puede tardar con archivos grandes)`);
      const wb = XLSX.read(msg.buffer, { type: "array", cellDates: true, cellNF: false, cellStyles: false, cellHTML: false, cellFormula: false, sheets: [sheet] });
      prog(40, "Convirtiendo filas…");
      rows = leerHoja(wb.Sheets[sheet]);
    } else {
      const k = Object.keys(msg.sheets || {});
      if (!k.length) throw new Error("No llegó ninguna pestaña.");
      sheet = k.sort((a, b) => puntaje(msg.sheets[b]) - puntaje(msg.sheets[a]))[0];
      rows = msg.sheets[sheet];
    }
    prog(52, `Procesando «${sheet}»…`);
    const t0 = Date.now();
    const r = procesar(rows, sheet);
    prog(80, "Comprimiendo…");
    const json = JSON.stringify(r.enc);
    const z = await gzipB64(json);
    const payload = { meta: r.meta, kpis: r.kpis, ...(z ? { z } : { enc: r.enc }) };
    self.postMessage({ ok: true, resultado: [{ ...DESTINO, file: "tr", sheet, ok: true, payload, preview: r.preview, bytes: z ? z.length : json.length, crudo: json.length, ms: Date.now() - t0 }] });
  } catch (err) {
    self.postMessage({ ok: false, error: err.message || String(err) });
  }
};

// Nunca se abren hojas de usuarios / claves
const permitida = (n) => !/pasw|passw|usuario|clave|contrase/i.test(n);

async function gzipB64(json) {
  if (typeof CompressionStream === "undefined") return null;
  const stream = new Blob([json]).stream().pipeThrough(new CompressionStream("gzip"));
  const buf = new Uint8Array(await new Response(stream).arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return btoa(bin);
}
function leerHoja(ws) {
  if (!ws || !ws["!ref"]) return [];
  const R = XLSX.utils.decode_range(ws["!ref"]);
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "", blankrows: false, range: { s: { r: R.s.r, c: R.s.c }, e: { r: R.e.r, c: Math.min(R.e.c, R.s.c + 60) } } });
}
// Cuántos campos distintos reconoce una fila de encabezados
function puntaje(rows) {
  let m = 0;
  (rows || []).slice(0, 12).forEach((r) => {
    const s = new Set((r || []).map((c) => MAP[normKey(c)]).filter(Boolean)).size;
    if (s > m) m = s;
  });
  return m;
}

/* ---------- Utilidades ---------- */
function norm(v) { return v === undefined || v === null ? "" : String(v).replace(/\s+/g, " ").trim(); }
function normKey(k) { return norm(k).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, ""); }
function txt(v) { const s = norm(v); return /^(#n\/a|n\/a|#¡?ref!?|#value!|#¡valor!|#div\/0!|null|none|nan|undefined|0|-|—)$/i.test(s) ? "" : s; }
function numOrNull(v) {
  if (typeof v === "number") return isFinite(v) ? v : null;
  const s = norm(v);
  if (!s || /^#/.test(s)) return null;
  const n = parseFloat(s.replace(/[^\d.,\-]/g, "").replace(",", "."));
  return isFinite(n) ? n : null;
}
// Documento: número o texto, sin decimales ni espacios
function docTxt(v) {
  if (typeof v === "number") return isFinite(v) && v > 0 ? String(Math.round(v)) : "";
  const s = txt(v).replace(/\s+/g, "").replace(/\.0+$/, "");
  return s;
}
// Fecha (Date, número de serie de Excel o texto dd/mm/aaaa · aaaa-mm-dd) → "aaaa-mm-dd" o ""
function fechaISO(v) {
  let y, mo, d;
  if (v instanceof Date) {
    if (isNaN(v)) return "";
    const x = new Date(Math.round(v.getTime() / 60000) * 60000);
    y = x.getFullYear(); mo = x.getMonth(); d = x.getDate();
  } else if (typeof v === "number" && v > 30000 && v < 80000) {
    const x = new Date(Math.round((v - 25569) * 86400000));
    y = x.getUTCFullYear(); mo = x.getUTCMonth(); d = x.getUTCDate();
  } else {
    const s = norm(v);
    let m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
    if (m) { y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; mo = +m[2] - 1; d = +m[1]; }
    else if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) { y = +m[1]; mo = +m[2] - 1; d = +m[3]; }
    else return "";
  }
  if (!y || y < 2000 || y > 2100 || mo < 0 || mo > 11 || d < 1 || d > 31) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${y}-${p(mo + 1)}-${p(d)}`;
}

function columnar(registros, TF, NF) {
  const dicts = {}, idx = {}, cols = {};
  TF.forEach((f) => { dicts[f] = []; idx[f] = new Map(); cols[f] = []; });
  NF.forEach((f) => { cols[f] = []; });
  registros.forEach((r) => {
    TF.forEach((f) => { const s = r[f] == null ? "" : String(r[f]); let i = idx[f].get(s); if (i === undefined) { i = dicts[f].length; dicts[f].push(s); idx[f].set(s, i); } cols[f].push(i); });
    NF.forEach((f) => cols[f].push(r[f] == null ? null : r[f]));
  });
  return { n: registros.length, dicts, cols };
}

/* =========================== Hoja de viajes =========================== */
function procesar(rows, sheet) {
  if (!rows || !rows.length) throw new Error(`La pestaña "${sheet}" está vacía.`);
  // Fila de encabezados: la que reconoce más campos dentro de las primeras 40
  let hIdx = -1, mejor = 0;
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const s = new Set((rows[i] || []).map((c) => MAP[normKey(c)]).filter(Boolean)).size;
    if (s > mejor) { mejor = s; hIdx = i; }
  }
  if (hIdx < 0 || mejor < 5) throw new Error(`No encontré los encabezados en "${sheet}" (FECHA, PLACA, TRABAJADOR, FUNDO, LOTE…).`);
  const map = {}, columnas = {};
  rows[hIdx].forEach((h, j) => { const c = MAP[normKey(h)]; if (c && !(c in columnas)) { map[j] = c; columnas[c] = norm(h); } });
  const falt = OBLIG.filter((c) => !(c in columnas));
  if (falt.length) throw new Error(`En "${sheet}" faltan columnas obligatorias: ${falt.map((c) => c.toUpperCase()).join(", ")}.`);
  if (!("doc" in columnas) && !("trabajador" in columnas)) throw new Error(`En "${sheet}" falta la columna del trabajador (TRABAJADOR o NRO. DOC. PASA.).`);

  const canon = {};   // texto sin distinguir mayúsculas → una sola forma
  const unif = (f, v) => {
    const s = txt(v).toUpperCase();
    if (!s) return "";
    const m = (canon[f] = canon[f] || {});
    return m[s] || (m[s] = s);
  };
  const regs = [], vistos = new Map();
  let omitidas = 0, sinFecha = 0, sinTrabajador = 0, sinDoc = 0, sinLote = 0, duplicados = 0, capInvalida = 0;
  for (let i = hIdx + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const o = {};
    for (const c in map) o[map[c]] = r[c];
    const algo = ["fecha", "placa", "doc", "trabajador", "lote"].some((f) => norm(o[f]) !== "");
    if (!algo) { omitidas++; continue; }
    const reg = { fecha: fechaISO(o.fecha), doc: docTxt(o.doc), semana: numOrNull(o.semana), cap: numOrNull(o.cap) };
    ["mes2", "sede", "placa", "origen", "trabajador", "fundo", "lote", "actividad", "tbus"].forEach((k) => { reg[k] = unif(k, o[k]); });
    if (reg.placa) reg.placa = reg.placa.replace(/\s+/g, "");
    if (reg.semana != null && (reg.semana < 1 || reg.semana > 53)) reg.semana = null;
    if (reg.cap != null && reg.cap <= 0) { reg.cap = null; capInvalida++; }
    if (!reg.fecha) sinFecha++;
    if (!reg.trabajador) sinTrabajador++;
    if (!reg.doc) sinDoc++;
    if (!reg.lote) sinLote++;
    const quien = reg.doc || reg.trabajador;
    if (quien) { const k = `${reg.fecha}|${quien}|${reg.lote}`; if (vistos.has(k)) duplicados++; else vistos.set(k, 1); }
    regs.push(reg);
  }
  if (!regs.length) throw new Error(`"${sheet}" no tiene filas con datos.`);
  const enc = columnar(regs, TXT, NUM);
  const fechas = regs.map((r) => r.fecha).filter(Boolean).sort();
  const uniq = (fn) => new Set(regs.map(fn).filter(Boolean)).size;
  return {
    meta: {
      schema: 2, formato: "columnar", kind: "tr", hoja: sheet, columnas,
      faltantes: CAMPOS.filter((c) => !(c in columnas)),
      filaEncabezado: hIdx + 1, filasOmitidas: omitidas, registros: regs.length,
      avisos: { sinFecha, sinTrabajador, sinDoc, sinLote, duplicados, capInvalida },
    },
    kpis: {
      filas: regs.length,
      trabajadores: uniq((r) => r.doc || r.trabajador),
      placas: uniq((r) => r.placa),
      servicios: uniq((r) => (r.fecha && r.placa ? r.fecha + "|" + r.placa : "")),
      desde: fechas[0] || "", hasta: fechas[fechas.length - 1] || "",
    },
    preview: regs.slice(0, 8),
    enc,
  };
}
