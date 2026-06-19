const DEFAULT_LIMITS = {
  maxRegularDays: 8,
  maxTotalDays: 14,
};

const DEMO_PILOTS = [
  { id: "pilot-a", name: "Pilot A", initials: "A", color: "#2f6fb3" },
  { id: "pilot-b", name: "Pilot B", initials: "B", color: "#2f7d5b" },
  { id: "pilot-c", name: "Pilot C", initials: "C", color: "#b36b20" },
];

const DEMO_PINS = {
  1111: "pilot-a",
  2222: "pilot-b",
  3333: "pilot-c",
};

const DEMO_STORAGE_KEY = "prismjetScheduleDemoRequests";
const SESSION_STORAGE_KEY = "prismjetScheduleLastPilot";
const API_TIMEOUT_MS = 12000;

const REQUEST_TYPE_META = {
  regular: {
    label: "OFF",
    fullLabel: "Regular day off",
  },
  pto: {
    label: "PTO",
    fullLabel: "PTO",
  },
};

const PRIORITY_META = {
  high: {
    label: "H",
    fullLabel: "High",
  },
  medium: {
    label: "M",
    fullLabel: "Medium",
  },
  low: {
    label: "L",
    fullLabel: "Low",
  },
};

const state = {
  apiUrl: getConfiguredApiUrl(),
  mode: "demo",
  limits: { ...DEFAULT_LIMITS },
  pilots: DEMO_PILOTS,
  session: null,
  requests: [],
  selectedMonth: getNextMonthKey(),
  draft: new Map(),
  currentType: "regular",
  currentPriority: "high",
};

const elements = {
  modeBanner: document.querySelector("#schedule-mode-banner"),
  sessionSummary: document.querySelector("#session-summary"),
  loginPanel: document.querySelector("#login-panel"),
  loginForm: document.querySelector("#login-form"),
  pilotPin: document.querySelector("#pilot-pin"),
  authMessage: document.querySelector("#auth-message"),
  scheduleApp: document.querySelector("#schedule-app"),
  refreshButton: document.querySelector("#refresh-schedule-button"),
  signOutButton: document.querySelector("#sign-out-button"),
  regularCount: document.querySelector("#regular-count"),
  totalCount: document.querySelector("#total-count"),
  monthRequestCount: document.querySelector("#month-request-count"),
  monthRequestCaption: document.querySelector("#month-request-caption"),
  monthHeading: document.querySelector("#month-heading"),
  calendarHeading: document.querySelector("#calendar-heading"),
  calendarCaption: document.querySelector("#calendar-caption"),
  bidMonth: document.querySelector("#bid-month"),
  previousMonthButton: document.querySelector("#previous-month-button"),
  nextMonthButton: document.querySelector("#next-month-button"),
  requestTypePicker: document.querySelector("#request-type-picker"),
  priorityPicker: document.querySelector("#priority-picker"),
  calendarGrid: document.querySelector("#calendar-grid"),
  draftCaption: document.querySelector("#draft-caption"),
  draftList: document.querySelector("#draft-list"),
  clearDraftButton: document.querySelector("#clear-draft-button"),
  requestNotes: document.querySelector("#request-notes"),
  submitRequestButton: document.querySelector("#submit-request-button"),
  scheduleMessage: document.querySelector("#schedule-message"),
  monthListCaption: document.querySelector("#month-list-caption"),
  monthRequestList: document.querySelector("#month-request-list"),
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

async function init() {
  state.mode = state.apiUrl ? "shared" : "demo";
  elements.bidMonth.value = state.selectedMonth;
  bindEvents();
  renderModeBanner();
  await loadConfig();
  restoreLastPilotHint();
  renderAll();
  registerServiceWorker();
}

function bindEvents() {
  elements.loginForm.addEventListener("submit", handleLogin);
  elements.signOutButton.addEventListener("click", signOut);
  elements.refreshButton.addEventListener("click", refreshRequests);
  elements.bidMonth.addEventListener("change", handleMonthInput);
  elements.previousMonthButton.addEventListener("click", () => moveMonth(-1));
  elements.nextMonthButton.addEventListener("click", () => moveMonth(1));
  elements.requestTypePicker.addEventListener("change", handlePickerChange);
  elements.priorityPicker.addEventListener("change", handlePickerChange);
  elements.calendarGrid.addEventListener("click", handleCalendarClick);
  elements.draftList.addEventListener("change", handleDraftChange);
  elements.draftList.addEventListener("click", handleDraftClick);
  elements.monthRequestList.addEventListener("click", handleMonthRequestClick);
  elements.clearDraftButton.addEventListener("click", clearDraft);
  elements.submitRequestButton.addEventListener("click", submitDraft);
}

async function loadConfig() {
  try {
    const response = await callApi("config");
    if (!response.ok) {
      throw new Error(response.error || "Schedule configuration could not be loaded.");
    }

    state.pilots = normalizePilots(response.pilots);
    state.limits = {
      maxRegularDays: Number(response.limits?.maxRegularDays || DEFAULT_LIMITS.maxRegularDays),
      maxTotalDays: Number(response.limits?.maxTotalDays || DEFAULT_LIMITS.maxTotalDays),
    };
  } catch (error) {
    console.error(error);
    showMessage(elements.authMessage, "Schedule setup could not load. Demo mode is available on this device.", "error");
    state.mode = "demo";
    state.apiUrl = "";
    state.pilots = DEMO_PILOTS;
    state.limits = { ...DEFAULT_LIMITS };
    renderModeBanner();
  }
}

async function handleLogin(event) {
  event.preventDefault();
  const pin = elements.pilotPin.value.trim();

  if (!pin) {
    showMessage(elements.authMessage, "Enter your PIN.", "error");
    elements.pilotPin.focus();
    return;
  }

  setBusy(true);
  showMessage(elements.authMessage, "Opening schedule...", "muted");

  try {
    const response = await callApi("login", { pin });
    if (!response.ok) {
      throw new Error(response.error || "PIN was not recognized.");
    }

    state.session = {
      pin,
      pilot: normalizePilot(response.pilot),
    };
    state.requests = normalizeRequests(response.requests);
    state.draft.clear();
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, state.session.pilot.name);
    elements.pilotPin.value = "";
    showMessage(elements.authMessage, "", "muted");
    renderAll();
  } catch (error) {
    console.error(error);
    showMessage(elements.authMessage, error.message || "PIN was not recognized.", "error");
  } finally {
    setBusy(false);
  }
}

function signOut() {
  state.session = null;
  state.draft.clear();
  elements.requestNotes.value = "";
  showMessage(elements.scheduleMessage, "", "muted");
  renderAll();
  elements.pilotPin.focus();
}

async function refreshRequests() {
  if (!state.session) {
    return;
  }

  setBusy(true);
  showMessage(elements.scheduleMessage, "Refreshing calendar...", "muted");

  try {
    const response = await callApi("requests", { pin: state.session.pin });
    if (!response.ok) {
      throw new Error(response.error || "Calendar could not refresh.");
    }

    state.requests = normalizeRequests(response.requests);
    showMessage(elements.scheduleMessage, "Calendar refreshed.", "success");
    renderAll();
  } catch (error) {
    console.error(error);
    showMessage(elements.scheduleMessage, error.message || "Calendar could not refresh.", "error");
  } finally {
    setBusy(false);
  }
}

function handleMonthInput() {
  if (!isMonthKey(elements.bidMonth.value)) {
    elements.bidMonth.value = state.selectedMonth;
    return;
  }

  state.selectedMonth = elements.bidMonth.value;
  state.draft.clear();
  showMessage(elements.scheduleMessage, "", "muted");
  renderAll();
}

function moveMonth(direction) {
  state.selectedMonth = addMonths(state.selectedMonth, direction);
  elements.bidMonth.value = state.selectedMonth;
  state.draft.clear();
  showMessage(elements.scheduleMessage, "", "muted");
  renderAll();
}

function handlePickerChange(event) {
  const target = event.target;

  if (target.name === "requestType") {
    state.currentType = target.value;
  }

  if (target.name === "priority") {
    state.currentPriority = target.value;
  }
}

function handleCalendarClick(event) {
  const dayButton = event.target.closest("[data-date]");
  if (!dayButton || dayButton.disabled) {
    return;
  }

  const date = dayButton.dataset.date;

  if (state.draft.has(date)) {
    state.draft.delete(date);
    showMessage(elements.scheduleMessage, `${formatShortDate(date)} removed from draft.`, "muted");
    renderAll();
    return;
  }

  if (hasOwnSubmittedRequest(date)) {
    showMessage(elements.scheduleMessage, `You already submitted ${formatShortDate(date)}.`, "error");
    return;
  }

  const nextItem = {
    date,
    type: state.currentType,
    priority: state.currentPriority,
  };
  const nextDraft = new Map(state.draft);
  nextDraft.set(date, nextItem);
  const error = validateDraft([...nextDraft.values()]);

  if (error) {
    showMessage(elements.scheduleMessage, error, "error");
    return;
  }

  state.draft = nextDraft;
  showMessage(elements.scheduleMessage, `${formatShortDate(date)} added.`, "success");
  renderAll();
}

function handleDraftChange(event) {
  const target = event.target;
  const row = target.closest("[data-draft-date]");
  if (!row || !target.dataset.draftField) {
    return;
  }

  const date = row.dataset.draftDate;
  const existing = state.draft.get(date);
  if (!existing) {
    return;
  }

  const nextItem = {
    ...existing,
    [target.dataset.draftField]: target.value,
  };
  const nextDraft = new Map(state.draft);
  nextDraft.set(date, nextItem);
  const error = validateDraft([...nextDraft.values()]);

  if (error) {
    showMessage(elements.scheduleMessage, error, "error");
    renderDraft();
    renderSummary();
    renderCalendar();
    return;
  }

  state.draft = nextDraft;
  showMessage(elements.scheduleMessage, `${formatShortDate(date)} updated.`, "success");
  renderAll();
}

function handleDraftClick(event) {
  const removeButton = event.target.closest("[data-remove-draft]");
  if (!removeButton) {
    return;
  }

  const date = removeButton.dataset.removeDraft;
  state.draft.delete(date);
  showMessage(elements.scheduleMessage, `${formatShortDate(date)} removed from draft.`, "muted");
  renderAll();
}

async function handleMonthRequestClick(event) {
  const cancelButton = event.target.closest("[data-cancel-date]");
  if (!cancelButton) {
    return;
  }

  const date = cancelButton.dataset.cancelDate;
  const request = getOwnRequestForDate(date);
  if (!request) {
    showMessage(elements.scheduleMessage, "That request is no longer active.", "error");
    renderAll();
    return;
  }

  const confirmed = window.confirm(`Cancel ${formatShortDate(date)} ${REQUEST_TYPE_META[request.type].label}?`);
  if (!confirmed) {
    return;
  }

  setBusy(true);
  showMessage(elements.scheduleMessage, `Cancelling ${formatShortDate(date)}...`, "muted");

  try {
    const response = await callApi("cancel", {
      pin: state.session.pin,
      date,
    });

    if (!response.ok) {
      throw new Error(response.error || "Request could not be cancelled.");
    }

    state.requests = normalizeRequests(response.requests);
    showMessage(elements.scheduleMessage, `${formatShortDate(date)} cancelled.`, "success");
    renderAll();
  } catch (error) {
    console.error(error);
    showMessage(elements.scheduleMessage, error.message || "Request could not be cancelled.", "error");
  } finally {
    setBusy(false);
  }
}

function clearDraft() {
  if (!state.draft.size) {
    return;
  }

  state.draft.clear();
  elements.requestNotes.value = "";
  showMessage(elements.scheduleMessage, "Draft cleared.", "muted");
  renderAll();
}

async function submitDraft() {
  if (!state.session) {
    return;
  }

  const days = getSortedDraftDays();
  const error = validateDraft(days);

  if (error) {
    showMessage(elements.scheduleMessage, error, "error");
    return;
  }

  if (!days.length) {
    showMessage(elements.scheduleMessage, "Select at least one day.", "error");
    return;
  }

  setBusy(true);
  showMessage(elements.scheduleMessage, "Submitting request...", "muted");

  try {
    const response = await callApi("submit", {
      pin: state.session.pin,
      bidMonth: state.selectedMonth,
      notes: elements.requestNotes.value.trim(),
      days: JSON.stringify(days),
    });

    if (!response.ok) {
      throw new Error(response.error || "Request could not be submitted.");
    }

    state.requests = normalizeRequests(response.requests);
    state.draft.clear();
    elements.requestNotes.value = "";
    showMessage(elements.scheduleMessage, `${response.saved || days.length} day request saved.`, "success");
    renderAll();
  } catch (error) {
    console.error(error);
    showMessage(elements.scheduleMessage, error.message || "Request could not be submitted.", "error");
  } finally {
    setBusy(false);
  }
}

function renderAll() {
  renderSessionState();
  renderSummary();
  renderCalendar();
  renderDraft();
  renderMonthRequests();
}

function renderModeBanner() {
  if (state.mode === "shared") {
    elements.modeBanner.hidden = true;
    elements.modeBanner.textContent = "";
    return;
  }

  elements.modeBanner.hidden = false;
  elements.modeBanner.textContent = "Local demo mode. Connect Google Apps Script before sharing with pilots.";
}

function renderSessionState() {
  const isLoggedIn = Boolean(state.session);
  elements.loginPanel.hidden = isLoggedIn;
  elements.scheduleApp.hidden = !isLoggedIn;
  elements.refreshButton.hidden = !isLoggedIn;
  elements.signOutButton.hidden = !isLoggedIn;

  if (!isLoggedIn) {
    elements.sessionSummary.textContent = "Shared calendar for regular days off and PTO requests.";
    return;
  }

  elements.sessionSummary.textContent = `Signed in as ${state.session.pilot.name}.`;
}

function renderSummary() {
  const days = getSortedDraftDays();
  const ownMonthRequests = getOwnRequestsForMonth(state.selectedMonth);
  const regularCount = ownMonthRequests.filter((request) => request.type === "regular").length +
    days.filter((day) => day.type === "regular").length;
  const totalCount = ownMonthRequests.length + days.length;
  const monthRequests = getRequestsForMonth(state.selectedMonth);
  const monthLabel = formatMonthLabel(state.selectedMonth);

  elements.regularCount.textContent = `${regularCount}/${state.limits.maxRegularDays}`;
  elements.totalCount.textContent = `${totalCount}/${state.limits.maxTotalDays}`;
  elements.monthRequestCount.textContent = String(monthRequests.length);
  elements.monthRequestCaption.textContent = monthLabel;
  elements.monthHeading.textContent = monthLabel;
  elements.calendarHeading.textContent = monthLabel;
  elements.calendarCaption.textContent = `${monthRequests.length} submitted ${pluralize(monthRequests.length, "request")}.`;
}

function renderCalendar() {
  const monthKey = state.selectedMonth;
  const [year, month] = monthKey.split("-").map(Number);
  const firstDate = new Date(year, month - 1, 1);
  const daysInMonth = new Date(year, month, 0).getDate();
  const leadingBlanks = firstDate.getDay();
  const today = getTodayKey();

  elements.calendarGrid.innerHTML = "";

  for (let index = 0; index < leadingBlanks; index += 1) {
    const blank = document.createElement("div");
    blank.className = "calendar-empty-cell";
    elements.calendarGrid.appendChild(blank);
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = `${monthKey}-${String(day).padStart(2, "0")}`;
    const requests = getRequestsForDate(date);
    const isSelected = state.draft.has(date);
    const isPast = date < today;
    const hasOwnRequest = hasOwnSubmittedRequest(date);
    const button = document.createElement("button");
    button.className = "calendar-day-button";
    button.type = "button";
    button.dataset.date = date;
    button.disabled = isPast;
    button.setAttribute("aria-label", buildDayAriaLabel(date, requests, isSelected));

    if (isSelected) {
      button.classList.add("selected");
    }

    if (hasOwnRequest) {
      button.classList.add("own-request");
    }

    const dayNumber = document.createElement("span");
    dayNumber.className = "calendar-day-number";
    dayNumber.textContent = String(day);
    button.appendChild(dayNumber);

    if (isSelected) {
      button.appendChild(buildDraftChip(state.draft.get(date)));
    }

    const chipStack = document.createElement("span");
    chipStack.className = "calendar-chip-stack";
    requests.forEach((request) => chipStack.appendChild(buildRequestChip(request)));
    button.appendChild(chipStack);

    elements.calendarGrid.appendChild(button);
  }
}

function renderDraft() {
  const days = getSortedDraftDays();
  const regularCount = days.filter((day) => day.type === "regular").length;
  elements.draftCaption.textContent = days.length
    ? `${regularCount} OFF, ${days.length - regularCount} PTO, ${days.length} total`
    : "No days selected.";
  elements.clearDraftButton.disabled = !days.length;
  elements.submitRequestButton.disabled = !days.length;
  elements.draftList.innerHTML = "";

  if (!days.length) {
    const emptyState = document.createElement("div");
    emptyState.className = "empty-state compact-empty-state";
    emptyState.textContent = "Select days from the calendar.";
    elements.draftList.appendChild(emptyState);
    return;
  }

  days.forEach((day) => {
    elements.draftList.appendChild(buildDraftRow(day));
  });
}

function renderMonthRequests() {
  const requests = getRequestsForMonth(state.selectedMonth);
  elements.monthRequestList.innerHTML = "";
  elements.monthListCaption.textContent = requests.length
    ? `${requests.length} submitted ${pluralize(requests.length, "request")}. Tap your own days to cancel.`
    : "No requests submitted.";

  if (!requests.length) {
    const emptyState = document.createElement("div");
    emptyState.className = "empty-state compact-empty-state";
    emptyState.textContent = "No requests for this bid month.";
    elements.monthRequestList.appendChild(emptyState);
    return;
  }

  const grouped = groupRequestsByPilot(requests);
  grouped.forEach((group) => {
    const card = document.createElement("article");
    card.className = "pilot-request-group";
    const pilot = getPilot(group.pilotId);
    card.style.setProperty("--pilot-color", pilot.color);
    card.innerHTML = `
      <div class="pilot-request-group-header">
        <span class="pilot-color-dot"></span>
        <strong>${escapeHtml(group.pilotName)}</strong>
        <span>${group.requests.length} ${pluralize(group.requests.length, "day")}</span>
      </div>
    `;

    const list = document.createElement("div");
    list.className = "pilot-request-days";
    group.requests.forEach((request) => {
      const isOwnRequest = state.session && request.pilotId === state.session.pilot.id;
      const item = document.createElement(isOwnRequest ? "button" : "span");
      item.className = "pilot-request-day";
      item.textContent = `${formatShortDate(request.date)} ${REQUEST_TYPE_META[request.type].label} ${PRIORITY_META[request.priority].label}`;
      if (isOwnRequest) {
        item.type = "button";
        item.dataset.cancelDate = request.date;
        item.title = `Cancel ${formatShortDate(request.date)}`;
        item.setAttribute("aria-label", `Cancel ${formatShortDate(request.date)} ${REQUEST_TYPE_META[request.type].label}`);
      }
      list.appendChild(item);
    });
    card.appendChild(list);
    elements.monthRequestList.appendChild(card);
  });
}

function buildDraftRow(day) {
  const row = document.createElement("article");
  row.className = "draft-row";
  row.dataset.draftDate = day.date;
  row.innerHTML = `
    <div class="draft-date">
      <strong>${formatShortDate(day.date)}</strong>
      <span>${formatWeekday(day.date)}</span>
    </div>
    <label class="draft-select">
      <span>Type</span>
      <select data-draft-field="type" aria-label="Request type for ${formatShortDate(day.date)}">
        <option value="regular"${day.type === "regular" ? " selected" : ""}>OFF</option>
        <option value="pto"${day.type === "pto" ? " selected" : ""}>PTO</option>
      </select>
    </label>
    <label class="draft-select">
      <span>Priority</span>
      <select data-draft-field="priority" aria-label="Priority for ${formatShortDate(day.date)}">
        <option value="high"${day.priority === "high" ? " selected" : ""}>High</option>
        <option value="medium"${day.priority === "medium" ? " selected" : ""}>Medium</option>
        <option value="low"${day.priority === "low" ? " selected" : ""}>Low</option>
      </select>
    </label>
    <button class="inline-button draft-remove-button" type="button" data-remove-draft="${day.date}" aria-label="Remove ${formatShortDate(day.date)}">x</button>
  `;
  return row;
}

function buildRequestChip(request) {
  const pilot = getPilot(request.pilotId);
  const chip = document.createElement("span");
  chip.className = `request-chip request-chip-${request.type}`;
  chip.style.setProperty("--pilot-color", pilot.color);
  chip.style.setProperty("--chip-text", getReadableTextColor(pilot.color));
  chip.title = `${request.pilotName}: ${REQUEST_TYPE_META[request.type].fullLabel}, ${PRIORITY_META[request.priority].fullLabel}`;
  chip.textContent = `${REQUEST_TYPE_META[request.type].label} ${PRIORITY_META[request.priority].label}`;
  return chip;
}

function buildDraftChip(day) {
  const chip = document.createElement("span");
  chip.className = `draft-chip draft-chip-${day.type}`;
  chip.textContent = `${REQUEST_TYPE_META[day.type].label} ${PRIORITY_META[day.priority].label}`;
  return chip;
}

function buildDayAriaLabel(date, requests, isSelected) {
  const parts = [formatLongDate(date)];
  if (isSelected) {
    parts.push("selected in draft");
  }
  requests.forEach((request) => {
    parts.push(`${request.pilotName} ${REQUEST_TYPE_META[request.type].fullLabel} ${PRIORITY_META[request.priority].fullLabel}`);
  });
  return parts.join(", ");
}

function getSortedDraftDays() {
  return [...state.draft.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function validateDraft(days) {
  const ownMonthRequests = getOwnRequestsForMonth(state.selectedMonth);
  const existingTotal = ownMonthRequests.length;
  const existingRegular = ownMonthRequests.filter((request) => request.type === "regular").length;
  const total = existingTotal + days.length;
  const regular = existingRegular + days.filter((day) => day.type === "regular").length;
  const uniqueDates = new Set(days.map((day) => day.date));

  if (days.length !== uniqueDates.size) {
    return "Each date can only be selected once.";
  }

  if (regular > state.limits.maxRegularDays) {
    return existingRegular
      ? `Monthly OFF days are limited to ${state.limits.maxRegularDays}. You already have ${existingRegular}.`
      : `Monthly OFF days are limited to ${state.limits.maxRegularDays}.`;
  }

  if (total > state.limits.maxTotalDays) {
    return existingTotal
      ? `Monthly OFF + PTO days are limited to ${state.limits.maxTotalDays}. You already have ${existingTotal}.`
      : `Monthly OFF + PTO days are limited to ${state.limits.maxTotalDays}.`;
  }

  const invalidDay = days.find((day) => !day.date.startsWith(`${state.selectedMonth}-`));
  if (invalidDay) {
    return "Selected days must be inside the bid month.";
  }

  return "";
}

function hasOwnSubmittedRequest(date) {
  return Boolean(getOwnRequestForDate(date));
}

function getOwnRequestForDate(date) {
  if (!state.session) {
    return null;
  }

  return state.requests.find((request) => request.date === date && request.pilotId === state.session.pilot.id) || null;
}

function getOwnRequestsForMonth(monthKey) {
  if (!state.session) {
    return [];
  }

  return getRequestsForMonth(monthKey).filter((request) => request.pilotId === state.session.pilot.id);
}

function getRequestsForDate(date) {
  return state.requests
    .filter((request) => request.date === date)
    .sort(sortRequests);
}

function getRequestsForMonth(monthKey) {
  return state.requests
    .filter((request) => request.bidMonth === monthKey || request.date.startsWith(`${monthKey}-`))
    .sort(sortRequests);
}

function groupRequestsByPilot(requests) {
  const groups = new Map();
  requests.forEach((request) => {
    if (!groups.has(request.pilotId)) {
      groups.set(request.pilotId, {
        pilotId: request.pilotId,
        pilotName: request.pilotName,
        requests: [],
      });
    }
    groups.get(request.pilotId).requests.push(request);
  });

  return [...groups.values()].sort((a, b) => a.pilotName.localeCompare(b.pilotName));
}

function sortRequests(a, b) {
  const dateSort = a.date.localeCompare(b.date);
  if (dateSort !== 0) {
    return dateSort;
  }
  return a.pilotName.localeCompare(b.pilotName);
}

function getPilot(pilotId) {
  return state.pilots.find((pilot) => pilot.id === pilotId) || {
    id: pilotId,
    name: "Pilot",
    initials: "P",
    color: "#6c6257",
  };
}

async function callApi(action, params = {}) {
  if (!state.apiUrl) {
    return callDemoApi(action, params);
  }

  return callJsonpApi(action, params);
}

function callJsonpApi(action, params = {}) {
  return new Promise((resolve, reject) => {
    const callbackName = `prismjetSchedule_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const script = document.createElement("script");
    const url = new URL(state.apiUrl);
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("Schedule server timed out."));
    }, API_TIMEOUT_MS);

    function cleanup() {
      window.clearTimeout(timeout);
      delete window[callbackName];
      script.remove();
    }

    window[callbackName] = (payload) => {
      cleanup();
      resolve(payload);
    };

    url.searchParams.set("action", action);
    url.searchParams.set("callback", callbackName);

    Object.entries(params).forEach(([key, value]) => {
      if (value === undefined || value === null) {
        return;
      }
      url.searchParams.set(key, String(value));
    });

    script.onerror = () => {
      cleanup();
      reject(new Error("Schedule server could not be reached."));
    };
    script.src = url.toString();
    document.head.appendChild(script);
  });
}

async function callDemoApi(action, params = {}) {
  await wait(140);

  if (action === "config") {
    return {
      ok: true,
      pilots: DEMO_PILOTS,
      limits: DEFAULT_LIMITS,
    };
  }

  if (action === "login") {
    const pilotId = DEMO_PINS[String(params.pin || "")];
    const pilot = DEMO_PILOTS.find((item) => item.id === pilotId);

    if (!pilot) {
      return {
        ok: false,
        error: "Demo PINs are 1111, 2222, and 3333.",
      };
    }

    return {
      ok: true,
      pilot,
      requests: readDemoRequests(),
    };
  }

  if (action === "requests") {
    return {
      ok: true,
      requests: readDemoRequests(),
    };
  }

  if (action === "submit") {
    const pilotId = DEMO_PINS[String(params.pin || "")];
    const pilot = DEMO_PILOTS.find((item) => item.id === pilotId);
    if (!pilot) {
      return {
        ok: false,
        error: "PIN was not recognized.",
      };
    }

    const days = safeJsonParse(params.days, []);
    const error = validateSubmittedDays(days, params.bidMonth, pilot.id, readDemoRequests());
    if (error) {
      return {
        ok: false,
        error,
      };
    }

    const requestId = createId();
    const submittedAt = new Date().toISOString();
    const nextRequests = [
      ...readDemoRequests(),
      ...days.map((day) => ({
        id: createId(),
        requestId,
        submittedAt,
        bidMonth: params.bidMonth,
        pilotId: pilot.id,
        pilotName: pilot.name,
        date: day.date,
        type: day.type,
        priority: day.priority,
        notes: String(params.notes || ""),
        status: "submitted",
      })),
    ];

    window.localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(nextRequests));
    return {
      ok: true,
      saved: days.length,
      requests: nextRequests,
    };
  }

  if (action === "cancel") {
    const pilotId = DEMO_PINS[String(params.pin || "")];
    const pilot = DEMO_PILOTS.find((item) => item.id === pilotId);
    if (!pilot) {
      return {
        ok: false,
        error: "PIN was not recognized.",
      };
    }

    const date = String(params.date || "");
    if (!isDateKey(date)) {
      return {
        ok: false,
        error: "Date is invalid.",
      };
    }

    let cancelled = 0;
    const nextRequests = readRawDemoRequests().map((request) => {
      if (request.pilotId === pilot.id && request.date === date && request.status !== "cancelled") {
        cancelled += 1;
        return {
          ...request,
          status: "cancelled",
        };
      }
      return request;
    });

    if (!cancelled) {
      return {
        ok: false,
        error: "That request is no longer active.",
      };
    }

    window.localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(nextRequests));
    return {
      ok: true,
      cancelled,
      requests: nextRequests,
    };
  }

  return {
    ok: false,
    error: "Unknown schedule action.",
  };
}

function validateSubmittedDays(days, bidMonth, pilotId, existingRequests) {
  if (!Array.isArray(days) || !days.length) {
    return "Select at least one day.";
  }

  const normalizedDays = days.map((day) => ({
    date: String(day.date || ""),
    type: normalizeRequestType(day.type),
    priority: normalizePriority(day.priority),
  }));
  const total = normalizedDays.length;
  const regular = normalizedDays.filter((day) => day.type === "regular").length;
  const uniqueDates = new Set(normalizedDays.map((day) => day.date));
  const existingMonthRequests = existingRequests.filter((request) =>
    request.pilotId === pilotId &&
    (request.bidMonth === bidMonth || request.date.startsWith(`${bidMonth}-`)) &&
    request.status !== "cancelled"
  );
  const existingRegular = existingMonthRequests.filter((request) => request.type === "regular").length;

  if (!isMonthKey(bidMonth)) {
    return "Bid month is invalid.";
  }

  if (total !== uniqueDates.size) {
    return "Each date can only be submitted once.";
  }

  if (regular > DEFAULT_LIMITS.maxRegularDays) {
    return `Regular days are limited to ${DEFAULT_LIMITS.maxRegularDays}.`;
  }

  if (total > DEFAULT_LIMITS.maxTotalDays) {
    return `Combined OFF + PTO days are limited to ${DEFAULT_LIMITS.maxTotalDays}.`;
  }

  if (existingRegular + regular > DEFAULT_LIMITS.maxRegularDays) {
    return `Monthly OFF days are limited to ${DEFAULT_LIMITS.maxRegularDays}. You already have ${existingRegular}.`;
  }

  if (existingMonthRequests.length + total > DEFAULT_LIMITS.maxTotalDays) {
    return `Monthly OFF + PTO days are limited to ${DEFAULT_LIMITS.maxTotalDays}. You already have ${existingMonthRequests.length}.`;
  }

  const invalidDate = normalizedDays.find((day) => !isDateKey(day.date) || !day.date.startsWith(`${bidMonth}-`));
  if (invalidDate) {
    return "Selected days must be inside the bid month.";
  }

  const duplicate = normalizedDays.find((day) =>
    existingRequests.some((request) => request.pilotId === pilotId && request.date === day.date && request.status !== "cancelled")
  );
  if (duplicate) {
    return `${formatShortDate(duplicate.date)} has already been submitted.`;
  }

  return "";
}

function readDemoRequests() {
  return normalizeRequests(readRawDemoRequests());
}

function readRawDemoRequests() {
  const requests = safeJsonParse(window.localStorage.getItem(DEMO_STORAGE_KEY), []);
  return Array.isArray(requests) ? requests : [];
}

function normalizeRequests(requests) {
  if (!Array.isArray(requests)) {
    return [];
  }

  return requests
    .map((request) => ({
      id: String(request.id || request.requestId || createId()),
      requestId: String(request.requestId || request.id || createId()),
      submittedAt: String(request.submittedAt || ""),
      bidMonth: isMonthKey(request.bidMonth) ? request.bidMonth : String(request.date || "").slice(0, 7),
      pilotId: String(request.pilotId || ""),
      pilotName: String(request.pilotName || "Pilot"),
      date: String(request.date || ""),
      type: normalizeRequestType(request.type),
      priority: normalizePriority(request.priority),
      notes: String(request.notes || ""),
      status: String(request.status || "submitted"),
    }))
    .filter((request) => isDateKey(request.date) && request.status !== "cancelled");
}

function normalizePilots(pilots) {
  if (!Array.isArray(pilots) || !pilots.length) {
    return DEMO_PILOTS;
  }

  return pilots.map(normalizePilot);
}

function normalizePilot(pilot) {
  const name = String(pilot?.name || "Pilot");
  return {
    id: String(pilot?.id || name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "pilot"),
    name,
    initials: String(pilot?.initials || getInitials(name)).slice(0, 3).toUpperCase(),
    color: String(pilot?.color || "#6c6257"),
  };
}

function normalizeRequestType(type) {
  return type === "pto" ? "pto" : "regular";
}

function normalizePriority(priority) {
  return ["high", "medium", "low"].includes(priority) ? priority : "medium";
}

function getConfiguredApiUrl() {
  return String(window.PRISMJET_SCHEDULE_API_URL || "").trim();
}

function restoreLastPilotHint() {
  const lastPilot = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
  if (lastPilot) {
    showMessage(elements.authMessage, `Last pilot: ${lastPilot}`, "muted");
  }
}

function setBusy(isBusy) {
  [
    elements.pilotPin,
    elements.refreshButton,
    elements.signOutButton,
    elements.bidMonth,
    elements.previousMonthButton,
    elements.nextMonthButton,
    elements.clearDraftButton,
    elements.submitRequestButton,
  ].forEach((element) => {
    if (element) {
      element.disabled = isBusy;
    }
  });
}

function showMessage(element, message, tone = "muted") {
  element.textContent = message;
  element.dataset.tone = tone;
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch((error) => {
      console.warn("Service worker registration failed", error);
    });
  });
}

function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch (error) {
    return fallback;
  }
}

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function createId() {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getNextMonthKey(date = new Date()) {
  return toMonthKey(new Date(date.getFullYear(), date.getMonth() + 1, 1));
}

function getTodayKey(date = new Date()) {
  return toDateKey(date);
}

function toMonthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function toDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function addMonths(monthKey, amount) {
  const [year, month] = monthKey.split("-").map(Number);
  return toMonthKey(new Date(year, month - 1 + amount, 1));
}

function isMonthKey(value) {
  return /^\d{4}-\d{2}$/.test(String(value || ""));
}

function isDateKey(value) {
  const date = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return false;
  }

  const [year, month, day] = date.split("-").map(Number);
  const parsed = new Date(year, month - 1, day);
  return parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day;
}

function parseDateKey(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatMonthLabel(monthKey) {
  const [year, month] = monthKey.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, {
    month: "long",
    year: "numeric",
  }).format(new Date(year, month - 1, 1));
}

function formatShortDate(dateKey) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(parseDateKey(dateKey));
}

function formatLongDate(dateKey) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(parseDateKey(dateKey));
}

function formatWeekday(dateKey) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
  }).format(parseDateKey(dateKey));
}

function pluralize(count, singular) {
  return count === 1 ? singular : `${singular}s`;
}

function getInitials(name) {
  return String(name || "Pilot")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function getReadableTextColor(hex) {
  const normalized = String(hex || "").replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(normalized)) {
    return "#ffffff";
  }

  const red = parseInt(normalized.slice(0, 2), 16);
  const green = parseInt(normalized.slice(2, 4), 16);
  const blue = parseInt(normalized.slice(4, 6), 16);
  const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) / 255;
  return luminance > 0.62 ? "#111111" : "#ffffff";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
