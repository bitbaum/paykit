import { normalizePastedHandle } from './normalize.js';
import type { PasteKind, Rail } from './types.js';

const LIGHTNING_ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const XPUB = /^(xpub|ypub|zpub|tpub|upub|vpub)[1-9A-HJ-NP-Za-km-z]{20,}$/;
const BECH32 = /^(bc1|tb1|bcrt1)[02-9ac-hj-np-z]{11,}$/;
const LEGACY = /^[13][1-9A-HJ-NP-Za-km-z]{24,33}$/;

/**
 * What kind of Bitcoin receive string this paste is.
 * Shape only: a checksum can still fail later in the host.
 */
export function classifyPaste(raw: string): PasteKind {
  const v = normalizePastedHandle(raw);
  if (!v) {
    return 'unknown';
  }
  if (v.toLowerCase().startsWith('nostr+walletconnect://')) {
    return 'nwc';
  }
  if (LIGHTNING_ADDRESS.test(v)) {
    return 'lightning';
  }
  if (XPUB.test(v)) {
    return 'xpub';
  }
  if (BECH32.test(v) || LEGACY.test(v)) {
    return 'onchain';
  }
  return 'unknown';
}

/** A Bitcoin paste the host can ask for a payment against. Unknown pastes return null. */
export function settledRail(raw: string): Extract<Rail, { mode: 'settled' }> | null {
  const kind = classifyPaste(raw);
  if (kind === 'unknown') {
    return null;
  }
  return { mode: 'settled', kind, value: normalizePastedHandle(raw) };
}

/**
 * A code to show, not to settle. Twint, Monero, or anything else the visitor
 * pays in their own app. The website stores the string and nothing else.
 */
export function shownRail(network: string, value: string): Extract<Rail, { mode: 'shown' }> {
  const name = network.trim();
  const code = value.trim();
  if (!name || !code) {
    throw new Error('A shown payment code needs a name and a value.');
  }
  return { mode: 'shown', network: name, value: code };
}
