// SPDX-License-Identifier: GPL-3.0
// Copyright (c) 2026 The3rdWebLabs (https://github.com/the3rdweblabs)
// Authors: @CYBWithFlourish (https://github.com/CYBWithFlourish), @wethe3rdweblabs (https://github.com/wethe3rdweblabs)

import { test } from "node:test";
import assert from "node:assert/strict";
import { createWalletSource } from "./wallet-source.js";

const PK = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const MNEMONIC = "test test test test test test test test test test test junk";
const ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

test("private-key source is a local signer with the expected address", () => {
  const source = createWalletSource({ kind: "private-key", privateKey: PK });
  assert.equal(source.account.type, "local");
  assert.equal(source.isLocalSigner, true);
  assert.equal(source.account.address.startsWith("0x"), true);
  assert.ok("signTransaction" in source.account);
});

test("mnemonic source derives an HD account (first index = anvil default)", () => {
  const source = createWalletSource({ kind: "mnemonic", mnemonic: MNEMONIC });
  assert.equal(source.account.type, "local");
  assert.equal(source.isLocalSigner, true);
  assert.equal(source.account.address, ADDRESS);
});

test("mnemonic source honors accountIndex", () => {
  const first = createWalletSource({ kind: "mnemonic", mnemonic: MNEMONIC, accountIndex: 0 });
  const second = createWalletSource({ kind: "mnemonic", mnemonic: MNEMONIC, accountIndex: 1 });
  assert.notEqual(second.account.address, first.account.address);
});

test("json-rpc source delegates signing and is not a local signer", () => {
  const source = createWalletSource({ kind: "json-rpc", address: ADDRESS, rpcUrl: "https://rpc.bohr.life" });
  assert.equal(source.account.type, "json-rpc");
  assert.equal(source.account.address, ADDRESS);
  assert.equal(source.isLocalSigner, false);
});

test("missing required fields throw", () => {
  assert.throws(() => createWalletSource({ kind: "private-key" }), /privateKey/);
  assert.throws(() => createWalletSource({ kind: "mnemonic" }), /mnemonic/);
  assert.throws(() => createWalletSource({ kind: "json-rpc", rpcUrl: "https://x" }), /address/);
});
