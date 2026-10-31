// Free, on-device poster reading: Tesseract.js reads the text, chrono-node finds dates and times,
// and simple rules guess the title, place, link, cost and category. Nothing leaves the phone.
let tesseractLoading;
function loadTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  tesseractLoading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
    s.onload = () => resolve(window.Tesseract);
    s.onerror = () => { tesseractLoading = null; reject(new Error('Could not load the text reader. Check your connection and try again.')); };
    document.head.appendChild(s);
  });
  return tesseractLoading;
}

const ADDRESS = /\b\d{1,6}\s+(?:(?:Route|Rte|Highway|Hwy|US|MD)[ -]?\d{1,4}|[A-Za-z0-9.' -]{2,40}?\s(?:Road|Rd|Street|St|Avenue|Ave|Boulevard|Blvd|Drive|Dr|Lane|Ln|Way|Court|Ct|Parkway|Pkwy|Place|Pl|Circle|Cir|Pike|Highway|Hwy|Route|Rte|Terrace|Ter))\b\.?(?:[ ,]+[A-Za-z .]+,?\s*(?:MD|Maryland)?\s*\d{5})?/i;
const VENUE = /\b(park|center|centre|library|church|school|hall|lake|trail|pavilion|plaza|mall|drive-?in|theater|theatre|garden|field|farm|museum|village|pool|gym|cafe|brewery)\b/i;
const CATEGORY_WORDS = [
  ['arts', /\b(haunted|halloween|festival|concert|movie|film|double feature|drive-?in|theater|theatre|dance|poetry|craft|paint(ing)?|art show|music|holiday lights?|parade|trivia)\b/gi],
  ['environmental', /\b(tree|plant(ing)?|clean-?up|litter|garden(ing)?|nature|earth day|arbor|recycl\w*|compost|wildlife|stream|river|watershed|invasive|conservation)\b/gi],
  ['wellness', /\b(5k|10k|run|race|walk|yoga|fitness|workout|bike|cycling|swim|zumba|pickleball|sports?|bootcamp|hike)\b/gi],
  ['mental', /\b(meditat\w*|mindful\w*|sound bath|mental health|support group|grief|journal\w*|healing|breathwork|well-?being)\b/gi],
  ['community', /\b(food drive|donation drive|pantry|potluck|volunteer|neighbou?r\w*|community|market|fair|meetup|swap|party|celebration|block party|coat drive|toy drive)\b/gi],
];

// Score each pillar; words in the title count triple. Ties go to the earlier, more specific list.
export function guessCategory(text, title = '') {
  let best = 'community', bestScore = 0;
  for (const [cat, re] of CATEGORY_WORDS) {
    const score = (text.match(re) || []).length + 3 * (title.match(re) || []).length;
    if (score > bestScore) { best = cat; bestScore = score; }
  }
  return best;
}

export async function readPoster(file, onProgress) {
  const T = await loadTesseract();
  const worker = await T.createWorker('eng', 1, {
    logger: (m) => { if (m.status === 'recognizing text' && onProgress) onProgress(pass * 0.5 + m.progress * 0.5); },
  });
  let pass = 0;
  try {
    const { data } = await worker.recognize(file);
    // Tesseract often misses very large headline letters; a half-size copy catches them.
    pass = 1;
    const small = await scaleImage(file, 0.5).catch(() => null);
    if (small) {
      const { data: d2 } = await worker.recognize(small);
      const seen = new Set(data.lines.map((l) => norm(l.text)));
      const extra = d2.lines.filter((l) => norm(l.text).length >= 3 && !seen.has(norm(l.text)))
        .map((l) => ({ ...l, bbox: { x0: l.bbox.x0 * 2, x1: l.bbox.x1 * 2, y0: l.bbox.y0 * 2, y1: l.bbox.y1 * 2 } }));
      if (extra.length) {
        data.lines = [...data.lines, ...extra].sort((a, b) => a.bbox.y0 - b.bbox.y0);
        data.text = data.lines.map((l) => l.text.trim()).join('\n');
      }
    }
    const chrono = await import('https://esm.sh/chrono-node@2.7.7');
    return parsePoster(data, chrono);
  } finally {
    worker.terminate();
  }
}
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
async function scaleImage(file, factor) {
  const bmp = await createImageBitmap(file);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * factor)); c.height = Math.max(1, Math.round(bmp.height * factor));
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((res) => c.toBlob(res, 'image/png'));
}

export function parsePoster(data, chrono) {
  const text = (data.text || '').replace(/[|_~]{2,}/g, ' ').replace(/[ \t]+/g, ' ').trim();
  const lines = (data.lines || []).map((l) => ({
    text: l.text.trim(),
    h: l.bbox ? l.bbox.y1 - l.bbox.y0 : 0,
    conf: l.confidence ?? 0,
  })).filter((l) => (l.text.match(/[A-Za-z]/g) || []).length >= 3 && l.conf > 40);

  const found = { title: '', start: null, end: null, allDay: false, location_name: '', address: '', url: '', cost: 'free', category: 'community', description: '' };

  // Dates and times
  const ref = new Date();
  const results = chrono.parse(text, ref, { forwardDate: true });
  const dated = results.find((r) => r.start.isCertain('day') || r.start.isCertain('weekday'));
  if (dated) {
    found.start = dated.start.date();
    if (dated.end) found.end = dated.end.date();
    if (!dated.start.isCertain('hour')) {
      // A time may appear on its own line ("5-7 PM")
      const timed = results.find((r) => r !== dated && r.start.isCertain('hour'));
      if (timed) {
        const s = timed.start.date();
        found.start.setHours(s.getHours(), s.getMinutes(), 0, 0);
        if (timed.end) { const e = timed.end.date(); found.end = new Date(found.start); found.end.setHours(e.getHours(), e.getMinutes(), 0, 0); }
      } else {
        found.allDay = true;
      }
    }
    if (found.end && found.end < found.start) found.end.setDate(found.end.getDate() + 1);
  }

  // Title: the largest text on the poster that isn't the date
  const used = new Set();
  const dateText = results.map((r) => r.text.toLowerCase());
  const isDateLine = (t) => dateText.some((d) => t.toLowerCase().includes(d) || d.includes(t.toLowerCase())) || chrono.parse(t, ref).length > 0;
  const candidates = lines.filter((l) => !isDateLine(l.text) && !ADDRESS.test(l.text) && l.text.length <= 80);
  candidates.sort((a, b) => b.h - a.h);
  if (candidates[0]) {
    // Join a second line of the same size ("HAUNTED" / "TRAIL")
    const top = candidates[0];
    const twin = candidates.find((l) => l !== top && Math.abs(l.h - top.h) <= top.h * 0.15);
    const idxTop = lines.indexOf(top), idxTwin = twin ? lines.indexOf(twin) : -1;
    let title = top.text;
    used.add(top);
    if (twin && Math.abs(idxTop - idxTwin) === 1) { title = idxTop < idxTwin ? `${top.text} ${twin.text}` : `${twin.text} ${top.text}`; used.add(twin); }
    found.title = tidy(title).slice(0, 140);
  }

  // Place
  const addr = text.match(ADDRESS);
  if (addr) found.address = tidy(addr[0]);
  const venue = lines.find((l) => !used.has(l) && VENUE.test(l.text) && !ADDRESS.test(l.text) && !isDateLine(l.text));
  if (venue) found.location_name = tidy(venue.text).replace(/^(at|@|location:?|where:?)\s+/i, '').slice(0, 200);

  const url = text.match(/\b(?:https?:\/\/|www\.)[^\s]+/i);
  if (url) found.url = (url[0].startsWith('http') ? url[0] : `https://${url[0]}`).replace(/[.,;)]+$/, '');
  if (/\b(donation|suggested|pay what you can)\b/i.test(text)) found.cost = 'donation';
  else if (/\$\s?\d/.test(text) && !/\bfree\b/i.test(text)) found.cost = 'paid';
  found.category = guessCategory(text, found.title);
  found.description = text.slice(0, 2000);
  return found;
}

function tidy(s) {
  const t = s.replace(/\s+/g, ' ').replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9!?.)]+$/g, '').trim();
  // Posters shout; turn ALL CAPS into Title Case for readability
  return t === t.toUpperCase() ? t.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase()) : t;
}

// Shrink photos before upload: long edge 1600px, JPEG
export async function compressImage(file, maxEdge = 1600, quality = 0.82) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => null);
  let w, h, draw;
  if (bmp) { w = bmp.width; h = bmp.height; draw = (ctx, W, H) => ctx.drawImage(bmp, 0, 0, W, H); }
  else {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
    w = img.naturalWidth; h = img.naturalHeight; draw = (ctx, W, H) => ctx.drawImage(img, 0, 0, W, H);
  }
  const scale = Math.min(1, maxEdge / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale); canvas.height = Math.round(h * scale);
  draw(canvas.getContext('2d'), canvas.width, canvas.height);
  return new Promise((res) => canvas.toBlob((b) => res(b), 'image/jpeg', quality));
}
