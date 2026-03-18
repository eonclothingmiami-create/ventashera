// ===================================================================
// ===== SEPARADOS (SHOWROOM) =====
// ===================================================================

function renderSeparados(){
  const desde = document.getElementById('sep-desde')?.value||'';
  const hasta = document.getElementById('sep-hasta')?.value||'';
  const q = (document.getElementById('sep-search')?.value||'').toLowerCase();

  let separados = (state.ventas||[]).filter(v => !v.archived && v.esSeparado);
  if(desde) separados = separados.filter(v => v.fecha >= desde);
  if(hasta) separados = separados.filter(v => v.fecha <= hasta);
  if(q) separados = separados.filter(v => (v.cliente||'').toLowerCase().includes(q) || (v.telefono||'').includes(q) || (v.desc||'').toLowerCase().includes(q));
  separados = separados.reverse();

  const pendientes = separados.filter(v => v.estadoEntrega !== 'Entregado');
  const entregados = separados.filter(v => v.estadoEntrega === 'Entregado');

  const rowsHtml = separados.map(v => `<tr style="${v.estadoEntrega==='Entregado'?'opacity:0.5':''}">
    <td>${formatDate(v.fecha)}</td>
    <td style="font-weight:700;color:var(--text2)">${v.desc||'â€”'}</td>
    <td style="font-weight:700">${v.cliente||'MOSTRADOR'}</td>
    <td>${v.telefono||'â€”'}</td>
    <td style="font-size:11px;color:var(--text2)">${(v.items||[]).map(i=>(i.nombre||i.name||'')+(i.talla?' T:'+i.talla:'')).join(', ')||'â€”'}</td>
    <td style="color:var(--accent);font-weight:700">${fmt(v.valor)}</td>
    <td><span class="badge ${v.estadoEntrega==='Entregado'?'badge-ok':'badge-warn'}">${v.estadoEntrega||'Pendiente'}</span></td>
    <td>${v.estadoEntrega!=='Entregado'
      ?`<button class="btn btn-xs btn-primary" onclick="entregarSeparado('${v.id}')">âœ“ Entregar</button>`
      :`<button class="btn btn-xs btn-danger" onclick="eliminarSeparado('${v.id}')">ðŸ—‘</button>`}
    </td>
  </tr>`).join('')||'<tr><td colspan="8" style="text-align:center;color:var(--text2);padding:24px">Sin separados</td></tr>';

  if(document.getElementById('sep-tbody')) {
    document.getElementById('sep-tbody').innerHTML = rowsHtml;
    const p = document.getElementById('sep-pend'); if(p) p.textContent = pendientes.length;
    const e = document.getElementById('sep-entr'); if(e) e.textContent = entregados.length;
    const btnL = document.getElementById('sep-limpiar');
    if(btnL) btnL.style.display=(q||desde||hasta)?'inline-flex':'none';
    return;
  }

  document.getElementById('separados-content').innerHTML = `
    <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;margin-bottom:16px;">
      <div class="search-bar" style="flex:1;min-width:180px;max-width:280px;margin:0">
        <span class="search-icon">ðŸ”</span>
        <input type="text" id="sep-search" placeholder="Cliente, telÃ©fono..." value="${q}" oninput="renderSeparados()">
      </div>
      <input type="date" class="form-control" id="sep-desde" style="width:140px" value="${desde}" onchange="renderSeparados()">
      <span style="color:var(--text2);font-size:11px;align-self:center;">hasta</span>
      <input type="date" class="form-control" id="sep-hasta" style="width:140px" value="${hasta}" onchange="renderSeparados()">
      <button class="btn btn-xs btn-secondary" id="sep-limpiar" style="display:${(q||desde||hasta)?'inline-flex':'none'}"
        onclick="document.getElementById('sep-search').value='';document.getElementById('sep-desde').value='';document.getElementById('sep-hasta').value='';renderSeparados()">âœ• Limpiar</button>
    </div>
    <div class="grid-2" style="margin-bottom:16px">
      <div class="card" style="margin:0;text-align:center">
        <div style="font-family:Syne;font-size:28px;font-weight:800;color:var(--yellow)" id="sep-pend">${pendientes.length}</div>
        <div style="font-size:11px;color:var(--text2)">â³ Pendientes de entrega</div>
      </div>
      <div class="card" style="margin:0;text-align:center">
        <div style="font-family:Syne;font-size:28px;font-weight:800;color:var(--green)" id="sep-entr">${entregados.length}</div>
        <div style="font-size:11px;color:var(--text2)">âœ… Entregados hoy</div>
      </div>
    </div>
    <div class="card">
      <div class="card-title">ðŸ›ï¸ SEPARADOS (${separados.length})</div>
      <div class="table-wrap"><table>
        <thead><tr><th>Fecha</th><th>Ref</th><th>Cliente</th><th>TelÃ©fono</th><th>ArtÃ­culos</th><th>Total</th><th>Estado</th><th>AcciÃ³n</th></tr></thead>
        <tbody id="sep-tbody">${rowsHtml}</tbody>
      </table></div>
    </div>`;
}


function entregarSeparado(id) {
  if(!confirm('Â¿El cliente ya recogiÃ³? Se marcarÃ¡ como entregado.')) return;
  const v = state.ventas.find(x => x.id === id);
  if(!v) return;
  v.estadoEntrega = 'Entregado';
  saveRecord('ventas', v.id, v);
  renderSeparados();
  notify('success','ðŸ“¦','Â¡Entregado!',`${v.cliente||'Cliente'} recogiÃ³ su pedido.`,{duration:3000});
}

function eliminarSeparado(id) {
  if(!confirm('Â¿Eliminar este separado del registro?')) return;
  state.ventas = state.ventas.filter(v => v.id !== id);
  deleteRecord('ventas', id);
  renderSeparados();
  notify('success','ðŸ—‘ï¸','Eliminado','Separado removido del registro.',{duration:2000});
}

