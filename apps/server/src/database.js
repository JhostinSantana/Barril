import fs from 'node:fs';
import path from 'node:path';
import sqlite3 from 'sqlite3';
import {
  DEFAULT_MENU,
  DEFAULT_MENU_VERSION,
  DEFAULT_RESTAURANT_NAME,
  calculateExpensesTotal,
  normalizeOrderExpenses,
  summarizeItems
} from './utils.js';

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

function parseJsonArray(rawValue) {
  if (!rawValue) return [];

  try {
    const parsed = JSON.parse(rawValue);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeWaiterName(name) {
  return `${name ?? ''}`.trim().replace(/\s+/g, ' ').toLowerCase();
}

function formatWaiterName(name) {
  return `${name ?? ''}`.trim().replace(/\s+/g, ' ');
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
  const editSummary = parseJsonArray(row.edit_summary_json);
  const comments = parseJsonArray(row.comments_json);
  const expenses = normalizeOrderExpenses(parseJsonArray(row.expenses_json));

  return {
    id: row.id,
    clientName: row.client_name,
    tableNumber: row.table_number,
    waiterName: row.waiter_name,
    status: row.status,
    kitchenStatus: row.kitchen_status ?? 'pendiente',
    kitchenStartedAt: row.kitchen_started_at ?? null,
    kitchenFinishedAt: row.kitchen_finished_at ?? null,
    paymentMethod: resolvePaymentMethod(paymentSummary, row.payment_method),
    paymentSummary,
    paidAmount,
    balanceDue,
    total: row.total,
    expenses,
    expensesTotal: calculateExpensesTotal(expenses),
    createdAt: row.created_at,
    paidAt: row.paid_at,
    editSummary,
    editedAt: row.edited_at,
    comments,
    items,
    payments
  };
}

function buildEditSummary(currentItems, nextItems) {
  const currentMap = new Map((currentItems ?? []).map((item) => [item.menuItemId, item]));
  const nextMap = new Map((nextItems ?? []).map((item) => [item.menuItemId, item]));
  const summary = [];

  for (const [menuItemId, nextItem] of nextMap.entries()) {
    const currentItem = currentMap.get(menuItemId);
    if (!currentItem) {
      summary.push({
        menuItemId,
        name: nextItem.name,
        category: nextItem.category,
        type: 'added',
        previousQuantity: 0,
        quantity: Number(nextItem.quantity) || 0,
        delta: Number(nextItem.quantity) || 0
      });
      continue;
    }

    const previousQuantity = Number(currentItem.quantity) || 0;
    const nextQuantity = Number(nextItem.quantity) || 0;
    if (previousQuantity !== nextQuantity) {
      summary.push({
        menuItemId,
        name: nextItem.name,
        category: nextItem.category,
        type: nextQuantity > previousQuantity ? 'quantity-up' : 'quantity-down',
        previousQuantity,
        quantity: nextQuantity,
        delta: nextQuantity - previousQuantity
      });
    }
  }

  for (const [menuItemId, currentItem] of currentMap.entries()) {
    if (nextMap.has(menuItemId)) continue;
    const previousQuantity = Number(currentItem.quantity) || 0;
    summary.push({
      menuItemId,
      name: currentItem.name,
      category: currentItem.category,
      type: 'removed',
      previousQuantity,
      quantity: 0,
      delta: -previousQuantity
    });
  }

  return summary;
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
      pricing_mode TEXT NOT NULL DEFAULT 'fixed',
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
      kitchen_status TEXT NOT NULL DEFAULT 'pendiente',
      kitchen_started_at TEXT,
      kitchen_finished_at TEXT,
      payment_method TEXT,
      total REAL NOT NULL,
      paid_amount REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      paid_at TEXT,
      edit_summary_json TEXT NOT NULL DEFAULT '[]',
      comments_json TEXT NOT NULL DEFAULT '[]',
      expenses_json TEXT NOT NULL DEFAULT '[]',
      edited_at TEXT
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
      weight_grams REAL,
      pricing_mode TEXT NOT NULL DEFAULT 'fixed',
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

  // Add transfer_number column if it doesn't exist (migration for existing databases)
  try {
    await run(`ALTER TABLE order_payments ADD COLUMN transfer_number TEXT`);
  } catch (error) {
    // Column already exists, ignore error
  }

  await run(`
    CREATE TABLE IF NOT EXISTS waiters (
      waiter_key TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  const orderColumns = await all('PRAGMA table_info(orders)');
  if (!orderColumns.some((column) => column.name === 'waiter_name')) {
    await run("ALTER TABLE orders ADD COLUMN waiter_name TEXT NOT NULL DEFAULT ''");
  }
  if (!orderColumns.some((column) => column.name === 'paid_amount')) {
    await run('ALTER TABLE orders ADD COLUMN paid_amount REAL NOT NULL DEFAULT 0');
  }
  if (!orderColumns.some((column) => column.name === 'kitchen_status')) {
    await run("ALTER TABLE orders ADD COLUMN kitchen_status TEXT NOT NULL DEFAULT 'pendiente'");
  }
  if (!orderColumns.some((column) => column.name === 'kitchen_started_at')) {
    await run('ALTER TABLE orders ADD COLUMN kitchen_started_at TEXT');
  }
  if (!orderColumns.some((column) => column.name === 'kitchen_finished_at')) {
    await run('ALTER TABLE orders ADD COLUMN kitchen_finished_at TEXT');
  }
  if (!orderColumns.some((column) => column.name === 'edit_summary_json')) {
    await run("ALTER TABLE orders ADD COLUMN edit_summary_json TEXT NOT NULL DEFAULT '[]'");
  }
  if (!orderColumns.some((column) => column.name === 'comments_json')) {
    await run("ALTER TABLE orders ADD COLUMN comments_json TEXT NOT NULL DEFAULT '[]'");
  }
  if (!orderColumns.some((column) => column.name === 'expenses_json')) {
    await run("ALTER TABLE orders ADD COLUMN expenses_json TEXT NOT NULL DEFAULT '[]'");
  }
  if (!orderColumns.some((column) => column.name === 'edited_at')) {
    await run('ALTER TABLE orders ADD COLUMN edited_at TEXT');
  }

  const itemColumns = await all('PRAGMA table_info(order_items)');
  if (!itemColumns.some((column) => column.name === 'category')) {
    await run("ALTER TABLE order_items ADD COLUMN category TEXT NOT NULL DEFAULT 'Sin categoria'");
  }
  if (!itemColumns.some((column) => column.name === 'weight_grams')) {
    await run('ALTER TABLE order_items ADD COLUMN weight_grams REAL');
  }
  if (!itemColumns.some((column) => column.name === 'pricing_mode')) {
    await run("ALTER TABLE order_items ADD COLUMN pricing_mode TEXT NOT NULL DEFAULT 'fixed'");
  }

  const menuColumns = await all('PRAGMA table_info(menu_items)');
  if (!menuColumns.some((column) => column.name === 'pricing_mode')) {
    await run("ALTER TABLE menu_items ADD COLUMN pricing_mode TEXT NOT NULL DEFAULT 'fixed'");
  }
  if (!menuColumns.some((column) => column.name === 'weight_formula')) {
    await run("ALTER TABLE menu_items ADD COLUMN weight_formula TEXT");
  }

  const orderItemColumnsAfterMenu = await all('PRAGMA table_info(order_items)');
  if (!orderItemColumnsAfterMenu.some((column) => column.name === 'weight_formula')) {
    await run('ALTER TABLE order_items ADD COLUMN weight_formula TEXT');
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

  await run(`
    UPDATE orders
    SET kitchen_status = 'pendiente'
    WHERE kitchen_status IS NULL OR kitchen_status = ''
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
        'INSERT INTO menu_items(id, name, category, price, pricing_mode, weight_formula, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [item.id, item.name, item.category, item.price, item.pricingMode ?? 'fixed', item.weightFormula ?? null, index]
      );
    }

    await run(
      `INSERT INTO settings(key, value) VALUES(?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      ['menuVersion', DEFAULT_MENU_VERSION]
    );
  }

  await repairMispricedOpenOrders();
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

export async function listWaiters() {
  return all(
    `SELECT waiter_key AS waiterKey, display_name AS displayName, active, created_at AS createdAt, updated_at AS updatedAt
     FROM waiters
     ORDER BY active DESC, display_name ASC`
  );
}

export async function getWaiterByName(name) {
  const waiterKey = normalizeWaiterName(name);
  if (!waiterKey) return null;

  return get(
    `SELECT waiter_key AS waiterKey, display_name AS displayName, active, created_at AS createdAt, updated_at AS updatedAt
     FROM waiters
     WHERE waiter_key = ?`,
    [waiterKey]
  );
}

export async function isWaiterAuthorized(name) {
  const waiter = await getWaiterByName(name);
  return Boolean(waiter && Number(waiter.active) === 1);
}

export async function upsertWaiter(name, active = 1) {
  const displayName = formatWaiterName(name);
  const waiterKey = normalizeWaiterName(displayName);
  if (!waiterKey) return null;

  const now = new Date().toISOString();
  await run(
    `INSERT INTO waiters(waiter_key, display_name, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(waiter_key) DO UPDATE SET
       display_name = excluded.display_name,
       active = excluded.active,
       updated_at = excluded.updated_at`,
    [waiterKey, displayName, active ? 1 : 0, now, now]
  );

  return getWaiterByName(displayName);
}

export async function setWaiterActive(name, active) {
  const displayName = formatWaiterName(name);
  const waiterKey = normalizeWaiterName(displayName);
  if (!waiterKey) return null;

  const now = new Date().toISOString();
  const existing = await getWaiterByName(displayName);
  if (!existing) return null;

  await run(
    `UPDATE waiters
     SET active = ?, updated_at = ?
     WHERE waiter_key = ?`,
    [active ? 1 : 0, now, waiterKey]
  );

  return getWaiterByName(displayName);
}

export async function getMenu() {
  return all(
    'SELECT id, name, category, price, pricing_mode AS pricingMode, weight_formula AS weightFormula FROM menu_items ORDER BY sort_order ASC'
  );
}

export async function createOrder(order) {
  const expenses = normalizeOrderExpenses(order.expenses);
  await run(
    `INSERT INTO orders(id, client_name, table_number, waiter_name, status, kitchen_status, kitchen_started_at, kitchen_finished_at, payment_method, total, paid_amount, created_at, paid_at, edit_summary_json, comments_json, expenses_json, edited_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)` ,
    [
      order.id,
      order.clientName,
      order.tableNumber,
      order.waiterName,
      order.status,
      order.kitchenStatus ?? 'pendiente',
      order.kitchenStartedAt ?? null,
      order.kitchenFinishedAt ?? null,
      order.paymentMethod,
      roundMoney(order.total),
      0,
      order.createdAt,
      order.paidAt,
      JSON.stringify(order.editSummary ?? []),
      JSON.stringify(order.comments ?? []),
      JSON.stringify(expenses),
      order.editedAt ?? null
    ]
  );

  for (const item of order.items) {
    await run(
      `INSERT INTO order_items(order_id, menu_item_id, name, category, quantity, unit_price, subtotal, weight_grams, pricing_mode, weight_formula)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        order.id,
        item.menuItemId,
        item.name,
        item.category,
        item.quantity,
        roundMoney(item.unitPrice),
        roundMoney(item.subtotal),
        item.weightGrams ?? null,
        item.pricingMode ?? 'fixed',
        item.weightFormula ?? null
      ]
    );
  }
}

export async function updateOrderWithItems(orderId, order) {
  const currentOrder = await getOrderById(orderId);
  if (!currentOrder) return null;

  const nextExpenses = Array.isArray(order.expenses)
    ? normalizeOrderExpenses(order.expenses)
    : normalizeOrderExpenses(currentOrder.expenses);
  const itemsTotal = roundMoney((Array.isArray(order.items) ? order.items : []).reduce((acc, item) => acc + Number(item.subtotal ?? 0), 0));
  const normalizedTotal = roundMoney(itemsTotal + calculateExpensesTotal(nextExpenses));
  const paidAmount = roundMoney(currentOrder.paidAmount ?? 0);

  if (currentOrder.status === 'paid') {
    const error = new Error('La cuenta ya esta pagada y no se puede modificar.');
    error.code = 'ORDER_LOCKED';
    throw error;
  }

  if (paidAmount > normalizedTotal) {
    const error = new Error('El nuevo total no puede ser menor que lo ya abonado.');
    error.code = 'PAID_AMOUNT_EXCEEDS_TOTAL';
    throw error;
  }

  const nextStatus = paidAmount > 0
    ? (paidAmount >= normalizedTotal ? 'paid' : 'partial')
    : 'pending';
  const editSummary = buildEditSummary(currentOrder.items, order.items);
  const commentText = typeof order.comment === 'string' ? order.comment.trim() : '';
  const comments = Array.isArray(currentOrder.comments) ? [...currentOrder.comments] : [];
  if (commentText) {
    comments.push({
      text: commentText,
      createdAt: new Date().toISOString(),
      author: order.waiterName,
      kind: 'edit'
    });
  }

  const metadataChanged =
    order.clientName !== currentOrder.clientName ||
    order.tableNumber !== currentOrder.tableNumber ||
    order.waiterName !== currentOrder.waiterName ||
    Array.isArray(order.expenses);
  const editedAt = editSummary.length > 0 || commentText || metadataChanged
    ? new Date().toISOString()
    : currentOrder.editedAt ?? null;

  await run('BEGIN TRANSACTION');

  try {
    await run(
      `UPDATE orders
       SET client_name = ?, table_number = ?, waiter_name = ?, total = ?, status = ?, edit_summary_json = ?, comments_json = ?, edited_at = ?
       WHERE id = ?`,
      [
        order.clientName,
        order.tableNumber,
        order.waiterName,
        normalizedTotal,
        nextStatus,
        JSON.stringify(editSummary),
        JSON.stringify(comments),
        editedAt,
        orderId
      ]
    );

    await run('DELETE FROM order_items WHERE order_id = ?', [orderId]);

    for (const item of order.items) {
      await run(
        `INSERT INTO order_items(order_id, menu_item_id, name, category, quantity, unit_price, subtotal, weight_grams, pricing_mode, weight_formula)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          orderId,
          item.menuItemId,
          item.name,
          item.category,
          item.quantity,
          roundMoney(item.unitPrice),
          roundMoney(item.subtotal),
          item.weightGrams ?? null,
          item.pricingMode ?? 'fixed',
          item.weightFormula ?? null
        ]
      );
    }

    await run(
      `UPDATE orders
       SET expenses_json = ?
       WHERE id = ?`,
      [JSON.stringify(nextExpenses), orderId]
    );

    await run('COMMIT');
  } catch (error) {
    await run('ROLLBACK');
    throw error;
  }

  return getOrderById(orderId);
}

export async function updateOrderKitchenStatus(orderId, kitchenStatus) {
  const currentOrder = await getOrderById(orderId);
  if (!currentOrder) return null;

  const allowedStatuses = new Set(['pendiente', 'en_preparacion', 'completado']);
  if (!allowedStatuses.has(kitchenStatus)) {
    const error = new Error('Estado de cocina invalido.');
    error.code = 'INVALID_KITCHEN_STATUS';
    throw error;
  }

  const now = new Date().toISOString();
  const nextStartedAt = kitchenStatus === 'en_preparacion'
    ? (currentOrder.kitchenStartedAt ?? now)
    : currentOrder.kitchenStartedAt ?? null;
  const nextFinishedAt = kitchenStatus === 'completado'
    ? now
    : (kitchenStatus === 'pendiente' ? null : currentOrder.kitchenFinishedAt ?? null);

  await run(
    `UPDATE orders
     SET kitchen_status = ?, kitchen_started_at = ?, kitchen_finished_at = ?
     WHERE id = ?`,
    [kitchenStatus, nextStartedAt, nextFinishedAt, orderId]
  );

  return getOrderById(orderId);
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
    'SELECT menu_item_id AS menuItemId, name, category, quantity, unit_price AS unitPrice, subtotal, weight_grams AS weightGrams, pricing_mode AS pricingMode, weight_formula AS weightFormula FROM order_items WHERE order_id = ? ORDER BY id ASC',
    [orderId]
  );
}

async function repairMispricedOpenOrders() {
  const migrationKey = '2026-05-16-fix-null-unit-price';
  const doneRow = await get('SELECT value FROM settings WHERE key = ?', [migrationKey]);
  if (doneRow?.value === 'done') return;

  const menu = await getMenu();
  const orders = await all(`
    SELECT id, paid_amount AS paidAmount, expenses_json AS expensesJson
    FROM orders
    WHERE status IN ('pending', 'partial')
  `);

  for (const order of orders) {
    const rawItems = await listOrderItems(order.id);
    if (!rawItems.length) continue;

    const normalizedItems = rawItems.map((item) => ({
      menuItemId: item.menuItemId,
      quantity: item.quantity,
      weightGrams: item.weightGrams,
      pricingMode: item.pricingMode
    }));

    const summarizedItems = summarizeItems(normalizedItems, menu);
    const expenses = normalizeOrderExpenses(parseJsonArray(order.expensesJson));
    const total = roundMoney(
      summarizedItems.reduce((acc, item) => acc + Number(item.subtotal ?? 0), 0) + calculateExpensesTotal(expenses)
    );
    const paidAmount = roundMoney(order.paidAmount ?? 0);

    if (paidAmount > total) continue;

    await run('DELETE FROM order_items WHERE order_id = ?', [order.id]);

    for (const item of summarizedItems) {
      await run(
        `INSERT INTO order_items(order_id, menu_item_id, name, category, quantity, unit_price, subtotal, weight_grams, pricing_mode, weight_formula)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          order.id,
          item.menuItemId,
          item.name,
          item.category,
          item.quantity,
          roundMoney(item.unitPrice),
          roundMoney(item.subtotal),
          item.weightGrams ?? null,
          item.pricingMode ?? 'fixed',
          item.weightFormula ?? null
        ]
      );
    }

    await run('UPDATE orders SET total = ? WHERE id = ?', [roundMoney(total), order.id]);
  }

  await run(
    `INSERT INTO settings(key, value) VALUES(?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [migrationKey, 'done']
  );
}

async function listOrderPayments(orderId) {
  return all(
    'SELECT id, payment_method AS paymentMethod, amount, tendered_amount AS tenderedAmount, change_given AS changeGiven, transfer_number AS transferenceNumber, created_at AS createdAt FROM order_payments WHERE order_id = ? ORDER BY id ASC',
    [orderId]
  );
}

export async function exportAllData() {
  const orders = await all('SELECT * FROM orders ORDER BY created_at ASC');
  const orderItems = await all('SELECT * FROM order_items ORDER BY id ASC');
  const payments = await all('SELECT * FROM order_payments ORDER BY id ASC');
  const menu = await all('SELECT * FROM menu_items ORDER BY sort_order ASC');
  const settings = await all('SELECT key, value FROM settings');
  const waiters = await all('SELECT * FROM waiters ORDER BY created_at ASC');

  return { orders, orderItems, payments, menu, settings, waiters };
}

export async function restoreData(payload) {
  // payload should be { orders, orderItems, payments, menu, settings, waiters }
  await run('BEGIN TRANSACTION');
  try {
    // Clear existing tables (keep schema)
    await run('DELETE FROM order_payments');
    await run('DELETE FROM order_items');
    await run('DELETE FROM orders');
    await run('DELETE FROM menu_items');
    await run('DELETE FROM settings');
    await run('DELETE FROM waiters');

    if (Array.isArray(payload.menu)) {
      for (const item of payload.menu) {
        await run(
          'INSERT INTO menu_items(id, name, category, price, pricing_mode, weight_formula, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [
            item.id,
            item.name,
            item.category,
            item.price,
            item.pricing_mode ?? item.pricingMode ?? 'fixed',
            item.weight_formula ?? item.weightFormula ?? null,
            item.sort_order ?? 0
          ]
        );
      }
    }

    if (Array.isArray(payload.settings)) {
      for (const s of payload.settings) {
        await run('INSERT INTO settings(key, value) VALUES (?, ?)', [s.key, s.value]);
      }
    }

    if (Array.isArray(payload.waiters)) {
      for (const w of payload.waiters) {
        await run('INSERT INTO waiters(waiter_key, display_name, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
          [w.waiter_key, w.display_name, w.active ?? 1, w.created_at ?? new Date().toISOString(), w.updated_at ?? new Date().toISOString()]);
      }
    }

    if (Array.isArray(payload.orders)) {
      for (const o of payload.orders) {
        await run(
          `INSERT INTO orders(id, client_name, table_number, waiter_name, status, payment_method, total, paid_amount, created_at, paid_at, edit_summary_json, comments_json, expenses_json, edited_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            o.id,
            o.client_name ?? o.clientName,
            o.table_number ?? o.tableNumber,
            o.waiter_name ?? o.waiterName ?? '',
            o.status ?? 'pending',
            o.payment_method ?? o.paymentMethod ?? null,
            o.total ?? 0,
            o.paid_amount ?? o.paidAmount ?? 0,
            o.created_at ?? o.createdAt ?? new Date().toISOString(),
            o.paid_at ?? o.paidAt ?? null,
            o.edit_summary_json ?? o.editSummaryJson ?? '[]',
            o.comments_json ?? o.commentsJson ?? '[]',
            o.expenses_json ?? o.expensesJson ?? '[]',
            o.edited_at ?? o.editedAt ?? null
          ]
        );
      }
    }

    if (Array.isArray(payload.orderItems)) {
      for (const it of payload.orderItems) {
        await run(
          `INSERT INTO order_items(order_id, menu_item_id, name, category, quantity, unit_price, subtotal, weight_grams, pricing_mode, weight_formula)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [it.order_id, it.menu_item_id, it.name, it.category ?? 'Sin categoria', it.quantity ?? 1, it.unit_price ?? it.unitPrice ?? 0, it.subtotal ?? 0, it.weight_grams ?? it.weightGrams ?? null, it.pricing_mode ?? it.pricingMode ?? 'fixed', it.weight_formula ?? it.weightFormula ?? null]
        );
      }
    }

    if (Array.isArray(payload.payments)) {
      for (const p of payload.payments) {
        await run(
          `INSERT INTO order_payments(order_id, payment_method, amount, tendered_amount, change_given, transfer_number, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [p.order_id, p.payment_method ?? p.paymentMethod, p.amount ?? 0, p.tendered_amount ?? p.tenderedAmount ?? 0, p.change_given ?? p.changeGiven ?? 0, p.transfer_number ?? p.transferenceNumber ?? null, p.created_at ?? p.createdAt ?? new Date().toISOString()]
        );
      }
    }

    await run('COMMIT');
  } catch (err) {
    await run('ROLLBACK');
    throw err;
  }
}

export async function deleteOrdersOlderThan(dateISO) {
  await run('BEGIN TRANSACTION');
  try {
    await run(
      `DELETE FROM order_payments WHERE order_id IN (SELECT id FROM orders WHERE created_at < ?)`,
      [dateISO]
    );

    await run(
      `DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE created_at < ?)`,
      [dateISO]
    );

    await run(
      `DELETE FROM orders WHERE created_at < ?`,
      [dateISO]
    );

    await run('COMMIT');
  } catch (err) {
    await run('ROLLBACK');
    throw err;
  }
}

export async function deleteAllOrders() {
  await run('BEGIN TRANSACTION');
  try {
    await run('DELETE FROM order_payments');
    await run('DELETE FROM order_items');
    await run('DELETE FROM orders');
    await run('COMMIT');
  } catch (err) {
    await run('ROLLBACK');
    throw err;
  }
}

export async function vacuumDatabase() {
  await run('VACUUM');
}
