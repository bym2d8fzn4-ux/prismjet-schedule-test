const DB_NAME = "trip-ledger-db";
const STORE_NAME = "expenses";
const DB_VERSION = 1;

const USD_FORMATTER = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD",
});

const VIEW_CONFIG = {
  "to-submit": {
    key: "to-submit",
    label: "Ready to submit",
    emptyTitle: "Nothing is ready to submit yet.",
    emptyBody: "Tap New Expense to log your next receipt.",
  },
  submitted: {
    key: "submitted",
    label: "Awaiting reimbursement",
    emptyTitle: "Nothing is waiting on reimbursement.",
    emptyBody: "Mark an expense as submitted and it will show up here.",
  },
  reimbursed: {
    key: "reimbursed",
    label: "Reimbursed",
    emptyTitle: "No reimbursed expenses yet.",
    emptyBody: "Once an expense is paid back, it will move here.",
  },
};

export function getViewConfig(view) {
  return VIEW_CONFIG[view] || VIEW_CONFIG["to-submit"];
}

export async function getAllExpenses() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).getAll();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

export async function getExpense(id) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).get(id);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

export async function saveExpense(expense) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const request = transaction.objectStore(STORE_NAME).put(expense);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(expense);
  });
}

export async function deleteExpense(id) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const request = transaction.objectStore(STORE_NAME).delete(id);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

export async function clearAllExpenses() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
    transaction.oncomplete = () => resolve();
    transaction.objectStore(STORE_NAME).clear();
  });
}

export function filterExpenses(expenses, view) {
  if (view === "to-submit") {
    return expenses.filter((expense) => !expense.submittedDate);
  }

  if (view === "submitted") {
    return expenses.filter((expense) => Boolean(expense.submittedDate) && !expense.reimbursedDate);
  }

  if (view === "reimbursed") {
    return expenses.filter((expense) => Boolean(expense.reimbursedDate));
  }

  return expenses;
}

export function summarizeExpenses(expenses) {
  return {
    "to-submit": summarizeList(filterExpenses(expenses, "to-submit")),
    submitted: summarizeList(filterExpenses(expenses, "submitted")),
    reimbursed: summarizeList(filterExpenses(expenses, "reimbursed")),
  };
}

function summarizeList(expenses) {
  return {
    count: expenses.length,
    total: expenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0),
  };
}

export function getStatusKey(expense) {
  if (expense.reimbursedDate) {
    return "reimbursed";
  }

  if (expense.submittedDate) {
    return "submitted";
  }

  return "to-submit";
}

export function getStatusLabel(expense) {
  return getViewConfig(getStatusKey(expense)).label;
}

export function getStatusBadgeClass(expense) {
  if (expense.reimbursedDate) {
    return "badge-status-reimbursed";
  }

  if (expense.submittedDate) {
    return "badge-status-submitted";
  }

  return "badge-status-draft";
}

export function getQuickStatusLabel(expense) {
  if (expense.reimbursedDate) {
    return "";
  }

  if (expense.submittedDate) {
    return "Mark reimbursed today";
  }

  return "Mark submitted today";
}

export function createId() {
  return window.crypto?.randomUUID?.() || `expense-${Date.now()}`;
}

export function sortExpenses(expenses) {
  return [...expenses].sort((left, right) => {
    const leftDate = `${left.date}-${left.updatedAt || left.createdAt || ""}`;
    const rightDate = `${right.date}-${right.updatedAt || right.createdAt || ""}`;
    return rightDate.localeCompare(leftDate);
  });
}

export function formatDate(value) {
  if (!value) {
    return "Not set";
  }

  const parts = value.split("-");
  if (parts.length !== 3) {
    return value;
  }

  const [year, month, day] = parts.map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function getToday() {
  const today = new Date();
  const offset = today.getTimezoneOffset();
  return new Date(today.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

export function validateDates(expense) {
  if (expense.submittedDate && expense.submittedDate < expense.date) {
    return "The submitted date cannot be earlier than the expense date.";
  }

  if (expense.reimbursedDate && expense.reimbursedDate < expense.date) {
    return "The reimbursed date cannot be earlier than the expense date.";
  }

  if (
    expense.submittedDate &&
    expense.reimbursedDate &&
    expense.reimbursedDate < expense.submittedDate
  ) {
    return "The reimbursed date cannot be earlier than the submitted date.";
  }

  return "";
}

export async function compressImage(file) {
  const dataUrl = await readFileAsDataUrl(file);
  const image = await loadImage(dataUrl);
  const canvas = document.createElement("canvas");
  const maxDimension = 1600;
  const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Could not get a canvas context.");
  }

  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.82);
}

export function buildExportPayload(expenses) {
  return {
    app: "Trip Ledger",
    exportedAt: new Date().toISOString(),
    expenses,
  };
}

export function normalizeImportedExpense(rawExpense, createIdFn = createId) {
  return {
    id: rawExpense.id || createIdFn(),
    recordType: rawExpense.recordType === "incentive" ? "incentive" : "expense",
    amount: Number(rawExpense.amount || 0),
    merchant: String(rawExpense.merchant || "Imported expense"),
    category: String(rawExpense.category || "Miscellaneous"),
    tripNumber: String(rawExpense.tripNumber || ""),
    date: rawExpense.date || getToday(),
    location: String(rawExpense.location || ""),
    notes: String(rawExpense.notes || ""),
    submittedDate: rawExpense.submittedDate || "",
    reimbursedDate: rawExpense.reimbursedDate || "",
    photoDataUrl: String(rawExpense.photoDataUrl || ""),
    createdAt: rawExpense.createdAt || new Date().toISOString(),
    updatedAt: rawExpense.updatedAt || new Date().toISOString(),
  };
}

export function formatCurrency(value) {
  return USD_FORMATTER.format(Number(value || 0));
}

export function formatCount(count) {
  return `${count} ${count === 1 ? "expense" : "expenses"}`;
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
  });
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onerror = () => reject(new Error("Could not load image."));
    image.onload = () => resolve(image);
    image.src = dataUrl;
  });
}
