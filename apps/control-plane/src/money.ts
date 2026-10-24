/** USD amounts stored as fixed 6-decimal strings so cost never depends on binary floats. */

export function formatUsd(value: string): string {
  return fromMicro(toMicro(value));
}

export function addUsd(left: string, right: string): string {
  return fromMicro(toMicro(left) + toMicro(right));
}

/**
 * Anthropic list_cost.amount is an integer string of minor units (cents for USD).
 * "2500" is $25.00.
 */
export function usdFromMinorUnits(amount: string): string {
  const negative = amount.startsWith("-");
  const digits = negative ? amount.slice(1) : amount;
  if (!/^\d+$/.test(digits)) {
    throw new Error(`invalid minor-unit amount: ${amount}`);
  }
  const cents = BigInt(digits);
  const negativeMicro = negative ? -cents * 10_000n : cents * 10_000n;
  return fromMicro(negativeMicro);
}

function toMicro(value: string): bigint {
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole, fraction = ""] = unsigned.split(".");
  if (
    !whole ||
    !/^\d+$/.test(whole) ||
    (fraction && !/^\d+$/.test(fraction)) ||
    unsigned.split(".").length > 2
  ) {
    throw new Error(`invalid USD amount: ${value}`);
  }
  const frac6 = `${fraction}000000`.slice(0, 6);
  const micro = BigInt(whole) * 1_000_000n + BigInt(frac6);
  return negative ? -micro : micro;
}

function fromMicro(value: bigint): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / 1_000_000n;
  const fraction = (absolute % 1_000_000n).toString().padStart(6, "0");
  return `${negative ? "-" : ""}${whole.toString()}.${fraction}`;
}
