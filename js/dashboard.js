// ============ NUEVAS CREDENCIALES ============
const SUPABASE_URL = "https://qhqrnnkuhsaszonippnj.supabase.co";
const SUPABASE_KEY = "sb_publishable_aGjT0aecqNHf96Tm7QLMtw_qjCKs5n3";
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let dataGlobal = [];
let charts = {};

// PALETA (misma que ya usabas)
const COLORS = {
    primary: '#3A82C8',
    primaryLight: '#A6CAEC',
    primaryDark: '#156082',
    green: '#397940',
    orange: '#F26F2B',
    textDim: '#5A7A8F'
};

const PALETTE_DONUT = [COLORS.primary, COLORS.primaryLight, COLORS.primaryDark, COLORS.green, COLORS.orange];

document.getElementById('fechaActual').textContent = new Date().toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' });

// ============ CARGA ============
async function cargarDatos() {
    try {
        const { data, error } = await supabaseClient
            .from('dashboard_data')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

        if (error) throw error;

        dataGlobal = data.data;
        document.getElementById('sheetName').textContent = 'Pestaña: ' + data.sheet_name;

        document.getElementById('loading').style.display = 'none';
        document.getElementById('dashboard').style.display = 'block';

        calcularKPIs();
        cargarFiltros();
        crearGraficos();
        crearTablas();

        document.querySelectorAll('.filter-select, .filter-input').forEach(sel => {
            sel.addEventListener('change', aplicarFiltros);
        });
    } catch (err) {
        document.getElementById('loading').innerHTML = `
            <p style="color:#F26F2B;">No hay datos disponibles.</p>
            <p style="color:#5A7A8F;margin-top:10px;">Sube un Excel desde el index.html.</p>
        `;
        console.error(err);
    }
}

// ============ HELPERS ============
function col(clave) {
    if (dataGlobal.length === 0) return null;
    const keys = Object.keys(dataGlobal[0]);
    return keys.find(k => k.trim().toLowerCase() === clave.trim().toLowerCase());
}
function colParcial(contiene) {
    if (dataGlobal.length === 0) return null;
    const keys = Object.keys(dataGlobal[0]);
    return keys.find(k => k.toLowerCase().includes(contiene.toLowerCase()));
}
function norm(v) { return v !== undefined && v !== null ? v.toString().trim() : ''; }
function num(v) {
    if (typeof v === 'number') return v;
    if (!v) return 0;
    // Si es texto de fórmula, devolver 0
    if (v.toString().startsWith('=')) return 0;
    return parseFloat(v.toString().replace(/[^0-9.-]/g, '')) || 0;
}
function money(v) { return 'S/ ' + v.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

// Extraer mes de una fecha
function extraerMes(fecha) {
    if (!fecha) return '';
    const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Setiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    // Formato ISO: "2026-01-01 00:00:00"
    const str = fecha.toString();
    const partes = str.split(' ')[0].split('-');
    if (partes.length >= 2) {
        const idx = parseInt(partes[1]) - 1;
        return meses[idx] || '';
    }
    // Formato DD/MM/YYYY
    const partes2 = str.split('/');
    if (partes2.length === 3) {
        const idx = parseInt(partes2[1]) - 1;
        return meses[idx] || '';
    }
    return '';
}

// ============ RENDERIZADORES ============
function tooltipStyle() {
    return {
        backgroundColor: '#156082',
        titleColor: '#FFFFFF',
        bodyColor: '#FFFFFF',
        borderColor: '#3A82C8',
        borderWidth: 1,
        padding: 12,
        cornerRadius: 8
    };
}

function renderLine(id, labels, datasets) {
    const ctx = document.getElementById(id);
    if (!ctx) return;
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart(ctx, {
        type: 'line',
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'bottom', labels: { color: COLORS.textDim, font: { family: 'Inter', size: 11 }, usePointStyle: true, boxWidth: 8 } },
                tooltip: tooltipStyle()
            },
            scales: {
                x: { ticks: { color: COLORS.textDim, font: { family: 'Inter', size: 10 } }, grid: { display: false } },
                y: { beginAtZero: true, ticks: { color: COLORS.textDim }, grid: { color: 'rgba(214, 228, 240, 0.5)' } }
            }
        }
    });
}

function renderBar(id, labels, data, color) {
    const ctx = document.getElementById(id);
    if (!ctx) return;
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart(ctx, {
        type: 'bar',
        data: { labels, datasets: [{ data, backgroundColor: color || COLORS.primary, borderRadius: 6, borderSkipped: false, barThickness: 22 }] },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: tooltipStyle() },
            scales: {
                x: { ticks: { color: COLORS.textDim, font: { family: 'Inter', size: 10 } }, grid: { display: false } },
                y: { beginAtZero: true, ticks: { color: COLORS.textDim }, grid: { color: 'rgba(214, 228, 240, 0.5)' } }
            }
        }
    });
}

function renderHBar(id, labels, data, color) {
    const ctx = document.getElementById(id);
    if (!ctx) return;
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart(ctx, {
        type: 'bar',
        data: { labels, datasets: [{ data, backgroundColor: color || COLORS.primary, borderRadius: 6, borderSkipped: false, barThickness: 16 }] },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: tooltipStyle() },
            scales: {
                x: { ticks: { color: COLORS.textDim, font: { family: 'Inter', size: 10 } }, grid: { color: 'rgba(214, 228, 240, 0.5)' } },
                y: { ticks: { color: COLORS.primaryDark, font: { family: 'Inter', size: 10 } }, grid: { display: false } }
            }
        }
    });
}

function renderDoughnut(id, labels, data) {
    const ctx = document.getElementById(id);
    if (!ctx) return;
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart(ctx, {
        type: 'doughnut',
        data: { labels, datasets: [{ data, backgroundColor: PALETTE_DONUT.slice(0, labels.length), borderColor: '#FFFFFF', borderWidth: 3 }] },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '65%',
            plugins: {
                legend: { position: 'bottom', labels: { color: COLORS.textDim, font: { family: 'Inter', size: 11 }, padding: 12, usePointStyle: true, boxWidth: 8 } },
                tooltip: tooltipStyle()
            }
        }
    });
}

// ============ KPIs ============
function calcularKPIs() {
    const cClasif = col('CLASIFICACIÓN');
    const cGasto = col('TOTAL') || colParcial('TOTAL');
    const cIngreso = col('TOTAL5') || colParcial('TOTAL5');
    const cGanancia = col('GANANCIA S/') || colParcial('GANANCIA');
    const cFee = col('FEE %') || colParcial('FEE');

    const totalServicios = dataGlobal.length;
    let gasto = 0, ingreso = 0, ganancia = 0, feeSum = 0, feeCount = 0;
    let preventivos = 0, correctivos = 0;

    dataGlobal.forEach(f => {
        gasto += num(f[cGasto]);
        ingreso += num(f[cIngreso]);
        ganancia += num(f[cGanancia]);
        const fee = num(f[cFee]);
        if (fee > 0) { feeSum += fee; feeCount++; }

        const clas = norm(f[cClasif]).toLowerCase();
        if (clas.includes('preventiv')) preventivos++;
        if (clas.includes('correctiv')) correctivos++;
    });

    const ticketPromedio = totalServicios > 0 ? ingreso / totalServicios : 0;
    const margenTotal = ingreso > 0 ? (ganancia / ingreso) * 100 : 0;
    const feePromedio = feeCount > 0 ? (feeSum / feeCount) * 100 : 0;

    document.getElementById('kpiRow').innerHTML = `
        <div class="kpi-card"><div class="kpi-icon-circle"><i class="fas fa-clipboard-list"></i></div>
            <div class="kpi-content"><span class="kpi-title">Total Servicios</span><span class="kpi-main">${totalServicios}</span><span class="kpi-trend">Registrados</span></div></div>
        <div class="kpi-card"><div class="kpi-icon-circle icon-cyan"><i class="fas fa-wrench"></i></div>
            <div class="kpi-content"><span class="kpi-title">Preventivos</span><span class="kpi-main">${preventivos}</span><span class="kpi-trend">Servicios</span></div></div>
        <div class="kpi-card"><div class="kpi-icon-circle icon-orange"><i class="fas fa-screwdriver-wrench"></i></div>
            <div class="kpi-content"><span class="kpi-title">Correctivos</span><span class="kpi-main">${correctivos}</span><span class="kpi-trend">Servicios</span></div></div>
        <div class="kpi-card"><div class="kpi-icon-circle icon-cyan"><i class="fas fa-arrow-down"></i></div>
            <div class="kpi-content"><span class="kpi-title">Gasto Total</span><span class="kpi-main">${money(gasto)}</span><span class="kpi-trend">Acumulado</span></div></div>
        <div class="kpi-card"><div class="kpi-icon-circle icon-green"><i class="fas fa-arrow-up"></i></div>
            <div class="kpi-content"><span class="kpi-title">Ingreso Total</span><span class="kpi-main">${money(ingreso)}</span><span class="kpi-trend">Acumulado</span></div></div>
        <div class="kpi-card"><div class="kpi-icon-circle icon-green"><i class="fas fa-coins"></i></div>
            <div class="kpi-content"><span class="kpi-title">Ganancia Total</span><span class="kpi-main">${money(ganancia)}</span><span class="kpi-trend">Utilidad</span></div></div>
        <div class="kpi-card"><div class="kpi-icon-circle icon-orange"><i class="fas fa-receipt"></i></div>
            <div class="kpi-content"><span class="kpi-title">Ticket Promedio</span><span class="kpi-main">${money(ticketPromedio)}</span><span class="kpi-trend">Por servicio</span></div></div>
        <div class="kpi-card"><div class="kpi-icon-circle icon-cyan"><i class="fas fa-percentage"></i></div>
            <div class="kpi-content"><span class="kpi-title">Margen / Fee Prom.</span><span class="kpi-main">${margenTotal.toFixed(1)}% / ${feePromedio.toFixed(1)}%</span><span class="kpi-trend">Promedios</span></div></div>
    `;

    const center = document.getElementById('centerTotal');
    if (center) center.textContent = totalServicios;
}

// ============ FILTROS ============
function cargarFiltros() {
    llenar('filterMes', 'MES COBRO');
    llenar('filterClasificacion', 'CLASIFICACIÓN');
    llenar('filterProveedor', 'PROVEEDOR');
    llenar('filterArea', 'ÁREA');
}

function llenar(id, columna) {
    const select = document.getElementById(id);
    if (!select) return;
    const c = col(columna);
    if (!c) return;
    const valores = [...new Set(dataGlobal.map(f => norm(f[c])).filter(v => v !== ''))];
    select.innerHTML = `<option value="">${columna}</option>`;
    valores.sort().forEach(v => {
        const opt = document.createElement('option');
        opt.value = v;
        opt.textContent = v;
        select.appendChild(opt);
    });
}

function aplicarFiltros() {
    const fecha = document.getElementById('filterFecha').value;
    const mes = document.getElementById('filterMes').value;
    const clasif = document.getElementById('filterClasificacion').value;
    const prov = document.getElementById('filterProveedor').value;
    const area = document.getElementById('filterArea').value;

    const cFecha = col('FECHA (i)') || colParcial('FECHA');
    const cMes = col('MES COBRO');
    const cClasif = col('CLASIFICACIÓN');
    const cProv = col('PROVEEDOR');
    const cArea = col('ÁREA');

    const backup = dataGlobal;
    dataGlobal = backup.filter(f => {
        if (fecha) {
            const fechaFila = norm(f[cFecha]).split(' ')[0];
            if (fechaFila !== fecha) return false;
        }
        if (mes && norm(f[cMes]) !== mes) return false;
        if (clasif && norm(f[cClasif]) !== clasif) return false;
        if (prov && norm(f[cProv]) !== prov) return false;
        if (area && norm(f[cArea]) !== area) return false;
        return true;
    });

    calcularKPIs();
    crearGraficos();
    crearTablas();
    dataGlobal = backup;
}

// ============ GRÁFICOS ============
function crearGraficos() {
    const cFecha = col('FECHA (i)') || colParcial('FECHA');
    const cClasif = col('CLASIFICACIÓN');
    const cProv = col('PROVEEDOR');
    const cArea = col('ÁREA');
    const cGasto = col('TOTAL') || colParcial('TOTAL');
    const cIngreso = col('TOTAL5') || colParcial('TOTAL5');
    const cGanancia = col('GANANCIA S/') || colParcial('GANANCIA');

    // 1. Evolución mensual: gasto vs ingreso vs ganancia
    const meses = {};
    dataGlobal.forEach(f => {
        const m = extraerMes(norm(f[cFecha]));
        if (!m) return;
        if (!meses[m]) meses[m] = { gasto: 0, ingreso: 0, ganancia: 0, count: 0 };
        meses[m].gasto += num(f[cGasto]);
        meses[m].ingreso += num(f[cIngreso]);
        meses[m].ganancia += num(f[cGanancia]);
        meses[m].count++;
    });
    const ordenMeses = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Setiembre','Octubre','Noviembre','Diciembre'];
    const mesesArr = Object.keys(meses).sort((a, b) => ordenMeses.indexOf(a) - ordenMeses.indexOf(b));

    renderLine('chartEvolucionMensual', mesesArr, [
        { label: 'Gasto', data: mesesArr.map(m => meses[m].gasto), borderColor: COLORS.orange, backgroundColor: 'rgba(242, 111, 43, 0.1)', borderWidth: 3, tension: 0.4, pointRadius: 5, fill: false },
        { label: 'Ingreso', data: mesesArr.map(m => meses[m].ingreso), borderColor: COLORS.primary, backgroundColor: 'rgba(58, 130, 200, 0.1)', borderWidth: 3, tension: 0.4, pointRadius: 5, fill: false },
        { label: 'Ganancia', data: mesesArr.map(m => meses[m].ganancia), borderColor: COLORS.green, backgroundColor: 'rgba(57, 121, 64, 0.1)', borderWidth: 3, tension: 0.4, pointRadius: 5, fill: false }
    ]);

    // 2. Servicios por clasificación
    const porClasif = {};
    dataGlobal.forEach(f => {
        const c = norm(f[cClasif]) || 'Sin clasificación';
        porClasif[c] = (porClasif[c] || 0) + 1;
    });
    renderDoughnut('chartClasificacion', Object.keys(porClasif), Object.values(porClasif));

    // 3. Gasto por proveedor
    const porProv = {};
    dataGlobal.forEach(f => {
        const p = norm(f[cProv]) || 'Sin proveedor';
        porProv[p] = (porProv[p] || 0) + num(f[cGasto]);
    });
    const provArr = Object.entries(porProv).sort((a, b) => b[1] - a[1]).slice(0, 10);
    renderHBar('chartProveedor', provArr.map(p => p[0]), provArr.map(p => p[1]), COLORS.orange);

    // 4. Gasto por área
    const porAreaGasto = {};
    dataGlobal.forEach(f => {
        const a = norm(f[cArea]) || 'Sin área';
        porAreaGasto[a] = (porAreaGasto[a] || 0) + num(f[cGasto]);
    });
    renderBar('chartAreaGasto', Object.keys(porAreaGasto), Object.values(porAreaGasto), COLORS.primary);

    // 5. Ganancia por área
    const porAreaGanancia = {};
    dataGlobal.forEach(f => {
        const a = norm(f[cArea]) || 'Sin área';
        porAreaGanancia[a] = (porAreaGanancia[a] || 0) + num(f[cGanancia]);
    });
    renderBar('chartAreaGanancia', Object.keys(porAreaGanancia), Object.values(porAreaGanancia), COLORS.green);

    // 6. Servicios por mes
    const servPorMes = {};
    dataGlobal.forEach(f => {
        const m = extraerMes(norm(f[cFecha]));
        if (!m) return;
        servPorMes[m] = (servPorMes[m] || 0) + 1;
    });
    const servMesesArr = Object.keys(servPorMes).sort((a, b) => ordenMeses.indexOf(a) - ordenMeses.indexOf(b));
    renderBar('chartServiciosMes', servMesesArr, servMesesArr.map(m => servPorMes[m]), COLORS.primaryDark);
}

// ============ TABLAS ============
function crearTablas() {
    const cGasto = col('TOTAL') || colParcial('TOTAL');
    const cIngreso = col('TOTAL5') || colParcial('TOTAL5');
    const cGanancia = col('GANANCIA S/') || colParcial('GANANCIA');
    const cProv = col('PROVEEDOR');

    // Tabla métricas generales
    let gasto = 0, ingreso = 0, ganancia = 0;
    dataGlobal.forEach(f => {
        gasto += num(f[cGasto]);
        ingreso += num(f[cIngreso]);
        ganancia += num(f[cGanancia]);
    });
    const ticket = dataGlobal.length > 0 ? ingreso / dataGlobal.length : 0;
    const margen = ingreso > 0 ? (ganancia / ingreso) * 100 : 0;

    document.getElementById('tablaMetricas').innerHTML = `
        <table>
            <thead><tr><th>Métrica</th><th>Valor</th></tr></thead>
            <tbody>
                <tr><td>Ticket promedio por servicio</td><td>${money(ticket)}</td></tr>
                <tr><td>Margen de ganancia</td><td>${margen.toFixed(2)}%</td></tr>
                <tr><td>Ganancia total</td><td>${money(ganancia)}</td></tr>
                <tr><td>Ingreso total</td><td>${money(ingreso)}</td></tr>
                <tr><td>Gasto total</td><td>${money(gasto)}</td></tr>
            </tbody>
        </table>
    `;

    // Top 5 proveedores
    const porProv = {};
    dataGlobal.forEach(f => {
        const p = norm(f[cProv]) || 'Sin proveedor';
        porProv[p] = (porProv[p] || 0) + num(f[cGasto]);
    });
    const top5 = Object.entries(porProv).sort((a, b) => b[1] - a[1]).slice(0, 5);

    let html = '<table><thead><tr><th>Proveedor</th><th>Gasto</th></tr></thead><tbody>';
    top5.forEach(([p, g]) => {
        html += `<tr><td>${p}</td><td>${money(g)}</td></tr>`;
    });
    html += '</tbody></table>';
    document.getElementById('tablaTopProveedores').innerHTML = html;
}

// ============ LIMPIAR ============
document.getElementById('clearFilters')?.addEventListener('click', () => {
    document.querySelectorAll('.filter-select').forEach(sel => sel.value = '');
    const fechaInput = document.getElementById('filterFecha');
    if (fechaInput) fechaInput.value = '';
    aplicarFiltros();
});

cargarDatos();