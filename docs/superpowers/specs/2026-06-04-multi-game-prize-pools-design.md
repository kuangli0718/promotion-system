# Multi-Game Prize Pool Design

## Goal

Extend the current Sepolia lottery demo from one hard-coded Da Le Tou style game into a multi-game lottery DApp with independent game rounds, independent prize pools, and configurable multi-tier prize distribution.

## Scope

This design covers the first multi-game phase. It supports five custom game types:

- Digital: number-position game.
- NumberLotto: mixed digital and lotto game.
- Lotto: front/back area lotto game.
- BaseLotto: mixed keno and lotto game.
- Keno: large-pool hit-count game.

Each game type has fixed custom rules in phase one. Real official lottery rules, regulatory logic, Chainlink Automation, and backend indexing remain out of scope.

## Core Principles

Each game owns its own rounds and funds. No game shares prize money with another game.

```text
gameType -> roundId -> round prize pool
gameType -> currentRoundId
gameType -> rollover reserve
```

Ticket funds for Digital can only pay Digital winners. Ticket funds for Keno can only pay Keno winners. This keeps odds, jackpot growth, and winner expectations understandable.

Each ticket can win only one prize tier: the highest matching tier for that game. A ticket cannot collect multiple tiers in the same round.

## Round Lifecycle

Each game type has an independent lifecycle:

- `Open`: users can buy tickets for that game.
- `Closed`: sales are stopped for that game.
- `Drawing`: Chainlink VRF has been requested for that game round.
- `Drawn`: winning numbers are available and users can register winning tickets.
- `Claimable`: registration is closed and registered winners can claim.

Admin operations must include the `gameType`:

- `closeRound(gameType)`
- `requestDraw(gameType)`
- `closeRegistration(gameType, roundId)`
- `startNextRound(gameType)`

This lets one game be open while another is drawing or claimable.

## Prize Accounting

Each game has a ticket price. In phase one, each ticket payment goes into the current round prize pool for that game. A future platform fee can be added later, but the first multi-game version keeps 100% of ticket value inside the game-specific prize pool.

Each game has prize tiers:

```solidity
struct PrizeTier {
    uint8 tierId;
    uint8 mainMatch;
    uint8 extraMatch;
    uint16 poolBps;
    bool rollIfNoWinner;
}
```

`poolBps` is measured in basis points. `10000` means 100% of the round prize pool. Each game's configured prize tier percentages plus reserve percentage must total `10000`.

During winner registration:

1. The user submits `registerWinningTicket(gameType, roundId, ticketId)`.
2. The contract verifies the ticket owner.
3. The contract calculates match counts according to that game's matching algorithm.
4. The contract selects the highest matching prize tier.
5. The ticket is registered into that tier.
6. The tier winner count increases by one.

When registration closes:

1. For each prize tier, calculate `tierPool = roundPrizePool * poolBps / 10000`.
2. If the tier has winners, calculate `prizePerWinner = tierPool / winnerCount`.
3. If the tier has no winners and `rollIfNoWinner == true`, add that tier pool to the game rollover reserve.
4. Always add explicit reserve pool to the game rollover reserve.

When users claim:

```text
claim amount = prizePerWinner for the ticket's registered tier
```

Unclaimed prizes remain in the contract until claimed. They are not automatically swept into rollover in phase one.

## Game Types

### Lotto

Rules:

- Main area: choose 5 unique numbers from 1-35.
- Extra area: choose 2 unique numbers from 1-12.
- Order does not matter.
- Draw: 5 unique main numbers and 2 unique extra numbers.

Prize tiers:

| Tier | Match | Pool |
| --- | --- | --- |
| 1 | Main 5 + Extra 2 | 50% |
| 2 | Main 5 + Extra 1 | 20% |
| 3 | Main 5 + Extra 0 | 10% |
| 4 | Main 4 + Extra 2 | 10% |
| 5 | Main 4 + Extra 1 | 5% |
| Reserve | No ticket tier | 5% rollover |

### Keno

Rules:

- Main area: choose 10 unique numbers from 1-80.
- Draw: 20 unique numbers from 1-80.
- Order does not matter.
- Prize tiers are based on hit count.

Prize tiers:

| Tier | Match | Pool |
| --- | --- | --- |
| 1 | Main 10 | 45% |
| 2 | Main 9 | 25% |
| 3 | Main 8 | 15% |
| 4 | Main 7 | 10% |
| Reserve | No ticket tier | 5% rollover |

### Digital

Rules:

- Main area: choose 4 digits from 0-9.
- Repeats are allowed.
- Order matters for straight matching.
- Draw: 4 digits from 0-9, repeats allowed.

Prize tiers:

| Tier | Match | Pool |
| --- | --- | --- |
| 1 | All 4 digits match in exact order | 60% |
| 2 | All 4 digits match as a multiset but not exact order | 20% |
| 3 | Last 3 digits match in exact order | 10% |
| 4 | Last 2 digits match in exact order | 5% |
| Reserve | No ticket tier | 5% rollover |

For multiset matching, duplicate digits count. For example, `1 1 2 3` and `1 2 1 3` match as the same multiset.

### NumberLotto

Rules:

- Digital area: choose 3 digits from 0-9.
- Digital area allows repeats and order matters.
- Lotto area: choose 3 unique numbers from 1-20.
- Lotto order does not matter.
- Draw: 3 digits and 3 unique lotto numbers.

Prize tiers:

| Tier | Match | Pool |
| --- | --- | --- |
| 1 | Digital 3 exact + Lotto 3 | 50% |
| 2 | Digital 3 exact + Lotto 2 | 20% |
| 3 | Digital last 2 exact + Lotto 3 | 15% |
| 4 | Digital 3 exact only | 10% |
| Reserve | No ticket tier | 5% rollover |

### BaseLotto

Rules:

- Keno area: choose 8 unique numbers from 1-60.
- Keno draw: 15 unique numbers from 1-60.
- Lotto area: choose 2 unique numbers from 1-12.
- Lotto draw: 2 unique numbers from 1-12.
- Order does not matter in either area.

Prize tiers:

| Tier | Match | Pool |
| --- | --- | --- |
| 1 | Keno 8 + Lotto 2 | 45% |
| 2 | Keno 7 + Lotto 2 | 25% |
| 3 | Keno 8 + Lotto 1 | 15% |
| 4 | Keno 7 + Lotto 1 | 10% |
| Reserve | No ticket tier | 5% rollover |

## Contract Architecture

The current `SuperLottery` contract should be replaced or heavily refactored into a multi-game contract. The existing fixed arrays are not suitable for this phase:

```solidity
uint8[5] front;
uint8[2] back;
```

The new ticket shape should support variable-size number sets:

```solidity
struct Ticket {
    address buyer;
    uint8 gameType;
    uint8[] mainNumbers;
    uint8[] extraNumbers;
    bool claimed;
}
```

Rounds should support variable winning numbers and tier accounting:

```solidity
struct Round {
    RoundStatus status;
    uint256 prizePool;
    uint8[] winningMain;
    uint8[] winningExtra;
    uint256 requestId;
    uint256 reserveRollover;
}
```

Additional mappings:

```solidity
mapping(uint8 => uint256) currentRoundId;
mapping(uint8 => mapping(uint256 => Round)) rounds;
mapping(uint8 => mapping(uint256 => Ticket[])) tickets;
mapping(uint8 => GameConfig) gameConfigs;
mapping(uint8 => PrizeTier[]) prizeTiers;
mapping(uint8 => mapping(uint256 => mapping(uint8 => uint256))) tierWinnerCounts;
mapping(uint8 => mapping(uint256 => mapping(uint8 => uint256))) tierPrizePerWinner;
mapping(uint8 => mapping(uint256 => mapping(uint256 => uint8))) registeredTicketTier;
mapping(uint8 => uint256) rolloverReserve;
```

`registeredTicketTier == 0` means not registered. Prize tier IDs should start at 1.

## Randomness

The contract still uses Chainlink VRF v2.5. Each `requestDraw(gameType)` submits a VRF request for that game type's current round.

Request mapping must include game type and round:

```solidity
struct DrawRequest {
    uint8 gameType;
    uint256 roundId;
}

mapping(uint256 => DrawRequest) drawRequests;
```

When VRF calls back, the contract generates winning numbers according to the game configuration:

- Unique sets use rejection sampling.
- Digital sets allow repeats.
- Multiple areas derive separate seeds from the same VRF word using `keccak256(randomWord, gameType, roundId, area)`.

## Matching

The contract needs three matching modes:

1. Unique unordered count: used by Lotto, Keno, BaseLotto lotto area, and NumberLotto lotto area.
2. Ordered digit suffix/exact match: used by Digital and NumberLotto digital area.
3. Digit multiset match: used by Digital tier 2.

Each game has a dedicated highest-tier resolver:

```solidity
function _resolveTier(uint8 gameType, Ticket storage ticket, Round storage round) private view returns (uint8 tierId);
```

The resolver should return only the highest tier. It should return `0` when the ticket does not win.

## Frontend Architecture

The React app should move from hard-coded front/back selectors to game-driven configuration:

```javascript
const GAME_DEFINITIONS = {
  lotto: {
    gameType: 2,
    label: "Lotto",
    main: { min: 1, max: 35, pick: 5, draw: 5, allowRepeat: false, ordered: false },
    extra: { min: 1, max: 12, pick: 2, draw: 2, allowRepeat: false, ordered: false }
  },
  keno: {
    gameType: 4,
    label: "Keno",
    main: { min: 1, max: 80, pick: 10, draw: 20, allowRepeat: false, ordered: false },
    extra: null
  },
  digital: {
    gameType: 0,
    label: "Digital",
    main: { min: 0, max: 9, pick: 4, draw: 4, allowRepeat: true, ordered: true },
    extra: null
  },
  numberLotto: {
    gameType: 1,
    label: "NumberLotto",
    main: { min: 0, max: 9, pick: 3, draw: 3, allowRepeat: true, ordered: true },
    extra: { min: 1, max: 20, pick: 3, draw: 3, allowRepeat: false, ordered: false }
  },
  baseLotto: {
    gameType: 3,
    label: "BaseLotto",
    main: { min: 1, max: 60, pick: 8, draw: 15, allowRepeat: false, ordered: false },
    extra: { min: 1, max: 12, pick: 2, draw: 2, allowRepeat: false, ordered: false }
  }
};
```

The first screen remains the usable DApp, not a landing page.

The UI should include:

- Game tabs: Digital, NumberLotto, Lotto, BaseLotto, Keno.
- Current game status: round, state, prize pool, ticket price, rollover.
- Dynamic number picker for main and extra areas.
- Prize tier table for the selected game.
- Current user's tickets for the selected game.
- Draw numbers for the selected game.
- Admin controls scoped to the selected game.

## GSAP Interaction Design

Use GSAP for useful operational feedback only. Avoid decorative animations that distract from wallet transactions.

Use `@gsap/react` with `useGSAP()` and scoped refs for cleanup. Register the hook once before use.

Animations:

- Game tab switch: selected game panel enters with `autoAlpha` and `y`.
- Number selection: clicked number ball briefly scales using transform only.
- Draw reveal: winning number balls appear using a GSAP timeline with stagger.
- Prize tier table: rows enter with small `y` and `autoAlpha` stagger.
- Ticket purchase success: new ticket card enters with `autoAlpha` and `y`.

Performance rules:

- Animate only `transform` and `autoAlpha`.
- Use timeline defaults for shared duration/easing.
- Use `stagger` instead of many manual delays.
- Respect `prefers-reduced-motion`; reduce durations to zero or skip nonessential animations.
- No ScrollTrigger in phase one because the app is an operational dashboard, not a scroll-driven page.

## Testing

Contract tests must cover:

- Game-specific ticket validation.
- Independent game prize pools.
- Independent game round state.
- Draw generation for all game types.
- Highest-tier-only winner registration.
- Tier winner counting.
- Tier prize-per-winner calculation.
- Multi-winner split within one tier.
- No-winner tier rollover.
- Reserve pool rollover.
- Claim prevention for unregistered, non-owner, duplicate, or losing tickets.

Frontend tests or helper tests should cover:

- Game definition validation.
- Number selection constraints.
- Digital repeat behavior.
- Unique-number behavior.
- Match preview helpers, if implemented client-side.

## Migration Notes

Existing deployed contracts cannot be upgraded in place. This phase requires deploying a new contract and updating `VITE_SUPER_LOTTERY_ADDRESS`.

The new contract must be added as a consumer in the Chainlink VRF subscription before `requestDraw(gameType)` can succeed.

## Out Of Scope

- Official real-world lottery prize rules.
- Fixed-odds payouts.
- Automatic scheduled draws.
- Backend indexing.
- Real-money compliance.
- Admin withdrawal from active prize pools.
