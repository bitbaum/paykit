import { createHmac, timingSafeEqual } from "node:crypto";
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
export const SIGNATURE_HEADER = "x-orangecat-signature";
export const DEFAULT_TOLERANCE_SECONDS = 300;
function parse(header) {
    let timestamp = null;
    const signatures = [];
    for (const part of header.split(",")) {
        const eq = part.indexOf("=");
        if (eq < 1)
            continue;
        const key = part.slice(0, eq).trim();
        const value = part.slice(eq + 1).trim();
        if (!key || !value)
            continue;
        if (key === "t") {
            if (!/^\d+$/.test(value))
                return null;
            const seconds = Number(value);
            if (!Number.isSafeInteger(seconds) || seconds <= 0)
                return null;
            timestamp = seconds;
        }
        else if (key === "v1") {
            signatures.push(value);
        }
    }
    return timestamp === null ? null : { timestamp, signatures };
}
function sameHex(a, b) {
    if (a.length !== b.length || !/^[0-9a-f]+$/i.test(a))
        return false;
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}
export function signOrangeCatPayload(rawBody, secret, now = new Date()) {
    const t = Math.floor(now.getTime() / 1000);
    return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex")}`;
}
export function verifyOrangeCatSignature(rawBody, secret, header, opts = {}) {
    if (!header)
        return { valid: false, reason: "malformed_header" };
    const parsed = parse(header);
    if (!parsed)
        return { valid: false, reason: "malformed_header" };
    if (!parsed.signatures.length)
        return { valid: false, reason: "unknown_scheme" };
    const tolerance = opts.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
    const nowSeconds = Math.floor((opts.now ?? new Date()).getTime() / 1000);
    if (Math.abs(nowSeconds - parsed.timestamp) > tolerance) {
        return { valid: false, reason: "timestamp_outside_tolerance" };
    }
    const expected = createHmac("sha256", secret).update(`${parsed.timestamp}.${rawBody}`).digest("hex");
    return parsed.signatures.some((candidate) => sameHex(candidate, expected))
        ? { valid: true }
        : { valid: false, reason: "signature_mismatch" };
}
