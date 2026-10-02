import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { ErrorBoundary } from "./ui";
import { applyTheme, initialTheme } from "./brand/Brand";
import "./styles.css";
import { toast } from "./lib";

applyTheme(initialTheme());

// No silent taps: any failed action shows a toast instead of doing nothing.
let lastToast = { text: "", at: 0 };
window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason as { message?: string } | undefined;
  const text = reason?.message || "Something went wrong. Try again.";
  if (text === lastToast.text && Date.now() - lastToast.at < 10_000) return;
  lastToast = { text, at: Date.now() };
  toast(text, "err");
});
// Every button press gives a light haptic tick inside Telegram.
document.addEventListener("click", (event) => {
  const el = (event.target as HTMLElement | null)?.closest("button, a");
  if (el && !(el as HTMLButtonElement).disabled) window.Telegram?.WebApp?.HapticFeedback?.selectionChanged();
}, { capture: true });

// Typing: while a text field has focus, hide the fixed tab bar / sticky ad (on phones they ride up
// with the keyboard and cover the field) and keep the field in view once the keyboard opens.
const TYPABLE = 'input:not([type=checkbox]):not([type=radio]):not([type=file]):not([type=range]):not([readonly]), textarea, [contenteditable="true"]';
document.addEventListener("focusin", (event) => {
  const el = event.target as HTMLElement | null;
  if (!el?.matches?.(TYPABLE)) return;
  document.documentElement.classList.add("kb-open");
  setTimeout(() => { if (document.activeElement === el) el.scrollIntoView({ block: "center", behavior: "smooth" }); }, 300);
});
document.addEventListener("focusout", () => {
  setTimeout(() => { if (!(document.activeElement as HTMLElement | null)?.matches?.(TYPABLE)) document.documentElement.classList.remove("kb-open"); }, 50);
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </BrowserRouter>
  </React.StrictMode>,
);
