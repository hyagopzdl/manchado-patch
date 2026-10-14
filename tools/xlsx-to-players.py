#!/usr/bin/env python3
"""Converte a planilha de jogadores (.xlsx, aba "Principal") para o formato do players.json do app.

Uso:  python3 tools/xlsx-to-players.py <planilha.xlsx> [saida.json] [prefixo-do-id]
  gera <saida.json> (formato do app) e <saida>.completo.json (todas as colunas da planilha).
Requer: pip install openpyxl

Regras de conversão (iguais às do players.json atual):
  id           = "<prefixo>_<número da linha na planilha, 4 dígitos>"   (estável enquanto as linhas não forem reordenadas)
  position     = primeira posição da coluna "Posições"
  nationality  = primeira nacionalidade, em inglês (o app usa nomes em inglês para a bandeira)
  foot         = D -> Right, E -> Left, A -> Both
  favouredSide = null (a planilha não tem essa informação)
  attrs        = colunas de atributos com os mesmos nomes do players.json
"""
import json, sys, re, collections
import openpyxl

NAT = {
 'Albânia':'Albania','Alemanha':'Germany','Angola':'Angola','Argentina':'Argentina','Argélia':'Algeria','Armênia':'Armenia',
 'Arábia Saudita':'Saudi Arabia','Austrália':'Australia','Benim':'Benin','Bolívia':'Bolivia','Brasil':'Brazil','Burkina Faso':'Burkina Faso',
 'Bélgica':'Belgium','Bósnia e Herzegovina':'Bosnia and Herzegovina','Cabo Verde':'Cape Verde','Camarões':'Cameroon','Canadá':'Canada',
 'Chile':'Chile','Colômbia':'Colombia','Congo':'Congo','Coreia do Sul':'South Korea','Costa Rica':'Costa Rica','Costa do Marfim':'Ivory Coast',
 'Croácia':'Croatia','Curaçao':'Curacao','Dinamarca':'Denmark','Egito':'Egypt','Equador':'Ecuador','Escócia':'Scotland','Eslováquia':'Slovakia',
 'Eslovênia':'Slovenia','Espanha':'Spain','Estados Unidos':'United States','Finlândia':'Finland','França':'France','Gabão':'Gabon','Gana':'Ghana',
 'Geórgia':'Georgia','Grécia':'Greece','Guiné':'Guinea','Guiné-Bissau':'Guinea-Bissau','Gâmbia':'Gambia','Haiti':'Haiti','Holanda':'Netherlands',
 'Hungria':'Hungary','Indonésia':'Indonesia','Inglaterra':'England','Iraque':'Iraq','Irlanda':'Republic of Ireland','Irlanda do Norte':'Northern Ireland',
 'Islândia':'Iceland','Israel':'Israel','Itália':'Italy','Jamaica':'Jamaica','Japão':'Japan','Kosovo':'Kosovo','Luxemburgo':'Luxembourg',
 'Macedônia do Norte':'North Macedonia','Mali':'Mali','Marrocos':'Morocco','Montenegro':'Montenegro','Moçambique':'Mozambique','México':'Mexico',
 'Nigéria':'Nigeria','Noruega':'Norway','Nova Zelândia':'New Zealand','Panamá':'Panama','Paraguai':'Paraguay','País de Gales':'Wales',
 'Países Baixos':'Netherlands','Peru':'Peru','Polônia':'Poland','Portugal':'Portugal','Quênia':'Kenya','RD Congo':'DR Congo',
 'Rep. Dominicana':'Dominican Republic','República Dominicana':'Dominican Republic','República Tcheca':'Czech Republic','Romênia':'Romania',
 'Rússia':'Russia','Senegal':'Senegal','Suécia':'Sweden','Suíça':'Switzerland','Sérvia':'Serbia','Tchéquia':'Czech Republic','Tunísia':'Tunisia',
 'Turquia':'Turkey','Ucrânia':'Ukraine','Uruguai':'Uruguay','Uzbequistão':'Uzbekistan','Venezuela':'Venezuela','Zâmbia':'Zambia',
 'África do Sul':'South Africa','Áustria':'Austria',
}
ATTRS = {  # coluna da planilha -> chave em players.json (mesma ordem do players.json)
 'Acceleration':'acceleration','Top Speed':'topSpeed','Dribble Accuracy':'dribbleAccuracy','Dribble Speed':'dribbleSpeed',
 'Short Pass Accuracy':'shortPassAccuracy','Short Pass Speed':'shortPassSpeed','Long Pass Accuracy':'longPassAccuracy','Long Pass Speed':'longPassSpeed',
 'Shot Accuracy':'shotAccuracy','Shot Power':'shotPower','Shot Technique':'shotTechnique','Technique':'technique','Header':'heading',
 'Free Kick Accuracy':'freeKickAccuracy','Curling':'curve','Balance':'balance','Jump':'jump','Stamina':'stamina','Response':'response',
 'Mentality':'mentality','Aggression':'aggression','Team Work':'teamwork','Consistency':'consistency','GK Skills':'goalKeepingSkills',
 'Weak Foot Accuracy':'weakFootAccuracy','Weak Foot Frequency':'weakFootFrequency','Condition':'conditionFitness','Agility':'agility',
}
FOOT = {'D':'Right','E':'Left','A':'Both'}
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
    unmapped = collections.Counter()
    for line, r in enumerate(rows[1:], start=2):
        if not any(c is not None for c in r): continue
        g = lambda name: r[idx[name]]
        name = str(g('Jogador') or '').strip()
        if not name: warnings.append(f'linha {line}: sem nome, ignorada'); continue
        pos = positions_of(g('Posições'))
        if not pos: warnings.append(f'linha {line} ({name}): sem posição, ignorada'); continue
        nats = [t.strip() for t in str(g('Nacionalidade') or '').split('/') if t.strip()]
        nat_en = None
        if nats:
            nat_en = NAT.get(nats[0])
            if nat_en is None: unmapped[nats[0]] += 1; nat_en = nats[0]
        foot_raw = str(g('Pé') or '').strip()
        if foot_raw not in FOOT: warnings.append(f'linha {line} ({name}): pé "{foot_raw}" desconhecido, usei Right')
        pid = f'{prefix}_{line:04d}'
        entry = {
            'id': pid, 'name': name, 'position': pos[0], 'overall': int(g('OVR')), 'age': g('Idade'), 'height': g('Altura (cm)'), 'weight': g('Peso (kg)'),
            'foot': FOOT.get(foot_raw, 'Right'), 'favouredSide': None, 'nationality': nat_en, 'club': str(g('Time') or '').strip(),
            'value': g('Valor'), 'attack': g('Attack'), 'defense': g('Defence'),
            'attrs': {key: r[idx[col]] for col, key in ATTRS.items() if col in idx},
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
    if unmapped: print('NACIONALIDADES SEM TRADUÇÃO (mantidas como estão):', dict(unmapped))
    for w in warnings: print('AVISO', w)

main()
