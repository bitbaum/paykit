import { readHeader } from "../checkout/types.js";
import type {
  Checkout,
  CheckoutInput,
  CheckoutState,
  CheckoutStatus,
  HeaderBag,
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

export const ORANGECAT_PROVIDER_ID = "orangecat";
export const ORANGECAT_SETTLED_EVENT = "payment.settled";
const SATS_PER_BTC = 100_000_000;

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

    async createCheckout({ plan, reference }: CheckoutInput): Promise<Checkout> {
      if (plan.price.currency !== "SAT" || !Number.isInteger(plan.price.amount) || plan.price.amount <= 0) {
        throw new OrangeCatError("An OrangeCat plan is priced in whole SAT.", 0);
      }
      const data = await call("/api/v1/payments/public", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          entity_type: entityType,
          entity_id: plan.providerRef,
          amount_btc: Number((plan.price.amount / SATS_PER_BTC).toFixed(8)),
        }),
      });
      const intent = data.payment_intent;
      if (!isRecord(intent) || typeof intent.id !== "string" || typeof data.status_token !== "string" || typeof data.qr_data !== "string") {
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
        handle: data.status_token,
      };
    },

    async status(checkout): Promise<CheckoutStatus> {
      if (!checkout.handle) throw new OrangeCatError("An OrangeCat checkout is read with its handle.", 0);
      const data = await call(`/api/v1/payments/public/${encodeURIComponent(checkout.id)}`, {
        method: "GET",
        headers: { "x-payment-token": checkout.handle },
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
