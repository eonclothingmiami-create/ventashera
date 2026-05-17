// Ticket POS 80mm — CSS/HTML compartido (core.js, config preview, legacy opcional).
(function initPosReceiptPrint(global) {
  const POS_RECEIPT_PRINT_CSS = `
  @page { size: 80mm auto; margin: 0; }
  @media print {
    html, body { width: 80mm; max-width: 80mm; margin: 0; padding: 2mm 1mm; }
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Courier New', Courier, monospace;
    font-size: 13px;
    line-height: 1.4;
    width: 76mm;
    max-width: 76mm;
    padding: 2mm 1mm;
    color: #000;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .receipt-logo { max-width: 100%; height: auto; display: block; margin: 0 auto 6px; filter: grayscale(1); }
  .center { text-align: center; }
  .bold { font-weight: bold; }
  .line { border-top: 1px dashed #000; margin: 6px 0; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th { font-size: 11px; border-bottom: 1px solid #000; padding: 3px 0; text-align: left; font-weight: 700; }
  th:last-child, td:last-child { text-align: right; }
  th:nth-child(2), td:nth-child(2) { text-align: center; }
  th:nth-child(1), td.item-desc { width: 58%; word-break: break-word; overflow-wrap: anywhere; }
  th:nth-child(2) { width: 14%; }
  th:nth-child(3) { width: 28%; }
  td.item-desc { padding: 3px 2px 3px 0; vertical-align: top; line-height: 1.45; }
  .total-row td { font-size: 15px; font-weight: 900; padding-top: 5px; }
  .total-row td:last-child { font-size: 16px; }
  .small { font-size: 11px; line-height: 1.45; }
  .title-name { font-size: 15px; }
  .title-inv { font-size: 14px; }
  .msg-block { white-space: pre-wrap; line-height: 1.45; }
`;

  function posReceiptLogoHtml(emp) {
    return emp.logoBase64
      ? `<img class="receipt-logo" src="${emp.logoBase64}" alt="">`
      : `<div style="font-family:Arial;font-size:20px;font-weight:900;text-align:center;letter-spacing:2px;margin-bottom:4px">${emp.nombre || 'EON CLOTHING'}</div>`;
  }

  function buildPosReceiptHtml(factura, ctx) {
    const emp = (ctx.state && ctx.state.empresa) || {};
    const todayFn = ctx.today || (() => new Date().toISOString().slice(0, 10));
    const fmtN = ctx.fmtN || global.fmtN || ((n) => String(n));
    const logoHtml = posReceiptLogoHtml(emp);

    const itemsList = factura.items || [];
    const subtotal = factura.subtotal || 0;
    const iva = factura.iva || 0;
    const flete = factura.flete || 0;
    const total = factura.total || (subtotal + iva + flete);
    const nombreCliente = factura.customer_name || factura.cliente || 'CLIENTE MOSTRADOR';
    const telefonoCliente = factura.customer_phone || factura.telefono || '';
    const ciudadCliente = factura.ciudad || '';
    const numeroFactura = factura.number || factura.numero || 'PREVIEW';
    const fecha = factura.fecha || todayFn();
    const hora = new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
    const metodo = factura.metodo || factura.metodoPago || 'Efectivo';
    const vendedora = emp.vendedora || '';
    const bodega = emp.nombreComercial || emp.nombre || '';

    const itemsHTML = itemsList.map((i) => {
      const precio = i.price || i.precio || 0;
      const qty = i.qty || i.cantidad || 1;
      const nom = i.name || i.nombre || '';
      const ref = i.ref || i.codigo || '';
      const talla = i.talla || '';
      return `<tr>
      <td class="item-desc">
        <b>${nom}</b>${ref ? ' | ' + ref : ''}${talla ? '<br>Talla: ' + talla : ''}
      </td>
      <td style="text-align:center;vertical-align:top;padding:3px 2px;white-space:nowrap;">x${qty}</td>
      <td style="text-align:right;vertical-align:top;white-space:nowrap;"><b>${fmtN(precio * qty)}</b></td>
    </tr>`;
    }).join('');

    return `<!DOCTYPE html><html><head><meta charset="UTF-8">
  <style>${POS_RECEIPT_PRINT_CSS}</style></head><body>

  <div class="center">${logoHtml}</div>
  <div class="center bold title-name">${emp.nombre || 'EON CLOTHING'}</div>
  ${emp.nombreComercial && emp.nombreComercial !== emp.nombre ? `<div class="center">${emp.nombreComercial}</div>` : ''}
  <div class="center small">NIT: ${emp.nit || ''} | ${emp.regimenFiscal || 'Régimen ordinario No responsable de IVA'}</div>
  <div class="center small">${emp.departamento || ''} / ${emp.ciudad || ''} / ${emp.direccion || ''}</div>
  <div class="center small">Teléfonos: ${emp.telefono || ''}${emp.telefono2 ? ' / ' + emp.telefono2 : ''}</div>
  ${emp.email ? `<div class="center small">Email: ${emp.email}</div>` : ''}
  ${emp.web ? `<div class="center small">Página web: ${emp.web}</div>` : ''}

  <div class="line"></div>
  <div class="center bold title-inv">FACTURA DE VENTA</div>
  <div class="center bold">No.: ${numeroFactura}</div>
  <div class="center small">${emp.nombreComercial || emp.nombre || ''}</div>
  <div class="center small">${fecha} ${hora}</div>

  ${emp.mensajeHeader ? `<div class="line"></div><div class="center small msg-block">${emp.mensajeHeader}</div>` : ''}

  <div class="line"></div>
  <div class="small">Cliente: <b>${nombreCliente}</b>${telefonoCliente ? ' | ' + telefonoCliente : ''}${factura.cedulaCliente || factura.cedula_cliente ? ' | CC: ' + (factura.cedulaCliente || factura.cedula_cliente) : ''}${ciudadCliente ? ' | Ciudad: ' + ciudadCliente : ''}${factura.direccion ? ' | Dir: ' + factura.direccion : ''}</div>
  ${vendedora ? `<div class="small">Elaboró: ${vendedora}</div>` : ''}
  ${bodega ? `<div class="small">Vendedor: ${vendedora || ''} | Bodega: ${bodega}</div>` : ''}

  <div class="line"></div>
  <table>
    <thead><tr><th>DESCRIPCIÓN</th><th>CANT</th><th>TOTAL</th></tr></thead>
    <tbody>${itemsHTML}</tbody>
  </table>
  <div class="line"></div>

  <table>
    <tr><td>SUBTOTAL</td><td></td><td style="text-align:right">${fmtN(subtotal)}</td></tr>
    ${iva > 0 ? `<tr><td>IVA (19%)</td><td></td><td style="text-align:right">${fmtN(iva)}</td></tr>` : ''}
    ${flete > 0 ? `<tr><td>Flete</td><td></td><td style="text-align:right">${fmtN(flete)}</td></tr>` : ''}
    <tr class="total-row"><td colspan="2">TOTAL NETO</td><td style="text-align:right">${fmtN(total)}</td></tr>
  </table>
  <div class="line"></div>

  <div class="small bold">MEDIO DE PAGO:</div>
  <div class="small">${metodo}</div>

  ${emp.mensajePie ? `<div class="line"></div><div class="center small bold msg-block">${emp.mensajePie}</div>` : ''}
  ${emp.politicaDatos ? `<div class="line"></div><div class="center small msg-block">${emp.politicaDatos}</div>` : ''}
  ${emp.web ? `<div class="center small">${emp.web}</div>` : ''}
  ${emp.mensajeGarantias ? `<div class="line"></div><div class="center small msg-block" style="font-style:italic;">${emp.mensajeGarantias}</div>` : ''}

  <div class="line"></div>
  <div class="center small">Factura generada por VentasHera ERP</div>

  </body></html>`;
  }

  function printPosReceipt(factura, ctx) {
    const receiptHTML = buildPosReceiptHtml(factura, ctx);
    const notify = ctx.notify || global.notify;
    const pWin = global.open('', '_blank', 'width=320,height=800,scrollbars=yes');
    if (!pWin) {
      if (notify) notify('warning', '⚠️', 'Popup bloqueado', 'Permite popups para imprimir.', { duration: 4000 });
      return;
    }
    pWin.document.write(receiptHTML);
    pWin.document.close();
    setTimeout(() => { pWin.print(); }, 600);
  }

  global.AppPosReceipt = {
    css: POS_RECEIPT_PRINT_CSS,
    buildHtml: buildPosReceiptHtml,
    print: printPosReceipt,
    getPreviewContainerStyle() {
      return "background:white;color:#000;font-family:'Courier New',Courier,monospace;font-size:13px;line-height:1.4;width:76mm;max-width:76mm;padding:2mm 1mm;border:1px solid #ddd;border-radius:4px;margin:0 auto;box-sizing:border-box";
    },
    getPreviewSmallStyle() {
      return 'font-size:11px;line-height:1.45';
    },
    getPreviewTitleStyle() {
      return 'font-size:15px;font-weight:700';
    },
    getPreviewTotalStyle() {
      return 'font-weight:900;font-size:16px;text-align:right';
    }
  };
})(window);
