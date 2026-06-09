# Weighted Prize Allocation Design

## Goal

Replace fixed prize-tier percentages with a dynamic per-round allocation model:

- Harder prize tiers receive higher weight.
- The compression coefficient is `a = 0.3` for the initial design.
- `a` is used off-chain to calculate final integer tier weights.
- The contract stores final `weight` values and does not compute fractional powers.
- Rewards are distributed according to actual registered winner counts in that round.
- Each tier has both a tier pool cap and a per-winning-ticket cap.
- Any unallocated amount rolls into the next round for the same game.

## Current Behavior

The contract currently stores each tier as:

```solidity
struct PrizeTier {
    uint8 tierId;
    uint8 mainMatch;
    uint8 extraMatch;
    uint16 poolBps;
    bool rollIfNoWinner;
}
```

During `closeRegistration`, each tier receives a fixed share of `round.prizePool` using `poolBps`. Winners in that tier split the tier pool equally. If a tier has no winners and `rollIfNoWinner` is true, that tier's pool rolls over.

This is simple, but it cannot adapt to each round's actual winner distribution. It also allows undesirable outcomes if dynamic allocation is added without caps, such as a single low-tier winner receiving too much of the pool.

## New Allocation Model

Each tier has:

```solidity
struct PrizeTier {
    uint8 tierId;
    uint8 mainMatch;
    uint8 extraMatch;
    uint256 weight;
    uint16 maxPoolBps;
    uint256 maxPrizePerWinner;
    bool rollIfNoWinner;
}
```

Definitions:

- `weight`: final integer tier weight, calculated off-chain from `(1 / probability) ^ a`.
- `maxPoolBps`: maximum share of the available pool that this tier may receive.
- `maxPrizePerWinner`: maximum wei paid to each winning ticket in this tier.
- `rollIfNoWinner`: kept for compatibility of tier semantics, but no-winner tiers do not receive dynamic allocation because allocation is based only on tiers with winners.

Initial compression coefficient:

```text
a = 0.3
```

The contract will not store `a` or calculate powers. In this implementation, weights are hardcoded during game configuration. Owner-controlled tier weight updates are out of scope for this change.

## Settlement Formula

At `closeRegistration(gameType, roundId)`:

```text
reserve = prizePool * reserveBps / 10000
availablePool = prizePool - reserve

effectiveWeight_i = tier.weight * winnerCount_i
totalEffectiveWeight = sum(effectiveWeight_i for tiers with winnerCount_i > 0)
```

If `totalEffectiveWeight == 0`, then the whole prize pool rolls over:

```text
roundRollover = prizePool
```

Otherwise, for each tier with winners:

```text
rawTierPool_i = availablePool * effectiveWeight_i / totalEffectiveWeight
tierCap_i = availablePool * tier.maxPoolBps / 10000
cappedTierPool_i = min(rawTierPool_i, tierCap_i)

rawPrizePerWinner_i = cappedTierPool_i / winnerCount_i
prizePerWinner_i = min(rawPrizePerWinner_i, tier.maxPrizePerWinner)

actualPaid_i = prizePerWinner_i * winnerCount_i
```

Rollover includes:

```text
reserve
availablePool - sum(actualPaid_i)
rounding dust
cap overflow
```

Equivalent implementation approach:

```text
totalPaid = sum(actualPaid_i)
roundRollover = prizePool - totalPaid
```

This is simpler and prevents accounting mistakes as long as `totalPaid <= prizePool`.

## Caps

Each tier uses both caps:

1. `maxPoolBps`: prevents one tier from taking too much of the available pool.
2. `maxPrizePerWinner`: prevents one winning ticket from receiving an outsized payout.

For the Sepolia demo, `maxPrizePerWinner` should be based on `ticketPrice` multiples:

```text
Tier 1: 1000 * ticketPrice
Tier 2: 300 * ticketPrice
Tier 3: 100 * ticketPrice
Tier 4: 30 * ticketPrice
Tier 5: 10 * ticketPrice
```

Games with fewer than five tiers use the first N cap levels in order from highest to lowest tier.

Initial `maxPoolBps` values should be conservative and preserve high-tier priority while preventing low-tier overpayment:

```text
Tier 1: 8000
Tier 2: 5000
Tier 3: 3000
Tier 4: 1500
Tier 5: 800
```

Games with fewer than five tiers use the first N pool-cap levels.

## Initial Weights

Weights are calculated off-chain using:

```text
weight = round((1 / tierProbability) ^ 0.3 * scale)
```

Use:

```text
scale = 1_000_000
```

The implementation plan should include a small script or documented helper to calculate weights from game definitions. The contract receives integer weights only.

For this implementation, weights are hardcoded in `_configureDigital`, `_configureNumberLotto`, `_configureLotto`, `_configureBaseLotto`, and `_configureKeno` after calculation. Owner-updatable tier configuration is explicitly out of scope.

Weights follow actual resolved-tier probability, not tier ID order. If a lower-numbered tier is more common than a higher-numbered tier under the current game rules, the higher-numbered tier can receive a larger weight. This is intentional for the probability-based model unless the game rules themselves are redesigned.

## Contract Impact

Modify:

- `PrizeTier` struct.
- `_addPrizeTier` signature.
- Game configuration functions.
- `closeRegistration` allocation logic.
- Any tests that assert fixed `poolBps`.

Keep:

- `registerWinningTicket` behavior.
- `registeredTicketTier` storage.
- `tierWinnerCounts`.
- `tierPrizePerWinner`.
- `claimPrize`.
- `rolloverReserve`.

Remove or replace:

- Fixed `poolBps` settlement.

The public getter `gamePrizeTiers(gameType, index)` will change shape because Solidity auto-generates a getter for the modified struct. This requires frontend and ABI updates and a new Sepolia deployment.

## Frontend Impact

The prize tier table should stop presenting fixed pool shares like `50%`.

Instead, display:

- Tier label.
- Weight.
- Max pool cap.
- Max prize per ticket.
- Registered winners.
- Prize per winner after close registration.

The frontend game definitions in `src/lottery.js` should replace static `pool` text with cap/weight metadata or derive display from contract reads where practical.

## Test Plan

Add tests for:

- Dynamic allocation uses `weight * winnerCount`.
- Higher-tier winners receive more than lower-tier winners when both are present and caps do not bind.
- A low-tier single winner cannot drain the full available pool.
- `maxPoolBps` caps a tier's total allocation.
- `maxPrizePerWinner` caps a single winning ticket payout.
- No winners rolls the whole prize pool into rollover.
- Rounding dust rolls over.
- Existing claim flow still transfers `tierPrizePerWinner`.

Existing fixed percentage tests must be replaced with dynamic allocation assertions.

## Deployment Impact

This is a contract-breaking change:

- Recompile.
- Regenerate ABI.
- Redeploy to Sepolia.
- Add the new contract as a Chainlink VRF consumer.
- Update `VITE_SUPER_LOTTERY_ADDRESS`.
- Restart the frontend.

Existing deployed contracts will not use the new reward model.
