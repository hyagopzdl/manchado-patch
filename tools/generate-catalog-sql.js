// Gera supabase/catalog-seeds/<catalogId>.sql a partir de um arquivo de jogadores.
// Uso:  node tools/generate-catalog-sql.js [catalogId] [arquivo.json]
//   sem argumentos:  catálogo "default" a partir de players.json
//   outra base:      node tools/generate-catalog-sql.js edicao-2026 players-2026.json
// Rode novamente (e reaplique o SQL) sempre que o arquivo mudar.
// Cada catálogo precisa estar listado em catalogs.json (usado pelo seletor do app).
const fs = require("fs");
const crypto = require("crypto");
const path = require("path");

const root = path.join(__dirname, "..");
const catalogId = process.argv[2] || "default";
const sourceFile = process.argv[3] || "players.json";
if (!/^[a-z0-9][a-z0-9_-]*$/.test(catalogId)) {
  console.error(`catalogId inválido: "${catalogId}" (use minúsculas, números, - e _)`);
  process.exit(1);
}
if (!fs.existsSync(path.resolve(root, sourceFile))) {
  console.error(`Arquivo não encontrado: ${sourceFile}`);
  process.exit(1);
}
const raw = fs.readFileSync(path.resolve(root, sourceFile));
const players = JSON.parse(raw.toString("utf8"));
const checksum = crypto.createHash("sha256").update(raw).digest("hex");

// Validação: falha alto antes de gerar qualquer SQL.
const errors = [], warnings = [], seen = new Set();
players.forEach((p, i) => {
  const where = `#${i} (${p && p.name})`;
  if (!p || p.id == null || String(p.id) === "") { errors.push(`${where}: sem id`); return; }
  const id = String(p.id);
  if (seen.has(id)) errors.push(`${where}: id duplicado ${id}`);
  seen.add(id);
  if (!p.name) errors.push(`${where}: sem nome`);
  if (!Number.isInteger(Number(p.overall)) || Number(p.overall) < 1 || Number(p.overall) > 99) errors.push(`${where}: overall inválido (${p.overall})`);
  if (!(Number(p.value) > 0)) warnings.push(`${where}: valor ausente ou <= 0 (${p.value})`);
  if (!p.position) warnings.push(`${where}: sem posição`);
});
if (!players.length) errors.push("players.json vazio");
if (warnings.length) console.warn(`Avisos (${warnings.length}):\n  ` + warnings.slice(0, 15).join("\n  ") + (warnings.length > 15 ? `\n  ... e mais ${warnings.length - 15}` : ""));
if (errors.length) {
  console.error(`ERROS (${errors.length}): nada foi gerado.\n  ` + errors.slice(0, 30).join("\n  "));
  process.exit(1);
}
const q = (v) => "'" + String(v == null ? "" : v).replace(/'/g, "''") + "'";

const rows = players.map((p) => `(${q(catalogId)},${q(p.id)},${q(p.name)},${q(p.position)},${Number(p.overall) || 0},${Number(p.value) || 0})`);
const chunks = [];
for (let i = 0; i < rows.length; i += 500) chunks.push(rows.slice(i, i + 500));

const sql = [
  `-- GERADO por tools/generate-catalog-sql.js (catálogo "${catalogId}", origem ${sourceFile}). Não edite à mão.`,
  "-- Pré-requisito: PACKS-V1.sql aplicado antes (cria player_catalog e player_catalog_meta).",
  "-- Só toca nas linhas deste catálogo; outros catálogos não são afetados.",
  "begin;",
  `delete from public.player_catalog where catalog_id = ${q(catalogId)} and player_id <> all (array[` + players.map((p) => q(p.id)).join(",") + "]);",
  ...chunks.map((c) => "insert into public.player_catalog(catalog_id,player_id,name,position,overall,value) values\n" + c.join(",\n") +
    "\non conflict (catalog_id, player_id) do update set name=excluded.name, position=excluded.position, overall=excluded.overall, value=excluded.value;"),
  `insert into public.player_catalog_meta(catalog_id,player_count,source_checksum,loaded_at) values (${q(catalogId)},${players.length},${q(checksum)},now())`,
  "on conflict (catalog_id) do update set player_count=excluded.player_count, source_checksum=excluded.source_checksum, loaded_at=excluded.loaded_at;",
  "commit;",
  "",
].join("\n");
const outDir = path.join(root, "supabase", "catalog-seeds");
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, `${catalogId}.sql`);
fs.writeFileSync(outFile, sql);

// Confere o registro usado pelo seletor do app.
try {
  const registry = JSON.parse(fs.readFileSync(path.join(root, "catalogs.json"), "utf8"));
  const entry = registry.find((c) => c.id === catalogId);
  if (!entry) console.warn(`ATENÇÃO: "${catalogId}" não está em catalogs.json. Adicione { "id": "${catalogId}", "label": "...", "file": "${sourceFile}" }.`);
  else if (entry.file !== sourceFile) console.warn(`ATENÇÃO: catalogs.json aponta "${catalogId}" para ${entry.file}, mas o seed foi gerado de ${sourceFile}.`);
} catch (e) {
  console.warn("ATENÇÃO: catalogs.json ausente ou inválido.");
}
const maxO = Math.max(...players.map((p) => Number(p.overall))), minO = Math.min(...players.map((p) => Number(p.overall)));
console.log(`${players.length} jogadores, overall ${minO}–${maxO}, sha256 ${checksum.slice(0, 12)}…`);
console.log(`Gerado ${path.relative(root, outFile)}`);
console.log(`Próximo passo: aplicar esse SQL no Supabase (o app também precisa estar servindo este mesmo ${sourceFile}).`);
