# AgentFEC — FEC Campaign Finance x402 API

Pay-per-request FEC campaign finance data for AI agents via x402 protocol.

**Base URL:** `https://fec.memoryapi.org`

## Endpoints

| Endpoint | Price | Description |
|---|---|---|
| `GET /x402/fec/candidates` | $0.01 USDC | Candidate fundraising totals by office/state/party |
| `GET /x402/fec/donors` | $0.01 USDC | Individual donor contributions (Schedule A) |
| `GET /x402/fec/spending` | $0.01 USDC | Super PAC independent expenditures + campaign disbursements |

## MCP
`POST https://fec.memoryapi.org/mcp` — 3 tools: `get_fec_candidates`, `get_fec_donors`, `get_fec_spending`

## Network
Base mainnet (eip155:8453) · USDC payments via x402 protocol

## Data Source
Federal Election Commission (FEC) — public record data from fec.gov

## License
MIT
