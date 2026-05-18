import cors from 'cors';
import express from 'express';
import { nanoid } from 'nanoid';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { Server } from 'socket.io';
import {
    addOrderPayment,
    createOrder,
    deleteAllOrders,
    deleteOrderById,
    deleteOrdersOlderThan,
    exportAllData,
    getMenu,
    getOrderById,
    getRestaurantName,
    getSetting,
    getWaiterByName,
    initializeDatabase,
    listOrders,
    listOrdersByDate,
    listWaiters,
    restoreData,
    setSetting,
    setWaiterActive,
    updateOrderKitchenStatus,
    updateOrderWithItems,
    upsertWaiter,
    vacuumDatabase
} from './database.js';
import { printKitchenTicket } from './printer.js';
import {
    calculateOrderTotal,
    detectDuplicateOrders,
    getCashClose,
    getStats,
    getStatsSummary,
    normalizeOrderExpenses,
    preserveWeightFromCurrentOrder,
    summarizeItems
} from './utils.js';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*'
  }
});

app.use(cors());
app.use(express.json());

app.get('/health', (_, res) => {
  res.json({ ok: true, service: 'asados-en-el-barril-server' });
});

app.get('/api/menu', async (_, res, next) => {
  try {
    const [restaurantName, menu] = await Promise.all([getRestaurantName(), getMenu()]);
    res.json({ restaurantName, menu });
  } catch (error) {
    next(error);
  }
});

function resolveLocalIp() {
  const interfaces = networkInterfaces();
  for (const values of Object.values(interfaces)) {
    if (!values) continue;
    for (const detail of values) {
      if (detail.family === 'IPv4' && !detail.internal) {
        return detail.address;
      }
    }
  }
  return '127.0.0.1';
}

app.get('/api/network-info', async (_, res, next) => {
  try {
    const localIp = resolveLocalIp();
    const publicApiUrl = (await getSetting('publicApiUrl')) ?? '';
    res.json({
      localIp,
      localApiUrl: `http://${localIp}:4000`,
      publicApiUrl
    });
  } catch (error) {
    next(error);
  }
});

app.patch('/api/network-info/public-url', async (req, res, next) => {
  try {
    const raw = req.body?.publicApiUrl;
    const publicApiUrl = typeof raw === 'string' ? raw.trim() : '';

    if (publicApiUrl && !/^https:\/\//i.test(publicApiUrl)) {
      res.status(400).json({ message: 'La URL publica debe iniciar con https://.' });
      return;
    }

    await setSetting('publicApiUrl', publicApiUrl);
    res.json({ ok: true, publicApiUrl });
  } catch (error) {
    next(error);
  }
});

app.patch('/api/settings/restaurant-name', async (req, res, next) => {
  try {
    const restaurantName = (req.body?.restaurantName ?? '').toString().trim();

    if (!restaurantName) {
      res.status(400).json({ message: 'El nombre del restaurante no puede estar vacio.' });
      return;
    }

    await setSetting('restaurantName', restaurantName);
    res.json({ ok: true, restaurantName });
  } catch (error) {
    next(error);
  }
});

app.get('/api/orders', async (req, res, next) => {
  try {
    const status = req.query.status?.toString();
    const query = req.query.query?.toString();
    res.json(await listOrders({ status, query }));
  } catch (error) {
    next(error);
  }
});

app.get('/api/orders/history', async (req, res, next) => {
  try {
    const date = req.query.date?.toString();
    if (!date) {
      res.status(400).json({ message: 'La fecha es requerida en formato YYYY-MM-DD.' });
      return;
    }

    res.json(await listOrdersByDate(date));
  } catch (error) {
    next(error);
  }
});

app.get('/api/waiters', async (_, res, next) => {
  try {
    res.json(await listWaiters());
  } catch (error) {
    next(error);
  }
});

app.get('/api/waiters/validate', async (req, res, next) => {
  try {
    const name = req.query.name?.toString() ?? '';
    const waiter = await getWaiterByName(name);
    res.json({
      authorized: Boolean(waiter && Number(waiter.active) === 1),
      waiter
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/waiters', async (req, res, next) => {
  try {
    const name = req.body?.name?.toString() ?? '';
    if (!name.trim()) {
      res.status(400).json({ message: 'El nombre del mesero es requerido.' });
      return;
    }

    const waiter = await upsertWaiter(name, 1);
    if (!waiter) {
      res.status(400).json({ message: 'No se pudo registrar el mesero.' });
      return;
    }

    res.status(201).json(waiter);
  } catch (error) {
    next(error);
  }
});

app.patch('/api/waiters/:waiterName', async (req, res, next) => {
  try {
    const waiterName = req.params.waiterName?.toString() ?? '';
    const active = Boolean(req.body?.active);
    const waiter = await setWaiterActive(waiterName, active);

    if (!waiter) {
      res.status(404).json({ message: 'Mesero no encontrado.' });
      return;
    }

    res.json(waiter);
  } catch (error) {
    next(error);
  }
});

app.post('/api/orders', async (req, res, next) => {
  try {
    const { clientName, tableNumber, waiterName, items } = req.body;
    const comment = (req.body?.comment ?? '').toString().trim();
    const expenses = normalizeOrderExpenses(req.body?.expenses);

    if (!clientName || !tableNumber || !waiterName || !Array.isArray(items) || items.length === 0) {
      res.status(400).json({ message: 'Debe enviar nombre del cliente, mesa, mesero y al menos un producto.' });
      return;
    }

    const waiter = await getWaiterByName(waiterName);
    if (!waiter || Number(waiter.active) !== 1) {
      res.status(403).json({ message: 'Mesero no autorizado. Solicite activacion en la laptop.' });
      return;
    }

    const menu = await getMenu();
    const normalizedItems = items.map((item) => ({
      menuItemId: item.menuItemId,
      quantity: Number(item.quantity) || 1,
      weightGrams: item.weightGrams != null ? Number(item.weightGrams) : null,
      unitPrice: item.unitPrice != null ? Number(item.unitPrice) : null,
      subtotal: item.subtotal != null ? Number(item.subtotal) : null,
      pricingMode: item.pricingMode ?? null
    }));

    const summarizedItems = summarizeItems(normalizedItems, menu);
    const total = calculateOrderTotal(summarizedItems, menu, expenses);
    const order = {
      id: `COM-${nanoid(6).toUpperCase()}`,
      clientName,
      tableNumber,
      waiterName,
      status: 'pending',
      kitchenStatus: 'pendiente',
      paymentMethod: null,
      total,
      createdAt: new Date().toISOString(),
      paidAt: null,
      items: summarizedItems,
      expenses,
      comments: comment
        ? [{ text: comment, createdAt: new Date().toISOString(), author: waiterName, kind: 'initial' }]
        : []
    };

    await createOrder(order);
    io.emit('order:new', order);
    res.status(201).json({ ...order, printer: { printed: false, reason: 'awaiting-laptop-auto-print' } });
  } catch (error) {
    next(error);
  }
});

app.patch('/api/orders/:orderId', async (req, res, next) => {
  try {
    const { orderId } = req.params;

        // Validar que el orderId tiene formato válido (prevención de duplicados)
        if (!orderId || typeof orderId !== 'string' || !orderId.startsWith('COM-')) {
          res.status(400).json({ message: 'ID de orden inválido.' });
          return;
        }
    const { clientName, tableNumber, waiterName, items } = req.body;
    const comment = (req.body?.comment ?? '').toString().trim();
    const expenses = req.body?.expenses !== undefined ? normalizeOrderExpenses(req.body?.expenses) : undefined;

    if (!clientName || !tableNumber || !waiterName || !Array.isArray(items) || items.length === 0) {
      res.status(400).json({ message: 'Debe enviar nombre del cliente, mesa, mesero y al menos un producto.' });
      return;
    }

    const waiter = await getWaiterByName(waiterName);
    if (!waiter || Number(waiter.active) !== 1) {
      res.status(403).json({ message: 'Mesero no autorizado. Solicite activacion en la laptop.' });
      return;
    }

    const currentOrder = await getOrderById(orderId);
    if (!currentOrder) {
      res.status(404).json({ message: 'Cuenta no encontrada.' });
      return;
    }

    if (currentOrder.status === 'paid') {
      res.status(409).json({ message: 'La cuenta ya esta pagada y no se puede modificar.' });
      return;
    }

    const menu = await getMenu();
    const normalizedItems = items.map((item) => ({
      menuItemId: item.menuItemId,
      quantity: Number(item.quantity) || 1,
      weightGrams: item.weightGrams != null ? Number(item.weightGrams) : null,
      unitPrice: item.unitPrice != null ? Number(item.unitPrice) : null,
      subtotal: item.subtotal != null ? Number(item.subtotal) : null,
      pricingMode: item.pricingMode ?? null
    }));

    const mergedItems = preserveWeightFromCurrentOrder(normalizedItems, currentOrder.items);
    const summarizedItems = summarizeItems(mergedItems, menu);
    const total = calculateOrderTotal(summarizedItems, menu, expenses ?? currentOrder.expenses ?? []);
    const updatedOrder = await updateOrderWithItems(orderId, {
      clientName,
      tableNumber,
      waiterName,
      total,
      items: summarizedItems,
      expenses,
      comment
    });

    io.emit('order:updated', updatedOrder);
    if (updatedOrder.status === 'paid') {
      io.emit('order:paid', updatedOrder);
    }
    res.json(updatedOrder);
  } catch (error) {
    if (error?.code === 'ORDER_LOCKED') {
      res.status(409).json({ message: error.message });
      return;
    }

    if (error?.code === 'PAID_AMOUNT_EXCEEDS_TOTAL') {
      res.status(409).json({ message: error.message });
      return;
    }

    next(error);
  }
});

app.patch('/api/orders/:orderId/kitchen-status', async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const kitchenStatus = req.body?.kitchenStatus?.toString() ?? '';

    if (!['pendiente', 'en_preparacion', 'completado'].includes(kitchenStatus)) {
      res.status(400).json({ message: 'Estado de cocina invalido.' });
      return;
    }

    const currentOrder = await getOrderById(orderId);
    if (!currentOrder) {
      res.status(404).json({ message: 'Cuenta no encontrada.' });
      return;
    }

    if (currentOrder.status === 'paid') {
      res.status(409).json({ message: 'La cuenta ya esta pagada y no se puede mover en cocina.' });
      return;
    }

    const updatedOrder = await updateOrderKitchenStatus(orderId, kitchenStatus);
    io.emit('order:kitchen-updated', updatedOrder);
    io.emit('order:updated', updatedOrder);
    res.json(updatedOrder);
  } catch (error) {
    if (error?.code === 'INVALID_KITCHEN_STATUS') {
      res.status(400).json({ message: error.message });
      return;
    }

    next(error);
  }
});

app.post('/api/orders/:orderId/print', async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const order = await getOrderById(orderId);
    if (!order) {
      res.status(404).json({ message: 'Cuenta no encontrada.' });
      return;
    }

    const restaurantName = await getRestaurantName();
    const printer = await printKitchenTicket(order, restaurantName);
    res.json(printer);
  } catch (error) {
    next(error);
  }
});

app.patch('/api/orders/:orderId/pay', async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const { paymentMethod, amount, tenderedAmount, transferenceNumber } = req.body;

    if (!['efectivo', 'transferencia'].includes(paymentMethod)) {
      res.status(400).json({ message: 'Metodo de pago invalido.' });
      return;
    }

    const order = await getOrderById(orderId);
    if (!order) {
      res.status(404).json({ message: 'Cuenta no encontrada.' });
      return;
    }

    if (order.balanceDue <= 0) {
      res.status(400).json({ message: 'La cuenta ya esta completamente pagada.' });
      return;
    }

    const requestedAmount = amount != null ? Number(amount) : order.balanceDue;
    const normalizedAmount = Math.round((requestedAmount + Number.EPSILON) * 100) / 100;
    const maxAmount = Math.round((order.balanceDue + Number.EPSILON) * 100) / 100;

    if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
      res.status(400).json({ message: 'El monto del abono debe ser mayor a cero.' });
      return;
    }

    if (normalizedAmount > maxAmount) {
      res.status(400).json({ message: 'El abono no puede superar el saldo pendiente.' });
      return;
    }

    const normalizedTendered = paymentMethod === 'efectivo'
      ? Math.round(((Number(tenderedAmount ?? normalizedAmount)) + Number.EPSILON) * 100) / 100
      : normalizedAmount;

    if (!Number.isFinite(normalizedTendered) || normalizedTendered < normalizedAmount) {
      res.status(400).json({ message: 'En efectivo, el valor recibido no puede ser menor al abono.' });
      return;
    }

    const changeGiven = paymentMethod === 'efectivo'
      ? Math.round((Math.max(normalizedTendered - normalizedAmount, 0) + Number.EPSILON) * 100) / 100
      : 0;

    const paidAt = new Date().toISOString();
    const updatedOrder = await addOrderPayment(
      orderId,
      paymentMethod,
      normalizedAmount,
      normalizedTendered,
      changeGiven,
      paidAt,
      transferenceNumber
    );

    io.emit('order:updated', updatedOrder);
    if (updatedOrder.status === 'paid') {
      io.emit('order:paid', updatedOrder);
    }

    res.json(updatedOrder);
  } catch (error) {
    next(error);
  }
});

app.delete('/api/orders/:orderId', async (req, res, next) => {
  try {
    const { orderId } = req.params;

    if (!orderId || typeof orderId !== 'string' || !orderId.startsWith('COM-')) {
      res.status(400).json({ message: 'ID de orden invalido.' });
      return;
    }

    const order = await getOrderById(orderId);
    if (!order) {
      res.status(404).json({ message: 'Cuenta no encontrada.' });
      return;
    }

    if (order.status === 'paid') {
      res.status(409).json({ message: 'La cuenta ya esta pagada y no se puede eliminar.' });
      return;
    }

    const removed = await deleteOrderById(orderId);
    if (!removed) {
      res.status(404).json({ message: 'Cuenta no encontrada.' });
      return;
    }

    io.emit('order:updated', { id: orderId, deleted: true });
    res.json({ ok: true, orderId });
  } catch (error) {
    next(error);
  }
});

app.get('/api/stats', async (req, res, next) => {
  try {
    const menu = await getMenu();
    const orders = await listOrders();
    const from = req.query.from?.toString() ?? `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`;
    const to = req.query.to?.toString() ?? `${new Date().toISOString().slice(0, 10)}T23:59:59.999Z`;
    res.json(getStats(orders, menu, from, to));
  } catch (error) {
    next(error);
  }
});

app.get('/api/stats-summary', async (req, res, next) => {
  try {
    const menu = await getMenu();
    const orders = await listOrders();
    res.json(getStatsSummary(orders, menu));
  } catch (error) {
    next(error);
  }
});

app.get('/api/diagnostics/duplicates', async (req, res, next) => {
  try {
    const orders = await listOrders();
    const duplicates = detectDuplicateOrders(orders);
    res.json({ 
      totalOrders: orders.length, 
      duplicatesFound: duplicates.length,
      duplicates 
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/cash-close', async (req, res, next) => {
  try {
    const orders = await listOrders({ status: 'paid' });
    const date = req.query.date?.toString() ?? new Date().toISOString().slice(0, 10);
    res.json(getCashClose(orders, date));
  } catch (error) {
    next(error);
  }
});

app.get('/api/backup/json', async (_, res, next) => {
  try {
    const data = await exportAllData();
    res.json(data);
  } catch (error) {
    next(error);
  }
});

app.post('/api/restore/json', async (req, res, next) => {
  try {
    const payload = req.body;
    if (!payload) {
      res.status(400).json({ message: 'Payload JSON requerido.' });
      return;
    }

    await restoreData(payload);
    io.emit('data:restored');
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post('/api/db/vacuum', async (_, res, next) => {
  try {
    await vacuumDatabase();
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post('/api/cleanup', async (req, res, next) => {
  try {
    const before = req.body?.before;
    if (!before) {
      res.status(400).json({ message: 'Debe indicar fecha antes de YYYY-MM-DD.' });
      return;
    }

    await deleteOrdersOlderThan(`${before}T00:00:00.000Z`);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post('/api/cleanup/all', async (req, res, next) => {
  try {
    await deleteAllOrders();
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.use((error, _, res, __) => {
  // eslint-disable-next-line no-console
  console.error(error);
  res.status(500).json({ message: 'Error interno del servidor.' });
});

io.on('connection', () => {
  // Connection intentionally kept simple for POS usage.
});

const PORT = process.env.PORT || 4000;

await initializeDatabase();

// Ensure backups directory exists and schedule periodic copies of the DB file.
const DATA_DIR = new URL('../data', import.meta.url).pathname.replace(/^\/?([A-Za-z]:)?/, '');
const BACKUPS_DIR = `${DATA_DIR.replace(/\\/g, '/')}/backups`;
try {
  // Create backups dir if missing
  // eslint-disable-next-line no-console
  if (!require('fs').existsSync(BACKUPS_DIR)) require('fs').mkdirSync(BACKUPS_DIR, { recursive: true });
} catch (e) {
  // ignore
}

function performPeriodicBackup() {
  try {
    const src = `${DATA_DIR.replace(/\\/g, '/')}/barril.sqlite`;
    const dest = `${BACKUPS_DIR.replace(/\\/g, '/')}/barril-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`;
    require('fs').copyFileSync(src, dest);
    // eslint-disable-next-line no-console
    console.log('Backup saved to', dest);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Backup failed', err);
  }
}

// Schedule backup every 15 minutes
setInterval(performPeriodicBackup, 15 * 60 * 1000);
// Also run one at startup
performPeriodicBackup();

httpServer.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Server running on http://localhost:${PORT}`);
});
