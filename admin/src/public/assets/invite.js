const form = document.querySelector("#inviteForm");
const message = document.querySelector("#message");
const token = new URLSearchParams(location.search).get("token");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form));
  const response = await fetch("/api/invites/accept", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...data, token })
  });
  const json = await response.json().catch(() => ({}));
  message.textContent = response.ok
    ? json.status === "pending" ? "Account created and waiting for admin approval." : "Account created. You can now log in."
    : json.error || "Invite failed.";
  message.classList.toggle("error", !response.ok);
});
