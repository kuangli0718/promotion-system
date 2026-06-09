# Super Lottery

Sepolia testnet demo for a simplified chain-based Da Le Tou lottery.

## What It Does

- Supports five game types: Digital, Number Lotto, Lotto, Base Lotto, and Keno.
- Lotto supports single tickets and small system tickets.
- Each game has its own current round, ticket validation, prize pool, draw, registration, and admin lifecycle.
- Ticket price defaults to `0.001 ETH`.
- Sepolia draws use Chainlink VRF v2.5.
- Local tests use owner-only test draw helpers.

## Setup

```bash
npm install
cp .env.example .env
npm test
npm run build
```

## Sepolia Deployment

Fill these values in `.env`:

```bash
SEPOLIA_RPC_URL=
PRIVATE_KEY=
VRF_COORDINATOR=
VRF_SUBSCRIPTION_ID=
VRF_KEY_HASH=
VRF_CALLBACK_GAS_LIMIT=500000
VRF_NATIVE_PAYMENT=true
VITE_SUPER_LOTTERY_ADDRESS=
```

Deploy:

```bash
npm run deploy:sepolia
```

After deploying the multi-game contract:

1. Add the new contract address as a consumer in the Chainlink VRF subscription.
2. Update `VITE_SUPER_LOTTERY_ADDRESS` in `.env` to the new contract address.
3. Start the frontend:

```bash
npm run dev -- --host 127.0.0.1
```

Admin actions are game-scoped. Close rounds, request draws, close registration, and start next rounds independently for each game.

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

## Lotto System Betting

The Lotto game supports system betting for convenience:

- Pick at least 5 front numbers and at least 2 back numbers.
- The contract expands the selection into normal Lotto tickets.
- Entry count is `C(front count, 5) * C(back count, 2)`.
- Maximum system size is 100 expanded entries.
- Total cost is `ticketPrice * entry count`.
- Prize registration and claiming still happen per expanded ticket.

The frontend shows entry count, total price, first-prize probability, and per-tier probability estimates before purchase.

Because this adds a new contract function, deploy a new contract and update `VITE_SUPER_LOTTERY_ADDRESS` before testing on Sepolia.

## Development

```bash
npm test
npm run build
```

The app is a testnet demo and is not suitable for real-money operation without legal, security, and operational review.
