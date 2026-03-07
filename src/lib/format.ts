/**
 * Format a price with adaptive decimals — when the value would show as "$0.00",
 * increases decimal places until a non-zero digit is visible (up to 6 decimals).
 * e.g. 0.007 → "$0.007", 0.00003 → "$0.00003", 1.50 → "$1.50"
 */
export function formatSmartPrice(price: number): string {
  if (price === 0) return "$0.00";
  const abs = Math.abs(price);
  for (let d = 2; d <= 6; d++) {
    const factor = Math.pow(10, d);
    if (Math.round(abs * factor) > 0) {
      return `$${price.toFixed(d)}`;
    }
  }
  return `$${price.toFixed(6)}`;
}
