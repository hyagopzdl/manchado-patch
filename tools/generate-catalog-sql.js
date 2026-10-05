// Gera supabase/PLAYER-CATALOG-SEED.sql a partir de players.json.
// Uso: node tools/generate-catalog-sql.js
// Rode novamente (e reaplique o SQL) sempre que o players.json mudar.
const fs = require("fs");
const crypto = require("crypto");
const path = require("path");

const root = path.join(__dirname, "..");
const raw = fs.readFileSync(path.join(root, "players.json"));
const players = JSON.parse(raw.toString("utf8"));
const checksum = crypto.createHash("sha256").update(raw).digest("hex");
const q = (v) => "'" + String(v == null ? "" : v).replace(/'/g, "''") + "'";

const rows = players.map((p) => `(${q(p.id)},${q(p.name)},${q(p.position)},${Number(p.overall) || 0},${Number(p.value) || 0})`);
const chunks = [];
for (let i = 0; i < rows.length; i += 500) chunks.push(rows.slice(i, i + 500));

const sql = [
  "-- GERADO por tools/generate-catalog-sql.js a partir de players.json. Não edite à mão.",
  "-- Pré-requisito: PACKS-V1.sql aplicado antes (cria player_catalog e player_catalog_meta).",
  "begin;",
  "delete from public.player_catalog where player_id <> all (array[" + players.map((p) => q(p.id)).join(",") + "]);",
  ...chunks.map((c) => "insert into public.player_catalog(player_id,name,position,overall,value) values\n" + c.join(",\n") +
    "\non conflict (player_id) do update set name=excluded.name, position=excluded.position, overall=excluded.overall, value=excluded.value;"),
  `insert into public.player_catalog_meta(id,player_count,source_checksum,loaded_at) values (true,${players.length},${q(checksum)},now())`,
  "on conflict (id) do update set player_count=excluded.player_count, source_checksum=excluded.source_checksum, loaded_at=excluded.loaded_at;",
  "commit;",
  "",
].join("\n");
fs.writeFileSync(path.join(root, "supabase", "PLAYER-CATALOG-SEED.sql"), sql);
console.log(`${players.length} jogadores, sha256 ${checksum.slice(0, 12)}…`);
