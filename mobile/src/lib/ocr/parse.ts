// Turns text read from a flyer into event fields. Shared logic with the web app's ocr.js.
import * as chrono from 'chrono-node';

/** One line of text read from the photo. Position (in image pixels) is optional; with it, text outside the flyer is ignored. */
export type OcrLine = { text: string; height: number; top?: number; left?: number; width?: number };
export type PosterGuess = {
  title: string; start: Date | null; end: Date | null; allDay: boolean;
  location_name: string; address: string; url: string; organizer: string;
  /** False when the date is a guess: no month and day, or the weekday on the flyer doesn't match the date read. */
  dateSure: boolean;
  cost: 'free' | 'paid' | 'donation'; category: 'environmental' | 'community' | 'wellness' | 'mental' | 'arts' | 'other'; description: string;
};

const ADDRESS = /\b\d{1,6}\s+(?:(?:Route|Rte|Highway|Hwy|US|MD)[ -]?\d{1,4}|[A-Za-z0-9.' -]{2,40}?\s(?:Road|Rd|Street|St|Avenue|Ave|Boulevard|Blvd|Drive|Dr|Lane|Ln|Way|Court|Ct|Parkway|Pkwy|Place|Pl|Circle|Cir|Pike|Highway|Hwy|Route|Rte|Terrace|Ter))\b\.?(?:[ ,]*\n?[ ,]*[A-Za-z .]+,?\s*(?:MD|Maryland)?\s*\d{5})?/i;
const VENUE = /\b(park|center|centre|library|church|school|hall|lake|trail|pavilion|plaza|mall|drive-?in|theater|theatre|garden|field|farm|museum|village|pool|gym|cafe|brewery)\b/i;
const CATEGORY_WORDS: [PosterGuess['category'], RegExp][] = [
  ['arts', /\b(haunted|halloween|festival|concert|movie|film|double feature|drive-?in|theater|theatre|dance|poetry|craft|paint(ing)?|art show|music|holiday lights?|parade|trivia)\b/gi],
  ['environmental', /\b(tree|plant(ing)?|clean-?up|litter|garden(ing)?|nature|earth day|arbor|recycl\w*|compost|wildlife|stream|river|watershed|invasive|conservation)\b/gi],
  ['wellness', /\b(5k|10k|run|race|walk|yoga|fitness|workout|bike|cycling|swim|zumba|pickleball|sports?|bootcamp|hike)\b/gi],
  ['mental', /\b(meditat\w*|mindful\w*|sound bath|mental health|support group|grief|journal\w*|healing|breathwork|well-?being)\b/gi],
  ['community', /\b(food drive|donation drive|pantry|potluck|volunteer|neighbou?r\w*|community|market|fair|meetup|swap|party|celebration|block party|coat drive|toy drive)\b/gi],
];

// Score each pillar; words in the title count triple. Ties go to the earlier, more specific list.
export function guessCategory(text: string, title = ''): PosterGuess['category'] {
  let best: PosterGuess['category'] = 'community', bestScore = 0;
  for (const [cat, re] of CATEGORY_WORDS) {
    const score = (text.match(re) || []).length + 3 * (title.match(re) || []).length;
    if (score > bestScore) { best = cat; bestScore = score; }
  }
  return best;
}

function tidy(s: string) {
  const t = s.replace(/\s+/g, ' ').replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9!?.)]+$/g, '').trim();
  // Posters shout; turn ALL CAPS into Title Case for readability
  if (t !== t.toUpperCase()) return t;
  // Small words stay lowercase inside a title: "Sunrise Yoga in Symphony Woods"
  return t.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase())
    .replace(/(?!^)\b(A|An|And|At|By|For|In|Of|On|Or|The|To|With)\b/g, (w) => w.toLowerCase());
}

const MONTH_WORD = /\b(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sep(t(ember)?)?|oct(ober)?|nov(ember)?|dec(ember)?)\b/i;
// Screen and app clutter that shows up when someone photographs a flyer on a screen
const JUNK = /(\b[a-z0-9-]+\.(com|org|net|io)\/\S*[0-9a-f]{6,})|\b(ask chatgpt|new chat|share|scheduled|library|plugins|explore|pinned|projects?|medium|delete|enter|edit)\b\s*$/i;
const HOST = /\b(?:hosted|presented|organi[sz]ed|sponsored|brought to you)\s+by:?\s+(.{3,80})$/i;
const PRESENTS = /^.{3,60}?\s+presents?:?$/i;

type Line = { text: string; h: number; top: number; left: number; width: number; i: number; hasPos: boolean };

export function parsePoster(rawText: string, rawLines: OcrLine[], ref = new Date()): PosterGuess {
  const found: PosterGuess = { title: '', start: null, end: null, allDay: false, dateSure: false, location_name: '', address: '', url: '', organizer: '', cost: 'free', category: 'community', description: '' };
  const all: Line[] = (rawLines.length ? rawLines : (rawText || '').split('\n').map((t): OcrLine => ({ text: t, height: 10 })))
    .map((l, i) => ({ text: l.text.replace(/[|_~]{2,}/g, ' ').replace(/[ \t]+/g, ' ').trim(), h: l.height, top: l.top ?? i, left: l.left ?? 0, width: l.width ?? 0, i, hasPos: l.top !== undefined && l.left !== undefined && !!l.width }))
    .filter((l) => l.text && !JUNK.test(l.text));
  const wordy = (l: Line) => (l.text.match(/[A-Za-z]/g) || []).length >= 3;

  // The flyer is wherever the biggest words are: keep only text in that column, starting just above the headline
  const biggest = all.filter(wordy).sort((a, b) => b.h - a.h)[0];
  let region = all;
  if (biggest?.hasPos) {
    const heads = all.filter((l) => wordy(l) && l.h >= biggest.h * 0.7 && l.hasPos);
    const x0 = Math.min(...heads.map((l) => l.left)), x1 = Math.max(...heads.map((l) => l.left + l.width));
    const pad = (x1 - x0) * 0.25, topLimit = Math.min(...heads.map((l) => l.top)) - biggest.h * 2;
    region = all.filter((l) => { const c = l.left + l.width / 2; return c >= x0 - pad && c <= x1 + pad && l.top >= topLimit; });
  }
  region.sort((a, b) => a.top - b.top || a.left - b.left);
  const text = region.map((l) => l.text).join('\n');
  const lines = region.filter(wordy);

  // Date: prefer written-out dates ("Saturday, November 14") over stray numbers (clocks, links, codes)
  // "Nov 14 · 9:30am" often reads as "Nov 14 - 9:30am", which looks like a range; treat the separator as "at"
  const dateish = text.replace(/((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?)\s*[-–—·•|@.]\s*(?=\d{1,2}(?::\d{2})?\s*[ap]\.?m)/gi, '$1 at ');
  const results = chrono.parse(dateish, ref, { forwardDate: true });
  const score = (r: chrono.ParsedResult) => {
    let n = 0;
    if (MONTH_WORD.test(r.text)) n += 4;
    if (r.start.isCertain('weekday')) n += 2;
    if (r.start.isCertain('month') && r.start.isCertain('day')) n += 2; else if (r.start.isCertain('day') || r.start.isCertain('weekday')) n += 1; else n -= 10;
    if (r.start.isCertain('hour')) n += 1;
    const d = r.start.date();
    if (d.getTime() < ref.getTime() - 864e5 || d.getFullYear() > ref.getFullYear() + 1) n -= 6;
    return n;
  };
  const dated = results.filter((r) => score(r) > 0).sort((a, b) => score(b) - score(a) || a.index - b.index)[0];
  if (dated) {
    const start = dated.start.date();
    let end = dated.end ? dated.end.date() : null;
    if (!dated.start.isCertain('hour')) {
      // A time may appear on its own line ("5-7 PM")
      const timed = results.find((r) => r !== dated && r.start.isCertain('hour') && !r.start.isCertain('day') && !r.start.isCertain('month'));
      if (timed) {
        const t = timed.start.date();
        start.setHours(t.getHours(), t.getMinutes(), 0, 0);
        if (timed.end) { const e = timed.end.date(); end = new Date(start); end.setHours(e.getHours(), e.getMinutes(), 0, 0); }
      } else {
        found.allDay = true;
      }
    }
    if (end && end < start) end.setDate(end.getDate() + 1);
    found.start = start; found.end = end;
    // "Saturday, November 9" when the flyer says Saturday the 14th means part of the date was misread
    const weekdayOk = !dated.start.isCertain('weekday') || dated.start.get('weekday') === start.getDay();
    found.dateSure = dated.start.isCertain('month') && dated.start.isCertain('day') && weekdayOk;
  }

  const used = new Set<Line>();
  const dateText = chrono.strict.parse(dateish, ref).map((r) => r.text.toLowerCase());
  const isDateLine = (t: string) => dateText.some((d) => t.toLowerCase().includes(d) || d.includes(t.toLowerCase())) || chrono.strict.parse(t, ref).length > 0;

  // Title: the largest text that isn't the date; a headline often wraps over two or three lines
  const candidates = lines.filter((l) => !isDateLine(l.text) && !ADDRESS.test(l.text) && !HOST.test(l.text) && !PRESENTS.test(l.text) && l.text.length <= 80);
  const top = [...candidates].sort((a, b) => b.h - a.h)[0];
  let titleStart: Line | undefined;
  if (top) {
    const near = (a: Line, b: Line) => (a.hasPos ? Math.abs(a.top - b.top) <= top.h * 3.2 : Math.abs(lines.indexOf(a) - lines.indexOf(b)) === 1);
    const group = [top];
    for (let grew = true; grew && group.length < 3;) {
      grew = false;
      const next = candidates.find((l) => !group.includes(l) && l.h >= top.h * 0.6 && l.h <= top.h * 1.4 && group.some((g) => near(g, l)));
      if (next) { group.push(next); grew = true; }
    }
    group.sort((a, b) => a.top - b.top || a.i - b.i).forEach((l) => used.add(l));
    titleStart = group[0];
    found.title = tidy(group.map((l) => l.text).join(' ')).slice(0, 140);
  }

  const addr = text.match(ADDRESS);
  if (addr) found.address = tidy(addr[0].replace(/\s*\n\s*/g, ' ')).replace(/^[^0-9]+/, '');
  const venue = lines.find((l) => !used.has(l) && VENUE.test(l.text) && !ADDRESS.test(l.text) && !isDateLine(l.text) && !HOST.test(l.text));
  if (venue) {
    used.add(venue);
    // Map-pin icons read as "O" or "@"; a street number after the name starts the address
    const name = venue.text.replace(/^(?:[O0@©•*]\s+)/, '').split(/,?\s+\d{1,6}\s/)[0];
    found.location_name = tidy(name).replace(/^(at|@|location:?|where:?)\s+/i, '').slice(0, 200);
  }
  // "Lakefront Plaza, 10275 Wincopin Circle": the venue sits before the address on the same line
  if (!found.location_name && addr) {
    const before = (lines.find((l) => l.text.includes(addr[0].split('\n')[0].trim()))?.text ?? '').split(/\b\d{1,6}\s/)[0].replace(/[,\s]+$/, '').replace(/^[^A-Za-z]+/, '').replace(/^(?:[O0@©•*]\s+)/, '');
    if (before && VENUE.test(before)) found.location_name = tidy(before);
  }

  const host = lines.map((l) => l.text.match(HOST)).find(Boolean)
    ?? lines.map((l) => l.text.match(/^(.{3,60}?)\s+presents?:?$/i)).find(Boolean);
  if (host) found.organizer = tidy(host[1]).slice(0, 140);

  const url = text.match(/\b(?:https?:\/\/|www\.)[^\s]+/i);
  if (url) found.url = (url[0].startsWith('http') ? url[0] : `https://${url[0]}`).replace(/[.,;)]+$/, '');
  if (/\b(donation|suggested|pay what you can)\b/i.test(text)) found.cost = 'donation';
  else if (/\$\s?\d/.test(text) && !/\bfree\b/i.test(text)) found.cost = 'paid';
  found.category = guessCategory(text, found.title);
  // Lines that hold part of the address aren't description
  if (addr) lines.filter((l) => addr[0].includes(l.text.replace(/^[^0-9A-Za-z]+/, '').trim())).forEach((l) => used.add(l));
  found.description = describe(lines, used, isDateLine, titleStart);
  return found;
}

/** A short, readable description from the flyer's own words: the details that aren't the name, date or address. */
function describe(lines: Line[], used: Set<Line>, isDateLine: (t: string) => boolean, titleStart?: Line) {
  const keep: string[] = [];
  let last: Line | null = null;
  // Details come after the headline; anything above it is the picture or the screen around the flyer
  let started = !titleStart;
  const small = lines.map((l) => l.h).sort((a, b) => a - b)[Math.floor(lines.length / 2)] ?? 10;
  for (const l of [...lines].sort((a, b) => a.top - b.top || a.i - b.i)) {
    if (l === titleStart) started = true;
    if (!started) continue;
    if (used.has(l)) { last = l; continue; }
    // A big empty gap (a picture, then the app around the flyer) ends the flyer's text
    if (last && l.hasPos && l.top - last.top > small * 7) break;
    last = l;
    const t = l.text;
    if (isDateLine(t) || ADDRESS.test(t) || HOST.test(t) || PRESENTS.test(t) || /^[\d\s,.-]*[A-Za-z .]+,?\s*(MD|Maryland)\s*\d{5}$/i.test(t)) continue;
    const words = t.split(/\s+/).filter((w) => /[A-Za-z]{2,}/.test(w));
    if (words.length < 2 || (t.match(/[A-Za-z]/g) || []).length / t.length < 0.6) continue;
    // Misreads: "rLYER", "aMRLETES", tab bars full of single letters ("SQL E X S"), or mostly tiny fragments ("ly Catalyst")
    const tokens = t.split(/\s+/);
    if (tokens.some((w) => /[a-z][A-Z]/.test(w) && !/^(Mc|Mac|i[A-Z])/.test(w))) continue;
    if (tokens.filter((w) => w.replace(/[^A-Za-z0-9$]/g, '').length <= 2 && !/^(a|an|at|by|in|of|on|or|to|we|us|is|it|be|do|go|up|my|no|so|am|pm|&|\$\d+)$/i.test(w.replace(/[^A-Za-z0-9$&]/g, ''))).length / tokens.length >= 0.4) continue;
    const clean = t.replace(/\s*[•·*|]\s*/g, ' · ').replace(/^[^A-Za-z0-9"“($]+/, '');
    keep.push(clean === clean.toUpperCase() ? tidy(clean) : clean);
  }
  // Wrapped lines continue in lowercase; otherwise each line is its own sentence
  return keep.reduce((acc, t) => (!acc ? t : /^[a-z]/.test(t) || /[.!?:,;·]$/.test(acc) ? `${acc} ${t}` : `${acc}. ${t}`), '')
    .replace(/\s+/g, ' ').trim().slice(0, 600);
}
