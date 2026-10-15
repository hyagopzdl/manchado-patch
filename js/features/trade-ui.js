(() => {
  window.ManchaApp = window.ManchaApp || {};
  const h = React.createElement;
  const App = () => window.ManchaApp;
  const Trade = () => window.ManchaApp.TradeFeature;

  const money = (value) => `${Math.round(Number(value) || 0)}M`;
  const signed = (value) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(Math.round(Number(value) || 0))}M`;
  function timeLeft(expiresAt, now) {
    const ms = Number(expiresAt) - now;
    if (ms <= 0) return "expirada";
    const hours = Math.floor(ms / 3600000);
    if (hours >= 24) return `expira em ${Math.floor(hours / 24)} d ${hours % 24} h`;
    if (hours >= 1) return `expira em ${hours} h`;
    return `expira em ${Math.max(1, Math.floor(ms / 60000))} min`;
  }
  function ago(ms) {
    const min = Math.floor(Math.max(0, Date.now() - Number(ms)) / 60000);
    if (min < 1) return "agora";
    if (min < 60) return `há ${min} min`;
    const hours = Math.floor(min / 60);
    if (hours < 24) return `há ${hours} h`;
    const days = Math.floor(hours / 24);
    return days === 1 ? "ontem" : `há ${days} dias`;
  }

  // ---- peças visuais ----
  function Avatar({ team, profile, size = 34 }) {
    const color = (profile && profile.color) || (team && team.color) || "#4a7fc1";
    const label = String((team && team.name) || (profile && profile.name) || "?").slice(0, 1).toUpperCase();
    return h("span", { className: "trade-avatar", style: { width: size, height: size, background: color, fontSize: Math.round(size * 0.42) } },
      profile && profile.avatar ? h("img", { src: profile.avatar, alt: "" }) : label);
  }

  function MiniCard({ player, onRemove = null, onOpen = null, dim = false, tag = null }) {
    const overallColor = App().overallColor, positionColor = App().positionColor;
    if (!player) return null;
    return h("div", { className: "trade-card" + (dim ? " is-dim" : "") + (onOpen ? " is-link" : ""), style: { "--tc": overallColor(player.overall) }, onClick: onOpen ? () => onOpen(player) : undefined },
      onRemove && h("button", { type: "button", className: "trade-card-x", "aria-label": `Remover ${player.name}`, onClick: (event) => { event.stopPropagation(); onRemove(player); } }, "×"),
      h("b", { className: "trade-card-ovr" }, player.overall),
      h("span", { className: "trade-card-pos", style: { background: positionColor(player.position) } }, player.position || "—"),
      h("span", { className: "trade-card-name" }, player.name),
      h("span", { className: "trade-card-value" }, money(player.value)),
      tag && h("i", { className: "trade-card-tag" }, tag));
  }

  // Barra de equilíbrio: proporção entre o valor que sai e o que entra.
  function BalanceBar({ give, get }) {
    const total = Math.max(1, give + get), left = Math.round((give / total) * 100);
    const gap = Math.abs(give - get), ref = Math.max(give, get, 1), even = gap <= ref * 0.08;
    return h("div", { className: "trade-balance" },
      h("div", { className: "trade-balance-bar", "aria-hidden": "true" }, h("span", { className: "is-left", style: { width: `${left}%` } }), h("span", { className: "is-right", style: { width: `${100 - left}%` } })),
      h("div", { className: "trade-balance-labels" }, h("span", null, `Você dá ${money(give)}`), h("b", { className: even ? "is-even" : "is-uneven" }, even ? "Equilibrada" : `Diferença de ${money(gap)}`), h("span", null, `Você recebe ${money(get)}`)));
  }

  // ---- seletor de jogadores (folha por baixo) ----
  function PlayerPicker({ title, team, players, picked, maxPicks, lockInfo, onToggle, onClose }) {
    const [query, setQuery] = React.useState("");
    const [position, setPosition] = React.useState("all");
    const positions = React.useMemo(() => [...new Set(players.map((player) => player.position).filter(Boolean))].sort(), [players]);
    const normalized = (value) => String(value || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const list = players.filter((player) => (position === "all" || player.position === position) && (!query || normalized(`${player.name} ${player.club || ""}`).includes(normalized(query))))
      .slice().sort((a, b) => (Number(b.overall) || 0) - (Number(a.overall) || 0) || String(a.name).localeCompare(String(b.name), "pt-BR"));
    return ReactDOM.createPortal(h("div", { className: "trade-sheet-overlay", onClick: onClose },
      h("div", { className: "trade-sheet", role: "dialog", "aria-label": title, onClick: (event) => event.stopPropagation() },
        h("div", { className: "trade-sheet-grip" }),
        h("div", { className: "trade-sheet-head" }, h("div", null, h("strong", null, title), h("small", null, `${team ? team.name : ""} · ${picked.length}/${maxPicks} escolhidos`)), h("button", { type: "button", className: "trade-btn-ghost", onClick: onClose }, "Pronto")),
        h("input", { className: "trade-search", placeholder: "Buscar jogador ou clube", value: query, onChange: (event) => setQuery(event.target.value) }),
        h("div", { className: "trade-chips" }, ["all", ...positions].map((item) => h("button", { key: item, type: "button", className: "trade-chip" + (position === item ? " is-active" : ""), onClick: () => setPosition(item) }, item === "all" ? "Todos" : item))),
        h("div", { className: "trade-sheet-list" }, list.length === 0 ? h("div", { className: "trade-empty" }, "Nenhum jogador encontrado.") : list.map((player) => {
          const isPicked = picked.includes(String(player.id)), lock = lockInfo ? lockInfo(player.id) : null, locked = !!(lock && lock.locked);
          const full = !isPicked && picked.length >= maxPicks;
          return h("button", { key: player.id, type: "button", disabled: locked || full, className: "trade-row" + (isPicked ? " is-picked" : "") + (locked ? " is-locked" : ""), onClick: () => onToggle(player) },
            h("b", { className: "trade-row-ovr", style: { color: App().overallColor(player.overall) } }, player.overall),
            h("span", { className: "trade-row-pos", style: { background: App().positionColor(player.position) } }, player.position),
            h("span", { className: "trade-row-name" }, h("strong", null, player.name), h("small", null, locked ? `Faltam ${lock.gamesRemaining} jogos no time` : (player.club || ""))),
            h("span", { className: "trade-row-value" }, money(player.value)),
            h("span", { className: "trade-row-check", "aria-hidden": "true" }, isPicked ? "✓" : ""));
        })))), document.body);
  }

  // ---- mesa de troca ----
  function TradeDesk({ myTeam, teams, profiles, settings, squadOf, planFor, lockInfo, initial, onSubmit, onClose, onOpenDetail }) {
    const partners = teams.filter((team) => team && team.active !== false && String(team.id) !== String(myTeam.id));
    const [partnerId, setPartnerId] = React.useState(initial && initial.toTeamId ? String(initial.toTeamId) : (partners[0] ? String(partners[0].id) : ""));
    const [give, setGive] = React.useState(initial && initial.give ? initial.give.map(String) : []);
    const [get, setGet] = React.useState(initial && initial.get ? initial.get.map(String) : []);
    const [cashText, setCashText] = React.useState(initial && initial.cash != null ? String(initial.cash) : null);
    const [picker, setPicker] = React.useState(null);
    const [rulesOpen, setRulesOpen] = React.useState(false);
    const [busy, setBusy] = React.useState(false);
    const partner = partners.find((team) => String(team.id) === partnerId) || null;
    const myPlayers = squadOf(myTeam.id), theirPlayers = partner ? squadOf(partner.id) : [];
    const byId = (list, id) => list.find((player) => String(player.id) === String(id));

    const base = planFor({ fromTeamId: myTeam.id, toTeamId: partnerId, give, get, cash: 0 });
    const cash = cashText == null ? base.suggestedCash : Math.round(Number(String(cashText).replace(",", ".")) || 0);
    const plan = planFor({ fromTeamId: myTeam.id, toTeamId: partnerId, give, get, cash });
    const profileOf = (team) => (profiles || []).find((item) => team && String(item.id) === String(team.profileId));

    function changePartner(id) { setPartnerId(String(id)); setGet([]); setCashText(null); }
    function toggle(side, player) {
      const id = String(player.id), setter = side === "give" ? setGive : setGet;
      setter((list) => list.includes(id) ? list.filter((item) => item !== id) : (list.length < settings.maxPlayersPerSide ? [...list, id] : list));
      setCashText(null);
    }
    function step(delta) { setCashText(String(cash + delta)); }
    async function send() {
      if (!plan.ok || busy) return;
      setBusy(true);
      const done = await onSubmit({ fromTeamId: myTeam.id, toTeamId: partnerId, give, get, cash }, initial && initial.counterOf);
      setBusy(false);
      if (done) onClose();
    }
    const cashText2 = cash > 0 ? `Você paga ${money(cash)} a ${partner ? partner.name : "ele"}` : cash < 0 ? `${partner ? partner.name : "Ele"} paga ${money(-cash)} a você` : "Sem troco";

    function lane(side) {
      const mine = side === "give", ids = mine ? give : get, players = mine ? myPlayers : theirPlayers, team = mine ? myTeam : partner;
      return h("section", { className: "trade-lane " + (mine ? "is-give" : "is-get") },
        h("div", { className: "trade-lane-head" }, h(Avatar, { team, profile: profileOf(team), size: 26 }), h("strong", null, mine ? "Oferecendo" : `Recebendo${partner ? ` de ${partner.name}` : ""}`), h("small", null, `${ids.length}/${settings.maxPlayersPerSide}`)),
        h("div", { className: "trade-slots" },
          ids.map((id) => h(MiniCard, { key: id, player: byId(players, id), onRemove: (player) => toggle(side, player), onOpen: onOpenDetail })),
          ids.length < settings.maxPlayersPerSide && h("button", { type: "button", className: "trade-add", disabled: !team, onClick: () => setPicker(side) }, h("span", null, "+"), h("small", null, "Adicionar jogador"))));
    }

    return ReactDOM.createPortal(h("div", { className: "trade-desk", role: "dialog", "aria-label": "Mesa de troca" },
      h("header", { className: "trade-desk-head" },
        h("button", { type: "button", className: "trade-icon-btn", "aria-label": "Fechar", onClick: onClose }, "✕"),
        h("div", { className: "trade-desk-title" }, h("strong", null, initial && initial.counterOf ? "Contra-proposta" : "Nova troca"), h("small", null, "Monte a troca e veja se fecha")),
        h("span", { style: { width: 38 } })),
      h("div", { className: "trade-desk-body" },
        h("div", { className: "trade-partners", role: "tablist", "aria-label": "Com quem negociar" }, partners.map((team) => h("button", { key: team.id, type: "button", role: "tab", "aria-selected": String(team.id) === partnerId, disabled: !!(initial && initial.counterOf), className: "trade-partner" + (String(team.id) === partnerId ? " is-active" : ""), onClick: () => changePartner(team.id) }, h(Avatar, { team, profile: profileOf(team), size: 28 }), h("span", null, team.name)))),
        partners.length === 0 && h("div", { className: "trade-empty" }, "Não há outros participantes para negociar."),
        lane("give"),
        h("div", { className: "trade-middle" },
          h("div", { className: "trade-swap-icon", "aria-hidden": "true" }, "⇅"),
          h(BalanceBar, { give: plan.valueGive, get: plan.valueGet }),
          h("div", { className: "trade-cash" },
            h("div", { className: "trade-cash-label" }, h("strong", null, "Troco"), h("small", null, cashText2)),
            h("div", { className: "trade-cash-stepper" },
              h("button", { type: "button", "aria-label": "Diminuir 5M", onClick: () => step(-5) }, "−5"),
              h("input", { inputMode: "numeric", "aria-label": "Troco em milhões", value: cash, onChange: (event) => setCashText(event.target.value.replace(/[^0-9\-]/g, "")) }),
              h("button", { type: "button", "aria-label": "Aumentar 5M", onClick: () => step(5) }, "+5"),
              h("button", { type: "button", className: "is-eq", onClick: () => setCashText(null), disabled: cashText == null }, "Equilibrar"))),
          plan.fee.total > 0 && h("div", { className: "trade-fee" }, `Taxa do banco: ${money(plan.fee.total)} (${money(plan.fee.each)} para cada lado)`)),
        lane("get"),
        h("div", { style: { height: rulesOpen ? 320 : 150 } })),
      h("footer", { className: "trade-desk-foot" + (rulesOpen ? " is-open" : "") },
        rulesOpen && h("div", { className: "trade-rules" },
          h("div", { className: "trade-rule-line" }, h("span", null, "Seu saldo depois"), h("b", { className: plan.budgets.from.after < 0 ? "is-bad" : "" }, money(plan.budgets.from.after))),
          h("div", { className: "trade-rule-line" }, h("span", null, `Saldo de ${partner ? partner.name : "o outro time"} depois`), h("b", { className: plan.budgets.to.after < 0 ? "is-bad" : "" }, money(plan.budgets.to.after))),
          h("div", { className: "trade-rule-line" }, h("span", null, "Seu elenco"), h("b", { className: plan.rosters.from.after < plan.rosters.min || plan.rosters.from.after > plan.rosters.max ? "is-bad" : "" }, `${plan.rosters.from.before} → ${plan.rosters.from.after} (${plan.rosters.min}–${plan.rosters.max})`)),
          h("div", { className: "trade-rule-line" }, h("span", null, "Elenco dele"), h("b", { className: plan.rosters.to.after < plan.rosters.min || plan.rosters.to.after > plan.rosters.max ? "is-bad" : "" }, `${plan.rosters.to.before} → ${plan.rosters.to.after}`)),
          plan.balance && plan.balance.enabled && plan.balance.futureGap != null && h("div", { className: "trade-rule-line" }, h("span", null, "Diferença entre times"), h("b", { className: plan.balance.allowed ? "" : "is-bad" }, `${plan.balance.currentGap.toFixed(1)} → ${plan.balance.futureGap.toFixed(1)} OVR`)),
          plan.blockers.length > 0 && h("ul", { className: "trade-blockers" }, plan.blockers.map((text, index) => h("li", { key: index }, text)))),
        h("div", { className: "trade-foot-row" },
          h("button", { type: "button", className: "trade-foot-sum", "aria-expanded": rulesOpen, onClick: () => setRulesOpen(!rulesOpen) },
            h("span", { className: "trade-chevron" }, rulesOpen ? "▾" : "▴"),
            h("span", { className: "trade-foot-text" }, h("small", null, plan.ok ? "Tudo certo com as regras" : (give.length && get.length ? `${plan.blockers.length} problema${plan.blockers.length === 1 ? "" : "s"}` : "Escolha jogadores")), h("b", null, cashText2))),
          h("button", { type: "button", className: "trade-send", disabled: !plan.ok || busy, onClick: send }, busy ? "Enviando…" : (initial && initial.counterOf ? "Enviar contra-proposta" : "Enviar proposta")))),
      picker && h(PlayerPicker, { title: picker === "give" ? "Escolha o que você dá" : `Escolha o que quer de ${partner ? partner.name : ""}`, team: picker === "give" ? myTeam : partner, players: picker === "give" ? myPlayers : theirPlayers, picked: picker === "give" ? give : get, maxPicks: settings.maxPlayersPerSide, lockInfo: (id) => lockInfo(id, picker === "give" ? myTeam.id : partnerId), onToggle: (player) => toggle(picker, player), onClose: () => setPicker(null) })), document.body);
  }

  // ---- cartão de proposta (caixa de entrada) ----
  function ProposalCard({ proposal, myTeamId, teamById, profileOf, playerOf, planFor, now, onAccept, onDecline, onCancel, onCounter, onOpenDetail }) {
    const T = Trade(), status = T.displayStatus(proposal, now), open = status === "pending";
    const from = teamById(proposal.fromTeamId), to = teamById(proposal.toTeamId);
    const incoming = String(proposal.toTeamId) === String(myTeamId), mine = String(proposal.fromTeamId) === String(myTeamId);
    const plan = open ? planFor({ fromTeamId: proposal.fromTeamId, toTeamId: proposal.toTeamId, give: proposal.give, get: proposal.get, cash: proposal.cash }) : null;
    const LABEL = { pending: "Aguardando", accepted: "Aceita", declined: "Recusada", cancelled: "Cancelada", countered: "Contra-proposta", expired: "Expirada", invalid: "Inválida" };
    const cashLine = proposal.cash > 0 ? `${from ? from.name : "Quem propôs"} paga ${money(proposal.cash)} a ${to ? to.name : "quem recebeu"}` : proposal.cash < 0 ? `${to ? to.name : "Quem recebeu"} paga ${money(-proposal.cash)} a ${from ? from.name : "quem propôs"}` : "Sem troco";
    const side = (title, ids, team) => h("div", { className: "trade-pc-side" }, h("small", null, title), h("div", { className: "trade-pc-cards" }, ids.map((id) => h(MiniCard, { key: id, player: playerOf(id), onOpen: onOpenDetail, dim: !open }))));
    return h("article", { className: "trade-pc status-" + status + (incoming && open ? " is-incoming" : "") },
      h("div", { className: "trade-pc-head" },
        h(Avatar, { team: from, profile: profileOf(from), size: 34 }),
        h("div", { className: "trade-pc-title" }, h("strong", null, `${mine ? "Você" : (from ? from.name : "?")} → ${incoming ? "você" : (to ? to.name : "?")}`), h("small", null, open ? timeLeft(proposal.expiresAt, now) : ago(proposal.updatedAt))),
        h("span", { className: "trade-status" }, LABEL[status] || status)),
      h("div", { className: "trade-pc-body" }, side(mine ? "Você dá" : `${from ? from.name : ""} dá`, proposal.give, from), h("div", { className: "trade-pc-arrow", "aria-hidden": "true" }, "⇄"), side(mine ? `Você recebe` : "Você dá", proposal.get, to)),
      h("div", { className: "trade-pc-cash" }, h("span", null, cashLine), proposal.settled && proposal.settled.feeEach > 0 && h("small", null, `taxa ${money(proposal.settled.feeEach)} cada`)),
      open && incoming && plan && !plan.ok && h("div", { className: "trade-pc-warn" }, plan.blockers[0]),
      open && h("div", { className: "trade-pc-actions" },
        incoming ? h(React.Fragment, null,
          h("button", { type: "button", className: "trade-btn-primary", disabled: !plan || !plan.ok, onClick: () => onAccept(proposal) }, "Aceitar"),
          h("button", { type: "button", className: "trade-btn-ghost", onClick: () => onCounter(proposal) }, "Contra-propor"),
          h("button", { type: "button", className: "trade-btn-ghost is-danger", onClick: () => onDecline(proposal) }, "Recusar"))
          : mine ? h("button", { type: "button", className: "trade-btn-ghost is-danger", onClick: () => onCancel(proposal) }, "Cancelar proposta") : null));
  }

  // ---- central de trocas (seção do Mercado) ----
  function TradeCenter({ tournament, myTeam, teams, profiles, proposals, squadOf, playerOf, planFor, lockInfo, settings, deskRequest, onDeskRequestHandled, onPropose, onRespond, onOpenDetail, isAdmin }) {
    const T = Trade();
    const [tab, setTab] = React.useState("incoming");
    const [desk, setDesk] = React.useState(null);
    const [now, setNow] = React.useState(() => Date.now());
    React.useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(timer); }, []);
    React.useEffect(() => { if (deskRequest && myTeam) { setDesk({ toTeamId: deskRequest.toTeamId, give: [], get: deskRequest.get || [], cash: null }); if (onDeskRequestHandled) onDeskRequestHandled(); } }, [deskRequest]);
    const teamById = (id) => teams.find((team) => team && String(team.id) === String(id)) || null;
    const profileOf = (team) => (profiles || []).find((item) => team && String(item.id) === String(team.profileId)) || null;
    if (!myTeam) return h("div", { className: "trade-empty" }, isAdmin ? "Entre com um perfil que participa do campeonato para negociar." : "Você não tem um time neste campeonato.");
    if (!settings.enabled) return h("div", { className: "trade-empty" }, "As trocas estão desativadas neste campeonato.");

    const mineAll = proposals.filter((item) => item && [String(item.fromTeamId), String(item.toTeamId)].includes(String(myTeam.id))).sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0));
    const incoming = mineAll.filter((item) => String(item.toTeamId) === String(myTeam.id) && T.isOpen(item, now));
    const outgoing = mineAll.filter((item) => String(item.fromTeamId) === String(myTeam.id) && T.isOpen(item, now));
    const history = mineAll.filter((item) => !T.isOpen(item, now));
    const list = tab === "incoming" ? incoming : tab === "outgoing" ? outgoing : history;
    const empty = { incoming: "Nenhuma proposta esperando você.", outgoing: "Você não tem propostas em aberto.", history: "As trocas encerradas aparecem aqui." }[tab];

    function openCounter(proposal) {
      setDesk({ toTeamId: proposal.fromTeamId, give: proposal.get, get: proposal.give, cash: -proposal.cash, counterOf: proposal.id });
    }
    const tabBtn = (id, label, count) => h("button", { key: id, type: "button", role: "tab", "aria-selected": tab === id, className: "trade-tab" + (tab === id ? " is-active" : ""), onClick: () => setTab(id) }, label, count > 0 && h("span", { className: "trade-tab-badge" }, count));

    return h("div", { className: "trade-center" },
      h("div", { className: "trade-center-head" },
        h("div", null, h("h2", null, "Trocas"), h("p", null, `Até ${settings.maxPlayersPerSide} jogador${settings.maxPlayersPerSide === 1 ? "" : "es"} de cada lado · taxa de ${settings.feePct}% · propostas valem ${settings.expiryHours} h`)),
        h("button", { type: "button", className: "trade-btn-primary", onClick: () => setDesk({ toTeamId: null, give: [], get: [], cash: null }) }, "Nova troca")),
      h("div", { className: "trade-tabs", role: "tablist" }, tabBtn("incoming", "Recebidas", incoming.length), tabBtn("outgoing", "Enviadas", outgoing.length), tabBtn("history", "Histórico", 0)),
      h("div", { className: "trade-list" }, list.length === 0 ? h("div", { className: "trade-empty" }, empty) : list.map((proposal) => h(ProposalCard, {
        key: proposal.id, proposal, myTeamId: myTeam.id, teamById, profileOf, playerOf, planFor, now, onOpenDetail,
        onAccept: (item) => { if (window.confirm("Aceitar esta troca? Os jogadores e o troco mudam de time na hora.")) onRespond(item.id, "accept"); },
        onDecline: (item) => { if (window.confirm("Recusar esta proposta?")) onRespond(item.id, "decline"); },
        onCancel: (item) => { if (window.confirm("Cancelar a proposta enviada?")) onRespond(item.id, "cancel"); },
        onCounter: openCounter,
      }))),
      desk && h(TradeDesk, { key: desk.counterOf || "new", myTeam, teams, profiles, settings, squadOf, planFor, lockInfo, initial: desk, onSubmit: onPropose, onClose: () => setDesk(null), onOpenDetail }));
  }

  // ---- regras (admin) ----
  function TradeRulesForm({ settings, onSave }) {
    const S = App(), P = S.P, q = S.q, M = S.M, W = S.W;
    const init = { enabled: settings.enabled, max: String(settings.maxPlayersPerSide), fee: String(settings.feePct), hours: String(settings.expiryHours) };
    const [draft, setDraft] = React.useState(init);
    const [note, setNote] = React.useState("");
    const key = JSON.stringify(init);
    React.useEffect(() => { setDraft(init); }, [key]);
    const dirty = JSON.stringify(draft) !== key;
    const field = (label, name, hint) => h("div", null, h("label", { style: P }, label), h("input", { style: q, type: "number", min: 0, value: draft[name], onChange: (event) => { setDraft({ ...draft, [name]: event.target.value }); setNote(""); } }), hint && h("div", { style: { fontSize: 11, color: "var(--muted)", marginTop: 4 } }, hint));
    function save() {
      const max = Math.min(10, Math.max(1, Math.round(Number(draft.max) || 3))), fee = Math.min(50, Math.max(0, Number(draft.fee) || 0)), hours = Math.min(336, Math.max(1, Math.round(Number(draft.hours) || 48)));
      setDraft({ enabled: draft.enabled, max: String(max), fee: String(fee), hours: String(hours) });
      setNote("Regras de troca salvas.");
      onSave({ enabled: draft.enabled, maxPlayersPerSide: max, feePct: fee, expiryHours: hours });
    }
    return h("div", null,
      h("label", { style: { display: "flex", alignItems: "center", gap: 10, fontWeight: 800, marginBottom: 14 } }, h("input", { type: "checkbox", checked: draft.enabled, onChange: (event) => { setDraft({ ...draft, enabled: event.target.checked }); setNote(""); } }), "Trocas entre participantes ativas"),
      h("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12 } },
        field("Máx. de jogadores por lado", "max", "1 a 10"), field("Taxa do banco (%)", "fee", "% do maior lado, dividida entre os dois"), field("Validade (horas)", "hours", "depois disso a proposta expira")),
      h("button", { type: "button", disabled: !dirty, onClick: save, style: { ...M, ...W, marginTop: 14, opacity: dirty ? 1 : .5 } }, dirty ? "Salvar regras de troca" : "Sem alterações"),
      note && h("div", { style: { fontSize: 12, color: "var(--muted)", marginTop: 8 } }, note));
  }

  window.ManchaApp.TradeCenter = TradeCenter;
  window.ManchaApp.TradeRulesForm = TradeRulesForm;
})();
