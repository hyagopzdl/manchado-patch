(() => {
  window.ManchaApp = window.ManchaApp || {};
  const h = React.createElement;

  // Habilidades especiais (as 23 do jogo). As bases antigas não têm o campo `abilities` e nada aparece para elas.
  const GROUPS = [
    { id: "attack", label: "Ataque", color: "#d92d20" },
    { id: "creation", label: "Criação", color: "#4a7fc1" },
    { id: "defense", label: "Defesa", color: "#1f9d55" },
    { id: "keeper", label: "Goleiro", color: "#d6a600" },
  ];
  const ABILITIES = {
    scoring: { label: "Finalização", group: "attack", desc: "Mais frieza e precisão para marcar gols." },
    oneOnOneScoring: { label: "Finalização 1x1", group: "attack", desc: "Mais eficiente quando fica cara a cara com o goleiro." },
    postPlayer: { label: "Pivô", group: "attack", desc: "Segura a bola de costas para o gol e serve os companheiros." },
    lines: { label: "Linhas", group: "attack", desc: "Aproveita as linhas de passe e infiltra entre os defensores." },
    middleShooting: { label: "Chute de média distância", group: "attack", desc: "Mais perigoso nos chutes de fora da área." },
    penalties: { label: "Pênaltis", group: "attack", desc: "Especialista na cobrança de pênaltis." },
    positioning: { label: "Posicionamento", group: "attack", desc: "Aparece bem posicionado, sem a bola, nos momentos certos." },
    reaction: { label: "Reação", group: "attack", desc: "Reage rápido a rebotes e bolas soltas." },
    dribbling: { label: "Drible", group: "creation", desc: "Mantém a bola colada ao pé e passa pelo marcador com mais facilidade." },
    tacticalDribble: { label: "Drible tático", group: "creation", desc: "Protege e gira com a bola sob pressão com mais eficiência." },
    playmaking: { label: "Armação", group: "creation", desc: "Cria jogadas e acha companheiros com passes que quebram a defesa." },
    passing: { label: "Passe", group: "creation", desc: "Passes mais precisos e com menos erros." },
    oneTouchPass: { label: "Passe de primeira", group: "creation", desc: "Toca de primeira com precisão." },
    outside: { label: "Curva por fora", group: "creation", desc: "Faz passes e chutes de curva com a parte de fora do pé." },
    side: { label: "Pelos lados", group: "creation", desc: "Rende melhor jogando pelas laterais do campo." },
    center: { label: "Pelo centro", group: "creation", desc: "Rende melhor jogando pelo meio do campo." },
    longThrow: { label: "Arremesso longo", group: "creation", desc: "Lança a bola longe nos arremessos laterais." },
    marking: { label: "Marcação", group: "defense", desc: "Marca o atacante de perto e dificulta o giro." },
    slidingTackle: { label: "Carrinho", group: "defense", desc: "Desarma com precisão no carrinho." },
    covering: { label: "Cobertura", group: "defense", desc: "Fecha espaços e cobre os companheiros na defesa." },
    dLineControl: { label: "Controle da linha defensiva", group: "defense", desc: "Organiza a linha de defesa e a armadilha de impedimento." },
    penaltyStopper: { label: "Pegador de pênaltis", group: "keeper", desc: "Defende pênaltis com mais facilidade." },
    oneOnOneStopper: { label: "Defesa 1x1", group: "keeper", desc: "Fecha o ângulo e defende bem lances de um contra um." },
  };
  const INJURY = { A: "Alta", B: "Média", C: "Baixa" };

  const ICONS = {
    attack: [["circle", { cx: 12, cy: 12, r: 8 }], ["circle", { cx: 12, cy: 12, r: 3.5 }], ["path", { d: "M12 2v3M12 19v3M2 12h3M19 12h3" }]],
    creation: [["path", { d: "M4 18c4-1 6-5 8-12" }], ["path", { d: "M12 6l-2.5 3.5M12 6l3 2.5" }], ["path", { d: "M20 6c-2 6-6 10-12 12" }]],
    defense: [["path", { d: "M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z" }]],
    keeper: [["path", { d: "M8 20v-7a2 2 0 014 0V5a2 2 0 014 0v8" }], ["path", { d: "M16 13v-1a2 2 0 014 0v5c0 2-2 3-4 3H9a4 4 0 01-4-4v-3a2 2 0 014 0" }]],
  };
  function groupIcon(group, size) {
    return h("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true" },
      (ICONS[group] || []).map(([tag, attrs], index) => h(tag, { key: index, ...attrs })));
  }

  // Posições: a 1ª de `positions` é a principal; o resto é secundária. Bases antigas só têm `position`.
  function secondaryPositions(player) {
    const main = player && player.position;
    return (Array.isArray(player && player.positions) ? player.positions : []).filter((position, index, list) => position && position !== main && list.indexOf(position) === index);
  }

  function PlayerAbilities({ player }) {
    const [showAll, setShowAll] = React.useState(false);
    const [openKey, setOpenKey] = React.useState(null);
    if (!player || !Array.isArray(player.abilities)) return null;
    const owned = new Set(player.abilities.filter((key) => ABILITIES[key]));
    const total = Object.keys(ABILITIES).length;
    const injury = player.injuryTolerance && INJURY[player.injuryTolerance] ? `${INJURY[player.injuryTolerance]} (${player.injuryTolerance})` : null;

    function tile(key) {
      const info = ABILITIES[key], group = GROUPS.find((item) => item.id === info.group), active = owned.has(key), open = openKey === key;
      return h("button", {
        key, type: "button", className: "ability-tile" + (active ? " is-active" : " is-off") + (open ? " is-open" : ""), style: { "--ability-color": group.color },
        "aria-expanded": open, onClick: () => setOpenKey(open ? null : key),
      },
        h("span", { className: "ability-icon" }, groupIcon(info.group, 18)),
        h("span", { className: "ability-text" }, h("strong", null, info.label), h("small", null, active ? group.label : `${group.label} · não tem`)),
        active && h("span", { className: "ability-check", "aria-hidden": "true" }, "✓"),
        open && h("span", { className: "ability-desc" }, info.desc));
    }

    const body = showAll
      ? GROUPS.map((group) => h("div", { key: group.id, className: "ability-group" },
        h("div", { className: "ability-group-title", style: { "--ability-color": group.color } }, groupIcon(group.id, 14), h("span", null, group.label),
          h("em", null, `${Object.keys(ABILITIES).filter((key) => ABILITIES[key].group === group.id && owned.has(key)).length}/${Object.keys(ABILITIES).filter((key) => ABILITIES[key].group === group.id).length}`)),
        h("div", { className: "ability-grid" }, Object.keys(ABILITIES).filter((key) => ABILITIES[key].group === group.id).map(tile))))
      : (owned.size
        ? h("div", { className: "ability-grid" }, Object.keys(ABILITIES).filter((key) => owned.has(key)).map(tile))
        : h("div", { className: "ability-empty" }, "Este jogador não tem habilidades especiais."));

    return h("section", { className: "ability-card" },
      h("div", { className: "ability-head" },
        h("div", null, h("strong", null, "Habilidades especiais"), h("span", { className: "ability-count" }, `${owned.size} de ${total}`)),
        h("button", { type: "button", className: "ability-toggle", onClick: () => { setShowAll(!showAll); setOpenKey(null); } }, showAll ? "Só as dele" : "Ver todas")),
      injury && h("div", { className: "ability-injury" }, h("span", null, "Resistência a lesões"), h("b", null, injury)),
      body);
  }

  window.ManchaApp.PlayerAbilities = PlayerAbilities;
  window.ManchaApp.PlayerExtras = { ABILITIES, GROUPS, secondaryPositions };
})();
