# Super Lottery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Sepolia-ready EVM testnet demo for a simplified chain-based Da Le Tou lottery.

**Architecture:** A Hardhat Solidity project provides the `SuperLottery` contract, deployment scripts, and tests. A Vite React frontend connects to the deployed contract and exposes user and admin flows. Local testing uses an owner-only test draw function enabled by constructor config, while Sepolia deployment uses Chainlink VRF v2.5.

**Tech Stack:** Solidity, Hardhat, TypeScript, React, Vite, ethers, Chainlink VRF v2.5.

---

## File Structure

- `contracts/SuperLottery.sol`: round state, ticket purchase, draw request, VRF fulfillment, winner registration, claims, rollover.
- `test/SuperLottery.test.js`: Hardhat tests for lottery behavior.
- `scripts/deploy.js`: deploys the contract using environment variables.
- `src/App.jsx`: frontend app shell and contract interaction.
- `src/lottery.js`: ABI import, contract address handling, number helpers, match helpers.
- `src/App.css`: application layout and visual styling.
- `src/main.jsx`: React entrypoint.
- `src/abi/SuperLottery.json`: frontend ABI copied from Hardhat artifacts.
- `.env.example`: required deploy and frontend variables.
- `package.json`, `hardhat.config.cjs`, `vite.config.js`, `index.html`: project tooling.

## Tasks

### Task 1: Project Tooling

**Files:**
- Create: `package.json`
- Create: `hardhat.config.cjs`
- Create: `vite.config.js`
- Create: `index.html`
- Create: `.gitignore`
- Create: `.env.example`

- [ ] Add dependencies and scripts for Hardhat tests, deployment, Vite dev, build, and ABI copying.
- [ ] Configure Solidity `0.8.24` and Sepolia RPC/account support through environment variables.
- [ ] Run `npm install`.

### Task 2: Contract Tests First

**Files:**
- Create: `test/SuperLottery.test.js`

- [ ] Write tests for valid ticket purchase, invalid number sets, price enforcement, lifecycle restrictions, local draw, winner registration, claim, multi-winner split, and rollover.
- [ ] Run `npx hardhat test` and verify the test file fails because `contracts/SuperLottery.sol` does not exist.

### Task 3: Contract Implementation

**Files:**
- Create: `contracts/SuperLottery.sol`

- [ ] Implement the minimal contract behavior needed by the failing tests.
- [ ] Run `npx hardhat test` until all contract tests pass.
- [ ] Refactor only after green tests, keeping behavior unchanged.

### Task 4: Deployment Script And ABI Export

**Files:**
- Create: `scripts/deploy.js`
- Create after compile: `src/abi/SuperLottery.json`

- [ ] Write a deploy script that reads Chainlink VRF and ticket config from environment variables.
- [ ] Add an ABI copy script target.
- [ ] Run `npx hardhat compile` and copy ABI.

### Task 5: Frontend Helpers And App

**Files:**
- Create: `src/lottery.js`
- Create: `src/main.jsx`
- Create: `src/App.jsx`
- Create: `src/App.css`

- [ ] Implement number formatting, selection, match counting, wallet connection, reads, writes, and admin actions.
- [ ] Keep the first screen as the usable lottery interface.
- [ ] Run `npm run build`.

### Task 6: Verification

**Files:**
- Modify as needed based on verification failures only.

- [ ] Run `npx hardhat test`.
- [ ] Run `npm run build`.
- [ ] Start `npm run dev -- --host 127.0.0.1` and provide the local URL.

## Self-Review

- Spec coverage: contract lifecycle, number rules, VRF path, jackpot-only payout, frontend user/admin flows, and tests are covered.
- Placeholder scan: no task depends on undefined future work.
- Type consistency: files and contract names are consistent across tasks.
