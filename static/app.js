const FEATURE_OUTPUT_IDS = {
  career: "outputCareer",
  analyze: "outputAnalyze",
  tailor: "outputTailor",
  interview: "outputInterview",
};

function getFeatureOutput(feature) {
  return $(FEATURE_OUTPUT_IDS[feature] || "output");
}

function setFeatureOutput(feature, text) {
  const target = getFeatureOutput(feature);
  if (target) target.textContent = text;
}

function getResumeJobDrafts() {
  const resume = (($("resume") && $("resume").value.trim()) || localStorage.getItem(DRAFT.resume) || "").trim();
  const job = (($("job") && $("job").value.trim()) || localStorage.getItem(DRAFT.job) || "").trim();
  return { resume, job };
}

async function callAnalysisApi(endpoint, body, feature = "main") {
  setLoading(true);
  setStatus("正在分析，请稍候…", false);
  try {
    const result = await postJson(endpoint, body);
    const normalized = normalizeResultData ? normalizeResultData(result) : result;
    const plainText = formatModelPlainText(normalized);
    setFeatureOutput(feature, plainText);
    setStatus("分析完成。", false);
    return normalized;
  } catch (err) {
    const msg = friendlyErrorMessage(err);
    const detail = err && err.response ? JSON.stringify(err.response, null, 2) : "";
    setStatus(msg, true);
    setFeatureOutput(feature, detail ? `${msg}\n\n${detail}` : msg);
    return null;
  } finally {
    setLoading(false);
  }
}

async function runCareerPlan() {
  const { resume } = getResumeJobDrafts();
  const concern = (($("customConcern") && $("customConcern").value.trim()) || localStorage.getItem(DRAFT.customConcern) || "").trim();
  if (!resume) {
    setStatus("请先补充简历内容。", true);
    setFlowStep("resume");
    return null;
  }
  return callAnalysisApi("/api/v1/career-plan", { resume, concern, client_id: getClientId(), memory: getMemoryState(), ...llmPayload() }, "career");
}

async function runAnalyze() {
  const { resume, job } = getResumeJobDrafts();
  if (!validateInputs(resume, job)) return null;
  return callAnalysisApi("/api/v1/analyze", { resume, job, client_id: getClientId(), memory: getMemoryState(), ...llmPayload() }, "analyze");
}

async function runTailor() {
  const { resume, job } = getResumeJobDrafts();
  if (!validateInputs(resume, job)) return null;
  return callAnalysisApi("/api/v1/tailor", { resume, job, client_id: getClientId(), memory: getMemoryState(), ...llmPayload() }, "tailor");
}

async function runInterviewSim() {
  const { resume, job } = getResumeJobDrafts();
  if (!validateInputs(resume, job)) return null;
  return callAnalysisApi("/api/v1/interview", { resume, job, client_id: getClientId(), memory: getMemoryState(), ...llmPayload() }, "interview");
}

function ensureChatWelcome() {
  const thread = getChatThread();
  if (thread.length) return;
  saveChatThread([
    { id: `m_${Date.now()}_welcome`, role: "assistant", content: "你好，我会先通过几个开放问题了解你现在的求职困惑。你也可以直接告诉我：你最想先解决什么？", time: nowLabel(), pending: false },
  ]);
}

async function runChatMvp() {
  const input = $("chatInput");
  const text = String((input && input.value) || "").trim();
  if (!text) {
    setStatus("请先输入你想聊的内容。", true);
    return null;
  }
  if (input) input.value = "";
  return sendChatMessage(text);
}

function bindChatInputEnter() {
  const input = $("chatInput");
  if (!input) return;
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const form = $("chatForm");
      if (form && !input.disabled) form.requestSubmit();
    }
  });
}

function bindChatToolbar() {
  const historyBtn = $("btnChatHistory");
  if (historyBtn) {
    historyBtn.addEventListener("click", () => {
      renderChatThread();
      scrollChatToLatest();
    });
  }
  const latestBtn = $("btnChatJumpLatest");
  if (latestBtn) {
    latestBtn.addEventListener("click", () => scrollChatToLatest());
  }
  const clearBtn = $("btnChatClear");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      clearChatHistory();
    });
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const thread = $("chatThread");
  if (thread) {
    ensureChatWelcome();
    renderChatThread();
    scrollChatToLatest();
  }

  const form = $("chatForm");
  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      await runChatMvp();
    });
  }

  const seed = $("btnChatSeed");
  if (seed) {
    seed.addEventListener("click", async () => {
      const input = $("chatInput");
      if (input && !input.value.trim()) input.value = "我现在最担心的是不知道自己适合什么方向，你可以先帮我问几个问题。";
      await runChatMvp();
    });
  }

  bindChatInputEnter();
  bindChatToolbar();
});
