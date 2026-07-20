// ============================================================
// Backend Akuruna Media — Harga Crypto (versi 3, tiga sumber)
// Urutan: CryptoCompare → CoinGecko → Coinbase.
// Hasil disimpan di cache 120 detik. Alamat akses: /api/prices
// ============================================================

const CACHE_SECONDS = 120;

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// simbol ↔ id CoinGecko (format yang dipakai website)
const KOIN = [
  ['BTC', 'bitcoin'],
  ['ETH', 'ethereum'],
  ['SOL', 'solana'],
  ['XRP', 'ripple'],
  ['BNB', 'binancecoin'],
];

export async function onRequest(context) {
  const cache = caches.default;
  const cacheKey = new Request('https://akuruna-cache.local/api/prices');

  const cached = await cache.match(cacheKey);
  if (cached) return withCors(cached);

  let data = null;
  const detail = [];

  // ---------- Sumber 1: CryptoCompare (harga USD + IDR + perubahan 24 jam) ----------
  try {
    const url =
      'https://min-api.cryptocompare.com/data/pricemultifull?fsyms=' +
      KOIN.map((k) => k[0]).join(',') +
      '&tsyms=USD,IDR';
    const r = await fetch(url, {
      headers: { accept: 'application/json', 'user-agent': UA },
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    const raw = j && j.RAW;
    if (raw) {
      const hasil = {};
      for (const [sym, gecko] of KOIN) {
        const u = raw[sym] && raw[sym].USD;
        if (!u) continue;
        const i = raw[sym].IDR;
        hasil[gecko] = {
          usd: u.PRICE,
          idr: i ? i.PRICE : u.PRICE * 16000,
          usd_24h_change: u.CHANGEPCT24HOUR || 0,
        };
      }
      if (Object.keys(hasil).length) data = hasil;
    }
    if (!data) detail.push('CryptoCompare: jawaban kosong');
  } catch (e) {
    detail.push('CryptoCompare: ' + String(e));
  }

  // ---------- Sumber 2: CoinGecko ----------
  if (!data) {
    try {
      const url =
        'https://api.coingecko.com/api/v3/simple/price?ids=' +
        KOIN.map((k) => k[1]).join(',') +
        '&vs_currencies=usd,idr&include_24hr_change=true';
      const r = await fetch(url, {
        headers: { accept: 'application/json', 'user-agent': UA },
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (j && j.bitcoin) data = j;
      else detail.push('CoinGecko: jawaban kosong');
    } catch (e) {
      detail.push('CoinGecko: ' + String(e));
    }
  }

  // ---------- Sumber 3: Coinbase (tanpa % 24 jam, harga tetap tampil) ----------
  if (!data) {
    try {
      const hasil = {};
      for (const [sym, gecko] of KOIN) {
        const r = await fetch(
          'https://api.coinbase.com/v2/exchange-rates?currency=' + sym,
          { headers: { accept: 'application/json', 'user-agent': UA } }
        );
        if (!r.ok) continue;
        const j = await r.json();
        const rates = j && j.data && j.data.rates;
        if (!rates || !rates.USD) continue;
        hasil[gecko] = {
          usd: parseFloat(rates.USD),
          idr: rates.IDR ? parseFloat(rates.IDR) : parseFloat(rates.USD) * 16000,
          usd_24h_change: 0,
        };
      }
      if (Object.keys(hasil).length) data = hasil;
      else detail.push('Coinbase: jawaban kosong');
    } catch (e) {
      detail.push('Coinbase: ' + String(e));
    }
  }

  // ---------- Kirim hasil ----------
  if (!data) {
    return new Response(
      JSON.stringify({ error: 'Gagal mengambil harga', detail: detail }),
      {
        status: 502,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'access-control-allow-origin': '*',
        },
      }
    );
  }

  const res = new Response(JSON.stringify(data), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=' + CACHE_SECONDS,
      'access-control-allow-origin': '*',
    },
  });
  context.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}

function withCors(res) {
  const r = new Response(res.body, res);
  r.headers.set('access-control-allow-origin', '*');
  return r;
}
