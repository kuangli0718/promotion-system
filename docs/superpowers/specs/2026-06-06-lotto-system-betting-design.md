# Lotto System Betting and Probability Design

## Goal

Add small system betting for the Lotto game only. Users can select more than the standard Lotto count, see how many standard entries the selection expands into, see total price, and buy the expanded entries in one transaction.

The first version keeps all other game types unchanged and keeps the existing prize registration and claim flow unchanged by storing each expanded combination as a normal `Ticket`.

## Scope

This phase covers only `gameType = 2` Lotto:

- Standard Lotto remains: main area choose 5 from 1-35, extra area choose 2 from 1-12.
- System Lotto allows main area choose `N >= 5` and extra area choose `M >= 2`.
- Entry count is `C(N, 5) * C(M, 2)`.
- Total price is `entryCount * ticketPrice`.
- The system selection is expanded into normal Lotto tickets on-chain.
- The maximum expanded entry count is `100`.
- The frontend shows entry count, total price, first-prize probability, per-tier probability, and listed-prize probability.

Out of scope:

- System betting for Digital, NumberLotto, BaseLotto, or Keno.
- Compressed system-ticket storage.
- Supporting thousands of entries in one transaction.
- Changing current prize tiers, prize pool distribution, winner registration, or claim behavior.
- Changing daily UTC round behavior.

## User Experience

For Lotto only, the picker gets a mode control:

```text
Single | System
```

Single mode keeps the current behavior:

```text
Main: exactly 5
Extra: exactly 2
Price: 1 * ticketPrice
Function: buyTicket(2, mainNumbers, extraNumbers)
```

System mode allows extra picks:

```text
Main: 5 or more
Extra: 2 or more
Entry count = C(mainCount, 5) * C(extraCount, 2)
Price = entryCount * ticketPrice
Function: buyLottoSystemTicket(mainNumbers, extraNumbers)
```

The buy button is enabled only when:

```text
selected game is Lotto
round is Open
sales are not closed by time
mainCount >= 5
extraCount >= 2
entryCount >= 1
entryCount <= 100
wallet and ticket price are ready
```

If the user exceeds the entry limit, show:

```text
Current selection expands to 336 entries. The single-transaction limit is 100 entries.
```

## Contract Design

Add a Lotto-only batch purchase function:

```solidity
function buyLottoSystemTicket(
    uint8[] calldata mainNumbers,
    uint8[] calldata extraNumbers
) external payable returns (uint256 firstTicketId, uint256 entryCount)
```

Validation:

- Uses the current Lotto round: `currentRoundId[GAME_LOTTO]`.
- Requires the Lotto round is `Open`.
- Requires `block.timestamp >= round.openTime`.
- Requires `block.timestamp < round.closeTime`.
- Requires `mainNumbers.length >= 5`.
- Requires `extraNumbers.length >= 2`.
- Requires all numbers are in range and unique.
- Sorts normalized numbers.
- Calculates `entryCount = C(mainCount, 5) * C(extraCount, 2)`.
- Requires `entryCount <= 100`.
- Requires `msg.value == ticketPrice * entryCount`.

Storage behavior:

- Each expanded combination is pushed into `gameTickets[GAME_LOTTO][roundId]` as a normal `Ticket`.
- Each expanded ticket has:
  - `buyer = msg.sender`
  - `gameType = GAME_LOTTO`
  - `mainNumbers = one 5-number combination`
  - `extraNumbers = one 2-number combination`
  - `claimed = false`
- `round.prizePool += msg.value` once after validation.

Events:

The existing `TicketBought` event should still emit for each expanded ticket so existing indexing and UI behavior continue to work.

Add one summary event:

```solidity
event LottoSystemTicketBought(
    uint256 indexed roundId,
    address indexed buyer,
    uint256 firstTicketId,
    uint256 entryCount
);
```

Errors:

Add explicit custom errors:

```solidity
error InvalidSystemMainNumberCount();
error InvalidSystemExtraNumberCount();
error TooManySystemEntries();
```

Existing errors should still be reused for invalid ranges, duplicates, closed rounds, and wrong payment.

## Expansion Rules

Given sorted selected main numbers:

```text
mainNumbers.length = N
```

Generate all 5-combinations in lexicographic order.

Given sorted selected extra numbers:

```text
extraNumbers.length = M
```

Generate all 2-combinations in lexicographic order.

For every main combination and every extra combination, create one normal Lotto ticket.

Example:

```text
Main selected: 01 02 03 04 05 06
Extra selected: 01 02 03

Entry count = C(6,5) * C(3,2) = 6 * 3 = 18
```

The first ticket ID returned by the function is the ticket ID of the first expanded normal ticket.

## Probability Display

Probability is frontend-only. It does not affect contract logic.

Lotto total draw combinations:

```text
C(35, 5) * C(12, 2) = 21,425,712
```

Single-entry first prize probability:

```text
1 / 21,425,712
```

For a system selection:

```text
entryCount = C(N, 5) * C(M, 2)
firstPrizeProbability = entryCount / 21,425,712
```

The frontend should display:

- Entry count.
- Total price.
- Single-entry first prize probability.
- Current system first prize probability.
- Per-tier probability for at least one entry in that tier.
- Listed-prize probability for at least one entry in any configured Lotto tier.

Per-tier probabilities are calculated from draw-state counts, not by multiplying single-entry odds blindly.

Let:

```text
N = selected main count
M = selected extra count
a = count of drawn main numbers that are inside the selected main set
b = count of drawn extra numbers that are inside the selected extra set
```

The probability of a draw state `(a, b)` is:

```text
C(N, a) * C(35 - N, 5 - a) / C(35, 5)
*
C(M, b) * C(12 - M, 2 - b) / C(12, 2)
```

The frontend should sum draw-state probabilities for each tier condition:

| Tier | Condition for at least one expanded entry in that tier |
| --- | --- |
| 1 | `a >= 5 && b >= 2` |
| 2 | `a >= 5 && b >= 1 && M - b >= 1` |
| 3 | `a >= 5 && M - b >= 2` |
| 4 | `a >= 4 && N - a >= 1 && b >= 2` |
| 5 | `a >= 4 && N - a >= 1 && b >= 1 && M - b >= 1` |

The listed-prize probability is the union of those tier conditions across all possible `(a, b)` states.

Display probability in two formats:

```text
1 in 340,091
0.000294%
```

For very small probabilities, keep enough significant digits so the value is not rounded to `0.00%`.

## Frontend Architecture

Add Lotto-specific helpers in `src/lottery.js`:

- `combination(n, k)`
- `getLottoSystemEntryCount(mainCount, extraCount)`
- `getLottoFirstPrizeProbability(entryCount)`
- `getLottoTierProbabilities(mainCount, extraCount)`
- `formatProbability(probability)`

The existing generic game definitions remain unchanged except Lotto can opt into system betting metadata:

```js
system: {
  maxEntries: 100
}
```

In `src/App.jsx`:

- Add `betMode`, defaulting to `single`.
- Show mode controls only when selected game is Lotto.
- In system mode, allow selecting more than 5 main and more than 2 extra numbers.
- Show system summary near the buy button.
- Use `buyTicket` for single mode.
- Use `buyLottoSystemTicket` for Lotto system mode.
- Keep all non-Lotto games in single mode.

The ticket list does not need a new ticket type because expanded entries are normal tickets.

## Testing

Contract tests should cover:

- Buying a Lotto system ticket with `6 main * 3 extra` creates 18 normal tickets.
- First ticket ID and round ticket count are correct.
- Prize pool increases by `entryCount * ticketPrice`.
- Each expanded ticket stores exactly 5 sorted main numbers and 2 sorted extra numbers.
- Wrong payment reverts.
- Too many entries reverts.
- Main count below 5 reverts.
- Extra count below 2 reverts.
- Duplicate system numbers revert.
- Out-of-range system numbers revert.
- System betting after sales close reverts.
- Non-Lotto games cannot use the Lotto system function because the function is Lotto-only.

Frontend verification should cover:

- Single mode still works for Lotto and all other games.
- Lotto system mode computes entry count and total price.
- Buy button disables above 100 entries.
- Probability display updates when selections change.
- Build passes.

## Deployment Impact

This requires a new contract deployment because a new public purchase function and new custom errors are added.

After deployment:

1. Add the new contract address as a Chainlink VRF subscription consumer.
2. Update `VITE_SUPER_LOTTERY_ADDRESS`.
3. Restart the frontend.
