# Lotto System Betting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Lotto-only small system betting with a 100-entry cap, expanded normal tickets, total price display, and frontend probability estimates.

**Architecture:** The contract adds one Lotto-only purchase function that validates a larger Lotto selection, calculates `C(mainCount, 5) * C(extraCount, 2)`, charges `entryCount * ticketPrice`, and expands combinations into existing normal `Ticket` storage. The frontend adds Lotto-only system mode and computes combination counts/probabilities locally; existing ticket registration and claiming remain unchanged.

**Tech Stack:** Solidity 0.8.24, Hardhat 3, Node test runner, React/Vite, ethers v6, existing multi-game SuperLottery contract.

---

## File Structure

- `contracts/SuperLottery.sol`: add Lotto system purchase errors, summary event, max-entry constant, combination-count helper, unique range validation helper for system selections, and combination expansion into normal tickets.
- `test/SuperLottery.test.js`: add red tests for Lotto system purchase, pricing, limit, invalid input, sales cutoff, and normal ticket expansion.
- `src/lottery.js`: add Lotto system helper functions for combinations, entry count, probabilities, and formatting; add Lotto `system.maxEntries = 100` metadata.
- `src/App.jsx`: add Lotto-only single/system mode, system pick limits, system summary/probability UI, and `buyLottoSystemTicket` transaction path.
- `src/App.css`: add compact mode controls and system summary/probability layout styles.
- `README.md`: document Lotto system betting, 100-entry cap, and redeployment requirement.
- `src/abi/SuperLottery.json`: regenerated after contract changes.

---

### Task 1: Contract Red Tests for Lotto System Betting

**Files:**
- Modify: `test/SuperLottery.test.js`

- [ ] **Step 1: Add constants and helpers**

Near existing game constants, add:

```js
const MAX_LOTTO_SYSTEM_ENTRIES = 100n;
```

Near existing helper functions, add:

```js
function combination(n, k) {
  if (k < 0 || n < k) return 0n;
  let result = 1n;
  for (let i = 1; i <= k; i++) {
    result = result * BigInt(n - k + i) / BigInt(i);
  }
  return result;
}

function lottoSystemEntryCount(mainCount, extraCount) {
  return combination(mainCount, 5) * combination(extraCount, 2);
}
```

- [ ] **Step 2: Add successful expansion test**

Inside the main describe block, add:

```js
it("buys a Lotto system ticket by expanding into normal tickets", async () => {
  const { lottery, alice, ticketPrice } = await deployLottery();
  const main = [1, 2, 3, 4, 5, 6];
  const extra = [1, 2, 3];
  const entryCount = lottoSystemEntryCount(main.length, extra.length);
  const firstTicketId = await lottery.getRoundTicketCount(GAME_LOTTO, 1);

  await lottery.connect(alice).buyLottoSystemTicket(main, extra, { value: ticketPrice * entryCount });

  assert.equal(entryCount, 18n);
  assert.equal(await lottery.getRoundTicketCount(GAME_LOTTO, 1), firstTicketId + entryCount);

  const round = await lottery.getRound(GAME_LOTTO, 1);
  assert.equal(round.prizePool, ticketPrice * entryCount);

  const firstTicket = await lottery.getTicket(GAME_LOTTO, 1, Number(firstTicketId));
  assert.equal(firstTicket.buyer, alice.address);
  assert.equal(firstTicket.gameType, BigInt(GAME_LOTTO));
  assert.deepEqual(numbers(firstTicket.mainNumbers), [1, 2, 3, 4, 5]);
  assert.deepEqual(numbers(firstTicket.extraNumbers), [1, 2]);

  const lastTicket = await lottery.getTicket(GAME_LOTTO, 1, Number(firstTicketId + entryCount - 1n));
  assert.deepEqual(numbers(lastTicket.mainNumbers), [2, 3, 4, 5, 6]);
  assert.deepEqual(numbers(lastTicket.extraNumbers), [2, 3]);
});
```

- [ ] **Step 3: Add pricing and limit tests**

Add:

```js
it("requires exact payment for Lotto system entries", async () => {
  const { lottery, alice, ticketPrice } = await deployLottery();
  const main = [1, 2, 3, 4, 5, 6];
  const extra = [1, 2, 3];
  const entryCount = lottoSystemEntryCount(main.length, extra.length);

  await assert.rejects(
    lottery.connect(alice).buyLottoSystemTicket(main, extra, { value: ticketPrice * entryCount - 1n }),
    /InvalidTicketPrice/
  );
});

it("rejects Lotto system selections above the entry limit", async () => {
  const { lottery, alice, ticketPrice } = await deployLottery();
  const main = [1, 2, 3, 4, 5, 6, 7, 8];
  const extra = [1, 2, 3];
  const entryCount = lottoSystemEntryCount(main.length, extra.length);

  assert.ok(entryCount > MAX_LOTTO_SYSTEM_ENTRIES);
  await assert.rejects(
    lottery.connect(alice).buyLottoSystemTicket(main, extra, { value: ticketPrice * entryCount }),
    /TooManySystemEntries/
  );
});
```

- [ ] **Step 4: Add invalid input tests**

Add:

```js
it("rejects invalid Lotto system selections", async () => {
  const { lottery, alice, ticketPrice } = await deployLottery();

  await assert.rejects(
    lottery.connect(alice).buyLottoSystemTicket([1, 2, 3, 4], [1, 2], { value: ticketPrice }),
    /InvalidSystemMainNumberCount/
  );
  await assert.rejects(
    lottery.connect(alice).buyLottoSystemTicket([1, 2, 3, 4, 5], [1], { value: ticketPrice }),
    /InvalidSystemExtraNumberCount/
  );
  await assert.rejects(
    lottery.connect(alice).buyLottoSystemTicket([1, 1, 2, 3, 4, 5], [1, 2], { value: ticketPrice * 6n }),
    /DuplicateNumber/
  );
  await assert.rejects(
    lottery.connect(alice).buyLottoSystemTicket([1, 2, 3, 4, 36], [1, 2], { value: ticketPrice }),
    /InvalidMainNumber/
  );
  await assert.rejects(
    lottery.connect(alice).buyLottoSystemTicket([1, 2, 3, 4, 5], [1, 13], { value: ticketPrice }),
    /InvalidExtraNumber/
  );
});
```

- [ ] **Step 5: Add sales cutoff test**

Add:

```js
it("rejects Lotto system purchases after the sales close time", async () => {
  const { lottery, alice, ticketPrice } = await deployLottery();
  const round = await lottery.getRound(GAME_LOTTO, 1);
  requireRoundTiming(round);

  await setNextBlockTimestamp(round.closeTime);
  await assert.rejects(
    lottery.connect(alice).buyLottoSystemTicket([1, 2, 3, 4, 5], [1, 2], { value: ticketPrice }),
    /RoundSalesClosed/
  );
});
```

- [ ] **Step 6: Run tests and verify red failure**

Run:

```bash
npm test
```

Expected: FAIL because `buyLottoSystemTicket` and `TooManySystemEntries` do not exist yet. Existing tests should still pass before the new tests run.

---

### Task 2: Implement Lotto System Contract Purchase

**Files:**
- Modify: `contracts/SuperLottery.sol`
- Modify: `test/SuperLottery.test.js`

- [ ] **Step 1: Add errors, constant, and event**

In `contracts/SuperLottery.sol`, add errors:

```solidity
error InvalidSystemMainNumberCount();
error InvalidSystemExtraNumberCount();
error TooManySystemEntries();
```

Add constant:

```solidity
uint256 private constant MAX_LOTTO_SYSTEM_ENTRIES = 100;
```

Add event near `TicketBought`:

```solidity
event LottoSystemTicketBought(
    uint256 indexed roundId,
    address indexed buyer,
    uint256 firstTicketId,
    uint256 entryCount
);
```

- [ ] **Step 2: Add `buyLottoSystemTicket`**

After `buyTicket`, add:

```solidity
function buyLottoSystemTicket(
    uint8[] calldata mainNumbers,
    uint8[] calldata extraNumbers
) external payable returns (uint256 firstTicketId, uint256 entryCount) {
    GameConfig storage config = _gameConfig(GAME_LOTTO);
    uint256 roundId = currentRoundId[GAME_LOTTO];
    Round storage round = rounds[GAME_LOTTO][roundId];
    if (round.status != RoundStatus.Open) revert RoundNotOpen();
    if (block.timestamp < round.openTime) revert RoundNotStarted();
    if (block.timestamp >= round.closeTime) revert RoundSalesClosed();
    if (mainNumbers.length < config.main.pickCount) revert InvalidSystemMainNumberCount();
    if (extraNumbers.length < config.extra.pickCount) revert InvalidSystemExtraNumberCount();

    uint8[] memory normalizedMain = _validateSystemArea(mainNumbers, config.main, true);
    uint8[] memory normalizedExtra = _validateSystemArea(extraNumbers, config.extra, false);

    entryCount = _combination(normalizedMain.length, config.main.pickCount)
        * _combination(normalizedExtra.length, config.extra.pickCount);
    if (entryCount > MAX_LOTTO_SYSTEM_ENTRIES) revert TooManySystemEntries();
    if (msg.value != ticketPrice * entryCount) revert InvalidTicketPrice();

    firstTicketId = gameTickets[GAME_LOTTO][roundId].length;
    for (uint256 a = 0; a < normalizedMain.length - 4; a++) {
        for (uint256 b = a + 1; b < normalizedMain.length - 3; b++) {
            for (uint256 c = b + 1; c < normalizedMain.length - 2; c++) {
                for (uint256 d = c + 1; d < normalizedMain.length - 1; d++) {
                    for (uint256 e = d + 1; e < normalizedMain.length; e++) {
                        uint8[] memory mainCombo = new uint8[](5);
                        mainCombo[0] = normalizedMain[a];
                        mainCombo[1] = normalizedMain[b];
                        mainCombo[2] = normalizedMain[c];
                        mainCombo[3] = normalizedMain[d];
                        mainCombo[4] = normalizedMain[e];

                        for (uint256 x = 0; x < normalizedExtra.length - 1; x++) {
                            for (uint256 y = x + 1; y < normalizedExtra.length; y++) {
                                uint8[] memory extraCombo = new uint8[](2);
                                extraCombo[0] = normalizedExtra[x];
                                extraCombo[1] = normalizedExtra[y];
                                _storeTicket(GAME_LOTTO, roundId, msg.sender, mainCombo, extraCombo);
                            }
                        }
                    }
                }
            }
        }
    }

    round.prizePool += msg.value;
    emit LottoSystemTicketBought(roundId, msg.sender, firstTicketId, entryCount);
}
```

- [ ] **Step 3: Extract normal ticket storage helper**

Replace the storage block in `buyTicket` with:

```solidity
ticketId = gameTickets[gameType][roundId].length;
_storeTicket(gameType, roundId, msg.sender, normalizedMain, normalizedExtra);
round.prizePool += msg.value;
emit TicketBought(gameType, roundId, ticketId, msg.sender);
```

Add private helper:

```solidity
function _storeTicket(
    uint8 gameType,
    uint256 roundId,
    address buyer,
    uint8[] memory mainNumbers,
    uint8[] memory extraNumbers
) private {
    uint256 ticketId = gameTickets[gameType][roundId].length;
    Ticket storage ticket = gameTickets[gameType][roundId].push();
    ticket.buyer = buyer;
    ticket.gameType = gameType;
    ticket.claimed = false;
    ticket.mainNumbers = mainNumbers;
    ticket.extraNumbers = extraNumbers;

    emit TicketBought(gameType, roundId, ticketId, buyer);
}
```

- [ ] **Step 4: Add validation and combination helpers**

Add:

```solidity
function _validateSystemArea(
    uint8[] calldata input,
    AreaConfig memory config,
    bool isMain
) private pure returns (uint8[] memory numbers) {
    numbers = new uint8[](input.length);
    for (uint256 i = 0; i < input.length; i++) {
        if (input[i] < config.minNumber || input[i] > config.maxNumber) {
            if (isMain) revert InvalidMainNumber();
            revert InvalidExtraNumber();
        }
        numbers[i] = input[i];
    }
    _sort(numbers);
    for (uint256 i = 1; i < numbers.length; i++) {
        if (numbers[i] == numbers[i - 1]) revert DuplicateNumber();
    }
}

function _combination(uint256 n, uint256 k) private pure returns (uint256) {
    if (k > n) return 0;
    uint256 result = 1;
    for (uint256 i = 1; i <= k; i++) {
        result = (result * (n - k + i)) / i;
    }
    return result;
}
```

- [ ] **Step 5: Run tests**

Run:

```bash
npm test
```

Expected: PASS. The new Lotto system tests and all existing tests pass.

---

### Task 3: Frontend Lotto System Helper Functions

**Files:**
- Modify: `src/lottery.js`

- [ ] **Step 1: Add Lotto system metadata**

In Lotto game definition, add:

```js
system: { maxEntries: 100 }
```

- [ ] **Step 2: Add combination and probability helpers**

After `randomPickForArea`, add:

```js
export const LOTTO_TOTAL_COMBINATIONS = 21425712;

export function combination(n, k) {
  if (k < 0 || n < k) return 0;
  let result = 1;
  for (let i = 1; i <= k; i++) {
    result = result * (n - k + i) / i;
  }
  return Math.round(result);
}

export function getLottoSystemEntryCount(mainCount, extraCount) {
  return combination(mainCount, 5) * combination(extraCount, 2);
}

export function getLottoFirstPrizeProbability(entryCount) {
  return entryCount > 0 ? entryCount / LOTTO_TOTAL_COMBINATIONS : 0;
}

function drawStateProbability(selected, total, draw, hits) {
  return (
    combination(selected, hits)
    * combination(total - selected, draw - hits)
    / combination(total, draw)
  );
}

function tierMatches(tierId, mainSelected, extraSelected, mainHits, extraHits) {
  if (tierId === 1) return mainHits >= 5 && extraHits >= 2;
  if (tierId === 2) return mainHits >= 5 && extraHits >= 1 && extraSelected - extraHits >= 1;
  if (tierId === 3) return mainHits >= 5 && extraSelected - extraHits >= 2;
  if (tierId === 4) return mainHits >= 4 && mainSelected - mainHits >= 1 && extraHits >= 2;
  if (tierId === 5) return mainHits >= 4 && mainSelected - mainHits >= 1 && extraHits >= 1 && extraSelected - extraHits >= 1;
  return false;
}

export function getLottoTierProbabilities(mainCount, extraCount) {
  const tiers = [1, 2, 3, 4, 5];
  const probabilities = Object.fromEntries(tiers.map((tier) => [tier, 0]));
  let listedPrize = 0;

  for (let mainHits = 0; mainHits <= 5; mainHits++) {
    for (let extraHits = 0; extraHits <= 2; extraHits++) {
      const probability = drawStateProbability(mainCount, 35, 5, mainHits)
        * drawStateProbability(extraCount, 12, 2, extraHits);
      const matchedTiers = tiers.filter((tier) => tierMatches(tier, mainCount, extraCount, mainHits, extraHits));
      if (matchedTiers.length > 0) {
        listedPrize += probability;
        for (const tier of matchedTiers) {
          probabilities[tier] += probability;
        }
      }
    }
  }

  return { tiers: probabilities, listedPrize };
}

export function formatProbability(probability) {
  if (!Number.isFinite(probability) || probability <= 0) {
    return { odds: "-", percent: "0%" };
  }
  const odds = Math.max(1, Math.round(1 / probability)).toLocaleString();
  const percent = `${(probability * 100).toPrecision(4)}%`;
  return { odds: `1 in ${odds}`, percent };
}
```

- [ ] **Step 3: Build**

Run:

```bash
npm run build
```

Expected: PASS.

---

### Task 4: Frontend Lotto System UI

**Files:**
- Modify: `src/App.jsx`
- Modify: `src/App.css`

- [ ] **Step 1: Import helper functions**

Add imports from `./lottery.js`:

```js
formatProbability,
getLottoFirstPrizeProbability,
getLottoSystemEntryCount,
getLottoTierProbabilities
```

- [ ] **Step 2: Add mode state and derived values**

Inside `App`, add:

```js
const [betMode, setBetMode] = useState("single");
```

Add derived values:

```js
const isLotto = selectedGameType === 2;
const isSystemMode = isLotto && betMode === "system";
const systemEntryCount = isSystemMode ? getLottoSystemEntryCount(mainNumbers.length, extraNumbers.length) : 1;
const systemTooLarge = isSystemMode && systemEntryCount > selectedGame.system.maxEntries;
const totalTicketPrice = ticketPrice * BigInt(systemEntryCount || 0);
const firstPrizeProbability = formatProbability(getLottoFirstPrizeProbability(systemEntryCount));
const singleFirstPrizeProbability = formatProbability(getLottoFirstPrizeProbability(1));
const lottoTierProbabilities = isSystemMode
  ? getLottoTierProbabilities(mainNumbers.length, extraNumbers.length)
  : getLottoTierProbabilities(5, 2);
```

Update game-change effect:

```js
setBetMode("single");
```

- [ ] **Step 3: Allow larger Lotto picks in system mode**

Create system picker area configs:

```js
const mainPickArea = isSystemMode ? { ...selectedGame.main, pick: selectedGame.main.max } : selectedGame.main;
const extraPickArea = isSystemMode && selectedGame.extra ? { ...selectedGame.extra, pick: selectedGame.extra.max } : selectedGame.extra;
```

Pass `mainPickArea` and `extraPickArea` to `AreaPicker` in system mode, but keep formatting against the real game area where needed.

- [ ] **Step 4: Update canBuy and transaction**

Update `canBuy`:

```js
const hasRequiredNumbers = isSystemMode
  ? mainNumbers.length >= selectedGame.main.pick && extraNumbers.length >= selectedGame.extra.pick
  : mainNumbers.length === selectedGame.main.pick && (!selectedGame.extra || extraNumbers.length === selectedGame.extra.pick);
const canBuy = round?.status === 0 && !salesClosedByTime && hasRequiredNumbers && !systemTooLarge;
```

Update `buyTicket`:

```js
const value = isSystemMode ? totalTicketPrice : ticketPrice;
await transact(
  (contract) => isSystemMode
    ? contract.buyLottoSystemTicket(mainNumbers, extraNumbers, { value })
    : contract.buyTicket(selectedGameType, mainNumbers, extraNumbers, { value }),
  isSystemMode ? "System tickets bought." : "Ticket bought."
);
```

- [ ] **Step 5: Render mode control and system summary**

Above the pickers, render only for Lotto:

```jsx
{isLotto && (
  <div className="mode-control" role="group" aria-label="Lotto betting mode">
    <button type="button" className={betMode === "single" ? "active" : ""} onClick={() => setBetMode("single")}>Single</button>
    <button type="button" className={betMode === "system" ? "active" : ""} onClick={() => setBetMode("system")}>System</button>
  </div>
)}
```

Near the buy button, render system summary in Lotto system mode:

```jsx
{isSystemMode && (
  <div className="system-summary">
    <div><span className="label">Entries</span><strong>{systemEntryCount}</strong></div>
    <div><span className="label">Total Price</span><strong>{ethers.formatEther(totalTicketPrice)} ETH</strong></div>
    <div><span className="label">First Prize</span><strong>{firstPrizeProbability.odds}</strong><small>{firstPrizeProbability.percent}</small></div>
    <div><span className="label">Single First Prize</span><strong>{singleFirstPrizeProbability.odds}</strong><small>{singleFirstPrizeProbability.percent}</small></div>
    <div><span className="label">Listed Prize</span><strong>{formatProbability(lottoTierProbabilities.listedPrize).odds}</strong><small>{formatProbability(lottoTierProbabilities.listedPrize).percent}</small></div>
  </div>
)}
{systemTooLarge && (
  <p className="warning">Current selection expands to {systemEntryCount} entries. The single-transaction limit is {selectedGame.system.maxEntries} entries.</p>
)}
```

Also show tier probabilities:

```jsx
{isSystemMode && (
  <div className="probability-grid">
    {selectedGame.tiers.filter((tier) => tier.id > 0).map((tier) => {
      const probability = formatProbability(lottoTierProbabilities.tiers[tier.id] || 0);
      return (
        <div key={tier.id}>
          <span>{tier.label}</span>
          <strong>{probability.odds}</strong>
          <small>{probability.percent}</small>
        </div>
      );
    })}
  </div>
)}
```

- [ ] **Step 6: Add CSS**

In `src/App.css`, add:

```css
.mode-control {
  display: inline-flex;
  gap: 4px;
  border: 1px solid #c7d0ca;
  border-radius: 8px;
  padding: 4px;
  background: #f6f8f6;
  margin-bottom: 16px;
}

.mode-control button {
  border: 0;
  min-height: 32px;
  background: transparent;
}

.mode-control button.active {
  background: #17201b;
  color: #ffffff;
}

.system-summary,
.probability-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 1px;
  overflow: hidden;
  border: 1px solid #d9dfdb;
  border-radius: 8px;
  background: #d9dfdb;
  margin-top: 14px;
}

.system-summary > div,
.probability-grid > div {
  min-width: 0;
  background: #ffffff;
  padding: 12px;
}

.system-summary strong,
.probability-grid strong,
.system-summary small,
.probability-grid small {
  display: block;
  margin-top: 4px;
  overflow-wrap: anywhere;
}

.warning {
  margin-top: 12px;
  color: #9f2f24;
  font-weight: 700;
}
```

In mobile media query:

```css
.system-summary,
.probability-grid {
  grid-template-columns: 1fr;
}
```

- [ ] **Step 7: Build**

Run:

```bash
npm run build
```

Expected: PASS.

---

### Task 5: README, ABI, and Final Verification

**Files:**
- Modify: `README.md`
- Modify: `src/abi/SuperLottery.json`

- [ ] **Step 1: Regenerate ABI**

Run:

```bash
npm run compile
npm run copy:abi
```

Expected: ABI copied and includes `buyLottoSystemTicket`.

- [ ] **Step 2: Update README**

Add:

```markdown
## Lotto System Betting

Lotto supports a small system betting mode. Users can select more than the standard `5 + 2` numbers, and the app expands the selection into normal Lotto tickets in one transaction.

Entry count:

```text
C(mainCount, 5) * C(extraCount, 2)
```

The single-transaction limit is `100` entries. The contract charges:

```text
entryCount * ticketPrice
```

Expanded entries are stored as normal tickets, so existing registration and claim flows continue to work. Probability estimates are displayed in the frontend only and do not affect contract logic.
```

- [ ] **Step 3: Full verification**

Run:

```bash
npm test
npm run build
```

Expected: tests pass and build passes. Chunk-size warning is acceptable.

- [ ] **Step 4: Dev server smoke check**

Run:

```bash
npm run dev -- --host 127.0.0.1
curl -I http://127.0.0.1:5173/
```

Expected: Vite starts and HTTP response is `200 OK`.

---

## Self-Review

- Spec coverage: The plan covers Lotto-only system betting, 100-entry cap, normal ticket expansion, exact payment, validation errors, per-tier probability display, listed-prize probability, frontend mode switching, README, ABI, and final verification.
- Scope control: Other games remain unchanged. Compressed large-system-ticket storage remains out of scope.
- Placeholder scan: No placeholders or unresolved TODOs remain.
- Type consistency: Contract function is `buyLottoSystemTicket(uint8[],uint8[])`; frontend calls the same function. Entry counts are integers in frontend and `uint256` in Solidity.
