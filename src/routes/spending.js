const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');
const router = express.Router();
const cache = new NodeCache({ stdTTL: 3600 });

const FEC_BASE = 'https://api.open.fec.gov/v1';

router.get('/', async (req, res) => {
  try {
    const API_KEY = process.env.FEC_API_KEY || 'DEMO_KEY';
    const { type = 'independent', candidate_id, committee_id, election_year = '2026', limit = 20 } = req.query;
    const cacheKey = `spending:${type}:${candidate_id||''}:${committee_id||''}:${election_year}:${limit}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    let result;

    if (type === 'independent') {
      // Independent expenditures (Super PAC spending for/against candidates)
      const params = {
        api_key: API_KEY,
        per_page: Math.min(parseInt(limit) || 20, 50),
        sort: '-expenditure_amount',
        is_notice: false
      };
      if (candidate_id) params.candidate_id = candidate_id;
      if (election_year) params.cycle = election_year;

      const { data } = await axios.get(`${FEC_BASE}/schedules/schedule_e/`, { params, timeout: 15000 });

      result = {
        success: true,
        type: 'independent_expenditures',
        description: 'Super PAC / outside group spending for or against candidates',
        count: (data.results || []).length,
        total_available: data.pagination?.count,
        expenditures: (data.results || []).map(e => ({
          candidate: e.candidate_name,
          candidate_id: e.candidate_id,
          support_oppose: e.support_oppose_indicator === 'S' ? 'SUPPORT' : 'OPPOSE',
          amount: e.expenditure_amount,
          date: e.expenditure_date,
          committee: e.committee_name,
          payee: e.payee_name,
          purpose: e.expenditure_description
        }))
      };

    } else {
      // Direct campaign expenditures (Schedule B)
      if (!committee_id && !candidate_id) {
        return res.status(400).json({ error: 'Provide committee_id or candidate_id for type=expenditures' });
      }
      const params = {
        api_key: API_KEY,
        per_page: Math.min(parseInt(limit) || 20, 50),
        sort: '-disbursement_amount',
        two_year_transaction_period: election_year
      };
      if (committee_id) params.committee_id = committee_id;

      const { data } = await axios.get(`${FEC_BASE}/schedules/schedule_b/`, { params, timeout: 15000 });

      result = {
        success: true,
        type: 'disbursements',
        description: 'Campaign spending — how candidates are spending their money',
        count: (data.results || []).length,
        expenditures: (data.results || []).map(e => ({
          recipient: e.recipient_name,
          amount: e.disbursement_amount,
          date: e.disbursement_date,
          purpose: e.disbursement_description,
          city: e.recipient_city,
          state: e.recipient_state
        }))
      };
    }

    result.source = 'Federal Election Commission (FEC)';
    result.disclaimer = 'Public record. Verify at fec.gov.';
    result.election_year = election_year;
    cache.set(cacheKey, result);
    res.json(result);
  } catch (err) {
    console.error('[fec/spending] Error:', err.response?.data || err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
