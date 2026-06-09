# Daily UTC Rounds and History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add UTC daily sales windows, owner-only post-cutoff draw flow, and recent historical draw records to the multi-game Super Lottery DApp.

**Architecture:** The contract remains the source of truth for round timing using UTC Unix timestamps from `block.timestamp`. Each `Round` stores `openTime`, `closeTime`, and `drawTime`; frontend helpers format those timestamps into UTC date, weekday, close time, and countdown labels. History is loaded client-side by querying recent round IDs with the existing `getRound(gameType, roundId)` view.

**Tech Stack:** Solidity 0.8.24, Hardhat 3, Chainlink VRF v2.5, Node test runner, React/Vite, ethers v6, GSAP already present for UI feedback.

---

## File Structure

- `contracts/SuperLottery.sol`: add daily UTC timing fields, time errors, midnight calculation helpers, buy/close time gates, draw time recording, and next-round window calculation.
- `test/SuperLottery.test.js`: add time-based contract tests using Hardhat network helpers already installed in the project.
- `src/lottery.js`: add UTC formatting and countdown helper functions while preserving existing game definitions and contract helpers.
- `src/App.jsx`: parse new round timing fields, display current UTC round metadata and countdown, disable buying after close time, and load recent history for the selected game.
- `src/App.css`: add layout styles for time metadata and history records without changing the current visual structure.
- `README.md`: update lifecycle and deployment notes for UTC daily rounds.
- `src/abi/SuperLottery.json`: regenerated through `npm run copy:abi` after contract compilation.

---

### Task 1: Contract Red Tests for UTC Daily Rounds

**Files:**
- Modify: `test/SuperLottery.test.js`

- [ ] **Step 1: Import time helpers**

At the top of `test/SuperLottery.test.js`, add:

```js
import { time } from "@nomicfoundation/hardhat-network-helpers";
```

Keep existing imports intact.

- [ ] **Step 2: Add test helpers near existing helper functions**

Add these helpers after the existing numeric helper functions:

```js
const DAY = 24n * 60n * 60n;

function nextUtcMidnight(timestamp) {
  const value = BigInt(timestamp);
  return ((value / DAY) + 1n) * DAY;
}

async function latestTimestamp() {
  return BigInt(await time.latest());
}

async function moveTo(timestamp) {
  await time.increaseTo(Number(timestamp));
}
```

- [ ] **Step 3: Add constructor timing test**

Inside the `describe("SuperLottery multi-game prize pools", ...)` block, add:

```js
test("initializes each game round with UTC daily timing", async () => {
  const { lottery } = await deployLottery();
  const now = await latestTimestamp();

  for (const gameType of [GAME_DIGITAL, GAME_NUMBER_LOTTO, GAME_LOTTO, GAME_BASE_LOTTO, GAME_KENO]) {
    const round = await lottery.getRound(gameType, 1);
    assert.ok(round.openTime <= now);
    assert.equal(round.closeTime, nextUtcMidnight(round.openTime));
    assert.equal(round.drawTime, 0n);
  }
});
```

- [ ] **Step 4: Add buy/close cutoff tests**

Add:

```js
test("allows buying before closeTime and rejects buying at closeTime", async () => {
  const { lottery, alice, ticketPrice } = await deployLottery();
  const round = await lottery.getRound(GAME_LOTTO, 1);

  await moveTo(round.closeTime - 2n);
  await lottery.connect(alice).buyTicket(GAME_LOTTO, [1, 2, 3, 4, 5], [1, 2], { value: ticketPrice });

  await moveTo(round.closeTime);
  await assert.rejects(
    lottery.connect(alice).buyTicket(GAME_LOTTO, [6, 7, 8, 9, 10], [3, 4], { value: ticketPrice }),
    /RoundSalesClosed/
  );
});

test("prevents closing before closeTime and allows closing at closeTime", async () => {
  const { lottery } = await deployLottery();
  const round = await lottery.getRound(GAME_KENO, 1);

  await assert.rejects(
    lottery.closeRound(GAME_KENO),
    /RoundCloseTimeNotReached/
  );

  await moveTo(round.closeTime);
  await lottery.closeRound(GAME_KENO);

  const closed = await lottery.getRound(GAME_KENO, 1);
  assert.equal(closed.status, 1n);
});
```

- [ ] **Step 5: Add drawTime test**

Add:

```js
test("records drawTime when VRF fulfillment sets winning numbers", async () => {
  const { lottery, vrf } = await deployLottery({ localTesting: false });
  const round = await lottery.getRound(GAME_KENO, 1);

  await moveTo(round.closeTime);
  await lottery.closeRound(GAME_KENO);
  const tx = await lottery.requestDraw(GAME_KENO);
  const receipt = await tx.wait();
  const event = receipt.logs.find((log) => log.fragment?.name === "DrawRequested");
  const requestId = event.args.requestId;

  await vrf.fulfill(lottery.target, requestId, [123456789n]);

  const drawn = await lottery.getRound(GAME_KENO, 1);
  assert.equal(drawn.status, 3n);
  assert.ok(drawn.drawTime >= round.closeTime);
});
```

- [ ] **Step 6: Add next-round window tests**

Add:

```js
test("starts the next round on the next UTC daily window", async () => {
  const { lottery, alice, ticketPrice } = await deployLottery();
  const round = await lottery.getRound(GAME_LOTTO, 1);

  await lottery.connect(alice).buyTicket(GAME_LOTTO, [1, 2, 3, 4, 5], [1, 2], { value: ticketPrice });
  await moveTo(round.closeTime);
  await lottery.closeRound(GAME_LOTTO);
  await lottery.testDrawFixed(GAME_LOTTO, [1, 2, 3, 4, 5], [1, 2]);
  await lottery.connect(alice).registerWinningTicket(GAME_LOTTO, 1, 0);
  await lottery.closeRegistration(GAME_LOTTO, 1);
  await lottery.startNextRound(GAME_LOTTO);

  const next = await lottery.getRound(GAME_LOTTO, 2);
  assert.equal(next.openTime, round.closeTime);
  assert.equal(next.closeTime, round.closeTime + DAY);
  assert.equal(next.drawTime, 0n);
});

test("advances late next rounds so the new closeTime is in the future", async () => {
  const { lottery } = await deployLottery();
  const round = await lottery.getRound(GAME_KENO, 1);

  await moveTo(round.closeTime);
  await lottery.closeRound(GAME_KENO);
  await lottery.testDrawFixed(GAME_KENO, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], []);
  await lottery.closeRegistration(GAME_KENO, 1);

  await moveTo(round.closeTime + (3n * DAY) + 120n);
  await lottery.startNextRound(GAME_KENO);

  const now = await latestTimestamp();
  const next = await lottery.getRound(GAME_KENO, 2);
  assert.ok(next.openTime <= now);
  assert.ok(next.closeTime > now);
  assert.equal(next.closeTime % DAY, 0n);
});
```

- [ ] **Step 7: Run tests and verify new tests fail**

Run:

```bash
npm test
```

Expected: FAIL because `Round` does not yet expose `openTime`, `closeTime`, or `drawTime`, and the custom errors do not exist.

Do not change contract code in this task.

---

### Task 2: Implement Contract UTC Timing

**Files:**
- Modify: `contracts/SuperLottery.sol`
- Test: `test/SuperLottery.test.js`

- [ ] **Step 1: Add time constants and custom errors**

In `contracts/SuperLottery.sol`, near the existing constants and errors, add:

```solidity
error RoundNotStarted();
error RoundSalesClosed();
error RoundCloseTimeNotReached();
```

Add the day constant:

```solidity
uint256 private constant UTC_DAY = 1 days;
```

- [ ] **Step 2: Extend `Round`**

Change `Round` to:

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
}
```

- [ ] **Step 3: Initialize first rounds with UTC windows**

In the constructor loop, replace:

```solidity
rounds[gameType][1].status = RoundStatus.Open;
emit RoundStarted(gameType, 1, 0);
```

with:

```solidity
Round storage round = rounds[gameType][1];
round.status = RoundStatus.Open;
round.openTime = block.timestamp;
round.closeTime = _nextUtcMidnight(block.timestamp);
emit RoundStarted(gameType, 1, 0);
```

- [ ] **Step 4: Gate ticket purchases by time**

In `buyTicket`, after the status check, add:

```solidity
if (block.timestamp < round.openTime) revert RoundNotStarted();
if (block.timestamp >= round.closeTime) revert RoundSalesClosed();
```

- [ ] **Step 5: Gate `closeRound` by close time**

In `closeRound`, after the status check, add:

```solidity
if (block.timestamp < round.closeTime) revert RoundCloseTimeNotReached();
```

- [ ] **Step 6: Record draw time**

In `_setWinningNumbers`, after:

```solidity
round.status = RoundStatus.Drawn;
```

add:

```solidity
round.drawTime = block.timestamp;
```

- [ ] **Step 7: Calculate next daily window**

In `startNextRound`, replace the next-round status/prize setup with:

```solidity
uint256 nextOpenTime = current.closeTime;
uint256 nextCloseTime = current.closeTime + UTC_DAY;
while (nextCloseTime <= block.timestamp) {
    nextOpenTime += UTC_DAY;
    nextCloseTime += UTC_DAY;
}

currentRoundId[gameType] = nextRoundId;
Round storage next = rounds[gameType][nextRoundId];
next.status = RoundStatus.Open;
next.prizePool = rolloverReserve[gameType];
next.openTime = nextOpenTime;
next.closeTime = nextCloseTime;
rolloverReserve[gameType] = 0;

emit RoundStarted(gameType, nextRoundId, next.prizePool);
```

- [ ] **Step 8: Add UTC midnight helper**

Near other private helper functions, add:

```solidity
function _nextUtcMidnight(uint256 timestamp) private pure returns (uint256) {
    return ((timestamp / UTC_DAY) + 1) * UTC_DAY;
}
```

- [ ] **Step 9: Run contract tests**

Run:

```bash
npm test
```

Expected: PASS, including the new UTC timing tests and existing multi-game prize tests.

- [ ] **Step 10: Regenerate ABI**

Run:

```bash
npm run copy:abi
```

Expected: `Copied ABI to src/abi/SuperLottery.json`.

---

### Task 3: Frontend UTC Helpers

**Files:**
- Modify: `src/lottery.js`

- [ ] **Step 1: Add constants and UTC formatting helpers**

In `src/lottery.js`, after `STATUS_LABELS`, add:

```js
export const HISTORY_LIMIT = 20;
export const SECOND_MS = 1000;

const UTC_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "UTC",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

const UTC_WEEKDAY_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  weekday: "long"
});

const UTC_DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "UTC",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false
});

export function timestampToMs(timestamp) {
  return Number(timestamp) * SECOND_MS;
}

export function formatUtcDate(timestamp) {
  if (!timestamp) return "-";
  return UTC_DATE_FORMATTER.format(new Date(timestampToMs(timestamp)));
}

export function formatUtcWeekday(timestamp) {
  if (!timestamp) return "-";
  return UTC_WEEKDAY_FORMATTER.format(new Date(timestampToMs(timestamp)));
}

export function formatUtcDateTime(timestamp) {
  if (!timestamp) return "-";
  return `${UTC_DATE_TIME_FORMATTER.format(new Date(timestampToMs(timestamp))).replace(",", "")} UTC`;
}

export function formatCountdown(milliseconds) {
  const safeMs = Math.max(0, milliseconds);
  const totalSeconds = Math.floor(safeMs / SECOND_MS);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
}
```

- [ ] **Step 2: Verify helper module builds**

Run:

```bash
npm run build
```

Expected: PASS. The contract ABI may be copied as part of the build.

---

### Task 4: Frontend Current Round Time UI

**Files:**
- Modify: `src/App.jsx`
- Modify: `src/App.css`

- [ ] **Step 1: Import UTC helpers**

Update the import from `./lottery.js` in `src/App.jsx` to include:

```js
formatCountdown,
formatUtcDate,
formatUtcDateTime,
formatUtcWeekday
```

- [ ] **Step 2: Parse round time fields**

Update `parseRound` to return:

```js
function parseRound(rawRound) {
  return {
    status: Number(rawRound.status),
    prizePool: rawRound.prizePool,
    winningMain: normalizeNumbers(rawRound.winningMain),
    winningExtra: normalizeNumbers(rawRound.winningExtra),
    requestId: rawRound.requestId,
    reserveRollover: rawRound.reserveRollover,
    openTime: rawRound.openTime,
    closeTime: rawRound.closeTime,
    drawTime: rawRound.drawTime
  };
}
```

- [ ] **Step 3: Add frontend clock state**

Inside `App`, add:

```js
const [nowMs, setNowMs] = useState(Date.now());
```

Add an effect:

```js
useEffect(() => {
  const id = window.setInterval(() => setNowMs(Date.now()), 1000);
  return () => window.clearInterval(id);
}, []);
```

- [ ] **Step 4: Add sale-close derived state**

Add:

```js
const closeMs = round?.closeTime ? Number(round.closeTime) * 1000 : 0;
const salesClosedByTime = Boolean(closeMs && nowMs >= closeMs);
const countdownLabel = closeMs ? formatCountdown(closeMs - nowMs) : "--:--:--";
```

Update `canBuy` so it includes:

```js
&& !salesClosedByTime
```

- [ ] **Step 5: Render UTC timing metadata**

In the `status-band`, add two new cells after `Round`:

```jsx
<div>
  <span className="label">UTC Date</span>
  <strong>{round ? `${formatUtcDate(round.openTime)} · ${formatUtcWeekday(round.openTime)}` : "-"}</strong>
</div>
<div>
  <span className="label">Sales Close</span>
  <strong>{round ? formatUtcDateTime(round.closeTime) : "-"}</strong>
</div>
```

Then add a small countdown section below `rule-band`:

```jsx
<section className="time-band">
  <div>
    <span className="label">Countdown</span>
    <strong>{round?.status === 0 && !salesClosedByTime ? countdownLabel : "Sales closed"}</strong>
  </div>
  <p className="muted">
    Draws are requested manually by the owner after the UTC close time.
  </p>
</section>
```

- [ ] **Step 6: Time-gate owner close button in UI**

Change the `Close Round` button disabled condition to:

```jsx
disabled={busy || round?.status !== 0 || !salesClosedByTime}
```

- [ ] **Step 7: Add CSS for expanded status and time band**

In `src/App.css`, change:

```css
.status-band {
  grid-template-columns: repeat(5, minmax(0, 1fr));
}
```

to:

```css
.status-band {
  grid-template-columns: repeat(7, minmax(0, 1fr));
}
```

Add:

```css
.time-band {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  border: 1px solid #c7d0ca;
  border-radius: 8px;
  background: #ffffff;
  margin-bottom: 20px;
  padding: 14px 16px;
}

.time-band strong {
  display: block;
  margin-top: 5px;
  font-variant-numeric: tabular-nums;
}
```

In the mobile media query, add `.time-band` to the flex-column block:

```css
.time-band {
  align-items: stretch;
  flex-direction: column;
}
```

- [ ] **Step 8: Build**

Run:

```bash
npm run build
```

Expected: PASS.

---

### Task 5: Frontend Historical Records

**Files:**
- Modify: `src/App.jsx`
- Modify: `src/App.css`

- [ ] **Step 1: Import history limit**

Update the `./lottery.js` import to include:

```js
HISTORY_LIMIT
```

- [ ] **Step 2: Add history state**

Inside `App`, add:

```js
const [historyRounds, setHistoryRounds] = useState([]);
```

In the selected-game reset effect, add:

```js
setHistoryRounds([]);
```

- [ ] **Step 3: Load recent history during refresh**

In `refresh`, after loading the current round and ticket count, add:

```js
const history = [];
const currentRoundNumber = Number(currentRoundId);
const firstRound = Math.max(1, currentRoundNumber - HISTORY_LIMIT + 1);
for (let id = currentRoundNumber; id >= firstRound; id--) {
  const historyRound = parseRound(await contract.getRound(requestGameType, BigInt(id)));
  if (historyRound.status >= 3) {
    history.push({ id, ...historyRound });
  }
}
```

Before committing state, add:

```js
setHistoryRounds(history);
```

- [ ] **Step 4: Render history section**

Add after the tickets section:

```jsx
<section className="history-section">
  <div className="panel-head">
    <h2>History</h2>
    <span className="muted">{selectedGame.label} · recent drawn rounds</span>
  </div>
  <div className="history-list">
    {historyRounds.length === 0 ? (
      <p className="muted">No drawn history loaded for this game yet.</p>
    ) : historyRounds.map((item) => (
      <article className="history-card" key={item.id}>
        <div>
          <strong>Round #{item.id}</strong>
          <p>{formatUtcDate(item.openTime)} · {formatUtcWeekday(item.openTime)}</p>
          <small>Closed {formatUtcDateTime(item.closeTime)} · Drawn {formatUtcDateTime(item.drawTime)}</small>
        </div>
        <div>
          <span className="label">Winning Numbers</span>
          <strong>
            {formatNumbers(item.winningMain, selectedGame.main)}
            {selectedGame.extra ? ` + ${formatNumbers(item.winningExtra, selectedGame.extra)}` : ""}
          </strong>
        </div>
        <div>
          <span className="label">Prize Pool</span>
          <strong>{ethers.formatEther(item.prizePool)} ETH</strong>
        </div>
      </article>
    ))}
  </div>
</section>
```

- [ ] **Step 5: Add history CSS**

In `src/App.css`, extend:

```css
.tiers-section,
.tickets-section,
.admin-panel {
  margin-top: 20px;
}
```

to include `.history-section`.

Add:

```css
.history-section {
  border: 1px solid #c7d0ca;
  border-radius: 8px;
  background: #ffffff;
  padding: 18px;
  margin-top: 20px;
}

.history-list {
  display: grid;
  gap: 10px;
  margin-top: 14px;
}

.history-card {
  display: grid;
  grid-template-columns: minmax(160px, 1fr) minmax(220px, 1.4fr) minmax(120px, auto);
  gap: 14px;
  align-items: center;
  border: 1px solid #d9dfdb;
  border-radius: 8px;
  padding: 14px;
}

.history-card strong {
  overflow-wrap: anywhere;
}
```

In the mobile media query, add:

```css
.history-card {
  grid-template-columns: 1fr;
}
```

- [ ] **Step 6: Build**

Run:

```bash
npm run build
```

Expected: PASS.

---

### Task 6: README and ABI Verification

**Files:**
- Modify: `README.md`
- Modify: `src/abi/SuperLottery.json`

- [ ] **Step 1: Regenerate ABI**

Run:

```bash
npm run compile
npm run copy:abi
```

Expected:

```text
No contracts to compile
Copied ABI to src/abi/SuperLottery.json
```

The compile line may say contracts were compiled if artifacts are stale; that is acceptable when the exit code is `0`.

- [ ] **Step 2: Update README lifecycle notes**

In `README.md`, add a section:

```markdown
## Daily UTC Rounds

Each game has one UTC daily sales window. Ticket sales close at `00:00 UTC`.

The contract stores timestamps as UTC Unix timestamps:

- `openTime`: round sales start
- `closeTime`: round sales stop
- `drawTime`: VRF fulfillment time, or `0` before draw

After `closeTime`, users can no longer buy tickets. The owner still manually runs:

1. `closeRound(gameType)`
2. `requestDraw(gameType)`
3. Wait for Chainlink VRF fulfillment
4. Users register winning tickets
5. `closeRegistration(gameType, roundId)`
6. Users claim prizes
7. `startNextRound(gameType)`

The frontend displays UTC date, weekday, close time, countdown, and recent historical drawn rounds.
```

- [ ] **Step 3: Build**

Run:

```bash
npm run build
```

Expected: PASS.

---

### Task 7: Final Verification

**Files:**
- Verify all touched files.

- [ ] **Step 1: Run full contract tests**

Run:

```bash
npm test
```

Expected:

```text
# fail 0
```

The exact test count may be higher than the previous 20 because daily UTC tests were added.

- [ ] **Step 2: Run production build**

Run:

```bash
npm run build
```

Expected: PASS. A Vite chunk-size warning is acceptable if the exit code is `0`.

- [ ] **Step 3: Start local dev server**

Run:

```bash
npm run dev -- --host 127.0.0.1
```

Expected: Vite prints a local URL such as:

```text
Local: http://127.0.0.1:5173/
```

If port `5173` is taken, Vite may choose another port. Use the printed URL.

- [ ] **Step 4: Smoke-check HTTP response**

Run with the actual printed port:

```bash
curl -I http://127.0.0.1:5173/
```

Expected:

```text
HTTP/1.1 200 OK
```

- [ ] **Step 5: Deployment note**

Report clearly:

```text
This requires deploying a new SuperLottery contract and adding the new address as a Chainlink VRF consumer.
```

Also report the fresh verification outputs and any warnings.

---

## Self-Review

- Spec coverage: The plan covers UTC timestamp storage, daily `00:00 UTC` close windows, on-chain buy/close gating, owner manual draw, draw time recording, next-round window calculation, frontend date/weekday/countdown display, history records, README updates, ABI regeneration, and deployment impact.
- Placeholder scan: No `TBD`, `TODO`, or unspecified implementation steps remain.
- Type consistency: Contract uses `uint256 openTime`, `uint256 closeTime`, `uint256 drawTime`; frontend parses those as BigInt-like ethers values and formats them through helper functions that convert timestamps to milliseconds.
