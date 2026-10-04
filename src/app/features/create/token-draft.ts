import { Args } from '@massalabs/massa-web3';
import {
  categoryError,
  decimalsError,
  infoErrors,
  nameError,
  parseSupply,
  supplyError,
  symbolError,
} from '../../core/launchpad/launch-rules';
import { EMPTY_INFO, KIND_TOKEN, ProjectInfo, writeInfo } from '../../core/launchpad/records';

/** What the token wizard collects; amounts stay as typed until the end. */
export interface TokenDraft {
  name: string;
  symbol: string;
  decimals: number;
  /** Whole tokens, as typed. */
  supply: string;
  mintable: boolean;
  /** Whole tokens, as typed; only for mintable tokens. */
  maxSupply: string;
  burnable: boolean;
  mutable: boolean;
  category: number;
  info: ProjectInfo;
}

export const EMPTY_DRAFT: TokenDraft = {
  name: '',
  symbol: '',
  decimals: 18,
  supply: '',
  mintable: false,
  maxSupply: '',
  burnable: false,
  mutable: false,
  category: 0,
  info: EMPTY_INFO,
};

export type DraftField = 'name' | 'symbol' | 'decimals' | 'supply' | 'maxSupply' | 'category';
export type DraftErrors = Partial<Record<DraftField, string>>;

/** The wizard's steps and the fields each one owns. */
export const STEPS = ['Identity', 'Tokenomics', 'Presentation', 'Review'] as const;
const STEP_FIELDS: DraftField[][] = [
  ['name', 'symbol'],
  ['decimals', 'supply', 'maxSupply'],
  ['category'],
  [],
];

export function draftErrors(draft: TokenDraft): DraftErrors {
  const errors: DraftErrors = {};
  const set = (field: DraftField, error: string | null) => error && (errors[field] = error);
  set('name', nameError(draft.name));
  set('symbol', symbolError(draft.symbol));
  set('decimals', decimalsError(draft.decimals));
  set('supply', supplyError(draft.supply, draft.decimals));
  if (draft.mintable) {
    const maxError = supplyError(draft.maxSupply, draft.decimals);
    const supply = parseSupply(draft.supply, draft.decimals);
    const max = parseSupply(draft.maxSupply, draft.decimals);
    set(
      'maxSupply',
      maxError ??
        (supply !== null && max !== null && max < supply
          ? 'Must be at least the initial supply.'
          : null),
    );
  }
  set('category', categoryError(KIND_TOKEN, draft.category));
  return errors;
}

/** True when the step's own fields (and, on Presentation, the links) are valid. */
export function stepValid(step: number, draft: TokenDraft): boolean {
  const errors = draftErrors(draft);
  if (STEP_FIELDS[step]?.some((field) => errors[field])) return false;
  if (step === 2) return Object.keys(infoErrors(draft.info)).length === 0;
  if (step === 3) return [0, 1, 2].every((s) => stepValid(s, draft));
  return true;
}

/**
 * createToken arguments, in the contract's order: name, symbol, decimals, initialSupply,
 * mintable, maxSupply, burnable, mutable, category, info. Call only on a valid draft.
 */
export function createTokenArgs(draft: TokenDraft): Args {
  const supply = parseSupply(draft.supply, draft.decimals);
  const max = draft.mintable ? parseSupply(draft.maxSupply, draft.decimals) : 0n;
  if (supply === null || max === null) throw new Error('The draft is not valid.');
  return writeInfo(
    new Args()
      .addString(draft.name)
      .addString(draft.symbol)
      .addU8(BigInt(draft.decimals))
      .addU256(supply)
      .addBool(draft.mintable)
      .addU256(max)
      .addBool(draft.burnable)
      .addBool(draft.mutable)
      .addU8(BigInt(draft.category)),
    draft.info,
  );
}
