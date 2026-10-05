import { StorageCost } from '@massalabs/massa-web3';
import { LaunchpadConfig } from '../../core/launchpad/records';
import { formatUnits } from '../../core/utils/token-amount';
import { priceNano } from '../create/collection-draft';

/** The contract's cap on the presale fee (rules.ts MAX_PRESALE_FEE_BPS). */
export const MAX_PRESALE_FEE_BPS = 1_000;

/**
 * Sent with small admin writes (a record re-written, a flag); whatever isn't used comes back
 * (settle refunds it).
 */
export const ADMIN_COINS = 50_000_000n; // 0.05 MAS

export interface FeeForm {
  tokenFee: string;
  collectionFee: string;
  importFee: string;
  /** Percent, e.g. "2" or "2.5". */
  presaleFee: string;
  deployDeposit: string;
}

export function feeFormOf(c: LaunchpadConfig): FeeForm {
  return {
    tokenFee: masText(c.tokenFee),
    collectionFee: masText(c.collectionFee),
    importFee: masText(c.importFee),
    presaleFee: String(c.presaleFeeBps / 100),
    deployDeposit: masText(c.deployDeposit),
  };
}

/** "2.5" (%) → 250 bps; null when not a number with at most 2 decimals, or above the cap. */
export function percentToBps(text: string): number | null {
  const clean = text.trim().replace(',', '.');
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(clean)) return null;
  const [whole, fraction = ''] = clean.split('.');
  const bps = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return bps <= MAX_PRESALE_FEE_BPS ? bps : null;
}

export type FeeErrors = Partial<Record<keyof FeeForm, string>>;

/** The config the form describes (keeping `paused` as it is), or the errors per field. */
export function configFromForm(
  form: FeeForm,
  paused: boolean,
): { config: LaunchpadConfig } | { errors: FeeErrors } {
  const errors: FeeErrors = {};
  const mas = (key: keyof FeeForm): bigint => {
    const value = form[key].trim() === '' ? null : priceNano(form[key]);
    if (value === null) errors[key] = 'An amount in MAS, up to 9 decimals.';
    return value ?? 0n;
  };
  const tokenFee = mas('tokenFee');
  const collectionFee = mas('collectionFee');
  const importFee = mas('importFee');
  const deployDeposit = mas('deployDeposit');
  const presaleFeeBps = percentToBps(form.presaleFee);
  if (presaleFeeBps === null) errors.presaleFee = 'A percentage from 0 to 10.';
  if (Object.keys(errors).length) return { errors };
  return {
    config: {
      tokenFee,
      collectionFee,
      importFee,
      presaleFeeBps: presaleFeeBps!,
      deployDeposit,
      paused,
    },
  };
}

/** setTemplate: the bytecode, its hash and version entries, plus the admin margin. */
export function templateCoins(bytes: number): bigint {
  return StorageCost.bytes(bytes + 200) + ADMIN_COINS;
}

/** executeUpgrade: at most the whole new code's storage (only growth is kept), plus margin. */
export function upgradeCoins(bytes: number): bigint {
  return StorageCost.bytes(bytes) + ADMIN_COINS;
}

/** A WebAssembly module starts with "\0asm". */
export function isWasm(bytes: Uint8Array): boolean {
  return bytes.length > 8 && bytes[0] === 0 && bytes[1] === 0x61 && bytes[2] === 0x73;
}

export const ADDRESS = /^A[US][1-9A-HJ-NP-Za-km-z]{40,60}$/;

/** nanoMAS → "1.5", for an input field (no separators). */
export function masText(nano: bigint): string {
  return formatUnits(nano, 9).replace(/,/g, '');
}
