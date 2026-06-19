const DEFAULT_LIMITS = {
  maxRegularDays: 8,
  maxTotalDays: 14,
  maxRequestsPerDay: 1,
};

const ADMIN_PIN = "1111";

const DEMO_PILOTS = [
  { id: "pilot-a", name: "Adam Barkley", initials: "AB", color: "#2f6fb3" },
  { id: "pilot-b", name: "Ian Crouse", initials: "IC", color: "#2f7d5b" },
  { id: "pilot-c", name: "Zach Stolarow", initials: "ZS", color: "#b36b20" },
];

const PILOT_OVERRIDES = {
  "pilot-a": {
    name: "Adam Barkley",
    initials: "AB",
  },
};

const DEMO_PINS = {
  1111: "pilot-a",
  2222: "pilot-b",
  3333: "pilot-c",
};

const DEMO_STORAGE_KEY = "prismjetScheduleDemoRequests";
const DEMO_TRIPS_STORAGE_KEY = "prismjetScheduleDemoTrips";
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
  trip: {
    label: "TRIP",
    fullLabel: "Scheduled trip",
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
  trips: [],
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
  exportButton: document.querySelector("#export-calendar-button"),
  resetMonthButton: document.querySelector("#reset-month-button"),
  menuButton: document.querySelector("#schedule-menu-button"),
  menu: document.querySelector("#schedule-menu"),
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
  tripTypeOption: document.querySelector("#trip-type-option"),
  priorityPicker: document.querySelector("#priority-picker"),
  calendarGrid: document.querySelector("#calendar-grid"),
  draftCaption: document.querySelector("#draft-caption"),
  submitRequestButton: document.querySelector("#submit-request-button"),
  scheduleMessage: document.querySelector("#schedule-message"),
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
  elements.exportButton.addEventListener("click", exportCalendar);
  elements.resetMonthButton.addEventListener("click", resetSelectedMonth);
  elements.menuButton.addEventListener("click", toggleMenu);
  document.addEventListener("click", closeMenuOnOutsideClick);
  elements.bidMonth.addEventListener("change", handleMonthInput);
  elements.previousMonthButton.addEventListener("click", () => moveMonth(-1));
  elements.nextMonthButton.addEventListener("click", () => moveMonth(1));
  elements.requestTypePicker.addEventListener("change", handlePickerChange);
  elements.priorityPicker.addEventListener("change", handlePickerChange);
  elements.calendarGrid.addEventListener("click", handleCalendarClick);
  elements.submitRequestButton.addEventListener("click", submitDraft);
  window.addEventListener("pageshow", refreshRequestsFromStore);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      refreshRequestsFromStore();
    }
  });
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
      maxRequestsPerDay: Number(response.limits?.maxRequestsPerDay || DEFAULT_LIMITS.maxRequestsPerDay),
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
    state.trips = normalizeTrips(response.trips);
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
  state.currentType = "regular";
  showMessage(elements.scheduleMessage, "", "muted");
  closeMenu();
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
    state.trips = normalizeTrips(response.trips);
    showMessage(elements.scheduleMessage, "Calendar refreshed.", "success");
    closeMenu();
    renderAll();
  } catch (error) {
    console.error(error);
    showMessage(elements.scheduleMessage, error.message || "Calendar could not refresh.", "error");
  } finally {
    setBusy(false);
  }
}

async function refreshRequestsFromStore() {
  if (!state.session) {
    return;
  }

  try {
    const response = await callApi("requests", { pin: state.session.pin });
    if (response.ok) {
      state.requests = normalizeRequests(response.requests);
      state.trips = normalizeTrips(response.trips);
      renderAll();
    }
  } catch (error) {
    console.warn("Schedule refresh skipped", error);
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
    renderEntryControls();
  }

  if (target.name === "priority") {
    state.currentPriority = target.value;
  }
}

function toggleMenu(event) {
  event.stopPropagation();
  const isOpen = !elements.menu.hidden;
  elements.menu.hidden = isOpen;
  elements.menuButton.setAttribute("aria-expanded", isOpen ? "false" : "true");
}

function closeMenuOnOutsideClick(event) {
  if (elements.menu.hidden) {
    return;
  }

  if (elements.menu.contains(event.target) || elements.menuButton.contains(event.target)) {
    return;
  }

  closeMenu();
}

function closeMenu() {
  elements.menu.hidden = true;
  elements.menuButton.setAttribute("aria-expanded", "false");
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

  if (state.currentType === "trip") {
    if (!isAdminSession()) {
      showMessage(elements.scheduleMessage, "Only the admin PIN can add trip days.", "error");
      return;
    }

    if (getTripForDate(date)) {
      cancelTripDate(date);
      return;
    }

    const nextDraft = new Map(state.draft);
    nextDraft.set(date, {
      date,
      type: "trip",
      priority: "medium",
    });

    const error = validateDraft([...nextDraft.values()]);
    if (error) {
      showMessage(elements.scheduleMessage, error, "error");
      return;
    }

    state.draft = nextDraft;
    showMessage(elements.scheduleMessage, `${formatShortDate(date)} trip added.`, "success");
    renderAll();
    return;
  }

  const ownRequest = getOwnRequestForDate(date);
  if (ownRequest) {
    cancelSubmittedDate(date);
    return;
  }

  const existingRequests = getRequestsForDate(date);
  if (existingRequests.length >= state.limits.maxRequestsPerDay) {
    const existing = existingRequests[0];
    showMessage(elements.scheduleMessage, `${formatShortDate(date)} already has ${existing.pilotName} off.`, "error");
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

async function cancelSubmittedDate(date) {
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
    state.trips = normalizeTrips(response.trips);
    showMessage(elements.scheduleMessage, `${formatShortDate(date)} cancelled.`, "success");
    renderAll();
  } catch (error) {
    console.error(error);
    showMessage(elements.scheduleMessage, error.message || "Request could not be cancelled.", "error");
  } finally {
    setBusy(false);
  }
}

async function cancelTripDate(date) {
  const trip = getTripForDate(date);
  if (!trip) {
    showMessage(elements.scheduleMessage, "That trip day is no longer active.", "error");
    renderAll();
    return;
  }

  const confirmed = window.confirm(`Remove scheduled trip on ${formatShortDate(date)}?`);
  if (!confirmed) {
    return;
  }

  setBusy(true);
  showMessage(elements.scheduleMessage, `Removing ${formatShortDate(date)} trip...`, "muted");

  try {
    const response = await callApi("cancelTrip", {
      pin: state.session.pin,
      date,
    });

    if (!response.ok) {
      throw new Error(response.error || "Trip day could not be removed.");
    }

    state.requests = normalizeRequests(response.requests);
    state.trips = normalizeTrips(response.trips);
    showMessage(elements.scheduleMessage, `${formatShortDate(date)} trip removed.`, "success");
    renderAll();
  } catch (error) {
    console.error(error);
    showMessage(elements.scheduleMessage, error.message || "Trip day could not be removed.", "error");
  } finally {
    setBusy(false);
  }
}

async function exportCalendar() {
  if (!state.session) {
    return;
  }

  closeMenu();

  if (!isAdminSession()) {
    showMessage(elements.scheduleMessage, "Only the admin PIN can export the calendar.", "error");
    return;
  }

  try {
    const response = await callApi("requests", { pin: state.session.pin });
    if (response.ok) {
      state.requests = normalizeRequests(response.requests);
      state.trips = normalizeTrips(response.trips);
      renderAll();
    }
  } catch (error) {
    console.warn("Export used the currently loaded calendar", error);
  }

  const requestRows = getRequestsForMonth(state.selectedMonth).sort(sortRequestsByPilot);
  const tripRows = getTripsForMonth(state.selectedMonth);
  const headers = ["Pilot / Entry", "Entry Type", "Date", "Request Type", "Priority", "Bid Month", "Submitted At", "Notes"];
  const csvRows = [
    headers,
    ...requestRows.map((request) => [
      request.pilotName,
      "Pilot Request",
      request.date,
      REQUEST_TYPE_META[request.type].label,
      PRIORITY_META[request.priority].fullLabel,
      request.bidMonth,
      request.submittedAt,
      request.notes,
    ]),
    ...tripRows.map((trip) => [
      "Scheduled Trip",
      "Trip",
      trip.date,
      REQUEST_TYPE_META.trip.label,
      "",
      trip.bidMonth,
      trip.submittedAt,
      trip.notes,
    ]),
  ];
  const csv = csvRows.map((row) => row.map(formatCsvCell).join(",")).join("\r\n");
  const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `prismjet-scheduling-${state.selectedMonth}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  const exportedCount = requestRows.length + tripRows.length;
  showMessage(elements.scheduleMessage, `Exported ${exportedCount} ${exportedCount === 1 ? "entry" : "entries"}.`, "success");
}

async function resetSelectedMonth() {
  if (!state.session) {
    return;
  }

  closeMenu();

  if (!isAdminSession()) {
    showMessage(elements.scheduleMessage, "Only the admin PIN can clear a month.", "error");
    return;
  }

  const monthLabel = formatMonthLabel(state.selectedMonth);
  const confirmed = window.confirm(`Clear all requests and trips for ${monthLabel}?`);
  if (!confirmed) {
    return;
  }

  setBusy(true);
  showMessage(elements.scheduleMessage, `Clearing ${monthLabel}...`, "muted");

  try {
    const response = await callApi("resetMonth", {
      pin: state.session.pin,
      bidMonth: state.selectedMonth,
    });

    if (!response.ok) {
      throw new Error(response.error || "Month could not be cleared.");
    }

    state.requests = normalizeRequests(response.requests);
    state.trips = normalizeTrips(response.trips);
    state.draft.clear();
    const cleared = Number(response.clearedRequests || 0) + Number(response.clearedTrips || 0);
    showMessage(elements.scheduleMessage, `${monthLabel} cleared (${cleared} ${cleared === 1 ? "entry" : "entries"}).`, "success");
    renderAll();
  } catch (error) {
    console.error(error);
    showMessage(elements.scheduleMessage, error.message || "Month could not be cleared.", "error");
  } finally {
    setBusy(false);
  }
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

  const requestDays = days.filter((day) => day.type !== "trip");
  const tripDays = days.filter((day) => day.type === "trip");

  setBusy(true);
  showMessage(elements.scheduleMessage, tripDays.length && !requestDays.length ? "Saving trip days..." : "Submitting request...", "muted");

  try {
    let savedRequests = 0;
    let savedTrips = 0;

    if (requestDays.length) {
      const response = await callApi("submit", {
        pin: state.session.pin,
        bidMonth: state.selectedMonth,
        notes: "",
        days: JSON.stringify(requestDays),
      });

      if (!response.ok) {
        throw new Error(response.error || "Request could not be submitted.");
      }

      savedRequests = Number(response.saved || requestDays.length);
      state.requests = normalizeRequests(response.requests);
      state.trips = normalizeTrips(response.trips);
    }

    if (tripDays.length) {
      const response = await callApi("submitTrips", {
        pin: state.session.pin,
        bidMonth: state.selectedMonth,
        notes: "",
        days: JSON.stringify(tripDays.map((day) => ({ date: day.date }))),
      });

      if (!response.ok) {
        throw new Error(response.error || "Trip days could not be saved.");
      }

      savedTrips = Number(response.saved || tripDays.length);
      state.requests = normalizeRequests(response.requests);
      state.trips = normalizeTrips(response.trips);
    }

    state.draft.clear();
    showMessage(elements.scheduleMessage, formatSaveMessage(savedRequests, savedTrips), "success");
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
  const isAdmin = isAdminSession();
  elements.loginPanel.hidden = isLoggedIn;
  elements.scheduleApp.hidden = !isLoggedIn;
  elements.signOutButton.hidden = !isLoggedIn;
  elements.menuButton.hidden = !isLoggedIn;
  elements.exportButton.hidden = !isAdmin;
  elements.resetMonthButton.hidden = !isAdmin;
  elements.menu.hidden = true;
  elements.menuButton.setAttribute("aria-expanded", "false");
  renderEntryControls();

  if (!isLoggedIn) {
    elements.sessionSummary.textContent = "Shared calendar for regular days off and PTO requests.";
    return;
  }

  elements.sessionSummary.textContent = `Signed in as ${state.session.pilot.name}.`;
}

function renderEntryControls() {
  const isAdmin = isAdminSession();
  if (elements.tripTypeOption) {
    elements.tripTypeOption.hidden = !isAdmin;
  }

  if (!isAdmin && state.currentType === "trip") {
    state.currentType = "regular";
  }

  const currentTypeInput = elements.requestTypePicker.querySelector(`input[name="requestType"][value="${state.currentType}"]`);
  if (currentTypeInput) {
    currentTypeInput.checked = true;
  }

  elements.priorityPicker.hidden = state.currentType === "trip";
}

function renderSummary() {
  const days = getSortedDraftDays();
  const requestDays = days.filter((day) => day.type !== "trip");
  const ownMonthRequests = getOwnRequestsForMonth(state.selectedMonth);
  const regularCount = ownMonthRequests.filter((request) => request.type === "regular").length +
    requestDays.filter((day) => day.type === "regular").length;
  const totalCount = ownMonthRequests.length + requestDays.length;
  const monthRequests = getRequestsForMonth(state.selectedMonth);
  const monthTrips = getTripsForMonth(state.selectedMonth);
  const monthLabel = formatMonthLabel(state.selectedMonth);

  elements.regularCount.textContent = `${regularCount}/${state.limits.maxRegularDays}`;
  elements.totalCount.textContent = `${totalCount}/${state.limits.maxTotalDays}`;
  elements.monthRequestCount.textContent = String(monthRequests.length);
  elements.monthRequestCaption.textContent = monthLabel;
  elements.monthHeading.textContent = monthLabel;
  elements.calendarHeading.textContent = monthLabel;
  elements.calendarCaption.textContent = `${monthRequests.length} submitted ${pluralize(monthRequests.length, "request")}${monthTrips.length ? `, ${monthTrips.length} scheduled ${pluralize(monthTrips.length, "trip")}` : ""}. Tap your own submitted day to cancel it.`;
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
    const trips = getTripsForDate(date);
    const isSelected = state.draft.has(date);
    const isPast = date < today;
    const hasOwnRequest = hasOwnSubmittedRequest(date);
    const button = document.createElement("button");
    button.className = "calendar-day-button";
    button.type = "button";
    button.dataset.date = date;
    button.disabled = isPast;
    button.setAttribute("aria-label", buildDayAriaLabel(date, requests, trips, isSelected));

    if (isSelected) {
      button.classList.add("selected");
    }

    if (hasOwnRequest) {
      button.classList.add("own-request");
    }

    if (trips.length) {
      button.classList.add("has-trip");
    }

    if (requests.length >= state.limits.maxRequestsPerDay && !hasOwnRequest) {
      button.classList.add("unavailable");
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
    trips.forEach((trip) => chipStack.appendChild(buildTripChip(trip)));
    requests.forEach((request) => chipStack.appendChild(buildRequestChip(request)));
    button.appendChild(chipStack);

    elements.calendarGrid.appendChild(button);
  }
}

function renderDraft() {
  const days = getSortedDraftDays();
  const regularCount = days.filter((day) => day.type === "regular").length;
  const ptoCount = days.filter((day) => day.type === "pto").length;
  const tripCount = days.filter((day) => day.type === "trip").length;
  elements.draftCaption.textContent = days.length
    ? `${regularCount} OFF, ${ptoCount} PTO${tripCount ? `, ${tripCount} trip${tripCount === 1 ? "" : "s"}` : ""}`
    : "No days selected.";
  elements.submitRequestButton.disabled = !days.length;
}

function buildRequestChip(request) {
  const pilot = getPilot(request.pilotId);
  const chip = document.createElement("span");
  chip.className = `request-chip request-chip-${request.type}`;
  chip.style.setProperty("--pilot-color", pilot.color);
  chip.style.setProperty("--chip-text", getReadableTextColor(pilot.color));
  chip.title = `${request.pilotName}: ${REQUEST_TYPE_META[request.type].fullLabel}, ${PRIORITY_META[request.priority].fullLabel}`;
  chip.textContent = `${pilot.initials} ${REQUEST_TYPE_META[request.type].label} ${PRIORITY_META[request.priority].label}`;
  return chip;
}

function buildTripChip(trip) {
  const chip = document.createElement("span");
  chip.className = "trip-chip";
  chip.title = `Scheduled trip: ${formatLongDate(trip.date)}`;
  chip.textContent = REQUEST_TYPE_META.trip.label;
  return chip;
}

function buildDraftChip(day) {
  const chip = document.createElement("span");
  chip.className = `draft-chip draft-chip-${day.type}`;
  chip.textContent = day.type === "trip"
    ? REQUEST_TYPE_META.trip.label
    : `${REQUEST_TYPE_META[day.type].label} ${PRIORITY_META[day.priority].label}`;
  return chip;
}

function buildDayAriaLabel(date, requests, trips, isSelected) {
  const parts = [formatLongDate(date)];
  if (isSelected) {
    parts.push("selected in draft");
  }
  trips.forEach(() => {
    parts.push("scheduled trip");
  });
  requests.forEach((request) => {
    parts.push(`${request.pilotName} ${REQUEST_TYPE_META[request.type].fullLabel} ${PRIORITY_META[request.priority].fullLabel}`);
  });
  return parts.join(", ");
}

function getSortedDraftDays() {
  return [...state.draft.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function validateDraft(days) {
  const requestDays = days.filter((day) => day.type !== "trip");
  const tripDays = days.filter((day) => day.type === "trip");
  const ownMonthRequests = getOwnRequestsForMonth(state.selectedMonth);
  const existingTotal = ownMonthRequests.length;
  const existingRegular = ownMonthRequests.filter((request) => request.type === "regular").length;
  const total = existingTotal + requestDays.length;
  const regular = existingRegular + requestDays.filter((day) => day.type === "regular").length;
  const uniqueDates = new Set(days.map((day) => day.date));

  if (days.length !== uniqueDates.size) {
    return "Each date can only be selected once.";
  }

  if (tripDays.length && !isAdminSession()) {
    return "Only the admin PIN can add trip days.";
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

  const duplicateTrip = tripDays.find((day) => getTripForDate(day.date));
  if (duplicateTrip) {
    return `${formatShortDate(duplicateTrip.date)} already has a scheduled trip.`;
  }

  const unavailableDay = requestDays.find((day) => getRequestsForDate(day.date).length >= state.limits.maxRequestsPerDay);
  if (unavailableDay) {
    const existing = getRequestsForDate(unavailableDay.date)[0];
    return `${formatShortDate(unavailableDay.date)} already has ${existing.pilotName} off.`;
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

function getTripForDate(date) {
  return getTripsForDate(date)[0] || null;
}

function getTripsForDate(date) {
  return state.trips
    .filter((trip) => trip.date === date)
    .sort(sortTrips);
}

function getTripsForMonth(monthKey) {
  return state.trips
    .filter((trip) => trip.bidMonth === monthKey || trip.date.startsWith(`${monthKey}-`))
    .sort(sortTrips);
}

function isEntryInMonth(entry, monthKey) {
  const bidMonth = String(entry.bidMonth || "");
  const date = String(entry.date || "");
  return bidMonth === monthKey || date.startsWith(`${monthKey}-`);
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

function sortRequestsByPilot(a, b) {
  const pilotSort = a.pilotName.localeCompare(b.pilotName);
  if (pilotSort !== 0) {
    return pilotSort;
  }
  return sortRequests(a, b);
}

function sortTrips(a, b) {
  return a.date.localeCompare(b.date);
}

function getPilot(pilotId) {
  return state.pilots.find((pilot) => pilot.id === pilotId) || {
    id: pilotId,
    name: "Pilot",
    initials: "P",
    color: "#6c6257",
  };
}

function getPilotDisplayName(pilotId, fallback) {
  const pilot = state.pilots.find((item) => item.id === pilotId);
  return pilot?.name || String(fallback || "Pilot");
}

function isAdminSession() {
  return state.session?.pin === ADMIN_PIN;
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
      trips: readDemoTrips(),
    };
  }

  if (action === "requests") {
    return {
      ok: true,
      requests: readDemoRequests(),
      trips: readDemoTrips(),
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
      trips: readDemoTrips(),
    };
  }

  if (action === "submitTrips") {
    if (String(params.pin || "") !== ADMIN_PIN) {
      return {
        ok: false,
        error: "Only the admin PIN can add trip days.",
      };
    }

    const days = safeJsonParse(params.days, []);
    const error = validateSubmittedTrips(days, params.bidMonth, readDemoTrips());
    if (error) {
      return {
        ok: false,
        error,
      };
    }

    const submittedAt = new Date().toISOString();
    const nextTrips = [
      ...readDemoTrips(),
      ...days.map((day) => ({
        id: createId(),
        submittedAt,
        bidMonth: params.bidMonth,
        date: String(day.date || ""),
        notes: String(params.notes || ""),
        status: "submitted",
      })),
    ];

    window.localStorage.setItem(DEMO_TRIPS_STORAGE_KEY, JSON.stringify(nextTrips));
    return {
      ok: true,
      saved: days.length,
      requests: readDemoRequests(),
      trips: nextTrips,
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
      trips: readDemoTrips(),
    };
  }

  if (action === "cancelTrip") {
    if (String(params.pin || "") !== ADMIN_PIN) {
      return {
        ok: false,
        error: "Only the admin PIN can remove trip days.",
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
    const nextTrips = readRawDemoTrips().map((trip) => {
      if (trip.date === date && trip.status !== "cancelled") {
        cancelled += 1;
        return {
          ...trip,
          status: "cancelled",
        };
      }
      return trip;
    });

    if (!cancelled) {
      return {
        ok: false,
        error: "That trip day is no longer active.",
      };
    }

    window.localStorage.setItem(DEMO_TRIPS_STORAGE_KEY, JSON.stringify(nextTrips));
    return {
      ok: true,
      cancelled,
      requests: readDemoRequests(),
      trips: nextTrips,
    };
  }

  if (action === "resetMonth") {
    if (String(params.pin || "") !== ADMIN_PIN) {
      return {
        ok: false,
        error: "Only the admin PIN can clear a month.",
      };
    }

    const bidMonth = String(params.bidMonth || "");
    if (!isMonthKey(bidMonth)) {
      return {
        ok: false,
        error: "Bid month is invalid.",
      };
    }

    let clearedRequests = 0;
    let clearedTrips = 0;
    const nextRequests = readRawDemoRequests().map((request) => {
      if (isEntryInMonth(request, bidMonth) && request.status !== "cancelled") {
        clearedRequests += 1;
        return {
          ...request,
          status: "cancelled",
        };
      }
      return request;
    });
    const nextTrips = readRawDemoTrips().map((trip) => {
      if (isEntryInMonth(trip, bidMonth) && trip.status !== "cancelled") {
        clearedTrips += 1;
        return {
          ...trip,
          status: "cancelled",
        };
      }
      return trip;
    });

    window.localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(nextRequests));
    window.localStorage.setItem(DEMO_TRIPS_STORAGE_KEY, JSON.stringify(nextTrips));
    return {
      ok: true,
      clearedRequests,
      clearedTrips,
      requests: nextRequests,
      trips: nextTrips,
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

  const unavailable = normalizedDays.find((day) =>
    existingRequests.some((request) => request.date === day.date && request.status !== "cancelled")
  );
  if (unavailable) {
    const existing = existingRequests.find((request) => request.date === unavailable.date && request.status !== "cancelled");
    return `${formatShortDate(unavailable.date)} already has ${existing.pilotName} off.`;
  }

  const duplicate = normalizedDays.find((day) =>
    existingRequests.some((request) => request.pilotId === pilotId && request.date === day.date && request.status !== "cancelled")
  );
  if (duplicate) {
    return `${formatShortDate(duplicate.date)} has already been submitted.`;
  }

  return "";
}

function validateSubmittedTrips(days, bidMonth, existingTrips) {
  if (!Array.isArray(days) || !days.length) {
    return "Select at least one trip day.";
  }

  const normalizedDays = days.map((day) => ({
    date: String(day.date || ""),
  }));
  const uniqueDates = new Set(normalizedDays.map((day) => day.date));

  if (!isMonthKey(bidMonth)) {
    return "Bid month is invalid.";
  }

  if (normalizedDays.length !== uniqueDates.size) {
    return "Each trip date can only be selected once.";
  }

  const invalidDate = normalizedDays.find((day) => !isDateKey(day.date) || !day.date.startsWith(`${bidMonth}-`));
  if (invalidDate) {
    return "Trip days must be inside the bid month.";
  }

  const duplicate = normalizedDays.find((day) =>
    existingTrips.some((trip) => trip.date === day.date && trip.status !== "cancelled")
  );
  if (duplicate) {
    return `${formatShortDate(duplicate.date)} already has a scheduled trip.`;
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

function readDemoTrips() {
  return normalizeTrips(readRawDemoTrips());
}

function readRawDemoTrips() {
  const trips = safeJsonParse(window.localStorage.getItem(DEMO_TRIPS_STORAGE_KEY), []);
  return Array.isArray(trips) ? trips : [];
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
      pilotName: getPilotDisplayName(String(request.pilotId || ""), request.pilotName),
      date: String(request.date || ""),
      type: normalizeRequestType(request.type),
      priority: normalizePriority(request.priority),
      notes: String(request.notes || ""),
      status: String(request.status || "submitted"),
    }))
    .filter((request) => isDateKey(request.date) && request.status !== "cancelled");
}

function normalizeTrips(trips) {
  if (!Array.isArray(trips)) {
    return [];
  }

  return trips
    .map((trip) => ({
      id: String(trip.id || createId()),
      submittedAt: String(trip.submittedAt || ""),
      bidMonth: isMonthKey(trip.bidMonth) ? trip.bidMonth : String(trip.date || "").slice(0, 7),
      date: String(trip.date || ""),
      notes: String(trip.notes || ""),
      status: String(trip.status || "submitted"),
    }))
    .filter((trip) => isDateKey(trip.date) && trip.status !== "cancelled");
}

function normalizePilots(pilots) {
  if (!Array.isArray(pilots) || !pilots.length) {
    return DEMO_PILOTS;
  }

  return pilots.map(normalizePilot);
}

function normalizePilot(pilot) {
  const sourceName = String(pilot?.name || "Pilot");
  const id = String(pilot?.id || sourceName.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "pilot");
  const override = PILOT_OVERRIDES[id];
  const name = override?.name || sourceName;
  return {
    id,
    name,
    initials: String(override?.initials || pilot?.initials || getInitials(name)).slice(0, 3).toUpperCase(),
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
    elements.exportButton,
    elements.resetMonthButton,
    elements.menuButton,
    elements.signOutButton,
    elements.bidMonth,
    elements.previousMonthButton,
    elements.nextMonthButton,
    elements.submitRequestButton,
  ].forEach((element) => {
    if (element) {
      element.disabled = isBusy;
    }
  });

  if (elements.submitRequestButton) {
    elements.submitRequestButton.disabled = isBusy || !state.draft.size;
  }
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

function formatSaveMessage(savedRequests, savedTrips) {
  const parts = [];
  if (savedRequests) {
    parts.push(`${savedRequests} ${savedRequests === 1 ? "day request" : "day requests"}`);
  }
  if (savedTrips) {
    parts.push(`${savedTrips} ${savedTrips === 1 ? "trip day" : "trip days"}`);
  }
  return `${parts.join(" and ")} saved.`;
}

function formatCsvCell(value) {
  const cell = String(value ?? "");
  return `"${cell.replaceAll('"', '""')}"`;
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
