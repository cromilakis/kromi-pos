// ============================================================================
// Bootstrap de PRODUCCIÓN — kromi-pos (sub-proyecto ①)
// Crea, de forma idempotente, los datos iniciales en la base Supabase cloud:
// negocio → sucursal → caja → contadores de folio → módulos → admin.
// El admin se crea vía Admin API (dispara el trigger handle_new_user que espeja
// la fila en public.app_user). NO usar seed.sql en producción.
//
// Uso (Node 24+, sin dependencias):
//   node --env-file=.env.local scripts/bootstrap-prod.mjs
//
// .env.local debe contener (NO se commitea; git lo ignora):
//   SUPABASE_SECRET_KEY=sb_secret_...   (Dashboard → Settings → API Keys → Secret keys)
//                                        Reemplaza a la legacy service_role. Bypassa RLS.
//   ADMIN_PIN=NNNNNN                     (6 dígitos, login del admin)
//   # opcional: SUPABASE_URL=... (por defecto el proyecto kromi-pos cloud)
//   # compat: si aún usas la legacy, SUPABASE_SERVICE_ROLE_KEY=... también funciona
// ============================================================================

const URL = process.env.SUPABASE_URL || 'https://immuembrvocwbdpprypk.supabase.co';
const KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const PIN = process.env.ADMIN_PIN;

// --- Datos del negocio y admin (desde .env.local; no se hardcodean para no
//     dejar datos personales/RUT en el repo). Ver .env.local.example. --------
const env = (k, def) => process.env[k] ?? def;
const BUSINESS = {
  name: env('BOOTSTRAP_BUSINESS_NAME'),
  rut: env('BOOTSTRAP_BUSINESS_RUT'),
  giro: env('BOOTSTRAP_BUSINESS_GIRO') || null,
  direccion: env('BOOTSTRAP_BUSINESS_DIRECCION') || null,
  plan: env('BOOTSTRAP_BUSINESS_PLAN', 'Básico'),
};
const BRANCH = { name: env('BOOTSTRAP_BRANCH_NAME'), address: env('BOOTSTRAP_BRANCH_ADDRESS') || null };
const REGISTER = { name: env('BOOTSTRAP_REGISTER_NAME', 'Caja 1') };
const ADMIN = { name: env('BOOTSTRAP_ADMIN_NAME'), rut: env('BOOTSTRAP_ADMIN_RUT'), role: 'admin' };
const MODULES = ['stock', 'clientes', 'metricas'];

// --- Helpers ---------------------------------------------------------------
const fail = (msg) => { console.error(`\n❌ ${msg}`); process.exit(1); };
if (!KEY) fail('Falta SUPABASE_SECRET_KEY (o SUPABASE_SERVICE_ROLE_KEY) en el entorno (.env.local).');
if (!PIN || !/^\d{6}$/.test(PIN)) fail('Falta ADMIN_PIN de exactamente 6 dígitos en el entorno (.env.local).');
for (const [k, v] of Object.entries({
  BOOTSTRAP_BUSINESS_NAME: BUSINESS.name, BOOTSTRAP_BUSINESS_RUT: BUSINESS.rut,
  BOOTSTRAP_BRANCH_NAME: BRANCH.name, BOOTSTRAP_ADMIN_NAME: ADMIN.name, BOOTSTRAP_ADMIN_RUT: ADMIN.rut,
})) if (!v) fail(`Falta ${k} en el entorno (.env.local). Ver .env.local.example.`);

// RUT normalizado → email sintético (misma lógica que public.norm_rut).
const normRut = (r) => r.replace(/[.\-]/g, '').toLowerCase();
const ADMIN_EMAIL = `${normRut(ADMIN.rut)}@pos.kromi.local`;

// Las keys nuevas (sb_secret_/sb_publishable_) van SOLO en el header `apikey`:
// enviarlas también en `Authorization: Bearer` hace que la plataforma intente
// parsearlas como JWT y rechace la request. Las legacy (service_role JWT) usan ambos.
const isNewKey = /^sb_(secret|publishable)_/.test(KEY);
const H = isNewKey
  ? { apikey: KEY, 'Content-Type': 'application/json' }
  : { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

async function rest(path, { method = 'GET', body, prefer } = {}) {
  const headers = { ...H };
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${URL}/rest/v1/${path}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) fail(`${method} /rest/v1/${path} → ${res.status}: ${text}`);
  return data;
}

// Inserta si no existe (busca por filtro), devuelve la fila.
async function ensureRow(table, filter, insert) {
  const found = await rest(`${table}?${filter}&select=*`);
  if (Array.isArray(found) && found.length) return { row: found[0], created: false };
  const inserted = await rest(table, { method: 'POST', body: insert, prefer: 'return=representation' });
  return { row: Array.isArray(inserted) ? inserted[0] : inserted, created: true };
}

// --- Bootstrap ------------------------------------------------------------
console.log(`\n▶ Bootstrap de producción en ${URL}\n`);

// 1) Negocio (idempotente por RUT)
const { row: business, created: bizNew } = await ensureRow(
  'business', `rut=eq.${encodeURIComponent(BUSINESS.rut)}`, BUSINESS);
console.log(`${bizNew ? '＋' : '=' } negocio  ${business.name} (${business.id})`);

// 2) Sucursal (idempotente por negocio+nombre)
const { row: branch, created: brNew } = await ensureRow(
  'branch', `business_id=eq.${business.id}&name=eq.${encodeURIComponent(BRANCH.name)}`,
  { business_id: business.id, ...BRANCH });
console.log(`${brNew ? '＋' : '=' } sucursal ${branch.name} (${branch.id})`);

// 3) Caja (idempotente por sucursal+nombre)
const { row: register, created: regNew } = await ensureRow(
  'register', `branch_id=eq.${branch.id}&name=eq.${encodeURIComponent(REGISTER.name)}`,
  { branch_id: branch.id, ...REGISTER });
console.log(`${regNew ? '＋' : '=' } caja     ${register.name} (${register.id})`);

// 4) Contadores de folio (upsert idempotente por PK compuesta)
await rest('folio_counter?on_conflict=branch_id,doc_type', {
  method: 'POST',
  prefer: 'resolution=ignore-duplicates',
  body: ['sale', 'quote', 'credit_note'].map((doc_type) => ({ branch_id: branch.id, doc_type, next_value: 1 })),
});
console.log('＋ contadores de folio (sale, quote, credit_note)');

// 5) Módulos (upsert idempotente por business+module_key)
await rest('module_state?on_conflict=business_id,module_key', {
  method: 'POST',
  prefer: 'resolution=ignore-duplicates',
  body: MODULES.map((module_key) => ({ business_id: business.id, module_key, active: true })),
});
console.log(`＋ módulos activos (${MODULES.join(', ')})`);

// 6) Admin vía Admin API (el trigger handle_new_user crea el espejo en app_user)
const authRes = await fetch(`${URL}/auth/v1/admin/users`, {
  method: 'POST',
  headers: H,
  body: JSON.stringify({
    email: ADMIN_EMAIL,
    password: PIN,
    email_confirm: true,
    user_metadata: { business_id: business.id, name: ADMIN.name, rut: ADMIN.rut, role: ADMIN.role },
  }),
});
const authText = await authRes.text();
if (authRes.ok) {
  console.log(`＋ admin    ${ADMIN.name} · ${ADMIN.rut} · login ${ADMIN_EMAIL}`);
} else if (authRes.status === 422 || /already been registered|email_exists/i.test(authText)) {
  console.log(`= admin    ya existía (${ADMIN_EMAIL}), no se recrea`);
} else {
  fail(`POST /auth/v1/admin/users → ${authRes.status}: ${authText}`);
}

// 7) Verificación: el espejo app_user debe existir con role=admin
const mirror = await rest(`app_user?business_id=eq.${business.id}&rut=eq.${encodeURIComponent(ADMIN.rut)}&select=id,name,role,active`);
if (!Array.isArray(mirror) || !mirror.length) {
  fail('El espejo en app_user NO se creó (revisar el trigger handle_new_user).');
}
console.log(`✔ espejo app_user OK → ${mirror[0].name} (role=${mirror[0].role}, active=${mirror[0].active})`);

console.log('\n✅ Bootstrap de producción completo.\n');
console.log('   Login del admin:  RUT ' + ADMIN.rut + '  ·  PIN el que definiste en ADMIN_PIN');
