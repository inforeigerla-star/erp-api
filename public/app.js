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
};
function applyBUTheme() {
  const bu = state.businessUnits.find(b => b.id === state.selectedBU);
  const key = Object.keys(BU_THEME).find(k => (bu?.name || '').toLowerCase().includes(k));
  const theme = BU_THEME[key] || { logo: 'assets/logo.jpg', accent: '#2F6F4E' };
  document.getElementById('brandLogo').src = theme.logo;
  document.documentElement.style.setProperty('--bu-accent', theme.accent);
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

function whByBU() { return state.cache.warehouses.filter(w => w.business_unit_id === state.selectedBU); }
function artByBU() { return state.cache.articles.filter(a => a.business_unit_id === state.selectedBU); }
function projByBU() { return state.cache.projects.filter(p => p.business_unit_id === state.selectedBU); }

// ---------------------------------------------------------
// Navegación
// ---------------------------------------------------------
const viewTitles = {
  dashboard: 'Panel', stock: 'Stock', purchases: 'Compras', sales: 'Ventas',
  articles: 'Artículos', warehouses: 'Depósitos', suppliers: 'Proveedores',
  customers: 'Clientes', projects: 'Proyectos', cash: 'Caja', users: 'Usuarios', debtors: 'Deudores',
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
      case 'dashboard': return renderDashboard();
      case 'stock': return renderStock();
      case 'purchases': return renderPurchases();
      case 'sales': return renderSales();
      case 'articles': return renderArticles();
      case 'warehouses': return renderWarehouses();
      case 'suppliers': return renderSuppliers();
      case 'customers': return renderCustomers();
      case 'projects': return renderProjects();
      case 'cash': return renderCash();
      case 'users': return renderUsers();
      case 'debtors': return renderDebtors();
    }
  } catch (e) {
    el.innerHTML = `<div class="empty-state">Error: ${e.message}</div>`;
  }
}

// ---------------------------------------------------------
// DASHBOARD
// ---------------------------------------------------------
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
    <table class="ledger">
      <thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(rowFn).join('')}</tbody>
    </table>`;
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

function articleSelectOptions() {
  return artByBU().map(a => `<option value="${a.article_id}">${a.code} — ${a.description}</option>`).join('');
}
function warehouseSelectOptions() {
  return whByBU().map(w => `<option value="${w.id}">${w.name}</option>`).join('');
}

function openStockTransferModal() {
  openModal(`
    <h2>Transferir stock entre depósitos</h2>
    <div class="field"><label>Artículo</label><select id="f_transfer_article">${articleSelectOptions()}</select></div>
    <div class="field-row">
      <div class="field"><label>Depósito origen</label><select id="f_transfer_from">${warehouseSelectOptions()}</select></div>
      <div class="field"><label>Depósito destino</label><select id="f_transfer_to">${warehouseSelectOptions()}</select></div>
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
        article_id: Number(document.getElementById('f_transfer_article').value),
        from_warehouse_id: Number(document.getElementById('f_transfer_from').value),
        to_warehouse_id: Number(document.getElementById('f_transfer_to').value),
        quantity: Number(document.getElementById('f_transfer_qty').value),
      }),
    });
    closeModal();
    toast('Stock transferido correctamente.');
    renderView();
  } catch (e) { toast(e.message, 'error'); }
}

function openStockAdjustModal() {
  openModal(`
    <h2>Ajustar stock</h2>
    <div class="field"><label>Artículo</label><select id="f_adjust_article">${articleSelectOptions()}</select></div>
    <div class="field-row">
      <div class="field"><label>Depósito</label><select id="f_adjust_warehouse">${warehouseSelectOptions()}</select></div>
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
        article_id: Number(document.getElementById('f_adjust_article').value),
        warehouse_id: Number(document.getElementById('f_adjust_warehouse').value),
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
async function renderArticles() {
  document.getElementById('viewActions').innerHTML = `
    <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--muted);margin-right:8px">
      <input type="checkbox" id="ivaToggle" onchange="renderArticles()"> Mostrar con IVA
    </label>
    <button class="btn btn-sm" onclick="downloadImportTemplate('articles')">Plantilla Excel</button>
    <button class="btn btn-sm" onclick="triggerImport('articles')">Importar Excel</button>
    <button class="btn btn-primary" onclick="newArticleModal()">+ Nuevo artículo</button>`;
  const el = document.getElementById('view');
  const rows = artByBU();
  const withIva = document.getElementById('ivaToggle')?.checked;
  el.innerHTML = `
    <div class="card">
      ${tableOrEmpty(rows, ['Código', 'Cód. alt.', 'Descripción', 'Moneda', 'Costo lista', `Precio ${withIva ? 'c/IVA' : 's/IVA'}`, ''], (a) => `
        <tr>
          <td class="mono">${a.code}</td>
          <td class="mono">${a.alt_code || '-'}</td>
          <td>${a.description}</td>
          <td class="mono">${a.currency}</td>
          <td class="num">${a.currency === 'USD' ? 'US$' : '$'} ${fmtMoney(a.list_cost)}</td>
          <td class="num income">${a.currency === 'USD' ? 'US$' : '$'} ${fmtMoney(withIva ? a.final_price_with_iva : a.final_price)}</td>
          <td><button class="btn btn-sm btn-danger" onclick="deleteArticle(${a.article_id}, '${a.code}')">Eliminar</button></td>
        </tr>`, 'No hay artículos cargados en esta unidad.')}
    </div>
  `;
}

async function deleteArticle(id, code) {
  if (!confirm(`¿Eliminar el artículo ${code}? Esta acción no se puede deshacer.`)) return;
  try {
    await api(`/articles/${id}`, { method: 'DELETE' });
    toast('Artículo eliminado.');
    await loadMasterData(); renderView();
  } catch (e) { toast(e.message, 'error'); }
}

function newArticleModal() {
  openModal(`
    <h2>Nuevo artículo</h2>
    <div class="field-row">
      <div class="field"><label>Código</label><input id="f_code" placeholder="ART001"></div>
      <div class="field"><label>Código alternativo</label><input id="f_altcode" placeholder="Opcional"></div>
    </div>
    <div class="field"><label>Descripción</label><input id="f_desc" placeholder="Nombre del producto"></div>
    <div class="field-row">
      <div class="field"><label>Moneda</label>
        <select id="f_currency" oninput="updatePricePreview()">
          <option value="ARS">Pesos argentinos (ARS)</option>
          <option value="USD">Dólares (USD)</option>
        </select>
      </div>
      <div class="field"><label>Costo de lista</label><input id="f_cost" type="number" step="0.01" placeholder="0.00" oninput="updatePricePreview()"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Margen envío %</label><input id="f_ship" type="number" step="0.01" placeholder="0" oninput="updatePricePreview()"></div>
      <div class="field"><label>Margen TC %</label><input id="f_fx" type="number" step="0.01" placeholder="0" oninput="updatePricePreview()"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Margen ganancia %</label><input id="f_profit" type="number" step="0.01" placeholder="0" oninput="updatePricePreview()"></div>
      <div class="field"><label>IVA %</label><input id="f_iva" type="number" step="0.01" placeholder="21" oninput="updatePricePreview()"></div>
    </div>

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

    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="createArticle()">Guardar</button>
    </div>
  `);
  updatePricePreview();
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
      }),
    });
    closeModal(); toast('Artículo creado.'); await loadMasterData(); renderView();
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
  el.innerHTML = `<div class="card">${tableOrEmpty(rows, ['Nombre', 'Estado', ''], (w) => `
    <tr><td>${w.name}</td><td>${w.active ? statusBadge('OPEN') : statusBadge('CLOSED')}</td>
    <td><button class="btn btn-sm btn-danger" onclick="deleteEntity('warehouses', ${w.id}, '${w.name.replace(/'/g, "\\'")}')">Eliminar</button></td></tr>`,
    'No hay depósitos en esta unidad.')}</div>`;
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
    closeModal(); toast('Depósito creado.'); await loadMasterData(); renderView();
  } catch (e) { toast(e.message, 'error'); }
}

// ---------------------------------------------------------
// PROVEEDORES / CLIENTES
// ---------------------------------------------------------
async function deleteEntity(kind, id, name) {
  if (!confirm(`¿Eliminar "${name}"? Esta acción no se puede deshacer.`)) return;
  try {
    await api(`/${kind}/${id}`, { method: 'DELETE' });
    toast('Eliminado correctamente.');
    await loadMasterData();
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
    <td><button class="btn btn-sm btn-danger" onclick="deleteEntity('suppliers', ${s.id}, '${s.name.replace(/'/g, "\\'")}')">Eliminar</button></td></tr>`,
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
    <td><button class="btn btn-sm btn-danger" onclick="deleteEntity('customers', ${c.id}, '${c.name.replace(/'/g, "\\'")}')">Eliminar</button></td></tr>`,
    'No hay clientes cargados.')}</div>`;
}
function newContactModal(kind) {
  const label = kind === 'supplier' ? 'proveedor' : 'cliente';
  openModal(`
    <h2>Nuevo ${label}</h2>
    <div class="field"><label>Nombre</label><input id="f_name"></div>
    <div class="field"><label>CUIT / Tax ID</label><input id="f_tax"></div>
    <div class="field-row">
      <div class="field"><label>Teléfono</label><input id="f_phone"></div>
      <div class="field"><label>Email</label><input id="f_email"></div>
    </div>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="createContact('${kind}')">Guardar</button>
    </div>
  `);
}
async function createContact(kind) {
  const endpoint = kind === 'supplier' ? '/suppliers' : '/customers';
  try {
    await api(endpoint, {
      method: 'POST',
      body: JSON.stringify({
        name: document.getElementById('f_name').value,
        tax_id: document.getElementById('f_tax').value,
        phone: document.getElementById('f_phone').value,
        email: document.getElementById('f_email').value,
      }),
    });
    closeModal(); toast(`${kind === 'supplier' ? 'Proveedor' : 'Cliente'} creado.`); await loadMasterData(); renderView();
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
      <td><button class="btn btn-sm btn-danger" onclick="deleteEntity('projects', ${p.id}, '${p.name.replace(/'/g, "\\'")}')">Eliminar</button></td>
    </tr>`, 'No hay proyectos en esta unidad.')}</div>`;
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
    closeModal(); toast('Proyecto creado.'); await loadMasterData(); renderView();
  } catch (e) { toast(e.message, 'error'); }
}

// ---------------------------------------------------------
// COMPRAS
// ---------------------------------------------------------
async function renderPurchases() {
  document.getElementById('viewActions').innerHTML = `<button class="btn btn-primary" onclick="newOperationModal('purchase')">+ Nueva compra</button>`;
  const el = document.getElementById('view');
  const all = await api('/purchases');
  const rows = all.filter(p => p.business_unit_id === state.selectedBU);
  el.innerHTML = `<div class="card">${tableOrEmpty(rows, ['#', 'Fecha', 'Estado', 'Pago', 'Total', ''], (p) => `
    <tr>
      <td class="mono">#${p.id}</td>
      <td class="mono">${fmtDate(p.date)}</td>
      <td>${statusBadge(p.status)}</td>
      <td>${p.payment_type === 'CASH' ? 'Contado' : 'Cta. Cte.'}</td>
      <td class="num expense">$ ${fmtMoney(p.total_amount)}</td>
      <td>${opActions('purchases', p)} <button class="btn btn-sm btn-danger" onclick="deleteOperation('purchases', ${p.id})">Eliminar</button></td>
    </tr>`, 'No hay compras registradas en esta unidad.')}</div>`;
}

// ---------------------------------------------------------
// VENTAS
// ---------------------------------------------------------
async function renderSales() {
  document.getElementById('viewActions').innerHTML = `<button class="btn btn-primary" onclick="newOperationModal('sale')">+ Nueva venta</button>`;
  const el = document.getElementById('view');
  const [all, pending] = await Promise.all([api('/sales'), api('/sales/pending-collection')]);
  const rows = all.filter(s => s.business_unit_id === state.selectedBU);
  const pendingBU = pending.filter(s => s.business_unit_id === state.selectedBU && s.collection_status !== 'COBRADO');

  el.innerHTML = `
    ${pendingBU.length ? `
    <div class="card">
      <div class="card-title">Facturas pendientes de procesar (cobradas fuera del sistema)</div>
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
          <td>${s.collection_status !== 'COBRADO' ? `<button class="btn btn-sm btn-primary" onclick="openCollectModal(${s.id}, ${s.remaining_amount})">Procesar cobro</button>` : '-'}</td>
        </tr>`, '')}
    </div>` : ''}

    <div class="card">
      <div class="card-title">Todas las ventas</div>
      ${tableOrEmpty(rows, ['#', 'Cliente', 'CUIT', 'Fecha', 'Estado', 'Pago', 'Total', ''], (s) => `
        <tr>
          <td class="mono">#${s.id}</td>
          <td>${customerName(s.customer_id)}</td>
          <td class="mono">${customerTaxId(s.customer_id)}</td>
          <td class="mono">${fmtDate(s.date)}</td>
          <td>${statusBadge(s.status)}</td>
          <td>${paymentTypeLabel(s.payment_type)}</td>
          <td class="num income">$ ${fmtMoney(s.total_amount)}</td>
          <td>${opActions('sales', s)} <button class="btn btn-sm btn-danger" onclick="deleteOperation('sales', ${s.id})">Eliminar</button></td>
        </tr>`, 'No hay ventas registradas en esta unidad.')}
    </div>
  `;
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
  const boxOptions = state.cache.cashBoxes.map(b => `<option value="${b.id}">${b.name} (${b.currency})</option>`).join('');
  const projOptions = `<option value="">Sin proyecto</option>` + projByBU().map(p => `<option value="${p.id}">${p.name}</option>`).join('');
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
  window._collectBoxOptions = boxOptions;
  window._collectProjOptions = projOptions;
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
    <select id="cbox_${id}">${window._collectBoxOptions}</select>
    <input type="number" step="0.01" placeholder="Monto" id="camount_${id}">
    <select id="cproj_${id}">${window._collectProjOptions}</select>
    <button class="remove-line" onclick="document.getElementById('csplit_${id}').remove()">×</button>
  `;
  container.appendChild(row);
}
async function submitCollect(saleId) {
  const rows = [...document.getElementById('collectSplits').children];
  const splits = rows.map(row => {
    const idx = row.id.replace('csplit_', '');
    return {
      cash_box_id: Number(document.getElementById(`cbox_${idx}`).value),
      amount: Number(document.getElementById(`camount_${idx}`).value),
      project_id: document.getElementById(`cproj_${idx}`).value ? Number(document.getElementById(`cproj_${idx}`).value) : null,
    };
  }).filter(s => s.amount > 0);

  if (!splits.length) { toast('Agregá al menos un monto.', 'error'); return; }
  try {
    await api(`/sales/${saleId}/collect`, { method: 'POST', body: JSON.stringify({ splits }) });
    closeModal();
    toast('Cobro registrado y distribuido entre las cajas.');
    renderView();
  } catch (e) { toast(e.message, 'error'); }
}

function opActions(kind, op) {
  if (op.status !== 'PENDING') return '-';
  return `
    <button class="btn btn-sm" onclick="confirmOperation('${kind}', ${op.id})">Confirmar</button>
    <button class="btn btn-sm btn-danger" onclick="cancelOperation('${kind}', ${op.id})">Cancelar</button>
  `;
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
  if (!confirm(`¿Eliminar ${label} #${id}? Esta acción no se puede deshacer y borra su historial asociado.`)) return;
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
          <td>${s.collection_status !== 'COBRADO' ? `<button class="btn btn-sm btn-primary" onclick="openCollectModal(${s.id}, ${s.remaining_amount})">Procesar cobro</button>` : '-'}</td>
        </tr>`, 'No hay facturas pendientes de cobro en esta unidad.')}
    </div>
  `;
}
function customerName(id) {
  return state.cache.customers.find(c => c.id === id)?.name || `Cliente #${id}`;
}

let lineItemCount = 0;
function newOperationModal(kind) {
  const isPurchase = kind === 'purchase';
  const contactOptions = (isPurchase ? state.cache.suppliers : state.cache.customers)
    .map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  const whOptions = whByBU().map(w => `<option value="${w.id}">${w.name}</option>`).join('');
  const projOptions = `<option value="">Sin proyecto</option>` + projByBU().map(p => `<option value="${p.id}">${p.name}</option>`).join('');

  lineItemCount = 0;
  openModal(`
    <h2>${isPurchase ? 'Nueva compra' : 'Nueva venta'}</h2>
    <div class="field"><label>${isPurchase ? 'Proveedor' : 'Cliente'}</label>
      <select id="f_contact">${contactOptions || '<option value="">— cargá uno primero —</option>'}</select>
    </div>
    <div class="field-row">
      <div class="field"><label>Depósito</label><select id="f_warehouse">${whOptions || '<option value="">— cargá uno primero —</option>'}</select></div>
      <div class="field"><label>Proyecto (opcional)</label><select id="f_project">${projOptions}</select></div>
    </div>
    <div class="field"><label>Forma de pago</label>
      <select id="f_payment" onchange="togglePaymentBoxField()">
        <option value="CASH">Contado</option>
        <option value="ACCOUNT">Cuenta corriente</option>
        ${!isPurchase ? '<option value="UNCOLLECTED">Factura sin cobrar (procesar después)</option>' : ''}
      </select>
    </div>
    <div class="field" id="paymentBoxField">
      <label>Caja o sobre de destino</label>
      <select id="f_cashbox">${state.cache.cashBoxes.map(b => `<option value="${b.id}">${b.name} (${b.kind === 'SOBRE' ? 'Sobre' : 'Caja'} · ${b.currency})</option>`).join('')}</select>
    </div>

    <div class="field"><label>Artículos</label>
      <div class="line-items" id="lineItems"></div>
      <button class="btn btn-sm" onclick="addLineItem('${kind}')">+ Agregar artículo</button>
    </div>

    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="createOperation('${kind}')">Guardar</button>
    </div>
  `);
  addLineItem(kind);
}

function togglePaymentBoxField() {
  const val = document.getElementById('f_payment').value;
  document.getElementById('paymentBoxField').style.display = val === 'CASH' ? 'block' : 'none';
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
    <input type="number" step="0.001" placeholder="Cant." id="qty_${id}" value="1">
    <input type="number" step="0.01" placeholder="${isPurchase ? 'Costo' : 'Precio'}" id="price_${id}">
    <button class="remove-line" onclick="document.getElementById('line_${id}').remove()">×</button>
  `;
  container.appendChild(row);

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
  document.getElementById(`price_${id}`).value = Number(isPurchase ? article.list_cost : article.final_price).toFixed(2);
  document.getElementById(`artresults_${id}`).style.display = 'none';
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
    warehouse_id: Number(document.getElementById('f_warehouse').value),
    project_id: document.getElementById('f_project').value ? Number(document.getElementById('f_project').value) : null,
    payment_type: document.getElementById('f_payment').value,
    cash_box_id: document.getElementById('f_payment').value === 'CASH' ? Number(document.getElementById('f_cashbox').value) : null,
    items,
  };
  payload[isPurchase ? 'supplier_id' : 'customer_id'] = Number(document.getElementById('f_contact').value);

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
async function renderCash() {
  document.getElementById('viewActions').innerHTML = `
    <button class="btn btn-sm" onclick="newCashBoxModal('CAJA')">+ Nueva caja</button>
    <button class="btn btn-sm" onclick="newCashBoxModal('SOBRE')">+ Nuevo sobre</button>`;
  const el = document.getElementById('view');
  const dashboard = await api('/cash-boxes/dashboard');
  const cajas = dashboard.filter(b => b.kind === 'CAJA');
  const sobres = dashboard.filter(b => b.kind === 'SOBRE');

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

    <div class="card">
      <div class="card-title">Registrar movimiento manual</div>
      <div class="field-row">
        <div class="field"><label>Caja o sobre</label>
          <select id="f_mov_box">${state.cache.cashBoxes.map(b => `<option value="${b.id}">${b.name} (${b.kind === 'SOBRE' ? 'Sobre' : 'Caja'})</option>`).join('')}</select>
        </div>
        <div class="field"><label>Tipo</label><select id="f_mov_type"><option value="INCOME">Ingreso</option><option value="EXPENSE">Egreso</option></select></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Monto</label><input id="f_mov_amount" type="number" step="0.01"></div>
        <div class="field"><label>Proyecto (opcional)</label><select id="f_mov_project"><option value="">Sin proyecto</option>${projByBU().map(p => `<option value="${p.id}">${p.name}</option>`).join('')}</select></div>
      </div>
      <div class="field"><label>Descripción</label><input id="f_mov_desc" placeholder="Ej: Pago de servicios"></div>
      <button class="btn btn-primary" onclick="createCashMovement()">Registrar movimiento</button>
    </div>
  `;
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
    headers: ['code', 'alt_code', 'description', 'list_cost', 'currency', 'shipping_margin_pct', 'fx_margin_pct', 'profit_margin_pct', 'iva_pct'],
    sample: ['ART001', 'OEM-123', 'Amortiguador delantero', 15000, 'ARS', 5, 0, 30, 21],
    endpoint: '/articles',
    buildPayload: (row) => ({
      business_unit_id: state.selectedBU,
      code: row.code,
      alt_code: row.alt_code || '',
      description: row.description,
      list_cost: Number(row.list_cost) || 0,
      currency: (row.currency || 'ARS').toUpperCase(),
      shipping_margin_pct: Number(row.shipping_margin_pct) || 0,
      fx_margin_pct: Number(row.fx_margin_pct) || 0,
      profit_margin_pct: Number(row.profit_margin_pct) || 0,
      iva_pct: row.iva_pct != null ? Number(row.iva_pct) : 21,
    }),
  },
  warehouses: {
    label: 'Depósitos',
    headers: ['name'],
    sample: ['Depósito Central'],
    endpoint: '/warehouses',
    buildPayload: (row) => ({ business_unit_id: state.selectedBU, name: row.name }),
  },
  suppliers: {
    label: 'Proveedores',
    headers: ['name', 'tax_id', 'phone', 'email', 'address'],
    sample: ['Proveedor SA', '30-12345678-9', '11-5555-5555', 'contacto@proveedor.com', 'Calle Falsa 123'],
    endpoint: '/suppliers',
    buildPayload: (row) => ({ name: row.name, tax_id: row.tax_id || '', phone: row.phone || '', email: row.email || '', address: row.address || '' }),
  },
  customers: {
    label: 'Clientes',
    headers: ['name', 'tax_id', 'phone', 'email', 'address'],
    sample: ['Cliente SRL', '30-98765432-1', '11-4444-4444', 'contacto@cliente.com', 'Av. Siempreviva 742'],
    endpoint: '/customers',
    buildPayload: (row) => ({ name: row.name, tax_id: row.tax_id || '', phone: row.phone || '', email: row.email || '', address: row.address || '' }),
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

    let ok = 0, failed = 0;
    const errors = [];
    for (const row of rows) {
      const normalized = {};
      Object.keys(row).forEach(k => { normalized[k.trim().toLowerCase()] = row[k]; });
      try {
        await api(tpl.endpoint, { method: 'POST', body: JSON.stringify(tpl.buildPayload(normalized)) });
        ok++;
      } catch (e) {
        failed++;
        errors.push(`${normalized.name || normalized.code || '(fila sin nombre)'}: ${e.message}`);
      }
    }
    await loadMasterData();
    renderView();
    if (failed === 0) {
      toast(`Importación completa: ${ok} registros creados.`);
    } else {
      toast(`Importado: ${ok} — Con errores: ${failed}. Revisá nombres/códigos duplicados.`, 'error');
      console.warn('Errores de importación:', errors);
    }
  } catch (e) {
    toast('No se pudo leer el archivo. Verificá que sea un Excel válido.', 'error');
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
    await loadMasterData();
    renderView();
  } catch (e) { toast(e.message, 'error'); }
}
async function deleteCashBox(id, name) {
  if (!confirm(`¿Eliminar "${name}"? Se borrará también su historial de movimientos.`)) return;
  if (!(await verifyPasswordPrompt(`eliminar "${name}"`))) return;
  try {
    await api(`/cash-boxes/${id}`, { method: 'DELETE' });
    toast('Eliminado correctamente.');
    await loadMasterData();
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

async function createCashMovement() {
  try {
    await api('/cash-movements', {
      method: 'POST',
      body: JSON.stringify({
        cash_box_id: Number(document.getElementById('f_mov_box').value),
        business_unit_id: state.selectedBU,
        project_id: document.getElementById('f_mov_project').value ? Number(document.getElementById('f_mov_project').value) : null,
        type: document.getElementById('f_mov_type').value,
        amount: Number(document.getElementById('f_mov_amount').value),
        description: document.getElementById('f_mov_desc').value,
      }),
    });
    toast('Movimiento registrado.');
    renderView();
  } catch (e) { toast(e.message, 'error'); }
}

// ---------------------------------------------------------
// USUARIOS (solo admin)
// ---------------------------------------------------------
async function renderUsers() {
  document.getElementById('viewActions').innerHTML = `<button class="btn btn-primary" onclick="newUserModal()">+ Nuevo usuario</button>`;
  const el = document.getElementById('view');
  const rows = await api('/users');
  el.innerHTML = `<div class="card">${tableOrEmpty(rows, ['Usuario', 'Rol', 'Estado', ''], (u) => `
    <tr>
      <td>${u.username}</td>
      <td class="mono">${u.role}</td>
      <td>${u.active ? statusBadge('OPEN') : statusBadge('CLOSED')}</td>
      <td>
        <button class="btn btn-sm" onclick="toggleUser(${u.id})">${u.active ? 'Desactivar' : 'Activar'}</button>
        <button class="btn btn-sm btn-danger" onclick="deleteUser(${u.id}, '${u.username}')">Eliminar</button>
      </td>
    </tr>`, 'No hay usuarios cargados.')}</div>`;
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
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="createUser()">Guardar</button>
    </div>
  `);
}
async function createUser() {
  try {
    await api('/users', {
      method: 'POST',
      body: JSON.stringify({
        username: document.getElementById('f_username').value,
        password: document.getElementById('f_password').value,
        role: document.getElementById('f_role').value,
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
  await checkConnection();
  await loadBusinessUnits();
  await loadMasterData();
  renderView();
}

document.getElementById('loginPass')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
document.getElementById('loginUser')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });

(function init() {
  const token = getToken();
  if (!token) return; // se queda en la pantalla de login
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    state.currentUser = { id: payload.id, username: payload.username, role: payload.role };
    boot();
  } catch (e) {
    clearToken();
  }
})();
