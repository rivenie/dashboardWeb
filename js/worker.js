/* ==========================================================
   Web Worker — Almacén
   Procesa MB52 / LT22 / ZLX12 / ZWM.
   Devuelve KPIs + filas crudas comprimidas (solo columnas usadas).
   ========================================================== */

self.onmessage = function (e) {
  const { tipo, rows } = e.data;
  try {
    let resultado;
    if (tipo === "MB52") resultado = procesarMB52(rows);
    else if (tipo === "LT22") resultado = procesarLT22(rows);
    else if (tipo === "ZLX12") resultado = procesarZLX12(rows);
    else if (tipo === "ZWM") resultado = procesarZWM(rows);
    else if (tipo === "ASISTENCIA") resultado = procesarAsistencia(rows);
    else if (tipo === "HORAS_EXTRA") resultado = procesarHorasExtra(rows);
    else throw new Error("Tipo desconocido: " + tipo);
    self.postMessage({ ok: true, tipo, resultado });
  } catch (err) {
    self.postMessage({ ok: false, tipo, error: err.message });
  }
};

/* ---------- Helpers ---------- */
function norm(v) { return v !== undefined && v !== null ? v.toString().trim() : ""; }
function num(v) {
  if (typeof v === "number") return v;
  if (!v) return 0;
  if (v.toString().startsWith("#")) return 0;
  const s = v.toString().replace(",", ".").replace(/[^0-9.-]/g, "");
  return parseFloat(s) || 0;
}

/* Fecha → etiqueta "23 sep" (día + mes abreviado) */
function formatearFecha(valor) {
  const s = norm(valor);
  if (!s) return "";
  if (/^\d{5}$/.test(s)) {
    const serial = parseInt(s);
    const ts = (serial - 25569) * 86400 * 1000;
    return etiquetaFecha(ts);
  }
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return etiquetaFecha(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/);
  if (m) {
    let a = +m[3]; if (a < 100) a += 2000;
    return etiquetaFecha(Date.UTC(a, +m[2] - 1, +m[1]));
  }
  return s;
}
const MESES_ABREV = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
function etiquetaFecha(ts) {
  const d = new Date(ts);
  return String(d.getUTCDate()).padStart(2, "0") + " " + MESES_ABREV[d.getUTCMonth()];
}
function fechaOrdenable(valor) {
  const s = norm(valor);
  if (!s) return "";
  if (/^\d{5}$/.test(s)) {
    const serial = parseInt(s);
    return String(serial);
  }
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${String(+m[2]).padStart(2, "0")}-${String(+m[3]).padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/);
  if (m) {
    let a = +m[3]; if (a < 100) a += 2000;
    return `${a}-${String(+m[2]).padStart(2, "0")}-${String(+m[1]).padStart(2, "0")}`;
  }
  return s;
}

/* ---------- MB52 ---------- */
function procesarMB52(rows) {
  let headerIndex = 0;
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const f = rows[i].map((c) => (c || "").toString().trim().toLowerCase());
    if (f.includes("almacén") || f.includes("almacen") || f.includes("material")) { headerIndex = i; break; }
  }
  const headers = rows[headerIndex].map((h, i) => {
    const limpio = (h || "").toString().trim();
    return limpio === "" ? `Columna_${i + 1}` : limpio;
  });
  const cAlm = headers.findIndex((h) => h.toLowerCase().includes("almac"));
  const cMat = headers.findIndex((h) => h.toLowerCase() === "material");
  const cCat = headers.findIndex((h) => h.toLowerCase().includes("categor"));
  const cTalla = headers.findIndex((h) => h.toLowerCase().includes("valor matriz"));
  const cTexto = headers.findIndex((h) => h.toLowerCase().includes("texto breve"));
  const cStock = headers.findIndex((h) => h.toLowerCase().includes("stock disponible"));
  const cLibre = headers.findIndex((h) => h.toLowerCase().includes("libre utiliz"));
  const cBloq = headers.findIndex((h) => h.toLowerCase().includes("bloqueado"));
  const cCtrl = headers.findIndex((h) => h.toLowerCase().includes("control calidad"));

  const filas = [];
  let totalStock = 0, totalLibre = 0, totalBloq = 0, totalCtrl = 0;
  const matsSet = new Set();

  for (let i = headerIndex + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    const mat = norm(r[cMat]);
    if (!mat) continue;

    const alm = norm(r[cAlm]) || "Sin almacén";
    const cat = norm(r[cCat]) || "Sin categoría";
    const talla = norm(r[cTalla]) || "Sin talla";
    const texto = norm(r[cTexto]);
    const stock = num(r[cStock]);
    const libre = num(r[cLibre]);
    const bloq = num(r[cBloq]);
    const ctrl = num(r[cCtrl]);

    totalStock += stock; totalLibre += libre; totalBloq += bloq; totalCtrl += ctrl;
    matsSet.add(mat);

    filas.push({ alm, mat, cat, talla, texto, stock, libre, bloq, ctrl });
  }

  return {
    tipo: "MB52",
    kpis: {
      totalRegistros: filas.length,
      materialesUnicos: matsSet.size,
      totalStock, totalLibre, totalBloq, totalCtrl,
    },
    filas,
  };
}

/* ---------- LT22 ---------- */
function procesarLT22(rows) {
  let headerIndex = 0;
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const f = rows[i].map((c) => (c || "").toString().trim().toLowerCase());
    if (f.some((c) => c.includes("orden de transporte"))) { headerIndex = i; break; }
  }
  const headers = rows[headerIndex].map((h, i) => (h || "").toString().trim() || `Columna_${i + 1}`);

  const cFecha = headers.findIndex((h) => h.toLowerCase().includes("fecha creac"));
  const cMaterial = headers.findIndex((h) => h.toLowerCase() === "material");
  const cTexto = headers.findIndex((h) => h.toLowerCase().includes("texto breve"));
  const cCtdReal = headers.findIndex((h) => h.toLowerCase().includes("ctd.real"));
  const cTipoAlmOri = headers.findIndex((h) => h.toLowerCase().includes("tipo alm.proced"));
  const cTipoAlmDst = headers.findIndex((h) => h.toLowerCase().includes("tipo almacén destino"));
  const cUsuario = headers.findIndex((h) => h.toLowerCase() === "usuario");
  const cClMov = headers.findIndex((h) => h.toLowerCase().includes("cl.movimiento"));
  const cCategoria = headers.findIndex((h) => h.toLowerCase().includes("categoría stock"));

  const grupo = {};
  let totalCtd = 0;
  const matsSet = new Set();
  const usrSet = new Set();

  for (let i = headerIndex + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    const mat = norm(r[cMaterial]);
    if (!mat) continue;

    const ctd = num(r[cCtdReal]);
    const usuario = norm(r[cUsuario]) || "Sin usuario";
    const clase = norm(r[cClMov]) || "Sin clase";
    const cat = norm(r[cCategoria]) || "Sin categoría";
    const tipoAlmOri = norm(r[cTipoAlmOri]);
    const tipoAlmDst = norm(r[cTipoAlmDst]);
    let tipo = "Otro";
    if (tipoAlmOri && tipoAlmDst) tipo = "Traslado";
    else if (tipoAlmOri && !tipoAlmDst) tipo = "Entrada";
    else if (!tipoAlmOri && tipoAlmDst) tipo = "Salida";

    const fecha = formatearFecha(r[cFecha]);
    const fechaOrd = fechaOrdenable(r[cFecha]);

    totalCtd += ctd;
    matsSet.add(mat);
    usrSet.add(usuario);

    // Agrupar por combinación única
    const key = `${usuario}|${clase}|${cat}|${tipo}|${fecha}`;
    if (!grupo[key]) grupo[key] = { usuario, clase, cat, tipo, fecha, fechaOrd, mov: 0, ctd: 0 };
    grupo[key].mov++;
    grupo[key].ctd += ctd;
  }

  return {
    tipo: "LT22",
    kpis: {
      totalMovimientos: Object.values(grupo).reduce((a, g) => a + g.mov, 0),
      totalCantidad: totalCtd,
      materialesUnicos: matsSet.size,
      usuariosUnicos: usrSet.size,
    },
    filas: Object.values(grupo),
  };
}

/* ---------- ZLX12 ---------- */
function procesarZLX12(rows) {
  let headerIndex = 0;
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const f = rows[i].map((c) => (c || "").toString().trim().toLowerCase());
    if (f.some((c) => c.includes("número de necesidad") || c.includes("numero de necesidad"))) { headerIndex = i; break; }
  }
  const headers = rows[headerIndex].map((h, i) => (h || "").toString().trim() || `Columna_${i + 1}`);

  const cMat = headers.findIndex((h) => h.toLowerCase().includes("número de material") || h.toLowerCase().includes("numero de material"));
  const cTexto = headers.findIndex((h) => h.toLowerCase().includes("texto breve"));
  const cCtd = headers.findIndex((h) => h.toLowerCase().includes("cant. real"));
  const cAlmDest = headers.findIndex((h) => h.toLowerCase().includes("ubic.procedencia") || h.toLowerCase().includes("ubic. procedencia"));
  const cUsuario = headers.findIndex((h) => h.toLowerCase().includes("nombre del usuario"));
  const cCategoria = headers.findIndex((h) => h.toLowerCase().includes("categoría stock"));

  const filas = [];
  let totalCtd = 0;
  const usrSet = new Set();

  for (let i = headerIndex + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    const mat = norm(r[cMat]);
    if (!mat) continue;

    const ctd = num(r[cCtd]);
    const destino = norm(r[cAlmDest]) || "Sin destino";
    const usuario = norm(r[cUsuario]) || "Sin usuario";
    const cat = norm(r[cCategoria]) || "Sin categoría";
    const texto = norm(r[cTexto]);

    totalCtd += ctd;
    usrSet.add(usuario);

    filas.push({ mat, texto, ctd, destino, usuario, cat });
  }

  return {
    tipo: "ZLX12",
    kpis: {
      totalTraslados: filas.length,
      totalCantidad: totalCtd,
      almacenesDestino: new Set(filas.map((f) => f.destino)).size,
      usuariosUnicos: usrSet.size,
    },
    filas,
  };
}

/* ---------- ZWM ---------- */
function procesarZWM(rows) {
  let headerIndex = 0;
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const f = rows[i].map((c) => (c || "").toString().trim().toLowerCase());
    if (f.includes("material") && f.some((c) => c.includes("stock"))) { headerIndex = i; break; }
  }
  const headers = rows[headerIndex].map((h, i) => (h || "").toString().trim() || `Columna_${i + 1}`);

  const cAlm = headers.findIndex((h) => h.toLowerCase() === "alm.");
  const cMat = headers.findIndex((h) => h.toLowerCase().includes("número de material") || h.toLowerCase().includes("numero de material"));
  const cTexto = headers.findIndex((h) => h.toLowerCase().includes("marca") ? false : h.toLowerCase().includes("texto"));
  const cLote = headers.findIndex((h) => h.toLowerCase() === "lote");
  const cStock = headers.findIndex((h) => h.toLowerCase().includes("stock total"));
  const cPermanencia = headers.findIndex((h) => h.toLowerCase().includes("permanencia"));
  const cFecha = headers.findIndex((h) => h.toLowerCase().includes("fecha em"));

  const porAlmacen = {};
  const negativos = [];
  const porFecha = {};
  let totalStock = 0, negCount = 0, nPerm = 0, sumPerm = 0;

  for (let i = headerIndex + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    const mat = norm(r[cMat]);
    if (!mat) continue;

    const alm = norm(r[cAlm]) || "Sin almacén";
    const lote = norm(r[cLote]);
    const texto = norm(r[cTexto]);
    const stock = num(r[cStock]);
    const permanencia = num(r[cPermanencia]);
    const fecha = formatearFecha(r[cFecha]);
    const fechaOrd = fechaOrdenable(r[cFecha]);

    totalStock += stock;
    if (permanencia > 0 && permanencia < 50000) { sumPerm += permanencia; nPerm++; }

    if (!porAlmacen[alm]) porAlmacen[alm] = { nombre: alm, registros: 0, stock: 0, negativos: 0 };
    porAlmacen[alm].registros++;
    porAlmacen[alm].stock += stock;

    if (stock < 0) {
      negCount++;
      porAlmacen[alm].negativos++;
      negativos.push({ mat, lote, texto, stock, alm, permanencia });
    }

    if (fecha) {
      if (!porFecha[fecha]) porFecha[fecha] = { fecha, fechaOrd, registros: 0, negativos: 0 };
      porFecha[fecha].registros++;
      if (stock < 0) porFecha[fecha].negativos++;
    }
  }

  negativos.sort((a, b) => a.stock - b.stock);
  const topNegativos = negativos.slice(0, 100);

  const porFechaArr = Object.values(porFecha).sort((a, b) => a.fechaOrd.localeCompare(b.fechaOrd));

  return {
    tipo: "ZWM",
    kpis: {
      totalRegistros: rows.length - headerIndex - 1,
      totalStock,
      stockNegativoCount: negCount,
      permanenciaPromedio: nPerm ? Math.round(sumPerm / nPerm) : 0,
    },
    porAlmacen: Object.values(porAlmacen).sort((a, b) => b.registros - a.registros),
    topNegativos,
    porFecha: porFechaArr,
  };
}

/* ---------- ASISTENCIA ---------- */
function horasDecimal(v) {
  // Si es número (fracción de día de Excel) → multiplicar por 24
  if (typeof v === "number") return v * 24;
  const s = norm(v);
  if (!s || s === "0:00:00" || s === "0") return 0;
  const m = s.match(/^(\d+):(\d+)(?::(\d+))?$/);
  if (!m) return 0;
  return parseInt(m[1]) + parseInt(m[2]) / 60 + (m[3] ? parseInt(m[3]) / 3600 : 0);
}
const MESES_ABREV2 = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
function parseFechaAsistencia(txt) {
  const s = norm(txt);
  const m = s.match(/^\w+\s+(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (m) return `${m[3]}-${String(+m[2]).padStart(2,"0")}-${String(+m[1]).padStart(2,"0")}`;
  const m2 = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
  if (m2) { let a = +m2[3]; if (a < 100) a += 2000; return `${a}-${String(+m2[2]).padStart(2,"0")}-${String(+m2[1]).padStart(2,"0")}`; }
  return s;
}
function etiquetaFecha2(iso) {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  return String(+m[3]).padStart(2,"0") + " " + MESES_ABREV2[+m[2] - 1];
}

function procesarAsistencia(rows) {
  let headerIndex = 0;
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const f = rows[i].map(c => (c || "").toString().trim().toLowerCase());
    if (f.includes("apellidos") && f.includes("nombre")) { headerIndex = i; break; }
  }
  const headers = rows[headerIndex].map((h, i) => (h || "").toString().trim() || `Columna_${i + 1}`);
    const cApellido = headers.findIndex(h => h.toLowerCase().trim() === "apellidos");
  const cNombre = headers.findIndex(h => h.toLowerCase().trim() === "nombre");
  const cDni = headers.findIndex(h => h.toLowerCase().includes("identificador"));
  const cGrupo = headers.findIndex(h => h.toLowerCase().trim() === "grupo");
  const cFecha = headers.findIndex(h => h.toLowerCase().trim() === "fecha");
  const cPermiso = headers.findIndex(h => h.toLowerCase().trim() === "permiso");
  const cAtraso = headers.findIndex(h => h.toLowerCase().trim() === "atraso");
  const cCargo = headers.findIndex(h => h.toLowerCase().trim() === "cargo");
  const cHT = headers.findIndex(h => h.toLowerCase().trim() === "ht");
  const cHEA = headers.findIndex(h => h.toLowerCase().trim() === "hea");
  const cHEC = headers.findIndex(h => h.toLowerCase().trim() === "hec");

  const filas = [];
  const setTrab = new Set();
  const porPermiso = {};
  let totalHoras = 0, totalAtrasos = 0, totalHEA = 0, totalHEC = 0;

  for (let i = headerIndex + 1; i < rows.length; i++) {
    const r = rows[i]; if (!r) continue;
    if (i === headerIndex + 1) {
  console.log("Fila 1 - HT value:", r[cHT], "| horasTrab:", horasDecimal(r[cHT]));
  console.log("cHT index:", cHT);
}
    const ap = norm(r[cApellido]), nom = norm(r[cNombre]);
    if (!ap && !nom) continue;
    const nombre = `${ap} ${nom}`.trim();
    const dni = norm(r[cDni]);
    const grupo = norm(r[cGrupo]);
    const fecha = parseFechaAsistencia(r[cFecha]);
    const fechaEt = etiquetaFecha2(fecha);
    const permiso = norm(r[cPermiso]) || "Ninguno";
    const cargo = norm(r[cCargo]);
    const horasTrab = horasDecimal(r[cHT]);
    const atraso = horasDecimal(r[cAtraso]);
    const hea = horasDecimal(r[cHEA]);
    const hec = horasDecimal(r[cHEC]);

    totalHoras += horasTrab; totalAtrasos += atraso;
    totalHEA += hea; totalHEC += hec;
    setTrab.add(dni || nombre);
    if (permiso !== "Ninguno") porPermiso[permiso] = (porPermiso[permiso] || 0) + 1;

    filas.push({ nombre, dni, grupo, cargo, fecha, fechaEt, permiso, horasTrab, atraso, hea, hec });
  }

  return {
    tipo: "ASISTENCIA",
    kpis: {
      totalTrabajadores: setTrab.size, totalRegistros: filas.length,
      totalHoras, totalAtrasos, totalHEA, totalHEC, totalHE: totalHEA + totalHEC,
      totalPermisos: Object.values(porPermiso).reduce((a, b) => a + b, 0),
    },
    porPermiso: Object.entries(porPermiso).map(([k, v]) => ({ nombre: k, count: v })).sort((a, b) => b.count - a.count),
    filas,
  };
}

/* ---------- HORAS_EXTRA ---------- */
function procesarHorasExtra(rows) {
  let headerIndex = 0;
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const f = rows[i].map(c => (c || "").toString().trim().toLowerCase());
    if (f.includes("nombre") && f.includes("dni") && f.includes("cantidad")) { headerIndex = i; break; }
  }
  const headers = rows[headerIndex].map((h, i) => (h || "").toString().trim() || `Columna_${i + 1}`);
  const cNombre = headers.findIndex(h => h.toLowerCase() === "nombre");
  const cDni = headers.findIndex(h => h.toLowerCase() === "dni");
  const cInicio = headers.findIndex(h => h.toLowerCase() === "inicio");
  const cFin = headers.findIndex(h => h.toLowerCase() === "fin");
  const cCantidad = headers.findIndex(h => h.toLowerCase() === "cantidad");
  const cNormales = headers.findIndex(h => h.toLowerCase() === "normales");
  const cAdicionales = headers.findIndex(h => h.toLowerCase() === "adicionales");
  const cCreado = headers.findIndex(h => h.toLowerCase().includes("creado por"));

  const filas = [];
  const setTrab = new Set();
  const porTrab = {};
  let totalHoras = 0, totalNormales = 0, totalAdicionales = 0;

  for (let i = headerIndex + 1; i < rows.length; i++) {
    const r = rows[i]; if (!r) continue;
    const nombre = norm(r[cNombre]); if (!nombre) continue;
    const dni = norm(r[cDni]);
    const inicio = parseFechaAsistencia(r[cInicio]);
    const fin = parseFechaAsistencia(r[cFin]);
    const cantidad = horasDecimal(r[cCantidad]);
    const normales = norm(r[cNormales]);
    const adicionales = norm(r[cAdicionales]);
    const creadoPor = norm(r[cCreado]);

    totalHoras += cantidad;
    if (normales.includes("25")) totalNormales++;
    if (adicionales.includes("35")) totalAdicionales++;
    setTrab.add(dni || nombre);

    const key = dni || nombre;
    if (!porTrab[key]) porTrab[key] = { nombre, dni, horas: 0, movimientos: 0 };
    porTrab[key].horas += cantidad;
    porTrab[key].movimientos++;

    filas.push({ nombre, dni, inicio, fin, cantidad, normales, adicionales, creadoPor });
  }

  return {
    tipo: "HORAS_EXTRA",
    kpis: { totalRegistros: filas.length, totalTrabajadores: setTrab.size, totalHoras, totalNormales, totalAdicionales },
    porTrabajador: Object.values(porTrab).sort((a, b) => b.horas - a.horas),
    filas,
  };
}