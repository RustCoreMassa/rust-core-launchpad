# Releasing RustCore Launchpad

How versions are published, how anyone can verify a build and the contracts on-chain, how the
contracts are deployed and upgraded, and how the app is deployed to DeWeb. For day-to-day
development, see [CONTRIBUTING.md](../CONTRIBUTING.md).

## Versioning

Two version numbers move independently, both following
[Semantic Versioning](https://semver.org) (major for breaking changes, minor for new features,
patch for fixes):

| What | Where | Released by |
|---|---|---|
| The app | `package.json` | a Git tag `vX.Y.Z` → a GitHub Release |
| The Launchpad contract | `VERSION` in `smart-contract/assembly/contracts/launchpad.ts`, mirrored by `smart-contract/package.json` | a deployment (`deployments/<network>.json`), or an upgrade through the 72 h timelock |

The templates have their own versions (`rc-token` v1, `rc-collection` v1, …): a new one is
added on-chain with `setTemplate` and never replaces the code of contracts already launched.

Every app version has a section in [CHANGELOG.md](../CHANGELOG.md)
([Keep a Changelog](https://keepachangelog.com) format) that names the Launchpad contract
version it works with.

## The order of a release

Everything users get comes from one tagged commit, in this order:

1. **Tag the release** (below). GitHub Actions builds the app and the contracts from that
   commit, in public, and publishes them with their checksums.
2. **Deploy or upgrade the contract** only from that same commit: check out the tag, build the
   contracts and compare their sha256 with the release's `SHA256SUMS-contracts` before sending
   anything ([Deploying the contracts](#deploying-the-contracts)). After it, `npm run verify`
   checks the chain against the source.
3. **Publish the app on DeWeb** from the release's zip, checked against `SHA256SUMS`
   ([Deploying to DeWeb](#deploying-to-deweb)).

Anyone can then follow the chain: public source → release → contract on-chain → site.

(v1.0.0 was the exception: its contract was deployed from the commit that was then tagged, and
the release's `SHA256SUMS-contracts` was checked against the chain afterwards.)

## Publishing a release

1. Bump the version: `npm version 0.2.0 --no-git-tag-version`
2. In `CHANGELOG.md`, rename the `## [Unreleased]` section (where changes collect between
   releases) to `## [0.2.0] — <date>` and add its link at the bottom.
3. Commit, then push a matching tag:

```bash
git tag v0.2.0
git push origin master v0.2.0
```

Pushing the tag starts the [release workflow](../.github/workflows/release.yml) on GitHub
Actions. It builds from exactly the tagged commit, in public, and:

- refuses a tag that doesn't match `package.json`, has no changelog section, was already
  released, or isn't higher than the latest release — a version can only move forward;
- refuses contracts whose `smart-contract/package.json` version differs from `VERSION` in
  `launchpad.ts`;
- runs the app's tests, then builds for production and boots that build in a simulated browser
  — if a test fails or the app doesn't render, nothing is published;
- builds the contracts, runs their tests, and refuses templates whose hash isn't the one the app
  launches from (`KNOWN_TEMPLATES` in `src/app/core/launchpad/templates.ts`);
- publishes a [GitHub Release](https://github.com/RustCoreMassa/rust-core-launchpad/releases)
  with the changelog notes, the app as `rust-core-launchpad-vX.Y.Z.zip` with `SHA256SUMS`, and
  the compiled contracts (`launchpad.wasm`, `rc-token.wasm`, `rc-collection.wasm`) as
  `rust-core-launchpad-contracts-vX.Y.Z.zip` with `SHA256SUMS-contracts`.

A version bump without a tag publishes nothing. A release never deploys a contract: deploys and
upgrades are separate, deliberate steps (below).

## Verifying a build

### The app

Anyone can check that a release is exactly what the source code says. Check out the release tag,
build it with the Node.js version from [`.nvmrc`](../.nvmrc) and compare the checksums with the
release's `SHA256SUMS`:

```bash
git checkout v0.1.0
npm ci
npm run build
cd dist/rust-core-launchpad/browser
find . -type f | sort | xargs shasum -a 256
```

With the same Node.js version (dependencies are pinned by `package-lock.json`) the build is
reproducible: every file matches.

### The contracts on-chain

The contracts can be checked against the chain itself, without trusting the release or this
app — read-only, no key and no MAS needed:

```bash
cd smart-contract
npm ci
npm run verify                    # buildnet; NETWORK=mainnet npm run verify for mainnet
```

It builds the contracts from the source you checked out, then compares the sha256 of
`launchpad.wasm` with the Launchpad's bytecode on-chain, and the sha256 of `rc-token.wasm` and
`rc-collection.wasm` with the template hashes the Launchpad launches from. Every line must say
`✓`. The same hashes are in the release's `SHA256SUMS-contracts`.

A launched token or collection can be checked the same way: its page shows **Original code**
when its bytecode still matches the template it was launched from, and **Download original
code** gives its source, which rebuilds to that bytecode (instructions in the zip's README).

## Deploying the contracts

`npm run deploy` (in `smart-contract/`) builds the contracts, deploys the Launchpad with the
fees from `.env` (`.env.example` lists them), uploads both templates as v1, reads them back and
checks their hashes, then writes `deployments/<network>.json` (address, version, admin, fees,
template hashes). Before spending anything, it refuses templates the app doesn't know.

The deploying account becomes the **admin**: on mainnet, use an account kept only for this,
never a day-to-day wallet. Deploying costs about 23 MAS (the Launchpad's and the templates'
storage).

### Buildnet

1. Move the current `deployments/buildnet.json` to `deployments/history/buildnet-v<version>.json`.
2. `npm run deploy`
3. Put the new address in `NETWORKS.buildnet.launchpadAddress`
   (`src/app/core/network/networks.ts`).
4. Run the e2e scripts (`npx tsx src/e2e.ts`, `e2e-collections`, `e2e-marketplace`,
   `e2e-presale`, `e2e-admin`) and `npm run verify`.

A fresh buildnet deployment starts with an empty registry; that's fine for the test network.

### Mainnet

0. Check out the release tag, `npm ci`, `npm run build`, and compare
   `shasum -a 256 build/*.wasm` with the release's `SHA256SUMS-contracts`.
1. Set the mainnet fees in `.env` (`TOKEN_FEE_MAS`, `COLLECTION_FEE_MAS`, `IMPORT_FEE_MAS`,
   `PRESALE_FEE_BPS` — at most 1000 —, `MARKET_FEE_BPS` — at most 500 — and
   `DEPLOY_DEPOSIT_MAS`) and the admin account's `PRIVATE_KEY`.
2. `NETWORK=mainnet npm run deploy` — the only transaction sent for real; everything else was
   checked on buildnet first.
3. `NETWORK=mainnet npm run verify`.
4. Put the address in `NETWORKS.mainnet.launchpadAddress` and commit
   `deployments/mainnet.json`; the app release that carries the address goes out next.

### Upgrading the Launchpad

On mainnet the registry, the listings and the escrowed MAS live in the Launchpad's storage, so
the contract is upgraded in place rather than redeployed:

1. Build the new code and check it on buildnet first (fresh deployment + e2e).
2. On the Admin page, **Propose** the new `launchpad.wasm`: its sha256 is recorded on-chain, and
   every page of the app tells everyone when it can run — 72 hours later.
3. After 72 hours, **Run the upgrade** with the same file; the contract checks its hash. The
   admin pays the storage of the new code.

The new code must read every record the old one wrote: storage keys and record layouts can only
grow at the end (new fields read with a default), never change meaning. If that's not possible,
it's a new deployment and a migration plan, discussed in an issue first.

### Adding a template version

1. Change the template, then freeze its source as `public/templates/<template>/v<N>/` (with a
   pinned `package.json`) and check it rebuilds to the same bytecode.
2. Add the folder to `TEMPLATE_FILES` (`src/app/core/launchpad/original-code.ts`) and its hash
   to `KNOWN_TEMPLATES` (`src/app/core/launchpad/templates.ts`).
3. Release the app, then upload the `.wasm` on the Admin page (**Templates**). New launches use
   the newest version; the app refuses launches while the on-chain template is one it doesn't
   know, so do it in this order.

## Deploying to DeWeb

The Launchpad will be hosted on [DeWeb](https://docs.massa.net/docs/deweb/home), Massa's
decentralized web; its address is chosen with the mainnet release and will be listed in the
README. Each release replaces the site's files there. What gets uploaded is the **folder** with
the built app — `index.html` at its root plus the scripts, styles, assets and template sources
next to it.

A GitHub Release can only hold files, so the release carries that folder as
`rust-core-launchpad-vX.Y.Z.zip`. Unzip it and upload the resulting folder; it's identical to
`dist/rust-core-launchpad/browser` from a local `npm run build`.

Before uploading, check every file against the release's `SHA256SUMS`, from inside the folder:

```bash
unzip rust-core-launchpad-v0.1.0.zip -d rust-core-launchpad-v0.1.0
cd rust-core-launchpad-v0.1.0
shasum -a 256 -c ../SHA256SUMS --ignore-missing   # Linux: sha256sum -c ../SHA256SUMS --ignore-missing
```

Every line must say `OK` (`--ignore-missing` only skips the zip's own line, since the zip isn't
inside the folder). Then upload this folder to the site.

After uploading, open the site, check that the home page loads with the latest launches, and
connect a wallet.

Nothing in the app needs changing for DeWeb:

- **Links to any page work**, including on reload: when a path like `/collections/AS1…` isn't a
  file, the DeWeb server falls back to `index.html` (its built-in single-page-app support), and
  the app's router takes it from there.
- The app talks to the Massa RPC directly, so it doesn't depend on which gateway it was loaded
  from.
