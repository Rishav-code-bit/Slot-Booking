const responseGroups = document.querySelector("#response-groups");
const responseCount = document.querySelector("#responses-count");
const lastUpdated = document.querySelector("#last-updated");
const refreshButton = document.querySelector("#refresh-button");
const logoutButton = document.querySelector("#logout-button");
const adminMessage = document.querySelector("#admin-message");

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

async function loadResponses() {
  try {
    const response = await fetch("/api/responses", { cache: "no-store" });
    if (response.status === 401) {
      window.location.replace("/admin.html");
      return;
    }
    if (!response.ok) throw new Error("Could not load the current list.");
    const data = await response.json();
    const total = data.options.reduce((count, option) => count + option.people.length, 0);
    responseCount.textContent = total;
    responseGroups.innerHTML = data.options.map((option) => {
      const names = option.people.length
        ? `<ol class="people-list">${option.people.map((person) => `<li><span>${escapeHtml(person.name)}</span><button class="remove-button" type="button" data-cancel-id="${person.id}" data-person-name="${escapeHtml(person.name)}" aria-label="Cancel ${escapeHtml(person.name)}'s place">CANCEL PLACE</button></li>`).join("")}</ol>`
        : '<p class="no-people">No one has chosen this option yet.</p>';
      return `<section class="response-group">
        <div class="response-group-heading"><h3>${escapeHtml(option.label)}</h3><span>${option.people.length} / ${option.capacity} PLACES</span></div>
        <div class="response-capacity" aria-label="${option.people.length} of ${option.capacity} places taken">${Array.from({ length: option.capacity }, (_, index) => `<span class="response-capacity-tick${index < option.people.length ? " filled" : ""}"></span>`).join("")}</div>
        ${names}
      </section>`;
    }).join("");
    lastUpdated.textContent = `UPDATED ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  } catch {
    if (!responseGroups.dataset.loaded) {
      responseGroups.innerHTML = '<div class="empty-state">Could not load selections. Check your connection and try again.</div>';
    }
  }
  responseGroups.dataset.loaded = "true";
}

refreshButton.addEventListener("click", loadResponses);

responseGroups.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-cancel-id]");
  if (!button || button.disabled) return;
  const name = button.dataset.personName;
  if (!window.confirm(`Cancel ${name}'s place? This will reopen the spot.`)) return;
  button.disabled = true;

  try {
    const response = await fetch("/api/admin/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ submission_id: button.dataset.cancelId }),
    });
    const data = await response.json();
    if (response.status === 401) {
      window.location.replace("/admin.html");
      return;
    }
    if (!response.ok) throw new Error(data.message || "The place could not be cancelled.");
    adminMessage.textContent = data.message;
    adminMessage.classList.add("success");
    await loadResponses();
  } catch (error) {
    adminMessage.classList.remove("success");
    adminMessage.textContent = error.message || "Couldn't reach the server. Please try again.";
  } finally {
    button.disabled = false;
  }
});

logoutButton.addEventListener("click", async () => {
  await fetch("/api/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  window.location.replace("/admin.html");
});

loadResponses();
window.setInterval(loadResponses, 10_000);