/**
 * Centro de IA — runtime ops mínimo (Proveedores · Activación · cobertura · cola · jobs).
 * Keys nunca en ERP. Worker → AiProvider → OpenAI.
 */
(function initAiCenterModule(global) {
  const TABS = [
    { id: 'resumen', label: 'Resumen' },
    { id: 'proveedores', label: 'Proveedores' },
    { id: 'activacion', label: 'Activación módulos' },
    { id: 'estado', label: 'Estado del catálogo' },
    { id: 'cola', label: 'Cola de revisión' },
    { id: 'jobs', label: 'Jobs' },
  ];

  const MODULE_META = {
    copy: { title: 'Copy', blurb: 'Nombre y descripciones.' },
    seo: { title: 'SEO', blurb: 'Meta title, description, slug, keywords.' },
    attributes: { title: 'Attributes / Stylist', blurb: 'Quiet Luxury, Cartagena, cobertura…' },
    relations: { title: 'Relations', blurb: 'Candidatos de grafo (recomendado manual al inicio).' },
    knowledge: { title: 'Knowledge', blurb: 'Documento canónico. Antes de embedding.' },
    embedding: { title: 'Embeddings', blurb: 'Solo si Knowledge está accepted.' },
  };

  let _tab = 'resumen';
  let _statusCache = null;
  let _detailKey = null;
  let _busy = false;
  let _cfgCache = null;

  function api() {
    return global.ProductIntelligenceApi;
  }

  function notify(type, title, msg) {
    if (typeof global.notify === 'function') {
      global.notify(type === 'error' ? 'error' : 'success', type === 'error' ? '⚠️' : '✨', title, msg);
      return;
    }
    console.log(`[AI Center ${type}]`, title, msg);
  }

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function openProductByRef(ref) {
    const clean = String(ref || '').trim().toUpperCase();
    const arts = global.state?.articulos || [];
    const art = arts.find((a) => String(a.ref || a.codigo || '').toUpperCase() === clean);
    if (art?.id && typeof global.openArticuloModal === 'function') {
      global.openArticuloModal(art.id);
      return;
    }
    notify('error', 'Artículo', `No está en memoria local: ${clean}. Abrí Artículos y recargá.`);
  }

  function fmtAgo(iso) {
    if (!iso) return 'Nunca';
    const ms = Date.now() - new Date(iso).getTime();
    if (ms < 60000) return 'Hace menos de 1 min';
    if (ms < 3600000) return `Hace ${Math.floor(ms / 60000)} min`;
    if (ms < 86400000) return `Hace ${Math.floor(ms / 3600000)} h`;
    return `Hace ${Math.floor(ms / 86400000)} d`;
  }

  async function renderResumen(host) {
    host.innerHTML = `<div style="padding:16px;color:var(--text2);">Cargando resumen…</div>`;
    try {
      const dash = await api().getDashboardSummary();
      _cfgCache = dash.config;
      _statusCache = dash.catalog;
      const cfg = dash.config || {};
      const connected = !!cfg.last_ping_ok;
      host.innerHTML = `
        <div style="font-size:12px;color:var(--text2);margin-bottom:12px;line-height:1.45;">
          Dashboard mínimo del runtime. Generación por SKU = modal Artículos → Inteligencia.
          Playbook: un SKU (ej. HERA-20141) → Copy → SEO → Attributes → Knowledge → Embedding.
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px;">
          <div style="padding:14px;border-radius:10px;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.03);">
            <div style="font-size:11px;color:var(--text2);">Proveedor</div>
            <div style="font-size:20px;font-weight:800;color:var(--text1);">${esc(cfg.active_provider || 'openai')}</div>
          </div>
          <div style="padding:14px;border-radius:10px;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.03);">
            <div style="font-size:11px;color:var(--text2);">Estado</div>
            <div style="font-size:20px;font-weight:800;color:${connected ? 'var(--green)' : 'var(--orange)'};">
              ${connected ? 'Conectado' : 'No configurado'}
            </div>
          </div>
          <div style="padding:14px;border-radius:10px;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.03);">
            <div style="font-size:11px;color:var(--text2);">Modelo Copy</div>
            <div style="font-size:15px;font-weight:700;color:var(--text1);word-break:break-all;">${esc(cfg.chat_model || 'gpt-4o-mini')}</div>
          </div>
          <div style="padding:14px;border-radius:10px;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.03);">
            <div style="font-size:11px;color:var(--text2);">Embeddings</div>
            <div style="font-size:15px;font-weight:700;color:var(--text1);word-break:break-all;">${esc(cfg.embed_model || 'text-embedding-3-small')}</div>
          </div>
          <div style="padding:14px;border-radius:10px;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.03);">
            <div style="font-size:11px;color:var(--text2);">Artifacts pendientes</div>
            <div style="font-size:24px;font-weight:800;">${esc(dash.pending_artifacts)}</div>
          </div>
          <div style="padding:14px;border-radius:10px;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.03);">
            <div style="font-size:11px;color:var(--text2);">Jobs pendientes</div>
            <div style="font-size:24px;font-weight:800;">${esc(dash.pending_jobs)}</div>
          </div>
          <div style="padding:14px;border-radius:10px;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.03);">
            <div style="font-size:11px;color:var(--text2);">Último error job</div>
            <div style="font-size:12px;color:var(--text2);margin-top:6px;">
              ${dash.last_failed
                ? `${esc(dash.last_failed.ref)} · ${esc(dash.last_failed.module)} · ${esc(fmtAgo(dash.last_failed.created_at))}`
                : 'Ninguno reciente'}
            </div>
          </div>
          <div style="padding:14px;border-radius:10px;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.03);">
            <div style="font-size:11px;color:var(--text2);">Costo estimado hoy</div>
            <div style="font-size:20px;font-weight:800;color:var(--text2);">—</div>
            <div style="font-size:10px;color:var(--text2);">Sin telemetría de tokens aún</div>
          </div>
        </div>
        <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap;">
          <button type="button" class="btn btn-primary btn-sm" onclick="AiCenter.setTab('proveedores')">Ir a Proveedores</button>
          <button type="button" class="btn btn-secondary btn-sm" onclick="AiCenter.setTab('activacion')">Activación módulos</button>
          <button type="button" class="btn btn-secondary btn-sm" onclick="AiCenter.refresh()">🔄 Actualizar</button>
        </div>`;
    } catch (e) {
      host.innerHTML = `<div style="color:var(--red);padding:16px;">${esc(e.message || e)}</div>`;
    }
  }

  async function renderProveedores(host) {
    host.innerHTML = `<div style="padding:16px;color:var(--text2);">Cargando proveedor…</div>`;
    let cfg = _cfgCache;
    try {
      cfg = await api().getRuntimeConfig();
      _cfgCache = cfg;
    } catch (e) {
      host.innerHTML = `<div style="color:var(--red);padding:16px;">${esc(e.message || e)}</div>`;
      return;
    }

    const connected = !!cfg.last_ping_ok;
    host.innerHTML = `
      <div style="font-size:12px;color:var(--text2);line-height:1.5;margin-bottom:12px;">
        Configuración mínima de proveedor. La API Key <strong style="color:var(--text1);">nunca</strong> se guarda en Supabase tablas ni se muestra aquí — solo secrets del Edge.
      </div>
      <div style="padding:16px;border-radius:12px;border:1px solid rgba(255,255,255,0.1);background:rgba(0,0,0,0.2);max-width:520px;">
        <div style="font-size:18px;font-weight:800;color:var(--text1);font-family:Syne,sans-serif;">OpenAI</div>
        <div style="margin-top:12px;font-size:13px;line-height:1.7;">
          <div>Estado:
            ${connected
              ? '<span style="color:var(--green);">● Conectado</span>'
              : '<span style="color:var(--orange);">○ No configurado</span>'}
          </div>
          <div>Modelo Copy · <code>${esc(cfg.chat_model || 'gpt-4o-mini')}</code></div>
          <div>Modelo Embeddings · <code>${esc(cfg.embed_model || 'text-embedding-3-small')}</code>
            <span style="font-size:10px;color:var(--text2);"> (debe ser 1536 dims)</span>
          </div>
          <div>Última prueba · ${esc(fmtAgo(cfg.last_ping_at))}
            ${cfg.last_ping_latency_ms != null ? ` · ${esc(cfg.last_ping_latency_ms)} ms` : ''}
          </div>
          ${cfg.last_ping_message
            ? `<div style="color:var(--text2);font-size:12px;">${esc(cfg.last_ping_message)}</div>`
            : ''}
        </div>
        <div style="margin-top:14px;display:flex;flex-wrap:wrap;gap:8px;">
          <button type="button" class="btn btn-primary btn-sm" ${_busy ? 'disabled' : ''} onclick="AiCenter.probeConnection()">Test de conexión</button>
        </div>
      </div>
      <div style="margin-top:14px;padding:12px;border-radius:8px;background:rgba(0,0,0,0.22);font-size:12px;line-height:1.55;color:var(--text2);max-width:640px;">
        <div style="font-weight:700;color:var(--text1);margin-bottom:6px;">Cómo setear el secret (1 vez)</div>
        <pre style="margin:0;padding:10px;background:rgba(0,0,0,0.35);border-radius:6px;overflow:auto;color:var(--text1);">npx supabase secrets set OPENAI_API_KEY=sk-... --project-ref niilaxdeetuzutycvdkz</pre>
        <div style="margin-top:8px;">Dashboard:
          <a href="https://supabase.com/dashboard/project/niilaxdeetuzutycvdkz/settings/functions" target="_blank" rel="noopener" style="color:var(--accent);">Edge Secrets</a>
        </div>
      </div>
      <div style="margin-top:16px;max-width:520px;">
        <div style="font-size:12px;font-weight:700;color:var(--text1);margin-bottom:8px;">Modelos (DB prefs; env OPENAI_* pisa si existe)</div>
        <div class="form-row" style="display:flex;gap:8px;flex-wrap:wrap;">
          <div style="flex:1;min-width:180px;">
            <label class="form-label">Chat / Copy</label>
            <input class="form-control" id="ai-chat-model" value="${esc(cfg.chat_model || 'gpt-4o-mini')}" />
          </div>
          <div style="flex:1;min-width:180px;">
            <label class="form-label">Embeddings</label>
            <select class="form-control" id="ai-embed-model">
              <option value="text-embedding-3-small" ${(cfg.embed_model || '') === 'text-embedding-3-small' ? 'selected' : ''}>text-embedding-3-small (1536)</option>
              <option value="text-embedding-ada-002" ${(cfg.embed_model || '') === 'text-embedding-ada-002' ? 'selected' : ''}>text-embedding-ada-002 (1536)</option>
            </select>
          </div>
        </div>
        <button type="button" class="btn btn-secondary btn-sm" style="margin-top:10px;" onclick="AiCenter.saveModels()">Guardar modelos</button>
      </div>`;
  }

  async function renderActivacion(host) {
    host.innerHTML = `<div style="padding:16px;color:var(--text2);">Cargando gates…</div>`;
    try {
      const cfg = await api().getRuntimeConfig();
      _cfgCache = cfg;
      const mods = cfg.modules || {};
      host.innerHTML = `
        <div style="font-size:12px;color:var(--text2);line-height:1.5;margin-bottom:12px;">
          Activá módulo por módulo. Relations arranca en <strong style="color:var(--text1);">Manual</strong> (recomendado).
          Embedding solo corre si hay Knowledge <code>accepted</code>.
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;max-width:520px;">
          ${api()
            .MODULES.map((mod) => {
              const meta = MODULE_META[mod] || { title: mod, blurb: '' };
              const on = mods[mod] !== false;
              return `
              <label style="display:flex;align-items:flex-start;gap:12px;padding:12px;border-radius:10px;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.03);cursor:pointer;">
                <input type="checkbox" data-ai-mod="${esc(mod)}" ${on ? 'checked' : ''} style="margin-top:3px;width:18px;height:18px;" />
                <span>
                  <strong style="color:var(--text1);">${esc(meta.title)}</strong>
                  <span style="opacity:0.75;font-size:11px;"> · ${on ? 'IA' : 'Manual / off'}</span>
                  <div style="font-size:11px;color:var(--text2);margin-top:4px;">${esc(meta.blurb)}</div>
                </span>
              </label>`;
            })
            .join('')}
        </div>
        <button type="button" class="btn btn-primary btn-sm" style="margin-top:14px;" onclick="AiCenter.saveModules()">Guardar activación</button>`;
    } catch (e) {
      host.innerHTML = `<div style="color:var(--red);padding:16px;">${esc(e.message || e)}</div>`;
    }
  }

  function metricCard(key, m) {
    const has = m.count;
    const color =
      key === 'pending_review' || String(key).startsWith('without')
        ? has > 0
          ? 'var(--orange)'
          : 'var(--green)'
        : 'var(--accent)';
    return `
      <button type="button" class="ai-metric-card" data-metric="${esc(key)}"
        style="text-align:left;cursor:pointer;padding:14px;border-radius:10px;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.03);width:100%;">
        <div style="font-size:11px;color:var(--text2);margin-bottom:6px;">${esc(m.label)}</div>
        <div style="font-size:28px;font-weight:800;color:${color};font-family:Syne,sans-serif;">${esc(m.count)}</div>
        <div style="font-size:11px;color:var(--text2);margin-top:4px;">${esc(m.pct)}% del catálogo visible</div>
      </button>`;
  }

  function renderDetailList(status, key) {
    const m = status.metrics[key];
    if (!m) return '';
    const rows = m.missing_sample || m.sample_refs || [];
    if (!rows.length) {
      return `<div style="padding:12px;color:var(--text2);font-size:12px;">Sin ejemplos.</div>`;
    }
    return `
      <div style="margin-top:12px;">
        <div style="font-size:12px;font-weight:700;margin-bottom:8px;color:var(--text1);">${esc(m.label)} — ejemplos</div>
        ${rows
          .map(
            (r) => `
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 10px;border-radius:8px;background:rgba(0,0,0,0.2);margin-bottom:6px;">
            <div><code style="color:var(--accent);">${esc(r.ref)}</code>
              <span style="margin-left:8px;color:var(--text2);font-size:12px;">${esc(r.name)}</span></div>
            <button type="button" class="btn btn-secondary btn-sm" onclick="AiCenter.openProduct('${esc(r.ref)}')">Abrir</button>
          </div>`,
          )
          .join('')}
      </div>`;
  }

  async function renderEstado(host) {
    host.innerHTML = `<div style="padding:16px;color:var(--text2);">Cargando cobertura…</div>`;
    try {
      const status = await api().getCatalogStatus();
      _statusCache = status;
      host.innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px;">
          ${Object.entries(status.metrics)
            .map(([k, m]) => metricCard(k, m))
            .join('')}
        </div>
        <div id="ai-center-metric-detail"></div>
        <button type="button" class="btn btn-secondary btn-sm" style="margin-top:14px;" onclick="AiCenter.refresh()">🔄 Actualizar</button>`;
      host.querySelectorAll('[data-metric]').forEach((btn) => {
        btn.addEventListener('click', () => {
          _detailKey = btn.getAttribute('data-metric');
          const detail = document.getElementById('ai-center-metric-detail');
          if (detail) detail.innerHTML = renderDetailList(status, _detailKey);
        });
      });
      if (_detailKey) {
        const detail = document.getElementById('ai-center-metric-detail');
        if (detail) detail.innerHTML = renderDetailList(status, _detailKey);
      }
    } catch (e) {
      host.innerHTML = `<div style="color:var(--red);padding:16px;">${esc(e.message || e)}</div>`;
    }
  }

  async function renderCola(host) {
    host.innerHTML = `<div style="padding:16px;color:var(--text2);">Cargando…</div>`;
    try {
      const items = await api().listPendingReview({ limit: 50 });
      if (!items.length) {
        host.innerHTML = `<div style="padding:16px;color:var(--text2);">Sin artifacts <code>suggested</code>.</div>`;
        return;
      }
      host.innerHTML = items
        .map((a) => {
          let preview = '';
          try {
            preview = JSON.stringify(a.payload, null, 2);
            if (preview.length > 400) preview = preview.slice(0, 400) + '\n…';
          } catch {
            preview = '';
          }
          return `
          <div style="padding:12px;border-radius:10px;border:1px solid rgba(255,255,255,0.08);background:rgba(0,0,0,0.18);margin-bottom:10px;">
            <div style="display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px;">
              <div><code style="color:var(--accent);">${esc(a.ref)}</code>
                <strong style="margin-left:8px;color:var(--text1);">${esc(a.artifact_type)}</strong></div>
              <div style="display:flex;gap:6px;">
                <button type="button" class="btn btn-secondary btn-sm" onclick="AiCenter.openProduct('${esc(a.ref)}')">Abrir</button>
                <button type="button" class="btn btn-primary btn-sm" onclick="AiCenter.accept('${esc(a.id)}')">Aprobar</button>
                <button type="button" class="btn btn-secondary btn-sm" onclick="AiCenter.reject('${esc(a.id)}')">Rechazar</button>
              </div>
            </div>
            <pre style="margin:8px 0 0;font-size:10px;max-height:100px;overflow:auto;color:var(--text2);">${esc(preview)}</pre>
          </div>`;
        })
        .join('');
    } catch (e) {
      host.innerHTML = `<div style="color:var(--red);padding:16px;">${esc(e.message || e)}</div>`;
    }
  }

  async function renderJobs(host) {
    host.innerHTML = `<div style="padding:16px;color:var(--text2);">Cargando jobs…</div>`;
    try {
      const [jobs, status] = await Promise.all([
        api().listRecentJobs({ limit: 30 }),
        _statusCache || api().getCatalogStatus(),
      ]);
      _statusCache = status;
      host.innerHTML = `
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
          <button type="button" class="btn btn-primary btn-sm" onclick="AiCenter.runWorker()">▶ Procesar siguiente job</button>
          <button type="button" class="btn btn-secondary btn-sm" onclick="AiCenter.refresh()">🔄</button>
          <span style="font-size:12px;color:var(--text2);align-self:center;">
            pending ${esc(status.jobs.pending)} · failed ${esc(status.jobs.failed)}
          </span>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
          <thead><tr style="color:var(--text2);text-align:left;">
            <th style="padding:6px;">ID</th><th style="padding:6px;">Ref</th><th style="padding:6px;">Módulo</th>
            <th style="padding:6px;">Estado</th><th style="padding:6px;">Error</th>
          </tr></thead>
          <tbody>
            ${(jobs || [])
              .map(
                (j) => `<tr style="border-top:1px solid rgba(255,255,255,0.06);">
              <td style="padding:6px;">${esc(j.id)}</td>
              <td style="padding:6px;"><a href="#" style="color:var(--accent);" onclick="event.preventDefault();AiCenter.openProduct('${esc(j.ref)}')">${esc(j.ref)}</a></td>
              <td style="padding:6px;">${esc(j.module)}</td>
              <td style="padding:6px;">${esc(j.status)}</td>
              <td style="padding:6px;color:var(--text2);">${esc(j.last_error || '')}</td>
            </tr>`,
              )
              .join('') ||
              '<tr><td colspan="5" style="padding:12px;color:var(--text2);">Sin jobs.</td></tr>'}
          </tbody>
        </table>`;
    } catch (e) {
      host.innerHTML = `<div style="color:var(--red);padding:16px;">${esc(e.message || e)}</div>`;
    }
  }

  async function paintBody() {
    const host = document.getElementById('ai-center-body');
    if (!host) return;
    if (!api()) {
      host.innerHTML = '<div style="padding:16px;color:var(--red);">ProductIntelligenceApi no cargada.</div>';
      return;
    }
    if (_tab === 'resumen') return renderResumen(host);
    if (_tab === 'proveedores') return renderProveedores(host);
    if (_tab === 'activacion') return renderActivacion(host);
    if (_tab === 'estado') return renderEstado(host);
    if (_tab === 'cola') return renderCola(host);
    return renderJobs(host);
  }

  function renderAiCenter() {
    const el = document.getElementById('centro_ia-content');
    if (!el) return;
    el.innerHTML = `
      <div class="card" style="margin-bottom:12px;">
        <div class="card-title">Centro de IA</div>
        <div style="font-size:12px;color:var(--text2);line-height:1.45;margin-top:4px;">
          Runtime de IA desacoplado: Proveedor → Worker → Product Intelligence.
          Equivale a Configuración → IA (proveedores, gates, salud).
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:14px;" id="ai-center-tabs">
          ${TABS.map(
            (t) => `
            <button type="button" class="btn ${_tab === t.id ? 'btn-primary' : 'btn-secondary'} btn-sm"
              data-ai-tab="${esc(t.id)}">${esc(t.label)}</button>`,
          ).join('')}
        </div>
      </div>
      <div class="card" id="ai-center-body"></div>`;
    el.querySelectorAll('[data-ai-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        _tab = btn.getAttribute('data-ai-tab');
        renderAiCenter();
      });
    });
    paintBody();
  }

  async function refresh() {
    _statusCache = null;
    _cfgCache = null;
    await paintBody();
  }

  async function probeConnection() {
    _busy = true;
    try {
      const probe = await api().pingProvider();
      if (probe.ok) notify('success', 'OpenAI', `${probe.message} · ${probe.latency_ms} ms · ${probe.model}`);
      else notify('error', 'OpenAI', probe.message || 'No conectado');
      _tab = 'proveedores';
      await refresh();
    } catch (e) {
      notify('error', 'OpenAI', e.message || String(e));
    } finally {
      _busy = false;
    }
  }

  async function saveModules() {
    const mods = {};
    document.querySelectorAll('[data-ai-mod]').forEach((el) => {
      mods[el.getAttribute('data-ai-mod')] = !!el.checked;
    });
    try {
      await api().updateRuntimeModules(mods);
      notify('success', 'Activación', 'Gates de módulos guardados.');
      await refresh();
    } catch (e) {
      notify('error', 'Activación', e.message || String(e));
    }
  }

  async function saveModels() {
    const chat = document.getElementById('ai-chat-model')?.value;
    const emb = document.getElementById('ai-embed-model')?.value;
    try {
      await api().updateRuntimeModels(chat, emb);
      notify('success', 'Modelos', 'Preferencias guardadas.');
      await refresh();
    } catch (e) {
      notify('error', 'Modelos', e.message || String(e));
    }
  }

  async function accept(id) {
    try {
      const res = await api().accept(id);
      notify('success', 'Aprobado', res?.side_effects?.applied || 'OK');
      await refresh();
    } catch (e) {
      notify('error', 'Aprobar', e.message || String(e));
    }
  }

  async function reject(id) {
    try {
      await api().reject(id);
      notify('success', 'Rechazado', 'OK');
      await refresh();
    } catch (e) {
      notify('error', 'Rechazar', e.message || String(e));
    }
  }

  async function runWorker() {
    try {
      const body = await api().invokeWorker({});
      if (body.error) notify('error', 'Worker', body.error);
      else if (body.reason === 'module_disabled')
        notify('error', 'Worker', `Módulo ${body.module} desactivado`);
      else if (body.processed) notify('success', 'Worker', `Job #${body.job_id} (${body.module})`);
      else notify('success', 'Worker', body.reason || 'Sin pendientes');
      await refresh();
    } catch (e) {
      notify('error', 'Worker', e.message || String(e));
    }
  }

  global.AppAiCenterModule = { renderAiCenter };
  global.AiCenter = {
    refresh,
    openProduct: openProductByRef,
    accept,
    reject,
    runWorker,
    probeConnection,
    saveModules,
    saveModels,
    setTab(id) {
      _tab = id;
      renderAiCenter();
    },
  };
})(window);
