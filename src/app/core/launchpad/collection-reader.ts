import { Injectable, inject } from '@angular/core';
import { Args, U256 } from '@massalabs/massa-web3';
import { MassaReader } from '../massa/massa-reader';
import { Listing } from './records';

/** RC-Collection's mintInfo(); absent on imported collections. */
export interface MintInfo {
  maxSupply: bigint;
  minted: bigint;
  totalSupply: bigint;
  /** nanoMAS per token. */
  mintPrice: bigint;
  /** 0 = no limit. */
  maxPerWallet: number;
  publicMint: boolean;
  baseURI: string;
  frozen: boolean;
}

export interface CollectionState {
  /** Current owner; empty when renounced. */
  owner: string;
  /** null for imported collections (not an RC-Collection). */
  mint: MintInfo | null;
  /** From templateInfo(); null for imported collections. */
  mutable: boolean | null;
}

/** One NFT and its holder, read from the collection's storage. */
export interface NftItem {
  id: bigint;
  owner: string;
}

// Storage keys of the standard MRC721 (sc-standards MRC721-internals.ts). Token ids are u256,
// 32 bytes little-endian.
const OWNER_PREFIX = 0x04;
const APPROVED_PREFIX = 0x05;
const OPERATOR_PREFIX = 0x06;
const OWNER_KEY_LENGTH = 33;
const OWNED_TOKENS = 'ownedTokens';
const STD_OWNER = 'OWNER';
const NAME_KEY = new Uint8Array([0x01]);
const SYMBOL_KEY = new Uint8Array([0x02]);
/** Entries per readStorage call — keeps each RPC request small. */
const BATCH = 100;

/** Live reads from an MRC721 collection; the item list works for any standard collection. */
@Injectable({ providedIn: 'root' })
export class CollectionReader {
  private readonly reader = inject(MassaReader);

  async state(address: string): Promise<CollectionState> {
    const [ownerBytes] = await this.storage(address, [new TextEncoder().encode(STD_OWNER)]);
    const mint = await this.call(address, 'mintInfo')
      .then(readMintInfo)
      .catch(() => null);
    const template = await this.call(address, 'templateInfo').catch(() => null);
    let mutable: boolean | null = null;
    if (template) {
      const args = new Args(template);
      args.nextString();
      args.nextString();
      mutable = args.nextBool();
    }
    return { owner: ownerBytes ? new TextDecoder().decode(ownerBytes) : '', mint, mutable };
  }

  /** Name and symbol from the standard keys, or null if the address isn't an MRC721. */
  async identity(address: string): Promise<{ name: string; symbol: string } | null> {
    const [name, symbol] = await this.storage(address, [NAME_KEY, SYMBOL_KEY]);
    if (!name || !symbol) return null;
    const text = new TextDecoder();
    return { name: text.decode(name), symbol: text.decode(symbol) };
  }

  /** Every existing NFT of the collection with its holder, lowest id first. */
  async items(address: string): Promise<NftItem[]> {
    const keys = (
      await this.reader.provider().getStorageKeys(address, new Uint8Array([OWNER_PREFIX]), true)
    ).filter((key) => key.length === OWNER_KEY_LENGTH && key[0] === OWNER_PREFIX);
    const items: NftItem[] = [];
    for (let i = 0; i < keys.length; i += BATCH) {
      const slice = keys.slice(i, i + BATCH);
      const owners = await this.storage(address, slice);
      slice.forEach((key, j) => {
        const owner = owners[j];
        if (owner) items.push({ id: tokenIdFromKey(key), owner: new TextDecoder().decode(owner) });
      });
    }
    return items.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  /** Ids `holder` owns, from the Enumerable index (RC-Collection and other enumerable ones). */
  async ownedBy(address: string, holder: string): Promise<bigint[]> {
    const prefix = new TextEncoder().encode(OWNED_TOKENS + holder);
    const keys = await this.reader.provider().getStorageKeys(address, prefix, true);
    return keys
      .filter((key) => key.length === prefix.length + 32)
      .map((key) => U256.fromBytes(key.slice(prefix.length)))
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }

  /**
   * Is `operator` approved to move this NFT for `owner` — its single approval, or an operator
   * approval for the owner? Read from the standard storage, like the Launchpad does.
   */
  async isApproved(address: string, owner: string, id: bigint, operator: string): Promise<boolean> {
    const text = new TextEncoder();
    const single = new Uint8Array([APPROVED_PREFIX, ...U256.toBytes(id)]);
    const forAll = new Uint8Array([OPERATOR_PREFIX, ...text.encode(owner), ...text.encode(operator)]);
    const [approved, operatorFlag] = await this.storage(address, [single, forAll]);
    if (approved && new TextDecoder().decode(approved) === operator) return true;
    return !!operatorFlag && operatorFlag[0] === 1;
  }

  /**
   * Which listings can really be bought: the seller still holds the NFT and the Launchpad is
   * still approved, read in batches from each collection's storage (like `buyProblem`). Expired
   * listings are left out too. Returns the ids of the valid ones.
   */
  async validListings(listings: readonly Listing[], launchpad: string): Promise<Set<bigint>> {
    const valid = new Set<bigint>();
    const now = Date.now();
    const text = new TextEncoder();
    const byCollection = new Map<string, Listing[]>();
    for (const l of listings) {
      if (l.expiresAt && l.expiresAt <= now) continue;
      byCollection.set(l.collection, [...(byCollection.get(l.collection) ?? []), l]);
    }
    for (const [collection, list] of byCollection) {
      for (let i = 0; i < list.length; i += BATCH / 4) {
        const slice = list.slice(i, i + BATCH / 4);
        const keys = slice.flatMap((l) => {
          const id = U256.toBytes(l.tokenId);
          return [
            new Uint8Array([OWNER_PREFIX, ...id]),
            new Uint8Array([APPROVED_PREFIX, ...id]),
            new Uint8Array([OPERATOR_PREFIX, ...text.encode(l.seller), ...text.encode(launchpad)]),
          ];
        });
        const values = await this.storage(collection, keys);
        slice.forEach((l, j) => {
          const [owner, approved, operator] = values.slice(j * 3, j * 3 + 3);
          const holds = !!owner && new TextDecoder().decode(owner) === l.seller;
          const allowed =
            (!!approved && new TextDecoder().decode(approved) === launchpad) ||
            (!!operator && operator[0] === 1);
          if (holds && allowed) valid.add(l.id);
        });
      }
    }
    return valid;
  }

  async uri(address: string, id: bigint): Promise<string> {
    return new TextDecoder().decode(await this.call(address, 'uri', new Args().addU256(id)));
  }

  async ownerOf(address: string, id: bigint): Promise<string> {
    return new TextDecoder().decode(await this.call(address, 'ownerOf', new Args().addU256(id)));
  }

  /** How many tokens `holder` minted through publicMint (RC-Collection). */
  async mintedBy(address: string, holder: string): Promise<number> {
    return Number(
      new Args(await this.call(address, 'mintedBy', new Args().addString(holder))).nextU32(),
    );
  }

  private async storage(address: string, keys: Uint8Array[]): Promise<(Uint8Array | null)[]> {
    return this.reader.provider().readStorage(address, keys, true);
  }

  private async call(address: string, func: string, parameter = new Args()): Promise<Uint8Array> {
    const result = await this.reader.provider().readSC({ target: address, func, parameter });
    if (result.info.error) throw new Error(result.info.error);
    return result.value;
  }
}

export function readMintInfo(bytes: Uint8Array): MintInfo {
  const args = new Args(bytes);
  return {
    maxSupply: args.nextU256(),
    minted: args.nextU256(),
    totalSupply: args.nextU256(),
    mintPrice: args.nextU64(),
    maxPerWallet: Number(args.nextU32()),
    publicMint: args.nextBool(),
    baseURI: args.nextString(),
    frozen: args.nextBool(),
  };
}

export function tokenIdFromKey(key: Uint8Array): bigint {
  return U256.fromBytes(key.slice(1, 33));
}
