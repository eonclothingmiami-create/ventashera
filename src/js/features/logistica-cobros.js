// ===================================================================
// ===== COBROS / PENDIENTES =====
// ===================================================================

function renderLogistica(){
  const el=document.getElementById('logistica-content');if(!el)return;
  const q=(document.getElementById('log-search')?.value||'').toLowerCase();
  const desde=document.getElementById('log-desde')?.value||'';
  const hasta=document.getElementById('log-hasta')?.value||'';
  const canal=document.getElementById('log-canal')?.value||'';
  const trans=document.getElementById('log-trans')?.value||'';
  let guias=[...(state.ventas||[])].filter(v=>v.canal==='local'||v.canal==='inter').reverse();
  if(canal)guias=guias.filter(v=>v.canal===canal);
  if(trans)guias=guias.filter(v=>(v.transportadora||'').toLowerCase().includes(trans.toLowerCase()));
  if(desde)guias=guias.filter(v=>v.fecha>=desde);
  if(hasta)guias=guias.filter(v=>v.fecha<=hasta);
  if(q)guias=guias.filter(v=>(v.cliente||'').toLowerCase().includes(q)||(v.guia||'').toLowerCase().includes(q)||(v.telefono||'').toLowerCase().includes(q)||(v.ciudad||'').toLowerCase().includes(q));
  const total=(state.ventas||[]).filter(v=>v.canal==='local'||v.canal==='inter').length;

  const rowsHtml = guias.map(v=>`<tr>
    <td>${formatDate(v.fecha)}</td>
    <td><span class="badge ${v.canal==='local'?'badge-warn':'badge-inter'}">${v.canal==='local'?'ðŸ›µ':'ðŸ“¦'} ${v.canal}</span></td>
    <td style="font-weight:700">${v.cliente||'â€”'}</td>
    <td>${v.telefono||'â€”'}</td>
    <td>${v.ciudad||'â€”'}</td>
    <td>${v.transportadora||v.empresa||'â€”'}</td>
    <td style="color:var(--accent);font-weight:700">${v.guia||'â€”'}</td>
    <td style="font-weight:700">${fmt(v.valor||0)}</td>
    <td><span class="badge ${v.liquidado?'badge-ok':'badge-pend'}">${v.liquidado?'âœ“ Liq':'â³ Pend'}</span></td>
    <td><span class="badge ${v.esContraEntrega?'badge-warn':'badge-ok'}">${v.esContraEntrega?'ðŸ“¦ C/E':'ðŸ’µ Ctdo'}</span></td>
    <td><button class="btn btn-xs btn-secondary" onclick="imprimirDespacho('${v.id}')" title="Relación de despacho">🖨️</button></td>
  </tr>`).join('')||'<tr><td colspan="11" style="text-align:center;color:var(--text2);padding:24px">Sin guías</td></tr>';

  if(document.getElementById('log-tbody')) {
    document.getElementById('log-tbody').innerHTML = rowsHtml;
    const cnt = document.getElementById('log-count');
    if(cnt) cnt.textContent = `${guias.length} de ${total}`;
    const btnL = document.getElementById('log-limpiar');
    if(btnL) btnL.style.display=(q||canal||trans||desde||hasta)?'inline-flex':'none';
    return;
  }

  el.innerHTML=`
    <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;margin-bottom:16px;">
      <div class="search-bar" style="flex:1;min-width:180px;max-width:280px;margin:0"><span class="search-icon">ðŸ”</span>
        <input type="text" id="log-search" placeholder="Cliente, guÃ­a, telÃ©fono..." value="${q}" oninput="renderLogistica()"></div>
      <select class="form-control" id="log-canal" style="width:130px" onchange="renderLogistica()">
        <option value="">Todos</option><option value="local" ${canal==='local'?'selected':''}>ðŸ›µ Local</option>
        <option value="inter" ${canal==='inter'?'selected':''}>ðŸ“¦ Inter</option></select>
      <input type="text" class="form-control" id="log-trans" placeholder="Transportadora..." style="width:140px" value="${trans}" oninput="renderLogistica()">
      <input type="date" class="form-control" id="log-desde" style="width:130px" value="${desde}" onchange="renderLogistica()">
      <span style="color:var(--text2);font-size:11px;align-self:center;">hasta</span>
      <input type="date" class="form-control" id="log-hasta" style="width:130px" value="${hasta}" onchange="renderLogistica()">
      <button class="btn btn-xs btn-secondary" id="log-limpiar" style="display:${(q||canal||trans||desde||hasta)?'inline-flex':'none'}"
        onclick="['log-search','log-trans'].forEach(id=>{document.getElementById(id).value=''});['log-canal','log-desde','log-hasta'].forEach(id=>{document.getElementById(id).value=''});renderLogistica()">âœ•</button>
    </div>
    <div class="card"><div class="card-title">ðŸšš GUÃAS â€” <span id="log-count">${guias.length} de ${total}</span></div>
    <div class="table-wrap"><table>
      <thead><tr><th>Fecha</th><th>Canal</th><th>Cliente</th><th>Teléfono</th><th>Ciudad</th><th>Transportadora</th><th>N° Guía</th><th>Total</th><th>Estado</th><th>Tipo Cobro</th><th></th></tr></thead>
      <tbody id="log-tbody">${rowsHtml}</tbody>
    </table></div></div>`;
}


function renderPendientes(){
  // Solo contra entrega pendiente va a cobros (contado ya estÃ¡ liquidado al vender)
  const pend=(state.ventas||[]).filter(v=>!v.archived&&v.canal!=='vitrina'&&!v.liquidado&&v.esContraEntrega!==false).sort((a,b)=>(a.fechaLiquidacion||'')>(b.fechaLiquidacion||'')?1:-1);
  const totalPend=pend.reduce((a,v)=>a+v.valor,0);
  let html=`<div class="grid-2" style="margin-bottom:20px"><div class="card" style="margin:0"><div class="stat-val" style="color:var(--red)">${pend.length}</div><div class="stat-label">Sin liquidar</div></div><div class="card" style="margin:0"><div class="stat-val" style="color:var(--yellow)">${fmt(totalPend)}</div><div class="stat-label">Total pendiente</div></div></div>`;
  if(pend.length===0)html+='<div class="empty-state"><div class="es-icon">âœ…</div><div class="es-title" style="color:var(--green)">Â¡Todo al dÃ­a!</div><div class="es-text">No tienes cobros pendientes</div></div>';
  else pend.forEach(v=>{
    const diff=daysDiff(v.fechaLiquidacion);const urgClass=diff<0?'urgent':diff<=1?'warning':'ok';const urgLabel=diff<0?`âš¡ VENCIDO hace ${Math.abs(diff)}d`:diff===0?'âš ï¸ Vence HOY':diff===1?'âš ï¸ Vence maÃ±ana':`âœ“ Vence en ${diff}d`;
    const empresaString = v.empresa ? (v.transportadora ? `${v.empresa} (${v.transportadora})` : v.empresa) : '';
    html+=`<div class="urgency-item ${urgClass}"><div style="display:flex;justify-content:space-between;margin-bottom:8px"><div><span class="badge badge-${v.canal}">${v.canal==='local'?'ðŸ›µ Local':'ðŸ“¦ Inter'}</span> <span class="badge badge-warn" style="margin-left:4px">ðŸ“¦ Contraentrega</span> <span style="font-family:Syne;font-weight:700;color:var(--accent);margin-left:6px">${fmt(v.valor)}</span></div><span style="font-size:11px;font-weight:700;color:${urgClass==='urgent'?'var(--red)':urgClass==='warning'?'var(--yellow)':'var(--green)'}">${urgLabel}</span></div><div style="font-size:12px;margin-bottom:4px"><b>${v.cliente||'Sin nombre'}</b>${v.telefono?' Â· '+v.telefono:''}</div>${v.guia?'<div style="font-size:12px;color:var(--text2);margin-bottom:4px">GuÃ­a: '+v.guia+' Â· '+empresaString+'</div>':''}<div style="font-size:12px;color:var(--text2);margin-bottom:10px">${formatDate(v.fecha)} â†’ Liq: ${formatDate(v.fechaLiquidacion)}</div><div class="btn-group"><button class="btn btn-primary btn-sm" onclick="marcarLiquidado('${v.id}')">âœ“ Liquidar (+20XP)</button></div></div>`});
  document.getElementById('pendientes-content').innerHTML=html;
}
function marcarLiquidado(id) {
  const v = state.ventas.find(v => v.id === id); 
  if (!v) return;
  
  v.liquidado = true; 
  awardXP(20); 
  
  // --- GUARDADOS ATÃ“MICOS ---
  saveRecord('ventas', v.id, v);
  saveConfig('game', state.game);
  

  const cajaAbierta = (state.cajas || []).find(c => c.estado === 'abierta');
  if (cajaAbierta) {
    cajaAbierta.saldo += v.valor;
    const mov = { id: uid(), cajaId: cajaAbierta.id, tipo: 'ingreso', valor: v.valor, concepto: 'LiquidaciÃ³n ' + (v.guia || 'Venta'), fecha: today(), metodo: 'transferencia' };
    state.tes_movimientos.push(mov);
    saveRecord('tes_movimientos', mov.id, mov);
    saveRecord('cajas', cajaAbierta.id, cajaAbierta);
  }
  
  renderPendientes();
  updateNavBadges();
  notify('success', 'ðŸ’µ', 'Â¡Liquidado!', fmt(v.valor) + ' Â· +20XP', { duration: 3000 });
  screenFlash('green');
}



// ===================================================================
// ===== IMPRESIÓN RELACIÓN DE DESPACHO =====
// ===================================================================
async function imprimirDespacho(ventaId) {
  const v = (state.ventas||[]).find(x => x.id === ventaId);
  if (!v) return notify('error','❌','Error','Despacho no encontrado',{duration:2500});

  // Buscar la factura asociada para obtener los items
  const factura = (state.facturas||[]).find(f => f.id === ventaId || f.numero === v.desc);
  const items = factura?.items || [];

  const emp = state.empresa || {};
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const MARGIN = 18, PAGEW = 210;
  let y = MARGIN;

  // ── Encabezado empresa ────────────────────────────────
  doc.setFillColor(26,26,26);
  doc.rect(0, 0, PAGEW, 28, 'F');
  doc.setFont('helvetica','bold');
  doc.setFontSize(16);
  doc.setTextColor(255,255,255);
  doc.text((emp.nombre || 'HERA SWIMWEAR').toUpperCase(), MARGIN, 12);
  doc.setFontSize(8);
  doc.setFont('helvetica','normal');
  doc.setTextColor(200,200,200);
  doc.text('NIT: ' + (emp.nit||'—') + '   Tel: ' + (emp.telefono||'—') + '   ' + (emp.ciudad||'') + ' / ' + (emp.departamento||''), MARGIN, 18);
  doc.text(emp.direccion||'', MARGIN, 23);
  y = 36;

  // ── Título documento ──────────────────────────────────
  doc.setFont('helvetica','bold');
  doc.setFontSize(13);
  doc.setTextColor(26,26,26);
  doc.text('RELACIÓN DE DESPACHO', PAGEW/2, y, {align:'center'});
  y += 7;
  doc.setDrawColor(200,200,200);
  doc.setLineWidth(0.4);
  doc.line(MARGIN, y, PAGEW-MARGIN, y);
  y += 6;

  // ── Datos del despacho (2 columnas) ───────────────────
  doc.setFontSize(9);
  doc.setFont('helvetica','bold');
  doc.setTextColor(26,26,26);

  const col1 = MARGIN, col2 = 115;
  const field = (label, value, cx, cy) => {
    doc.setFont('helvetica','bold'); doc.setTextColor(100,100,100);
    doc.text(label + ':', cx, cy);
    doc.setFont('helvetica','normal'); doc.setTextColor(26,26,26);
    doc.text(String(value||'—'), cx + 28, cy);
  };

  field('Fecha',          formatDate(v.fecha),              col1, y);
  field('Referencia',     v.desc || '—',                    col2, y); y += 6;
  field('Cliente',        v.cliente || 'CLIENTE MOSTRADOR', col1, y);
  field('Teléfono',       v.telefono || '—',                col2, y); y += 6;
  field('Ciudad',         v.ciudad || '—',                  col1, y);
  field('Canal',          v.canal === 'local' ? '🛵 Local' : '📦 Inter', col2, y); y += 6;
  field('Transportadora', v.transportadora || v.empresa || '—', col1, y);
  field('N° Guía',        v.guia || '—',                    col2, y); y += 6;
  field('Tipo Cobro',     v.esContraEntrega ? 'Contraentrega' : 'Contado', col1, y);
  field('Estado',         v.liquidado ? 'Liquidado' : 'Pendiente',         col2, y); y += 8;

  doc.setDrawColor(200,200,200);
  doc.line(MARGIN, y, PAGEW-MARGIN, y);
  y += 6;

  // ── Tabla de productos ────────────────────────────────
  doc.setFont('helvetica','bold');
  doc.setFontSize(9);
  doc.setTextColor(255,255,255);
  doc.setFillColor(26,26,26);
  doc.rect(MARGIN, y-4, PAGEW-(MARGIN*2), 7, 'F');
  doc.text('PRODUCTO',        MARGIN+2,  y);
  doc.text('TALLA',           MARGIN+78, y);
  doc.text('CANT.',           MARGIN+102, y);
  doc.text('P. UNIT.',        MARGIN+118, y);
  doc.text('SUBTOTAL',        MARGIN+143, y);
  y += 6;

  doc.setFont('helvetica','normal');
  doc.setTextColor(26,26,26);

  let subtotal = 0;
  if (items.length > 0) {
    items.forEach((item, i) => {
      if (y > 260) { doc.addPage(); y = MARGIN; }
      const bg = i % 2 === 0 ? [248,248,248] : [255,255,255];
      doc.setFillColor(...bg);
      doc.rect(MARGIN, y-3.5, PAGEW-(MARGIN*2), 6.5, 'F');
      const sub = (item.precio||0) * (item.qty||1);
      subtotal += sub;
      doc.setFontSize(8.5);
      doc.text(doc.splitTextToSize(item.nombre||'—', 72)[0], MARGIN+2,  y);
      doc.text(String(item.talla||'—'),                       MARGIN+78, y);
      doc.text(String(item.qty||1),                           MARGIN+104, y);
      doc.text(fmt(item.precio||0),                           MARGIN+114, y, {align:'right'});
      doc.text(fmt(sub),                                      MARGIN+152, y, {align:'right'});
      y += 6.5;
    });
  } else {
    // Sin items en BD — mostrar solo el total de la venta
    const bg = [248,248,248];
    doc.setFillColor(...bg);
    doc.rect(MARGIN, y-3.5, PAGEW-(MARGIN*2), 6.5, 'F');
    doc.setFontSize(8.5);
    doc.text('Venta POS — detalle no disponible', MARGIN+2, y);
    doc.text(fmt(v.valor||0), MARGIN+152, y, {align:'right'});
    subtotal = v.valor||0;
    y += 6.5;
  }

  y += 3;
  doc.setDrawColor(200,200,200);
  doc.line(MARGIN, y, PAGEW-MARGIN, y);
  y += 6;

  // ── Totales ───────────────────────────────────────────
  const totRight = PAGEW - MARGIN;
  const totLabel = PAGEW - MARGIN - 60;

  const totRow = (label, value, bold=false, color=[26,26,26]) => {
    doc.setFont('helvetica', bold?'bold':'normal');
    doc.setFontSize(9);
    doc.setTextColor(...color);
    doc.text(label, totLabel, y);
    doc.text(value, totRight, y, {align:'right'});
    y += 5.5;
  };

  if (factura) {
    if (factura.subtotal) totRow('Subtotal:', fmt(factura.subtotal));
    if (factura.iva)      totRow('IVA (19%):', fmt(factura.iva));
    if (factura.flete)    totRow('Flete:', fmt(factura.flete));
  }
  totRow('TOTAL:', fmt(v.valor||0), true, [120,92,56]);

  y += 8;

  // ── Observaciones / firma ─────────────────────────────
  doc.setDrawColor(200,200,200);
  doc.line(MARGIN, y, PAGEW-MARGIN, y);
  y += 8;
  doc.setFont('helvetica','normal');
  doc.setFontSize(8);
  doc.setTextColor(120,120,120);
  doc.text('Firma recibido: ____________________________', MARGIN, y);
  doc.text('Fecha entrega: ____________________________', PAGEW/2+10, y);
  y += 10;
  doc.text(`Generado: ${today()} — ${emp.nombre||'Hera Swimwear'}`, MARGIN, y);

  doc.save(`Despacho_${v.guia||v.desc||v.id.slice(0,8)}_${v.cliente||'cliente'}.pdf`.replace(/\s+/g,'-'));
}
