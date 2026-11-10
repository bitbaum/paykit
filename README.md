# paykit

Let a website get paid. The website does not hold the money.

```bash
pnpm add @bitbaum/paykit
```

Part of [bitbaum](https://bitbaum.orangecat.ch/packages/paykit/). The same behavior ships in [OrangeCat](https://orangecat.ch) today.

## Why this exists

A shop, a clinic, or a fundraiser should be able to take a payment without building a wallet, a balance, or a support desk for missing coins. You store where the money should land. The payer uses their own app.

## Use

```ts
import { classifyPaste, shownRail } from '@bitbaum/paykit';

classifyPaste('bitcoin:bc1q…'); // 'onchain'
classifyPaste('you@coinos.io'); // 'lightning'
classifyPaste('nostr+walletconnect://…'); // 'nwc'

// A code to show. Twint, Monero, anything else. Their app pays it.
shownRail('Twint', qrPayload);
```

`classifyPaste` reads the shape of a Bitcoin receive string after stripping the `bitcoin:` wrapper a wallet copies. It does not check the checksum. A host that moves money still validates before it saves.

A **settled** rail (Lightning address, Bitcoin address, xpub, wallet-connect) is one the host can ask for a payment. A **shown** rail is only displayed. paykit does not store keys and does not keep a balance.

## Sell a pass

Bitcoin has no recurring charge, so what an app sells is a pass: one payment, a number of days. Paying again before it runs out adds the days to the end.

```ts
import { applySettlement, isActive, type Plan } from '@bitbaum/paykit/checkout';
import { orangeCatProvider } from '@bitbaum/paykit/orangecat';

const month: Plan = { id: 'month', days: 30, price: { amount: 21000, currency: 'SAT' }, providerRef: productId };
const provider = orangeCatProvider({ webhookSecret: process.env.ORANGECAT_WEBHOOK_SECRET });

// 1. Something the buyer can pay. Store it: it is the only link back to the buyer.
const checkout = await provider.createCheckout({ plan: month, reference: user.id });
//    checkout.invoice is the QR code, checkout.payUrl opens a wallet.

// 2. The provider says it settled (webhook), or the app asks (poll). Both end here.
const verdict = provider.verifyWebhook(rawBody, request.headers);
if (verdict.ok && verdict.event) await applySettlement({ event: verdict.event, plans: [month], store });
const { state } = await provider.status(checkout);

// 3. Gate on the pass.
isActive(entitlement);
```

`PaymentProvider` is three calls (`createCheckout`, `status`, `verifyWebhook`) and names no provider. `applySettlement` grants once per payment however often it is reported, and takes what was bought, by whom and for how much from the checkout the app stored, not from the event. The app supplies the `store`; `settleOnce` must be one transaction.

### Bitcoin through an OrangeCat account

The seller publishes a product on [OrangeCat](https://orangecat.ch) and connects a wallet there. The provider asks OrangeCat for an invoice that pays that product (`POST /api/v1/payments/public`), so the money goes from the buyer's wallet to the seller's. It needs no API key.

- `entityType` says what is being paid (`product` by default, `project` for an app's own OrangeCat project). `provider.payee(id)` reads that entity from OrangeCat: its name and its page (`https://orangecat.ch/projects/<id>`). Its `payable` is `true` when the entity shows an address of its own and `null` otherwise, never `false`: the owner's connected wallet is not on the public record, so only `createCheckout` knows.
- The id of what is paid is the app's configuration, never a constant in this package or in a component. Each app keeps its own OrangeCat project id in its config and passes it as the plan's `providerRef`:

  ```ts
  // In the app's config layer, from its environment.
  const projectId = process.env.ORANGECAT_PAY_ENTITY_ID; // Heidi's, Loki's and Solon's each differ
  const provider = orangeCatProvider({ entityType: 'project', webhookSecret: process.env.ORANGECAT_WEBHOOK_SECRET });
  const month: Plan = { id: 'month', days: 30, price: { amount: sats, currency: 'SAT' }, providerRef: projectId };
  ```
- The plan is priced in whole `SAT`. The caller states the amount; `applySettlement` checks what arrived.
- A `payment.settled` webhook names only the payment, never the buyer. Without the stored checkout a settlement cannot be matched.
- The webhook is authenticated with `X-OrangeCat-Signature` (`t=<unix>,v1=<HMAC-SHA-256 of "${t}.${rawBody}">`, five minutes' tolerance). Pass the body exactly as received.
- `@bitbaum/paykit/orangecat` uses `node:crypto` and belongs on the server. `@bitbaum/paykit/checkout` and the root entry run anywhere.

## Licence

MIT
