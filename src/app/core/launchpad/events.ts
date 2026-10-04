// Pure helpers over node errors and contract events — no Angular, so scripts can use them too.

/**
 * The contract's own message out of a node error. Seen on buildnet (2026-10-04):
 * "readonly call failed: VM Error in ReadOnlyExecutionTarget::FunctionCall context: Depth error:
 * Runtime error: error: This symbol is already taken or reserved at assembly/contracts/
 * launchpad.ts:140 col: 3" → "This symbol is already taken or reserved". The older
 * "abort with message: …" wording is understood too.
 */
export function contractReason(raw: string): string {
  let text = raw;
  try {
    const parsed = JSON.parse(raw) as { massa_execution_error?: string };
    text = parsed.massa_execution_error ?? raw;
  } catch {
    // not JSON
  }
  const match =
    /(?:abort with message:|Runtime error: error:)\s*(.+?)(?:\s+at\s+\S+\.ts:\d+|\s+at\s+\S+\(|$)/s.exec(
      text,
    );
  return (match?.[1] ?? text).trim().slice(0, 200) || 'rejected by the network';
}

/** First event of a kind, split into its fields: "TOKEN_CREATED:3,AS1…" → ["3", "AS1…"]. */
export function eventFields(events: string[], name: string): string[] | null {
  const event = events.find((e) => e.startsWith(name + ':'));
  return event ? event.slice(name.length + 1).split(',') : null;
}
