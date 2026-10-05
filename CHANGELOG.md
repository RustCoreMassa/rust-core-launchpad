# Changelog

All notable changes to RustCore Launchpad are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Each release names the
Launchpad contract version it works with.

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

[1.0.0]: https://github.com/RustCoreMassa/rust-core-launchpad/releases/tag/v1.0.0
