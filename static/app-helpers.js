function normalizeVisibleEscapes(s) {
  if (typeof s !== "string") return s;
  return s.replace(/\r\n/g, "\n");
}

function stripMarkdownFormatting(s) {
  const text = normalizeVisibleEscapes(String(s || ""));
  return text
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```/g, ""))
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/_(.*?)_/g, "$1")
    .replace(/^\s*[-*+]\s+/gm, "- ")
    .replace(/^\s*\d+\.\s+/gm, (m) => m.replace(/^\s*/, ""))
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/\s+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function textAsHtml(s) {
  return escapeHtml(stripMarkdownFormatting(String(s || ""))).replace(/\n/g, "<br>");
}

function listAsHtml(items, ordered) {
  const tag = ordered ? "ol" : "ul";
  return `<${tag}>${items.map((x) => `<li>${escapeHtml(stripMarkdownFormatting(String(x || "")))}</li>`).join("")}</${tag}>`;
}

function listAsText(items, ordered) {
  return (items || [])
    .map((x, i) => (ordered ? `${i + 1}. ${stripMarkdownFormatting(String(x || ""))}` : `- ${stripMarkdownFormatting(String(x || ""))}`))
    .join("\n");
}

function cardHtml(title, bodyHtml, scoreBadge) {
  const badge = scoreBadge == null ? "" : `<span class="result-badge">${escapeHtml(String(scoreBadge))}</span>`;
  const id = `card-${++resultCardSeq}`;
  return `<section class="result-card" data-card-id="${id}"><h3>${escapeHtml(title)}${badge}<span class="result-actions"><button type="button" class="result-action-btn" data-action="toggle">折叠</button><button type="button" class="result-action-btn" data-action="copy">复制</button></span></h3><div class="result-body">${bodyHtml}</div></section>`;
}

function prettyPrintForDisplay(obj, depth = 0) {
  const pad = "  ".repeat(depth);
  if (obj === null || obj === undefined) return String(obj);
  const t = typeof obj;
  if (t !== "object") return t === "string" ? normalizeVisibleEscapes(obj) : JSON.stringify(obj);
  if (Array.isArray(obj)) {
    return obj.map((item, i) => `${pad}[${i}]\n${prettyPrintForDisplay(item, depth + 1)}`).join("\n");
  }
  return Object.entries(obj)
    .map(([k, v]) => {
      if (typeof v === "string") {
        const body = normalizeVisibleEscapes(v);
        return `${pad}${k}:\n${body.split("\n").map((line) => pad + "  " + line).join("\n")}`;
      }
      if (v !== null && typeof v === "object") {
        return `${pad}${k}:\n${prettyPrintForDisplay(v, depth + 1)}`;
      }
      return `${pad}${k}: ${JSON.stringify(v)}`;
    })
    .join("\n\n");
}

function updateOnboardingBanner() {
  const banner = $("onboardingBanner");
  if (!banner) return;
  const resume = ($("resume") && $("resume").value.trim()) || "";
  const job = ($("job") && $("job").value.trim()) || "";
  const hasMulti = getMultiJobValues().length > 0;
  const memory = getMemoryState();
  const hasMemory = Boolean((memory.summary || "").trim() || (memory.stable_facts || []).length);
  const lines = [];
  if (!resume && !job) {
    lines.push("先从左侧选择一个模块；推荐顺序是：方向诊断 → 简历优化 → 面试训练。");
    lines.push("如果你还没有素材，可以先点“填入示例”快速体验整条流程。");
  } else if (resume && !job) {
    lines.push("简历已经有了，下一步建议先补目标岗位 JD，这样后续分析会更准确。");
    lines.push("也可以先做 ATS 检查，快速看结构和关键词缺口。");
  } else if (!resume && job) {
    lines.push("你已经有目标岗位了，先把简历补进来，再做匹配分析或润色。");
    lines.push("如果有多个岗位，可继续使用“多 JD 对比”。");
  } else {
    lines.push("简历和 JD 都已具备，现在适合先做“岗位匹配分析”或“职业方向与行动计划”。");
    lines.push("分析后可直接把建议加入“我的求职旅程”。");
  }
  if (hasMulti) lines.push("已检测到多个 JD，可以进入“多 JD 对比”看投递优先级。");
  if (hasMemory) lines.push("系统已经有你的画像记忆，后续建议会更贴近你的偏好与经历。");
  banner.innerHTML = `<div class="onboarding-banner__title">${escapeHtml(lines[0] || "")}</div>${lines[1] ? `<div class="onboarding-banner__body">${textAsHtml(lines.slice(1).join("\n"))}</div>` : ""}`;
}
