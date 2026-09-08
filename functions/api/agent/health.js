export async function onRequestGet({ env }) {
  const ready = Boolean(
    env.OPENAI_API_KEY &&
    env.WP_CLIENT_ID &&
    env.WP_CLIENT_SECRET &&
    env.AGENT_ADMIN_KEY &&
    env.AGENT_DB
  );

  return new Response(
    JSON.stringify({
      ready,
      message: ready
        ? "Pengaturan agen tersedia. Koneksi belum diuji."
        : "Ada variabel atau binding yang belum tersedia."
    }),
    {
      status: ready ? 200 : 503,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store"
      }
    }
  );
}
