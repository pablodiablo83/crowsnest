// Crow's Nest - network layer for the phone app. In a normal browser it does nothing.
// Inside the app (Capacitor) the same pages run from the phone, so this file:
//  - sends every /api/... request to the server's /api/v1/... with this phone's token (paired on connect.html);
//  - keeps the last good answer to each GET and shows it when there is no connection (with an "Offline" banner);
//  - mirrors the outbox and settings into native storage (iOS may clear web storage; native storage it does not);
//  - routes location to the native plugin, and print / downloads to the web version in Safari.
// Load it first, before any other script.
(function () {
  'use strict';
  var C = window.Capacitor;
  var isApp = !!(C && (typeof C.isNativePlatform === 'function' ? C.isNativePlatform() : C.platform && C.platform !== 'web'));
  var DEFAULT_SERVER = 'https://app.crows-nest.co.uk';
  var MIRROR = ['cn_tapq', 'cn_tapq_failed', 'cn_posq', 'cn_server', 'cn_token', 'cn_device', 'cn_fix', 'cn.crew', 'cn_bg', 'cn_windModel', 'cn_inshoreArea', 'cn_tidePort', 'cn_tidePlace', 'cn_tideRecent'];
  var CACHE = 'cn_cache:', CACHE_MAX = 400000, TIMEOUT_MS = 20000;
  function plug(name) { return isApp && ((C.Plugins && C.Plugins[name]) || (C.registerPlugin && C.registerPlugin(name))) || null; }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }

  var CNNet = window.CNNet = {
    isApp: isApp, offline: false, cachedAt: null, ready: Promise.resolve(),
    server: function () { return (lsGet('cn_server') || DEFAULT_SERVER).replace(/\/+$/, ''); },
    device: function () { try { return JSON.parse(lsGet('cn_device') || 'null'); } catch (e) { return null; } },
    plug: plug
  };
  if (!isApp) {   // web: a page whose sign-in has expired goes to the login page (and comes back afterwards)
    var webFetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
      return webFetch(input, init).then(function (r) {
        var url = typeof input === 'string' ? input : (input && input.url) || '';
        if (r.status === 401 && /^\/api\/(?!v1\/|auth\/login)/.test(url) && !/\/login\.html$/.test(location.pathname)) {
          location.replace('/login.html?next=' + encodeURIComponent(location.pathname + location.search));
        }
        return r;
      });
    };
    return;
  }
  document.documentElement.classList.add('cn-app');
  // full-screen in the app: keep content clear of the notch / status bar (Safari did this for the web pages)
  var css = document.createElement('style');
  css.textContent = 'html.cn-app body{padding-top:env(safe-area-inset-top)}';
  document.head.appendChild(css);
  var SB = plug('StatusBar'); if (SB) SB.setStyle({ style: 'DARK' }).catch(function () {});   // light text on the navy header

  /* ---- storage: localStorage stays the fast copy; native Preferences is the durable one ---- */
  var Prefs = plug('Preferences');
  var setItem = Storage.prototype.setItem, removeItem = Storage.prototype.removeItem;
  if (Prefs) {
    Storage.prototype.setItem = function (k, v) {
      setItem.call(this, k, v);
      if (this === window.localStorage && MIRROR.indexOf(k) >= 0) Prefs.set({ key: k, value: String(v) }).catch(function () {});
    };
    Storage.prototype.removeItem = function (k) {
      removeItem.call(this, k);
      if (this === window.localStorage && MIRROR.indexOf(k) >= 0) Prefs.remove({ key: k }).catch(function () {});
    };
    // restore anything iOS cleared from web storage
    CNNet.ready = Promise.all(MIRROR.map(function (k) {
      if (lsGet(k) !== null) return null;
      return Prefs.get({ key: k }).then(function (r) { if (r && r.value != null) setItem.call(localStorage, k, r.value); }).catch(function () {});
    })).then(function () { try { document.dispatchEvent(new CustomEvent('cn:hydrated')); } catch (e) {} });
  }

  /* ---- not paired yet: go to the connect page ---- */
  var onConnect = /\/connect\.html$/.test(location.pathname);
  CNNet.ready.then(function () { if (!lsGet('cn_token') && !onConnect) location.replace('/connect.html'); });

  /* ---- offline banner ---- */
  var banner = null;
  function p2(n) { return String(n).padStart(2, '0'); }
  function showBanner() {
    if (!document.body) return;
    if (!banner) {
      banner = document.createElement('div'); banner.id = 'cnNetBanner'; banner.setAttribute('role', 'status');
      banner.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:9999;padding:calc(env(safe-area-inset-top) + 4px) 12px 5px;' +
        'background:#7A4E00;color:#FFF4DC;font:600 12px/1.35 Lato,system-ui,sans-serif;text-align:center;display:none';
      document.body.appendChild(banner);
    }
    var t = CNNet.cachedAt ? new Date(CNNet.cachedAt) : null;
    banner.textContent = 'Offline' + (t ? ' · showing what was saved at ' + p2(t.getHours()) + ':' + p2(t.getMinutes()) : '') + ' · taps are kept on this phone';
    banner.style.display = CNNet.offline ? '' : 'none';
    document.body.style.paddingTop = CNNet.offline ? banner.offsetHeight + 'px' : '';   // keep the page header clear of it
  }
  function setOffline(v, cachedAt) {
    var was = CNNet.offline; CNNet.offline = v; if (v && cachedAt) CNNet.cachedAt = cachedAt; if (!v) CNNet.cachedAt = null;
    showBanner();
    if (was !== v) { try { document.dispatchEvent(new CustomEvent('cn:net', { detail: { offline: v } })); } catch (e) {} }
  }
  document.addEventListener('DOMContentLoaded', showBanner);

  /* ---- GET cache ---- */
  function cachePut(url, body) {
    if (body.length > CACHE_MAX) return;
    var v = JSON.stringify({ at: new Date().toISOString(), body: body });
    try { setItem.call(localStorage, CACHE + url, v); }
    catch (e) {   // full: drop the cache (never the outbox) and try once more
      for (var i = localStorage.length - 1; i >= 0; i--) { var k = localStorage.key(i); if (k && k.indexOf(CACHE) === 0) removeItem.call(localStorage, k); }
      try { setItem.call(localStorage, CACHE + url, v); } catch (e2) {}
    }
  }
  function cacheGet(url) { try { return JSON.parse(lsGet(CACHE + url) || 'null'); } catch (e) { return null; } }
  function fromCache(url) {
    var c = cacheGet(url); if (!c) return null;
    setOffline(true, c.at);
    return new Response(c.body, { status: 200, headers: { 'Content-Type': 'application/json', 'X-CN-Cached': c.at } });
  }

  /* ---- fetch: /api/... -> server /api/v1/... with the token ---- */
  var nativeFetch = window.fetch.bind(window);
  CNNet.rawFetch = nativeFetch;
  window.fetch = async function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    if (!/^\/api\//.test(url)) return nativeFetch(input, init);
    await CNNet.ready;
    init = Object.assign({}, init || {});
    var method = String(init.method || 'GET').toUpperCase();
    var headers = new Headers(init.headers || {}), tok = lsGet('cn_token');
    if (tok) headers.set('Authorization', 'Bearer ' + tok);
    init.headers = headers;
    var ac = null, timer = null;
    if (!init.signal && window.AbortController) { ac = new AbortController(); init.signal = ac.signal; timer = setTimeout(function () { ac.abort(); }, TIMEOUT_MS); }
    var r;
    try { r = await nativeFetch(CNNet.server() + '/api/v1' + url.slice(4), init); }
    catch (e) {
      clearTimeout(timer);
      var c = method === 'GET' && fromCache(url); if (c) return c;
      setOffline(true); throw e;
    }
    clearTimeout(timer);
    if (r.status >= 500 && method === 'GET') { var c2 = fromCache(url); if (c2) return c2; }   // tunnel up, server down
    if (r.status < 500) setOffline(false);
    if (r.status === 401) {
      var d = null; try { d = await r.clone().json(); } catch (e) {}
      if (d && d.code === 'unauthorised') { CNNet.disconnect(); }
    }
    // no-store: data the server may not let us keep (e.g. UKHO free-tier predictions) is never cached on the phone
    if (method === 'GET' && r.ok && /json/.test(r.headers.get('Content-Type') || '') && !/no-store/i.test(r.headers.get('Cache-Control') || '')) {
      try { cachePut(url, await r.clone().text()); } catch (e) {}
    }
    return r;
  };

  /* ---- pairing ---- */
  CNNet.pair = async function (server, code, name) {
    server = String(server || DEFAULT_SERVER).trim().replace(/\/+$/, '');
    if (!/^https:\/\//.test(server) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(server)) throw new Error('The server address must start with https://');
    var r = await nativeFetch(server + '/api/v1/auth/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: code, name: name }) });
    var d = null; try { d = await r.json(); } catch (e) {}
    if (!r.ok || !d || !d.token) throw new Error((d && d.error) || ('The server answered ' + r.status));
    localStorage.setItem('cn_server', server);
    localStorage.setItem('cn_token', d.token);
    localStorage.setItem('cn_device', JSON.stringify(d.device));
    return d.device;
  };
  CNNet.disconnect = function () {
    ['cn_token', 'cn_device'].forEach(function (k) { localStorage.removeItem(k); });
    for (var i = localStorage.length - 1; i >= 0; i--) { var k = localStorage.key(i); if (k && k.indexOf(CACHE) === 0) removeItem.call(localStorage, k); }
    if (!onConnect) location.replace('/connect.html');
  };

  /* ---- outside links, downloads and print open the web version in Safari ---- */
  var Browser = plug('Browser');
  CNNet.openExternal = function (url) { if (Browser) Browser.open({ url: url }).catch(function () {}); else window.open(url, '_blank'); };
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href]'); if (!a) return;
    var h = a.getAttribute('href');
    if (/^\/api\//.test(h)) { e.preventDefault(); CNNet.openExternal(CNNet.server() + h); }
    else if (/^https?:\/\//.test(h)) { e.preventDefault(); CNNet.openExternal(h); }
  }, true);
  window.print = function () {   // the app's web view cannot print: open this page in Safari, where Print works
    if (window.confirm('Printing opens this page in Safari (web login). Then use Print there.')) CNNet.openExternal(CNNet.server() + location.pathname + location.search);
  };

  /* ---- location through the native plugin (proper iOS permission prompt) ---- */
  var Geo = plug('Geolocation');
  if (Geo && navigator.geolocation) {
    var conv = function (p) { return { timestamp: p.timestamp, coords: p.coords }; };
    var gerr = function (cb, e) { if (cb) cb({ code: /denied|permission/i.test(String(e && e.message)) ? 1 : 2, message: String(e && e.message || e) }); };
    var watches = {}, n = 0, g = navigator.geolocation;
    var def = function (k, f) { try { Object.defineProperty(g, k, { value: f, configurable: true }); } catch (e) { g[k] = f; } };
    def('getCurrentPosition', function (ok, err, opt) { Geo.getCurrentPosition(opt || {}).then(function (p) { ok(conv(p)); }, function (e) { gerr(err, e); }); });
    def('watchPosition', function (ok, err, opt) {
      var id = ++n; watches[id] = undefined;
      Geo.watchPosition(opt || {}, function (p, e) { if (e) gerr(err, e); else if (p) ok(conv(p)); })
        .then(function (cid) { if (watches[id] === null) Geo.clearWatch({ id: cid }); else watches[id] = cid; });
      return id;
    });
    def('clearWatch', function (id) { var c = watches[id]; if (c) Geo.clearWatch({ id: c }); watches[id] = null; });
  }

  /* ---- back in the foreground: send what is waiting ---- */
  var App = plug('App');
  if (App) App.addListener('resume', function () { if (window.CNTapQ) window.CNTapQ.flush(); }).catch(function () {});
})();
