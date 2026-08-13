// ============================================
// CONFIGURATION
// ============================================
const C = {
  UA: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  TIMEOUT: 30000,
  MAX_URL: 2048,
  BLOCKED: ['localhost', '127.0.0.1', '0.0.0.0'],
  DEBUG: true,
  NAME: 'webcore'
};

const log = (...args) => C.DEBUG && console.log('[DEBUG]', ...args);

// ============================================
// URL VALIDATION
// ============================================
function validateUrl(raw) {
  if (!raw) return { ok: false, error: 'Missing url parameter' };
  try {
    let decoded = raw;
    if (raw.includes('%')) {
      try {
        decoded = decodeURIComponent(raw);
      } catch (e) {
        decoded = raw;
      }
    }
    
    if (decoded.length > C.MAX_URL) return { ok: false, error: 'URL too long' };
    
    if (!decoded.match(/^https?:\/\//i)) {
      decoded = 'https://' + decoded;
    }
    
    const url = new URL(decoded);
    if (!['http:', 'https:'].includes(url.protocol)) return { ok: false, error: 'Invalid protocol' };
    
    const host = url.hostname.toLowerCase();
    if (C.BLOCKED.some(b => host === b || host.endsWith('.' + b))) {
      return { ok: false, error: 'Domain blocked' };
    }
    if (url.username || url.password) return { ok: false, error: 'Auth in URL' };
    
    const ipMatch = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipMatch) {
      const [_, a, b, c, d] = ipMatch;
      if (a === '10' || (a === '172' && b >= 16 && b <= 31) || (a === '192' && b === '168') || 
          a === '127' || (a === '0' && b === '0' && c === '0' && d === '0') || (a === '169' && b === '254')) {
        return { ok: false, error: 'Internal IP not allowed' };
      }
    }
    
    return { ok: true, url: decoded, host, parsed: url };
  } catch (e) {
    log('Validation error:', e.message, 'Raw:', raw);
    return { ok: false, error: 'Invalid URL format' };
  }
}

// ============================================
// HEADER MANAGEMENT
// ============================================
function buildHeaders(req, host) {
  const h = new Headers();
  ['accept', 'accept-language', 'cookie', 'content-type', 'content-length', 'authorization'].forEach(k => {
    const v = req.headers.get(k);
    if (v) h.set(k, v);
  });
  h.set('User-Agent', C.UA);
  h.set('Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8');
  h.set('Accept-Language', 'en-US,en;q=0.9');
  h.set('Accept-Encoding', 'gzip, deflate, br');
  h.set('Cache-Control', 'max-age=0');
  h.set('Upgrade-Insecure-Requests', '1');
  h.set('DNT', '1');
  h.set('Sec-Fetch-Site', 'none');
  h.set('Sec-Fetch-Mode', 'navigate');
  h.set('Sec-Fetch-Dest', 'document');
  h.set('Referer', `https://${host}/`);
  if (req.method === 'POST') h.set('Origin', `https://${host}`);
  h.set('Host', host);
  const cookie = h.get('cookie');
  if (cookie) h.set('cookie', cookie.split(';').filter(c => !c.trim().startsWith('__cf_')).join(';'));
  return h;
}

function cleanResponseHeaders(res) {
  const h = new Headers(res.headers);
  ['cf-cache-status', 'cf-ray', 'cf-polished', 'cf-edge-cache-ttl', 'cf-request-id', 'server', 'x-powered-by', 'alt-svc', 'via', 'cdn-loop', 'content-security-policy', 'x-frame-options'].forEach(k => h.delete(k));
  h.set('Access-Control-Allow-Origin', '*');
  h.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  h.set('Access-Control-Allow-Headers', '*');
  h.set('Content-Security-Policy', "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:;");
  return h;
}

// ============================================
// URL REWRITING
// ============================================
function rewriteUrl(url, base, host) {
  if (!url || typeof url !== 'string') return url;
  url = url.trim();
  
  if (/^(#|javascript:|data:|mailto:|tel:|sms:|about:|blob:|ws:|wss:|filesystem:|chrome-extension:|edge:)/i.test(url)) return url;
  
  try {
    let full;
    if (url.startsWith('http://') || url.startsWith('https://')) {
      full = url;
    } else if (url.startsWith('//')) {
      full = 'https:' + url;
    } else if (url.startsWith('/')) {
      full = `https://${host}${url}`;
    } else {
      full = new URL(url, base).href;
    }
    return '/?url=' + encodeURIComponent(full);
  } catch (e) {
    return url;
  }
}

function rewriteSrcset(srcset, base, host) {
  if (!srcset) return srcset;
  return srcset.split(',').map(p => {
    const m = p.trim().match(/^(\S+)\s*(.*)$/);
    return m ? rewriteUrl(m[1], base, host) + (m[2] ? ' ' + m[2] : '') : p;
  }).join(', ');
}

function rewriteCss(css, base, host) {
  if (!css) return css;
  return css.replace(/url\((['"]?)([^'"()]+)\1\)/g, (_, q, u) => `url(${q}${rewriteUrl(u, base, host)}${q})`);
}

// ============================================
// HTML REWRITER - COMPLETE REWRITE
// ============================================
async function rewriteHtml(html, base, host) {
  const rewriter = new HTMLRewriter();
  const attrs = { 
    a: ['href'], 
    link: ['href'], 
    script: ['src'], 
    img: ['src', 'srcset'], 
    form: ['action'], 
    iframe: ['src'], 
    video: ['src', 'poster'], 
    audio: ['src'], 
    source: ['src', 'srcset'], 
    object: ['data'], 
    embed: ['src'], 
    track: ['src'], 
    meta: ['content'], 
    body: ['background'] 
  };
  
  Object.entries(attrs).forEach(([el, atts]) => atts.forEach(attr => {
    rewriter.on(el, {
      element(e) {
        const v = e.getAttribute(attr);
        if (v) {
          const r = attr === 'srcset' ? rewriteSrcset(v, base, host) : rewriteUrl(v, base, host);
          if (r !== v) e.setAttribute(attr, r);
        }
        if (el === 'a') {
          const target = e.getAttribute('target');
          if (target === '_blank') {
            e.removeAttribute('target');
          }
          // FIX: Add data-proxied attribute to track
          e.setAttribute('data-proxied', 'true');
        }
      }
    });
  }));
  
  rewriter.on('img', {
    element(e) {
      const s = e.getAttribute('srcset');
      if (s) { const r = rewriteSrcset(s, base, host); if (r !== s) e.setAttribute('srcset', r); }
    }
  });
  
  rewriter.on('*', {
    element(e) {
      const s = e.getAttribute('style');
      if (s) { const r = rewriteCss(s, base, host); if (r !== s) e.setAttribute('style', r); }
    }
  });
  
  // NEW: Complete client-side interception using event delegation
  rewriter.on('head', {
    element(e) {
      e.append(`
        <script>
        (function() {
          'use strict';
          
          // Configuration
          var proxyBase = window.location.origin;
          
          // Helper: Check if URL should be proxied
          function shouldProxy(url) {
            if (!url || typeof url !== 'string') return false;
            if (url.startsWith('/?url=')) return false;
            if (/^(#|javascript:|data:|mailto:|tel:|sms:|about:|blob:|ws:|wss:|filesystem:)/i.test(url)) return false;
            if (url.startsWith('http://') || url.startsWith('https://')) return true;
            return true; // Relative URLs should be proxied
          }
          
          // Helper: Proxy a URL
          function proxyUrl(url) {
            if (!url || typeof url !== 'string') return url;
            if (url.startsWith('/?url=')) return url;
            if (/^(#|javascript:|data:|mailto:|tel:|sms:|about:|blob:|ws:|wss:|filesystem:)/i.test(url)) return url;
            
            try {
              // Resolve relative URLs
              if (!url.startsWith('http://') && !url.startsWith('https://')) {
                url = new URL(url, window.location.href).href;
              }
              // Check if it's already a proxy URL
              if (url.includes('/?url=')) return url;
              return '/?url=' + encodeURIComponent(url);
            } catch(e) {
              return url;
            }
          }
          
          // ============================================================
          // METHOD 1: GLOBAL EVENT DELEGATION (Most Reliable)
          // ============================================================
          document.addEventListener('click', function(e) {
            // Find the closest anchor element
            var target = e.target.closest('a');
            
            if (target && target.href) {
              var href = target.href;
              
              // Skip if already proxied
              if (href.includes('/?url=')) return;
              
              // Skip special protocols
              if (/^(#|javascript:|data:|mailto:|tel:|sms:|about:|blob:)/i.test(href)) return;
              
              // This is a normal HTTP/HTTPS link or relative link
              e.preventDefault();
              e.stopPropagation();
              e.stopImmediatePropagation();
              
              // Navigate through proxy
              window.location.href = proxyUrl(href);
              return false;
            }
            
            // Handle buttons that might trigger navigation (GitHub widgets)
            var button = e.target.closest('button');
            if (button) {
              // Check if button has formaction or data attributes
              var formAction = button.getAttribute('formaction');
              var dataUrl = button.getAttribute('data-url') || button.getAttribute('data-href');
              
              if (formAction && shouldProxy(formAction)) {
                e.preventDefault();
                e.stopPropagation();
                window.location.href = proxyUrl(formAction);
                return false;
              }
              
              if (dataUrl && shouldProxy(dataUrl)) {
                e.preventDefault();
                e.stopPropagation();
                window.location.href = proxyUrl(dataUrl);
                return false;
              }
            }
          }, true); // Use capture phase to intercept before anything else
          
          // ============================================================
          // METHOD 2: OVERRIDE NAVIGATION METHODS
          // ============================================================
          var originalOpen = window.open;
          window.open = function(url, name, features) {
            if (url && typeof url === 'string' && shouldProxy(url)) {
              window.location.href = proxyUrl(url);
              return null;
            }
            return originalOpen.call(this, url, name, features);
          };
          
          var originalAssign = location.assign;
          location.assign = function(url) {
            if (url && typeof url === 'string' && shouldProxy(url)) {
              return originalAssign.call(this, proxyUrl(url));
            }
            return originalAssign.call(this, url);
          };
          
          var originalReplace = location.replace;
          location.replace = function(url) {
            if (url && typeof url === 'string' && shouldProxy(url)) {
              return originalReplace.call(this, proxyUrl(url));
            }
            return originalReplace.call(this, url);
          };
          
          // ============================================================
          // METHOD 3: OVERRIDE FETCH AND XHR
          // ============================================================
          var originalFetch = window.fetch;
          window.fetch = function(input, init) {
            var url = typeof input === 'string' ? input : input.url;
            if (shouldProxy(url)) {
              var pu = proxyUrl(url);
              if (typeof input === 'string') {
                return originalFetch(pu, init);
              } else {
                return originalFetch(new Request(pu, input), init);
              }
            }
            return originalFetch(input, init);
          };
          
          var originalOpenXHR = XMLHttpRequest.prototype.open;
          XMLHttpRequest.prototype.open = function(method, url, async, user, password) {
            if (shouldProxy(url)) {
              return originalOpenXHR.call(this, method, proxyUrl(url), async, user, password);
            }
            return originalOpenXHR.call(this, method, url, async, user, password);
          };
          
          // ============================================================
          // METHOD 4: MUTATION OBSERVER FOR DYNAMIC CONTENT
          // ============================================================
          var observer = new MutationObserver(function(mutations) {
            mutations.forEach(function(mutation) {
              mutation.addedNodes.forEach(function(node) {
                if (node.nodeType === 1) {
                  // Process all links in the added node
                  var links = node.querySelectorAll ? node.querySelectorAll('a[href]') : [];
                  if (node.tagName === 'A' && node.href) {
                    links = [node].concat(links);
                  }
                  
                  links.forEach(function(link) {
                    var href = link.getAttribute('href');
                    if (href && typeof href === 'string') {
                      // Skip if already proxied
                      if (href.startsWith('/?url=')) return;
                      // Skip special protocols
                      if (/^(#|javascript:|data:|mailto:|tel:|blob:)/i.test(href)) return;
                      // Proxy it
                      link.setAttribute('href', proxyUrl(href));
                    }
                    // Remove target="_blank"
                    if (link.getAttribute('target') === '_blank') {
                      link.removeAttribute('target');
                    }
                  });
                  
                  // Process buttons with formaction
                  var buttons = node.querySelectorAll ? node.querySelectorAll('button[formaction], button[data-url], button[data-href]') : [];
                  if (node.tagName === 'BUTTON' && (node.hasAttribute('formaction') || node.hasAttribute('data-url') || node.hasAttribute('data-href'))) {
                    buttons = [node].concat(buttons);
                  }
                  
                  buttons.forEach(function(btn) {
                    var action = btn.getAttribute('formaction') || btn.getAttribute('data-url') || btn.getAttribute('data-href');
                    if (action && typeof action === 'string') {
                      if (!action.startsWith('/?url=') && !/^(#|javascript:)/i.test(action)) {
                        btn.setAttribute('data-proxied-url', proxyUrl(action));
                      }
                    }
                  });
                }
              });
            });
          });
          
          if (document.body) {
            observer.observe(document.body, { childList: true, subtree: true });
          } else {
            document.addEventListener('DOMContentLoaded', function() {
              observer.observe(document.body, { childList: true, subtree: true });
            });
          }
          
          // ============================================================
          // METHOD 5: OVERRIDE createElement
          // ============================================================
          var originalCreateElement = document.createElement;
          document.createElement = function(tagName) {
            var element = originalCreateElement.call(this, tagName);
            var tag = tagName.toLowerCase();
            
            if (tag === 'a') {
              var originalSetAttribute = element.setAttribute;
              element.setAttribute = function(name, value) {
                if (name === 'href' && value && typeof value === 'string') {
                  if (!value.startsWith('/?url=') && !/^(#|javascript:|data:|mailto:|tel:|blob:)/i.test(value)) {
                    value = proxyUrl(value);
                  }
                }
                return originalSetAttribute.call(this, name, value);
              };
              
              Object.defineProperty(element, 'href', {
                get: function() { return this.getAttribute('href'); },
                set: function(value) {
                  if (value && typeof value === 'string') {
                    if (!value.startsWith('/?url=') && !/^(#|javascript:|data:|mailto:|tel:|blob:)/i.test(value)) {
                      value = proxyUrl(value);
                    }
                  }
                  this.setAttribute('href', value);
                },
                configurable: true
              });
            }
            
            return element;
          };
          
          console.log('WebCore: Full interception active');
        })();
        </script>
      `, { html: true });
    }
  });
  
  rewriter.on('style', { 
    text(t) { 
      const r = rewriteCss(t.text, base, host); 
      if (r !== t.text) t.replace(r, { html: true }); 
    } 
  });
  
  rewriter.on('script', {
    text(t) {
      if (t.text.includes('fetch(') || t.text.includes('XMLHttpRequest')) {
        const r = t.text.replace(/['"](https?:\/\/[^'"]+)['"]/g, (m, u) => `'${rewriteUrl(u, base, host)}'`);
        if (r !== t.text) t.replace(r, { html: true });
      }
    }
  });
  
  return rewriter.transform(new Response(html)).text();
}

// ============================================
// FETCH TARGET
// ============================================
async function fetchTarget(url, headers, method, body) {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), C.TIMEOUT);
  try {
    const opts = { method: method || 'GET', headers, redirect: 'manual', signal: ctrl.signal };
    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) opts.body = body;
    opts.cf = { cacheTtl: 300, cacheKey: url, polish: 'lossy', minify: true };
    const res = await fetch(url, opts);
    clearTimeout(tid);
    return res;
  } catch (e) {
    clearTimeout(tid);
    throw e;
  }
}

// ============================================
// RESPONSE PROCESSING
// ============================================
async function processResponse(res, base, host) {
  const h = cleanResponseHeaders(res);
  const ct = res.headers.get('content-type') || '';
  let body;
  if (ct.includes('text/html')) {
    const html = await res.text();
    body = await rewriteHtml(html, base, host);
  } else if (ct.includes('text/css')) {
    const css = await res.text();
    body = rewriteCss(css, base, host);
  } else if (ct.includes('application/javascript') || ct.includes('text/javascript')) {
    body = await res.text();
  } else if (ct.includes('application/json')) {
    body = await res.text();
  } else {
    body = res.body;
  }
  const newRes = new Response(body, { status: res.status, statusText: res.statusText, headers: h });
  if (!h.has('cache-control')) newRes.headers.set('cache-control', `public, max-age=300`);
  return newRes;
}

// ============================================
// LANDING PAGE
// ============================================
function landingPage() {
  return new Response(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>webcore</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
            background: #f0f2f5; 
            color: #1a1a2e; 
            display: flex; 
            justify-content: center; 
            align-items: center; 
            min-height: 100vh; 
            margin: 0; 
            padding: 20px; 
          }
          .container { 
            background: #ffffff; 
            padding: 48px 40px; 
            border-radius: 20px; 
            box-shadow: 0 8px 40px rgba(0,0,0,0.08); 
            max-width: 600px; 
            width: 100%; 
          }
          .logo { 
            font-size: 28px; 
            font-weight: 700; 
            margin: 0 0 4px 0; 
            color: #1a1a2e; 
            letter-spacing: -0.5px; 
          }
          .logo span {
            color: #2563eb;
          }
          .sub { 
            color: #6b7280; 
            font-size: 15px; 
            margin-bottom: 32px; 
            font-weight: 400; 
          }
          .label { 
            font-size: 11px; 
            font-weight: 600; 
            color: #9ca3af; 
            text-transform: uppercase; 
            letter-spacing: 0.5px; 
            margin-bottom: 8px; 
          }
          .example { 
            background: #f8fafc; 
            border-radius: 10px; 
            padding: 14px 18px; 
            margin-bottom: 10px; 
            font-size: 14px; 
            font-family: 'SF Mono', 'Menlo', 'Consolas', monospace; 
            word-break: break-all; 
            color: #1e293b; 
            border: 1px solid #e2e8f0;
          }
          .examples { 
            margin-top: 24px; 
          }
          .examples a { 
            display: block; 
            padding: 14px 18px; 
            background: #f8fafc; 
            border-radius: 10px; 
            color: #2563eb; 
            text-decoration: none; 
            font-size: 15px; 
            margin-bottom: 8px; 
            transition: background 0.15s, transform 0.1s; 
            word-break: break-all; 
            border: 1px solid #e2e8f0;
            font-weight: 500;
          }
          .examples a:hover { 
            background: #eff6ff; 
            border-color: #93c5fd;
            transform: translateY(-1px);
          }
          .examples a:active {
            transform: scale(0.98);
          }
          .footer { 
            margin-top: 28px; 
            padding-top: 20px; 
            border-top: 1px solid #e5e7eb; 
            font-size: 13px; 
            color: #9ca3af; 
            text-align: center; 
          }
          code { 
            background: #f1f3f5; 
            padding: 2px 8px; 
            border-radius: 4px; 
            font-size: 13px; 
            color: #dc2626; 
            font-weight: 500;
          }
          .badge {
            display: inline-block;
            background: #dbeafe;
            color: #1d4ed8;
            font-size: 11px;
            font-weight: 600;
            padding: 2px 10px;
            border-radius: 20px;
            margin-left: 8px;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="logo">web<span>core</span></div>
          <p class="sub">Access websites through this proxy service.</p>
          
          <div class="label">Usage</div>
          <div class="example">/?url=https://example.com/path</div>
          
          <div class="label">Quick Links</div>
          <div class="examples">
            <a href="/?url=https://duckduckgo.com/search?q=test">DuckDuckGo Search <span class="badge">test</span></a>
            <a href="/?url=https://github.com/search?q=proxy">GitHub Search <span class="badge">proxy</span></a>
            <a href="/?url=https://en.wikipedia.org/wiki/Main_Page">Wikipedia</a>
            <a href="/?url=https://www.bing.com/search?q=hello">Bing Search <span class="badge">hello</span></a>
          </div>
          
          <div class="footer">
            Enter any URL with <code>?url=</code> parameter
          </div>
        </div>
      </body>
    </html>
  `, { headers: { 'Content-Type': 'text/html' } });
}

// ============================================
// ERROR HANDLING
// ============================================
function errorPage(msg, status = 500) {
  log('Error:', msg);
  return new Response(`
    <!DOCTYPE html>
    <html>
      <head><title>webcore - Error</title>
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { 
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
          background: #f0f2f5; 
          color: #1a1a2e; 
          display: flex; 
          justify-content: center; 
          align-items: center; 
          min-height: 100vh; 
          margin: 0; 
          padding: 20px; 
        }
        .container { 
          background: #ffffff; 
          padding: 48px 40px; 
          border-radius: 20px; 
          box-shadow: 0 8px 40px rgba(0,0,0,0.08); 
          max-width: 480px; 
          width: 100%; 
          text-align: center; 
        }
        h1 { 
          font-size: 52px; 
          margin: 0 0 4px 0; 
          color: #dc2626; 
          font-weight: 300; 
          letter-spacing: -2px; 
        }
        p { 
          font-size: 16px; 
          color: #6b7280; 
          margin: 8px 0; 
          line-height: 1.6; 
        }
        .back { 
          margin-top: 28px; 
        }
        .back a { 
          color: #2563eb; 
          text-decoration: none; 
          font-weight: 500; 
          padding: 10px 24px;
          background: #eff6ff;
          border-radius: 8px;
          display: inline-block;
          transition: background 0.15s;
        }
        .back a:hover { 
          background: #dbeafe; 
        }
        .detail { 
          font-size: 13px; 
          color: #9ca3af; 
          margin-top: 16px; 
          font-family: 'SF Mono', 'Menlo', monospace; 
          word-break: break-all; 
        }
      </style>
      </head>
      <body>
        <div class="container">
          <h1>${status}</h1>
          <p>${msg}</p>
          <div class="back"><a href="/">Return Home</a></div>
        </div>
      </body>
    </html>
  `, { status, headers: { 'Content-Type': 'text/html' } });
}

// ============================================
// MAIN HANDLER
// ============================================
export default {
  async fetch(request, env, ctx) {
    try {
      if (request.method === 'OPTIONS') {
        return new Response(null, { headers: { 
          'Access-Control-Allow-Origin': '*', 
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS', 
          'Access-Control-Allow-Headers': '*' 
        }});
      }

      const url = new URL(request.url);
      const rawUrl = url.searchParams.get('url');
      
      if (!rawUrl) {
        return landingPage();
      }

      const v = validateUrl(rawUrl);
      if (!v.ok) {
        return errorPage(v.error, 400);
      }

      const headers = buildHeaders(request, v.host);
      let body = null;
      if (['POST', 'PUT', 'PATCH'].includes(request.method)) {
        body = await request.clone().arrayBuffer();
      }

      const res = await fetchTarget(v.url, headers, request.method, body);

      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        if (loc) {
          try {
            const resolved = new URL(loc, v.url).href;
            return Response.redirect('/?url=' + encodeURIComponent(resolved), res.status);
          } catch (e) {
            return res;
          }
        }
      }

      const processed = await processResponse(res, v.url, v.host);
      log('Success:', v.url);
      return processed;

    } catch (e) {
      return errorPage(e.message || 'Internal server error');
    }
  }
};
