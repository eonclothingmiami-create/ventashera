// ============================================================================
// CXP Proveedores — panel ejecutivo de Cuentas por Pagar (SOLO LECTURA).
//
// Consume EXCLUSIVAMENTE las vistas Postgres:
//   - v_cxp_proveedores_resumen  (listado)
//   - v_cxp_kpis                 (cabecera KPI — 1 consulta)
//   - v_cxp_aging_cargos         (detalle drawer, bajo demanda)
// NO recalcula saldos ni aging en el cliente. NO consulta tablas base.
//
// Bridge: core.js -> window.AppCxpProveedoresModule.renderCxpProveedores(ctx)
// ============================================================================
(function initCxpProveedores(global) {
  'use strict';

  let _ctx = null;
  let _rows = [];
  let _kpis = null;
  let _loading = false;
  let _error = null;

  const filters = { q: '', estado: '__all__', bucket: '__all__', ciudad: '__all__', sort: 'saldo_desc' };

  const _cop = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
  const fmtCOP = (n) => _cop.format(Number(n) || 0);
  const fmtNum = (n) => new Intl.NumberFormat('es-CO').format(Number(n) || 0);
  const num = (v) => Number(v) || 0;
  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]),
    );

  function fmtFecha(ymd) {
    if (!ymd) return '—';
    try {
      const d = new Date(String(ymd).length <= 10 ? String(ymd) + 'T00:00:00' : ymd);
      if (isNaN(d.getTime())) return String(ymd);
      return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch (e) {
      return String(ymd);
    }
  }
  function relDias(dias) {
    if (dias == null || dias === '') return '—';
    const d = Number(dias);
    if (isNaN(d)) return '—';
    if (d <= 0) return 'hoy';
    if (d === 1) return 'hace 1 día';
    return `hace ${fmtNum(d)} días`;
  }

  function sb() {
    return (
      (_ctx && _ctx.supabaseClient) ||
      global.supabaseClient ||
      (global.AppRepository && global.AppRepository.supabaseClient) ||
      null
    );
  }

  function notifyMsg(type, icon, title, desc) {
    if (typeof global.notify === 'function') {
      try {
        global.notify(type, icon, title, desc, { duration: 4500 });
        return true;
      } catch (e) {
        /* noop */
      }
    }
    return false;
  }

  function normRow(r) {
    return {
      id: r.proveedor_id,
      nombre: r.nombre || '(sin nombre)',
      banco: r.banco || '',
      cuenta: r.cuenta_bancaria || '',
      ciudad: r.ciudad || '',
      whatsapp: r.whatsapp || '',
      celular: r.celular || '',
      contacto: r.contacto || '',
      email: r.email || '',
      saldo: num(r.saldo),
      totalCargos: num(r.total_cargos),
      totalDevoluciones: num(r.total_devoluciones),
      totalAbonado: num(r.total_abonado),
      totalNotas: num(r.total_notas_credito),
      nCargos: num(r.n_cargos),
      nCargosAbiertos: num(r.n_cargos_abiertos),
      nAbonos: num(r.n_abonos),
      primerCargo: r.primer_cargo,
      ultCargo: r.ultimo_cargo,
      ultAbono: r.ultimo_abono,
      diasUltCargo: r.dias_desde_ultimo_cargo,
      diasUltAbono: r.dias_desde_ultimo_abono,
      antiguedad: num(r.antiguedad_deuda_dias),
      a0: num(r.saldo_0_30),
      a31: num(r.saldo_31_60),
      a61: num(r.saldo_61_90),
      a90: num(r.saldo_90_mas),
      creditosSinAplicar: num(r.creditos_sin_aplicar),
      metodoFreq: r.metodo_frecuente || '',
      dso: r.dso_dias == null ? null : num(r.dso_dias),
      estadoRelacion: r.estado_relacion || 'al_dia',
      riesgo: r.riesgo || 'sano',
    };
  }

  function normKpis(k) {
    if (!k) {
      return { cxpTotal: 0, conDeuda: 0, alDia: 0, aFavor: 0, a0: 0, a31: 0, a61: 0, a90: 0, abonosMes: 0 };
    }
    return {
      cxpTotal: num(k.cxp_total),
      conDeuda: num(k.proveedores_con_deuda),
      alDia: num(k.proveedores_al_dia),
      aFavor: num(k.proveedores_a_favor),
      a0: num(k.aging_0_30),
      a31: num(k.aging_31_60),
      a61: num(k.aging_61_90),
      a90: num(k.aging_90_mas),
      abonosMes: num(k.abonos_mes),
    };
  }

  async function loadAll() {
    const client = sb();
    if (!client) throw new Error('Supabase no disponible (recarga la página).');
    const [resRes, kpiRes] = await Promise.all([
      client.from('v_cxp_proveedores_resumen').select('*').order('saldo', { ascending: false }),
      client.from('v_cxp_kpis').select('*').maybeSingle(),
    ]);
    if (resRes.error) throw resRes.error;
    if (kpiRes.error) throw kpiRes.error;
    _rows = (resRes.data || []).map(normRow);
    _kpis = normKpis(kpiRes.data);
  }

  function visibleRows() {
    let rows = _rows.slice();
    const q = filters.q.trim().toLowerCase();
    if (q) rows = rows.filter((r) => (r.nombre + ' ' + r.ciudad + ' ' + r.whatsapp).toLowerCase().includes(q));
    if (filters.estado === 'deuda') rows = rows.filter((r) => r.estadoRelacion === 'con_deuda');
    else if (filters.estado === 'aldia') rows = rows.filter((r) => r.estadoRelacion === 'al_dia');
    else if (filters.estado === 'favor') rows = rows.filter((r) => r.estadoRelacion === 'a_favor');
    if (filters.bucket !== '__all__') {
      const k = { '0-30': 'a0', '31-60': 'a31', '61-90': 'a61', '90+': 'a90' }[filters.bucket];
      rows = rows.filter((r) => r[k] > 0);
    }
    if (filters.ciudad !== '__all__') rows = rows.filter((r) => (r.ciudad || '').trim() === filters.ciudad);

    const cmp = {
      saldo_desc: (a, b) => b.saldo - a.saldo,
      saldo_asc: (a, b) => a.saldo - b.saldo,
      antiguedad_desc: (a, b) => num(b.antiguedad) - num(a.antiguedad),
      sinabono_desc: (a, b) => num(b.diasUltAbono) - num(a.diasUltAbono),
      nombre_asc: (a, b) => a.nombre.localeCompare(b.nombre, 'es'),
    }[filters.sort] || ((a, b) => b.saldo - a.saldo);
    rows.sort(cmp);
    return rows;
  }

  const RIESGO = {
    rojo: { label: 'Rojo', bg: 'rgba(239,68,68,.15)', fg: '#ef4444' },
    ambar: { label: 'Ámbar', bg: 'rgba(245,158,11,.15)', fg: '#f59e0b' },
    verde: { label: 'Verde', bg: 'rgba(34,197,94,.15)', fg: '#22c55e' },
    sano: { label: 'Sano', bg: 'rgba(148,163,184,.15)', fg: 'var(--text2)' },
  };
  function riesgoChip(r) {
    if (r.estadoRelacion === 'a_favor') {
      return `<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:999px;background:rgba(59,130,246,.15);color:#3b82f6">A favor</span>`;
    }
    const c = RIESGO[r.riesgo] || RIESGO.sano;
    return `<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:999px;background:${c.bg};color:${c.fg}">${c.label}</span>`;
  }
  function saldoColor(saldo) {
    if (saldo > 0) return '#ef4444';
    if (saldo < 0) return '#3b82f6';
    return 'var(--text2)';
  }
  const AGE_COLORS = { a0: '#22c55e', a31: '#f59e0b', a61: '#f97316', a90: '#ef4444' };
  function agingBar(r, height) {
    const total = r.a0 + r.a31 + r.a61 + r.a90;
    const h = height || 8;
    if (total <= 0) {
      return `<div style="height:${h}px;border-radius:4px;background:var(--bg3);opacity:.5"></div>`;
    }
    const seg = (v, color) =>
      v > 0 ? `<div title="${fmtCOP(v)}" style="width:${(v / total) * 100}%;background:${color}"></div>` : '';
    return `<div style="display:flex;height:${h}px;border-radius:4px;overflow:hidden;background:var(--bg3)">
      ${seg(r.a0, AGE_COLORS.a0)}${seg(r.a31, AGE_COLORS.a31)}${seg(r.a61, AGE_COLORS.a61)}${seg(r.a90, AGE_COLORS.a90)}
    </div>`;
  }
  function initialAvatar(nombre) {
    const ini = (nombre || '?').trim().charAt(0).toUpperCase();
    return `<div style="width:30px;height:30px;border-radius:8px;background:var(--bg3);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:14px;color:var(--accent);flex-shrink:0">${esc(ini)}</div>`;
  }

  function kpiCardsHtml(g) {
    const card = (label, value, sub) =>
      `<div style="flex:1;min-width:150px;background:var(--card,#fff);border:1px solid var(--border,#e5e7eb);border-radius:12px;padding:12px 14px">
        <div style="font-size:10px;letter-spacing:.04em;text-transform:uppercase;color:var(--text2)">${esc(label)}</div>
        <div style="font-size:20px;font-weight:800;margin-top:2px;font-variant-numeric:tabular-nums">${value}</div>
        ${sub ? `<div style="font-size:11px;color:var(--text2);margin-top:2px">${sub}</div>` : ''}
      </div>`;

    const agingTotal = g.a0 + g.a31 + g.a61 + g.a90;
    const pct = (v) => (agingTotal > 0 ? Math.round((v / agingTotal) * 100) : 0);
    const seg = (v, color) =>
      v > 0 ? `<div title="${fmtCOP(v)}" style="width:${(v / agingTotal) * 100}%;background:${color}"></div>` : '';
    const legend = (label, v, color) =>
      `<span style="display:inline-flex;align-items:center;gap:4px;font-size:10px;color:var(--text2)"><span style="width:8px;height:8px;border-radius:2px;background:${color};display:inline-block"></span>${label} ${pct(v)}%</span>`;

    const agingCard = `<div style="flex:2;min-width:260px;background:var(--card,#fff);border:1px solid var(--border,#e5e7eb);border-radius:12px;padding:12px 14px">
      <div style="font-size:10px;letter-spacing:.04em;text-transform:uppercase;color:var(--text2);margin-bottom:8px">Aging consolidado</div>
      ${agingTotal > 0
        ? `<div style="display:flex;height:12px;border-radius:6px;overflow:hidden;background:var(--bg3);margin-bottom:8px">
             ${seg(g.a0, AGE_COLORS.a0)}${seg(g.a31, AGE_COLORS.a31)}${seg(g.a61, AGE_COLORS.a61)}${seg(g.a90, AGE_COLORS.a90)}
           </div>`
        : `<div style="height:12px;border-radius:6px;background:var(--bg3);opacity:.5;margin-bottom:8px"></div>`}
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        ${legend('0-30', g.a0, AGE_COLORS.a0)}${legend('31-60', g.a31, AGE_COLORS.a31)}${legend('61-90', g.a61, AGE_COLORS.a61)}${legend('90+', g.a90, AGE_COLORS.a90)}
      </div>
    </div>`;

    return (
      `<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">` +
      card('CXP total activa', fmtCOP(g.cxpTotal), `${fmtNum(g.conDeuda)} proveedor(es) con deuda`) +
      card('Al día / a favor', `${fmtNum(g.alDia)} / ${fmtNum(g.aFavor)}`, 'sin deuda / con saldo a favor') +
      card('Abonos del mes', fmtCOP(g.abonosMes), 'pagos a proveedores este mes') +
      agingCard +
      `</div>`
    );
  }

  function listRowsHtml(rows) {
    if (!rows.length) {
      return `<tr><td colspan="7" style="text-align:center;color:var(--text2);padding:24px">Sin proveedores para los filtros actuales</td></tr>`;
    }
    return rows
      .map((r) => {
        const sinMov = r.nCargos === 0 && r.saldo === 0;
        return `<tr style="cursor:pointer" data-cxp-row="${esc(r.id)}">
          <td>
            <div style="display:flex;align-items:center;gap:10px">
              ${initialAvatar(r.nombre)}
              <div style="min-width:0">
                <div style="font-weight:600">${esc(r.nombre)}</div>
                <div style="font-size:10px;color:var(--text2)">${esc(r.ciudad || '—')}${r.nCargosAbiertos ? ` · ${fmtNum(r.nCargosAbiertos)} cargo(s) abierto(s)` : ''}</div>
              </div>
            </div>
          </td>
          <td style="text-align:right;font-weight:800;font-variant-numeric:tabular-nums;color:${saldoColor(r.saldo)}">${sinMov ? '<span style="color:var(--text2);font-weight:500;font-size:11px">Sin movimientos</span>' : fmtCOP(r.saldo)}</td>
          <td style="min-width:120px">${agingBar(r)}</td>
          <td style="text-align:right;font-variant-numeric:tabular-nums">${r.antiguedad > 0 ? fmtNum(r.antiguedad) + ' d' : '—'}</td>
          <td style="text-align:right;color:var(--text2);font-variant-numeric:tabular-nums">${r.ultAbono ? relDias(r.diasUltAbono) : '—'}</td>
          <td>${riesgoChip(r)}</td>
          <td style="text-align:right"><button type="button" class="btn btn-xs btn-secondary" data-cxp-detail="${esc(r.id)}">Detalle</button></td>
        </tr>`;
      })
      .join('');
  }

  function applyList() {
    const rows = visibleRows();
    const body = document.getElementById('cxp-list-body');
    if (body) body.innerHTML = listRowsHtml(rows);
    const count = document.getElementById('cxp-count');
    if (count) count.textContent = fmtNum(rows.length);
  }

  function setFilter(key, value) {
    filters[key] = value;
    applyList();
  }

  function ciudadesDistinct() {
    const set = new Set();
    _rows.forEach((r) => {
      const c = (r.ciudad || '').trim();
      if (c) set.add(c);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'es'));
  }

  async function openDetail(provId) {
    const r = _rows.find((x) => String(x.id) === String(provId));
    if (!r) return;
    ensureDrawer();
    const panel = document.getElementById('cxp-drawer-panel');
    const back = document.getElementById('cxp-drawer');
    if (!panel || !back) return;
    back.style.display = 'block';
    requestAnimationFrame(() => {
      back.style.opacity = '1';
      panel.style.transform = 'translateX(0)';
    });
    panel.innerHTML = drawerHeaderHtml(r) + `<div style="padding:16px;color:var(--text2)">Cargando detalle…</div>`;

    let cargos = [];
    try {
      const client = sb();
      const { data, error } = await client
        .from('v_cxp_aging_cargos')
        .select('*')
        .eq('proveedor_id', provId)
        .order('fecha_cargo', { ascending: true });
      if (error) throw error;
      cargos = data || [];
    } catch (e) {
      console.warn('[CXP] detalle:', e && e.message);
    }
    const stillOpen = document.getElementById('cxp-drawer-panel');
    if (stillOpen) stillOpen.innerHTML = drawerHeaderHtml(r) + drawerBodyHtml(r, cargos);
  }

  function closeDetail() {
    const back = document.getElementById('cxp-drawer');
    const panel = document.getElementById('cxp-drawer-panel');
    if (!back || !panel) return;
    back.style.opacity = '0';
    panel.style.transform = 'translateX(100%)';
    setTimeout(() => {
      back.style.display = 'none';
    }, 220);
  }

  function ensureDrawer() {
    if (document.getElementById('cxp-drawer')) return;
    const back = document.createElement('div');
    back.id = 'cxp-drawer';
    back.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9998;display:none;opacity:0;transition:opacity .2s ease';
    const panel = document.createElement('div');
    panel.id = 'cxp-drawer-panel';
    panel.style.cssText =
      'position:absolute;top:0;right:0;height:100%;width:min(560px,100%);background:var(--card,#fff);box-shadow:-8px 0 24px rgba(0,0,0,.2);overflow-y:auto;transform:translateX(100%);transition:transform .22s ease';
    panel.addEventListener('click', (e) => e.stopPropagation());
    back.appendChild(panel);
    back.addEventListener('click', closeDetail);
    document.body.appendChild(back);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeDetail();
    });
  }

  function drawerHeaderHtml(r) {
    return `<div style="position:sticky;top:0;background:var(--card,#fff);border-bottom:1px solid var(--border);padding:16px;display:flex;align-items:center;gap:12px;z-index:1">
      ${initialAvatar(r.nombre)}
      <div style="flex:1;min-width:0">
        <div style="font-weight:800;font-size:16px">${esc(r.nombre)}</div>
        <div style="font-size:11px;color:var(--text2)">${esc(r.ciudad || '—')}</div>
      </div>
      ${riesgoChip(r)}
      <button type="button" class="btn btn-xs btn-secondary" data-cxp-close>✕</button>
    </div>`;
  }

  function drawerBodyHtml(r, cargos) {
    const mini = (label, value, color) =>
      `<div style="flex:1;min-width:120px;background:var(--bg3);border-radius:10px;padding:10px 12px">
        <div style="font-size:10px;text-transform:uppercase;color:var(--text2)">${esc(label)}</div>
        <div style="font-size:15px;font-weight:800;font-variant-numeric:tabular-nums;${color ? `color:${color}` : ''}">${value}</div>
      </div>`;

    const agingTotal = r.a0 + r.a31 + r.a61 + r.a90;
    const agingRow = (label, v, color) =>
      `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <span style="width:46px;font-size:11px;color:var(--text2)">${label}</span>
        <div style="flex:1;height:8px;border-radius:4px;background:var(--bg3);overflow:hidden">
          <div style="width:${agingTotal > 0 ? (v / agingTotal) * 100 : 0}%;height:100%;background:${color}"></div>
        </div>
        <span style="width:96px;text-align:right;font-size:11px;font-variant-numeric:tabular-nums">${fmtCOP(v)}</span>
      </div>`;

    const cargosTable = cargos.length
      ? `<div class="table-wrap"><table><thead><tr>
          <th>Fecha</th><th>Ref</th><th style="text-align:right">Monto</th><th style="text-align:right">Saldo</th><th style="text-align:right">Días</th><th>Cubeta</th>
        </tr></thead><tbody>
          ${cargos
            .map(
              (c) => `<tr>
            <td>${esc(fmtFecha(c.fecha_cargo))}</td>
            <td style="color:var(--text2)">${esc(c.referencia || '—')}</td>
            <td style="text-align:right;font-variant-numeric:tabular-nums">${fmtCOP(c.monto_cargo)}</td>
            <td style="text-align:right;font-weight:700;font-variant-numeric:tabular-nums">${fmtCOP(c.saldo_cargo)}</td>
            <td style="text-align:right;font-variant-numeric:tabular-nums">${fmtNum(c.dias_antiguedad)}</td>
            <td><span style="font-size:10px;color:var(--text2)">${esc(c.bucket)}</span></td>
          </tr>`,
            )
            .join('')}
        </tbody></table></div>`
      : `<div style="color:var(--text2);font-size:12px;padding:8px 0">Sin cargos abiertos.</div>`;

    const bankLine = [r.banco, r.cuenta].filter(Boolean).join(' · ') || 'Sin datos bancarios';
    const canCopy = !!(r.banco || r.cuenta);

    return `<div style="padding:16px">
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
        ${mini('Saldo actual', r.saldo === 0 && r.nCargos === 0 ? 'Sin mov.' : fmtCOP(r.saldo), saldoColor(r.saldo))}
        ${mini('Antigüedad deuda', r.antiguedad > 0 ? fmtNum(r.antiguedad) + ' días' : '—')}
        ${mini('DSO (días pago)', r.dso != null ? fmtNum(r.dso) + ' d' : '—')}
      </div>

      <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text2);margin:6px 0 8px">Aging del saldo</div>
      ${agingRow('0-30', r.a0, AGE_COLORS.a0)}
      ${agingRow('31-60', r.a31, AGE_COLORS.a31)}
      ${agingRow('61-90', r.a61, AGE_COLORS.a61)}
      ${agingRow('90+', r.a90, AGE_COLORS.a90)}
      ${r.creditosSinAplicar > 0
        ? `<div style="margin-top:8px;font-size:11px;color:#3b82f6">Créditos sin aplicar (saldo a favor flotante): ${fmtCOP(r.creditosSinAplicar)}</div>`
        : ''}

      <div style="display:flex;gap:8px;flex-wrap:wrap;margin:16px 0">
        ${mini('Total comprado', fmtCOP(r.totalCargos))}
        ${mini('Total abonado', fmtCOP(r.totalAbonado))}
        ${mini('Notas crédito', fmtCOP(r.totalNotas))}
        ${mini('Devoluciones', fmtCOP(r.totalDevoluciones))}
      </div>

      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">
        ${mini('Último cargo', r.ultCargo ? fmtFecha(r.ultCargo) : '—', null)}
        ${mini('Último abono', r.ultAbono ? fmtFecha(r.ultAbono) : '—', null)}
        ${mini('Método frecuente', r.metodoFreq ? esc(r.metodoFreq) : '—', null)}
      </div>

      <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text2);margin:6px 0 8px">Datos de pago</div>
      <div style="background:var(--bg3);border-radius:10px;padding:12px;margin-bottom:16px">
        <div style="font-size:13px;margin-bottom:4px">${esc(bankLine)}</div>
        <div style="font-size:11px;color:var(--text2)">${r.whatsapp ? '📱 ' + esc(r.whatsapp) : ''}${r.contacto ? ' · ' + esc(r.contacto) : ''}${r.email ? ' · ' + esc(r.email) : ''}</div>
        ${canCopy ? `<button type="button" class="btn btn-xs btn-secondary" style="margin-top:8px" data-cxp-copy="${esc([r.banco, r.cuenta].filter(Boolean).join(' '))}">Copiar datos bancarios</button>` : ''}
      </div>

      <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text2);margin:6px 0 8px">Cargos abiertos</div>
      ${cargosTable}
    </div>`;
  }

  function copyBank(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        () => notifyMsg('success', '📋', 'Copiado', 'Datos bancarios copiados al portapapeles.'),
        () => notifyMsg('warning', '📋', 'No se pudo copiar', text),
      );
    } else {
      notifyMsg('info', '📋', 'Datos bancarios', text);
    }
  }

  function skeletonHtml() {
    const bar = (w) => `<div style="height:14px;width:${w};background:var(--bg3);border-radius:6px;opacity:.6"></div>`;
    const row = `<div style="display:flex;gap:12px;align-items:center;padding:12px 0;border-bottom:1px solid var(--border)">
      <div style="width:30px;height:30px;border-radius:8px;background:var(--bg3);opacity:.6"></div>${bar('40%')}${bar('20%')}</div>`;
    return `<div class="card">
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">
        ${'<div style="flex:1;min-width:150px;height:70px;background:var(--bg3);border-radius:12px;opacity:.6"></div>'.repeat(4)}
      </div>
      <div class="card">${row.repeat(5)}</div>
    </div>`;
  }
  function errorHtml(msg) {
    return `<div class="card" style="padding:28px;text-align:center">
      <div style="font-size:30px;margin-bottom:8px">⚠️</div>
      <div style="font-weight:700;margin-bottom:4px">No se pudo cargar CXP Proveedores</div>
      <div style="color:var(--text2);font-size:12px;margin-bottom:14px">${esc(msg)}</div>
      <button class="btn btn-primary" onclick="AppCxpProveedoresModule.reload()">Reintentar</button>
    </div>`;
  }

  function shellHtml() {
    const g = _kpis || normKpis(null);
    const ciudades = ciudadesDistinct();
    const labelStyle = 'font-size:10px;color:var(--text2);display:block;margin-bottom:4px';
    const optsCiudad =
      `<option value="__all__">Todas</option>` +
      ciudades.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');

    return `
      ${kpiCardsHtml(g)}

      <div class="card" style="margin-bottom:12px">
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
          <div style="flex:1;min-width:200px"><label style="${labelStyle}">Buscar proveedor</label>
            <input type="text" id="cxp-q" class="form-control" placeholder="Nombre, ciudad o WhatsApp…" oninput="AppCxpProveedoresModule.setFilter('q', this.value)"></div>
          <div><label style="${labelStyle}">Estado</label>
            <select id="cxp-estado" class="form-control" onchange="AppCxpProveedoresModule.setFilter('estado', this.value)">
              <option value="__all__">Todos</option><option value="deuda">Con deuda</option><option value="aldia">Al día</option><option value="favor">A favor</option>
            </select></div>
          <div><label style="${labelStyle}">Cubeta aging</label>
            <select id="cxp-bucket" class="form-control" onchange="AppCxpProveedoresModule.setFilter('bucket', this.value)">
              <option value="__all__">Todas</option><option value="0-30">0-30</option><option value="31-60">31-60</option><option value="61-90">61-90</option><option value="90+">90+</option>
            </select></div>
          <div><label style="${labelStyle}">Ciudad</label>
            <select id="cxp-ciudad" class="form-control" onchange="AppCxpProveedoresModule.setFilter('ciudad', this.value)">${optsCiudad}</select></div>
          <div><label style="${labelStyle}">Orden</label>
            <select id="cxp-sort" class="form-control" onchange="AppCxpProveedoresModule.setFilter('sort', this.value)">
              <option value="saldo_desc">Mayor saldo</option><option value="saldo_asc">Menor saldo</option>
              <option value="antiguedad_desc">Más antiguo</option><option value="sinabono_desc">Más días sin abonar</option>
              <option value="nombre_asc">Nombre (A-Z)</option>
            </select></div>
          <div><label style="${labelStyle}">&nbsp;</label><button class="btn btn-secondary" onclick="AppCxpProveedoresModule.reload()">Recargar</button></div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">PROVEEDORES (<span id="cxp-count">0</span>)</div>
        <div class="table-wrap">
          <table>
            <thead><tr>
              <th>Proveedor</th><th style="text-align:right">Saldo</th><th>Aging</th>
              <th style="text-align:right">Antigüedad</th><th style="text-align:right">Sin abonar</th><th>Riesgo</th><th style="text-align:right"></th>
            </tr></thead>
            <tbody id="cxp-list-body"></tbody>
          </table>
        </div>
      </div>`;
  }

  function mountEl() {
    return document.getElementById('tes_pagos_prov-content');
  }

  function bindListDelegation() {
    const body = document.getElementById('cxp-list-body');
    if (!body || body.__cxpBound) return;
    body.__cxpBound = true;
    body.addEventListener('click', (e) => {
      const t = e.target;
      const detailBtn = t.closest ? t.closest('[data-cxp-detail]') : null;
      if (detailBtn) {
        openDetail(detailBtn.getAttribute('data-cxp-detail'));
        return;
      }
      const row = t.closest ? t.closest('[data-cxp-row]') : null;
      if (row) openDetail(row.getAttribute('data-cxp-row'));
    });
  }

  function bindDrawerDelegation() {
    ensureDrawer();
    const panel = document.getElementById('cxp-drawer-panel');
    if (!panel || panel.__cxpBound) return;
    panel.__cxpBound = true;
    panel.addEventListener('click', (e) => {
      const t = e.target;
      if (t.closest && t.closest('[data-cxp-close]')) {
        closeDetail();
        return;
      }
      const copyBtn = t.closest ? t.closest('[data-cxp-copy]') : null;
      if (copyBtn) copyBank(copyBtn.getAttribute('data-cxp-copy') || '');
    });
  }

  async function reload() {
    return renderCxpProveedores(_ctx, true);
  }

  async function renderCxpProveedores(ctx, force) {
    if (ctx) _ctx = ctx;
    const mount = mountEl();
    if (!mount) return;

    if (_loading) return;
    _loading = true;
    if (force || !_rows.length) mount.innerHTML = skeletonHtml();

    try {
      await loadAll();
      _error = null;
    } catch (e) {
      _error = (e && e.message) || 'Error inesperado';
      console.warn('[CXP] load:', e);
    } finally {
      _loading = false;
    }

    const m = mountEl();
    if (!m) return;
    if (_error) {
      m.innerHTML = errorHtml(_error);
      return;
    }
    m.innerHTML = shellHtml();
    const set = (id, v) => {
      const el = document.getElementById(id);
      if (el) el.value = v;
    };
    set('cxp-q', filters.q);
    set('cxp-estado', filters.estado);
    set('cxp-bucket', filters.bucket);
    set('cxp-ciudad', filters.ciudad);
    set('cxp-sort', filters.sort);
    applyList();
    bindListDelegation();
    bindDrawerDelegation();
  }

  global.AppCxpProveedoresModule = {
    renderCxpProveedores,
    setFilter,
    openDetail,
    closeDetail,
    reload,
  };
})(window);
