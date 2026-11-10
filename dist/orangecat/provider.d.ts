import type { PaymentProvider } from "../checkout/types.js";
/**
 * Bitcoin through an OrangeCat account.
 *
 * The seller publishes a product on OrangeCat and connects a wallet there.
 * This asks OrangeCat for an invoice paying that product, so the money goes
 * from the buyer's wallet to the seller's: neither the app nor this package
 * ever holds it.
 *
 * OrangeCat has two ways to ask for that invoice, and this uses whichever
 * the configuration allows:
 *
 * - WITH `apiKey` (an `ock_…` integration key, scopes `payments.write` and
 *   `payments.read`): `POST /api/v1/payments`, read back with
 *   `GET /api/v1/payments/{id}`. OrangeCat records the key's owner as the
 *   buyer and refuses an owner paying their own entity ("You cannot pay for
 *   your own entity"). So a key minted by the account that owns the paid
 *   entity cannot start a payment for a customer. When OrangeCat answers
 *   exactly that, this falls back to the account-less call below instead of
 *   failing the customer, and the fallback is the normal case for an app
 *   that is paid into its own account.
 * - WITHOUT a key, or after that refusal: the account-less
 *   `POST /api/v1/payments/public`, read back with the status token it
 *   returns (the checkout's `handle`).
 *
 * Either way, two things follow, and the app has to know both:
 *
 * - The amount is stated by the caller. The plan's price must be in `SAT`,
 *   and `applySettlement` checks what arrived.
 * - A settlement names only the payment (`externalId`), never the buyer. The
 *   app must store each checkout it creates.
 */
export type OrangeCatConfig = {
    /** Default `https://orangecat.ch`. */
    baseUrl?: string;
    /** An `ock_…` integration key with `payments.write` and `payments.read`. Optional: see above. */
    apiKey?: string;
    /** The `ock_whk_…` secret of the webhook endpoint. Without it `verifyWebhook` refuses everything. */
    webhookSecret?: string;
    /** What kind of OrangeCat entity `plan.providerRef` is. Default `product`. */
    entityType?: string;
    fetch?: typeof fetch;
    /** For tests. */
    now?: () => Date;
    timeoutMs?: number;
};
export declare const ORANGECAT_PROVIDER_ID = "orangecat";
export declare const ORANGECAT_SETTLED_EVENT = "payment.settled";
export declare class OrangeCatError extends Error {
    readonly status: number;
    constructor(message: string, status: number);
}
export declare function orangeCatProvider(config?: OrangeCatConfig): PaymentProvider;
