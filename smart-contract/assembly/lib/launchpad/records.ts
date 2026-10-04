// Records the Launchpad SC stores and returns, serialized with Args. The app mirrors each class
// field by field, in the same order (src/app/core/launchpad/records.ts from phase 3).
import { Args, Result, Serializable } from '@massalabs/as-types';

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
