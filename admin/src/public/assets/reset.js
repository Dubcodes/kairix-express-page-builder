const form = document.querySelector("#resetForm");
const message = document.querySelector("#message");
const token = new URLSearchParams(location.search).get("token");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form));
  const response = await fetch("/api/password-reset/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...data, token })
  });
  const json = await response.json().catch(() => ({}));
  message.textContent = response.ok ? "Password reset. You can now log in." : json.error || "Reset failed.";
  message.classList.toggle("error", !response.ok);
});
