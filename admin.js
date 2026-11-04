const loginForm = document.querySelector("#login-form");
const loginButton = document.querySelector("#login-button");
const loginMessage = document.querySelector("#login-message");

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (loginButton.disabled) return;
  const values = new FormData(loginForm);
  loginButton.disabled = true;
  loginMessage.textContent = "";

  try {
    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: values.get("username"),
        password: values.get("password"),
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || "Sign in failed.");
    window.location.assign("/responses.html");
  } catch (error) {
    loginMessage.textContent = error.message || "Couldn't reach the server. Please try again.";
  } finally {
    loginButton.disabled = false;
  }
});