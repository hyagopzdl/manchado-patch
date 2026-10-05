(() => {
  window.ManchaApp = window.ManchaApp || {};
  const h = React.createElement;

  const ERROR_TEXT = {
    insufficient_funds: "Saldo insuficiente para este pacote.",
    roster_full: "Seu elenco passaria do limite. Venda jogadores ao mercado antes de abrir.",
    pack_locked: "Este pacote ainda não foi liberado.",
    store_closed: "A loja de pacotes está fechada pela administração.",
    pack_disabled: "Este pacote está desativado.",
    pool_empty: "Não há mais jogadores disponíveis para este pacote.",
    not_team_owner: "Você não é o dono deste time.",
    tournament_finished: "Este campeonato já foi encerrado.",
    not_packs_mode: "Este campeonato não usa pacotes.",
    packs_not_configured: "A loja deste campeonato ainda não foi configurada.",
    catalog_outdated: "A base de jogadores do app é diferente da carregada no servidor. Recarregue a página; se persistir, avise o admin.",
    catalog_not_loaded: "A base de jogadores deste campeonato não foi carregada no servidor. Avise o admin.",
  };
  function errorText(error) {
    const code = String((error && (error.message || error.details)) || error || "").trim();
    return ERROR_TEXT[code] || "Não foi possível abrir o pacote. Tente novamente.";
  }

  // Overall médio ponderado pelos pesos do pacote (não considera o esgotamento do pool).
  function weightedMeanOverall(weights) {
    let total = 0, sum = 0;
    Object.entries(weights || {}).forEach(([overall, weight]) => {
      const w = Number(weight) || 0, o = Number(overall) || 0;
      if (w > 0 && o > 0) { total += w; sum += w * o; }
    });
    return total ? sum / total : 0;
  }

  function PackStore({ tournament, team, profile, ownership, catalogMap, onSell = null, finished = false }) {
    const App = window.ManchaApp, Packs = App.PacksFeature, L = App.L, E = App.E, overallColor = App.overallColor, positionColor = App.positionColor;
    const settings = React.useMemo(() => Packs.packSettingsOf(tournament), [tournament]);
    const [stats, setStats] = React.useState({ counts: {}, mine: [], loaded: false });
    const [busyPackId, setBusyPackId] = React.useState(null);
    const [reveal, setReveal] = React.useState(null);
    const [error, setError] = React.useState("");
    const teamId = team && team.id ? String(team.id) : null;
    const tournamentId = tournament && tournament.id ? String(tournament.id) : null;
    const rosterSize = Object.values(ownership || {}).filter((item) => item && teamId && String(item.teamId) === teamId).length;
    const ownershipVersion = Object.keys(ownership || {}).length;
    const budget = Number(team && team.budget) || 0;
    const alive = React.useRef(true);
    React.useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

    const reloadStats = React.useCallback(async () => {
      if (!tournamentId || typeof App.loadPackStats !== "function") return;
      try {
        const next = await App.loadPackStats({ tournamentId, teamId });
        if (alive.current) setStats({ ...next, loaded: true });
      } catch (loadError) {
        console.error("pack stats failed", loadError);
        if (alive.current) setStats((current) => ({ ...current, loaded: true }));
      }
    }, [tournamentId, teamId]);
    React.useEffect(() => { reloadStats(); }, [reloadStats, ownershipVersion]);

    if (!team) {
      return h("div", { style: { ...E, padding: 24, textAlign: "center", color: "var(--muted)" } }, "Entre com um perfil que participa deste campeonato para abrir pacotes.");
    }

    function labelOf(packId) {
      const found = settings.packs.find((pack) => pack.id === packId);
      return found ? found.label : packId;
    }
    function packBlock(pack) {
      if (finished) return "Campeonato encerrado";
      if (!settings.isOpen) return "Loja fechada";
      if (!pack.enabled) return "Indisponível";
      if (pack.unlock && (stats.counts[pack.unlock.packId] || 0) < pack.unlock.count) return "Bloqueado";
      if (budget < pack.price) return "Saldo insuficiente";
      if (rosterSize + pack.cards > settings.rosterMax) return `Elenco cheio (${rosterSize}/${settings.rosterMax})`;
      return null;
    }

    async function openPack(pack) {
      if (busyPackId || packBlock(pack)) return;
      setError("");
      setBusyPackId(pack.id);
      try {
        let checksum = null;
        try { checksum = (await Packs.loadCatalog(Packs.catalogIdOf(tournament))).checksum; } catch (checksumError) { checksum = null; }
        const result = await App.openPack({ tournamentId, packId: pack.id, teamId, actorProfileId: profile && profile.id, catalogChecksum: checksum });
        const cards = (Array.isArray(result.cards) ? result.cards : []).slice().sort((a, b) => (Number(a.overall) || 0) - (Number(b.overall) || 0));
        if (alive.current) setReveal({ packId: pack.id, packLabel: pack.label, cards, revealed: [] });
        reloadStats();
      } catch (openError) {
        console.error("open_pack failed", openError);
        if (alive.current) setError(errorText(openError));
      } finally {
        if (alive.current) setBusyPackId(null);
      }
    }

    function packTile(pack) {
      const mean = weightedMeanOverall(pack.weights);
      const accent = overallColor(Math.round(mean));
      const block = packBlock(pack);
      const locked = pack.unlock && (stats.counts[pack.unlock.packId] || 0) < pack.unlock.count;
      const have = pack.unlock ? Math.min(stats.counts[pack.unlock.packId] || 0, pack.unlock.count) : 0;
      return h("article", { key: pack.id, className: "pack-tile" + (locked ? " is-locked" : ""), style: { "--pack-accent": accent } },
        h("div", { className: "pack-tile-art" }, h("span", { className: "pack-tile-cards" }, `${pack.cards} cartas`)),
        h("div", { className: "pack-tile-body" },
          h("div", { className: "pack-tile-title" }, h("strong", null, pack.label), h("span", null, `OVR médio ≈ ${Math.round(mean)}`)),
          locked && h("div", { className: "pack-tile-lock" },
            h("div", null, `Libera após ${pack.unlock.count} pacotes ${labelOf(pack.unlock.packId)} abertos no campeonato`),
            h("div", { className: "pack-progress" }, h("span", { style: { width: `${pack.unlock.count ? Math.round((have / pack.unlock.count) * 100) : 100}%` } })),
            h("small", null, `${have}/${pack.unlock.count}`)
          ),
          h("button", { className: "tapbtn pack-open-btn", disabled: !!block || !!busyPackId, onClick: () => openPack(pack) },
            busyPackId === pack.id ? "Abrindo…" : block || `Abrir · ${L(pack.price)}`)
        )
      );
    }

    function cardFront(card) {
      const info = catalogMap && catalogMap.get ? catalogMap.get(String(card.playerId)) : null;
      const color = overallColor(card.overall);
      const elite = Number(card.overall) >= settings.eliteThreshold;
      const current = ownership && ownership[String(card.playerId)];
      const owned = !!(current && teamId && String(current.teamId) === teamId);
      const sellAmount = Math.ceil((Number(card.value) || 0) * (1 - settings.sellDepreciationPct / 100));
      return h("div", { className: "pack-card-face pack-card-front" + (elite ? " is-elite" : ""), style: { "--card-color": color } },
        h("div", { className: "pack-card-overall", style: { color } }, card.overall),
        h("span", { className: "pack-card-pos", style: { background: positionColor(card.position) } }, card.position || "—"),
        h("strong", { className: "pack-card-name" }, card.name),
        h("small", { className: "pack-card-club" }, (info && info.club) || ""),
        h("div", { className: "pack-card-value" }, L(card.value)),
        onSell && h("button", {
          className: "tapbtn pack-card-sell", disabled: !owned,
          onClick: (event) => { event.stopPropagation(); onSell(info || { id: String(card.playerId), name: card.name, value: card.value, overall: card.overall, position: card.position }); },
        }, owned ? `Vender · ${L(sellAmount)}` : "Vendida")
      );
    }

    function revealModal() {
      if (!reveal) return null;
      const pack = settings.packs.find((item) => item.id === reveal.packId);
      const total = reveal.cards.length;
      const revealedSet = new Set(reveal.revealed);
      const done = revealedSet.size >= total;
      const best = reveal.cards.reduce((max, card) => Math.max(max, Number(card.overall) || 0), 0);
      const glow = overallColor(best);
      const again = pack && !packBlock(pack);
      // Qualquer carta pode ser virada, em qualquer ordem.
      const flipOne = (index) => setReveal((current) => current && !current.revealed.includes(index) ? { ...current, revealed: [...current.revealed, index] } : current);
      const flipNext = () => setReveal((current) => {
        if (!current) return current;
        const next = current.cards.findIndex((_, index) => !current.revealed.includes(index));
        return next < 0 ? current : { ...current, revealed: [...current.revealed, next] };
      });
      const flipAll = () => setReveal((current) => current && { ...current, revealed: current.cards.map((_, index) => index) });
      return ReactDOM.createPortal(
        h("div", { className: "pack-reveal-overlay" },
          h("div", { className: "pack-reveal-panel" },
            h("div", { className: "pack-reveal-head" },
              h("strong", null, `Pacote ${reveal.packLabel}`),
              h("button", { className: "tapbtn pack-reveal-close", "aria-label": "Fechar", onClick: () => setReveal(null) }, "✕")
            ),
            h("div", { className: "pack-reveal-cards" }, reveal.cards.map((card, index) =>
              h("div", { key: card.playerId, className: "pack-card" + (revealedSet.has(index) ? " is-flipped" : ""), style: { "--glow": glow }, onClick: () => flipOne(index) },
                h("div", { className: "pack-card-inner" },
                  h("div", { className: "pack-card-face pack-card-back" }, h("span", null, "?")),
                  cardFront(card)
                )
              )
            )),
            !done && h("div", { className: "pack-reveal-hint" }, "Toque em qualquer carta para virar."),
            h("div", { className: "pack-reveal-actions" },
              !done && h("button", { className: "tapbtn pack-open-btn", onClick: flipNext }, revealedSet.size === 0 ? "Revelar" : "Próxima carta"),
              !done && h("button", { className: "tapbtn pack-ghost-btn", onClick: flipAll }, "Revelar todas"),
              done && pack && h("button", { className: "tapbtn pack-open-btn", disabled: !again || !!busyPackId, onClick: () => openPack(pack) }, again ? `Abrir outro · ${L(pack.price)}` : (packBlock(pack) || "Indisponível")),
              done && h("button", { className: "tapbtn pack-ghost-btn", onClick: () => setReveal(null) }, "Fechar")
            )
          )
        ),
        document.body
      );
    }

    return h("div", { className: "pack-store" },
      h("div", { className: "pack-store-summary" },
        h("span", null, `Elenco ${rosterSize}/${settings.rosterMax}`),
        h("span", null, `Saldo ${L(budget)}`)
      ),
      !settings.isOpen && h("div", { className: "pack-store-notice" }, "A loja está fechada pela administração."),
      error && h("div", { className: "pack-store-error", role: "alert" }, error),
      h("div", { className: "pack-grid" }, settings.packs.map(packTile)),
      stats.mine.length > 0 && h("section", { className: "pack-history" },
        h("h3", null, "Suas últimas aberturas"),
        stats.mine.slice(0, 8).map((opening) => h("div", { key: opening.id, className: "pack-history-row" },
          h("strong", null, labelOf(opening.packId)),
          h("span", null, opening.cards.map((card) => `${card.overall} ${card.name}`).join(" · "))
        ))
      ),
      revealModal()
    );
  }

  window.ManchaApp.PackStore = PackStore;
})();
