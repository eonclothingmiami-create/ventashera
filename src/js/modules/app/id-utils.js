// Stable UUID helpers for Supabase uuid PK/FK columns (RFC 4122 v4 string format).
(function initAppId(global) {
  const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  function legacyUid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function uuidV4Fallback() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function uuid() {
    try {
      if (global.crypto && typeof global.crypto.randomUUID === 'function') {
        return global.crypto.randomUUID();
      }
    } catch (e) {
      /* ignore */
    }
    return uuidV4Fallback();
  }

  function isUuid(value) {
    if (value === null || value === undefined) return false;
    return UUID_RE.test(String(value).trim());
  }

  /** Prefer for new rows bound for Postgres uuid columns */
  function dbRowId() {
    return uuid();
  }

  global.AppId = {
    uuid,
    dbRowId,
    isUuid,
    legacyUid
  };
})(window);
