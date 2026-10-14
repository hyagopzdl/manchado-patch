(() => {
  window.ManchaApp = window.ManchaApp || {};
  const DEFAULT_CATALOG_ID = "default";
  const FALLBACK_REGISTRY = [{ id: DEFAULT_CATALOG_ID, label: "Base atual", file: "players.json" }];

  function isPacksMode(tournament) {
    return !!tournament && tournament.mode === "packs";
  }
  function catalogIdOf(tournament) {
    const id = tournament && tournament.catalogId;
    return typeof id === "string" && id ? id : DEFAULT_CATALOG_ID;
  }
  // Overrides são globais por player_id: só valem no catálogo "default" (o servidor aplica a mesma regra).
  function overridesAllowed(tournament) {
    const flag = tournament && tournament.marketSettings && tournament.marketSettings.playerOverridesEnabled;
    return catalogIdOf(tournament) === DEFAULT_CATALOG_ID && flag !== false;
  }

  function gaussianWeights(mu, sigma, tail) {
    const weights = {};
    for (let overall = 65; overall <= 97; overall++) {
      const g = Math.exp(-0.5 * Math.pow((overall - mu) / sigma, 2));
      const t = (tail || 0) * Math.exp((overall - 97) / 3);
      weights[String(overall)] = Number((g + t).toFixed(6));
    }
    return weights;
  }

  // Valores iniciais de partida (vieram do simulador em tools/pack-simulator.html).
  // São PLACEHOLDERS: o painel admin da fase 4 é onde preços, pesos e marcos devem ser calibrados.
  const PACK_PRESETS = [
    { id: "bronze", label: "Bronze", price: 40, cards: 3, mu: 72, sigma: 3, tail: 0, unlock: null },
    { id: "prata", label: "Prata", price: 100, cards: 3, mu: 76, sigma: 3.5, tail: 0.002, unlock: { packId: "bronze", count: 50 } },
    { id: "ouro", label: "Ouro", price: 210, cards: 3, mu: 80, sigma: 4, tail: 0.01, unlock: { packId: "prata", count: 40 } },
    { id: "platina", label: "Platina", price: 370, cards: 3, mu: 84, sigma: 4, tail: 0.03, unlock: { packId: "ouro", count: 30 } },
    { id: "diamante", label: "Diamante", price: 580, cards: 3, mu: 88, sigma: 4, tail: 0.08, unlock: { packId: "platina", count: 20 } },
  ];

  function defaultPackSettings() {
    return {
      version: 1,
      isOpen: true,
      // Marcos de desbloqueio desligados por enquanto (fase de testes): todos os pacotes ficam liberados.
      unlocksEnabled: false,
      sellDepreciationPct: 25,
      eliteThreshold: 90,
      suspense: true,
      cardsPerPack: 3,
      packs: PACK_PRESETS.map((preset) => ({
        id: preset.id, label: preset.label, enabled: true, price: preset.price, cards: preset.cards, interaction: "all",
        weights: gaussianWeights(preset.mu, preset.sigma, preset.tail),
        unlock: preset.unlock ? { ...preset.unlock } : null,
      })),
    };
  }

  function cardsPerPackOf(raw) {
    const explicit = Math.round(Number(raw && raw.cardsPerPack));
    if (explicit >= 1) return Math.min(10, explicit);
    const first = Array.isArray(raw && raw.packs) ? raw.packs.find((pack) => pack && Number(pack.cards) >= 1) : null;
    return first ? Math.min(10, Math.round(Number(first.cards))) : 3;
  }

  function packSettingsOf(tournament) {
    const raw = tournament && tournament.packSettings && typeof tournament.packSettings === "object" ? tournament.packSettings : null;
    const fallback = defaultPackSettings();
    if (!raw) return { ...fallback, rosterMax: Math.max(1, Math.round(Number(tournament && tournament.rosterSettings && tournament.rosterSettings.maxPlayers) || 30)) };
    return {
      version: 1,
      isOpen: raw.isOpen !== false,
      unlocksEnabled: raw.unlocksEnabled === true,
      // Revelação em etapas (posição → nacionalidade → clube → nome e overall). Ligada por padrão.
      suspense: raw.suspense !== false,
      // Quantidade de cartas global (vale para todos os pacotes). Sem ela, usa a do primeiro pacote.
      cardsPerPack: cardsPerPackOf(raw),
      sellDepreciationPct: Math.min(100, Math.max(0, Number(raw.sellDepreciationPct != null ? raw.sellDepreciationPct : fallback.sellDepreciationPct) || 0)),
      // O limite máximo do elenco é o do campeonato (rosterSettings, editado pelo admin).
      // packSettings.rosterMax só é usado como legado, se o torneio não tiver rosterSettings.
      rosterMax: Math.max(1, Math.round(Number(tournament && tournament.rosterSettings && tournament.rosterSettings.maxPlayers) || Number(raw.rosterMax) || 30)),
      eliteThreshold: Math.min(99, Math.max(1, Math.round(Number(raw.eliteThreshold != null ? raw.eliteThreshold : fallback.eliteThreshold) || fallback.eliteThreshold))),
      packs: (Array.isArray(raw.packs) ? raw.packs : fallback.packs).filter((pack) => pack && pack.id).map((pack) => ({
        id: String(pack.id),
        label: String(pack.label || pack.id),
        enabled: pack.enabled !== false,
        price: Math.max(0, Number(pack.price) || 0),
        cards: cardsPerPackOf(raw) || Math.min(10, Math.max(1, Math.round(Number(pack.cards) || 3))),
        // "all": todas as cartas ficam com o time. "pick": o usuário escolhe 1 das N cartas (às cegas); as outras são só reveladas.
        interaction: pack.interaction === "pick" ? "pick" : "all",
        weights: pack.weights && typeof pack.weights === "object" ? pack.weights : {},
        unlock: pack.unlock && typeof pack.unlock === "object" && pack.unlock.packId ? { packId: String(pack.unlock.packId), count: Math.max(0, Math.round(Number(pack.unlock.count) || 0)) } : null,
      })),
    };
  }

  // Depreciação ao vender ao mercado uma carta que veio de pacote.
  function packSellDepreciationPct(tournament) {
    return packSettingsOf(tournament).sellDepreciationPct;
  }

  // ---- Editor de chances (porcentagens por overall) ----
  // Faixas exibidas no editor. A última vai até 99.
  const OVERALL_BANDS = [[65, 69], [70, 74], [75, 79], [80, 84], [85, 89], [90, 99]];

  // Normaliza pesos quaisquer para porcentagens que somam 100. Pesos <= 0 saem.
  function percentWeights(weights) {
    const entries = Object.entries(weights || {}).map(([overall, weight]) => [String(overall), Math.max(0, Number(weight) || 0)]).filter(([, weight]) => weight > 0);
    const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
    const result = {};
    if (total > 0) entries.forEach(([overall, weight]) => { result[overall] = (weight / total) * 100; });
    return result;
  }

  // Jogadores livres por overall (o que o servidor sorteia): Map overall -> { n, sumValue, total }.
  function poolStats(players, ownership) {
    const map = new Map();
    (Array.isArray(players) ? players : []).forEach((player) => {
      const overall = Number(player && player.overall) || 0;
      if (!overall) return;
      const entry = map.get(overall) || { n: 0, sumValue: 0, total: 0 };
      entry.total += 1;
      const owner = ownership && ownership[String(player.id)];
      if (!(owner && owner.teamId)) { entry.n += 1; entry.sumValue += Number(player.value) || 0; }
      map.set(overall, entry);
    });
    return map;
  }

  // Resumo de um pacote: mesma regra do servidor (renormaliza entre overalls com jogador livre).
  function analyzeWeights({ weights, pool, cards, price, sellPct, elite }) {
    const entries = Object.entries(weights || {}).map(([o, w]) => [Number(o), Math.max(0, Number(w) || 0)]).filter(([, w]) => w > 0);
    const configured = entries.reduce((sum, [, w]) => sum + w, 0);
    const available = entries.filter(([o]) => pool.get(o) && pool.get(o).n > 0);
    const total = available.reduce((sum, [, w]) => sum + w, 0);
    const result = { configured, unavailableShare: configured > 0 ? (configured - total) / configured : 0, effective: {}, meanOverall: 0, evPerCard: 0, evPack: 0, pEliteCard: 0, pEliteAtLeastOne: 0, sellEv: 0, net: 0, valid: total > 0 };
    if (!(total > 0)) return result;
    available.forEach(([o, w]) => {
      const p = w / total, stat = pool.get(o);
      result.effective[o] = p * 100;
      result.meanOverall += p * o;
      result.evPerCard += p * (stat.sumValue / stat.n);
      if (o >= elite) result.pEliteCard += p;
    });
    const count = Math.max(1, Number(cards) || 1);
    result.evPack = result.evPerCard * count;
    result.pEliteAtLeastOne = 1 - Math.pow(1 - result.pEliteCard, count);
    result.sellEv = result.evPack * (1 - (Number(sellPct) || 0) / 100);
    result.net = (Number(price) || 0) - result.sellEv;
    return result;
  }

  // ---- Consultor de preços ----
  // Preço recomendado = o que volta ao vender tudo de volta, com uma margem de "ralo" (parte do preço que nunca volta).
  // Assim o custo líquido fica positivo (sem dinheiro infinito). Os preços são arredondados para cima de 5 em 5 e
  // sempre crescem de um pacote para o próximo.
  function recommendPackPrices({ packs, pool, sellPct, marginPct, elite }) {
    const margin = Math.min(0.9, Math.max(0, (Number(marginPct) || 0) / 100));
    let previous = 0;
    return (packs || []).map((pack) => {
      const analysis = analyzeWeights({ weights: pack.weights, pool, cards: pack.interaction === "pick" ? 1 : pack.cards, price: pack.price, sellPct, elite });
      if (!(analysis.evPack > 0)) return { id: pack.id, valid: false };
      let recommended = Math.ceil(analysis.sellEv / (1 - margin) / 5) * 5;
      if (recommended <= previous) recommended = previous + 5;
      previous = recommended;
      return { id: pack.id, valid: true, evPack: analysis.evPack, sellEv: analysis.sellEv, net: analysis.net, recommended };
    });
  }

  // Renda média de um time por jogo. Com jogos já disputados, usa o que foi realmente pago (economyRewards gravado ou recalculado
  // pelas regras atuais); sem jogos suficientes, estima com um campeonato "neutro": 37,5% vitórias, 37,5% derrotas, 25% empates
  // (80% com gols), 1,3 gol por time e 0,03 cartão vermelho por time por jogo.
  function estimateIncomePerGame({ economy, matches, matchEconomy, minGames = 6 }) {
    const played = (Array.isArray(matches) ? matches : []).filter((match) => match && match.played === true && !match.bye && match.homeId && match.awayId);
    if (played.length >= minGames && typeof matchEconomy === "function") {
      let total = 0, count = 0;
      played.forEach((match) => {
        [match.homeId, match.awayId].forEach((teamId) => {
          const stored = match.economyRewards && match.economyRewards[teamId];
          total += stored != null && Number.isFinite(Number(stored)) ? Number(stored) : matchEconomy(match, teamId, economy).total;
          count += 1;
        });
      });
      return { value: count ? total / count : 0, source: "real", games: played.length };
    }
    const win = 0.375, loss = 0.375, draw = 0.25;
    const result = win * economy.winReward + loss * economy.lossReward + draw * (0.8 * economy.scoringDrawReward + 0.2 * economy.scorelessDrawReward);
    const value = Math.max(0, result + 1.3 * economy.goalReward - 0.03 * economy.redCardPenalty);
    return { value, source: "estimate", games: played.length };
  }

  // Distribui a porcentagem de cada faixa entre os overalls dela.
  // mode "overall": mesma chance para cada overall com jogador livre; "player": proporcional ao nº de jogadores livres.
  function distributeBands(bandPercents, pool, mode) {
    const weights = {};
    OVERALL_BANDS.forEach(([low, high], index) => {
      const pct = Math.max(0, Number(bandPercents[index]) || 0);
      if (!(pct > 0)) return;
      const overalls = [];
      for (let o = low; o <= high; o++) if (pool.get(o) && pool.get(o).n > 0) overalls.push(o);
      if (!overalls.length) return;
      const shares = mode === "player" ? overalls.map((o) => pool.get(o).n) : overalls.map(() => 1);
      const sum = shares.reduce((a, b) => a + b, 0);
      overalls.forEach((o, i) => { weights[String(o)] = (pct * shares[i]) / sum; });
    });
    return weights;
  }

  // Tabela "Opção B" (chances em % por overall; cada pacote soma 100). Só é aplicada no rascunho do editor, quando o admin pede.
  const OPTION_B_WEIGHTS = {
  "bronze": {
   "75": 5,
   "76": 7.5,
   "77": 15,
   "78": 20,
   "79": 20,
   "80": 15,
   "81": 7.5,
   "82": 5,
   "83": 2.5,
   "84": 1,
   "85": 0.7,
   "86": 0.4,
   "87": 0.2,
   "88": 0.1,
   "89": 0.05,
   "90": 0.025,
   "91": 0.01,
   "92": 0.0075,
   "93": 0.005,
   "94": 0.0025
  },
  "prata": {
   "75": 1,
   "76": 3,
   "77": 6,
   "78": 10,
   "79": 15,
   "80": 10,
   "81": 20,
   "82": 15,
   "83": 10,
   "84": 5,
   "85": 2.5,
   "86": 1,
   "87": 0.7,
   "88": 0.4,
   "89": 0.2,
   "90": 0.1,
   "91": 0.05,
   "92": 0.025,
   "93": 0.01,
   "94": 0.0075,
   "95": 0.005,
   "96": 0.0025
  },
  "ouro": {
   "75": 0.25,
   "76": 0.5,
   "77": 0.75,
   "78": 1,
   "79": 2,
   "80": 4,
   "81": 8,
   "82": 15,
   "83": 20,
   "84": 18,
   "85": 14,
   "86": 7,
   "87": 5,
   "88": 2.5,
   "89": 1,
   "90": 0.5,
   "91": 0.25,
   "92": 0.09,
   "93": 0.06,
   "94": 0.04,
   "95": 0.03,
   "96": 0.02,
   "97": 0.01
  },
  "platina": {
   "75": 0.1,
   "76": 0.2,
   "77": 0.5,
   "78": 0.7,
   "79": 1,
   "80": 2,
   "81": 4,
   "82": 7.5,
   "83": 12.5,
   "84": 20,
   "85": 12.5,
   "86": 12.5,
   "87": 9,
   "88": 5,
   "89": 4,
   "90": 3,
   "91": 2.5,
   "92": 1,
   "93": 0.75,
   "94": 0.5,
   "95": 0.25,
   "96": 0.25,
   "97": 0.25
  },
  "diamante": {
   "77": 0.1,
   "78": 0.2,
   "79": 0.5,
   "80": 0.7,
   "81": 1,
   "82": 2.5,
   "83": 4,
   "84": 7,
   "85": 10,
   "86": 15,
   "87": 20,
   "88": 15,
   "89": 7,
   "90": 5,
   "91": 4,
   "92": 3,
   "93": 2,
   "94": 1,
   "95": 1,
   "96": 0.5,
   "97": 0.5
  }
};
  function optionBWeights(packId) { return OPTION_B_WEIGHTS[packId] || null; }

  function presetWeights(packId) {
    const preset = PACK_PRESETS.find((item) => item.id === packId);
    return preset ? percentWeights(gaussianWeights(preset.mu, preset.sigma, preset.tail)) : {};
  }

  // ---- Catálogos (bases de jogadores) ----
  let registryPromise = null;
  const catalogCache = new Map();

  function loadRegistry() {
    if (!registryPromise) {
      registryPromise = fetch("./catalogs.json")
        .then((response) => (response.ok ? response.json() : FALLBACK_REGISTRY))
        .then((list) => {
          const valid = (Array.isArray(list) ? list : []).filter((item) => item && item.id && item.file);
          return valid.some((item) => item.id === DEFAULT_CATALOG_ID) ? valid : [...FALLBACK_REGISTRY, ...valid];
        })
        .catch(() => FALLBACK_REGISTRY);
    }
    return registryPromise;
  }

  async function sha256Hex(buffer) {
    try {
      if (!window.crypto || !window.crypto.subtle) return null;
      const digest = await window.crypto.subtle.digest("SHA-256", buffer);
      return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
    } catch (error) {
      return null;
    }
  }

  // Carrega (com cache) o catálogo pelo id. Retorna { players, checksum }.
  function loadCatalog(catalogId) {
    const id = catalogId || DEFAULT_CATALOG_ID;
    if (!catalogCache.has(id)) {
      const promise = loadRegistry().then(async (registry) => {
        const entry = registry.find((item) => item.id === id);
        if (!entry) throw new Error(`catalog_not_registered:${id}`);
        const response = await fetch(`./${entry.file}`);
        if (!response.ok) throw new Error(`catalog_fetch_failed:${id}`);
        const buffer = await response.arrayBuffer();
        const players = JSON.parse(new TextDecoder("utf-8").decode(buffer));
        return { players: Array.isArray(players) ? players : [], checksum: await sha256Hex(buffer) };
      });
      promise.catch(() => catalogCache.delete(id));
      catalogCache.set(id, promise);
    }
    return catalogCache.get(id);
  }

  window.ManchaApp.PacksFeature = {
    DEFAULT_CATALOG_ID, isPacksMode, catalogIdOf, overridesAllowed, gaussianWeights,
    defaultPackSettings, packSettingsOf, packSellDepreciationPct, loadRegistry, loadCatalog,
    OVERALL_BANDS, percentWeights, poolStats, analyzeWeights, distributeBands, presetWeights, optionBWeights, recommendPackPrices, estimateIncomePerGame,
  };
})();
