require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), override: true });
const express = require('express');
const cors = require('cors');
const { paymentMiddleware, x402ResourceServer } = require('@x402/express');
const { bazaarResourceServerExtension } = require('@x402/extensions');
const { ExactEvmScheme } = require('@x402/evm/exact/server');
const { HTTPFacilitatorClient } = require('@x402/core/server');

const candidatesRouter = require('./routes/candidates');
const donorsRouter = require('./routes/donors');
const spendingRouter = require('./routes/spending');
const mcpRouter = require('./routes/mcp');

const app = express();
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3009;
const PAY_TO = process.env.PAY_TO_ADDRESS || '0x24FAcafEB49b4e3FACF0B3e69604A2F4640c9bf2';
const X402_NETWORK = process.env.X402_NETWORK || 'eip155:8453';
const FACILITATOR_URL = process.env.FACILITATOR_URL || 'https://x402.org/facilitator';

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'agentfec', port: PORT }));
app.get('/.well-known/oauth-protected-resource', (req, res) => {
  res.json({ resource: 'https://fec.memoryapi.org/mcp', authorization_servers: [], bearer_methods_supported: [], resource_documentation: 'https://memoryapi.org' });
});
app.get('/.well-known/oauth-authorization-server', (req, res) => {
  res.status(404).json({ error: 'No OAuth required.' });
});

app.use('/mcp', mcpRouter);

try {
  const { createFacilitatorConfig } = require('@coinbase/x402');
  const rawConfig = createFacilitatorConfig(process.env.CDP_API_KEY_NAME, process.env.CDP_API_KEY_PRIVATE_KEY);
  const facilitatorClient = new HTTPFacilitatorClient({ url: rawConfig.url, createAuthHeaders: rawConfig.createAuthHeaders });
  const x402Server = new x402ResourceServer(facilitatorClient)
    .register(X402_NETWORK, new ExactEvmScheme())
    .registerExtension(bazaarResourceServerExtension);

  app.use(paymentMiddleware(
    {
      'GET /x402/fec/candidates': {
        accepts: [{ scheme: 'exact', price: '$0.01', network: X402_NETWORK, payTo: PAY_TO }],
        description: 'FEC campaign finance — candidate fundraising totals, cash on hand, and spending. Filter by office (S/H/P), state, party, or name.',
        extensions: { bazaar: { info: {
          description: 'Federal Election Commission campaign finance data. Get candidate fundraising totals, cash on hand, and spending for Senate, House, and Presidential races.',
          input: { type: 'http', method: 'GET',
            queryParams: { office: 'S', state: 'TX', party: 'REP', election_year: '2026', limit: '20' },
            schema: { properties: {
              office: { type: 'string', description: 'P=President, S=Senate, H=House' },
              state: { type: 'string', description: '2-letter state code' },
              party: { type: 'string', description: 'DEM, REP, IND' },
              election_year: { type: 'string', description: 'Election cycle year (default 2026)' },
              name: { type: 'string', description: 'Candidate name search' },
              limit: { type: 'string', description: 'Results count (max 50)' }
            }, required: [] }
          },
          output: { example: { success: true, election_year: '2026', candidates: [{ name: 'OSSOFF, T. JONATHAN', party: 'Democratic Party', office: 'Senate', state: 'GA', raised: 81146109, cash_on_hand: 32504436 }] } }
        }}}
      },

      'GET /x402/fec/donors': {
        accepts: [{ scheme: 'exact', price: '$0.01', network: X402_NETWORK, payTo: PAY_TO }],
        description: 'FEC individual donor data — who is contributing to campaigns. Search by candidate, committee, or donor employer.',
        extensions: { bazaar: { info: {
          description: 'FEC Schedule A individual contribution data. Find who is funding campaigns by candidate ID, committee ID, or donor employer.',
          input: { type: 'http', method: 'GET',
            queryParams: { candidate_id: 'S6GA00097', election_year: '2026', limit: '20' },
            schema: { properties: {
              candidate_id: { type: 'string', description: 'FEC candidate ID' },
              committee_id: { type: 'string', description: 'FEC committee ID' },
              employer: { type: 'string', description: 'Donor employer (e.g. Google, Goldman Sachs)' },
              state: { type: 'string', description: 'Donor state filter' },
              min_amount: { type: 'string', description: 'Minimum contribution amount' },
              election_year: { type: 'string', description: 'Election cycle year' }
            }, required: [] }
          },
          output: { example: { success: true, donors: [{ name: 'SMITH, JOHN', amount: 5800, employer: 'Google', occupation: 'Software Engineer', state: 'CA' }] } }
        }}}
      },

      'GET /x402/fec/spending': {
        accepts: [{ scheme: 'exact', price: '$0.01', network: X402_NETWORK, payTo: PAY_TO }],
        description: 'FEC campaign spending — Super PAC independent expenditures for/against candidates, and direct campaign disbursements.',
        extensions: { bazaar: { info: {
          description: 'FEC spending data. Independent expenditures (Super PAC spending for/against candidates) or direct campaign disbursements.',
          input: { type: 'http', method: 'GET',
            queryParams: { type: 'independent', election_year: '2026', limit: '20' },
            schema: { properties: {
              type: { type: 'string', description: 'independent (Super PAC) or expenditures (campaign direct spending)' },
              candidate_id: { type: 'string', description: 'Filter by candidate ID' },
              committee_id: { type: 'string', description: 'Required for type=expenditures' },
              election_year: { type: 'string', description: 'Election cycle year' }
            }, required: [] }
          },
          output: { example: { success: true, type: 'independent_expenditures', expenditures: [{ candidate: 'OSSOFF, JOHN', support_oppose: 'SUPPORT', amount: 2500000, committee: 'SENATE MAJORITY PAC' }] } }
        }}}
      }
    },
    x402Server,
    { afterSettle: (req, res, next, s) => { const e = s?.extensionResponses; if (e) console.log('[CDP] EXTENSION-RESPONSES:', JSON.stringify(e)); next(); } },
    null, true
  ));

  console.log('✅ x402 payment middleware registered');
} catch (err) {
  console.warn('⚠️  x402 middleware skipped:', err.message);
}

app.use('/x402/fec/candidates', candidatesRouter);
app.use('/x402/fec/donors', donorsRouter);
app.use('/x402/fec/spending', spendingRouter);

app.listen(PORT, () => console.log(`AgentFEC running on port ${PORT}`));
