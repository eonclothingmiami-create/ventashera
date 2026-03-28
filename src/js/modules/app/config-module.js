// Config module: tabs and configuration helpers.
(function initConfigModule(global) {
  function renderConfig(ctx) {
    const { state } = ctx;
    const activeTab = global._cfgTab || 'empresa';
    const tabs = [
      { id: 'empresa', icon: '🏢', label: 'Empresa & Ticket' },
      { id: 'inventario', icon: '🗂️', label: 'Categorías' },
      { id: 'logistica', icon: '🚚', label: 'Logística' },
      { id: 'pagos', icon: '💳', label: 'Pagos' },
      { id: 'precios', icon: '💰', label: 'Tarifas & IVA' },
      { id: 'nomina', icon: '👔', label: 'Nómina' },
      { id: 'bodegas', icon: '🏭', label: 'Bodegas' },
      { id: 'cajas_pos', icon: '🏧', label: 'Cajas POS' },
      { id: 'gamif', icon: '🎮', label: 'Gamificación' },
      { id: 'backups', icon: '💾', label: 'Copias & restauración' },
      { id: 'peligro', icon: '⚡', label: 'Sistema' }
    ];
    document.getElementById('config-content').innerHTML = `
    <div class="tabs" style="margin-bottom:20px">
      ${tabs.map((t) => `<div class="tab ${activeTab === t.id ? 'active' : ''}" onclick="setCfgTab('${t.id}')">${t.icon} ${t.label}</div>`).join('')}
    </div>
    <div id="cfg-tab-body"></div>`;
    renderCfgTab({ ...ctx, tab: activeTab });
  }

  function setCfgTab(ctx) {
    const { tab, renderCfgTab } = ctx;
    global._cfgTab = tab;
    document.querySelectorAll('#config-content .tab').forEach((t) => {
      t.classList.toggle('active', t.getAttribute('onclick')?.includes("'" + tab + "'"));
    });
    renderCfgTab(tab);
  }

  function renderCfgTab(ctx) {
    const { state, tab, today, fmt, notify, confirm } = ctx;
    const el = document.getElementById('cfg-tab-body');
    if (!el) return;
    if (tab === 'backups' && global.AppBackupModule?.renderBackupsTab) {
      global.AppBackupModule.renderBackupsTab({ state, notify, confirm });
      return;
    }
    const emp = state.empresa || {};
    if (tab === 'empresa') {
      el.innerHTML = `
      <div class="card">
        <div class="card-title">🖨️ VISTA PREVIA TICKET 80mm</div>
        <div style="display:flex;gap:20px;align-items:flex-start;flex-wrap:wrap">
          <div style="background:white;color:#000;font-family:'Courier New',monospace;font-size:10px;width:72mm;padding:8px;border:1px solid #ddd;border-radius:4px;margin:0 auto">
            ${emp.logoBase64 ? `<div style="text-align:center;margin-bottom:4px"><img src="${emp.logoBase64}" style="max-width:160px"></div>` : `<div style="text-align:center;font-weight:900;font-size:13px;letter-spacing:2px">${emp.nombre || 'NOMBRE EMPRESA'}</div>`}
            <div style="text-align:center;font-weight:700">${emp.nombre || 'NOMBRE EMPRESA'}</div>
            <div style="text-align:center;font-size:9px">NIT: ${emp.nit || '---'} | ${emp.regimenFiscal || 'Régimen ordinario'}</div>
            <div style="text-align:center;font-size:9px">${emp.departamento || ''}/${emp.ciudad || ''} / ${emp.direccion || ''}</div>
            <div style="text-align:center;font-size:9px">Tel: ${emp.telefono || ''}${emp.telefono2 ? ' / ' + emp.telefono2 : ''}</div>
            ${emp.email ? `<div style="text-align:center;font-size:9px">${emp.email}</div>` : ''}
            <div style="border-top:1px dashed #000;margin:4px 0"></div>
            <div style="text-align:center;font-weight:700">FACTURA DE VENTA No.: 00001</div>
            <div style="text-align:center;font-size:9px">${today()}</div>
            ${emp.mensajeHeader ? `<div style="text-align:center;font-size:9px;white-space:pre-wrap">${emp.mensajeHeader}</div>` : ''}
            <div style="border-top:1px dashed #000;margin:4px 0"></div>
            <div style="font-size:9px">Cliente: CLIENTE MOSTRADOR</div>
            <div style="border-top:1px dashed #000;margin:4px 0"></div>
            <div style="font-size:9px">Producto ejemplo x1 → 48.000</div>
            <div style="border-top:1px dashed #000;margin:4px 0"></div>
            <div style="font-weight:900;font-size:11px;text-align:right">TOTAL: $48.000</div>
            ${emp.mensajePie ? `<div style="text-align:center;font-size:9px;margin-top:4px;white-space:pre-wrap">${emp.mensajePie}</div>` : ''}
          </div>
          <div style="flex:2;min-width:280px">
            <div class="form-group">
              <label class="form-label">📸 LOGO (recomendado 400×120px, fondo blanco)</label>
              <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
                <button class="btn btn-secondary btn-sm" onclick="document.getElementById('cfg-logo-input').click()">📁 Subir Logo</button>
                <input type="file" id="cfg-logo-input" accept="image/*" style="display:none" onchange="procesarLogoConfig(this)">
                ${emp.logoBase64 ? `<button class="btn btn-xs btn-danger" onclick="state.empresa.logoBase64='';saveConfig('empresa',state.empresa).then(()=>renderCfgTab('empresa'))">✕ Quitar</button>` : ''}
                <div style="width:80px;height:40px;border:1px solid var(--border);border-radius:6px;background:${emp.logoBase64 ? `url('${emp.logoBase64}') center/contain no-repeat white` : 'var(--bg3)'}"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="card">
        <div class="card-title">🏢 DATOS DE EMPRESA</div>
        <div class="form-row"><div class="form-group"><label class="form-label">NOMBRE EMPRESA</label><input class="form-control" id="cfg-nombre" value="${emp.nombre || ''}" placeholder="EON CLOTHING"></div><div class="form-group"><label class="form-label">NOMBRE SECUNDARIO</label><input class="form-control" id="cfg-nombre2" value="${emp.nombreComercial || ''}"></div></div>
        <div class="form-row"><div class="form-group"><label class="form-label">NIT</label><input class="form-control" id="cfg-nit" value="${emp.nit || ''}"></div><div class="form-group"><label class="form-label">RÉGIMEN FISCAL</label><input class="form-control" id="cfg-regimen" value="${emp.regimenFiscal || ''}" placeholder="No responsable de IVA"></div></div>
        <div class="form-row"><div class="form-group"><label class="form-label">DEPARTAMENTO</label><input class="form-control" id="cfg-dpto" value="${emp.departamento || ''}"></div><div class="form-group"><label class="form-label">CIUDAD</label><input class="form-control" id="cfg-ciudad" value="${emp.ciudad || ''}"></div></div>
        <div class="form-group"><label class="form-label">DIRECCIÓN</label><input class="form-control" id="cfg-dir" value="${emp.direccion || ''}"></div>
        <div class="form-row"><div class="form-group"><label class="form-label">TELÉFONO 1</label><input class="form-control" id="cfg-tel" value="${emp.telefono || ''}"></div><div class="form-group"><label class="form-label">TELÉFONO 2</label><input class="form-control" id="cfg-tel2" value="${emp.telefono2 || ''}"></div></div>
        <div class="form-row"><div class="form-group"><label class="form-label">EMAIL</label><input class="form-control" id="cfg-email" value="${emp.email || ''}"></div><div class="form-group"><label class="form-label">PÁGINA WEB</label><input class="form-control" id="cfg-web" value="${emp.web || ''}"></div></div>
        <div class="form-row"><div class="form-group"><label class="form-label">VENDEDORA</label><input class="form-control" id="cfg-vendedora" value="${emp.vendedora || ''}"></div><div class="form-group"><label class="form-label">INSTAGRAM / REDES</label><input class="form-control" id="cfg-social" value="${emp.social || ''}"></div></div>
      </div>
      <div class="card"><div class="card-title">🧾 TEXTOS DEL TICKET</div><div class="form-group"><label class="form-label">MENSAJE ENCABEZADO</label><textarea class="form-control" id="cfg-header" rows="3">${emp.mensajeHeader || ''}</textarea></div><div class="form-group"><label class="form-label">MENSAJE PIE</label><textarea class="form-control" id="cfg-pie" rows="2">${emp.mensajePie || ''}</textarea></div><div class="form-group"><label class="form-label">POLÍTICA DE DATOS</label><textarea class="form-control" id="cfg-datos" rows="2">${emp.politicaDatos || ''}</textarea></div><div class="form-group"><label class="form-label">POLÍTICA CAMBIOS / GARANTÍAS</label><textarea class="form-control" id="cfg-garantias" rows="2">${emp.mensajeGarantias || ''}</textarea></div></div>
      <button class="btn btn-primary" style="width:100%;height:50px;font-size:16px" onclick="guardarConfigCompleta()">💾 Guardar Configuración de Empresa</button>`;
    } else if (tab === 'inventario') {
      const cats = state.cfg_categorias || [];
      const secs = state.cfg_secciones || [];
      el.innerHTML = `<div class="grid-2"><div class="card" style="margin:0"><div class="card-title">📁 SECCIONES WEB<button class="btn btn-xs btn-primary" style="margin-left:auto" onclick="abrirCfgModal('cfg_secciones','Sección',['nombre:text:Nombre'])">+ Nueva</button></div><div class="table-wrap"><table><thead><tr><th>Nombre</th><th></th></tr></thead><tbody>${secs.map((s) => `<tr><td style="font-weight:700">${s.nombre}</td><td><div class="btn-group"><button class="btn btn-xs btn-secondary" onclick="abrirEditarCfgItem('cfg_secciones','Sección',['nombre:text:Nombre'],'${s.id}')">Editar</button><button class="btn btn-xs btn-danger" onclick="eliminarCfgItem('cfg_secciones','${s.id}','inventario')">✕</button></div></td></tr>`).join('') || '<tr><td colspan="2" style="text-align:center;color:var(--text2);padding:12px">Sin secciones</td></tr>'}</tbody></table></div></div><div class="card" style="margin:0"><div class="card-title">🗂️ CATEGORÍAS<button class="btn btn-xs btn-primary" style="margin-left:auto" onclick="abrirCfgModalCat()">+ Nueva</button></div><div class="table-wrap"><table><thead><tr><th>Sección</th><th>Categoría</th><th></th></tr></thead><tbody>${cats.map((c) => `<tr><td style="font-size:11px;color:var(--text2)">${c.seccion}</td><td style="font-weight:700">${c.nombre}</td><td><div class="btn-group"><button class="btn btn-xs btn-secondary" onclick="abrirEditarCfgItem('cfg_categorias','Categoría',['seccion:text:Sección','nombre:text:Nombre'],'${c.id}')">Editar</button><button class="btn btn-xs btn-danger" onclick="eliminarCfgItem('cfg_categorias','${c.id}','inventario')">✕</button></div></td></tr>`).join('') || '<tr><td colspan="3" style="text-align:center;color:var(--text2);padding:12px">Sin categorías</td></tr>'}</tbody></table></div></div></div>`;
    } else if (tab === 'logistica') {
      const trans = state.cfg_transportadoras || [];
      el.innerHTML = `<div class="card"><div class="card-title">🚚 TRANSPORTADORAS<button class="btn btn-xs btn-primary" style="margin-left:auto" onclick="abrirCfgModal('cfg_transportadoras','Transportadora',['nombre:text:Nombre'])">+ Nueva</button></div><div class="table-wrap"><table><thead><tr><th>Nombre</th><th>Activa</th><th></th></tr></thead><tbody>${trans.map((t) => `<tr><td style="font-weight:700">${t.nombre}</td><td><span class="badge ${t.activa !== false ? 'badge-ok' : 'badge-pend'}">${t.activa !== false ? '✓ Activa' : 'Inactiva'}</span></td><td><div class="btn-group"><button class="btn btn-xs btn-secondary" onclick="abrirEditarCfgItem('cfg_transportadoras','Transportadora',['nombre:text:Nombre'],'${t.id}')">Editar</button><button class="btn btn-xs btn-secondary" onclick="toggleCfgActivo('cfg_transportadoras','${t.id}','logistica')">${t.activa !== false ? 'Desactivar' : 'Activar'}</button><button class="btn btn-xs btn-danger" onclick="eliminarCfgItem('cfg_transportadoras','${t.id}','logistica')">✕</button></div></td></tr>`).join('') || '<tr><td colspan="3" style="text-align:center;color:var(--text2);padding:12px">Sin transportadoras</td></tr>'}</tbody></table></div></div><div class="card"><div class="card-title">⏱️ TIEMPOS DE LIQUIDACIÓN</div><div class="form-row"><div class="form-group"><label class="form-label">DÍAS LIQ. LOCAL (hábiles)</label><input type="number" class="form-control" id="cfg-dias-local" value="${state.diasLocal || 1}" min="1"></div><div class="form-group"><label class="form-label">DÍAS LIQ. INTER (hábiles)</label><input type="number" class="form-control" id="cfg-dias-inter" value="${state.diasInter || 5}" min="1"></div></div><button class="btn btn-primary" onclick="guardarDiasLiq()">💾 Guardar Tiempos</button></div>`;
    } else if (tab === 'pagos') {
      const metodos = state.cfg_metodos_pago || [];
      el.innerHTML = `<div class="card"><div class="card-title">💳 MÉTODOS DE PAGO<button class="btn btn-xs btn-primary" style="margin-left:auto" onclick="abrirCfgModal('cfg_metodos_pago','Método de Pago',['nombre:text:Nombre','tipo:text:Tipo (efectivo/digital/banco/tarjeta)'])">+ Nuevo</button></div><div class="table-wrap"><table><thead><tr><th>Nombre</th><th>Tipo</th><th>Estado</th><th></th></tr></thead><tbody>${metodos.map((m) => `<tr><td style="font-weight:700">${m.nombre}</td><td><span class="badge badge-info">${m.tipo || 'otro'}</span></td><td><span class="badge ${m.activo !== false ? 'badge-ok' : 'badge-pend'}">${m.activo !== false ? 'Activo' : 'Inactivo'}</span></td><td><div class="btn-group"><button class="btn btn-xs btn-secondary" onclick="abrirEditarCfgItem('cfg_metodos_pago','Método de Pago',['nombre:text:Nombre','tipo:text:Tipo (efectivo/digital/banco/tarjeta)'],'${m.id}')">Editar</button><button class="btn btn-xs btn-secondary" onclick="toggleCfgActivo('cfg_metodos_pago','${m.id}','pagos')">${m.activo !== false ? 'Desactivar' : 'Activar'}</button><button class="btn btn-xs btn-danger" onclick="eliminarCfgItem('cfg_metodos_pago','${m.id}','pagos')">✕</button></div></td></tr>`).join('') || '<tr><td colspan="4" style="text-align:center;color:var(--text2);padding:12px">Sin métodos</td></tr>'}</tbody></table></div></div>`;
    } else if (tab === 'precios') {
      const tarifas = state.cfg_tarifas || [];
      const impuestos = state.cfg_impuestos || [];
      el.innerHTML = `<div class="card"><div class="card-title">💰 TARIFAS DE PRECIO<button class="btn btn-xs btn-primary" style="margin-left:auto" onclick="abrirCfgModal('cfg_tarifas','Tarifa',['nombre:text:Nombre','porcentaje:number:% Ajuste (negativo=descuento)','descripcion:text:Descripción'])">+ Nueva</button></div><div class="table-wrap"><table><thead><tr><th>Nombre</th><th>% Ajuste</th><th>Descripción</th><th></th></tr></thead><tbody>${tarifas.map((t) => `<tr><td style="font-weight:700">${t.nombre}</td><td style="color:${t.porcentaje > 0 ? 'var(--green)' : t.porcentaje < 0 ? 'var(--red)' : 'var(--text2)'};font-weight:700">${t.porcentaje > 0 ? '+' : ''}${t.porcentaje}%</td><td style="color:var(--text2);font-size:11px">${t.descripcion || '—'}</td><td><div class="btn-group"><button class="btn btn-xs btn-secondary" onclick="abrirEditarCfgItem('cfg_tarifas','Tarifa',['nombre:text:Nombre','porcentaje:number:% Ajuste (negativo=descuento)','descripcion:text:Descripción'],'${t.id}')">Editar</button><button class="btn btn-xs btn-danger" onclick="eliminarCfgItem('cfg_tarifas','${t.id}','precios')">✕</button></div></td></tr>`).join('') || '<tr><td colspan="4" style="text-align:center;color:var(--text2);padding:12px">Sin tarifas</td></tr>'}</tbody></table></div></div><div class="card"><div class="card-title">📊 IMPUESTOS Y RETENCIONES<button class="btn btn-xs btn-primary" style="margin-left:auto" onclick="abrirCfgModal('cfg_impuestos','Impuesto',['nombre:text:Nombre','porcentaje:number:Porcentaje %','tipo:text:Tipo (venta/retencion)'])">+ Nuevo</button></div><div class="table-wrap"><table><thead><tr><th>Nombre</th><th>%</th><th>Tipo</th><th>Estado</th><th></th></tr></thead><tbody>${impuestos.map((i) => `<tr><td style="font-weight:700">${i.nombre}</td><td style="font-weight:700;color:var(--accent)">${i.porcentaje}%</td><td><span class="badge badge-info">${i.tipo || 'venta'}</span></td><td><span class="badge ${i.activo !== false ? 'badge-ok' : 'badge-pend'}">${i.activo !== false ? 'Activo' : 'Inactivo'}</span></td><td><div class="btn-group"><button class="btn btn-xs btn-secondary" onclick="abrirEditarCfgItem('cfg_impuestos','Impuesto',['nombre:text:Nombre','porcentaje:number:Porcentaje %','tipo:text:Tipo (venta/retencion)'],'${i.id}')">Editar</button><button class="btn btn-xs btn-secondary" onclick="toggleCfgActivo('cfg_impuestos','${i.id}','precios')">${i.activo !== false ? 'Desactivar' : 'Activar'}</button><button class="btn btn-xs btn-danger" onclick="eliminarCfgItem('cfg_impuestos','${i.id}','precios')">✕</button></div></td></tr>`).join('') || '<tr><td colspan="5" style="text-align:center;color:var(--text2);padding:12px">Sin impuestos</td></tr>'}</tbody></table></div></div>`;
    } else if (tab === 'nomina') {
      const conceptos = state.nom_conceptos || [];
      el.innerHTML = `<div class="card"><div class="card-title">📝 CONCEPTOS DE NÓMINA<button class="btn btn-xs btn-primary" style="margin-left:auto" onclick="openConceptoModal()">+ Nuevo</button></div><div class="table-wrap"><table><thead><tr><th>Nombre</th><th>Tipo</th><th>Fórmula</th><th>Valor</th><th></th></tr></thead><tbody>${conceptos.map((c) => `<tr><td style="font-weight:700">${c.nombre}</td><td><span class="badge ${c.tipo === 'devengo' ? 'badge-ok' : 'badge-pend'}">${c.tipo}</span></td><td><span class="badge badge-info">${c.formula}</span></td><td style="font-weight:700">${c.formula === 'porcentaje' ? c.valor + '%' : fmt(c.valor)}</td><td><button class="btn btn-xs btn-danger" onclick="eliminarConceptoCfg('${c.id}')">✕</button></td></tr>`).join('')}</tbody></table></div></div><div class="card"><div class="card-title">📅 PARÁMETROS DE NÓMINA</div><div class="form-row"><div class="form-group"><label class="form-label">SMMLV 2026</label><input type="number" class="form-control" id="cfg-smmlv" value="${state.cfg_game?.smmlv || 1750905}"></div><div class="form-group"><label class="form-label">AUX. TRANSPORTE 2026</label><input type="number" class="form-control" id="cfg-auxtrans" value="${state.cfg_game?.aux_trans || 249095}"></div></div><button class="btn btn-primary" onclick="guardarParamsNomina()">💾 Guardar Parámetros</button></div>`;
    } else if (tab === 'bodegas') {
      const bodegas = state.bodegas || [];
      el.innerHTML = `<div class="card"><div class="card-title">🏭 BODEGAS<button class="btn btn-xs btn-primary" style="margin-left:auto" onclick="abrirCfgModal('bodegas','Bodega',['nombre:text:Nombre','ubicacion:text:Ubicación/Descripción'])">+ Nueva</button></div><div class="table-wrap"><table><thead><tr><th>ID</th><th>Nombre</th><th>Ubicación</th><th></th></tr></thead><tbody>${bodegas.map((b) => `<tr><td style="font-size:10px;color:var(--text2)">${b.id}</td><td style="font-weight:700">${b.name || b.nombre || ''}</td><td>${b.ubicacion || '—'}</td><td><div class="btn-group"><button class="btn btn-xs btn-secondary" onclick="abrirEditarCfgItem('bodegas','Bodega',['nombre:text:Nombre','ubicacion:text:Ubicación/Descripción'],'${b.id}')">Editar</button><button class="btn btn-xs btn-danger" onclick="eliminarBodega('${b.id}')">✕</button></div></td></tr>`).join('') || '<tr><td colspan="4" style="text-align:center;color:var(--text2);padding:12px">Sin bodegas</td></tr>'}</tbody></table></div></div>`;
    } else if (tab === 'cajas_pos') {
      const cajas = state.cajas || [];
      const bodegas = state.bodegas || [];
      if (global.AppCajaLogic?.normalizeAllCajas) global.AppCajaLogic.normalizeAllCajas(state);
      el.innerHTML = `<div class="card"><div class="card-title">🏧 CAJAS ↔ BODEGAS (POS)</div>
      <p style="font-size:12px;color:var(--text2);line-height:1.5;margin:0 0 10px">Define aquí la operación por almacén: cada venta POS cae en la caja que esté enlazada a su bodega. Si caja y bodega están en sedes distintas, el sistema separa los saldos por ese enlace operativo.</p>
      <p style="font-size:11px;color:var(--text2);line-height:1.5;margin:0 0 12px">Regla: <b>sin ninguna casilla</b> = la caja atiende <b>todas</b> las bodegas. Varias cajas pueden compartir bodega; una caja puede cubrir varias bodegas.</p>
      <button class="btn btn-sm btn-primary" style="margin-bottom:12px" onclick="openCfgCajaModal()">+ Nueva caja</button>
      ${cajas.length === 0 ? '<p style="color:var(--text2)">No hay cajas creadas.</p>' : cajas.map((c) => {
        const all = !(c.bodegaIds && c.bodegaIds.length);
        return `<div class="card" style="margin-bottom:12px;border-color:rgba(0,229,180,.2)"><div style="font-family:Syne;font-weight:800;margin-bottom:10px">${c.nombre}</div>
        <div style="font-size:10px;color:var(--yellow);margin-bottom:8px">${all ? '✓ Atiende todas las bodegas (lista vacía)' : 'Solo bodegas marcadas:'}</div>
        <div style="display:flex;flex-wrap:wrap;gap:10px">${bodegas.map((b) => {
          const bid = b.id;
          const nm = (b.name || b.nombre || bid).replace(/</g, '');
          const checked = all ? false : (c.bodegaIds || []).includes(bid);
          return `<label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer"><input type="checkbox" class="cfg-caja-bod-cb" data-caja="${c.id}" data-bodega="${bid}" ${checked ? 'checked' : ''}> ${nm}</label>`;
        }).join('') || '<span style="color:var(--text2)">Sin bodegas en catálogo</span>'}</div></div>`;
      }).join('')}
      <button class="btn btn-primary" style="margin-top:12px;width:100%" onclick="guardarCfgCajaBodegas()">💾 Guardar enlaces caja–bodega</button>
      </div>`;
    } else if (tab === 'gamif') {
      const g = state.cfg_game || {};
      el.innerHTML = `<div class="card"><div class="card-title">🎮 CONFIGURACIÓN GAMIFICACIÓN</div><div class="form-row"><div class="form-group"><label class="form-label">META MENSUAL ($)</label><input type="number" class="form-control" id="cfg-meta" value="${state.meta || 34000000}"></div><div class="form-group"><label class="form-label">XP AL LIQUIDAR UN COBRO</label><input type="number" class="form-control" id="cfg-xp-liq" value="${g.xp_liquidar || 20}"></div></div><div class="card-title" style="margin-top:8px">XP POR CANAL</div><div class="form-row-3"><div class="form-group"><label class="form-label">VITRINA (1 XP c/$ de)</label><input type="number" class="form-control" id="cfg-xp-vitrina" value="${g.xp_por_venta_vitrina || 150000}"></div><div class="form-group"><label class="form-label">LOCAL (1 XP c/$ de)</label><input type="number" class="form-control" id="cfg-xp-local" value="${g.xp_por_venta_local || 25000}"></div><div class="form-group"><label class="form-label">INTER (1 XP c/$ de)</label><input type="number" class="form-control" id="cfg-xp-inter" value="${g.xp_por_venta_inter || 20000}"></div></div><button class="btn btn-primary" style="margin-top:8px" onclick="guardarCfgGame()">💾 Guardar Gamificación</button></div>`;
    } else if (tab === 'peligro') {
      el.innerHTML = `<div class="card" style="border-color:rgba(248,113,113,0.3)"><div class="card-title" style="color:var(--red)">⚡ ZONA DE PELIGRO</div><div style="color:var(--text2);font-size:12px;margin-bottom:20px">Estas acciones afectan el estado general del ERP.</div><div class="btn-group"><button class="btn btn-danger btn-sm" onclick="forceMonthReset()">🔄 Archivar Ventas del Mes</button><button class="btn btn-secondary btn-sm" style="color:var(--red)" onclick="location.reload()">🔌 Forzar Recarga</button></div></div>`;
    }
  }

  function abrirCfgModal(ctx) {
    const { collection, titulo, fields } = ctx;
    ctx.openModal(`<div class="modal-title">+ ${titulo}<button class="modal-close" onclick="closeModal()">×</button></div>${fields.map((f) => { const [key, type, label] = f.split(':'); return `<div class="form-group"><label class="form-label">${label}</label><input type="${type === 'number' ? 'number' : 'text'}" class="form-control" id="cfg-field-${key}"></div>`; }).join('')}<button class="btn btn-primary" style="width:100%" onclick="guardarCfgItem('${collection}',${JSON.stringify(fields).replace(/"/g, "'")})">Guardar</button>`);
  }

  function abrirEditarCfgItem(ctx) {
    const { state, collection, titulo, fields, id, openModal, notify } = ctx;
    let flds = fields;
    if (typeof flds === 'string') flds = JSON.parse(flds.replace(/'/g, '"'));
    const list = state[collection] || [];
    const item = list.find((x) => x.id === id);
    if (!item) {
      notify('warning', '⚠️', 'Registro no encontrado', '', { duration: 2500 });
      return;
    }
    const inputs = flds.map((f) => {
      const [key, type, label] = f.split(':');
      const valRaw = item[key] ?? item[key === 'nombre' ? 'name' : key] ?? '';
      const val = String(valRaw).replace(/"/g, '&quot;');
      return `<div class="form-group"><label class="form-label">${label}</label><input type="${type === 'number' ? 'number' : 'text'}" class="form-control" id="cfg-field-${key}" value="${val}"></div>`;
    }).join('');
    openModal(`<div class="modal-title">✏️ Editar ${titulo}<button class="modal-close" onclick="closeModal()">×</button></div>${inputs}<button class="btn btn-primary" style="width:100%" onclick="guardarCfgItem('${collection}',${JSON.stringify(flds).replace(/"/g, "'")},'${id}')">💾 Guardar cambios</button>`);
  }

  function abrirCfgModalCat(ctx) {
    const secs = ctx.state.cfg_secciones || [];
    ctx.openModal(`<div class="modal-title">+ Nueva Categoría<button class="modal-close" onclick="closeModal()">×</button></div><div class="form-group"><label class="form-label">SECCIÓN</label><select class="form-control" id="cfg-field-seccion">${secs.map((s) => `<option value="${s.nombre}">${s.nombre}</option>`).join('')}</select></div><div class="form-group"><label class="form-label">NOMBRE CATEGORÍA</label><input type="text" class="form-control" id="cfg-field-nombre"></div><button class="btn btn-primary" style="width:100%" onclick="guardarCfgItem('cfg_categorias',['seccion:text:Sección','nombre:text:Nombre'])">Guardar</button>`);
  }

  async function guardarCfgItem(ctx) {
    let { fields } = ctx;
    if (typeof fields === 'string') fields = JSON.parse(fields.replace(/'/g, '"'));
    const nextId = typeof ctx.dbId === 'function' ? ctx.dbId : ctx.uid;
    const editId = ctx.editId || null;
    const list = ctx.state[ctx.collection] || [];
    const current = editId ? list.find((x) => x.id === editId) : null;
    const item = current ? { ...current } : { id: nextId() };
    for (const f of fields) {
      const key = f.split(':')[0];
      const type = f.split(':')[1];
      const el = document.getElementById('cfg-field-' + key);
      if (el) item[key] = type === 'number' ? parseFloat(el.value) || 0 : el.value.trim();
    }
    if (ctx.collection === 'bodegas') { item.name = item.nombre; item.activa = true; }
    try {
      if (!ctx.state[ctx.collection]) ctx.state[ctx.collection] = [];
      if (current) {
        const idx = ctx.state[ctx.collection].findIndex((x) => x.id === item.id);
        if (idx >= 0) ctx.state[ctx.collection][idx] = item;
      } else {
        ctx.state[ctx.collection].push(item);
      }
      await ctx.saveRecord(ctx.collection, item.id, item);
      ctx.closeModal();
      ctx.renderCfgTab(global._cfgTab || 'inventario');
      ctx.notify('success', '✅', current ? 'Actualizado' : 'Guardado', `${Object.values(item).filter((v) => typeof v === 'string' && v.length > 0)[0] || ''}`, { duration: 2000 });
    } catch (e) {
      ctx.notify('danger', '⚠️', 'No se pudo guardar', e.message || 'Error inesperado', { duration: 4500 });
    }
  }

  async function eliminarCfgItem(ctx) {
    if (!ctx.confirm('¿Eliminar este registro?')) return;
    try {
      ctx.state[ctx.collection] = (ctx.state[ctx.collection] || []).filter((x) => x.id !== ctx.id);
      await ctx.deleteRecord(ctx.collection, ctx.id);
      ctx.renderCfgTab(ctx.tab);
    } catch (e) {
      ctx.notify?.('danger', '⚠️', 'No se pudo eliminar', e.message || 'Error inesperado', { duration: 4500 });
    }
  }

  async function toggleCfgActivo(ctx) {
    const item = (ctx.state[ctx.collection] || []).find((x) => x.id === ctx.id);
    if (!item) return;
    const field = ctx.collection === 'cfg_transportadoras' ? 'activa' : 'activo';
    const prev = item[field];
    item[field] = !item[field];
    try {
      await ctx.saveRecord(ctx.collection, ctx.id, item);
      ctx.renderCfgTab(ctx.tab);
    } catch (e) {
      item[field] = prev;
      ctx.notify?.('danger', '⚠️', 'No se pudo actualizar', e.message || 'Error inesperado', { duration: 4500 });
    }
  }

  async function eliminarBodega(ctx) {
    if (!ctx.confirm('¿Eliminar esta bodega? Verifica que no tenga inventario activo.')) return;
    const id = ctx.id;
    const b = (ctx.state.bodegas || []).find((x) => x.id === id);
    if (!b) return;

    // No permitimos borrar si hay historial de inventario ligado a esa bodega.
    const hasInvRef = (ctx.state.inv_movimientos || []).some((m) => m.bodegaId === id)
      || (ctx.state.inv_ajustes || []).some((a) => a.bodegaId === id)
      || (ctx.state.inv_traslados || []).some((t) => t.origenId === id || t.destinoId === id);
    if (hasInvRef) {
      ctx.notify(
        'warning',
        '⚠️',
        'Bodega con historial',
        'No se puede eliminar porque tiene movimientos/ajustes/traslados de inventario.',
        { duration: 5000 }
      );
      return;
    }

    // Limpia enlaces caja↔bodega para no dejar ids huérfanos.
    const cajas = ctx.state.cajas || [];
    for (let i = 0; i < cajas.length; i++) {
      const c = cajas[i];
      const ids = Array.isArray(c.bodegaIds) ? c.bodegaIds : [];
      if (ids.includes(id)) {
        c.bodegaIds = ids.filter((x) => x !== id);
        if (global.AppCajaLogic?.normalizeCaja) global.AppCajaLogic.normalizeCaja(c);
        if (typeof ctx.saveRecord === 'function') await ctx.saveRecord('cajas', c.id, c);
      }
    }

    // Ajusta selección de bodega POS por defecto si apuntaba a la eliminada.
    try {
      const currentPosBodega = global.AppCajaLogic?.getPosBodegaId?.();
      if (currentPosBodega === id) {
        const next = (ctx.state.bodegas || []).find((x) => x.id !== id)?.id || 'bodega_main';
        global.AppCajaLogic?.setPosBodegaId?.(next);
      }
    } catch {
      /* ignore localStorage errors */
    }

    ctx.state.bodegas = (ctx.state.bodegas || []).filter((x) => x.id !== id);
    try {
      if (typeof ctx.deleteRecord === 'function') await ctx.deleteRecord('bodegas', id);
      else if (ctx.supabaseClient) await ctx.supabaseClient.from('bodegas').delete().eq('id', id);
      ctx.notify('success', '🗑️', 'Bodega eliminada', b.name || b.nombre || id, { duration: 2500 });
    } catch (e) {
      // Rollback local si falla en DB.
      ctx.state.bodegas.push(b);
      ctx.notify('danger', '⚠️', 'No se pudo eliminar', e.message || 'Error en base de datos', { duration: 5000 });
    }
    ctx.renderCfgTab('bodegas');
  }

  async function guardarDiasLiq(ctx) {
    ctx.state.diasLocal = parseInt(document.getElementById('cfg-dias-local')?.value, 10) || 1;
    ctx.state.diasInter = parseInt(document.getElementById('cfg-dias-inter')?.value, 10) || 5;
    await ctx.saveConfig('diasLocal', ctx.state.diasLocal);
    await ctx.saveConfig('diasInter', ctx.state.diasInter);
    ctx.notify('success', '✅', 'Tiempos guardados', '', { duration: 2000 });
  }

  async function guardarCfgGame(ctx) {
    ctx.state.meta = parseFloat(document.getElementById('cfg-meta')?.value) || 34000000;
    ctx.state.cfg_game = {
      ...ctx.state.cfg_game,
      xp_liquidar: parseInt(document.getElementById('cfg-xp-liq')?.value, 10) || 20,
      xp_por_venta_vitrina: parseInt(document.getElementById('cfg-xp-vitrina')?.value, 10) || 150000,
      xp_por_venta_local: parseInt(document.getElementById('cfg-xp-local')?.value, 10) || 25000,
      xp_por_venta_inter: parseInt(document.getElementById('cfg-xp-inter')?.value, 10) || 20000
    };
    await ctx.saveConfig('meta', ctx.state.meta);
    await ctx.saveConfig('cfg_game', ctx.state.cfg_game);
    ctx.renderDashboard();
    ctx.notify('success', '✅', 'Gamificación guardada', '', { duration: 2000 });
  }

  async function guardarParamsNomina(ctx) {
    ctx.state.cfg_game = {
      ...ctx.state.cfg_game,
      smmlv: parseFloat(document.getElementById('cfg-smmlv')?.value) || 1750905,
      aux_trans: parseFloat(document.getElementById('cfg-auxtrans')?.value) || 249095
    };
    await ctx.saveConfig('cfg_game', ctx.state.cfg_game);
    ctx.notify('success', '✅', 'Parámetros guardados', 'Se aplicarán en el próximo cálculo.', { duration: 3000 });
  }

  function eliminarConceptoCfg(ctx) {
    ctx.deleteFromCollection('nom_conceptos', ctx.id, 'config');
    ctx.renderCfgTab('nomina');
  }

  function procesarLogoConfig(ctx) {
    const file = ctx.input.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = function (e) {
      const img = new Image();
      img.onload = async function () {
        const canvas = document.createElement('canvas');
        const MAX_W = 400;
        const scale = Math.min(1, MAX_W / img.width);
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        const c2d = canvas.getContext('2d');
        c2d.drawImage(img, 0, 0, canvas.width, canvas.height);
        if (!ctx.state.empresa) ctx.state.empresa = {};
        ctx.state.empresa.logoBase64 = canvas.toDataURL('image/png');
        await ctx.saveConfig('empresa', ctx.state.empresa);
        ctx.renderConfig();
        ctx.notify('success', '🖼️', 'Logo cargado', 'Se ajustó automáticamente para 80mm.', { duration: 3000 });
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  async function guardarConfigCompleta(ctx) {
    if (!ctx.state.empresa) ctx.state.empresa = {};
    ctx.state.empresa.nombre = document.getElementById('cfg-nombre')?.value.trim() || ctx.state.empresa.nombre;
    ctx.state.empresa.nombreComercial = document.getElementById('cfg-nombre2')?.value.trim() || '';
    ctx.state.empresa.nit = document.getElementById('cfg-nit')?.value.trim() || '';
    ctx.state.empresa.regimenFiscal = document.getElementById('cfg-regimen')?.value.trim() || '';
    ctx.state.empresa.departamento = document.getElementById('cfg-dpto')?.value.trim() || '';
    ctx.state.empresa.ciudad = document.getElementById('cfg-ciudad')?.value.trim() || '';
    ctx.state.empresa.direccion = document.getElementById('cfg-dir')?.value.trim() || '';
    ctx.state.empresa.telefono = document.getElementById('cfg-tel')?.value.trim() || '';
    ctx.state.empresa.telefono2 = document.getElementById('cfg-tel2')?.value.trim() || '';
    ctx.state.empresa.email = document.getElementById('cfg-email')?.value.trim() || '';
    ctx.state.empresa.web = document.getElementById('cfg-web')?.value.trim() || '';
    ctx.state.empresa.vendedora = document.getElementById('cfg-vendedora')?.value.trim() || '';
    ctx.state.empresa.social = document.getElementById('cfg-social')?.value.trim() || '';
    ctx.state.empresa.mensajeHeader = document.getElementById('cfg-header')?.value.trim() || '';
    ctx.state.empresa.mensajePie = document.getElementById('cfg-pie')?.value.trim() || '';
    ctx.state.empresa.politicaDatos = document.getElementById('cfg-datos')?.value.trim() || '';
    ctx.state.empresa.mensajeGarantias = document.getElementById('cfg-garantias')?.value.trim() || '';
    ctx.state.meta = parseFloat(document.getElementById('cfg-meta')?.value) || 34000000;
    ctx.state.diasLocal = parseInt(document.getElementById('cfg-dias-local')?.value, 10) || 1;
    ctx.state.diasInter = parseInt(document.getElementById('cfg-dias-inter')?.value, 10) || 5;
    await ctx.saveConfig('empresa', ctx.state.empresa);
    await ctx.saveConfig('meta', ctx.state.meta);
    await ctx.saveConfig('diasLocal', ctx.state.diasLocal);
    await ctx.saveConfig('diasInter', ctx.state.diasInter);
    ctx.notify('success', '✅', 'Configuración guardada', 'Los datos se reflejan en el ticket.', { duration: 3000 });
    if (global.AppBackupModule?.afterConfigSaved) {
      global.AppBackupModule.afterConfigSaved(ctx.state);
    }
    ctx.renderConfig();
    ctx.renderDashboard();
  }

  function saveConfigLegacy(ctx) { guardarConfigCompleta(ctx); }

  function forceMonthReset(ctx) {
    if (ctx.confirm('⚠️ ¿Estás seguro? Esto archivará todas las ventas actuales y reiniciará el progreso de la meta mensual. Esta acción no se puede deshacer fácilmente.')) {
      ctx.state.currentMonth = null;
      ctx.checkMonthReset();
      ctx.saveConfig('consecutivos', ctx.state.consecutivos);
      ctx.renderAll();
      ctx.notify('success', '🔄', 'Mes Reseteado', 'Las ventas han sido archivadas correctamente.', { duration: 4000 });
    }
  }

  global.AppConfigModule = {
    renderConfig,
    setCfgTab,
    renderCfgTab,
    abrirCfgModal,
    abrirEditarCfgItem,
    abrirCfgModalCat,
    guardarCfgItem,
    eliminarCfgItem,
    toggleCfgActivo,
    eliminarBodega,
    guardarDiasLiq,
    guardarCfgGame,
    guardarParamsNomina,
    eliminarConceptoCfg,
    procesarLogoConfig,
    guardarConfigCompleta,
    saveConfigLegacy,
    forceMonthReset
  };
})(window);
