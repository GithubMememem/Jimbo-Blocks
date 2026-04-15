import express from 'express';
import {createProxyMiddleware, responseInterceptor} from 'http-proxy-middleware';

const app = express();

const PORT = Number(process.env.PORT || 8080);
const DEFAULT_TARGET = 'http://143.244.204.138';
const USER_AGENT_POOL = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
];

function toBase64Url(value) {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function fromBase64Url(value) {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function normalizeTarget(input) {
  if (!input) return DEFAULT_TARGET;
  const value = input.trim();
  if (!/^https?:\/\//i.test(value)) {
    return `http://${value}`;
  }
  return value;
}

function safeUrl(input) {
  try {
    return new URL(input);
  } catch {
    return null;
  }
}

function buildProxyPath(targetUrl) {
  return `/p/${toBase64Url(targetUrl)}`;
}

function rewriteHtmlUrls(html, upstreamOrigin) {
  const mapUrl = (raw) => {
    if (!raw) return raw;
    if (/^(data:|javascript:|mailto:|tel:|#)/i.test(raw)) return raw;

    const absolute = safeUrl(raw)
      ? raw
      : safeUrl(new URL(raw, upstreamOrigin).toString())?.toString();

    if (!absolute) return raw;
    return buildProxyPath(absolute);
  };

  return html
    .replace(/\b(href|src|action|poster)=(["'])(.*?)\2/gi, (m, attr, quote, url) => {
      return `${attr}=${quote}${mapUrl(url)}${quote}`;
    })
    .replace(/url\((["']?)(.*?)\1\)/gi, (m, quote, url) => {
      return `url(${quote}${mapUrl(url)}${quote})`;
    });
}

app.use((req, _res, next) => {
  const randomAgent = USER_AGENT_POOL[Math.floor(Math.random() * USER_AGENT_POOL.length)];
  req.headers['user-agent'] = process.env.MASKED_USER_AGENT || randomAgent;
  delete req.headers['x-forwarded-for'];
  delete req.headers['x-forwarded-host'];
  delete req.headers['x-forwarded-proto'];
  next();
});

app.get('/health', (_req, res) => {
  res.json({ok: true, target: process.env.TARGET_ORIGIN || DEFAULT_TARGET});
});

app.get('/proxy', (req, res) => {
  const upstream = req.query.url;
  if (typeof upstream !== 'string' || !upstream.trim()) {
    return res.status(400).json({error: 'Missing `url` query parameter'});
  }

  const normalized = normalizeTarget(upstream);
  const parsed = safeUrl(normalized);

  if (!parsed || !/^https?:$/i.test(parsed.protocol)) {
    return res.status(400).json({error: 'Only http(s) URLs are supported'});
  }

  return res.redirect(buildProxyPath(parsed.toString()));
});

app.use('/p/:encoded(*)', async (req, res, next) => {
  const encoded = req.params.encoded;
  let upstream;

  try {
    upstream = fromBase64Url(encoded);
  } catch {
    return res.status(400).send('Invalid encoded URL');
  }

  const upstreamUrl = safeUrl(upstream);

  if (!upstreamUrl || !/^https?:$/i.test(upstreamUrl.protocol)) {
    return res.status(400).send('Unsupported upstream URL');
  }

  const proxy = createProxyMiddleware({
    target: upstreamUrl.origin,
    changeOrigin: true,
    selfHandleResponse: true,
    pathRewrite: (_path, reqForPath) => {
      const parsedOriginal = safeUrl(fromBase64Url(reqForPath.params.encoded));
      return `${parsedOriginal?.pathname || '/'}${parsedOriginal?.search || ''}`;
    },
    on: {
      proxyReq(proxyReq, reqForProxyReq) {
        proxyReq.setHeader('user-agent', reqForProxyReq.headers['user-agent']);
      },
      proxyRes: responseInterceptor(async (responseBuffer, proxyRes) => {
        const contentType = `${proxyRes.headers['content-type'] || ''}`;
        if (!contentType.toLowerCase().includes('text/html')) {
          return responseBuffer;
        }

        const html = responseBuffer.toString('utf8');
        return rewriteHtmlUrls(html, upstreamUrl.origin);
      })
    }
  });

  return proxy(req, res, next);
});

const baseTarget = normalizeTarget(process.env.TARGET_ORIGIN || DEFAULT_TARGET);

app.use('/', createProxyMiddleware({
  target: baseTarget,
  changeOrigin: true,
  ws: true,
  selfHandleResponse: true,
  on: {
    proxyReq(proxyReq, req) {
      proxyReq.setHeader('user-agent', req.headers['user-agent']);
    },
    proxyRes: responseInterceptor(async (responseBuffer, proxyRes) => {
      const contentType = `${proxyRes.headers['content-type'] || ''}`;
      if (!contentType.toLowerCase().includes('text/html')) {
        return responseBuffer;
      }

      const html = responseBuffer.toString('utf8');
      return rewriteHtmlUrls(html, baseTarget);
    })
  }
}));

app.listen(PORT, () => {
  console.log(`proxy-clone listening on http://localhost:${PORT}`);
  console.log(`target upstream: ${baseTarget}`);
});
