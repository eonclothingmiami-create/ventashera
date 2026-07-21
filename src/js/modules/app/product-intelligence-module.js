/**
 * Panel Product Intelligence en el modal de artículo.
 * Operador: Generar con IA (inline). Avanzado: regenerar módulo a módulo.
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

  const STATUS_LABELS = {
    empty: 'Vacía',
    partial: 'Parcial',
    complete: 'Completa',
    generating: 'Generando…',
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

  function moduleStatus(modules, key) {
    const m = modules && modules[key];
    return (m && m.status) || 'empty';
  }

  function setAiHint(text, isError) {
    const hint = document.getElementById('m-art-ai-hint');
    if (!hint) return;
    hint.textContent = text || '';
    hint.style.color = isError ? 'var(--red, #f87171)' : 'var(--text2)';
  }

  function setGenerateBtnBusy(busy) {
    const btn = document.getElementById('m-art-btn-generar-ia');
    if (!btn) return;
    btn.disabled = !!busy;
    btn.textContent = busy ? 'Generando…' : '✨ Generar con IA';
  }

  function applyCopyToForm(payload) {
    if (!payload) return;
    const nameEl = document.getElementById('m-art-nombre');
    const descEl = document.getElementById('m-art-desc');
    if (nameEl && payload.name) nameEl.value = payload.name;
    if (descEl) {
      const d =
        payload.description_short ||
        payload.description ||
        payload.description_long;
      if (d) descEl.value = d;
    }
  }

  function humanStatus(intel) {
    const raw = String(intel?.status || 'empty').toLowerCase();
    if (STATUS_LABELS[raw]) return STATUS_LABELS[raw];
    if (raw === 'ready' || raw === 'ok') return 'Completa';
    return raw || 'Vacía';
  }

  function formatRelative(iso) {
    if (!iso) return '';
    try {
      const t = new Date(iso).getTime();
      if (!Number.isFinite(t)) return '';
      const mins = Math.round((Date.now() - t) / 60000);
      if (mins < 1) return 'hace un momento';
      if (mins < 60) return `hace ${mins} min`;
      const hrs = Math.round(mins / 60);
      if (hrs < 48) return `hace ${hrs} h`;
      return new Date(iso).toLocaleString();
    } catch {
      return '';
    }
  }

  function checklistHtml(modules, gates) {
    const keys = ['copy', 'seo', 'attributes', 'knowledge'];
    return keys
      .map((k) => {
        const st = moduleStatus(modules, k);
        const ok = st === 'accepted' || st === 'done';
        const off = gates[k] === false;
        const mark = ok ? '✔' : off ? '○' : '·';
        const extra = off ? ' (off)' : ok ? '' : ` ${esc(st)}`;
        return `<span style="margin-right:10px;">${mark} ${esc(MODULE_LABELS[k])}${extra}</span>`;
      })
      .join('');
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
          Guardá el artículo primero (ref <code>HERA-*</code>). Después usá
          <strong style="color:var(--text1);">Generar con IA</strong> junto a la descripción.
        </div>`;
      return;
    }

    _ctx.ref = ref;
    wrap.innerHTML = `<div id="m-art-pi-body" style="font-size:12px;color:var(--text2);padding:4px 0;">Cargando…</div>`;

    const PI = api();
    if (!PI) {
      document.getElementById('m-art-pi-body').textContent =
        'ProductIntelligenceApi no cargada.';
      return;
    }

    try {
      const [intel, runtime] = await Promise.all([
        PI.getIntelligence(ref),
        PI.getRuntimeConfig().catch(() => null),
      ]);
      const modules = intel?.modules || {};
      const gates = (runtime && runtime.modules) || {};
      const when = formatRelative(intel?.updated_at);

      const advRows = PI.MODULES.map((mod) => {
        const st = moduleStatus(modules, mod);
        const enabled = gates[mod] !== false;
        return `
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.06);">
            <div>
              <strong style="color:var(--text1);">${esc(MODULE_LABELS[mod] || mod)}</strong>
              <span style="margin-left:8px;opacity:0.8;">${esc(st)}</span>
              ${enabled ? '' : '<span style="margin-left:6px;color:var(--orange);font-size:10px;">off</span>'}
            </div>
            <button type="button" class="btn btn-secondary btn-sm"
              ${ _busy || !enabled ? 'disabled' : '' }
              onclick="ProductIntelligence.enqueueModule('${esc(mod)}')">
              Regenerar
            </button>
          </div>`;
      }).join('');

      document.getElementById('m-art-pi-body').innerHTML = `
        <div style="margin-bottom:10px;line-height:1.45;">
          <div>Estado: <strong style="color:var(--text1);">${esc(humanStatus(intel))}</strong>
            ${when ? `<span style="opacity:0.75;"> · ${esc(when)}</span>` : ''}
          </div>
          <div style="margin-top:8px;font-size:11px;">${checklistHtml(modules, gates)}</div>
          <p style="margin:10px 0 0;font-size:11px;line-height:1.4;opacity:0.85;">
            El texto se genera con el botón <strong>Generar con IA</strong> junto a la descripción.
            SEO, atributos y knowledge se enriquecen solos en segundo plano.
          </p>
          ${intel?.last_error ? `<div style="color:var(--red);margin-top:6px;">${esc(intel.last_error)}</div>` : ''}
        </div>
        <details style="margin-top:8px;">
          <summary style="cursor:pointer;font-weight:700;color:var(--text1);font-size:12px;">Opciones avanzadas</summary>
          <div style="margin-top:8px;">${advRows}</div>
          <button type="button" class="btn btn-secondary btn-sm" style="margin-top:10px;width:100%;"
            onclick="ProductIntelligence.refresh()">Actualizar panel</button>
        </details>
      `;
    } catch (e) {
      document.getElementById('m-art-pi-body').innerHTML =
        `<div style="color:var(--red);">${esc(e.message || e)}</div>`;
    }
  }

  /**
   * Primary operator action: fill name + description, then silent enrichment.
   */
  async function generateInlineCopy() {
    const PI = api();
    if (!PI) {
      notify('error', 'Generar con IA', 'API no cargada');
      return;
    }
    if (_busy) return;

    if (!_ctx.id) {
      notify('error', 'Generar con IA', 'Guardá el artículo primero (con ref HERA-*).');
      setAiHint('Guardá el artículo primero.', true);
      return;
    }

    const ref =
      String(document.getElementById('m-art-codigo')?.value || _ctx.ref || '')
        .trim()
        .toUpperCase();
    if (!ref || !/^HERA-/i.test(ref)) {
      notify('error', 'Generar con IA', 'Falta una ref válida HERA-*');
      setAiHint('Falta ref HERA-*.', true);
      return;
    }

    _busy = true;
    _ctx.ref = ref;
    setGenerateBtnBusy(true);
    setAiHint('Generando texto…');

    try {
      const out = await PI.generateInlineCopy(ref);
      applyCopyToForm({
        name: out.name,
        description_short: out.description,
        description: out.description,
      });
      setAiHint('Listo. Revisá el texto.');
      notify(
        'success',
        'Generar con IA',
        'Texto generado. Revisá y guardá si cambiás otra cosa.',
      );

      // Background enrichment — never block the operator
      Promise.resolve()
        .then(() => PI.enqueueSilentEnrichment(ref))
        .then(() => refresh())
        .catch((e) => console.warn('[PI silent after copy]', e));

      await refresh();
    } catch (e) {
      setAiHint(e.message || String(e), true);
      notify('error', 'Generar con IA', e.message || String(e));
    } finally {
      _busy = false;
      setGenerateBtnBusy(false);
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
      if (res?.artifact?.artifact_type === 'copy' && res.artifact.payload) {
        applyCopyToForm(res.artifact.payload);
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

  /**
   * After saveArticulo — silent enrichment if modules incomplete.
   */
  function maybeSilentEnrichAfterSave(ref) {
    const PI = api();
    const clean = String(ref || '').trim().toUpperCase();
    if (!PI || !clean) return;
    Promise.resolve()
      .then(async () => {
        const intel = await PI.getIntelligence(clean).catch(() => null);
        if (!PI.shouldSilentEnrich(intel)) return;
        await PI.enqueueSilentEnrichment(clean);
      })
      .catch((e) => console.warn('[PI silent after save]', e?.message || e));
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
    generateInlineCopy,
    enqueueModule,
    acceptArtifact,
    rejectArtifact,
    maybeSilentEnrichAfterSave,
  };
})(window);
