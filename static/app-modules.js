// Shared helpers extracted from the main frontend bundle.
// Exposes a single namespace for shared utilities.

(function (global) {
  const escapeHtml = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const normalizeVisibleEscapes = (s) => (typeof s === "string" ? s.replace(/\r\n/g, "\n") : s);
  const textAsHtml = (s) => escapeHtml(normalizeVisibleEscapes(String(s || ""))).replace(/\n/g, "<br>");
  const listAsHtml = (items, ordered) => {
    const tag = ordered ? "ol" : "ul";
    return `<${tag}>${(items || []).map((x) => `<li>${escapeHtml(String(x || ""))}</li>`).join("")}</${tag}>`;
  };
  const listAsText = (items, ordered) => (items || []).map((x, i) => (ordered ? `${i + 1}. ${String(x || "")}` : `- ${String(x || "")}`)).join("\n");
  const cardHtml = (title, bodyHtml, scoreBadge) => {
    const badge = scoreBadge == null ? "" : `<span class="result-badge">${escapeHtml(String(scoreBadge))}</span>`;
    return `<section class="result-card"><h3>${escapeHtml(title)}${badge}</h3><div class="result-body">${bodyHtml}</div></section>`;
  };
  const prettyPrintForDisplay = (obj, depth = 0) => {
    const pad = "  ".repeat(depth);
    if (obj === null || obj === undefined) return String(obj);
    const t = typeof obj;
    if (t !== "object") return t === "string" ? normalizeVisibleEscapes(obj) : JSON.stringify(obj);
    if (Array.isArray(obj)) return obj.map((item, i) => `${pad}[${i}]\n${prettyPrintForDisplay(item, depth + 1)}`).join("\n");
    return Object.entries(obj).map(([k, v]) => {
      if (typeof v === "string") {
        const body = normalizeVisibleEscapes(v);
        return `${pad}${k}:\n${body.split("\n").map((line) => pad + "  " + line).join("\n")}`;
      }
      if (v !== null && typeof v === "object") return `${pad}${k}:\n${prettyPrintForDisplay(v, depth + 1)}`;
      return `${pad}${k}: ${JSON.stringify(v)}`;
    }).join("\n\n");
  };
  global.AppShared = { escapeHtml, normalizeVisibleEscapes, textAsHtml, listAsHtml, listAsText, cardHtml, prettyPrintForDisplay };
  global.escapeHtml = global.escapeHtml || escapeHtml;
  global.textAsHtml = global.textAsHtml || textAsHtml;
  global.listAsHtml = global.listAsHtml || listAsHtml;
  global.listAsText = global.listAsText || listAsText;
  global.cardHtml = global.cardHtml || cardHtml;
  global.prettyPrintForDisplay = global.prettyPrintForDisplay || prettyPrintForDisplay;
})(window);
