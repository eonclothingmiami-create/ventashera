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
    <td><button class="btn btn-xs btn-secondary" onclick="printRelacionDespacho('${v.id}')">PDF</button></td>
  </tr>`).join('')||'<tr><td colspan="11" style="text-align:center;color:var(--text2);padding:24px">Sin guÃ­as</td></tr>';

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
      <thead><tr><th>Fecha</th><th>Canal</th><th>Cliente</th><th>TelÃ©fono</th><th>Ciudad</th><th>Transportadora</th><th>NÂ° GuÃ­a</th><th>Total</th><th>Estado</th><th>Tipo Cobro</th><th>AcciÃ³n</th></tr></thead>
      <tbody id="log-tbody">${rowsHtml}</tbody>
    </table></div></div>`;
}

function printRelacionDespacho(id){
  const venta=(state.ventas||[]).find(v=>v.id===id);
  if(!venta){notify('warning','âš ï¸','GuÃ­a no encontrada','No se encontrÃ³ la venta asociada.',{duration:3000});return;}

  const emp=state.empresa||{};
  const esc=(v)=>String(v??'â€”').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const canalTxt=venta.canal==='local'?'Local':'Intermunicipal';
  const tipoCobro=venta.esContraEntrega?'Contraentrega':'Contado';
  const estadoCobro=venta.liquidado?'Liquidado':'Pendiente';
  const transportadora=venta.transportadora||venta.empresa||'â€”';

  const html=`<!doctype html><html lang="es"><head><meta charset="utf-8">
  <title>Relacion de despacho ${esc(venta.guia||venta.id||'')}</title>
  <style>
    :root{color-scheme:light;}
    *{box-sizing:border-box}
    body{font-family:Arial,sans-serif;margin:20px;color:#111}
    .top{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:14px}
    .title{font-size:22px;font-weight:800;letter-spacing:.4px}
    .sub{font-size:12px;color:#4b5563;margin-top:4px}
    .badge{display:inline-block;border:1px solid #d1d5db;border-radius:999px;padding:4px 10px;font-size:12px;font-weight:700}
    .card{border:1px solid #e5e7eb;border-radius:10px;padding:14px;margin-bottom:12px}
    .grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 16px}
    .label{font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.4px}
    .value{font-size:15px;font-weight:700}
    .note{margin-top:16px;font-size:12px;color:#374151}
    .actions{margin-bottom:10px}
    .actions button{padding:8px 14px;border:0;border-radius:8px;background:#111;color:#fff;font-weight:700;cursor:pointer}
    @media (max-width:700px){.grid{grid-template-columns:1fr}}
    @media print{.actions{display:none}body{margin:10mm}.card{break-inside:avoid}}
  </style></head><body>
    <div class="actions"><button onclick="window.print()">Imprimir / Guardar PDF</button></div>
    <div class="top">
      <div>
        <div class="title">Relacion de despacho</div>
        <div class="sub">${esc(emp.nombre||'VentasHera ERP')} Â· ${esc(formatDate(venta.fecha||today()))}</div>
      </div>
      <div class="badge">Guia: ${esc(venta.guia||'â€”')}</div>
    </div>
    <div class="card">
      <div class="grid">
        <div><div class="label">Cliente</div><div class="value">${esc(venta.cliente||'â€”')}</div></div>
        <div><div class="label">Telefono</div><div class="value">${esc(venta.telefono||'â€”')}</div></div>
        <div><div class="label">Ciudad</div><div class="value">${esc(venta.ciudad||'â€”')}</div></div>
        <div><div class="label">Transportadora</div><div class="value">${esc(transportadora)}</div></div>
        <div><div class="label">Canal</div><div class="value">${esc(canalTxt)}</div></div>
        <div><div class="label">Tipo cobro</div><div class="value">${esc(tipoCobro)}</div></div>
        <div><div class="label">Estado cobro</div><div class="value">${esc(estadoCobro)}</div></div>
        <div><div class="label">Valor despacho</div><div class="value">${esc(fmt(venta.valor||0))}</div></div>
      </div>
      <div class="note">Documento generado desde Guias Generadas para soporte logistico de despacho.</div>
    </div>
  </body></html>`;

  const w=window.open('','_blank','width=900,height=700,scrollbars=yes');
  if(!w){notify('warning','âš ï¸','Popup bloqueado','Permite popups para imprimir el PDF.',{duration:4000});return;}
  w.document.write(html);
  w.document.close();
  setTimeout(()=>{w.focus();w.print();},300);
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

