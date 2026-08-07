// SPDX-License-Identifier: GPL-3.0
// Copyright (c) 2026 The3rdWebLabs (https://github.com/the3rdweblabs)
// Authors: @CYBWithFlourish (https://github.com/CYBWithFlourish), @wethe3rdweblabs (https://github.com/wethe3rdweblabs)

pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {AgentRegistry} from "../src/AgentRegistry.sol";
import {ConsentGateway} from "../src/ConsentGateway.sol";

/// @notice Deploys AgentRegistry, then ConsentGateway, then wires
///         registry.setConsentGateway(gateway) so spend recording works.
///
/// @dev Network-aware: reads BOT_NETWORK (testnet default | mainnet) and
///      refuses to run if the connected chain id does not match. After the
///      deployment it writes a record to `deploy.{BOT_NETWORK}.json` in the
///      contracts project root carrying every service-facing detail:
///        network, chainId, rpcUrl, explorerUrl, deployer, deployedAtBlock,
///        deployedAtTimestamp, agentRegistry, consentGateway, and the
///        per-network env var names the services read.
///
///      Run it with:
///        forge script script/Deploy.s.sol --rpc-url bohr     --broadcast --verify  # testnet
///        forge script script/Deploy.s.sol --rpc-url botchain --broadcast --verify  # mainnet
///      (BOT_NETWORK defaults to "testnet"; set BOT_NETWORK=mainnet to deploy the
///      mainnet record. The chain id check prevents a mis-matched rpc-url.)
contract Deploy is Script {
    struct NetworkConfig {
        string name;
        uint256 chainId;
        string rpcAlias;
        string explorer;
    }

    function run() external returns (AgentRegistry registry, ConsentGateway gateway) {
        string memory defaultNetwork = "testnet";
        string memory networkName = vm.envOr("BOT_NETWORK", defaultNetwork);
        NetworkConfig memory net = networkConfig(networkName);

        require(
            block.chainid == net.chainId,
            string.concat(
                "BOT_NETWORK=",
                networkName,
                " but chain id is ",
                vm.toString(block.chainid),
                "; expected ",
                vm.toString(net.chainId)
            )
        );

        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        vm.startBroadcast(deployerKey);

        registry = new AgentRegistry();
        console2.log("AgentRegistry deployed:", address(registry));

        gateway = new ConsentGateway(address(registry));
        console2.log("ConsentGateway deployed:", address(gateway));

        registry.setConsentGateway(address(gateway));
        console2.log("AgentRegistry.consentGateway wired ->", address(gateway));

        vm.stopBroadcast();

        require(registry.consentGateway() == address(gateway), "gateway wiring failed");
        require(gateway.registry() == registry, "gateway registry mismatch");

        writeDeploymentFile(net, deployer, registry, gateway);
    }

    function networkConfig(string memory name) internal pure returns (NetworkConfig memory) {
        if (isEq(name, "testnet")) {
            return NetworkConfig({name: "testnet", chainId: 968, rpcAlias: "bohr", explorer: "https://scan.bohr.life"});
        }
        if (isEq(name, "mainnet")) {
            return
                NetworkConfig({
                    name: "mainnet", chainId: 677, rpcAlias: "botchain", explorer: "https://scan.botchain.ai"
                });
        }
        revert(string.concat("Unknown BOT_NETWORK \"", name, "\" (expected testnet or mainnet)"));
    }

    /// @notice Writes `deploy.{network}.json` in the contracts project root
    ///         (path is relative to the foundry project root).
    function writeDeploymentFile(
        NetworkConfig memory net,
        address deployer,
        AgentRegistry registry,
        ConsentGateway gateway
    ) internal {
        string memory suffix = isEq(net.name, "testnet") ? "TESTNET" : "MAINNET";

        // vm.serialize* accumulates under a fixed objectKey; only the last
        // call's return carries the full object.
        string memory key = "deployment";
        vm.serializeString(key, "network", net.name);
        vm.serializeUint(key, "chainId", net.chainId);
        vm.serializeString(key, "rpcUrl", vm.rpcUrl(net.rpcAlias));
        vm.serializeString(key, "explorerUrl", net.explorer);
        vm.serializeAddress(key, "deployer", deployer);
        vm.serializeUint(key, "deployedAtBlock", block.number);
        vm.serializeUint(key, "deployedAtTimestamp", block.timestamp);
        vm.serializeAddress(key, "agentRegistry", address(registry));
        vm.serializeAddress(key, "consentGateway", address(gateway));
        vm.serializeString(key, "agentRegistryEnv", string.concat("AGENT_REGISTRY_ADDRESS_", suffix));
        string memory json =
            vm.serializeString(key, "consentGatewayEnv", string.concat("CONSENT_GATEWAY_ADDRESS_", suffix));

        string memory file = string.concat("./deploy.", net.name, ".json");
        vm.writeJson(json, file);
        console2.log("Deployment record written:", file);
        console2.log(
            "  consentGateway (services):",
            string.concat("CONSENT_GATEWAY_ADDRESS_", suffix),
            "=",
            vm.toString(address(gateway))
        );
        console2.log(
            "  agentRegistry (services):",
            string.concat("AGENT_REGISTRY_ADDRESS_", suffix),
            "=",
            vm.toString(address(registry))
        );
    }

    function isEq(string memory a, string memory b) internal pure returns (bool) {
        return keccak256(bytes(a)) == keccak256(bytes(b));
    }
}
