import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";

const GAME_DIGITAL = 0;
const GAME_NUMBER_LOTTO = 1;
const GAME_LOTTO = 2;
const GAME_BASE_LOTTO = 3;
const GAME_KENO = 4;
const MAX_LOTTO_SYSTEM_ENTRIES = 100n;
const BPS_DENOMINATOR = 10_000n;
const DEFAULT_STIMULUS_BPS = 10_000n;
const DEFAULT_PROMOTION_BPS = 0n;
const DEFAULT_REFERRAL_REWARD_BPS = 5_000n;
const DEFAULT_MAX_PROMOTERS = 200n;

const time = {
  async latest() {
    const connection = await network.getOrCreate();
    const latestBlock = await connection.provider.request({
      method: "eth_getBlockByNumber",
      params: ["latest", false],
    });
    return Number(BigInt(latestBlock.timestamp));
  },
  async increaseTo(timestamp) {
    const connection = await network.getOrCreate();
    await connection.provider.request({
      method: "evm_setNextBlockTimestamp",
      params: [Number(timestamp)],
    });
    await connection.provider.request({
      method: "evm_mine",
      params: [],
    });
  },
  async setNextBlockTimestamp(timestamp) {
    const connection = await network.getOrCreate();
    await connection.provider.request({
      method: "evm_setNextBlockTimestamp",
      params: [Number(timestamp)],
    });
  },
};

const ticketPrice = 1_000_000_000_000_000n;
const zeroHash = "0x0000000000000000000000000000000000000000000000000000000000000000";
const zeroAddress = "0x0000000000000000000000000000000000000000";

async function deployLottery() {
  return deployLotteryWithTicketPrice(ticketPrice);
}

async function deployLotteryWithTicketPrice(price) {
  const { ethers } = await network.getOrCreate();
  const [owner, alice, bob, carol] = await ethers.getSigners();
  const Lottery = await ethers.getContractFactory("SuperLottery");
  const lottery = await Lottery.deploy(
    price,
    zeroAddress,
    0,
    zeroHash,
    500000,
    true,
    true
  );
  await lottery.waitForDeployment();
  return { ethers, lottery, owner, alice, bob, carol, ticketPrice: price };
}

async function deployLotteryWithMockCoordinator() {
  const { ethers } = await network.getOrCreate();
  const [owner, alice, bob, carol] = await ethers.getSigners();
  const MockVRFCoordinator = await ethers.getContractFactory("MockVRFCoordinator");
  const coordinator = await MockVRFCoordinator.deploy();
  await coordinator.waitForDeployment();
  const Lottery = await ethers.getContractFactory("SuperLottery");
  const lottery = await Lottery.deploy(
    ticketPrice,
    await coordinator.getAddress(),
    1,
    zeroHash,
    500000,
    false,
    true
  );
  await lottery.waitForDeployment();
  return { ethers, lottery, coordinator, owner, alice, bob, carol, ticketPrice };
}

function numbers(values) {
  return values.map(Number);
}

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

const DAY = 24n * 60n * 60n;

function nextUtcMidnight(timestamp) {
  const value = BigInt(timestamp);
  return ((value / DAY) + 1n) * DAY;
}

async function latestTimestamp() {
  return BigInt(await time.latest());
}

async function moveTo(timestamp) {
  if (await latestTimestamp() < BigInt(timestamp)) {
    await time.increaseTo(Number(timestamp));
  }
}

async function setNextBlockTimestamp(timestamp) {
  await time.setNextBlockTimestamp(Number(timestamp));
}

function requireRoundTiming(round) {
  assert.equal(typeof round.openTime, "bigint");
  assert.equal(typeof round.closeTime, "bigint");
  assert.equal(typeof round.drawTime, "bigint");
}

async function closeRoundAfterCutoff(lottery, gameType) {
  const roundId = await lottery.currentRoundId(gameType);
  const round = await lottery.getRound(gameType, roundId);
  requireRoundTiming(round);
  if (await latestTimestamp() < round.closeTime) {
    await setNextBlockTimestamp(round.closeTime);
  }
  await lottery.closeRound(gameType);
}

function assertUniqueInRange(values, length, min, max) {
  const drawn = numbers(values);
  assert.equal(drawn.length, length);
  assert.equal(new Set(drawn).size, length);
  assert.ok(drawn.every((value) => value >= min && value <= max));
}

async function assertTierConfig(lottery, gameType, index, expected) {
  const tier = await lottery.gamePrizeTiers(gameType, index);
  assert.equal(tier.tierId, BigInt(expected.tierId));
  assert.equal(tier.mainMatch, BigInt(expected.mainMatch));
  assert.equal(tier.extraMatch, BigInt(expected.extraMatch));
  assert.equal(tier.weight, BigInt(expected.weight));
  assert.equal(tier.maxPoolBps, BigInt(expected.maxPoolBps));
  assert.equal(tier.maxPrizePerWinner, expected.maxPrizePerWinner);
}

function minBigInt(a, b) {
  return a < b ? a : b;
}

function weightedPrizePerWinner(prizePool, reserveBps, tier, winners, totalEffectiveWeight) {
  const availablePool = prizePool - (prizePool * BigInt(reserveBps) / BPS_DENOMINATOR);
  const effectiveWeight = BigInt(tier.weight) * BigInt(winners);
  const rawTierPool = availablePool * effectiveWeight / totalEffectiveWeight;
  const tierCap = availablePool * BigInt(tier.maxPoolBps) / BPS_DENOMINATOR;
  const cappedTierPool = minBigInt(rawTierPool, tierCap);
  return minBigInt(cappedTierPool / BigInt(winners), tier.maxPrizePerWinner);
}

async function prepareRegisteredLottoWinner(lottery, alice) {
  await lottery.connect(alice).buyTicket(GAME_LOTTO, [1, 2, 3, 4, 5], [1, 2], { value: ticketPrice });
  await closeRoundAfterCutoff(lottery, GAME_LOTTO);
  await lottery.testDrawFixed(GAME_LOTTO, [1, 2, 3, 4, 5], [1, 2]);
  await lottery.connect(alice).registerWinningTicket(GAME_LOTTO, 1, 0);
  await lottery.closeRegistration(GAME_LOTTO, 1);
}

describe("SuperLottery multi-game prize pools", () => {
  it("initializes default promotion config and locks it into first rounds", async () => {
    const { lottery } = await deployLottery();

    for (const gameType of [GAME_DIGITAL, GAME_NUMBER_LOTTO, GAME_LOTTO, GAME_BASE_LOTTO, GAME_KENO]) {
      const config = await lottery.promotionConfigs(gameType);
      assert.equal(config.stimulusBps, DEFAULT_STIMULUS_BPS);
      assert.equal(config.promotionBps, DEFAULT_PROMOTION_BPS);
      assert.equal(config.referralRewardBps, DEFAULT_REFERRAL_REWARD_BPS);
      assert.equal(config.maxPromotersPerRound, DEFAULT_MAX_PROMOTERS);

      const round = await lottery.getRound(gameType, 1);
      assert.equal(round.stimulusBps, DEFAULT_STIMULUS_BPS);
      assert.equal(round.promotionBps, DEFAULT_PROMOTION_BPS);
      assert.equal(round.referralRewardBps, DEFAULT_REFERRAL_REWARD_BPS);
      assert.equal(round.maxPromotersPerRound, DEFAULT_MAX_PROMOTERS);
      assert.equal(round.promotionPool, 0n);
      assert.equal(round.promotionPaid, 0n);
    }
  });

  it("allows only the owner to update per-game promotion config", async () => {
    const { lottery, alice } = await deployLottery();

    await assert.rejects(
      lottery.connect(alice).setPromotionConfig(GAME_LOTTO, 7000, 3000, 5000, 100),
      /OnlyOwner|0x5fc483c5/
    );

    await lottery.setPromotionConfig(GAME_LOTTO, 7000, 3000, 5000, 100);
    const config = await lottery.promotionConfigs(GAME_LOTTO);
    assert.equal(config.stimulusBps, 7000n);
    assert.equal(config.promotionBps, 3000n);
    assert.equal(config.referralRewardBps, 5000n);
    assert.equal(config.maxPromotersPerRound, 100n);
  });

  it("rejects invalid promotion config values", async () => {
    const { lottery } = await deployLottery();

    await assert.rejects(
      lottery.setPromotionConfig(GAME_LOTTO, 7000, 2000, 5000, 100),
      /InvalidPromotionConfig/
    );
    await assert.rejects(
      lottery.setPromotionConfig(GAME_LOTTO, 7000, 3000, 10000, 100),
      /InvalidPromotionConfig/
    );
    await assert.rejects(
      lottery.setPromotionConfig(GAME_LOTTO, 7000, 3000, 5000, 0),
      /InvalidPromotionConfig/
    );
    await assert.rejects(
      lottery.setPromotionConfig(99, 7000, 3000, 5000, 100),
      /InvalidGameType/
    );
  });

  it("locks updated promotion config only into future rounds", async () => {
    const { lottery, alice, ticketPrice } = await deployLottery();

    await lottery.setPromotionConfig(GAME_LOTTO, 7000, 3000, 5000, 100);
    const round1 = await lottery.getRound(GAME_LOTTO, 1);
    assert.equal(round1.stimulusBps, DEFAULT_STIMULUS_BPS);
    assert.equal(round1.promotionBps, DEFAULT_PROMOTION_BPS);

    await lottery.connect(alice).buyTicket(GAME_LOTTO, [1, 2, 3, 4, 6], [1, 3], { value: ticketPrice });
    await closeRoundAfterCutoff(lottery, GAME_LOTTO);
    await lottery.testDrawFixed(GAME_LOTTO, [1, 2, 3, 4, 5], [1, 2]);
    await lottery.closeRegistration(GAME_LOTTO, 1);
    await lottery.startNextRound(GAME_LOTTO);

    const round2 = await lottery.getRound(GAME_LOTTO, 2);
    assert.equal(round2.stimulusBps, 7000n);
    assert.equal(round2.promotionBps, 3000n);
    assert.equal(round2.referralRewardBps, 5000n);
    assert.equal(round2.maxPromotersPerRound, 100n);
  });

  it("initializes each game round with UTC daily timing", async () => {
    const { lottery } = await deployLottery();
    const now = await latestTimestamp();

    for (const gameType of [GAME_DIGITAL, GAME_NUMBER_LOTTO, GAME_LOTTO, GAME_BASE_LOTTO, GAME_KENO]) {
      const round = await lottery.getRound(gameType, 1);
      requireRoundTiming(round);
      assert.ok(round.openTime <= now);
      assert.equal(round.closeTime, nextUtcMidnight(round.openTime));
      assert.equal(round.drawTime, 0n);
    }
  });

  it("allows buying before closeTime and rejects buying at closeTime", async () => {
    const { lottery, alice, ticketPrice } = await deployLottery();
    const round = await lottery.getRound(GAME_LOTTO, 1);
    requireRoundTiming(round);

    // RoundNotStarted is not directly reachable through the public lifecycle:
    // initial and next rounds open at or before the current block timestamp.
    await moveTo(round.closeTime - 2n);
    await lottery.connect(alice).buyTicket(GAME_LOTTO, [1, 2, 3, 4, 5], [1, 2], { value: ticketPrice });

    await setNextBlockTimestamp(round.closeTime);
    await assert.rejects(
      lottery.connect(alice).buyTicket(GAME_LOTTO, [6, 7, 8, 9, 10], [3, 4], { value: ticketPrice }),
      /RoundSalesClosed/
    );
  });

  it("prevents closing before closeTime and allows closing at closeTime", async () => {
    const { lottery } = await deployLottery();
    const round = await lottery.getRound(GAME_KENO, 1);
    requireRoundTiming(round);

    await assert.rejects(
      lottery.closeRound(GAME_KENO),
      /RoundCloseTimeNotReached/
    );

    await setNextBlockTimestamp(round.closeTime);
    await lottery.closeRound(GAME_KENO);

    const closed = await lottery.getRound(GAME_KENO, 1);
    assert.equal(closed.status, 1n);
  });

  it("records drawTime when VRF fulfillment sets winning numbers", async () => {
    const { lottery, coordinator } = await deployLotteryWithMockCoordinator();
    const round = await lottery.getRound(GAME_KENO, 1);
    requireRoundTiming(round);

    await closeRoundAfterCutoff(lottery, GAME_KENO);
    await lottery.requestDraw(GAME_KENO);
    const requestId = await coordinator.lastRequestId();

    await coordinator.fulfill(await lottery.getAddress(), requestId, 123456789n);

    const drawn = await lottery.getRound(GAME_KENO, 1);
    requireRoundTiming(drawn);
    assert.equal(drawn.status, 3n);
    assert.ok(drawn.drawTime >= round.closeTime);
  });

  it("records drawTime when fixed local testing sets winning numbers", async () => {
    const { lottery } = await deployLottery();
    const round = await lottery.getRound(GAME_LOTTO, 1);
    requireRoundTiming(round);

    await closeRoundAfterCutoff(lottery, GAME_LOTTO);
    await lottery.testDrawFixed(GAME_LOTTO, [1, 2, 3, 4, 5], [1, 2]);

    const drawn = await lottery.getRound(GAME_LOTTO, 1);
    requireRoundTiming(drawn);
    assert.equal(drawn.status, 3n);
    assert.ok(drawn.drawTime >= round.closeTime);
  });

  it("prevents non-owners from closing rounds", async () => {
    const { lottery, alice } = await deployLottery();

    await assert.rejects(
      lottery.connect(alice).closeRound(GAME_KENO),
      /OnlyOwner|0x5fc483c5/
    );
  });

  it("prevents requesting a draw before the round is closed", async () => {
    const { lottery } = await deployLotteryWithMockCoordinator();

    await assert.rejects(
      lottery.requestDraw(GAME_KENO),
      /RoundNotClosed/
    );
  });

  it("starts the next round on the next UTC daily window", async () => {
    const { lottery, alice, ticketPrice } = await deployLottery();
    const round = await lottery.getRound(GAME_LOTTO, 1);
    requireRoundTiming(round);

    await lottery.connect(alice).buyTicket(GAME_LOTTO, [1, 2, 3, 4, 5], [1, 2], { value: ticketPrice });
    await closeRoundAfterCutoff(lottery, GAME_LOTTO);
    await lottery.testDrawFixed(GAME_LOTTO, [1, 2, 3, 4, 5], [1, 2]);
    await lottery.connect(alice).registerWinningTicket(GAME_LOTTO, 1, 0);
    await lottery.closeRegistration(GAME_LOTTO, 1);
    await lottery.startNextRound(GAME_LOTTO);

    const next = await lottery.getRound(GAME_LOTTO, 2);
    requireRoundTiming(next);
    assert.equal(next.openTime, round.closeTime);
    assert.equal(next.closeTime, round.closeTime + DAY);
    assert.equal(next.drawTime, 0n);
  });

  it("advances late next rounds so the new closeTime is in the future", async () => {
    const { lottery } = await deployLottery();
    const round = await lottery.getRound(GAME_KENO, 1);
    requireRoundTiming(round);

    await closeRoundAfterCutoff(lottery, GAME_KENO);
    await lottery.testDrawFixed(GAME_KENO, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], []);
    await lottery.closeRegistration(GAME_KENO, 1);

    await moveTo(round.closeTime + (3n * DAY) + 120n);
    await lottery.startNextRound(GAME_KENO);

    const now = await latestTimestamp();
    const next = await lottery.getRound(GAME_KENO, 2);
    requireRoundTiming(next);
    assert.ok(next.openTime <= now);
    assert.ok(next.closeTime > now);
    assert.equal(next.closeTime % DAY, 0n);
  });

  it("configures prize tiers and explicit reserves from the design spec", async () => {
    const { lottery, ticketPrice } = await deployLottery();

    const expectedTiers = new Map([
      [GAME_DIGITAL, [
        { tierId: 1, mainMatch: 4, extraMatch: 0, weight: 15848932, maxPoolBps: 8000, maxPrizePerWinner: ticketPrice * 1000n },
        { tierId: 2, mainMatch: 4, extraMatch: 0, weight: 6824481, maxPoolBps: 5000, maxPrizePerWinner: ticketPrice * 300n },
        { tierId: 3, mainMatch: 3, extraMatch: 0, weight: 8198365, maxPoolBps: 3000, maxPrizePerWinner: ticketPrice * 100n },
        { tierId: 4, mainMatch: 2, extraMatch: 0, weight: 4121323, maxPoolBps: 1500, maxPrizePerWinner: ticketPrice * 30n },
      ]],
      [GAME_NUMBER_LOTTO, [
        { tierId: 1, mainMatch: 3, extraMatch: 3, weight: 65625323, maxPoolBps: 8000, maxPrizePerWinner: ticketPrice * 1000n },
        { tierId: 2, mainMatch: 3, extraMatch: 2, weight: 20174390, maxPoolBps: 5000, maxPrizePerWinner: ticketPrice * 300n },
        { tierId: 3, mainMatch: 2, extraMatch: 3, weight: 33946789, maxPoolBps: 3000, maxPrizePerWinner: ticketPrice * 100n },
        { tierId: 4, mainMatch: 3, extraMatch: 0, weight: 8055320, maxPoolBps: 1500, maxPrizePerWinner: ticketPrice * 30n },
      ]],
      [GAME_LOTTO, [
        { tierId: 1, mainMatch: 5, extraMatch: 2, weight: 158226995, maxPoolBps: 8000, maxPrizePerWinner: ticketPrice * 1000n },
        { tierId: 2, mainMatch: 5, extraMatch: 1, weight: 64412711, maxPoolBps: 5000, maxPrizePerWinner: ticketPrice * 300n },
        { tierId: 3, mainMatch: 5, extraMatch: 0, weight: 50502959, maxPoolBps: 3000, maxPrizePerWinner: ticketPrice * 100n },
        { tierId: 4, mainMatch: 4, extraMatch: 2, weight: 35192750, maxPoolBps: 1500, maxPrizePerWinner: ticketPrice * 30n },
        { tierId: 5, mainMatch: 4, extraMatch: 1, weight: 14326635, maxPoolBps: 800, maxPrizePerWinner: ticketPrice * 10n },
      ]],
      [GAME_BASE_LOTTO, [
        { tierId: 1, mainMatch: 8, extraMatch: 2, weight: 168151364, maxPoolBps: 8000, maxPrizePerWinner: ticketPrice * 1000n },
        { tierId: 2, mainMatch: 7, extraMatch: 2, weight: 53670624, maxPoolBps: 5000, maxPrizePerWinner: ticketPrice * 300n },
        { tierId: 3, mainMatch: 8, extraMatch: 1, weight: 68452828, maxPoolBps: 3000, maxPrizePerWinner: ticketPrice * 100n },
        { tierId: 4, mainMatch: 7, extraMatch: 1, weight: 21848803, maxPoolBps: 1500, maxPrizePerWinner: ticketPrice * 30n },
      ]],
      [GAME_KENO, [
        { tierId: 1, mainMatch: 10, extraMatch: 0, weight: 121615332, maxPoolBps: 8000, maxPrizePerWinner: ticketPrice * 1000n },
        { tierId: 2, mainMatch: 9, extraMatch: 0, weight: 36640447, maxPoolBps: 5000, maxPrizePerWinner: ticketPrice * 300n },
        { tierId: 3, mainMatch: 8, extraMatch: 0, weight: 14470908, maxPoolBps: 3000, maxPrizePerWinner: ticketPrice * 100n },
        { tierId: 4, mainMatch: 7, extraMatch: 0, weight: 6884300, maxPoolBps: 1500, maxPrizePerWinner: ticketPrice * 30n },
      ]],
    ]);

    for (const [gameType, tiers] of expectedTiers.entries()) {
      for (let index = 0; index < tiers.length; index++) {
        await assertTierConfig(lottery, gameType, index, tiers[index]);
      }
      assert.equal(await lottery.reserveBps(gameType), 500n);
    }
  });

  it("accepts valid tickets for all games and stores normalized picks", async () => {
    const { lottery, alice } = await deployLottery();

    await lottery.connect(alice).buyTicket(GAME_LOTTO, [5, 1, 35, 8, 21], [12, 2], { value: ticketPrice });
    await lottery.connect(alice).buyTicket(GAME_KENO, [10, 1, 9, 2, 8, 3, 7, 4, 6, 5], [], { value: ticketPrice });
    await lottery.connect(alice).buyTicket(GAME_DIGITAL, [1, 1, 2, 3], [], { value: ticketPrice });
    await lottery.connect(alice).buyTicket(GAME_NUMBER_LOTTO, [3, 1, 3], [20, 1, 10], { value: ticketPrice });
    await lottery.connect(alice).buyTicket(GAME_BASE_LOTTO, [8, 1, 7, 2, 6, 3, 5, 4], [12, 1], { value: ticketPrice });

    const lottoTicket = await lottery.getTicket(GAME_LOTTO, 1, 0);
    assert.equal(lottoTicket.buyer, alice.address);
    assert.equal(lottoTicket.gameType, BigInt(GAME_LOTTO));
    assert.deepEqual(numbers(lottoTicket.mainNumbers), [1, 5, 8, 21, 35]);
    assert.deepEqual(numbers(lottoTicket.extraNumbers), [2, 12]);
    assert.equal(await lottery.getRoundTicketCount(GAME_LOTTO, 1), 1n);

    const kenoTicket = await lottery.getTicket(GAME_KENO, 1, 0);
    assert.equal(kenoTicket.gameType, BigInt(GAME_KENO));
    assert.deepEqual(numbers(kenoTicket.mainNumbers), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    assert.deepEqual(numbers(kenoTicket.extraNumbers), []);

    const digitalTicket = await lottery.getTicket(GAME_DIGITAL, 1, 0);
    assert.equal(digitalTicket.gameType, BigInt(GAME_DIGITAL));
    assert.deepEqual(numbers(digitalTicket.mainNumbers), [1, 1, 2, 3]);
    assert.deepEqual(numbers(digitalTicket.extraNumbers), []);

    const numberLottoTicket = await lottery.getTicket(GAME_NUMBER_LOTTO, 1, 0);
    assert.equal(numberLottoTicket.gameType, BigInt(GAME_NUMBER_LOTTO));
    assert.deepEqual(numbers(numberLottoTicket.mainNumbers), [3, 1, 3]);
    assert.deepEqual(numbers(numberLottoTicket.extraNumbers), [1, 10, 20]);

    const baseLottoTicket = await lottery.getTicket(GAME_BASE_LOTTO, 1, 0);
    assert.equal(baseLottoTicket.gameType, BigInt(GAME_BASE_LOTTO));
    assert.deepEqual(numbers(baseLottoTicket.mainNumbers), [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.deepEqual(numbers(baseLottoTicket.extraNumbers), [1, 12]);
  });

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

  it("rejects invalid picks using game-specific validation", async () => {
    const { lottery, alice } = await deployLottery();

    await assert.rejects(
      lottery.connect(alice).buyTicket(GAME_LOTTO, [1, 1, 2, 3, 4], [1, 2], { value: ticketPrice }),
      /DuplicateNumber/
    );
    await assert.rejects(
      lottery.connect(alice).buyTicket(GAME_LOTTO, [1, 2, 3, 4, 36], [1, 2], { value: ticketPrice }),
      /InvalidMainNumber/
    );
    await assert.rejects(
      lottery.connect(alice).buyTicket(GAME_KENO, [1, 2, 3, 4, 5, 6, 7, 8, 9], [], { value: ticketPrice }),
      /InvalidMainNumberCount/
    );
    await assert.rejects(
      lottery.connect(alice).buyTicket(GAME_DIGITAL, [1, 2, 3, 10], [], { value: ticketPrice }),
      /InvalidMainNumber/
    );
    await assert.rejects(
      lottery.connect(alice).buyTicket(GAME_NUMBER_LOTTO, [3, 1, 3], [1, 1, 10], { value: ticketPrice }),
      /DuplicateNumber/
    );
  });

  it("keeps prize pools independent between games", async () => {
    const { lottery, alice, bob } = await deployLottery();

    await lottery.connect(alice).buyTicket(GAME_DIGITAL, [1, 2, 3, 4], [], { value: ticketPrice });
    await lottery.connect(bob).buyTicket(GAME_LOTTO, [1, 2, 3, 4, 5], [1, 2], { value: ticketPrice });

    const digitalRound = await lottery.getRound(GAME_DIGITAL, 1);
    const lottoRound = await lottery.getRound(GAME_LOTTO, 1);
    assert.equal(digitalRound.prizePool, ticketPrice);
    assert.equal(lottoRound.prizePool, ticketPrice);
  });

  it("generates valid local test draws for every game", async () => {
    const { lottery } = await deployLottery();

    await closeRoundAfterCutoff(lottery, GAME_DIGITAL);
    await lottery.testDraw(GAME_DIGITAL, 12345);
    const digitalRound = await lottery.getRound(GAME_DIGITAL, 1);
    assert.equal(digitalRound.status, 3n);
    assert.equal(digitalRound.winningMain.length, 4);
    assert.deepEqual(numbers(digitalRound.winningExtra), []);
    assert.ok(numbers(digitalRound.winningMain).every((value) => value >= 0 && value <= 9));

    await closeRoundAfterCutoff(lottery, GAME_NUMBER_LOTTO);
    await lottery.testDraw(GAME_NUMBER_LOTTO, 12345);
    const numberLottoRound = await lottery.getRound(GAME_NUMBER_LOTTO, 1);
    assert.equal(numberLottoRound.status, 3n);
    assert.equal(numberLottoRound.winningMain.length, 3);
    assertUniqueInRange(numberLottoRound.winningExtra, 3, 1, 20);

    await closeRoundAfterCutoff(lottery, GAME_LOTTO);
    await lottery.testDraw(GAME_LOTTO, 12345);
    const lottoRound = await lottery.getRound(GAME_LOTTO, 1);
    assert.equal(lottoRound.status, 3n);
    assertUniqueInRange(lottoRound.winningMain, 5, 1, 35);
    assertUniqueInRange(lottoRound.winningExtra, 2, 1, 12);

    await closeRoundAfterCutoff(lottery, GAME_BASE_LOTTO);
    await lottery.testDraw(GAME_BASE_LOTTO, 12345);
    const baseLottoRound = await lottery.getRound(GAME_BASE_LOTTO, 1);
    assert.equal(baseLottoRound.status, 3n);
    assertUniqueInRange(baseLottoRound.winningMain, 15, 1, 60);
    assertUniqueInRange(baseLottoRound.winningExtra, 2, 1, 12);

    await closeRoundAfterCutoff(lottery, GAME_KENO);
    await lottery.testDraw(GAME_KENO, 12345);
    const kenoRound = await lottery.getRound(GAME_KENO, 1);
    assert.equal(kenoRound.status, 3n);
    assertUniqueInRange(kenoRound.winningMain, 20, 1, 80);
    assert.deepEqual(numbers(kenoRound.winningExtra), []);
  });

  it("registers winning tickets at the highest matching tier", async () => {
    const { lottery, alice, bob } = await deployLottery();

    await lottery.connect(alice).buyTicket(GAME_LOTTO, [1, 2, 3, 4, 5], [1, 2], { value: ticketPrice });
    await lottery.connect(alice).buyTicket(GAME_DIGITAL, [1, 1, 2, 3], [], { value: ticketPrice });
    await lottery.connect(bob).buyTicket(GAME_KENO, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], [], { value: ticketPrice });

    await closeRoundAfterCutoff(lottery, GAME_LOTTO);
    await lottery.testDrawFixed(GAME_LOTTO, [1, 2, 3, 4, 5], [1, 2]);
    await lottery.connect(alice).registerWinningTicket(GAME_LOTTO, 1, 0);
    assert.equal(await lottery.registeredTicketTier(GAME_LOTTO, 1, 0), 1n);

    await closeRoundAfterCutoff(lottery, GAME_DIGITAL);
    await lottery.testDrawFixed(GAME_DIGITAL, [1, 2, 1, 3], []);
    await lottery.connect(alice).registerWinningTicket(GAME_DIGITAL, 1, 0);
    assert.equal(await lottery.registeredTicketTier(GAME_DIGITAL, 1, 0), 2n);

    await closeRoundAfterCutoff(lottery, GAME_KENO);
    await lottery.testDrawFixed(
      GAME_KENO,
      [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30],
      []
    );
    await assert.rejects(
      lottery.connect(bob).registerWinningTicket(GAME_KENO, 1, 0),
      /TicketDidNotWin/
    );
  });

  it("uses ordered digital matching for NumberLotto tiers", async () => {
    async function play(ticketMain, ticketExtra, drawMain, drawExtra) {
      const { lottery, alice } = await deployLottery();
      await lottery.connect(alice).buyTicket(GAME_NUMBER_LOTTO, ticketMain, ticketExtra, { value: ticketPrice });
      await closeRoundAfterCutoff(lottery, GAME_NUMBER_LOTTO);
      await lottery.testDrawFixed(GAME_NUMBER_LOTTO, drawMain, drawExtra);
      return { lottery, alice };
    }

    {
      const { lottery, alice } = await play([1, 2, 3], [1, 2, 3], [3, 2, 1], [1, 2, 3]);
      await assert.rejects(
        lottery.connect(alice).registerWinningTicket(GAME_NUMBER_LOTTO, 1, 0),
        /TicketDidNotWin/
      );
    }

    {
      const { lottery, alice } = await play([1, 2, 3], [1, 2, 3], [9, 2, 3], [1, 2, 3]);
      await lottery.connect(alice).registerWinningTicket(GAME_NUMBER_LOTTO, 1, 0);
      assert.equal(await lottery.registeredTicketTier(GAME_NUMBER_LOTTO, 1, 0), 3n);
    }

    {
      const { lottery, alice } = await play([1, 2, 3], [1, 2, 3], [1, 2, 3], [1, 2, 9]);
      await lottery.connect(alice).registerWinningTicket(GAME_NUMBER_LOTTO, 1, 0);
      assert.equal(await lottery.registeredTicketTier(GAME_NUMBER_LOTTO, 1, 0), 2n);
    }

    {
      const { lottery, alice } = await play([1, 2, 3], [4, 5, 6], [1, 2, 3], [1, 2, 3]);
      await lottery.connect(alice).registerWinningTicket(GAME_NUMBER_LOTTO, 1, 0);
      assert.equal(await lottery.registeredTicketTier(GAME_NUMBER_LOTTO, 1, 0), 4n);
    }
  });

  it("requires fixed test draws to use game draw counts", async () => {
    const { lottery } = await deployLottery();

    await closeRoundAfterCutoff(lottery, GAME_LOTTO);
    await assert.rejects(
      lottery.testDrawFixed(GAME_LOTTO, [1, 2, 3, 4], [1, 2]),
      /InvalidMainNumberCount/
    );

    await closeRoundAfterCutoff(lottery, GAME_KENO);
    await assert.rejects(
      lottery.testDrawFixed(GAME_KENO, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], []),
      /InvalidMainNumberCount/
    );

    await closeRoundAfterCutoff(lottery, GAME_DIGITAL);
    await assert.rejects(
      lottery.testDrawFixed(GAME_DIGITAL, [1, 2, 3], []),
      /InvalidMainNumberCount/
    );
  });

  it("accounts for tier prizes and winner splits", async () => {
    const { lottery, alice, bob } = await deployLottery();

    await lottery.connect(alice).buyTicket(GAME_LOTTO, [1, 2, 3, 4, 5], [1, 2], { value: ticketPrice });
    await closeRoundAfterCutoff(lottery, GAME_LOTTO);
    await lottery.testDrawFixed(GAME_LOTTO, [1, 2, 3, 4, 5], [1, 2]);
    await lottery.connect(alice).registerWinningTicket(GAME_LOTTO, 1, 0);
    await lottery.closeRegistration(GAME_LOTTO, 1);

    const tier1 = await lottery.gamePrizeTiers(GAME_LOTTO, 0);
    const round1 = await lottery.getRound(GAME_LOTTO, 1);
    const round1Prize = weightedPrizePerWinner(round1.prizePool, 500, tier1, 1, tier1.weight);
    assert.equal(await lottery.tierWinnerCounts(GAME_LOTTO, 1, 1), 1n);
    assert.equal(await lottery.tierPrizePerWinner(GAME_LOTTO, 1, 1), round1Prize);
    assert.equal(await lottery.rolloverReserve(GAME_LOTTO), round1.prizePool - round1Prize);

    await lottery.startNextRound(GAME_LOTTO);
    await lottery.connect(alice).buyTicket(GAME_LOTTO, [1, 2, 3, 4, 5], [1, 2], { value: ticketPrice });
    await lottery.connect(bob).buyTicket(GAME_LOTTO, [5, 4, 3, 2, 1], [2, 1], { value: ticketPrice });
    await closeRoundAfterCutoff(lottery, GAME_LOTTO);
    await lottery.testDrawFixed(GAME_LOTTO, [1, 2, 3, 4, 5], [1, 2]);
    await lottery.connect(alice).registerWinningTicket(GAME_LOTTO, 2, 0);
    await lottery.connect(bob).registerWinningTicket(GAME_LOTTO, 2, 1);
    await lottery.closeRegistration(GAME_LOTTO, 2);

    assert.equal(await lottery.tierWinnerCounts(GAME_LOTTO, 2, 1), 2n);
    const round2 = await lottery.getRound(GAME_LOTTO, 2);
    const round2Prize = weightedPrizePerWinner(round2.prizePool, 500, tier1, 2, tier1.weight * 2n);
    assert.equal(await lottery.tierPrizePerWinner(GAME_LOTTO, 2, 1), round2Prize);
  });

  it("always rolls explicit reserve bps in addition to no-winner tiers", async () => {
    const { lottery, alice } = await deployLottery();

    await lottery.connect(alice).buyTicket(GAME_LOTTO, [1, 2, 3, 4, 5], [1, 2], { value: ticketPrice });
    await closeRoundAfterCutoff(lottery, GAME_LOTTO);
    await lottery.testDrawFixed(GAME_LOTTO, [1, 2, 3, 4, 5], [1, 2]);
    await lottery.connect(alice).registerWinningTicket(GAME_LOTTO, 1, 0);
    await lottery.closeRegistration(GAME_LOTTO, 1);

    const tier1 = await lottery.gamePrizeTiers(GAME_LOTTO, 0);
    const round = await lottery.getRound(GAME_LOTTO, 1);
    const prize = weightedPrizePerWinner(round.prizePool, 500, tier1, 1, tier1.weight);
    assert.equal(await lottery.tierPrizePerWinner(GAME_LOTTO, 1, 1), prize);
    assert.equal(await lottery.rolloverReserve(GAME_LOTTO), round.prizePool - prize);
  });

  it("caps a lone low-tier Lotto winner so the full pool cannot be drained", async () => {
    const { lottery, alice, ticketPrice } = await deployLottery();

    await lottery.connect(alice).buyTicket(GAME_LOTTO, [1, 2, 3, 4, 6], [1, 3], { value: ticketPrice });
    await closeRoundAfterCutoff(lottery, GAME_LOTTO);
    await lottery.testDrawFixed(GAME_LOTTO, [1, 2, 3, 4, 5], [1, 2]);
    await lottery.connect(alice).registerWinningTicket(GAME_LOTTO, 1, 0);
    assert.equal(await lottery.registeredTicketTier(GAME_LOTTO, 1, 0), 5n);
    await lottery.closeRegistration(GAME_LOTTO, 1);

    const round = await lottery.getRound(GAME_LOTTO, 1);
    const tier5 = await lottery.gamePrizeTiers(GAME_LOTTO, 4);
    const availablePool = round.prizePool - (round.prizePool * 500n / BPS_DENOMINATOR);
    const tierCap = availablePool * tier5.maxPoolBps / BPS_DENOMINATOR;
    const prize = await lottery.tierPrizePerWinner(GAME_LOTTO, 1, 5);

    assert.equal(prize, tierCap);
    assert.ok(prize < round.prizePool);
    assert.equal(round.reserveRollover, round.prizePool - prize);
  });

  it("rolls the whole prize pool when no winning tickets are registered", async () => {
    const { lottery, alice, ticketPrice } = await deployLottery();

    await lottery.connect(alice).buyTicket(GAME_LOTTO, [10, 11, 12, 13, 14], [8, 9], { value: ticketPrice });
    await closeRoundAfterCutoff(lottery, GAME_LOTTO);
    await lottery.testDrawFixed(GAME_LOTTO, [1, 2, 3, 4, 5], [1, 2]);
    await lottery.closeRegistration(GAME_LOTTO, 1);

    const round = await lottery.getRound(GAME_LOTTO, 1);
    assert.equal(round.reserveRollover, round.prizePool);
    assert.equal(await lottery.rolloverReserve(GAME_LOTTO), round.prizePool);
  });

  it("rolls tier prize division and allocation dust into rollover", async () => {
    const { lottery, alice, bob, carol } = await deployLotteryWithTicketPrice(1n);

    await lottery.connect(alice).buyTicket(GAME_LOTTO, [1, 2, 3, 4, 5], [1, 2], { value: 1n });
    await lottery.connect(bob).buyTicket(GAME_LOTTO, [1, 2, 3, 4, 5], [1, 2], { value: 1n });
    await lottery.connect(carol).buyTicket(GAME_LOTTO, [1, 2, 3, 4, 5], [1, 2], { value: 1n });
    await closeRoundAfterCutoff(lottery, GAME_LOTTO);
    await lottery.testDrawFixed(GAME_LOTTO, [1, 2, 3, 4, 5], [1, 2]);
    await lottery.connect(alice).registerWinningTicket(GAME_LOTTO, 1, 0);
    await lottery.connect(bob).registerWinningTicket(GAME_LOTTO, 1, 1);
    await lottery.connect(carol).registerWinningTicket(GAME_LOTTO, 1, 2);
    await lottery.closeRegistration(GAME_LOTTO, 1);

    const round = await lottery.getRound(GAME_LOTTO, 1);
    assert.equal(await lottery.tierPrizePerWinner(GAME_LOTTO, 1, 1), 0n);
    assert.equal(round.reserveRollover, 3n);
    assert.equal(await lottery.rolloverReserve(GAME_LOTTO), 3n);
  });

  it("requests and fulfills production VRF draws through the coordinator", async () => {
    const { lottery, coordinator } = await deployLotteryWithMockCoordinator();

    await closeRoundAfterCutoff(lottery, GAME_KENO);
    await lottery.requestDraw(GAME_KENO);

    const requestId = await coordinator.lastRequestId();
    const drawRequest = await lottery.drawRequests(requestId);
    let round = await lottery.getRound(GAME_KENO, 1);
    assert.equal(round.status, 2n);
    assert.equal(round.requestId, requestId);
    assert.equal(drawRequest.gameType, BigInt(GAME_KENO));
    assert.equal(drawRequest.roundId, 1n);

    await coordinator.fulfill(await lottery.getAddress(), requestId, 12345);

    round = await lottery.getRound(GAME_KENO, 1);
    const deletedRequest = await lottery.drawRequests(requestId);
    assert.equal(round.status, 3n);
    assertUniqueInRange(round.winningMain, 20, 1, 80);
    assert.deepEqual(numbers(round.winningExtra), []);
    assert.equal(deletedRequest.roundId, 0n);
  });

  it("rejects non-coordinator, unknown, and replayed VRF fulfillments", async () => {
    const { lottery, coordinator, owner } = await deployLotteryWithMockCoordinator();

    await closeRoundAfterCutoff(lottery, GAME_LOTTO);
    await lottery.requestDraw(GAME_LOTTO);
    const requestId = await coordinator.lastRequestId();

    await assert.rejects(
      lottery.connect(owner).rawFulfillRandomWords(requestId, [12345]),
      /OnlyCoordinator/
    );
    await assert.rejects(
      coordinator.fulfill(await lottery.getAddress(), requestId + 1n, 12345),
      /UNKNOWN_REQUEST/
    );

    await coordinator.fulfill(await lottery.getAddress(), requestId, 12345);
    await assert.rejects(
      coordinator.fulfill(await lottery.getAddress(), requestId, 12345),
      /UNKNOWN_REQUEST|ROUND_NOT_DRAWING/
    );
  });

  it("transfers tier prize to the registered ticket owner on claim", async () => {
    const { ethers, lottery, alice } = await deployLottery();
    await prepareRegisteredLottoWinner(lottery, alice);

    const prize = await lottery.tierPrizePerWinner(GAME_LOTTO, 1, 1);
    const before = await ethers.provider.getBalance(alice.address);
    const tx = await lottery.connect(alice).claimPrize(GAME_LOTTO, 1, 0);
    const receipt = await tx.wait();
    const after = await ethers.provider.getBalance(alice.address);
    const gasCost = receipt.gasUsed * receipt.gasPrice;

    assert.equal(after - before + gasCost, prize);
    const ticket = await lottery.getTicket(GAME_LOTTO, 1, 0);
    assert.equal(ticket.claimed, true);
  });

  it("prevents non-owners from claiming registered tickets", async () => {
    const { lottery, alice, bob } = await deployLottery();
    await prepareRegisteredLottoWinner(lottery, alice);

    await assert.rejects(
      lottery.connect(bob).claimPrize(GAME_LOTTO, 1, 0),
      /NotTicketOwner/
    );
  });

  it("prevents claiming a registered ticket twice", async () => {
    const { lottery, alice } = await deployLottery();
    await prepareRegisteredLottoWinner(lottery, alice);

    await lottery.connect(alice).claimPrize(GAME_LOTTO, 1, 0);
    await assert.rejects(
      lottery.connect(alice).claimPrize(GAME_LOTTO, 1, 0),
      /TicketAlreadyClaimed/
    );
  });

  it("prevents unregistered losing tickets from claiming", async () => {
    const { lottery, alice, bob } = await deployLottery();

    await lottery.connect(alice).buyTicket(GAME_LOTTO, [1, 2, 3, 4, 5], [1, 2], { value: ticketPrice });
    await lottery.connect(bob).buyTicket(GAME_LOTTO, [6, 7, 8, 9, 10], [3, 4], { value: ticketPrice });
    await closeRoundAfterCutoff(lottery, GAME_LOTTO);
    await lottery.testDrawFixed(GAME_LOTTO, [1, 2, 3, 4, 5], [1, 2]);
    await lottery.connect(alice).registerWinningTicket(GAME_LOTTO, 1, 0);
    await lottery.closeRegistration(GAME_LOTTO, 1);

    assert.equal(await lottery.registeredTicketTier(GAME_LOTTO, 1, 1), 0n);
    await assert.rejects(
      lottery.connect(bob).claimPrize(GAME_LOTTO, 1, 1),
      /TicketDidNotWin/
    );
  });

  it("prevents an owner from claiming a winning ticket that was never registered", async () => {
    const { lottery, alice } = await deployLottery();

    await lottery.connect(alice).buyTicket(GAME_LOTTO, [1, 2, 3, 4, 5], [1, 2], { value: ticketPrice });
    await closeRoundAfterCutoff(lottery, GAME_LOTTO);
    await lottery.testDrawFixed(GAME_LOTTO, [1, 2, 3, 4, 5], [1, 2]);
    await lottery.closeRegistration(GAME_LOTTO, 1);

    assert.equal(await lottery.registeredTicketTier(GAME_LOTTO, 1, 0), 0n);
    await assert.rejects(
      lottery.connect(alice).claimPrize(GAME_LOTTO, 1, 0),
      /TicketDidNotWin/
    );
  });

  it("rolls no-winner tier reserves into the next round for that game", async () => {
    const { lottery, alice } = await deployLottery();

    await lottery.connect(alice).buyTicket(GAME_KENO, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], [], { value: ticketPrice });
    await closeRoundAfterCutoff(lottery, GAME_KENO);
    await lottery.testDrawFixed(
      GAME_KENO,
      [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30],
      []
    );
    await lottery.closeRegistration(GAME_KENO, 1);

    assert.ok(await lottery.rolloverReserve(GAME_KENO) > 0n);
    await lottery.startNextRound(GAME_KENO);

    assert.equal(await lottery.currentRoundId(GAME_KENO), 2n);
    assert.equal(await lottery.rolloverReserve(GAME_KENO), 0n);
    const next = await lottery.getRound(GAME_KENO, 2);
    assert.ok(next.prizePool > 0n);
  });

  it("keeps each round rollover contribution queryable after starting the next round", async () => {
    const { lottery, alice } = await deployLottery();

    await lottery.connect(alice).buyTicket(GAME_KENO, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], [], { value: ticketPrice });
    await closeRoundAfterCutoff(lottery, GAME_KENO);
    await lottery.testDrawFixed(
      GAME_KENO,
      [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30],
      []
    );
    await lottery.closeRegistration(GAME_KENO, 1);
    await lottery.startNextRound(GAME_KENO);

    const oldRound = await lottery.getRound(GAME_KENO, 1);
    const nextRound = await lottery.getRound(GAME_KENO, 2);
    assert.equal(oldRound.reserveRollover, ticketPrice);
    assert.equal(nextRound.prizePool, ticketPrice);
  });
});
