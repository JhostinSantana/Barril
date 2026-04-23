export const DEFAULT_RESTAURANT_NAME = 'Asados en el Barril';

export const DEFAULT_MENU = [
  { id: 'plato-1', name: 'Asado Barril Tradicional', category: 'Parrilla', price: 26000 },
  { id: 'plato-2', name: 'Costillas Ahumadas', category: 'Parrilla', price: 32000 },
  { id: 'plato-3', name: 'Chorizo Artesanal', category: 'Entradas', price: 12000 },
  { id: 'plato-4', name: 'Papa Criolla al Horno', category: 'Acompanantes', price: 9000 },
  { id: 'plato-5', name: 'Limonada de la Casa', category: 'Bebidas', price: 7000 },
  { id: 'plato-6', name: 'Gaseosa', category: 'Bebidas', price: 6000 }
];

export function getDateKey(isoDate) {
  if (!isoDate) return null;
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

export function calculateOrderTotal(items, menu) {
  return items.reduce((acc, item) => {
    const menuItem = menu.find((m) => m.id === item.menuItemId);
    if (!menuItem) return acc;
    return acc + menuItem.price * item.quantity;
  }, 0);
}

export function summarizeItems(items, menu) {
  return items.map((item) => {
    const menuItem = menu.find((m) => m.id === item.menuItemId);
    return {
      menuItemId: item.menuItemId,
      name: menuItem?.name ?? 'Desconocido',
      category: menuItem?.category ?? 'Sin categoria',
      quantity: item.quantity,
      unitPrice: menuItem?.price ?? 0,
      subtotal: (menuItem?.price ?? 0) * item.quantity
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
      totalSales += order.total;
      totalPaidOrders += 1;
    }

    order.items.forEach((item) => {
      const menuItem = menu.find((m) => m.id === item.menuItemId);
      if (!menuItem) return;
      const existing = dishMap.get(menuItem.id) ?? { name: menuItem.name, quantity: 0, revenue: 0 };
      existing.quantity += item.quantity;
      existing.revenue += item.quantity * menuItem.price;
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
      acc.total += order.total;
      if (order.paymentMethod === 'efectivo') acc.efectivo += order.total;
      if (order.paymentMethod === 'transferencia') acc.transferencia += order.total;
      acc.orders += 1;
      return acc;
    },
    { date: dateKey, total: 0, efectivo: 0, transferencia: 0, orders: 0 }
  );
}
