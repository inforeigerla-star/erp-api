const express = require('express');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const XLSX = require('xlsx');
require('dotenv').config();
const pool = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'cambiar-este-secreto-en-produccion';

const app = express();
// Nota (Roadmap Etapa 1 — Seguridad de acceso, jul.2026): antes acá había
// `app.use(cors())` sin restricciones, abierto a cualquier origen. Se sacó:
// el frontend se sirve desde este mismo servidor (`express.static` más abajo),
// así que el navegador siempre llama a la API desde el mismo origen y nunca
// necesitó CORS para funcionar. Sacarlo cierra la puerta a que un sitio
// externo llame a esta API desde el navegador de un usuario logueado, sin
// ningún efecto sobre el funcionamiento normal de la app.
app.use(express.json({ limit: '25mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- AUTH MIDDLEWARE ----------
// (Roadmap Etapa 1) Antes solo se validaba la firma/vigencia del token. Ahora
// también se chequea que el usuario siga activo en ese mismo momento, para
// que "Desactivar" en Usuarios corte el acceso al instante en vez de esperar
// a que el token expire solo (hasta 12hs después). Es una consulta extra por
// pedido, sobre la clave primaria de app_user — costo insignificante para el
// volumen de uso de este sistema.
async function authRequired(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'No autenticado' });
  const token = header.replace('Bearer ', '');
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const r = await pool.query('SELECT active FROM app_user WHERE id=$1', [payload.id]);
    if (!r.rows[0]?.active) return res.status(401).json({ error: 'Sesión inválida o expirada' });
    req.user = payload;
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
// (Roadmap Etapa 1) Límite de intentos fallidos de login: en memoria, por
// nombre de usuario (no hace falta un paquete nuevo ni una tabla — se
// reinicia solo en cada redeploy, lo cual es aceptable para este caso de
// uso). 5 intentos fallidos seguidos → 15 minutos de espera. Se resetea en
// cualquier login exitoso.
const loginAttempts = new Map(); // username en minúsculas -> { count, blockedUntil }
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_BLOCK_MS = 15 * 60 * 1000;

app.post('/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const key = String(username || '').toLowerCase();
    const attempt = loginAttempts.get(key);
    if (attempt?.blockedUntil && attempt.blockedUntil > Date.now()) {
      const minutesLeft = Math.ceil((attempt.blockedUntil - Date.now()) / 60000);
      return res.status(429).json({ error: `Demasiados intentos fallidos. Probá de nuevo en ${minutesLeft} minuto(s).` });
    }
    const r = await pool.query('SELECT * FROM app_user WHERE username=$1 AND active=true', [username]);
    const user = r.rows[0];
    const ok = user && await bcrypt.compare(password, user.password_hash);
    if (!user || !ok) {
      const current = loginAttempts.get(key) || { count: 0 };
      current.count++;
      if (current.count >= LOGIN_MAX_ATTEMPTS) {
        current.blockedUntil = Date.now() + LOGIN_BLOCK_MS;
        current.count = 0;
      }
      loginAttempts.set(key, current);
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    }
    loginAttempts.delete(key);
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

// ---------- AUDITORÍA DE EDICIONES (Compras/Ventas — Bloque 1) ----------
// Distinta del "activity_log" de arriba: ese es un log general de toda
// acción no-GET con un resumen corto (para uso interno/soporte). Esta tabla
// es específica para el historial de auditoría que pidió Matias sobre la
// edición de Compras/Ventas (a partir del Bloque 2): usuario, fecha/hora,
// valores anteriores y nuevos de cada cambio, por registro puntual. Todavía
// no la llama nadie — este bloque solo deja la infraestructura lista.
async function logAudit(client, { tableName, recordId, action, oldValues, newValues, userId }) {
  await client.query(
    `INSERT INTO audit_log (table_name, record_id, action, old_values, new_values, changed_by)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [tableName, recordId, action, oldValues ? JSON.stringify(oldValues) : null, newValues ? JSON.stringify(newValues) : null, userId || null]
  );
}

app.get('/audit-log/:tableName/:recordId', async (req, res) => {
  const { tableName, recordId } = req.params;
  const r = await pool.query(
    `SELECT al.*, u.username AS changed_by_username
     FROM audit_log al
     LEFT JOIN app_user u ON u.id = al.changed_by
     WHERE al.table_name = $1 AND al.record_id = $2
     ORDER BY al.changed_at DESC`,
    [tableName, recordId]
  );
  res.json(r.rows);
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
  const r = await pool.query('SELECT id, username, role, permissions, active, created_at FROM app_user WHERE deleted_at IS NULL ORDER BY id');
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
  await pool.query('UPDATE app_user SET deleted_at=now(), active=false WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

// ---------- PAPELERA (soft-delete, 30 días) ----------
const TRASH_TABLES = {
  'business-units': { table: 'business_unit', nameCol: 'name', label: 'Unidad de negocio' },
  'projects': { table: 'project', nameCol: 'name', label: 'Proyecto' },
  'suppliers': { table: 'supplier', nameCol: 'name', label: 'Proveedor' },
  'customers': { table: 'customer', nameCol: 'name', label: 'Cliente' },
  'warehouses': { table: 'warehouse', nameCol: 'name', label: 'Depósito' },
  'articles': { table: 'article', nameCol: 'description', label: 'Artículo' },
  'cash-boxes': { table: 'cash_box', nameCol: 'name', label: 'Caja/Sobre' },
  'users': { table: 'app_user', nameCol: 'username', label: 'Usuario' },
  'purchases': { table: 'purchase', nameCol: `('Compra #' || id)`, label: 'Compra' },
  'sales': { table: 'sale', nameCol: `('Venta #' || id)`, label: 'Venta' },
  'quotes': { table: 'quote', nameCol: `('Presupuesto #' || id)`, label: 'Presupuesto' },
  'shipments': { table: 'shipment', nameCol: `('Remito #' || id)`, label: 'Remito de envío' },
};

async function purgeExpiredTrash() {
  for (const key in TRASH_TABLES) {
    const { table } = TRASH_TABLES[key];
    try {
      await pool.query(`DELETE FROM ${table} WHERE deleted_at IS NOT NULL AND deleted_at < now() - interval '30 days'`);
    } catch (e) {
      console.error(`Error purgando ${table}:`, e.message);
    }
  }
}
setInterval(purgeExpiredTrash, 1000 * 60 * 60); // cada 1 hora

app.get('/trash', adminRequired, async (req, res) => {
  await purgeExpiredTrash();
  const results = [];
  for (const key in TRASH_TABLES) {
    const { table, nameCol, label } = TRASH_TABLES[key];
    const r = await pool.query(
      `SELECT id, ${nameCol} AS name, deleted_at FROM ${table} WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`
    );
    r.rows.forEach(row => {
      const daysElapsed = (Date.now() - new Date(row.deleted_at).getTime()) / (1000 * 60 * 60 * 24);
      results.push({
        type: key, type_label: label, id: row.id, name: row.name,
        deleted_at: row.deleted_at, days_remaining: Math.max(0, Math.ceil(30 - daysElapsed)),
      });
    });
  }
  results.sort((a, b) => new Date(b.deleted_at) - new Date(a.deleted_at));
  res.json(results);
});

app.post('/trash/:type/:id/restore', adminRequired, async (req, res) => {
  const { type, id } = req.params;
  const config = TRASH_TABLES[type];
  if (!config) return res.status(400).json({ error: 'Tipo inválido.' });
  try {
    await pool.query(`UPDATE ${config.table} SET deleted_at=NULL WHERE id=$1`, [id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/trash/:type/:id', adminRequired, async (req, res) => {
  const { type, id } = req.params;
  const config = TRASH_TABLES[type];
  if (!config) return res.status(400).json({ error: 'Tipo inválido.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Limpiar filas dependientes según el tipo, para poder purgar sin violar FKs.
    if (type === 'articles') {
      await client.query('DELETE FROM stock_movement WHERE article_id=$1', [id]);
      await client.query('DELETE FROM stock WHERE article_id=$1', [id]);
      await client.query('DELETE FROM purchase_item WHERE article_id=$1', [id]);
      await client.query('DELETE FROM sale_item WHERE article_id=$1', [id]);
      await client.query('DELETE FROM quote_item WHERE article_id=$1', [id]);
    } else if (type === 'warehouses') {
      await client.query('DELETE FROM stock_movement WHERE warehouse_id=$1', [id]);
      await client.query('DELETE FROM stock WHERE warehouse_id=$1', [id]);
    } else if (type === 'cash-boxes') {
      await client.query('DELETE FROM sale_collection WHERE cash_box_id=$1', [id]);
      await client.query('DELETE FROM purchase_payment WHERE cash_box_id=$1', [id]);
      await client.query('DELETE FROM cash_movement WHERE cash_session_id IN (SELECT id FROM cash_session WHERE cash_box_id=$1)', [id]);
      await client.query('DELETE FROM cash_session WHERE cash_box_id=$1', [id]);
    } else if (type === 'purchases') {
      await client.query('DELETE FROM purchase_item WHERE purchase_id=$1', [id]);
      await client.query('DELETE FROM stock_movement WHERE origin_type=$1 AND origin_id=$2', ['PURCHASE', id]);
      await client.query('DELETE FROM supplier_account_movement WHERE purchase_id=$1', [id]);
      await client.query('UPDATE purchase_payment SET cash_movement_id=NULL WHERE purchase_id=$1', [id]);
      await client.query('DELETE FROM purchase_payment WHERE purchase_id=$1', [id]);
    } else if (type === 'sales') {
      await client.query('DELETE FROM sale_document_log WHERE sale_id=$1', [id]);
      await client.query('DELETE FROM sale_item WHERE sale_id=$1', [id]);
      await client.query('DELETE FROM stock_movement WHERE origin_type=$1 AND origin_id=$2', ['SALE', id]);
      await client.query('DELETE FROM customer_account_movement WHERE sale_id=$1', [id]);
      await client.query('UPDATE sale_collection SET cash_movement_id=NULL WHERE sale_id=$1', [id]);
      await client.query('DELETE FROM sale_collection WHERE sale_id=$1', [id]);
    } else if (type === 'quotes') {
      await client.query('UPDATE sale SET quote_id=NULL WHERE quote_id=$1', [id]);
      await client.query('DELETE FROM quote_item WHERE quote_id=$1', [id]);
    } else if (type === 'shipments') {
      await client.query('DELETE FROM shipment_item WHERE shipment_id=$1', [id]);
      await client.query('DELETE FROM stock_movement WHERE origin_type=$1 AND origin_id=$2', ['SHIPMENT', id]);
    } else if (type === 'business-units') {
      const usedR = await client.query('SELECT COUNT(*) FROM cash_movement WHERE business_unit_id=$1', [id]);
      if (Number(usedR.rows[0].count) > 0) {
        throw new Error('Esta unidad tiene movimientos de caja en su historial y no se puede purgar definitivamente (para no perder ese registro financiero). Podés dejarla restaurada o mantenerla en la papelera.');
      }
    }
    await client.query(`DELETE FROM ${config.table} WHERE id=$1 AND deleted_at IS NOT NULL`, [id]);
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: e.message });
  } finally {
    client.release();
  }
});

app.get('/activity-log', adminRequired, async (req, res) => {
  const { date_from, date_to, page, limit } = req.query;
  const pageNum = Math.max(1, parseInt(page) || 1);
  const pageSize = Math.min(200, Math.max(10, parseInt(limit) || 50));
  const offset = (pageNum - 1) * pageSize;

  const conditions = [];
  const values = [];
  let i = 1;
  if (date_from) { conditions.push(`created_at >= $${i++}`); values.push(date_from); }
  if (date_to) { conditions.push(`created_at < ($${i++}::date + interval '1 day')`); values.push(date_to); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const countR = await pool.query(`SELECT COUNT(*) FROM activity_log ${where}`, values);
  const rowsR = await pool.query(
    `SELECT * FROM activity_log ${where} ORDER BY created_at DESC LIMIT $${i} OFFSET $${i + 1}`,
    [...values, pageSize, offset]
  );
  res.json({ rows: rowsR.rows, total: Number(countR.rows[0].count), page: pageNum, limit: pageSize });
});

// ---------- BUSINESS UNITS ----------
app.get('/business-units', async (req, res) => {
  const r = await pool.query('SELECT * FROM business_unit WHERE deleted_at IS NULL ORDER BY id');
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
    await pool.query('UPDATE business_unit SET deleted_at=now() WHERE id=$1', [req.params.id]);
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
  const r = await pool.query('SELECT * FROM project WHERE deleted_at IS NULL ORDER BY id');
  res.json(r.rows);
});
app.get('/projects/list', async (req, res) => {
  const { business_unit_id, search, page, limit } = req.query;
  const pageNum = Math.max(1, parseInt(page) || 1);
  const pageSize = Math.min(200, Math.max(10, parseInt(limit) || 50));
  const offset = (pageNum - 1) * pageSize;

  const conditions = ['deleted_at IS NULL'];
  const values = [];
  let i = 1;
  if (business_unit_id) { conditions.push(`business_unit_id = $${i++}`); values.push(business_unit_id); }
  if (search) { conditions.push(`name ILIKE $${i++}`); values.push(`%${search}%`); }
  const where = `WHERE ${conditions.join(' AND ')}`;

  const countR = await pool.query(`SELECT COUNT(*) FROM project ${where}`, values);
  const rowsR = await pool.query(
    `SELECT * FROM project ${where} ORDER BY name LIMIT $${i} OFFSET $${i + 1}`,
    [...values, pageSize, offset]
  );
  res.json({ rows: rowsR.rows, total: Number(countR.rows[0].count), page: pageNum, limit: pageSize });
});
app.put('/projects/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;
    const r = await pool.query('UPDATE project SET name=$1 WHERE id=$2 RETURNING *', [name, id]);
    res.json(r.rows[0]);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
app.delete('/projects/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('UPDATE project SET deleted_at=now() WHERE id=$1', [id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
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
  const r = await pool.query('SELECT * FROM supplier WHERE deleted_at IS NULL ORDER BY id');
  res.json(r.rows);
});
app.get('/suppliers/list', async (req, res) => {
  const { search, page, limit } = req.query;
  const pageNum = Math.max(1, parseInt(page) || 1);
  const pageSize = Math.min(200, Math.max(10, parseInt(limit) || 50));
  const offset = (pageNum - 1) * pageSize;

  const conditions = ['s.deleted_at IS NULL'];
  const values = [];
  let i = 1;
  if (search) { conditions.push(`(s.name ILIKE $${i} OR s.tax_id ILIKE $${i})`); values.push(`%${search}%`); i++; }
  const where = `WHERE ${conditions.join(' AND ')}`;

  const countR = await pool.query(`SELECT COUNT(*) FROM supplier s ${where}`, values);
  const rowsR = await pool.query(
    `SELECT s.*, COALESCE(sb.balance, 0) AS balance
     FROM supplier s LEFT JOIN supplier_balance sb ON sb.supplier_id = s.id
     ${where} ORDER BY s.name LIMIT $${i} OFFSET $${i + 1}`,
    [...values, pageSize, offset]
  );
  res.json({ rows: rowsR.rows, total: Number(countR.rows[0].count), page: pageNum, limit: pageSize });
});
app.put('/suppliers/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, tax_id, phone, email, address } = req.body;
    const r = await pool.query(
      'UPDATE supplier SET name=$1, tax_id=$2, phone=$3, email=$4, address=$5 WHERE id=$6 RETURNING *',
      [name, tax_id, phone, email, address, id]
    );
    res.json(r.rows[0]);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
app.delete('/suppliers/:id', async (req, res) => {
  try {
    await pool.query('UPDATE supplier SET deleted_at=now() WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
// (Roadmap Etapa 5) Cuenta corriente de proveedor — mismo criterio que
// /customers/:id/statement de arriba.
app.get('/suppliers/:id/statement', async (req, res) => {
  try {
    const { id } = req.params;
    const r = await pool.query(`
      SELECT p.id, p.date, p.total_amount, p.settled_amount, p.status, p.business_unit_id, bu.name AS business_unit_name
      FROM purchase p JOIN business_unit bu ON bu.id = p.business_unit_id
      WHERE p.supplier_id=$1 AND p.deleted_at IS NULL AND p.status <> 'CANCELLED'
      ORDER BY p.date ASC, p.id ASC
    `, [id]);
    res.json(r.rows);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
app.post('/suppliers/bulk-import', async (req, res) => {
  const client = await pool.connect();
  try {
    const { suppliers } = req.body;
    if (!suppliers || !suppliers.length) throw new Error('No se recibieron proveedores para importar.');
    await client.query('BEGIN');
    let created = 0;
    const errors = [];
    for (const s of suppliers) {
      try {
        await client.query(
          'INSERT INTO supplier (name, tax_id, phone, email, address) VALUES ($1,$2,$3,$4,$5)',
          [s.name, s.tax_id || null, s.phone || null, s.email || null, s.address || null]
        );
        created++;
      } catch (e) {
        errors.push({ name: s.name, error: e.message });
      }
    }
    await client.query('COMMIT');
    res.json({ created, failed: errors.length, errors: errors.slice(0, 50) });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: e.message });
  } finally {
    client.release();
  }
});

app.post('/customers', async (req, res) => {
  const { name, tax_id, phone, email, address, street, street_number, locality, province, country, postal_code } = req.body;
  const r = await pool.query(
    `INSERT INTO customer (name, tax_id, phone, email, address, street, street_number, locality, province, country, postal_code)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [name, tax_id, phone, email, address, street, street_number, locality, province, country || 'Argentina', postal_code]
  );
  res.json(r.rows[0]);
});
app.get('/customers', async (req, res) => {
  const r = await pool.query('SELECT * FROM customer WHERE deleted_at IS NULL ORDER BY id');
  res.json(r.rows);
});
app.get('/customers/list', async (req, res) => {
  const { search, page, limit } = req.query;
  const pageNum = Math.max(1, parseInt(page) || 1);
  const pageSize = Math.min(200, Math.max(10, parseInt(limit) || 50));
  const offset = (pageNum - 1) * pageSize;

  const conditions = ['c.deleted_at IS NULL'];
  const values = [];
  let i = 1;
  if (search) { conditions.push(`(c.name ILIKE $${i} OR c.tax_id ILIKE $${i})`); values.push(`%${search}%`); i++; }
  const where = `WHERE ${conditions.join(' AND ')}`;

  const countR = await pool.query(`SELECT COUNT(*) FROM customer c ${where}`, values);
  const rowsR = await pool.query(
    `SELECT c.*, COALESCE(cb.balance, 0) AS balance
     FROM customer c LEFT JOIN customer_balance cb ON cb.customer_id = c.id
     ${where} ORDER BY c.name LIMIT $${i} OFFSET $${i + 1}`,
    [...values, pageSize, offset]
  );
  res.json({ rows: rowsR.rows, total: Number(countR.rows[0].count), page: pageNum, limit: pageSize });
});
app.put('/customers/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, tax_id, phone, email, address, street, street_number, locality, province, country, postal_code } = req.body;
    const r = await pool.query(
      `UPDATE customer SET name=$1, tax_id=$2, phone=$3, email=$4, address=$5, street=$6, street_number=$7, locality=$8, province=$9, country=$10, postal_code=$11
       WHERE id=$12 RETURNING *`,
      [name, tax_id, phone, email, address, street, street_number, locality, province, country || 'Argentina', postal_code, id]
    );
    res.json(r.rows[0]);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
app.delete('/customers/:id', async (req, res) => {
  try {
    await pool.query('UPDATE customer SET deleted_at=now() WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
// (Roadmap Etapa 5) Cuenta corriente: historial de ventas de este cliente con
// saldo corriendo. Usa total_amount/settled_amount por venta — los mismos
// campos que ya muestra Deudores — para que el saldo de acá siempre coincida
// con lo que ya se ve en la lista de Clientes (no se inventa un cálculo nuevo).
app.get('/customers/:id/statement', async (req, res) => {
  try {
    const { id } = req.params;
    const r = await pool.query(`
      SELECT s.id, s.date, s.total_amount, s.settled_amount, s.status, s.business_unit_id, bu.name AS business_unit_name
      FROM sale s JOIN business_unit bu ON bu.id = s.business_unit_id
      WHERE s.customer_id=$1 AND s.deleted_at IS NULL AND s.status <> 'CANCELLED'
      ORDER BY s.date ASC, s.id ASC
    `, [id]);
    res.json(r.rows);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
app.post('/customers/bulk-import', async (req, res) => {
  const client = await pool.connect();
  try {
    const { customers } = req.body;
    if (!customers || !customers.length) throw new Error('No se recibieron clientes para importar.');
    await client.query('BEGIN');
    let created = 0;
    const errors = [];
    for (const c of customers) {
      try {
        await client.query(
          `INSERT INTO customer (name, tax_id, phone, email, address, street, street_number, locality, province, country, postal_code)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [c.name, c.tax_id || null, c.phone || null, c.email || null, c.address || null,
           c.street || null, c.street_number || null, c.locality || null, c.province || null, c.country || 'Argentina', c.postal_code || null]
        );
        created++;
      } catch (e) {
        errors.push({ name: c.name, error: e.message });
      }
    }
    await client.query('COMMIT');
    res.json({ created, failed: errors.length, errors: errors.slice(0, 50) });
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
  const r = await pool.query('SELECT * FROM warehouse WHERE deleted_at IS NULL ORDER BY id');
  res.json(r.rows);
});
app.put('/warehouses/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;
    const r = await pool.query('UPDATE warehouse SET name=$1 WHERE id=$2 RETURNING *', [name, id]);
    res.json(r.rows[0]);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
app.delete('/warehouses/:id', async (req, res) => {
  try {
    await pool.query('UPDATE warehouse SET deleted_at=now() WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
app.post('/warehouses/bulk-import', async (req, res) => {
  const client = await pool.connect();
  try {
    const { business_unit_id, warehouses } = req.body;
    if (!warehouses || !warehouses.length) throw new Error('No se recibieron depósitos para importar.');
    await client.query('BEGIN');
    let created = 0;
    const errors = [];
    for (const w of warehouses) {
      try {
        await client.query('INSERT INTO warehouse (name, business_unit_id) VALUES ($1,$2)', [w.name, business_unit_id]);
        created++;
      } catch (e) {
        errors.push({ name: w.name, error: e.message });
      }
    }
    await client.query('COMMIT');
    res.json({ created, failed: errors.length, errors: errors.slice(0, 50) });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: e.message });
  } finally {
    client.release();
  }
});

// ---------- ARTICLES ----------
app.post('/articles', async (req, res) => {
  const {
    business_unit_id, code, alt_code, description, notes,
    list_cost_ars, shipping_margin_pct_ars, fx_margin_pct_ars, profit_margin_pct_ars, iva_pct_ars,
    list_cost_usd, shipping_margin_pct_usd, fx_margin_pct_usd, profit_margin_pct_usd, iva_pct_usd,
    price_ars, price_usd,
  } = req.body;
  const r = await pool.query(
    `INSERT INTO article (business_unit_id, code, alt_code, description, notes,
       list_cost_ars, shipping_margin_pct_ars, fx_margin_pct_ars, profit_margin_pct_ars, iva_pct_ars,
       list_cost_usd, shipping_margin_pct_usd, fx_margin_pct_usd, profit_margin_pct_usd, iva_pct_usd,
       price_ars, price_usd)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
    [
      business_unit_id, code, alt_code || null, description, notes || null,
      list_cost_ars || 0, shipping_margin_pct_ars || 0, fx_margin_pct_ars || 0, profit_margin_pct_ars || 0, iva_pct_ars != null ? iva_pct_ars : 21,
      list_cost_usd || 0, shipping_margin_pct_usd || 0, fx_margin_pct_usd || 0, profit_margin_pct_usd || 0, iva_pct_usd != null ? iva_pct_usd : 21,
      price_ars || null, price_usd || null,
    ]
  );
  res.json(r.rows[0]);
});
// (Roadmap Etapa 10, hallazgo #30) reutiliza la misma infraestructura de
// auditoría que ya usan Ventas/Compras/Presupuestos/Remitos (logAudit +
// tabla audit_log, sin cambios de esquema) — antes un cambio de precio en un
// artículo no quedaba registrado en ningún lado.
app.put('/articles/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const {
      code, alt_code, description, notes,
      list_cost_ars, shipping_margin_pct_ars, fx_margin_pct_ars, profit_margin_pct_ars, iva_pct_ars,
      list_cost_usd, shipping_margin_pct_usd, fx_margin_pct_usd, profit_margin_pct_usd, iva_pct_usd,
      price_ars, price_usd,
    } = req.body;
    await client.query('BEGIN');
    const beforeR = await client.query('SELECT * FROM article WHERE id=$1', [id]);
    const r = await client.query(
      `UPDATE article SET code=$1, alt_code=$2, description=$3, notes=$4,
         list_cost_ars=$5, shipping_margin_pct_ars=$6, fx_margin_pct_ars=$7, profit_margin_pct_ars=$8, iva_pct_ars=$9,
         list_cost_usd=$10, shipping_margin_pct_usd=$11, fx_margin_pct_usd=$12, profit_margin_pct_usd=$13, iva_pct_usd=$14,
         price_ars=$15, price_usd=$16
       WHERE id=$17 RETURNING *`,
      [
        code, alt_code || null, description, notes || null,
        list_cost_ars || 0, shipping_margin_pct_ars || 0, fx_margin_pct_ars || 0, profit_margin_pct_ars || 0, iva_pct_ars != null ? iva_pct_ars : 21,
        list_cost_usd || 0, shipping_margin_pct_usd || 0, fx_margin_pct_usd || 0, profit_margin_pct_usd || 0, iva_pct_usd != null ? iva_pct_usd : 21,
        price_ars || null, price_usd || null, id,
      ]
    );
    if (beforeR.rows[0]) {
      await logAudit(client, {
        tableName: 'article', recordId: Number(id), action: 'EDIT',
        oldValues: beforeR.rows[0], newValues: r.rows[0], userId: req.user.id,
      });
    }
    await client.query('COMMIT');
    res.json(r.rows[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: e.message });
  } finally {
    client.release();
  }
});
app.get('/articles', async (req, res) => {
  const r = await pool.query('SELECT * FROM article_price ORDER BY article_id');
  res.json(r.rows);
});

app.get('/articles/list', async (req, res) => {
  const { business_unit_id, search, page, limit } = req.query;
  const pageNum = Math.max(1, parseInt(page) || 1);
  const pageSize = Math.min(200, Math.max(10, parseInt(limit) || 50));
  const offset = (pageNum - 1) * pageSize;

  const conditions = [];
  const values = [];
  let i = 1;
  if (business_unit_id) { conditions.push(`business_unit_id = $${i++}`); values.push(business_unit_id); }
  if (search) {
    conditions.push(`(code ILIKE $${i} OR alt_code ILIKE $${i} OR description ILIKE $${i})`);
    values.push(`%${search}%`);
    i++;
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const countR = await pool.query(`SELECT COUNT(*) FROM article_price ${where}`, values);
  const rowsR = await pool.query(
    `SELECT * FROM article_price ${where} ORDER BY article_id LIMIT $${i} OFFSET $${i + 1}`,
    [...values, pageSize, offset]
  );
  res.json({ rows: rowsR.rows, total: Number(countR.rows[0].count), page: pageNum, limit: pageSize });
});

app.post('/articles/bulk-import', async (req, res) => {
  const client = await pool.connect();
  try {
    const { business_unit_id, articles } = req.body;
    if (!articles || !articles.length) throw new Error('No se recibieron artículos para importar.');
    await client.query('BEGIN');
    let created = 0, updated = 0;
    const errors = [];
    for (const a of articles) {
      try {
        const r = await client.query(
          `INSERT INTO article (business_unit_id, code, alt_code, description, notes,
             list_cost_ars, shipping_margin_pct_ars, fx_margin_pct_ars, profit_margin_pct_ars, iva_pct_ars,
             list_cost_usd, shipping_margin_pct_usd, fx_margin_pct_usd, profit_margin_pct_usd, iva_pct_usd,
             price_ars, price_usd)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
           ON CONFLICT (business_unit_id, code) DO UPDATE SET
             alt_code = EXCLUDED.alt_code,
             description = EXCLUDED.description,
             notes = COALESCE(EXCLUDED.notes, article.notes),
             list_cost_ars = EXCLUDED.list_cost_ars,
             shipping_margin_pct_ars = EXCLUDED.shipping_margin_pct_ars,
             fx_margin_pct_ars = EXCLUDED.fx_margin_pct_ars,
             profit_margin_pct_ars = EXCLUDED.profit_margin_pct_ars,
             iva_pct_ars = EXCLUDED.iva_pct_ars,
             list_cost_usd = EXCLUDED.list_cost_usd,
             shipping_margin_pct_usd = EXCLUDED.shipping_margin_pct_usd,
             fx_margin_pct_usd = EXCLUDED.fx_margin_pct_usd,
             profit_margin_pct_usd = EXCLUDED.profit_margin_pct_usd,
             iva_pct_usd = EXCLUDED.iva_pct_usd,
             price_ars = EXCLUDED.price_ars,
             price_usd = EXCLUDED.price_usd,
             deleted_at = NULL
           RETURNING (xmax = 0) AS inserted`,
          [
            business_unit_id, a.code, a.alt_code || null, a.description, a.notes || null,
            a.list_cost_ars || 0, a.shipping_margin_pct_ars || 0, a.fx_margin_pct_ars || 0, a.profit_margin_pct_ars || 0, a.iva_pct_ars != null ? a.iva_pct_ars : 21,
            a.list_cost_usd || 0, a.shipping_margin_pct_usd || 0, a.fx_margin_pct_usd || 0, a.profit_margin_pct_usd || 0, a.iva_pct_usd != null ? a.iva_pct_usd : 21,
            a.price_ars || null, a.price_usd || null,
          ]
        );
        if (r.rows[0].inserted) created++; else updated++;
      } catch (e) {
        errors.push({ code: a.code, error: e.message });
      }
    }
    await client.query('COMMIT');
    res.json({ created, updated, failed: errors.length, errors: errors.slice(0, 50) });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: e.message });
  } finally {
    client.release();
  }
});

app.delete('/articles/:id', async (req, res) => {
  try {
    await pool.query('UPDATE article SET deleted_at=now() WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---------- CASH BOX / SESSIONS ----------
app.get('/cash-boxes', async (req, res) => {
  const r = await pool.query('SELECT * FROM cash_box WHERE deleted_at IS NULL ORDER BY id');
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
    await pool.query('UPDATE cash_box SET deleted_at=now() WHERE id=$1', [req.params.id]);
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
    WHERE cb.deleted_at IS NULL
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

// El movimiento manual (ingreso/egreso/transferencia) queda PENDIENTE hasta que
// se verifica el movimiento físico real del dinero (igual que los cobros de venta).
app.post('/cash-movements/pending', async (req, res) => {
  try {
    const { kind, from_cash_box_id, to_cash_box_id, amount, business_unit_id, project_id, description } = req.body;
    if (!(amount > 0)) throw new Error('El monto debe ser mayor a cero.');
    if (kind === 'TRANSFER') {
      if (!from_cash_box_id || !to_cash_box_id) throw new Error('Elegí la caja/sobre de origen y destino.');
      if (from_cash_box_id === to_cash_box_id) throw new Error('El origen y el destino deben ser distintos.');
    } else if (kind === 'INCOME') {
      if (!to_cash_box_id) throw new Error('Elegí la caja/sobre destino.');
    } else if (kind === 'EXPENSE') {
      if (!from_cash_box_id) throw new Error('Elegí la caja/sobre de origen.');
    } else {
      throw new Error('Tipo de movimiento inválido.');
    }
    const r = await pool.query(
      `INSERT INTO pending_cash_movement (kind, from_cash_box_id, to_cash_box_id, amount, business_unit_id, project_id, description)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [kind, from_cash_box_id || null, to_cash_box_id || null, amount, business_unit_id || null, project_id || null, description || null]
    );
    res.json(r.rows[0]);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/cash-movements/pending', async (req, res) => {
  const r = await pool.query(`
    SELECT pcm.*,
           fb.name AS from_box_name, fb.currency AS from_box_currency,
           tb.name AS to_box_name, tb.currency AS to_box_currency,
           bu.name AS business_unit_name
    FROM pending_cash_movement pcm
    LEFT JOIN cash_box fb ON fb.id = pcm.from_cash_box_id
    LEFT JOIN cash_box tb ON tb.id = pcm.to_cash_box_id
    LEFT JOIN business_unit bu ON bu.id = pcm.business_unit_id
    WHERE pcm.verified = FALSE
    ORDER BY pcm.created_at ASC
  `);
  res.json(r.rows);
});

app.post('/cash-movements/pending/:id/verify', async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    await client.query('BEGIN');
    const pR = await client.query('SELECT * FROM pending_cash_movement WHERE id=$1 FOR UPDATE', [id]);
    const p = pR.rows[0];
    if (!p) throw new Error('Movimiento no encontrado.');
    if (p.verified) throw new Error('Este movimiento ya fue verificado.');

    let movFromId = null, movToId = null;

    if (p.kind === 'EXPENSE' || p.kind === 'TRANSFER') {
      const sessR = await client.query(`SELECT id FROM cash_session WHERE cash_box_id=$1 AND status='OPEN' LIMIT 1`, [p.from_cash_box_id]);
      const sess = sessR.rows[0];
      if (!sess) throw new Error('La caja/sobre de origen no tiene sesión abierta.');
      const movR = await client.query(
        `INSERT INTO cash_movement (cash_session_id, business_unit_id, project_id, type, amount, description, origin_type)
         VALUES ($1,$2,$3,'EXPENSE',$4,$5,'MANUAL') RETURNING id`,
        [sess.id, p.business_unit_id, p.project_id, p.amount, p.description || (p.kind === 'TRANSFER' ? `Transferencia a otra caja` : 'Egreso manual')]
      );
      movFromId = movR.rows[0].id;
    }

    if (p.kind === 'INCOME' || p.kind === 'TRANSFER') {
      const sessR = await client.query(`SELECT id FROM cash_session WHERE cash_box_id=$1 AND status='OPEN' LIMIT 1`, [p.to_cash_box_id]);
      const sess = sessR.rows[0];
      if (!sess) throw new Error('La caja/sobre de destino no tiene sesión abierta.');
      const movR = await client.query(
        `INSERT INTO cash_movement (cash_session_id, business_unit_id, project_id, type, amount, description, origin_type)
         VALUES ($1,$2,$3,'INCOME',$4,$5,'MANUAL') RETURNING id`,
        [sess.id, p.business_unit_id, p.project_id, p.amount, p.description || (p.kind === 'TRANSFER' ? `Transferencia desde otra caja` : 'Ingreso manual')]
      );
      movToId = movR.rows[0].id;
    }

    await client.query(
      `UPDATE pending_cash_movement SET verified=TRUE, verified_at=now(), verified_by=$1, cash_movement_id_from=$2, cash_movement_id_to=$3 WHERE id=$4`,
      [req.user.id, movFromId, movToId, id]
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

app.post('/cash-movements/pending/:id/reject', async (req, res) => {
  try {
    const { id } = req.params;
    const r = await pool.query('SELECT verified FROM pending_cash_movement WHERE id=$1', [id]);
    if (!r.rows[0]) throw new Error('Movimiento no encontrado.');
    if (r.rows[0].verified) throw new Error('Ya fue verificado, no se puede rechazar.');
    await pool.query('DELETE FROM pending_cash_movement WHERE id=$1', [id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/cash-movements/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('UPDATE pending_cash_movement SET cash_movement_id_from=NULL WHERE cash_movement_id_from=$1', [id]);
    await pool.query('UPDATE pending_cash_movement SET cash_movement_id_to=NULL WHERE cash_movement_id_to=$1', [id]);
    await pool.query('DELETE FROM cash_movement WHERE id=$1', [id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---------- PURCHASES ----------
app.post('/purchases', async (req, res) => {
  const client = await pool.connect();
  try {
    const { business_unit_id, supplier_id, warehouse_id, project_id, cash_box_id, payment_type, items, date, notes, discount_amount } = req.body;
    await client.query('BEGIN');

    // Fecha editable: si no viene del formulario, se usa hoy (mismo comportamiento que antes).
    const dateValue = date || new Date().toISOString().slice(0, 10);

    // (Roadmap Etapa 8) mismo bug que en POST /sales: notes/discount_amount
    // no se guardaban al crear la compra, solo al editarla. Corregido acá también.
    const purchaseR = await client.query(
      `INSERT INTO purchase (business_unit_id, supplier_id, warehouse_id, project_id, cash_box_id, payment_type, date, notes, discount_amount)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [business_unit_id, supplier_id, warehouse_id, project_id || null, cash_box_id || null, payment_type, dateValue, notes || null, discount_amount || 0]
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

// Editar la fecha de una compra: solo mientras está PENDING, para no alterar
// el historial de algo ya confirmado (movió stock/caja con esa fecha).
app.put('/purchases/:id/date', async (req, res) => {
  try {
    const { id } = req.params;
    const { date } = req.body;
    if (!date) throw new Error('Indicá una fecha.');
    const r = await pool.query('SELECT status FROM purchase WHERE id=$1', [id]);
    if (!r.rows[0]) throw new Error('Compra no encontrada.');
    if (r.rows[0].status !== 'PENDING') throw new Error('Solo se puede editar la fecha mientras la compra está pendiente.');
    const updated = await pool.query('UPDATE purchase SET date=$1 WHERE id=$2 RETURNING *', [date, id]);
    res.json(updated.rows[0]);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Trae la compra + líneas + proveedor/depósito, para precargar el modal de
// edición (Bloque 2). Mismo patrón que /sales/:id/full, que ya existía.
app.get('/purchases/:id/full', async (req, res) => {
  try {
    const { id } = req.params;
    const purchaseR = await pool.query('SELECT * FROM purchase WHERE id=$1', [id]);
    const purchase = purchaseR.rows[0];
    if (!purchase) throw new Error('Compra no encontrada.');
    const supplierR = await pool.query('SELECT * FROM supplier WHERE id=$1', [purchase.supplier_id]);
    const whR = await pool.query('SELECT * FROM warehouse WHERE id=$1', [purchase.warehouse_id]);
    const itemsR = await pool.query(`
      SELECT pi.*, a.code, a.description
      FROM purchase_item pi JOIN article a ON a.id = pi.article_id
      WHERE pi.purchase_id=$1
    `, [id]);
    res.json({ purchase, supplier: supplierR.rows[0], warehouse: whR.rows[0], items: itemsR.rows });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Edición completa de una compra (Bloque 2): solo mientras está PENDING,
// porque nada se movió todavía (stock/caja/cta-cte solo se tocan al
// Confirmar). Reemplaza las líneas por las que llegan en el body, igual que
// al crear, así el trigger fn_recalc_purchase_total recalcula el total solo
// (ya usando el discount_amount actualizado, porque se guarda antes que las
// líneas). Deja registro completo en audit_log (Bloque 1).
app.put('/purchases/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { supplier_id, warehouse_id, project_id, payment_type, date, notes, discount_amount, items } = req.body;
    if (!items || !items.length) throw new Error('Agregá al menos un artículo.');

    await client.query('BEGIN');
    const beforeR = await client.query('SELECT * FROM purchase WHERE id=$1 FOR UPDATE', [id]);
    const before = beforeR.rows[0];
    if (!before) throw new Error('Compra no encontrada.');
    if (before.status !== 'PENDING') throw new Error('Solo se puede editar una compra mientras está pendiente.');
    const beforeItemsR = await client.query('SELECT article_id, quantity, unit_cost FROM purchase_item WHERE purchase_id=$1', [id]);

    await client.query(
      `UPDATE purchase SET supplier_id=$1, warehouse_id=$2, project_id=$3, payment_type=$4, date=$5, notes=$6, discount_amount=$7
       WHERE id=$8`,
      [supplier_id, warehouse_id, project_id || null, payment_type, date || before.date, notes || null, discount_amount || 0, id]
    );

    await client.query('DELETE FROM purchase_item WHERE purchase_id=$1', [id]);
    for (const item of items) {
      await client.query(
        `INSERT INTO purchase_item (purchase_id, article_id, quantity, unit_cost) VALUES ($1,$2,$3,$4)`,
        [id, item.article_id, item.quantity, item.unit_cost]
      );
    }

    const afterR = await client.query('SELECT * FROM purchase WHERE id=$1', [id]);
    await logAudit(client, {
      tableName: 'purchase', recordId: Number(id), action: 'EDIT',
      oldValues: { ...before, items: beforeItemsR.rows },
      newValues: { ...afterR.rows[0], items },
      userId: req.user.id,
    });

    await client.query('COMMIT');
    res.json(afterR.rows[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: e.message });
  } finally {
    client.release();
  }
});

// Bloque 3: a diferencia del resto de los campos (solo editables mientras
// PENDING, ver PUT /purchases/:id de arriba), Observaciones y Proyecto se
// pueden editar en cualquier estado — no mueven stock/caja/cta-cte, solo
// reetiquetan la operación hacia adelante (no reescribe movimientos ya
// generados con el proyecto anterior). Sin restricción de status a propósito.
app.put('/purchases/:id/notes-project', async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { notes, project_id } = req.body;
    await client.query('BEGIN');
    const beforeR = await client.query('SELECT notes, project_id FROM purchase WHERE id=$1 FOR UPDATE', [id]);
    if (!beforeR.rows[0]) throw new Error('Compra no encontrada.');
    const updated = await client.query(
      'UPDATE purchase SET notes=$1, project_id=$2 WHERE id=$3 RETURNING notes, project_id',
      [notes || null, project_id || null, id]
    );
    await logAudit(client, {
      tableName: 'purchase', recordId: Number(id), action: 'EDIT_NOTES_PROJECT',
      oldValues: beforeR.rows[0], newValues: updated.rows[0], userId: req.user.id,
    });
    await client.query('COMMIT');
    res.json(updated.rows[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: e.message });
  } finally {
    client.release();
  }
});

app.post('/purchases/:id/cancel', async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    await client.query('BEGIN');

    const payments = await client.query('SELECT * FROM purchase_payment WHERE purchase_id=$1', [id]);
    for (const pp of payments.rows) {
      if (pp.verified) {
        await client.query(
          `INSERT INTO cash_movement (cash_session_id, business_unit_id, project_id, type, amount, description, origin_type, origin_id)
           VALUES ($1,$2,$3,'INCOME',$4,$5,'PURCHASE',$6)`,
          [pp.cash_session_id, pp.business_unit_id, pp.project_id, pp.amount, `Reversa pago Compra #${id}`, id]
        );
      }
      await client.query('DELETE FROM purchase_payment WHERE id=$1', [pp.id]);
    }

    await client.query(`UPDATE purchase SET status='CANCELLED', settled_amount=0 WHERE id=$1`, [id]);
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: e.message });
  } finally {
    client.release();
  }
});

app.get('/purchases/pending-payment', async (req, res) => {
  const r = await pool.query('SELECT * FROM purchase_pending_payment ORDER BY date ASC');
  res.json(r.rows);
});

app.post('/purchases/:id/pay', async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { splits } = req.body; // [{ cash_box_id, amount, project_id }]
    if (!splits || !splits.length) throw new Error('Agregá al menos una caja con un monto.');

    await client.query('BEGIN');
    const pR = await client.query('SELECT * FROM purchase WHERE id=$1 FOR UPDATE', [id]);
    const purchase = pR.rows[0];
    if (!purchase) throw new Error('Compra no encontrada.');
    if (!['CASH', 'ACCOUNT'].includes(purchase.payment_type)) throw new Error('Esta compra no admite procesar un pago.');

    const remaining = Number(purchase.total_amount) - Number(purchase.settled_amount);
    const splitTotal = splits.reduce((a, s) => a + Number(s.amount), 0);
    if (splitTotal <= 0) throw new Error('El monto a pagar debe ser mayor a cero.');
    if (splitTotal > remaining + 0.01) throw new Error(`El total a pagar ($${splitTotal}) supera el saldo pendiente ($${remaining}).`);

    for (const split of splits) {
      const sessionR = await client.query(`SELECT id FROM cash_session WHERE cash_box_id=$1 AND status='OPEN' LIMIT 1`, [split.cash_box_id]);
      const session = sessionR.rows[0];
      if (!session) throw new Error('La caja seleccionada no tiene una sesión abierta.');

      await client.query(
        `INSERT INTO purchase_payment (purchase_id, cash_box_id, cash_session_id, business_unit_id, project_id, amount, verified)
         VALUES ($1,$2,$3,$4,$5,$6,FALSE)`,
        [purchase.id, split.cash_box_id, session.id, purchase.business_unit_id, split.project_id || null, split.amount]
      );
    }

    if (purchase.payment_type === 'ACCOUNT') {
      await client.query(
        `INSERT INTO supplier_account_movement (supplier_id, business_unit_id, purchase_id, type, amount, description)
         VALUES ($1,$2,$3,'CREDIT',$4,$5)`,
        [purchase.supplier_id, purchase.business_unit_id, purchase.id, splitTotal, `Pago cta. cte. Compra #${purchase.id}`]
      );
    }

    await client.query('UPDATE purchase SET settled_amount = settled_amount + $1 WHERE id=$2', [splitTotal, purchase.id]);
    await client.query('COMMIT');
    const updated = await pool.query('SELECT * FROM purchase_pending_payment WHERE id=$1', [id]);
    res.json(updated.rows[0] || { ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: e.message });
  } finally {
    client.release();
  }
});

app.get('/purchase-payments/pending', async (req, res) => {
  const r = await pool.query(`
    SELECT pp.*, s.name AS supplier_name, cb.name AS cash_box_name, cb.currency AS cash_box_currency,
           bu.name AS business_unit_name
    FROM purchase_payment pp
    JOIN purchase pu ON pu.id = pp.purchase_id
    JOIN supplier s ON s.id = pu.supplier_id
    JOIN cash_box cb ON cb.id = pp.cash_box_id
    JOIN business_unit bu ON bu.id = pp.business_unit_id
    WHERE pp.verified = FALSE
    ORDER BY pp.created_at ASC
  `);
  res.json(r.rows);
});

app.post('/purchase-payments/:id/verify', async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    await client.query('BEGIN');
    const ppR = await client.query('SELECT * FROM purchase_payment WHERE id=$1 FOR UPDATE', [id]);
    const pp = ppR.rows[0];
    if (!pp) throw new Error('Pago no encontrado.');
    if (pp.verified) throw new Error('Este pago ya fue verificado.');

    const movR = await client.query(
      `INSERT INTO cash_movement (cash_session_id, business_unit_id, project_id, type, amount, description, origin_type, origin_id)
       VALUES ($1,$2,$3,'EXPENSE',$4,$5,'PURCHASE',$6) RETURNING id`,
      [pp.cash_session_id, pp.business_unit_id, pp.project_id, pp.amount, `Pago Compra #${pp.purchase_id} (verificado)`, pp.purchase_id]
    );

    await client.query(
      `UPDATE purchase_payment SET verified=TRUE, verified_at=now(), verified_by=$1, cash_movement_id=$2 WHERE id=$3`,
      [req.user.id, movR.rows[0].id, id]
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

app.post('/purchase-payments/:id/reject', async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    await client.query('BEGIN');
    const ppR = await client.query('SELECT * FROM purchase_payment WHERE id=$1 FOR UPDATE', [id]);
    const pp = ppR.rows[0];
    if (!pp) throw new Error('Pago no encontrado.');
    if (pp.verified) throw new Error('Ya fue verificado, no se puede rechazar.');

    await client.query('UPDATE purchase SET settled_amount = settled_amount - $1 WHERE id=$2', [pp.amount, pp.purchase_id]);
    await client.query('DELETE FROM purchase_payment WHERE id=$1', [pp.id]);

    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: e.message });
  } finally {
    client.release();
  }
});

// (Roadmap Etapa 9) extraído de GET /reports/pnl para que también lo use el
// Panel (hallazgo #10, mismo período/comparación que Reportes) y la
// exportación a Excel (hallazgo #27) sin repetir las 3 consultas.
async function computePnl(businessUnitId, dateFrom, dateTo) {
  const salesR = await pool.query(
    `SELECT COALESCE(SUM(total_amount),0) AS total, COUNT(*) AS count
     FROM sale WHERE business_unit_id=$1 AND status='CONFIRMED' AND date >= $2 AND date < ($3::date + interval '1 day')`,
    [businessUnitId, dateFrom, dateTo]
  );
  const purchasesR = await pool.query(
    `SELECT COALESCE(SUM(total_amount),0) AS total, COUNT(*) AS count
     FROM purchase WHERE business_unit_id=$1 AND status='CONFIRMED' AND date >= $2 AND date < ($3::date + interval '1 day')`,
    [businessUnitId, dateFrom, dateTo]
  );
  const manualR = await pool.query(
    `SELECT
       COALESCE(SUM(amount) FILTER (WHERE type='INCOME'), 0) AS manual_income,
       COALESCE(SUM(amount) FILTER (WHERE type='EXPENSE'), 0) AS manual_expense
     FROM cash_movement
     WHERE origin_type='MANUAL' AND created_at >= $1 AND created_at < ($2::date + interval '1 day')`,
    [dateFrom, dateTo]
  );
  const sales_total = Number(salesR.rows[0].total);
  const purchases_total = Number(purchasesR.rows[0].total);
  const manual_income = Number(manualR.rows[0].manual_income);
  const manual_expense = Number(manualR.rows[0].manual_expense);
  return {
    sales_total, sales_count: Number(salesR.rows[0].count),
    purchases_total, purchases_count: Number(purchasesR.rows[0].count),
    manual_income, manual_expense,
    net_result: sales_total - purchases_total + manual_income - manual_expense,
  };
}
// Período inmediatamente anterior, de igual duración — misma cuenta que ya
// hacía el frontend en Reportes (renderReports), ahora también reutilizada
// acá para que el Panel y la exportación calculen la comparación igual.
function previousPeriod(dateFrom, dateTo) {
  const from = new Date(dateFrom);
  const to = new Date(dateTo);
  const durationMs = to.getTime() - from.getTime();
  const prevTo = new Date(from.getTime() - 24 * 60 * 60 * 1000);
  const prevFrom = new Date(prevTo.getTime() - durationMs);
  return { from: prevFrom.toISOString().slice(0, 10), to: prevTo.toISOString().slice(0, 10) };
}

app.get('/reports/pnl', async (req, res) => {
  try {
    const { business_unit_id, date_from, date_to } = req.query;
    if (!business_unit_id || !date_from || !date_to) throw new Error('Faltan parámetros: business_unit_id, date_from, date_to.');
    const pnl = await computePnl(business_unit_id, date_from, date_to);
    res.json({ business_unit_id: Number(business_unit_id), date_from, date_to, ...pnl });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// (Roadmap Etapa 9, hallazgo #27) exportar el Estado de resultados a Excel,
// mismo patrón que ya usaba /cash-movements/export-manual (XLSX, sección
// "MOVIMIENTOS DE CAJA" del archivo).
app.get('/reports/pnl/export', async (req, res) => {
  try {
    const { business_unit_id, date_from, date_to } = req.query;
    if (!business_unit_id || !date_from || !date_to) throw new Error('Faltan parámetros: business_unit_id, date_from, date_to.');
    const prev = previousPeriod(date_from, date_to);
    const [current, previous, buR] = await Promise.all([
      computePnl(business_unit_id, date_from, date_to),
      computePnl(business_unit_id, prev.from, prev.to),
      pool.query('SELECT name FROM business_unit WHERE id=$1', [business_unit_id]),
    ]);
    const buName = buR.rows[0]?.name || '';

    const rows = [
      { Concepto: 'Ventas', 'Período actual': current.sales_total, 'Período anterior': previous.sales_total },
      { Concepto: 'Compras (costo)', 'Período actual': current.purchases_total, 'Período anterior': previous.purchases_total },
      { Concepto: 'Otros ingresos', 'Período actual': current.manual_income, 'Período anterior': previous.manual_income },
      { Concepto: 'Gastos operativos', 'Período actual': current.manual_expense, 'Período anterior': previous.manual_expense },
      { Concepto: 'Resultado neto', 'Período actual': current.net_result, 'Período anterior': previous.net_result },
    ];
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [{ wch: 22 }, { wch: 16 }, { wch: 16 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Estado de resultados');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const filename = `estado_resultados_${buName.replace(/\s+/g, '_')}_${date_from}_${date_to}.xlsx`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/reports/project-detail', async (req, res) => {
  const { project_id } = req.query;
  const r = await pool.query(`
    SELECT cm.created_at, cm.type, cm.amount, cm.description, cm.origin_type, cm.origin_id, cb.name AS cash_box_name
    FROM cash_movement cm
    JOIN cash_session cs ON cs.id = cm.cash_session_id
    JOIN cash_box cb ON cb.id = cs.cash_box_id
    WHERE cm.project_id = $1
    ORDER BY cm.created_at DESC
  `, [project_id]);
  res.json(r.rows);
});

app.get('/purchases', async (req, res) => {
  const r = await pool.query('SELECT * FROM purchase WHERE deleted_at IS NULL ORDER BY id DESC');
  res.json(r.rows);
});

app.get('/purchases/list', async (req, res) => {
  const { business_unit_id, date_from, date_to, page, limit } = req.query;
  const pageNum = Math.max(1, parseInt(page) || 1);
  const pageSize = Math.min(200, Math.max(10, parseInt(limit) || 25));
  const offset = (pageNum - 1) * pageSize;

  const conditions = ['deleted_at IS NULL'];
  const values = [];
  let i = 1;
  if (business_unit_id) { conditions.push(`business_unit_id = $${i++}`); values.push(business_unit_id); }
  if (date_from) { conditions.push(`date >= $${i++}`); values.push(date_from); }
  if (date_to) { conditions.push(`date < ($${i++}::date + interval '1 day')`); values.push(date_to); }
  const where = `WHERE ${conditions.join(' AND ')}`;

  const countR = await pool.query(`SELECT COUNT(*) FROM purchase ${where}`, values);
  const rowsR = await pool.query(
    `SELECT * FROM purchase ${where} ORDER BY id DESC LIMIT $${i} OFFSET $${i + 1}`,
    [...values, pageSize, offset]
  );
  res.json({ rows: rowsR.rows, total: Number(countR.rows[0].count), page: pageNum, limit: pageSize });
});

// Una compra CONFIRMADA no se elimina directamente: hay que cancelarla primero
// (eso ya revierte stock/pagos con historial completo). Una vez pendiente o
// cancelada, "eliminar" solo la manda a la papelera por 30 días.
app.delete('/purchases/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const r = await pool.query('SELECT status FROM purchase WHERE id=$1', [id]);
    if (!r.rows[0]) throw new Error('Compra no encontrada.');
    if (r.rows[0].status === 'CONFIRMED') {
      throw new Error('Esta compra está confirmada. Cancelala primero (botón "Cancelar") y después vas a poder eliminarla.');
    }
    await pool.query('UPDATE purchase SET deleted_at=now() WHERE id=$1', [id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---------- SALES ----------
app.post('/sales', async (req, res) => {
  const client = await pool.connect();
  try {
    const { business_unit_id, customer_id, warehouse_id, project_id, cash_box_id, payment_type, currency, quote_id, items, date, notes, discount_amount } = req.body;
    await client.query('BEGIN');

    // Fecha editable: si no viene del formulario, se usa hoy (mismo comportamiento que antes).
    const dateValue = date || new Date().toISOString().slice(0, 10);

    // (Roadmap Etapa 8) notes/discount_amount se sumaron al formulario de alta
    // en el Bloque 2 de "Edición de Compras y Ventas" (PROJECT_CONTEXT.md,
    // sección 15), pero esa vez solo se cablearon en PUT /sales/:id — acá en
    // el alta (POST) nunca se guardaban: lo que el usuario tipeaba en
    // Descuento/Observaciones al crear una venta nueva se perdía en silencio
    // (quedaba en NULL/0 hasta que alguien editara la venta). Se corrige de
    // paso, detectado al tocar este mismo endpoint para el hallazgo #15.
    const saleR = await client.query(
      `INSERT INTO sale (business_unit_id, customer_id, warehouse_id, project_id, cash_box_id, payment_type, currency, quote_id, date, notes, discount_amount)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [business_unit_id, customer_id, warehouse_id, project_id || null, cash_box_id || null, payment_type || 'CASH', currency || 'ARS', quote_id || null, dateValue, notes || null, discount_amount || 0]
    );
    const sale = saleR.rows[0];

    for (const item of items) {
      await client.query(
        `INSERT INTO sale_item (sale_id, article_id, quantity, unit_price)
         VALUES ($1,$2,$3,$4)`,
        [sale.id, item.article_id, item.quantity, item.unit_price]
      );
    }

    if (quote_id) {
      await client.query(`UPDATE quote SET status='CONVERTED' WHERE id=$1`, [quote_id]);
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

// Editar la fecha de una venta: solo mientras está PENDING, para no alterar
// el historial de algo ya confirmado (movió stock/caja con esa fecha).
app.put('/sales/:id/date', async (req, res) => {
  try {
    const { id } = req.params;
    const { date } = req.body;
    if (!date) throw new Error('Indicá una fecha.');
    const r = await pool.query('SELECT status FROM sale WHERE id=$1', [id]);
    if (!r.rows[0]) throw new Error('Venta no encontrada.');
    if (r.rows[0].status !== 'PENDING') throw new Error('Solo se puede editar la fecha mientras la venta está pendiente.');
    const updated = await pool.query('UPDATE sale SET date=$1 WHERE id=$2 RETURNING *', [date, id]);
    res.json(updated.rows[0]);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Edición completa de una venta (Bloque 2): solo mientras está PENDING,
// porque nada se movió todavía (stock/caja/cta-cte solo se tocan al
// Confirmar). Reemplaza las líneas por las que llegan en el body, igual que
// al crear, así el trigger fn_recalc_sale_total recalcula el total solo (ya
// usando el discount_amount actualizado, porque se guarda antes que las
// líneas). Deja registro completo en audit_log (Bloque 1).
app.put('/sales/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { customer_id, warehouse_id, project_id, payment_type, cash_box_id, currency, date, notes, discount_amount, items } = req.body;
    if (!items || !items.length) throw new Error('Agregá al menos un artículo.');

    await client.query('BEGIN');
    const beforeR = await client.query('SELECT * FROM sale WHERE id=$1 FOR UPDATE', [id]);
    const before = beforeR.rows[0];
    if (!before) throw new Error('Venta no encontrada.');
    if (before.status !== 'PENDING') throw new Error('Solo se puede editar una venta mientras está pendiente.');
    const beforeItemsR = await client.query('SELECT article_id, quantity, unit_price FROM sale_item WHERE sale_id=$1', [id]);

    await client.query(
      `UPDATE sale SET customer_id=$1, warehouse_id=$2, project_id=$3, payment_type=$4, cash_box_id=$5, currency=$6, date=$7, notes=$8, discount_amount=$9
       WHERE id=$10`,
      [customer_id, warehouse_id, project_id || null, payment_type, cash_box_id || null, currency || 'ARS', date || before.date, notes || null, discount_amount || 0, id]
    );

    await client.query('DELETE FROM sale_item WHERE sale_id=$1', [id]);
    for (const item of items) {
      await client.query(
        `INSERT INTO sale_item (sale_id, article_id, quantity, unit_price) VALUES ($1,$2,$3,$4)`,
        [id, item.article_id, item.quantity, item.unit_price]
      );
    }

    const afterR = await client.query('SELECT * FROM sale WHERE id=$1', [id]);
    await logAudit(client, {
      tableName: 'sale', recordId: Number(id), action: 'EDIT',
      oldValues: { ...before, items: beforeItemsR.rows },
      newValues: { ...afterR.rows[0], items },
      userId: req.user.id,
    });

    await client.query('COMMIT');
    res.json(afterR.rows[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: e.message });
  } finally {
    client.release();
  }
});

// Bloque 3: a diferencia del resto de los campos (solo editables mientras
// PENDING, ver PUT /sales/:id de arriba), Observaciones y Proyecto se
// pueden editar en cualquier estado — no mueven stock/caja/cta-cte, solo
// reetiquetan la operación hacia adelante (no reescribe movimientos ya
// generados con el proyecto anterior). Sin restricción de status a propósito.
app.put('/sales/:id/notes-project', async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { notes, project_id } = req.body;
    await client.query('BEGIN');
    const beforeR = await client.query('SELECT notes, project_id FROM sale WHERE id=$1 FOR UPDATE', [id]);
    if (!beforeR.rows[0]) throw new Error('Venta no encontrada.');
    const updated = await client.query(
      'UPDATE sale SET notes=$1, project_id=$2 WHERE id=$3 RETURNING notes, project_id',
      [notes || null, project_id || null, id]
    );
    await logAudit(client, {
      tableName: 'sale', recordId: Number(id), action: 'EDIT_NOTES_PROJECT',
      oldValues: beforeR.rows[0], newValues: updated.rows[0], userId: req.user.id,
    });
    await client.query('COMMIT');
    res.json(updated.rows[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: e.message });
  } finally {
    client.release();
  }
});

app.post('/sales/:id/cancel', async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    await client.query('BEGIN');

    const collections = await client.query('SELECT * FROM sale_collection WHERE sale_id=$1', [id]);
    for (const sc of collections.rows) {
      if (sc.verified) {
        // Ya impactó en la caja: generar el movimiento de reversa, en el sentido
        // opuesto al original (IN verificado como INCOME -> reversa EXPENSE;
        // OUT verificado como EXPENSE, ej. conversión bancaria -> reversa INCOME).
        const reversalType = sc.direction === 'OUT' ? 'INCOME' : 'EXPENSE';
        const reversalDesc = sc.direction === 'OUT'
          ? `Reversa entrega USD (conversión bancaria) Venta #${id}`
          : `Reversa cobro Venta #${id}`;
        await client.query(
          `INSERT INTO cash_movement (cash_session_id, business_unit_id, project_id, type, amount, description, origin_type, origin_id)
           VALUES ($1,$2,$3,$4,$5,$6,'SALE',$7)`,
          [sc.cash_session_id, sc.business_unit_id, sc.project_id, reversalType, sc.amount, reversalDesc, id]
        );
      }
      await client.query('DELETE FROM sale_collection WHERE id=$1', [sc.id]);
    }

    await client.query(`UPDATE sale SET status='CANCELLED', settled_amount=0 WHERE id=$1`, [id]);
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: e.message });
  } finally {
    client.release();
  }
});

// ---------- PRESUPUESTOS ----------
// ---------- REMITOS DE ENVÍO (préstamo/regalo, sin precios) ----------
app.get('/shipments', async (req, res) => {
  const r = await pool.query('SELECT * FROM shipment WHERE deleted_at IS NULL ORDER BY id DESC');
  res.json(r.rows);
});
app.get('/shipments/list', async (req, res) => {
  const { business_unit_id, search, page, limit } = req.query;
  const pageNum = Math.max(1, parseInt(page) || 1);
  const pageSize = Math.min(200, Math.max(10, parseInt(limit) || 50));
  const offset = (pageNum - 1) * pageSize;

  const conditions = ['sh.deleted_at IS NULL'];
  const values = [];
  let i = 1;
  if (business_unit_id) { conditions.push(`sh.business_unit_id = $${i++}`); values.push(business_unit_id); }
  if (search) {
    conditions.push(`(c.name ILIKE $${i} OR CAST(sh.id AS TEXT) ILIKE $${i})`);
    values.push(`%${search}%`);
    i++;
  }
  const where = `WHERE ${conditions.join(' AND ')}`;

  const countR = await pool.query(
    `SELECT COUNT(*) FROM shipment sh JOIN customer c ON c.id = sh.customer_id ${where}`,
    values
  );
  const rowsR = await pool.query(
    `SELECT sh.* FROM shipment sh JOIN customer c ON c.id = sh.customer_id
     ${where} ORDER BY sh.id DESC LIMIT $${i} OFFSET $${i + 1}`,
    [...values, pageSize, offset]
  );
  res.json({ rows: rowsR.rows, total: Number(countR.rows[0].count), page: pageNum, limit: pageSize });
});

app.get('/shipments/:id/items', async (req, res) => {
  const r = await pool.query(`
    SELECT si.*, a.code, a.description
    FROM shipment_item si JOIN article a ON a.id = si.article_id
    WHERE si.shipment_id=$1
  `, [req.params.id]);
  res.json(r.rows);
});

app.get('/shipments/:id/full', async (req, res) => {
  try {
    const { id } = req.params;
    const shipR = await pool.query('SELECT * FROM shipment WHERE id=$1', [id]);
    const shipment = shipR.rows[0];
    if (!shipment) throw new Error('Remito no encontrado.');
    const customerR = await pool.query('SELECT * FROM customer WHERE id=$1', [shipment.customer_id]);
    const buR = await pool.query('SELECT * FROM business_unit WHERE id=$1', [shipment.business_unit_id]);
    const whR = await pool.query('SELECT * FROM warehouse WHERE id=$1', [shipment.warehouse_id]);
    const itemsR = await pool.query(`
      SELECT si.*, a.code, a.description
      FROM shipment_item si JOIN article a ON a.id = si.article_id
      WHERE si.shipment_id=$1
    `, [id]);
    res.json({ shipment, customer: customerR.rows[0], business_unit: buR.rows[0], warehouse: whR.rows[0], items: itemsR.rows });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/shipments', async (req, res) => {
  const client = await pool.connect();
  try {
    const { business_unit_id, customer_id, warehouse_id, project_id, reason, notes, items } = req.body;
    if (!items || !items.length) throw new Error('Agregá al menos un artículo.');
    await client.query('BEGIN');
    const shipR = await client.query(
      `INSERT INTO shipment (business_unit_id, customer_id, warehouse_id, project_id, reason, notes)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [business_unit_id, customer_id, warehouse_id, project_id || null, reason || 'PRESTAMO', notes || null]
    );
    const shipment = shipR.rows[0];
    for (const item of items) {
      await client.query(
        'INSERT INTO shipment_item (shipment_id, article_id, quantity) VALUES ($1,$2,$3)',
        [shipment.id, item.article_id, item.quantity]
      );
    }
    await client.query('COMMIT');
    res.json(shipment);
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: e.message });
  } finally {
    client.release();
  }
});

// (Roadmap Etapa 4) Edición completa de un remito: solo mientras está PENDING
// (Confirmar mueve stock, no se puede editar después sin revertirlo antes con
// Cancelar). Mismo patrón que PUT /quotes/:id de arriba. No toca
// carrier/delivery_address: esos se editan aparte, en /shipments/:id/transport.
app.put('/shipments/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { customer_id, warehouse_id, project_id, reason, notes, items } = req.body;
    if (!items || !items.length) throw new Error('Agregá al menos un artículo.');

    await client.query('BEGIN');
    const beforeR = await client.query('SELECT * FROM shipment WHERE id=$1 FOR UPDATE', [id]);
    const before = beforeR.rows[0];
    if (!before) throw new Error('Remito no encontrado.');
    if (before.status !== 'PENDING') throw new Error('Solo se puede editar un remito mientras está pendiente.');
    const beforeItemsR = await client.query('SELECT article_id, quantity FROM shipment_item WHERE shipment_id=$1', [id]);

    await client.query(
      `UPDATE shipment SET customer_id=$1, warehouse_id=$2, project_id=$3, reason=$4, notes=$5 WHERE id=$6`,
      [customer_id, warehouse_id, project_id || null, reason || 'PRESTAMO', notes || null, id]
    );

    await client.query('DELETE FROM shipment_item WHERE shipment_id=$1', [id]);
    for (const item of items) {
      await client.query(
        'INSERT INTO shipment_item (shipment_id, article_id, quantity) VALUES ($1,$2,$3)',
        [id, item.article_id, item.quantity]
      );
    }

    const afterR = await client.query('SELECT * FROM shipment WHERE id=$1', [id]);
    await logAudit(client, {
      tableName: 'shipment', recordId: Number(id), action: 'EDIT',
      oldValues: { ...before, items: beforeItemsR.rows },
      newValues: { ...afterR.rows[0], items },
      userId: req.user.id,
    });

    await client.query('COMMIT');
    res.json(afterR.rows[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: e.message });
  } finally {
    client.release();
  }
});

app.put('/shipments/:id/transport', async (req, res) => {
  try {
    const { id } = req.params;
    const { carrier, delivery_notes, delivery_address } = req.body;
    const r = await pool.query(
      'UPDATE shipment SET carrier=$1, delivery_notes=$2, delivery_address=$3 WHERE id=$4 RETURNING *',
      [carrier || null, delivery_notes || null, delivery_address || null, id]
    );
    res.json(r.rows[0]);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/shipments/:id/confirm', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query(`UPDATE shipment SET status='CONFIRMED' WHERE id=$1`, [id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/shipments/:id/cancel', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query(`UPDATE shipment SET status='CANCELLED' WHERE id=$1`, [id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Un remito CONFIRMADO no se elimina directamente: hay que cancelarlo primero
// (revierte el stock con historial completo). Pendiente o cancelado, "eliminar"
// lo manda a la papelera por 30 días.
app.delete('/shipments/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const r = await pool.query('SELECT status FROM shipment WHERE id=$1', [id]);
    if (!r.rows[0]) throw new Error('Remito no encontrado.');
    if (r.rows[0].status === 'CONFIRMED') {
      throw new Error('Este remito está confirmado. Cancelalo primero y después vas a poder eliminarlo.');
    }
    await pool.query('UPDATE shipment SET deleted_at=now() WHERE id=$1', [id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/quotes', async (req, res) => {
  const r = await pool.query('SELECT * FROM quote WHERE deleted_at IS NULL ORDER BY id DESC');
  res.json(r.rows);
});
app.get('/quotes/list', async (req, res) => {
  const { business_unit_id, search, page, limit } = req.query;
  const pageNum = Math.max(1, parseInt(page) || 1);
  const pageSize = Math.min(200, Math.max(10, parseInt(limit) || 50));
  const offset = (pageNum - 1) * pageSize;

  const conditions = ['q.deleted_at IS NULL'];
  const values = [];
  let i = 1;
  if (business_unit_id) { conditions.push(`q.business_unit_id = $${i++}`); values.push(business_unit_id); }
  if (search) {
    conditions.push(`(c.name ILIKE $${i} OR CAST(q.id AS TEXT) ILIKE $${i})`);
    values.push(`%${search}%`);
    i++;
  }
  const where = `WHERE ${conditions.join(' AND ')}`;

  const countR = await pool.query(
    `SELECT COUNT(*) FROM quote q JOIN customer c ON c.id = q.customer_id ${where}`,
    values
  );
  // (Roadmap Etapa 4) LEFT JOIN a sale para exponer qué venta generó este
  // presupuesto (sale.quote_id ya se guardaba desde antes en POST /sales —
  // acá solo se expone para mostrar "Ver venta #X" en la lista).
  const rowsR = await pool.query(
    `SELECT q.*, s.id AS converted_sale_id FROM quote q
     JOIN customer c ON c.id = q.customer_id
     LEFT JOIN sale s ON s.quote_id = q.id AND s.deleted_at IS NULL
     ${where} ORDER BY q.id DESC LIMIT $${i} OFFSET $${i + 1}`,
    [...values, pageSize, offset]
  );
  res.json({ rows: rowsR.rows, total: Number(countR.rows[0].count), page: pageNum, limit: pageSize });
});

app.get('/quotes/:id/items', async (req, res) => {
  const r = await pool.query(`
    SELECT qi.*, a.code, a.description
    FROM quote_item qi
    JOIN article a ON a.id = qi.article_id
    WHERE qi.quote_id=$1
  `, [req.params.id]);
  res.json(r.rows);
});

app.post('/quotes', async (req, res) => {
  const client = await pool.connect();
  try {
    const { business_unit_id, customer_id, warehouse_id, project_id, currency, notes, items } = req.body;
    if (!items || !items.length) throw new Error('Agregá al menos un artículo.');
    await client.query('BEGIN');
    const qR = await client.query(
      `INSERT INTO quote (business_unit_id, customer_id, warehouse_id, project_id, currency, notes)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [business_unit_id, customer_id, warehouse_id || null, project_id || null, currency || 'ARS', notes || null]
    );
    const quote = qR.rows[0];
    for (const item of items) {
      await client.query(
        `INSERT INTO quote_item (quote_id, article_id, quantity, unit_price) VALUES ($1,$2,$3,$4)`,
        [quote.id, item.article_id, item.quantity, item.unit_price]
      );
    }
    await client.query('COMMIT');
    const full = await pool.query('SELECT * FROM quote WHERE id=$1', [quote.id]);
    res.json(full.rows[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: e.message });
  } finally {
    client.release();
  }
});

// (Roadmap Etapa 4) Edición completa de un presupuesto: solo mientras está
// PENDING (una vez CONVERTED ya generó una venta real, y CANCELLED ya no
// aplica). Mismo patrón que PUT /purchases/:id (Bloque 2): reemplaza las
// líneas, deja registro en audit_log.
app.put('/quotes/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { customer_id, warehouse_id, project_id, currency, notes, items } = req.body;
    if (!items || !items.length) throw new Error('Agregá al menos un artículo.');

    await client.query('BEGIN');
    const beforeR = await client.query('SELECT * FROM quote WHERE id=$1 FOR UPDATE', [id]);
    const before = beforeR.rows[0];
    if (!before) throw new Error('Presupuesto no encontrado.');
    if (before.status !== 'PENDING') throw new Error('Solo se puede editar un presupuesto mientras está pendiente.');
    const beforeItemsR = await client.query('SELECT article_id, quantity, unit_price FROM quote_item WHERE quote_id=$1', [id]);

    await client.query(
      `UPDATE quote SET customer_id=$1, warehouse_id=$2, project_id=$3, currency=$4, notes=$5 WHERE id=$6`,
      [customer_id, warehouse_id || null, project_id || null, currency || 'ARS', notes || null, id]
    );

    await client.query('DELETE FROM quote_item WHERE quote_id=$1', [id]);
    for (const item of items) {
      await client.query(
        `INSERT INTO quote_item (quote_id, article_id, quantity, unit_price) VALUES ($1,$2,$3,$4)`,
        [id, item.article_id, item.quantity, item.unit_price]
      );
    }

    const afterR = await client.query('SELECT * FROM quote WHERE id=$1', [id]);
    await logAudit(client, {
      tableName: 'quote', recordId: Number(id), action: 'EDIT',
      oldValues: { ...before, items: beforeItemsR.rows },
      newValues: { ...afterR.rows[0], items },
      userId: req.user.id,
    });

    await client.query('COMMIT');
    res.json(afterR.rows[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: e.message });
  } finally {
    client.release();
  }
});

app.delete('/quotes/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('UPDATE quote SET deleted_at=now() WHERE id=$1', [id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/quotes/:id/cancel', async (req, res) => {
  try {
    await pool.query(`UPDATE quote SET status='CANCELLED' WHERE id=$1`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/sales', async (req, res) => {
  const r = await pool.query('SELECT * FROM sale WHERE deleted_at IS NULL ORDER BY id DESC');
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

app.get('/sales/:id/full', async (req, res) => {
  try {
    const { id } = req.params;
    const saleR = await pool.query('SELECT * FROM sale WHERE id=$1', [id]);
    const sale = saleR.rows[0];
    if (!sale) throw new Error('Venta no encontrada.');
    const customerR = await pool.query('SELECT * FROM customer WHERE id=$1', [sale.customer_id]);
    const buR = await pool.query('SELECT * FROM business_unit WHERE id=$1', [sale.business_unit_id]);
    const whR = await pool.query('SELECT * FROM warehouse WHERE id=$1', [sale.warehouse_id]);
    const itemsR = await pool.query(`
      SELECT si.*, a.code, a.description
      FROM sale_item si JOIN article a ON a.id = si.article_id
      WHERE si.sale_id=$1
    `, [id]);
    const bankConvR = await pool.query('SELECT * FROM sale_bank_conversion WHERE sale_id=$1', [id]);
    res.json({ sale, customer: customerR.rows[0], business_unit: buR.rows[0], warehouse: whR.rows[0], items: itemsR.rows, bank_conversion: bankConvR.rows[0] || null });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.put('/sales/:id/transport', async (req, res) => {
  try {
    const { id } = req.params;
    const { carrier, tracking_code, delivery_notes, delivery_address } = req.body;
    const r = await pool.query(
      'UPDATE sale SET carrier=$1, tracking_code=$2, delivery_notes=$3, delivery_address=$4 WHERE id=$5 RETURNING *',
      [carrier || null, tracking_code || null, delivery_notes || null, delivery_address || null, id]
    );
    res.json(r.rows[0]);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/sales/:id/document-log', async (req, res) => {
  try {
    const { id } = req.params;
    const { type } = req.body; // 'comprobante' | 'remito'
    const r = await pool.query(
      'INSERT INTO sale_document_log (sale_id, type, generated_by) VALUES ($1,$2,$3) RETURNING *',
      [id, type, req.user.id]
    );
    res.json(r.rows[0]);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/sales-documents/history/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM sale_document_log WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/sales-documents/history', async (req, res) => {
  const { business_unit_id } = req.query;
  const values = [];
  let where = '';
  if (business_unit_id) { where = 'WHERE s.business_unit_id = $1'; values.push(business_unit_id); }
  const r = await pool.query(`
    SELECT sdl.id, sdl.sale_id, sdl.type, sdl.generated_at, u.username AS generated_by_username,
           c.name AS customer_name, s.total_amount, s.currency, s.status
    FROM sale_document_log sdl
    JOIN sale s ON s.id = sdl.sale_id
    JOIN customer c ON c.id = s.customer_id
    LEFT JOIN app_user u ON u.id = sdl.generated_by
    ${where}
    ORDER BY sdl.generated_at DESC
    LIMIT 200
  `, values);
  res.json(r.rows);
});

app.get('/sales/list', async (req, res) => {
  const { business_unit_id, date_from, date_to, page, limit } = req.query;
  const pageNum = Math.max(1, parseInt(page) || 1);
  const pageSize = Math.min(200, Math.max(10, parseInt(limit) || 25));
  const offset = (pageNum - 1) * pageSize;

  const conditions = ['deleted_at IS NULL'];
  const values = [];
  let i = 1;
  if (business_unit_id) { conditions.push(`business_unit_id = $${i++}`); values.push(business_unit_id); }
  if (date_from) { conditions.push(`date >= $${i++}`); values.push(date_from); }
  if (date_to) { conditions.push(`date < ($${i++}::date + interval '1 day')`); values.push(date_to); }
  const where = `WHERE ${conditions.join(' AND ')}`;

  const countR = await pool.query(`SELECT COUNT(*) FROM sale ${where}`, values);
  const rowsR = await pool.query(
    `SELECT * FROM sale ${where} ORDER BY id DESC LIMIT $${i} OFFSET $${i + 1}`,
    [...values, pageSize, offset]
  );
  res.json({ rows: rowsR.rows, total: Number(countR.rows[0].count), page: pageNum, limit: pageSize });
});

// Una venta CONFIRMADA no se elimina directamente: hay que cancelarla primero
// (eso ya revierte stock/cobros con historial completo). Una vez pendiente o
// cancelada, "eliminar" solo la manda a la papelera por 30 días.
app.delete('/sales/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const r = await pool.query('SELECT status FROM sale WHERE id=$1', [id]);
    if (!r.rows[0]) throw new Error('Venta no encontrada.');
    if (r.rows[0].status === 'CONFIRMED') {
      throw new Error('Esta venta está confirmada. Cancelala primero (botón "Cancelar") y después vas a poder eliminarla.');
    }
    await pool.query('UPDATE sale SET deleted_at=now() WHERE id=$1', [id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/sales/pending-collection', async (req, res) => {
  const r = await pool.query('SELECT * FROM sale_pending_collection ORDER BY date DESC');
  res.json(r.rows);
});

// Desde el Bloque 9 (julio 2026), "Procesar cobro" verifica solo al toque
// (ver /sales/:id/collect), así que esta lista ya no es "lo que falta
// verificar" en sentido estricto — pasa a mostrar dos cosas distintas, que el
// frontend separa visualmente con el flag `verified`:
//   - verified=FALSE: lo que sigue en dos etapas de verdad (los movimientos
//     en USD de una conversión bancaria en curso, o algún cobro viejo de
//     antes de este bloque que haya quedado pendiente).
//   - verified=TRUE: cobros en pesos ya confirmados que todavía se pueden
//     convertir a USD (no tienen conversión bancaria registrada para su
//     venta todavía). Quedan ahí sin límite de tiempo, hasta que se
//     conviertan o se cancele la venta (pedido explícito de Matias).
app.get('/sale-collections/pending', async (req, res) => {
  const r = await pool.query(`
    SELECT sc.*, s.customer_id, c.name AS customer_name, cb.name AS cash_box_name, cb.currency AS cash_box_currency,
           bu.name AS business_unit_name
    FROM sale_collection sc
    JOIN sale s ON s.id = sc.sale_id
    JOIN customer c ON c.id = s.customer_id
    JOIN cash_box cb ON cb.id = sc.cash_box_id
    JOIN business_unit bu ON bu.id = sc.business_unit_id
    WHERE sc.verified = FALSE
       OR (
         sc.verified = TRUE AND sc.direction <> 'OUT' AND cb.currency <> 'USD'
         AND NOT EXISTS (SELECT 1 FROM sale_bank_conversion sbc WHERE sbc.sale_id = sc.sale_id)
       )
    ORDER BY sc.verified ASC, sc.created_at ASC
  `);
  res.json(r.rows);
});

app.get('/sale-collections/by-business-unit/:businessUnitId', async (req, res) => {
  const r = await pool.query(`
    SELECT sc.sale_id, sc.verified, sc.direction, cb.id AS cash_box_id, cb.name AS cash_box_name, cb.kind AS cash_box_kind, sc.amount
    FROM sale_collection sc
    JOIN cash_box cb ON cb.id = sc.cash_box_id
    WHERE sc.business_unit_id = $1
    ORDER BY sc.created_at DESC
  `, [req.params.businessUnitId]);
  res.json(r.rows);
});

// Crea el cash_movement real de un sale_collection y lo marca verificado.
// Reutilizado por /sale-collections/:id/verify (verificación manual, para lo
// que sigue en dos etapas: conversiones bancarias en curso y cobros viejos
// pendientes de antes del Bloque 9) y por /sales/:id/collect (verificación
// inmediata, ver Bloque 9). `sc` tiene que traer al menos: id, cash_session_id,
// business_unit_id, project_id, amount, direction, sale_id.
async function verifySaleCollectionRow(client, sc, userId) {
  // direction='OUT' (conversión bancaria): los dólares salen de esta caja -> EXPENSE.
  // direction='IN' (todo lo de siempre): el cobro entra a esta caja -> INCOME.
  const movementType = sc.direction === 'OUT' ? 'EXPENSE' : 'INCOME';
  const movementDesc = sc.direction === 'OUT'
    ? `Entrega de USD por conversión bancaria — Venta #${sc.sale_id}`
    : `Cobro Venta #${sc.sale_id}`;
  const movR = await client.query(
    `INSERT INTO cash_movement (cash_session_id, business_unit_id, project_id, type, amount, description, origin_type, origin_id)
     VALUES ($1,$2,$3,$4,$5,$6,'SALE',$7) RETURNING id`,
    [sc.cash_session_id, sc.business_unit_id, sc.project_id, movementType, sc.amount, movementDesc, sc.sale_id]
  );
  await client.query(
    `UPDATE sale_collection SET verified=TRUE, verified_at=now(), verified_by=$1, cash_movement_id=$2 WHERE id=$3`,
    [userId, movR.rows[0].id, sc.id]
  );
  return movR.rows[0].id;
}

app.post('/sale-collections/:id/verify', async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    await client.query('BEGIN');
    const scR = await client.query('SELECT * FROM sale_collection WHERE id=$1 FOR UPDATE', [id]);
    const sc = scR.rows[0];
    if (!sc) throw new Error('Cobro no encontrado.');
    if (sc.verified) throw new Error('Este cobro ya fue verificado.');

    await verifySaleCollectionRow(client, sc, req.user.id);

    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: e.message });
  } finally {
    client.release();
  }
});

app.post('/sale-collections/:id/reject', async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    await client.query('BEGIN');
    const scR = await client.query('SELECT * FROM sale_collection WHERE id=$1 FOR UPDATE', [id]);
    const sc = scR.rows[0];
    if (!sc) throw new Error('Cobro no encontrado.');
    if (sc.verified) throw new Error('Este cobro ya fue verificado, no se puede rechazar así.');

    // Las filas de conversión bancaria (IN y OUT) no suman/restan contra settled_amount
    // por fila: la venta ya se cerró en pesos de una sola vez al crear la conversión.
    if (sc.affects_settled_amount) {
      await client.query('UPDATE sale SET settled_amount = settled_amount - $1 WHERE id=$2', [sc.amount, sc.sale_id]);
    }
    await client.query('DELETE FROM sale_collection WHERE id=$1', [id]);

    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: e.message });
  } finally {
    client.release();
  }
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
    if (!['UNCOLLECTED', 'ACCOUNT', 'CASH'].includes(sale.payment_type)) throw new Error('Tipo de venta no admite procesar cobro.');

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

      // Bloque 9 (julio 2026): el impacto instantáneo es solo para cobros en
      // PESOS. Los cobros en dólares siguen el flujo clásico de 2 etapas
      // (quedan pendientes en "Verificar cobros" con "Confirmar movimiento
      // físico"), porque ahí es donde se hace el movimiento manual real de
      // esa venta en USD.
      const cbR = await client.query(`SELECT currency FROM cash_box WHERE id=$1`, [split.cash_box_id]);
      const cashBoxCurrency = cbR.rows[0]?.currency;

      const scR = await client.query(
        `INSERT INTO sale_collection (sale_id, cash_box_id, cash_session_id, business_unit_id, project_id, amount, verified)
         VALUES ($1,$2,$3,$4,$5,$6,FALSE) RETURNING *`,
        [sale.id, split.cash_box_id, session.id, sale.business_unit_id, split.project_id || null, split.amount]
      );
      if (cashBoxCurrency !== 'USD') {
        await verifySaleCollectionRow(client, scR.rows[0], req.user.id);
      }
    }

    if (sale.payment_type === 'ACCOUNT') {
      await client.query(
        `INSERT INTO customer_account_movement (customer_id, business_unit_id, sale_id, type, amount, description)
         VALUES ($1,$2,$3,'CREDIT',$4,$5)`,
        [sale.customer_id, sale.business_unit_id, sale.id, splitTotal, `Cobro cta. cte. Venta #${sale.id}`]
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

// Conversión bancaria: paso OPCIONAL entre "Procesar cobro" y "Verificar
// cobro" (Bloque 8, julio 2026 — reemplaza el flujo anterior que actuaba
// sobre la venta completa como alternativa a "Procesar cobro"). Parte de un
// sale_collection ya creado y todavía sin verificar: ese cobro en pesos se
// pagó por transferencia a un banco (ej. Banco Macro), nunca llegó
// físicamente a la caja/sobre con la que se registró, así que se da de baja
// SIN tocar sale.settled_amount (la venta ya estaba bien marcada como
// cobrada desde "Procesar cobro"). La empresa entrega en cambio un monto en
// USD decidido manualmente (sin cálculo de TC), que sale de UNA caja/sobre de
// origen y se reparte entre una o varias cajas/sobres destino. Esos dólares
// sí usan el mismo mecanismo de siempre (sale_collection) y quedan
// pendientes en "Verificar cobros" hasta que se confirme el movimiento físico.
app.post('/sale-collections/:id/convert-to-usd', async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { bank_name, usd_equivalent, notes, origin_cash_box_id, origin_project_id, destination_splits } = req.body;

    if (!bank_name) throw new Error('Indicá el banco (ej. Banco Macro).');
    if (!usd_equivalent || Number(usd_equivalent) <= 0) throw new Error('Indicá el equivalente en dólares.');
    if (!origin_cash_box_id) throw new Error('Elegí la caja/sobre de origen de los dólares.');
    if (!destination_splits || !destination_splits.length) throw new Error('Agregá al menos una caja/sobre destino.');

    const destTotal = destination_splits.reduce((a, s) => a + Number(s.amount), 0);
    if (Math.abs(destTotal - Number(usd_equivalent)) > 0.01) {
      throw new Error(`La distribución entre cajas destino ($${destTotal}) debe ser igual al equivalente en dólares ($${usd_equivalent}).`);
    }

    await client.query('BEGIN');

    const scR = await client.query(
      `SELECT sc.*, cb.currency AS cash_box_currency
       FROM sale_collection sc JOIN cash_box cb ON cb.id = sc.cash_box_id
       WHERE sc.id=$1 FOR UPDATE OF sc`,
      [id]
    );
    const sc = scR.rows[0];
    if (!sc) throw new Error('Cobro no encontrado.');
    if (sc.direction === 'OUT') throw new Error('Este movimiento ya es una salida de dólares, no se puede convertir.');
    if (sc.cash_box_currency === 'USD') throw new Error('Este cobro ya está en dólares, no hace falta convertirlo.');

    const existing = await client.query('SELECT id FROM sale_bank_conversion WHERE sale_id=$1', [sc.sale_id]);
    if (existing.rows[0]) throw new Error('Esta venta ya tiene una conversión bancaria registrada.');

    const originR = await client.query('SELECT * FROM cash_box WHERE id=$1', [origin_cash_box_id]);
    const originBox = originR.rows[0];
    if (!originBox) throw new Error('La caja/sobre de origen no existe.');
    if (originBox.currency !== 'USD') throw new Error('La caja/sobre de origen debe ser en dólares.');

    // Registro de trazabilidad de los pesos recibidos: NO toca cash_box ni cash_movement.
    const conv = await client.query(
      `INSERT INTO sale_bank_conversion (sale_id, bank_name, amount_ars, usd_equivalent, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [sc.sale_id, bank_name, sc.amount, usd_equivalent, notes || null, req.user.id]
    );

    // Desde el Bloque 9, un cobro normal ya impactó la caja/sobre al procesarse
    // (sc.verified=TRUE). Como en realidad esos pesos nunca llegaron ahí, hay
    // que revertir ese movimiento antes de dar de baja el cobro — mismo
    // mecanismo que ya usa "Cancelar" para cobros verificados. Si viniera de
    // un cobro viejo, de antes del Bloque 9, que todavía estuviera sin
    // verificar, no hay nada que revertir.
    if (sc.verified) {
      await client.query(
        `INSERT INTO cash_movement (cash_session_id, business_unit_id, project_id, type, amount, description, origin_type, origin_id)
         VALUES ($1,$2,$3,'EXPENSE',$4,$5,'SALE',$6)`,
        [sc.cash_session_id, sc.business_unit_id, sc.project_id, sc.amount, `Reversa cobro por conversión bancaria — Venta #${sc.sale_id}`, sc.sale_id]
      );
    }
    // settled_amount de la venta NO se toca: ya estaba bien contado desde
    // "Procesar cobro", esto solo cambia CÓMO se termina de cobrar.
    await client.query('DELETE FROM sale_collection WHERE id=$1', [id]);

    // Egreso pendiente de verificar: los dólares que salen de la caja/sobre de origen.
    const originSessR = await client.query(
      `SELECT id FROM cash_session WHERE cash_box_id=$1 AND status='OPEN' LIMIT 1`,
      [origin_cash_box_id]
    );
    const originSess = originSessR.rows[0];
    if (!originSess) throw new Error(`${originBox.name} no tiene una sesión abierta.`);

    await client.query(
      `INSERT INTO sale_collection (sale_id, cash_box_id, cash_session_id, business_unit_id, project_id, amount, direction, affects_settled_amount, verified)
       VALUES ($1,$2,$3,$4,$5,$6,'OUT',FALSE,FALSE)`,
      [sc.sale_id, origin_cash_box_id, originSess.id, sc.business_unit_id, origin_project_id || null, usd_equivalent]
    );

    // Ingresos pendientes de verificar: los dólares que entran a cada caja/sobre destino.
    for (const split of destination_splits) {
      const boxR = await client.query('SELECT * FROM cash_box WHERE id=$1', [split.cash_box_id]);
      const box = boxR.rows[0];
      if (!box) throw new Error('Una de las cajas/sobres destino no existe.');
      if (box.currency !== 'USD') throw new Error(`${box.name} no es una caja en dólares.`);

      const sessR = await client.query(
        `SELECT id FROM cash_session WHERE cash_box_id=$1 AND status='OPEN' LIMIT 1`,
        [split.cash_box_id]
      );
      const sess = sessR.rows[0];
      if (!sess) throw new Error(`${box.name} no tiene una sesión abierta.`);

      await client.query(
        `INSERT INTO sale_collection (sale_id, cash_box_id, cash_session_id, business_unit_id, project_id, amount, direction, affects_settled_amount, verified)
         VALUES ($1,$2,$3,$4,$5,$6,'IN',FALSE,FALSE)`,
        [sc.sale_id, split.cash_box_id, sess.id, sc.business_unit_id, split.project_id || null, split.amount]
      );
    }

    await client.query('COMMIT');
    const updated = await pool.query('SELECT * FROM sale WHERE id=$1', [sc.sale_id]);
    res.json({ sale: updated.rows[0], bank_conversion: conv.rows[0] });
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
app.get('/stock/list', async (req, res) => {
  const { business_unit_id, search, page, limit } = req.query;
  const pageNum = Math.max(1, parseInt(page) || 1);
  const pageSize = Math.min(200, Math.max(10, parseInt(limit) || 50));
  const offset = (pageNum - 1) * pageSize;

  const conditions = [];
  const values = [];
  let i = 1;
  if (business_unit_id) { conditions.push(`w.business_unit_id = $${i++}`); values.push(business_unit_id); }
  if (search) {
    conditions.push(`(a.code ILIKE $${i} OR a.alt_code ILIKE $${i} OR a.description ILIKE $${i} OR w.name ILIKE $${i})`);
    values.push(`%${search}%`);
    i++;
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const countR = await pool.query(
    `SELECT COUNT(*) FROM stock s JOIN article a ON a.id = s.article_id JOIN warehouse w ON w.id = s.warehouse_id ${where}`,
    values
  );
  const rowsR = await pool.query(
    `SELECT s.*, a.code, a.alt_code, a.description, w.name AS warehouse_name
     FROM stock s
     JOIN article a ON a.id = s.article_id
     JOIN warehouse w ON w.id = s.warehouse_id
     ${where}
     ORDER BY w.name, a.code
     LIMIT $${i} OFFSET $${i + 1}`,
    [...values, pageSize, offset]
  );
  res.json({ rows: rowsR.rows, total: Number(countR.rows[0].count), page: pageNum, limit: pageSize });
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

// ---------- DASHBOARD ----------
// Resume el Panel en el servidor: antes el frontend bajaba compras, ventas y
// stock completos (de todas las unidades de negocio) y filtraba/sumaba en el
// navegador. Acá se calcula todo ya filtrado por unidad de negocio, para no
// transferir ni procesar de más a medida que crece el historial.
app.get('/dashboard/summary', async (req, res) => {
  try {
    const { business_unit_id } = req.query;
    if (!business_unit_id) throw new Error('Falta business_unit_id.');

    const [salesR, purchasesR, stockR, projectsR, profitR, recentR] = await Promise.all([
      pool.query(
        `SELECT COALESCE(SUM(total_amount),0) AS total FROM sale
         WHERE business_unit_id=$1 AND status='CONFIRMED' AND deleted_at IS NULL`,
        [business_unit_id]
      ),
      pool.query(
        `SELECT COALESCE(SUM(total_amount),0) AS total FROM purchase
         WHERE business_unit_id=$1 AND status='CONFIRMED' AND deleted_at IS NULL`,
        [business_unit_id]
      ),
      pool.query(
        `SELECT COALESCE(SUM(s.quantity),0) AS total
         FROM stock s JOIN warehouse w ON w.id = s.warehouse_id
         WHERE w.business_unit_id=$1`,
        [business_unit_id]
      ),
      pool.query(
        `SELECT COUNT(*) AS total FROM project WHERE business_unit_id=$1 AND deleted_at IS NULL`,
        [business_unit_id]
      ),
      pool.query(
        `SELECT pp.* FROM project_profitability pp
         JOIN project p ON p.id = pp.project_id
         WHERE p.business_unit_id=$1 AND p.deleted_at IS NULL
         ORDER BY pp.project_id`,
        [business_unit_id]
      ),
      pool.query(
        `SELECT * FROM (
           SELECT id, date, status, total_amount, 'Compra' AS kind FROM purchase
             WHERE business_unit_id=$1 AND deleted_at IS NULL
           UNION ALL
           SELECT id, date, status, total_amount, 'Venta' AS kind FROM sale
             WHERE business_unit_id=$1 AND deleted_at IS NULL
         ) x ORDER BY date DESC LIMIT 8`,
        [business_unit_id]
      ),
    ]);

    res.json({
      totalSales: Number(salesR.rows[0].total),
      totalPurchases: Number(purchasesR.rows[0].total),
      stockUnits: Number(stockR.rows[0].total),
      activeProjectsCount: Number(projectsR.rows[0].total),
      profitability: profitR.rows,
      recentOperations: recentR.rows,
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---------- BÚSQUEDA GLOBAL (topbar) ----------
// Solo lectura, sin migración. Busca por N° de operación (venta/compra),
// nombre/CUIT de cliente o proveedor, o código/descripción de artículo.
// Devuelve hasta 5 resultados por categoría, con la unidad de negocio de
// cada resultado para poder cambiar a esa unidad al ir directo al resultado.
app.get('/search/global', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (q.length < 2) {
      return res.json({
        customers: [], suppliers: [], articles: [], sales: [], purchases: [],
        quotes: [], shipments: [], projects: [], warehouses: [],
      });
    }
    const like = `%${q}%`;

    const [customersR, suppliersR, articlesR, salesR, purchasesR, quotesR, shipmentsR, projectsR, warehousesR] = await Promise.all([
      pool.query(
        `SELECT id, name, tax_id FROM customer
         WHERE deleted_at IS NULL AND (name ILIKE $1 OR tax_id ILIKE $1)
         ORDER BY name LIMIT 5`,
        [like]
      ),
      pool.query(
        `SELECT id, name, tax_id FROM supplier
         WHERE deleted_at IS NULL AND (name ILIKE $1 OR tax_id ILIKE $1)
         ORDER BY name LIMIT 5`,
        [like]
      ),
      pool.query(
        `SELECT a.id, a.code, a.alt_code, a.description, a.business_unit_id, bu.name AS business_unit_name
         FROM article a JOIN business_unit bu ON bu.id = a.business_unit_id
         WHERE a.code ILIKE $1 OR a.alt_code ILIKE $1 OR a.description ILIKE $1
         ORDER BY a.code LIMIT 5`,
        [like]
      ),
      pool.query(
        `SELECT s.id, s.total_amount, s.status, s.business_unit_id, bu.name AS business_unit_name,
                c.name AS customer_name
         FROM sale s
         JOIN business_unit bu ON bu.id = s.business_unit_id
         LEFT JOIN customer c ON c.id = s.customer_id
         WHERE s.deleted_at IS NULL AND CAST(s.id AS TEXT) ILIKE $1
         ORDER BY s.id DESC LIMIT 5`,
        [like]
      ),
      pool.query(
        `SELECT p.id, p.total_amount, p.status, p.business_unit_id, bu.name AS business_unit_name,
                s.name AS supplier_name
         FROM purchase p
         JOIN business_unit bu ON bu.id = p.business_unit_id
         LEFT JOIN supplier s ON s.id = p.supplier_id
         WHERE p.deleted_at IS NULL AND CAST(p.id AS TEXT) ILIKE $1
         ORDER BY p.id DESC LIMIT 5`,
        [like]
      ),
      // (Roadmap Etapa 3) Antes el buscador global no cubría estas 4 entidades.
      // Mismo patrón que Ventas/Compras: ILIKE + LIMIT 5.
      pool.query(
        `SELECT q.id, q.total_amount, q.currency, q.status, q.business_unit_id, bu.name AS business_unit_name,
                c.name AS customer_name
         FROM quote q
         JOIN business_unit bu ON bu.id = q.business_unit_id
         LEFT JOIN customer c ON c.id = q.customer_id
         WHERE q.deleted_at IS NULL AND (CAST(q.id AS TEXT) ILIKE $1 OR c.name ILIKE $1)
         ORDER BY q.id DESC LIMIT 5`,
        [like]
      ),
      pool.query(
        `SELECT sh.id, sh.status, sh.business_unit_id, bu.name AS business_unit_name,
                c.name AS customer_name
         FROM shipment sh
         JOIN business_unit bu ON bu.id = sh.business_unit_id
         LEFT JOIN customer c ON c.id = sh.customer_id
         WHERE sh.deleted_at IS NULL AND (CAST(sh.id AS TEXT) ILIKE $1 OR c.name ILIKE $1)
         ORDER BY sh.id DESC LIMIT 5`,
        [like]
      ),
      pool.query(
        `SELECT pr.id, pr.name, pr.business_unit_id, bu.name AS business_unit_name
         FROM project pr JOIN business_unit bu ON bu.id = pr.business_unit_id
         WHERE pr.deleted_at IS NULL AND pr.name ILIKE $1
         ORDER BY pr.name LIMIT 5`,
        [like]
      ),
      pool.query(
        `SELECT w.id, w.name, w.business_unit_id, bu.name AS business_unit_name
         FROM warehouse w JOIN business_unit bu ON bu.id = w.business_unit_id
         WHERE w.deleted_at IS NULL AND w.name ILIKE $1
         ORDER BY w.name LIMIT 5`,
        [like]
      ),
    ]);

    res.json({
      customers: customersR.rows,
      suppliers: suppliersR.rows,
      articles: articlesR.rows,
      sales: salesR.rows,
      purchases: purchasesR.rows,
      quotes: quotesR.rows,
      shipments: shipmentsR.rows,
      projects: projectsR.rows,
      warehouses: warehousesR.rows,
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
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
