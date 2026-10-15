(() => {
  window.ManchaApp = window.ManchaApp || {};

  // Troca entre participantes: N jogadores por M jogadores, com troco em dinheiro entre os dois (soma zero) e uma taxa para o banco.
  // Funções puras: a UI usa para a prévia e a transação usa (sobre o estado do servidor) para validar e aplicar.
  // As propostas ficam em context.tradeProposals (mapa id -> proposta), sem tabela nova.
  function Market() { return window.ManchaApp.MarketFeature; }

  const DEFAULTS = { enabled: true, maxPlayersPerSide: 3, feePct: 5, expiryHours: 48 };
  function tradeSettingsOf(tournament) {
    const raw = tournament && tournament.tradeSettings && typeof tournament.tradeSettings === "object" ? tournament.tradeSettings : {};
    return {
      enabled: raw.enabled !== false,
      maxPlayersPerSide: Math.min(10, Math.max(1, Math.round(Number(raw.maxPlayersPerSide != null ? raw.maxPlayersPerSide : DEFAULTS.maxPlayersPerSide) || DEFAULTS.maxPlayersPerSide))),
      feePct: Math.min(50, Math.max(0, Number(raw.feePct != null ? raw.feePct : DEFAULTS.feePct) || 0)),
      expiryHours: Math.min(24 * 14, Math.max(1, Math.round(Number(raw.expiryHours != null ? raw.expiryHours : DEFAULTS.expiryHours) || DEFAULTS.expiryHours))),
    };
  }

  const ACTIVE = ["pending"];
  function isExpired(proposal, now) { return !!proposal && ACTIVE.includes(proposal.status) && Number(proposal.expiresAt) > 0 && Number(proposal.expiresAt) <= now; }
  // Estado exibido: pendente vencida vira "expired" sem precisar de um processo em segundo plano.
  function displayStatus(proposal, now = Date.now()) { return isExpired(proposal, now) ? "expired" : (proposal && proposal.status) || "pending"; }
  function isOpen(proposal, now = Date.now()) { return !!proposal && proposal.status === "pending" && !isExpired(proposal, now); }

  function sumValues(ids, playerOf) { return ids.reduce((sum, id) => { const player = playerOf(id); return sum + (player ? Number(player.value) || 0 : 0); }, 0); }
  // Dinheiro sugerido: quem recebe mais valor paga a diferença (positivo = quem propõe paga). Arredondado para inteiro.
  function suggestedCash(giveIds, getIds, playerOf) { return Math.round(sumValues(getIds, playerOf) - sumValues(giveIds, playerOf)); }
  function feeOf(valueGive, valueGet, feePct) {
    const total = Math.ceil(Math.max(valueGive, valueGet) * (Number(feePct) || 0) / 100);
    return { total, each: Math.ceil(total / 2) };
  }

  // Equilíbrio de overall entre os times depois da troca (mesma lógica da compra/venda: limite de diferença + modo recuperação).
  function evaluateTradeBalance(tournament, teams, before, after, catalog) {
    const M = Market(), settings = M.marketBalanceSettings(tournament);
    if (!settings.enabled) return { allowed: true, enabled: false };
    const active = (Array.isArray(teams) ? teams : []).filter((team) => team && team.active !== false);
    if (active.length < 2) return { allowed: true, enabled: true };
    const rows = (owned) => active.map((team) => ({ team, overall: M.fullSquadOverall(team.id, owned, catalog) })).filter((item) => item.overall > 0);
    const now = rows(before), next = rows(after);
    if (now.length < 2 || next.length < 2) return { allowed: true, enabled: true };
    const gap = (list) => Math.max(...list.map((i) => i.overall)) - Math.min(...list.map((i) => i.overall));
    const currentGap = gap(now), futureGap = gap(next), above = currentGap > settings.maxDifference;
    const allowed = above && settings.recoveryMode ? futureGap <= currentGap + 1e-9 : futureGap <= settings.maxDifference + 1e-9;
    return { allowed, enabled: true, currentGap, futureGap, threshold: above && settings.recoveryMode ? currentGap : settings.maxDifference };
  }

  /**
   * terms: { fromTeamId, toTeamId, give: [ids do time que propõe], get: [ids do time que recebe a proposta], cash (>0: quem propõe paga) }
   * ctx: { tournament, ownership, transfers, teams, catalog, playerOf(id), marketOpen, minGames(teamId)->{blocked,message}, tradeLockFor(playerId, ownerTeamId)->{locked,gamesRemaining} }
   */
  function tradePlan(terms, ctx) {
    const M = Market(), settings = tradeSettingsOf(ctx.tournament), ownership = ctx.ownership || {}, transfers = ctx.transfers || [];
    const teams = ctx.teams || [];
    const give = [...new Set((terms.give || []).map(String))], get = [...new Set((terms.get || []).map(String))];
    const fromId = String(terms.fromTeamId || ""), toId = String(terms.toTeamId || "");
    const cash = Math.round(Number(terms.cash) || 0);
    const blockers = [];
    const teamOf = (id) => teams.find((team) => team && String(team.id) === String(id));
    const from = teamOf(fromId), to = teamOf(toId);
    const nameOf = (id) => { const player = ctx.playerOf(id); return player ? player.name : "Jogador"; };

    if (!settings.enabled) blockers.push("As trocas estão desativadas neste campeonato.");
    if (!ctx.marketOpen) blockers.push("O mercado está fechado pela administração.");
    if (!from || !to || fromId === toId) blockers.push("Escolha outro participante para negociar.");
    if (!give.length || !get.length) blockers.push("Escolha pelo menos um jogador de cada lado.");
    if (give.length > settings.maxPlayersPerSide || get.length > settings.maxPlayersPerSide) blockers.push(`O limite é de ${settings.maxPlayersPerSide} jogador${settings.maxPlayersPerSide === 1 ? "" : "es"} de cada lado.`);

    const owns = (id, teamId) => ownership[id] && String(ownership[id].teamId) === String(teamId) && !!ctx.playerOf(id);
    give.forEach((id) => { if (!owns(id, fromId)) blockers.push(`${nameOf(id)} não pertence mais a quem propôs.`); });
    get.forEach((id) => { if (!owns(id, toId)) blockers.push(`${nameOf(id)} não pertence mais a quem recebe a proposta.`); });

    [[fromId, "você"], [toId, "o outro time"]].forEach(([teamId]) => {
      const status = ctx.minGames ? ctx.minGames(teamId) : null;
      if (status && status.blocked) blockers.push(status.message || "Um dos times ainda não atingiu o mínimo de jogos para negociar.");
    });
    const lockMsg = (id, ownerId) => { const lock = ctx.tradeLockFor ? ctx.tradeLockFor(id, ownerId) : null; if (lock && lock.locked) blockers.push(`${nameOf(id)} ainda precisa de ${lock.gamesRemaining} jogo${lock.gamesRemaining === 1 ? "" : "s"} no time antes de ser negociado.`); };
    give.forEach((id) => lockMsg(id, fromId));
    get.forEach((id) => lockMsg(id, toId));

    const valueGive = sumValues(give, ctx.playerOf), valueGet = sumValues(get, ctx.playerOf);
    const fee = feeOf(valueGive, valueGet, settings.feePct);
    const budget = (team) => Number(team && team.budget) || 0;
    const fromAfter = budget(from) - cash - fee.each, toAfter = budget(to) + cash - fee.each;
    if (from && fromAfter < 0) blockers.push(`${from.name || "Quem propõe"} ficaria com saldo negativo (${Math.round(fromAfter)}M).`);
    if (to && toAfter < 0) blockers.push(`${to.name || "O outro time"} ficaria com saldo negativo (${Math.round(toAfter)}M).`);

    // elenco
    const minPlayers = Math.max(0, Number(ctx.tournament && ctx.tournament.rosterSettings && ctx.tournament.rosterSettings.minPlayers != null ? ctx.tournament.rosterSettings.minPlayers : 23) || 0);
    const maxPlayers = Math.max(minPlayers, Number(ctx.tournament && ctx.tournament.rosterSettings && ctx.tournament.rosterSettings.maxPlayers != null ? ctx.tournament.rosterSettings.maxPlayers : 30) || 30);
    const size = (teamId) => Object.values(ownership).filter((item) => item && String(item.teamId) === String(teamId)).length;
    const fromSize = size(fromId), toSize = size(toId);
    const fromSizeAfter = fromSize - give.length + get.length, toSizeAfter = toSize - get.length + give.length;
    [[from, fromSizeAfter], [to, toSizeAfter]].forEach(([team, after]) => {
      if (!team) return;
      if (after > maxPlayers) blockers.push(`${team.name || "Um time"} ficaria com ${after} jogadores e o máximo é ${maxPlayers}.`);
      if (after < minPlayers) blockers.push(`${team.name || "Um time"} ficaria com ${after} jogadores e o mínimo é ${minPlayers}.`);
    });

    // elenco-base mínimo (só conta quem entrega jogadores do elenco-base)
    const baseMin = M.baseRosterMinimumSettings(ctx.tournament).minBaseRosterPlayers;
    const baseCheck = (teamId, ids, team) => {
      if (baseMin <= 0) return;
      const before = Object.keys(ownership).filter((id) => M.isInitialRosterPlayer(id, teamId, ownership, transfers)).length;
      const given = ids.filter((id) => M.isInitialRosterPlayer(id, teamId, ownership, transfers)).length;
      if (given && before - given < baseMin) blockers.push(`${(team && team.name) || "Um time"} precisa manter pelo menos ${baseMin} jogadores do elenco-base.`);
    };
    baseCheck(fromId, give, from); baseCheck(toId, get, to);

    // equilíbrio de overall
    const after = { ...ownership };
    give.forEach((id) => { if (after[id]) after[id] = { ...after[id], teamId: toId }; });
    get.forEach((id) => { if (after[id]) after[id] = { ...after[id], teamId: fromId }; });
    const balance = evaluateTradeBalance(ctx.tournament, teams, ownership, after, ctx.catalog || []);
    if (!balance.allowed) blockers.push(`Pela regra de equilíbrio, a troca aumentaria a diferença entre os times para ${balance.futureGap.toFixed(1)} OVR (máximo agora: ${balance.threshold.toFixed(1)}).`);

    const suggested = Math.round(valueGet - valueGive);
    return {
      ok: blockers.length === 0, blockers, settings, give, get, cash, suggestedCash: suggested,
      valueGive, valueGet, diff: valueGet - valueGive, fee,
      budgets: { from: { before: budget(from), after: fromAfter }, to: { before: budget(to), after: toAfter } },
      rosters: { from: { before: fromSize, after: fromSizeAfter }, to: { before: toSize, after: toSizeAfter }, min: minPlayers, max: maxPlayers },
      balance,
    };
  }

  // ---- ciclo de vida da proposta ----
  function newProposal(terms, settings, deps, extra = {}) {
    const now = deps.now;
    return {
      id: deps.newId(), kind: "swap", status: "pending",
      fromTeamId: String(terms.fromTeamId), toTeamId: String(terms.toTeamId),
      fromProfileId: terms.fromProfileId || null, toProfileId: terms.toProfileId || null,
      give: [...new Set((terms.give || []).map(String))], get: [...new Set((terms.get || []).map(String))], cash: Math.round(Number(terms.cash) || 0),
      feePct: settings.feePct, createdAt: now, updatedAt: now, expiresAt: now + settings.expiryHours * 3600000,
      ...extra,
    };
  }

  // Mantém no máximo `keep` propostas encerradas (as mais recentes) para o mapa não crescer sem limite.
  function pruneProposals(map, keep = 60) {
    const entries = Object.entries(map || {});
    const closed = entries.filter(([, item]) => item && item.status !== "pending").sort((a, b) => (Number(b[1].updatedAt) || 0) - (Number(a[1].updatedAt) || 0));
    const drop = new Set(closed.slice(keep).map(([id]) => id));
    return Object.fromEntries(entries.filter(([id]) => !drop.has(id)));
  }

  /** Cria a proposta (e, se for contraproposta, encerra a original). Retorna o torneio novo ou null. */
  function applyPropose(tournament, proposal, counterOfId) {
    const context = { ...(tournament.context || {}) };
    const map = { ...(context.tradeProposals || {}) };
    if (counterOfId && map[counterOfId]) map[counterOfId] = { ...map[counterOfId], status: "countered", updatedAt: proposal.createdAt, counteredBy: proposal.id };
    map[proposal.id] = proposal;
    context.tradeProposals = pruneProposals(map);
    return { ...tournament, context };
  }
  function applyClose(tournament, proposalId, status, now, extra = {}) {
    const context = { ...(tournament.context || {}) };
    const map = { ...(context.tradeProposals || {}) };
    if (!map[proposalId]) return null;
    map[proposalId] = { ...map[proposalId], status, updatedAt: now, ...extra };
    context.tradeProposals = map;
    return { ...tournament, context };
  }

  /**
   * Aplica a troca aceita: posse dos jogadores, troco, taxa, transferências (1 por jogador), lançamentos financeiros,
   * e invalida ofertas/propostas abertas que envolvam algum dos jogadores. deps: { financeEntry, newId, now }
   */
  function applyTrade(tournament, proposal, plan, deps) {
    const context = { ...(tournament.context || {}) };
    const ownership = { ...(context.ownership || {}) };
    const now = deps.now, fromId = proposal.fromTeamId, toId = proposal.toTeamId;
    const moved = new Set([...plan.give, ...plan.get]);
    const teamsList = Array.isArray(context.teams) ? context.teams : [];
    const budgetOf = (id) => Number((teamsList.find((team) => String(team.id) === String(id)) || {}).budget) || 0;
    plan.give.forEach((id) => { ownership[id] = { ...(ownership[id] || {}), teamId: toId, forSale: false, price: null, acquisitionSource: "user_transfer", acquiredAt: now }; });
    plan.get.forEach((id) => { ownership[id] = { ...(ownership[id] || {}), teamId: fromId, forSale: false, price: null, acquisitionSource: "user_transfer", acquiredAt: now }; });

    const transfers = Array.isArray(context.transfers) ? [...context.transfers] : [];
    const push = (id, fromTeam, toTeam) => {
      const player = deps.playerOf(id);
      transfers.unshift({ id: deps.newId(), championshipId: tournament.id, playerId: id, playerName: player ? player.name : id, fromTeamId: fromTeam, toTeamId: toTeam, price: 0, marketValue: player ? player.value : 0, type: "user_transfer", tradeId: proposal.id, createdAt: now, date: new Date(now).toLocaleDateString("pt-BR") });
    };
    plan.give.forEach((id) => push(id, fromId, toId));
    plan.get.forEach((id) => push(id, toId, fromId));

    const finance = Array.isArray(context.financialTransactions) ? [...context.financialTransactions] : [];
    let fromBalance = budgetOf(fromId), toBalance = budgetOf(toId);
    const names = (ids) => ids.map((id) => { const player = deps.playerOf(id); return player ? player.name : id; }).join(", ");
    if (plan.cash !== 0) {
      finance.unshift(deps.financeEntry("trade_cash", fromId, -plan.cash, `Troco da troca (${names(plan.give)} por ${names(plan.get)})`, proposal.id, fromBalance, now));
      finance.unshift(deps.financeEntry("trade_cash", toId, plan.cash, `Troco da troca (${names(plan.get)} por ${names(plan.give)})`, proposal.id, toBalance, now));
      fromBalance -= plan.cash; toBalance += plan.cash;
    }
    if (plan.fee.each > 0) {
      finance.unshift(deps.financeEntry("trade_fee", fromId, -plan.fee.each, "Taxa de troca", proposal.id, fromBalance, now));
      finance.unshift(deps.financeEntry("trade_fee", toId, -plan.fee.each, "Taxa de troca", proposal.id, toBalance, now));
      fromBalance -= plan.fee.each; toBalance -= plan.fee.each;
    }
    const teams = teamsList.map((team) => String(team.id) === String(fromId) ? { ...team, budget: fromBalance } : String(team.id) === String(toId) ? { ...team, budget: toBalance } : team);

    const offers = { ...(context.tradeOffers || {}) };
    Object.keys(offers).forEach((id) => {
      const offer = offers[id];
      if (offer && moved.has(String(offer.playerId)) && ["pending", "countered"].includes(offer.status)) offers[id] = { ...offer, status: "invalid", invalidReason: "player_traded", updatedAt: now };
    });
    const proposals = { ...(context.tradeProposals || {}) };
    Object.keys(proposals).forEach((id) => {
      const item = proposals[id];
      if (!item || id === proposal.id || item.status !== "pending") return;
      if ([...(item.give || []), ...(item.get || [])].some((pid) => moved.has(String(pid)))) proposals[id] = { ...item, status: "invalid", invalidReason: "player_traded", updatedAt: now };
    });
    proposals[proposal.id] = { ...proposal, status: "accepted", acceptedAt: now, updatedAt: now, settled: { cash: plan.cash, feeEach: plan.fee.each, valueGive: plan.valueGive, valueGet: plan.valueGet } };
    return { ...tournament, context: { ...context, teams, ownership, tradeOffers: offers, transfers, financialTransactions: finance, tradeProposals: pruneProposals(proposals) } };
  }

  /**
   * Estorno (admin) de uma troca aceita: devolve os jogadores, o troco e a taxa. Falha (error) se algum jogador já saiu do time
   * que o recebeu, ou se alguém ficaria com saldo negativo. Usa o que foi liquidado na proposta (settled), sem depender do histórico financeiro.
   */
  function applyRevertTrade(tournament, tradeId, deps) {
    const context = { ...(tournament.context || {}) };
    const proposal = (context.tradeProposals || {})[tradeId];
    if (!proposal || proposal.status !== "accepted" || !proposal.settled) return { error: "Esta troca não pode ser estornada (não foi encontrada ou já foi revertida)." };
    const ownership = { ...(context.ownership || {}) };
    const now = deps.now, fromId = proposal.fromTeamId, toId = proposal.toTeamId;
    for (const id of proposal.give) if (!ownership[id] || String(ownership[id].teamId) !== String(toId)) return { error: "Um dos jogadores já saiu do time que o recebeu. Estorne essas movimentações primeiro." };
    for (const id of proposal.get) if (!ownership[id] || String(ownership[id].teamId) !== String(fromId)) return { error: "Um dos jogadores já saiu do time que o recebeu. Estorne essas movimentações primeiro." };
    const { cash, feeEach } = proposal.settled;
    const teamsList = Array.isArray(context.teams) ? context.teams : [];
    const budgetOf = (id) => Number((teamsList.find((team) => String(team.id) === String(id)) || {}).budget) || 0;
    const fromBalance = budgetOf(fromId) + cash + feeEach, toBalance = budgetOf(toId) - cash + feeEach;
    if (toBalance < 0) return { error: "O estorno deixaria um time com saldo negativo." };
    proposal.give.forEach((id) => { ownership[id] = { ...ownership[id], teamId: fromId, forSale: false, price: null, acquisitionSource: "rollback", acquiredAt: now }; });
    proposal.get.forEach((id) => { ownership[id] = { ...ownership[id], teamId: toId, forSale: false, price: null, acquisitionSource: "rollback", acquiredAt: now }; });
    const transfers = (Array.isArray(context.transfers) ? context.transfers : []).map((item) => item && item.tradeId === tradeId && !item.rolledBackAt ? { ...item, rolledBackAt: now } : item);
    const finance = Array.isArray(context.financialTransactions) ? [...context.financialTransactions] : [];
    finance.unshift(deps.financeEntry("trade_rollback", fromId, cash + feeEach, "Estorno de troca", tradeId, budgetOf(fromId), now));
    finance.unshift(deps.financeEntry("trade_rollback", toId, -cash + feeEach, "Estorno de troca", tradeId, budgetOf(toId), now));
    const teams = teamsList.map((team) => String(team.id) === String(fromId) ? { ...team, budget: fromBalance } : String(team.id) === String(toId) ? { ...team, budget: toBalance } : team);
    const proposals = { ...(context.tradeProposals || {}), [tradeId]: { ...proposal, status: "reverted", revertedAt: now, updatedAt: now } };
    return { tournament: { ...tournament, context: { ...context, teams, ownership, transfers, financialTransactions: finance, tradeProposals: proposals } } };
  }

  window.ManchaApp.TradeFeature = { tradeSettingsOf, tradePlan, suggestedCash, feeOf, newProposal, applyPropose, applyClose, applyTrade, applyRevertTrade, displayStatus, isOpen, isExpired, pruneProposals, evaluateTradeBalance, DEFAULTS };
})();
