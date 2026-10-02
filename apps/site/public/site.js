// Auto-refresh: re-fetch server-rendered fragments (same markup as SSR). Pauses when the tab is hidden.
(function () {
  var main = document.querySelector("main[data-refresh]");
  if (!main) return;
  var every = Number(main.getAttribute("data-refresh")) || 0;
  if (!every) return;
  var busy = false;
  function tick() {
    if (busy || document.hidden) return;
    var nodes = document.querySelectorAll("[data-fragment]");
    if (!nodes.length) return;
    busy = true;
    Promise.all(Array.prototype.map.call(nodes, function (el) {
      return fetch(el.getAttribute("data-fragment"), { headers: { accept: "text/html" }, cache: "no-store" })
        .then(function (r) { return r.ok ? r.text() : null; })
        .then(function (html) {
          if (html == null || html === el.__last) return;
          var open = Array.prototype.map.call(el.querySelectorAll("details"), function (d) { return d.open; });
          var scroll = el.querySelector(".cm"); var st = scroll ? scroll.scrollTop : 0;
          el.innerHTML = html; el.__last = html;
          el.querySelectorAll("details").forEach(function (d, i) { if (open[i] !== undefined) d.open = open[i]; });
          var s2 = el.querySelector(".cm"); if (s2) s2.scrollTop = st;
          var sb = el.querySelector(".sb"); if (sb) { sb.classList.remove("flash"); void sb.offsetWidth; sb.classList.add("flash"); }
        })
        .catch(function () {});
    })).then(function () { busy = false; });
  }
  setInterval(tick, every);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) tick(); });
})();

// Ads manager: viewable impressions (50% visible), sticky close, capped interstitial.
(function () {
  var ads = document.querySelectorAll("[data-ad]");
  if (!ads.length) return;
  function send(el) {
    if (el.__seen) return; el.__seen = true;
    var body = JSON.stringify({ id: el.getAttribute("data-ad"), pl: el.getAttribute("data-pl"), pg: el.getAttribute("data-pg") });
    try { if (navigator.sendBeacon && navigator.sendBeacon("/ad/ev", new Blob([body], { type: "text/plain" }))) return; } catch (e) {}
    fetch("/ad/ev", { method: "POST", body: body, keepalive: true }).catch(function () {});
  }
  var io = "IntersectionObserver" in window ? new IntersectionObserver(function (entries) {
    entries.forEach(function (en) { if (en.isIntersecting) { send(en.target); io.unobserve(en.target); } });
  }, { threshold: 0.5 }) : null;
  Array.prototype.forEach.call(ads, function (el) {
    if (el.classList.contains("ad-inter")) return;
    if (el.classList.contains("ad-sticky")) {
      var key = "llp_sticky_x_" + el.getAttribute("data-ad");
      try { if (sessionStorage.getItem(key)) { el.remove(); return; } } catch (e) {}
      document.body.classList.add("has-sticky-ad");
      el.querySelector(".ad-x").addEventListener("click", function () {
        el.remove(); document.body.classList.remove("has-sticky-ad");
        try { sessionStorage.setItem(key, "1"); } catch (e) {}
      });
    }
    if (io) io.observe(el); else send(el);
  });
  var it = document.querySelector(".ad-inter");
  if (it) {
    var id = it.getAttribute("data-ad"), cap = Number(it.getAttribute("data-cap")) || 1;
    var day = new Date().toISOString().slice(0, 10), k = "llp_inter_" + id + "_" + day, n = 0;
    try { n = Number(localStorage.getItem(k)) || 0; } catch (e) {}
    if (n >= cap) { it.remove(); return; }
    setTimeout(function () {
      it.hidden = false; send(it);
      try { localStorage.setItem(k, String(n + 1)); } catch (e) {}
      var btn = it.querySelector(".ad-inter-x"), total = Number(it.getAttribute("data-close")) || 0;
      var label = it.querySelector(".ad-inter-left"), fg = it.querySelector(".ad-ring-fg"), C = 106.81;
      var remaining = total * 1000, last = Date.now(), timer = null;
      function close() { if (timer) clearInterval(timer); it.remove(); }
      // The ✕ is never a click on the ad: it only closes (the ad link is the card, not the button).
      btn.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); close(); });
      if (total > 0) {
        timer = setInterval(function () {
          var now = Date.now();
          if (!document.hidden) remaining -= now - last; // paused while the tab is hidden
          last = now;
          var s = Math.max(0, remaining / 1000);
          if (label) label.textContent = "Closes in " + Math.ceil(s) + "s";
          if (fg) fg.setAttribute("stroke-dashoffset", String(C * (1 - s / total)));
          btn.setAttribute("aria-label", "Close ad (closes in " + Math.ceil(s) + " s)");
          if (remaining <= 0) close();
        }, 200);
      }
    }, 1200);
  }
})();
