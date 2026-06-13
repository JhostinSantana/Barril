import fs from "node:fs";
import path from "node:path";

const inputPath = process.argv[2];
const outputPath =
  process.argv[3] ||
  path.join(
    path.dirname(inputPath || "."),
    `REPORTE-VENTAS-${new Date().toISOString().slice(0, 10)}.md`,
  );

if (!inputPath || !fs.existsSync(inputPath)) {
  console.error("Uso: node scripts/generate-sales-report.mjs <backup.json> [salida.md]");
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const TZ = "America/Guayaquil";

function money(n) {
  return `$${Number(n || 0).toFixed(2)}`;
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
  const total = Number(order.total || order.paid_amount || 0);
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
    const subtotal = Number(item.subtotal || 0);

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

const topItems = [...byItem.entries()]
  .sort((a, b) => b[1].qty - a[1].qty)
  .slice(0, 25);

const topWaiters = [...byWaiter.entries()].sort((a, b) => b[1] - a[1]);

const lines = [];
lines.push(`# Reporte de ventas — ${restaurantName}`);
lines.push("");
lines.push(`**Respaldo:** \`${path.basename(inputPath)}\`  `);
lines.push(`**Generado:** ${fmtDateTime(new Date().toISOString())}  `);
lines.push(`**Periodo con ventas cobradas:** ${fromDate} a ${toDate}`);
lines.push("");
lines.push("---");
lines.push("");
lines.push("## Resumen general");
lines.push("");
lines.push(`| Concepto | Valor |`);
lines.push(`|----------|------:|`);
lines.push(`| Pedidos cobrados | ${paidOrders.length} |`);
lines.push(`| Pedidos pendientes / abiertos | ${pendingOrders.length} |`);
lines.push(`| **Total vendido (cobrado)** | **${money(totalVentas)}** |`);
lines.push(`| Efectivo | ${money(totalEfectivo)} |`);
lines.push(`| Transferencia | ${money(totalTransferencia)} |`);
lines.push(`| Ventas en mesa | ${money(byService.mesa)} |`);
lines.push(`| Ventas para llevar | ${money(byService.para_llevar)} |`);
lines.push(`| Contenedores vendidos | ${containersSold} (${money(containersRevenue)}) |`);
lines.push("");
lines.push("---");
lines.push("");
lines.push("## Ventas por dia (segun fecha de cobro)");
lines.push("");
lines.push("| Fecha | Pedidos | Total | Efectivo | Transferencia |");
lines.push("|-------|--------:|------:|---------:|--------------:|");
for (const [day, row] of [...byDay.entries()].sort()) {
  lines.push(
    `| ${day} | ${row.orders} | ${money(row.total)} | ${money(row.efectivo)} | ${money(row.transferencia)} |`,
  );
}
lines.push(
  `| **TOTAL** | **${paidOrders.length}** | **${money(totalVentas)}** | **${money(totalEfectivo)}** | **${money(totalTransferencia)}** |`,
);
lines.push("");
lines.push("---");
lines.push("");
lines.push("## Cierres de caja registrados");
lines.push("");
if (closingHistory.length === 0) {
  lines.push("_No hay cierres de caja en el respaldo._");
} else {
  lines.push("| Fecha | Vendido | Efectivo | Transferencia | Contado total | Diferencia | Estado |");
  lines.push("|-------|--------:|---------:|--------------:|--------------:|-----------:|--------|");
  for (const close of closingHistory) {
    const diff = Number(close.differenceTotal ?? 0);
    const status =
      close.status === "surplus"
        ? "Sobrante"
        : close.status === "short"
          ? "Faltante"
          : close.matches
            ? "Cuadra"
            : "Revisado";
    lines.push(
      `| ${close.date} | ${money(close.totalSold)} | ${money(close.efectivo)} | ${money(close.transferencia)} | ${money(close.countedTotal)} | ${money(diff)} | ${status} |`,
    );
  }
  const cierreTotal = closingHistory.reduce((s, c) => s + Number(c.totalSold || 0), 0);
  lines.push("");
  lines.push(`**Suma de cierres de caja:** ${money(cierreTotal)}`);
}
lines.push("");
lines.push("---");
lines.push("");
lines.push("## Ventas por mesero");
lines.push("");
lines.push("| Mesero | Total vendido |");
lines.push("|--------|-------------:|");
for (const [waiter, amount] of topWaiters) {
  lines.push(`| ${waiter} | ${money(amount)} |`);
}
lines.push("");
lines.push("---");
lines.push("");
lines.push("## Platos / productos mas vendidos (por cantidad)");
lines.push("");
lines.push("| # | Producto | Categoria | Cantidad | Ingreso |");
lines.push("|--:|----------|-----------|----------|--------:|");
topItems.forEach(([name, row], index) => {
  lines.push(`| ${index + 1} | ${name} | ${row.category} | ${row.qty} | ${money(row.revenue)} |`);
});
lines.push("");
lines.push("---");
lines.push("");
lines.push("## Ventas por categoria");
lines.push("");
lines.push("| Categoria | Ingreso |");
lines.push("|-----------|--------:|");
for (const [category, amount] of [...byCategory.entries()].sort((a, b) => b[1] - a[1])) {
  lines.push(`| ${category} | ${money(amount)} |`);
}
lines.push("");
lines.push("---");
lines.push("");
lines.push("## Detalle de pedidos cobrados");
lines.push("");

const ordersSorted = [...paidOrders].sort((a, b) => {
  const da = a.paid_at ?? a.paidAt ?? a.created_at;
  const db = b.paid_at ?? b.paidAt ?? b.created_at;
  return da < db ? -1 : 1;
});

for (const order of ordersSorted) {
  const items = itemsByOrder.get(order.id) || [];
  const itemLines = items
    .map((item) => {
      const qty = Number(item.quantity || 0);
      const name = item.name ?? menuMap.get(item.menu_item_id)?.name ?? "Item";
      const sub = money(item.subtotal);
      const notes = item.notes ? ` _(${item.notes})_` : "";
      return `- ${qty}x ${name} — ${sub}${notes}`;
    })
    .join("\n");

  const fulfilled = parseJson(
    order.kitchen_fulfilled_items_json ?? order.kitchenFulfilledItemsJson,
    [],
  );
  const method = order.payment_method ?? order.paymentMethod ?? "-";
  const table = order.table_number ?? order.tableNumber ?? "-";
  const client = order.client_name ?? order.clientName ?? "-";
  const waiter = order.waiter_name ?? order.waiterName ?? "-";
  const service = order.service_type ?? order.serviceType ?? "mesa";

  lines.push(`### ${order.id} — ${money(order.total)}`);
  lines.push("");
  lines.push(`- **Cliente:** ${client}`);
  lines.push(`- **Mesa / servicio:** ${table} (${service})`);
  lines.push(`- **Mesero:** ${waiter}`);
  lines.push(`- **Pago:** ${method}`);
  lines.push(`- **Creado:** ${fmtDateTime(order.created_at ?? order.createdAt)}`);
  lines.push(`- **Cobrado:** ${fmtDateTime(order.paid_at ?? order.paidAt)}`);
  lines.push(`- **Cocina:** ${order.kitchen_status ?? order.kitchenStatus ?? "-"}`);
  if (fulfilled?.length) {
    lines.push(
      `- **Items cocina:** ${fulfilled.map((i) => `${i.quantity}x ${i.name}`).join(", ")}`,
    );
  }
  lines.push("");
  lines.push("**Detalle:**");
  lines.push(itemLines || "_Sin lineas de detalle en respaldo._");
  lines.push("");
}

if (pendingOrders.length) {
  lines.push("---");
  lines.push("");
  lines.push("## Pedidos no cobrados (pendientes al respaldo)");
  lines.push("");
  for (const order of pendingOrders) {
    lines.push(
      `- ${order.id} | ${order.client_name ?? order.clientName} | ${money(order.total)} | ${order.status}`,
    );
  }
}

lines.push("");
lines.push("---");
lines.push("");
lines.push("_Reporte generado automaticamente desde respaldo JSON de Barril._");

fs.writeFileSync(outputPath, lines.join("\n"), "utf8");
console.log("Reporte guardado en:", outputPath);
console.log("Pedidos cobrados:", paidOrders.length);
console.log("Total vendido:", money(totalVentas));
