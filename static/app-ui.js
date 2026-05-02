function normalizeVisibleEscapes(s) {
  if (typeof s !== "string") return s;
  return s.replace(/\r\n/g, "\n");
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
  return escapeHtml(normalizeVisibleEscapes(String(s || ""))).replace(/\n/g, "<br>");
}

function listAsHtml(items, ordered) {
  const tag = ordered ? "ol" : "ul";
  return `<${tag}>${items.map((x) => `<li>${escapeHtml(String(x || ""))}</li>`).join("")}</${tag}>`;
}

function cardHtml(title, bodyHtml, scoreBadge) {
  const badge = scoreBadge == null ? "" : `<span class="result-badge">${escapeHtml(String(scoreBadge))}</span>`;
  const id = `card-${++resultCardSeq}`;
  return `<section class="result-card" data-card-id="${id}"><h3>${escapeHtml(title)}${badge}<span class="result-actions"><button type="button" class="result-action-btn" data-action="toggle">折叠</button><button type="button" class="result-action-btn" data-action="copy">复制</button></span></h3><div class="result-body">${bodyHtml}</div></section>`;
}

function listAsText(items, ordered) {
  return (items || [])
    .map((x, i) => (ordered ? `${i + 1}. ${String(x || "")}` : `- ${String(x || "")}`))
    .join("\n");
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
  const hasMulti = typeof getMultiJobValues === "function" && getMultiJobValues().length > 0;
  const memory = getMemoryState();
  const hasMemory = Boolean((memory.summary || "").trim() || (memory.stable_facts || []).length);
  const lines = [];
  if (!resume && !job) {
    lines.push("先完成模型配置和需求交流，再进入简历与岗位分析。");
    lines.push("如果你还没有素材，可以先从简历输入页或需求交流页开始。");
  } else if (resume && !job) {
    lines.push("简历已经准备好了，下一步建议补上目标岗位 JD，这样匹配分析会更准确。");
    lines.push("也可以先做一次 ATS 检查，快速看结构和关键词缺口。");
  } else if (!resume && job) {
    lines.push("你已经有目标岗位了，先把简历补进来，再做匹配分析或润色。");
    lines.push("如果有多个岗位，可继续使用多 JD 对比。");
  } else {
    lines.push("简历和 JD 都已具备，现在适合先做岗位匹配分析或职业方向与行动计划。");
    lines.push("分析后可以直接把建议加入求职旅程。");
  }
  if (hasMulti) lines.push("已检测到多个 JD，可以进入多 JD 对比查看投递优先级。");
  if (hasMemory) lines.push("系统已经有你的画像记忆，后续建议会更贴近你的偏好与经历。");
  banner.innerHTML = `<div class="onboarding-banner__title">${escapeHtml(lines[0] || "")}</div>${lines[1] ? `<div class="onboarding-banner__body">${textAsHtml(lines.slice(1).join("\n"))}</div>` : ""}`;
}
