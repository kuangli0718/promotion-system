import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ethers } from "ethers";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import {
  GAME_DEFINITIONS,
  HISTORY_LIMIT,
  LOTTERY_ADDRESS,
  STATUS_LABELS,
  formatCountdown,
  formatNumber,
  formatProbability,
  formatUtcDate,
  formatUtcDateTime,
  formatUtcWeekday,
  getGameDefinition,
  getLottoFirstPrizeProbability,
  getLottoSystemEntryCount,
  getLottoTierProbabilities,
  getLotteryContract,
  randomPickForArea,
  switchToSepolia,
  togglePick
} from "./lottery.js";

gsap.registerPlugin(useGSAP);
gsap.defaults({
  duration: 0.28,
  ease: "power2.out",
  overwrite: "auto"
});

const MAX_TICKETS_TO_LOAD = 50;
const CASINO_ACTIVITY = [
  { user: "玩家-9f31", action: "购买乐透型", amount: "+0.001 ETH" },
  { user: "玩家-a62c", action: "登记中奖票", amount: "待结算" },
  { user: "推广者-7b44", action: "获得推广奖励", amount: "+0.0005 ETH" },
  { user: "玩家-d8c2", action: "购买复式票", amount: "+0.006 ETH" },
  { user: "系统", action: "奖池滚存更新", amount: "实时" }
];
const ROUTES = [
  { id: "lobby", hash: "", label: "购票大厅" },
  { id: "draws", hash: "draws", label: "开奖票据" },
  { id: "admin", hash: "admin", label: "管理后台" },
  { id: "dev", hash: "dev", label: "开发调试" }
];

function getRouteFromHash() {
  const hash = window.location.hash.replace(/^#\/?/, "");
  return ROUTES.some((route) => route.id === hash) ? hash : "lobby";
}

function shortAddress(address) {
  return address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "";
}

function formatEth(value) {
  return value ? `${ethers.formatEther(value)} ETH` : "-";
}

function normalizeNumbers(values = []) {
  return values.map(Number);
}

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
    drawTime: rawRound.drawTime,
    stimulusBps: rawRound.stimulusBps,
    promotionBps: rawRound.promotionBps,
    referralRewardBps: rawRound.referralRewardBps,
    maxPromotersPerRound: rawRound.maxPromotersPerRound,
    promotionPool: rawRound.promotionPool,
    promotionPaid: rawRound.promotionPaid
  };
}

function explainRoundLoadError(error) {
  const message = error?.shortMessage || error?.reason || error?.message || "";
  if (
    message.includes("could not decode result data")
    || message.includes("BAD_DATA")
    || message.includes("data out-of-bounds")
  ) {
    return new Error("合约 ABI 不匹配。请部署最新的推广版 SuperLottery 合约，并更新 VITE_SUPER_LOTTERY_ADDRESS。");
  }
  return error;
}

function formatAreaNumber(value, area) {
  return area.min === 0 && area.max <= 9 ? String(value) : formatNumber(value);
}

function formatNumbers(values, area) {
  return values.length ? values.map((value) => formatAreaNumber(value, area)).join(" ") : "--";
}

function describeArea(label, area) {
  const range = `${formatAreaNumber(area.min, area)}-${formatAreaNumber(area.max, area)}`;
  const pickLabel = area.displayPick || area.pick;
  const repeat = area.allowRepeat ? "可重复" : "不可重复";
  const order = area.ordered ? "按顺序" : "不看顺序";
  return `${label}: 选 ${pickLabel} 个, ${range}, ${repeat}, ${order}`;
}

function countAreaMatches(ticketNumbers, winningNumbers, ordered) {
  if (ordered) {
    return ticketNumbers.reduce((count, number, index) => (
      Number(winningNumbers[index]) === Number(number) ? count + 1 : count
    ), 0);
  }

  const winning = new Set(winningNumbers.map(Number));
  return ticketNumbers.filter((number) => winning.has(Number(number))).length;
}

function getTicketState(ticket, registered, roundStatus) {
  if (ticket.claimed) return { tone: "success", label: "已领取" };
  if (registered) return { tone: "success", label: `${ticket.registeredTier} 等奖` };
  if (roundStatus === 3) return { tone: "attention", label: "待核验" };
  if (roundStatus === 4) return { tone: "muted", label: "未登记" };
  return { tone: "neutral", label: "销售中" };
}

function getStepClass(state) {
  return `admin-step ${state}`;
}

function routeHref(routeId) {
  return routeId === "lobby" ? "#/" : `#/${routeId}`;
}

function LiveTicker({ selectedGame, ticketCount, round }) {
  return (
    <section className="live-strip" aria-label="实时动态">
      <span className="live-dot" />
      {[...CASINO_ACTIVITY, ...CASINO_ACTIVITY].map((item, index) => (
        <div className="live-item" key={`${item.user}-${index}`}>
          <strong>{item.user}</strong>
          <span>{item.action}</span>
          <em>{index % 2 === 0 ? selectedGame.label : item.amount}</em>
        </div>
      ))}
      <div className="live-item live-summary">
        <strong>{STATUS_LABELS[round?.status] || "加载中"}</strong>
        <span>{ticketCount.toString()} 张票</span>
        <em>{selectedGame.label}</em>
      </div>
    </section>
  );
}

function NumberGrid({ area, selected, onToggle, onPress }) {
  const values = Array.from({ length: area.max - area.min + 1 }, (_, index) => area.min + index);
  const columns = area.max >= 60 ? 10 : area.max >= 35 ? 7 : area.max >= 20 ? 5 : 10;
  const markActive = !area.allowRepeat || !area.ordered;

  return (
    <div className="number-grid" style={{ "--cols": columns }}>
      {values.map((value) => {
        const active = markActive && selected.includes(value);
        const atLimit = selected.length >= area.pick;
        const disabled = markActive && atLimit && !active;

        return (
          <button
            key={value}
            type="button"
            className={active ? "ball selected" : "ball"}
            disabled={disabled}
            onClick={(event) => {
              onPress?.(event);
              onToggle(value);
            }}
          >
            {formatAreaNumber(value, area)}
          </button>
        );
      })}
    </div>
  );
}

function AreaPicker({ label, area, selected, onChange, onPressNumber }) {
  const setRandom = () => onChange(randomPickForArea(area, area.randomPick || area.pick));
  const clear = () => onChange([]);
  const removeAt = (index) => onChange(togglePick(selected, { value: selected[index], index }, area));

  return (
    <section className="area-picker">
      <div className="area-head">
        <div>
          <h3>{label}</h3>
          <p className="muted">{describeArea(label, area)}</p>
        </div>
        <div className="actions">
          <button type="button" onClick={setRandom}>随机</button>
          <button type="button" onClick={clear}>清空</button>
        </div>
      </div>

      <NumberGrid
        area={area}
        selected={selected}
        onPress={onPressNumber}
        onToggle={(value) => onChange(togglePick(selected, value, area))}
      />

      <div className="selected-strip">
        <span className="label">已选号码</span>
        <div className="selected-picks">
          {selected.length === 0 ? (
            <strong>--</strong>
          ) : selected.map((value, index) => (
            <button
              key={`${value}-${index}`}
              type="button"
              className="pick-chip"
              onClick={() => removeAt(index)}
            >
              {formatAreaNumber(value, area)}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function TierTable({ tiers, tierStats }) {
  return (
    <div className="tier-table">
      {tiers.map((tier) => {
        const stats = tierStats[tier.id] || {};
        return (
          <div className="tier-row" key={tier.id}>
            <span>{tier.label}</span>
            <strong>{tier.pool}</strong>
            <small>{tier.id > 0 ? `${stats.winners || 0} 名中奖者` : "滚存"}</small>
            <small>{stats.prize ? `${ethers.formatEther(stats.prize)} ETH` : "-"}</small>
          </div>
        );
      })}
    </div>
  );
}

export default function App() {
  const appRef = useRef(null);
  const [account, setAccount] = useState("");
  const [isOwner, setIsOwner] = useState(false);
  const [selectedGameType, setSelectedGameType] = useState(2);
  const [roundId, setRoundId] = useState(1n);
  const [round, setRound] = useState(null);
  const [ticketPrice, setTicketPrice] = useState(0n);
  const [ticketCount, setTicketCount] = useState(0n);
  const [tickets, setTickets] = useState([]);
  const [historyRounds, setHistoryRounds] = useState([]);
  const [tierStats, setTierStats] = useState({});
  const [mainNumbers, setMainNumbers] = useState([]);
  const [extraNumbers, setExtraNumbers] = useState([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [nowMs, setNowMs] = useState(Date.now());
  const [betMode, setBetMode] = useState("single");
  const [boundReferrer, setBoundReferrer] = useState("");
  const [referrerInput, setReferrerInput] = useState("");
  const [promotionRewardBalance, setPromotionRewardBalance] = useState(0n);
  const [promotionConfig, setPromotionConfig] = useState(null);
  const [stimulusBpsInput, setStimulusBpsInput] = useState("10000");
  const [promotionBpsInput, setPromotionBpsInput] = useState("0");
  const [referralRewardBpsInput, setReferralRewardBpsInput] = useState("5000");
  const [maxPromotersInput, setMaxPromotersInput] = useState("200");
  const [localTesting, setLocalTesting] = useState(false);
  const [route, setRoute] = useState(getRouteFromHash);
  const refreshSeq = useRef(0);
  const { contextSafe } = useGSAP({ scope: appRef });

  const selectedGame = useMemo(
    () => getGameDefinition(selectedGameType) || GAME_DEFINITIONS[2],
    [selectedGameType]
  );

  const hasRoundTiming = Boolean(round?.closeTime);
  const closeMs = hasRoundTiming ? Number(round.closeTime) * 1000 : 0;
  const salesClosedByTime = Boolean(closeMs && nowMs >= closeMs);
  const countdownLabel = hasRoundTiming ? formatCountdown(closeMs - nowMs) : "--:--:--";
  const closeRoundReady = round?.status === 0 && (!hasRoundTiming || salesClosedByTime);
  const isLotto = selectedGameType === 2;
  const isSystemMode = isLotto && betMode === "system";
  const systemEntryCount = isSystemMode
    ? getLottoSystemEntryCount(mainNumbers.length, extraNumbers.length)
    : 1;
  const systemTooLarge = isSystemMode && systemEntryCount > selectedGame.system.maxEntries;
  const totalTicketPrice = ticketPrice * BigInt(systemEntryCount || 0);
  const normalizedReferrerInput = referrerInput.trim();
  const hasValidReferrerInput = ethers.isAddress(normalizedReferrerInput);
  const activeReferrer = boundReferrer || (hasValidReferrerInput ? normalizedReferrerInput : "");
  const firstPrizeProbability = isSystemMode
    ? getLottoFirstPrizeProbability(systemEntryCount)
    : getLottoFirstPrizeProbability(1);
  const lottoTierProbabilities = isLotto
    ? getLottoTierProbabilities(
      isSystemMode ? mainNumbers.length : selectedGame.main.pick,
      isSystemMode ? extraNumbers.length : selectedGame.extra.pick
    )
    : null;
  const mainPickerArea = isSystemMode
    ? {
      ...selectedGame.main,
      pick: selectedGame.main.max - selectedGame.main.min + 1,
      displayPick: `${selectedGame.main.pick} 个以上`,
      randomPick: selectedGame.main.pick
    }
    : selectedGame.main;
  const extraPickerArea = selectedGame.extra && isSystemMode
    ? {
      ...selectedGame.extra,
      pick: selectedGame.extra.max - selectedGame.extra.min + 1,
      displayPick: `${selectedGame.extra.pick} 个以上`,
      randomPick: selectedGame.extra.pick
    }
    : selectedGame.extra;

  const canBuy = (
    round?.status === 0
    && !salesClosedByTime
    && (isSystemMode
      ? (
        mainNumbers.length >= selectedGame.main.pick
        && extraNumbers.length >= selectedGame.extra.pick
        && systemEntryCount > 0
        && !systemTooLarge
      )
      : (
        mainNumbers.length === selectedGame.main.pick
        && (!selectedGame.extra || extraNumbers.length === selectedGame.extra.pick)
      ))
  );
  const winningNumbersReady = round?.status >= 3;
  const showLobby = route === "lobby";
  const showDraws = route === "draws";
  const showAdmin = route === "admin";
  const showDev = route === "dev";
  const animateNumberPress = contextSafe((event) => {
    gsap.fromTo(event.currentTarget, { scale: 0.9 }, {
      scale: 1,
      duration: 0.22,
      ease: "back.out(2)"
    });
  });

  useGSAP(() => {
    const mm = gsap.matchMedia();
    mm.add("(prefers-reduced-motion: no-preference)", () => {
      const tl = gsap.timeline({ defaults: { duration: 0.46, ease: "power3.out" } });
      tl.from(".topbar", { autoAlpha: 0, y: 18 })
        .from(".casino-hero, .live-strip", {
          autoAlpha: 0,
          y: 18,
          stagger: 0.06
        }, "-=0.2")
        .from(".app-nav, .game-tabs, .status-band, .rule-band, .time-band", {
          autoAlpha: 0,
          y: 14,
          stagger: 0.04
        }, "-=0.24")
        .from(".status-band > div, .hero-metrics > div", {
          autoAlpha: 0,
          y: 10,
          stagger: 0.025
        }, "-=0.22")
        .from(".workspace, .tiers-section, .tickets-section, .history-section, .admin-panel", {
          autoAlpha: 0,
          y: 16,
          stagger: 0.045
        }, "-=0.22");
    });
    return () => mm.revert();
  }, { scope: appRef });

  useGSAP(() => {
    if (!showLobby) return undefined;
    const mm = gsap.matchMedia();
    mm.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.from(".game-tab.active", {
        scale: 0.96,
        duration: 0.22
      });
      gsap.from(".area-picker, .system-summary, .probability-grid", {
        autoAlpha: 0,
        y: 10,
        duration: 0.28,
        stagger: 0.035
      });
      gsap.from(".activity-row", {
        autoAlpha: 0,
        x: 10,
        duration: 0.24,
        stagger: 0.03
      });
    });
    return () => mm.revert();
  }, { scope: appRef, dependencies: [selectedGameType, showLobby], revertOnUpdate: true });

  useGSAP(() => {
    if (!showLobby || !isLotto) return undefined;
    const mm = gsap.matchMedia();
    mm.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.fromTo(".system-summary > div, .probability-grid > div", {
        y: 4,
        scale: 0.985
      }, {
        y: 0,
        scale: 1,
        duration: 0.2,
        stagger: 0.015
      });
    });
    return () => mm.revert();
  }, { scope: appRef, dependencies: [showLobby, isLotto, betMode, systemEntryCount], revertOnUpdate: true });

  useGSAP(() => {
    if (!showDraws || (!tickets.length && !historyRounds.length)) return undefined;
    const mm = gsap.matchMedia();
    mm.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.from(".ticket-card, .history-card", {
        autoAlpha: 0,
        y: 8,
        duration: 0.24,
        stagger: 0.025
      });
    });
    return () => mm.revert();
  }, {
    scope: appRef,
    dependencies: [showDraws, tickets.length, historyRounds.length, selectedGameType, roundId],
    revertOnUpdate: true
  });

  useGSAP(() => {
    if (!showAdmin || !isOwner) return undefined;
    const mm = gsap.matchMedia();
    mm.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.from(".admin-step", {
        autoAlpha: 0,
        y: 8,
        duration: 0.24,
        stagger: 0.03
      });
      const activeStep = appRef.current?.querySelector(".admin-step.active .step-index");
      if (activeStep) {
        gsap.to(activeStep, {
          scale: 1.08,
          duration: 0.9,
          ease: "sine.inOut",
          repeat: -1,
          yoyo: true
        });
      }
    });
    return () => mm.revert();
  }, {
    scope: appRef,
    dependencies: [showAdmin, isOwner, round?.status, selectedGameType],
    revertOnUpdate: true
  });

  useGSAP(() => {
    if (!showLobby || !winningNumbersReady) return undefined;
    const mm = gsap.matchMedia();
    mm.add("(prefers-reduced-motion: no-preference)", () => {
      const tl = gsap.timeline({ defaults: { duration: 0.28, ease: "back.out(1.7)" } });
      tl.from(".draw-ball", {
        autoAlpha: 0,
        y: -10,
        scale: 0.72,
        stagger: 0.045
      });
    });
    return () => mm.revert();
  }, { scope: appRef, dependencies: [showLobby, winningNumbersReady, roundId, selectedGameType], revertOnUpdate: true });

  useGSAP(() => {
    if (!message) return undefined;
    const mm = gsap.matchMedia();
    mm.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.fromTo(".toast", { autoAlpha: 0, y: 18 }, {
        autoAlpha: 1,
        y: 0,
        duration: 0.22
      });
    });
    return () => mm.revert();
  }, { scope: appRef, dependencies: [message], revertOnUpdate: true });

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const handleHashChange = () => setRoute(getRouteFromHash());
    window.addEventListener("hashchange", handleHashChange);
    handleHashChange();
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get("ref");
    if (ref && ethers.isAddress(ref)) {
      setReferrerInput(ref);
    }
  }, []);

  function selectGame(gameType) {
    refreshSeq.current += 1;
    setSelectedGameType(gameType);
  }

  const refresh = useCallback(async (knownAccount = account) => {
    if (!LOTTERY_ADDRESS || !window.ethereum) return;

    const requestSeq = ++refreshSeq.current;
    const requestGameType = selectedGameType;
    const contract = await getLotteryContract(false);
    const currentRoundId = await contract.currentRoundId(requestGameType);
    let currentRound;
    try {
      currentRound = parseRound(await contract.getRound(requestGameType, currentRoundId));
    } catch (error) {
      throw explainRoundLoadError(error);
    }
    const price = await contract.ticketPrice();
    const count = await contract.getRoundTicketCount(requestGameType, currentRoundId);
    const owner = await contract.owner();
    const [config, contractLocalTesting] = await Promise.all([
      contract.promotionConfigs(requestGameType),
      contract.localTesting()
    ]);
    const history = [];
    const currentRoundNumber = Number(currentRoundId);
    const firstRound = Math.max(1, currentRoundNumber - HISTORY_LIMIT + 1);

    for (let id = currentRoundNumber; id >= firstRound; id--) {
      let historyRound;
      try {
        historyRound = parseRound(await contract.getRound(requestGameType, BigInt(id)));
      } catch (error) {
        throw explainRoundLoadError(error);
      }
      if (historyRound.status >= 3) {
        history.push({ id, ...historyRound });
      }
    }

    const nextTierStats = {};
    await Promise.all(selectedGame.tiers.map(async (tier) => {
      if (tier.id === 0) return;
      const [winners, prize] = await Promise.all([
        contract.tierWinnerCounts(requestGameType, currentRoundId, tier.id),
        contract.tierPrizePerWinner(requestGameType, currentRoundId, tier.id)
      ]);
      nextTierStats[tier.id] = { winners: Number(winners), prize };
    }));

    const loadedTickets = [];
    const countToLoad = count > BigInt(MAX_TICKETS_TO_LOAD) ? MAX_TICKETS_TO_LOAD : Number(count);
    for (let i = 0; i < countToLoad; i++) {
      const ticket = await contract.getTicket(requestGameType, currentRoundId, i);
      if (!knownAccount || ticket.buyer.toLowerCase() === knownAccount.toLowerCase()) {
        const registeredTier = Number(
          await contract.registeredTicketTier(requestGameType, currentRoundId, i)
        );
        loadedTickets.push({
          id: i,
          buyer: ticket.buyer,
          gameType: Number(ticket.gameType),
          mainNumbers: normalizeNumbers(ticket.mainNumbers),
          extraNumbers: normalizeNumbers(ticket.extraNumbers),
          claimed: ticket.claimed,
          registeredTier
        });
      }
    }

    let nextBoundReferrer = "";
    let nextPromotionRewardBalance = 0n;
    if (knownAccount) {
      const [referrer, rewardBalance] = await Promise.all([
        contract.referrerOf(knownAccount),
        contract.promotionRewardBalance(knownAccount)
      ]);
      if (referrer && referrer !== ethers.ZeroAddress) {
        nextBoundReferrer = referrer;
      }
      nextPromotionRewardBalance = rewardBalance;
    }

    if (requestSeq !== refreshSeq.current || requestGameType !== selectedGameType) return;

    setRoundId(currentRoundId);
    setRound(currentRound);
    setTicketPrice(price);
    setTicketCount(count);
    setLocalTesting(Boolean(contractLocalTesting));
    setTickets(loadedTickets);
    setHistoryRounds(history);
    setTierStats(nextTierStats);
    setIsOwner(Boolean(knownAccount) && owner.toLowerCase() === knownAccount.toLowerCase());
    setBoundReferrer(nextBoundReferrer);
    setPromotionRewardBalance(nextPromotionRewardBalance);
    const parsedPromotionConfig = {
      stimulusBps: Number(config.stimulusBps),
      promotionBps: Number(config.promotionBps),
      referralRewardBps: Number(config.referralRewardBps),
      maxPromotersPerRound: Number(config.maxPromotersPerRound)
    };
    setPromotionConfig(parsedPromotionConfig);
    setStimulusBpsInput(String(parsedPromotionConfig.stimulusBps));
    setPromotionBpsInput(String(parsedPromotionConfig.promotionBps));
    setReferralRewardBpsInput(String(parsedPromotionConfig.referralRewardBps));
    setMaxPromotersInput(String(parsedPromotionConfig.maxPromotersPerRound));
  }, [account, selectedGame, selectedGameType]);

  useEffect(() => {
    setMainNumbers([]);
    setExtraNumbers([]);
    setBetMode("single");
    setTickets([]);
    setHistoryRounds([]);
    setRound(null);
    setTierStats({});
  }, [selectedGameType]);

  useEffect(() => {
    refresh(account).catch((error) => {
      setMessage(error.shortMessage || error.reason || error.message);
    });
  }, [account, refresh]);

  useEffect(() => {
    if (!window.ethereum) return undefined;

    const handleAccountsChanged = (accounts) => {
      const nextAccount = accounts[0] || "";
      setAccount(nextAccount);
      refresh(nextAccount).catch((error) => {
        setMessage(error.shortMessage || error.reason || error.message);
      });
    };

    const handleChainChanged = () => {
      refresh(account).catch((error) => {
        setMessage(error.shortMessage || error.reason || error.message);
      });
    };

    window.ethereum.on?.("accountsChanged", handleAccountsChanged);
    window.ethereum.on?.("chainChanged", handleChainChanged);

    return () => {
      window.ethereum.removeListener?.("accountsChanged", handleAccountsChanged);
      window.ethereum.removeListener?.("chainChanged", handleChainChanged);
    };
  }, [account, refresh]);

  async function connectWallet() {
    try {
      if (!window.ethereum) {
        setMessage("请先安装浏览器钱包。");
        return;
      }
      await switchToSepolia();
      const [selected] = await window.ethereum.request({ method: "eth_requestAccounts" });
      setAccount(selected);
      await refresh(selected);
    } catch (error) {
      setMessage(error.shortMessage || error.reason || error.message);
    }
  }

  async function transact(action, success) {
    try {
      setBusy(true);
      setMessage("等待钱包确认...");
      const tx = await action(await getLotteryContract(true));
      setMessage("交易已提交，等待链上确认...");
      await tx.wait();
      setMessage(success);
      await refresh(account);
    } catch (error) {
      setMessage(error.shortMessage || error.reason || error.message);
    } finally {
      setBusy(false);
    }
  }

  async function buyTicket() {
    await transact(
      (contract) => {
        if (activeReferrer) {
          return isSystemMode
            ? contract.buyLottoSystemTicketWithReferrer(mainNumbers, extraNumbers, activeReferrer, { value: totalTicketPrice })
            : contract.buyTicketWithReferrer(selectedGameType, mainNumbers, extraNumbers, activeReferrer, { value: ticketPrice });
        }
        return isSystemMode
          ? contract.buyLottoSystemTicket(mainNumbers, extraNumbers, { value: totalTicketPrice })
          : contract.buyTicket(selectedGameType, mainNumbers, extraNumbers, { value: ticketPrice });
      },
      isSystemMode ? "复式票购买成功。" : "彩票购买成功。"
    );
  }

  async function claimPromotionReward() {
    await transact(
      (contract) => contract.claimPromotionReward(),
      "推广奖励已领取。"
    );
  }

  async function testCloseRound() {
    await transact(
      (contract) => contract.testCloseRound(selectedGameType),
      "测试封盘已完成。"
    );
  }

  async function testDrawRound() {
    await transact(
      (contract) => contract.testDraw(selectedGameType, BigInt(Date.now())),
      "测试开奖已完成。"
    );
  }

  async function testWithdrawBalance() {
    await transact(
      (contract) => contract.testWithdrawBalance(),
      "测试合约余额已提取。"
    );
  }

  async function testStartNextRoundNow() {
    await transact(
      (contract) => contract.testStartNextRoundNow(selectedGameType),
      "测试下一轮已开启。"
    );
  }

  async function savePromotionConfig() {
    const stimulus = Number(stimulusBpsInput);
    const promotion = Number(promotionBpsInput);
    const referralReward = Number(referralRewardBpsInput);
    const maxPromoters = Number(maxPromotersInput);

    if (!Number.isInteger(stimulus) || !Number.isInteger(promotion) || stimulus + promotion !== 10000) {
      setMessage("刺激系数和推广系数之和必须等于 10000。");
      return;
    }
    if (!Number.isInteger(referralReward) || referralReward < 0 || referralReward >= 10000) {
      setMessage("推荐奖励系数必须在 0 到 9999 之间。");
      return;
    }
    if (!Number.isInteger(maxPromoters) || maxPromoters <= 0) {
      setMessage("最大推广者数量必须大于 0。");
      return;
    }

    await transact(
      (contract) => contract.setPromotionConfig(selectedGameType, stimulus, promotion, referralReward, maxPromoters),
      "推广配置已更新，将从未来轮次生效。"
    );
  }

  const roundSummary = useMemo(() => {
    if (!round) return "请连接钱包或配置合约地址以加载当前轮次。";
    return `第 ${roundId.toString()} 轮 · ${STATUS_LABELS[round.status]} · ${ticketCount.toString()} 张票`;
  }, [round, roundId, ticketCount]);

  const ruleSummary = useMemo(() => {
    const areas = [describeArea(selectedGame.mainLabel, selectedGame.main)];
    if (selectedGame.extra) {
      areas.push(describeArea(selectedGame.extraLabel, selectedGame.extra));
    }
    return areas.join(" / ");
  }, [selectedGame]);

  const adminSteps = useMemo(() => [
    {
      index: "01",
      title: "封盘",
      detail: round?.status > 0 ? "已完成" : closeRoundReady ? "可操作" : "等待 UTC 截止",
      state: round?.status > 0 ? "done" : closeRoundReady ? "active" : "waiting",
      disabled: busy || !closeRoundReady,
      actionLabel: "封盘",
      action: (contract) => contract.closeRound(selectedGameType),
      success: "本轮已封盘。"
    },
    {
      index: "02",
      title: "请求开奖",
      detail: round?.status > 1 ? "已提交" : round?.status === 1 ? "可操作" : "等待封盘",
      state: round?.status > 1 ? "done" : round?.status === 1 ? "active" : "waiting",
      disabled: busy || round?.status !== 1,
      actionLabel: "请求",
      action: (contract) => contract.requestDraw(selectedGameType),
      success: "VRF 开奖请求已提交。"
    },
    {
      index: "03",
      title: "关闭登记",
      detail: round?.status > 3 ? "已完成" : round?.status === 3 ? "可操作" : "等待开奖",
      state: round?.status > 3 ? "done" : round?.status === 3 ? "active" : "waiting",
      disabled: busy || round?.status !== 3,
      actionLabel: "关闭",
      action: (contract) => contract.closeRegistration(selectedGameType, roundId),
      success: "中奖登记已关闭。"
    },
    {
      index: "04",
      title: "下一轮",
      detail: round?.status === 4 ? "可操作" : "等待可领奖",
      state: round?.status === 4 ? "active" : "waiting",
      disabled: busy || round?.status !== 4,
      actionLabel: "开启",
      action: (contract) => contract.startNextRound(selectedGameType),
      success: "下一轮已开启。"
    }
  ], [busy, closeRoundReady, round?.status, roundId, selectedGameType]);

  return (
    <main className="app-shell" ref={appRef}>
      <header className="topbar">
        <div className="brand-block">
          <p className="eyebrow">Sepolia 链上彩票</p>
          <h1>超级彩票</h1>
          <p className="brand-copy">暗色娱乐大厅 · 链上透明开奖 · 推广奖励实时结算</p>
        </div>
        <div className="topbar-status">
          <span className="online-dot" />
          <strong>{account ? "钱包已连接" : "等待连接"}</strong>
          <small>{localTesting ? "测试模式" : "VRF 正式模式"}</small>
        </div>
        <button type="button" className="primary" onClick={connectWallet}>
          {account ? shortAddress(account) : "连接钱包"}
        </button>
      </header>

      <section className="casino-hero">
        <div className="hero-copy">
          <span className="section-count">当前大厅 · {selectedGame.label}</span>
          <h2>{round ? `${STATUS_LABELS[round.status]} · 第 ${roundId.toString()} 轮` : "连接钱包后加载轮次"}</h2>
          <p>选择号码、绑定推荐人、登记中奖彩票和领取奖励都在同一个链上大厅完成。</p>
        </div>
        <div className="hero-metrics">
          <div>
            <span className="label">当前奖池</span>
            <strong>{round ? formatEth(round.prizePool) : "-"}</strong>
          </div>
          <div>
            <span className="label">销售倒计时</span>
            <strong>{!round ? "--:--:--" : round.status === 0 && !salesClosedByTime ? countdownLabel : "已封盘"}</strong>
          </div>
          <div>
            <span className="label">我的推广奖励</span>
            <strong>{formatEth(promotionRewardBalance)}</strong>
          </div>
        </div>
      </section>

      <LiveTicker selectedGame={selectedGame} ticketCount={ticketCount} round={round} />

      <nav className="app-nav" aria-label="页面导航">
        {ROUTES.map((item) => (
          <a
            key={item.id}
            href={routeHref(item.id)}
            className={route === item.id ? "app-nav-link active" : "app-nav-link"}
          >
            {item.label}
          </a>
        ))}
      </nav>

      <nav className="game-tabs" aria-label="彩票玩法">
        {GAME_DEFINITIONS.map((game) => (
          <button
            key={game.gameType}
            type="button"
            className={game.gameType === selectedGameType ? "game-tab active" : "game-tab"}
            onClick={() => selectGame(game.gameType)}
          >
            {game.label}
          </button>
        ))}
      </nav>

      <section className="status-band">
        {(showAdmin || showDev) && (
          <div>
            <span className="label">合约</span>
            <strong>{LOTTERY_ADDRESS ? shortAddress(LOTTERY_ADDRESS) : "未配置"}</strong>
          </div>
        )}
        <div>
          <span className="label">玩法</span>
          <strong>{selectedGame.label}</strong>
        </div>
        <div>
          <span className="label">轮次</span>
          <strong>{roundSummary}</strong>
        </div>
        <div>
          <span className="label">UTC 日期</span>
          <strong>{round ? `${formatUtcDate(round.openTime)} · ${formatUtcWeekday(round.openTime)}` : "-"}</strong>
        </div>
        <div>
          <span className="label">销售截止</span>
          <strong>{round ? formatUtcDateTime(round.closeTime) : "-"}</strong>
        </div>
        <div>
          <span className="label">奖池</span>
          <strong>{round ? `${ethers.formatEther(round.prizePool)} ETH` : "-"}</strong>
        </div>
        <div>
          <span className="label">票价</span>
          <strong>{ticketPrice ? `${ethers.formatEther(ticketPrice)} ETH` : "-"}</strong>
        </div>
        {(showAdmin || showDev) && (
          <>
            <div>
              <span className="label">刺激 / 推广</span>
              <strong>
                {round ? `${Number(round.stimulusBps) / 100}% / ${Number(round.promotionBps) / 100}%` : "-"}
              </strong>
            </div>
            <div>
              <span className="label">推广池</span>
              <strong>{round ? `${ethers.formatEther(round.promotionPool)} ETH` : "-"}</strong>
            </div>
            <div>
              <span className="label">已发推广奖励</span>
              <strong>{round ? `${ethers.formatEther(round.promotionPaid)} ETH` : "-"}</strong>
            </div>
          </>
        )}
        <div>
          <span className="label">我的推广奖励</span>
          <strong>{ethers.formatEther(promotionRewardBalance)} ETH</strong>
          <button
            type="button"
            onClick={claimPromotionReward}
            disabled={!account || promotionRewardBalance === 0n || busy}
          >
            领取推广奖励
          </button>
        </div>
      </section>

      {showLobby && (
        <>
          <section className="rule-band">
            <span className="label">规则</span>
            <strong>{ruleSummary}</strong>
          </section>

          <section className="time-band">
            <div>
              <span className="label">倒计时</span>
              <strong>
                {!round ? "--:--:--" : round.status === 0 && !salesClosedByTime ? countdownLabel : "已封盘"}
              </strong>
            </div>
            <p className="muted">销售截止后进入开奖流程，用户可在开奖票据页登记中奖票并领奖。</p>
          </section>

          <section className="workspace">
        <div className="picker-panel">
          <div className="panel-head">
            <div>
              <h2>选择号码</h2>
              <p>{selectedGame.label} · {STATUS_LABELS[round?.status] || "加载中"}</p>
            </div>
            <div className="actions">
              <button
                type="button"
                onClick={() => {
                  setMainNumbers(randomPickForArea(selectedGame.main));
                  setExtraNumbers(selectedGame.extra ? randomPickForArea(selectedGame.extra) : []);
                }}
              >
                全部随机
              </button>
              <button
                type="button"
                onClick={() => {
                  setMainNumbers([]);
                  setExtraNumbers([]);
                }}
              >
                全部清空
              </button>
            </div>
          </div>

          {isLotto && (
            <div className="bet-mode" role="group" aria-label="投注模式">
              <button
                type="button"
                className={betMode === "single" ? "mode-button active" : "mode-button"}
                onClick={() => setBetMode("single")}
              >
                单式
              </button>
              <button
                type="button"
                className={betMode === "system" ? "mode-button active" : "mode-button"}
                onClick={() => setBetMode("system")}
              >
                复式
              </button>
            </div>
          )}

          <AreaPicker
            label={selectedGame.mainLabel}
            area={mainPickerArea}
            selected={mainNumbers}
            onChange={setMainNumbers}
            onPressNumber={animateNumberPress}
          />

          {selectedGame.extra && (
            <AreaPicker
              label={selectedGame.extraLabel}
              area={extraPickerArea}
              selected={extraNumbers}
              onChange={setExtraNumbers}
              onPressNumber={animateNumberPress}
            />
          )}

          {isLotto && (
            <div className="system-summary">
              <div>
                <span className="label">{isSystemMode ? "复式注数" : "注数"}</span>
                <strong>
                  {isSystemMode
                    ? `${systemEntryCount} / ${selectedGame.system.maxEntries}`
                    : "1"}
                </strong>
              </div>
              <div>
                <span className="label">总价</span>
                <strong>{ethers.formatEther(isSystemMode ? totalTicketPrice : ticketPrice)} ETH</strong>
              </div>
              <div>
                <span className="label">一等奖概率</span>
                <strong>{formatProbability(firstPrizeProbability)}</strong>
              </div>
              <div>
                <span className="label">任一奖级概率</span>
                <strong>{formatProbability(lottoTierProbabilities.listedPrizeProbability)}</strong>
              </div>
              {systemTooLarge && (
                <p className="system-warning">
                  复式注数超过 {selectedGame.system.maxEntries} 注，请减少前区或后区号码。
                </p>
              )}
            </div>
          )}

          {isLotto && (
            <div className="probability-grid">
              {lottoTierProbabilities.tiers.map((tier) => (
                <div key={tier.id}>
                  <span className="label">{tier.label}</span>
                  <strong>{formatProbability(tier.probability)}</strong>
                </div>
              ))}
            </div>
          )}

          <div className="selection-row">
            <div>
              <span className="label">票面号码</span>
              <strong>
                {formatNumbers(mainNumbers, selectedGame.main)}
                {selectedGame.extra ? ` + ${formatNumbers(extraNumbers, selectedGame.extra)}` : ""}
              </strong>
            </div>
          </div>

          <div className="referral-panel">
            <div>
              <span className="label">推荐人</span>
              {boundReferrer ? (
                <strong>已绑定 {shortAddress(boundReferrer)}</strong>
              ) : (
                <input
                  type="text"
                  value={referrerInput}
                  onChange={(event) => setReferrerInput(event.target.value)}
                  placeholder="0x 推荐人地址"
                  aria-label="推荐人地址"
                  spellCheck="false"
                />
              )}
            </div>
            <p className="muted">
              {boundReferrer
                ? "本钱包购票会使用已绑定推荐人。"
                : hasValidReferrerInput
                  ? `本次购票将使用 ${shortAddress(normalizedReferrerInput)} 作为推荐人。`
                  : "可选：为本钱包填写推荐人地址。"}
            </p>
          </div>

          <div className="selection-row">
            <div>
              <span className="label">购买金额</span>
              <strong>{ethers.formatEther(isSystemMode ? totalTicketPrice : ticketPrice)} ETH</strong>
            </div>
            <button type="button" className="primary" disabled={!canBuy || busy} onClick={buyTicket}>
              {isSystemMode ? "购买复式票" : "购买彩票"}
            </button>
          </div>
        </div>

        <aside className="side-panel">
          <h2>开奖状态</h2>
          {winningNumbersReady ? (
            <>
              <div className="draw-group">
                <span className="label">{selectedGame.mainLabel}</span>
                <div className="draw-balls">
                  {round.winningMain.map((number, index) => (
                    <span className="draw-ball main" key={`m-${number}-${index}`}>
                      {formatAreaNumber(number, selectedGame.main)}
                    </span>
                  ))}
                </div>
              </div>
              {selectedGame.extra && (
                <div className="draw-group">
                  <span className="label">{selectedGame.extraLabel}</span>
                  <div className="draw-balls">
                    {round.winningExtra.map((number, index) => (
                      <span className="draw-ball extra" key={`e-${number}-${index}`}>
                        {formatAreaNumber(number, selectedGame.extra)}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <p className="muted">封盘并完成开奖后，这里会显示当前轮次的开奖号码。</p>
          )}

          <div className="user-guide">
            <div>
              <span className="label">当前状态</span>
              <strong>{STATUS_LABELS[round?.status] || "加载中"}</strong>
            </div>
            <div>
              <span className="label">已售彩票</span>
              <strong>{ticketCount.toString()} 张</strong>
            </div>
            <div>
              <span className="label">我的推广奖励</span>
              <strong>{formatEth(promotionRewardBalance)}</strong>
            </div>
            <a href="#/draws">查看开奖票据</a>
          </div>

          <div className="activity-panel">
            <div className="panel-head compact">
              <h3>大厅动态</h3>
              <span className="section-count">{ticketCount.toString()} 张票</span>
            </div>
            <div className="activity-list">
              {CASINO_ACTIVITY.map((item) => (
                <div className="activity-row" key={`${item.user}-${item.action}`}>
                  <span>{item.user}</span>
                  <strong>{item.action}</strong>
                  <em>{item.amount}</em>
                </div>
              ))}
            </div>
          </div>
        </aside>
          </section>
        </>
      )}

      {showDraws && (
        <>
          <section className="tiers-section">
            <div className="panel-head">
              <h2>奖级</h2>
              <span className="muted">{selectedGame.label}</span>
            </div>
            <TierTable tiers={selectedGame.tiers} tierStats={tierStats} />
          </section>

          <section className="tickets-section">
            <div className="panel-head">
              <div>
                <h2>{account ? "我的彩票" : "当前轮次彩票"}</h2>
                <p>{selectedGame.label} · 第 {roundId.toString()} 轮</p>
              </div>
              <div className="actions">
                <span className="section-count">已加载 {tickets.length} 张</span>
                <button type="button" onClick={() => refresh(account)} disabled={busy}>刷新</button>
              </div>
            </div>
            <div className="ticket-list">
              {tickets.length === 0 ? (
                <p className="muted">当前玩法和轮次暂无已加载彩票。</p>
              ) : tickets.map((ticket) => {
            const mainMatches = round
              ? countAreaMatches(ticket.mainNumbers, round.winningMain, selectedGame.main.ordered)
              : 0;
            const extraMatches = round && selectedGame.extra
              ? countAreaMatches(ticket.extraNumbers, round.winningExtra, selectedGame.extra.ordered)
              : 0;
            const registered = ticket.registeredTier > 0;
            const ticketState = getTicketState(ticket, registered, round?.status);
            const matchLabel = winningNumbersReady
              ? `命中 ${mainMatches}${selectedGame.extra ? ` + ${extraMatches}` : ""}`
              : "等待开奖";

            return (
              <article className={`ticket-card ${ticketState.tone}`} key={ticket.id}>
                <div className="ticket-main">
                  <div className="ticket-title-row">
                    <strong>彩票 #{ticket.id}</strong>
                    <span className={`status-pill ${ticketState.tone}`}>{ticketState.label}</span>
                  </div>
                  <p className="ticket-numbers">
                    {formatNumbers(ticket.mainNumbers, selectedGame.main)}
                    {selectedGame.extra ? ` + ${formatNumbers(ticket.extraNumbers, selectedGame.extra)}` : ""}
                  </p>
                  <div className="ticket-meta">
                    <span>{shortAddress(ticket.buyer)}</span>
                    <span>{matchLabel}</span>
                    <span>{ticket.claimed ? "奖金已支付" : registered ? "已登记" : "未登记"}</span>
                  </div>
                </div>
                <div className="ticket-actions">
                  {round?.status === 3 && (
                    <button
                      type="button"
                      disabled={busy || registered}
                      onClick={() => transact(
                        (contract) => contract.registerWinningTicket(selectedGameType, roundId, ticket.id),
                        "中奖彩票已登记。"
                      )}
                    >
                      {registered ? "已登记" : "登记"}
                    </button>
                  )}
                  {round?.status === 4 && (
                    <button
                      type="button"
                      disabled={busy || ticket.claimed || !registered}
                      onClick={() => transact(
                        (contract) => contract.claimPrize(selectedGameType, roundId, ticket.id),
                        "奖金已领取。"
                      )}
                    >
                      {ticket.claimed ? "已领取" : "领取"}
                    </button>
                  )}
                </div>
              </article>
            );
          })}
            </div>
          </section>

          <section className="history-section">
            <div className="panel-head">
              <div>
                <h2>历史开奖</h2>
                <p>{selectedGame.label} · 近期已开奖轮次</p>
              </div>
              <span className="section-count">{historyRounds.length} 条记录</span>
            </div>
            <div className="history-list">
              {historyRounds.length === 0 ? (
                <p className="muted">当前玩法暂无已开奖历史。</p>
              ) : historyRounds.map((item) => (
                <article className="history-card" key={item.id}>
              <div className="history-round">
                <span className="status-pill success">{STATUS_LABELS[item.status]}</span>
                <strong>第 {item.id} 轮</strong>
                <p>{formatUtcDate(item.openTime)} · {formatUtcWeekday(item.openTime)}</p>
              </div>
              <div className="history-numbers">
                <span className="label">开奖号码</span>
                <div className="history-balls">
                  {item.winningMain.map((number, index) => (
                    <span className="mini-ball main" key={`hm-${item.id}-${number}-${index}`}>
                      {formatAreaNumber(number, selectedGame.main)}
                    </span>
                  ))}
                  {selectedGame.extra && item.winningExtra.map((number, index) => (
                    <span className="mini-ball extra" key={`he-${item.id}-${number}-${index}`}>
                      {formatAreaNumber(number, selectedGame.extra)}
                    </span>
                  ))}
                </div>
              </div>
              <div className="history-metrics">
                <span className="label">奖池</span>
                <strong>{ethers.formatEther(item.prizePool)} ETH</strong>
                <small>开奖时间 {formatUtcDateTime(item.drawTime)}</small>
              </div>
                </article>
              ))}
            </div>
          </section>
        </>
      )}

      {showAdmin && (isOwner ? (
        <section className="admin-panel">
          <div className="panel-head">
            <div>
              <h2>管理后台</h2>
              <p>{selectedGame.label} · 第 {roundId.toString()} 轮生命周期</p>
            </div>
            <span className="status-pill neutral">{STATUS_LABELS[round?.status] || "加载中"}</span>
          </div>
          <div className="admin-flow">
            {adminSteps.map((step) => (
              <article className={getStepClass(step.state)} key={step.index}>
                <div className="step-index">{step.index}</div>
                <div className="step-body">
                  <strong>{step.title}</strong>
                  <span>{step.detail}</span>
                </div>
                <button
                  type="button"
                  disabled={step.disabled}
                  onClick={() => transact(step.action, step.success)}
                >
                  {step.actionLabel}
                </button>
              </article>
            ))}
          </div>
          {localTesting && (
            <section className="admin-config">
              <div className="admin-config-head">
                <div>
                  <h3>测试开奖</h3>
                  <p className="muted">仅测试模式合约可用，用于跳过 UTC 截止和 VRF 回调验证完整流程。</p>
                </div>
                <span className="section-count">LOCAL_TESTING</span>
              </div>
              <div className="actions">
                <button
                  type="button"
                  disabled={busy || round?.status !== 0}
                  onClick={testCloseRound}
                >
                  立即测试封盘
                </button>
                <button
                  type="button"
                  disabled={busy || round?.status !== 1}
                  onClick={testDrawRound}
                >
                  立即测试开奖
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={testWithdrawBalance}
                >
                  提取测试余额
                </button>
                <button
                  type="button"
                  disabled={busy || round?.status !== 4}
                  onClick={testStartNextRoundNow}
                >
                  立即开启测试下一轮
                </button>
              </div>
            </section>
          )}
          <section className="admin-config">
            <div className="admin-config-head">
              <div>
                <h3>推广配置</h3>
                <p className="muted">仅对当前玩法的未来轮次生效。</p>
              </div>
              {promotionConfig && (
                <span className="section-count">
                  当前 {promotionConfig.stimulusBps / 100}% / {promotionConfig.promotionBps / 100}%
                </span>
              )}
            </div>
            <div className="config-grid">
              <label>
                刺激系数 BPS
                <input
                  type="number"
                  min="0"
                  max="10000"
                  value={stimulusBpsInput}
                  onChange={(event) => setStimulusBpsInput(event.target.value)}
                />
              </label>
              <label>
                推广系数 BPS
                <input
                  type="number"
                  min="0"
                  max="10000"
                  value={promotionBpsInput}
                  onChange={(event) => setPromotionBpsInput(event.target.value)}
                />
              </label>
              <label>
                推荐奖励 BPS
                <input
                  type="number"
                  min="0"
                  max="9999"
                  value={referralRewardBpsInput}
                  onChange={(event) => setReferralRewardBpsInput(event.target.value)}
                />
              </label>
              <label>
                最大推广者数
                <input
                  type="number"
                  min="1"
                  value={maxPromotersInput}
                  onChange={(event) => setMaxPromotersInput(event.target.value)}
                />
              </label>
            </div>
            <button type="button" disabled={busy} onClick={savePromotionConfig}>
              保存推广配置
            </button>
          </section>
        </section>
      ) : (
        <section className="admin-panel">
          <div className="panel-head">
            <div>
              <h2>管理后台</h2>
              <p>请连接合约 owner 钱包后管理轮次、推广配置和测试工具。</p>
            </div>
            <span className="status-pill attention">需要管理员钱包</span>
          </div>
        </section>
      ))}

      {showDev && (
        <section className="admin-panel dev-panel">
          <div className="panel-head">
            <div>
              <h2>开发调试</h2>
              <p>链上状态、轮次原始字段和测试模式信息集中在这里。</p>
            </div>
            <button type="button" onClick={() => refresh(account)} disabled={busy}>刷新状态</button>
          </div>
          <div className="dev-grid">
            <div>
              <span className="label">合约地址</span>
              <strong>{LOTTERY_ADDRESS || "未配置"}</strong>
            </div>
            <div>
              <span className="label">连接账号</span>
              <strong>{account || "未连接"}</strong>
            </div>
            <div>
              <span className="label">测试模式</span>
              <strong>{localTesting ? "已启用" : "未启用"}</strong>
            </div>
            <div>
              <span className="label">玩法 / 轮次</span>
              <strong>{selectedGame.label} / 第 {roundId.toString()} 轮</strong>
            </div>
            <div>
              <span className="label">状态</span>
              <strong>{STATUS_LABELS[round?.status] || "加载中"}</strong>
            </div>
            <div>
              <span className="label">票数</span>
              <strong>{ticketCount.toString()}</strong>
            </div>
            <div>
              <span className="label">requestId</span>
              <strong>{round?.requestId ? round.requestId.toString() : "-"}</strong>
            </div>
            <div>
              <span className="label">reserveRollover</span>
              <strong>{round ? formatEth(round.reserveRollover) : "-"}</strong>
            </div>
            <div>
              <span className="label">promotionPool</span>
              <strong>{round ? formatEth(round.promotionPool) : "-"}</strong>
            </div>
            <div>
              <span className="label">promotionPaid</span>
              <strong>{round ? formatEth(round.promotionPaid) : "-"}</strong>
            </div>
            <div>
              <span className="label">openTime</span>
              <strong>{round ? formatUtcDateTime(round.openTime) : "-"}</strong>
            </div>
            <div>
              <span className="label">closeTime</span>
              <strong>{round ? formatUtcDateTime(round.closeTime) : "-"}</strong>
            </div>
          </div>
        </section>
      )}

      {message && <div className="toast">{message}</div>}
    </main>
  );
}
