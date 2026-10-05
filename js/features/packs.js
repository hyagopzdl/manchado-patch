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
      sellDepreciationPct: 25,
      rosterMax: 30,
      eliteThreshold: 90,
      packs: PACK_PRESETS.map((preset) => ({
        id: preset.id, label: preset.label, enabled: true, price: preset.price, cards: preset.cards,
        weights: gaussianWeights(preset.mu, preset.sigma, preset.tail),
        unlock: preset.unlock ? { ...preset.unlock } : null,
      })),
    };
  }

  function packSettingsOf(tournament) {
    const raw = tournament && tournament.packSettings && typeof tournament.packSettings === "object" ? tournament.packSettings : null;
    if (!raw) return defaultPackSettings();
    const fallback = defaultPackSettings();
    return {
      version: 1,
      isOpen: raw.isOpen !== false,
      sellDepreciationPct: Math.min(100, Math.max(0, Number(raw.sellDepreciationPct != null ? raw.sellDepreciationPct : fallback.sellDepreciationPct) || 0)),
      rosterMax: Math.max(1, Math.round(Number(raw.rosterMax != null ? raw.rosterMax : fallback.rosterMax) || fallback.rosterMax)),
      eliteThreshold: Math.min(99, Math.max(1, Math.round(Number(raw.eliteThreshold != null ? raw.eliteThreshold : fallback.eliteThreshold) || fallback.eliteThreshold))),
      packs: (Array.isArray(raw.packs) ? raw.packs : fallback.packs).filter((pack) => pack && pack.id).map((pack) => ({
        id: String(pack.id),
        label: String(pack.label || pack.id),
        enabled: pack.enabled !== false,
        price: Math.max(0, Number(pack.price) || 0),
        cards: Math.min(10, Math.max(1, Math.round(Number(pack.cards) || 3))),
        weights: pack.weights && typeof pack.weights === "object" ? pack.weights : {},
        unlock: pack.unlock && typeof pack.unlock === "object" && pack.unlock.packId ? { packId: String(pack.unlock.packId), count: Math.max(0, Math.round(Number(pack.unlock.count) || 0)) } : null,
      })),
    };
  }

  // Depreciação ao vender ao mercado uma carta que veio de pacote.
  function packSellDepreciationPct(tournament) {
    return packSettingsOf(tournament).sellDepreciationPct;
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
  };
})();
