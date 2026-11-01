// Turns text read from a flyer into event fields. Shared logic with the web app's ocr.js.
import * as chrono from 'chrono-node';

export type OcrLine = { text: string; height: number };
export type PosterGuess = {
  title: string; start: Date | null; end: Date | null; allDay: boolean;
  location_name: string; address: string; url: string;
  cost: 'free' | 'paid' | 'donation'; category: 'environmental' | 'community' | 'wellness' | 'mental' | 'arts' | 'other'; description: string;
};

const ADDRESS = /\b\d{1,6}\s+(?:(?:Route|Rte|Highway|Hwy|US|MD)[ -]?\d{1,4}|[A-Za-z0-9.' -]{2,40}?\s(?:Road|Rd|Street|St|Avenue|Ave|Boulevard|Blvd|Drive|Dr|Lane|Ln|Way|Court|Ct|Parkway|Pkwy|Place|Pl|Circle|Cir|Pike|Highway|Hwy|Route|Rte|Terrace|Ter))\b\.?(?:[ ,]+[A-Za-z .]+,?\s*(?:MD|Maryland)?\s*\d{5})?/i;
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
  return t === t.toUpperCase() ? t.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase()) : t;
}

export function parsePoster(rawText: string, rawLines: OcrLine[], ref = new Date()): PosterGuess {
  const text = (rawText || '').replace(/[|_~]{2,}/g, ' ').replace(/[ \t]+/g, ' ').trim();
  const lines = rawLines.map((l) => ({ text: l.text.trim(), h: l.height }))
    .filter((l) => (l.text.match(/[A-Za-z]/g) || []).length >= 3);

  const found: PosterGuess = { title: '', start: null, end: null, allDay: false, location_name: '', address: '', url: '', cost: 'free', category: 'community', description: '' };

  // "Nov 14 · 9:30am" often reads as "Nov 14 - 9:30am", which looks like a range; treat the separator as "at"
  const dateish = text.replace(/((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?)\s+[-–—·•|@]\s+(?=\d{1,2}(?::\d{2})?\s*[ap]\.?m)/gi, '$1 at ');
  const results = chrono.parse(dateish, ref, { forwardDate: true });
  const dated = results.find((r) => r.start.isCertain('month') && r.start.isCertain('day'))
    || results.find((r) => r.start.isCertain('day') || r.start.isCertain('weekday'));
  if (dated) {
    const start = dated.start.date();
    let end = dated.end ? dated.end.date() : null;
    if (!dated.start.isCertain('hour')) {
      // A time may appear on its own line ("5-7 PM")
      const timed = results.find((r) => r !== dated && r.start.isCertain('hour'));
      if (timed) {
        const s = timed.start.date();
        start.setHours(s.getHours(), s.getMinutes(), 0, 0);
        if (timed.end) { const e = timed.end.date(); end = new Date(start); end.setHours(e.getHours(), e.getMinutes(), 0, 0); }
      } else {
        found.allDay = true;
      }
    }
    if (end && end < start) end.setDate(end.getDate() + 1);
    found.start = start; found.end = end;
  }

  // Title: the largest text on the poster that isn't the date
  const used = new Set<(typeof lines)[number]>();
  const dateText = chrono.strict.parse(dateish, ref).map((r) => r.text.toLowerCase());
  const isDateLine = (t: string) => dateText.some((d) => t.toLowerCase().includes(d) || d.includes(t.toLowerCase())) || chrono.strict.parse(t, ref).length > 0;
  const candidates = lines.filter((l) => !isDateLine(l.text) && !ADDRESS.test(l.text) && l.text.length <= 80);
  candidates.sort((a, b) => b.h - a.h);
  if (candidates[0]) {
    const top = candidates[0];
    // A headline often wraps onto the next line in slightly different-looking letters
    const twin = candidates.find((l) => l !== top && l.h >= top.h * 0.7 && l.h <= top.h * 1.3 && Math.abs(lines.indexOf(l) - lines.indexOf(top)) === 1);
    let title = top.text;
    used.add(top);
    if (twin) { title = lines.indexOf(top) < lines.indexOf(twin) ? `${top.text} ${twin.text}` : `${twin.text} ${top.text}`; used.add(twin); }
    found.title = tidy(title).slice(0, 140);
  }

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
