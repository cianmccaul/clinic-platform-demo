/**
 * Rules for paying self-employed therapists directly (ADR 0006).
 *
 * A therapist's booking is a Stripe "direct charge" on their own connected
 * account: they are the seller, the money is theirs from the moment the
 * patient pays, and Stripe takes its fees from their account, not Northbank's.
 * Pure functions only, unit-tested in tests/connect.test.ts.
 */

/**
 * How the Hub creates a therapist's Stripe account: Stripe's own sign-up form
 * and the therapist's own full Stripe Dashboard, the therapist pays Stripe's
 * fees directly, and Stripe (not Northbank) carries the risk of chargebacks the
 * therapist can't cover. Stripe only allows "the account pays its own fees"
 * with the full Dashboard: with the Express Dashboard the platform must pay
 * them (live error, 6 Oct 2026), so the Express Dashboard isn't used.
 */
export const THERAPIST_ACCOUNT_CONTROLLER = {
  stripe_dashboard: { type: "full" },
  fees: { payer: "account" },
  losses: { payments: "stripe" },
  requirement_collection: "stripe",
} as const;


type AccountLike = {
  charges_enabled?: boolean | null;
  controller?: { fees?: { payer?: string | null } | null } | null;
};

/**
 * Payments are only routed to a therapist's account once Stripe says it can
 * take charges AND the therapist pays their own Stripe fees. An account made
 * the old way (type "express", Northbank pays the fees) never qualifies, so its
 * bookings safely stay with the clinic until the therapist signs up again.
 */
export function isTherapistAccountReady(account: AccountLike): boolean {
  return !!account.charges_enabled && account.controller?.fees?.payer === "account";
}

/** A saved card as stored by lib/customer-mapping.ts. */
export type SavedCards = {
  stripeCustomerId: string;
  defaultPaymentMethodId: string;
  // Where the default card lives: undefined = Northbank's own account.
  account?: string;
  // Cards usable on each account ("platform" = Northbank's own account),
  // including copies of a Northbank card made for a therapist's account.
  byAccount?: Record<string, { stripeCustomerId: string; paymentMethodId: string }>;
  // Older records: copies of the Northbank card, keyed by account (payment method only).
  clonedPaymentMethods?: Record<string, string>;
};

export const PLATFORM = "platform";

export type CardChoice =
  | { mode: "use"; stripeCustomerId: string; paymentMethodId: string }
  // A card saved on Northbank's account can be copied onto a therapist's account.
  | { mode: "copy"; platformCustomerId: string; platformPaymentMethodId: string }
  // The only saved card belongs to a different therapist's account: Stripe
  // can't move it, so the patient has to enter their card again.
  | { mode: "none" };

/** Which saved card can pay on `targetAccount` (undefined = Northbank's own account). */
export function chooseSavedCard(saved: SavedCards, targetAccount?: string): CardChoice {
  const key = targetAccount ?? PLATFORM;
  const exact = saved.byAccount?.[key];
  if (exact) return { mode: "use", ...exact };
  if ((saved.account ?? PLATFORM) === key) {
    return { mode: "use", stripeCustomerId: saved.stripeCustomerId, paymentMethodId: saved.defaultPaymentMethodId };
  }
  const platform =
    saved.byAccount?.[PLATFORM] ??
    (saved.account === undefined ? { stripeCustomerId: saved.stripeCustomerId, paymentMethodId: saved.defaultPaymentMethodId } : undefined);
  if (targetAccount && platform) {
    return { mode: "copy", platformCustomerId: platform.stripeCustomerId, platformPaymentMethodId: platform.paymentMethodId };
  }
  return { mode: "none" };
}

/** One saved card and the account it lives on (undefined = Northbank's own account). */
export type SavedCardRef = { account?: string; stripeCustomerId?: string; paymentMethodId: string };

/**
 * Every card a record knows about, default first, each once. Used to find a
 * card that still exists in Stripe (a card can be deleted, or a record can
 * outlive the Stripe account it was saved on).
 */
export function savedCardCandidates(saved: SavedCards): SavedCardRef[] {
  const out: SavedCardRef[] = [];
  const seen = new Set<string>();
  const add = (ref: SavedCardRef) => {
    if (!ref.paymentMethodId || seen.has(ref.paymentMethodId)) return;
    seen.add(ref.paymentMethodId);
    out.push(ref);
  };
  const acct = (key: string) => (key === PLATFORM ? undefined : key);
  add({ account: saved.account, stripeCustomerId: saved.stripeCustomerId, paymentMethodId: saved.defaultPaymentMethodId });
  for (const [key, card] of Object.entries(saved.byAccount ?? {})) {
    add({ account: acct(key), stripeCustomerId: card.stripeCustomerId, paymentMethodId: card.paymentMethodId });
  }
  for (const [key, pm] of Object.entries(saved.clonedPaymentMethods ?? {})) add({ account: acct(key), paymentMethodId: pm });
  return out;
}
