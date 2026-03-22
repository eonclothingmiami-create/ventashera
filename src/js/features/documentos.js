// ===================================================================
// ===== GENERIC DOCUMENT RENDERER (Cotizaciones, Órdenes, etc) =====
// ===================================================================
function renderDocumentList(pageId,title,collection,tipo,fields){
  const el=document.getElementById(pageId+'-content');if(!el)return;

  // Leer filtros actuales
  const q=(document.getElementById(pageId+'-search')?.value||'').toLowerCase();
  const desdeEl=document.getElementById(pageId+'-desde');
  const hastaEl=document.getElementById(pageId+'-hasta');
  const desde=desdeEl?.value||'';
  const hasta=hastaEl?.value||'';

  let items=[...(state[collection]||[])].reverse();

  // Aplicar filtros
  if(q) items=items.filter(d=>(d.numero||'').toLowerCase().includes(q)||(d.cliente||'').toLowerCase().includes(q));
  if(desde) items=items.filter(d=>d.fecha&&d.fecha>=desde);
  if(hasta) items=items.filter(d=>d.fecha&&d.fecha<=hasta);

  const total=[...(state[collection]||[])].length;

  const tbodyId = pageId+'-doc-tbody';
  const contId = pageId+'-doc-count';
  const rowsHtml = items.map(d=>`<tr>
    <td style="font-weight:700">${d.numero||'—'}</td>
    <td>${formatDate(d.fecha)}</td>
    <td>${d.cliente||'—'}</td>
    <td style="color:var(--accent);font-weight:700">${fmt(d.total||0)}</td>
    <td><span class="badge badge-${d.estado==='pagada'||d.estado==='aprobada'?'ok':d.estado==='anulada'?'pend':'warn'}">${d.estado||'borrador'}</span></td>
    <td><div class="btn-group">
      <button class="btn btn-xs btn-secondary" onclick="viewDoc('${collection}','${d.id}')">👁</button>
      <button class="btn btn-xs btn-secondary" onclick="printDoc('${collection}','${d.id}')">🖨</button>
      <button class="btn btn-xs btn-danger" onclick="deleteDoc('${collection}','${d.id}')">✕</button>
    </div></td>
  </tr>`).join('')||`<tr><td colspan="6" style="text-align:center;color:var(--text2);padding:24px">Sin registros</td></tr>`;

  // Si ya existe la tabla, solo actualizar filas (mantiene foco del input)
  if(document.getElementById(tbodyId)) {
    document.getElementById(tbodyId).innerHTML = rowsHtml;
    const cnt = document.getElementById(contId);
    if(cnt) cnt.textContent = `${items.length} de ${total}`;
    const btnL = document.getElementById(pageId+'-doc-limpiar');
    if(btnL) btnL.style.display = (q||desde||hasta)?'inline-flex':'none';
    return;
  }

  el.innerHTML=`
    <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;margin-bottom:16px;">
      <button class="btn btn-primary" onclick="openDocModal('${collection}','${tipo}')">+ ${title}</button>
      <div class="search-bar" style="flex:1;min-width:180px;max-width:300px;margin:0">
        <span class="search-icon">🔍</span>
        <input type="text" id="${pageId}-search" placeholder="Buscar # o cliente..." value="${q}"
          oninput="renderDocumentList('${pageId}','${title}','${collection}','${tipo}')">
      </div>
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
        <input type="date" id="${pageId}-desde" class="form-control" style="width:140px;padding:8px" value="${desde}"
          onchange="renderDocumentList('${pageId}','${title}','${collection}','${tipo}')" title="Desde">
        <span style="color:var(--text2);font-size:11px;">hasta</span>
        <input type="date" id="${pageId}-hasta" class="form-control" style="width:140px;padding:8px" value="${hasta}"
          onchange="renderDocumentList('${pageId}','${title}','${collection}','${tipo}')" title="Hasta">
        <button class="btn btn-xs btn-secondary" id="${pageId}-doc-limpiar" style="display:${(q||desde||hasta)?'inline-flex':'none'}"
          onclick="document.getElementById('${pageId}-search').value='';document.getElementById('${pageId}-desde').value='';document.getElementById('${pageId}-hasta').value='';renderDocumentList('${pageId}','${title}','${collection}','${tipo}')">✕ Limpiar</button>
      </div>
    </div>
    <div class="card">
      <div class="card-title">${title.toUpperCase()} — <span id="${contId}">${items.length} de ${total}</span></div>
      <div class="table-wrap"><table>
        <thead><tr><th>#</th><th>Fecha</th><th>Cliente</th><th>Total</th><th>Estado</th><th></th></tr></thead>
        <tbody id="${tbodyId}">${rowsHtml}</tbody>
      </table></div>
    </div>`;
}

function openDocModal(collection,tipo,existingId){
  const tipos={cotizacion:'Cotización',orden:'Orden de Venta',factura:'Factura',nc:'Nota Crédito',nd:'Nota Débito',remision:'Remisión',devolucion:'Devolución',anticipo_cliente:'Anticipo Cliente'};
  const label=tipos[tipo]||tipo;
  openModal(`
    <div class="modal-title">Nueva ${label}<button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">FECHA</label><input type="date" class="form-control" id="m-doc-fecha" value="${today()}"></div>
      <div class="form-group"><label class="form-label">CLIENTE</label><input class="form-control" id="m-doc-cliente" placeholder="Nombre del cliente"></div>
    </div>
    ${(tipo==='nc'||tipo==='nd'||tipo==='devolucion')?`<div class="form-group"><label class="form-label">FACTURA REFERENCIA</label><select class="form-control" id="m-doc-ref"><option value="">— Seleccionar —</option>${(state.facturas||[]).map(f=>'<option value="'+f.id+'">'+f.numero+' · '+fmt(f.total)+'</option>').join('')}</select></div>`:''}
    <div class="form-group"><label class="form-label">OBSERVACIONES</label><textarea class="form-control" id="m-doc-obs" rows="2"></textarea></div>
    <div class="card-title" style="margin-top:16px">ÍTEMS</div>
    <div id="m-doc-items"></div>
    <button class="btn btn-sm btn-secondary" style="margin-bottom:16px" onclick="addDocItem()">+ Agregar Ítem</button>
    <div style="text-align:right;font-family:Syne;font-size:18px;font-weight:800;color:var(--accent);margin-bottom:16px" id="m-doc-total">Total: $0</div>
    <button class="btn btn-primary" style="width:100%" onclick="saveDoc('${collection}','${tipo}')">Guardar ${label}</button>
  `,true);
  addDocItem();
}

let _docItems=[];
function addDocItem(){
  _docItems.push({articuloId:'',nombre:'',cantidad:1,precio:0});
  renderDocItems();
}
function renderDocItems(){
  const el=document.getElementById('m-doc-items');if(!el)return;
  el.innerHTML=_docItems.map((item,i)=>`
    <div style="display:grid;grid-template-columns:2fr 80px 120px 40px;gap:8px;margin-bottom:8px;align-items:end">
      <div class="form-group" style="margin:0"><label class="form-label">${i===0?'ARTÍCULO':''}</label><select class="form-control" onchange="docItemChanged(${i},this.value)" style="padding:8px"><option value="">— Seleccionar —</option>${(state.articulos||[]).map(a=>'<option value="'+a.id+'" '+(item.articuloId===a.id?'selected':'')+'>'+a.nombre+'</option>').join('')}<option value="custom">✏️ Personalizado</option></select></div>
      <div class="form-group" style="margin:0"><label class="form-label">${i===0?'CANT':''}</label><input type="number" class="form-control" value="${item.cantidad}" min="1" onchange="docItemQty(${i},this.value)" style="padding:8px"></div>
      <div class="form-group" style="margin:0"><label class="form-label">${i===0?'PRECIO':''}</label><input type="number" class="form-control" value="${item.precio}" min="0" onchange="docItemPrice(${i},this.value)" style="padding:8px" id="doc-item-price-${i}"></div>
      <button class="btn btn-xs btn-danger" onclick="removeDocItem(${i})" style="margin-bottom:0;height:38px">✕</button>
    </div>`).join('');
  updateDocTotal();
}
function docItemChanged(i,artId){
  if(artId==='custom'){_docItems[i].articuloId='custom';_docItems[i].nombre='Personalizado'}
  else{const art=(state.articulos||[]).find(a=>a.id===artId);if(art){_docItems[i].articuloId=artId;_docItems[i].nombre=art.nombre;_docItems[i].precio=art.precioVenta}}
  renderDocItems();
}
function docItemQty(i,val){_docItems[i].cantidad=parseInt(val)||1;updateDocTotal()}
function docItemPrice(i,val){_docItems[i].precio=parseFloat(val)||0;updateDocTotal()}
function removeDocItem(i){_docItems.splice(i,1);renderDocItems()}
function updateDocTotal(){
  const total=_docItems.reduce((a,item)=>a+(item.cantidad*item.precio),0);
  const el=document.getElementById('m-doc-total');if(el)el.textContent='Total: '+fmt(total);
}

async function saveDoc(collection,tipo){
  const fecha=document.getElementById('m-doc-fecha').value||today();
  const cliente=document.getElementById('m-doc-cliente').value.trim();
  const obs=document.getElementById('m-doc-obs').value.trim();
  const refId=document.getElementById('m-doc-ref')?.value||'';
  const items=_docItems.filter(i=>i.precio>0);
  if(items.length===0){notify('warning','⚠️','Sin ítems','Agrega al menos un ítem.',{duration:3000});return}
  const subtotal=items.reduce((a,i)=>a+(i.cantidad*i.precio),0);
  const iva=subtotal*0.19; const total=subtotal+iva;
  const prefixes={cotizaciones:'COT',ordenes_venta:'OV',facturas:'FAC',notas_credito:'NC',
    notas_debito:'ND',remisiones:'REM',devoluciones:'DEV',anticipos_clientes:'ANT'};
  const consKeys={cotizaciones:'cotizacion',ordenes_venta:'orden',facturas:'factura',
    notas_credito:'nc',notas_debito:'nd',remisiones:'remision',devoluciones:'devolucion',anticipos_clientes:'anticipo'};
  const prefix=prefixes[collection]||'DOC';
  const consKey=consKeys[collection]||'factura';
  const numero=prefix+'-'+getNextConsec(consKey);
  const docData={id:uid(),numero,fecha,cliente,items:items.map(i=>({...i})),
    subtotal,iva,total,estado:'borrador',observaciones:obs,facturaRef:refId,tipo};

  // Guardar en state local
  if(!state[collection]) state[collection]=[];
  state[collection].push(docData);
  _docItems=[];

  // Guardar en Supabase legacy_docs
  try {
    await supabaseClient.from('legacy_docs').insert({
      id:docData.id, tipo, numero:docData.numero, data:docData
    });
    await saveConfig('consecutivos', state.consecutivos);
  } catch(e){ console.warn('saveDoc Supabase error:', e.message); }

  closeModal();
  renderPage(document.querySelector('.page.active')?.id.replace('page-',''));
  notify('success','✅','Documento creado',`${numero} · ${fmt(total)}`,{duration:3000});
}


function viewDoc(collection,id){
  const doc=(state[collection]||[]).find(d=>d.id===id);if(!doc)return;
  openModal(`
    <div class="modal-title">${doc.numero}<button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="grid-2" style="margin-bottom:16px">
      <div><span style="color:var(--text2);font-size:12px">Fecha:</span> ${formatDate(doc.fecha)}</div>
      <div><span style="color:var(--text2);font-size:12px">Cliente:</span> ${doc.cliente||'—'}</div>
    </div>
    <div class="table-wrap" style="margin-bottom:16px"><table><thead><tr><th>Artículo</th><th>Cant</th><th>Precio</th><th>Total</th></tr></thead><tbody>
    ${(doc.items||[]).map(i=>`<tr><td>${i.nombre||'—'}</td><td>${i.cantidad}</td><td>${fmt(i.precio)}</td><td style="font-weight:700;color:var(--accent)">${fmt(i.cantidad*i.precio)}</td></tr>`).join('')}
    </tbody></table></div>
    <div style="text-align:right;margin-bottom:8px"><span style="color:var(--text2)">Subtotal:</span> ${fmt(doc.subtotal)}</div>
    <div style="text-align:right;margin-bottom:8px"><span style="color:var(--text2)">IVA:</span> ${fmt(doc.iva)}</div>
    <div style="text-align:right;font-family:Syne;font-size:20px;font-weight:800;color:var(--accent)">${fmt(doc.total)}</div>
    ${doc.observaciones?'<div style="margin-top:12px;font-size:12px;color:var(--text2)">'+doc.observaciones+'</div>':''}
    <div class="btn-group" style="margin-top:16px">
      <button class="btn btn-primary btn-sm" onclick="printDoc('${collection}','${id}')">🖨 Imprimir</button>
      ${doc.estado!=='pagada'?`<button class="btn btn-sm" style="background:rgba(74,222,128,.15);color:var(--green);border:1px solid rgba(74,222,128,.3)" onclick="changeDocStatus('${collection}','${id}','pagada')">✓ Marcar Pagada</button>`:''}
      ${doc.estado!=='anulada'?`<button class="btn btn-sm btn-danger" onclick="changeDocStatus('${collection}','${id}','anulada')">✕ Anular</button>`:''}
    </div>
  `);
}

function changeDocStatus(collection,id,newStatus){
  const doc=(state[collection]||[]).find(d=>d.id===id);if(!doc)return;
  doc.estado=newStatus;
  
  saveRecord(collection, doc.id, doc);
  closeModal();
  renderPage(document.querySelector('.page.active')?.id.replace('page-',''));
  notify('success','✅','Estado actualizado',doc.numero+' → '+newStatus,{duration:3000});
}

function deleteDoc(collection, id) {
  // --- CANDADO DE SEGURIDAD PARA FACTURAS ---
  if (collection === 'facturas') {
    alert('⚠️ ¡Alto ahí! Para mantener tu inventario y caja perfectamente cuadrados, las facturas solo se pueden anular desde la pestaña: SISTEMA > Historial.');
    return; // Detiene la acción inmediatamente
  }
  // ------------------------------------------

  if (!confirm('¿Eliminar este documento?')) return;
  state[collection] = (state[collection] || []).filter(d => d.id !== id);
  renderPage(document.querySelector('.page.active')?.id.replace('page-', ''));
}

function printDoc(collection,id){
  const doc=(state[collection]||[]).find(d=>d.id===id);if(!doc)return;
  printReceipt(doc);
}

function renderCotizaciones(){_docItems=[];renderDocumentList('cotizaciones','Cotización','cotizaciones','cotizacion')}
function renderOrdenes(){_docItems=[];renderDocumentList('ordenes','Orden de Venta','ordenes_venta','orden')}
function renderFacturas(){_docItems=[];renderDocumentList('facturas','Factura','facturas','factura')}
function renderNotasCredito(){_docItems=[];renderDocumentList('notas_credito','Nota Crédito','notas_credito','nc')}
function renderNotasDebito(){_docItems=[];renderDocumentList('notas_debito','Nota Débito','notas_debito','nd')}
function renderRemisiones(){_docItems=[];renderDocumentList('remisiones','Remisión','remisiones','remision')}
function renderDevoluciones(){_docItems=[];renderDocumentList('devoluciones','Devolución','devoluciones','devolucion')}
function renderAnticiposClientes(){_docItems=[];renderDocumentList('anticipos_clientes','Anticipo Cliente','anticipos_clientes','anticipo_cliente')}
  // ==========================================
