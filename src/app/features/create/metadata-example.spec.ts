import { parseMetadata } from '../../core/launchpad/nft-metadata';
import { METADATA_EXAMPLE, METADATA_EXAMPLE_JSON } from './metadata-example';

describe('metadata example', () => {
  it('is read in full by the app’s own parser', () => {
    const parsed = parseMetadata(JSON.parse(METADATA_EXAMPLE_JSON))!;
    expect(parsed.name).toBe(METADATA_EXAMPLE.name);
    expect(parsed.description).toBe(METADATA_EXAMPLE.description);
    expect(parsed.image.startsWith('https://')).toBe(true); // ipfs:// through the gateway
    expect(parsed.attributes).toEqual([
      { trait: 'Background', value: 'Blue' },
      { trait: 'Eyes', value: 'Laser' },
    ]);
  });
});
