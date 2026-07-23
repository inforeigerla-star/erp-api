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

const fmtMoney = (n) => {
  const num = Math.round(Number(n) || 0);
  const sign = num < 0 ? '-' : '';
  return sign + Math.abs(num).toLocaleString('en-US').replace(/,/g, '.');
};
function fmtQty(n) {
  const num = Number(n) || 0;
  const sign = num < 0 ? '-' : '';
  const abs = Math.round(Math.abs(num) * 1000) / 1000;
  const [intPart, decPart] = String(abs).split('.');
  const intFormatted = Number(intPart).toLocaleString('en-US').replace(/,/g, '.');
  return sign + intFormatted + (decPart ? ',' + decPart : '');
}

// ---------- Campos de dinero editables con formato de miles (punto) ----------
function parseMoneyInput(str) {
  if (str == null || str === '') return 0;
  const clean = String(str).replace(/\./g, '').replace(',', '.').replace(/[^0-9.\-]/g, '');
  const num = Number(clean);
  return isNaN(num) ? 0 : num;
}
function formatMoneyFieldValue(num) {
  if (num === '' || num == null || isNaN(num)) return '';
  const parts = Number(num).toFixed(2).split('.');
  const intFormatted = Math.abs(Number(parts[0])).toLocaleString('en-US').replace(/,/g, '.');
  const sign = Number(num) < 0 ? '-' : '';
  return sign + intFormatted + ',' + parts[1];
}
function formatMoneyField(el) {
  const num = parseMoneyInput(el.value);
  el.value = el.value === '' ? '' : formatMoneyFieldValue(num);
}
function unformatMoneyField(el) {
  const num = parseMoneyInput(el.value);
  el.value = el.value === '' ? '' : (num === 0 && !el.value.trim() ? '' : String(num));
}
// `withTime=false` (etapa de mejora visual): fecha corta sin hora, para
// listados donde la hora no aporta nada al escanear la tabla. Por defecto
// sigue devolviendo fecha+hora como siempre, así ningún uso existente cambia.
function fmtDate(value, { withTime = true } = {}) {
  if (!value) return '-';
  let str = value instanceof Date ? value.toISOString() : String(value);
  if (!/Z$|[+-]\d\d:?\d\d$/.test(str)) str += 'Z'; // forzar UTC si no trae zona horaria
  const d = new Date(str);
  if (isNaN(d.getTime())) return '-';
  return d.toLocaleString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: '2-digit', month: '2-digit', year: withTime ? 'numeric' : '2-digit',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
}
function fmtDateShort(value) { return fmtDate(value, { withTime: false }); }
// (Roadmap Etapa 6) Días transcurridos desde una fecha — para resaltar en las
// bandejas de "pendiente de verificar" lo que lleva varios días sin
// confirmarse (antes no había ninguna señal de antigüedad).
function daysSince(value) {
  if (!value) return 0;
  const d = new Date(value);
  if (isNaN(d.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
}

// (Roadmap Etapa 7, hallazgo #33) Set chico de íconos SVG inline, sin
// dependencias externas, para reemplazar los emojis usados como iconografía
// funcional (se ven distinto según sistema operativo/navegador). El "⋮" del
// menú de acciones por fila no se toca: ya es un patrón consistente propio.
const SVG_ICONS = {
  warning: '<svg class="icon" viewBox="0 0 20 20" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M10 3.2 2 17h16L10 3.2Z" stroke-linejoin="round"/><path d="M10 8.2v3.6" stroke-linecap="round"/><circle cx="10" cy="14.3" r="0.9" fill="currentColor" stroke="none"/></svg>',
  print: '<svg class="icon" viewBox="0 0 20 20" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M5.5 7V3.3h9V7" stroke-linejoin="round"/><rect x="3" y="7" width="14" height="6.5" rx="1"/><path d="M5.5 12.5h9v4.2h-9z" stroke-linejoin="round"/></svg>',
  whatsapp: '<svg class="icon" viewBox="0 0 20 20" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M10 3.2a6.8 6.8 0 0 0-5.8 10.3L3 17l3.6-1.1A6.8 6.8 0 1 0 10 3.2Z" stroke-linejoin="round"/><path d="M7 8.6c0 2.7 1.7 4.4 4.3 4.4" stroke-linecap="round"/></svg>',
  mail: '<svg class="icon" viewBox="0 0 20 20" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="5" width="14" height="10" rx="1.5"/><path d="M4 6.3 10 11l6-4.7" stroke-linejoin="round"/></svg>',
  note: '<svg class="icon" viewBox="0 0 20 20" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M5.5 3h6l3 3v11h-9V3Z" stroke-linejoin="round"/><path d="M11.5 3v3h3" stroke-linejoin="round"/><path d="M7.5 10h5M7.5 13h5" stroke-linecap="round"/></svg>',
  dollar: '<svg class="icon" viewBox="0 0 20 20" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M10 2.3v15.4M13.3 5.6c0-1.4-1.5-2.3-3.3-2.3s-3.3 1-3.3 2.4c0 1.4 1.5 2 3.3 2.3 1.8.3 3.3 1 3.3 2.4 0 1.4-1.5 2.4-3.3 2.4s-3.3-.9-3.3-2.3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  cash: '<svg class="icon" viewBox="0 0 20 20" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2.5" y="5.5" width="15" height="9" rx="1.5"/><circle cx="10" cy="10" r="2"/></svg>',
  chart: '<svg class="icon" viewBox="0 0 20 20" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 16 7.5 10l3 3L17 5.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  wrench: '<svg class="icon" viewBox="0 0 20 20" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M13.8 3.3a3.3 3.3 0 0 0-4.4 4l-6 6 2 2 6-6a3.3 3.3 0 0 0 4-4.4l-2.2 2.2-1.6-1.6 2.2-2.2Z" stroke-linejoin="round"/></svg>',
  duplicate: '<svg class="icon" viewBox="0 0 20 20" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="3" y="3" width="9.5" height="9.5" rx="1.3"/><path d="M7 15.5h7a1.5 1.5 0 0 0 1.5-1.5V7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};
function svgIcon(name) { return SVG_ICONS[name] || ''; }

// ---------------------------------------------------------
// Auth
// ---------------------------------------------------------
function getToken() { return sessionStorage.getItem('erp_token'); }
function setToken(t) { sessionStorage.setItem('erp_token', t); }
function clearToken() { sessionStorage.removeItem('erp_token'); }

// (Roadmap Etapa 8, hallazgo #34) aviso antes de que expire la sesión (hoy
// 12hs, ver PROJECT_CONTEXT.md sección 9), para que si alguien está cargando
// algo largo tenga tiempo de terminar o guardar. Mismo patrón de decodificar
// el JWT que ya usaba init() más abajo, solo que leyendo "exp" en vez de los
// datos del usuario.
let _sessionExpiryWarnTimer = null;
function getTokenExpiryMs() {
  try {
    const token = getToken();
    if (!token) return null;
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.exp ? payload.exp * 1000 : null;
  } catch (e) { return null; }
}
function scheduleSessionExpiryWarning() {
  clearTimeout(_sessionExpiryWarnTimer);
  const expiryMs = getTokenExpiryMs();
  if (!expiryMs) return;
  const warnInMs = expiryMs - Date.now() - 5 * 60 * 1000; // 5 minutos antes
  if (warnInMs <= 0) return; // ya está por vencer o venció, no tiene sentido avisar
  _sessionExpiryWarnTimer = setTimeout(() => {
    toast('Tu sesión va a expirar en 5 minutos. Si estás cargando algo largo, terminá o guardá pronto (las ventas/compras nuevas guardan un borrador automático, pero conviene no depender de eso).', 'error');
  }, warnInMs);
}

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
  let shown = false;
  const delayTimer = setTimeout(() => { shown = true; showWorking(); }, 400);
  try {
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
  } finally {
    clearTimeout(delayTimer);
    if (shown) hideWorking();
  }
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

let _workingDepth = 0;
function showWorking(text) {
  _workingDepth++;
  const el = document.getElementById('workingIndicator');
  document.getElementById('workingIndicatorText').textContent = text || 'Trabajando…';
  el.style.display = 'flex';
}
function hideWorking() {
  _workingDepth = Math.max(0, _workingDepth - 1);
  if (_workingDepth === 0) {
    document.getElementById('workingIndicator').style.display = 'none';
  }
}

// ---------------------------------------------------------
// Modal helper
// ---------------------------------------------------------
function openModal(innerHtml) {
  const backdrop = document.getElementById('modalBackdrop');
  const modal = document.getElementById('modal');
  modal.innerHTML = innerHtml;
  backdrop.classList.add('show');
  backdrop.onclick = null;
}
function closeModal() {
  document.getElementById('modalBackdrop').classList.remove('show');
  // (Roadmap Etapa 8, hallazgo #34) apaga el autoguardado de borrador de
  // Ventas/Compras al cerrar cualquier modal — sin esto, el listener de
  // "input"/"change" quedaba pegado a #modal y podía disparar guardados con
  // datos de OTRO modal abierto después (ej. Ajustar stock).
  const modal = document.getElementById('modal');
  if (modal) { modal.oninput = null; modal.onchange = null; }
  _draftAutosaveKind = null;
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.getElementById('modalBackdrop').classList.contains('show')) {
    closeModal();
  }
});

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
  sel.onchange = () => selectBusinessUnit(Number(sel.value));
  applyBUTheme();
}
function selectBusinessUnit(id, skipRender) {
  state.selectedBU = id;
  const sel = document.getElementById('buSelect');
  if (sel) sel.value = id;
  applyBUTheme();
  if (!skipRender) renderView();
}
function cycleBusinessUnit(direction) {
  if (!state.businessUnits.length) return;
  const idx = state.businessUnits.findIndex(b => b.id === state.selectedBU);
  const nextIdx = ((idx === -1 ? 0 : idx) + direction + state.businessUnits.length) % state.businessUnits.length;
  selectBusinessUnit(state.businessUnits[nextIdx].id);
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
    renderView();
  } catch (e) { toast(e.message, 'error'); }
}
// Eliminar una unidad de negocio es una acción destructiva e infrecuente:
// se sacó del selector lateral (donde quedaba pegada a un control de uso diario
// y se prestaba a error) y ahora vive en Administración > Unidades de negocio.
// Se le suma la confirmación reforzada (mismo patrón que la purga de papelera:
// overlay de advertencia + escribir el nombre exacto + verificar contraseña).
async function deleteBusinessUnitRow(id, name) {
  const ok = await confirmDangerous(
    'Eliminar unidad de negocio',
    `¿Eliminar la unidad de negocio <strong>"${name}"</strong>?<br>Se perderán sus proyectos, artículos y depósitos asociados. Esta acción no se puede deshacer.`,
    'Sí, eliminar'
  );
  if (!ok) return;
  const typed = prompt(`Para confirmar, escribí exactamente el nombre de la unidad: "${name}"`);
  if (typed !== name) { toast('El nombre no coincide. No se eliminó nada.', 'error'); return; }
  if (!(await verifyPasswordPrompt('eliminar una unidad de negocio'))) return;
  try {
    await api(`/business-units/${id}`, { method: 'DELETE' });
    toast('Unidad de negocio eliminada.');
    await loadBusinessUnits();
    await loadMasterData();
    renderView();
  } catch (e) { toast(e.message, 'error'); }
}
async function renderBusinessUnits() {
  document.getElementById('viewActions').innerHTML = `<button class="btn btn-primary" onclick="newBusinessUnitModal()">+ Nueva unidad</button>`;
  const el = document.getElementById('view');
  el.innerHTML = `
    <div class="card">
      <div class="card-title">Unidades de negocio</div>
      <div class="hint" style="margin-bottom:12px">Cada unidad tiene sus propios proyectos, artículos, stock y depósitos. Clientes, proveedores y cajas son compartidos entre todas. Eliminar una unidad es permanente.</div>
      ${tableOrEmpty(state.businessUnits, ['Nombre', ''], (bu) => `
        <tr>
          <td>${bu.name}</td>
          <td style="text-align:right"><button class="btn btn-sm btn-danger" onclick="deleteBusinessUnitRow(${bu.id}, '${bu.name.replace(/'/g, "\\'")}')">Eliminar</button></td>
        </tr>`, 'No hay unidades de negocio cargadas.')}
    </div>`;
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
  dashboard: 'Panel', stock: 'Stock', purchases: 'Compras', sales: 'Ventas', quotes: 'Presupuestos', shipments: 'Remitos de envío',
  articles: 'Artículos', warehouses: 'Depósitos', suppliers: 'Proveedores',
  customers: 'Clientes', projects: 'Proyectos', cash: 'Finanzas', users: 'Usuarios', 'business-units': 'Unidades de negocio', trash: 'Papelera', debtors: 'Deudores', payables: 'A pagar', reports: 'Reportes',
};

document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => goToView(btn.dataset.view));
});

// Navega a una vista programáticamente (misma lógica que el click de la nav
// lateral). `afterRender` es opcional: se ejecuta una vez que la vista ya
// terminó de renderizarse (para abrir un modal de detalle encima, etc).
// Usado por el buscador global para "ir directo al resultado".
function goToView(viewName, afterRender) {
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === viewName));
  state.view = viewName;
  const p = renderView();
  if (afterRender) p.then(afterRender);
}

// ---------------------------------------------------------
// Buscador global (topbar): venta/compra por N°, cliente/proveedor por
// nombre o CUIT, artículo por código/descripción. "Ir directo al resultado"
// reutiliza los modales/vistas que ya existen (no se crea ningún detalle
// nuevo) — para Compras, que no tiene modal de Detalle (ver Bloque 4), se
// navega a la lista y se muestra un resumen en un toast.
// ---------------------------------------------------------
let globalSearchTimer = null;
window._globalSearchData = null;

function globalSearchDebounced() {
  clearTimeout(globalSearchTimer);
  const q = document.getElementById('globalSearchInput').value.trim();
  const resultsEl = document.getElementById('globalSearchResults');
  if (q.length < 2) {
    resultsEl.style.display = 'none';
    resultsEl.innerHTML = '';
    window._globalSearchData = null;
    return;
  }
  globalSearchTimer = setTimeout(() => runGlobalSearch(q), 300);
}

const GLOBAL_SEARCH_SECTIONS = [
  ['sales', 'Ventas', (s) => `<span class="global-search-title">Venta #${s.id}</span><span class="global-search-sub">${s.customer_name || 'Sin cliente'} · $ ${fmtMoney(s.total_amount)} · ${s.business_unit_name}</span>`],
  ['purchases', 'Compras', (p) => `<span class="global-search-title">Compra #${p.id}</span><span class="global-search-sub">${p.supplier_name || 'Sin proveedor'} · $ ${fmtMoney(p.total_amount)} · ${p.business_unit_name}</span>`],
  ['customers', 'Clientes', (c) => `<span class="global-search-title">${c.name}</span><span class="global-search-sub">${c.tax_id || 'Sin CUIT'}</span>`],
  ['suppliers', 'Proveedores', (s) => `<span class="global-search-title">${s.name}</span><span class="global-search-sub">${s.tax_id || 'Sin CUIT'}</span>`],
  ['articles', 'Artículos', (a) => `<span class="global-search-title">${a.code}${a.alt_code ? ' · ' + a.alt_code : ''}</span><span class="global-search-sub">${a.description} · ${a.business_unit_name}</span>`],
  // (Roadmap Etapa 3) Antes el buscador global no cubría estas 4 entidades.
  ['quotes', 'Presupuestos', (q) => `<span class="global-search-title">Presupuesto #${q.id}</span><span class="global-search-sub">${q.customer_name || 'Sin cliente'} · ${q.currency === 'USD' ? 'US$' : '$'} ${fmtMoney(q.total_amount)} · ${q.business_unit_name}</span>`],
  ['shipments', 'Remitos de envío', (s) => `<span class="global-search-title">Remito #${s.id}</span><span class="global-search-sub">${s.customer_name || 'Sin cliente'} · ${s.business_unit_name}</span>`],
  ['projects', 'Proyectos', (p) => `<span class="global-search-title">${p.name}</span><span class="global-search-sub">${p.business_unit_name}</span>`],
  ['warehouses', 'Depósitos', (w) => `<span class="global-search-title">${w.name}</span><span class="global-search-sub">${w.business_unit_name}</span>`],
];

// El dropdown vive fuera del topbar (que tiene overflow:hidden para recortar
// el watermark), así que se posiciona "a mano" en cada apertura, tomando como
// referencia dónde está el input de búsqueda en ese momento.
function positionGlobalSearchResults() {
  const input = document.getElementById('globalSearchInput');
  const resultsEl = document.getElementById('globalSearchResults');
  if (!input || !resultsEl) return;
  const rect = input.getBoundingClientRect();
  resultsEl.style.top = `${rect.bottom + 4}px`;
  resultsEl.style.left = `${rect.left}px`;
  resultsEl.style.width = `${rect.width}px`;
}

async function runGlobalSearch(q) {
  const resultsEl = document.getElementById('globalSearchResults');
  positionGlobalSearchResults();
  const data = await api(`/search/global?q=${encodeURIComponent(q)}`).catch(() => null);
  if (!data) {
    resultsEl.innerHTML = `<div class="global-search-empty">Error al buscar.</div>`;
    resultsEl.style.display = 'block';
    return;
  }
  window._globalSearchData = data;

  const sections = GLOBAL_SEARCH_SECTIONS.filter(([kind]) => data[kind]?.length);
  if (!sections.length) {
    resultsEl.innerHTML = `<div class="global-search-empty">Sin resultados</div>`;
  } else {
    resultsEl.innerHTML = sections.map(([kind, label, fmt]) => `
      <div class="global-search-group-label">${label}</div>
      ${data[kind].map((it, idx) => `<div class="global-search-item" onclick="selectGlobalSearchResult('${kind}', ${idx})">${fmt(it)}</div>`).join('')}
    `).join('');
  }
  resultsEl.style.display = 'block';
}

function selectGlobalSearchResult(kind, idx) {
  const data = window._globalSearchData;
  if (!data) return;
  const item = data[kind][idx];
  if (!item) return;
  closeGlobalSearch();

  const switchBUIfNeeded = () => {
    if (item.business_unit_id != null && item.business_unit_id !== state.selectedBU) {
      selectBusinessUnit(item.business_unit_id, true);
    }
  };

  if (kind === 'customers') {
    goToView('customers', () => openEditContactModal('customer', item.id));
  } else if (kind === 'suppliers') {
    goToView('suppliers', () => openEditContactModal('supplier', item.id));
  } else if (kind === 'articles') {
    switchBUIfNeeded();
    goToView('articles', () => openEditArticleModal(item.id));
  } else if (kind === 'sales') {
    switchBUIfNeeded();
    goToView('sales', () => showSaleDetail(item.id));
  } else if (kind === 'purchases') {
    switchBUIfNeeded();
    // (Roadmap Etapa 3) Antes solo mostraba un cartel con el resumen, porque
    // Compras no tenía modal de Detalle. Ahora abre igual que Ventas.
    goToView('purchases', () => showPurchaseDetail(item.id));
  } else if (kind === 'quotes') {
    switchBUIfNeeded();
    goToView('quotes', () => showQuoteDetail(item.id));
  } else if (kind === 'shipments') {
    switchBUIfNeeded();
    goToView('shipments', () => showShipmentDetail(item.id));
  } else if (kind === 'projects') {
    switchBUIfNeeded();
    goToView('projects', () => openEditProjectModal(item.id, item.name));
  } else if (kind === 'warehouses') {
    switchBUIfNeeded();
    goToView('warehouses', () => openEditWarehouseModal(item.id, item.name));
  }
}

function closeGlobalSearch() {
  const resultsEl = document.getElementById('globalSearchResults');
  if (resultsEl) { resultsEl.style.display = 'none'; resultsEl.innerHTML = ''; }
  const input = document.getElementById('globalSearchInput');
  if (input) input.value = '';
  window._globalSearchData = null;
}

function globalSearchKeydown(e) {
  if (e.key === 'Escape') { closeGlobalSearch(); e.target.blur(); return; }
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Enter') return;
  const resultsEl = document.getElementById('globalSearchResults');
  if (!resultsEl || resultsEl.style.display === 'none') return;
  const items = [...resultsEl.querySelectorAll('.global-search-item')];
  if (!items.length) return;
  let activeIndex = items.findIndex(it => it.classList.contains('active'));
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    activeIndex = (activeIndex + 1) % items.length;
    items.forEach((it, i) => it.classList.toggle('active', i === activeIndex));
    items[activeIndex].scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    activeIndex = activeIndex <= 0 ? items.length - 1 : activeIndex - 1;
    items.forEach((it, i) => it.classList.toggle('active', i === activeIndex));
    items[activeIndex].scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const target = activeIndex >= 0 ? items[activeIndex] : items[0];
    target.click();
  }
}

async function renderView() {
  document.getElementById('viewTitle').textContent = viewTitles[state.view];
  document.getElementById('viewActions').innerHTML = '';
  const el = document.getElementById('view');
  el.innerHTML = '<div class="empty-state">Cargando…</div>';
  try {
    switch (state.view) {
      case 'dashboard': await renderDashboard(); break;
      case 'reports': await renderReports(); break;
      case 'stock': await renderStock(); break;
      case 'purchases': await renderPurchases(); break;
      case 'sales': await renderSales(); break;
      case 'quotes': await renderQuotes(); break;
      case 'shipments': await renderShipments(); break;
      case 'articles': await renderArticles(); break;
      case 'warehouses': await renderWarehouses(); break;
      case 'suppliers': await renderSuppliers(); break;
      case 'customers': await renderCustomers(); break;
      case 'projects': await renderProjects(); break;
      case 'cash': await renderFinance(); break;
      case 'users': await renderUsers(); break;
      case 'business-units': await renderBusinessUnits(); break;
      case 'trash': await renderTrash(); break;
      case 'debtors': await renderDebtors(); break;
      case 'payables': await renderPayables(); break;
    }
  } catch (e) {
    el.innerHTML = `<div class="empty-state">Error: ${e.message}<br><button class="btn btn-sm" style="margin-top:10px" onclick="renderView()">Reintentar</button></div>`;
  }
}

// ---------------------------------------------------------
// Atajos de teclado globales
// ---------------------------------------------------------
// Buscador propio por vista (se usa con "/"). Al sumar buscador a más listas
// (Bloque 5 de la optimización UX), alcanza con agregar la entrada acá.
const VIEW_SEARCH_INPUT = { articles: 'articlesSearchInput' };
function isTypingTarget(target) {
  const tag = (target?.tagName || '').toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable;
}
document.addEventListener('keydown', (e) => {
  if (isTypingTarget(e.target)) return; // no interferir con la carga normal de datos
  if (document.getElementById('modalBackdrop').classList.contains('show')) return; // con un modal abierto, no

  if (e.key === '/') {
    const inputId = VIEW_SEARCH_INPUT[state.view];
    const input = inputId && document.getElementById(inputId);
    if (input) { e.preventDefault(); input.focus(); }
    return;
  }
  if ((e.key === 'n' || e.key === 'N') && !e.ctrlKey && !e.metaKey && !e.altKey) {
    if (state.view === 'sales' && salesSubTab === 'sales') { e.preventDefault(); newOperationModal('sale'); }
    else if (state.view === 'purchases' && purchasesSubTab === 'purchases') { e.preventDefault(); newOperationModal('purchase'); }
    return;
  }
  if (e.key === '[' || e.key === ']') {
    e.preventDefault();
    cycleBusinessUnit(e.key === ']' ? 1 : -1);
    return;
  }
});

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
  const [d, cashPending, salesVerify, purchaseVerify, trash] = await Promise.all([
    api(`/dashboard/summary?business_unit_id=${state.selectedBU}`),
    api('/cash-movements/pending'),
    api('/sale-collections/pending'),
    api('/purchase-payments/pending'),
    api('/trash'),
  ]);

  // (Roadmap Etapa 6) Antes había que visitar 3 pantallas separadas (Finanzas
  // > Verificar, Ventas > Verificar cobros, Compras > Verificar pago) para
  // saber si quedaba algo pendiente de confirmar. Acá se junta todo en un
  // solo lugar. Ventas usa el mismo filtro que ya usa esa misma pestaña
  // (!p.verified) para no contar los cobros que solo esperan conversión a
  // USD, que no son urgentes. Finanzas y Papelera no se filtran por unidad de
  // negocio porque ya son conceptos generales en el resto del ERP.
  const salesVerifyBU = salesVerify.filter(p => p.business_unit_id === state.selectedBU && !p.verified);
  const purchaseVerifyBU = purchaseVerify.filter(p => p.business_unit_id === state.selectedBU);
  const trashSoon = trash.filter(t => t.days_remaining <= 2);
  const hasPending = cashPending.length || salesVerifyBU.length || purchaseVerifyBU.length || trashSoon.length;

  el.innerHTML = `
    <div class="kpi-row">
      <div class="kpi"><div class="kpi-label">Ventas confirmadas</div><div class="kpi-value income">$ ${fmtMoney(d.totalSales)}</div></div>
      <div class="kpi"><div class="kpi-label">Compras confirmadas</div><div class="kpi-value expense">$ ${fmtMoney(d.totalPurchases)}</div></div>
      <div class="kpi"><div class="kpi-label">Unidades en stock</div><div class="kpi-value">${fmtQty(d.stockUnits)}</div></div>
      <div class="kpi"><div class="kpi-label">Proyectos activos</div><div class="kpi-value">${d.activeProjectsCount}</div></div>
    </div>

    ${hasPending ? `
    <div class="card">
      <div class="card-title">Pendiente de atención</div>
      <div class="hint" style="margin-bottom:10px">Todo lo que espera una confirmación tuya, junto en un solo lugar.</div>
      <div style="display:flex;flex-wrap:wrap;gap:10px">
        ${cashPending.length ? `<button class="btn btn-sm" onclick="financeSubTab='verificar'; goToView('cash')">Finanzas: ${cashPending.length} movimiento(s) sin verificar</button>` : ''}
        ${salesVerifyBU.length ? `<button class="btn btn-sm" onclick="salesSubTab='verify'; goToView('sales')">Ventas: ${salesVerifyBU.length} cobro(s) sin verificar</button>` : ''}
        ${purchaseVerifyBU.length ? `<button class="btn btn-sm" onclick="purchasesSubTab='verify'; goToView('purchases')">Compras: ${purchaseVerifyBU.length} pago(s) sin verificar</button>` : ''}
        ${trashSoon.length ? `<button class="btn btn-sm btn-danger" onclick="goToView('trash')">Papelera: ${trashSoon.length} elemento(s) se eliminan en 2 días o menos</button>` : ''}
      </div>
    </div>` : ''}

    <div class="card">
      <div class="card-title">Rentabilidad por proyecto (centro de costos)</div>
      ${tableOrEmpty(d.profitability, ['Proyecto', 'Ingresos', 'Egresos', 'Resultado'], (p) => `
        <tr>
          <td>${p.project_name}</td>
          <td class="num income">$ ${fmtMoney(p.total_income)}</td>
          <td class="num expense">$ ${fmtMoney(p.total_expense)}</td>
          <td class="num ${p.net_result >= 0 ? 'income' : 'expense'}">$ ${fmtMoney(p.net_result)}</td>
        </tr>`, 'No hay proyectos con movimientos todavía.')}
    </div>

    <div class="card">
      <div class="card-title">Últimas operaciones</div>
      ${tableOrEmpty(d.recentOperations, ['Tipo', 'Fecha', 'Estado', 'Total'], (o) => `
        <tr>
          <td><span class="badge ${o.kind === 'Venta' ? 'badge-kind-sale' : 'badge-kind-purchase'}">${o.kind}</span></td>
          <td class="mono">${fmtDate(o.date)}</td>
          <td>${statusBadge(o.status)}</td>
          <td class="num">$ ${fmtMoney(o.total_amount)}</td>
        </tr>`, 'Sin operaciones registradas.')}
    </div>
  `;
}

const STATUS_LABELS = { PENDING: 'Pendiente', CONFIRMED: 'Confirmada', CANCELLED: 'Cancelada', OPEN: 'Abierta', CLOSED: 'Cerrada' };
function statusLabel(status) { return STATUS_LABELS[status] || status; }
function statusBadge(status) {
  const map = { PENDING: 'pending', CONFIRMED: 'confirmed', CANCELLED: 'cancelled', OPEN: 'open', CLOSED: 'closed' };
  return `<span class="badge badge-${map[status] || 'pending'}">${statusLabel(status)}</span>`;
}

function tableOrEmpty(rows, headers, rowFn, emptyMsg, keyFn) {
  if (!rows.length) return `<div class="empty-state">${emptyMsg}</div>`;
  // keyFn (opcional): si la fila coincide con window._flashKey, se resalta brevemente
  // (se usa una sola vez y se limpia acá para no repetirse en el próximo render).
  const flashKey = window._flashKey;
  window._flashKey = null;
  return `
    <table class="ledger sortable-table">
      <thead><tr>${headers.map((h, i) => h ? `<th class="sortable-th" onclick="sortTableByColumn(this)" data-dir="">${h}<span class="sort-indicator"></span></th>` : `<th></th>`).join('')}</tr></thead>
      <tbody>${rows.map(r => {
        const html = rowFn(r);
        if (keyFn && flashKey != null && keyFn(r) === flashKey) {
          return html.replace('<tr>', '<tr class="row-flash">');
        }
        return html;
      }).join('')}</tbody>
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

  const st = listState.stock;
  const params = new URLSearchParams({ business_unit_id: state.selectedBU, page: st.page, limit: 50 });
  if (st.search) params.set('search', st.search);
  const { rows, total, limit } = await api(`/stock/list?${params.toString()}`);

  el.innerHTML = `
    <div class="card">
      <div class="section-toolbar">
        <div class="card-title" style="margin:0">Stock por depósito — unidad seleccionada</div>
        ${listSearchToolbarHtml('stock', 'stockSearchInput', 'Buscar por código, descripción o depósito…')}
      </div>
      ${tableOrEmpty(rows, ['Código', 'Artículo', 'Depósito', 'Cantidad', ''], (s) => `
        <tr ${Number(s.quantity) < 0 ? 'style="background:#FFF3E0"' : ''}>
          <td class="mono">${s.code}</td>
          <td>${s.description}</td>
          <td>${s.warehouse_name}</td>
          <td class="num" style="${Number(s.quantity) < 0 ? 'color:#C9820A;font-weight:700' : ''}">${Number(s.quantity) < 0 ? svgIcon('warning') + ' ' : ''}${fmtQty(s.quantity)}</td>
          <td style="text-align:right;white-space:nowrap">
            <button class="btn btn-sm" onclick="quickAddStock(${s.article_id}, ${s.warehouse_id}, '${s.description.replace(/'/g, "\\'")}', ${s.quantity})">Agregar unidades</button>
            <button class="btn btn-sm btn-danger" onclick="quickRemoveStock(${s.article_id}, ${s.warehouse_id}, '${s.description.replace(/'/g, "\\'")}', ${s.quantity})">Quitar unidades</button>
            ${rowActionsMenu(`stock_${s.id}`, stockRowMenuItems(s))}
          </td>
        </tr>`, 'No hay stock cargado en esta unidad todavía. Cargá una compra confirmada para generar stock.')}
      ${total ? paginationControlsHtml('stock', st.page, total, limit) : ''}
    </div>
  `;
  focusPreservingSearchInput('stockSearchInput');
}
function stockChangePage(page) { listState.stock.page = page; renderView(); }
// "Agregar/Quitar unidades" quedan como botones visibles porque son la
// acción principal de esta pantalla (ajuste rápido diario). "Historia" y
// "Eliminar registro" son de uso ocasional, van al "⋮".
function stockRowMenuItems(s) {
  const descEsc = s.description.replace(/'/g, "\\'");
  return [
    { label: 'Historia', onclick: `showKardex(${s.article_id}, '${descEsc}')` },
    { label: 'Eliminar registro', onclick: `deleteStockRow(${s.id}, '${descEsc}')`, danger: true },
  ];
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
    <p class="hint">Para un artículo o depósito puntual sin tener la fila a la vista. Si ya ves la fila en la lista, usá "Agregar unidades"/"Quitar unidades" ahí mismo — es más rápido.</p>
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
  const qty = Number(document.getElementById('f_adjust_qty').value);
  if (!(qty > 0)) { toast('Ingresá una cantidad válida.', 'error'); return; }
  const type = document.getElementById('f_adjust_type').value;
  if (!(await verifyPasswordPrompt(type === 'IN' ? 'agregar unidades de stock' : 'quitar unidades de stock'))) return;
  try {
    await api('/stock/adjust', {
      method: 'POST',
      body: JSON.stringify({
        article_id: Number(getSearchableValue('adjust_article')),
        warehouse_id: Number(getSearchableValue('adjust_warehouse')),
        quantity: qty,
        type,
      }),
    });
    closeModal();
    toast('Stock ajustado correctamente.');
    renderView();
  } catch (e) { toast(e.message, 'error'); }
}

// Modal genérico para pedir una cantidad (reemplaza los prompt() nativos del navegador
// en Stock, para que se vea y se comporte igual que el resto de los modales de la app).
function promptQuantityModal(title, hintHtml, initialValue, confirmLabel, onConfirm) {
  window._promptQtyCallback = onConfirm;
  openModal(`
    <h2>${title}</h2>
    ${hintHtml ? `<div class="hint" style="margin-bottom:14px">${hintHtml}</div>` : ''}
    <div class="field"><label>Cantidad</label><input id="f_prompt_qty" type="number" step="0.001" value="${initialValue ?? ''}"></div>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="submitPromptQuantity()">${confirmLabel || 'Confirmar'}</button>
    </div>
  `);
  document.getElementById('f_prompt_qty')?.focus();
}
function submitPromptQuantity() {
  const input = document.getElementById('f_prompt_qty');
  const value = input ? input.value : '';
  const cb = window._promptQtyCallback;
  closeModal();
  if (cb) cb(value);
}

async function quickAddStock(articleId, warehouseId, name, currentQty) {
  promptQuantityModal(
    'Agregar unidades',
    `Cantidad a agregar de <strong>"${name}"</strong> (actual: ${fmtQty(currentQty)}).`,
    '',
    'Agregar',
    async (input) => {
      const qty = Number(input);
      if (!(qty > 0)) { toast('Ingresá una cantidad válida.', 'error'); return; }
      if (!(await verifyPasswordPrompt('agregar unidades de stock'))) return;
      try {
        await api('/stock/adjust', {
          method: 'POST',
          body: JSON.stringify({ article_id: articleId, warehouse_id: warehouseId, quantity: qty, type: 'IN' }),
        });
        toast('Unidades agregadas al stock.');
        renderView();
      } catch (e) { toast(e.message, 'error'); }
    }
  );
}
async function quickRemoveStock(articleId, warehouseId, name, currentQty) {
  promptQuantityModal(
    'Quitar unidades',
    `Cantidad a quitar de <strong>"${name}"</strong> (disponible: ${fmtQty(currentQty)}).`,
    '',
    'Quitar',
    async (input) => {
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
  );
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
// (Roadmap Etapa 7, hallazgo #36) preferencia persistida en localStorage,
// mismo criterio que el resto de las preferencias de pantalla (erp_pref_*).
let articlesSimpleView = localStorage.getItem('erp_articles_simple_view') === '1';
function toggleArticlesSimpleView() {
  articlesSimpleView = !articlesSimpleView;
  localStorage.setItem('erp_articles_simple_view', articlesSimpleView ? '1' : '0');
  renderView();
}

async function renderArticles() {
  document.getElementById('viewActions').innerHTML = `
    <button class="btn btn-sm" onclick="toggleArticlesSimpleView()">${articlesSimpleView ? 'Vista completa' : 'Vista simple'}</button>
    <button class="btn btn-sm" onclick="downloadImportTemplate('articles')">Plantilla Excel</button>
    <button class="btn btn-sm" onclick="triggerImport('articles')">Importar Excel</button>
    <button class="btn btn-sm btn-danger" id="bulkDeleteArticlesBtn" style="display:none" onclick="bulkDeleteArticles()">Eliminar seleccionados</button>
    <button class="btn btn-primary" onclick="newArticleModal()">+ Nuevo artículo</button>`;
  const el = document.getElementById('view');

  const params = new URLSearchParams({ business_unit_id: state.selectedBU, page: articlesPage, limit: 50 });
  if (articlesSearch) params.set('search', articlesSearch);
  const { rows, total, limit } = await api(`/articles/list?${params.toString()}`);

  window._bulkSelectedArticleIds = null; // cada render arranca en modo "selección de esta página"
  el.innerHTML = `
    <div class="card">
      <div class="section-toolbar">
        <div class="card-title" style="margin:0">Artículos</div>
        <div style="display:flex;gap:8px;align-items:center">
          <input type="text" id="articlesSearchInput" value="${escAttr(articlesSearch)}" placeholder="Buscar por código o descripción…" title="Atajo: /" style="width:260px" oninput="articlesSearchDebounced()">
          ${articlesSearch ? `<button class="btn btn-sm" onclick="articlesClearSearch()">Limpiar</button>` : ''}
        </div>
      </div>
      <table class="ledger sortable-table dense-table${articlesSimpleView ? ' hide-cost-cols' : ''}">
        <thead><tr>
          <th style="width:30px"><input type="checkbox" id="selectAllArticles" onchange="toggleAllArticleChecks(this)"></th>
          ${[
            ['Código', '', false], ['Cód. alt.', '', false], ['Descripción', '', false],
            ['Costo ARS', '', true], ['P.ARS s/IVA', 'Precio ARS sin IVA', true], ['P.ARS c/IVA', 'Precio ARS con IVA', false],
            ['Costo USD', '', true], ['P.USD s/IVA', 'Precio USD sin IVA', true], ['P.USD c/IVA', 'Precio USD con IVA', false],
            ['Obs.', '', false], ['', '', false],
          ].map(([h, title, isCost]) => h
            ? `<th class="sortable-th${isCost ? ' cost-col' : ''}" onclick="sortTableByColumn(this)" data-dir="" ${title ? `title="${title}"` : ''}>${h}<span class="sort-indicator"></span></th>`
            : `<th></th>`).join('')}
        </tr></thead>
        <tbody>
          ${rows.length ? rows.map(a => `
            <tr>
              <td><input type="checkbox" class="article-check" value="${a.article_id}" onchange="onArticleCheckToggle()"></td>
              <td class="mono">${a.code}</td>
              <td class="mono">${a.alt_code || '-'}</td>
              <td>${a.description}</td>
              <td class="num cost-col">$ ${fmtMoney(a.list_cost_ars)}</td>
              <td class="num income cost-col">${articlePriceDisplay(a, 'ARS', false)}</td>
              <td class="num income">${articlePriceDisplay(a, 'ARS', true)}</td>
              <td class="num cost-col">US$ ${fmtMoney(a.list_cost_usd)}</td>
              <td class="num income cost-col">${articlePriceDisplay(a, 'USD', false)}</td>
              <td class="num income">${articlePriceDisplay(a, 'USD', true)}</td>
              <td style="text-align:center" title="${(a.notes || '').replace(/"/g, '&quot;')}">${a.notes ? svgIcon('note') : '-'}</td>
              <td>
                <button class="btn btn-sm" onclick="openEditArticleModal(${a.article_id})">Editar</button>
                <button class="btn btn-sm btn-danger" onclick="deleteArticle(${a.article_id}, '${a.code}')">Eliminar</button>
              </td>
            </tr>`).join('') : `<tr><td colspan="12"><div class="empty-state">No hay artículos que coincidan.</div></td></tr>`}
        </tbody>
      </table>
      ${total > rows.length ? `<div class="hint" style="margin-top:8px">¿Necesitás seleccionar más que esta página? <a href="#" onclick="selectAllArticlesMatchingFilter(); return false;">Seleccionar los ${total} resultados de este filtro</a>.</div>` : ''}
      ${total ? paginationControlsHtml('articles', articlesPage, total, limit) : ''}
    </div>
  `;
  document.getElementById('articlesSearchInput')?.focus();
  const input = document.getElementById('articlesSearchInput');
  if (input) input.setSelectionRange(input.value.length, input.value.length);
}
async function selectAllArticlesMatchingFilter() {
  const params = new URLSearchParams({ business_unit_id: state.selectedBU, page: 1, limit: 200 });
  if (articlesSearch) params.set('search', articlesSearch);
  let page = 1;
  let ids = [];
  let total = Infinity;
  showWorking('Seleccionando artículos…');
  try {
    while (ids.length < total) {
      params.set('page', page);
      const { rows, total: t } = await api(`/articles/list?${params.toString()}`);
      total = t;
      ids = ids.concat(rows.map(r => r.article_id));
      if (!rows.length) break;
      page++;
    }
  } finally {
    hideWorking();
  }
  window._bulkSelectedArticleIds = ids;
  document.querySelectorAll('.article-check').forEach(c => c.checked = true);
  updateBulkDeleteButton();
}
function onArticleCheckToggle() {
  window._bulkSelectedArticleIds = null; // el usuario está ajustando la selección a mano
  updateBulkDeleteButton();
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
  window._bulkSelectedArticleIds = null; // "seleccionar todo" del encabezado vuelve a ser por página
  document.querySelectorAll('.article-check').forEach(c => c.checked = checkbox.checked);
  updateBulkDeleteButton();
}
function updateBulkDeleteButton() {
  const btn = document.getElementById('bulkDeleteArticlesBtn');
  if (!btn) return;
  const checked = window._bulkSelectedArticleIds ? window._bulkSelectedArticleIds.length : document.querySelectorAll('.article-check:checked').length;
  btn.style.display = checked > 0 ? 'inline-flex' : 'none';
  btn.textContent = checked > 0 ? `Eliminar seleccionados (${checked})` : 'Eliminar seleccionados';
}
async function bulkDeleteArticles() {
  const ids = window._bulkSelectedArticleIds || [...document.querySelectorAll('.article-check:checked')].map(c => Number(c.value));
  if (!ids.length) return;
  if (!confirm(`¿Eliminar ${ids.length} artículo(s)? Esta acción no se puede deshacer.`)) return;
  if (!(await verifyPasswordPrompt(`eliminar ${ids.length} artículos`))) return;
  let ok = 0, failed = 0;
  showWorking(`Eliminando artículos… (0/${ids.length})`);
  for (const id of ids) {
    try { await api(`/articles/${id}`, { method: 'DELETE' }); ok++; } catch (e) { failed++; }
    document.getElementById('workingIndicatorText').textContent = `Eliminando artículos… (${ok + failed}/${ids.length})`;
  }
  hideWorking();
  window._bulkSelectedArticleIds = null;
  toast(failed ? `Eliminados: ${ok}. Con errores: ${failed}.` : `${ok} artículo(s) eliminado(s).`, failed ? 'error' : 'success');
  renderView();
}

function articlePriceFor(a, targetCurrency, withIva) {
  const manual = targetCurrency === 'USD' ? a.price_usd : a.price_ars;
  if (manual != null) {
    const ivaPct = targetCurrency === 'USD' ? a.iva_pct_usd : a.iva_pct_ars;
    return withIva ? manual * (1 + Number(ivaPct) / 100) : Number(manual);
  }
  if (targetCurrency === 'USD') {
    return withIva ? Number(a.final_price_usd_with_iva) : Number(a.final_price_usd);
  }
  return withIva ? Number(a.final_price_ars_with_iva) : Number(a.final_price_ars);
}
function articlePriceDisplay(a, targetCurrency, withIva) {
  const price = articlePriceFor(a, targetCurrency, withIva);
  const sym = targetCurrency === 'USD' ? 'US$' : '$';
  return price != null ? `${sym} ${fmtMoney(price)}` : '<span style="color:var(--muted)">—</span>';
}

async function deleteArticle(id, code) {
  if (!confirm(`¿Eliminar el artículo ${code}? Esta acción no se puede deshacer.`)) return;
  if (!(await verifyPasswordPrompt(`eliminar el artículo ${code}`))) return;
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
  return `
    <div class="field-row">
      <div class="field"><label>Código</label><input id="f_code" placeholder="ART001" value="${escAttr(a?.code)}"></div>
      <div class="field"><label>Código alternativo</label><input id="f_altcode" placeholder="Opcional" value="${escAttr(a?.alt_code)}"></div>
    </div>
    <div class="field"><label>Descripción</label><input id="f_desc" placeholder="Nombre del producto" value="${escAttr(a?.description)}"></div>

    <div class="field"><label>Moneda que estás editando</label>
      <select id="f_currency" onchange="onCurrencySwitch()">
        <option value="ARS">Pesos argentinos (ARS)</option>
        <option value="USD">Dólares (USD)</option>
      </select>
    </div>
    <div class="hint" style="margin-top:-10px;margin-bottom:14px">Cada moneda tiene su propio costo de lista, márgenes e IVA. Cambiar acá solo alterna cuál estás viendo/editando; no convierte ni comparte valores entre monedas.</div>

    <div class="field"><label id="f_cost_label">Costo de lista (ARS)</label><input id="f_cost" type="text" inputmode="decimal" placeholder="0,00" onfocus="unformatMoneyField(this)" onblur="formatMoneyField(this)"></div>
    <div class="field-row">
      <div class="field"><label>Margen envío %</label><input id="f_ship" type="number" step="0.01" placeholder="0"></div>
      <div class="field"><label>Margen TC %</label><input id="f_fx" type="number" step="0.01" placeholder="0"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Margen ganancia %</label><input id="f_profit" type="number" step="0.01" placeholder="0"></div>
      <div class="field"><label>IVA %</label><input id="f_iva" type="number" step="0.01" placeholder="21"></div>
    </div>
    <div class="field"><label id="f_price_manual_label">Precio de venta manual (ARS)</label><input id="f_price_manual" type="text" inputmode="decimal" placeholder="Dejar vacío para usar el calculado" onfocus="unformatMoneyField(this)" onblur="formatMoneyField(this)"></div>
    <div class="hint" style="margin-bottom:16px">Si cargás un precio manual, se usa ese valor directo al vender en esta moneda, en vez del calculado por márgenes.</div>

    <div class="field"><label>Observaciones</label><textarea id="f_notes" rows="3" style="width:100%;padding:9px 10px;border:1px solid var(--border);border-radius:8px;background:#FAFAFA;font-family:var(--sans)" placeholder="Notas internas sobre este artículo...">${(a?.notes || '').replace(/</g, '&lt;')}</textarea></div>

    <div class="card" style="margin:4px 0 18px 0; padding:14px 16px;">
      <div class="card-title" style="margin-bottom:10px">Previsualización de precio de venta <span id="pv_currency_label"></span></div>
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

function articlePricingDataFrom(a) {
  return {
    ARS: {
      cost: a?.list_cost_ars ?? '', ship: a?.shipping_margin_pct_ars ?? '', fx: a?.fx_margin_pct_ars ?? '',
      profit: a?.profit_margin_pct_ars ?? '', iva: a?.iva_pct_ars ?? 21, priceManual: a?.price_ars ?? '',
    },
    USD: {
      cost: a?.list_cost_usd ?? '', ship: a?.shipping_margin_pct_usd ?? '', fx: a?.fx_margin_pct_usd ?? '',
      profit: a?.profit_margin_pct_usd ?? '', iva: a?.iva_pct_usd ?? 21, priceManual: a?.price_usd ?? '',
    },
  };
}
function loadCurrencyFieldsFromState(currency) {
  const d = window._articlePricing[currency];
  document.getElementById('f_cost').value = d.cost !== '' ? formatMoneyFieldValue(d.cost) : '';
  document.getElementById('f_ship').value = d.ship;
  document.getElementById('f_fx').value = d.fx;
  document.getElementById('f_profit').value = d.profit;
  document.getElementById('f_iva').value = d.iva;
  document.getElementById('f_price_manual').value = d.priceManual !== '' ? formatMoneyFieldValue(d.priceManual) : '';
  const sym = currency === 'USD' ? 'US$' : '$';
  const label = currency === 'USD' ? 'Dólares (USD)' : 'Pesos (ARS)';
  document.getElementById('f_cost_label').textContent = `Costo de lista (${currency})`;
  document.getElementById('f_price_manual_label').textContent = `Precio de venta manual (${currency})`;
  document.getElementById('pv_currency_label').textContent = `— ${label}`;
}
function saveCurrentFieldsToState(currency) {
  window._articlePricing[currency] = {
    cost: document.getElementById('f_cost').value,
    ship: document.getElementById('f_ship').value,
    fx: document.getElementById('f_fx').value,
    profit: document.getElementById('f_profit').value,
    iva: document.getElementById('f_iva').value,
    priceManual: document.getElementById('f_price_manual').value,
  };
}
let _articleCurrentCurrency = 'ARS';
function onCurrencySwitch() {
  saveCurrentFieldsToState(_articleCurrentCurrency);
  _articleCurrentCurrency = document.getElementById('f_currency').value;
  loadCurrencyFieldsFromState(_articleCurrentCurrency);
  updatePricePreview();
}

function newArticleModal() {
  window._articlePricing = articlePricingDataFrom(null);
  _articleCurrentCurrency = 'ARS';
  openModal(`
    <h2>Nuevo artículo</h2>
    ${articleFormHtml(null)}
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="createArticle()">Guardar</button>
    </div>
  `);
  document.getElementById('f_currency').value = 'ARS';
  loadCurrencyFieldsFromState('ARS');
  bindPricePreviewListeners();
  updatePricePreview();
}

async function openEditArticleModal(articleId) {
  let a = state.cache.articles.find(x => x.article_id === articleId);
  if (!a) {
    // El caché puede estar desactualizado (ej: recién importado); reintentar tras refrescar.
    await refreshArticles();
    a = state.cache.articles.find(x => x.article_id === articleId);
  }
  if (!a) { toast('No se encontró el artículo.', 'error'); return; }
  window._articlePricing = articlePricingDataFrom(a);
  _articleCurrentCurrency = 'ARS';
  openModal(`
    <h2>Editar artículo</h2>
    ${articleFormHtml(a)}
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="submitEditArticle(${a.article_id})">Guardar</button>
    </div>
  `);
  document.getElementById('f_currency').value = 'ARS';
  loadCurrencyFieldsFromState('ARS');
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
  const cost = parseMoneyInput(document.getElementById('f_cost').value);
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
function buildArticlePricingPayload() {
  saveCurrentFieldsToState(_articleCurrentCurrency);
  const ars = window._articlePricing.ARS;
  const usd = window._articlePricing.USD;
  return {
    list_cost_ars: parseMoneyInput(ars.cost) || 0,
    shipping_margin_pct_ars: Number(ars.ship) || 0,
    fx_margin_pct_ars: Number(ars.fx) || 0,
    profit_margin_pct_ars: Number(ars.profit) || 0,
    iva_pct_ars: ars.iva !== '' ? Number(ars.iva) : 21,
    price_ars: ars.priceManual !== '' ? parseMoneyInput(ars.priceManual) : null,
    list_cost_usd: parseMoneyInput(usd.cost) || 0,
    shipping_margin_pct_usd: Number(usd.ship) || 0,
    fx_margin_pct_usd: Number(usd.fx) || 0,
    profit_margin_pct_usd: Number(usd.profit) || 0,
    iva_pct_usd: usd.iva !== '' ? Number(usd.iva) : 21,
    price_usd: usd.priceManual !== '' ? parseMoneyInput(usd.priceManual) : null,
  };
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
        notes: document.getElementById('f_notes').value,
        ...buildArticlePricingPayload(),
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
        notes: document.getElementById('f_notes').value,
        ...buildArticlePricingPayload(),
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

let _whDetailRows = [];
let _whDetailWarehouseId = null;
let _whDetailName = '';

async function showWarehouseDetail(warehouseId, name) {
  const stock = await api('/stock');
  _whDetailRows = stock.filter(s => s.warehouse_id === warehouseId);
  _whDetailWarehouseId = warehouseId;
  _whDetailName = name;
  openModal(`
    <h2>Depósito — ${name}</h2>
    ${_whDetailRows.length > 8 ? `<div class="field"><input type="text" id="whDetailFilter" placeholder="Buscar por código o descripción…" oninput="filterWarehouseDetail()"></div>` : ''}
    <div id="whDetailTableWrap">${renderWarehouseDetailTable(_whDetailRows, false)}</div>
    <div class="modal-actions"><button class="btn" onclick="closeModal()">Cerrar</button></div>
  `);
}
function renderWarehouseDetailTable(rows, filtered) {
  return tableOrEmpty(rows, ['Código', 'Artículo', 'Cantidad', ''], (s) => `
      <tr>
        <td class="mono">${s.code}</td>
        <td>${s.description}</td>
        <td class="num" id="wh_qty_${s.article_id}">${fmtQty(s.quantity)}</td>
        <td><button class="btn btn-sm" onclick="editWarehouseStock(${_whDetailWarehouseId}, ${s.article_id}, '${s.description.replace(/'/g, "\\'")}', ${s.quantity}, '${_whDetailName.replace(/'/g, "\\'")}')">Editar</button></td>
      </tr>`, filtered ? 'Ningún artículo coincide con la búsqueda.' : 'Este depósito no tiene artículos con stock todavía.');
}
function filterWarehouseDetail() {
  const q = (document.getElementById('whDetailFilter').value || '').trim().toLowerCase();
  const filteredRows = !q ? _whDetailRows : _whDetailRows.filter(s => s.code.toLowerCase().includes(q) || s.description.toLowerCase().includes(q));
  document.getElementById('whDetailTableWrap').innerHTML = renderWarehouseDetailTable(filteredRows, true);
}

async function editWarehouseStock(warehouseId, articleId, name, currentQty, warehouseName) {
  promptQuantityModal(
    'Editar stock',
    `Nueva cantidad de <strong>"${name}"</strong> en <strong>"${warehouseName}"</strong> (actual: ${fmtQty(currentQty)}).`,
    currentQty,
    'Guardar',
    async (input) => {
      const qty = Number(input);
      if (isNaN(qty) || qty < 0) { toast('Ingresá un número válido (0 o mayor).', 'error'); return; }
      if (!(await verifyPasswordPrompt('editar stock manualmente'))) return;
      try {
        await api('/stock/set', {
          method: 'PUT',
          body: JSON.stringify({ warehouse_id: warehouseId, article_id: articleId, quantity: qty }),
        });
        toast('Stock actualizado.');
        renderView();
      } catch (e) { toast(e.message, 'error'); }
    }
  );
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
  if (!(await verifyPasswordPrompt(`eliminar "${name}"`))) return;
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

  const st = listState.suppliers;
  const params = new URLSearchParams({ page: st.page, limit: 50 });
  if (st.search) params.set('search', st.search);
  const { rows, total, limit } = await api(`/suppliers/list?${params.toString()}`);

  el.innerHTML = `
    <div class="card">
      <div class="section-toolbar">
        <div class="card-title" style="margin:0">Proveedores</div>
        ${listSearchToolbarHtml('suppliers', 'suppliersSearchInput', 'Buscar por nombre o CUIT…')}
      </div>
      ${tableOrEmpty(rows, ['Nombre', 'CUIT/Tax ID', 'Saldo cta. cte.', ''], (s) => `
        <tr><td>${s.name}</td><td class="mono">${s.tax_id || '-'}</td>
        <td class="num ${Number(s.balance) > 0 ? 'expense' : ''}" style="cursor:pointer;text-decoration:underline" title="Ver cuenta corriente" onclick="showContactStatement('supplier', ${s.id}, '${s.name.replace(/'/g, "\\'")}')">$ ${fmtMoney(s.balance || 0)}</td>
        <td>
          <button class="btn btn-sm" onclick="openEditContactModal('supplier', ${s.id})">Editar</button>
          <button class="btn btn-sm btn-danger" onclick="deleteEntity('suppliers', ${s.id}, '${s.name.replace(/'/g, "\\'")}')">Eliminar</button>
        </td></tr>`,
        'No hay proveedores cargados.', (s) => s.id)}
      ${total ? paginationControlsHtml('suppliers', st.page, total, limit) : ''}
    </div>`;
  focusPreservingSearchInput('suppliersSearchInput');
}
function suppliersChangePage(page) { listState.suppliers.page = page; renderView(); }

async function renderCustomers() {
  document.getElementById('viewActions').innerHTML = `
    <button class="btn btn-sm" onclick="downloadImportTemplate('customers')">Plantilla Excel</button>
    <button class="btn btn-sm" onclick="triggerImport('customers')">Importar Excel</button>
    <button class="btn btn-primary" onclick="newContactModal('customer')">+ Nuevo cliente</button>`;
  const el = document.getElementById('view');

  const st = listState.customers;
  const params = new URLSearchParams({ page: st.page, limit: 50 });
  if (st.search) params.set('search', st.search);
  const { rows, total, limit } = await api(`/customers/list?${params.toString()}`);

  el.innerHTML = `
    <div class="card">
      <div class="section-toolbar">
        <div class="card-title" style="margin:0">Clientes</div>
        ${listSearchToolbarHtml('customers', 'customersSearchInput', 'Buscar por nombre o CUIT…')}
      </div>
      ${tableOrEmpty(rows, ['Nombre', 'CUIT/Tax ID', 'Deuda pendiente', ''], (c) => `
        <tr><td>${c.name}</td><td class="mono">${c.tax_id || '-'}</td>
        <td class="num ${Number(c.balance) > 0 ? 'expense' : ''}" style="cursor:pointer;text-decoration:underline" title="Ver cuenta corriente" onclick="showContactStatement('customer', ${c.id}, '${c.name.replace(/'/g, "\\'")}')">$ ${fmtMoney(c.balance || 0)}</td>
        <td>
          <button class="btn btn-sm" onclick="openEditContactModal('customer', ${c.id})">Editar</button>
          <button class="btn btn-sm btn-danger" onclick="deleteEntity('customers', ${c.id}, '${c.name.replace(/'/g, "\\'")}')">Eliminar</button>
        </td></tr>`,
        'No hay clientes cargados.', (c) => c.id)}
      ${total ? paginationControlsHtml('customers', st.page, total, limit) : ''}
    </div>`;
  focusPreservingSearchInput('customersSearchInput');
}
function customersChangePage(page) { listState.customers.page = page; renderView(); }
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

  const st = listState.projects;
  const params = new URLSearchParams({ business_unit_id: state.selectedBU, page: st.page, limit: 50 });
  if (st.search) params.set('search', st.search);
  const [{ rows: pageRows, total, limit }, profitability] = await Promise.all([
    api(`/projects/list?${params.toString()}`),
    api('/projects/profitability'),
  ]);
  const rows = pageRows.map(p => ({ ...p, profit: profitability.find(x => x.project_id === p.id) }));

  el.innerHTML = `
    <div class="card">
      <div class="section-toolbar">
        <div class="card-title" style="margin:0">Proyectos</div>
        ${listSearchToolbarHtml('projects', 'projectsSearchInput', 'Buscar por nombre…')}
      </div>
      ${tableOrEmpty(rows, ['Nombre', 'Ingresos', 'Egresos', 'Resultado', ''], (p) => `
        <tr>
          <td>${p.name}</td>
          <td class="num income">$ ${fmtMoney(p.profit?.total_income || 0)}</td>
          <td class="num expense">$ ${fmtMoney(p.profit?.total_expense || 0)}</td>
          <td class="num ${Number(p.profit?.net_result || 0) >= 0 ? 'income' : 'expense'}">$ ${fmtMoney(p.profit?.net_result || 0)}</td>
          <td>
            <button class="btn btn-sm" onclick="openEditProjectModal(${p.id}, '${p.name.replace(/'/g, "\\'")}')">Editar</button>
            <button class="btn btn-sm btn-danger" onclick="deleteEntity('projects', ${p.id}, '${p.name.replace(/'/g, "\\'")}')">Eliminar</button>
          </td>
        </tr>`, 'No hay proyectos en esta unidad.', (p) => p.id)}
      ${total ? paginationControlsHtml('projects', st.page, total, limit) : ''}
    </div>`;
  focusPreservingSearchInput('projectsSearchInput');
}
function projectsChangePage(page) { listState.projects.page = page; renderView(); }
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

// ---------------------------------------------------------
// Buscador + paginación reutilizable para listados (mismo patrón que ya usaba
// Artículos, generalizado acá para no repetirlo entero en cada listado nuevo).
// idPrefix tiene que tener definida una función global `${idPrefix}ChangePage(page)`
// (igual que ya requiere paginationControlsHtml).
// ---------------------------------------------------------
const listState = {
  stock: { page: 1, search: '' },
  suppliers: { page: 1, search: '' },
  customers: { page: 1, search: '' },
  projects: { page: 1, search: '' },
  quotes: { page: 1, search: '' },
  shipments: { page: 1, search: '' },
};
let listSearchTimer = null;
function listSearchDebounced(kind, inputId) {
  clearTimeout(listSearchTimer);
  listSearchTimer = setTimeout(() => {
    listState[kind].search = document.getElementById(inputId).value;
    listState[kind].page = 1;
    renderView();
  }, 350);
}
function listClearSearch(kind) {
  listState[kind].search = '';
  listState[kind].page = 1;
  renderView();
}
function listSearchToolbarHtml(kind, inputId, placeholder, title) {
  const search = listState[kind].search;
  return `
    <div style="display:flex;gap:8px;align-items:center">
      <input type="text" id="${inputId}" value="${escAttr(search)}" placeholder="${placeholder}" ${title ? `title="${title}"` : ''} style="width:260px" oninput="listSearchDebounced('${kind}', '${inputId}')">
      ${search ? `<button class="btn btn-sm" onclick="listClearSearch('${kind}')">Limpiar</button>` : ''}
    </div>`;
}
function focusPreservingSearchInput(inputId) {
  const input = document.getElementById(inputId);
  if (!input) return;
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}

async function renderPurchases() {
  document.getElementById('viewActions').innerHTML = purchasesSubTab === 'purchases'
    ? `<button class="btn btn-primary" onclick="newOperationModal('purchase')" title="Atajo: N">+ Nueva compra</button>`
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
          <tr ${daysSince(p.created_at) >= 2 ? 'style="background:#FFF3E0"' : ''}>
            <td class="mono">${fmtDate(p.created_at)}${daysSince(p.created_at) >= 2 ? ` <span style="color:#C9820A;font-weight:600">${svgIcon('warning')} hace ${daysSince(p.created_at)}d</span>` : ''}</td>
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
          <td class="mono">${fmtDateShort(p.date)}</td>
          <td>${statusBadge(p.status)}</td>
          <td>${p.payment_type === 'CASH' ? 'Contado' : 'Cta. Cte.'}</td>
          <td class="num expense">$ ${fmtMoney(p.total_amount)}</td>
          <td style="text-align:right;white-space:nowrap">
            <button class="btn btn-sm" onclick="showPurchaseDetail(${p.id})">Detalle</button>
            ${(p.status === 'CONFIRMED' && (Number(p.total_amount) - Number(p.settled_amount || 0)) > 0.01) ? `<button class="btn btn-sm btn-primary" onclick="openPayModal(${p.id}, ${Number(p.total_amount) - Number(p.settled_amount || 0)})">Procesar pago</button>` : ''}
            ${rowActionsMenu(`purchase_${p.id}`, purchaseRowMenuItems(p))}
          </td>
        </tr>`, 'No hay compras registradas en esta unidad.', (p) => p.id)}
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
// Mismo criterio que saleRowMenuItems: agrupa lo menos frecuente en el "⋮",
// deja "Detalle" y "Procesar pago" (cuando corresponde) como botones visibles.
// (Roadmap Etapa 3) Compras ya tiene modal de Detalle, igual que Ventas — ver
// showPurchaseDetail().
function purchaseRowMenuItems(p) {
  return [
    ...opActionsItems('purchases', p),
    { label: 'Eliminar', onclick: `deleteOperation('purchases', ${p.id})`, danger: true },
  ];
}
// (Roadmap Etapa 3) Nuevo — paridad con showSaleDetail(). Reutiliza
// /purchases/:id/full, que ya existía (Bloque 2, edición) y ya trae los
// ítems con código/descripción/subtotal.
async function showPurchaseDetail(purchaseId) {
  const full = await api(`/purchases/${purchaseId}/full`).catch(() => null);
  if (!full) { toast('No se pudo cargar la compra.', 'error'); return; }
  const { purchase, items } = full;
  const remaining = Number(purchase.total_amount) - Number(purchase.settled_amount || 0);
  const canPay = purchase.status === 'CONFIRMED' && remaining > 0.01;
  openModal(`
    <h2>Detalle — Compra #${purchaseId}</h2>
    ${tableOrEmpty(items, ['Código', 'Artículo', 'Cantidad', 'Costo unit.', 'Subtotal'], (i) => `
      <tr>
        <td class="mono">${i.code}</td>
        <td>${i.description}</td>
        <td class="num">${fmtQty(i.quantity)}</td>
        <td class="num">$ ${fmtMoney(i.unit_cost)}</td>
        <td class="num expense">$ ${fmtMoney(i.subtotal)}</td>
      </tr>`, 'Sin artículos registrados en esta compra.')}
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cerrar</button>
      ${canPay ? `<button class="btn btn-primary" onclick="openPayModal(${purchaseId}, ${remaining})">Procesar pago</button>` : ''}
    </div>
  `);
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
  addPaySplit(remaining);
}
let paySplitCount = 0;
function addPaySplit(defaultAmount) {
  const id = paySplitCount++;
  const container = document.getElementById('paySplits');
  const row = document.createElement('div');
  row.className = 'line-item-row';
  row.id = `psplit_${id}`;
  row.innerHTML = `
    ${searchableSelectHtml(`pbox_${id}`, window._payBoxItems, 'Buscar caja…')}
    <input type="text" inputmode="decimal" placeholder="Monto" id="pamount_${id}" value="${defaultAmount != null ? formatMoneyFieldValue(defaultAmount) : ''}" onfocus="unformatMoneyField(this)" onblur="formatMoneyField(this)">
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
      amount: parseMoneyInput(document.getElementById(`pamount_${idx}`).value),
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
  if (!(await verifyPasswordPrompt('confirmar el movimiento físico de este pago', true))) return;
  try {
    await api(`/purchase-payments/${id}/verify`, { method: 'POST' });
    toast('Pago verificado. Ya impacta en el saldo.');
    renderView();
  } catch (e) { toast(e.message, 'error'); }
}
async function rejectPurchasePayment(id) {
  if (!confirm('¿Rechazar este pago pendiente?')) return;
  if (!(await verifyPasswordPrompt('rechazar este pago', true))) return;
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

  const st = listState.quotes;
  const params = new URLSearchParams({ business_unit_id: state.selectedBU, page: st.page, limit: 25 });
  if (st.search) params.set('search', st.search);
  const { rows, total, limit } = await api(`/quotes/list?${params.toString()}`);

  el.innerHTML = `
    <div class="card">
      <div class="section-toolbar">
        <div class="card-title" style="margin:0">Presupuestos</div>
        ${listSearchToolbarHtml('quotes', 'quotesSearchInput', 'Buscar por cliente o número…')}
      </div>
      ${tableOrEmpty(rows, ['#', 'Cliente', 'Fecha', 'Estado', 'Total', ''], (q) => `
        <tr>
          <td class="mono">#${q.id}</td>
          <td>${customerName(q.customer_id)}</td>
          <td class="mono">${fmtDateShort(q.date)}</td>
          <td>${quoteStatusBadge(q.status)}</td>
          <td class="num income">${q.currency === 'USD' ? 'US$' : '$'} ${fmtMoney(q.total_amount)}</td>
          <td style="text-align:right;white-space:nowrap">
            <button class="btn btn-sm" onclick="showQuoteDetail(${q.id})">Detalle</button>
            ${q.status === 'PENDING' ? `<button class="btn btn-sm btn-primary" onclick="convertQuoteToSale(${q.id})">Convertir en venta</button>` : ''}
            ${q.status === 'CONVERTED' && q.converted_sale_id ? `<button class="btn btn-sm" onclick="goToView('sales', () => showSaleDetail(${q.converted_sale_id}))">Ver venta #${q.converted_sale_id}</button>` : ''}
            ${rowActionsMenu(`quote_${q.id}`, quoteRowMenuItems(q))}
          </td>
        </tr>`, 'No hay presupuestos cargados en esta unidad.', (q) => q.id)}
      ${total ? paginationControlsHtml('quotes', st.page, total, limit) : ''}
    </div>`;
  focusPreservingSearchInput('quotesSearchInput');
}
function quotesChangePage(page) { listState.quotes.page = page; renderView(); }
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
// (Roadmap Etapa 4) "Editar" solo mientras está PENDING (el backend también
// lo valida). "Convertir en venta"/"Ver venta" quedan visibles fuera del
// menú por ser la acción principal de cada estado — ver renderQuotes().
function quoteRowMenuItems(q) {
  const items = [];
  if (q.status === 'PENDING') items.push({ label: 'Editar', onclick: `openEditQuoteModal(${q.id})` });
  items.push({ label: 'Eliminar', onclick: `deleteQuote(${q.id})`, danger: true });
  return items;
}

// (Roadmap Etapa 4) Antes newQuoteModal()/createQuote() solo servían para dar
// de alta. Se unificaron en quoteModal(existing) + buildQuotePayload() para
// que alta y edición compartan el mismo formulario, mismo patrón que ya se
// usa en newOperationModal (Ventas/Compras).
function quoteModal(existing) {
  window._stockLookup = null;
  // Presupuestos reutiliza addLineItem('sale')/addExistingLineItem('sale')
  // (mismo componente que Ventas/Compras) pero NO participa del autoguardado
  // de borrador de Etapa 8 — por eso se apaga acá explícitamente, así no
  // queda un borrador de "venta" con campos de presupuesto por un `kind`
  // igual ('sale') pero contexto distinto.
  _draftAutosaveKind = null;
  const isEdit = !!existing;
  const q = existing?.quote;
  const contactItems = reorderWithPreferred(state.cache.customers.map(c => ({ id: c.id, label: c.name })), q?.customer_id || null);
  const whItems = [{ id: '', label: 'Sin depósito' }, ...whByBU().map(w => ({ id: w.id, label: w.name }))];
  const projItems = [{ id: '', label: 'Sin proyecto' }, ...projByBU().map(p => ({ id: p.id, label: p.name }))];

  lineItemCount = 0;
  openModal(`
    <h2>${isEdit ? `Editar presupuesto #${q.id}` : 'Nuevo presupuesto'}</h2>
    <div class="field"><label>Cliente</label>${searchableSelectHtml('quote_contact', contactItems, 'Buscar cliente…', isEdit ? contactItems[0]?.label : undefined)}</div>
    <div class="field-row">
      <div class="field"><label>Depósito (opcional)</label>${searchableSelectHtml('quote_warehouse', reorderWithPreferred(whItems, q?.warehouse_id || null), 'Buscar depósito…', isEdit && q?.warehouse_id ? whItems.find(w => w.id === q.warehouse_id)?.label : 'Sin depósito')}</div>
      <div class="field"><label>Proyecto (opcional)</label>${searchableSelectHtml('quote_project', reorderWithPreferred(projItems, q?.project_id || null), 'Buscar proyecto…', isEdit && q?.project_id ? projItems.find(p => p.id === q.project_id)?.label : 'Sin proyecto')}</div>
    </div>
    <div class="field"><label>Artículos</label>
      <div class="line-items" id="lineItems"></div>
      <button class="btn btn-sm" onclick="addLineItem('sale')">+ Agregar artículo</button>
    </div>
    <div class="field-row">
      <div class="field"><label>Moneda</label>
        <select id="f_sale_currency" onchange="refreshAllLinePrices()">
          <option value="ARS" ${!q || q.currency === 'ARS' ? 'selected' : ''}>Pesos argentinos (ARS)</option>
          <option value="USD" ${q && q.currency === 'USD' ? 'selected' : ''}>Dólares (USD)</option>
        </select>
      </div>
      <div class="field"><label>Precios</label>
        <select id="f_sale_iva" onchange="refreshAllLinePrices()">
          <option value="no">Sin IVA</option>
          <option value="si">Con IVA</option>
        </select>
      </div>
    </div>
    <div class="field"><label>Observaciones (opcional)</label><input id="f_quote_notes" placeholder="Notas del presupuesto" value="${q ? escAttr(q.notes) : ''}"></div>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="${isEdit ? `updateQuote(${q.id})` : 'createQuote()'}">Guardar</button>
    </div>
  `);
  if (isEdit && existing.items?.length) {
    existing.items.forEach(item => addExistingLineItem('sale', item));
  } else {
    addLineItem('sale');
  }
}
function newQuoteModal() { quoteModal(null); }
async function openEditQuoteModal(id) {
  try {
    const [quote, items] = await Promise.all([
      api('/quotes').then(list => list.find(x => x.id === id)),
      api(`/quotes/${id}/items`),
    ]);
    if (!quote) { toast('Presupuesto no encontrado.', 'error'); return; }
    if (quote.status !== 'PENDING') { toast('Solo se puede editar un presupuesto pendiente.', 'error'); return; }
    quoteModal({ quote, items });
  } catch (e) { toast(e.message, 'error'); }
}
function buildQuotePayload() {
  const rows = [...document.getElementById('lineItems').children];
  const items = rows.map(row => {
    const idMatch = row.id.replace('line_', '');
    return {
      article_id: Number(document.getElementById(`artid_${idMatch}`).value),
      quantity: Number(document.getElementById(`qty_${idMatch}`).value),
      unit_price: parseMoneyInput(document.getElementById(`price_${idMatch}`).value),
    };
  }).filter(i => i.article_id);
  if (!items.length) { toast('Agregá al menos un artículo.', 'error'); return null; }
  return {
    business_unit_id: state.selectedBU,
    customer_id: Number(getSearchableValue('quote_contact')),
    warehouse_id: getSearchableValue('quote_warehouse') ? Number(getSearchableValue('quote_warehouse')) : null,
    project_id: getSearchableValue('quote_project') ? Number(getSearchableValue('quote_project')) : null,
    currency: document.getElementById('f_sale_currency').value,
    notes: document.getElementById('f_quote_notes').value,
    items,
  };
}
async function createQuote() {
  const payload = buildQuotePayload();
  if (!payload) return;
  try {
    await api('/quotes', { method: 'POST', body: JSON.stringify(payload) });
    closeModal();
    toast('Presupuesto creado.');
    renderView();
  } catch (e) { toast(e.message, 'error'); }
}
async function updateQuote(id) {
  const payload = buildQuotePayload();
  if (!payload) return;
  try {
    await api(`/quotes/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
    closeModal();
    toast('Presupuesto actualizado.');
    renderView();
  } catch (e) { toast(e.message, 'error'); }
}
async function convertQuoteToSale(id) {
  await selectQuoteToLoad(id);
}

// ---------------------------------------------------------
// REMITOS DE ENVÍO (préstamo / regalo — sin precios, descuenta stock)
// ---------------------------------------------------------
async function renderShipments() {
  document.getElementById('viewActions').innerHTML = `<button class="btn btn-primary" onclick="newShipmentModal()">+ Nuevo remito de envío</button>`;
  const el = document.getElementById('view');

  const st = listState.shipments;
  const params = new URLSearchParams({ business_unit_id: state.selectedBU, page: st.page, limit: 25 });
  if (st.search) params.set('search', st.search);
  const { rows, total, limit } = await api(`/shipments/list?${params.toString()}`);

  el.innerHTML = `
    <div class="hint" style="margin-bottom:14px">Para artículos que se prestan (ej: pruebas) o se regalan. Descuenta stock igual que una venta, pero no maneja precios ni cobro.</div>
    <div class="card">
      <div class="section-toolbar">
        <div class="card-title" style="margin:0">Remitos de envío</div>
        ${listSearchToolbarHtml('shipments', 'shipmentsSearchInput', 'Buscar por cliente o número…')}
      </div>
      ${tableOrEmpty(rows, ['#', 'Cliente', 'Motivo', 'Depósito', 'Fecha', 'Estado', ''], (s) => `
      <tr>
        <td class="mono">#${s.id}</td>
        <td>${customerName(s.customer_id)}</td>
        <td>${s.reason === 'REGALO' ? 'Regalo' : 'Préstamo'}</td>
        <td>${whByBU().find(w => w.id === s.warehouse_id)?.name || '-'}</td>
        <td class="mono">${fmtDateShort(s.date)}</td>
        <td>${statusBadge(s.status)}</td>
        <td style="text-align:right;white-space:nowrap">
          <button class="btn btn-sm" onclick="showShipmentDetail(${s.id})">Detalle</button>
          ${rowActionsMenu(`shipment_${s.id}`, shipmentRowMenuItems(s))}
        </td>
      </tr>`, 'No hay remitos de envío cargados en esta unidad.', (s) => s.id)}
      ${total ? paginationControlsHtml('shipments', st.page, total, limit) : ''}
    </div>`;
  focusPreservingSearchInput('shipmentsSearchInput');
}
function shipmentsChangePage(page) { listState.shipments.page = page; renderView(); }
// "Detalle" queda visible (es la puerta de entrada, igual que en Ventas); el
// resto (Confirmar/Cancelar según estado, Remito, Eliminar) va al "⋮".
// (Roadmap Etapa 4) "Editar" solo mientras está PENDING (Confirmar mueve
// stock; el backend también lo valida).
function shipmentRowMenuItems(s) {
  const items = [];
  if (s.status === 'PENDING') items.push({ label: 'Editar', onclick: `openEditShipmentModal(${s.id})` });
  if (s.status === 'PENDING') items.push({ label: 'Confirmar', onclick: `confirmShipment(${s.id})` });
  if (s.status === 'CONFIRMED') items.push({ label: 'Cancelar', onclick: `cancelShipment(${s.id})`, danger: true });
  items.push({ label: 'Remito', onclick: `openShipmentDocumentModal(${s.id})` });
  items.push({ label: 'Eliminar', onclick: `deleteShipment(${s.id})`, danger: true });
  return items;
}
// (Roadmap Etapa 4) Antes newShipmentModal()/createShipment() solo servían
// para dar de alta. Se unificaron en shipmentModal(existing) +
// buildShipmentPayload(), mismo criterio que quoteModal() de arriba.
function shipmentModal(existing) {
  const isEdit = !!existing;
  const s = existing?.shipment;
  const contactItems = reorderWithPreferred(state.cache.customers.map(c => ({ id: c.id, label: c.name })), s?.customer_id || null);
  const whItems = whByBU().map(w => ({ id: w.id, label: w.name }));
  const projItems = [{ id: '', label: 'Sin proyecto' }, ...projByBU().map(p => ({ id: p.id, label: p.name }))];
  window._stockLookup = null;
  lineItemCount = 0;
  openModal(`
    <h2>${isEdit ? `Editar remito de envío #${s.id}` : 'Nuevo remito de envío'}</h2>
    <div class="field"><label>Cliente / destinatario</label>${searchableSelectHtml('ship_contact', contactItems, 'Buscar cliente…', isEdit ? contactItems[0]?.label : undefined)}</div>
    <div class="field-row">
      <div class="field"><label>Depósito</label>${searchableSelectHtml('ship_warehouse', reorderWithPreferred(whItems, s?.warehouse_id || null), 'Buscar depósito…', isEdit ? whItems.find(w => w.id === s.warehouse_id)?.label : undefined)}</div>
      <div class="field"><label>Proyecto (opcional)</label>${searchableSelectHtml('ship_project', reorderWithPreferred(projItems, s?.project_id || null), 'Buscar proyecto…', isEdit && s?.project_id ? projItems.find(p => p.id === s.project_id)?.label : 'Sin proyecto')}</div>
    </div>
    <div class="field"><label>Motivo</label>
      <select id="f_ship_reason">
        <option value="PRESTAMO" ${!s || s.reason === 'PRESTAMO' ? 'selected' : ''}>Préstamo (ej: pruebas)</option>
        <option value="REGALO" ${s && s.reason === 'REGALO' ? 'selected' : ''}>Regalo</option>
      </select>
    </div>
    <div class="field"><label>Artículos</label>
      <div class="line-items" id="lineItems"></div>
      <button class="btn btn-sm" onclick="addShipmentLineItem()">+ Agregar artículo</button>
    </div>
    <div class="field"><label>Observaciones (opcional)</label><input id="f_ship_notes" placeholder="Notas de este envío" value="${s ? escAttr(s.notes) : ''}"></div>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="${isEdit ? `updateShipment(${s.id})` : 'createShipment()'}">Guardar</button>
    </div>
  `);
  if (isEdit && existing.items?.length) {
    existing.items.forEach(item => addExistingShipmentLineItem(item));
  } else {
    addShipmentLineItem();
  }
}
function newShipmentModal() { shipmentModal(null); }
async function openEditShipmentModal(id) {
  try {
    const full = await api(`/shipments/${id}/full`);
    if (full.shipment.status !== 'PENDING') { toast('Solo se puede editar un remito pendiente.', 'error'); return; }
    shipmentModal(full);
  } catch (e) { toast(e.message, 'error'); }
}
function addExistingShipmentLineItem(item) {
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
    <input type="number" step="0.001" id="qty_${id}" value="${item.quantity}" onchange="checkShipmentLineStock(${id})">
    <button class="remove-line" onclick="document.getElementById('line_${id}').remove();">×</button>
  `;
  container.appendChild(row);
}
function addShipmentLineItem() {
  const id = lineItemCount++;
  const container = document.getElementById('lineItems');
  const row = document.createElement('div');
  row.className = 'line-item-row';
  row.id = `line_${id}`;
  row.innerHTML = `
    <div class="article-search-wrap">
      <input type="text" class="article-search-input" id="artsearch_${id}" placeholder="Buscar por código, código alt. o nombre…"
             autocomplete="off" oninput="filterShipmentArticleOptions(${id})" onfocus="filterShipmentArticleOptions(${id})" onkeydown="articleSearchKeydown(event, ${id})">
      <input type="hidden" id="artid_${id}">
      <div class="article-search-results" id="artresults_${id}"></div>
    </div>
    <input type="number" step="0.001" placeholder="Cant." id="qty_${id}" value="1" onchange="checkShipmentLineStock(${id})">
    <button class="remove-line" onclick="document.getElementById('line_${id}').remove();">×</button>
  `;
  container.appendChild(row);
  document.getElementById(`artsearch_${id}`)?.focus();
}
async function selectShipmentArticleOption(id, articleId) {
  const article = artByBU().find(a => a.article_id === articleId);
  if (!article) return;
  document.getElementById(`artsearch_${id}`).value = `${article.code} — ${article.description}`;
  document.getElementById(`artid_${id}`).value = articleId;
  document.getElementById(`line_${id}`).dataset.articleId = articleId;
  document.getElementById(`artresults_${id}`).style.display = 'none';
  await checkShipmentLineStock(id);
}
async function checkShipmentLineStock(id) {
  const articleId = Number(document.getElementById(`artid_${id}`)?.value);
  const qty = Number(document.getElementById(`qty_${id}`)?.value);
  const warehouseId = Number(getSearchableValue('ship_warehouse'));
  if (!articleId || !warehouseId || !(qty > 0)) return;

  const available = await getStockQty(articleId, warehouseId);
  if (available == null || qty <= available) return;

  const article = artByBU().find(a => a.article_id === articleId);
  const ok = await showStockWarning(
    `El artículo <strong>${article ? article.code + ' — ' + article.description : ''}</strong> no tiene stock suficiente en este depósito.<br>Disponible: <strong>${fmtQty(available)}</strong> — Estás cargando: <strong>${fmtQty(qty)}</strong>.<br><br>Si continuás, el stock de este artículo va a quedar en negativo.`
  );
  if (!ok) {
    document.getElementById(`qty_${id}`).value = available > 0 ? available : '';
  }
}
function buildShipmentPayload() {
  const rows = [...document.getElementById('lineItems').children];
  const items = rows.map(row => {
    const idMatch = row.id.replace('line_', '');
    return {
      article_id: Number(document.getElementById(`artid_${idMatch}`).value),
      quantity: Number(document.getElementById(`qty_${idMatch}`).value),
    };
  }).filter(i => i.article_id);
  if (!items.length) { toast('Agregá al menos un artículo.', 'error'); return null; }
  return {
    business_unit_id: state.selectedBU,
    customer_id: Number(getSearchableValue('ship_contact')),
    warehouse_id: Number(getSearchableValue('ship_warehouse')),
    project_id: getSearchableValue('ship_project') ? Number(getSearchableValue('ship_project')) : null,
    reason: document.getElementById('f_ship_reason').value,
    notes: document.getElementById('f_ship_notes').value,
    items,
  };
}
async function createShipment() {
  const payload = buildShipmentPayload();
  if (!payload) return;
  try {
    await api('/shipments', { method: 'POST', body: JSON.stringify(payload) });
    closeModal();
    toast('Remito de envío creado.');
    renderView();
  } catch (e) { toast(e.message, 'error'); }
}
async function updateShipment(id) {
  const payload = buildShipmentPayload();
  if (!payload) return;
  try {
    await api(`/shipments/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
    closeModal();
    toast('Remito de envío actualizado.');
    renderView();
  } catch (e) { toast(e.message, 'error'); }
}
async function showShipmentDetail(id) {
  const items = await api(`/shipments/${id}/items`);
  openModal(`
    <h2>Detalle — Remito de envío #${id}</h2>
    ${tableOrEmpty(items, ['Código', 'Artículo', 'Cantidad'], (i) => `
      <tr><td class="mono">${i.code}</td><td>${i.description}</td><td class="num">${fmtQty(i.quantity)}</td></tr>`, 'Sin artículos.')}
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cerrar</button>
      <button class="btn" onclick="openShipmentDocumentModal(${id})">Remito</button>
    </div>
  `);
}
async function confirmShipment(id) {
  try {
    await api(`/shipments/${id}/confirm`, { method: 'POST' });
    toast('Remito confirmado. Stock actualizado.');
    renderView();
  } catch (e) { toast(e.message, 'error'); }
}
async function cancelShipment(id) {
  if (!confirm('¿Confirmás cancelar este remito? El stock vuelve a sumarse.')) return;
  try {
    await api(`/shipments/${id}/cancel`, { method: 'POST' });
    toast('Remito cancelado.');
    renderView();
  } catch (e) { toast(e.message, 'error'); }
}
async function deleteShipment(id) {
  if (!confirm(`¿Eliminar el remito #${id}? Si está confirmado, primero hay que cancelarlo.`)) return;
  try {
    await api(`/shipments/${id}`, { method: 'DELETE' });
    toast('Eliminado correctamente.');
    renderView();
  } catch (e) { toast(e.message, 'error'); }
}
function openShipmentDocumentModal(id) {
  openModal(`
    <h2>Datos de entrega — Remito #${id}</h2>
    <div class="field"><label>Transportista (opcional)</label><input id="f_ship_carrier" placeholder="Ej: transporte propio…"></div>
    <div class="field"><label>Lugar de entrega (opcional)</label><input id="f_ship_delivery_address" placeholder="Se usa la dirección del cliente si lo dejás vacío"></div>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="submitShipmentDocument(${id})">Generar remito</button>
    </div>
  `);
}
async function submitShipmentDocument(id) {
  try {
    await api(`/shipments/${id}/transport`, {
      method: 'PUT',
      body: JSON.stringify({
        carrier: document.getElementById('f_ship_carrier').value,
        delivery_address: document.getElementById('f_ship_delivery_address').value,
      }),
    });
    const data = await api(`/shipments/${id}/full`);
    const html = buildShipmentDocumentHtml(data);
    const win = window.open('', '_blank');
    win.document.write(html);
    win.document.close();
    closeModal();
  } catch (e) { toast(e.message, 'error'); }
}
function buildShipmentDocumentHtml({ shipment, customer, business_unit, warehouse, items }) {
  const logo = buLogoPath(business_unit.name);
  const number = docNumber(shipment.id);
  const dateStr = fmtDate(shipment.date);
  const reasonLabel = shipment.reason === 'REGALO' ? 'Regalo' : 'Préstamo';

  const itemsRows = items.map(i => `
    <tr>
      <td class="mono">${i.code}</td>
      <td>${i.description}</td>
      <td class="num">${fmtQty(i.quantity)}</td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Remito de envío — ${business_unit.name} #${number}</title>
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
  .transport-box { border: 1px solid #ddd; border-radius: 6px; padding: 14px 16px; margin-bottom: 28px; }
  .signature-area { display: flex; justify-content: space-between; margin-top: 60px; }
  .signature-line { border-top: 1px solid #333; width: 220px; text-align: center; font-size: 11px; color: #666; padding-top: 6px; }
  .footer-note { font-size: 10.5px; color: #999; text-align: center; margin-top: 40px; border-top: 1px solid #eee; padding-top: 12px; }
  .actions { max-width: 760px; margin: 0 auto 20px; display: flex; gap: 10px; padding: 0 10px; }
  .actions button, .actions a { font-family: inherit; font-size: 13px; padding: 9px 16px; border-radius: 7px; border: 1px solid #ccc; background: #fff; cursor: pointer; text-decoration: none; color: #1a1a1a; }
  @media print { .actions { display: none; } body { font-size: 12.5px; } }
</style>
</head>
<body>
  <div class="actions no-print">
    <button onclick="window.print()">${svgIcon('print')} Imprimir / Guardar PDF</button>
    ${customer.phone ? `<a href="${waLink(customer.phone, `Hola ${customer.name}, te comparto el remito #${number} de ${business_unit.name}.`)}" target="_blank">${svgIcon('whatsapp')} Enviar por WhatsApp</a>` : ''}
    ${customer.email ? `<a href="mailto:${customer.email}?subject=${encodeURIComponent(`Remito de envío #${number} — ${business_unit.name}`)}&body=${encodeURIComponent(`Hola ${customer.name},\n\nTe compartimos el remito de envío #${number} (${reasonLabel}).\nAdjuntá el PDF generado con el botón "Imprimir / Guardar PDF" antes de enviar este correo.\n\nSaludos.`)}">${svgIcon('mail')} Enviar por email</a>` : ''}
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
        <div class="doc-title">REMITO DE ENVÍO</div>
        <div class="doc-number">N° ${number}</div>
        <div class="doc-date">${dateStr}</div>
      </div>
    </div>

    <div class="info-grid">
      <div class="info-box">
        <div class="section-title">Destinatario</div>
        <div class="info-row"><strong>${customer.name}</strong></div>
        ${customer.tax_id ? `<div class="info-row">CUIT/Tax ID: ${customer.tax_id}</div>` : ''}
        <div class="info-row">${formatCustomerAddress(customer) || '—'}</div>
        ${customer.phone ? `<div class="info-row">Tel: ${customer.phone}</div>` : ''}
      </div>
      <div class="info-box">
        <div class="section-title">Detalle del envío</div>
        <div class="info-row"><strong>Motivo:</strong> ${reasonLabel}</div>
        <div class="info-row">Depósito de origen: ${warehouse?.name || '-'}</div>
      </div>
    </div>

    <table class="items">
      <thead><tr><th>Código</th><th>Descripción</th><th style="text-align:right">Cantidad</th></tr></thead>
      <tbody>${itemsRows}</tbody>
    </table>

    <div class="transport-box">
      <div class="section-title">Lugar de entrega</div>
      <div class="info-row">${shipment.delivery_address || formatCustomerAddress(customer) || '—'}</div>
    </div>
    <div class="transport-box">
      <div class="section-title">Transporte</div>
      <div class="info-row"><strong>Transportista:</strong> ${shipment.carrier || '—'}</div>
      ${shipment.notes ? `<div class="info-row"><strong>Observaciones:</strong> ${shipment.notes}</div>` : ''}
    </div>
    <div class="signature-area">
      <div class="signature-line">Firma transportista</div>
      <div class="signature-line">Recibí conforme — Aclaración y DNI</div>
    </div>

    <div class="footer-note">${business_unit.name} — You One Racing S.A.S. · Este documento no representa una operación de venta (${reasonLabel}) · Generado el ${fmtDate(new Date().toISOString())}</div>
  </div>
  <script>window.addEventListener('load', () => { window.print(); });</script>
</body>
</html>`;
}

let salesSubTab = 'sales';
let salesPage = 1;
let salesDateFrom = '';
let salesDateTo = '';

async function renderSales() {
  document.getElementById('viewActions').innerHTML = salesSubTab === 'sales'
    ? `<button class="btn btn-primary" onclick="newOperationModal('sale')" title="Atajo: N">+ Nueva venta</button>`
    : '';
  const el = document.getElementById('view');

  const [pending, verifyPending] = await Promise.all([
    api('/sales/pending-collection'), api('/sale-collections/pending'),
  ]);
  const pendingBU = pending.filter(s => s.business_unit_id === state.selectedBU && s.collection_status !== 'COBRADO');
  const verifyBU = verifyPending.filter(p => p.business_unit_id === state.selectedBU);
  // Desde el Bloque 9, esta lista trae dos cosas distintas (ver /sale-collections/pending):
  // lo que realmente sigue en dos etapas (sin verificar todavía) y los cobros
  // ya confirmados que igual se pueden convertir a USD. El número en la
  // pestaña solo cuenta lo primero, para no mostrar una alarma que en
  // realidad no requiere ninguna acción urgente.
  const verifyTrulyPending = verifyBU.filter(p => !p.verified);
  const verifyConvertible = verifyBU.filter(p => p.verified);

  const tabsHtml = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px">
      <div style="display:flex;gap:8px">
        <button class="btn btn-sm ${salesSubTab === 'sales' ? 'btn-primary' : ''}" onclick="switchSalesTab('sales')">Ventas</button>
        <button class="btn btn-sm ${salesSubTab === 'collect' ? 'btn-primary' : ''}" onclick="switchSalesTab('collect')">Procesar cobro ${pendingBU.length ? `(${pendingBU.length})` : ''}</button>
        <button class="btn btn-sm ${salesSubTab === 'verify' ? 'btn-primary' : ''}" onclick="switchSalesTab('verify')">Verificar cobros ${verifyTrulyPending.length ? `(${verifyTrulyPending.length})` : ''}</button>
      </div>
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
    const collections = await api(`/sale-collections/by-business-unit/${state.selectedBU}`);
    const collectionsBySale = {};
    collections.forEach(c => {
      if (!collectionsBySale[c.sale_id]) collectionsBySale[c.sale_id] = [];
      collectionsBySale[c.sale_id].push(c);
    });
    el.innerHTML = tabsHtml + `
      <div class="card">
        <div class="card-title">Facturas pendientes de procesar (sin cobrar o cuenta corriente)</div>
        ${tableOrEmpty(pendingBU, ['#', 'Cliente', 'CUIT', 'Fecha', 'Caja/Sobre', 'Total', 'Cobrado', 'Pendiente', 'Estado', '', 'Documentos'], (s) => `
          <tr>
            <td class="mono">#${s.id}</td>
            <td>${customerName(s.customer_id)}</td>
            <td class="mono">${customerTaxId(s.customer_id)}</td>
            <td class="mono">${fmtDate(s.date)}</td>
            <td>${saleCashBoxDisplay(s, collectionsBySale[s.id])}</td>
            <td class="num">$ ${fmtMoney(s.total_amount)}</td>
            <td class="num income">$ ${fmtMoney(s.settled_amount)}</td>
            <td class="num expense">$ ${fmtMoney(s.remaining_amount)}</td>
            <td>${collectionBadge(s.collection_status)}</td>
            <td>
              <button class="btn btn-sm" onclick="showSaleDetail(${s.id})">Detalle</button>
              <button class="btn btn-sm btn-primary" onclick="openCollectModal(${s.id}, ${s.remaining_amount})">Procesar cobro</button>
            </td>
            <td style="white-space:nowrap">
              <button class="btn btn-sm" onclick="openComprobanteModal(${s.id})">Comprobante</button>
              <button class="btn btn-sm" onclick="openRemitoModal(${s.id})">Remito</button>
            </td>
          </tr>`, 'No hay facturas pendientes de procesar en esta unidad.')}
      </div>
      <div class="card">
        <div class="card-title">Cobros confirmados — todavía se pueden convertir a USD</div>
        <div class="hint" style="margin-bottom:14px">Ya impactaron en el saldo de su caja/sobre. Quedan acá disponibles por si alguno necesita convertirse a dólares; no hace falta ninguna acción si no.</div>
        ${tableOrEmpty(verifyConvertible, ['Fecha', 'Venta', 'Cliente', 'Caja / Sobre', 'Monto', ''], (p) => `
          <tr>
            <td class="mono">${fmtDate(p.created_at)}</td>
            <td class="mono">#${p.sale_id}</td>
            <td>${p.customer_name}</td>
            <td>${p.cash_box_name}</td>
            <td class="num income">$ ${fmtMoney(p.amount)}</td>
            <td><button class="btn btn-sm" onclick="openBankConversionModal(${p.id}, ${p.sale_id}, ${p.amount})">Convertir a USD</button></td>
          </tr>`, 'No hay cobros confirmados pendientes de convertir.')}
      </div>`;
    return;
  }

  if (salesSubTab === 'verify') {
    const totalPending = verifyTrulyPending.reduce((a, p) => a + Number(p.amount), 0);
    el.innerHTML = tabsHtml + `
      <div class="kpi-row">
        <div class="kpi"><div class="kpi-label">Cobros esperando verificación</div><div class="kpi-value">${verifyTrulyPending.length}</div></div>
        <div class="kpi"><div class="kpi-label">Monto total pendiente</div><div class="kpi-value expense">$ ${fmtMoney(totalPending)}</div></div>
      </div>
      <div class="card">
        <div class="card-title">Pendientes de confirmar</div>
        <div class="hint" style="margin-bottom:14px">Los dólares de una conversión bancaria en curso siguen pidiendo esta confirmación aparte. Hasta que se verifique, no afectan el saldo de esa caja.</div>
        ${tableOrEmpty(verifyTrulyPending, ['Fecha', 'Venta', 'Cliente', 'Movimiento', 'Caja / Sobre', 'Monto', ''], (p) => `
          <tr ${daysSince(p.created_at) >= 2 ? 'style="background:#FFF3E0"' : ''}>
            <td class="mono">${fmtDate(p.created_at)}${daysSince(p.created_at) >= 2 ? ` <span style="color:#C9820A;font-weight:600">${svgIcon('warning')} hace ${daysSince(p.created_at)}d</span>` : ''}</td>
            <td class="mono">#${p.sale_id}</td>
            <td>${p.customer_name}</td>
            <td>${p.direction === 'OUT' ? '<span class="hint">↑ Egreso</span>' : '<span class="hint">↓ Ingreso</span>'}</td>
            <td>${p.cash_box_name}</td>
            <td class="num ${p.direction === 'OUT' ? 'expense' : 'income'}">${p.cash_box_currency === 'USD' ? 'US$' : '$'} ${fmtMoney(p.amount)}</td>
            <td>
              <button class="btn btn-sm btn-primary" onclick="verifySaleCollection(${p.id})">Confirmar movimiento físico</button>
              ${p.direction !== 'OUT' && p.cash_box_currency !== 'USD' ? `<button class="btn btn-sm" onclick="openBankConversionModal(${p.id}, ${p.sale_id}, ${p.amount})">Convertir a USD</button>` : ''}
              <button class="btn btn-sm btn-danger" onclick="rejectSaleCollection(${p.id})">Rechazar</button>
            </td>
          </tr>`, 'No hay cobros esperando verificación.')}
      </div>`;
    return;
  }

  const params = new URLSearchParams({ business_unit_id: state.selectedBU, page: salesPage, limit: 25 });
  if (salesDateFrom) params.set('date_from', salesDateFrom);
  if (salesDateTo) params.set('date_to', salesDateTo);
  const [{ rows, total, limit }, collections] = await Promise.all([
    api(`/sales/list?${params.toString()}`),
    api(`/sale-collections/by-business-unit/${state.selectedBU}`),
  ]);
  const collectionsBySale = {};
  collections.forEach(c => {
    if (!collectionsBySale[c.sale_id]) collectionsBySale[c.sale_id] = [];
    collectionsBySale[c.sale_id].push(c);
  });

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
      ${tableOrEmpty(rows, ['#', 'Cliente', 'Fecha', 'Estado', 'Cobro', 'Total', ''], (s) => `
        <tr>
          <td class="mono">#${s.id}</td>
          <td>
            <div class="two-line-main">${customerName(s.customer_id)}</div>
            <div class="two-line-sub mono">${customerTaxId(s.customer_id)}</div>
          </td>
          <td class="mono">${fmtDateShort(s.date)}</td>
          <td>${statusBadge(s.status)}</td>
          <td>
            <div class="two-line-main">${paymentTypeLabel(s.payment_type)}</div>
            <div class="two-line-sub">${saleCashBoxDisplay(s, collectionsBySale[s.id])}</div>
          </td>
          <td class="num income">${s.currency === 'USD' ? 'US$' : '$'} ${fmtMoney(s.total_amount)}</td>
          <td style="text-align:right;white-space:nowrap">
            <button class="btn btn-sm" onclick="showSaleDetail(${s.id})">Detalle</button>
            ${rowActionsMenu(`sale_${s.id}`, saleRowMenuItems(s))}
          </td>
        </tr>`, 'No hay ventas registradas en esta unidad.', (s) => s.id)}
      ${total ? paginationControlsHtml('sales', salesPage, total, limit) : ''}
    </div>
  `;
}
function saleCashBoxDisplay(sale, collections) {
  if (collections && collections.length) {
    return collections.map(c => `${c.cash_box_name} <span class="hint">(${c.kind === 'SOBRE' ? 'Sobre' : 'Caja'}${c.direction === 'OUT' ? ' · egreso USD' : ''}${c.verified ? '' : ' · sin verificar'})</span>`).join('<br>');
  }
  if (sale.cash_box_id) {
    const box = state.cache.cashBoxes.find(b => b.id === sale.cash_box_id);
    return box ? `${box.name} <span class="hint">(a procesar)</span>` : '—';
  }
  return '<span style="color:var(--muted)">—</span>';
}
// Todo lo que antes eran botones sueltos (opActions + Comprobante + Remito +
// Eliminar) agrupado para el menú "⋮" de la fila (etapa de mejora visual).
// "Detalle" queda afuera, como botón siempre visible, por ser la acción más
// usada y la puerta de entrada al resto de la información de la venta.
function saleRowMenuItems(s) {
  return [
    ...opActionsItems('sales', s),
    { label: 'Comprobante', onclick: `openComprobanteModal(${s.id})` },
    { label: 'Remito', onclick: `openRemitoModal(${s.id})` },
    { label: 'Eliminar', onclick: `deleteOperation('sales', ${s.id})`, danger: true },
  ];
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
function cashBoxName(id) {
  if (!id) return '<span style="color:var(--muted)">—</span>';
  const box = state.cache.cashBoxes.find(b => b.id === id);
  return box ? `${box.name} <span class="hint">(${box.kind === 'SOBRE' ? 'Sobre' : 'Caja'})</span>` : '—';
}

function paymentTypeLabel(t) {
  return { CASH: 'Contado', ACCOUNT: 'Cta. Cte.', UNCOLLECTED: 'Sin cobrar' }[t] || t;
}
function collectionBadge(status) {
  const map = { PENDIENTE: 'pending', PARCIAL: 'pending', COBRADO: 'confirmed' };
  return `<span class="badge badge-${map[status] || 'pending'}">${status}</span>`;
}

async function openCollectModal(saleId, remaining) {
  const boxItems = state.cache.cashBoxes.map(b => ({ id: b.id, label: `${b.name} (${b.currency})` }));
  const projItems = [{ id: '', label: 'Sin proyecto' }, ...projByBU().map(p => ({ id: p.id, label: p.name }))];
  let defaultBoxId = null;
  try {
    const { sale } = await api(`/sales/${saleId}/full`);
    defaultBoxId = sale.cash_box_id;
  } catch (e) { /* seguimos sin default */ }

  openModal(`
    <h2>Procesar cobro — Venta #${saleId}</h2>
    <div class="hint" style="margin-bottom:14px">Saldo pendiente: <strong>$ ${fmtMoney(remaining)}</strong>. Repartí el monto cobrado entre una o más cajas.</div>
    ${defaultBoxId ? `<div class="hint" style="margin-bottom:14px">Esta venta se registró para ir a <strong>${state.cache.cashBoxes.find(b => b.id === defaultBoxId)?.name || ''}</strong>. Ya viene precargada abajo; podés cambiarla si hace falta.</div>` : ''}
    <div class="line-items" id="collectSplits"></div>
    <button class="btn btn-sm" onclick="addCollectSplit()">+ Agregar caja</button>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="submitCollect(${saleId})">Confirmar cobro</button>
    </div>
  `);
  window._collectBoxItems = boxItems;
  window._collectProjItems = projItems;
  addCollectSplit(defaultBoxId, remaining);
}
let collectSplitCount = 0;
function addCollectSplit(defaultBoxId, defaultAmount) {
  const id = collectSplitCount++;
  const container = document.getElementById('collectSplits');
  const row = document.createElement('div');
  row.className = 'line-item-row';
  row.id = `csplit_${id}`;
  row.innerHTML = `
    ${searchableSelectHtml(`cbox_${id}`, window._collectBoxItems, 'Buscar caja…')}
    <input type="text" inputmode="decimal" placeholder="Monto" id="camount_${id}" value="${defaultAmount != null ? formatMoneyFieldValue(defaultAmount) : ''}" onfocus="unformatMoneyField(this)" onblur="formatMoneyField(this)">
    ${searchableSelectHtml(`cproj_${id}`, window._collectProjItems, 'Buscar proyecto…', 'Sin proyecto')}
    <button class="remove-line" onclick="document.getElementById('csplit_${id}').remove()">×</button>
  `;
  container.appendChild(row);
  if (defaultBoxId) selectSearchableOption(`cbox_${id}`, defaultBoxId);
}
async function submitCollect(saleId) {
  const rows = [...document.getElementById('collectSplits').children];
  const splits = rows.map(row => {
    const idx = row.id.replace('csplit_', '');
    return {
      cash_box_id: Number(getSearchableValue(`cbox_${idx}`)),
      amount: parseMoneyInput(document.getElementById(`camount_${idx}`).value),
      project_id: getSearchableValue(`cproj_${idx}`) ? Number(getSearchableValue(`cproj_${idx}`)) : null,
    };
  }).filter(s => s.amount > 0);

  if (!splits.length) { toast('Agregá al menos un monto.', 'error'); return; }
  try {
    await api(`/sales/${saleId}/collect`, { method: 'POST', body: JSON.stringify({ splits }) });
    closeModal();
    toast('Cobro registrado. Ya impacta en el saldo de la caja/sobre.');
    renderView();
  } catch (e) { toast(e.message, 'error'); }
}

// ---------------------------------------------------------
// CONVERSIÓN BANCARIA (paso opcional entre Procesar cobro y Verificar cobro):
// el cliente pagó por transferencia a un banco, en pesos, un cobro que ya se
// había registrado con "Procesar cobro" y todavía no se verificó. Ese cobro
// en pesos se da de baja (nunca llega físicamente a esa caja/sobre) y en su
// lugar la empresa entrega dólares físicos, que sí siguen el camino normal
// de "Verificar cobros".
// ---------------------------------------------------------
async function openBankConversionModal(collectionId, saleId, amountArs) {
  const usdBoxItems = state.cache.cashBoxes.filter(b => b.currency === 'USD').map(b => ({ id: b.id, label: b.name }));
  const projItems = [{ id: '', label: 'Sin proyecto' }, ...projByBU().map(p => ({ id: p.id, label: p.name }))];
  window._bankConvBoxItems = usdBoxItems;
  window._bankConvProjItems = projItems;

  openModal(`
    <h2>Conversión bancaria — Venta #${saleId}</h2>
    <div class="hint" style="margin-bottom:14px">
      Este cobro (<strong>$ ${fmtMoney(amountArs)}</strong>) se pagó por transferencia a un banco, en vez de entrar físicamente
      a la caja/sobre con la que se registró. Ese cobro en pesos se da de baja. A cambio, la empresa entrega dólares físicos:
      elegí de qué sobre/caja salen y entre cuáles se reparten.
    </div>
    <div class="form-row">
      <label>Banco</label>
      <input type="text" id="bcBank" value="Banco Macro">
    </div>
    <div class="form-row">
      <label>Equivalente en USD (monto final decidido, sin calcular tipo de cambio)</label>
      <input type="text" inputmode="decimal" id="bcUsd" placeholder="Ej: 14200" onfocus="unformatMoneyField(this)" onblur="formatMoneyField(this)">
    </div>
    <div class="form-row">
      <label>Notas (opcional)</label>
      <input type="text" id="bcNotes" placeholder="Referencia, comprobante, etc.">
    </div>
    <div class="form-row">
      <label>Sobre/caja de origen — de dónde salen los dólares</label>
      ${searchableSelectHtml('bcOrigin', window._bankConvBoxItems, 'Buscar caja en USD…')}
    </div>
    <div class="card-title" style="margin-top:16px">Distribuir esos dólares entre sobres/cajas destino</div>
    <div class="line-items" id="bcSplits"></div>
    <button class="btn btn-sm" onclick="addBankConvSplit()">+ Agregar caja</button>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="submitBankConversion(${collectionId})">Confirmar conversión</button>
    </div>
  `);
  addBankConvSplit();
}
let bcSplitCount = 0;
function addBankConvSplit() {
  const id = bcSplitCount++;
  const container = document.getElementById('bcSplits');
  const row = document.createElement('div');
  row.className = 'line-item-row';
  row.id = `bcsplit_${id}`;
  row.innerHTML = `
    ${searchableSelectHtml(`bcbox_${id}`, window._bankConvBoxItems, 'Buscar caja en USD…')}
    <input type="text" inputmode="decimal" placeholder="Monto USD" id="bcamount_${id}" onfocus="unformatMoneyField(this)" onblur="formatMoneyField(this)">
    ${searchableSelectHtml(`bcproj_${id}`, window._bankConvProjItems, 'Buscar proyecto…', 'Sin proyecto')}
    <button class="remove-line" onclick="document.getElementById('bcsplit_${id}').remove()">×</button>
  `;
  container.appendChild(row);
}
async function submitBankConversion(collectionId) {
  const bank_name = document.getElementById('bcBank').value.trim();
  const usd_equivalent = parseMoneyInput(document.getElementById('bcUsd').value);
  const notes = document.getElementById('bcNotes').value.trim();
  const origin_cash_box_id = Number(getSearchableValue('bcOrigin'));

  const rows = [...document.getElementById('bcSplits').children];
  const destination_splits = rows.map(row => {
    const idx = row.id.replace('bcsplit_', '');
    return {
      cash_box_id: Number(getSearchableValue(`bcbox_${idx}`)),
      amount: parseMoneyInput(document.getElementById(`bcamount_${idx}`).value),
      project_id: getSearchableValue(`bcproj_${idx}`) ? Number(getSearchableValue(`bcproj_${idx}`)) : null,
    };
  }).filter(s => s.amount > 0);

  if (!bank_name) { toast('Indicá el banco.', 'error'); return; }
  if (!usd_equivalent || usd_equivalent <= 0) { toast('Indicá el equivalente en dólares.', 'error'); return; }
  if (!origin_cash_box_id) { toast('Elegí la caja/sobre de origen.', 'error'); return; }
  if (!destination_splits.length) { toast('Agregá al menos una caja/sobre destino.', 'error'); return; }
  if (!(await verifyPasswordPrompt('convertir este cobro a dólares', true))) return;

  try {
    await api(`/sale-collections/${collectionId}/convert-to-usd`, {
      method: 'POST',
      body: JSON.stringify({ bank_name, usd_equivalent, notes, origin_cash_box_id, destination_splits }),
    });
    closeModal();
    toast('Conversión registrada. Los movimientos en dólares quedan pendientes en "Verificar cobros".');
    renderView();
  } catch (e) { toast(e.message, 'error'); }
}

// Lista de acciones según el estado, sin el HTML del botón — la usan tanto
// opActions() (Compras, sin cambios de layout todavía) como el menú "⋮"
// compacto de Ventas (etapa de mejora visual), para no repetir la lógica de
// qué acción corresponde a cada estado en dos lugares distintos.
function opActionsItems(kind, op) {
  if (op.status === 'PENDING') {
    return [
      { label: 'Confirmar', onclick: `confirmOperation('${kind}', ${op.id})` },
      { label: 'Editar', onclick: `openEditOperationModal('${kind}', ${op.id})` },
      { label: 'Cancelar', onclick: `cancelOperation('${kind}', ${op.id})`, danger: true },
    ];
  }
  if (op.status === 'CONFIRMED') {
    return [
      { label: 'Notas / Proyecto', onclick: `openNotesProjectModal('${kind}', ${op.id})` },
      { label: 'Cancelar y recrear', onclick: `cancelAndRecreateOperation('${kind}', ${op.id})` },
      { label: 'Cancelar', onclick: `cancelOperation('${kind}', ${op.id})`, danger: true },
    ];
  }
  if (op.status === 'CANCELLED') {
    return [{ label: 'Notas / Proyecto', onclick: `openNotesProjectModal('${kind}', ${op.id})` }];
  }
  return [];
}
// Sin cambios de comportamiento: sigue devolviendo los mismos botones sueltos
// de siempre (hoy los usa Compras). Ventas ya no la llama — ver rowActionsMenu.
function opActions(kind, op) {
  return opActionsItems(kind, op)
    .map(it => `<button class="btn btn-sm${it.danger ? ' btn-danger' : ''}" onclick="${it.onclick}">${it.label}</button>`)
    .join(' ');
}

// Menú "⋮" genérico de acciones por fila (etapa de mejora visual). `items`:
// [{ label, onclick, danger }]. Reutilizable por cualquier listado, no solo
// Ventas — pensado para aplicar el mismo criterio al resto del ERP después.
function rowActionsMenu(rowId, items) {
  if (!items.length) return '';
  const menuId = `rowmenu_${rowId}`;
  return `
    <div class="row-menu-wrap">
      <button class="btn btn-sm row-menu-trigger" onclick="toggleRowMenu('${menuId}', event)" aria-label="Más acciones">⋮</button>
      <div class="row-menu" id="${menuId}">
        ${items.map(it => `<button class="row-menu-item${it.danger ? ' danger' : ''}" onclick="closeAllRowMenus(); ${it.onclick}">${it.label}</button>`).join('')}
      </div>
    </div>`;
}
function toggleRowMenu(menuId, event) {
  event.stopPropagation();
  const menu = document.getElementById(menuId);
  const wasOpen = menu.classList.contains('show');
  closeAllRowMenus();
  if (!wasOpen) menu.classList.add('show');
}
function closeAllRowMenus() {
  document.querySelectorAll('.row-menu.show').forEach(m => m.classList.remove('show'));
}

// Bloque 3: Observaciones y Proyecto se pueden editar en cualquier estado
// (a diferencia del resto de campos, que solo se editan mientras PENDING —
// ver openEditOperationModal). Reusa /sales|purchases/:id/full (Bloque 2)
// para precargar en vez de embeber texto libre en el atributo onclick.
async function openNotesProjectModal(kind, id) {
  const isPurchase = kind === 'purchases';
  try {
    const full = await api(`/${kind}/${id}/full`);
    const op = isPurchase ? full.purchase : full.sale;
    const projItemsBase = [{ id: '', label: 'Sin proyecto' }, ...projByBU().map(p => ({ id: p.id, label: p.name }))];
    const projItems = op.project_id ? reorderWithPreferred(projItemsBase, op.project_id) : projItemsBase;
    openModal(`
      <h2>Notas y proyecto — ${isPurchase ? 'Compra' : 'Venta'} #${op.id}</h2>
      <div class="hint" style="margin-bottom:14px">Estos dos campos se pueden editar en cualquier estado, a diferencia del resto (solo mientras está pendiente). Cambiar el proyecto no reetiqueta retroactivamente los movimientos de stock/caja ya generados con el proyecto anterior.</div>
      <div class="field"><label>Proyecto</label>${searchableSelectHtml('npProject', projItems, 'Buscar proyecto…', projItems[0]?.label || 'Sin proyecto')}</div>
      <div class="field"><label>Observaciones</label><textarea id="npNotes" rows="3" style="width:100%">${escAttr(op.notes)}</textarea></div>
      <div class="modal-actions">
        <button class="btn" onclick="closeModal()">Cancelar</button>
        <button class="btn btn-primary" onclick="submitNotesProject('${kind}', ${op.id})">Guardar</button>
      </div>
    `);
  } catch (e) { toast(e.message, 'error'); }
}
async function submitNotesProject(kind, id) {
  const project_id = getSearchableValue('npProject') ? Number(getSearchableValue('npProject')) : null;
  const notes = document.getElementById('npNotes').value || null;
  try {
    await api(`/${kind}/${id}/notes-project`, { method: 'PUT', body: JSON.stringify({ project_id, notes }) });
    closeModal();
    toast('Notas y proyecto actualizados.');
    renderView();
  } catch (e) { toast(e.message, 'error'); }
}
function openEditDateModal(kind, id, currentDate) {
  openModal(`
    <h2>Editar fecha</h2>
    <div class="hint" style="margin-bottom:14px">Solo se puede cambiar mientras la operación esté pendiente. Una vez confirmada, la fecha queda fija.</div>
    <div class="field"><label>Fecha</label>
      <input type="date" id="editDateInput" value="${currentDate}">
    </div>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="submitEditDate('${kind}', ${id})">Guardar</button>
    </div>
  `);
}
async function submitEditDate(kind, id) {
  const date = document.getElementById('editDateInput').value;
  if (!date) { toast('Elegí una fecha.', 'error'); return; }
  try {
    await api(`/${kind}/${id}/date`, { method: 'PUT', body: JSON.stringify({ date }) });
    closeModal();
    toast('Fecha actualizada.');
    renderView();
  } catch (e) { toast(e.message, 'error'); }
}
async function confirmOperation(kind, id) {
  try {
    await api(`/${kind}/${id}/confirm`, { method: 'POST' });
    toast('Operación confirmada. Stock y caja actualizados.');
    window._flashKey = id;
    renderView();
  } catch (e) { toast(e.message, 'error'); }
}
async function cancelOperation(kind, id) {
  if (!confirm('¿Confirmás cancelar esta operación?')) return;
  try {
    await api(`/${kind}/${id}/cancel`, { method: 'POST' });
    toast('Operación cancelada.');
    window._flashKey = id;
    renderView();
  } catch (e) { toast(e.message, 'error'); }
}

// Bloque 4: para una CONFIRMADA que salió mal, evita cancelar y volver a
// tipear todo de cero. Trae los datos actuales ANTES de cancelar (para no
// perderlos), cancela (misma lógica que "Cancelar", revierte stock/caja/
// cta-cte con trazabilidad vía los triggers de siempre) y abre "Nueva
// venta/compra" precargada en modo recrear (ver newOperationModal) para
// corregir lo que hacía falta y guardar como operación nueva.
async function cancelAndRecreateOperation(kind, id) {
  const isPurchase = kind === 'purchases';
  const label = isPurchase ? 'la compra' : 'la venta';
  if (!confirm(`Esto cancela ${label} #${id} (revierte stock/caja/cta-cte) y abre un formulario nuevo precargado con los mismos datos para corregir y guardar. ¿Confirmás?`)) return;
  try {
    const full = await api(`/${kind}/${id}/full`);
    await api(`/${kind}/${id}/cancel`, { method: 'POST' });
    toast('Operación cancelada. Revisá los datos y guardá para crear la corregida.');
    await renderView();
    newOperationModal(isPurchase ? 'purchase' : 'sale', full, 'recreate');
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
let debtorsFilterCustomer = null;
function setDebtorsFilter(customerId) { debtorsFilterCustomer = customerId; renderView(); }

async function renderDebtors() {
  document.getElementById('viewActions').innerHTML = '';
  const el = document.getElementById('view');
  // (Roadmap Etapa 2 — Rendimiento) Antes acá se pedía también `/sales`
  // completo (toda la historia de ventas, sin filtrar) solo para cruzar el
  // customer_id de cada factura pendiente. Era innecesario: `pending` ya trae
  // customer_id en cada fila (se ve más abajo, en la tabla de detalle, que ya
  // lo usaba directo) — se saca el pedido de más.
  const pending = await api('/sales/pending-collection');
  const pendingBU = pending.filter(s => s.business_unit_id === state.selectedBU && s.collection_status !== 'COBRADO');

  const byCustomer = {};
  pendingBU.forEach(s => {
    const custId = s.customer_id;
    if (!byCustomer[custId]) byCustomer[custId] = { customer_id: custId, sales: [], total: 0 };
    byCustomer[custId].sales.push(s);
    byCustomer[custId].total += Number(s.remaining_amount);
  });
  const groups = Object.values(byCustomer);

  const totalDebt = pendingBU.reduce((a, s) => a + Number(s.remaining_amount), 0);

  // (Roadmap Etapa 5) Filtro conectado: clic en un cliente de "Deuda por
  // cliente" filtra la tabla de detalle de abajo. `debtorsFilterCustomer` es
  // un estado de módulo simple, igual que financeSubTab/purchasesSubTab.
  const filteredPending = debtorsFilterCustomer ? pendingBU.filter(s => s.customer_id === debtorsFilterCustomer) : pendingBU;

  el.innerHTML = `
    <div class="kpi-row">
      <div class="kpi"><div class="kpi-label">Total adeudado</div><div class="kpi-value expense">$ ${fmtMoney(totalDebt)}</div></div>
      <div class="kpi"><div class="kpi-label">Clientes deudores</div><div class="kpi-value">${groups.length}</div></div>
      <div class="kpi"><div class="kpi-label">Facturas pendientes</div><div class="kpi-value">${pendingBU.length}</div></div>
    </div>

    <div class="card">
      <div class="card-title">Deuda por cliente</div>
      <div class="hint" style="margin-bottom:10px">Clic en un cliente para ver solo sus facturas abajo.</div>
      ${tableOrEmpty(groups, ['Cliente', 'Facturas', 'Deuda total', ''], (g) => `
        <tr class="${debtorsFilterCustomer === g.customer_id ? 'row-flash' : ''}">
          <td style="cursor:pointer" onclick="setDebtorsFilter(${g.customer_id})">${customerName(g.customer_id)}</td>
          <td class="mono">${g.sales.length}</td>
          <td class="num expense">$ ${fmtMoney(g.total)}</td>
          <td><button class="btn btn-sm" onclick="showContactStatement('customer', ${g.customer_id}, '${customerName(g.customer_id).replace(/'/g, "\\'")}')">Cuenta corriente</button></td>
        </tr>`, 'No hay deuda pendiente en esta unidad.')}
    </div>

    <div class="card">
      <div class="card-title">Detalle de facturas pendientes${debtorsFilterCustomer ? ` — ${customerName(debtorsFilterCustomer)} <button class="btn btn-sm" style="margin-left:8px" onclick="setDebtorsFilter(null)">Ver todas</button>` : ''}</div>
      ${tableOrEmpty(filteredPending, ['#', 'Cliente', 'CUIT', 'Fecha', 'Total', 'Cobrado', 'Pendiente', 'Estado', ''], (s) => `
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

// ---------------------------------------------------------
// A PAGAR (Roadmap Etapa 5 — simétrica a Deudores, del lado de Compras).
// Reutiliza /purchases/pending-payment, que ya existía (la misma vista que
// usa la pestaña "Procesar pago" de Compras) — sin endpoint nuevo.
// ---------------------------------------------------------
let payablesFilterSupplier = null;
function setPayablesFilter(supplierId) { payablesFilterSupplier = supplierId; renderView(); }

async function renderPayables() {
  document.getElementById('viewActions').innerHTML = '';
  const el = document.getElementById('view');
  const pending = await api('/purchases/pending-payment');
  const pendingBU = pending.filter(p => p.business_unit_id === state.selectedBU);

  const bySupplier = {};
  pendingBU.forEach(p => {
    const supId = p.supplier_id;
    if (!bySupplier[supId]) bySupplier[supId] = { supplier_id: supId, purchases: [], total: 0 };
    bySupplier[supId].purchases.push(p);
    bySupplier[supId].total += Number(p.remaining_amount);
  });
  const groups = Object.values(bySupplier);
  const totalDebt = pendingBU.reduce((a, p) => a + Number(p.remaining_amount), 0);
  const filteredPending = payablesFilterSupplier ? pendingBU.filter(p => p.supplier_id === payablesFilterSupplier) : pendingBU;

  el.innerHTML = `
    <div class="kpi-row">
      <div class="kpi"><div class="kpi-label">Total a pagar</div><div class="kpi-value expense">$ ${fmtMoney(totalDebt)}</div></div>
      <div class="kpi"><div class="kpi-label">Proveedores</div><div class="kpi-value">${groups.length}</div></div>
      <div class="kpi"><div class="kpi-label">Compras pendientes</div><div class="kpi-value">${pendingBU.length}</div></div>
    </div>

    <div class="card">
      <div class="card-title">Deuda por proveedor</div>
      <div class="hint" style="margin-bottom:10px">Clic en un proveedor para ver solo sus compras abajo.</div>
      ${tableOrEmpty(groups, ['Proveedor', 'Compras', 'Deuda total', ''], (g) => `
        <tr class="${payablesFilterSupplier === g.supplier_id ? 'row-flash' : ''}">
          <td style="cursor:pointer" onclick="setPayablesFilter(${g.supplier_id})">${supplierName(g.supplier_id)}</td>
          <td class="mono">${g.purchases.length}</td>
          <td class="num expense">$ ${fmtMoney(g.total)}</td>
          <td><button class="btn btn-sm" onclick="showContactStatement('supplier', ${g.supplier_id}, '${supplierName(g.supplier_id).replace(/'/g, "\\'")}')">Cuenta corriente</button></td>
        </tr>`, 'No hay deuda pendiente con proveedores en esta unidad.')}
    </div>

    <div class="card">
      <div class="card-title">Detalle de compras pendientes${payablesFilterSupplier ? ` — ${supplierName(payablesFilterSupplier)} <button class="btn btn-sm" style="margin-left:8px" onclick="setPayablesFilter(null)">Ver todas</button>` : ''}</div>
      ${tableOrEmpty(filteredPending, ['#', 'Proveedor', 'Fecha', 'Total', 'Pagado', 'Pendiente', 'Estado', ''], (p) => `
        <tr>
          <td class="mono">#${p.id}</td>
          <td>${supplierName(p.supplier_id)}</td>
          <td class="mono">${fmtDate(p.date)}</td>
          <td class="num">$ ${fmtMoney(p.total_amount)}</td>
          <td class="num income">$ ${fmtMoney(p.settled_amount)}</td>
          <td class="num expense">$ ${fmtMoney(p.remaining_amount)}</td>
          <td>${paymentStatusBadge(p.payment_status)}</td>
          <td>
            <button class="btn btn-sm" onclick="showPurchaseDetail(${p.id})">Detalle</button>
            <button class="btn btn-sm btn-primary" onclick="openPayModal(${p.id}, ${p.remaining_amount})">Procesar pago</button>
          </td>
        </tr>`, 'No hay compras pendientes de pago en esta unidad.')}
    </div>
  `;
}

// ---------------------------------------------------------
// CUENTA CORRIENTE por cliente/proveedor (Roadmap Etapa 5). Reutiliza
// exactamente los mismos campos (total_amount/settled_amount por operación)
// que ya se muestran en Deudores/A pagar y en Compras — así el saldo acá
// siempre coincide con el que ya se ve en el resto del ERP, no hay un
// cálculo nuevo y distinto flotando por otro lado.
// ---------------------------------------------------------
async function showContactStatement(kind, id, name) {
  const isCustomer = kind === 'customer';
  const rows = await api(`/${isCustomer ? 'customers' : 'suppliers'}/${id}/statement`).catch(() => null);
  if (!rows) { toast('No se pudo cargar la cuenta corriente.', 'error'); return; }

  let running = 0;
  const withBalance = rows.map(r => {
    running += Number(r.total_amount) - Number(r.settled_amount || 0);
    return { ...r, running };
  });
  const total = withBalance.length ? withBalance[withBalance.length - 1].running : 0;

  openModal(`
    <h2>Cuenta corriente — ${escAttr(name)}</h2>
    <div class="hint" style="margin-bottom:14px">Saldo actual: <strong class="${total > 0.01 ? 'expense' : ''}">$ ${fmtMoney(total)}</strong> ${isCustomer ? '— es lo que te debe' : '— es lo que le debés'}</div>
    ${tableOrEmpty(withBalance, ['#', 'Fecha', 'Unidad', 'Debe', 'Haber', 'Saldo', ''], (r) => `
      <tr>
        <td class="mono">#${r.id}</td>
        <td class="mono">${fmtDateShort(r.date)}</td>
        <td>${r.business_unit_name}</td>
        <td class="num expense">$ ${fmtMoney(r.total_amount)}</td>
        <td class="num income">$ ${fmtMoney(r.settled_amount || 0)}</td>
        <td class="num">$ ${fmtMoney(r.running)}</td>
        <td><button class="btn btn-sm" onclick="${isCustomer ? `showSaleDetail(${r.id})` : `showPurchaseDetail(${r.id})`}">Detalle</button></td>
      </tr>`, isCustomer ? 'Este cliente no tiene ventas registradas.' : 'Este proveedor no tiene compras registradas.')}
    <div class="modal-actions"><button class="btn" onclick="closeModal()">Cerrar</button></div>
  `);
}

async function showSaleDetail(saleId) {
  const [items, full] = await Promise.all([
    api(`/sales/${saleId}/items`),
    api(`/sales/${saleId}/full`).catch(() => null),
  ]);
  const bc = full?.bank_conversion;
  const remaining = full ? Number(full.sale.total_amount) - Number(full.sale.settled_amount || 0) : 0;
  const canCollect = full && full.sale.status === 'CONFIRMED' && remaining > 0.01;
  openModal(`
    <h2>Detalle — Venta #${saleId}</h2>
    ${bc ? `<div class="hint" style="margin-bottom:14px">${svgIcon('dollar')} Cobrada por conversión bancaria: <strong>$ ${fmtMoney(bc.amount_ars)}</strong> vía ${bc.bank_name} → <strong>US$ ${fmtMoney(bc.usd_equivalent)}</strong>${bc.notes ? ` · ${bc.notes}` : ''}</div>` : ''}
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
      ${canCollect ? `<button class="btn btn-primary" onclick="openCollectModal(${saleId}, ${remaining})">Procesar cobro</button>` : ''}
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
    <button class="primary" onclick="window.print()">${svgIcon('print')} Imprimir / Guardar PDF</button>
    ${customer.phone ? `<a href="${waLink(customer.phone, `Hola ${customer.name}, te comparto el ${isRemito ? 'remito' : 'comprobante'} #${number} de ${business_unit.name}.`)}" target="_blank">${svgIcon('whatsapp')} Enviar por WhatsApp</a>` : ''}
    ${customer.email ? `<a href="mailto:${customer.email}?subject=${encodeURIComponent(`${title} #${number} — ${business_unit.name}`)}&body=${encodeURIComponent(`Hola ${customer.name},\n\nTe compartimos el ${isRemito ? 'remito de entrega' : 'comprobante de venta'} #${number}.\nAdjuntá el PDF generado con el botón "Imprimir / Guardar PDF" antes de enviar este correo.\n\nSaludos.`)}">${svgIcon('mail')} Enviar por email</a>` : ''}
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
  <script>window.addEventListener('load', () => { window.print(); });</script>
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
// (Roadmap Etapa 8, hallazgo #34) estado del formulario de operación abierto
// ('new' | 'edit' | 'recreate' | null) y a qué `kind` ('sale'/'purchase')
// pertenece el autoguardado activo en este momento — ver newOperationModal()
// y quoteModal() para cómo se setean.
let _currentOpFormMode = null;
let _draftAutosaveKind = null;
let _draftSaveTimer = null;

function collectOperationDraft(kind) {
  const items = [...(document.getElementById('lineItems')?.children || [])].map(row => {
    const m = row.id.replace('line_', '');
    return {
      articleId: document.getElementById(`artid_${m}`)?.value || '',
      searchText: document.getElementById(`artsearch_${m}`)?.value || '',
      qty: document.getElementById(`qty_${m}`)?.value || '',
      price: document.getElementById(`price_${m}`)?.value || '',
    };
  }).filter(it => it.articleId);
  return {
    savedAt: Date.now(),
    contact: getSearchableValue('contact'),
    date: document.getElementById('f_date')?.value || '',
    warehouse: getSearchableValue('warehouse'),
    project: getSearchableValue('project'),
    payment: document.getElementById('f_payment')?.value || '',
    cashbox: getSearchableValue('cashbox'),
    currency: document.getElementById('f_sale_currency')?.value || '',
    iva: document.getElementById('f_sale_iva')?.value || '',
    discount: document.getElementById('f_discount')?.value || '',
    notes: document.getElementById('f_notes')?.value || '',
    items,
  };
}
function scheduleDraftSave(kind) {
  if (_draftAutosaveKind !== kind) return; // no estamos en una carga nueva de ese tipo (ver quoteModal)
  clearTimeout(_draftSaveTimer);
  _draftSaveTimer = setTimeout(() => {
    try { localStorage.setItem(`erp_draft_${kind}`, JSON.stringify(collectOperationDraft(kind))); } catch (e) { /* localStorage lleno o deshabilitado: sin borrador, sin romper nada */ }
  }, 800);
}
function getOperationDraft(kind) {
  try {
    const raw = localStorage.getItem(`erp_draft_${kind}`);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}
function clearOperationDraft(kind) {
  localStorage.removeItem(`erp_draft_${kind}`);
}
function minutesSinceLabel(ts) {
  const mins = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (mins < 1) return 'hace instantes';
  if (mins === 1) return 'hace 1 minuto';
  if (mins < 60) return `hace ${mins} minutos`;
  const hs = Math.round(mins / 60);
  return hs === 1 ? 'hace 1 hora' : `hace ${hs} horas`;
}
function applyOperationDraft(kind) {
  const draft = getOperationDraft(kind);
  if (!draft) return;
  if (draft.contact) selectSearchableOption('contact', draft.contact);
  if (draft.date) { const f = document.getElementById('f_date'); if (f) f.value = draft.date; }
  if (draft.warehouse) selectSearchableOption('warehouse', draft.warehouse);
  if (draft.project) selectSearchableOption('project', draft.project);
  if (draft.payment) {
    const f = document.getElementById('f_payment');
    if (f) { f.value = draft.payment; togglePaymentBoxField(kind === 'purchase'); }
  }
  if (draft.cashbox) selectSearchableOption('cashbox', draft.cashbox);
  const currencyField = document.getElementById('f_sale_currency');
  if (currencyField && draft.currency) currencyField.value = draft.currency;
  const ivaField = document.getElementById('f_sale_iva');
  if (ivaField && draft.iva) ivaField.value = draft.iva;
  const discountField = document.getElementById('f_discount');
  if (discountField && draft.discount) discountField.value = draft.discount;
  const notesField = document.getElementById('f_notes');
  if (notesField && draft.notes) notesField.value = draft.notes;
  const container = document.getElementById('lineItems');
  if (container) container.innerHTML = '';
  const items = (draft.items || []).filter(it => it.articleId);
  if (items.length) items.forEach(it => addLineItem(kind, it));
  else addLineItem(kind);
  toast('Borrador recuperado. Revisá los datos antes de guardar.');
}

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
      <input type="text" inputmode="decimal" id="price_${id}" value="${formatMoneyFieldValue(item.unit_price)}" oninput="recalcLineItemsTotal()" onfocus="unformatMoneyField(this)" onblur="formatMoneyField(this); recalcLineItemsTotal();">
      <button class="remove-line" onclick="document.getElementById('line_${id}').remove(); recalcLineItemsTotal();">×</button>
    `;
    container.appendChild(row);
  });
  recalcLineItemsTotal();
  toast('Presupuesto cargado en la venta. Revisá los datos antes de guardar.');
}

// Recordar el depósito/caja habitual por unidad de negocio (preferencia de uso local,
// no es un dato de negocio: se guarda en localStorage, no en la base de datos).
function getRememberedChoice(kind, buId) {
  try {
    const raw = localStorage.getItem(`erp_pref_${kind}_${buId}`);
    return raw ? Number(raw) : null;
  } catch (e) { return null; }
}
function rememberChoice(kind, buId, id) {
  if (id == null || id === '') return;
  try { localStorage.setItem(`erp_pref_${kind}_${buId}`, String(id)); } catch (e) { /* localStorage no disponible, no es crítico */ }
}
function reorderWithPreferred(items, preferredId) {
  if (preferredId == null) return items;
  const idx = items.findIndex(i => String(i.id) === String(preferredId));
  if (idx <= 0) return items;
  const copy = items.slice();
  const [chosen] = copy.splice(idx, 1);
  copy.unshift(chosen);
  return copy;
}

// `existing` (Bloque 2): si viene, el modal entra en modo edición precargado
// con `{ sale|purchase, items, ... }` (misma forma que devuelve
// GET /sales/:id/full y GET /purchases/:id/full). Sin `existing`, se
// comporta exactamente igual que antes (alta nueva).
// `mode` (Bloque 4): 'recreate' precarga los mismos datos que 'existing'
// pero el botón Guardar crea una operación NUEVA (POST) en vez de editar la
// original (PUT) — se usa después de cancelar una CONFIRMADA que salió mal,
// para no reescribir todo a mano. Cualquier otro valor (o ausente) es el
// modo edición normal del Bloque 2.
function newOperationModal(kind, existing, mode) {
  window._stockLookup = null;
  const isPurchase = kind === 'purchase';
  const op = existing ? (isPurchase ? existing.purchase : existing.sale) : null;
  const isEdit = !!op && mode !== 'recreate';
  const isRecreate = !!op && mode === 'recreate';
  const contactItems = reorderWithPreferred(
    (isPurchase ? state.cache.suppliers : state.cache.customers).map(c => ({ id: c.id, label: c.name })),
    op ? (isPurchase ? op.supplier_id : op.customer_id) : null
  );
  const whItems = reorderWithPreferred(whByBU().map(w => ({ id: w.id, label: w.name })), op ? op.warehouse_id : getRememberedChoice('warehouse', state.selectedBU));
  const projItemsBase = [{ id: '', label: 'Sin proyecto' }, ...projByBU().map(p => ({ id: p.id, label: p.name }))];
  const projItems = op && op.project_id ? reorderWithPreferred(projItemsBase, op.project_id) : projItemsBase;
  const cashBoxItems = reorderWithPreferred(
    state.cache.cashBoxes.map(b => ({ id: b.id, label: `${b.name} (${b.kind === 'SOBRE' ? 'Sobre' : 'Caja'} · ${b.currency})` })),
    op ? op.cash_box_id : getRememberedChoice('cashbox', state.selectedBU)
  );

  lineItemCount = 0;
  // (Roadmap Etapa 8) modo actual del formulario, para que las funciones
  // compartidas (addLineItem, autoguardado de borrador) sepan si conviene
  // guardar un borrador o no — solo tiene sentido en carga nueva.
  _currentOpFormMode = isEdit ? 'edit' : isRecreate ? 'recreate' : 'new';
  _draftAutosaveKind = _currentOpFormMode === 'new' ? kind : null;
  const draft = _currentOpFormMode === 'new' ? getOperationDraft(kind) : null;
  openModal(`
    <h2>${isEdit ? `Editar ${isPurchase ? 'compra' : 'venta'} #${op.id}`
      : isRecreate ? `Recrear ${isPurchase ? 'compra' : 'venta'} (a partir de la #${op.id} cancelada)`
      : (isPurchase ? 'Nueva compra' : 'Nueva venta')}</h2>
    ${isRecreate ? `<div class="hint" style="margin-bottom:14px">La #${op.id} ya quedó cancelada. Revisá y corregí lo que haga falta antes de guardar — esto va a crear una operación nueva.</div>` : ''}
    ${draft ? `
    <div class="draft-banner">
      Hay un borrador sin guardar de ${isPurchase ? 'una compra' : 'una venta'} nueva (${minutesSinceLabel(draft.savedAt)}).
      <button class="btn btn-sm" onclick="applyOperationDraft('${kind}')">Recuperar</button>
      <button class="btn btn-sm" onclick="clearOperationDraft('${kind}'); toast('Borrador descartado.'); newOperationModal('${kind}')">Descartar</button>
    </div>` : ''}
    <input type="hidden" id="f_quote_id" value="">

    <div class="form-section">
      <div class="form-section-title">Datos generales</div>
      ${!isPurchase && !op ? `
      <div style="margin-bottom:14px">
        <button class="btn btn-sm" onclick="openLoadQuoteModal()">Cargar desde presupuesto</button>
        <span class="hint" id="loadedQuoteLabel"></span>
      </div>` : ''}
      <div class="field"><label>${isPurchase ? 'Proveedor' : 'Cliente'}</label>
        ${searchableSelectHtml('contact', contactItems, `Buscar ${isPurchase ? 'proveedor' : 'cliente'}…`, contactItems[0]?.label)}
      </div>
      <div class="field"><label>Fecha</label>
        <input type="date" id="f_date" value="${op ? String(op.date).slice(0, 10) : new Date().toISOString().slice(0, 10)}">
      </div>
      <div class="field-row">
        <div class="field"><label>Depósito</label>${searchableSelectHtml('warehouse', whItems, 'Buscar depósito…', whItems[0]?.label)}</div>
        <div class="field"><label>Proyecto (opcional)</label>${searchableSelectHtml('project', projItems, 'Buscar proyecto…', projItems[0]?.label || 'Sin proyecto')}</div>
      </div>
      <div class="field"><label>Forma de pago</label>
        <select id="f_payment" onchange="togglePaymentBoxField(${isPurchase})">
          <option value="CASH" ${!op || op.payment_type === 'CASH' ? 'selected' : ''}>Contado</option>
          <option value="ACCOUNT" ${op && op.payment_type === 'ACCOUNT' ? 'selected' : ''}>Cuenta corriente</option>
          ${!isPurchase ? `<option value="UNCOLLECTED" ${op && op.payment_type === 'UNCOLLECTED' ? 'selected' : ''}>Factura sin cobrar (procesar después)</option>` : ''}
        </select>
      </div>
      <div class="field" id="paymentBoxField" style="display:none">
        <label>Caja o sobre de destino</label>
        ${searchableSelectHtml('cashbox', cashBoxItems, 'Buscar caja o sobre…', cashBoxItems[0]?.label)}
      </div>
      <div class="hint" id="paymentBoxHint" style="margin-top:-10px">${isPurchase ? 'La caja o sobre de destino se elige después, al procesar el pago de esta compra.' : ''}</div>
    </div>

    <div class="form-section">
      <div class="form-section-title">Artículos</div>
      <div class="line-items" id="lineItems"></div>
      <button class="btn btn-sm" onclick="addLineItem('${kind}')">+ Agregar artículo</button>
    </div>

    <div class="form-section">
      <div class="form-section-title">Totales y notas</div>
      ${!isPurchase ? `
      <div class="field-row">
        <div class="field"><label>Moneda de la venta</label>
          <select id="f_sale_currency" onchange="refreshAllLinePrices()">
            <option value="ARS" ${!op || op.currency === 'ARS' ? 'selected' : ''}>Pesos argentinos (ARS)</option>
            <option value="USD" ${op && op.currency === 'USD' ? 'selected' : ''}>Dólares (USD)</option>
          </select>
        </div>
        <div class="field"><label>Precios</label>
          <select id="f_sale_iva" onchange="refreshAllLinePrices()">
            <option value="no">Sin IVA</option>
            <option value="si">Con IVA</option>
          </select>
        </div>
      </div>` : ''}

      <div class="field">
        <label>Descuento (opcional)</label>
        <input id="f_discount" type="text" inputmode="decimal" placeholder="0" value="${op && Number(op.discount_amount) ? formatMoneyFieldValue(op.discount_amount) : ''}" onfocus="unformatMoneyField(this)" onblur="formatMoneyField(this)">
        <div class="hint">Se resta del total calculado a partir de los artículos. Si supera la suma de líneas, el total queda en $0.</div>
      </div>

      <div class="field">
        <label>Observaciones (opcional)</label>
        <textarea id="f_notes" rows="2" style="width:100%">${op ? escAttr(op.notes) : ''}</textarea>
      </div>

      ${isEdit ? `
      <div style="margin-top:6px">
        <button class="btn btn-sm" onclick="toggleAuditHistory('${isPurchase ? 'purchase' : 'sale'}', ${op.id})">Ver historial de cambios</button>
        <div id="auditHistoryBox" style="display:none;margin-top:10px"></div>
      </div>` : ''}
    </div>

    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="${isEdit ? `updateOperation('${kind}', ${op.id})` : `createOperation('${kind}')`}">Guardar</button>
    </div>
  `);
  togglePaymentBoxField(isPurchase);
  if (op && existing.items && existing.items.length) {
    existing.items.forEach(item => addExistingLineItem(kind, item));
  } else {
    addLineItem(kind);
  }
  // (Roadmap Etapa 8, hallazgo #34) autoguardado de borrador: solo para carga
  // nueva (no edición/recreación, para no confundir un borrador viejo con una
  // operación real ya guardada). 'input'/'change' burbujean hasta el modal.
  if (_currentOpFormMode === 'new') {
    document.getElementById('modal').oninput = () => scheduleDraftSave(kind);
    document.getElementById('modal').onchange = () => scheduleDraftSave(kind);
  } else {
    document.getElementById('modal').oninput = null;
    document.getElementById('modal').onchange = null;
  }
}
function recalcLineItemsTotal() {
  // (Roadmap Etapa 8, hallazgo #15) esta función quedó sin efecto visible a
  // propósito: antes sincronizaba el campo "Importe final (editable)", que se
  // sacó del formulario (ver PROJECT_CONTEXT.md, Etapa 8). Se deja vacía en
  // vez de desenganchar los ~10 call sites que la llaman, para no arriesgar
  // esos puntos por un cambio puramente cosmético.
}

function togglePaymentBoxField(isPurchase) {
  const payment = document.getElementById('f_payment').value;
  const field = document.getElementById('paymentBoxField');
  const hint = document.getElementById('paymentBoxHint');
  if (isPurchase) {
    field.style.display = 'none';
    hint.textContent = 'La caja o sobre de destino se elige después, al procesar el pago de esta compra.';
  } else if (payment === 'CASH') {
    field.style.display = 'block';
    hint.textContent = '';
  } else {
    field.style.display = 'none';
    hint.textContent = 'La caja o sobre de destino se elige después, al procesar el cobro de esta venta.';
  }
}

// (Roadmap Etapa 8, hallazgo #14) `prefill` opcional ({articleId, searchText,
// qty, price}) para que "Duplicar línea" (duplicateLineItem) reutilice esta
// misma función en vez de repetir el armado de la fila.
function addLineItem(kind, prefill) {
  const isPurchase = kind === 'purchase';
  const id = lineItemCount++;
  const container = document.getElementById('lineItems');
  const row = document.createElement('div');
  row.className = 'line-item-row line-item-row-op';
  row.id = `line_${id}`;
  row.innerHTML = `
    <div class="article-search-wrap">
      <input type="text" class="article-search-input" id="artsearch_${id}" placeholder="Buscar por código, código alt. o nombre…"
             value="${prefill ? escAttr(prefill.searchText) : ''}"
             autocomplete="off" oninput="filterArticleOptions(${id}, ${isPurchase})" onfocus="filterArticleOptions(${id}, ${isPurchase})" onkeydown="articleSearchKeydown(event, ${id})">
      <input type="hidden" id="artid_${id}" value="${prefill ? prefill.articleId : ''}">
      <div class="article-search-results" id="artresults_${id}"></div>
    </div>
    <input type="number" step="0.001" placeholder="Cant." id="qty_${id}" value="${prefill ? escAttr(prefill.qty) : '1'}" oninput="recalcLineItemsTotal()" ${!isPurchase ? `onchange="checkLineStock(${id})"` : ''}>
    <input type="text" inputmode="decimal" placeholder="${isPurchase ? 'Costo' : 'Precio'}" id="price_${id}" value="${prefill ? escAttr(prefill.price) : ''}" oninput="recalcLineItemsTotal()" onfocus="unformatMoneyField(this)" onblur="formatMoneyField(this); recalcLineItemsTotal();">
    <button type="button" class="btn-line-icon" title="Duplicar línea" onclick="duplicateLineItem('${kind}', ${id})">${svgIcon('duplicate')}</button>
    <button class="remove-line" onclick="document.getElementById('line_${id}').remove(); recalcLineItemsTotal(); scheduleDraftSave('${kind}');">×</button>
  `;
  container.appendChild(row);
  recalcLineItemsTotal();
  if (!prefill) document.getElementById(`artsearch_${id}`)?.focus();

  document.addEventListener('click', (e) => {
    if (!e.target.closest(`#line_${id}`)) {
      const r = document.getElementById(`artresults_${id}`);
      if (r) r.style.display = 'none';
    }
  });
  scheduleDraftSave(kind);
}
function duplicateLineItem(kind, id) {
  const articleId = document.getElementById(`artid_${id}`)?.value;
  if (!articleId) { toast('Elegí un artículo en esa línea antes de duplicarla.', 'error'); return; }
  addLineItem(kind, {
    articleId,
    searchText: document.getElementById(`artsearch_${id}`)?.value || '',
    qty: document.getElementById(`qty_${id}`)?.value || '1',
    price: document.getElementById(`price_${id}`)?.value || '',
  });
}

// Fila de línea ya conocida (Bloque 2, edición) o cargada de un presupuesto:
// mismo patrón que usa loadQuoteIntoForm, artículo fijo (no buscador) con
// cantidad y precio editables.
function addExistingLineItem(kind, item) {
  const isPurchase = kind === 'purchase';
  const id = lineItemCount++;
  const container = document.getElementById('lineItems');
  const row = document.createElement('div');
  row.className = 'line-item-row line-item-row-op';
  row.id = `line_${id}`;
  row.dataset.articleId = item.article_id;
  const price = isPurchase ? item.unit_cost : item.unit_price;
  row.innerHTML = `
    <div class="article-search-wrap">
      <input type="text" class="article-search-input" id="artsearch_${id}" value="${escAttr(item.code + ' — ' + item.description)}" readonly>
      <input type="hidden" id="artid_${id}" value="${item.article_id}">
    </div>
    <input type="number" step="0.001" id="qty_${id}" value="${item.quantity}" oninput="recalcLineItemsTotal()">
    <input type="text" inputmode="decimal" id="price_${id}" value="${formatMoneyFieldValue(price)}" oninput="recalcLineItemsTotal()" onfocus="unformatMoneyField(this)" onblur="formatMoneyField(this); recalcLineItemsTotal();">
    <button type="button" class="btn-line-icon" title="Duplicar línea" onclick="duplicateLineItem('${kind}', ${id})">${svgIcon('duplicate')}</button>
    <button class="remove-line" onclick="document.getElementById('line_${id}').remove(); recalcLineItemsTotal(); scheduleDraftSave('${kind}');">×</button>
  `;
  container.appendChild(row);
}
function articleSearchKeydown(e, id) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Enter') return;
  const resultsEl = document.getElementById(`artresults_${id}`);
  if (!resultsEl || resultsEl.style.display === 'none') return;
  const items = [...resultsEl.querySelectorAll('.article-search-item')];
  if (!items.length) return;
  let activeIndex = items.findIndex(it => it.classList.contains('active'));
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    activeIndex = (activeIndex + 1) % items.length;
    items.forEach((it, i) => it.classList.toggle('active', i === activeIndex));
    items[activeIndex].scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    activeIndex = activeIndex <= 0 ? items.length - 1 : activeIndex - 1;
    items.forEach((it, i) => it.classList.toggle('active', i === activeIndex));
    items[activeIndex].scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const target = activeIndex >= 0 ? items[activeIndex] : items[0];
    target.click(); // reutiliza el mismo onclick ya definido en cada ítem (selectArticleOption / selectShipmentArticleOption)
  }
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
function filterShipmentArticleOptions(id) {
  const query = document.getElementById(`artsearch_${id}`).value.trim().toLowerCase();
  const resultsEl = document.getElementById(`artresults_${id}`);
  const articles = artByBU();

  const matches = query
    ? articles.filter(a =>
        (a.code || '').toLowerCase().includes(query) ||
        (a.alt_code || '').toLowerCase().includes(query) ||
        (a.description || '').toLowerCase().includes(query))
    : articles;

  resultsEl.innerHTML = !matches.length
    ? `<div class="article-search-empty">Sin resultados</div>`
    : matches.slice(0, 30).map(a => `
      <div class="article-search-item" onclick="selectShipmentArticleOption(${id}, ${a.article_id})">
        <span class="article-search-code">${a.code}${a.alt_code ? ' · ' + a.alt_code : ''}</span>
        <span class="article-search-desc">${a.description}</span>
      </div>
    `).join('');
  resultsEl.style.display = 'block';
}

function updateLinePrice(id, articleId, isPurchase) {
  const article = artByBU().find(a => a.article_id === articleId);
  if (!article) return;
  document.getElementById(`artsearch_${id}`).value = `${article.code} — ${article.description}`;
  document.getElementById(`artid_${id}`).value = articleId;
  document.getElementById(`line_${id}`).dataset.articleId = articleId;
  let price;
  if (isPurchase) {
    price = Number(article.list_cost_ars) || Number(article.list_cost_usd) || 0;
  } else {
    const saleCurrency = document.getElementById('f_sale_currency')?.value || 'ARS';
    const withIva = document.getElementById('f_sale_iva')?.value === 'si';
    price = articlePriceFor(article, saleCurrency, withIva);
  }
  document.getElementById(`price_${id}`).value = formatMoneyFieldValue(price || 0);
  document.getElementById(`artresults_${id}`).style.display = 'none';
  recalcLineItemsTotal();
}
async function selectArticleOption(id, articleId, isPurchase) {
  updateLinePrice(id, articleId, isPurchase);
  if (!isPurchase) await checkLineStock(id);
}
async function getStockQty(articleId, warehouseId) {
  if (!warehouseId || !articleId) return null;
  if (!window._stockLookup) {
    const stockRows = await api('/stock');
    window._stockLookup = {};
    stockRows.forEach(s => { window._stockLookup[`${s.warehouse_id}_${s.article_id}`] = Number(s.quantity); });
  }
  const key = `${warehouseId}_${articleId}`;
  return window._stockLookup[key] != null ? window._stockLookup[key] : 0;
}
async function checkLineStock(id) {
  const articleId = Number(document.getElementById(`artid_${id}`)?.value);
  const qty = Number(document.getElementById(`qty_${id}`)?.value);
  const warehouseId = Number(getSearchableValue('warehouse') || getSearchableValue('quote_warehouse'));
  if (!articleId || !warehouseId || !(qty > 0)) return;

  const available = await getStockQty(articleId, warehouseId);
  if (available == null || qty <= available) return;

  const article = artByBU().find(a => a.article_id === articleId);
  const ok = await showStockWarning(
    `El artículo <strong>${article ? article.code + ' — ' + article.description : ''}</strong> no tiene stock suficiente en este depósito.<br>Disponible: <strong>${fmtQty(available)}</strong> — Estás cargando: <strong>${fmtQty(qty)}</strong>.<br><br>Si continuás, el stock de este artículo va a quedar en negativo.`
  );
  if (!ok) {
    document.getElementById(`qty_${id}`).value = available > 0 ? available : '';
    recalcLineItemsTotal();
  }
}
function confirmDangerous(titleHtml, messageHtml, confirmLabel) {
  return new Promise((resolve) => {
    document.querySelectorAll('.danger-confirm-overlay').forEach(el => el.remove());
    const overlay = document.createElement('div');
    overlay.className = 'danger-confirm-overlay';
    overlay.innerHTML = `
      <div class="danger-confirm-box">
        <div class="danger-confirm-icon">${svgIcon('warning')}</div>
        <div class="danger-confirm-title">${titleHtml}</div>
        <div class="danger-confirm-text">${messageHtml}</div>
        <div class="danger-confirm-actions">
          <button class="btn" data-action="cancel">Cancelar</button>
          <button class="btn btn-danger" data-action="continue" style="border-color:var(--danger);color:var(--danger)">${confirmLabel || 'Sí, continuar'}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('[data-action="cancel"]').onclick = () => { overlay.remove(); resolve(false); };
    overlay.querySelector('[data-action="continue"]').onclick = () => { overlay.remove(); resolve(true); };
  });
}
function showStockWarning(messageHtml) {
  return new Promise((resolve) => {
    document.querySelectorAll('.stock-warning-overlay').forEach(el => el.remove());
    const overlay = document.createElement('div');
    overlay.className = 'stock-warning-overlay';
    overlay.innerHTML = `
      <div class="stock-warning-box">
        <div class="stock-warning-icon">${svgIcon('warning')}</div>
        <div class="stock-warning-title">Stock insuficiente</div>
        <div class="stock-warning-text">${messageHtml}</div>
        <div class="stock-warning-actions">
          <button class="btn" data-action="cancel">Cancelar</button>
          <button class="btn" data-action="continue">Continuar de todos modos</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('[data-action="cancel"]').onclick = () => { overlay.remove(); resolve(false); };
    overlay.querySelector('[data-action="continue"]').onclick = () => { overlay.remove(); resolve(true); };
  });
}

function refreshAllLinePrices() {
  const rows = [...document.getElementById('lineItems').children];
  rows.forEach(row => {
    const id = row.id.replace('line_', '');
    const articleId = Number(row.dataset.articleId);
    if (articleId) updateLinePrice(id, articleId, false);
  });
}

// Compartida entre alta (createOperation) y edición (updateOperation,
// Bloque 2) para no repetir la lectura del formulario dos veces. Devuelve
// null (y muestra el toast de error) si no hay artículos cargados.
function buildOperationPayload(kind) {
  const isPurchase = kind === 'purchase';
  const rows = [...document.getElementById('lineItems').children];
  const items = rows.map(row => {
    const idMatch = row.id.replace('line_', '');
    return {
      article_id: Number(document.getElementById(`artid_${idMatch}`).value),
      quantity: Number(document.getElementById(`qty_${idMatch}`).value),
      [isPurchase ? 'unit_cost' : 'unit_price']: parseMoneyInput(document.getElementById(`price_${idMatch}`).value),
    };
  }).filter(i => i.article_id);

  if (!items.length) { toast('Agregá al menos un artículo.', 'error'); return null; }

  const payload = {
    business_unit_id: state.selectedBU,
    warehouse_id: Number(getSearchableValue('warehouse')),
    project_id: getSearchableValue('project') ? Number(getSearchableValue('project')) : null,
    payment_type: document.getElementById('f_payment').value,
    cash_box_id: (!isPurchase && document.getElementById('f_payment').value === 'CASH') ? Number(getSearchableValue('cashbox')) : null,
    date: document.getElementById('f_date').value || undefined,
    notes: document.getElementById('f_notes')?.value || null,
    discount_amount: document.getElementById('f_discount')?.value ? parseMoneyInput(document.getElementById('f_discount').value) : 0,
    items,
  };
  payload[isPurchase ? 'supplier_id' : 'customer_id'] = Number(getSearchableValue('contact'));
  if (!isPurchase) {
    payload.currency = document.getElementById('f_sale_currency').value;
    const quoteIdVal = document.getElementById('f_quote_id')?.value;
    if (quoteIdVal) payload.quote_id = Number(quoteIdVal);
  }
  return payload;
}

async function createOperation(kind) {
  const isPurchase = kind === 'purchase';
  const payload = buildOperationPayload(kind);
  if (!payload) return;

  try {
    const created = await api(`/${isPurchase ? 'purchases' : 'sales'}`, { method: 'POST', body: JSON.stringify(payload) });
    clearOperationDraft(kind);
    closeModal();
    toast(`${isPurchase ? 'Compra' : 'Venta'} creada como pendiente. Confirmala para mover stock y caja.`);
    window._flashKey = created.id;
    rememberChoice('warehouse', state.selectedBU, payload.warehouse_id);
    if (!isPurchase && payload.cash_box_id) rememberChoice('cashbox', state.selectedBU, payload.cash_box_id);
    renderView();
  } catch (e) { toast(e.message, 'error'); }
}

// Bloque 2 — edición completa mientras la operación está PENDIENTE. Reusa el
// mismo formulario y el mismo armado de payload que la creación; el backend
// valida de nuevo el estado PENDING por las dudas (no confiar solo en que el
// botón "Editar" no aparezca una vez confirmada).
async function updateOperation(kind, id) {
  const isPurchase = kind === 'purchase';
  const payload = buildOperationPayload(kind);
  if (!payload) return;

  try {
    await api(`/${isPurchase ? 'purchases' : 'sales'}/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
    closeModal();
    toast(`${isPurchase ? 'Compra' : 'Venta'} actualizada.`);
    renderView();
  } catch (e) { toast(e.message, 'error'); }
}

// Abre el modal de edición precargado. `kind` llega en plural ('sales' /
// 'purchases', igual que confirmOperation/cancelOperation) porque así lo
// pasa opActions(); newOperationModal espera el singular.
async function openEditOperationModal(kind, id) {
  const isPurchase = kind === 'purchases';
  try {
    const full = await api(`/${kind}/${id}/full`);
    newOperationModal(isPurchase ? 'purchase' : 'sale', full);
  } catch (e) { toast(e.message, 'error'); }
}

// Historial de auditoría (Bloque 1) de una venta/compra puntual: se muestra
// plegado dentro del propio modal de edición, sin abrir un modal nuevo
// (el sistema de modal es único, no apila).
async function toggleAuditHistory(tableName, recordId) {
  const box = document.getElementById('auditHistoryBox');
  if (!box) return;
  if (box.style.display !== 'none') { box.style.display = 'none'; return; }
  box.style.display = 'block';
  box.innerHTML = '<div class="hint">Cargando…</div>';
  try {
    const rows = await api(`/audit-log/${tableName}/${recordId}`);
    box.innerHTML = !rows.length
      ? '<div class="hint">Todavía no hay cambios registrados.</div>'
      : rows.map(r => `
          <div style="border-top:1px solid #e5e5e5;padding:8px 0">
            <div class="hint mono">${fmtDate(r.changed_at)} · ${escAttr(r.changed_by_username || 'usuario desconocido')} · ${r.action}</div>
          </div>`).join('');
  } catch (e) { box.innerHTML = `<div class="hint">${e.message}</div>`; }
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
  const emojiMap = { 'inversión': 'chart', 'inversion': 'chart', 'ganancia': 'chart', 'taller': 'wrench' };
  for (const key in emojiMap) {
    if (n.includes(key)) return `<span class="cashbox-tile-emoji">${svgIcon(emojiMap[key])}</span>`;
  }
  return `<span class="cashbox-tile-emoji">${svgIcon(kind === 'SOBRE' ? 'mail' : 'cash')}</span>`;
}


async function verifySaleCollection(id) {
  if (!(await verifyPasswordPrompt('confirmar el movimiento físico de este cobro', true))) return;
  try {
    await api(`/sale-collections/${id}/verify`, { method: 'POST' });
    toast('Cobro verificado. Ya impacta en el saldo de la caja/sobre.');
    renderView();
  } catch (e) { toast(e.message, 'error'); }
}
async function rejectSaleCollection(id) {
  if (!confirm('¿Rechazar este cobro? La venta vuelve a quedar pendiente por ese monto.')) return;
  if (!(await verifyPasswordPrompt('rechazar este cobro', true))) return;
  try {
    await api(`/sale-collections/${id}/reject`, { method: 'POST' });
    toast('Cobro rechazado. El saldo pendiente de la venta se actualizó.');
    renderView();
  } catch (e) { toast(e.message, 'error'); }
}

// ---------------------------------------------------------
// FINANZAS (Cajas/Sobres + Movimientos + Registrar + Verificar, unificado)
// ---------------------------------------------------------
let financeSubTab = 'resumen'; // 'resumen' | 'movimientos' | 'registrar' | 'verificar'
let financeMovementsPreselect = null;
let manualMovementMode = 'simple'; // 'simple' | 'transfer'
let manualFromBox = null;
let manualToBox = null;

function switchFinanceTab(tab) {
  financeSubTab = tab;
  renderView();
}

async function renderFinance() {
  const pending = await api('/cash-movements/pending');

  document.getElementById('viewActions').innerHTML = financeSubTab === 'resumen' ? `
    <button class="btn btn-sm" onclick="newCashBoxModal('CAJA')">+ Nueva caja</button>
    <button class="btn btn-sm" onclick="newCashBoxModal('SOBRE')">+ Nuevo sobre</button>` : '';

  const el = document.getElementById('view');

  const tabsHtml = `
    <div style="display:flex;gap:8px;margin-bottom:18px">
      <button class="btn btn-sm ${financeSubTab === 'resumen' ? 'btn-primary' : ''}" onclick="switchFinanceTab('resumen')">Resumen</button>
      <button class="btn btn-sm ${financeSubTab === 'movimientos' ? 'btn-primary' : ''}" onclick="switchFinanceTab('movimientos')">Movimientos</button>
      <button class="btn btn-sm ${financeSubTab === 'registrar' ? 'btn-primary' : ''}" onclick="switchFinanceTab('registrar')">Registrar</button>
      <button class="btn btn-sm ${financeSubTab === 'verificar' ? 'btn-primary' : ''}" onclick="switchFinanceTab('verificar')">Verificar ${pending.length ? `(${pending.length})` : ''}</button>
    </div>`;

  if (financeSubTab === 'resumen') {
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

    el.innerHTML = tabsHtml + `
      <div class="card">
        <div class="card-title">Cajas</div>
        <div class="cashbox-grid">${cajas.map(tile).join('')}</div>
      </div>
      <div class="card">
        <div class="card-title">Sobres</div>
        <div class="cashbox-grid">${sobres.map(tile).join('')}</div>
      </div>`;
    return;
  }

  if (financeSubTab === 'movimientos') {
    el.innerHTML = tabsHtml + `
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
      </div>`;
    if (financeMovementsPreselect != null) {
      const sel = document.getElementById('cashFilterSelect');
      sel.value = financeMovementsPreselect;
      financeMovementsPreselect = null;
      loadCashBoxMovements();
    }
    return;
  }

  if (financeSubTab === 'registrar') {
    const boxes = state.cache.cashBoxes || [];
    if (!boxes.length) {
      el.innerHTML = tabsHtml + `<div class="empty-state">No hay cajas ni sobres cargados todavía.</div>`;
      return;
    }

    manualFromBox = null;
    manualToBox = null;

    const boxTiles = (idPrefix, selectFn) => boxes.map(b => `
      <div class="cashbox-picker-tile" data-box-id="${b.id}" id="${idPrefix}_${b.id}" onclick="${selectFn}(${b.id})">
        <div class="cashbox-tile-icon">${cashBoxIcon(b.name, b.kind)}</div>
        <div class="cashbox-picker-name">${b.name}</div>
        <div class="cashbox-picker-meta">${b.kind === 'SOBRE' ? 'Sobre' : 'Caja'} · ${b.currency}</div>
      </div>`).join('');

    el.innerHTML = tabsHtml + `
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
          <div class="field"><label>Monto</label><input id="f_mov_amount" type="text" inputmode="decimal" placeholder="0,00" onfocus="unformatMoneyField(this)" onblur="formatMoneyField(this)"></div>
        </div>
        <div class="field"><label>Proyecto (opcional)</label><select id="f_mov_project"><option value="">Sin proyecto</option>${projByBU().map(p => `<option value="${p.id}">${p.name}</option>`).join('')}</select></div>
        <div class="field"><label>Descripción</label><input id="f_mov_desc" placeholder="Ej: Pago de servicios"></div>
        <button class="btn btn-primary" onclick="createCashMovement()">Registrar movimiento</button>
        <div class="hint" style="margin-top:8px">Queda pendiente de verificación hasta confirmar que el dinero se movió físicamente (ver pestaña "Verificar").</div>
      </div>

      <div class="card" id="manualBoxHistoryCard" style="display:none">
        <div class="card-title">Historial de movimientos — <span id="manualBoxHistoryLabel"></span></div>
        <div id="manualBoxHistoryContent"><div class="empty-state">Cargando…</div></div>
      </div>
    `;
    return;
  }

  if (financeSubTab === 'verificar') {
    el.innerHTML = tabsHtml + `
      <div class="card">
        <div class="card-title">Movimientos manuales pendientes de verificación ${pending.length ? `(${pending.length})` : ''}</div>
        ${tableOrEmpty(pending, ['Fecha', 'Tipo', 'Origen', 'Destino', 'Monto', 'Descripción', ''], (p) => `
          <tr ${daysSince(p.created_at) >= 2 ? 'style="background:#FFF3E0"' : ''}>
            <td class="mono">${fmtDate(p.created_at)}${daysSince(p.created_at) >= 2 ? ` <span style="color:#C9820A;font-weight:600">${svgIcon('warning')} hace ${daysSince(p.created_at)}d</span>` : ''}</td>
            <td>${p.kind === 'TRANSFER' ? 'Transferencia' : p.kind === 'INCOME' ? 'Ingreso' : 'Egreso'}</td>
            <td>${p.from_box_name || '-'}</td>
            <td>${p.to_box_name || '-'}</td>
            <td class="num ${p.kind === 'EXPENSE' ? 'expense' : p.kind === 'INCOME' ? 'income' : ''}">$ ${fmtMoney(p.amount)}</td>
            <td>${p.description || '-'}</td>
            <td>
              <button class="btn btn-sm btn-primary" onclick="verifyPendingMovement(${p.id})">Confirmar movimiento físico</button>
              <button class="btn btn-sm btn-danger" onclick="rejectPendingMovement(${p.id})">Rechazar</button>
            </td>
          </tr>`, 'No hay movimientos manuales esperando verificación.')}
      </div>`;
    return;
  }
}
function setManualMovementMode(mode) {
  manualMovementMode = mode;
  renderView();
}
function selectManualBox(boxId) {
  const box = state.cache.cashBoxes.find(b => b.id === boxId);
  if (!box) return;
  document.querySelectorAll('#manualBoxPicker .cashbox-picker-tile').forEach(t => t.classList.toggle('selected', Number(t.dataset.boxId) === boxId));
  document.getElementById('manualTypeField').style.display = 'block';
  document.getElementById('f_mov_box').value = boxId;
  document.getElementById('selectedBoxLabel').textContent = `${box.name} (${box.kind === 'SOBRE' ? 'Sobre' : 'Caja'} · ${box.currency})`;
  document.getElementById('manualMovementForm').style.display = 'block';
  loadManualBoxHistory(boxId, box.name);
}
async function loadManualBoxHistory(boxId, boxName) {
  const card = document.getElementById('manualBoxHistoryCard');
  const label = document.getElementById('manualBoxHistoryLabel');
  const content = document.getElementById('manualBoxHistoryContent');
  card.style.display = 'block';
  label.textContent = boxName;
  content.innerHTML = `<div class="empty-state">Cargando…</div>`;
  try {
    const movements = await api(`/cash-boxes/${boxId}/movements`);
    content.innerHTML = tableOrEmpty(movements.slice(0, 30), ['Fecha', 'Tipo', 'Monto', 'Descripción', 'Origen'], (m) => `
      <tr>
        <td class="mono">${fmtDate(m.created_at)}</td>
        <td>${m.type === 'INCOME' ? 'Ingreso' : 'Egreso'}</td>
        <td class="num ${m.type === 'INCOME' ? 'income' : 'expense'}">$ ${fmtMoney(m.amount)}</td>
        <td>${m.description || '-'}</td>
        <td class="mono">${m.origin_type || '-'}</td>
      </tr>`, 'Esta caja/sobre todavía no tiene movimientos.');
  } catch (e) {
    content.innerHTML = `<div class="empty-state">No se pudo cargar el historial.</div>`;
  }
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
          amount: parseMoneyInput(document.getElementById('f_mov_amount').value),
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
          amount: parseMoneyInput(document.getElementById('f_mov_amount').value),
          description: document.getElementById('f_mov_desc').value,
        }),
      });
    }
    toast('Movimiento registrado. Queda pendiente de verificación física.');
    renderView();
  } catch (e) { toast(e.message, 'error'); }
}
async function verifyPendingMovement(id) {
  if (!(await verifyPasswordPrompt('confirmar el movimiento físico', true))) return;
  try {
    await api(`/cash-movements/pending/${id}/verify`, { method: 'POST' });
    toast('Movimiento verificado. Ya impacta en el saldo.');
    renderView();
  } catch (e) { toast(e.message, 'error'); }
}
async function rejectPendingMovement(id) {
  if (!confirm('¿Rechazar este movimiento pendiente?')) return;
  if (!(await verifyPasswordPrompt('rechazar este movimiento', true))) return;
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
             oninput="filterSearchableSelect('${baseId}')" onfocus="showAllSearchableOptions('${baseId}')">
      <input type="hidden" id="ss_value_${baseId}" value="${items[0]?.id ?? ''}">
      <div class="article-search-results" id="ss_results_${baseId}"></div>
    </div>`;
}
function showAllSearchableOptions(baseId) {
  const input = document.getElementById(`ss_input_${baseId}`);
  if (input) input.select();
  const items = window._searchableSelectData[baseId] || [];
  const resultsEl = document.getElementById(`ss_results_${baseId}`);
  if (!resultsEl) return;
  resultsEl.innerHTML = !items.length
    ? `<div class="article-search-empty">Sin resultados</div>`
    : items.slice(0, 40).map(i => `
        <div class="article-search-item" onclick="selectSearchableOption('${baseId}', '${i.id}')">
          <span class="article-search-desc">${i.label}</span>
        </div>`).join('');
  resultsEl.style.display = 'block';
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
  if (!e.target.closest('.global-search-wrap') && !e.target.closest('.global-search-results')) {
    closeGlobalSearch();
  }
  if (!e.target.closest('.row-menu-wrap')) {
    closeAllRowMenus();
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
    headers: ['code', 'alt_code', 'description', 'list_cost_ars', 'shipping_margin_pct_ars', 'fx_margin_pct_ars', 'profit_margin_pct_ars', 'iva_pct_ars', 'list_cost_usd', 'shipping_margin_pct_usd', 'fx_margin_pct_usd', 'profit_margin_pct_usd', 'iva_pct_usd', 'price_ars', 'price_usd'],
    sample: ['ART001', 'OEM-123', 'Amortiguador delantero', 15000, 5, 0, 30, 21, 0, 0, 0, 0, 21, '', 25],
    bulkEndpoint: '/articles/bulk-import',
    bulkKey: 'articles',
    buildPayload: (row) => ({
      code: row.code,
      alt_code: row.alt_code || '',
      description: row.description,
      list_cost_ars: Number(row.list_cost_ars) || 0,
      shipping_margin_pct_ars: Number(row.shipping_margin_pct_ars) || 0,
      fx_margin_pct_ars: Number(row.fx_margin_pct_ars) || 0,
      profit_margin_pct_ars: Number(row.profit_margin_pct_ars) || 0,
      iva_pct_ars: row.iva_pct_ars != null && row.iva_pct_ars !== '' ? Number(row.iva_pct_ars) : 21,
      list_cost_usd: Number(row.list_cost_usd) || 0,
      shipping_margin_pct_usd: Number(row.shipping_margin_pct_usd) || 0,
      fx_margin_pct_usd: Number(row.fx_margin_pct_usd) || 0,
      profit_margin_pct_usd: Number(row.profit_margin_pct_usd) || 0,
      iva_pct_usd: row.iva_pct_usd != null && row.iva_pct_usd !== '' ? Number(row.iva_pct_usd) : 21,
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

    const REFRESH_BY_KIND = { articles: refreshArticles, warehouses: refreshWarehouses, suppliers: refreshSuppliers, customers: refreshCustomers };
    if (REFRESH_BY_KIND[kind]) await REFRESH_BY_KIND[kind]();
    renderView();
    const createdMsg = result.created ? `${result.created} creados` : '';
    const updatedMsg = result.updated ? `${result.updated} actualizados` : '';
    const summary = [createdMsg, updatedMsg].filter(Boolean).join(' — ');
    if (result.failed === 0) {
      toast(`Importación completa: ${summary}.`);
    } else {
      toast(`${summary} — Con errores: ${result.failed}.`, 'error');
      showImportErrorsModal(result.errors);
    }
  } catch (e) {
    toast(e.message || 'No se pudo leer el archivo. Verificá que sea un Excel válido.', 'error');
  }
}

function showImportErrorsModal(errors) {
  openModal(`
    <h2>Errores de importación</h2>
    <div class="hint" style="margin-bottom:14px">Estas filas no se pudieron importar. El motivo más común es un problema de formato en algún valor.</div>
    ${tableOrEmpty(errors || [], ['Código/Nombre', 'Motivo'], (e) => `
      <tr><td class="mono">${e.code || e.name || '-'}</td><td>${e.error}</td></tr>`, 'Sin detalle disponible.')}
    <div class="modal-actions"><button class="btn" onclick="closeModal()">Cerrar</button></div>
  `);
}

function selectCashBoxFilter(id) {
  financeMovementsPreselect = id;
  switchFinanceTab('movimientos');
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
// Ventana de gracia: solo para las verificaciones de cobro/pago (la tarea repetitiva
// del día). Acciones irreversibles (purgar papelera, editar stock a mano, eliminar en
// lote, etc.) NO reciben gracia y siguen pidiendo la contraseña siempre.
const PASSWORD_GRACE_MS = 5 * 60 * 1000; // 5 minutos
let _lastPasswordVerifiedAt = 0;
async function verifyPasswordPrompt(actionLabel, allowGrace) {
  if (allowGrace && (Date.now() - _lastPasswordVerifiedAt) < PASSWORD_GRACE_MS) return true;
  const password = prompt(`Ingresá tu contraseña para confirmar: ${actionLabel}`);
  if (password === null) return false;
  try {
    await api('/auth/verify-password', { method: 'POST', body: JSON.stringify({ password }) });
    _lastPasswordVerifiedAt = Date.now();
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
  { key: 'cash', label: 'Finanzas' },
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
let activityLogShowTechnical = false;
function activityLogToggleTechnical() { activityLogShowTechnical = !activityLogShowTechnical; renderView(); }

async function renderUsers() {
  document.getElementById('viewActions').innerHTML = usersSubTab === 'list'
    ? `<button class="btn btn-primary" onclick="newUserModal()">+ Nuevo usuario</button>`
    : '';
  const el = document.getElementById('view');

  const tabsHtml = `
    <div style="display:flex;gap:8px;margin-bottom:18px">
      <button class="btn btn-sm ${usersSubTab === 'list' ? 'btn-primary' : ''}" onclick="switchUsersTab('list')">Usuarios</button>
      <button class="btn btn-sm ${usersSubTab === 'log' ? 'btn-primary' : ''}" onclick="switchUsersTab('log')">Registro de actividad</button>
    </div>`;

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
            <button class="btn btn-sm" onclick="activityLogToggleTechnical()">${activityLogShowTechnical ? 'Ocultar' : 'Mostrar'} detalles técnicos</button>
          </div>
        </div>
        ${tableOrEmpty(logs, activityLogShowTechnical ? ['Fecha', 'Usuario', 'Detalle', 'Acción', 'Ruta'] : ['Fecha', 'Usuario', 'Detalle'], (l) => `
          <tr>
            <td class="mono">${fmtDate(l.created_at)}</td>
            <td>${l.username}</td>
            <td>${l.summary || '-'}</td>
            ${activityLogShowTechnical ? `<td class="mono">${l.method}</td><td class="mono">${l.path}</td>` : ''}
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
      <td style="text-align:right;white-space:nowrap">
        <button class="btn btn-sm" onclick='openEditUserModal(${u.id}, "${u.username}", "${u.role}")'>Editar</button>
        ${rowActionsMenu(`user_${u.id}`, userRowMenuItems(u))}
      </td>
    </tr>`, 'No hay usuarios cargados.')}</div>`;
}
// "Editar" queda visible (acción más usada); Permisos/Activar-Desactivar/Eliminar
// pasan al "⋮" — igual criterio que Ventas/Compras/Stock/Remitos.
function userRowMenuItems(u) {
  const items = [];
  if (u.role !== 'ADMIN') {
    items.push({ label: 'Permisos', onclick: `openPermissionsModal(${u.id}, "${u.username}", ${JSON.stringify(u.permissions).replace(/"/g, '&quot;')})` });
  }
  items.push({ label: u.active ? 'Desactivar' : 'Activar', onclick: `toggleUser(${u.id})` });
  items.push({ label: 'Eliminar', onclick: `deleteUser(${u.id}, '${u.username}')`, danger: true });
  return items;
}
function switchUsersTab(tab) {
  usersSubTab = tab;
  activityLogPage = 1;
  renderView();
}
async function renderTrash() {
  document.getElementById('viewActions').innerHTML = '';
  const el = document.getElementById('view');
  const trash = await api('/trash');
  el.innerHTML = `
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
  const ok = await confirmDangerous(
    'Eliminar definitivamente',
    `¿Eliminar <strong>"${name}"</strong> definitivamente?<br>Esta acción no se puede deshacer: ya no va a poder recuperarse.`,
    'Sí, eliminar definitivamente'
  );
  if (!ok) return;
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
  if (!(await verifyPasswordPrompt(`eliminar el usuario ${username}`))) return;
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
  scheduleSessionExpiryWarning();
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
