// Testa o cálculo do empréstimo de equilíbrio com concessões extraordinárias. Uso: node tools/loan-analysis.test.js
global.window = { ManchaApp: { _: () => "id" } };
require("../js/features/economy.js");
const E = window.ManchaApp;
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) { console.error("FAIL", m, JSON.stringify(a), "!=", JSON.stringify(b)); process.exit(1); } console.log("ok", m); };
const mk = (grants) => ({ economySettings: { balanceLoanSettings: { enabled: true, maximumTotalAmount: 100, allowTopUps: true }, balanceLoans: { A: { teamId: "A", totalGranted: grants.reduce((s, g) => s + g.amount, 0), remaining: 50, status: "active", repaymentPercentage: 40, grants } } }, matches: [] });
const teams = [{ id: "A", active: true }, { id: "B", active: true }];
let a = E.balanceLoanAnalysis(mk([{ amount: 80, type: "extraordinary" }]), teams, "A");
eq([a.hasRegularGrant, a.totalGranted, a.extraordinaryGranted], [false, 0, 80], "só extraordinário: sem concessão regular");
a = E.balanceLoanAnalysis(mk([{ amount: 60, snapshot: { referenceGames: 5, played: 3 } }, { amount: 200, type: "extraordinary" }]), teams, "A");
eq([a.hasRegularGrant, a.totalGranted, a.extraordinaryGranted], [true, 60, 200], "regular 60 + extraordinário 200: teto usa só o regular");
eq(a.lastGrant && a.lastGrant.amount, 60, "última concessão regular ignora a extraordinária");
a = E.balanceLoanAnalysis({ economySettings: { balanceLoans: { A: { teamId: "A", totalGranted: 70, remaining: 10, status: "active" } } }, matches: [] }, teams, "A");
eq([a.hasRegularGrant, a.totalGranted, a.extraordinaryGranted], [true, 70, 0], "legado sem grants: igual ao antes");
a = E.balanceLoanAnalysis({ economySettings: {}, matches: [] }, teams, "B");
eq([a.loan, a.hasRegularGrant, a.totalGranted], [null, false, 0], "sem empréstimo");
