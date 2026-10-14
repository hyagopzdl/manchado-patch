// Testa o consultor de preços dos pacotes. Uso: node tools/pack-advisor.test.js
global.window = { ManchaApp: {} };
require("../js/features/packs.js");
const P = window.ManchaApp.PacksFeature;
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) { console.error("FAIL", m, JSON.stringify(a), "!=", JSON.stringify(b)); process.exit(1); } console.log("ok", m); };
const pool = new Map([[70, { n: 10, total: 10, sumValue: 1000 }], [80, { n: 10, total: 10, sumValue: 2000 }]]); // valor medio 100 e 200
const packs = [
  { id: "a", cards: 3, weights: { 70: 1 }, price: 50 },
  { id: "b", cards: 3, weights: { 80: 1 }, price: 100 },
  { id: "c", cards: 3, weights: { 80: 1 }, price: 100 },
  { id: "x", cards: 3, weights: { 95: 1 }, price: 100 }, // overall sem jogador livre
  { id: "p", cards: 3, interaction: "pick", weights: { 80: 1 }, price: 100 },
];
const r = P.recommendPackPrices({ packs, pool, sellPct: 25, marginPct: 10 });
// a: EV 300, volta 225, /0.9 = 250 ; b: EV 600, volta 450, /0.9 = 500 ; c igual a b -> sobe 5
eq(r.slice(0, 3).map((x) => x.recommended), [250, 500, 505], "precos recomendados crescem e arredondam em 5");
eq(r[3].valid, false, "pacote sem jogador livre e invalido");
eq(r[4].evPack, 200, "pacote 'escolhe 1' usa 1 carta (EV 200)");
eq(r[4].recommended, 510, "pick (valor 165 pelo EV) tambem respeita a ordem crescente");
eq(r[0].net, 50 - 225, "net calculado com o preco atual (50 - 225)");
const margemZero = P.recommendPackPrices({ packs: [packs[0]], pool, sellPct: 25, marginPct: 0 });
eq(margemZero[0].recommended, 225, "margem 0: preco = valor que volta");
const eco = { winReward: 5, scoringDrawReward: 3, scorelessDrawReward: 2, lossReward: 1, goalReward: 1, redCardPenalty: 1 };
const est = P.estimateIncomePerGame({ economy: eco, matches: [], matchEconomy: null });
eq([est.source, Math.round(est.value * 100) / 100], ["estimate", 4.22], "estimativa neutra: 0,375*5+0,375*1+0,25*2,8+1,3-0,03");
const matches = Array.from({ length: 8 }, (_, i) => ({ played: true, homeId: "A", awayId: "B", economyRewards: { A: 10, B: 2 } }));
const real = P.estimateIncomePerGame({ economy: eco, matches, matchEconomy: () => ({ total: 0 }) });
eq([real.source, real.value, real.games], ["real", 6, 8], "com jogos reais usa a media do que foi pago");
const few = P.estimateIncomePerGame({ economy: eco, matches: matches.slice(0, 3), matchEconomy: () => ({ total: 0 }) });
eq(few.source, "estimate", "poucos jogos: volta para a estimativa");
console.log("TODOS OK");
