// SPDX-License-Identifier: GPL-3.0
// Copyright (c) 2026 The3rdWebLabs (https://github.com/the3rdweblabs)
// Authors: @CYBWithFlourish (https://github.com/CYBWithFlourish), @wethe3rdweblabs (https://github.com/wethe3rdweblabs)

export { botChainTestnet, botChainMainnet } from "./chain.js";
export {
  type BotNetwork,
  type BotNetworkConfig,
  BOT_NETWORKS,
  DEFAULT_BOT_NETWORK,
  botNetworkFromEnv,
  botNetworkConfig,
  botChainFromEnv,
  envFor,
  isBotNetwork,
} from "./network.js";
export {
  CONSENT_GATEWAY_ABI,
  AGENT_REGISTRY_ABI,
  ACTION_REQUESTED_EVENT,
  actionTypeHash,
} from "./abis.js";
export { REQUEST_STATUS, STATUS, STATUS_NUM, STATUS_ORDER, type RequestStatus } from "./status.js";
export {
  actionTypeLabel,
  formatAmount,
  shortAddress,
  timeAgo,
} from "./format.js";
export {
  NATIVE_ASSET,
  BOT_TESTNET_CAIP2,
  BOT_MAINNET_CAIP2,
  X402_SCHEME,
  type PaymentDetails,
  type PaymentPayload,
  type VerifyRequest,
  type VerificationResult,
  type SettlementResult,
} from "./x402.js";
export {
  type FeeSchedule,
  computeFeeAmount,
} from "./fee.js";
export {
  ConsentClient,
  type ApprovalOutcome,
  type ConsentRequest,
  type RequestOutcome,
  type ConsentClientOptions,
  type ActivityEntry,
} from "./consent-client.js";
export {
  createWalletSource,
  type WalletSource,
  type WalletSourceConfig,
} from "./wallet-source.js";
export {
  buildPaymentRequirements,
  encodePaymentRequirements,
  paymentMiddleware,
  type PaymentMiddlewareOptions,
  type PaymentRequirements,
} from "./middleware.js";
