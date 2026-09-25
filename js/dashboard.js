const SUPABASE_URL = "https://qhqrnnkuhsaszonippnj.supabase.co";
const SUPABASE_KEY = "sb_publishable_aGjT0aecqNHf96Tm7QLMtw_qjCKs5n3";
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let hojas = {};
let dataFiltrada = [];
let charts = {};
let dataBackup = [];

const COLORS = {
    primary: '#3A82C8', primaryLight: '#A6CAEC', primaryDark: '#156082',
    green: '#397940', orange: '#F26F2B', textDim: '#5A7A8F'
};
const PALETTE_DONUT = [COLORS.primary, COLORS.primaryLight, COLORS.primaryDark, COLORS.green, COLORS.orange];

document.getElementById('fechaActual').textContent = new Date().toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' });

// ============ CARGA ============
async function cargarTodo() {
    const { data, error } = await supabaseClient.from('dashboard_data').select('*');
    if (error) throw error;
    hojas = {};
    data.forEach(row => { hojas[row.sheet_name] = row.data; });
    document.getElementById('loading').style.display = 'none';
    document.getElementById('dashboard').style.display = 'block';
}

// ============ HELPERS ============
function col(data, clave) {
    if (!data || data.length === 0) return null;
    const keys = Object.keys(data[0]);
    return keys.find(k => k.trim().toLowerCase() === clave.trim().toLowerCase());
}
function colParcial(data, contiene) {
    if (!data || data.length === 0) return null;
    const keys = Object.keys(data[0]);
    return keys.find(k => k.toLowerCase().includes(contiene.toLowerCase()));
}
function norm(v) { return v !== undefined && v !== null ? v.toString().trim() : ''; }
function num(v) {
    if (typeof v === 'number') return v;
    if (!v) return 0;
    if (v.toString().startsWith('=')) return 0;
    return parseFloat(v.toString().replace(/[^0-9.-]/g, '')) || 0;
}
function money(v) { return 'S/ ' + v.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

// ============ UI HELPERS ============
function crearKPI(icono, clase, titulo, valor, sub) {
    return `<div class="kpi-card"><div class="kpi-icon-circle ${clase}"><i class="fas ${icono}"></i></div>
        <div class="kpi-content"><span class="kpi-title">${titulo}</span><span class="kpi-main">${valor}</span><span class="kpi-trend">${sub}</span></div></div>`;
}
function crearChart(id, icono, titulo, full = false) {
    return `<div class="chart-exec-card ${full ? 'chart-full' : ''}"><div class="chart-exec-header"><i class="fas ${icono} chart-icon"></i><h3>${titulo}</h3></div><canvas id="${id}"></canvas></div>`;
}
function crearChartDonut(id, icono, titulo) {
    return `<div class="chart-exec-card"><div class="chart-exec-header"><i class="fas ${icono} chart-icon"></i><h3>${titulo}</h3></div>
        <div class="chart-doughnut-wrapper"><canvas id="${id}"></canvas>
        <div class="chart-doughnut-center"><span class="center-value" id="centerTotal">0</span><span class="center-label">TOTAL</span></div></div></div>`;
}
function crearChartTabla(icono, titulo, id) {
    return `<div class="chart-exec-card"><div class="chart-exec-header"><i class="fas ${icono} chart-icon"></i><h3>${titulo}</h3></div><div id="${id}" class="mini-table"></div></div>`;
}

function tooltipStyle() {
    return { backgroundColor: '#156082', titleColor: '#FFFFFF', bodyColor: '#FFFFFF', borderColor: '#3A82C8', borderWidth: 1, padding: 12, cornerRadius: 8 };
}
function renderBar(id, labels, data, color) {
    const ctx = document.getElementById(id); if (!ctx) return;
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart(ctx, {
        type: 'bar', data: { labels, datasets: [{ data, backgroundColor: color || COLORS.primary, borderRadius: 6, borderSkipped: false, barThickness: 22 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: tooltipStyle() }, scales: { x: { ticks: { color: COLORS.textDim, font: { family: 'Inter', size: 10 } }, grid: { display: false } }, y: { beginAtZero: true, ticks: { color: COLORS.textDim }, grid: { color: 'rgba(214, 228, 240, 0.5)' } } } }
    });
}
function renderHBar(id, labels, data, color) {
    const ctx = document.getElementById(id); if (!ctx) return;
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart(ctx, {
        type: 'bar', data: { labels, datasets: [{ data, backgroundColor: color || COLORS.primary, borderRadius: 6, borderSkipped: false, barThickness: 16 }] },
        options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: tooltipStyle() }, scales: { x: { ticks: { color: COLORS.textDim }, grid: { color: 'rgba(214, 228, 240, 0.5)' } }, y: { ticks: { color: COLORS.primaryDark, font: { family: 'Inter', size: 10 } }, grid: { display: false } } } }
    });
}
function renderDoughnut(id, labels, data) {
    const ctx = document.getElementById(id); if (!ctx) return;
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart(ctx, {
        type: 'doughnut', data: { labels, datasets: [{ data, backgroundColor: PALETTE_DONUT.slice(0, labels.length), borderColor: '#FFFFFF', borderWidth: 3 }] },
        options: { responsive: true, maintainAspectRatio: false, cutout: '65%', plugins: { legend: { position: 'bottom', labels: { color: COLORS.textDim, font: { family: 'Inter', size: 11 }, padding: 12, usePointStyle: true, boxWidth: 8 } }, tooltip: tooltipStyle() } }
    });
}
function renderLine(id, labels, datasets) {
    const ctx = document.getElementById(id); if (!ctx) return;
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart(ctx, {
        type: 'line', data: { labels, datasets },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: COLORS.textDim, font: { family: 'Inter', size: 11 }, usePointStyle: true, boxWidth: 8 } }, tooltip: tooltipStyle() }, scales: { x: { ticks: { color: COLORS.textDim, font: { family: 'Inter', size: 10 } }, grid: { display: false } }, y: { beginAtZero: true, ticks: { color: COLORS.textDim }, grid: { color: 'rgba(214, 228, 240, 0.5)' } } } }
    });
}

// ============================================================
// DASHBOARD DELIVERY
// ============================================================
async function iniciarDashboardDelivery() {
    await cargarTodo();
    const data = hojas['Reporte de entregas'] || [];
    dataFiltrada = data;
    dataBackup = data;

    const cCliente = col(data, 'Cliente');
    const cDistrito = col(data, 'Distrito');
    const cStatus = col(data, 'STATUS');
    const cMaterial = col(data, 'Denominación');
    const cFecha = col(data, 'Fecha . Entrega');
    const cPlaca = col(data, 'PLACA');
    const cResp = col(data, 'RESPONSABLE');
    const cCant = col(data, 'Cantidad');

    document.getElementById('kpiRow').innerHTML = renderKPIsDelivery();
    document.getElementById('chartsGrid').innerHTML = `
        ${crearChart('chartCliente', 'fa-users', 'Entregas por Cliente')}
        ${crearChartDonut('chartStatus', 'fa-info-circle', 'Entregas por Status')}
        ${crearChart('chartDistrito', 'fa-map-marker-alt', 'Entregas por Distrito')}
        ${crearChart('chartFecha', 'fa-calendar', 'Entregas por Fecha')}
        ${crearChart('chartMaterial', 'fa-box', 'Top Materiales')}
        ${crearChart('chartPlaca', 'fa-truck', 'Entregas por Placa')}
        ${crearChartTabla('fa-user-tie', 'Entregas por Responsable', 'tablaResponsable')}
    `;
    crearGraficosDelivery();
    crearTablaResponsable();
    activarFiltrosDelivery();
}

function renderKPIsDelivery() {
    const data = dataFiltrada;
    const cStatus = col(data, 'STATUS');
    const cCant = col(data, 'Cantidad');
    let total = 0, entregados = 0, devoluciones = 0, cantidad = 0;
    data.forEach(f => {
        total++;
        const s = norm(f[cStatus]).toUpperCase();
        if (s.includes('ENTREGADO')) entregados++;
        if (s.includes('DEVOLUCION')) devoluciones++;
        cantidad += num(f[cCant]);
    });
    const pct = total > 0 ? ((entregados / total) * 100).toFixed(1) : 0;
    return `
        ${crearKPI('fa-box', '', 'Total Entregas', total, 'Registradas')}
        ${crearKPI('fa-check-circle', 'icon-green', 'Entregadas', entregados, 'Exitosas')}
        ${crearKPI('fa-undo', 'icon-orange', 'Devoluciones', devoluciones, 'Fallidas')}
        ${crearKPI('fa-percentage', 'icon-cyan', '% Éxito', pct + '%', 'Tasa')}
        ${crearKPI('fa-cubes', 'icon-cyan', 'Cantidad Total', cantidad, 'Unidades')}
    `;
}

function crearGraficosDelivery() {
    const data = dataFiltrada;
    const cCliente = col(data, 'Cliente');
    const cDistrito = col(data, 'Distrito');
    const cStatus = col(data, 'STATUS');
    const cMaterial = col(data, 'Denominación');
    const cFecha = col(data, 'Fecha . Entrega');
    const cPlaca = col(data, 'PLACA');

    const porCliente = {};
    data.forEach(f => { const c = norm(f[cCliente]) || 'Sin cliente'; porCliente[c] = (porCliente[c] || 0) + 1; });
    const clientesArr = Object.entries(porCliente).sort((a, b) => b[1] - a[1]).slice(0, 10);
    renderHBar('chartCliente', clientesArr.map(c => c[0].substring(0, 25)), clientesArr.map(c => c[1]), COLORS.primary);

    const porStatus = {};
    data.forEach(f => { const s = norm(f[cStatus]) || 'Sin status'; porStatus[s] = (porStatus[s] || 0) + 1; });
    renderDoughnut('chartStatus', Object.keys(porStatus), Object.values(porStatus));

    const porDistrito = {};
    data.forEach(f => { const d = norm(f[cDistrito]) || 'Sin distrito'; porDistrito[d] = (porDistrito[d] || 0) + 1; });
    const distArr = Object.entries(porDistrito).sort((a, b) => b[1] - a[1]).slice(0, 10);
    renderBar('chartDistrito', distArr.map(d => d[0]), distArr.map(d => d[1]), COLORS.primaryDark);

    const porFecha = {};
    data.forEach(f => { const fecha = norm(f[cFecha]).split(' ')[0]; if (!fecha) return; porFecha[fecha] = (porFecha[fecha] || 0) + 1; });
    const fechasArr = Object.keys(porFecha).sort();
    renderBar('chartFecha', fechasArr, fechasArr.map(f => porFecha[f]), COLORS.green);

    const porMat = {};
    data.forEach(f => { const m = norm(f[cMaterial]) || 'Sin material'; porMat[m] = (porMat[m] || 0) + 1; });
    const matArr = Object.entries(porMat).sort((a, b) => b[1] - a[1]).slice(0, 8);
    renderHBar('chartMaterial', matArr.map(m => m[0].substring(0, 35)), matArr.map(m => m[1]), COLORS.orange);

    const porPlaca = {};
    data.forEach(f => { const p = norm(f[cPlaca]) || 'Sin placa'; porPlaca[p] = (porPlaca[p] || 0) + 1; });
    const placasArr = Object.entries(porPlaca).sort((a, b) => b[1] - a[1]).slice(0, 10);
    renderBar('chartPlaca', placasArr.map(p => p[0]), placasArr.map(p => p[1]), COLORS.primary);
}

function crearTablaResponsable() {
    const data = dataFiltrada;
    const cResp = col(data, 'RESPONSABLE');
    const porResp = {};
    data.forEach(f => { const r = norm(f[cResp]) || 'Sin responsable'; porResp[r] = (porResp[r] || 0) + 1; });
    const arr = Object.entries(porResp).sort((a, b) => b[1] - a[1]).slice(0, 10);
    let html = '<table><thead><tr><th>Responsable</th><th>Entregas</th></tr></thead><tbody>';
    arr.forEach(([r, c]) => { html += `<tr><td>${r}</td><td>${c}</td></tr>`; });
    html += '</tbody></table>';
    document.getElementById('tablaResponsable').innerHTML = html;
}

function activarFiltrosDelivery() {
    const data = dataBackup;
    llenarSelect('filterCliente', data, 'Cliente');
    llenarSelect('filterDistrito', data, 'Distrito');
    llenarSelect('filterStatus', data, 'STATUS');
    document.querySelectorAll('.filter-select, .filter-input').forEach(sel => { sel.addEventListener('change', () => { aplicarFiltrosDelivery(); }); });
    document.getElementById('clearFilters').addEventListener('click', () => {
        document.querySelectorAll('.filter-select').forEach(s => s.value = '');
        document.getElementById('filterFecha').value = '';
        dataFiltrada = dataBackup;
        document.getElementById('kpiRow').innerHTML = renderKPIsDelivery();
        crearGraficosDelivery();
        crearTablaResponsable();
    });
}

function aplicarFiltrosDelivery() {
    const fecha = document.getElementById('filterFecha').value;
    const cliente = document.getElementById('filterCliente').value;
    const distrito = document.getElementById('filterDistrito').value;
    const status = document.getElementById('filterStatus').value;
    const cFecha = col(dataBackup, 'Fecha . Entrega');
    const cCliente = col(dataBackup, 'Cliente');
    const cDistrito = col(dataBackup, 'Distrito');
    const cStatus = col(dataBackup, 'STATUS');
    dataFiltrada = dataBackup.filter(f => {
        if (fecha && norm(f[cFecha]).split(' ')[0] !== fecha) return false;
        if (cliente && norm(f[cCliente]) !== cliente) return false;
        if (distrito && norm(f[cDistrito]) !== distrito) return false;
        if (status && norm(f[cStatus]) !== status) return false;
        return true;
    });
    document.getElementById('kpiRow').innerHTML = renderKPIsDelivery();
    crearGraficosDelivery();
    crearTablaResponsable();
}

function llenarSelect(id, data, columna) {
    const select = document.getElementById(id);
    if (!select) return;
    const c = col(data, columna) || colParcial(data, columna);
    if (!c) return;
    const valores = [...new Set(data.map(f => norm(f[c])).filter(v => v !== ''))];
    select.innerHTML = `<option value="">${columna}</option>`;
    valores.sort().forEach(v => { const opt = document.createElement('option'); opt.value = v; opt.textContent = v; select.appendChild(opt); });
}

// ============================================================
// DASHBOARD TRANSPORTE
// ============================================================
async function iniciarDashboardTransporte() {
    await cargarTodo();
    const data = hojas['Servicios Adicionales Djr - Adv'] || [];
    dataFiltrada = data; dataBackup = data;

    document.getElementById('kpiRow').innerHTML = renderKPIsTransporte();
    document.getElementById('chartsGrid').innerHTML = `
        ${crearChart('chartProveedor', 'fa-truck', 'Fletes por Proveedor')}
        ${crearChart('chartClienteCosto', 'fa-users', 'Costo de Fletes por Cliente')}
        ${crearChart('chartPlacaCubicaje', 'fa-cube', 'Cubicaje por Placa')}
        ${crearChart('chartHoras', 'fa-clock', 'Horas Totales por Ruta')}
        ${crearChartDonut('chartResguardo', 'fa-shield', 'Tipos de Resguardo por Cliente')}
        ${crearChart('chartCostoEstiba', 'fa-pallet', 'Costo x Estiba por Cliente')}
    `;
    crearGraficosTransporte();
    activarFiltrosTransporte();
}

function renderKPIsTransporte() {
    const data = dataFiltrada;
    const cFlete = col(data, 'flete fijo') || colParcial(data, 'flete');
    const cTotal = col(data, 'Total') || colParcial(data, 'total');
    let fletes = 0, total = 0, clientes = new Set(), proveedores = new Set();
    data.forEach(f => {
        fletes += num(f[cFlete]);
        total += num(f[cTotal]);
        const cl = norm(f[col(data, 'Cliente')]); if (cl) clientes.add(cl);
        const pv = norm(f[col(data, 'Proveedor')]); if (pv) proveedores.add(pv);
    });
    return `
        ${crearKPI('fa-truck', '', 'Total Rutas', data.length, 'Registradas')}
        ${crearKPI('fa-dollar-sign', 'icon-green', 'Flete Fijo', money(fletes), 'Acumulado')}
        ${crearKPI('fa-coins', 'icon-cyan', 'Total General', money(total), 'Flete + Estibas')}
        ${crearKPI('fa-users', 'icon-orange', 'Clientes', clientes.size, 'Únicos')}
        ${crearKPI('fa-building', 'icon-cyan', 'Proveedores', proveedores.size, 'Activos')}
    `;
}

function crearGraficosTransporte() {
    const data = dataFiltrada;
    const cProv = col(data, 'Proveedor');
    const cCliente = col(data, 'Cliente');
    const cPlaca = col(data, 'Placa');
    const cCubic = col(data, 'Cubicaje');
    const cInicio = col(data, 'Inicio ruta2');
    const cFin = col(data, 'Hora de termino');
    const cResg = col(data, 'Tipo de Resguardo');
    const cCostoEst = col(data, 'Costo x estiba');
    const cFlete = col(data, 'flete fijo') || colParcial(data, 'flete');

    const porProv = {};
    data.forEach(f => { const p = norm(f[cProv]) || 'Sin proveedor'; porProv[p] = (porProv[p] || 0) + 1; });
    renderDoughnut('chartProveedor', Object.keys(porProv), Object.values(porProv));

    const porCliCosto = {};
    data.forEach(f => { const c = norm(f[cCliente]) || 'Sin cliente'; porCliCosto[c] = (porCliCosto[c] || 0) + num(f[cFlete]); });
    const cliArr = Object.entries(porCliCosto).sort((a, b) => b[1] - a[1]).slice(0, 10);
    renderHBar('chartClienteCosto', cliArr.map(c => c[0].substring(0, 25)), cliArr.map(c => c[1]), COLORS.green);

    const porPlaca = {};
    data.forEach(f => { const p = norm(f[cPlaca]) || 'Sin placa'; porPlaca[p] = (porPlaca[p] || 0) + num(f[cCubic]); });
    const placasArr = Object.entries(porPlaca).sort((a, b) => b[1] - a[1]).slice(0, 10);
    renderBar('chartPlacaCubicaje', placasArr.map(p => p[0]), placasArr.map(p => p[1]), COLORS.primary);

    const porRutaHoras = {};
    data.forEach(f => {
        const p = norm(f[cPlaca]) || 'Sin placa';
        const ini = norm(f[cInicio]);
        const fin = norm(f[cFin]);
        if (ini && fin) {
            const [hI, mI] = ini.split(':').map(Number);
            const [hF, mF] = fin.split(':').map(Number);
            const horas = (hF + mF / 60) - (hI + mI / 60);
            if (horas > 0) porRutaHoras[p] = (porRutaHoras[p] || 0) + horas;
        }
    });
    const horasArr = Object.entries(porRutaHoras).sort((a, b) => b[1] - a[1]).slice(0, 10);
    renderBar('chartHoras', horasArr.map(h => h[0]), horasArr.map(h => h[1].toFixed(1)), COLORS.orange);

    const porResg = {};
    data.forEach(f => { const r = norm(f[cResg]) || 'Sin resguardo'; porResg[r] = (porResg[r] || 0) + 1; });
    renderDoughnut('chartResguardo', Object.keys(porResg), Object.values(porResg));

    const porCliEst = {};
    data.forEach(f => { const c = norm(f[cCliente]) || 'Sin cliente'; porCliEst[c] = (porCliEst[c] || 0) + num(f[cCostoEst]); });
    const estArr = Object.entries(porCliEst).sort((a, b) => b[1] - a[1]).slice(0, 10);
    renderHBar('chartCostoEstiba', estArr.map(e => e[0].substring(0, 25)), estArr.map(e => e[1]), COLORS.primaryDark);
}

function activarFiltrosTransporte() {
    const data = dataBackup;
    llenarSelect('filterProveedor', data, 'Proveedor');
    llenarSelect('filterCliente', data, 'Cliente');
    llenarSelect('filterResguardo', data, 'Tipo de Resguardo');
    document.querySelectorAll('.filter-select, .filter-input').forEach(sel => { sel.addEventListener('change', aplicarFiltrosTransporte); });
    document.getElementById('clearFilters').addEventListener('click', () => {
        document.querySelectorAll('.filter-select').forEach(s => s.value = '');
        document.getElementById('filterFecha').value = '';
        dataFiltrada = dataBackup;
        document.getElementById('kpiRow').innerHTML = renderKPIsTransporte();
        crearGraficosTransporte();
    });
}

function aplicarFiltrosTransporte() {
    const fecha = document.getElementById('filterFecha').value;
    const prov = document.getElementById('filterProveedor').value;
    const cliente = document.getElementById('filterCliente').value;
    const resg = document.getElementById('filterResguardo').value;
    const cFecha = col(dataBackup, 'Fecha');
    const cProv = col(dataBackup, 'Proveedor');
    const cCliente = col(dataBackup, 'Cliente');
    const cResg = col(dataBackup, 'Tipo de Resguardo');
    dataFiltrada = dataBackup.filter(f => {
        if (fecha && norm(f[cFecha]).split(' ')[0] !== fecha) return false;
        if (prov && norm(f[cProv]) !== prov) return false;
        if (cliente && norm(f[cCliente]) !== cliente) return false;
        if (resg && norm(f[cResg]) !== resg) return false;
        return true;
    });
    document.getElementById('kpiRow').innerHTML = renderKPIsTransporte();
    crearGraficosTransporte();
}

// ============================================================
// DASHBOARD HOJAS DE RUTA
// ============================================================
async function iniciarDashboardRutas() {
    await cargarTodo();
    const data = hojas['Control de transporte '] || hojas['Control de transporte'] || [];
    dataFiltrada = data; dataBackup = data;

    document.getElementById('kpiRow').innerHTML = renderKPIsRutas();
    document.getElementById('chartsGrid').innerHTML = `
        ${crearChart('chartKmTotal', 'fa-road', 'KM Totales por Transporte')}
        ${crearChart('chartKmExtra', 'fa-route', 'KM Extra por Transporte')}
        ${crearChart('chartCostoKm', 'fa-coins', 'Costo KM por Transporte')}
        ${crearChart('chartHorasConductor', 'fa-clock', 'Horas Totales por Conductor')}
        ${crearChart('chartEficiencia', 'fa-percentage', 'Eficiencia KM (Permitido vs Total)')}
        ${crearChart('chartJornal', 'fa-money-bill', 'Jornal por Transporte')}
    `;
    crearGraficosRutas();
    activarFiltrosRutas();
}

function renderKPIsRutas() {
    const data = dataFiltrada;
    let kmTotal = 0, kmExtra = 0, costoKm = 0, jornal = 0;
    const conductores = new Set();
    data.forEach(f => {
        const cKm = col(data, 'KM -TOTAL') || colParcial(data, 'KM -TOTAL');
        const cKmE = col(data, 'KM - EXTRA') || colParcial(data, 'KM - EXTRA');
        const cCosto = col(data, 'Costo KM') || colParcial(data, 'Costo KM');
        const cJor = col(data, 'Jornal');
        const cCond = col(data, 'NOMBRES');
        kmTotal += num(f[cKm]); kmExtra += num(f[cKmE]);
        costoKm += num(f[cCosto]); jornal += num(f[cJor]);
        const cond = norm(f[cCond]); if (cond) conductores.add(cond);
    });
    return `
        ${crearKPI('fa-route', '', 'Total Rutas', data.length, 'Registradas')}
        ${crearKPI('fa-road', 'icon-cyan', 'KM Totales', kmTotal, 'Recorridos')}
        ${crearKPI('fa-road-circle-exclamation', 'icon-orange', 'KM Extra', kmExtra, 'Excedidos')}
        ${crearKPI('fa-coins', 'icon-green', 'Costo KM', money(costoKm), 'Acumulado')}
        ${crearKPI('fa-user-tie', 'icon-cyan', 'Conductores', conductores.size, 'Únicos')}
    `;
}

function crearGraficosRutas() {
    const data = dataFiltrada;
    const cTransp = col(data, 'Transporte');
    const cKm = col(data, 'KM -TOTAL') || colParcial(data, 'KM -TOTAL');
    const cKmExtra = col(data, 'KM - EXTRA') || colParcial(data, 'KM - EXTRA');
    const cKmPerm = col(data, 'KM PERMITIDO') || colParcial(data, 'KM PERMITIDO');
    const cCostoKm = col(data, 'Costo KM') || colParcial(data, 'Costo KM');
    const cJornal = col(data, 'Jornal');
    const cIni = col(data, 'HORA INGRESO') || colParcial(data, 'HORA INGRESO');
    const cFin = col(data, 'HORA SALIDA') || colParcial(data, 'HORA SALIDA');
    const cCond = col(data, 'NOMBRES');

    const agrupar = (colKey, tipo = 'suma') => {
        const r = {};
        data.forEach(f => {
            const k = norm(f[cTransp]) || 'Sin transporte';
            if (tipo === 'count') r[k] = (r[k] || 0) + 1;
            else r[k] = (r[k] || 0) + num(f[colKey]);
        });
        return Object.entries(r).sort((a, b) => b[1] - a[1]);
    };

    const kmArr = agrupar(cKm);
    renderBar('chartKmTotal', kmArr.map(k => k[0]), kmArr.map(k => k[1]), COLORS.primary);

    const kmExtraArr = agrupar(cKmExtra);
    renderBar('chartKmExtra', kmExtraArr.map(k => k[0]), kmExtraArr.map(k => k[1]), COLORS.orange);

    const costoKmArr = agrupar(cCostoKm);
    renderBar('chartCostoKm', costoKmArr.map(k => k[0]), costoKmArr.map(k => k[1]), COLORS.green);

    const horasPorCond = {};
    data.forEach(f => {
        const c = norm(f[cCond]) || 'Sin conductor';
        const ini = norm(f[cIni]), fin = norm(f[cFin]);
        if (ini && fin) {
            const [hI, mI] = ini.split(':').map(Number);
            const [hF, mF] = fin.split(':').map(Number);
            const horas = (hF + mF / 60) - (hI + mI / 60);
            if (horas > 0) horasPorCond[c] = (horasPorCond[c] || 0) + horas;
        }
    });
    const horasArr = Object.entries(horasPorCond).sort((a, b) => b[1] - a[1]).slice(0, 10);
    renderHBar('chartHorasConductor', horasArr.map(h => h[0].substring(0, 25)), horasArr.map(h => h[1].toFixed(1)), COLORS.primaryDark);

    const eficiencia = {};
    data.forEach(f => {
        const t = norm(f[cTransp]) || 'Sin transporte';
        const permitido = num(f[cKmPerm]);
        const total = num(f[cKm]);
        if (!eficiencia[t]) eficiencia[t] = { permitido: 0, total: 0 };
        eficiencia[t].permitido += permitido;
        eficiencia[t].total += total;
    });
    const eficienciaArr = Object.entries(eficiencia).map(([t, d]) => ({
        transporte: t, pct: d.total > 0 ? (d.permitido / d.total) * 100 : 0
    })).sort((a, b) => b.pct - a.pct).slice(0, 10);
    renderBar('chartEficiencia', eficienciaArr.map(e => e.transporte), eficienciaArr.map(e => e.pct.toFixed(1)), COLORS.green);

    const jornalArr = agrupar(cJornal);
    renderHBar('chartJornal', jornalArr.map(j => j[0]), jornalArr.map(j => j[1]), COLORS.primary);
}

function activarFiltrosRutas() {
    const data = dataBackup;
    llenarSelect('filterTransporte', data, 'Transporte');
    llenarSelect('filterConductor', data, 'NOMBRES');
    llenarSelect('filterPlaca', data, 'PLACA');
    document.querySelectorAll('.filter-select, .filter-input').forEach(sel => { sel.addEventListener('change', aplicarFiltrosRutas); });
    document.getElementById('clearFilters').addEventListener('click', () => {
        document.querySelectorAll('.filter-select').forEach(s => s.value = '');
        document.getElementById('filterFecha').value = '';
        dataFiltrada = dataBackup;
        document.getElementById('kpiRow').innerHTML = renderKPIsRutas();
        crearGraficosRutas();
    });
}

function aplicarFiltrosRutas() {
    const fecha = document.getElementById('filterFecha').value;
    const transp = document.getElementById('filterTransporte').value;
    const cond = document.getElementById('filterConductor').value;
    const placa = document.getElementById('filterPlaca').value;
    const cFecha = col(dataBackup, 'FECHA');
    const cTransp = col(dataBackup, 'Transporte');
    const cCond = col(dataBackup, 'NOMBRES');
    const cPlaca = col(dataBackup, 'PLACA');
    dataFiltrada = dataBackup.filter(f => {
        if (fecha && norm(f[cFecha]).split(' ')[0] !== fecha) return false;
        if (transp && norm(f[cTransp]) !== transp) return false;
        if (cond && norm(f[cCond]) !== cond) return false;
        if (placa && norm(f[cPlaca]) !== placa) return false;
        return true;
    });
    document.getElementById('kpiRow').innerHTML = renderKPIsRutas();
    crearGraficosRutas();
}

// ============================================================
// DASHBOARD RESGUARDOS
// ============================================================
async function iniciarDashboardResguardos() {
    await cargarTodo();
    const data = hojas['Servicio Police'] || [];
    dataFiltrada = data; dataBackup = data;

    document.getElementById('kpiRow').innerHTML = renderKPIsResguardos();
    document.getElementById('chartsGrid').innerHTML = `
        ${crearChartDonut('chartProvResg', 'fa-building', 'Resguardos por Proveedor')}
        ${crearChart('chartClienteCosto', 'fa-users', 'Costo de Resguardo por Cliente')}
        ${crearChartDonut('chartTipoResg', 'fa-shield', 'Resguardos por Tipo')}
        ${crearChart('chartPlacaResg', 'fa-truck', 'Resguardos por Placa')}
        ${crearChart('chartFechaResg', 'fa-calendar', 'Resguardos por Fecha')}
        ${crearChartTabla('fa-table', 'Detalle de Resguardos', 'tablaResguardos')}
    `;
    crearGraficosResguardos();
    activarFiltrosResguardos();
}

function renderKPIsResguardos() {
    const data = dataFiltrada;
    const cCosto = col(data, 'Costo de resguardo');
    let total = 0, costo = 0;
    const clientes = new Set(), proveedores = new Set();
    data.forEach(f => {
        total++;
        costo += num(f[cCosto]);
        const cl = norm(f[col(data, 'CLIENTE')]); if (cl) clientes.add(cl);
        const pv = norm(f[col(data, 'PROVEEDOR')]); if (pv) proveedores.add(pv);
    });
    return `
        ${crearKPI('fa-shield', '', 'Total Resguardos', total, 'Registrados')}
        ${crearKPI('fa-coins', 'icon-green', 'Costo Total', money(costo), 'Acumulado')}
        ${crearKPI('fa-users', 'icon-cyan', 'Clientes', clientes.size, 'Únicos')}
        ${crearKPI('fa-building', 'icon-orange', 'Proveedores', proveedores.size, 'Activos')}
        ${crearKPI('fa-calculator', 'icon-cyan', 'Costo Promedio', money(total > 0 ? costo / total : 0), 'Por resguardo')}
    `;
}

function crearGraficosResguardos() {
    const data = dataFiltrada;
    const cProv = col(data, 'PROVEEDOR');
    const cCliente = col(data, 'CLIENTE');
    const cResg = col(data, 'RESGUARDO');
    const cPlaca = col(data, 'PLACA');
    const cFecha = col(data, 'FECHA');
    const cCosto = col(data, 'Costo de resguardo');

    const porProv = {};
    data.forEach(f => { const p = norm(f[cProv]) || 'Sin proveedor'; porProv[p] = (porProv[p] || 0) + 1; });
    renderDoughnut('chartProvResg', Object.keys(porProv), Object.values(porProv));

    const porCliCosto = {};
    data.forEach(f => { const c = norm(f[cCliente]) || 'Sin cliente'; porCliCosto[c] = (porCliCosto[c] || 0) + num(f[cCosto]); });
    const cliArr = Object.entries(porCliCosto).sort((a, b) => b[1] - a[1]).slice(0, 10);
    renderHBar('chartClienteCosto', cliArr.map(c => c[0].substring(0, 25)), cliArr.map(c => c[1]), COLORS.primary);

    const porResg = {};
    data.forEach(f => { const r = norm(f[cResg]) || 'Sin tipo'; porResg[r] = (porResg[r] || 0) + 1; });
    renderDoughnut('chartTipoResg', Object.keys(porResg), Object.values(porResg));

    const porPlaca = {};
    data.forEach(f => { const p = norm(f[cPlaca]) || 'Sin placa'; porPlaca[p] = (porPlaca[p] || 0) + 1; });
    const placasArr = Object.entries(porPlaca).sort((a, b) => b[1] - a[1]).slice(0, 10);
    renderBar('chartPlacaResg', placasArr.map(p => p[0]), placasArr.map(p => p[1]), COLORS.primaryDark);

    const porFecha = {};
    data.forEach(f => { const fecha = norm(f[cFecha]).split(' ')[0]; if (!fecha) return; porFecha[fecha] = (porFecha[fecha] || 0) + 1; });
    const fechasArr = Object.keys(porFecha).sort();
    renderBar('chartFechaResg', fechasArr, fechasArr.map(f => porFecha[f]), COLORS.green);

    let html = '<table><thead><tr><th>Fecha</th><th>Cliente</th><th>Placa</th><th>Tipo</th><th>Costo</th></tr></thead><tbody>';
    data.slice(0, 15).forEach(f => {
        html += `<tr><td>${norm(f[cFecha]).split(' ')[0]}</td><td>${norm(f[cCliente]).substring(0, 25)}</td><td>${norm(f[cPlaca])}</td><td>${norm(f[cResg])}</td><td>${money(num(f[cCosto]))}</td></tr>`;
    });
    html += '</tbody></table>';
    document.getElementById('tablaResguardos').innerHTML = html;
}

function activarFiltrosResguardos() {
    const data = dataBackup;
    llenarSelect('filterProveedor', data, 'PROVEEDOR');
    llenarSelect('filterCliente', data, 'CLIENTE');
    llenarSelect('filterResguardo', data, 'RESGUARDO');
    document.querySelectorAll('.filter-select, .filter-input').forEach(sel => { sel.addEventListener('change', aplicarFiltrosResguardos); });
    document.getElementById('clearFilters').addEventListener('click', () => {
        document.querySelectorAll('.filter-select').forEach(s => s.value = '');
        document.getElementById('filterFecha').value = '';
        dataFiltrada = dataBackup;
        document.getElementById('kpiRow').innerHTML = renderKPIsResguardos();
        crearGraficosResguardos();
    });
}

function aplicarFiltrosResguardos() {
    const fecha = document.getElementById('filterFecha').value;
    const prov = document.getElementById('filterProveedor').value;
    const cliente = document.getElementById('filterCliente').value;
    const resg = document.getElementById('filterResguardo').value;
    const cFecha = col(dataBackup, 'FECHA');
    const cProv = col(dataBackup, 'PROVEEDOR');
    const cCliente = col(dataBackup, 'CLIENTE');
    const cResg = col(dataBackup, 'RESGUARDO');
    dataFiltrada = dataBackup.filter(f => {
        if (fecha && norm(f[cFecha]).split(' ')[0] !== fecha) return false;
        if (prov && norm(f[cProv]) !== prov) return false;
        if (cliente && norm(f[cCliente]) !== cliente) return false;
        if (resg && norm(f[cResg]) !== resg) return false;
        return true;
    });
    document.getElementById('kpiRow').innerHTML = renderKPIsResguardos();
    crearGraficosResguardos();
}