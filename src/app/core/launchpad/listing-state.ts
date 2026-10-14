/**
 * Reasons from the contract's `buyProblem` (marketplace.ts) after which a listing can turn
 * buyable again by itself, at its old price: the NFT comes back to the seller with the
 * approval still in place, the seller approves the Launchpad again, or the admin shows the
 * collection again. Expired listings and removed collections never come back.
 */
const REVIVABLE = [
  'The seller no longer owns this NFT',
  'The seller withdrew the approval',
  'This collection is hidden',
];

/** Can a listing that can't be bought now (`problem` from buyProblem) become buyable again? */
export function listingCanRevive(problem: string): boolean {
  return REVIVABLE.includes(problem);
}
