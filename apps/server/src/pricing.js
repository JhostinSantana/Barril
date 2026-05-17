function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

/** 0.00666666666 x gramos x 2 + 2.75 */
export const WEIGHT_FORMULA_CORTE_AHUMADO = 'corte-ahumado';

/** 0.01265217391 x gramos x 1.50 + 2.75 */
export const WEIGHT_FORMULA_T_BONE = 'corte-t-bone';

/** 0.00555555555 x gramos x 2 + 2.75 */
export const WEIGHT_FORMULA_PECHUGA_POLLO = 'corte-pechuga-pollo';

/** 0.00777777777 x gramos x 2 + 2.75 */
export const WEIGHT_FORMULA_PANCETA = 'corte-panceta';

export const WEIGHT_FORMULAS = {
  [WEIGHT_FORMULA_CORTE_AHUMADO]: {
    ratePerGram: 0.00666666666 * 2,
    basePrice: 2.75
  },
  [WEIGHT_FORMULA_T_BONE]: {
    ratePerGram: 0.01265217391 * 1.5,
    basePrice: 2.75
  },
  [WEIGHT_FORMULA_PECHUGA_POLLO]: {
    ratePerGram: 0.00555555555 * 2,
    basePrice: 2.75
  },
  [WEIGHT_FORMULA_PANCETA]: {
    ratePerGram: 0.00777777777 * 2,
    basePrice: 2.75
  }
};

export const WEIGHT_FORMULA_LABELS = {
  [WEIGHT_FORMULA_CORTE_AHUMADO]: '0.00666666666 x gramos x 2 + 2.75',
  [WEIGHT_FORMULA_T_BONE]: '0.01265217391 x gramos x 1.50 + 2.75',
  [WEIGHT_FORMULA_PECHUGA_POLLO]: '0.00555555555 x gramos x 2 + 2.75',
  [WEIGHT_FORMULA_PANCETA]: '0.00777777777 x gramos x 2 + 2.75'
};

const MENU_ID_FORMULA_FALLBACK = {
  'corte-medallones-bondiola': WEIGHT_FORMULA_CORTE_AHUMADO,
  'corte-chuleta-cerdo': WEIGHT_FORMULA_CORTE_AHUMADO,
  'corte-lomo-fino': WEIGHT_FORMULA_CORTE_AHUMADO,
  'corte-costillas-san-luis': WEIGHT_FORMULA_CORTE_AHUMADO,
  'corte-costillas-baby-back': WEIGHT_FORMULA_CORTE_AHUMADO,
  'corte-matambre-cerdo': WEIGHT_FORMULA_CORTE_AHUMADO,
  'corte-t-bone-steak': WEIGHT_FORMULA_T_BONE,
  'corte-filete-pechuga-pollo': WEIGHT_FORMULA_PECHUGA_POLLO,
  'corte-piernitas-pollo': WEIGHT_FORMULA_PECHUGA_POLLO,
  'corte-panceta-cerdo': WEIGHT_FORMULA_PANCETA
};

export function resolveWeightFormula(menuItem) {
  if (menuItem?.weightFormula) return menuItem.weightFormula;
  return MENU_ID_FORMULA_FALLBACK[menuItem?.id] ?? WEIGHT_FORMULA_CORTE_AHUMADO;
}

export function resolveWeightFormulaForOrderItem(item) {
  if (item?.weightFormula) return item.weightFormula;
  return MENU_ID_FORMULA_FALLBACK[item?.menuItemId] ?? WEIGHT_FORMULA_CORTE_AHUMADO;
}

export function getWeightFormulaLabel(weightFormula) {
  return WEIGHT_FORMULA_LABELS[weightFormula] ?? null;
}

export function calculateWeightedCutPrice(weightGrams, weightFormula = WEIGHT_FORMULA_CORTE_AHUMADO) {
  const formula = WEIGHT_FORMULAS[weightFormula] ?? WEIGHT_FORMULAS[WEIGHT_FORMULA_CORTE_AHUMADO];
  return roundMoney(formula.basePrice + Number(weightGrams || 0) * formula.ratePerGram);
}
