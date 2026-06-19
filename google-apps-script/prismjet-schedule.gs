const SCHEDULE = {
  spreadsheetId: "",
  sheetName: "Pilot Requests",
  maxRegularDays: 8,
  maxTotalDays: 14,
  maxRequestsPerDay: 1,
  pilots: [
    {
      id: "pilot-a",
      name: "Pilot A",
      initials: "A",
      color: "#2f6fb3",
      pin: "1111",
    },
    {
      id: "pilot-b",
      name: "Pilot B",
      initials: "B",
      color: "#2f7d5b",
      pin: "2222",
    },
    {
      id: "pilot-c",
      name: "Pilot C",
      initials: "C",
      color: "#b36b20",
      pin: "3333",
    },
  ],
};

const REQUEST_HEADERS = [
  "Request ID",
  "Submitted At",
  "Bid Month",
  "Pilot ID",
  "Pilot Name",
  "Date",
  "Type",
  "Priority",
  "Notes",
  "Status",
];

function setupScheduleSheet() {
  getRequestSheet_();
}

function doGet(event) {
  const params = event && event.parameter ? event.parameter : {};
  const callback = sanitizeCallback_(params.callback);

  try {
    const action = String(params.action || "config");
    const payload = handleAction_(action, params);
    return output_(payload, callback);
  } catch (error) {
    return output_(
      {
        ok: false,
        error: error.message || "Schedule request failed.",
      },
      callback
    );
  }
}

function handleAction_(action, params) {
  if (action === "config") {
    return {
      ok: true,
      pilots: getPublicPilots_(),
      limits: getLimits_(),
    };
  }

  if (action === "login") {
    const pilot = requirePilot_(params.pin);
    return {
      ok: true,
      pilot: getPublicPilot_(pilot),
      requests: getRequests_(),
      limits: getLimits_(),
    };
  }

  if (action === "requests") {
    requirePilot_(params.pin);
    return {
      ok: true,
      requests: getRequests_(),
      limits: getLimits_(),
    };
  }

  if (action === "submit") {
    return submitRequests_(params);
  }

  if (action === "cancel") {
    return cancelRequest_(params);
  }

  throw new Error("Unknown schedule action.");
}

function submitRequests_(params) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const pilot = requirePilot_(params.pin);
    const bidMonth = String(params.bidMonth || "");
    const days = parseDays_(params.days);
    const notes = String(params.notes || "").slice(0, 300);
    validateSubmission_(pilot, bidMonth, days);

    const sheet = getRequestSheet_();
    const requestId = Utilities.getUuid();
    const submittedAt = new Date();
    const rows = days.map(function(day) {
      return [
        requestId,
        submittedAt,
        bidMonth,
        pilot.id,
        pilot.name,
        day.date,
        day.type,
        day.priority,
        notes,
        "submitted",
      ];
    });

    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, REQUEST_HEADERS.length).setValues(rows);

    return {
      ok: true,
      saved: rows.length,
      requests: getRequests_(),
    };
  } finally {
    lock.releaseLock();
  }
}

function validateSubmission_(pilot, bidMonth, days) {
  if (!/^\d{4}-\d{2}$/.test(bidMonth)) {
    throw new Error("Bid month is invalid.");
  }

  if (!days.length) {
    throw new Error("Select at least one day.");
  }

  if (days.length > SCHEDULE.maxTotalDays) {
    throw new Error("Combined OFF + PTO days are limited to " + SCHEDULE.maxTotalDays + ".");
  }

  const seenDates = {};
  let regularDays = 0;
  days.forEach(function(day) {
    if (!isValidDateKey_(day.date) || day.date.indexOf(bidMonth + "-") !== 0) {
      throw new Error("Selected days must be inside the bid month.");
    }

    if (seenDates[day.date]) {
      throw new Error("Each date can only be submitted once.");
    }
    seenDates[day.date] = true;

    if (day.type === "regular") {
      regularDays += 1;
    }
  });

  if (regularDays > SCHEDULE.maxRegularDays) {
    throw new Error("Regular days are limited to " + SCHEDULE.maxRegularDays + ".");
  }

  const existing = getRequests_();
  const existingMonthRequests = existing.filter(function(request) {
    return request.pilotId === pilot.id &&
      (request.bidMonth === bidMonth || request.date.indexOf(bidMonth + "-") === 0) &&
      request.status !== "cancelled";
  });
  const existingRegularDays = existingMonthRequests.filter(function(request) {
    return request.type === "regular";
  }).length;

  if (existingRegularDays + regularDays > SCHEDULE.maxRegularDays) {
    throw new Error("Monthly OFF days are limited to " + SCHEDULE.maxRegularDays + ". You already have " + existingRegularDays + ".");
  }

  if (existingMonthRequests.length + days.length > SCHEDULE.maxTotalDays) {
    throw new Error("Monthly OFF + PTO days are limited to " + SCHEDULE.maxTotalDays + ". You already have " + existingMonthRequests.length + ".");
  }

  const unavailable = days.find(function(day) {
    return existing.some(function(request) {
      return request.date === day.date && request.status !== "cancelled";
    });
  });

  if (unavailable) {
    const existingRequest = existing.find(function(request) {
      return request.date === unavailable.date && request.status !== "cancelled";
    });
    throw new Error(unavailable.date + " already has " + existingRequest.pilotName + " off.");
  }

  const duplicate = days.find(function(day) {
    return existing.some(function(request) {
      return request.pilotId === pilot.id && request.date === day.date && request.status !== "cancelled";
    });
  });

  if (duplicate) {
    throw new Error(duplicate.date + " has already been submitted.");
  }
}

function cancelRequest_(params) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const pilot = requirePilot_(params.pin);
    const date = String(params.date || "");

    if (!isValidDateKey_(date)) {
      throw new Error("Date is invalid.");
    }

    const sheet = getRequestSheet_();
    const values = sheet.getDataRange().getValues();
    let cancelled = 0;

    for (let rowIndex = 1; rowIndex < values.length; rowIndex += 1) {
      const row = values[rowIndex];
      const rowPilotId = String(row[3] || "");
      const rowDate = formatDateKey_(row[5]);
      const rowStatus = String(row[9] || "submitted").toLowerCase();

      if (rowPilotId === pilot.id && rowDate === date && rowStatus !== "cancelled") {
        sheet.getRange(rowIndex + 1, 10).setValue("cancelled");
        cancelled += 1;
      }
    }

    if (!cancelled) {
      throw new Error("That request is no longer active.");
    }

    return {
      ok: true,
      cancelled: cancelled,
      requests: getRequests_(),
    };
  } finally {
    lock.releaseLock();
  }
}

function parseDays_(value) {
  let parsed;
  try {
    parsed = JSON.parse(String(value || "[]"));
  } catch (error) {
    throw new Error("Selected days could not be read.");
  }

  if (!Array.isArray(parsed)) {
    throw new Error("Selected days could not be read.");
  }

  return parsed.map(function(day) {
    return {
      date: String(day.date || ""),
      type: normalizeType_(day.type),
      priority: normalizePriority_(day.priority),
    };
  });
}

function normalizeType_(type) {
  const value = String(type || "").toLowerCase();
  if (value === "pto") {
    return "pto";
  }
  if (value === "regular" || value === "off") {
    return "regular";
  }
  throw new Error("Request type is invalid.");
}

function normalizePriority_(priority) {
  const value = String(priority || "").toLowerCase();
  if (["high", "medium", "low"].indexOf(value) !== -1) {
    return value;
  }
  throw new Error("Priority is invalid.");
}

function requirePilot_(pin) {
  const cleanPin = String(pin || "").trim();
  const pilot = SCHEDULE.pilots.find(function(item) {
    return String(item.pin) === cleanPin;
  });

  if (!pilot) {
    throw new Error("PIN was not recognized.");
  }

  return pilot;
}

function getRequests_() {
  const sheet = getRequestSheet_();
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) {
    return [];
  }

  return values.slice(1).map(function(row, index) {
    return {
      id: String(row[0] || "row-" + (index + 2)),
      requestId: String(row[0] || ""),
      submittedAt: formatTimestamp_(row[1]),
      bidMonth: String(row[2] || ""),
      pilotId: String(row[3] || ""),
      pilotName: String(row[4] || ""),
      date: formatDateKey_(row[5]),
      type: normalizeTypeForRead_(row[6]),
      priority: normalizePriorityForRead_(row[7]),
      notes: String(row[8] || ""),
      status: String(row[9] || "submitted").toLowerCase(),
    };
  }).filter(function(request) {
    return request.date && request.status !== "cancelled";
  });
}

function getRequestSheet_() {
  const spreadsheet = getSpreadsheet_();
  let sheet = spreadsheet.getSheetByName(SCHEDULE.sheetName);

  if (!sheet) {
    sheet = spreadsheet.insertSheet(SCHEDULE.sheetName);
  }

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(REQUEST_HEADERS);
    sheet.setFrozenRows(1);
    return sheet;
  }

  const existingHeaders = sheet.getRange(1, 1, 1, REQUEST_HEADERS.length).getValues()[0];
  const needsHeaders = REQUEST_HEADERS.some(function(header, index) {
    return existingHeaders[index] !== header;
  });

  if (needsHeaders) {
    sheet.getRange(1, 1, 1, REQUEST_HEADERS.length).setValues([REQUEST_HEADERS]);
    sheet.setFrozenRows(1);
  }

  return sheet;
}

function getSpreadsheet_() {
  if (SCHEDULE.spreadsheetId) {
    return SpreadsheetApp.openById(SCHEDULE.spreadsheetId);
  }

  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) {
    throw new Error("Add a spreadsheetId or bind this script to a Google Sheet.");
  }
  return spreadsheet;
}

function getLimits_() {
  return {
    maxRegularDays: SCHEDULE.maxRegularDays,
    maxTotalDays: SCHEDULE.maxTotalDays,
    maxRequestsPerDay: SCHEDULE.maxRequestsPerDay,
  };
}

function getPublicPilots_() {
  return SCHEDULE.pilots.map(getPublicPilot_);
}

function getPublicPilot_(pilot) {
  return {
    id: pilot.id,
    name: pilot.name,
    initials: pilot.initials,
    color: pilot.color,
  };
}

function output_(payload, callback) {
  const body = callback
    ? callback + "(" + JSON.stringify(payload) + ");"
    : JSON.stringify(payload);
  const output = ContentService.createTextOutput(body);
  output.setMimeType(callback ? ContentService.MimeType.JAVASCRIPT : ContentService.MimeType.JSON);
  return output;
}

function sanitizeCallback_(callback) {
  if (!callback) {
    return "";
  }

  const value = String(callback);
  if (!/^[A-Za-z_$][0-9A-Za-z_$]*(\.[A-Za-z_$][0-9A-Za-z_$]*)*$/.test(value)) {
    throw new Error("Callback is invalid.");
  }
  return value;
}

function formatTimestamp_(value) {
  if (Object.prototype.toString.call(value) === "[object Date]" && !isNaN(value)) {
    return value.toISOString();
  }
  return String(value || "");
}

function formatDateKey_(value) {
  if (Object.prototype.toString.call(value) === "[object Date]" && !isNaN(value)) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), "yyyy-MM-dd");
  }
  return String(value || "").slice(0, 10);
}

function normalizeTypeForRead_(type) {
  const value = String(type || "").toLowerCase();
  return value === "pto" ? "pto" : "regular";
}

function normalizePriorityForRead_(priority) {
  const value = String(priority || "").toLowerCase();
  if (["high", "medium", "low"].indexOf(value) !== -1) {
    return value;
  }
  return "medium";
}

function isValidDateKey_(dateKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    return false;
  }

  const parts = dateKey.split("-").map(Number);
  const parsed = new Date(parts[0], parts[1] - 1, parts[2]);
  return parsed.getFullYear() === parts[0] &&
    parsed.getMonth() === parts[1] - 1 &&
    parsed.getDate() === parts[2];
}
