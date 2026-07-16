// ---------------------------------------------------------
// Estado global
// ---------------------------------------------------------
const state = {
  businessUnits: [],
  selectedBU: null,
  view: 'dashboard',
  cache: {}, // suppliers, customers, warehouses, articles, projects, cashBoxes
  currentUser: null,
};

const fmtMoney = (n) => Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtQty = (n) => Number(n).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
function fmtDate(value) {
  if (!value) return '-';
  let str = value instanceof Date ? value.toISOString() : String(value);
  if (!/Z$|[+-]\d\d:?\d\d$/.test(str)) str += 'Z'; // forzar UTC si no trae zona horaria
  const d = new Date(str);
  if (isNaN(d.getTime())) return '-';
  return d.toLocaleString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// ---------------------------------------------------------
// Auth
// ---------------------------------------------------------
function getToken() { return sessionStorage.getItem('erp_token'); }
function setToken(t) { sessionStorage.setItem('erp_token', t); }
function clearToken() { sessionStorage.removeItem('erp_token'); }

async function doLogin() {
  const username = document.getElementById('loginUser').value;
  const password = document.getElementById('loginPass').value;
  const errEl = document.getElementById('loginError');
  errEl.textContent = '';
  try {
    const res = await fetch('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) { errEl.textContent = data.error || 'Error al ingresar'; return; }
    setToken(data.token);
    state.currentUser = data.user;
    await boot();
  } catch (e) {
    errEl.textContent = 'No se pudo conectar con el servidor.';
  }
}
function doLogout() {
  clearToken();
  state.currentUser = null;
  document.getElementById('appShell').style.display = 'none';
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('loginUser').value = '';
  document.getElementById('loginPass').value = '';
}

// ---------------------------------------------------------
// API helper
// ---------------------------------------------------------
async function api(path, opts = {}) {
  const token = getToken();
  const res = await fetch(path, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...opts,
  });
  if (res.status === 401) {
    doLogout();
    throw new Error('Sesión expirada. Volvé a ingresar.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Error de red');
  return data;
}

// ---------------------------------------------------------
// Toasts
// ---------------------------------------------------------
function toast(msg, type = 'success') {
  const stack = document.getElementById('toastStack');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  stack.appendChild(el);
  setTimeout(() => el.remove(), 3800);
}

// ---------------------------------------------------------
// Modal helper
// ---------------------------------------------------------
function openModal(innerHtml) {
  const backdrop = document.getElementById('modalBackdrop');
  const modal = document.getElementById('modal');
  modal.innerHTML = innerHtml;
  backdrop.classList.add('show');
  backdrop.onclick = (e) => { if (e.target === backdrop) closeModal(); };
}
function closeModal() {
  document.getElementById('modalBackdrop').classList.remove('show');
}

// ---------------------------------------------------------
// Conexión
// ---------------------------------------------------------
async function checkConnection() {
  const statusEl = document.getElementById('connStatus');
  try {
    await api('/business-units');
    statusEl.className = 'conn-status ok';
    statusEl.querySelector('.conn-text').textContent = 'Conectado';
  } catch (e) {
    statusEl.className = 'conn-status err';
    statusEl.querySelector('.conn-text').textContent = 'Sin conexión';
  }
}

// ---------------------------------------------------------
// Carga inicial
// ---------------------------------------------------------
async function loadBusinessUnits() {
  state.businessUnits = await api('/business-units');
  const sel = document.getElementById('buSelect');
  sel.innerHTML = state.businessUnits.map(bu => `<option value="${bu.id}">${bu.name}</option>`).join('');
  state.selectedBU = state.selectedBU && state.businessUnits.some(b => b.id === state.selectedBU) ? state.selectedBU : (state.businessUnits[0]?.id || null);
  sel.value = state.selectedBU;
  sel.onchange = () => { state.selectedBU = Number(sel.value); applyBUTheme(); renderView(); };
  applyBUTheme();
}

const BU_THEME = {
  reiger: { logo: 'assets/icons/reiger.png', accent: '#B9006E' },
  endless: { logo: 'assets/icons/endless.png', accent: '#B89B2E' },
  sadev: { logo: 'assets/icons/sadev.png', accent: '#3E7CD6' },
  peugeot: { logo: 'assets/icons/peugeot.png', accent: '#8A8A8A' },
  kw: { logo: 'assets/icons/kw.png', accent: '#6A2C91' },
};
function applyBUTheme() {
  const bu = state.businessUnits.find(b => b.id === state.selectedBU);
  const key = Object.keys(BU_THEME).find(k => (bu?.name || '').toLowerCase().includes(k));
  const theme = BU_THEME[key] || { logo: 'assets/logo.jpg', accent: '#2F6F4E' };
  document.getElementById('brandLogo').src = theme.logo;
  document.documentElement.style.setProperty('--bu-accent', theme.accent);
  const watermark = document.getElementById('topbarWatermark');
  if (watermark) watermark.src = theme.logo;
}

function newBusinessUnitModal() {
  openModal(`
    <h2>Nueva unidad de negocio</h2>
    <div class="field"><label>Nombre</label><input id="f_bu_name" placeholder="Ej: Nueva Sucursal"></div>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="createBusinessUnit()">Guardar</button>
    </div>
  `);
}
async function createBusinessUnit() {
  try {
    const bu = await api('/business-units', { method: 'POST', body: JSON.stringify({ name: document.getElementById('f_bu_name').value }) });
    closeModal();
    toast('Unidad de negocio creada.');
    await loadBusinessUnits();
    state.selectedBU = bu.id;
    document.getElementById('buSelect').value = bu.id;
    renderView();
  } catch (e) { toast(e.message, 'error'); }
}
async function deleteCurrentBusinessUnit() {
  const bu = state.businessUnits.find(b => b.id === state.selectedBU);
  if (!bu) return;
  if (!confirm(`¿Eliminar la unidad de negocio "${bu.name}"? Se perderán sus proyectos, artículos y depósitos asociados.`)) return;
  const typed = prompt(`Para confirmar, escribí exactamente el nombre de la unidad: "${bu.name}"`);
  if (typed !== bu.name) { toast('El nombre no coincide. No se eliminó nada.', 'error'); return; }
  try {
    await api(`/business-units/${bu.id}`, { method: 'DELETE' });
    toast('Unidad de negocio eliminada.');
    await loadBusinessUnits();
    await loadMasterData();
    renderView();
  } catch (e) { toast(e.message, 'error'); }
}

async function loadMasterData() {
  const [suppliers, customers, warehouses, articles, projects, cashBoxes] = await Promise.all([
    api('/suppliers'), api('/customers'), api('/warehouses'), api('/articles'), api('/projects'), api('/cash-boxes'),
  ]);
  state.cache = { suppliers, customers, warehouses, articles, projects, cashBoxes };
}
async function refreshSuppliers() { state.cache.suppliers = await api('/suppliers'); }
async function refreshCustomers() { state.cache.customers = await api('/customers'); }
async function refreshWarehouses() { state.cache.warehouses = await api('/warehouses'); }
async function refreshArticles() { state.cache.articles = await api('/articles'); }
async function refreshProjects() { state.cache.projects = await api('/projects'); }
async function refreshCashBoxes() { state.cache.cashBoxes = await api('/cash-boxes'); }

function whByBU() { return state.cache.warehouses.filter(w => w.business_unit_id === state.selectedBU); }
function artByBU() { return state.cache.articles.filter(a => a.business_unit_id === state.selectedBU); }
function projByBU() { return state.cache.projects.filter(p => p.business_unit_id === state.selectedBU); }

// ---------------------------------------------------------
// Navegación
// ---------------------------------------------------------
const viewTitles = {
  dashboard: 'Panel', manualmovement: 'Registrar movimiento', stock: 'Stock', purchases: 'Compras', sales: 'Ventas', quotes: 'Presupuestos',
  articles: 'Artículos', warehouses: 'Depósitos', suppliers: 'Proveedores',
  customers: 'Clientes', projects: 'Proyectos', cash: 'Caja', users: 'Usuarios', debtors: 'Deudores', reports: 'Reportes',
};

document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.view = btn.dataset.view;
    renderView();
  });
});

async function renderView() {
  document.getElementById('viewTitle').textContent = viewTitles[state.view];
  document.getElementById('viewActions').innerHTML = '';
  const el = document.getElementById('view');
  el.innerHTML = '<div class="empty-state">Cargando…</div>';
  try {
    switch (state.view) {
      case 'dashboard': await renderDashboard(); break;
      case 'reports': await renderReports(); break;
      case 'manualmovement': await renderManualMovement(); break;
      case 'stock': await renderStock(); break;
      case 'purchases': await renderPurchases(); break;
      case 'sales': await renderSales(); break;
      case 'quotes': await renderQuotes(); break;
      case 'articles': await renderArticles(); break;
      case 'warehouses': await renderWarehouses(); break;
      case 'suppliers': await renderSuppliers(); break;
      case 'customers': await renderCustomers(); break;
      case 'projects': await renderProjects(); break;
      case 'cash': await renderCash(); break;
      case 'users': await renderUsers(); break;
      case 'debtors': await renderDebtors(); break;
    }
  } catch (e) {
    el.innerHTML = `<div class="empty-state">Error: ${e.message}<br><button class="btn btn-sm" style="margin-top:10px" onclick="renderView()">Reintentar</button></div>`;
  }
}

// ---------------------------------------------------------
// DASHBOARD
// ---------------------------------------------------------
function fmtDateInput(d) {
  return d.toISOString().slice(0, 10);
}
function getMonthRange(offsetMonths) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() + offsetMonths, 1);
  const end = new Date(now.getFullYear(), now.getMonth() + offsetMonths + 1, 0);
  return { from: fmtDateInput(start), to: fmtDateInput(end) };
}

let reportsDateFrom = '';
let reportsDateTo = '';

async function renderReports() {
  document.getElementById('viewActions').innerHTML = '';
  const el = document.getElementById('view');

  if (!reportsDateFrom || !reportsDateTo) {
    const thisMonth = getMonthRange(0);
    reportsDateFrom = thisMonth.from;
    reportsDateTo = thisMonth.to;
  }

  // Calcular el período anterior de igual duración, inmediatamente antes
  const from = new Date(reportsDateFrom);
  const to = new Date(reportsDateTo);
  const durationMs = to.getTime() - from.getTime();
  const prevTo = new Date(from.getTime() - 24 * 60 * 60 * 1000);
  const prevFrom = new Date(prevTo.getTime() - durationMs);

  const [current, previous] = await Promise.all([
    api(`/reports/pnl?business_unit_id=${state.selectedBU}&date_from=${reportsDateFrom}&date_to=${reportsDateTo}`),
    api(`/reports/pnl?business_unit_id=${state.selectedBU}&date_from=${fmtDateInput(prevFrom)}&date_to=${fmtDateInput(prevTo)}`),
  ]);

  const pctChange = (curr, prev) => {
    if (prev === 0) return curr === 0 ? 0 : 100;
    return ((curr - prev) / Math.abs(prev)) * 100;
  };
  const changeHtml = (curr, prev, invert) => {
    const pct = pctChange(curr, prev);
    const positive = invert ? pct <= 0 : pct >= 0;
    const arrow = pct >= 0 ? '▲' : '▼';
    return `<span class="${positive ? 'income' : 'expense'}" style="font-size:12px;font-weight:600">${arrow} ${Math.abs(pct).toFixed(1)}%</span>`;
  };

  el.innerHTML = `
    <div class="card">
      <div class="section-toolbar">
        <div class="card-title" style="margin:0">Período</div>
        <div style="display:flex;gap:8px;align-items:center">
          <button class="btn btn-sm" onclick="reportsSetMonth(-1)">Mes anterior</button>
          <button class="btn btn-sm" onclick="reportsSetMonth(0)">Este mes</button>
          <input type="date" id="reportsDateFrom" value="${reportsDateFrom}" onchange="reportsApplyDateFilter()">
          <span class="hint">a</span>
          <input type="date" id="reportsDateTo" value="${reportsDateTo}" onchange="reportsApplyDateFilter()">
        </div>
      </div>
      <div class="hint">Comparado contra el período inmediato anterior de igual duración (${fmtDateInput(prevFrom)} a ${fmtDateInput(prevTo)}).</div>
    </div>

    <div class="kpi-row">
      <div class="kpi">
        <div class="kpi-label">Ventas confirmadas</div>
        <div class="kpi-value income">$ ${fmtMoney(current.sales_total)}</div>
        <div style="margin-top:6px">${changeHtml(current.sales_total, previous.sales_total, false)}</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Compras confirmadas</div>
        <div class="kpi-value expense">$ ${fmtMoney(current.purchases_total)}</div>
        <div style="margin-top:6px">${changeHtml(current.purchases_total, previous.purchases_total, true)}</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Otros ingresos manuales (general)</div>
        <div class="kpi-value income">$ ${fmtMoney(current.manual_income)}</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Gastos manuales (general)</div>
        <div class="kpi-value expense">$ ${fmtMoney(current.manual_expense)}</div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">Estado de resultados — ${reportsDateFrom} a ${reportsDateTo}</div>
      <table class="ledger">
        <thead><tr><th>Concepto</th><th style="text-align:right">Período actual</th><th style="text-align:right">Período anterior</th><th style="text-align:right">Variación</th></tr></thead>
        <tbody>
          <tr><td>Ventas</td><td class="num income">$ ${fmtMoney(current.sales_total)}</td><td class="num">$ ${fmtMoney(previous.sales_total)}</td><td class="num">${changeHtml(current.sales_total, previous.sales_total, false)}</td></tr>
          <tr><td>Compras (costo)</td><td class="num expense">$ ${fmtMoney(current.purchases_total)}</td><td class="num">$ ${fmtMoney(previous.purchases_total)}</td><td class="num">${changeHtml(current.purchases_total, previous.purchases_total, true)}</td></tr>
          <tr><td>Otros ingresos</td><td class="num income">$ ${fmtMoney(current.manual_income)}</td><td class="num">$ ${fmtMoney(previous.manual_income)}</td><td class="num">-</td></tr>
          <tr><td>Gastos operativos</td><td class="num expense">$ ${fmtMoney(current.manual_expense)}</td><td class="num">$ ${fmtMoney(previous.manual_expense)}</td><td class="num">-</td></tr>
          <tr><td><strong>Resultado neto</strong></td>
              <td class="num ${current.net_result >= 0 ? 'income' : 'expense'}"><strong>$ ${fmtMoney(current.net_result)}</strong></td>
              <td class="num ${previous.net_result >= 0 ? 'income' : 'expense'}"><strong>$ ${fmtMoney(previous.net_result)}</strong></td>
              <td class="num">${changeHtml(current.net_result, previous.net_result, false)}</td></tr>
        </tbody>
      </table>
      <div class="hint" style="margin-top:10px">Ventas y compras cuentan las confirmadas de esta unidad en el período. Los ingresos/gastos manuales de Caja son <strong>generales</strong> (compartidos entre todas las unidades, porque las cajas y sobres no son exclusivos de una sola empresa) — por eso muestran el mismo valor sin importar qué unidad tengas seleccionada arriba.</div>
    </div>
  `;
}
function reportsSetMonth(offset) {
  const range = getMonthRange(offset);
  reportsDateFrom = range.from;
  reportsDateTo = range.to;
  renderView();
}
function reportsApplyDateFilter() {
  reportsDateFrom = document.getElementById('reportsDateFrom').value;
  reportsDateTo = document.getElementById('reportsDateTo').value;
  renderView();
}

async function renderDashboard() {
  const el = document.getElementById('view');
  const [purchases, sales, stock, profitability] = await Promise.all([
    api('/purchases'), api('/sales'), api('/stock'), api('/projects/profitability'),
  ]);
  const buPurchases = purchases.filter(p => p.business_unit_id === state.selectedBU);
  const buSales = sales.filter(s => s.business_unit_id === state.selectedBU);
  const buWarehouseIds = whByBU().map(w => w.id);
  const buStock = stock.filter(s => buWarehouseIds.includes(s.warehouse_id));
  const buProjects = projByBU();
  const buProfit = profitability.filter(p => buProjects.some(bp => bp.id === p.project_id));

  const totalPurchases = buPurchases.filter(p => p.status === 'CONFIRMED').reduce((a, p) => a + Number(p.total_amount), 0);
  const totalSales = buSales.filter(s => s.status === 'CONFIRMED').reduce((a, s) => a + Number(s.total_amount), 0);
  const stockUnits = buStock.reduce((a, s) => a + Number(s.quantity), 0);

  el.innerHTML = `
    <div class="kpi-row">
      <div class="kpi"><div class="kpi-label">Ventas confirmadas</div><div class="kpi-value income">$ ${fmtMoney(totalSales)}</div></div>
      <div class="kpi"><div class="kpi-label">Compras confirmadas</div><div class="kpi-value expense">$ ${fmtMoney(totalPurchases)}</div></div>
      <div class="kpi"><div class="kpi-label">Unidades en stock</div><div class="kpi-value">${fmtQty(stockUnits)}</div></div>
      <div class="kpi"><div class="kpi-label">Proyectos activos</div><div class="kpi-value">${buProjects.length}</div></div>
    </div>

    <div class="card">
      <div class="card-title">Rentabilidad por proyecto (centro de costos)</div>
      ${tableOrEmpty(buProfit, ['Proyecto', 'Ingresos', 'Egresos', 'Resultado'], (p) => `
        <tr>
          <td>${p.project_name}</td>
          <td class="num income">$ ${fmtMoney(p.total_income)}</td>
          <td class="num expense">$ ${fmtMoney(p.total_expense)}</td>
          <td class="num ${p.net_result >= 0 ? 'income' : 'expense'}">$ ${fmtMoney(p.net_result)}</td>
        </tr>`, 'No hay proyectos con movimientos todavía.')}
    </div>

    <div class="card">
      <div class="card-title">Últimas operaciones</div>
      ${tableOrEmpty(
        [...buPurchases.map(p => ({ ...p, kind: 'Compra' })), ...buSales.map(s => ({ ...s, kind: 'Venta' }))]
          .sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 8),
        ['Tipo', 'Fecha', 'Estado', 'Total'],
        (o) => `
        <tr>
          <td>${o.kind}</td>
          <td class="mono">${fmtDate(o.date)}</td>
          <td>${statusBadge(o.status)}</td>
          <td class="num">$ ${fmtMoney(o.total_amount)}</td>
        </tr>`, 'Sin operaciones registradas.')}
    </div>
  `;
}

function statusBadge(status) {
  const map = { PENDING: 'pending', CONFIRMED: 'confirmed', CANCELLED: 'cancelled', OPEN: 'open', CLOSED: 'closed' };
  const label = { PENDING: 'Pendiente', CONFIRMED: 'Confirmada', CANCELLED: 'Cancelada', OPEN: 'Abierta', CLOSED: 'Cerrada' };
  return `<span class="badge badge-${map[status] || 'pending'}">${label[status] || status}</span>`;
}

function tableOrEmpty(rows, headers, rowFn, emptyMsg) {
  if (!rows.length) return `<div class="empty-state">${emptyMsg}</div>`;
  return `
    <table class="ledger sortable-table">
      <thead><tr>${headers.map((h, i) => h ? `<th class="sortable-th" onclick="sortTableByColumn(this)" data-dir="">${h}<span class="sort-indicator"></span></th>` : `<th></th>`).join('')}</tr></thead>
      <tbody>${rows.map(rowFn).join('')}</tbody>
    </table>`;
}

function sortTableByColumn(th) {
  const table = th.closest('table');
  const tbody = table.querySelector('tbody');
  const ths = [...th.parentElement.children];
  const colIndex = ths.indexOf(th);
  const currentDir = th.dataset.dir === 'asc' ? 'desc' : 'asc';

  ths.forEach(t => {
    t.dataset.dir = '';
    const ind = t.querySelector('.sort-indicator');
    if (ind) ind.textContent = '';
  });
  th.dataset.dir = currentDir;
  const thisIndicator = th.querySelector('.sort-indicator');
  if (thisIndicator) thisIndicator.textContent = currentDir === 'asc' ? ' ▲' : ' ▼';

  const rows = [...tbody.querySelectorAll('tr')];
  const parseCell = (tr) => {
    const cell = tr.children[colIndex];
    const text = cell ? cell.textContent.trim() : '';
    const numeric = text.replace(/[^0-9.,\-]/g, '').replace(/\.(?=.*\.)/g, '').replace(',', '.');
    const num = parseFloat(numeric);
    return { text: text.toLowerCase(), num: isNaN(num) ? null : num };
  };

  rows.sort((a, b) => {
    const pa = parseCell(a), pb = parseCell(b);
    let cmp;
    if (pa.num !== null && pb.num !== null) cmp = pa.num - pb.num;
    else cmp = pa.text.localeCompare(pb.text, 'es');
    return currentDir === 'asc' ? cmp : -cmp;
  });

  rows.forEach(r => tbody.appendChild(r));
}

// ---------------------------------------------------------
// STOCK
// ---------------------------------------------------------
async function renderStock() {
  document.getElementById('viewActions').innerHTML = `
    <button class="btn btn-sm" onclick="openStockAdjustModal()">Ajustar stock</button>
    <button class="btn btn-primary" onclick="openStockTransferModal()">Transferir entre depósitos</button>`;
  const el = document.getElementById('view');
  const stock = await api('/stock');
  const buWarehouseIds = whByBU().map(w => w.id);
  const rows = stock.filter(s => buWarehouseIds.includes(s.warehouse_id));

  el.innerHTML = `
    <div class="card">
      <div class="card-title">Stock por depósito — unidad seleccionada</div>
      ${tableOrEmpty(rows, ['Código', 'Artículo', 'Depósito', 'Cantidad', ''], (s) => `
        <tr>
          <td class="mono">${s.code}</td>
          <td>${s.description}</td>
          <td>${s.warehouse_name}</td>
          <td class="num">${fmtQty(s.quantity)}</td>
          <td>
            <button class="btn btn-sm" onclick="showKardex(${s.article_id}, '${s.description.replace(/'/g, "\\'")}')">Kardex</button>
            <button class="btn btn-sm btn-danger" onclick="quickRemoveStock(${s.article_id}, ${s.warehouse_id}, '${s.description.replace(/'/g, "\\'")}', ${s.quantity})">Quitar unidades</button>
            <button class="btn btn-sm btn-danger" onclick="deleteStockRow(${s.id}, '${s.description.replace(/'/g, "\\'")}')">Eliminar registro</button>
          </td>
        </tr>`, 'No hay stock cargado en esta unidad todavía. Cargá una compra confirmada para generar stock.')}
    </div>
  `;
}

function articleItemsList() {
  return artByBU().map(a => ({ id: a.article_id, label: `${a.code} — ${a.description}` }));
}
function warehouseItemsList() {
  return whByBU().map(w => ({ id: w.id, label: w.name }));
}

function openStockTransferModal() {
  const artItems = articleItemsList();
  const whItems = warehouseItemsList();
  openModal(`
    <h2>Transferir stock entre depósitos</h2>
    <div class="field"><label>Artículo</label>${searchableSelectHtml('transfer_article', artItems, 'Buscar artículo…')}</div>
    <div class="field-row">
      <div class="field"><label>Depósito origen</label>${searchableSelectHtml('transfer_from', whItems, 'Buscar depósito…')}</div>
      <div class="field"><label>Depósito destino</label>${searchableSelectHtml('transfer_to', whItems, 'Buscar depósito…')}</div>
    </div>
    <div class="field"><label>Cantidad</label><input id="f_transfer_qty" type="number" step="0.001" placeholder="0"></div>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="submitStockTransfer()">Transferir</button>
    </div>
  `);
}
async function submitStockTransfer() {
  try {
    await api('/stock/transfer', {
      method: 'POST',
      body: JSON.stringify({
        article_id: Number(getSearchableValue('transfer_article')),
        from_warehouse_id: Number(getSearchableValue('transfer_from')),
        to_warehouse_id: Number(getSearchableValue('transfer_to')),
        quantity: Number(document.getElementById('f_transfer_qty').value),
      }),
    });
    closeModal();
    toast('Stock transferido correctamente.');
    renderView();
  } catch (e) { toast(e.message, 'error'); }
}

function openStockAdjustModal() {
  const artItems = articleItemsList();
  const whItems = warehouseItemsList();
  openModal(`
    <h2>Ajustar stock</h2>
    <div class="field"><label>Artículo</label>${searchableSelectHtml('adjust_article', artItems, 'Buscar artículo…')}</div>
    <div class="field-row">
      <div class="field"><label>Depósito</label>${searchableSelectHtml('adjust_warehouse', whItems, 'Buscar depósito…')}</div>
      <div class="field"><label>Tipo</label>
        <select id="f_adjust_type">
          <option value="IN">Sumar (entrada)</option>
          <option value="OUT">Restar (salida)</option>
        </select>
      </div>
    </div>
    <div class="field"><label>Cantidad</label><input id="f_adjust_qty" type="number" step="0.001" placeholder="0"></div>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="submitStockAdjust()">Ajustar</button>
    </div>
  `);
}
async function submitStockAdjust() {
  try {
    await api('/stock/adjust', {
      method: 'POST',
      body: JSON.stringify({
        article_id: Number(getSearchableValue('adjust_article')),
        warehouse_id: Number(getSearchableValue('adjust_warehouse')),
        quantity: Number(document.getElementById('f_adjust_qty').value),
        type: document.getElementById('f_adjust_type').value,
      }),
    });
    closeModal();
    toast('Stock ajustado correctamente.');
    renderView();
  } catch (e) { toast(e.message, 'error'); }
}

async function quickRemoveStock(articleId, warehouseId, name, currentQty) {
  const input = prompt(`Cantidad a quitar de "${name}" (disponible: ${fmtQty(currentQty)}):`);
  if (input === null) return;
  const qty = Number(input);
  if (!(qty > 0)) { toast('Ingresá una cantidad válida.', 'error'); return; }
  if (!(await verifyPasswordPrompt('quitar unidades de stock'))) return;
  try {
    await api('/stock/adjust', {
      method: 'POST',
      body: JSON.stringify({ article_id: articleId, warehouse_id: warehouseId, quantity: qty, type: 'OUT' }),
    });
    toast('Unidades quitadas del stock.');
    renderView();
  } catch (e) { toast(e.message, 'error'); }
}
async function deleteStockRow(stockId, name) {
  if (!confirm(`¿Eliminar por completo el registro de stock de "${name}"? Esto lo saca del listado (equivale a dejarlo en cero).`)) return;
  if (!(await verifyPasswordPrompt('eliminar registro de stock'))) return;
  try {
    await api(`/stock/${stockId}`, { method: 'DELETE' });
    toast('Registro de stock eliminado.');
    renderView();
  } catch (e) { toast(e.message, 'error'); }
}

async function showKardex(articleId, name) {
  const rows = await api(`/stock/kardex/${articleId}`);
  openModal(`
    <h2>Kardex — ${name}</h2>
    ${tableOrEmpty(rows, ['Fecha', 'Depósito', 'Tipo', 'Cantidad', 'Origen', ''], (m) => `
      <tr>
        <td class="mono">${fmtDate(m.created_at)}</td>
        <td>${m.warehouse_name}</td>
        <td>${m.type === 'IN' ? 'Entrada' : 'Salida'}</td>
        <td class="num ${m.type === 'IN' ? 'income' : 'expense'}">${fmtQty(m.quantity)}</td>
        <td class="mono">${m.origin_type || '-'} ${m.origin_id ? '#' + m.origin_id : ''}</td>
        <td><button class="btn btn-sm btn-danger" onclick="deleteStockMovement(${m.id}, ${articleId}, '${name.replace(/'/g, "\\'")}')">Eliminar</button></td>
      </tr>`, 'Sin movimientos registrados.')}
    <div class="modal-actions"><button class="btn" onclick="closeModal()">Cerrar</button></div>
  `);
}
async function deleteStockMovement(id, articleId, name) {
  if (!confirm('¿Eliminar esta carga de stock? El stock del depósito se recalculará automáticamente.')) return;
  try {
    await api(`/stock-movements/${id}`, { method: 'DELETE' });
    toast('Carga de stock eliminada.');
    await showKardex(articleId, name);
    renderView();
  } catch (e) { toast(e.message, 'error'); }
}

// ---------------------------------------------------------
// ARTÍCULOS
// ---------------------------------------------------------
let articlesPage = 1;
let articlesSearch = '';

async function renderArticles() {
  document.getElementById('viewActions').innerHTML = `
    <button class="btn btn-sm" onclick="downloadImportTemplate('articles')">Plantilla Excel</button>
    <button class="btn btn-sm" onclick="triggerImport('articles')">Importar Excel</button>
    <button class="btn btn-sm btn-danger" id="bulkDeleteArticlesBtn" style="display:none" onclick="bulkDeleteArticles()">Eliminar seleccionados</button>
    <button class="btn btn-primary" onclick="newArticleModal()">+ Nuevo artículo</button>`;
  const el = document.getElementById('view');

  const params = new URLSearchParams({ business_unit_id: state.selectedBU, page: articlesPage, limit: 50 });
  if (articlesSearch) params.set('search', articlesSearch);
  const { rows, total, limit } = await api(`/articles/list?${params.toString()}`);

  el.innerHTML = `
    <div class="card">
      <div class="section-toolbar">
        <div class="card-title" style="margin:0">Artículos</div>
        <div style="display:flex;gap:8px;align-items:center">
          <input type="text" id="articlesSearchInput" value="${escAttr(articlesSearch)}" placeholder="Buscar por código o descripción…" style="width:260px" oninput="articlesSearchDebounced()">
          ${articlesSearch ? `<button class="btn btn-sm" onclick="articlesClearSearch()">Limpiar</button>` : ''}
        </div>
      </div>
      <table class="ledger sortable-table">
        <thead><tr>
          <th style="width:30px"><input type="checkbox" id="selectAllArticles" onchange="toggleAllArticleChecks(this)"></th>
          ${['Código', 'Cód. alt.', 'Descripción', 'Costo lista', 'Precio ARS (c/IVA)', 'Precio USD (s/IVA)', 'Obs.', ''].map(h => h
            ? `<th class="sortable-th" onclick="sortTableByColumn(this)" data-dir="">${h}<span class="sort-indicator"></span></th>`
            : `<th></th>`).join('')}
        </tr></thead>
        <tbody>
          ${rows.length ? rows.map(a => `
            <tr>
              <td><input type="checkbox" class="article-check" value="${a.article_id}" onchange="updateBulkDeleteButton()"></td>
              <td class="mono">${a.code}</td>
              <td class="mono">${a.alt_code || '-'}</td>
              <td>${a.description}</td>
              <td class="num">${a.currency === 'USD' ? 'US$' : '$'} ${fmtMoney(a.list_cost)}</td>
              <td class="num income">${articlePriceDisplay(a, 'ARS', true)}</td>
              <td class="num income">${articlePriceDisplay(a, 'USD', false)}</td>
              <td style="text-align:center" title="${(a.notes || '').replace(/"/g, '&quot;')}">${a.notes ? '📝' : '-'}</td>
              <td>
                <button class="btn btn-sm" onclick="openEditArticleModal(${a.article_id})">Editar</button>
                <button class="btn btn-sm btn-danger" onclick="deleteArticle(${a.article_id}, '${a.code}')">Eliminar</button>
              </td>
            </tr>`).join('') : `<tr><td colspan="9"><div class="empty-state">No hay artículos que coincidan.</div></td></tr>`}
        </tbody>
      </table>
      ${total ? paginationControlsHtml('articles', articlesPage, total, limit) : ''}
    </div>
  `;
  document.getElementById('articlesSearchInput')?.focus();
  const input = document.getElementById('articlesSearchInput');
  if (input) input.setSelectionRange(input.value.length, input.value.length);
}
let articlesSearchTimer = null;
function articlesSearchDebounced() {
  clearTimeout(articlesSearchTimer);
  articlesSearchTimer = setTimeout(() => {
    articlesSearch = document.getElementById('articlesSearchInput').value;
    articlesPage = 1;
    renderView();
  }, 350);
}
function articlesClearSearch() {
  articlesSearch = '';
  articlesPage = 1;
  renderView();
}
function articlesChangePage(page) {
  articlesPage = page;
  renderView();
}
function toggleAllArticleChecks(checkbox) {
  document.querySelectorAll('.article-check').forEach(c => c.checked = checkbox.checked);
  updateBulkDeleteButton();
}
function updateBulkDeleteButton() {
  const checked = document.querySelectorAll('.article-check:checked').length;
  const btn = document.getElementById('bulkDeleteArticlesBtn');
  if (btn) {
    btn.style.display = checked > 0 ? 'inline-flex' : 'none';
    btn.textContent = checked > 0 ? `Eliminar seleccionados (${checked})` : 'Eliminar seleccionados';
  }
}
async function bulkDeleteArticles() {
  const ids = [...document.querySelectorAll('.article-check:checked')].map(c => Number(c.value));
  if (!ids.length) return;
  if (!confirm(`¿Eliminar ${ids.length} artículo(s)? Esta acción no se puede deshacer.`)) return;
  if (!(await verifyPasswordPrompt(`eliminar ${ids.length} artículos`))) return;
  let ok = 0, failed = 0;
  for (const id of ids) {
    try { await api(`/articles/${id}`, { method: 'DELETE' }); ok++; } catch (e) { failed++; }
  }
  toast(failed ? `Eliminados: ${ok}. Con errores: ${failed}.` : `${ok} artículo(s) eliminado(s).`, failed ? 'error' : 'success');
  renderView();
}

function articlePriceFor(a, targetCurrency, withIva) {
  const manual = targetCurrency === 'USD' ? a.price_usd : a.price_ars;
  if (manual != null) {
    return withIva ? manual * (1 + Number(a.iva_pct) / 100) : Number(manual);
  }
  if (a.currency === targetCurrency) {
    return withIva ? Number(a.final_price_with_iva) : Number(a.final_price);
  }
  return null;
}
function articlePriceDisplay(a, targetCurrency, withIva) {
  const price = articlePriceFor(a, targetCurrency, withIva);
  const sym = targetCurrency === 'USD' ? 'US$' : '$';
  return price != null ? `${sym} ${fmtMoney(price)}` : '<span style="color:var(--muted)">—</span>';
}

async function deleteArticle(id, code) {
  if (!confirm(`¿Eliminar el artículo ${code}? Esta acción no se puede deshacer.`)) return;
  try {
    await api(`/articles/${id}`, { method: 'DELETE' });
    toast('Artículo eliminado.');
    await refreshArticles(); renderView();
  } catch (e) { toast(e.message, 'error'); }
}

function escAttr(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
function articleFormHtml(a) {
  const isEdit = !!a;
  return `
    <div class="field-row">
      <div class="field"><label>Código</label><input id="f_code" placeholder="ART001" value="${escAttr(a?.code)}"></div>
      <div class="field"><label>Código alternativo</label><input id="f_altcode" placeholder="Opcional" value="${escAttr(a?.alt_code)}"></div>
    </div>
    <div class="field"><label>Descripción</label><input id="f_desc" placeholder="Nombre del producto" value="${escAttr(a?.description)}"></div>
    <div class="field-row">
      <div class="field"><label>Moneda</label>
        <select id="f_currency" oninput="updatePricePreview()">
          <option value="ARS" ${a?.currency === 'ARS' || !a ? 'selected' : ''}>Pesos argentinos (ARS)</option>
          <option value="USD" ${a?.currency === 'USD' ? 'selected' : ''}>Dólares (USD)</option>
        </select>
      </div>
      <div class="field"><label>Costo de lista</label><input id="f_cost" type="number" step="0.01" placeholder="0.00" value="${a?.list_cost ?? ''}" oninput="updatePricePreview()"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Margen envío %</label><input id="f_ship" type="number" step="0.01" placeholder="0" value="${a?.shipping_margin_pct ?? ''}" oninput="updatePricePreview()"></div>
      <div class="field"><label>Margen TC %</label><input id="f_fx" type="number" step="0.01" placeholder="0" value="${a?.fx_margin_pct ?? ''}" oninput="updatePricePreview()"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Margen ganancia %</label><input id="f_profit" type="number" step="0.01" placeholder="0" value="${a?.profit_margin_pct ?? ''}" oninput="updatePricePreview()"></div>
      <div class="field"><label>IVA %</label><input id="f_iva" type="number" step="0.01" placeholder="21" value="${a?.iva_pct ?? ''}" oninput="updatePricePreview()"></div>
    </div>
    <div class="field"><label>Observaciones</label><textarea id="f_notes" rows="3" style="width:100%;padding:9px 10px;border:1px solid var(--border);border-radius:8px;background:#FAFAFA;font-family:var(--sans)" placeholder="Notas internas sobre este artículo...">${(a?.notes || '').replace(/</g, '&lt;')}</textarea></div>

    <div class="field-row">
      <div class="field"><label>Precio de venta en ARS (manual)</label><input id="f_price_ars" type="number" step="0.01" placeholder="Dejar vacío para usar el calculado" value="${a?.price_ars ?? ''}"></div>
      <div class="field"><label>Precio de venta en USD (manual)</label><input id="f_price_usd" type="number" step="0.01" placeholder="Dejar vacío si no aplica" value="${a?.price_usd ?? ''}"></div>
    </div>
    <div class="hint" style="margin-bottom:16px">Si cargás un precio manual acá, se usa ese valor directo al vender en esa moneda, en vez del calculado por márgenes.</div>

    <div class="card" style="margin:4px 0 18px 0; padding:14px 16px;">
      <div class="card-title" style="margin-bottom:10px">Previsualización de precio de venta</div>
      <table class="ledger">
        <tbody>
          <tr><td>Costo de lista</td><td class="num" id="pv_cost">$ 0,00</td></tr>
          <tr><td>+ Envío</td><td class="num" id="pv_ship">$ 0,00</td></tr>
          <tr><td>+ Tipo de cambio</td><td class="num" id="pv_fx">$ 0,00</td></tr>
          <tr><td>+ Ganancia</td><td class="num" id="pv_profit">$ 0,00</td></tr>
          <tr><td><strong>Precio sin IVA</strong></td><td class="num income" id="pv_final"><strong>$ 0,00</strong></td></tr>
          <tr><td><strong>Precio con IVA</strong></td><td class="num income" id="pv_final_iva"><strong>$ 0,00</strong></td></tr>
        </tbody>
      </table>
    </div>
  `;
}

function newArticleModal() {
  openModal(`
    <h2>Nuevo artículo</h2>
    ${articleFormHtml(null)}
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="createArticle()">Guardar</button>
    </div>
  `);
  bindPricePreviewListeners();
  updatePricePreview();
}

function openEditArticleModal(articleId) {
  const a = state.cache.articles.find(x => x.article_id === articleId);
  if (!a) { toast('No se encontró el artículo.', 'error'); return; }
  openModal(`
    <h2>Editar artículo</h2>
    ${articleFormHtml(a)}
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="submitEditArticle(${a.article_id})">Guardar</button>
    </div>
  `);
  bindPricePreviewListeners();
  updatePricePreview();
}
function bindPricePreviewListeners() {
  ['f_cost', 'f_ship', 'f_fx', 'f_profit', 'f_iva', 'f_currency'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', updatePricePreview);
      el.addEventListener('change', updatePricePreview);
      el.addEventListener('keyup', updatePricePreview);
    }
  });
}

function updatePricePreview() {
  const cost = Number(document.getElementById('f_cost').value) || 0;
  const ship = Number(document.getElementById('f_ship').value) || 0;
  const fx = Number(document.getElementById('f_fx').value) || 0;
  const profit = Number(document.getElementById('f_profit').value) || 0;
  const iva = Number(document.getElementById('f_iva').value) || 0;
  const currency = document.getElementById('f_currency').value;
  const sym = currency === 'USD' ? 'US$' : '$';

  const afterShip = cost * (1 + ship / 100);
  const afterFx = afterShip * (1 + fx / 100);
  const final = afterFx * (1 + profit / 100);
  const finalIva = final * (1 + iva / 100);

  document.getElementById('pv_cost').textContent = `${sym} ${fmtMoney(cost)}`;
  document.getElementById('pv_ship').textContent = `${sym} ${fmtMoney(afterShip - cost)}`;
  document.getElementById('pv_fx').textContent = `${sym} ${fmtMoney(afterFx - afterShip)}`;
  document.getElementById('pv_profit').textContent = `${sym} ${fmtMoney(final - afterFx)}`;
  document.getElementById('pv_final').innerHTML = `<strong>${sym} ${fmtMoney(final)}</strong>`;
  document.getElementById('pv_final_iva').innerHTML = `<strong>${sym} ${fmtMoney(finalIva)}</strong>`;
}
async function createArticle() {
  try {
    await api('/articles', {
      method: 'POST',
      body: JSON.stringify({
        business_unit_id: state.selectedBU,
        code: document.getElementById('f_code').value,
        alt_code: document.getElementById('f_altcode').value,
        description: document.getElementById('f_desc').value,
        list_cost: Number(document.getElementById('f_cost').value),
        currency: document.getElementById('f_currency').value,
        shipping_margin_pct: Number(document.getElementById('f_ship').value),
        fx_margin_pct: Number(document.getElementById('f_fx').value),
        profit_margin_pct: Number(document.getElementById('f_profit').value),
        iva_pct: Number(document.getElementById('f_iva').value),
        notes: document.getElementById('f_notes').value,
        price_ars: document.getElementById('f_price_ars').value ? Number(document.getElementById('f_price_ars').value) : null,
        price_usd: document.getElementById('f_price_usd').value ? Number(document.getElementById('f_price_usd').value) : null,
      }),
    });
    closeModal(); toast('Artículo creado.'); await refreshArticles(); renderView();
  } catch (e) { toast(e.message, 'error'); }
}
async function submitEditArticle(id) {
  try {
    await api(`/articles/${id}`, {
      method: 'PUT',
      body: JSON.stringify({
        code: document.getElementById('f_code').value,
        alt_code: document.getElementById('f_altcode').value,
        description: document.getElementById('f_desc').value,
        list_cost: Number(document.getElementById('f_cost').value),
        currency: document.getElementById('f_currency').value,
        shipping_margin_pct: Number(document.getElementById('f_ship').value),
        fx_margin_pct: Number(document.getElementById('f_fx').value),
        profit_margin_pct: Number(document.getElementById('f_profit').value),
        iva_pct: Number(document.getElementById('f_iva').value),
        notes: document.getElementById('f_notes').value,
        price_ars: document.getElementById('f_price_ars').value ? Number(document.getElementById('f_price_ars').value) : null,
        price_usd: document.getElementById('f_price_usd').value ? Number(document.getElementById('f_price_usd').value) : null,
      }),
    });
    closeModal(); toast('Artículo actualizado.'); await refreshArticles(); renderView();
  } catch (e) { toast(e.message, 'error'); }
}

// ---------------------------------------------------------
// DEPÓSITOS
// ---------------------------------------------------------
async function renderWarehouses() {
  document.getElementById('viewActions').innerHTML = `
    <button class="btn btn-sm" onclick="downloadImportTemplate('warehouses')">Plantilla Excel</button>
    <button class="btn btn-sm" onclick="triggerImport('warehouses')">Importar Excel</button>
    <button class="btn btn-primary" onclick="newWarehouseModal()">+ Nuevo depósito</button>`;
  const el = document.getElementById('view');
  const rows = whByBU();
  const stock = await api('/stock');
  const countByWarehouse = {};
  stock.forEach(s => {
    if (!countByWarehouse[s.warehouse_id]) countByWarehouse[s.warehouse_id] = { articles: 0, units: 0 };
    countByWarehouse[s.warehouse_id].articles++;
    countByWarehouse[s.warehouse_id].units += Number(s.quantity);
  });
  el.innerHTML = `<div class="card">${tableOrEmpty(rows, ['Nombre', 'Estado', 'Artículos distintos', 'Unidades totales', ''], (w) => `
    <tr>
      <td>${w.name}</td>
      <td>${w.active ? statusBadge('OPEN') : statusBadge('CLOSED')}</td>
      <td class="num">${countByWarehouse[w.id]?.articles || 0}</td>
      <td class="num">${fmtQty(countByWarehouse[w.id]?.units || 0)}</td>
      <td>
        <button class="btn btn-sm" onclick="showWarehouseDetail(${w.id}, '${w.name.replace(/'/g, "\\'")}')">Ver detalle</button>
        <button class="btn btn-sm" onclick="openEditWarehouseModal(${w.id}, '${w.name.replace(/'/g, "\\'")}')">Editar</button>
        <button class="btn btn-sm btn-danger" onclick="deleteEntity('warehouses', ${w.id}, '${w.name.replace(/'/g, "\\'")}')">Eliminar</button>
      </td>
    </tr>`, 'No hay depósitos en esta unidad.')}</div>`;
}
function openEditWarehouseModal(id, name) {
  openModal(`
    <h2>Editar depósito</h2>
    <div class="field"><label>Nombre</label><input id="f_edit_wh_name" value="${escAttr(name)}"></div>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="submitEditWarehouse(${id})">Guardar</button>
    </div>
  `);
}
async function submitEditWarehouse(id) {
  try {
    await api(`/warehouses/${id}`, { method: 'PUT', body: JSON.stringify({ name: document.getElementById('f_edit_wh_name').value }) });
    closeModal(); toast('Depósito actualizado.'); await refreshWarehouses(); renderView();
  } catch (e) { toast(e.message, 'error'); }
}

async function showWarehouseDetail(warehouseId, name) {
  const stock = await api('/stock');
  const rows = stock.filter(s => s.warehouse_id === warehouseId);
  openModal(`
    <h2>Depósito — ${name}</h2>
    ${tableOrEmpty(rows, ['Código', 'Artículo', 'Cantidad', ''], (s) => `
      <tr>
        <td class="mono">${s.code}</td>
        <td>${s.description}</td>
        <td class="num" id="wh_qty_${s.article_id}">${fmtQty(s.quantity)}</td>
        <td><button class="btn btn-sm" onclick="editWarehouseStock(${warehouseId}, ${s.article_id}, '${s.description.replace(/'/g, "\\'")}', ${s.quantity}, '${name.replace(/'/g, "\\'")}')">Editar</button></td>
      </tr>`, 'Este depósito no tiene artículos con stock todavía.')}
    <div class="modal-actions"><button class="btn" onclick="closeModal()">Cerrar</button></div>
  `);
}

async function editWarehouseStock(warehouseId, articleId, name, currentQty, warehouseName) {
  const input = prompt(`Nueva cantidad de "${name}" en "${warehouseName}" (actual: ${fmtQty(currentQty)}):`, currentQty);
  if (input === null) return;
  const qty = Number(input);
  if (isNaN(qty) || qty < 0) { toast('Ingresá un número válido (0 o mayor).', 'error'); return; }
  if (!(await verifyPasswordPrompt('editar stock manualmente'))) return;
  try {
    await api('/stock/set', {
      method: 'PUT',
      body: JSON.stringify({ warehouse_id: warehouseId, article_id: articleId, quantity: qty }),
    });
    toast('Stock actualizado.');
    await showWarehouseDetail(warehouseId, warehouseName);
    renderView();
  } catch (e) { toast(e.message, 'error'); }
}
function newWarehouseModal() {
  openModal(`
    <h2>Nuevo depósito</h2>
    <div class="field"><label>Nombre</label><input id="f_name" placeholder="Depósito Central"></div>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="createWarehouse()">Guardar</button>
    </div>
  `);
}
async function createWarehouse() {
  try {
    await api('/warehouses', { method: 'POST', body: JSON.stringify({ name: document.getElementById('f_name').value, business_unit_id: state.selectedBU }) });
    closeModal(); toast('Depósito creado.'); await refreshWarehouses(); renderView();
  } catch (e) { toast(e.message, 'error'); }
}

// ---------------------------------------------------------
// PROVEEDORES / CLIENTES
// ---------------------------------------------------------
async function deleteEntity(kind, id, name) {
  if (!confirm(`¿Eliminar "${name}"? Esta acción no se puede deshacer.`)) return;
  const REFRESH_BY_KIND = {
    warehouses: refreshWarehouses, suppliers: refreshSuppliers, customers: refreshCustomers,
    projects: refreshProjects, 'cash-boxes': refreshCashBoxes,
  };
  try {
    await api(`/${kind}/${id}`, { method: 'DELETE' });
    toast('Eliminado correctamente.');
    if (REFRESH_BY_KIND[kind]) await REFRESH_BY_KIND[kind]();
    else await loadMasterData();
    if (kind === 'business-units') await loadBusinessUnits();
    renderView();
  } catch (e) { toast(e.message, 'error'); }
}

async function renderSuppliers() {
  document.getElementById('viewActions').innerHTML = `
    <button class="btn btn-sm" onclick="downloadImportTemplate('suppliers')">Plantilla Excel</button>
    <button class="btn btn-sm" onclick="triggerImport('suppliers')">Importar Excel</button>
    <button class="btn btn-primary" onclick="newContactModal('supplier')">+ Nuevo proveedor</button>`;
  const el = document.getElementById('view');
  const rows = state.cache.suppliers;
  const balances = await Promise.all(rows.map(s => api(`/suppliers/${s.id}/balance`)));
  el.innerHTML = `<div class="card">${tableOrEmpty(rows, ['Nombre', 'CUIT/Tax ID', 'Saldo cta. cte.', ''], (s) => `
    <tr><td>${s.name}</td><td class="mono">${s.tax_id || '-'}</td><td class="num ${Number(balances[rows.indexOf(s)]?.balance) > 0 ? 'expense' : ''}">$ ${fmtMoney(balances[rows.indexOf(s)]?.balance || 0)}</td>
    <td>
      <button class="btn btn-sm" onclick="openEditContactModal('supplier', ${s.id})">Editar</button>
      <button class="btn btn-sm btn-danger" onclick="deleteEntity('suppliers', ${s.id}, '${s.name.replace(/'/g, "\\'")}')">Eliminar</button>
    </td></tr>`,
    'No hay proveedores cargados.')}</div>`;
}
async function renderCustomers() {
  document.getElementById('viewActions').innerHTML = `
    <button class="btn btn-sm" onclick="downloadImportTemplate('customers')">Plantilla Excel</button>
    <button class="btn btn-sm" onclick="triggerImport('customers')">Importar Excel</button>
    <button class="btn btn-primary" onclick="newContactModal('customer')">+ Nuevo cliente</button>`;
  const el = document.getElementById('view');
  const rows = state.cache.customers;
  const balances = await Promise.all(rows.map(c => api(`/customers/${c.id}/balance`)));
  el.innerHTML = `<div class="card">${tableOrEmpty(rows, ['Nombre', 'CUIT/Tax ID', 'Saldo cta. cte.', ''], (c) => `
    <tr><td>${c.name}</td><td class="mono">${c.tax_id || '-'}</td><td class="num ${Number(balances[rows.indexOf(c)]?.balance) > 0 ? 'expense' : ''}">$ ${fmtMoney(balances[rows.indexOf(c)]?.balance || 0)}</td>
    <td>
      <button class="btn btn-sm" onclick="openEditContactModal('customer', ${c.id})">Editar</button>
      <button class="btn btn-sm btn-danger" onclick="deleteEntity('customers', ${c.id}, '${c.name.replace(/'/g, "\\'")}')">Eliminar</button>
    </td></tr>`,
    'No hay clientes cargados.')}</div>`;
}
function openEditContactModal(kind, id) {
  const label = kind === 'supplier' ? 'proveedor' : 'cliente';
  const list = kind === 'supplier' ? state.cache.suppliers : state.cache.customers;
  const c = list.find(x => x.id === id);
  if (!c) return;
  const isCustomer = kind === 'customer';
  openModal(`
    <h2>Editar ${label}</h2>
    <div class="field"><label>Nombre</label><input id="f_edit_name" value="${escAttr(c.name)}"></div>
    <div class="field"><label>CUIT / Identificador fiscal</label><input id="f_edit_tax" value="${escAttr(c.tax_id)}"></div>
    <div class="field-row">
      <div class="field"><label>Teléfono</label><input id="f_edit_phone" value="${escAttr(c.phone)}"></div>
      <div class="field"><label>Email</label><input id="f_edit_email" value="${escAttr(c.email)}"></div>
    </div>
    ${isCustomer ? `
    <div class="field-row">
      <div class="field" style="flex:3"><label>Calle</label><input id="f_edit_street" value="${escAttr(c.street)}"></div>
      <div class="field" style="flex:1"><label>Número</label><input id="f_edit_street_number" value="${escAttr(c.street_number)}"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Localidad</label><input id="f_edit_locality" value="${escAttr(c.locality)}"></div>
      <div class="field"><label>Provincia</label><input id="f_edit_province" value="${escAttr(c.province)}"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>País</label><input id="f_edit_country" value="${escAttr(c.country || 'Argentina')}"></div>
      <div class="field"><label>Código postal</label><input id="f_edit_postal_code" value="${escAttr(c.postal_code)}"></div>
    </div>` : `
    <div class="field"><label>Dirección</label><input id="f_edit_address" value="${escAttr(c.address)}"></div>`}
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="submitEditContact('${kind}', ${id})">Guardar</button>
    </div>
  `);
}
async function submitEditContact(kind, id) {
  const endpoint = kind === 'supplier' ? '/suppliers' : '/customers';
  const isCustomer = kind === 'customer';
  try {
    const payload = {
      name: document.getElementById('f_edit_name').value,
      tax_id: document.getElementById('f_edit_tax').value,
      phone: document.getElementById('f_edit_phone').value,
      email: document.getElementById('f_edit_email').value,
    };
    if (isCustomer) {
      payload.street = document.getElementById('f_edit_street').value;
      payload.street_number = document.getElementById('f_edit_street_number').value;
      payload.locality = document.getElementById('f_edit_locality').value;
      payload.province = document.getElementById('f_edit_province').value;
      payload.country = document.getElementById('f_edit_country').value;
      payload.postal_code = document.getElementById('f_edit_postal_code').value;
    } else {
      payload.address = document.getElementById('f_edit_address').value;
    }
    await api(`${endpoint}/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
    closeModal(); toast(`${kind === 'supplier' ? 'Proveedor' : 'Cliente'} actualizado.`); await (kind === 'supplier' ? refreshSuppliers() : refreshCustomers()); renderView();
  } catch (e) { toast(e.message, 'error'); }
}
function newContactModal(kind) {
  const label = kind === 'supplier' ? 'proveedor' : 'cliente';
  const isCustomer = kind === 'customer';
  openModal(`
    <h2>Nuevo ${label}</h2>
    <div class="field"><label>Nombre</label><input id="f_name"></div>
    <div class="field"><label>CUIT / Identificador fiscal</label><input id="f_tax"></div>
    <div class="field-row">
      <div class="field"><label>Teléfono</label><input id="f_phone"></div>
      <div class="field"><label>Email</label><input id="f_email"></div>
    </div>
    ${isCustomer ? `
    <div class="field-row">
      <div class="field" style="flex:3"><label>Calle</label><input id="f_street"></div>
      <div class="field" style="flex:1"><label>Número</label><input id="f_street_number"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Localidad</label><input id="f_locality"></div>
      <div class="field"><label>Provincia</label><input id="f_province"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>País</label><input id="f_country" value="Argentina"></div>
      <div class="field"><label>Código postal</label><input id="f_postal_code"></div>
    </div>` : ''}
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="createContact('${kind}')">Guardar</button>
    </div>
  `);
}
async function createContact(kind) {
  const endpoint = kind === 'supplier' ? '/suppliers' : '/customers';
  const isCustomer = kind === 'customer';
  try {
    const payload = {
      name: document.getElementById('f_name').value,
      tax_id: document.getElementById('f_tax').value,
      phone: document.getElementById('f_phone').value,
      email: document.getElementById('f_email').value,
    };
    if (isCustomer) {
      payload.street = document.getElementById('f_street').value;
      payload.street_number = document.getElementById('f_street_number').value;
      payload.locality = document.getElementById('f_locality').value;
      payload.province = document.getElementById('f_province').value;
      payload.country = document.getElementById('f_country').value;
      payload.postal_code = document.getElementById('f_postal_code').value;
    }
    await api(endpoint, { method: 'POST', body: JSON.stringify(payload) });
    closeModal(); toast(`${kind === 'supplier' ? 'Proveedor' : 'Cliente'} creado.`); await (kind === 'supplier' ? refreshSuppliers() : refreshCustomers()); renderView();
  } catch (e) { toast(e.message, 'error'); }
}

// ---------------------------------------------------------
// PROYECTOS
// ---------------------------------------------------------
async function renderProjects() {
  document.getElementById('viewActions').innerHTML = `<button class="btn btn-primary" onclick="newProjectModal()">+ Nuevo proyecto</button>`;
  const el = document.getElementById('view');
  const profitability = await api('/projects/profitability');
  const rows = projByBU().map(p => ({ ...p, profit: profitability.find(x => x.project_id === p.id) }));
  el.innerHTML = `<div class="card">${tableOrEmpty(rows, ['Nombre', 'Ingresos', 'Egresos', 'Resultado', ''], (p) => `
    <tr>
      <td>${p.name}</td>
      <td class="num income">$ ${fmtMoney(p.profit?.total_income || 0)}</td>
      <td class="num expense">$ ${fmtMoney(p.profit?.total_expense || 0)}</td>
      <td class="num ${Number(p.profit?.net_result || 0) >= 0 ? 'income' : 'expense'}">$ ${fmtMoney(p.profit?.net_result || 0)}</td>
      <td>
        <button class="btn btn-sm" onclick="openEditProjectModal(${p.id}, '${p.name.replace(/'/g, "\\'")}')">Editar</button>
        <button class="btn btn-sm btn-danger" onclick="deleteEntity('projects', ${p.id}, '${p.name.replace(/'/g, "\\'")}')">Eliminar</button>
      </td>
    </tr>`, 'No hay proyectos en esta unidad.')}</div>`;
}
function openEditProjectModal(id, name) {
  openModal(`
    <h2>Editar proyecto</h2>
    <div class="field"><label>Nombre</label><input id="f_edit_proj_name" value="${escAttr(name)}"></div>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="submitEditProject(${id})">Guardar</button>
    </div>
  `);
}
async function submitEditProject(id) {
  try {
    await api(`/projects/${id}`, { method: 'PUT', body: JSON.stringify({ name: document.getElementById('f_edit_proj_name').value }) });
    closeModal(); toast('Proyecto actualizado.'); await refreshProjects(); renderView();
  } catch (e) { toast(e.message, 'error'); }
}
function newProjectModal() {
  openModal(`
    <h2>Nuevo proyecto / centro de costos</h2>
    <div class="field"><label>Nombre</label><input id="f_name" placeholder="Ej: Remodelación local"></div>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="createProject()">Guardar</button>
    </div>
  `);
}
async function createProject() {
  try {
    await api('/projects', { method: 'POST', body: JSON.stringify({ name: document.getElementById('f_name').value, business_unit_id: state.selectedBU }) });
    closeModal(); toast('Proyecto creado.'); await refreshProjects(); renderView();
  } catch (e) { toast(e.message, 'error'); }
}

// ---------------------------------------------------------
// COMPRAS
// ---------------------------------------------------------
let purchasesSubTab = 'purchases';
let purchasesPage = 1;
let purchasesDateFrom = '';
let purchasesDateTo = '';

function paginationControlsHtml(idPrefix, page, total, limit) {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:14px">
      <span class="hint">${total} resultado(s) — página ${page} de ${totalPages}</span>
      <div style="display:flex;gap:8px">
        <button class="btn btn-sm" ${page <= 1 ? 'disabled' : ''} onclick="${idPrefix}ChangePage(${page - 1})">← Anterior</button>
        <button class="btn btn-sm" ${page >= totalPages ? 'disabled' : ''} onclick="${idPrefix}ChangePage(${page + 1})">Siguiente →</button>
      </div>
    </div>`;
}

async function renderPurchases() {
  document.getElementById('viewActions').innerHTML = purchasesSubTab === 'purchases'
    ? `<button class="btn btn-primary" onclick="newOperationModal('purchase')">+ Nueva compra</button>`
    : '';
  const el = document.getElementById('view');

  const [pending, verifyPending] = await Promise.all([
    api('/purchases/pending-payment'), api('/purchase-payments/pending'),
  ]);
  const pendingBU = pending.filter(p => p.business_unit_id === state.selectedBU);
  const verifyBU = verifyPending.filter(p => p.business_unit_id === state.selectedBU);

  const tabsHtml = `
    <div style="display:flex;gap:8px;margin-bottom:18px">
      <button class="btn btn-sm ${purchasesSubTab === 'purchases' ? 'btn-primary' : ''}" onclick="switchPurchasesTab('purchases')">Compras</button>
      <button class="btn btn-sm ${purchasesSubTab === 'pay' ? 'btn-primary' : ''}" onclick="switchPurchasesTab('pay')">Procesar pago ${pendingBU.length ? `(${pendingBU.length})` : ''}</button>
      <button class="btn btn-sm ${purchasesSubTab === 'verify' ? 'btn-primary' : ''}" onclick="switchPurchasesTab('verify')">Verificar pago ${verifyBU.length ? `(${verifyBU.length})` : ''}</button>
    </div>`;

  if (purchasesSubTab === 'pay') {
    el.innerHTML = tabsHtml + `
      <div class="card">
        <div class="card-title">Compras pendientes de procesar pago</div>
        ${tableOrEmpty(pendingBU, ['#', 'Proveedor', 'Fecha', 'Total', 'Pagado', 'Pendiente', 'Estado', ''], (p) => `
          <tr>
            <td class="mono">#${p.id}</td>
            <td>${supplierName(p.supplier_id)}</td>
            <td class="mono">${fmtDate(p.date)}</td>
            <td class="num">$ ${fmtMoney(p.total_amount)}</td>
            <td class="num income">$ ${fmtMoney(p.settled_amount)}</td>
            <td class="num expense">$ ${fmtMoney(p.remaining_amount)}</td>
            <td>${paymentStatusBadge(p.payment_status)}</td>
            <td><button class="btn btn-sm btn-primary" onclick="openPayModal(${p.id}, ${p.remaining_amount})">Procesar pago</button></td>
          </tr>`, 'No hay compras pendientes de pago en esta unidad.')}
      </div>`;
    return;
  }

  if (purchasesSubTab === 'verify') {
    const totalPending = verifyBU.reduce((a, p) => a + Number(p.amount), 0);
    el.innerHTML = tabsHtml + `
      <div class="kpi-row">
        <div class="kpi"><div class="kpi-label">Pagos esperando verificación</div><div class="kpi-value">${verifyBU.length}</div></div>
        <div class="kpi"><div class="kpi-label">Monto total pendiente</div><div class="kpi-value expense">$ ${fmtMoney(totalPending)}</div></div>
      </div>
      <div class="card">
        <div class="card-title">Pagos que todavía no se movieron físicamente desde su caja/sobre</div>
        <div class="hint" style="margin-bottom:14px">Esta etapa confirma que el pago de la compra ya salió realmente de la caja o sobre elegido.</div>
        ${tableOrEmpty(verifyBU, ['Fecha', 'Compra', 'Proveedor', 'Caja / Sobre origen', 'Monto', ''], (p) => `
          <tr>
            <td class="mono">${fmtDate(p.created_at)}</td>
            <td class="mono">#${p.purchase_id}</td>
            <td>${p.supplier_name}</td>
            <td>${p.cash_box_name}</td>
            <td class="num expense">${p.cash_box_currency === 'USD' ? 'US$' : '$'} ${fmtMoney(p.amount)}</td>
            <td>
              <button class="btn btn-sm btn-primary" onclick="verifyPurchasePayment(${p.id})">Confirmar movimiento físico</button>
              <button class="btn btn-sm btn-danger" onclick="rejectPurchasePayment(${p.id})">Rechazar</button>
            </td>
          </tr>`, 'No hay pagos esperando verificación.')}
      </div>`;
    return;
  }

  const params = new URLSearchParams({ business_unit_id: state.selectedBU, page: purchasesPage, limit: 25 });
  if (purchasesDateFrom) params.set('date_from', purchasesDateFrom);
  if (purchasesDateTo) params.set('date_to', purchasesDateTo);
  const { rows, total, limit } = await api(`/purchases/list?${params.toString()}`);

  el.innerHTML = tabsHtml + `
    <div class="card">
      <div class="section-toolbar">
        <div class="card-title" style="margin:0">Compras</div>
        <div style="display:flex;gap:8px;align-items:center">
          <input type="date" id="purchasesDateFrom" value="${purchasesDateFrom}" onchange="purchasesApplyDateFilter()">
          <span class="hint">a</span>
          <input type="date" id="purchasesDateTo" value="${purchasesDateTo}" onchange="purchasesApplyDateFilter()">
          ${(purchasesDateFrom || purchasesDateTo) ? `<button class="btn btn-sm" onclick="purchasesClearDateFilter()">Limpiar</button>` : ''}
        </div>
      </div>
      ${tableOrEmpty(rows, ['#', 'Proveedor', 'Fecha', 'Estado', 'Pago', 'Total', ''], (p) => `
        <tr>
          <td class="mono">#${p.id}</td>
          <td>${supplierName(p.supplier_id)}</td>
          <td class="mono">${fmtDate(p.date)}</td>
          <td>${statusBadge(p.status)}</td>
          <td>${p.payment_type === 'CASH' ? 'Contado' : 'Cta. Cte.'}</td>
          <td class="num expense">$ ${fmtMoney(p.total_amount)}</td>
          <td>${opActions('purchases', p)} <button class="btn btn-sm btn-danger" onclick="deleteOperation('purchases', ${p.id})">Eliminar</button></td>
        </tr>`, 'No hay compras registradas en esta unidad.')}
      ${total ? paginationControlsHtml('purchases', purchasesPage, total, limit) : ''}
    </div>`;
}
function purchasesChangePage(page) {
  purchasesPage = page;
  renderView();
}
function purchasesApplyDateFilter() {
  purchasesDateFrom = document.getElementById('purchasesDateFrom').value;
  purchasesDateTo = document.getElementById('purchasesDateTo').value;
  purchasesPage = 1;
  renderView();
}
function purchasesClearDateFilter() {
  purchasesDateFrom = ''; purchasesDateTo = ''; purchasesPage = 1;
  renderView();
}
function switchPurchasesTab(tab) {
  purchasesSubTab = tab;
  purchasesPage = 1;
  renderView();
}
function supplierName(id) {
  return state.cache.suppliers.find(s => s.id === id)?.name || `Proveedor #${id}`;
}
function paymentStatusBadge(status) {
  const map = { PENDIENTE: 'pending', PARCIAL: 'pending', PAGADO: 'confirmed' };
  return `<span class="badge badge-${map[status] || 'pending'}">${status}</span>`;
}
function openPayModal(purchaseId, remaining) {
  const boxItems = state.cache.cashBoxes.map(b => ({ id: b.id, label: `${b.name} (${b.currency})` }));
  const projItems = [{ id: '', label: 'Sin proyecto' }, ...projByBU().map(p => ({ id: p.id, label: p.name }))];
  openModal(`
    <h2>Procesar pago — Compra #${purchaseId}</h2>
    <div class="hint" style="margin-bottom:14px">Saldo pendiente: <strong>$ ${fmtMoney(remaining)}</strong>. Repartí el monto pagado entre una o más cajas.</div>
    <div class="line-items" id="paySplits"></div>
    <button class="btn btn-sm" onclick="addPaySplit()">+ Agregar caja</button>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="submitPay(${purchaseId})">Confirmar pago</button>
    </div>
  `);
  window._payBoxItems = boxItems;
  window._payProjItems = projItems;
  addPaySplit();
}
let paySplitCount = 0;
function addPaySplit() {
  const id = paySplitCount++;
  const container = document.getElementById('paySplits');
  const row = document.createElement('div');
  row.className = 'line-item-row';
  row.id = `psplit_${id}`;
  row.innerHTML = `
    ${searchableSelectHtml(`pbox_${id}`, window._payBoxItems, 'Buscar caja…')}
    <input type="number" step="0.01" placeholder="Monto" id="pamount_${id}">
    ${searchableSelectHtml(`pproj_${id}`, window._payProjItems, 'Buscar proyecto…', 'Sin proyecto')}
    <button class="remove-line" onclick="document.getElementById('psplit_${id}').remove()">×</button>
  `;
  container.appendChild(row);
}
async function submitPay(purchaseId) {
  const rows = [...document.getElementById('paySplits').children];
  const splits = rows.map(row => {
    const idx = row.id.replace('psplit_', '');
    return {
      cash_box_id: Number(getSearchableValue(`pbox_${idx}`)),
      amount: Number(document.getElementById(`pamount_${idx}`).value),
      project_id: getSearchableValue(`pproj_${idx}`) ? Number(getSearchableValue(`pproj_${idx}`)) : null,
    };
  }).filter(s => s.amount > 0);

  if (!splits.length) { toast('Agregá al menos un monto.', 'error'); return; }
  try {
    await api(`/purchases/${purchaseId}/pay`, { method: 'POST', body: JSON.stringify({ splits }) });
    closeModal();
    toast('Pago registrado. Queda pendiente de verificación física.');
    renderView();
  } catch (e) { toast(e.message, 'error'); }
}
async function verifyPurchasePayment(id) {
  if (!(await verifyPasswordPrompt('confirmar el movimiento físico de este pago'))) return;
  try {
    await api(`/purchase-payments/${id}/verify`, { method: 'POST' });
    toast('Pago verificado. Ya impacta en el saldo.');
    renderView();
  } catch (e) { toast(e.message, 'error'); }
}
async function rejectPurchasePayment(id) {
  if (!confirm('¿Rechazar este pago pendiente?')) return;
  if (!(await verifyPasswordPrompt('rechazar este pago'))) return;
  try {
    await api(`/purchase-payments/${id}/reject`, { method: 'POST' });
    toast('Pago rechazado.');
    renderView();
  } catch (e) { toast(e.message, 'error'); }
}

// ---------------------------------------------------------
// VENTAS
// ---------------------------------------------------------
async function renderQuotes() {
  document.getElementById('viewActions').innerHTML = `<button class="btn btn-primary" onclick="newQuoteModal()">+ Nuevo presupuesto</button>`;
  const el = document.getElementById('view');
  const all = await api('/quotes');
  const rows = all.filter(q => q.business_unit_id === state.selectedBU);

  el.innerHTML = `<div class="card">${tableOrEmpty(rows, ['#', 'Cliente', 'Fecha', 'Estado', 'Total', ''], (q) => `
    <tr>
      <td class="mono">#${q.id}</td>
      <td>${customerName(q.customer_id)}</td>
      <td class="mono">${fmtDate(q.date)}</td>
      <td>${quoteStatusBadge(q.status)}</td>
      <td class="num income">${q.currency === 'USD' ? 'US$' : '$'} ${fmtMoney(q.total_amount)}</td>
      <td>
        <button class="btn btn-sm" onclick="showQuoteDetail(${q.id})">Detalle</button>
        ${q.status === 'PENDING' ? `<button class="btn btn-sm btn-primary" onclick="convertQuoteToSale(${q.id})">Convertir en venta</button>` : ''}
        <button class="btn btn-sm btn-danger" onclick="deleteQuote(${q.id})">Eliminar</button>
      </td>
    </tr>`, 'No hay presupuestos cargados en esta unidad.')}</div>`;
}
function quoteStatusBadge(status) {
  const map = { PENDING: 'pending', CONVERTED: 'confirmed', CANCELLED: 'cancelled' };
  const label = { PENDING: 'Pendiente', CONVERTED: 'Convertido', CANCELLED: 'Cancelado' };
  return `<span class="badge badge-${map[status]}">${label[status]}</span>`;
}
async function showQuoteDetail(id) {
  const items = await api(`/quotes/${id}/items`);
  openModal(`
    <h2>Detalle — Presupuesto #${id}</h2>
    ${tableOrEmpty(items, ['Código', 'Artículo', 'Cantidad', 'Precio unit.', 'Subtotal'], (i) => `
      <tr>
        <td class="mono">${i.code}</td>
        <td>${i.description}</td>
        <td class="num">${fmtQty(i.quantity)}</td>
        <td class="num">$ ${fmtMoney(i.unit_price)}</td>
        <td class="num income">$ ${fmtMoney(i.subtotal)}</td>
      </tr>`, 'Sin artículos.')}
    <div class="modal-actions"><button class="btn" onclick="closeModal()">Cerrar</button></div>
  `);
}
async function deleteQuote(id) {
  if (!confirm(`¿Eliminar el presupuesto #${id}?`)) return;
  try { await api(`/quotes/${id}`, { method: 'DELETE' }); toast('Presupuesto eliminado.'); renderView(); } catch (e) { toast(e.message, 'error'); }
}

function newQuoteModal() {
  const contactItems = state.cache.customers.map(c => ({ id: c.id, label: c.name }));
  const whItems = whByBU().map(w => ({ id: w.id, label: w.name }));
  const projItems = [{ id: '', label: 'Sin proyecto' }, ...projByBU().map(p => ({ id: p.id, label: p.name }))];

  lineItemCount = 0;
  openModal(`
    <h2>Nuevo presupuesto</h2>
    <div class="field"><label>Cliente</label>${searchableSelectHtml('quote_contact', contactItems, 'Buscar cliente…')}</div>
    <div class="field-row">
      <div class="field"><label>Depósito (opcional)</label>${searchableSelectHtml('quote_warehouse', whItems, 'Buscar depósito…', 'Sin depósito')}</div>
      <div class="field"><label>Proyecto (opcional)</label>${searchableSelectHtml('quote_project', projItems, 'Buscar proyecto…', 'Sin proyecto')}</div>
    </div>
    <div class="field"><label>Moneda</label>
      <select id="f_sale_currency" onchange="refreshAllLinePrices()">
        <option value="ARS">Pesos argentinos (ARS)</option>
        <option value="USD">Dólares (USD)</option>
      </select>
    </div>
    <div class="field"><label>Artículos</label>
      <div class="line-items" id="lineItems"></div>
      <button class="btn btn-sm" onclick="addLineItem('sale')">+ Agregar artículo</button>
    </div>
    <div class="field"><label>Observaciones (opcional)</label><input id="f_quote_notes" placeholder="Notas del presupuesto"></div>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="createQuote()">Guardar</button>
    </div>
  `);
  addLineItem('sale');
}
async function createQuote() {
  const rows = [...document.getElementById('lineItems').children];
  const items = rows.map(row => {
    const idMatch = row.id.replace('line_', '');
    return {
      article_id: Number(document.getElementById(`artid_${idMatch}`).value),
      quantity: Number(document.getElementById(`qty_${idMatch}`).value),
      unit_price: Number(document.getElementById(`price_${idMatch}`).value),
    };
  }).filter(i => i.article_id);

  if (!items.length) { toast('Agregá al menos un artículo.', 'error'); return; }

  try {
    await api('/quotes', {
      method: 'POST',
      body: JSON.stringify({
        business_unit_id: state.selectedBU,
        customer_id: Number(getSearchableValue('quote_contact')),
        warehouse_id: getSearchableValue('quote_warehouse') ? Number(getSearchableValue('quote_warehouse')) : null,
        project_id: getSearchableValue('quote_project') ? Number(getSearchableValue('quote_project')) : null,
        currency: document.getElementById('f_sale_currency').value,
        notes: document.getElementById('f_quote_notes').value,
        items,
      }),
    });
    closeModal();
    toast('Presupuesto creado.');
    renderView();
  } catch (e) { toast(e.message, 'error'); }
}
async function convertQuoteToSale(id) {
  await selectQuoteToLoad(id);
}

let salesSubTab = 'sales';
let salesPage = 1;
let salesDateFrom = '';
let salesDateTo = '';

async function renderSales() {
  document.getElementById('viewActions').innerHTML = salesSubTab === 'sales'
    ? `<button class="btn btn-primary" onclick="newOperationModal('sale')">+ Nueva venta</button>`
    : '';
  const el = document.getElementById('view');

  const [pending, verifyPending] = await Promise.all([
    api('/sales/pending-collection'), api('/sale-collections/pending'),
  ]);
  const pendingBU = pending.filter(s => s.business_unit_id === state.selectedBU && s.collection_status !== 'COBRADO');
  const verifyBU = verifyPending.filter(p => p.business_unit_id === state.selectedBU);

  const tabsHtml = `
    <div style="display:flex;gap:8px;margin-bottom:18px">
      <button class="btn btn-sm ${salesSubTab === 'sales' ? 'btn-primary' : ''}" onclick="switchSalesTab('sales')">Ventas</button>
      <button class="btn btn-sm ${salesSubTab === 'collect' ? 'btn-primary' : ''}" onclick="switchSalesTab('collect')">Procesar cobro ${pendingBU.length ? `(${pendingBU.length})` : ''}</button>
      <button class="btn btn-sm ${salesSubTab === 'verify' ? 'btn-primary' : ''}" onclick="switchSalesTab('verify')">Verificar cobros ${verifyBU.length ? `(${verifyBU.length})` : ''}</button>
      <button class="btn btn-sm ${salesSubTab === 'documents' ? 'btn-primary' : ''}" onclick="switchSalesTab('documents')">Comprobantes y remitos</button>
    </div>`;

  if (salesSubTab === 'documents') {
    const history = await api(`/sales-documents/history?business_unit_id=${state.selectedBU}`);
    el.innerHTML = tabsHtml + `
      <div class="card">
        <div class="card-title">Historial de comprobantes y remitos generados</div>
        <div class="hint" style="margin-bottom:14px">Últimos 200 documentos generados en esta unidad. "Volver a abrir" regenera el documento con los datos actuales de la venta.</div>
        ${tableOrEmpty(history, ['Fecha', 'Tipo', 'Venta', 'Cliente', 'Total', 'Generado por', ''], (h) => `
          <tr>
            <td class="mono">${fmtDate(h.generated_at)}</td>
            <td>${h.type === 'remito' ? 'Remito' : 'Comprobante'}</td>
            <td class="mono">#${h.sale_id}</td>
            <td>${h.customer_name}</td>
            <td class="num income">${h.currency === 'USD' ? 'US$' : '$'} ${fmtMoney(h.total_amount)}</td>
            <td>${h.generated_by_username || '-'}</td>
            <td>
              ${h.type === 'remito'
                ? `<button class="btn btn-sm" onclick="openRemitoModal(${h.sale_id})">Volver a abrir</button>`
                : `<button class="btn btn-sm" onclick="openComprobanteModal(${h.sale_id})">Volver a abrir</button>`}
              <button class="btn btn-sm btn-danger" onclick="deleteDocumentLogEntry(${h.id})">Eliminar</button>
            </td>
          </tr>`, 'Todavía no se generó ningún comprobante ni remito en esta unidad.')}
      </div>`;
    return;
  }

  if (salesSubTab === 'collect') {
    el.innerHTML = tabsHtml + `
      <div class="card">
        <div class="card-title">Facturas pendientes de procesar (sin cobrar o cuenta corriente)</div>
        ${tableOrEmpty(pendingBU, ['#', 'Cliente', 'CUIT', 'Fecha', 'Total', 'Cobrado', 'Pendiente', 'Estado', ''], (s) => `
          <tr>
            <td class="mono">#${s.id}</td>
            <td>${customerName(s.customer_id)}</td>
            <td class="mono">${customerTaxId(s.customer_id)}</td>
            <td class="mono">${fmtDate(s.date)}</td>
            <td class="num">$ ${fmtMoney(s.total_amount)}</td>
            <td class="num income">$ ${fmtMoney(s.settled_amount)}</td>
            <td class="num expense">$ ${fmtMoney(s.remaining_amount)}</td>
            <td>${collectionBadge(s.collection_status)}</td>
            <td>
              <button class="btn btn-sm" onclick="showSaleDetail(${s.id})">Detalle</button>
              <button class="btn btn-sm btn-primary" onclick="openCollectModal(${s.id}, ${s.remaining_amount})">Procesar cobro</button>
            </td>
          </tr>`, 'No hay facturas pendientes de procesar en esta unidad.')}
      </div>`;
    return;
  }

  if (salesSubTab === 'verify') {
    const totalPending = verifyBU.reduce((a, p) => a + Number(p.amount), 0);
    el.innerHTML = tabsHtml + `
      <div class="kpi-row">
        <div class="kpi"><div class="kpi-label">Cobros esperando verificación</div><div class="kpi-value">${verifyBU.length}</div></div>
        <div class="kpi"><div class="kpi-label">Monto total pendiente</div><div class="kpi-value expense">$ ${fmtMoney(totalPending)}</div></div>
      </div>
      <div class="card">
        <div class="card-title">Cobros que todavía no se movieron físicamente a su caja/sobre</div>
        <div class="hint" style="margin-bottom:14px">Esta etapa confirma que el dinero cobrado en una venta ya se guardó realmente en la caja o sobre elegido. Hasta que se verifique, no afecta el saldo de esa caja.</div>
        ${tableOrEmpty(verifyBU, ['Fecha', 'Venta', 'Cliente', 'Caja / Sobre destino', 'Monto', ''], (p) => `
          <tr>
            <td class="mono">${fmtDate(p.created_at)}</td>
            <td class="mono">#${p.sale_id}</td>
            <td>${p.customer_name}</td>
            <td>${p.cash_box_name}</td>
            <td class="num income">${p.cash_box_currency === 'USD' ? 'US$' : '$'} ${fmtMoney(p.amount)}</td>
            <td>
              <button class="btn btn-sm btn-primary" onclick="verifySaleCollection(${p.id})">Confirmar movimiento físico</button>
              <button class="btn btn-sm btn-danger" onclick="rejectSaleCollection(${p.id})">Rechazar</button>
            </td>
          </tr>`, 'No hay cobros esperando verificación. Todo lo cobrado ya está confirmado en su caja o sobre.')}
      </div>`;
    return;
  }

  const params = new URLSearchParams({ business_unit_id: state.selectedBU, page: salesPage, limit: 25 });
  if (salesDateFrom) params.set('date_from', salesDateFrom);
  if (salesDateTo) params.set('date_to', salesDateTo);
  const { rows, total, limit } = await api(`/sales/list?${params.toString()}`);

  el.innerHTML = tabsHtml + `
    <div class="card">
      <div class="section-toolbar">
        <div class="card-title" style="margin:0">Todas las ventas</div>
        <div style="display:flex;gap:8px;align-items:center">
          <input type="date" id="salesDateFrom" value="${salesDateFrom}" onchange="salesApplyDateFilter()">
          <span class="hint">a</span>
          <input type="date" id="salesDateTo" value="${salesDateTo}" onchange="salesApplyDateFilter()">
          ${(salesDateFrom || salesDateTo) ? `<button class="btn btn-sm" onclick="salesClearDateFilter()">Limpiar</button>` : ''}
        </div>
      </div>
      ${tableOrEmpty(rows, ['#', 'Cliente', 'CUIT', 'Fecha', 'Estado', 'Pago', 'Total', ''], (s) => `
        <tr>
          <td class="mono">#${s.id}</td>
          <td>${customerName(s.customer_id)}</td>
          <td class="mono">${customerTaxId(s.customer_id)}</td>
          <td class="mono">${fmtDate(s.date)}</td>
          <td>${statusBadge(s.status)}</td>
          <td>${paymentTypeLabel(s.payment_type)}</td>
          <td class="num income">${s.currency === 'USD' ? 'US$' : '$'} ${fmtMoney(s.total_amount)}</td>
          <td>
            <button class="btn btn-sm" onclick="showSaleDetail(${s.id})">Detalle</button>
            ${opActions('sales', s)} <button class="btn btn-sm btn-danger" onclick="deleteOperation('sales', ${s.id})">Eliminar</button>
            <span style="display:inline-block;width:1px;height:16px;background:var(--border);margin:0 8px;vertical-align:middle"></span>
            <button class="btn btn-sm" onclick="openComprobanteModal(${s.id})">Comprobante</button>
            <button class="btn btn-sm" onclick="openRemitoModal(${s.id})">Remito</button>
          </td>
        </tr>`, 'No hay ventas registradas en esta unidad.')}
      ${total ? paginationControlsHtml('sales', salesPage, total, limit) : ''}
    </div>
  `;
}
function salesChangePage(page) {
  salesPage = page;
  renderView();
}
function salesApplyDateFilter() {
  salesDateFrom = document.getElementById('salesDateFrom').value;
  salesDateTo = document.getElementById('salesDateTo').value;
  salesPage = 1;
  renderView();
}
function salesClearDateFilter() {
  salesDateFrom = ''; salesDateTo = ''; salesPage = 1;
  renderView();
}
function switchSalesTab(tab) {
  salesSubTab = tab;
  salesPage = 1;
  renderView();
}
function customerTaxId(id) {
  return state.cache.customers.find(c => c.id === id)?.tax_id || '-';
}

function paymentTypeLabel(t) {
  return { CASH: 'Contado', ACCOUNT: 'Cta. Cte.', UNCOLLECTED: 'Sin cobrar' }[t] || t;
}
function collectionBadge(status) {
  const map = { PENDIENTE: 'pending', PARCIAL: 'pending', COBRADO: 'confirmed' };
  return `<span class="badge badge-${map[status] || 'pending'}">${status}</span>`;
}

function openCollectModal(saleId, remaining) {
  const boxItems = state.cache.cashBoxes.map(b => ({ id: b.id, label: `${b.name} (${b.currency})` }));
  const projItems = [{ id: '', label: 'Sin proyecto' }, ...projByBU().map(p => ({ id: p.id, label: p.name }))];
  openModal(`
    <h2>Procesar cobro — Venta #${saleId}</h2>
    <div class="hint" style="margin-bottom:14px">Saldo pendiente: <strong>$ ${fmtMoney(remaining)}</strong>. Repartí el monto cobrado entre una o más cajas.</div>
    <div class="line-items" id="collectSplits"></div>
    <button class="btn btn-sm" onclick="addCollectSplit()">+ Agregar caja</button>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="submitCollect(${saleId})">Confirmar cobro</button>
    </div>
  `);
  window._collectBoxItems = boxItems;
  window._collectProjItems = projItems;
  addCollectSplit();
}
let collectSplitCount = 0;
function addCollectSplit() {
  const id = collectSplitCount++;
  const container = document.getElementById('collectSplits');
  const row = document.createElement('div');
  row.className = 'line-item-row';
  row.id = `csplit_${id}`;
  row.innerHTML = `
    ${searchableSelectHtml(`cbox_${id}`, window._collectBoxItems, 'Buscar caja…')}
    <input type="number" step="0.01" placeholder="Monto" id="camount_${id}">
    ${searchableSelectHtml(`cproj_${id}`, window._collectProjItems, 'Buscar proyecto…', 'Sin proyecto')}
    <button class="remove-line" onclick="document.getElementById('csplit_${id}').remove()">×</button>
  `;
  container.appendChild(row);
}
async function submitCollect(saleId) {
  const rows = [...document.getElementById('collectSplits').children];
  const splits = rows.map(row => {
    const idx = row.id.replace('csplit_', '');
    return {
      cash_box_id: Number(getSearchableValue(`cbox_${idx}`)),
      amount: Number(document.getElementById(`camount_${idx}`).value),
      project_id: getSearchableValue(`cproj_${idx}`) ? Number(getSearchableValue(`cproj_${idx}`)) : null,
    };
  }).filter(s => s.amount > 0);

  if (!splits.length) { toast('Agregá al menos un monto.', 'error'); return; }
  try {
    await api(`/sales/${saleId}/collect`, { method: 'POST', body: JSON.stringify({ splits }) });
    closeModal();
    toast('Cobro registrado. Queda pendiente de verificación física en "Verificar cobros".');
    renderView();
  } catch (e) { toast(e.message, 'error'); }
}

function opActions(kind, op) {
  if (op.status === 'PENDING') {
    return `
      <button class="btn btn-sm" onclick="confirmOperation('${kind}', ${op.id})">Confirmar</button>
      <button class="btn btn-sm btn-danger" onclick="cancelOperation('${kind}', ${op.id})">Cancelar</button>
    `;
  }
  if (op.status === 'CONFIRMED') {
    return `<button class="btn btn-sm btn-danger" onclick="cancelOperation('${kind}', ${op.id})">Cancelar</button>`;
  }
  return '-';
}
async function confirmOperation(kind, id) {
  try {
    await api(`/${kind}/${id}/confirm`, { method: 'POST' });
    toast('Operación confirmada. Stock y caja actualizados.');
    renderView();
  } catch (e) { toast(e.message, 'error'); }
}
async function cancelOperation(kind, id) {
  if (!confirm('¿Confirmás cancelar esta operación?')) return;
  try {
    await api(`/${kind}/${id}/cancel`, { method: 'POST' });
    toast('Operación cancelada.');
    renderView();
  } catch (e) { toast(e.message, 'error'); }
}
async function deleteOperation(kind, id) {
  const label = kind === 'purchases' ? 'la compra' : 'la venta';
  if (!confirm(`¿Eliminar ${label} #${id}? Si está confirmada, primero hay que cancelarla. Si no, queda en la papelera 30 días.`)) return;
  try {
    await api(`/${kind}/${id}`, { method: 'DELETE' });
    toast('Eliminado correctamente.');
    renderView();
  } catch (e) { toast(e.message, 'error'); }
}

// ---------------------------------------------------------
// DEUDORES
// ---------------------------------------------------------
async function renderDebtors() {
  document.getElementById('viewActions').innerHTML = '';
  const el = document.getElementById('view');
  const [pending, all] = await Promise.all([api('/sales/pending-collection'), api('/sales')]);
  const pendingBU = pending.filter(s => s.business_unit_id === state.selectedBU && s.collection_status !== 'COBRADO');

  const byCustomer = {};
  pendingBU.forEach(s => {
    const sale = all.find(a => a.id === s.id) || s;
    const custId = sale.customer_id;
    if (!byCustomer[custId]) byCustomer[custId] = { customer_id: custId, sales: [], total: 0 };
    byCustomer[custId].sales.push(s);
    byCustomer[custId].total += Number(s.remaining_amount);
  });
  const groups = Object.values(byCustomer);

  const totalDebt = pendingBU.reduce((a, s) => a + Number(s.remaining_amount), 0);

  el.innerHTML = `
    <div class="kpi-row">
      <div class="kpi"><div class="kpi-label">Total adeudado</div><div class="kpi-value expense">$ ${fmtMoney(totalDebt)}</div></div>
      <div class="kpi"><div class="kpi-label">Clientes deudores</div><div class="kpi-value">${groups.length}</div></div>
      <div class="kpi"><div class="kpi-label">Facturas pendientes</div><div class="kpi-value">${pendingBU.length}</div></div>
    </div>

    <div class="card">
      <div class="card-title">Deuda por cliente</div>
      ${tableOrEmpty(groups, ['Cliente', 'Facturas', 'Deuda total'], (g) => `
        <tr>
          <td>${customerName(g.customer_id)}</td>
          <td class="mono">${g.sales.length}</td>
          <td class="num expense">$ ${fmtMoney(g.total)}</td>
        </tr>`, 'No hay deuda pendiente en esta unidad.')}
    </div>

    <div class="card">
      <div class="card-title">Detalle de facturas pendientes</div>
      ${tableOrEmpty(pendingBU, ['#', 'Cliente', 'CUIT', 'Fecha', 'Total', 'Cobrado', 'Pendiente', 'Estado', ''], (s) => `
        <tr>
          <td class="mono">#${s.id}</td>
          <td>${customerName(s.customer_id)}</td>
          <td class="mono">${customerTaxId(s.customer_id)}</td>
          <td class="mono">${fmtDate(s.date)}</td>
          <td class="num">$ ${fmtMoney(s.total_amount)}</td>
          <td class="num income">$ ${fmtMoney(s.settled_amount)}</td>
          <td class="num expense">$ ${fmtMoney(s.remaining_amount)}</td>
          <td>${collectionBadge(s.collection_status)}</td>
          <td>
            <button class="btn btn-sm" onclick="showSaleDetail(${s.id})">Detalle</button>
            ${s.collection_status !== 'COBRADO' ? `<button class="btn btn-sm btn-primary" onclick="openCollectModal(${s.id}, ${s.remaining_amount})">Procesar cobro</button>` : ''}
          </td>
        </tr>`, 'No hay facturas pendientes de cobro en esta unidad.')}
    </div>
  `;
}
async function showSaleDetail(saleId) {
  const items = await api(`/sales/${saleId}/items`);
  openModal(`
    <h2>Detalle — Venta #${saleId}</h2>
    ${tableOrEmpty(items, ['Código', 'Artículo', 'Cantidad', 'Precio unit.', 'Subtotal'], (i) => `
      <tr>
        <td class="mono">${i.code}</td>
        <td>${i.description}</td>
        <td class="num">${fmtQty(i.quantity)}</td>
        <td class="num">$ ${fmtMoney(i.unit_price)}</td>
        <td class="num income">$ ${fmtMoney(i.subtotal)}</td>
      </tr>`, 'Sin artículos registrados en esta venta.')}
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cerrar</button>
      <span style="display:inline-block;width:1px;height:20px;background:var(--border);margin:0 4px"></span>
      <button class="btn" onclick="openComprobanteModal(${saleId})">Comprobante</button>
      <button class="btn" onclick="openRemitoModal(${saleId})">Remito</button>
    </div>
  `);
}

// ---------------------------------------------------------
// COMPROBANTE Y REMITO (documentos imprimibles / PDF / envío)
// ---------------------------------------------------------
function buLogoPath(buName) {
  const key = Object.keys(BU_THEME).find(k => (buName || '').toLowerCase().includes(k));
  return BU_THEME[key]?.logo || 'assets/logo.jpg';
}
function docNumber(saleId) {
  return String(saleId).padStart(8, '0');
}
function waLink(phone, text) {
  const digits = (phone || '').replace(/[^0-9]/g, '');
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

function formatCustomerAddress(customer) {
  const parts = [];
  if (customer.street) parts.push(`${customer.street}${customer.street_number ? ' ' + customer.street_number : ''}`);
  if (customer.locality) parts.push(customer.locality);
  if (customer.province) parts.push(customer.province);
  if (customer.postal_code) parts.push(`CP ${customer.postal_code}`);
  if (customer.country) parts.push(customer.country);
  return parts.length ? parts.join(', ') : (customer.address || '');
}

function buildDocumentHtml({ type, sale, customer, business_unit, warehouse, items }) {
  const isRemito = type === 'remito';
  const title = isRemito ? 'REMITO DE ENTREGA' : 'COMPROBANTE DE VENTA';
  const logo = buLogoPath(business_unit.name);
  const number = docNumber(sale.id);
  const dateStr = fmtDate(sale.date);
  const currencySym = sale.currency === 'USD' ? 'US$' : '$';

  const itemsRows = items.map(i => isRemito ? `
    <tr>
      <td class="mono">${i.code}</td>
      <td>${i.description}</td>
      <td class="num">${fmtQty(i.quantity)}</td>
    </tr>` : `
    <tr>
      <td class="mono">${i.code}</td>
      <td>${i.description}</td>
      <td class="num">${fmtQty(i.quantity)}</td>
      <td class="num">${currencySym} ${fmtMoney(i.unit_price)}</td>
      <td class="num">${currencySym} ${fmtMoney(i.subtotal)}</td>
    </tr>`).join('');

  const itemsHeader = isRemito
    ? `<tr><th>Código</th><th>Descripción</th><th style="text-align:right">Cantidad</th></tr>`
    : `<tr><th>Código</th><th>Descripción</th><th style="text-align:right">Cantidad</th><th style="text-align:right">Precio unit.</th><th style="text-align:right">Subtotal</th></tr>`;

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>${title} — ${business_unit.name} #${number}</title>
<style>
  @page { size: A4; margin: 18mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1a1a1a; margin: 0; padding: 0; font-size: 13px; }
  .sheet { max-width: 760px; margin: 0 auto; padding: 10px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1a1a1a; padding-bottom: 18px; margin-bottom: 24px; }
  .header-left { display: flex; align-items: center; gap: 16px; }
  .header-left img { height: 56px; width: auto; }
  .company-name { font-size: 17px; font-weight: 700; letter-spacing: 0.02em; }
  .company-sub { font-size: 11px; color: #666; margin-top: 2px; }
  .doc-meta { text-align: right; }
  .doc-title { font-size: 15px; font-weight: 700; letter-spacing: 0.05em; color: #1a1a1a; }
  .doc-number { font-family: 'Courier New', monospace; font-size: 13px; color: #444; margin-top: 4px; }
  .doc-date { font-size: 12px; color: #666; margin-top: 2px; }
  .section-title { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.08em; color: #888; font-weight: 700; margin-bottom: 8px; }
  .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 28px; }
  .info-box { border: 1px solid #ddd; border-radius: 6px; padding: 14px 16px; }
  .info-row { font-size: 12.5px; margin-bottom: 4px; }
  .info-row strong { color: #333; }
  table.items { width: 100%; border-collapse: collapse; margin-bottom: 28px; }
  table.items th { text-align: left; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.05em; color: #888; font-weight: 700; padding: 8px 6px; border-bottom: 2px solid #1a1a1a; }
  table.items td { padding: 9px 6px; border-bottom: 1px solid #eee; font-size: 12.5px; }
  .num { text-align: right; font-family: 'Courier New', monospace; }
  .totals { display: flex; justify-content: flex-end; margin-bottom: 30px; }
  .totals table { width: 260px; border-collapse: collapse; }
  .totals td { padding: 6px 8px; font-size: 12.5px; }
  .totals .total-row td { border-top: 2px solid #1a1a1a; font-weight: 700; font-size: 14px; padding-top: 10px; }
  .transport-box { border: 1px solid #ddd; border-radius: 6px; padding: 14px 16px; margin-bottom: 28px; }
  .signature-area { display: flex; justify-content: space-between; margin-top: 60px; }
  .signature-line { border-top: 1px solid #333; width: 220px; text-align: center; font-size: 11px; color: #666; padding-top: 6px; }
  .footer-note { font-size: 10.5px; color: #999; text-align: center; margin-top: 40px; border-top: 1px solid #eee; padding-top: 12px; }
  .actions { max-width: 760px; margin: 0 auto 20px; display: flex; gap: 10px; padding: 0 10px; }
  .actions button, .actions a { font-family: inherit; font-size: 13px; padding: 9px 16px; border-radius: 7px; border: 1px solid #ccc; background: #fff; cursor: pointer; text-decoration: none; color: #1a1a1a; }
  .actions .primary { background: #1a1a1a; color: #fff; border-color: #1a1a1a; }
  @media print { .actions { display: none; } body { font-size: 12.5px; } }
</style>
</head>
<body>
  <div class="actions no-print">
    <button class="primary" onclick="window.print()">🖨️ Imprimir / Guardar PDF</button>
    ${customer.phone ? `<a href="${waLink(customer.phone, `Hola ${customer.name}, te comparto el ${isRemito ? 'remito' : 'comprobante'} #${number} de ${business_unit.name}.`)}" target="_blank">📱 Enviar por WhatsApp</a>` : ''}
    ${customer.email ? `<a href="mailto:${customer.email}?subject=${encodeURIComponent(`${title} #${number} — ${business_unit.name}`)}&body=${encodeURIComponent(`Hola ${customer.name},\n\nTe compartimos el ${isRemito ? 'remito de entrega' : 'comprobante de venta'} #${number}.\nAdjuntá el PDF generado con el botón "Imprimir / Guardar PDF" antes de enviar este correo.\n\nSaludos.`)}">✉️ Enviar por email</a>` : ''}
  </div>

  <div class="sheet">
    <div class="header">
      <div class="header-left">
        <img src="${logo}" alt="${business_unit.name}">
        <div>
          <div class="company-name">${business_unit.name.toUpperCase()}</div>
          <div class="company-sub">You One Racing S.A.S.</div>
        </div>
      </div>
      <div class="doc-meta">
        <div class="doc-title">${title}</div>
        <div class="doc-number">N° ${number}</div>
        <div class="doc-date">${dateStr}</div>
      </div>
    </div>

    <div class="info-grid">
      <div class="info-box">
        <div class="section-title">Cliente</div>
        <div class="info-row"><strong>${customer.name}</strong></div>
        ${customer.tax_id ? `<div class="info-row">CUIT/Tax ID: ${customer.tax_id}</div>` : ''}
        ${(() => {
          const full = formatCustomerAddress(customer);
          return full ? `<div class="info-row">${full}</div>` : '';
        })()}
        ${customer.phone ? `<div class="info-row">Tel: ${customer.phone}</div>` : ''}
        ${customer.email ? `<div class="info-row">${customer.email}</div>` : ''}
      </div>
      <div class="info-box">
        <div class="section-title">${isRemito ? 'Entrega' : 'Detalle'}</div>
        <div class="info-row">Depósito de origen: ${warehouse?.name || '-'}</div>
        <div class="info-row">Forma de pago: ${paymentTypeLabel(sale.payment_type)}</div>
        ${!isRemito ? `<div class="info-row">Moneda: ${sale.currency}</div>` : ''}
      </div>
    </div>

    <table class="items">
      <thead>${itemsHeader}</thead>
      <tbody>${itemsRows}</tbody>
    </table>

    ${!isRemito ? `
    <div class="totals">
      <table>
        <tr class="total-row"><td>TOTAL</td><td class="num">${currencySym} ${fmtMoney(sale.total_amount)}</td></tr>
      </table>
    </div>` : ''}

    ${isRemito ? `
    <div class="transport-box">
      <div class="section-title">Lugar de entrega</div>
      <div class="info-row">${sale.delivery_address || formatCustomerAddress(customer) || '—'}</div>
    </div>
    <div class="transport-box">
      <div class="section-title">Transporte</div>
      <div class="info-row"><strong>Transportista:</strong> ${sale.carrier || '—'}</div>
      ${sale.delivery_notes ? `<div class="info-row"><strong>Observaciones:</strong> ${sale.delivery_notes}</div>` : ''}
    </div>
    <div class="signature-area">
      <div class="signature-line">Firma transportista</div>
      <div class="signature-line">Recibí conforme — Aclaración y DNI</div>
    </div>` : ''}

    <div class="footer-note">${business_unit.name} — You One Racing S.A.S. · Documento generado el ${fmtDate(new Date().toISOString())}</div>
  </div>
</body>
</html>`;
}

async function openComprobanteModal(saleId) {
  try {
    const data = await api(`/sales/${saleId}/full`);
    const html = buildDocumentHtml({ type: 'comprobante', ...data });
    const win = window.open('', '_blank');
    win.document.write(html);
    win.document.close();
    api(`/sales/${saleId}/document-log`, { method: 'POST', body: JSON.stringify({ type: 'comprobante' }) }).catch(() => {});
  } catch (e) { toast(e.message, 'error'); }
}

async function openRemitoModal(saleId) {
  const data = await api(`/sales/${saleId}/full`);
  const defaultAddress = data.sale.delivery_address || formatCustomerAddress(data.customer);
  openModal(`
    <h2>Datos de entrega — Remito Venta #${saleId}</h2>
    <div class="field"><label>Lugar de entrega</label><input id="f_delivery_address" value="${escAttr(defaultAddress)}" placeholder="Dirección donde se entrega esta venta"></div>
    <div class="hint" style="margin-top:-10px;margin-bottom:14px">Por defecto usa la dirección del cliente. Podés cambiarla si el envío va a otro lugar.</div>
    <div class="field"><label>Transportista</label><input id="f_carrier" value="${escAttr(data.sale.carrier)}" placeholder="Ej: Andreani, transporte propio…"></div>
    <div class="field"><label>Observaciones de entrega (opcional)</label><input id="f_delivery_notes" value="${escAttr(data.sale.delivery_notes)}"></div>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="submitRemito(${saleId})">Guardar y generar remito</button>
    </div>
  `);
}
async function submitRemito(saleId) {
  try {
    await api(`/sales/${saleId}/transport`, {
      method: 'PUT',
      body: JSON.stringify({
        carrier: document.getElementById('f_carrier').value,
        delivery_notes: document.getElementById('f_delivery_notes').value,
        delivery_address: document.getElementById('f_delivery_address').value,
      }),
    });
    const data = await api(`/sales/${saleId}/full`);
    const html = buildDocumentHtml({ type: 'remito', ...data });
    const win = window.open('', '_blank');
    win.document.write(html);
    win.document.close();
    closeModal();
    api(`/sales/${saleId}/document-log`, { method: 'POST', body: JSON.stringify({ type: 'remito' }) }).catch(() => {});
  } catch (e) { toast(e.message, 'error'); }
}
async function deleteDocumentLogEntry(id) {
  if (!confirm('¿Eliminar este registro del historial? Esto no afecta la venta ni sus datos.')) return;
  try {
    await api(`/sales-documents/history/${id}`, { method: 'DELETE' });
    toast('Registro eliminado del historial.');
    renderView();
  } catch (e) { toast(e.message, 'error'); }
}

function customerName(id) {
  return state.cache.customers.find(c => c.id === id)?.name || `Cliente #${id}`;
}

let lineItemCount = 0;
async function openLoadQuoteModal() {
  const all = await api('/quotes');
  const pending = all.filter(q => q.business_unit_id === state.selectedBU && q.status === 'PENDING');
  window._previousModalHtml = document.getElementById('modal').innerHTML;

  openModal(`
    <h2>Elegir presupuesto</h2>
    ${tableOrEmpty(pending, ['#', 'Cliente', 'Fecha', 'Total', ''], (q) => `
      <tr>
        <td class="mono">#${q.id}</td>
        <td>${customerName(q.customer_id)}</td>
        <td class="mono">${fmtDate(q.date)}</td>
        <td class="num income">${q.currency === 'USD' ? 'US$' : '$'} ${fmtMoney(q.total_amount)}</td>
        <td><button class="btn btn-sm btn-primary" onclick="selectQuoteToLoad(${q.id})">Usar este</button></td>
      </tr>`, 'No hay presupuestos pendientes en esta unidad.')}
    <div class="modal-actions"><button class="btn" onclick="restorePreviousModal()">Volver</button></div>
  `);
}
function restorePreviousModal() {
  if (window._previousModalHtml != null) {
    document.getElementById('modal').innerHTML = window._previousModalHtml;
  }
}

async function selectQuoteToLoad(quoteId) {
  const [quote, items] = await Promise.all([
    api('/quotes').then(list => list.find(q => q.id === quoteId)),
    api(`/quotes/${quoteId}/items`),
  ]);
  newOperationModal('sale');

  document.getElementById('f_quote_id').value = quoteId;
  document.getElementById('loadedQuoteLabel').textContent = ` — usando presupuesto #${quoteId}`;
  selectSearchableOption('contact', quote.customer_id);
  if (quote.warehouse_id) selectSearchableOption('warehouse', quote.warehouse_id);
  if (quote.project_id) selectSearchableOption('project', quote.project_id);
  document.getElementById('f_sale_currency').value = quote.currency;

  document.getElementById('lineItems').innerHTML = '';
  items.forEach(item => {
    const id = lineItemCount++;
    const container = document.getElementById('lineItems');
    const row = document.createElement('div');
    row.className = 'line-item-row';
    row.id = `line_${id}`;
    row.dataset.articleId = item.article_id;
    row.innerHTML = `
      <div class="article-search-wrap">
        <input type="text" class="article-search-input" id="artsearch_${id}" value="${escAttr(item.code + ' — ' + item.description)}" readonly>
        <input type="hidden" id="artid_${id}" value="${item.article_id}">
      </div>
      <input type="number" step="0.001" id="qty_${id}" value="${item.quantity}" oninput="recalcLineItemsTotal()">
      <input type="number" step="0.01" id="price_${id}" value="${item.unit_price}" oninput="recalcLineItemsTotal()">
      <button class="remove-line" onclick="document.getElementById('line_${id}').remove(); recalcLineItemsTotal();">×</button>
    `;
    container.appendChild(row);
  });
  recalcLineItemsTotal();
  toast('Presupuesto cargado en la venta. Revisá los datos antes de guardar.');
}

function newOperationModal(kind) {
  const isPurchase = kind === 'purchase';
  const contactItems = (isPurchase ? state.cache.suppliers : state.cache.customers)
    .map(c => ({ id: c.id, label: c.name }));
  const whItems = whByBU().map(w => ({ id: w.id, label: w.name }));
  const projItems = [{ id: '', label: 'Sin proyecto' }, ...projByBU().map(p => ({ id: p.id, label: p.name }))];
  const cashBoxItems = state.cache.cashBoxes.map(b => ({ id: b.id, label: `${b.name} (${b.kind === 'SOBRE' ? 'Sobre' : 'Caja'} · ${b.currency})` }));

  lineItemCount = 0;
  totalManuallyEdited = false;
  openModal(`
    <h2>${isPurchase ? 'Nueva compra' : 'Nueva venta'}</h2>
    <input type="hidden" id="f_quote_id" value="">
    ${!isPurchase ? `
    <div style="margin-bottom:14px">
      <button class="btn btn-sm" onclick="openLoadQuoteModal()">Cargar desde presupuesto</button>
      <span class="hint" id="loadedQuoteLabel"></span>
    </div>` : ''}
    <div class="field"><label>${isPurchase ? 'Proveedor' : 'Cliente'}</label>
      ${searchableSelectHtml('contact', contactItems, `Buscar ${isPurchase ? 'proveedor' : 'cliente'}…`)}
    </div>
    <div class="field-row">
      <div class="field"><label>Depósito</label>${searchableSelectHtml('warehouse', whItems, 'Buscar depósito…')}</div>
      <div class="field"><label>Proyecto (opcional)</label>${searchableSelectHtml('project', projItems, 'Buscar proyecto…', 'Sin proyecto')}</div>
    </div>
    ${!isPurchase ? `
    <div class="field-row">
      <div class="field"><label>Moneda de la venta</label>
        <select id="f_sale_currency" onchange="refreshAllLinePrices()">
          <option value="ARS">Pesos argentinos (ARS)</option>
          <option value="USD">Dólares (USD)</option>
        </select>
      </div>
      <div class="field"><label>Precios</label>
        <select id="f_sale_iva" onchange="refreshAllLinePrices()">
          <option value="no">Sin IVA</option>
          <option value="si">Con IVA</option>
        </select>
      </div>
    </div>` : ''}
    <div class="field"><label>Forma de pago</label>
      <select id="f_payment" onchange="togglePaymentBoxField()">
        <option value="CASH">Contado</option>
        <option value="ACCOUNT">Cuenta corriente</option>
        ${!isPurchase ? '<option value="UNCOLLECTED">Factura sin cobrar (procesar después)</option>' : ''}
      </select>
    </div>
    <div class="field" id="paymentBoxField" style="display:none">
      <label>Caja o sobre de destino</label>
      ${searchableSelectHtml('cashbox', cashBoxItems, 'Buscar caja o sobre…')}
    </div>
    <div class="hint" style="margin-top:-10px;margin-bottom:14px">La caja o sobre de destino se elige después, al procesar el ${isPurchase ? 'pago de esta compra' : 'cobro de esta venta'}.</div>

    <div class="field"><label>Artículos</label>
      <div class="line-items" id="lineItems"></div>
      <button class="btn btn-sm" onclick="addLineItem('${kind}')">+ Agregar artículo</button>
    </div>

    ${!isPurchase ? `
    <div class="field">
      <label>Importe final (editable)</label>
      <input id="f_total_override" type="number" step="0.01" placeholder="Se calcula solo, pero podés modificarlo" oninput="markTotalAsManual()">
      <div class="hint" id="totalHint">Se calcula automáticamente a partir de los artículos. Podés cambiarlo manualmente si necesitás ajustarlo.</div>
    </div>` : ''}

    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="createOperation('${kind}')">Guardar</button>
    </div>
  `);
  addLineItem(kind);
}
let totalManuallyEdited = false;
function markTotalAsManual() {
  totalManuallyEdited = true;
  document.getElementById('totalHint').textContent = 'Importe modificado manualmente. No se recalculará solo.';
}
function recalcLineItemsTotal() {
  if (totalManuallyEdited) return;
  const rows = [...document.getElementById('lineItems').children];
  let total = 0;
  rows.forEach(row => {
    const idMatch = row.id.replace('line_', '');
    const qty = Number(document.getElementById(`qty_${idMatch}`)?.value) || 0;
    const price = Number(document.getElementById(`price_${idMatch}`)?.value) || 0;
    total += qty * price;
  });
  const overrideField = document.getElementById('f_total_override');
  if (overrideField) overrideField.value = total.toFixed(2);
}

function togglePaymentBoxField() {
  document.getElementById('paymentBoxField').style.display = 'none';
}

function addLineItem(kind) {
  const isPurchase = kind === 'purchase';
  const id = lineItemCount++;
  const container = document.getElementById('lineItems');
  const row = document.createElement('div');
  row.className = 'line-item-row';
  row.id = `line_${id}`;
  row.innerHTML = `
    <div class="article-search-wrap">
      <input type="text" class="article-search-input" id="artsearch_${id}" placeholder="Buscar por código, código alt. o nombre…"
             autocomplete="off" oninput="filterArticleOptions(${id}, ${isPurchase})" onfocus="filterArticleOptions(${id}, ${isPurchase})">
      <input type="hidden" id="artid_${id}">
      <div class="article-search-results" id="artresults_${id}"></div>
    </div>
    <input type="number" step="0.001" placeholder="Cant." id="qty_${id}" value="1" oninput="recalcLineItemsTotal()">
    <input type="number" step="0.01" placeholder="${isPurchase ? 'Costo' : 'Precio'}" id="price_${id}" oninput="recalcLineItemsTotal()">
    <button class="remove-line" onclick="document.getElementById('line_${id}').remove(); recalcLineItemsTotal();">×</button>
  `;
  container.appendChild(row);
  recalcLineItemsTotal();

  document.addEventListener('click', (e) => {
    if (!e.target.closest(`#line_${id}`)) {
      const r = document.getElementById(`artresults_${id}`);
      if (r) r.style.display = 'none';
    }
  });
}

function filterArticleOptions(id, isPurchase) {
  const query = document.getElementById(`artsearch_${id}`).value.trim().toLowerCase();
  const resultsEl = document.getElementById(`artresults_${id}`);
  const articles = artByBU();

  const matches = query
    ? articles.filter(a =>
        (a.code || '').toLowerCase().includes(query) ||
        (a.alt_code || '').toLowerCase().includes(query) ||
        (a.description || '').toLowerCase().includes(query))
    : articles;

  if (!matches.length) {
    resultsEl.innerHTML = `<div class="article-search-empty">Sin resultados</div>`;
  } else {
    resultsEl.innerHTML = matches.slice(0, 30).map(a => `
      <div class="article-search-item" onclick="selectArticleOption(${id}, ${a.article_id}, ${isPurchase})">
        <span class="article-search-code">${a.code}${a.alt_code ? ' · ' + a.alt_code : ''}</span>
        <span class="article-search-desc">${a.description}</span>
      </div>
    `).join('');
  }
  resultsEl.style.display = 'block';
}

function selectArticleOption(id, articleId, isPurchase) {
  const article = artByBU().find(a => a.article_id === articleId);
  if (!article) return;
  document.getElementById(`artsearch_${id}`).value = `${article.code} — ${article.description}`;
  document.getElementById(`artid_${id}`).value = articleId;
  document.getElementById(`line_${id}`).dataset.articleId = articleId;
  let price;
  if (isPurchase) {
    price = Number(article.list_cost);
  } else {
    const saleCurrency = document.getElementById('f_sale_currency')?.value || 'ARS';
    const withIva = document.getElementById('f_sale_iva')?.value === 'si';
    price = articlePriceFor(article, saleCurrency, withIva);
    if (price == null) price = withIva ? Number(article.final_price_with_iva) : Number(article.final_price);
  }
  document.getElementById(`price_${id}`).value = price.toFixed(2);
  document.getElementById(`artresults_${id}`).style.display = 'none';
  recalcLineItemsTotal();
}
function refreshAllLinePrices() {
  const rows = [...document.getElementById('lineItems').children];
  rows.forEach(row => {
    const id = row.id.replace('line_', '');
    const articleId = Number(row.dataset.articleId);
    if (articleId) selectArticleOption(id, articleId, false);
  });
}

async function createOperation(kind) {
  const isPurchase = kind === 'purchase';
  const rows = [...document.getElementById('lineItems').children];
  const items = rows.map(row => {
    const idMatch = row.id.replace('line_', '');
    return {
      article_id: Number(document.getElementById(`artid_${idMatch}`).value),
      quantity: Number(document.getElementById(`qty_${idMatch}`).value),
      [isPurchase ? 'unit_cost' : 'unit_price']: Number(document.getElementById(`price_${idMatch}`).value),
    };
  }).filter(i => i.article_id);

  if (!items.length) { toast('Agregá al menos un artículo.', 'error'); return; }

  const payload = {
    business_unit_id: state.selectedBU,
    warehouse_id: Number(getSearchableValue('warehouse')),
    project_id: getSearchableValue('project') ? Number(getSearchableValue('project')) : null,
    payment_type: document.getElementById('f_payment').value,
    cash_box_id: null,
    items,
  };
  payload[isPurchase ? 'supplier_id' : 'customer_id'] = Number(getSearchableValue('contact'));
  if (!isPurchase) {
    payload.currency = document.getElementById('f_sale_currency').value;
    const overrideVal = document.getElementById('f_total_override').value;
    if (overrideVal !== '') payload.total_override = Number(overrideVal);
    const quoteIdVal = document.getElementById('f_quote_id')?.value;
    if (quoteIdVal) payload.quote_id = Number(quoteIdVal);
  }

  try {
    await api(`/${kind === 'purchase' ? 'purchases' : 'sales'}`, { method: 'POST', body: JSON.stringify(payload) });
    closeModal();
    toast(`${isPurchase ? 'Compra' : 'Venta'} creada como pendiente. Confirmala para mover stock y caja.`);
    renderView();
  } catch (e) { toast(e.message, 'error'); }
}

// ---------------------------------------------------------
// CAJA
// ---------------------------------------------------------
function cashBoxIcon(name, kind) {
  const n = name.toLowerCase();
  const logoMap = {
    'mercado pago': 'assets/icons/mercadopago.png',
    'macro pesos': 'assets/icons/macro.png',
    'macro dólares': 'assets/icons/macro.png',
    'macro dolares': 'assets/icons/macro.png',
    'gnb': 'assets/icons/gnb.png',
    'reiger': 'assets/icons/reiger.png',
    'endless': 'assets/icons/endless.png',
    'sadev': 'assets/icons/sadev.png',
    'peugeot': 'assets/icons/peugeot.png',
    'kw': 'assets/icons/kw.png',
  };
  for (const key in logoMap) {
    if (n.includes(key)) return `<img src="${logoMap[key]}" alt="${name}" class="cashbox-tile-logo">`;
  }
  const emojiMap = { 'inversión': '📈', 'inversion': '📈', 'ganancia': '💹', 'taller': '🔧' };
  for (const key in emojiMap) {
    if (n.includes(key)) return `<span class="cashbox-tile-emoji">${emojiMap[key]}</span>`;
  }
  return `<span class="cashbox-tile-emoji">${kind === 'SOBRE' ? '✉️' : '💰'}</span>`;
}


async function verifySaleCollection(id) {
  if (!(await verifyPasswordPrompt('confirmar el movimiento físico de este cobro'))) return;
  try {
    await api(`/sale-collections/${id}/verify`, { method: 'POST' });
    toast('Cobro verificado. Ya impacta en el saldo de la caja/sobre.');
    renderView();
  } catch (e) { toast(e.message, 'error'); }
}
async function rejectSaleCollection(id) {
  if (!confirm('¿Rechazar este cobro? La venta vuelve a quedar pendiente por ese monto.')) return;
  if (!(await verifyPasswordPrompt('rechazar este cobro'))) return;
  try {
    await api(`/sale-collections/${id}/reject`, { method: 'POST' });
    toast('Cobro rechazado. El saldo pendiente de la venta se actualizó.');
    renderView();
  } catch (e) { toast(e.message, 'error'); }
}

async function renderCash() {
  document.getElementById('viewActions').innerHTML = `
    <button class="btn btn-sm" onclick="newCashBoxModal('CAJA')">+ Nueva caja</button>
    <button class="btn btn-sm" onclick="newCashBoxModal('SOBRE')">+ Nuevo sobre</button>`;
  const el = document.getElementById('view');
  const dashboard = await api('/cash-boxes/dashboard');
  const cajas = dashboard.filter(b => b.kind === 'CAJA');
  const sobres = dashboard.filter(b => b.kind === 'SOBRE');

const tile = (b) => `
    <div class="cashbox-tile ${b.currency === 'USD' ? 'usd' : 'ars'}">
      <div class="cashbox-tile-icon">${cashBoxIcon(b.name, b.kind)}</div>
      <div class="cashbox-tile-name" onclick="selectCashBoxFilter(${b.cash_box_id})">${b.name}</div>
      <div class="cashbox-tile-balance" onclick="selectCashBoxFilter(${b.cash_box_id})">${b.currency === 'USD' ? 'US$' : '$'} ${fmtMoney(b.current_balance)}</div>
      <div class="cashbox-tile-meta">
        <span class="income">+${fmtMoney(b.total_income)}</span>
        <span class="expense">−${fmtMoney(b.total_expense)}</span>
      </div>
      <div class="cashbox-tile-currency">${b.currency}</div>
      <button class="btn btn-sm" style="margin-top:10px;width:100%" onclick="openManualBalanceModal(${b.cash_session_id}, '${b.name.replace(/'/g, "\\'")}', ${b.current_balance})">Ajustar saldo base</button>
      <button class="btn btn-sm btn-danger" style="margin-top:6px;width:100%" onclick="deleteCashBox(${b.cash_box_id}, '${b.name.replace(/'/g, "\\'")}')">Eliminar</button>
    </div>`;

  el.innerHTML = `
    <div class="card">
      <div class="card-title">Cajas</div>
      <div class="cashbox-grid">${cajas.map(tile).join('')}</div>
    </div>
    <div class="card">
      <div class="card-title">Sobres</div>
      <div class="cashbox-grid">${sobres.map(tile).join('')}</div>
    </div>

    <div class="card">
      <div class="section-toolbar">
        <div class="card-title" style="margin:0">Movimientos por caja o sobre</div>
        <button class="btn btn-sm" onclick="downloadFile('/cash-movements/export-manual', 'movimientos_manuales.xlsx')">Exportar movimientos manuales (Excel)</button>
      </div>
      <div class="field" style="max-width:280px">
        <label>Filtrar</label>
        <select id="cashFilterSelect" onchange="loadCashBoxMovements()">
          <option value="">— Seleccioná —</option>
          <optgroup label="Cajas">${state.cache.cashBoxes.filter(b => b.kind === 'CAJA').map(b => `<option value="${b.id}">${b.name} (${b.currency})</option>`).join('')}</optgroup>
          <optgroup label="Sobres">${state.cache.cashBoxes.filter(b => b.kind === 'SOBRE').map(b => `<option value="${b.id}">${b.name} (${b.currency})</option>`).join('')}</optgroup>
        </select>
      </div>
      <div id="cashMovementsResult"></div>
    </div>
  `;
}

let manualMovementMode = 'simple'; // 'simple' | 'transfer'
let manualFromBox = null;
let manualToBox = null;

async function renderManualMovement() {
  document.getElementById('viewActions').innerHTML = '';
  const el = document.getElementById('view');
  const boxes = state.cache.cashBoxes || [];

  if (!boxes.length) {
    el.innerHTML = `<div class="empty-state">No hay cajas ni sobres cargados todavía.</div>`;
    return;
  }

  manualFromBox = null;
  manualToBox = null;

  const pending = await api('/cash-movements/pending');

  const boxTiles = (idPrefix, selectFn) => boxes.map(b => `
    <div class="cashbox-picker-tile" data-box-id="${b.id}" id="${idPrefix}_${b.id}" onclick="${selectFn}(${b.id})">
      <div class="cashbox-tile-icon">${cashBoxIcon(b.name, b.kind)}</div>
      <div class="cashbox-picker-name">${b.name}</div>
      <div class="cashbox-picker-meta">${b.kind === 'SOBRE' ? 'Sobre' : 'Caja'} · ${b.currency}</div>
    </div>`).join('');

  el.innerHTML = `
    <div class="card">
      <div class="section-toolbar">
        <div class="card-title" style="margin:0">1. Tipo de movimiento</div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-sm ${manualMovementMode === 'simple' ? 'btn-primary' : ''}" onclick="setManualMovementMode('simple')">Ingreso / Egreso</button>
          <button class="btn btn-sm ${manualMovementMode === 'transfer' ? 'btn-primary' : ''}" onclick="setManualMovementMode('transfer')">Transferencia entre caja/sobre</button>
        </div>
      </div>

      <div id="manualModeSimple" style="display:${manualMovementMode === 'simple' ? 'block' : 'none'}">
        <div class="hint" style="margin-bottom:10px">Elegí la caja o sobre donde entra o sale el dinero.</div>
        <div class="cashbox-picker-grid" id="manualBoxPicker">${boxTiles('simplebox', 'selectManualBox')}</div>
      </div>

      <div id="manualModeTransfer" style="display:${manualMovementMode === 'transfer' ? 'block' : 'none'}">
        <div class="hint" style="margin-bottom:6px"><strong>Sale de:</strong></div>
        <div class="cashbox-picker-grid" id="manualFromPicker" style="margin-bottom:16px">${boxTiles('frombox', 'selectManualFromBox')}</div>
        <div class="hint" style="margin-bottom:6px"><strong>Entra a:</strong></div>
        <div class="cashbox-picker-grid" id="manualToPicker">${boxTiles('tobox', 'selectManualToBox')}</div>
      </div>
    </div>

    <div class="card" id="manualMovementForm" style="display:none">
      <div class="card-title">2. Datos del movimiento — <span id="selectedBoxLabel"></span></div>
      <input type="hidden" id="f_mov_box">
      <div class="field-row">
        <div class="field" id="manualTypeField"><label>Tipo</label><select id="f_mov_type"><option value="INCOME">Ingreso</option><option value="EXPENSE">Egreso</option></select></div>
        <div class="field"><label>Monto</label><input id="f_mov_amount" type="number" step="0.01" placeholder="0.00"></div>
      </div>
      <div class="field"><label>Proyecto (opcional)</label><select id="f_mov_project"><option value="">Sin proyecto</option>${projByBU().map(p => `<option value="${p.id}">${p.name}</option>`).join('')}</select></div>
      <div class="field"><label>Descripción</label><input id="f_mov_desc" placeholder="Ej: Pago de servicios"></div>
      <button class="btn btn-primary" onclick="createCashMovement()">Registrar movimiento</button>
      <div class="hint" style="margin-top:8px">Queda pendiente de verificación hasta confirmar que el dinero se movió físicamente (ver abajo).</div>
    </div>

    <div class="card">
      <div class="card-title">Movimientos manuales pendientes de verificación ${pending.length ? `(${pending.length})` : ''}</div>
      ${tableOrEmpty(pending, ['Fecha', 'Tipo', 'Origen', 'Destino', 'Monto', 'Descripción', ''], (p) => `
        <tr>
          <td class="mono">${fmtDate(p.created_at)}</td>
          <td>${p.kind === 'TRANSFER' ? 'Transferencia' : p.kind === 'INCOME' ? 'Ingreso' : 'Egreso'}</td>
          <td>${p.from_box_name || '-'}</td>
          <td>${p.to_box_name || '-'}</td>
          <td class="num income">$ ${fmtMoney(p.amount)}</td>
          <td>${p.description || '-'}</td>
          <td>
            <button class="btn btn-sm btn-primary" onclick="verifyPendingMovement(${p.id})">Confirmar movimiento físico</button>
            <button class="btn btn-sm btn-danger" onclick="rejectPendingMovement(${p.id})">Rechazar</button>
          </td>
        </tr>`, 'No hay movimientos manuales esperando verificación.')}
    </div>
  `;
}
function setManualMovementMode(mode) {
  manualMovementMode = mode;
  document.getElementById('manualMovementForm').style.display = 'none';
  renderManualMovement();
}
function selectManualBox(boxId) {
  const box = state.cache.cashBoxes.find(b => b.id === boxId);
  if (!box) return;
  document.querySelectorAll('#manualBoxPicker .cashbox-picker-tile').forEach(t => t.classList.toggle('selected', Number(t.dataset.boxId) === boxId));
  document.getElementById('manualTypeField').style.display = 'block';
  document.getElementById('f_mov_box').value = boxId;
  document.getElementById('selectedBoxLabel').textContent = `${box.name} (${box.kind === 'SOBRE' ? 'Sobre' : 'Caja'} · ${box.currency})`;
  document.getElementById('manualMovementForm').style.display = 'block';
}
function selectManualFromBox(boxId) {
  manualFromBox = boxId;
  document.querySelectorAll('#manualFromPicker .cashbox-picker-tile').forEach(t => t.classList.toggle('selected', Number(t.dataset.boxId) === boxId));
  updateTransferForm();
}
function selectManualToBox(boxId) {
  manualToBox = boxId;
  document.querySelectorAll('#manualToPicker .cashbox-picker-tile').forEach(t => t.classList.toggle('selected', Number(t.dataset.boxId) === boxId));
  updateTransferForm();
}
function updateTransferForm() {
  if (!manualFromBox || !manualToBox) return;
  if (manualFromBox === manualToBox) { toast('El origen y el destino deben ser distintos.', 'error'); return; }
  const from = state.cache.cashBoxes.find(b => b.id === manualFromBox);
  const to = state.cache.cashBoxes.find(b => b.id === manualToBox);
  document.getElementById('manualTypeField').style.display = 'none';
  document.getElementById('selectedBoxLabel').textContent = `${from.name} → ${to.name}`;
  document.getElementById('manualMovementForm').style.display = 'block';
}

async function createCashMovement() {
  try {
    if (manualMovementMode === 'transfer') {
      if (!manualFromBox || !manualToBox) { toast('Elegí origen y destino.', 'error'); return; }
      await api('/cash-movements/pending', {
        method: 'POST',
        body: JSON.stringify({
          kind: 'TRANSFER',
          from_cash_box_id: manualFromBox,
          to_cash_box_id: manualToBox,
          business_unit_id: state.selectedBU,
          project_id: document.getElementById('f_mov_project').value ? Number(document.getElementById('f_mov_project').value) : null,
          amount: Number(document.getElementById('f_mov_amount').value),
          description: document.getElementById('f_mov_desc').value,
        }),
      });
    } else {
      const boxId = document.getElementById('f_mov_box').value;
      if (!boxId) { toast('Elegí una caja o sobre primero.', 'error'); return; }
      const type = document.getElementById('f_mov_type').value;
      await api('/cash-movements/pending', {
        method: 'POST',
        body: JSON.stringify({
          kind: type,
          from_cash_box_id: type === 'EXPENSE' ? Number(boxId) : null,
          to_cash_box_id: type === 'INCOME' ? Number(boxId) : null,
          business_unit_id: state.selectedBU,
          project_id: document.getElementById('f_mov_project').value ? Number(document.getElementById('f_mov_project').value) : null,
          amount: Number(document.getElementById('f_mov_amount').value),
          description: document.getElementById('f_mov_desc').value,
        }),
      });
    }
    toast('Movimiento registrado. Queda pendiente de verificación física.');
    renderView();
  } catch (e) { toast(e.message, 'error'); }
}
async function verifyPendingMovement(id) {
  if (!(await verifyPasswordPrompt('confirmar el movimiento físico'))) return;
  try {
    await api(`/cash-movements/pending/${id}/verify`, { method: 'POST' });
    toast('Movimiento verificado. Ya impacta en el saldo.');
    renderView();
  } catch (e) { toast(e.message, 'error'); }
}
async function rejectPendingMovement(id) {
  if (!confirm('¿Rechazar este movimiento pendiente?')) return;
  if (!(await verifyPasswordPrompt('rechazar este movimiento'))) return;
  try {
    await api(`/cash-movements/pending/${id}/reject`, { method: 'POST' });
    toast('Movimiento rechazado.');
    renderView();
  } catch (e) { toast(e.message, 'error'); }
}

async function openManualBalanceModal(sessionId, boxName, currentBalance) {
  if (!(await verifyPasswordPrompt(`ajustar el saldo base de "${boxName}"`))) return;
  openModal(`
    <h2>Ajustar saldo base — ${boxName}</h2>
    <div class="hint" style="margin-bottom:14px">Saldo actual mostrado: <strong>$ ${fmtMoney(currentBalance)}</strong>. Este ajuste modifica el monto de apertura de la caja/sobre directamente.</div>
    <div class="field"><label>Nuevo monto de apertura</label><input id="f_new_opening" type="number" step="0.01" placeholder="0.00"></div>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="submitManualBalance(${sessionId})">Guardar</button>
    </div>
  `);
}
async function submitManualBalance(sessionId) {
  try {
    await api(`/cash-sessions/${sessionId}/opening`, {
      method: 'PUT',
      body: JSON.stringify({ opening_amount: Number(document.getElementById('f_new_opening').value) }),
    });
    closeModal();
    toast('Saldo base actualizado.');
    renderView();
  } catch (e) { toast(e.message, 'error'); }
}

// ---------------------------------------------------------
// SELECTOR CON BUSCADOR INTELIGENTE (genérico, reutilizable)
// ---------------------------------------------------------
window._searchableSelectData = {};

function searchableSelectHtml(baseId, items, placeholder, defaultLabel) {
  window._searchableSelectData[baseId] = items;
  return `
    <div class="article-search-wrap">
      <input type="text" class="article-search-input" id="ss_input_${baseId}" placeholder="${placeholder}"
             value="${defaultLabel ? escAttr(defaultLabel) : ''}" autocomplete="off"
             oninput="filterSearchableSelect('${baseId}')" onfocus="filterSearchableSelect('${baseId}')">
      <input type="hidden" id="ss_value_${baseId}" value="${items[0]?.id ?? ''}">
      <div class="article-search-results" id="ss_results_${baseId}"></div>
    </div>`;
}
function filterSearchableSelect(baseId) {
  const items = window._searchableSelectData[baseId] || [];
  const query = (document.getElementById(`ss_input_${baseId}`)?.value || '').trim().toLowerCase();
  const resultsEl = document.getElementById(`ss_results_${baseId}`);
  if (!resultsEl) return;
  const matches = query ? items.filter(i => i.label.toLowerCase().includes(query)) : items;
  resultsEl.innerHTML = !matches.length
    ? `<div class="article-search-empty">Sin resultados</div>`
    : matches.slice(0, 40).map(i => `
        <div class="article-search-item" onclick="selectSearchableOption('${baseId}', '${i.id}')">
          <span class="article-search-desc">${i.label}</span>
        </div>`).join('');
  resultsEl.style.display = 'block';
}
function selectSearchableOption(baseId, id) {
  const items = window._searchableSelectData[baseId] || [];
  const item = items.find(i => String(i.id) === String(id));
  if (!item) return;
  document.getElementById(`ss_input_${baseId}`).value = item.label;
  document.getElementById(`ss_value_${baseId}`).value = item.id;
  document.getElementById(`ss_results_${baseId}`).style.display = 'none';
  if (item.onSelect) item.onSelect();
}
function getSearchableValue(baseId) {
  return document.getElementById(`ss_value_${baseId}`)?.value || '';
}
document.addEventListener('click', (e) => {
  if (!e.target.closest('.article-search-wrap')) {
    document.querySelectorAll('.article-search-results').forEach(r => r.style.display = 'none');
  }
});

async function downloadFile(path, fallbackName) {
  try {
    const token = getToken();
    const res = await fetch(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!res.ok) { toast('No se pudo generar el archivo.', 'error'); return; }
    const blob = await res.blob();
    const disposition = res.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename="(.+)"/);
    const filename = match ? match[1] : fallbackName;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  } catch (e) { toast('Error al descargar el archivo.', 'error'); }
}

// ---------------------------------------------------------
// IMPORTAR DESDE EXCEL (artículos, depósitos, proveedores, clientes)
// ---------------------------------------------------------
const IMPORT_TEMPLATES = {
  articles: {
    label: 'Artículos',
    headers: ['code', 'alt_code', 'description', 'list_cost', 'currency', 'shipping_margin_pct', 'fx_margin_pct', 'profit_margin_pct', 'iva_pct', 'price_ars', 'price_usd'],
    sample: ['ART001', 'OEM-123', 'Amortiguador delantero', 15000, 'ARS', 5, 0, 30, 21, '', 25],
    bulkEndpoint: '/articles/bulk-import',
    bulkKey: 'articles',
    buildPayload: (row) => ({
      code: row.code,
      alt_code: row.alt_code || '',
      description: row.description,
      list_cost: Number(row.list_cost) || 0,
      currency: (row.currency || 'ARS').toUpperCase(),
      shipping_margin_pct: Number(row.shipping_margin_pct) || 0,
      fx_margin_pct: Number(row.fx_margin_pct) || 0,
      profit_margin_pct: Number(row.profit_margin_pct) || 0,
      iva_pct: row.iva_pct != null && row.iva_pct !== '' ? Number(row.iva_pct) : 21,
      price_ars: row.price_ars != null && row.price_ars !== '' ? Number(row.price_ars) : null,
      price_usd: row.price_usd != null && row.price_usd !== '' ? Number(row.price_usd) : null,
    }),
  },
  warehouses: {
    label: 'Depósitos',
    headers: ['name'],
    sample: ['Depósito Central'],
    bulkEndpoint: '/warehouses/bulk-import',
    bulkKey: 'warehouses',
    buildPayload: (row) => ({ name: row.name }),
  },
  suppliers: {
    label: 'Proveedores',
    headers: ['name', 'tax_id', 'phone', 'email', 'address'],
    sample: ['Proveedor SA', '30-12345678-9', '11-5555-5555', 'contacto@proveedor.com', 'Calle Falsa 123'],
    bulkEndpoint: '/suppliers/bulk-import',
    bulkKey: 'suppliers',
    buildPayload: (row) => ({ name: row.name, tax_id: row.tax_id || '', phone: row.phone || '', email: row.email || '', address: row.address || '' }),
  },
  customers: {
    label: 'Clientes',
    headers: ['name', 'tax_id', 'phone', 'email', 'address', 'street', 'street_number', 'locality', 'province', 'country', 'postal_code'],
    sample: ['Cliente SRL', '30-98765432-1', '11-4444-4444', 'contacto@cliente.com', '', 'Av. Siempreviva', '742', 'Córdoba', 'Córdoba', 'Argentina', '5000'],
    bulkEndpoint: '/customers/bulk-import',
    bulkKey: 'customers',
    buildPayload: (row) => ({
      name: row.name, tax_id: row.tax_id || '', phone: row.phone || '', email: row.email || '', address: row.address || '',
      street: row.street || '', street_number: row.street_number || '', locality: row.locality || '',
      province: row.province || '', country: row.country || 'Argentina', postal_code: row.postal_code || '',
    }),
  },
};

function downloadImportTemplate(kind) {
  const tpl = IMPORT_TEMPLATES[kind];
  const ws = XLSX.utils.aoa_to_sheet([tpl.headers, tpl.sample]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, tpl.label.substring(0, 30));
  XLSX.writeFile(wb, `plantilla_${kind}.xlsx`);
}

function triggerImport(kind) {
  const input = document.getElementById('excelFileInput');
  input.value = '';
  input.onchange = () => handleImportFile(kind, input.files[0]);
  input.click();
}

async function handleImportFile(kind, file) {
  if (!file) return;
  const tpl = IMPORT_TEMPLATES[kind];
  try {
    const data = await file.arrayBuffer();
    const wb = XLSX.read(data);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    if (!rows.length) { toast('El archivo no tiene filas para importar.', 'error'); return; }

    const payloadRows = rows.map(row => {
      const normalized = {};
      Object.keys(row).forEach(k => { normalized[k.trim().toLowerCase()] = row[k]; });
      return tpl.buildPayload(normalized);
    });

    toast(`Importando ${payloadRows.length} registros, un momento…`);

    const body = { [tpl.bulkKey]: payloadRows };
    if (kind === 'articles' || kind === 'warehouses') body.business_unit_id = state.selectedBU;

    const result = await api(tpl.bulkEndpoint, { method: 'POST', body: JSON.stringify(body) });

    renderView();
    if (result.failed === 0) {
      toast(`Importación completa: ${result.created} registros creados.`);
    } else {
      toast(`Importado: ${result.created} — Con errores: ${result.failed}. Revisá códigos/nombres duplicados.`, 'error');
      console.warn('Errores de importación:', result.errors);
    }
  } catch (e) {
    toast(e.message || 'No se pudo leer el archivo. Verificá que sea un Excel válido.', 'error');
  }
}

function selectCashBoxFilter(id) {
  document.getElementById('cashFilterSelect').value = id;
  loadCashBoxMovements();
  document.getElementById('cashFilterSelect').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function newCashBoxModal(kind) {
  openModal(`
    <h2>Nueva ${kind === 'SOBRE' ? 'sobre' : 'caja'}</h2>
    <div class="field"><label>Nombre</label><input id="f_box_name" placeholder="Ej: ${kind === 'SOBRE' ? 'Sobre Depósito Sur' : 'Banco Galicia'}"></div>
    <div class="field"><label>Moneda</label>
      <select id="f_box_currency">
        <option value="ARS">Pesos argentinos (ARS)</option>
        <option value="USD">Dólares (USD)</option>
      </select>
    </div>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="submitNewCashBox('${kind}')">Guardar</button>
    </div>
  `);
}
async function submitNewCashBox(kind) {
  const name = document.getElementById('f_box_name').value;
  if (!name.trim()) { toast('Ingresá un nombre.', 'error'); return; }
  if (!(await verifyPasswordPrompt(`crear ${kind === 'SOBRE' ? 'el sobre' : 'la caja'} "${name}"`))) return;
  try {
    await api('/cash-boxes', {
      method: 'POST',
      body: JSON.stringify({ name, currency: document.getElementById('f_box_currency').value, kind }),
    });
    closeModal();
    toast(`${kind === 'SOBRE' ? 'Sobre' : 'Caja'} creado.`);
    await refreshCashBoxes();
    renderView();
  } catch (e) { toast(e.message, 'error'); }
}
async function deleteCashBox(id, name) {
  if (!confirm(`¿Eliminar "${name}"? Se borrará también su historial de movimientos.`)) return;
  if (!(await verifyPasswordPrompt(`eliminar "${name}"`))) return;
  try {
    await api(`/cash-boxes/${id}`, { method: 'DELETE' });
    toast('Eliminado correctamente.');
    await refreshCashBoxes();
    renderView();
  } catch (e) { toast(e.message, 'error'); }
}

async function loadCashBoxMovements() {
  const id = document.getElementById('cashFilterSelect').value;
  const resultEl = document.getElementById('cashMovementsResult');
  if (!id) { resultEl.innerHTML = ''; return; }
  const rows = await api(`/cash-boxes/${id}/movements`);
  const boxName = state.cache.cashBoxes.find(b => b.id === Number(id))?.name || 'caja';
  resultEl.innerHTML = `
    <div style="display:flex;justify-content:flex-end;margin-bottom:10px">
      <button class="btn btn-sm" onclick="downloadFile('/cash-boxes/${id}/export', 'movimientos_${boxName}.xlsx')">Exportar esta caja a Excel</button>
    </div>
    ${tableOrEmpty(rows, ['Fecha', 'Unidad', 'Tipo', 'Monto', 'Descripción', 'Origen', ''], (m) => `
    <tr>
      <td class="mono">${fmtDate(m.created_at)}</td>
      <td>${m.business_unit_name || '-'}</td>
      <td>${m.type === 'INCOME' ? 'Ingreso' : 'Egreso'}</td>
      <td class="num ${m.type === 'INCOME' ? 'income' : 'expense'}">$ ${fmtMoney(m.amount)}</td>
      <td>${m.description || '-'}</td>
      <td class="mono">${m.origin_type || '-'} ${m.origin_id ? '#' + m.origin_id : ''}</td>
      <td><button class="btn btn-sm btn-danger" onclick="deleteCashMovement(${m.id})">Eliminar</button></td>
    </tr>`, 'Esta caja no tiene movimientos registrados.')}
  `;
}
async function verifyPasswordPrompt(actionLabel) {
  const password = prompt(`Ingresá tu contraseña para confirmar: ${actionLabel}`);
  if (password === null) return false;
  try {
    await api('/auth/verify-password', { method: 'POST', body: JSON.stringify({ password }) });
    return true;
  } catch (e) {
    toast(e.message, 'error');
    return false;
  }
}
async function deleteCashMovement(id) {
  if (!confirm('¿Eliminar este movimiento de caja?')) return;
  if (!(await verifyPasswordPrompt('eliminar movimiento de caja'))) return;
  try {
    await api(`/cash-movements/${id}`, { method: 'DELETE' });
    toast('Movimiento eliminado.');
    loadCashBoxMovements();
    renderView();
  } catch (e) { toast(e.message, 'error'); }
}

// ---------------------------------------------------------
// USUARIOS (solo admin)
// ---------------------------------------------------------
const PERMISSION_OPTIONS = [
  { key: 'dashboard', label: 'Panel' },
  { key: 'stock', label: 'Stock' },
  { key: 'cash', label: 'Caja' },
  { key: 'purchases', label: 'Compras' },
  { key: 'sales', label: 'Ventas' },
  { key: 'debtors', label: 'Deudores' },
  { key: 'articles', label: 'Artículos' },
  { key: 'warehouses', label: 'Depósitos' },
  { key: 'suppliers', label: 'Proveedores' },
  { key: 'customers', label: 'Clientes' },
  { key: 'projects', label: 'Proyectos' },
];

let usersSubTab = 'list';
let activityLogPage = 1;
let activityLogDateFrom = '';
let activityLogDateTo = '';

async function renderUsers() {
  document.getElementById('viewActions').innerHTML = usersSubTab === 'list'
    ? `<button class="btn btn-primary" onclick="newUserModal()">+ Nuevo usuario</button>`
    : '';
  const el = document.getElementById('view');

  const tabsHtml = `
    <div style="display:flex;gap:8px;margin-bottom:18px">
      <button class="btn btn-sm ${usersSubTab === 'list' ? 'btn-primary' : ''}" onclick="switchUsersTab('list')">Usuarios</button>
      <button class="btn btn-sm ${usersSubTab === 'log' ? 'btn-primary' : ''}" onclick="switchUsersTab('log')">Registro de actividad</button>
      <button class="btn btn-sm ${usersSubTab === 'trash' ? 'btn-primary' : ''}" onclick="switchUsersTab('trash')">Papelera</button>
    </div>`;

  if (usersSubTab === 'trash') {
    const trash = await api('/trash');
    el.innerHTML = tabsHtml + `
      <div class="card">
        <div class="card-title">Elementos eliminados (se borran solos a los 30 días)</div>
        ${tableOrEmpty(trash, ['Tipo', 'Nombre', 'Eliminado', 'Días restantes', ''], (t) => `
          <tr>
            <td class="mono">${t.type_label}</td>
            <td>${t.name}</td>
            <td class="mono">${fmtDate(t.deleted_at)}</td>
            <td class="num ${t.days_remaining <= 5 ? 'expense' : ''}">${t.days_remaining}</td>
            <td>
              <button class="btn btn-sm btn-primary" onclick="restoreTrashItem('${t.type}', ${t.id})">Restaurar</button>
              <button class="btn btn-sm btn-danger" onclick="purgeTrashItem('${t.type}', ${t.id}, '${t.name.replace(/'/g, "\\'")}')">Eliminar definitivo</button>
            </td>
          </tr>`, 'La papelera está vacía.')}
      </div>`;
    return;
  }

  if (usersSubTab === 'log') {
    const params = new URLSearchParams({ page: activityLogPage, limit: 50 });
    if (activityLogDateFrom) params.set('date_from', activityLogDateFrom);
    if (activityLogDateTo) params.set('date_to', activityLogDateTo);
    const { rows: logs, total, limit } = await api(`/activity-log?${params.toString()}`);
    el.innerHTML = tabsHtml + `
      <div class="card">
        <div class="section-toolbar">
          <div class="card-title" style="margin:0">Acciones registradas</div>
          <div style="display:flex;gap:8px;align-items:center">
            <input type="date" id="activityLogDateFrom" value="${activityLogDateFrom}" onchange="activityLogApplyDateFilter()">
            <span class="hint">a</span>
            <input type="date" id="activityLogDateTo" value="${activityLogDateTo}" onchange="activityLogApplyDateFilter()">
            ${(activityLogDateFrom || activityLogDateTo) ? `<button class="btn btn-sm" onclick="activityLogClearDateFilter()">Limpiar</button>` : ''}
          </div>
        </div>
        ${tableOrEmpty(logs, ['Fecha', 'Usuario', 'Acción', 'Ruta', 'Detalle'], (l) => `
          <tr>
            <td class="mono">${fmtDate(l.created_at)}</td>
            <td>${l.username}</td>
            <td class="mono">${l.method}</td>
            <td class="mono">${l.path}</td>
            <td>${l.summary || '-'}</td>
          </tr>`, 'Sin actividad registrada todavía.')}
        ${total ? paginationControlsHtml('activityLog', activityLogPage, total, limit) : ''}
      </div>`;
    return;
  }

  const rows = await api('/users');
  el.innerHTML = tabsHtml + `<div class="card">${tableOrEmpty(rows, ['Usuario', 'Rol', 'Estado', ''], (u) => `
    <tr>
      <td>${u.username}</td>
      <td class="mono">${u.role}</td>
      <td>${u.active ? statusBadge('OPEN') : statusBadge('CLOSED')}</td>
      <td>
        <button class="btn btn-sm" onclick='openEditUserModal(${u.id}, "${u.username}", "${u.role}")'>Editar</button>
        ${u.role !== 'ADMIN' ? `<button class="btn btn-sm" onclick='openPermissionsModal(${u.id}, "${u.username}", ${JSON.stringify(u.permissions)})'>Permisos</button>` : ''}
        <button class="btn btn-sm" onclick="toggleUser(${u.id})">${u.active ? 'Desactivar' : 'Activar'}</button>
        <button class="btn btn-sm btn-danger" onclick="deleteUser(${u.id}, '${u.username}')">Eliminar</button>
      </td>
    </tr>`, 'No hay usuarios cargados.')}</div>`;
}
function switchUsersTab(tab) {
  usersSubTab = tab;
  activityLogPage = 1;
  renderView();
}
function activityLogChangePage(page) {
  activityLogPage = page;
  renderView();
}
function activityLogApplyDateFilter() {
  activityLogDateFrom = document.getElementById('activityLogDateFrom').value;
  activityLogDateTo = document.getElementById('activityLogDateTo').value;
  activityLogPage = 1;
  renderView();
}
function activityLogClearDateFilter() {
  activityLogDateFrom = ''; activityLogDateTo = ''; activityLogPage = 1;
  renderView();
}
async function restoreTrashItem(type, id) {
  try {
    await api(`/trash/${type}/${id}/restore`, { method: 'POST' });
    toast('Elemento restaurado.');
    await loadMasterData();
    if (type === 'business-units') await loadBusinessUnits();
    renderView();
  } catch (e) { toast(e.message, 'error'); }
}
async function purgeTrashItem(type, id, name) {
  if (!confirm(`¿Eliminar "${name}" definitivamente? Ya no se podrá recuperar.`)) return;
  if (!(await verifyPasswordPrompt('eliminar definitivamente de la papelera'))) return;
  try {
    await api(`/trash/${type}/${id}`, { method: 'DELETE' });
    toast('Eliminado definitivamente.');
    renderView();
  } catch (e) { toast(e.message, 'error'); }
}

function openEditUserModal(id, username, role) {
  openModal(`
    <h2>Editar usuario</h2>
    <div class="field"><label>Nombre de usuario</label><input id="f_edit_username" value="${username}"></div>
    <div class="field"><label>Rol</label>
      <select id="f_edit_role">
        <option value="USER" ${role === 'USER' ? 'selected' : ''}>Usuario</option>
        <option value="ADMIN" ${role === 'ADMIN' ? 'selected' : ''}>Administrador</option>
      </select>
    </div>
    <div class="field"><label>Nueva contraseña (dejar vacío para no cambiarla)</label><input id="f_edit_password" type="password" placeholder="••••••••"></div>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="submitEditUser(${id})">Guardar</button>
    </div>
  `);
}
async function submitEditUser(id) {
  const payload = {
    username: document.getElementById('f_edit_username').value,
    role: document.getElementById('f_edit_role').value,
  };
  const newPass = document.getElementById('f_edit_password').value;
  if (newPass) payload.password = newPass;
  try {
    await api(`/users/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
    closeModal();
    toast('Usuario actualizado.');
    renderView();
  } catch (e) { toast(e.message, 'error'); }
}

function openPermissionsModal(userId, username, currentPermissions) {
  openModal(`
    <h2>Permisos — ${username}</h2>
    <div class="hint" style="margin-bottom:14px">Elegí a qué solapas puede acceder este usuario.</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 16px;margin-bottom:16px">
      ${PERMISSION_OPTIONS.map(p => `
        <label style="display:flex;align-items:center;gap:8px;font-size:13.5px">
          <input type="checkbox" class="perm-check" value="${p.key}" ${currentPermissions.includes(p.key) ? 'checked' : ''}>
          ${p.label}
        </label>`).join('')}
    </div>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="submitPermissions(${userId})">Guardar</button>
    </div>
  `);
}
async function submitPermissions(userId) {
  const checked = [...document.querySelectorAll('.perm-check:checked')].map(c => c.value);
  try {
    await api(`/users/${userId}/permissions`, { method: 'PUT', body: JSON.stringify({ permissions: checked }) });
    closeModal();
    toast('Permisos actualizados.');
    renderView();
  } catch (e) { toast(e.message, 'error'); }
}

function newUserModal() {
  openModal(`
    <h2>Nuevo usuario</h2>
    <div class="field"><label>Nombre de usuario</label><input id="f_username"></div>
    <div class="field"><label>Contraseña</label><input id="f_password" type="password"></div>
    <div class="field"><label>Rol</label>
      <select id="f_role">
        <option value="USER">Usuario</option>
        <option value="ADMIN">Administrador</option>
      </select>
    </div>
    <div class="field"><label>Permisos iniciales</label>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 16px">
        ${PERMISSION_OPTIONS.map(p => `
          <label style="display:flex;align-items:center;gap:8px;font-size:13.5px">
            <input type="checkbox" class="new-perm-check" value="${p.key}" checked>
            ${p.label}
          </label>`).join('')}
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="createUser()">Guardar</button>
    </div>
  `);
}
async function createUser() {
  const permissions = [...document.querySelectorAll('.new-perm-check:checked')].map(c => c.value);
  try {
    await api('/users', {
      method: 'POST',
      body: JSON.stringify({
        username: document.getElementById('f_username').value,
        password: document.getElementById('f_password').value,
        role: document.getElementById('f_role').value,
        permissions,
      }),
    });
    closeModal(); toast('Usuario creado.'); renderView();
  } catch (e) { toast(e.message, 'error'); }
}
async function toggleUser(id) {
  try { await api(`/users/${id}/toggle`, { method: 'PUT' }); renderView(); } catch (e) { toast(e.message, 'error'); }
}
async function deleteUser(id, username) {
  if (!confirm(`¿Eliminar el usuario ${username}?`)) return;
  try { await api(`/users/${id}`, { method: 'DELETE' }); toast('Usuario eliminado.'); renderView(); } catch (e) { toast(e.message, 'error'); }
}

// ---------------------------------------------------------
// INIT
// ---------------------------------------------------------
async function boot() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('appShell').style.display = 'flex';
  document.getElementById('currentUserLabel').textContent = `${state.currentUser.username} (${state.currentUser.role === 'ADMIN' ? 'Admin' : 'Usuario'})`;
  document.getElementById('adminNavGroup').style.display = state.currentUser.role === 'ADMIN' ? 'flex' : 'none';
  applyNavPermissions();
  await checkConnection();
  await loadBusinessUnits();
  await loadMasterData();
  renderView();
}

function applyNavPermissions() {
  if (state.currentUser.role === 'ADMIN') return; // admin ve todo
  const allowed = state.currentUser.permissions || [];
  document.querySelectorAll('.nav-item[data-view]').forEach(btn => {
    const view = btn.dataset.view;
    if (view !== 'users' && !allowed.includes(view)) {
      btn.style.display = 'none';
    }
  });
  // Si la vista activa por defecto no está permitida, saltar a la primera permitida
  if (!allowed.includes(state.view)) {
    const firstAllowed = allowed[0] || 'dashboard';
    state.view = firstAllowed;
    document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === firstAllowed));
  }
}

document.getElementById('loginPass')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
document.getElementById('loginUser')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });

(async function init() {
  const token = getToken();
  if (!token) return; // se queda en la pantalla de login
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    state.currentUser = { id: payload.id, username: payload.username, role: payload.role, permissions: [] };
    const me = await api('/auth/me');
    state.currentUser.permissions = me.permissions || [];
    boot();
  } catch (e) {
    clearToken();
  }
})();
