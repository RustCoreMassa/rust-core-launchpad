# RustCore Launchpad

Launch MRC20 tokens and NFT collections on [Massa](https://massa.net), trade NFTs and run token
presales — with **no backend**. Everything the app shows is read from one public smart contract
and from the contracts it launches.

> **Status: in development (phase 0 of 7).** Nothing is deployed yet; don't send funds.

## What you'll be able to do

- **Launch a token** (MRC20) in one transaction: you own the contract and the whole supply.
- **Launch an NFT collection** (MRC721) with owner or public mint, royalty and IPFS metadata.
- **Import** a token or collection you already own.
- **Trade NFTs** without custody — no platform fee, only the creator's royalty.
- **Run a presale** for your token: contributors claim tokens on success or get refunded.
- **Edit** your project's presentation and **download the original contract code** anytime.

## Principles

- **You own what you launch.** Contracts are yours from the first block; the Launchpad has no
  rights over them.
- **No backend, no database.** The app talks only to the Massa network and to your wallet.
- **Verifiable.** Launches use versioned templates whose bytecode hash is recorded on-chain;
  imported or modified contracts are marked as such.

## Wallets

Bearby, Massa Station and MetaMask (Massa Snap), through `@massalabs/wallet-provider`.
RustCore Wallet will join once its browser extension can connect to dApps.

## Privacy: where the app connects

- The Massa public RPC of the network you pick: `mainnet.massa.net` or `buildnet.massa.net`.
- Your wallet. Looking for wallets (when you open **Connect wallet**, or at start if you
  connected before) talks to the Bearby / MetaMask extensions inside your browser and asks
  Massa Station's local server (`station.massa`, `localhost:8080`) whether it is running.

Nothing else: no analytics, no backend, fonts are bundled.

## Community

Telegram: https://t.me/rustcore_massa

## License

[FSL-1.1-ALv2](LICENSE.md) — source-available; each release becomes Apache-2.0 after two years.
