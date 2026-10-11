// Loads a dashboard route in headless Chromium, reports console errors and failed requests, saves a full-page screenshot.
// Usage: node scripts/shoot.mjs <url> <out.png>  (needs playwright resolvable from NODE_PATH)
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH ?? 'playwright');
const [url, out = 'shot.png'] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: Number(process.env.W ?? 1600), height: 1000 }, colorScheme: process.env.SCHEME ?? 'light' });
const problems = [];
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && problems.push(`console ${m.type()}: ${m.text()}`));
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('response', (r) => r.status() >= 400 && problems.push(`http ${r.status()} ${r.url()}`));
await page.goto(url, { waitUntil: 'load', timeout: 60000 });
await page.waitForTimeout(7000);
await page.screenshot({ path: out, fullPage: true });
console.log(problems.length ? problems.join('\n') : 'no console errors');
await browser.close();
