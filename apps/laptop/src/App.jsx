import { useEffect, useMemo, useState } from 'react';
import { io } from 'socket.io-client';
import { QRCode } from 'react-qr-code';
import './App.css';

const socket = io('http://localhost:4000', { autoConnect: false });

const navItems = [
  { id: 'stats', label: 'Estadistica' },
  { id: 'cash', label: 'Cierre de caja' },
  { id: 'history', label: 'Dias anteriores' },
  { id: 'waiters', label: 'Meseros' },
  { id: 'network', label: 'Conectividad' }
];

function formatCurrency(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }).format(value ?? 0);
}

function parseMoneyInput(rawValue) {
  const cleaned = `${rawValue ?? ''}`.replace(',', '.').replace(/[^\d.]/g, '');
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function getCurrentMonthRange() {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  return {
    from: new Date(Date.UTC(year, month, 1, 0, 0, 0, 0)).toISOString(),
    to: new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999)).toISOString()
  };
}

function getSalesIntensityStyle(value, maxValue) {
  if (!maxValue) return { '--bar-fill': '0%' };
  const normalized = Math.max((value / maxValue) * 100, value > 0 ? 8 : 0);
  return { '--bar-fill': `${Math.min(normalized, 100)}%` };
}

function getApiBaseUrl() {
  if (typeof window === 'undefined') return 'http://localhost:4000';
  return `${window.location.protocol}//${window.location.hostname}:4000`;
}

function getStatusLabel(status) {
  if (status === 'paid') return 'Pagada';
  if (status === 'partial') return 'Abonada';
  return 'Pendiente';
}

function describePayment(order) {
  const cash = Number(order?.paymentSummary?.efectivo ?? 0);
  const transfer = Number(order?.paymentSummary?.transferencia ?? 0);

  if (cash > 0 && transfer > 0) {
    return `Mixto (${formatCurrency(cash)} efectivo + ${formatCurrency(transfer)} transferencia)`;
  }
  if (cash > 0) return `Efectivo (${formatCurrency(cash)})`;
  if (transfer > 0) return `Transferencia (${formatCurrency(transfer)})`;
  return 'Sin pago';
}

function getEditSummary(order) {
  const summary = Array.isArray(order?.editSummary) ? order.editSummary : [];
  const editedIds = new Set(summary.filter((item) => item.type !== 'removed').map((item) => item.menuItemId));

  return { summary, editedIds };
}

function getComments(order) {
  return Array.isArray(order?.comments) ? order.comments : [];
}

function getEditChangeLabel(change) {
  if (change.type === 'added') return `Agregado: ${change.quantity}`;
  if (change.type === 'removed') return `Eliminado: ${change.previousQuantity}`;
  if (change.type === 'quantity-up') return `Subio de ${change.previousQuantity} a ${change.quantity}`;
  if (change.type === 'quantity-down') return `Bajo de ${change.previousQuantity} a ${change.quantity}`;
  return 'Editado';
}

function App() {
  const [activeView, setActiveView] = useState('cash');
  const [restaurantName, setRestaurantName] = useState('Asados en el Barril');
  const [pendingOrders, setPendingOrders] = useState([]);
  const [paidOrders, setPaidOrders] = useState([]);
  const [waiters, setWaiters] = useState([]);
  const [waiterNameDraft, setWaiterNameDraft] = useState('');
  const [query, setQuery] = useState('');
  const [payingOrder, setPayingOrder] = useState(null);
  const [selectedPaidOrder, setSelectedPaidOrder] = useState(null);
  const [paymentDraft, setPaymentDraft] = useState({
    paymentMethod: 'efectivo',
    amount: '',
    tenderedAmount: '',
    transferenceNumber: ''
  });
  const [stats, setStats] = useState({
    totalOrders: 0,
    totalPaidOrders: 0,
    totalSales: 0,
    monthLabel: '',
    rangeLabel: '',
    monthStartWeekday: 0,
    topDishes: [],
    bottomDishes: [],
    categories: [],
    paymentSummary: [],
    quincenas: [],
    calendarDays: []
  });
  const [cashClose, setCashClose] = useState({ date: '', total: 0, efectivo: 0, transferencia: 0, orders: 0 });
  const [historyDate, setHistoryDate] = useState(new Date().toISOString().slice(0, 10));
  const [historyOrders, setHistoryOrders] = useState([]);
  const [historyGrouped, setHistoryGrouped] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [loading, setLoading] = useState(false);
  const [expandedDays, setExpandedDays] = useState({});
  const [apiBaseUrl, setApiBaseUrl] = useState(getApiBaseUrl());
  const [networkInfo, setNetworkInfo] = useState({ localIp: '', localApiUrl: '', publicApiUrl: '' });
  const [publicApiDraft, setPublicApiDraft] = useState('');
  const [networkStatus, setNetworkStatus] = useState('');
  const [waiterStatus, setWaiterStatus] = useState('');
  const [autoPrintEnabled, setAutoPrintEnabled] = useState(true);
  const [confirmModal, setConfirmModal] = useState(null);

  const filteredPending = useMemo(() => {
    if (!query.trim()) return pendingOrders;
    const q = query.toLowerCase();
    return pendingOrders.filter(
      (order) =>
        order.id.toLowerCase().includes(q) ||
        order.clientName.toLowerCase().includes(q) ||
        order.tableNumber.toLowerCase().includes(q)
    );
  }, [pendingOrders, query]);

  const paymentPreview = useMemo(() => {
    if (!payingOrder) {
      return {
        paidAmount: 0,
        balanceDue: 0,
        amount: 0,
        tenderedAmount: 0,
        changeDue: 0,
        canSubmit: false,
        submitMessage: ''
      };
    }

    const paidAmount = Number(payingOrder.paidAmount ?? 0);
    const balanceDue = Number(payingOrder.balanceDue ?? Math.max(payingOrder.total - paidAmount, 0));
    const amount = parseMoneyInput(paymentDraft.amount || `${balanceDue}`);
    const tenderedAmount = paymentDraft.paymentMethod === 'efectivo'
      ? parseMoneyInput(paymentDraft.tenderedAmount || `${amount}`)
      : amount;
    const changeDue = paymentDraft.paymentMethod === 'efectivo'
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
        submitMessage: 'El abono debe ser mayor a 0.'
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
        submitMessage: 'El abono no puede superar el saldo pendiente.'
      };
    }

    if (paymentDraft.paymentMethod === 'efectivo' && tenderedAmount < amount) {
      return {
        paidAmount,
        balanceDue,
        amount,
        tenderedAmount,
        changeDue,
        canSubmit: false,
        submitMessage: 'En efectivo, recibido debe ser >= abono.'
      };
    }

    return {
      paidAmount,
      balanceDue,
      amount,
      tenderedAmount,
      changeDue,
      canSubmit: true,
      submitMessage: ''
    };
  }, [payingOrder, paymentDraft]);

  const beverageCategories = useMemo(
    () => stats.categories.filter((category) => category.label === 'BEBIDAS'),
    [stats.categories]
  );

  const foodCategories = useMemo(
    () => stats.categories.filter((category) => category.label !== 'BEBIDAS'),
    [stats.categories]
  );

  const maxCalendarSales = useMemo(
    () => Math.max(...stats.calendarDays.map((day) => day.totalSales), 0),
    [stats.calendarDays]
  );

  const maxPaymentAmount = useMemo(
    () => Math.max(...stats.paymentSummary.map((item) => item.amount), 0),
    [stats.paymentSummary]
  );

  async function getJson(url, options) {
    const response = await fetch(url, options);
    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      throw new Error(errorBody.message ?? 'Error de servidor');
    }
    return response.json();
  }

  async function loadCashView() {
    setLoading(true);
    try {
      const [menuData, pending, paid, close] = await Promise.all([
        getJson('/api/menu'),
        getJson('/api/orders?status=pending'),
        getJson('/api/orders?status=paid'),
        getJson('/api/cash-close')
      ]);
      setRestaurantName(menuData.restaurantName);
      setPendingOrders(pending);
      setPaidOrders(paid);
      setCashClose(close);
    } finally {
      setLoading(false);
    }
  }

  async function loadStatsView() {
    const range = getCurrentMonthRange();
    const result = await getJson(`/api/stats?from=${range.from}&to=${range.to}`);
    setStats(result);
  }

  async function loadWaiters() {
    const result = await getJson('/api/waiters');
    setWaiters(Array.isArray(result) ? result : []);
  }

  async function saveWaiter() {
    const name = waiterNameDraft.trim().replace(/\s+/g, ' ');
    if (!name) {
      setWaiterStatus('Escribe el nombre del mesero.');
      return;
    }

    const result = await getJson('/api/waiters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });

    setWaiterNameDraft('');
    setWaiterStatus(`Mesero autorizado: ${result.displayName}`);
    await loadWaiters();
  }

  async function toggleWaiterActive(waiter, active) {
    await getJson(`/api/waiters/${encodeURIComponent(waiter.displayName)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active })
    });

    setWaiterStatus(active ? 'Mesero reactivado.' : 'Mesero desactivado.');
    await loadWaiters();
  }

  async function loadHistoryView(date) {
    const result = await getJson(`/api/orders/history?date=${date}`);
    setHistoryOrders(result);
  }

  async function startNewDay() {
    setConfirmModal(null);
    setPendingOrders([]);
    setPaidOrders([]);
    setCashClose({ date: '', total: 0, efectivo: 0, transferencia: 0, orders: 0 });
    setQuery('');
    await loadCashView();
    await loadStatsView();
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
        } catch (err) {
          list.push({ date: iso, orders: [] });
        }
      }
      setHistoryGrouped(list);
    } finally {
      setLoadingHistory(false);
    }
  }

  function openPayModal(order) {
    const balanceDue = Number(order.balanceDue ?? Math.max(order.total - Number(order.paidAmount ?? 0), 0));
    setPayingOrder(order);
    setPaymentDraft({
      paymentMethod: 'efectivo',
      amount: `${balanceDue}`,
      tenderedAmount: `${balanceDue}`,
      transferenceNumber: ''
    });
  }

  function closePayModal() {
    setPayingOrder(null);
    setPaymentDraft({ paymentMethod: 'efectivo', amount: '', tenderedAmount: '', transferenceNumber: '' });
  }

  async function registerPayment() {
    if (!payingOrder || !paymentPreview.canSubmit) return;

    const payload = {
      paymentMethod: paymentDraft.paymentMethod,
      amount: paymentPreview.amount,
      tenderedAmount: paymentDraft.paymentMethod === 'efectivo' ? paymentPreview.tenderedAmount : undefined,
      transferenceNumber: paymentDraft.paymentMethod === 'transferencia' ? paymentDraft.transferenceNumber : undefined
    };

    const updatedOrder = await getJson(`/api/orders/${payingOrder.id}/pay`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (updatedOrder.status === 'paid') {
      closePayModal();
    } else {
      const nextBalance = Number(updatedOrder.balanceDue ?? 0);
      setPayingOrder(updatedOrder);
      setPaymentDraft((current) => ({
        ...current,
        amount: `${nextBalance}`,
        tenderedAmount: `${nextBalance}`
      }));
    }

    await Promise.all([loadCashView(), loadStatsView(), loadHistoryView(historyDate)]);
  }

  async function loadNetworkInfo() {
    const info = await getJson('/api/network-info');
    setNetworkInfo(info);
    setPublicApiDraft(info.publicApiUrl ?? '');
  }

  async function savePublicUrl() {
    const payload = await getJson('/api/network-info/public-url', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publicApiUrl: publicApiDraft })
    });
    setNetworkInfo((current) => ({ ...current, publicApiUrl: payload.publicApiUrl }));
    setNetworkStatus('URL publica guardada.');
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

  async function triggerAutoPrint(order) {
    try {
      const result = await getJson(`/api/orders/${order.id}/print`, { method: 'POST' });
      if (!result.printed) {
        setNetworkStatus(`Pedido ${order.id}: ${result.reason}`);
      }
    } catch {
      setNetworkStatus(`Pedido ${order.id}: fallo impresion automatica.`);
    }
  }

  function printKitchenTicket(order) {
    const { summary, editedIds } = getEditSummary(order);
    const ticket = window.open('', '_blank', 'width=360,height=640');
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
        <p><strong>Mesa:</strong> ${order.tableNumber}</p>
        <hr />
        <p><strong>Pedido</strong></p>
        <ul>
          ${order.items.map((item) => `<li class="${editedIds.has(item.menuItemId) ? 'edited' : ''}">${item.category} - ${item.quantity} x ${item.name}</li>`).join('')}
        </ul>
        ${summary.length > 0 ? `
          <div class="summary">
            <p><strong>Cambios recientes</strong></p>
            <ul>
              ${summary.map((change) => `<li class="edited">${change.name}: ${getEditChangeLabel(change)}</li>`).join('')}
            </ul>
          </div>
        ` : ''}
      </body>
      </html>
    `);
    ticket.document.close();
    ticket.print();
  }

  useEffect(() => {
    setApiBaseUrl(getApiBaseUrl());
    socket.connect();
    socket.on('order:new', (incomingOrder) => {
      if (autoPrintEnabled) {
        triggerAutoPrint(incomingOrder);
      }
      loadCashView();
      loadStatsView();
      loadHistoryView(historyDate);
    });
    socket.on('order:updated', () => {
      loadCashView();
      loadStatsView();
      loadHistoryView(historyDate);
    });
    socket.on('order:paid', () => {
      loadCashView();
      loadStatsView();
      loadHistoryView(historyDate);
    });

    loadCashView();
    loadStatsView();
    loadHistoryView(historyDate);
  loadWaiters();
    loadNetworkInfo();

    return () => {
      socket.off('order:new');
      socket.off('order:updated');
      socket.off('order:paid');
      socket.disconnect();
    };
  }, [historyDate, autoPrintEnabled]);

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
              className={activeView === item.id ? 'nav-button active' : 'nav-button'}
              onClick={() => setActiveView(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <span>{pendingOrders.length} cuentas pendientes</span>
          <span>{paidOrders.length} pagadas</span>
          <span>API: {apiBaseUrl}</span>
          <span>IP local: {networkInfo.localIp || 'cargando...'}</span>
        </div>
      </aside>

      <main className="content">
        {loading ? <p className="loading">Cargando tablero...</p> : null}

        {activeView === 'cash' ? (
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
                onClick={() => setConfirmModal({
                  title: '¿Iniciar nuevo día?',
                  message: 'Se limpiarán los pedidos del día actual. Los datos se guardarán en el historial. Esta acción no tiene vuelta atrás.',
                  action: startNewDay,
                  confirmText: 'Iniciar nuevo día',
                  cancelText: 'Cancelar'
                })}
                style={{ padding: '10px 16px', marginLeft: '8px' }}
              >
                Nuevo día
              </button>
            </header>

            <div className="kpi-grid">
              <article className="kpi-card">
                <h3>Total del dia</h3>
                <strong>{formatCurrency(cashClose.total)}</strong>
              </article>
              <article className="kpi-card">
                <h3>Efectivo</h3>
                <strong>{formatCurrency(cashClose.efectivo)}</strong>
              </article>
              <article className="kpi-card">
                <h3>Transferencia</h3>
                <strong>{formatCurrency(cashClose.transferencia)}</strong>
              </article>
            </div>

            <h3 className="group-title">Cuentas pendientes</h3>
            <div className="card-grid">
              {filteredPending.length === 0 ? <p className="empty">No hay cuentas pendientes.</p> : null}
              {filteredPending.map((order) => {
                const { summary, editedIds } = getEditSummary(order);
                return (
                <article
                  key={order.id}
                  className="order-card"
                >
                  <div className="order-head">
                    <span>{order.id}</span>
                    <span>Mesa {order.tableNumber}</span>
                  </div>
                  <h4>{order.clientName}</h4>
                  <p>Mesero: {order.waiterName}</p>
                  <p>Estado: {getStatusLabel(order.status)}</p>
                  <ul>
                    {order.items.map((item) => (
                      <li key={`${order.id}-${item.menuItemId}`} className={editedIds.has(item.menuItemId) ? 'order-item-edited' : ''}>
                        {item.category} - {item.quantity} x {item.name}
                      </li>
                    ))}
                  </ul>
                  {summary.length > 0 ? (
                    <div className="order-edit-summary">
                      <p className="order-edit-summary-title">Cambios recientes</p>
                      {summary.map((change) => (
                        <div key={`${order.id}-${change.menuItemId}-${change.type}`} className="order-edit-summary-item">
                          <strong>{change.name}</strong>
                          <span>{getEditChangeLabel(change)}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <p className="total">Total: {formatCurrency(order.total)}</p>
                  <p>Abonado: {formatCurrency(order.paidAmount ?? 0)}</p>
                  <p>Saldo: {formatCurrency(order.balanceDue ?? order.total)}</p>
                  <div className="actions">
                    <button type="button" onClick={() => openPayModal(order)}>
                      Cobrar / Abonar
                    </button>
                    <button type="button" className="ghost" onClick={() => printKitchenTicket(order)}>
                      Ticket cocina
                    </button>
                  </div>
                </article>
                );
              })}
            </div>

            <h3 className="group-title">Pagadas hoy</h3>
            <div className="card-grid compact">
              {paidOrders.slice(0, 12).map((order) => (
                <article key={order.id} className="paid-card" onClick={() => setSelectedPaidOrder(order)} style={{ cursor: 'pointer' }}>
                  <p>{order.clientName}</p>
                  <span>{describePayment(order)} · {formatCurrency(order.total)}</span>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {activeView === 'stats' ? (
          <section>
            <header className="section-header">
              <div>
                <h2>Estadistica mensual</h2>
                <p style={{ margin: '6px 0 0', color: '#6f5e4d' }}>
                  {stats.monthLabel || 'Resumen del mes'} · {stats.rangeLabel || 'Rango activo'}
                </p>
              </div>
            </header>

            <div className="stats-hero">
              <article className="stats-banner">
                <p className="eyebrow">Ventas y operación</p>
                <h3>Seguimiento de comida, bebidas, quincenas y caja</h3>
                <p>
                  Esta vista separa los platos y bebidas, muestra el ranking de vendidos y deja claro
                  cómo se mueve la ganancia por método de pago.
                </p>
              </article>

              <div className="kpi-grid stats-kpi-grid">
                <article className="kpi-card">
                  <h3>Comandas del mes</h3>
                  <strong>{stats.totalOrders}</strong>
                </article>
                <article className="kpi-card">
                  <h3>Comandas pagadas</h3>
                  <strong>{stats.totalPaidOrders}</strong>
                </article>
                <article className="kpi-card">
                  <h3>Ganancia total</h3>
                  <strong>{formatCurrency(stats.totalSales)}</strong>
                </article>
                <article className="kpi-card">
                  <h3>Categorias activas</h3>
                  <strong>{stats.categories.length}</strong>
                </article>
              </div>
            </div>

            <div className="stats-split-grid">
              <section className="stats-panel">
                <div className="section-header stats-panel-head">
                  <h3>Comida y bebidas separadas</h3>
                  <span className="stats-chip">Barras por categoria y producto</span>
                </div>

                <div className="stats-category-grid">
                  <article className="stats-category-block stats-drink-block">
                    <div className="stats-block-head">
                      <div>
                        <p className="stats-block-label">Bebidas</p>
                        <h4>Bebidas vendidas</h4>
                      </div>
                      <span>{beverageCategories.length} categorias</span>
                    </div>

                    {beverageCategories.length > 0 ? beverageCategories.map((category) => {
                      const topItems = category.items.slice(0, 6);
                      return (
                        <article className="stats-chart-card" key={category.label}>
                          <div className="stats-chart-head">
                            <div>
                              <h5>{category.label}</h5>
                              <p>{category.quantity} vendidos</p>
                            </div>
                            <strong>{formatCurrency(category.revenue)}</strong>
                          </div>
                          <div className="stats-bar-list">
                            {topItems.map((item) => (
                              <div className="stats-bar-row" key={`${category.label}-${item.name}`}>
                                <div className="stats-bar-meta">
                                  <span>{item.name}</span>
                                  <small>{item.quantity} uds · {formatCurrency(item.revenue)}</small>
                                </div>
                                <div className="stats-bar-track">
                                  <div
                                    className="stats-bar-fill"
                                    style={getSalesIntensityStyle(item.quantity, Math.max(...topItems.map((topItem) => topItem.quantity), 0))}
                                  />
                                </div>
                              </div>
                            ))}
                          </div>
                        </article>
                      );
                    }) : <p className="empty">Aun no hay ventas de bebidas en este periodo.</p>}
                  </article>

                  <article className="stats-category-block stats-food-block">
                    <div className="stats-block-head">
                      <div>
                        <p className="stats-block-label">Comida</p>
                        <h4>Platos y complementos</h4>
                      </div>
                      <span>{foodCategories.length} categorias</span>
                    </div>

                    {foodCategories.length > 0 ? foodCategories.map((category) => {
                      const topItems = category.items.slice(0, 6);
                      const categoryMax = Math.max(...topItems.map((item) => item.quantity), 0);
                      return (
                        <article className="stats-chart-card" key={category.label}>
                          <div className="stats-chart-head">
                            <div>
                              <h5>{category.label}</h5>
                              <p>{category.quantity} vendidos</p>
                            </div>
                            <strong>{formatCurrency(category.revenue)}</strong>
                          </div>
                          <div className="stats-bar-list">
                            {topItems.map((item) => (
                              <div className="stats-bar-row" key={`${category.label}-${item.name}`}>
                                <div className="stats-bar-meta">
                                  <span>{item.name}</span>
                                  <small>{item.quantity} uds · {formatCurrency(item.revenue)}</small>
                                </div>
                                <div className="stats-bar-track">
                                  <div
                                    className="stats-bar-fill"
                                    style={getSalesIntensityStyle(item.quantity, categoryMax)}
                                  />
                                </div>
                              </div>
                            ))}
                          </div>
                        </article>
                      );
                    }) : <p className="empty">Aun no hay ventas de comida en este periodo.</p>}
                  </article>
                </div>
              </section>

              <section className="stats-panel">
                <div className="section-header stats-panel-head">
                  <h3>Ranking general y quincenal</h3>
                  <span className="stats-chip">Mas vendidos y menos vendidos</span>
                </div>

                <div className="ranking-grid">
                  <article className="ranking-card">
                    <h4>Ranking general</h4>
                    <div className="rank-columns">
                      <div>
                        <p className="rank-column-label">Top vendidos</p>
                        <ol className="rank-list">
                          {stats.topDishes.map((dish, index) => (
                            <li key={`${dish.name}-${index}`}>
                              <span>{dish.name}</span>
                              <strong>{dish.quantity}</strong>
                            </li>
                          ))}
                        </ol>
                      </div>
                      <div>
                        <p className="rank-column-label">Menos vendidos</p>
                        <ol className="rank-list muted">
                          {stats.bottomDishes.map((dish, index) => (
                            <li key={`${dish.name}-${index}`}>
                              <span>{dish.name}</span>
                              <strong>{dish.quantity}</strong>
                            </li>
                          ))}
                        </ol>
                      </div>
                    </div>
                  </article>

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
                          <p className="rank-column-label">Mas vendidos</p>
                          <ol className="rank-list">
                            {period.topDishes.map((dish, index) => (
                              <li key={`${period.id}-${dish.name}-top-${index}`}>
                                <span>{dish.name}</span>
                                <strong>{dish.quantity}</strong>
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
                                <strong>{dish.quantity}</strong>
                              </li>
                            ))}
                          </ol>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            </div>

            <section className="stats-panel">
              <div className="section-header stats-panel-head">
                <h3>Ganancias por metodo de pago</h3>
                <span className="stats-chip">Efectivo y transferencia</span>
              </div>

              <div className="payment-grid">
                {stats.paymentSummary.map((method) => (
                  <article className="payment-card" key={method.method}>
                    <div className="payment-card-head">
                      <div>
                        <p>{method.label}</p>
                        <span>{method.method === 'efectivo' ? 'Caja' : 'Bancos'}</span>
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

            <section className="stats-panel calendar-panel">
              <div className="section-header stats-panel-head">
                <h3>Calendario de ventas</h3>
                <span className="stats-chip">Vista mensual completa</span>
              </div>

              <div className="calendar-grid-head">
                {['Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab', 'Dom'].map((day) => (
                  <div key={day} className="calendar-weekday">{day}</div>
                ))}
              </div>

              <div className="calendar-grid">
                {Array.from({ length: (stats.monthStartWeekday + 6) % 7 }).map((_, index) => (
                  <div key={`blank-${index}`} className="calendar-day calendar-empty" />
                ))}

                {stats.calendarDays.map((day) => (
                  <article
                    key={day.date}
                    className="calendar-day"
                    style={getSalesIntensityStyle(day.totalSales, maxCalendarSales)}
                  >
                    <div className="calendar-day-top">
                      <strong>{day.dayNumber}</strong>
                      <span>{day.label}</span>
                    </div>
                    <div className="calendar-day-body">
                      <p>{day.orders} pedidos</p>
                      <strong>{formatCurrency(day.totalSales)}</strong>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          </section>
        ) : null}

        {activeView === 'history' ? (
          <section>
            <header className="section-header">
              <h2>Dias anteriores</h2>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="date"
                  value={historyDate}
                  onChange={(event) => setHistoryDate(event.target.value)}
                />
                <button type="button" onClick={() => loadHistoryView(historyDate)}>Ver fecha</button>
                <button type="button" onClick={() => loadRecentHistory(7)}>{loadingHistory ? 'Cargando...' : 'Últimos 7 días'}</button>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => setConfirmModal({
                    title: '¿Limpiar historial?',
                    message: 'Se borrarán todos los datos del historial mostrado. Esta acción no tiene vuelta atrás.',
                    action: () => {
                      setConfirmModal(null);
                      setHistoryGrouped([]);
                      setHistoryOrders([]);
                    },
                    confirmText: 'Limpiar',
                    cancelText: 'Cancelar'
                  })}
                >
                  Limpiar
                </button>
              </div>
            </header>

            {/* Grouped by day if available */}
            {historyGrouped && historyGrouped.length > 0 ? (
              historyGrouped.map((group) => {
                const isExpanded = Boolean(expandedDays[group.date]);
                const totalRevenue = group.orders.reduce((s, o) => s + Number(o.total || 0), 0);
                const ordersCount = group.orders.length;
                const paidCount = group.orders.filter((o) => o.status === 'paid').length;
                const pendingCount = ordersCount - paidCount;

                return (
                  <div key={group.date} style={{ marginBottom: 16 }}>
                    <div
                      className="day-summary-card"
                      style={{ borderRadius: 12, padding: 12, background: '#fffaf1', border: '1px solid #e8d8c5', cursor: 'pointer' }}
                      onClick={() => setExpandedDays((s) => ({ ...s, [group.date]: !s[group.date] }))}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <div style={{ color: '#6f5e4d', fontSize: 12, fontWeight: 700, textTransform: 'capitalize' }}>
                            {new Date(group.date).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                          </div>
                          <div style={{ color: '#8c7d6f', fontSize: 12 }}>Día {group.date}</div>
                        </div>
                        <div style={{ display: 'flex', gap: 12 }}>
                          <div style={{ textAlign: 'center' }}>
                            <div style={{ color: '#2f8f73', fontWeight: 800 }}>${formatCurrency(totalRevenue).replace('$','')}</div>
                            <div style={{ fontSize: 12, color: '#6f5e4d' }}>Ganancias</div>
                          </div>
                          <div style={{ textAlign: 'center' }}>
                            <div style={{ fontWeight: 800 }}>{ordersCount}</div>
                            <div style={{ fontSize: 12, color: '#6f5e4d' }}>Pedidos</div>
                          </div>
                          <div style={{ textAlign: 'center' }}>
                            <div style={{ fontWeight: 800 }}>{paidCount}</div>
                            <div style={{ fontSize: 12, color: '#6f5e4d' }}>Pagados</div>
                          </div>
                          <div style={{ textAlign: 'center' }}>
                            <div style={{ fontWeight: 800 }}>{pendingCount}</div>
                            <div style={{ fontSize: 12, color: '#6f5e4d' }}>Pendientes</div>
                          </div>
                        </div>
                      </div>
                      <div style={{ marginTop: 10, color: '#8c7d6f', fontSize: 12 }}>Toca para ver detalles</div>
                    </div>

                    {isExpanded ? (
                      <div style={{ marginTop: 10 }}>
                        <div className="card-grid">
                          {group.orders.length === 0 ? (
                            <p className="empty">No hay comandas para este día.</p>
                          ) : (
                            group.orders.map((order) => (
                              <article
                                key={order.id}
                                className="order-card"
                                onClick={() => setSelectedPaidOrder(order)}
                                style={{ cursor: 'pointer' }}
                              >
                                <div className="order-head">
                                  <span>{order.id}</span>
                                  <span>Mesa {order.tableNumber}</span>
                                </div>
                                <h4>{order.clientName}</h4>
                                <p>Mesero: {order.waiterName}</p>
                                <p>Estado: {getStatusLabel(order.status)}</p>
                                <p>Metodo: {describePayment(order)}</p>
                                <p className="total">Total: {formatCurrency(order.total)}</p>
                                <p>Abonado: {formatCurrency(order.paidAmount ?? 0)}</p>
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
                    style={{ cursor: 'pointer' }}
                  >
                    <div className="order-head">
                      <span>{order.id}</span>
                      <span>Mesa {order.tableNumber}</span>
                    </div>
                    <h4>{order.clientName}</h4>
                    <p>Mesero: {order.waiterName}</p>
                    <p>Estado: {getStatusLabel(order.status)}</p>
                    <p>Metodo: {describePayment(order)}</p>
                    <p className="total">Total: {formatCurrency(order.total)}</p>
                    <p>Abonado: {formatCurrency(order.paidAmount ?? 0)}</p>
                  </article>
                ))}
                {historyOrders.length === 0 ? (
                  <p className="empty">No hay comandas para la fecha seleccionada.</p>
                ) : null}
              </div>
            )}
          </section>
        ) : null}

        {activeView === 'waiters' ? (
          <section>
            <header className="section-header">
              <h2>Meseros autorizados</h2>
            </header>

            <div className="card-grid">
              <article className="order-card">
                <h4>Autorizar mesero</h4>
                <p>Un mesero autorizado puede enviar y editar comandas desde un dispositivo movil.</p>
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
                <p>Activos: {waiters.filter((waiter) => waiter.active).length}</p>
                <p>Inactivos: {waiters.filter((waiter) => !waiter.active).length}</p>
              </article>
            </div>

            <div className="card-grid">
              {waiters.map((waiter) => (
                <article key={waiter.waiterKey} className="order-card">
                  <div className="order-head">
                    <span>{waiter.displayName}</span>
                    <span>{waiter.active ? 'Activo' : 'Inactivo'}</span>
                  </div>
                  <p>Clave: {waiter.waiterKey}</p>
                  <p>Actualizado: {new Date(waiter.updatedAt).toLocaleString()}</p>
                  <div className="actions">
                    {waiter.active ? (
                      <button type="button" className="ghost" onClick={() => toggleWaiterActive(waiter, false)}>
                        Revocar acceso
                      </button>
                    ) : (
                      <button type="button" onClick={() => toggleWaiterActive(waiter, true)}>
                        Reautorizar
                      </button>
                    )}
                  </div>
                </article>
              ))}
              {waiters.length === 0 ? <p className="empty">Aun no hay meseros autorizados.</p> : null}
            </div>

            {waiterStatus ? <p className="loading">{waiterStatus}</p> : null}
          </section>
        ) : null}

        {activeView === 'network' ? (
          <section>
            <header className="section-header">
              <h2>Conectividad remota</h2>
            </header>

            <div className="card-grid">
              <article className="order-card">
                <h4>URL local para meseros</h4>
                <p>{networkInfo.localApiUrl || 'Cargando...'}</p>
                <div className="actions">
                  <button type="button" onClick={() => copyToClipboard(networkInfo.localApiUrl, 'URL local')}>
                    Copiar URL local
                  </button>
                </div>
              </article>

              <article className="order-card">
                <h4>Código QR</h4>
                {networkInfo.localApiUrl ? (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <div style={{ background: '#fff', padding: 12, borderRadius: 8 }}>
                      <QRCode value={networkInfo.localApiUrl} />
                    </div>
                    <p style={{ marginTop: 8 }}>Escanea este código con la app móvil para conectar</p>
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
                <p>Ejecuta npm run tunnel:server y pega aqui la URL HTTPS.</p>
                <div className="actions">
                  <button type="button" onClick={savePublicUrl}>
                    Guardar URL publica
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => copyToClipboard(networkInfo.publicApiUrl, 'URL publica')}
                  >
                    Copiar URL publica
                  </button>
                </div>
              </article>

              <article className="order-card">
                <h4>Impresion automatica</h4>
                <p>Cuando entra una comanda nueva, se envia sola a la impresora de cocina.</p>
                <label className="switch-row">
                  <input
                    type="checkbox"
                    checked={autoPrintEnabled}
                    onChange={(event) => setAutoPrintEnabled(event.target.checked)}
                  />
                  <span>{autoPrintEnabled ? 'Activada' : 'Desactivada'}</span>
                </label>
              </article>
            </div>

            {networkStatus ? <p className="loading">{networkStatus}</p> : null}
          </section>
        ) : null}
      </main>

      {payingOrder ? (
        <div className="modal-backdrop" onClick={closePayModal}>
          <article className="modal" onClick={(event) => event.stopPropagation()}>
            <h3>Cobro por abonos</h3>
            <p>
              {payingOrder.clientName} · Mesa {payingOrder.tableNumber}
            </p>

            <div className="payment-summary">
              <p>Total: <strong>{formatCurrency(payingOrder.total)}</strong></p>
              <p>Abonado: <strong>{formatCurrency(paymentPreview.paidAmount)}</strong></p>
              <p>Saldo pendiente: <strong>{formatCurrency(paymentPreview.balanceDue)}</strong></p>
            </div>

            <div className="actions">
              <button
                type="button"
                className={paymentDraft.paymentMethod === 'efectivo' ? '' : 'ghost'}
                onClick={() => setPaymentDraft((current) => ({ ...current, paymentMethod: 'efectivo' }))}
              >
                Efectivo
              </button>
              <button
                type="button"
                className={paymentDraft.paymentMethod === 'transferencia' ? '' : 'ghost'}
                onClick={() => setPaymentDraft((current) => ({ ...current, paymentMethod: 'transferencia' }))}
              >
                Transferencia
              </button>
            </div>

            <div className="field-row">
              <label htmlFor="payment-amount">Monto a abonar</label>
              <input
                id="payment-amount"
                value={paymentDraft.amount}
                onChange={(event) => setPaymentDraft((current) => ({ ...current, amount: event.target.value }))}
                placeholder="Ej: 5 o 5.25"
              />
            </div>

            {paymentDraft.paymentMethod === 'efectivo' ? (
              <div className="field-row">
                <label htmlFor="payment-tendered">Recibido del cliente</label>
                <input
                  id="payment-tendered"
                  value={paymentDraft.tenderedAmount}
                  onChange={(event) => setPaymentDraft((current) => ({ ...current, tenderedAmount: event.target.value }))}
                  placeholder="Ej: 10"
                />
              </div>
            ) : null}

            {paymentDraft.paymentMethod === 'transferencia' ? (
              <div className="field-row">
                <label htmlFor="payment-transfer-number">Número de transferencia</label>
                <input
                  id="payment-transfer-number"
                  value={paymentDraft.transferenceNumber}
                  onChange={(event) => setPaymentDraft((current) => ({ ...current, transferenceNumber: event.target.value }))}
                  placeholder="Ej: TRF-1234567"
                />
              </div>
            ) : null}

            <div className="payment-summary">
              <p>Abono a registrar: <strong>{formatCurrency(paymentPreview.amount)}</strong></p>
              {paymentDraft.paymentMethod === 'efectivo' ? (
                <p>Cambio a entregar: <strong>{formatCurrency(paymentPreview.changeDue)}</strong></p>
              ) : null}
            </div>

            {paymentPreview.submitMessage ? <p className="inline-warning">{paymentPreview.submitMessage}</p> : null}

            <div className="actions">
              <button type="button" onClick={registerPayment} disabled={!paymentPreview.canSubmit}>
                Registrar abono
              </button>
              <button type="button" className="ghost" onClick={closePayModal}>
                Cerrar
              </button>
            </div>
          </article>
        </div>
      ) : null}

      {confirmModal ? (
        <div className="modal-backdrop" onClick={() => setConfirmModal(null)}>
          <article className="modal" onClick={(event) => event.stopPropagation()}>
            <h3>{confirmModal.title}</h3>
            <p>{confirmModal.message}</p>
            <div className="actions">
              <button type="button" onClick={confirmModal.action}>
                {confirmModal.confirmText}
              </button>
              <button type="button" className="ghost" onClick={() => setConfirmModal(null)}>
                {confirmModal.cancelText}
              </button>
            </div>
          </article>
        </div>
      ) : null}

      {selectedPaidOrder ? (
        <div className="modal-backdrop" onClick={() => setSelectedPaidOrder(null)}>
          <article
            className="modal"
            onClick={(event) => event.stopPropagation()}
            style={{ maxHeight: '90vh', overflowY: 'auto' }}
          >
            {(() => {
              const { summary, editedIds } = getEditSummary(selectedPaidOrder);
              const comments = getComments(selectedPaidOrder);
              return (
                <>
            <h3>Detalles de la comanda pagada</h3>
            <p>
              {selectedPaidOrder.clientName} · Mesa {selectedPaidOrder.tableNumber}
            </p>

            {summary.length > 0 ? (
              <div className="order-edit-summary" style={{ marginTop: '10px' }}>
                <p className="order-edit-summary-title">Cambios recientes</p>
                {summary.map((change) => (
                  <div key={`${selectedPaidOrder.id}-${change.menuItemId}-${change.type}`} className="order-edit-summary-item">
                    <strong>{change.name}</strong>
                    <span>{getEditChangeLabel(change)}</span>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="payment-summary">
              <p>Total: <strong>{formatCurrency(selectedPaidOrder.total)}</strong></p>
              <p>Estado: <strong>{selectedPaidOrder.status === 'paid' ? 'Pagada' : 'Abonada'}</strong></p>
            </div>

            {comments.length > 0 ? (
              <div className="comment-card" style={{ marginTop: '10px' }}>
                <h4 style={{ marginTop: '0', marginBottom: '8px' }}>Comentarios</h4>
                {comments.map((comment, index) => (
                  <div key={`${selectedPaidOrder.id}-comment-${index}`} style={{ padding: '8px 0', borderBottom: index < comments.length - 1 ? '1px solid #f0e6d2' : 'none' }}>
                    <p style={{ margin: '0 0 4px 0', whiteSpace: 'pre-wrap' }}>{comment.text}</p>
                    <p style={{ margin: '0', color: '#6f5e4d', fontSize: '12px' }}>
                      {comment.author || 'Mesero'} · {new Date(comment.createdAt).toLocaleString('es-CO')}
                    </p>
                  </div>
                ))}
              </div>
            ) : null}

            <h4 style={{ marginTop: '12px', marginBottom: '8px' }}>Items pedidos:</h4>
            <div style={{ backgroundColor: '#fff', border: '1px solid #ecdcc9', borderRadius: '8px', padding: '8px' }}>
              {selectedPaidOrder.items.map((item) => (
                <div key={`${selectedPaidOrder.id}-${item.menuItemId}`} className={editedIds.has(item.menuItemId) ? 'order-item-edited' : ''} style={{ padding: '6px 0', borderBottom: '1px solid #f0e6d2', fontSize: '14px' }}>
                  <p style={{ margin: '0 0 2px 0' }}>{item.quantity}x {item.name}</p>
                  <p style={{ margin: '0', color: '#6f5e4d', fontSize: '12px' }}>{item.category}</p>
                </div>
              ))}
            </div>

            <h4 style={{ marginTop: '12px', marginBottom: '8px' }}>Pagos realizados:</h4>
            <div style={{ backgroundColor: '#fff', border: '1px solid #ecdcc9', borderRadius: '8px', padding: '8px' }}>
              {selectedPaidOrder.payments && selectedPaidOrder.payments.length > 0 ? (
                selectedPaidOrder.payments.map((payment, index) => (
                  <div key={index} style={{ padding: '8px 0', borderBottom: index < selectedPaidOrder.payments.length - 1 ? '1px solid #f0e6d2' : 'none' }}>
                    <p style={{ margin: '0 0 4px 0', fontWeight: '700' }}>
                      {payment.paymentMethod === 'efectivo' ? '💵 Efectivo' : '🏦 Transferencia'}
                    </p>
                    <p style={{ margin: '0 0 2px 0', color: '#2f2319' }}>Monto: {formatCurrency(payment.amount)}</p>
                    {payment.paymentMethod === 'transferencia' && payment.transferenceNumber ? (
                      <p style={{ margin: '0 0 2px 0', color: '#2f2319', fontSize: '12px' }}>
                        Ref: <strong>{payment.transferenceNumber}</strong>
                      </p>
                    ) : null}
                    <p style={{ margin: '0', color: '#6f5e4d', fontSize: '12px' }}>
                      {new Date(payment.createdAt).toLocaleString('es-CO')}
                    </p>
                  </div>
                ))
              ) : (
                <p style={{ color: '#6f5e4d' }}>Sin pagos registrados</p>
              )}
            </div>

            <div className="actions" style={{ marginTop: '12px' }}>
              <button type="button" className="ghost" onClick={() => setSelectedPaidOrder(null)}>
                Cerrar
              </button>
            </div>
                </>
              );
            })()}
          </article>
        </div>
      ) : null}
    </div>
  );
}

export default App;
