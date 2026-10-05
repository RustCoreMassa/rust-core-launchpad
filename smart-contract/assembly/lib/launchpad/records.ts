// Records the Launchpad SC stores and returns, serialized with Args. The app mirrors each class
// field by field, in the same order (src/app/core/launchpad/records.ts from phase 3).
import { Args, Result, Serializable } from '@massalabs/as-types';
import { u256 } from 'as-bignum/assembly';

/** Presentation data the owner can edit. Empty strings mean "not set". */
export class ProjectInfo implements Serializable {
  constructor(
    public description: string = '',
    public logoUrl: string = '',
    public bannerUrl: string = '',
    public website: string = '',
    public twitter: string = '',
    public telegram: string = '',
    public discord: string = '',
  ) {}

  serialize(): StaticArray<u8> {
    return new Args()
      .add(this.description)
      .add(this.logoUrl)
      .add(this.bannerUrl)
      .add(this.website)
      .add(this.twitter)
      .add(this.telegram)
      .add(this.discord)
      .serialize();
  }

  deserialize(data: StaticArray<u8>, offset: i32): Result<i32> {
    const args = new Args(data, offset);
    this.description = args.nextString().expect('info.description is missing or invalid');
    this.logoUrl = args.nextString().expect('info.logoUrl is missing or invalid');
    this.bannerUrl = args.nextString().expect('info.bannerUrl is missing or invalid');
    this.website = args.nextString().expect('info.website is missing or invalid');
    this.twitter = args.nextString().expect('info.twitter is missing or invalid');
    this.telegram = args.nextString().expect('info.telegram is missing or invalid');
    this.discord = args.nextString().expect('info.discord is missing or invalid');
    return new Result(args.offset);
  }
}

export const SOURCE_LAUNCHED: u8 = 0;
export const SOURCE_IMPORTED: u8 = 1;

/** A token (kind 0) or an NFT collection (kind 1) in the registry. */
export class Project implements Serializable {
  constructor(
    public kind: u8 = 0,
    public id: u64 = 0,
    public address: string = '',
    public source: u8 = SOURCE_LAUNCHED,
    public creator: string = '',
    /** Milliseconds since the epoch. */
    public createdAt: u64 = 0,
    /** Template version for launches; 0 for imports. */
    public templateVersion: u32 = 0,
    /** sha256 of the bytecode at launch or import — "original code" in the app. */
    public codeHash: StaticArray<u8> = [],
    public name: string = '',
    public symbol: string = '',
    /** Token decimals; 0 for collections. */
    public decimals: u8 = 0,
    /** Launched with upgradeable code; always true for imports (unknown code). */
    public mutable: bool = false,
    public category: u8 = 0,
    public verified: bool = false,
    public hidden: bool = false,
    /** Collections only: royalty in basis points (100 = 1 %) and who receives it. */
    public royaltyBps: u16 = 0,
    public royaltyReceiver: string = '',
    public info: ProjectInfo = new ProjectInfo(),
  ) {}

  serialize(): StaticArray<u8> {
    return new Args()
      .add(this.kind)
      .add(this.id)
      .add(this.address)
      .add(this.source)
      .add(this.creator)
      .add(this.createdAt)
      .add(this.templateVersion)
      .add(this.codeHash)
      .add(this.name)
      .add(this.symbol)
      .add(this.decimals)
      .add(this.mutable)
      .add(this.category)
      .add(this.verified)
      .add(this.hidden)
      .add(this.royaltyBps)
      .add(this.royaltyReceiver)
      .add(this.info)
      .serialize();
  }

  deserialize(data: StaticArray<u8>, offset: i32): Result<i32> {
    const args = new Args(data, offset);
    this.kind = args.nextU8().expect('kind');
    this.id = args.nextU64().expect('id');
    this.address = args.nextString().expect('address');
    this.source = args.nextU8().expect('source');
    this.creator = args.nextString().expect('creator');
    this.createdAt = args.nextU64().expect('createdAt');
    this.templateVersion = args.nextU32().expect('templateVersion');
    this.codeHash = args.nextBytes().expect('codeHash');
    this.name = args.nextString().expect('name');
    this.symbol = args.nextString().expect('symbol');
    this.decimals = args.nextU8().expect('decimals');
    this.mutable = args.nextBool().expect('mutable');
    this.category = args.nextU8().expect('category');
    this.verified = args.nextBool().expect('verified');
    this.hidden = args.nextBool().expect('hidden');
    this.royaltyBps = args.nextU16().expect('royaltyBps');
    this.royaltyReceiver = args.nextString().expect('royaltyReceiver');
    this.info = args.nextSerializable<ProjectInfo>().expect('info');
    return new Result(args.offset);
  }
}

/** Fees and limits set by the admin. Amounts in nanoMAS. */
export class Config implements Serializable {
  constructor(
    public tokenFee: u64 = 0,
    public collectionFee: u64 = 0,
    public importFee: u64 = 0,
    /** Presale fee on the MAS raised, in basis points (phase 6). */
    public presaleFeeBps: u16 = 0,
    /** MAS given to each new contract for its own storage (constructor + first holders). */
    public deployDeposit: u64 = 0,
    public paused: bool = false,
  ) {}

  serialize(): StaticArray<u8> {
    return new Args()
      .add(this.tokenFee)
      .add(this.collectionFee)
      .add(this.importFee)
      .add(this.presaleFeeBps)
      .add(this.deployDeposit)
      .add(this.paused)
      .serialize();
  }

  deserialize(data: StaticArray<u8>, offset: i32): Result<i32> {
    const args = new Args(data, offset);
    this.tokenFee = args.nextU64().expect('tokenFee is missing or invalid');
    this.collectionFee = args.nextU64().expect('collectionFee is missing or invalid');
    this.importFee = args.nextU64().expect('importFee is missing or invalid');
    this.presaleFeeBps = args.nextU16().expect('presaleFeeBps is missing or invalid');
    this.deployDeposit = args.nextU64().expect('deployDeposit is missing or invalid');
    this.paused = args.nextBool().expect('paused is missing or invalid');
    return new Result(args.offset);
  }
}

/** A pending upgrade of the Launchpad SC itself (72 h timelock). */
export class UpgradeProposal implements Serializable {
  constructor(
    public codeHash: StaticArray<u8> = [],
    /** Earliest execution time, milliseconds since the epoch. */
    public executableAt: u64 = 0,
  ) {}

  serialize(): StaticArray<u8> {
    return new Args().add(this.codeHash).add(this.executableAt).serialize();
  }

  deserialize(data: StaticArray<u8>, offset: i32): Result<i32> {
    const args = new Args(data, offset);
    this.codeHash = args.nextBytes().expect('codeHash is missing or invalid');
    this.executableAt = args.nextU64().expect('executableAt is missing or invalid');
    return new Result(args.offset);
  }
}

/** An NFT for sale. Exists only while active: a sale or a cancel deletes it. */
export class Listing implements Serializable {
  constructor(
    public id: u64 = 0,
    /** Registry id of the collection. */
    public collectionId: u64 = 0,
    public collection: string = '',
    public tokenId: u256 = u256.Zero,
    public seller: string = '',
    /** nanoMAS. */
    public price: u64 = 0,
    public createdAt: u64 = 0,
    /** Milliseconds since the epoch; 0 = never expires. */
    public expiresAt: u64 = 0,
  ) {}

  serialize(): StaticArray<u8> {
    return new Args()
      .add(this.id)
      .add(this.collectionId)
      .add(this.collection)
      .add(this.tokenId)
      .add(this.seller)
      .add(this.price)
      .add(this.createdAt)
      .add(this.expiresAt)
      .serialize();
  }

  deserialize(data: StaticArray<u8>, offset: i32): Result<i32> {
    const args = new Args(data, offset);
    this.id = args.nextU64().expect('id');
    this.collectionId = args.nextU64().expect('collectionId');
    this.collection = args.nextString().expect('collection');
    this.tokenId = args.nextU256().expect('tokenId');
    this.seller = args.nextString().expect('seller');
    this.price = args.nextU64().expect('price');
    this.createdAt = args.nextU64().expect('createdAt');
    this.expiresAt = args.nextU64().expect('expiresAt');
    return new Result(args.offset);
  }
}

/** A completed marketplace sale (history, kept for good). */
export class Sale implements Serializable {
  constructor(
    public id: u64 = 0,
    public listingId: u64 = 0,
    public collectionId: u64 = 0,
    public tokenId: u256 = u256.Zero,
    public seller: string = '',
    public buyer: string = '',
    /** nanoMAS, royalty included. */
    public price: u64 = 0,
    public royalty: u64 = 0,
    public soldAt: u64 = 0,
  ) {}

  serialize(): StaticArray<u8> {
    return new Args()
      .add(this.id)
      .add(this.listingId)
      .add(this.collectionId)
      .add(this.tokenId)
      .add(this.seller)
      .add(this.buyer)
      .add(this.price)
      .add(this.royalty)
      .add(this.soldAt)
      .serialize();
  }

  deserialize(data: StaticArray<u8>, offset: i32): Result<i32> {
    const args = new Args(data, offset);
    this.id = args.nextU64().expect('id');
    this.listingId = args.nextU64().expect('listingId');
    this.collectionId = args.nextU64().expect('collectionId');
    this.tokenId = args.nextU256().expect('tokenId');
    this.seller = args.nextString().expect('seller');
    this.buyer = args.nextString().expect('buyer');
    this.price = args.nextU64().expect('price');
    this.royalty = args.nextU64().expect('royalty');
    this.soldAt = args.nextU64().expect('soldAt');
    return new Result(args.offset);
  }
}

/** Marketplace totals per collection (the floor price is computed by the app). */
export class MarketStats implements Serializable {
  constructor(
    /** nanoMAS. */
    public volume: u64 = 0,
    public sales: u64 = 0,
    public lastPrice: u64 = 0,
  ) {}

  serialize(): StaticArray<u8> {
    return new Args().add(this.volume).add(this.sales).add(this.lastPrice).serialize();
  }

  deserialize(data: StaticArray<u8>, offset: i32): Result<i32> {
    const args = new Args(data, offset);
    this.volume = args.nextU64().expect('volume');
    this.sales = args.nextU64().expect('sales');
    this.lastPrice = args.nextU64().expect('lastPrice');
    return new Result(args.offset);
  }
}

export const PRESALE_OPEN: u8 = 0;
export const PRESALE_SUCCESS: u8 = 1;
export const PRESALE_FAILED: u8 = 2;
export const PRESALE_CANCELLED: u8 = 3;

/**
 * A token presale (phase 6). The tokens for sale sit in the Launchpad from creation; the MAS
 * raised stays there until success (owner withdraws, contributors claim tokens) or failure /
 * cancel (contributors take their MAS back, the owner the tokens).
 */
export class Presale implements Serializable {
  constructor(
    public id: u64 = 0,
    /** Registry id of the token. */
    public tokenId: u64 = 0,
    public token: string = '',
    public creator: string = '',
    /** Token units for sale, escrowed at creation. */
    public tokensForSale: u256 = u256.Zero,
    /** Token units per 1 MAS (10^9 nanoMAS). */
    public rate: u256 = u256.Zero,
    /** nanoMAS. */
    public softCap: u64 = 0,
    public hardCap: u64 = 0,
    /** Per wallet, nanoMAS; maxBuy 0 = no limit. */
    public minBuy: u64 = 0,
    public maxBuy: u64 = 0,
    /** Milliseconds since the epoch. */
    public start: u64 = 0,
    public end: u64 = 0,
    /** nanoMAS contributed so far. */
    public raised: u64 = 0,
    public contributors: u32 = 0,
    /** PRESALE_OPEN / SUCCESS / FAILED / CANCELLED. */
    public status: u8 = PRESALE_OPEN,
    /** The owner took the raised MAS (success only). */
    public withdrawn: bool = false,
    /** Presale fee in basis points, fixed when the presale is created. */
    public feeBps: u16 = 0,
  ) {}

  serialize(): StaticArray<u8> {
    return new Args()
      .add(this.id)
      .add(this.tokenId)
      .add(this.token)
      .add(this.creator)
      .add(this.tokensForSale)
      .add(this.rate)
      .add(this.softCap)
      .add(this.hardCap)
      .add(this.minBuy)
      .add(this.maxBuy)
      .add(this.start)
      .add(this.end)
      .add(this.raised)
      .add(this.contributors)
      .add(this.status)
      .add(this.withdrawn)
      .add(this.feeBps)
      .serialize();
  }

  deserialize(data: StaticArray<u8>, offset: i32): Result<i32> {
    const args = new Args(data, offset);
    this.id = args.nextU64().expect('id');
    this.tokenId = args.nextU64().expect('tokenId');
    this.token = args.nextString().expect('token');
    this.creator = args.nextString().expect('creator');
    this.tokensForSale = args.nextU256().expect('tokensForSale');
    this.rate = args.nextU256().expect('rate');
    this.softCap = args.nextU64().expect('softCap');
    this.hardCap = args.nextU64().expect('hardCap');
    this.minBuy = args.nextU64().expect('minBuy');
    this.maxBuy = args.nextU64().expect('maxBuy');
    this.start = args.nextU64().expect('start');
    this.end = args.nextU64().expect('end');
    this.raised = args.nextU64().expect('raised');
    this.contributors = args.nextU32().expect('contributors');
    this.status = args.nextU8().expect('status');
    this.withdrawn = args.nextBool().expect('withdrawn');
    this.feeBps = args.nextU16().expect('feeBps');
    return new Result(args.offset);
  }
}
