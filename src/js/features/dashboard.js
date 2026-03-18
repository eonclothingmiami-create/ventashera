// ===================================================================
// ===== DASHBOARD =====
// ===================================================================
function renderDashboard(){
  const vm=ventasMes(state);
  const pct=Math.min(100,(vm.totalCOP/state.meta)*100);
  const g=state.game||{};
  const lv=calcLevel(g.xp||0);
  const{lv:lvp,next:nextLv,pct:xpPct,xpToNext}=calcLevelProgress(g.xp||0);
  const streak=calcStreak();
  const hoy=today();
  const ventasHoy=(state.ventas||[]).filter(v=>!v.archived&&v.fecha===hoy&&v.canal!=='vitrina');
  const pendientes=(state.ventas||[]).filter(v=>!v.archived&&v.canal!=='vitrina'&&!v.liquidado).length;
  const totalArticulos=(state.articulos||[]).length;
  const lowStockItems=(state.articulos||[]).filter(a=>{const stock=getArticuloStock(a.id);return stock<=a.stockMinimo}).length;
  const cajaSaldo=(state.cajas||[]).reduce((a,c)=>a+c.saldo,0);
  const earnedBadges=(g.earnedBadges||[]);
  const ultimasVentas=[...(state.ventas||[])].filter(v=>!v.archived).reverse().slice(0,5);

  const despachoHoy=ventasHoy.length;
  const missions=[
    {id:'m1',icon:'âš”ï¸',label:'5 despachos hoy',cur:Math.min(5,despachoHoy),max:5,xp:50},
    {id:'m2',icon:'ðŸ›¡ï¸',label:'Meta 25% mes',cur:Math.min(100,Math.round(pct)),max:100,xp:100,pctTarget:25,done:pct>=25},
    {id:'m3',icon:'ðŸ”¥',label:'Racha '+streak+' dÃ­as',cur:Math.min(7,streak),max:7,xp:75},
    {id:'m4',icon:'ðŸ’°',label:'Venta > $300k',cur:(state.ventas||[]).filter(v=>!v.archived&&v.fecha===hoy&&v.valor>=300000).length>0?1:0,max:1,xp:60},
  ];

  document.getElementById('dashboard-content').innerHTML=`
  <style>
    .rpg-header{background:linear-gradient(135deg,rgba(0,229,180,.07) 0%,rgba(0,196,255,.04) 50%,rgba(167,139,250,.07) 100%);border:1px solid rgba(0,229,180,.15);border-radius:20px;padding:20px;margin-bottom:16px;position:relative;overflow:hidden}
    .rpg-header::before{content:'';position:absolute;top:-40px;right:-40px;width:180px;height:180px;background:radial-gradient(circle,rgba(0,229,180,.12) 0%,transparent 70%);pointer-events:none}
    .rpg-avatar{font-size:52px;filter:drop-shadow(0 0 16px rgba(0,229,180,.5));animation:float 3s ease-in-out infinite}
    @keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
    .xp-bar-wrap{background:rgba(255,255,255,.06);border-radius:20px;height:10px;overflow:hidden;margin:6px 0}
    .xp-bar-fill{height:100%;border-radius:20px;background:linear-gradient(90deg,#00e5b4,#00c4ff);transition:width 1s ease;box-shadow:0 0 10px rgba(0,229,180,.6)}
    .meta-bar-wrap{background:rgba(255,255,255,.06);border-radius:20px;height:14px;overflow:hidden;margin:8px 0;position:relative}
    .meta-bar-fill{height:100%;border-radius:20px;transition:width 1.2s ease;position:relative}
    .meta-bar-fill::after{content:'';position:absolute;top:0;left:0;right:0;bottom:0;background:linear-gradient(90deg,transparent,rgba(255,255,255,.2),transparent);animation:shimmer 2s infinite}
    @keyframes shimmer{0%{transform:translateX(-100%)}100%{transform:translateX(100%)}}
    .rpg-stat{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:14px;padding:14px;text-align:center;cursor:default;transition:all .2s}
    .rpg-stat:hover{background:rgba(0,229,180,.06);border-color:rgba(0,229,180,.2);transform:translateY(-2px)}
    .rpg-stat-val{font-family:Syne;font-size:26px;font-weight:800;line-height:1}
    .rpg-stat-label{font-size:10px;color:var(--text2);margin-top:4px;text-transform:uppercase;letter-spacing:.5px}
    .mission-card{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:14px;padding:14px;display:flex;align-items:center;gap:12px;transition:all .2s}
    .mission-card.done{background:rgba(0,229,180,.06);border-color:rgba(0,229,180,.25)}
    .mission-bar{background:rgba(255,255,255,.06);border-radius:10px;height:6px;flex:1;overflow:hidden}
    .mission-bar-fill{height:100%;border-radius:10px;background:linear-gradient(90deg,#00e5b4,#00c4ff);transition:width .8s ease}
    .badge-rpg{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:12px;padding:10px 8px;text-align:center;transition:all .2s}
    .badge-rpg.earned{background:rgba(0,229,180,.08);border-color:rgba(0,229,180,.3);box-shadow:0 0 12px rgba(0,229,180,.1)}
    .badge-rpg:not(.earned){opacity:.35;filter:grayscale(1)}
    .quick-rpg{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:14px 10px;text-align:center;cursor:pointer;transition:all .2s;flex:1}
    .quick-rpg:hover{background:rgba(0,229,180,.08);border-color:rgba(0,229,180,.3);transform:translateY(-3px);box-shadow:0 8px 24px rgba(0,229,180,.15)}
    .quick-rpg-icon{font-size:26px;margin-bottom:6px}
    .quick-rpg-label{font-size:10px;font-family:Syne;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.5px}
    .pend-glow{box-shadow:0 0 20px rgba(255,80,80,.2)}
  </style>

  <div style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap">
    <div class="quick-rpg" onclick="showPage('pos')"><div class="quick-rpg-icon">âš”ï¸</div><div class="quick-rpg-label">Nueva Venta</div></div>
    <div class="quick-rpg" onclick="showPage('facturas')"><div class="quick-rpg-icon">ðŸ“œ</div><div class="quick-rpg-label">Factura</div></div>
    <div class="quick-rpg" onclick="showPage('articulos')"><div class="quick-rpg-icon">ðŸ—¡ï¸</div><div class="quick-rpg-label">CatÃ¡logo</div></div>
    <div class="quick-rpg" onclick="showPage('tes_cajas')"><div class="quick-rpg-icon">ðŸ’°</div><div class="quick-rpg-label">Cajas</div></div>
    <div class="quick-rpg" onclick="showPage('nom_nominas')"><div class="quick-rpg-icon">ðŸ‘¥</div><div class="quick-rpg-label">NÃ³mina</div></div>
  </div>

  <div style="display:grid;grid-template-columns:1fr 280px;gap:16px;margin-bottom:16px">
    <div class="rpg-header">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px">
        <div>
          <div style="font-size:10px;color:var(--text2);letter-spacing:1px;text-transform:uppercase;margin-bottom:4px">âš”ï¸ MisiÃ³n del Mes</div>
          <div style="font-family:Syne;font-size:22px;font-weight:800">${fmt(vm.totalCOP)} <span style="font-size:13px;color:var(--text2);font-weight:400">de ${fmt(state.meta)}</span></div>
        </div>
        <div style="text-align:right">
          <div style="font-family:Syne;font-size:36px;font-weight:800;color:${pct>=100?'#ffd700':pct>=75?'#00e5b4':pct>=50?'#00c4ff':'var(--text)'};text-shadow:${pct>=100?'0 0 20px rgba(255,215,0,.6)':'none'}">${Math.round(pct)}%</div>
          <div style="font-size:10px;color:var(--text2)">${pct>=100?'ðŸ† Â¡META LOGRADA!':pct>=75?'ðŸ”¥ Â¡Casi!':pct>=50?'âš¡ Mitad del camino':'ðŸ’ª Sigue adelante'}</div>
        </div>
      </div>
      <div class="meta-bar-wrap">
        <div class="meta-bar-fill" style="width:${pct}%;background:linear-gradient(90deg,${pct>=100?'#ffd700,#ffaa00':pct>=75?'#00e5b4,#00c4ff':'#a78bfa,#00c4ff'})"></div>
      </div>
      <div style="display:flex;justify-content:space-between;margin-top:8px">
        ${[25,50,75,100].map(t=>`<div style="font-size:10px;color:${pct>=t?'var(--accent)':'var(--text2)'};font-weight:${pct>=t?'700':'400'}">${pct>=t?'âœ“ ':''}${t}%</div>`).join('')}
      </div>
      <div style="font-size:11px;color:var(--text2);margin-top:8px">Total con vitrina: ${fmt(vm.totalAll)} Â· HOY: ${ventasHoy.length} despachos Â· ${fmt(ventasHoy.reduce((a,v)=>a+v.valor,0))}</div>
    </div>

    <div style="display:flex;flex-direction:column;gap:10px">
      <div class="rpg-header" style="padding:16px;flex:1">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">
          <div class="rpg-avatar">${lv.avatar}</div>
          <div>
            <div style="font-family:Syne;font-size:16px;font-weight:800;color:var(--accent)">${lv.name}</div>
            <div style="font-size:11px;color:var(--text2)">Nivel ${lv.level} Â· ${g.xp||0} XP</div>
            <div style="font-size:11px;color:#ffd700;margin-top:2px">${streak>0?'ðŸ”¥ Racha '+streak+' dÃ­as':'Sin racha activa'}</div>
          </div>
        </div>
        ${nextLv?`<div style="font-size:10px;color:var(--text2);margin-bottom:4px">â†’ ${nextLv.avatar} ${nextLv.name} Â· faltan ${xpToNext} XP</div><div class="xp-bar-wrap"><div class="xp-bar-fill" style="width:${xpPct}%"></div></div>`:`<div style="font-size:11px;color:#ffd700;text-align:center;padding:4px">ðŸ† Â¡Nivel MÃ¡ximo!</div>`}
      </div>
      <div class="rpg-header ${pendientes>0?'pend-glow':''}" style="padding:12px;text-align:center;cursor:pointer" onclick="showPage('pendientes')">
        <div style="font-family:Syne;font-size:28px;font-weight:800;color:${pendientes>0?'var(--red)':'var(--green)'}">${pendientes}</div>
        <div style="font-size:10px;color:var(--text2);text-transform:uppercase;letter-spacing:.5px">${pendientes>0?'âš ï¸ Cobros Pendientes':'âœ… Todo al dÃ­a'}</div>
      </div>
    </div>
  </div>

  <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:16px">
    <div class="rpg-stat"><div class="rpg-stat-val" style="color:var(--accent2)">${vm.totalDespachos}</div><div class="rpg-stat-label">ðŸ“¦ Despachos</div></div>
    <div class="rpg-stat"><div class="rpg-stat-val" style="color:#a78bfa">${vm.vitrina.length}</div><div class="rpg-stat-label">ðŸª Vitrina</div><div style="font-size:10px;color:var(--text2);margin-top:2px">${fmt(vm.vitrineTotal)}</div></div>
    <div class="rpg-stat"><div class="rpg-stat-val" style="color:var(--yellow)">${vm.local.length}</div><div class="rpg-stat-label">ðŸ›µ Local</div><div style="font-size:10px;color:var(--text2);margin-top:2px">${fmt(vm.localTotal)}</div></div>
    <div class="rpg-stat"><div class="rpg-stat-val" style="color:var(--accent)">${vm.inter.length}</div><div class="rpg-stat-label">ðŸ“¦ Inter</div><div style="font-size:10px;color:var(--text2);margin-top:2px">${fmt(vm.interTotal)}</div></div>
    <div class="rpg-stat" onclick="showPage('articulos')" style="cursor:pointer"><div class="rpg-stat-val" style="color:var(--orange)">${totalArticulos}</div><div class="rpg-stat-label">ðŸ—¡ï¸ ArtÃ­culos</div><div style="font-size:10px;color:${lowStockItems>0?'var(--red)':'var(--green)'};margin-top:2px">${lowStockItems>0?'âš ï¸ '+lowStockItems+' bajo stock':'âœ“ Stock OK'}</div></div>
  </div>

  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
    <div class="card" style="margin:0">
      <div class="card-title">âš”ï¸ MISIONES DEL DÃA</div>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${missions.map(m=>{
          const done=m.id==='m2'?pct>=m.pctTarget:m.cur>=m.max;
          const mpct=m.id==='m2'?Math.min(100,pct):Math.min(100,(m.cur/m.max)*100);
          return `<div class="mission-card ${done?'done':''}">
            <div style="font-size:22px">${m.icon}</div>
            <div style="flex:1">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
                <span style="font-size:12px;font-weight:600">${m.label}</span>
                <span style="font-size:10px;color:${done?'var(--accent)':'var(--text2)'}">${done?'âœ… +'+m.xp+'XP':m.cur+'/'+m.max}</span>
              </div>
              <div class="mission-bar"><div class="mission-bar-fill" style="width:${mpct}%;background:${done?'linear-gradient(90deg,#ffd700,#ffaa00)':'linear-gradient(90deg,#00e5b4,#00c4ff)'}"></div></div>
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>
    <div style="display:flex;flex-direction:column;gap:10px">
      <div class="card" style="margin:0;flex:1">
        <div class="card-title">ðŸ’° TESORO (CAJA)</div>
        <div style="font-family:Syne;font-size:28px;font-weight:800;color:var(--accent)">${fmt(cajaSaldo)}</div>
        <div style="font-size:11px;color:var(--text2);margin-top:4px">${(state.cajas||[]).filter(c=>c.estado==='abierta').length} caja(s) abiertas</div>
      </div>
      <div class="card" style="margin:0;flex:1">
        <div class="card-title">ðŸ—“ï¸ HOY Â· ${formatDate(hoy)}</div>
        <div style="font-family:Syne;font-size:28px;font-weight:800;color:var(--text)">${ventasHoy.length}</div>
        <div style="font-size:11px;color:var(--text2);margin-top:4px">despachos Â· ${fmt(ventasHoy.reduce((a,v)=>a+v.valor,0))}</div>
      </div>
    </div>
  </div>

  <div class="card" style="margin-bottom:16px">
    <div class="card-title">ðŸ… INSIGNIAS â€” ${earnedBadges.length}/${BADGES.length} desbloqueadas</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(88px,1fr));gap:8px">
      ${BADGES.map(b=>{
        const earned=earnedBadges.includes(b.id);
        return `<div class="badge-rpg ${earned?'earned':''}" title="${b.desc}">
          <div style="font-size:22px;margin-bottom:4px">${b.icon}</div>
          <div style="font-size:9px;font-family:Syne;font-weight:700;color:${earned?'var(--accent)':'var(--text2)'};line-height:1.2">${b.name}</div>
          ${earned?'<div style="font-size:9px;color:var(--accent);margin-top:2px">âœ“</div>':'<div style="font-size:9px;color:var(--text2);margin-top:2px">ðŸ”’</div>'}
        </div>`;
      }).join('')}
    </div>
  </div>

  <div class="card">
    <div class="card-title">âš¡ ÃšLTIMAS 5 BATALLAS (VENTAS)</div>
    <div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Canal</th><th>Valor</th><th>GuÃ­a</th><th>Estado</th></tr></thead><tbody>
    ${ultimasVentas.map(v=>`<tr>
      <td>${formatDate(v.fecha)}</td>
      <td><span class="badge badge-${v.canal}">${v.canal==='vitrina'?'ðŸª':v.canal==='local'?'ðŸ›µ':'ðŸ“¦'} ${v.canal}</span></td>
      <td style="color:var(--accent);font-weight:600">${fmt(v.valor)}</td>
      <td>${v.guia||'â€”'}</td>
      <td><span class="badge ${v.liquidado?'badge-ok':'badge-pend'}">${v.liquidado?'âœ“ Liq':'â³ Pend'}</span></td>
    </tr>`).join('')||'<tr><td colspan="5" style="text-align:center;color:var(--text2);padding:24px">Sin ventas</td></tr>'}
    </tbody></table></div>
  </div>`;
}

// ===================================================================
