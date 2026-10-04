/**
 * Turns any thrown error into a short message fit for the screen (pattern from RustCore
 * Wallet). The app's own messages ("Bearby refused the connection.") pass through unchanged;
 * raw node / VM / network errors become a plain sentence, and the original goes to the console
 * for debugging, never to the user.
 */

interface Rule {
  readonly test: RegExp;
  readonly message: string;
}

/** Most specific first. */
const RULES: readonly Rule[] = [
  {
    test: /user (rejected|denied|cancel)|rejected by user|request rejected/i,
    message: 'The request was rejected in your wallet.',
  },
  {
    test: /insufficient (funds|balance)|not enough (funds|balance)|failed to transfer .* insufficient/i,
    message: "You don't have enough MAS for this transaction, including fees.",
  },
  {
    test: /insufficient allowance/i,
    message: "The token wasn't approved for this operation. Please try again.",
  },
  {
    test: /NotEnoughCoinsSent|storage/i,
    message: 'Not enough MAS to cover the storage cost of this transaction.',
  },
  {
    test: /invalid address|address.*invalid/i,
    message: 'That address is not valid.',
  },
  {
    test: /Failed to fetch|NetworkError|Network request failed|ECONN|ETIMEDOUT|Unexpected token '<'|is not valid JSON|status code 5\d\d|responded 5\d\d/i,
    message: "Couldn't reach the Massa network. Check your connection and try again.",
  },
];

/** Tell-tale signs of a raw, technical error that must never be shown as-is. */
const TECHNICAL =
  /VM Error|Runtime error|readonly call|ReadOnlyExecution|~lib\/|\.ts:\d+|at [\w$.]+ \(|Depth error|massa_execution_error|JSON|fetch|RPC|status code|[{}[\]]/i;

const GENERIC = 'Something went wrong. Please try again.';

/** Longest a pass-through message may be; anything longer is treated as technical. */
const MAX_PLAIN_LENGTH = 140;

export function toUserMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  if (!raw) return GENERIC;

  const rule = RULES.find((r) => r.test.test(raw));
  const isTechnical = TECHNICAL.test(raw) || raw.length > MAX_PLAIN_LENGTH;

  if (isTechnical || rule) console.error('[launchpad error]', err);
  if (rule) return rule.message;
  if (isTechnical) return GENERIC;
  return raw; // already user-facing
}
