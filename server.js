const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const XLSX = require('xlsx');
require('dotenv').config();
const pool = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'cambiar-este-secreto-en-produccion';

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- AUTH MIDDLEWARE ----------
function authRequired(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'No autenticado' });
  const token = header.replace('Bearer ', '');
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Sesión inválida o expirada' });
  }
}
function adminRequired(req, res, next) {
  if (req.user?.role !== 'ADMIN') return res.status(403).json({ error: 'Requiere permisos de administrador' });
  next();
}

// ---------- AUTH ROUTES (públicas) ----------
app.post('/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const r = await pool.query('SELECT * FROM app_user WHERE username=$1 AND active=true', [username]);
    const user = r.rows[0];
    if (!user) return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '12h' });
    res.json({ token, user: { id: user.id, username: user.username, role: user.role, permissions: user.permissions } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// A partir de acá, todo requiere estar logueado
app.use(authRequired);

// ---------- REGISTRO DE ACTIVIDAD (automático en acciones que modifican datos) ----------
app.use((req, res, next) => {
  if (req.method !== 'GET') {
    const summarize = (body) => {
      if (!body || typeof body !== 'object') return '';
      const parts = [];
      if (body.name) parts.push(body.name);
      if (body.code) parts.push(body.code);
      if (body.username) parts.push(body.username);
      if (body.description) parts.push(body.description);
      return parts.join(' · ').substring(0, 150);
    };
    pool.query(
      `INSERT INTO activity_log (user_id, username, method, path, summary) VALUES ($1,$2,$3,$4,$5)`,
      [req.user?.id || null, req.user?.username || 'desconocido', req.method, req.originalUrl, summarize(req.body)]
    ).catch(() => {});
  }
  next();
});

app.post('/auth/verify-password', async (req, res) => {
  try {
    const { password } = req.body;
    const r = await pool.query('SELECT * FROM app_user WHERE id=$1', [req.user.id]);
    const user = r.rows[0];
    const ok = user && await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Contraseña incorrecta' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.get('/auth/me', async (req, res) => {
  const r = await pool.query('SELECT id, username, role, permissions FROM app_user WHERE id=$1', [req.user.id]);
  res.json(r.rows[0]);
});

app.get('/users', adminRequired, async (req, res) => {
  const r = await pool.query('SELECT id, username, role, permissions, active, created_at FROM app_user ORDER BY id');
  res.json(r.rows);
});
app.post('/users', adminRequired, async (req, res) => {
  try {
    const { username, password, role, permissions } = req.body;
    const hash = await bcrypt.hash(password, 10);
    const r = await pool.query(
      'INSERT INTO app_user (username, password_hash, role, permissions) VALUES ($1,$2,$3,$4) RETURNING id, username, role, permissions, active, created_at',
      [username, hash, role || 'USER', JSON.stringify(permissions || ['dashboard'])]
    );
    res.json(r.rows[0]);
  } catch (e) {
    res.status(400).json({ error: e.code === '23505' ? 'Ese nombre de usuario ya existe' : e.message });
  }
});
app.put('/users/:id', adminRequired, async (req, res) => {
  try {
    const { id } = req.params;
    const { username, password, role } = req.body;
    const fields = [];
    const values = [];
    let i = 1;
    if (username) { fields.push(`username=$${i++}`); values.push(username); }
    if (role) { fields.push(`role=$${i++}`); values.push(role); }
    if (password) { fields.push(`password_hash=$${i++}`); values.push(await bcrypt.hash(password, 10)); }
    if (!fields.length) return res.status(400).json({ error: 'Nada para actualizar' });
    values.push(id);
    const r = await pool.query(
      `UPDATE app_user SET ${fields.join(', ')} WHERE id=$${i} RETURNING id, username, role, permissions, active`,
      values
    );
    res.json(r.rows[0]);
  } catch (e) {
    res.status(400).json({ error: e.code === '23505' ? 'Ese nombre de usuario ya existe' : e.message });
  }
});

app.put('/users/:id/permissions', adminRequired, async (req, res) => {
  const { id } = req.params;
  const { permissions } = req.body;
  const r = await pool.query(
    'UPDATE app_user SET permissions=$1 WHERE id=$2 RETURNING id, username, role, permissions, active',
    [JSON.stringify(permissions || []), id]
  );
  res.json(r.rows[0]);
});
app.put('/users/:id/toggle', adminRequired, async (req, res) => {
  const { id } = req.params;
  const r = await pool.query('UPDATE app_user SET active = NOT active WHERE id=$1 RETURNING id, username, role, permissions, active', [id]);
  res.json(r.rows[0]);
});
app.delete('/users/:id', adminRequired, async (req, res) => {
  if (Number(req.params.id) === req.user.id) return res.status(400).json({ error: 'No podés eliminar tu propio usuario' });
  await pool.query('DELETE FROM app_user WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

app.get('/activity-log', adminRequired, async (req, res) => {
  const r = await pool.query('SELECT * FROM activity_log ORDER BY created_at DESC LIMIT 300');
  res.json(r.rows);
});

// ---------- BUSINESS UNITS ----------
app.get('/business-units', async (req, res) => {
  const r = await pool.query('SELECT * FROM business_unit ORDER BY id');
  res.json(r.rows);
});
app.post('/business-units', async (req, res) => {
  try {
    const { name } = req.body;
    const r = await pool.query('INSERT INTO business_unit (name) VALUES ($1) RETURNING *', [name]);
    res.json(r.rows[0]);
  } catch (e) {
    res.status(400).json({ error: e.code === '23505' ? 'Ya existe una unidad de negocio con ese nombre' : e.message });
  }
});
app.delete('/business-units/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM business_unit WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---------- PROJECTS ----------
app.post('/projects', async (req, res) => {
  const { business_unit_id, name } = req.body;
  const r = await pool.query(
    'INSERT INTO project (business_unit_id, name) VALUES ($1,$2) RETURNING *',
    [business_unit_id, name]
  );
  res.json(r.rows[0]);
});
app.get('/projects', async (req, res) => {
  const r = await pool.query('SELECT * FROM project ORDER BY id');
  res.json(r.rows);
});
app.delete('/projects/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    await client.query('BEGIN');
    await client.query('UPDATE cash_movement SET project_id=NULL WHERE project_id=$1', [id]);
    await client.query('UPDATE purchase SET project_id=NULL WHERE project_id=$1', [id]);
    await client.query('UPDATE sale SET project_id=NULL WHERE project_id=$1', [id]);
    await client.query('UPDATE sale_collection SET project_id=NULL WHERE project_id=$1', [id]);
    await client.query('DELETE FROM project WHERE id=$1', [id]);
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: e.message });
  } finally {
    client.release();
  }
});

// ---------- SUPPLIERS / CUSTOMERS ----------
app.post('/suppliers', async (req, res) => {
  const { name, tax_id, phone, email, address } = req.body;
  const r = await pool.query(
    'INSERT INTO supplier (name, tax_id, phone, email, address) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [name, tax_id, phone, email, address]
  );
  res.json(r.rows[0]);
});
app.get('/suppliers', async (req, res) => {
  const r = await pool.query('SELECT * FROM supplier ORDER BY id');
  res.json(r.rows);
});
app.delete('/suppliers/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    await client.query('BEGIN');
    const purchases = await client.query('SELECT id FROM purchase WHERE supplier_id=$1', [id]);
    for (const p of purchases.rows) {
      await client.query('DELETE FROM purchase_item WHERE purchase_id=$1', [p.id]);
      await client.query('DELETE FROM stock_movement WHERE origin_type=$1 AND origin_id=$2', ['PURCHASE', p.id]);
      await client.query('DELETE FROM cash_movement WHERE origin_type=$1 AND origin_id=$2', ['PURCHASE', p.id]);
      await client.query('DELETE FROM purchase WHERE id=$1', [p.id]);
    }
    await client.query('DELETE FROM supplier_account_movement WHERE supplier_id=$1', [id]);
    await client.query('DELETE FROM supplier WHERE id=$1', [id]);
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: e.message });
  } finally {
    client.release();
  }
});

app.post('/customers', async (req, res) => {
  const { name, tax_id, phone, email, address } = req.body;
  const r = await pool.query(
    'INSERT INTO customer (name, tax_id, phone, email, address) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [name, tax_id, phone, email, address]
  );
  res.json(r.rows[0]);
});
app.get('/customers', async (req, res) => {
  const r = await pool.query('SELECT * FROM customer ORDER BY id');
  res.json(r.rows);
});
app.delete('/customers/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    await client.query('BEGIN');
    const sales = await client.query('SELECT id FROM sale WHERE customer_id=$1', [id]);
    for (const s of sales.rows) {
      await client.query('DELETE FROM sale_item WHERE sale_id=$1', [s.id]);
      await client.query('DELETE FROM stock_movement WHERE origin_type=$1 AND origin_id=$2', ['SALE', s.id]);
      await client.query('DELETE FROM sale_collection WHERE sale_id=$1', [s.id]);
      await client.query('DELETE FROM cash_movement WHERE origin_type=$1 AND origin_id=$2', ['SALE', s.id]);
      await client.query('DELETE FROM sale WHERE id=$1', [s.id]);
    }
    await client.query('DELETE FROM customer_account_movement WHERE customer_id=$1', [id]);
    await client.query('DELETE FROM customer WHERE id=$1', [id]);
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: e.message });
  } finally {
    client.release();
  }
});

// ---------- WAREHOUSES ----------
app.post('/warehouses', async (req, res) => {
  const { name, business_unit_id } = req.body;
  const r = await pool.query(
    'INSERT INTO warehouse (name, business_unit_id) VALUES ($1,$2) RETURNING *',
    [name, business_unit_id]
  );
  res.json(r.rows[0]);
});
app.get('/warehouses', async (req, res) => {
  const r = await pool.query('SELECT * FROM warehouse ORDER BY id');
  res.json(r.rows);
});
app.delete('/warehouses/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    await client.query('BEGIN');

    // Eliminar compras que usaron este depósito (con toda su cascada)
    const purchases = await client.query('SELECT id FROM purchase WHERE warehouse_id=$1', [id]);
    for (const p of purchases.rows) {
      await client.query('DELETE FROM purchase_item WHERE purchase_id=$1', [p.id]);
      await client.query('DELETE FROM stock_movement WHERE origin_type=$1 AND origin_id=$2', ['PURCHASE', p.id]);
      await client.query('DELETE FROM supplier_account_movement WHERE purchase_id=$1', [p.id]);
      await client.query('DELETE FROM cash_movement WHERE origin_type=$1 AND origin_id=$2', ['PURCHASE', p.id]);
      await client.query('DELETE FROM purchase WHERE id=$1', [p.id]);
    }
    // Eliminar ventas que usaron este depósito (con toda su cascada)
    const sales = await client.query('SELECT id FROM sale WHERE warehouse_id=$1', [id]);
    for (const s of sales.rows) {
      await client.query('DELETE FROM sale_item WHERE sale_id=$1', [s.id]);
      await client.query('DELETE FROM stock_movement WHERE origin_type=$1 AND origin_id=$2', ['SALE', s.id]);
      await client.query('DELETE FROM customer_account_movement WHERE sale_id=$1', [s.id]);
      await client.query('DELETE FROM sale_collection WHERE sale_id=$1', [s.id]);
      await client.query('DELETE FROM cash_movement WHERE origin_type=$1 AND origin_id=$2', ['SALE', s.id]);
      await client.query('DELETE FROM sale WHERE id=$1', [s.id]);
    }

    await client.query('DELETE FROM stock_movement WHERE warehouse_id=$1', [id]);
    await client.query('DELETE FROM stock WHERE warehouse_id=$1', [id]);
    await client.query('DELETE FROM warehouse WHERE id=$1', [id]);

    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: e.message });
  } finally {
    client.release();
  }
});

// ---------- ARTICLES ----------
app.post('/articles', async (req, res) => {
  const { business_unit_id, code, alt_code, description, list_cost, shipping_margin_pct, fx_margin_pct, profit_margin_pct, iva_pct, currency, notes } = req.body;
  const r = await pool.query(
    `INSERT INTO article (business_unit_id, code, alt_code, description, list_cost, shipping_margin_pct, fx_margin_pct, profit_margin_pct, iva_pct, currency, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [business_unit_id, code, alt_code || null, description, list_cost, shipping_margin_pct || 0, fx_margin_pct || 0, profit_margin_pct || 0, iva_pct != null ? iva_pct : 21, currency || 'ARS', notes || null]
  );
  res.json(r.rows[0]);
});
app.put('/articles/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { code, alt_code, description, list_cost, shipping_margin_pct, fx_margin_pct, profit_margin_pct, iva_pct, currency, notes } = req.body;
    const r = await pool.query(
      `UPDATE article SET code=$1, alt_code=$2, description=$3, list_cost=$4, shipping_margin_pct=$5, fx_margin_pct=$6, profit_margin_pct=$7, iva_pct=$8, currency=$9, notes=$10
       WHERE id=$11 RETURNING *`,
      [code, alt_code || null, description, list_cost, shipping_margin_pct || 0, fx_margin_pct || 0, profit_margin_pct || 0, iva_pct != null ? iva_pct : 21, currency || 'ARS', notes || null, id]
    );
    res.json(r.rows[0]);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
app.get('/articles', async (req, res) => {
  const r = await pool.query('SELECT * FROM article_price ORDER BY article_id');
  res.json(r.rows);
});

app.delete('/articles/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    await client.query('BEGIN');
    await client.query('DELETE FROM purchase_item WHERE article_id=$1', [id]);
    await client.query('DELETE FROM sale_item WHERE article_id=$1', [id]);
    await client.query('DELETE FROM stock_movement WHERE article_id=$1', [id]);
    await client.query('DELETE FROM stock WHERE article_id=$1', [id]);
    await client.query('DELETE FROM article WHERE id=$1', [id]);
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: e.message });
  } finally {
    client.release();
  }
});

// ---------- CASH BOX / SESSIONS ----------
app.get('/cash-boxes', async (req, res) => {
  const r = await pool.query('SELECT * FROM cash_box ORDER BY id');
  res.json(r.rows);
});

app.post('/cash-boxes', async (req, res) => {
  const client = await pool.connect();
  try {
    const { name, currency, kind } = req.body;
    await client.query('BEGIN');
    const boxR = await client.query(
      'INSERT INTO cash_box (name, currency, kind) VALUES ($1,$2,$3) RETURNING *',
      [name, currency || 'ARS', kind || 'CAJA']
    );
    const box = boxR.rows[0];
    await client.query(
      'INSERT INTO cash_session (cash_box_id, opening_amount, status) VALUES ($1,0,\'OPEN\')',
      [box.id]
    );
    await client.query('COMMIT');
    res.json(box);
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: e.message });
  } finally {
    client.release();
  }
});

app.delete('/cash-boxes/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM sale_collection WHERE cash_box_id=$1', [id]);
    await pool.query('DELETE FROM cash_movement WHERE cash_session_id IN (SELECT id FROM cash_session WHERE cash_box_id=$1)', [id]);
    await pool.query('DELETE FROM cash_session WHERE cash_box_id=$1', [id]);
    await pool.query('DELETE FROM cash_box WHERE id=$1', [id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/cash-boxes/dashboard', async (req, res) => {
  const r = await pool.query(`
    SELECT
      cb.id AS cash_box_id, cb.name, cb.currency, cb.kind,
      cs.id AS cash_session_id, cs.status AS session_status,
      COALESCE(SUM(cm.amount) FILTER (WHERE cm.type = 'INCOME'), 0) AS total_income,
      COALESCE(SUM(cm.amount) FILTER (WHERE cm.type = 'EXPENSE'), 0) AS total_expense,
      cs.opening_amount
        + COALESCE(SUM(cm.amount) FILTER (WHERE cm.type = 'INCOME'), 0)
        - COALESCE(SUM(cm.amount) FILTER (WHERE cm.type = 'EXPENSE'), 0) AS current_balance
    FROM cash_box cb
    LEFT JOIN cash_session cs ON cs.cash_box_id = cb.id
    LEFT JOIN cash_movement cm ON cm.cash_session_id = cs.id
    GROUP BY cb.id, cb.name, cb.currency, cb.kind, cs.id, cs.status, cs.opening_amount
    ORDER BY cb.kind, cb.id
  `);
  res.json(r.rows);
});

app.get('/cash-boxes/:id/movements', async (req, res) => {
  const { id } = req.params;
  const r = await pool.query(`
    SELECT cm.*, bu.name AS business_unit_name
    FROM cash_movement cm
    JOIN cash_session cs ON cs.id = cm.cash_session_id
    LEFT JOIN business_unit bu ON bu.id = cm.business_unit_id
    WHERE cs.cash_box_id = $1
    ORDER BY cm.created_at DESC
  `, [id]);
  res.json(r.rows);
});

function buildMovementsWorkbook(rows, sheetName) {
  const data = rows.map(r => ({
    Fecha: new Date(r.created_at).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' }),
    Caja: r.cash_box_name || '',
    'Unidad de negocio': r.business_unit_name || '',
    Tipo: r.type === 'INCOME' ? 'Ingreso' : 'Egreso',
    Monto: Number(r.amount),
    Descripción: r.description || '',
    Origen: r.origin_type || '',
    'N° Origen': r.origin_id || '',
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  ws['!cols'] = [{ wch: 18 }, { wch: 16 }, { wch: 18 }, { wch: 10 }, { wch: 14 }, { wch: 30 }, { wch: 12 }, { wch: 10 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

app.get('/cash-boxes/:id/export', async (req, res) => {
  const { id } = req.params;
  const r = await pool.query(`
    SELECT cm.*, cb.name AS cash_box_name, bu.name AS business_unit_name
    FROM cash_movement cm
    JOIN cash_session cs ON cs.id = cm.cash_session_id
    JOIN cash_box cb ON cb.id = cs.cash_box_id
    LEFT JOIN business_unit bu ON bu.id = cm.business_unit_id
    WHERE cs.cash_box_id = $1
    ORDER BY cm.created_at DESC
  `, [id]);
  const boxName = r.rows[0]?.cash_box_name || 'caja';
  const buffer = buildMovementsWorkbook(r.rows, boxName.substring(0, 30));
  res.setHeader('Content-Disposition', `attachment; filename="movimientos_${boxName.replace(/\s+/g, '_')}.xlsx"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buffer);
});

app.get('/cash-movements/export-manual', async (req, res) => {
  const r = await pool.query(`
    SELECT cm.*, cb.name AS cash_box_name, bu.name AS business_unit_name
    FROM cash_movement cm
    JOIN cash_session cs ON cs.id = cm.cash_session_id
    JOIN cash_box cb ON cb.id = cs.cash_box_id
    LEFT JOIN business_unit bu ON bu.id = cm.business_unit_id
    WHERE cm.origin_type = 'MANUAL'
    ORDER BY cm.created_at DESC
  `);
  const buffer = buildMovementsWorkbook(r.rows, 'Movimientos manuales');
  res.setHeader('Content-Disposition', `attachment; filename="movimientos_manuales.xlsx"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buffer);
});

app.post('/cash-sessions/:id/close', async (req, res) => {
  const { id } = req.params;
  const { closing_amount } = req.body;
  await pool.query('SELECT fn_close_cash_session($1,$2)', [id, closing_amount]);
  const r = await pool.query('SELECT * FROM daily_cash_summary WHERE session_id = $1', [id]);
  res.json(r.rows[0]);
});

app.put('/cash-sessions/:id/opening', async (req, res) => {
  try {
    const { id } = req.params;
    const { opening_amount } = req.body;
    const r = await pool.query('UPDATE cash_session SET opening_amount=$1 WHERE id=$2 RETURNING *', [opening_amount, id]);
    res.json(r.rows[0]);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/cash-sessions/:id/reopen', async (req, res) => {
  const { id } = req.params;
  const r = await pool.query(`UPDATE cash_session SET status='OPEN', closed_at=NULL WHERE id=$1 RETURNING *`, [id]);
  res.json(r.rows[0]);
});

app.get('/cash-sessions/:id/summary', async (req, res) => {
  const { id } = req.params;
  const r = await pool.query('SELECT * FROM daily_cash_summary WHERE session_id = $1', [id]);
  res.json(r.rows[0]);
});

app.post('/cash-movements', async (req, res) => {
  const { cash_box_id, business_unit_id, project_id, type, amount, description } = req.body;
  const sessionR = await pool.query(`SELECT id FROM cash_session WHERE cash_box_id=$1 AND status='OPEN' LIMIT 1`, [cash_box_id]);
  const session = sessionR.rows[0];
  if (!session) return res.status(400).json({ error: 'Esa caja no tiene una sesión abierta.' });
  const r = await pool.query(
    `INSERT INTO cash_movement (cash_session_id, business_unit_id, project_id, type, amount, description, origin_type)
     VALUES ($1,$2,$3,$4,$5,$6,'MANUAL') RETURNING *`,
    [session.id, business_unit_id, project_id || null, type, amount, description]
  );
  res.json(r.rows[0]);
});

app.delete('/cash-movements/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM cash_movement WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---------- PURCHASES ----------
app.post('/purchases', async (req, res) => {
  const client = await pool.connect();
  try {
    const { business_unit_id, supplier_id, warehouse_id, project_id, cash_box_id, payment_type, items } = req.body;
    await client.query('BEGIN');

    const purchaseR = await client.query(
      `INSERT INTO purchase (business_unit_id, supplier_id, warehouse_id, project_id, cash_box_id, payment_type)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [business_unit_id, supplier_id, warehouse_id, project_id || null, cash_box_id || null, payment_type]
    );
    const purchase = purchaseR.rows[0];

    for (const item of items) {
      await client.query(
        `INSERT INTO purchase_item (purchase_id, article_id, quantity, unit_cost)
         VALUES ($1,$2,$3,$4)`,
        [purchase.id, item.article_id, item.quantity, item.unit_cost]
      );
    }

    await client.query('COMMIT');
    const full = await pool.query('SELECT * FROM purchase WHERE id=$1', [purchase.id]);
    res.json(full.rows[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: e.message });
  } finally {
    client.release();
  }
});

app.post('/purchases/:id/confirm', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query(`UPDATE purchase SET status='CONFIRMED' WHERE id=$1`, [id]);
    const r = await pool.query('SELECT * FROM purchase_detail WHERE purchase_id=$1', [id]);
    res.json(r.rows);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/purchases/:id/cancel', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query(`UPDATE purchase SET status='CANCELLED' WHERE id=$1`, [id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/purchases', async (req, res) => {
  const r = await pool.query('SELECT * FROM purchase ORDER BY id DESC');
  res.json(r.rows);
});

app.delete('/purchases/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM purchase_item WHERE purchase_id=$1', [id]);
    await pool.query('DELETE FROM stock_movement WHERE origin_type=$1 AND origin_id=$2', ['PURCHASE', id]);
    await pool.query('DELETE FROM supplier_account_movement WHERE purchase_id=$1', [id]);
    await pool.query('DELETE FROM cash_movement WHERE origin_type=$1 AND origin_id=$2', ['PURCHASE', id]);
    await pool.query('DELETE FROM purchase WHERE id=$1', [id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---------- SALES ----------
app.post('/sales', async (req, res) => {
  const client = await pool.connect();
  try {
    const { business_unit_id, customer_id, warehouse_id, project_id, cash_box_id, payment_type, currency, total_override, items } = req.body;
    await client.query('BEGIN');

    const saleR = await client.query(
      `INSERT INTO sale (business_unit_id, customer_id, warehouse_id, project_id, cash_box_id, payment_type, currency)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [business_unit_id, customer_id, warehouse_id, project_id || null, cash_box_id || null, payment_type || 'CASH', currency || 'ARS']
    );
    const sale = saleR.rows[0];

    for (const item of items) {
      await client.query(
        `INSERT INTO sale_item (sale_id, article_id, quantity, unit_price)
         VALUES ($1,$2,$3,$4)`,
        [sale.id, item.article_id, item.quantity, item.unit_price]
      );
    }

    if (total_override != null && total_override !== '') {
      await client.query('UPDATE sale SET total_amount=$1 WHERE id=$2', [Number(total_override), sale.id]);
    }

    await client.query('COMMIT');
    const full = await pool.query('SELECT * FROM sale WHERE id=$1', [sale.id]);
    res.json(full.rows[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: e.message });
  } finally {
    client.release();
  }
});

app.post('/sales/:id/confirm', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query(`UPDATE sale SET status='CONFIRMED' WHERE id=$1`, [id]);
    const r = await pool.query('SELECT * FROM sale_detail WHERE sale_id=$1', [id]);
    res.json(r.rows);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/sales/:id/cancel', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query(`UPDATE sale SET status='CANCELLED' WHERE id=$1`, [id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/sales', async (req, res) => {
  const r = await pool.query('SELECT * FROM sale ORDER BY id DESC');
  res.json(r.rows);
});

app.get('/sales/:id/items', async (req, res) => {
  const r = await pool.query(`
    SELECT si.*, a.code, a.description
    FROM sale_item si
    JOIN article a ON a.id = si.article_id
    WHERE si.sale_id=$1
  `, [req.params.id]);
  res.json(r.rows);
});

app.delete('/sales/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM sale_item WHERE sale_id=$1', [id]);
    await pool.query('DELETE FROM stock_movement WHERE origin_type=$1 AND origin_id=$2', ['SALE', id]);
    await pool.query('DELETE FROM customer_account_movement WHERE sale_id=$1', [id]);
    await pool.query('DELETE FROM sale_collection WHERE sale_id=$1', [id]);
    await pool.query('DELETE FROM cash_movement WHERE origin_type=$1 AND origin_id=$2', ['SALE', id]);
    await pool.query('DELETE FROM sale WHERE id=$1', [id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/sales/pending-collection', async (req, res) => {
  const r = await pool.query('SELECT * FROM sale_pending_collection ORDER BY date DESC');
  res.json(r.rows);
});

app.post('/sales/:id/collect', async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { splits } = req.body; // [{ cash_box_id, amount, project_id }]
    if (!splits || !splits.length) throw new Error('Agregá al menos una caja con un monto.');

    await client.query('BEGIN');

    const saleR = await client.query('SELECT * FROM sale WHERE id=$1 FOR UPDATE', [id]);
    const sale = saleR.rows[0];
    if (!sale) throw new Error('Venta no encontrada.');
    if (sale.payment_type !== 'UNCOLLECTED') throw new Error('Esta venta no está marcada como pendiente de cobro.');

    const remaining = Number(sale.total_amount) - Number(sale.settled_amount);
    const splitTotal = splits.reduce((a, s) => a + Number(s.amount), 0);
    if (splitTotal <= 0) throw new Error('El monto a cobrar debe ser mayor a cero.');
    if (splitTotal > remaining + 0.01) throw new Error(`El total a cobrar ($${splitTotal}) supera el saldo pendiente ($${remaining}).`);

    for (const split of splits) {
      const sessionR = await client.query(
        `SELECT id FROM cash_session WHERE cash_box_id=$1 AND status='OPEN' LIMIT 1`,
        [split.cash_box_id]
      );
      const session = sessionR.rows[0];
      if (!session) throw new Error(`La caja seleccionada no tiene una sesión abierta.`);

      await client.query(
        `INSERT INTO sale_collection (sale_id, cash_box_id, cash_session_id, business_unit_id, project_id, amount)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [sale.id, split.cash_box_id, session.id, sale.business_unit_id, split.project_id || null, split.amount]
      );
      await client.query(
        `INSERT INTO cash_movement (cash_session_id, business_unit_id, project_id, type, amount, description, origin_type, origin_id)
         VALUES ($1,$2,$3,'INCOME',$4,$5,'SALE',$6)`,
        [session.id, sale.business_unit_id, split.project_id || null, split.amount, `Cobro Venta #${sale.id}`, sale.id]
      );
    }

    await client.query('UPDATE sale SET settled_amount = settled_amount + $1 WHERE id=$2', [splitTotal, sale.id]);

    await client.query('COMMIT');
    const updated = await pool.query('SELECT * FROM sale_pending_collection WHERE id=$1', [id]);
    res.json(updated.rows[0] || { ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: e.message });
  } finally {
    client.release();
  }
});

// ---------- STOCK ----------
app.get('/stock', async (req, res) => {
  const r = await pool.query(`
    SELECT s.*, a.code, a.description, w.name AS warehouse_name
    FROM stock s
    JOIN article a ON a.id = s.article_id
    JOIN warehouse w ON w.id = s.warehouse_id
    ORDER BY w.name, a.code
  `);
  res.json(r.rows);
});

app.get('/stock/kardex/:article_id', async (req, res) => {
  const { article_id } = req.params;
  const r = await pool.query('SELECT * FROM article_kardex WHERE article_id=$1', [article_id]);
  res.json(r.rows);
});

app.delete('/stock/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM stock WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.put('/stock/set', async (req, res) => {
  const client = await pool.connect();
  try {
    const { article_id, warehouse_id, quantity } = req.body;
    if (quantity == null || Number(quantity) < 0) throw new Error('La cantidad debe ser un número mayor o igual a cero.');
    const newQty = Number(quantity);

    await client.query('BEGIN');
    const current = await client.query(
      'SELECT quantity FROM stock WHERE warehouse_id=$1 AND article_id=$2 FOR UPDATE',
      [warehouse_id, article_id]
    );
    const currentQty = Number(current.rows[0]?.quantity || 0);
    const delta = newQty - currentQty;

    await client.query(
      `INSERT INTO stock (warehouse_id, article_id, quantity) VALUES ($1,$2,$3)
       ON CONFLICT (warehouse_id, article_id) DO UPDATE SET quantity = $3`,
      [warehouse_id, article_id, newQty]
    );
    if (delta !== 0) {
      await client.query(
        `INSERT INTO stock_movement (warehouse_id, article_id, type, quantity, origin_type) VALUES ($1,$2,$3,$4,'ADJUSTMENT')`,
        [warehouse_id, article_id, delta > 0 ? 'IN' : 'OUT', Math.abs(delta)]
      );
    }
    await client.query('COMMIT');
    res.json({ ok: true, quantity: newQty });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: e.message });
  } finally {
    client.release();
  }
});

app.post('/stock/transfer', async (req, res) => {
  const client = await pool.connect();
  try {
    const { article_id, from_warehouse_id, to_warehouse_id, quantity } = req.body;
    if (from_warehouse_id === to_warehouse_id) throw new Error('El depósito de origen y destino deben ser distintos.');
    if (!(quantity > 0)) throw new Error('La cantidad debe ser mayor a cero.');

    await client.query('BEGIN');
    const stockR = await client.query(
      'SELECT quantity FROM stock WHERE warehouse_id=$1 AND article_id=$2 FOR UPDATE',
      [from_warehouse_id, article_id]
    );
    const available = Number(stockR.rows[0]?.quantity || 0);
    if (available < quantity) throw new Error(`Stock insuficiente en el depósito de origen (disponible: ${available}).`);

    await client.query(
      'UPDATE stock SET quantity = quantity - $1 WHERE warehouse_id=$2 AND article_id=$3',
      [quantity, from_warehouse_id, article_id]
    );
    await client.query(
      `INSERT INTO stock (warehouse_id, article_id, quantity) VALUES ($1,$2,$3)
       ON CONFLICT (warehouse_id, article_id) DO UPDATE SET quantity = stock.quantity + EXCLUDED.quantity`,
      [to_warehouse_id, article_id, quantity]
    );
    await client.query(
      `INSERT INTO stock_movement (warehouse_id, article_id, type, quantity, origin_type) VALUES ($1,$2,'OUT',$3,'ADJUSTMENT')`,
      [from_warehouse_id, article_id, quantity]
    );
    await client.query(
      `INSERT INTO stock_movement (warehouse_id, article_id, type, quantity, origin_type) VALUES ($1,$2,'IN',$3,'ADJUSTMENT')`,
      [to_warehouse_id, article_id, quantity]
    );
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: e.message });
  } finally {
    client.release();
  }
});

app.post('/stock/adjust', async (req, res) => {
  const client = await pool.connect();
  try {
    const { article_id, warehouse_id, quantity, type } = req.body; // type: 'IN' | 'OUT'
    if (!(quantity > 0)) throw new Error('La cantidad debe ser mayor a cero.');

    await client.query('BEGIN');
    if (type === 'OUT') {
      const stockR = await client.query(
        'SELECT quantity FROM stock WHERE warehouse_id=$1 AND article_id=$2 FOR UPDATE',
        [warehouse_id, article_id]
      );
      const available = Number(stockR.rows[0]?.quantity || 0);
      if (available < quantity) throw new Error(`Stock insuficiente (disponible: ${available}).`);
      await client.query('UPDATE stock SET quantity = quantity - $1 WHERE warehouse_id=$2 AND article_id=$3', [quantity, warehouse_id, article_id]);
    } else {
      await client.query(
        `INSERT INTO stock (warehouse_id, article_id, quantity) VALUES ($1,$2,$3)
         ON CONFLICT (warehouse_id, article_id) DO UPDATE SET quantity = stock.quantity + EXCLUDED.quantity`,
        [warehouse_id, article_id, quantity]
      );
    }
    await client.query(
      `INSERT INTO stock_movement (warehouse_id, article_id, type, quantity, origin_type) VALUES ($1,$2,$3,$4,'ADJUSTMENT')`,
      [warehouse_id, article_id, type, quantity]
    );
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: e.message });
  } finally {
    client.release();
  }
});

app.delete('/stock-movements/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const movR = await client.query('SELECT * FROM stock_movement WHERE id=$1', [id]);
    const mov = movR.rows[0];
    if (!mov) throw new Error('Movimiento no encontrado.');

    await client.query('BEGIN');
    const delta = mov.type === 'IN' ? -Number(mov.quantity) : Number(mov.quantity);
    await client.query(
      `INSERT INTO stock (warehouse_id, article_id, quantity) VALUES ($1,$2,0)
       ON CONFLICT (warehouse_id, article_id) DO NOTHING`,
      [mov.warehouse_id, mov.article_id]
    );
    await client.query(
      `UPDATE stock SET quantity = quantity + $1 WHERE warehouse_id=$2 AND article_id=$3`,
      [delta, mov.warehouse_id, mov.article_id]
    );
    await client.query('DELETE FROM stock_movement WHERE id=$1', [id]);
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    const msg = e.message.includes('chk_stock_non_negative')
      ? 'No se puede eliminar: dejaría el stock del depósito en negativo (hay salidas posteriores que dependen de esta carga).'
      : e.message;
    res.status(400).json({ error: msg });
  } finally {
    client.release();
  }
});

// ---------- PROJECT PROFITABILITY ----------
app.get('/projects/profitability', async (req, res) => {
  const r = await pool.query('SELECT * FROM project_profitability ORDER BY project_id');
  res.json(r.rows);
});

// ---------- BALANCES ----------
app.get('/suppliers/:id/balance', async (req, res) => {
  const { id } = req.params;
  const r = await pool.query('SELECT * FROM supplier_balance WHERE supplier_id=$1', [id]);
  res.json(r.rows[0] || { supplier_id: id, balance: 0 });
});

app.get('/customers/:id/balance', async (req, res) => {
  const { id } = req.params;
  const r = await pool.query('SELECT * FROM customer_balance WHERE customer_id=$1', [id]);
  res.json(r.rows[0] || { customer_id: id, balance: 0 });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`ERP API corriendo en puerto ${PORT}`));
