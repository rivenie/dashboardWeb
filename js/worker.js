self.onmessage = function (e) {
  try {
    const { rows } = e.data;
    if (!rows || !Array.isArray(rows)) throw new Error("Filas inválidas.");
    const resultado = procesarSeguridad(rows);
    self.postMessage({ ok: true, resultado });
  } catch (err) {
    self.postMessage({ ok: false, error: (err && err.message) ? err.message : String(err) });
  }
};

function norm(v) { return v !== undefined && v !== null ? v.toString().trim() : ""; }
function num(v) {
  if (typeof v === "number") return isFinite(v) ? v : 0;
  if (v === null || v === undefined || v === "") return 0;
  const s = v.toString().replace(",", ".").replace(/[^0-9.\-]/g, "");
  const n = parseFloat(s);
  return isFinite(n) ? n : 0;
}
function safe(v) { return (typeof v === "number" && !isFinite(v)) ? 0 : v; }

const MESES = ["ABR", "MAY", "JUN", "JUL", "AGO", "SET", "OCT", "NOV", "DIC", "ENE", "FEB", "MAR"];

function procesarSeguridad(rows) {
  if (!rows || rows.length === 0) throw new Error("Hoja vacía");

  // Detectar header: fila que tenga "ITEM" y "KPIS"
  let hIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const f = (rows[i] || []).map(c => (c || "").toString().trim().toUpperCase());
    if (f.includes("ITEM") && f.some(x => x.includes("KPIS"))) { hIdx = i; break; }
  }
  if (hIdx < 0) throw new Error("No se encontró la fila de encabezados.");

  const headers = (rows[hIdx] || []).map((h, i) => {
    const limpio = (h || "").toString().trim().replace(/\s+/g, " ");
    return limpio === "" ? `Columna_${i + 1}` : limpio;
  });
  const idx = (pred) => headers.findIndex(h => pred(h.toLowerCase()));

  const cItem = idx(h => h === "item");
  const cKpi = idx(h => h.includes("kpi"));
  const cSede = idx(h => h.includes("sede vlv") || h === "sede");
  const cTotal = idx(h => h.includes("cantidad total"));
  const cPorSede = idx(h => h.includes("cantidad por sede"));
  const cProyectada = idx(h => h.includes("cantidad proyectada"));
  const cObs = idx(h => h.includes("observaciones"));

  const mesesCols = {};
  MESES.forEach(m => {
    const i = headers.findIndex(h => h.toUpperCase().trim() === m);
    if (i >= 0) mesesCols[m] = i;
  });

  const get = (r, i) => (i >= 0 && r[i] !== undefined) ? r[i] : "";

  const filas = [];
  const porKPI = {};
  const porSede = {};
  const porMes = {};
  const kpiSede = {};
  const kpiMes = {};
  const rondas = { perimetricas: {}, internas: {} };

  for (let i = hIdx + 1; i < rows.length; i++) {
    const r = rows[i]; if (!r) continue;
    const kpi = norm(get(r, cKpi));
    const sede = norm(get(r, cSede));
    if (!kpi || !sede) continue;

    const item = norm(get(r, cItem));
    const total = num(get(r, cTotal));
    const porSedeVal = num(get(r, cPorSede));
    const proyectada = num(get(r, cProyectada));
    const obs = norm(get(r, cObs));

    const meses = {};
    Object.entries(mesesCols).forEach(([m, col]) => {
      const v = num(get(r, col));
      if (v !== 0) meses[m] = v;
    });

    const fila = { item, kpi, sede, total, porSede: porSedeVal, proyectada, obs, meses };
    filas.push(fila);

    // Agregados por KPI
    if (!porKPI[kpi]) porKPI[kpi] = { nombre: kpi, total: 0, porSedeSuma: 0, proyectadaSuma: 0 };
    porKPI[kpi].total += total;
    porKPI[kpi].porSedeSuma += porSedeVal;
    porKPI[kpi].proyectadaSuma += proyectada;

    // Agregados por sede
    if (!porSede[sede]) porSede[sede] = { nombre: sede, total: 0 };
    porSede[sede].total += porSedeVal;

    // Agregados por mes
    Object.entries(meses).forEach(([m, v]) => {
      porMes[m] = (porMes[m] || 0) + v;
      const key = `${kpi}|${m}`;
      kpiMes[key] = (kpiMes[key] || 0) + v;
    });

    // KPI x Sede
    const ks = `${kpi}|${sede}`;
    kpiSede[ks] = (kpiSede[ks] || 0) + porSedeVal;

    // Rondas real vs proyectado
    if (kpi.toUpperCase().includes("RONDAS PERIM")) {
      rondas.perimetricas[sede] = { real: porSedeVal, proyectada };
    }
    if (kpi.toUpperCase().includes("RONDAS INTERN")) {
      rondas.internas[sede] = { real: porSedeVal, proyectada };
    }
  }

  const totalIntrusiones = (porKPI["Intrusiones en VLV"]?.porSedeSuma) || 0;
  const totalCelulares = (porKPI["Celulares decomisados"]?.porSedeSuma) || 0;
  const totalAnimales = (porKPI["Animales retirados"]?.porSedeSuma) || 0;

  // % cumplimiento rondas (real / proyectado)
  const cumpleRondas = (obj) => {
    let real = 0, proy = 0;
    Object.values(obj).forEach(x => { real += x.real; proy += x.proyectada; });
    return proy ? (real / proy) * 100 : 0;
  };
  const pctRondasPerim = cumpleRondas(rondas.perimetricas);
  const pctRondasInt = cumpleRondas(rondas.internas);

  const kpisArr = Object.values(porKPI).sort((a, b) => b.total - a.total);
  const sedesArr = Object.values(porSede).sort((a, b) => b.total - a.total);
  const mesesArr = MESES
    .filter(m => porMes[m] !== undefined)
    .map(m => ({ mes: m, valor: porMes[m] }));

  return {
    tipo: "SEGURIDAD_DATA",
    kpis: {
      totalKPIs: kpisArr.length,
      totalRegistros: filas.length,
      totalIntrusiones,
      totalCelulares,
      totalAnimales,
      pctRondasPerim: safe(pctRondasPerim),
      pctRondasInt: safe(pctRondasInt),
      totalSedes: sedesArr.length,
    },
    porKPI: kpisArr,
    porSede: sedesArr,
    porMes: mesesArr,
    kpiSede: Object.entries(kpiSede).map(([k, v]) => {
      const [kpi, sede] = k.split("|");
      return { kpi, sede, valor: v };
    }),
    kpiMes: Object.entries(kpiMes).map(([k, v]) => {
      const [kpi, mes] = k.split("|");
      return { kpi, mes, valor: v };
    }),
    rondas,
    filas,
  };
}