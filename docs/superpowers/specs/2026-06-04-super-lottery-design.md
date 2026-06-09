# Super Lottery Testnet Demo Design

## Goal

Build an EVM testnet demo for a chain-based lottery inspired by Da Le Tou: users choose 5 front numbers from 1-35 and 2 back numbers from 1-12, buy tickets with test ETH, and a Chainlink VRF v2.5 draw produces provably fair winning numbers.

## Scope

The first version is a Sepolia demo, not a production gambling product. It uses testnet ETH, a simplified jackpot-only payout, and an admin-controlled round lifecycle so the full flow can be tested without building automation, compliance gates, or a full prize table.

## Architecture

The system has one Solidity contract, `SuperLottery`, plus a React/Vite frontend. The contract owns round state, ticket validation, ticket purchase, Chainlink VRF draw requests, winner registration, prize claims, and jackpot rollover. The frontend provides wallet connection, number selection, current-round display, ticket history, winner registration, claim actions, and a small admin panel.

## Lottery Rules

- Front area: choose exactly 5 unique numbers from 1 through 35.
- Back area: choose exactly 2 unique numbers from 1 through 12.
- Contract storage uses integers, not zero-padded strings.
- Frontend display pads numbers to two digits.
- The contract sorts numbers before storage and comparison.
- A ticket wins only when it matches all 5 front numbers and both back numbers.
- Other match counts may be displayed by the frontend, but they do not receive prizes in version one.

## Round Lifecycle

Rounds move through these states:

- `Open`: users can buy tickets.
- `Closed`: ticket sales are stopped.
- `Drawing`: a Chainlink VRF request has been submitted.
- `Drawn`: winning numbers are available and users can register winning tickets.
- `Claimable`: winning registration is closed and registered winners can claim.

The admin can close the current round, request the draw, close winner registration, and start the next round. Starting the next round rolls over any unclaimed or unwon jackpot according to the contract accounting.

## Randomness

Sepolia uses Chainlink VRF v2.5 subscription funding. The contract inherits the VRF v2.5 consumer base, stores the subscription ID, coordinator address, key hash, callback gas limit, request confirmations, and request-to-round mapping. Local tests use a mock draw path so behavior can be tested without a live oracle.

Random words are converted into unique lottery numbers by rejection sampling over the target range. This avoids modulo duplicates within each number area.

## Prize Accounting

Each ticket costs a fixed amount, initially `0.001 ether`. Ticket payments add to the active round jackpot. After the draw, users call `registerWinningTicket(roundId, ticketId)` for tickets they own. The contract verifies the ticket is a full match and has not already been registered.

When the admin closes registration, the contract calculates `prizePerWinner = jackpot / winnerCount` if there are winners. Winners then call `claimPrize(roundId, ticketId)`. If there are no winners, the full jackpot rolls into the next round.

## Frontend

The frontend is a single-page app with:

- Wallet connection.
- Current round status, ticket price, jackpot, and draw numbers.
- Number picker for 35 front numbers and 12 back numbers.
- Random pick and clear actions.
- Buy ticket action.
- My tickets list for the current account.
- Register winner and claim prize actions when allowed.
- Admin panel for lifecycle transactions.

## Testing

Contract tests cover:

- Number validation and sorting.
- Ticket price enforcement.
- Round state transitions.
- Ticket purchase restrictions by state.
- Draw number generation range and uniqueness.
- Full-match winner registration.
- Non-winning registration rejection.
- Duplicate registration rejection.
- Single winner claim.
- Multi-winner equal split.
- No-winner jackpot rollover.

Frontend tests are kept light in version one and focus on deterministic helpers for number formatting, random selection constraints, and match counting.

## Out Of Scope

- Mainnet deployment.
- Real-money operations.
- Legal compliance controls.
- Full Da Le Tou prize table.
- Bonus/extra ticket modes.
- Chainlink Automation.
- Backend indexing service.
