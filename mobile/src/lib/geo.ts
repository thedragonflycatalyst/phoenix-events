// Free place lookups via OpenStreetMap Nominatim (US only).
const UA = { 'Accept-Language': 'en', 'User-Agent': 'PhoenixCommunity/1.0 (org.thephoenixcatalyst.community)' };

export async function geocode(q: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=${encodeURIComponent(q)}`, { headers: UA });
    const [hit] = await r.json();
    return hit ? { lat: Number(hit.lat), lng: Number(hit.lon) } : null;
  } catch { return null; }
}

export type Near = { zip: string; lat: number; lng: number; label: string };
/** Looks up a 5-digit US ZIP code; label reads like "21044 (Columbia)". */
export async function lookupZip(zip: string): Promise<Near | null> {
  if (!/^\d{5}$/.test(zip)) return null;
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&addressdetails=1&postalcode=${zip}`, { headers: UA });
    const [hit] = await r.json();
    if (!hit) return null;
    const a = hit.address ?? {};
    const town = a.city || a.town || a.village || a.hamlet || a.suburb || a.county || String(hit.display_name ?? '').split(',')[0];
    return { zip, lat: Number(hit.lat), lng: Number(hit.lon), label: town ? `${zip} (${town})` : zip };
  } catch { return null; }
}
