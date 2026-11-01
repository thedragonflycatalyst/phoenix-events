// Run: npm run test:ocr
import assert from 'node:assert/strict';
import { parsePoster } from './parse.ts';

const ref = new Date(2026, 9, 31, 12);
const L = (text: string, height: number) => ({ text, height });
const run = (lines: { text: string; height: number }[]) => parsePoster(lines.map((l) => l.text).join('\n'), lines, ref);

const a = run([L('COLUMBIA ASSOCIATION PRESENTS', 29), L('HAUNTED', 95), L('TRAIL', 93), L('Tuesday, November 3', 56), L('5-7 PM', 44), L('Centennial Park', 35), L('10000 Route 108, Ellicott City, MD 21042', 33), L('FREE for all ages!', 33)]);
assert.equal(a.title, 'Haunted Trail');
assert.equal(a.start?.toDateString(), new Date(2026, 10, 3).toDateString());
assert.equal(a.start?.getHours(), 17); assert.equal(a.end?.getHours(), 19);
assert.equal(a.location_name, 'Centennial Park');
assert.equal(a.address, '10000 Route 108, Ellicott City, MD 21042');
assert.equal(a.cost, 'free'); assert.equal(a.category, 'arts');

const b = run([L('Yoga in', 107), L('the Park', 85), L('Saturday Nov 14 - 9:30am', 53), L('Blandair Park', 41), L('$10 suggested donation', 39), L('Bring a mat!', 38)]);
assert.equal(b.title, 'Yoga in the Park');
assert.equal(b.start?.getDate(), 14); assert.equal(b.start?.getHours(), 9); assert.equal(b.start?.getMinutes(), 30);
assert.equal(b.end, null);
assert.equal(b.location_name, 'Blandair Park'); assert.equal(b.cost, 'donation'); assert.equal(b.category, 'wellness');

const c = run([L('DOUBLE FEATURE NIGHT', 80), L('Bengies Drive-In', 40), L('Fri 11/20 6:30pm', 44), L('$12 per carload', 30)]);
assert.equal(c.title, 'Double Feature Night');
assert.equal(c.start?.getDate(), 20); assert.equal(c.start?.getHours(), 18);
assert.equal(c.location_name, 'Bengies Drive-In'); assert.equal(c.cost, 'paid'); assert.equal(c.category, 'arts');

const d = run([L('Spring Food Drive', 70), L('Saturday, April 11', 40), L('All day', 30), L('Oakland Mills Village Center', 30)]);
assert.equal(d.title, 'Spring Food Drive'); assert.equal(d.allDay, true); assert.equal(d.category, 'community');

// AI-made test flyer: venue and address on one line, city and ZIP wrapped to the next
const e = run([L('LAKE KITTAMAQUNDI', 60), L('FALL CLEANUP', 70), L('Saturday, November 14 • 9 AM – 12 PM', 30), L('Lakefront Plaza, 10275 Wincopin Circle,', 22), L('Columbia, MD 21044', 22), L('Free • Gloves and bags provided • All ages welcome', 20), L('Hosted by The Phoenix Catalyst', 20), L('SAMPLE TEST FLYER', 8)]);
assert.equal(e.title, 'Lake Kittamaqundi Fall Cleanup');
assert.equal(e.start?.getDate(), 14); assert.equal(e.start?.getHours(), 9); assert.equal(e.end?.getHours(), 12);
assert.equal(e.location_name, 'Lakefront Plaza');
assert.equal(e.address, '10275 Wincopin Circle, Columbia, MD 21044');
assert.equal(e.cost, 'free'); assert.equal(e.category, 'environmental');

assert.equal(e.dateSure, true);
// A frame that loses the "14" must not be trusted: Saturday doesn't match the date read
const f = run([L('FALL CLEANUP', 70), L('Saturday, November 9 AM – 12 PM', 30)]);
assert.equal(f.dateSure, false);
const g2 = run([L('FALL CLEANUP', 70), L('Saturday', 30), L('9 AM – 12 PM', 30)]);
assert.equal(g2.dateSure, false);

// Real phone photo of the flyer on a laptop screen (ML Kit lines with positions), including the browser and ChatGPT around it
const P = (text: string, height: number, top: number, left: number, width: number) => ({ text, height, top, left, width });
const realLines = [
  P('Phoenix Community C X', 9, 217, 75, 115), P('URL Configuration | AL X', 9, 219, 225, 120), P(') Create Cleanup Flyer X t', 9, 222, 358, 140),
  P('chatgpt.com/c/6ae73d45-6fa4-83ea-981d-c390abOe0add', 9, 258, 308, 270), P('ChatGPT', 10, 284, 60, 50), P('t Share', 9, 296, 707, 42), P('...', 4, 298, 673, 12),
  P('New chat', 8, 322, 62, 58), P('LAKE KITTAMAQUNDI', 26, 342, 333, 245), P('O Scheduled', 8, 350, 62, 62), P('UD Library', 8, 375, 64, 48),
  P('FALL CLEANUP', 32, 375, 345, 220), P('@ Plugins', 8, 400, 66, 50), P('** Explore', 8, 425, 68, 50),
  P('Saturday, November 14 ·9 AM - 12 PM', 14, 436, 333, 242), P('O Lakefront Plaza, 10275 Wincopin', 10, 462, 343, 200), P('Circle,', 10, 466, 525, 38),
  P('Pinned', 8, 464, 69, 32), P('Columbia, MD 21044', 10, 476, 405, 105), P('All Projects', 8, 491, 88, 48),
  P('Free Gloves and bags provided All', 9, 497, 336, 190), P('ages welcome', 9, 499, 505, 65), P('Person Training Planning', 8, 517, 89, 105),
  P('Hosted by The Phoenix Catalyst', 11, 518, 367, 170), P('5 Preworkout', 8, 541, 80, 60), P('Projects', 8, 579, 77, 34), P('B 60 day cut', 8, 605, 80, 58),
  P('B Art work generation.', 8, 630, 80, 100), P('Edit', 8, 634, 335, 20), P('aMRLETES', 8, 655, 510, 50), P('+ Ask ChatGPT', 9, 663, 330, 82),
  P('The Dragonfly Catalyst', 9, 665, 100, 95), P('Medium', 8, 669, 620, 38), P('8.24 AM', 6, 712, 712, 30), P('11/1/2026', 6, 720, 710, 34),
  P('DELETE', 7, 853, 715, 48), P('ENTER', 8, 1012, 722, 60),
];
const r = parsePoster(realLines.map((l) => l.text).join('\n'), realLines, new Date(2026, 10, 1, 8, 27));
assert.equal(r.title, 'Lake Kittamaqundi Fall Cleanup');
assert.equal(r.start?.toDateString(), new Date(2026, 10, 14).toDateString());
assert.equal(r.start?.getHours(), 9); assert.equal(r.end?.getHours(), 12); assert.equal(r.dateSure, true);
assert.equal(r.location_name, 'Lakefront Plaza');
assert.equal(r.address, '10275 Wincopin Circle, Columbia, MD 21044');
assert.equal(r.organizer, 'The Phoenix Catalyst');
assert.equal(r.description, 'Free Gloves and bags provided All ages welcome');
assert.equal(e.organizer, 'The Phoenix Catalyst');

// Second AI-made flyer: pipes between details, "Presented by", short weekday and month
const y = run([L('SUNRISE YOGA IN', 40), L('SYMPHONY WOODS', 40), L('Sun, Nov 22 | 8:30am-10am', 22), L('Symphony Woods Park, 10475 Little Patuxent Pkwy,', 11), L('Columbia, MD 21044', 11), L('$5 suggested donation | Bring a mat and water | Beginners welcome', 9), L('Presented by Howard County Yoga Collective', 10)]);
assert.equal(y.title, 'Sunrise Yoga in Symphony Woods');
assert.equal(y.start?.getDate(), 22); assert.equal(y.start?.getHours(), 8); assert.equal(y.start?.getMinutes(), 30); assert.equal(y.end?.getHours(), 10);
assert.equal(y.location_name, 'Symphony Woods Park'); assert.equal(y.address, '10475 Little Patuxent Pkwy, Columbia, MD 21044');
assert.equal(y.organizer, 'Howard County Yoga Collective'); assert.equal(y.cost, 'donation'); assert.equal(y.category, 'wellness');
assert.equal(y.description, '$5 suggested donation · Bring a mat and water · Beginners welcome');

console.log('OCR parser: all 6 flyers, 2 misreads and a real screen photo parsed correctly');
