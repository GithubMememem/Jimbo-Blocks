# Proxy Clone

This service provides a functional reverse-proxy clone shell aimed at mirroring an upstream proxy website, with:

- Full request pass-through for the configured upstream.
- HTML URL rewriting so links and asset fetches continue through this proxy.
- User-agent masking via a rotating desktop UA pool (or fixed override).
- A direct `/proxy?url=...` endpoint that rewrites target URLs into proxied routes.

> Default upstream target: `http://143.244.204.138`

## Run

```bash
cd proxy-clone
npm install
npm start
```

Server defaults to `http://localhost:8080`.

## Environment variables

- `PORT` (default `8080`)
- `TARGET_ORIGIN` (default `http://143.244.204.138`)
- `MASKED_USER_AGENT` (optional fixed UA override)

## Endpoints

- `GET /` — proxies the configured upstream root.
- `GET /health` — quick service health check.
- `GET /proxy?url=https://example.com/path` — redirects to encoded proxied path.
- `GET /p/<base64url(full-upstream-url)>` — fetches and proxies specific upstream URL.

## Notes

- Only `http` and `https` upstream URLs are accepted for safety.
- HTML rewriting covers common attributes: `href`, `src`, `action`, `poster`, and CSS `url(...)` values.
