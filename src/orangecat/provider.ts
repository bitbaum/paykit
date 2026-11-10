import { readHeader } from "../checkout/types.js";
import type {
  Checkout,
  CheckoutInput,
  CheckoutState,
  CheckoutStatus,
  HeaderBag,
  Payee,
  PaymentProvider,
  WebhookResult,
} from "../checkout/types.js";
import { SIGNATURE_HEADER, verifyOrangeCatSignature } from "./signature.js";

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

export const ORANGECAT_PROVIDER_ID = "orangecat";
export const ORANGECAT_SETTLED_EVENT = "payment.settled";
const SATS_PER_BTC = 100_000_000;
const KEY_HEADER = "x-orangecat-key";
/** OrangeCat's sentence for a key whose owner is the payee. */
const OWN_ENTITY = /your own entity/i;

export class OrangeCatError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "OrangeCatError";
  }
}

/** OrangeCat's own states; anything not final is still waiting for money or for the seller. */
function toState(status: unknown): CheckoutState {
  if (status === "paid") return "paid";
  if (status === "expired") return "expired";
  if (status === "failed") return "failed";
  return "pending";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function orangeCatProvider(config: OrangeCatConfig = {}): PaymentProvider {
  const baseUrl = (config.baseUrl ?? "https://orangecat.ch").replace(/\/+$/, "");
  const entityType = config.entityType ?? "product";
  const doFetch = config.fetch ?? fetch;
  const now = config.now ?? (() => new Date());
  const timeoutMs = config.timeoutMs ?? 15_000;

  /** Every v1 answer is `{ success, data }`; an error carries a message that is safe to show. */
  async function call(path: string, init: RequestInit): Promise<Record<string, unknown>> {
    const response = await doFetch(`${baseUrl}${path}`, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    const body: unknown = await response.json().catch(() => null);
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
    async payee(providerRef: string): Promise<Payee> {
      const data = await call(`/api/v1/${entityType}s/${encodeURIComponent(providerRef)}`, { method: "GET" });
      const entity = isRecord(data[entityType]) ? (data[entityType] as Record<string, unknown>) : data;
      const has = (key: string) => typeof entity[key] === "string" && (entity[key] as string).trim() !== "";
      return {
        name: typeof entity.title === "string" ? entity.title : null,
        url: `${baseUrl}/${entityType}s/${encodeURIComponent(providerRef)}`,
        payable: has("bitcoin_address") || has("lightning_address") ? true : null,
      };
    },

    async createCheckout({ plan, reference }: CheckoutInput): Promise<Checkout> {
      if (plan.price.currency !== "SAT" || !Number.isInteger(plan.price.amount) || plan.price.amount <= 0) {
        throw new OrangeCatError("An OrangeCat plan is priced in whole SAT.", 0);
      }
      const body = JSON.stringify({
        entity_type: entityType,
        entity_id: plan.providerRef,
        amount_btc: Number((plan.price.amount / SATS_PER_BTC).toFixed(8)),
      });
      const accountless = () =>
        call("/api/v1/payments/public", { method: "POST", headers: { "content-type": "application/json" }, body });

      let data: Record<string, unknown>;
      let keyed = false;
      if (config.apiKey) {
        try {
          data = await call("/api/v1/payments", {
            method: "POST",
            headers: { "content-type": "application/json", [KEY_HEADER]: config.apiKey },
            body,
          });
          keyed = true;
        } catch (error) {
          // The key belongs to the account being paid: OrangeCat will not let
          // an owner buy from themselves. The customer still has to be able
          // to pay, so the invoice is asked for without the key.
          if (!(error instanceof OrangeCatError) || !OWN_ENTITY.test(error.message)) throw error;
          data = await accountless();
        }
      } else {
        data = await accountless();
      }
      const intent = data.payment_intent;
      const token = typeof data.status_token === "string" ? data.status_token : null;
      if (!isRecord(intent) || typeof intent.id !== "string" || typeof data.qr_data !== "string" || (!keyed && !token)) {
        throw new OrangeCatError("OrangeCat returned no payable invoice.", 502);
      }
      const invoice = data.qr_data;
      const expiresIn = typeof data.expires_in_seconds === "number" ? data.expires_in_seconds : null;
      const expiresAt =
        typeof intent.expires_at === "string"
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

    async status(checkout): Promise<CheckoutStatus> {
      const path = `/api/v1/payments${checkout.handle ? "/public" : ""}/${encodeURIComponent(checkout.id)}`;
      if (!checkout.handle && !config.apiKey) {
        throw new OrangeCatError("An OrangeCat checkout is read with its handle, or with the key that created it.", 0);
      }
      const data = await call(path, {
        method: "GET",
        headers: checkout.handle ? { "x-payment-token": checkout.handle } : { [KEY_HEADER]: config.apiKey as string },
      });
      return { state: toState(data.status), paidAt: typeof data.paid_at === "string" ? data.paid_at : null };
    },

    verifyWebhook(rawBody: string, headers: HeaderBag): WebhookResult {
      if (!config.webhookSecret) return { ok: false, reason: "no_webhook_secret" };
      const verdict = verifyOrangeCatSignature(rawBody, config.webhookSecret, readHeader(headers, SIGNATURE_HEADER), { now: now() });
      if (!verdict.valid) return { ok: false, reason: verdict.reason };

      let payload: unknown;
      try {
        payload = JSON.parse(rawBody);
      } catch {
        return { ok: false, reason: "malformed_body" };
      }
      // Authentic, and about something else (`product.created`, …): acknowledged, nothing to do.
      if (!isRecord(payload) || payload.type !== ORANGECAT_SETTLED_EVENT) return { ok: true, event: null };
      if (typeof payload.externalId !== "string" || !payload.externalId) return { ok: false, reason: "malformed_body" };

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
