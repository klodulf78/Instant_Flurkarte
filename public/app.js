const sampleMapUrl = createMapUrl(642244.004, 5649191.892);
const form = document.querySelector("#searchForm");
const addressInput = document.querySelector("#addressInput");
const addressError = document.querySelector("#addressError");
const submitButton = document.querySelector("#submitButton");
const steps = [...document.querySelectorAll(".step-card")];
const workflowSection = document.querySelector(".workflow-section");
const resultsSection = document.querySelector("#resultsSection");
const toast = document.querySelector("#toast");
const heroMapImage = document.querySelector("#heroMapImage");
const parcelPreviewImage = document.querySelector("#parcelPreviewImage");
const copyParcelButton = document.querySelector("#copyParcelButton");

const fields = {
  address: document.querySelector("#resultAddress"),
  parcel: document.querySelector("#resultParcel"),
  bundesland: document.querySelector("#resultBundesland"),
  source: document.querySelector("#resultSource"),
  timestamp: document.querySelector("#resultTimestamp"),
  status: document.querySelector("#resultStatus"),
  download: document.querySelector("#downloadButton")
};

let activeResult = null;
let stepTimers = [];

heroMapImage.src = sampleMapUrl;
heroMapImage.addEventListener("error", () => {
  heroMapImage.style.display = "none";
});
parcelPreviewImage.addEventListener("error", () => {
  parcelPreviewImage.style.display = "none";
});

animateKpi();
setStepState(-1);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  await runSearch();
});

addressInput.addEventListener("input", () => {
  clearInlineError();
});

copyParcelButton.addEventListener("click", async () => {
  if (!activeResult?.flurstueckskennzeichen) {
    return;
  }

  try {
    await copyText(activeResult.flurstueckskennzeichen);
    showToast("Parcel ID copied.");
  } catch {
    showToast("Parcel ID ready to copy: " + activeResult.flurstueckskennzeichen);
  }
});

async function runSearch() {
  const address = addressInput.value.trim();
  clearInlineError();

  if (!address) {
    showInlineError("Please enter a street, house number and city in Thüringen.");
    return;
  }

  activeResult = null;
  resultsSection.hidden = true;
  resultsSection.classList.remove("is-ready");
  submitButton.disabled = true;
  submitButton.classList.add("is-loading");
  startWorkflow();
  workflowSection.scrollIntoView({ behavior: "smooth", block: "start" });

  try {
    const response = await fetch("/api/flurkarte", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        address,
        bundesland: "Thüringen"
      })
    });

    const body = await response.json();
    if (!response.ok) {
      const error = body?.error || {};
      if (["INVALID_ADDRESS", "UNSUPPORTED_SEARCH"].includes(error.code)) {
        setStepState(-1);
        showInlineError(error.message || "Please enter a street, house number and city in Thüringen.");
        return;
      }

      throw new Error(error.message || "Could not retrieve the official document.");
    }

    activeResult = body;
    completeWorkflow();
    renderResult(body);
    showToast("Official PDF ready.");
  } catch (error) {
    setStepState(-1);
    showToast(error.message);
  } finally {
    submitButton.disabled = false;
    submitButton.classList.remove("is-loading");
  }
}

function showInlineError(message) {
  addressError.textContent = message;
  addressError.hidden = false;
  addressInput.setAttribute("aria-invalid", "true");
  addressInput.setAttribute("aria-describedby", "addressError");
}

function clearInlineError() {
  addressError.hidden = true;
  addressInput.removeAttribute("aria-invalid");
  addressInput.removeAttribute("aria-describedby");
}

function renderResult(result) {
  fields.address.textContent = result.address || "-";
  fields.parcel.textContent = result.flurstueckskennzeichen || "-";
  fields.bundesland.textContent = result.bundesland || "-";
  fields.source.textContent = result.source || "-";
  fields.timestamp.textContent = formatTimestamp(result.extractedAt);
  fields.status.textContent = result.officialDocumentStatus || "PDF ready";
  fields.download.href = result.pdfUrl;

  parcelPreviewImage.style.display = "block";
  parcelPreviewImage.src = result.previewMapUrl || sampleMapUrl;
  resultsSection.hidden = false;
  requestAnimationFrame(() => {
    resultsSection.classList.add("is-ready");
  });
  resultsSection.scrollIntoView({ behavior: "smooth", block: "start" });
}

function startWorkflow() {
  clearWorkflowTimers();
  setStepState(0);
  stepTimers = [
    window.setTimeout(() => setStepState(1), 900),
    window.setTimeout(() => setStepState(2), 1900),
    window.setTimeout(() => setStepState(3), 2900)
  ];
}

function completeWorkflow() {
  clearWorkflowTimers();
  steps.forEach((step) => {
    step.classList.remove("is-active", "is-pending");
    step.classList.add("is-complete");
  });
}

function setStepState(activeIndex) {
  steps.forEach((step, index) => {
    step.classList.toggle("is-active", index === activeIndex);
    step.classList.toggle("is-complete", activeIndex > index);
    step.classList.toggle("is-pending", activeIndex < index);
  });
}

function clearWorkflowTimers() {
  stepTimers.forEach((timer) => window.clearTimeout(timer));
  stepTimers = [];
}

function animateKpi() {
  const counter = document.querySelector("#kpiCounter");
  const start = performance.now();
  const duration = 900;

  function frame(now) {
    const progress = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    counter.textContent = String(Math.round(eased * 98));
    if (progress < 1) {
      requestAnimationFrame(frame);
    }
  }

  requestAnimationFrame(frame);
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    toast.classList.remove("is-visible");
  }, 3200);
}

function formatTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value || "-";
  }

  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "medium"
  }).format(date);
}

async function copyText(value) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();

  const copied = document.execCommand("copy");
  document.body.removeChild(textarea);

  if (!copied) {
    throw new Error("Copy command failed.");
  }
}

function createMapUrl(x, y) {
  const widthMeters = 220;
  const heightMeters = 160;
  const url = new URL("https://www.geoproxy.geoportal-th.de/geoproxy/services/ALKISINFOLIKA?client=infolika");
  const params = {
    SERVICE: "WMS",
    VERSION: "1.3.0",
    REQUEST: "GetMap",
    LAYERS: "TH-ALKIS_infolika",
    STYLES: "",
    CRS: "EPSG:25832",
    BBOX: [
      x - widthMeters / 2,
      y - heightMeters / 2,
      x + widthMeters / 2,
      y + heightMeters / 2
    ].join(","),
    WIDTH: "900",
    HEIGHT: "620",
    FORMAT: "image/png",
    TRANSPARENT: "false",
    DPI: "196"
  };

  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  return String(url);
}
