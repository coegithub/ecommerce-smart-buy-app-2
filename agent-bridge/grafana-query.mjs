// Read-only Grafana query helper for the triage agent (GET only, reads GRAFANA_URL/GRAFANA_TOKEN from env).
// usage: node agent-bridge/grafana-query.mjs <prom|logs|traces|ds> "<query or path>" [minutesBack]
const [kind, q = '', mins = '60'] = process.argv.slice(2)
const base = process.env.GRAFANA_URL, headers = { Authorization: `Bearer ${process.env.GRAFANA_TOKEN}` }
const end = Math.floor(Date.now() / 1000), start = end - Number(mins) * 60
const uid = { prom: 'grafanacloud-prom', logs: 'grafanacloud-logs', traces: 'grafanacloud-traces' }[kind]
let url
if (kind === 'ds') url = `${base}/api/datasources`
else if (kind === 'prom') url = `${base}/api/datasources/proxy/uid/${uid}/api/v1/query_range?` + new URLSearchParams({ query: q, start, end, step: '60' })
else if (kind === 'logs') url = `${base}/api/datasources/proxy/uid/${uid}/loki/api/v1/query_range?` + new URLSearchParams({ query: q, start: `${start}000000000`, end: `${end}000000000`, limit: '100' })
else if (kind === 'traces') url = `${base}/api/datasources/proxy/uid/${uid}/api/traces/${encodeURIComponent(q)}`
else { console.error('kind must be prom|logs|traces|ds'); process.exit(2) }
const r = await fetch(url, { headers })
console.log((await r.text()).slice(0, 20000))
