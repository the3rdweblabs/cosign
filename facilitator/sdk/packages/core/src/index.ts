// SPDX-License-Identifier: GPL-3.0
// Copyright (c) 2026 The3rdWebLabs (https://github.com/the3rdweblabs)
// Authors: @CYBWithFlourish (https://github.com/CYBWithFlourish), @wethe3rdweblabs (https://github.com/wethe3rdweblabs)

export { botChainTestnet, botChainMainnet } from "./chain.js";
export {
  type BotNetwork,
  type BotNetworkConfig,
  botNetworks,
  defaultBotNetwork,
  botNetworkFromEnv,
  botNetworkConfig,
  botChainFromEnv,
  envFor,
  isBotNetwork,
} from "./network.js";
export {
  consentGatewayAbi,
  agentRegistryAbi,
  actionRequestedEvent,
  consentGatewayEvents,
  actionTypeHash,
} from "./abis.js";
export { requestStatus, statusNum, statusOrder, type RequestStatus } from "./status.js";
export {
  actionTypeLabel,
  formatAmount,
  shortAddress,
  timeAgo,
} from "./format.js";
export {
  nativeAsset,
  botTestnetCaip2,
  botMainnetCaip2,
  x402Scheme,
  x402Version,
  x402Error,
  type X402ErrorCode,
  type PaymentRequirements,
  type PaymentDetails,
  type ResourceInfo,
  type PaymentRequired,
  type BotChainPayload,
  type PaymentPayload,
  type VerifyRequest,
  type VerificationResult,
  type VerifyResponse,
  type SettlementResult,
  type SettleResponse,
  type SupportedKind,
  type SupportedResponse,
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
} from "./middleware.js";
