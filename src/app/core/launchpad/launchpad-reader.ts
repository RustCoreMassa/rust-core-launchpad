import { Injectable, computed, inject } from '@angular/core';
import { Args, ArrayTypes } from '@massalabs/massa-web3';
import { MassaReader } from '../massa/massa-reader';
import { NetworkStore } from '../network/network-store';
import {
  LaunchpadConfig,
  Listing,
  MarketStats,
  Project,
  ProjectKind,
  Sale,
  readConfig,
  readListing,
  readPage,
  readProject,
  readProjectPage,
  readSale,
  readStats,
} from './records';

/** Most records one `getProjects` call returns (the contract's MAX_PAGE). */
export const PAGE_SIZE = 50;

export class LaunchpadUnavailableError extends Error {
  constructor(network: string) {
    super(`The Launchpad is not deployed on ${network} yet.`);
  }
}

/**
 * Read-only calls to the Launchpad SC of the selected network. Free, no wallet needed; errors
 * from the contract (an unknown id, …) surface as thrown errors.
 */
@Injectable({ providedIn: 'root' })
export class LaunchpadReader {
  private readonly reader = inject(MassaReader);
  private readonly networks = inject(NetworkStore);

  /** The Launchpad address on the selected network; null while it isn't deployed there. */
  readonly address = computed(() => this.networks.config().launchpadAddress);

  async config(): Promise<LaunchpadConfig> {
    return readConfig(new Args(await this.read('config')));
  }

  async count(kind: ProjectKind): Promise<number> {
    return Number(new Args(await this.read('count', new Args().addU8(BigInt(kind)))).nextU64());
  }

  /** Newest first, `offset` counted from the newest. */
  async projects(
    kind: ProjectKind,
    offset: number,
    limit = PAGE_SIZE,
  ): Promise<{ total: number; projects: Project[] }> {
    const bytes = await this.read(
      'getProjects',
      new Args().addU8(BigInt(kind)).addU64(BigInt(offset)).addU32(BigInt(limit)),
    );
    const page = readProjectPage(bytes);
    return { total: Number(page.total), projects: page.projects };
  }

  async project(kind: ProjectKind, id: bigint): Promise<Project> {
    return readProject(
      new Args(await this.read('getProject', new Args().addU8(BigInt(kind)).addU64(id))),
    );
  }

  /** The record for a contract address, or null if it isn't in the Launchpad. */
  async projectByAddress(address: string): Promise<Project | null> {
    try {
      return readProject(
        new Args(await this.read('getProjectByAddress', new Args().addString(address))),
      );
    } catch (err) {
      if (err instanceof Error && /Not in the Launchpad/.test(err.message)) return null;
      throw err;
    }
  }

  /** Ids of the projects `creator` launched or imported. */
  async createdBy(creator: string, kind: ProjectKind): Promise<bigint[]> {
    const bytes = await this.read(
      'getCreatedBy',
      new Args().addString(creator).addU8(BigInt(kind)),
    );
    return new Args(bytes).nextArray<bigint>(ArrayTypes.U64);
  }

  async isSymbolAvailable(symbol: string): Promise<boolean> {
    const bytes = await this.read('isSymbolAvailable', new Args().addString(symbol));
    return bytes[0] === 1;
  }

  /** Current template of a kind: version (0 = none) and the sha256 of its code. */
  async template(kind: ProjectKind): Promise<{ version: number; hash: Uint8Array }> {
    const args = new Args(await this.read('template', new Args().addU8(BigInt(kind))));
    return { version: Number(args.nextU32()), hash: args.nextUint8Array() };
  }

  /** The template bytecode stored in the Launchpad (key `tpl:<kind><version BE>`). */
  async templateCode(kind: ProjectKind, version: number): Promise<Uint8Array> {
    const key = new Uint8Array([
      ...new TextEncoder().encode('tpl:'),
      kind,
      (version >>> 24) & 0xff,
      (version >>> 16) & 0xff,
      (version >>> 8) & 0xff,
      version & 0xff,
    ]);
    const [value] = await this.reader.provider().readStorage(this.requireAddress(), [key], true);
    if (!value) throw new Error(`Template ${kind} v${version} not found`);
    return value;
  }

  // ---- marketplace ---------------------------------------------------------------------------

  /** Active listings, newest first; collectionId 0 = every collection. May include stale ones. */
  async listings(
    collectionId: bigint,
    offset: number,
    limit = PAGE_SIZE,
  ): Promise<{ total: number; items: Listing[] }> {
    const bytes = await this.read(
      'getListings',
      new Args().addU64(collectionId).addU64(BigInt(offset)).addU32(BigInt(limit)),
    );
    return readPage(bytes, readListing);
  }

  /** Every active listing of a collection (or of all with 0), page after page. */
  async allListings(collectionId: bigint, max = 1_000): Promise<Listing[]> {
    const all: Listing[] = [];
    for (;;) {
      const page = await this.listings(collectionId, all.length);
      all.push(...page.items);
      if (!page.items.length || all.length >= Math.min(page.total, max)) return all;
    }
  }

  /** The active listing of an NFT, or null. */
  async listingOf(collection: string, tokenId: bigint): Promise<Listing | null> {
    const id = new Args(
      await this.read('listingOf', new Args().addString(collection).addU256(tokenId)),
    ).nextU64();
    if (id === 0n) return null;
    return readListing(new Args(await this.read('getListing', new Args().addU64(id))));
  }

  /** Why `buyer` can't buy this listing now; '' when they can. */
  async buyProblem(listingId: bigint, buyer: string): Promise<string> {
    const bytes = await this.read('buyProblem', new Args().addU64(listingId).addString(buyer));
    return new TextDecoder().decode(bytes);
  }

  async listingsBySeller(seller: string): Promise<bigint[]> {
    const bytes = await this.read('getListingsBySeller', new Args().addString(seller));
    return new Args(bytes).nextArray<bigint>(ArrayTypes.U64);
  }

  async listing(id: bigint): Promise<Listing> {
    return readListing(new Args(await this.read('getListing', new Args().addU64(id))));
  }

  async sales(collectionId: bigint, offset = 0, limit = PAGE_SIZE): Promise<{ total: number; items: Sale[] }> {
    const bytes = await this.read(
      'getSales',
      new Args().addU64(collectionId).addU64(BigInt(offset)).addU32(BigInt(limit)),
    );
    return readPage(bytes, readSale);
  }

  async stats(collectionId: bigint): Promise<MarketStats> {
    return readStats(new Args(await this.read('getStats', new Args().addU64(collectionId))));
  }

  private async read(func: string, parameter: Args = new Args()): Promise<Uint8Array> {
    const result = await this.reader.provider().readSC({
      target: this.requireAddress(),
      func,
      parameter,
    });
    if (result.info.error) throw new Error(result.info.error);
    return result.value;
  }

  private requireAddress(): string {
    const address = this.address();
    if (!address) throw new LaunchpadUnavailableError(this.networks.config().label);
    return address;
  }
}
