// Serverless function that holds your Google Gemini API key privately.
// The browser never sees the key — it only calls this endpoint.
//
// Set GEMINI_API_KEY in your Vercel project's Environment Variables.
// Get a free key at https://aistudio.google.com/apikey

// Tried in order. If the first isn't available on your account/tier,
// the next is tried automatically.
const MODELS = [
  'gemini-flash-latest',
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-flash-lite-latest'
];

function buildPrompt(v) {
  const lines = [
    `Year: ${v.year}`,
    `Make: ${v.make}`,
    `Model: ${v.model}`
  ];
  if (v.trim) lines.push(`Trim: ${v.trim}`);
  if (v.mileage) lines.push(`Mileage: ${v.mileage}`);
  if (v.price) lines.push(`Asking price: $${v.price}`);
  if (v.condition) lines.push(`Condition and notes: ${v.condition}`);

  return `You are a thorough, honest used-car buying advisor. Two different people rely on your answer: someone who knows nothing about cars and just wants to know if a listing is a fair deal, and an experienced car flipper who wants a specific number to buy at for profit. Serve both.

Here is a vehicle someone is considering buying:

${lines.join('\n')}

Do the following, using web search to check real current data rather than relying only on general knowledge:

1. Look up current market values for this specific vehicle at this mileage and condition, from sources like Kelley Blue Book, Edmunds, and NADA/J.D. Power guides, plus comparable recent listings or completed sales. Give as PRECISE a figure as the sources actually support — to the nearest $50-100 where the data allows it, not rounded off to the nearest thousand. Give THREE separate ranges, because these differ meaningfully:
   - trade_in: what a dealer would likely pay outright
   - private_party: what it should sell for between two individuals (most relevant to a Facebook Marketplace/Craigslist/OfferUp listing)
   - dealer_retail: what a dealer would likely list it for after reconditioning
2. ${v.price
    ? 'Compare the asking price to the private_party range specifically. Give a one-line verdict, in plain language a total beginner would understand, plus a tier: "good" (at or below fair private-party value), "fair" (within normal private-party range), or "high" (notably above private-party value).'
    : 'No asking price was given. Give a one-line verdict, in plain language a total beginner would understand, summarizing what this vehicle is worth privately, and set verdict_tier to "fair".'}
3. Write a short analysis (4-6 sentences, plain language, no markdown formatting, no jargon a novice wouldn't know) explaining the reasoning — mileage relative to typical miles/year for this age, trim and condition factors, and how it compares to similar listings you found.
4. Identify the SINGLE most common, most expensive, or most relevant problem for this exact year/make/model at approximately this mileage specifically (not a generic list yet — the one issue a buyer most needs to know about right now, given the mileage). Explain in plain terms what it is and why it matters at this mileage. Give a specific dollar range to deduct from an offer if this issue is present and not yet fixed, so a complete beginner could read it and know exactly how much lower to offer.
5. List 2-4 OTHER commonly reported problems for this year/make/model (besides the headline one above), each with a rough repair cost and how much it should affect price or negotiation.
6. Give a short checklist (4-6 items) of specific things to check when inspecting or test-driving THIS vehicle, informed by the issues above — concrete actions, not generic advice.
7. For an experienced car flipper: state the maximum price they should pay to resell this vehicle for a solid, worthwhile profit after realistic reconditioning costs (covering the headline issue if relevant, typical detailing/minor repairs, and a margin for their time and risk — roughly $1,500-2,500 net profit is a reasonable target, scaled a bit for the vehicle's price range). Briefly show the logic: target resale price minus recon/repair costs minus target profit equals the buy price.
8. From your web search, list 2-4 actual comparable vehicles currently for sale or recently sold (similar year/make/model and mileage) that you found real listings for. For each, give a short description, the price, the mileage, and which site or source it came from (e.g. "Cars.com", "AutoTrader", "CarGurus", "Edmunds inventory"). Only include ones you actually found in search results — do not invent examples.

Respond with ONLY a raw JSON object. No markdown code fences. No text before or after it. Use exactly this shape:
{
  "trade_in_low": 6450, "trade_in_high": 7900,
  "private_party_low": 8600, "private_party_high": 11350,
  "dealer_retail_low": 10950, "dealer_retail_high": 13800,
  "verdict": "short one-line verdict in plain language",
  "verdict_tier": "good",
  "analysis": "short paragraph",
  "top_issue": {
    "issue": "short issue name",
    "explain_simple": "one to two sentences, plain language, why this matters at this mileage",
    "deduction_low": 400, "deduction_high": 900
  },
  "common_issues": [
    {"issue": "short issue name", "cost": "typical repair cost or range", "impact": "how this should affect price or negotiation, one sentence"}
  ],
  "inspection_checklist": ["specific check one", "specific check two"],
  "flip_target_price": 7800,
  "flip_reasoning": "one to two sentences showing target resale minus recon costs minus profit margin",
  "comparable_listings": [
    {"description": "short description, e.g. 2015 GMC Sierra 1500 SLE, similar trim", "price": "$9,200", "mileage": "187,000 mi", "source": "Cars.com"}
  ],
  "sources_note": "short mention of what kind of sources were used"
}

verdict_tier must be exactly one of: good, fair, high.
All price numbers must be plain integers with no commas, dollar signs, or quotes, EXCEPT inside comparable_listings where price and mileage are short display strings.
common_issues must have between 2 and 4 entries (not counting top_issue). inspection_checklist must have between 4 and 6 entries. comparable_listings must have between 0 and 4 entries — leave it an empty array if you found no real comparable listings, never invent one.`;
}

async function callGemini(model, apiKey, prompt, useSearch) {
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0, maxOutputTokens: 3584 }
  };
  if (useSearch) body.tools = [{ google_search: {} }];

  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body)
    }
  );

  const text = await resp.text();
  return { ok: resp.ok, status: resp.status, text };
}

function parseGeminiText(raw) {
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    return null;
  }
  const candidate = data.candidates && data.candidates[0];
  if (!candidate) return null;
  const parts = (candidate.content && candidate.content.parts) || [];
  const joined = parts.map(p => p.text || '').filter(Boolean).join('\n');
  if (!joined) return null;

  // Real pages Google's search grounding actually looked at, if any.
  let groundingSources = [];
  const chunks = candidate.groundingMetadata && candidate.groundingMetadata.groundingChunks;
  if (Array.isArray(chunks)) {
    const seen = new Set();
    chunks.forEach(chunk => {
      const uri = chunk.web && chunk.web.uri;
      const title = (chunk.web && chunk.web.title) || uri;
      if (uri && !seen.has(uri)) {
        seen.add(uri);
        groundingSources.push({ title, uri });
      }
    });
    groundingSources = groundingSources.slice(0, 6);
  }

  return { text: joined, groundingSources };
}

function extractJson(text) {
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch (e) {
    return null;
  }
}

function shortError(rawText) {
  // Pull Google's human-readable message out of its error envelope
  try {
    const parsed = JSON.parse(rawText);
    if (parsed.error && parsed.error.message) {
      return String(parsed.error.message).slice(0, 400);
    }
  } catch (e) { /* fall through */ }
  return String(rawText).slice(0, 400);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'Server is missing its GEMINI_API_KEY environment variable. Add it in Vercel under Settings > Environment Variables, then redeploy.'
    });
  }

  const v = req.body || {};
  if (!v.year || !v.make || !v.model) {
    return res.status(400).json({ error: 'Year, make, and model are required.' });
  }

  const prompt = buildPrompt(v);
  let lastStatus = null;
  let lastDetail = null;

  // Try each model, first with search grounding, then without.
  for (const model of MODELS) {
    for (const useSearch of [true, false]) {
      let result;
      try {
        result = await callGemini(model, apiKey, prompt, useSearch);
      } catch (err) {
        lastStatus = 500;
        lastDetail = `Network error calling ${model}: ${err.message}`;
        continue;
      }

      if (result.ok) {
        const parsedGemini = parseGeminiText(result.text);
        if (!parsedGemini) {
          lastStatus = 502;
          lastDetail = `${model} returned no usable text.`;
          continue;
        }
        const parsed = extractJson(parsedGemini.text);
        if (!parsed) {
          lastStatus = 502;
          lastDetail = `${model} response was not valid JSON: ${parsedGemini.text.slice(0, 200)}`;
          continue;
        }

        [
          'trade_in_low', 'trade_in_high',
          'private_party_low', 'private_party_high',
          'dealer_retail_low', 'dealer_retail_high',
          'flip_target_price'
        ].forEach(key => {
          if (typeof parsed[key] === 'string') {
            const n = parseInt(parsed[key].replace(/[^0-9]/g, ''), 10);
            parsed[key] = Number.isFinite(n) ? n : null;
          }
        });

        if (parsed.top_issue && typeof parsed.top_issue === 'object') {
          ['deduction_low', 'deduction_high'].forEach(key => {
            if (typeof parsed.top_issue[key] === 'string') {
              const n = parseInt(parsed.top_issue[key].replace(/[^0-9]/g, ''), 10);
              parsed.top_issue[key] = Number.isFinite(n) ? n : null;
            }
          });
        }

        parsed.model_used = model;
        parsed.search_used = useSearch;
        parsed.grounding_sources = parsedGemini.groundingSources || [];
        if (!Array.isArray(parsed.comparable_listings)) parsed.comparable_listings = [];
        if (!useSearch) {
          parsed.sources_note = (parsed.sources_note || '') +
            ' (Note: live web search was unavailable for this request, so this estimate comes from the model\'s general knowledge. Check the value links above to confirm.)';
        }

        return res.status(200).json(parsed);
      }

      lastStatus = result.status;
      lastDetail = `${model}${useSearch ? ' with search' : ' without search'}: ${shortError(result.text)}`;

      // A 401/403 is a key problem — no point trying other models.
      if (result.status === 401 || result.status === 403) {
        return res.status(502).json({
          error: 'Google rejected the API key. Check that GEMINI_API_KEY is correct in Vercel, and that the key has no IP or referrer restrictions.',
          detail: lastDetail
        });
      }
    }
  }

  // Everything failed — report what Google actually said.
  let message;
  if (lastStatus === 429) {
    message = 'Google returned a quota error. This can mean the per-minute free tier limit, or that the daily free quota for this model is used up. Wait a minute and try again.';
  } else if (lastStatus === 404) {
    message = 'None of the model names worked — Google may have renamed them. Check ai.google.dev/gemini-api/docs/models and update the MODELS list in api/appraise.js.';
  } else if (lastStatus === 400) {
    message = 'Google rejected the request. The exact reason is below.';
  } else {
    message = 'The valuation service could not be reached. The exact error is below.';
  }

  return res.status(502).json({ error: message, detail: lastDetail });
}
