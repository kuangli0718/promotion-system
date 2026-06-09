# Promotion System Design

## Context

SuperLottery currently rolls all leftover prize pool into the next round through
`round.reserveRollover` and `rolloverReserve[gameType]`. The promotion system
splits that leftover into two parts:

- A stimulus amount that continues into the next round prize pool.
- A promotion amount that funds referral rewards.

The design keeps settlement fully on-chain for the current demo scale.

## Goals

- Let the owner configure how much leftover prize pool is used for next-round
  stimulus versus referral promotion.
- Reward promoters when invited wallets buy tickets.
- Keep rewards bounded by the promotion pool so the contract never overpays.
- Preserve existing round lifecycle and game isolation.
- Support ordinary tickets and Lotto system tickets.
- Let promoters claim accumulated promotion rewards after settlement.

## Non-Goals

- No off-chain Merkle reward settlement in this version.
- No multi-level referral tree.
- No per-ticket immediate cashback.
- No changing a user's referrer after first binding.

## Confirmed Rules

- Referral reward basis is `ticketPrice * 50%` per effective invited ticket.
- A wallet's referrer is bound once and then remains permanent.
- Promotion coefficients are configured per game.
- Each round locks the current promotion configuration at round start.
- Promotion rewards are settled during `closeRegistration()`.
- Promoters claim rewards later through a pull-payment function.
- If adding a new round promoter exceeds the per-round promoter limit, the
  purchase reverts.

## Promotion Configuration

Add a game-scoped config:

```solidity
struct PromotionConfig {
    uint16 stimulusBps;
    uint16 promotionBps;
    uint16 referralRewardBps;
    uint16 maxPromotersPerRound;
}

mapping(uint8 => PromotionConfig) public promotionConfigs;
```

Owner API:

```solidity
function setPromotionConfig(
    uint8 gameType,
    uint16 stimulusBps,
    uint16 promotionBps,
    uint16 referralRewardBps,
    uint16 maxPromotersPerRound
) external onlyOwner;
```

Validation:

- `stimulusBps + promotionBps == 10000`
- `referralRewardBps < 10000`
- `maxPromotersPerRound > 0`
- `gameType` must be valid

Initial defaults:

- `stimulusBps = 10000`
- `promotionBps = 0`
- `referralRewardBps = 5000`
- `maxPromotersPerRound = 200`

These defaults preserve existing behavior until the owner enables promotion.

## Round-Locked Configuration

Extend `Round` with locked promotion settings and settlement outputs:

```solidity
struct Round {
    RoundStatus status;
    uint256 prizePool;
    uint8[] winningMain;
    uint8[] winningExtra;
    uint256 requestId;
    uint256 reserveRollover;
    uint256 openTime;
    uint256 closeTime;
    uint256 drawTime;
    uint16 stimulusBps;
    uint16 promotionBps;
    uint16 referralRewardBps;
    uint16 maxPromotersPerRound;
    uint256 promotionPool;
    uint256 promotionPaid;
}
```

The constructor locks the config into each first round. `startNextRound()` locks
the then-current game config into the next round. If the owner updates a config
mid-round, it affects future rounds only.

## Referral Binding

Add permanent referrer storage:

```solidity
mapping(address => address) public referrerOf;
```

Binding rules:

- A buyer can pass a referrer when buying a ticket.
- If the buyer has no referrer and the provided referrer is valid, bind it.
- If the buyer already has a referrer, ignore any later provided referrer.
- Invalid referrers are `address(0)` and the buyer's own address.
- The implementation should reject direct reciprocal binding. If A is already
  referred by B, then B cannot bind A as a referrer.

## Purchase API

Keep existing functions for compatibility:

```solidity
function buyTicket(
    uint8 gameType,
    uint8[] calldata mainNumbers,
    uint8[] calldata extraNumbers
) external payable returns (uint256 ticketId);

function buyLottoSystemTicket(
    uint8[] calldata mainNumbers,
    uint8[] calldata extraNumbers
) external payable returns (uint256 firstTicketId, uint256 entryCount);
```

Add referrer-aware functions:

```solidity
function buyTicketWithReferrer(
    uint8 gameType,
    uint8[] calldata mainNumbers,
    uint8[] calldata extraNumbers,
    address referrer
) external payable returns (uint256 ticketId);

function buyLottoSystemTicketWithReferrer(
    uint8[] calldata mainNumbers,
    uint8[] calldata extraNumbers,
    address referrer
) external payable returns (uint256 firstTicketId, uint256 entryCount);
```

Internally, both old and new purchase functions should share common helpers so
ticket validation and payment checks remain single-sourced.

## Round Promotion Accounting

Track per-round theoretical rewards:

```solidity
mapping(uint8 => mapping(uint256 => address[])) private roundPromoters;
mapping(uint8 => mapping(uint256 => mapping(address => bool))) private roundPromoterSeen;
mapping(uint8 => mapping(uint256 => mapping(address => uint256))) public roundPromotionTheoreticalRewards;
mapping(uint8 => mapping(uint256 => uint256)) public roundPromotionTotalTheoretical;
mapping(address => uint256) public promotionRewardBalance;
```

For each effective invited ticket:

```text
theoreticalReward = ticketCount * ticketPrice * round.referralRewardBps / 10000
```

For ordinary tickets, `ticketCount = 1`.

For Lotto system tickets, `ticketCount = entryCount`, matching the number of
expanded normal tickets.

If the active referrer has not appeared in this game round before, add it to
`roundPromoters[gameType][roundId]`. If adding it would exceed
`round.maxPromotersPerRound`, revert.

## Settlement Algorithm

`closeRegistration(gameType, roundId)` keeps the existing prize settlement
behavior, then splits the leftover:

```text
leftover = round.prizePool - totalPaid
```

If `roundPromotionTotalTheoretical[gameType][roundId] == 0`:

```text
round.reserveRollover = leftover
rolloverReserve[gameType] += leftover
round.promotionPool = 0
round.promotionPaid = 0
```

If there are valid promotion rewards:

```text
promotionPool = leftover * round.promotionBps / 10000
stimulusRollover = leftover - promotionPool
```

Then for each promoter:

```text
actualReward =
    promoterTheoretical * promotionPool / totalTheoretical
```

Accumulate rewards:

```solidity
promotionRewardBalance[promoter] += actualReward;
```

Record:

```text
promotionDust = promotionPool - sum(actualReward)
round.reserveRollover = stimulusRollover + promotionDust
round.promotionPool = promotionPool
round.promotionPaid = sum(actualReward)
rolloverReserve[gameType] += round.reserveRollover
```

Integer division dust from promotion settlement goes back into stimulus
rollover. This keeps all leftover funds visible through round rollover state and
prevents unaccounted ETH from accumulating in the contract.

## Claiming Promotion Rewards

Add a pull-payment claim function:

```solidity
function claimPromotionReward() external;
```

It should:

1. Read `promotionRewardBalance[msg.sender]`.
2. Revert if the balance is zero.
3. Set the balance to zero before external transfer.
4. Transfer ETH to `msg.sender`.
5. Revert if the transfer fails.

This follows the checks-effects-interactions pattern.

## Events

Add events:

```solidity
event PromotionConfigUpdated(
    uint8 indexed gameType,
    uint16 stimulusBps,
    uint16 promotionBps,
    uint16 referralRewardBps,
    uint16 maxPromotersPerRound
);

event ReferrerBound(address indexed buyer, address indexed referrer);

event PromotionAccrued(
    uint8 indexed gameType,
    uint256 indexed roundId,
    address indexed referrer,
    address buyer,
    uint256 ticketCount,
    uint256 theoreticalReward
);

event PromotionSettled(
    uint8 indexed gameType,
    uint256 indexed roundId,
    uint256 promotionPool,
    uint256 totalTheoretical,
    uint256 promotionPaid
);

event PromotionRewardClaimed(address indexed referrer, uint256 amount);
```

## Frontend Changes

Update `src/lottery.js` after compiling and copying ABI.

In `App.jsx`:

- Read `referrerOf(account)` and display the bound referrer.
- Read `promotionRewardBalance(account)` and show claimable promotion rewards.
- Add a referrer input, with optional `?ref=0x...` URL prefill.
- If a user already has a referrer, show it as read-only.
- Use `buyTicketWithReferrer()` and `buyLottoSystemTicketWithReferrer()` when a
  candidate referrer is present or already bound.
- Add a `claimPromotionReward()` button.
- Show round-locked `stimulusBps`, `promotionBps`, `promotionPool`, and
  `promotionPaid`.
- Add owner controls for `setPromotionConfig()` per selected game.

## Testing Plan

Contract tests:

- Default promotion config preserves current rollover behavior.
- Owner can update per-game config; non-owner cannot.
- Round locks config at start and ignores mid-round config changes.
- First purchase binds a valid referrer.
- Later purchases cannot change an existing referrer.
- Self-referral fails.
- Direct reciprocal referral fails.
- Ordinary invited tickets accrue `ticketPrice * 50%` theoretical rewards.
- Lotto system tickets accrue by expanded `entryCount`.
- Promotion pool caps actual rewards when theoretical rewards exceed available
  promotion funds.
- Promotion rewards are paid proportionally across promoters.
- If no promoter exists, all leftover rolls into next-round stimulus.
- Exceeding `maxPromotersPerRound` with a new promoter reverts.
- Existing promoters can continue receiving theoretical rewards after the
  promoter list reaches the cap.
- `claimPromotionReward()` transfers funds, clears balance first, and prevents
  repeated claims.

Frontend smoke checks:

- Referrer URL prefill works.
- Bound referrer display is read-only.
- Purchase calls the referrer-aware function when applicable.
- Promotion reward balance and claim button refresh after claim.
- Owner config controls submit valid BPS values and reject invalid totals.

## Risks and Constraints

- `closeRegistration()` loops through round promoters. The per-round promoter
  cap is required to keep settlement bounded.
- Full on-chain accounting is simple and transparent but not suitable for very
  large referral programs. A future large-scale version should use an indexed
  event log plus Merkle claims.
- Existing deployed contracts cannot be upgraded in place. Sepolia testing
  requires deploying a new contract and updating `VITE_SUPER_LOTTERY_ADDRESS`.
