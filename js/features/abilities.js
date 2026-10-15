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

  // Cartão com duas faces: frente = atributos (conteúdo recebido), verso = habilidades especiais. Tocar gira o cartão.
  // Bases antigas não têm `abilities`: nesse caso só a frente é exibida, sem giro.
  function PlayerFlipCard({ player, front }) {
    const [flipped, setFlipped] = React.useState(false);
    if (!player || !Array.isArray(player.abilities)) return front;
    const surface = window.ManchaApp.E || {};
    const owned = new Set(player.abilities.filter((key) => ABILITIES[key]));
    const keys = Object.keys(ABILITIES);
    const order = (key) => (owned.has(key) ? 0 : 1) * 100 + GROUPS.findIndex((group) => group.id === ABILITIES[key].group);
    const sorted = keys.slice().sort((a, b) => order(a) - order(b));
    const injury = player.injuryTolerance && INJURY[player.injuryTolerance] ? `${INJURY[player.injuryTolerance]} (${player.injuryTolerance})` : null;
    const toggle = () => setFlipped((value) => !value);

    const row = (key) => {
      const info = ABILITIES[key], group = GROUPS.find((item) => item.id === info.group), active = owned.has(key);
      return h("div", { key, className: "ability-row" + (active ? "" : " is-off"), style: { "--ability-color": group.color }, title: `${info.label}: ${info.desc}` },
        h("span", { className: "ability-row-label" }, h("span", { className: "ability-icon" }, groupIcon(info.group, 16)), h("span", null, info.label)),
        h("span", { className: "ability-star", "aria-label": active ? "Possui" : "Não possui" }, active ? "★" : "☆"));
    };
    const back = h("section", { className: "flip-face flip-back", style: { ...surface, padding: "8px 16px 10px" } },
      h("div", { className: "ability-back-head" },
        h("strong", null, "Habilidades especiais"),
        h("span", { className: "ability-count" }, `${owned.size} de ${keys.length}`)),
      injury && h("div", { className: "ability-injury" }, h("span", null, "Resistência a lesões"), h("b", null, injury)),
      sorted.map(row),
      h("div", { className: "flip-hint" }, "Toque para voltar aos atributos"));
    return h("div", { className: "flip-card" + (flipped ? " is-flipped" : ""), role: "button", tabIndex: 0, "aria-pressed": flipped,
      "aria-label": flipped ? "Voltar aos atributos" : "Ver habilidades especiais", onClick: toggle,
      onKeyDown: (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggle(); } } },
      h("div", { className: "flip-inner" },
        h("div", { className: "flip-face flip-front" }, front, h("div", { className: "flip-hint" }, `Toque para ver as habilidades especiais · ${owned.size} de ${keys.length}`)),
        back));
  }

  window.ManchaApp.PlayerFlipCard = PlayerFlipCard;
  window.ManchaApp.PlayerExtras = { ABILITIES, GROUPS, secondaryPositions };
})();
