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

console.log('OCR parser: all 5 flyers and 2 misreads parsed correctly');
