const LS = {
  key: "rm_api_key",
  base: "rm_base_url",
  model: "rm_model",
  rememberKey: "rm_remember_key",
};
const SS = {
  key: "rm_api_key_session",
};
const DRAFT = {
  resume: "rm_draft_resume",
  job: "rm_draft_job",
  jobMulti: "rm_draft_job_multi",
};
const MULTI_JD_IDS = ["jobMulti1", "jobMulti2", "jobMulti3", "jobMulti4", "jobMulti5"];
const MIN_MULTI_JD_VISIBLE = 1;
const HISTORY_KEY = "rm_recent_runs_v1";
const HISTORY_LIMIT = 8;

function $(id) {
  return document.getElementById(id);
}

/** 导出 .docx 时的建议文件名（不含扩展名） */
let lastExportBasename = "resume-matcher-export";
let lastRenderedPlainText = "";
let activeController = null;
const REQUEST_TIMEOUT_MS = 120000;
let resultCardSeq = 0;
let draftSaveTimer = null;
let lastRequest = null;
let lastTailorSourceResume = "";
let lastRunLabel = "";
const DEMO_RESUME = `张三
电话：138-0000-0000  邮箱：zhangsan@example.com

## 个人简介
3 年数据分析与增长运营经验，擅长 SQL、Python、A/B 测试与可视化，支持业务决策与转化提升。

## 工作经历
2023.03 - 至今  某互联网公司  数据分析师
- 搭建核心漏斗看板，统一口径后周会对齐效率提升约 30%。
- 主导注册流程优化实验，首周转化率提升 12.4%。
- 与产品/运营协作优化召回策略，月留存提升 4.1%。

2021.07 - 2023.02  某电商平台  运营分析
- 负责活动复盘与人群分层策略，推动复购率提升 8%。
- 建立日报自动化流程，手工报表时间从 2 小时降至 15 分钟。

## 技能
Python, SQL, Tableau, Excel, A/B Testing, FastAPI`;

const DEMO_JOB = `岗位：数据分析师（增长方向）

职责：
1. 负责用户增长相关指标体系搭建与监控；
2. 通过 SQL/Python 进行数据提取分析，输出可执行建议；
3. 与产品、运营、研发协作，推动增长实验落地；
4. 建立可视化看板，跟踪核心漏斗和留存指标。

要求：
- 2 年以上数据分析经验；
- 熟悉 SQL、Python，具备 A/B 测试经验；
- 具备业务理解和跨团队沟通能力；
- 加分项：有电商/互联网增长经验。`;

const DEMO_MULTI_JD = `岗位A：增长数据分析师
要求：SQL、Python、A/B 测试、漏斗分析、看板建设、跨团队协作。
---
岗位B：商业分析师
要求：数据建模、业务洞察、可视化汇报、策略评估、ROI 分析。
---
岗位C：用户运营分析师
要求：用户分层、留存分析、活动复盘、实验设计、沟通推进。`;

function loadSettings() {
  const rememberKey = localStorage.getItem(LS.rememberKey) === "1";
  const apiKey = rememberKey
    ? localStorage.getItem(LS.key) || ""
    : sessionStorage.getItem(SS.key) || "";
  const baseUrl = localStorage.getItem(LS.base) || "https://api.openai.com/v1";
  const model = localStorage.getItem(LS.model) || "gpt-4o-mini";
  if ($("apiKey")) $("apiKey").value = apiKey;
  if ($("baseUrl")) $("baseUrl").value = baseUrl;
  if ($("modelName")) $("modelName").value = model;
  if ($("rememberKey")) $("rememberKey").checked = rememberKey;
}

function saveSettings() {
  const apiKey = ($("apiKey") && $("apiKey").value.trim()) || "";
  const baseUrl = ($("baseUrl") && $("baseUrl").value.trim()) || "https://api.openai.com/v1";
  const model = ($("modelName") && $("modelName").value.trim()) || "gpt-4o-mini";
  let parsedBase;
  try {
    parsedBase = new URL(baseUrl);
  } catch {
    setStatus("Base URL 格式不正确，请填写完整的 http(s) 地址。", true);
    return false;
  }
  if (!/^https?:$/.test(parsedBase.protocol)) {
    setStatus("Base URL 必须是 http 或 https。", true);
    return false;
  }
  if (!model || model.length < 2) {
    setStatus("模型名太短，请至少输入 2 个字符。", true);
    return false;
  }
  const rememberKey = Boolean($("rememberKey") && $("rememberKey").checked);
  localStorage.setItem(LS.rememberKey, rememberKey ? "1" : "0");
  if (rememberKey) {
    if (apiKey) localStorage.setItem(LS.key, apiKey);
    else localStorage.removeItem(LS.key);
    sessionStorage.removeItem(SS.key);
  } else {
    localStorage.removeItem(LS.key);
    if (apiKey) sessionStorage.setItem(SS.key, apiKey);
    else sessionStorage.removeItem(SS.key);
  }
  localStorage.setItem(LS.base, baseUrl);
  localStorage.setItem(LS.model, model);
  return true;
}

function llmPayload() {
  const rememberKey = localStorage.getItem(LS.rememberKey) === "1";
  const api_key = rememberKey
    ? localStorage.getItem(LS.key) || null
    : sessionStorage.getItem(SS.key) || null;
  const base_url = localStorage.getItem(LS.base) || null;
  const model = localStorage.getItem(LS.model) || null;
  const o = {};
  if (api_key) o.api_key = api_key;
  if (base_url) o.base_url = base_url;
  if (model) o.model = model;
  return Object.keys(o).length ? { llm: o } : {};
}

function setStatus(msg, isError) {
  const el = $("status");
  const errEl = $("statusError");
  if (el) {
    el.textContent = isError ? "" : msg || "";
    el.classList.remove("error");
  }
  if (errEl) errEl.textContent = isError ? msg || "" : "";
}

function friendlyErrorMessage(err) {
  const raw = String((err && err.message) || err || "");
  const lower = raw.toLowerCase();
  if (lower.includes("timeout") || raw.includes("超时")) {
    return "请求超时：建议重试，或换更快模型并减少输入长度。";
  }
  if (raw.includes("无法连接模型服务") || lower.includes("failed to fetch")) {
    return "网络连接失败：请检查 Base URL、网络和模型服务可用性后重试。";
  }
  if (raw.includes("API Key") || raw.includes("401") || raw.includes("403")) {
    return "鉴权失败：请检查 API Key、Base URL 与模型名称配置。";
  }
  return raw || "请求失败，请稍后重试。";
}

/** 统一换行符（不误替换正文里的反斜杠序列如 \\LaTeX） */
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

function nowLabel() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function getMultiJobValues() {
  return MULTI_JD_IDS.map((id) => (($(id) && $(id).value) || "").trim()).filter(Boolean);
}

function getVisibleMultiJDCount() {
  return MULTI_JD_IDS.filter((id) => $(id) && !$(id).hasAttribute("hidden")).length;
}

function ensureVisibleMultiJobCount(count) {
  const target = Math.max(MIN_MULTI_JD_VISIBLE, Math.min(MULTI_JD_IDS.length, count));
  MULTI_JD_IDS.forEach((id, idx) => {
    const el = $(id);
    if (!el) return;
    if (idx < target) el.removeAttribute("hidden");
    else el.setAttribute("hidden", "");
  });
  const addBtn = $("btnAddJD");
  if (addBtn) addBtn.disabled = target >= MULTI_JD_IDS.length;
}

function addMultiJDInput() {
  const current = getVisibleMultiJDCount();
  if (current >= MULTI_JD_IDS.length) {
    setStatus("最多可添加 5 个 JD。");
    return;
  }
  ensureVisibleMultiJobCount(current + 1);
  const next = $(MULTI_JD_IDS[current]);
  if (next) next.focus();
  setStatus(`已新增 JD #${current + 1} 输入框。`);
}

function collapseEmptyMultiJD() {
  let visible = MIN_MULTI_JD_VISIBLE;
  for (let i = MULTI_JD_IDS.length - 1; i >= 0; i -= 1) {
    const id = MULTI_JD_IDS[i];
    const value = (($(id) && $(id).value) || "").trim();
    if (value) {
      visible = Math.max(MIN_MULTI_JD_VISIBLE, i + 1);
      break;
    }
  }
  ensureVisibleMultiJobCount(visible);
  saveDraft(false);
  setStatus("已收起空白 JD 输入框。");
}

function serializeMultiJobs(values) {
  return (values || []).filter(Boolean).join("\n---\n");
}

function applyMultiJobsFromSerialized(raw) {
  const parts = String(raw || "")
    .split(/\n---+\n/g)
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, MULTI_JD_IDS.length);
  ensureVisibleMultiJobCount(Math.max(MIN_MULTI_JD_VISIBLE, parts.length));
  MULTI_JD_IDS.forEach((id, idx) => {
    if ($(id)) $(id).value = parts[idx] || "";
  });
}

function listAsText(items, ordered) {
  return items
    .map((x, i) => (ordered ? `${i + 1}. ${String(x || "")}` : `- ${String(x || "")}`))
    .join("\n");
}

function formatModelPlainText(obj) {
  if (obj == null) return "";
  if (typeof obj !== "object") return String(obj);
  if (typeof obj.tailored_resume === "string") {
    const parts = ["【润色后的简历】", normalizeVisibleEscapes(String(obj.tailored_resume || ""))];
    if (obj.changes_summary) parts.push("", "【改动摘要】", normalizeVisibleEscapes(String(obj.changes_summary)));
    if (Array.isArray(obj.evidence_changes) && obj.evidence_changes.length) {
      parts.push("", "【证据链改写】");
      obj.evidence_changes.forEach((x, i) => {
        parts.push(
          `${i + 1}. (${String(x.risk_level || "unknown")})`,
          `原句：${normalizeVisibleEscapes(String(x.original_snippet || ""))}`,
          `建议：${normalizeVisibleEscapes(String(x.suggested_snippet || ""))}`,
          `理由：${normalizeVisibleEscapes(String(x.reason || ""))}`,
          "",
        );
      });
    }
    return parts.join("\n").trim();
  }
  if (typeof obj.cover_letter === "string") return normalizeVisibleEscapes(String(obj.cover_letter || "")).trim();
  if (Array.isArray(obj.questions) && Array.isArray(obj.prep_plan_24h)) {
    const parts = ["【面试模拟】"];
    obj.questions.forEach((q, i) => {
      parts.push(
        "",
        `Q${i + 1} [${String(q.category || "general")}]`,
        `问题：${String(q.question || "")}`,
        `意图：${String(q.intent || "")}`,
      );
      if (Array.isArray(q.answer_framework) && q.answer_framework.length) {
        parts.push("回答框架：", listAsText(q.answer_framework, true));
      }
      if (Array.isArray(q.follow_ups) && q.follow_ups.length) {
        parts.push("追问：", listAsText(q.follow_ups, false));
      }
    });
    if (Array.isArray(obj.weakness_alerts) && obj.weakness_alerts.length) {
      parts.push("", "【薄弱点预警】", listAsText(obj.weakness_alerts, false));
    }
    if (Array.isArray(obj.prep_plan_24h) && obj.prep_plan_24h.length) {
      parts.push("", "【24小时准备计划】", listAsText(obj.prep_plan_24h, true));
    }
    return parts.join("\n").trim();
  }
  if (Array.isArray(obj.jobs) && Array.isArray(obj.recommended_apply_order)) {
    const parts = ["【多 JD 对比】"];
    obj.jobs.forEach((j, i) => {
      parts.push("", `JD #${i + 1}：${j.match_score ?? "-"}/100`, `总结：${String(j.summary || "")}`);
      if (Array.isArray(j.top_missing_keywords) && j.top_missing_keywords.length) {
        parts.push(`补齐关键词：${j.top_missing_keywords.join("、")}`);
      }
    });
    if (Array.isArray(obj.common_keywords) && obj.common_keywords.length) parts.push("", `共性关键词：${obj.common_keywords.join("、")}`);
    if (Array.isArray(obj.recommended_apply_order) && obj.recommended_apply_order.length) {
      parts.push(`建议投递顺序：${obj.recommended_apply_order.join(" -> ")}`);
    }
    return parts.join("\n").trim();
  }
  if (Array.isArray(obj.rules) && Array.isArray(obj.quick_wins)) {
    const parts = ["【ATS 规则检查】"];
    obj.rules.forEach((r, i) => {
      parts.push(
        "",
        `${i + 1}. [${String(r.level || "").toUpperCase()}] ${String(r.rule || "")}`,
        `说明：${String(r.message || "")}`,
        `修复建议：${String(r.fix || "")}`,
      );
    });
    if (obj.quick_wins.length) parts.push("", "【快速修复清单】", listAsText(obj.quick_wins, false));
    return parts.join("\n").trim();
  }
  if ("match_score" in obj || "summary" in obj || Array.isArray(obj.matched_keywords) || Array.isArray(obj.suggestions)) {
    const parts = [];
    if (obj.match_score != null) parts.push(`匹配度：${obj.match_score} / 100`);
    if (obj.summary) parts.push("", "【总结】", String(obj.summary));
    if (Array.isArray(obj.matched_keywords) && obj.matched_keywords.length) {
      parts.push("", "【已覆盖关键词】", listAsText(obj.matched_keywords, false));
    }
    if (Array.isArray(obj.missing_keywords) && obj.missing_keywords.length) {
      parts.push("", "【待补关键词】", listAsText(obj.missing_keywords, false));
    }
    if (Array.isArray(obj.suggestions) && obj.suggestions.length) {
      parts.push("", "【改进建议】", listAsText(obj.suggestions, true));
    }
    return parts.join("\n").trim();
  }
  return prettyPrintForDisplay(obj);
}

function renderAnalyzeHtml(data) {
  const cards = [];
  if (data.match_score != null || data.summary) {
    const scoreText = data.match_score != null ? `${data.match_score} / 100` : null;
    cards.push(cardHtml("总览", `<p>${textAsHtml(data.summary || "暂无总结。")}</p>`, scoreText));
  }
  if (data.score_breakdown && typeof data.score_breakdown === "object") {
    const labels = {
      hard_skill_score: "硬技能匹配",
      experience_score: "经历相关性",
      achievement_score: "量化成果",
      keyword_score: "关键词覆盖",
    };
    const inner = Object.entries(labels)
      .map(([key, label]) => {
        const item = data.score_breakdown[key];
        if (!item) return "";
        const reasons = Array.isArray(item.reasons) && item.reasons.length ? listAsHtml(item.reasons, false) : "<p>无</p>";
        const actions = Array.isArray(item.actions) && item.actions.length ? listAsHtml(item.actions, false) : "<p>无</p>";
        return `<article class="result-subcard"><h4>${escapeHtml(label)}：${escapeHtml(String(item.score ?? "-"))} / 100</h4><p class="result-label">扣分原因</p>${reasons}<p class="result-label">建议动作</p>${actions}</article>`;
      })
      .join("");
    cards.push(cardHtml("评分拆解", `<div class="result-grid">${inner}</div>`));
  }
  if (Array.isArray(data.matched_keywords) && data.matched_keywords.length) {
    cards.push(cardHtml("已覆盖关键词", listAsHtml(data.matched_keywords, false)));
  }
  if (Array.isArray(data.missing_keywords) && data.missing_keywords.length) {
    cards.push(cardHtml("待补关键词", listAsHtml(data.missing_keywords, false)));
  }
  if (Array.isArray(data.suggestions) && data.suggestions.length) {
    cards.push(cardHtml("改进建议", listAsHtml(data.suggestions, true)));
  }
  return `<div class="result-cards">${cards.join("")}</div>`;
}

function renderTailorHtml(data) {
  const cards = [];
  cards.push(cardHtml("润色后的简历", `<p>${textAsHtml(data.tailored_resume || "")}</p>`));
  if (data.changes_summary != null && String(data.changes_summary).trim()) {
    cards.push(cardHtml("改动摘要", `<p>${textAsHtml(data.changes_summary)}</p>`));
  }
  if (Array.isArray(data.evidence_changes) && data.evidence_changes.length) {
    const body = data.evidence_changes
      .map((x, i) => {
        const risk = x.risk_level ? `<span class="result-risk">${escapeHtml(String(x.risk_level))}</span>` : "";
        return `<article class="result-subcard"><h4>#${i + 1} ${risk}</h4><p><strong>原句：</strong>${textAsHtml(x.original_snippet || "")}</p><p><strong>建议：</strong>${textAsHtml(x.suggested_snippet || "")}</p><p><strong>理由：</strong>${textAsHtml(x.reason || "")}</p></article>`;
      })
      .join("");
    cards.push(cardHtml("证据链改写", `<div class="result-grid">${body}</div>`));
  }
  return `<div class="result-cards">${cards.join("")}</div>`;
}

function renderAnalyzeMultiHtml(data) {
  const items = Array.isArray(data.jobs) ? data.jobs : [];
  const jobCards = items
    .map((item, idx) => {
      const missing = Array.isArray(item.top_missing_keywords) && item.top_missing_keywords.length
        ? listAsHtml(item.top_missing_keywords, false)
        : "<p>无</p>";
      const actions = Array.isArray(item.rewrite_actions) && item.rewrite_actions.length
        ? `<p class="result-label">最小改写动作</p>${listAsHtml(item.rewrite_actions, true)}`
        : "";
      return `<article class="result-subcard"><h4>JD #${idx + 1}：${escapeHtml(String(item.match_score ?? "-"))} / 100</h4><p>${textAsHtml(item.summary || "")}</p><p class="result-label">优先补齐关键词</p>${missing}${actions}</article>`;
    })
    .join("");
  const cards = [cardHtml("多 JD 对比", `<div class="result-grid">${jobCards}</div>`)];
  if (Array.isArray(data.common_keywords) && data.common_keywords.length) {
    cards.push(cardHtml("共性关键词", listAsHtml(data.common_keywords, false)));
  }
  if (Array.isArray(data.recommended_apply_order) && data.recommended_apply_order.length) {
    cards.push(cardHtml("建议投递顺序", `<p>${escapeHtml(data.recommended_apply_order.join(" -> "))}</p>`));
  }
  if (data.strategy) cards.push(cardHtml("投递策略", `<p>${textAsHtml(data.strategy)}</p>`));
  return `<div class="result-cards">${cards.join("")}</div>`;
}

function renderAtsCheckHtml(data) {
  const ruleCards = (Array.isArray(data.rules) ? data.rules : [])
    .map((r, i) => {
      return `<article class="result-subcard"><h4>#${i + 1} [${escapeHtml(String(r.level || "").toUpperCase())}] ${escapeHtml(String(r.rule || ""))}</h4><p><strong>说明：</strong>${textAsHtml(r.message || "")}</p><p><strong>修复建议：</strong>${textAsHtml(r.fix || "")}</p></article>`;
    })
    .join("");
  const cards = [cardHtml("ATS 规则检查", `<div class="result-grid">${ruleCards}</div>`)];
  if (Array.isArray(data.quick_wins) && data.quick_wins.length) {
    cards.push(cardHtml("快速修复清单", listAsHtml(data.quick_wins, false)));
  }
  return `<div class="result-cards">${cards.join("")}</div>`;
}

function renderCoverHtml(data) {
  return `<div class="result-cards">${cardHtml("求职信", `<p>${textAsHtml(data.cover_letter || "")}</p>`)}</div>`;
}

function renderInterviewSimHtml(data) {
  const qs = Array.isArray(data.questions) ? data.questions : [];
  const qCards = qs
    .map((q, i) => {
      const frame = Array.isArray(q.answer_framework) && q.answer_framework.length
        ? listAsHtml(q.answer_framework, true)
        : "<p>无</p>";
      const follow = Array.isArray(q.follow_ups) && q.follow_ups.length ? listAsHtml(q.follow_ups, false) : "<p>无</p>";
      return `<article class="result-subcard"><h4>Q${i + 1} [${escapeHtml(String(q.category || "general"))}]</h4><p><strong>问题：</strong>${textAsHtml(q.question || "")}</p><p><strong>考察意图：</strong>${textAsHtml(q.intent || "")}</p><p class="result-label">回答框架</p>${frame}<p class="result-label">可能追问</p>${follow}</article>`;
    })
    .join("");
  const cards = [cardHtml("面试模拟题", `<div class="result-grid">${qCards}</div>`)];
  if (Array.isArray(data.weakness_alerts) && data.weakness_alerts.length) {
    cards.push(cardHtml("薄弱点预警", listAsHtml(data.weakness_alerts, false)));
  }
  if (Array.isArray(data.prep_plan_24h) && data.prep_plan_24h.length) {
    cards.push(cardHtml("24 小时准备计划", listAsHtml(data.prep_plan_24h, true)));
  }
  return `<div class="result-cards">${cards.join("")}</div>`;
}

/** 不把长文本字段交给 JSON.stringify，避免换行被显示成 \\n */
function prettyPrintForDisplay(obj, depth = 0) {
  const pad = "  ".repeat(depth);
  if (obj === null || obj === undefined) return String(obj);
  const t = typeof obj;
  if (t !== "object") return t === "string" ? normalizeVisibleEscapes(obj) : JSON.stringify(obj);
  if (Array.isArray(obj)) {
    return obj
      .map((item, i) => {
        const block = prettyPrintForDisplay(item, depth + 1);
        return `${pad}[${i}]\n${block}`;
      })
      .join("\n");
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

function formatModelResult(obj) {
  if (obj == null) return "";
  if (typeof obj !== "object") return String(obj);
  if (typeof obj.tailored_resume === "string") return renderTailorHtml(obj);
  if (typeof obj.cover_letter === "string") return renderCoverHtml(obj);
  if (Array.isArray(obj.questions) && Array.isArray(obj.prep_plan_24h)) return renderInterviewSimHtml(obj);
  if (Array.isArray(obj.jobs) && Array.isArray(obj.recommended_apply_order)) return renderAnalyzeMultiHtml(obj);
  if (Array.isArray(obj.rules) && Array.isArray(obj.quick_wins)) return renderAtsCheckHtml(obj);
  if (
    "match_score" in obj ||
    "summary" in obj ||
    Array.isArray(obj.matched_keywords) ||
    Array.isArray(obj.suggestions)
  ) {
    return renderAnalyzeHtml(obj);
  }
  return `<div class="result-cards">${cardHtml("原始结果", `<p>${textAsHtml(prettyPrintForDisplay(obj))}</p>`)}</div>`;
}

function setOutput(obj) {
  const out = $("output");
  if (!out) return;
  resultCardSeq = 0;
  if (typeof obj === "string") {
    out.innerHTML = `<div class="result-cards">${cardHtml("结果", `<p>${textAsHtml(obj)}</p>`)}</div>`;
    lastRenderedPlainText = normalizeVisibleEscapes(String(obj || "")).trim();
    lastExportBasename = "resume-matcher-export";
    return;
  }
  if (typeof obj.tailored_resume === "string") {
    lastExportBasename = "润色简历";
  } else if (typeof obj.cover_letter === "string") {
    lastExportBasename = "求职信";
  } else if (
    "match_score" in obj ||
    "summary" in obj ||
    Array.isArray(obj.matched_keywords) ||
    Array.isArray(obj.suggestions)
  ) {
    lastExportBasename = "匹配分析";
  } else {
    lastExportBasename = "resume-matcher-export";
  }
  out.innerHTML = formatModelResult(obj);
  lastRenderedPlainText = formatModelPlainText(obj);
}

function getHistory() {
  try {
    const arr = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveHistoryItem(item) {
  const prev = getHistory();
  const next = [item, ...prev].slice(0, HISTORY_LIMIT);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  renderHistory();
}

function renderHistory() {
  const el = $("historyList");
  if (!el) return;
  const items = getHistory();
  if (!items.length) {
    el.textContent = "暂无记录。完成一次分析后会自动保存最近结果。";
    return;
  }
  el.innerHTML = items
    .map((x, i) => {
      const score = x.score == null ? "-" : `${x.score}/100`;
      return `<article class="history-item">
        <div class="history-item-head">
          <div class="history-title">${escapeHtml(x.label || "任务记录")}</div>
          <div class="history-meta">${escapeHtml(x.time || "")} · 匹配分 ${escapeHtml(score)}</div>
        </div>
        <div class="history-meta">${escapeHtml((x.summary || "").slice(0, 140) || "无摘要")}</div>
        <div class="history-actions">
          <button type="button" class="result-action-btn" data-history-action="restore" data-idx="${i}">回填输入</button>
          <button type="button" class="result-action-btn" data-history-action="rerun" data-idx="${i}">回填并重跑</button>
        </div>
      </article>`;
    })
    .join("");
}

function clearHistory() {
  localStorage.removeItem(HISTORY_KEY);
  renderHistory();
  setStatus("最近记录已清空。");
}

function historySummary(data) {
  if (!data || typeof data !== "object") return "";
  if (typeof data.summary === "string") return data.summary;
  if (typeof data.cover_letter === "string") return data.cover_letter.slice(0, 120);
  if (typeof data.tailored_resume === "string") return data.tailored_resume.slice(0, 120);
  if (Array.isArray(data.questions) && data.questions.length) return `面试模拟，共 ${data.questions.length} 道题。`;
  if (Array.isArray(data.jobs) && data.jobs.length) return `多 JD 对比，共 ${data.jobs.length} 个岗位。`;
  if (Array.isArray(data.rules) && data.rules.length) return `ATS 检查，共 ${data.rules.length} 条规则。`;
  return "已生成结果。";
}

function bindHistoryActions() {
  const el = $("historyList");
  if (!el) return;
  el.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-history-action]");
    if (!btn) return;
    const idx = Number(btn.getAttribute("data-idx"));
    const items = getHistory();
    const item = items[idx];
    if (!item) return;
    if ($("resume")) $("resume").value = item.resume || "";
    if ($("job")) $("job").value = item.job || "";
    applyMultiJobsFromSerialized(item.jobMulti || "");
    saveDraft(false);
    const action = btn.getAttribute("data-history-action");
    setStatus("已回填历史输入。");
    if (action === "rerun") {
      if (item.runType === "analyze_multi") await runAnalyzeMulti();
      else if (item.runType === "ats_check") await runAtsCheck();
      else if (item.runType === "tailor") await runTailor();
      else if (item.runType === "cover") await runCover();
      else if (item.runType === "interview_sim") await runInterviewSim();
      else await runAnalyze();
    }
  });
}

async function copyText(text) {
  if (!text) return false;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }
  return false;
}

function bindResultCardActions() {
  const out = $("output");
  if (!out) return;
  out.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const card = btn.closest(".result-card");
    if (!card) return;
    const action = btn.getAttribute("data-action");
    if (action === "toggle") {
      card.classList.toggle("is-collapsed");
      btn.textContent = card.classList.contains("is-collapsed") ? "展开" : "折叠";
      return;
    }
    if (action === "copy") {
      const text = (card.querySelector(".result-body")?.innerText || "").trim();
      try {
        const ok = await copyText(text);
        setStatus(ok ? "已复制当前卡片内容。" : "当前环境不支持剪贴板复制。", !ok);
      } catch {
        setStatus("复制失败，请手动复制。", true);
      }
    }
  });
}

function fillDemoData() {
  if ($("resume")) $("resume").value = DEMO_RESUME;
  if ($("job")) $("job").value = DEMO_JOB;
  applyMultiJobsFromSerialized(DEMO_MULTI_JD);
  setStatus("已填入演示数据，可直接体验匹配分析/多 JD 对比/ATS 检查。");
}

function clearDemoData() {
  if ($("resume")) $("resume").value = "";
  if ($("job")) $("job").value = "";
  MULTI_JD_IDS.forEach((id) => {
    if ($(id)) $(id).value = "";
  });
  ensureVisibleMultiJobCount(MIN_MULTI_JD_VISIBLE);
  setOutput("结果将显示在这里…");
  setStatus("已清空演示数据。");
}

function saveDraft(showStatus) {
  const resume = ($("resume") && $("resume").value) || "";
  const job = ($("job") && $("job").value) || "";
  const jobMulti = serializeMultiJobs(getMultiJobValues());
  localStorage.setItem(DRAFT.resume, resume);
  localStorage.setItem(DRAFT.job, job);
  localStorage.setItem(DRAFT.jobMulti, jobMulti);
  if (showStatus) setStatus("草稿已保存到本地浏览器。");
}

function loadDraft() {
  const resume = localStorage.getItem(DRAFT.resume) || "";
  const job = localStorage.getItem(DRAFT.job) || "";
  const jobMulti = localStorage.getItem(DRAFT.jobMulti) || "";
  if ($("resume")) $("resume").value = resume;
  if ($("job")) $("job").value = job;
  applyMultiJobsFromSerialized(jobMulti);
  if (resume || job || jobMulti) {
    setStatus("已恢复上次草稿。");
  }
}

function clearDraft() {
  localStorage.removeItem(DRAFT.resume);
  localStorage.removeItem(DRAFT.job);
  localStorage.removeItem(DRAFT.jobMulti);
  setStatus("本地草稿已清空。");
}

function scheduleDraftSave() {
  if (draftSaveTimer) clearTimeout(draftSaveTimer);
  draftSaveTimer = setTimeout(() => saveDraft(false), 600);
}

function setLoading(loading) {
  ["btnAnalyze", "btnAnalyzeMulti", "btnTailor", "btnCover", "btnInterviewSim", "btnAtsCheck", "btnRetryLast", "btnCompareImprove"].forEach((id) => {
    const b = $(id);
    if (b) b.disabled = loading;
  });
  const cancelBtn = $("btnCancel");
  if (cancelBtn) {
    if (loading) cancelBtn.removeAttribute("hidden");
    else cancelBtn.setAttribute("hidden", "");
  }
}

function fetchWithTimeout(path, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  if (activeController) activeController.abort();
  const controller = new AbortController();
  activeController = controller;
  const timer = setTimeout(() => controller.abort("timeout"), timeoutMs);
  return fetch(path, { ...options, signal: controller.signal })
    .finally(() => {
      clearTimeout(timer);
      if (activeController === controller) activeController = null;
    });
}

function cancelActiveTask() {
  if (!activeController) {
    setStatus("当前没有进行中的任务。");
    return;
  }
  activeController.abort("user_cancel");
  setStatus("已取消当前任务。");
}

async function uploadExtractToTextarea(fileInput, textareaId) {
  const file = fileInput.files && fileInput.files[0];
  if (!file) return;
  const ta = $(textareaId);
  if (!ta) return;
  setStatus(`正在解析「${file.name}」…`);
  fileInput.disabled = true;
  setLoading(true);
  const fd = new FormData();
  fd.append("file", file, file.name);
  try {
    const res = await fetchWithTimeout("/api/v1/extract-text", { method: "POST", body: fd }, 60000);
    const raw = await res.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error(raw || `HTTP ${res.status}`);
    }
    if (!res.ok) {
      const d = data.detail || data.message || raw;
      throw new Error(typeof d === "string" ? d : JSON.stringify(d));
    }
    ta.value = data.text || "";
    setStatus(`已从「${data.filename || file.name}」提取文本，可继续编辑。`);
  } catch (e) {
    if (e && e.name === "AbortError") {
      setStatus("解析请求已取消或超时。", true);
    } else {
      setStatus(friendlyErrorMessage(e), true);
    }
  } finally {
    fileInput.value = "";
    fileInput.disabled = false;
    setLoading(false);
  }
}

async function postJson(path, body) {
  const res = await fetchWithTimeout(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(text || `HTTP ${res.status}`);
  }
  if (!res.ok) {
    const detail = data.detail || data.message || text;
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  return data;
}

function validateInputs(resume, job) {
  if (resume.length < 20 && job.length < 20) {
    setStatus("简历和岗位描述都至少需要 20 字。", true);
    return false;
  }
  if (resume.length < 20) {
    setStatus("简历内容不足 20 字，请补充后再试。", true);
    return false;
  }
  if (job.length < 20) {
    setStatus("岗位描述不足 20 字，请补充后再试。", true);
    return false;
  }
  return true;
}

async function runTask(options) {
  const resume = ($("resume") && $("resume").value.trim()) || "";
  const job = ($("job") && $("job").value.trim()) || "";
  if (!validateInputs(resume, job)) return;
  setLoading(true);
  setStatus(options.pendingText);
  try {
    const payload = {
      resume,
      job_description: job,
      ...(options.extra || {}),
      ...llmPayload(),
    };
    lastRequest = { type: "task", options };
    const r = await postJson(options.path, payload);
    const data = r.data || r;
    setOutput(data);
    const runType =
      options.path === "/api/v1/tailor"
        ? "tailor"
        : options.path === "/api/v1/cover-letter"
          ? "cover"
          : "analyze";
    saveHistoryItem({
      label: lastRunLabel || options.pendingText || "任务",
      runType,
      time: nowLabel(),
      score: data && typeof data === "object" ? data.match_score ?? null : null,
      summary: historySummary(data),
      resume,
      job,
      jobMulti: serializeMultiJobs(getMultiJobValues()),
    });
    setStatus("完成。");
  } catch (e) {
    if (e && e.name === "AbortError") {
      setStatus("请求已取消或超时，请重试。", true);
    } else {
      setStatus(friendlyErrorMessage(e), true);
    }
  } finally {
    setLoading(false);
  }
}

async function runAnalyze() {
  lastRunLabel = "匹配分析";
  await runTask({
    path: "/api/v1/analyze",
    pendingText: "正在调用模型分析匹配度…",
  });
}

async function runAnalyzeMulti() {
  lastRunLabel = "多 JD 对比";
  const resume = ($("resume") && $("resume").value.trim()) || "";
  const jobs = getMultiJobValues();
  if (resume.length < 20) {
    setStatus("简历内容不足 20 字，请补充后再试。", true);
    return;
  }
  if (jobs.length < 1) {
    setStatus("请至少填写 1 个 JD。", true);
    return;
  }
  if (jobs.length > 5) {
    setStatus("多 JD 对比最多支持 5 个 JD。", true);
    return;
  }
  setLoading(true);
  setStatus("正在执行多 JD 对比…");
  try {
    lastRequest = { type: "analyze_multi" };
    const r = await postJson("/api/v1/analyze-multi", { resume, jobs, ...llmPayload() });
    const data = r.data || r;
    setOutput(data);
    saveHistoryItem({
      label: "多 JD 对比",
      runType: "analyze_multi",
      time: nowLabel(),
      score: null,
      summary: historySummary(data),
      resume,
      job: ($("job") && $("job").value.trim()) || "",
      jobMulti: serializeMultiJobs(jobs),
    });
    setStatus("完成。");
  } catch (e) {
    if (e && e.name === "AbortError") setStatus("请求已取消或超时，请重试。", true);
    else setStatus(friendlyErrorMessage(e), true);
  } finally {
    setLoading(false);
  }
}

async function runAtsCheck() {
  lastRunLabel = "ATS 检查";
  const resume = ($("resume") && $("resume").value.trim()) || "";
  const job = ($("job") && $("job").value.trim()) || "";
  if (!validateInputs(resume, job)) return;
  setLoading(true);
  setStatus("正在执行 ATS 规则检查…");
  try {
    lastRequest = { type: "ats_check" };
    const r = await postJson("/api/v1/ats-check", { resume, job_description: job });
    const data = r.data || r;
    setOutput(data);
    saveHistoryItem({
      label: "ATS 检查",
      runType: "ats_check",
      time: nowLabel(),
      score: null,
      summary: historySummary(data),
      resume,
      job,
      jobMulti: serializeMultiJobs(getMultiJobValues()),
    });
    setStatus("完成。");
  } catch (e) {
    if (e && e.name === "AbortError") setStatus("请求已取消或超时，请重试。", true);
    else setStatus(friendlyErrorMessage(e), true);
  } finally {
    setLoading(false);
  }
}

async function runTailor() {
  lastRunLabel = "简历润色";
  lastTailorSourceResume = ($("resume") && $("resume").value.trim()) || "";
  await runTask({
    path: "/api/v1/tailor",
    pendingText: "正在生成针对 JD 的润色简历…",
  });
}

async function runCover() {
  lastRunLabel = "求职信";
  await runTask({
    path: "/api/v1/cover-letter",
    pendingText: "正在生成求职信…",
    extra: { language: "zh-CN" },
  });
}

async function runInterviewSim() {
  const resume = ($("resume") && $("resume").value.trim()) || "";
  const job = ($("job") && $("job").value.trim()) || "";
  if (!validateInputs(resume, job)) return;
  setLoading(true);
  setStatus("正在生成面试模拟题…");
  try {
    lastRequest = { type: "interview_sim" };
    const r = await postJson("/api/v1/interview-simulate", {
      resume,
      job_description: job,
      question_count: 8,
      focus: "mixed",
      ...llmPayload(),
    });
    const data = r.data || r;
    setOutput(data);
    saveHistoryItem({
      label: "面试模拟",
      runType: "interview_sim",
      time: nowLabel(),
      score: null,
      summary: historySummary(data),
      resume,
      job,
      jobMulti: serializeMultiJobs(getMultiJobValues()),
    });
    setStatus("完成。");
  } catch (e) {
    if (e && e.name === "AbortError") setStatus("请求已取消或超时，请重试。", true);
    else setStatus(friendlyErrorMessage(e), true);
  } finally {
    setLoading(false);
  }
}

async function retryLastTask() {
  if (!lastRequest) {
    setStatus("暂无可重试任务，请先执行一次分析。", true);
    return;
  }
  if (lastRequest.type === "task") {
    await runTask(lastRequest.options);
    return;
  }
  if (lastRequest.type === "analyze_multi") {
    await runAnalyzeMulti();
    return;
  }
  if (lastRequest.type === "ats_check") {
    await runAtsCheck();
    return;
  }
  if (lastRequest.type === "interview_sim") {
    await runInterviewSim();
  }
}

async function compareImprovement() {
  const outText = lastRenderedPlainText || "";
  const beforeResume = lastTailorSourceResume || (($("resume") && $("resume").value.trim()) || "");
  const afterResume = outText.includes("【润色后的简历】")
    ? outText.replace("【润色后的简历】", "").split("【改动摘要】")[0].trim()
    : "";
  const job = ($("job") && $("job").value.trim()) || "";
  if (!beforeResume || !afterResume || !job) {
    setStatus("请先执行一次“简历润色”，再进行前后对比。", true);
    return;
  }
  setLoading(true);
  setStatus("正在计算改写前后提升…");
  try {
    const r = await postJson("/api/v1/compare-improvement", {
      before_resume: beforeResume,
      after_resume: afterResume,
      job_description: job,
    });
    const data = r.data || r;
    setOutput({
      summary: data.summary,
      suggestions: [
        `关键词缺口：${data.keyword_coverage.before_missing_count} -> ${data.keyword_coverage.after_missing_count}`,
        `高风险项：${data.ats_risk.before.high} -> ${data.ats_risk.after.high}`,
        `中风险项：${data.ats_risk.before.medium} -> ${data.ats_risk.after.medium}`,
      ],
      matched_keywords: data.keyword_coverage.improved_keywords || [],
      missing_keywords: data.keyword_coverage.newly_missing_keywords || [],
      match_score: null,
    });
    setStatus("已生成改写前后对比。");
  } catch (e) {
    setStatus(friendlyErrorMessage(e), true);
  } finally {
    setLoading(false);
  }
}

function openSettings() {
  const d = $("dlgSettings");
  if (d && typeof d.showModal === "function") d.showModal();
}

function closeSettings() {
  const d = $("dlgSettings");
  if (d && typeof d.close === "function") d.close();
}

async function exportDocx() {
  const out = $("output");
  const text = (lastRenderedPlainText || (out && out.textContent) || "").trim();
  const trimmed = text;
  const placeholder = "结果将显示在这里…";
  if (!trimmed || trimmed === placeholder) {
    setStatus("请先生成结果，再导出 Word。", true);
    return;
  }
  setStatus("正在生成 Word…");
  try {
    const res = await fetchWithTimeout("/api/v1/export-docx", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: trimmed, filename: lastExportBasename }),
    });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const err = await res.json();
        if (err.detail) msg = typeof err.detail === "string" ? err.detail : JSON.stringify(err.detail);
      } catch {
        msg = (await res.text()) || msg;
      }
      throw new Error(msg);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${lastExportBasename.replace(/[/\\?%*:|"<>]/g, "_")}.docx`;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setStatus("已下载 Word 文件。");
  } catch (e) {
    setStatus(String(e.message || e), true);
  }
}

async function applyClientConfig() {
  try {
    const res = await fetch("/api/v1/client-config", { method: "GET" });
    if (!res.ok) return;
    const cfg = await res.json();
    const mode = cfg.llm_mode || (cfg.trust_client_llm ? "byok" : "server");
    if (mode === "server") {
      $("btnSettings")?.setAttribute("hidden", "");
      const h = $("hintApi");
      if (h) {
        h.innerHTML =
          "当前为<strong>服务端配置模型</strong>：密钥仅保存在服务器环境变量中，不在浏览器填写。";
      }
    } else {
      const h = $("hintApi");
      if (h) {
        h.innerHTML =
          "当前为<strong>BYOK 模式</strong>：可在浏览器填写 API Key，建议仅会话保存并避免在公网共享设备使用。";
      }
    }
    if (cfg.expose_api_docs === false) {
      $("footDocs")?.setAttribute("hidden", "");
    }
  } catch {
    /* 离线或旧后端：忽略 */
  }
}

function init() {
  if (location.protocol === "file:") {
    setStatus(
      "不要从磁盘直接打开 HTML。请在「resume-matcher」文件夹里运行 run.ps1，或在终端执行：.venv\\Scripts\\uvicorn.exe main:app --host 0.0.0.0 --port 8000，然后浏览器访问 http://127.0.0.1:8000/",
      true,
    );
    return;
  }
  loadSettings();
  ensureVisibleMultiJobCount(MIN_MULTI_JD_VISIBLE);
  loadDraft();
  applyClientConfig();
  bindResultCardActions();
  bindHistoryActions();
  renderHistory();

  $("btnSettings")?.addEventListener("click", openSettings);
  $("btnSaveSettings")?.addEventListener("click", () => {
    if (!saveSettings()) return;
    closeSettings();
    const rememberKey = Boolean($("rememberKey") && $("rememberKey").checked);
    setStatus(
      rememberKey ? "已保存模型设置（API Key 已记住到本机浏览器）。" : "已保存模型设置（API Key 仅当前会话有效）。",
    );
  });
  $("btnClearKey")?.addEventListener("click", () => {
    localStorage.removeItem(LS.key);
    sessionStorage.removeItem(SS.key);
    localStorage.setItem(LS.rememberKey, "0");
    if ($("apiKey")) $("apiKey").value = "";
    if ($("rememberKey")) $("rememberKey").checked = false;
    setStatus("已清除本地 API Key。");
  });

  $("btnAnalyze")?.addEventListener("click", runAnalyze);
  $("btnAnalyzeMulti")?.addEventListener("click", runAnalyzeMulti);
  $("btnTailor")?.addEventListener("click", runTailor);
  $("btnCover")?.addEventListener("click", runCover);
  $("btnInterviewSim")?.addEventListener("click", runInterviewSim);
  $("btnAtsCheck")?.addEventListener("click", runAtsCheck);
  $("btnRetryLast")?.addEventListener("click", retryLastTask);
  $("btnCompareImprove")?.addEventListener("click", compareImprovement);
  $("btnDemoFill")?.addEventListener("click", fillDemoData);
  $("btnDemoClear")?.addEventListener("click", clearDemoData);
  $("btnDraftSave")?.addEventListener("click", () => saveDraft(true));
  $("btnDraftClear")?.addEventListener("click", clearDraft);
  $("btnAddJD")?.addEventListener("click", addMultiJDInput);
  $("btnCollapseJD")?.addEventListener("click", collapseEmptyMultiJD);
  $("btnHistoryClear")?.addEventListener("click", clearHistory);
  $("btnCancel")?.addEventListener("click", cancelActiveTask);
  $("btnPrint")?.addEventListener("click", () => window.print());
  $("btnExportDocx")?.addEventListener("click", exportDocx);

  $("fileResume")?.addEventListener("change", function () {
    uploadExtractToTextarea(this, "resume");
  });
  $("fileJob")?.addEventListener("change", function () {
    uploadExtractToTextarea(this, "job");
  });
  $("resume")?.addEventListener("input", scheduleDraftSave);
  $("job")?.addEventListener("input", scheduleDraftSave);
  MULTI_JD_IDS.forEach((id) => {
    $(id)?.addEventListener("input", scheduleDraftSave);
  });
}

document.addEventListener("DOMContentLoaded", init);
