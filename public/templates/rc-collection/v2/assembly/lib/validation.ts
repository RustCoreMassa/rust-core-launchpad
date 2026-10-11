// Basic sanity limits enforced by the templates themselves. The Launchpad SC applies the stricter
// product rules (symbol charset, blocked symbols, supply caps) before it deploys.

export const MAX_NAME_LENGTH = 64;
export const MAX_SYMBOL_LENGTH = 16;
export const MAX_URI_LENGTH = 512;

export function assertLength(value: string, min: i32, max: i32, what: string): void {
  assert(
    value.length >= min && value.length <= max,
    what + ' must be ' + min.toString() + '-' + max.toString() + ' characters',
  );
}
