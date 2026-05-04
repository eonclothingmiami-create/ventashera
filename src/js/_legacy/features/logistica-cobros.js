// ===================================================================
// ===== LOGÍSTICA / GUÍAS =====
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
    <td style="text-align:center"><input type="checkbox" class="log-chk" data-id="${v.id}" onchange="actualizarBtnDespacho()" style="width:15px;height:15px;cursor:pointer;accent-color:var(--accent)"></td>
    <td>${formatDate(v.fecha)}</td>
    <td><span class="badge ${v.canal==='local'?'badge-warn':'badge-inter'}">${v.canal==='local'?'🛵':'📦'} ${v.canal}</span></td>
    <td style="font-weight:700">${v.cliente||'—'}</td>
    <td>${v.telefono||'—'}</td>
    <td>${v.ciudad||'—'}</td>
    <td>${v.transportadora||v.empresa||'—'}</td>
    <td style="color:var(--accent);font-weight:700">${v.guia||'—'}</td>
    <td style="font-weight:700">${fmt(v.valor||0)}</td>
    <td><span class="badge ${v.liquidado?'badge-ok':'badge-pend'}">${v.liquidado?'✓ Liq':'⏳ Pend'}</span></td>
    <td><span class="badge ${v.esContraEntrega?'badge-warn':'badge-ok'}">${v.esContraEntrega?'📦 C/E':'💵 Ctdo'}</span></td>
  </tr>`).join('')||'<tr><td colspan="11" style="text-align:center;color:var(--text2);padding:24px">Sin guías</td></tr>';

  // Si ya existe la tabla, actualizar solo filas + contador
  if(document.getElementById('log-tbody')){
    document.getElementById('log-tbody').innerHTML = rowsHtml;
    const cnt=document.getElementById('log-count');
    if(cnt) cnt.textContent=`${guias.length} de ${total}`;
    const btnL=document.getElementById('log-limpiar');
    if(btnL) btnL.style.display=(q||canal||trans||desde||hasta)?'inline-flex':'none';
    actualizarBtnDespacho();
    return;
  }

  el.innerHTML=`
    <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;margin-bottom:16px;">
      <div class="search-bar" style="flex:1;min-width:180px;max-width:280px;margin:0"><span class="search-icon">🔍</span>
        <input type="text" id="log-search" placeholder="Cliente, guía, teléfono..." value="${q}" oninput="renderLogistica()"></div>
      <select class="form-control" id="log-canal" style="width:130px" onchange="renderLogistica()">
        <option value="">Todos</option><option value="local" ${canal==='local'?'selected':''}>🛵 Local</option>
        <option value="inter" ${canal==='inter'?'selected':''}>📦 Inter</option></select>
      <input type="text" class="form-control" id="log-trans" placeholder="Transportadora..." style="width:140px" value="${trans}" oninput="renderLogistica()">
      <input type="date" class="form-control" id="log-desde" style="width:130px" value="${desde}" onchange="renderLogistica()">
      <span style="color:var(--text2);font-size:11px;align-self:center;">hasta</span>
      <input type="date" class="form-control" id="log-hasta" style="width:130px" value="${hasta}" onchange="renderLogistica()">
      <button class="btn btn-xs btn-secondary" id="log-limpiar" style="display:${(q||canal||trans||desde||hasta)?'inline-flex':'none'}"
        onclick="['log-search','log-trans'].forEach(id=>{document.getElementById(id).value=''});['log-canal','log-desde','log-hasta'].forEach(id=>{document.getElementById(id).value=''});renderLogistica()">✕</button>
    </div>
    <div class="card">
      <div class="card-title" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
        <span>🚚 GUÍAS — <span id="log-count">${guias.length} de ${total}</span></span>
        <div style="display:flex;gap:8px;align-items:center;">
          <label style="font-size:11px;color:var(--text2);cursor:pointer;display:flex;align-items:center;gap:5px;">
            <input type="checkbox" id="log-chk-all" onchange="toggleSeleccionarTodas(this)" style="width:14px;height:14px;accent-color:var(--accent)"> Todas
          </label>
          <button class="btn btn-xs btn-primary" id="btn-imprimir-despachos" onclick="imprimirDespachosSeleccionados()" style="display:none">🖨️ Imprimir seleccionadas</button>
        </div>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th style="width:32px"></th><th>Fecha</th><th>Canal</th><th>Cliente</th><th>Teléfono</th><th>Ciudad</th><th>Transportadora</th><th>N° Guía</th><th>Total</th><th>Estado</th><th>Tipo Cobro</th></tr></thead>
        <tbody id="log-tbody">${rowsHtml}</tbody>
      </table></div>
    </div>`;
}

function toggleSeleccionarTodas(chk){
  document.querySelectorAll('.log-chk').forEach(c=>c.checked=chk.checked);
  actualizarBtnDespacho();
}

function actualizarBtnDespacho(){
  const sel = document.querySelectorAll('.log-chk:checked').length;
  const btn = document.getElementById('btn-imprimir-despachos');
  if(btn){
    btn.style.display = sel > 0 ? 'inline-flex' : 'none';
    btn.textContent = sel > 1 ? `🖨️ Imprimir ${sel} seleccionadas` : '🖨️ Imprimir seleccionada';
  }
  const chkAll = document.getElementById('log-chk-all');
  if(chkAll){
    const total = document.querySelectorAll('.log-chk').length;
    chkAll.indeterminate = sel > 0 && sel < total;
    chkAll.checked = sel === total && total > 0;
  }
}

async function imprimirDespachosSeleccionados(){
  const ids = [...document.querySelectorAll('.log-chk:checked')].map(c=>c.dataset.id);
  if(!ids.length) return;
  for(const id of ids){
    await imprimirDespacho(id);
  }
}


// ===================================================================
// ===== COBROS / PENDIENTES =====
// ===================================================================

function renderPendientes(){
  // Misma lógica que core.js: todas las ventas local/inter no liquidadas (recordatorio cobro)
  const pend=(state.ventas||[]).filter(v=>!v.archived&&v.canal!=='vitrina'&&!v.liquidado).sort((a,b)=>(a.fechaLiquidacion||'')>(b.fechaLiquidacion||'')?1:-1);
  const totalPend=pend.reduce((a,v)=>a+v.valor,0);
  let html=`<div class="card" style="margin-bottom:16px;padding:12px;font-size:12px;color:var(--text2)">💡 <b>Cobros:</b> el dinero ya puede estar en caja por la venta POS; <b>liquidar</b> aquí cierra el recordatorio y limpia alertas para el equipo.</div>`;
  html+=`<div class="grid-2" style="margin-bottom:20px"><div class="card" style="margin:0"><div class="stat-val" style="color:var(--red)">${pend.length}</div><div class="stat-label">Pendientes de liquidar</div></div><div class="card" style="margin:0"><div class="stat-val" style="color:var(--yellow)">${fmt(totalPend)}</div><div class="stat-label">Total en lista</div></div></div>`;
  if(pend.length===0)html+='<div class="empty-state"><div class="es-icon">✅</div><div class="es-title" style="color:var(--green)">¡Todo al día!</div><div class="es-text">No hay ventas pendientes de liquidación</div></div>';
  else pend.forEach(v=>{
    const diff=daysDiff(v.fechaLiquidacion);const urgClass=diff<0?'urgent':diff<=1?'warning':'ok';const urgLabel=diff<0?`⚡ VENCIDO hace ${Math.abs(diff)}d`:diff===0?'⚠️ Vence HOY':diff===1?'⚠️ Vence mañana':`✓ Vence en ${diff}d`;
    const empresaString = v.empresa ? (v.transportadora ? `${v.empresa} (${v.transportadora})` : v.empresa) : '';
    const refDoc = v.desc || '—';
    const tipoCobro = v.esContraEntrega ? '📦 Contraentrega' : '💳 Cobro / cierre';
    html+=`<div class="urgency-item ${urgClass}"><div style="display:flex;justify-content:space-between;margin-bottom:8px"><div><span class="badge badge-${v.canal}">${v.canal==='local'?'🛵 Local':'📦 Inter'}</span> <span class="badge badge-warn" style="margin-left:4px">${tipoCobro}</span> <span style="font-family:Syne;font-weight:700;color:var(--accent);margin-left:6px">${fmt(v.valor)}</span></div><span style="font-size:11px;font-weight:700;color:${urgClass==='urgent'?'var(--red)':urgClass==='warning'?'var(--yellow)':'var(--green)'}">${urgLabel}</span></div><div style="font-size:12px;margin-bottom:4px"><b>${v.cliente||'Sin nombre'}</b>${v.telefono?' · '+v.telefono:''}</div><div style="font-size:11px;color:var(--accent);margin-bottom:4px">Ref: ${refDoc}</div>${v.guia?'<div style="font-size:12px;color:var(--text2);margin-bottom:4px">Guía: '+v.guia+' · '+empresaString+'</div>':''}<div style="font-size:12px;color:var(--text2);margin-bottom:10px">${formatDate(v.fecha)} → Recordatorio límite: ${formatDate(v.fechaLiquidacion)}</div><div class="btn-group"><button class="btn btn-primary btn-sm" onclick="marcarLiquidado('${v.id}')">✓ Marcar liquidado (+20XP)</button></div></div>`;
  });
  document.getElementById('pendientes-content').innerHTML=html;
}

function marcarLiquidado(id) {
  const v = state.ventas.find(v => v.id === id);
  if (!v) return;
  v.liquidado = true;
  awardXP(20);
  // Ingreso a caja ya se registró en el POS; solo cerrar recordatorio
  saveRecord('ventas', v.id, v);
  saveConfig('game', state.game);
  renderPendientes();
  updateNavBadges();
  notify('success', '✅', 'Liquidación registrada', `${v.desc || 'Venta'} marcada como liquidada · +20XP`, { duration: 3000 });
  screenFlash('green');
}


// ===================================================================
// ===== IMPRESIÓN RELACIÓN DE DESPACHO =====
// ===================================================================
async function imprimirDespacho(ventaId) {
  const v = (state.ventas||[]).find(x => x.id === ventaId);
  if (!v) return notify('error','❌','Error','Despacho no encontrado',{duration:2500});

  const factura = (state.facturas||[]).find(f => f.id === ventaId || f.numero === v.desc);
  const items = factura?.items || [];

  const emp = state.empresa || {};
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const MARGIN = 18, PAGEW = 210;
  let y = MARGIN;

  // Encabezado empresa
  doc.setFillColor(26,26,26);
  doc.rect(0, 0, PAGEW, 28, 'F');
  doc.setFont('helvetica','bold'); doc.setFontSize(16); doc.setTextColor(255,255,255);
  doc.text((emp.nombre || 'HERA SWIMWEAR').toUpperCase(), MARGIN, 12);
  doc.setFontSize(8); doc.setFont('helvetica','normal'); doc.setTextColor(200,200,200);
  doc.text('NIT: ' + (emp.nit||'—') + '   Tel: ' + (emp.telefono||'—') + '   ' + (emp.ciudad||'') + ' / ' + (emp.departamento||''), MARGIN, 18);
  doc.text(emp.direccion||'', MARGIN, 23);
  y = 36;

  // Título
  doc.setFont('helvetica','bold'); doc.setFontSize(13); doc.setTextColor(26,26,26);
  doc.text('RELACIÓN DE DESPACHO', PAGEW/2, y, {align:'center'});
  y += 7;
  doc.setDrawColor(200,200,200); doc.setLineWidth(0.4);
  doc.line(MARGIN, y, PAGEW-MARGIN, y);
  y += 6;

  // Datos despacho
  const col1 = MARGIN, col2 = 115;
  const field = (label, value, cx, cy) => {
    doc.setFont('helvetica','bold'); doc.setFontSize(9); doc.setTextColor(100,100,100);
    doc.text(label + ':', cx, cy);
    doc.setFont('helvetica','normal'); doc.setTextColor(26,26,26);
    doc.text(String(value||'—'), cx + 28, cy);
  };
  field('Fecha',          formatDate(v.fecha),                         col1, y);
  field('Referencia',     v.desc || '—',                               col2, y); y += 6;
  field('Cliente',        v.cliente || 'CLIENTE MOSTRADOR',            col1, y);
  field('Teléfono',       v.telefono || '—',                           col2, y); y += 6;
  field('Ciudad',         v.ciudad || '—',                             col1, y);
  field('Canal',          v.canal === 'local' ? '🛵 Local' : '📦 Inter', col2, y); y += 6;
  field('Transportadora', v.transportadora || v.empresa || '—',        col1, y);
  field('N° Guía',        v.guia || '—',                               col2, y); y += 6;
  field('Tipo Cobro',     v.esContraEntrega ? 'Contraentrega' : 'Contado', col1, y);
  field('Estado',         v.liquidado ? 'Liquidado' : 'Pendiente',     col2, y); y += 8;

  doc.setDrawColor(200,200,200);
  doc.line(MARGIN, y, PAGEW-MARGIN, y);
  y += 6;

  // Tabla productos
  doc.setFont('helvetica','bold'); doc.setFontSize(9);
  doc.setTextColor(255,255,255); doc.setFillColor(26,26,26);
  doc.rect(MARGIN, y-4, PAGEW-(MARGIN*2), 7, 'F');
  doc.text('PRODUCTO',  MARGIN+2,   y);
  doc.text('TALLA',     MARGIN+78,  y);
  doc.text('CANT.',     MARGIN+102, y);
  doc.text('P. UNIT.',  MARGIN+118, y);
  doc.text('SUBTOTAL',  MARGIN+143, y);
  y += 6;

  doc.setFont('helvetica','normal'); doc.setTextColor(26,26,26);
  if (items.length > 0) {
    items.forEach((item, i) => {
      if (y > 260) { doc.addPage(); y = MARGIN; }
      doc.setFillColor(...(i%2===0?[248,248,248]:[255,255,255]));
      doc.rect(MARGIN, y-3.5, PAGEW-(MARGIN*2), 6.5, 'F');
      const sub = (item.precio||0) * (item.qty||1);
      doc.setFontSize(8.5);
      doc.text(doc.splitTextToSize(item.nombre||'—', 72)[0], MARGIN+2,   y);
      doc.text(String(item.talla||'—'),                       MARGIN+78,  y);
      doc.text(String(item.qty||1),                           MARGIN+104, y);
      doc.text(fmt(item.precio||0),                           MARGIN+114, y, {align:'right'});
      doc.text(fmt(sub),                                      MARGIN+152, y, {align:'right'});
      y += 6.5;
    });
  } else {
    doc.setFillColor(248,248,248);
    doc.rect(MARGIN, y-3.5, PAGEW-(MARGIN*2), 6.5, 'F');
    doc.setFontSize(8.5);
    doc.text('Venta POS — detalle no disponible', MARGIN+2, y);
    doc.text(fmt(v.valor||0), MARGIN+152, y, {align:'right'});
    y += 6.5;
  }

  y += 3;
  doc.setDrawColor(200,200,200);
  doc.line(MARGIN, y, PAGEW-MARGIN, y);
  y += 6;

  // Totales
  const totRight = PAGEW - MARGIN;
  const totLabel = PAGEW - MARGIN - 60;
  const totRow = (label, value, bold=false, color=[26,26,26]) => {
    doc.setFont('helvetica', bold?'bold':'normal'); doc.setFontSize(9); doc.setTextColor(...color);
    doc.text(label, totLabel, y); doc.text(value, totRight, y, {align:'right'}); y += 5.5;
  };
  if (factura) {
    if (factura.subtotal) totRow('Subtotal:', fmt(factura.subtotal));
    if (factura.iva)      totRow('IVA (19%):', fmt(factura.iva));
    if (factura.flete)    totRow('Flete:', fmt(factura.flete));
  }
  totRow('TOTAL:', fmt(v.valor||0), true, [120,92,56]);
  y += 8;

  // Firma
  doc.setDrawColor(200,200,200);
  doc.line(MARGIN, y, PAGEW-MARGIN, y);
  y += 8;
  doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(120,120,120);
  doc.text('Firma recibido: ____________________________', MARGIN, y);
  doc.text('Fecha entrega: ____________________________', PAGEW/2+10, y);
  y += 10;
  doc.text(`Generado: ${today()} — ${emp.nombre||'Hera Swimwear'}`, MARGIN, y);

  doc.save(`Despacho_${v.guia||v.desc||v.id.slice(0,8)}_${(v.cliente||'cliente').replace(/\s+/g,'-')}.pdf`);
}
