// Testa as trocas entre participantes. Uso: node tools/trade.test.js
global.window = { ManchaApp: {} };
require("../js/features/market.js");
require("../js/features/trade.js");
const T = window.ManchaApp.TradeFeature;
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) { console.error("FAIL", m, JSON.stringify(a), "!=", JSON.stringify(b)); process.exit(1); } console.log("ok", m); };
const players = {}; for (let i = 1; i <= 60; i++) players[i] = { id: String(i), name: "P" + i, overall: 70 + (i % 10), value: i <= 30 ? 100 : 40 };
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const own = (ids, team, extra = {}) => Object.fromEntries(ids.map((i) => [String(i), { teamId: team, acquisitionSource: "market_purchase", ...extra }]));
const teams = () => [{ id: "A", name: "Alice", budget: 500, active: true }, { id: "B", name: "Bob", budget: 500, active: true }];
const ctx = (over = {}) => ({
  tournament: { rosterSettings: { minPlayers: 5, maxPlayers: 12 }, ...(over.tournament || {}) },
  ownership: { ...own(range(1, 10), "A"), ...own(range(31, 40), "B") }, transfers: [], teams: teams(), catalog: Object.values(players), playerOf: (id) => players[id],
  marketOpen: true, minGames: () => ({ blocked: false }), tradeLockFor: () => ({ locked: false }), ...(over.ctx || {}),
});
const terms = (o = {}) => ({ fromTeamId: "A", toTeamId: "B", give: ["1"], get: ["31"], cash: 0, ...o });

let p = T.tradePlan(terms(), ctx());
eq([p.valueGive, p.valueGet, p.suggestedCash, p.fee.total, p.fee.each, p.ok], [100, 40, -60, 5, 3, true], "1x1: valores, troco sugerido (-60: quem propõe recebe 60) e taxa 5% do maior lado (5, 3 cada)");
p = T.tradePlan(terms({ give: ["1", "2"], get: ["31", "32", "33"] }), ctx());
eq([p.ok, p.valueGive, p.valueGet, p.suggestedCash], [true, 200, 120, -80], "2x3 permitido (limite padrão 3)");
p = T.tradePlan(terms({ give: ["1", "2", "3", "4"] }), ctx());
eq(p.ok, false, "4 de um lado passa do limite padrão (3)");
p = T.tradePlan(terms({ give: ["1", "2", "3", "4"] }), ctx({ tournament: { tradeSettings: { maxPlayersPerSide: 4 }, rosterSettings: { minPlayers: 5, maxPlayers: 14 } } }));
eq(p.ok, true, "limite configurável (4) libera");
p = T.tradePlan(terms({ give: ["31"] }), ctx());
eq(p.ok, false, "jogador que não é de quem propõe");
p = T.tradePlan(terms({ give: [] }), ctx()); eq(p.ok, false, "sem jogador de um lado");
p = T.tradePlan(terms({ fromTeamId: "A", toTeamId: "A" }), ctx()); eq(p.ok, false, "mesmo time");
p = T.tradePlan(terms(), ctx({ ctx: { marketOpen: false } })); eq(p.ok, false, "mercado fechado");
p = T.tradePlan(terms(), ctx({ tournament: { tradeSettings: { enabled: false } } })); eq(p.ok, false, "trocas desativadas");
p = T.tradePlan(terms(), ctx({ ctx: { minGames: (id) => ({ blocked: id === "B", message: "x" }) } })); eq(p.ok, false, "mínimo de jogos de um dos times");
p = T.tradePlan(terms(), ctx({ ctx: { tradeLockFor: (id) => ({ locked: id === "31", gamesRemaining: 3 }) } }));
eq([p.ok, /P31.*3 jogos/.test(p.blockers.join())], [false, true], "jogador travado informa jogos");
// saldo
p = T.tradePlan(terms({ cash: 600 }), ctx()); eq(p.ok, false, "troco acima do saldo de quem paga");
p = T.tradePlan(terms({ cash: -600 }), ctx()); eq(p.ok, false, "troco acima do saldo de quem recebe a proposta (negativo)");
p = T.tradePlan(terms({ cash: 100 }), ctx());
eq([p.budgets.from.after, p.budgets.to.after, p.ok], [500 - 100 - 3, 500 + 100 - 3, true], "saldos depois: troco + metade da taxa para cada");
// elenco
p = T.tradePlan(terms({ give: ["1"], get: ["31", "32", "33"] }), ctx({ tournament: { rosterSettings: { minPlayers: 5, maxPlayers: 11 } } })); eq(p.ok, false, "passa do máximo (10-1+3=12 > 11)");
p = T.tradePlan(terms({ give: ["1", "2", "3"], get: ["31"] }), ctx({ tournament: { rosterSettings: { minPlayers: 9, maxPlayers: 12 } } })); eq(p.ok, false, "abaixo do mínimo (10-3+1=8 < 9)");
// elenco-base
const base = { ...own(range(1, 10), "A", { acquisitionSource: "initial_roster", initialTeamId: "A" }), ...own(range(31, 40), "B") };
p = T.tradePlan(terms({ give: ["1", "2"], get: ["31", "32"] }), ctx({ tournament: { rosterSettings: { minPlayers: 5, maxPlayers: 12, minBaseRosterPlayers: 9 } }, ctx: { ownership: base } }));
eq(p.ok, false, "elenco-base: 10 - 2 = 8 < 9");
p = T.tradePlan(terms({ give: ["1", "2"], get: ["31", "32"] }), ctx({ tournament: { rosterSettings: { minPlayers: 5, maxPlayers: 12, minBaseRosterPlayers: 8 } }, ctx: { ownership: base } }));
eq(p.ok, true, "elenco-base: 10 - 2 = 8 ok com mínimo 8");
// equilíbrio
const eqP = {}; const eqO = {};
for (let i = 1; i <= 20; i++) { eqP[i] = { id: String(i), name: "Q" + i, overall: i <= 10 ? 90 : 70, value: 10 }; eqO[i] = { teamId: i <= 10 ? "A" : "B" }; }
const bal = (maxDifference, recoveryMode, give, get) => T.tradePlan(terms({ give, get }), { tournament: { rosterSettings: { minPlayers: 1, maxPlayers: 30 }, marketBalanceSettings: { enabled: true, maxDifference, recoveryMode } }, ownership: eqO, transfers: [], teams: teams(), catalog: Object.values(eqP), playerOf: (id) => eqP[id], marketOpen: true, minGames: () => ({}), tradeLockFor: () => ({}) });
// A=90, B=70 (gap 20). Trocar craque de A por fraco de B aproxima os times; o contrário afasta.
eq(bal(25, false, ["1"], ["11"]).balance.allowed, true, "troca que aproxima os times passa (limite 25)");
eq(bal(5, true, ["1"], ["11"]).balance.allowed, true, "modo recuperação: reduzir diferença passa");
eq(bal(5, true, ["11"].map(String), ["1"]).ok, false, "dono errado (11 é de B) bloqueia");
// ciclo de vida e aplicação
const deps = (now) => ({ now, newId: (() => { let n = 0; return () => "id" + (++n); })(), financeEntry: (type, teamId, amount, label, ref, before, at) => ({ type, teamId, amount, label, referenceId: ref, balanceBefore: before, balanceAfter: before + amount, createdAt: at }), playerOf: (id) => players[id] });
const settings = T.tradeSettingsOf({});
eq([settings.maxPlayersPerSide, settings.feePct, settings.expiryHours], [3, 5, 48], "padrões: 3 por lado, 5% de taxa, 48 h");
const d = deps(1000);
const proposal = T.newProposal(terms({ give: ["1", "2"], get: ["31"], cash: -20 }), settings, d);
eq([proposal.status, proposal.expiresAt], ["pending", 1000 + 48 * 3600000], "proposta nasce pendente e expira em 48 h");
eq([T.displayStatus(proposal, 1000 + 47 * 3600000), T.displayStatus(proposal, 1000 + 49 * 3600000)], ["pending", "expired"], "expira sem processo em segundo plano");
const tour = { id: "T", context: { teams: teams(), ownership: ctx().ownership, transfers: [], financialTransactions: [], tradeOffers: { o1: { playerId: "1", status: "pending" }, o2: { playerId: "9", status: "pending" } }, tradeProposals: {} } };
const withProposal = T.applyPropose(tour, proposal);
const other = T.newProposal(terms({ give: ["1"], get: ["32"] }), settings, d);
const withBoth = T.applyPropose(withProposal, other);
const plan = T.tradePlan({ ...proposal }, ctx());
const out = T.applyTrade(withBoth, proposal, plan, deps(2000));
const c = out.context;
eq([c.ownership["1"].teamId, c.ownership["2"].teamId, c.ownership["31"].teamId, c.ownership["32"].teamId], ["B", "B", "A", "B"], "posse trocada (1,2 -> B; 31 -> A; 32 fica)");
const budget = (id) => c.teams.find((t) => t.id === id).budget;
const fee = T.feeOf(200, 40, 5);
eq([budget("A"), budget("B")], [500 + 20 - fee.each, 500 - 20 - fee.each], "saldos: troco de -20 (quem propõe recebe 20) e metade da taxa cada");
eq(c.teams.reduce((s, t) => s + t.budget, 0), 1000 - 2 * fee.each, "dinheiro total só cai pela taxa (o troco é soma zero)");
eq([c.transfers.length, c.transfers.every((x) => x.tradeId === proposal.id && x.type === "user_transfer")], [3, true], "1 transferência por jogador, ligadas ao id da troca");
eq(c.financialTransactions.filter((f) => f.type === "trade_cash").map((f) => f.amount).sort((a, b) => a - b), [-20, 20], "2 lançamentos de troco somando zero");
const chainA = c.financialTransactions.filter((f) => f.teamId === "A").reverse().map((f) => [f.balanceBefore, f.balanceAfter]);
eq(chainA[0][0] === 500 && chainA[0][1] === chainA[1][0], true, "lançamentos de A encadeados");
eq([c.tradeOffers.o1.status, c.tradeOffers.o2.status], ["invalid", "pending"], "oferta antiga do jogador trocado invalidada");
eq([c.tradeProposals[proposal.id].status, c.tradeProposals[other.id].status], ["accepted", "invalid"], "proposta aceita; outra que usava o jogador 1 invalidada");
const counter = T.newProposal({ fromTeamId: "B", toTeamId: "A", give: ["31"], get: ["1"], cash: 10 }, settings, d, { counterOf: proposal.id });
const afterCounter = T.applyPropose(withProposal, counter, proposal.id);
eq([afterCounter.context.tradeProposals[proposal.id].status, afterCounter.context.tradeProposals[counter.id].counterOf], ["countered", proposal.id], "contraproposta encerra a original e liga as duas");
const closed = T.applyClose(withProposal, proposal.id, "declined", 3000);
eq(closed.context.tradeProposals[proposal.id].status, "declined", "recusar");
const many = {}; for (let i = 0; i < 100; i++) many["p" + i] = { status: "declined", updatedAt: i }; many.open = { status: "pending", updatedAt: 0 };
const pr = T.pruneProposals(many, 60); eq([Object.keys(pr).length, !!pr.open, !!pr.p99, !!pr.p0], [61, true, true, false], "poda mantém as 60 encerradas mais recentes e todas as abertas");
// estorno
const rbTour = { ...out, context: { ...out.context } };
const rb = T.applyRevertTrade(rbTour, proposal.id, { now: 5000, financeEntry: deps(5000).financeEntry });
eq([!!rb.tournament, rb.tournament.context.ownership["1"].teamId, rb.tournament.context.ownership["31"].teamId, rb.tournament.context.tradeProposals[proposal.id].status], [true, "A", "B", "reverted"], "estorno devolve os jogadores");
eq(rb.tournament.context.teams.map((x) => x.budget), [500, 500], "estorno devolve saldos (troco e taxa)");
eq(rb.tournament.context.transfers.every((x) => x.rolledBackAt === 5000), true, "transferências marcadas como revertidas");
const moved = { ...out, context: { ...out.context, ownership: { ...out.context.ownership, "1": { teamId: "A" } } } };
eq(!!T.applyRevertTrade(moved, proposal.id, { now: 1, financeEntry: deps(1).financeEntry }).error, true, "estorno bloqueado se o jogador já saiu");
eq(!!T.applyRevertTrade(rb.tournament, proposal.id, { now: 1, financeEntry: deps(1).financeEntry }).error, true, "não estorna duas vezes");
console.log("TODOS OK");
