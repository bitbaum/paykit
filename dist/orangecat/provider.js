import { readHeader } from "../checkout/types.js";
import { SIGNATURE_HEADER, verifyOrangeCatSignature } from "./signature.js";
export const ORANGECAT_PROVIDER_ID = "orangecat";
export const ORANGECAT_SETTLED_EVENT = "payment.settled";
const SATS_PER_BTC = 100_000_000;
const KEY_HEADER = "x-orangecat-key";
/** OrangeCat's sentence for a key whose owner is the payee. */
const OWN_ENTITY = /your own entity/i;
export class OrangeCatError extends Error {
    status;
    constructor(message, status) {
        super(message);
        this.status = status;
        this.name = "OrangeCatError";
    }
}
/** OrangeCat's own states; anything not final is still waiting for money or for the seller. */
function toState(status) {
    if (status === "paid")
        return "paid";
    if (status === "expired")
        return "expired";
    if (status === "failed")
        return "failed";
    return "pending";
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function orangeCatProvider(config = {}) {
    const baseUrl = (config.baseUrl ?? "https://orangecat.ch").replace(/\/+$/, "");
    const entityType = config.entityType ?? "product";
    const doFetch = config.fetch ?? fetch;
    const now = config.now ?? (() => new Date());
    const timeoutMs = config.timeoutMs ?? 15_000;
    /** Every v1 answer is `{ success, data }`; an error carries a message that is safe to show. */
    async function call(path, init) {
        const response = await doFetch(`${baseUrl}${path}`, { ...init, signal: AbortSignal.timeout(timeoutMs) });
        const body = await response.json().catch(() => null);
        if (!response.ok || !isRecord(body) || body.success !== true || !isRecord(body.data)) {
            const error = isRecord(body) ? body.error : null;
            const message = isRecord(error) && typeof error.message === "string" ? error.message : typeof error === "string" ? error : `OrangeCat answered ${response.status}`;
            throw new OrangeCatError(message, response.status);
        }
        return body.data;
    }
    return {
        id: ORANGECAT_PROVIDER_ID,
        /**
         * The public record of the entity being paid. `payable` is true when it
         * shows a Bitcoin or Lightning address of its own, and null otherwise,
         * never false: OrangeCat routes a payment to the wallet the owner
         * connected to the entity or to their account, and that is not part of
         * the public record. Heidi's project showed neither field while its
         * owner's wallet was collecting payments. Only `createCheckout` knows.
         */
        async payee(providerRef) {
            const data = await call(`/api/v1/${entityType}s/${encodeURIComponent(providerRef)}`, { method: "GET" });
            const entity = isRecord(data[entityType]) ? data[entityType] : data;
            const has = (key) => typeof entity[key] === "string" && entity[key].trim() !== "";
            return {
                name: typeof entity.title === "string" ? entity.title : null,
                url: `${baseUrl}/${entityType}s/${encodeURIComponent(providerRef)}`,
                payable: has("bitcoin_address") || has("lightning_address") ? true : null,
            };
        },
        async createCheckout({ plan, reference }) {
            if (plan.price.currency !== "SAT" || !Number.isInteger(plan.price.amount) || plan.price.amount <= 0) {
                throw new OrangeCatError("An OrangeCat plan is priced in whole SAT.", 0);
            }
            const body = JSON.stringify({
                entity_type: entityType,
                entity_id: plan.providerRef,
                amount_btc: Number((plan.price.amount / SATS_PER_BTC).toFixed(8)),
            });
            const accountless = () => call("/api/v1/payments/public", { method: "POST", headers: { "content-type": "application/json" }, body });
            let data;
            let keyed = false;
            if (config.apiKey) {
                try {
                    data = await call("/api/v1/payments", {
                        method: "POST",
                        headers: { "content-type": "application/json", [KEY_HEADER]: config.apiKey },
                        body,
                    });
                    keyed = true;
                }
                catch (error) {
                    // The key belongs to the account being paid: OrangeCat will not let
                    // an owner buy from themselves. The customer still has to be able
                    // to pay, so the invoice is asked for without the key.
                    if (!(error instanceof OrangeCatError) || !OWN_ENTITY.test(error.message))
                        throw error;
                    data = await accountless();
                }
            }
            else {
                data = await accountless();
            }
            const intent = data.payment_intent;
            const token = typeof data.status_token === "string" ? data.status_token : null;
            if (!isRecord(intent) || typeof intent.id !== "string" || typeof data.qr_data !== "string" || (!keyed && !token)) {
                throw new OrangeCatError("OrangeCat returned no payable invoice.", 502);
            }
            const invoice = data.qr_data;
            const expiresIn = typeof data.expires_in_seconds === "number" ? data.expires_in_seconds : null;
            const expiresAt = typeof intent.expires_at === "string"
                ? intent.expires_at
                : expiresIn !== null
                    ? new Date(now().getTime() + expiresIn * 1000).toISOString()
                    : null;
            return {
                provider: ORANGECAT_PROVIDER_ID,
                id: intent.id,
                reference,
                planId: plan.id,
                amount: plan.price,
                invoice,
                // A `bitcoin:` URI opens a wallet as it is; a bare invoice needs the scheme.
                payUrl: /^bitcoin:/i.test(invoice) ? invoice : `lightning:${invoice}`,
                expiresAt,
                // A keyed payment is read with the key; an account-less one with its token.
                ...(token ? { handle: token } : {}),
            };
        },
        async status(checkout) {
            const path = `/api/v1/payments${checkout.handle ? "/public" : ""}/${encodeURIComponent(checkout.id)}`;
            if (!checkout.handle && !config.apiKey) {
                throw new OrangeCatError("An OrangeCat checkout is read with its handle, or with the key that created it.", 0);
            }
            const data = await call(path, {
                method: "GET",
                headers: checkout.handle ? { "x-payment-token": checkout.handle } : { [KEY_HEADER]: config.apiKey },
            });
            return { state: toState(data.status), paidAt: typeof data.paid_at === "string" ? data.paid_at : null };
        },
        verifyWebhook(rawBody, headers) {
            if (!config.webhookSecret)
                return { ok: false, reason: "no_webhook_secret" };
            const verdict = verifyOrangeCatSignature(rawBody, config.webhookSecret, readHeader(headers, SIGNATURE_HEADER), { now: now() });
            if (!verdict.valid)
                return { ok: false, reason: verdict.reason };
            let payload;
            try {
                payload = JSON.parse(rawBody);
            }
            catch {
                return { ok: false, reason: "malformed_body" };
            }
            // Authentic, and about something else (`product.created`, …): acknowledged, nothing to do.
            if (!isRecord(payload) || payload.type !== ORANGECAT_SETTLED_EVENT)
                return { ok: true, event: null };
            if (typeof payload.externalId !== "string" || !payload.externalId)
                return { ok: false, reason: "malformed_body" };
            const btc = typeof payload.amountBtc === "string" ? Number(payload.amountBtc) : NaN;
            return {
                ok: true,
                event: {
                    provider: ORANGECAT_PROVIDER_ID,
                    externalId: payload.externalId,
                    amount: Number.isFinite(btc) && btc > 0 ? { amount: Math.round(btc * SATS_PER_BTC), currency: "SAT" } : null,
                    providerRef: typeof payload.entityId === "string" ? payload.entityId : null,
                    eventId: readHeader(headers, "x-orangecat-event-id"),
                },
            };
        },
    };
}
