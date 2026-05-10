async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  return await res.json();
}

const state = {
  apps: {},
  status: {},
  filter: "",
  launching: new Set(),
  logs: { appId: null, timer: null },
  hubLogs: { level: "all", timer: null },
  editing: { appId: null },
};

function $(sel) {
  return document.querySelector(sel);
}

function el(tag, className) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  return n;
}

function sanitizeId(id) {
  return encodeURIComponent(String(id || ""));
}

async function refreshApps() {
  state.apps = await api("/api/apps");
}

async function refreshStatus() {
  state.status = await api("/api/apps/status");
}

async function refreshHubTheme() {
  const r = await api("/api/control_hub/themes");
  const select = $("#controlHubThemeSelect");
  select.innerHTML = "";
  (r.themes || []).forEach((t) => {
    const opt = document.createElement("option");
    opt.value = t;
    opt.textContent = t.charAt(0).toUpperCase() + t.slice(1);
    select.appendChild(opt);
  });
  select.value = r.active_theme || "dark";
  applyHubTheme(select.value);
}

function applyHubTheme(theme) {
  const link = $("#controlHubThemeCss");
  link.href = `/styles/themes/${encodeURIComponent(theme)}.css`;
}

function statusDot(appId) {
  const st = state.status[appId] || {};
  const dot = el("div", "status-dot");
  if (state.launching.has(appId)) {
    dot.style.background = "rgba(255, 200, 70, 0.95)";
    dot.style.boxShadow = "0 0 0 3px rgba(255, 200, 70, 0.18)";
    return dot;
  }
  if (st.running) dot.classList.add("ok");
  return dot;
}

function renderApps() {
  const grid = $("#appsGrid");
  grid.innerHTML = "";

  const allIds = Object.keys(state.apps);
  const ids = allIds
    .filter((id) => {
      if (!state.filter) return true;
      const cfg = state.apps[id] || {};
      const q = state.filter.toLowerCase();
      return String(id).toLowerCase().includes(q) || String(cfg.name || "").toLowerCase().includes(q);
    })
    .sort((a, b) => a.localeCompare(b));

  if (!ids.length) {
    const empty = el("div", "panel glass");
    empty.textContent = allIds.length ? "No results." : 'No applications yet. Click "Add".';
    grid.appendChild(empty);
    return;
  }

  for (const appId of ids) {
    const cfg = state.apps[appId];
    const st = state.status[appId] || {};
    const launchType = cfg.launch_type || "web";
    const port = st.running ? st.port : st.desired_port;

    const card = el("div", "card glass");

    const title = el("div", "card-title");
    const h2 = el("h2");
    h2.textContent = cfg.name || appId;
    title.appendChild(h2);
    title.appendChild(statusDot(appId));

    const meta = el("div", "muted");
    meta.textContent = `Port: ${port ?? "—"} · PID: ${st.pid || "—"}`;

    const linkRow = el("div");
    if (port) {
      const a = el("a", "link");
      a.href = `http://localhost:${port}`;
      a.target = "_blank";
      a.rel = "noreferrer";
      a.textContent = `http://localhost:${port}`;
      linkRow.appendChild(a);
    } else {
      linkRow.textContent = "Port: (defined in port.json)";
    }

    const actions = el("div", "actions");
    const btnLaunch = el("button", "btn btn-primary");
    btnLaunch.textContent = st.running ? "Restart" : "Start";
    btnLaunch.addEventListener("click", async () => {
      state.launching.add(appId);
      renderApps();
      try {
        await api(`/api/apps/${sanitizeId(appId)}/launch`, { method: "POST" });
      } finally {
        state.launching.delete(appId);
      }
      await refreshStatus();
      renderApps();
    });

    const btnStop = el("button", "btn");
    btnStop.textContent = "Stop";
    btnStop.addEventListener("click", async () => {
      await api(`/api/apps/${sanitizeId(appId)}/stop`, { method: "POST" });
      await refreshStatus();
      renderApps();
    });

    const btnLogs = el("button", "btn");
    btnLogs.textContent = "View logs";
    btnLogs.addEventListener("click", async () => openLogs(appId, cfg.name || appId));

    actions.appendChild(btnLaunch);
    actions.appendChild(btnStop);
    actions.appendChild(btnLogs);

    const portRow = el("div", "row");
    if (launchType === "web") {
      const portLabel = el("div", "muted");
      portLabel.textContent = "Port:";
      const portInput = el("input", "input");
      portInput.type = "number";
      portInput.style.maxWidth = "160px";
      portInput.value = String(st.desired_port ?? port ?? 5000);
      const btnSavePort = el("button", "btn");
      btnSavePort.textContent = "Save";
      btnSavePort.addEventListener("click", async () => {
        const v = parseInt(portInput.value, 10);
        if (!Number.isFinite(v)) return;
        await api(`/api/apps/${sanitizeId(appId)}/port`, { method: "PUT", body: JSON.stringify({ port: v }) });
        await refreshStatus();
        renderApps();
      });
      portRow.appendChild(portLabel);
      portRow.appendChild(portInput);
      portRow.appendChild(btnSavePort);
    } else {
      const lbl = el("div", "muted");
      lbl.textContent = `Launch type: ${launchType}`;
      portRow.appendChild(lbl);
    }

    card.appendChild(title);
    card.appendChild(meta);
    card.appendChild(linkRow);
    card.appendChild(actions);
    card.appendChild(portRow);
    grid.appendChild(card);
  }
}

async function refreshHealth() {
  try {
    await api("/api/health");
    $("#serverStatus").textContent = "Backend: OK";
  } catch {
    $("#serverStatus").textContent = "Backend: OFF";
  }
}

function openModal(modalEl) {
  modalEl.classList.remove("hidden");
}

function closeModal(modalEl) {
  modalEl.classList.add("hidden");
}

function closeModalWithCleanup(modalEl) {
  if (!modalEl) return;
  const id = modalEl.id;
  if (id === "logsModal") {
    state.logs.appId = null;
    if (state.logs.timer) clearInterval(state.logs.timer);
    state.logs.timer = null;
  }
  if (id === "hubLogsModal") {
    if (state.hubLogs.timer) clearInterval(state.hubLogs.timer);
    state.hubLogs.timer = null;
  }
  closeModal(modalEl);
}

function setupModals() {
  document.querySelectorAll(".modal").forEach((m) => {
    m.addEventListener("click", (e) => {
      const t = e.target;
      if (t && t.dataset && t.dataset.close) closeModalWithCleanup(m);
    });
  });
}

function dirname(p) {
  const s = String(p || "").replaceAll("\\", "/");
  const i = s.lastIndexOf("/");
  if (i <= 0) return s;
  return s.slice(0, i);
}

async function browseScript() {
  const r = await api("/api/dialog/select_script", { method: "POST" });
  return r.path;
}

async function browseRoot() {
  const r = await api("/api/dialog/select_folder", { method: "POST" });
  return r.path;
}

function setupAddApp() {
  const modal = $("#addAppModal");
  $("#btnAddApp").addEventListener("click", () => openModal(modal));
  $("#btnBrowseScript").addEventListener("click", async () => {
    try {
      const p = await browseScript();
      $("#add_script_path").value = p;
      if (!$("#add_project_root").value.trim()) $("#add_project_root").value = dirname(p);
    } catch (e) {
      showAddError(e);
    }
  });
  $("#btnBrowseRoot").addEventListener("click", async () => {
    try {
      const p = await browseRoot();
      $("#add_project_root").value = p;
    } catch (e) {
      showAddError(e);
    }
  });

  function showAddError(e) {
    const msg = String(e?.message || e);
    $("#addAppError").textContent = msg;
    $("#addAppError").classList.remove("hidden");
  }

  $("#btnSaveApp").addEventListener("click", async () => {
    $("#addAppError").classList.add("hidden");
    try {
      const payload = {
        id: $("#add_id").value.trim(),
        name: $("#add_name").value.trim(),
        script_path: $("#add_script_path").value.trim(),
        project_root: $("#add_project_root").value.trim(),
        port_file: $("#add_port_file").value.trim() || "port.json",
        auto_launch: $("#add_autolaunch").value === "1",
        launch_type: "web",
      };
      await api("/api/apps", { method: "POST", body: JSON.stringify(payload) });
      closeModal(modal);
      await refreshApps();
      await refreshStatus();
      renderApps();
    } catch (e) {
      showAddError(e);
    }
  });
}

async function openLogs(appId, title) {
  const modal = $("#logsModal");
  $("#logsTitle").textContent = `Logs · ${title}`;
  openModal(modal);

  state.logs.appId = appId;
  if (state.logs.timer) clearInterval(state.logs.timer);

  const tick = async () => {
    if (!state.logs.appId) return;
    const r = await api(`/api/apps/${sanitizeId(appId)}/logs?tail=600`);
    const lines = r.lines || [];
    $("#logsTitle").textContent = `Logs · ${title} · ${r.log_path || ""}`;
    const consoleEl = $("#logsConsole");
    consoleEl.textContent = lines.join("\n") || "No logs yet.";
    consoleEl.scrollTop = consoleEl.scrollHeight;
  };

  await tick().catch(() => {});
  state.logs.timer = setInterval(() => tick().catch(() => {}), 2000);
}

function setupLogsModalClose() {
  const modal = $("#logsModal");
  modal.addEventListener("click", (e) => {
    const t = e.target;
    if (t && t.dataset && t.dataset.close) {
      state.logs.appId = null;
      if (state.logs.timer) clearInterval(state.logs.timer);
      state.logs.timer = null;
    }
  });
}

async function openHubLogs() {
  const modal = $("#hubLogsModal");
  openModal(modal);

  const tick = async () => {
    const r = await api(`/api/control_hub/logs?tail=1200&level=${encodeURIComponent(state.hubLogs.level)}`);
  $("#hubLogsTitle").textContent = `Control Hub Logs · ${r.log_path || ""}`;
    const lines = r.lines || [];
    const html = lines
      .map((ln) => {
        const esc = ln.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
        if (esc.includes("[ERROR]")) return `<span class="log-error">${esc}</span>`;
        if (esc.includes("[WARNING]")) return `<span class="log-warning">${esc}</span>`;
        if (esc.includes("[INFO]")) return `<span class="log-info">${esc}</span>`;
        return esc;
      })
      .join("\n");
    const consoleEl = $("#hubLogsConsole");
    consoleEl.innerHTML = html || "No logs yet.";
    consoleEl.scrollTop = consoleEl.scrollHeight;
  };

  if (state.hubLogs.timer) clearInterval(state.hubLogs.timer);
  await tick().catch(() => {});
  state.hubLogs.timer = setInterval(() => tick().catch(() => {}), 2000);
}

function setupHubLogs() {
  $("#btnHubLogs").addEventListener("click", () => openHubLogs().catch(() => {}));
  $("#hubLogsModal").addEventListener("click", (e) => {
    const t = e.target;
    if (t && t.dataset && t.dataset.close) {
      if (state.hubLogs.timer) clearInterval(state.hubLogs.timer);
      state.hubLogs.timer = null;
    }
    if (t && t.dataset && t.dataset.level) {
      state.hubLogs.level = t.dataset.level;
    }
  });
  $("#btnHubLogsClear").addEventListener("click", async () => {
    await api("/api/control_hub/logs", { method: "DELETE" });
  });
}

function isModalOpen(id) {
  const m = document.getElementById(id);
  return !!m && !m.classList.contains("hidden");
}

function closeTopmostModal() {
  // Priority: nested editors first
  const ids = ["editAppModal", "manageAppsModal", "hubLogsModal", "logsModal", "addAppModal", "settingsModal"];
  for (const id of ids) {
    if (isModalOpen(id)) {
      closeModalWithCleanup(document.getElementById(id));
      return true;
    }
  }
  return false;
}

function setupEscapeKey() {
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (closeTopmostModal()) e.preventDefault();
  });
}

function setupSettings() {
  const modal = $("#settingsModal");
  $("#btnSettings").addEventListener("click", () => openModal(modal));
  $("#btnApplyHubTheme").addEventListener("click", async () => {
    const theme = $("#controlHubThemeSelect").value;
    await api("/api/control_hub/themes", { method: "PUT", body: JSON.stringify({ theme }) });
    applyHubTheme(theme);
  });
}

function renderAppsTable() {
  const body = $("#appsTableBody");
  body.innerHTML = "";
  const ids = Object.keys(state.apps).sort((a, b) => a.localeCompare(b));
  for (const id of ids) {
    const cfg = state.apps[id];
    const st = state.status[id] || {};
    const launchType = cfg.launch_type || "web";
    const port = launchType === "web" ? (st.desired_port ?? "—") : "-";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(cfg.name || id)}</td>
      <td>${escapeHtml(cfg.script_path || "")}</td>
      <td>${escapeHtml(cfg.project_root || "")}</td>
      <td>${escapeHtml(String(port))}</td>
      <td>${escapeHtml(String(launchType))}</td>
      <td>
        <button class="btn btn-icon" data-edit="${escapeAttr(id)}" title="Edit" aria-label="Edit">
          ${iconEdit()}
        </button>
        <button class="btn btn-icon" data-del="${escapeAttr(id)}" title="Delete" aria-label="Delete">
          ${iconTrash()}
        </button>
      </td>
    `;
    body.appendChild(tr);
  }
}

function iconEdit() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 17.25V20h2.75L17.8 8.95l-2.75-2.75L4 17.25zm15.71-9.04a1 1 0 0 0 0-1.41l-1.5-1.5a1 1 0 0 0-1.41 0l-1.13 1.13 2.75 2.75 1.29-0.97z"/>
    </svg>
  `;
}

function iconTrash() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 3h6l1 2h4v2H4V5h4l1-2zm1 6h2v10h-2V9zm4 0h2v10h-2V9zM7 9h2v10H7V9z"/>
    </svg>
  `;
}

function escapeHtml(s) {
  return String(s || "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
function escapeAttr(s) {
  return String(s || "").replaceAll("\"", "&quot;");
}

async function openManageApps() {
  const modal = $("#manageAppsModal");
  openModal(modal);
  renderAppsTable();
}

async function openEditApp(appId) {
  state.editing.appId = appId;
  $("#editAppError").classList.add("hidden");
  const cfg = await api(`/api/apps/${sanitizeId(appId)}`);
  $("#edit_name").value = cfg.name || appId;
  $("#edit_script_path").value = cfg.script_path || "";
  $("#edit_project_root").value = cfg.project_root || "";
  $("#edit_launch_type").value = cfg.launch_type || "web";
  try {
    const portRes = await api(`/api/apps/${sanitizeId(appId)}/port`);
    $("#edit_port").value = portRes?.data?.port ?? "";
  } catch {
    $("#edit_port").value = "";
  }
  openModal($("#editAppModal"));
}

function setupManageApps() {
  $("#btnManageApps").addEventListener("click", () => openManageApps().catch(() => {}));
  $("#btnManageAppsAdd").addEventListener("click", () => openModal($("#addAppModal")));
  $("#appsTableBody").addEventListener("click", async (e) => {
    const t = e.target;
    if (!t || !t.dataset) return;
    if (t.dataset.edit) {
      await openEditApp(t.dataset.edit);
      return;
    }
    if (t.dataset.del) {
      const id = t.dataset.del;
      if (confirm(`Are you sure you want to delete ${id}?`)) {
        await api(`/api/apps/${sanitizeId(id)}`, { method: "DELETE" });
        await refreshApps();
        await refreshStatus();
        renderApps();
        renderAppsTable();
      }
    }
  });

  $("#btnEditBrowseScript").addEventListener("click", async () => {
    try {
      const p = await browseScript();
      $("#edit_script_path").value = p;
      if (!$("#edit_project_root").value.trim()) $("#edit_project_root").value = dirname(p);
    } catch {}
  });
  $("#btnEditBrowseRoot").addEventListener("click", async () => {
    try {
      const p = await browseRoot();
      $("#edit_project_root").value = p;
    } catch {}
  });

  $("#btnEditSave").addEventListener("click", async () => {
    $("#editAppError").classList.add("hidden");
    const appId = state.editing.appId;
    try {
      const payload = {
        name: $("#edit_name").value.trim(),
        script_path: $("#edit_script_path").value.trim(),
        project_root: $("#edit_project_root").value.trim(),
        launch_type: $("#edit_launch_type").value,
      };
      await api(`/api/apps/${sanitizeId(appId)}`, { method: "PUT", body: JSON.stringify(payload) });
      const launchType = payload.launch_type;
      const portVal = parseInt($("#edit_port").value, 10);
      if (launchType === "web" && Number.isFinite(portVal)) {
        await api(`/api/apps/${sanitizeId(appId)}/port`, { method: "PUT", body: JSON.stringify({ port: portVal }) });
      }
      closeModal($("#editAppModal"));
      await refreshApps();
      await refreshStatus();
      renderApps();
      renderAppsTable();
    } catch (e) {
      const msg = String(e?.message || e);
      $("#editAppError").textContent = msg;
      $("#editAppError").classList.remove("hidden");
    }
  });
}

function setupSearch() {
  $("#searchInput").addEventListener("input", (e) => {
    state.filter = e.target.value.trim();
    renderApps();
  });
}

async function tick() {
  await refreshHealth();
  await refreshStatus();
  renderApps();
}

async function main() {
  setupModals();
  setupAddApp();
  setupLogsModalClose();
  setupSearch();
  setupHubLogs();
  setupManageApps();
  setupSettings();
  setupEscapeKey();

  await refreshHubTheme();
  await refreshApps();
  await refreshStatus();
  renderApps();

  setInterval(() => tick().catch(() => {}), 5000);
  tick().catch(() => {});
}

main().catch(() => {});
