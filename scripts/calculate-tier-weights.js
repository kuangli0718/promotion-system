const COMPRESSION = 0.3;
const WEIGHT_SCALE = 1_000_000;

function combination(n, k) {
  if (k < 0 || n < k) return 0;
  let result = 1;
  for (let i = 1; i <= k; i++) {
    result = result * (n - k + i) / i;
  }
  return result;
}

function weightFromProbability(probability) {
  return Math.round((1 / probability) ** COMPRESSION * WEIGHT_SCALE);
}

function printGame(label, tiers) {
  console.log(label);
  let previousWeight = Infinity;
  for (const tier of tiers) {
    const weight = weightFromProbability(tier.probability);
    const monotonic = weight < previousWeight ? "" : "  !non-monotonic";
    previousWeight = weight;
    console.log(
      `  Tier ${tier.tierId}: probability=${tier.probability} weight=${weight}${monotonic}  ${tier.note}`
    );
  }
}

function unorderedMatchProbability(ticketCount, drawCount, universe, matches) {
  return (
    combination(ticketCount, matches)
    * combination(universe - ticketCount, drawCount - matches)
    / combination(universe, drawCount)
  );
}

function digitalTiers() {
  const counts = [0, 0, 0, 0];
  const total = 10_000 * 10_000;

  for (let ticket = 0; ticket < 10_000; ticket++) {
    const ticketDigits = digits4(ticket);
    const ticketCounts = digitCounts(ticketDigits);
    for (let draw = 0; draw < 10_000; draw++) {
      const drawDigits = digits4(draw);
      const suffixMatches = countOrderedSuffixMatches(ticketDigits, drawDigits);
      if (suffixMatches === 4) {
        counts[0]++;
      } else if (sameCounts(ticketCounts, digitCounts(drawDigits))) {
        counts[1]++;
      } else if (suffixMatches >= 3) {
        counts[2]++;
      } else if (suffixMatches >= 2) {
        counts[3]++;
      }
    }
  }

  return [
    { tierId: 1, probability: counts[0] / total, note: "4 ordered digits" },
    { tierId: 2, probability: counts[1] / total, note: "same 4-digit multiset, not exact" },
    { tierId: 3, probability: counts[2] / total, note: "last 3 ordered digits after higher tiers" },
    { tierId: 4, probability: counts[3] / total, note: "last 2 ordered digits after higher tiers" }
  ];
}

function digits4(value) {
  return [
    Math.floor(value / 1000) % 10,
    Math.floor(value / 100) % 10,
    Math.floor(value / 10) % 10,
    value % 10
  ];
}

function digitCounts(digits) {
  const counts = new Array(10).fill(0);
  for (const digit of digits) counts[digit]++;
  return counts;
}

function sameCounts(left, right) {
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

function countOrderedSuffixMatches(left, right) {
  let count = 0;
  for (let i = 3; i >= 0; i--) {
    if (left[i] !== right[i]) break;
    count++;
  }
  return count;
}

function numberLottoTiers() {
  const suffix3 = 1 / 1000;
  const suffix2Only = 9 / 1000;
  const lotto3 = unorderedMatchProbability(3, 3, 20, 3);
  const lotto2 = unorderedMatchProbability(3, 3, 20, 2);
  const lotto0Or1 = 1 - lotto3 - lotto2;

  return [
    { tierId: 1, probability: suffix3 * lotto3, note: "3 ordered digits + lotto 3" },
    { tierId: 2, probability: suffix3 * lotto2, note: "3 ordered digits + lotto exactly 2" },
    { tierId: 3, probability: suffix2Only * lotto3, note: "last 2 ordered digits + lotto 3" },
    { tierId: 4, probability: suffix3 * lotto0Or1, note: "3 ordered digits + lotto 0/1" }
  ];
}

function lottoTiers() {
  const total = combination(35, 5) * combination(12, 2);
  return [
    { tierId: 1, probability: 1 / total, note: "front 5 + back 2" },
    { tierId: 2, probability: 20 / total, note: "front 5 + back exactly 1" },
    { tierId: 3, probability: 45 / total, note: "front 5 + back 0" },
    { tierId: 4, probability: 150 / total, note: "front exactly 4 + back 2" },
    { tierId: 5, probability: 3000 / total, note: "front exactly 4 + back exactly 1" }
  ];
}

function baseLottoTiers() {
  const main8 = unorderedMatchProbability(8, 15, 60, 8);
  const main7 = unorderedMatchProbability(8, 15, 60, 7);
  const extra2 = unorderedMatchProbability(2, 2, 12, 2);
  const extra1 = unorderedMatchProbability(2, 2, 12, 1);

  return [
    { tierId: 1, probability: main8 * extra2, note: "base 8 + lotto 2" },
    { tierId: 2, probability: main7 * extra2, note: "base exactly 7 + lotto 2" },
    { tierId: 3, probability: main8 * extra1, note: "base 8 + lotto exactly 1" },
    { tierId: 4, probability: main7 * extra1, note: "base exactly 7 + lotto exactly 1" }
  ];
}

function kenoTiers() {
  return [10, 9, 8, 7].map((matches, index) => ({
    tierId: index + 1,
    probability: unorderedMatchProbability(10, 20, 80, matches),
    note: `keno exactly ${matches}`
  }));
}

console.log(`compression=${COMPRESSION}`);
console.log(`scale=${WEIGHT_SCALE}`);
printGame("Digital", digitalTiers());
printGame("NumberLotto", numberLottoTiers());
printGame("Lotto", lottoTiers());
printGame("BaseLotto", baseLottoTiers());
printGame("Keno", kenoTiers());
