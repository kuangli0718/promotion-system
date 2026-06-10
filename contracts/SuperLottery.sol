// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IVRFCoordinatorV2Plus} from "@chainlink/contracts/src/v0.8/vrf/dev/interfaces/IVRFCoordinatorV2Plus.sol";
import {VRFV2PlusClient} from "@chainlink/contracts/src/v0.8/vrf/dev/libraries/VRFV2PlusClient.sol";

contract SuperLottery {
    enum RoundStatus {
        Open,
        Closed,
        Drawing,
        Drawn,
        Claimable
    }

    struct Ticket {
        address buyer;
        uint8 gameType;
        uint8[] mainNumbers;
        uint8[] extraNumbers;
        bool claimed;
    }

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
        uint16 stimulusBps;
        uint16 promotionBps;
        uint16 referralRewardBps;
        uint16 maxPromotersPerRound;
        uint256 promotionPool;
        uint256 promotionPaid;
    }

    struct PromotionConfig {
        uint16 stimulusBps;
        uint16 promotionBps;
        uint16 referralRewardBps;
        uint16 maxPromotersPerRound;
    }

    struct AreaConfig {
        uint8 minNumber;
        uint8 maxNumber;
        uint8 pickCount;
        uint8 drawCount;
        bool allowRepeat;
        bool ordered;
    }

    struct GameConfig {
        bool exists;
        AreaConfig main;
        AreaConfig extra;
        bool hasExtra;
    }

    struct PrizeTier {
        uint8 tierId;
        uint8 mainMatch;
        uint8 extraMatch;
        uint256 weight;
        uint16 maxPoolBps;
        uint256 maxPrizePerWinner;
        bool rollIfNoWinner;
    }

    struct DrawRequest {
        uint8 gameType;
        uint256 roundId;
    }

    error InvalidTicketPrice();
    error RoundNotOpen();
    error RoundNotClosed();
    error RoundNotDrawn();
    error RoundNotClaimable();
    error InvalidFrontNumber();
    error InvalidBackNumber();
    error InvalidGameType();
    error InvalidMainNumber();
    error InvalidExtraNumber();
    error InvalidMainNumberCount();
    error InvalidExtraNumberCount();
    error DuplicateNumber();
    error OnlyOwner();
    error OnlyCoordinator();
    error LocalTestingDisabled();
    error TicketDidNotWin();
    error TicketAlreadyRegistered();
    error TicketAlreadyClaimed();
    error NotTicketOwner();
    error RoundNotStarted();
    error RoundSalesClosed();
    error RoundCloseTimeNotReached();
    error InvalidSystemMainNumberCount();
    error InvalidSystemExtraNumberCount();
    error TooManySystemEntries();
    error InvalidPromotionConfig();
    error InvalidReferrer();
    error TooManyRoundPromoters();

    uint8 private constant GAME_DIGITAL = 0;
    uint8 private constant GAME_NUMBER_LOTTO = 1;
    uint8 private constant GAME_LOTTO = 2;
    uint8 private constant GAME_BASE_LOTTO = 3;
    uint8 private constant GAME_KENO = 4;
    uint8 private constant MAX_GAMES = 5;
    uint16 private constant BPS_DENOMINATOR = 10_000;
    uint16 private constant DEFAULT_STIMULUS_BPS = 10_000;
    uint16 private constant DEFAULT_PROMOTION_BPS = 0;
    uint16 private constant DEFAULT_REFERRAL_REWARD_BPS = 5_000;
    uint16 private constant DEFAULT_MAX_PROMOTERS_PER_ROUND = 200;
    uint256 private constant MAX_LOTTO_SYSTEM_ENTRIES = 100;
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
    uint256 private constant UTC_DAY = 1 days;
    uint32 private constant NUM_RANDOM_WORDS = 1;
    uint16 private constant REQUEST_CONFIRMATIONS = 3;

    address public immutable owner;
    uint256 public immutable ticketPrice;
    bool public immutable localTesting;

    IVRFCoordinatorV2Plus public immutable vrfCoordinator;
    uint256 public immutable subscriptionId;
    bytes32 public immutable keyHash;
    uint32 public immutable callbackGasLimit;
    bool public immutable nativePayment;

    mapping(uint8 => uint256) public currentRoundId;
    mapping(uint8 => mapping(uint256 => Round)) private rounds;
    mapping(uint8 => mapping(uint256 => Ticket[])) private gameTickets;
    mapping(uint8 => GameConfig) public gameConfigs;
    mapping(uint8 => PrizeTier[]) public gamePrizeTiers;
    mapping(uint8 => mapping(uint256 => mapping(uint8 => uint256))) public tierWinnerCounts;
    mapping(uint8 => mapping(uint256 => mapping(uint8 => uint256))) public tierPrizePerWinner;
    mapping(uint8 => mapping(uint256 => mapping(uint256 => uint8))) public registeredTicketTier;
    mapping(uint8 => uint256) public rolloverReserve;
    mapping(uint8 => uint16) public reserveBps;
    mapping(uint8 => PromotionConfig) public promotionConfigs;
    mapping(uint256 => DrawRequest) public drawRequests;
    mapping(address => address) public referrerOf;
    mapping(uint8 => mapping(uint256 => address[])) private roundPromoters;
    mapping(uint8 => mapping(uint256 => mapping(address => bool))) private roundPromoterSeen;
    mapping(uint8 => mapping(uint256 => mapping(address => uint256))) public roundPromotionTheoreticalRewards;
    mapping(uint8 => mapping(uint256 => uint256)) public roundPromotionTotalTheoretical;

    event TicketBought(uint8 indexed gameType, uint256 indexed roundId, uint256 indexed ticketId, address buyer);
    event LottoSystemTicketBought(
        uint256 indexed roundId,
        address indexed buyer,
        uint256 firstTicketId,
        uint256 entryCount
    );
    event RoundClosed(uint8 indexed gameType, uint256 indexed roundId);
    event DrawRequested(uint8 indexed gameType, uint256 indexed roundId, uint256 indexed requestId);
    event RoundDrawn(uint8 indexed gameType, uint256 indexed roundId, uint8[] mainNumbers, uint8[] extraNumbers);
    event WinningTicketRegistered(
        uint8 indexed gameType,
        uint256 indexed roundId,
        uint256 indexed ticketId,
        address buyer,
        uint8 tierId
    );
    event RegistrationClosed(uint8 indexed gameType, uint256 indexed roundId);
    event PrizeClaimed(
        uint8 indexed gameType,
        uint256 indexed roundId,
        uint256 indexed ticketId,
        address buyer,
        uint256 amount
    );
    event RoundStarted(uint8 indexed gameType, uint256 indexed roundId, uint256 prizePool);
    event PromotionConfigUpdated(
        uint8 indexed gameType,
        uint16 stimulusBps,
        uint16 promotionBps,
        uint16 referralRewardBps,
        uint16 maxPromotersPerRound
    );
    event ReferrerBound(address indexed buyer, address indexed referrer);
    event PromotionAccrued(
        uint8 indexed gameType,
        uint256 indexed roundId,
        address indexed referrer,
        address buyer,
        uint256 ticketCount,
        uint256 theoreticalReward
    );

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    constructor(
        uint256 _ticketPrice,
        address _vrfCoordinator,
        uint256 _subscriptionId,
        bytes32 _keyHash,
        uint32 _callbackGasLimit,
        bool _localTesting,
        bool _nativePayment
    ) {
        owner = msg.sender;
        ticketPrice = _ticketPrice;
        vrfCoordinator = IVRFCoordinatorV2Plus(_vrfCoordinator);
        subscriptionId = _subscriptionId;
        keyHash = _keyHash;
        callbackGasLimit = _callbackGasLimit;
        localTesting = _localTesting;
        nativePayment = _nativePayment;

        _configureDigital();
        _configureNumberLotto();
        _configureLotto();
        _configureBaseLotto();
        _configureKeno();

        for (uint8 gameType = 0; gameType < MAX_GAMES; gameType++) {
            promotionConfigs[gameType] = PromotionConfig({
                stimulusBps: DEFAULT_STIMULUS_BPS,
                promotionBps: DEFAULT_PROMOTION_BPS,
                referralRewardBps: DEFAULT_REFERRAL_REWARD_BPS,
                maxPromotersPerRound: DEFAULT_MAX_PROMOTERS_PER_ROUND
            });
        }

        for (uint8 gameType = 0; gameType < MAX_GAMES; gameType++) {
            currentRoundId[gameType] = 1;
            Round storage round = rounds[gameType][1];
            round.status = RoundStatus.Open;
            round.openTime = block.timestamp;
            round.closeTime = _nextUtcMidnight(block.timestamp);
            _lockPromotionConfig(gameType, round);
            emit RoundStarted(gameType, 1, 0);
        }
    }

    function buyTicket(
        uint8 gameType,
        uint8[] calldata mainNumbers,
        uint8[] calldata extraNumbers
    ) external payable returns (uint256 ticketId) {
        return _buyTicket(gameType, mainNumbers, extraNumbers, address(0), false);
    }

    function buyTicketWithReferrer(
        uint8 gameType,
        uint8[] calldata mainNumbers,
        uint8[] calldata extraNumbers,
        address referrer
    ) external payable returns (uint256 ticketId) {
        return _buyTicket(gameType, mainNumbers, extraNumbers, referrer, true);
    }

    function _buyTicket(
        uint8 gameType,
        uint8[] calldata mainNumbers,
        uint8[] calldata extraNumbers,
        address referrer,
        bool useReferrer
    ) private returns (uint256 ticketId) {
        GameConfig storage config = _gameConfig(gameType);
        uint256 roundId = currentRoundId[gameType];
        Round storage round = rounds[gameType][roundId];
        if (round.status != RoundStatus.Open) revert RoundNotOpen();
        if (block.timestamp < round.openTime) revert RoundNotStarted();
        if (block.timestamp >= round.closeTime) revert RoundSalesClosed();
        if (msg.value != ticketPrice) revert InvalidTicketPrice();

        uint8[] memory normalizedMain = _validateArea(mainNumbers, config.main, true, config.main.pickCount);
        uint8[] memory normalizedExtra;
        if (config.hasExtra) {
            normalizedExtra = _validateArea(extraNumbers, config.extra, false, config.extra.pickCount);
        } else {
            if (extraNumbers.length != 0) revert InvalidExtraNumberCount();
            normalizedExtra = new uint8[](0);
        }

        ticketId = _storeTicket(gameType, roundId, msg.sender, normalizedMain, normalizedExtra);
        round.prizePool += msg.value;
        if (useReferrer) {
            _recordPromotion(gameType, roundId, round, msg.sender, referrer, 1);
        }
    }

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

    function closeRound(uint8 gameType) external onlyOwner {
        _requireValidGame(gameType);
        uint256 roundId = currentRoundId[gameType];
        Round storage round = rounds[gameType][roundId];
        if (round.status != RoundStatus.Open) revert RoundNotOpen();
        if (block.timestamp < round.closeTime) revert RoundCloseTimeNotReached();
        round.status = RoundStatus.Closed;
        emit RoundClosed(gameType, roundId);
    }

    function setPromotionConfig(
        uint8 gameType,
        uint16 stimulusBps,
        uint16 promotionBps,
        uint16 referralRewardBps,
        uint16 maxPromotersPerRound
    ) external onlyOwner {
        _requireValidGame(gameType);
        if (
            uint256(stimulusBps) + uint256(promotionBps) != BPS_DENOMINATOR
                || referralRewardBps >= BPS_DENOMINATOR
                || maxPromotersPerRound == 0
        ) {
            revert InvalidPromotionConfig();
        }

        promotionConfigs[gameType] = PromotionConfig({
            stimulusBps: stimulusBps,
            promotionBps: promotionBps,
            referralRewardBps: referralRewardBps,
            maxPromotersPerRound: maxPromotersPerRound
        });

        emit PromotionConfigUpdated(gameType, stimulusBps, promotionBps, referralRewardBps, maxPromotersPerRound);
    }

    function requestDraw(uint8 gameType) external onlyOwner returns (uint256 requestId) {
        _requireValidGame(gameType);
        uint256 roundId = currentRoundId[gameType];
        Round storage round = rounds[gameType][roundId];
        if (round.status != RoundStatus.Closed) revert RoundNotClosed();

        VRFV2PlusClient.RandomWordsRequest memory req = VRFV2PlusClient.RandomWordsRequest({
            keyHash: keyHash,
            subId: subscriptionId,
            requestConfirmations: REQUEST_CONFIRMATIONS,
            callbackGasLimit: callbackGasLimit,
            numWords: NUM_RANDOM_WORDS,
            extraArgs: VRFV2PlusClient._argsToBytes(VRFV2PlusClient.ExtraArgsV1({nativePayment: nativePayment}))
        });

        requestId = vrfCoordinator.requestRandomWords(req);
        round.status = RoundStatus.Drawing;
        round.requestId = requestId;
        drawRequests[requestId] = DrawRequest({gameType: gameType, roundId: roundId});

        emit DrawRequested(gameType, roundId, requestId);
    }

    function rawFulfillRandomWords(uint256 requestId, uint256[] calldata randomWords) external {
        if (msg.sender != address(vrfCoordinator)) revert OnlyCoordinator();
        DrawRequest memory drawRequest = drawRequests[requestId];
        require(drawRequest.roundId != 0, "UNKNOWN_REQUEST");
        Round storage round = rounds[drawRequest.gameType][drawRequest.roundId];
        require(round.status == RoundStatus.Drawing, "ROUND_NOT_DRAWING");
        _setWinningNumbers(drawRequest.gameType, drawRequest.roundId, randomWords[0]);
        delete drawRequests[requestId];
    }

    function testDraw(uint8 gameType, uint256 randomWord) external onlyOwner {
        if (!localTesting) revert LocalTestingDisabled();
        _requireValidGame(gameType);
        uint256 roundId = currentRoundId[gameType];
        Round storage round = rounds[gameType][roundId];
        if (round.status != RoundStatus.Closed) revert RoundNotClosed();
        _setWinningNumbers(gameType, roundId, randomWord);
    }

    function testDrawFixed(uint8 gameType, uint8[] calldata mainNumbers, uint8[] calldata extraNumbers) external onlyOwner {
        if (!localTesting) revert LocalTestingDisabled();
        GameConfig storage config = _gameConfig(gameType);
        uint256 roundId = currentRoundId[gameType];
        Round storage round = rounds[gameType][roundId];
        if (round.status != RoundStatus.Closed) revert RoundNotClosed();

        round.winningMain = _validateArea(mainNumbers, config.main, true, config.main.drawCount);
        if (config.hasExtra) {
            round.winningExtra = _validateArea(extraNumbers, config.extra, false, config.extra.drawCount);
        } else {
            if (extraNumbers.length != 0) revert InvalidExtraNumberCount();
            round.winningExtra = new uint8[](0);
        }
        round.status = RoundStatus.Drawn;
        round.drawTime = block.timestamp;

        emit RoundDrawn(gameType, roundId, round.winningMain, round.winningExtra);
    }

    function registerWinningTicket(uint8 gameType, uint256 roundId, uint256 ticketId) external {
        _requireValidGame(gameType);
        Round storage round = rounds[gameType][roundId];
        if (round.status != RoundStatus.Drawn) revert RoundNotDrawn();
        Ticket storage ticket = gameTickets[gameType][roundId][ticketId];
        if (ticket.buyer != msg.sender) revert NotTicketOwner();
        if (registeredTicketTier[gameType][roundId][ticketId] != 0) revert TicketAlreadyRegistered();

        uint8 tierId = _resolveTier(gameType, ticket, round);
        if (tierId == 0) revert TicketDidNotWin();

        registeredTicketTier[gameType][roundId][ticketId] = tierId;
        tierWinnerCounts[gameType][roundId][tierId] += 1;

        emit WinningTicketRegistered(gameType, roundId, ticketId, msg.sender, tierId);
    }

    function closeRegistration(uint8 gameType, uint256 roundId) external onlyOwner {
        _requireValidGame(gameType);
        Round storage round = rounds[gameType][roundId];
        if (round.status != RoundStatus.Drawn) revert RoundNotDrawn();

        PrizeTier[] storage tiers = gamePrizeTiers[gameType];
        uint256 reservePool = (round.prizePool * reserveBps[gameType]) / BPS_DENOMINATOR;
        uint256 availablePool = round.prizePool - reservePool;
        uint256 totalEffectiveWeight = 0;

        for (uint256 i = 0; i < tiers.length; i++) {
            PrizeTier storage tier = tiers[i];
            uint256 winners = tierWinnerCounts[gameType][roundId][tier.tierId];
            if (winners > 0) {
                totalEffectiveWeight += tier.weight * winners;
            }
        }

        if (totalEffectiveWeight == 0) {
            round.reserveRollover = round.prizePool;
            rolloverReserve[gameType] += round.prizePool;
            round.status = RoundStatus.Claimable;
            emit RegistrationClosed(gameType, roundId);
            return;
        }

        uint256 totalPaid = 0;
        for (uint256 i = 0; i < tiers.length; i++) {
            PrizeTier storage tier = tiers[i];
            uint256 winners = tierWinnerCounts[gameType][roundId][tier.tierId];
            if (winners == 0) continue;

            uint256 effectiveWeight = tier.weight * winners;
            uint256 rawTierPool = (availablePool * effectiveWeight) / totalEffectiveWeight;
            uint256 tierCap = (availablePool * tier.maxPoolBps) / BPS_DENOMINATOR;
            uint256 cappedTierPool = _min(rawTierPool, tierCap);
            uint256 prizePerWinner = cappedTierPool / winners;
            prizePerWinner = _min(prizePerWinner, tier.maxPrizePerWinner);
            tierPrizePerWinner[gameType][roundId][tier.tierId] = prizePerWinner;
            totalPaid += prizePerWinner * winners;
        }

        round.reserveRollover = round.prizePool - totalPaid;
        rolloverReserve[gameType] += round.reserveRollover;

        round.status = RoundStatus.Claimable;
        emit RegistrationClosed(gameType, roundId);
    }

    function claimPrize(uint8 gameType, uint256 roundId, uint256 ticketId) external {
        _requireValidGame(gameType);
        Round storage round = rounds[gameType][roundId];
        if (round.status != RoundStatus.Claimable) revert RoundNotClaimable();
        Ticket storage ticket = gameTickets[gameType][roundId][ticketId];
        if (ticket.buyer != msg.sender) revert NotTicketOwner();
        if (ticket.claimed) revert TicketAlreadyClaimed();

        uint8 tierId = registeredTicketTier[gameType][roundId][ticketId];
        if (tierId == 0) revert TicketDidNotWin();

        ticket.claimed = true;
        uint256 amount = tierPrizePerWinner[gameType][roundId][tierId];
        (bool sent,) = msg.sender.call{value: amount}("");
        require(sent, "PRIZE_TRANSFER_FAILED");

        emit PrizeClaimed(gameType, roundId, ticketId, msg.sender, amount);
    }

    function startNextRound(uint8 gameType) external onlyOwner {
        _requireValidGame(gameType);
        uint256 roundId = currentRoundId[gameType];
        Round storage current = rounds[gameType][roundId];
        if (current.status != RoundStatus.Claimable) revert RoundNotClaimable();

        uint256 nextRoundId = roundId + 1;
        uint256 nextOpenTime = current.closeTime;
        uint256 nextCloseTime = current.closeTime + UTC_DAY;
        if (nextCloseTime <= block.timestamp) {
            uint256 missedDays = ((block.timestamp - nextCloseTime) / UTC_DAY) + 1;
            nextOpenTime = nextCloseTime + ((missedDays - 1) * UTC_DAY);
            nextCloseTime += missedDays * UTC_DAY;
        }

        currentRoundId[gameType] = nextRoundId;
        Round storage next = rounds[gameType][nextRoundId];
        next.status = RoundStatus.Open;
        next.prizePool = rolloverReserve[gameType];
        next.openTime = nextOpenTime;
        next.closeTime = nextCloseTime;
        _lockPromotionConfig(gameType, next);
        rolloverReserve[gameType] = 0;

        emit RoundStarted(gameType, nextRoundId, next.prizePool);
    }

    function getRound(uint8 gameType, uint256 roundId) external view returns (Round memory) {
        _requireValidGame(gameType);
        return rounds[gameType][roundId];
    }

    function getTicket(uint8 gameType, uint256 roundId, uint256 ticketId) external view returns (Ticket memory) {
        _requireValidGame(gameType);
        return gameTickets[gameType][roundId][ticketId];
    }

    function getRoundTicketCount(uint8 gameType, uint256 roundId) external view returns (uint256) {
        _requireValidGame(gameType);
        return gameTickets[gameType][roundId].length;
    }

    function _configureDigital() private {
        gameConfigs[GAME_DIGITAL] = GameConfig({
            exists: true,
            main: AreaConfig({
                minNumber: 0,
                maxNumber: 9,
                pickCount: 4,
                drawCount: 4,
                allowRepeat: true,
                ordered: true
            }),
            extra: AreaConfig({
                minNumber: 0,
                maxNumber: 0,
                pickCount: 0,
                drawCount: 0,
                allowRepeat: false,
                ordered: false
            }),
            hasExtra: false
        });
        reserveBps[GAME_DIGITAL] = 500;
        _addPrizeTier(
            GAME_DIGITAL, 1, 4, 0, 15848932, TIER_1_MAX_POOL_BPS, ticketPrice * TIER_1_MAX_PRIZE_MULTIPLIER, true
        );
        _addPrizeTier(
            GAME_DIGITAL, 2, 4, 0, 6824481, TIER_2_MAX_POOL_BPS, ticketPrice * TIER_2_MAX_PRIZE_MULTIPLIER, true
        );
        _addPrizeTier(
            GAME_DIGITAL, 3, 3, 0, 8198365, TIER_3_MAX_POOL_BPS, ticketPrice * TIER_3_MAX_PRIZE_MULTIPLIER, true
        );
        _addPrizeTier(
            GAME_DIGITAL, 4, 2, 0, 4121323, TIER_4_MAX_POOL_BPS, ticketPrice * TIER_4_MAX_PRIZE_MULTIPLIER, true
        );
    }

    function _configureNumberLotto() private {
        gameConfigs[GAME_NUMBER_LOTTO] = GameConfig({
            exists: true,
            main: AreaConfig({
                minNumber: 0,
                maxNumber: 9,
                pickCount: 3,
                drawCount: 3,
                allowRepeat: true,
                ordered: true
            }),
            extra: AreaConfig({
                minNumber: 1,
                maxNumber: 20,
                pickCount: 3,
                drawCount: 3,
                allowRepeat: false,
                ordered: false
            }),
            hasExtra: true
        });
        reserveBps[GAME_NUMBER_LOTTO] = 500;
        _addPrizeTier(
            GAME_NUMBER_LOTTO, 1, 3, 3, 65625323, TIER_1_MAX_POOL_BPS, ticketPrice * TIER_1_MAX_PRIZE_MULTIPLIER, true
        );
        _addPrizeTier(
            GAME_NUMBER_LOTTO, 2, 3, 2, 20174390, TIER_2_MAX_POOL_BPS, ticketPrice * TIER_2_MAX_PRIZE_MULTIPLIER, true
        );
        _addPrizeTier(
            GAME_NUMBER_LOTTO, 3, 2, 3, 33946789, TIER_3_MAX_POOL_BPS, ticketPrice * TIER_3_MAX_PRIZE_MULTIPLIER, true
        );
        _addPrizeTier(
            GAME_NUMBER_LOTTO, 4, 3, 0, 8055320, TIER_4_MAX_POOL_BPS, ticketPrice * TIER_4_MAX_PRIZE_MULTIPLIER, true
        );
    }

    function _configureLotto() private {
        gameConfigs[GAME_LOTTO] = GameConfig({
            exists: true,
            main: AreaConfig({
                minNumber: 1,
                maxNumber: 35,
                pickCount: 5,
                drawCount: 5,
                allowRepeat: false,
                ordered: false
            }),
            extra: AreaConfig({
                minNumber: 1,
                maxNumber: 12,
                pickCount: 2,
                drawCount: 2,
                allowRepeat: false,
                ordered: false
            }),
            hasExtra: true
        });
        reserveBps[GAME_LOTTO] = 500;
        _addPrizeTier(
            GAME_LOTTO, 1, 5, 2, 158226995, TIER_1_MAX_POOL_BPS, ticketPrice * TIER_1_MAX_PRIZE_MULTIPLIER, true
        );
        _addPrizeTier(
            GAME_LOTTO, 2, 5, 1, 64412711, TIER_2_MAX_POOL_BPS, ticketPrice * TIER_2_MAX_PRIZE_MULTIPLIER, true
        );
        _addPrizeTier(
            GAME_LOTTO, 3, 5, 0, 50502959, TIER_3_MAX_POOL_BPS, ticketPrice * TIER_3_MAX_PRIZE_MULTIPLIER, true
        );
        _addPrizeTier(
            GAME_LOTTO, 4, 4, 2, 35192750, TIER_4_MAX_POOL_BPS, ticketPrice * TIER_4_MAX_PRIZE_MULTIPLIER, true
        );
        _addPrizeTier(
            GAME_LOTTO, 5, 4, 1, 14326635, TIER_5_MAX_POOL_BPS, ticketPrice * TIER_5_MAX_PRIZE_MULTIPLIER, true
        );
    }

    function _configureBaseLotto() private {
        gameConfigs[GAME_BASE_LOTTO] = GameConfig({
            exists: true,
            main: AreaConfig({
                minNumber: 1,
                maxNumber: 60,
                pickCount: 8,
                drawCount: 15,
                allowRepeat: false,
                ordered: false
            }),
            extra: AreaConfig({
                minNumber: 1,
                maxNumber: 12,
                pickCount: 2,
                drawCount: 2,
                allowRepeat: false,
                ordered: false
            }),
            hasExtra: true
        });
        reserveBps[GAME_BASE_LOTTO] = 500;
        _addPrizeTier(
            GAME_BASE_LOTTO, 1, 8, 2, 168151364, TIER_1_MAX_POOL_BPS, ticketPrice * TIER_1_MAX_PRIZE_MULTIPLIER, true
        );
        _addPrizeTier(
            GAME_BASE_LOTTO, 2, 7, 2, 53670624, TIER_2_MAX_POOL_BPS, ticketPrice * TIER_2_MAX_PRIZE_MULTIPLIER, true
        );
        _addPrizeTier(
            GAME_BASE_LOTTO, 3, 8, 1, 68452828, TIER_3_MAX_POOL_BPS, ticketPrice * TIER_3_MAX_PRIZE_MULTIPLIER, true
        );
        _addPrizeTier(
            GAME_BASE_LOTTO, 4, 7, 1, 21848803, TIER_4_MAX_POOL_BPS, ticketPrice * TIER_4_MAX_PRIZE_MULTIPLIER, true
        );
    }

    function _configureKeno() private {
        gameConfigs[GAME_KENO] = GameConfig({
            exists: true,
            main: AreaConfig({
                minNumber: 1,
                maxNumber: 80,
                pickCount: 10,
                drawCount: 20,
                allowRepeat: false,
                ordered: false
            }),
            extra: AreaConfig({
                minNumber: 0,
                maxNumber: 0,
                pickCount: 0,
                drawCount: 0,
                allowRepeat: false,
                ordered: false
            }),
            hasExtra: false
        });
        reserveBps[GAME_KENO] = 500;
        _addPrizeTier(
            GAME_KENO, 1, 10, 0, 121615332, TIER_1_MAX_POOL_BPS, ticketPrice * TIER_1_MAX_PRIZE_MULTIPLIER, true
        );
        _addPrizeTier(
            GAME_KENO, 2, 9, 0, 36640447, TIER_2_MAX_POOL_BPS, ticketPrice * TIER_2_MAX_PRIZE_MULTIPLIER, true
        );
        _addPrizeTier(
            GAME_KENO, 3, 8, 0, 14470908, TIER_3_MAX_POOL_BPS, ticketPrice * TIER_3_MAX_PRIZE_MULTIPLIER, true
        );
        _addPrizeTier(
            GAME_KENO, 4, 7, 0, 6884300, TIER_4_MAX_POOL_BPS, ticketPrice * TIER_4_MAX_PRIZE_MULTIPLIER, true
        );
    }

    function _addPrizeTier(
        uint8 gameType,
        uint8 tierId,
        uint8 mainMatch,
        uint8 extraMatch,
        uint256 weight,
        uint16 maxPoolBps,
        uint256 maxPrizePerWinner,
        bool rollIfNoWinner
    ) private {
        gamePrizeTiers[gameType].push(
            PrizeTier({
                tierId: tierId,
                mainMatch: mainMatch,
                extraMatch: extraMatch,
                weight: weight,
                maxPoolBps: maxPoolBps,
                maxPrizePerWinner: maxPrizePerWinner,
                rollIfNoWinner: rollIfNoWinner
            })
        );
    }

    function _lockPromotionConfig(uint8 gameType, Round storage round) private {
        PromotionConfig memory config = promotionConfigs[gameType];
        round.stimulusBps = config.stimulusBps;
        round.promotionBps = config.promotionBps;
        round.referralRewardBps = config.referralRewardBps;
        round.maxPromotersPerRound = config.maxPromotersPerRound;
    }

    function _activeReferrer(address buyer, address candidate) private returns (address referrer) {
        referrer = referrerOf[buyer];
        if (referrer != address(0)) return referrer;
        if (candidate == address(0)) return address(0);
        if (candidate == buyer || referrerOf[candidate] == buyer) revert InvalidReferrer();
        referrerOf[buyer] = candidate;
        emit ReferrerBound(buyer, candidate);
        return candidate;
    }

    function _recordPromotion(
        uint8 gameType,
        uint256 roundId,
        Round storage round,
        address buyer,
        address candidateReferrer,
        uint256 ticketCount
    ) private {
        address referrer = _activeReferrer(buyer, candidateReferrer);
        if (referrer == address(0) || ticketCount == 0) return;

        if (!roundPromoterSeen[gameType][roundId][referrer]) {
            if (roundPromoters[gameType][roundId].length >= round.maxPromotersPerRound) {
                revert TooManyRoundPromoters();
            }
            roundPromoterSeen[gameType][roundId][referrer] = true;
            roundPromoters[gameType][roundId].push(referrer);
        }

        uint256 theoreticalReward = (ticketPrice * ticketCount * round.referralRewardBps) / BPS_DENOMINATOR;
        roundPromotionTheoreticalRewards[gameType][roundId][referrer] += theoreticalReward;
        roundPromotionTotalTheoretical[gameType][roundId] += theoreticalReward;

        emit PromotionAccrued(gameType, roundId, referrer, buyer, ticketCount, theoreticalReward);
    }

    function _setWinningNumbers(uint8 gameType, uint256 roundId, uint256 randomWord) private {
        GameConfig storage config = gameConfigs[gameType];
        Round storage round = rounds[gameType][roundId];
        round.winningMain = _drawArea(
            uint256(keccak256(abi.encode(randomWord, gameType, roundId, "MAIN"))),
            config.main
        );
        if (config.hasExtra) {
            round.winningExtra = _drawArea(
                uint256(keccak256(abi.encode(randomWord, gameType, roundId, "EXTRA"))),
                config.extra
            );
        } else {
            round.winningExtra = new uint8[](0);
        }
        round.status = RoundStatus.Drawn;
        round.drawTime = block.timestamp;

        emit RoundDrawn(gameType, roundId, round.winningMain, round.winningExtra);
    }

    function _nextUtcMidnight(uint256 timestamp) private pure returns (uint256) {
        return ((timestamp / UTC_DAY) + 1) * UTC_DAY;
    }

    function _drawArea(uint256 seed, AreaConfig memory config) private pure returns (uint8[] memory numbers) {
        numbers = new uint8[](config.drawCount);
        uint256 range = uint256(config.maxNumber) - uint256(config.minNumber) + 1;

        if (config.allowRepeat) {
            for (uint256 i = 0; i < numbers.length; i++) {
                numbers[i] = uint8(uint256(config.minNumber) + (uint256(keccak256(abi.encode(seed, i))) % range));
            }
        } else {
            uint256 found = 0;
            uint256 nonce = 0;
            while (found < numbers.length) {
                uint8 candidate =
                    uint8(uint256(config.minNumber) + (uint256(keccak256(abi.encode(seed, nonce))) % range));
                if (!_contains(numbers, found, candidate)) {
                    numbers[found] = candidate;
                    found++;
                }
                nonce++;
            }
        }

        if (!config.ordered) {
            _sort(numbers);
        }
    }

    function _validateArea(
        uint8[] calldata input,
        AreaConfig memory config,
        bool isMain,
        uint8 expectedCount
    ) private pure returns (uint8[] memory numbers) {
        if (input.length != expectedCount) {
            if (isMain) revert InvalidMainNumberCount();
            revert InvalidExtraNumberCount();
        }

        numbers = new uint8[](input.length);
        for (uint256 i = 0; i < input.length; i++) {
            if (input[i] < config.minNumber || input[i] > config.maxNumber) {
                if (isMain) revert InvalidMainNumber();
                revert InvalidExtraNumber();
            }
            numbers[i] = input[i];
        }

        if (!config.allowRepeat) {
            if (config.ordered) {
                _requireNoDuplicates(numbers);
            } else {
                _sort(numbers);
                for (uint256 i = 1; i < numbers.length; i++) {
                    if (numbers[i] == numbers[i - 1]) revert DuplicateNumber();
                }
            }
        }
    }

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

    function _storeTicket(
        uint8 gameType,
        uint256 roundId,
        address buyer,
        uint8[] memory mainNumbers,
        uint8[] memory extraNumbers
    ) private returns (uint256 ticketId) {
        ticketId = gameTickets[gameType][roundId].length;
        Ticket storage ticket = gameTickets[gameType][roundId].push();
        ticket.buyer = buyer;
        ticket.gameType = gameType;
        ticket.claimed = false;
        ticket.mainNumbers = mainNumbers;
        ticket.extraNumbers = extraNumbers;

        emit TicketBought(gameType, roundId, ticketId, buyer);
    }

    function _combination(uint256 n, uint256 k) private pure returns (uint256) {
        if (k > n) return 0;
        uint256 result = 1;
        for (uint256 i = 1; i <= k; i++) {
            result = (result * (n - k + i)) / i;
        }
        return result;
    }

    function _min(uint256 a, uint256 b) private pure returns (uint256) {
        return a < b ? a : b;
    }

    function _resolveTier(uint8 gameType, Ticket storage ticket, Round storage round) private view returns (uint8) {
        if (gameType == GAME_DIGITAL) {
            return _resolveDigitalTier(ticket, round);
        }
        if (gameType == GAME_NUMBER_LOTTO) {
            return _resolveNumberLottoTier(ticket, round);
        }

        uint8 mainMatches = _countMatches(ticket.mainNumbers, round.winningMain);
        uint8 extraMatches = _countMatches(ticket.extraNumbers, round.winningExtra);
        PrizeTier[] storage tiers = gamePrizeTiers[gameType];
        for (uint256 i = 0; i < tiers.length; i++) {
            if (mainMatches >= tiers[i].mainMatch && extraMatches >= tiers[i].extraMatch) {
                return tiers[i].tierId;
            }
        }
        return 0;
    }

    function _resolveNumberLottoTier(Ticket storage ticket, Round storage round) private view returns (uint8) {
        uint8 digitalSuffixMatches = _countOrderedSuffixMatches(ticket.mainNumbers, round.winningMain);
        uint8 lottoMatches = _countMatches(ticket.extraNumbers, round.winningExtra);

        if (digitalSuffixMatches == 3 && lottoMatches == 3) return 1;
        if (digitalSuffixMatches == 3 && lottoMatches >= 2) return 2;
        if (digitalSuffixMatches >= 2 && lottoMatches == 3) return 3;
        if (digitalSuffixMatches == 3) return 4;
        return 0;
    }

    function _resolveDigitalTier(Ticket storage ticket, Round storage round) private view returns (uint8) {
        uint8 suffixMatches = _countOrderedSuffixMatches(ticket.mainNumbers, round.winningMain);
        if (suffixMatches == 4) return 1;
        if (_sameDigitMultiset(ticket.mainNumbers, round.winningMain)) return 2;
        if (suffixMatches >= 3) return 3;
        if (suffixMatches >= 2) return 4;
        return 0;
    }

    function _countMatches(uint8[] storage ticketNumbers, uint8[] storage winningNumbers) private view returns (uint8 count) {
        bool[] memory used = new bool[](winningNumbers.length);
        for (uint256 i = 0; i < ticketNumbers.length; i++) {
            for (uint256 j = 0; j < winningNumbers.length; j++) {
                if (!used[j] && ticketNumbers[i] == winningNumbers[j]) {
                    used[j] = true;
                    count++;
                    break;
                }
            }
        }
    }

    function _countOrderedSuffixMatches(
        uint8[] storage ticketNumbers,
        uint8[] storage winningNumbers
    ) private view returns (uint8 count) {
        uint256 ticketIndex = ticketNumbers.length;
        uint256 winningIndex = winningNumbers.length;
        while (ticketIndex > 0 && winningIndex > 0) {
            if (ticketNumbers[ticketIndex - 1] != winningNumbers[winningIndex - 1]) {
                break;
            }
            count++;
            ticketIndex--;
            winningIndex--;
        }
    }

    function _sameDigitMultiset(uint8[] storage ticketNumbers, uint8[] storage winningNumbers) private view returns (bool) {
        if (ticketNumbers.length != winningNumbers.length) return false;

        uint8[10] memory counts;
        for (uint256 i = 0; i < ticketNumbers.length; i++) {
            counts[ticketNumbers[i]] += 1;
        }
        for (uint256 i = 0; i < winningNumbers.length; i++) {
            if (counts[winningNumbers[i]] == 0) return false;
            counts[winningNumbers[i]] -= 1;
        }
        return true;
    }

    function _sort(uint8[] memory values) private pure {
        for (uint256 i = 1; i < values.length; i++) {
            uint8 key = values[i];
            uint256 j = i;
            while (j > 0 && values[j - 1] > key) {
                values[j] = values[j - 1];
                j--;
            }
            values[j] = key;
        }
    }

    function _requireNoDuplicates(uint8[] memory values) private pure {
        for (uint256 i = 0; i < values.length; i++) {
            for (uint256 j = i + 1; j < values.length; j++) {
                if (values[i] == values[j]) revert DuplicateNumber();
            }
        }
    }

    function _contains(uint8[] memory values, uint256 length, uint8 value) private pure returns (bool) {
        for (uint256 i = 0; i < length; i++) {
            if (values[i] == value) return true;
        }
        return false;
    }

    function _gameConfig(uint8 gameType) private view returns (GameConfig storage) {
        if (!gameConfigs[gameType].exists) revert InvalidGameType();
        return gameConfigs[gameType];
    }

    function _requireValidGame(uint8 gameType) private view {
        if (!gameConfigs[gameType].exists) revert InvalidGameType();
    }
}
