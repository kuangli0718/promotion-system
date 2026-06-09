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

function shortAddress(address) {
  return address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "";
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
    drawTime: rawRound.drawTime
  };
}

function explainRoundLoadError(error) {
  const message = error?.shortMessage || error?.reason || error?.message || "";
  if (
    message.includes("could not decode result data")
    || message.includes("BAD_DATA")
    || message.includes("data out-of-bounds")
  ) {
    return new Error("Contract ABI mismatch. Deploy the daily UTC SuperLottery contract and update VITE_SUPER_LOTTERY_ADDRESS.");
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
  if (ticket.claimed) return { tone: "success", label: "Claimed" };
  if (registered) return { tone: "success", label: `Tier ${ticket.registeredTier}` };
  if (roundStatus === 3) return { tone: "attention", label: "Review" };
  if (roundStatus === 4) return { tone: "muted", label: "Unregistered" };
  return { tone: "neutral", label: "Open" };
}

function getStepClass(state) {
  return `admin-step ${state}`;
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
          <button type="button" onClick={setRandom}>Random</button>
          <button type="button" onClick={clear}>Clear</button>
        </div>
      </div>

      <NumberGrid
        area={area}
        selected={selected}
        onPress={onPressNumber}
        onToggle={(value) => onChange(togglePick(selected, value, area))}
      />

      <div className="selected-strip">
        <span className="label">Selected</span>
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
            <small>{tier.id > 0 ? `${stats.winners || 0} winners` : "reserve"}</small>
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
        .from(".game-tabs, .status-band, .rule-band, .time-band", {
          autoAlpha: 0,
          y: 14,
          stagger: 0.04
        }, "-=0.24")
        .from(".workspace, .tiers-section, .tickets-section, .history-section, .admin-panel", {
          autoAlpha: 0,
          y: 16,
          stagger: 0.045
        }, "-=0.22");
    });
    return () => mm.revert();
  }, { scope: appRef });

  useGSAP(() => {
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
    });
    return () => mm.revert();
  }, { scope: appRef, dependencies: [selectedGameType], revertOnUpdate: true });

  useGSAP(() => {
    if (!isLotto) return undefined;
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
  }, { scope: appRef, dependencies: [isLotto, betMode, systemEntryCount], revertOnUpdate: true });

  useGSAP(() => {
    if (!tickets.length && !historyRounds.length) return undefined;
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
    dependencies: [tickets.length, historyRounds.length, selectedGameType, roundId],
    revertOnUpdate: true
  });

  useGSAP(() => {
    if (!isOwner) return undefined;
    const mm = gsap.matchMedia();
    mm.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.from(".admin-step", {
        autoAlpha: 0,
        y: 8,
        duration: 0.24,
        stagger: 0.03
      });
      gsap.to(".admin-step.active .step-index", {
        scale: 1.08,
        duration: 0.9,
        ease: "sine.inOut",
        repeat: -1,
        yoyo: true
      });
    });
    return () => mm.revert();
  }, {
    scope: appRef,
    dependencies: [isOwner, round?.status, selectedGameType],
    revertOnUpdate: true
  });

  useGSAP(() => {
    if (!winningNumbersReady) return undefined;
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
  }, { scope: appRef, dependencies: [winningNumbersReady, roundId, selectedGameType], revertOnUpdate: true });

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

    if (requestSeq !== refreshSeq.current || requestGameType !== selectedGameType) return;

    setRoundId(currentRoundId);
    setRound(currentRound);
    setTicketPrice(price);
    setTicketCount(count);
    setTickets(loadedTickets);
    setHistoryRounds(history);
    setTierStats(nextTierStats);
    setIsOwner(Boolean(knownAccount) && owner.toLowerCase() === knownAccount.toLowerCase());
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
        setMessage("Install a browser wallet first.");
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
      setMessage("Waiting for wallet confirmation...");
      const tx = await action(await getLotteryContract(true));
      setMessage("Transaction submitted. Waiting for confirmation...");
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
      (contract) => (
        isSystemMode
          ? contract.buyLottoSystemTicket(mainNumbers, extraNumbers, { value: totalTicketPrice })
          : contract.buyTicket(selectedGameType, mainNumbers, extraNumbers, { value: ticketPrice })
      ),
      isSystemMode ? "System ticket bought." : "Ticket bought."
    );
  }

  const roundSummary = useMemo(() => {
    if (!round) return "Connect or configure a contract to load the current round.";
    return `Round #${roundId.toString()} · ${STATUS_LABELS[round.status]} · ${ticketCount.toString()} tickets`;
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
      title: "Close Round",
      detail: round?.status > 0 ? "Completed" : closeRoundReady ? "Ready" : "Waiting for UTC close",
      state: round?.status > 0 ? "done" : closeRoundReady ? "active" : "waiting",
      disabled: busy || !closeRoundReady,
      actionLabel: "Close",
      action: (contract) => contract.closeRound(selectedGameType),
      success: "Round closed."
    },
    {
      index: "02",
      title: "Request Draw",
      detail: round?.status > 1 ? "Submitted" : round?.status === 1 ? "Ready" : "Waiting for close",
      state: round?.status > 1 ? "done" : round?.status === 1 ? "active" : "waiting",
      disabled: busy || round?.status !== 1,
      actionLabel: "Request",
      action: (contract) => contract.requestDraw(selectedGameType),
      success: "VRF draw requested."
    },
    {
      index: "03",
      title: "Close Registration",
      detail: round?.status > 3 ? "Completed" : round?.status === 3 ? "Ready" : "Waiting for draw",
      state: round?.status > 3 ? "done" : round?.status === 3 ? "active" : "waiting",
      disabled: busy || round?.status !== 3,
      actionLabel: "Close",
      action: (contract) => contract.closeRegistration(selectedGameType, roundId),
      success: "Registration closed."
    },
    {
      index: "04",
      title: "Next Round",
      detail: round?.status === 4 ? "Ready" : "Waiting for claimable",
      state: round?.status === 4 ? "active" : "waiting",
      disabled: busy || round?.status !== 4,
      actionLabel: "Start",
      action: (contract) => contract.startNextRound(selectedGameType),
      success: "Next round started."
    }
  ], [busy, closeRoundReady, round?.status, roundId, selectedGameType]);

  return (
    <main className="app-shell" ref={appRef}>
      <header className="topbar">
        <div className="brand-block">
          <p className="eyebrow">Sepolia Demo</p>
          <h1>Super Lottery</h1>
        </div>
        <button type="button" className="primary" onClick={connectWallet}>
          {account ? shortAddress(account) : "Connect Wallet"}
        </button>
      </header>

      <nav className="game-tabs" aria-label="Lottery games">
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
        <div>
          <span className="label">Contract</span>
          <strong>{LOTTERY_ADDRESS ? shortAddress(LOTTERY_ADDRESS) : "Not configured"}</strong>
        </div>
        <div>
          <span className="label">Game</span>
          <strong>{selectedGame.label}</strong>
        </div>
        <div>
          <span className="label">Round</span>
          <strong>{roundSummary}</strong>
        </div>
        <div>
          <span className="label">UTC Date</span>
          <strong>{round ? `${formatUtcDate(round.openTime)} · ${formatUtcWeekday(round.openTime)}` : "-"}</strong>
        </div>
        <div>
          <span className="label">Sales Close</span>
          <strong>{round ? formatUtcDateTime(round.closeTime) : "-"}</strong>
        </div>
        <div>
          <span className="label">Prize Pool</span>
          <strong>{round ? `${ethers.formatEther(round.prizePool)} ETH` : "-"}</strong>
        </div>
        <div>
          <span className="label">Ticket</span>
          <strong>{ticketPrice ? `${ethers.formatEther(ticketPrice)} ETH` : "-"}</strong>
        </div>
      </section>

      <section className="rule-band">
        <span className="label">Rules</span>
        <strong>{ruleSummary}</strong>
      </section>

      <section className="time-band">
        <div>
          <span className="label">Countdown</span>
          <strong>
            {!round ? "--:--:--" : round.status === 0 && !salesClosedByTime ? countdownLabel : "Sales closed"}
          </strong>
        </div>
        <p className="muted">Draws are requested manually by the owner after the UTC close time.</p>
      </section>

      <section className="workspace">
        <div className="picker-panel">
          <div className="panel-head">
            <div>
              <h2>Pick Numbers</h2>
              <p>{selectedGame.label} · {STATUS_LABELS[round?.status] || "Loading"}</p>
            </div>
            <div className="actions">
              <button
                type="button"
                onClick={() => {
                  setMainNumbers(randomPickForArea(selectedGame.main));
                  setExtraNumbers(selectedGame.extra ? randomPickForArea(selectedGame.extra) : []);
                }}
              >
                Random All
              </button>
              <button
                type="button"
                onClick={() => {
                  setMainNumbers([]);
                  setExtraNumbers([]);
                }}
              >
                Clear All
              </button>
            </div>
          </div>

          {isLotto && (
            <div className="bet-mode" role="group" aria-label="Bet mode">
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
                <span className="label">{isSystemMode ? "System Entries" : "Entry"}</span>
                <strong>
                  {isSystemMode
                    ? `${systemEntryCount} / ${selectedGame.system.maxEntries}`
                    : "1"}
                </strong>
              </div>
              <div>
                <span className="label">Total Price</span>
                <strong>{ethers.formatEther(isSystemMode ? totalTicketPrice : ticketPrice)} ETH</strong>
              </div>
              <div>
                <span className="label">First Prize</span>
                <strong>{formatProbability(firstPrizeProbability)}</strong>
              </div>
              <div>
                <span className="label">Any Listed Prize</span>
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
              <span className="label">Ticket Numbers</span>
              <strong>
                {formatNumbers(mainNumbers, selectedGame.main)}
                {selectedGame.extra ? ` + ${formatNumbers(extraNumbers, selectedGame.extra)}` : ""}
              </strong>
            </div>
            <button type="button" className="primary" disabled={!canBuy || busy} onClick={buyTicket}>
              {isSystemMode ? "Buy System Ticket" : "Buy Ticket"}
            </button>
          </div>
        </div>

        <aside className="side-panel">
          <h2>Draw</h2>
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
            <p className="muted">Winning numbers are available after the VRF callback.</p>
          )}

          <div className="metrics">
            <span>Request ID</span>
            <strong>{round?.requestId ? round.requestId.toString() : "-"}</strong>
            <span>Rollover</span>
            <strong>{round ? `${ethers.formatEther(round.reserveRollover)} ETH` : "-"}</strong>
          </div>
        </aside>
      </section>

      <section className="tiers-section">
        <div className="panel-head">
          <h2>Prize Tiers</h2>
          <span className="muted">{selectedGame.label}</span>
        </div>
        <TierTable tiers={selectedGame.tiers} tierStats={tierStats} />
      </section>

      <section className="tickets-section">
        <div className="panel-head">
          <div>
            <h2>{account ? "My Tickets" : "Current Round Tickets"}</h2>
            <p>{selectedGame.label} · Round #{roundId.toString()}</p>
          </div>
          <div className="actions">
            <span className="section-count">{tickets.length} loaded</span>
            <button type="button" onClick={() => refresh(account)} disabled={busy}>Refresh</button>
          </div>
        </div>
        <div className="ticket-list">
          {tickets.length === 0 ? (
            <p className="muted">No tickets loaded for this game and round.</p>
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
              ? `${mainMatches}${selectedGame.extra ? ` + ${extraMatches}` : ""} matched`
              : "Waiting for draw";

            return (
              <article className={`ticket-card ${ticketState.tone}`} key={ticket.id}>
                <div className="ticket-main">
                  <div className="ticket-title-row">
                    <strong>Ticket #{ticket.id}</strong>
                    <span className={`status-pill ${ticketState.tone}`}>{ticketState.label}</span>
                  </div>
                  <p className="ticket-numbers">
                    {formatNumbers(ticket.mainNumbers, selectedGame.main)}
                    {selectedGame.extra ? ` + ${formatNumbers(ticket.extraNumbers, selectedGame.extra)}` : ""}
                  </p>
                  <div className="ticket-meta">
                    <span>{shortAddress(ticket.buyer)}</span>
                    <span>{matchLabel}</span>
                    <span>{ticket.claimed ? "Prize paid" : registered ? "Registered" : "Not registered"}</span>
                  </div>
                </div>
                <div className="ticket-actions">
                  {round?.status === 3 && (
                    <button
                      type="button"
                      disabled={busy || registered}
                      onClick={() => transact(
                        (contract) => contract.registerWinningTicket(selectedGameType, roundId, ticket.id),
                        "Winning ticket registered."
                      )}
                    >
                      {registered ? "Registered" : "Register"}
                    </button>
                  )}
                  {round?.status === 4 && (
                    <button
                      type="button"
                      disabled={busy || ticket.claimed || !registered}
                      onClick={() => transact(
                        (contract) => contract.claimPrize(selectedGameType, roundId, ticket.id),
                        "Prize claimed."
                      )}
                    >
                      {ticket.claimed ? "Claimed" : "Claim"}
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
            <h2>History</h2>
            <p>{selectedGame.label} · recent drawn rounds</p>
          </div>
          <span className="section-count">{historyRounds.length} records</span>
        </div>
        <div className="history-list">
          {historyRounds.length === 0 ? (
            <p className="muted">No drawn history loaded for this game yet.</p>
          ) : historyRounds.map((item) => (
            <article className="history-card" key={item.id}>
              <div className="history-round">
                <span className="status-pill success">{STATUS_LABELS[item.status]}</span>
                <strong>Round #{item.id}</strong>
                <p>{formatUtcDate(item.openTime)} · {formatUtcWeekday(item.openTime)}</p>
              </div>
              <div className="history-numbers">
                <span className="label">Winning Numbers</span>
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
                <span className="label">Prize Pool</span>
                <strong>{ethers.formatEther(item.prizePool)} ETH</strong>
                <small>Drawn {formatUtcDateTime(item.drawTime)}</small>
              </div>
            </article>
          ))}
        </div>
      </section>

      {isOwner && (
        <section className="admin-panel">
          <div className="panel-head">
            <div>
              <h2>Admin</h2>
              <p>{selectedGame.label} · Round #{roundId.toString()} lifecycle</p>
            </div>
            <span className="status-pill neutral">{STATUS_LABELS[round?.status] || "Loading"}</span>
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
        </section>
      )}

      {message && <div className="toast">{message}</div>}
    </main>
  );
}
