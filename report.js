import {
  formatCurrency,
  getAllExpenses,
  getStatusKey,
  getToday,
  sortExpenses,
} from "./storage.js";
import { createExpenseReportWorkbookBlob } from "./report-export.js";

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const state = {
  expenses: [],
  reportUrl: "",
};

const elements = {
  startDate: document.querySelector("#report-start-date"),
  endDate: document.querySelector("#report-end-date"),
  preview: document.querySelector("#report-preview"),
  status: document.querySelector("#report-status"),
  exportButton: document.querySelector("#report-export-button"),
  downloadLink: document.querySelector("#report-download-link"),
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

async function init() {
  bindEvents();
  await loadExpenses();
  registerServiceWorker();
}

function bindEvents() {
  elements.startDate.addEventListener("input", updatePreview);
  elements.endDate.addEventListener("input", updatePreview);
  elements.exportButton.addEventListener("click", exportReport);
  window.addEventListener("pagehide", revokeReportUrl);
}

async function loadExpenses() {
  try {
    state.expenses = sortExpenses(await getAllExpenses());
    seedDateRange();
    updatePreview();
  } catch (error) {
    console.error(error);
    elements.preview.textContent = "Trip Ledger could not load your saved entries for the report.";
    elements.exportButton.disabled = true;
  }
}

function seedDateRange() {
  const dates = state.expenses
    .map((expense) => expense.date)
    .filter(Boolean)
    .sort();
  const fallbackDate = getToday();

  elements.startDate.value = dates[0] || fallbackDate;
  elements.endDate.value = dates[dates.length - 1] || fallbackDate;
}

function updatePreview() {
  clearPreparedReport();
  const { startDate, endDate, error } = getReportDateRange();

  if (error) {
    elements.preview.textContent = error;
    elements.exportButton.disabled = true;
    return;
  }

  const expenses = getExpensesInReportRange(startDate, endDate);
  if (!expenses.length) {
    elements.preview.textContent = "No expenses or incentives fall in that date range.";
    elements.exportButton.disabled = true;
    return;
  }

  const total = expenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
  const expenseCount = expenses.filter((expense) => getRecordType(expense) === "expense").length;
  const incentiveCount = expenses.length - expenseCount;
  const parts = [];

  if (expenseCount) {
    parts.push(`${expenseCount} ${expenseCount === 1 ? "expense" : "expenses"}`);
  }

  if (incentiveCount) {
    parts.push(`${incentiveCount} ${incentiveCount === 1 ? "incentive" : "incentives"}`);
  }

  elements.preview.textContent =
    `${formatEntryCount(expenses.length)} • ${formatCurrency(total)} • ${parts.join(", ")}`;
  elements.exportButton.disabled = false;
}

function exportReport() {
  const { startDate, endDate, error } = getReportDateRange();

  if (error) {
    window.alert(error);
    return;
  }

  const rows = buildReportRows(startDate, endDate);
  if (!rows.length) {
    window.alert("There are no expenses or incentives in that date range.");
    return;
  }

  try {
    elements.exportButton.disabled = true;
    elements.exportButton.textContent = "Preparing...";
    elements.status.textContent = "";

    const filename = `trip-ledger-report-${startDate}-to-${endDate}.xlsx`;
    const blob = createExpenseReportWorkbookBlob({
      generatedAt: new Date().toISOString(),
      rows,
    });

    prepareDownloadLink(blob, filename);

    if (tryShareReport(blob, filename)) {
      elements.status.textContent = "Report is ready. If the share sheet does not open, tap Open Excel File.";
      return;
    }

    elements.downloadLink.click();
    elements.status.textContent = "Report is ready. If the download does not open, tap Open Excel File.";
  } catch (error) {
    console.error(error);
    window.alert("Trip Ledger could not export that Excel report.");
  } finally {
    elements.exportButton.disabled = false;
    elements.exportButton.textContent = "Export Excel Report";
  }
}

function prepareDownloadLink(blob, filename) {
  revokeReportUrl();
  state.reportUrl = URL.createObjectURL(blob);
  elements.downloadLink.href = state.reportUrl;
  elements.downloadLink.download = filename;
  elements.downloadLink.hidden = false;
}

function tryShareReport(blob, filename) {
  if (
    typeof navigator === "undefined" ||
    typeof navigator.share !== "function" ||
    typeof navigator.canShare !== "function" ||
    typeof File === "undefined"
  ) {
    return false;
  }

  const file = new File([blob], filename, {
    type: XLSX_MIME,
    lastModified: Date.now(),
  });

  if (!navigator.canShare({ files: [file] })) {
    return false;
  }

  navigator.share({
    title: filename,
    files: [file],
  }).catch((error) => {
    if (error?.name !== "AbortError") {
      console.error("Trip Ledger could not open the report share sheet.", error);
      elements.status.textContent = "Report is ready. Tap Open Excel File to open it.";
    }
  });

  return true;
}

function clearPreparedReport() {
  elements.status.textContent = "";
  elements.downloadLink.hidden = true;
  elements.downloadLink.removeAttribute("href");
  elements.downloadLink.removeAttribute("download");
  revokeReportUrl();
}

function revokeReportUrl() {
  if (!state.reportUrl) {
    return;
  }

  URL.revokeObjectURL(state.reportUrl);
  state.reportUrl = "";
}

function getReportDateRange() {
  const startDate = elements.startDate.value || "";
  const endDate = elements.endDate.value || "";

  if (!startDate || !endDate) {
    return {
      startDate,
      endDate,
      error: "Choose both a start date and an end date for the report.",
    };
  }

  if (endDate < startDate) {
    return {
      startDate,
      endDate,
      error: "The report end date cannot be earlier than the start date.",
    };
  }

  return { startDate, endDate, error: "" };
}

function getExpensesInReportRange(startDate, endDate) {
  return [...state.expenses]
    .filter((expense) => {
      const expenseDate = String(expense.date || "");
      return expenseDate && expenseDate >= startDate && expenseDate <= endDate;
    })
    .sort(compareReportExpenseRows);
}

function buildReportRows(startDate, endDate) {
  return getExpensesInReportRange(startDate, endDate).map((expense) => {
    const recordType = getRecordType(expense);
    return {
      recordType: recordType === "incentive" ? "Incentive" : "Expense",
      status: getDetailedStatusLabel(expense, recordType),
      expectedPayoutDate: expense.submittedDate ? getExpectedPayoutDate(expense, recordType) : "",
      amount: Number(expense.amount || 0),
      vendor: expense.merchant || "",
      category: expense.category || "",
      tripNumber: expense.tripNumber || "",
      expenseDate: expense.date || "",
      submittedDate: expense.submittedDate || "",
      reimbursedDate: expense.reimbursedDate || "",
      location: expense.location || "",
      notes: expense.notes || "",
    };
  });
}

function compareReportExpenseRows(left, right) {
  const dateCompare = String(left.date || "").localeCompare(String(right.date || ""));
  if (dateCompare !== 0) {
    return dateCompare;
  }

  const typeCompare = getRecordType(left).localeCompare(getRecordType(right));
  if (typeCompare !== 0) {
    return typeCompare;
  }

  const statusCompare = getStatusSortOrder(left) - getStatusSortOrder(right);
  if (statusCompare !== 0) {
    return statusCompare;
  }

  const tripCompare = normalizeTripSortValue(left.tripNumber).localeCompare(
    normalizeTripSortValue(right.tripNumber),
    undefined,
    { numeric: true, sensitivity: "base" }
  );
  if (tripCompare !== 0) {
    return tripCompare;
  }

  return String(left.merchant || "").localeCompare(String(right.merchant || ""), undefined, {
    sensitivity: "base",
  });
}

function getStatusSortOrder(expense) {
  const statusKey = getStatusKey(expense);
  if (statusKey === "to-submit") {
    return 0;
  }

  if (statusKey === "submitted") {
    return 1;
  }

  return 2;
}

function getDetailedStatusLabel(expense, recordType = getRecordType(expense)) {
  if (expense.reimbursedDate) {
    return recordType === "incentive" ? "Paid incentive" : "Reimbursed";
  }

  if (expense.submittedDate) {
    return recordType === "incentive" ? "Awaiting incentive payout" : "Awaiting reimbursement";
  }

  return "Ready to submit";
}

function getExpectedPayoutDate(expense, recordType = getRecordType(expense)) {
  return recordType === "incentive"
    ? getExpectedIncentivePayoutDate(expense.submittedDate)
    : getExpectedReimbursementFriday(expense.submittedDate);
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

function getUpcomingFriday(fromDate) {
  const date = parseIsoDate(fromDate);
  if (!date) {
    return fromDate;
  }

  const daysUntilFriday = (5 - date.getDay() + 7) % 7;
  date.setDate(date.getDate() + daysUntilFriday);
  return toIsoDate(date);
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

function normalizeTripSortValue(value) {
  return String(value || "").trim();
}

function getRecordType(expense) {
  return expense.recordType === "incentive" ? "incentive" : "expense";
}

function formatEntryCount(count) {
  return `${count} ${count === 1 ? "entry" : "entries"}`;
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
