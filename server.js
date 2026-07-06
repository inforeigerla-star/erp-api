const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();
const pool = require('./db');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- BUSINESS UNITS ----------
app.get('/business-units', async (req, res) => {
  const r = await pool.query('SELECT * FROM business_unit ORDER BY id');
  res.json(r.rows);
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

// ---------- ARTICLES ----------
app.post('/articles', async (req, res) => {
  const { business_unit_id, code, description, list_cost, shipping_margin_pct, fx_margin_pct, profit_margin_pct } = req.body;
  const r = await pool.query(
    `INSERT INTO article (business_unit_id, code, description, list_cost, shipping_margin_pct, fx_margin_pct, profit_margin_pct)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [business_unit_id, code, description, list_cost, shipping_margin_pct || 0, fx_margin_pct || 0, profit_margin_pct || 0]
  );
  res.json(r.rows[0]);
});
app.get('/articles', async (req, res) => {
  const r = await pool.query('SELECT * FROM article_price ORDER BY article_id');
  res.json(r.rows);
});

// ---------- CASH BOX / SESSIONS ----------
app.get('/cash-boxes', async (req, res) => {
  const r = await pool.query('SELECT * FROM cash_box ORDER BY id');
  res.json(r.rows);
});

app.post('/cash-sessions/open', async (req, res) => {
  const { cash_box_id, business_unit_id, opening_amount } = req.body;
  const r = await pool.query(
    `INSERT INTO cash_session (cash_box_id, business_unit_id, opening_amount)
     VALUES ($1,$2,$3) RETURNING *`,
    [cash_box_id, business_unit_id, opening_amount]
  );
  res.json(r.rows[0]);
});

app.post('/cash-sessions/:id/close', async (req, res) => {
  const { id } = req.params;
  const { closing_amount } = req.body;
  await pool.query('SELECT fn_close_cash_session($1,$2)', [id, closing_amount]);
  const r = await pool.query('SELECT * FROM daily_cash_summary WHERE session_id = $1', [id]);
  res.json(r.rows[0]);
});

app.get('/cash-sessions/:id/summary', async (req, res) => {
  const { id } = req.params;
  const r = await pool.query('SELECT * FROM daily_cash_summary WHERE session_id = $1', [id]);
  res.json(r.rows[0]);
});

app.post('/cash-movements', async (req, res) => {
  const { cash_session_id, business_unit_id, project_id, type, amount, description } = req.body;
  const r = await pool.query(
    `INSERT INTO cash_movement (cash_session_id, business_unit_id, project_id, type, amount, description, origin_type)
     VALUES ($1,$2,$3,$4,$5,$6,'MANUAL') RETURNING *`,
    [cash_session_id, business_unit_id, project_id || null, type, amount, description]
  );
  res.json(r.rows[0]);
});

// ---------- PURCHASES ----------
app.post('/purchases', async (req, res) => {
  const client = await pool.connect();
  try {
    const { business_unit_id, supplier_id, warehouse_id, project_id, payment_type, items } = req.body;
    await client.query('BEGIN');

    const purchaseR = await client.query(
      `INSERT INTO purchase (business_unit_id, supplier_id, warehouse_id, project_id, payment_type)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [business_unit_id, supplier_id, warehouse_id, project_id || null, payment_type]
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

// ---------- SALES ----------
app.post('/sales', async (req, res) => {
  const client = await pool.connect();
  try {
    const { business_unit_id, customer_id, warehouse_id, project_id, payment_type, items } = req.body;
    await client.query('BEGIN');

    const saleR = await client.query(
      `INSERT INTO sale (business_unit_id, customer_id, warehouse_id, project_id, payment_type)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [business_unit_id, customer_id, warehouse_id, project_id || null, payment_type || 'CASH']
    );
    const sale = saleR.rows[0];

    for (const item of items) {
      await client.query(
        `INSERT INTO sale_item (sale_id, article_id, quantity, unit_price)
         VALUES ($1,$2,$3,$4)`,
        [sale.id, item.article_id, item.quantity, item.unit_price]
      );
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
