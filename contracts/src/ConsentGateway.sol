// SPDX-License-Identifier: GPL-3.0
// Copyright (c) 2026 The3rdWebLabs (https://github.com/the3rdweblabs)
// Authors: @CYBWithFlourish (https://github.com/CYBWithFlourish), @wethe3rdweblabs (https://github.com/wethe3rdweblabs)

pragma solidity ^0.8.24;

import {AgentRegistry} from "./AgentRegistry.sol";

/// @title ConsentGateway
/// @notice The circuit breaker. Agents call requestAction() before spending.
///         In-policy actions auto-approve instantly. Out-of-policy actions
///         park as pending until the human guardian approves or rejects.
/// @dev Holds no funds - this is state only. Your off-chain paymaster's
///      sponsor-policy check (pm_isSponsorable) should call isApproved()
///      here before agreeing to sponsor the matching on-chain transfer.
contract ConsentGateway {
    enum Status {
        None,
        AutoApproved,
        Pending,
        Approved,
        Rejected,
        Expired
    }

    struct ActionRequest {
        address agent;
        address target; // who/what the value is going to
        uint256 amount; // value in wei
        bytes32 actionType; // e.g. keccak256("PAYMENT"), keccak256("HUBOT_TRIGGER")
        uint256 requestedAt;
        Status status;
    }

    AgentRegistry public immutable registry;
    uint256 public constant PENDING_TIMEOUT = 15 minutes;

    uint256 public nextRequestId;
    mapping(uint256 => ActionRequest) public requests;

    event ActionRequested(
        uint256 indexed requestId, address indexed agent, address target, uint256 amount, bytes32 actionType
    );
    event ActionAutoApproved(uint256 indexed requestId);
    event ActionApproved(uint256 indexed requestId, address indexed guardian);
    event ActionRejected(uint256 indexed requestId, address indexed guardian);
    event ActionExpired(uint256 indexed requestId);

    error NotGuardianOfAgent();
    error RequestNotPending();
    error RequestExpired();
    error AgentNotActive();

    constructor(address registryAddress) {
        registry = AgentRegistry(registryAddress);
    }

    /// @notice Agent calls this before an action. Returns the request id and
    ///         whether it auto-approved so the off-chain agent knows whether
    ///         to proceed immediately or wait for a human.
    function requestAction(address target, uint256 amount, bytes32 actionType)
        external
        returns (uint256 requestId, bool autoApproved)
    {
        requestId = nextRequestId++;
        address agent = msg.sender;

        if (!registry.getPolicy(agent).active) revert AgentNotActive();

        requests[requestId] = ActionRequest({
            agent: agent,
            target: target,
            amount: amount,
            actionType: actionType,
            requestedAt: block.timestamp,
            status: Status.Pending
        });

        emit ActionRequested(requestId, agent, target, amount, actionType);

        if (registry.isWithinPolicy(agent, amount)) {
            requests[requestId].status = Status.AutoApproved;
            registry.recordSpend(agent, amount);
            emit ActionAutoApproved(requestId);
            return (requestId, true);
        }

        return (requestId, false);
    }

    /// @notice Guardian approves a pending high-risk request from their agent.
    function approve(uint256 requestId) external {
        ActionRequest storage r = requests[requestId];
        if (r.status != Status.Pending) revert RequestNotPending();
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp > r.requestedAt + PENDING_TIMEOUT) revert RequestExpired();

        AgentRegistry.AgentPolicy memory p = registry.getPolicy(r.agent);
        if (msg.sender != p.guardian) revert NotGuardianOfAgent();

        r.status = Status.Approved;
        registry.recordSpend(r.agent, r.amount);
        emit ActionApproved(requestId, msg.sender);
    }

    /// @notice Guardian rejects a pending request. Agent cannot retry the same id.
    function reject(uint256 requestId) external {
        ActionRequest storage r = requests[requestId];
        if (r.status != Status.Pending) revert RequestNotPending();
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp > r.requestedAt + PENDING_TIMEOUT) revert RequestExpired();

        AgentRegistry.AgentPolicy memory p = registry.getPolicy(r.agent);
        if (msg.sender != p.guardian) revert NotGuardianOfAgent();

        r.status = Status.Rejected;
        emit ActionRejected(requestId, msg.sender);
    }

    /// @notice Permissionless. Marks an overdue pending request Expired so its
    ///         status is visible on-chain (previously it sat as Pending forever).
    function expire(uint256 requestId) external {
        ActionRequest storage r = requests[requestId];
        if (r.status != Status.Pending) return;
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp <= r.requestedAt + PENDING_TIMEOUT) return;
        r.status = Status.Expired;
        emit ActionExpired(requestId);
    }

    /// @notice What your off-chain paymaster/facilitator checks before settling.
    function isApproved(uint256 requestId) external view returns (bool) {
        ActionRequest memory r = requests[requestId];
        if (r.status == Status.AutoApproved || r.status == Status.Approved) return true;
        // forge-lint: disable-next-line(block-timestamp)
        if (r.status == Status.Pending && block.timestamp > r.requestedAt + PENDING_TIMEOUT) return false; // treat as expired
        return false;
    }

    function getRequest(uint256 requestId) external view returns (ActionRequest memory) {
        return requests[requestId];
    }
}
