const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');
const router = express.Router();
const cache = new NodeCache({ stdTTL: 3600 }); // 1hr cache

const FEC_BASE = 'https://api.open.fec.gov/v1';

router.get('/', async (req, res) => {
  try {
    const API_KEY = process.env.FEC_API_KEY || 'DEMO_KEY';
    const { office, state, party, election_year = '2026', name, limit = 20 } = req.query;
    const cacheKey = `candidates:${office||''}:${state||''}:${party||''}:${election_year}:${name||''}:${limit}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    // Get candidate list
    const params = {
      api_key: API_KEY,
      election_year,
      per_page: Math.min(parseInt(limit) || 20, 50),
      is_active_candidate: true
    };
    if (office) params.office = office.toUpperCase().charAt(0); // P, S, H
    if (state) params.state = state.toUpperCase();
    if (party) params.party = party.toUpperCase();
    if (name) params.q = name;

    const { data } = await axios.get(`${FEC_BASE}/candidates/totals/`, { params, timeout: 15000 });

    const results = (data.results || []).map(c => ({
      candidate_id: c.candidate_id,
      name: c.name,
      party: c.party_full || c.party,
      office: c.office_full || c.office,
      state: c.state,
      district: c.district,
      raised: c.receipts,
      spent: c.disbursements,
      cash_on_hand: c.cash_on_hand_end_period,
      debt: c.debts_owed_by_committee,
      election_year: c.election_year,
      incumbent_challenge: c.incumbent_challenge_full
    }));

    const result = {
      success: true,
      election_year,
      filters: { office: office || 'all', state: state || 'all', party: party || 'all' },
      count: results.length,
      total_available: data.pagination?.count,
      candidates: results,
      source: 'Federal Election Commission (FEC)',
      disclaimer: 'Campaign finance data is public record. Verify at fec.gov before any action.'
    };

    cache.set(cacheKey, result);
    res.json(result);
  } catch (err) {
    console.error('[fec/candidates] Error:', err.response?.data || err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
