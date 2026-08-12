# Cosign - Roadmap

Single source of truth for what we are shipping and where we are in the
plan. Phases 0-4 take the @xbot02 facilitator to production on BOT Chain -
protocol conformance, security hardening, settlement, parity, and
ecosystem. When you ship something, tick it off here.

**Legend:** `- [ ]` = not started · `- [x]` = shipped. A phase is done when
every item under it is checked.

Modeled on the production x402 facilitators (the production bar) and the
canonical `x402-foundation/x402` v2 spec. Target: a hardened,
protocol-conformant, production-ready x402 facilitator for **BOT Chain**
(testnet `eip155:968` / mainnet `eip155:677`), keeping the consent layer
(AgentRegistry + ConsentGateway) as our differentiator.

## Reference material

- **Vendored spec (source of truth, in-repo):** [`docs/facilitator/x402/`](docs/facilitator/x402/x402-specification-v2.md)
  - [`x402-specification-v2.md`](docs/facilitator/x402/x402-specification-v2.md) - core protocol (types, schemes, flows,
    facilitator interface, error codes)
  - [`transports-v2/http.md`](docs/facilitator/x402/transports-v2/http.md) - HTTP 402 / `PAYMENT-REQUIRED` / `PAYMENT-SIGNATURE`
    / `PAYMENT-RESPONSE` headers
  - [`schemes/`](docs/facilitator/x402/schemes/README.md) - `exact`, the only enabled scheme, with its BOT Chain binding
  - [`extensions/`](docs/facilitator/x402/extensions/README.md) - bazaar, payment-identifier, offer-and-receipt,
    http-message-signatures, auth-hints, sign-in-with-x, builder-code

## Decisions (confirmed)

- **Phase 2 settlement:** self-pay only for now. The native-paymaster bundler stays
  a stub; zero-gas `/settle` must refuse explicitly, never stall silently.
- **Persistence:** deferred ("we will get there"). Recommended approach when we get
  there: single-file SQLite settlement ledger. Until then replay protection is
  in-memory + chain-log based and is documented as partial.
- **Consent layer is optional, not a facilitator hard-requirement.** The consent
  flow (`AgentRegistry` + `ConsentGateway` + guardian/console) is how a user
  *chooses* to configure and run the facilitator with human oversight; a
  facilitator does not need it to function as an x402 facilitator. When a user
  configures it (sets `CONSENT_GATEWAY_ADDRESS`, uses the guardian package), the
  sponsor policy gates on `ConsentGateway.isApproved`. When not configured, the
  facilitator still works as a plain x402 facilitator. This affects Phase 0 (boot
  must not hard-fail without consent config) and Phase 1 (consent checks apply
  only when configured - but then must apply to *every* settlement path).
- **Schemes (only [`exact`](docs/facilitator/x402/schemes/exact/scheme_exact.md)):** the other schemes defined by the x402 protocol -
  [`upto`](https://github.com/x402-foundation/x402/blob/main/specs/schemes/upto/scheme_upto.md),
  [`auth-capture`](https://github.com/x402-foundation/x402/blob/main/specs/schemes/auth-capture/scheme_auth_capture.md),
  and [`batch-settlement`](https://github.com/x402-foundation/x402/blob/main/specs/schemes/batch-settlement/scheme_batch_settlement.md)
  - were reviewed and deliberately **not** implemented. Each conflicts with
  Cosign's core thesis that no party holds funds: `upto` needs a surplus/refund
  window, `auth-capture` locks funds in escrow until capture, and
  `batch-settlement` (capital-backed) uses on-chain channel deposits.
  `GET /supported` advertises `exact` only, and the facilitator rejects any other
  scheme with `invalid_scheme`. If the upstream protocol later defines a scheme
  compatible with this thesis, it will be evaluated and added.
- **Phase 4:** full ecosystem parity (discovery, analytics, facilitator MCP,
  framework middlewares, paywall), built after Phases 0-3.

---

## Phase 0 - Protocol conformance (correct x402 v2 facilitator)

Files: [`facilitator/src/server.ts`](facilitator/src/server.ts), [`x402-adapter.ts`](facilitator/src/x402-adapter.ts),
[`paymaster.ts`](facilitator/src/paymaster.ts), [`sdk/packages/core/src/x402.ts`](facilitator/sdk/packages/core/src/x402.ts),
[`examples/resource-server/src/routes/hubot-task.ts`](examples/resource-server/src/routes/hubot-task.ts) ·
[`market-report.ts`](examples/resource-server/src/routes/market-report.ts) ·
[`x402.ts`](examples/resource-server/src/routes/x402.ts)

- [x] **v2 envelope everywhere.** Accept `paymentRequirements` as the request field
  name; keep a back-compat alias for `paymentDetails`. The request body is
  `{ x402Version: 2, paymentPayload, paymentRequirements }`. The
  `PaymentRequired` (402) object is `{ x402Version, error?, resource, accepts[],
  extensions? }` where `resource` is the **ResourceInfo object** (`url`,
  `description?`, `mimeType?`, `serviceName?`, `tags?`, `iconUrl?`) and
  `accepts[]` holds `PaymentRequirements`:
  `{ scheme, network, amount, asset, payTo, maxTimeoutSeconds, extra? }`
  (note: `maxTimeoutSeconds` is **required** in v2).
  *Partial:* we don't emit the optional `extensions` field yet - absent = none.
- [x] **Spec-shaped responses** (drop the JSON-RPC envelope on x402 paths):
  - `/verify` → `{ isValid, invalidReason?, payer?, extra? }`
  - `/settle` → `{ success, errorReason?, payer?, transaction, network,
    amount?, extensions? }` (`transaction` = `""` on failure)
  - HTTP status: 400 malformed body, 402 payment failed, 500 system error;
    JSON-RPC envelope on the paymaster `POST /` and `GET /supported`; bare
    bodies on `/verify` + `/settle`.
  *Done:* [`x402-adapter.ts`](facilitator/src/x402-adapter.ts) maps results to the spec field names
  (`isValid`/`invalidReason`/`payer`/`extra`, `success`/`errorReason`/
  `payer`/`transaction`/`network`/`amount`), the paymaster `handleX402`
  returns those bodies directly with the proper HTTP statuses, and
  `@xbot02/fetch` (`withBOT02`) consumes the spec shapes (`isValid`/
  `invalidReason`, `success`/`errorReason`) with retry-on-serve-failure.
  `@xbot02/guardian` and `@xbot02/mcp` also consume the new shapes
  (guardian zero-gas probe + `pay_uri`). (The earlier MCP test failure was a
  stale `@xbot02/fetch` dist build - the SDK rebuild fixed it; the mcp suite
  passes 16/16.)
- [x] **`GET /supported`** → `{ result: { kinds, extensions, signers } }`
  (still behind the JSON-RPC envelope - see "Spec-shaped responses" above):
  - `kinds`: `[{ x402Version: 2, scheme: "exact", network: <active network> }]` -
    one entry per enabled kind, for the **active** network only
    (`eip155:968` testnet or `eip155:677` mainnet, per `BOT_NETWORK`).
  - `extensions`: `[]` today - none of the Phase 1/4 extensions are implemented yet.
  - `signers`: `{ "<active network>": [sponsorPublicAddress] }` so clients know
    who sponsors/co-signs.
- [x] **Declare `extra.assetTransferMethod` + `extra.paymentFlow`.** BOT Chain's
  exact mechanism uses a native value transfer via the EOA paymaster /
  self-pay; advertise an `assetTransferMethod` (e.g. `"native"`) and the
  default `authorization` flow (`verify → resource → settle → respond`).
  Reject any `accepts[]` whose `paymentFlow` we don't recognize, and prefer
  `authorization` when a server offers multiple flows.
  *Also shipped:* `extra.requireConsent` - the resource server advertises
  whether serving needs an on-chain `ConsentGateway` approval, and the agent
  honors it (pure x402 `/market-report` = `false`, consent-gated `/hubot-task`
  = `true`). Absent = `true` (safe default).
- [x] **Wire format on the resource-server side.** `hubot-task.ts` used to emit a
  v1-ish shape (`resource: "/hubot-task"` string + `accepted[]`). Conform: emit
  the full v2 `PaymentRequired` (ResourceInfo object + `accepts[]`), read the
  payment payload from `PAYMENT-SIGNATURE` (`{ payment: { rawTx, feeRawTx? } }`),
  and forward `{ x402Version, paymentRequirements, paymentPayload }` to the
  facilitator. *Done via a shared [`routes/x402.ts`](examples/resource-server/src/routes/x402.ts) factory*
  (both endpoints now speak v2; `extensions` still not emitted).
- [x] Enforce `maxTimeoutSeconds` on verify/settle; validate payment-tx chain id
  (not just the fee tx). Map failures to the v2 error codes in section 9
  (`invalid_x402_version`, `invalid_payment_requirements`, `invalid_payload`,
  `invalid_scheme`, `invalid_network`, `invalid_transaction_state`,
  `insufficient_funds`, `unexpected_verify_error`, `unexpected_settle_error`).
- [x] **Consent-optional boot (per Decisions).** `consentGatewayAddress()` no
  longer throws when `CONSENT_GATEWAY_ADDRESS_<NETWORK>` is unset - it returns
  `undefined`, so [`server.ts`](facilitator/src/server.ts) boots as a plain x402 facilitator: the sponsor
  policy passes its `isApproved` gate unconditionally when no consent is
  configured, and applies the gate when the address is set.
  `AGENT_REGISTRY_ADDRESS` wiring (policy caps) stays in Phase 1.

## Phase 1 - Security hardening (critical)

Files: [`facilitator/src/selfpay-fallback.ts`](facilitator/src/selfpay-fallback.ts), [`policy.ts`](facilitator/src/policy.ts), [`paymaster.ts`](facilitator/src/paymaster.ts), new `ledger.ts`

- [ ] **Settlement ledger** - dedup/replay protection. Records payload hash,
  tx hash, requestId, payer, status. `/settle` must **re-verify** and reject
  anything already settled (double-spend). *Pending decision:* SQLite
  (recommended) vs in-memory (partial, lost on restart) vs Redis.
  Implement the
  [`payment-identifier`](docs/facilitator/x402/extensions/payment_identifier.md)
  extension: clients attach an `id` used as the idempotency key, echoed in
  `/settle` responses.
- [ ] **Consent on every path (when configured)** - when `CONSENT_GATEWAY_ADDRESS`
  is set, carry the consent `requestId` through payment requirements and
  enforce `ConsentGateway.isApproved` on the self-pay path too. Today the
  self-pay fallback performs no consent check, so a self-pay payer can bypass
  a *configured* circuit breaker. Not a gap when the facilitator is run
  without the consent layer (see Decisions).
- [ ] **Rate limiting per payer** (token bucket, in-memory) on `/verify` and
  `/settle`. Advertise the
  [`http-message-signatures`](docs/facilitator/x402/extensions/http-message-signatures.md)
  extension so a paying agent can be identified (RFC 9421) for rate limiting
  and attribution.
- [ ] **Input hardening** - request-size caps, calldata policy (reject non-empty
  `data` unless `to` is ConsentGateway / paymaster).
- [ ] **Sponsor-wallet nonce management** + retry/backoff for future bundler use.

## Phase 2 - Settlement (self-pay only, per decision)

Files: [`facilitator/src/bundler.ts`](facilitator/src/bundler.ts), [`x402-adapter.ts`](facilitator/src/x402-adapter.ts)

- [ ] Self-pay remains the shipping settlement path (already the default).
- [ ] Zero-gas `/settle` and `eth_sendRawTransaction` must return an explicit
  "sponsorship unavailable" error - no silent stall - until bundle infra is
  confirmed on BOT Chain testnet.
- [ ] If bundle infra is ever verified live, implement the real bundler: parse user
  tx, build sponsor tx (`to`=user `to`, `value`=user value, gas=user gas+margin,
  nonzero gasPrice, legacy EIP-155), submit bundle to builder RPC, return user tx
  hash, with policy re-check + nonce mgmt + failure retry.

## Phase 3 - Observability & ops (production bar: rate limits, balance monitoring, alert thresholds)

Files: `facilitator/src/health.ts` (new), `metrics.ts` (new), [`server.ts`](facilitator/src/server.ts), Dockerfile

- [ ] `GET /health` - status, version, timestamp, per-network up/down/latency, uptime.
- [ ] Metrics - Prometheus (or lightweight JSON): verify/settle counters, latency,
  failure rates, sponsor-wallet balance per network.
- [ ] Structured request logging; alert thresholds (low balance, >5% verify failure,
  >2% settle failure, slow confirmations).
- [ ] Dockerfile + compose + prod `.env.example` docs; separate testnet/mainnet sponsor
  keys; optional KMS in front of the sponsor key.

## Phase 4 - Ecosystem parity (full)

Files: `facilitator/src/discovery.ts`, `analytics.ts`, `mcp/`, `dashboard/`, SDK packages

- [ ] **Discovery (spec-shaped).** Implement the core-spec discovery API:
  - `GET /discovery/resources` with the v2 filters (`type`, `payTo`, `scheme`,
    `network`, `extensions`, `limit`, `offset`) and the
    `{ x402Version, items[], pagination }` response shape; catalog resources
    from the settlement ledger + server-declared `resource` metadata.
  - `GET /discovery/search` per the
    [`bazaar`](docs/facilitator/x402/extensions/bazaar.md) extension
    (query, filters, optional cursor pagination).
  - Register the `bazaar` extension in `/supported`.
- [ ] **Analytics** - public redacted endpoints from the ledger (`/data/totals`,
  `/data/timeseries`, `/data/transactions`, …); `GET /api/receipt/{txHash}`.
  Adopt the
  [`offer-and-receipt`](docs/facilitator/x402/extensions/extension-offer-and-receipt.md)
  extension for signed receipts (audit / dispute evidence) - gated behind
  the consent layer.
- [ ] **Facilitator MCP** - SSE + `/mcp/call` so agents can query settlement state.
- [ ] **SDK** - `@xbot02/{express,hono,next}` 1-line middlewares + `@xbot02/paywall`,
  mirroring `@x402/*`, for the "1 line of middleware" adoption story.
- [ ] **Dashboard UI** - clean admin/public view served from `facilitator/dashboard/`, backed entirely by the `/data/*`,
  `/discovery/*` and `/health` endpoints - no direct DB access:
  - **Public (redacted) view:** live totals (payments, volume, tx), timeseries
    charts, recent transactions, per-network status/health + latency.
  - **Public catalog ("Bazaar") view:** browse every resource/project that has
    gone through the facilitator (auto-cataloged from the settlement ledger):
    each entry shows its name, merchant, and the **API services it exposes**
    (resource endpoint + payment requirement: amount, token, network), so users
    can discover and hit any x402-gated API from one place. Plus leaderboards
    (top merchants/networks by volume), payment-methods list, and an ecosystem
    overview - mirroring `/discovery/resources`, `/data/leaderboards`,
    `/data/ecosystem`.
  - **Admin view (authenticated, e.g. bearer/API key or wallet sign-in):**
    consent-request queue with approve/reject, policy (AgentRegistry) management,
    sponsor-wallet balances + gas price, alert/error log, settlement retry.
  - **Stack:** static SPA (e.g. Vite/React) served by the facilitator; charts via
    a small chart lib; no build step required to run (prebuilt bundle in repo).
  - Cross-cutting: reuse `@xbot02` components where sensible; keep the dashboard
    optional (disabled behind `DASHBOARD_ENABLED`), it must never expose
    unredacted payer addresses or consent secrets.

---

## Known gaps not addressed above

- [ ] `AGENT_REGISTRY_ADDRESS_<NETWORK>` is configured (testnet live:
  `0x0cA3F183374f75e5a2d81C29A37B00Aab075be87`; mainnet empty) and already
  follows the suffixed `_{BOT_NETWORK}` convention the facilitator uses for all
  per-network config (`envFor` reads `<NAME>_TESTNET`/`<NAME>_MAINNET`, then the
  plain `<NAME>`), but the facilitator service does not consume it today - of
  the two contract-address vars (`AGENT_REGISTRY_ADDRESS`,
  `CONSENT_GATEWAY_ADDRESS`) the facilitator reads only `CONSENT_GATEWAY_ADDRESS`
  (the `@xbot02/mcp` package does read `AGENT_REGISTRY_ADDRESS`). It is not dead
  config - the AgentRegistry-backed policy caps (what an agent is permitted to
  spend) belong in the Phase 1 consent work, alongside `ConsentGateway.isApproved`.
  Wire it in there and keep the `.env.example` entry.
- [ ] No test coverage for [`server.ts`](facilitator/src/server.ts) wiring, [`bundler.ts`](facilitator/src/bundler.ts) (stub), or the full
  cross-process 402→pay→serve flow in the facilitator suite.
