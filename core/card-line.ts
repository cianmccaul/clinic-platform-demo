/**
 * The one line the Hub keeps in a Cliniko patient's notes to show reception
 * that a card is saved in Stripe. Pure (no I/O) so it can be unit-tested.
 * Only brand, last 4 and expiry — never a full card number (PCI SAQ A).
 */

export const CARD_LINE_PREFIX = "Card on file (Stripe):";

const BRAND_NAMES: Record<string, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "Amex",
  discover: "Discover",
  diners: "Diners",
  jcb: "JCB",
  unionpay: "UnionPay",
  cartes_bancaires: "Cartes Bancaires",
};

export function formatCardLine(card: {
  brand?: string | null;
  last4?: string | null;
  exp_month?: number | null;
  exp_year?: number | null;
}) {
  const brand = BRAND_NAMES[card.brand ?? ""] ?? "Card";
  const last4 = /^\d{4}$/.test(card.last4 ?? "") ? card.last4 : "????";
  const exp =
    card.exp_month && card.exp_year
      ? `, exp ${String(card.exp_month).padStart(2, "0")}/${String(card.exp_year).slice(-2)}`
      : "";
  return `${CARD_LINE_PREFIX} ${brand} •••• ${last4}${exp} — charge via Northbank admin`;
}

export function removedCardLine(today = new Date()) {
  const d = today.toLocaleDateString("en-IE", {
    timeZone: "Europe/Dublin",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return `${CARD_LINE_PREFIX} none — card removed ${d}`;
}

/** Replaces the existing card line (if any) with `line`, leaving every other note untouched. */
export function withCardLine(notes: string | null | undefined, line: string) {
  const lines = (notes ?? "").split(/\r?\n/);
  const at = lines.findIndex((l) => l.trim().startsWith(CARD_LINE_PREFIX));
  if (at !== -1) {
    lines[at] = line;
    return lines.join("\n");
  }
  const existing = (notes ?? "").replace(/\s+$/, "");
  return existing ? `${existing}\n${line}` : line;
}
