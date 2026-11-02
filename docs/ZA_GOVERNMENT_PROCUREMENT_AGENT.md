# South African Government Procurement Agent

RyanAI's Government Procurement Agent is restricted to public, official procurement information and explicitly configured read-only National Treasury OCDS endpoints.

## Official sources

- National Treasury Transparency Portal: https://data.etenders.gov.za/
- OCDS API specification: https://ocds-api.etenders.gov.za/swagger/index.html
- eTender opportunities: https://www.etenders.gov.za/home/opportunities
- Central Supplier Database: https://secure.csd.gov.za/
- OCPO supplier guidance: https://ocpo.treasury.gov.za/

The Transparency Portal publishes procurement information in OCDS-compatible CSV, JSON and Excel formats and provides a JSON REST API. Its own publication policy warns that its coverage is incomplete and data quality is beta; verify every opportunity against the issuing entity's official notice and tender pack.

## Scope and safeguards

- Public tender discovery, procurement-plan research, awards/contracts analysis and supplier-readiness checklists.
- No direct database extraction, credential collection, login automation, CAPTCHA bypass, scraping of authenticated records or access-control bypass.
- CSD supplier registration and account information remain account-holder-controlled and require authorised human access.
- API retrieval is HTTPS-only and restricted to `ocds-api.etenders.gov.za` and `data.etenders.gov.za`.
- Requests are read-only, time-limited, bounded to 2 MB and at most 100 records.
- No bid submission, supplier registration, payment, or procurement-system mutation is automated.
- Do not treat portal data as a complete record of all state procurement.

## Configuration

After checking the current National Treasury OpenAPI specification, set `ZA_GOV_PROCUREMENT_API_URL` to a documented read-only OCDS release endpoint on the approved host. The service reads `ZA_GOV_PROCUREMENT_API_URL` by default, or accepts an explicit `apiUrl` in its request for testability. Set the variable to the exact documented endpoint and filters from the OpenAPI specification; no endpoint path or query parameter is guessed by the agent.

The worker is exposed as `RyanAIAgentWorkers.runGovernmentProcurementAgent({ query, apiUrl?, limit? })`. A missing endpoint returns official source discovery links rather than pretending to have retrieved live records.

## Business workflow

For a supplier such as a security-services provider, use queries around guarding, armed response, CCTV, access control, event security and related categories. The agent should produce a shortlist, closing-date checklist, mandatory-returnables checklist and compliance gaps. A human must verify eligibility, pricing, tax/CSD status, B-BBEE/other declarations and submit through the official channel.
