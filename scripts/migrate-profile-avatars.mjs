import fs from 'node:fs/promises';
import path from 'node:path';

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const inputIndex = process.argv.indexOf('--input');
const inputPath = inputIndex >= 0 ? process.argv[inputIndex + 1] : './firebase-backup.json';

const url = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
if (!dryRun && (!url || !serviceKey)) {
  throw new Error('Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY nos Secrets.');
}

const raw = JSON.parse(await fs.readFile(inputPath, 'utf8'));
const root = raw.pes || raw;
const profiles = Array.isArray(root.profiles)
  ? root.profiles
  : Object.entries(root.profiles || {}).map(([id, value]) => ({ id, ...value }));

function parseDataUrl(value) {
  if (typeof value !== 'string') return null;
  const match = value.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,(.+)$/s);
  if (!match) return null;
  const mime = match[1];
  const ext = mime === 'image/jpeg' ? 'jpg' : mime.split('/')[1];
  return { mime, ext, bytes: Buffer.from(match[2], 'base64') };
}

async function request(endpoint, options = {}) {
  const response = await fetch(`${url}${endpoint}`, {
    ...options,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${options.method || 'GET'} ${endpoint} falhou (${response.status}): ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

const candidates = profiles
  .map((profile) => ({ profile, parsed: parseDataUrl(profile.avatar) }))
  .filter((item) => item.profile?.id && item.parsed);

const totalBytes = candidates.reduce((sum, item) => sum + item.parsed.bytes.length, 0);
console.log(`Avatares em base64 encontrados: ${candidates.length}`);
console.log(`Tamanho binario total: ${(totalBytes / 1024 / 1024).toFixed(2)} MB`);

if (dryRun) {
  for (const { profile, parsed } of candidates) {
    console.log(`- ${profile.name || profile.id}: ${(parsed.bytes.length / 1024 / 1024).toFixed(2)} MB (${parsed.mime})`);
  }
  console.log('Dry-run concluido: nenhuma escrita executada.');
  process.exit(0);
}

for (const { profile, parsed } of candidates) {
  const objectPath = `profiles/${profile.id}.${parsed.ext}`;
  await request(`/storage/v1/object/profile-avatars/${objectPath}`, {
    method: 'POST',
    headers: {
      'Content-Type': parsed.mime,
      'x-upsert': 'true'
    },
    body: parsed.bytes
  });

  const publicUrl = `${url}/storage/v1/object/public/profile-avatars/${objectPath}`;
  await request(`/rest/v1/profiles?id=eq.${encodeURIComponent(profile.id)}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'return=minimal'
    },
    body: JSON.stringify({ avatar: publicUrl })
  });
  console.log(`OK: ${profile.name || profile.id}`);
}

console.log('Avatares migrados para o Supabase Storage com sucesso.');
