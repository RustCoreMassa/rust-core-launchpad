# RustCore Launchpad

Launch MRC20 tokens and NFT collections on [Massa](https://massa.net), trade NFTs and run token
presales — with **no backend**. Everything the app shows is read from one public smart contract
and from the contracts it launches.

> **Status: in development (phase 7 of 7), on buildnet only.** Not on mainnet yet; don't send
> real funds.

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

## Transparency

The Launchpad's settings are public at `/admin`: version, fees, balance, templates and any
pending upgrade of its code, which waits 72 hours on-chain before it can run. Only the admin
wallet can act there; it can never take the MAS of presales, only the fees collected.

## Wallets

Bearby, Massa Station and MetaMask (Massa Snap), through `@massalabs/wallet-provider`.
RustCore Wallet will join once its browser extension can connect to dApps.

## Privacy: where the app connects

- The Massa public RPC of the network you pick: `mainnet.massa.net` or `buildnet.massa.net`.
- Your wallet, only after you click **Connect wallet**: nothing connects on its own when the
  page opens. Looking for wallets talks to the Bearby / MetaMask extensions inside your browser and asks
  Massa Station's local server (`station.massa`, `localhost:8080`) whether it is running.
- Images and metadata that project owners chose: logos, banners, NFT metadata (JSON) and NFT
  images load from the address they gave (any `https://` host), `ipfs://` links through the
  public gateway `ipfs.io`. They are requested without a referrer or cookies.
  (While developing with `npm start`, links on your own machine are allowed too; see
  CONTRIBUTING.md.)

Nothing else: no analytics, no backend, fonts are bundled. "Download original code" is built in
your browser from files the app ships and the contract code stored on-chain.

## Community

Telegram: https://t.me/rustcore_massa

## License

[FSL-1.1-ALv2](LICENSE.md) — source-available; each release becomes Apache-2.0 after two years.
