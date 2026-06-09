# Weighted Prize Allocation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace fixed tier percentage payouts with dynamic weighted prize allocation using off-chain probability weights, `a = 0.3`, tier pool caps, per-winner caps, and rollover of all unpaid funds.

**Architecture:** The contract keeps the existing ticket, draw, registration, and claim lifecycle. `PrizeTier` changes from fixed `poolBps` to `weight`, `maxPoolBps`, and `maxPrizePerWinner`. During `closeRegistration`, only tiers with registered winners participate in allocation. Each participating tier receives a share based on `tier.weight * winnerCount`, then both caps are applied. `tierPrizePerWinner` remains the claim source, and unpaid funds roll into `rolloverReserve`.

**Tech Stack:** Solidity 0.8.24, Hardhat 3, Node test runner, React/Vite, ethers v6, existing SuperLottery multi-game contract.

---

## File Structure

- `scripts/calculate-tier-weights.js`: add deterministic helper to calculate and print initial tier weights from tier probabilities using `a = 0.3` and `scale = 1_000_000`.
- `contracts/SuperLottery.sol`: change `PrizeTier`, game tier configuration, and `closeRegistration` payout logic.
- `test/SuperLottery.test.js`: replace fixed `poolBps` assertions with dynamic weight/cap assertions and add weighted allocation tests.
- `src/lottery.js`: replace static pool percentage metadata with weight/cap-oriented tier display metadata.
- `src/App.jsx`: update prize tier table labels to display weight, max pool cap, max prize, winners, and prize per winner.
- `README.md`: document weighted allocation and redeployment requirement.
- `src/abi/SuperLottery.json`: regenerate after contract changes.

---

## Probability Convention

Tier weights are fixed per game and tier, but some games allow repeated ordered digits. For fixed contract weights, calculate tier probabilities as:

```text
probability = probability that a uniformly random valid single ticket resolves to this tier
              against a uniformly random valid draw for that game
```

This produces one stable probability per tier. The contract does not assign different weights to different ticket shapes.

For Lotto-style unique unordered areas, use exact combinatorics by resolved tier. For ordered/repeated games, use deterministic closed-form probabilities in the helper script and document each probability expression next to the generated weight. The contract implementation must depend only on the final integer weights printed by the helper.

The implementation must check and print whether weights are monotonic by tier ID:

```text
tier 1 weight > tier 2 weight > tier 3 weight ...
```

This check is diagnostic only. The source of truth is actual resolved-tier probability. If a lower-numbered tier is more common than a higher-numbered tier under current game rules, the higher-numbered tier can receive a larger weight unless the game rules are redesigned.

---

### Task 1: Add Weight Calculation Helper

**Files:**
- Add: `scripts/calculate-tier-weights.js`
- Modify: `package.json`

- [ ] **Step 1: Add script**

Create `scripts/calculate-tier-weights.js` that:

- Defines `COMPRESSION = 0.3`.
- Defines `WEIGHT_SCALE = 1_000_000`.
- Exposes `weightFromProbability(probability)`.
- Prints tier probabilities and integer weights for all five games.

Use:

```js
function weightFromProbability(probability) {
  return Math.round(Math.pow(1 / probability, 0.3) * 1_000_000);
}
```

- [ ] **Step 2: Add npm script**

In `package.json`, add:

```json
"weights": "node scripts/calculate-tier-weights.js"
```

- [ ] **Step 3: Include exact Lotto weights**

The helper should produce these Lotto values:

```text
Tier 1: 158226995
Tier 2: 64412711
Tier 3: 50502959
Tier 4: 35192750
Tier 5: 14326635
```

These come from resolved tier probabilities:

```text
total = C(35, 5) * C(12, 2) = 21,425,712
T1 = 1 / total
T2 = 20 / total
T3 = 45 / total
T4 = 150 / total
T5 = 3000 / total
```

- [ ] **Step 4: Run helper**

Run:

```bash
npm run weights
```

Expected: all games print tier probabilities and weights. If a game is not monotonic by tier ID, the output flags it and the implementation keeps the probability-derived weights.

---

### Task 2: Contract Red Tests

**Files:**
- Modify: `test/SuperLottery.test.js`

- [ ] **Step 1: Replace tier config assertions**

Update `assertTierConfig` to assert:

```js
assert.equal(tier.tierId, BigInt(expected.tierId));
assert.equal(tier.mainMatch, BigInt(expected.mainMatch));
assert.equal(tier.extraMatch, BigInt(expected.extraMatch));
assert.equal(tier.weight, BigInt(expected.weight));
assert.equal(tier.maxPoolBps, BigInt(expected.maxPoolBps));
assert.equal(tier.maxPrizePerWinner, expected.maxPrizePerWinner);
```

Remove `poolBps` assertions.

- [ ] **Step 2: Add weighted split test**

Add a test where Lotto tier 1 and tier 5 both have winners, with enough prize pool that caps do not bind. Use `deployLotteryWithTicketPrice(1_000_000_000_000_000_000n)` and buy enough non-winning filler tickets to create a large pool without changing winner counts.

Expected:

```text
effectiveWeight1 = tier1.weight * tier1Winners
effectiveWeight5 = tier5.weight * tier5Winners
prize1 = availablePool * effectiveWeight1 / totalEffectiveWeight / tier1Winners
prize5 = availablePool * effectiveWeight5 / totalEffectiveWeight / tier5Winners
prize1 > prize5
```

- [ ] **Step 3: Add maxPoolBps cap test**

Create a Lotto round where only a low-tier winner registers.

Expected:

```text
tierPrizePerWinner <= availablePool * tier.maxPoolBps / 10000
rolloverReserve includes the capped overflow
```

This covers the user requirement that a single fifth-prize winner cannot take the whole pool.

- [ ] **Step 4: Add maxPrizePerWinner cap test**

Use `deployLotteryWithTicketPrice(1_000_000_000_000_000_000n)` and buy enough non-winning filler tickets so the raw tier allocation exceeds `maxPrizePerWinner`.

Expected:

```text
tierPrizePerWinner == tier.maxPrizePerWinner
round.reserveRollover == round.prizePool - tier.maxPrizePerWinner * winnerCount
```

- [ ] **Step 5: Add no-winner rollover test**

Buy tickets, draw numbers that produce no registered winners, then call `closeRegistration`.

Expected:

```text
round.reserveRollover == round.prizePool
rolloverReserve(gameType) == round.prizePool
```

- [ ] **Step 6: Update old fixed-percentage tests**

Replace these current expectations:

```js
ticketPrice * 5000n / 10000n
```

with dynamic helper calculations from tier weights and caps.

- [ ] **Step 7: Run tests and verify red failure**

Run:

```bash
npm test
```

Expected: FAIL because `PrizeTier` still exposes `poolBps` and `closeRegistration` still uses fixed percentage settlement.

---

### Task 3: Implement Contract Weighted Allocation

**Files:**
- Modify: `contracts/SuperLottery.sol`

- [ ] **Step 1: Update `PrizeTier`**

Replace:

```solidity
uint16 poolBps;
```

with:

```solidity
uint256 weight;
uint16 maxPoolBps;
uint256 maxPrizePerWinner;
```

- [ ] **Step 2: Add cap constants**

Add helper constants:

```solidity
uint16 private constant TIER_1_MAX_POOL_BPS = 8000;
uint16 private constant TIER_2_MAX_POOL_BPS = 5000;
uint16 private constant TIER_3_MAX_POOL_BPS = 3000;
uint16 private constant TIER_4_MAX_POOL_BPS = 1500;
uint16 private constant TIER_5_MAX_POOL_BPS = 800;

uint256 private constant TIER_1_MAX_PRIZE_MULTIPLIER = 1000;
uint256 private constant TIER_2_MAX_PRIZE_MULTIPLIER = 300;
uint256 private constant TIER_3_MAX_PRIZE_MULTIPLIER = 100;
uint256 private constant TIER_4_MAX_PRIZE_MULTIPLIER = 30;
uint256 private constant TIER_5_MAX_PRIZE_MULTIPLIER = 10;
```

- [ ] **Step 3: Update `_addPrizeTier`**

Change signature to:

```solidity
function _addPrizeTier(
    uint8 gameType,
    uint8 tierId,
    uint8 mainMatch,
    uint8 extraMatch,
    uint256 weight,
    uint16 maxPoolBps,
    uint256 maxPrizePerWinner,
    bool rollIfNoWinner
) private
```

- [ ] **Step 4: Hardcode calculated weights**

Replace all tier configuration calls with calculated integer weights from `npm run weights`.

For Lotto, use:

```solidity
_addPrizeTier(GAME_LOTTO, 1, 5, 2, 158226995, 8000, ticketPrice * 1000, true);
_addPrizeTier(GAME_LOTTO, 2, 5, 1, 64412711, 5000, ticketPrice * 300, true);
_addPrizeTier(GAME_LOTTO, 3, 5, 0, 50502959, 3000, ticketPrice * 100, true);
_addPrizeTier(GAME_LOTTO, 4, 4, 2, 35192750, 1500, ticketPrice * 30, true);
_addPrizeTier(GAME_LOTTO, 5, 4, 1, 14326635, 800, ticketPrice * 10, true);
```

Use the same cap sequence for other games from highest to lowest tier.

- [ ] **Step 5: Rewrite `closeRegistration`**

Implementation shape:

```solidity
uint256 reservePool = (round.prizePool * reserveBps[gameType]) / BPS_DENOMINATOR;
uint256 availablePool = round.prizePool - reservePool;
uint256 totalEffectiveWeight = 0;

for each tier:
    winners = tierWinnerCounts[gameType][roundId][tier.tierId]
    if winners > 0:
        totalEffectiveWeight += tier.weight * winners

if totalEffectiveWeight == 0:
    round.reserveRollover = round.prizePool;
    rolloverReserve[gameType] += round.prizePool;
    round.status = RoundStatus.Claimable;
    emit RegistrationClosed(...)
    return;

uint256 totalPaid = 0;

for each tier with winners:
    effectiveWeight = tier.weight * winners
    rawTierPool = (availablePool * effectiveWeight) / totalEffectiveWeight
    tierCap = (availablePool * tier.maxPoolBps) / BPS_DENOMINATOR
    cappedTierPool = _min(rawTierPool, tierCap)
    prizePerWinner = cappedTierPool / winners
    prizePerWinner = _min(prizePerWinner, tier.maxPrizePerWinner)
    tierPrizePerWinner[gameType][roundId][tier.tierId] = prizePerWinner
    totalPaid += prizePerWinner * winners

round.reserveRollover = round.prizePool - totalPaid
rolloverReserve[gameType] += round.reserveRollover
round.status = RoundStatus.Claimable
```

- [ ] **Step 6: Add `_min` helper**

Add:

```solidity
function _min(uint256 a, uint256 b) private pure returns (uint256) {
    return a < b ? a : b;
}
```

- [ ] **Step 7: Run tests**

Run:

```bash
npm test
```

Expected: PASS after all weighted allocation assertions are updated.

---

### Task 4: Frontend Prize Tier Display

**Files:**
- Modify: `src/lottery.js`
- Modify: `src/App.jsx`
- Modify: `src/App.css`

- [ ] **Step 1: Update frontend tier metadata**

Replace `pool` display strings with cap-oriented display labels:

```js
{ id: 1, label: "...", capLabel: "Max pool 80%", maxPrizeLabel: "1000x ticket" }
```

Remove `poolBps` from frontend static metadata unless it is repurposed as `maxPoolBps`.

- [ ] **Step 2: Update `TierTable`**

Display columns:

```text
Tier
Max Pool
Max Prize
Weight
Winners
Prize / Winner
```

For runtime values, read `gamePrizeTiers(gameType, index)` and include:

```js
weight
maxPoolBps
maxPrizePerWinner
```

Current `tierStats` should expand from:

```js
{ winners, prize }
```

to:

```js
{ winners, prize, weight, maxPoolBps, maxPrizePerWinner }
```

- [ ] **Step 3: Keep UI responsive**

Update CSS grid columns so long wei/ETH strings wrap cleanly on mobile.

- [ ] **Step 4: Run frontend build**

Run:

```bash
npm run build
```

Expected: PASS.

---

### Task 5: Documentation, ABI, and Final Verification

**Files:**
- Modify: `README.md`
- Regenerate: `src/abi/SuperLottery.json`

- [ ] **Step 1: Document weighted allocation**

Add a README section:

- `a = 0.3` is used off-chain.
- Contract stores integer weights.
- Rewards use `weight * winnerCount`.
- Each tier has max pool and max prize caps.
- Unpaid funds roll over.

- [ ] **Step 2: Regenerate ABI**

Run:

```bash
npm run copy:abi
```

- [ ] **Step 3: Full verification**

Run:

```bash
npm test
npm run build
```

Expected:

- Contract tests pass.
- Frontend build passes.
- ABI includes `weight`, `maxPoolBps`, and `maxPrizePerWinner` in `gamePrizeTiers` getter output.

- [ ] **Step 4: Deployment warning**

Final response must state:

- This is a contract-breaking change.
- Sepolia contract must be redeployed.
- New contract must be added as Chainlink VRF consumer.
- `.env` `VITE_SUPER_LOTTERY_ADDRESS` must be updated.

---

## Known Risks

- Hardhat currently tries to download `solc 0.8.24` because scripts set `XDG_CACHE_HOME=/tmp`. If offline compile blocks implementation, add a separate package script for frontend-only dev and consider moving `XDG_CACHE_HOME` to a persistent project cache.
- For ordered/repeated games, fixed tier weights are based on average random-ticket probabilities, not per-ticket dynamic probabilities. This is intentional for gas and simplicity.
- `maxPrizePerWinner` uses `ticketPrice` multiples. Tests that verify capped positive payouts must use `deployLotteryWithTicketPrice(1_000_000_000_000_000_000n)`.
