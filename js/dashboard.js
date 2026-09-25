const SUPABASE_URL = "https://uoftarfxakkpevugdycg.supabase.co";
const SUPABASE_KEY = "sb_publishable_vT_w6EoVLl-BK12ojRTaOg_UeSXAVvh";
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let hojas = {};
let dataFiltrada = [];
let charts = {};

const COLORS = {
    accent: '#FF6B00', cyan: '#00D2FF', blue: '#2563EB', purple: '#8B5CF6',
    green: '#10B981', greenNeon: '#00E676', red: '#EF4444', yellow: '#FBBF24',
    gray: '#475569', textDim: '#94A3B8'
};
const PALETTE = [COLORS.accent, COLORS.cyan, COLORS.blue, COLORS.purple, COLORS.green, COLORS.yellow, COLORS.red, COLORS.greenNeon];

document.getElementById('fechaActual').textContent = new Date().toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' });

// ============ CARGA ============
async function cargarDatos() {
    try {
        const { data, error } = await supabaseClient.from('dashboard_data').select('*');
        if (error) throw error;

        hojas = {};
        data.forEach(row => { hojas[row.sheet_name] = row.data; });

        document.getElementById('loading').style.display = 'none';
        document.getElementById('dashboard').style.display = 'block';

        dataFiltrada = hojas['WORKLIST'] || [];

        calcularTodo();
        cargarFiltros();

        document.querySelectorAll('.filter-select').forEach(sel => {
            sel.addEventListener('change', aplicarFiltros);
        });
    } catch (err) {
        document.getElementById('loading').innerHTML = '<p style="color:#ff6b00;">No hay datos disponibles.</p>';
        console.error(err);
    }
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
    return parseFloat(v.toString().replace(/,/g, '')) || 0;
}

// ============ UI HELPERS ============
function crearKPI(icono, clase, titulo, valor, sub) {
    return `<div class="kpi-card">
        <div class="kpi-icon-circle ${clase}"><i class="fas ${icono}"></i></div>
        <div class="kpi-content">
            <span class="kpi-title">${titulo}</span>
            <span class="kpi-main">${valor}</span>
            <span class="kpi-trend trend-up">${sub}</span>
        </div>
    </div>`;
}

function crearChart(id, icono, titulo, full = false) {
    return `<div class="chart-exec-card ${full ? 'chart-full' : ''}">
        <div class="chart-exec-header"><i class="fas ${icono} chart-icon"></i><h3>${titulo}</h3></div>
        <canvas id="${id}"></canvas>
    </div>`;
}

function crearChartDonut(id, icono, titulo) {
    return `<div class="chart-exec-card">
        <div class="chart-exec-header"><i class="fas ${icono} chart-icon"></i><h3>${titulo}</h3></div>
        <div class="chart-doughnut-wrapper">
            <canvas id="${id}"></canvas>
            <div class="chart-doughnut-center">
                <span class="center-value" id="centerTotal">0</span>
                <span class="center-label">TOTAL</span>
            </div>
        </div>
    </div>`;
}

function crearChartProgress(id, icono, titulo) {
    return `<div class="chart-exec-card">
        <div class="chart-exec-header"><i class="fas ${icono} chart-icon"></i><h3>${titulo}</h3></div>
        <div class="progress-list" id="${id}"></div>
    </div>`;
}

function crearChartTabla(icono, titulo) {
    return `<div class="chart-exec-card chart-full">
        <div class="chart-exec-header"><i class="fas ${icono} chart-icon"></i><h3>${titulo}</h3></div>
        <div id="tablaResumen"></div>
    </div>`;
}

// ============ RENDERIZADORES ============
function tooltipStyle() {
    return { backgroundColor: '#0F172A', titleColor: '#FF6B00', bodyColor: '#FFFFFF', borderColor: '#FF6B00', borderWidth: 1, padding: 12, cornerRadius: 8 };
}

function renderBar(id, labels, data, color) {
    const ctx = document.getElementById(id);
    if (!ctx) return;
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart(ctx, {
        type: 'bar',
        data: { labels, datasets: [{ data, backgroundColor: color, borderRadius: 6, borderSkipped: false, barThickness: 22 }] },
        options: { responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: tooltipStyle() },
            scales: { x: { ticks: { color: COLORS.textDim, font: { family: 'Inter', size: 10 } }, grid: { display: false } }, y: { beginAtZero: true, ticks: { color: COLORS.textDim }, grid: { color: 'rgba(148,163,184,0.1)' } } }
        }
    });
}

function renderHBar(id, labels, data, color) {
    const ctx = document.getElementById(id);
    if (!ctx) return;
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart(ctx, {
        type: 'bar',
        data: { labels, datasets: [{ data, backgroundColor: color, borderRadius: 6, borderSkipped: false, barThickness: 16 }] },
        options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: tooltipStyle() },
            scales: { x: { ticks: { color: COLORS.textDim, font: { family: 'Inter', size: 10 } }, grid: { color: 'rgba(148,163,184,0.1)' } }, y: { ticks: { color: '#fff', font: { family: 'Inter', size: 10 } }, grid: { display: false } } }
        }
    });
}

function renderDoughnut(id, labels, data) {
    const ctx = document.getElementById(id);
    if (!ctx) return;
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart(ctx, {
        type: 'doughnut',
        data: { labels, datasets: [{ data, backgroundColor: PALETTE.slice(0, labels.length), borderColor: '#1E293B', borderWidth: 3 }] },
        options: { responsive: true, maintainAspectRatio: false, cutout: '65%',
            plugins: { legend: { position: 'bottom', labels: { color: COLORS.textDim, font: { family: 'Inter', size: 10 }, padding: 10, usePointStyle: true, boxWidth: 8 } }, tooltip: tooltipStyle() }
        }
    });
}

function renderLine(id, labels, data) {
    const ctx = document.getElementById(id);
    if (!ctx) return;
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart(ctx, {
        type: 'line',
        data: { labels, datasets: [{ data, borderColor: COLORS.cyan, backgroundColor: 'rgba(0, 210, 255, 0.1)', borderWidth: 3, tension: 0.4, fill: true, pointBackgroundColor: COLORS.cyan, pointBorderColor: '#1E293B', pointBorderWidth: 2, pointRadius: 4 }] },
        options: { responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: tooltipStyle() },
            scales: { x: { ticks: { color: COLORS.textDim, font: { family: 'Inter', size: 10 } }, grid: { display: false } }, y: { beginAtZero: true, ticks: { color: COLORS.textDim }, grid: { color: 'rgba(148,163,184,0.1)' } } }
        }
    });
}

function renderStacked(id, labels, datasets) {
    const ctx = document.getElementById(id);
    if (!ctx) return;
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart(ctx, {
        type: 'bar',
        data: { labels, datasets },
        options: { responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'bottom', labels: { color: COLORS.textDim, font: { family: 'Inter', size: 10 }, usePointStyle: true, boxWidth: 8 } }, tooltip: tooltipStyle() },
            scales: { x: { stacked: true, ticks: { color: COLORS.textDim, font: { family: 'Inter', size: 10 } }, grid: { display: false } }, y: { stacked: true, beginAtZero: true, ticks: { color: COLORS.textDim }, grid: { color: 'rgba(148,163,184,0.1)' } } }
        }
    });
}

// ============ CÁLCULO PRINCIPAL ============
function calcularTodo() {
    const work = dataFiltrada;
    if (work.length === 0) return;

    // Detectar columnas
    const cProceso = col(work, 'Proceso');
    const cSubProceso = col(work, 'Sub-Proceso');
    const cTipoMtto = col(work, 'Tipo Mantto');
    const cCriticidad = colParcial(work, 'Críti');
    const cRutinaria = colParcial(work, 'Rutinaria');
    const cEmpresa = col(work, 'EMPRESA');
    const cSupervisor = colParcial(work, 'Supervisor a Cargo');
    const cDuracion = colParcial(work, 'Duración');
    const cCantPersonal = col(work, 'Cantidad de Personal');
    const cHHTotal = col(work, 'HH TOTAL');
    const cMecanico = col(work, 'Mecánico');
    const cSoldador = col(work, 'Soldador');
    const cElectricista = colParcial(work, 'Electricista Planta');
    const cInstrumentista = col(work, 'Instrumentista');
    const cPredictivo = colParcial(work, 'Predictivo y lubricaión');
    const cVigia = col(work, 'Vigia');
    const cMecHR = colParcial(work, 'Mecánico HR');
    const cSoldHR = colParcial(work, 'Soldador HR');
    const cElecHR = colParcial(work, 'Electricista Planta HR');
    const cInsHR = colParcial(work, 'Instrumentista HR');
    const cPredHR = colParcial(work, 'Predictivo y lubricaión HR');
    const cVigHR = colParcial(work, 'Vigia HR');
    const cCostoMat = colParcial(work, 'COSTO MATERIAL SAP');
    const cCostoServ = colParcial(work, 'COSTO SERVICIO');
    const cTotalSAP = colParcial(work, 'TOTAL SAP');

    // KPIs
    const totalOTs = work.length;
    let totalHoras = 0, totalHH = 0, totalPersonal = 0, totalCosto = 0;
    let criticas = 0, rutinarias = 0;
    const empresas = new Set();
    const supervisores = new Set();

    work.forEach(f => {
        totalHoras += num(f[cDuracion]);
        totalHH += num(f[cHHTotal]);
        totalPersonal += num(f[cCantPersonal]);
        totalCosto += num(f[cCostoMat]) + num(f[cCostoServ]);

        const crit = norm(f[cCriticidad]).toLowerCase();
        const rut = norm(f[cRutinaria]).toLowerCase();
        if (crit === 'sí' || crit === 'si' || crit === 'crítica' || crit === 'critica') criticas++;
        if (rut === 'sí' || rut === 'si' || rut === 'rutinaria') rutinarias++;

        if (f[cEmpresa]) empresas.add(norm(f[cEmpresa]));
        if (f[cSupervisor]) supervisores.add(norm(f[cSupervisor]));
    });

    document.getElementById('kpiRow').innerHTML = `
        ${crearKPI('fa-clipboard-list', '', 'Total OTs', totalOTs, 'Registradas')}
        ${crearKPI('fa-clock', 'icon-cyan', 'Horas Totales', totalHoras.toFixed(0), 'Duración')}
        ${crearKPI('fa-users', 'icon-green', 'HH Totales', totalHH.toFixed(0), 'Programadas')}
        ${crearKPI('fa-user-hard-hat', 'icon-yellow', 'Personal', totalPersonal, 'Asignado')}
        ${crearKPI('fa-coins', 'icon-orange', 'Costo SAP', 'S/ ' + totalCosto.toLocaleString('es-PE'), 'Material + Servicio')}
        ${crearKPI('fa-exclamation-triangle', 'icon-red', 'Críticas', criticas, 'OTs')}
    `;

    // Gráficos
    document.getElementById('chartsGrid').innerHTML = `
        ${crearChart('chartProcesos', 'fa-industry', 'OTs por Proceso')}
        ${crearChartDonut('chartTipoMtto', 'fa-tools', 'Tipo de Mantenimiento')}
        ${crearChart('chartEmpresa', 'fa-building', 'OTs por Empresa')}
        ${crearChart('chartHH', 'fa-users', 'HH por Especialidad')}
        ${crearChart('chartPlanReal', 'fa-chart-line', 'Plan vs Real HH por Empresa', true)}
        ${crearChartProgress('progressCriticidad', 'fa-gauge-high', 'Distribución por Criticidad')}
        ${crearChartTabla('fa-table', 'Detalle de OTs (Top 20)')}
    `;

    // 1. OTs por proceso
    const porProceso = {};
    work.forEach(f => {
        const p = norm(f[cProceso]) || 'Sin proceso';
        porProceso[p] = (porProceso[p] || 0) + 1;
    });
    renderBar('chartProcesos', Object.keys(porProceso), Object.values(porProceso), COLORS.accent);

    // 2. Tipo de mantenimiento (agrupando por texto en Text Orden)
    const cTexto = col(work, 'Text Orden');
    let preventivos = 0, correctivos = 0, predictivos = 0, otros = 0;
    work.forEach(f => {
        const t = norm(f[cTexto]).toLowerCase();
        if (t.includes('preventiv') || t.includes('pdp') || t.includes('pdp_')) preventivos++;
        else if (t.includes('predictiv') || t.includes('predictivo')) predictivos++;
        else if (t.includes('correctiv') || t.includes('reparac') || t.includes('cambio') || t.includes('camb ') || t.includes('instalac')) correctivos++;
        else otros++;
    });
    renderDoughnut('chartTipoMtto', ['Preventivo', 'Correctivo', 'Predictivo', 'Otros'],
        [preventivos, correctivos, predictivos, otros]);

    // 3. OTs por empresa
    const porEmpresa = {};
    work.forEach(f => {
        const e = norm(f[cEmpresa]) || 'Sin empresa';
        porEmpresa[e] = (porEmpresa[e] || 0) + 1;
    });
    renderHBar('chartEmpresa', Object.keys(porEmpresa), Object.values(porEmpresa), COLORS.cyan);

    // 4. HH por especialidad
    const hhPorEsp = {
        'Mecánico': work.reduce((a, f) => a + num(f[cMecHR]), 0),
        'Soldador': work.reduce((a, f) => a + num(f[cSoldHR]), 0),
        'Electricista': work.reduce((a, f) => a + num(f[cElecHR]), 0),
        'Instrumentista': work.reduce((a, f) => a + num(f[cInsHR]), 0),
        'Predictivo': work.reduce((a, f) => a + num(f[cPredHR]), 0),
        'Vigía': work.reduce((a, f) => a + num(f[cVigHR]), 0)
    };
    renderBar('chartHH', Object.keys(hhPorEsp), Object.values(hhPorEsp), COLORS.purple);

    // 5. Plan vs Real HH por empresa (stacked)
    const empresasList = [...new Set(work.map(f => norm(f[cEmpresa])).filter(v => v))].slice(0, 8);
    const planEmp = {}, realEmp = {};
    empresasList.forEach(e => {
        planEmp[e] = 0; realEmp[e] = 0;
    });
    work.forEach(f => {
        const e = norm(f[cEmpresa]);
        if (!empresasList.includes(e)) return;
        planEmp[e] += num(f[cDuracion]);
        realEmp[e] += num(f[cHHTotal]) / Math.max(num(f[cCantPersonal]), 1);
    });
    renderStacked('chartPlanReal', empresasList, [
        { label: 'Plan (Hrs)', data: empresasList.map(e => planEmp[e]), backgroundColor: COLORS.accent, borderRadius: 4 },
        { label: 'Real (Hrs)', data: empresasList.map(e => realEmp[e]), backgroundColor: COLORS.cyan, borderRadius: 4 }
    ]);

    // 6. Progress: Criticidad
    const cont = document.getElementById('progressCriticidad');
    cont.innerHTML = '';
    const total = criticas + rutinarias + (totalOTs - criticas - rutinarias);
    const items = [
        { label: 'Críticas', val: criticas, color: COLORS.red },
        { label: 'Rutinarias', val: rutinarias, color: COLORS.green },
        { label: 'Otras', val: totalOTs - criticas - rutinarias, color: COLORS.gray }
    ];
    items.forEach(it => {
        const pct = totalOTs > 0 ? ((it.val / totalOTs) * 100).toFixed(1) : 0;
        cont.innerHTML += `
            <div class="progress-item">
                <div class="progress-header">
                    <span class="progress-label"><i class="fas fa-circle"></i> ${it.label}</span>
                    <span class="progress-values">
                        <span class="progress-percent">${pct}%</span>
                        <span class="progress-count">${it.val}</span>
                    </span>
                </div>
                <div class="progress-bar-bg"><div class="progress-bar-fill" style="width: ${pct}%; background: ${it.color}"></div></div>
            </div>
        `;
    });

    // 7. Tabla
    const cOT = col(work, 'OT SAP');
    const cTexto2 = col(work, 'Text Orden');
    const cPrio = col(work, 'Prioridad');
    let html = '<table><thead><tr><th>OT SAP</th><th>Proceso</th><th>Empresa</th><th>Descripción</th><th>Hrs</th><th>Personal</th><th>Prioridad</th></tr></thead><tbody>';
    work.slice(0, 20).forEach(f => {
        html += `<tr>
            <td>${norm(f[cOT])}</td>
            <td>${norm(f[cProceso])}</td>
            <td>${norm(f[cEmpresa])}</td>
            <td>${norm(f[cTexto2]).substring(0, 50)}</td>
            <td>${num(f[cDuracion])}</td>
            <td>${num(f[cCantPersonal])}</td>
            <td>${norm(f[cPrio])}</td>
        </tr>`;
    });
    html += '</tbody></table>';
    document.getElementById('tablaResumen').innerHTML = html;

    const center = document.getElementById('centerTotal');
    if (center) center.textContent = totalOTs;
}

// ============ FILTROS ============
function cargarFiltros() {
    const work = hojas['WORKLIST'] || [];
    llenarSelect('filterProceso', work, 'Proceso');
    llenarSelect('filterSubProceso', work, 'Sub-Proceso');
    llenarSelect('filterEmpresa', work, 'EMPRESA');
    llenarSelect('filterSupervisor', work, 'Supervisor a Cargo');
    llenarSelect('filterCriticidad', work, 'Criticidad');
}

function llenarSelect(id, data, columna) {
    const select = document.getElementById(id);
    if (!select) return;
    const c = col(data, columna) || colParcial(data, columna);
    if (!c) return;
    const valores = [...new Set(data.map(f => norm(f[c])).filter(v => v !== ''))];
    select.innerHTML = `<option value="">${columna}</option>`;
    valores.sort().forEach(v => {
        const opt = document.createElement('option');
        opt.value = v;
        opt.textContent = v;
        select.appendChild(opt);
    });
}

function aplicarFiltros() {
    const proceso = document.getElementById('filterProceso').value;
    const subProceso = document.getElementById('filterSubProceso').value;
    const empresa = document.getElementById('filterEmpresa').value;
    const supervisor = document.getElementById('filterSupervisor').value;
    const criticidad = document.getElementById('filterCriticidad').value;

    const work = hojas['WORKLIST'] || [];
    const cProceso = col(work, 'Proceso');
    const cSubProceso = col(work, 'Sub-Proceso');
    const cEmpresa = col(work, 'EMPRESA');
    const cSupervisor = colParcial(work, 'Supervisor a Cargo');
    const cCriticidad = colParcial(work, 'Crítico');

    dataFiltrada = work.filter(f => {
        if (proceso && norm(f[cProceso]) !== proceso) return false;
        if (subProceso && norm(f[cSubProceso]) !== subProceso) return false;
        if (empresa && norm(f[cEmpresa]) !== empresa) return false;
        if (supervisor && norm(f[cSupervisor]) !== supervisor) return false;
        if (criticidad && norm(f[cCriticidad]) !== criticidad) return false;
        return true;
    });

    calcularTodo();
}

document.getElementById('clearFilters')?.addEventListener('click', () => {
    document.querySelectorAll('.filter-select').forEach(sel => sel.value = '');
    dataFiltrada = hojas['WORKLIST'] || [];
    calcularTodo();
});

cargarDatos();