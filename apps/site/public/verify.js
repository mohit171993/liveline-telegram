(function () {
  "use strict";
  var root = document.querySelector(".vf");
  if (!root) return;
  var $ = function (id) { return document.getElementById(id); };
  var next = root.getAttribute("data-next") || "/";
  var ttl = Number(root.getAttribute("data-ttl") || 0);
  var linkBorn = Date.now();
  var polling = null, waiting = false;

  function go(to) { window.location.replace(to || next || "/"); }
  function post(url, body) {
    return fetch(url, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { d._status = r.status; return d; }); });
  }

  /* ---------- Telegram ---------- */
  var idle = $("tg-idle"), wait = $("tg-wait"), done = $("tg-done"), btn = $("tg-btn"), again = $("tg-again");

  function setLink(link) { if (btn) btn.href = link; if (again) again.href = link; }
  function refreshLink() {
    return post("/verify/tg/new").then(function (d) { if (d.ok && d.link) { setLink(d.link); ttl = d.ttl; linkBorn = Date.now(); } });
  }
  function linkStale() { return ttl > 0 && Date.now() - linkBorn > (ttl - 60) * 1000; }

  function poll() {
    fetch("/verify/tg/status", { credentials: "same-origin", cache: "no-store" }).then(function (r) { return r.json(); }).then(function (d) {
      if (d.status === "verified") {
        stopPoll(); idle.hidden = true; wait.hidden = true; done.hidden = false;
        try { sessionStorage.removeItem("llp_wv_wait"); } catch (e) {}
        setTimeout(function () { go(d.next); }, 600);
      } else if (d.status === "expired" && waiting) {
        $("tg-wait-sub").textContent = "That link expired — tap “Open Telegram again”.";
        refreshLink();
      }
    }).catch(function () {});
  }
  function startPoll() { if (!polling) { poll(); polling = setInterval(poll, 2000); } }
  function stopPoll() { if (polling) { clearInterval(polling); polling = null; } }
  function showWait() {
    waiting = true; idle.hidden = true; wait.hidden = false; startPoll();
    try { sessionStorage.setItem("llp_wv_wait", String(Date.now())); } catch (e) {}
  }

  if (btn) btn.addEventListener("click", function (ev) {
    if (linkStale()) { ev.preventDefault(); refreshLink().then(function () { window.open(btn.href, "_blank", "noopener"); showWait(); }); return; }
    showWait();
  });
  if (again) again.addEventListener("click", function () { startPoll(); });
  $("tg-cancel") && $("tg-cancel").addEventListener("click", function () {
    waiting = false; stopPoll(); wait.hidden = true; idle.hidden = false;
    try { sessionStorage.removeItem("llp_wv_wait"); } catch (e) {}
  });
  // Coming back from Telegram: check right away.
  document.addEventListener("visibilitychange", function () { if (!document.hidden && waiting) poll(); });
  window.addEventListener("focus", function () { if (waiting) poll(); });
  try {
    var t = Number(sessionStorage.getItem("llp_wv_wait") || 0);
    if (t && Date.now() - t < 15 * 60 * 1000 && btn) showWait();
  } catch (e) {}

  /* ---------- SMS OTP ---------- */
  var smsOn = root.getAttribute("data-sms") === "1";
  var form = $("sms-form"); if (!form) return;
  var msg = $("sms-msg"), phoneIn = $("sms-phone"), codeIn = $("sms-code"), age = $("sms-age"), terms = $("sms-terms");
  var stepPhone = $("sms-step-phone"), stepCode = $("sms-step-code"), resend = $("sms-resend"), timerEl = $("sms-timer");
  var timer = null, phone = "";

  function say(text, ok) { msg.textContent = text || ""; msg.className = "vf-msg" + (ok ? " ok" : ""); }
  function countdown(s) {
    clearInterval(timer); resend.disabled = true;
    var left = s;
    timerEl.textContent = "in " + left + "s";
    timer = setInterval(function () {
      left -= 1;
      if (left <= 0) { clearInterval(timer); resend.disabled = false; timerEl.textContent = ""; }
      else timerEl.textContent = "in " + left + "s";
    }, 1000);
  }
  function send() {
    if (!smsOn) return;
    phone = (phoneIn.value || "").replace(/[^\d+]/g, "");
    if (!/^(\+?91)?[6-9]\d{9}$/.test(phone.replace(/^0/, "")) && !/^\+\d{8,15}$/.test(phone)) { say("Enter a valid 10-digit mobile number."); phoneIn.focus(); return; }
    if (!age.checked || !terms.checked) { say("Please confirm you're 18+ and accept the terms."); return; }
    $("sms-send").disabled = true; resend.disabled = true; say("Sending code…", true);
    post("/verify/sms/send", { phone: phone, age: true, terms: true }).then(function (d) {
      $("sms-send").disabled = false;
      if (!d.ok) { say(d.message || "Couldn't send the code."); if (d.retryIn && stepCode && !stepCode.hidden) countdown(d.retryIn); return; }
      var digits = phone.replace(/\D/g, "").slice(-10);
      $("sms-to").textContent = "+91 " + digits.slice(0, 5) + " " + digits.slice(5);
      stepPhone.hidden = true; stepCode.hidden = false; codeIn.value = ""; codeIn.focus();
      say("Code sent. It's valid for 5 minutes.", true); countdown(d.resendIn || 30);
    }).catch(function () { $("sms-send").disabled = false; say("Network error. Try again."); });
  }
  function verify() {
    var code = (codeIn.value || "").replace(/\D/g, "");
    if (code.length !== 6) { say("Enter the 6-digit code."); return; }
    $("sms-verify").disabled = true; say("Checking…", true);
    post("/verify/sms/verify", { phone: phone, code: code, age: true, terms: true }).then(function (d) {
      $("sms-verify").disabled = false;
      if (d.ok) { say("Verified! Taking you in…", true); setTimeout(function () { go(d.next); }, 400); return; }
      say(d.message || "That didn't work.");
      if (d.error === "locked" || d.error === "expired") { codeIn.value = ""; resend.disabled = false; clearInterval(timer); timerEl.textContent = ""; }
    }).catch(function () { $("sms-verify").disabled = false; say("Network error. Try again."); });
  }
  form.addEventListener("submit", function (e) { e.preventDefault(); if (stepCode.hidden) send(); else verify(); });
  $("sms-verify").addEventListener("click", verify);
  resend.addEventListener("click", send);
  $("sms-change").addEventListener("click", function () { stepCode.hidden = true; stepPhone.hidden = false; clearInterval(timer); say(""); phoneIn.focus(); });
  codeIn.addEventListener("input", function () { codeIn.value = codeIn.value.replace(/\D/g, "").slice(0, 6); if (codeIn.value.length === 6) verify(); });
})();
