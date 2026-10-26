import type { PasteKind, Rail } from './types.js';
/**
 * What kind of Bitcoin receive string this paste is.
 * Shape only: a checksum can still fail later in the host.
 */
export declare function classifyPaste(raw: string): PasteKind;
/** A Bitcoin paste the host can ask for a payment against. Unknown pastes return null. */
export declare function settledRail(raw: string): Extract<Rail, {
    mode: 'settled';
}> | null;
/**
 * A code to show, not to settle. Twint, Monero, or anything else the visitor
 * pays in their own app. The website stores the string and nothing else.
 */
export declare function shownRail(network: string, value: string): Extract<Rail, {
    mode: 'shown';
}>;
