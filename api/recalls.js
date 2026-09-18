// Free proxy to NHTSA's public recall API (api.nhtsa.gov). No key needed —
// this just runs server-side so the browser doesn't have to deal with CORS.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { make, model, year } = req.body || {};
  if (!make || !model || !year) {
    return res.status(400).json({ error: 'Make, model, and year are required.' });
  }

  const url = `https://api.nhtsa.gov/recalls/recallsByVehicle?make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}&modelYear=${encodeURIComponent(year)}`;

  try {
    const upstream = await fetch(url);
    if (!upstream.ok) {
      return res.status(502).json({ error: `NHTSA's API returned an error (${upstream.status}).` });
    }
    const data = await upstream.json();
    const results = Array.isArray(data.results) ? data.results : [];

    const recalls = results.map(r => ({
      campaignNumber: r.NHTSACampaignNumber || null,
      component: r.Component || null,
      summary: r.Summary || null,
      consequence: r.Consequence || null,
      remedy: r.Remedy || null,
      reportDate: r.ReportReceivedDate || null,
      parkIt: !!r.parkIt
    }));

    return res.status(200).json({ recalls, count: recalls.length });
  } catch (err) {
    return res.status(500).json({ error: 'Could not reach NHTSA. Try again in a moment.' });
  }
}
