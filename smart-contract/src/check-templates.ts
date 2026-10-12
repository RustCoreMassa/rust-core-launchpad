// The templates this source builds must be the newest versions the app knows
// (KNOWN_TEMPLATES in src/app/core/launchpad/templates.ts): the app launches only from those,
// and "Download original code" ships their frozen source. Run after `npm run build`.
//   npm run check:templates
import { createHash } from 'crypto';
import { newestTemplate } from '../../src/app/core/launchpad/templates';
import { getScByteCode } from './utils';

let failures = 0;
for (const [kind, file] of [
  [0, 'rc-token.wasm'],
  [1, 'rc-collection.wasm'],
] as const) {
  const newest = newestTemplate(kind);
  const built = createHash('sha256').update(getScByteCode('build', file)).digest('hex');
  const ok = built === newest.hash;
  console.log(
    `${ok ? '✓' : '✗'} ${file} = known v${newest.version}${ok ? '' : ` (built ${built})`}`,
  );
  if (!ok) failures++;
}
if (failures) {
  console.log('A template changed: freeze it as a new version (docs/RELEASING.md).');
  process.exit(1);
}
