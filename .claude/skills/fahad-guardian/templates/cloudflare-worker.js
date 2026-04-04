// Cloudflare Worker Function template — fahad-guardian
export async function onRequest(context) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  };
  try {
    const apiKey = context.env.MY_API_KEY;
    if (!apiKey) throw new Error('API key not configured');
    const res = await fetch(`https://api.example.com?key=${apiKey}`);
    const data = await res.json();
    return new Response(JSON.stringify(data), { headers });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers,
    });
  }
}
