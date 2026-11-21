# Incident report: 502 responses during Express Pay test (2026-11-21)

**Service:** `ecommerce-smartbuy-app-2` (Render, free plan) · **Severity:** test-induced, self-recovered · **Status:** resolved (flag turned off)

## Summary
With `EXPRESS_PAY_ENABLED=true`, repeated `POST /api/orders/express` calls leaked database connections until the pool (`DB_POOL_MAX=5`) was exhausted. The app then returned 500s, failed Render's health check, and was restarted by Render. While it restarted, Render's proxy returned **502** to clients. The app never sees those requests, so they are not counted in `http_server_requests_total`, and the Grafana 5xx alert (threshold 0.05 req/s) did not fire.

## Timeline (UTC)
| Time | Event | Source |
|---|---|---|
| 08:59 | Deploy with `EXPRESS_PAY_ENABLED=true` goes live | Render events, Loki `service started` |
| ~09:02 | Express Pay orders 1-5 succeed (201); order 6 returns 500 | test script output |
| ~09:03 | `request failed path=/api/categories status=500 error="timeout exceeded when trying to connect" pool_active=5/5 pool_waiting=2` (the Render health check, 5001 ms) | Loki |
| 09:05:08 | Render `server_failed` (health check failing) | Render events |
| 09:05:23-27 | Process restarts, `server_available`; pool counters reset | Loki, Render events |
| 09:05-09:10 | Express calls leak the pool again; clients see 502 during restarts | test script output |
| 09:10:07 | Second `server_failed` | Render events |
| 09:10-09:11 | Flag set to `false`, redeploy, healthy | Render events |

`db_pool_connections_active` reached 5 of 5 twice (once per leak cycle).

## Root cause
1. **Connection leak:** `POST /express` in `server/routes/orders.js` (about lines 191-286) calls `pool.connect()` and does not release the client on the success path. One leaked connection per successful order, so the pool is exhausted after about 5 orders.
2. **Auth also starves:** with no free connections, Better Auth's session lookup fails with `APIError: Failed to get session` (logged as `Unhandled error` on `/api/orders/express`).
3. **Health check turns it into an outage:** Render's health check (`GET /api/categories`) waits 5 s for a connection, gets `timeout exceeded when trying to connect`, and returns 500. Render treats the instance as failed and restarts it.
4. **Why 502:** during the restart the proxy has no healthy upstream and answers 502 itself.

## Why monitoring missed it
- The 5xx alert query uses the app's own metric, which excludes proxy-generated 502s. Observed app-side 5xx rate peaked around 0.01 req/s against a 0.05 threshold.
- Render restarts reset the counters, which hides the build-up.

## Recommendations
1. **Fix the leak:** release the client in a `finally` block in `/express` (as `POST /` already does).
2. **Alert on the cause:** alert on `db_pool_connections_waiting > 0` or `db_pool_connections_active == db_pool_connections_max` for 1 min.
3. **Alert on the symptom the app can't see:** a Loki rule on `request failed` / `timeout exceeded when trying to connect`, and on `service started` appearing more than once in 10 minutes (restart loop).
4. **Lower the 5xx threshold** (for example 0.01 req/s) or add an external uptime check, since proxy 502s are invisible to app metrics.
5. Keep `EXPRESS_PAY_ENABLED=false` outside the incident exercise.

## Evidence
Grafana Loki (`{service_name="smartbuy-api"}`), Prometheus (`db_pool_connections_*`, `http_server_requests_total`), Render service events API.
