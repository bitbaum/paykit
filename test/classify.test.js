import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyPaste, normalizePastedHandle, shownRail, settledRail } from '../dist/index.js';

test('strips a bitcoin: URI and an uppercase QR', () => {
  assert.equal(
    normalizePastedHandle('bitcoin:BC1QW508D6NNEC4J4K7G0Q2K0Q2K0Q2K0Q2K0Q2K'),
    'bc1qw508d6nnec4j4k7g0q2k0q2k0q2k0q2k0q2k',
  );
  assert.equal(classifyPaste('bitcoin:bc1qw508d6nnec4j4k7g0q2k0q2'), 'onchain');
});

test('classifies the four Bitcoin pastes', () => {
  assert.equal(classifyPaste('you@coinos.io'), 'lightning');
  assert.equal(classifyPaste('1BoatSLRHtKNngkdXEeobR76b53LETtpyT'), 'onchain');
  assert.equal(
    classifyPaste('xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8'),
    'xpub',
  );
  assert.equal(classifyPaste('nostr+walletconnect://abc'), 'nwc');
  assert.equal(classifyPaste('hello'), 'unknown');
});

test('a shown code is not a settled rail', () => {
  const twint = shownRail('Twint', 'twint-qr-payload');
  assert.equal(twint.mode, 'shown');
  assert.equal(twint.network, 'Twint');
  const settled = settledRail('you@coinos.io');
  assert.equal(settled?.mode, 'settled');
  assert.equal(settled?.kind, 'lightning');
  assert.equal(settledRail('not a wallet'), null);
});
