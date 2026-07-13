/**
 * SMOKE TEST — You One Racing ERP
 * ---------------------------------
 * Prueba el flujo crítico completo (login, compra con verificación,
 * venta con verificación, stock, reportes) contra una unidad de negocio
 * de prueba que se crea y se borra sola al final. No toca tus datos reales.
 *
 * Uso:
 *   node smoke_test.js
 *
 * Configuración: editá smoke_test_config.json (mismo directorio) con
 * la URL del sistema y un usuario ADMIN.
 */

const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, 'smoke_test_config.json');
if (!fs.existsSync(CONFIG_PATH)) {
  console.error(`\n❌ No encontré smoke_test_config.json en ${__dirname}`);
  console.error('Creá ese archivo con este contenido (ajustá los valores):\n');
  console.error(JSON.stringify({ base_url: 'http://localhost:3000', username: 'admin', password: 'TU_PASSWORD' }, null, 2));
  process.exit(1);
}
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
const BASE_URL = config.base_url.replace(/\/$/, '');

let token = null;
let passCount = 0;
let failCount = 0;
const stamp = Date.now();
const created = {}; // guarda ids creados para poder limpiar al final

function ok(label) {
  passCount++;
  console.log(`  ✅ ${label}`);
}
function fail(label, err) {
  failCount++;
  console.log(`  ❌ ${label} — ${err}`);
}

async function api(pathStr, opts = {}) {
  const res = await fetch(`${BASE_URL}${pathStr}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function step(label, fn) {
  try {
    await fn();
    ok(label);
  } catch (e) {
    fail(label, e.message);
  }
}

async function run() {
  console.log(`\n🔎 SMOKE TEST — ${BASE_URL}\n`);

  console.log('1. Autenticación');
  await step('Login con usuario admin', async () => {
    const r = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: config.username, password: config.password }),
    });
    token = r.token;
    if (!token) throw new Error('No se recibió token');
  });
  if (!token) {
    console.log('\n⛔ No se pudo autenticar. Abortando el resto de las pruebas.\n');
    process.exit(1);
  }

  console.log('\n2. Datos maestros de prueba');
  await step('Crear unidad de negocio de prueba', async () => {
    const r = await api('/business-units', { method: 'POST', body: JSON.stringify({ name: `SMOKE_TEST_${stamp}` }) });
    created.businessUnitId = r.id;
  });
  await step('Crear depósito de prueba', async () => {
    const r = await api('/warehouses', { method: 'POST', body: JSON.stringify({ name: `Depósito Smoke ${stamp}`, business_unit_id: created.businessUnitId }) });
    created.warehouseId = r.id;
  });
  await step('Crear artículo de prueba', async () => {
    const r = await api('/articles', {
      method: 'POST',
      body: JSON.stringify({ business_unit_id: created.businessUnitId, code: `SMOKE-${stamp}`, description: 'Artículo de prueba', list_cost: 100 }),
    });
    created.articleId = r.id;
  });
  await step('Crear proveedor de prueba', async () => {
    const r = await api('/suppliers', { method: 'POST', body: JSON.stringify({ name: `Proveedor Smoke ${stamp}` }) });
    created.supplierId = r.id;
  });
  await step('Crear cliente de prueba', async () => {
    const r = await api('/customers', { method: 'POST', body: JSON.stringify({ name: `Cliente Smoke ${stamp}` }) });
    created.customerId = r.id;
  });
  await step('Obtener una caja/sobre existente', async () => {
    const boxes = await api('/cash-boxes');
    if (!boxes.length) throw new Error('No hay ninguna caja/sobre cargada en el sistema');
    created.cashBoxId = boxes[0].id;
  });

  console.log('\n3. Flujo de Compra (con verificación de pago)');
  let balanceBeforePurchasePay;
  await step('Crear compra', async () => {
    const r = await api('/purchases', {
      method: 'POST',
      body: JSON.stringify({
        business_unit_id: created.businessUnitId, supplier_id: created.supplierId, warehouse_id: created.warehouseId,
        payment_type: 'CASH', items: [{ article_id: created.articleId, quantity: 10, unit_cost: 50 }],
      }),
    });
    created.purchaseId = r.id;
  });
  await step('Confirmar compra (debe sumar stock)', async () => {
    await api(`/purchases/${created.purchaseId}/confirm`, { method: 'POST' });
    const stock = await api('/stock');
    const row = stock.find(s => s.article_id === created.articleId && s.warehouse_id === created.warehouseId);
    if (!row || Number(row.quantity) !== 10) throw new Error(`Stock esperado 10, encontrado ${row?.quantity}`);
  });
  await step('Balance de caja ANTES de procesar el pago (referencia)', async () => {
    const dash = await api('/cash-boxes/dashboard');
    balanceBeforePurchasePay = Number(dash.find(b => b.cash_box_id === created.cashBoxId).current_balance);
  });
  await step('Procesar pago de la compra (NO debe tocar el saldo todavía)', async () => {
    await api(`/purchases/${created.purchaseId}/pay`, { method: 'POST', body: JSON.stringify({ splits: [{ cash_box_id: created.cashBoxId, amount: 500 }] }) });
    const dash = await api('/cash-boxes/dashboard');
    const balance = Number(dash.find(b => b.cash_box_id === created.cashBoxId).current_balance);
    if (balance !== balanceBeforePurchasePay) throw new Error(`El saldo cambió antes de verificar (${balanceBeforePurchasePay} → ${balance})`);
  });
  await step('Verificar el pago (SÍ debe bajar el saldo)', async () => {
    const pending = await api('/purchase-payments/pending');
    const p = pending.find(x => x.purchase_id === created.purchaseId);
    if (!p) throw new Error('No se encontró el pago pendiente de verificación');
    await api(`/purchase-payments/${p.id}/verify`, { method: 'POST' });
    const dash = await api('/cash-boxes/dashboard');
    const balance = Number(dash.find(b => b.cash_box_id === created.cashBoxId).current_balance);
    if (balance !== balanceBeforePurchasePay - 500) throw new Error(`Saldo esperado ${balanceBeforePurchasePay - 500}, encontrado ${balance}`);
  });

  console.log('\n4. Flujo de Venta (con verificación de cobro)');
  let balanceBeforeSaleCollect;
  await step('Crear venta', async () => {
    const r = await api('/sales', {
      method: 'POST',
      body: JSON.stringify({
        business_unit_id: created.businessUnitId, customer_id: created.customerId, warehouse_id: created.warehouseId,
        payment_type: 'CASH', currency: 'ARS', items: [{ article_id: created.articleId, quantity: 3, unit_price: 200 }],
      }),
    });
    created.saleId = r.id;
  });
  await step('Confirmar venta (debe restar stock)', async () => {
    await api(`/sales/${created.saleId}/confirm`, { method: 'POST' });
    const stock = await api('/stock');
    const row = stock.find(s => s.article_id === created.articleId && s.warehouse_id === created.warehouseId);
    if (!row || Number(row.quantity) !== 7) throw new Error(`Stock esperado 7, encontrado ${row?.quantity}`);
  });
  await step('Balance de caja ANTES de procesar el cobro (referencia)', async () => {
    const dash = await api('/cash-boxes/dashboard');
    balanceBeforeSaleCollect = Number(dash.find(b => b.cash_box_id === created.cashBoxId).current_balance);
  });
  await step('Procesar cobro de la venta (NO debe tocar el saldo todavía)', async () => {
    await api(`/sales/${created.saleId}/collect`, { method: 'POST', body: JSON.stringify({ splits: [{ cash_box_id: created.cashBoxId, amount: 600 }] }) });
    const dash = await api('/cash-boxes/dashboard');
    const balance = Number(dash.find(b => b.cash_box_id === created.cashBoxId).current_balance);
    if (balance !== balanceBeforeSaleCollect) throw new Error(`El saldo cambió antes de verificar (${balanceBeforeSaleCollect} → ${balance})`);
  });
  await step('Verificar el cobro (SÍ debe subir el saldo)', async () => {
    const pending = await api('/sale-collections/pending');
    const p = pending.find(x => x.sale_id === created.saleId);
    if (!p) throw new Error('No se encontró el cobro pendiente de verificación');
    await api(`/sale-collections/${p.id}/verify`, { method: 'POST' });
    const dash = await api('/cash-boxes/dashboard');
    const balance = Number(dash.find(b => b.cash_box_id === created.cashBoxId).current_balance);
    if (balance !== balanceBeforeSaleCollect + 600) throw new Error(`Saldo esperado ${balanceBeforeSaleCollect + 600}, encontrado ${balance}`);
  });

  console.log('\n5. Reportes');
  await step('Generar estado de resultados (P&L) sin errores', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const r = await api(`/reports/pnl?business_unit_id=${created.businessUnitId}&date_from=2020-01-01&date_to=${today}`);
    if (typeof r.net_result !== 'number') throw new Error('La respuesta no tiene el formato esperado');
  });

  console.log('\n6. Limpieza (borrando todo lo de prueba)');
  await step('Eliminar venta de prueba', async () => { await api(`/sales/${created.saleId}`, { method: 'DELETE' }); });
  await step('Eliminar compra de prueba', async () => { await api(`/purchases/${created.purchaseId}`, { method: 'DELETE' }); });
  await step('Eliminar artículo, depósito, proveedor, cliente y unidad de prueba (papelera)', async () => {
    await api(`/articles/${created.articleId}`, { method: 'DELETE' });
    await api(`/warehouses/${created.warehouseId}`, { method: 'DELETE' });
    await api(`/suppliers/${created.supplierId}`, { method: 'DELETE' });
    await api(`/customers/${created.customerId}`, { method: 'DELETE' });
    await api(`/business-units/${created.businessUnitId}`, { method: 'DELETE' });
  });
  await step('Purgar definitivamente de la papelera (no dejar residuos)', async () => {
    await api(`/trash/articles/${created.articleId}`, { method: 'DELETE' });
    await api(`/trash/warehouses/${created.warehouseId}`, { method: 'DELETE' });
    await api(`/trash/suppliers/${created.supplierId}`, { method: 'DELETE' });
    await api(`/trash/customers/${created.customerId}`, { method: 'DELETE' });
    await api(`/trash/business-units/${created.businessUnitId}`, { method: 'DELETE' });
  });

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`RESULTADO: ${passCount} OK · ${failCount} con errores`);
  console.log(`${'─'.repeat(50)}\n`);
  process.exit(failCount > 0 ? 1 : 0);
}

run().catch(e => {
  console.error('\n💥 Error inesperado:', e.message);
  process.exit(1);
});
