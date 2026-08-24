# Relay

A single-file Cloudflare Worker that forwards and rewrites web pages so they
load through your own domain — links, forms, scripts, and stylesheets
included.

```
https://your-worker.workers.dev/https://example.com/page?x=1
```

---

## Contents

- `relay.js` — the Worker. Deploy this file as-is.
- `ui.html` — a static copy of the homepage UI, for viewing without a
  deployment.

---

## How it works

### URL scheme

The target address is embedded directly in the **path**, not a query
string:

```
https://relay.example/https://github.com/search?q=hi
   ^ your worker         ^ real target, with its own query preserved
```

Putting the real URL in the path — rather than behind `?url=` — matters
because it preserves real directory structure. When a proxied page's own
JavaScript loads something relative to itself (an ES module import, a
webpack chunk, a CSS `url()` reference), the browser resolves that
relative reference using ordinary path rules. A query-string scheme
collapses every resource to the proxy's root, so those relative references
break. A path-embedded scheme does not.

Old `?url=...` links still work — they 301-redirect to the canonical
path-embedded form rather than being served directly.

### Rewriting

On every HTML response, `HTMLRewriter` (Cloudflare's streaming HTML parser)
rewrites:

- `<a href>`, `<img src>`, `<script src>`, `<link href>`
- `<iframe src>`, `<video src/poster>`, `<audio src>`, `<source src>`,
  `<embed src>`, `<object data>`
- `<img srcset>`, `<source srcset>`
- `<form>` — see below

into fully-qualified, path-embedded proxy URLs. Non-HTML responses (JS,
CSS, images, JSON, etc.) pass through untouched and unbuffered.

### Forms

A browser's native `GET` form submission always discards the existing query
string in `action` and replaces it with the form's own fields — so a
pre-proxied `action` gets clobbered the moment the form is submitted. Forms
are instead tagged with the real resolved target in a `data-proxy-target`
attribute, and an injected script intercepts `submit`, builds the correct
proxied URL from the form's actual field values, and navigates there
directly. `POST` forms are left to default browser handling.

### Root-relative references

A reference starting with a single `/` — `fetch('/api/x')`,
`location.href = '/search'` — resolves against the *origin* only, by
specification. No amount of path structure or `<base>` tag can change that.
These are handled in layers:

1. **Click / submit / fetch / XHR** — an injected script patches
   `window.fetch`, `XMLHttpRequest.prototype.open`, and intercepts link
   clicks and form submits, resolving the raw (pre-browser-resolution)
   reference against the real target's current URL before the request is
   made.
2. **Direct `location` assignment** — `location.href = '/x'` or
   `location.assign('/x')` can't be intercepted from page JS at all
   (redefining `window.location` throws in modern browsers). The Worker
   itself catches these server-side: any request that arrives without a
   properly embedded target is corrected using the request's `Referer`
   header, which the browser sets automatically to whichever proxied page
   issued it, then 302-redirected to the corrected URL. This runs on the
   very first request — no warm-up needed.
3. **Service Worker backstop** — `/__proxy_sw.js` is registered on every
   page as a second layer, for the rare case a `Referer` header isn't sent
   (stripped by a privacy setting, etc). Note: per spec, a page is never
   controlled by a Service Worker on the load that registers it — only from
   the next navigation onward.

### Caching

Successfully rewritten HTML responses are cached at the edge
(`caches.default`, 60s) keyed on the full proxied URL. The upstream fetch
also uses `cf.cacheTtl` (120s) for a second layer of caching at Cloudflare's
edge.

Static asset responses (JS, CSS, fonts, images) get an extended
`Cache-Control: public, max-age=86400` applied client-side, regardless of
what the origin sent. Proxied single-page apps re-request the same hashed
chunks constantly while navigating; letting the browser hold onto them for
a day removes most of that repeat traffic through the Worker. Video, audio,
and anything not matching a static type is left untouched — range-request
/seeking behavior and freshness-sensitive responses (API/JSON) aren't safe
to cache this way.

---

## Deploying

Requires only the Cloudflare Workers free tier — no build step, no
dependencies.

```
wrangler deploy relay.js
```

or paste the file directly into the Cloudflare dashboard's Worker editor.

---

## Using it

Open the Worker's URL. The homepage takes an address, prefixes `https://`
if you omit it, and navigates to the proxied form. From there, ordinary
browsing — links, search, forms — stays routed through the relay.

---

## Known limitations

- **Authenticated sessions are not forwarded.** The Worker's server-side
  fetch does not carry your browser's cookies for the target site, so
  logged-in-only content (personalized results, account settings) will
  render as if signed out.
- **`POST` forms are not proxied.** They submit directly to the real site's
  origin and will typically fail (CORS, or simply leave the relay).
- **Content-Security-Policy from the origin is not forwarded**, which
  avoids most script-blocking issues but means the target's own CSP
  protections are not preserved for the proxied copy.
- **Heavily bundled single-page apps** may still exhibit edge cases the
  interception layers don't cover — this is inherent to proxying arbitrary
  client-side JavaScript, not something a rewriter can fully solve for
  every site.
- This is a general-purpose forwarding proxy. Anyone with the Worker's URL
  can route arbitrary traffic through it — consider adding an allow-list of
  permitted target domains and rate limiting before exposing it publicly.

---

## Testing checklist

Deploy, then work through these in order — each targets a specific layer
of the proxy, so a failure narrows down exactly where to look.

| # | Site / action | What you're checking | Expected result |
|---|---|---|---|
| 1 | Open the Worker's bare URL | Homepage renders | White background by default, address field, trace line animating at the bottom. Toggle switches to dark and back; refresh — theme choice persists. |
| 2 | Enter `wikipedia.org`, submit | Basic fetch + rewrite | Page loads, URL bar shows `/https://en.wikipedia.org/...`. Click any in-page link — navigates while staying on the proxy's domain. |
| 3 | `news.ycombinator.com` | Plain links at scale | Every story link and comment link stays on-proxy when clicked. |
| 4 | `duckduckgo.com`, search "test" | GET form submission | Results load with the search term intact, URL still path-embedded (not a bare `?q=test`). |
| 5 | `github.com`, then use the search bar (magnifying glass / `/` shortcut) | JS-driven fetch, dynamic UI | Search overlay opens and returns results. This one specifically exercises the fetch/XHR patch. |
| 6 | On GitHub, open **Settings**, then click around 2-3 nested settings pages | Client-side (Turbo) navigation | Each click updates the page without breaking out to the raw GitHub domain or landing on a bare proxy URL with no target embedded. |
| 7 | Any site with a visible image gallery (e.g. `unsplash.com`) | `srcset`, images | Images load at appropriate resolution, no broken thumbnails. |
| 8 | A site with an embedded YouTube/Vimeo video, or `youtube.com` directly | `iframe`/media rewriting | Embed loads and plays. |
| 9 | Reload a page you already visited (e.g. step 2) a second time | Caching | Noticeably faster load; open DevTools → Network, confirm JS/CSS requests show `(disk cache)` or a `max-age=86400` response header. |
| 10 | Open DevTools → Application → Service Workers | SW registered | `__proxy_sw.js` listed as activated for the Worker's origin. |
| 11 | Try a bare `?url=https://example.com` link manually in the address bar | Legacy redirect | Immediately redirects to the clean `/https://example.com` form — `?url=` never stays in the bar. |
| 12 | Submit an obviously broken input, e.g. `not a url` | Error handling | Homepage shows the inline "doesn't look valid" hint rather than navigating anywhere. |

If something fails, note which numbered step first breaks — that maps
directly to one of the layers in **How it works** above (rewriting,
form handling, fetch/XHR patch, referer recovery, or the Service Worker),
which is enough to isolate it without re-testing everything.

---

## File map

```
relay.js
├─ HOME_HTML            → homepage UI (light/dark, address input)
├─ SW_SCRIPT             → Service Worker source, served at /__proxy_sw.js
├─ default.fetch()       → request routing, referer recovery, rewriting
├─ AttrRewriter           → rewrites a single URL-bearing attribute
├─ FormRewriter           → tags forms with their real resolved target
├─ SrcsetRewriter         → rewrites srcset candidate lists
├─ BaseTagInjector        → injects <base> pointed at the proxied page
└─ ScriptInjector         → injects the click/submit/fetch/XHR interceptor
```
