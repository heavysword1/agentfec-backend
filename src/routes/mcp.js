const express = require('express');
const axios = require('axios');
const router = express.Router();

const FEC_BASE = 'https://api.open.fec.gov/v1';

const TOOLS = [
  {
    name: 'get_fec_candidates',
    description: 'Get FEC campaign finance data for federal election candidates. Returns fundraising totals, cash on hand, and spending by office (President/Senate/House), state, or party.',
    inputSchema: {
      type: 'object',
      properties: {
        office: { type: 'string', description: 'P=President, S=Senate, H=House' },
        state: { type: 'string', description: '2-letter state code (TX, CA, NY)' },
        party: { type: 'string', description: 'DEM, REP, IND' },
        election_year: { type: 'string', description: 'Election cycle year (default: 2026)', default: '2026' },
        name: { type: 'string', description: 'Candidate name search' },
        limit: { type: 'number', description: 'Number of results (max 50)', default: 20 }
      }
    }
  },
  {
    name: 'get_fec_donors',
    description: 'Get individual donor/contribution data for a candidate or committee from FEC Schedule A filings. Find who is funding campaigns.',
    inputSchema: {
      type: 'object',
      properties: {
        candidate_id: { type: 'string', description: 'FEC candidate ID (e.g. P80001571)' },
        committee_id: { type: 'string', description: 'FEC committee ID (e.g. C00703975)' },
        employer: { type: 'string', description: 'Donor employer to search (e.g. "Google", "Goldman Sachs")' },
        state: { type: 'string', description: 'Donor state filter' },
        min_amount: { type: 'number', description: 'Minimum donation amount' },
        election_year: { type: 'string', description: 'Election cycle (default: 2026)', default: '2026' },
        limit: { type: 'number', description: 'Number of results', default: 20 }
      }
    }
  },
  {
    name: 'get_fec_spending',
    description: 'Get campaign spending data. Type=independent for Super PAC / outside group spending for/against candidates. Type=expenditures for direct campaign spending.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'independent (Super PAC spending) or expenditures (campaign disbursements)', default: 'independent' },
        candidate_id: { type: 'string', description: 'Filter by candidate ID' },
        committee_id: { type: 'string', description: 'Committee ID (required for type=expenditures)' },
        election_year: { type: 'string', description: 'Election cycle (default: 2026)', default: '2026' },
        limit: { type: 'number', description: 'Number of results', default: 20 }
      }
    }
  }
];

async function executeTool(name, args) {
  const API_KEY = process.env.FEC_API_KEY || 'DEMO_KEY';

  switch (name) {
    case 'get_fec_candidates': {
      const { office, state, party, election_year = '2026', name: qname, limit = 20 } = args;
      const params = { api_key: API_KEY, election_year, per_page: Math.min(limit, 50), is_active_candidate: true };
      if (office) params.office = office.toUpperCase().charAt(0);
      if (state) params.state = state.toUpperCase();
      if (party) params.party = party.toUpperCase();
      if (qname) params.q = qname;
      const { data } = await axios.get(`${FEC_BASE}/candidates/totals/`, { params, timeout: 15000 });
      return {
        success: true, election_year, count: (data.results||[]).length, total: data.pagination?.count,
        candidates: (data.results||[]).map(c => ({ id: c.candidate_id, name: c.name, party: c.party_full||c.party, office: c.office_full||c.office, state: c.state, raised: c.receipts, spent: c.disbursements, cash_on_hand: c.cash_on_hand_end_period, incumbent: c.incumbent_challenge_full })),
        source: 'FEC'
      };
    }
    case 'get_fec_donors': {
      const { candidate_id, committee_id, employer, state, min_amount, election_year = '2026', limit = 20 } = args;
      if (!candidate_id && !committee_id && !employer) throw new Error('Provide candidate_id, committee_id, or employer');
      const params = { api_key: API_KEY, per_page: Math.min(limit, 50), sort: '-contribution_receipt_amount', two_year_transaction_period: election_year };
      if (candidate_id) params.candidate_id = candidate_id;
      if (committee_id) params.committee_id = committee_id;
      if (employer) params.contributor_employer = employer;
      if (state) params.contributor_state = state.toUpperCase();
      if (min_amount) params.min_amount = min_amount;
      const { data } = await axios.get(`${FEC_BASE}/schedules/schedule_a/`, { params, timeout: 15000 });
      const donors = (data.results||[]).map(d => ({ name: d.contributor_name, amount: d.contribution_receipt_amount, date: d.contribution_receipt_date, employer: d.contributor_employer, occupation: d.contributor_occupation, state: d.contributor_state }));
      return { success: true, count: donors.length, total_available: data.pagination?.count, donors, source: 'FEC Schedule A' };
    }
    case 'get_fec_spending': {
      const { type = 'independent', candidate_id, committee_id, election_year = '2026', limit = 20 } = args;
      if (type === 'independent') {
        const params = { api_key: API_KEY, per_page: Math.min(limit, 50), sort: '-expenditure_amount', is_notice: false };
        if (candidate_id) params.candidate_id = candidate_id;
        if (election_year) params.cycle = election_year;
        const { data } = await axios.get(`${FEC_BASE}/schedules/schedule_e/`, { params, timeout: 15000 });
        return { success: true, type: 'independent_expenditures', count: (data.results||[]).length, expenditures: (data.results||[]).map(e => ({ candidate: e.candidate_name, support_oppose: e.support_oppose_indicator === 'S' ? 'SUPPORT' : 'OPPOSE', amount: e.expenditure_amount, committee: e.committee_name, purpose: e.expenditure_description, date: e.expenditure_date })), source: 'FEC Schedule E' };
      } else {
        if (!committee_id) throw new Error('committee_id required for type=expenditures');
        const params = { api_key: API_KEY, per_page: Math.min(limit, 50), sort: '-disbursement_amount', committee_id, two_year_transaction_period: election_year };
        const { data } = await axios.get(`${FEC_BASE}/schedules/schedule_b/`, { params, timeout: 15000 });
        return { success: true, type: 'disbursements', count: (data.results||[]).length, expenditures: (data.results||[]).map(e => ({ recipient: e.recipient_name, amount: e.disbursement_amount, purpose: e.disbursement_description, date: e.disbursement_date })), source: 'FEC Schedule B' };
      }
    }
    default: throw new Error(`Unknown tool: ${name}`);
  }
}

router.get('/', (req, res) => {
  res.json({ name: 'AgentFEC', version: '1.0.0', transport: 'http', protocol: 'mcp', tools: TOOLS.map(t => t.name) });
});

router.post('/', async (req, res) => {
  const { method, params, id } = req.body;
  try {
    let result;
    switch (method) {
      case 'initialize':
        result = { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'AgentFEC', version: '1.0.0' } };
        break;
      case 'tools/list':
        result = { tools: TOOLS };
        break;
      case 'tools/call': {
        const { name, arguments: args = {} } = params;
        const toolResult = await executeTool(name, args);
        result = { content: [{ type: 'text', text: JSON.stringify(toolResult, null, 2) }] };
        break;
      }
      default:
        return res.json({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } });
    }
    res.json({ jsonrpc: '2.0', id, result });
  } catch (err) {
    res.json({ jsonrpc: '2.0', id, error: { code: -32000, message: err.message } });
  }
});

module.exports = router;
