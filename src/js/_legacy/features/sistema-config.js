// ===================================================================
// ===== SISTEMA & CONFIGURACIÓN =====
// ===================================================================

function renderHistorial(){
  const q = (document.getElementById('hist-search')?.value || '').toLowerCase();
  let ventas = (state.ventas || []).slice().reverse();
  if(q) ventas = ventas.filter(v => (v.desc||'').toLowerCase().includes(q) || (v.cliente||'').toLowerCase().includes(q) || (v.guia||'').toLowerCase().includes(q));

  const rowsHtml = ventas.map(v => `
    <tr style="${v.archived ? 'opacity:0.6;' : ''}">
      <td>${formatDate(v.fecha)}</td>
      <td><span class="badge badge-${v.canal}">${v.canal}</span>${v.canal!=='vitrina'?`<span class="badge ${v.esContraEntrega?'badge-warn':'badge-ok'}" style="margin-left:4px;font-size:9px">${v.esContraEntrega?'📦CE':'💵CD'}</span>`:''}</td>
      <td style="font-weight:bold;">${v.desc||'—'}</td>
      <td>${v.cliente||'—'}</td>
      <td style="color:var(--accent);font-weight:700;">${fmt(v.valor)}</td>
      <td><span class="badge ${v.liquidado?'badge-ok':'badge-pend'}">${v.liquidado?'Liquidado':'Pendiente'}</span></td>
    </tr>`).join('') || '<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--text2)">Sin historial</td></tr>';

  if(document.getElementById('hist-tbody')) {
    document.getElementById('hist-tbody').innerHTML = rowsHtml;
    const cnt = document.getElementById('hist-count');
    if(cnt) cnt.textContent = ventas.length;
    return;
  }

  document.getElementById('historial-content').innerHTML = `
    <div style="display:flex;margin-bottom:16px;">
      <div class="search-bar" style="flex:1;max-width:400px;margin:0;">
        <span class="search-icon">🔍</span>
        <input type="text" id="hist-search" placeholder="Buscar por # factura, cliente o guía..."
          value="${q}" oninput="renderHistorial()">
      </div>
    </div>
    <div class="card">
      <div class="card-title">HISTORIAL GLOBAL DE VENTAS (<span id="hist-count">${ventas.length}</span>)</div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Fecha</th><th>Canal</th><th>Referencia</th><th>Cliente</th><th>Total</th><th>Estado</th></tr></thead>
          <tbody id="hist-tbody">${rowsHtml}</tbody>
        </table>
      </div>
    </div>`;
}

function renderConfig(){
  const emp = state.empresa || {};
  const activeTab = window._cfgTab || 'empresa';
  const tabs = [
    {id:'empresa', icon:'🏢', label:'Empresa & Ticket'},
    {id:'inventario', icon:'🗂️', label:'Categorías'},
    {id:'logistica', icon:'🚚', label:'Logística'},
    {id:'pagos', icon:'💳', label:'Pagos'},
    {id:'precios', icon:'💰', label:'Tarifas & IVA'},
    {id:'nomina', icon:'👔', label:'Nómina'},
    {id:'bodegas', icon:'🏭', label:'Bodegas'},
    {id:'gamif', icon:'🎮', label:'Gamificación'},
    {id:'peligro', icon:'⚡', label:'Sistema'},
  ];

  document.getElementById('config-content').innerHTML = `
    <div class="tabs" style="margin-bottom:20px">
      ${tabs.map(t=>`<div class="tab ${activeTab===t.id?'active':''}" onclick="setCfgTab('${t.id}')">${t.icon} ${t.label}</div>`).join('')}
    </div>
    <div id="cfg-tab-body"></div>`;

  renderCfgTab(activeTab);
}

function setCfgTab(tab) {
  window._cfgTab = tab;
  document.querySelectorAll('#config-content .tab').forEach(t => {
    t.classList.toggle('active', t.getAttribute('onclick')?.includes("'"+tab+"'"));
  });
  renderCfgTab(tab);
}

function renderCfgTab(tab) {
  const el = document.getElementById('cfg-tab-body');
  if(!el) return;
  const emp = state.empresa || {};

  if(tab === 'empresa') {
    el.innerHTML = `
      <div class="card">
        <div class="card-title">🖨️ VISTA PREVIA TICKET 80mm</div>
        <div style="display:flex;gap:20px;align-items:flex-start;flex-wrap:wrap">
          <div style="background:white;color:#000;font-family:'Courier New',monospace;font-size:10px;width:72mm;padding:8px;border:1px solid #ddd;border-radius:4px;margin:0 auto">
            ${emp.logoBase64?`<div style="text-align:center;margin-bottom:4px"><img src="${emp.logoBase64}" style="max-width:160px"></div>`:`<div style="text-align:center;font-weight:900;font-size:13px;letter-spacing:2px">${emp.nombre||'NOMBRE EMPRESA'}</div>`}
            <div style="text-align:center;font-weight:700">${emp.nombre||'NOMBRE EMPRESA'}</div>
            <div style="text-align:center;font-size:9px">NIT: ${emp.nit||'---'} | ${emp.regimenFiscal||'Régimen ordinario'}</div>
            <div style="text-align:center;font-size:9px">${emp.departamento||''}/${emp.ciudad||''} / ${emp.direccion||''}</div>
            <div style="text-align:center;font-size:9px">Tel: ${emp.telefono||''}${emp.telefono2?' / '+emp.telefono2:''}</div>
            ${emp.email?`<div style="text-align:center;font-size:9px">${emp.email}</div>`:''}
            <div style="border-top:1px dashed #000;margin:4px 0"></div>
            <div style="text-align:center;font-weight:700">FACTURA DE VENTA No.: 00001</div>
            <div style="text-align:center;font-size:9px">${today()}</div>
            ${emp.mensajeHeader?`<div style="text-align:center;font-size:9px;white-space:pre-wrap">${emp.mensajeHeader}</div>`:''}
            <div style="border-top:1px dashed #000;margin:4px 0"></div>
            <div style="font-size:9px">Cliente: CLIENTE MOSTRADOR</div>
            <div style="border-top:1px dashed #000;margin:4px 0"></div>
            <div style="font-size:9px">Producto ejemplo x1 → 48.000</div>
            <div style="border-top:1px dashed #000;margin:4px 0"></div>
            <div style="font-weight:900;font-size:11px;text-align:right">TOTAL: $48.000</div>
            ${emp.mensajePie?`<div style="text-align:center;font-size:9px;margin-top:4px;white-space:pre-wrap">${emp.mensajePie}</div>`:''}
          </div>
          <div style="flex:2;min-width:280px">
            <div class="form-group">
              <label class="form-label">📸 LOGO (recomendado 400×120px, fondo blanco)</label>
              <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
                <button class="btn btn-secondary btn-sm" onclick="document.getElementById('cfg-logo-input').click()">📁 Subir Logo</button>
                <input type="file" id="cfg-logo-input" accept="image/*" style="display:none" onchange="procesarLogoConfig(this)">
                ${emp.logoBase64?`<button class="btn btn-xs btn-danger" onclick="state.empresa.logoBase64='';saveConfig('empresa',state.empresa).then(()=>renderCfgTab('empresa'))">✕ Quitar</button>`:''}
                <div style="width:80px;height:40px;border:1px solid var(--border);border-radius:6px;background:${emp.logoBase64?`url('${emp.logoBase64}') center/contain no-repeat white`:'var(--bg3)'}"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="card">
        <div class="card-title">🏢 DATOS DE EMPRESA</div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">NOMBRE EMPRESA</label><input class="form-control" id="cfg-nombre" value="${emp.nombre||''}" placeholder="EON CLOTHING"></div>
          <div class="form-group"><label class="form-label">NOMBRE SECUNDARIO</label><input class="form-control" id="cfg-nombre2" value="${emp.nombreComercial||''}"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">NIT</label><input class="form-control" id="cfg-nit" value="${emp.nit||''}"></div>
          <div class="form-group"><label class="form-label">RÉGIMEN FISCAL</label><input class="form-control" id="cfg-regimen" value="${emp.regimenFiscal||''}" placeholder="No responsable de IVA"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">DEPARTAMENTO</label><input class="form-control" id="cfg-dpto" value="${emp.departamento||''}"></div>
          <div class="form-group"><label class="form-label">CIUDAD</label><input class="form-control" id="cfg-ciudad" value="${emp.ciudad||''}"></div>
        </div>
        <div class="form-group"><label class="form-label">DIRECCIÓN</label><input class="form-control" id="cfg-dir" value="${emp.direccion||''}"></div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">TELÉFONO 1</label><input class="form-control" id="cfg-tel" value="${emp.telefono||''}"></div>
          <div class="form-group"><label class="form-label">TELÉFONO 2</label><input class="form-control" id="cfg-tel2" value="${emp.telefono2||''}"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">EMAIL</label><input class="form-control" id="cfg-email" value="${emp.email||''}"></div>
          <div class="form-group"><label class="form-label">PÁGINA WEB</label><input class="form-control" id="cfg-web" value="${emp.web||''}"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">VENDEDORA</label><input class="form-control" id="cfg-vendedora" value="${emp.vendedora||''}"></div>
          <div class="form-group"><label class="form-label">INSTAGRAM / REDES</label><input class="form-control" id="cfg-social" value="${emp.social||''}"></div>
        </div>
      </div>
      <div class="card">
        <div class="card-title">🧾 TEXTOS DEL TICKET</div>
        <div class="form-group"><label class="form-label">MENSAJE ENCABEZADO</label><textarea class="form-control" id="cfg-header" rows="3">${emp.mensajeHeader||''}</textarea></div>
        <div class="form-group"><label class="form-label">MENSAJE PIE</label><textarea class="form-control" id="cfg-pie" rows="2">${emp.mensajePie||''}</textarea></div>
        <div class="form-group"><label class="form-label">POLÍTICA DE DATOS</label><textarea class="form-control" id="cfg-datos" rows="2">${emp.politicaDatos||''}</textarea></div>
        <div class="form-group"><label class="form-label">POLÍTICA CAMBIOS / GARANTÍAS</label><textarea class="form-control" id="cfg-garantias" rows="2">${emp.mensajeGarantias||''}</textarea></div>
      </div>
      <button class="btn btn-primary" style="width:100%;height:50px;font-size:16px" onclick="guardarConfigCompleta()">💾 Guardar Configuración de Empresa</button>`;
  }

  else if(tab === 'inventario') {
    const cats = state.cfg_categorias || [];
    const secs = state.cfg_secciones || [];
    el.innerHTML = `
      <div class="grid-2">
        <div class="card" style="margin:0">
          <div class="card-title">📁 SECCIONES WEB
            <button class="btn btn-xs btn-primary" style="margin-left:auto" onclick="abrirCfgModal('cfg_secciones','Sección',['nombre:text:Nombre'])">+ Nueva</button>
          </div>
          <div class="table-wrap"><table><thead><tr><th>Nombre</th><th></th></tr></thead><tbody>
          ${secs.map(s=>`<tr><td style="font-weight:700">${s.nombre}</td><td>
            <button class="btn btn-xs btn-danger" onclick="eliminarCfgItem('cfg_secciones','${s.id}','inventario')">✕</button>
          </td></tr>`).join('')||'<tr><td colspan="2" style="text-align:center;color:var(--text2);padding:12px">Sin secciones</td></tr>'}
          </tbody></table></div>
        </div>
        <div class="card" style="margin:0">
          <div class="card-title">🗂️ CATEGORÍAS
            <button class="btn btn-xs btn-primary" style="margin-left:auto" onclick="abrirCfgModalCat()">+ Nueva</button>
          </div>
          <div class="table-wrap"><table><thead><tr><th>Sección</th><th>Categoría</th><th></th></tr></thead><tbody>
          ${cats.map(c=>`<tr>
            <td style="font-size:11px;color:var(--text2)">${c.seccion}</td>
            <td style="font-weight:700">${c.nombre}</td>
            <td><button class="btn btn-xs btn-danger" onclick="eliminarCfgItem('cfg_categorias','${c.id}','inventario')">✕</button></td>
          </tr>`).join('')||'<tr><td colspan="3" style="text-align:center;color:var(--text2);padding:12px">Sin categorías</td></tr>'}
          </tbody></table></div>
        </div>
      </div>`;
  }

  else if(tab === 'logistica') {
    const trans = state.cfg_transportadoras || [];
    el.innerHTML = `
      <div class="card">
        <div class="card-title">🚚 TRANSPORTADORAS
          <button class="btn btn-xs btn-primary" style="margin-left:auto" onclick="abrirCfgModal('cfg_transportadoras','Transportadora',['nombre:text:Nombre'])">+ Nueva</button>
        </div>
        <div class="table-wrap"><table><thead><tr><th>Nombre</th><th>Activa</th><th></th></tr></thead><tbody>
        ${trans.map(t=>`<tr>
          <td style="font-weight:700">${t.nombre}</td>
          <td><span class="badge ${t.activa!==false?'badge-ok':'badge-pend'}">${t.activa!==false?'✓ Activa':'Inactiva'}</span></td>
          <td><div class="btn-group">
            <button class="btn btn-xs btn-secondary" onclick="toggleCfgActivo('cfg_transportadoras','${t.id}','logistica')">${t.activa!==false?'Desactivar':'Activar'}</button>
            <button class="btn btn-xs btn-danger" onclick="eliminarCfgItem('cfg_transportadoras','${t.id}','logistica')">✕</button>
          </div></td>
        </tr>`).join('')||'<tr><td colspan="3" style="text-align:center;color:var(--text2);padding:12px">Sin transportadoras</td></tr>'}
        </tbody></table></div>
      </div>
      <div class="card">
        <div class="card-title">⏱️ TIEMPOS DE LIQUIDACIÓN</div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">DÍAS LIQ. LOCAL (hábiles)</label><input type="number" class="form-control" id="cfg-dias-local" value="${state.diasLocal||1}" min="1"></div>
          <div class="form-group"><label class="form-label">DÍAS LIQ. INTER (hábiles)</label><input type="number" class="form-control" id="cfg-dias-inter" value="${state.diasInter||5}" min="1"></div>
        </div>
        <button class="btn btn-primary" onclick="guardarDiasLiq()">💾 Guardar Tiempos</button>
      </div>`;
  }

  else if(tab === 'pagos') {
    const metodos = state.cfg_metodos_pago || [];
    el.innerHTML = `
      <div class="card">
        <div class="card-title">💳 MÉTODOS DE PAGO
          <button class="btn btn-xs btn-primary" style="margin-left:auto" onclick="abrirCfgModal('cfg_metodos_pago','Método de Pago',['nombre:text:Nombre','tipo:text:Tipo (efectivo/digital/banco/tarjeta)'])">+ Nuevo</button>
        </div>
        <div class="table-wrap"><table><thead><tr><th>Nombre</th><th>Tipo</th><th>Estado</th><th></th></tr></thead><tbody>
        ${metodos.map(m=>`<tr>
          <td style="font-weight:700">${m.nombre}</td>
          <td><span class="badge badge-info">${m.tipo||'otro'}</span></td>
          <td><span class="badge ${m.activo!==false?'badge-ok':'badge-pend'}">${m.activo!==false?'Activo':'Inactivo'}</span></td>
          <td><div class="btn-group">
            <button class="btn btn-xs btn-secondary" onclick="toggleCfgActivo('cfg_metodos_pago','${m.id}','pagos')">${m.activo!==false?'Desactivar':'Activar'}</button>
            <button class="btn btn-xs btn-danger" onclick="eliminarCfgItem('cfg_metodos_pago','${m.id}','pagos')">✕</button>
          </div></td>
        </tr>`).join('')||'<tr><td colspan="4" style="text-align:center;color:var(--text2);padding:12px">Sin métodos</td></tr>'}
        </tbody></table></div>
      </div>`;
  }

  else if(tab === 'precios') {
    const tarifas = state.cfg_tarifas || [];
    const impuestos = state.cfg_impuestos || [];
    el.innerHTML = `
      <div class="card">
        <div class="card-title">💰 TARIFAS DE PRECIO
          <button class="btn btn-xs btn-primary" style="margin-left:auto" onclick="abrirCfgModal('cfg_tarifas','Tarifa',['nombre:text:Nombre','porcentaje:number:% Ajuste (negativo=descuento)','descripcion:text:Descripción'])">+ Nueva</button>
        </div>
        <div class="table-wrap"><table><thead><tr><th>Nombre</th><th>% Ajuste</th><th>Descripción</th><th></th></tr></thead><tbody>
        ${tarifas.map(t=>`<tr>
          <td style="font-weight:700">${t.nombre}</td>
          <td style="color:${t.porcentaje>0?'var(--green)':t.porcentaje<0?'var(--red)':'var(--text2)'};font-weight:700">${t.porcentaje>0?'+':''}${t.porcentaje}%</td>
          <td style="color:var(--text2);font-size:11px">${t.descripcion||'—'}</td>
          <td><button class="btn btn-xs btn-danger" onclick="eliminarCfgItem('cfg_tarifas','${t.id}','precios')">✕</button></td>
        </tr>`).join('')||'<tr><td colspan="4" style="text-align:center;color:var(--text2);padding:12px">Sin tarifas</td></tr>'}
        </tbody></table></div>
      </div>
      <div class="card">
        <div class="card-title">📊 IMPUESTOS Y RETENCIONES
          <button class="btn btn-xs btn-primary" style="margin-left:auto" onclick="abrirCfgModal('cfg_impuestos','Impuesto',['nombre:text:Nombre','porcentaje:number:Porcentaje %','tipo:text:Tipo (venta/retencion)'])">+ Nuevo</button>
        </div>
        <div class="table-wrap"><table><thead><tr><th>Nombre</th><th>%</th><th>Tipo</th><th>Estado</th><th></th></tr></thead><tbody>
        ${impuestos.map(i=>`<tr>
          <td style="font-weight:700">${i.nombre}</td>
          <td style="font-weight:700;color:var(--accent)">${i.porcentaje}%</td>
          <td><span class="badge badge-info">${i.tipo||'venta'}</span></td>
          <td><span class="badge ${i.activo!==false?'badge-ok':'badge-pend'}">${i.activo!==false?'Activo':'Inactivo'}</span></td>
          <td><div class="btn-group">
            <button class="btn btn-xs btn-secondary" onclick="toggleCfgActivo('cfg_impuestos','${i.id}','precios')">${i.activo!==false?'Desactivar':'Activar'}</button>
            <button class="btn btn-xs btn-danger" onclick="eliminarCfgItem('cfg_impuestos','${i.id}','precios')">✕</button>
          </div></td>
        </tr>`).join('')||'<tr><td colspan="5" style="text-align:center;color:var(--text2);padding:12px">Sin impuestos</td></tr>'}
        </tbody></table></div>
      </div>`;
  }

  else if(tab === 'nomina') {
    const conceptos = state.nom_conceptos || [];
    el.innerHTML = `
      <div class="card">
        <div class="card-title">📝 CONCEPTOS DE NÓMINA
          <button class="btn btn-xs btn-primary" style="margin-left:auto" onclick="openConceptoModal()">+ Nuevo</button>
        </div>
        <div class="table-wrap"><table><thead><tr><th>Nombre</th><th>Tipo</th><th>Fórmula</th><th>Valor</th><th></th></tr></thead><tbody>
        ${conceptos.map(c=>`<tr>
          <td style="font-weight:700">${c.nombre}</td>
          <td><span class="badge ${c.tipo==='devengo'?'badge-ok':'badge-pend'}">${c.tipo}</span></td>
          <td><span class="badge badge-info">${c.formula}</span></td>
          <td style="font-weight:700">${c.formula==='porcentaje'?c.valor+'%':fmt(c.valor)}</td>
          <td><button class="btn btn-xs btn-danger" onclick="eliminarConceptoCfg('${c.id}')">✕</button></td>
        </tr>`).join('')}
        </tbody></table></div>
      </div>
      <div class="card">
        <div class="card-title">📅 PARÁMETROS DE NÓMINA</div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">SMMLV 2026</label>
            <input type="number" class="form-control" id="cfg-smmlv" value="${state.cfg_game?.smmlv||1750905}">
          </div>
          <div class="form-group"><label class="form-label">AUX. TRANSPORTE 2026</label>
            <input type="number" class="form-control" id="cfg-auxtrans" value="${state.cfg_game?.aux_trans||249095}">
          </div>
        </div>
        <button class="btn btn-primary" onclick="guardarParamsNomina()">💾 Guardar Parámetros</button>
      </div>`;
  }

  else if(tab === 'bodegas') {
    const bodegas = state.bodegas || [];
    el.innerHTML = `
      <div class="card">
        <div class="card-title">🏭 BODEGAS
          <button class="btn btn-xs btn-primary" style="margin-left:auto" onclick="abrirCfgModal('bodegas','Bodega',['nombre:text:Nombre','ubicacion:text:Ubicación/Descripción'])">+ Nueva</button>
        </div>
        <div class="table-wrap"><table><thead><tr><th>ID</th><th>Nombre</th><th>Ubicación</th><th></th></tr></thead><tbody>
        ${bodegas.map(b=>`<tr>
          <td style="font-size:10px;color:var(--text2)">${b.id}</td>
          <td style="font-weight:700">${b.name||b.nombre||''}</td>
          <td>${b.ubicacion||'—'}</td>
          <td><button class="btn btn-xs btn-danger" onclick="eliminarBodega('${b.id}')">✕</button></td>
        </tr>`).join('')||'<tr><td colspan="4" style="text-align:center;color:var(--text2);padding:12px">Sin bodegas</td></tr>'}
        </tbody></table></div>
      </div>`;
  }

  else if(tab === 'gamif') {
    const g = state.cfg_game || {};
    el.innerHTML = `
      <div class="card">
        <div class="card-title">🎮 CONFIGURACIÓN GAMIFICACIÓN</div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">META MENSUAL ($)</label><input type="number" class="form-control" id="cfg-meta" value="${state.meta||34000000}"></div>
          <div class="form-group"><label class="form-label">XP AL LIQUIDAR UN COBRO</label><input type="number" class="form-control" id="cfg-xp-liq" value="${g.xp_liquidar||20}"></div>
        </div>
        <div class="card-title" style="margin-top:8px">XP POR CANAL</div>
        <div class="form-row-3">
          <div class="form-group"><label class="form-label">VITRINA (1 XP c/$ de)</label><input type="number" class="form-control" id="cfg-xp-vitrina" value="${g.xp_por_venta_vitrina||150000}"></div>
          <div class="form-group"><label class="form-label">LOCAL (1 XP c/$ de)</label><input type="number" class="form-control" id="cfg-xp-local" value="${g.xp_por_venta_local||25000}"></div>
          <div class="form-group"><label class="form-label">INTER (1 XP c/$ de)</label><input type="number" class="form-control" id="cfg-xp-inter" value="${g.xp_por_venta_inter||20000}"></div>
        </div>
        <button class="btn btn-primary" style="margin-top:8px" onclick="guardarCfgGame()">💾 Guardar Gamificación</button>
      </div>`;
  }

  else if(tab === 'peligro') {
    el.innerHTML = `
      <div class="card" style="border-color:rgba(248,113,113,0.3)">
        <div class="card-title" style="color:var(--red)">⚡ ZONA DE PELIGRO</div>
        <div style="color:var(--text2);font-size:12px;margin-bottom:20px">Estas acciones afectan el estado general del ERP.</div>
        <div class="btn-group">
          <button class="btn btn-danger btn-sm" onclick="forceMonthReset()">🔄 Archivar Ventas del Mes</button>
          <button class="btn btn-secondary btn-sm" style="color:var(--red)" onclick="location.reload()">🔌 Forzar Recarga</button>
        </div>
      </div>`;
  }
}

// ===== CONFIG HELPERS =====

function abrirCfgModal(collection, titulo, fields) {
  openModal(`
    <div class="modal-title">+ ${titulo}<button class="modal-close" onclick="closeModal()">×</button></div>
    ${fields.map(f=>{const[key,type,label]=f.split(':');return`<div class="form-group"><label class="form-label">${label}</label><input type="${type==='number'?'number':'text'}" class="form-control" id="cfg-field-${key}"></div>`}).join('')}
    <button class="btn btn-primary" style="width:100%" onclick="guardarCfgItem('${collection}',${JSON.stringify(fields).replace(/"/g,"'")})">Guardar</button>
  `);
}

function abrirCfgModalCat() {
  const secs = state.cfg_secciones || [];
  openModal(`
    <div class="modal-title">+ Nueva Categoría<button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="form-group"><label class="form-label">SECCIÓN</label>
      <select class="form-control" id="cfg-field-seccion">
        ${secs.map(s=>`<option value="${s.nombre}">${s.nombre}</option>`).join('')}
      </select>
    </div>
    <div class="form-group"><label class="form-label">NOMBRE CATEGORÍA</label>
      <input type="text" class="form-control" id="cfg-field-nombre">
    </div>
    <button class="btn btn-primary" style="width:100%" onclick="guardarCfgItem('cfg_categorias',['seccion:text:Sección','nombre:text:Nombre'])">Guardar</button>
  `);
}

async function guardarCfgItem(collection, fields) {
  if(typeof fields === 'string') fields = JSON.parse(fields.replace(/'/g,'"'));
  const item = { id: uid() };
  for(const f of fields) {
    const key = f.split(':')[0];
    const type = f.split(':')[1];
    const el = document.getElementById('cfg-field-'+key);
    if(el) item[key] = type==='number' ? parseFloat(el.value)||0 : el.value.trim();
  }
  if(collection === 'bodegas') {
    item.name = item.nombre; item.activa = true;
  }
  if(!state[collection]) state[collection] = [];
  state[collection].push(item);
  await saveRecord(collection, item.id, item);
  closeModal();
  renderCfgTab(window._cfgTab||'inventario');
  notify('success','✅','Guardado',`${Object.values(item).filter(v=>typeof v==='string'&&v.length>0)[0]||''}`,{duration:2000});
}

async function eliminarCfgItem(collection, id, tab) {
  if(!confirm('¿Eliminar este registro?')) return;
  state[collection] = (state[collection]||[]).filter(x=>x.id!==id);
  await deleteRecord(collection, id);
  renderCfgTab(tab);
}

async function toggleCfgActivo(collection, id, tab) {
  const item = (state[collection]||[]).find(x=>x.id===id);
  if(!item) return;
  const field = collection==='cfg_transportadoras' ? 'activa' : 'activo';
  item[field] = !item[field];
  await saveRecord(collection, id, item);
  renderCfgTab(tab);
}

async function eliminarBodega(id) {
  if(!confirm('¿Eliminar esta bodega? Verifica que no tenga inventario activo.')) return;
  state.bodegas = state.bodegas.filter(b=>b.id!==id);
  try { await supabaseClient.from('bodegas').delete().eq('id',id); } catch(e){}
  renderCfgTab('bodegas');
}

async function guardarDiasLiq() {
  state.diasLocal = parseInt(document.getElementById('cfg-dias-local')?.value)||1;
  state.diasInter = parseInt(document.getElementById('cfg-dias-inter')?.value)||5;
  await saveConfig('diasLocal', state.diasLocal);
  await saveConfig('diasInter', state.diasInter);
  notify('success','✅','Tiempos guardados','',{duration:2000});
}

async function guardarCfgGame() {
  state.meta = parseFloat(document.getElementById('cfg-meta')?.value)||34000000;
  state.cfg_game = {
    ...state.cfg_game,
    xp_liquidar: parseInt(document.getElementById('cfg-xp-liq')?.value)||20,
    xp_por_venta_vitrina: parseInt(document.getElementById('cfg-xp-vitrina')?.value)||150000,
    xp_por_venta_local: parseInt(document.getElementById('cfg-xp-local')?.value)||25000,
    xp_por_venta_inter: parseInt(document.getElementById('cfg-xp-inter')?.value)||20000,
  };
  await saveConfig('meta', state.meta);
  await saveConfig('cfg_game', state.cfg_game);
  renderDashboard();
  notify('success','✅','Gamificación guardada','',{duration:2000});
}

async function guardarParamsNomina() {
  state.cfg_game = {
    ...state.cfg_game,
    smmlv: parseFloat(document.getElementById('cfg-smmlv')?.value)||1750905,
    aux_trans: parseFloat(document.getElementById('cfg-auxtrans')?.value)||249095,
  };
  await saveConfig('cfg_game', state.cfg_game);
  notify('success','✅','Parámetros guardados','Se aplicarán en el próximo cálculo.',{duration:3000});
}

function eliminarConceptoCfg(id) {
  deleteFromCollection('nom_conceptos', id, 'config');
  renderCfgTab('nomina');
}


function procesarLogoConfig(input) {
  const file = input.files[0]; if(!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    const img = new Image();
    img.onload = async function() {
      const canvas = document.createElement('canvas');
      const MAX_W = 400;
      const scale = Math.min(1, MAX_W / img.width);
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      if(!state.empresa) state.empresa = {};
      state.empresa.logoBase64 = canvas.toDataURL('image/png');
      await saveConfig('empresa', state.empresa);
      renderConfig();
      notify('success','🖼️','Logo cargado','Se ajustó automáticamente para 80mm.',{duration:3000});
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

async function guardarConfigCompleta() {
  if(!state.empresa) state.empresa = {};
  state.empresa.nombre        = document.getElementById('cfg-nombre')?.value.trim() || state.empresa.nombre;
  state.empresa.nombreComercial = document.getElementById('cfg-nombre2')?.value.trim() || '';
  state.empresa.nit           = document.getElementById('cfg-nit')?.value.trim() || '';
  state.empresa.regimenFiscal = document.getElementById('cfg-regimen')?.value.trim() || '';
  state.empresa.departamento  = document.getElementById('cfg-dpto')?.value.trim() || '';
  state.empresa.ciudad        = document.getElementById('cfg-ciudad')?.value.trim() || '';
  state.empresa.direccion     = document.getElementById('cfg-dir')?.value.trim() || '';
  state.empresa.telefono      = document.getElementById('cfg-tel')?.value.trim() || '';
  state.empresa.telefono2     = document.getElementById('cfg-tel2')?.value.trim() || '';
  state.empresa.email         = document.getElementById('cfg-email')?.value.trim() || '';
  state.empresa.web           = document.getElementById('cfg-web')?.value.trim() || '';
  state.empresa.vendedora     = document.getElementById('cfg-vendedora')?.value.trim() || '';
  state.empresa.social        = document.getElementById('cfg-social')?.value.trim() || '';
  state.empresa.mensajeHeader = document.getElementById('cfg-header')?.value.trim() || '';
  state.empresa.mensajePie    = document.getElementById('cfg-pie')?.value.trim() || '';
  state.empresa.politicaDatos = document.getElementById('cfg-datos')?.value.trim() || '';
  state.empresa.mensajeGarantias = document.getElementById('cfg-garantias')?.value.trim() || '';

  state.meta      = parseFloat(document.getElementById('cfg-meta')?.value) || 34000000;
  state.diasLocal = parseInt(document.getElementById('cfg-dias-local')?.value) || 1;
  state.diasInter = parseInt(document.getElementById('cfg-dias-inter')?.value) || 5;

  await saveConfig('empresa', state.empresa);
  await saveConfig('meta', state.meta);
  await saveConfig('diasLocal', state.diasLocal);
  await saveConfig('diasInter', state.diasInter);

  notify('success','✅','Configuración guardada','Los datos se reflejan en el ticket.',{duration:3000});
  renderConfig();
  renderDashboard();
}

// Mantener saveConfig como función legacy (no confundir con la async de Supabase)
function saveConfigLegacy() { guardarConfigCompleta(); }

function forceMonthReset(){
  if(confirm('⚠️ ¿Estás seguro? Esto archivará todas las ventas actuales y reiniciará el progreso de la meta mensual. Esta acción no se puede deshacer fácilmente.')) {
    state.currentMonth = null;
    checkMonthReset();
    saveConfig('consecutivos', state.consecutivos);
    renderAll();
    notify('success', '🔄', 'Mes Reseteado', 'Las ventas han sido archivadas correctamente.', {duration: 4000});
  }
}

