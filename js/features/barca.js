(() => {
  window.ManchaApp = window.ManchaApp || {};

  // "Barca": venda de vários jogadores ao mercado de uma vez.
  // Funções puras: a UI usa para a prévia e a transação usa (sobre o estado do servidor) para validar e aplicar.
  function Market() { return window.ManchaApp.MarketFeature; }

  function minPlayersOf(tournament) {
    let roster = tournament && tournament.rosterSettings;
    return Math.max(0, Number(roster && roster.minPlayers != null ? roster.minPlayers : 23) || 0);
  }

  function saleAmount(value, depreciationPct) {
    return Math.ceil((Number(value) || 0) * (1 - (Number(depreciationPct) || 0) / 100));
  }

  // Equilíbrio entre os times depois que o time vendedor perde os jogadores.
  // Mesma regra de evaluateMarketBalance (limite de diferença + modo recuperação), aplicada à saída de jogadores.
  function evaluateSaleBalance(tournament, teamId, playerIds, teams, ownership, catalog) {
    let M = Market();
    let settings = M.marketBalanceSettings(tournament);
    if (!settings.enabled) return { allowed: true, enabled: false, maxDifference: settings.maxDifference };
    let activeTeams = (Array.isArray(teams) ? teams : []).filter((team) => team && team.active !== false);
    if (activeTeams.length < 2) return { allowed: true, enabled: true, maxDifference: settings.maxDifference };
    let overallOf = (team, owned) => ({ team, overall: M.fullSquadOverall(team.id, owned, catalog) });
    let current = activeTeams.map((team) => overallOf(team, ownership)).filter((item) => item.overall > 0);
    if (current.length < 2) return { allowed: true, enabled: true, maxDifference: settings.maxDifference };
    let next = { ...(ownership || {}) };
    playerIds.forEach((id) => { delete next[id]; });
    let future = activeTeams.map((team) => overallOf(team, next)).filter((item) => item.overall > 0);
    let gap = (list) => list.length ? Math.max(...list.map((i) => i.overall)) - Math.min(...list.map((i) => i.overall)) : 0;
    let currentGap = gap(current), futureGap = gap(future);
    let wasAboveLimit = currentGap > settings.maxDifference;
    let allowed = future.length < 2 || (wasAboveLimit && settings.recoveryMode ? futureGap <= currentGap + 1e-9 : futureGap <= settings.maxDifference + 1e-9);
    let own = (list) => (list.find((item) => String(item.team.id) === String(teamId)) || {}).overall || 0;
    return { allowed, enabled: true, maxDifference: settings.maxDifference, currentGap, futureGap, wasAboveLimit, recoveryMode: settings.recoveryMode, threshold: wasAboveLimit && settings.recoveryMode ? currentGap : settings.maxDifference, ownBefore: own(current), ownAfter: own(future) };
  }

  /**
   * ctx: {
   *   tournament, teamId, playerIds,
   *   ownership, transfers, teams, catalog (array), playerOf(id) -> player,
   *   marketOpen: bool, minGamesBlocked: bool, minGamesMessage: string,
   *   tradeLockFor(playerId) -> { locked, gamesRemaining }
   * }
   */
  function barcaPlan(ctx) {
    let M = Market();
    let { tournament, teamId, ownership = {}, transfers = [], teams = [], catalog = [] } = ctx;
    let ids = [...new Set((ctx.playerIds || []).map(String))];
    let blockers = [];
    let items = [];
    ids.forEach((id) => {
      let owned = ownership[id];
      let player = ctx.playerOf ? ctx.playerOf(id) : null;
      if (!owned || String(owned.teamId) !== String(teamId) || !player) {
        blockers.push(`${player ? player.name : "Um jogador selecionado"} não pertence mais ao seu elenco.`);
        return;
      }
      let rule = M.marketSaleDepreciation(tournament, id, teamId, ownership, transfers);
      let lock = ctx.tradeLockFor ? ctx.tradeLockFor(id) : null;
      items.push({ player, amount: saleAmount(player.value, rule.depreciationPct), depreciationPct: rule.depreciationPct, initialRoster: rule.initialRoster, locked: !!(lock && lock.locked), gamesRemaining: lock && lock.gamesRemaining || 0 });
    });
    let team = (Array.isArray(teams) ? teams : []).find((item) => item && String(item.id) === String(teamId));
    let budgetBefore = Number(team && team.budget) || 0;
    let total = items.reduce((sum, item) => sum + item.amount, 0);
    let rosterBefore = Object.values(ownership).filter((item) => item && String(item.teamId) === String(teamId)).length;
    let rosterAfter = rosterBefore - items.length;
    let minPlayers = minPlayersOf(tournament);
    let baseMin = M.baseRosterMinimumSettings(tournament).minBaseRosterPlayers;
    let baseBefore = Object.keys(ownership).filter((id) => M.isInitialRosterPlayer(id, teamId, ownership, transfers)).length;
    let baseSold = items.filter((item) => item.initialRoster).length;
    let baseAfter = baseBefore - baseSold;

    if (!ctx.marketOpen) blockers.push("O mercado está fechado pela administração.");
    if (ctx.minGamesBlocked) blockers.push(ctx.minGamesMessage || "Você ainda não atingiu o número mínimo de jogos para negociar no mercado.");
    items.filter((item) => item.locked).forEach((item) => blockers.push(`${item.player.name} ainda precisa de ${item.gamesRemaining} jogo${item.gamesRemaining === 1 ? "" : "s"} no seu time antes de ser vendido.`));
    if (items.length && rosterAfter < minPlayers) blockers.push(`O elenco ficaria com ${rosterAfter} jogadores e o mínimo é ${minPlayers}. Desmarque ${minPlayers - rosterAfter}.`);
    if (items.length && baseSold && baseMin > 0 && baseAfter < baseMin) blockers.push(`Você precisa manter pelo menos ${baseMin} jogadores do elenco-base (ficariam ${baseAfter}).`);
    let balance = items.length ? evaluateSaleBalance(tournament, teamId, items.map((item) => String(item.player.id)), teams, ownership, catalog) : { allowed: true, enabled: false };
    if (!balance.allowed) blockers.push(`Pela regra de equilíbrio, a venda aumentaria a diferença entre os times para ${balance.futureGap.toFixed(1)} OVR (máximo permitido agora: ${balance.threshold.toFixed(1)}).`);

    return { items, total, budgetBefore, budgetAfter: budgetBefore + total, rosterBefore, rosterAfter, minPlayers, baseMin, baseBefore, baseAfter, baseSold, balance, blockers, ok: items.length > 0 && blockers.length === 0 };
  }

  /**
   * Aplica a venda em lote sobre um torneio (estado do servidor).
   * Gera 1 transferência `market_sale` e 1 lançamento financeiro por jogador, igual à venda unitária,
   * para o histórico e o rollback continuarem funcionando por jogador.
   * deps: { financeEntry, newId, now }
   */
  function applyBarca(tournament, plan, teamId, deps) {
    let context = { ...(tournament.context || {}) };
    let ownership = { ...(context.ownership || {}) };
    let teamsList = Array.isArray(context.teams) ? context.teams : [];
    let team = teamsList.find((item) => String(item.id) === String(teamId));
    let running = Number(team && team.budget) || 0;
    let tradeOffers = { ...(context.tradeOffers || {}) };
    let transfers = Array.isArray(context.transfers) ? [...context.transfers] : [];
    let financialTransactions = Array.isArray(context.financialTransactions) ? [...context.financialTransactions] : [];
    let now = deps.now;
    plan.items.forEach((item, index) => {
      let player = item.player, at = now + index;
      delete ownership[player.id];
      Object.keys(tradeOffers).forEach((offerId) => {
        let offer = tradeOffers[offerId];
        if (offer && String(offer.playerId) === String(player.id) && ["pending", "countered"].includes(offer.status)) {
          tradeOffers[offerId] = { ...offer, status: "invalid", invalidReason: "sold_to_market", updatedAt: at };
        }
      });
      transfers.unshift({ id: deps.newId(), playerId: player.id, playerName: player.name, fromTeamId: teamId, toTeamId: null, price: item.amount, marketValue: player.value, depreciationPct: item.depreciationPct, type: "market_sale", date: new Date(at).toLocaleDateString("pt-BR"), createdAt: at, batch: true });
      financialTransactions.unshift(deps.financeEntry("market_sale", teamId, item.amount, `Venda de ${player.name} ao mercado`, player.id, running, at));
      running += item.amount;
    });
    let teams = teamsList.map((item) => String(item.id) === String(teamId) ? { ...item, budget: running } : item);
    return { ...tournament, context: { ...context, teams, ownership, tradeOffers, transfers, financialTransactions } };
  }

  window.ManchaApp.BarcaFeature = { barcaPlan, applyBarca, evaluateSaleBalance, saleAmount };
})();
