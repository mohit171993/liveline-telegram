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
