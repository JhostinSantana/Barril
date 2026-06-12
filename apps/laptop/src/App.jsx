import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { QRCode } from "react-qr-code";
import { io } from "socket.io-client";
import {
    calculateWeightedCutPrice,
    getWeightFormulaLabel,
    resolveWeightFormulaForOrderItem,
} from "../../server/src/pricing.js";
import {
    CONTAINER_EXPENSE_AMOUNT,
    CONTAINER_EXPENSE_DESCRIPTION,
    createContainerExpense,
    formatOrderLocation,
    getServiceTypeLabel,
    inferServiceTypeFromTable,
    isContainerExpense,
    isPickupServiceType,
    normalizeContainerQuantity,
    normalizeServiceType,
} from "../../server/src/utils.js";
import {
  buildBranchPublicDashboardUrl,
  buildFreeMasterPublicDashboardUrl,
  buildMasterPublicDashboardUrl,
  buildMultiSiteStatusLabel,
  clearPublicDashboardPinSession,
  COMBINED_PUBLIC_SITE_ID,
  createInitialPublicSiteRuntime,
  fetchPublicDashboardSnapshot,
  formatPublicSyncLabel,
  getPresetFixedSiteUrls,
  getPublicDashboardMode,
  hasPresetFixedSiteUrls,
  hasTunnelRegistryUrl,
  isPublicDashboardPinSessionValid,
  isPublicPagesView,
  isBranchSiteId,
  markPublicDashboardPinSession,
  normalizePublicBackendUrl,
  resolvePublicSiteEntries,
  resolveSiteApiUrl,
  PUBLIC_SITES,
  readBranchSiteId,
  writeBranchSiteId,
  writeSiteSnapshot,
} from "./publicDashboardSites.js";
import "./App.css";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL?.trim() || "http://localhost:4000";
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL?.trim() || API_BASE_URL;
const PUBLIC_API_BASE_URL_STORAGE_KEY = "barril.publicApiBaseUrl";
const PUBLIC_SOCKET_URL_STORAGE_KEY = "barril.publicSocketUrl";
const PUBLIC_DASHBOARD_SNAPSHOT_KEY = "barril.publicDashboardSnapshot";

const socketRef = { instance: null, url: "" };

function getSocket() {
  const url = getSocketBaseUrl();
  if (!socketRef.instance || socketRef.url !== url) {
    socketRef.instance?.removeAllListeners();
    socketRef.instance?.disconnect();
    socketRef.instance = io(url, {
      autoConnect: false,
      transports: ["websocket", "polling"],
    });
    socketRef.url = url;
  }
  return socketRef.instance;
}

function isDashboardSnapshot(value) {
  return Boolean(
    value &&
      (Array.isArray(value.pendingOrders) ||
        Array.isArray(value.paidOrders) ||
        Array.isArray(value.historyGrouped) ||
        value.dailyStats ||
        value.allTimeStats ||
        value.statsSummary ||
        value.cashSession),
  );
}

const DELETE_ACCOUNT_PIN = "040420";
const STATS_ACCESS_PIN = "040420";
const ADMIN_DASHBOARD_LINK_TARGET = "__admin-dashboard-link__";
const PROTECTED_NAV_VIEW_IDS = new Set(["stats", "history"]);
const PROTECTED_VIEW_COPY = {
  stats: {
    title: "Dashboard administrativo",
    note: "Ingresa el PIN de administrador para abrir el dashboard.",
  },
  history: {
    title: "Dias anteriores",
    note: "Ingresa el PIN de administrador para revisar las comandas anteriores.",
  },
  [ADMIN_DASHBOARD_LINK_TARGET]: {
    title: "Enlaces administrativos remotos",
    note: "Ingresa el PIN de administrador para ver los QR y enlaces del dashboard (sede y multi-sede).",
  },
};
const ADMIN_SENSITIVE_LINKS_TIMEOUT_MS = 90 * 1000;
const BOGOTA_TIME_ZONE = "America/Bogota";
const SERVICE_TYPE_OPTIONS = [
  { id: "mesa", label: "Mesa" },
  { id: "para_llevar", label: "Para llevar" },
];
function readStoredPublicApiBaseUrl() {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(PUBLIC_API_BASE_URL_STORAGE_KEY) ?? "";
}

function writeStoredPublicApiBaseUrl(value) {
  if (typeof window === "undefined") return;
  if (value) {
    window.localStorage.setItem(PUBLIC_API_BASE_URL_STORAGE_KEY, value);
  } else {
    window.localStorage.removeItem(PUBLIC_API_BASE_URL_STORAGE_KEY);
  }
}

function readStoredPublicSocketUrl() {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(PUBLIC_SOCKET_URL_STORAGE_KEY) ?? "";
}

function writeStoredPublicSocketUrl(value) {
  if (typeof window === "undefined") return;
  if (value) {
    window.localStorage.setItem(PUBLIC_SOCKET_URL_STORAGE_KEY, value);
  } else {
    window.localStorage.removeItem(PUBLIC_SOCKET_URL_STORAGE_KEY);
  }
}

function normalizeClosingReport(value) {
  if (!value || typeof value !== "object") return null;

  const efectivo = value.efectivo != null ? Number(value.efectivo) : 0;
  const transferencia =
    value.transferencia != null ? Number(value.transferencia) : 0;
  const totalSold =
    value.totalSold != null
      ? Number(value.totalSold)
      : roundMoney(efectivo + transferencia);
  const expectedCash =
    value.efectivo != null
      ? efectivo
      : value.expectedCash != null
        ? Number(value.expectedCash)
        : null;
  const expectedTransfer =
    value.transferencia != null
      ? transferencia
      : value.expectedTransfer != null
        ? Number(value.expectedTransfer)
        : null;
  const expectedTotal =
    value.totalSold != null
      ? totalSold
      : value.expectedTotal != null
        ? Number(value.expectedTotal)
        : roundMoney(Number(expectedCash ?? 0) + Number(expectedTransfer ?? 0));
  const countedTotal =
    value.countedTotal != null
      ? Number(value.countedTotal)
      : roundMoney(Number(value.countedCash ?? 0) + Number(value.countedTransfer ?? 0));
  const differenceTotal = roundMoney(countedTotal - expectedTotal);

  return {
    id: value.id ?? value.closedAt ?? null,
    date: value.date ?? null,
    openingCash:
      value.openingCash != null ? Number(value.openingCash) : 0,
    efectivo,
    transferencia,
    totalSold,
    countedCash:
      value.countedCash != null ? Number(value.countedCash) : null,
    countedTransfer:
      value.countedTransfer != null ? Number(value.countedTransfer) : null,
    expectedCash,
    expectedTransfer,
    expectedTotal,
    countedTotal,
    differenceCash:
      value.differenceCash != null ? Number(value.differenceCash) : null,
    differenceTransfer:
      value.differenceTransfer != null ? Number(value.differenceTransfer) : null,
    differenceTotal,
    matches: differenceTotal === 0,
    adminConfirmed: Boolean(value.adminConfirmed),
    confirmedAt: value.confirmedAt ?? null,
    reviewPaidOrders: Array.isArray(value.reviewPaidOrders)
      ? value.reviewPaidOrders
      : [],
    status:
      differenceTotal === 0
        ? "matched"
        : differenceTotal > 0
          ? "surplus"
          : "short",
    closedAt: value.closedAt ?? null,
  };
}

function normalizeCashSession(value) {
  const openingCash = Number(value?.openingCash ?? 0);
  const closingReport = normalizeClosingReport(value?.closingReport);
  const closingHistory = (Array.isArray(value?.closingHistory)
    ? value.closingHistory
    : []
  )
    .map(normalizeClosingReport)
    .filter(Boolean);

  return {
    openingCash: Number.isFinite(openingCash) ? openingCash : 0,
    openingConfirmed: Boolean(value?.openingConfirmed),
    sessionKey: typeof value?.sessionKey === "string" ? value.sessionKey : null,
    closingReport,
    closingHistory,
  };
}

function readPublicDashboardSnapshot() {
  if (typeof window === "undefined") return null;

  const raw = window.localStorage.getItem(PUBLIC_DASHBOARD_SNAPSHOT_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writePublicDashboardSnapshot(snapshot) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      PUBLIC_DASHBOARD_SNAPSHOT_KEY,
      JSON.stringify(snapshot),
    );
  } catch {
    // Ignore storage errors.
  }
}

const navItems = [
  { id: "stats", label: "Estadistica" },
  { id: "cash", label: "Cierre de caja" },
  { id: "history", label: "Dias anteriores" },
  { id: "waiters", label: "Meseros" },
  { id: "network", label: "Conectividad" },
];
const STATS_RANGE_OPTIONS = [
  { id: "hoy", label: "Hoy" },
  { id: "ayer", label: "Ayer" },
  { id: "semana", label: "Semana" },
  { id: "mes", label: "Mes" },
  { id: "año", label: "Año" },
  { id: "personalizado", label: "Personalizado" },
];

function formatCurrency(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value ?? 0);
}

function parseMoneyInput(rawValue) {
  const cleaned = `${rawValue ?? ""}`.replace(",", ".").replace(/[^\d.]/g, "");
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundMoney(value) {
  return Math.round((Number(value ?? 0) + Number.EPSILON) * 100) / 100;
}

function normalizeDateForFormatting(value = new Date()) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? new Date() : value;
  }

  const parsedDate = new Date(value ?? Date.now());
  return Number.isNaN(parsedDate.getTime()) ? new Date() : parsedDate;
}

function getWeightDraftValues(draftValue, quantity, fallbackWeight) {
  const targetQuantity = Math.max(1, Number(quantity) || 1);
  const values = Array.isArray(draftValue)
    ? draftValue.slice(0, targetQuantity)
    : [];

  while (values.length < targetQuantity) {
    values.push(fallbackWeight != null ? `${fallbackWeight}` : "");
  }

  return values;
}

function formatWeightBreakdown(item) {
  if (Array.isArray(item?.weightBreakdown) && item.weightBreakdown.length > 0) {
    return item.weightBreakdown.map((grams) => `${grams} g`).join(" + ");
  }

  return item?.weightGrams != null ? `${item.weightGrams} g` : "";
}

function getSalesIntensityStyle(value, maxValue) {
  if (!maxValue) return { "--bar-fill": "0%" };
  const normalized = Math.max((value / maxValue) * 100, value > 0 ? 8 : 0);
  return { "--bar-fill": `${Math.min(normalized, 100)}%` };
}

function formatCalendarDayLabel(dateKey) {
  const [year, month, day] = `${dateKey ?? ""}`.split("-").map(Number);
  if (!year || !month || !day) return dateKey ?? "";

  return new Date(year, month - 1, day).toLocaleDateString("es-CO", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function getApiBaseUrl() {
  if (typeof window !== "undefined") {
    const params = new URLSearchParams(window.location.search);
    const apiFromQuery = params.get("api")?.trim();
    if (apiFromQuery) {
      writeStoredPublicApiBaseUrl(apiFromQuery);
      return apiFromQuery;
    }
  }

  const storedPublicUrl = readStoredPublicApiBaseUrl();
  if (storedPublicUrl) {
    return storedPublicUrl;
  }

  return API_BASE_URL;
}

function getSocketBaseUrl() {
  if (typeof window !== "undefined") {
    const params = new URLSearchParams(window.location.search);
    const socketFromQuery = params.get("socket")?.trim();
    if (socketFromQuery) {
      writeStoredPublicSocketUrl(socketFromQuery);
      return socketFromQuery;
    }
  }

  const storedPublicUrl = readStoredPublicSocketUrl();
  if (storedPublicUrl) {
    return storedPublicUrl;
  }

  return SOCKET_URL;
}

function getStatusLabel(status) {
  if (status === "paid") return "Pagada";
  if (status === "partial") return "Abonada";
  return "Pendiente";
}

function getKitchenStatusLabel(status) {
  if (status === "completado") return "Lista";
  if (status === "en_preparacion") return "Preparando";
  return "Pendiente";
}

function getKitchenStatusClass(status) {
  if (status === "completado") return "kitchen-status-lista";
  if (status === "en_preparacion") return "kitchen-status-preparando";
  return "kitchen-status-pendiente";
}

function KitchenStatusLine({ status }) {
  return (
    <p className="kitchen-status-line">
      Cocina:{" "}
      <span className={`kitchen-status-badge ${getKitchenStatusClass(status)}`}>
        {getKitchenStatusLabel(status)}
      </span>
    </p>
  );
}

function isPickupAwaitingDispatch(order) {
  return (
    isPickupServiceType(order?.serviceType) &&
    order?.status === "paid" &&
    !order?.dispatchedAt
  );
}

function isKitchenReadyForDispatch(order) {
  return order?.kitchenStatus === "completado";
}

function describePayment(order) {
  const cash = Number(order?.paymentSummary?.efectivo ?? 0);
  const transfer = Number(order?.paymentSummary?.transferencia ?? 0);

  if (cash > 0 && transfer > 0) {
    return `Mixto (${formatCurrency(cash)} efectivo + ${formatCurrency(
      transfer,
    )} transferencia)`;
  }
  if (cash > 0) return `Efectivo (${formatCurrency(cash)})`;
  if (transfer > 0) return `Transferencia (${formatCurrency(transfer)})`;
  return "Sin pago";
}

function getEditSummary(order) {
  const summary = Array.isArray(order?.editSummary) ? order.editSummary : [];
  const editedIds = new Set(
    summary
      .filter((item) => item.type !== "removed")
      .map((item) => item.menuItemId),
  );

  return { summary, editedIds };
}

function getComments(order) {
  return Array.isArray(order?.comments) ? order.comments : [];
}

function getItemNotes(item) {
  return String(item?.notes ?? "").trim();
}

function ItemPlateNote({ item }) {
  const text = getItemNotes(item);
  if (!text) {
    return null;
  }

  return <p className="item-plate-note">{text}</p>;
}

function getEditChangeLabel(change) {
  if (change.type === "added") return `Agregado: ${change.quantity}`;
  if (change.type === "removed") return `Eliminado: ${change.previousQuantity}`;
  if (change.type === "quantity-up")
    return `Subio de ${change.previousQuantity} a ${change.quantity}`;
  if (change.type === "quantity-down")
    return `Bajo de ${change.previousQuantity} a ${change.quantity}`;
  return "Editado";
}

function isWeightedItem(item) {
  return item?.pricingMode === "weight";
}

function getOrderExpenses(order) {
  return Array.isArray(order?.expenses) ? order.expenses : [];
}

function getContainerExpenseQuantity(expenses) {
  return expenses.reduce((acc, expense) => {
    if (!isContainerExpense(expense)) return acc;
    return acc + normalizeContainerQuantity(expense?.quantity);
  }, 0);
}

function getContainerExpenseTotal(quantity) {
  return Math.round((normalizeContainerQuantity(quantity) * CONTAINER_EXPENSE_AMOUNT + Number.EPSILON) * 100) / 100;
}

function getExpenseLabel(expense) {
  if (isContainerExpense(expense)) {
    const quantity = normalizeContainerQuantity(expense?.quantity);
    return quantity > 1
      ? `${CONTAINER_EXPENSE_DESCRIPTION} x ${quantity}`
      : CONTAINER_EXPENSE_DESCRIPTION;
  }

  return `${expense?.description ?? ""}`.trim();
}

function getOrderExpensesTotal(order) {
  return getOrderExpenses(order).reduce(
    (acc, expense) => acc + Number(expense?.amount ?? 0),
    0,
  );
}

function getOrderPaymentTotals(order) {
  return {
    efectivo: Number(order?.paymentSummary?.efectivo ?? 0),
    transferencia: Number(order?.paymentSummary?.transferencia ?? 0),
  };
}

function normalizeStatsPaymentMethod(value) {
  const normalized = `${value ?? ""}`.trim().toLowerCase();
  if (normalized === "efectivo") return "efectivo";
  if (normalized === "transferencia") return "transferencia";
  return null;
}

function getDashboardPaymentMovements(order) {
  const payments = Array.isArray(order?.payments) ? order.payments : [];

  if (payments.length > 0) {
    return payments
      .map((payment) => {
        const paymentMethod = normalizeStatsPaymentMethod(payment.paymentMethod);
        if (!paymentMethod) return null;

        return {
          orderId: order.id,
          paymentMethod,
          amount: roundMoney(payment.amount ?? 0),
          createdAt: payment.createdAt ?? order.paidAt ?? order.createdAt ?? null,
        };
      })
      .filter(Boolean);
  }

  if (order?.status !== "paid") return [];

  const paymentTotals = getOrderPaymentTotals(order);
  const summaryMovements = [
    ["efectivo", paymentTotals.efectivo],
    ["transferencia", paymentTotals.transferencia],
  ]
    .filter(([, amount]) => Number(amount) > 0)
    .map(([paymentMethod, amount]) => ({
      orderId: order.id,
      paymentMethod,
      amount: roundMoney(amount),
      createdAt: order.paidAt ?? order.createdAt ?? null,
    }));

  if (summaryMovements.length > 0) return summaryMovements;

  const fallbackPaymentMethod = normalizeStatsPaymentMethod(order.paymentMethod);
  if (!fallbackPaymentMethod) return [];

  return [
    {
      orderId: order.id,
      paymentMethod: fallbackPaymentMethod,
      amount: roundMoney(order.total ?? 0),
      createdAt: order.paidAt ?? order.createdAt ?? null,
    },
  ];
}

function getDashboardItemKey(item) {
  return `${item?.menuItemId ?? ""}|${item?.name ?? ""}|${item?.category ?? ""}`;
}

function isBeverageDashboardItem(item) {
  const category = `${item?.category ?? ""}`
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const menuItemId = `${item?.menuItemId ?? ""}`.trim().toLowerCase();
  const name = `${item?.name ?? ""}`
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  if (category === "bebidas" || menuItemId.startsWith("bebida-")) {
    return true;
  }

  return /^(agua natural|agua|jugo frozen|jugo|gaseosa personal|gaseosa de 1l|gaseosa|fuze te|del valle|cerveza sol|cerveza club|solveza|jarra de sangria|cafe)$/.test(name);
}

function getCashCloseStatus(difference) {
  const rounded = roundMoney(difference);
  if (rounded === 0) return "matched";
  return rounded > 0 ? "surplus" : "short";
}

function getCashCloseStatusLabel(status) {
  if (status === "matched") return "Coincide";
  if (status === "surplus") return "Sobra";
  return "Falta";
}

function formatSignedCurrency(value) {
  const normalized = roundMoney(value);
  return `${normalized > 0 ? "+" : ""}${formatCurrency(normalized)}`;
}

function buildDashboardMetrics({
  paidOrders,
  historyGrouped,
  historyOrders,
  dailyStats,
  allTimeStats,
  cashClose,
  cashSession,
  historyDate,
  statsRange,
  sessionKey,
}) {
  const todayKey = getBogotaDateKey();
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterdayKey = getBogotaDateKey(yesterdayDate);

  const paymentMap = new Map([
    ["efectivo", { method: "efectivo", label: "Efectivo", count: 0, total: 0 }],
    ["transferencia", { method: "transferencia", label: "Transferencia", count: 0, total: 0 }],
  ]);
  const topDishMap = new Map();
  const weightedCutMap = new Map();
  const beverageMap = new Map();
  const containerMap = new Map();
  const extraMap = new Map();
  const paidByDate = new Map();
  const containerHistoryMap = new Map();
  const pendingClosingReport =
    hasActivePendingClosing(cashSession, sessionKey) && cashSession?.closingReport
      ? cashSession.closingReport
      : null;
  const paidOrdersList =
    Array.isArray(pendingClosingReport?.reviewPaidOrders) &&
    pendingClosingReport.reviewPaidOrders.length > 0
      ? pendingClosingReport.reviewPaidOrders
      : Array.isArray(paidOrders)
        ? paidOrders
        : [];

  const addBucket = (map, key, label) => {
    if (!map.has(key)) {
      map.set(key, { key, label, quantity: 0, total: 0 });
    }
    return map.get(key);
  };

  let totalSales = 0;
  let todaySales = 0;
  let totalKgSold = 0;
  let totalContainersSold = 0;
  let totalBeveragesSold = 0;

  for (const order of paidOrdersList) {
    const orderDateKey = getBogotaDateKey(order.paidAt ?? order.createdAt);
    const movements = getDashboardPaymentMovements(order);
    const orderSales = movements.reduce((acc, movement) => acc + Number(movement.amount ?? 0), 0);
    const dailyRow = paidByDate.get(orderDateKey) ?? {
      date: orderDateKey,
      label: orderDateKey === todayKey ? "Hoy" : orderDateKey === yesterdayKey ? "Ayer" : formatCalendarDayLabel(orderDateKey),
      sales: 0,
      orders: 0,
    };

    dailyRow.orders += 1;
    dailyRow.sales = roundMoney(dailyRow.sales + orderSales);
    paidByDate.set(orderDateKey, dailyRow);

    if (orderDateKey === todayKey) {
      todaySales = roundMoney(todaySales + orderSales);
    }

    totalSales = roundMoney(totalSales + orderSales);

    for (const movement of movements) {
      const methodKey = normalizeStatsPaymentMethod(movement.paymentMethod);
      if (!methodKey) continue;

      const paymentBucket = paymentMap.get(methodKey);
      paymentBucket.count += 1;
      paymentBucket.total = roundMoney(paymentBucket.total + Number(movement.amount ?? 0));
    }

    for (const item of Array.isArray(order.items) ? order.items : []) {
      const quantity = Math.max(1, Number(item.quantity ?? 0));
      const subtotal = Number(item.subtotal ?? 0);
      const revenue = roundMoney(subtotal > 0 ? subtotal : Number(item.unitPrice ?? 0) * quantity);
      const key = getDashboardItemKey(item);
      const itemLabel = item.name ?? item.category ?? "Producto";
      const beverageItem = isBeverageDashboardItem(item);

      if (!beverageItem) {
        const topBucket = addBucket(topDishMap, key, itemLabel);
        topBucket.quantity += quantity;
        topBucket.total = roundMoney(topBucket.total + revenue);
      }

      if (isWeightedItem(item) || Number(item.weightGrams ?? 0) > 0) {
        const grams = Number(item.weightGrams ?? 0);
        const kg = grams / 1000;
        const weightedBucket = addBucket(weightedCutMap, key, itemLabel);
        weightedBucket.quantity = roundMoney(weightedBucket.quantity + kg);
        weightedBucket.total = roundMoney(weightedBucket.total + revenue);
        totalKgSold = roundMoney(totalKgSold + kg);
      }

      if (beverageItem) {
        const beverageBucket = addBucket(beverageMap, key, itemLabel);
        beverageBucket.quantity += quantity;
        beverageBucket.total = roundMoney(beverageBucket.total + revenue);
        totalBeveragesSold += quantity;
      }
    }

    for (const expense of getOrderExpenses(order)) {
      if (isContainerExpense(expense)) {
        const quantity = normalizeContainerQuantity(expense.quantity);
        const containerBucket = addBucket(containerMap, expense.description ?? CONTAINER_EXPENSE_DESCRIPTION, CONTAINER_EXPENSE_DESCRIPTION);
        containerBucket.quantity += quantity;
        containerBucket.total = roundMoney(containerBucket.total + Number(expense.amount ?? 0));
        totalContainersSold += quantity;
        const containerDay = containerHistoryMap.get(orderDateKey) ?? {
          date: orderDateKey,
          label: orderDateKey === todayKey ? "Hoy" : formatCalendarDayLabel(orderDateKey),
          quantity: 0,
          total: 0,
        };
        containerDay.quantity += quantity;
        containerDay.total = roundMoney(containerDay.total + Number(expense.amount ?? 0));
        containerHistoryMap.set(orderDateKey, containerDay);
        continue;
      }

      const label = `${expense?.description ?? ""}`.trim() || "Producto adicional";
      const extraBucket = addBucket(extraMap, label, label);
      extraBucket.quantity += 1;
      extraBucket.total = roundMoney(extraBucket.total + Number(expense.amount ?? 0));
    }
  }

  const paidTodayRows = [...paidByDate.values()]
    .sort((left, right) => right.date.localeCompare(left.date));

  const historyRowsByRange = (() => {
    if (statsRange === "hoy") {
      return paidTodayRows.filter((row) => row.date === todayKey).slice(0, 1);
    }

    if (statsRange === "ayer") {
      return paidTodayRows.filter((row) => row.date === yesterdayKey).slice(0, 1);
    }

    if (statsRange === "semana") {
      const fromHistory = (Array.isArray(historyGrouped) ? historyGrouped : []).map((entry) => {
        const orders = (Array.isArray(entry.orders) ? entry.orders : []).filter((order) => order.status === "paid");
        const sales = orders.reduce((acc, order) => acc + getDashboardPaymentMovements(order).reduce((sum, movement) => sum + Number(movement.amount ?? 0), 0), 0);
        return {
          date: entry.date,
          label: entry.date === todayKey ? "Hoy" : entry.date === yesterdayKey ? "Ayer" : formatCalendarDayLabel(entry.date),
          sales: roundMoney(sales),
          orders: orders.length,
        };
      });
      return fromHistory.length > 0 ? fromHistory : paidTodayRows;
    }

    if (statsRange === "mes") {
      return (Array.isArray(dailyStats?.calendarDays) ? dailyStats.calendarDays : []).map((day) => ({
        date: day.date,
        label: day.date === todayKey ? "Hoy" : day.label,
        sales: roundMoney(day.totalSales ?? 0),
        orders: Number(day.paidOrders ?? 0),
      }));
    }

    if (statsRange === "año") {
      return (Array.isArray(allTimeStats?.quincenas) ? allTimeStats.quincenas : []).map((bucket) => ({
        date: bucket.id,
        label: bucket.label,
        sales: roundMoney(bucket.totalSales ?? 0),
        orders: Number(bucket.orders ?? 0),
      }));
    }

    if (statsRange === "personalizado") {
      const customOrders = (Array.isArray(historyOrders) ? historyOrders : []).filter((order) => order.status === "paid");
      const sales = customOrders.reduce((acc, order) => acc + getDashboardPaymentMovements(order).reduce((sum, movement) => sum + Number(movement.amount ?? 0), 0), 0);
      return [
        {
          date: historyDate,
          label: formatCalendarDayLabel(historyDate),
          sales: roundMoney(sales),
          orders: customOrders.length,
        },
      ].filter((row) => row.orders > 0 || row.sales > 0);
    }

    return paidTodayRows;
  })();

  const historyComparisonRows = historyRowsByRange.length > 0 ? historyRowsByRange : paidTodayRows.slice(0, 6);
  const paymentRows = [...paymentMap.values()].sort((left, right) => right.total - left.total);

  const allDishes = [...topDishMap.values()].sort((left, right) => right.quantity - left.quantity || right.total - left.total);
  const topDishes = allDishes.slice(0, 5);
  const topDishes10 = allDishes.slice(0, 10);
  const weightedCuts = [...weightedCutMap.values()].sort((left, right) => right.quantity - left.quantity || right.total - left.total).slice(0, 5);
  const beverages = [...beverageMap.values()].sort((left, right) => right.quantity - left.quantity || right.total - left.total).slice(0, 5);
  const containers = [...containerMap.values()].sort((left, right) => right.quantity - left.quantity || right.total - left.total).slice(0, 5);
  const extras = [...extraMap.values()].sort((left, right) => right.quantity - left.quantity || right.total - left.total).slice(0, 5);

  const totalPaidOrders = paidOrdersList.length;
  const totalSalesToday = roundMoney(todaySales);
  const efectivoToday = roundMoney(paymentMap.get("efectivo")?.total ?? 0);
  const transferenciaToday = roundMoney(paymentMap.get("transferencia")?.total ?? 0);
  const paymentTotal = roundMoney(paymentRows.reduce((acc, row) => acc + Number(row.total ?? 0), 0));
  const containerRevenue = roundMoney(containers.reduce((acc, row) => acc + Number(row.total ?? 0), 0));
  const beverageRevenue = roundMoney(beverages.reduce((acc, row) => acc + Number(row.total ?? 0), 0));
  const hasClosedReport = Boolean(cashClose?.closedAt);
  const registeredTotal = hasClosedReport
    ? roundMoney(cashClose?.total ?? 0)
    : paymentTotal;
  const openingCash = Number(cashClose?.openingCash ?? cashSession?.openingCash ?? 0);
  const expectedCash = hasClosedReport
    ? roundMoney(cashClose?.expectedCash ?? 0)
    : roundMoney(efectivoToday);
  const expectedTransfer = hasClosedReport
    ? roundMoney(cashClose?.expectedTransfer ?? 0)
    : roundMoney(transferenciaToday);
  const expectedTotal = hasClosedReport
    ? roundMoney(cashClose?.expectedTotal ?? expectedCash + expectedTransfer)
    : roundMoney(expectedCash + expectedTransfer);
  const countedCash = cashClose?.countedCash ?? null;
  const countedTransfer = cashClose?.countedTransfer ?? null;
  const countedTotal =
    countedCash != null || countedTransfer != null
      ? roundMoney(Number(countedCash ?? 0) + Number(countedTransfer ?? 0))
      : null;
  const differenceTotal =
    cashClose?.differenceTotal ??
    (countedTotal != null ? roundMoney(countedTotal - expectedTotal) : null);
  const cashStatus =
    cashClose?.status ??
    (differenceTotal != null ? getCashCloseStatus(differenceTotal) : null);
  const effectivePendingClosingReport =
    pendingClosingReport ??
    (cashClose?.closedAt && paidOrdersList.length > 0
        ? {
            ...cashClose,
            openingCash,
            efectivo: Number(cashClose?.efectivo ?? efectivoToday),
            transferencia: Number(cashClose?.transferencia ?? transferenciaToday),
            totalSold: registeredTotal,
            expectedCash,
            expectedTransfer,
            expectedTotal,
            countedCash,
            countedTransfer,
            countedTotal,
            differenceTotal,
            status: cashStatus,
            adminConfirmed: false,
            closedAt: cashClose.closedAt,
          }
        : null);
  const closingHistory = Array.isArray(cashSession?.closingHistory)
    ? cashSession.closingHistory
    : [];

  return {
    hasData: paidOrdersList.length > 0 || historyComparisonRows.length > 0,
    summaryCards: [
      { icon: "💰", label: "Ventas Jornada", value: totalSalesToday, hint: `${totalPaidOrders} pedidos pagados desde el último cierre`, tone: "warm" },
      { icon: "💵", label: "Efectivo", value: efectivoToday, hint: "Cobros reales en caja", tone: "cash" },
      { icon: "🏦", label: "Transferencia", value: transferenciaToday, hint: "Cobros por transferencia", tone: "transfer" },
      { icon: "🧾", label: "Total Pedidos", value: totalPaidOrders, hint: "Solo pagados en la jornada", tone: "muted", plain: true },
      { icon: "📦", label: "Contenedores", value: totalContainersSold, hint: `${formatCurrency(containerRevenue)} cobrados`, tone: "muted", plain: true, suffix: "vendidos" },
      { icon: "🥤", label: "Bebidas", value: totalBeveragesSold, hint: `${formatCurrency(beverageRevenue)} cobrados`, tone: "muted", plain: true, suffix: "vendidas" },
    ],
    paymentRows,
    paymentTotal,
    topDishes,
    topDishes10,
    allDishes,
    weightedCuts,
    totalKgSold,
    beverages,
    containers,
    containerHistoryRows: [...containerHistoryMap.values()].sort((left, right) => right.date.localeCompare(left.date)),
    extras,
    historyComparisonRows,
    totalSalesToday,
    efectivoToday,
    transferenciaToday,
    totalPaidOrders,
    cashSummary: {
      openingCash,
      expectedCash,
      expectedTransfer,
      expectedTotal,
      registeredTotal,
      countedCash,
      countedTransfer,
      countedTotal,
      matches: cashClose?.matches ?? (differenceTotal != null ? differenceTotal === 0 : null),
      differenceCash: cashClose?.differenceCash ?? null,
      differenceTransfer: cashClose?.differenceTransfer ?? null,
      differenceTotal,
      status: cashStatus,
      closedAt: cashClose?.closedAt ?? null,
      pendingClosingReport: effectivePendingClosingReport,
      pendingAdminConfirmation: Boolean(effectivePendingClosingReport),
      closingHistory,
    },
    paidTodayRows,
  };
}

function getBogotaDateKey(date = new Date()) {
  const safeDate = normalizeDateForFormatting(date);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BOGOTA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(safeDate);
}

function getBogotaDayRange(date = new Date()) {
  const safeDate = normalizeDateForFormatting(date);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BOGOTA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(safeDate);

  const year = Number(parts.find((part) => part.type === "year")?.value ?? 0);
  const month = Number(parts.find((part) => part.type === "month")?.value ?? 0);
  const day = Number(parts.find((part) => part.type === "day")?.value ?? 0);

  return {
    from: new Date(Date.UTC(year, month - 1, day, 5, 0, 0, 0)).toISOString(),
    to: new Date(Date.UTC(year, month - 1, day + 1, 4, 59, 59, 999)).toISOString(),
    key: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  };
}

function getHistoricalRange() {
  return {
    from: "2000-01-01T00:00:00.000Z",
    to: "2100-01-01T00:00:00.000Z",
  };
}

const CASH_SESSION_CUTOFF_STORAGE_KEY = "barril.cashSessionCutoff";

function loadCashSessionCutoff() {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(CASH_SESSION_CUTOFF_STORAGE_KEY) ?? "";
}

function saveCashSessionCutoff(value) {
  if (typeof window === "undefined") return;
  if (value) {
    window.localStorage.setItem(CASH_SESSION_CUTOFF_STORAGE_KEY, value);
  } else {
    window.localStorage.removeItem(CASH_SESSION_CUTOFF_STORAGE_KEY);
  }
}

function filterOrdersByCashSession(orders, cutoff) {
  if (!cutoff) return Array.isArray(orders) ? orders : [];
  return (Array.isArray(orders) ? orders : []).filter(
    (order) => {
      const movementAt = order?.paidAt ?? order?.createdAt;
      return !movementAt || movementAt >= cutoff;
    },
  );
}

function filterOrdersForPendingClosing(orders, cashSession) {
  const report = cashSession?.closingReport;
  if (!report || report.adminConfirmed || !report.closedAt) {
    return filterOrdersByCashSession(orders, loadCashSessionCutoff());
  }

  const previousCloseAt = (Array.isArray(cashSession.closingHistory)
    ? cashSession.closingHistory
    : []
  ).reduce((latest, entry) => {
    if (!entry?.adminConfirmed || !entry.closedAt) return latest;
    return !latest || entry.closedAt > latest ? entry.closedAt : latest;
  }, "");

  return (Array.isArray(orders) ? orders : []).filter((order) => {
    if (order?.status !== "paid") return false;
    const movementAt = order?.paidAt ?? order?.createdAt;
    if (!movementAt) return false;
    return movementAt <= report.closedAt && (!previousCloseAt || movementAt > previousCloseAt);
  });
}

function hasActivePendingClosing(cashSession, sessionKey) {
  if (!cashSession || cashSession.sessionKey !== sessionKey) return false;
  return Boolean(
    cashSession.closingReport &&
      !cashSession.closingReport.adminConfirmed &&
      cashSession.closingReport.closedAt,
  );
}

function getLastConfirmedCloseAt(cashSession) {
  return (Array.isArray(cashSession?.closingHistory) ? cashSession.closingHistory : [])
    .reduce((latest, entry) => {
      if (!entry?.adminConfirmed || !entry.closedAt) return latest;
      return !latest || entry.closedAt > latest ? entry.closedAt : latest;
    }, "");
}

function filterPaidOrdersForCurrentJornada(orders, cashSession) {
  const previousCloseAt = getLastConfirmedCloseAt(cashSession);
  return (Array.isArray(orders) ? orders : []).filter((order) => {
    if (order?.status !== "paid") return false;
    const movementAt = order?.paidAt ?? order?.createdAt;
    if (!movementAt) return false;
    return !previousCloseAt || movementAt > previousCloseAt;
  });
}

function buildCashCloseFromOrders(orders, date, openingCash = 0) {
  const uniqueOrders = new Set();

  const summary = (Array.isArray(orders) ? orders : []).reduce(
    (acc, order) => {
      const totals = getOrderPaymentTotals(order);
      const orderTotal = totals.efectivo + totals.transferencia;

      if (orderTotal <= 0) {
        return acc;
      }

      uniqueOrders.add(order.id);
      acc.total += orderTotal;
      acc.efectivo += totals.efectivo;
      acc.transferencia += totals.transferencia;
      return acc;
    },
    { total: 0, efectivo: 0, transferencia: 0 },
  );

  return {
    date,
    total: summary.total,
    efectivo: summary.efectivo,
    transferencia: summary.transferencia,
    orders: uniqueOrders.size,
    openingCash: Number.isFinite(Number(openingCash)) ? Number(openingCash) : 0,
  };
}

function App() {
  const [activeView, setActiveView] = useState("cash");
  const [restaurantName, setRestaurantName] = useState("Ahumados Al Barril");
  const [pendingOrders, setPendingOrders] = useState([]);
  const [paidOrders, setPaidOrders] = useState([]);
  const [waiters, setWaiters] = useState([]);
  const [waiterNameDraft, setWaiterNameDraft] = useState("");
  const [query, setQuery] = useState("");
  const [payingOrder, setPayingOrder] = useState(null);
  const [selectedPaidOrder, setSelectedPaidOrder] = useState(null);
  const [paymentDraft, setPaymentDraft] = useState({
    paymentMethod: "efectivo",
    amount: "",
    tenderedAmount: "",
    transferenceNumber: "",
    serviceType: "mesa",
  });
  const [dailyStats, setDailyStats] = useState({
    totalOrders: 0,
    totalPaidOrders: 0,
    totalSales: 0,
    containerSummary: {
      quantity: 0,
      revenue: 0,
    },
    monthLabel: "",
    rangeLabel: "",
    monthStartWeekday: 0,
    topDishes: [],
    bottomDishes: [],
    categories: [],
    paymentSummary: [],
    quincenas: [],
    calendarDays: [],
  });
  const [allTimeStats, setAllTimeStats] = useState({
    totalOrders: 0,
    totalPaidOrders: 0,
    totalSales: 0,
    containerSummary: {
      quantity: 0,
      revenue: 0,
    },
    monthLabel: "",
    rangeLabel: "",
    monthStartWeekday: 0,
    topDishes: [],
    bottomDishes: [],
    categories: [],
    paymentSummary: [],
    quincenas: [],
    calendarDays: [],
  });
  const [statsSummary, setStatsSummary] = useState({
    today: {
      efectivo: 0,
      transferencia: 0,
      total: 0,
    },
    historical: {
      efectivo: 0,
      transferencia: 0,
      total: 0,
    },
  });
  const [cashClose, setCashClose] = useState({
    date: "",
    total: 0,
    efectivo: 0,
    transferencia: 0,
    orders: 0,
    openingCash: 0,
    expectedCash: 0,
    countedCash: null,
    countedTransfer: null,
    matches: null,
    differenceCash: null,
    differenceTransfer: null,
    closedAt: null,
  });
  const [cashSession, setCashSession] = useState({
    openingCash: 0,
    openingConfirmed: false,
    closingReport: null,
    closingHistory: [],
    sessionKey: null,
  });
  const [cashSessionCutoff, setCashSessionCutoff] = useState(() =>
    loadCashSessionCutoff(),
  );
  const [historyDate, setHistoryDate] = useState(() => getBogotaDateKey());
  const [historyOrders, setHistoryOrders] = useState([]);
  const [historyGrouped, setHistoryGrouped] = useState([]);
  const [statsRange, setStatsRange] = useState("semana");
  const [publicTab, setPublicTab] = useState("jornada");
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [loading, setLoading] = useState(false);
  const [expandedDays, setExpandedDays] = useState({});
  const [bogotaDayKey, setBogotaDayKey] = useState(() => getBogotaDateKey());
  const [apiBaseUrl, setApiBaseUrl] = useState(getApiBaseUrl());
  const [networkInfo, setNetworkInfo] = useState({
    localIp: "",
    localApiUrl: "",
    publicApiUrl: "",
  });
  const [tunnelStatus, setTunnelStatus] = useState({
    status: "stopped",
    publicUrl: "",
    error: "",
    startedAt: null,
  });
  const [publicApiDraft, setPublicApiDraft] = useState("");
  const [restaurantNameDraft, setRestaurantNameDraft] = useState("");
  const [networkStatus, setNetworkStatus] = useState("");
  const [waiterStatus, setWaiterStatus] = useState("");
  const [autoPrintEnabled, setAutoPrintEnabled] = useState(true);
  const [confirmModal, setConfirmModal] = useState(null);
  const [protectedViewModal, setProtectedViewModal] = useState(null);
  const [dashboardLinkUnlocked, setDashboardLinkUnlocked] = useState(false);
  const [publicRemoteAccessUnlocked, setPublicRemoteAccessUnlocked] = useState(
    () => isPublicDashboardPinSessionValid(),
  );
  const [publicAccessPin, setPublicAccessPin] = useState("");
  const [publicAccessError, setPublicAccessError] = useState("");
  const [openingCashModal, setOpeningCashModal] = useState(null);
  const [closingCashModal, setClosingCashModal] = useState(null);
  const [deleteOrderModal, setDeleteOrderModal] = useState(null);
  const [weightModalOrder, setWeightModalOrder] = useState(null);
  const [weightDrafts, setWeightDrafts] = useState({});
  const [expenseModalOrder, setExpenseModalOrder] = useState(null);
  const [expenseDrafts, setExpenseDrafts] = useState([]);
  const [expenseModalError, setExpenseModalError] = useState("");
  const [restoreFileInputKey, setRestoreFileInputKey] = useState(Date.now());
  const [dayDetailModal, setDayDetailModal] = useState(null);
  const [cleanupDateInput, setCleanupDateInput] = useState("2026-01-01");
  const [cashSessionHydrated, setCashSessionHydrated] = useState(false);
  const legacyPendingFinalizedRef = useRef(false);
  const [publicBackendConnected, setPublicBackendConnected] = useState(false);
  const [branchSiteId, setBranchSiteId] = useState("");
  const [branchSiteDraft, setBranchSiteDraft] = useState("");
  const [branchSiteConfigured, setBranchSiteConfigured] = useState(false);
  const [ownerUrlDrafts, setOwnerUrlDrafts] = useState({
    portoviejo: "",
    chone: "",
  });
  const [activePublicSite, setActivePublicSite] = useState(
    COMBINED_PUBLIC_SITE_ID,
  );
  const [publicSiteRuntime, setPublicSiteRuntime] = useState(() =>
    createInitialPublicSiteRuntime(),
  );
  const publicPagesView = isPublicPagesView();
  const publicDashboardMode = publicPagesView ? getPublicDashboardMode() : "local";
  const stats = publicPagesView ? allTimeStats : dailyStats;
  const publicBackendUrl = normalizePublicBackendUrl(
    publicApiDraft || networkInfo.publicApiUrl,
  );
  const meseroConnectionUrl =
    tunnelStatus.status === "running" && publicBackendUrl
      ? publicBackendUrl
      : networkInfo.localApiUrl || "";
  const meseroUsesTunnel =
    Boolean(publicBackendUrl) &&
    meseroConnectionUrl === publicBackendUrl &&
    tunnelStatus.status === "running";
  const publicDashboardUrl =
    branchSiteConfigured && publicBackendUrl
      ? buildBranchPublicDashboardUrl(publicBackendUrl, branchSiteId)
      : "";
  const masterPublicDashboardUrl =
    networkInfo.permanentMasterDashboardUrl ||
    (networkInfo.tunnelRegistryConfigured || hasTunnelRegistryUrl()
      ? buildFreeMasterPublicDashboardUrl()
      : buildMasterPublicDashboardUrl(networkInfo.ownerDashboardUrls ?? {}));
  const permanentLinkReady =
    Boolean(networkInfo.permanentLinkReady) ||
    Boolean(networkInfo.tunnelRegistryConfigured) ||
    hasTunnelRegistryUrl() ||
    hasPresetFixedSiteUrls();

  useEffect(() => {
    const timer = window.setInterval(() => {
      setBogotaDayKey(getBogotaDateKey());
    }, 60000);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (activeView !== "network") {
      setDashboardLinkUnlocked(false);
    }
  }, [activeView]);

  useEffect(() => {
    if (!dashboardLinkUnlocked || activeView !== "network") return undefined;

    const timer = window.setTimeout(() => {
      setDashboardLinkUnlocked(false);
    }, ADMIN_SENSITIVE_LINKS_TIMEOUT_MS);

    return () => window.clearTimeout(timer);
  }, [activeView, dashboardLinkUnlocked]);

  useEffect(() => {
    if (publicPagesView) return;
    if (!cashSessionHydrated) return;

    if (cashSession.sessionKey !== bogotaDayKey) {
      setCashSession((current) =>
        current.sessionKey === bogotaDayKey
          ? current
          : {
              ...current,
              openingCash: 0,
              openingConfirmed: false,
              closingReport: null,
              sessionKey: bogotaDayKey,
            },
      );
    }
  }, [bogotaDayKey, cashSession.sessionKey, cashSessionHydrated, publicPagesView]);

  useEffect(() => {
    if (publicPagesView || !cashSessionHydrated || legacyPendingFinalizedRef.current) {
      return;
    }

    const report = cashSession.closingReport;
    if (!report || report.adminConfirmed || !report.closedAt) return;

    legacyPendingFinalizedRef.current = true;
    const reportForHistory = { ...report };
    delete reportForHistory.reviewPaidOrders;
    const closingHistory = [
      {
        ...reportForHistory,
        adminConfirmed: true,
        confirmedAt: report.confirmedAt ?? new Date().toISOString(),
      },
      ...(Array.isArray(cashSession.closingHistory) ? cashSession.closingHistory : []),
    ].slice(0, 100);

    void startNewDay({ closingHistory }).then(() => {
      setNetworkStatus("Cierre pendiente anterior finalizado. Jornada nueva iniciada.");
    });
  }, [
    cashSession.closingHistory,
    cashSession.closingReport,
    cashSessionHydrated,
    publicPagesView,
  ]);

  function requestProtectedView(view) {
    if (publicPagesView) {
      setActiveView(view);
      return;
    }

    setProtectedViewModal({
      targetView: view,
      pin: "",
      error: "",
      loading: false,
    });
  }

  function requestDashboardLinkAccess() {
    setProtectedViewModal({
      targetView: ADMIN_DASHBOARD_LINK_TARGET,
      pin: "",
      error: "",
      loading: false,
    });
  }

  function lockSensitiveDashboardLinks() {
    setDashboardLinkUnlocked(false);
  }

  function confirmPublicRemoteAccess() {
    const pin = `${publicAccessPin ?? ""}`.trim();
    if (pin !== STATS_ACCESS_PIN) {
      setPublicAccessError("PIN incorrecto. Solo el administrador puede entrar.");
      return;
    }

    markPublicDashboardPinSession();
    setPublicRemoteAccessUnlocked(true);
    setPublicAccessPin("");
    setPublicAccessError("");
  }

  function lockPublicRemoteAccess() {
    clearPublicDashboardPinSession();
    setPublicRemoteAccessUnlocked(false);
    setPublicAccessPin("");
    setPublicAccessError("");
  }

  function getProtectedViewCopy(targetView) {
    return (
      PROTECTED_VIEW_COPY[targetView] ?? {
        title: "Acceso administrativo",
        note: "Ingresa el PIN de administrador para continuar.",
      }
    );
  }

  function confirmProtectedView() {
    if (!protectedViewModal) return;

    const pin = `${protectedViewModal.pin ?? ""}`.trim();
    if (pin !== STATS_ACCESS_PIN) {
      setProtectedViewModal((current) =>
        current
          ? { ...current, error: "PIN incorrecto. Vuelve a intentarlo." }
          : current,
      );
      return;
    }

    if (protectedViewModal.targetView === ADMIN_DASHBOARD_LINK_TARGET) {
      setDashboardLinkUnlocked(true);
      setProtectedViewModal(null);
      return;
    }

    setActiveView(protectedViewModal.targetView);
    setProtectedViewModal(null);
  }

  async function confirmOpeningCash() {
    if (!openingCashModal) return;

    if (`${openingCashModal.amount ?? ""}`.trim() === "") {
      setOpeningCashModal((current) =>
        current ? { ...current, loading: false, error: "Ingresa el efectivo inicial." } : current,
      );
      return;
    }

    const amount = parseMoneyInput(openingCashModal.amount);
    setOpeningCashModal((current) =>
      current ? { ...current, loading: true, error: "" } : current,
    );

    try {
      const nextSession = await getJson("/api/settings/cash-session", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          openingCash: amount,
          openingConfirmed: true,
          sessionKey: bogotaDayKey,
        }),
      });
      const normalizedSession = normalizeCashSession(nextSession);
      setCashSession(normalizedSession);
      setCashClose((current) => ({
        ...current,
        openingCash: normalizedSession.openingCash,
        expectedCash: roundMoney(
          normalizedSession.openingCash + Number(current.efectivo ?? 0),
        ),
      }));
      setOpeningCashModal(null);
      void loadCashView({ silent: true }).catch(() => {});
    } catch (error) {
      setOpeningCashModal((current) =>
        current ? { ...current, loading: false, error: error.message } : current,
      );
    }
  }

  function openClosingCashModal() {
    setClosingCashModal({
      openingCash: `${cashSession.openingCash ?? cashClose.openingCash ?? 0}`,
      countedCash: "",
      countedTransfer: "",
      error: "",
      loading: false,
    });
  }

  async function confirmClosingCash() {
    if (!closingCashModal) return;

    if (
      `${closingCashModal.openingCash ?? ""}`.trim() === "" ||
      `${closingCashModal.countedCash ?? ""}`.trim() === "" ||
      `${closingCashModal.countedTransfer ?? ""}`.trim() === ""
    ) {
      setClosingCashModal((current) =>
        current ? { ...current, loading: false, error: "Completa caja inicial, efectivo y transferencia." } : current,
      );
      return;
    }

    const countedCash = parseMoneyInput(closingCashModal.countedCash);
    const countedTransfer = parseMoneyInput(closingCashModal.countedTransfer);
    const closedAt = new Date().toISOString();
    setClosingCashModal((current) =>
      current ? { ...current, loading: true, error: "" } : current,
    );

    try {
      const allPaidOrders = await getJson("/api/orders?status=paid").catch(
        () => paidOrdersForStats,
      );
      const reviewPaidOrders = filterPaidOrdersForCurrentJornada(
        allPaidOrders,
        cashSession,
      );
      const reviewPayments = reviewPaidOrders.reduce(
        (acc, order) => {
          for (const movement of getDashboardPaymentMovements(order)) {
            if (movement.paymentMethod === "efectivo") {
              acc.efectivo = roundMoney(
                acc.efectivo + Number(movement.amount ?? 0),
              );
            }
            if (movement.paymentMethod === "transferencia") {
              acc.transferencia = roundMoney(
                acc.transferencia + Number(movement.amount ?? 0),
              );
            }
          }
          return acc;
        },
        { efectivo: 0, transferencia: 0 },
      );
      const efectivo =
        reviewPaidOrders.length > 0
          ? reviewPayments.efectivo
          : closingPreview.efectivo;
      const transferencia =
        reviewPaidOrders.length > 0
          ? reviewPayments.transferencia
          : closingPreview.transferencia;
      const expectedCash = roundMoney(efectivo);
      const expectedTransfer = roundMoney(transferencia);
      const expectedTotal = roundMoney(expectedCash + expectedTransfer);
      const countedTotal = roundMoney(countedCash + countedTransfer);
      const differenceCash = roundMoney(countedCash - expectedCash);
      const differenceTransfer = roundMoney(countedTransfer - expectedTransfer);
      const differenceTotal = roundMoney(countedTotal - expectedTotal);
      const closingReport = {
        id: `close-${Date.now()}`,
        date: bogotaDayKey,
        openingCash: parseMoneyInput(closingCashModal.openingCash),
        efectivo,
        transferencia,
        totalSold: expectedTotal,
        countedCash,
        countedTransfer,
        expectedCash,
        expectedTransfer,
        expectedTotal,
        countedTotal,
        differenceCash,
        differenceTransfer,
        differenceTotal,
        matches: differenceTotal === 0,
        adminConfirmed: true,
        confirmedAt: closedAt,
        reviewPaidOrders,
        status: getCashCloseStatus(differenceTotal),
        closedAt,
      };

      const reportForHistory = { ...closingReport };
      delete reportForHistory.reviewPaidOrders;
      const closingHistory = [
        reportForHistory,
        ...(Array.isArray(cashSession.closingHistory)
          ? cashSession.closingHistory
          : []),
      ].slice(0, 100);

      setClosingCashModal(null);
      await startNewDay({ closingHistory });
      setNetworkStatus("Cierre de caja realizado. La jornada actual quedó limpia.");
    } catch (error) {
      setClosingCashModal((current) =>
        current ? { ...current, loading: false, error: error.message } : current,
      );
    }
  }

  function resolveApiRequestUrl(url) {
    if (/^https?:\/\//i.test(url)) {
      return url;
    }

    return new URL(url, apiBaseUrl.endsWith("/") ? apiBaseUrl : `${apiBaseUrl}/`).toString();
  }

  function persistPublicDashboardSnapshot(snapshot) {
    if (!publicPagesView) return;

    writePublicDashboardSnapshot({
      savedAt: new Date().toISOString(),
      ...snapshot,
    });
  }

  function hydratePublicDashboardSnapshot() {
    if (!publicPagesView) return false;

    const snapshot = readPublicDashboardSnapshot();
    if (!snapshot) return false;
    const normalizedSnapshotSession = snapshot.cashSession
      ? normalizeCashSession(snapshot.cashSession)
      : null;

    if (Array.isArray(snapshot.pendingOrders)) {
      setPendingOrders(
        publicPagesView
          ? snapshot.pendingOrders
          : filterOrdersByCashSession(snapshot.pendingOrders, cashSessionCutoff),
      );
    }
    if (Array.isArray(snapshot.paidOrders)) {
      setPaidOrders(
        publicPagesView
          ? hasActivePendingClosing(normalizedSnapshotSession, bogotaDayKey)
            ? filterOrdersForPendingClosing(
                snapshot.paidOrders,
                normalizedSnapshotSession,
              )
            : filterPaidOrdersForCurrentJornada(
                snapshot.paidOrders,
                normalizedSnapshotSession,
              )
          : hasActivePendingClosing(normalizedSnapshotSession, bogotaDayKey)
            ? filterOrdersForPendingClosing(snapshot.paidOrders, normalizedSnapshotSession)
            : filterOrdersByCashSession(snapshot.paidOrders, cashSessionCutoff),
      );
    }
    if (snapshot.cashClose) setCashClose(snapshot.cashClose);
    if (normalizedSnapshotSession) setCashSession(normalizedSnapshotSession);
    if (snapshot.dailyStats) setDailyStats(snapshot.dailyStats);
    if (snapshot.allTimeStats) setAllTimeStats(snapshot.allTimeStats);
    if (snapshot.statsSummary) setStatsSummary(snapshot.statsSummary);
    if (Array.isArray(snapshot.historyOrders)) setHistoryOrders(snapshot.historyOrders);
    if (Array.isArray(snapshot.historyGrouped)) setHistoryGrouped(snapshot.historyGrouped);
    if (snapshot.restaurantName) {
      setRestaurantName(snapshot.restaurantName);
      setRestaurantNameDraft(snapshot.restaurantName);
    }
    if (snapshot.networkInfo) setNetworkInfo(snapshot.networkInfo);
    return true;
  }

  function applyDashboardSnapshot(snapshot) {
    if (!isDashboardSnapshot(snapshot)) return;

    const normalizedSnapshotSession = snapshot.cashSession
      ? normalizeCashSession(snapshot.cashSession)
      : null;

    if (snapshot.restaurantName) {
      setRestaurantName(snapshot.restaurantName);
      setRestaurantNameDraft(snapshot.restaurantName);
    }
    if (Array.isArray(snapshot.pendingOrders)) {
      setPendingOrders(
        publicPagesView
          ? snapshot.pendingOrders
          : filterOrdersByCashSession(snapshot.pendingOrders, cashSessionCutoff),
      );
    }
    if (Array.isArray(snapshot.paidOrders)) {
      setPaidOrders(
        publicPagesView
          ? hasActivePendingClosing(normalizedSnapshotSession, bogotaDayKey)
            ? filterOrdersForPendingClosing(
                snapshot.paidOrders,
                normalizedSnapshotSession,
              )
            : filterPaidOrdersForCurrentJornada(
                snapshot.paidOrders,
                normalizedSnapshotSession,
              )
          : hasActivePendingClosing(normalizedSnapshotSession, bogotaDayKey)
            ? filterOrdersForPendingClosing(snapshot.paidOrders, normalizedSnapshotSession)
            : filterOrdersByCashSession(snapshot.paidOrders, cashSessionCutoff),
      );
    }
    if (snapshot.cashClose) {
      const closingReport = normalizedSnapshotSession?.closingReport;
      setCashClose({
        ...snapshot.cashClose,
        openingCash:
          closingReport?.openingCash ??
          normalizedSnapshotSession?.openingCash ??
          snapshot.cashClose.openingCash ??
          0,
        expectedCash:
          closingReport?.expectedCash ??
          roundMoney(Number(snapshot.cashClose.efectivo ?? 0)),
        expectedTransfer:
          closingReport?.expectedTransfer ??
          roundMoney(Number(snapshot.cashClose.transferencia ?? 0)),
        expectedTotal:
          closingReport?.expectedTotal ??
          roundMoney(
            Number(snapshot.cashClose.efectivo ?? 0) +
              Number(snapshot.cashClose.transferencia ?? 0),
          ),
        countedCash: closingReport?.countedCash ?? null,
        countedTransfer: closingReport?.countedTransfer ?? null,
        countedTotal: closingReport?.countedTotal ?? null,
        matches: closingReport?.matches ?? null,
        differenceCash: closingReport?.differenceCash ?? null,
        differenceTransfer: closingReport?.differenceTransfer ?? null,
        differenceTotal: closingReport?.differenceTotal ?? null,
        status: closingReport?.status ?? null,
        closedAt: closingReport?.closedAt ?? null,
      });
    }
    if (normalizedSnapshotSession) setCashSession(normalizedSnapshotSession);
    if (snapshot.dailyStats) setDailyStats(snapshot.dailyStats);
    if (snapshot.allTimeStats) setAllTimeStats(snapshot.allTimeStats);
    if (snapshot.statsSummary) setStatsSummary(snapshot.statsSummary);
    if (Array.isArray(snapshot.historyOrders)) setHistoryOrders(snapshot.historyOrders);
    if (Array.isArray(snapshot.historyGrouped)) setHistoryGrouped(snapshot.historyGrouped);
    if (snapshot.networkInfo) setNetworkInfo(snapshot.networkInfo);
    persistPublicDashboardSnapshot(snapshot);
    setLoading(false);
  }

  const filteredPending = useMemo(() => {
    if (!query.trim()) return pendingOrders;
    const q = query.toLowerCase();
    return pendingOrders.filter(
      (order) =>
        order.id.toLowerCase().includes(q) ||
        order.clientName.toLowerCase().includes(q) ||
        order.tableNumber.toLowerCase().includes(q),
    );
  }, [pendingOrders, query]);

  const pickupAwaitingDispatch = useMemo(
    () => paidOrders.filter(isPickupAwaitingDispatch),
    [paidOrders],
  );

  const paidOrdersForDisplay = useMemo(
    () => paidOrders.filter((order) => !isPickupAwaitingDispatch(order)),
    [paidOrders],
  );

  const paidOrdersForStats = useMemo(
    () => paidOrders.filter((order) => order.status === "paid"),
    [paidOrders],
  );

  const dashboardStats = useMemo(
    () =>
      buildDashboardMetrics({
        paidOrders: paidOrdersForStats,
        historyGrouped,
        historyOrders,
        dailyStats,
        allTimeStats,
        cashClose,
        cashSession,
        historyDate,
        statsRange,
        sessionKey: bogotaDayKey,
      }),
    [
      allTimeStats,
      cashClose,
      cashSession,
      dailyStats,
      historyDate,
      historyGrouped,
      historyOrders,
      paidOrdersForStats,
      statsRange,
      bogotaDayKey,
    ],
  );

  const publicCombinedSiteSummaries = useMemo(() => {
    if (publicDashboardMode !== "multi") return [];

    return PUBLIC_SITES.map((site) => {
      const runtime = publicSiteRuntime[site.id];
      const snapshot = runtime?.snapshot;
      if (!snapshot) {
        return { site, runtime, metrics: null };
      }

      const paidOrdersList = Array.isArray(snapshot.paidOrders)
        ? snapshot.paidOrders.filter((order) => order.status === "paid")
        : [];
      const metrics = buildDashboardMetrics({
        paidOrders: paidOrdersList,
        historyGrouped: snapshot.historyGrouped ?? [],
        historyOrders: snapshot.historyOrders ?? [],
        dailyStats: snapshot.dailyStats ?? {},
        allTimeStats: snapshot.allTimeStats ?? {},
        cashClose: snapshot.cashClose ?? {},
        cashSession: snapshot.cashSession ?? {},
        historyDate,
        statsRange: "hoy",
        sessionKey: bogotaDayKey,
      });

      return { site, runtime, metrics };
    });
  }, [bogotaDayKey, historyDate, publicDashboardMode, publicSiteRuntime]);

  const publicCombinedTotals = useMemo(() => {
    const summaries = publicCombinedSiteSummaries.filter((entry) => entry.metrics);
    return {
      totalSalesToday: roundMoney(
        summaries.reduce(
          (acc, entry) => acc + Number(entry.metrics.totalSalesToday ?? 0),
          0,
        ),
      ),
      efectivoToday: roundMoney(
        summaries.reduce(
          (acc, entry) => acc + Number(entry.metrics.efectivoToday ?? 0),
          0,
        ),
      ),
      transferenciaToday: roundMoney(
        summaries.reduce(
          (acc, entry) => acc + Number(entry.metrics.transferenciaToday ?? 0),
          0,
        ),
      ),
      totalPaidOrders: summaries.reduce(
        (acc, entry) => acc + Number(entry.metrics.totalPaidOrders ?? 0),
        0,
      ),
      pendingOrders: summaries.reduce((acc, entry) => {
        const pendingCount = Array.isArray(entry.runtime?.snapshot?.pendingOrders)
          ? entry.runtime.snapshot.pendingOrders.length
          : 0;
        return acc + pendingCount;
      }, 0),
    };
  }, [publicCombinedSiteSummaries]);

  const closingPreview = useMemo(() => {
    const openingCash =
      closingCashModal?.openingCash != null
        ? parseMoneyInput(closingCashModal.openingCash)
        : Number(cashSession.openingCash ?? cashClose.openingCash ?? 0);
    const efectivo = Number(dashboardStats.efectivoToday ?? 0);
    const transferencia = Number(dashboardStats.transferenciaToday ?? 0);
    const countedCash =
      closingCashModal?.countedCash != null
        ? parseMoneyInput(closingCashModal.countedCash)
        : 0;
    const countedTransfer =
      closingCashModal?.countedTransfer != null
        ? parseMoneyInput(closingCashModal.countedTransfer)
        : 0;
    const expectedCash = roundMoney(efectivo);
    const expectedTransfer = roundMoney(transferencia);
    const expectedTotal = roundMoney(expectedCash + expectedTransfer);
    const countedTotal = roundMoney(countedCash + countedTransfer);
    const differenceTotal = roundMoney(countedTotal - expectedTotal);
    const status = getCashCloseStatus(differenceTotal);

    return {
      openingCash,
      efectivo,
      transferencia,
      totalSold: roundMoney(efectivo + transferencia),
      countedCash,
      countedTransfer,
      expectedCash,
      expectedTransfer,
      expectedTotal,
      countedTotal,
      differenceCash: roundMoney(countedCash - expectedCash),
      differenceTransfer: roundMoney(countedTransfer - expectedTransfer),
      differenceTotal,
      status,
    };
  }, [
    cashClose.openingCash,
    cashSession.openingCash,
    closingCashModal?.openingCash,
    closingCashModal?.countedCash,
    closingCashModal?.countedTransfer,
    dashboardStats.efectivoToday,
    dashboardStats.transferenciaToday,
  ]);

  const paymentPreview = useMemo(() => {
    if (!payingOrder) {
      return {
        paidAmount: 0,
        balanceDue: 0,
        amount: 0,
        tenderedAmount: 0,
        changeDue: 0,
        canSubmit: false,
        submitMessage: "",
      };
    }

    const paidAmount = Number(payingOrder.paidAmount ?? 0);
    const balanceDue = Number(
      payingOrder.balanceDue ?? Math.max(payingOrder.total - paidAmount, 0),
    );
    const amount = parseMoneyInput(paymentDraft.amount || `${balanceDue}`);
    const tenderedAmount =
      paymentDraft.paymentMethod === "efectivo"
        ? parseMoneyInput(paymentDraft.tenderedAmount || `${amount}`)
        : amount;
    const changeDue =
      paymentDraft.paymentMethod === "efectivo"
        ? Math.max(tenderedAmount - amount, 0)
        : 0;

    if (amount <= 0) {
      return {
        paidAmount,
        balanceDue,
        amount,
        tenderedAmount,
        changeDue,
        canSubmit: false,
        submitMessage: "El abono debe ser mayor a 0.",
      };
    }

    if (amount > balanceDue) {
      return {
        paidAmount,
        balanceDue,
        amount,
        tenderedAmount,
        changeDue,
        canSubmit: false,
        submitMessage: "El abono no puede superar el saldo pendiente.",
      };
    }

    if (paymentDraft.paymentMethod === "efectivo" && tenderedAmount < amount) {
      return {
        paidAmount,
        balanceDue,
        amount,
        tenderedAmount,
        changeDue,
        canSubmit: false,
        submitMessage: "En efectivo, recibido debe ser >= abono.",
      };
    }

    if (
      paymentDraft.paymentMethod === "transferencia" &&
      `${paymentDraft.transferenceNumber ?? ""}`.trim() === ""
    ) {
      return {
        paidAmount,
        balanceDue,
        amount,
        tenderedAmount,
        changeDue,
        canSubmit: false,
        submitMessage:
          "El número de comprobante es obligatorio en transferencia.",
      };
    }

    return {
      paidAmount,
      balanceDue,
      amount,
      tenderedAmount,
      changeDue,
      canSubmit: true,
      submitMessage: "",
    };
  }, [payingOrder, paymentDraft]);

  const hasPendingWeightValues = useMemo(() => {
    if (!weightModalOrder) return false;
    return weightModalOrder.items.some(
      (item) =>
        isWeightedItem(item) &&
        getWeightDraftValues(
          weightDrafts[item.menuItemId],
          item.quantity,
          item.weightGrams,
        ).some((value) => parseMoneyInput(value) <= 0),
    );
  }, [weightDrafts, weightModalOrder]);

  const getJson = useCallback(async (url, options) => {
    const response = await fetch(resolveApiRequestUrl(url), options);
    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      throw new Error(errorBody.message ?? "Error de servidor");
    }
    return response.json();
  }, [apiBaseUrl]);

  const loadPublicDashboardSnapshot = useCallback(async () => {
    const baseUrl = getApiBaseUrl();
    const requestUrl = new URL(
      "/api/dashboard/snapshot",
      baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`,
    ).toString();
    const response = await fetch(requestUrl);
    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      throw new Error(errorBody.message ?? "No se pudo leer el dashboard.");
    }
    const snapshot = await response.json();
    applyDashboardSnapshot(snapshot);
    setPublicBackendConnected(true);
    setNetworkStatus("");
    return snapshot;
  }, []);

  const applyPublicSiteSnapshot = useCallback((siteId, snapshot) => {
    if (!snapshot) return false;
    applyDashboardSnapshot(snapshot);
    const site = PUBLIC_SITES.find((entry) => entry.id === siteId);
    if (site && snapshot.restaurantName) {
      setRestaurantName(snapshot.restaurantName);
      setRestaurantNameDraft(snapshot.restaurantName);
    } else if (site) {
      setRestaurantName(site.name);
      setRestaurantNameDraft(site.name);
    }
    return true;
  }, []);

  const refreshPublicMultiSiteDashboard = useCallback(async () => {
    const entries = await resolvePublicSiteEntries();
    const nextRuntime = createInitialPublicSiteRuntime();
    let anyConnected = false;

    await Promise.all(
      entries.map(async (entry) => {
        if (!entry.apiUrl) {
          const cached = nextRuntime[entry.id]?.snapshot;
          nextRuntime[entry.id] = {
            connected: false,
            lastSyncAt: cached?.syncedAt ?? null,
            error: cached ? "" : "Sin URL configurada para esta sede.",
            snapshot: cached ?? null,
          };
          return;
        }

        try {
          const snapshot = await fetchPublicDashboardSnapshot(entry.apiUrl);
          const syncedAt = new Date().toISOString();
          const storedSnapshot = {
            ...snapshot,
            syncedAt,
            siteId: entry.id,
            siteName: entry.name,
          };
          writeSiteSnapshot(entry.id, storedSnapshot);
          nextRuntime[entry.id] = {
            connected: true,
            lastSyncAt: syncedAt,
            error: "",
            snapshot: storedSnapshot,
          };
          anyConnected = true;
        } catch (error) {
          const cached = nextRuntime[entry.id]?.snapshot;
          nextRuntime[entry.id] = {
            connected: false,
            lastSyncAt: cached?.syncedAt ?? null,
            error: error.message ?? "Sin conexion con el servidor.",
            snapshot: cached ?? null,
          };
        }
      }),
    );

    setPublicSiteRuntime(nextRuntime);
    setPublicBackendConnected(anyConnected);

    if (publicDashboardMode === "multi") {
      setNetworkStatus(buildMultiSiteStatusLabel(nextRuntime));
    }

    return nextRuntime;
  }, [publicDashboardMode]);

  const handlePublicSiteChange = useCallback(
    (siteId) => {
      setActivePublicSite(siteId);
      if (siteId === COMBINED_PUBLIC_SITE_ID) {
        setNetworkStatus(buildMultiSiteStatusLabel(publicSiteRuntime));
        return;
      }

      const runtime = publicSiteRuntime[siteId];
      if (applyPublicSiteSnapshot(siteId, runtime?.snapshot)) {
        setPublicBackendConnected(Boolean(runtime?.connected));
        setNetworkStatus(
          runtime?.connected
            ? ""
            : runtime?.snapshot
              ? "Sin conexion ahora (laptop apagada o tunel caido). Datos viejos en pantalla."
              : "Sin datos para esta sede. Confirma la sede en la laptop y espera el tunel.",
        );
      }
    },
    [applyPublicSiteSnapshot, publicSiteRuntime],
  );

  useEffect(() => {
    if (!publicPagesView || !publicRemoteAccessUnlocked) return undefined;

    const timer = window.setInterval(() => {
      if (!isPublicDashboardPinSessionValid()) {
        lockPublicRemoteAccess();
      }
    }, 60000);

    return () => window.clearInterval(timer);
  }, [publicPagesView, publicRemoteAccessUnlocked]);

  useEffect(() => {
    if (!publicPagesView || !publicRemoteAccessUnlocked) return;

    if (publicDashboardMode === "multi") {
      refreshPublicMultiSiteDashboard().catch(() => {
        setNetworkStatus("Sin conexion con las sedes. Mostrando ultimos estados guardados.");
      });

      const refreshTimer = window.setInterval(() => {
        refreshPublicMultiSiteDashboard().catch(() => {});
      }, 45000);

      return () => window.clearInterval(refreshTimer);
    }

    loadPublicDashboardSnapshot().catch(() => {
      if (hydratePublicDashboardSnapshot()) {
        setNetworkStatus("Sin backend activo. Mostrando el ultimo estado guardado.");
        return;
      }
      setNetworkStatus("Sin conexion con el backend publico.");
    });
  }, [
    publicDashboardMode,
    publicPagesView,
    publicRemoteAccessUnlocked,
    loadPublicDashboardSnapshot,
    refreshPublicMultiSiteDashboard,
  ]);

  const loadCashView = useCallback(async ({ silent = false, cutoff = cashSessionCutoff } = {}) => {
    if (!silent) {
      setLoading(true);
    }
    try {
      const [menuData, pending, paid, close, cashSessionResult] = await Promise.all([
        getJson("/api/menu"),
        getJson("/api/orders?status=pending"),
        getJson("/api/orders?status=paid"),
        getJson("/api/cash-close"),
        getJson("/api/settings/cash-session"),
      ]);
      const filteredPending = filterOrdersByCashSession(
        pending,
        cutoff,
      );
      const normalizedCashSession = normalizeCashSession(cashSessionResult);
      const filteredPaid =
        hasActivePendingClosing(normalizedCashSession, bogotaDayKey)
          ? filterOrdersForPendingClosing(paid, normalizedCashSession)
          : filterOrdersByCashSession(paid, cutoff);
      const closingReport = normalizedCashSession.closingReport;
      const openingCash = normalizedCashSession.openingCash;
      const filteredClose = cutoff
        ? buildCashCloseFromOrders(
            [...filteredPending, ...filteredPaid],
            cutoff,
            openingCash,
          )
        : close;
      const closeEfectivo = Number(filteredClose.efectivo ?? 0);
      const closeTransferencia = Number(filteredClose.transferencia ?? 0);
      const reconciledClose = {
        ...filteredClose,
        efectivo: closingReport?.efectivo ?? closeEfectivo,
        transferencia: closingReport?.transferencia ?? closeTransferencia,
        total: closingReport?.totalSold ?? filteredClose.total,
        openingCash: closingReport?.openingCash ?? openingCash,
        expectedCash:
          closingReport?.expectedCash ??
          roundMoney(closeEfectivo),
        expectedTransfer:
          closingReport?.expectedTransfer ??
          roundMoney(closeTransferencia),
        expectedTotal:
          closingReport?.expectedTotal ??
          roundMoney(closeEfectivo + closeTransferencia),
        countedCash: closingReport?.countedCash ?? null,
        countedTransfer: closingReport?.countedTransfer ?? null,
        countedTotal: closingReport?.countedTotal ?? null,
        matches: closingReport?.matches ?? null,
        differenceCash: closingReport?.differenceCash ?? null,
        differenceTransfer: closingReport?.differenceTransfer ?? null,
        differenceTotal: closingReport?.differenceTotal ?? null,
        status: closingReport?.status ?? null,
        closedAt: closingReport?.closedAt ?? null,
      };
      setRestaurantName(menuData.restaurantName);
      setRestaurantNameDraft(menuData.restaurantName ?? "");
      setPendingOrders(filteredPending);
      setPaidOrders(filteredPaid);
      setCashSession(normalizedCashSession);
      setCashClose(reconciledClose);
      persistPublicDashboardSnapshot({
        pendingOrders: filteredPending,
        paidOrders: filteredPaid,
        cashClose: reconciledClose,
        cashSession: normalizedCashSession,
        dailyStats,
        allTimeStats,
        statsSummary,
        historyOrders,
        historyGrouped,
        restaurantName: menuData.restaurantName,
        networkInfo,
      });
    } catch (error) {
      if (publicPagesView && hydratePublicDashboardSnapshot()) {
        setNetworkStatus("Sin backend activo. Mostrando el ultimo estado guardado.");
        return;
      }
      throw error;
    } finally {
      setCashSessionHydrated(true);
      if (!silent) {
        setLoading(false);
      }
    }
  }, [bogotaDayKey, cashSessionCutoff, getJson, publicPagesView]);

  const loadStatsView = useCallback(async () => {
    const todayRange = getBogotaDayRange();
    const historicalRange = getHistoricalRange();
    try {
      const [dailyResult, historicalResult, summaryResult] = await Promise.all([
        getJson(`/api/stats?from=${todayRange.from}&to=${todayRange.to}`),
        getJson(
          `/api/stats?from=${historicalRange.from}&to=${historicalRange.to}`,
        ),
        getJson("/api/stats-summary"),
      ]);
      const nextDailyStats = {
        ...dailyResult,
        monthLabel: "Hoy",
        rangeLabel: formatCalendarDayLabel(todayRange.key),
      };
      const nextAllTimeStats = {
        ...historicalResult,
        monthLabel: "Histórico completo",
        rangeLabel: "Todo el historial",
      };
      setDailyStats(nextDailyStats);
      setAllTimeStats(nextAllTimeStats);
      setStatsSummary(summaryResult);
      persistPublicDashboardSnapshot({
        pendingOrders,
        paidOrders,
        cashClose,
        cashSession,
        dailyStats: nextDailyStats,
        allTimeStats: nextAllTimeStats,
        statsSummary: summaryResult,
        historyOrders,
        historyGrouped,
        restaurantName,
        networkInfo,
      });
    } catch (error) {
      if (publicPagesView && hydratePublicDashboardSnapshot()) {
        setNetworkStatus("Sin backend activo. Mostrando el ultimo estado guardado.");
        return;
      }
      throw error;
    }
  }, [getJson, publicPagesView]);

  const loadWaiters = useCallback(async () => {
    const result = await getJson("/api/waiters");
    setWaiters(Array.isArray(result) ? result : []);
  }, [getJson]);

  async function saveWaiter() {
    const name = waiterNameDraft.trim().replace(/\s+/g, " ");
    if (!name) {
      setWaiterStatus("Escribe el nombre del mesero.");
      return;
    }

    const result = await getJson("/api/waiters", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });

    setWaiterNameDraft("");
    setWaiterStatus(`Mesero autorizado: ${result.displayName}`);
    await loadWaiters();
  }

  async function toggleWaiterActive(waiter, active) {
    await getJson(`/api/waiters/${encodeURIComponent(waiter.displayName)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active }),
    });

    setWaiterStatus(active ? "Mesero reactivado." : "Mesero desactivado.");
    await loadWaiters();
  }

  function confirmDeleteWaiter(waiter) {
    setConfirmModal({
      title: "Eliminar mesero",
      message: `Se eliminará a ${waiter.displayName} de la lista de meseros autorizados. Esta acción no afecta pedidos ya guardados.`,
      action: async () => {
        try {
          await getJson(`/api/waiters/${encodeURIComponent(waiter.displayName)}`, {
            method: "DELETE",
          });
          setWaiterStatus(`Mesero eliminado: ${waiter.displayName}`);
          setConfirmModal(null);
          await loadWaiters();
        } catch (error) {
          setWaiterStatus(`Error eliminando mesero: ${error.message}`);
        }
      },
      confirmText: "Eliminar mesero",
      cancelText: "Cancelar",
      isDanger: true,
    });
  }

  const loadHistoryView = useCallback(
    async (date) => {
      const result = await getJson(`/api/orders/history?date=${date}`);
      setHistoryOrders(result);
    },
    [getJson],
  );

  async function startNewDay({ closingHistory } = {}) {
    try {
      setLoading(true);
      const newCutoff = new Date().toISOString();
      setCashSessionCutoff(newCutoff);
      saveCashSessionCutoff(newCutoff);
      await getJson("/api/settings/cash-session", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          openingCash: 0,
          openingConfirmed: false,
          closingReport: null,
          ...(closingHistory ? { closingHistory } : {}),
          sessionKey: bogotaDayKey,
        }),
      });
      setCashSession((current) => ({
        ...current,
        openingCash: 0,
        openingConfirmed: false,
        closingReport: null,
        closingHistory: closingHistory ?? current.closingHistory,
      }));
      setConfirmModal(null);
      setPendingOrders([]);
      setPaidOrders([]);
      setQuery("");
      setPayingOrder(null);
      setSelectedPaidOrder(null);
      setDayDetailModal(null);
      await Promise.all([
        loadCashView({ silent: true, cutoff: newCutoff }),
        loadStatsView(),
        loadRecentHistory(7),
      ]);
      setNetworkStatus("Cierre de caja realizado. La jornada actual quedó limpia.");
    } catch (error) {
      setNetworkStatus(`Error cerrando caja: ${error.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function loadRecentHistory(days = 7) {
    setLoadingHistory(true);
    try {
      const list = [];
      for (let i = 0; i < days; i++) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const iso = getBogotaDateKey(d);
        try {
          const orders = await getJson(`/api/orders/history?date=${iso}`);
          list.push({ date: iso, orders });
        } catch {
          list.push({ date: iso, orders: [] });
        }
      }
      setHistoryGrouped(list);
    } finally {
      setLoadingHistory(false);
    }
  }

  function openPayModal(order) {
    const balanceDue = Number(
      order.balanceDue ??
        Math.max(order.total - Number(order.paidAmount ?? 0), 0),
    );
    setPayingOrder(order);
    setPaymentDraft({
      paymentMethod: "efectivo",
      amount: `${balanceDue}`,
      tenderedAmount: `${balanceDue}`,
      transferenceNumber: "",
      serviceType: normalizeServiceType(
        order.serviceType ?? inferServiceTypeFromTable(order.tableNumber),
      ),
    });
  }

  function closePayModal() {
    setPayingOrder(null);
    setPaymentDraft({
      paymentMethod: "efectivo",
      amount: "",
      tenderedAmount: "",
      transferenceNumber: "",
      serviceType: "mesa",
    });
  }

  function openWeightModal(order) {
    const drafts = order.items.reduce((acc, item) => {
      if (isWeightedItem(item)) {
        acc[item.menuItemId] = getWeightDraftValues(
          item.weightBreakdown,
          item.quantity,
          item.weightGrams,
        );
      }
      return acc;
    }, {});

    setWeightModalOrder(order);
    setWeightDrafts(drafts);
  }

  function closeWeightModal() {
    setWeightModalOrder(null);
    setWeightDrafts({});
  }

  function openExpenseModal(order, options = {}) {
    const currentExpenses = getOrderExpenses(order);
    const containerQuantity = getContainerExpenseQuantity(currentExpenses);
    const containerExpense = containerQuantity > 0 || options.includeContainer
      ? {
          description: CONTAINER_EXPENSE_DESCRIPTION,
          amount: `${getContainerExpenseTotal(containerQuantity || 1)}`,
          quantity: `${containerQuantity || 1}`,
          kind: "container",
        }
      : null;

    const regularExpenses = currentExpenses
      .filter((expense) => !isContainerExpense(expense))
      .map((expense) => ({
        description: expense.description ?? "",
        amount: `${expense.amount ?? ""}`,
        quantity: "",
        kind: expense.kind ?? null,
      }));

    setExpenseModalOrder(order);
    setExpenseModalError("");
    setExpenseDrafts(
      containerExpense
        ? [...regularExpenses, containerExpense]
        : regularExpenses.length > 0
          ? regularExpenses
          : [{ description: "", amount: "", quantity: "", kind: null }],
    );
  }

  function closeExpenseModal() {
    setExpenseModalOrder(null);
    setExpenseDrafts([]);
    setExpenseModalError("");
  }

  function updateExpenseDraft(index, field, value) {
    setExpenseModalError("");
    setExpenseDrafts((current) =>
      current.map((draft, draftIndex) =>
        draftIndex === index ? { ...draft, [field]: value } : draft,
      ),
    );
  }

  function addExpenseDraft() {
    setExpenseModalError("");
    setExpenseDrafts((current) => [
      ...current,
      { description: "", amount: "", quantity: "", kind: null },
    ]);
  }

  function openContainerModal(order) {
    openExpenseModal(order, { includeContainer: true });
  }

  function removeExpenseDraft(index) {
    setExpenseModalError("");
    setExpenseDrafts((current) =>
      current.filter((_, draftIndex) => draftIndex !== index),
    );
  }

  async function saveExpenseModal() {
    if (!expenseModalOrder) return;

    const normalizedExpenses = expenseDrafts.map((draft) =>
      draft.kind === "container"
        ? createContainerExpense(draft.quantity)
        : {
            description: `${draft.description ?? ""}`
              .trim()
              .replace(/\s+/g, " "),
            amount: parseMoneyInput(draft.amount),
            quantity: null,
            kind: null,
          },
    );

    const hasIncompleteExpense = normalizedExpenses.some(
      (expense) =>
        expense.kind !== "container" &&
        ((expense.description && expense.amount <= 0) ||
          (!expense.description && expense.amount > 0)),
    );

    const hasInvalidContainer = normalizedExpenses.some(
      (_, index) => {
        const draft = expenseDrafts[index];
        if (draft?.kind !== "container") return false;
        return Math.floor(Number(draft.quantity) || 0) <= 0;
      },
    );

    if (hasIncompleteExpense || hasInvalidContainer) {
      setExpenseModalError(
        "Completa la descripción y el valor de cada gasto antes de guardar.",
      );
      return;
    }

    const nextExpenses = normalizedExpenses.filter(
      (expense) => expense.description && expense.amount > 0,
    );

    const updatedOrder = await getJson(`/api/orders/${expenseModalOrder.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientName: expenseModalOrder.clientName,
        tableNumber: expenseModalOrder.tableNumber,
        waiterName: expenseModalOrder.waiterName,
        items: expenseModalOrder.items,
        expenses: nextExpenses,
      }),
    });

    setExpenseModalOrder(updatedOrder);
    closeExpenseModal();
    await Promise.all([
      loadCashView(),
      loadStatsView(),
      loadHistoryView(historyDate),
    ]);
  }

  async function saveWeightModal() {
    if (!weightModalOrder) return;

    const nextItems = weightModalOrder.items.map((item) => {
      if (!isWeightedItem(item)) return item;

      const gramsPerUnit = getWeightDraftValues(
        weightDrafts[item.menuItemId],
        item.quantity,
        item.weightGrams,
      ).map((value) => parseMoneyInput(value));
      const weightFormula = resolveWeightFormulaForOrderItem(item);
      const unitPrices = gramsPerUnit.map((grams) =>
        grams > 0 ? calculateWeightedCutPrice(grams, weightFormula) : 0,
      );
      const subtotal = unitPrices.reduce((acc, value) => acc + value, 0);
      const totalWeight = gramsPerUnit.reduce((acc, value) => acc + value, 0);
      return {
        ...item,
        weightFormula,
        weightGrams: totalWeight > 0 ? totalWeight : null,
        weightBreakdown: gramsPerUnit,
        unitPrice:
          gramsPerUnit.length > 0
            ? Math.round(
                ((subtotal / gramsPerUnit.length) + Number.EPSILON) * 100,
              ) / 100
            : 0,
        subtotal: Math.round((subtotal + Number.EPSILON) * 100) / 100,
      };
    });

    try {
      const updatedOrder = await getJson(`/api/orders/${weightModalOrder.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientName: weightModalOrder.clientName,
          tableNumber: weightModalOrder.tableNumber,
          serviceType: weightModalOrder.serviceType,
          waiterName: weightModalOrder.waiterName,
          items: nextItems,
        }),
      });

      setWeightModalOrder(updatedOrder);
      closeWeightModal();
      await Promise.all([
        loadCashView(),
        loadStatsView(),
        loadHistoryView(historyDate),
      ]);
    } catch (error) {
      window.alert(error.message ?? "No se pudo guardar el gramaje.");
    }
  }

  async function markOrderDispatched(order) {
    if (!order?.id) return;

    if (!isKitchenReadyForDispatch(order)) {
      window.alert(
        "La cocina aun no ha terminado este pedido. Espera a que la marquen como lista.",
      );
      return;
    }

    const confirmed = window.confirm(
      `Marcar como despachado ${order.id} (${order.clientName})? Desaparecera de esta pantalla.`,
    );
    if (!confirmed) return;

    try {
      await getJson(
        `/api/orders/${encodeURIComponent(order.id)}/dispatch`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
        },
      );
    } catch (error) {
      window.alert(
        error.message ?? "No se pudo marcar la comanda como despachada.",
      );
      return;
    }

    try {
      await Promise.all([
        loadCashView(),
        loadStatsView(),
        loadHistoryView(historyDate),
      ]);
    } catch {
      await loadCashView().catch(() => {});
      window.alert(
        "Comanda despachada, pero fallo al refrescar algunas vistas. Recarga con F5.",
      );
    }
  }

  async function registerPayment() {
    if (!payingOrder || !paymentPreview.canSubmit) return;

    const payload = {
      paymentMethod: paymentDraft.paymentMethod,
      amount: paymentPreview.amount,
      serviceType: normalizeServiceType(paymentDraft.serviceType),
      tenderedAmount:
        paymentDraft.paymentMethod === "efectivo"
          ? paymentPreview.tenderedAmount
          : undefined,
      transferenceNumber:
        paymentDraft.paymentMethod === "transferencia"
          ? `${paymentDraft.transferenceNumber ?? ""}`.trim()
          : undefined,
    };

    const updatedOrder = await getJson(`/api/orders/${payingOrder.id}/pay`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (updatedOrder.status === "paid") {
      closePayModal();
    } else {
      const nextBalance = Number(updatedOrder.balanceDue ?? 0);
      setPayingOrder(updatedOrder);
      setPaymentDraft((current) => ({
        ...current,
        amount: `${nextBalance}`,
        tenderedAmount: `${nextBalance}`,
      }));
    }

    await Promise.all([
      loadCashView(),
      loadStatsView(),
      loadHistoryView(historyDate),
    ]);
  }

  function openDeleteOrderModal(order) {
    setDeleteOrderModal({
      order,
      pin: "",
      error: "",
      loading: false,
    });
  }

  function closeDeleteOrderModal() {
    setDeleteOrderModal(null);
  }

  async function confirmDeleteOrder() {
    if (!deleteOrderModal?.order) return;

    const pin = `${deleteOrderModal.pin ?? ""}`.trim();
    if (pin !== DELETE_ACCOUNT_PIN) {
      setDeleteOrderModal((current) =>
        current
          ? { ...current, error: "PIN incorrecto. Vuelve a intentarlo." }
          : current,
      );
      return;
    }

    setDeleteOrderModal((current) =>
      current ? { ...current, loading: true, error: "" } : current,
    );

    try {
      await getJson(`/api/orders/${deleteOrderModal.order.id}`, {
        method: "DELETE",
      });
      setNetworkStatus(`Cuenta ${deleteOrderModal.order.id} eliminada.`);
      closeDeleteOrderModal();
      await Promise.all([
        loadCashView(),
        loadStatsView(),
        loadHistoryView(historyDate),
      ]);
    } catch (err) {
      setDeleteOrderModal((current) =>
        current
          ? {
              ...current,
              loading: false,
              error: err.message ?? "No se pudo eliminar la cuenta.",
            }
          : current,
      );
    }
  }

  const loadNetworkInfo = useCallback(async () => {
    const info = await getJson("/api/network-info");
    setNetworkInfo(info);
    setPublicApiDraft(info.publicApiUrl ?? "");
    const configured = Boolean(info.branchSiteConfigured && info.branchSiteId);
    setBranchSiteConfigured(configured);
    if (configured) {
      setBranchSiteId(info.branchSiteId);
      setBranchSiteDraft(info.branchSiteId);
      writeBranchSiteId(info.branchSiteId);
    } else {
      setBranchSiteId("");
      setBranchSiteDraft("");
      writeBranchSiteId("");
    }
    if (info.tunnel) {
      setTunnelStatus(info.tunnel);
    }
    setOwnerUrlDrafts({
      portoviejo: info.ownerDashboardUrls?.portoviejo ?? "",
      chone: info.ownerDashboardUrls?.chone ?? "",
    });
  }, [getJson]);

  async function saveOwnerDashboardUrls() {
    try {
      const result = await getJson("/api/network-info/owner-dashboard-urls", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ownerUrlDrafts),
      });
      setNetworkInfo((current) => ({
        ...current,
        ownerDashboardUrls: result.ownerDashboardUrls ?? {},
        permanentMasterDashboardUrl: result.permanentMasterDashboardUrl ?? "",
        permanentLinkReady: Boolean(result.permanentLinkReady),
      }));
      setNetworkStatus(
        result.permanentLinkReady
          ? "Link permanente del dueno listo. Ya no cambia al reiniciar."
          : "URLs guardadas. Falta completar la otra sede para el link permanente.",
      );
    } catch (error) {
      setNetworkStatus(`No se pudieron guardar las URLs fijas: ${error.message}`);
    }
  }

  async function confirmBranchSiteOnServer() {
    if (!isBranchSiteId(branchSiteDraft)) {
      setNetworkStatus("Selecciona Portoviejo o Chone antes de guardar.");
      return;
    }

    try {
      const result = await getJson("/api/network-info/branch-site", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branchSiteId: branchSiteDraft }),
      });
      const nextSiteId = result.branchSiteId ?? branchSiteDraft;
      setBranchSiteId(nextSiteId);
      setBranchSiteDraft(nextSiteId);
      setBranchSiteConfigured(true);
      writeBranchSiteId(nextSiteId);
      setNetworkInfo((current) => ({
        ...current,
        branchSiteId: nextSiteId,
        branchSiteConfigured: true,
        menuBranchId: result.menuBranchId ?? nextSiteId,
        menuVersion: result.menuVersion ?? "",
        menuBranchLabel: result.menuBranchLabel ?? "",
      }));
      await loadCashView({ silent: true });
      setNetworkStatus(
        `Sede confirmada: ${PUBLIC_SITES.find((site) => site.id === nextSiteId)?.name ?? nextSiteId}. Menu activo: ${result.menuBranchLabel ?? nextSiteId}.`,
      );
    } catch (error) {
      setNetworkStatus(`No se pudo guardar la sede: ${error.message}`);
    }
  }

  async function downloadJsonBackup() {
    setLoading(true);
    try {
      const data = await getJson("/api/backup/json");
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `barril-backup-${new Date()
        .toISOString()
        .slice(0, 19)
        .replace(/[:T]/g, "-")}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setNetworkStatus("Backup JSON generado.");
    } catch (err) {
      setNetworkStatus(`Error generando backup: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function restoreFromJsonFile(file) {
    if (!file) return;
    const text = await file.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      setNetworkStatus("Archivo JSON inválido.");
      return;
    }

    setConfirmModal({
      title: "Restaurar datos desde archivo",
      message:
        "Esto reemplazará los datos actuales con los contenidos del archivo. ¿Deseas continuar?",
      action: async () => {
        try {
          await getJson("/api/restore/json", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          setNetworkStatus("Restauración completada. Recargando...");
          await loadCashView();
          await loadStatsView();
          setRestoreFileInputKey(Date.now());
        } catch (err) {
          setNetworkStatus(`Error restaurando: ${err.message}`);
        }
      },
      confirmText: "Restaurar ahora",
      cancelText: "Cancelar",
    });
  }

  async function triggerVacuum() {
    setConfirmModal({
      title: "Compactar base de datos",
      message:
        "Ejecutar VACUUM compactará el archivo SQLite y puede tardar algunos segundos. ¿Continuar?",
      action: async () => {
        try {
          await getJson("/api/db/vacuum", { method: "POST" });
          setNetworkStatus("VACUUM ejecutado.");
        } catch (err) {
          setNetworkStatus(`Error en VACUUM: ${err.message}`);
        }
      },
      confirmText: "Compactar",
      cancelText: "Cancelar",
    });
  }

  function openCleanupModal() {
    setConfirmModal({
      title: "Limpiar base de datos",
      message: `Se borrarán TODOS los pedidos anteriores a: ${cleanupDateInput}. Esta acción es irreversible.`,
      hasDateInput: true,
      action: async () => {
        if (!cleanupDateInput) {
          setNetworkStatus("Debes seleccionar una fecha.");
          return;
        }
        try {
          setLoading(true);
          await getJson("/api/cleanup", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ before: cleanupDateInput }),
          });
          setNetworkStatus("Limpieza completada.");
          setConfirmModal(null);
          await loadCashView();
          await loadStatsView();
        } catch (err) {
          setNetworkStatus(`Error limpiando: ${err.message}`);
        } finally {
          setLoading(false);
        }
      },
      confirmText: "Eliminar irreversiblemente",
      cancelText: "Cancelar",
    });
  }

  function openCleanupAllModal() {
    setConfirmModal({
      title: "LIMPIAR TODO - PUNTO CERO",
      message:
        "ADVERTENCIA: Se eliminará TODA la base de datos (pedidos, pagos, todo). La aplicación quedará como nueva. ¿Estás seguro?",
      action: async () => {
        try {
          setLoading(true);
          await getJson("/api/cleanup/all", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
          });
          await getJson("/api/settings/cash-session", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              openingCash: 0,
              openingConfirmed: false,
              closingReport: null,
              closingHistory: [],
              sessionKey: null,
            }),
          });
          setNetworkStatus("Base de datos limpiada completamente.");
          setConfirmModal(null);
          setDayDetailModal(null);
          saveCashSessionCutoff("");
          setCashSessionCutoff("");
          setPendingOrders([]);
          setPaidOrders([]);
          setHistoryOrders([]);
          setHistoryGrouped([]);
          setCashSession({
            openingCash: 0,
            openingConfirmed: false,
            closingReport: null,
            closingHistory: [],
            sessionKey: null,
          });
          setCashClose({
            date: "",
            total: 0,
            efectivo: 0,
            transferencia: 0,
            orders: 0,
            openingCash: 0,
            expectedCash: 0,
            countedCash: null,
            countedTransfer: null,
            matches: null,
            differenceCash: null,
            differenceTransfer: null,
            closedAt: null,
          });
          await loadCashView({ cutoff: "" });
          await loadStatsView();
        } catch (err) {
          setNetworkStatus(`Error limpiando todo: ${err.message}`);
        } finally {
          setLoading(false);
        }
      },
      confirmText: "SÍ, LIMPIAR TODO",
      cancelText: "Cancelar",
      isDanger: true,
    });
  }

  async function saveRestaurantName() {
    const name = restaurantNameDraft.trim();
    if (!name) {
      setNetworkStatus("Escribe el nombre del restaurante.");
      return;
    }

    const payload = await getJson("/api/settings/restaurant-name", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ restaurantName: name }),
    });
    setRestaurantName(payload.restaurantName);
    setRestaurantNameDraft(payload.restaurantName);
    setNetworkStatus(
      "Nombre del restaurante guardado. Mobile y tickets usaran este nombre al recargar el menu.",
    );
  }

  async function copyToClipboard(value, label) {
    if (!value) {
      setNetworkStatus(`No hay ${label} para copiar.`);
      return;
    }

    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      setNetworkStatus(`${label} copiada.`);
      return;
    }

    setNetworkStatus(`No fue posible copiar ${label} automaticamente.`);
  }

  const triggerAutoPrint = useCallback(
    async (order) => {
      try {
        const result = await getJson(`/api/orders/${order.id}/print`, {
          method: "POST",
        });
        if (!result.printed) {
          setNetworkStatus(`Pedido ${order.id}: ${result.reason}`);
        }
      } catch {
        setNetworkStatus(`Pedido ${order.id}: fallo impresion automatica.`);
      }
    },
    [getJson],
  );

  function printKitchenTicket(order) {
    const { summary, editedIds } = getEditSummary(order);
    const ticket = window.open("", "_blank", "width=360,height=640");
    if (!ticket) return;
    ticket.document.write(`
      <html>
      <head>
        <title>Ticket Cocina ${order.id}</title>
        <style>
          body { font-family: monospace; padding: 12px; }
          h1, h2, p { margin: 0 0 8px; }
          ul { margin: 0; padding-left: 18px; }
          .edited { color: #b42318; font-weight: 700; }
          .summary { margin-top: 10px; padding-top: 10px; border-top: 1px dashed #b42318; }
        </style>
      </head>
      <body>
        <h1>${restaurantName}</h1>
        <h2>Comanda cocina</h2>
        <p><strong>ID:</strong> ${order.id}</p>
        <p><strong>Cliente:</strong> ${order.clientName}</p>
        <p><strong>Mesero:</strong> ${order.waiterName}</p>
        <p><strong>Ubicación:</strong> ${formatOrderLocation(order)}</p>
        <hr />
        <p><strong>Pedido</strong></p>
        <ul>
          ${order.items
            .map((item) => {
              const weightLabel = formatWeightBreakdown(item)
                ? ` - ${formatWeightBreakdown(item)}`
                : "";
              const editedClass = editedIds.has(item.menuItemId)
                ? "edited"
                : "";
              const note = getItemNotes(item);
              const noteLabel = note
                ? `<div class="item-plate-note">${note}</div>`
                : "";
              return `<li class="${editedClass}">${item.category} - ${item.quantity} x ${item.name}${weightLabel}${noteLabel}</li>`;
            })
            .join("")}
        </ul>
        ${
          summary.length > 0
            ? `
          <div class="summary">
            <p><strong>Cambios recientes</strong></p>
            <ul>
              ${summary
                .map(
                  (change) =>
                    `<li class="edited">${change.name}: ${getEditChangeLabel(
                      change,
                    )}</li>`,
                )
                .join("")}
            </ul>
          </div>
        `
            : ""
        }
      </body>
      </html>
    `);
    ticket.document.close();
    ticket.print();
  }

  useEffect(() => {
    setApiBaseUrl(getApiBaseUrl());
    if (publicPagesView) {
      hydratePublicDashboardSnapshot();
    }

    const socket = getSocket();

    const handleConnect = () => {
      setPublicBackendConnected(true);
      if (publicPagesView) {
        setNetworkStatus("");
      }
    };

    const handleDisconnect = () => {
      if (publicPagesView) {
        // Quick Cloudflare tunnels can briefly drop the socket while HTTP still works.
        // Keep the last good dashboard visible and let the HTTP fallback decide if it is offline.
        return;
      }
    };

    const handleConnectError = () => {
      if (publicPagesView) {
        return;
      }
    };

    const handleDashboardSnapshot = (snapshot) => {
      applyDashboardSnapshot(snapshot);
      setPublicBackendConnected(true);
    };

    const handleOrderChange = () => {
      if (publicPagesView) {
        return;
      }
      loadCashView({ silent: true });
      loadStatsView();
    };

    const handleTunnelUpdated = (status) => {
      if (publicPagesView || !status) return;
      setTunnelStatus(status);
      if (status.publicUrl) {
        setPublicApiDraft(status.publicUrl);
        setNetworkInfo((current) => ({
          ...current,
          publicApiUrl: status.publicUrl,
          tunnel: status,
        }));
      } else if (status.status === "stopped") {
        setPublicApiDraft("");
        setNetworkInfo((current) => ({
          ...current,
          publicApiUrl: "",
          tunnel: status,
        }));
      }
    };

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("connect_error", handleConnectError);
    socket.on("dashboard:snapshot", handleDashboardSnapshot);
    const handleNewOrder = (incomingOrder) => {
      if (autoPrintEnabled) {
        triggerAutoPrint(incomingOrder);
      }
    };

    if (!publicPagesView) {
      socket.on("order:new", handleNewOrder);
      socket.on("order:updated", handleOrderChange);
      socket.on("order:kitchen-updated", handleOrderChange);
      socket.on("order:paid", handleOrderChange);
      socket.on("order:dispatched", handleOrderChange);
      socket.on("tunnel:updated", handleTunnelUpdated);
    }

    socket.connect();

    let publicFallbackTimer = null;
    if (publicPagesView && !publicRemoteAccessUnlocked) {
      // Espera PIN admin antes de cargar datos remotos.
    } else if (publicPagesView) {
      if (publicDashboardMode === "multi") {
        refreshPublicMultiSiteDashboard().catch(() => {
          setPublicBackendConnected(false);
          setNetworkStatus("Sin conexion con las sedes. Mostrando ultimos estados guardados.");
        });
        publicFallbackTimer = window.setInterval(() => {
          refreshPublicMultiSiteDashboard().catch(() => {
            setPublicBackendConnected(false);
          });
        }, 30000);
      } else {
        loadPublicDashboardSnapshot().catch(() => {
          setPublicBackendConnected(false);
          if (hydratePublicDashboardSnapshot()) {
            setNetworkStatus("Sin backend activo. Mostrando el ultimo estado guardado.");
            return;
          }
          setNetworkStatus("Sin conexion con el backend publico.");
        });
        loadRecentHistory(7).catch(() => {});
        loadStatsView().catch(() => {});
        publicFallbackTimer = window.setInterval(() => {
          loadPublicDashboardSnapshot().catch(() => {
            if (!hydratePublicDashboardSnapshot()) {
              setPublicBackendConnected(false);
              setNetworkStatus("Sin conexion con el backend publico.");
            }
          });
          loadRecentHistory(7).catch(() => {});
        }, 30000);
      }
    } else {
      loadCashView();
      loadStatsView();
      loadHistoryView(historyDate);
      loadWaiters();
      loadNetworkInfo();
    }

    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("connect_error", handleConnectError);
      socket.off("dashboard:snapshot", handleDashboardSnapshot);
      socket.off("order:new", handleNewOrder);
      socket.off("order:updated", handleOrderChange);
      socket.off("order:kitchen-updated", handleOrderChange);
      socket.off("order:paid", handleOrderChange);
      socket.off("order:dispatched", handleOrderChange);
      socket.off("tunnel:updated", handleTunnelUpdated);
      if (publicFallbackTimer) {
        window.clearInterval(publicFallbackTimer);
      }
      socket.disconnect();
    };
  }, [
    autoPrintEnabled,
    historyDate,
    loadCashView,
    loadHistoryView,
    loadNetworkInfo,
    loadPublicDashboardSnapshot,
    loadStatsView,
    loadWaiters,
    publicDashboardMode,
    publicPagesView,
    publicRemoteAccessUnlocked,
    refreshPublicMultiSiteDashboard,
    triggerAutoPrint,
  ]);

  const showCombinedPublicView =
    publicPagesView &&
    publicDashboardMode === "multi" &&
    activePublicSite === COMBINED_PUBLIC_SITE_ID;
  const showStatsView =
    (activeView === "stats" || (publicPagesView && publicTab === "jornada")) &&
    !showCombinedPublicView;
  const showHistoryView =
    activeView === "history" || (publicPagesView && publicTab === "historial");
  const activePublicSiteMeta = PUBLIC_SITES.find(
    (site) => site.id === activePublicSite,
  );
  const publicStatusLabel = networkStatus
    ? networkStatus
    : publicBackendConnected
      ? publicDashboardMode === "multi"
        ? buildMultiSiteStatusLabel(publicSiteRuntime)
        : "Conectado al servidor"
      : "Esperando datos del servidor";
  const publicHeaderTitle =
    publicDashboardMode === "multi" && activePublicSiteMeta
      ? activePublicSiteMeta.name
      : publicDashboardMode === "multi"
        ? "Red Barril"
        : restaurantName;


  return (
    <div
      className={`${publicPagesView ? "public-shell" : "layout"} notranslate`}
      translate="no"
    >
      {publicPagesView && !publicRemoteAccessUnlocked ? (
        <section className="public-setup-panel public-pin-gate">
          <p className="security-flag">Acceso restringido</p>
          <h2>Panel del dueño</h2>
          <p>
            Este enlace es solo para el administrador. Ingresa el PIN para ver
            Portoviejo y Chone.
          </p>
          <form
            className="public-setup-form"
            onSubmit={(event) => {
              event.preventDefault();
              confirmPublicRemoteAccess();
            }}
          >
            <label htmlFor="public-remote-pin">PIN de administrador</label>
            <input
              id="public-remote-pin"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={6}
              value={publicAccessPin}
              onChange={(event) => {
                setPublicAccessPin(event.target.value);
                setPublicAccessError("");
              }}
              placeholder="⬢⬢⬢⬢⬢⬢"
            />
            {publicAccessError ? (
              <p className="security-error">{publicAccessError}</p>
            ) : null}
            <div className="actions">
              <button type="submit">Entrar al dashboard</button>
            </div>
          </form>
        </section>
      ) : null}

      {publicPagesView && publicRemoteAccessUnlocked ? (
        <>
          <header className="public-header">
            <div>
              <p className="eyebrow">Barril · panel del dueño</p>
              <h1 className="public-title">{publicHeaderTitle}</h1>
              <p className="public-lead">
                {publicDashboardMode === "multi"
                  ? "Vista unificada de Portoviejo y Chone. Cada sede mantiene su base de datos local; aquí solo se consulta."
                  : "Estadísticas completas de la jornada, histórico y días anteriores. Se actualiza con la última conexión al servidor del restaurante."}
              </p>
            </div>
            <div className="public-status">
              <span
                className={
                  publicBackendConnected
                    ? "public-status-dot"
                    : "public-status-dot loading"
                }
              />
              <span>{publicStatusLabel}</span>
              <button
                type="button"
                className="ghost public-lock-button"
                onClick={lockPublicRemoteAccess}
              >
                Cerrar sesion admin
              </button>
            </div>
          </header>

          {publicDashboardMode === "multi" ? (
            <div className="public-site-row">
              <button
                type="button"
                className={
                  activePublicSite === COMBINED_PUBLIC_SITE_ID ? "active" : ""
                }
                onClick={() => handlePublicSiteChange(COMBINED_PUBLIC_SITE_ID)}
              >
                Ambas sedes
              </button>
              {PUBLIC_SITES.map((site) => {
                const runtime = publicSiteRuntime[site.id];
                const siteOnline = Boolean(runtime?.connected);
                const siteStatus = siteOnline
                  ? "en linea"
                  : runtime?.snapshot
                    ? "sin conexion"
                    : "sin datos";

                return (
                  <button
                    key={site.id}
                    type="button"
                    className={activePublicSite === site.id ? "active" : ""}
                    onClick={() => handlePublicSiteChange(site.id)}
                    title={`${site.name}: ${siteStatus}`}
                  >
                    {site.shortName}
                    <span
                      aria-hidden="true"
                      style={{
                        display: "inline-block",
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        marginLeft: 6,
                        background: siteOnline
                          ? "#1f8b4c"
                          : runtime?.snapshot
                            ? "#c58b00"
                            : "#b42318",
                      }}
                    />
                  </button>
                );
              })}
            </div>
          ) : null}

          <div className="public-tab-row">
            <button
              type="button"
              className={publicTab === "jornada" ? "active" : ""}
              onClick={() => setPublicTab("jornada")}
            >
              Jornada actual
            </button>
            <button
              type="button"
              className={publicTab === "historial" ? "active" : ""}
              onClick={() => setPublicTab("historial")}
            >
              Días anteriores
            </button>
          </div>
        </>
      ) : null}

      {!publicPagesView ? (
      <aside className="sidebar">
        <div>
          <p className="eyebrow">Restaurante</p>
          <h1>{restaurantName}</h1>
          <p className="hub-note">Laptop activa como centro de pedidos</p>
        </div>

        <nav className="nav">
          {navItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={
                activeView === item.id ? "nav-button active" : "nav-button"
              }
              onClick={() => {
                if (PROTECTED_NAV_VIEW_IDS.has(item.id)) {
                  requestProtectedView(item.id);
                  return;
                }

                setActiveView(item.id);
              }}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <span>{pendingOrders.length} cuentas pendientes</span>
          <span>{paidOrdersForDisplay.length} pagadas</span>
          {pickupAwaitingDispatch.length > 0 ? (
            <span>{pickupAwaitingDispatch.length} por despachar</span>
          ) : null}
          <span>API: {apiBaseUrl}</span>
          <span>IP local: {networkInfo.localIp || "cargando..."}</span>
          <div className="sidebar-actions" style={{ marginTop: 8 }}>
            <button
              type="button"
              onClick={downloadJsonBackup}
              title="Exportar backup JSON"
            >
              Exportar
            </button>
            <button
              type="button"
              onClick={triggerVacuum}
              title="Compactar base de datos"
            >
              Compactar
            </button>
            <button
              type="button"
              onClick={openCleanupModal}
              title="Eliminar pedidos antiguos"
            >
              Limpieza
            </button>
            <button
              type="button"
              className="danger"
              onClick={openCleanupAllModal}
              title="Limpiar TODO - punto cero"
              style={{ fontSize: "0.75rem" }}
            >
              Limpiar todo
            </button>
            <label className="file-restore-label">
              <input
                key={restoreFileInputKey}
                type="file"
                accept="application/json"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) restoreFromJsonFile(f);
                }}
              />
              <button type="button">Restaurar</button>
            </label>
          </div>
        </div>
      </aside>
      ) : null}

      {publicPagesView && !publicRemoteAccessUnlocked ? null : (
      <main className="content">
        {loading ? <p className="loading">Cargando tablero...</p> : null}

        {!publicPagesView && activeView === "cash" ? (
          <section>
            <header className="section-header">
              <div style={{ flex: 1 }}>
                <h2>Cobro y caja</h2>
                <input
                  type="search"
                  placeholder="Buscar por cliente, mesa o ID"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  translate="no"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                />
              </div>
              <button
                type="button"
                onClick={openClosingCashModal}
                style={{ padding: "10px 16px", marginLeft: "8px" }}
              >
                Cierre de caja
              </button>
            </header>

            <h3 className="group-title">Cuentas pendientes</h3>
            <div className="card-grid">
              {filteredPending.length === 0 ? (
                <p className="empty">No hay cuentas pendientes.</p>
              ) : null}
              {filteredPending.map((order) => {
                const { summary, editedIds } = getEditSummary(order);
                const hasWeightedItems = order.items.some((item) =>
                  isWeightedItem(item),
                );
                const needsWeightEntry = order.items.some(
                  (item) => isWeightedItem(item) && item.weightGrams == null,
                );
                const expenses = getOrderExpenses(order);
                const expensesTotal = getOrderExpensesTotal(order);

                return (
                  <article key={order.id} className="order-card">
                    <div className="order-head">
                      <span>{order.id}</span>
                      <span>{formatOrderLocation(order)}</span>
                    </div>
                    <h4>{order.clientName}</h4>
                    <p>Mesero: {order.waiterName}</p>
                    <p>Pedido: {formatOrderLocation(order)}</p>
                    <p>Estado: {getStatusLabel(order.status)}</p>
                    <KitchenStatusLine status={order.kitchenStatus} />
                    <ul>
                      {order.items.map((item) => (
                        <li
                          key={`${order.id}-${item.menuItemId}`}
                          className={
                            editedIds.has(item.menuItemId)
                              ? "order-item-edited"
                              : ""
                          }
                        >
                          {item.category} - {item.quantity} x {item.name}
                          {formatWeightBreakdown(item)
                            ? ` (${formatWeightBreakdown(item)})`
                            : ""}
                          <ItemPlateNote item={item} />
                          <div
                            style={{
                              color: "#6f5e4d",
                              fontSize: "12px",
                              marginTop: "2px",
                            }}
                          >
                            Subtotal: {formatCurrency(item.subtotal ?? 0)}
                          </div>
                        </li>
                      ))}
                    </ul>
                    {summary.length > 0 ? (
                      <div className="order-edit-summary">
                        <p className="order-edit-summary-title">
                          Cambios recientes
                        </p>
                        {summary.map((change) => (
                          <div
                            key={`${order.id}-${change.menuItemId}-${change.type}`}
                            className="order-edit-summary-item"
                          >
                            <strong>{change.name}</strong>
                            <span>{getEditChangeLabel(change)}</span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {expenses.length > 0 ? (
                      <div
                        className="comment-card"
                        style={{ marginTop: "12px" }}
                      >
                        <p className="order-edit-summary-title">
                          Gastos adicionales
                        </p>
                        {expenses.map((expense, index) => (
                          <div
                            key={`${order.id}-expense-${index}`}
                            style={{
                              padding: "8px 0",
                              borderBottom:
                                index < expenses.length - 1
                                  ? "1px solid #f0e6d2"
                                  : "none",
                            }}
                          >
                            <p style={{ margin: "0 0 4px 0", fontWeight: 700 }}>
                              {getExpenseLabel(expense)}
                            </p>
                            <p
                              style={{
                                margin: 0,
                                color: "#6f5e4d",
                                fontSize: "12px",
                              }}
                            >
                              {formatCurrency(expense.amount ?? 0)}
                            </p>
                          </div>
                        ))}
                        <p style={{ margin: "10px 0 0", fontWeight: 700 }}>
                          Total gastos: {formatCurrency(expensesTotal)}
                        </p>
                      </div>
                    ) : null}
                    {getComments(order).length > 0 ? (
                      <div className="comment-card">
                        <p className="order-edit-summary-title">Comentarios</p>
                        {getComments(order).map((comment, index, comments) => (
                          <div
                            key={`${order.id}-comment-${index}`}
                            style={{
                              padding: "8px 0",
                              borderBottom:
                                index < comments.length - 1
                                  ? "1px solid #f0e6d2"
                                  : "none",
                            }}
                          >
                            <p
                              style={{
                                margin: "0 0 4px 0",
                                whiteSpace: "pre-wrap",
                              }}
                            >
                              {comment.text}
                            </p>
                            <p
                              style={{
                                margin: "0",
                                color: "#6f5e4d",
                                fontSize: "12px",
                              }}
                            >
                              {comment.author || "Mesero"} ·{" "}
                              {new Date(comment.createdAt).toLocaleString(
                                "es-CO",
                              )}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    <p className="total">
                      Total: {formatCurrency(order.total)}
                    </p>
                    <p>Abonado: {formatCurrency(order.paidAmount ?? 0)}</p>
                    <p>
                      Saldo: {formatCurrency(order.balanceDue ?? order.total)}
                    </p>
                    {needsWeightEntry ? (
                      <p style={{ color: "#8b4d1d", margin: "8px 0 0" }}>
                        Falta completar el gramaje antes de cobrar.
                      </p>
                    ) : null}
                    <div className="actions">
                      {hasWeightedItems ? (
                        <button
                          type="button"
                          onClick={() => openWeightModal(order)}
                        >
                          Completar gramaje
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => openExpenseModal(order)}
                      >
                        Gastos adicionales
                      </button>
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => openContainerModal(order)}
                      >
                        Contenedor
                      </button>
                      <button
                        type="button"
                        onClick={() => openPayModal(order)}
                        disabled={needsWeightEntry}
                      >
                        Cobrar / Abonar
                      </button>
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => printKitchenTicket(order)}
                      >
                        Ticket cocina
                      </button>
                      <button
                        type="button"
                        className="danger action-delete-account"
                        onClick={() => openDeleteOrderModal(order)}
                      >
                        Eliminar cuenta
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>

            {pickupAwaitingDispatch.length > 0 ? (
              <>
                <h3 className="group-title">Por despachar</h3>
                <p className="dispatch-hint">
                  Pedidos para llevar ya cobrados. Solo despacha cuando cocina
                  los marque como lista y salgan del local.
                </p>
                <div className="card-grid">
                  {pickupAwaitingDispatch.map((order) => {
                    const kitchenReady = isKitchenReadyForDispatch(order);
                    return (
                    <article
                      key={order.id}
                      className="order-card order-card-dispatch"
                    >
                      <div className="order-head">
                        <span>{order.id}</span>
                        <span className="dispatch-type-badge">
                          {getServiceTypeLabel(
                            normalizeServiceType(order.serviceType),
                          )}
                        </span>
                      </div>
                      <h4>{order.clientName}</h4>
                      <p>Mesero: {order.waiterName}</p>
                      <KitchenStatusLine status={order.kitchenStatus} />
                      {!kitchenReady ? (
                        <p className="dispatch-warning">
                          Espera a que cocina marque este pedido como lista.
                        </p>
                      ) : null}
                      <p className="total">
                        Total cobrado: {formatCurrency(order.total)}
                      </p>
                      <p>{describePayment(order)}</p>
                      <div className="actions">
                        <button
                          type="button"
                          className="dispatch-button"
                          disabled={!kitchenReady}
                          onClick={() => markOrderDispatched(order)}
                        >
                          Despachado
                        </button>
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => setSelectedPaidOrder(order)}
                        >
                          Ver detalle
                        </button>
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => printKitchenTicket(order)}
                        >
                          Ticket cocina
                        </button>
                      </div>
                    </article>
                    );
                  })}
                </div>
              </>
            ) : null}

            <h3 className="group-title">Pagadas en jornada actual</h3>
            <div className="card-grid compact">
              {paidOrdersForDisplay.slice(0, 12).map((order) => (
                <article
                  key={order.id}
                  className="paid-card"
                  onClick={() => setSelectedPaidOrder(order)}
                  style={{ cursor: "pointer" }}
                >
                  <p>{order.clientName}</p>
                  <span>
                    {describePayment(order)} · {formatCurrency(order.total)}
                  </span>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {showCombinedPublicView && publicTab === "jornada" ? (
          <section className="public-combined-dashboard">
            <header className="section-header">
              <div>
                <h2>Resumen de ambas sedes</h2>
                <p style={{ margin: "6px 0 0", color: "#6f5e4d" }}>
                  Totales de la jornada actual. Toca una sede arriba para ver el detalle completo.
                </p>
              </div>
            </header>

            <div className="public-kpi-grid">
              <article className="public-kpi-card">
                <h3>Ventas hoy (red)</h3>
                <strong>{formatCurrency(publicCombinedTotals.totalSalesToday)}</strong>
                <p>{publicCombinedTotals.totalPaidOrders} pedidos pagados</p>
              </article>
              <article className="public-kpi-card">
                <h3>Efectivo (red)</h3>
                <strong>{formatCurrency(publicCombinedTotals.efectivoToday)}</strong>
                <p>Suma de ambas sedes</p>
              </article>
              <article className="public-kpi-card">
                <h3>Transferencia (red)</h3>
                <strong>{formatCurrency(publicCombinedTotals.transferenciaToday)}</strong>
                <p>Suma de ambas sedes</p>
              </article>
              <article className="public-kpi-card">
                <h3>Cuentas pendientes</h3>
                <strong>{publicCombinedTotals.pendingOrders}</strong>
                <p>En las dos sedes</p>
              </article>
            </div>

            <div className="public-split-grid">
              {publicCombinedSiteSummaries.map(({ site, runtime, metrics }) => (
                <article className="stats-panel public-site-card" key={site.id}>
                  <div className="section-header stats-panel-head">
                    <div>
                      <h3>{site.name}</h3>
                      <p style={{ margin: "6px 0 0", color: "#6f5e4d" }}>
                        {runtime?.connected
                          ? "Servidor en linea"
                          : runtime?.snapshot
                            ? "Mostrando ultima sincronizacion"
                            : "Sin datos todavia"}
                      </p>
                    </div>
                    <span
                      className={
                        runtime?.connected
                          ? "public-status-dot"
                          : "public-status-dot loading"
                      }
                    />
                  </div>

                  <div className="public-kpi-grid compact">
                    <article className="public-kpi-card">
                      <h3>Ventas hoy</h3>
                      <strong>
                        {metrics
                          ? formatCurrency(metrics.totalSalesToday)
                          : "—"}
                      </strong>
                    </article>
                    <article className="public-kpi-card">
                      <h3>Pendientes</h3>
                      <strong>
                        {Array.isArray(runtime?.snapshot?.pendingOrders)
                          ? runtime.snapshot.pendingOrders.length
                          : 0}
                      </strong>
                    </article>
                  </div>

                  <p className="public-setup-note">
                    Ultima sync: {formatPublicSyncLabel(runtime?.lastSyncAt)}
                  </p>
                  {runtime?.error ? (
                    <p className="public-setup-note">{runtime.error}</p>
                  ) : null}

                  <div className="actions">
                    <button
                      type="button"
                      onClick={() => handlePublicSiteChange(site.id)}
                    >
                      Ver detalle de {site.shortName}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {showCombinedPublicView && publicTab === "historial" ? (
          <section className="public-combined-dashboard">
            <header className="section-header">
              <div>
                <h2>Historial por sede</h2>
                <p style={{ margin: "6px 0 0", color: "#6f5e4d" }}>
                  El historial detallado se consulta sede por sede para no mezclar datos.
                </p>
              </div>
            </header>

            <div className="public-split-grid">
              {publicCombinedSiteSummaries.map(({ site, runtime }) => (
                <article className="stats-panel public-site-card" key={`${site.id}-history`}>
                  <h3>{site.name}</h3>
                  <p className="public-setup-note">
                    Ultima sync: {formatPublicSyncLabel(runtime?.lastSyncAt)}
                  </p>
                  <div className="actions">
                    <button
                      type="button"
                      onClick={() => {
                        handlePublicSiteChange(site.id);
                        setPublicTab("historial");
                      }}
                    >
                      Abrir historial de {site.shortName}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {showStatsView ? (
          <section className="stats-dashboard">
            <header className="section-header">
              <div>
                <h2>
                  {publicPagesView
                    ? "Estadísticas de la jornada"
                    : "Estadísticas y cierre de caja"}
                </h2>
                <p style={{ margin: "6px 0 0", color: "#6f5e4d" }}>
                  {publicPagesView
                    ? "Mismas tablas que en la laptop: platos, cortes, extras, bebidas y pagos."
                    : "Jornada actual desde el último cierre. El histórico queda separado en Días anteriores."}
                </p>
              </div>
              {!publicPagesView ? (
                <button type="button" onClick={openClosingCashModal}>
                  Cierre de caja
                </button>
              ) : null}
            </header>

            <div className="stats-summary-grid">
              {dashboardStats.summaryCards.map((card) => (
                <article className={`stats-summary-card ${card.tone}`} key={card.label}>
                  <span className="stats-summary-icon">{card.icon}</span>
                  <div>
                    <p>{card.label}</p>
                    <strong>
                      {card.plain
                        ? `${card.value}${card.suffix ? ` ${card.suffix}` : ""}`
                        : formatCurrency(card.value)}
                    </strong>
                    <small>{card.hint}</small>
                  </div>
                </article>
              ))}
            </div>

            <div className="stats-split-grid">
              <section className="stats-panel">
                <div className="section-header stats-panel-head">
                  <div>
                    <h3>Métodos de pago</h3>
                    <p style={{ margin: "6px 0 0", color: "#6f5e4d" }}>
                      No se manejan tarjetas, solo cobros hechos al cliente.
                    </p>
                  </div>
                  <span className="stats-chip">Total {formatCurrency(dashboardStats.paymentTotal)}</span>
                </div>

                <div className="payment-grid">
                  {dashboardStats.paymentRows.map((method) => (
                    <article className="payment-card" key={method.method}>
                      <div className="payment-card-head">
                        <div>
                          <p>{method.label}</p>
                          <span>{method.count} pagos registrados</span>
                        </div>
                        <strong>{formatCurrency(method.total)}</strong>
                      </div>
                      <div className="stats-bar-track payment-track">
                        <div
                          className="stats-bar-fill"
                          style={getSalesIntensityStyle(method.total, Math.max(dashboardStats.paymentTotal, 0))}
                        />
                      </div>
                    </article>
                  ))}
                </div>

                <div className="stats-table-card">
                  <table className="stats-table">
                    <thead>
                      <tr>
                        <th>Método</th>
                        <th>Cantidad</th>
                        <th>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dashboardStats.paymentRows.map((method) => (
                        <tr key={`${method.method}-row`}>
                          <td>{method.label}</td>
                          <td>{method.count}</td>
                          <td>{formatCurrency(method.total)}</td>
                        </tr>
                      ))}
                      <tr className="stats-total-row">
                        <td>Total general</td>
                        <td>{dashboardStats.paymentRows.reduce((acc, row) => acc + row.count, 0)}</td>
                        <td>{formatCurrency(dashboardStats.paymentTotal)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>

              <section className={`stats-panel cash-status ${dashboardStats.cashSummary.status ?? "idle"}`}>
                <div className="section-header stats-panel-head">
                  <div>
                    <h3>Cierre de caja automático</h3>
                    <p style={{ margin: "6px 0 0", color: "#6f5e4d" }}>
                      La caja inicial se muestra aparte; la diferencia compara ventas cobradas contra lo contado.
                    </p>
                  </div>
                  {dashboardStats.cashSummary.status ? (
                    <span className="stats-chip">
                      {getCashCloseStatusLabel(dashboardStats.cashSummary.status)}
                    </span>
                  ) : null}
                </div>

                <div className="stats-item-list">
                  <div className="stats-item-row">
                    <div>
                      <strong>Caja inicial</strong>
                      <p>Valor pedido al comenzar el día</p>
                    </div>
                    <span>{formatCurrency(dashboardStats.cashSummary.openingCash)}</span>
                  </div>
                  <div className="stats-item-row">
                    <div>
                      <strong>Dinero registrado</strong>
                      <p>Efectivo + transferencia cobrados</p>
                    </div>
                    <span>{formatCurrency(dashboardStats.cashSummary.registeredTotal)}</span>
                  </div>
                  <div className="stats-item-row">
                    <div>
                      <strong>Ventas esperadas</strong>
                      <p>Efectivo + transferencia, sin sumar caja inicial</p>
                    </div>
                    <span>{formatCurrency(dashboardStats.cashSummary.expectedTotal)}</span>
                  </div>
                  <div className="stats-item-row">
                    <div>
                      <strong>Diferencia último cierre</strong>
                      <p>Verde coincide, amarillo sobra, rojo falta</p>
                    </div>
                    <span>
                      {dashboardStats.cashSummary.differenceTotal == null
                        ? "Sin cierre"
                        : formatSignedCurrency(dashboardStats.cashSummary.differenceTotal)}
                    </span>
                  </div>
                </div>
              </section>
            </div>

            <section className="stats-panel">
              <div className="section-header stats-panel-head">
                <div>
                  <h3>Ranking de platos</h3>
                  <p style={{ margin: "6px 0 0", color: "#6f5e4d" }}>
                    Ordenado del más vendido al menos vendido.
                  </p>
                </div>
                <span className="stats-chip">Top 5 / Top 10</span>
              </div>

              <div className="stats-split-grid">
                <article className="ranking-card">
                  <h4>Top 5 más vendidos</h4>
                  <div className="stats-bar-list">
                    {dashboardStats.topDishes.map((dish, index) => (
                      <div className="stats-bar-row" key={`${dish.label}-top-${index}`}>
                        <div className="stats-bar-meta">
                          <span>{index + 1}. {dish.label}</span>
                          <small>{dish.quantity} · {formatCurrency(dish.total)}</small>
                        </div>
                        <div className="stats-bar-track">
                          <div
                            className="stats-bar-fill"
                            style={getSalesIntensityStyle(dish.quantity, Math.max(...dashboardStats.topDishes.map((item) => item.quantity), 0))}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </article>

                <article className="ranking-card">
                  <h4>Top 10 detalle</h4>
                  <div className="stats-table-card">
                    <table className="stats-table">
                      <thead>
                        <tr>
                          <th>Plato</th>
                          <th>Cantidad</th>
                          <th>Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dashboardStats.topDishes10.length > 0 ? (
                          dashboardStats.topDishes10.map((dish) => (
                            <tr key={`${dish.key}-top10`}>
                              <td>{dish.label}</td>
                              <td>{dish.quantity}</td>
                              <td>{formatCurrency(dish.total)}</td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan="3">Sin platos pagados todavía.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </article>
              </div>

              <div className="stats-table-card" style={{ marginTop: 14 }}>
                <table className="stats-table">
                  <thead>
                    <tr>
                      <th>Todos los platos de la jornada actual</th>
                      <th>Cantidad</th>
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dashboardStats.allDishes.length > 0 ? (
                      dashboardStats.allDishes.map((dish) => (
                        <tr key={`${dish.key}-all-dishes`}>
                          <td>{dish.label}</td>
                          <td>{dish.quantity}</td>
                          <td>{formatCurrency(dish.total)}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan="3">Sin platos pagados en esta jornada.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="stats-panel">
              <div className="section-header stats-panel-head">
                <div>
                  <h3>Cortes, contenedores, extras y bebidas</h3>
                  <p style={{ margin: "6px 0 0", color: "#6f5e4d" }}>
                    Todo sale de pedidos pagados, incluyendo peso, precio y cobros extra.
                  </p>
                </div>
                <span className="stats-chip">{dashboardStats.totalKgSold.toFixed(2)} kg</span>
              </div>

              <div className="stats-category-grid">
                {[
                  {
                    title: "Cortes de carne por peso",
                    subtitle: `${dashboardStats.totalKgSold.toFixed(2)} kg vendidos en jornada`,
                    empty: "No hay ventas por peso registradas en esta jornada.",
                    rows: dashboardStats.weightedCuts,
                    columns: ["Corte", "Kg vendidos", "Total"],
                    render: (item) => [item.label, `${item.quantity.toFixed(2)} kg`, formatCurrency(item.total)],
                  },
                  {
                    title: "Contenedores vendidos",
                    subtitle: `${dashboardStats.containers.reduce((acc, item) => acc + item.quantity, 0)} vendidos en jornada`,
                    empty: "Sin contenedores vendidos en esta jornada.",
                    rows: dashboardStats.containers,
                    columns: ["Contenedor", "Cantidad", "Total"],
                    render: (item) => [item.label, item.quantity, formatCurrency(item.total)],
                  },
                  {
                    title: "Productos adicionales cobrados",
                    subtitle: `${dashboardStats.extras.reduce((acc, item) => acc + item.quantity, 0)} cobros extra`,
                    empty: "No hay extras cobrados en esta jornada.",
                    rows: dashboardStats.extras,
                    columns: ["Producto Extra", "Cantidad", "Total"],
                    render: (item) => [item.label, item.quantity, formatCurrency(item.total)],
                  },
                  {
                    title: "Bebidas",
                    subtitle: `${dashboardStats.beverages.reduce((acc, item) => acc + item.quantity, 0)} vendidas`,
                    empty: "No hay bebidas cobradas en esta jornada.",
                    rows: dashboardStats.beverages,
                    columns: ["Bebida", "Cantidad", "Total"],
                    render: (item) => [item.label, item.quantity, formatCurrency(item.total)],
                  },
                ].map((block) => (
                  <article className="stats-category-block" key={block.title}>
                    <div className="stats-block-head">
                      <div>
                        <p className="stats-block-label">{block.title}</p>
                        <h4>{block.subtitle}</h4>
                      </div>
                    </div>
                    <div className="stats-table-card">
                      <table className="stats-table">
                        <thead>
                          <tr>
                            {block.columns.map((column) => (
                              <th key={column}>{column}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {block.rows.length > 0 ? (
                            block.rows.map((item) => (
                              <tr key={`${block.title}-${item.key}`}>
                                {block.render(item).map((value, index) => (
                                  <td key={`${item.key}-${index}`}>{value}</td>
                                ))}
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td colSpan={block.columns.length}>{block.empty}</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <div className="stats-split-grid">
              <section className="stats-panel">
                <div className="section-header stats-panel-head">
                  <div>
                    <h3>Histórico de ventas</h3>
                    <p style={{ margin: "6px 0 0", color: "#6f5e4d" }}>
                      Comparación por rango con barras de ventas.
                    </p>
                  </div>
                </div>

                <div className="stats-filter-row">
                  {STATS_RANGE_OPTIONS.map((option) => (
                    <button
                      type="button"
                      key={option.id}
                      className={statsRange === option.id ? "active" : ""}
                      onClick={() => setStatsRange(option.id)}
                    >
                      {option.label}
                    </button>
                  ))}
                  {statsRange === "personalizado" ? (
                    <>
                      <input
                        type="date"
                        value={historyDate}
                        onChange={(event) => setHistoryDate(event.target.value)}
                      />
                      <button type="button" onClick={() => loadHistoryView(historyDate)}>
                        Aplicar
                      </button>
                    </>
                  ) : null}
                </div>

                <div className="stats-history-chart">
                  {dashboardStats.historyComparisonRows.map((row) => (
                    <div className="stats-history-bar" key={`${row.date}-bar`}>
                      <span>{row.label ?? row.date}</span>
                      <div>
                        <i
                          style={getSalesIntensityStyle(
                            row.sales,
                            Math.max(...dashboardStats.historyComparisonRows.map((item) => item.sales), 0),
                          )}
                        />
                      </div>
                      <strong>{formatCurrency(row.sales)}</strong>
                    </div>
                  ))}
                </div>

                <div className="stats-table-card">
                  <table className="stats-table">
                    <thead>
                      <tr>
                        <th>Fecha</th>
                        <th>Ventas</th>
                        <th>Pedidos</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dashboardStats.historyComparisonRows.length > 0 ? (
                        dashboardStats.historyComparisonRows.map((row) => (
                          <tr key={`${row.date}-${row.label}`}>
                            <td>{row.label ?? row.date}</td>
                            <td>{formatCurrency(row.sales ?? 0)}</td>
                            <td>{row.orders ?? 0}</td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan="3">Sin histórico reciente para mostrar.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="stats-panel">
                <div className="section-header stats-panel-head">
                  <div>
                    <h3>Histórico de cierres</h3>
                    <p style={{ margin: "6px 0 0", color: "#6f5e4d" }}>
                      Se guarda cada cierre con diferencia y estado.
                    </p>
                  </div>
                </div>

                <div className="stats-table-card">
                  <table className="stats-table">
                    <thead>
                      <tr>
                        <th>Fecha</th>
                        <th>Caja inicial</th>
                        <th>Ventas esperadas</th>
                        <th>Diferencia</th>
                        <th>Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dashboardStats.cashSummary.closingHistory.length > 0 ? (
                        dashboardStats.cashSummary.closingHistory.slice(0, 8).map((report) => (
                          <tr key={report.id ?? report.closedAt}>
                            <td>
                              {report.closedAt
                                ? new Date(report.closedAt).toLocaleString("es-CO")
                                : report.date}
                            </td>
                            <td>{formatCurrency(report.openingCash ?? 0)}</td>
                            <td>{formatCurrency(report.expectedTotal ?? 0)}</td>
                            <td className={`cash-difference ${report.status}`}>
                              {formatSignedCurrency(report.differenceTotal ?? 0)}
                            </td>
                            <td>{getCashCloseStatusLabel(report.status)}</td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan="5">Aún no hay cierres guardados.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="stats-table-card">
                  <table className="stats-table">
                    <thead>
                      <tr>
                        <th>Fecha</th>
                        <th>Contenedores</th>
                        <th>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dashboardStats.containerHistoryRows.length > 0 ? (
                        dashboardStats.containerHistoryRows.slice(0, 6).map((row) => (
                          <tr key={`${row.date}-containers`}>
                            <td>{row.label}</td>
                            <td>{row.quantity}</td>
                            <td>{formatCurrency(row.total)}</td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan="3">Sin histórico de contenedores en la jornada.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          </section>
        ) : null}

        {showHistoryView ? (
          <section className={publicPagesView ? "public-history-section" : undefined}>
            <header className="section-header">
              <h2>Días anteriores</h2>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="date"
                  value={historyDate}
                  onChange={(event) => setHistoryDate(event.target.value)}
                />
                <button
                  type="button"
                  onClick={() => loadHistoryView(historyDate)}
                >
                  Ver fecha
                </button>
                <button type="button" onClick={() => loadRecentHistory(7)}>
                  {loadingHistory ? "Cargando..." : "Últimos 7 días"}
                </button>
              </div>
            </header>

            {/* Grouped by day if available */}
            {historyGrouped && historyGrouped.length > 0 ? (
              historyGrouped.map((group) => {
                const isExpanded = Boolean(expandedDays[group.date]);
                const totalRevenue = group.orders.reduce(
                  (s, o) => s + Number(o.total || 0),
                  0,
                );
                const dayPaymentTotals = group.orders.reduce(
                  (acc, order) => {
                    const paymentTotals = getOrderPaymentTotals(order);
                    acc.efectivo += paymentTotals.efectivo;
                    acc.transferencia += paymentTotals.transferencia;
                    return acc;
                  },
                  { efectivo: 0, transferencia: 0 },
                );
                const dayPaymentTotal =
                  dayPaymentTotals.efectivo + dayPaymentTotals.transferencia;
                const cashShare =
                  dayPaymentTotal > 0
                    ? (dayPaymentTotals.efectivo / dayPaymentTotal) * 100
                    : 0;
                const transferShare =
                  dayPaymentTotal > 0
                    ? (dayPaymentTotals.transferencia / dayPaymentTotal) * 100
                    : 0;
                const ordersCount = group.orders.length;
                const paidCount = group.orders.filter(
                  (o) => o.status === "paid",
                ).length;
                const pendingCount = ordersCount - paidCount;

                return (
                  <div key={group.date} style={{ marginBottom: 16 }}>
                    <div
                      className="day-summary-card"
                      style={{
                        borderRadius: 12,
                        padding: 12,
                        background: "#fffaf1",
                        border: "1px solid #e8d8c5",
                        cursor: "pointer",
                      }}
                      onClick={() =>
                        setExpandedDays((s) => ({
                          ...s,
                          [group.date]: !s[group.date],
                        }))
                      }
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                        }}
                      >
                        <div>
                          <div
                            style={{
                              color: "#6f5e4d",
                              fontSize: 12,
                              fontWeight: 700,
                              textTransform: "capitalize",
                            }}
                          >
                            {new Date(group.date).toLocaleDateString("es-CO", {
                              weekday: "long",
                              day: "numeric",
                              month: "long",
                              year: "numeric",
                            })}
                          </div>
                          <div style={{ color: "#8c7d6f", fontSize: 12 }}>
                            Día {group.date}
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: 12 }}>
                          <div style={{ textAlign: "center" }}>
                            <div style={{ color: "#2f8f73", fontWeight: 800 }}>
                              ${formatCurrency(totalRevenue).replace("$", "")}
                            </div>
                            <div style={{ fontSize: 12, color: "#6f5e4d" }}>
                              Ganancias
                            </div>
                          </div>
                          <div style={{ textAlign: "center" }}>
                            <div style={{ fontWeight: 800 }}>{ordersCount}</div>
                            <div style={{ fontSize: 12, color: "#6f5e4d" }}>
                              Pedidos
                            </div>
                          </div>
                          <div style={{ textAlign: "center" }}>
                            <div style={{ fontWeight: 800 }}>{paidCount}</div>
                            <div style={{ fontSize: 12, color: "#6f5e4d" }}>
                              Pagados
                            </div>
                          </div>
                          <div style={{ textAlign: "center" }}>
                            <div style={{ fontWeight: 800 }}>
                              {pendingCount}
                            </div>
                            <div style={{ fontSize: 12, color: "#6f5e4d" }}>
                              Pendientes
                            </div>
                          </div>
                        </div>
                      </div>
                      <div
                        style={{
                          marginTop: 10,
                          color: "#8c7d6f",
                          fontSize: 12,
                        }}
                      >
                        Toca para ver detalles
                      </div>

                      <div
                        style={{
                          marginTop: 12,
                          paddingTop: 12,
                          borderTop: "1px solid #ead9c5",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            gap: 12,
                            alignItems: "center",
                            marginBottom: 8,
                          }}
                        >
                          <strong style={{ color: "#3d3d3d", fontSize: 13 }}>
                            Caja del día
                          </strong>
                          <span style={{ color: "#6f5e4d", fontSize: 12 }}>
                            {formatCurrency(dayPaymentTotal)}
                          </span>
                        </div>

                        <div
                          style={{
                            display: "grid",
                            gap: 8,
                            fontSize: 12,
                            color: "#6f5e4d",
                          }}
                        >
                          <div>
                            <div
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                marginBottom: 4,
                              }}
                            >
                              <span>Efectivo</span>
                              <strong style={{ color: "#2f8f73" }}>
                                {formatCurrency(dayPaymentTotals.efectivo)}
                              </strong>
                            </div>
                            <div
                              style={{
                                height: 8,
                                borderRadius: 999,
                                background: "#efe4d5",
                                overflow: "hidden",
                              }}
                            >
                              <div
                                style={{
                                  width: `${cashShare}%`,
                                  height: "100%",
                                  borderRadius: "inherit",
                                  background:
                                    "linear-gradient(90deg, #1f8f73, #47b38f)",
                                }}
                              />
                            </div>
                          </div>

                          <div>
                            <div
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                marginBottom: 4,
                              }}
                            >
                              <span>Transferencia</span>
                              <strong style={{ color: "#b06b15" }}>
                                {formatCurrency(dayPaymentTotals.transferencia)}
                              </strong>
                            </div>
                            <div
                              style={{
                                height: 8,
                                borderRadius: 999,
                                background: "#efe4d5",
                                overflow: "hidden",
                              }}
                            >
                              <div
                                style={{
                                  width: `${transferShare}%`,
                                  height: "100%",
                                  borderRadius: "inherit",
                                  background:
                                    "linear-gradient(90deg, #b06b15, #d99a3b)",
                                }}
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {isExpanded ? (
                      <div style={{ marginTop: 10 }}>
                        <div className="card-grid">
                          {group.orders.length === 0 ? (
                            <p className="empty">
                              No hay comandas para este día.
                            </p>
                          ) : (
                            group.orders.map((order) => (
                              <article
                                key={order.id}
                                className="order-card"
                                onClick={() => setSelectedPaidOrder(order)}
                                style={{ cursor: "pointer" }}
                              >
                                <div className="order-head">
                                  <span>{order.id}</span>
                                  <span>{formatOrderLocation(order)}</span>
                                </div>
                                <h4>{order.clientName}</h4>
                                <p>Mesero: {order.waiterName}</p>
                                <p>Estado: {getStatusLabel(order.status)}</p>
                                <p>Metodo: {describePayment(order)}</p>
                                <p className="total">
                                  Total: {formatCurrency(order.total)}
                                </p>
                                <p>
                                  Abonado:{" "}
                                  {formatCurrency(order.paidAmount ?? 0)}
                                </p>
                              </article>
                            ))
                          )}
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })
            ) : (
              <div className="card-grid">
                {historyOrders.map((order) => (
                  <article
                    key={order.id}
                    className="order-card"
                    onClick={() => setSelectedPaidOrder(order)}
                    style={{ cursor: "pointer" }}
                  >
                    <div className="order-head">
                      <span>{order.id}</span>
                      <span>{formatOrderLocation(order)}</span>
                    </div>
                    <h4>{order.clientName}</h4>
                    <p>Mesero: {order.waiterName}</p>
                    <p>Estado: {getStatusLabel(order.status)}</p>
                    <p>Metodo: {describePayment(order)}</p>
                    <p className="total">
                      Total: {formatCurrency(order.total)}
                    </p>
                    <p>Abonado: {formatCurrency(order.paidAmount ?? 0)}</p>
                  </article>
                ))}
                {historyOrders.length === 0 ? (
                  <p className="empty">
                    No hay comandas para la fecha seleccionada.
                  </p>
                ) : null}
              </div>
            )}
          </section>
        ) : null}

        {!publicPagesView && activeView === "waiters" ? (
          <section>
            <header className="section-header">
              <h2>Meseros autorizados</h2>
            </header>

            <div className="card-grid">
              <article className="order-card">
                <h4>Autorizar mesero</h4>
                <p>
                  Un mesero autorizado puede enviar y editar comandas desde un
                  dispositivo movil.
                </p>
                <input
                  value={waiterNameDraft}
                  onChange={(event) => setWaiterNameDraft(event.target.value)}
                  placeholder="Nombre del mesero"
                />
                <div className="actions">
                  <button type="button" onClick={saveWaiter}>
                    Autorizar
                  </button>
                </div>
              </article>

              <article className="order-card">
                <h4>Estado actual</h4>
                <p>
                  Activos: {waiters.filter((waiter) => waiter.active).length}
                </p>
                <p>
                  Inactivos: {waiters.filter((waiter) => !waiter.active).length}
                </p>
              </article>
            </div>

            <div className="card-grid">
              {waiters.map((waiter) => (
                <article key={waiter.waiterKey} className="order-card">
                  <div className="order-head">
                    <span>{waiter.displayName}</span>
                    <span>{waiter.active ? "Activo" : "Inactivo"}</span>
                  </div>
                  <p>Clave: {waiter.waiterKey}</p>
                  <p>
                    Actualizado: {new Date(waiter.updatedAt).toLocaleString()}
                  </p>
                  <div className="actions">
                    {waiter.active ? (
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => toggleWaiterActive(waiter, false)}
                      >
                        Revocar acceso
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => toggleWaiterActive(waiter, true)}
                      >
                        Reautorizar
                      </button>
                    )}
                    <button
                      type="button"
                      className="danger"
                      onClick={() => confirmDeleteWaiter(waiter)}
                    >
                      Eliminar mesero
                    </button>
                  </div>
                </article>
              ))}
              {waiters.length === 0 ? (
                <p className="empty">Aun no hay meseros autorizados.</p>
              ) : null}
            </div>

            {waiterStatus ? <p className="loading">{waiterStatus}</p> : null}
          </section>
        ) : null}

        {!publicPagesView && activeView === "network" ? (
          <section>
            <header className="section-header">
              <h2>Conectividad remota</h2>
            </header>

            <div className="card-grid">
              <article className="order-card">
                <h4>Nombre del restaurante</h4>
                <p>Se muestra en laptop, app mobile y tickets de cocina.</p>
                <input
                  value={restaurantNameDraft}
                  onChange={(event) =>
                    setRestaurantNameDraft(event.target.value)
                  }
                  placeholder="Ej: Ahumados Al Barril"
                />
                <div className="actions" style={{ marginTop: 10 }}>
                  <button type="button" onClick={saveRestaurantName}>
                    Guardar nombre
                  </button>
                </div>
              </article>

              <article className="order-card">
                <h4>URL para meseros y cocina</h4>
                <p>{meseroConnectionUrl || "Cargando..."}</p>
                {meseroUsesTunnel ? (
                  <p style={{ marginTop: 8 }}>
                    Modo tunel HTTPS (el router no deja usar la IP local).
                  </p>
                ) : null}
                <div className="actions">
                  <button
                    type="button"
                    onClick={() =>
                      copyToClipboard(meseroConnectionUrl, "URL de conexion")
                    }
                  >
                    Copiar URL
                  </button>
                </div>
              </article>

              <article className="order-card">
                <h4>Código QR</h4>
                {meseroConnectionUrl ? (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                    }}
                  >
                    <div
                      style={{
                        background: "#fff",
                        padding: 12,
                        borderRadius: 8,
                      }}
                    >
                      <QRCode value={meseroConnectionUrl} />
                    </div>
                    <p style={{ marginTop: 8 }}>
                      Escanea con meseros o cocina. Si la IP local falla, usa
                      este QR cuando el tunel este activo.
                    </p>
                  </div>
                ) : (
                  <p>Cargando...</p>
                )}
              </article>

              <article className="order-card">
                <h4>URL local (solo misma red WiFi)</h4>
                <p>{networkInfo.localApiUrl || "Cargando..."}</p>
                <div className="actions">
                  <button
                    type="button"
                    onClick={() =>
                      copyToClipboard(networkInfo.localApiUrl, "URL local")
                    }
                  >
                    Copiar URL local
                  </button>
                </div>
              </article>

              <article className="order-card">
                <h4>Sede de esta laptop</h4>
                <p>
                  Tu eliges en cual sede trabaja ESTE servidor. No se adivina:
                  debes seleccionar y confirmar. Hazlo una vez por laptop
                  (Portoviejo en una, Chone en la otra).
                </p>
                <select
                  value={branchSiteDraft}
                  onChange={(event) => setBranchSiteDraft(event.target.value)}
                >
                  <option value="">Selecciona sede...</option>
                  {PUBLIC_SITES.map((site) => (
                    <option key={site.id} value={site.id}>
                      {site.name}
                    </option>
                  ))}
                </select>
                <div className="actions" style={{ marginTop: 10 }}>
                  <button type="button" onClick={confirmBranchSiteOnServer}>
                    Confirmar sede de esta laptop
                  </button>
                </div>
                {branchSiteConfigured ? (
                  <>
                    <p style={{ marginTop: 10, fontWeight: 700 }}>
                      Sede activa en este servidor:{" "}
                      {PUBLIC_SITES.find((site) => site.id === branchSiteId)?.name}
                    </p>
                    {networkInfo.menuBranchLabel ? (
                      <p style={{ marginTop: 6 }}>
                        Menu activo: <strong>{networkInfo.menuBranchLabel}</strong>
                        {networkInfo.menuVersion ? (
                          <span style={{ display: "block", fontSize: "0.9em", color: "#5c4a32" }}>
                            {networkInfo.menuVersion}
                          </span>
                        ) : null}
                      </p>
                    ) : null}
                  </>
                ) : (
                  <p style={{ marginTop: 10, color: "#b42318", fontWeight: 700 }}>
                    Aun no has confirmado la sede de esta laptop.
                  </p>
                )}
              </article>

              <article className="order-card">
                <h4>Tunel remoto (automatico)</h4>
                <p>
                  Se inicia solo unos segundos despues de levantar el servidor.
                </p>
                {networkInfo.publicUrlIsFixed || tunnelStatus.fixedPublicUrl ? (
                  <p style={{ fontWeight: 700 }}>
                    URL fija configurada: no cambia al reiniciar.
                  </p>
                ) : (
                  <p style={{ color: "#8a3f00" }}>
                    Tunel rapido Cloudflare: la URL tecnica puede cambiar al
                    reiniciar. El link multi-sede del dueno NO cambia; solo hay
                    que escanear el QR de sede otra vez si reiniciaste el
                    servidor (para actualizar datos en vivo en el celular).
                  </p>
                )}
                <p style={{ wordBreak: "break-all" }}>
                  {publicApiDraft || networkInfo.publicApiUrl || "Esperando URL publica..."}
                </p>
                <p>
                  Estado:{" "}
                  <strong>
                    {tunnelStatus.status === "running"
                      ? "Activo"
                      : tunnelStatus.status === "starting"
                        ? "Iniciando..."
                        : tunnelStatus.status === "error"
                          ? "Error"
                          : "Preparando"}
                  </strong>
                  {networkInfo.tunnelRegistryConfigured
                    ? " · Registro GitHub activo"
                    : tunnelStatus.mode === "named" || tunnelStatus.fixedPublicUrl
                      ? " · URL fija configurada"
                      : tunnelStatus.publicUrl
                        ? " · URL temporal Cloudflare"
                        : ""}
                </p>
                {tunnelStatus.error ? (
                  <p style={{ color: "#b42318", fontWeight: 700 }}>
                    {tunnelStatus.error}
                  </p>
                ) : null}
                <div className="actions">
                  <button
                    type="button"
                    onClick={() =>
                      copyToClipboard(
                        publicApiDraft || networkInfo.publicApiUrl,
                        "URL publica",
                      )
                    }
                  >
                    Copiar URL publica
                  </button>
                </div>
              </article>

              <article className="order-card">
                <h4>Dashboard administrativo remoto</h4>
                {!dashboardLinkUnlocked ? (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 12,
                    }}
                  >
                    <p>
                      El enlace y el QR del dashboard estan protegidos. Solo el
                      administrador puede mostrarlos. Se ocultan al salir de
                      Conectividad o tras 90 segundos.
                    </p>
                    <div className="actions">
                      <button type="button" onClick={requestDashboardLinkAccess}>
                        Mostrar con PIN admin
                      </button>
                    </div>
                  </div>
                ) : !branchSiteConfigured ? (
                  <p>
                    Primero confirma la sede de esta laptop. Luego espera la URL
                    publica del tunel automatico para generar el enlace y QR.
                  </p>
                ) : publicDashboardUrl ? (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 12,
                    }}
                  >
                    <p style={{ wordBreak: "break-all" }}>
                      {publicDashboardUrl}
                    </p>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "center",
                      }}
                    >
                      <div
                        style={{
                          background: "#fff",
                          padding: 12,
                          borderRadius: 8,
                        }}
                      >
                        <QRCode value={publicDashboardUrl} />
                      </div>
                    </div>
                    <p>
                      Escanea este QR en el celular del dueno para registrar{" "}
                      {PUBLIC_SITES.find((site) => site.id === branchSiteId)?.name}.
                      Hazlo en cada laptop (Portoviejo y Chone).
                    </p>
                    <div className="actions">
                      <button
                        type="button"
                        onClick={() =>
                          copyToClipboard(
                            publicDashboardUrl,
                            "enlace administrativo del dashboard",
                          )
                        }
                      >
                        Copiar enlace de sede
                      </button>
                      <button
                        type="button"
                        className="ghost"
                        onClick={() =>
                          window.open(
                            publicDashboardUrl,
                            "_blank",
                            "noopener,noreferrer",
                          )
                        }
                      >
                        Abrir dashboard
                      </button>
                      <button
                        type="button"
                        className="ghost"
                        onClick={lockSensitiveDashboardLinks}
                      >
                        Ocultar enlaces
                      </button>
                    </div>
                  </div>
                ) : (
                  <p>
                    Espera a que el tunel automatico muestre la URL publica
                    (unos segundos tras iniciar el servidor) para generar
                    el enlace y QR del administrador.
                  </p>
                )}
              </article>

              <article className="order-card">
                <h4>Link fijo multi-sede (dueño)</h4>
                {!dashboardLinkUnlocked ? (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 12,
                    }}
                  >
                    <p>
                      El enlace y el QR multi-sede estan protegidos. Solo el
                      administrador puede mostrarlos.
                    </p>
                    <div className="actions">
                      <button type="button" onClick={requestDashboardLinkAccess}>
                        Mostrar con PIN admin
                      </button>
                    </div>
                  </div>
                ) : networkInfo.tunnelRegistryConfigured ? (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 12,
                    }}
                  >
                    <p style={{ fontWeight: 700 }}>
                      Modo gratis activo: las URLs se actualizan solas en GitHub.
                    </p>
                    <p style={{ wordBreak: "break-all" }}>
                      {masterPublicDashboardUrl}
                    </p>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "center",
                      }}
                    >
                      <div
                        style={{
                          background: "#fff",
                          padding: 12,
                          borderRadius: 8,
                        }}
                      >
                        <QRCode value={masterPublicDashboardUrl} />
                      </div>
                    </div>
                    <p>
                      Guarda este favorito en el celular del dueno. Aunque
                      reinicies el servidor, el dashboard encuentra las dos sedes
                      leyendo el registro gratis de GitHub.
                    </p>
                    <div className="actions">
                      <button
                        type="button"
                        onClick={() =>
                          copyToClipboard(
                            masterPublicDashboardUrl,
                            "link gratis multi-sede",
                          )
                        }
                      >
                        Copiar link del dueno
                      </button>
                      <button
                        type="button"
                        className="ghost"
                        onClick={() =>
                          window.open(
                            masterPublicDashboardUrl,
                            "_blank",
                            "noopener,noreferrer",
                          )
                        }
                      >
                        Abrir dashboard
                      </button>
                      <button
                        type="button"
                        className="ghost"
                        onClick={lockSensitiveDashboardLinks}
                      >
                        Ocultar enlaces
                      </button>
                    </div>
                  </div>
                ) : (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 12,
                    }}
                  >
                    <p>
                      Pega las URLs fijas HTTPS de cada sede (las de tu dominio
                      Cloudflare). Cuando las dos esten guardadas, el link del
                      dueno no cambia aunque reinicies el servidor.
                    </p>
                    <label htmlFor="owner-url-portoviejo">URL fija Portoviejo</label>
                    <input
                      id="owner-url-portoviejo"
                      value={ownerUrlDrafts.portoviejo}
                      onChange={(event) =>
                        setOwnerUrlDrafts((current) => ({
                          ...current,
                          portoviejo: event.target.value,
                        }))
                      }
                      placeholder="https://portoviejo.tudominio.com"
                    />
                    <label htmlFor="owner-url-chone">URL fija Chone</label>
                    <input
                      id="owner-url-chone"
                      value={ownerUrlDrafts.chone}
                      onChange={(event) =>
                        setOwnerUrlDrafts((current) => ({
                          ...current,
                          chone: event.target.value,
                        }))
                      }
                      placeholder="https://chone.tudominio.com"
                    />
                    <div className="actions">
                      <button type="button" onClick={saveOwnerDashboardUrls}>
                        Guardar URLs fijas del dueno
                      </button>
                    </div>
                    {permanentLinkReady ? (
                      <>
                        <p style={{ fontWeight: 700 }}>
                          Link permanente listo (no cambia al reiniciar):
                        </p>
                        <p style={{ wordBreak: "break-all" }}>
                          {masterPublicDashboardUrl}
                        </p>
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "center",
                          }}
                        >
                          <div
                            style={{
                              background: "#fff",
                              padding: 12,
                              borderRadius: 8,
                            }}
                          >
                            <QRCode value={masterPublicDashboardUrl} />
                          </div>
                        </div>
                        <div className="actions">
                          <button
                            type="button"
                            onClick={() =>
                              copyToClipboard(
                                masterPublicDashboardUrl,
                                "link permanente multi-sede",
                              )
                            }
                          >
                            Copiar link permanente
                          </button>
                          <button
                            type="button"
                            className="ghost"
                            onClick={() =>
                              window.open(
                                masterPublicDashboardUrl,
                                "_blank",
                                "noopener,noreferrer",
                              )
                            }
                          >
                            Abrir dashboard
                          </button>
                          <button
                            type="button"
                            className="ghost"
                            onClick={lockSensitiveDashboardLinks}
                          >
                            Ocultar enlaces
                          </button>
                        </div>
                      </>
                    ) : (
                      <p style={{ color: "#8a3f00" }}>
                        Completa y guarda las dos URLs fijas para generar el QR
                        permanente del dueno.
                      </p>
                    )}
                  </div>
                )}
              </article>

              <article className="order-card">
                <h4>Impresion automatica</h4>
                <p>
                  Cuando entra una comanda nueva, se envia sola a la impresora
                  de cocina.
                </p>
                <label className="switch-row">
                  <input
                    type="checkbox"
                    checked={autoPrintEnabled}
                    onChange={(event) =>
                      setAutoPrintEnabled(event.target.checked)
                    }
                  />
                  <span>{autoPrintEnabled ? "Activada" : "Desactivada"}</span>
                </label>
              </article>
            </div>

            {networkStatus ? <p className="loading">{networkStatus}</p> : null}
          </section>
        ) : null}
      </main>
      )}

      {payingOrder ? (
        <div className="modal-backdrop" onClick={closePayModal}>
          <article
            className="modal"
            onClick={(event) => event.stopPropagation()}
          >
            <h3>Cobro por abonos</h3>
            <p>
              {payingOrder.clientName} · {formatOrderLocation(payingOrder)}
            </p>

            <div className="service-type-row">
              <p className="service-type-label">Tipo de pedido</p>
              <div className="service-type-options">
                {SERVICE_TYPE_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={
                      paymentDraft.serviceType === option.id ? "" : "ghost"
                    }
                    onClick={() =>
                      setPaymentDraft((current) => ({
                        ...current,
                        serviceType: option.id,
                      }))
                    }
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            {getComments(payingOrder).length > 0 ? (
              <div className="comment-card" style={{ marginTop: "10px" }}>
                <h4 style={{ marginTop: "0", marginBottom: "8px" }}>
                  Comentarios
                </h4>
                {getComments(payingOrder).map((comment, index, comments) => (
                  <div
                    key={`${payingOrder.id}-comment-${index}`}
                    style={{
                      padding: "8px 0",
                      borderBottom:
                        index < comments.length - 1
                          ? "1px solid #f0e6d2"
                          : "none",
                    }}
                  >
                    <p style={{ margin: "0 0 4px 0", whiteSpace: "pre-wrap" }}>
                      {comment.text}
                    </p>
                    <p
                      style={{
                        margin: "0",
                        color: "#6f5e4d",
                        fontSize: "12px",
                      }}
                    >
                      {comment.author || "Mesero"} ·{" "}
                      {new Date(comment.createdAt).toLocaleString("es-CO")}
                    </p>
                  </div>
                ))}
              </div>
            ) : null}

            {getOrderExpenses(payingOrder).length > 0 ? (
              <div className="comment-card" style={{ marginTop: "10px" }}>
                <h4 style={{ marginTop: "0", marginBottom: "8px" }}>
                  Gastos adicionales
                </h4>
                {getOrderExpenses(payingOrder).map(
                  (expense, index, expenses) => (
                    <div
                      key={`${payingOrder.id}-expense-${index}`}
                      style={{
                        padding: "8px 0",
                        borderBottom:
                          index < expenses.length - 1
                            ? "1px solid #f0e6d2"
                            : "none",
                      }}
                    >
                      <p style={{ margin: "0 0 4px 0", fontWeight: 700 }}>
                        {expense.description}
                      </p>
                      <p
                        style={{
                          margin: 0,
                          color: "#6f5e4d",
                          fontSize: "12px",
                        }}
                      >
                        {formatCurrency(expense.amount ?? 0)}
                      </p>
                    </div>
                  ),
                )}
              </div>
            ) : null}

            <div className="payment-summary">
              <p>
                Total: <strong>{formatCurrency(payingOrder.total)}</strong>
              </p>
              <p>
                Abonado:{" "}
                <strong>{formatCurrency(paymentPreview.paidAmount)}</strong>
              </p>
              <p>
                Saldo pendiente:{" "}
                <strong>{formatCurrency(paymentPreview.balanceDue)}</strong>
              </p>
            </div>

            <div className="actions">
              <button
                type="button"
                className={
                  paymentDraft.paymentMethod === "efectivo" ? "" : "ghost"
                }
                onClick={() =>
                  setPaymentDraft((current) => ({
                    ...current,
                    paymentMethod: "efectivo",
                  }))
                }
              >
                Efectivo
              </button>
              <button
                type="button"
                className={
                  paymentDraft.paymentMethod === "transferencia" ? "" : "ghost"
                }
                onClick={() =>
                  setPaymentDraft((current) => ({
                    ...current,
                    paymentMethod: "transferencia",
                  }))
                }
              >
                Transferencia
              </button>
            </div>

            <div className="field-row">
              <label htmlFor="payment-amount">Monto a abonar</label>
              <input
                id="payment-amount"
                value={paymentDraft.amount}
                onChange={(event) =>
                  setPaymentDraft((current) => ({
                    ...current,
                    amount: event.target.value,
                  }))
                }
                placeholder="Ej: 5 o 5.25"
              />
            </div>

            {paymentDraft.paymentMethod === "efectivo" ? (
              <div className="field-row">
                <label htmlFor="payment-tendered">Recibido del cliente</label>
                <input
                  id="payment-tendered"
                  value={paymentDraft.tenderedAmount}
                  onChange={(event) =>
                    setPaymentDraft((current) => ({
                      ...current,
                      tenderedAmount: event.target.value,
                    }))
                  }
                  placeholder="Ej: 10"
                />
              </div>
            ) : null}

            {paymentDraft.paymentMethod === "transferencia" ? (
              <div className="field-row">
                <label htmlFor="payment-transfer-number">
                  Número de transferencia
                </label>
                <input
                  id="payment-transfer-number"
                  value={paymentDraft.transferenceNumber}
                  onChange={(event) =>
                    setPaymentDraft((current) => ({
                      ...current,
                      transferenceNumber: event.target.value,
                    }))
                  }
                  placeholder="Ej: TRF-1234567"
                />
              </div>
            ) : null}

            <div className="payment-summary">
              <p>
                Abono a registrar:{" "}
                <strong>{formatCurrency(paymentPreview.amount)}</strong>
              </p>
              {paymentDraft.paymentMethod === "efectivo" ? (
                <p>
                  Cambio a entregar:{" "}
                  <strong>{formatCurrency(paymentPreview.changeDue)}</strong>
                </p>
              ) : null}
            </div>

            {paymentPreview.submitMessage ? (
              <p className="inline-warning">{paymentPreview.submitMessage}</p>
            ) : null}

            <div className="actions">
              <button
                type="button"
                onClick={registerPayment}
                disabled={!paymentPreview.canSubmit}
              >
                Registrar abono
              </button>
              <button type="button" className="ghost" onClick={closePayModal}>
                Cerrar
              </button>
            </div>
          </article>
        </div>
      ) : null}

      {weightModalOrder ? (
        <div className="modal-backdrop" onClick={closeWeightModal}>
          <article
            className="modal modal-scrollable"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <h3>Completar gramaje</h3>
              <p>
                {weightModalOrder.clientName} ·{" "}
                {formatOrderLocation(weightModalOrder)}
              </p>
              <p style={{ color: "#6f5e4d", marginTop: 6, marginBottom: 0 }}>
                El mesero solo selecciona el corte. Aqui el cajero define los
                gramos antes de cobrar.
              </p>
            </div>

            <div className="modal-body">
              <div
                style={{
                  backgroundColor: "#fff",
                  border: "1px solid #ecdcc9",
                  borderRadius: "8px",
                  padding: "8px",
                }}
              >
                {weightModalOrder.items.filter(isWeightedItem).map((item) => {
                  const gramsPerUnit = getWeightDraftValues(
                    weightDrafts[item.menuItemId],
                    item.quantity,
                    item.weightGrams,
                  );
                  const parsedWeights = gramsPerUnit.map((value) =>
                    parseMoneyInput(value),
                  );
                  const weightFormula = resolveWeightFormulaForOrderItem(item);
                  const unitPrices = parsedWeights.map((grams) =>
                    grams > 0 ? calculateWeightedCutPrice(grams, weightFormula) : 0,
                  );
                  const subtotal =
                    Math.round(
                      (unitPrices.reduce((acc, value) => acc + value, 0) +
                        Number.EPSILON) *
                        100,
                    ) / 100;
                  const formulaLabel = getWeightFormulaLabel(weightFormula);

                  return (
                    <div
                      key={item.menuItemId}
                      style={{
                        padding: "10px 0",
                        borderBottom: "1px solid #f0e6d2",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 12,
                          marginBottom: 8,
                        }}
                      >
                        <div>
                          <p style={{ margin: "0 0 3px 0", fontWeight: "700" }}>
                            {item.name}
                          </p>
                          <p
                            style={{
                              margin: 0,
                              color: "#6f5e4d",
                              fontSize: "12px",
                            }}
                          >
                            {item.category}
                          </p>
                          <ItemPlateNote item={item} />
                        </div>
                        <div
                          style={{
                            textAlign: "right",
                            color: "#2f2319",
                            fontSize: "12px",
                            fontWeight: "700",
                          }}
                        >
                          {item.quantity} unidad
                          {item.quantity === 1 ? "" : "es"}
                        </div>
                      </div>

                      <div className="field-row">
                        <label htmlFor={`grams-${item.menuItemId}-0`}>
                          Gramaje por unidad
                        </label>
                        <div style={{ display: "grid", gap: 8 }}>
                          {gramsPerUnit.map((value, index) => (
                            <input
                              key={`${item.menuItemId}-${index}`}
                              id={`grams-${item.menuItemId}-${index}`}
                              value={value}
                              onChange={(event) =>
                                setWeightDrafts((current) => ({
                                  ...current,
                                  [item.menuItemId]: getWeightDraftValues(
                                    current[item.menuItemId],
                                    item.quantity,
                                    item.weightGrams,
                                  ).map((draftValue, draftIndex) =>
                                    draftIndex === index
                                      ? event.target.value
                                      : draftValue,
                                  ),
                                }))
                              }
                              placeholder={`Ej: 500 (unidad ${index + 1})`}
                            />
                          ))}
                        </div>
                      </div>

                      <div className="payment-summary" style={{ marginTop: 8 }}>
                        {formulaLabel ? (
                          <p
                            style={{
                              margin: "0 0 6px 0",
                              color: "#6f5e4d",
                              fontSize: "11px",
                            }}
                          >
                            Formula: {formulaLabel}
                          </p>
                        ) : null}
                        <p>
                          Subtotal linea:{" "}
                          <strong>{formatCurrency(subtotal)}</strong>
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="modal-footer">
              <div className="actions" style={{ marginTop: 0 }}>
                <button
                  type="button"
                  onClick={saveWeightModal}
                  disabled={hasPendingWeightValues}
                >
                  Guardar gramaje
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={closeWeightModal}
                >
                  Cerrar
                </button>
              </div>
              {hasPendingWeightValues ? (
                <p
                  style={{
                    marginTop: 8,
                    marginBottom: 0,
                    color: "#8b4d1d",
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  Completa los gramos de todos los cortes antes de guardar.
                </p>
              ) : null}
            </div>
          </article>
        </div>
      ) : null}

      {expenseModalOrder ? (
        <div className="modal-backdrop" onClick={closeExpenseModal}>
          <article
            className="modal modal-scrollable"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <h3>Gastos adicionales</h3>
              <p>
                {expenseModalOrder.clientName} ·{" "}
                {formatOrderLocation(expenseModalOrder)}
              </p>
              <p style={{ color: "#6f5e4d", marginTop: 6, marginBottom: 0 }}>
                Registra uno o varios cargos extra y la caja recalculará el
                total automáticamente.
              </p>
            </div>

            <div className="modal-body">
              {expenseModalError ? (
                <p className="inline-warning" style={{ marginTop: 0 }}>
                  {expenseModalError}
                </p>
              ) : null}
              <div style={{ display: "grid", gap: 12 }}>
                {expenseDrafts.map((draft, index) => (
                  <div
                    key={`expense-draft-${index}`}
                    style={{
                      backgroundColor: "#fff",
                      border: "1px solid #ecdcc9",
                      borderRadius: "8px",
                      padding: "12px",
                    }}
                  >
                    <div className="field-row">
                      <label htmlFor={`expense-description-${index}`}>
                        Descripción
                      </label>
                      <input
                        id={`expense-description-${index}`}
                        value={draft.description}
                        disabled={draft.kind === "container"}
                        onChange={(event) =>
                          updateExpenseDraft(
                            index,
                            "description",
                            event.target.value,
                          )
                        }
                        placeholder={
                          draft.kind === "container"
                            ? CONTAINER_EXPENSE_DESCRIPTION
                            : "Ej: cargo adicional"
                        }
                      />
                    </div>

                    <div className="field-row">
                      <label htmlFor={`expense-amount-${index}`}>Valor</label>
                      <input
                        id={`expense-amount-${index}`}
                        value={draft.amount}
                        disabled={draft.kind === "container"}
                        onChange={(event) =>
                          updateExpenseDraft(
                            index,
                            "amount",
                            event.target.value,
                          )
                        }
                        placeholder={
                          draft.kind === "container"
                            ? `${CONTAINER_EXPENSE_AMOUNT}`
                            : "Ej: 1.25"
                        }
                      />
                    </div>

                    {draft.kind === "container" ? (
                      <div className="field-row">
                        <label htmlFor={`expense-quantity-${index}`}>
                          Cantidad
                        </label>
                        <input
                          id={`expense-quantity-${index}`}
                          type="number"
                          min="1"
                          step="1"
                          value={draft.quantity ?? "1"}
                          onChange={(event) =>
                            updateExpenseDraft(
                              index,
                              "quantity",
                              event.target.value,
                            )
                          }
                        />
                      </div>
                    ) : null}

                    {draft.kind === "container" ? (
                      <p style={{ margin: "0 0 8px", color: "#8b4d1d" }}>
                        Total: {formatCurrency(getContainerExpenseTotal(draft.quantity))}.
                      </p>
                    ) : null}

                    <div className="actions" style={{ marginBottom: 0 }}>
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => removeExpenseDraft(index)}
                      >
                        Quitar
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="modal-footer">
              <div className="actions" style={{ marginTop: 0 }}>
                <button type="button" onClick={addExpenseDraft}>
                  Agregar gasto
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={saveExpenseModal}
                >
                  Guardar gastos
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={closeExpenseModal}
                >
                  Cerrar
                </button>
              </div>
            </div>
          </article>
        </div>
      ) : null}

      {openingCashModal ? (
        <div
          className="modal-backdrop"
          onClick={() => setOpeningCashModal(null)}
        >
          <article
            className="modal modal-security"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="security-flag">Apertura de caja</p>
            <h3>Ingresa el efectivo inicial</h3>
            <p className="security-note">
              Este valor se usa como base para validar el cierre del día.
            </p>

            <form
              onSubmit={(event) => {
                event.preventDefault();
                confirmOpeningCash();
              }}
            >
              <div className="security-field">
                <label htmlFor="opening-cash-amount">Efectivo inicial</label>
                <input
                  id="opening-cash-amount"
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  autoFocus
                  value={openingCashModal.amount}
                  onChange={(event) =>
                    setOpeningCashModal((current) =>
                      current
                        ? { ...current, amount: event.target.value, error: "" }
                        : current,
                    )
                  }
                  disabled={openingCashModal.loading}
                  placeholder="0.00"
                />
              </div>

              {openingCashModal.error ? (
                <p className="security-error">{openingCashModal.error}</p>
              ) : null}

              <div className="actions security-actions">
                <button type="submit" disabled={openingCashModal.loading}>
                  Guardar apertura
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => setOpeningCashModal(null)}
                  disabled={openingCashModal.loading}
                >
                  Cancelar
                </button>
              </div>
            </form>
          </article>
        </div>
      ) : null}

      {closingCashModal ? (
        <div
          className="modal-backdrop"
          onClick={() => setClosingCashModal(null)}
        >
          <article
            className="modal modal-security"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="security-flag">Cierre de caja</p>
            <h3>Arqueo final de la jornada</h3>
            <p className="security-note">
              Ingresa lo que hay en efectivo y transferencia antes de cerrar.
            </p>

            <div className="cash-opening-reminder">
              <span>Caja inicial para este cierre</span>
              <strong>{formatCurrency(closingPreview.openingCash)}</strong>
              <p>
                Ingresa caja inicial, efectivo y transferencia. Al cerrar, la
                jornada se limpia y el detalle queda en Estadísticas e histórico.
              </p>
            </div>

            <form
              onSubmit={(event) => {
                event.preventDefault();
                confirmClosingCash();
              }}
            >
              <div className="security-field">
                <label htmlFor="closing-opening-cash">Caja inicial</label>
                <input
                  id="closing-opening-cash"
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  autoFocus
                  value={closingCashModal.openingCash}
                  onChange={(event) =>
                    setClosingCashModal((current) =>
                      current
                        ? { ...current, openingCash: event.target.value, error: "" }
                        : current,
                    )
                  }
                  disabled={closingCashModal.loading}
                  placeholder="0.00"
                />
              </div>

              <div className="security-field">
                <label htmlFor="closing-cash-amount">
                  Efectivo contado en caja
                </label>
                <input
                  id="closing-cash-amount"
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={closingCashModal.countedCash}
                  onChange={(event) =>
                    setClosingCashModal((current) =>
                      current
                        ? { ...current, countedCash: event.target.value, error: "" }
                        : current,
                    )
                  }
                  disabled={closingCashModal.loading}
                  placeholder="0.00"
                />
              </div>

              <div className="security-field">
                <label htmlFor="closing-transfer-amount">Transferencia contada</label>
                <input
                  id="closing-transfer-amount"
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={closingCashModal.countedTransfer}
                  onChange={(event) =>
                    setClosingCashModal((current) =>
                      current
                        ? { ...current, countedTransfer: event.target.value, error: "" }
                        : current,
                    )
                  }
                  disabled={closingCashModal.loading}
                  placeholder="0.00"
                />
              </div>

              {closingCashModal.error ? (
                <p className="security-error">{closingCashModal.error}</p>
              ) : null}

              <div className="actions security-actions">
                <button type="submit" disabled={closingCashModal.loading}>
                  Cerrar jornada
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => setClosingCashModal(null)}
                  disabled={closingCashModal.loading}
                >
                  Cancelar
                </button>
              </div>
            </form>
          </article>
        </div>
      ) : null}

      {confirmModal ? (
        <div className="modal-backdrop" onClick={() => setConfirmModal(null)}>
          <article
            className="modal"
            onClick={(event) => event.stopPropagation()}
          >
            <h3>{confirmModal.title}</h3>
            <p>{confirmModal.message}</p>
            {confirmModal.hasDateInput ? (
              <div style={{ marginBottom: 16 }}>
                <label
                  style={{
                    display: "block",
                    fontSize: "0.9rem",
                    marginBottom: 6,
                    fontWeight: 700,
                  }}
                >
                  Selecciona la fecha límite:
                </label>
                <input
                  type="date"
                  value={cleanupDateInput}
                  onChange={(e) => setCleanupDateInput(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    border: "1px solid #e2d4c2",
                    borderRadius: "8px",
                    fontSize: "0.95rem",
                    boxSizing: "border-box",
                  }}
                />
              </div>
            ) : null}
            <div className="actions">
              <button
                type="button"
                className={confirmModal.isDanger ? "danger" : ""}
                onClick={() => {
                  confirmModal.action();
                }}
                disabled={loading}
              >
                {loading ? "Procesando..." : confirmModal.confirmText}
              </button>
              <button
                type="button"
                className="ghost"
                onClick={() => setConfirmModal(null)}
                disabled={loading}
              >
                {confirmModal.cancelText}
              </button>
            </div>
          </article>
        </div>
      ) : null}

      {protectedViewModal ? (
        <div
          className="modal-backdrop"
          onClick={() => setProtectedViewModal(null)}
        >
          <article
            className="modal modal-security"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="security-flag">Acceso restringido</p>
            <h3>{getProtectedViewCopy(protectedViewModal.targetView).title}</h3>
            <p className="security-note">
              {getProtectedViewCopy(protectedViewModal.targetView).note}
            </p>

            <form
              onSubmit={(event) => {
                event.preventDefault();
                confirmProtectedView();
              }}
            >
              <div className="security-field">
                <label htmlFor="stats-access-pin">PIN de acceso</label>
                <input
                  id="stats-access-pin"
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  autoFocus
                  maxLength={6}
                  value={protectedViewModal.pin}
                  onChange={(event) =>
                    setProtectedViewModal((current) =>
                      current
                        ? { ...current, pin: event.target.value, error: "" }
                        : current,
                    )
                  }
                  placeholder="⬢⬢⬢⬢⬢⬢"
                  disabled={protectedViewModal.loading}
                />
              </div>

              {protectedViewModal.error ? (
                <p className="security-error">{protectedViewModal.error}</p>
              ) : null}

              <div className="actions security-actions">
                <button type="submit" disabled={protectedViewModal.loading}>
                  Entrar
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => setProtectedViewModal(null)}
                  disabled={protectedViewModal.loading}
                >
                  Cancelar
                </button>
              </div>
            </form>
          </article>
        </div>
      ) : null}

      {deleteOrderModal ? (
        <div
          className="modal-backdrop"
          onClick={deleteOrderModal.loading ? undefined : closeDeleteOrderModal}
        >
          <article
            className="modal modal-security"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="security-flag">Acceso restringido</p>
            <h3>Eliminar cuenta</h3>
            <p className="security-copy">
              {deleteOrderModal.order.id} · {deleteOrderModal.order.clientName}{" "}
              · {formatOrderLocation(deleteOrderModal.order)}
            </p>
            <p className="security-note">
              Ingresa el PIN de seguridad para autorizar esta eliminación. La
              acción no se puede deshacer.
            </p>

            <form
              onSubmit={(event) => {
                event.preventDefault();
                confirmDeleteOrder();
              }}
            >
              <div className="security-field">
                <label htmlFor="delete-order-pin">PIN de seguridad</label>
                <input
                  id="delete-order-pin"
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  autoFocus
                  maxLength={6}
                  value={deleteOrderModal.pin}
                  onChange={(event) =>
                    setDeleteOrderModal((current) =>
                      current
                        ? { ...current, pin: event.target.value, error: "" }
                        : current,
                    )
                  }
                  placeholder="⬢⬢⬢⬢⬢⬢"
                  disabled={deleteOrderModal.loading}
                />
              </div>

              {deleteOrderModal.error ? (
                <p className="security-error">{deleteOrderModal.error}</p>
              ) : null}

              <div className="actions security-actions">
                <button
                  type="submit"
                  className="danger"
                  disabled={deleteOrderModal.loading}
                >
                  {deleteOrderModal.loading
                    ? "Eliminando..."
                    : "Eliminar cuenta"}
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={closeDeleteOrderModal}
                  disabled={deleteOrderModal.loading}
                >
                  Cancelar
                </button>
              </div>
            </form>
          </article>
        </div>
      ) : null}

      {selectedPaidOrder ? (
        <div
          className="modal-backdrop"
          onClick={() => setSelectedPaidOrder(null)}
        >
          <article
            className="modal"
            onClick={(event) => event.stopPropagation()}
            style={{ maxHeight: "90vh", overflowY: "auto" }}
          >
            {(() => {
              const { summary, editedIds } = getEditSummary(selectedPaidOrder);
              const comments = getComments(selectedPaidOrder);
              return (
                <>
                  <h3>Detalles de la comanda pagada</h3>
                  <p>
                    {selectedPaidOrder.clientName} ·{" "}
                    {formatOrderLocation(selectedPaidOrder)}
                  </p>

                  {summary.length > 0 ? (
                    <div
                      className="order-edit-summary"
                      style={{ marginTop: "10px" }}
                    >
                      <p className="order-edit-summary-title">
                        Cambios recientes
                      </p>
                      {summary.map((change) => (
                        <div
                          key={`${selectedPaidOrder.id}-${change.menuItemId}-${change.type}`}
                          className="order-edit-summary-item"
                        >
                          <strong>{change.name}</strong>
                          <span>{getEditChangeLabel(change)}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {selectedPaidOrder.expenses &&
                  selectedPaidOrder.expenses.length > 0 ? (
                    <div className="comment-card" style={{ marginTop: "10px" }}>
                      <h4 style={{ marginTop: "0", marginBottom: "8px" }}>
                        Gastos adicionales
                      </h4>
                      {selectedPaidOrder.expenses.map(
                        (expense, index, expenses) => (
                          <div
                            key={`${selectedPaidOrder.id}-expense-${index}`}
                            style={{
                              padding: "8px 0",
                              borderBottom:
                                index < expenses.length - 1
                                  ? "1px solid #f0e6d2"
                                  : "none",
                            }}
                          >
                            <p style={{ margin: "0 0 4px 0", fontWeight: 700 }}>
                              {getExpenseLabel(expense)}
                            </p>
                            <p
                              style={{
                                margin: 0,
                                color: "#6f5e4d",
                                fontSize: "12px",
                              }}
                            >
                              {formatCurrency(expense.amount ?? 0)}
                            </p>
                          </div>
                        ),
                      )}
                    </div>
                  ) : null}

                  <div className="payment-summary">
                    <p>
                      Total:{" "}
                      <strong>{formatCurrency(selectedPaidOrder.total)}</strong>
                    </p>
                    <p>
                      Estado:{" "}
                      <strong>
                        {selectedPaidOrder.status === "paid"
                          ? "Pagada"
                          : "Abonada"}
                      </strong>
                    </p>
                  </div>

                  {comments.length > 0 ? (
                    <div className="comment-card" style={{ marginTop: "10px" }}>
                      <h4 style={{ marginTop: "0", marginBottom: "8px" }}>
                        Comentarios
                      </h4>
                      {comments.map((comment, index) => (
                        <div
                          key={`${selectedPaidOrder.id}-comment-${index}`}
                          style={{
                            padding: "8px 0",
                            borderBottom:
                              index < comments.length - 1
                                ? "1px solid #f0e6d2"
                                : "none",
                          }}
                        >
                          <p
                            style={{
                              margin: "0 0 4px 0",
                              whiteSpace: "pre-wrap",
                            }}
                          >
                            {comment.text}
                          </p>
                          <p
                            style={{
                              margin: "0",
                              color: "#6f5e4d",
                              fontSize: "12px",
                            }}
                          >
                            {comment.author || "Mesero"} ·{" "}
                            {new Date(comment.createdAt).toLocaleString(
                              "es-CO",
                            )}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  <h4 style={{ marginTop: "12px", marginBottom: "8px" }}>
                    Items pedidos:
                  </h4>
                  <div
                    style={{
                      backgroundColor: "#fff",
                      border: "1px solid #ecdcc9",
                      borderRadius: "8px",
                      padding: "8px",
                    }}
                  >
                    {selectedPaidOrder.items.map((item) => (
                      <div
                        key={`${selectedPaidOrder.id}-${item.menuItemId}`}
                        className={
                          editedIds.has(item.menuItemId)
                            ? "order-item-edited"
                            : ""
                        }
                        style={{
                          padding: "6px 0",
                          borderBottom: "1px solid #f0e6d2",
                          fontSize: "14px",
                        }}
                      >
                        <p style={{ margin: "0 0 2px 0" }}>
                          {item.quantity}x {item.name}
                          {formatWeightBreakdown(item)
                            ? ` (${formatWeightBreakdown(item)})`
                            : ""}
                        </p>
                        <ItemPlateNote item={item} />
                        <p
                          style={{
                            margin: "0",
                            color: "#6f5e4d",
                            fontSize: "12px",
                          }}
                        >
                          {item.category}
                        </p>
                        <p
                          style={{
                            margin: "2px 0 0",
                            color: "#6f5e4d",
                            fontSize: "12px",
                          }}
                        >
                          Subtotal: {formatCurrency(item.subtotal ?? 0)}
                        </p>
                      </div>
                    ))}
                  </div>

                  <h4 style={{ marginTop: "12px", marginBottom: "8px" }}>
                    Pagos realizados:
                  </h4>
                  <div
                    style={{
                      backgroundColor: "#fff",
                      border: "1px solid #ecdcc9",
                      borderRadius: "8px",
                      padding: "8px",
                    }}
                  >
                    {selectedPaidOrder.payments &&
                    selectedPaidOrder.payments.length > 0 ? (
                      selectedPaidOrder.payments.map((payment, index) => (
                        <div
                          key={index}
                          style={{
                            padding: "8px 0",
                            borderBottom:
                              index < selectedPaidOrder.payments.length - 1
                                ? "1px solid #f0e6d2"
                                : "none",
                          }}
                        >
                          <p style={{ margin: "0 0 4px 0", fontWeight: "700" }}>
                            {payment.paymentMethod === "efectivo"
                              ? "Efectivo"
                              : "Transferencia"}
                          </p>
                          <p style={{ margin: "0 0 2px 0", color: "#2f2319" }}>
                            Monto: {formatCurrency(payment.amount)}
                          </p>
                          {payment.paymentMethod === "transferencia" &&
                          payment.transferenceNumber ? (
                            <p
                              style={{
                                margin: "0 0 2px 0",
                                color: "#2f2319",
                                fontSize: "12px",
                              }}
                            >
                              Ref: <strong>{payment.transferenceNumber}</strong>
                            </p>
                          ) : null}
                          <p
                            style={{
                              margin: "0",
                              color: "#6f5e4d",
                              fontSize: "12px",
                            }}
                          >
                            {new Date(payment.createdAt).toLocaleString(
                              "es-CO",
                            )}
                          </p>
                        </div>
                      ))
                    ) : (
                      <p style={{ color: "#6f5e4d" }}>Sin pagos registrados</p>
                    )}
                  </div>

                  <div className="actions" style={{ marginTop: "12px" }}>
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => setSelectedPaidOrder(null)}
                    >
                      Cerrar
                    </button>
                  </div>
                </>
              );
            })()}
          </article>
        </div>
      ) : null}

      {dayDetailModal
        ? createPortal(
            <div
              className="modal-backdrop"
              role="presentation"
              onClick={() => setDayDetailModal(null)}
            >
              <article
                className="modal modal-day-detail"
                onClick={(event) => event.stopPropagation()}
              >
                <h3>{formatCalendarDayLabel(dayDetailModal.date)}</h3>
                <p style={{ color: "#6f5e4d", marginTop: 0 }}>
                  {dayDetailModal.date}
                </p>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 12,
                    marginBottom: 16,
                  }}
                >
                  <div
                    style={{
                      padding: 12,
                      background: "#fff9f2",
                      borderRadius: 8,
                      border: "1px solid #e8d8c5",
                    }}
                  >
                    <p
                      style={{
                        margin: 0,
                        fontSize: "0.85rem",
                        color: "#8a6f55",
                      }}
                    >
                      Total ventas
                    </p>
                    <strong style={{ fontSize: "1.4rem", color: "#2f8f73" }}>
                      {formatCurrency(dayDetailModal.totalSales)}
                    </strong>
                  </div>
                  <div
                    style={{
                      padding: 12,
                      background: "#fff9f2",
                      borderRadius: 8,
                      border: "1px solid #e8d8c5",
                    }}
                  >
                    <p
                      style={{
                        margin: 0,
                        fontSize: "0.85rem",
                        color: "#8a6f55",
                      }}
                    >
                      Pedidos
                    </p>
                    <strong style={{ fontSize: "1.4rem" }}>
                      {dayDetailModal.orders}
                    </strong>
                  </div>
                </div>

                {dayDetailModal.paymentMethods &&
                dayDetailModal.paymentMethods.length > 0 ? (
                  <div style={{ marginBottom: 16 }}>
                    <h4 style={{ margin: "0 0 10px" }}>Métodos de pago</h4>
                    <div style={{ display: "grid", gap: 8 }}>
                      {dayDetailModal.paymentMethods.map((pm) => (
                        <div
                          key={pm.method}
                          style={{
                            padding: 10,
                            background: "#fffaf1",
                            borderRadius: 8,
                            display: "flex",
                            justifyContent: "space-between",
                          }}
                        >
                          <span
                            style={{
                              fontWeight: 700,
                              textTransform: "capitalize",
                            }}
                          >
                            {pm.method === "efectivo"
                              ? "Efectivo"
                              : "Transferencia"}
                          </span>
                          <strong>{formatCurrency(pm.total)}</strong>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {dayDetailModal.topDishes &&
                dayDetailModal.topDishes.length > 0 ? (
                  <div style={{ marginBottom: 16 }}>
                    <h4 style={{ margin: "0 0 10px" }}>Platos más vendidos</h4>
                    <div style={{ display: "grid", gap: 8 }}>
                      {dayDetailModal.topDishes.map((dish, idx) => (
                        <div
                          key={`${dish.name}-${idx}`}
                          style={{
                            padding: 10,
                            background: "#fffaf1",
                            borderRadius: 8,
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                          }}
                        >
                          <div>
                            <strong style={{ display: "block" }}>
                              {dish.name}
                            </strong>
                            <small style={{ color: "#8a6f55" }}>
                              {dish.quantity} vendidos
                            </small>
                          </div>
                          <strong style={{ color: "#2f8f73" }}>
                            {formatCurrency(dish.revenue)}
                          </strong>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="actions">
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => setDayDetailModal(null)}
                  >
                    Cerrar
                  </button>
                </div>
              </article>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

export default App;
