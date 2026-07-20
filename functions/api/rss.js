// ============================================================
// Backend Akuruna Media — Berita RSS (Cloudflare Pages Functions)
// Mengambil RSS dari media di sisi server (bebas aturan CORS),
// disimpan di cache 5 menit supaya cepat dan hemat.
// Alamat akses: /api/rss?feed=market | dunia | tekno | indonesia
//
// Mau ganti/tambah sumber berita? Cukup ubah daftar FEEDS di bawah.
// ============================================================

const FEEDS = {
  market:    'https://www.cnbcindonesia.com/market/rss',      // hero + terpopuler
  dunia:     'https://feeds.bbci.co.uk/indonesia/rss.xml',    // Dunia & Politik
  tekno:     'https://www.cnbcindonesia.com/tech/rss',        // Teknologi & Bisnis
  indonesia: 'https://www.antaranews.com/rss/ekonomi.xml',    // Kabar Indonesia
};

const CACHE_SECONDS = 300; // 5 menit

export async function onRequest(context) {
  const reqUrl = new URL(context.request.url);
  const key = reqUrl.searchParams.get('feed');
  const feedUrl = FEEDS[key];

  if (!feedUrl) {
    return new Response(
      JSON.stringify({
        error: 'Feed tidak dikenal',
        tersedia: Object.keys(FEEDS),
      }),
      {
        status: 400,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'access-control-allow-origin': '*',
        },
      }
    );
  }

  const cache = caches.default;
  const cacheKey = new Request('https://akuruna-cache.local/api/rss/' + key);

  // 1. Cek cache dulu
  const cached = await cache.match(cacheKey);
  if (cached) return withCors(cached);

  // 2. Ambil dari sumber aslinya
  try {
    const upstream = await fetch(feedUrl, {
      headers: {
        // Beberapa situs media menolak request tanpa User-Agent
        'user-agent':
          'Mozilla/5.0 (compatible; AkurunaMedia/1.0; +https://akuruna.example)',
        accept: 'application/rss+xml, application/xml, text/xml, */*',
      },
    });
    if (!upstream.ok) throw new Error('Upstream HTTP ' + upstream.status);

    const body = await upstream.text();
    const res = new Response(body, {
      headers: {
        'content-type': 'application/xml; charset=utf-8',
        'cache-control': 'public, max-age=' + CACHE_SECONDS,
        'access-control-allow-origin': '*',
      },
    });

    context.waitUntil(cache.put(cacheKey, res.clone()));
    return res;
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'Gagal mengambil berita', detail: String(err) }),
      {
        status: 502,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'access-control-allow-origin': '*',
        },
      }
    );
  }
}

function withCors(res) {
  const r = new Response(res.body, res);
  r.headers.set('access-control-allow-origin', '*');
  return r;
}
