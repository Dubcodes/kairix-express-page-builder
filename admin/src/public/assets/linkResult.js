export const invitationLinkNote = "This is a one-time link. It expires after the selected time. If approval is required, the user cannot log in until approved.";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function renderLinkResult(label, url, { note = "" } = {}) {
  if (!url) return "";
  return `
    <div class="link-result">
      <label>${escapeHtml(label)}<input readonly value="${escapeHtml(url)}" onclick="this.select()"></label>
      <a class="action-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Open</a>
      <button class="secondary" type="button" data-copy-value="${escapeHtml(url)}">Copy</button>
      ${note ? `<p class="muted wide">${escapeHtml(note)}</p>` : ""}
    </div>
  `;
}
