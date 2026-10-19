# Changelog

All notable changes to RustCore Launchpad are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Each release names the
Launchpad contract version it works with.

## [Unreleased]

## [1.4.0] — 2026-10-19

Works with the Launchpad contract **v1.4.0** (new: the holder discount). On older contracts
the app shows the fees as before, without any discount.

### Added

- Holder discount: whoever holds at least one NFT of the collection named by the admin pays the
  platform fees less a percentage (10% planned for the RustCore collection; the contract caps it
  at 50%) — token and collection launches, imports, and the presale and marketplace fees, fixed
  with the discount when a presale or a listing is created. Holding is read from the
  collection's standard MRC721 balance when the fee is charged; deposits and storage are never
  discounted. Contract: `setHolderDiscount` (admin), `holderDiscount`, `getHolderDiscount`.
- The launch, import, presale and listing forms show the discounted fee next to the full one,
  and how to get the discount; the discount collection's page says what its NFTs give.
- `/admin`: a Holder discount card (collection address and percentage, empty address = off) and
  the discount in the status.

### Fixed

- Right after a launch, the new token's or collection's page failed with "Not found: Account …"
  until the transaction was final (~45 s): the app read the contract's code and storage from the
  final state, which doesn't hold it yet. Every read now uses the same (candidate) state as the
  contract calls, so a page shows what a transaction did as soon as it executed.

## [1.3.2] — 2026-10-17

Works with the Launchpad contract **v1.3.1** (unchanged), live on mainnet since 2026-10-17: the
upgrade from v1.0.0 ran after the 72-hour public delay. From this release on, the app and the
contracts package share one version number; the contract's on-chain `VERSION` changes only with
its code, so the contracts of 1.3.2 build to the same bytecode as v1.3.1.

### Changed

- Massa libraries updated: `@massalabs/massa-web3` 5.4.0 (support for the MAIN.5.1 node API,
  operation status no longer stuck on "in pool", operations above the maximum size refused
  before signing) and `@massalabs/wallet-provider` 3.3.1 (Bearby: paginated storage reads and the
  same operation status fix). The contracts are built from the same sources and libraries:
  their bytecode is unchanged.
- The README says the Launchpad contract v1.3.1 is live on mainnet.

### Added

- `npm run upgrade -- cancel` (in `smart-contract/`) withdraws a pending upgrade of the
  Launchpad; `docs/RELEASING.md` describes it, and the snapshot to retake right before running
  an upgrade.

## [1.3.1] — 2026-10-14

Works with the Launchpad contract **v1.3.1** (mainnet: upgrade from v1.0.0 through the 72-hour
delay; the v1.2.0 upgrade proposed on 2026-10-12 is replaced, never executed). It brings the
fixes of the security audit of 2026-10-11 on top of 1.2.0. On older contracts the app reads
listings without their royalty, as before.

### Added

- **Listings** tab on the dashboard: every NFT you listed, active or inactive, with Cancel for
  the inactive ones.

### Changed

- **The royalty is fixed when an NFT is listed**, like the marketplace fee: a collection owner
  who raises the royalty or changes its receiver afterwards no longer reduces what the seller
  of an existing listing gets. Listings made before v1.3.1 still pay the collection's current
  royalty, and show it. The NFT page shows the listing's own royalty.
- A listing that can't be bought now (the NFT left the seller, the approval was withdrawn, it
  expired…) shows as **Inactive**, with the reason, on the NFT page. Its seller is told when it
  would turn buyable again by itself at its old price, for example if the NFT comes back to
  their wallet, and can cancel it. The NFT's new holder sees the sell form instead of the old
  listing (listing removes it).
- Public mint is offered only for collections whose current code is a RustCore template, and
  not on RC-Collection v1. Other code could keep the MAS sent.
- Imported projects: the **Imported** badge is a warning, "Original code" reads **Unchanged
  since import**, and a **Look-alike symbol** badge flags a well-known token's symbol or unusual
  characters. An imported token's page says when a token launched here, or a reserved symbol,
  has its symbol.
- Presales of imported tokens, or of tokens with mutable code, warn contributors (and the
  creator, in the wizard) that a code change could stop their claims.

### Security

- Launchpad contract **v1.3.1**: `createPresale` refuses a rate for which hard cap × rate
  doesn't fit in 256 bits. The multiplication wrapped around silently, so an absurd rate could
  pass the escrow check with tokens owed to an earlier presale of the same token. The presale
  form checks it too.
- Bidi controls and invisible characters (U+202A–U+202E, U+2066–U+2069, U+200B, U+200E, U+200F,
  U+061C, U+FEFF) are removed from names, symbols, descriptions and NFT metadata before they're
  shown, so an imported name can't read as another one.

## [1.2.0] — 2026-10-12

Works with the Launchpad contract **v1.2.0** (mainnet: upgrade from v1.0.0 through the 72-hour
delay). On older contracts the app hides tokenomics and removals (tokenomics alone work from
v1.1.0). The app's version now follows the contract's.

### Added

- **Tokenomics on token pages**: the token's owner declares how the supply is split — up to 30
  parts, each with a purpose, a percentage or an amount, an optional one-line description
  (vesting, lock…) and an optional address holding it. The parts must add up to 100% of the
  supply (the max supply for mintable tokens), checked by the contract. The token page shows them
  as a donut chart with the list of parts and the live balance of each address named, and a note
  when the supply changed since the declaration. Declared at launch (an optional "Distribution"
  section in the wizard, with quick-start templates) or anytime from the token page; only the
  storage is paid, no Launchpad fee. The Launchpad doesn't enforce the locks or vesting the
  parts describe.
- **Removal by the admin**, for offensive tokens and collections: on the Admin page, next to
  Hide, **Remove** deletes a project from the registry for good, after typing its symbol. Its
  address can never be imported again and a launched token's symbol becomes free; its contract
  stays on-chain, untouched. A token with an open presale can't be removed (cancel it first);
  a removed collection's listings become invalid and anyone can clean them up, the storage
  going back to the sellers. Its page says it was removed; a removed token's presale page still
  lets contributors claim or refund.
- Launchpad contract **v1.2.0** (from v1.0.0): `setTokenomics`, `getTokenomics`, an optional
  last argument of `createToken`, `removeProject` and `isRemoved`. `getProjects` pages count ids
  (removed projects leave gaps); existing records and calls are unchanged.

### Fixed

- Some refusals reached the app as "VM instance error: error: …" and were shown as raw
  technical text instead of the contract's reason.

### Security

- **RC-Collection v2**. In v1 (and in the MRC721 of `@massalabs/sc-standards` 1.3.0 it builds
  on), anyone could make themselves approved for NFTs not minted yet and take each one right
  after its mint. v2 accepts only valid addresses as operators and approved addresses, approves
  only existing tokens, and clears any approval left on an id when it's minted. No collection
  had been launched on mainnet with v1.
- The app launches only from the newest template of each kind, so collection launches stay
  paused until the Launchpad's admin adds RC-Collection v2 (`setTemplate`). "Download original
  code" finds a template's source by its hash, whatever version number the Launchpad gave it.

## [1.0.1] — 2026-10-08

Works with the Launchpad contract **v1.0.0** (unchanged).

### Changed

- The Launchpad is live on DeWeb at **`lrustcore.massa`**, its only official address, served by
  Massa's official gateway (https://lrustcore.massa.network); the README lists it. The footer's
  links to the RustCore site and RustCore Wallet point to that gateway too.

## [1.0.0] — 2026-10-05

The first release, on Massa **mainnet** (buildnet only in development builds). It works with the Launchpad
contract **v1.0.0** at `AS1LbJFfhZpq8DehV7Uw5XQxCyfXtwgUUoiZSTsHcyhEGB7RPWyP` (mainnet). Fees on
mainnet: token launch 100 MAS, collection launch 200 MAS, import 50 MAS, presale 2% of the MAS
raised, marketplace 1% of each sale. Not independently audited yet.

### Added

- **Token launch**: an MRC20 token (RC-Token template v1) in one transaction — name, symbol,
  decimals, supply, optional minting up to a cap, optional burning, mutable or immutable code.
  The creator owns the contract and the whole supply. Symbols are unique across launches;
  well-known ones (MAS, USDC, WETH…) are reserved.
- **Collection launch**: an MRC721 collection (RC-Collection template v1) with metadata in one
  IPFS folder or a link per NFT, owner mint, optional public mint at the creator's price with a
  per-wallet limit, metadata freeze and a royalty. A guide in the wizard shows how to prepare
  the metadata (folder layout, an example `1.json`), and the app shows what it read from
  `1.json` before the launch.
- **Import** of tokens and collections already deployed, by their owner.
- **Explore** tokens and collections with filters, categories and search, read straight from
  the Launchpad contract — no backend.
- **NFT marketplace**: list, change the price, cancel, buy. No custody. Each sale pays the
  creator's royalty and a marketplace fee (1%, capped at 5%), fixed when the NFT is
  listed; the seller sees what they'll receive before listing. Stale listings can be cleaned up by anyone, their
  storage going back to the seller. A purchase carries the price the buyer saw.
- **Token presales**: soft and hard cap, per-wallet limits, start and end; contributions held in
  escrow by the contract; claims on success, refunds on failure or cancel. The presale fee is
  fixed when the presale is created.
- **Dashboard**: your tokens, collections, NFTs and presale contributions; edit a project's
  description, logo and links; download the original contract code as a zip that rebuilds to
  the bytecode on-chain.
- **Admin page**, only for the admin wallet (or the one offered the role): version, fees,
  balance, templates and any pending upgrade. A pending upgrade is announced to everyone on
  every page. The admin can pause, set fees (presale fee at most 10%, marketplace fee at most
  5%), withdraw the fees collected (only those), verify or hide projects, reserve symbols, add
  template versions, upgrade the Launchpad through a 72-hour public delay, and hand the role
  over in two steps.
- Wallets: Bearby, Massa Station and MetaMask (Massa Snap). Nothing connects until you click
  **Connect wallet**.
- Every write is simulated before your wallet signs it; costs are shown first and unused
  storage MAS are refunded by the contract.
- Development mode (`npm start`): links to this machine over http and a local IPFS node.
- `npm run verify` (in `smart-contract/`) checks the contracts on-chain against the source,
  read-only.
- Release workflow: tests, production build, boot check, contract build and tests, then a
  GitHub Release with the app and the compiled contracts and their checksums.

### Security

- Internal security review of the Launchpad and the templates. Fixed before release: a
  reentrancy path through imported contracts into the payment accounting, a presale fee the
  admin could change after contributions, a price a seller could raise under a buyer, a
  one-step admin transfer, and upgrade storage paid from escrow. The app launches only from
  templates whose source it ships, checked by hash.

[1.3.2]: https://github.com/RustCoreMassa/rust-core-launchpad/releases/tag/v1.3.2
[1.3.1]: https://github.com/RustCoreMassa/rust-core-launchpad/releases/tag/v1.3.1
[1.2.0]: https://github.com/RustCoreMassa/rust-core-launchpad/releases/tag/v1.2.0
[1.0.1]: https://github.com/RustCoreMassa/rust-core-launchpad/releases/tag/v1.0.1
[1.0.0]: https://github.com/RustCoreMassa/rust-core-launchpad/releases/tag/v1.0.0
