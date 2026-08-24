// Cloudflare Workers forwarding proxy — path-embedded scheme.
//
// Target URLs are embedded directly in the proxy's path instead of a query
// param: https://proxy.dev/https://example.com/page?x=1
// (Old bookmarks using ?url=... still work as a fallback.)
//
// Why: putting the real URL in the *path* preserves real directory
// structure, so the browser's native relative-URL resolution — used by ES
// module imports, webpack/rollup chunk loading, CSS url()/@import, etc. —
// resolves correctly on its own. None of that is reachable by rewriting
// HTML or by JS interception, since it happens inside already-fetched JS/CSS
// files we never parse. A query-string scheme collapses everything to the
// proxy's root path, so any such relative reference breaks.
//
// Root-relative references (a raw "/api/x") still can't be fixed by path
// structure alone — a leading "/" always resolves against the *origin*,
// discarding any path prefix, by spec. Click/submit/fetch/XHR are handled by
// injected JS. Direct `location.href = '/x'` or `location.assign('/x')`
// calls made by page JS can't be — you can't intercept assignment to
// `window.location` from a page script (redefining it throws in modern
// browsers).
//
// Every request that reaches the Worker without a properly embedded target
// is corrected server-side using the request's Referer header (see below) —
// this is the primary fix and works immediately, on the very first request.
// A Service Worker is also registered as a backstop for cases where a
// Referer isn't sent (stripped by a privacy setting, etc).

const SW_PATH = '/__proxy_sw.js';

const SW_SCRIPT = `
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Already correctly path-embedded, or the SW script/root usage page — leave alone.
  if (/^\\/https?:\\/\\//.test(url.pathname)) return;
  if (url.pathname === '${SW_PATH}') return;
  if (url.pathname === '/' && !url.search) return;

  // A request landed at our bare origin with no embedded target — recover
  // the real site from whichever proxied page issued it.
  const ref = req.referrer;
  if (!ref) return;
  try {
    const refUrl = new URL(ref);
    const embedded = refUrl.pathname.slice(1);
    const m = embedded.match(/^(https?:\\/\\/[^/]+)/);
    if (!m) return;
    const corrected = self.location.origin + '/' + m[1] + url.pathname + url.search;
    event.respondWith(Response.redirect(corrected, 302));
  } catch (e) {
    // fall through to default handling
  }
});
`;

const HOME_HTML = `<!doctype html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Relay</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
  :root {
    --bg: #FFFFFF;
    --surface: #F6F6F5;
    --border: #E1E1DE;
    --text: #131316;
    --text-dim: #6C6C72;
    --accent: #2547F4;
    --accent-dim: #E9ECFE;
    --warn: #C7431E;
  }
  html[data-theme="dark"] {
    --bg: #0A0A0C;
    --surface: #151517;
    --border: #29292D;
    --text: #F1F1EF;
    --text-dim: #8B8B91;
    --accent: #6C89FF;
    --accent-dim: #16193A;
    --warn: #FF8A63;
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font-family: 'Space Grotesk', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    -webkit-font-smoothing: antialiased;
    transition: background 0.25s ease, color 0.25s ease;
  }
  .wrap {
    min-height: 100%;
    display: flex;
    flex-direction: column;
    max-width: 640px;
    margin: 0 auto;
    padding: 28px 24px 60px;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: clamp(48px, 12vh, 96px);
  }
  .mark {
    display: flex;
    align-items: center;
    gap: 10px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 13px;
    letter-spacing: 0.08em;
    color: var(--text-dim);
    text-transform: uppercase;
  }
  .mark .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--accent);
  }
  .theme-toggle {
    width: 34px;
    height: 34px;
    border-radius: 4px;
    border: 1px solid var(--border);
    background: var(--surface);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    color: var(--text);
    transition: border-color 0.15s ease;
  }
  .theme-toggle:hover { border-color: var(--text-dim); }
  .theme-toggle svg { width: 15px; height: 15px; }

  main { flex: 1; }

  .eyebrow {
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--accent);
    margin: 0 0 14px;
  }
  h1 {
    font-size: clamp(36px, 7vw, 52px);
    font-weight: 600;
    line-height: 1.05;
    letter-spacing: -0.02em;
    margin: 0 0 16px;
  }
  .sub {
    font-size: 16px;
    line-height: 1.5;
    color: var(--text-dim);
    max-width: 46ch;
    margin: 0 0 40px;
  }

  form { margin-bottom: 56px; }
  .field {
    display: flex;
    align-items: center;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--surface);
    transition: border-color 0.15s ease;
  }
  .field:focus-within { border-color: var(--accent); }
  .field input {
    flex: 1;
    border: 0;
    background: transparent;
    outline: none;
    padding: 16px 4px 16px 16px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 14px;
    color: var(--text);
  }
  .field input::placeholder { color: var(--text-dim); }
  .field button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 46px;
    height: 46px;
    margin: 4px;
    border: 0;
    border-radius: 3px;
    background: var(--accent);
    color: var(--bg);
    cursor: pointer;
    flex-shrink: 0;
    transition: opacity 0.15s ease;
  }
  html[data-theme="dark"] .field button { color: #0A0A0C; }
  .field button:hover { opacity: 0.85; }
  .field button svg { width: 17px; height: 17px; }
  .hint {
    margin: 10px 2px 0;
    font-size: 13px;
    color: var(--text-dim);
    min-height: 18px;
  }
  .hint.error { color: var(--warn); }

  .trace {
    display: flex;
    align-items: center;
    gap: 0;
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-dim);
  }
  .trace .node { display: flex; flex-direction: column; align-items: center; gap: 8px; flex-shrink: 0; }
  .trace .node span.sq {
    width: 9px; height: 9px;
    border: 1px solid var(--text-dim);
  }
  .trace .node.active span.sq { background: var(--accent); border-color: var(--accent); }
  .trace .line {
    flex: 1;
    height: 1px;
    background: var(--border);
    position: relative;
    margin: 0 -1px;
    top: -13px;
  }
  .trace .line .pulse {
    position: absolute;
    top: -2px;
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--accent);
    animation: travel 3.2s linear infinite;
  }
  @keyframes travel {
    0% { left: 0%; opacity: 0; }
    8% { opacity: 1; }
    92% { opacity: 1; }
    100% { left: 100%; opacity: 0; }
  }
  @media (prefers-reduced-motion: reduce) {
    .trace .line .pulse { animation: none; opacity: 0.6; left: 50%; }
  }

  footer {
    margin-top: 64px;
    padding-top: 20px;
    border-top: 1px solid var(--border);
    display: flex;
    justify-content: space-between;
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
    color: var(--text-dim);
    letter-spacing: 0.04em;
  }

  @media (max-width: 460px) {
    .trace .node span.label { display: none; }
  }
</style>
</head>
<body>
  <div class="wrap">
    <header>
      <div class="mark"><span class="dot"></span>relay</div>
      <button class="theme-toggle" id="themeToggle" aria-label="Switch theme" type="button">
        <svg id="themeIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
          <circle cx="12" cy="12" r="4.6"></circle>
          <path d="M12 2.4v2.4M12 19.2v2.4M4.4 12H2M22 12h-2.4M5.6 5.6l1.7 1.7M16.7 16.7l1.7 1.7M5.6 18.4l1.7-1.7M16.7 7.3l1.7-1.7"></path>
        </svg>
      </button>
    </header>

    <main>
      <p class="eyebrow">// relay</p>
      <h1>Route any address<br>through here.</h1>
      <p class="sub">Enter a URL. It loads through this relay, links and scripts included, without leaving the address bar.</p>

      <form id="goForm" autocomplete="off">
        <div class="field">
          <input id="urlInput" type="text" inputmode="url" placeholder="example.com/path" spellcheck="false" autofocus>
          <button type="submit" aria-label="Go">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square">
              <path d="M4 12h15M13 6l6 6-6 6"></path>
            </svg>
          </button>
        </div>
        <p class="hint" id="hint">Prefix is optional — https:// is assumed.</p>
      </form>

      <div class="trace" id="trace">
        <div class="node active"><span class="sq"></span><span class="label">you</span></div>
        <div class="line"><span class="pulse"></span></div>
        <div class="node"><span class="sq"></span><span class="label">relay</span></div>
        <div class="line"><span class="pulse" style="animation-delay: 1.6s;"></span></div>
        <div class="node"><span class="sq"></span><span class="label">target</span></div>
      </div>
    </main>

    <footer>
      <span id="originLabel"></span>
      <span>path-embedded · same-origin</span>
    </footer>
  </div>

<script>
(function() {
  var root = document.documentElement;
  var sunPath = 'M12 2.4v2.4M12 19.2v2.4M4.4 12H2M22 12h-2.4M5.6 5.6l1.7 1.7M16.7 16.7l1.7 1.7M5.6 18.4l1.7-1.7M16.7 7.3l1.7-1.7';
  var moonPath = 'M20 14.6A8.4 8.4 0 1 1 9.4 4a6.7 6.7 0 0 0 10.6 10.6z';

  function applyIcon(theme) {
    var circle = document.querySelector('#themeIcon circle');
    var path = document.querySelector('#themeIcon path');
    if (theme === 'dark') {
      if (circle) circle.setAttribute('r', '0');
      path.setAttribute('d', moonPath);
    } else {
      if (circle) circle.setAttribute('r', '4.6');
      path.setAttribute('d', sunPath);
    }
  }

  var saved = null;
  try { saved = localStorage.getItem('relay-theme'); } catch (e) {}
  var theme = saved || 'light';
  root.setAttribute('data-theme', theme);
  applyIcon(theme);

  document.getElementById('themeToggle').addEventListener('click', function() {
    theme = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', theme);
    applyIcon(theme);
    try { localStorage.setItem('relay-theme', theme); } catch (e) {}
  });

  document.getElementById('originLabel').textContent = location.origin.replace(/^https?:\\/\\//, '');

  var input = document.getElementById('urlInput');
  var hint = document.getElementById('hint');
  var trace = document.getElementById('trace');

  function go() {
    var val = input.value.trim();
    if (!val) { hint.textContent = 'Enter an address first.'; hint.className = 'hint error'; return; }
    if (!/^https?:\\/\\//i.test(val)) val = 'https://' + val;
    try {
      var u = new URL(val);
      trace.classList.add('sending');
      window.location.href = location.origin + '/' + u.href;
    } catch (e) {
      hint.textContent = 'That address doesn\\'t look valid.';
      hint.className = 'hint error';
    }
  }

  document.getElementById('goForm').addEventListener('submit', function(e) {
    e.preventDefault();
    go();
  });

  input.addEventListener('input', function() {
    hint.textContent = 'Prefix is optional — https:// is assumed.';
    hint.className = 'hint';
  });
})();
</script>
</body>
</html>`;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const proxyOrigin = url.origin;

    if (url.pathname === SW_PATH) {
      return new Response(SW_SCRIPT, {
        headers: { 'Content-Type': 'application/javascript' }
      });
    }

    const alreadyEmbedded = /^\/https?:\/\//i.test(url.pathname);

    // Legacy ?url=... links: never served directly — always redirect to the
    // canonical path-embedded form, so ?url= never lingers in the URL bar.
    if (url.searchParams.has('url') && !alreadyEmbedded) {
      let legacy = url.searchParams.get('url');
      if (!/^https?:\/\//i.test(legacy)) legacy = 'https://' + legacy;
      try {
        const canonical = proxyOrigin + '/' + new URL(legacy).href;
        return Response.redirect(canonical, 301);
      } catch {
        return new Response('Invalid URL', { status: 400 });
      }
    }

    // Any other request that isn't already correctly path-embedded is a
    // root-relative reference that escaped to the bare origin (a direct
    // `location.href = '/x'` assignment, a request the Service Worker hasn't
    // taken control of yet, etc). Recover the real target from the request's
    // Referer — the browser sets this automatically to whichever proxied
    // page issued the request — and redirect to the corrected URL rather
    // than silently failing or mis-serving it.
    if (!alreadyEmbedded) {
      const ref = request.headers.get('Referer');
      if (ref) {
        try {
          const refUrl = new URL(ref);
          if (refUrl.origin === proxyOrigin) {
            const embedded = refUrl.pathname.slice(1);
            const m = embedded.match(/^(https?:\/\/[^/]+)/);
            if (m) {
              const corrected = proxyOrigin + '/' + m[1] + url.pathname + url.search;
              return Response.redirect(corrected, 302);
            }
          }
        } catch {
          // fall through
        }
      }
    }

    // Path-embedded target, e.g. "/https://example.com/page" + "?x=1"
    let targetUrl = url.pathname.slice(1) + url.search;

    if (!targetUrl) {
      return new Response(HOME_HTML, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }

    // No scheme and no Referer to recover from — treat as a bare domain
    // typed directly (e.g. someone navigated straight to
    // proxy.dev/example.com with no prior proxied page).
    if (!/^https?:\/\//i.test(targetUrl)) {
      targetUrl = 'https://' + targetUrl;
    }

    let parsedTarget;
    try {
      parsedTarget = new URL(targetUrl);
    } catch {
      return new Response('Invalid URL', { status: 400 });
    }
    if (!['http:', 'https:'].includes(parsedTarget.protocol)) {
      return new Response('Invalid protocol', { status: 400 });
    }

    // Edge cache: identical proxied requests skip origin + rewriting entirely.
    // GET-only — the Cache API throws on non-GET requests.
    const cacheable = request.method === 'GET';
    const cache = caches.default;
    const cacheKey = new Request(request.url, request);
    if (cacheable) {
      const cached = await cache.match(cacheKey);
      if (cached) return cached;
    }

    let upstream;
    try {
      upstream = await fetch(parsedTarget.href, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept-Encoding': 'gzip, br'
        },
        cf: { cacheTtl: 120, cacheEverything: false }
      });
    } catch (error) {
      return new Response('Error fetching target: ' + error.message, { status: 502 });
    }

    const contentType = upstream.headers.get('content-type') || '';

    // Non-HTML: stream through untouched, but for static asset types (JS,
    // CSS, fonts, images) that browsers otherwise under-cache, extend
    // Cache-Control client-side AND store at the edge — a chunk fetched by
    // one visitor is then served instantly to the next, skipping the origin
    // and the Worker's rewriting path entirely.
    if (!contentType.includes('text/html')) {
      if (upstream.status === 200 && isLongCacheable(contentType)) {
        const headers = new Headers(upstream.headers);
        headers.set('Cache-Control', 'public, max-age=86400');
        const asset = new Response(upstream.body, {
          status: upstream.status,
          statusText: upstream.statusText,
          headers
        });
        if (cacheable) ctx.waitUntil(cache.put(cacheKey, asset.clone()));
        return asset;
      }
      return upstream;
    }

    const baseUrl = parsedTarget.href;
    const proxiedBase = proxyOrigin + '/' + baseUrl;

    const rewriter = new HTMLRewriter()
      .on('a[href]', new AttrRewriter('href', baseUrl, proxyOrigin))
      .on('img[src]', new AttrRewriter('src', baseUrl, proxyOrigin))
      .on('script[src]', new AttrRewriter('src', baseUrl, proxyOrigin))
      .on('link[href]', new AttrRewriter('href', baseUrl, proxyOrigin))
      .on('iframe[src]', new AttrRewriter('src', baseUrl, proxyOrigin))
      .on('video[src]', new AttrRewriter('src', baseUrl, proxyOrigin))
      .on('video[poster]', new AttrRewriter('poster', baseUrl, proxyOrigin))
      .on('audio[src]', new AttrRewriter('src', baseUrl, proxyOrigin))
      .on('source[src]', new AttrRewriter('src', baseUrl, proxyOrigin))
      .on('embed[src]', new AttrRewriter('src', baseUrl, proxyOrigin))
      .on('object[data]', new AttrRewriter('data', baseUrl, proxyOrigin))
      .on('form', new FormRewriter(baseUrl))
      .on('img[srcset]', new SrcsetRewriter(baseUrl, proxyOrigin))
      .on('source[srcset]', new SrcsetRewriter(baseUrl, proxyOrigin))
      .on('head', new BaseTagInjector(proxiedBase))
      .on('head', new ScriptInjector(proxyOrigin));

    const transformed = rewriter.transform(upstream);

    const response = new Response(transformed.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=60'
      }
    });

    if (cacheable) ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  }
};

function proxify(absoluteUrl, proxyOrigin) {
  return proxyOrigin + '/' + absoluteUrl;
}

// Content-types safe to cache aggressively client-side: static, commonly
// content-hashed, and re-requested often by proxied SPAs. Deliberately
// excludes video/audio (range-request/seeking behavior) and anything
// JSON/API-shaped (freshness matters).
const STATIC_CACHE_TYPES = ['text/css', 'javascript', 'image/', 'font/'];
function isLongCacheable(contentType) {
  return STATIC_CACHE_TYPES.some((t) => contentType.includes(t));
}

function resolveAndProxy(value, baseUrl, proxyOrigin) {
  if (value === null || value === undefined) return null;
  if (/^(javascript|data|mailto|tel|#)/i.test(value)) return null;
  try {
    const abs = new URL(value, baseUrl).href;
    return proxify(abs, proxyOrigin);
  } catch {
    return null;
  }
}

class AttrRewriter {
  constructor(attr, baseUrl, proxyOrigin) {
    this.attr = attr;
    this.baseUrl = baseUrl;
    this.proxyOrigin = proxyOrigin;
  }
  element(el) {
    const val = el.getAttribute(this.attr);
    const newVal = resolveAndProxy(val, this.baseUrl, this.proxyOrigin);
    if (newVal) el.setAttribute(this.attr, newVal);
  }
}

// GET forms strip any existing query string from `action` on submit, so a
// proxied action gets clobbered by the form's own fields. Instead, stash the
// resolved real target URL and let injected JS build the request.
class FormRewriter {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
  }
  element(el) {
    const actionVal = el.getAttribute('action') || '';
    let abs;
    try {
      abs = new URL(actionVal, this.baseUrl).href;
    } catch {
      abs = this.baseUrl;
    }
    el.setAttribute('data-proxy-target', abs);
  }
}

class SrcsetRewriter {
  constructor(baseUrl, proxyOrigin) {
    this.baseUrl = baseUrl;
    this.proxyOrigin = proxyOrigin;
  }
  element(el) {
    const val = el.getAttribute('srcset');
    if (!val) return;
    const rewritten = val
      .split(',')
      .map((part) => {
        const trimmed = part.trim();
        const spaceIdx = trimmed.search(/\s/);
        const u = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
        const descriptor = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx).trim();
        const proxied = resolveAndProxy(u, this.baseUrl, this.proxyOrigin);
        if (!proxied) return trimmed;
        return descriptor ? `${proxied} ${descriptor}` : proxied;
      })
      .join(', ');
    el.setAttribute('srcset', rewritten);
  }
}

// Makes directory-relative references from JS-created/dynamic content (never
// seen by HTMLRewriter, since it only runs on the initial HTML response)
// resolve against the *proxied* current page instead of escaping to the
// proxy's own root.
class BaseTagInjector {
  constructor(proxiedBase) {
    this.proxiedBase = proxiedBase;
  }
  element(el) {
    el.prepend(`<base href="${this.proxiedBase}">`, { html: true });
  }
}

class ScriptInjector {
  constructor(proxyOrigin) {
    this.proxyOrigin = proxyOrigin;
  }
  element(el) {
    el.prepend(
      `
    <script>
    (function() {
      var proxyOrigin = '${this.proxyOrigin}';

      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('${SW_PATH}').catch(function() {});
      }

      // document.baseURI is "<proxyOrigin>/<realAbsoluteUrl>" (see
      // BaseTagInjector). Strip the proxy prefix to recover the real
      // target's current URL, so we can resolve references (including
      // root-relative ones the browser can't handle via <base> alone)
      // against the REAL site, then wrap the result ourselves.
      function realBase() {
        var prefix = proxyOrigin + '/';
        if (document.baseURI.indexOf(prefix) === 0) {
          return document.baseURI.slice(prefix.length);
        }
        return document.baseURI;
      }

      function toProxied(raw) {
        try {
          if (typeof raw !== 'string' || !raw) return raw;
          if (/^(data|blob|javascript):/i.test(raw)) return raw;
          // Already a fully-proxied absolute URL (server-rewritten) — leave it.
          if (raw.indexOf(proxyOrigin + '/http') === 0) return raw;
          var abs = new URL(raw, realBase()).href;
          return proxyOrigin + '/' + abs;
        } catch (e) {
          return raw;
        }
      }

      // Page JS (Turbo navigation, search suggestions, settings menus, etc.)
      // calls fetch()/XHR with relative or root-relative URLs. Route them
      // through the proxy - same-origin from the browser's perspective, so
      // no CORS issue (the Worker does the real cross-origin fetch server-side).
      var origFetch = window.fetch;
      window.fetch = function(input, init) {
        try {
          if (typeof input === 'string') {
            input = toProxied(input);
          } else if (input && input.url) {
            input = new Request(toProxied(input.url), {
              method: input.method,
              headers: input.headers,
              body: ['GET', 'HEAD'].includes(input.method) ? undefined : input.body,
              credentials: input.credentials,
              redirect: input.redirect
            });
          }
        } catch (e) {}
        return origFetch.call(this, input, init);
      };

      var origOpen = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function(method, url) {
        try {
          arguments[1] = toProxied(url);
        } catch (e) {}
        return origOpen.apply(this, arguments);
      };

      // Use the RAW href attribute (not the browser-resolved .href), since a
      // root-relative raw value resolved natively would incorrectly bind to
      // the proxy's own origin rather than the real target's.
      //
      // Bubble phase (not capture), and back off if the page's own JS
      // already called preventDefault(). Sites commonly wrap non-navigating
      // controls — dropdown/menu triggers, tabs — in an <a> for styling and
      // handle the click themselves; capturing first stole those clicks and
      // forced a full reload instead of letting the page open its menu.
      document.addEventListener('click', function(e) {
        if (e.defaultPrevented) return;
        var link = e.target.closest('a');
        if (!link) return;
        var raw = link.getAttribute('href');
        if (!raw || /^(javascript|#|mailto|tel):/i.test(raw)) return;
        if (raw.indexOf(proxyOrigin + '/http') === 0) return; // already proxied
        e.preventDefault();
        window.location.href = toProxied(raw);
      });

      document.addEventListener('submit', function(e) {
        var form = e.target;
        if (!form || form.tagName !== 'FORM') return;
        var target = form.getAttribute('data-proxy-target') || form.action;
        if (!target) return;
        var method = (form.getAttribute('method') || 'get').toLowerCase();
        if (method !== 'get') return; // POST left to default handling
        e.preventDefault();
        var urlObj = new URL(target, realBase());
        var params = new URLSearchParams();
        new FormData(form).forEach(function(value, key) {
          if (typeof value === 'string') params.append(key, value);
        });
        urlObj.search = params.toString();
        window.location.href = proxyOrigin + '/' + urlObj.href;
      }, true);
    })();
    </script>
  `,
      { html: true }
    );
  }
}
