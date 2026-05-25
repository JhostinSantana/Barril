import cors from "cors";
import express from "express";
import { nanoid } from "nanoid";
import { spawn } from "node:child_process";
import fs from "node:fs";
import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";
import {
    addOrderPayment,
    createOrder,
    deleteAllOrders,
    deleteOrderById,
    deleteOrdersOlderThan,
    deleteWaiter,
    exportAllData,
    getMenu,
    getOrderById,
    getRestaurantName,
    getSetting,
    getWaiterByName,
    initializeDatabase,
    listOrders,
    listOrdersByDate,
    listOrdersForKitchen,
    listWaiters,
    markOrderDispatched,
    restoreData,
    setSetting,
    setWaiterActive,
    updateOrderKitchenStatus,
    updateOrderWithItems,
    upsertWaiter,
    vacuumDatabase,
} from "./database.js";
import { printKitchenTicket } from "./printer.js";
import {
    calculateOrderTotal,
    defaultTableForServiceType,
    detectDuplicateOrders,
    getCashClose,
    getDateKey,
    getStats,
    getStatsSummary,
    isPickupServiceType,
    normalizeOrderExpenses,
    normalizeServiceType,
    preserveWeightFromCurrentOrder,
    summarizeItems,
} from "./utils.js";

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
  },
});

const TUNNEL_TARGET_URL = "http://localhost:4000";
const TUNNEL_PUBLIC_URL_PATTERN = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;
let tunnelProcess = null;
let tunnelUrlWaiters = [];
const tunnelState = {
  status: "stopped",
  publicUrl: "",
  error: "",
  startedAt: null,
};

app.use(cors());
app.use(express.json());

function getTunnelStatus() {
  return {
    ...tunnelState,
    pid: tunnelProcess?.pid ?? null,
  };
}

function notifyTunnelWaiters(error = null) {
  const waiters = tunnelUrlWaiters;
  tunnelUrlWaiters = [];
  waiters.forEach(({ resolve, reject }) => {
    if (error) {
      reject(error);
      return;
    }
    resolve(getTunnelStatus());
  });
}

async function registerTunnelUrl(publicUrl) {
  tunnelState.status = "running";
  tunnelState.publicUrl = publicUrl;
  tunnelState.error = "";
  await setSetting("publicApiUrl", publicUrl);
  io.emit("tunnel:updated", getTunnelStatus());
  notifyTunnelWaiters();
}

function waitForTunnelUrl(timeoutMs = 60000) {
  if (tunnelState.publicUrl) {
    return Promise.resolve(getTunnelStatus());
  }

  return new Promise((resolve, reject) => {
    const waiter = {
      resolve: (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    };
    const timer = setTimeout(() => {
      tunnelUrlWaiters = tunnelUrlWaiters.filter((item) => item !== waiter);
      reject(new Error("No se pudo obtener la URL publica del tunel a tiempo."));
    }, timeoutMs);

    tunnelUrlWaiters.push(waiter);
  });
}

function processTunnelOutput(chunk) {
  const text = chunk.toString();
  const publicUrl = text.match(TUNNEL_PUBLIC_URL_PATTERN)?.[0];
  if (!publicUrl || publicUrl === tunnelState.publicUrl) return;

  registerTunnelUrl(publicUrl).catch((error) => {
    tunnelState.error = error.message;
    notifyTunnelWaiters(error);
  });
}

async function startTunnel() {
  if (tunnelProcess && tunnelState.status !== "stopped") {
    return waitForTunnelUrl();
  }

  tunnelState.status = "starting";
  tunnelState.publicUrl = "";
  tunnelState.error = "";
  tunnelState.startedAt = new Date().toISOString();

  tunnelProcess = spawn(
    "npx",
    ["--yes", "cloudflared", "tunnel", "--url", TUNNEL_TARGET_URL],
    {
      shell: true,
      windowsHide: true,
      env: process.env,
    },
  );

  tunnelProcess.stdout?.on("data", processTunnelOutput);
  tunnelProcess.stderr?.on("data", processTunnelOutput);
  tunnelProcess.on("error", (error) => {
    tunnelState.status = "error";
    tunnelState.error = error.message;
    tunnelProcess = null;
    io.emit("tunnel:updated", getTunnelStatus());
    notifyTunnelWaiters(error);
  });
  tunnelProcess.on("exit", (code) => {
    if (tunnelState.status !== "stopped") {
      tunnelState.status = code === 0 ? "stopped" : "error";
      tunnelState.error =
        code === 0 ? "" : `El tunel se cerro con codigo ${code ?? "desconocido"}.`;
    }
    tunnelProcess = null;
    io.emit("tunnel:updated", getTunnelStatus());
    if (!tunnelState.publicUrl && tunnelState.status === "error") {
      notifyTunnelWaiters(new Error(tunnelState.error));
    }
  });

  io.emit("tunnel:updated", getTunnelStatus());
  return waitForTunnelUrl();
}

function stopTunnelProcess() {
  if (!tunnelProcess?.pid) {
    tunnelState.status = "stopped";
    tunnelState.publicUrl = "";
    tunnelState.error = "";
    tunnelState.startedAt = null;
    return Promise.resolve(getTunnelStatus());
  }

  const pid = tunnelProcess.pid;
  tunnelState.status = "stopped";
  tunnelState.publicUrl = "";
  tunnelState.error = "";
  tunnelState.startedAt = null;

  return new Promise((resolve) => {
    if (process.platform === "win32") {
      const killer = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
        windowsHide: true,
      });
      killer.on("close", () => resolve(getTunnelStatus()));
      killer.on("error", () => resolve(getTunnelStatus()));
      return;
    }

    tunnelProcess.kill("SIGTERM");
    resolve(getTunnelStatus());
  });
}

async function buildDashboardSnapshot() {
  const [menu, orders, restaurantName, cashSession] = await Promise.all([
    getMenu(),
    listOrders(),
    getRestaurantName(),
    getSetting("cashSession"),
  ]);

  const todayKey = getDateKey(new Date().toISOString());
  const todayStart = `${todayKey}T00:00:00.000Z`;
  const todayEnd = `${todayKey}T23:59:59.999Z`;

  return {
    restaurantName,
    pendingOrders: orders.filter(
      (order) => order.status === "pending" || order.status === "partial",
    ),
    paidOrders: orders.filter((order) => order.status === "paid"),
    cashClose: getCashClose(orders, todayKey),
    dailyStats: getStats(orders, menu, todayStart, todayEnd),
    allTimeStats: getStats(
      orders,
      menu,
      "2000-01-01T00:00:00.000Z",
      "2100-01-01T00:00:00.000Z",
    ),
    statsSummary: getStatsSummary(orders, menu),
    cashSession: parseDashboardCashSession(cashSession),
  };
}

function parseDashboardCashSession(rawValue) {
  if (!rawValue) {
    return {
      openingCash: 0,
      openingConfirmed: false,
      closingReport: null,
      sessionKey: null,
    };
  }

  try {
    const parsed = JSON.parse(rawValue);
    if (!parsed || typeof parsed !== "object") {
      return {
        openingCash: 0,
        openingConfirmed: false,
        closingReport: null,
        sessionKey: null,
      };
    }

    return {
      openingCash: Number(parsed.openingCash ?? 0),
      openingConfirmed: Boolean(parsed.openingConfirmed),
      closingReport: parsed.closingReport ?? null,
      sessionKey: typeof parsed.sessionKey === "string" ? parsed.sessionKey : null,
    };
  } catch {
    return {
      openingCash: 0,
      openingConfirmed: false,
      closingReport: null,
      sessionKey: null,
    };
  }
}

async function publishDashboardSnapshot() {
  io.emit("dashboard:snapshot", await buildDashboardSnapshot());
}

app.get("/health", (_, res) => {
  res.json({ ok: true, service: "asados-en-el-barril-server" });
});

app.get("/", (_, res) => {
  res.json({
    ok: true,
    service: "asados-en-el-barril-server",
    message:
      "Servidor Barril activo. Usa /health para probar o /api/dashboard/snapshot para el dashboard publico.",
  });
});

app.get("/api/menu", async (_, res, next) => {
  try {
    const [restaurantName, menu] = await Promise.all([
      getRestaurantName(),
      getMenu(),
    ]);
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
      if (detail.family === "IPv4" && !detail.internal) {
        return detail.address;
      }
    }
  }
  return "127.0.0.1";
}

app.get("/api/dashboard/snapshot", async (_, res, next) => {
  try {
    res.json(await buildDashboardSnapshot());
  } catch (error) {
    next(error);
  }
});

app.get("/api/network-info", async (_, res, next) => {
  try {
    const localIp = resolveLocalIp();
    const publicApiUrl = (await getSetting("publicApiUrl")) ?? "";
    res.json({
      localIp,
      localApiUrl: `http://${localIp}:4000`,
      publicApiUrl,
      tunnel: getTunnelStatus(),
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/tunnel/status", (_, res) => {
  res.json(getTunnelStatus());
});

app.post("/api/tunnel/start", async (_, res, next) => {
  try {
    res.json(await startTunnel());
  } catch (error) {
    next(error);
  }
});

app.post("/api/tunnel/stop", async (_, res, next) => {
  try {
    const status = await stopTunnelProcess();
    await setSetting("publicApiUrl", "");
    io.emit("tunnel:updated", status);
    res.json(status);
  } catch (error) {
    next(error);
  }
});

app.patch("/api/network-info/public-url", async (req, res, next) => {
  try {
    const raw = req.body?.publicApiUrl;
    const publicApiUrl = typeof raw === "string" ? raw.trim() : "";

    if (publicApiUrl && !/^https:\/\//i.test(publicApiUrl)) {
      res
        .status(400)
        .json({ message: "La URL publica debe iniciar con https://." });
      return;
    }

    await setSetting("publicApiUrl", publicApiUrl);
    res.json({ ok: true, publicApiUrl });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/settings/restaurant-name", async (req, res, next) => {
  try {
    const restaurantName = (req.body?.restaurantName ?? "").toString().trim();

    if (!restaurantName) {
      res
        .status(400)
        .json({ message: "El nombre del restaurante no puede estar vacio." });
      return;
    }

    await setSetting("restaurantName", restaurantName);
    res.json({ ok: true, restaurantName });
  } catch (error) {
    next(error);
  }
});

app.get("/api/settings/cash-session", async (_, res, next) => {
  try {
    const cashSession = parseDashboardCashSession(
      await getSetting("cashSession"),
    );
    res.json(cashSession);
  } catch (error) {
    next(error);
  }
});

app.patch("/api/settings/cash-session", async (req, res, next) => {
  try {
    const current = parseDashboardCashSession(
      await getSetting("cashSession"),
    );
    const openingCash =
      req.body?.openingCash != null ? Number(req.body.openingCash) : current.openingCash;
    const openingConfirmed =
      req.body?.openingConfirmed != null
        ? Boolean(req.body.openingConfirmed)
        : current.openingConfirmed;
    const closingReport =
      req.body?.closingReport !== undefined
        ? req.body.closingReport
        : current.closingReport;
    const sessionKey =
      req.body?.sessionKey !== undefined
        ? typeof req.body.sessionKey === "string"
          ? req.body.sessionKey
          : null
        : current.sessionKey;

    const nextValue = {
      openingCash: Number.isFinite(openingCash) ? openingCash : 0,
      openingConfirmed,
      closingReport: closingReport ?? null,
      sessionKey: sessionKey ?? null,
    };

    await setSetting("cashSession", JSON.stringify(nextValue));
    res.json(nextValue);
  } catch (error) {
    next(error);
  }
});

app.get("/api/orders", async (req, res, next) => {
  try {
    const status = req.query.status?.toString();
    const query = req.query.query?.toString();
    res.json(await listOrders({ status, query }));
  } catch (error) {
    next(error);
  }
});

app.get("/api/orders/kitchen", async (_, res, next) => {
  try {
    res.json(await listOrdersForKitchen());
  } catch (error) {
    next(error);
  }
});

app.get("/api/orders/history", async (req, res, next) => {
  try {
    const date = req.query.date?.toString();
    if (!date) {
      res
        .status(400)
        .json({ message: "La fecha es requerida en formato YYYY-MM-DD." });
      return;
    }

    res.json(await listOrdersByDate(date));
  } catch (error) {
    next(error);
  }
});

app.get("/api/waiters", async (_, res, next) => {
  try {
    res.json(await listWaiters());
  } catch (error) {
    next(error);
  }
});

app.get("/api/waiters/validate", async (req, res, next) => {
  try {
    const name = req.query.name?.toString() ?? "";
    const waiter = await getWaiterByName(name);
    res.json({
      authorized: Boolean(waiter && Number(waiter.active) === 1),
      waiter,
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/waiters", async (req, res, next) => {
  try {
    const name = req.body?.name?.toString() ?? "";
    if (!name.trim()) {
      res.status(400).json({ message: "El nombre del mesero es requerido." });
      return;
    }

    const waiter = await upsertWaiter(name, 1);
    if (!waiter) {
      res.status(400).json({ message: "No se pudo registrar el mesero." });
      return;
    }

    res.status(201).json(waiter);
  } catch (error) {
    next(error);
  }
});

app.patch("/api/waiters/:waiterName", async (req, res, next) => {
  try {
    const waiterName = req.params.waiterName?.toString() ?? "";
    const active = Boolean(req.body?.active);
    const waiter = await setWaiterActive(waiterName, active);

    if (!waiter) {
      res.status(404).json({ message: "Mesero no encontrado." });
      return;
    }

    res.json(waiter);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/waiters/:waiterName", async (req, res, next) => {
  try {
    const waiterName = req.params.waiterName?.toString() ?? "";
    const deletedWaiter = await deleteWaiter(waiterName);

    if (!deletedWaiter) {
      res.status(404).json({ message: "Mesero no encontrado." });
      return;
    }

    res.json({ ok: true, deletedWaiter });
  } catch (error) {
    next(error);
  }
});

app.post("/api/orders", async (req, res, next) => {
  try {
    const { clientName, tableNumber, waiterName, items } = req.body;
    const comment = (req.body?.comment ?? "").toString().trim();
    const expenses = normalizeOrderExpenses(req.body?.expenses);
    const serviceType = normalizeServiceType(req.body?.serviceType);
    const resolvedTableNumber = isPickupServiceType(serviceType)
      ? defaultTableForServiceType(serviceType)
      : `${tableNumber ?? ""}`.trim();

    if (
      !clientName ||
      !resolvedTableNumber ||
      !waiterName ||
      !Array.isArray(items) ||
      items.length === 0
    ) {
      res
        .status(400)
        .json({
          message:
            "Debe enviar nombre del cliente, mesa, mesero y al menos un producto.",
        });
      return;
    }

    const waiter = await getWaiterByName(waiterName);
    if (!waiter || Number(waiter.active) !== 1) {
      res
        .status(403)
        .json({
          message: "Mesero no autorizado. Solicite activacion en la laptop.",
        });
      return;
    }

    const menu = await getMenu();
    const normalizedItems = items.map((item) => ({
      menuItemId: item.menuItemId,
      quantity: Number(item.quantity) || 1,
      weightGrams: item.weightGrams != null ? Number(item.weightGrams) : null,
      weightBreakdown: Array.isArray(item.weightBreakdown)
        ? item.weightBreakdown.map((grams) => Number(grams))
        : null,
      unitPrice: item.unitPrice != null ? Number(item.unitPrice) : null,
      subtotal: item.subtotal != null ? Number(item.subtotal) : null,
      pricingMode: item.pricingMode ?? null,
      weightFormula: item.weightFormula ?? null,
      notes: typeof item.notes === "string" ? item.notes : "",
    }));

    const summarizedItems = summarizeItems(normalizedItems, menu);
    const total = calculateOrderTotal(summarizedItems, menu, expenses);
    const order = {
      id: `COM-${nanoid(6).toUpperCase()}`,
      clientName,
      tableNumber: resolvedTableNumber,
      serviceType,
      waiterName,
      status: "pending",
      kitchenStatus: "pendiente",
      paymentMethod: null,
      total,
      createdAt: new Date().toISOString(),
      paidAt: null,
      items: summarizedItems,
      expenses,
      comments: comment
        ? [
            {
              text: comment,
              createdAt: new Date().toISOString(),
              author: waiterName,
              kind: "initial",
            },
          ]
        : [],
    };

      await createOrder(order);
      await publishDashboardSnapshot();
    io.emit("order:new", order);
    res
      .status(201)
      .json({
        ...order,
        printer: { printed: false, reason: "awaiting-laptop-auto-print" },
      });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/orders/:orderId", async (req, res, next) => {
  try {
    const { orderId } = req.params;

    // Validar que el orderId tiene formato válido (prevención de duplicados)
    if (
      !orderId ||
      typeof orderId !== "string" ||
      !orderId.startsWith("COM-")
    ) {
      res.status(400).json({ message: "ID de orden inválido." });
      return;
    }
    const { clientName, tableNumber, waiterName, items } = req.body;
    const comment = (req.body?.comment ?? "").toString().trim();
    const expenses =
      req.body?.expenses !== undefined
        ? normalizeOrderExpenses(req.body?.expenses)
        : undefined;
    const serviceType = req.body?.serviceType != null
      ? normalizeServiceType(req.body.serviceType)
      : undefined;
    const resolvedTableNumber = serviceType && isPickupServiceType(serviceType)
      ? defaultTableForServiceType(serviceType)
      : `${tableNumber ?? ""}`.trim();

    if (
      !clientName ||
      !resolvedTableNumber ||
      !waiterName ||
      !Array.isArray(items) ||
      items.length === 0
    ) {
      res
        .status(400)
        .json({
          message:
            "Debe enviar nombre del cliente, mesa, mesero y al menos un producto.",
        });
      return;
    }

    const waiter = await getWaiterByName(waiterName);
    if (!waiter || Number(waiter.active) !== 1) {
      res
        .status(403)
        .json({
          message: "Mesero no autorizado. Solicite activacion en la laptop.",
        });
      return;
    }

    const currentOrder = await getOrderById(orderId);
    if (!currentOrder) {
      res.status(404).json({ message: "Cuenta no encontrada." });
      return;
    }

    if (currentOrder.status === "paid") {
      res
        .status(409)
        .json({ message: "La cuenta ya esta pagada y no se puede modificar." });
      return;
    }

    const menu = await getMenu();
    const normalizedItems = items.map((item) => ({
      menuItemId: item.menuItemId,
      quantity: Number(item.quantity) || 1,
      weightGrams: item.weightGrams != null ? Number(item.weightGrams) : null,
      weightBreakdown: Array.isArray(item.weightBreakdown)
        ? item.weightBreakdown.map((grams) => Number(grams))
        : null,
      unitPrice: item.unitPrice != null ? Number(item.unitPrice) : null,
      subtotal: item.subtotal != null ? Number(item.subtotal) : null,
      pricingMode: item.pricingMode ?? null,
      weightFormula: item.weightFormula ?? null,
      notes: typeof item.notes === "string" ? item.notes : "",
    }));

    const mergedItems = preserveWeightFromCurrentOrder(
      normalizedItems,
      currentOrder.items,
    );
    const summarizedItems = summarizeItems(mergedItems, menu);
    const total = calculateOrderTotal(
      summarizedItems,
      menu,
      expenses ?? currentOrder.expenses ?? [],
    );
    const updatedOrder = await updateOrderWithItems(orderId, {
      clientName,
      tableNumber: resolvedTableNumber,
      serviceType,
      waiterName,
      total,
      items: summarizedItems,
      expenses,
      comment,
    });

    io.emit("order:updated", updatedOrder);
    if (updatedOrder.status === "paid") {
      io.emit("order:paid", updatedOrder);
    }
      await publishDashboardSnapshot();
    res.json(updatedOrder);
  } catch (error) {
    if (error?.code === "ORDER_LOCKED") {
      res.status(409).json({ message: error.message });
      return;
    }

    if (error?.code === "PAID_AMOUNT_EXCEEDS_TOTAL") {
      res.status(409).json({ message: error.message });
      return;
    }

    next(error);
  }
});

app.patch("/api/orders/:orderId/kitchen-status", async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const kitchenStatus = req.body?.kitchenStatus?.toString() ?? "";

    if (
      !["pendiente", "en_preparacion", "completado"].includes(kitchenStatus)
    ) {
      res.status(400).json({ message: "Estado de cocina invalido." });
      return;
    }

    const currentOrder = await getOrderById(orderId);
    if (!currentOrder) {
      res.status(404).json({ message: "Cuenta no encontrada." });
      return;
    }

    if (
      currentOrder.status === "paid" &&
      !isPickupServiceType(currentOrder.serviceType)
    ) {
      res
        .status(409)
        .json({
          message: "La cuenta ya esta pagada y no se puede mover en cocina.",
        });
      return;
    }

    const updatedOrder = await updateOrderKitchenStatus(orderId, kitchenStatus);
    io.emit("order:kitchen-updated", updatedOrder);
      await publishDashboardSnapshot();
    res.json(updatedOrder);
  } catch (error) {
    if (error?.code === "INVALID_KITCHEN_STATUS") {
      res.status(400).json({ message: error.message });
      return;
    }

    next(error);
  }
});

app.patch("/api/orders/:orderId/dispatch", async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const currentOrder = await getOrderById(orderId);
    if (!currentOrder) {
      res.status(404).json({ message: "Cuenta no encontrada." });
      return;
    }

    const updatedOrder = await markOrderDispatched(orderId);
    if (!updatedOrder) {
      res.status(404).json({ message: "Cuenta no encontrada." });
      return;
    }

    io.emit("order:dispatched", updatedOrder);
    io.emit("order:updated", updatedOrder);
      await publishDashboardSnapshot();
    res.json(updatedOrder);
  } catch (error) {
    if (
      error?.code === "NOT_PICKUP_ORDER" ||
      error?.code === "ORDER_NOT_PAID" ||
      error?.code === "KITCHEN_NOT_READY"
    ) {
      res.status(409).json({ message: error.message });
      return;
    }

    if (`${error?.message ?? ""}`.includes("dispatched_at")) {
      res.status(500).json({
        message:
          "Falta actualizar la base de datos. Reinicia el servidor e intenta de nuevo.",
      });
      return;
    }

    next(error);
  }
});

app.post("/api/orders/:orderId/print", async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const order = await getOrderById(orderId);
    if (!order) {
      res.status(404).json({ message: "Cuenta no encontrada." });
      return;
    }

    const restaurantName = await getRestaurantName();
    const printer = await printKitchenTicket(order, restaurantName);
    res.json(printer);
  } catch (error) {
    next(error);
  }
});

app.patch("/api/orders/:orderId/pay", async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const { paymentMethod, amount, tenderedAmount, transferenceNumber } =
      req.body;

    if (!["efectivo", "transferencia"].includes(paymentMethod)) {
      res.status(400).json({ message: "Metodo de pago invalido." });
      return;
    }

    const order = await getOrderById(orderId);
    if (!order) {
      res.status(404).json({ message: "Cuenta no encontrada." });
      return;
    }

    if (order.balanceDue <= 0) {
      res
        .status(400)
        .json({ message: "La cuenta ya esta completamente pagada." });
      return;
    }

    const requestedAmount = amount != null ? Number(amount) : order.balanceDue;
    const normalizedAmount =
      Math.round((requestedAmount + Number.EPSILON) * 100) / 100;
    const maxAmount =
      Math.round((order.balanceDue + Number.EPSILON) * 100) / 100;

    if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
      res
        .status(400)
        .json({ message: "El monto del abono debe ser mayor a cero." });
      return;
    }

    const normalizedTransferNumber = `${transferenceNumber ?? ""}`.trim();
    if (paymentMethod === "transferencia" && !normalizedTransferNumber) {
      res
        .status(400)
        .json({
          message: "El número de comprobante es obligatorio en transferencia.",
        });
      return;
    }

    if (normalizedAmount > maxAmount) {
      res
        .status(400)
        .json({ message: "El abono no puede superar el saldo pendiente." });
      return;
    }

    const normalizedTendered =
      paymentMethod === "efectivo"
        ? Math.round(
            (Number(tenderedAmount ?? normalizedAmount) + Number.EPSILON) * 100,
          ) / 100
        : normalizedAmount;

    if (
      !Number.isFinite(normalizedTendered) ||
      normalizedTendered < normalizedAmount
    ) {
      res
        .status(400)
        .json({
          message:
            "En efectivo, el valor recibido no puede ser menor al abono.",
        });
      return;
    }

    const changeGiven =
      paymentMethod === "efectivo"
        ? Math.round(
            (Math.max(normalizedTendered - normalizedAmount, 0) +
              Number.EPSILON) *
              100,
          ) / 100
        : 0;

    const paidAt = new Date().toISOString();
    const payServiceType =
      req.body?.serviceType != null
        ? normalizeServiceType(req.body.serviceType)
        : null;
    const updatedOrder = await addOrderPayment(
      orderId,
      paymentMethod,
      normalizedAmount,
      normalizedTendered,
      changeGiven,
      paidAt,
      normalizedTransferNumber,
      payServiceType,
    );

    io.emit("order:updated", updatedOrder);
    if (updatedOrder.status === "paid") {
      io.emit("order:paid", updatedOrder);
    }

    await publishDashboardSnapshot();
    res.json(updatedOrder);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/orders/:orderId", async (req, res, next) => {
  try {
    const { orderId } = req.params;

    if (
      !orderId ||
      typeof orderId !== "string" ||
      !orderId.startsWith("COM-")
    ) {
      res.status(400).json({ message: "ID de orden invalido." });
      return;
    }

    const order = await getOrderById(orderId);
    if (!order) {
      res.status(404).json({ message: "Cuenta no encontrada." });
      return;
    }

    if (order.status === "paid") {
      res
        .status(409)
        .json({ message: "La cuenta ya esta pagada y no se puede eliminar." });
      return;
    }

    const removed = await deleteOrderById(orderId);
    if (!removed) {
      res.status(404).json({ message: "Cuenta no encontrada." });
      return;
    }

    io.emit("order:updated", { id: orderId, deleted: true });
    res.json({ ok: true, orderId });
  } catch (error) {
    next(error);
  }
});

app.get("/api/stats", async (req, res, next) => {
  try {
    const menu = await getMenu();
    const orders = await listOrders();
    const from =
      req.query.from?.toString() ??
      `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`;
    const to =
      req.query.to?.toString() ??
      `${new Date().toISOString().slice(0, 10)}T23:59:59.999Z`;
    res.json(getStats(orders, menu, from, to));
  } catch (error) {
    next(error);
  }
});

app.get("/api/stats-summary", async (req, res, next) => {
  try {
    const menu = await getMenu();
    const orders = await listOrders();
        await publishDashboardSnapshot();
    res.json(getStatsSummary(orders, menu));
  } catch (error) {
    next(error);
  }
});

app.get("/api/diagnostics/duplicates", async (req, res, next) => {
  try {
    const orders = await listOrders();
    const duplicates = detectDuplicateOrders(orders);
    res.json({
      totalOrders: orders.length,
      duplicatesFound: duplicates.length,
      duplicates,
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/cash-close", async (req, res, next) => {
  try {
    const orders = await listOrders();
    const date = req.query.date?.toString() ?? getDateKey(new Date().toISOString());
    res.json(getCashClose(orders, date));
  } catch (error) {
    next(error);
  }
});

app.get("/api/backup/json", async (_, res, next) => {
  try {
    const data = await exportAllData();
    res.json(data);
  } catch (error) {
    next(error);
  }
});

app.post("/api/restore/json", async (req, res, next) => {
  try {
    const payload = req.body;
    if (!payload) {
      res.status(400).json({ message: "Payload JSON requerido." });
      return;
    }

    await restoreData(payload);
    io.emit("data:restored");
      await publishDashboardSnapshot();
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post("/api/db/vacuum", async (_, res, next) => {
  try {
    await vacuumDatabase();
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post("/api/cleanup", async (req, res, next) => {
  try {
    const before = req.body?.before;
    if (!before) {
      res
        .status(400)
        .json({ message: "Debe indicar fecha antes de YYYY-MM-DD." });
      return;
    }

    await deleteOrdersOlderThan(`${before}T00:00:00.000Z`);
      await publishDashboardSnapshot();
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post("/api/cleanup/all", async (req, res, next) => {
  try {
    await deleteAllOrders();
      await publishDashboardSnapshot();
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.use((error, _, res, __) => {
  // eslint-disable-next-line no-console
  console.error(error);
  res.status(500).json({ message: "Error interno del servidor." });
});

io.on("connection", async (socket) => {
  try {
    socket.emit("dashboard:snapshot", await buildDashboardSnapshot());
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Failed to send dashboard snapshot", error);
  }
});

const PORT = process.env.PORT || 4000;

await initializeDatabase();

// Ensure backups directory exists and schedule periodic copies of the DB file.
const DATA_DIR = fileURLToPath(new URL("../data/", import.meta.url));
const BACKUPS_DIR = path.join(DATA_DIR, "backups");
try {
  // Create backups dir if missing
  // eslint-disable-next-line no-console
  if (!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true });
} catch (e) {
  // ignore
}

function performPeriodicBackup() {
  try {
    const src = path.join(DATA_DIR, "barril.sqlite");
    if (!fs.existsSync(src)) return;

    const dest = path.join(BACKUPS_DIR, `barril-${new Date()
      .toISOString()
      .replace(/[:.]/g, "-")}.sqlite`);
    fs.copyFileSync(src, dest);
    // eslint-disable-next-line no-console
    console.log("Backup saved to", dest);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Backup failed", err);
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
