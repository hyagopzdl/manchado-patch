// Núcleo do simulador de pacotes. Funciona no navegador (window.PackSim) e no Node (module.exports).
// Não é carregado pelo app. Serve para calibrar preços e pesos antes de implementar a feature.
(function (root) {
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Aplica overrides como o app faz (overall/value), quando habilitados.
  function effectiveCatalog(players, overrides, overridesEnabled) {
    return players.map((p) => {
      const o = overridesEnabled && overrides ? overrides[p.id] : null;
      if (!o) return p;
      return { ...p, overall: o.overall != null ? Number(o.overall) : p.overall, value: o.value != null ? Number(o.value) : p.value };
    });
  }

  function groupByOverall(players) {
    const map = new Map();
    players.forEach((p) => {
      const k = Number(p.overall);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(p);
    });
    return map;
  }

  // Gera pesos por overall (gaussiana + cauda) como ponto de partida editável.
  function generateWeights(mu, sigma, tail, minO = 65, maxO = 97) {
    const w = {};
    for (let o = minO; o <= maxO; o++) {
      const g = Math.exp(-0.5 * Math.pow((o - mu) / sigma, 2));
      const t = (tail || 0) * Math.exp((o - maxO) / 3);
      w[o] = +(g + t).toFixed(6);
    }
    return w;
  }

  // Probabilidades por overall, considerando só overalls com jogador livre (renormaliza).
  function normalizedProbs(weights, availableByOverall) {
    let total = 0;
    const entries = [];
    Object.keys(weights).forEach((k) => {
      const o = Number(k), wt = Number(weights[k]) || 0;
      if (wt > 0 && availableByOverall.get(o) && availableByOverall.get(o).length) {
        entries.push([o, wt]);
        total += wt;
      }
    });
    return entries.map(([o, wt]) => [o, wt / total]);
  }

  function pickOverall(probs, rng) {
    let r = rng(), acc = 0;
    for (const [o, p] of probs) { acc += p; if (r < acc) return o; }
    return probs.length ? probs[probs.length - 1][0] : null;
  }

  // Sorteia um pacote retirando os jogadores sorteados do pool (sem repetição).
  function drawPack(poolByOverall, pack, rng) {
    const cards = [];
    for (let i = 0; i < pack.cards; i++) {
      const probs = normalizedProbs(pack.weights, poolByOverall);
      if (!probs.length) break;
      const o = pickOverall(probs, rng);
      const list = poolByOverall.get(o);
      const idx = Math.floor(rng() * list.length);
      cards.push(list.splice(idx, 1)[0]);
    }
    return cards;
  }

  // Estatísticas analíticas com o pool cheio.
  function analyze(poolByOverall, pack, eliteThreshold) {
    const probs = normalizedProbs(pack.weights, poolByOverall);
    let ev = 0, pElite = 0, meanOverall = 0;
    probs.forEach(([o, p]) => {
      const list = poolByOverall.get(o);
      const meanValue = list.reduce((s, x) => s + (Number(x.value) || 0), 0) / list.length;
      ev += p * meanValue;
      meanOverall += p * o;
      if (o >= eliteThreshold) pElite += p;
    });
    return {
      evPerCard: ev,
      evPack: ev * pack.cards,
      meanOverall,
      pEliteCard: pElite,
      pEliteAtLeastOne: 1 - Math.pow(1 - pElite, pack.cards),
    };
  }

  // Simula várias aberturas, com o pool se esgotando e cartas vendidas voltando (opcional).
  function simulate({ players, packs, openings, teams, sellDepPct, eliteThreshold, seed, sellBackAll }) {
    const rng = mulberry32(seed || 1);
    const pool = groupByOverall(players);
    const initialByOverall = new Map([...pool].map(([o, l]) => [o, l.length]));
    const perPack = {};
    packs.forEach((p) => { perPack[p.id] = { opened: 0, spent: 0, cards: 0, valueSum: 0, sellSum: 0, elite: 0, byOverall: {} }; });
    const owned = [];
    const nTeams = teams || 1;
    for (let t = 0; t < nTeams; t++) {
      for (const pid of openings) {
        const pack = packs.find((p) => p.id === pid);
        const cards = drawPack(pool, pack, rng);
        const s = perPack[pid];
        s.opened++; s.spent += pack.price; s.cards += cards.length;
        cards.forEach((c) => {
          const v = Number(c.value) || 0;
          s.valueSum += v;
          s.sellSum += Math.ceil(v * (1 - sellDepPct / 100));
          if (c.overall >= eliteThreshold) s.elite++;
          s.byOverall[c.overall] = (s.byOverall[c.overall] || 0) + 1;
          owned.push(c);
        });
        if (sellBackAll) cards.forEach((c) => pool.get(c.overall).push(c));
      }
    }
    const remainingByOverall = {};
    initialByOverall.forEach((n, o) => { remainingByOverall[o] = { initial: n, remaining: pool.get(o).length }; });
    return { perPack, remainingByOverall, totalCards: owned.length };
  }

  const api = { mulberry32, effectiveCatalog, groupByOverall, generateWeights, normalizedProbs, drawPack, analyze, simulate };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PackSim = api;
})(typeof window !== "undefined" ? window : globalThis);
