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
//
// Hardening notes:
// - The real request method/body/relevant headers are forwarded upstream
//   (previously every upstream fetch was an implicit GET, silently
//   dropping POST bodies from proxied fetch/XHR calls).
// - Relative URLs are resolved against upstream.url (the FINAL URL after
//   any redirects), not the originally-requested one, so a target that
//   redirects elsewhere doesn't break every relative link on the result.
// - A self-referential target (proxying the relay's own origin) is refused
//   to avoid recursive self-fetches.
// - WebSocket connections are bridged (see handleWebSocketUpgrade and the
//   client-side WebSocket override below) — browser <-> Worker <-> real
//   target, including converting the handshake's Origin header to the real
//   target's own origin, since many WS servers reject a mismatched one.

const SW_PATH = '/__proxy_sw.js';

const SW_SCRIPT = `
// Without these, a newly-deployed version of this script doesn't take over
// an already-open tab until every tab using the OLD version is closed —
// standard SW lifecycle behavior, but it means a redeploy can silently
// leave a browser running stale logic indefinitely, causing confusing
// behavior that only a hard reload (forcing a fresh update check) fixes.
self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

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
      if (u.origin === location.origin) {
        hint.textContent = "That's this relay's own address — enter the site you want to visit instead.";
        hint.className = 'hint error';
        return;
      }
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

// Shared error page — same design tokens, fonts, and theme toggle as
// HOME_HTML, kept as a separate template so the working homepage is never
// touched by changes here. status/title/message/detail/targetUrl are all
// escaped before interpolation.
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function errorPage({ status, title, message, detail, targetUrl, proxyOrigin }) {
  const safeTitle = escapeHtml(title);
  const safeMessage = escapeHtml(message);
  const safeDetail = detail ? escapeHtml(detail) : '';
  const safeTarget = targetUrl ? escapeHtml(targetUrl) : '';
  const homeUrl = escapeHtml(proxyOrigin + '/');

  return `<!doctype html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${status} — Relay</title>
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
    text-decoration: none;
  }
  .mark .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--warn);
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

  .code {
    font-family: 'JetBrains Mono', monospace;
    font-size: 13px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--warn);
    margin: 0 0 14px;
  }
  h1 {
    font-size: clamp(30px, 6vw, 44px);
    font-weight: 600;
    line-height: 1.1;
    letter-spacing: -0.02em;
    margin: 0 0 16px;
  }
  .sub {
    font-size: 16px;
    line-height: 1.5;
    color: var(--text-dim);
    max-width: 50ch;
    margin: 0 0 8px;
  }
  .detail {
    font-size: 14px;
    line-height: 1.5;
    color: var(--text-dim);
    max-width: 50ch;
    margin: 0 0 32px;
  }
  .target {
    display: block;
    font-family: 'JetBrains Mono', monospace;
    font-size: 13px;
    color: var(--text);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 12px 14px;
    margin: 0 0 32px;
    word-break: break-all;
  }
  .actions {
    display: flex;
    gap: 12px;
    margin-bottom: 56px;
  }
  .btn {
    font-family: 'Space Grotesk', sans-serif;
    font-size: 14px;
    font-weight: 500;
    text-decoration: none;
    padding: 12px 20px;
    border-radius: 4px;
    cursor: pointer;
    border: 1px solid transparent;
  }
  .btn.primary {
    background: var(--accent);
    color: var(--bg);
    border: 0;
  }
  html[data-theme="dark"] .btn.primary { color: #0A0A0C; }
  .btn.primary:hover { opacity: 0.85; }
  .btn.secondary {
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border);
  }
  .btn.secondary:hover { border-color: var(--text-dim); }

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
  .trace .node span.sq { width: 9px; height: 9px; border: 1px solid var(--text-dim); }
  .trace .node.active span.sq { background: var(--accent); border-color: var(--accent); }
  .trace .node.broken span.sq { background: var(--warn); border-color: var(--warn); }
  .trace .line { flex: 1; height: 1px; background: var(--border); margin: 0 -1px; top: -13px; position: relative; }
  .trace .line.broken { background: repeating-linear-gradient(90deg, var(--warn), var(--warn) 4px, transparent 4px, transparent 8px); }

  footer {
    margin-top: auto;
    padding-top: 20px;
    border-top: 1px solid var(--border);
    display: flex;
    justify-content: space-between;
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
    color: var(--text-dim);
    letter-spacing: 0.04em;
  }
</style>
</head>
<body>
  <div class="wrap">
    <header>
      <a class="mark" href="/"><span class="dot"></span>relay</a>
      <button class="theme-toggle" id="themeToggle" aria-label="Switch theme" type="button">
        <svg id="themeIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
          <circle cx="12" cy="12" r="4.6"></circle>
          <path d="M12 2.4v2.4M12 19.2v2.4M4.4 12H2M22 12h-2.4M5.6 5.6l1.7 1.7M16.7 16.7l1.7 1.7M5.6 18.4l1.7-1.7M16.7 7.3l1.7-1.7"></path>
        </svg>
      </button>
    </header>

    <main>
      <p class="code">// error ${status}</p>
      <h1>${safeTitle}</h1>
      <p class="sub">${safeMessage}</p>
      ${safeDetail ? `<p class="detail">${safeDetail}</p>` : ''}
      ${safeTarget ? `<code class="target">${safeTarget}</code>` : ''}

      <div class="actions">
        <a class="btn primary" href="${homeUrl}">Back to relay</a>
        <button class="btn secondary" id="goBackBtn" type="button">Go back</button>
      </div>

      <div class="trace">
        <div class="node active"><span class="sq"></span><span>you</span></div>
        <div class="line"></div>
        <div class="node active"><span class="sq"></span><span>relay</span></div>
        <div class="line broken"></div>
        <div class="node broken"><span class="sq"></span><span>target</span></div>
      </div>
    </main>

    <footer>
      <span id="originLabel"></span>
      <span>status ${status}</span>
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

  document.getElementById('goBackBtn').addEventListener('click', function() {
    // history.length > 1 means there's actually somewhere to go back to —
    // if this page was the first entry in the tab (a directly pasted or
    // bookmarked URL), history.back() would otherwise silently do nothing.
    if (window.history.length > 1) {
      window.history.back();
    } else {
      window.location.href = '${homeUrl}';
    }
  });
})();
</script>
</body>
</html>`;
}

function errorResponse(proxyOrigin, status, title, message, detail, targetUrl) {
  return new Response(errorPage({ status, title, message, detail, targetUrl, proxyOrigin }), {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}

// WebSocket bridging: browser <-> this Worker <-> the real target.
// The client-side WebSocket constructor override (in ScriptInjector) routes
// ws(s) connections through this same path-embedded scheme (e.g.
// /wss://real.com/socket); this is the server-side half that completes the
// handshake on both ends and relays messages/close/error between them.
//
// Cloudflare Workers negotiate an OUTBOUND WebSocket via a plain http(s)
// fetch() with an Upgrade header set — not a literal wss:// URL — and the
// far end is then exposed as `response.webSocket`.
async function handleWebSocketUpgrade(request, url, proxyOrigin) {
  const targetUrl = url.pathname.slice(1) + url.search;
  if (!/^wss?:\/\//i.test(targetUrl)) {
    return new Response('Invalid WebSocket target', { status: 400 });
  }

  let parsedTarget;
  try {
    parsedTarget = new URL(targetUrl);
  } catch {
    return new Response('Invalid WebSocket target', { status: 400 });
  }
  if (parsedTarget.origin.replace(/^wss?/, 'https') === proxyOrigin) {
    return new Response('Refusing to proxy the relay itself', { status: 400 });
  }

  const httpEquivalent = parsedTarget.href.replace(/^ws/, 'http');
  const realOrigin = parsedTarget.origin.replace(/^ws/, 'http');

  const upstreamHeaders = new Headers({
    'Upgrade': 'websocket',
    'Connection': 'Upgrade',
    // Real target origin, not our proxy's — many WebSocket servers reject
    // the handshake outright if Origin doesn't match their own site.
    'Origin': realOrigin,
    // Real browser UA, not a fixed spoofed one — see buildUpstreamHeaders.
    'User-Agent': request.headers.get('User-Agent') || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  });
  // Forward subprotocol negotiation. The browser's WebSocket constructor
  // sends its offered protocols in this header; it must eventually see
  // back whichever one the real server actually chose (below), or
  // socket.protocol is empty and strict clients reject the connection.
  const requestedProtocol = request.headers.get('Sec-WebSocket-Protocol');
  if (requestedProtocol) upstreamHeaders.set('Sec-WebSocket-Protocol', requestedProtocol);

  let upstream;
  try {
    // 10s is generous for a handshake specifically (not the connection's
    // lifetime — once upstream.webSocket exists below, it's independent of
    // this timeout) while still failing fast on an unreachable game server
    // rather than leaving the connecting UI hanging indefinitely.
    upstream = await fetchUpstream(httpEquivalent, { headers: upstreamHeaders }, 10000);
  } catch (err) {
    return new Response('WebSocket upstream connection failed: ' + err.message, { status: 502 });
  }

  const upstreamSocket = upstream.webSocket;
  if (!upstreamSocket) {
    return new Response('Target did not upgrade to WebSocket', { status: 502 });
  }

  let client, server;
  try {
    upstreamSocket.accept();
    [client, server] = Object.values(new WebSocketPair());
    server.accept();
  } catch (err) {
    try { upstreamSocket.close(); } catch {}
    return new Response('WebSocket bridge setup failed: ' + err.message, { status: 502 });
  }

  server.addEventListener('message', (e) => {
    try { upstreamSocket.send(e.data); } catch {}
  });
  upstreamSocket.addEventListener('message', (e) => {
    try { server.send(e.data); } catch {}
  });
  server.addEventListener('close', (e) => {
    try { upstreamSocket.close(e.code, e.reason); } catch {}
  });
  upstreamSocket.addEventListener('close', (e) => {
    try { server.close(e.code, e.reason); } catch {}
  });
  server.addEventListener('error', () => { try { upstreamSocket.close(); } catch {} });
  upstreamSocket.addEventListener('error', () => { try { server.close(); } catch {} });

  // Echo back whichever subprotocol the REAL server actually accepted —
  // not simply the client's request verbatim.
  const acceptedProtocol = upstream.headers.get('Sec-WebSocket-Protocol');
  const responseInit = { status: 101, webSocket: client };
  if (acceptedProtocol) {
    responseInit.headers = { 'Sec-WebSocket-Protocol': acceptedProtocol };
  }
  return new Response(null, responseInit);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const proxyOrigin = url.origin;

    if (request.headers.get('Upgrade') === 'websocket') {
      return handleWebSocketUpgrade(request, url, proxyOrigin);
    }

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
        return errorResponse(proxyOrigin, 400, "That address didn't parse", "The URL passed via ?url= couldn't be read as a valid address.", null, legacy);
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

    // Defensive cap against pathological input, before even trying to parse it.
    if (targetUrl.length > 8000) {
      return errorResponse(proxyOrigin, 414, 'That address is too long', "The target URL exceeds what this relay will attempt to proxy.", null, targetUrl.slice(0, 200) + '…');
    }

    let parsedTarget;
    try {
      parsedTarget = new URL(targetUrl);
    } catch {
      return errorResponse(proxyOrigin, 400, "That address didn't parse", "The target couldn't be read as a valid URL — check it for typos.", null, targetUrl);
    }
    if (!['http:', 'https:'].includes(parsedTarget.protocol)) {
      return errorResponse(proxyOrigin, 400, 'Unsupported protocol', 'This relay only forwards http:// and https:// addresses.', null, parsedTarget.href);
    }
    // Refuse a self-referential target — otherwise the Worker would fetch
    // its own origin, recursively, on a crafted or accidental link.
    if (parsedTarget.origin === proxyOrigin) {
      return errorResponse(proxyOrigin, 400, 'Refusing to proxy itself', "This address points back at the relay's own origin, which would cause it to fetch itself.", null, parsedTarget.href);
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

    const upstreamInit = {
      method: request.method,
      headers: buildUpstreamHeaders(request, proxyOrigin, parsedTarget.origin),
      redirect: 'follow',
      // cacheEverything is safe here specifically because this proxy never
      // forwards cookies (see README limitations) — every response is
      // already the same generic, non-personalized view for everyone, so
      // caching it at Cloudflare's fetch layer (not just our own edge
      // cache below) cuts a real origin round-trip on repeat hits.
      cf: { cacheTtl: 120, cacheEverything: true }
    };
    // Forward the real request body for non-GET/HEAD methods — previously
    // every upstream fetch was an implicit GET regardless of the incoming
    // request, silently dropping POST bodies (breaks GraphQL calls, search
    // suggestions, and anything else proxied fetch/XHR calls send as POST).
    if (!['GET', 'HEAD'].includes(request.method) && request.body) {
      upstreamInit.body = request.body;
      upstreamInit.duplex = 'half';
    }

    let upstream;
    try {
      upstream = await fetchUpstream(parsedTarget.href, upstreamInit);
    } catch (error) {
      return errorResponse(proxyOrigin, 502, "Couldn't reach that address", 'The request to the target failed before any response came back.', error.message, parsedTarget.href);
    }

    // Cloudflare's own edge — not the target site — returns these statuses
    // for connectivity failures (DNS didn't resolve, origin unreachable,
    // etc). fetch() doesn't throw for these; it resolves as a normal-looking
    // HTML response, which would otherwise get rewritten and served as if
    // it were the real page. Show our own explanation instead.
    const CF_EDGE_ERROR_STATUSES = new Set([520, 521, 522, 523, 524, 525, 526, 527, 530]);
    if (CF_EDGE_ERROR_STATUSES.has(upstream.status)) {
      return errorResponse(proxyOrigin, 502, "Couldn't reach that address", "The target domain didn't respond — it may not exist, or is temporarily unreachable.", 'Double-check the address for typos.', parsedTarget.href);
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
        // .clone() tees the stream, roughly doubling in-flight buffering —
        // fine for a typical script/image, wasteful and riskier for a large
        // game/WASM bundle (these commonly run 50-200MB+). Skip our OWN
        // edge-cache write above the threshold; the browser still benefits
        // from the Cache-Control header above either way.
        const lengthHeader = upstream.headers.get('content-length');
        const tooLargeToCache = lengthHeader && parseInt(lengthHeader, 10) > ASSET_CACHE_SIZE_LIMIT;
        if (cacheable && !tooLargeToCache) ctx.waitUntil(cache.put(cacheKey, asset.clone()));
        return asset;
      }
      return upstream;
    }

    // upstream.url is the FINAL URL after any redirects fetch() followed
    // server-side — using the pre-redirect parsedTarget.href here would
    // resolve every relative link/script/etc against the wrong page
    // whenever the target redirects (auth flows, trailing-slash/canonical
    // redirects, moved domains).
    const baseUrl = upstream.url || parsedTarget.href;
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

// Headers we set ourselves, that leak the proxy's own domain if forwarded
// verbatim, or that are hop-by-hop/infra-only and meaningless upstream.
// Everything else the page/browser actually sent is forwarded as-is — an
// allowlist here would always be one custom header behind real-world sites
// (anti-abuse tokens, API versioning headers, CSRF tokens, etc); a denylist
// is far more robust. Cookies specifically are never forwarded (see README
// limitations).
const DROP_HEADERS = new Set([
  'host', 'cookie', 'content-length', 'connection',
  'user-agent',
  'cf-connecting-ip', 'cf-ipcountry', 'cf-ray', 'cf-visitor', 'cf-worker',
  'x-forwarded-for', 'x-forwarded-proto', 'x-forwarded-host',
  'referer', 'origin' // handled specially below, not silently forwarded raw
]);

// Recovers the real target URL embedded in a proxy-origin header value
// (e.g. a Referer/Origin the browser set to our own domain), or null if the
// value isn't one of ours.
function recoverRealUrl(headerValue, proxyOrigin) {
  if (!headerValue) return null;
  try {
    const u = new URL(headerValue);
    if (u.origin !== proxyOrigin) return null;
    const embedded = u.pathname.slice(1);
    return /^https?:\/\//i.test(embedded) ? embedded : null;
  } catch {
    return null;
  }
}

function buildUpstreamHeaders(request, proxyOrigin, targetOrigin) {
  const headers = new Headers();
  // Forward the REAL browser's own User-Agent rather than a fixed spoofed
  // string. This request's Sec-Ch-Ua/Sec-Fetch-* headers (forwarded below,
  // since they're not in DROP_HEADERS) already reflect the real browser —
  // a substituted User-Agent that doesn't match them is an internal
  // inconsistency that bot-detection systems specifically look for. Only
  // fall back to a generic default if the client somehow sent none at all.
  const realUA = request.headers.get('User-Agent');
  headers.set('User-Agent', realUA || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
  // Accept-Encoding is NOT set here — the real browser's own value is
  // forwarded via the denylist loop below, for the same reason as
  // User-Agent above: a substituted value that doesn't match what a real
  // browser of that claimed identity would actually send is a detectable
  // inconsistency.

  for (const [name, value] of request.headers) {
    if (DROP_HEADERS.has(name.toLowerCase())) continue;
    headers.set(name, value);
  }

  // Referer carries a full path, so the real target can be recovered from
  // its content. Origin never carries a path (just scheme+host) — there's
  // nothing to recover from it, so when the browser sent one at all, set it
  // to the request's own known real target origin instead.
  const realReferer = recoverRealUrl(request.headers.get('Referer'), proxyOrigin);
  if (realReferer) headers.set('Referer', realReferer);

  if (request.headers.get('Origin')) {
    headers.set('Origin', targetOrigin);
  }

  return headers;
}

// Above this, skip our own edge-cache write for a static asset (still gets
// browser-side Cache-Control either way) — see the asset-caching branch.
const ASSET_CACHE_SIZE_LIMIT = 20 * 1024 * 1024; // 20MB

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Parses Retry-After as either delta-seconds or an HTTP-date, per spec.
// Returns null when absent or unparseable.
function parseRetryAfterMs(header) {
  if (!header) return null;
  const asInt = parseInt(header, 10);
  if (!Number.isNaN(asInt) && String(asInt) === header.trim()) return asInt * 1000;
  const asDate = Date.parse(header);
  if (!Number.isNaN(asDate)) return Math.max(0, asDate - Date.now());
  return null;
}

// Fails fast on a hung/stalled upstream rather than letting the request run
// indefinitely — bounded so a single slow connection can't quietly eat the
// Worker's whole execution budget. Only wraps the request itself; once a
// WebSocket handshake completes, the resulting socket lives independently
// of this signal and is unaffected by it.
async function fetchWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || 20000);
  try {
    return await fetch(url, Object.assign({}, init, { signal: controller.signal }));
  } finally {
    clearTimeout(timer);
  }
}

// One retry on transient network failure (DNS blip, connection reset) —
// not on HTTP error statuses, which are legitimate responses returned as-is
// either way. Only retried when there's no body: a ReadableStream can only
// be read once, so a request that already carries one gets a single try.
//
// Also adds a short, capped retry specifically for throttling responses
// (429/503) that include a short Retry-After — relevant for game traffic
// especially, since many concurrent relay users hitting the same game
// server can all appear to originate from Cloudflare's own IP ranges,
// making a real rate limit more likely to be hit than for ordinary
// browsing. Capped at 2s and one attempt so a single request can never
// stall for long chasing a throttle that isn't going to clear soon.
async function fetchUpstream(url, init, timeoutMs) {
  let response;
  try {
    response = await fetchWithTimeout(url, init, timeoutMs);
  } catch (err) {
    if (init.body) throw err;
    response = await fetchWithTimeout(url, init, timeoutMs);
  }

  if ((response.status === 429 || response.status === 503) && !init.body) {
    const waitMs = parseRetryAfterMs(response.headers.get('Retry-After'));
    if (waitMs !== null && waitMs <= 2000) {
      await sleep(waitMs);
      try {
        response = await fetchWithTimeout(url, init, timeoutMs);
      } catch {
        // keep the original throttled response if the retry itself fails
      }
    }
  }

  return response;
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

        // Block the TARGET site's own Service Worker registration attempts.
        // A foreign site's SW can't function correctly under our proxied
        // URL scheme (its internal relative references assume the real
        // site's own paths), and if it takes over fetch handling on this
        // origin, its requests start failing — which is exactly the
        // trigger many sites use to show a "you're offline" fallback UI.
        navigator.serviceWorker.register = function() {
          return Promise.reject(new Error('Service Worker registration disabled by relay'));
        };
      }

      // Some sites gate an offline UI directly off navigator.onLine rather
      // than (or in addition to) a failed request — force it true so a
      // real network failure elsewhere doesn't get misread as "offline"
      // when the actual browser connection is fine.
      try {
        Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
      } catch (e) {}

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
          // Some components pre-resolve a root-relative src/url against
          // document.baseURI (our proxied <base>) before calling fetch —
          // that drops the real target, landing on the bare proxy origin
          // (e.g. GitHub's lazy-loaded sort/filter/"..." menus). Recover
          // the leftover path+query and re-resolve it against the real site
          // instead of wrapping the already-broken URL a second time.
          if (raw.indexOf(proxyOrigin) === 0) {
            var rest = raw.slice(proxyOrigin.length);
            var recovered = new URL(rest, realBase()).href;
            return proxyOrigin + '/' + recovered;
          }
          var abs = new URL(raw, realBase()).href;
          return proxyOrigin + '/' + abs;
        } catch (e) {
          return raw;
        }
      }

      // --- Diagnostic overlay -------------------------------------------
      // Shows failed (non-2xx, network-error, or failed-to-load-resource)
      // requests in a small on-page panel — method, real target URL,
      // status — so a failure is visible and copyable as plain text
      // without opening DevTools or taking a screenshot. Purely
      // observational: never alters a request or its result, only logs
      // after the fact.
      var __relayFailures = [];
      var MAX_LOGGED = 15;

      function relayEnsurePanel() {
        if (document.getElementById('__relay_debug_panel')) return;
        var panel = document.createElement('div');
        panel.id = '__relay_debug_panel';
        panel.style.cssText = 'position:fixed;bottom:12px;right:12px;z-index:2147483647;' +
          'background:#111;border:1px solid #333;border-radius:6px;width:340px;max-height:280px;' +
          'overflow:auto;display:none;box-shadow:0 4px 16px rgba(0,0,0,.4);' +
          'font-family:ui-monospace,monospace;font-size:11px;';
        panel.innerHTML =
          '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;' +
          'padding:6px 8px;background:#1a1a1a;border-bottom:1px solid #333;">' +
          '<span style="color:#ccc;">relay \u2014 failed requests</span>' +
          '<span style="display:flex;gap:10px;align-items:center;">' +
          '<button id="__relay_debug_copy" style="background:none;border:1px solid #444;' +
          'color:#ccc;border-radius:3px;cursor:pointer;font-size:10px;padding:2px 6px;">Copy</button>' +
          '<button id="__relay_debug_close" style="background:none;border:0;color:#888;' +
          'cursor:pointer;font-size:14px;line-height:1;">\u00d7</button></span></div>' +
          '<div id="__relay_debug_list"></div>';
        (document.body || document.documentElement).appendChild(panel);
        document.getElementById('__relay_debug_close').addEventListener('click', function() {
          panel.style.display = 'none';
        });
        document.getElementById('__relay_debug_copy').addEventListener('click', function() {
          var btn = document.getElementById('__relay_debug_copy');
          var text = __relayFailures.map(function(r) {
            return r.status + ' ' + r.method + ' ' + r.url + (r.note ? ' - ' + r.note : '');
          }).join('\n');
          function done(ok) { btn.textContent = ok ? 'Copied!' : 'Copy failed'; setTimeout(function() { btn.textContent = 'Copy'; }, 1500); }
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function() { done(true); }, function() { done(false); });
          } else {
            done(false);
          }
        });
      }

      function relayLogFailure(method, realUrl, status, note) {
        try {
          relayEnsurePanel();
          __relayFailures.unshift({ method: method, url: realUrl, status: status, note: note || '' });
          if (__relayFailures.length > MAX_LOGGED) __relayFailures.pop();
          var panel = document.getElementById('__relay_debug_panel');
          var list = document.getElementById('__relay_debug_list');
          if (!panel || !list) return;
          panel.style.display = 'block';
          list.innerHTML = __relayFailures.map(function(r) {
            return '<div style="padding:6px 8px;border-bottom:1px solid #262626;color:#eee;' +
              'word-break:break-all;"><b style="color:#ff8a63;">' + r.status + '</b> ' +
              r.method + ' ' + r.url + (r.note ? ' \u2014 ' + r.note : '') + '</div>';
          }).join('');
        } catch (e) {}
      }

      // Resource load failures (a missing texture, a font, a game engine's
      // own script 404ing) don't fire on fetch/XHR/WebSocket at all, and
      // these error events don't bubble — a capture-phase listener on
      // window is the only way to observe them globally. Previously
      // invisible to this panel entirely, despite being a very common
      // reason a page (or game) fails to render correctly.
      window.addEventListener('error', function(e) {
        var el = e.target;
        if (!el || !el.tagName) return;
        var tag = el.tagName.toUpperCase();
        if (['IMG', 'SCRIPT', 'LINK', 'AUDIO', 'VIDEO', 'SOURCE', 'IFRAME'].indexOf(tag) === -1) return;
        var src = el.src || el.href || '?';
        relayLogFailure(tag, src, 'LOAD_ERR', 'failed to load');
      }, true);
      // ---------------------------------------------------------------

      // calls fetch()/XHR with relative or root-relative URLs. Route them
      // through the proxy - same-origin from the browser's perspective, so
      // no CORS issue (the Worker does the real cross-origin fetch server-side).
      var origFetch = window.fetch;
      window.fetch = function(input, init) {
        var method = (init && init.method) || (input && input.method) || 'GET';
        var originalForLog = typeof input === 'string' ? input : (input && input.url) || '';
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
        return origFetch.call(this, input, init).then(function(res) {
          if (!res.ok) relayLogFailure(method, originalForLog, res.status);
          return res;
        }, function(err) {
          relayLogFailure(method, originalForLog, 'ERR', err && err.message);
          throw err;
        });
      };

      var origOpen = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function(method, url) {
        this.__relayMethod = method;
        this.__relayUrl = url;
        try {
          arguments[1] = toProxied(url);
        } catch (e) {}
        return origOpen.apply(this, arguments);
      };

      var origSend = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.send = function() {
        var xhr = this;
        xhr.addEventListener('loadend', function() {
          if (xhr.status === 0 || xhr.status >= 400) {
            relayLogFailure(xhr.__relayMethod || '?', xhr.__relayUrl || '?', xhr.status || 'ERR');
          }
        });
        return origSend.apply(this, arguments);
      };

      // Search results (Bing, Google, etc.) very commonly open a result via
      // a JS window.open(url, '_blank') call rather than a plain link — a
      // separate API from fetch/XHR/click, previously unpatched entirely.
      // Rewrite the URL before it reaches the real window.open, same as
      // every other patched API above.
      if (typeof window.open === 'function') {
        var origWindowOpen = window.open;
        window.open = function(url, target, features) {
          var proxied;
          try {
            proxied = (url && !/^about:/i.test(url)) ? toProxied(String(url)) : url;
          } catch (e) {
            proxied = url;
          }
          return origWindowOpen.call(window, proxied, target, features);
        };
      }

      // EventSource (Server-Sent Events) is a distinct API from fetch/XHR —
      // many streaming chat/AI apps use it to deliver responses token by
      // token. Unpatched, a relative or cross-origin EventSource URL either
      // resolves against the wrong origin or hits a real CORS wall, and the
      // stream never opens — which can look like "nothing happens" on the
      // page (a message that never sends or never gets a reply).
      if (typeof window.EventSource === 'function') {
        var OrigEventSource = window.EventSource;
        var PatchedEventSource = function(url, opts) {
          return new OrigEventSource(toProxied(url), opts);
        };
        PatchedEventSource.prototype = OrigEventSource.prototype;
        PatchedEventSource.CONNECTING = OrigEventSource.CONNECTING;
        PatchedEventSource.OPEN = OrigEventSource.OPEN;
        PatchedEventSource.CLOSED = OrigEventSource.CLOSED;
        window.EventSource = PatchedEventSource;
      }

      // WebSocket is a separate global, untouched by the fetch/XHR patches
      // above. Unpatched, a page connecting to wss://real-site.com/socket
      // would either bypass the proxy entirely, or get rejected by the
      // target's own Origin check (the handshake's Origin header reflects
      // THIS page's origin — our proxy's — not the real site's). Route it
      // through the same path-embedded scheme instead.
      if (typeof window.WebSocket === 'function') {
        var OrigWebSocket = window.WebSocket;
        var proxyWsOrigin = proxyOrigin.replace(/^http/, 'ws');

        // Reuses toProxied()'s relative-URL resolution AND its
        // self-referential-origin recovery, by converting ws(s) <-> http(s)
        // around it, rather than duplicating that logic separately. Without
        // the recovery step, a page building its WS url from its own
        // location.origin — which, under this proxy, IS our own origin, a
        // common "connect to same-host websocket" pattern — produces a
        // self-referential URL the server has to refuse outright, which is
        // exactly what caused an endless connect/retry loop.
        function toProxiedWs(raw) {
          var httpForm = String(raw).replace(/^ws/, 'http');
          var proxiedHttp = toProxied(httpForm);
          var prefix = proxyOrigin + '/';
          if (proxiedHttp.indexOf(prefix) === 0) {
            return proxyWsOrigin + '/' + proxiedHttp.slice(prefix.length).replace(/^http/, 'ws');
          }
          return proxiedHttp.replace(/^http/, 'ws');
        }

        var PatchedWebSocket = function(url, protocols) {
          var proxied, realTarget;
          try {
            proxied = toProxiedWs(url);
            var wsPrefix = proxyWsOrigin + '/';
            realTarget = proxied.indexOf(wsPrefix) === 0 ? proxied.slice(wsPrefix.length) : proxied;
          } catch (e) {
            proxied = url;
            realTarget = url;
          }
          var sock = protocols !== undefined
            ? new OrigWebSocket(proxied, protocols)
            : new OrigWebSocket(proxied);
          sock.addEventListener('error', function() {
            relayLogFailure('WS', realTarget, 'ERR', 'connection failed');
          });
          sock.addEventListener('close', function(e) {
            // 1000/1005 are normal closure codes — anything else is worth
            // surfacing (e.g. the Worker rejected the upgrade, or the real
            // target refused the handshake).
            if (e.code !== 1000 && e.code !== 1005) {
              relayLogFailure('WS', realTarget, e.code, e.reason || 'closed unexpectedly');
            }
          });
          return sock;
        };
        PatchedWebSocket.prototype = OrigWebSocket.prototype;
        PatchedWebSocket.CONNECTING = OrigWebSocket.CONNECTING;
        PatchedWebSocket.OPEN = OrigWebSocket.OPEN;
        PatchedWebSocket.CLOSING = OrigWebSocket.CLOSING;
        PatchedWebSocket.CLOSED = OrigWebSocket.CLOSED;
        window.WebSocket = PatchedWebSocket;
      }

      // Use the RAW href attribute (not the browser-resolved .href), since a
      // root-relative raw value resolved natively would incorrectly bind to
      // the proxy's own origin rather than the real target's.
      //
      // Bubble phase (not capture), and back off if the page's own JS
      // already called preventDefault(). Sites commonly wrap non-navigating
      // controls — dropdown/menu triggers, tabs — in an <a> for styling and
      // handle the click themselves; capturing first stole those clicks and
      // forced a full reload instead of letting the page open its menu.
      // SPA client-side routing (history.pushState/replaceState) changes the
      // address bar directly, with no network request at all — none of the
      // fetch/XHR/WebSocket interceptors above can see this. A page's own
      // pushState('/results?q=hi') resolves against the CURRENT address
      // (our proxy), landing on the bare proxy origin with no embedded
      // target at all — this is what produced a URL like
      // "proxy.../results?search_query=hi" with youtube.com missing.
      function relayUpdateBaseTag(proxiedUrl) {
        try {
          var prefix = proxyOrigin + '/';
          if (proxiedUrl.indexOf(prefix + 'http') !== 0) return;
          var baseEl = document.querySelector('base');
          if (baseEl) baseEl.setAttribute('href', proxiedUrl);
        } catch (e) {}
      }

      var origPushState = history.pushState;
      var origReplaceState = history.replaceState;

      history.pushState = function(state, title, url) {
        if (url !== undefined && url !== null) {
          url = toProxied(String(url));
          relayUpdateBaseTag(url);
        }
        return origPushState.call(this, state, title, url);
      };

      history.replaceState = function(state, title, url) {
        if (url !== undefined && url !== null) {
          url = toProxied(String(url));
          relayUpdateBaseTag(url);
        }
        return origReplaceState.call(this, state, title, url);
      };

      // Back/forward navigation between pushState entries restores the URL
      // without a network request either — keep <base> in sync there too.
      window.addEventListener('popstate', function() {
        relayUpdateBaseTag(location.href);
      });

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

      // Shared by both the 'submit' event listener below (catches
      // requestSubmit() and genuine user-triggered submissions) and the
      // HTMLFormElement.prototype.submit() patch further down (catches
      // direct .submit() calls, which — per spec — never fire a 'submit'
      // event at all, so the listener alone can't see them).
      function relaySubmitGetForm(form) {
        var target = form.getAttribute('data-proxy-target') || form.action;
        if (!target) return false;
        var method = (form.getAttribute('method') || 'get').toLowerCase();
        if (method !== 'get') return false; // POST left to default handling
        var urlObj = new URL(target, realBase());
        var params = new URLSearchParams();
        new FormData(form).forEach(function(value, key) {
          if (typeof value === 'string') params.append(key, value);
        });
        urlObj.search = params.toString();
        window.location.href = proxyOrigin + '/' + urlObj.href;
        return true;
      }

      document.addEventListener('submit', function(e) {
        var form = e.target;
        if (!form || form.tagName !== 'FORM') return;
        if (relaySubmitGetForm(form)) e.preventDefault();
      }, true);

      // form.submit() bypasses the 'submit' event entirely (a documented
      // DOM quirk) — a <textarea>-based search box (which doesn't submit
      // on Enter natively, unlike a single-line <input>) commonly has its
      // own JS call this directly to make Enter work, which is invisible
      // to the listener above no matter what it does.
      var origFormSubmit = HTMLFormElement.prototype.submit;
      HTMLFormElement.prototype.submit = function() {
        try {
          if (relaySubmitGetForm(this)) return;
        } catch (e) {}
        return origFormSubmit.call(this);
      };
    })();
    </script>
  `,
      { html: true }
    );
  }
}
