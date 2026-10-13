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

  // Etapas da revelação de uma carta (ms depois de virar): posição → nacionalidade → clube → nome e overall.
  const STAGE_AT = [650, 1750, 2850, 4000];

  function RevealCard({ card, info, flipped, suspense, glow, elite, lost = false, pickable = false, pending = false, onFlip, onComplete, sellButton = null }) {
    const App = window.ManchaApp, overallColor = App.overallColor, positionColor = App.positionColor, L = App.L;
    const [stage, setStage] = React.useState(0);
    const completeRef = React.useRef(onComplete);
    completeRef.current = onComplete;
    React.useEffect(() => {
      if (!flipped || !card) return undefined;
      if (!suspense) { setStage(4); return undefined; }
      const timers = STAGE_AT.map((delay, index) => setTimeout(() => setStage((current) => Math.max(current, index + 1)), delay));
      return () => timers.forEach(clearTimeout);
    }, [flipped, suspense, !!card]);
    React.useEffect(() => { if (flipped && card && stage >= 4 && completeRef.current) completeRef.current(); }, [stage, flipped, !!card]);

    function onClick() {
      if (!flipped) { if (onFlip) onFlip(); return; }
      if (stage < 4) setStage(4);
    }
    const revealed = stage >= 4;
    const color = revealed && card ? overallColor(card.overall) : "var(--muted)";
    const flag = info && App.nationalityFlag ? App.nationalityFlag(info.nationality) : "🌐";
    const hide = (needed) => (stage < needed ? " is-hidden" : "");
    return h("div", {
      className: "pack-card" + (flipped ? " is-flipped" : "") + (pickable ? " is-pickable" : "") + (pending ? " is-pending" : "") + (lost ? " is-lost" : ""),
      style: { "--glow": glow }, onClick,
    },
      h("div", { className: "pack-card-inner" },
        h("div", { className: "pack-card-face pack-card-back" }, h("span", null, pending ? "…" : "?")),
        card ? h("div", { className: "pack-card-face pack-card-front" + (revealed && elite ? " is-elite" : "") + (revealed ? " is-revealed" : ""), style: { "--card-color": color } },
          h("div", { className: "pack-card-overall" + (revealed ? "" : " is-mystery"), style: { color } }, revealed ? card.overall : "??"),
          h("span", { className: "pack-card-pos" + hide(1), style: { background: positionColor(card.position) } }, card.position || "—"),
          h("div", { className: "pack-card-nation" + hide(2) }, h("span", { className: "pack-card-flag" }, flag), h("span", null, (info && info.nationality) || "")),
          h("small", { className: "pack-card-club" + hide(3) }, (info && info.club) || ""),
          h("strong", { className: "pack-card-name" + hide(4) }, card.name),
          h("div", { className: "pack-card-value" + hide(4) }, L(card.value)),
          lost ? h("div", { className: "pack-card-lost" }, "Não escolhida") : (revealed && sellButton)
        ) : null
      )
    );
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
    // Escolher 1: quando a carta escolhida termina de se revelar, as outras viram em sequência (mostrando o que ficou de fora).
    const pickDone = !!(reveal && reveal.mode === "pick" && reveal.phase === "revealing" && reveal.completed.includes(reveal.pickIndex));
    React.useEffect(() => {
      if (!pickDone) return undefined;
      const others = reveal.cards.map((_, index) => index).filter((index) => index !== reveal.pickIndex);
      const timers = others.map((index, order) => setTimeout(() => {
        setReveal((current) => current && current.mode === "pick" && !current.flipped.includes(index) ? { ...current, flipped: [...current.flipped, index] } : current);
      }, 600 + order * 380));
      return () => timers.forEach(clearTimeout);
    }, [pickDone]);

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
    function isLocked(pack) {
      return !!(settings.unlocksEnabled && pack.unlock && (stats.counts[pack.unlock.packId] || 0) < pack.unlock.count);
    }
    function packBlock(pack) {
      if (finished) return "Campeonato encerrado";
      if (!settings.isOpen) return "Loja fechada";
      if (!pack.enabled) return "Indisponível";
      if (isLocked(pack)) return "Bloqueado";
      if (budget < pack.price) return "Saldo insuficiente";
      if (rosterSize + (pack.interaction === "pick" ? 1 : pack.cards) > settings.rosterMax) return `Elenco cheio (${rosterSize}/${settings.rosterMax})`;
      return null;
    }

    function newReveal(pack, extra) {
      const mean = weightedMeanOverall(pack.weights);
      return { uid: Date.now() + Math.random(), mode: pack.interaction === "pick" ? "pick" : "all", packId: pack.id, packLabel: pack.label, n: pack.cards, accent: overallColor(Math.round(mean)), cards: [], pickIndex: null, phase: "choose", flipped: [], completed: [], skip: false, error: "", ...extra };
    }
    async function openPack(pack) {
      if (busyPackId || packBlock(pack)) return;
      setError("");
      // Escolher 1: abre a mesa de cartas virada; nada é cobrado até o usuário escolher uma.
      if (pack.interaction === "pick") { setReveal(newReveal(pack)); return; }
      setBusyPackId(pack.id);
      try {
        let checksum = null;
        try { checksum = (await Packs.loadCatalog(Packs.catalogIdOf(tournament))).checksum; } catch (checksumError) { checksum = null; }
        const result = await App.openPack({ tournamentId, packId: pack.id, teamId, actorProfileId: profile && profile.id, catalogChecksum: checksum });
        const cards = (Array.isArray(result.cards) ? result.cards : []).slice().sort((a, b) => (Number(a.overall) || 0) - (Number(b.overall) || 0));
        if (alive.current) setReveal(newReveal(pack, { cards, phase: "revealing" }));
        reloadStats();
      } catch (openError) {
        console.error("open_pack failed", openError);
        if (alive.current) setError(errorText(openError));
      } finally {
        if (alive.current) setBusyPackId(null);
      }
    }
    async function choosePick(index) {
      const current = reveal;
      if (!current || current.mode !== "pick" || current.phase !== "choose") return;
      const pack = settings.packs.find((item) => item.id === current.packId);
      if (!pack || packBlock(pack)) { setReveal((state) => state && { ...state, error: (pack && packBlock(pack)) || "Pacote indisponível." }); return; }
      setReveal({ ...current, phase: "opening", pickIndex: index, error: "" });
      try {
        let checksum = null;
        try { checksum = (await Packs.loadCatalog(Packs.catalogIdOf(tournament))).checksum; } catch (checksumError) { checksum = null; }
        const result = await App.openPack({ tournamentId, packId: pack.id, teamId, actorProfileId: profile && profile.id, catalogChecksum: checksum, pickIndex: index });
        const cards = Array.isArray(result.cards) ? result.cards : [];
        if (alive.current) setReveal((state) => state && state.phase === "opening" ? { ...state, cards, phase: "revealing", flipped: [index], completed: [] } : state);
        reloadStats();
      } catch (openError) {
        console.error("open_pack (pick) failed", openError);
        const missing = /p_pick_index|PGRST202|schema cache/i.test(String(openError && (openError.message || openError.details || openError)));
        if (alive.current) setReveal((state) => state && { ...state, phase: "choose", pickIndex: null, error: missing ? "O servidor ainda não tem o modo \"escolher 1 carta\" (falta aplicar o PACKS-V2-PICK.sql no Supabase)." : errorText(openError) });
      }
    }

    function packTile(pack) {
      const mean = weightedMeanOverall(pack.weights);
      const accent = overallColor(Math.round(mean));
      const block = packBlock(pack);
      const locked = isLocked(pack);
      const have = pack.unlock ? Math.min(stats.counts[pack.unlock.packId] || 0, pack.unlock.count) : 0;
      return h("article", { key: pack.id, className: "pack-tile" + (locked ? " is-locked" : ""), style: { "--pack-accent": accent } },
        h("div", { className: "pack-tile-art" }, h("span", { className: "pack-tile-cards" }, pack.interaction === "pick" ? `Escolha 1 de ${pack.cards}` : `${pack.cards} cartas`)),
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

    function sellButtonFor(card) {
      if (!onSell) return null;
      const info = catalogMap && catalogMap.get ? catalogMap.get(String(card.playerId)) : null;
      const current = ownership && ownership[String(card.playerId)];
      const owned = !!(current && teamId && String(current.teamId) === teamId);
      const sellAmount = Math.ceil((Number(card.value) || 0) * (1 - settings.sellDepreciationPct / 100));
      return h("button", {
        className: "tapbtn pack-card-sell", disabled: !owned,
        onClick: (event) => { event.stopPropagation(); onSell(info || { id: String(card.playerId), name: card.name, value: card.value, overall: card.overall, position: card.position }); },
      }, owned ? `Vender · ${L(sellAmount)}` : "Vendida");
    }

    function revealModal() {
      if (!reveal) return null;
      const pack = settings.packs.find((item) => item.id === reveal.packId);
      const isPick = reveal.mode === "pick";
      const total = isPick ? reveal.n : reveal.cards.length;
      const flippedSet = new Set(reveal.flipped);
      const completedSet = new Set(reveal.completed);
      const choosing = isPick && reveal.phase !== "revealing";
      const done = !choosing && (isPick ? completedSet.has(reveal.pickIndex) && flippedSet.size >= total : completedSet.size >= total);
      // O brilho das cartas fechadas é neutro (nem a cor do pacote, que vem do overall médio): nunca sugere o overall antes da revelação.
      const glow = "#aab6b0";
      const again = pack && !packBlock(pack);
      const suspenseOn = settings.suspense && !reveal.skip;
      const flipOne = (index) => setReveal((current) => current && !current.flipped.includes(index) ? { ...current, flipped: [...current.flipped, index] } : current);
      const complete = (index) => setReveal((current) => current && !current.completed.includes(index) ? { ...current, completed: [...current.completed, index] } : current);
      const flipNext = () => setReveal((current) => {
        if (!current) return current;
        const next = current.cards.findIndex((_, index) => !current.flipped.includes(index));
        return next < 0 ? current : { ...current, flipped: [...current.flipped, next] };
      });
      const flipAll = () => setReveal((current) => current && { ...current, skip: true, flipped: current.cards.map((_, index) => index) });
      const slots = Array.from({ length: total }, (_, index) => index);
      const hint = choosing
        ? (reveal.phase === "opening" ? "Abrindo o pacote…" : "Escolha uma carta. As outras serão reveladas depois, mas só a sua fica com você.")
        : !done ? (isPick ? "Toque na carta durante a revelação para pular a animação." : "Toque em qualquer carta para virar. Durante a revelação, toque nela para pular.") : "";
      return ReactDOM.createPortal(
        h("div", { className: "pack-reveal-overlay" },
          h("div", { className: "pack-reveal-panel" },
            h("div", { className: "pack-reveal-head" },
              h("strong", null, isPick ? `Pacote ${reveal.packLabel} · escolha 1 de ${total}` : `Pacote ${reveal.packLabel}`),
              h("button", { className: "tapbtn pack-reveal-close", "aria-label": "Fechar", disabled: reveal.phase === "opening", onClick: () => setReveal(null) }, "✕")
            ),
            reveal.error && h("div", { className: "pack-store-error", role: "alert" }, reveal.error),
            h("div", { className: "pack-reveal-cards" }, slots.map((index) => {
              const card = reveal.cards[index] || null;
              const info = card && catalogMap && catalogMap.get ? catalogMap.get(String(card.playerId)) : null;
              const isChosen = isPick && index === reveal.pickIndex;
              const lost = isPick && !!card && !isChosen;
              return h(RevealCard, {
                key: `${reveal.uid}-${index}`,
                card, info, glow,
                flipped: !!card && flippedSet.has(index),
                suspense: isPick ? (isChosen && suspenseOn) : suspenseOn,
                elite: !!card && Number(card.overall) >= settings.eliteThreshold,
                lost, pickable: choosing && reveal.phase === "choose",
                pending: reveal.phase === "opening" && isChosen,
                onFlip: () => { if (choosing) choosePick(index); else flipOne(index); },
                onComplete: () => complete(index),
                sellButton: card && !lost ? sellButtonFor(card) : null,
              });
            })),
            hint && h("div", { className: "pack-reveal-hint" }, hint),
            h("div", { className: "pack-reveal-actions" },
              !choosing && !done && !isPick && h("button", { className: "tapbtn pack-open-btn", onClick: flipNext }, flippedSet.size === 0 ? "Revelar" : "Próxima carta"),
              !choosing && !done && !isPick && h("button", { className: "tapbtn pack-ghost-btn", onClick: flipAll }, "Revelar todas"),
              done && pack && h("button", { className: "tapbtn pack-open-btn", disabled: !again || !!busyPackId, onClick: () => openPack(pack) }, again ? `Abrir outro · ${L(pack.price)}` : (packBlock(pack) || "Indisponível")),
              (done || (isPick && reveal.phase === "choose")) && h("button", { className: "tapbtn pack-ghost-btn", onClick: () => setReveal(null) }, done ? "Fechar" : "Cancelar")
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
      !settings.unlocksEnabled && h("div", { className: "pack-store-notice" }, "Modo de teste: os marcos de desbloqueio estão desativados e todos os pacotes estão liberados."),
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
