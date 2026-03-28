// Game + alerts + historial module.
(function initGameSystemModule(global) {
  function renderGamePage(ctx) {
    const { state, calcLevel, calcLevelProgress } = ctx;
    const g = state.game || { xp: 0 };
    const lv = calcLevel(g.xp);
    const { next, pct, xpToNext } = calcLevelProgress(g.xp);
    document.getElementById('juego-content').innerHTML = `
    <div class="card" style="text-align:center; padding: 48px 20px;">
      <div style="font-size: 80px; animation: bounce 2s infinite alternate;">${lv.avatar}</div>
      <div style="font-family: Syne; font-size: 32px; font-weight: 800; color: var(--accent); margin-top: 16px;">${lv.name}</div>
      <div style="color: var(--text2); margin-bottom: 24px;">Nivel ${lv.level} • ${g.xp} XP acumulados</div>
      ${next ? `<div style="background: rgba(255,255,255,0.1); height: 14px; border-radius: 8px; overflow: hidden; max-width: 400px; margin: 0 auto; position: relative;"><div style="background: linear-gradient(90deg, var(--accent), var(--accent2)); height: 100%; width: ${pct}%; transition: width 1s ease;"></div></div><div style="font-size: 13px; color: var(--text2); margin-top: 12px; font-weight: 600;">Faltan ${xpToNext} XP para alcanzar el nivel ${next.name}</div>` : '<div style="color: gold; font-weight: 800; font-size: 16px;">¡HAS ALCANZADO EL NIVEL MÁXIMO! 🏆</div>'}
    </div>`;
  }

  function renderRewards(ctx) {
    const { state, REWARDS } = ctx;
    document.getElementById('recompensas-content').innerHTML = `
    <div class="card"><div class="card-title">🏆 RECOMPENSAS Y METAS</div><div class="grid-3">
      ${REWARDS.map((r) => {
        const isUnlocked = r.condition(state);
        return `<div class="card" style="margin:0; text-align:center; transition: all 0.3s; border-color: ${isUnlocked ? 'var(--green)' : 'var(--border)'}; background: ${isUnlocked ? 'rgba(74,222,128,0.05)' : 'var(--card)'}"><div style="font-size: 40px; margin-bottom: 12px; filter: ${isUnlocked ? 'none' : 'grayscale(100%) opacity(0.5)'}">${r.icon}</div><div style="font-family: Syne; font-weight: 800; font-size: 14px; color: ${isUnlocked ? 'var(--green)' : 'var(--text)'};">${r.name}</div><div style="font-size: 11px; color: var(--text2); margin-top: 6px; line-height: 1.4;">${r.desc}</div><div style="margin-top: 14px;"><span class="badge ${isUnlocked ? 'badge-ok' : 'badge-pend'}">${isUnlocked ? '¡DESBLOQUEADA!' : '🔒 En progreso'}</span></div></div>`;
      }).join('')}
    </div></div>`;
  }

  function buildAlerts(ctx) {
    const { state, fmt, getArticuloStock, ventaCuentaParaTotales } = ctx;
    const cuentaOk = typeof ventaCuentaParaTotales === 'function' ? ventaCuentaParaTotales : (v) => v && !v.archived;
    const alerts = [];
    const pend = (state.ventas || []).filter((v) => cuentaOk(v) && v.canal !== 'vitrina' && !v.liquidado);
    if (pend.length > 0) alerts.push({ type: 'warning', icon: '⏳', title: `${pend.length} venta${pend.length > 1 ? 's' : ''} sin liquidar (seguimiento)`, desc: `Total lista: ${fmt(pend.reduce((s, v) => s + v.valor, 0))}. El ingreso en caja ya quedó el día de la venta; liquidar solo cierra el pendiente sin duplicar ingreso.`, action: "showPage('pendientes')", actionLabel: 'Ir a Cobros' });
    const lowStock = (state.articulos || []).filter((a) => getArticuloStock(a.id) <= a.stockMinimo);
    if (lowStock.length > 0) alerts.push({ type: 'urgent', icon: '📦', title: `Stock crítico en ${lowStock.length} artículo${lowStock.length > 1 ? 's' : ''}`, desc: lowStock.slice(0, 3).map((a) => `${a.nombre} (${getArticuloStock(a.id)} uds)`).join(' · ') + (lowStock.length > 3 ? ` y ${lowStock.length - 3} más` : ''), action: "showPage('articulos')", actionLabel: 'Ver inventario' });
    return alerts;
  }

  function renderAlertas(ctx) {
    const { today } = ctx;
    // Tras core.js: `buildAlerts` global compone game + tesorería; usarlo si existe para mismo criterio que badge.
    const alertas =
      typeof global.buildAlerts === 'function' ? global.buildAlerts() : buildAlerts(ctx);
    const urgentes = alertas.filter((a) => a.type === 'urgent').length;
    const warnings = alertas.filter((a) => a.type === 'warning').length;
    document.getElementById('alertas-content').innerHTML = `
    ${alertas.length > 0 ? `<div class="grid-3" style="margin-bottom:16px"><div class="card" style="margin:0;text-align:center;border-color:rgba(248,113,113,.3)"><div style="font-family:Syne;font-size:28px;font-weight:800;color:var(--red)">${urgentes}</div><div style="font-size:11px;color:var(--text2)">🚨 Críticas</div></div><div class="card" style="margin:0;text-align:center;border-color:rgba(251,191,36,.3)"><div style="font-family:Syne;font-size:28px;font-weight:800;color:var(--yellow)">${warnings}</div><div style="font-size:11px;color:var(--text2)">⚠️ Advertencias</div></div><div class="card" style="margin:0;text-align:center"><div style="font-family:Syne;font-size:28px;font-weight:800;color:var(--text)">${alertas.length}</div><div style="font-size:11px;color:var(--text2)">📋 Total</div></div></div>` : ''}
    <div class="card"><div class="card-title">🔔 CENTRO DE ALERTAS — ${today()}</div>
    ${alertas.length === 0 ? `<div class="empty-state"><div class="es-icon">✅</div><div class="es-title" style="color:var(--green)">Todo bajo control</div><div class="es-text">No hay alertas críticas en este momento. ¡Buen trabajo!</div></div>` : alertas.map((a) => `<div class="urgency-item ${a.type}" style="padding:16px;display:flex;gap:12px;align-items:flex-start;margin-bottom:8px"><div style="font-size:26px;flex-shrink:0;margin-top:2px">${a.icon || '🔔'}</div><div style="flex:1"><div style="font-family:Syne;font-weight:800;font-size:14px;margin-bottom:4px">${a.title}</div><div style="font-size:12px;color:var(--text2);line-height:1.5">${a.desc}</div></div>${a.action ? `<button class="btn btn-xs ${a.type === 'urgent' ? 'btn-danger' : 'btn-secondary'}" onclick="${a.action}">${a.actionLabel || 'Ver'}</button>` : ''}</div>`).join('')}
    </div>`;
  }

  function renderHistorial(ctx) {
    const { state, formatDate, fmt, today, yearMonthFromFecha, sortVentasRecientes, ventasEnMesCalendario, ventaCuentaParaTotales } = ctx;
    const cuentaOk = typeof ventaCuentaParaTotales === 'function' ? ventaCuentaParaTotales : (v) => v && !v.archived;
    const q = (document.getElementById('hist-search')?.value || '').toLowerCase();
    const scope = document.getElementById('hist-scope')?.value || 'mes';
    const hoy = today();
    const ym = yearMonthFromFecha(hoy);
    let ventas = state.ventas || [];
    if (scope === 'hoy') ventas = ventas.filter((v) => v.fecha === hoy);
    else if (scope === 'mes') ventas = (state.ventas || []).filter((v) => !v.archived && yearMonthFromFecha(v.fecha) === ym);
    else ventas = [...ventas];
    if (q) {
      ventas = ventas.filter(
        (v) =>
          (v.desc || '').toLowerCase().includes(q) ||
          (v.cliente || '').toLowerCase().includes(q) ||
          (v.guia || '').toLowerCase().includes(q)
      );
    }
    ventas = sortVentasRecientes(ventas);
    const hoyResumen = (state.ventas || []).filter((v) => v.fecha === hoy);
    const mesList = ventasEnMesCalendario(state.ventas, ym);
    const sumArr = (arr) => arr.reduce((a, v) => a + (parseFloat(v.valor) || 0), 0);
    const sumArrActivas = (arr) => arr.filter(cuentaOk).reduce((a, v) => a + (parseFloat(v.valor) || 0), 0);
    const row = (v) => {
      const fac = (state.facturas || []).find((f) => String(f.id) === String(v.id));
      const anulada = fac && fac.estado === 'anulada';
      const puedeAnular = fac && fac.tipo === 'pos' && !anulada;
      const idEsc = String(v.id || '').replace(/'/g, "\\'");
      return `<tr style="${v.archived ? 'opacity:0.6;' : ''}${anulada ? 'opacity:0.75;' : ''}"><td>${formatDate(v.fecha)}</td><td><span class="badge badge-${v.canal}">${v.canal}</span>${v.canal !== 'vitrina' ? `<span class="badge ${v.esContraEntrega ? 'badge-warn' : 'badge-ok'}" style="margin-left:4px;font-size:9px">${v.esContraEntrega ? '📦CE' : '💵CD'}</span>` : ''}</td><td style="font-weight:bold;">${v.desc || '—'}</td><td>${v.cliente || '—'}</td><td style="color:var(--accent);font-weight:700;">${fmt(v.valor)}</td><td><span class="badge ${v.liquidado ? 'badge-ok' : 'badge-pend'}">${v.liquidado ? 'Liquidado' : 'Pendiente'}</span>${anulada ? `<span class="badge badge-warn" style="margin-left:4px">Anulada</span>` : ''}${puedeAnular ? `<button type="button" class="btn btn-xs btn-danger" style="margin-left:6px" onclick="anularVentaPOSConfirm('${idEsc}')">Anular</button>` : ''}</td></tr>`;
    };
    let rowsHtml = '';
    if (scope === 'todas' || scope === 'mes') {
      let lastF = null;
      for (const v of ventas) {
        if (v.fecha !== lastF) {
          lastF = v.fecha;
          const sameDay = ventas.filter((x) => x.fecha === lastF);
          const sub = sumArr(sameDay);
          rowsHtml += `<tr><td colspan="6" style="background:rgba(0,229,180,.07);font-weight:700;font-size:11px;padding:8px 10px;border-top:1px solid var(--border)">📅 ${formatDate(lastF)} · ${sameDay.length} factura(s) · ${fmt(sub)}${sameDay.some((x) => x.archived) ? ' · incl. archivo' : ''}</td></tr>`;
        }
        rowsHtml += row(v);
      }
    } else {
      rowsHtml = ventas.map((v) => row(v)).join('');
    }
    if (!rowsHtml) rowsHtml = '<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--text2)">Sin registros</td></tr>';
    if (document.getElementById('hist-tbody')) {
      document.getElementById('hist-tbody').innerHTML = rowsHtml;
      const cnt = document.getElementById('hist-count');
      if (cnt) cnt.textContent = String(ventas.length);
      const subEl = document.getElementById('hist-sub');
      if (subEl) subEl.textContent = `${hoyResumen.filter(cuentaOk).length} hoy · ${fmt(sumArrActivas(hoyResumen))} | Mes ${ym}: ${mesList.length} fact. · ${fmt(sumArrActivas(mesList))} | En vista: ${ventas.length}`;
      return;
    }
    document.getElementById('historial-content').innerHTML = `<div style="display:flex;gap:12px;margin-bottom:12px;flex-wrap:wrap;align-items:flex-end"><div class="search-bar" style="flex:1;min-width:200px;max-width:360px;margin:0;"><span class="search-icon">🔍</span><input type="text" id="hist-search" placeholder="# factura, cliente, guía..." value="${q}" oninput="renderHistorial()"></div><div><label class="form-label" style="font-size:10px;color:var(--text2);display:block;margin-bottom:4px">Ámbito</label><select class="form-control" id="hist-scope" style="min-width:180px" onchange="renderHistorial()"><option value="hoy" ${scope === 'hoy' ? 'selected' : ''}>Solo hoy</option><option value="mes" ${scope === 'mes' ? 'selected' : ''}>Mes calendario (${ym})</option><option value="todas" ${scope === 'todas' ? 'selected' : ''}>Todas (incl. archivo)</option></select></div></div><div class="card" style="margin-bottom:12px;padding:12px;font-size:12px;color:var(--text2)"><b>Venta POS = factura</b> (referencia = # doc). Resumen: <span id="hist-sub">${hoyResumen.filter(cuentaOk).length} hoy · ${fmt(sumArrActivas(hoyResumen))} | Mes ${ym}: ${mesList.length} fact. · ${fmt(sumArrActivas(mesList))} | En vista: ${ventas.length}</span></div><div class="card"><div class="card-title">HISTORIAL DE FACTURAS (<span id="hist-count">${ventas.length}</span> en vista)</div><div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Canal</th><th>Factura</th><th>Cliente</th><th>Total</th><th>Estado</th></tr></thead><tbody id="hist-tbody">${rowsHtml}</tbody></table></div></div>`;
  }

  global.AppGameSystemModule = {
    renderGamePage,
    renderRewards,
    buildAlerts,
    renderAlertas,
    renderHistorial
  };
})(window);
