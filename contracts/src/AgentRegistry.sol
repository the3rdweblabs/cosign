// SPDX-License-Identifier: GPL-3.0
// Copyright (c) 2026 The3rdWebLabs (https://github.com/the3rdweblabs)
// Authors: @CYBWithFlourish (https://github.com/CYBWithFlourish), @wethe3rdweblabs (https://github.com/wethe3rdweblabs)

pragma solidity ^0.8.24;

/// @title AgentRegistry
/// @notice Tracks AI agents, their human guardians, and rolling spend policy.
/// @dev Holds no funds. Pure policy/state contract - the ConsentGateway
///      reads and writes here, and paymaster sponsor-policy checks read here too.
contract AgentRegistry {
    struct AgentPolicy {
        address guardian; // human wallet that owns/oversees this agent
        uint256 spendCap; // max value (wei) the agent can auto-spend per period
        uint256 periodSeconds; // rolling window length, e.g. 1 days
        uint256 spentInPeriod; // running total spent in the current window
        uint256 periodStart; // timestamp the current window began
        bool active;
    }

    mapping(address => AgentPolicy) public policies; // agent address => policy

    address public consentGateway; // only this contract may record spend
    address public owner;

    event AgentRegistered(address indexed agent, address indexed guardian, uint256 spendCap, uint256 periodSeconds);
    event AgentRevoked(address indexed agent, address indexed guardian);
    event GatewaySet(address indexed gateway);

    error NotGuardian();
    error NotGateway();
    error AgentInactive();

    modifier onlyGateway() {
        if (msg.sender != consentGateway) revert NotGateway();
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    /// @notice One-time wiring so the registry knows which ConsentGateway is allowed to record spend.
    function setConsentGateway(address gateway) external {
        require(msg.sender == owner, "not owner");
        consentGateway = gateway;
        emit GatewaySet(gateway);
    }

    /// @notice A human registers an agent under their own guardianship.
    ///         Anyone may claim an unregistered (or revoked) agent, but an
    ///         already-active agent can only be re-registered by its own
    ///         guardian (to change cap/period), never hijacked by a stranger.
    function registerAgent(address agent, uint256 spendCap, uint256 periodSeconds) external {
        require(periodSeconds > 0, "period must be positive");
        AgentPolicy storage p = policies[agent];
        if (p.active && p.guardian != msg.sender) revert NotGuardian();

        p.guardian = msg.sender;
        p.spendCap = spendCap;
        p.periodSeconds = periodSeconds;
        p.spentInPeriod = 0;
        p.periodStart = block.timestamp;
        p.active = true;
        emit AgentRegistered(agent, msg.sender, spendCap, periodSeconds);
    }

    /// @notice Guardian can revoke their agent's privileges at any time.
    function revokeAgent(address agent) external {
        AgentPolicy storage p = policies[agent];
        if (msg.sender != p.guardian) revert NotGuardian();
        p.active = false;
        emit AgentRevoked(agent, msg.sender);
    }

    /// @notice View check: would this amount be within the agent's current-period policy?
    function isWithinPolicy(address agent, uint256 amount) public view returns (bool) {
        AgentPolicy memory p = policies[agent];
        if (!p.active) return false;

        uint256 spent = p.spentInPeriod;
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp >= p.periodStart + p.periodSeconds) {
            spent = 0; // window has rolled over
        }
        return spent + amount <= p.spendCap;
    }

    /// @notice Called only by ConsentGateway once an action is approved (auto or human).
    function recordSpend(address agent, uint256 amount) external onlyGateway {
        AgentPolicy storage p = policies[agent];
        if (!p.active) revert AgentInactive();

        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp >= p.periodStart + p.periodSeconds) {
            p.periodStart = block.timestamp;
            p.spentInPeriod = 0;
        }
        p.spentInPeriod += amount;
    }

    function getPolicy(address agent) external view returns (AgentPolicy memory) {
        return policies[agent];
    }
}
