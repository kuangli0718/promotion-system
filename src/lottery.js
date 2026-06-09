import { ethers } from "ethers";
import abi from "./abi/SuperLottery.json";

export const LOTTERY_ADDRESS = import.meta.env.VITE_SUPER_LOTTERY_ADDRESS || "";
export const LOTTERY_ABI = abi;
export const SEPOLIA_CHAIN_ID = 11155111n;
export const SEPOLIA_CHAIN_ID_HEX = "0xaa36a7";

export const STATUS_LABELS = ["Open", "Closed", "Drawing", "Drawn", "Claimable"];
export const HISTORY_LIMIT = 20;
export const SECOND_MS = 1000;
export const LOTTO_TOTAL_COMBINATIONS = combination(35, 5) * combination(12, 2);
export const UTC_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "UTC",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});
export const UTC_WEEKDAY_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  weekday: "long"
});
export const UTC_DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "UTC",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false
});

export function timestampToMs(timestamp) {
  return Number(timestamp) * SECOND_MS;
}

export function formatUtcDate(timestamp) {
  return timestamp ? UTC_DATE_FORMATTER.format(timestampToMs(timestamp)) : "-";
}

export function formatUtcWeekday(timestamp) {
  return timestamp ? UTC_WEEKDAY_FORMATTER.format(timestampToMs(timestamp)) : "-";
}

export function formatUtcDateTime(timestamp) {
  if (!timestamp) return "-";

  const date = new Date(timestampToMs(timestamp));
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  const seconds = String(date.getUTCSeconds()).padStart(2, "0");

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds} UTC`;
}

export function formatCountdown(milliseconds) {
  const numericMilliseconds = Number(milliseconds);
  const safeMilliseconds = Number.isFinite(numericMilliseconds) ? Math.max(0, numericMilliseconds) : 0;
  const totalSeconds = Math.floor(safeMilliseconds / SECOND_MS);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
}

export const GAME_DEFINITIONS = [
  {
    gameType: 0,
    key: "digital",
    label: "数字型",
    mainLabel: "数字区",
    main: { min: 0, max: 9, pick: 4, draw: 4, allowRepeat: true, ordered: true },
    extraLabel: null,
    extra: null,
    tiers: [
      { id: 1, label: "4位顺序全中", pool: "60%", poolBps: 6000 },
      { id: 2, label: "4位数字相同顺序不同", pool: "20%", poolBps: 2000 },
      { id: 3, label: "末3位顺序相同", pool: "10%", poolBps: 1000 },
      { id: 4, label: "末2位顺序相同", pool: "5%", poolBps: 500 },
      { id: 0, label: "保留滚池", pool: "5%", poolBps: 500 }
    ]
  },
  {
    gameType: 1,
    key: "numberLotto",
    label: "数乐型",
    mainLabel: "数字区",
    main: { min: 0, max: 9, pick: 3, draw: 3, allowRepeat: true, ordered: true },
    extraLabel: "乐透区",
    extra: { min: 1, max: 20, pick: 3, draw: 3, allowRepeat: false, ordered: false },
    tiers: [
      { id: 1, label: "数字3位顺序全中 + 乐透3中", pool: "50%", poolBps: 5000 },
      { id: 2, label: "数字3位顺序全中 + 乐透2中", pool: "20%", poolBps: 2000 },
      { id: 3, label: "数字2位顺序中 + 乐透3中", pool: "15%", poolBps: 1500 },
      { id: 4, label: "数字3位顺序全中", pool: "10%", poolBps: 1000 },
      { id: 0, label: "保留滚池", pool: "5%", poolBps: 500 }
    ]
  },
  {
    gameType: 2,
    key: "lotto",
    label: "乐透型",
    mainLabel: "前区",
    main: { min: 1, max: 35, pick: 5, draw: 5, allowRepeat: false, ordered: false },
    extraLabel: "后区",
    extra: { min: 1, max: 12, pick: 2, draw: 2, allowRepeat: false, ordered: false },
    system: { maxEntries: 100 },
    tiers: [
      { id: 1, label: "前区5中 + 后区2中", pool: "50%", poolBps: 5000 },
      { id: 2, label: "前区5中 + 后区1中", pool: "20%", poolBps: 2000 },
      { id: 3, label: "前区5中", pool: "10%", poolBps: 1000 },
      { id: 4, label: "前区4中 + 后区2中", pool: "10%", poolBps: 1000 },
      { id: 5, label: "前区4中 + 后区1中", pool: "5%", poolBps: 500 },
      { id: 0, label: "保留滚池", pool: "5%", poolBps: 500 }
    ]
  },
  {
    gameType: 3,
    key: "baseLotto",
    label: "基乐型",
    mainLabel: "基础区",
    main: { min: 1, max: 60, pick: 8, draw: 15, allowRepeat: false, ordered: false },
    extraLabel: "乐透区",
    extra: { min: 1, max: 12, pick: 2, draw: 2, allowRepeat: false, ordered: false },
    tiers: [
      { id: 1, label: "基础区8中 + 乐透区2中", pool: "45%", poolBps: 4500 },
      { id: 2, label: "基础区7中 + 乐透区2中", pool: "25%", poolBps: 2500 },
      { id: 3, label: "基础区8中 + 乐透区1中", pool: "15%", poolBps: 1500 },
      { id: 4, label: "基础区7中 + 乐透区1中", pool: "10%", poolBps: 1000 },
      { id: 0, label: "保留滚池", pool: "5%", poolBps: 500 }
    ]
  },
  {
    gameType: 4,
    key: "keno",
    label: "基诺型",
    mainLabel: "基诺区",
    main: { min: 1, max: 80, pick: 10, draw: 20, allowRepeat: false, ordered: false },
    extraLabel: null,
    extra: null,
    tiers: [
      { id: 1, label: "10中", pool: "45%", poolBps: 4500 },
      { id: 2, label: "9中", pool: "25%", poolBps: 2500 },
      { id: 3, label: "8中", pool: "15%", poolBps: 1500 },
      { id: 4, label: "7中", pool: "10%", poolBps: 1000 },
      { id: 0, label: "保留滚池", pool: "5%", poolBps: 500 }
    ]
  }
];

export function formatNumber(value) {
  return Number(value).toString().padStart(2, "0");
}

export function sortedNumbers(values) {
  return [...values].map(Number).sort((a, b) => a - b);
}

export function combination(n, k) {
  if (k < 0 || n < k) return 0;
  let result = 1;
  for (let i = 1; i <= k; i++) {
    result = result * (n - k + i) / i;
  }
  return result;
}

export function getLottoSystemEntryCount(mainCount, extraCount) {
  return combination(mainCount, 5) * combination(extraCount, 2);
}

export function getLottoFirstPrizeProbability(entryCount) {
  return entryCount / LOTTO_TOTAL_COMBINATIONS;
}

export function drawStateProbability(selectedMainCount, selectedExtraCount, mainHits, extraHits) {
  const mainWays = combination(selectedMainCount, mainHits)
    * combination(35 - selectedMainCount, 5 - mainHits);
  const extraWays = combination(selectedExtraCount, extraHits)
    * combination(12 - selectedExtraCount, 2 - extraHits);
  return (mainWays * extraWays) / LOTTO_TOTAL_COMBINATIONS;
}

export function getLottoTierProbabilities(selectedMainCount, selectedExtraCount) {
  const tiers = [
    { id: 1, label: "一等奖", matches: (mainHits, extraHits) => mainHits >= 5 && extraHits >= 2 },
    {
      id: 2,
      label: "二等奖",
      matches: (mainHits, extraHits) => mainHits >= 5 && extraHits >= 1 && selectedExtraCount - extraHits >= 1
    },
    {
      id: 3,
      label: "三等奖",
      matches: (mainHits, extraHits) => mainHits >= 5 && selectedExtraCount - extraHits >= 2
    },
    {
      id: 4,
      label: "四等奖",
      matches: (mainHits, extraHits) => mainHits >= 4 && selectedMainCount - mainHits >= 1 && extraHits >= 2
    },
    {
      id: 5,
      label: "五等奖",
      matches: (mainHits, extraHits) => (
        mainHits >= 4
        && selectedMainCount - mainHits >= 1
        && extraHits >= 1
        && selectedExtraCount - extraHits >= 1
      )
    }
  ];

  const results = tiers.map((tier) => ({ ...tier, probability: 0 }));
  let listedPrizeProbability = 0;

  for (let mainHits = 0; mainHits <= Math.min(selectedMainCount, 5); mainHits++) {
    for (let extraHits = 0; extraHits <= Math.min(selectedExtraCount, 2); extraHits++) {
      const probability = drawStateProbability(selectedMainCount, selectedExtraCount, mainHits, extraHits);
      let hasListedPrize = false;
      for (const result of results) {
        if (result.matches(mainHits, extraHits)) {
          result.probability += probability;
          hasListedPrize = true;
        }
      }
      if (hasListedPrize) {
        listedPrizeProbability += probability;
      }
    }
  }

  return {
    tiers: results.map(({ id, label, probability }) => ({ id, label, probability })),
    listedPrizeProbability
  };
}

export function formatProbability(probability) {
  if (!Number.isFinite(probability) || probability <= 0) return "0";
  const percent = probability * 100;
  if (percent >= 0.01) return `${percent.toFixed(4)}%`;
  return `${percent.toPrecision(4)}%`;
}

export function randomPick(max, count) {
  const values = [];
  while (values.length < count) {
    const next = Math.floor(Math.random() * max) + 1;
    if (!values.includes(next)) {
      values.push(next);
    }
  }
  return sortedNumbers(values);
}

export function getGameDefinition(gameType) {
  return GAME_DEFINITIONS.find((game) => game.gameType === Number(gameType));
}

export function togglePick(selected, value, area) {
  const selectedNumbers = selected.map(Number);
  const requestedValue = typeof value === "object" ? Number(value.value) : Number(value);
  const requestedIndex = typeof value === "object" ? value.index : undefined;

  if (area.allowRepeat && area.ordered) {
    if (Number.isInteger(requestedIndex)) {
      return selectedNumbers.filter((_, index) => index !== requestedIndex);
    }
    if (selectedNumbers.length < area.pick) {
      return [...selectedNumbers, requestedValue];
    }
    if (selectedNumbers.includes(requestedValue)) {
      const index = selectedNumbers.indexOf(requestedValue);
      return selectedNumbers.filter((_, i) => i !== index);
    }
    return selectedNumbers;
  }

  if (selectedNumbers.includes(requestedValue)) {
    const next = selectedNumbers.filter((number) => number !== requestedValue);
    return area.ordered ? next : sortedNumbers(next);
  }
  if (selectedNumbers.length >= area.pick) {
    return selectedNumbers;
  }

  const next = [...selectedNumbers, requestedValue];
  return area.ordered ? next : sortedNumbers(next);
}

export function randomPickForArea(area, count = area.pick) {
  const values = [];
  while (values.length < count) {
    const next = Math.floor(Math.random() * (area.max - area.min + 1)) + area.min;
    if (area.allowRepeat || !values.includes(next)) {
      values.push(next);
    }
  }
  return area.ordered ? values : sortedNumbers(values);
}

export async function getLotteryContract(withSigner = false) {
  if (!window.ethereum) {
    throw new Error("Wallet not found");
  }
  if (!LOTTERY_ADDRESS) {
    throw new Error("Set VITE_SUPER_LOTTERY_ADDRESS in .env");
  }
  const provider = new ethers.BrowserProvider(window.ethereum);
  const network = await provider.getNetwork();
  if (network.chainId !== SEPOLIA_CHAIN_ID) {
    throw new Error("Switch wallet network to Sepolia");
  }
  if (withSigner) {
    return new ethers.Contract(LOTTERY_ADDRESS, LOTTERY_ABI, await provider.getSigner());
  }
  return new ethers.Contract(LOTTERY_ADDRESS, LOTTERY_ABI, provider);
}

export async function switchToSepolia() {
  if (!window.ethereum) {
    throw new Error("Wallet not found");
  }
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: SEPOLIA_CHAIN_ID_HEX }]
    });
  } catch (error) {
    if (error.code !== 4902) {
      throw error;
    }
    await window.ethereum.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: SEPOLIA_CHAIN_ID_HEX,
        chainName: "Sepolia",
        nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: ["https://rpc.sepolia.org"],
        blockExplorerUrls: ["https://sepolia.etherscan.io"]
      }]
    });
  }
}
