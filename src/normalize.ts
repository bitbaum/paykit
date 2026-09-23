function readQuery(query: string, key: string): string {
  for (const part of query.split('&')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (decodeURIComponent(part.slice(0, eq)) !== key) continue;
    return decodeURIComponent(part.slice(eq + 1)).trim();
  }
  return '';
}

/** Schemes a wallet may wrap a handle in. A wallet-connect URI is the handle itself. */
const SCHEME = /^(bitcoin|lightning|lnurlp|lnurl):(\/\/)?/i;

/** A bech32 address in one case. Mixed case is left alone. */
const ALL_UPPER_BECH32 = /^(BC1|TB1|BCRT1)[0-9A-Z]+$/;

/**
 * Strip what a wallet app wraps around a receive string.
 * `bitcoin:bc1q…`, a QR in uppercase, and `bitcoin:?lightning=lnbc…` become the handle.
 * Anything unrecognised is only trimmed.
 */
export function normalizePastedHandle(raw: string): string {
  const input = (raw ?? '').trim();
  if (!input) {
    return '';
  }
  if (input.toLowerCase().startsWith('nostr+walletconnect://')) {
    return input;
  }

  const scheme = input.match(SCHEME);
  let body = scheme ? input.slice(scheme[0].length) : input;

  if (scheme) {
    const q = body.indexOf('?');
    if (q !== -1) {
      const address = body.slice(0, q).trim();
      const lightning = readQuery(body.slice(q + 1), 'lightning');
      body = address || lightning;
    }
  }

  body = body.trim();
  if (ALL_UPPER_BECH32.test(body)) {
    return body.toLowerCase();
  }
  return body;
}
