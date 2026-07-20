

const CACHE_SECONDS = 60;

// Peta id CoinGecko → id CoinCap
const MAP = {
  bitcoin: 'bitcoin',
  ethereum: 'ethereum',
  solana: 'solana',
  ripple: 'xrp',
  binancecoin: 'binance-coin',
};

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

export async function onRequest(context) {
  const cache = caches.default;
  const cacheKey = new Request('https://akuruna-cache.local/api/prices');

  const cached = await cache.match(cacheKey);
  if (cached) return withCors(cached);

  let data = null;
  const detail = [];

  // ---------- Sumber 1: CoinGecko ----------
  try {
    const url =
      'https://api.coingecko.com/api/v3/simple/price?ids=' +
      Object.keys(MAP).join(',') +
      '&vs_currencies=usd,idr&include_24hr_change=true';
    const r = await fetch(url, {
      headers: { accept: 'application/json', 'user-agent': UA },
    });
    if (r.ok) {
      const j = await r.json();
      if (j && j.bitcoin) data = j;
      else detail.push('CoinGecko: jawaban kosong');
    } else {
      detail.push('CoinGecko HTTP ' + r.status);
    }
  } catch (e) {
    detail.push('CoinGecko: ' + String(e));
  }

  // ---------- Sumber 2 (cadangan): CoinCap + kurs USD→IDR ----------
  if (!data) {
    try {
      const [ra, rk] = await Promise.all([
        fetch(
          'https://api.coincap.io/v2/assets?ids=' +
            Object.values(MAP).join(','),
          { headers: { accept: 'application/json', 'user-agent': UA } }
        ),
        fetch('https://open.er-api.com/v6/latest/USD', {
          headers: { accept: 'application/json', 'user-agent': UA },
        }),
      ]);
      if (!ra.ok) throw new Error('CoinCap HTTP ' + ra.status);
      const aj = await ra.json();

      let kursIdr = 16000; // perkiraan aman jika kurs gagal diambil
      if (rk.ok) {
        const kj = await rk.json();
        if (kj && kj.rates && kj.rates.IDR) kursIdr = kj.rates.IDR;
      }

      const hasil = {};
      for (const geckoId of Object.keys(MAP)) {
        const capId = MAP[geckoId];
        const aset = (aj.data || []).find((x) => x.id === capId);
        if (!aset) continue;
        const usd = parseFloat(aset.priceUsd);
        hasil[geckoId] = {
          usd: usd,
          idr: usd * kursIdr,
          usd_24h_change: parseFloat(aset.changePercent24Hr) || 0,
        };
      }
      if (Object.keys(hasil).length) data = hasil;
      else detail.push('CoinCap: jawaban kosong');
    } catch (e) {
      detail.push('CoinCap: ' + String(e));
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
