// Fills in an event's description from its own web page when the flyer lists one.
// Free: the phone fetches the page directly, no paid service.
import type { PosterGuess } from './parse';

const decode = (s: string) => s
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n))).replace(/\s+/g, ' ').trim();

function meta(html: string, names: string[]) {
  for (const n of names) {
    const re = new RegExp(`<meta[^>]+(?:property|name)=["']${n}["'][^>]*content=["']([^"']{20,})["']|<meta[^>]+content=["']([^"']{20,})["'][^>]*(?:property|name)=["']${n}["']`, 'i');
    const m = html.match(re);
    if (m) return decode(m[1] ?? m[2] ?? '');
  }
  return '';
}

/** Returns the page's own summary of the event, or '' when there's no page or it can't be read. */
export async function detailsFromWeb(url: string, timeoutMs = 6000): Promise<{ text: string; site: string }> {
  if (!/^https?:\/\//i.test(url)) return { text: '', site: '' };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'text/html' } });
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('html')) return { text: '', site: '' };
    const html = (await res.text()).slice(0, 400_000);
    const text = meta(html, ['og:description', 'description', 'twitter:description']).slice(0, 800);
    return { text, site: new URL(res.url || url).hostname.replace(/^www\./, '') };
  } catch {
    return { text: '', site: '' };
  } finally { clearTimeout(timer); }
}

/** Prefers the event page's description; falls back to the flyer's own words. */
export async function withWebDetails(g: PosterGuess): Promise<PosterGuess & { detailsFrom?: string }> {
  if (!g.url) return g;
  const web = await detailsFromWeb(g.url);
  if (web.text.length < 40) return g;
  return { ...g, description: web.text, detailsFrom: web.site };
}
