/**
 * Panel Product Intelligence en el modal de artículo (sin tocar saveArticulo).
 */
(function initProductIntelligenceModule(global) {
  const MODULE_LABELS = {
    copy: 'Copy',
    seo: 'SEO',
    attributes: 'Atributos',
    relations: 'Relaciones',
    knowledge: 'Knowledge',
    embedding: 'Embedding',
  };

  let _ctx = { id: null, ref: null };
  let _busy = false;

  function api() {
    return global.ProductIntelligenceApi;
  }

  function notify(type, title, msg) {
    if (typeof global.notify === 'function') {
      global.notify(type === 'error' ? 'error' : 'success', type === 'error' ? '⚠️' : '✨', title, msg);
      return;
    }
    console.log(`[PI ${type}]`, title, msg);
  }

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function payloadPreview(payload) {
    try {
      const t = JSON.stringify(payload, null, 2);
      return t.length > 900 ? t.slice(0, 900) + '\n…' : t;
    } catch {
      return String(payload || '');
    }
  }

  function moduleStatus(modules, key) {
    const m = modules && modules[key];
    return (m && m.status) || 'empty';
  }

  async function refresh() {
    const wrap = document.getElementById('m-art-inteligencia-wrap');
    if (!wrap) return;

    const ref =
      String(document.getElementById('m-art-codigo')?.value || _ctx.ref || '')
        .trim()
        .toUpperCase() || null;

    if (!_ctx.id || !ref) {
      wrap.innerHTML = `
        <div style="padding:12px;background:rgba(255,255,255,0.04);border-radius:8px;font-size:12px;color:var(--text2);line-height:1.45;">
          Guardá el artículo primero (con ref <code>HERA-*</code>) para generar copy, SEO, atributos y knowledge.
          El alta operativa no cambia: la IA no bloquea Guardar.
        </div>`;
      return;
    }

    _ctx.ref = ref;
    wrap.innerHTML = `
      <div style="font-size:11px;color:var(--text2);margin-bottom:4px;">Ref <code>${esc(ref)}</code></div>
      <div id="m-art-pi-body" style="font-size:12px;color:var(--text2);padding:4px 0;">Cargando…</div>`;

    const PI = api();
    if (!PI) {
      document.getElementById('m-art-pi-body').textContent =
        'ProductIntelligenceApi no cargada.';
      return;
    }

    try {
      const [intel, artifacts, runtime] = await Promise.all([
        PI.getIntelligence(ref),
        PI.listArtifacts(ref),
        PI.getRuntimeConfig().catch(() => null),
      ]);
      const modules = intel?.modules || {};
      const gates = (runtime && runtime.modules) || {};
      const suggested = (artifacts || []).filter((a) => a.status === 'suggested');
      const accepted = (artifacts || []).filter((a) => a.status === 'accepted');

      const rows = PI.MODULES.map((mod) => {
        const st = moduleStatus(modules, mod);
        const enabled = gates[mod] !== false;
        return `
          <div style="display:flex;align-items:center;gap:8px;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.06);">
            <div>
              <strong style="color:var(--text1);">${esc(MODULE_LABELS[mod] || mod)}</strong>
              <span style="margin-left:8px;opacity:0.8;">${esc(st)}</span>
              ${enabled ? '' : '<span style="margin-left:6px;color:var(--orange);font-size:10px;">manual/off</span>'}
            </div>
            <button type="button" class="btn btn-secondary btn-sm"
              ${ _busy || !enabled ? 'disabled' : '' }
              title="${enabled ? 'Regenerar' : 'Módulo desactivado en Centro de IA → Activación'}"
              onclick="ProductIntelligence.enqueueModule('${esc(mod)}')">
              Regenerar
            </button>
          </div>`;
      }).join('');

      const artCards = (suggested.length ? suggested : accepted.slice(0, 4))
        .map((a) => {
          const isSug = a.status === 'suggested';
          return `
            <div style="margin-top:10px;padding:10px;background:rgba(0,0,0,0.2);border-radius:8px;border:1px solid rgba(255,255,255,0.08);">
              <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;">
                <div>
                  <strong style="color:var(--text1);">${esc(a.artifact_type)}</strong>
                  <span style="opacity:0.75;"> · v${esc(a.version)} · ${esc(a.status)}</span>
                </div>
                <div style="display:flex;gap:6px;">
                  ${
                    isSug
                      ? `<button type="button" class="btn btn-primary btn-sm" onclick="ProductIntelligence.acceptArtifact('${esc(a.id)}')">Aprobar</button>
                         <button type="button" class="btn btn-secondary btn-sm" onclick="ProductIntelligence.rejectArtifact('${esc(a.id)}')">Rechazar</button>`
                      : ''
                  }
                </div>
              </div>
              <pre style="margin:8px 0 0;white-space:pre-wrap;word-break:break-word;font-size:10px;max-height:160px;overflow:auto;color:var(--text2);">${esc(payloadPreview(a.payload))}</pre>
            </div>`;
        })
        .join('');

      document.getElementById('m-art-pi-body').innerHTML = `
        <div style="margin-bottom:8px;line-height:1.4;">
          Estado: <strong style="color:var(--text1);">${esc(intel?.status || 'empty')}</strong>
          · provider <code>${esc(intel?.active_provider || 'openai')}</code>
          ${intel?.last_error ? `<div style="color:var(--red);margin-top:4px;">${esc(intel.last_error)}</div>` : ''}
        </div>
        <div style="margin-bottom:10px;">${rows}</div>
        <div style="font-size:11px;color:var(--text2);margin-bottom:6px;">
          Sugerencias pendientes: ${suggested.length}. Aprobar escribe en products / attributes / relations / search docs según el tipo.
        </div>
        ${artCards || '<div style="opacity:0.7;">Sin artifacts aún. Usá Regenerar en un módulo.</div>'}
        <button type="button" class="btn btn-secondary btn-sm" style="margin-top:10px;width:100%;"
          onclick="ProductIntelligence.refresh()">🔄 Actualizar panel</button>
      `;
    } catch (e) {
      document.getElementById('m-art-pi-body').innerHTML =
        `<div style="color:var(--red);">${esc(e.message || e)}</div>`;
    }
  }

  async function enqueueModule(module) {
    const PI = api();
    if (!PI || _busy) return;
    const ref =
      String(document.getElementById('m-art-codigo')?.value || _ctx.ref || '')
        .trim()
        .toUpperCase();
    if (!ref) {
      notify('error', 'Sugerencias IA', 'Falta ref HERA-*');
      return;
    }
    _busy = true;
    try {
      const { job, worker } = await PI.enqueue(ref, module, { run: true });
      if (worker && worker.reason === 'module_disabled') {
        notify('error', 'Módulo off', `${module} está desactivado en Centro de IA → Activación`);
      } else if (worker && worker.ok === false) {
        notify(
          'error',
          'Worker',
          worker.error ||
            'Job encolado pero el worker falló (¿OPENAI_API_KEY?).',
        );
      } else if (worker && worker.processed) {
        notify('success', 'Sugerencias IA', `${MODULE_LABELS[module] || module} generado (sugerido).`);
      } else {
        notify('success', 'Sugerencias IA', `Job #${job?.id} encolado.`);
      }
      await refresh();
    } catch (e) {
      notify('error', 'Sugerencias IA', e.message || String(e));
      await refresh();
    } finally {
      _busy = false;
    }
  }

  async function acceptArtifact(id) {
    const PI = api();
    if (!PI || _busy) return;
    _busy = true;
    try {
      const res = await PI.accept(id);
      notify(
        'success',
        'Aprobado',
        res?.side_effects?.applied
          ? `Aplicado: ${res.side_effects.applied}`
          : 'Artifact aceptado',
      );
      // Sync modal fields if copy was applied
      if (res?.artifact?.artifact_type === 'copy' && res.artifact.payload) {
        const nameEl = document.getElementById('m-art-nombre');
        const descEl = document.getElementById('m-art-desc');
        if (nameEl && res.artifact.payload.name) nameEl.value = res.artifact.payload.name;
        if (descEl) {
          const d =
            res.artifact.payload.description_long ||
            res.artifact.payload.description_short ||
            res.artifact.payload.description;
          if (d) descEl.value = d;
        }
      }
      await refresh();
    } catch (e) {
      notify('error', 'Aprobar', e.message || String(e));
    } finally {
      _busy = false;
    }
  }

  async function rejectArtifact(id) {
    const PI = api();
    if (!PI || _busy) return;
    _busy = true;
    try {
      await PI.reject(id);
      notify('success', 'Rechazado', 'Sugerencia descartada.');
      await refresh();
    } catch (e) {
      notify('error', 'Rechazar', e.message || String(e));
    } finally {
      _busy = false;
    }
  }

  function initForModal({ id, ref } = {}) {
    _ctx = {
      id: id || null,
      ref: ref ? String(ref).trim().toUpperCase() : null,
    };
    const wrap = document.getElementById('m-art-inteligencia-wrap');
    if (!wrap) return;
    refresh();
  }

  global.ProductIntelligence = {
    initForModal,
    refresh,
    enqueueModule,
    acceptArtifact,
    rejectArtifact,
  };
})(window);
