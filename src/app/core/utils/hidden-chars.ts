/**
 * Unicode bidi controls and invisible characters: they can make a name or a symbol read as
 * something else (reversed text, look-alikes). Contracts imported from elsewhere may hold them.
 */
const HIDDEN = /[؜​‎‏‪-‮⁦-⁩﻿]/g;

/** The text without the characters that change how it reads. */
export function stripHidden(text: string): string {
  return text.replace(HIDDEN, '');
}
