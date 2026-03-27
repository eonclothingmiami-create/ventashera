// Puntos de restauración local (IndexedDB) + exportación JSON. Complementa backups de Supabase.
(function initBackupModule(global) {
  const DB_NAME = 'hera_erp_restore';
  const DB_VER = 1;
  const STORE = 'snapshots';
  const INDEX_KEY = 'hera_backup_index_v1';
  const AUTO_MAX = 12;
  const FORMAT = 'hera-backup-v1';

  const CONFIG_KEYS = [
    'empresa',
    'meta',
    'game',
    'consecutivos',
    'diasLocal',
    'diasInter',
    'cfg_game',
    'cfg_categorias',
    'cfg_secciones',
    'cfg_transportadoras',
    'cfg_metodos_pago',
    'cfg_tarifas',
    'cfg_impuestos',
    'nom_conceptos',
    'bodegas',
    'cajas',
  ];

  function readIndex() {
    try {
      const raw = global.localStorage.getItem(INDEX_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (_) {
      return [];
    }
  }

  function writeIndex(arr) {
    global.localStorage.setItem(INDEX_KEY, JSON.stringify(arr.slice(0, 80)));
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = global.indexedDB.open(DB_NAME, DB_VER);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve(req.result);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' });
        }
      };
    });
  }

  function idbPut(rec) {
    return openDb().then(
      (db) =>
        new Promise((resolve, reject) => {
          const tx = db.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).put(rec);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        }),
    );
  }

  function idbGet(id) {
    return openDb().then(
      (db) =>
        new Promise((resolve, reject) => {
          const tx = db.transaction(STORE, 'readonly');
          const q = tx.objectStore(STORE).get(id);
          q.onsuccess = () => resolve(q.result || null);
          q.onerror = () => reject(q.error);
        }),
    );
  }

  function idbDelete(id) {
    return openDb().then(
      (db) =>
        new Promise((resolve, reject) => {
          const tx = db.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).delete(id);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        }),
    );
  }

  function pickConfigState(state) {
    const out = {};
    for (let i = 0; i < CONFIG_KEYS.length; i++) {
      const k = CONFIG_KEYS[i];
      if (state[k] !== undefined) {
        try {
          out[k] = JSON.parse(JSON.stringify(state[k]));
        } catch (_) {
          out[k] = state[k];
        }
      }
    }
    return out;
  }

  function pickFullState(state) {
    try {
      return JSON.parse(JSON.stringify(state));
    } catch (e) {
      console.warn('[backup] full clone:', e);
      return pickConfigState(state);
    }
  }

  async function createSnapshot(state, opts) {
    const label = (opts && opts.label) || 'Sin nombre';
    const scope = (opts && opts.scope) === 'full' ? 'full' : 'config';
    const id =
      global.AppId?.uuid?.() ||
      `bk_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const createdAt = new Date().toISOString();
    const payload =
      scope === 'full' ? pickFullState(state) : pickConfigState(state);
    const json = JSON.stringify({
      format: FORMAT,
      scope,
      createdAt,
      label,
      payload,
    });
    const rec = {
      id,
      format: FORMAT,
      scope,
      createdAt,
      label,
      json,
    };
    await idbPut(rec);
    const idx = readIndex();
    idx.unshift({
      id,
      scope,
      label,
      createdAt,
      sizeBytes: json.length,
    });
    writeIndex(idx);
    return { id, createdAt };
  }

  async function deleteSnapshot(id) {
    await idbDelete(id);
    const idx = readIndex().filter((x) => x.id !== id);
    writeIndex(idx);
  }

  async function exportSnapshotToFile(id) {
    const rec = await idbGet(id);
    if (!rec || !rec.json) return { ok: false, error: 'No encontrado' };
    const blob = new Blob([rec.json], { type: 'application/json;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `hera-backup-${id.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    return { ok: true };
  }

  async function restoreSnapshot(id, ctx) {
    const { state, saveConfig, saveRecord, notify, renderConfig, renderAll, confirm } = ctx;
    const rec = await idbGet(id);
    if (!rec || !rec.json) {
      if (notify) notify('warning', '⚠️', 'Backup', 'No se encontró el punto de restauración.', { duration: 4000 });
      return { ok: false };
    }
    let parsed;
    try {
      parsed = JSON.parse(rec.json);
    } catch (e) {
      if (notify) notify('danger', '⚠️', 'Backup', 'JSON inválido.', { duration: 4000 });
      return { ok: false };
    }
    if (parsed.format !== FORMAT || !parsed.payload) {
      if (notify) notify('danger', '⚠️', 'Backup', 'Formato no reconocido.', { duration: 4000 });
      return { ok: false };
    }
    const scope = parsed.scope || 'config';
    const msg =
      scope === 'full'
        ? '¿Restaurar COPIA COMPLETA del estado? Esto reemplaza datos en memoria; luego se intentará persistir en Supabase. Operación delicada.'
        : '¿Restaurar configuración (empresa, categorías, cajas, gamificación, etc.) desde este punto?';
    if (confirm && !confirm(msg)) return { ok: false };

    const p = parsed.payload;
    if (scope === 'full') {
      const keys = Object.keys(p);
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        try {
          state[k] = JSON.parse(JSON.stringify(p[k]));
        } catch (_) {
          state[k] = p[k];
        }
      }
    } else {
      const ck = Object.keys(p);
      for (let i = 0; i < ck.length; i++) {
        const k = ck[i];
        try {
          state[k] = JSON.parse(JSON.stringify(p[k]));
        } catch (_) {
          state[k] = p[k];
        }
      }
    }

    try {
      if (saveConfig) {
        await saveConfig('empresa', state.empresa);
        await saveConfig('meta', state.meta);
        await saveConfig('game', state.game);
        await saveConfig('consecutivos', state.consecutivos);
        await saveConfig('diasLocal', state.diasLocal);
        await saveConfig('diasInter', state.diasInter);
        await saveConfig('cfg_game', state.cfg_game);
      }
      if (saveRecord) {
        const collections = [
          'cfg_categorias',
          'cfg_secciones',
          'cfg_transportadoras',
          'cfg_metodos_pago',
          'cfg_tarifas',
          'cfg_impuestos',
          'nom_conceptos',
          'bodegas',
          'cajas',
        ];
        for (let c = 0; c < collections.length; c++) {
          const col = collections[c];
          const rows = state[col];
          if (!Array.isArray(rows)) continue;
          for (let r = 0; r < rows.length; r++) {
            const row = rows[r];
            if (row && row.id) await saveRecord(col, row.id, row);
          }
        }
      }
    } catch (e) {
      console.warn('[backup] persist:', e);
      if (notify) {
        notify(
          'warning',
          '⚠️',
          'Restauración parcial',
          'Datos aplicados en memoria; parte del guardado en nube falló. Revisa conexión y vuelve a guardar.',
          { duration: 8000 },
        );
      }
    }

    if (typeof renderConfig === 'function') renderConfig();
    if (typeof renderAll === 'function') renderAll();
    if (notify) notify('success', '✅', 'Restauración', 'Punto de restauración aplicado.', { duration: 4000 });
    return { ok: true };
  }

  async function importFromJsonFile(file, ctx) {
    const text = await file.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      if (ctx.notify) ctx.notify('danger', '⚠️', 'Importar', 'Archivo JSON inválido.', { duration: 4000 });
      return { ok: false };
    }
    if (parsed.format !== FORMAT || !parsed.payload) {
      if (ctx.notify) ctx.notify('danger', '⚠️', 'Importar', 'No es un backup HERA v1.', { duration: 4000 });
      return { ok: false };
    }
    const id =
      global.AppId?.uuid?.() ||
      `imp_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const rec = {
      id,
      format: FORMAT,
      scope: parsed.scope || 'config',
      createdAt: parsed.createdAt || new Date().toISOString(),
      label: parsed.label || 'Importado',
      json: typeof text === 'string' ? text.trim() : JSON.stringify(parsed),
    };
    await idbPut(rec);
    const idx = readIndex();
    idx.unshift({
      id,
      scope: rec.scope,
      label: rec.label,
      createdAt: rec.createdAt,
      sizeBytes: rec.json.length,
    });
    writeIndex(idx);
    if (ctx.notify) ctx.notify('success', '📥', 'Importar', 'Copia importada a la lista. Puedes restaurarla cuando quieras.', { duration: 5000 });
    return { ok: true, id };
  }

  let autoCount = 0;

  function getStateRef() {
    return global.__HERA_STATE__ || global.state;
  }

  function afterConfigSaved(st) {
    try {
      const enabled = global.localStorage.getItem('hera_backup_auto') !== '0';
      if (!enabled) return;
      const stateRef = st || getStateRef();
      if (!stateRef) return;
      autoCount += 1;
      if (autoCount % 3 !== 0) return;
      const label = `Auto · ${new Date().toLocaleString()}`;
      createSnapshot(stateRef, { label, scope: 'config' }).then(() => {
        const idx = readIndex();
        const autos = idx.filter((x) => String(x.label || '').startsWith('Auto ·'));
        const others = idx.filter((x) => !String(x.label || '').startsWith('Auto ·'));
        while (autos.length > AUTO_MAX) {
          const old = autos.pop();
          if (old && old.id) idbDelete(old.id).catch(() => {});
        }
        writeIndex([...autos, ...others].slice(0, 80));
      });
    } catch (e) {
      console.warn('[backup] auto:', e);
    }
  }

  function renderBackupsTab(ctx) {
    const { state, notify, confirm } = ctx;
    const idx = readIndex();
    const rows =
      idx.length === 0
        ? '<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--text2)">Sin copias guardadas. Crea una manual o activa la copia automática al guardar configuración.</td></tr>'
        : idx
            .map((x) => {
              const safeId = String(x.id).replace(/'/g, "\\'");
              const sz = x.sizeBytes ? `${Math.round(x.sizeBytes / 1024)} KB` : '—';
              return `<tr>
            <td style="font-size:11px;white-space:nowrap">${(x.createdAt || '').replace('T', ' ').slice(0, 19)}</td>
            <td><span class="badge ${x.scope === 'full' ? 'badge-warn' : 'badge-ok'}">${x.scope === 'full' ? 'Completa' : 'Config'}</span></td>
            <td style="font-weight:600">${String(x.label || '').replace(/</g, '&lt;')}</td>
            <td style="font-size:11px;color:var(--text2)">${sz}</td>
            <td><div class="btn-group">
              <button type="button" class="btn btn-xs btn-primary" onclick="heraRestoreBackup('${safeId}')">Restaurar</button>
              <button type="button" class="btn btn-xs btn-secondary" onclick="heraExportBackup('${safeId}')">Exportar</button>
              <button type="button" class="btn btn-xs btn-danger" onclick="heraDeleteBackup('${safeId}')">✕</button>
            </div></td>
          </tr>`;
            })
            .join('');

    const autoOn = global.localStorage.getItem('hera_backup_auto') !== '0';

    document.getElementById('cfg-tab-body').innerHTML = `
    <div class="card">
      <div class="card-title">💾 Puntos de restauración (este navegador)</div>
      <p style="font-size:12px;color:var(--text2);line-height:1.5;margin:0 0 12px">
        Las copias se guardan en <b>IndexedDB</b> de este equipo. No sustituyen el respaldo del servidor (Supabase);
        sirven para deshacer cambios de <b>configuración</b> o recuperar un estado completo en memoria antes de sincronizar.
      </p>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;align-items:center">
        <label style="display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer">
          <input type="checkbox" id="hera-backup-auto" ${autoOn ? 'checked' : ''} onchange="heraToggleBackupAuto(this.checked)">
          Copia automática de configuración (cada 3er guardado completo)
        </label>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px">
        <button type="button" class="btn btn-sm btn-primary" onclick="heraCreateBackup('config')">+ Punto (solo configuración)</button>
        <button type="button" class="btn btn-sm btn-secondary" onclick="heraCreateBackup('full')">+ Copia completa del estado</button>
        <label class="btn btn-sm btn-secondary" style="cursor:pointer;margin:0">
          📥 Importar JSON
          <input type="file" accept="application/json,.json" style="display:none" onchange="heraImportBackupFile(this)">
        </label>
      </div>
    </div>
    <div class="card">
      <div class="card-title">Copias guardadas (${idx.length})</div>
      <div class="table-wrap">
        <table><thead><tr><th>Fecha</th><th>Alcance</th><th>Etiqueta</th><th>Tamaño</th><th></th></tr></thead>
        <tbody>${rows}</tbody></table>
      </div>
    </div>`;
  }

  global.heraToggleBackupAuto = function (on) {
    global.localStorage.setItem('hera_backup_auto', on ? '1' : '0');
  };

  global.heraCreateBackup = async function (scope) {
    const label = prompt('Nombre o nota para esta copia:', scope === 'full' ? 'Completa' : 'Configuración');
    if (label === null) return;
    const st = getStateRef();
    if (!st) {
      if (global.notify) global.notify('warning', '⚠️', 'Estado', 'Recarga la página e inténtalo de nuevo.', { duration: 4000 });
      return;
    }
    try {
      if (typeof global.showLoadingOverlay === 'function') global.showLoadingOverlay('connecting');
      await createSnapshot(st, { label: label || 'Copia', scope });
      if (global.notify) global.notify('success', '✅', 'Copia creada', 'Punto de restauración guardado en este navegador.', { duration: 4000 });
      if (typeof global.renderCfgTab === 'function') global.renderCfgTab('backups');
    } catch (e) {
      if (global.notify) global.notify('danger', '⚠️', 'Error', e.message || String(e), { duration: 5000 });
    } finally {
      if (typeof global.showLoadingOverlay === 'function') global.showLoadingOverlay('hide');
    }
  };

  global.heraRestoreBackup = function (id) {
    const st = getStateRef();
    if (!st) {
      if (global.notify) global.notify('warning', '⚠️', 'Estado', 'Recarga la página e inténtalo de nuevo.', { duration: 4000 });
      return;
    }
    restoreSnapshot(id, {
      state: st,
      saveConfig: global.saveConfig,
      saveRecord: global.saveRecord,
      notify: global.notify,
      renderConfig: global.renderConfig,
      renderAll: global.renderAll,
      confirm: global.confirm,
    }).then(() => {
      if (typeof global.renderCfgTab === 'function') global.renderCfgTab('backups');
    });
  };

  global.heraExportBackup = function (id) {
    exportSnapshotToFile(id).then((r) => {
      if (!r.ok && global.notify) global.notify('warning', '⚠️', 'Exportar', 'No se pudo exportar.', { duration: 3000 });
    });
  };

  global.heraDeleteBackup = function (id) {
    if (!global.confirm('¿Eliminar esta copia del navegador?')) return;
    deleteSnapshot(id).then(() => {
      if (global.notify) global.notify('success', '🗑️', 'Eliminada', '', { duration: 2500 });
      if (typeof global.renderCfgTab === 'function') global.renderCfgTab('backups');
    });
  };

  global.heraImportBackupFile = function (input) {
    const f = input.files && input.files[0];
    input.value = '';
    if (!f) return;
    importFromJsonFile(f, { notify: global.notify }).then(() => {
      if (typeof global.renderCfgTab === 'function') global.renderCfgTab('backups');
    });
  };

  global.AppBackupModule = {
    createSnapshot,
    deleteSnapshot,
    exportSnapshotToFile,
    restoreSnapshot,
    importFromJsonFile,
    afterConfigSaved,
    renderBackupsTab,
    FORMAT,
  };
})(window);
