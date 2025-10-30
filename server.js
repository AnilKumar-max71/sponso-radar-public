
// server.js - minimal demo backend for SponsoRadar
// NOTE: Demo only. Use proper auth and persistent DB in production.
const express = require('express');
const fetch = require('node-fetch');
const parse = require('csv-parse/lib/sync');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const CSV_URL = 'https://assets.publishing.service.gov.uk/media/6901df1b3650bacb01af6ff6/2025-10-29_-_Worker_and_Temporary_Worker.csv';
const INDEX_FILE = path.join(__dirname, 'gov_index.json');
const app = express();
app.use(cors());
app.use(express.json());

async function fetchAndIndex() {
  try {
    const res = await fetch(CSV_URL);
    if (!res.ok) throw new Error('Fetch failed: ' + res.status);
    const text = await res.text();
    const records = parse(text, { columns: true, skip_empty_lines: true });
    const index = {};
    for (const r of records) {
      const name = (r['Organisation name'] || r['Organisation'] || r['Employer name'] || r['Trading name'] || '').trim();
      if (!name) continue;
      const key = name.toLowerCase().replace(/\\b(ltd|limited|plc|co\\.?|company|the|llp)\\b/g,'').replace(/[^a-z0-9\\s]/g,'').replace(/\\s+/g,' ').trim();
      const minimal = { name: name, trading: (r['Trading name']||''), licence: (r['Licence number']||''), type: (r['Licence type']||r['Category']||'') };
      if (!index[key]) index[key] = [];
      index[key].push(minimal);
    }
    fs.writeFileSync(INDEX_FILE, JSON.stringify(index), 'utf8');
    console.log('Index written, entries:', Object.keys(index).length);
  } catch (err) {
    console.error('fetchAndIndex error', err);
  }
}

// on startup, fetch and index (async)
fetchAndIndex();

app.get('/api/lookup', (req, res) => {
  const q = (req.query.q||'').trim();
  if (!q) return res.json({ok:false, error:'missing q'});
  let index = {};
  if (fs.existsSync(INDEX_FILE)) {
    index = JSON.parse(fs.readFileSync(INDEX_FILE,'utf8'));
  }
  const key = q.toLowerCase().replace(/\\b(ltd|limited|plc|co\\.?|company|the|llp)\\b/g,'').replace(/[^a-z0-9\\s]/g,'').replace(/\\s+/g,' ').trim();
  if (index[key]) return res.json({ok:true, matchType:'exact', matches:index[key].slice(0,5)});
  // fuzzy token overlap
  const qTokens = new Set(key.split(' ').filter(Boolean));
  let best = null;
  for (const cand of Object.keys(index)) {
    const cTokens = new Set(cand.split(' ').filter(Boolean));
    const inter = new Set([...qTokens].filter(x=>cTokens.has(x)));
    const union = new Set([...qTokens, ...cTokens]);
    const score = union.size ? (inter.size/union.size) : 0;
    if (!best || score > best.score) best = {cand, score};
  }
  if (best && best.score >= 0.45) return res.json({ok:true, matchType:'fuzzy', score:best.score, matches:index[best.cand].slice(0,5)});
  return res.json({ok:true, matchType:'none', message:'No match found'});
});

app.listen(3000, () => console.log('SponsoRadar demo backend listening on http://localhost:3000'));
