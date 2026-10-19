(() => {
  window.ManchaApp = window.ManchaApp || {};
  const h = React.createElement;
  const App = window.ManchaApp;

  const ERRORS = {
    not_admin: "Apenas o administrador pode dar pacotes.",
    pack_not_found: "Esse pacote não existe neste campeonato.",
    team_not_found: "Um dos times não faz parte deste campeonato.",
    invalid_quantity: "A quantidade deve ficar entre 1 e 20.",
    tournament_finished: "O campeonato foi encerrado.",
    gift_already_used: "Esse presente já foi aberto e não pode mais ser cancelado.",
  };
  const errorText = (error) => ERRORS[String((error && error.message) || "")] || "Não foi possível concluir. Confira se o SQL PACKS-V4-GIFTS foi executado no Supabase.";

  // Painel admin: dar pacotes de presente a um ou mais times e acompanhar o que já foi aberto.
  function PackGiftsAdmin({ tournament, teams, profiles, profile, onSaveSettings }) {
    const packs = (tournament && tournament.packSettings && Array.isArray(tournament.packSettings.packs)) ? tournament.packSettings.packs : [];
    const active = (teams || []).filter((team) => team && team.active !== false);
    const [packId, setPackId] = React.useState(packs.length ? packs[0].id : "");
    const [quantity, setQuantity] = React.useState("1");
    const [selected, setSelected] = React.useState([]);
    const [gifts, setGifts] = React.useState(null);
    const [busy, setBusy] = React.useState(false);
    const [message, setMessage] = React.useState(null);
    const tournamentId = tournament && tournament.id;
    const currentLabel = (tournament && tournament.packSettings && typeof tournament.packSettings.giftLabel === "string" && tournament.packSettings.giftLabel.trim()) || "Presente grátis";
    const [labelDraft, setLabelDraft] = React.useState(currentLabel);
    React.useEffect(() => { setLabelDraft(currentLabel); }, [currentLabel]);
    async function saveLabel() {
      const text = labelDraft.trim().slice(0, 40);
      if (!text || !onSaveSettings || text === currentLabel) return;
      setMessage(null);
      try { await onSaveSettings({ ...(tournament.packSettings || {}), giftLabel: text }); setMessage({ kind: "ok", text: "Texto do selo atualizado." }); }
      catch (saveError) { console.error("gift label failed", saveError); setMessage({ kind: "error", text: "Não foi possível salvar o texto." }); }
    }
    const finished = !!(tournament && tournament.status === "finished");

    const reload = React.useCallback(async () => {
      if (!tournamentId || typeof App.loadPackGifts !== "function") return;
      try { setGifts(await App.loadPackGifts({ tournamentId })); }
      catch (loadError) { console.error("pack gifts failed", loadError); setGifts([]); setMessage({ kind: "error", text: "Não foi possível carregar os presentes. Execute o SQL PACKS-V4-GIFTS no Supabase." }); }
    }, [tournamentId]);
    React.useEffect(() => { reload(); }, [reload]);

    const labelOf = (id) => { const found = packs.find((pack) => pack.id === id); return found ? found.label : id; };
    const teamOf = (id) => active.concat(teams || []).find((team) => team && String(team.id) === String(id));
    const nameOf = (team) => { if (!team) return "Time removido"; const p = (profiles || []).find((item) => item && String(item.id) === String(team.profileId)); return (p && p.name) || team.name; };
    const toggle = (id) => setSelected((list) => list.includes(id) ? list.filter((item) => item !== id) : [...list, id]);
    const qty = Math.max(1, Math.min(20, Math.round(Number(quantity) || 1)));

    async function give() {
      if (busy || !selected.length || !packId) return;
      const names = selected.map((id) => nameOf(teamOf(id))).join(", ");
      if (!window.confirm(`Dar ${qty} pacote${qty > 1 ? "s" : ""} ${labelOf(packId)} para cada um destes: ${names}? O pacote abre de graça no mercado.`)) return;
      setBusy(true); setMessage(null);
      try {
        const result = await App.grantPackGift({ tournamentId, teamIds: selected, packId, quantity: qty, actorProfileId: profile && profile.id });
        setMessage({ kind: "ok", text: `${result.granted || selected.length * qty} pacote(s) de presente enviado(s).` });
        setSelected([]);
        await reload();
      } catch (giftError) {
        console.error("grant_pack_gift failed", giftError);
        setMessage({ kind: "error", text: errorText(giftError) });
      } finally { setBusy(false); }
    }
    async function revoke(gift) {
      if (busy || !window.confirm(`Cancelar o pacote ${labelOf(gift.packId)} de ${nameOf(teamOf(gift.teamId))}?`)) return;
      setBusy(true); setMessage(null);
      try { await App.revokePackGift({ tournamentId, giftId: gift.id, actorProfileId: profile && profile.id }); await reload(); }
      catch (giftError) { console.error("revoke_pack_gift failed", giftError); setMessage({ kind: "error", text: errorText(giftError) }); }
      finally { setBusy(false); }
    }

    if (!packs.length) return h("div", { className: "pack-cfg-warn" }, "Este campeonato não tem pacotes configurados.");
    const list = Array.isArray(gifts) ? gifts : [];
    const status = (gift) => gift.revoked ? "Cancelado" : gift.usedOpeningId ? "Aberto" : "Disponível";
    const pending = list.filter((gift) => !gift.revoked && !gift.usedOpeningId);

    return h("div", { className: "pack-gifts" },
      finished && h("div", { className: "pack-cfg-warn" }, "O campeonato foi encerrado: não dá mais para dar pacotes."),
      h("div", { className: "pack-cfg-card" },
        h("div", { className: "pack-cfg-fields" },
          h("label", { className: "pack-cfg-field" }, h("span", null, "Texto do selo na loja"),
            h("input", { className: "pack-cfg-input", maxLength: 40, value: labelDraft, onChange: (e) => setLabelDraft(e.target.value), onBlur: saveLabel, onKeyDown: (e) => { if (e.key === "Enter") e.currentTarget.blur(); } }))),
        h("div", { className: "pack-cfg-fields" },
          h("label", { className: "pack-cfg-field" }, h("span", null, "Pacote"),
            h("select", { className: "pack-cfg-input", value: packId, onChange: (e) => setPackId(e.target.value) },
              packs.map((pack) => h("option", { key: pack.id, value: pack.id }, pack.label)))),
          h("label", { className: "pack-cfg-field" }, h("span", null, "Quantidade por time"),
            h("input", { className: "pack-cfg-input", inputMode: "numeric", value: quantity, onChange: (e) => setQuantity(e.target.value.replace(/\D/g, "").slice(0, 2)) }))),
        h("div", { className: "pack-gifts-who" },
          h("div", { className: "pack-gifts-who-head" }, h("strong", null, "Quem recebe"),
            h("button", { type: "button", className: "tapbtn pack-cfg-link", onClick: () => setSelected(selected.length === active.length ? [] : active.map((team) => String(team.id))) }, selected.length === active.length ? "Limpar" : "Todos")),
          active.map((team) => h("label", { key: team.id, className: "pack-cfg-check" },
            h("input", { type: "checkbox", checked: selected.includes(String(team.id)), onChange: () => toggle(String(team.id)) }), ` ${nameOf(team)}`))),
        h("button", { className: "tapbtn pack-open-btn", disabled: busy || finished || !selected.length, onClick: give },
          busy ? "Enviando…" : selected.length ? `Dar ${qty} pacote${qty > 1 ? "s" : ""} ${labelOf(packId)} a ${selected.length} time${selected.length > 1 ? "s" : ""}` : "Escolha quem recebe"),
        message && h("div", { className: message.kind === "error" ? "pack-store-error" : "pack-store-notice", role: "alert" }, message.text)),
      h("div", { className: "pack-cfg-card" },
        h("strong", null, `Presentes (${pending.length} disponíveis)`),
        gifts == null ? h("div", { className: "pack-cfg-note" }, "Carregando…")
          : !list.length ? h("div", { className: "pack-cfg-note" }, "Nenhum pacote de presente ainda.")
          : list.map((gift) => h("div", { key: gift.id, className: "pack-gift-row is-" + (gift.revoked ? "revoked" : gift.usedOpeningId ? "used" : "open") },
            h("span", null, h("b", null, labelOf(gift.packId)), ` · ${nameOf(teamOf(gift.teamId))}`),
            h("span", { className: "pack-gift-status" }, status(gift)),
            !gift.revoked && !gift.usedOpeningId && h("button", { className: "tapbtn pack-cfg-link", disabled: busy || finished, onClick: () => revoke(gift) }, "Cancelar")))));
  }

  App.PackGiftsAdmin = PackGiftsAdmin;
})();
