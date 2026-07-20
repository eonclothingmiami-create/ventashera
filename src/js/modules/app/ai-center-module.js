/**
 * Centro de IA — módulo ERP mínimo útil.
 * Submódulos: Estado del catálogo · Cola de revisión · Módulos IA · Jobs y salud
 * No administra API keys ni chat libre; complementa el modal Product Intelligence.
 */
(function initAiCenterModule(global) {
  const TABS = [
    { id: 'estado', label: 'Estado del catálogo' },
    { id: 'cola', label: 'Cola de revisión' },
    { id: 'modulos', label: 'Módulos IA' },
    { id: 'jobs', label: 'Jobs y salud' },
  ];

  const MODULE_META = {
    copy: {
      title: 'Copy',
      blurb: 'Nombre y descripciones comerciales.',
    },
    seo: {
      title: 'SEO',
      blurb: 'Meta title, description, slug y keywords (versionado).',
    },
    attributes: {
      title: 'Stylist / Atributos',
      blurb: 'Estilo, ocasión, cobertura, colecciones semánticas.',
    },
    relations: {
      title: 'Relaciones',
      blurb: 'Candidatos similar / completa outfit (solo suggested hasta aprobar).',
    },
    knowledge: {
      title: 'Knowledge',
      blurb: 'Documento canónico para búsqueda semántica.',
    },
    embedding: {
      title: 'Embedding',
      blurb: 'Actualiza el índice vectorial si el texto cambió.',
    },
  };

  let _tab = 'estado';
  let _statusCache = null;
  let _detailKey = null;
  let _busy = false;

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

  function metricCard(key, m) {
    const has = m.count;
    const color = key === 'pending_review' || key.startsWith('without')
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
      return `<div style="padding:12px;color:var(--text2);font-size:12px;">Sin ejemplos en esta métrica.</div>`;
    }
    return `
      <div style="margin-top:12px;">
        <div style="font-size:12px;font-weight:700;margin-bottom:8px;color:var(--text1);">${esc(m.label)} — ejemplos</div>
        <div style="display:flex;flex-direction:column;gap:6px;">
          ${rows
            .map(
              (r) => `
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 10px;border-radius:8px;background:rgba(0,0,0,0.2);">
              <div>
                <code style="color:var(--accent);">${esc(r.ref)}</code>
                <span style="margin-left:8px;color:var(--text2);font-size:12px;">${esc(r.name)}</span>
              </div>
              <button type="button" class="btn btn-secondary btn-sm" onclick="AiCenter.openProduct('${esc(r.ref)}')">Abrir Inteligencia</button>
            </div>`,
            )
            .join('')}
        </div>
      </div>`;
  }

  async function renderEstado(host) {
    host.innerHTML = `<div style="padding:16px;color:var(--text2);">Cargando cobertura…</div>`;
    try {
      const status = await api().getCatalogStatus();
      _statusCache = status;
      const cards = Object.entries(status.metrics)
        .map(([k, m]) => metricCard(k, m))
        .join('');
      host.innerHTML = `
        <div style="margin-bottom:12px;font-size:13px;color:var(--text2);line-height:1.45;">
          Catálogo visible: <strong style="color:var(--text1);">${esc(status.total)}</strong> productos.
          Esto mide cobertura del activo digital — no es un panel de ChatGPT.
          La generación y aprobación siguen en el modal del artículo.
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px;">
          ${cards}
        </div>
        <div id="ai-center-metric-detail"></div>
        <button type="button" class="btn btn-secondary btn-sm" style="margin-top:14px;" onclick="AiCenter.refresh()">🔄 Actualizar</button>
      `;
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
    host.innerHTML = `<div style="padding:16px;color:var(--text2);">Cargando sugerencias…</div>`;
    try {
      const items = await api().listPendingReview({ limit: 50 });
      if (!items.length) {
        host.innerHTML = `
          <div style="padding:16px;color:var(--text2);">No hay artifacts en estado <code>suggested</code>.</div>
          <button type="button" class="btn btn-secondary btn-sm" onclick="AiCenter.refresh()">🔄 Actualizar</button>`;
        return;
      }
      host.innerHTML = `
        <div style="font-size:12px;color:var(--text2);margin-bottom:10px;">
          ${items.length} sugerencia(s). Aprobar escribe en products / attributes / relations según el tipo.
        </div>
        <div style="display:flex;flex-direction:column;gap:10px;">
          ${items
            .map((a) => {
              let preview = '';
              try {
                preview = JSON.stringify(a.payload, null, 2);
                if (preview.length > 500) preview = preview.slice(0, 500) + '\n…';
              } catch {
                preview = '';
              }
              return `
              <div style="padding:12px;border-radius:10px;border:1px solid rgba(255,255,255,0.08);background:rgba(0,0,0,0.18);">
                <div style="display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px;align-items:center;">
                  <div>
                    <code style="color:var(--accent);">${esc(a.ref)}</code>
                    <strong style="margin-left:8px;color:var(--text1);">${esc(a.artifact_type)}</strong>
                    <span style="opacity:0.7;font-size:11px;"> · v${esc(a.version)}</span>
                  </div>
                  <div style="display:flex;gap:6px;flex-wrap:wrap;">
                    <button type="button" class="btn btn-secondary btn-sm" onclick="AiCenter.openProduct('${esc(a.ref)}')">Abrir</button>
                    <button type="button" class="btn btn-primary btn-sm" ${_busy ? 'disabled' : ''} onclick="AiCenter.accept('${esc(a.id)}')">Aprobar</button>
                    <button type="button" class="btn btn-secondary btn-sm" ${_busy ? 'disabled' : ''} onclick="AiCenter.reject('${esc(a.id)}')">Rechazar</button>
                  </div>
                </div>
                <pre style="margin:8px 0 0;font-size:10px;max-height:120px;overflow:auto;color:var(--text2);white-space:pre-wrap;">${esc(preview)}</pre>
              </div>`;
            })
            .join('')}
        </div>
        <button type="button" class="btn btn-secondary btn-sm" style="margin-top:12px;" onclick="AiCenter.refresh()">🔄 Actualizar</button>`;
    } catch (e) {
      host.innerHTML = `<div style="color:var(--red);padding:16px;">${esc(e.message || e)}</div>`;
    }
  }

  function renderModulos(host) {
    const PI = api();
    host.innerHTML = `
      <div style="font-size:13px;color:var(--text2);line-height:1.5;margin-bottom:14px;">
        Los “agentes” aquí son <strong style="color:var(--text1);">módulos especializados</strong> del worker
        (Copy, SEO, Stylist, Relaciones, Knowledge, Embedding). No son un chat.
        Para generar: abrí un artículo → sección Inteligencia → Regenerar.
        OpenAI se conecta con el secret del backend, no desde esta pantalla.
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;">
        ${(PI?.MODULES || [])
          .map((mod) => {
            const meta = MODULE_META[mod] || { title: mod, blurb: '' };
            return `
              <div style="padding:14px;border-radius:10px;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.03);">
                <div style="font-weight:800;color:var(--text1);font-family:Syne,sans-serif;">${esc(meta.title)}</div>
                <div style="font-size:11px;color:var(--text2);margin-top:6px;line-height:1.4;">${esc(meta.blurb)}</div>
                <div style="font-size:10px;margin-top:8px;opacity:0.65;"><code>${esc(mod)}</code></div>
              </div>`;
          })
          .join('')}
      </div>
      <div style="margin-top:16px;padding:12px;border-radius:8px;background:rgba(0,229,180,0.08);border:1px solid rgba(0,229,180,0.25);font-size:12px;color:var(--text2);line-height:1.45;">
        Atajo: andá a <a href="#" onclick="event.preventDefault();showPage('articulos')" style="color:var(--accent);">Artículos</a>,
        abrí un <code>HERA-*</code> y usá <strong style="color:var(--text1);">Inteligencia</strong> en el modal.
      </div>`;
  }

  async function renderJobs(host) {
    host.innerHTML = `<div style="padding:16px;color:var(--text2);">Cargando jobs…</div>`;
    try {
      const [jobs, probe, status] = await Promise.all([
        api().listRecentJobs({ limit: 30 }),
        api().probeWorker(),
        _statusCache || api().getCatalogStatus(),
      ]);
      _statusCache = status;

      const openaiLine = probe.openai
        ? `<span style="color:var(--green);">OpenAI conectado (worker OK)</span>`
        : `<span style="color:var(--orange);">OpenAI no configurado</span> — seteá <code>OPENAI_API_KEY</code> en secrets de Supabase (no en el ERP).`;

      host.innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px;margin-bottom:14px;">
          <div style="padding:12px;border-radius:10px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);">
            <div style="font-size:11px;color:var(--text2);">Pendientes</div>
            <div style="font-size:24px;font-weight:800;">${esc(status.jobs.pending)}</div>
          </div>
          <div style="padding:12px;border-radius:10px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);">
            <div style="font-size:11px;color:var(--text2);">Procesando</div>
            <div style="font-size:24px;font-weight:800;">${esc(status.jobs.processing)}</div>
          </div>
          <div style="padding:12px;border-radius:10px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);">
            <div style="font-size:11px;color:var(--text2);">Fallidos</div>
            <div style="font-size:24px;font-weight:800;color:${status.jobs.failed ? 'var(--red)' : 'inherit'};">${esc(status.jobs.failed)}</div>
          </div>
        </div>
        <div style="padding:12px;border-radius:8px;background:rgba(0,0,0,0.2);font-size:12px;margin-bottom:12px;line-height:1.5;">
          <div><strong style="color:var(--text1);">Salud</strong> · ${openaiLine}</div>
          <div style="margin-top:4px;color:var(--text2);">${esc(probe.message)}</div>
          <div style="margin-top:6px;color:var(--text2);">Provider activo: <code>openai</code> (readonly) · Worker: <code>product-intelligence-worker</code></div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
          <button type="button" class="btn btn-primary btn-sm" ${_busy ? 'disabled' : ''} onclick="AiCenter.runWorker()">▶ Procesar siguiente job</button>
          <button type="button" class="btn btn-secondary btn-sm" onclick="AiCenter.refresh()">🔄 Actualizar</button>
        </div>
        <div style="overflow:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:12px;">
            <thead>
              <tr style="text-align:left;color:var(--text2);">
                <th style="padding:6px;">ID</th>
                <th style="padding:6px;">Ref</th>
                <th style="padding:6px;">Módulo</th>
                <th style="padding:6px;">Estado</th>
                <th style="padding:6px;">Error</th>
              </tr>
            </thead>
            <tbody>
              ${(jobs || [])
                .map(
                  (j) => `
                <tr style="border-top:1px solid rgba(255,255,255,0.06);">
                  <td style="padding:6px;">${esc(j.id)}</td>
                  <td style="padding:6px;"><a href="#" style="color:var(--accent);" onclick="event.preventDefault();AiCenter.openProduct('${esc(j.ref)}')">${esc(j.ref)}</a></td>
                  <td style="padding:6px;">${esc(j.module)}</td>
                  <td style="padding:6px;">${esc(j.status)}</td>
                  <td style="padding:6px;color:var(--text2);max-width:220px;overflow:hidden;text-overflow:ellipsis;">${esc(j.last_error || '')}</td>
                </tr>`,
                )
                .join('') ||
                '<tr><td colspan="5" style="padding:12px;color:var(--text2);">Sin jobs recientes.</td></tr>'}
            </tbody>
          </table>
        </div>`;
    } catch (e) {
      host.innerHTML = `<div style="color:var(--red);padding:16px;">${esc(e.message || e)}</div>`;
    }
  }

  async function paintBody() {
    const host = document.getElementById('ai-center-body');
    if (!host) return;
    if (!api()) {
      host.innerHTML =
        '<div style="padding:16px;color:var(--red);">ProductIntelligenceApi no cargada. Recargá la página.</div>';
      return;
    }
    if (_tab === 'estado') return renderEstado(host);
    if (_tab === 'cola') return renderCola(host);
    if (_tab === 'modulos') return renderModulos(host);
    return renderJobs(host);
  }

  function renderAiCenter() {
    const el = document.getElementById('centro_ia-content');
    if (!el) return;
    el.innerHTML = `
      <div class="card" style="margin-bottom:12px;">
        <div class="card-title">Centro de IA</div>
        <div style="font-size:12px;color:var(--text2);line-height:1.45;margin-top:4px;">
          Goberná la inteligencia del catálogo Hera. La generación vive en el artículo;
          aquí ves cobertura, cola de aprobación, módulos y salud del worker.
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
    await paintBody();
  }

  async function accept(id) {
    if (_busy) return;
    _busy = true;
    try {
      const res = await api().accept(id);
      notify(
        'success',
        'Aprobado',
        res?.side_effects?.applied
          ? `Aplicado: ${res.side_effects.applied}`
          : 'Artifact aceptado',
      );
      await refresh();
    } catch (e) {
      notify('error', 'Aprobar', e.message || String(e));
    } finally {
      _busy = false;
      if (_tab === 'cola') await paintBody();
    }
  }

  async function reject(id) {
    if (_busy) return;
    _busy = true;
    try {
      await api().reject(id);
      notify('success', 'Rechazado', 'Sugerencia descartada.');
      await refresh();
    } catch (e) {
      notify('error', 'Rechazar', e.message || String(e));
    } finally {
      _busy = false;
      if (_tab === 'cola') await paintBody();
    }
  }

  async function runWorker() {
    if (_busy) return;
    _busy = true;
    try {
      const body = await api().invokeWorker({});
      if (body.error) notify('error', 'Worker', body.error);
      else if (body.processed) notify('success', 'Worker', `Procesado job #${body.job_id} (${body.module})`);
      else notify('success', 'Worker', body.reason || 'Sin jobs pendientes');
      await refresh();
    } catch (e) {
      notify('error', 'Worker', e.message || String(e));
    } finally {
      _busy = false;
      if (_tab === 'jobs') await paintBody();
    }
  }

  global.AppAiCenterModule = { renderAiCenter };
  global.AiCenter = {
    refresh,
    openProduct: openProductByRef,
    accept,
    reject,
    runWorker,
    setTab(id) {
      _tab = id;
      renderAiCenter();
    },
  };
})(window);
