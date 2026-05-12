import { useEffect, useMemo, useState } from 'react';
import { io } from 'socket.io-client';

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

function getTodayRange() {
  const today = new Date().toISOString().slice(0, 10);
  return {
    from: `${today}T00:00:00.000Z`,
    to: `${today}T23:59:59.999Z`
  };
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
  const [stats, setStats] = useState({ totalOrders: 0, totalPaidOrders: 0, totalSales: 0, topDishes: [] });
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
    const range = getTodayRange();
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
          ${order.items.map((item) => `<li>${item.category} - ${item.quantity} x ${item.name}</li>`).join('')}
        </ul>
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
              <h2>Cobro y caja</h2>
              <input
                type="search"
                placeholder="Buscar por cliente, mesa o ID"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
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
              {filteredPending.map((order) => (
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
                      <li key={`${order.id}-${item.menuItemId}`}>
                        {item.category} - {item.quantity} x {item.name}
                      </li>
                    ))}
                  </ul>
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
              ))}
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
              <h2>Estadistica de platos vendidos</h2>
            </header>

            <div className="kpi-grid">
              <article className="kpi-card">
                <h3>Comandas del dia</h3>
                <strong>{stats.totalOrders}</strong>
              </article>
              <article className="kpi-card">
                <h3>Comandas pagadas</h3>
                <strong>{stats.totalPaidOrders}</strong>
              </article>
              <article className="kpi-card">
                <h3>Venta total</h3>
                <strong>{formatCurrency(stats.totalSales)}</strong>
              </article>
            </div>

            <h3 className="group-title">Top platos</h3>
            <div className="card-grid">
              {stats.topDishes.map((dish) => (
                <article className="order-card" key={dish.name}>
                  <h4>{dish.name}</h4>
                  <p>Vendidos: {dish.quantity}</p>
                  <p>Ingreso: {formatCurrency(dish.revenue)}</p>
                </article>
              ))}
            </div>
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
                <button type="button" className="ghost" onClick={() => { setHistoryGrouped([]); setHistoryOrders([]); }}>Limpiar</button>
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

      {selectedPaidOrder ? (
        <div className="modal-backdrop" onClick={() => setSelectedPaidOrder(null)}>
          <article className="modal" onClick={(event) => event.stopPropagation()}>
            <h3>Detalles de la comanda pagada</h3>
            <p>
              {selectedPaidOrder.clientName} · Mesa {selectedPaidOrder.tableNumber}
            </p>

            <div className="payment-summary">
              <p>Total: <strong>{formatCurrency(selectedPaidOrder.total)}</strong></p>
              <p>Estado: <strong>{selectedPaidOrder.status === 'paid' ? 'Pagada' : 'Abonada'}</strong></p>
            </div>

            <h4 style={{ marginTop: '12px', marginBottom: '8px' }}>Items pedidos:</h4>
            <div style={{ backgroundColor: '#fff', border: '1px solid #ecdcc9', borderRadius: '8px', padding: '8px' }}>
              {selectedPaidOrder.items.map((item) => (
                <div key={`${selectedPaidOrder.id}-${item.menuItemId}`} style={{ padding: '6px 0', borderBottom: '1px solid #f0e6d2', fontSize: '14px' }}>
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
          </article>
        </div>
      ) : null}
    </div>
  );
}

export default App;
