// SPDX-License-Identifier: GPL-3.0
// Copyright (c) 2026 The3rdWebLabs (https://github.com/the3rdweblabs)
// Authors: @CYBWithFlourish (https://github.com/CYBWithFlourish), @wethe3rdweblabs (https://github.com/wethe3rdweblabs)

pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AgentRegistry} from "../src/AgentRegistry.sol";
import {ConsentGateway} from "../src/ConsentGateway.sol";

contract ConsentGatewayTest is Test {
    AgentRegistry internal registry;
    ConsentGateway internal gateway;

    address internal guardian = makeAddr("guardian");
    address internal agent = makeAddr("agent");
    address internal stranger = makeAddr("stranger");
    address internal target = makeAddr("target");

    bytes32 internal constant PAYMENT = keccak256("PAYMENT");
    bytes32 internal constant HUBOT = keccak256("HUBOT_TRIGGER");

    uint256 internal constant SPEND_CAP = 10 ether;
    uint256 internal constant PERIOD = 1 days;

    function setUp() public {
        vm.prank(guardian);
        registry = new AgentRegistry();
        gateway = new ConsentGateway(address(registry));

        vm.prank(guardian);
        registry.setConsentGateway(address(gateway));

        vm.prank(guardian);
        registry.registerAgent(agent, SPEND_CAP, PERIOD);
    }

    function requestAsAgent(uint256 amount) internal returns (uint256 requestId, bool autoApproved) {
        vm.prank(agent);
        return gateway.requestAction(target, amount, PAYMENT);
    }

    function test_AutoApprovesWithinPolicy() public {
        (uint256 id, bool autoApproved) = requestAsAgent(4 ether);
        assertTrue(autoApproved, "in-policy action should auto-approve");
        assertTrue(gateway.isApproved(id), "auto-approved should be approved");
        assertEq(uint8(gateway.getRequest(id).status), uint8(ConsentGateway.Status.AutoApproved));
        assertEq(registry.getPolicy(agent).spentInPeriod, 4 ether, "spend should be recorded");
    }

    function test_ExactCapAutoApproves() public {
        (uint256 id, bool autoApproved) = requestAsAgent(SPEND_CAP);
        assertTrue(autoApproved, "exactly-at-cap should auto-approve");
        assertTrue(gateway.isApproved(id));
    }

    function test_OverPolicyParksAsPending() public {
        (uint256 id, bool autoApproved) = requestAsAgent(SPEND_CAP + 1);
        assertFalse(autoApproved, "over-policy action must not auto-approve");
        assertFalse(gateway.isApproved(id), "pending must not be approved");
        assertEq(uint8(gateway.getRequest(id).status), uint8(ConsentGateway.Status.Pending));
        assertEq(registry.getPolicy(agent).spentInPeriod, 0, "no spend recorded while pending");
    }

    function test_GuardianApprovesPending() public {
        (uint256 id,) = requestAsAgent(SPEND_CAP + 1);

        vm.prank(guardian);
        gateway.approve(id);

        assertTrue(gateway.isApproved(id), "guardian approval should mark approved");
        assertEq(uint8(gateway.getRequest(id).status), uint8(ConsentGateway.Status.Approved));
        assertEq(registry.getPolicy(agent).spentInPeriod, SPEND_CAP + 1, "spend recorded on approval");
    }

    function test_GuardianRejectsPending() public {
        (uint256 id,) = requestAsAgent(SPEND_CAP + 1);

        vm.prank(guardian);
        gateway.reject(id);

        assertFalse(gateway.isApproved(id), "rejected must not be approved");
        assertEq(uint8(gateway.getRequest(id).status), uint8(ConsentGateway.Status.Rejected));
        assertEq(registry.getPolicy(agent).spentInPeriod, 0, "no spend recorded on reject");
    }

    function test_ExpiresAfterPendingTimeout() public {
        (uint256 id,) = requestAsAgent(SPEND_CAP + 1);
        assertFalse(gateway.isApproved(id), "should not be approved while pending");

        vm.warp(block.timestamp + gateway.PENDING_TIMEOUT());
        assertFalse(gateway.isApproved(id), "pending should never be approved");

        vm.warp(block.timestamp + 1);
        assertFalse(gateway.isApproved(id), "expired pending must not be approved");
    }

    function test_NonGuardianCannotApprove() public {
        (uint256 id,) = requestAsAgent(SPEND_CAP + 1);

        vm.prank(stranger);
        vm.expectRevert(ConsentGateway.NotGuardianOfAgent.selector);
        gateway.approve(id);
    }

    function test_NonGuardianCannotReject() public {
        (uint256 id,) = requestAsAgent(SPEND_CAP + 1);

        vm.prank(stranger);
        vm.expectRevert(ConsentGateway.NotGuardianOfAgent.selector);
        gateway.reject(id);
    }

    function test_CannotApproveTwice() public {
        (uint256 id,) = requestAsAgent(SPEND_CAP + 1);

        vm.prank(guardian);
        gateway.approve(id);

        vm.prank(guardian);
        vm.expectRevert(ConsentGateway.RequestNotPending.selector);
        gateway.approve(id);
    }

    function test_CannotTouchAutoApprovedRequest() public {
        (uint256 id,) = requestAsAgent(1 ether);

        vm.prank(guardian);
        vm.expectRevert(ConsentGateway.RequestNotPending.selector);
        gateway.approve(id);

        vm.prank(guardian);
        vm.expectRevert(ConsentGateway.RequestNotPending.selector);
        gateway.reject(id);
    }

    function test_CumulativeSpendRespectsCap() public {
        requestAsAgent(4 ether);
        (, bool autoApproved2) = requestAsAgent(4 ether);
        assertTrue(autoApproved2, "cumulative spend within cap should auto-approve");

        (uint256 id3, bool autoApproved3) = requestAsAgent(3 ether);
        assertFalse(autoApproved3, "cumulative spend over cap must park");
        assertEq(uint8(gateway.getRequest(id3).status), uint8(ConsentGateway.Status.Pending));
    }

    function test_RollingWindowResetsSpend() public {
        requestAsAgent(SPEND_CAP);
        assertFalse(registry.isWithinPolicy(agent, 1), "cap exhausted in current window");

        vm.warp(block.timestamp + PERIOD);
        assertTrue(registry.isWithinPolicy(agent, 1), "window rollover should reset spend");

        (, bool autoApproved) = requestAsAgent(1);
        assertTrue(autoApproved, "post-rollover action should auto-approve");
        assertEq(registry.getPolicy(agent).spentInPeriod, 1, "spentInPeriod reset on rollover");
    }

    function test_RevokedAgentCannotRequestAction() public {
        vm.prank(guardian);
        registry.revokeAgent(agent);

        vm.expectRevert(ConsentGateway.AgentNotActive.selector);
        requestAsAgent(1 ether);
    }

    function test_UnregisteredAgentCannotRequestAction() public {
        vm.prank(makeAddr("unregistered"));
        vm.expectRevert(ConsentGateway.AgentNotActive.selector);
        gateway.requestAction(target, 1, PAYMENT);
    }

    function test_RegisterAgentCannotHijackActiveAgent() public {
        vm.prank(stranger);
        vm.expectRevert(AgentRegistry.NotGuardian.selector);
        registry.registerAgent(agent, 100 ether, PERIOD);
    }

    function test_GuardianCanUpdateOwnAgentPolicy() public {
        vm.prank(guardian);
        registry.registerAgent(agent, 50 ether, 2 days);

        AgentRegistry.AgentPolicy memory p = registry.getPolicy(agent);
        assertEq(p.spendCap, 50 ether, "guardian should be able to change their own cap");
        assertEq(p.periodSeconds, 2 days, "guardian should be able to change their own period");
        assertEq(p.guardian, guardian, "guardianship must be preserved");
    }

    function test_ExpiredRequestCannotBeApproved() public {
        (uint256 id,) = requestAsAgent(SPEND_CAP + 1);

        vm.warp(block.timestamp + gateway.PENDING_TIMEOUT() + 1);

        vm.prank(guardian);
        vm.expectRevert(ConsentGateway.RequestExpired.selector);
        gateway.approve(id);

        vm.prank(guardian);
        vm.expectRevert(ConsentGateway.RequestExpired.selector);
        gateway.reject(id);
    }

    function test_ExpireMarksRequestExpired() public {
        (uint256 id,) = requestAsAgent(SPEND_CAP + 1);

        vm.warp(block.timestamp + gateway.PENDING_TIMEOUT() + 1);
        vm.expectEmit(true, true, true, true);
        emit ConsentGateway.ActionExpired(id);
        gateway.expire(id);

        assertEq(uint8(gateway.getRequest(id).status), uint8(ConsentGateway.Status.Expired));
        assertFalse(gateway.isApproved(id), "expired request must not be approved");
    }

    function test_OnlyGatewayCanRecordSpend() public {
        vm.prank(stranger);
        vm.expectRevert(AgentRegistry.NotGateway.selector);
        registry.recordSpend(agent, 1);
    }

    function test_RequestIdsIncrement() public {
        (uint256 id1,) = requestAsAgent(1);
        (uint256 id2,) = requestAsAgent(1);
        assertEq(id2, id1 + 1, "request ids must be sequential");
    }
}
