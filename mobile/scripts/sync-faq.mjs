// Copies the app's FAQ (src/lib/faq.ts) and community rules (src/lib/rules.ts) to the website (../faq.js) so both always say the same.
// Run: node --experimental-strip-types scripts/sync-faq.mjs   (the test:ocr check fails when they differ)
import { readFileSync, writeFileSync } from 'node:fs';
const { FAQ } = await import(new URL('../src/lib/faq.ts', import.meta.url));
const { RULES, RULES_INTRO, RULES_ENFORCEMENT, RULES_VERSION } = await import(new URL('../src/lib/rules.ts', import.meta.url));
const out = `// Generated from mobile/src/lib/faq.ts by mobile/scripts/sync-faq.mjs. Edit that file, not this one.\nexport const FAQ = ${JSON.stringify(FAQ, null, 1)};\nexport const RULES = ${JSON.stringify({ version: RULES_VERSION, intro: RULES_INTRO, rules: RULES, enforcement: RULES_ENFORCEMENT }, null, 1)};\n`;
const target = new URL('../../faq.js', import.meta.url);
if (process.argv.includes('--check')) {
  if (readFileSync(target, 'utf8') !== out) { console.error('faq.js is out of date: run node --experimental-strip-types scripts/sync-faq.mjs'); process.exit(1); }
  console.log('faq.js matches the app FAQ');
} else writeFileSync(target, out);
