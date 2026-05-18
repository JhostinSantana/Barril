import { calculateWeightedCutPrice, resolveWeightFormula } from "./pricing.js";

export {
  calculateWeightedCutPrice,
  getWeightFormulaLabel,
  resolveWeightFormula,
  WEIGHT_FORMULA_CORTE_AHUMADO,
  WEIGHT_FORMULA_LABELS,
  WEIGHT_FORMULAS,
} from "./pricing.js";

export const DEFAULT_RESTAURANT_NAME = "Ahumados Al Barril";
export const DEFAULT_MENU_VERSION = "2026-05-18-menu-piernitas-fuerte-v2";

export const DEFAULT_MENU = [
  {
    id: "picaditas-probar",
    name: "PARA PROBAR",
    category: "PICADITAS CERDO",
    price: 2.5,
    pricingMode: "fixed",
  },
  {
    id: "picaditas-picar",
    name: "PARA PICAR",
    category: "PICADITAS CERDO",
    price: 3.5,
    pricingMode: "fixed",
  },
  {
    id: "picaditas-gozar",
    name: "PARA GOZAR",
    category: "PICADITAS CERDO",
    price: 5.0,
    pricingMode: "fixed",
  },
  {
    id: "picaditas-familiar",
    name: "FAMILIAR",
    category: "PICADITAS CERDO",
    price: 10.0,
    pricingMode: "fixed",
  },
  {
    id: "picaditas-fritas",
    name: "FRITAS",
    category: "PICADITAS CERDO",
    price: 1.0,
    pricingMode: "fixed",
  },
  {
    id: "picaditas-patacones",
    name: "PATACONES",
    category: "PICADITAS CERDO",
    price: 1.0,
    pricingMode: "fixed",
  },

  {
    id: "bebida-agua",
    name: "AGUA NATURAL",
    category: "BEBIDAS",
    price: 0.5,
    pricingMode: "fixed",
  },
  {
    id: "bebida-jugo-frozen",
    name: "JUGO FROZEN",
    category: "BEBIDAS",
    price: 1.0,
    pricingMode: "fixed",
  },
  {
    id: "bebida-gaseosa-personal",
    name: "GASEOSA PERSONAL",
    category: "BEBIDAS",
    price: 0.75,
    pricingMode: "fixed",
  },
  {
    id: "bebida-fuze-te",
    name: "FUZE TE",
    category: "BEBIDAS",
    price: 0.75,
    pricingMode: "fixed",
  },
  {
    id: "bebida-del-valle",
    name: "DEL VALLE",
    category: "BEBIDAS",
    price: 0.5,
    pricingMode: "fixed",
  },
  {
    id: "bebida-gaseosa-1l",
    name: "GASEOSA DE 1L",
    category: "BEBIDAS",
    price: 1.75,
    pricingMode: "fixed",
  },
  {
    id: "bebida-cerveza-sol",
    name: "CERVEZA SOL",
    category: "BEBIDAS",
    price: 2.25,
    pricingMode: "fixed",
  },
  {
    id: "bebida-cerveza-club",
    name: "CERVEZA CLUB",
    category: "BEBIDAS",
    price: 2.25,
    pricingMode: "fixed",
  },
  {
    id: "bebida-solveza",
    name: "SOLVEZA",
    category: "BEBIDAS",
    price: 2.5,
    pricingMode: "fixed",
  },
  {
    id: "bebida-jarra-sangria",
    name: "JARRA DE SANGRIA",
    category: "BEBIDAS",
    price: 10.0,
    pricingMode: "fixed",
  },

  {
    id: "fuerte-taco-taco",
    name: "TACO TACO",
    category: "PLATOS FUERTES",
    price: 2.75,
    pricingMode: "fixed",
  },
  {
    id: "fuerte-costillitas",
    name: "COSTILLITAS",
    category: "PLATOS FUERTES",
    price: 5.0,
    pricingMode: "fixed",
  },
  {
    id: "fuerte-come-solo",
    name: "COME SOLO",
    category: "PLATOS FUERTES",
    price: 4.5,
    pricingMode: "fixed",
  },
  {
    id: "fuerte-come-bien",
    name: "COME BIEN",
    category: "PLATOS FUERTES",
    price: 5.5,
    pricingMode: "fixed",
  },
  {
    id: "fuerte-piernitas-pollo",
    name: "PIERNITAS DE POLLO",
    category: "PLATOS FUERTES",
    price: 6.0,
    pricingMode: "fixed",
  },
  {
    id: "fuerte-bestia",
    name: "PICADITA ESPECIAL LA BESTIA",
    category: "PLATOS FUERTES",
    price: 24.0,
    pricingMode: "fixed",
  },

  {
    id: "extra-chicloso",
    name: "PORCION DE CHICLOSO",
    category: "PORCIONES EXTRA",
    price: 2.5,
    pricingMode: "fixed",
  },
  {
    id: "extra-moro",
    name: "PORCION DE MORO",
    category: "PORCIONES EXTRA",
    price: 2.0,
    pricingMode: "fixed",
  },
  {
    id: "extra-choclo",
    name: "PORCION DE CHOCLO",
    category: "PORCIONES EXTRA",
    price: 2.0,
    pricingMode: "fixed",
  },
  {
    id: "extra-pan",
    name: "PORCION DE PAN",
    category: "PORCIONES EXTRA",
    price: 0.5,
    pricingMode: "fixed",
  },
  {
    id: "extra-ensalada",
    name: "PORCION DE ENSALADA",
    category: "PORCIONES EXTRA",
    price: 0.5,
    pricingMode: "fixed",
  },
  {
    id: "extra-papa",
    name: "PORCION DE PAPA",
    category: "PORCIONES EXTRA",
    price: 1.0,
    pricingMode: "fixed",
  },
  {
    id: "extra-pina",
    name: "PORCION DE PINA",
    category: "PORCIONES EXTRA",
    price: 1.0,
    pricingMode: "fixed",
  },
  {
    id: "extra-c-parri",
    name: "PORCION DE C. PARRI",
    category: "PORCIONES EXTRA",
    price: 1.0,
    pricingMode: "fixed",
  },
  {
    id: "extra-c-f-hierb",
    name: "PORCION DE C. F. HIERB",
    category: "PORCIONES EXTRA",
    price: 1.5,
    pricingMode: "fixed",
  },
  {
    id: "extra-cerdo",
    name: "PORCION DE CERDO",
    category: "PORCIONES EXTRA",
    price: 2.0,
    pricingMode: "fixed",
  },
  {
    id: "extra-costilla",
    name: "PORCION DE COSTILLA",
    category: "PORCIONES EXTRA",
    price: 2.5,
    pricingMode: "fixed",
  },
  {
    id: "extra-longaniza",
    name: "PORCION DE LONGANIZA",
    category: "PORCIONES EXTRA",
    price: 1.25,
    pricingMode: "fixed",
  },
  {
    id: "extra-panceta",
    name: "PORCION DE PANCETA",
    category: "PORCIONES EXTRA",
    price: 3.0,
    pricingMode: "fixed",
  },
  {
    id: "extra-papas-fritas",
    name: "PORCION DE PAPAS FRITAS",
    category: "PORCIONES EXTRA",
    price: 2.0,
    pricingMode: "fixed",
  },
  {
    id: "extra-patacones",
    name: "PORCION DE PATACONES",
    category: "PORCIONES EXTRA",
    price: 2.0,
    pricingMode: "fixed",
  },

  {
    id: "entrada-salchipapa",
    name: "SALCHIPAPA",
    category: "ENTRADAS Y ACOMPAÑANTES",
    price: 3.0,
    pricingMode: "fixed",
  },
  {
    id: "entrada-patacones-chicle",
    name: "PATACONES CON CHICLE",
    category: "ENTRADAS Y ACOMPAÑANTES",
    price: 3.0,
    pricingMode: "fixed",
  },
  {
    id: "entrada-papas-cheddar",
    name: "PAPAS CON CHEDDAR",
    category: "ENTRADAS Y ACOMPAÑANTES",
    price: 3.0,
    pricingMode: "fixed",
  },
  {
    id: "entrada-maduro-chicle",
    name: "MADURO CON CHICLE",
    category: "ENTRADAS Y ACOMPAÑANTES",
    price: 3.0,
    pricingMode: "fixed",
  },

  {
    id: "corte-medallones-bondiola",
    name: "MEDALLONES DE BONDIOLA",
    category: "CORTES AHUMADOS",
    price: 0,
    pricingMode: "weight",
    weightFormula: "corte-ahumado",
  },
  {
    id: "corte-chuleta-cerdo",
    name: "CHULETA DE CERDO",
    category: "CORTES AHUMADOS",
    price: 0,
    pricingMode: "weight",
    weightFormula: "corte-ahumado",
  },
  {
    id: "corte-lomo-fino",
    name: "LOMO FINO",
    category: "CORTES AHUMADOS",
    price: 0,
    pricingMode: "weight",
    weightFormula: "corte-ahumado",
  },
  {
    id: "corte-costillas-san-luis",
    name: "COSTILLAS SAN LUIS",
    category: "CORTES AHUMADOS",
    price: 0,
    pricingMode: "weight",
    weightFormula: "corte-ahumado",
  },
  {
    id: "corte-costillas-baby-back",
    name: "COSTILLAS BABY BACK",
    category: "CORTES AHUMADOS",
    price: 0,
    pricingMode: "weight",
    weightFormula: "corte-ahumado",
  },
  {
    id: "corte-matambre-cerdo",
    name: "MATAMBRE",
    category: "CORTES AHUMADOS",
    price: 0,
    pricingMode: "weight",
    weightFormula: "corte-ahumado",
  },
  {
    id: "corte-filete-pechuga-pollo",
    name: "FILETE DE PECHUGA DE POLLO",
    category: "CORTES AHUMADOS",
    price: 0,
    pricingMode: "weight",
    weightFormula: "corte-pechuga-pollo",
  },
  {
    id: "corte-panceta-cerdo",
    name: "PANCETA DE CERDO",
    category: "CORTES AHUMADOS",
    price: 0,
    pricingMode: "weight",
    weightFormula: "corte-panceta",
  },
  {
    id: "corte-t-bone-steak",
    name: "T BONE STEAK",
    category: "CORTES - RES ASADA",
    price: 0,
    pricingMode: "weight",
    weightFormula: "corte-t-bone",
  },
];

function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function hasProvidedMoney(value) {
  return value != null && value !== "" && Number.isFinite(Number(value));
}

function isWeightedMenuItem(menuItem) {
  return menuItem?.pricingMode === "weight";
}

function resolveOrderItemDetails(item, menuItem) {
  const quantity = Math.max(1, Number(item.quantity) || 1);
  const pricingMode = item?.pricingMode ?? menuItem?.pricingMode ?? "fixed";
  const weightGrams = Number(
    item.weightGrams ?? item.grams ?? item.weight ?? 0,
  );
  const isWeighted =
    pricingMode === "weight" || isWeightedMenuItem(menuItem) || weightGrams > 0;

  if (isWeighted) {
    const weightFormula = item?.weightFormula ?? resolveWeightFormula(menuItem);
    const unitPrice =
      weightGrams > 0
        ? calculateWeightedCutPrice(weightGrams, weightFormula)
        : 0;
    const subtotal =
      weightGrams > 0
        ? roundMoney(unitPrice * quantity)
        : hasProvidedMoney(item.subtotal)
        ? roundMoney(item.subtotal)
        : 0;

    return {
      pricingMode: "weight",
      weightFormula,
      weightGrams: weightGrams > 0 ? roundMoney(weightGrams) : null,
      unitPrice:
        weightGrams > 0
          ? unitPrice
          : hasProvidedMoney(item.unitPrice)
          ? roundMoney(item.unitPrice)
          : 0,
      subtotal,
    };
  }

  const unitPrice = hasProvidedMoney(item.unitPrice)
    ? roundMoney(item.unitPrice)
    : roundMoney(menuItem?.price ?? 0);
  const subtotal = hasProvidedMoney(item.subtotal)
    ? roundMoney(item.subtotal)
    : roundMoney(unitPrice * quantity);

  return {
    pricingMode,
    weightGrams: null,
    unitPrice,
    subtotal,
  };
}

export function getDateKey(isoDate) {
  if (!isoDate) return null;
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

export function normalizeOrderExpenses(expenses) {
  if (!Array.isArray(expenses)) return [];

  return expenses
    .map((expense) => {
      const description = `${expense?.description ?? expense?.name ?? ""}`
        .trim()
        .replace(/\s+/g, " ");
      const amountValue =
        expense?.amount ?? expense?.subtotal ?? expense?.value;
      const amount = hasProvidedMoney(amountValue)
        ? roundMoney(amountValue)
        : 0;

      return {
        id: `${expense?.id ?? ""}`.trim() || null,
        description,
        amount,
        createdAt: expense?.createdAt ?? expense?.created_at ?? null,
        updatedAt: expense?.updatedAt ?? expense?.updated_at ?? null,
      };
    })
    .filter((expense) => expense.description && expense.amount > 0);
}

export function calculateExpensesTotal(expenses = []) {
  return roundMoney(
    normalizeOrderExpenses(expenses).reduce(
      (acc, expense) => acc + expense.amount,
      0,
    ),
  );
}

export function calculateOrderTotal(items, menu, expenses = []) {
  const itemsTotal = items.reduce((acc, item) => {
    const menuItem = menu.find((m) => m.id === item.menuItemId);
    const resolvedSubtotal = hasProvidedMoney(item.subtotal)
      ? Number(item.subtotal)
      : resolveOrderItemDetails(item, menuItem).subtotal;
    return acc + resolvedSubtotal;
  }, 0);

  return roundMoney(itemsTotal + calculateExpensesTotal(expenses));
}

export function summarizeItems(items, menu) {
  return items.map((item) => {
    const menuItem = menu.find((m) => m.id === item.menuItemId);
    const details = resolveOrderItemDetails(item, menuItem);
    return {
      menuItemId: item.menuItemId,
      name: menuItem?.name ?? "Desconocido",
      category: menuItem?.category ?? "Sin categoria",
      quantity: Math.max(1, Number(item.quantity) || 1),
      pricingMode: details.pricingMode,
      weightFormula: details.weightFormula ?? null,
      weightGrams: details.weightGrams,
      unitPrice: details.unitPrice,
      subtotal: details.subtotal,
    };
  });
}

/** Conserva gramos ya cargados en caja cuando mobile/laptop editan sin reenviar peso. */
export function preserveWeightFromCurrentOrder(nextItems, currentItems = []) {
  const currentByMenuId = new Map(
    (currentItems ?? []).map((item) => [item.menuItemId, item]),
  );

  return nextItems.map((item) => {
    const current = currentByMenuId.get(item.menuItemId);
    if (!current) return item;

    const incomingWeight =
      item.weightGrams != null ? Number(item.weightGrams) : 0;
    if (incomingWeight > 0) return item;

    const preservedWeight =
      current.weightGrams != null ? Number(current.weightGrams) : 0;
    if (preservedWeight <= 0) return item;

    return {
      ...item,
      weightGrams: current.weightGrams,
      weightFormula: item.weightFormula ?? current.weightFormula ?? null,
      pricingMode: item.pricingMode ?? current.pricingMode ?? "weight",
    };
  });
}

function createItemBucket(name, category) {
  return { name, category, quantity: 0, revenue: 0 };
}

function resolveOrderItemRevenue(item) {
  if (hasProvidedMoney(item.subtotal)) {
    return roundMoney(item.subtotal);
  }

  if (hasProvidedMoney(item.unitPrice)) {
    return roundMoney(
      Number(item.unitPrice) * Math.max(1, Number(item.quantity) || 1),
    );
  }

  return 0;
}

function sortByQuantityDescAndNameAsc(left, right) {
  if (right.quantity !== left.quantity) return right.quantity - left.quantity;
  return left.name.localeCompare(right.name, "es");
}

function sortByQuantityAscAndNameAsc(left, right) {
  if (left.quantity !== right.quantity) return left.quantity - right.quantity;
  return left.name.localeCompare(right.name, "es");
}

function buildRanking(bucketMap, limit = 10) {
  return [...bucketMap.values()]
    .sort(sortByQuantityDescAndNameAsc)
    .slice(0, limit);
}

function buildReverseRanking(bucketMap, limit = 10) {
  return [...bucketMap.values()]
    .sort(sortByQuantityAscAndNameAsc)
    .slice(0, limit);
}

function getPaymentEntries(order) {
  const payments = Array.isArray(order.payments) ? order.payments : [];
  if (payments.length > 0) return payments;

  if (order.status !== "paid") return [];

  return [
    { paymentMethod: order.paymentMethod ?? "efectivo", amount: order.total },
  ];
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
  return new Intl.DateTimeFormat("es-CO", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function getDayLabel(dateValue) {
  return new Intl.DateTimeFormat("es-CO", {
    weekday: "short",
    day: "2-digit",
    timeZone: "UTC",
  }).format(new Date(dateValue));
}

function finalizeSectionBuckets(sectionMap) {
  return [...sectionMap.values()].sort(
    (left, right) =>
      right.revenue - left.revenue ||
      right.quantity - left.quantity ||
      left.label.localeCompare(right.label, "es"),
  );
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
    [
      "first",
      {
        id: "first",
        label: "1 al 15",
        orders: 0,
        totalSales: 0,
        dishMap: new Map(),
      },
    ],
    [
      "second",
      {
        id: "second",
        label: "16 al fin de mes",
        orders: 0,
        totalSales: 0,
        dishMap: new Map(),
      },
    ],
  ]);
  const paymentMap = new Map([
    ["efectivo", { method: "efectivo", label: "Efectivo", amount: 0 }],
    [
      "transferencia",
      { method: "transferencia", label: "Transferencia", amount: 0 },
    ],
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
      totalSales: 0,
      dishMap: new Map(),
      paymentsByMethod: new Map([
        ["efectivo", { method: "efectivo", total: 0 }],
        ["transferencia", { method: "transferencia", total: 0 }],
      ]),
    };
    dailyEntry.orders += 1;

    if (order.status === "paid") {
      totalSales = roundMoney(totalSales + order.total);
      totalPaidOrders += 1;
      dailyEntry.paidOrders += 1;
      dailyEntry.totalSales = roundMoney(dailyEntry.totalSales + order.total);

      const quincenaKey = dayNumber <= 15 ? "first" : "second";
      const quincenaEntry = quincenaMap.get(quincenaKey);
      quincenaEntry.orders += 1;
      quincenaEntry.totalSales = roundMoney(
        quincenaEntry.totalSales + order.total,
      );

      getPaymentEntries(order).forEach((payment) => {
        const amount = roundMoney(payment?.amount ?? 0);
        if (paymentMap.has(payment.paymentMethod)) {
          const paymentEntry = paymentMap.get(payment.paymentMethod);
          paymentEntry.amount = roundMoney(paymentEntry.amount + amount);
        }
        if (dailyEntry.paymentsByMethod.has(payment.paymentMethod)) {
          const dailyPayment = dailyEntry.paymentsByMethod.get(
            payment.paymentMethod,
          );
          dailyPayment.total = roundMoney(dailyPayment.total + amount);
        }
      });
    }

    order.items.forEach((item) => {
      const menuItem = menu.find((m) => m.id === item.menuItemId);
      if (!menuItem) return;
      const revenue = resolveOrderItemRevenue(item);
      const existing =
        dishMap.get(menuItem.id) ??
        createItemBucket(menuItem.name, menuItem.category);
      existing.quantity += item.quantity;
      existing.revenue = roundMoney(existing.revenue + revenue);
      dishMap.set(menuItem.id, existing);

      const dailyDish =
        dailyEntry.dishMap.get(menuItem.id) ??
        createItemBucket(menuItem.name, menuItem.category);
      dailyDish.quantity += item.quantity;
      dailyDish.revenue = roundMoney(dailyDish.revenue + revenue);
      dailyEntry.dishMap.set(menuItem.id, dailyDish);

      const categoryExisting = categoryMap.get(menuItem.category) ?? {
        label: menuItem.category,
        quantity: 0,
        revenue: 0,
        items: new Map(),
      };
      categoryExisting.quantity += item.quantity;
      categoryExisting.revenue = roundMoney(categoryExisting.revenue + revenue);
      const categoryItem =
        categoryExisting.items.get(menuItem.id) ??
        createItemBucket(menuItem.name, menuItem.category);
      categoryItem.quantity += item.quantity;
      categoryItem.revenue = roundMoney(categoryItem.revenue + revenue);
      categoryExisting.items.set(menuItem.id, categoryItem);
      categoryMap.set(menuItem.category, categoryExisting);

      const quincenaKey = dayNumber <= 15 ? "first" : "second";
      const quincenaEntry = quincenaMap.get(quincenaKey);
      const quincenaItem =
        quincenaEntry.dishMap.get(menuItem.id) ??
        createItemBucket(menuItem.name, menuItem.category);
      quincenaItem.quantity += item.quantity;
      quincenaItem.revenue = roundMoney(quincenaItem.revenue + revenue);
      quincenaEntry.dishMap.set(menuItem.id, quincenaItem);
    });

    dailyMap.set(dayKey, dailyEntry);
  });

  const calendarDays = [];
  for (
    const cursor = new Date(monthStart);
    cursor <= monthEnd;
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  ) {
    const dateKey = cursor.toISOString().slice(0, 10);
    const entry = dailyMap.get(dateKey) ?? {
      date: dateKey,
      dayNumber: cursor.getUTCDate(),
      label: getDayLabel(dateKey),
      orders: 0,
      paidOrders: 0,
      totalSales: 0,
      dishMap: new Map(),
      paymentsByMethod: new Map([
        ["efectivo", { method: "efectivo", total: 0 }],
        ["transferencia", { method: "transferencia", total: 0 }],
      ]),
    };
    const topDishes = buildRanking(entry.dishMap, 5);
    const paymentMethods = [...entry.paymentsByMethod.values()].filter(
      (pm) => pm.total > 0,
    );
    calendarDays.push({
      date: entry.date,
      dayNumber: entry.dayNumber,
      label: entry.label,
      orders: entry.orders,
      paidOrders: entry.paidOrders,
      totalSales: entry.totalSales,
      topDishes,
      paymentMethods,
    });
  }

  const quincenas = [...quincenaMap.values()].map((bucket) => ({
    id: bucket.id,
    label: bucket.label,
    orders: bucket.orders,
    totalSales: bucket.totalSales,
    topDishes: buildRanking(bucket.dishMap, 5),
    bottomDishes: buildReverseRanking(bucket.dishMap, 5),
  }));

  const categories = finalizeSectionBuckets(categoryMap).map((category) => ({
    label: category.label,
    quantity: category.quantity,
    revenue: category.revenue,
    items: [...category.items.values()].sort(sortByQuantityDescAndNameAsc),
  }));

  return {
    totalOrders: filtered.length,
    totalPaidOrders,
    totalSales,
    monthLabel: getMonthLabel(fromDate),
    rangeLabel: `${from.toISOString().slice(0, 10)} al ${to
      .toISOString()
      .slice(0, 10)}`,
    monthStartWeekday: monthStart.getUTCDay(),
    topDishes: buildRanking(dishMap, 10),
    bottomDishes: buildReverseRanking(dishMap, 10),
    categories,
    paymentSummary: [...paymentMap.values()],
    quincenas,
    calendarDays,
  };
}

export function getCashClose(orders, dateKey) {
  const paidOrders = orders.filter(
    (order) => order.status === "paid" && getDateKey(order.paidAt) === dateKey,
  );

  return paidOrders.reduce(
    (acc, order) => {
      const payments = Array.isArray(order.payments) ? order.payments : [];
      const hasPayments = payments.length > 0;

      if (hasPayments) {
        payments.forEach((payment) => {
          const amount = roundMoney(payment?.amount ?? 0);
          acc.total = roundMoney(acc.total + amount);
          if (payment.paymentMethod === "efectivo") {
            acc.efectivo = roundMoney(acc.efectivo + amount);
          }
          if (payment.paymentMethod === "transferencia") {
            acc.transferencia = roundMoney(acc.transferencia + amount);
          }
        });
      } else {
        acc.total = roundMoney(acc.total + order.total);
        if (order.paymentMethod === "efectivo")
          acc.efectivo = roundMoney(acc.efectivo + order.total);
        if (order.paymentMethod === "transferencia")
          acc.transferencia = roundMoney(acc.transferencia + order.total);
      }

      acc.orders += 1;
      return acc;
    },
    { date: dateKey, total: 0, efectivo: 0, transferencia: 0, orders: 0 },
  );
}

export function getStatsSummary(orders, menu) {
  const today = new Date().toISOString().slice(0, 10);
  const createBucket = () => ({
    quantity: 0,
    efectivo: 0,
    transferencia: 0,
    items: [],
  });

  // Inicializar estructura
  const summary = {
    today: {
      dishes: createBucket(),
      beverages: createBucket(),
    },
    historical: {
      dishes: createBucket(),
      beverages: createBucket(),
    },
  };

  // Solo procesar órdenes pagadas
  const paidOrders = orders.filter((order) => order.status === "paid");

  paidOrders.forEach((order) => {
    const orderDate = getDateKey(order.paidAt);
    const isPaidToday = orderDate === today;
    const timeRange = isPaidToday ? "today" : "historical";

    // Obtener pagos de la orden
    const payments = getPaymentEntries(order);
    const paymentsByMethod = new Map([
      ["efectivo", 0],
      ["transferencia", 0],
    ]);

    payments.forEach((payment) => {
      const amount = roundMoney(payment?.amount ?? 0);
      if (paymentsByMethod.has(payment.paymentMethod)) {
        paymentsByMethod.set(
          payment.paymentMethod,
          roundMoney(paymentsByMethod.get(payment.paymentMethod) + amount),
        );
      }
    });

    // Procesar items de la orden
    order.items.forEach((item) => {
      const menuItem = menu.find((m) => m.id === item.menuItemId);
      if (!menuItem) return;

      const isBeverage = menuItem.category === "BEBIDAS";
      const productType = isBeverage ? "beverages" : "dishes";
      const revenue = resolveOrderItemRevenue(item);
      const itemQuantity = Math.max(1, Number(item.quantity) || 1);
      const bucket = summary[timeRange][productType];

      // Distribuir ingresos proporcionalmente según método de pago
      const totalRevenue = roundMoney(revenue);
      const totalPaid = roundMoney(
        paymentsByMethod.get("efectivo") +
          paymentsByMethod.get("transferencia"),
      );

      if (totalPaid > 0) {
        const cashRatio = roundMoney(
          paymentsByMethod.get("efectivo") / totalPaid,
        );
        const transferRatio = roundMoney(
          paymentsByMethod.get("transferencia") / totalPaid,
        );

        bucket.quantity += itemQuantity;
        bucket.efectivo = roundMoney(
          bucket.efectivo + totalRevenue * cashRatio,
        );
        bucket.transferencia = roundMoney(
          bucket.transferencia + totalRevenue * transferRatio,
        );
        bucket.items.push({
          menuItemId: item.menuItemId,
          name: menuItem.name,
          category: menuItem.category,
          quantity: itemQuantity,
          revenue: totalRevenue,
        });
      }
    });
  });

  for (const range of ["today", "historical"]) {
    for (const productType of ["dishes", "beverages"]) {
      summary[range][productType].items.sort(
        (a, b) =>
          b.quantity - a.quantity ||
          b.revenue - a.revenue ||
          a.name.localeCompare(b.name),
      );
    }
  }

  return summary;
}

export function detectDuplicateOrders(orders) {
  const duplicates = [];
  const ordersByContent = new Map();

  orders.forEach((order) => {
    // Crear una firma del pedido basada en: cliente, mesa, items, total
    const itemsHash = order.items
      .map((item) => `${item.menuItemId}:${item.quantity}`)
      .sort()
      .join("|");
    const signature = `${order.clientName}|${order.tableNumber}|${itemsHash}|${order.total}`;

    if (ordersByContent.has(signature)) {
      const existing = ordersByContent.get(signature);
      duplicates.push({
        original: existing.id,
        duplicate: order.id,
        signature,
        timeDiff: Math.abs(
          new Date(existing.createdAt) - new Date(order.createdAt),
        ),
      });
    } else {
      ordersByContent.set(signature, order);
    }
  });

  return duplicates;
}
