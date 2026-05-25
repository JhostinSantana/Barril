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
        value.dailyStats ||
        value.allTimeStats ||
        value.statsSummary ||
        value.cashSession),
  );
}

function isLocalhostBackendUrl(value) {
  const normalized = `${value ?? ""}`.trim().toLowerCase();
  return (
    !normalized ||
    normalized.includes("localhost") ||
    normalized.includes("127.0.0.1") ||
    normalized.includes("10.0.2.2")
  );
}

const DELETE_ACCOUNT_PIN = "040420";
const STATS_ACCESS_PIN = "040420";
const BOGOTA_TIME_ZONE = "America/Bogota";
const SERVICE_TYPE_OPTIONS = [
  { id: "mesa", label: "Mesa" },
  { id: "para_llevar", label: "Para llevar" },
];
const PUBLIC_DASHBOARD_URL = "https://jhostinsantana.github.io/Barril/";

function isPublicPagesView() {
  if (typeof window === "undefined") return false;

  return (
    window.location.hostname.includes("github.io") &&
    window.location.pathname.includes("/Barril/")
  );
}

function normalizePublicBackendUrl(value) {
  return `${value ?? ""}`.trim().replace(/\/+$/, "");
}

function buildPublicDashboardUrl(backendUrl) {
  const normalizedUrl = normalizePublicBackendUrl(backendUrl);
  if (!normalizedUrl) return "";

  const url = new URL(PUBLIC_DASHBOARD_URL);
  url.searchParams.set("api", normalizedUrl);
  url.searchParams.set("socket", normalizedUrl);
  return url.toString();
}

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

function normalizeCashSession(value) {
  const openingCash = Number(value?.openingCash ?? 0);
  const closingReport = value?.closingReport ?? null;
  return {
    openingCash: Number.isFinite(openingCash) ? openingCash : 0,
    openingConfirmed: Boolean(value?.openingConfirmed),
    sessionKey: typeof value?.sessionKey === "string" ? value.sessionKey : null,
    closingReport:
      closingReport && typeof closingReport === "object"
        ? {
            countedCash:
              closingReport.countedCash != null
                ? Number(closingReport.countedCash)
                : null,
            countedTransfer:
              closingReport.countedTransfer != null
                ? Number(closingReport.countedTransfer)
                : null,
            expectedCash:
              closingReport.expectedCash != null
                ? Number(closingReport.expectedCash)
                : null,
            expectedTransfer:
              closingReport.expectedTransfer != null
                ? Number(closingReport.expectedTransfer)
                : null,
            differenceCash:
              closingReport.differenceCash != null
                ? Number(closingReport.differenceCash)
                : null,
            differenceTransfer:
              closingReport.differenceTransfer != null
                ? Number(closingReport.differenceTransfer)
                : null,
            matches: Boolean(closingReport.matches),
            closedAt: closingReport.closedAt ?? null,
          }
        : null,
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

function getCurrentMonthRange() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BOGOTA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === "year")?.value ?? 0);
  const month = Number(parts.find((part) => part.type === "month")?.value ?? 0);
  return {
    from: new Date(Date.UTC(year, month - 1, 1, 5, 0, 0, 0)).toISOString(),
    to: new Date(Date.UTC(year, month, 1, 4, 59, 59, 999)).toISOString(),
  };
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

function getBogotaDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BOGOTA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function getBogotaDayRange(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BOGOTA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

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
    (order) => !order?.createdAt || order.createdAt >= cutoff,
  );
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
    sessionKey: null,
  });
  const [cashSessionCutoff, setCashSessionCutoff] = useState(() =>
    loadCashSessionCutoff(),
  );
  const [historyDate, setHistoryDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [historyOrders, setHistoryOrders] = useState([]);
  const [historyGrouped, setHistoryGrouped] = useState([]);
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
  const [publicApiDraft, setPublicApiDraft] = useState("");
  const [restaurantNameDraft, setRestaurantNameDraft] = useState("");
  const [networkStatus, setNetworkStatus] = useState("");
  const [waiterStatus, setWaiterStatus] = useState("");
  const [autoPrintEnabled, setAutoPrintEnabled] = useState(true);
  const [confirmModal, setConfirmModal] = useState(null);
  const [protectedViewModal, setProtectedViewModal] = useState(null);
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
  const [publicBackendDraft, setPublicBackendDraft] = useState(() =>
    readStoredPublicApiBaseUrl(),
  );
  const [publicBackendConnected, setPublicBackendConnected] = useState(false);
  const openingCashPromptedRef = useRef(false);
  const publicPagesView = isPublicPagesView();
  const stats = publicPagesView ? allTimeStats : dailyStats;
  const publicBackendUrl = normalizePublicBackendUrl(
    publicApiDraft || networkInfo.publicApiUrl,
  );
  const publicDashboardUrl = buildPublicDashboardUrl(publicBackendUrl);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setBogotaDayKey(getBogotaDateKey());
    }, 60000);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (publicPagesView) return;
    if (!cashSessionHydrated) return;

    if (cashSession.sessionKey !== bogotaDayKey) {
      openingCashPromptedRef.current = false;
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
      if (activeView === "cash" && !openingCashModal) {
        setOpeningCashModal({
          amount: "0",
          error: "",
          loading: false,
        });
      }
      return;
    }

    if (activeView !== "cash") {
      openingCashPromptedRef.current = false;
      return;
    }

    if (!cashSession.openingConfirmed && !openingCashModal && !openingCashPromptedRef.current) {
      openingCashPromptedRef.current = true;
      setOpeningCashModal({
        amount: `${cashSession.openingCash ?? 0}`,
        error: "",
        loading: false,
      });
    }
  }, [activeView, bogotaDayKey, cashSession.openingConfirmed, cashSession.sessionKey, cashSessionHydrated, openingCashModal, publicPagesView]);

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

    setActiveView(protectedViewModal.targetView);
    setProtectedViewModal(null);
  }

  function openOpeningCashModal() {
    setOpeningCashModal({
      amount: `${cashSession.openingCash ?? 0}`,
      error: "",
      loading: false,
    });
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
      countedCash: "",
      countedTransfer: "",
      error: "",
      loading: false,
    });
  }

  async function confirmClosingCash() {
    if (!closingCashModal) return;

    if (
      `${closingCashModal.countedCash ?? ""}`.trim() === "" ||
      `${closingCashModal.countedTransfer ?? ""}`.trim() === ""
    ) {
      setClosingCashModal((current) =>
        current ? { ...current, loading: false, error: "Completa efectivo y transferencia." } : current,
      );
      return;
    }

    const countedCash = parseMoneyInput(closingCashModal.countedCash);
    const countedTransfer = parseMoneyInput(closingCashModal.countedTransfer);
    const openingCash = Number(cashSession.openingCash ?? cashClose.openingCash ?? 0);
    const expectedCash = roundMoney(openingCash + Number(cashClose.efectivo ?? 0));
    const expectedTransfer = roundMoney(Number(cashClose.transferencia ?? 0));
    const closingReport = {
      countedCash,
      countedTransfer,
      expectedCash,
      expectedTransfer,
      differenceCash: roundMoney(countedCash - expectedCash),
      differenceTransfer: roundMoney(countedTransfer - expectedTransfer),
      matches:
        roundMoney(countedCash - expectedCash) === 0 &&
        roundMoney(countedTransfer - expectedTransfer) === 0,
      closedAt: new Date().toISOString(),
    };

    setClosingCashModal((current) =>
      current ? { ...current, loading: true, error: "" } : current,
    );

    try {
      const nextSession = await getJson("/api/settings/cash-session", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          closingReport,
          openingConfirmed: false,
          openingCash: 0,
        }),
      });
      const normalizedSession = normalizeCashSession(nextSession);
      setCashSession(normalizedSession);
      setCashClose((current) => ({
        ...current,
        openingCash,
        expectedCash,
        countedCash,
        countedTransfer,
        matches: closingReport.matches,
        differenceCash: closingReport.differenceCash,
        differenceTransfer: closingReport.differenceTransfer,
        closedAt: closingReport.closedAt,
      }));
      setClosingCashModal(null);
      await startNewDay();
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

    if (Array.isArray(snapshot.pendingOrders)) setPendingOrders(snapshot.pendingOrders);
    if (Array.isArray(snapshot.paidOrders)) setPaidOrders(snapshot.paidOrders);
    if (snapshot.cashClose) setCashClose(snapshot.cashClose);
    if (snapshot.cashSession) setCashSession(normalizeCashSession(snapshot.cashSession));
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

    if (snapshot.restaurantName) {
      setRestaurantName(snapshot.restaurantName);
      setRestaurantNameDraft(snapshot.restaurantName);
    }
    if (Array.isArray(snapshot.pendingOrders)) setPendingOrders(snapshot.pendingOrders);
    if (Array.isArray(snapshot.paidOrders)) setPaidOrders(snapshot.paidOrders);
    if (snapshot.cashClose) setCashClose(snapshot.cashClose);
    if (snapshot.cashSession) setCashSession(normalizeCashSession(snapshot.cashSession));
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

  const beverageCategories = useMemo(
    () => stats.categories.filter((category) => category.label === "BEBIDAS"),
    [stats.categories],
  );

  const foodCategories = useMemo(
    () => stats.categories.filter((category) => category.label !== "BEBIDAS"),
    [stats.categories],
  );

  const maxPaymentAmount = useMemo(
    () => Math.max(...stats.paymentSummary.map((item) => item.amount), 0),
    [stats.paymentSummary],
  );

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

  function savePublicBackendUrl() {
    const nextUrl = publicBackendDraft.trim().replace(/\/+$/, "");
    if (!nextUrl) {
      setNetworkStatus("Debes pegar la URL HTTPS del servidor.");
      return;
    }
    if (!/^https:\/\//i.test(nextUrl)) {
      setNetworkStatus("La URL publica debe iniciar con https://.");
      return;
    }
    writeStoredPublicApiBaseUrl(nextUrl);
    writeStoredPublicSocketUrl(nextUrl);
    setApiBaseUrl(nextUrl);
    window.location.href = `${window.location.pathname}?api=${encodeURIComponent(nextUrl)}&socket=${encodeURIComponent(nextUrl)}`;
  }

  const loadCashView = useCallback(async ({ silent = false } = {}) => {
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
        cashSessionCutoff,
      );
      const filteredPaid = filterOrdersByCashSession(paid, cashSessionCutoff);
      const normalizedCashSession = normalizeCashSession(cashSessionResult);
      const closingReport = normalizedCashSession.closingReport;
      const openingCash = normalizedCashSession.openingCash;
      const filteredClose = cashSessionCutoff
        ? buildCashCloseFromOrders(
            [...filteredPending, ...filteredPaid],
            cashSessionCutoff,
            openingCash,
          )
        : close;
      const reconciledClose = {
        ...filteredClose,
        openingCash,
        expectedCash: roundMoney(openingCash + Number(filteredClose.efectivo ?? 0)),
        expectedTransfer: Number(filteredClose.transferencia ?? 0),
        countedCash: closingReport?.countedCash ?? null,
        countedTransfer: closingReport?.countedTransfer ?? null,
        matches: closingReport?.matches ?? null,
        differenceCash: closingReport?.differenceCash ?? null,
        differenceTransfer: closingReport?.differenceTransfer ?? null,
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
  }, [cashSessionCutoff, getJson, publicPagesView]);

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

  async function startNewDay() {
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
          closingReport: cashSession.closingReport,
          sessionKey: bogotaDayKey,
        }),
      });
      setCashSession((current) => ({
        ...current,
        openingCash: 0,
        openingConfirmed: false,
      }));
      setConfirmModal(null);
      setActiveView("history");
      setPendingOrders([]);
      setPaidOrders([]);
      setQuery("");
      setPayingOrder(null);
      setSelectedPaidOrder(null);
      setDayDetailModal(null);
      await Promise.all([loadStatsView(), loadRecentHistory(7)]);
      setNetworkStatus("Cierre de caja realizado. Moviendo a dias anteriores.");
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
        const iso = d.toISOString().slice(0, 10);
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
    } catch (error) {
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
  }, [getJson]);

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
          setNetworkStatus("Base de datos limpiada completamente.");
          setConfirmModal(null);
          setDayDetailModal(null);
          await loadCashView();
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

  async function savePublicUrl() {
    const nextPublicApiUrl = normalizePublicBackendUrl(publicApiDraft);
    const payload = await getJson("/api/network-info/public-url", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ publicApiUrl: nextPublicApiUrl }),
    });
    setNetworkInfo((current) => ({
      ...current,
      publicApiUrl: payload.publicApiUrl,
    }));
    setPublicApiDraft(payload.publicApiUrl);
    setNetworkStatus("URL publica guardada.");
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
    }

    socket.connect();

    let publicFallbackTimer = null;
    if (publicPagesView) {
      loadPublicDashboardSnapshot().catch(() => {
        setPublicBackendConnected(false);
        if (hydratePublicDashboardSnapshot()) {
          setNetworkStatus("Sin backend activo. Mostrando el ultimo estado guardado.");
          return;
        }
        setNetworkStatus("Sin conexion con el backend publico.");
      });
      publicFallbackTimer = window.setInterval(() => {
        loadPublicDashboardSnapshot().catch(() => {
          if (!hydratePublicDashboardSnapshot()) {
            setPublicBackendConnected(false);
            setNetworkStatus("Sin conexion con el backend publico.");
          }
        });
      }, 30000);
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
    publicPagesView,
    triggerAutoPrint,
  ]);

  if (publicPagesView) {
    const topPaidOrders = paidOrdersForDisplay.slice(0, 4);
    const topDishes = stats.topDishes.slice(0, 5);
    const bottomDishes = stats.bottomDishes.slice(0, 5);
    const paymentTotal = stats.paymentSummary.reduce(
      (acc, item) => acc + Number(item.amount ?? 0),
      0,
    );
    const statusLabel = networkStatus
      ? networkStatus
      : publicBackendConnected
        ? "Conectado al servidor"
        : "Esperando datos del servidor";

    return (
      <main className="public-shell">
        <header className="public-header">
          <div>
            <p className="eyebrow">Barril · dashboard público</p>
            <h1 className="public-title">Ventas y ganancias en vivo</h1>
            <p className="public-lead">
              Esta página lee el estado sincronizado del servidor SQLite y
              muestra pedidos, cobros y ranking en tiempo real.
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
            <span>{statusLabel}</span>
          </div>
        </header>

        <div className="stats-hero">
          <article className="stats-banner">
            <p className="eyebrow">Resumen del día</p>
            <h3>{formatCurrency(statsSummary.today.total)} en ventas hoy</h3>
            <p>
              Pedidos pagos, ranking histórico y métodos de cobro actualizados
              desde el backend.
            </p>
          </article>

          <div className="kpi-grid stats-kpi-grid">
            <article className="kpi-card">
              <h3>Ganancias</h3>
              <strong>{formatCurrency(statsSummary.today.total)}</strong>
              <p>Ventas cobradas hoy</p>
            </article>
            <article className="kpi-card">
              <h3>Pendientes</h3>
              <strong>{pendingOrders.length}</strong>
              <p>Pedidos sin cobrar</p>
            </article>
            <article className="kpi-card">
              <h3>Pagados</h3>
              <strong>{paidOrdersForDisplay.length}</strong>
              <p>Pedidos cerrados</p>
            </article>
            <article className="kpi-card">
              <h3>Contenedores</h3>
              <strong>{formatCurrency(stats.containerSummary.revenue)}</strong>
              <p>{stats.containerSummary.quantity} unidades</p>
            </article>
          </div>
        </div>

        <div className="stats-split-grid" style={{ marginTop: 18 }}>
          <section className="stats-panel">
            <div className="section-header stats-panel-head">
              <div>
                <h3>Caja y apertura</h3>
                <p style={{ margin: "6px 0 0", color: "#6f5e4d" }}>
                  Estado sincronizado de la jornada
                </p>
              </div>
              <span className="stats-chip">Caja</span>
            </div>

            <div className="stats-item-list">
              <div className="stats-item-row">
                <div>
                  <strong>Apertura de caja</strong>
                  <p>Fondo inicial del turno</p>
                </div>
                <span>{formatCurrency(cashClose.openingCash)}</span>
              </div>
              <div className="stats-item-row">
                <div>
                  <strong>Efectivo esperado</strong>
                  <p>Con base en ventas cobradas</p>
                </div>
                <span>{formatCurrency(cashClose.expectedCash)}</span>
              </div>
              <div className="stats-item-row">
                <div>
                  <strong>Transferencia esperada</strong>
                  <p>Total previsto por pagos electrónicos</p>
                </div>
                <span>{formatCurrency(cashClose.expectedTransfer)}</span>
              </div>
              {cashClose.matches === true ? (
                <div className="stats-item-row">
                  <div>
                    <strong>Arqueo validado</strong>
                    <p>La caja cuadró en el último cierre</p>
                  </div>
                  <span>Sí</span>
                </div>
              ) : null}
            </div>
          </section>

          <section className="stats-panel">
            <div className="section-header stats-panel-head">
              <div>
                <h3>Último cierre</h3>
                <p style={{ margin: "6px 0 0", color: "#6f5e4d" }}>
                  Solo se marca cuando coincide
                </p>
              </div>
              <span className="stats-chip">Cierre</span>
            </div>

            <div className="stats-item-list">
              <div className="stats-item-row">
                <div>
                  <strong>Efectivo contado</strong>
                  <p>Conteo manual al cerrar</p>
                </div>
                <span>{formatCurrency(cashClose.countedCash ?? 0)}</span>
              </div>
              <div className="stats-item-row">
                <div>
                  <strong>Transferencia contada</strong>
                  <p>Conteo manual al cerrar</p>
                </div>
                <span>{formatCurrency(cashClose.countedTransfer ?? 0)}</span>
              </div>
            </div>
          </section>
        </div>

        <div className="stats-split-grid" style={{ marginTop: 18 }}>
          <section className="stats-panel">
            <div className="section-header stats-panel-head">
              <div>
                <h3>Pedidos sincronizados (detalle)</h3>
                <p style={{ margin: "6px 0 0", color: "#6f5e4d" }}>
                  {topPaidOrders.length > 0
                    ? "Ultimos pedidos cobrados"
                    : "No hay pedidos pagados para mostrar"}
                </p>
              </div>
              <span className="stats-chip">{topPaidOrders.length} visibles</span>
            </div>

            <div className="stats-item-list">
              {topPaidOrders.map((order) => {
                const previewItems = Array.isArray(order.items)
                  ? order.items.slice(0, 2)
                  : [];

                return (
                  <article className="stats-item-row public-order-row" key={order.id}>
                    <div>
                      <strong>{order.clientName}</strong>
                      <p>
                        {formatOrderLocation(order)} · {order.waiterName}
                      </p>
                      {previewItems.length > 0 ? (
                        <p>
                          {previewItems
                            .map((item) => `${item.quantity} x ${item.name}`)
                            .join(" · ")}
                        </p>
                      ) : null}
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <strong>{formatCurrency(order.total)}</strong>
                      <p>{getStatusLabel(order.status)}</p>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>

          <section className="stats-panel">
            <div className="section-header stats-panel-head">
              <div>
                <h3>Ranking histórico de platos</h3>
                <p style={{ margin: "6px 0 0", color: "#6f5e4d" }}>
                  {stats.monthLabel || "Resumen del mes"}
                </p>
              </div>
              <span className="stats-chip">Histórico</span>
            </div>

            <div className="ranking-grid">
              <article className="ranking-card">
                <h4>Más vendidos</h4>
                <ol className="rank-list">
                  {topDishes.map((dish, index) => (
                    <li key={`${dish.name}-${index}`}>
                      <span>{dish.name}</span>
                      <div style={{ textAlign: "right" }}>
                        <strong>{dish.quantity}</strong>
                        <small style={{ display: "block", color: "#80664f", fontSize: "0.78rem" }}>
                          {formatCurrency(dish.revenue)}
                        </small>
                      </div>
                    </li>
                  ))}
                </ol>
              </article>

              <article className="ranking-card">
                <h4>Menos vendidos</h4>
                <ol className="rank-list muted">
                  {bottomDishes.map((dish, index) => (
                    <li key={`${dish.name}-${index}`}>
                      <span>{dish.name}</span>
                      <div style={{ textAlign: "right" }}>
                        <strong>{dish.quantity}</strong>
                        <small style={{ display: "block", color: "#80664f", fontSize: "0.78rem" }}>
                          {formatCurrency(dish.revenue)}
                        </small>
                      </div>
                    </li>
                  ))}
                </ol>
              </article>
            </div>
          </section>
        </div>

        <div className="stats-split-grid" style={{ marginTop: 18 }}>
          <section className="stats-panel">
            <div className="section-header stats-panel-head">
              <div>
                <h3>Ventas por método de pago</h3>
                <p style={{ margin: "6px 0 0", color: "#6f5e4d" }}>
                  Cobro actual y acumulado
                </p>
              </div>
              <span className="stats-chip">{formatCurrency(paymentTotal)}</span>
            </div>

            <div className="payment-grid">
              {stats.paymentSummary.map((method) => (
                <article className="payment-card" key={method.method}>
                  <div className="payment-card-head">
                    <div>
                      <p>{method.label}</p>
                      <span>{method.method === "efectivo" ? "Caja" : "Bancos"}</span>
                    </div>
                    <strong>{formatCurrency(method.amount)}</strong>
                  </div>
                  <div className="stats-bar-track payment-track">
                    <div
                      className="stats-bar-fill"
                      style={getSalesIntensityStyle(method.amount, Math.max(paymentTotal, 0))}
                    />
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="stats-panel">
            <div className="section-header stats-panel-head">
              <div>
                <h3>Resumen del día e histórico</h3>
                <p style={{ margin: "6px 0 0", color: "#6f5e4d" }}>
                  {stats.rangeLabel || "Rango activo"}
                </p>
              </div>
              <span className="stats-chip">Nuevo Día</span>
            </div>

            <div className="stats-item-list">
              <div className="stats-item-row">
                <div>
                  <strong>Ganancia del día actual</strong>
                  <p>Ventas cerradas hoy</p>
                </div>
                <span>{formatCurrency(statsSummary.today.total)}</span>
              </div>
              <div className="stats-item-row">
                <div>
                  <strong>Ganancias históricas cerradas</strong>
                  <p>Acumulado que no se reinicia</p>
                </div>
                <span>{formatCurrency(statsSummary.historical.total)}</span>
              </div>
              <div className="stats-item-row">
                <div>
                  <strong>Ganancia acumulada total</strong>
                  <p>Suma de hoy + histórico</p>
                </div>
                <span>{formatCurrency(statsSummary.today.total + statsSummary.historical.total)}</span>
              </div>
              <div className="stats-item-row">
                <div>
                  <strong>Pedidos visibles</strong>
                  <p>Resumen sincronizado en pantalla</p>
                </div>
                <span>{paidOrdersForDisplay.length}</span>
              </div>
            </div>

            <p className="public-lead" style={{ marginTop: 16 }}>
              El tablero de hoy puede reiniciarse con Nuevo Día sin borrar el
              histórico acumulado.
            </p>
          </section>
        </div>
      </main>
    );
  }

  return (
    <div className="layout">
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
                if (item.id === "stats") {
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

      <main className="content">
        {loading ? <p className="loading">Cargando tablero...</p> : null}

        {activeView === "cash" ? (
          <section>
            <header className="section-header">
              <div style={{ flex: 1 }}>
                <h2>Cobro y caja</h2>
                <input
                  type="search"
                  placeholder="Buscar por cliente, mesa o ID"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
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

            <h3 className="group-title">Pagadas hoy</h3>
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

        {activeView === "stats" ? (
          <section>
            <header className="section-header">
              <div>
                <h2>Estadistica del dia</h2>
                <p style={{ margin: "6px 0 0", color: "#6f5e4d" }}>
                  {stats.monthLabel || "Hoy"} · {stats.rangeLabel || "Corte operativo"}
                </p>
              </div>
            </header>

            <div className="kpi-grid" style={{ marginTop: 18 }}>
              <article className="kpi-card">
                <h3>Apertura de caja</h3>
                <strong>{formatCurrency(cashClose.openingCash)}</strong>
              </article>
              <article className="kpi-card">
                <h3>Efectivo esperado</h3>
                <strong>{formatCurrency(cashClose.expectedCash)}</strong>
              </article>
              <article className="kpi-card">
                <h3>Transferencia esperada</h3>
                <strong>{formatCurrency(cashClose.expectedTransfer)}</strong>
              </article>
            </div>

            {cashClose.matches === true ? (
              <article className="stats-panel" style={{ marginTop: 18 }}>
                <p className="eyebrow">Arqueo validado</p>
                <h3>La caja cuadró en el último cierre</h3>
                <p>
                  Efectivo contado: {formatCurrency(cashClose.countedCash ?? 0)} · Transferencia contada: {formatCurrency(cashClose.countedTransfer ?? 0)}
                </p>
              </article>
            ) : null}

            <div className="stats-hero">
              <article className="stats-banner">
                <p className="eyebrow">Ventas y control</p>
                <h3>Resumen diario desde cobros reales, ranking y categorías</h3>
                <p>
                  Esta vista muestra el corte actual para comparar caja, cobros y ranking sin mezclar históricos.
                </p>
              </article>

              <div className="kpi-grid stats-kpi-grid">
                <article className="kpi-card">
                  <h3>Comandas del dia</h3>
                  <strong>{stats.totalOrders}</strong>
                </article>
                <article className="kpi-card">
                  <h3>Comandas pagadas hoy</h3>
                  <strong>{stats.totalPaidOrders}</strong>
                </article>
                <article className="kpi-card">
                  <h3>Ganancia del dia</h3>
                  <strong>{formatCurrency(stats.totalSales)}</strong>
                </article>
                <article className="kpi-card">
                  <h3>Contenedores hoy</h3>
                  <strong>{stats.containerSummary.quantity}</strong>
                  <p style={{ margin: "6px 0 0", color: "#6f5e4d" }}>
                    {formatCurrency(stats.containerSummary.revenue)} ganados hoy
                  </p>
                </article>
              </div>
            </div>

            <section className="stats-panel" style={{ marginTop: 18 }}>
              <div className="section-header stats-panel-head">
                <h3>Cobros reales por método</h3>
                <span className="stats-chip">Hoy vs histórico</span>
              </div>

              <div className="payment-grid">
                {stats.paymentSummary.map((method) => (
                  <article className="payment-card" key={method.method}>
                    <div className="payment-card-head">
                      <div>
                        <p>{method.label}</p>
                        <span>{method.method === "efectivo" ? "Caja" : "Bancos"}</span>
                      </div>
                      <strong>{formatCurrency(method.amount)}</strong>
                    </div>
                    <div className="stats-bar-track payment-track">
                      <div
                        className="stats-bar-fill"
                        style={getSalesIntensityStyle(method.amount, maxPaymentAmount)}
                      />
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <div className="stats-split-grid" style={{ marginTop: 18 }}>
              <section className="stats-panel">
                <div className="section-header stats-panel-head">
                  <h3>Ranking general del dia</h3>
                  <span className="stats-chip">Más vendidos y menos vendidos</span>
                </div>

                <div className="ranking-grid">
                  <article className="ranking-card">
                    <h4>Top vendidos</h4>
                    <ol className="rank-list">
                      {stats.topDishes.map((dish, index) => (
                        <li key={`${dish.name}-${index}`}>
                          <span>{dish.name}</span>
                          <div style={{ textAlign: "right" }}>
                            <strong>{dish.quantity}</strong>
                            <small style={{ display: "block", color: "#80664f", fontSize: "0.78rem" }}>
                              {formatCurrency(dish.revenue)}
                            </small>
                          </div>
                        </li>
                      ))}
                    </ol>
                  </article>

                  <article className="ranking-card">
                    <h4>Menos vendidos</h4>
                    <ol className="rank-list muted">
                      {stats.bottomDishes.map((dish, index) => (
                        <li key={`${dish.name}-${index}`}>
                          <span>{dish.name}</span>
                          <div style={{ textAlign: "right" }}>
                            <strong>{dish.quantity}</strong>
                            <small style={{ display: "block", color: "#80664f", fontSize: "0.78rem" }}>
                              {formatCurrency(dish.revenue)}
                            </small>
                          </div>
                        </li>
                      ))}
                    </ol>
                  </article>
                </div>
              </section>

              {publicPagesView ? (
                <section className="stats-panel">
                  <div className="section-header stats-panel-head">
                    <h3>Quincenas</h3>
                    <span className="stats-chip">Resumen histórico</span>
                  </div>

                  <div className="card-grid">
                    {stats.quincenas.map((period) => (
                      <article className="ranking-card" key={period.id}>
                        <h4>{period.label}</h4>
                        <div className="quincena-kpis">
                          <div>
                            <span>Pedidos</span>
                            <strong>{period.orders}</strong>
                          </div>
                          <div>
                            <span>Ganancia</span>
                            <strong>{formatCurrency(period.totalSales)}</strong>
                          </div>
                        </div>
                        <div className="rank-columns">
                          <div>
                            <p className="rank-column-label">Más vendidos</p>
                            <ol className="rank-list">
                              {period.topDishes.map((dish, index) => (
                                <li key={`${period.id}-${dish.name}-top-${index}`}>
                                  <span>{dish.name}</span>
                                  <div style={{ textAlign: "right" }}>
                                    <strong>{dish.quantity}</strong>
                                    <small style={{ display: "block", color: "#80664f", fontSize: "0.78rem" }}>
                                      {formatCurrency(dish.revenue)}
                                    </small>
                                  </div>
                                </li>
                              ))}
                            </ol>
                          </div>
                          <div>
                            <p className="rank-column-label">Menos vendidos</p>
                            <ol className="rank-list muted">
                              {period.bottomDishes.map((dish, index) => (
                                <li key={`${period.id}-${dish.name}-bottom-${index}`}>
                                  <span>{dish.name}</span>
                                  <div style={{ textAlign: "right" }}>
                                    <strong>{dish.quantity}</strong>
                                    <small style={{ display: "block", color: "#80664f", fontSize: "0.78rem" }}>
                                      {formatCurrency(dish.revenue)}
                                    </small>
                                  </div>
                                </li>
                              ))}
                            </ol>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              ) : null}
            </div>
          </section>
        ) : null}

        {activeView === "history" ? (
          <section>
            <header className="section-header">
              <h2>Dias anteriores</h2>
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

        {activeView === "waiters" ? (
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

        {activeView === "network" ? (
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
                <h4>URL local para meseros</h4>
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
                <h4>Código QR</h4>
                {networkInfo.localApiUrl ? (
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
                      <QRCode value={networkInfo.localApiUrl} />
                    </div>
                    <p style={{ marginTop: 8 }}>
                      Escanea este código con la app móvil para conectar
                    </p>
                  </div>
                ) : (
                  <p>Cargando...</p>
                )}
              </article>

              <article className="order-card">
                <h4>URL publica del tunel</h4>
                <input
                  value={publicApiDraft}
                  onChange={(event) => setPublicApiDraft(event.target.value)}
                  placeholder="https://tu-subdominio.trycloudflare.com"
                />
                <p>
                  Ejecuta <strong>npm run tunnel:server</strong>, copia la URL
                  HTTPS que aparece en la terminal y pegala aqui.
                </p>
                <div className="actions">
                  <button type="button" onClick={savePublicUrl}>
                    Guardar URL publica
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() =>
                      copyToClipboard(networkInfo.publicApiUrl, "URL publica")
                    }
                  >
                    Copiar URL publica
                  </button>
                </div>
              </article>

              <article className="order-card">
                <h4>Dashboard publico para clientes</h4>
                {publicDashboardUrl ? (
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
                      Comparte este QR o enlace. El cliente no necesita pegar
                      IP ni configurar nada.
                    </p>
                    <div className="actions">
                      <button
                        type="button"
                        onClick={() =>
                          copyToClipboard(
                            publicDashboardUrl,
                            "enlace publico del dashboard",
                          )
                        }
                      >
                        Copiar enlace
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
                    </div>
                  </div>
                ) : (
                  <p>
                    Pega y guarda primero la URL HTTPS del tunel para generar
                    el enlace y QR del cliente.
                  </p>
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

            <form
              onSubmit={(event) => {
                event.preventDefault();
                confirmClosingCash();
              }}
            >
              <div className="security-field">
                <label htmlFor="closing-cash-amount">Efectivo contado</label>
                <input
                  id="closing-cash-amount"
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  autoFocus
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
            <h3>Dashboard administrativo</h3>
            <p className="security-note">
              Ingresa el PIN de administrador para abrir el dashboard.
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
