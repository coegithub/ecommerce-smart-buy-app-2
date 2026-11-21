// Receives Grafana alert webhooks and runs the grafana-error-triage agent
// (Claude Code headless) on THIS machine. Reports are saved to ./reports.
import http from 'node:http'
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { timingSafeEqual } from 'node:crypto'
import path from 'node:path'

const PORT = Number(process.env.BRIDGE_PORT || 8787)
const SECRET = process.env.BRIDGE_SECRET
const REPO_DIR = path.resolve(process.env.REPO_DIR || '..')
const REPORT_DIR = path.resolve('reports')
if (!SECRET) throw new Error('Set BRIDGE_SECRET')
mkdirSync(REPORT_DIR, { recursive: true })

const running = new Set() // dedupe by alert fingerprint
const ok = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))

function triage(alert) {
  const key = alert.fingerprint || alert.labels?.alertname || String(Date.now())
  if (running.has(key)) return
  running.add(key)
  const prompt = `Use the grafana-error-triage agent to investigate this Grafana alert and give the final report.\n\n${JSON.stringify(alert, null, 2).slice(0, 8000)}`
  const p = spawn('claude', ['-p', prompt, '--permission-mode', 'default', '--allowedTools', 'Bash(curl:*) Read Grep Glob Agent'], { cwd: REPO_DIR, shell: process.platform === 'win32' })
  let out = ''
  p.stdout.on('data', d => (out += d))
  p.stderr.on('data', d => (out += d))
  p.on('close', code => {
    running.delete(key)
    const f = path.join(REPORT_DIR, `${new Date().toISOString().replace(/[:.]/g, '-')}-${(alert.labels?.alertname || 'alert').replace(/\W+/g, '_')}.md`)
    writeFileSync(f, out)
    console.log(`triage done (exit ${code}) -> ${f}`)
  })
}

http.createServer((req, res) => {
  const auth = (req.headers.authorization || '').replace(/^Bearer /, '')
  if (req.method !== 'POST' || req.url !== '/grafana-alert' || !ok(auth, SECRET)) { res.writeHead(401).end(); return }
  let body = ''
  req.on('data', d => { if ((body += d).length > 1e6) req.destroy() })
  req.on('end', () => {
    try {
      const payload = JSON.parse(body)
      for (const a of (payload.alerts || []).filter(a => a.status === 'firing')) triage(a)
      res.writeHead(202).end('accepted')
    } catch { res.writeHead(400).end() }
  })
}).listen(PORT, () => console.log(`agent-bridge listening on :${PORT}`))
