const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');
const router = express.Router();
const cache = new NodeCache({ stdTTL: 3600 });

const FEC_BASE = 'https://api.open.fec.gov/v1';

router.get('/', async (req, res) => {
  try {
    const API_KEY = process.env.FEC_API_KEY || 'DEMO_KEY';
    const { candidate_id, committee_id, employer, state, min_amount, election_year = '2026', limit = 20 } = req.query;


    const cacheKey = `donors:${candidate_id||''}:${committee_id||''}:${employer||''}:${state||''}:${min_amount||''}:${limit}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const params = {
      api_key: API_KEY,
      per_page: Math.min(parseInt(limit) || 20, 50),
      sort: '-contribution_receipt_amount',
      two_year_transaction_period: election_year,
      min_amount: min_amount || ((!candidate_id && !committee_id && !employer) ? '5000' : undefined)
    };
    if (candidate_id) params.candidate_id = candidate_id;
    if (committee_id) params.committee_id = committee_id;
    if (employer) params.contributor_employer = employer;
    if (state) params.contributor_state = state.toUpperCase();
    if (min_amount) params.min_amount = min_amount;

    const { data } = await axios.get(`${FEC_BASE}/schedules/schedule_a/`, { params, timeout: 15000 });

    const donors = (data.results || []).map(d => ({
      name: d.contributor_name,
      amount: d.contribution_receipt_amount,
      date: d.contribution_receipt_date,
      employer: d.contributor_employer,
      occupation: d.contributor_occupation,
      city: d.contributor_city,
      state: d.contributor_state,
      memo: d.memo_text
    }));

    const totalAmount = donors.reduce((s, d) => s + (d.amount || 0), 0);

    const result = {
      success: true,
      filters: { candidate_id, committee_id, employer, state, election_year },
      count: donors.length,
      total_available: data.pagination?.count,
      total_amount_shown: totalAmount,
      donors,
      source: 'FEC Schedule A — Individual Contributions',
      disclaimer: 'Public record. Contributions over $200 are itemized. Verify at fec.gov.'
    };

    cache.set(cacheKey, result);
    res.json(result);
  } catch (err) {
    console.error('[fec/donors] Error:', err.response?.data || err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
