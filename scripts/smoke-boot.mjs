// Loads the production build's entry module with a simulated DOM and reports whether all modules
// evaluate and the app renders — catches bundle-order bugs (e.g. a class that extends a
// not-yet-defined class, as massa-web3's import cycle does) that only show up in the built output.
// Pattern from RustCore Wallet (scripts/smoke-boot.mjs there).
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

const dir = resolve(process.argv[2] ?? 'dist/rust-core-launchpad/browser');
const html = readFileSync(join(dir, 'index.html'), 'utf8');
const dom = new JSDOM(html, { url: 'https://launchpad.test/', pretendToBeVisual: true });
const win = dom.window;
win.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
for (const key of Object.getOwnPropertyNames(win)) {
  if (!(key in globalThis)) {
    try {
      globalThis[key] = win[key];
    } catch {}
  }
}
for (const key of ['window', 'self', 'document', 'navigator', 'location', 'localStorage']) {
  try {
    Object.defineProperty(globalThis, key, { value: win[key], configurable: true, writable: true });
  } catch {}
}

const main = readdirSync(dir).find((f) => /^main-.*\.js$/.test(f));
const errors = [];
process.on('uncaughtException', (e) => errors.push(e));
process.on('unhandledRejection', (e) => errors.push(e));
try {
  await import(pathToFileURL(join(dir, main)).href);
} catch (e) {
  errors.push(e);
}
await new Promise((r) => setTimeout(r, 1500));
// Then every other chunk (lazy pages, wallet-provider), so an order bug can't hide in code the
// first screen doesn't load.
for (const chunk of readdirSync(dir).filter((f) => /^chunk-.*\.js$/.test(f))) {
  try {
    await import(pathToFileURL(join(dir, chunk)).href);
  } catch (e) {
    errors.push(e);
  }
}
const fatal = errors.filter(
  (e) => e instanceof TypeError || e instanceof ReferenceError || e instanceof SyntaxError,
);
if (fatal.length) {
  console.log('BOOT FAILED:', fatal.map((e) => `${e.constructor.name}: ${e.message}`).join(' | '));
  process.exit(1);
}
// The app must actually have rendered the home page.
const rendered =
  win.document.querySelector('app-root')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
if (!rendered.includes('Launch tokens and NFTs')) {
  console.log(`BOOT FAILED: the home page did not render (app-root: "${rendered.slice(0, 80)}")`);
  process.exit(1);
}
console.log(
  `BOOT OK — ${main} evaluated and rendered: "${rendered.slice(0, 60)}…"` +
    (errors.length ? ` (${errors.length} non-fatal runtime notices)` : ''),
);
process.exit(0);
