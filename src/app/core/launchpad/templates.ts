import { ProjectKind, hex } from './records';

/**
 * sha256 of every template version this app has the source of (public/templates/<tpl>/v<N>/,
 * rebuilt byte-identical), by source version. A Launchpad numbers its templates in upload order,
 * so its version numbers may differ from these: the hash is what links a template to its source.
 * A new template version = a new snapshot folder + its hash here + setTemplate.
 */
export const KNOWN_TEMPLATES: Record<ProjectKind, Record<number, string>> = {
  0: { 1: 'c7fdc5f3a86abebc7b9c21baf2d2f7626013b58fb24e15467cfd120b6c726878' },
  1: {
    // v1: anyone could take NFTs right after their mint (audit of 2026-10-11) — no new launches.
    1: '3b82684ba328e7757d49074c5ead45fab4a50ce7a096496b8ed54e7490128238',
    2: 'cf863abe54010fba9b94f4b9ff01962b026fc5204df7f6f82bb10897cc1d58ee',
  },
};

export class UnknownTemplateError extends Error {
  constructor() {
    // Under 140 characters, so toUserMessage shows it as is.
    super('Launches are paused: the Launchpad uses a template this app does not know yet.');
  }
}

/** The newest template of a kind: the only one new launches may use. */
export function newestTemplate(kind: ProjectKind): { version: number; hash: string } {
  const versions = Object.keys(KNOWN_TEMPLATES[kind]).map(Number);
  const version = Math.max(...versions);
  return { version, hash: KNOWN_TEMPLATES[kind][version] };
}

/** The source version (public/templates/<tpl>/v<N>/) whose build has this hash; null if none. */
export function templateSource(kind: ProjectKind, hash: Uint8Array | string): number | null {
  const wanted = typeof hash === 'string' ? hash : hex(hash);
  const known = KNOWN_TEMPLATES[kind];
  const version = Object.keys(known).find((v) => known[Number(v)] === wanted);
  return version === undefined ? null : Number(version);
}

/**
 * Throws unless the Launchpad's current template of this kind is the newest one the app knows:
 * an older one may have a known flaw, an unknown one has no public source.
 */
export function assertKnownTemplate(kind: ProjectKind, hash: Uint8Array): void {
  if (newestTemplate(kind).hash !== hex(hash)) throw new UnknownTemplateError();
}
