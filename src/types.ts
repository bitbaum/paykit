/** What a pasted Bitcoin receive string looks like. Not a checksum verdict. */
export type PasteKind = 'onchain' | 'xpub' | 'lightning' | 'nwc' | 'unknown';

/**
 * Settled: the host can ask this rail for a payment.
 * Shown: display the code. The visitor pays in their own app. The website does not.
 */
export type Rail =
  | { mode: 'settled'; kind: Exclude<PasteKind, 'unknown'>; value: string }
  | { mode: 'shown'; network: string; value: string };
