/**
 * TRM COP/USD en tiempo real (cache 1h). Fallback configurable si la API falla.
 */
const FX_URL = Deno.env.get("FX_COP_USD_URL")?.trim() ||
  "https://open.er-api.com/v6/latest/USD";
const CACHE_MS = Math.max(
  60_000,
  Number(Deno.env.get("FX_COP_USD_CACHE_MS") || 3_600_000) || 3_600_000,
);

let memCache: { copPerUsd: number; fetchedAt: number } | null = null;

export type TrmSnapshot = {
  copPerUsd: number;
  source: "live" | "cache" | "fallback";
  fetchedAt: string;
};

export async function getCopPerUsd(fallback = 4000): Promise<number> {
  const snap = await getTrmSnapshot(fallback);
  return snap.copPerUsd;
}

export async function getTrmSnapshot(fallback = 4000): Promise<TrmSnapshot> {
  const now = Date.now();
  if (memCache && now - memCache.fetchedAt < CACHE_MS) {
    return {
      copPerUsd: memCache.copPerUsd,
      source: "cache",
      fetchedAt: new Date(memCache.fetchedAt).toISOString(),
    };
  }

  try {
    const res = await fetch(FX_URL, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`fx_http_${res.status}`);
    const data = await res.json() as { rates?: { COP?: number } };
    const cop = Number(data?.rates?.COP);
    if (!Number.isFinite(cop) || cop <= 0) throw new Error("fx_invalid_cop");
    memCache = { copPerUsd: cop, fetchedAt: now };
    return {
      copPerUsd: cop,
      source: "live",
      fetchedAt: new Date(now).toISOString(),
    };
  } catch {
    const fb = Number(fallback) || 4000;
    return {
      copPerUsd: fb,
      source: "fallback",
      fetchedAt: new Date(now).toISOString(),
    };
  }
}

/** COP → USD redondeado a centavos (2 decimales). */
export function copToUsd(cop: number, copPerUsd: number): number {
  const trm = Number(copPerUsd) || 4000;
  const usd = Number(cop) / trm;
  return Math.max(0.01, Math.round(usd * 100) / 100);
}

/** COP → centavos USD (entero) para APIs tipo Faire. */
export function copToUsdCents(cop: number, copPerUsd: number): number {
  return Math.max(1, Math.round(copToUsd(cop, copPerUsd) * 100));
}

export function usdStringFromCop(cop: number, copPerUsd: number, minUsd = 0.99): string {
  return Math.max(minUsd, copToUsd(cop, copPerUsd)).toFixed(2);
}

export function shippingUnitCop(
  shippingCopPerKg: number,
  unitsPerKg: number,
): number {
  const units = Math.max(1, Math.floor(Number(unitsPerKg) || 12));
  return Number(shippingCopPerKg) / units;
}
