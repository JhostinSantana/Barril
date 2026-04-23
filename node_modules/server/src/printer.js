import net from 'node:net';

function getPrinterSettings() {
  const host = process.env.KITCHEN_PRINTER_HOST?.trim();
  const port = Number(process.env.KITCHEN_PRINTER_PORT ?? 9100);
  return { host, port: Number.isFinite(port) ? port : 9100 };
}

function buildTicketText(order, restaurantName) {
  const lines = [];
  lines.push(restaurantName);
  lines.push('COMANDA COCINA');
  lines.push(`ID: ${order.id}`);
  lines.push(`CLIENTE: ${order.clientName}`);
  lines.push(`MESERO: ${order.waiterName}`);
  lines.push(`MESA: ${order.tableNumber}`);
  lines.push(`FECHA: ${new Date(order.createdAt).toLocaleString('es-CO')}`);
  lines.push('--------------------------------');
  lines.push('PEDIDO');
  order.items.forEach((item) => {
    lines.push(`${item.category} - ${item.quantity} x ${item.name}`);
  });
  lines.push('--------------------------------');
  lines.push('ENTREGAR SIN PRECIOS');
  lines.push('');
  lines.push('');
  return lines.join('\n');
}

export async function printKitchenTicket(order, restaurantName) {
  const { host, port } = getPrinterSettings();
  if (!host) {
    return { printed: false, reason: 'printer-not-configured' };
  }

  const ticketText = buildTicketText(order, restaurantName);

  await new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port }, () => {
      socket.write(Buffer.from([0x1b, 0x40]));
      socket.write(Buffer.from(ticketText, 'utf8'));
      socket.write(Buffer.from([0x1d, 0x56, 0x42, 0x00]));
      socket.end();
    });

    socket.on('error', reject);
    socket.on('close', resolve);
  });

  return { printed: true, reason: 'sent-to-printer' };
}
