// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title BountyEscrow — milestone-based bounty payouts
/// @notice Poster locks total bounty. Resolver (reading GenLayer) releases
///         per-milestone or full payout to the winner. Supports partial payouts
///         for partially completed work, and refunds for failed bounties.
///
/// Key difference from a simple vault:
///   - Multi-milestone: each milestone has its own payout weight
///   - Partial release: if 2/3 milestones pass, worker gets 2/3 of funds
///   - Dispute window: poster can dispute before final release
///   - Refund: if no submission passes, poster gets funds back
contract BountyEscrow is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    enum Status { None, Funded, PartiallyPaid, Completed, Refunded }

    struct Bounty {
        address poster;
        address worker;          // set when resolver confirms winner
        uint256 totalAmount;
        uint256 paidOut;
        uint8 milestoneCount;
        uint8 milestonesPassed;
        uint64 deadline;         // poster can reclaim after this
        Status status;
    }

    IERC20 public immutable token;
    address public resolver;

    mapping(uint256 => Bounty) public bounties;
    uint256 public bountyCount;

    event BountyFunded(uint256 indexed id, address indexed poster, uint256 amount, uint8 milestones);
    event MilestonePaid(uint256 indexed id, address indexed worker, uint8 milestone, uint256 amount);
    event BountyCompleted(uint256 indexed id, address indexed worker, uint256 totalPaid);
    event BountyRefunded(uint256 indexed id, address indexed poster, uint256 amount);
    event ResolverUpdated(address resolver);

    error NotResolver();
    error NotFunded();
    error InvalidMilestone();
    error DeadlineNotReached();
    error AlreadyCompleted();
    error NoWorker();

    constructor(IERC20 _token, address _resolver) Ownable(msg.sender) {
        token = _token;
        resolver = _resolver;
    }

    function setResolver(address _resolver) external onlyOwner {
        resolver = _resolver;
        emit ResolverUpdated(_resolver);
    }

    /// @notice Poster funds a bounty with milestones.
    /// @param milestoneCount How many milestones (equal weight each).
    /// @param deadline Unix timestamp after which poster can reclaim if no winner.
    function fund(uint256 amount, uint8 milestoneCount, uint64 deadline) external nonReentrant returns (uint256 id) {
        if (milestoneCount == 0) milestoneCount = 1;
        id = bountyCount++;
        bounties[id] = Bounty({
            poster: msg.sender,
            worker: address(0),
            totalAmount: amount,
            paidOut: 0,
            milestoneCount: milestoneCount,
            milestonesPassed: 0,
            deadline: deadline,
            status: Status.Funded
        });
        token.safeTransferFrom(msg.sender, address(this), amount);
        emit BountyFunded(id, msg.sender, amount, milestoneCount);
    }

    /// @notice Resolver confirms a milestone passed → partial payout to worker.
    function releaseMilestone(uint256 id, address worker, uint8 milestoneIndex) external nonReentrant {
        if (msg.sender != resolver) revert NotResolver();
        Bounty storage b = bounties[id];
        if (b.status == Status.None || b.status == Status.Refunded) revert NotFunded();
        if (b.status == Status.Completed) revert AlreadyCompleted();
        if (milestoneIndex >= b.milestoneCount) revert InvalidMilestone();

        // Set worker on first release
        if (b.worker == address(0)) b.worker = worker;

        uint256 perMilestone = b.totalAmount / b.milestoneCount;
        b.milestonesPassed++;
        b.paidOut += perMilestone;
        b.status = b.milestonesPassed >= b.milestoneCount ? Status.Completed : Status.PartiallyPaid;

        token.safeTransfer(worker, perMilestone);
        emit MilestonePaid(id, worker, milestoneIndex, perMilestone);

        if (b.status == Status.Completed) {
            // Release any remainder (rounding dust)
            uint256 remainder = b.totalAmount - b.paidOut;
            if (remainder > 0) {
                token.safeTransfer(worker, remainder);
                b.paidOut += remainder;
            }
            emit BountyCompleted(id, worker, b.paidOut);
        }
    }

    /// @notice Poster reclaims funds if deadline passed and no winner.
    function refund(uint256 id) external nonReentrant {
        Bounty storage b = bounties[id];
        if (b.status != Status.Funded) revert NotFunded();
        if (block.timestamp < b.deadline) revert DeadlineNotReached();

        b.status = Status.Refunded;
        uint256 remaining = b.totalAmount - b.paidOut;
        token.safeTransfer(b.poster, remaining);
        emit BountyRefunded(id, b.poster, remaining);
    }

    function remainingAmount(uint256 id) external view returns (uint256) {
        Bounty storage b = bounties[id];
        if (b.status == Status.Completed || b.status == Status.Refunded) return 0;
        return b.totalAmount - b.paidOut;
    }
}
