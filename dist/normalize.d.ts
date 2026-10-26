/**
 * Strip what a wallet app wraps around a receive string.
 * `bitcoin:bc1q…`, a QR in uppercase, and `bitcoin:?lightning=lnbc…` become the handle.
 * Anything unrecognised is only trimmed.
 */
export declare function normalizePastedHandle(raw: string): string;
