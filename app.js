const form = document.querySelector("#signup-form");
const optionList = document.querySelector("#option-list");
const submitButton = document.querySelector("#submit-button");
const formMessage = document.querySelector("#form-message");
const placesLeft = document.querySelector("#places-left");
const successState = document.querySelector("#success-state");
const successCopy = document.querySelector("#success-copy");

let options = [];
let selectedOptionId = "";
let submitting = false;
let completed = false;

function renderOptions() {
  const hasAvailableOptions = options.some((option) => option.remaining > 0);
  const totalRemaining = options.reduce((total, option) => total + option.remaining, 0);
  placesLeft.textContent = totalRemaining;

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
      return `<button class="option-card${selected ? " selected" : ""}${full ? " full" : ""}" type="button" role="radio" aria-checked="${selected}" aria-disabled="${full}" data-option-id="${option.id}"${full ? " disabled" : ""}>
        <span class="option-main"><span class="radio-mark" aria-hidden="true"></span><span class="option-name">${escapeHtml(option.label)}</span></span>
        <span class="option-count"><span>${remainingLabel}</span><span class="capacity-ticks" aria-hidden="true">${ticks}</span></span>
      </button>`;
    }).join("");
    if (!hasAvailableOptions) {
      optionList.insertAdjacentHTML("beforeend", '<div class="empty-state">All places are filled. There are no options left to choose.</div>');
    }
  }

  submitButton.disabled = completed || submitting || !selectedOptionId;
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

async function refreshOptions() {
  try {
    const response = await fetch("/api/options", { cache: "no-store" });
    if (!response.ok) throw new Error("Availability could not be loaded.");
    const data = await response.json();
    options = data.options;
    renderOptions();
  } catch {
    if (options.length === 0) {
      optionList.innerHTML = '<div class="empty-state">Could not load options. Check your connection and refresh the page.</div>';
    }
  }
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
  if (!selectedOptionId || submitting || completed) return;

  const values = new FormData(form);
  submitting = true;
  formMessage.textContent = "";
  submitButton.disabled = true;

  try {
    const response = await fetch("/api/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: values.get("name"),
        email: values.get("email"),
        option_id: selectedOptionId,
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      formMessage.textContent = data.message || "Your response could not be saved.";
      await refreshOptions();
      return;
    }

    completed = true;
    successCopy.textContent = `Your place for ${data.option} has been reserved.`;
    form.hidden = true;
    successState.hidden = false;
    await refreshOptions();
  } catch {
    formMessage.textContent = "Couldn't reach the server. Please try again.";
  } finally {
    submitting = false;
    renderOptions();
  }
});

refreshOptions();
window.setInterval(refreshOptions, 4000);