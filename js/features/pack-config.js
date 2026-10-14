(() => {
  window.ManchaApp = window.ManchaApp || {};
  const h = React.createElement;

  const num = (value) => { const parsed = Number(String(value == null ? "" : value).replace(",", ".")); return Number.isFinite(parsed) ? parsed : 0; };
  const fmt = (value, digits = 1) => Number(value).toFixed(digits).replace(".", ",");
  // Mostra até 4 casas (a mesma precisão em que o servidor guarda), sem zeros à direita: 0,0025 continua 0,0025.
  const pctText = (value) => { const rounded = Math.round(Number(value) * 10000) / 10000; return rounded > 0 ? String(rounded).replace(".", ",") : ""; };

  // Rascunhos sobrevivem a trocar de aba dentro do app (somem ao recarregar a página).
  const DRAFTS = new Map();

  // Tag de versão carregada pela página (a mesma ?v= do index.html), para conferir se o navegador está com o código novo.
  function buildTag() {
    try {
      const el = document.querySelector('script[src*="pack-config.js"]');
      const match = el && /[?&]v=([^&]+)/.exec(el.getAttribute("src"));
      return match ? match[1] : "desconhecida";
    } catch (error) { return "desconhecida"; }
  }

  function overallRange(pool, packs) {
    const keys = [...pool.keys()];
    (packs || []).forEach((pack) => Object.keys(pack.weights || {}).forEach((key) => keys.push(Number(key))));
    const valid = keys.filter((value) => Number.isFinite(value) && value > 0);
    if (!valid.length) return [];
    const low = Math.min(...valid), high = Math.max(...valid), list = [];
    for (let overall = low; overall <= high; overall++) list.push(overall);
    return list;
  }

  function toDraft(settings, range) {
    return {
      isOpen: settings.isOpen,
      unlocksEnabled: settings.unlocksEnabled,
      suspense: settings.suspense,
      cardsPerPack: String(settings.cardsPerPack),
      sellDepreciationPct: String(settings.sellDepreciationPct),
      packs: settings.packs.map((pack) => {
        const percents = window.ManchaApp.PacksFeature.percentWeights(pack.weights);
        const weights = {};
        range.forEach((overall) => { weights[overall] = pctText(percents[String(overall)] || 0); });
        return {
          id: pack.id, label: pack.label, enabled: pack.enabled, price: String(pack.price), cards: String(pack.cards), interaction: pack.interaction,
          unlock: pack.unlock ? { packId: pack.unlock.packId, count: String(pack.unlock.count) } : null,
          weights,
        };
      }),
    };
  }

  function PackConfigEditor({ tournament, catalog, ownership, profiles = [], profile, onSave, readOnly = false, isAdmin = false }) {
    const App = window.ManchaApp, Packs = App.PacksFeature, E = App.E;
    const settings = React.useMemo(() => Packs.packSettingsOf(tournament), [tournament]);
    const pool = React.useMemo(() => Packs.poolStats(catalog, ownership), [catalog, ownership]);
    const range = React.useMemo(() => overallRange(pool, settings.packs), [pool, settings.packs]);
    const raw = (tournament && tournament.packSettings) || {};
    const remoteKey = JSON.stringify(raw);
    const remoteUpdatedAt = Number(raw.updatedAt) || 0;
    const tournamentId = tournament && tournament.id ? String(tournament.id) : "";

    const stored = DRAFTS.get(tournamentId);
    const [draft, setDraft] = React.useState(() => (stored ? stored.draft : toDraft(settings, range)));
    const [baseJson, setBaseJson] = React.useState(() => (stored ? stored.baseJson : JSON.stringify(toDraft(settings, range))));
    const baseUpdatedAt = React.useRef(stored ? stored.baseUpdatedAt : remoteUpdatedAt);
    const lastRemoteKey = React.useRef(stored ? stored.remoteKey : remoteKey);
    const [selected, setSelected] = React.useState(settings.packs[0] ? settings.packs[0].id : "");
    const [openBands, setOpenBands] = React.useState({});
    const [message, setMessage] = React.useState(null);
    const [saving, setSaving] = React.useState(false);
    const [remoteChanged, setRemoteChanged] = React.useState(false);
    const [curve, setCurve] = React.useState({ mu: "78", sigma: "4", tail: "0" });
    const [bandPercents, setBandPercents] = React.useState(["", "", "", "", "", ""]);
    const [bandMode, setBandMode] = React.useState("overall");
    const [copyFrom, setCopyFrom] = React.useState("");
    const [opened, setOpened] = React.useState(0);

    const dirty = JSON.stringify(draft) !== baseJson;
    React.useEffect(() => {
      if (dirty) DRAFTS.set(tournamentId, { draft, baseJson, baseUpdatedAt: baseUpdatedAt.current, remoteKey: lastRemoteKey.current });
      else DRAFTS.delete(tournamentId);
    }, [draft, baseJson, dirty, tournamentId]);

    // Alguém salvou enquanto eu estava aqui.
    React.useEffect(() => {
      if (remoteKey === lastRemoteKey.current) return;
      lastRemoteKey.current = remoteKey;
      if (!dirty) {
        const next = toDraft(settings, range);
        setDraft(next); setBaseJson(JSON.stringify(next)); baseUpdatedAt.current = remoteUpdatedAt;
      } else setRemoteChanged(true);
    }, [remoteKey]);

    React.useEffect(() => {
      let alive = true;
      if (typeof App.loadPackStats === "function" && tournamentId) {
        App.loadPackStats({ tournamentId }).then((stats) => { if (alive) setOpened(Object.values(stats.counts || {}).reduce((a, b) => a + b, 0)); }).catch(() => {});
      }
      return () => { alive = false; };
    }, [tournamentId]);

    const pack = draft.packs.find((item) => item.id === selected) || draft.packs[0];
    if (!pack) return h("div", { style: { ...E, padding: 24, textAlign: "center", color: "var(--muted)" } }, "Este campeonato ainda não tem pacotes configurados.");

    const baseDraft = JSON.parse(baseJson);
    const baseOf = (id) => baseDraft.packs.find((item) => item.id === id);
    const packDirty = (item) => JSON.stringify(item) !== JSON.stringify(baseOf(item.id));
    const disabled = readOnly || saving;

    const patchPack = (patch) => setDraft((current) => ({ ...current, packs: current.packs.map((item) => item.id === pack.id ? { ...item, ...patch } : item) }));
    const setWeight = (overall, value) => { patchPack({ weights: { ...pack.weights, [overall]: value } }); setMessage(null); };
    const weightsNumbers = () => { const out = {}; range.forEach((o) => { const v = num(pack.weights[o]); if (v > 0) out[o] = v; }); return out; };
    const typedTotal = Object.values(weightsNumbers()).reduce((a, b) => a + b, 0);
    const replaceWeights = (percentMap) => { const next = {}; range.forEach((o) => { next[o] = pctText(percentMap[String(o)] || 0); }); patchPack({ weights: next }); setMessage(null); };

    const analysis = Packs.analyzeWeights({
      weights: weightsNumbers(), pool, cards: pack.interaction === "pick" ? 1 : (Math.round(num(draft.cardsPerPack)) || 1), price: num(pack.price),
      sellPct: num(draft.sellDepreciationPct), elite: settings.eliteThreshold,
    });
    const maxTyped = Math.max(1, ...Object.values(weightsNumbers()));

    function normalize() {
      if (!(typedTotal > 0)) return;
      const scaled = {}; Object.entries(weightsNumbers()).forEach(([o, v]) => { scaled[o] = (v / typedTotal) * 100; });
      replaceWeights(scaled);
    }
    function applyCurve() {
      const mu = num(curve.mu), sigma = Math.max(0.1, num(curve.sigma)), tail = Math.max(0, num(curve.tail));
      replaceWeights(Packs.percentWeights(Packs.gaussianWeights(mu, sigma, tail)));
    }
    function applyBands() {
      const total = bandPercents.reduce((sum, v) => sum + Math.max(0, num(v)), 0);
      if (!(total > 0)) { setMessage({ kind: "error", text: "Preencha a porcentagem de pelo menos uma faixa." }); return; }
      replaceWeights(Packs.percentWeights(Packs.distributeBands(bandPercents.map(num), pool, bandMode)));
    }
    function copyWeights() {
      const source = draft.packs.find((item) => item.id === copyFrom);
      if (!source) return;
      const next = {}; range.forEach((o) => { next[o] = source.weights[o] || ""; });
      patchPack({ weights: next }); setMessage(null);
    }
    // Preenche o rascunho de todos os pacotes com a tabela "Opção B" (valores exatos, sem arredondar). Só vale depois de Salvar.
    function applyOptionB() {
      if (!window.confirm("Preencher as chances de TODOS os pacotes com a tabela Opção B? Os valores atuais do rascunho serão substituídos (só valem depois de Salvar).")) return;
      const exact = (value) => (value > 0 ? String(value).replace(".", ",") : "");
      setDraft((current) => ({ ...current, packs: current.packs.map((item) => {
        const table = Packs.optionBWeights(item.id);
        if (!table) return item;
        const next = {}; range.forEach((o) => { next[o] = exact(Number(table[String(o)]) || 0); });
        return { ...item, weights: next };
      }) }));
      setMessage(null);
    }
    function restoreDefault() {
      if (!window.confirm(`Restaurar as chances padrão do pacote ${pack.label}?`)) return;
      replaceWeights(Packs.presetWeights(pack.id));
    }

    function buildSettings() {
      const errors = [];
      const sell = num(draft.sellDepreciationPct);
      if (sell < 0 || sell > 100) errors.push("A taxa de venda precisa estar entre 0 e 100%.");
      // A quantidade de cartas é global: o mesmo valor vale para todos os pacotes.
      const cardsPerPack = Math.round(num(draft.cardsPerPack));
      if (!(cardsPerPack >= 1 && cardsPerPack <= 10)) errors.push("A quantidade de cartas por pacote precisa estar entre 1 e 10.");
      const ids = new Set(draft.packs.map((item) => item.id));
      const packs = draft.packs.map((item) => {
        const price = num(item.price), cards = cardsPerPack;
        if (!(price > 0)) errors.push(`${item.label}: o preço precisa ser maior que 0.`);
        const typed = {}; range.forEach((o) => { const v = num(item.weights[o]); if (v > 0) typed[o] = v; });
        const total = Object.values(typed).reduce((a, b) => a + b, 0);
        if (item.enabled && !(total > 0)) errors.push(`${item.label}: defina chances em pelo menos um overall (ou desative o pacote).`);
        const weights = {}; Object.entries(typed).forEach(([o, v]) => { weights[o] = Math.round((v / total) * 100 * 10000) / 10000; });
        let unlock = null;
        if (item.unlock && item.unlock.packId) {
          const count = Math.round(num(item.unlock.count));
          if (item.unlock.packId === item.id || !ids.has(item.unlock.packId)) errors.push(`${item.label}: o marco precisa apontar para outro pacote.`);
          else if (count < 1) errors.push(`${item.label}: o marco precisa de pelo menos 1 pacote.`);
          else unlock = { packId: item.unlock.packId, count };
        }
        if (item.interaction === "pick" && cards < 2) errors.push(`${item.label}: para escolher uma carta, o pacote precisa ter pelo menos 2 cartas.`);
        return { id: item.id, label: item.label, enabled: item.enabled, price, cards, interaction: item.interaction === "pick" ? "pick" : "all", weights, unlock };
      });
      // rosterMax é legado: o limite do elenco é o do campeonato (rosterSettings).
      const { rosterMax: legacyRosterMax, ...rawWithoutLegacy } = raw;
      return { errors, next: { ...rawWithoutLegacy, version: 1, isOpen: draft.isOpen, unlocksEnabled: draft.unlocksEnabled, suspense: draft.suspense !== false, cardsPerPack, sellDepreciationPct: sell, packs } };
    }

    async function save() {
      if (disabled || !dirty) return;
      const { errors, next } = buildSettings();
      if (errors.length) { setMessage({ kind: "error", text: errors.join(" ") }); return; }
      if (remoteUpdatedAt !== baseUpdatedAt.current || remoteChanged) {
        if (!window.confirm("Outra pessoa alterou as configurações dos pacotes enquanto você editava. Salvar agora vai sobrescrever a versão dela. Continuar?")) return;
      }
      setSaving(true);
      try {
        const result = await onSave(next);
        if (result === false || (result && result.committed === false)) throw new Error("not_committed");
        const reloaded = toDraft(Packs.packSettingsOf({ packSettings: next, rosterSettings: tournament.rosterSettings }), range);
        setDraft(reloaded); setBaseJson(JSON.stringify(reloaded)); setRemoteChanged(false);
        baseUpdatedAt.current = Number(next.updatedAt) || remoteUpdatedAt;
        DRAFTS.delete(tournamentId);
        setMessage({ kind: "ok", text: "Configurações salvas. Valem para as próximas aberturas." });
      } catch (error) {
        console.error("pack settings save failed", error);
        setMessage({ kind: "error", text: "Não foi possível salvar. Tente novamente." });
      } finally { setSaving(false); }
    }
    function discard() {
      if (!dirty || !window.confirm("Descartar as alterações não salvas?")) return;
      const next = JSON.parse(baseJson); setDraft(next); setMessage(null); DRAFTS.delete(tournamentId);
    }
    function loadRemote() {
      if (!window.confirm("Carregar a versão salva por outra pessoa? Suas edições não salvas serão perdidas.")) return;
      const next = toDraft(settings, range);
      setDraft(next); setBaseJson(JSON.stringify(next)); baseUpdatedAt.current = remoteUpdatedAt; setRemoteChanged(false); DRAFTS.delete(tournamentId);
    }

    const updatedBy = (profiles || []).find((item) => item && String(item.id) === String(raw.updatedByProfileId));
    const input = (value, onChange, extra = {}) => h("input", { className: "pack-cfg-input", inputMode: "decimal", value, disabled, onChange: (event) => { onChange(event.target.value); setMessage(null); }, ...extra });

    function bandSection(band, bandIndex) {
      const overalls = range.filter((o) => o >= band[0] && o <= band[1]);
      if (!overalls.length) return null;
      const bandTotal = overalls.reduce((sum, o) => sum + num(pack.weights[o]), 0);
      const open = openBands[bandIndex] != null ? openBands[bandIndex] : bandTotal > 0;
      const title = band[1] >= 99 ? `${band[0]}+` : `${band[0]}–${band[1]}`;
      return h("section", { key: bandIndex, className: "pack-cfg-band" },
        h("button", { type: "button", className: "tapbtn pack-cfg-band-head", onClick: () => setOpenBands({ ...openBands, [bandIndex]: !open }) },
          h("span", null, `${open ? "▾" : "▸"} ${title}`),
          h("span", { className: "pack-cfg-band-total" }, `${fmt(bandTotal, 1)}%`)),
        open && overalls.map((o) => {
          const stat = pool.get(o), width = Math.round((num(pack.weights[o]) / maxTyped) * 100);
          const note = !stat ? "sem jogadores" : stat.n === 0 ? `0 livres de ${stat.total}` : `${stat.n} livres de ${stat.total}`;
          return h("div", { key: o, className: "pack-cfg-row" + (!stat || stat.n === 0 ? " is-dim" : "") },
            h("span", { className: "pack-cfg-ovr" }, o),
            h("span", { className: "pack-cfg-bar" }, h("span", { style: { width: `${width}%` } })),
            input(pack.weights[o], (value) => setWeight(o, value), { placeholder: "0", "aria-label": `Chance do overall ${o}` }),
            h("span", { className: "pack-cfg-unit" }, "%"),
            h("small", { className: "pack-cfg-free" }, note));
        }));
    }

    const totalOk = Math.abs(typedTotal - 100) < 0.01;
    return h("div", { className: "pack-cfg" },
      h("div", { className: "pack-cfg-meta" },
        h("div", { className: "pack-cfg-build" }, `Versão do app: ${buildTag()}`),
        raw.updatedAt ? `Última alteração: ${(updatedBy && updatedBy.name) || "alguém"} em ${new Date(Number(raw.updatedAt)).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}` : "Ainda não houve alterações manuais.",
        opened > 0 && h("div", { className: "pack-cfg-warn" }, `${opened} pacote${opened > 1 ? "s" : ""} já ${opened > 1 ? "foram abertos" : "foi aberto"} neste campeonato: mudar as chances afeta quem ainda vai abrir.`)),
      remoteChanged && h("div", { className: "pack-cfg-warn", role: "alert" }, "Outra pessoa salvou novas configurações enquanto você editava. ",
        h("button", { className: "tapbtn pack-cfg-link", onClick: loadRemote }, "Carregar a versão dela")),
      readOnly && h("div", { className: "pack-cfg-warn" }, "O campeonato foi encerrado: as configurações estão somente para leitura."),

      isAdmin && h("div", { className: "pack-cfg-card pack-cfg-general" },
        isAdmin && h("label", { className: "pack-cfg-check" }, h("input", { type: "checkbox", checked: draft.isOpen, disabled, onChange: (e) => { setDraft({ ...draft, isOpen: e.target.checked }); setMessage(null); } }), " Loja aberta"),
        isAdmin && h("label", { className: "pack-cfg-check" }, h("input", { type: "checkbox", checked: draft.unlocksEnabled, disabled, onChange: (e) => { setDraft({ ...draft, unlocksEnabled: e.target.checked }); setMessage(null); } }), " Exigir marcos de desbloqueio"),
        isAdmin && h("label", { className: "pack-cfg-check" }, h("input", { type: "checkbox", checked: draft.suspense !== false, disabled, onChange: (e) => { setDraft({ ...draft, suspense: e.target.checked }); setMessage(null); } }), " Revelação com suspense (posição, nacionalidade e clube antes do nome)"),
        isAdmin && h("label", { className: "pack-cfg-field" }, h("span", null, "Taxa na venda de volta (%)"), input(draft.sellDepreciationPct, (value) => setDraft({ ...draft, sellDepreciationPct: value }), { style: { width: 90 } }))),
        isAdmin && h("button", { type: "button", className: "tapbtn pack-ghost-btn", disabled, onClick: applyOptionB }, "Preencher chances (tabela Opção B)"),
        isAdmin && h("label", { className: "pack-cfg-field" }, h("span", null, "Cartas por pacote (todos os pacotes)"), input(draft.cardsPerPack, (value) => { setDraft({ ...draft, cardsPerPack: value }); setMessage(null); }, { style: { width: 90 } })),

      h("div", { className: "pack-cfg-tabs", role: "tablist" }, draft.packs.map((item) =>
        h("button", { key: item.id, role: "tab", "aria-selected": item.id === pack.id, className: "tapbtn pack-cfg-tab" + (item.id === pack.id ? " is-active" : ""), onClick: () => setSelected(item.id) },
          item.label, packDirty(item) && h("span", { className: "pack-cfg-dot", title: "Alterações não salvas" })))),

      h("div", { className: "pack-cfg-card" },
        h("label", { className: "pack-cfg-check" }, h("input", { type: "checkbox", checked: pack.enabled, disabled, onChange: (e) => { patchPack({ enabled: e.target.checked }); setMessage(null); } }), ` Pacote ${pack.label} ativo`),
        h("div", { className: "pack-cfg-fields" },
          h("label", { className: "pack-cfg-field" }, h("span", null, "Preço (M)"), input(pack.price, (value) => patchPack({ price: value }))),
          isAdmin && h("label", { className: "pack-cfg-field" }, h("span", null, "Como abrir"),
            h("select", { className: "pack-cfg-input", disabled, value: pack.interaction === "pick" ? "pick" : "all", onChange: (e) => { patchPack({ interaction: e.target.value }); setMessage(null); } },
              h("option", { value: "all" }, "Fica com todas as cartas"),
              h("option", { value: "pick" }, "Escolhe 1 carta (as outras só são reveladas)"))),
          isAdmin && h("label", { className: "pack-cfg-field" }, h("span", null, "Marco de desbloqueio"),
            h("select", { className: "pack-cfg-input", disabled, value: pack.unlock ? pack.unlock.packId : "", onChange: (e) => { patchPack({ unlock: e.target.value ? { packId: e.target.value, count: pack.unlock ? pack.unlock.count : "50" } : null }); setMessage(null); } },
              h("option", { value: "" }, "Sem marco"),
              draft.packs.slice(0, draft.packs.findIndex((item) => item.id === pack.id)).map((item) => h("option", { key: item.id, value: item.id }, `Após abrir pacotes ${item.label}`)))),
          isAdmin && pack.unlock && h("label", { className: "pack-cfg-field" }, h("span", null, "Quantidade"), input(pack.unlock.count, (value) => patchPack({ unlock: { ...pack.unlock, count: value } }))))),

      h("div", { className: "pack-cfg-card pack-cfg-summary" },
        analysis.valid ? h(React.Fragment, null,
          h("div", { className: "pack-cfg-stats" },
            h("div", null, h("small", null, "OVR médio"), h("strong", null, fmt(analysis.meanOverall, 1))),
            h("div", null, h("small", null, "Valor esperado"), h("strong", null, `${fmt(analysis.evPack, 0)}M`)),
            h("div", null, h("small", null, `Chance de ${settings.eliteThreshold}+`), h("strong", null, `${fmt(analysis.pEliteCard * 100, 1)}%`), h("em", null, `${fmt(analysis.pEliteAtLeastOne * 100, 1)}% no pacote`)),
            h("div", null, h("small", null, "Venda de volta"), h("strong", null, `${fmt(analysis.sellEv, 0)}M`)),
            h("div", null, h("small", null, "Custo líquido"), h("strong", { className: analysis.net >= 0 ? "" : "is-bad" }, `${fmt(analysis.net, 0)}M`))),
          analysis.net < 0 && h("div", { className: "pack-cfg-warn" }, "Custo líquido negativo: abrir e vender tudo de volta dá lucro. Isso gera dinheiro infinito."),
          analysis.unavailableShare > 0.0001 && h("div", { className: "pack-cfg-note" }, `${fmt(analysis.unavailableShare * 100, 0)}% das chances estão em overalls sem jogador livre e são redistribuídas entre os demais.`))
          : h("div", { className: "pack-cfg-warn" }, "Nenhum overall com chance e jogador livre: este pacote não consegue abrir.")),

      h("details", { className: "pack-cfg-card pack-cfg-tools" },
        h("summary", null, "Atalhos para preencher as chances"),
        h("div", { className: "pack-cfg-tool" }, h("strong", null, "Curva"),
          h("div", { className: "pack-cfg-fields" },
            h("label", { className: "pack-cfg-field" }, h("span", null, "Centro (overall)"), input(curve.mu, (value) => setCurve({ ...curve, mu: value }))),
            h("label", { className: "pack-cfg-field" }, h("span", null, "Largura"), input(curve.sigma, (value) => setCurve({ ...curve, sigma: value }))),
            h("label", { className: "pack-cfg-field" }, h("span", null, "Cauda"), input(curve.tail, (value) => setCurve({ ...curve, tail: value })))),
          h("button", { className: "tapbtn pack-ghost-btn", disabled, onClick: applyCurve }, "Aplicar curva")),
        h("div", { className: "pack-cfg-tool" }, h("strong", null, "Por faixas"),
          h("div", { className: "pack-cfg-fields" }, Packs.OVERALL_BANDS.map((band, index) =>
            h("label", { key: index, className: "pack-cfg-field" }, h("span", null, band[1] >= 99 ? `${band[0]}+ (%)` : `${band[0]}–${band[1]} (%)`),
              input(bandPercents[index], (value) => setBandPercents(bandPercents.map((item, i) => i === index ? value : item)))))),
          h("div", { className: "pack-cfg-radios" },
            h("label", null, h("input", { type: "radio", checked: bandMode === "overall", onChange: () => setBandMode("overall") }), " Igual por overall"),
            h("label", null, h("input", { type: "radio", checked: bandMode === "player", onChange: () => setBandMode("player") }), " Igual por jogador")),
          h("button", { className: "tapbtn pack-ghost-btn", disabled, onClick: applyBands }, "Aplicar faixas")),
        h("div", { className: "pack-cfg-tool" }, h("strong", null, "Copiar de outro pacote"),
          h("div", { className: "pack-cfg-fields" },
            h("select", { className: "pack-cfg-input", disabled, value: copyFrom, onChange: (e) => setCopyFrom(e.target.value) },
              h("option", { value: "" }, "Escolha o pacote"),
              draft.packs.filter((item) => item.id !== pack.id).map((item) => h("option", { key: item.id, value: item.id }, item.label)))),
          h("button", { className: "tapbtn pack-ghost-btn", disabled: disabled || !copyFrom, onClick: copyWeights }, "Copiar chances")),
        h("div", { className: "pack-cfg-tool" }, h("button", { className: "tapbtn pack-ghost-btn", disabled, onClick: restoreDefault }, "Restaurar chances padrão deste pacote"))),

      h("div", { className: "pack-cfg-card" },
        h("div", { className: "pack-cfg-total" + (totalOk ? " is-ok" : "") },
          h("strong", null, `Total: ${fmt(typedTotal, 1)}%`),
          !totalOk && h("button", { className: "tapbtn pack-ghost-btn", disabled: disabled || !(typedTotal > 0), onClick: normalize }, "Normalizar para 100%")),
        h("div", { className: "pack-cfg-help" }, "Digite a chance de cada overall. O total não precisa fechar 100%: ao salvar o app normaliza. Overalls sem jogador livre ficam apagados e suas chances são redistribuídas."),
        Packs.OVERALL_BANDS.map(bandSection)),

      message && h("div", { className: message.kind === "error" ? "pack-store-error" : "pack-store-notice", role: "alert" }, message.text),
      !readOnly && h("div", { className: "pack-cfg-actions" },
        h("button", { className: "tapbtn pack-open-btn", disabled: !dirty || saving, onClick: save }, saving ? "Salvando…" : dirty ? "Salvar configurações" : "Sem alterações"),
        h("button", { className: "tapbtn pack-ghost-btn", disabled: !dirty || saving, onClick: discard }, "Descartar")));
  }

  window.ManchaApp.PackConfigEditor = PackConfigEditor;
})();
