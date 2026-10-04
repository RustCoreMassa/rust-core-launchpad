import { toUnits } from '../utils/token-amount';
import {
  COLLECTION_CATEGORIES,
  KIND_TOKEN,
  ProjectInfo,
  ProjectKind,
  TOKEN_CATEGORIES,
} from './records';

/**
 * The Launchpad SC's input rules (smart-contract/assembly/lib/launchpad/rules.ts), checked in the
 * form so the user sees a message before signing. The contract checks them again; keep both in
 * sync. Each function returns an error message, or null when the value is fine.
 */

export const NAME_MIN = 3;
export const NAME_MAX = 32;
export const SYMBOL_MIN = 2;
export const SYMBOL_MAX = 10;
export const DESCRIPTION_MAX = 500;
export const URL_MAX = 256;
export const MAX_DECIMALS = 18;
export const MAX_ROYALTY_BPS = 1_000;
export const MAX_COLLECTION_SUPPLY = 100_000;

/** Symbols reserved when the Launchpad is deployed (the contract also refuses them). */
export const RESERVED_SYMBOLS = [
  'MAS',
  'WMAS',
  'USDC',
  'USDT',
  'DAI',
  'WETH',
  'ETH',
  'WBTC',
  'BTC',
  'DUSA',
  'PUR',
];

const CONTROL = /[\u0000-\u001f\u007f]/;

export function nameError(name: string): string | null {
  if (name.length < NAME_MIN || name.length > NAME_MAX) return 'Use 3 to 32 characters.';
  if (name.trim() !== name) return 'Remove the spaces at the start or end.';
  if (CONTROL.test(name)) return 'Remove the special characters.';
  return null;
}

/** Expects the upper-cased symbol (the form upper-cases as you type). */
export function symbolError(symbol: string): string | null {
  if (symbol.length < SYMBOL_MIN || symbol.length > SYMBOL_MAX) return 'Use 2 to 10 characters.';
  if (!/^[A-Z0-9]+$/.test(symbol)) return 'Use only letters A-Z and digits 0-9.';
  if (RESERVED_SYMBOLS.includes(symbol)) return 'This symbol is reserved.';
  return null;
}

export function decimalsError(decimals: number): string | null {
  return Number.isInteger(decimals) && decimals >= 0 && decimals <= MAX_DECIMALS
    ? null
    : 'Use a whole number from 0 to 18.';
}

/** A whole-token amount as typed ("1000000", "2.5"), checked against the token's decimals. */
export function supplyError(text: string, decimals: number): string | null {
  const units = parseSupply(text, decimals);
  if (units === null) return 'Enter a number, like 1000000.';
  if (units <= 0n) return 'Must be greater than zero.';
  if (units >= 2n ** 256n) return 'This number is too large.';
  return null;
}

/** Typed amount → smallest units; null when it isn't a valid non-negative number. */
export function parseSupply(text: string, decimals: number): bigint | null {
  const clean = text.trim().replace(/[ _,]/g, '');
  if (!/^\d+(\.\d+)?$/.test(clean)) return null;
  const fraction = clean.split('.')[1] ?? '';
  if (fraction.length > decimals) return null;
  return toUnits(clean, decimals);
}

export function categoryError(kind: ProjectKind, category: number): string | null {
  const count = kind === KIND_TOKEN ? TOKEN_CATEGORIES.length : COLLECTION_CATEGORIES.length;
  return Number.isInteger(category) && category >= 0 && category < count
    ? null
    : 'Pick a category.';
}

export function descriptionError(text: string): string | null {
  if (text.length > DESCRIPTION_MAX) return `Use at most ${DESCRIPTION_MAX} characters.`;
  if (/[\u0000-\u0009\u000b-\u001f\u007f]/.test(text)) return 'Remove the special characters.';
  return null;
}

/** Empty, or an https:// or ipfs:// link without spaces. */
export function urlError(url: string): string | null {
  if (url === '') return null;
  if (url.length > URL_MAX) return `Use at most ${URL_MAX} characters.`;
  if (!url.startsWith('https://') && !url.startsWith('ipfs://'))
    return 'Start with https:// or ipfs://';
  if (/[\s\u0000-\u001f\u007f]/.test(url)) return 'Remove the spaces.';
  return null;
}

export type InfoErrors = Partial<Record<keyof ProjectInfo, string>>;

export function infoErrors(info: ProjectInfo): InfoErrors {
  const errors: InfoErrors = {};
  const description = descriptionError(info.description);
  if (description) errors.description = description;
  for (const key of [
    'logoUrl',
    'bannerUrl',
    'website',
    'twitter',
    'telegram',
    'discord',
  ] as const) {
    const error = urlError(info[key]);
    if (error) errors[key] = error;
  }
  return errors;
}
