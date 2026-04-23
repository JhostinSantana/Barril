import fs from 'node:fs';
import path from 'node:path';
import sqlite3 from 'sqlite3';
import { DEFAULT_MENU, DEFAULT_RESTAURANT_NAME } from './utils.js';

sqlite3.verbose();

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'barril.sqlite');
const db = new sqlite3.Database(DB_PATH);

db.serialize(() => {
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA synchronous = NORMAL;');
  db.exec('PRAGMA busy_timeout = 5000;');
});

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

function mapOrderRow(row, items) {
  return {
    id: row.id,
    clientName: row.client_name,
    tableNumber: row.table_number,
    waiterName: row.waiter_name,
    status: row.status,
    paymentMethod: row.payment_method,
    total: row.total,
    createdAt: row.created_at,
    paidAt: row.paid_at,
    items
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
      price INTEGER NOT NULL,
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
      total INTEGER NOT NULL,
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
      unit_price INTEGER NOT NULL,
      subtotal INTEGER NOT NULL,
      FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE
    )
  `);

  const orderColumns = await all('PRAGMA table_info(orders)');
  if (!orderColumns.some((column) => column.name === 'waiter_name')) {
    await run("ALTER TABLE orders ADD COLUMN waiter_name TEXT NOT NULL DEFAULT ''");
  }

  const itemColumns = await all('PRAGMA table_info(order_items)');
  if (!itemColumns.some((column) => column.name === 'category')) {
    await run("ALTER TABLE order_items ADD COLUMN category TEXT NOT NULL DEFAULT 'Sin categoria'");
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

  const settingsCount = await get('SELECT COUNT(*) AS count FROM settings');
  if ((settingsCount?.count ?? 0) === 0) {
    await run('INSERT INTO settings(key, value) VALUES (?, ?)', ['restaurantName', DEFAULT_RESTAURANT_NAME]);
  }

  const menuCount = await get('SELECT COUNT(*) AS count FROM menu_items');
  if ((menuCount?.count ?? 0) === 0) {
    for (const [index, item] of DEFAULT_MENU.entries()) {
      await run(
        'INSERT INTO menu_items(id, name, category, price, sort_order) VALUES (?, ?, ?, ?, ?)',
        [item.id, item.name, item.category, item.price, index]
      );
    }
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
    `INSERT INTO orders(id, client_name, table_number, waiter_name, status, payment_method, total, created_at, paid_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      order.id,
      order.clientName,
      order.tableNumber,
      order.waiterName,
      order.status,
      order.paymentMethod,
      order.total,
      order.createdAt,
      order.paidAt
    ]
  );

  for (const item of order.items) {
    await run(
      `INSERT INTO order_items(order_id, menu_item_id, name, category, quantity, unit_price, subtotal)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [order.id, item.menuItemId, item.name, item.category, item.quantity, item.unitPrice, item.subtotal]
    );
  }
}

export async function listOrders({ status, query } = {}) {
  const clauses = [];
  const params = [];

  if (status) {
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

  return Promise.all(rows.map(async (row) => mapOrderRow(row, await listOrderItems(row.id))));
}

export async function listOrdersByDate(dateKey) {
  const rows = await all(
    'SELECT * FROM orders WHERE substr(created_at, 1, 10) = ? ORDER BY created_at DESC',
    [dateKey]
  );

  return Promise.all(rows.map(async (row) => mapOrderRow(row, await listOrderItems(row.id))));
}

export async function getOrderById(orderId) {
  const row = await get('SELECT * FROM orders WHERE id = ?', [orderId]);
  if (!row) return null;
  return mapOrderRow(row, await listOrderItems(row.id));
}

export async function updateOrderPayment(orderId, paymentMethod, paidAt) {
  await run(
    'UPDATE orders SET status = ?, payment_method = ?, paid_at = ? WHERE id = ?',
    ['paid', paymentMethod, paidAt, orderId]
  );
}

async function listOrderItems(orderId) {
  return all(
    'SELECT menu_item_id AS menuItemId, name, category, quantity, unit_price AS unitPrice, subtotal FROM order_items WHERE order_id = ? ORDER BY id ASC',
    [orderId]
  );
}
