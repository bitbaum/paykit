# Changelog

This retrospective record was added on 2026-10-27 from the immutable sources
linked below. Git commit dates are source dates, not inferred npm publication
dates. A GitHub release does not itself establish npm publication.
Application adoption and deployment evidence are tracked separately.

## 0.2.0

- `@bitbaum/paykit/checkout`: a provider-neutral `PaymentProvider` (create a checkout for a plan, read its status, authenticate the provider's settlement call), time-boxed entitlement helpers and `applySettlement`, idempotent on the payment's id.
- `@bitbaum/paykit/orangecat`: the first provider, Bitcoin through an OrangeCat account, with its webhook signature check.

## 0.1.1

- [Tagged source `v0.1.1`](https://github.com/bitbaum/paykit/tree/d3038e303e6fe9e97a171131c7001637d104fd77)
- [Source commit](https://github.com/bitbaum/paykit/commit/d3038e303e6fe9e97a171131c7001637d104fd77), dated 2026-10-26.
- [GitHub release](https://github.com/bitbaum/paykit/releases/tag/v0.1.1), published 2026-10-26.

### Recorded release notes

#### What's Changed
* ci(publish): tag-driven npm Trusted Publishing by @catomean in https://github.com/bitbaum/paykit/pull/1
* Handle malformed payment URI escapes safely by @catomean in https://github.com/bitbaum/paykit/pull/3
* build: ship verified Git releases without install scripts by @catomean in https://github.com/bitbaum/paykit/pull/4

#### New Contributors
* @catomean made their first contribution in https://github.com/bitbaum/paykit/pull/1

**Full Changelog**: https://github.com/bitbaum/paykit/commits/v0.1.1
