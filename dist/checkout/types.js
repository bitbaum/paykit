/**
 * Taking a payment for a plan, whoever moves the money.
 *
 * An app describes what it sells (a `Plan`) and who is buying (its own
 * `reference`). A provider turns that into something the buyer can pay, says
 * whether it has been paid, and authenticates the provider's own "it settled"
 * call. Nothing here names a provider: the same three calls fit a Lightning
 * invoice and a hosted card checkout.
 */
/** One header, whatever shape the framework hands them over in. */
export function readHeader(headers, name) {
    if (typeof headers.get === "function")
        return headers.get(name);
    const wanted = name.toLowerCase();
    for (const [key, value] of Object.entries(headers)) {
        if (key.toLowerCase() !== wanted)
            continue;
        return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
    }
    return null;
}
