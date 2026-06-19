import {
  compressImage,
  createId,
  getAllExpenses,
  getExpense,
  getStatusKey,
  getToday,
  getViewConfig,
  saveExpense,
  validateDates,
} from "./storage.js";

const queryParams = new URLSearchParams(window.location.search);
const expenseId = queryParams.get("id");
const returnView = getViewConfig(queryParams.get("view")).key;
const returnRecordType = normalizeRecordType(queryParams.get("type"));

const state = {
  currentRecordType: returnRecordType,
  currentPhotoDataUrl: "",
  existingExpense: null,
  dateSeededByApp: false,
  autofilledFields: new Set(),
  previewScale: 1,
  previewX: 0,
  previewY: 0,
  previewDragging: false,
  previewPointerId: null,
  previewDragStartX: 0,
  previewDragStartY: 0,
  previewOriginX: 0,
  previewOriginY: 0,
  isScanning: false,
  ocrWorker: null,
};

const elements = {
  backLink: document.querySelector("#back-link"),
  cancelLink: document.querySelector("#cancel-link"),
  formEyebrow: document.querySelector("#form-eyebrow"),
  formTitle: document.querySelector("#form-title"),
  formCopy: document.querySelector("#form-copy"),
  saveButton: document.querySelector("#save-button"),
  expenseForm: document.querySelector("#expense-form"),
  expenseId: document.querySelector("#expense-id"),
  existingPhoto: document.querySelector("#existing-photo"),
  tripNumberOptions: document.querySelector("#trip-number-options"),
  recordTypeExpense: document.querySelector("#record-type-expense"),
  recordTypeIncentive: document.querySelector("#record-type-incentive"),
  amount: document.querySelector("#amount"),
  merchant: document.querySelector("#merchant"),
  category: document.querySelector("#category"),
  tripNumber: document.querySelector("#trip-number"),
  date: document.querySelector("#date"),
  location: document.querySelector("#location"),
  notes: document.querySelector("#notes"),
  submittedDate: document.querySelector("#submitted-date"),
  reimbursedDate: document.querySelector("#reimbursed-date"),
  optionalDetails: document.querySelector("#optional-details"),
  photo: document.querySelector("#photo"),
  photoPreview: document.querySelector("#photo-preview"),
  photoPreviewImage: document.querySelector("#photo-preview-image"),
  openPreviewButton: document.querySelector("#open-preview-button"),
  removePhotoButton: document.querySelector("#remove-photo-button"),
  useLocationButton: document.querySelector("#use-location-button"),
  autofillButton: document.querySelector("#autofill-button"),
  scanStatus: document.querySelector("#scan-status"),
  imageModal: document.querySelector("#image-modal"),
  imageModalScrim: document.querySelector("#image-modal-scrim"),
  imageModalFrame: document.querySelector("#image-modal-frame"),
  imageModalImage: document.querySelector("#image-modal-image"),
  closePreviewButton: document.querySelector("#close-preview-button"),
  zoomInButton: document.querySelector("#zoom-in-button"),
  zoomOutButton: document.querySelector("#zoom-out-button"),
  zoomResetButton: document.querySelector("#zoom-reset-button"),
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

async function init() {
  bindEvents();
  setReturnLinks(returnView, returnRecordType);
  await populateTripNumberOptions();
  elements.recordTypeExpense.checked = state.currentRecordType === "expense";
  elements.recordTypeIncentive.checked = state.currentRecordType === "incentive";
  elements.date.value = getToday();
  state.dateSeededByApp = true;
  applyRecordTypeUi();

  if (expenseId) {
    await loadExpense(expenseId);
  }
}

function bindEvents() {
  elements.expenseForm.addEventListener("submit", handleSaveExpense);
  elements.photo.addEventListener("change", handlePhotoChange);
  elements.removePhotoButton.addEventListener("click", removePhoto);
  elements.useLocationButton.addEventListener("click", useCurrentLocation);
  elements.autofillButton.addEventListener("click", handleAutofillReceipt);
  elements.openPreviewButton.addEventListener("click", openImagePreview);
  elements.photoPreviewImage.addEventListener("click", openImagePreview);
  elements.imageModalScrim.addEventListener("click", closeImagePreview);
  elements.closePreviewButton.addEventListener("click", closeImagePreview);
  elements.zoomInButton.addEventListener("click", () => adjustPreviewZoom(0.35));
  elements.zoomOutButton.addEventListener("click", () => adjustPreviewZoom(-0.35));
  elements.zoomResetButton.addEventListener("click", resetPreviewTransform);
  elements.imageModalFrame.addEventListener("pointerdown", startPreviewDrag);
  elements.imageModalFrame.addEventListener("pointermove", movePreviewDrag);
  elements.imageModalFrame.addEventListener("pointerup", endPreviewDrag);
  elements.imageModalFrame.addEventListener("pointercancel", endPreviewDrag);
  elements.imageModalFrame.addEventListener("pointerleave", endPreviewDrag);
  elements.imageModalFrame.addEventListener("dblclick", () => {
    if (state.previewScale > 1) {
      resetPreviewTransform();
    } else {
      setPreviewTransform(2, 0, 0);
    }
  });
  elements.date.addEventListener("input", () => {
    state.dateSeededByApp = false;
  });
  [elements.recordTypeExpense, elements.recordTypeIncentive].forEach((field) => {
    field.addEventListener("change", () => {
      if (!field.checked) {
        return;
      }

      state.currentRecordType = normalizeRecordType(field.value);
      applyRecordTypeUi();
      setReturnLinks(returnView, state.currentRecordType);
    });
  });
  [elements.amount, elements.merchant, elements.date].forEach((field) => {
    field.addEventListener("input", () => {
      state.autofilledFields.delete(field.id);
    });
  });
  elements.category.addEventListener("change", () => {
    state.autofilledFields.delete(elements.category.id);
  });
  window.addEventListener("beforeunload", cleanupWorker);
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !elements.imageModal.hidden) {
      closeImagePreview();
    }
  });
}

function setReturnLinks(view, recordType) {
  const url = `index.html?view=${encodeURIComponent(view)}&type=${encodeURIComponent(recordType)}`;
  elements.backLink.href = url;
  elements.cancelLink.href = url;
}

async function loadExpense(id) {
  try {
    const expense = await getExpense(id);
    if (!expense) {
      window.alert("That expense could not be found.");
      window.location.href = elements.backLink.href;
      return;
    }

    state.existingExpense = expense;
    state.currentRecordType = normalizeRecordType(expense.recordType);
    populateForm(expense);
    applyRecordTypeUi(true);
    setReturnLinks(returnView, state.currentRecordType);
  } catch (error) {
    console.error(error);
    window.alert("Trip Ledger could not load this expense.");
  }
}

function populateForm(expense) {
  state.autofilledFields.clear();
  elements.expenseId.value = expense.id;
  elements.recordTypeExpense.checked = normalizeRecordType(expense.recordType) === "expense";
  elements.recordTypeIncentive.checked = normalizeRecordType(expense.recordType) === "incentive";
  elements.amount.value = expense.amount;
  elements.merchant.value = expense.merchant;
  elements.category.value = expense.category;
  elements.tripNumber.value = expense.tripNumber || "";
  elements.date.value = expense.date;
  elements.location.value = expense.location;
  elements.notes.value = expense.notes;
  elements.submittedDate.value = expense.submittedDate;
  elements.reimbursedDate.value = expense.reimbursedDate;
  elements.existingPhoto.value = expense.photoDataUrl || "";
  state.currentPhotoDataUrl = expense.photoDataUrl || "";
  state.dateSeededByApp = false;
  elements.optionalDetails.open = hasOptionalDetails(expense);
  renderPhotoPreview(expense.photoDataUrl || "");
  setAutofillAvailability(Boolean(expense.photoDataUrl));
  if (expense.photoDataUrl) {
    updateScanStatus("Receipt attached. OCR can rescan this image if you want to refresh suggestions.");
  }
}

async function handleSaveExpense(event) {
  event.preventDefault();

  if (!elements.expenseForm.reportValidity()) {
    return;
  }

  const id = elements.expenseId.value || createId();
  const now = new Date().toISOString();
  const amount = Number.parseFloat(elements.amount.value);

  if (Number.isNaN(amount) || amount <= 0) {
    window.alert("Please enter an amount greater than zero.");
    return;
  }

  const expense = {
    id,
    recordType: state.currentRecordType,
    amount,
    merchant: elements.merchant.value.trim(),
    category: elements.category.value,
    tripNumber: elements.tripNumber.value.trim(),
    date: elements.date.value,
    location: elements.location.value.trim(),
    notes: elements.notes.value.trim(),
    submittedDate: elements.submittedDate.value,
    reimbursedDate: elements.reimbursedDate.value,
    photoDataUrl: state.currentPhotoDataUrl || elements.existingPhoto.value || "",
    createdAt: state.existingExpense?.createdAt || now,
    updatedAt: now,
  };

  if (expense.reimbursedDate && !expense.submittedDate) {
    expense.submittedDate = expense.reimbursedDate;
  }

  const dateError = validateDates(expense);
  if (dateError) {
    window.alert(dateError);
    return;
  }

  try {
    await saveExpense(expense);
    const destinationView = getStatusKey(expense);
    window.location.href = `index.html?view=${encodeURIComponent(destinationView)}&type=${encodeURIComponent(state.currentRecordType)}`;
  } catch (error) {
    console.error(error);
    window.alert("Trip Ledger could not save this expense.");
  }
}

function normalizeRecordType(value) {
  return value === "incentive" ? "incentive" : "expense";
}

function applyRecordTypeUi(isEditing = Boolean(state.existingExpense)) {
  const isIncentive = state.currentRecordType === "incentive";
  elements.formEyebrow.textContent = isIncentive
    ? "PrismJet incentive entry"
    : "PrismJet expense entry";
  elements.formTitle.textContent = isEditing
    ? isIncentive
      ? "Edit Incentive"
      : "Edit Expense"
    : isIncentive
      ? "New Incentive"
      : "New Expense";
  elements.formCopy.textContent = isEditing
    ? "Update the details, then save to return to your dashboard."
    : isIncentive
      ? "Enter the incentive details, then track the monthly 15th payout date."
      : "Snap the receipt, let OCR suggest the basics, then save.";
  elements.saveButton.textContent = isIncentive ? "Save Incentive" : "Save Expense";
}

async function populateTripNumberOptions() {
  try {
    const expenses = await getAllExpenses();
    const sorted = [...expenses].sort((left, right) => {
      const leftKey = left.updatedAt || left.createdAt || "";
      const rightKey = right.updatedAt || right.createdAt || "";
      return rightKey.localeCompare(leftKey);
    });
    const seen = new Set();

    elements.tripNumberOptions.replaceChildren();
    sorted.forEach((expense) => {
      const tripNumber = String(expense.tripNumber || "").trim();
      if (!tripNumber || seen.has(tripNumber)) {
        return;
      }

      seen.add(tripNumber);
      const option = document.createElement("option");
      option.value = tripNumber;
      elements.tripNumberOptions.appendChild(option);
    });
  } catch (error) {
    console.error("Could not load trip numbers.", error);
  }
}

async function handlePhotoChange(event) {
  const [file] = event.target.files || [];
  if (!file) {
    return;
  }

  try {
    state.currentPhotoDataUrl = await compressImage(file);
    renderPhotoPreview(state.currentPhotoDataUrl);
    setAutofillAvailability(true);
    updateScanStatus("Receipt ready. OCR can suggest amount, vendor, category, and date.");
    await handleAutofillReceipt({ autoTriggered: true });
  } catch (error) {
    console.error(error);
    window.alert("That photo could not be processed. Please try another image.");
  }
}

function removePhoto() {
  state.currentPhotoDataUrl = "";
  elements.existingPhoto.value = "";
  elements.photo.value = "";
  state.autofilledFields.clear();
  renderPhotoPreview("");
  setAutofillAvailability(false);
  closeImagePreview();
  updateScanStatus("Choose a receipt photo to scan amount, vendor, category, and date.");
}

function renderPhotoPreview(photoDataUrl) {
  elements.photoPreview.hidden = !photoDataUrl;
  if (photoDataUrl) {
    elements.photoPreviewImage.src = photoDataUrl;
    elements.imageModalImage.src = photoDataUrl;
  } else {
    elements.photoPreviewImage.removeAttribute("src");
    elements.imageModalImage.removeAttribute("src");
  }
}

function setAutofillAvailability(hasReceipt) {
  elements.autofillButton.disabled = !hasReceipt || state.isScanning;
}

async function handleAutofillReceipt(options = {}) {
  const imageSource = state.currentPhotoDataUrl || elements.existingPhoto.value;
  if (!imageSource || state.isScanning) {
    return;
  }

  if (!window.Tesseract?.createWorker) {
    updateScanStatus("Receipt OCR is unavailable right now.");
    if (!options.autoTriggered) {
      window.alert("Receipt OCR could not load. Please try again while online.");
    }
    return;
  }

  state.isScanning = true;
  setAutofillAvailability(true);
  elements.autofillButton.textContent = "Scanning...";
  updateScanStatus("Scanning receipt. The first scan can take 10 to 20 seconds.");

  try {
    const worker = await getOcrWorker();
    const result = await worker.recognize(imageSource);
    const suggestion = extractReceiptFields(result.data.text || "");
    const appliedFields = applyReceiptSuggestion(suggestion);

    if (!appliedFields.length) {
      updateScanStatus("OCR finished, but I could not confidently fill the fields. You can enter them manually.");
      return;
    }

    updateScanStatus(`OCR filled ${appliedFields.join(", ")}. Please review before saving.`);
  } catch (error) {
    console.error(error);
    updateScanStatus("OCR could not finish on this image.");
    if (!options.autoTriggered) {
      window.alert("Trip Ledger could not read that receipt clearly. You can still enter the fields manually.");
    }
  } finally {
    state.isScanning = false;
    elements.autofillButton.textContent = "Auto-Fill from Receipt";
    setAutofillAvailability(Boolean(imageSource));
  }
}

async function getOcrWorker() {
  if (!state.ocrWorker) {
    state.ocrWorker = await window.Tesseract.createWorker("eng");
  }

  return state.ocrWorker;
}

async function cleanupWorker() {
  if (state.ocrWorker) {
    try {
      await state.ocrWorker.terminate();
    } catch (error) {
      console.error("Could not terminate OCR worker.", error);
    }
    state.ocrWorker = null;
  }
}

function updateScanStatus(message) {
  elements.scanStatus.textContent = message;
}

function extractReceiptFields(rawText) {
  const text = rawText.replace(/\u00a0/g, " ").trim();
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const merchant = findMerchant(lines);
  const amount = findAmount(lines);
  const date = findReceiptDate(lines);
  const category = suggestCategory(merchant, text);

  return {
    merchant,
    amount,
    date,
    category,
  };
}

function applyReceiptSuggestion(suggestion) {
  const applied = [];

  if (suggestion.amount && shouldApplySuggestion(elements.amount)) {
    elements.amount.value = suggestion.amount;
    state.autofilledFields.add(elements.amount.id);
    applied.push("amount");
  }

  if (suggestion.merchant && shouldApplySuggestion(elements.merchant)) {
    elements.merchant.value = suggestion.merchant;
    state.autofilledFields.add(elements.merchant.id);
    applied.push("vendor");
  }

  if (suggestion.date && shouldApplySuggestion(elements.date, state.dateSeededByApp)) {
    elements.date.value = suggestion.date;
    state.dateSeededByApp = false;
    state.autofilledFields.add(elements.date.id);
    applied.push("expense date");
  }

  if (suggestion.category && shouldApplySuggestion(elements.category)) {
    elements.category.value = suggestion.category;
    state.autofilledFields.add(elements.category.id);
    applied.push("category");
  }

  return applied;
}

function shouldApplySuggestion(field, allowSeededValue = false) {
  return !field.value || allowSeededValue || state.autofilledFields.has(field.id);
}

function openImagePreview() {
  if (!elements.imageModalImage.getAttribute("src")) {
    return;
  }

  elements.imageModal.hidden = false;
  document.body.classList.add("modal-open");
  resetPreviewTransform();
}

function closeImagePreview() {
  elements.imageModal.hidden = true;
  document.body.classList.remove("modal-open");
  state.previewDragging = false;
}

function adjustPreviewZoom(delta) {
  const nextScale = clamp(state.previewScale + delta, 1, 4);
  setPreviewTransform(nextScale, state.previewX, state.previewY);
}

function resetPreviewTransform() {
  setPreviewTransform(1, 0, 0);
}

function setPreviewTransform(scale, x, y) {
  state.previewScale = clamp(scale, 1, 4);
  state.previewX = state.previewScale === 1 ? 0 : clamp(x, -260, 260);
  state.previewY = state.previewScale === 1 ? 0 : clamp(y, -380, 380);
  elements.imageModalImage.style.transform = `translate(${state.previewX}px, ${state.previewY}px) scale(${state.previewScale})`;
}

function startPreviewDrag(event) {
  if (state.previewScale <= 1) {
    return;
  }

  state.previewDragging = true;
  state.previewPointerId = event.pointerId;
  state.previewDragStartX = event.clientX;
  state.previewDragStartY = event.clientY;
  state.previewOriginX = state.previewX;
  state.previewOriginY = state.previewY;
  elements.imageModalFrame.setPointerCapture(event.pointerId);
}

function movePreviewDrag(event) {
  if (!state.previewDragging || event.pointerId !== state.previewPointerId) {
    return;
  }

  const deltaX = event.clientX - state.previewDragStartX;
  const deltaY = event.clientY - state.previewDragStartY;
  setPreviewTransform(state.previewScale, state.previewOriginX + deltaX, state.previewOriginY + deltaY);
}

function endPreviewDrag(event) {
  if (event.pointerId && event.pointerId !== state.previewPointerId) {
    return;
  }

  state.previewDragging = false;
  state.previewPointerId = null;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function findMerchant(lines) {
  const ignoredPattern =
    /(receipt|invoice|order|total|subtotal|tax|amount|balance|visa|mastercard|amex|discover|cash|change|thank|approved|auth|terminal|server|table|guest|customer|www|http|phone|tel|date|time)/i;

  const candidates = lines
    .slice(0, 8)
    .filter((line) => /[A-Za-z]/.test(line))
    .filter((line) => !ignoredPattern.test(line))
    .filter((line) => !/\d{3,}/.test(line))
    .filter((line) => line.length >= 3 && line.length <= 40);

  const merchant = candidates[0] || "";
  return merchant ? cleanMerchantName(merchant) : "";
}

function cleanMerchantName(value) {
  const trimmed = sanitizeMerchantTokens(value)
    .replace(/[^A-Za-z0-9&'.,\- ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const uppercaseRatio =
    trimmed.replace(/[^A-Z]/g, "").length / Math.max(1, trimmed.replace(/[^A-Za-z]/g, "").length);

  if (uppercaseRatio < 0.7) {
    return trimmed;
  }

  return trimmed
    .toLowerCase()
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function sanitizeMerchantTokens(value) {
  const tokens = value
    .replace(/^[^A-Za-z0-9']+|[^A-Za-z0-9']+$/g, "")
    .split(/\s+/)
    .filter(Boolean);

  while (tokens.length > 1 && isLikelyMerchantNoise(tokens[0])) {
    tokens.shift();
  }

  while (tokens.length > 1 && isLikelyMerchantNoise(tokens[tokens.length - 1])) {
    tokens.pop();
  }

  if (tokens.length >= 2 && tokens[tokens.length - 1].toLowerCase() === "s") {
    tokens[tokens.length - 2] = `${tokens[tokens.length - 2]}'s`;
    tokens.pop();
  }

  return tokens.join(" ");
}

function isLikelyMerchantNoise(token) {
  const cleaned = token.replace(/[^A-Za-z]/g, "");
  if (!cleaned) {
    return true;
  }

  if (/^(.)\1{1,}$/i.test(cleaned) && cleaned.length <= 4) {
    return true;
  }

  if (cleaned.length <= 3 && !/[aeiouy]/i.test(cleaned) && !/^[A-Z]{2,4}$/.test(cleaned)) {
    return true;
  }

  return false;
}

function findAmount(lines) {
  const tipLineIndex = lines.findIndex((line) => Boolean(isTipLine(line)));
  const hasTipLine = tipLineIndex !== -1;
  const totalCandidate = findBestLabeledAmount(lines, isTotalLine);
  const gratuityCandidate = findBestLabeledAmount(lines, isTipLine);
  const amountCandidate = findBestLabeledAmount(lines, isAmountLine);
  const postTipTotalCandidate =
    tipLineIndex >= 0 ? findLargestAmountInRange(lines, tipLineIndex + 1, tipLineIndex + 3) : null;
  const largestStructuredAmount = findLargestStructuredAmount(lines);
  const suspiciousTotal =
    totalCandidate &&
    (
      totalCandidate.numericValue < 3 ||
      ((amountCandidate?.numericValue || largestStructuredAmount?.numericValue || 0) >= 5 &&
        totalCandidate.numericValue <
          (amountCandidate?.numericValue || largestStructuredAmount?.numericValue || 0) * 0.7)
    );

  if (hasTipLine && amountCandidate && gratuityCandidate) {
    const inferredTotal = normalizeCurrencyValue(amountCandidate.numericValue + gratuityCandidate.numericValue);
    if (
      totalCandidate &&
      !suspiciousTotal &&
      Math.abs(totalCandidate.numericValue - Number(inferredTotal)) <= 0.05
    ) {
      return totalCandidate.amount;
    }

    if (
      postTipTotalCandidate &&
      postTipTotalCandidate.numericValue >= Number(inferredTotal) - 1.5
    ) {
      return postTipTotalCandidate.amount;
    }

    if (!totalCandidate || suspiciousTotal || totalCandidate.numericValue <= amountCandidate.numericValue) {
      return inferredTotal;
    }
  }

  if (hasTipLine && totalCandidate && !suspiciousTotal) {
    return totalCandidate.amount;
  }

  if (hasTipLine && postTipTotalCandidate && postTipTotalCandidate.numericValue >= 3) {
    return postTipTotalCandidate.amount;
  }

  if (totalCandidate && !suspiciousTotal && (hasTipLine || totalCandidate.labelStrength >= 3)) {
    return totalCandidate.amount;
  }

  if (amountCandidate && amountCandidate.numericValue >= 3) {
    return amountCandidate.amount;
  }

  if (largestStructuredAmount && largestStructuredAmount.numericValue >= 3) {
    return largestStructuredAmount.amount;
  }

  return extractLargestCurrency(lines);
}

function findBestLabeledAmount(lines, matcher) {
  let bestCandidate = null;

  lines.forEach((line, index) => {
    const labelStrength = matcher(line);
    if (!labelStrength) {
      return;
    }

    const sameLineAmounts =
      extractAmounts(line, { allowImpliedCents: false, allowWholeNumbers: true, includeLooseIntegers: false }) ||
      [];
    const looseSameLineAmounts =
      sameLineAmounts.length
        ? sameLineAmounts
        : extractAmounts(line, { allowImpliedCents: true, allowWholeNumbers: true, includeLooseIntegers: true });
    if (looseSameLineAmounts.length) {
      for (const amount of looseSameLineAmounts) {
        const score = labelStrength * 120 + amount.numericValue / 1000;
        if (!bestCandidate || score > bestCandidate.score) {
          bestCandidate = {
            amount: amount.normalized,
            numericValue: amount.numericValue,
            score,
            labelStrength,
          };
        }
      }
      return;
    }

    const nearbyLines = [
      { line: lines[index + 1] || "", distance: 1 },
      { line: lines[index - 1] || "", distance: 1 },
    ];

    nearbyLines.forEach(({ line: candidateLine, distance }) => {
      const nearbyAmounts =
        extractAmounts(candidateLine, {
          allowImpliedCents: false,
          allowWholeNumbers: true,
          includeLooseIntegers: false,
        }) ||
        [];
      const looseNearbyAmounts =
        nearbyAmounts.length
          ? nearbyAmounts
          : extractAmounts(candidateLine, {
              allowImpliedCents: true,
              allowWholeNumbers: true,
              includeLooseIntegers: true,
            });

      for (const amount of looseNearbyAmounts) {
        const score = labelStrength * 100 - distance * 15 + amount.numericValue / 1000;
        if (!bestCandidate || score > bestCandidate.score) {
          bestCandidate = {
            amount: amount.normalized,
            numericValue: amount.numericValue,
            score,
            labelStrength,
          };
        }
      }
    });
  });

  return bestCandidate;
}

function isTotalLine(line) {
  const normalizedLine = normalizeOcrLabel(line);
  if (!normalizedLine || /(subtotal|sub total)/i.test(normalizedLine)) {
    return 0;
  }

  if (/(grand total|total due|final total|balance due|tota[l1i]|totai)/i.test(normalizedLine)) {
    return 4;
  }

  if (/\btotal\b|\btotai\b|\btotal\W*$/i.test(normalizedLine)) {
    return 3;
  }

  return 0;
}

function isTipLine(line) {
  const normalizedLine = normalizeOcrLabel(line);
  if (!normalizedLine) {
    return 0;
  }

  if (/(gratuity|gratui?ty|gratutity|gratity|tip)\b/i.test(normalizedLine)) {
    return 3;
  }

  return 0;
}

function isAmountLine(line) {
  const normalizedLine = normalizeOcrLabel(line);
  if (!normalizedLine) {
    return 0;
  }

  if (/(purchase amount|charged amount|charge amount)/i.test(normalizedLine)) {
    return 3;
  }

  if (/\bamount\b|\bam0unt\b|\bamoumt\b/i.test(normalizedLine)) {
    return 2;
  }

  return 0;
}

function extractLargestCurrency(lines) {
  let bestAmount = 0;

  for (const line of lines) {
    for (const amount of extractAmounts(line, {
      allowImpliedCents: false,
      allowWholeNumbers: false,
      includeLooseIntegers: false,
    })) {
      if (amount.numericValue > bestAmount) {
        bestAmount = amount.numericValue;
      }
    }
  }

  return bestAmount ? bestAmount.toFixed(2) : "";
}

function extractAmounts(line, options = {}) {
  const {
    allowImpliedCents = true,
    allowWholeNumbers = true,
    includeLooseIntegers = true,
  } = options;
  const matches = [];
  const seen = new Set();

  const addMatches = (values, parseOptions) => {
    values.forEach((value) => {
      const parsed = parseAmountToken(value, parseOptions);
      if (!parsed) {
        return;
      }

      const key = `${parsed.normalized}:${value}`;
      if (seen.has(key)) {
        return;
      }

      seen.add(key);
      matches.push(parsed);
    });
  };

  addMatches(line.match(/\$?\s?[0-9OoBb]{1,6}[.,][0-9OoBb]{1,2}/g) || [], {
    allowImpliedCents: false,
    allowWholeNumbers: true,
  });
  addMatches(line.match(/\b[0-9OoBb]{1,4}\s+[0-9OoBb]{2}\b/g) || [], {
    allowImpliedCents: true,
    allowWholeNumbers: false,
  });

  if (allowWholeNumbers) {
    addMatches(line.match(/\$\s?[0-9OoBb]{1,4}\b/g) || [], {
      allowImpliedCents: false,
      allowWholeNumbers: true,
    });
  }

  if (includeLooseIntegers) {
    addMatches(line.match(/\b[0-9OoBb]{3,5}\b/g) || [], {
      allowImpliedCents,
      allowWholeNumbers,
    });
  }

  return matches;
}

function parseAmountToken(token, options = {}) {
  const { allowImpliedCents = true, allowWholeNumbers = true } = options;
  let normalizedToken = token
    .replace(/\$/g, "")
    .replace(/\s+/g, "")
    .replace(/[Oo]/g, "0")
    .replace(/[Bb]/g, "8");
  if (!normalizedToken) {
    return null;
  }

  const decimalMatch = normalizedToken.match(/^(\d{1,4})[.,](\d{1,2})$/);
  if (decimalMatch) {
    const numericValue = Number.parseFloat(
      `${Number(decimalMatch[1])}.${decimalMatch[2].padEnd(2, "0")}`
    );
    return buildAmountResult(numericValue);
  }

  if (allowImpliedCents && /^\d{3,5}$/.test(normalizedToken)) {
    const numericValue = Number(normalizedToken.slice(0, -2)) + Number(normalizedToken.slice(-2)) / 100;
    return buildAmountResult(numericValue);
  }

  if (allowWholeNumbers && /^\d{1,4}$/.test(normalizedToken)) {
    return buildAmountResult(Number(normalizedToken));
  }

  return null;
}

function findLargestStructuredAmount(lines) {
  return findLargestAmountInRange(lines, 0, lines.length - 1);
}

function findLargestAmountInRange(lines, startIndex, endIndex) {
  let bestCandidate = null;

  lines.forEach((line, index) => {
    if (index < startIndex || index > endIndex) {
      return;
    }

    for (const amount of extractAmounts(line, {
      allowImpliedCents: true,
      allowWholeNumbers: false,
      includeLooseIntegers: false,
    })) {
      if (!bestCandidate || amount.numericValue > bestCandidate.numericValue) {
        bestCandidate = {
          amount: amount.normalized,
          numericValue: amount.numericValue,
        };
      }
    }
  });

  return bestCandidate;
}

function normalizeOcrLabel(line) {
  return (line || "")
    .toLowerCase()
    .replace(/0/g, "o")
    .replace(/7/g, "t")
    .replace(/[1|!]/g, "i")
    .replace(/5/g, "s");
}

function buildAmountResult(numericValue) {
  if (!Number.isFinite(numericValue) || numericValue <= 0 || numericValue >= 100000) {
    return null;
  }

  return {
    normalized: normalizeCurrencyValue(numericValue),
    numericValue,
  };
}

function normalizeCurrencyValue(value) {
  return Number(value).toFixed(2);
}

function findReceiptDate(lines) {
  const labeledLine = lines.find((line) => /(date|transaction|purchase)/i.test(line));
  const candidates = labeledLine ? [labeledLine, ...lines] : lines;

  for (const line of candidates) {
    const directDate = parseDateCandidate(line);
    if (directDate) {
      return directDate;
    }
  }

  return "";
}

function parseDateCandidate(text) {
  const numericMatch = text.match(/\b(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\b/);
  if (numericMatch) {
    return normalizeDateString(numericMatch[1]);
  }

  const isoMatch = text.match(/\b(\d{4}[/-]\d{1,2}[/-]\d{1,2})\b/);
  if (isoMatch) {
    return normalizeDateString(isoMatch[1]);
  }

  const namedMonthMatch = text.match(
    /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*[\s,.-]+(\d{1,2})[\s,.-]+(\d{2,4})\b/i
  );
  if (namedMonthMatch) {
    const candidate = `${namedMonthMatch[1]} ${namedMonthMatch[2]} ${namedMonthMatch[3]}`;
    return normalizeDateString(candidate);
  }

  const dayFirstMonthMatch = text.match(
    /\b(\d{1,2})[\s,.-]+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*[\s,.-]*'?(\d{2,4})\b/i
  );
  if (dayFirstMonthMatch) {
    const candidate = `${dayFirstMonthMatch[2]} ${dayFirstMonthMatch[1]} ${dayFirstMonthMatch[3]}`;
    return normalizeDateString(candidate);
  }

  return "";
}

function normalizeDateString(value) {
  const numericMatch = value.match(/^(\d{1,4})[/-](\d{1,2})[/-](\d{1,4})$/);
  if (numericMatch) {
    let year;
    let month;
    let day;

    if (numericMatch[1].length === 4) {
      year = Number(numericMatch[1]);
      month = Number(numericMatch[2]);
      day = Number(numericMatch[3]);
    } else {
      month = Number(numericMatch[1]);
      day = Number(numericMatch[2]);
      year = Number(numericMatch[3]);
      if (year < 100) {
        year += year >= 70 ? 1900 : 2000;
      }
    }

    return normalizeDateParts(year, month, day);
  }

  const monthNameMatch = value.match(
    /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+(\d{1,2})\s+'?(\d{2,4})$/i
  );
  if (monthNameMatch) {
    const monthLookup = {
      jan: 1,
      feb: 2,
      mar: 3,
      apr: 4,
      may: 5,
      jun: 6,
      jul: 7,
      aug: 8,
      sep: 9,
      sept: 9,
      oct: 10,
      nov: 11,
      dec: 12,
    };
    const year = normalizeYear(Number(monthNameMatch[3]));
    const month = monthLookup[monthNameMatch[1].toLowerCase()];
    const day = Number(monthNameMatch[2]);
    return normalizeDateParts(year, month, day);
  }

  return "";
}

function normalizeYear(year) {
  if (year < 100) {
    return year >= 70 ? year + 1900 : year + 2000;
  }

  return year;
}

function normalizeDateParts(year, month, day) {
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    year < 2000 ||
    year > 2100 ||
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

  const normalizedMonth = `${month}`.padStart(2, "0");
  const normalizedDay = `${day}`.padStart(2, "0");
  return `${year}-${normalizedMonth}-${normalizedDay}`;
}

function suggestCategory(merchant, rawText) {
  const text = `${merchant} ${rawText}`.toLowerCase();

  if (/(hotel|inn|resort|marriott|hilton|hyatt|hampton|motel|lodging|suites)/.test(text)) {
    return "Lodging";
  }

  if (/(airlines|flight|airport|delta|united|american airlines|southwest|jetblue|alaska air)/.test(text)) {
    return "Flight";
  }

  if (/(uber|lyft|taxi|parking|garage|metro|train|rail|shuttle|rental car|hertz|avis|enterprise|transport)/.test(text)) {
    return "Transport";
  }

  if (/(restaurant|cafe|coffee|grill|pizza|burger|bar|bistro|diner|meal|lunch|dinner|breakfast)/.test(text)) {
    return "Meal";
  }

  if (/(office|supplies|staples|fedex|ups|target|walmart|best buy|depot)/.test(text)) {
    return "Supplies";
  }

  return "Miscellaneous";
}

function hasOptionalDetails(expense) {
  return Boolean(
    expense.location ||
      expense.notes ||
      expense.submittedDate ||
      expense.reimbursedDate
  );
}

async function useCurrentLocation() {
  if (!("geolocation" in navigator)) {
    window.alert("Location capture is not available in this browser.");
    return;
  }

  elements.useLocationButton.disabled = true;
  elements.useLocationButton.textContent = "Locating...";

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const latitude = position.coords.latitude.toFixed(5);
      const longitude = position.coords.longitude.toFixed(5);
      elements.location.value = `GPS ${latitude}, ${longitude}`;
      elements.useLocationButton.disabled = false;
      elements.useLocationButton.textContent = "Use GPS";
    },
    () => {
      window.alert("Trip Ledger could not access your location.");
      elements.useLocationButton.disabled = false;
      elements.useLocationButton.textContent = "Use GPS";
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 60000,
    }
  );
}
