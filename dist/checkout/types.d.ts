/**
 * Taking a payment for a plan, whoever moves the money.
 *
 * An app describes what it sells (a `Plan`) and who is buying (its own
 * `reference`). A provider turns that into something the buyer can pay, says
 * whether it has been paid, and authenticates the provider's own "it settled"
 * call. Nothing here names a provider: the same three calls fit a Lightning
 * invoice and a hosted card checkout.
 */
/** An amount in the currency's smallest unit. Bitcoin is counted in `SAT`. */
export type Money = {
    amount: number;
    currency: string;
};
/** What is for sale: access for a number of days, at a price. */
export type Plan = {
    /** The app's own name for it, e.g. `month`. */
    id: string;
    /** How long one payment lasts. */
    days: number;
    price: Money;
    /** What the provider calls the thing being sold (a product id, a price id). */
    providerRef: string;
};
export type CheckoutInput = {
    plan: Plan;
    /** Who this is for, in the app's own terms (a user id). Never sent to the provider unless it has a field for it. */
    reference: string;
};
/** Something a buyer can pay. The app stores it: it is the only link from a settlement back to a buyer. */
export type Checkout = {
    provider: string;
    /** The provider's id for this payment. A settlement names it as `externalId`. */
    id: string;
    reference: string;
    planId: string;
    amount: Money;
    /** What to draw as a QR code: a BOLT11 invoice or a `bitcoin:` URI. Absent for a hosted checkout. */
    invoice?: string;
    /** Where a tap takes the buyer to pay: a wallet link or a hosted page. */
    payUrl?: string;
    /** After this the checkout cannot be paid; null when it does not expire. */
    expiresAt: string | null;
    /**
     * What the provider needs to answer `status` for this checkout, when the id
     * is not enough. Secret: keep it on the server.
     */
    handle?: string;
};
export type CheckoutState = "pending" | "paid" | "expired" | "failed";
export type CheckoutStatus = {
    state: CheckoutState;
    paidAt: string | null;
};
/** A payment that settled, in the same words whichever provider reported it. */
export type SettledEvent = {
    provider: string;
    /** The checkout's id. Settling is idempotent on this. */
    externalId: string;
    /** What actually arrived, when the provider says. */
    amount: Money | null;
    /** What the provider says was paid for, when it says. */
    providerRef: string | null;
    /** The provider's id for this delivery, for logs. */
    eventId: string | null;
};
export type WebhookResult = 
/** Authentic. `event` is null for an authentic call about something else. */
{
    ok: true;
    event: SettledEvent | null;
}
/** Not authentic. Answer 400 and do not say why. */
 | {
    ok: false;
    reason: string;
};
export type HeaderBag = Headers | Record<string, string | string[] | undefined>;
/** Who receives the money, as the provider itself describes them. */
export type Payee = {
    name: string | null;
    /** The payee's own page at the provider, where a person can also pay by hand. */
    url: string;
    /**
     * Whether the provider shows somewhere for money to land. `null` when it
     * does not say, which is not a no; `createCheckout` is then the only way to
     * find out.
     */
    payable: boolean | null;
};
export interface PaymentProvider {
    readonly id: string;
    /** Read the payee from the provider. Never from anything typed into the app. */
    payee?(providerRef: string): Promise<Payee>;
    createCheckout(input: CheckoutInput): Promise<Checkout>;
    status(checkout: Pick<Checkout, "id" | "handle">): Promise<CheckoutStatus>;
    /** `rawBody` exactly as received: a parsed and re-serialised body no longer matches its signature. */
    verifyWebhook(rawBody: string, headers: HeaderBag): WebhookResult;
}
/** One header, whatever shape the framework hands them over in. */
export declare function readHeader(headers: HeaderBag, name: string): string | null;
