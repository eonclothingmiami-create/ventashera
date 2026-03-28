// Anti-desincronización ligera: TTL por módulo, barra global, bloqueo de acciones críticas mientras sincroniza.
(function initSyncGuard(global) {
  const TTL_MS = 95000;
  let depth = 0;
  let message = 'Sincronizando datos…';
  const lastAt = { pos: 0, inventario: 0, tes_prov: 0 };

  function stripEl() {
    return global.document.getElementById('erp-sync-strip');
  }

  function updateBar() {
    const el = stripEl();
    if (!el) return;
    if (depth > 0) {
      el.style.display = 'block';
      el.textContent = message;
      el.setAttribute('aria-busy', 'true');
    } else {
      el.style.display = 'none';
      el.removeAttribute('aria-busy');
    }
  }

  global.AppSyncGuard = {
    TTL_MS,
    beginSync(msg) {
      depth += 1;
      if (msg) message = String(msg);
      updateBar();
    },
    endSync() {
      depth = Math.max(0, depth - 1);
      updateBar();
    },
    isBusy() {
      return depth > 0;
    },
    markSynced(module) {
      const k = String(module || '');
      if (k === 'pos' || k === 'inventario' || k === 'tes_prov') {
        lastAt[k] = Date.now();
      }
    },
    markAllSynced() {
      const t = Date.now();
      lastAt.pos = t;
      lastAt.inventario = t;
      lastAt.tes_prov = t;
    },
    isStale(module) {
      const k = String(module || '');
      if (k !== 'pos' && k !== 'inventario' && k !== 'tes_prov') return false;
      const t = lastAt[k];
      if (!t) return true;
      return Date.now() - t > TTL_MS;
    },
    /** Tooltip / mensaje unificado para botones deshabilitados */
    waitMessage: 'Espera a que termine la sincronización',
    staleMessage: 'Actualizando datos desde el servidor…',
  };
})(window);
