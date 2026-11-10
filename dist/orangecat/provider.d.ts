import type { PaymentProvider } from "../checkout/types.js";
/**
 * Bitcoin through an OrangeCat account.
 *
 * The seller publishes a product on OrangeCat and connects a wallet there.
 * This asks OrangeCat for an invoice paying that product, so the money goes
 * from the buyer's wallet to the seller's: neither the app nor this package
 * ever holds it.
 *
 * It uses OrangeCat's account-less payment (`POST /api/v1/payments/public`),
 * and deliberately not the keyed `POST /api/v1/payments`: that one records the
 * key's owner as the buyer and refuses a seller buying their own product, so
 * a seller's key cannot sell to a customer. The account-less call needs no
 * key at all. Two things follow from it, and the app has to know both:
 *
 * - The amount is stated by the caller, not read from the product. The plan's
 *   price must be in `SAT`, and `applySettlement` checks what arrived.
 * - A settlement names only the payment (`externalId`), never the buyer. The
 *   app must store each checkout it creates.
 */
export type OrangeCatConfig = {
    /** Default `https://orangecat.ch`. */
    baseUrl?: string;
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
