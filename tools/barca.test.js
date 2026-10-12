// Testa a "barca" (venda em lote). Uso: node tools/barca.test.js
global.window = { ManchaApp: {} };
require("../js/features/market.js");
require("../js/features/barca.js");
const B = window.ManchaApp.BarcaFeature;
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) { console.error("FAIL", m, JSON.stringify(a), "!=", JSON.stringify(b)); process.exit(1); } console.log("ok", m); };
const players = {}; for (let i = 1; i <= 40; i++) players[i] = { id: String(i), name: "P" + i, overall: 60 + (i % 10), value: 100 };
const catalog = Object.values(players);
const own = (ids, team, extra = {}) => Object.fromEntries(ids.map((i) => [String(i), { teamId: team, acquisitionSource: "market_purchase", ...extra }]));
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const base = (over = {}) => ({
  tournament: { rosterSettings: { minPlayers: 23, maxPlayers: 30 }, marketSettings: { depreciationPct: 10 }, ...(over.tournament || {}) },
  teamId: "A", playerIds: ["1", "2", "3"], ownership: { ...own(range(1, 25), "A"), ...own(range(26, 40), "B") }, transfers: [],
  teams: [{ id: "A", budget: 50, active: true }, { id: "B", budget: 10, active: true }], catalog, playerOf: (id) => players[id],
  marketOpen: true, minGamesBlocked: false, tradeLockFor: () => ({ locked: false }), ...over.ctx,
});
let p = B.barcaPlan(base());
eq([p.items.length, p.total, p.budgetBefore, p.budgetAfter, p.rosterBefore, p.rosterAfter, p.ok], [3, 270, 50, 320, 25, 22, false], "3 de 25: total 270, elenco ficaria 22 (<23) bloqueia");
p = B.barcaPlan(base({ ctx: { playerIds: ["1", "2"] } }));
eq([p.rosterAfter, p.ok, p.blockers.length], [23, true, 0], "2 de 25: ok no limite");
p = B.barcaPlan(base({ ctx: { marketOpen: false, playerIds: ["1"] } }));
eq(p.ok, false, "mercado fechado bloqueia");
p = B.barcaPlan(base({ ctx: { minGamesBlocked: true, playerIds: ["1"] } }));
eq(p.ok, false, "mínimo de jogos bloqueia");
p = B.barcaPlan(base({ ctx: { playerIds: ["1", "2"], tradeLockFor: (id) => id === "2" ? { locked: true, gamesRemaining: 4 } : { locked: false } } }));
eq([p.ok, /P2.*4 jogos/.test(p.blockers.join())], [false, true], "jogador travado bloqueia e informa jogos");
p = B.barcaPlan(base({ ctx: { playerIds: ["30"] } }));
eq([p.ok, p.items.length], [false, 0], "jogador de outro time é recusado");
// elenco-base mínimo
const bo = { ...own(range(1, 25), "A", { acquisitionSource: "initial_roster", initialTeamId: "A" }), ...own(range(26, 40), "B") };
p = B.barcaPlan(base({ tournament: { rosterSettings: { minPlayers: 10, maxPlayers: 30, minBaseRosterPlayers: 24 }, marketSettings: { initialRosterDepreciationPct: 50 } }, ctx: { ownership: bo, playerIds: ["1", "2"] } }));
eq([p.baseBefore, p.baseAfter, p.ok, p.total], [25, 23, false, 100], "mín. elenco-base (24): 25→23 bloqueia; depreciação 50% => 2x50");
p = B.barcaPlan(base({ tournament: { rosterSettings: { minPlayers: 10, maxPlayers: 30, minBaseRosterPlayers: 23 }, marketSettings: { initialRosterDepreciationPct: 50 } }, ctx: { ownership: bo, playerIds: ["1", "2"] } }));
eq(p.ok, true, "mín. elenco-base (23): 25→23 passa");
// pacote usa depreciação do pacote
global.window.ManchaApp.PacksFeature = { packSellDepreciationPct: () => 25 };
const po = own(range(1, 25), "A", { acquisitionSource: "pack" });
p = B.barcaPlan(base({ ctx: { ownership: { ...po, ...own(range(26, 40), "B") }, playerIds: ["1", "2"] } }));
eq(p.total, 150, "cartas de pacote: 25% => 2x75");
// equilíbrio: A forte vende craques e abre diferença
const eqPlayers = {}; const eqOwn = {};
for (let i = 1; i <= 30; i++) { eqPlayers[i] = { id: String(i), name: "Q" + i, overall: i <= 15 ? 90 : 70, value: 10 }; eqOwn[i] = { teamId: i <= 15 ? "A" : "B" }; }
for (let i = 1; i <= 30; i++) { eqOwn[i + 100] = { teamId: i <= 15 ? "A" : "B" }; eqPlayers[i + 100] = { id: String(i + 100), name: "R" + i, overall: 80, value: 10 }; }
const bal = (maxDifference, recoveryMode, ids) => B.barcaPlan({ tournament: { rosterSettings: { minPlayers: 1 }, marketBalanceSettings: { enabled: true, maxDifference, recoveryMode } }, teamId: "A", playerIds: ids, ownership: eqOwn, transfers: [], teams: [{ id: "A", budget: 0, active: true }, { id: "B", budget: 0, active: true }], catalog: Object.values(eqPlayers), playerOf: (id) => eqPlayers[id], marketOpen: true, tradeLockFor: () => ({}) });
// A = (15*90+15*80)/30=85 ; B = (15*70+15*80)/30=75 ; gap 10
let r = bal(10, true, ["1"]);
eq([r.balance.allowed, r.ok], [true, true], "vender 1 craque aproxima os times: gap diminui, passa");
r = bal(10, false, ["16"]); // B vendendo? não pertence a A -> bloqueado
eq(r.ok, false, "jogador alheio");
// A vende fracos (R, 80) -> A sobe, gap aumenta => bloqueia com limite 10 sem recuperação
r = bal(10, false, ["101", "102"]);
eq([r.balance.allowed, r.ok], [false, false], "vender os piores de A abre a diferença: bloqueia (limite 10)");
r = bal(20, false, ["101", "102"]);
eq(r.balance.allowed, true, "mesmo caso com limite 20 passa");
// modo recuperação: gap atual 10 > limite 5, vender craque reduz => passa; vender fraco aumenta => bloqueia
eq(bal(5, true, ["1"]).balance.allowed, true, "recuperação: reduzir gap passa");
eq(bal(5, true, ["101"]).balance.allowed, false, "recuperação: aumentar gap bloqueia");
// applyBarca: saldo encadeado, 1 transferência + 1 lançamento por jogador
p = B.barcaPlan(base({ ctx: { playerIds: ["1", "2"] } }));
const fe = (type, teamId, amount, label, ref, before, at) => ({ type, teamId, amount, label, referenceId: ref, balanceBefore: before, balanceAfter: before + amount, createdAt: at });
let n = 0;
const t = { id: "T", context: { teams: base().teams, ownership: base().ownership, transfers: [], financialTransactions: [], tradeOffers: { o1: { playerId: "1", status: "pending" }, o2: { playerId: "9", status: "pending" } } } };
const out = B.applyBarca(t, p, "A", { financeEntry: fe, newId: () => "id" + (++n), now: 1000 });
const c = out.context;
eq([c.teams[0].budget, Object.keys(c.ownership).length, c.transfers.length, c.financialTransactions.length], [230, 38, 2, 2], "aplicar: saldo 50+180, 38 no mapa, 2 transf, 2 lançamentos");
eq(c.financialTransactions.slice().reverse().map((f) => [f.balanceBefore, f.balanceAfter]), [[50, 140], [140, 230]], "lançamentos encadeados");
eq([c.tradeOffers.o1.status, c.tradeOffers.o2.status], ["invalid", "pending"], "ofertas pendentes do jogador vendido invalidadas");
eq(c.transfers.every((x) => x.type === "market_sale" && x.fromTeamId === "A" && x.toTeamId === null), true, "transferências market_sale");
console.log("TODOS OK");
