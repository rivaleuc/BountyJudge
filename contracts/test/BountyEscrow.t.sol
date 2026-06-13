// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "forge-std/Test.sol";
import {BJTToken} from "../src/BJTToken.sol";
import {BountyEscrow} from "../src/BountyEscrow.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract BountyEscrowTest is Test {
    BJTToken token;
    BountyEscrow escrow;
    address resolver = address(0xBEEF);
    address poster = address(0x1);
    address worker = address(0x2);

    function setUp() public {
        token = new BJTToken(1_000_000e18);
        escrow = new BountyEscrow(IERC20(address(token)), resolver);
        token.transfer(poster, 10_000e18);
    }

    function test_fund_and_release_all_milestones() public {
        vm.startPrank(poster);
        token.approve(address(escrow), 3000e18);
        uint256 id = escrow.fund(3000e18, 3, uint64(block.timestamp + 30 days));
        vm.stopPrank();

        // Release milestone 0
        vm.prank(resolver);
        escrow.releaseMilestone(id, worker, 0);
        assertEq(token.balanceOf(worker), 1000e18);

        // Release milestone 1
        vm.prank(resolver);
        escrow.releaseMilestone(id, worker, 1);
        assertEq(token.balanceOf(worker), 2000e18);

        // Release milestone 2 → completed
        vm.prank(resolver);
        escrow.releaseMilestone(id, worker, 2);
        assertEq(token.balanceOf(worker), 3000e18);
        assertEq(escrow.remainingAmount(id), 0);
    }

    function test_refund_after_deadline() public {
        vm.startPrank(poster);
        token.approve(address(escrow), 1000e18);
        uint256 id = escrow.fund(1000e18, 1, uint64(block.timestamp + 7 days));
        vm.stopPrank();

        // Can't refund before deadline
        vm.expectRevert(BountyEscrow.DeadlineNotReached.selector);
        escrow.refund(id);

        // Warp past deadline
        vm.warp(block.timestamp + 8 days);
        escrow.refund(id);
        assertEq(token.balanceOf(poster), 10_000e18); // got it all back
    }

    function test_only_resolver() public {
        vm.startPrank(poster);
        token.approve(address(escrow), 500e18);
        uint256 id = escrow.fund(500e18, 1, uint64(block.timestamp + 30 days));
        vm.stopPrank();

        vm.prank(address(0xDEAD));
        vm.expectRevert(BountyEscrow.NotResolver.selector);
        escrow.releaseMilestone(id, worker, 0);
    }
}
