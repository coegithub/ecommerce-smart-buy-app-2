# Grafana → Claude agent bridge

Grafana Cloud (machine A) --webhook--> agent-bridge (machine B) --> `claude -p` runs `grafana-error-triage` --> reports/*.md

## On the agent machine
1. Install Claude Code, log in, clone this repo.
2. Create a Grafana **service account** (role Viewer) + token: Administration > Users and access > Service accounts.
3. Run:
   ```
   export BRIDGE_SECRET=<long random string>
   export GRAFANA_URL=https://wittypiano3069.grafana.net
   export GRAFANA_TOKEN=<viewer token>
   cd agent-bridge && node server.mjs
   ```
4. Grafana Cloud must reach it over the internet. Expose port 8787 with a tunnel (e.g. `cloudflared tunnel --url http://localhost:8787`) or a public host with HTTPS.

## In Grafana
- Alerting > Contact points > New: type Webhook, URL `https://<public-url>/grafana-alert`, Authorization header scheme `Bearer`, credential = BRIDGE_SECRET.
- Alerting > Alert rules: e.g. `sum(rate(http_server_requests_total{http_status_code=~"5.."}[5m])) > 0.05`; route to that contact point.
- Use "Test" on the contact point; a report appears in `agent-bridge/reports/`.
