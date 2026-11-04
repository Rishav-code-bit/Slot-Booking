const form = document.querySelector("#signup-form");
const optionList = document.querySelector("#option-list");
const submitButton = document.querySelector("#submit-button");
const formMessage = document.querySelector("#form-message");
const placesLeft = document.querySelector("#places-left");
const successState = document.querySelector("#success-state");
const successCopy = document.querySelector("#success-copy");
const choiceHint = document.querySelector("#choice-hint");
const storageKey = "commonplace-static-signups";

const STATIC_OPTIONS = [
  { id: "option_a", label: "Monday, Tuesday", capacity: 2 },
  { id: "option_b", label: "Tuesday, Wednesday", capacity: 2 },
  { id: "option_c", label: "Wednesday, Thursday", capacity: 2 },
  { id: "option_e", label: "Friday, Saturday", capacity: 2 },
  { id: "option_f", label: "Saturday, Sunday", capacity: 2 },
];

let submissions = loadSubmissions();
let selectedOptionId = "";
let completed = false;

function loadSubmissions() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || "[]");
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

function getOptions() {
  return STATIC_OPTIONS.map((option) => {
    const taken = submissions.filter((submission) => submission.option_id === option.id).length;
    return { ...option, taken, remaining: Math.max(0, option.capacity - taken) };
  });
}

function renderOptions() {
  const options = getOptions();
  const hasAvailableOptions = options.some((option) => option.remaining > 0);
  const totalRemaining = options.reduce((total, option) => total + option.remaining, 0);
  placesLeft.textContent = totalRemaining;
  choiceHint.textContent = "Saved only in this browser";

  if (!options.some((option) => option.id === selectedOptionId && option.remaining > 0)) {
    if (selectedOptionId) {
      formMessage.textContent = "That option just filled up. Please choose another.";
    }
    selectedOptionId = "";
  }

  if (options.length === 0) {
    optionList.innerHTML = '<div class="empty-state">All places are filled. There are no options left to choose.</div>';
  } else {
    optionList.innerHTML = options.map((option) => {
      const selected = option.id === selectedOptionId;
      const full = option.remaining <= 0;
      const ticks = Array.from({ length: option.capacity }, (_, index) =>
        `<span class="capacity-tick${index < option.taken ? " filled" : ""}"></span>`
      ).join("");
      const remainingLabel = full ? "FULL" : `${option.remaining} ${option.remaining === 1 ? "place" : "places"} left`;
      const selectedPeople = submissions
        .filter((submission) => submission.option_id === option.id);
      const namesLine = selectedPeople.length
        ? `<div class="option-people"><span class="option-people-label">SELECTED BY</span><ul class="option-people-list">${selectedPeople.map((submission) => `<li><span class="option-people-name">${escapeHtml(submission.name)}</span></li>`).join("")}</ul></div>`
        : "";
      return `<div class="option-entry"><button class="option-card${selected ? " selected" : ""}${full ? " full" : ""}" type="button" role="radio" aria-checked="${selected}" aria-disabled="${full}" data-option-id="${option.id}"${full ? " disabled" : ""}>
        <span class="option-main"><span class="radio-mark" aria-hidden="true"></span><span class="option-name">${escapeHtml(option.label)}</span></span>
        <span class="option-count"><span>${remainingLabel}</span><span class="capacity-ticks" aria-hidden="true">${ticks}</span></span>
      </button>${namesLine}</div>`;
    }).join("");
    if (!hasAvailableOptions) {
      optionList.insertAdjacentHTML("beforeend", '<div class="empty-state">All places are filled. There are no options left to choose.</div>');
    }
  }

  submitButton.disabled = completed || !selectedOptionId;
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

optionList.addEventListener("click", (event) => {
  const card = event.target.closest("[data-option-id]");
  if (!card || card.disabled || completed) return;
  selectedOptionId = card.dataset.optionId;
  formMessage.textContent = "";
  renderOptions();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!selectedOptionId || completed) return;

  const values = new FormData(form);
  const name = String(values.get("name") || "").trim();
  const email = String(values.get("email") || "").trim().toLowerCase();
  const option = getOptions().find((item) => item.id === selectedOptionId);

  if (!option || option.remaining < 1) {
    formMessage.textContent = "That option is full. Please choose another.";
    renderOptions();
    return;
  }

  if (submissions.some((submission) => submission.email === email)) {
    formMessage.textContent = "This email already has a selection in this browser.";
    return;
  }

  const nextSubmissions = [...submissions, { name, email, option_id: selectedOptionId }];
  try {
    localStorage.setItem(storageKey, JSON.stringify(nextSubmissions));
  } catch {
    formMessage.textContent = "Your browser could not save this selection.";
    return;
  }

  submissions = nextSubmissions;
  completed = true;
  successCopy.textContent = `${option.label} was saved in this browser.`;
  form.hidden = true;
  successState.hidden = false;
  renderOptions();
});

window.addEventListener("storage", (event) => {
  if (event.key === storageKey) {
    submissions = loadSubmissions();
    renderOptions();
  }
});

renderOptions();
