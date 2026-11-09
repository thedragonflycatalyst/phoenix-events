// Renders every campaign banner state with the real styles.css in light and dark mode and runs axe-core.
// Exits non-zero on any axe violation. Needs: playwright (with Chromium) and axe-core.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { CAMPAIGN } from '../../config.js';
import { bannerHtml } from '../../campaign.js';

const require = createRequire(import.meta.url);
const axe = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const css = readFileSync(new URL('../../styles.css', import.meta.url), 'utf8');
const on = { ...CAMPAIGN, enabled: true };
const LIVE = new Date('2026-12-10T12:00:00-05:00'), AFTER = new Date('2027-01-02T12:00:00-05:00');
const states = {
  progress: bannerHtml(on, { raised_cents: 125000, donors: 18 }, LIVE),
  empty: bannerHtml(on, { raised_cents: 0, donors: 0 }, LIVE),
  unknown: bannerHtml(on, null, LIVE),
  full: bannerHtml(on, { raised_cents: 600000, donors: 90 }, LIVE),
  after: bannerHtml(on, { raised_cents: 512000, donors: 80 }, AFTER),
};

const browser = await chromium.launch();
let failures = 0;
for (const scheme of ['light', 'dark']) {
  const page = await browser.newPage({ colorScheme: scheme });
  for (const [name, html] of Object.entries(states)) {
    await page.setContent(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Campaign ${name}</title><style>${css}</style></head>
      <body><main id="main"><h1>Bring color back into your world</h1>${html}</main></body></html>`);
    await page.addScriptTag({ content: axe });
    const res = await page.evaluate(async () => window.axe.run(document, { resultTypes: ['violations'] }));
    const v = res.violations;
    console.log(`${scheme}/${name}: ${v.length} axe violation(s)`);
    for (const x of v) console.log(`  - ${x.id}: ${x.help} (${x.nodes.length} node(s))`);
    failures += v.length;
  }
  await page.close();
}
await browser.close();
if (failures) { console.error(`${failures} axe violation(s)`); process.exit(1); }
console.log('0 axe errors');
