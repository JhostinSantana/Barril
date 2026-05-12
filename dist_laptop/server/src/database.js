import fs from 'node:fs';
import path from 'node:path';
import sqlite3 from 'sqlite3';
import { DEFAULT_MENU, DEFAULT_MENU_VERSION, DEFAULT_RESTAURANT_NAME } from './utils.js';

sqlite3.verbose();

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'barril.sqlite');
const db = new sqlite3.Database(DB_PATH);

db.serialize(() => {
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA synchronous = NORMAL;');
  db.exec('PRAGMA busy_timeout = 5000;');
});

function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function getPaymentSummary(payments) {
  return payments.reduce(
    (acc, payment) => {
      const amount = roundMoney(payment.amount ?? 0);
      if (payment.paymentMethod === 'efectivo') {
        acc.efectivo = roundMoney(acc.efectivo + amount);
      }
      if (payment.paymentMethod === 'transferencia') {
        acc.transferencia = roundMoney(acc.transferencia + amount);
      }
      return acc;
    },
    { efectivo: 0, transferencia: 0 }
  );
}

function resolvePaymentMethod(paymentSummary, fallback) {
  const hasCash = paymentSummary.efectivo > 0;
  const hasTransfer = paymentSummary.transferencia > 0;

  if (hasCash && hasTransfer) return 'mixto';
  if (hasCash) return 'efectivo';
  if (hasTransfer) return 'transferencia';
  return fallback ?? null;
}

function mapOrderRow(row, items, payments) {
  const paidAmount = roundMoney(row.paid_amount ?? 0);
  const balanceDue = roundMoney(Math.max(Number(row.total ?? 0) - paidAmount, 0));
  const paymentSummary = getPaymentSummary(payments);

  return {
    id: row.id,
    clientName: row.client_name,
    tableNumber: row.table_number,
    waiterName: row.waiter_name,
    status: row.status,
    paymentMethod: resolvePaymentMethod(paymentSummary, row.payment_method),
    paymentSummary,
    paidAmount,
    balanceDue,
    total: row.total,
    createdAt: row.created_at,
    paidAt: row.paid_at,
    items,
    payments
  };
}

export async function initializeDatabase() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  await run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS menu_items (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      price REAL NOT NULL,
      sort_order INTEGER NOT NULL
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      client_name TEXT NOT NULL,
      table_number TEXT NOT NULL,
      waiter_name TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      payment_method TEXT,
      total REAL NOT NULL,
      paid_amount REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      paid_at TEXT
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT NOT NULL,
      menu_item_id TEXT NOT NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      unit_price REAL NOT NULL,
      subtotal REAL NOT NULL,
      FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS order_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT NOT NULL,
      payment_method TEXT NOT NULL,
      amount REAL NOT NULL,
      tendered_amount REAL NOT NULL DEFAULT 0,
      change_given REAL NOT NULL DEFAULT 0,
      transfer_number TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE
    )
  `);

  const orderColumns = await all('PRAGMA table_info(orders)');
  if (!orderColumns.some((column) => column.name === 'waiter_name')) {
    await run("ALTER TABLE orders ADD COLUMN waiter_name TEXT NOT NULL DEFAULT ''");
  }
  if (!orderColumns.some((column) => column.name === 'paid_amount')) {
    await run('ALTER TABLE orders ADD COLUMN paid_amount REAL NOT NULL DEFAULT 0');
  }

  const itemColumns = await all('PRAGMA table_info(order_items)');
  if (!itemColumns.some((column) => column.name === 'category')) {
    await run("ALTER TABLE order_items ADD COLUMN category TEXT NOT NULL DEFAULT 'Sin categoria'");
  }

  const paymentColumns = await all('PRAGMA table_info(order_payments)');
  if (!paymentColumns.some((column) => column.name === 'transfer_number')) {
    await run('ALTER TABLE order_payments ADD COLUMN transfer_number TEXT');
  }

  await run(`
    UPDATE order_items
    SET category = (
      SELECT menu_items.category
      FROM menu_items
      WHERE menu_items.id = order_items.menu_item_id
    )
    WHERE category IS NULL OR category = '' OR category = 'Sin categoria'
  `);

  await run(`
    UPDATE orders
    SET paid_amount = total
    WHERE status = 'paid' AND (paid_amount IS NULL OR paid_amount = 0)
  `);

  const legacyPaidOrders = await all(`
    SELECT id, payment_method, paid_amount, paid_at, created_at
    FROM orders
    WHERE status = 'paid'
      AND paid_amount > 0
      AND NOT EXISTS (
        SELECT 1
        FROM order_payments
        WHERE order_payments.order_id = orders.id
      )
  `);

  for (const legacyOrder of legacyPaidOrders) {
    const method = legacyOrder.payment_method === 'transferencia' ? 'transferencia' : 'efectivo';
    await run(
      `INSERT INTO order_payments(order_id, payment_method, amount, tendered_amount, change_given, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        legacyOrder.id,
        method,
        legacyOrder.paid_amount,
        method === 'efectivo' ? legacyOrder.paid_amount : 0,
        0,
        legacyOrder.paid_at ?? legacyOrder.created_at
      ]
    );
  }

  const settingsCount = await get('SELECT COUNT(*) AS count FROM settings');
  if ((settingsCount?.count ?? 0) === 0) {
    await run('INSERT INTO settings(key, value) VALUES (?, ?)', ['restaurantName', DEFAULT_RESTAURANT_NAME]);
  }

  const menuVersionRow = await get('SELECT value FROM settings WHERE key = ?', ['menuVersion']);
  const menuCount = await get('SELECT COUNT(*) AS count FROM menu_items');
  if ((menuCount?.count ?? 0) === 0 || menuVersionRow?.value !== DEFAULT_MENU_VERSION) {
    await run('DELETE FROM menu_items');
    for (const [index, item] of DEFAULT_MENU.entries()) {
      await run(
        'INSERT INTO menu_items(id, name, category, price, sort_order) VALUES (?, ?, ?, ?, ?)',
        [item.id, item.name, item.category, item.price, index]
      );
    }

    await run(
      `INSERT INTO settings(key, value) VALUES(?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      ['menuVersion', DEFAULT_MENU_VERSION]
    );
  }
}

export async function getRestaurantName() {
  const row = await get('SELECT value FROM settings WHERE key = ?', ['restaurantName']);
  return row?.value ?? DEFAULT_RESTAURANT_NAME;
}

export async function getSetting(key) {
  const row = await get('SELECT value FROM settings WHERE key = ?', [key]);
  return row?.value ?? null;
}

export async function setSetting(key, value) {
  await run(
    `INSERT INTO settings(key, value) VALUES(?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value]
  );
}

export async function getMenu() {
  return all('SELECT id, name, category, price FROM menu_items ORDER BY sort_order ASC');
}

export async function createOrder(order) {
  await run(
    `INSERT INTO orders(id, client_name, table_number, waiter_name, status, payment_method, total, paid_amount, created_at, paid_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      order.id,
      order.clientName,
      order.tableNumber,
      order.waiterName,
      order.status,
      order.paymentMethod,
      roundMoney(order.total),
      0,
      order.createdAt,
      order.paidAt
    ]
  );

  for (const item of order.items) {
    await run(
      `INSERT INTO order_items(order_id, menu_item_id, name, category, quantity, unit_price, subtotal)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        order.id,
        item.menuItemId,
        item.name,
        item.category,
        item.quantity,
        roundMoney(item.unitPrice),
        roundMoney(item.subtotal)
      ]
    );
  }
}

export async function listOrders({ status, query } = {}) {
  const clauses = [];
  const params = [];

  if (status === 'pending') {
    clauses.push("status IN ('pending', 'partial')");
  } else if (status) {
    clauses.push('status = ?');
    params.push(status);
  }

  if (query) {
    clauses.push('(LOWER(client_name) LIKE ? OR LOWER(table_number) LIKE ? OR LOWER(id) LIKE ?)');
    const value = `%${query.toLowerCase()}%`;
    params.push(value, value, value);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = await all(`SELECT * FROM orders ${where} ORDER BY created_at DESC`, params);

  return Promise.all(
    rows.map(async (row) => {
      const [items, payments] = await Promise.all([listOrderItems(row.id), listOrderPayments(row.id)]);
      return mapOrderRow(row, items, payments);
    })
  );
}

export async function listOrdersByDate(dateKey) {
  const rows = await all(
    'SELECT * FROM orders WHERE substr(created_at, 1, 10) = ? ORDER BY created_at DESC',
    [dateKey]
  );

  return Promise.all(
    rows.map(async (row) => {
      const [items, payments] = await Promise.all([listOrderItems(row.id), listOrderPayments(row.id)]);
      return mapOrderRow(row, items, payments);
    })
  );
}

export async function getOrderById(orderId) {
  const row = await get('SELECT * FROM orders WHERE id = ?', [orderId]);
  if (!row) return null;

  const [items, payments] = await Promise.all([listOrderItems(row.id), listOrderPayments(row.id)]);
  return mapOrderRow(row, items, payments);
}

export async function addOrderPayment(orderId, paymentMethod, amount, tenderedAmount, changeGiven, paidAt, transferenceNumber) {
  const order = await getOrderById(orderId);
  if (!order) return null;

  const normalizedAmount = roundMoney(amount);
  const normalizedTendered = roundMoney(tenderedAmount);
  const normalizedChange = roundMoney(changeGiven);

  await run(
    `INSERT INTO order_payments(order_id, payment_method, amount, tendered_amount, change_given, transfer_number, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [orderId, paymentMethod, normalizedAmount, normalizedTendered, normalizedChange, transferenceNumber || null, paidAt]
  );

  const nextPaidAmount = roundMoney(Math.min(order.total, order.paidAmount + normalizedAmount));
  const nextStatus = nextPaidAmount >= order.total ? 'paid' : 'partial';

  const currentPayments = await listOrderPayments(orderId);
  const summary = getPaymentSummary(currentPayments);
  const resolvedMethod = resolvePaymentMethod(summary, paymentMethod);

  await run(
    `UPDATE orders
     SET status = ?, payment_method = ?, paid_amount = ?, paid_at = ?
     WHERE id = ?`,
    [nextStatus, resolvedMethod, nextPaidAmount, nextStatus === 'paid' ? paidAt : null, orderId]
  );

  return getOrderById(orderId);
}

export async function updateOrderPayment(orderId, paymentMethod, paidAt) {
  const order = await getOrderById(orderId);
  if (!order) return;
  if (order.balanceDue <= 0) return;

  await addOrderPayment(orderId, paymentMethod, order.balanceDue, order.balanceDue, 0, paidAt);
}

async function listOrderItems(orderId) {
  return all(
    'SELECT menu_item_id AS menuItemId, name, category, quantity, unit_price AS unitPrice, subtotal FROM order_items WHERE order_id = ? ORDER BY id ASC',
    [orderId]
  );
}

async function listOrderPayments(orderId) {
  return all(
    'SELECT id, payment_method AS paymentMethod, amount, tendered_amount AS tenderedAmount, change_given AS changeGiven, transfer_number AS transferenceNumber, created_at AS createdAt FROM order_payments WHERE order_id = ? ORDER BY id ASC',
    [orderId]
  );
}
