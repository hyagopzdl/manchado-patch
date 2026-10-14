#!/usr/bin/env python3
"""Converte a planilha de jogadores (.xlsx, aba "Principal") para o formato do players.json do app.

Uso:  python3 tools/xlsx-to-players.py <planilha.xlsx> [saida.json] [prefixo-do-id]
  gera <saida.json> (formato do app) e <saida>.completo.json (todas as colunas da planilha).
Requer: pip install openpyxl

Regras de conversão (iguais às do players.json atual):
  id           = "<prefixo>_<número da linha na planilha, 4 dígitos>"   (estável enquanto as linhas não forem reordenadas)
  position       = primeira posição da coluna "Posições" (principal)
  positions      = todas as posições da coluna, na ordem (a 1ª é a principal, as demais são secundárias)
  nationality    = primeira nacionalidade, em português (o app reconhece os nomes em português para a bandeira)
  foot           = D -> Direito, E -> Esquerdo, A -> Ambos
  injuryTolerance= coluna Injury (A, B ou C)
  abilities      = habilidades especiais marcadas com ✓, como chaves (ex.: "dribbling", "oneOnOneScoring")
  attrs          = colunas de atributos com os mesmos nomes do players.json
  (sem favouredSide: a planilha não tem lado preferido)
"""
import json, sys, re, collections
import openpyxl

NAT_ALIASES = {  # grafias repetidas na planilha -> um único nome
 'Países Baixos': 'Holanda', 'Tchéquia': 'República Tcheca', 'Rep. Dominicana': 'República Dominicana',
}
ABILITIES = {  # coluna da planilha -> chave usada no JSON (os nomes em português ficam no app)
 'Dribbling':'dribbling','Tactical Dribble':'tacticalDribble','Positioning':'positioning','Reaction':'reaction','Playmaking':'playmaking',
 'Passing':'passing','Scoring':'scoring','1-1 Scoring':'oneOnOneScoring','Post Player':'postPlayer','Lines':'lines',
 'Middle Shooting':'middleShooting','Side':'side','Center':'center','Penalties':'penalties','1-Touch Pass':'oneTouchPass','Outside':'outside',
 'Marking':'marking','Sliding Tackle':'slidingTackle','Covering':'covering','D-Line Control':'dLineControl',
 'Penalty Stopper':'penaltyStopper','1-on-1 Stopper':'oneOnOneStopper','Long Throw':'longThrow',
}
ATTRS = {  # coluna da planilha -> chave em players.json (mesma ordem do players.json)
 'Acceleration':'acceleration','Top Speed':'topSpeed','Dribble Accuracy':'dribbleAccuracy','Dribble Speed':'dribbleSpeed',
 'Short Pass Accuracy':'shortPassAccuracy','Short Pass Speed':'shortPassSpeed','Long Pass Accuracy':'longPassAccuracy','Long Pass Speed':'longPassSpeed',
 'Shot Accuracy':'shotAccuracy','Shot Power':'shotPower','Shot Technique':'shotTechnique','Technique':'technique','Header':'heading',
 'Free Kick Accuracy':'freeKickAccuracy','Curling':'curve','Balance':'balance','Jump':'jump','Stamina':'stamina','Response':'response',
 'Mentality':'mentality','Aggression':'aggression','Team Work':'teamwork','Consistency':'consistency','GK Skills':'goalKeepingSkills',
 'Weak Foot Accuracy':'weakFootAccuracy','Weak Foot Frequency':'weakFootFrequency','Condition':'conditionFitness','Agility':'agility',
}
FOOT = {'D':'Direito','E':'Esquerdo','A':'Ambos'}
KNOWN = {'Setor','Jogador','Nacionalidade','Time','Idade','Altura (cm)','Peso (kg)','Pé','Posições','Valor','OVR','Attack','Defence','Injury'} | set(ATTRS)

def positions_of(text):
    return [t.strip() for t in re.split(r'[/,]', str(text or '')) if t.strip()]

def main():
    src = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else 'players-2026.json'
    prefix = sys.argv[3] if len(sys.argv) > 3 else '26'
    ws = openpyxl.load_workbook(src, read_only=True, data_only=True)['Principal']
    rows = list(ws.iter_rows(values_only=True))
    head = list(rows[0]); idx = {name: i for i, name in enumerate(head)}
    missing = [c for c in ('Jogador', 'Nacionalidade', 'Time', 'Idade', 'Altura (cm)', 'Peso (kg)', 'Pé', 'Posições', 'Valor', 'OVR', 'Attack', 'Defence') if c not in idx]
    if missing: sys.exit(f'Colunas ausentes na planilha: {missing}')
    skills = [c for c in head if c not in KNOWN and c]
    players, full, warnings = [], [], []
    for line, r in enumerate(rows[1:], start=2):
        if not any(c is not None for c in r): continue
        g = lambda name: r[idx[name]]
        name = str(g('Jogador') or '').strip()
        if not name: warnings.append(f'linha {line}: sem nome, ignorada'); continue
        pos = positions_of(g('Posições'))
        if not pos: warnings.append(f'linha {line} ({name}): sem posição, ignorada'); continue
        nats = [t.strip() for t in str(g('Nacionalidade') or '').split('/') if t.strip()]
        nationality = NAT_ALIASES.get(nats[0], nats[0]) if nats else None
        foot_raw = str(g('Pé') or '').strip()
        if foot_raw not in FOOT: warnings.append(f'linha {line} ({name}): pé "{foot_raw}" desconhecido, usei Direito')
        pid = f'{prefix}_{line:04d}'
        entry = {
            'id': pid, 'name': name, 'position': pos[0], 'overall': int(g('OVR')), 'age': g('Idade'), 'height': g('Altura (cm)'), 'weight': g('Peso (kg)'),
            'positions': pos,
            'foot': FOOT.get(foot_raw, 'Direito'), 'nationality': nationality, 'club': str(g('Time') or '').strip(),
            'value': g('Valor'), 'attack': g('Attack'), 'defense': g('Defence'),
            'injuryTolerance': (str(g('Injury')).strip() if 'Injury' in idx and g('Injury') else None),
            'attrs': {key: r[idx[col]] for col, key in ATTRS.items() if col in idx},
            'abilities': [key for col, key in ABILITIES.items() if col in idx and r[idx[col]] not in (None, '', 0)],
        }
        players.append(entry)
        full.append({
            'id': pid, 'linhaNaPlanilha': line, 'setor': g('Setor') if g('Setor') != 0 else None, 'nome': name, 'nacionalidades': nats, 'time': entry['club'],
            'idade': g('Idade'), 'alturaCm': g('Altura (cm)'), 'pesoKg': g('Peso (kg)'), 'pe': foot_raw, 'posicoes': pos, 'valor': g('Valor'), 'ovr': g('OVR'),
            'attack': g('Attack'), 'defence': g('Defence'), 'injury': g('Injury') if 'Injury' in idx else None,
            'atributos': {col: r[idx[col]] for col in ATTRS if col in idx},
            'habilidades': [c for c in skills if r[idx[c]] not in (None, '', 0)],
        })
    with open(out, 'w', encoding='utf-8') as f: json.dump(players, f, ensure_ascii=False, indent=2)
    full_path = re.sub(r'\.json$', '', out) + '.completo.json'
    with open(full_path, 'w', encoding='utf-8') as f: json.dump(full, f, ensure_ascii=False, indent=2)
    print(f'{len(players)} jogadores -> {out} e {full_path}')
    for w in warnings: print('AVISO', w)

main()
