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
export declare function isActive(entitlement: Entitlement | null | undefined, now?: Date): boolean;
/** The pass after one more payment for `plan`, settled at `paidAt`. */
export declare function extendEntitlement(current: Entitlement | null | undefined, plan: Pick<Plan, "id" | "days">, paidAt: Date): Entitlement;
/** Whole days left, rounded up; 0 once it has run out. */
export declare function daysLeft(entitlement: Entitlement | null | undefined, now?: Date): number;
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
    settleOnce(checkout: StoredCheckout, grant: (current: Entitlement | null) => Entitlement, paidAt: Date): Promise<Entitlement | null>;
}
export type SettlementOutcome = {
    outcome: "granted";
    reference: string;
    entitlement: Entitlement;
} | {
    outcome: "duplicate";
    reference: string;
}
/** No checkout of ours has this id: somebody else's payment to the same seller. */
 | {
    outcome: "unknown-checkout";
} | {
    outcome: "unknown-plan";
    planId: string;
} | {
    outcome: "wrong-product";
} | {
    outcome: "underpaid";
    expected: Money;
    received: Money;
};
/**
 * Turn a settled payment into access, once.
 *
 * The event is trusted to be authentic (the provider's `verifyWebhook` or its
 * own `status` answer said so) and to nothing more. What was bought, by whom
 * and for how much come from the checkout the app stored, not from the event;
 * where the event does state an amount or a product, it has to agree.
 */
export declare function applySettlement(input: {
    event: SettledEvent;
    plans: readonly Plan[];
    store: EntitlementStore;
    paidAt?: Date;
}): Promise<SettlementOutcome>;
