/**
 * Parámetros legales de nómina Colombia (SMMLV, auxilio transporte).
 * - Tabla por año en código (fallback).
 * - Catálogo remoto en Supabase state_config.nomina_legal_catalog (sin redeploy).
 * - Auto-aplica al cambiar de año civil (zona America/Bogota) salvo bloqueo manual.
 */
(function initNominaParams(global) {
  /** Valores oficiales conocidos (actualizar cada diciembre o vía Supabase). */
  const LEGAL_NOMINA_BY_YEAR = {
    2024: { smmlv: 1300000, auxTrans: 162000, decreto: 'Decreto 2615/2023' },
    2025: { smmlv: 1423500, auxTrans: 200000, decreto: 'Decreto 1573/2024' },
    2026: { smmlv: 1750905, auxTrans: 249095, decreto: 'Decreto 1469/2025 · Aux. 1470/2025' },
  };

  let remoteCatalog = null;

  function calendarYearBogota(d = new Date()) {
    return parseInt(
      new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric' }).format(d),
      10,
    );
  }

  function legalForYear(year) {
    const y = Number(year);
    const remote = remoteCatalog?.[y] || remoteCatalog?.[String(y)];
    if (remote && Number(remote.smmlv) > 0) {
      return {
        smmlv: Number(remote.smmlv),
        auxTrans: Number(remote.auxTrans ?? remote.aux_trans ?? 0),
        decreto: remote.decreto || remote.ref || 'Catálogo remoto Supabase',
        source: 'remote',
      };
    }
    const local = LEGAL_NOMINA_BY_YEAR[y];
    if (local) {
      return { ...local, source: 'builtin' };
    }
    return null;
  }

  function latestKnownYear() {
    const years = new Set([
      ...Object.keys(LEGAL_NOMINA_BY_YEAR).map(Number),
      ...Object.keys(remoteCatalog || {}).map(Number),
    ]);
    return years.size ? Math.max(...years) : calendarYearBogota();
  }

  /** Lee SMMLV / aux. transporte vigentes para cálculos (cfg_game + fallback). */
  function getNominaParams(state) {
    const year = calendarYearBogota();
    const g = state?.cfg_game || {};
    const legal = legalForYear(g.nomina_vigencia_year || year);
    const smmlv = Number(g.smmlv) > 0 ? Number(g.smmlv) : legal?.smmlv || LEGAL_NOMINA_BY_YEAR[2026].smmlv;
    const auxTrans =
      Number(g.aux_trans) > 0 ? Number(g.aux_trans) : legal?.auxTrans || LEGAL_NOMINA_BY_YEAR[2026].auxTrans;
    return {
      year: Number(g.nomina_vigencia_year) || year,
      calendarYear: year,
      smmlv,
      auxTrans,
      decreto: g.nomina_decreto || legal?.decreto || '',
      manualLock: g.nomina_manual_lock === true,
      pendingOfficial: g.nomina_params_pending === true,
      source: g.nomina_params_source || legal?.source || 'cfg_game',
    };
  }

  async function hydrateRemoteCatalog(client) {
    if (!client?.from) return remoteCatalog;
    try {
      const { data } = await client.from('state_config').select('value').eq('key', 'nomina_legal_catalog').maybeSingle();
      if (!data?.value) return remoteCatalog;
      const raw = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
      if (raw && typeof raw === 'object') remoteCatalog = raw;
    } catch (e) {
      console.warn('[NominaParams] nomina_legal_catalog:', e?.message || e);
    }
    return remoteCatalog;
  }

  /**
   * Al cargar el ERP: si cambió el año y hay decreto en catálogo, actualiza cfg_game.
   * @returns {{ updated: boolean, notify?: object }}
   */
  async function autoSyncCfgGame(state, saveConfig, opts = {}) {
    if (!state) return { updated: false };
    const notify = opts.notify;
    const year = calendarYearBogota();
    if (!state.cfg_game || typeof state.cfg_game !== 'object') state.cfg_game = {};

    const g = state.cfg_game;
    const vigencia = Number(g.nomina_vigencia_year) || 0;
    const manualLock = g.nomina_manual_lock === true;

    if (manualLock && !opts.force) {
      return { updated: false, skipped: 'manual_lock' };
    }

    const legal = legalForYear(year);
    if (!legal) {
      if (year > latestKnownYear()) {
        g.nomina_params_pending = true;
        if (typeof saveConfig === 'function') {
          await saveConfig('cfg_game', g);
        }
        if (notify && !global.__HERA_NOMINA_PENDING_NOTIFIED) {
          global.__HERA_NOMINA_PENDING_NOTIFIED = true;
          notify(
            'warning',
            '📅',
            `Parámetros nómina ${year}`,
            'Aún no hay SMMLV/auxilio oficiales en el catálogo. Actualiza Config → Nómina o el registro nomina_legal_catalog en Supabase.',
            { duration: 9000 },
          );
        }
      }
      return { updated: false, pending: true };
    }

    const needsUpdate =
      opts.force ||
      vigencia !== year ||
      Number(g.smmlv) !== legal.smmlv ||
      Number(g.aux_trans) !== legal.auxTrans;

    if (!needsUpdate) {
      g.nomina_params_pending = false;
      return { updated: false };
    }

    state.cfg_game = {
      ...g,
      smmlv: legal.smmlv,
      aux_trans: legal.auxTrans,
      nomina_vigencia_year: year,
      nomina_decreto: legal.decreto,
      nomina_params_source: legal.source,
      nomina_params_pending: false,
      nomina_manual_lock: opts.force ? false : g.nomina_manual_lock,
      nomina_auto_updated_at: new Date().toISOString(),
    };

    if (typeof saveConfig === 'function') {
      await saveConfig('cfg_game', state.cfg_game);
    }

    if (notify && (opts.force || vigencia !== year)) {
      notify(
        'success',
        '✅',
        `Nómina ${year} actualizada`,
        `SMMLV ${legal.smmlv.toLocaleString('es-CO')} · Aux. transporte ${legal.auxTrans.toLocaleString('es-CO')} (${legal.decreto})`,
        { duration: 8000 },
      );
    }

    return { updated: true, legal, year };
  }

  /** Aplicar valores oficiales del año en curso (desde UI config). */
  async function applyOfficialForCurrentYear(state, saveConfig, notify) {
    return autoSyncCfgGame(state, saveConfig, { force: true, notify });
  }

  /** Sincroniza SMMLV/auxilio al abrir nómina si cambió el año (silencioso salvo actualización). */
  async function ensureLegalParamsFresh(state, saveConfig, notify) {
    return autoSyncCfgGame(state, saveConfig, { notify, force: false });
  }

  global.AppNominaParams = {
    LEGAL_NOMINA_BY_YEAR,
    calendarYearBogota,
    legalForYear,
    getNominaParams,
    hydrateRemoteCatalog,
    autoSyncCfgGame,
    applyOfficialForCurrentYear,
    ensureLegalParamsFresh,
  };
})(window);
