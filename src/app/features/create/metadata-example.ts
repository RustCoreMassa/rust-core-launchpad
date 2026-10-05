/**
 * The NFT metadata the app reads (the usual EIP-721 JSON + OpenSea-style `attributes`), shown to
 * creators as an example. Only these fields are used; others are ignored.
 */
export const METADATA_EXAMPLE = {
  name: 'Market Cats #1',
  description: 'The first cat of the collection.',
  image: 'ipfs://bafyIMAGES…/1.png',
  attributes: [
    { trait_type: 'Background', value: 'Blue' },
    { trait_type: 'Eyes', value: 'Laser' },
  ],
};

export const METADATA_EXAMPLE_JSON = JSON.stringify(METADATA_EXAMPLE, null, 2);

/** The folder layout for the "one IPFS folder" mode. */
export const FOLDER_TREE = `images/      → upload first  → ipfs://bafyIMAGES…/
  1.png
  2.png
  …
metadata/    → upload second → ipfs://bafyMETA…/   ← your folder link
  1.json
  2.json
  …`;
