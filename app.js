import {
  buildExportPayload,
  clearAllExpenses,
  createId,
  deleteExpense,
  filterExpenses,
  formatCount,
  formatCurrency,
  formatDate,
  getAllExpenses,
  getExpense,
  getQuickStatusLabel,
  getStatusBadgeClass,
  getStatusLabel,
  getToday,
  getViewConfig,
  normalizeImportedExpense,
  saveExpense,
  sortExpenses,
  summarizeExpenses,
  validateDates,
} from "./storage.js";

const state = {
  currentView: getInitialView(),
  currentRecordType: getInitialRecordType(),
  expenses: [],
};

const elements = {
  recordTypeButtons: document.querySelectorAll("[data-record-type]"),
  summaryButtons: document.querySelectorAll(".status-tile"),
  summaryToSubmit: document.querySelector("#summary-to-submit"),
  summaryToSubmitCount: document.querySelector("#summary-to-submit-count"),
  summaryAwaiting: document.querySelector("#summary-awaiting"),
  summaryAwaitingCount: document.querySelector("#summary-awaiting-count"),
  summaryReimbursed: document.querySelector("#summary-reimbursed"),
  summaryReimbursedCount: document.querySelector("#summary-reimbursed-count"),
  newEntryLink: document.querySelector("#new-entry-link"),
  listHeading: document.querySelector("#list-heading"),
  listCaption: document.querySelector("#list-caption"),
  expenseList: document.querySelector("#expense-list"),
  expenseCardTemplate: document.querySelector("#expense-card-template"),
  exportButton: document.querySelector("#export-button"),
  clearButton: document.querySelector("#clear-button"),
  importButton: document.querySelector("#import-button"),
  importInput: document.querySelector("#import-input"),
  storageStatus: document.querySelector("#storage-status"),
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

async function init() {
  bindEvents();
  await refreshExpenses();
  updateStorageStatus();
  registerServiceWorker();
}

function bindEvents() {
  elements.recordTypeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setCurrentRecordType(button.dataset.recordType);
    });
  });

  elements.summaryButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setCurrentView(button.dataset.view);
    });
  });

  elements.expenseList.addEventListener("click", handleExpenseAction);
  elements.expenseList.addEventListener("change", handleInlineDateUpdate);
  elements.exportButton.addEventListener("click", exportExpenses);
  elements.clearButton.addEventListener("click", clearAllEntries);
  elements.importButton.addEventListener("click", () => elements.importInput.click());
  elements.importInput.addEventListener("change", importExpenses);
}

async function refreshExpenses(options = {}) {
  try {
    state.expenses = sortExpenses(await getAllExpenses());
    renderSummary();
    renderListPanel();

    if (options.submittedOpenState) {
      restoreSubmittedOpenState(options.submittedOpenState, options.focusExpenseId);
    }
  } catch (error) {
    console.error(error);
    window.alert("Trip Ledger could not load your saved expenses.");
  }
}

function renderSummary() {
  const scopedExpenses = getScopedExpenses(state.expenses, state.currentRecordType);
  const summary = summarizeExpenses(scopedExpenses);
  updateSummaryCard(elements.summaryToSubmit, elements.summaryToSubmitCount, summary["to-submit"]);
  updateSummaryCard(elements.summaryAwaiting, elements.summaryAwaitingCount, summary.submitted);
  updateSummaryCard(elements.summaryReimbursed, elements.summaryReimbursedCount, summary.reimbursed);

  elements.recordTypeButtons.forEach((button) => {
    const isActive = button.dataset.recordType === state.currentRecordType;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", isActive ? "true" : "false");
  });

  elements.summaryButtons.forEach((button) => {
    const isActive = button.dataset.view === state.currentView;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", isActive ? "true" : "false");
  });

  if (elements.newEntryLink) {
    const isIncentive = state.currentRecordType === "incentive";
    elements.newEntryLink.textContent = isIncentive ? "New Incentive" : "New Expense";
    elements.newEntryLink.href = `expense.html?type=${encodeURIComponent(state.currentRecordType)}&view=${encodeURIComponent(state.currentView)}`;
  }
}

function updateSummaryCard(valueElement, countElement, summary) {
  valueElement.textContent = formatCurrency(summary.total);
  countElement.textContent = formatCount(summary.count);
}

function renderListPanel() {
  const currentView = getViewConfig(state.currentView);
  const scopedExpenses = getScopedExpenses(state.expenses, state.currentRecordType);
  const filteredExpenses = filterExpenses(scopedExpenses, state.currentView);
  const sortedExpenses = sortListExpenses(filteredExpenses);
  const total = filteredExpenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);

  elements.listHeading.textContent = getCurrentViewHeading(currentView);

  if (state.currentView === "submitted") {
    const reimbursementSchedule = buildAwaitingPayoutSchedule(filteredExpenses, state.currentRecordType);
    elements.listCaption.textContent =
      `${formatCount(filteredExpenses.length)} • ${formatCurrency(total)} • Tap a payout date to expand`;
    renderSubmittedExpenseGroups(filteredExpenses, currentView, reimbursementSchedule);
    return;
  }

  elements.listCaption.textContent = `${formatCount(filteredExpenses.length)} • ${formatCurrency(total)}`;
  renderExpenses(sortedExpenses, currentView);
}

function renderExpenses(expenses, currentView) {
  elements.expenseList.innerHTML = "";

  if (!expenses.length) {
    renderEmptyState(currentView);
    return;
  }

  expenses.forEach((expense, index) => {
    const card = buildExpenseCard(expense, index);
    elements.expenseList.appendChild(card);
  });
}

function renderEmptyState(currentView) {
  const emptyState = document.createElement("div");
  emptyState.className = "empty-state";
  emptyState.innerHTML = `
    <p><strong>${currentView.emptyTitle}</strong></p>
    <p>${currentView.emptyBody}</p>
  `;
  elements.expenseList.appendChild(emptyState);
}

function getScopedExpenses(expenses, recordType = state.currentRecordType) {
  return expenses.filter((expense) => getRecordType(expense) === recordType);
}

function getRecordType(expense) {
  return expense.recordType === "incentive" ? "incentive" : "expense";
}

function getCurrentViewHeading(currentView) {
  if (state.currentRecordType !== "incentive") {
    return currentView.label;
  }

  if (state.currentView === "submitted") {
    return "Awaiting incentive payout";
  }

  if (state.currentView === "reimbursed") {
    return "Paid incentives";
  }

  return "Ready to submit incentives";
}

function sortListExpenses(expenses) {
  return sortExpenses(expenses);
}

function renderSubmittedExpenseGroups(expenses, currentView, reimbursementSchedule) {
  elements.expenseList.innerHTML = "";

  if (!expenses.length) {
    renderEmptyState(currentView);
    return;
  }

  let cardIndex = 0;
  reimbursementSchedule.groups.forEach((group) => {
    const section = buildSubmittedExpenseGroup(group, cardIndex);
    cardIndex += group.expenses.length;
    elements.expenseList.appendChild(section);
  });
}

function buildSubmittedExpenseGroup(group, startIndex) {
  const section = document.createElement("details");
  const summary = document.createElement("summary");
  const summaryMain = document.createElement("div");
  const summaryLabel = document.createElement("span");
  const summaryRight = document.createElement("div");
  const summaryTotal = document.createElement("span");
  const chevron = document.createElement("span");
  const content = document.createElement("div");
  const note = document.createElement("p");
  const groupActions = document.createElement("div");
  const list = document.createElement("div");
  const total = group.expenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
  const tripGroups = buildTripExpenseGroups(group.expenses);

  section.className = "expense-group";
  section.dataset.groupKey = group.groupKey || group.fridayDate;
  summary.className = "expense-group-summary";
  summaryMain.className = "expense-group-summary-main";
  summaryLabel.className = "expense-group-summary-label";
  summaryLabel.textContent = group.displayLabel;
  summaryRight.className = "expense-group-summary-right";
  summaryTotal.className = "expense-group-summary-total";
  summaryTotal.textContent = formatCurrency(total);
  chevron.className = "accordion-chevron";
  chevron.setAttribute("aria-hidden", "true");
  chevron.textContent = "›";
  content.className = "expense-group-content";
  note.className = "expense-group-note";
  note.textContent = `${formatCount(group.expenses.length)} • ${group.noteText}`;
  groupActions.className = "expense-group-actions";
  list.className = "expense-group-list";

  summaryMain.append(summaryLabel);
  summaryRight.append(summaryTotal, chevron);
  summary.append(summaryMain, summaryRight);
  content.append(note, groupActions, list);
  section.append(summary, content);
  section.addEventListener("toggle", () => {
    if (section.open) {
      return;
    }

    section.querySelectorAll(".submitted-expense-item[open]").forEach((item) => {
      item.removeAttribute("open");
    });
  });

  if (!group.expenses.length) {
    const emptyState = document.createElement("p");
    emptyState.className = "expense-group-empty";
    emptyState.textContent = group.emptyText;
    list.appendChild(emptyState);
    return section;
  }

  groupActions.append(
    buildActionButton(
      "reimburse-group",
      state.currentRecordType === "incentive" ? "Mark payout reimbursed today" : "Mark week reimbursed today",
      "inline-button expense-group-button"
    )
  );

  tripGroups.forEach((tripGroup) => {
    list.appendChild(buildTripExpenseGroup(tripGroup, startIndex));
    startIndex += tripGroup.expenses.length;
  });

  return section;
}

function buildTripExpenseGroup(tripGroup, startIndex) {
  const wrapper = document.createElement("section");
  const header = document.createElement("div");
  const title = document.createElement("h3");
  const caption = document.createElement("p");
  const list = document.createElement("div");
  const total = tripGroup.expenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);

  wrapper.className = "trip-group";
  header.className = "trip-group-header";
  title.className = "trip-group-title";
  title.textContent = tripGroup.label;
  caption.className = "trip-group-caption";
  caption.textContent = `${formatCount(tripGroup.expenses.length)} • ${formatCurrency(total)}`;
  list.className = "trip-group-list";

  header.append(title, caption);
  wrapper.append(header, list);

  tripGroup.expenses.forEach((expense, index) => {
    list.appendChild(buildSubmittedExpenseItem(expense, startIndex + index));
  });

  return wrapper;
}

function buildSubmittedExpenseItem(expense, index) {
  const item = document.createElement("details");
  const summary = document.createElement("summary");
  const line = document.createElement("div");
  const date = document.createElement("span");
  const title = document.createElement("span");
  const summaryRight = document.createElement("div");
  const amount = document.createElement("span");
  const chevron = document.createElement("span");
  const body = document.createElement("div");
  const meta = document.createElement("p");
  const dateGrid = document.createElement("div");
  const badges = document.createElement("div");
  const location = buildExpenseTextLine("expense-location", expense.location);
  const notes = buildExpenseTextLine("expense-notes", expense.notes);
  const photo = buildExpensePhoto(expense);
  const actions = document.createElement("div");

  item.className = "submitted-expense-item";
  item.dataset.expenseId = expense.id;
  item.style.animationDelay = `${Math.min(index, 6) * 0.04 + 0.05}s`;

  summary.className = "submitted-expense-summary";
  line.className = "submitted-expense-line";
  date.className = "submitted-expense-date";
  date.textContent = formatShortDate(expense.date);
  title.className = "submitted-expense-title";
  title.textContent = expense.merchant;
  summaryRight.className = "submitted-expense-summary-right";
  amount.className = "submitted-expense-summary-amount";
  amount.textContent = formatCurrency(expense.amount || 0);
  chevron.className = "accordion-chevron";
  chevron.setAttribute("aria-hidden", "true");
  chevron.textContent = "›";
  body.className = "submitted-expense-body";
  meta.className = "submitted-expense-meta";
  meta.textContent = buildExpenseMetaText(expense);
  dateGrid.className = "submitted-expense-date-grid";
  dateGrid.append(
    buildInlineDateField("Expense date", "date", expense.date),
    buildInlineDateField("Submitted", "submittedDate", expense.submittedDate),
    buildReadOnlyDateField(
      "Reimbursed",
      expense.reimbursedDate ? formatDate(expense.reimbursedDate) : "Not yet"
    )
  );
  badges.className = "expense-badges";
  badges.append(...buildExpenseBadgeNodes(expense));
  actions.className = "expense-actions";
  actions.append(...buildExpenseActionButtons(expense));

  line.append(date, title);
  summaryRight.append(amount, chevron);
  summary.append(line, summaryRight);
  body.append(meta, dateGrid, badges);

  if (location) {
    body.append(location);
  }

  if (notes) {
    body.append(notes);
  }

  if (photo) {
    body.append(photo);
  }

  body.append(actions);
  item.append(summary, body);
  return item;
}

function buildAwaitingPayoutSchedule(expenses, recordType = state.currentRecordType) {
  const today = getToday();
  const groupsByPayoutDate = new Map();

  expenses.forEach((expense) => {
    const payoutDate =
      recordType === "incentive"
        ? getExpectedIncentivePayoutDate(expense.submittedDate)
        : getExpectedReimbursementFriday(expense.submittedDate);
    const existingGroup = groupsByPayoutDate.get(payoutDate);

    if (existingGroup) {
      existingGroup.expenses.push(expense);
      return;
    }

    groupsByPayoutDate.set(payoutDate, {
      payoutDate,
      expenses: [expense],
    });
  });

  return {
    groups: Array.from(groupsByPayoutDate.values())
      .sort((left, right) => left.payoutDate.localeCompare(right.payoutDate))
      .map((group) => ({
        fridayDate: group.payoutDate,
        groupKey: group.payoutDate,
        displayLabel:
          recordType === "incentive"
            ? formatDate(group.payoutDate)
            : formatShortFridayDate(group.payoutDate),
        expenses: sortReimbursementExpenses(group.expenses),
        noteText: buildReimbursementGroupNote(group.payoutDate, today, recordType),
        emptyText:
          recordType === "incentive"
            ? `No incentives are still waiting for ${formatDate(group.payoutDate)}.`
            : `No expenses are still waiting for ${formatFridayDate(group.payoutDate)}.`,
      })),
  };
}

function sortReimbursementExpenses(expenses) {
  return [...expenses].sort(compareSubmittedExpenseRecency);
}

function normalizeTripSortValue(value) {
  return String(value || "").trim();
}

function compareRecentExpense(left, right) {
  const leftKey = `${left.date || ""}-${left.updatedAt || left.createdAt || ""}`;
  const rightKey = `${right.date || ""}-${right.updatedAt || right.createdAt || ""}`;
  return rightKey.localeCompare(leftKey);
}

function compareSubmittedExpenseRecency(left, right) {
  const leftKey = `${left.submittedDate || ""}-${left.date || ""}-${left.updatedAt || left.createdAt || ""}`;
  const rightKey = `${right.submittedDate || ""}-${right.date || ""}-${right.updatedAt || right.createdAt || ""}`;
  return rightKey.localeCompare(leftKey);
}

function buildTripExpenseGroups(expenses) {
  const sortedByDate = [...expenses].sort(compareExpenseDayAscending);
  const groups = new Map();

  sortedByDate.forEach((expense) => {
    const tripNumber = normalizeTripSortValue(expense.tripNumber);
    const tripKey = tripNumber || "__no_trip__";

    if (!groups.has(tripKey)) {
      groups.set(tripKey, {
        key: tripKey,
        label: tripNumber ? `Trip # ${tripNumber}` : "No Trip #",
        tripNumber,
        firstDate: expense.date,
        expenses: [],
      });
    }

    const group = groups.get(tripKey);
    group.expenses.push(expense);
    if (expense.date < group.firstDate) {
      group.firstDate = expense.date;
    }
  });

  return Array.from(groups.values()).sort((left, right) => {
    if (Boolean(left.tripNumber) !== Boolean(right.tripNumber)) {
      return left.tripNumber ? -1 : 1;
    }

    const firstDateCompare = left.firstDate.localeCompare(right.firstDate);
    if (firstDateCompare !== 0) {
      return firstDateCompare;
    }

    return left.label.localeCompare(right.label, undefined, {
      numeric: true,
      sensitivity: "base",
    });
  });
}

function compareExpenseDayAscending(left, right) {
  const leftKey = `${left.date || ""}-${left.merchant || ""}-${left.updatedAt || left.createdAt || ""}`;
  const rightKey = `${right.date || ""}-${right.merchant || ""}-${right.updatedAt || right.createdAt || ""}`;
  return leftKey.localeCompare(rightKey);
}

function getExpectedReimbursementFriday(submittedDate) {
  const upcomingFriday = getUpcomingFriday(submittedDate);
  const cutoffMonday = getMondayForWeekContaining(upcomingFriday);

  if (submittedDate <= cutoffMonday) {
    return upcomingFriday;
  }

  return addDaysToIsoDate(upcomingFriday, 7);
}

function getExpectedIncentivePayoutDate(submittedDate) {
  const submitted = parseIsoDate(submittedDate);
  if (!submitted) {
    return submittedDate;
  }

  const payoutDate = new Date(submitted.getFullYear(), submitted.getMonth(), 15);
  if (submitted.getDate() <= 15) {
    return toIsoDate(payoutDate);
  }

  payoutDate.setMonth(payoutDate.getMonth() + 1, 15);
  return toIsoDate(payoutDate);
}

function getExpectedPayoutDate(expense, recordType = state.currentRecordType) {
  return recordType === "incentive"
    ? getExpectedIncentivePayoutDate(expense.submittedDate)
    : getExpectedReimbursementFriday(expense.submittedDate);
}

function getUpcomingFriday(fromDate = getToday()) {
  const date = parseIsoDate(fromDate);
  if (!date) {
    return fromDate;
  }

  const daysUntilFriday = (5 - date.getDay() + 7) % 7;
  date.setDate(date.getDate() + daysUntilFriday);
  return toIsoDate(date);
}

function buildReimbursementGroupNote(payoutDate, today = getToday(), recordType = state.currentRecordType) {
  const label = recordType === "incentive" ? formatDate(payoutDate) : formatFridayDate(payoutDate);
  const noun = recordType === "incentive" ? "incentive payout" : "reimbursement";

  if (payoutDate < today) {
    return `Expected on ${label} and still awaiting ${noun}.`;
  }

  if (payoutDate === today) {
    return recordType === "incentive" ? "Expected incentive payout today." : "Expected reimbursement today.";
  }

  return `Expected ${noun} on ${label}.`;
}

function getMondayForWeekContaining(value) {
  const date = parseIsoDate(value);
  if (!date) {
    return value;
  }

  const daysSinceMonday = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - daysSinceMonday);
  return toIsoDate(date);
}

function addDaysToIsoDate(value, days) {
  const date = parseIsoDate(value);
  if (!date) {
    return value;
  }

  date.setDate(date.getDate() + days);
  return toIsoDate(date);
}

function parseIsoDate(value) {
  const [year, month, day] = String(value || "")
    .split("-")
    .map(Number);

  if (!year || !month || !day) {
    return null;
  }

  return new Date(year, month - 1, day);
}

function toIsoDate(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function formatFridayDate(value) {
  return `Fri ${formatDate(value)}`;
}

function formatShortFridayDate(value) {
  return `Fri ${formatShortDate(value)}`;
}

function formatPayoutGroupLabel(value, recordType = state.currentRecordType) {
  return recordType === "incentive" ? formatDate(value) : formatFridayDate(value);
}

function formatShortDate(value) {
  const date = parseIsoDate(value);
  if (!date) {
    return value;
  }

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function buildExpenseCard(expense, index) {
  const fragment = elements.expenseCardTemplate.content.cloneNode(true);
  const card = fragment.querySelector(".expense-card");
  const merchant = fragment.querySelector(".expense-merchant");
  const meta = fragment.querySelector(".expense-meta");
  const amount = fragment.querySelector(".expense-amount");
  const badges = fragment.querySelector(".expense-badges");
  const location = fragment.querySelector(".expense-location");
  const notes = fragment.querySelector(".expense-notes");
  const photo = fragment.querySelector(".expense-photo");
  const timeline = fragment.querySelector(".expense-timeline");
  const actions = fragment.querySelector(".expense-actions");

  card.dataset.expenseId = expense.id;
  card.style.animationDelay = `${Math.min(index, 6) * 0.04 + 0.05}s`;

  merchant.textContent = expense.merchant;
  meta.textContent = buildExpenseMetaText(expense);
  amount.textContent = formatCurrency(expense.amount || 0);

  badges.replaceChildren(...buildExpenseBadgeNodes(expense));

  location.hidden = !expense.location;
  location.textContent = expense.location || "";

  notes.hidden = !expense.notes;
  notes.textContent = expense.notes || "";

  photo.hidden = !expense.photoDataUrl;
  if (expense.photoDataUrl) {
    photo.src = expense.photoDataUrl;
  } else {
    photo.removeAttribute("src");
  }

  timeline.replaceChildren(...buildExpenseTimelineNodes(expense));
  actions.replaceChildren(...buildExpenseActionButtons(expense));

  return fragment;
}

function buildExpenseBadgeNodes(expense) {
  const statusBadge = document.createElement("span");
  const categoryBadge = document.createElement("span");
  const tripBadge = document.createElement("span");
  const badges = [];

  statusBadge.className = `badge ${getStatusBadgeClass(expense)}`;
  statusBadge.textContent = getStatusLabel(expense);
  categoryBadge.className = "badge badge-category";
  categoryBadge.textContent = expense.category;
  badges.push(statusBadge, categoryBadge);

  if (expense.tripNumber) {
    tripBadge.className = "badge badge-trip";
    tripBadge.textContent = `Trip # ${expense.tripNumber}`;
    badges.push(tripBadge);
  }

  return badges;
}

function buildExpenseTimelineNodes(expense) {
  return [
    buildTimelineCell("Expense", formatDate(expense.date)),
    buildTimelineCell("Submitted", expense.submittedDate ? formatDate(expense.submittedDate) : "Not yet"),
    buildTimelineCell("Reimbursed", expense.reimbursedDate ? formatDate(expense.reimbursedDate) : "Not yet"),
  ];
}

function buildExpenseActionButtons(expense) {
  const buttons = [];
  const quickStatusLabel = getQuickStatusLabel(expense);

  if (quickStatusLabel) {
    buttons.push(buildActionButton("quick-status", quickStatusLabel));
  }

  buttons.push(buildActionButton("edit", "Edit"));
  buttons.push(buildActionButton("delete", "Delete", "inline-button danger-inline"));
  return buttons;
}

function buildActionButton(action, label, className = "inline-button") {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.action = action;
  button.className = className;
  button.textContent = label;
  return button;
}

function buildExpenseTextLine(className, value) {
  if (!value) {
    return null;
  }

  const element = document.createElement("p");
  element.className = className;
  element.textContent = value;
  return element;
}

function buildExpensePhoto(expense) {
  if (!expense.photoDataUrl) {
    return null;
  }

  const photo = document.createElement("img");
  photo.className = "expense-photo";
  photo.alt = "Receipt photo";
  photo.src = expense.photoDataUrl;
  return photo;
}

function buildExpenseMetaText(expense) {
  const parts = [formatDate(expense.date), expense.category];

  if (expense.tripNumber) {
    parts.push(`Trip # ${expense.tripNumber}`);
  }

  return parts.join(" • ");
}

function buildInlineDateField(label, field, value) {
  const wrapper = document.createElement("label");
  const title = document.createElement("span");
  const input = document.createElement("input");

  wrapper.className = "submitted-expense-date-field";
  title.className = "submitted-expense-date-label";
  title.textContent = label;
  input.className = "submitted-expense-date-input";
  input.type = "date";
  input.value = value || "";
  input.required = true;
  input.dataset.action = "update-date";
  input.dataset.field = field;

  wrapper.append(title, input);
  return wrapper;
}

function buildReadOnlyDateField(label, value) {
  const wrapper = document.createElement("div");
  const title = document.createElement("span");
  const text = document.createElement("span");

  wrapper.className = "submitted-expense-date-field";
  title.className = "submitted-expense-date-label";
  title.textContent = label;
  text.className = "submitted-expense-date-value";
  text.textContent = value;

  wrapper.append(title, text);
  return wrapper;
}

function buildTimelineCell(label, value) {
  const wrapper = document.createElement("div");
  const dt = document.createElement("dt");
  const dd = document.createElement("dd");
  dt.textContent = label;
  dd.textContent = value;
  wrapper.append(dt, dd);
  return wrapper;
}

async function handleExpenseAction(event) {
  const actionButton = event.target.closest("[data-action]");
  if (!actionButton) {
    return;
  }

  const action = actionButton.dataset.action;

  if (action === "reimburse-group") {
    const group = actionButton.closest("[data-group-key]");
    const fridayDate = group?.dataset.groupKey;
    if (!fridayDate) {
      return;
    }

    await reimburseExpenseGroup(fridayDate);
    return;
  }

  const expenseContainer = actionButton.closest("[data-expense-id]");
  const id = expenseContainer?.dataset.expenseId;
  const expense = state.expenses.find((entry) => entry.id === id);
  if (!expense) {
    return;
  }

  if (action === "edit") {
    const targetUrl = new URL("./expense.html", window.location.href);
    targetUrl.searchParams.set("id", expense.id);
    targetUrl.searchParams.set("view", state.currentView);
    targetUrl.searchParams.set("type", getRecordType(expense));
    window.location.href = targetUrl.toString();
    return;
  }

  if (action === "delete") {
    const confirmed = window.confirm(`Delete ${expense.merchant}?`);
    if (!confirmed) {
      return;
    }

    try {
      const submittedOpenState = captureSubmittedOpenState();
      await deleteExpense(id);
      await refreshExpenses({ submittedOpenState });
    } catch (error) {
      console.error(error);
      window.alert("Trip Ledger could not delete this expense.");
    }
    return;
  }

  if (action === "quick-status") {
    const today = getToday();
    const updatedExpense = {
      ...expense,
      submittedDate: expense.submittedDate || today,
      reimbursedDate: expense.reimbursedDate || (expense.submittedDate ? today : ""),
      updatedAt: new Date().toISOString(),
    };

    if (expense.submittedDate && !expense.reimbursedDate) {
      updatedExpense.reimbursedDate = today;
    }

    try {
      const submittedOpenState = captureSubmittedOpenState();
      await saveExpense(updatedExpense);
      await refreshExpenses({ submittedOpenState });
    } catch (error) {
      console.error(error);
      window.alert("Trip Ledger could not update the expense status.");
    }
  }
}

async function reimburseExpenseGroup(groupKey) {
  const submittedExpenses = filterExpenses(
    getScopedExpenses(state.expenses, state.currentRecordType),
    "submitted"
  ).filter(
    (expense) => getExpectedPayoutDate(expense, state.currentRecordType) === groupKey
  );

  if (!submittedExpenses.length) {
    return;
  }

  const confirmed = window.confirm(
    `Mark all ${submittedExpenses.length} ${submittedExpenses.length === 1 ? "entry" : "entries"} in ${formatPayoutGroupLabel(groupKey, state.currentRecordType)} as reimbursed today?`
  );
  if (!confirmed) {
    return;
  }

  const today = getToday();
  const submittedOpenState = captureSubmittedOpenState();

  try {
    await Promise.all(
      submittedExpenses.map((expense) =>
        saveExpense({
          ...expense,
          reimbursedDate: today,
          updatedAt: new Date().toISOString(),
        })
      )
    );
    await refreshExpenses({ submittedOpenState });
  } catch (error) {
    console.error(error);
    window.alert("Trip Ledger could not mark that payout group as paid.");
  }
}

async function handleInlineDateUpdate(event) {
  const input = event.target.closest('[data-action="update-date"]');
  if (!input) {
    return;
  }

  const expenseContainer = input.closest("[data-expense-id]");
  const id = expenseContainer?.dataset.expenseId;
  const expense = state.expenses.find((entry) => entry.id === id);
  if (!expense) {
    return;
  }

  const field = input.dataset.field;
  const nextValue = input.value;
  const previousValue = expense[field] || "";

  if (!field) {
    return;
  }

  if (!nextValue) {
    input.value = previousValue;
    window.alert("That date cannot be blank.");
    return;
  }

  if (nextValue === previousValue) {
    return;
  }

  const updatedExpense = {
    ...expense,
    [field]: nextValue,
    updatedAt: new Date().toISOString(),
  };
  const validationError = validateDates(updatedExpense);

  if (validationError) {
    input.value = previousValue;
    window.alert(validationError);
    return;
  }

  const submittedOpenState = captureSubmittedOpenState();

  try {
    await saveExpense(updatedExpense);
    await refreshExpenses({
      submittedOpenState,
      focusExpenseId: expense.id,
    });
  } catch (error) {
    console.error(error);
    input.value = previousValue;
    window.alert("Trip Ledger could not update that date.");
  }
}

function captureSubmittedOpenState() {
  if (state.currentView !== "submitted") {
    return null;
  }

  return {
    groups: Array.from(elements.expenseList.querySelectorAll(".expense-group[open]"), (group) => group.dataset.groupKey),
    expenses: Array.from(
      elements.expenseList.querySelectorAll(".submitted-expense-item[open]"),
      (item) => item.dataset.expenseId
    ),
  };
}

function restoreSubmittedOpenState(openState, focusExpenseId = "") {
  if (!openState || state.currentView !== "submitted") {
    return;
  }

  const groupsByKey = new Map(
    Array.from(elements.expenseList.querySelectorAll(".expense-group"), (group) => [
      group.dataset.groupKey,
      group,
    ])
  );
  const expensesById = new Map(
    Array.from(elements.expenseList.querySelectorAll(".submitted-expense-item"), (item) => [
      item.dataset.expenseId,
      item,
    ])
  );

  openState.groups.filter(Boolean).forEach((key) => {
    groupsByKey.get(key)?.setAttribute("open", "");
  });

  if (focusExpenseId) {
    const focusedExpense = expensesById.get(focusExpenseId);
    const parentGroup = focusedExpense?.closest(".expense-group");
    parentGroup?.setAttribute("open", "");
    focusedExpense?.setAttribute("open", "");
  }

  openState.expenses.filter(Boolean).forEach((id) => {
    const item = expensesById.get(id);
    const parentGroup = item?.closest(".expense-group");

    if (!item || !parentGroup?.open) {
      return;
    }

    item.setAttribute("open", "");
  });
}

function setCurrentView(view, options = {}) {
  state.currentView = getViewConfig(view).key;
  renderSummary();
  renderListPanel();

  if (options.updateHistory !== false) {
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("view", state.currentView);
    nextUrl.searchParams.set("type", state.currentRecordType);
    window.history.replaceState({}, "", nextUrl);
  }
}

function getInitialView() {
  const view = new URLSearchParams(window.location.search).get("view");
  return getViewConfig(view).key;
}

function getInitialRecordType() {
  const value = new URLSearchParams(window.location.search).get("type");
  return value === "incentive" ? "incentive" : "expense";
}

function setCurrentRecordType(recordType, options = {}) {
  state.currentRecordType = recordType === "incentive" ? "incentive" : "expense";
  renderSummary();
  renderListPanel();

  if (options.updateHistory !== false) {
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("view", state.currentView);
    nextUrl.searchParams.set("type", state.currentRecordType);
    window.history.replaceState({}, "", nextUrl);
  }
}

function exportExpenses() {
  const payload = buildExportPayload(state.expenses);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `trip-ledger-backup-${getToday()}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function clearAllEntries() {
  const entryCount = state.expenses.length;

  if (!entryCount) {
    window.alert("There are no saved entries to delete.");
    return;
  }

  const confirmed = window.confirm(
    `Delete all ${entryCount} saved ${entryCount === 1 ? "entry" : "entries"} from this device? Make sure you have exported a backup first.`
  );
  if (!confirmed) {
    return;
  }

  const finalConfirmed = window.confirm(
    "This will remove every saved expense and incentive from this device. This cannot be undone unless you import a backup."
  );
  if (!finalConfirmed) {
    return;
  }

  try {
    await clearAllExpenses();
    state.expenses = [];
    renderSummary();
    renderListPanel();
    window.alert("All saved entries have been deleted from this device.");
  } catch (error) {
    console.error(error);
    window.alert("Trip Ledger could not delete all saved entries.");
  }
}

async function importExpenses(event) {
  const [file] = event.target.files || [];
  if (!file) {
    return;
  }

  try {
    const text = await file.text();
    if (isCsvExpenseImport(file, text)) {
      const importedExpenses = parseCsvExpenseImport(text);

      if (!importedExpenses.length) {
        window.alert("That CSV file did not contain any expenses I could import.");
        return;
      }

      for (const importedExpense of importedExpenses) {
        await saveExpense(await resolveCsvExpenseForSave(importedExpense));
      }

      await refreshExpenses();
      window.alert(`Imported or updated ${importedExpenses.length} expenses from CSV.`);
      return;
    }

    const parsed = JSON.parse(text);
    const importedExpenses = Array.isArray(parsed.expenses) ? parsed.expenses : [];

    if (!importedExpenses.length) {
      window.alert("That backup file did not contain any expenses.");
      return;
    }

    for (const rawExpense of importedExpenses) {
      await saveExpense(normalizeImportedExpense(rawExpense, createId));
    }

    await refreshExpenses();
    window.alert(`Imported ${importedExpenses.length} expenses.`);
  } catch (error) {
    console.error(error);
    window.alert("Trip Ledger could not import that file. Use a Trip Ledger JSON backup or an accounting CSV export.");
  } finally {
    elements.importInput.value = "";
  }
}

function isCsvExpenseImport(file, text) {
  if (/\.csv$/i.test(file.name || "")) {
    return true;
  }

  const firstLine = text.trim().split(/\r?\n/, 1)[0] || "";
  return /date z/i.test(firstLine) && /vendor/i.test(firstLine) && /total amount/i.test(firstLine);
}

function parseCsvExpenseImport(text) {
  const rows = parseCsvRows(text);
  if (!rows.length) {
    return [];
  }

  const headers = rows[0].map((header) => header.trim());
  return rows
    .slice(1)
    .map((values, index) => buildCsvExpenseRecord(headers, values, index))
    .filter(Boolean);
}

function parseCsvRows(text) {
  const rows = [];
  const normalizedText = text.replace(/^\uFEFF/, "");
  let currentRow = [];
  let currentField = "";
  let inQuotes = false;

  for (let index = 0; index < normalizedText.length; index += 1) {
    const character = normalizedText[index];
    const nextCharacter = normalizedText[index + 1];

    if (character === "\"") {
      if (inQuotes && nextCharacter === "\"") {
        currentField += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (character === "," && !inQuotes) {
      currentRow.push(currentField);
      currentField = "";
      continue;
    }

    if ((character === "\n" || character === "\r") && !inQuotes) {
      if (character === "\r" && nextCharacter === "\n") {
        index += 1;
      }
      currentRow.push(currentField);
      if (currentRow.some((value) => value.trim())) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentField = "";
      continue;
    }

    currentField += character;
  }

  currentRow.push(currentField);
  if (currentRow.some((value) => value.trim())) {
    rows.push(currentRow);
  }

  return rows;
}

function buildCsvExpenseRecord(headers, values, rowIndex) {
  const row = Object.fromEntries(headers.map((header, index) => [header, values[index] || ""]));
  const amount = parseCurrencyAmount(row.Amount || "");
  const legacyTotalAmount = parseCurrencyAmount(row["Total amount"] || row["Total Amount"] || "");
  const merchant = String(row.Vendor || "").trim();
  const date = normalizeCsvDate(row["Date Z"] || row.Date || "");

  if (!date) {
    return null;
  }

  if (!(amount > 0)) {
    return null;
  }

  const rawCategory = String(row.Category || "").trim();
  const tripNumber = String(row["Trip #"] || "").trim();
  const normalizedAmount = Number(amount.toFixed(2));
  const normalizedDate = date;
  const merchantName = merchant || `Imported expense ${rowIndex + 1}`;
  const idSeed = [
    normalizedDate,
    merchantName,
    rawCategory,
    rowIndex,
  ].join("|");
  const legacyIds = [];

  if (legacyTotalAmount > 0) {
    legacyIds.push(
      buildImportedCsvId(
        [
          normalizedDate,
          merchantName,
          rawCategory,
          Number(legacyTotalAmount.toFixed(2)).toFixed(2),
          rowIndex,
        ].join("|")
      )
    );
  }

  legacyIds.push(
    buildImportedCsvId(
      [
        normalizedDate,
        merchantName,
        rawCategory,
        normalizedAmount.toFixed(2),
        rowIndex,
      ].join("|")
    )
  );

  return {
    expense: {
      id: buildImportedCsvId(idSeed),
      amount: normalizedAmount,
      merchant: merchantName,
      category: mapCsvCategory(rawCategory, merchant),
      tripNumber,
      date: normalizedDate,
      location: "",
      notes: "",
      submittedDate: "",
      reimbursedDate: "",
      photoDataUrl: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    legacyIds: [...new Set(legacyIds)].filter((id) => id !== buildImportedCsvId(idSeed)),
  };
}

async function resolveCsvExpenseForSave(importedExpense) {
  const existingExpense =
    (await getExpense(importedExpense.expense.id)) ||
    (await findExistingCsvExpense(importedExpense.legacyIds));

  if (!existingExpense) {
    return importedExpense.expense;
  }

  return {
    ...existingExpense,
    amount: importedExpense.expense.amount,
    merchant: importedExpense.expense.merchant,
    category: importedExpense.expense.category,
    tripNumber: importedExpense.expense.tripNumber || existingExpense.tripNumber || "",
    date: importedExpense.expense.date,
    updatedAt: new Date().toISOString(),
  };
}

async function findExistingCsvExpense(legacyIds) {
  for (const legacyId of legacyIds) {
    const expense = await getExpense(legacyId);
    if (expense) {
      return expense;
    }
  }

  return null;
}

function parseCurrencyAmount(value) {
  const normalized = String(value || "").replace(/[^0-9.-]/g, "");
  const amount = Number.parseFloat(normalized);
  return Number.isFinite(amount) ? amount : 0;
}

function normalizeCsvDate(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return "";
  }

  const numericMatch = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (!numericMatch) {
    return "";
  }

  const month = Number(numericMatch[1]);
  const day = Number(numericMatch[2]);
  let year = Number(numericMatch[3]);

  if (year < 100) {
    year += year >= 70 ? 1900 : 2000;
  }

  if (
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    !Number.isInteger(year) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return "";
  }

  const candidate = new Date(year, month - 1, day);
  if (
    candidate.getFullYear() !== year ||
    candidate.getMonth() !== month - 1 ||
    candidate.getDate() !== day
  ) {
    return "";
  }

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function mapCsvCategory(rawCategory, merchant) {
  const categoryText = `${rawCategory} ${merchant}`.toLowerCase();

  if (/(hotel|lodging|marriott|inn|resort|suites)/.test(categoryText)) {
    return "Lodging";
  }

  if (/(meal|coffee|restaurant|bbq|ramen|bar|grill|cafe|breakfast|lunch|dinner)/.test(categoryText)) {
    return "Meal";
  }

  if (/(airline|flight|american airlines|delta|southwest|united|jetblue|alaska)/.test(categoryText)) {
    return "Flight";
  }

  if (/(uber|lyft|ground|transport|taxi|parking|rental|fuel|ramp fee|facility fee|shuttle|aviation)/.test(categoryText)) {
    return "Transport";
  }

  if (/(supplies|office|staples|fedex|ups)/.test(categoryText)) {
    return "Supplies";
  }

  return "Miscellaneous";
}

function buildImportedCsvId(seed) {
  let hash = 5381;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 33) ^ seed.charCodeAt(index);
  }
  return `csv-${(hash >>> 0).toString(36)}`;
}

async function updateStorageStatus() {
  if (!elements.storageStatus) {
    return;
  }

  const baseMessage = "Saved on this device. Export a backup regularly for safety.";

  if (!navigator.storage?.persisted || !navigator.storage?.persist) {
    elements.storageStatus.textContent = baseMessage;
    return;
  }

  try {
    let persisted = await navigator.storage.persisted();
    if (!persisted) {
      persisted = await navigator.storage.persist();
    }

    if (persisted) {
      elements.storageStatus.textContent =
        "Saved on this device with persistent browser storage when supported. Backups are still a good habit.";
      return;
    }
  } catch (error) {
    console.error("Could not determine storage persistence.", error);
  }

  elements.storageStatus.textContent = baseMessage;
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch((error) => {
      console.error("Service worker registration failed", error);
    });
  });
}
