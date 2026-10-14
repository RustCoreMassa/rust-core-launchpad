import { listingCanRevive } from './listing-state';

describe('listing state', () => {
  it('knows which inactive listings can turn buyable again', () => {
    expect(listingCanRevive('The seller no longer owns this NFT')).toBe(true);
    expect(listingCanRevive('The seller withdrew the approval')).toBe(true);
    expect(listingCanRevive('This collection is hidden')).toBe(true);
    expect(listingCanRevive('This listing has expired')).toBe(false);
    expect(listingCanRevive('Not a Launchpad collection')).toBe(false);
    expect(listingCanRevive('')).toBe(false);
  });
});
