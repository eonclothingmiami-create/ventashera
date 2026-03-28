// PDF descargable para Cotizaciones y Facturas (jsPDF + autoTable). Reutiliza totales del documento en estado.
(function initDocumentPdf(global) {
  function safeFileSegment(s) {
    return String(s ?? 'doc')
      .replace(/[/\\?%*:|"<>]/g, '-')
      .replace(/\s+/g, '_')
      .slice(0, 96);
  }

  function stripDataUrl(b64) {
    if (!b64 || typeof b64 !== 'string') return null;
    const m = b64.match(/^data:image\/(\w+);base64,(.+)$/i);
    if (m) return { format: (m[1] || 'png').toLowerCase(), data: m[2] };
    return { format: 'png', data: b64 };
  }

  /**
   * @param {object} ctx
   * @param {object} ctx.doc — registro cotización/factura del state
   * @param {'cotizaciones'|'facturas'} ctx.collection
   * @param {object} ctx.state
   * @param {function} ctx.fmt — mismo formateo moneda que el ERP (COP)
   * @param {function} [ctx.notify]
   */
  async function download(ctx) {
    const { doc, collection, state, fmt, notify } = ctx;
    const meta =
      collection === 'cotizaciones'
        ? { docTitle: 'COTIZACIÓN', filePrefix: 'cotizacion' }
        : collection === 'facturas'
          ? { docTitle: 'FACTURA', filePrefix: 'factura' }
          : null;
    if (!meta) {
      if (notify) notify('warning', 'PDF', 'No disponible', 'Solo cotizaciones y facturas.', { duration: 4000 });
      return;
    }
    const JsPdfCtor = (global.jspdf && global.jspdf.jsPDF) || global.jsPDF;
    if (typeof JsPdfCtor !== 'function') {
      if (notify) {
        notify(
          'danger',
          'PDF',
          'Biblioteca no cargada',
          'No se pudo generar el PDF (jsPDF). Recarga la página.',
          { duration: 6000 },
        );
      }
      return;
    }
    const items = Array.isArray(doc.items) ? doc.items : [];
    const subtotal = parseFloat(doc.subtotal) || 0;
    const iva = parseFloat(doc.iva) || 0;
    const flete = parseFloat(doc.flete) || 0;
    const descuento = parseFloat(doc.descuento) || 0;
    const totalDoc = parseFloat(doc.total);
    const total = Number.isFinite(totalDoc) ? totalDoc : subtotal + iva + flete - descuento;

    const emp = (state && state.empresa) || {};
    const numero = doc.numero || doc.number || 'SIN-NUM';
    const fecha = doc.fecha || '';
    const cliente = doc.cliente || doc.customer_name || '—';
    const tel = doc.telefono || doc.customer_phone || '';
    const ciudad = doc.ciudad || '';
    const dir = doc.direccion || '';
    const cedula = doc.cedulaCliente || doc.cedula_cliente || '';
    const obs = doc.observaciones || '';
    const canal = doc.canal || '';
    const metodo = doc.metodo || doc.metodo_pago || doc.metodoPago || '';
    const estado = doc.estado || '';
    const comprobante = doc.comprobante || '';

    try {
      const pdf = new JsPdfCtor({ unit: 'mm', format: 'a4', orientation: 'portrait' });
      const pageW = pdf.internal.pageSize.getWidth();
      const margin = 14;
      let y = margin;

      const logo = stripDataUrl(emp.logoBase64);
      if (logo && logo.data) {
        try {
          pdf.addImage(logo.data, logo.format === 'jpeg' || logo.format === 'jpg' ? 'JPEG' : 'PNG', margin, y, 42, 18);
        } catch (_) {
          /* omitir logo si falla */
        }
      }

      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(16);
      pdf.setTextColor(22, 24, 28);
      pdf.text(String(emp.nombre || 'Empresa'), margin + (logo ? 46 : 0), y + 7);

      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(8.5);
      pdf.setTextColor(80, 86, 94);
      const empLines = [
        [emp.nombreComercial && emp.nombreComercial !== emp.nombre ? emp.nombreComercial : null, emp.nit ? `NIT: ${emp.nit}` : null]
          .filter(Boolean)
          .join(' · '),
        [emp.direccion, emp.ciudad, emp.departamento].filter(Boolean).join(' · '),
        [emp.telefono, emp.telefono2].filter(Boolean).join(' / '),
        emp.email || '',
        emp.web || '',
      ].filter((line) => line && String(line).trim());
      empLines.forEach((line, i) => {
        pdf.text(String(line).slice(0, 95), margin + (logo ? 46 : 0), y + 12 + i * 4);
      });

      y = Math.max(y + 28, margin + 22);
      pdf.setDrawColor(0, 229, 180);
      pdf.setLineWidth(0.4);
      pdf.line(margin, y, pageW - margin, y);
      y += 8;

      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(13);
      pdf.setTextColor(0, 229, 180);
      pdf.text(meta.docTitle, margin, y);
      pdf.setFontSize(10);
      pdf.setTextColor(22, 24, 28);
      pdf.text(`No. ${numero}`, pageW - margin, y, { align: 'right' });
      y += 6;
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(9);
      pdf.text(`Fecha: ${fecha}`, margin, y);
      if (collection === 'facturas') {
        const tipoLbl = (doc.tipo || '').toLowerCase() === 'pos' ? 'POS' : (doc.tipo || '—');
        pdf.text(`Tipo: ${tipoLbl}`, pageW - margin, y, { align: 'right' });
      }
      y += 8;

      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(10);
      pdf.text('Cliente', margin, y);
      y += 5;
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(9);
      const cliLines = [
        cliente,
        tel ? `Tel: ${tel}` : null,
        cedula ? `Doc: ${cedula}` : null,
        ciudad ? `Ciudad: ${ciudad}` : null,
        dir ? `Dir: ${dir}` : null,
      ].filter(Boolean);
      cliLines.forEach((line) => {
        pdf.text(String(line).slice(0, 100), margin, y);
        y += 4.5;
      });
      y += 4;

      const body = [];
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const nombre = String(it.nombre || it.name || '—').slice(0, 42);
        const talla = String(it.talla || '—').slice(0, 12);
        const qty = Math.abs(parseFloat(it.cantidad ?? it.qty) || 0) || 0;
        const precio = parseFloat(it.precio ?? it.price) || 0;
        const lineSub = qty * precio;
        body.push([
          nombre,
          talla,
          String(qty),
          fmt(precio),
          fmt(lineSub),
        ]);
      }
      if (body.length === 0) {
        body.push(['(Sin ítems en el documento)', '—', '—', '—', '—']);
      }

      if (typeof pdf.autoTable !== 'function') {
        throw new Error('autoTable no disponible');
      }

      pdf.autoTable({
        startY: y,
        head: [['Producto', 'Talla', 'Cant.', 'Precio unit.', 'Subtotal']],
        body,
        margin: { left: margin, right: margin },
        styles: { fontSize: 8, cellPadding: 2, textColor: [22, 24, 28] },
        headStyles: { fillColor: [18, 22, 28], textColor: [255, 255, 255], fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        columnStyles: {
          0: { cellWidth: 62 },
          1: { cellWidth: 18, halign: 'center' },
          2: { cellWidth: 16, halign: 'center' },
          3: { cellWidth: 32, halign: 'right' },
          4: { cellWidth: 32, halign: 'right' },
        },
        didDrawPage: (data) => {
          const pageCount = pdf.internal.getNumberOfPages();
          pdf.setFontSize(7);
          pdf.setTextColor(140, 140, 140);
          pdf.text(
            `Pág. ${data.pageNumber} / ${pageCount}`,
            pageW - margin,
            pdf.internal.pageSize.getHeight() - 8,
            { align: 'right' },
          );
        },
      });

      let afterY = pdf.lastAutoTable.finalY + 8;
      const totRight = pageW - margin;
      const totW = 72;
      const totLeft = totRight - totW;

      function drawTotLine(label, value, opts) {
        const o = opts || {};
        pdf.setFont('helvetica', o.bold ? 'bold' : 'normal');
        pdf.setFontSize(o.size || 9);
        const rgb = o.rgb || (o.dark ? [18, 22, 28] : [60, 66, 74]);
        pdf.setTextColor(rgb[0], rgb[1], rgb[2]);
        pdf.text(label, totLeft, afterY, { maxWidth: totW * 0.55, align: 'left' });
        pdf.text(value, totRight, afterY, { align: 'right' });
        afterY += o.gap != null ? o.gap : 6;
      }

      drawTotLine('Subtotal', fmt(subtotal));
      if (descuento > 0) drawTotLine('Descuentos', `-${fmt(descuento)}`);
      if (iva > 0) drawTotLine('IVA (19%)', fmt(iva));
      if (flete > 0) drawTotLine('Flete', fmt(flete));
      drawTotLine('TOTAL', fmt(total), { bold: true, size: 11, rgb: [0, 229, 180], gap: 10 });
      pdf.setFontSize(8.5);
      pdf.setTextColor(60, 66, 74);
      const extras = [];
      if (metodo) extras.push(`Método de pago: ${metodo}`);
      if (canal) extras.push(`Canal: ${canal}`);
      if (estado) extras.push(`Estado: ${estado}`);
      if (comprobante) extras.push(`Comprobante: ${String(comprobante).slice(0, 120)}`);
      if (extras.length) {
        pdf.text(extras.join('  ·  '), margin, afterY, { maxWidth: pageW - 2 * margin });
        afterY += 6 + extras.length * 2;
      }
      if (obs) {
        pdf.setFont('helvetica', 'bold');
        pdf.text('Observaciones', margin, afterY);
        afterY += 4;
        pdf.setFont('helvetica', 'normal');
        const obsChunks = pdf.splitTextToSize(String(obs), pageW - 2 * margin);
        pdf.text(obsChunks, margin, afterY);
      }

      const fname = `${meta.filePrefix}-${safeFileSegment(numero)}.pdf`;
      pdf.save(fname);

      if (notify) {
        notify('success', 'PDF', 'Listo', `Descargado: ${fname}`, { duration: 3500 });
      }
    } catch (e) {
      console.warn('[PDF]', e);
      if (notify) {
        notify('danger', 'PDF', 'Error', 'No se pudo generar el PDF, intenta de nuevo.', { duration: 6000 });
      }
    }
  }

  global.AppDocumentPdf = { download };
})(window);
