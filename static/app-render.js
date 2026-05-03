function renderOutputSummary(obj) {
  if (!obj || typeof obj !== "object") return "";
  if (obj.career_orientation && obj.action_plan) {
    const roles = Array.isArray(obj.career_orientation.best_fit_roles) ? obj.career_orientation.best_fit_roles : [];
    const actions = Array.isArray(obj.action_plan.now) ? obj.action_plan.now : [];
    const roleText = roles.slice(0, 2).join("、") || "方向未明确";
    const actionText = actions.slice(0, 2).join("；") || "暂无行动项";
    return `<article class="summary-card"><div class="summary-eyebrow">今天先看这个</div><h3>${escapeHtml(roleText)}</h3><p>${textAsHtml(actionText)}</p></article>`;
  }
  if (obj.summary || obj.match_score != null) {
    const score = obj.match_score != null ? `${obj.match_score}/100` : "";
    return `<article class="summary-card"><div class="summary-eyebrow">结果摘要</div><h3>${escapeHtml(score || "分析完成")}</h3><p>${textAsHtml(obj.summary || "")}</p></article>`;
  }
  return "";
}

function normalizeResultData(obj) {
  if (!obj || typeof obj !== "object") return obj;
  const normalized = { ...obj };
  const safeArr = (value) => (Array.isArray(value) ? value.filter((x) => (typeof x === "string" ? x.trim() : x != null)) : []);
  if (normalized.career_orientation && typeof normalized.career_orientation === "object") {
    normalized.career_orientation = {
      ...normalized.career_orientation,
      best_fit_roles: safeArr(normalized.career_orientation.best_fit_roles),
      why_fit: safeArr(normalized.career_orientation.why_fit),
      current_capabilities: safeArr(normalized.career_orientation.current_capabilities),
      capability_gaps: safeArr(normalized.career_orientation.capability_gaps),
    };
  }
  if (normalized.action_plan && typeof normalized.action_plan === "object") {
    normalized.action_plan = {
      ...normalized.action_plan,
      now: safeArr(normalized.action_plan.now),
      next_2_weeks: safeArr(normalized.action_plan.next_2_weeks),
      job_search_strategy: safeArr(normalized.action_plan.job_search_strategy),
    };
  }
  if (normalized.market_reference && typeof normalized.market_reference === "object") {
    normalized.market_reference = {
      ...normalized.market_reference,
      role_snapshot: safeArr(normalized.market_reference.role_snapshot),
      entry_path_examples: safeArr(normalized.market_reference.entry_path_examples),
      information_gaps_to_verify: safeArr(normalized.market_reference.information_gaps_to_verify),
    };
  }
  if (normalized.emotional_support && typeof normalized.emotional_support === "object") {
    normalized.emotional_support = {
      ...normalized.emotional_support,
      vent_prompt: safeArr(normalized.emotional_support.vent_prompt),
    };
  }
  if (Array.isArray(normalized.jobs)) {
    normalized.jobs = normalized.jobs.filter(Boolean).map((job) => ({
      ...job,
      top_missing_keywords: safeArr(job && job.top_missing_keywords),
      rewrite_actions: safeArr(job && job.rewrite_actions),
    }));
  }
  return normalized;
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

function formatModelPlainText(obj) {
  if (obj == null) return "";
  if (typeof obj !== "object") return String(obj);
  if (obj.career_orientation && obj.action_plan) {
    const parts = ["【职业方向诊断】"];
    if (Array.isArray(obj.career_orientation.best_fit_roles) && obj.career_orientation.best_fit_roles.length) {
      parts.push("", "适合方向：", listAsText(obj.career_orientation.best_fit_roles, true));
    }
    if (Array.isArray(obj.career_orientation.why_fit) && obj.career_orientation.why_fit.length) {
      parts.push("", "为什么适合：", listAsText(obj.career_orientation.why_fit, false));
    }
    if (Array.isArray(obj.career_orientation.current_capabilities) && obj.career_orientation.current_capabilities.length) {
      parts.push("", "当前能力：", listAsText(obj.career_orientation.current_capabilities, false));
    }
    if (Array.isArray(obj.career_orientation.capability_gaps) && obj.career_orientation.capability_gaps.length) {
      parts.push("", "能力差距：", listAsText(obj.career_orientation.capability_gaps, false));
    }
    if (obj.career_orientation.confidence) parts.push("", `判断置信度：${obj.career_orientation.confidence}`);
    if (obj.action_plan) {
      if (Array.isArray(obj.action_plan.now) && obj.action_plan.now.length) {
        parts.push("", "【现在先做（48小时）】", listAsText(obj.action_plan.now, true));
      }
      if (Array.isArray(obj.action_plan.next_2_weeks) && obj.action_plan.next_2_weeks.length) {
        parts.push("", "【接下来两周】", listAsText(obj.action_plan.next_2_weeks, true));
      }
      if (Array.isArray(obj.action_plan.job_search_strategy) && obj.action_plan.job_search_strategy.length) {
        parts.push("", "【投递策略】", listAsText(obj.action_plan.job_search_strategy, false));
      }
    }
    if (obj.emotional_support) {
      if (obj.emotional_support.validation) {
        parts.push("", "【情绪支持】", normalizeVisibleEscapes(String(obj.emotional_support.validation || "")));
      }
      if (Array.isArray(obj.emotional_support.vent_prompt) && obj.emotional_support.vent_prompt.length) {
        parts.push("", "【可吐槽/复盘问题】", listAsText(obj.emotional_support.vent_prompt, false));
      }
    }
    if (obj.market_reference) {
      if (Array.isArray(obj.market_reference.role_snapshot) && obj.market_reference.role_snapshot.length) {
        parts.push("", "【岗位信息速览】", listAsText(obj.market_reference.role_snapshot, false));
      }
      if (Array.isArray(obj.market_reference.entry_path_examples) && obj.market_reference.entry_path_examples.length) {
        parts.push("", "【可行切入路径】", listAsText(obj.market_reference.entry_path_examples, false));
      }
      if (Array.isArray(obj.market_reference.information_gaps_to_verify) && obj.market_reference.information_gaps_to_verify.length) {
        parts.push("", "【待补充信息】", listAsText(obj.market_reference.information_gaps_to_verify, false));
      }
    }
    if (obj.summary) parts.push("", "【总结】", normalizeVisibleEscapes(String(obj.summary || "")));
    return parts.join("\n").trim();
  }
  if (typeof obj.tailored_resume === "string") {
    const parts = ["【润色后的简历】", normalizeVisibleEscapes(String(obj.tailored_resume || ""))];
    if (obj.changes_summary) parts.push("", "【改动摘要】", normalizeVisibleEscapes(String(obj.changes_summary)));
    if (Array.isArray(obj.evidence_changes) && obj.evidence_changes.length) {
      const riskLabel = (value) => {
        const raw = String(value || "").trim().toLowerCase();
        const map = {
          critical: "关键修改",
          important: "重要修改",
          polish: "润色优化",
          high: "高优先级",
          medium: "中优先级",
          low: "低优先级",
          unknown: "未标注",
        };
        return map[raw] || String(value || "未标注");
      };
      parts.push("", "【证据链改写】");
      obj.evidence_changes.forEach((x, i) => {
        parts.push(
          `${i + 1}. (${riskLabel(x.risk_level)})`,
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
      parts.push("", `Q${i + 1} [${String(q.category || "general")}]`, `问题：${String(q.question || "")}`, `意图：${String(q.intent || "")}`);
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
      parts.push("", `${i + 1}. [${String(r.level || "").toUpperCase()}] ${String(r.rule || "")}`, `说明：${String(r.message || "")}`, `修复建议：${String(r.fix || "")}`);
    });
    if (obj.quick_wins.length) parts.push("", "【快速修复清单】", listAsText(obj.quick_wins, false));
    return parts.join("\n").trim();
  }
  if ("match_score" in obj || "summary" in obj || Array.isArray(obj.matched_keywords) || Array.isArray(obj.suggestions)) {
    const parts = [];
    if (obj.match_score != null) parts.push(`匹配度：${obj.match_score} / 100`);
    if (obj.summary) parts.push("", "【总结】", String(obj.summary));
    if (Array.isArray(obj.dimension_scores) && obj.dimension_scores.length) {
      parts.push("", "【维度评分明细】");
      obj.dimension_scores.forEach((d, i) => {
        parts.push(
          `${i + 1}. ${String(d.dimension || "未命名维度")}（权重: ${d.weight ?? "-"}，得分: ${d.score ?? "-"}）`,
          `依据：${String(d.evidence || "-")}`,
          ""
        );
      });
    }
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
