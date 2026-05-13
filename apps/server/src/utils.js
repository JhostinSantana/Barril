export const DEFAULT_RESTAURANT_NAME = 'Asados en el Barril';
export const DEFAULT_MENU_VERSION = '2026-04-24-picaditas-cerdo';

export const DEFAULT_MENU = [
  { id: 'picaditas-probar', name: 'PARA PROBAR', category: 'PICADITAS CERDO', price: 2.5 },
  { id: 'picaditas-picar', name: 'PARA PICAR', category: 'PICADITAS CERDO', price: 3.5 },
  { id: 'picaditas-gozar', name: 'PARA GOZAR', category: 'PICADITAS CERDO', price: 5.0 },
  { id: 'picaditas-familiar', name: 'FAMILIAR', category: 'PICADITAS CERDO', price: 10.0 },
  { id: 'picaditas-cambio-papas', name: 'PAPAS CHAUCHAS POR PAPAS FRITAS', category: 'PICADITAS CERDO', price: 1.0 },
  { id: 'picaditas-salchipapa', name: 'SALCHIPAPA', category: 'PICADITAS CERDO', price: 3.0 },

  { id: 'bebida-agua', name: 'AGUA NATURAL', category: 'BEBIDAS', price: 0.5 },
  { id: 'bebida-jugo-frozen', name: 'JUGO FROZEN', category: 'BEBIDAS', price: 1.0 },
  { id: 'bebida-cola-personal', name: 'COLA PERSONAL', category: 'BEBIDAS', price: 0.75 },
  { id: 'bebida-fuze-te', name: 'FUZE TE', category: 'BEBIDAS', price: 0.75 },
  { id: 'bebida-del-valle', name: 'DEL VALLE', category: 'BEBIDAS', price: 0.5 },
  { id: 'bebida-coca-1l', name: 'COCA COLA DE 1L', category: 'BEBIDAS', price: 1.75 },
  { id: 'bebida-cerveza-sol', name: 'CERVEZA SOL', category: 'BEBIDAS', price: 2.25 },
  { id: 'bebida-cerveza-club', name: 'CERVEZA CLUB', category: 'BEBIDAS', price: 2.25 },
  { id: 'bebida-solveza', name: 'SOLVEZA', category: 'BEBIDAS', price: 2.5 },
  { id: 'bebida-jarra-sangria', name: 'JARRA DE SANGRIA', category: 'BEBIDAS', price: 10.0 },

  { id: 'fuerte-taco-taco', name: 'TACO TACO', category: 'PLATOS FUERTES', price: 2.75 },
  { id: 'fuerte-costillitas', name: 'COSTILLITAS', category: 'PLATOS FUERTES', price: 5.0 },
  { id: 'fuerte-come-solo', name: 'COME SOLO', category: 'PLATOS FUERTES', price: 4.5 },
  { id: 'fuerte-come-bien', name: 'COME BIEN', category: 'PLATOS FUERTES', price: 5.5 },
  { id: 'fuerte-bestia', name: 'PICADITA ESPECIAL LA BESTIA', category: 'PLATOS FUERTES', price: 24.0 },

  { id: 'extra-chicloso', name: 'PORCION DE CHICLOSO', category: 'PORCIONES EXTRA', price: 2.5 },
  { id: 'extra-moro', name: 'PORCION DE MORO', category: 'PORCIONES EXTRA', price: 2.0 },
  { id: 'extra-choclo', name: 'PORCION DE CHOCLO', category: 'PORCIONES EXTRA', price: 2.0 },
  { id: 'extra-pan', name: 'PORCION DE PAN', category: 'PORCIONES EXTRA', price: 0.5 },
  { id: 'extra-ensalada', name: 'PORCION DE ENSALADA', category: 'PORCIONES EXTRA', price: 0.5 },
  { id: 'extra-papa', name: 'PORCION DE PAPA', category: 'PORCIONES EXTRA', price: 0.5 },
  { id: 'extra-pina', name: 'PORCION DE PINA', category: 'PORCIONES EXTRA', price: 0.5 },
  { id: 'extra-c-parri', name: 'PORCION DE C. PARRI', category: 'PORCIONES EXTRA', price: 1.0 },
  { id: 'extra-c-f-hierb', name: 'PORCION DE C. F. HIERB', category: 'PORCIONES EXTRA', price: 1.5 },
  { id: 'extra-cerdo', name: 'PORCION DE CERDO', category: 'PORCIONES EXTRA', price: 2.0 },
  { id: 'extra-costilla', name: 'PORCION DE COSTILLA', category: 'PORCIONES EXTRA', price: 2.5 },
  { id: 'extra-longaniza', name: 'PORCION DE LONGANIZA', category: 'PORCIONES EXTRA', price: 1.25 },
  { id: 'extra-panceta', name: 'PORCION DE PANCETA', category: 'PORCIONES EXTRA', price: 2.5 },
  { id: 'extra-papas-fritas', name: 'PORCION DE PAPAS FRITAS', category: 'PORCIONES EXTRA', price: 2.0 },
  { id: 'extra-patacones', name: 'PORCION DE PATACONES', category: 'PORCIONES EXTRA', price: 1.5 },
  { id: 'extra-contenedor', name: 'CONTENEDOR', category: 'PORCIONES EXTRA', price: 0.25 }
];

function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

export function getDateKey(isoDate) {
  if (!isoDate) return null;
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

export function calculateOrderTotal(items, menu) {
  return roundMoney(items.reduce((acc, item) => {
    const menuItem = menu.find((m) => m.id === item.menuItemId);
    if (!menuItem) return acc;
    return acc + menuItem.price * item.quantity;
  }, 0));
}

export function summarizeItems(items, menu) {
  return items.map((item) => {
    const menuItem = menu.find((m) => m.id === item.menuItemId);
    return {
      menuItemId: item.menuItemId,
      name: menuItem?.name ?? 'Desconocido',
      category: menuItem?.category ?? 'Sin categoria',
      quantity: item.quantity,
      unitPrice: roundMoney(menuItem?.price ?? 0),
      subtotal: roundMoney((menuItem?.price ?? 0) * item.quantity)
    };
  });
}

function createItemBucket(name, category) {
  return { name, category, quantity: 0, revenue: 0 };
}

function sortByQuantityDescAndNameAsc(left, right) {
  if (right.quantity !== left.quantity) return right.quantity - left.quantity;
  return left.name.localeCompare(right.name, 'es');
}

function sortByQuantityAscAndNameAsc(left, right) {
  if (left.quantity !== right.quantity) return left.quantity - right.quantity;
  return left.name.localeCompare(right.name, 'es');
}

function buildRanking(bucketMap, limit = 10) {
  return [...bucketMap.values()].sort(sortByQuantityDescAndNameAsc).slice(0, limit);
}

function buildReverseRanking(bucketMap, limit = 10) {
  return [...bucketMap.values()].sort(sortByQuantityAscAndNameAsc).slice(0, limit);
}

function getPaymentEntries(order) {
  const payments = Array.isArray(order.payments) ? order.payments : [];
  if (payments.length > 0) return payments;

  if (order.status !== 'paid') return [];

  return [{ paymentMethod: order.paymentMethod ?? 'efectivo', amount: order.total }];
}

function getMonthDateRange(dateValue) {
  const sourceDate = new Date(dateValue);
  const year = sourceDate.getUTCFullYear();
  const month = sourceDate.getUTCMonth();
  const monthStart = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
  const monthEnd = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999));
  return { monthStart, monthEnd };
}

function getMonthLabel(dateValue) {
  const date = new Date(dateValue);
  return new Intl.DateTimeFormat('es-CO', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
}

function getDayLabel(dateValue) {
  return new Intl.DateTimeFormat('es-CO', { weekday: 'short', day: '2-digit', timeZone: 'UTC' }).format(new Date(dateValue));
}

function finalizeSectionBuckets(sectionMap) {
  return [...sectionMap.values()].sort((left, right) => right.revenue - left.revenue || right.quantity - left.quantity || left.label.localeCompare(right.label, 'es'));
}

export function getStats(orders, menu, fromDate, toDate) {
  const from = new Date(fromDate);
  const to = new Date(toDate);
  const { monthStart, monthEnd } = getMonthDateRange(fromDate);

  const filtered = orders.filter((order) => {
    const created = new Date(order.createdAt);
    return created >= from && created <= to;
  });

  const dishMap = new Map();
  const categoryMap = new Map();
  const dailyMap = new Map();
  const quincenaMap = new Map([
    ['first', { id: 'first', label: '1 al 15', orders: 0, totalSales: 0, dishMap: new Map() }],
    ['second', { id: 'second', label: '16 al fin de mes', orders: 0, totalSales: 0, dishMap: new Map() }]
  ]);
  const paymentMap = new Map([
    ['efectivo', { method: 'efectivo', label: 'Efectivo', amount: 0 }],
    ['transferencia', { method: 'transferencia', label: 'Transferencia', amount: 0 }]
  ]);
  let totalSales = 0;
  let totalPaidOrders = 0;

  filtered.forEach((order) => {
    const createdAt = new Date(order.createdAt);
    const dayKey = createdAt.toISOString().slice(0, 10);
    const dayNumber = createdAt.getUTCDate();
    const dailyEntry = dailyMap.get(dayKey) ?? {
      date: dayKey,
      dayNumber,
      label: getDayLabel(dayKey),
      orders: 0,
      paidOrders: 0,
      totalSales: 0
    };
    dailyEntry.orders += 1;

    if (order.status === 'paid') {
      totalSales = roundMoney(totalSales + order.total);
      totalPaidOrders += 1;
      dailyEntry.paidOrders += 1;
      dailyEntry.totalSales = roundMoney(dailyEntry.totalSales + order.total);

      const quincenaKey = dayNumber <= 15 ? 'first' : 'second';
      const quincenaEntry = quincenaMap.get(quincenaKey);
      quincenaEntry.orders += 1;
      quincenaEntry.totalSales = roundMoney(quincenaEntry.totalSales + order.total);

      getPaymentEntries(order).forEach((payment) => {
        const amount = roundMoney(payment?.amount ?? 0);
        if (paymentMap.has(payment.paymentMethod)) {
          const paymentEntry = paymentMap.get(payment.paymentMethod);
          paymentEntry.amount = roundMoney(paymentEntry.amount + amount);
        }
      });
    }

    order.items.forEach((item) => {
      const menuItem = menu.find((m) => m.id === item.menuItemId);
      if (!menuItem) return;
      const existing = dishMap.get(menuItem.id) ?? createItemBucket(menuItem.name, menuItem.category);
      existing.quantity += item.quantity;
      existing.revenue = roundMoney(existing.revenue + item.quantity * menuItem.price);
      dishMap.set(menuItem.id, existing);

      const categoryExisting = categoryMap.get(menuItem.category) ?? {
        label: menuItem.category,
        quantity: 0,
        revenue: 0,
        items: new Map()
      };
      categoryExisting.quantity += item.quantity;
      categoryExisting.revenue = roundMoney(categoryExisting.revenue + item.quantity * menuItem.price);
      const categoryItem = categoryExisting.items.get(menuItem.id) ?? createItemBucket(menuItem.name, menuItem.category);
      categoryItem.quantity += item.quantity;
      categoryItem.revenue = roundMoney(categoryItem.revenue + item.quantity * menuItem.price);
      categoryExisting.items.set(menuItem.id, categoryItem);
      categoryMap.set(menuItem.category, categoryExisting);

      const quincenaKey = dayNumber <= 15 ? 'first' : 'second';
      const quincenaEntry = quincenaMap.get(quincenaKey);
      const quincenaItem = quincenaEntry.dishMap.get(menuItem.id) ?? createItemBucket(menuItem.name, menuItem.category);
      quincenaItem.quantity += item.quantity;
      quincenaItem.revenue = roundMoney(quincenaItem.revenue + item.quantity * menuItem.price);
      quincenaEntry.dishMap.set(menuItem.id, quincenaItem);
    });

    dailyMap.set(dayKey, dailyEntry);
  });

  const calendarDays = [];
  for (const cursor = new Date(monthStart); cursor <= monthEnd; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const dateKey = cursor.toISOString().slice(0, 10);
    const entry = dailyMap.get(dateKey) ?? {
      date: dateKey,
      dayNumber: cursor.getUTCDate(),
      label: getDayLabel(dateKey),
      orders: 0,
      paidOrders: 0,
      totalSales: 0
    };
    calendarDays.push(entry);
  }

  const quincenas = [...quincenaMap.values()].map((bucket) => ({
    id: bucket.id,
    label: bucket.label,
    orders: bucket.orders,
    totalSales: bucket.totalSales,
    topDishes: buildRanking(bucket.dishMap, 5),
    bottomDishes: buildReverseRanking(bucket.dishMap, 5)
  }));

  const categories = finalizeSectionBuckets(categoryMap).map((category) => ({
    label: category.label,
    quantity: category.quantity,
    revenue: category.revenue,
    items: [...category.items.values()].sort(sortByQuantityDescAndNameAsc)
  }));

  return {
    totalOrders: filtered.length,
    totalPaidOrders,
    totalSales,
    monthLabel: getMonthLabel(fromDate),
    rangeLabel: `${from.toISOString().slice(0, 10)} al ${to.toISOString().slice(0, 10)}`,
    monthStartWeekday: monthStart.getUTCDay(),
    topDishes: buildRanking(dishMap, 10),
    bottomDishes: buildReverseRanking(dishMap, 10),
    categories,
    paymentSummary: [...paymentMap.values()],
    quincenas,
    calendarDays
  };
}

export function getCashClose(orders, dateKey) {
  const paidOrders = orders.filter(
    (order) => order.status === 'paid' && getDateKey(order.paidAt) === dateKey
  );

  return paidOrders.reduce(
    (acc, order) => {
      const payments = Array.isArray(order.payments) ? order.payments : [];
      const hasPayments = payments.length > 0;

      if (hasPayments) {
        payments.forEach((payment) => {
          const amount = roundMoney(payment?.amount ?? 0);
          acc.total = roundMoney(acc.total + amount);
          if (payment.paymentMethod === 'efectivo') {
            acc.efectivo = roundMoney(acc.efectivo + amount);
          }
          if (payment.paymentMethod === 'transferencia') {
            acc.transferencia = roundMoney(acc.transferencia + amount);
          }
        });
      } else {
        acc.total = roundMoney(acc.total + order.total);
        if (order.paymentMethod === 'efectivo') acc.efectivo = roundMoney(acc.efectivo + order.total);
        if (order.paymentMethod === 'transferencia') acc.transferencia = roundMoney(acc.transferencia + order.total);
      }

      acc.orders += 1;
      return acc;
    },
    { date: dateKey, total: 0, efectivo: 0, transferencia: 0, orders: 0 }
  );
}
