# Contributing

The full design — contract storage, flows, filters, phases — is in
[docs/ANALYSIS.md](docs/ANALYSIS.md). Read it before changing the contract or adding a page.

## Layout

```
src/                 Angular 22 app (standalone, zoneless, signals)
  app/core/          network, chain reads (MassaReader), wallet connection (WalletStore), utils
  app/layout/        header, footer, connect-wallet dialog
  app/features/      pages
  app/shared/        pipes and UI pieces
smart-contract/      AssemblyScript contracts (Massa)
  assembly/contracts/  entry points — every top-level file here compiles to build/<name>.wasm
  assembly/lib/        internal modules (not compiled on their own)
  assembly/__tests__/  as-pect unit tests (vm-mock)
  src/deploy.ts        deploy script (buildnet unless NETWORK=mainnet)
scripts/             trim-massa-web3 (postinstall), smoke-boot
docs/ANALYSIS.md     specification and development plan
```

## App commands

Node 24.15.0 (`.nvmrc`).

```bash
npm install
npm start                                  # dev server
npx tsc -p tsconfig.app.json --noEmit      # type-check
npx ng test --watch=false                  # Vitest unit tests — must stay green (check the exit code)
npm run build                              # production build — must stay warning-free
npm run smoke                              # boots the production build in jsdom
npm run format                             # Prettier
```

### Local metadata while developing

`npm start` uses `src/environments/environment.development.ts`: links can then point to this
machine over http (`http://localhost`, `http://127.0.0.1`, `http://[::1]`, any port) — NFT
metadata, images, logo, banner, website — and the IPFS gateway can be your own node. The
Launchpad contract accepts exactly these local http hosts besides `https://` and `ipfs://`; the
published build (`environment.ts`) neither accepts nor loads them.

```bash
npx http-server ./my-metadata -p 8081 --cors   # folder link: http://localhost:8081/
```

Set `ipfsGateway: 'http://127.0.0.1:8080/ipfs/'` there to read `ipfs://` links through a local
Kubo node.

## Contract commands

```bash
cd smart-contract
npm install
npm run build                              # assembly/contracts/*.ts → build/*.wasm
npm test                                   # as-pect unit tests
cp .env.example .env                       # PRIVATE_KEY of the deployer (never commit .env)
npm run deploy                             # buildnet; NETWORK=mainnet npm run deploy for mainnet
npx tsx src/e2e-admin.ts                   # on-chain checks (also e2e, e2e-collections, …)
```

## Rules

- Amounts: `number` in the UI, `bigint` at the contract boundary, converted only with
  `toUnits` / `fromUnits` (string-based).
- Every write gets a Review step, a `readSC` simulation first and waits for execution after; no
  optimistic updates.
- Errors on screen go through `toUserMessage()`; unknown values show a skeleton, never a fake 0.
- Fonts are bundled; the app calls no third-party service besides the Massa RPC and the user's
  wallet.
- New CommonJS dependencies must be reviewed before being added to `allowedCommonJsDependencies`.
