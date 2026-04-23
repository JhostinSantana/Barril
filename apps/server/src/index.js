import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { Server } from 'socket.io';
import { nanoid } from 'nanoid';
import {
  createOrder,
  getMenu,
  getOrderById,
  getRestaurantName,
  getSetting,
  initializeDatabase,
  listOrders,
  listOrdersByDate,
  setSetting,
  updateOrderPayment
} from './database.js';
import { printKitchenTicket } from './printer.js';
import { calculateOrderTotal, getCashClose, getStats, summarizeItems } from './utils.js';

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

app.post('/api/orders', async (req, res, next) => {
  try {
    const { clientName, tableNumber, waiterName, items } = req.body;

    if (!clientName || !tableNumber || !waiterName || !Array.isArray(items) || items.length === 0) {
      res.status(400).json({ message: 'Debe enviar nombre del cliente, mesa, mesero y al menos un producto.' });
      return;
    }

    const menu = await getMenu();
    const normalizedItems = items.map((item) => ({
      menuItemId: item.menuItemId,
      quantity: Number(item.quantity) || 1
    }));

    const total = calculateOrderTotal(normalizedItems, menu);
    const order = {
      id: `COM-${nanoid(6).toUpperCase()}`,
      clientName,
      tableNumber,
      waiterName,
      status: 'pending',
      paymentMethod: null,
      total,
      createdAt: new Date().toISOString(),
      paidAt: null,
      items: summarizeItems(normalizedItems, menu)
    };

    await createOrder(order);
    io.emit('order:new', order);
    res.status(201).json({ ...order, printer: { printed: false, reason: 'awaiting-laptop-auto-print' } });
  } catch (error) {
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
    const { paymentMethod } = req.body;

    if (!['efectivo', 'transferencia'].includes(paymentMethod)) {
      res.status(400).json({ message: 'Metodo de pago invalido.' });
      return;
    }

    const order = await getOrderById(orderId);
    if (!order) {
      res.status(404).json({ message: 'Cuenta no encontrada.' });
      return;
    }

    const paidAt = new Date().toISOString();
    await updateOrderPayment(orderId, paymentMethod, paidAt);

    const updatedOrder = {
      ...order,
      status: 'paid',
      paymentMethod,
      paidAt
    };

    io.emit('order:paid', updatedOrder);
    res.json(updatedOrder);
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

app.get('/api/cash-close', async (req, res, next) => {
  try {
    const orders = await listOrders({ status: 'paid' });
    const date = req.query.date?.toString() ?? new Date().toISOString().slice(0, 10);
    res.json(getCashClose(orders, date));
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

httpServer.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Server running on http://localhost:${PORT}`);
});
