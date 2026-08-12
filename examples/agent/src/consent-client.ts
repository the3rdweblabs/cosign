// SPDX-License-Identifier: GPL-3.0
// Copyright (c) 2026 The3rdWebLabs (https://github.com/the3rdweblabs)
// Authors: @CYBWithFlourish (https://github.com/CYBWithFlourish), @wethe3rdweblabs (https://github.com/wethe3rdweblabs)

// The ConsentClient and consent ABIs now live in @xbot02/core (the single
// source of truth). This module re-exports them so existing agent imports
// keep working, and serves as an integration check that the SDK wiring is right.
export {
  ConsentClient,
  type ApprovalOutcome,
  type ConsentRequest,
  type RequestOutcome,
  type ConsentClientOptions,
  type ActivityEntry,
  consentGatewayAbi,
  requestStatus,
  type RequestStatus,
} from "@xbot02/core";
