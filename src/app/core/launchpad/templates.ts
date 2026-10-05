import { ProjectKind, hex } from './records';

/**
 * sha256 of every template version this app has the source of (public/templates/<tpl>/v<N>/,
 * rebuilt byte-identical). Launches only go through when the Launchpad's current template is
 * one of these: a template the admin swapped in without a public source can't reach users
 * through this app. A new template version = a new snapshot folder + its hash here + setTemplate.
 */
export const KNOWN_TEMPLATES: Record<ProjectKind, Record<number, string>> = {
  0: { 1: 'c7fdc5f3a86abebc7b9c21baf2d2f7626013b58fb24e15467cfd120b6c726878' },
  1: { 1: '3b82684ba328e7757d49074c5ead45fab4a50ce7a096496b8ed54e7490128238' },
};

export class UnknownTemplateError extends Error {
  constructor() {
    // Under 140 characters, so toUserMessage shows it as is.
    super('Launches are paused: the Launchpad uses a template this app does not know yet.');
  }
}

/** Throws unless (kind, version, hash) is a template the app knows. */
export function assertKnownTemplate(kind: ProjectKind, version: number, hash: Uint8Array): void {
  if (KNOWN_TEMPLATES[kind][version] !== hex(hash)) throw new UnknownTemplateError();
}
