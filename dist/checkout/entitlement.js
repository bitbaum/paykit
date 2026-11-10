const DAY_MS = 24 * 60 * 60 * 1000;
export function isActive(entitlement, now = new Date()) {
    return !!entitlement && new Date(entitlement.expiresAt).getTime() > now.getTime();
}
/** The pass after one more payment for `plan`, settled at `paidAt`. */
export function extendEntitlement(current, plan, paidAt) {
    const runsUntil = current ? new Date(current.expiresAt).getTime() : 0;
    const from = Math.max(runsUntil, paidAt.getTime());
    return { planId: plan.id, expiresAt: new Date(from + plan.days * DAY_MS).toISOString() };
}
/** Whole days left, rounded up; 0 once it has run out. */
export function daysLeft(entitlement, now = new Date()) {
    if (!entitlement)
        return 0;
    return Math.max(0, Math.ceil((new Date(entitlement.expiresAt).getTime() - now.getTime()) / DAY_MS));
}
/**
 * Turn a settled payment into access, once.
 *
 * The event is trusted to be authentic (the provider's `verifyWebhook` or its
 * own `status` answer said so) and to nothing more. What was bought, by whom
 * and for how much come from the checkout the app stored, not from the event;
 * where the event does state an amount or a product, it has to agree.
 */
export async function applySettlement(input) {
    const { event, plans, store } = input;
    const checkout = await store.findCheckout(event.externalId);
    if (!checkout)
        return { outcome: "unknown-checkout" };
    const plan = plans.find((p) => p.id === checkout.planId);
    if (!plan)
        return { outcome: "unknown-plan", planId: checkout.planId };
    if (event.providerRef !== null && event.providerRef !== plan.providerRef)
        return { outcome: "wrong-product" };
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
