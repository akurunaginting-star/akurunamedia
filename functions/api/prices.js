// ============================================================
// Backend Akuruna Media — Harga Crypto (Cloudflare Pages Functions)
// Mengambil harga dari CoinGecko di sisi server, disimpan di cache
// selama 60 detik supaya cepat & tidak kena batas rate CoinGecko.
// Alamat akses: /api/prices
// ============================================================

const COINGECKO_URL =
  'https://api.coingecko.com/api/v3/simple/price' +
  '?ids=bitcoin,ethereum,solana,ripple,binancecoin' +
  '&vs_currencies=usd,idr&include_24hr_change=true';

const CACHE_SECONDS = 60;

export async function onRequest(context) {
  const cache = caches.default;
  const cacheKey = new Request('https://akuruna-cache.local/api/prices');

  // 1. Cek cache dulu — kalau masih segar, langsung kirim
  const cached = await cache.match(cacheKey);
  if (cached) return withCors(cached);

  // 2. Kalau belum ada, ambil dari CoinGecko
  try {
    const upstream = await fetch(COINGECKO_URL, {
      headers: { accept: 'application/json' },
    });
    if (!upstream.ok) throw new Error('CoinGecko HTTP ' + upstream.status);

    const body = await upstream.text();
    const res = new Response(body, {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'public, max-age=' + CACHE_SECONDS,
        'access-control-allow-origin': '*',
      },
    });

    // Simpan ke cache untuk pengunjung berikutnya
    context.waitUntil(cache.put(cacheKey, res.clone()));
    return res;
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'Gagal mengambil harga', detail: String(err) }),
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
