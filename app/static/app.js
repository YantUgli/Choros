"use strict";

const $ = (id) => document.getElementById(id);
const state = {
  taskId: null,
  stream: null,
  agents: [],
  categories: [],
  partialLine: null, // elemen <span> untuk menggabung delta token
};

/* ---------------- util ---------------- */

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (res.status === 401) {
    $("login-modal").classList.remove("hidden");
    throw new Error("belum login");
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = (await res.json()).detail ?? detail;
    } catch (_) {}
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  return res.status === 204 ? null : res.json();
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function fmtTime(ts) {
  if (!ts) return "";
  const d = typeof ts === "number" ? new Date(ts * 1000) : new Date(ts);
  return d.toLocaleTimeString("id-ID", { hour12: false });
}

function notify(message, kind = "warn") {
  const banner = $("banner");
  banner.textContent = message;
  banner.classList.remove("hidden");
  if (kind === "ok") setTimeout(() => banner.classList.add("hidden"), 4000);
}

/* ---------------- tabs ---------------- */

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
    tab.classList.add("active");
    $(`view-${tab.dataset.view}`).classList.add("active");
    if (tab.dataset.view === "quota") loadQuota();
    if (tab.dataset.view === "agents") loadAgents();
    if (tab.dataset.view === "routing") loadRouting();
  });
});

/* ---------------- console ---------------- */

function consoleLine(type, text, meta) {
  const container = $("console");
  const line = el("span", `line ${type}`);
  const tag = el("span", "tag", `[${fmtTime(meta?.ts)}] ${meta?.label ?? type}`);
  line.appendChild(tag);
  const body = el("span", "body", text);
  line.appendChild(body);
  container.appendChild(line);
  container.scrollTop = container.scrollHeight;
  return body;
}

function renderEvent(ev) {
  const who = ev.agent ? `${ev.agent}${ev.model ? "/" + ev.model : ""}` : "choros";
  const meta = { ts: ev.ts, label: who };
  const d = ev.data || {};

  switch (ev.type) {
    case "status": {
      state.partialLine = null;
      let text = d.message || "";
      if (Array.isArray(d.targets) && d.targets.length) text += ` → ${d.targets.join(" · ")}`;
      if (Array.isArray(d.skipped) && d.skipped.length) text += `\n  dilewati: ${d.skipped.join("; ")}`;
      if (d.detail) text += `\n  ${d.detail}`;
      consoleLine("status", text, { ...meta, label: "choros" });
      break;
    }
    case "thinking":
    case "output": {
      if (d.partial) {
        // gabungkan delta ke baris berjalan agar console terasa seperti terminal
        if (!state.partialLine || state.partialLine.dataset.kind !== ev.type) {
          state.partialLine = consoleLine(ev.type, "", meta);
          state.partialLine.dataset.kind = ev.type;
        }
        state.partialLine.textContent += d.text || "";
        $("console").scrollTop = $("console").scrollHeight;
      } else {
        state.partialLine = null;
        if (d.final) {
          showResult(d.text || "");
        } else if ((d.text || "").trim()) {
          consoleLine(ev.type, d.text, meta);
        }
      }
      break;
    }
    case "tool_call": {
      state.partialLine = null;
      const input = d.input ? ` ${typeof d.input === "string" ? d.input : JSON.stringify(d.input)}` : "";
      consoleLine("tool_call", `⚙ ${d.name}${input}${d.error ? " ✗ " + d.error : ""}`, meta);
      break;
    }
    case "file_edit":
      state.partialLine = null;
      consoleLine("file_edit", `✎ ${d.action}: ${d.path}`, meta);
      break;
    case "usage":
      state.partialLine = null;
      consoleLine(
        "usage",
        `tokens in=${d.input_tokens ?? 0} out=${d.output_tokens ?? 0} cache=${(d.cache_read_tokens ?? 0) + (d.cache_write_tokens ?? 0)} total=${d.total_tokens ?? 0}` +
          (d.cost_usd ? ` · $${Number(d.cost_usd).toFixed(4)}` : ""),
        meta
      );
      break;
    case "error":
      state.partialLine = null;
      consoleLine("error", `✗ [${d.kind}] ${d.message}`, meta);
      break;
    case "eof":
      state.partialLine = null;
      refreshTaskStatus();
      break;
  }
}

function showResult(text) {
  $("result-panel").classList.remove("hidden");
  $("result-text").textContent = text;
}

function resetConsole() {
  $("console").innerHTML = "";
  $("result-panel").classList.add("hidden");
  $("result-text").textContent = "";
  state.partialLine = null;
}

/* ---------------- streaming ---------------- */

function openStream(taskId) {
  if (state.stream) state.stream.close();
  state.stream = new EventSource(`/api/tasks/${taskId}/stream`);
  state.stream.onmessage = (msg) => {
    try {
      renderEvent(JSON.parse(msg.data));
    } catch (err) {
      console.error("event tidak terbaca", err, msg.data);
    }
  };
  state.stream.onerror = () => {
    state.stream.close();
    state.stream = null;
    refreshTaskStatus();
  };
}

async function refreshTaskStatus() {
  if (!state.taskId) return;
  const task = await api(`/api/tasks/${state.taskId}`);
  setStatus(task.status);
  $("cancel").disabled = task.status !== "running" && task.status !== "queued";
  if (task.final_output) showResult(task.final_output);
  loadTasks();
}

function setStatus(status) {
  const pill = $("task-status");
  pill.textContent = status;
  pill.className = `pill ${status}`;
}

/* ---------------- tugas ---------------- */

async function loadCategories() {
  state.categories = await api("/api/tasks/categories");
  const select = $("category");
  const ruleSelect = $("rule-category");
  select.innerHTML = "";
  ruleSelect.innerHTML = "";
  state.categories.forEach((c) => {
    select.appendChild(new Option(c.label, c.value));
    ruleSelect.appendChild(new Option(c.label, c.value));
  });
}

async function loadTasks() {
  const tasks = await api("/api/tasks?limit=30");
  const list = $("task-list");
  list.innerHTML = "";
  tasks.forEach((task) => {
    const li = el("li");
    if (task.id === state.taskId) li.classList.add("active");
    li.appendChild(el("div", "snippet", task.prompt.slice(0, 90)));
    const meta = el("div", "meta");
    meta.appendChild(el("span", null, `#${task.id} · ${task.category} · ${task.mode}`));
    meta.appendChild(el("span", `pill ${task.status}`, task.status));
    li.appendChild(meta);
    li.addEventListener("click", () => selectTask(task.id));
    list.appendChild(li);
  });
}

async function selectTask(taskId) {
  state.taskId = taskId;
  resetConsole();
  await loadTasks();
  const task = await api(`/api/tasks/${taskId}`);
  setStatus(task.status);
  $("cancel").disabled = !["running", "queued"].includes(task.status);
  openStream(taskId);
}

$("submit").addEventListener("click", async () => {
  const prompt = $("prompt").value.trim();
  if (!prompt) return notify("prompt masih kosong");
  const mode = $("mode").value;
  const payload = {
    prompt,
    category: $("category").value,
    mode,
    project_path: $("project_path").value.trim() || null,
    quality_floor: $("quality_floor").value || null,
    plan_artifact: $("plan_artifact").value.trim() || null,
    allow_unisolated: $("allow_unisolated").checked,
  };
  if (mode === "autonomous" && !payload.allow_unisolated) {
    notify("mode otonom: tugas akan dijalankan di worktree git terpisah", "ok");
  }
  try {
    const task = await api("/api/tasks", { method: "POST", body: JSON.stringify(payload) });
    $("prompt").value = "";
    await selectTask(task.id);
  } catch (err) {
    notify(`gagal mengirim tugas: ${err.message}`);
  }
});

$("cancel").addEventListener("click", async () => {
  if (!state.taskId) return;
  await api(`/api/tasks/${state.taskId}/cancel`, { method: "POST" });
});

$("clear-console").addEventListener("click", resetConsole);

$("show-thinking").addEventListener("change", (e) => {
  $("console").classList.toggle("hide-thinking", !e.target.checked);
});

$("send-followup").addEventListener("click", async () => {
  const answer = $("followup").value.trim();
  if (!answer || !state.taskId) return;
  try {
    const task = await api(`/api/tasks/${state.taskId}/reply`, {
      method: "POST",
      body: JSON.stringify({ answer }),
    });
    $("followup").value = "";
    await selectTask(task.id);
  } catch (err) {
    notify(`follow-up gagal: ${err.message}`);
  }
});

/* ---------------- agent ---------------- */

async function loadAgents() {
  state.agents = await api("/api/agents");
  const table = $("agent-table");
  table.innerHTML = "";
  const head = table.insertRow();
  ["id", "nama", "adapter", "model default", "aktif", ""].forEach((h) => {
    const th = document.createElement("th");
    th.textContent = h;
    head.appendChild(th);
  });
  state.agents.forEach((agent) => {
    const row = table.insertRow();
    [agent.id, agent.name, agent.adapter_type, agent.default_model || "—", agent.is_active ? "ya" : "tidak"].forEach(
      (value) => row.insertCell().textContent = value
    );
    const actions = row.insertCell();
    const edit = el("button", "ghost tiny", "ubah");
    edit.onclick = () => fillAgentForm(agent);
    const del = el("button", "ghost tiny danger", "hapus");
    del.onclick = async () => {
      if (!confirm(`hapus agent ${agent.name}?`)) return;
      try {
        await api(`/api/agents/${agent.id}`, { method: "DELETE" });
        loadAgents();
      } catch (err) {
        notify(err.message);
      }
    };
    actions.append(edit, del);
  });

  const ruleAgent = $("rule-agent");
  ruleAgent.innerHTML = "";
  state.agents.forEach((a) => ruleAgent.appendChild(new Option(`${a.name} (${a.adapter_type})`, a.id)));
}

function fillAgentForm(agent) {
  $("agent-id").value = agent.id;
  $("agent-name").value = agent.name;
  $("agent-adapter").value = agent.adapter_type;
  $("agent-model").value = agent.default_model || "";
  $("agent-baseurl").value = agent.base_url || "";
  $("agent-config").value = JSON.stringify(agent.config || {}, null, 2);
}

$("agent-reset").addEventListener("click", () => $("agent-form").reset() || ($("agent-id").value = ""));

$("agent-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  let config = {};
  const raw = $("agent-config").value.trim();
  if (raw) {
    try {
      config = JSON.parse(raw);
    } catch (err) {
      return notify("config bukan JSON valid");
    }
  }
  const payload = {
    name: $("agent-name").value.trim(),
    adapter_type: $("agent-adapter").value,
    default_model: $("agent-model").value.trim() || null,
    base_url: $("agent-baseurl").value.trim() || null,
    config,
    is_active: true,
  };
  const id = $("agent-id").value;
  try {
    await api(id ? `/api/agents/${id}` : "/api/agents", {
      method: id ? "PUT" : "POST",
      body: JSON.stringify(payload),
    });
    $("agent-form").reset();
    $("agent-id").value = "";
    loadAgents();
  } catch (err) {
    notify(err.message);
  }
});

/* ---------------- routing ---------------- */

async function loadRouting() {
  if (!state.agents.length) await loadAgents();
  const rules = await api("/api/routing");
  const container = $("routing-groups");
  container.innerHTML = "";
  const byCategory = {};
  rules.forEach((r) => (byCategory[r.category] ??= []).push(r));

  state.categories.forEach((cat) => {
    const group = el("div", "rule-group");
    const label = state.categories.find((c) => c.value === cat.value)?.label ?? cat.value;
    group.appendChild(el("h4", null, label));
    const list = byCategory[cat.value] || [];
    if (!list.length) {
      group.appendChild(el("p", "note", "belum ada target — tugas kategori ini akan berhenti dengan status halted"));
    } else {
      const table = el("table", "table");
      const head = table.insertRow();
      ["priority", "agent", "model", ""].forEach((h) => {
        const th = document.createElement("th");
        th.textContent = h;
        head.appendChild(th);
      });
      list.forEach((rule) => {
        const agent = state.agents.find((a) => a.id === rule.agent_id);
        const row = table.insertRow();
        row.insertCell().textContent = rule.priority;
        row.insertCell().textContent = agent ? agent.name : `#${rule.agent_id}`;
        row.insertCell().textContent = rule.model || agent?.default_model || "—";
        const actions = row.insertCell();
        const edit = el("button", "ghost tiny", "ubah");
        edit.onclick = () => {
          $("rule-id").value = rule.id;
          $("rule-category").value = rule.category;
          $("rule-agent").value = rule.agent_id;
          $("rule-model").value = rule.model || "";
          $("rule-priority").value = rule.priority;
        };
        const del = el("button", "ghost tiny danger", "hapus");
        del.onclick = async () => {
          await api(`/api/routing/${rule.id}`, { method: "DELETE" });
          loadRouting();
        };
        actions.append(edit, del);
      });
      group.appendChild(table);
    }
    container.appendChild(group);
  });
}

$("rule-reset").addEventListener("click", () => {
  $("routing-form").reset();
  $("rule-id").value = "";
});

$("routing-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const payload = {
    category: $("rule-category").value,
    agent_id: Number($("rule-agent").value),
    model: $("rule-model").value.trim() || null,
    priority: Number($("rule-priority").value),
  };
  const id = $("rule-id").value;
  try {
    await api(id ? `/api/routing/${id}` : "/api/routing", {
      method: id ? "PUT" : "POST",
      body: JSON.stringify(payload),
    });
    $("routing-form").reset();
    $("rule-id").value = "";
    loadRouting();
  } catch (err) {
    notify(err.message);
  }
});

/* ---------------- kuota ---------------- */

async function loadQuota() {
  if (!state.agents.length) await loadAgents();
  const [windows, summary] = await Promise.all([api("/api/quota"), api("/api/quota/summary")]);

  const qt = $("quota-table");
  qt.innerHTML = "";
  const head = qt.insertRow();
  ["agent", "model", "window", "terpakai", "status", ""].forEach((h) => {
    const th = document.createElement("th");
    th.textContent = h;
    head.appendChild(th);
  });
  if (!windows.length) {
    qt.insertRow().insertCell().textContent = "belum ada konsumsi tercatat";
  }
  windows.forEach((w) => {
    const agent = state.agents.find((a) => a.id === w.agent_id);
    const row = qt.insertRow();
    row.insertCell().textContent = agent ? agent.name : `#${w.agent_id}`;
    row.insertCell().textContent = w.model || "—";
    row.insertCell().textContent = `${w.window_type || "—"} → ${w.window_end ? new Date(w.window_end).toLocaleString("id-ID") : "—"}`;
    row.insertCell().textContent = `${w.tokens_used} tok`;
    const status = row.insertCell();
    status.textContent = w.is_exhausted ? "mentok" : "tersedia";
    status.className = w.is_exhausted ? "exhausted" : "fresh";
    const actions = row.insertCell();
    if (w.is_exhausted) {
      const reset = el("button", "ghost tiny", "reset");
      reset.onclick = async () => {
        await api("/api/quota/reset", {
          method: "POST",
          body: JSON.stringify({ agent_id: w.agent_id, model: w.model }),
        });
        loadQuota();
      };
      actions.appendChild(reset);
    }
  });

  const ut = $("usage-table");
  ut.innerHTML = "";
  const uhead = ut.insertRow();
  ["agent", "model", "run", "token", "kena limit"].forEach((h) => {
    const th = document.createElement("th");
    th.textContent = h;
    uhead.appendChild(th);
  });
  if (!summary.length) {
    ut.insertRow().insertCell().textContent = "belum ada run";
  }
  summary.forEach((s) => {
    const row = ut.insertRow();
    [s.agent, s.model || "—", s.runs, s.tokens, s.rate_limited].forEach(
      (v) => (row.insertCell().textContent = v)
    );
  });
}

/* ---------------- login ---------------- */

$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: $("login-user").value, password: $("login-pass").value }),
    });
    if (!res.ok) throw new Error((await res.json()).detail || "gagal login");
    $("login-modal").classList.add("hidden");
    boot();
  } catch (err) {
    $("login-error").textContent = err.message;
  }
});

/* ---------------- boot ---------------- */

async function boot() {
  const status = await (await fetch("/api/auth/status")).json();
  if (!status.auth_required) {
    notify("Mode lokal tanpa login (CHOROS_ADMIN_PASSWORD_HASH belum diisi). Jangan expose port ini ke jaringan.");
  }
  try {
    await loadCategories();
    await loadAgents();
    await loadTasks();
  } catch (err) {
    if (err.message !== "belum login") notify(err.message);
  }
}

boot();
