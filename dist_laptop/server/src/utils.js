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

export function getStats(orders, menu, fromDate, toDate) {
  const from = new Date(fromDate);
  const to = new Date(toDate);

  const filtered = orders.filter((order) => {
    const created = new Date(order.createdAt);
    return created >= from && created <= to;
  });

  const dishMap = new Map();
  let totalSales = 0;
  let totalPaidOrders = 0;

  filtered.forEach((order) => {
    if (order.status === 'paid') {
      totalSales = roundMoney(totalSales + order.total);
      totalPaidOrders += 1;
    }

    order.items.forEach((item) => {
      const menuItem = menu.find((m) => m.id === item.menuItemId);
      if (!menuItem) return;
      const existing = dishMap.get(menuItem.id) ?? { name: menuItem.name, quantity: 0, revenue: 0 };
      existing.quantity += item.quantity;
      existing.revenue = roundMoney(existing.revenue + item.quantity * menuItem.price);
      dishMap.set(menuItem.id, existing);
    });
  });

  return {
    totalOrders: filtered.length,
    totalPaidOrders,
    totalSales,
    topDishes: [...dishMap.values()].sort((a, b) => b.quantity - a.quantity).slice(0, 10)
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
