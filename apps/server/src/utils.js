import { calculateWeightedCutPrice, resolveWeightFormula } from "./pricing.js";

export {
    calculateWeightedCutPrice,
    getWeightFormulaLabel,
    resolveWeightFormula,
    WEIGHT_FORMULA_CORTE_AHUMADO,
    WEIGHT_FORMULA_LABELS,
    WEIGHT_FORMULAS
} from "./pricing.js";

export const DEFAULT_RESTAURANT_NAME = "Ahumados Al Barril";
export const BRANCH_SITE_IDS = ["portoviejo", "chone"];
export const MENU_VERSION_CHONE = "2026-06-28-chone-mix-parrillero-v1";
export const MENU_VERSION_PORTOVIEJO = "2026-06-28-portoviejo-mix-parrillero-v1";
export const DEFAULT_MENU_VERSION = MENU_VERSION_CHONE;
export const CONTAINER_EXPENSE_DESCRIPTION = "Contenedor";
export const CONTAINER_EXPENSE_AMOUNT = 0.25;

export function normalizeServiceType(value) {
  const raw = `${value ?? ""}`.trim().toLowerCase();
  if (
    raw === "domicilio" ||
    raw === "delivery" ||
    raw === "para_llevar" ||
    raw === "llevar" ||
    raw === "takeaway"
  ) {
    return "para_llevar";
  }
  return "mesa";
}

export function isPickupServiceType(serviceType) {
  return normalizeServiceType(serviceType) === "para_llevar";
}

export function getServiceTypeLabel(serviceType) {
  if (isPickupServiceType(serviceType)) return "Para llevar";
  return "Mesa";
}

export function defaultTableForServiceType(serviceType) {
  if (isPickupServiceType(serviceType)) return "PARA LLEVAR";
  return "";
}

export function inferServiceTypeFromTable(tableNumber) {
  const normalized = `${tableNumber ?? ""}`.trim().toUpperCase();
  if (
    normalized === "DOMICILIO" ||
    normalized.includes("DOMICILIO") ||
    normalized === "PARA LLEVAR" ||
    normalized.includes("PARA LLEVAR") ||
    normalized === "LLEVAR"
  ) {
    return "para_llevar";
  }
  return "mesa";
}

export function formatOrderLocation(order) {
  const serviceType = normalizeServiceType(
    order?.serviceType ?? inferServiceTypeFromTable(order?.tableNumber),
  );
  if (serviceType === "para_llevar") return "Para llevar";
  const table = `${order?.tableNumber ?? ""}`.trim();
  return table ? `Mesa ${table}` : "Mesa";
}

export function normalizeContainerQuantity(quantity) {
  const numericQuantity = Math.floor(Number(quantity) || 0);
  return numericQuantity > 0 ? numericQuantity : 1;
}

export function createContainerExpense(quantity = 1) {
  const normalizedQuantity = normalizeContainerQuantity(quantity);
  const now = new Date().toISOString();
  return {
    id: `container-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`,
    description: CONTAINER_EXPENSE_DESCRIPTION,
    quantity: normalizedQuantity,
    unitPrice: CONTAINER_EXPENSE_AMOUNT,
    amount: roundMoney(normalizedQuantity * CONTAINER_EXPENSE_AMOUNT),
    kind: "container",
    createdAt: now,
    updatedAt: now,
  };
}

export const DEFAULT_MENU_CHONE = [
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
    id: "fuerte-bestia",
    name: "PICADITA ESPECIAL LA BESTIA",
    category: "PICADITAS CERDO",
    price: 22.0,
    pricingMode: "fixed",
  },

  {
    id: "bebida-agua",
    name: "AGUA NATURAL",
    category: "BEBIDAS",
    price: 0.75,
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
    id: "bebida-cafe",
    name: "CAFE",
    category: "BEBIDAS",
    price: 0.75,
    pricingMode: "fixed",
  },

  {
    id: "postres-porcion",
    name: "POSTRES",
    category: "POSTRES",
    price: 1.5,
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
    id: "extra-chicloso",
    name: "PORCION EXTRA CHICLOSO",
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
    id: "extra-moroclo",
    name: "PORCION DE MOROCLO",
    category: "PORCIONES EXTRA",
    price: 2.25,
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
    price: 0.75,
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
    price: 2.25,
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
    id: "extra-papas-fritas",
    name: "PORCION DE PAPAS FRITAS",
    category: "PORCIONES EXTRA",
    price: 2.5,
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
  {
    id: "corte-ribeye",
    name: "RIBEYE",
    category: "CORTES - RES ASADA",
    price: 0,
    pricingMode: "weight",
    weightFormula: "corte-t-bone",
  },

  {
    id: "corte-mix-parrillero-uno",
    name: "MIX PARRILLERO UNO",
    category: "CORTES DE ASADO",
    price: 10.0,
    pricingMode: "fixed",
  },
  {
    id: "corte-mix-parrillero-dos",
    name: "MIX PARRILLERO DOS",
    category: "CORTES DE ASADO",
    price: 16.0,
    pricingMode: "fixed",
  },
];

/** @deprecated Usa getDefaultMenuForBranch(branchSiteId) */
export const DEFAULT_MENU = DEFAULT_MENU_CHONE;

const PORTOVIEJO_PRICE_OVERRIDES = {
  "picaditas-probar": 3.0,
  "picaditas-picar": 4.0,
  "picaditas-gozar": 5.5,
  "picaditas-familiar": 10.5,
  "picaditas-fritas": 1.5,
  "picaditas-patacones": 1.5,
  "fuerte-bestia": 24.5,
  "bebida-agua": 0.75,
  "bebida-jugo-frozen": 1.5,
  "bebida-gaseosa-personal": 1.0,
  "bebida-fuze-te": 1.0,
  "bebida-del-valle": 0.75,
  "bebida-gaseosa-1l": 2.0,
  "postres-porcion": 2.25,
  "fuerte-taco-taco": 3.25,
  "fuerte-costillitas": 5.5,
  "fuerte-come-solo": 5.0,
  "fuerte-come-bien": 6.0,
  "extra-chicloso": 3.0,
  "extra-moro": 2.5,
  "extra-moroclo": 1.75,
  "extra-choclo": 2.5,
  "extra-pan": 1.0,
  "extra-ensalada": 1.0,
  "extra-papa": 1.5,
  "extra-pina": 1.5,
  "extra-c-parri": 1.5,
  "extra-longaniza": 2.0,
  "extra-c-f-hierb": 2.0,
  "extra-cerdo": 2.5,
  "extra-costilla": 3.0,
  "extra-papas-fritas": 3.0,
  "extra-patacones": 2.5,
  "entrada-salchipapa": 3.5,
  "entrada-patacones-chicle": 3.5,
  "entrada-papas-cheddar": 3.5,
  "entrada-maduro-chicle": 3.5,
  "corte-mix-parrillero-uno": 12.0,
  "corte-mix-parrillero-dos": 18.0,
};

const PORTOVIEJO_EXCLUDED_ITEM_IDS = ["corte-ribeye"];

export const DEFAULT_MENU_PORTOVIEJO = DEFAULT_MENU_CHONE.filter(
  (item) => !PORTOVIEJO_EXCLUDED_ITEM_IDS.includes(item.id),
).map((item) => ({
  ...item,
  price: Object.hasOwn(PORTOVIEJO_PRICE_OVERRIDES, item.id)
    ? PORTOVIEJO_PRICE_OVERRIDES[item.id]
    : item.price,
}));

export function isValidBranchSiteId(branchSiteId) {
  return BRANCH_SITE_IDS.includes(`${branchSiteId ?? ""}`.trim());
}

export function getDefaultMenuForBranch(branchSiteId) {
  return branchSiteId === "portoviejo"
    ? DEFAULT_MENU_PORTOVIEJO
    : DEFAULT_MENU_CHONE;
}

export function getMenuVersionForBranch(branchSiteId) {
  return branchSiteId === "portoviejo"
    ? MENU_VERSION_PORTOVIEJO
    : MENU_VERSION_CHONE;
}

export function getMenuVersionKey(branchSiteId) {
  const branchId = isValidBranchSiteId(branchSiteId) ? branchSiteId : "chone";
  return `${branchId}:${getMenuVersionForBranch(branchId)}`;
}

export function getBranchMenuLabel(branchSiteId) {
  if (branchSiteId === "portoviejo") return "Barril Portoviejo";
  if (branchSiteId === "chone") return "Barril Chone";
  return "Sin sede";
}

function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function hasProvidedMoney(value) {
  return value != null && value !== "" && Number.isFinite(Number(value));
}

function isWeightedMenuItem(menuItem) {
  return menuItem?.pricingMode === "weight";
}

function normalizeWeightBreakdown(rawValue) {
  if (!Array.isArray(rawValue)) return [];

  return rawValue
    .map((value) => roundMoney(Number(value)))
    .filter((value) => Number.isFinite(value) && value > 0);
}

function resolveOrderItemDetails(item, menuItem) {
  const quantity = Math.max(1, Number(item.quantity) || 1);
  const pricingMode = item?.pricingMode ?? menuItem?.pricingMode ?? "fixed";
  const weightGrams = Number(
    item.weightGrams ?? item.grams ?? item.weight ?? 0,
  );
  const weightBreakdown = normalizeWeightBreakdown(
    item.weightBreakdown ?? item.weightBreakdownJson,
  );
  const isWeighted =
    pricingMode === "weight" ||
    isWeightedMenuItem(menuItem) ||
    weightGrams > 0 ||
    weightBreakdown.length > 0;

  if (isWeighted) {
    const weightFormula = item?.weightFormula ?? resolveWeightFormula(menuItem);
    const unitWeights =
      weightBreakdown.length > 0
        ? weightBreakdown
        : weightGrams > 0
        ? Array.from({ length: quantity }, () => roundMoney(weightGrams))
        : [];
    const subtotal =
      unitWeights.length > 0
        ? roundMoney(
            unitWeights.reduce(
              (acc, grams) =>
                acc + calculateWeightedCutPrice(grams, weightFormula),
              0,
            ),
          )
        : hasProvidedMoney(item.subtotal)
        ? roundMoney(item.subtotal)
        : 0;
    const totalWeight =
      unitWeights.length > 0
        ? roundMoney(unitWeights.reduce((acc, grams) => acc + grams, 0))
        : weightGrams > 0
        ? roundMoney(weightGrams)
        : null;

    return {
      pricingMode: "weight",
      weightFormula,
      weightGrams: totalWeight,
      weightBreakdown: unitWeights.length > 0 ? unitWeights : null,
      unitPrice:
        subtotal > 0
          ? roundMoney(subtotal / quantity)
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
    weightBreakdown: null,
    unitPrice,
    subtotal,
  };
}

const BOGOTA_TIME_ZONE = "America/Bogota";

function toDateOnlyKey(dateValue) {
  if (!dateValue) return null;
  const value = String(dateValue).trim();
  if (!value) return null;
  return value.includes("T") ? value.slice(0, 10) : value;
}

function getBogotaDateParts(isoDate) {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return null;

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BOGOTA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) return null;
  return { year: Number(year), month: Number(month), day: Number(day) };
}

export function getDateKey(isoDate) {
  if (!isoDate) return null;
  const parts = getBogotaDateParts(isoDate);
  if (!parts) return null;
  const month = String(parts.month).padStart(2, "0");
  const day = String(parts.day).padStart(2, "0");
  return `${parts.year}-${month}-${day}`;
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
      const kind = `${expense?.kind ?? expense?.type ?? ""}`
        .trim()
        .toLowerCase() || null;
      const descriptionLower = description.toLowerCase();
      const isContainer =
        kind === "container" ||
        descriptionLower === CONTAINER_EXPENSE_DESCRIPTION.toLowerCase();

      if (isContainer) {
        const quantity = normalizeContainerQuantity(expense?.quantity);
        const unitPrice = hasProvidedMoney(expense?.unitPrice)
          ? roundMoney(expense.unitPrice)
          : CONTAINER_EXPENSE_AMOUNT;

        return {
          id: `${expense?.id ?? ""}`.trim() || null,
          description: CONTAINER_EXPENSE_DESCRIPTION,
          amount: roundMoney(quantity * unitPrice),
          quantity,
          unitPrice,
          kind: "container",
          createdAt: expense?.createdAt ?? expense?.created_at ?? null,
          updatedAt: expense?.updatedAt ?? expense?.updated_at ?? null,
        };
      }

      const amount = hasProvidedMoney(amountValue)
        ? roundMoney(amountValue)
        : 0;

      return {
        id: `${expense?.id ?? ""}`.trim() || null,
        description,
        amount,
        quantity: null,
        unitPrice: null,
        kind,
        createdAt: expense?.createdAt ?? expense?.created_at ?? null,
        updatedAt: expense?.updatedAt ?? expense?.updated_at ?? null,
      };
    })
    .filter((expense) => expense.description && expense.amount > 0);
}

export function isContainerExpense(expense) {
  if (!expense) return false;

  if (`${expense.kind ?? ""}`.trim().toLowerCase() === "container") {
    return true;
  }

  const description = `${expense.description ?? expense.name ?? ""}`
    .trim()
    .toLowerCase();

  return description === CONTAINER_EXPENSE_DESCRIPTION.toLowerCase();
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

function normalizeItemNotes(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().slice(0, 240);
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
      weightBreakdown: details.weightBreakdown ?? null,
      unitPrice: details.unitPrice,
      subtotal: details.subtotal,
      notes: normalizeItemNotes(item.notes),
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

    const incomingNotes = normalizeItemNotes(item.notes);
    const preservedNotes = normalizeItemNotes(current.notes);

    return {
      ...item,
      weightGrams: current.weightGrams,
      weightBreakdown: item.weightBreakdown ?? current.weightBreakdown ?? null,
      weightFormula: item.weightFormula ?? current.weightFormula ?? null,
      pricingMode: item.pricingMode ?? current.pricingMode ?? "weight",
      notes: incomingNotes || preservedNotes,
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

function getPaymentMovements(order) {
  const payments = Array.isArray(order?.payments) ? order.payments : [];

  if (payments.length > 0) {
    return payments.map((payment) => ({
      orderId: order.id,
      paymentMethod: payment.paymentMethod ?? order.paymentMethod ?? "efectivo",
      amount: roundMoney(payment.amount ?? 0),
      createdAt: payment.createdAt ?? order.paidAt ?? order.createdAt ?? null,
    }));
  }

  if (order?.status !== "paid") return [];

  return [
    {
      orderId: order.id,
      paymentMethod: order.paymentMethod ?? "efectivo",
      amount: roundMoney(order.total ?? 0),
      createdAt: order.paidAt ?? order.createdAt ?? null,
    },
  ];
}

function getMonthDateRange(dateValue) {
  const parts = getBogotaDateParts(dateValue);
  const date = new Date(dateValue);
  const year = parts?.year ?? date.getUTCFullYear();
  const month = (parts?.month ?? date.getUTCMonth() + 1) - 1;
  const monthStart = new Date(Date.UTC(year, month, 1, 5, 0, 0, 0));
  const monthEnd = new Date(Date.UTC(year, month + 1, 1, 4, 59, 59, 999));
  return { monthStart, monthEnd };
}

function getMonthLabel(dateValue) {
  const dayKey = toDateOnlyKey(dateValue);
  if (!dayKey) return "";
  const date = new Date(`${dayKey}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return dayKey.slice(0, 7);
  return new Intl.DateTimeFormat("es-CO", {
    month: "long",
    year: "numeric",
    timeZone: BOGOTA_TIME_ZONE,
  }).format(date);
}

function getDayLabel(dateValue) {
  const dayKey = toDateOnlyKey(dateValue);
  if (!dayKey) return "";
  const date = new Date(`${dayKey}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return dayKey;
  return new Intl.DateTimeFormat("es-CO", {
    weekday: "short",
    day: "2-digit",
    timeZone: BOGOTA_TIME_ZONE,
  }).format(date);
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
    return order.status === "paid" && created >= from && created <= to;
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
        orderIds: new Set(),
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
        orderIds: new Set(),
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
  const containerSummary = {
    quantity: 0,
    revenue: 0,
  };
  let totalSales = 0;
  let totalPaidOrders = 0;
  const paidOrderIds = new Set();

  function ensureDailyEntry(dateKey, dateParts, fallbackDate) {
    const dayKey = dateKey ?? fallbackDate;
    const existing = dailyMap.get(dayKey);
    if (existing) return existing;

    const entry = {
      date: dayKey,
      dayNumber: dateParts?.day ?? new Date(`${dayKey}T12:00:00.000Z`).getUTCDate(),
      label: getDayLabel(dayKey),
      orders: 0,
      paidOrders: 0,
      totalSales: 0,
      dishMap: new Map(),
      paymentsByMethod: new Map([
        ["efectivo", { method: "efectivo", total: 0 }],
        ["transferencia", { method: "transferencia", total: 0 }],
      ]),
      paidOrderIds: new Set(),
    };
    dailyMap.set(dayKey, entry);
    return entry;
  }

  filtered.forEach((order) => {
    const createdAt = new Date(order.createdAt);
    const dayKey = getDateKey(order.createdAt);
    const dayParts = getBogotaDateParts(order.createdAt);
    const dayNumber = dayParts?.day ?? createdAt.getUTCDate();
    const dailyEntry = ensureDailyEntry(dayKey, dayParts, dayKey);
    dailyEntry.orders += 1;

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

    const movements = getPaymentMovements(order).filter((movement) => {
      const movementDate = getDateKey(movement.createdAt);
      return movementDate && movementDate >= fromDate.slice(0, 10) && movementDate <= toDate.slice(0, 10);
    });

    movements.forEach((movement) => {
      const movementDate = getDateKey(movement.createdAt);
      const movementParts = getBogotaDateParts(movement.createdAt);
      if (!movementDate || !movementParts) return;

      const movementEntry = ensureDailyEntry(movementDate, movementParts, movementDate);
      const amount = roundMoney(movement.amount ?? 0);
      totalSales = roundMoney(totalSales + amount);
      paidOrderIds.add(order.id);
      movementEntry.paidOrderIds.add(order.id);
      movementEntry.paidOrders = movementEntry.paidOrderIds.size;
      movementEntry.totalSales = roundMoney(movementEntry.totalSales + amount);

      const quincenaKey = movementParts.day <= 15 ? "first" : "second";
      const quincenaEntry = quincenaMap.get(quincenaKey);
      quincenaEntry.orderIds.add(order.id);
      quincenaEntry.totalSales = roundMoney(quincenaEntry.totalSales + amount);

      if (paymentMap.has(movement.paymentMethod)) {
        const paymentEntry = paymentMap.get(movement.paymentMethod);
        paymentEntry.amount = roundMoney(paymentEntry.amount + amount);
      }

      if (movementEntry.paymentsByMethod.has(movement.paymentMethod)) {
        const dailyPayment = movementEntry.paymentsByMethod.get(movement.paymentMethod);
        dailyPayment.total = roundMoney(dailyPayment.total + amount);
      }

      normalizeOrderExpenses(order.expenses).forEach((expense) => {
        if (!isContainerExpense(expense)) return;

        containerSummary.quantity += normalizeContainerQuantity(expense.quantity);
        containerSummary.revenue = roundMoney(
          containerSummary.revenue + expense.amount,
        );
      });
    });

    dailyEntry.paidOrders = dailyEntry.paidOrderIds.size;
    dailyMap.set(dayKey, dailyEntry);
  });

  const calendarDays = [];
  for (
    const cursor = new Date(monthStart);
    cursor <= monthEnd;
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  ) {
    const dateKey = getDateKey(cursor.toISOString());
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
      paidOrderIds: new Set(),
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
    orders: bucket.orderIds.size,
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
    totalPaidOrders: paidOrderIds.size,
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
    containerSummary,
    quincenas,
    calendarDays,
  };
}

export function getCashClose(orders, dateKey) {
  const movements = orders
    .flatMap((order) => getPaymentMovements(order))
    .filter((movement) => getDateKey(movement.createdAt) === dateKey);
  const uniqueOrders = new Set(movements.map((movement) => movement.orderId));

  return movements.reduce(
    (acc, order) => {
      acc.total = roundMoney(acc.total + order.amount);
      if (order.paymentMethod === "efectivo") {
        acc.efectivo = roundMoney(acc.efectivo + order.amount);
      }
      if (order.paymentMethod === "transferencia") {
        acc.transferencia = roundMoney(acc.transferencia + order.amount);
      }
      return acc;
    },
    { date: dateKey, total: 0, efectivo: 0, transferencia: 0, orders: uniqueOrders.size },
  );
}

export function getStatsSummary(orders, menu) {
  const today = getDateKey(new Date().toISOString());
  const summary = {
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
  };

  orders.filter((order) => order.status === "paid").forEach((order) => {
    const movements = getPaymentMovements(order);

    movements.forEach((movement) => {
      const movementDate = getDateKey(movement.createdAt);
      const timeRange = movementDate === today ? "today" : "historical";
      const amount = roundMoney(movement.amount ?? 0);

      if (!summary[timeRange]) return;
      if (!Object.prototype.hasOwnProperty.call(summary[timeRange], movement.paymentMethod)) {
        return;
      }

      summary[timeRange][movement.paymentMethod] = roundMoney(
        summary[timeRange][movement.paymentMethod] + amount,
      );
      summary[timeRange].total = roundMoney(summary[timeRange].total + amount);
    });
  });

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
