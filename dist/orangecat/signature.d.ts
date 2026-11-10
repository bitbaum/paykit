/**
 * OrangeCat's webhook signature.
 *
 *   X-OrangeCat-Signature: t=<unix seconds>,v1=<hex>
 *   v1 = HMAC-SHA-256(endpoint secret, `${t}.${rawBody}`)
 *
 * The timestamp is signed, so a captured delivery cannot be replayed outside
 * the tolerance. This follows `src/services/webhooks/signing.ts` in
 * bitbaum/orangecat; its own SDK carries the same check but is not published.
 */
export declare const SIGNATURE_HEADER = "x-orangecat-signature";
export declare const DEFAULT_TOLERANCE_SECONDS = 300;
export type SignatureFailure = "malformed_header" | "unknown_scheme" | "timestamp_outside_tolerance" | "signature_mismatch";
export type SignatureResult = {
    valid: true;
} | {
    valid: false;
    reason: SignatureFailure;
};
export declare function signOrangeCatPayload(rawBody: string, secret: string, now?: Date): string;
export declare function verifyOrangeCatSignature(rawBody: string, secret: string, header: string | null | undefined, opts?: {
    toleranceSeconds?: number;
    now?: Date;
}): SignatureResult;
