# paykit

Let a website get paid. The website does not hold the money.

```bash
pnpm add paykit
```

Part of [bitbaum](https://bitbaum.orangecat.ch/packages/paykit/). The same behavior ships in [OrangeCat](https://orangecat.ch) today.

## Why this exists

A shop, a clinic, or a fundraiser should be able to take a payment without building a wallet, a balance, or a support desk for missing coins. You store where the money should land. The payer uses their own app.

## Use

```ts
import { classifyPaste, shownRail } from 'paykit';

classifyPaste('bitcoin:bc1q…'); // 'onchain'
classifyPaste('you@coinos.io'); // 'lightning'
classifyPaste('nostr+walletconnect://…'); // 'nwc'

// A code to show. Twint, Monero, anything else. Their app pays it.
shownRail('Twint', qrPayload);
```

`classifyPaste` reads the shape of a Bitcoin receive string after stripping the `bitcoin:` wrapper a wallet copies. It does not check the checksum. A host that moves money still validates before it saves.

A **settled** rail (Lightning address, Bitcoin address, xpub, wallet-connect) is one the host can ask for a payment. A **shown** rail is only displayed. paykit does not store keys and does not keep a balance.

## Licence

MIT
