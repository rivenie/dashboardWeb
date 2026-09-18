/* ============ VARIABLES GLOBALES ============ */
let workbookData = null;
let dataGlobal = [];
let charts = {};

/* ============ ELEMENTOS DOM ============ */
const fileInput = document.getElementById('excelFile');
const sheetSelector = document.getElementById('sheetSelector');
const sheetSelect = document.getElementById('sheetSelect');
const tableContainer = document.getElementById('tableContainer');
const readerSection = document.getElementById('readerSection');
const dashboardSection = document.getElementById('dashboardSection');
const btnDashboard = document.getElementById('btnDashboard');
const btnVolver = document.getElementById('btnVolver');

/* ============ LECTOR DE EXCEL ============ */
fileInput.addEventListener('change', function (e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();

    reader.onload = function (event) {
        const data = new Uint8Array(event.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        workbookData = workbook;

        sheetSelect.innerHTML = '';
        workbook.SheetNames.forEach((name) => {
            const option = document.createElement('option');
            option.value = name;
            option.textContent = name;
            sheetSelect.appendChild(option);
        });

        sheetSelector.style.display = 'flex';

        mostrarTabla(workbook.SheetNames[0]);
    };

    reader.readAsArrayBuffer(file);
});

sheetSelect.addEventListener('change', function () {
    mostrarTabla(this.value);
});

function mostrarTabla(nombrePestaña) {
    const worksheet = workbookData.Sheets[nombrePestaña];
    const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

    if (rows.length === 0) {
        tableContainer.innerHTML = '<p>La pestaña está vacía.</p>';
        return;
    }

    // Guardar datos en memoria
    const headers = rows[0];
    dataGlobal = rows.slice(1).map(row => {
        const obj = {};
        headers.forEach((h, i) => {
            obj[h] = row[i];
        });
        return obj;
    });

    // Renderizar tabla
    let html = '<table>';
    html += '<thead><tr>';
    rows[0].forEach((header) => {
        html += `<th>${header || ''}</th>`;
    });
    html += '</tr></thead>';

    html += '<tbody>';
    for (let i = 1; i < rows.length; i++) {
        html += '<tr>';
        rows[0].forEach((_, index) => {
            html += `<td>${rows[i][index] !== undefined ? rows[i][index] : ''}</td>`;
        });
        html += '</tr>';
    }
    html += '</tbody>';
    html += '</table>';
    tableContainer.innerHTML = html;
}

/* ============ NAVEGACIÓN ============ */
btnDashboard.addEventListener('click', function () {
    if (!dataGlobal || dataGlobal.length === 0) {
        alert('Primero carga un archivo Excel.');
        return;
    }

    readerSection.style.display = 'none';
    dashboardSection.style.display = 'flex';

    inicializarDashboard();
});

btnVolver.addEventListener('click', function () {
    dashboardSection.style.display = 'none';
    readerSection.style.display = 'block';
});

/* ============ DASHBOARD ============ */
function inicializarDashboard() {
    if (!dataGlobal || dataGlobal.length === 0) return;

    calcularKPIs();
    cargarFiltros();
    crearGraficos();
    crearTablaResumen();

    document.querySelectorAll('.filter-select').forEach(sel => {
        sel.removeEventListener('change', aplicarFiltros);
        sel.addEventListener('change', aplicarFiltros);
    });
}

/* ============ CÁLCULOS ============ */
function obtenerColumnas(clave) {
    const keys = Object.keys(dataGlobal[0]);
    return keys.find(k => k.trim().toLowerCase() === clave.trim().toLowerCase());
}

function formatearMoneda(valor) {
    return '$' + valor.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function calcularKPIs() {
    const colStock = obtenerColumnas('Stock');
    const colPrecio = obtenerColumnas('Precio');
    const colSentido = obtenerColumnas('Sentido');
    const colImporte = obtenerColumnas('Importe');
    const colCantidad = obtenerColumnas('Cantidad');

    let stockValorizado = 0;
    let ingresoValorizado = 0;
    let salidaValorizado = 0;
    let totalSalidas = 0;
    let totalStock = 0;

    dataGlobal.forEach(fila => {
        const stock = parseFloat(fila[colStock]) || 0;
        const precio = parseFloat(fila[colPrecio]) || 0;
        const sentido = (fila[colSentido] || '').toString().toLowerCase();
        const importe = parseFloat(fila[colImporte]) || 0;
        const cantidad = parseFloat(fila[colCantidad]) || 0;

        stockValorizado += stock * precio;
        totalStock += stock;

        if (sentido === 'entrada') ingresoValorizado += importe;
        else if (sentido === 'salida') {
            salidaValorizado += importe;
            totalSalidas += cantidad;
        }
    });

    const rotacion = totalStock > 0 ? (totalSalidas / totalStock).toFixed(2) : 0;
    const eri = totalSalidas > 0 ? ((totalSalidas / (totalStock + totalSalidas)) * 100).toFixed(2) : 0;

    document.getElementById('kpiStock').textContent = formatearMoneda(stockValorizado);
    document.getElementById('kpiIngreso').textContent = formatearMoneda(ingresoValorizado);
    document.getElementById('kpiSalida').textContent = formatearMoneda(salidaValorizado);
    document.getElementById('kpiRotacion').textContent = rotacion;
    document.getElementById('kpiEri').textContent = eri + '%';
}

/* ============ FILTROS ============ */
function extraerMes(fecha) {
    if (!fecha) return '';
    // Si es número (formato Excel)
    if (typeof fecha === 'number') {
        const date = new Date((fecha - 25569) * 86400 * 1000);
        const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
        return meses[date.getMonth()] || '';
    }
    // Si es string DD/MM/YYYY
    const partes = fecha.toString().split('/');
    if (partes.length === 3) {
        const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
        return meses[parseInt(partes[1]) - 1] || '';
    }
    return '';
}

function cargarFiltros() {
    llenarSelect('filterMes', 'Fecha', extraerMes);
    llenarSelect('filterAlmacen', 'Almacén');
    llenarSelect('filterDelegacion', 'Delegación');
    llenarSelect('filterSentido', 'Sentido');
    llenarSelect('filterTipo', 'Tipo');
    llenarSelect('filterArticulo', 'Denominación');
}

function llenarSelect(id, columna, transformacion) {
    const select = document.getElementById(id);
    if (!select) return;

    const col = obtenerColumnas(columna);
    if (!col) return;

    const valores = [...new Set(dataGlobal.map(f => {
        const valor = f[col];
        return transformacion ? transformacion(valor) : valor;
    }).filter(v => v !== undefined && v !== ''))];

    select.innerHTML = '<option value="">Todos</option>';
    valores.sort().forEach(v => {
        const opt = document.createElement('option');
        opt.value = v;
        opt.textContent = v;
        select.appendChild(opt);
    });
}

function aplicarFiltros() {
    const mes = document.getElementById('filterMes').value;
    const almacen = document.getElementById('filterAlmacen').value;
    const delegacion = document.getElementById('filterDelegacion').value;
    const sentido = document.getElementById('filterSentido').value;
    const tipo = document.getElementById('filterTipo').value;
    const articulo = document.getElementById('filterArticulo').value;

    const colFecha = obtenerColumnas('Fecha');
    const colAlmacen = obtenerColumnas('Almacén');
    const colDelegacion = obtenerColumnas('Delegación');
    const colSentido = obtenerColumnas('Sentido');
    const colTipo = obtenerColumnas('Tipo');
    const colArticulo = obtenerColumnas('Denominación');

    const filtrados = dataGlobal.filter(f => {
        if (mes && extraerMes(f[colFecha]) !== mes) return false;
        if (almacen && f[colAlmacen] !== almacen) return false;
        if (delegacion && f[colDelegacion] !== delegacion) return false;
        if (sentido && f[colSentido] !== sentido) return false;
        if (tipo && f[colTipo] !== tipo) return false;
        if (articulo && f[colArticulo] !== articulo) return false;
        return true;
    });

    // Guardar backup
    const backup = dataGlobal;
    dataGlobal = filtrados;

    calcularKPIs();
    crearGraficos();
    crearTablaResumen();

    // Restaurar
    dataGlobal = backup;
}

/* ============ GRÁFICOS ============ */
function crearGraficos() {
    const colFecha = obtenerColumnas('Fecha');
    const colSentido = obtenerColumnas('Sentido');
    const colTipo = obtenerColumnas('Tipo');
    const colStock = obtenerColumnas('Stock');

    // Barras: Movimientos por mes
    const movPorMes = {};
    dataGlobal.forEach(f => {
        const mes = extraerMes(f[colFecha]);
        if (!mes) return;
        movPorMes[mes] = (movPorMes[mes] || 0) + 1;
    });
    renderChart('chartBarras', 'bar', Object.keys(movPorMes), Object.values(movPorMes), 'Movimientos');

    // Columnas: Entradas vs Salidas
    let entradas = 0, salidas = 0;
    dataGlobal.forEach(f => {
        const s = (f[colSentido] || '').toString().toLowerCase();
        if (s === 'entrada') entradas++;
        else if (s === 'salida') salidas++;
    });
    renderChart('chartColumnas', 'bar', ['Entradas', 'Salidas'], [entradas, salidas], 'Cantidad');

    // Anillo: Distribución por tipo
    const porTipo = {};
    dataGlobal.forEach(f => {
        const t = f[colTipo] || 'Sin tipo';
        porTipo[t] = (porTipo[t] || 0) + 1;
    });
    renderChart('chartAnillo', 'doughnut', Object.keys(porTipo), Object.values(porTipo), 'Movimientos');

    // Líneas: Evolución de stock por mes
    const stockPorMes = {};
    dataGlobal.forEach(f => {
        const mes = extraerMes(f[colFecha]);
        const stock = parseFloat(f[colStock]) || 0;
        if (!mes) return;
        stockPorMes[mes] = (stockPorMes[mes] || 0) + stock;
    });
    renderChart('chartLineas', 'line', Object.keys(stockPorMes), Object.values(stockPorMes), 'Stock');
}

function renderChart(id, tipo, labels, data, label) {
    const ctx = document.getElementById(id);
    if (!ctx) return;

    if (charts[id]) charts[id].destroy();

    charts[id] = new Chart(ctx, {
        type: tipo,
        data: {
            labels: labels,
            datasets: [{
                label: label,
                data: data,
                backgroundColor: [
                    '#2563eb', '#059669', '#dc2626', '#ea580c',
                    '#7c3aed', '#0891b2', '#65a30d', '#db2777'
                ],
                borderColor: '#1e293b',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: tipo === 'doughnut' || tipo === 'pie' }
            },
            scales: tipo === 'doughnut' || tipo === 'pie' ? {} : {
                y: { beginAtZero: true }
            }
        }
    });
}

/* ============ TABLA RESUMEN ============ */
function crearTablaResumen() {
    const colAlmacen = obtenerColumnas('Almacén');
    const colStock = obtenerColumnas('Stock');
    const colPrecio = obtenerColumnas('Precio');
    const colArticulo = obtenerColumnas('Denominación');

    const resumen = {};

    dataGlobal.forEach(f => {
        const almacen = f[colAlmacen] || 'Sin almacén';
        const stock = parseFloat(f[colStock]) || 0;
        const precio = parseFloat(f[colPrecio]) || 0;

        if (!resumen[almacen]) {
            resumen[almacen] = { articulos: new Set(), stock: 0, valorizado: 0 };
        }

        resumen[almacen].articulos.add(f[colArticulo]);
        resumen[almacen].stock += stock;
        resumen[almacen].valorizado += stock * precio;
    });

    let html = '<table><thead><tr><th>Almacén</th><th>Artículos</th><th>Stock Total</th><th>Valorizado</th></tr></thead><tbody>';

    Object.entries(resumen).forEach(([almacen, datos]) => {
        html += `<tr>
            <td>${almacen}</td>
            <td>${datos.articulos.size}</td>
            <td>${datos.stock}</td>
            <td>${formatearMoneda(datos.valorizado)}</td>
        </tr>`;
    });

    html += '</tbody></table>';
    document.getElementById('tablaResumen').innerHTML = html;
}

/* ============ LIMPIAR FILTROS ============ */
document.getElementById('clearFilters')?.addEventListener('click', () => {
    document.querySelectorAll('.filter-select').forEach(sel => {
        sel.value = '';
    });
    aplicarFiltros();
});
