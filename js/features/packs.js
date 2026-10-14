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
    OVERALL_BANDS, percentWeights, poolStats, analyzeWeights, distributeBands, presetWeights,
  };
})();
