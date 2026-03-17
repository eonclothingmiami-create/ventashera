// ===================================================================
// ===== GAMIFICACIÃ“N & JUEGO =====
// ===================================================================

function renderGamePage(){
  const g = state.game || { xp: 0 };
  const lv = calcLevel(g.xp);
  const {next, pct, xpToNext} = calcLevelProgress(g.xp);
  
  document.getElementById('juego-content').innerHTML = `
    <div class="card" style="text-align:center; padding: 48px 20px;">
      <div style="font-size: 80px; animation: bounce 2s infinite alternate;">${lv.avatar}</div>
      <div style="font-family: Syne; font-size: 32px; font-weight: 800; color: var(--accent); margin-top: 16px;">${lv.name}</div>
      <div style="color: var(--text2); margin-bottom: 24px;">Nivel ${lv.level} â€¢ ${g.xp} XP acumulados</div>
      
      ${next ? `
        <div style="background: rgba(255,255,255,0.1); height: 14px; border-radius: 8px; overflow: hidden; max-width: 400px; margin: 0 auto; position: relative;">
          <div style="background: linear-gradient(90deg, var(--accent), var(--accent2)); height: 100%; width: ${pct}%; transition: width 1s ease;"></div>
        </div>
        <div style="font-size: 13px; color: var(--text2); margin-top: 12px; font-weight: 600;">Faltan ${xpToNext} XP para alcanzar el nivel ${next.name}</div>
      ` : '<div style="color: gold; font-weight: 800; font-size: 16px;">Â¡HAS ALCANZADO EL NIVEL MÃXIMO! ðŸ†</div>'}
    </div>
  `;
}

function renderRewards(){
  document.getElementById('recompensas-content').innerHTML = `
    <div class="card">
      <div class="card-title">ðŸ† RECOMPENSAS Y METAS</div>
      <div class="grid-3">
        ${REWARDS.map(r => {
          const isUnlocked = r.condition(state);
          return `
          <div class="card" style="margin:0; text-align:center; transition: all 0.3s; border-color: ${isUnlocked ? 'var(--green)' : 'var(--border)'}; background: ${isUnlocked ? 'rgba(74,222,128,0.05)' : 'var(--card)'}">
            <div style="font-size: 40px; margin-bottom: 12px; filter: ${isUnlocked ? 'none' : 'grayscale(100%) opacity(0.5)'}">${r.icon}</div>
            <div style="font-family: Syne; font-weight: 800; font-size: 14px; color: ${isUnlocked ? 'var(--green)' : 'var(--text)'};">${r.name}</div>
            <div style="font-size: 11px; color: var(--text2); margin-top: 6px; line-height: 1.4;">${r.desc}</div>
            <div style="margin-top: 14px;">
              <span class="badge ${isUnlocked ? 'badge-ok' : 'badge-pend'}">${isUnlocked ? 'Â¡DESBLOQUEADA!' : 'ðŸ”’ En progreso'}</span>
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>
  `;
}

function buildAlerts() {
  const alerts = [];

  // --- Cobros pendientes ---
  const pend = (state.ventas||[]).filter(v => !v.archived && v.canal !== 'vitrina' && !v.liquidado && v.esContraEntrega !== false);
  if(pend.length > 0) alerts.push({
    type: 'warning', icon: 'â³',
    title: `${pend.length} cobro${pend.length>1?'s':''} pendiente${pend.length>1?'s':''}`,
    desc: `Tienes ${fmt(pend.reduce((s,v)=>s+v.valor,0))} por liquidar. Revisa la pestaÃ±a Cobros.`,
    action: "showPage('pendientes')", actionLabel: 'Ver cobros'
  });

  // --- Stock crÃ­tico ---
  const lowStock = (state.articulos||[]).filter(a => getArticuloStock(a.id) <= a.stockMinimo);
  if(lowStock.length > 0) alerts.push({
    type: 'urgent', icon: 'ðŸ“¦',
    title: `Stock crÃ­tico en ${lowStock.length} artÃ­culo${lowStock.length>1?'s':''}`,
    desc: lowStock.slice(0,3).map(a=>`${a.nombre} (${getArticuloStock(a.id)} uds)`).join(' Â· ') + (lowStock.length>3?` y ${lowStock.length-3} mÃ¡s`:''),
    action: "showPage('articulos')", actionLabel: 'Ver inventario'
  });

  // --- Deudas a proveedores (diaria) ---
  const _buildProvList = () => {
    const list = (state.usu_proveedores||[]).map(p => {
      const artCredito = (state.articulos||[]).filter(a => a.tituloMercancia === 'credito' && a.proveedorId === p.id);
      const deudaBruta = artCredito.reduce((s,a) => s + ((a.precioCompra||0)*(a.stock||0)), 0);
      const abonos = (state.tes_abonos_prov||[]).filter(ab=>ab.proveedorId===p.id).reduce((s,ab)=>s+(ab.valor||0),0);
      const saldo = Math.max(0, deudaBruta - abonos);
      const fechas = artCredito.map(a=>a.fechaCompra||a.createdAt||'').filter(Boolean).sort();
      const diasDeuda = fechas.length ? Math.round((new Date()-new Date(fechas[0]))/86400000) : 0;
      return { ...p, saldo, diasDeuda, artCredito };
    }).filter(p => p.saldo > 0);
    // Sin especificar
    const sinProv = (state.articulos||[]).filter(a => a.tituloMercancia==='credito' && (!a.proveedorId||a.proveedorId===''));
    const deudaSin = sinProv.reduce((s,a)=>s+((a.precioCompra||0)*(a.stock||0)),0);
    if(deudaSin > 0) list.push({id:'__sin_proveedor__',nombre:'Sin proveedor',saldo:deudaSin,diasDeuda:0,artCredito:sinProv});
    return list;
  };
  const provConDeuda = _buildProvList();

  const totalDeuda = provConDeuda.reduce((s,p)=>s+p.saldo, 0);

  if(provConDeuda.length > 0) {
    // Alerta general de deuda total
    const urgente = provConDeuda.filter(p => p.diasDeuda >= 30);
    alerts.push({
      type: urgente.length > 0 ? 'urgent' : 'warning',
      icon: 'ðŸ­',
      title: `Deuda con proveedores: ${fmt(totalDeuda)}`,
      desc: provConDeuda.map(p => `${p.nombre}: ${fmt(p.saldo)}${p.diasDeuda>0?' ('+p.diasDeuda+'d)':''}`).join(' Â· '),
      action: "showPage('tes_pagos_prov')", actionLabel: 'Ver pagos proveedores'
    });

    // Alertas individuales por proveedor con +30 dÃ­as
    urgente.forEach(p => {
      alerts.push({
        type: 'urgent', icon: 'âš ï¸',
        title: `${p.nombre} â€” ${p.diasDeuda} dÃ­as sin pagar`,
        desc: `Saldo pendiente: ${fmt(p.saldo)}. Esta deuda lleva mÃ¡s de 30 dÃ­as acumulÃ¡ndose.`,
        action: "showPage('tes_pagos_prov')", actionLabel: 'Abonar ahora'
      });
    });
  }

  return alerts;
}

function renderAlertas(){
  const alertas = buildAlerts();
  const urgentes = alertas.filter(a=>a.type==='urgent').length;
  const warnings = alertas.filter(a=>a.type==='warning').length;

  document.getElementById('alertas-content').innerHTML = `
    ${alertas.length > 0 ? `
    <div class="grid-3" style="margin-bottom:16px">
      <div class="card" style="margin:0;text-align:center;border-color:rgba(248,113,113,.3)">
        <div style="font-family:Syne;font-size:28px;font-weight:800;color:var(--red)">${urgentes}</div>
        <div style="font-size:11px;color:var(--text2)">ðŸš¨ CrÃ­ticas</div>
      </div>
      <div class="card" style="margin:0;text-align:center;border-color:rgba(251,191,36,.3)">
        <div style="font-family:Syne;font-size:28px;font-weight:800;color:var(--yellow)">${warnings}</div>
        <div style="font-size:11px;color:var(--text2)">âš ï¸ Advertencias</div>
      </div>
      <div class="card" style="margin:0;text-align:center">
        <div style="font-family:Syne;font-size:28px;font-weight:800;color:var(--text)">${alertas.length}</div>
        <div style="font-size:11px;color:var(--text2)">ðŸ“‹ Total</div>
      </div>
    </div>` : ''}
    <div class="card">
      <div class="card-title">ðŸ”” CENTRO DE ALERTAS â€” ${today()}</div>
      ${alertas.length === 0 ? `
        <div class="empty-state">
          <div class="es-icon">âœ…</div>
          <div class="es-title" style="color:var(--green)">Todo bajo control</div>
          <div class="es-text">No hay alertas crÃ­ticas en este momento. Â¡Buen trabajo!</div>
        </div>
      ` : alertas.map(a => `
        <div class="urgency-item ${a.type}" style="padding:16px;display:flex;gap:12px;align-items:flex-start;margin-bottom:8px">
          <div style="font-size:26px;flex-shrink:0;margin-top:2px">${a.icon||'ðŸ””'}</div>
          <div style="flex:1">
            <div style="font-family:Syne;font-weight:800;font-size:14px;margin-bottom:4px">${a.title}</div>
            <div style="font-size:12px;color:var(--text2);line-height:1.5">${a.desc}</div>
          </div>
          ${a.action ? `<button class="btn btn-xs ${a.type==='urgent'?'btn-danger':'btn-secondary'}" onclick="${a.action}">${a.actionLabel||'Ver'}</button>` : ''}
        </div>
      `).join('')}
    </div>`;
}

