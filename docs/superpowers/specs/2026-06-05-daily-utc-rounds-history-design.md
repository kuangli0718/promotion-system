# Daily UTC Rounds and History Design

## Goal

Add fixed daily lottery periods to the current multi-game Super Lottery DApp. Each game keeps its independent rounds and prize pools, but every round now has a UTC sales window. Sales stop at `00:00 UTC` each day. After sales stop, the owner manually closes the round and requests the Chainlink VRF draw.

The frontend will show the round date, weekday, close time, countdown, and historical winning numbers.

## Scope

This phase covers:

- UTC-based daily round windows.
- One round per game per UTC day.
- Buy-ticket time validation on-chain.
- Owner-only manual draw flow after the close time.
- Round date, weekday, close time, and countdown in the frontend.
- Historical draw display for recent past rounds.

Out of scope:

- Chainlink Automation or fully automatic daily draws.
- Beijing-time scheduling.
- Per-game custom schedules.
- Backend indexing.
- Off-chain keeper infrastructure.
- Changing the existing prize tier rules.
- Changing the single global ticket price.

## Time Standard

The contract uses UTC Unix timestamps through `block.timestamp`.

The canonical daily close time is:

```text
00:00 UTC
```

The contract does not store timezone names, formatted dates, or weekday strings. The frontend derives date and weekday labels from UTC timestamps.

Example display:

```text
Round #12
Date: 2026-06-05
Weekday: Friday
Sales close: 2026-06-06 00:00 UTC
Countdown: 03:12:45
```

## Round Time Model

Extend `Round` with time fields:

```solidity
uint256 openTime;
uint256 closeTime;
uint256 drawTime;
```

Meaning:

- `openTime`: UTC timestamp when ticket sales for this round begin.
- `closeTime`: UTC timestamp when ticket sales stop. This should be the next `00:00 UTC` boundary.
- `drawTime`: UTC timestamp when VRF fulfillment sets the winning numbers. It is `0` until the draw completes.

The initial deployment creates round `1` for each game. Its `openTime` is the deployment timestamp. Its `closeTime` is the next UTC midnight after deployment.

Each next round starts after the previous round reaches `Claimable` and the owner calls `startNextRound(gameType)`. The next round uses:

```text
next.openTime = previous.closeTime
next.closeTime = previous.closeTime + 1 days
```

If the owner starts the next round late, the contract should not create a round whose `closeTime` is already in the past. It should advance the window by full days until:

```text
closeTime > block.timestamp
```

This keeps new rounds buyable even if admin operations are delayed.

## Lifecycle Rules

Current statuses remain:

- `Open`
- `Closed`
- `Drawing`
- `Drawn`
- `Claimable`

### Buying Tickets

`buyTicket(gameType, mainNumbers, extraNumbers)` remains payable and game-scoped.

It succeeds only when:

```text
round.status == Open
block.timestamp >= round.openTime
block.timestamp < round.closeTime
msg.value == ticketPrice
numbers are valid for the selected game
```

If the current time is at or after `closeTime`, sales have stopped. Users cannot buy tickets even if the owner has not yet called `closeRound`.

### Closing Sales

`closeRound(gameType)` remains owner-only.

It succeeds only when:

```text
round.status == Open
block.timestamp >= round.closeTime
```

This prevents early closing before the daily UTC cutoff.

### Requesting Draw

`requestDraw(gameType)` remains owner-only.

It succeeds only when:

```text
round.status == Closed
```

Because `closeRound` can only happen after `closeTime`, this indirectly guarantees that VRF draw requests cannot happen before the daily cutoff.

### VRF Fulfillment

The VRF callback keeps the current behavior:

1. Validate the caller is the configured VRF coordinator.
2. Resolve the request to `(gameType, roundId)`.
3. Generate winning numbers for that game.
4. Set the round status to `Drawn`.
5. Store `drawTime = block.timestamp`.
6. Emit `RoundDrawn`.

### Registration, Claiming, and Next Round

Winner registration and claiming do not become time-gated in this phase.

The owner still controls:

- `closeRegistration(gameType, roundId)`
- `startNextRound(gameType)`

`startNextRound` calculates the next daily window and rolls any reserve into the new round prize pool.

## Historical Records

Historical records are based on existing round storage. The frontend can query prior rounds with:

```solidity
getRound(gameType, roundId)
```

The first frontend version should show recent historical rounds by reading from:

```text
currentRoundId(gameType) down to max(1, currentRoundId - 20)
```

The history list should show:

- Game label.
- Round ID.
- UTC date derived from `openTime`.
- UTC weekday derived from `openTime`.
- Sales close time derived from `closeTime`.
- Actual draw time derived from `drawTime`, when available.
- Status.
- Prize pool.
- Winning main and extra numbers, when the round is `Drawn` or `Claimable`.

No batch query function is required in this phase. If history loading becomes slow later, a view helper such as `getRoundRange(gameType, fromRoundId, limit)` can be added in a separate optimization.

## Frontend Changes

The current round panel should add:

- UTC round date.
- UTC weekday.
- Sales close time.
- Countdown to sales close while the round is open.
- A clear state when sales are closed but the owner has not requested the draw.

The buy button should be disabled when:

```text
round.status != Open
current frontend time >= round.closeTime
selected numbers are incomplete
wallet or contract state is not ready
```

The owner admin panel should keep the same manual actions, but labels should reflect the time-based lifecycle:

- `Close Round` is available only after `closeTime`.
- `Request Draw` is available after the round is closed.
- `Close Registration` remains available after draw.
- `Next Round` remains available after registration closes.

The history section should be game-scoped. Switching games changes the history list to that game's recent rounds.

## Error Handling

The contract should add explicit custom errors for time failures:

```solidity
error RoundNotStarted();
error RoundSalesClosed();
error RoundCloseTimeNotReached();
```

Expected uses:

- `RoundNotStarted`: current time is before `openTime`.
- `RoundSalesClosed`: current time is at or after `closeTime` during ticket purchase.
- `RoundCloseTimeNotReached`: owner tries to close before `closeTime`.

The frontend should surface these errors through the existing message/toast flow.

## Testing

Contract tests should cover:

- Constructor initializes each game round with `openTime <= block.timestamp` and `closeTime` at the next UTC midnight.
- Users can buy during the open window.
- Users cannot buy at or after `closeTime`.
- Owner cannot close before `closeTime`.
- Owner can close at or after `closeTime`.
- Owner can request VRF only after close.
- VRF fulfillment records `drawTime`.
- `startNextRound` creates the next daily window and preserves rollover behavior.
- Late `startNextRound` advances the window so the new round is not already closed.
- Historical `getRound` calls return the old winning numbers and timestamps after later rounds start.

Frontend verification should cover:

- Current round date, weekday, close time, and countdown render from UTC timestamps.
- Buy button disables after close time.
- Owner actions reflect the current time-gated status.
- Recent history shows prior drawn rounds for the selected game.

## Deployment Impact

This requires a new contract deployment because the `Round` struct and lifecycle rules change.

After deployment:

1. Add the new contract address as a Chainlink VRF subscription consumer.
2. Update `VITE_SUPER_LOTTERY_ADDRESS`.
3. Restart the frontend.

Old Sepolia contracts remain on-chain but will not be used by the frontend once the address is updated.
