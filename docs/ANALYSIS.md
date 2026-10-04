# RustCore Launchpad — Analiză și specificație

Actualizat: 2026-10-04 · Versiunea online (cu comentarii): https://claude.ai/code/artifact/8d68ec75-f326-4a35-aef0-0febcab835b4

## Rezumat și obiective

RustCore Launchpad este o aplicație Angular fără backend, în care un singur smart contract al nostru (**Launchpad SC**) face deploy la tokenuri și colecții NFT în numele userului, îl face pe user owner și păstrează tot registrul afișat pe pagină. Tot ce vede site-ul se citește din acest contract și din contractele lansate.

Ce poate face un user:

- **Lansează un token** (standard MRC20, echivalentul ERC20 pe Massa): completează nume, simbol, zecimale, supply și datele de prezentare, plătește într-o singură tranzacție și devine owner și deținătorul întregului supply.
- **Lansează o colecție NFT** (standard MRC721): nume, simbol, supply maxim, preț de mint, metadata; apoi face mint (pentru el, airdrop sau mint public plătit).
- **Își vede tokenurile, colecțiile, NFT-urile și listările** într-un dashboard și editează datele de prezentare (logo, descriere, linkuri etc.).
- **Vinde și cumpără NFT-uri** pe marketplace-ul integrat, fără comision de platformă, doar cu royalty pentru creator. Poate importa tokenuri și colecții existente pe care le deține.
- **Face opțional un presale** pentru tokenul lansat: alții contribuie cu MAS, iar la final primesc tokenuri sau își iau banii înapoi dacă ținta nu e atinsă.
- **Explorează** tot ce s-a lansat, cu filtre (categorie, owner, stare, preț), sortare și căutare.

Principii:

1. **Fără backend și fără bază de date.** Sursa de adevăr e blockchain-ul Massa; nu există server, indexer sau API propriu. Imaginile sunt URL-uri date de user (IPFS/HTTPS).
2. **Userul e owner.** Contractele lansate îi aparțin din prima tranzacție; noi nu avem drepturi asupra lor.
3. **Contracte verificabile.** Lansările folosesc doar șabloanele noastre, cu hash-ul bytecode-ului înregistrat; contractele importate sau modificate ulterior sunt marcate vizibil.
4. **Aceeași identitate vizuală ca rustcore.massa și RustCore Wallet** (temă dark, roșu Massa, Inter + Space Grotesk incluse local).

## Analiza ecosistemului și a contractelor exemplu

Pe Massa, echivalentul ERC20 este **MRC20**, iar al ERC721 este **MRC721**; ambele sunt în `@massalabs/sc-standards` 1.3.0 (AssemblyScript), pe care îl folosim ca bază pentru șabloanele noastre. Frontendul folosește `@massalabs/massa-web3` 5.3.0, ca RustCore Wallet.

### MRC20 (token)

| Element | Ce face în standard | Consecință pentru noi |
| --- | --- | --- |
| `mrc20Constructor(name, symbol, decimals, totalSupply)` | Scrie NAME, SYMBOL, DECIMALS, TOTAL\_SUPPLY; setează owner = `Context.caller()`; dă tot supply-ul apelantului | Dacă Launchpad SC face deploy, apelantul e Launchpad-ul. Șablonul nostru primește `owner` explicit în constructor și îi dă lui owner-ship și supply-ul |
| `name`, `symbol`, `decimals`, `totalSupply`, `balanceOf`, `version` | Citiri | Afișate pe pagină direct din contract |
| `transfer`, `transferFrom`, `increaseAllowance`, `decreaseAllowance`, `allowance` | Transfer și aprobări | Presale-ul folosește `increaseAllowance` + `transferFrom` ca să ia tokenurile în escrow |
| `mintable/mint` (opțional, `onlyOwner`) | Owner-ul emite tokenuri noi | Opțiune în formular: „supply fix” sau „mintable până la un maxim” |
| `burnable/burn`, `burnFrom` (opțional) | Oricine își arde tokenurile | Opțiune în formular |
| `ownership`: `setOwner`, `ownerAddress`, `onlyOwner` | Owner în cheia OWNER din datastore | Launchpad SC citește owner-ul curent cu `Storage.getOf(token, OWNER)` ca să decidă cine poate edita |

Nume, simbol și zecimale nu au setter în standard (sunt imuabile), iar wallet-urile și DEX-urile le pun în cache. Le păstrăm imuabile.

### MRC721 (NFT)

| Element | Ce face în standard | Consecință pentru noi |
| --- | --- | --- |
| `mrc721Constructor(name, symbol)` | Owner = `Context.caller()` | La fel ca la token: owner explicit în șablonul nostru |
| Varianta **Enumerable** | `totalSupply` + index de tokenuri pe owner | O folosim: putem lista NFT-urile unui user fără indexer |
| `metadata`: `uri(tokenId)`, `_setBaseURI`, `_setURI` | Base URI + URI per token | Două moduri: baseURI (IPFS) sau URI per token setat la mint |
| `ownerOf`, `balanceOf`, `approve`, `setApprovalForAll`, `isApprovedForAll`, `transferFrom` | Proprietate și transfer | Marketplace-ul cere `approve` / `setApprovalForAll` către Launchpad SC înainte de listare |
| `mint`, `burn` (`onlyOwner` în exemplu) | Doar owner-ul face mint | Adăugăm `publicMint` plătit (preț în MAS, limită per wallet, supply maxim) |

Standardul MRC721 nu are royalty. Royalty-ul se salvează în registrul nostru și se aplică doar în marketplace-ul nostru.

### Ce ne oferă Massa pentru un design fără backend

- **Deploy din contract:** `createSC(bytecode)` + `call(adresaNouă, 'constructor', args, coins)`. `isDeployingContract()` e adevărat în acest apel, deci constructorul șablonului merge din Launchpad SC, într-o singură tranzacție a userului.
- **Verificare de bytecode:** `getBytecodeOf(adresă)` + `sha256()`. Launchpad SC poate dovedi că un contract are exact bytecode-ul șablonului.
- **Citirea datastore-ului altui contract:** `Storage.getOf` / `hasOf` (owner-ul curent, supply).
- **Datastore cu chei pe prefix:** frontendul poate lista cheile cu un prefix (`getStorageKeys`) și le poate citi în lot (`readStorage`), plus funcții read-only (`readSC`) gratuite. Pe asta construim paginarea și filtrele.
- **Evenimentele nu sunt istorice:** nodurile păstrează evenimentele doar pentru o perioadă scurtă. Tot ce trebuie afișat mai târziu (vânzări, contribuții) se scrie în datastore, nu doar în evenimente.
- **Storage-ul costă MAS:** fiecare octet nou din datastore e plătit din soldul contractului care îl scrie (aproximativ 0,0001 MAS/octet, de măsurat pe buildnet). Orice funcție care scrie trebuie să primească MAS de la user pentru storage și să returneze surplusul.
- **Conectarea wallet-ului:** `@massalabs/wallet-provider` 3.3.0 (Bearby, Massa Station, MetaMask Snap). RustCore Wallet va apărea acolo după PR-ul pentru provider, planificat în proiectul wallet-ului.

## Arhitectura generală

Arhitectura are trei straturi: aplicația Angular din browser, Launchpad SC (singurul nostru contract) și contractele lansate, care aparțin userilor.

```
┌──────────────────────────────┐   cere semnătura   ┌──────────────────────────────┐
│ Aplicația Angular (DeWeb)    │ ─────────────────► │ Wallet-ul userului           │
│ fără backend, citește direct │                    │ Bearby, Massa Station, RC    │
└──────────────┬───────────────┘                    └──────────────┬───────────────┘
               │ readSC, readStorage (gratuit)                     │ tranzacție + coins
               ▼                                                   ▼
┌────────────────────────────── Launchpad SC (contractul nostru) ──────────────────────────────┐
│  Factory               Registry               Presale                Marketplace             │
│  șabloane pe versiuni  recorduri + indexuri   escrow tokenuri        list, buy, cancel       │
│  deploy, owner = user  metadata editabilă     contribuții în MAS     doar royalty            │
│  taxe + storage        verificat / ascuns     claim / refund         fără custodie           │
└──────┬─────────────────────────────────────────────┬──────────────────────┬─────────────────┘
       │ createSC + constructor                      │ escrow tokenuri      │ mută NFT-ul
       ▼                                             ▼                      ▼
┌───────────────── Contracte lansate / importate ─────────────────┐
│  RC-Token (MRC20)                RC-Collection (MRC721)          │ ─ ─ ► IPFS / HTTPS
│  supply-ul merge la user         ownerMint, publicMint           │       logo, banner,
│  mint, burn opționale            baseURI, freeze                 │       metadata și imagini NFT
└──────────────────────────────────────────────────────────────────┘
```

Citirile merg direct din browser la contracte, gratuit și fără wallet conectat; orice scriere trece prin wallet-ul userului, cu MAS pentru taxă și storage. Imaginile și metadata NFT stau pe IPFS sau HTTPS, la URL-urile date de user.

## Smart contractul Launchpad

Launchpad SC este un singur contract AssemblyScript cu patru module interne: **Factory** (deploy din șabloane), **Registry** (datele afișate), **Marketplace** și **Presale**. Alături stau două șabloane pe care le compilăm noi: **RC-Token** (MRC20) și **RC-Collection** (MRC721 Enumerable + metadata).

### Șabloanele

| Șablon | Constructor (args) | Adăugat față de standard |
| --- | --- | --- |
| RC-Token v1 | `name, symbol, decimals: u8, initialSupply: u256, owner, mintable: bool, maxSupply: u256, burnable: bool, mutable: bool` | owner explicit, care primește și supply-ul inițial; `mint` doar dacă `mintable` și până la `maxSupply`; `burn` / `burnFrom` doar dacă `burnable`; `setOwner` cu adresă validată; `renounceOwnership`; `upgrade` doar dacă `mutable`; `templateInfo` |
| RC-Collection v1 | `name, symbol, owner, maxSupply: u256, baseURI, mintPrice: u64, maxPerWallet: u32, publicMint: bool, mutable: bool` | owner explicit; ID-uri secvențiale de la 1; `ownerMint(to, count)` și `ownerMintWithURI(to, uri)`; `publicMint(count)` plătit în MAS către owner, cu restul returnat; maxim 50 per apel; `uri(id)` = URI-ul propriu sau `baseURI + id + ".json"`; `setBaseURI` + `freezeMetadata` (ireversibil); `setMintConfig`; `reduceMaxSupply`; `renounceOwnership` (închide și mint-ul public); `upgrade` doar dacă `mutable`; `mintInfo`, `templateInfo`, `mintedBy` |

Bytecode-ul șabloanelor se salvează în datastore-ul Launchpad SC, pe versiuni, prin `setTemplate` (doar admin). O versiune nouă nu atinge contractele deja lansate, iar fiecare record păstrează versiunea și hash-ul cu care a fost lansat.

Diferențe față de standardul MRC721, găsite la analiza codului din `sc-standards` 1.3.0:

- `burn` din varianta Enumerable nu verifică cine îl apelează (oricine ar putea arde orice NFT), deci RC-Collection nu îl exportă.
- `uri()` din standard întoarce doar baseURI dacă tokenul nu are URI propriu; RC-Collection compune `baseURI + id + ".json"`.
- `name()` și `symbol()` primesc parametrul de argumente, ca toate celelalte funcții exportate.
- Renunțarea la ownership scrie un owner gol în loc să șteargă cheia `OWNER`: `_setOwner` din standard nu mai verifică owner-ul când cheia lipsește.

Ca la orice MRC20/MRC721, storage-ul nou (un deținător nou, o aprobare, un mint) se plătește din soldul contractului, așa că apelurile care creează intrări trimit MAS (massa-web3 face asta automat pentru `transfer`).

### Chei de stocare

Toate valorile sunt serializate cu `Args` (clase `Serializable` în AssemblyScript, oglindite în TypeScript). `<kind>` e un octet: 0 = token, 1 = colecție. ID-urile sunt `u64` secvențiale per kind, scrise pe 8 octeți big-endian, ca listarea pe prefix să vină în ordine. Orice parte de lungime variabilă (adresă, simbol) se termină cu `:`, ca o adresă să nu fie prefixul alteia.

| Cheie | Valoare | Folosită pentru |
| --- | --- | --- |
| `admin` | adresa admin | permisiuni |
| `cfg` | Config | taxe, depozit, pauză |
| `fees` | u64 | taxe acumulate, separate de orice alt sold |
| `tplv:<kind>` | u32 | versiunea curentă a șablonului |
| `tpl:<kind><ver>` / `tplh:<kind><ver>` | bytecode / sha256 | șabloane (și sursa pentru „Descarcă codul original”) |
| `n:<kind>` | u64 | numărul de proiecte (ID-urile sunt 1..n) |
| `p:<kind><id>` | Project | recordul |
| `a:<adresă>:` | kind + id | căutare după adresă, import unic |
| `o:<creator>:<kind><id>` | gol | „lansate / importate de mine” |
| `c:<kind><categorie><id>` | gol | filtru pe categorie |
| `s:<SIMBOL>:` | kind + id, sau gol = rezervat | unicitatea simbolului la lansări |
| `upg` | UpgradeProposal | upgrade în așteptare (timelock) |

Cheile pentru marketplace (faza 5) și presale (faza 6) urmează același model: `lst:`, `lstC:`, `lstS:`, `lstT:`, `sale:`, `stat:`, `pre:`, `ctb:`, `ctbU:`.

### Recordurile

- **Project** (token sau colecție, un singur tip): kind, id, address, source (lansat / importat), creator, createdAt (ms), templateVersion (0 la import), codeHash (sha256 al codului la lansare sau import), name, symbol, decimals (0 la colecții), mutable (mereu true la import: cod necunoscut), category, verified, hidden, royaltyBps, royaltyReceiver, info.
- **ProjectInfo** (editabil): description, logoUrl, bannerUrl, website, twitter, telegram, discord.
- **Config**: tokenFee, collectionFee, importFee, presaleFeeBps, deployDeposit (MAS dat fiecărui contract nou pentru storage-ul lui), paused.
- **UpgradeProposal**: codeHash, executableAt.
- Supply-ul, mintable, burnable, prețul de mint etc. nu se copiază în registry: aplicația le citește direct din contract (`templateInfo`, `mintInfo`, `totalSupply`), deci sunt mereu la zi.
- **Listing**, **Sale**, **Presale**: în fazele 5 și 6.

### Funcții publice (implementate în faza 2)

| Modul | Scriere (tranzacție) | Citire (readSC, gratuit) |
| --- | --- | --- |
| Factory | `createToken`, `createCollection` | `template(kind)`, `isSymbolAvailable(symbol)` |
| Registry | `importToken`, `importCollection`, `updateInfo(kind, id, category, info)`, `setRoyalty` | `count(kind)`, `getProject(kind, id)`, `getProjectByAddress`, `getProjects(kind, offset, limit)` (cele mai noi primele, maxim 50), `getCreatedBy(creator, kind)` |
| Admin | `setConfig`, `setPaused`, `setTemplate`, `setVerified`, `setHidden`, `reserveSymbol`, `withdrawFees`, `transferAdmin`, `proposeUpgrade`, `cancelUpgrade`, `executeUpgrade` | `admin`, `config`, `fees`, `pendingUpgrade`, `version` |
| Marketplace (faza 5) | `list`, `updatePrice`, `cancel`, `buy`, `cleanup` | `getListing`, `getListings`, `getSales`, `getStats` |
| Presale (faza 6) | `createPresale`, `contribute`, `finalize`, `claim`, `refund`, `cancelPresale`, `withdrawRaised` | `getPresale`, `getPresales`, `getContribution`, `getContributionsOf` |

Filtrul pe categorie nu are funcție dedicată: aplicația listează cheile cu prefixul `c:<kind><categorie>` (`getStorageKeys`) și citește recordurile.

### Taxe și plata storage-ului

- Fiecare scriere e plătită de cine o face. Contractul citește soldul la începutul apelului (monedele trimise sunt deja incluse) și la sfârșit. Diferența e ce a consumat apelul: storage nou, bytecode-ul contractului creat, depozitul dat acestuia. Cere `monede trimise ≥ consum + taxă` și returnează restul. Storage-ul eliberat (o cheie ștearsă) se returnează și el.
- Suma exactă de trimis o află aplicația simulând apelul (`readSC`) înainte de semnare; taxele se văd în `config`.
- Taxe configurabile de admin, doar la patru operații: taxă fixă la crearea unui token, taxă fixă la crearea unei colecții, taxă fixă la import (token sau colecție) și comision de presale în bps din suma strânsă. Marketplace-ul nu are comision. Valorile se stabilesc înainte de mainnet.
- Taxele se adună în contorul `fees`. `withdrawFees` poate scoate doar acest contor, niciodată banii din escrow (presale sau plăți în curs).

### Evenimente

`TOKEN_CREATED`, `COLLECTION_CREATED`, `TOKEN_IMPORTED`, `COLLECTION_IMPORTED`, `INFO_UPDATED`, `ROYALTY_UPDATED`, `TEMPLATE_SET`, `CONFIG_UPDATED`, `PAUSED` / `UNPAUSED`, `FEES_WITHDRAWN`, `ADMIN_CHANGED`, `UPGRADE_PROPOSED` / `UPGRADE_CANCELLED` / `UPGRADE_EXECUTED`; din fazele 5–6: `LISTED`, `SOLD`, `CANCELLED`, `PRESALE_CREATED`, `CONTRIBUTED`, `FINALIZED`, `CLAIMED`, `REFUNDED`. Le folosim doar pentru confirmarea tranzacției în UI, nu ca istoric.

## Fluxul de lansare a unui token

Un token se lansează într-o singură tranzacție semnată de user (`createToken`); la final userul e owner și are tot supply-ul inițial.

### Formularul (wizard în 4 pași)

| Câmp | Validare | Pe lanț |
| --- | --- | --- |
| Nume | 3–32 caractere, fără caractere de control | în token (imuabil) |
| Simbol | 2–10 caractere, A–Z și 0–9, transformat în majuscule | în token (imuabil) |
| Zecimale | 0–18, implicit 18 | în token (imuabil) |
| Supply inițial | > 0, întreg, înmulțit cu 10^zecimale prin conversie pe string (ca `toUnits` din wallet) | în token |
| Tip supply | fix / mintable până la un maxim | în token |
| Supply maxim | ≥ supply inițial, doar la mintable | în token |
| Burnable | da / nu | în token |
| Categorie | listă fixă: meme, utility, gaming, DeFi, community, altele | în registry (editabil) |
| Descriere | ≤ 500 caractere | în registry (editabil) |
| Logo, banner | URL `ipfs://` sau `https://`, previzualizat în formular | în registry (editabil) |
| Website, X, Telegram, Discord | URL valid, opțional | în registry (editabil) |

Pașii: 1) Identitate (nume, simbol, logo) · 2) Tokenomics (zecimale, supply, mintable, burnable) · 3) Prezentare (categorie, descriere, linkuri) · 4) Review cu costul exact și confirmare.

### Pașii tehnici

1. Frontendul validează formularul și serializează argumentele cu `Args`.
2. Frontendul citește taxa din `config` și simulează apelul cu `readSC`, cu adresa userului ca apelant, ca să afle suma exactă: dacă simularea eșuează, afișăm motivul și nu cerem semnătura.
3. Pasul Review arată tot ce se scrie pe lanț, taxa platformei, depozitul de storage și taxa de rețea.
4. Userul semnează `createToken` în wallet, cu `coins` = suma estimată + o marjă mică (surplusul se returnează automat).
5. Launchpad SC verifică: nu e în pauză, argumente valide, simbol liber (dacă impunem unicitatea), `coins` suficienți.
6. `createSC(tpl:token:<ver>)` creează contractul; `call(token, 'constructor', args + owner = caller, coins pentru storage-ul tokenului)` îl inițializează: owner = user, supply-ul inițial merge la user.
7. Launchpad SC scrie `tok:<id>`, `tokA:<adresă>`, `own:`, `cat:` și (opțional) `sym:`, reține taxa în `fees`, returnează surplusul și emite `TOKEN_CREATED`.
8. Frontendul așteaptă execuția (ca `waitSpeculativeExecution` din wallet), citește recordul nou și deschide pagina tokenului. Fără actualizări optimiste: UI-ul arată doar ce s-a citit de pe lanț.

După lansare, pagina tokenului oferă: adăugare în wallet, copiere adresă, link explorer, butonul **Creează presale** și, pentru owner, **Editează**, **Mint** (dacă e mintable) și **Renunță la ownership**.

## Fluxul de lansare a unei colecții NFT

O colecție se lansează tot într-o tranzacție (`createCollection`), iar NFT-urile se emit apoi separat: de owner (`ownerMint`) sau de public (`publicMint`, plătit).

### Formularul

| Câmp | Validare | Pe lanț |
| --- | --- | --- |
| Nume colecție, simbol | ca la token | în colecție (imuabil) |
| Supply maxim | 1–100 000 (limita de stabilit) | în colecție; poate fi doar scăzut |
| Mod metadata | **A: baseURI** (folder IPFS cu `1.json`, `2.json`…) sau **B: per NFT** (URI dat la fiecare mint) | în colecție |
| Base URI | `ipfs://…/` sau `https://…/`, doar la modul A | în colecție, editabil până la `freezeMetadata` |
| Mint public | da / nu; preț în MAS; maxim per wallet | în colecție, editabil |
| Royalty | 0–10 % (bps), adresa care îl primește | în registry, editabil |
| Categorie | art, PFP, gaming, music, photography, collectibles, altele | în registry |
| Descriere, logo, banner, linkuri | ca la token | în registry |

### Pașii tehnici

1. Validare, taxa din `config`, simulare `readSC`, pasul Review (identic cu tokenul).
2. `createCollection` → `createSC(tpl:collection:<ver>)` → `constructor` cu owner = user.
3. Launchpad SC scrie `col:`, `colA:`, `own:`, `cat:`, reține taxa, returnează surplusul, emite `COLLECTION_CREATED`.
4. Owner-ul face mint din pagina colecției: `ownerMint(to, count)` (airdrop către sine sau altă adresă) sau, în modul B, `ownerMintWithURI(to, uri)` cu URI-ul JSON-ului fiecărui NFT.
5. Mint public (dacă e activ): oricine apelează `publicMint(count)` direct pe contractul colecției, cu `coins = preț × count + storage`. Contractul verifică supply-ul și limita per wallet și trimite plata la owner.

### Metadata NFT

Un NFT urmează formatul JSON uzual: `name`, `description`, `image`, `attributes[]` (`trait_type`, `value`). Frontendul citește `uri(tokenId)`, descarcă JSON-ul printr-un gateway IPFS public și afișează imaginea și atributele. Atributele permit filtre pe trait-uri în pagina colecției.

Pentru că nu avem backend, nu încărcăm noi fișiere. Userul vine cu fișierele deja pe IPFS (sau alt URL); în wizard arătăm cum se pregătește folderul și verificăm că `1.json` se încarcă înainte de deploy. Varianta de upload direct din browser este o întrebare deschisă (vezi ultima secțiune).

## Editarea datelor

Userul poate edita tot ce ține de prezentare, dar nu identitatea contractului: numele, simbolul, zecimalele și supply-ul emis rămân cum au fost lansate.

| Ce | Editabil? | Cine | Unde și cum |
| --- | --- | --- | --- |
| Nume, simbol, zecimale (token și colecție) | Nu | — | Imuabile în contract; wallet-urile și DEX-urile le pun în cache |
| Supply token | Doar crește prin `mint` (dacă e mintable, până la maxim) sau scade prin `burn` | owner / holderi | Pe contractul tokenului |
| Descriere, logo, banner, website, social, categorie | Da | owner-ul curent | `updateInfo` pe Launchpad SC |
| Base URI colecție | Da, până la `freezeMetadata` | owner-ul colecției | Pe contractul colecției; după freeze, niciodată |
| Preț mint, mint public on/off, maxim per wallet | Da | owner-ul colecției | `setMintConfig` pe colecție |
| Supply maxim colecție | Doar în jos, nu sub ce s-a emis | owner-ul colecției | Pe colecție |
| Royalty | Da, maxim 10 % | owner-ul colecției | `setRoyalty` pe Launchpad SC |
| Owner | Da (transfer) sau renunțare | owner-ul curent | `setOwner` / `renounceOwnership` pe contract |
| Verificat / ascuns | Doar admin | noi | `setVerified` / `setHidden` |

**Cine e „owner-ul curent”:** Launchpad SC nu se bazează pe creatorul salvat în record, ci citește la fiecare editare cheia OWNER din contractul tokenului sau al colecției (`Storage.getOf`). Dacă ownership-ul a fost transferat, noul owner poate edita; dacă s-a renunțat la el, nimeni nu mai poate edita (datele rămân înghețate). Indexul `own:` rămâne pe creator; dashboard-ul afișează separat „Lansate de mine” și „Deținute de mine”.

Fiecare editare plătește doar diferența de storage (în plus sau înapoi în minus) și taxa de rețea; nu are taxă de platformă.

## Import și contracte mutabile

Owner-ul unui token sau al unei colecții existente le poate importa în Launchpad. Fiecare owner răspunde de contractul lui: la lansare alege dacă acesta poate fi modificat, poate descărca oricând codul original, iar noi păstrăm doar originalul.

### Import

1. Userul introduce adresa contractului în `/me` → **Import**; wallet-ul conectat trebuie să fie owner-ul.
2. Launchpad SC verifică owner-ul cu `Storage.getOf(contract, OWNER) == caller`. Contractele fără cheia OWNER standard nu pot fi importate în v1.
3. Verifică interfața: la token răspund `name`, `symbol`, `decimals`, `totalSupply`; la colecție răspund `name`, `symbol`, `ownerOf`. Nu poate garanta comportamentul codului.
4. Scrie recordul cu sursa **importat** și hash-ul bytecode-ului din momentul importului, reține taxa de import și storage-ul. O adresă se poate importa o singură dată.
5. **Sincronizarea NFT-urilor:** după import, frontendul citește `totalSupply` și `ownerOf` (sau indexul Enumerable, dacă există) și afișează colecția cu NFT-urile ei. Datele vin mereu din contractul colecției, deci rămân sincronizate fără altă tranzacție.
6. Un token importat poate avea presale; NFT-urile unei colecții importate se pot lista pe marketplace.

Unicitatea simbolului se aplică doar lansărilor; un token importat își păstrează simbolul și primește badge-ul **Importat**.

### Contracte mutabile

- În wizard, opțiunea **Cod mutabil** (implicit oprită). Pornită: contractul are `upgrade(bytecode)`, doar pentru owner (prin `setBytecode`). Oprită: contractul nu are funcție de upgrade și rămâne așa pentru totdeauna.
- Pagina tokenului sau a colecției arată clar: **Imuabil** / **Mutabil**, **Supply fix** / **Mintable până la X**, **Cod original** / **Cod modificat**. „Cod modificat” se calculează în browser: sha256 al bytecode-ului curent, citit prin RPC, comparat cu hash-ul original din record.
- Presale-urile și listările pentru contracte mutabile, modificate sau importate afișează un avertisment pentru cumpărători.

### Descărcarea codului original

Butonul **Descarcă codul original** generează o arhivă zip direct în browser, fără backend, cu:

- sursa AssemblyScript a șablonului, exact la versiunea folosită (sursele șabloanelor sunt incluse în aplicație, pe versiuni);
- parametrii constructorului (JSON) și `.wasm`-ul compilat, cu hash-ul său;
- un README: cum se compilează, cum se verifică hash-ul și cum se face upgrade.

Mesajul afișat la lansare și la descărcare: *„Păstrăm doar codul original. Dacă îți actualizezi contractul, RustCore Launchpad nu salvează noul cod; păstrează-l tu.”*

### Upgrade-ul Launchpad SC

Contractul nostru se poate actualiza doar în doi pași: `proposeUpgrade(hash)` (public pe lanț, cu eveniment) și `executeUpgrade(bytecode)` după cel puțin 72 h, cu bytecode-ul verificat față de hash. Frontendul afișează un banner cât timp există o propunere.

## Marketplace NFT

Marketplace-ul nu ia NFT-ul în custodie: vânzătorul îl păstrează în wallet și dă doar aprobare Launchpad SC-ului, care îl mută la cumpărător în momentul plății. Plățile sunt în MAS în v1.

### Operații

1. **Listare:** vânzătorul apelează `approve(Launchpad, tokenId)` (sau `setApprovalForAll` o singură dată pe colecție), apoi `list(colId, tokenId, preț, expiresAt)`. Launchpad SC verifică `ownerOf(tokenId) == caller`, aprobarea, că nu există deja o listare activă (`lstT:`), și scrie `lst:`, `lstC:`, `lstS:`, `lstT:`.
2. **Schimbare preț:** `updatePrice(listingId, prețNou)`, doar vânzătorul.
3. **Anulare:** `cancel(listingId)`, vânzătorul; admin-ul poate anula listările ascunse. Cheile de index se șterg, iar storage-ul eliberat se returnează vânzătorului.
4. **Cumpărare:** `buy(listingId)` cu `coins = preț`. Ordinea în contract (checks-effects-interactions):
   1. verifică listarea activă și neexpirată, `coins ≥ preț`, cumpărător ≠ vânzător, `ownerOf == seller`, aprobare validă;
   2. marchează listarea ca vândută și șterge indexurile;
   3. `transferFrom(seller, buyer, tokenId)` pe colecție;
   4. împarte banii: royalty către receiver, restul către vânzător (fără comision de platformă); surplusul înapoi la cumpărător;
   5. scrie `sale:` și actualizează `stat:` (volum, număr vânzări, ultimul preț).

### Listări care nu mai sunt valabile

Dacă vânzătorul transferă NFT-ul în altă parte sau retrage aprobarea, listarea rămâne în storage, dar nu mai poate fi cumpărată. Frontendul verifică `ownerOf` și aprobarea înainte să afișeze o listare și o ascunde pe cele invalide. Oricine poate apela `cleanup(listingId)` pentru o listare invalidă sau expirată; storage-ul eliberat merge la vânzător.

### Exemplu de împărțire

La un preț de 100 MAS și un royalty de 5 % (valoare de exemplu): 5 MAS merg la creator și 95 MAS la vânzător. Platforma nu ia nimic din vânzare. Toate calculele se fac în nanoMAS (`u64`), cu rotunjire în jos în favoarea vânzătorului.

### Ce afișăm

Pe pagina colecției: floor price (cel mai mic preț activ, calculat în browser din listările valide), volum total, număr de vânzări, ultimele vânzări, număr de owneri (din `totalSupply` + `ownerOf`, cu cache). Pe pagina NFT-ului: imagine, atribute, owner, preț, istoricul vânzărilor.

## Presale token

Presale-ul e opțional, pentru tokenuri lansate sau importate prin noi: owner-ul pune tokenurile în escrow la Launchpad SC, publicul contribuie cu MAS, iar la final fie toți își iau tokenurile (succes), fie își iau banii înapoi (eșec). Nimeni, nici noi, nu poate lua banii contributorilor înainte de succes.

### Parametri

| Parametru | Regulă |
| --- | --- |
| Token | lansat sau importat prin Launchpad, apelantul e owner-ul lui; un singur presale activ per token; escrow-ul se verifică prin diferența de sold după transferFrom |
| Tokenuri de vânzare | > 0; transferate în escrow la creare (`increaseAllowance` înainte) |
| Rată | tokenuri per 1 MAS (u256) |
| Soft cap / hard cap | în MAS; soft cap ≤ hard cap; hard cap × rată ≤ tokenuri de vânzare |
| Contribuție minimă / maximă per wallet | în MAS |
| Start, end | timestamp-uri; start ≥ acum, durată între 1 oră și 30 de zile (de stabilit) |
| Tokenuri nevândute | returnate owner-ului sau arse (alegere la creare) |
| Whitelist | v2 (rădăcină Merkle) |

### Stări

Starea se calculează din timestamp și sume la fiecare apel, nu printr-un job programat:

- **Upcoming** (înainte de start): owner-ul poate anula → **Cancelled**.
- **Active** (între start și end, sub hard cap): `contribute` cu `coins`; contribuția se adaugă la `ctb:` și la totalul strâns.
- **Atingerea hard cap-ului** închide presale-ul imediat.
- **După end:** oricine poate apela `finalize`. Strâns ≥ soft cap → **Success**; altfel → **Failed**.
- **Success:** fiecare contributor face `claim` (tokenuri = contribuție × rată); owner-ul face `withdrawRaised` (MAS strânși minus comisionul de presale) și primește tokenurile nevândute (sau acestea se ard).
- **Failed / Cancelled:** fiecare contributor face `refund`; owner-ul își recuperează toate tokenurile din escrow.

Pull, nu push: fiecare își ia singur tokenurile sau banii, ca să nu existe un apel cu bucle peste toți contributorii (gaz nelimitat). În v2 putem adăuga lichiditate automată pe Dusa la succes.

## Indexare, filtre și paginare fără backend

Filtrele sunt împărțite pe două niveluri: cele care reduc mult setul (owner, categorie, colecție, stare) au index în contract; restul (căutare text, sortare, interval de preț, trait-uri) se fac în browser peste datele deja citite.

### Nivelul 1: indexuri în datastore

| Filtru | Cum se citește |
| --- | --- |
| Toate tokenurile / colecțiile, cele mai noi primele | `getTokens(offset, limit)` pe ID descrescător (ID-urile sunt secvențiale) |
| Lansate de un user | chei cu prefix `own:<adresă>:<tip>:` → ID-uri → recorduri |
| Pe categorie | prefix `cat:<categorie>:<tip>:` |
| Listări active pe colecție / ale unui vânzător | prefix `lstC:<colId>:` / `lstS:<adresă>:` |
| Presale-uri în care am contribuit | prefix `ctbU:<adresă>:` |
| NFT-urile deținute de un user într-o colecție | indexul Enumerable din contractul colecției |
| Token după adresă / simbol | `tokA:` / `sym:` |

Citirea: `getStorageKeys(Launchpad, prefix)` dă cheile, apoi `readStorage` citește recordurile în loturi (de exemplu 50), sau o funcție `readSC` paginează direct în contract. Ambele sunt gratuite și nu cer wallet conectat.

### Nivelul 2: în browser

- Căutare după nume și simbol, sortare (cele mai noi, cele mai vechi, preț, volum, progres presale), interval de preț, „doar verificate”, „ascunde ce a ascuns admin-ul”, trait-uri NFT.
- Starea presale-ului (Upcoming / Active / Success / Failed) se calculează din timestamp-uri, deci se filtrează tot în browser.
- Datele citite stau într-un cache în memorie (signal store) și într-un snapshot în `sessionStorage`, cu reîmprospătare doar a ID-urilor noi (ultimul ID cunoscut vs `n:tok`).

### Limite și pragul de schimbare

Abordarea ține la câteva mii de recorduri per tip. RPC-ul public respinge rafalele (aproximativ 30 de citiri simultane, observat în wallet), așa că citim în loturi secvențiale. Dacă proiectul crește peste acest prag, putem adăuga un indexer opțional, fără să schimbăm contractul: sursa de adevăr rămâne datastore-ul.

## Frontend Angular

Același stack ca RustCore Wallet: Angular 22 (standalone, zoneless, signals, noul control flow), `@massalabs/massa-web3` 5.3, `@massalabs/wallet-provider` pentru conectare, Vitest, Prettier. Spre deosebire de wallet, Launchpad-ul e responsive (desktop și telefon), cu containerul de 1120 px al site-ului rustcore.massa.

### Structura repo-ului

```
rust-core-launchpad/
  smart-contract/                AssemblyScript (@massalabs/massa-as-sdk, sc-standards)
    assembly/contracts/          puncte de intrare (fiecare fișier → build/<nume>.wasm)
      launchpad.ts               factory + registry + marketplace + presale + admin
      rc-token.ts                șablon MRC20
      rc-collection.ts           șablon MRC721
    assembly/lib/                module interne, recorduri Serializable, chei
    assembly/__tests__/          teste unitare (vm-mock)
    src/deploy.ts                deploy + setTemplate pe buildnet/mainnet
  src/app/
    core/
      models/                    TokenRecord, CollectionRecord, Listing, Presale (oglinda AS)
      contracts/                 launchpad-contract.ts, token-contract.ts, collection-contract.ts (Args)
      services/                  massa-read.ts (readSC, storage), wallet-connect.ts, tx-runner.ts
      utils/                     token-amount, user-error, ipfs-url, validators
    state/                       launchpad-store, wallet-store, cache
    features/                    home, tokens, nfts, marketplace, presales, dashboard, admin
    shared/ui/                   card, dropdown, wizard, confirm-details, filter-bar, skeleton, toast
    layout/                      header (conectare wallet, rețea), footer
```

### Rute

| Rută | Pagină |
| --- | --- |
| `/` | Hero, statistici, tokenuri și colecții recente, presale-uri active |
| `/tokens`, `/tokens/:address` | Explorare cu filtre; detaliu token |
| `/create/token` | Wizard lansare token |
| `/collections`, `/collections/:address`, `/collections/:address/:tokenId` | Explorare; colecție (items, listări, activitate); NFT |
| `/create/collection` | Wizard lansare colecție |
| `/marketplace` | Toate listările active, cu filtre |
| `/presales`, `/presales/:id`, `/create/presale/:token` | Presale-uri; detaliu cu contribuție / claim / refund; creare |
| `/me` | Dashboard: tokenurile, colecțiile, NFT-urile, listările și contribuțiile mele; editare |
| `/admin` | Doar pentru adresa admin: taxe, șabloane, verificare, ascundere |

### Reguli preluate din wallet

- Sume: `number` în UI, `bigint` la granița cu contractul, conversie doar prin string (`toUnits` / `fromUnits`).
- Fiecare tranzacție are pas de Review, simulare `readSC` înainte și așteptarea execuției după; fără actualizări optimiste.
- Erorile trec prin `toUserMessage()`; skeleton-uri în loc de valori false; fonturile incluse local, fără CDN.
- Importul `@massalabs/massa-web3` primul în `main.ts`, shim-ul `crypto`, `trim-massa-web3.mjs` și `npm run smoke` (problemele de build deja rezolvate în wallet).
- Mainnet și buildnet, cu adresa Launchpad SC per rețea.

### Stil

Tokenurile de design de pe rustcore.massa: fundal `#07070a` cu glow roșu/albastru, accent roșu Massa `#ff2d42`, albastru `#4361ff`, portocaliu `#ff8a3d`, verde `#33d17a`, suprafețe `--bg-elevated`, borduri subtile, raze 10/14/20/26 px, Space Grotesk pentru titluri și Inter pentru text. Componente noi: carduri de token/colecție cu logo, badge „Verificat”, bară de progres presale, grid de NFT-uri, bară de filtre lipicioasă, wizard cu pași.

## Securitate, riscuri și costuri

Launchpad SC ține bani străini (escrow de presale și plăți în tranzit), deci se scrie și se testează ca un contract financiar: teste unitare pentru fiecare ramură, buildnet înainte de mainnet, review extern înainte de lansare.

| Risc | Măsură |
| --- | --- |
| Reentrancy prin apeluri către token/colecție | checks-effects-interactions + flag de lock pe funcțiile care mută bani; contractele importate sau modificate sunt cod necunoscut, deci lock pe toate funcțiile care mută bani sau NFT-uri |
| Admin-ul ia banii userilor | `withdrawFees` scoate doar contorul `fees`; escrow-ul presale e contabilizat separat; nicio funcție admin nu mută escrow |
| Upgrade rău intenționat (`setBytecode`) | Decis: upgrade doar prin proposeUpgrade(hash), public pe lanț, și executeUpgrade(bytecode) după 72 h, cu hash-ul verificat |
| Cheia admin compromisă | Admin = adresă separată, nu wallet-ul de zi cu zi; `pause` oprește creările și listările, nu și refund/claim/cancel |
| Tokenuri sau colecții scam / imitații | Badge „Verificat”, `setHidden`, opțional simbol unic, avertisment la simboluri cunoscute (MAS, USDC, WETH…) |
| Overflow și rotunjiri | u256 pentru tokenuri, u64 nanoMAS pentru MAS, înmulțire înainte de împărțire, teste cu valori limită |
| Bucle fără limită | Niciun apel nu iterează peste toți userii; paginare cu `limit` maxim (de exemplu 100) |
| Storage plătit din soldul nostru | Fiecare scriere cere `coins` și verifică diferența de sold; tranzacția eșuează dacă nu ajung |
| Listare cu NFT deja mutat | Verificare `ownerOf` + aprobare în `buy`; `cleanup` pentru listări moarte |
| Imagini sau linkuri rău intenționate | Doar `ipfs://` și `https://`; imaginile se afișează prin `<img>`, niciodată HTML; linkurile cu `rel="noopener noreferrer"` |

### Costuri estimate pentru user

Prețul storage-ului e confirmat în massa-web3: 0,0001 MAS/octet, plus costul a 4 octeți pentru fiecare intrare nouă. Șabloanele compilate au 38,5 KB (RC-Token) și 46,3 KB (RC-Collection), deja la optimizarea maximă de mărime, deci doar codul unui contract nou costă aproximativ 3,9 MAS (token) și 4,6 MAS (colecție). La asta se adaugă câteva sute de octeți pentru record și indexuri (sub 0,1 MAS), taxa platformei și taxa de rețea (0,01 MAS).

Măsurat pe buildnet pe 4 octombrie 2026 (cu taxele de test: 1 MAS la lansare, 0,5 MAS la import):

| Operație | Trimis | Consumat | Returnat automat |
| --- | --- | --- | --- |
| Deploy Launchpad + cele două șabloane (o singură dată, admin) | — | 16,54 MAS | — |
| Lansare token | 5,2533 MAS | 5,0042 MAS (1 taxă + 3,8533 cod + 0,1 depozit + 0,0509 record) | 0,2491 MAS |
| Editare prezentare (link mai scurt) | 0,3 MAS | sub 0 — storage-ul eliberat s-a returnat | tot |
| Import token | 0,8 MAS | 0,5451 MAS (0,5 taxă + 0,0451 record) | 0,2549 MAS |
| Lansare colecție | 6,0319 MAS | 5,7786 MAS (1 taxă + 4,632 cod + 0,1 depozit + record) | 0,2533 MAS |
| Mint public de 2 NFT (prețul revine owner-ului) | preț + 0,06 MAS | 0,054 MAS storage | restul |
| Mint de owner, per NFT | 0,02 MAS | ≈ 0,019 MAS storage | rămâne în colecție ca rezervă |
| Import colecție | 0,8 MAS | 0,5458 MAS | 0,2542 MAS |
| Tranzacție refuzată de contract | 6 MAS | 0,01 MAS (taxa de rețea) | 6 MAS | O listare costă sub 0,05 MAS storage, care revine vânzătorului la anulare sau vânzare.

## Plan de dezvoltare

Lucrăm în 8 faze, fiecare încheiată cu ceva care merge pe buildnet; contractul și UI-ul pentru o funcționalitate se fac în aceeași fază.

**Faza 0 — Schelet**

- [x] Proiect Angular 22 în `rust-core-launchpad` (standalone, zoneless, Vitest, Prettier, shim `crypto`, `trim-massa-web3`, smoke)
- [x] Folderul `smart-contract/` (AssemblyScript, massa-as-sdk, sc-standards, teste, script de deploy)
- [x] Design tokens și fonturi preluate din rustcore.massa; layout cu header, footer, rute goale
- [x] Conectare wallet (wallet-provider), selector de rețea, afișare adresă și sold

**Faza 1 — Șabloane**

- [x] RC-Token (MRC20 + owner explicit, mintable, burnable) cu teste
- [x] RC-Collection (MRC721 Enumerable + metadata, ownerMint, publicMint, freeze) cu teste

**Faza 2 — Launchpad SC: Factory + Registry**

- [x] Config, admin, `setTemplate`, contoare, recorduri Serializable
- [x] `createToken`, `createCollection`, `importToken`, `importCollection`, `updateInfo`, citiri paginate, indexuri; upgrade cu timelock
- [x] Contabilitate storage + taxe, teste, deploy pe buildnet (`AS12oApf4eeQLR76DKadC5oGQvq7LKTGngTFXjXUDojJqbeyTDSzx`), măsurarea costurilor reale

**Faza 3 — Tokenuri în UI**

- [x] Wizard lansare token cu Review și simulare
- [x] Explorare tokenuri cu filtre, pagina tokenului, editare, mint
- [x] Dashboard `/me`: tokenurile mele, import token, descărcarea codului original, badge-uri Mutabil / Cod modificat
- [x] Probă cap-coadă pe buildnet cu codul aplicației (`smart-contract/src/e2e.ts`): lansare, editare, mint, import, codul original
- [ ] Încercare în browser cu un wallet real (Bearby / Massa Station)

**Faza 4 — NFT-uri în UI**

- [x] Wizard colecție, mint de owner și public, import colecție cu sincronizarea NFT-urilor
- [x] Pagina colecției (grid, trait-uri), pagina NFT-ului, NFT-urile mele
- [x] Probă cap-coadă pe buildnet (`smart-contract/src/e2e-collections.ts`): lansare, mint public cu plată, limită per wallet, mint de owner (și cu URI propriu), setări, royalty, import

**Faza 5 — Marketplace**

- [ ] `list`, `updatePrice`, `cancel`, `buy`, `cleanup`, vânzări și statistici, cu teste
- [ ] UI: listare din pagina NFT-ului, cumpărare, `/marketplace`, floor și volum

**Faza 6 — Presale**

- [ ] `createPresale`, `contribute`, `finalize`, `claim`, `refund`, `cancelPresale`, `withdrawRaised`, cu teste pe toate stările
- [ ] UI: creare, pagina presale-ului cu progres, contribuțiile mele

**Faza 7 — Lansare**

- [ ] Pagina admin, badge-uri, ascundere
- [ ] Review de securitate, deploy pe mainnet, publicare pe DeWeb, linkuri din rustcore.massa

## Decizii

Deciziile luate pe 4 octombrie 2026; ultimele două rânduri rămân deschise.

| Subiect | Decizie |
| --- | --- |
| Marketplace | Colecții lansate prin noi + colecții importate de owner-ul lor; royalty pentru creator |
| Taxe | Doar la creare token, creare colecție, import (token sau colecție) și presale (bps din suma strânsă); fără comision la vânzările de pe marketplace; configurabile de admin |
| Import | Tokenuri și colecții NFT, doar de către owner |
| Simbol | Unic la lansări; simbolurile cunoscute (MAS, WMAS, USDC, WETH, WBTC, DAI, USDT…) blocate |
| Contractele userilor | Mutabile sau imuabile, la alegerea owner-ului; descarcă codul original; noi stocăm doar originalul |
| Launchpad SC | Upgrade cu timelock de 72 h |
| Imagini | URL-uri IPFS / HTTPS date de user, cu previzualizare și ghid |
| Plată | Doar MAS în v1 (implicit) |
| Presale | Fără lichiditate automată, whitelist sau vesting în v1 (implicit) |
| Interfață | Responsive, desktop + telefon (implicit) |
| Licență | FSL-1.1-ALv2, ca la wallet (implicit) |
| Valorile taxelor | Deschis: le stabilim înainte de mainnet |
| Adresa DeWeb | Deschis: o alegem înainte de faza 7 |
