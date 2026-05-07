import { useEffect, useMemo, useState } from 'react';
import { io } from 'socket.io-client';

const socket = io('http://localhost:4000', { autoConnect: false });

const navItems = [
  { id: 'stats', label: 'Estadistica' },
  { id: 'cash', label: 'Cierre de caja' },
  { id: 'history', label: 'Dias anteriores' },
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
  const [query, setQuery] = useState('');
  const [payingOrder, setPayingOrder] = useState(null);
  const [paymentDraft, setPaymentDraft] = useState({
    paymentMethod: 'efectivo',
    amount: '',
    tenderedAmount: ''
  });
  const [stats, setStats] = useState({ totalOrders: 0, totalPaidOrders: 0, totalSales: 0, topDishes: [] });
  const [cashClose, setCashClose] = useState({ date: '', total: 0, efectivo: 0, transferencia: 0, orders: 0 });
  const [historyDate, setHistoryDate] = useState(new Date().toISOString().slice(0, 10));
  const [historyOrders, setHistoryOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [apiBaseUrl, setApiBaseUrl] = useState(getApiBaseUrl());
  const [networkInfo, setNetworkInfo] = useState({ localIp: '', localApiUrl: '', publicApiUrl: '' });
  const [publicApiDraft, setPublicApiDraft] = useState('');
  const [networkStatus, setNetworkStatus] = useState('');
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

  async function loadHistoryView(date) {
    const result = await getJson(`/api/orders/history?date=${date}`);
    setHistoryOrders(result);
  }

  function openPayModal(order) {
    const balanceDue = Number(order.balanceDue ?? Math.max(order.total - Number(order.paidAmount ?? 0), 0));
    setPayingOrder(order);
    setPaymentDraft({
      paymentMethod: 'efectivo',
      amount: `${balanceDue}`,
      tenderedAmount: `${balanceDue}`
    });
  }

  function closePayModal() {
    setPayingOrder(null);
    setPaymentDraft({ paymentMethod: 'efectivo', amount: '', tenderedAmount: '' });
  }

  async function registerPayment() {
    if (!payingOrder || !paymentPreview.canSubmit) return;

    const payload = {
      paymentMethod: paymentDraft.paymentMethod,
      amount: paymentPreview.amount,
      tenderedAmount: paymentDraft.paymentMethod === 'efectivo' ? paymentPreview.tenderedAmount : undefined
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
                <article key={order.id} className="order-card">
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
                <article key={order.id} className="paid-card">
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
              <input
                type="date"
                value={historyDate}
                onChange={(event) => setHistoryDate(event.target.value)}
              />
            </header>

            <div className="card-grid">
              {historyOrders.map((order) => (
                <article key={order.id} className="order-card">
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
    </div>
  );
}

export default App;
