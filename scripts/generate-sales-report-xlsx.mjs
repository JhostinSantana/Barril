import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";

const inputPath = process.argv[2];
const outputPath =
  process.argv[3] ||
  path.join(
    path.dirname(inputPath || "."),
    `REPORTE-VENTAS-${new Date().toISOString().slice(0, 10)}.xlsx`,
  );

if (!inputPath || !fs.existsSync(inputPath)) {
  console.error("Uso: node scripts/generate-sales-report-xlsx.mjs <backup.json> [salida.xlsx]");
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const TZ = "America/Guayaquil";

const COLORS = {
  brand: "FF7C2D12",
  brandLight: "FFFDF8F3",
  header: "FF5C4A32",
  headerText: "FFFFFFFF",
  accent: "FFF59E0B",
  border: "FFE7D5C4",
  altRow: "FFFAF6F1",
  money: "FF166534",
};

function money(n) {
  return Number(n || 0);
}

function dateKey(iso) {
  if (!iso) return "sin-fecha";
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(iso));
}

function fmtDateTime(iso) {
  if (!iso) return "-";
  return new Intl.DateTimeFormat("es-EC", {
    timeZone: TZ,
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(iso));
}

function fmtDate(iso) {
  if (!iso) return "-";
  return new Intl.DateTimeFormat("es-EC", {
    timeZone: TZ,
    dateStyle: "medium",
  }).format(new Date(iso));
}

function setting(key) {
  return data.settings?.find((s) => s.key === key)?.value ?? "";
}

function parseJson(raw, fallback = null) {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function styleHeaderRow(row, colCount) {
  row.height = 24;
  for (let c = 1; c <= colCount; c++) {
    const cell = row.getCell(c);
    cell.font = { bold: true, color: { argb: COLORS.headerText }, size: 11 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.header } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = thinBorder();
  }
}

function thinBorder() {
  return {
    top: { style: "thin", color: { argb: COLORS.border } },
    left: { style: "thin", color: { argb: COLORS.border } },
    bottom: { style: "thin", color: { argb: COLORS.border } },
    right: { style: "thin", color: { argb: COLORS.border } },
  };
}

function applyBodyRow(row, colCount, alt = false) {
  for (let c = 1; c <= colCount; c++) {
    const cell = row.getCell(c);
    cell.border = thinBorder();
    cell.alignment = { vertical: "middle", wrapText: true };
    if (alt) {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.altRow } };
    }
  }
}

function setMoney(cell) {
  cell.numFmt = '"$"#,##0.00';
  cell.alignment = { horizontal: "right", vertical: "middle" };
}

function addTitle(sheet, title, subtitle, mergeCols) {
  sheet.mergeCells(1, 1, 1, mergeCols);
  const titleCell = sheet.getCell(1, 1);
  titleCell.value = title;
  titleCell.font = { bold: true, size: 18, color: { argb: COLORS.brand } };
  titleCell.alignment = { horizontal: "center", vertical: "middle" };
  sheet.getRow(1).height = 32;

  sheet.mergeCells(2, 1, 2, mergeCols);
  const subCell = sheet.getCell(2, 1);
  subCell.value = subtitle;
  subCell.font = { size: 11, color: { argb: "FF6B7280" } };
  subCell.alignment = { horizontal: "center", vertical: "middle" };
  sheet.getRow(2).height = 20;
}

const restaurantName = setting("restaurantName") || "Barril";
const menuMap = new Map((data.menu || []).map((m) => [m.id, m]));
const itemsByOrder = new Map();
for (const item of data.orderItems || []) {
  const orderId = item.order_id ?? item.orderId;
  if (!itemsByOrder.has(orderId)) itemsByOrder.set(orderId, []);
  itemsByOrder.get(orderId).push(item);
}

const paidOrders = (data.orders || []).filter((o) => o.status === "paid");
const pendingOrders = (data.orders || []).filter((o) => o.status !== "paid");

let totalVentas = 0;
let totalEfectivo = 0;
let totalTransferencia = 0;
const byDay = new Map();
const byWaiter = new Map();
const byItem = new Map();
const byCategory = new Map();
const byService = { mesa: 0, para_llevar: 0, otro: 0 };
let containersSold = 0;
let containersRevenue = 0;

for (const order of paidOrders) {
  const total = money(order.total || order.paid_amount || 0);
  const paidAt = order.paid_at ?? order.paidAt ?? order.created_at;
  const day = dateKey(paidAt);
  const waiter = order.waiter_name ?? order.waiterName ?? "Sin mesero";
  const method = (order.payment_method ?? order.paymentMethod ?? "efectivo").toLowerCase();
  const service = order.service_type ?? order.serviceType ?? "mesa";

  totalVentas += total;
  if (method.includes("transfer")) totalTransferencia += total;
  else totalEfectivo += total;

  if (!byDay.has(day)) {
    byDay.set(day, { orders: 0, total: 0, efectivo: 0, transferencia: 0 });
  }
  const dayRow = byDay.get(day);
  dayRow.orders += 1;
  dayRow.total += total;
  if (method.includes("transfer")) dayRow.transferencia += total;
  else dayRow.efectivo += total;

  byWaiter.set(waiter, (byWaiter.get(waiter) || 0) + total);

  if (service === "para_llevar") byService.para_llevar += total;
  else if (service === "mesa") byService.mesa += total;
  else byService.otro += total;

  const expenses = parseJson(order.expenses_json ?? order.expensesJson, []);
  for (const exp of expenses || []) {
    if (exp.kind === "container" || /contenedor/i.test(exp.description || "")) {
      containersSold += Number(exp.quantity || 1);
      containersRevenue += Number(exp.amount || 0);
    }
  }

  for (const item of itemsByOrder.get(order.id) || []) {
    const menuItem = menuMap.get(item.menu_item_id ?? item.menuItemId);
    const name = item.name ?? menuItem?.name ?? item.menu_item_id ?? "Item";
    const category = menuItem?.category ?? "Sin categoria";
    const qty = Number(item.quantity || 0);
    const subtotal = money(item.subtotal);

    const itemRow = byItem.get(name) || { qty: 0, revenue: 0, category };
    itemRow.qty += qty;
    itemRow.revenue += subtotal;
    byItem.set(name, itemRow);

    byCategory.set(category, (byCategory.get(category) || 0) + subtotal);
  }
}

const cashSession = parseJson(setting("cashSession"), {});
const closingHistory = [...(cashSession.closingHistory || [])].sort((a, b) =>
  a.date < b.date ? -1 : 1,
);

const dates = paidOrders
  .map((o) => dateKey(o.paid_at ?? o.paidAt ?? o.created_at))
  .filter(Boolean)
  .sort();
const fromDate = dates[0] || "-";
const toDate = dates[dates.length - 1] || "-";

const topItems = [...byItem.entries()].sort((a, b) => b[1].qty - a[1].qty);
const topWaiters = [...byWaiter.entries()].sort((a, b) => b[1] - a[1]);

const workbook = new ExcelJS.Workbook();
workbook.creator = "Barril";
workbook.created = new Date();

// --- HOJA 1: RESUMEN ---
const summary = workbook.addWorksheet("Resumen", {
  views: [{ showGridLines: false }],
  properties: { tabColor: { argb: COLORS.brand } },
});

addTitle(
  summary,
  `Reporte de ventas — ${restaurantName}`,
  `Periodo: ${fromDate} al ${toDate}  |  Generado: ${fmtDateTime(new Date().toISOString())}`,
  4,
);

const kpiStart = 4;
const kpis = [
  ["Pedidos cobrados", paidOrders.length, "num"],
  ["Total vendido", totalVentas, "money"],
  ["Efectivo", totalEfectivo, "money"],
  ["Transferencia", totalTransferencia, "money"],
  ["Ventas en mesa", byService.mesa, "money"],
  ["Ventas para llevar", byService.para_llevar, "money"],
  ["Contenedores vendidos", containersSold, "num"],
  ["Ingreso contenedores", containersRevenue, "money"],
  ["Ticket promedio", paidOrders.length ? totalVentas / paidOrders.length : 0, "money"],
];

summary.getColumn(1).width = 28;
summary.getColumn(2).width = 18;
summary.getColumn(3).width = 4;
summary.getColumn(4).width = 28;

let r = kpiStart;
for (const [label, value, type] of kpis) {
  const row = summary.getRow(r);
  row.getCell(1).value = label;
  row.getCell(1).font = { bold: true, color: { argb: COLORS.header } };
  row.getCell(2).value = value;
  if (type === "money") setMoney(row.getCell(2));
  row.getCell(2).font = { bold: true, size: 12, color: { argb: COLORS.money } };
  row.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.brandLight } };
  row.getCell(2).fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.brandLight } };
  row.getCell(1).border = thinBorder();
  row.getCell(2).border = thinBorder();
  row.height = 22;
  r++;
}

// Top 5 productos mini en resumen
r += 1;
summary.mergeCells(r, 1, r, 4);
summary.getCell(r, 1).value = "Top 5 productos (cantidad)";
summary.getCell(r, 1).font = { bold: true, size: 12, color: { argb: COLORS.brand } };
r++;
const miniHeader = summary.getRow(r);
miniHeader.values = ["#", "Producto", "Cant.", "Ingreso"];
styleHeaderRow(miniHeader, 4);
r++;
topItems.slice(0, 5).forEach(([name, row], idx) => {
  const dataRow = summary.getRow(r);
  dataRow.values = [idx + 1, name, row.qty, row.revenue];
  setMoney(dataRow.getCell(4));
  applyBodyRow(dataRow, 4, idx % 2 === 1);
  r++;
});

// --- HOJA 2: POR DIA ---
const daily = workbook.addWorksheet("Por dia", {
  properties: { tabColor: { argb: "FF0284C7" } },
});
addTitle(daily, "Ventas por dia", "Segun fecha de cobro", 5);
daily.columns = [
  { width: 14 },
  { width: 12 },
  { width: 14 },
  { width: 14 },
  { width: 14 },
];
let dr = 4;
const dh = daily.getRow(dr);
dh.values = ["Fecha", "Pedidos", "Total", "Efectivo", "Transferencia"];
styleHeaderRow(dh, 5);
dr++;
let alt = false;
for (const [day, row] of [...byDay.entries()].sort()) {
  const dataRow = daily.getRow(dr);
  dataRow.values = [day, row.orders, row.total, row.efectivo, row.transferencia];
  for (const c of [3, 4, 5]) setMoney(dataRow.getCell(c));
  dataRow.getCell(2).alignment = { horizontal: "center" };
  applyBodyRow(dataRow, 5, alt);
  alt = !alt;
  dr++;
}
const totalRow = daily.getRow(dr);
totalRow.values = ["TOTAL", paidOrders.length, totalVentas, totalEfectivo, totalTransferencia];
totalRow.font = { bold: true };
for (const c of [3, 4, 5]) setMoney(totalRow.getCell(c));
styleHeaderRow(totalRow, 5);

// --- HOJA 3: CIERRES ---
const closes = workbook.addWorksheet("Cierres caja", {
  properties: { tabColor: { argb: "FF16A34A" } },
});
addTitle(closes, "Cierres de caja", "Registro de cierre diario", 7);
closes.columns = [
  { width: 12 },
  { width: 12 },
  { width: 12 },
  { width: 12 },
  { width: 14 },
  { width: 12 },
  { width: 12 },
];
let cr = 4;
const ch = closes.getRow(cr);
ch.values = ["Fecha", "Vendido", "Efectivo", "Transfer.", "Contado", "Diferencia", "Estado"];
styleHeaderRow(ch, 7);
cr++;
alt = false;
for (const close of closingHistory) {
  const diff = money(close.differenceTotal);
  const status =
    close.status === "surplus"
      ? "Sobrante"
      : close.status === "short"
        ? "Faltante"
        : close.matches
          ? "Cuadra"
          : "Revisado";
  const dataRow = closes.getRow(cr);
  dataRow.values = [
    close.date,
    close.totalSold,
    close.efectivo,
    close.transferencia,
    close.countedTotal,
    diff,
    status,
  ];
  for (const c of [2, 3, 4, 5, 6]) setMoney(dataRow.getCell(c));
  applyBodyRow(dataRow, 7, alt);
  if (diff < 0) dataRow.getCell(6).font = { color: { argb: "FFDC2626" } };
  if (diff > 0) dataRow.getCell(6).font = { color: { argb: "FF16A34A" } };
  alt = !alt;
  cr++;
}

// --- HOJA 4: MESEROS ---
const waiters = workbook.addWorksheet("Meseros", {
  properties: { tabColor: { argb: "FFF59E0B" } },
});
addTitle(waiters, "Ventas por mesero", restaurantName, 3);
waiters.columns = [{ width: 8 }, { width: 24 }, { width: 16 }];
let wr = 4;
const wh = waiters.getRow(wr);
wh.values = ["#", "Mesero", "Total vendido"];
styleHeaderRow(wh, 3);
wr++;
alt = false;
topWaiters.forEach(([name, amount], idx) => {
  const dataRow = waiters.getRow(wr);
  dataRow.values = [idx + 1, name, amount];
  setMoney(dataRow.getCell(3));
  applyBodyRow(dataRow, 3, alt);
  alt = !alt;
  wr++;
});

// --- HOJA 5: PRODUCTOS ---
const products = workbook.addWorksheet("Productos", {
  properties: { tabColor: { argb: "FF9333EA" } },
});
addTitle(products, "Productos vendidos", "Ordenado por cantidad", 5);
products.columns = [
  { width: 6 },
  { width: 32 },
  { width: 22 },
  { width: 10 },
  { width: 14 },
];
let pr = 4;
const ph = products.getRow(pr);
ph.values = ["#", "Producto", "Categoria", "Cantidad", "Ingreso"];
styleHeaderRow(ph, 5);
pr++;
alt = false;
topItems.forEach(([name, row], idx) => {
  const dataRow = products.getRow(pr);
  dataRow.values = [idx + 1, name, row.category, row.qty, row.revenue];
  setMoney(dataRow.getCell(5));
  dataRow.getCell(4).alignment = { horizontal: "center" };
  applyBodyRow(dataRow, 5, alt);
  alt = !alt;
  pr++;
});

// --- HOJA 6: CATEGORIAS ---
const categories = workbook.addWorksheet("Categorias", {
  properties: { tabColor: { argb: "FF0891B2" } },
});
addTitle(categories, "Ventas por categoria", restaurantName, 3);
categories.columns = [{ width: 8 }, { width: 30 }, { width: 16 }];
let catr = 4;
const cath = categories.getRow(catr);
cath.values = ["#", "Categoria", "Ingreso"];
styleHeaderRow(cath, 3);
catr++;
alt = false;
[...byCategory.entries()]
  .sort((a, b) => b[1] - a[1])
  .forEach(([category, amount], idx) => {
    const dataRow = categories.getRow(catr);
    dataRow.values = [idx + 1, category, amount];
    setMoney(dataRow.getCell(3));
    applyBodyRow(dataRow, 3, alt);
    alt = !alt;
    catr++;
  });

// --- HOJA 7: DETALLE PEDIDOS ---
const detail = workbook.addWorksheet("Detalle pedidos", {
  properties: { tabColor: { argb: COLORS.brand } },
});
addTitle(detail, "Detalle de pedidos cobrados", `${paidOrders.length} pedidos`, 10);
detail.columns = [
  { width: 14 },
  { width: 12 },
  { width: 20 },
  { width: 12 },
  { width: 14 },
  { width: 12 },
  { width: 14 },
  { width: 16 },
  { width: 16 },
  { width: 40 },
];
let der = 4;
const deh = detail.getRow(der);
deh.values = [
  "Pedido",
  "Fecha cobro",
  "Cliente",
  "Mesa",
  "Mesero",
  "Servicio",
  "Pago",
  "Total",
  "Creado",
  "Detalle platos",
];
styleHeaderRow(deh, 10);
der++;
alt = false;

const ordersSorted = [...paidOrders].sort((a, b) => {
  const da = a.paid_at ?? a.paidAt ?? a.created_at;
  const db = b.paid_at ?? b.paidAt ?? b.created_at;
  return da < db ? -1 : 1;
});

for (const order of ordersSorted) {
  const items = itemsByOrder.get(order.id) || [];
  const detailText = items
    .map((item) => {
      const qty = Number(item.quantity || 0);
      const name = item.name ?? menuMap.get(item.menu_item_id)?.name ?? "Item";
      return `${qty}x ${name}`;
    })
    .join(" | ");

  const dataRow = detail.getRow(der);
  dataRow.values = [
    order.id,
    fmtDate(order.paid_at ?? order.paidAt),
    order.client_name ?? order.clientName ?? "-",
    order.table_number ?? order.tableNumber ?? "-",
    order.waiter_name ?? order.waiterName ?? "-",
    order.service_type ?? order.serviceType ?? "mesa",
    order.payment_method ?? order.paymentMethod ?? "-",
    money(order.total),
    fmtDateTime(order.created_at ?? order.createdAt),
    detailText,
  ];
  setMoney(dataRow.getCell(8));
  applyBodyRow(dataRow, 10, alt);
  dataRow.height = detailText.length > 80 ? 36 : 22;
  alt = !alt;
  der++;
}

if (pendingOrders.length) {
  const pending = workbook.addWorksheet("Pendientes", {
    properties: { tabColor: { argb: "FFDC2626" } },
  });
  addTitle(pending, "Pedidos no cobrados", "Al momento del respaldo", 4);
  pending.columns = [{ width: 14 }, { width: 24 }, { width: 12 }, { width: 12 }];
  let per = 4;
  const peh = pending.getRow(per);
  peh.values = ["Pedido", "Cliente", "Total", "Estado"];
  styleHeaderRow(peh, 4);
  per++;
  pendingOrders.forEach((order, idx) => {
    const dataRow = pending.getRow(per);
    dataRow.values = [
      order.id,
      order.client_name ?? order.clientName,
      money(order.total),
      order.status,
    ];
    setMoney(dataRow.getCell(3));
    applyBodyRow(dataRow, 4, idx % 2 === 1);
    per++;
  });
}

await workbook.xlsx.writeFile(outputPath);
console.log("Excel guardado en:", outputPath);
console.log("Pedidos:", paidOrders.length, "| Total:", totalVentas.toFixed(2));
