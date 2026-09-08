const ORIGIN = 'https://akurunamedia.id';
const CALLBACK = ORIGIN + '/api/auth/wordpress/callback';
const SITE = 'akurunamedia.wordpress.com';
const enc = new TextEncoder();
const hex = bytes => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
const digest = text => crypto.subtle.digest('SHA-256', enc.encode(text)).then(hex);
const cookie = value => '__Host-akuruna_oauth=' + value + '; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=' + (value ? 600 : 0);
function reply(body, status = 200, extra = {}) {
  return new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', ...extra } });
}
async function init(db) {
  await db.batch([
    db.prepare('CREATE TABLE IF NOT EXISTS agent_oauth_state (id TEXT PRIMARY KEY, expires INTEGER NOT NULL)'),
    db.prepare('CREATE TABLE IF NOT EXISTS agent_connection (provider TEXT PRIMARY KEY, ciphertext TEXT NOT NULL, iv TEXT NOT NULL, site_id TEXT NOT NULL, updated TEXT NOT NULL)')
  ]);
}
async function encrypt(token, secret) {
  const raw = await crypto.subtle.digest('SHA-256', enc.encode('akuruna-wordpress-token-v1:' + secret));
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(token));
  return { ciphertext: hex(ciphertext), iv: hex(iv) };
}
export async function handle({ request, env }, action) {
  if (new URL(request.url).origin !== ORIGIN) return reply('Gunakan domain akurunamedia.id.', 403);
  if (!env.AGENT_DB || !env.WP_CLIENT_ID || !env.WP_CLIENT_SECRET || !env.AGENT_ADMIN_KEY || env.AGENT_ADMIN_KEY.length < 32) return reply('Konfigurasi belum lengkap. Periksa binding dan panjang AGENT_ADMIN_KEY.', 503);
  try {
    if (action === 'start' || action === 'status') {
      if (request.method !== 'POST') return reply('Method not allowed', 405);
      if (request.headers.get('Origin') !== ORIGIN) return reply('Origin tidak sesuai.', 403);
      if (Number(request.headers.get('content-length') || 0) > 4096) return reply('Permintaan terlalu besar.', 413);
      const body = await request.text();
      if (body.length > 4096) return reply('Permintaan terlalu besar.', 413);
      const supplied = new URLSearchParams(body).get('admin_key') || '';
      if (await digest(supplied) !== await digest(env.AGENT_ADMIN_KEY)) return reply('Kunci admin salah. Kembali ke halaman admin.', 401);
      await init(env.AGENT_DB);
      if (action === 'status') {
        const row = await env.AGENT_DB.prepare("SELECT site_id, updated FROM agent_connection WHERE provider = 'wordpress'").first();
        return reply(row ? 'Koneksi WordPress tersimpan untuk situs ID ' + row.site_id + '. Penulisan AI dan jadwal belum dipasang.' : 'Database dapat diakses. WordPress belum dihubungkan.');
      }
      const state = hex(crypto.getRandomValues(new Uint8Array(32)));
      const now = Math.floor(Date.now() / 1000);
      await env.AGENT_DB.prepare('DELETE FROM agent_oauth_state WHERE expires < ?').bind(now).run();
      await env.AGENT_DB.prepare('INSERT INTO agent_oauth_state (id, expires) VALUES (?, ?)').bind(await digest(state), now + 600).run();
      const url = new URL('https://public-api.wordpress.com/oauth2/authorize');
      url.search = new URLSearchParams({ client_id: env.WP_CLIENT_ID, redirect_uri: CALLBACK, response_type: 'code', blog: SITE, state }).toString();
      return reply('', 303, { Location: url.href, 'Set-Cookie': cookie(state) });
    }
    if (request.method !== 'GET') return reply('Method not allowed', 405);
    const url = new URL(request.url);
    const state = url.searchParams.get('state') || '';
    const stored = (request.headers.get('Cookie') || '').split(';').map(x => x.trim()).find(x => x.startsWith('__Host-akuruna_oauth='))?.split('=')[1];
    if (!/^[a-f0-9]{64}$/.test(state) || state !== stored) return reply('Sesi koneksi tidak valid. Mulai lagi dari /agent-admin.', 403);
    const used = await env.AGENT_DB.prepare('DELETE FROM agent_oauth_state WHERE id = ? AND expires >= ? RETURNING id').bind(await digest(state), Math.floor(Date.now() / 1000)).first();
    if (!used) return reply('Sesi kedaluwarsa atau sudah digunakan. Mulai lagi dari /agent-admin.', 403);
    if (url.searchParams.has('error')) return reply('Izin WordPress tidak diberikan. Kembali ke /agent-admin.', 400, { 'Set-Cookie': cookie('') });
    const code = url.searchParams.get('code');
    if (!code) return reply('Kode otorisasi tidak tersedia.', 400);
    const result = await fetch('https://public-api.wordpress.com/oauth2/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: env.WP_CLIENT_ID, client_secret: env.WP_CLIENT_SECRET, code, grant_type: 'authorization_code', redirect_uri: CALLBACK }),
      signal: AbortSignal.timeout(20000)
    });
    if (!result.ok) return reply('Pertukaran token gagal. Periksa Client ID, Client Secret, dan Redirect URL. Mulai ulang dari /agent-admin.', 502);
    const data = await result.json();
    if (!data.access_token || !data.blog_id || data.scope === 'global') return reply('Token tidak memiliki akses satu situs yang diperlukan.', 502);
    const siteResult = await fetch('https://public-api.wordpress.com/rest/v1.1/sites/' + encodeURIComponent(data.blog_id), { headers: { Authorization: 'Bearer ' + data.access_token }, signal: AbortSignal.timeout(15000) });
    if (!siteResult.ok) return reply('Pemeriksaan situs WordPress gagal. Mulai ulang koneksi.', 502);
    const site = await siteResult.json();
    if (!site.URL || new URL(site.URL).hostname !== SITE) return reply('Situs yang diizinkan bukan akurunamedia.wordpress.com.', 403);
    const sealed = await encrypt(data.access_token, env.AGENT_ADMIN_KEY);
    await env.AGENT_DB.prepare("INSERT INTO agent_connection (provider,ciphertext,iv,site_id,updated) VALUES ('wordpress',?,?,?,?) ON CONFLICT(provider) DO UPDATE SET ciphertext=excluded.ciphertext,iv=excluded.iv,site_id=excluded.site_id,updated=excluded.updated").bind(sealed.ciphertext, sealed.iv, String(data.blog_id), new Date().toISOString()).run();
    return reply('WordPress berhasil dihubungkan. Token disimpan terenkripsi. Kembali ke https://akurunamedia.id/agent-admin. Agen penulis dan posting otomatis belum aktif.', 200, { 'Set-Cookie': cookie('') });
  } catch {
    return reply('Koneksi gagal. Periksa binding AGENT_DB dan pengaturan WordPress, lalu mulai ulang dari /agent-admin. Tidak ada token yang ditampilkan.', 500);
  }
}
