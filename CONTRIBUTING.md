# Contributing to RustCore Launchpad

Thanks for helping! Bug reports, ideas and pull requests are all welcome. This guide covers
running the app and the contracts locally, how the code is organized, and the rules that keep
them safe.

For releases and deployment, see [docs/RELEASING.md](docs/RELEASING.md).

## Ground rules

1. **Open an issue first** for anything larger than a small fix, so we can agree on the approach.
   Any change to the contracts needs an issue first.
2. **Keep the security model intact** (see the README):
   - no network calls beyond the documented list — a new one must be added to the README's
     "What goes over the network" table in the same pull request;
   - no backend, no database: what the app shows comes from the chain;
   - every write is simulated first, and nothing is shown as done before the chain has
     executed it;
   - the Launchpad contract never lets anyone but the payer, the seller, the contributor or the
     presale owner move escrowed MAS — the admin takes only the fees collected;
   - the templates' code never changes in place (see "Templates" below).
3. **Test what matters**: add or update tests for any logic that touches amounts, fees,
   ownership, escrow or encoding. Contract rules are mutation-checked (see "Tests"). Run the
   tests, the type-check and Prettier before opening a pull request.
4. **Report vulnerabilities privately**, never in a public issue — see "Security" in the README.

### Contributor License Agreement

Because RustCore Launchpad is distributed under its [license](LICENSE.md) and its contracts are
deployed on-chain, contributors are asked to sign a **Contributor License Agreement (CLA)**
before their first pull request is merged. You keep the copyright on your contribution; the CLA
lets the project distribute and deploy it.

## Running it locally

**Requirements:** [Node.js](https://nodejs.org) — the version in [`.nvmrc`](.nvmrc) (24.15.0;
Angular also accepts `^22.22.3` and `>=26`) — and npm.

```bash
git clone https://github.com/RustCoreMassa/rust-core-launchpad.git
cd rust-core-launchpad
npm ci
npm start            # http://localhost:4200
```

The app talks to the Launchpad contract already deployed on buildnet
(`src/app/core/network/networks.ts`), so `npm start` is all you need to work on the app.

| Command | What it does |
|---|---|
| `npm start` | Development server with live reload (development environment, see below) |
| `npx ng test --watch=false` | Unit tests (Vitest) — check the exit code |
| `npx tsc -p tsconfig.app.json --noEmit` | Type-check |
| `npm run build` | Production build into `dist/` — must stay warning-free |
| `npm run smoke` | Boots the production build in a simulated browser (run after `npm run build`) |
| `npm run format` | Format the code (Prettier) |

**Local files while developing.** `npm start` uses
`src/environments/environment.development.ts`: links may then point to this machine over http
(`http://localhost`, `http://127.0.0.1`, `http://[::1]`, any port) — NFT metadata, images, logo,
banner, website — and the IPFS gateway can be your own node. The Launchpad contract accepts
exactly these local http hosts besides `https://` and `ipfs://`; the production build
(`environment.ts`) neither accepts nor loads them.

```bash
npx http-server ./my-metadata -p 8081 --cors   # folder link: http://localhost:8081/
```

Metadata read from a local IPFS node (`http://127.0.0.1:<port>/ipfs/…`) resolves its own
`ipfs://` links through that node. To send every `ipfs://` link to your node, set
`ipfsGateway: 'http://127.0.0.1:8080/ipfs/'` (your node's gateway) in that file.

**Wallets.** Connecting needs Bearby, Massa Station or MetaMask with the Massa Snap, set to
buildnet, with test MAS.

### Contracts

```bash
cd smart-contract
npm ci
npm run build        # assembly/contracts/*.ts → build/*.wasm
npm test             # as-pect unit tests (vm-mock)
```

| Command | What it does |
|---|---|
| `npm run build` | Compiles every top-level file of `assembly/contracts/` to `build/<name>.wasm` |
| `npm test` | Unit tests (as-pect), offline |
| `npm run deploy` | Deploys the Launchpad and uploads both templates — buildnet unless `NETWORK=mainnet` (see [docs/RELEASING.md](docs/RELEASING.md)) |
| `npx tsx src/e2e.ts` | On-chain checks on buildnet: tokens (also `e2e-collections`, `e2e-marketplace`, `e2e-presale`, `e2e-admin`) |

Deploys and e2e scripts need `smart-contract/.env` (`cp .env.example .env`) with the
`PRIVATE_KEY` of a **buildnet test account** — never commit it, never use a mainnet key there.
The e2e scripts spend test MAS (about 6–12 per script) and refuse to run on mainnet.

**Real funds.** On mainnet, verify any call with a read-only simulation (`readSC`) first;
never test by sending real transactions.

## How it's built

| Layer | Technology |
|---|---|
| UI | [Angular](https://angular.dev) — standalone components, signals, new control flow, zoneless |
| Blockchain | [`@massalabs/massa-web3`](https://github.com/massalabs/massa-web3) |
| Wallets | [`@massalabs/wallet-provider`](https://github.com/massalabs/wallet-provider), loaded only when you connect |
| Contracts | AssemblyScript with [`@massalabs/massa-as-sdk`](https://github.com/massalabs/massa-as-sdk) and [`@massalabs/sc-standards`](https://github.com/massalabs/massa-standards) (MRC20, MRC721) |
| Contract tests | [as-pect](https://github.com/as-pect/as-pect) with Massa's vm-mock |
| Hosting | [DeWeb](https://docs.massa.net/docs/deweb/home) — static files stored on the Massa blockchain |

```
src/app/
├── core/
│   ├── launchpad/   Reads of the Launchpad, tokens and collections; records (TS mirror of the
│   │                contract's), costs, rules (mirror of rules.ts), transactions, templates
│   ├── massa/       Public RPC provider per network
│   ├── network/     Networks and the Launchpad address on each
│   ├── platform/    Storage tokens
│   ├── utils/       Exact amounts, IPFS links, errors for users, zip, sha256
│   └── wallet/      WalletStore: connection, accounts, signing provider
├── features/        Pages: home, explore, token, collection, NFT, marketplace, presales,
│                    create wizards, dashboard, admin
├── layout/          Header, footer, connect-wallet dialog
└── shared/          Pipes and UI pieces (info form, badges, logo, presale progress)
src/environments/    Production and development settings (local links, IPFS gateway)
public/templates/    Frozen source of every template version (for "Download original code")
smart-contract/
├── assembly/contracts/  launchpad.ts, rc-token.ts, rc-collection.ts — one .wasm each
├── assembly/lib/        Internal modules: ownable, mutable, launchpad/ (keys, records,
│                        rules, settlement, marketplace, presale, math)
├── assembly/__tests__/  as-pect tests, incl. the app ↔ contract encoding cross-check
├── src/                 deploy.ts and the buildnet e2e scripts
└── deployments/         Address, version and template hashes of each deployment
```

### Design rules

- **The contract decides.** The app mirrors its rules (`launch-rules.ts`, `presale-state.ts`)
  only to explain them early; every write is simulated with `readSC` before the wallet signs.
- **No optimistic updates.** A write resolves once the chain has executed it; then the page
  re-reads. A failed operation changes nothing on screen.
- **Every write pays for itself.** Contract functions end with `settle()`: the caller pays the
  fee plus the storage the call used; the rest is refunded. Escrow moves are explicit (`kept`,
  `released`).
- **Exact amounts.** Amounts are converted through decimal strings (`toUnits` / `fromUnits`),
  `bigint` at the contract boundary, never floating-point multiplication.
- **Same encoding on both sides.** A record's field order in
  `smart-contract/assembly/lib/launchpad/records.ts` and `src/app/core/launchpad/records.ts`
  must match; the cross-check tests decode bytes made by the other side.
- **Plain errors.** Anything shown to users goes through `toUserMessage()`; unknown values show
  a skeleton, never a fake 0.
- **No third parties.** Fonts are bundled; the app calls nothing beyond the README's list. New
  CommonJS dependencies are reviewed before joining `allowedCommonJsDependencies`.

### Templates

`public/templates/<template>/v<N>/` is the exact source of each template version, rebuilding to
the bytecode stored on-chain (checked by hash). **Never edit a published version.** A template
change is a new version: a new snapshot folder, its entry in `TEMPLATE_FILES`
(`core/launchpad/original-code.ts`), its hash in `KNOWN_TEMPLATES`
(`core/launchpad/templates.ts`) — the app refuses launches from templates it doesn't know — and
`setTemplate` on-chain from the Admin page.

## Tests

`npx ng test --watch=false` runs the app's unit tests (Vitest): amounts, launch and presale
rules, record encoding, costs, metadata parsing, links, errors, the wallet connection and the
admin forms. The chain and wallets are faked, so tests run offline.

`npm test` in `smart-contract/` runs the contract tests (as-pect, vm-mock): every rule of the
templates and of the Launchpad — fees, refunds, ownership, marketplace, presale states,
timelock, reentrancy guard. Each `assert` is mutation-checked: disable it and a test must fail.
vm-mock has limits (no storage costs; coins sent aren't credited to the contract; a successful
`buy` can't run), so the full flows are also run on buildnet by the e2e scripts.

Unit tests can't see problems that only exist in the bundled output, so after
`npm run build` run `npm run smoke`: it loads the production build in a simulated browser and
checks the app renders. The release workflow runs all of it before publishing anything.
