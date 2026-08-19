const GAS_URL = 'https://script.google.com/macros/s/AKfycbwsj97pFpQV74pzvm74msWKk6iUFpVhHliVIpmWlw4-pfAZhhgyrOQZQV05wQ8Ydlab/exec';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate');

  try {
    const response = await fetch(GAS_URL, { redirect: 'follow' });
    const data = await response.json();
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
