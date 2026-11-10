import type { Money, Plan, SettledEvent } from "./types.js";

/**
 * Access that runs out.
 *
 * Bitcoin has no recurring charge to hang a subscription on, so what is sold
 * is a pass: one payment, a number of days. Paying again before it runs out
 * adds the days to the end, so renewing early costs the buyer nothing.
 */
export type Entitlement = {
  planId: string;
  /** ISO time the access ends. */
  expiresAt: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function isActive(entitlement: Entitlement | null | undefined, now: Date = new Date()): boolean {
  return !!entitlement && new Date(entitlement.expiresAt).getTime() > now.getTime();
}

/** The pass after one more payment for `plan`, settled at `paidAt`. */
export function extendEntitlement(current: Entitlement | null | undefined, plan: Pick<Plan, "id" | "days">, paidAt: Date): Entitlement {
  const runsUntil = current ? new Date(current.expiresAt).getTime() : 0;
  const from = Math.max(runsUntil, paidAt.getTime());
  return { planId: plan.id, expiresAt: new Date(from + plan.days * DAY_MS).toISOString() };
}

/** Whole days left, rounded up; 0 once it has run out. */
export function daysLeft(entitlement: Entitlement | null | undefined, now: Date = new Date()): number {
  if (!entitlement) return 0;
  return Math.max(0, Math.ceil((new Date(entitlement.expiresAt).getTime() - now.getTime()) / DAY_MS));
}

/** What the app kept when it created the checkout. */
export type StoredCheckout = {
  id: string;
  reference: string;
  planId: string;
  amount: Money;
};

/**
 * Where the app keeps checkouts and passes.
 *
 * `settleOnce` is the whole idempotency guarantee, so it must be one
 * transaction: mark the checkout settled only if it is not, and in that same
 * transaction replace the buyer's entitlement with `grant(current)`. It
 * returns null when the checkout was already settled, and nothing changes.
 * A provider delivers a settlement more than once, and the status poll races
 * the webhook; both arrive here.
 */
export interface EntitlementStore {
  findCheckout(externalId: string): Promise<StoredCheckout | null>;
  settleOnce(
    checkout: StoredCheckout,
    grant: (current: Entitlement | null) => Entitlement,
    paidAt: Date,
  ): Promise<Entitlement | null>;
}

export type SettlementOutcome =
  | { outcome: "granted"; reference: string; entitlement: Entitlement }
  | { outcome: "duplicate"; reference: string }
  /** No checkout of ours has this id: somebody else's payment to the same seller. */
  | { outcome: "unknown-checkout" }
  | { outcome: "unknown-plan"; planId: string }
  | { outcome: "wrong-product" }
  | { outcome: "underpaid"; expected: Money; received: Money };

/**
 * Turn a settled payment into access, once.
 *
 * The event is trusted to be authentic (the provider's `verifyWebhook` or its
 * own `status` answer said so) and to nothing more. What was bought, by whom
 * and for how much come from the checkout the app stored, not from the event;
 * where the event does state an amount or a product, it has to agree.
 */
export async function applySettlement(input: {
  event: SettledEvent;
  plans: readonly Plan[];
  store: EntitlementStore;
  paidAt?: Date;
}): Promise<SettlementOutcome> {
  const { event, plans, store } = input;
  const checkout = await store.findCheckout(event.externalId);
  if (!checkout) return { outcome: "unknown-checkout" };

  const plan = plans.find((p) => p.id === checkout.planId);
  if (!plan) return { outcome: "unknown-plan", planId: checkout.planId };

  if (event.providerRef !== null && event.providerRef !== plan.providerRef) return { outcome: "wrong-product" };
  if (event.amount !== null) {
    const sameCurrency = event.amount.currency === checkout.amount.currency;
    if (!sameCurrency || event.amount.amount < checkout.amount.amount) {
      return { outcome: "underpaid", expected: checkout.amount, received: event.amount };
    }
  }

  const paidAt = input.paidAt ?? new Date();
  const entitlement = await store.settleOnce(checkout, (current) => extendEntitlement(current, plan, paidAt), paidAt);
  return entitlement
    ? { outcome: "granted", reference: checkout.reference, entitlement }
    : { outcome: "duplicate", reference: checkout.reference };
}
