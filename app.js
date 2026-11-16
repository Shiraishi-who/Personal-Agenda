"use strict";

const SESSION_KEY = "personal-agenda.account";
const DATA_PREFIX = "personal-agenda.workspace.";
const STATUSES = ["todo", "doing", "done"];
const RECURRENCES = ["none", "daily", "weekly", "monthly"];

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

function dayKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function dateOffset(offset) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return dayKey(date);
}

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function newWorkspace(email) {
  return {
    profile: { email, name: nameFromEmail(email) },
    tasks: [
      { id: "sample-plan", title: "Sketch out the week", project: "Personal", dueDate: dateOffset(0), dueTime: "09:30", priority: "High", status: "doing", notes: "Start with the three things that would make this week feel meaningful.", tags: ["Planning"], subtasks: [], recurrence: "none", createdAt: Date.now() - 300000, updatedAt: Date.now() - 300000, completedAt: "" },
      { id: "sample-walk", title: "Take a proper lunch break", project: "Wellbeing", dueDate: dateOffset(1), dueTime: "12:30", priority: "Low", status: "todo", notes: "Step outside for a little while.", tags: ["Wellbeing"], subtasks: [], recurrence: "none", createdAt: Date.now() - 200000, updatedAt: Date.now() - 200000, completedAt: "" },
      { id: "sample-notes", title: "Gather notes for the idea", project: "Side project", dueDate: dateOffset(3), dueTime: "16:00", priority: "Medium", status: "todo", notes: "", tags: ["Planning"], subtasks: [], recurrence: "none", createdAt: Date.now() - 100000, updatedAt: Date.now() - 100000, completedAt: "" },
      { id: "sample-finish", title: "Close out last week", project: "Personal", dueDate: dateOffset(-1), dueTime: "17:00", priority: "Medium", status: "done", notes: "Nice work getting this over the line.", tags: [], subtasks: [], recurrence: "none", createdAt: Date.now() - 400000, updatedAt: Date.now() - 40000, completedAt: dateOffset(-1) },
    ],
    events: [],
    preferences: { darkMode: false },
  };
}

function nameFromEmail(email) {
  const localPart = email.split("@")[0].replace(/[._-]+/g, " ").trim();
  return localPart.replace(/\b\w/g, (letter) => letter.toUpperCase()) || "Your account";
}

function validWorkspace(value) {
  return value && value.profile && Array.isArray(value.tasks) && Array.isArray(value.events);
}

let account = null;
let state = null;
let activeView = "overview";
let taskFilter = "all";
let selectedTag = "all";
let currentTaskId = null;
let currentEventId = null;
let selectedDetailId = null;
let query = "";
let visibleMonth = new Date();
visibleMonth.setDate(1);
let toastTimer;

function showToast(message, kind = "success") {
  const toast = $("#toast");
  toast.textContent = message;
  toast.dataset.kind = kind;
  toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2800);
}

function accountStorageKey(email) {
  return `${DATA_PREFIX}${encodeURIComponent(email.trim().toLowerCase())}`;
}

function saveWorkspace() {
  try {
    localStorage.setItem(accountStorageKey(account.email), JSON.stringify(state));
    return true;
  } catch (error) {
    showToast("Could not save your workspace. Check this browser's storage settings.", "error");
    return false;
  }
}

function saveChange(change, message) {
  const previous = JSON.parse(JSON.stringify(state));
  change();
  if (!saveWorkspace()) {
    state = previous;
    renderAll();
    return false;
  }
  renderAll();
  if (message) showToast(message);
  return true;
}

function formatDate(value, options = { month: "short", day: "numeric" }) {
  if (!value) return "No date";
  return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, options);
}

function dueLabel(value, status, time = "") {
  const timeLabel = time ? ` · ${formatTime(time)}` : "";
  if (!value) return `No due date${timeLabel}`;
  if (status === "done") return `Completed${time ? ` · deadline ${formatTime(time)}` : ""}`;
  if (value === dayKey(new Date())) return `Due today${timeLabel}`;
  if (value < dayKey(new Date())) return `Overdue · ${formatDate(value)}${timeLabel}`;
  return `Due ${formatDate(value)}${timeLabel}`;
}

function formatTime(value) {
  if (!value) return "";
  const [hours, minutes] = value.split(":").map(Number);
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function statusLabel(status) {
  return status === "doing" ? "In progress" : status === "done" ? "Done" : "To do";
}

function createText(tag, className, value) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (value !== undefined) element.textContent = value;
  return element;
}

function createButton(label, className, attributes = {}) {
  const button = createText("button", className, label);
  button.type = "button";
  Object.entries(attributes).forEach(([name, value]) => button.setAttribute(name, value));
  return button;
}

function taskMatches(task) {
  if (!query) return true;
  const checklist = Array.isArray(task.subtasks) ? task.subtasks.map((item) => item.title).join(" ") : "";
  const tags = Array.isArray(task.tags) ? task.tags.join(" ") : "";
  return `${task.title} ${task.project} ${task.notes} ${task.priority} ${statusLabel(task.status)} ${tags} ${checklist}`
    .toLocaleLowerCase().includes(query);
}

function sortedTasks(tasks) {
  return [...tasks].sort((a, b) => {
    if (a.status === "done" && b.status !== "done") return 1;
    if (b.status === "done" && a.status !== "done") return -1;
    return (a.dueDate || "9999-12-31").localeCompare(b.dueDate || "9999-12-31") ||
        (a.dueTime || "99:99").localeCompare(b.dueTime || "99:99") ||
      b.updatedAt - a.updatedAt;
  });
}

function buildTaskRow(task, compact = false) {
  const row = createText("div", `task-row${task.status === "done" ? " is-done" : ""}`);
  row.dataset.taskId = task.id;

  const check = createButton(task.status === "done" ? "✓" : "", "check-button", {
    "data-task-action": "toggle",
    "aria-label": task.status === "done" ? `Reopen ${task.title}` : `Complete ${task.title}`,
    "aria-pressed": String(task.status === "done"),
  });
  row.append(check);

  const main = createText("div", "task-main");
  main.append(createText("span", "task-name", task.title));
  main.append(createText("span", "task-project", task.project || "Personal"));
  const tags = Array.isArray(task.tags) ? task.tags : [];
  if (tags.length) {
    const tagList = createText("span", "task-tags");
    tags.forEach((tag) => tagList.append(createText("span", "tag-chip", tag)));
    main.append(tagList);
  }
  const checklist = Array.isArray(task.subtasks) ? task.subtasks : [];
  if (checklist.length) {
    const completed = checklist.filter((item) => item.done).length;
    main.append(createText("span", "task-checklist-progress", `Checklist ${completed}/${checklist.length}`));
  }
  row.append(main);

  if (!compact) {
    const due = createText("span", "task-due", dueLabel(task.dueDate, task.status, task.dueTime));
    if (task.status !== "done" && task.dueDate && task.dueDate < dayKey(new Date())) due.classList.add("is-late");
    row.append(due);
    row.append(createText("span", `priority-badge priority-${task.priority.toLowerCase()}`, task.priority));
    const actions = createText("div", "row-actions");
    actions.append(createButton("Details", "small-action", { "data-task-action": "details" }));
    actions.append(createButton("Edit", "small-action", { "data-task-action": "edit" }));
    row.append(actions);
  } else {
    row.append(createText("span", "task-due", dueLabel(task.dueDate, task.status, task.dueTime)));
  }
  return row;
}

function renderHeader() {
  const firstName = (state.profile.name || "Your account").trim().split(/\s+/)[0];
  $("#greeting").textContent = `${new Date().getHours() < 12 ? "Good morning" : new Date().getHours() < 18 ? "Good afternoon" : "Good evening"}, ${firstName}.`;
  $("#today-label").textContent = new Intl.DateTimeFormat(undefined, {
    weekday: "long", month: "long", day: "numeric",
  }).format(new Date()).toUpperCase();
  $("#topbar-date").textContent = new Intl.DateTimeFormat(undefined, {
    weekday: "short", month: "short", day: "numeric",
  }).format(new Date());
  $("#sidebar-name").textContent = state.profile.name || "Your account";
  $("#sidebar-avatar").textContent = firstName.charAt(0).toUpperCase() || "A";
  $("#topbar-avatar").textContent = firstName.charAt(0).toUpperCase() || "A";
  $("#profile-name").value = state.profile.name || "";
  $("#profile-email").value = account.email;
  $("#dark-mode").checked = Boolean(state.preferences.darkMode);
  document.body.dataset.theme = state.preferences.darkMode ? "dark" : "light";
  $("#nav-task-count").textContent = state.tasks.filter((task) => task.status !== "done").length;
}

function renderStats() {
  const today = dayKey(new Date());
  const nextWeek = dateOffset(7);
  const open = state.tasks.filter((task) => task.status !== "done");
  const completedThisWeek = state.tasks.filter((task) =>
    task.status === "done" && task.completedAt && task.completedAt >= dateOffset(-6));
  const upcoming = open.filter((task) => task.dueDate && task.dueDate >= today && task.dueDate <= nextWeek);
  const overdue = open.filter((task) => task.dueDate && task.dueDate < today);

  $("#stat-open").textContent = open.length;
  $("#stat-completed").textContent = completedThisWeek.length;
  $("#stat-upcoming").textContent = upcoming.length;
  $("#stat-overdue").textContent = overdue.length;
}

function renderWeeklyChart(target, countTarget) {
  const chart = $(target);
  chart.replaceChildren();
  const days = Array.from({ length: 7 }, (_, index) => dateOffset(index - 6));
  const counts = days.map((date) => state.tasks.filter((task) =>
    task.status === "done" && task.completedAt === date).length);
  const maximum = Math.max(1, ...counts);

  days.forEach((date, index) => {
    const column = createText("div", "chart-day");
    column.append(createText("span", "chart-count", String(counts[index])));
    const track = createText("div", "chart-track");
    const bar = createText("span", "chart-bar");
    bar.style.height = `${Math.max(3, (counts[index] / maximum) * 100)}%`;
    track.append(bar);
    column.append(track);
    column.append(createText("span", "chart-label", new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { weekday: "short" })));
    chart.append(column);
  });
  const total = counts.reduce((sum, count) => sum + count, 0);
  if (countTarget) $(countTarget).textContent = `${total} ${total === 1 ? "task" : "tasks"} complete`;
  if (target === "#monitor-chart") $("#monitor-week-total").textContent = `${total} COMPLETE`;
}

function renderFocus() {
  const list = $("#focus-list");
  list.replaceChildren();
  const today = dayKey(new Date());
  const focus = sortedTasks(state.tasks.filter((task) =>
    task.status !== "done" && (!task.dueDate || task.dueDate <= dateOffset(7)) && taskMatches(task))).slice(0, 4);
  if (!focus.length) {
    list.append(createText("p", "empty-message", query ? "No tasks match your search." : "A little breathing room. No open tasks right now."));
    return;
  }
  focus.forEach((task) => {
    const item = createText("div", "focus-task");
    item.append(createButton("", "check-button", {
      "data-task-id": task.id, "data-quick-complete": "", "aria-label": `Complete ${task.title}`,
    }));
    const copy = createText("div");
    const title = createText("button", "focus-task-title", task.title);
    title.dataset.openTask = task.id;
    title.type = "button";
    title.style.cssText = "padding:0;border:0;background:none;text-align:left;cursor:pointer";
    copy.append(title);
    copy.append(createText("span", "focus-task-meta", `${task.project || "Personal"} · ${dueLabel(task.dueDate, task.status, task.dueTime)}`));
    item.append(copy);
    list.append(item);
  });
}

function renderRecent() {
  const list = $("#recent-list");
  list.replaceChildren();
  const recent = [...state.tasks].filter(taskMatches).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5);
  if (!recent.length) {
    list.append(createText("p", "empty-message", "No recent tasks yet."));
    return;
  }
  recent.forEach((task) => list.append(buildTaskRow(task, true)));
}

function renderTaskList() {
  const list = $("#task-list");
  list.replaceChildren();
  const priority = $("#priority-filter").value;
  const visible = sortedTasks(state.tasks.filter((task) => {
    const matchesStatus = taskFilter === "all" ||
      (taskFilter === "open" ? task.status !== "done" : task.status === "done");
    const matchesTag = selectedTag === "all" || (Array.isArray(task.tags) && task.tags.includes(selectedTag));
    return matchesStatus && matchesTag && (priority === "all" || task.priority === priority) && taskMatches(task);
  }));
  $("#task-empty").hidden = visible.length > 0;
  visible.forEach((task) => list.append(buildTaskRow(task)));
  $("#filter-all-count").textContent = state.tasks.length;
  $("#filter-open-count").textContent = state.tasks.filter((task) => task.status !== "done").length;
  $("#filter-done-count").textContent = state.tasks.filter((task) => task.status === "done").length;
}

function renderCalendar() {
  const year = visibleMonth.getFullYear();
  const month = visibleMonth.getMonth();
  $("#month-label").textContent = visibleMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const grid = $("#calendar-grid");
  grid.replaceChildren();
  const first = new Date(year, month, 1);
  const firstCell = new Date(year, month, 1 - first.getDay());
  const today = dayKey(new Date());

  for (let index = 0; index < 42; index += 1) {
    const date = new Date(firstCell);
    date.setDate(firstCell.getDate() + index);
    const key = dayKey(date);
    const cell = createText("div", "calendar-day");
    if (date.getMonth() !== month) cell.classList.add("is-outside");
    if (key === today) cell.classList.add("is-today");
    const number = createButton(String(date.getDate()), "calendar-day-number", {
      "data-calendar-date": key,
      "aria-label": `Add a plan on ${date.toLocaleDateString()}`,
    });
    cell.append(number);
    const items = createText("div", "calendar-items");
    const events = state.events.filter((event) => event.date === key);
    const tasks = state.tasks.filter((task) => task.dueDate === key);
    const combined = [
      ...events.map((event) => ({ kind: "plan", id: event.id, title: event.title, time: event.time })),
      ...tasks.map((task) => ({ kind: "task", id: task.id, title: task.title, time: task.dueTime, status: task.status })),
    ].sort((a, b) => (a.time || "99:99").localeCompare(b.time || "99:99"));
    combined.slice(0, 3).forEach((item) => {
      if (item.kind === "plan") {
        items.append(createButton(`${item.time ? `${formatTime(item.time)} ` : ""}${item.title}`, "calendar-item plan", {
          "data-event-id": item.id, title: item.title,
        }));
      } else {
        const label = createText("span", `calendar-item${item.status === "done" ? " is-done" : ""}`, `${item.time ? `${formatTime(item.time)} ` : ""}${item.title}`);
        label.title = `${item.title}${item.time ? ` · ${formatTime(item.time)}` : ""}`;
        label.dataset.openTask = item.id;
        items.append(label);
      }
    });
    if (combined.length > 3) items.append(createText("span", "calendar-more", `+${combined.length - 3} more`));
    cell.append(items);
    grid.append(cell);
  }
}

function renderUpcoming() {
  const list = $("#upcoming-list");
  list.replaceChildren();
  const today = dayKey(new Date());
  const entries = [
    ...state.tasks.filter((task) => task.status !== "done" && task.dueDate >= today)
      .map((task) => ({ title: task.title, date: task.dueDate, time: task.dueTime || "", note: `Task · ${task.project || "Personal"}${task.dueTime ? ` · ${formatTime(task.dueTime)}` : ""}` })),
    ...state.events.filter((event) => event.date >= today)
      .map((event) => ({ title: event.title, date: event.date, time: event.time || "", note: event.time ? `Plan · ${formatTime(event.time)}` : "Plan" })),
  ].sort((a, b) => a.date.localeCompare(b.date) || (a.time || "99:99").localeCompare(b.time || "99:99")).slice(0, 6);
  if (!entries.length) {
    list.append(createText("p", "empty-message", "No upcoming plans yet. Add something to your calendar when you’re ready."));
    return;
  }
  entries.forEach((entry) => {
    const item = createText("div", "upcoming-item");
    const date = new Date(`${entry.date}T00:00:00`);
    const badge = createText("div", "upcoming-date");
    badge.append(createText("strong", "", String(date.getDate())));
    badge.append(createText("small", "", date.toLocaleDateString(undefined, { month: "short" })));
    item.append(badge);
    const copy = createText("div", "upcoming-copy");
    copy.append(createText("strong", "", entry.title));
    copy.append(createText("small", "", entry.note));
    item.append(copy);
    list.append(item);
  });
}

function renderBoard() {
  const columns = [
    { status: "todo", list: "#board-todo", count: "#count-todo" },
    { status: "doing", list: "#board-doing", count: "#count-doing" },
    { status: "done", list: "#board-done", count: "#count-done" },
  ];
  columns.forEach(({ status, list: selector, count }) => {
    const list = $(selector);
    list.replaceChildren();
    const tasks = sortedTasks(state.tasks.filter((task) => task.status === status && taskMatches(task)));
    $(count).textContent = tasks.length;
    if (!tasks.length) {
      list.append(createText("p", "board-empty", "Drop a task here"));
      return;
    }
    tasks.forEach((task) => {
      const card = createText("article", "board-card");
      card.draggable = true;
      card.dataset.boardTask = task.id;
      const title = createText("button", "board-card-title", task.title);
      title.type = "button";
      title.dataset.openTask = task.id;
      title.style.cssText = "padding:0;border:0;background:none;text-align:left;cursor:pointer";
      card.append(title);
      const meta = createText("div", "board-card-meta");
      meta.append(createText("span", "", task.project || "Personal"));
      meta.append(createText("span", "", `${task.dueDate ? formatDate(task.dueDate) : "No date"}${task.dueTime ? ` · ${formatTime(task.dueTime)}` : ""}`));
      card.append(meta);
      list.append(card);
    });
  });
}

function renderMonitoring() {
  const total = state.tasks.length;
  const done = state.tasks.filter((task) => task.status === "done").length;
  $("#monitor-done").textContent = done;
  $("#monitor-open").textContent = total - done;
  $("#monitor-rate").textContent = `${total ? Math.round((done / total) * 100) : 0}%`;
  renderWeeklyChart("#monitor-chart");
  const list = $("#activity-list");
  list.replaceChildren();
  const recent = [...state.tasks].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8);
  if (!recent.length) list.append(createText("p", "empty-message", "Your recent activity will show up here."));
  recent.forEach((task) => list.append(buildTaskRow(task, true)));
}

function renderAll() {
  renderHeader();
  renderStats();
  renderWeeklyChart("#weekly-chart", "#weekly-total");
  renderFocus();
  renderRecent();
  renderTagFilter();
  renderTaskList();
  renderCalendar();
  renderUpcoming();
  renderBoard();
  renderMonitoring();
}

function renderTagFilter() {
  const select = $("#tag-filter");
  if (!select) return;
  const tags = [...new Set(state.tasks.flatMap((task) => Array.isArray(task.tags) ? task.tags : []))]
    .sort((a, b) => a.localeCompare(b));
  if (selectedTag !== "all" && !tags.includes(selectedTag)) selectedTag = "all";
  select.replaceChildren(new Option("All tags", "all"));
  tags.forEach((tag) => select.append(new Option(tag, tag)));
  select.value = selectedTag;
}

function setView(view) {
  if (!$(`[data-panel="${view}"]`)) return;
  activeView = view;
  $$("[data-panel]").forEach((panel) => {
    const active = panel.dataset.panel === view;
    panel.hidden = !active;
    panel.classList.toggle("is-visible", active);
  });
  $$(".nav-item[data-view]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === view);
  });
}

function showWorkspace() {
  $("#login-screen").hidden = true;
  $("#app-shell").hidden = false;
  renderAll();
  setView(activeView);
}

function openTaskDialog(taskId = null) {
  const task = taskId ? state.tasks.find((item) => item.id === taskId) : null;
  currentTaskId = task ? task.id : null;
  const form = $("#task-form");
  form.reset();
  $("#task-title").value = task ? task.title : "";
  $("#task-project").value = task ? task.project || "" : "";
  $("#task-date").value = task ? task.dueDate || "" : "";
  $("#task-time").value = task ? task.dueTime || "" : "";
  $("#task-priority").value = task ? task.priority : "Medium";
  $("#task-status").value = task ? task.status : "todo";
  $("#task-tags").value = task && Array.isArray(task.tags) ? task.tags.join(", ") : "";
  $("#task-recurrence").value = task && RECURRENCES.includes(task.recurrence) ? task.recurrence : "none";
  $("#task-subtasks").value = task && Array.isArray(task.subtasks)
    ? task.subtasks.map((item) => item.title).join("\n") : "";
  $("#task-notes").value = task ? task.notes || "" : "";
  $("#task-dialog-title").textContent = task ? "Edit task" : "New task";
  $("#task-dialog").showModal();
  $("#task-title").focus();
}

function openEventDialog(date = dayKey(new Date()), eventId = null) {
  const event = eventId ? state.events.find((item) => item.id === eventId) : null;
  currentEventId = event ? event.id : null;
  const form = $("#event-form");
  form.reset();
  $("#event-title").value = event ? event.title : "";
  $("#event-date").value = event ? event.date : date;
  $("#event-time").value = event ? event.time || "" : "";
  $("#event-note").value = event ? event.note || "" : "";
  $("#event-dialog").querySelector("h2").textContent = event ? "Edit plan" : "Add a plan";
  $("#event-dialog").showModal();
  $("#event-title").focus();
}

function openTaskDetails(taskId) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) return;
  selectedDetailId = task.id;
  renderTaskDetails(task);
  $("#detail-dialog").showModal();
}

function renderTaskDetails(task) {
  $("#detail-title").textContent = task.title;
  const body = $("#detail-body");
  body.replaceChildren();
  const meta = createText("div", "detail-meta");
  meta.append(createText("span", "priority-badge", task.priority));
  meta.append(createText("span", "status-badge", statusLabel(task.status)));
  meta.append(createText("span", "status-badge", task.project || "Personal"));
  if (task.recurrence && task.recurrence !== "none") {
    const labels = { daily: "Repeats daily", weekly: "Repeats weekly", monthly: "Repeats monthly" };
    meta.append(createText("span", "status-badge", labels[task.recurrence]));
  }
  (Array.isArray(task.tags) ? task.tags : []).forEach((tag) => {
    meta.append(createText("span", "tag-chip", tag));
  });
  body.append(meta);
  body.append(createText("p", "detail-description" + (task.notes ? "" : " detail-empty"), task.notes || "No extra task info yet."));
  body.append(createText("span", "task-due", dueLabel(task.dueDate, task.status, task.dueTime)));
  const subtasks = Array.isArray(task.subtasks) ? task.subtasks : [];
  if (subtasks.length) {
    const checklist = createText("section", "detail-checklist");
    const completed = subtasks.filter((item) => item.done).length;
    checklist.append(createText("h3", "", `Checklist · ${completed}/${subtasks.length}`));
    subtasks.forEach((item) => {
      const label = createText("label", `detail-checklist-item${item.done ? " is-checked" : ""}`);
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = Boolean(item.done);
      checkbox.dataset.subtaskToggle = item.id;
      checkbox.dataset.taskId = task.id;
      checkbox.setAttribute("aria-label", `${item.done ? "Uncheck" : "Complete"} ${item.title}`);
      label.append(checkbox, createText("span", "", item.title));
      checklist.append(label);
    });
    body.append(checklist);
  }
}

function nextRecurrenceDate(task) {
  const date = task.dueDate ? new Date(`${task.dueDate}T12:00:00`) : new Date();
  if (task.recurrence === "daily") date.setDate(date.getDate() + 1);
  else if (task.recurrence === "weekly") date.setDate(date.getDate() + 7);
  else if (task.recurrence === "monthly") {
    const desiredDay = date.getDate();
    date.setDate(1);
    date.setMonth(date.getMonth() + 1);
    const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    date.setDate(Math.min(desiredDay, lastDay));
  }
  return dayKey(date);
}

function scheduleNextOccurrence(task) {
  if (!RECURRENCES.includes(task.recurrence) || task.recurrence === "none" || !task.dueDate || !task.dueTime) return false;
  if (state.tasks.some((item) => item.recurringFromId === task.id)) return false;
  const nextTask = {
    ...task,
    id: makeId("task"),
    dueDate: nextRecurrenceDate(task),
    status: "todo",
    subtasks: (task.subtasks || []).map((item) => ({ ...item, id: makeId("check"), done: false })),
    recurringFromId: task.id,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    completedAt: "",
  };
  state.tasks.unshift(nextTask);
  return true;
}

function updateTaskStatus(taskId, status) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task || !STATUSES.includes(status) || task.status === status) return;
  saveChange(() => {
    task.status = status;
    task.updatedAt = Date.now();
    task.completedAt = status === "done" ? dayKey(new Date()) : "";
    if (status === "done") scheduleNextOccurrence(task);
  }, status === "done" ? "Task completed. Take a moment to enjoy that." : `Task moved to ${statusLabel(status).toLowerCase()}.`);
}

function handleTaskAction(button) {
  const row = button.closest("[data-task-id]");
  const taskId = row && row.dataset.taskId;
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) return;
  const action = button.dataset.taskAction;
  if (action === "toggle") updateTaskStatus(task.id, task.status === "done" ? "todo" : "done");
  if (action === "details") openTaskDetails(task.id);
  if (action === "edit") openTaskDialog(task.id);
}

function deleteTask(taskId) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task || !window.confirm(`Delete "${task.title}"?`)) return;
  if (saveChange(() => {
    state.tasks = state.tasks.filter((item) => item.id !== taskId);
  }, "Task deleted.")) {
    $("#detail-dialog").close();
    selectedDetailId = null;
  }
}

function validBackupTask(task) {
  if (!task || typeof task !== "object") return false;
  const dateValid = task.dueDate === "" || validDate(task.dueDate);
  const timeValid = task.dueTime === "" || (typeof task.dueTime === "string" &&
    /^\d{2}:\d{2}$/.test(task.dueTime) && task.dueTime >= "00:00" && task.dueTime <= "23:59");
  return typeof task.id === "string" && typeof task.title === "string" &&
    task.title.length > 0 && task.title.length <= 120 &&
    typeof task.project === "string" && task.project.length <= 60 &&
    typeof task.notes === "string" && task.notes.length <= 600 &&
    typeof task.dueDate === "string" && typeof task.dueTime === "string" &&
    dateValid && timeValid && STATUSES.includes(task.status) &&
    ["High", "Medium", "Low"].includes(task.priority) &&
    RECURRENCES.includes(task.recurrence) &&
    (task.recurrence === "none" || (dateValid && task.dueDate && timeValid && task.dueTime)) &&
    Array.isArray(task.tags) && task.tags.length <= 10 &&
    task.tags.every((tag) => typeof tag === "string" && tag.trim() && tag.length <= 30) &&
    Array.isArray(task.subtasks) && task.subtasks.length <= 30 &&
    task.subtasks.every((item) => item && typeof item.id === "string" &&
      typeof item.title === "string" && item.title.trim() && typeof item.done === "boolean");
}

function parseBackup(value) {
  if (!value || value.format !== "personal-agenda" || value.version !== 1 ||
      !value.workspace || typeof value.workspace !== "object") {
    throw new Error("This file is not a supported Personal Agenda backup.");
  }
  const imported = value.workspace;
  if (!imported.profile || typeof imported.profile.name !== "string" ||
      imported.profile.name.length > 60 || !Array.isArray(imported.tasks) ||
      imported.tasks.length > 1000 || !Array.isArray(imported.events) ||
      imported.events.length > 1000 || !imported.preferences ||
      typeof imported.preferences.darkMode !== "boolean" ||
      !imported.tasks.every(validBackupTask)) {
    throw new Error("The backup contains invalid or unsupported workspace data.");
  }
  const validEvents = imported.events.every((item) => item &&
    typeof item.id === "string" && typeof item.title === "string" &&
    typeof item.date === "string" && validDate(item.date) &&
    (item.time === "" || (/^\d{2}:\d{2}$/.test(item.time) && item.time >= "00:00" && item.time <= "23:59")) &&
    typeof item.note === "string");
  if (!validEvents) throw new Error("The backup contains an invalid calendar plan.");
  if (new Set(imported.tasks.map((task) => task.id)).size !== imported.tasks.length ||
      new Set(imported.events.map((item) => item.id)).size !== imported.events.length) {
    throw new Error("The backup contains duplicate workspace record IDs.");
  }
  return {
    profile: { email: account.email, name: imported.profile.name },
    tasks: imported.tasks,
    events: imported.events,
    preferences: { darkMode: imported.preferences.darkMode },
  };
}

function exportBackup() {
  const backup = {
    format: "personal-agenda",
    version: 1,
    exportedAt: new Date().toISOString(),
    workspace: state,
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = createText("a");
  link.href = url;
  link.download = `personal-agenda-${dayKey(new Date())}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast("Workspace backup downloaded.");
}

function importBackup(file) {
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) {
    showToast("Choose a backup file smaller than 2 MB.", "error");
    return;
  }
  const reader = new FileReader();
  reader.onerror = () => showToast("Could not read the backup file.", "error");
  reader.onload = () => {
    let imported;
    try {
      imported = parseBackup(JSON.parse(String(reader.result)));
    } catch (error) {
      showToast(error instanceof Error ? error.message : "The backup file could not be validated.", "error");
      return;
    }
    if (!window.confirm("Import this backup and replace the current workspace? This cannot be undone.")) return;
    const previous = state;
    state = imported;
    if (!saveWorkspace()) {
      state = previous;
      renderAll();
      return;
    }
    renderAll();
    showToast("Workspace backup restored.");
  };
  reader.readAsText(file);
}

function loadWorkspace(email) {
  account = { email };
  const saved = localStorage.getItem(accountStorageKey(email));
  if (saved) {
    const parsed = JSON.parse(saved);
    if (!validWorkspace(parsed)) throw new Error("This workspace has an invalid format.");
    state = parsed;
  } else {
    state = newWorkspace(email);
  }
  if (!state.profile || typeof state.profile !== "object") state.profile = { email, name: nameFromEmail(email) };
  if (typeof state.profile.name !== "string") state.profile.name = nameFromEmail(email);
  if (!Array.isArray(state.events)) state.events = [];
  if (!Array.isArray(state.tasks)) state.tasks = [];
  if (!state.preferences || typeof state.preferences !== "object") state.preferences = { darkMode: false };
  state.tasks = state.tasks.filter((task) => task && typeof task.id === "string" && typeof task.title === "string")
    .map((task) => ({
      ...task,
      project: typeof task.project === "string" ? task.project : "",
      dueDate: typeof task.dueDate === "string" ? task.dueDate : "",
      dueTime: typeof task.dueTime === "string" && /^\d{2}:\d{2}$/.test(task.dueTime) &&
        task.dueTime >= "00:00" && task.dueTime <= "23:59" ? task.dueTime : "",
      notes: typeof task.notes === "string" ? task.notes : "",
      priority: ["High", "Medium", "Low"].includes(task.priority) ? task.priority : "Medium",
      status: STATUSES.includes(task.status) ? task.status : "todo",
      tags: Array.isArray(task.tags) ? task.tags.filter((tag) => typeof tag === "string").slice(0, 10) : [],
      subtasks: Array.isArray(task.subtasks) ? task.subtasks
        .filter((item) => item && typeof item.title === "string")
        .slice(0, 30)
        .map((item) => ({ id: typeof item.id === "string" ? item.id : makeId("check"), title: item.title, done: Boolean(item.done) })) : [],
      recurrence: RECURRENCES.includes(task.recurrence) ? task.recurrence : "none",
      createdAt: typeof task.createdAt === "number" ? task.createdAt : Date.now(),
      updatedAt: typeof task.updatedAt === "number" ? task.updatedAt : Date.now(),
      completedAt: typeof task.completedAt === "string" ? task.completedAt : "",
    }));
  state.profile.email = email;
  if (!state.profile.name) state.profile.name = nameFromEmail(email);
}

function signOut() {
  if (!window.confirm("Sign out of this local workspace?")) return;
  try {
    sessionStorage.removeItem(SESSION_KEY);
    account = null;
    state = null;
    $("#app-shell").hidden = true;
    $("#login-screen").hidden = false;
    document.body.dataset.theme = "light";
    $("#login-password").value = "";
    $("#login-error").hidden = true;
    $("#global-search").value = "";
    query = "";
    taskFilter = "all";
    selectedTag = "all";
    activeView = "overview";
  } catch (error) {
    showToast("Could not sign out. Check browser storage settings.", "error");
  }
}

$("#login-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const email = $("#login-email").value.trim().toLowerCase();
  const error = $("#login-error");
  error.hidden = true;
  try {
    loadWorkspace(email);
    sessionStorage.setItem(SESSION_KEY, email);
    showWorkspace();
  } catch (storageError) {
    account = null;
    state = null;
    error.textContent = "Could not open this local workspace. Check your browser storage and try again.";
    error.hidden = false;
  }
});

document.addEventListener("click", (event) => {
  const viewButton = event.target.closest("[data-view]");
  if (viewButton) {
    setView(viewButton.dataset.view);
    return;
  }

  const actionButton = event.target.closest("[data-action]");
  if (actionButton) {
    if (actionButton.dataset.action === "new-task") openTaskDialog();
    if (actionButton.dataset.action === "new-event") openEventDialog();
    if (actionButton.dataset.action === "today") setView("calendar");
    return;
  }

  const closeButton = event.target.closest("[data-close]");
  if (closeButton) {
    closeButton.closest("dialog").close();
    return;
  }

  const calendarDate = event.target.closest("[data-calendar-date]");
  if (calendarDate) {
    openEventDialog(calendarDate.dataset.calendarDate);
    return;
  }

  const eventButton = event.target.closest("[data-event-id]");
  if (eventButton) {
    openEventDialog(undefined, eventButton.dataset.eventId);
    return;
  }

  const openTask = event.target.closest("[data-open-task]");
  if (openTask) {
    openTaskDetails(openTask.dataset.openTask);
    return;
  }

  const quickComplete = event.target.closest("[data-quick-complete]");
  if (quickComplete) {
    updateTaskStatus(quickComplete.dataset.taskId, "done");
    return;
  }

  const taskAction = event.target.closest("[data-task-action]");
  if (taskAction) {
    handleTaskAction(taskAction);
    return;
  }

  if (event.target.closest("#sidebar-account") || event.target.closest("#settings-signout")) signOut();
  if (event.target.closest("#topbar-avatar")) setView("settings");
  if (event.target.closest("#detail-edit")) {
    const id = selectedDetailId;
    $("#detail-dialog").close();
    openTaskDialog(id);
  }
  if (event.target.closest("#detail-delete")) deleteTask(selectedDetailId);
});

document.addEventListener("change", (event) => {
  const checkbox = event.target.closest("[data-subtask-toggle]");
  if (!checkbox) return;
  const task = state.tasks.find((item) => item.id === checkbox.dataset.taskId);
  const subtask = task && Array.isArray(task.subtasks)
    ? task.subtasks.find((item) => item.id === checkbox.dataset.subtaskToggle) : null;
  if (!task || !subtask) return;
  saveChange(() => {
    subtask.done = checkbox.checked;
    task.updatedAt = Date.now();
  }, "Checklist updated.");
  if ($("#detail-dialog").open) {
    const currentTask = state.tasks.find((item) => item.id === checkbox.dataset.taskId);
    if (currentTask) renderTaskDetails(currentTask);
  }
});

$("#task-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!event.currentTarget.reportValidity()) return;
  const form = new FormData(event.currentTarget);
  const values = {
    title: String(form.get("title")).trim(),
    project: String(form.get("project") || "").trim(),
    dueDate: String(form.get("dueDate") || ""),
    dueTime: String(form.get("dueTime") || ""),
    priority: String(form.get("priority") || "Medium"),
    status: String(form.get("status") || "todo"),
    tags: [...new Map(String(form.get("tags") || "").split(",")
      .map((tag) => tag.trim()).filter(Boolean).map((tag) => [tag.toLocaleLowerCase(), tag])).values()],
    recurrence: String(form.get("recurrence") || "none"),
    subtasks: String(form.get("subtasks") || "").split(/\r?\n/)
      .map((title) => title.trim()).filter(Boolean)
      .filter((title, index, list) => list.findIndex((other) => other.toLocaleLowerCase() === title.toLocaleLowerCase()) === index)
      .map((title) => ({ id: makeId("check"), title, done: false })),
    notes: String(form.get("notes") || "").trim(),
  };
  if (!values.title) return;
  if (values.tags.length > 10) {
    showToast("Add no more than 10 tags to a task.", "error");
    return;
  }
  if (values.tags.some((tag) => tag.length > 30)) {
    showToast("Keep each task tag to 30 characters or fewer.", "error");
    return;
  }
  if (values.subtasks.length > 30) {
    showToast("Add no more than 30 checklist items to a task.", "error");
    return;
  }
  if (!RECURRENCES.includes(values.recurrence)) {
    showToast("Choose a valid repeat interval.", "error");
    return;
  }
  if (values.recurrence !== "none" && (!values.dueDate || !values.dueTime)) {
    showToast("Repeating tasks need a deadline date and time.", "error");
    return;
  }
  if (values.dueTime && !values.dueDate) {
    showToast("Choose a deadline date when adding a deadline time.", "error");
    return;
  }
  if (values.dueDate && !values.dueTime) {
    showToast("Add a deadline time when setting a deadline date.", "error");
    return;
  }
  const task = state.tasks.find((item) => item.id === currentTaskId);
  if (task) {
    const previousSubtasks = Array.isArray(task.subtasks) ? task.subtasks : [];
    values.subtasks = values.subtasks.map((item) => {
      const previous = previousSubtasks.find((old) => old.title.toLocaleLowerCase() === item.title.toLocaleLowerCase());
      return previous ? { ...item, id: previous.id, done: Boolean(previous.done) } : item;
    });
  }
  let saved;
  if (task) {
    saved = saveChange(() => {
      const shouldSchedule = task.status !== "done" && values.status === "done";
      Object.assign(task, values, {
        updatedAt: Date.now(),
        completedAt: values.status === "done" ? task.completedAt || dayKey(new Date()) : "",
      });
      if (shouldSchedule) scheduleNextOccurrence(task);
    }, "Task details saved.");
  } else {
    const newTask = {
      id: makeId("task"), ...values, createdAt: Date.now(), updatedAt: Date.now(),
      completedAt: values.status === "done" ? dayKey(new Date()) : "",
    };
    saved = saveChange(() => {
      state.tasks.unshift(newTask);
      if (newTask.status === "done") scheduleNextOccurrence(newTask);
    }, "A new task is on your list.");
  }
  if (saved) {
    $("#task-dialog").close();
    currentTaskId = null;
  }
});

$("#event-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!event.currentTarget.reportValidity()) return;
  const form = new FormData(event.currentTarget);
  const values = {
    title: String(form.get("title")).trim(),
    date: String(form.get("date")),
    time: String(form.get("time") || ""),
    note: String(form.get("note") || "").trim(),
  };
  const existing = state.events.find((item) => item.id === currentEventId);
  const saved = existing
    ? saveChange(() => Object.assign(existing, values), "Plan updated.")
    : saveChange(() => state.events.push({ id: makeId("event"), ...values }), "Plan added to your calendar.");
  if (saved) {
    $("#event-dialog").close();
    currentEventId = null;
  }
});

$("#settings-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const previousName = state.profile.name;
  state.profile.name = $("#profile-name").value.trim();
  if (!state.profile.name || !saveWorkspace()) {
    state.profile.name = previousName;
    renderHeader();
    return;
  }
  renderHeader();
  showToast("Your profile is up to date.");
});

$("#dark-mode").addEventListener("change", (event) => {
  const previous = state.preferences.darkMode;
  state.preferences.darkMode = event.currentTarget.checked;
  if (!saveWorkspace()) {
    state.preferences.darkMode = previous;
    renderHeader();
    return;
  }
  renderHeader();
  showToast(state.preferences.darkMode ? "Dark appearance is on." : "Light appearance is on.");
});

$("#reset-data").addEventListener("click", () => {
  if (!window.confirm("Restore the sample tasks for this account? This replaces its current tasks and plans.")) return;
  const previousName = state.profile.name;
  const fresh = newWorkspace(account.email);
  fresh.profile.name = previousName;
  const previous = state;
  state = fresh;
  if (!saveWorkspace()) state = previous;
  else showToast("Sample tasks restored.");
  renderAll();
});

$("#priority-filter").addEventListener("change", renderTaskList);
$("#tag-filter").addEventListener("change", (event) => {
  selectedTag = event.currentTarget.value;
  renderTaskList();
});
$("[data-panel='settings'] #export-data").addEventListener("click", exportBackup);
$("#import-data").addEventListener("click", () => $("#import-file").click());
$("#import-file").addEventListener("change", (event) => {
  importBackup(event.currentTarget.files[0]);
  event.currentTarget.value = "";
});
$$("[data-filter]").forEach((button) => {
  button.addEventListener("click", () => {
    taskFilter = button.dataset.filter;
    $$("[data-filter]").forEach((item) => item.classList.toggle("is-selected", item === button));
    renderTaskList();
  });
});

$("#global-search").addEventListener("input", (event) => {
  query = event.currentTarget.value.trim().toLocaleLowerCase();
  renderFocus();
  renderRecent();
  renderTaskList();
  renderBoard();
});

$("#month-prev").addEventListener("click", () => {
  visibleMonth.setMonth(visibleMonth.getMonth() - 1);
  renderCalendar();
});
$("#month-next").addEventListener("click", () => {
  visibleMonth.setMonth(visibleMonth.getMonth() + 1);
  renderCalendar();
});
$("#month-today").addEventListener("click", () => {
  visibleMonth = new Date();
  visibleMonth.setDate(1);
  renderCalendar();
});
document.addEventListener("dragstart", (event) => {
  const card = event.target.closest("[data-board-task]");
  if (!card) return;
  event.dataTransfer.setData("text/plain", card.dataset.boardTask);
  event.dataTransfer.effectAllowed = "move";
});
$$(".board-column").forEach((column) => {
  column.addEventListener("dragover", (event) => {
    event.preventDefault();
    column.classList.add("is-drop-target");
  });
  column.addEventListener("dragleave", (event) => {
    if (!column.contains(event.relatedTarget)) column.classList.remove("is-drop-target");
  });
  column.addEventListener("drop", (event) => {
    event.preventDefault();
    column.classList.remove("is-drop-target");
    updateTaskStatus(event.dataTransfer.getData("text/plain"), column.dataset.status);
  });
});
document.addEventListener("dragend", () => $$(".board-column").forEach((column) => column.classList.remove("is-drop-target")));

document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    $("#global-search").focus();
  }
  if (event.key === "Escape") {
    $$("dialog[open]").forEach((dialog) => dialog.close());
    currentTaskId = null;
    currentEventId = null;
  }
});

$$("dialog").forEach((dialog) => {
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener("close", () => {
    if (dialog.id === "task-dialog") currentTaskId = null;
    if (dialog.id === "event-dialog") currentEventId = null;
  });
});

function restoreSession() {
  try {
    const savedEmail = sessionStorage.getItem(SESSION_KEY);
    if (!savedEmail) return;
    loadWorkspace(savedEmail);
    showWorkspace();
  } catch (error) {
    sessionStorage.removeItem(SESSION_KEY);
    showToast("Your saved workspace could not be opened. Please sign in again.", "error");
  }
}

restoreSession();
