const app = document.querySelector("#app");
const adminTitle = document.querySelector("#adminTitle");
const adminLogo = document.querySelector("#adminLogo");
const sessionBox = document.querySelector("#sessionBox");
const sessionLabel = document.querySelector("#sessionLabel");
const logoutBtn = document.querySelector("#logoutBtn");

const state = {
  me: null,
  settings: {},
  categories: [],
  products: [],
  files: [],
  downloads: [],
  packs: [],
  contactMethods: [],
  aliexpress: null,
  backups: [],
  csvPreview: null,
  users: [],
  invites: [],
  tab: "dashboard",
  settingsSection: "branding",
  productSearch: "",
  downloadSearch: "",
  mediaSearch: "",
  mediaFilter: "all",
  showArchivedProducts: false,
  bundleSearch: "",
  userSearch: "",
  selectedDownloadId: null,
  showDownloadEditor: false,
  showProductForm: false,
  editingProductId: null,
  editingProduct: null,
  editingContactMethodId: null
};

const tabs = [
  ["dashboard", "Dashboard"],
  ["home", "Home Page"],
  ["products", "Products"],
  ["downloads", "Downloads"],
  ["bundles", "Software Bundles"],
  ["publish", "Publish"],
  ["analytics", "Analytics"],
  ["settings", "Settings"]
];

const settingsSections = [
  ["branding", "Branding"],
  ["support", "Support/contact"],
  ["media", "Media Library"],
  ["users", "Users & Invites"],
  ["integrations", "Marketplace Integrations"],
  ["operations", "Import / Export / Backups"],
  ["advanced", "Advanced"]
];

function applyStoredNavigation() {
  const rawHash = window.location.hash.replace(/^#/, "");
  const saved = localStorage.getItem("kairixAdminNav") || "";
  const [tab, section] = (rawHash || saved).split("/");
  if (tabs.some(([id]) => id === tab)) state.tab = tab;
  if (settingsSections.some(([id]) => id === section)) state.settingsSection = section;
}

function saveNavigation() {
  const hash = state.tab === "settings" ? `${state.tab}/${state.settingsSection}` : state.tab;
  localStorage.setItem("kairixAdminNav", hash);
  if (window.location.hash.replace(/^#/, "") !== hash) window.history.replaceState(null, "", `#${hash}`);
}

async function api(path, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  const headers = options.body instanceof FormData ? {} : { "Content-Type": "application/json" };
  if (state.csrfToken && ["POST", "PUT", "PATCH", "DELETE"].includes(method)) headers["X-CSRF-Token"] = state.csrfToken;
  const response = await fetch(path, {
    headers,
    ...options,
    body: options.body instanceof FormData ? options.body : options.body ? JSON.stringify(options.body) : undefined
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(json.error || json.details || "Request failed");
    error.data = json;
    error.status = response.status;
    throw error;
  }
  return json;
}

function template(id) {
  return document.querySelector(id).content.cloneNode(true);
}

function setStatus(message, error = false) {
  let status = document.querySelector("#status");
  if (!status) {
    status = document.createElement("p");
    status.id = "status";
    status.className = "status";
    app.prepend(status);
  }
  status.textContent = message;
  status.classList.toggle("error", error);
}

function optionList(rows, selected = []) {
  const selectedSet = new Set((selected || []).map(Number));
  return rows.map((row) => `<option value="${row.id}" ${selectedSet.has(Number(row.id)) ? "selected" : ""}>${escapeHtml(row.name)}</option>`).join("");
}

function settingEnabled(value, defaultValue = false) {
  if (value === undefined || value === null || value === "") return defaultValue;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function normalizedName(value = "") {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function findCategoryByName(name) {
  const normalized = normalizedName(name);
  if (!normalized) return null;
  return state.categories.find((category) => normalizedName(category.name) === normalized) || null;
}

function categoryNameById(id) {
  const category = state.categories.find((item) => Number(item.id) === Number(id));
  return category?.name || "";
}

function categoryDatalistOptions() {
  return state.categories.map((category) => `<option value="${escapeHtml(category.name)}"></option>`).join("");
}

function imageFiles() {
  return state.files.filter(isImageFile);
}

function normalizeProductState(productOrState = "") {
  const value = typeof productOrState === "object"
    ? String(productOrState.publish_state || productOrState.status || "").toLowerCase()
    : String(productOrState || "").toLowerCase();
  if (typeof productOrState === "object" && Number(productOrState.archived || 0)) return "archived";
  if (value === "published") return "published";
  if (value === "not_ready" || value === "ready" || value === "needs_review") return "not_ready";
  if (value === "archived") return "archived";
  return "draft";
}

function productStateLabel(productOrState = "") {
  const stateValue = normalizeProductState(productOrState);
  return {
    draft: "Draft",
    not_ready: "Not ready",
    published: "Published",
    archived: "Archived"
  }[stateValue] || "Draft";
}

function isArchivedProduct(product) {
  return normalizeProductState(product) === "archived";
}

function activeProducts() {
  return state.products.filter((product) => !isArchivedProduct(product));
}

function fileIdForUrl(url = "") {
  const file = state.files.find((item) => String(item.url || "") === String(url || ""));
  return file ? [file.id] : [];
}

function fileLabelForUrl(url = "") {
  const file = state.files.find((item) => String(item.url || "") === String(url || ""));
  return file?.originalName || file?.original_name || "";
}

function imageUrlsFromSetting(value = "") {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  const raw = String(value || "").trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
  } catch {
    // Existing installs stored one image URL as plain text.
  }
  return [raw];
}

function fileIdsForUrls(urls = []) {
  const wanted = new Set(urls.map(String));
  return state.files.filter((item) => wanted.has(String(item.url || ""))).map((item) => item.id);
}

function imageSettingPicker(name, value = "") {
  return picker(name, imageFiles(), fileIdForUrl(value), "images", {
    single: true,
    valueField: "url",
    hiddenName: name,
    hiddenValue: value || "",
    hiddenLabel: fileLabelForUrl(value),
    searchPlaceholder: "Search images (SVG, PNG, JPG, WebP, GIF)"
  });
}

function imageSettingMultiPicker(name, value = "") {
  const imageUrls = imageUrlsFromSetting(value);
  return picker(name, imageFiles(), fileIdsForUrls(imageUrls), "images", {
    ordered: true,
    valueField: "url",
    hiddenName: name,
    hiddenValue: JSON.stringify(imageUrls),
    selectedValues: imageUrls,
    searchPlaceholder: "Search images (SVG, PNG, JPG, WebP, GIF)"
  });
}

function formatBytes(size) {
  const bytes = Number(size || 0);
  if (!bytes) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function isImageFile(file) {
  const mime = String(file.mimeType || file.mime_type || "").toLowerCase();
  const name = String(file.originalName || file.original_name || file.name || file.url || "").toLowerCase();
  return mime.startsWith("image/") || /\.(svg|png|jpe?g|webp|gif)$/i.test(name);
}

function mediaKind(file) {
  const mime = String(file.mimeType || file.mime_type || "").toLowerCase();
  const name = String(file.originalName || file.original_name || "").toLowerCase();
  if (isImageFile(file)) return "images";
  if (mime.includes("pdf") || /\.(pdf|txt|md|docx?|xlsx?)$/i.test(name)) return "documents";
  if (mime.includes("zip") || /\.(exe|dmg|pkg|msi|bin|hex|uf2)$/i.test(name)) return "software";
  return "all";
}

function latestVersion(download) {
  return (download.versions || []).find((version) => version.is_latest) || (download.versions || [])[0] || null;
}

function latestVersionLabel(download) {
  const latest = latestVersion(download);
  return latest?.version_number ? `Latest ${latest.version_number}` : "No latest version";
}

function dataText(...values) {
  return values.filter(Boolean).join(" ").toLowerCase();
}

function filterRows(root, input, selector = "[data-filter-row]") {
  const query = String(input?.value || "").trim().toLowerCase();
  root.querySelectorAll(selector).forEach((row) => {
    const text = String(row.dataset.search || row.textContent || "").toLowerCase();
    row.classList.toggle("hidden", Boolean(query) && !text.includes(query));
  });
}

function bindLiveFilter(input, root, selector = "[data-filter-row]") {
  if (!input || !root) return;
  const apply = () => filterRows(root, input, selector);
  input.addEventListener("input", apply);
  apply();
}

function bindCopyButtons(root = document) {
  root.querySelectorAll("[data-copy-value]").forEach((button) => {
    if (button.dataset.copyBound) return;
    button.dataset.copyBound = "true";
    button.addEventListener("click", async () => copyText(button.dataset.copyValue || "", button));
  });
}

async function copyText(value, source) {
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
    else throw new Error("Clipboard unavailable");
  } catch {
    const input = source?.closest(".link-result")?.querySelector("input") || source?.parentElement?.querySelector("input");
    if (input) {
      input.focus();
      input.select();
      document.execCommand("copy");
    }
  }
  if (source) {
    const original = source.textContent;
    source.textContent = "Copied";
    window.setTimeout(() => {
      source.textContent = original;
    }, 1400);
  }
  setStatus("Copied.");
}

function mediaThumb(file) {
  const name = file.originalName || file.original_name || "file";
  const url = file.url || "#";
  const extension = String(name).split(".").pop().slice(0, 4).toUpperCase();
  if (isImageFile(file)) {
    return `
      <button class="thumb-button" type="button" data-preview-image="${escapeHtml(url)}" data-preview-title="${escapeHtml(name)}" title="Preview ${escapeHtml(name)}" aria-label="Preview ${escapeHtml(name)}">
        <img class="media-thumb" src="${escapeHtml(url)}" alt="">
      </button>
    `;
  }
  return `<span class="media-thumb media-thumb-icon" title="${escapeHtml(name)}">${escapeHtml(extension)}</span>`;
}

function pickerIcon(label) {
  return `<span class="media-thumb media-thumb-icon" aria-hidden="true">${escapeHtml(label)}</span>`;
}

function pickerBody(inputId, title, detail = "") {
  return `
    <label class="picker-main" for="${escapeHtml(inputId)}" title="${escapeHtml(title)}">
      <strong>${escapeHtml(title)}</strong>
      ${detail ? `<small>${escapeHtml(detail)}</small>` : ""}
    </label>
  `;
}

function pickerMeta(row, kind, inputId) {
  if (kind === "files" || kind === "images") {
    const title = row.originalName || row.original_name || `File ${row.id}`;
    return `${mediaThumb(row)}${pickerBody(inputId, title, `${row.mimeType || row.mime_type || ""} · ${formatBytes(row.size)}`)}<a class="action-link mini-action" href="${escapeHtml(row.url || "#")}" target="_blank" rel="noopener noreferrer">Open</a>`;
  }
  if (kind === "products") return `${pickerIcon("PRD")}${pickerBody(inputId, row.name, `${row.sku || "No SKU"} · ${row.category_name || "No category"} · ${row.import_sync_status ? "Synced" : "Local"}`)}<span></span>`;
  if (kind === "downloads") return `${pickerIcon("DLD")}${pickerBody(inputId, row.name, `${row.type} · ${latestVersionLabel(row)}`)}<span></span>`;
  if (kind === "bundles") return `${pickerIcon("BND")}${pickerBody(inputId, row.name, `${Number(row.downloadIds?.length || 0)} download(s) · ${row.bundle_file_id ? "ZIP generated" : row.auto_generate_zip ? "ZIP on publish" : "No ZIP"}`)}<span></span>`;
  return `${pickerIcon("ITM")}${pickerBody(inputId, row.name || row.originalName || `Item ${row.id}`)}<span></span>`;
}

function pickerSearchText(row, kind) {
  if (kind === "files" || kind === "images") return dataText(row.originalName, row.mimeType, row.size);
  if (kind === "products") return dataText(row.name, row.sku, row.category_name, row.import_sync_status);
  if (kind === "downloads") return dataText(row.name, row.type, latestVersionLabel(row));
  if (kind === "bundles") return dataText(row.name, row.description);
  return dataText(row.name, row.originalName);
}

function pickerValue(row, field = "id") {
  return field === "url" ? row.url || "" : row[field] ?? row.id;
}

function pickerRowMarkup(name, row, kind, checked, options = {}) {
  const valueField = options.valueField || "id";
  const single = Boolean(options.single);
  const ordered = Boolean(options.ordered);
  const inputName = (single || ordered) ? `${name}Selection` : name;
  const inputId = `picker-${name}-${row.id}`;
  const value = pickerValue(row, valueField);
  return `
    <div class="picker-row ${checked ? "picker-selected" : ""}" data-picker-row data-picker-title="${escapeHtml(row.originalName || row.original_name || row.name || `Item ${row.id}`)}" data-search="${escapeHtml(pickerSearchText(row, kind))}">
      <input id="${escapeHtml(inputId)}" type="checkbox" name="${escapeHtml(inputName)}" value="${row.id}" data-picker-value="${escapeHtml(value)}" ${checked ? "checked" : ""}>
      ${pickerMeta(row, kind, inputId)}
    </div>
  `;
}

function picker(name, rows, selected = [], kind = "items", options = {}) {
  const single = Boolean(options.single);
  const ordered = Boolean(options.ordered);
  const valueField = options.valueField || "id";
  const hiddenName = options.hiddenName || ((single || ordered) ? name : "");
  const hiddenValue = options.hiddenValue || "";
  const hiddenLabel = options.hiddenLabel || "";
  const searchPlaceholder = options.searchPlaceholder || `Search ${kind}`;
  const selectedSet = new Set((selected || []).map(Number));
  const selectedValues = Array.isArray(options.selectedValues) ? options.selectedValues.map(String) : [];
  const selectedRow = rows.find((row) => selectedSet.has(Number(row.id)));
  const selectedTitle = selectedRow?.originalName || selectedRow?.original_name || selectedRow?.name || hiddenLabel;
  const selectedText = single
    ? selectedTitle ? `Selected: ${selectedTitle}` : hiddenValue ? "Selected file is missing" : "No image selected"
    : `${ordered ? selectedValues.length || selectedSet.size : selectedSet.size} selected`;
  return `
    <div class="picker ${single ? "picker-single" : ""} ${ordered ? "picker-ordered" : ""}" data-picker="${name}" data-picker-kind="${escapeHtml(kind)}" ${options.upload ? "data-picker-upload-enabled=\"true\"" : ""} ${options.uploadImageOnly ? "data-picker-upload-images=\"true\"" : ""} ${single ? `data-picker-mode="single"` : ""} ${ordered ? `data-picker-mode="ordered"` : ""} data-picker-value-field="${escapeHtml(valueField)}">
      ${(single || ordered) ? `<input type="hidden" name="${escapeHtml(hiddenName)}" value="${escapeHtml(hiddenValue)}" data-picker-hidden data-picker-initial="${escapeHtml(hiddenValue)}" data-picker-initial-label="${escapeHtml(hiddenLabel)}">` : ""}
      <div class="picker-toolbar">
        <input data-picker-search placeholder="${escapeHtml(searchPlaceholder)}" aria-label="${escapeHtml(searchPlaceholder)}">
        <span class="muted picker-status" data-picker-count>${escapeHtml(selectedText)}</span>
        ${options.upload ? `<label class="picker-upload-button secondary">Upload<input type="file" multiple data-picker-upload ${options.uploadImageOnly ? `accept=".svg,.png,.jpg,.jpeg,.webp,.gif,image/svg+xml,image/png,image/jpeg,image/webp,image/gif"` : ""}></label>` : ""}
        ${single ? "" : `<button class="secondary" type="button" data-picker-select-visible>Select all visible</button>`}
        <button class="secondary" type="button" data-picker-clear>Clear selected</button>
      </div>
      ${options.upload ? `<div class="picker-upload-results muted" data-picker-upload-results aria-live="polite"></div>` : ""}
      ${ordered ? `<div class="picker-order-list" data-picker-order aria-label="Selected image order"></div>` : ""}
      <div class="picker-list">
        ${rows.map((row) => pickerRowMarkup(name, row, kind, selectedSet.has(Number(row.id)), options)).join("") || "<p class='muted'>No items yet.</p>"}
      </div>
    </div>
  `;
}

function helpIcon(text) {
  return `<button class="help-icon" type="button" title="${escapeHtml(text)}" aria-label="${escapeHtml(text)}">?</button>`;
}

function downloadLabel(download) {
  return `${download.name} · ${download.type}`;
}

function supportPackIncludes(pack) {
  const ids = new Set((pack.downloadIds || []).map(Number));
  const included = state.downloads.filter((download) => ids.has(Number(download.id)));
  if (!included.length) return "<p class='muted'>No downloads included yet.</p>";
  return `<p class="muted">Includes:</p><ul class="compact-list">${included.map((download) => `<li>${escapeHtml(downloadLabel(download))}</li>`).join("")}</ul>`;
}

function roleOptions(selected = "Read Only") {
  const roles = state.me?.roles || ["Read Only", "Analytics Viewer", "File Manager", "Editor", "Publisher", "Admin"];
  return roles.map((role) => `<option value="${role}" ${role === selected ? "selected" : ""}>${role}</option>`).join("");
}

function linkResult(label, url) {
  if (!url) return "";
  return `
    <div class="link-result">
      <label>${escapeHtml(label)}<input readonly value="${escapeHtml(url)}" onclick="this.select()"></label>
      <a class="action-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Open</a>
      <button class="secondary" type="button" data-copy-value="${escapeHtml(url)}">Copy</button>
      <p class="muted wide">This is a one-time link. It expires after the selected time. If approval is required, the user cannot log in until approved.</p>
    </div>
  `;
}

function stockLabel(product) {
  if (!product.stock_tracking) return "Not tracked";
  if (product.stock_display_mode === "hidden") return "Hidden";
  if (product.stock_count === null || product.stock_count === undefined || product.stock_count === "") return "Check marketplace";
  const count = Number(product.stock_count);
  if (product.stock_display_mode === "exact") return `${count} in stock`;
  if (count <= 0) return "Out of stock";
  if (count <= 4) return "Almost out";
  if (count <= 14) return "Low stock";
  return "10+ available";
}

function adminStockDisplay(product) {
  if (!product.stock_tracking) return { label: "Stock not tracked", detail: "", type: "neutral" };
  const missingCount = product.stock_count === null || product.stock_count === undefined || product.stock_count === "";
  if (missingCount) {
    if (String(product.stock_source || "").toLowerCase() === "marketplace") return { label: "Marketplace stock", detail: "", type: "synced" };
    return { label: "Check marketplace", detail: "", type: "neutral" };
  }
  const count = Number(product.stock_count);
  const detail = `${count} in stock`;
  if (count <= 0) return { label: "Out of stock", detail, type: "danger" };
  if (count <= 4) return { label: "Almost out", detail, type: "almost-out" };
  if (count <= 14) return { label: "Low stock", detail, type: "warning" };
  return { label: detail, detail: "", type: "success" };
}

function adminStockText(product) {
  const stock = adminStockDisplay(product);
  return [stock.label, stock.detail].filter(Boolean).join(" ");
}

function adminStockMarkup(product) {
  const stock = adminStockDisplay(product);
  return `<span class="stock-display">${pill(stock.label, stock.type)}${stock.detail ? `<span class="stock-detail">${escapeHtml(stock.detail)}</span>` : ""}</span>`;
}

function semanticType(value = "") {
  const text = String(value || "").toLowerCase();
  if (/success|published|active|complete|valid|available/.test(text)) return "success";
  if (/not ready/.test(text)) return "warning";
  if (/ready|latest/.test(text)) return "ready";
  if (/needs|warning|pending|review|low stock/.test(text)) return "warning";
  if (/almost out/.test(text)) return "almost-out";
  if (/out of stock|failed|error|invalid|deprecated/.test(text)) return "danger";
  if (/archived|disabled/.test(text)) return "disabled";
  if (/check marketplace|not tracked|hidden|local|manual/.test(text)) return "neutral";
  if (/sync|linked|marketplace|aliexpress/.test(text)) return "synced";
  if (/featured/.test(text)) return "featured";
  return "neutral";
}

function pill(label, type = "", title = "") {
  const semantic = type || semanticType(label);
  const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
  return `<span class="pill pill-${escapeHtml(semantic)}"${titleAttr}>${escapeHtml(label)}</span>`;
}

function formValues(form) {
  return Object.fromEntries(new FormData(form));
}

function checkedNumbers(form, name) {
  return [...form.querySelectorAll(`input[name="${name}"]:checked`)].map((input) => Number(input.value));
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function decodeEntities(value) {
  const textarea = document.createElement("textarea");
  textarea.innerHTML = String(value || "");
  return textarea.value;
}

function richHtmlToPlainText(value) {
  return decodeEntities(String(value || "")
    .replace(/<\/p>\s*<p[^>]*>/gi, "\n\n")
    .replace(/<p[^>]*>/gi, "")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/li>\s*<li[^>]*>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<\/?[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim());
}

function contactTypeOptions(selected = "link") {
  return ["link", "email", "phone", "marketplace"].map((type) => `<option value="${type}" ${type === selected ? "selected" : ""}>${type}</option>`).join("");
}

function pageManagerTitle(settings = {}) {
  const brandName = String(settings.brandName || "").trim() || "Kairix";
  return `${brandName} Page Manager`;
}

function updateAdminTitle(settings = {}) {
  const title = pageManagerTitle(settings);
  if (adminTitle) adminTitle.textContent = title;
  if (adminLogo) {
    adminLogo.src = settings.logo || "";
    adminLogo.classList.toggle("hidden", !settings.logo);
  }
  document.title = title;
}

function hasUnpublishedChanges() {
  return localStorage.getItem("kairixUnpublishedChanges") === "1";
}

function unpublishedAreas() {
  try {
    const areas = JSON.parse(localStorage.getItem("kairixUnpublishedAreas") || "[]");
    return Array.isArray(areas) ? areas : [];
  } catch {
    return [];
  }
}

function unpublishedNotice() {
  return hasUnpublishedChanges() ? `<button class="notice notice-action" type="button" data-open-publish>Unpublished changes - publish needed.</button>` : "";
}

function hasPublishedSite() {
  return Boolean(state.me?.hasPublishedSite);
}

function publicPreviewHref(pathname = "/") {
  const base = state.me?.publicPreviewUrl || "/preview/";
  if (pathname === "/" || !pathname) return base;
  try {
    const url = new URL(base, window.location.origin);
    const root = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;
    url.pathname = `${root}${String(pathname).replace(/^\/+/, "")}`.replace(/\/{2,}/g, "/");
    return url.toString();
  } catch {
    return `/preview/${String(pathname).replace(/^\/+/, "")}`;
  }
}

function previewLink(label, pathname = "/", title = "The preview shows the last successfully published customer site.", className = "action-link") {
  const attrs = `data-preview-link data-preview-path="${escapeHtml(pathname)}" data-preview-label="${escapeHtml(label)}" data-preview-title="${escapeHtml(title)}" data-preview-class="${escapeHtml(className)}"`;
  if (!hasPublishedSite()) {
    return `<span class="${escapeHtml(className)} disabled-link" ${attrs} aria-disabled="true" title="No published site yet. Click Publish first.">${escapeHtml(label)}</span>`;
  }
  return `<a class="${escapeHtml(className)}" ${attrs} href="${escapeHtml(publicPreviewHref(pathname))}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(title)}">${escapeHtml(label)}</a>`;
}

function refreshPreviewLinks(root = document) {
  root.querySelectorAll("[data-preview-link]").forEach((item) => {
    item.outerHTML = previewLink(
      item.dataset.previewLabel || item.textContent || "Open customer site preview",
      item.dataset.previewPath || "/",
      item.dataset.previewTitle || "The preview shows the last successfully published customer site.",
      item.dataset.previewClass || "action-link"
    );
  });
}

function markUnpublishedChanges(area = "Content changes") {
  localStorage.setItem("kairixUnpublishedChanges", "1");
  const areas = new Set(unpublishedAreas());
  if (area) areas.add(area);
  localStorage.setItem("kairixUnpublishedAreas", JSON.stringify([...areas]));
}

function clearUnpublishedChanges() {
  localStorage.removeItem("kairixUnpublishedChanges");
  localStorage.removeItem("kairixUnpublishedAreas");
}

function updateSessionUi(user) {
  const loggedIn = Boolean(user);
  if (sessionBox) sessionBox.classList.toggle("hidden", !loggedIn);
  if (sessionLabel) sessionLabel.textContent = loggedIn ? `${user.username} (${user.role})` : "";
  if (logoutBtn) logoutBtn.classList.toggle("hidden", !loggedIn);
}

async function refresh() {
  const me = await api("/api/me");
  state.me = me;
  state.csrfToken = me.csrfToken;
  updateSessionUi(me.user);
  if (me.needsSetup) return renderSetup();
  if (!me.user) return renderLogin();
  await loadData();
  renderAdmin();
}

async function loadData() {
  const [settings, categories, products, files, downloads, packs, contactMethods, aliexpress] = await Promise.all([
    api("/api/settings"),
    api("/api/categories"),
    api("/api/products?includeArchived=1"),
    api("/api/files"),
    api("/api/downloads"),
    api("/api/software-bundles"),
    api("/api/contact-methods"),
    api("/api/integrations/aliexpress/status")
  ]);
  state.settings = settings;
  updateAdminTitle(settings);
  state.categories = categories.categories;
  state.products = products.products;
  state.files = files.files;
  state.downloads = downloads.downloads;
  state.packs = packs.bundles || packs.packs;
  state.contactMethods = contactMethods.contactMethods || [];
  state.aliexpress = aliexpress.connection;
}

function renderSetup() {
  app.replaceChildren(template("#setupTemplate"));
  document.querySelector("#setupForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api("/api/setup", { method: "POST", body: new FormData(event.currentTarget) });
      setStatus("Setup complete. Log in with your admin account.");
      await refresh();
    } catch (error) {
      setStatus(error.message, true);
    }
  });
}

function renderLogin() {
  app.replaceChildren(template("#loginTemplate"));
  document.querySelector("#loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api("/api/login", { method: "POST", body: formValues(event.currentTarget) });
      state.tab = "dashboard";
      saveNavigation();
      await refresh();
    } catch (error) {
      const loginStatus = document.querySelector("#loginStatus");
      if (loginStatus) {
        loginStatus.textContent = error.message;
        loginStatus.classList.remove("hidden");
        return;
      }
      setStatus(error.message, true);
    }
  });
}

function renderAdmin() {
  saveNavigation();
  app.innerHTML = `
    <nav class="tabs">${tabs.map(([id, label]) => `<button type="button" data-tab="${id}" class="${state.tab === id ? "active" : ""}">${label}</button>`).join("")}</nav>
    <div id="tabContent"></div>
  `;
  app.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.tab = button.dataset.tab;
      saveNavigation();
      renderAdmin();
    });
  });
  renderTab();
}

function renderTab() {
  const content = document.querySelector("#tabContent");
  const view = {
    dashboard: dashboardView,
    home: homePageView,
    settings: settingsView,
    categories: categoriesView,
    files: filesView,
    downloads: downloadsView,
    bundles: bundlesView,
    products: productsView,
    publish: publishView,
    analytics: analyticsView,
    integrations: integrationsView,
    users: usersView
  }[state.tab];
  content.innerHTML = view();
  bindTabEvents(content);
}

function dashboardView() {
  const visibleProducts = activeProducts();
  const sampleTools = state.me?.sampleDataToolsEnabled
    ? `
      <div class="item demo-tool-card">
        <div>
          <h3>Demo sample data</h3>
          <p class="muted">Testing tool. Adds fake products/downloads so you can test large lists. Disable in production with ENABLE_SAMPLE_DATA_TOOLS=false.</p>
        </div>
        <button id="sampleBtn" type="button">Add demo sample batch</button>
      </div>
    `
    : "";
  return `
    <section class="panel">
      <h2>Page Manager overview</h2>
      ${unpublishedNotice()}
      <p class="muted">Create products, group downloads into Software Bundles, publish the static customer support site, and review basic analytics.</p>
      <div class="actions">
        ${previewLink("Open customer site preview")}
      </div>
      ${hasPublishedSite() ? "" : `<p class="muted">No published site yet. Click Publish first.</p>`}
      ${sampleTools}
      ${hasUnpublishedChanges() ? `<p class="muted">Preview may not include current edits until you publish.</p>` : ""}
      <div class="list dashboard-stats">
        <button class="item stat-card" type="button" data-tab-jump="products" title="Open product and category management" aria-label="Open product and category management"><h3>${state.categories.length}</h3><p>Categories</p></button>
        <button class="item stat-card" type="button" data-tab-jump="products" title="Open Products" aria-label="Open Products"><h3>${visibleProducts.length}</h3><p>Products</p></button>
        <button class="item stat-card" type="button" data-tab-jump="downloads" title="Open Downloads" aria-label="Open Downloads"><h3>${state.downloads.length}</h3><p>Downloads</p></button>
        <button class="item stat-card" type="button" data-tab-jump="bundles" title="Open Software Bundles" aria-label="Open Software Bundles"><h3>${state.packs.length}</h3><p>Software Bundles</p></button>
      </div>
    </section>
  `;
}

function settingsView() {
  const active = {
    branding: brandingSettingsView,
    support: supportSettingsView,
    media: filesView,
    users: usersView,
    integrations: integrationsView,
    operations: operationsView,
    advanced: advancedSettingsView
  }[state.settingsSection] || brandingSettingsView;
  return `
    <nav class="subtabs">${settingsSections.map(([id, label]) => `<button type="button" data-settings-section="${id}" class="${state.settingsSection === id ? "active" : ""}">${label}</button>`).join("")}</nav>
    ${active()}
    ${developerSupportLink()}
  `;
}

function homePageView() {
  const s = state.settings;
  const featured = state.products.filter((product) => product.featured && normalizeProductState(product) === "published");
  const heroPlaceholder = s.brandName || "Your business name";
  return `
    <section class="panel">
      <div class="section-heading">
        <h2>Home Page</h2>
        ${previewLink("Open customer site preview")}
      </div>
      ${unpublishedNotice()}
      <p class="muted">Control the customer-facing home page. This does not change the Page Manager admin title.</p>
      <form id="settingsForm" class="form-grid home-settings-form" data-settings-area="Home Page">
        <div class="wide editor-actionbar">
          <div>
            <strong>Home Page editor</strong>
            <span class="muted" data-form-dirty-state>Saved changes still need publishing before customers see them.</span>
          </div>
          <div class="actions">
            <button type="submit">Save Home Page</button>
            ${previewLink("Open customer site preview")}
          </div>
        </div>
        <fieldset class="wide form-section">
          <legend>Hero</legend>
          <div class="form-grid">
            <label>Homepage title / hero heading<input name="homeHeroTitle" value="${escapeHtml(s.homeHeroTitle || "")}" placeholder="${escapeHtml(heroPlaceholder)}"></label>
            <label class="wide">Intro / subtitle<textarea name="introText">${escapeHtml(s.introText || "")}</textarea></label>
            <div class="wide">
              <strong>Hero image</strong>
              <p class="field-help">Optional image shown beside the home page hero. Use an uploaded image file.</p>
              ${imageSettingPicker("homeHeroImage", s.homeHeroImage)}
            </div>
          </div>
        </fieldset>
        <fieldset class="wide form-section">
          <legend>New customer block</legend>
          <div class="form-grid">
            <label class="check-row wide"><input name="homeTextBlockEnabled" type="checkbox" ${settingEnabled(s.homeTextBlockEnabled, false) ? "checked" : ""}> Show new customer block</label>
            <label>Heading<input name="homeTextBlockHeading" value="${escapeHtml(s.homeTextBlockHeading || "")}"></label>
            <label class="wide">Body text<textarea name="homeTextBlockText">${escapeHtml(s.homeTextBlockText || "")}</textarea></label>
            <div class="wide">
              <strong>Block images</strong>
              <p class="field-help">Optional supporting images for the new customer block. Images appear on the home page in the selected order.</p>
              ${imageSettingMultiPicker("homeTextBlockImage", s.homeTextBlockImage)}
            </div>
          </div>
        </fieldset>
        <fieldset class="wide form-section">
          <legend>Homepage sections</legend>
          <p class="field-help">Choose which blocks appear on the public homepage after the hero.</p>
          <div class="home-toggle-grid">
            <label class="check-row"><input name="homeShowCategories" type="checkbox" ${settingEnabled(s.homeShowCategories, true) ? "checked" : ""}> Show categories</label>
            <label class="check-row"><input name="homeShowFeaturedProducts" type="checkbox" ${settingEnabled(s.homeShowFeaturedProducts, true) ? "checked" : ""}> Show featured products</label>
            <label class="check-row"><input name="homeShowSupportCta" type="checkbox" ${settingEnabled(s.homeShowSupportCta, true) ? "checked" : ""}> Show support CTA</label>
            <label class="check-row"><input name="homeShowDownloadsSummary" type="checkbox" ${settingEnabled(s.homeShowDownloadsSummary, false) ? "checked" : ""}> Show downloads summary</label>
          </div>
        </fieldset>
        <fieldset class="wide form-section">
          <legend>Support CTA</legend>
          <div class="form-grid">
            <label>Heading<input name="homeSupportHeading" value="${escapeHtml(s.homeSupportHeading || "Support")}"></label>
            <label>Button label<input name="homeSupportButtonLabel" value="${escapeHtml(s.homeSupportButtonLabel || "Contact support")}"></label>
            <label class="wide">Text<textarea name="homeSupportText">${escapeHtml(s.homeSupportText || "Need product help, setup details, manuals or store links?")}</textarea></label>
          </div>
        </fieldset>
        <div class="wide form-actions"><button type="submit">Save Home Page</button></div>
      </form>
      <div class="item featured-status-panel">
        <div>
          <h3>Featured products</h3>
          <p class="muted">${featured.length ? `${featured.length} product(s) selected for the homepage.` : "No products are selected. Recent products will show instead."}</p>
        </div>
        <div class="featured-status-list">
          ${featured.map((product) => `<button class="secondary" type="button" data-edit-product="${product.id}" title="Edit ${escapeHtml(product.name)}">${escapeHtml(product.name)} ${pill("Featured", "featured", "Shown on the public homepage")}</button>`).join("") || "<span class='muted'>Use a product editor to feature products.</span>"}
          <button class="secondary" type="button" data-tab-jump="products">Manage products</button>
        </div>
      </div>
    </section>
  `;
}

function developerSupportLink() {
  return `
    <div class="dev-support">
      <a class="coffee-icon-link" href="https://buymeacoffee.com/dubcodes" target="_blank" rel="noopener noreferrer" title="Support the developer" aria-label="Support the developer">☕</a>
    </div>
  `;
}

function brandingSettingsView() {
  const s = state.settings;
  return `
    <section class="panel">
      <div class="section-heading">
        <h2>Store settings</h2>
      </div>
      <form id="settingsForm" class="form-grid" data-settings-area="Settings/branding">
        <div class="wide editor-actionbar">
          <div><strong>Branding settings</strong><span class="muted" data-form-dirty-state>Saved changes still need publishing before customers see them.</span></div>
          <div class="actions"><button type="submit">Save settings</button></div>
        </div>
        <label>Store/brand name<input name="brandName" value="${escapeHtml(s.brandName || "")}"></label>
        <label>Logo<input name="logo" type="file" accept="image/*"></label>
        <label>Main marketplace/store link ${helpIcon("Link to this seller's marketplace store page.")}<input name="marketplaceUrl" value="${escapeHtml(s.marketplaceUrl || "")}"></label>
        <label>Theme
          <select name="theme">
            ${["clean-light", "dark-tech", "blue-commerce", "warm-simple"].map((theme) => `<option value="${theme}" ${s.theme === theme ? "selected" : ""}>${theme.replace("-", " ")}</option>`).join("")}
          </select>
        </label>
        <label>Default marketplace label<input name="defaultMarketplaceLabel" value="${escapeHtml(s.defaultMarketplaceLabel || "Buy on AliExpress")}"></label>
        <label class="wide">Homepage intro text<textarea name="introText">${escapeHtml(s.introText || "")}</textarea></label>
        <label class="wide">Footer text<textarea name="footerText">${escapeHtml(s.footerText || "")}</textarea></label>
        <button type="submit">Save settings</button>
      </form>
    </section>
  `;
}

function supportSettingsView() {
  const s = state.settings;
  return `
    <section class="panel" id="supportContactSection">
      <h2>Support/contact info</h2>
      <p class="muted">Show customers where to get product help. For order or payment issues, direct them back to the marketplace order page.</p>
      <form id="settingsForm" class="form-grid support-settings-form" data-settings-area="Settings/support/contact">
        <div class="wide editor-actionbar">
          <div><strong>Support settings</strong><span class="muted" data-form-dirty-state>Saved changes still need publishing before customers see them.</span></div>
          <div class="actions"><button type="submit">Save support info</button></div>
        </div>
        <label>Support email<input name="supportEmail" type="email" value="${escapeHtml(s.supportEmail || "")}"></label>
        <label>Support link<input name="supportLink" value="${escapeHtml(s.supportLink || "")}"></label>
        <label>Marketplace/store link<input name="marketplaceUrl" value="${escapeHtml(s.marketplaceUrl || "")}"></label>
        <label class="check-row"><input name="contactFormEnabled" type="checkbox" ${s.contactFormEnabled === "on" || s.contactFormEnabled === "true" ? "checked" : ""}> Enable public contact form</label>
        <div class="wide form-actions"><button type="submit">Save support info</button></div>
      </form>
      <div class="item contact-methods-panel">
        <h3>Public contact rows</h3>
        <p class="muted">Add the seller-facing support options that should appear on the public support portal.</p>
        <form id="contactMethodForm" class="form-grid contact-method-form">
          <label>Label<input name="label" placeholder="WhatsApp support" required></label>
          <label>Type<select name="type"><option value="link">Link</option><option value="email">Email</option><option value="phone">Phone</option><option value="marketplace">Marketplace</option></select></label>
          <label>Value<input name="value" placeholder="https:// or email/phone" required></label>
          <label>Sort order<input name="sortOrder" type="number" value="0"></label>
          <div class="wide form-actions"><button type="submit">Add contact row</button></div>
        </form>
        <div class="list compact-list-ui contact-method-list">
          ${state.contactMethods.map((method) => `
            ${Number(state.editingContactMethodId) === Number(method.id) ? `
              <form class="item contact-method-row contact-method-edit" data-contact-edit-form="${method.id}">
                <label>Label<input name="label" value="${escapeHtml(method.label)}" required></label>
                <label>Type<select name="type">${contactTypeOptions(method.type)}</select></label>
                <label>Value<input name="value" value="${escapeHtml(method.value)}" required></label>
                <label>Sort<input name="sortOrder" type="number" value="${escapeHtml(method.sort_order ?? 0)}"></label>
                <div class="actions">
                  <button type="submit">Save</button>
                  <button class="secondary" type="button" data-cancel-contact-edit>Cancel</button>
                  <button class="secondary" type="button" data-delete-contact-method="${method.id}">Hide</button>
                </div>
              </form>
            ` : `
              <div class="item contact-method-row">
                <div class="contact-method-main" title="${escapeHtml(method.value)}">
                  <strong>${escapeHtml(method.label)}</strong>
                  ${pill(method.type, "neutral")}
                  <p class="muted">${escapeHtml(method.value)}</p>
                </div>
                <p class="muted">Sort ${escapeHtml(method.sort_order ?? 0)}</p>
                <div class="actions">
                  <button class="secondary" type="button" data-edit-contact-method="${method.id}">Edit</button>
                  <button class="secondary" type="button" data-delete-contact-method="${method.id}">Hide</button>
                </div>
              </div>
            `}
          `).join("") || "<p class='muted'>No extra contact rows yet. Email/link/store fallback still works.</p>"}
        </div>
      </div>
      <div id="contactSubmissions" class="list"></div>
    </section>
  `;
}

function advancedSettingsView() {
  return `
    <section class="panel">
      <h2>Advanced Settings</h2>
      <p class="muted">Deployment and provider settings for Portainer, local preview, and future Cloudflare support.</p>
      <div class="list">
        <div class="item"><h3>Public site base path</h3><p><code>PUBLIC_SITE_BASE_PATH</code> is currently configured by environment. Local admin preview uses <code>/preview</code>; Cloudflare root deploys should use an empty value.</p></div>
        <div class="item"><h3>Storage provider</h3><p>Local uploads are active. Cloudflare R2 is a placeholder for a later beta.</p></div>
        <div class="item"><h3>Deploy provider</h3><p>Local static generation is active. Cloudflare Pages Direct Upload is scaffolded for a future release.</p></div>
      </div>
      <button id="loadAuditBtn" type="button">Load audit log</button>
      <div id="auditOutput" class="list"></div>
    </section>
  `;
}

function categoriesView() {
  return `
    <section class="panel">
      <h2>Categories</h2>
      <form id="categoryForm" class="form-grid">
        <label>Name<input name="name" required></label>
        <label>Description<input name="description"></label>
        <button type="submit">Create category</button>
      </form>
      <div class="list">${state.categories.map((cat) => `<div class="item"><h3>${escapeHtml(cat.name)}</h3><p>${escapeHtml(cat.description || "")}</p>${pill(cat.slug, "neutral")}</div>`).join("")}</div>
    </section>
  `;
}

function filesView() {
  const filters = [
    ["all", "All"],
    ["images", "Images"],
    ["documents", "Documents"],
    ["software", "Archives/software"]
  ];
  return `
    <section class="panel">
      <div class="section-heading">
        <h2>Media Library</h2>
      </div>
      <p class="muted">Upload product images, manuals, firmware, installers and demo files. Risky software file types are allowed for downloads but are never executed by this app.</p>
      <p class="muted upload-warning">Only upload files you trust. Firmware, installers, and ZIP files will be downloadable by customers after publishing.</p>
      <form id="fileForm" class="form-grid">
        <label class="wide">Upload files<input name="files" type="file" multiple></label>
        <button type="submit">Upload</button>
        <div id="fileUploadResults" class="wide picker-upload-results muted" aria-live="polite"></div>
      </form>
      <div class="toolbar media-toolbar">
        <input id="mediaSearch" placeholder="Search media" value="${escapeHtml(state.mediaSearch)}">
        <div class="segmented">${filters.map(([value, label]) => `<button class="secondary ${state.mediaFilter === value ? "active" : ""}" type="button" data-media-filter="${value}">${label}</button>`).join("")}</div>
      </div>
      <div id="mediaList" class="list media-list">
        ${state.files.map((file) => `
          <div class="item media-row" data-filter-row data-kind="${mediaKind(file)}" data-search="${escapeHtml(dataText(file.originalName, file.mimeType, file.size))}">
            ${mediaThumb(file)}
            <div class="media-main" title="${escapeHtml(file.originalName)}">
              <h3>${escapeHtml(file.originalName)}</h3>
              <p class="muted">${escapeHtml(file.mimeType)} · ${formatBytes(file.size)}</p>
            </div>
            <div class="actions">
              <a class="action-link" href="${escapeHtml(file.url)}" target="_blank" rel="noopener noreferrer">Open</a>
              <button class="secondary" type="button" data-copy-value="${escapeHtml(file.url)}">Copy URL</button>
              <button class="danger" type="button" data-delete-file="${file.id}" data-file-name="${escapeHtml(file.originalName)}">Delete</button>
            </div>
          </div>
        `).join("") || "<p class='muted'>No media files uploaded yet.</p>"}
      </div>
    </section>
  `;
}

function downloadsView() {
  const selectedDownload = state.downloads.find((download) => Number(download.id) === Number(state.selectedDownloadId)) || null;
  const editorDownload = state.showDownloadEditor ? selectedDownload || {} : null;
  return `
    <section class="panel">
      <div class="section-heading">
        <h2>Downloads</h2>
        <button id="newDownloadBtn" type="button">Add Download</button>
      </div>
      <div class="toolbar"><input id="downloadSearch" placeholder="Search downloads" value="${escapeHtml(state.downloadSearch)}"></div>
      <div id="downloadList" class="list">${state.downloads.map((download) => `
        <div class="item download-row" data-filter-row data-edit-download="${download.id}" data-search="${escapeHtml(dataText(download.name, download.type, download.short_description, latestVersionLabel(download)))}">
          <div>
            <h3>${escapeHtml(download.name)} ${pill(download.type, "neutral")}</h3>
            <p>${escapeHtml(download.short_description || "")}</p>
            <p class="muted">${escapeHtml(latestVersionLabel(download))} · ${(download.versions || []).length} version(s)</p>
          </div>
          <div class="actions">
            <button type="button" data-edit-download="${download.id}">Edit</button>
            <button class="secondary" type="button" data-add-version="${download.id}">Add version</button>
            <a class="action-link" href="/preview/downloads/${escapeHtml(download.slug)}/" target="_blank" rel="noopener noreferrer">Version history</a>
            <button class="danger" type="button" data-archive-download="${download.id}">Archive</button>
          </div>
        </div>`).join("") || "<p class='muted'>No downloads yet.</p>"}</div>
    </section>
    ${editorDownload ? `
      <section class="panel editor-panel" id="downloadEditor" tabindex="-1">
        <div class="section-heading">
          <h2>${editorDownload.id ? `Edit ${escapeHtml(editorDownload.name)}` : "Create download"}</h2>
        </div>
      <form id="downloadForm" class="form-grid">
          <div class="wide editor-actionbar">
            <div><strong>${editorDownload.id ? "Download editor" : "New download"}</strong><span class="muted" data-form-dirty-state>Changes are local until saved and published.</span></div>
            <div class="actions">
              <button type="submit">${editorDownload.id ? "Save download" : "Create download"}</button>
              <button class="secondary" id="closeDownloadEditorBtn" type="button">Close</button>
            </div>
          </div>
          <label>Name<input name="name" required value="${escapeHtml(editorDownload.name || "")}"></label>
          <label>Type<select name="type">${["Android", "iOS", "Windows", "Mac", "Firmware", "Manual", "Other"].map((type) => `<option value="${type}" ${(editorDownload.type || "Other") === type ? "selected" : ""}>${type}</option>`).join("")}</select></label>
          <label>Sort order<input name="sortOrder" type="number" value="${escapeHtml(editorDownload.sort_order ?? 0)}"></label>
          <label>Display group<input name="displayGroup" value="${escapeHtml(editorDownload.display_group || "")}"></label>
          <label class="wide">External URL<input name="externalUrl" placeholder="https://" value="${escapeHtml(editorDownload.external_url || "")}"></label>
          <label class="wide">Short description<textarea name="shortDescription">${escapeHtml(editorDownload.short_description || "")}</textarea></label>
          <button type="submit">${editorDownload.id ? "Save download" : "Create download"}</button>
        </form>
        ${editorDownload.id ? `
          <div class="divider"></div>
          <h3>Add version</h3>
          <form id="versionForm" class="form-grid" data-download-id="${editorDownload.id}">
            <label>Version number<input name="versionNumber" required></label>
            <label>Release date<input name="releaseDate" type="date"></label>
            <label>Uploaded file<select name="fileId"><option value="">None</option>${optionList(state.files)}</select></label>
            <p class="field-help wide upload-warning">Only upload files you trust. Firmware, installers, and ZIP files will be downloadable by customers after publishing.</p>
            <label class="wide">External URL<input name="externalUrl"></label>
            <label class="wide">Release notes<textarea name="releaseNotes" data-rich-text data-rich-original-html="" data-rich-plain-text=""></textarea></label>
            <label class="check-row wide"><input name="releaseNotesSource" type="checkbox" data-rich-source="releaseNotes"> Edit HTML source</label>
            <label class="check-row"><input name="isLatest" type="checkbox" checked> Latest</label>
            <label class="check-row"><input name="deprecated" type="checkbox"> Deprecated</label>
            <label>Warning text<input name="warningText"></label>
            <label>File size<input name="fileSize"></label>
            <label>Checksum<input name="checksum"></label>
            <button type="submit">Add version</button>
          </form>
          <div class="list">
            ${(editorDownload.versions || []).map((version) => `<div class="item mini-row"><div><strong>${escapeHtml(version.version_number)}</strong> ${version.is_latest ? pill("Latest", "ready") : ""} ${version.deprecated ? pill("Deprecated", "danger") : ""}<p class="muted">${escapeHtml(version.release_date || "No date")}</p></div></div>`).join("") || "<p class='muted'>No versions yet.</p>"}
          </div>
        ` : ""}
      </section>
    ` : ""}
  `;
}

function bundlesView() {
  return `
    <section class="panel">
      <h2>Software Bundles ${helpIcon("Creates a downloadable package of selected apps, manuals, firmware, and setup files. External links such as App Store links are shown separately.")}</h2>
      <p class="muted">Software Bundles group the apps, manuals, firmware, setup tools and guides customers need for a product.</p>
      <div class="toolbar"><input id="bundleSearch" placeholder="Search Software Bundles" value="${escapeHtml(state.bundleSearch)}"></div>
      <form id="packForm" class="form-grid">
        <div class="wide editor-actionbar">
          <div><strong>Software Bundle editor</strong><span class="muted" data-form-dirty-state>Changes are local until saved and published.</span></div>
          <div class="actions"><button type="submit">Save Software Bundle</button></div>
        </div>
        <label>Name<input name="name" required></label>
        <label class="wide">Description<textarea name="description"></textarea></label>
        <div class="wide"><strong>Downloads included in this Software Bundle</strong>${picker("downloadIds", state.downloads, [], "downloads")}</div>
        <label class="check-row"><input name="autoGenerateZip" type="checkbox" checked> Auto-generate ZIP during publish</label>
        <button type="submit">Create Software Bundle</button>
      </form>
      <div id="bundleList" class="list">${state.packs.map((pack) => `<div class="item" tabindex="-1" data-filter-row data-bundle-id="${pack.id}" data-search="${escapeHtml(dataText(pack.name, pack.description))}"><h3>${escapeHtml(pack.name)}</h3><p>${escapeHtml(pack.description || "")}</p>${supportPackIncludes(pack)}<p class="muted">ZIP: ${pack.bundle_file_id ? "Generated" : pack.auto_generate_zip ? "Will generate on publish when local files exist" : "Disabled"}</p></div>`).join("")}</div>
    </section>
  `;
}

function productsView() {
  const edit = state.editingProduct?.product || {};
  const editState = normalizeProductState(edit);
  const editSupportPackIds = state.editingProduct?.supportPackIds || [];
  const editRelatedProductIds = state.editingProduct?.relatedProductIds || [];
  const editImages = state.editingProduct?.images || [];
  const editFileIds = (kind) => editImages.filter((image) => image.kind === kind).map((image) => image.file_id);
  const q = state.productSearch.toLowerCase();
  const products = state.products
    .filter((product) => state.showArchivedProducts || !isArchivedProduct(product))
    .filter((product) => !q || product.name.toLowerCase().includes(q) || String(product.sku || "").toLowerCase().includes(q) || String(product.category_name || "").toLowerCase().includes(q))
    .sort((a, b) => Number(isArchivedProduct(a)) - Number(isArchivedProduct(b)) || Number(b.featured || 0) - Number(a.featured || 0) || Number(a.sort_order || 0) - Number(b.sort_order || 0) || String(a.name).localeCompare(String(b.name)));
  const archivedCount = state.products.filter(isArchivedProduct).length;
  return `
    <section class="panel">
      <div class="section-heading">
        <h2>Products</h2>
        <button id="newProductBtn" type="button">Add product</button>
      </div>
      <div class="toolbar">
        <input id="productSearch" placeholder="Search products by name, SKU, or category" value="${escapeHtml(state.productSearch)}">
        <label class="check-row compact-toggle"><input type="checkbox" data-show-archived-products ${state.showArchivedProducts ? "checked" : ""}> Show archived${archivedCount ? ` (${archivedCount})` : ""}</label>
      </div>
      <div id="productList" class="list">${products.map((product) => `
        <div class="item product-row ${product.import_sync_status ? "marketplace-synced" : ""} ${isArchivedProduct(product) ? "product-archived-row" : ""}" data-filter-row data-search="${escapeHtml(dataText(product.name, product.sku, product.category_name, product.short_description, adminStockText(product), product.import_sync_status, productStateLabel(product)))}">
          <div>
            <h3>${escapeHtml(product.name)} ${pill(productStateLabel(product), semanticType(productStateLabel(product)), normalizeProductState(product) === "published" ? "Visible on the customer site preview after publishing" : "Not visible on the customer site preview")}${product.featured && normalizeProductState(product) === "published" ? ` ${pill("Featured", "featured", "Shown on the public homepage after publishing")}` : ""}${product.import_sync_status ? ` ${pill(`AliExpress ${product.import_sync_status}`, "synced", "Linked to marketplace data")}` : ""}</h3>
            <p>${escapeHtml(product.short_description || "")}</p>
            <p class="muted">${escapeHtml(product.category_name || "No category")} ${product.sku ? `- ${escapeHtml(product.sku)}` : ""} ${adminStockMarkup(product)}${product.last_imported_at ? ` - Synced ${escapeHtml(product.last_imported_at)}` : ""}</p>
          </div>
          <div class="actions"><button type="button" data-edit-product="${product.id}">Edit</button><button class="secondary" type="button" data-duplicate-product="${product.id}">Duplicate</button>${product.import_sync_status ? `<button class="secondary" type="button" data-detach-aliexpress="${product.id}">Detach</button>` : ""}</div>
        </div>`).join("")}</div>
    </section>
    <section class="panel ${state.showProductForm ? "" : "hidden"}" id="productEditor" tabindex="-1">
      <h2>${state.editingProductId ? "Edit product" : "Create product"}</h2>
      <div class="editor-actionbar">
        <div>
          <strong>${state.editingProductId ? "Product editor" : "New product"}</strong>
          <span class="muted" id="productDirtyState">Changes are local until saved and published.</span>
        </div>
        <div class="actions">
          <button type="submit" form="productForm">${state.editingProductId ? "Save product" : "Create product"}</button>
          <button class="secondary" type="button" id="closeProductEditorBtn">Close editor</button>
        </div>
      </div>
      <form id="productForm" class="form-grid">
        <fieldset class="wide form-section">
          <legend>Basics</legend>
          <div class="form-grid">
            <label>Name<input name="name" required value="${escapeHtml(edit.name || "")}"></label>
            <label>SKU<input name="sku" value="${escapeHtml(edit.sku || "")}"></label>
            <label>Version indicator<input name="versionLabel" value="${escapeHtml(edit.version_label || "")}"></label>
            <label class="category-field">Category
              <input name="categoryName" list="categoryOptions" value="${escapeHtml(edit.category_name || categoryNameById(edit.category_id) || "")}" placeholder="Select or type a category" autocomplete="off">
              <input name="categoryId" type="hidden" value="${escapeHtml(edit.category_id || "")}">
              <small class="field-help" data-category-hint>Choose an existing category or type a new one.</small>
              <datalist id="categoryOptions">${categoryDatalistOptions()}</datalist>
            </label>
            <label>Sort order<input name="sortOrder" type="number" value="${escapeHtml(edit.sort_order ?? 0)}"></label>
            <label>Publish state<select name="publishState">${[
              ["draft", "Draft"],
              ["not_ready", "Not ready"],
              ["published", "Published"],
              ["archived", "Archived"]
            ].map(([value, label]) => `<option value="${value}" ${editState === value ? "selected" : ""}>${label}</option>`).join("")}</select></label>
            <p class="field-help wide">Only Published products appear on the customer site preview after you publish the site.</p>
            ${editState === "archived" ? `<p class="field-help wide warning-help">This product is archived and hidden from normal lists and the customer site preview.</p>` : ""}
          </div>
        </fieldset>
        <fieldset class="wide form-section">
          <legend>Public display</legend>
          <div class="form-grid">
            <label class="check-row wide"><input name="featured" type="checkbox" ${edit.featured ? "checked" : ""}> Show on homepage as featured product</label>
            <p class="field-help wide">Featured products appear on the homepage only after the product is Published and the site is published.</p>
            <label>Color options<input name="colorOptions" value="${escapeHtml(edit.color_options || "")}"></label>
            <label class="wide">Option notes<textarea name="optionNotes">${escapeHtml(edit.option_notes || "")}</textarea></label>
            <label class="wide">Short description<textarea name="shortDescription">${escapeHtml(edit.short_description || "")}</textarea></label>
          </div>
        </fieldset>
        <fieldset class="wide form-section" id="productStockSection" tabindex="-1">
          <legend>Stock and availability</legend>
          <div class="form-grid">
            <label>Stock tracking<select name="stockTracking"><option value="0" ${edit.stock_tracking ? "" : "selected"}>Off</option><option value="1" ${edit.stock_tracking ? "selected" : ""}>On</option></select></label>
            <label>Exact stock count<input name="stockCount" type="number" value="${escapeHtml(edit.stock_count ?? "")}"></label>
            <label>Low stock threshold<input name="stockLowThreshold" type="number" value="${escapeHtml(edit.stock_low_threshold ?? 5)}"></label>
            <label>Stock display mode ${helpIcon("The exact stock count is stored privately. Customers can see a friendly availability message instead.")}<select name="stockDisplayMode">${["friendly", "hidden", "exact"].map((value) => `<option value="${value}" ${(edit.stock_display_mode || "friendly") === value ? "selected" : ""}>${value}</option>`).join("")}</select></label>
            <label>Stock source<select name="stockSource">${["manual", "marketplace", "unknown"].map((value) => `<option value="${value}" ${(edit.stock_source || "manual") === value ? "selected" : ""}>${value}</option>`).join("")}</select></label>
          </div>
        </fieldset>
        <fieldset class="wide form-section">
          <legend>Marketplace</legend>
          <label>Marketplace product URL ${helpIcon("Link to this product's AliExpress, Alibaba, eBay, or other marketplace listing.")}<input name="marketplaceUrl" value="${escapeHtml(edit.marketplace_url || "")}"></label>
        </fieldset>
        <fieldset class="wide form-section">
          <legend>Images</legend>
          <div><strong>Product gallery images</strong>${picker("galleryFileIds", imageFiles(), editFileIds("gallery"), "images", { upload: true, uploadImageOnly: true })}</div>
          <div><strong>Description images</strong>${picker("descriptionFileIds", imageFiles(), editFileIds("description"), "images", { upload: true, uploadImageOnly: true })}</div>
          <div><strong>App/setup screenshots</strong>${picker("setupFileIds", imageFiles(), editFileIds("setup"), "images", { upload: true, uploadImageOnly: true })}</div>
        </fieldset>
        <fieldset class="wide form-section">
          <legend>Description</legend>
          <label>Long description<textarea name="longDescription" data-rich-text data-rich-original-html="${escapeHtml(edit.long_description || "")}" data-rich-plain-text="${escapeHtml(richHtmlToPlainText(edit.long_description || ""))}">${escapeHtml(richHtmlToPlainText(edit.long_description || ""))}</textarea></label>
          <label class="check-row"><input name="longDescriptionSource" type="checkbox" data-rich-source="longDescription"> Edit HTML source</label>
        </fieldset>
        <fieldset class="wide form-section">
          <legend>Downloads and Software Bundles</legend>
          ${picker("supportPackIds", state.packs, editSupportPackIds, "bundles")}
        </fieldset>
        <fieldset class="wide form-section">
          <legend>Related products</legend>
          ${picker("relatedProductIds", activeProducts().filter((product) => product.id !== edit.id), editRelatedProductIds, "products")}
        </fieldset>
        <div class="wide form-actions"><button type="submit">${state.editingProductId ? "Save product" : "Create product"}</button></div>
      </form>
    </section>
  `;
}

function publishView() {
  const unpublishedNote = hasUnpublishedChanges() ? `<p class="muted">Preview may not include current edits until you publish.</p>` : "";
  return `
    <section class="panel">
      <h2>Publish Review ${helpIcon("Review warnings, preview the site, then publish the static customer support site.")}</h2>
      <p class="muted">Review saved content, open the current preview, then publish the static customer support site.</p>
      <div class="item publish-help-card">
        <p>Saved Page Manager edits do not update the customer-facing preview until you publish.</p>
        <p class="muted">The preview shows the last successfully published customer site. If it shows a default nginx page, publish has not completed successfully or the wrong preview URL is being opened.</p>
      </div>
      <div id="publishReview" class="list" tabindex="-1"></div>
      <div class="actions">
        <button id="publishBtn" type="button">Publish</button>
        ${previewLink("Open customer site preview")}
        ${previewLink("Home", "/", "Preview home page", "action-link secondary-link")}
        ${previewLink("Downloads", "/downloads/", "Preview downloads page", "action-link secondary-link")}
        ${previewLink("Support", "/support/", "Preview support page", "action-link secondary-link")}
      </div>
      ${hasPublishedSite() ? "" : `<p class="muted">No published site yet. Click Publish first.</p>`}
      ${unpublishedNote}
      <div id="publishOutput" class="publish-output" aria-live="polite"></div>
    </section>
  `;
}

function analyticsView() {
  return `
    <section class="panel">
      <h2>Analytics</h2>
      <p class="muted">Local tracking model is included. Generated pages can report events when the admin service is reachable.</p>
      <label>Range<select id="analyticsRange"><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option><option value="all">All time</option></select></label>
      <button id="loadAnalyticsBtn" type="button">Load analytics</button>
      <div id="analyticsOutput" class="list"></div>
    </section>
  `;
}

function integrationsView() {
  const connection = state.aliexpress || {};
  const status = connection.status || "setup_required";
  return `
    <section class="panel">
      <h2>Marketplace integrations</h2>
      <p class="muted">Connect marketplace catalog data to create draft product records. Imports never overwrite edited product content without an explicit action.</p>
      <div class="list">
        <div class="item">
          <div class="section-heading">
            <h3>AliExpress</h3>
            ${pill(status, semanticType(status))}
          </div>
          <p class="muted">Credentials stay in the Page Manager database and are not exported to the public site. Configure official Open Platform endpoints before connecting.</p>
          <form id="aliexpressSettingsForm" class="form-grid">
            <div class="wide editor-actionbar">
              <div><strong>Marketplace settings</strong><span class="muted" data-form-dirty-state>Save credentials before connecting or testing.</span></div>
              <div class="actions"><button type="submit">Save AliExpress settings</button></div>
            </div>
            <label class="check-row"><input name="enabled" type="checkbox" ${connection.enabled ? "checked" : ""}> Enable AliExpress sync</label>
            <label>App key / client ID<input name="appKey" value="${escapeHtml(connection.app_key || "")}"></label>
            <label>App secret<input name="appSecret" type="password" placeholder="${connection.hasSecret ? "Saved - leave blank to keep" : ""}"></label>
            <label class="wide">Redirect URI<input readonly value="${escapeHtml(connection.redirectUri || "")}" onclick="this.select()"></label>
            <label>Auth URL<input name="authBaseUrl" value="${escapeHtml(connection.auth_base_url || "")}" placeholder="Official OAuth authorize endpoint"></label>
            <label>Token URL<input name="tokenBaseUrl" value="${escapeHtml(connection.token_base_url || "")}" placeholder="Official OAuth token endpoint"></label>
            <label class="wide">API URL<input name="apiBaseUrl" value="${escapeHtml(connection.api_base_url || "")}" placeholder="Official signed API endpoint"></label>
            <button type="submit">Save AliExpress settings</button>
          </form>
          <div class="actions">
            <button id="aliexpressConnectBtn" type="button">Connect</button>
            <button id="aliexpressTestBtn" class="secondary" type="button">Test connection</button>
            <button id="aliexpressFetchBtn" class="secondary" type="button">Fetch product candidates</button>
            <button id="aliexpressDisconnectBtn" class="danger" type="button">Disconnect</button>
          </div>
          <p class="muted">Last test: ${escapeHtml(connection.last_test_at || "Never")} · Last sync: ${escapeHtml(connection.last_sync_at || "Never")}</p>
          <div id="aliexpressOutput" class="list"></div>
        </div>
      </div>
    </section>
  `;
}

function operationsView() {
  return `
    <section class="panel">
      <h2>Import / Export / Backups</h2>
      <p class="muted">Use exports and backups before larger data changes. Manual backups include a manifest, settings snapshot and SQLite database copy.</p>
      <div class="grid-two">
        <div class="item">
          <h3>CSV exports</h3>
          <p class="muted">Download current admin data for review or spreadsheet editing.</p>
          <div class="actions">
            <a class="action-link" href="/api/import-export/csv/products">Products CSV</a>
            <a class="action-link" href="/api/import-export/csv/downloads">Downloads CSV</a>
            <a class="action-link" href="/api/import-export/csv/bundles">Bundles CSV</a>
          </div>
        </div>
        <div class="item">
          <h3>CSV preview</h3>
          <p class="muted">Paste a product CSV to validate the first rows before a future import/update run.</p>
          <form id="csvPreviewForm" class="form-grid">
            <label class="wide">CSV text<textarea name="csvText" placeholder="name,sku,stock_count"></textarea></label>
            <button type="submit">Preview CSV</button>
          </form>
          <div id="csvPreviewOutput"></div>
        </div>
      </div>
      <div class="item">
        <div class="section-heading">
          <h3>Backups</h3>
          <button id="createBackupBtn" type="button">Create backup</button>
        </div>
        <div class="actions">
          <button id="loadBackupsBtn" class="secondary" type="button">Refresh backups</button>
        </div>
        <div id="backupOutput" class="list">${renderBackups()}</div>
      </div>
    </section>
  `;
}

function renderBackups() {
  if (!state.backups.length) return "<p class='muted'>No backups loaded yet.</p>";
  return state.backups.map((backup) => `
    <div class="item mini-row">
      <div>
        <h3>${escapeHtml(backup.filename)}</h3>
        <p class="muted">${Math.round(Number(backup.size || 0) / 1024)} KB · ${escapeHtml(backup.created_at || "")}</p>
      </div>
      <div class="actions">
        <button class="secondary" type="button" data-inspect-backup="${escapeHtml(backup.filename)}">Inspect</button>
        <a class="action-link" href="/api/backups/${encodeURIComponent(backup.filename)}/download">Download</a>
      </div>
    </div>
  `).join("");
}

function usersView() {
  return `
    <section class="panel">
      <h2>Users & invites</h2>
      <p class="muted">Create seller team access, temporary support access, approval-required invites, and password reset links.</p>
      <div class="grid-two">
        <form id="inviteCreateForm" class="form-grid item">
          <h3 class="wide">Invite team member</h3>
          <label>Email<input name="email" type="email"></label>
          <label>Invite note<input name="label" placeholder="Internal note"></label>
          <label>Role<select name="role">${roleOptions()}</select></label>
          <label>Expires in hours<input name="expiresHours" type="number" value="48" min="1"></label>
          <label class="check-row"><input name="requiresApproval" type="checkbox"> Require admin approval after signup</label>
          <button type="submit">Create invite</button>
          <div id="inviteResult" class="wide status"></div>
        </form>
        <form id="supportAccessForm" class="form-grid item">
          <h3 class="wide">Temporary support access</h3>
          <label>Email<input name="email" type="email"></label>
          <label>Internal note<input name="label" value="Temporary support access"></label>
          <label>Role<select name="role">${roleOptions("Admin")}</select></label>
          <label>Invite expires in hours<input name="expiresHours" type="number" value="24" min="1"></label>
          <label>Account access hours<input name="accessHours" type="number" value="24" min="1"></label>
          <label class="check-row"><input name="requiresApproval" type="checkbox"> Require admin approval after signup</label>
          <button type="submit">Create support link</button>
          <div id="supportAccessResult" class="wide status"></div>
        </form>
      </div>
    </section>
    <section class="panel">
      <h2>Create user directly</h2>
      <form id="userCreateForm" class="form-grid">
        <label>Username<input name="username" required minlength="3"></label>
        <label>Email<input name="email" type="email"></label>
        <label>Password<input name="password" type="password" required minlength="10"></label>
        <label>Role<select name="role">${roleOptions()}</select></label>
        <label class="check-row"><input name="active" type="checkbox" checked> Active immediately</label>
        <button type="submit">Create user</button>
      </form>
    </section>
    <section class="panel">
      <div class="section-heading">
        <h2>Current users</h2>
        <button id="reloadUsersBtn" class="secondary" type="button">Refresh</button>
      </div>
      <div class="toolbar"><input id="userSearch" placeholder="Search users and invites" value="${escapeHtml(state.userSearch)}"></div>
      <div id="usersOutput" class="list">${renderUserList()}</div>
    </section>
    <section class="panel">
      <h2>Recent invites</h2>
      <div id="invitesOutput" class="list">${renderInviteList()}</div>
    </section>
  `;
}

function renderUserList() {
  if (!state.users.length) return "<p class='muted'>No users loaded yet.</p>";
  return [...state.users].sort((a, b) => {
    if ((a.status || "active") === "pending" && (b.status || "active") !== "pending") return -1;
    if ((a.status || "active") !== "pending" && (b.status || "active") === "pending") return 1;
    return String(a.username).localeCompare(String(b.username));
  }).map((user) => `
    <div class="item user-row ${user.status === "pending" ? "pending-user" : ""}" data-filter-row data-search="${escapeHtml(dataText(user.username, user.email, user.role, user.status))}">
      <div>
        <h3>${escapeHtml(user.username)} ${pill(user.role, "neutral")} ${pill(user.status || "active")}</h3>
        <p class="muted">${escapeHtml(user.email || "No email")} - Last login: ${escapeHtml(user.last_login_at || "Never")}</p>
        ${user.support_access_expires_at ? `<p class="muted">Temporary support access expires ${escapeHtml(user.support_access_expires_at)}</p>` : ""}
      </div>
      <div class="actions">
        ${user.status === "pending" ? `<button class="approve" type="button" data-approve-user="${user.id}">Approve user</button>` : ""}
        <button class="secondary" type="button" data-reset-user="${user.id}">Reset password</button>
        ${user.status !== "disabled" ? `<button class="danger" type="button" data-disable-user="${user.id}">Disable</button>` : ""}
      </div>
      <div class="wide" id="userResult-${user.id}"></div>
    </div>
  `).join("");
}

function renderInviteList() {
  if (!state.invites.length) return "<p class='muted'>No invites loaded yet.</p>";
  return state.invites.map((invite) => `
    <div class="item" data-filter-row data-search="${escapeHtml(dataText(invite.label, invite.email, invite.role, invite.status))}">
      <h3>${escapeHtml(invite.label || invite.email || "Invite")} ${pill(invite.role, "neutral")} ${pill(invite.status || "open")}</h3>
      <p class="muted">${escapeHtml(invite.email || "No email")} - Expires ${escapeHtml(invite.expires_at)}</p>
      <p class="muted">Created ${escapeHtml(invite.created_at)}${invite.created_by_username ? ` by ${escapeHtml(invite.created_by_username)}` : ""}${invite.accepted_username ? ` - Accepted by ${escapeHtml(invite.accepted_username)}` : ""}</p>
      ${invite.requires_approval ? pill("Approval required", "warning") : ""}
      ${invite.support_access_hours ? pill(`${invite.support_access_hours}h support access`, "neutral") : ""}
    </div>
  `).join("");
}

async function loadUsersAndInvites() {
  const [users, invites] = await Promise.all([
    api("/api/users"),
    api("/api/invites")
  ]);
  state.users = users.users || [];
  state.invites = invites.invites || [];
  const usersOutput = document.querySelector("#usersOutput");
  const invitesOutput = document.querySelector("#invitesOutput");
  if (usersOutput) usersOutput.innerHTML = renderUserList();
  if (invitesOutput) invitesOutput.innerHTML = renderInviteList();
  const userSearch = document.querySelector("#userSearch");
  if (userSearch) {
    filterRows(usersOutput || document, userSearch);
    filterRows(invitesOutput || document, userSearch);
  }
  bindUserActionButtons();
}

async function loadBackups() {
  const data = await api("/api/backups");
  state.backups = data.backups || [];
  const output = document.querySelector("#backupOutput");
  if (output) output.innerHTML = renderBackups();
}

function renderCsvPreview(preview) {
  if (!preview) return "";
  return `
    <div class="item">
      <h3>${preview.validRows} valid row(s) of ${preview.totalRows}</h3>
      ${(preview.rows || []).length ? `<table class="data-table"><tbody>${preview.rows.slice(0, 8).map((row) => `
        <tr><td>Row ${row.rowNumber}</td><td>${row.valid ? "Ready" : "Needs review"}</td><td>${escapeHtml(Object.values(row.values || {}).slice(0, 3).join(" · "))}</td></tr>
      `).join("")}</tbody></table>` : "<p class='muted'>No rows found.</p>"}
    </div>
  `;
}

function renderAliExpressCandidates(candidates) {
  if (!candidates.length) return "<p class='muted'>No candidates found.</p>";
  return `
    <form id="aliexpressImportForm" class="form-grid">
      <div class="wide list">
        ${candidates.map((candidate) => `
          <label class="check-row item">
            <input name="candidateIds" type="checkbox" value="${candidate.id || candidate.externalId}">
            <span><strong>${escapeHtml(candidate.title || "Untitled product")}</strong><br><span class="muted">${escapeHtml(candidate.external_id || candidate.externalId || "")} ${candidate.price ? `· ${escapeHtml(candidate.price)}` : ""}</span></span>
          </label>
        `).join("")}
      </div>
      <button type="submit">Import selected as draft products</button>
    </form>
  `;
}

function bindUserActionButtons() {
  document.querySelectorAll("[data-approve-user]").forEach((button) => {
    button.addEventListener("click", async () => {
      await api(`/api/users/${button.dataset.approveUser}/approve`, { method: "POST", body: {} });
      await loadUsersAndInvites();
      setStatus("User approved.");
    });
  });
  document.querySelectorAll("[data-disable-user]").forEach((button) => {
    button.addEventListener("click", async () => {
      await api(`/api/users/${button.dataset.disableUser}/disable`, { method: "POST", body: {} });
      await loadUsersAndInvites();
      setStatus("User disabled and sessions revoked.");
    });
  });
  document.querySelectorAll("[data-reset-user]").forEach((button) => {
    button.addEventListener("click", async () => {
      const result = await api(`/api/users/${button.dataset.resetUser}/password-reset`, { method: "POST", body: {} });
      const target = document.querySelector(`#userResult-${button.dataset.resetUser}`);
      if (target) target.innerHTML = linkResult("Password reset link", result.resetUrl);
      if (target) bindCopyButtons(target);
      setStatus("Password reset link generated.");
    });
  });
}

function stripAnsi(value) {
  return String(value || "").replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "");
}

function parseBuildSummary(value) {
  const clean = stripAnsi(value);
  const pagesMatch = clean.match(/(\d+)\s+page\(s\)\s+built(?:\s+in\s+([0-9.]+(?:ms|s)))?/i);
  const durationMatch = clean.match(/\bCompleted in\s+([0-9.]+(?:ms|s))/i);
  return {
    pages: pagesMatch?.[1] || "",
    duration: pagesMatch?.[2] || durationMatch?.[1] || ""
  };
}

function looksLikeBuildLog(value) {
  const clean = stripAnsi(value);
  return clean.length > 260 || /\[(build|vite|types)\]|generating static routes|page\(s\) built|npm run/i.test(clean);
}

function buildLogDetails(value) {
  const clean = stripAnsi(value).trim();
  if (!clean || !looksLikeBuildLog(clean)) return "";
  return `
    <details class="log-details">
      <summary>View build log</summary>
      <pre class="build-log">${escapeHtml(clean)}</pre>
    </details>
  `;
}

function openImagePreview(url, title) {
  document.querySelector(".image-modal")?.remove();
  const modal = document.createElement("div");
  modal.className = "image-modal";
  modal.innerHTML = `
    <div class="image-modal-dialog" role="dialog" aria-modal="true" aria-label="${escapeHtml(title || "Image preview")}">
      <button class="image-modal-close" type="button" aria-label="Close preview">X</button>
      <img src="${escapeHtml(url)}" alt="${escapeHtml(title || "Image preview")}">
      ${title ? `<p>${escapeHtml(title)}</p>` : ""}
    </div>
  `;
  const close = () => {
    document.removeEventListener("keydown", onKeydown);
    modal.remove();
  };
  const onKeydown = (event) => {
    if (event.key === "Escape") close();
  };
  modal.addEventListener("click", (event) => {
    if (event.target === modal || event.target.closest(".image-modal-close")) close();
  });
  document.addEventListener("keydown", onKeydown);
  document.body.append(modal);
  modal.querySelector(".image-modal-close")?.focus();
}

function cleanPublishMessage(event) {
  const raw = stripAnsi(event.message || "").trim();
  if (looksLikeBuildLog(raw)) return event.status === "success" ? "Static site published" : "Publish failed";
  return raw || (event.status === "success" ? "Static site published" : "Publish event recorded");
}

function publishStateCard() {
  const areas = unpublishedAreas();
  if (!hasUnpublishedChanges()) {
    return `
      <div class="item publish-state-card publish-state-clean">
        <h3>Preview is up to date</h3>
        <p class="muted">Publishing again will rebuild the static preview with the current saved content.</p>
      </div>
    `;
  }
  const areaList = areas.length
    ? `<ul class="compact-list">${areas.map((area) => `<li>${escapeHtml(area)}</li>`).join("")}</ul>`
    : `<p class="muted">Saved admin changes are waiting to be published.</p>`;
  return `
    <div class="item publish-state-card publish-state-pending">
      <h3>Unpublished changes are waiting to be published.</h3>
      <p>Changes made in the Page Manager do not appear on the public preview/site until you publish.</p>
      <p class="muted">Likely changed areas:</p>
      ${areaList}
    </div>
  `;
}

function scrollAndFocus(selector) {
  window.setTimeout(() => {
    const target = document.querySelector(selector);
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
    target?.focus?.({ preventScroll: true });
  }, 80);
}

function openPublishReview() {
  state.tab = "publish";
  saveNavigation();
  renderAdmin();
  scrollAndFocus("#publishReview");
}

async function openWarningTarget(warning) {
  if (!warning) return;
  const type = warning.entityType;
  const id = Number(warning.entityId || 0);
  const message = String(warning.message || "");
  if (type === "product" && id) {
    state.tab = "products";
    state.productSearch = "";
    state.editingProductId = id;
    state.editingProduct = await api(`/api/products/${id}`);
    state.showProductForm = true;
    renderAdmin();
    scrollAndFocus(/stock/i.test(message) ? "#productStockSection" : "#productEditor");
    return;
  }
  if (type === "product_visibility") {
    state.tab = "products";
    state.productSearch = "";
    renderAdmin();
    scrollAndFocus("#productList");
    return;
  }
  if (type === "download") {
    state.tab = "downloads";
    state.downloadSearch = "";
    state.selectedDownloadId = id || null;
    state.showDownloadEditor = Boolean(id);
    renderAdmin();
    scrollAndFocus(id ? "#downloadEditor" : "#downloadList");
    return;
  }
  if (type === "software_bundle") {
    state.tab = "bundles";
    state.bundleSearch = "";
    renderAdmin();
    scrollAndFocus(id ? `[data-bundle-id="${id}"]` : "#bundleList");
    return;
  }
  if (type === "settings") {
    state.tab = "settings";
    state.settingsSection = /support|contact/i.test(message) ? "support" : "branding";
    saveNavigation();
    renderAdmin();
    scrollAndFocus(state.settingsSection === "support" ? "#supportContactSection" : "#settingsForm");
  }
}

async function renderPublishReview() {
  const target = document.querySelector("#publishReview");
  if (!target) return;
  const review = await api("/api/publish/preview");
  state.me = {
    ...(state.me || {}),
    publicPreviewUrl: review.publicPreviewUrl || state.me?.publicPreviewUrl,
    hasPublishedSite: Boolean(review.hasPublishedSite)
  };
  const warnings = review.warnings || [];
  const visibilityMessages = review.visibilityMessages || [];
  const events = review.recentPublishEvents || [];
  const visibility = review.counts?.productVisibility || {};
  target.innerHTML = `
    ${publishStateCard()}
    <div class="summary-grid">
      <div class="item"><h3>${review.counts.products}</h3><p>Published Products</p></div>
      <div class="item"><h3>${review.counts.allProducts ?? review.counts.products}</h3><p>Total Products</p></div>
      <div class="item"><h3>${review.counts.downloads}</h3><p>Downloads</p></div>
      <div class="item"><h3>${review.counts.softwareBundles}</h3><p>Software Bundles</p></div>
      <div class="item"><h3>${warnings.length}</h3><p>Warnings</p></div>
    </div>
    <div class="item">
      <h3>Product visibility</h3>
      <p class="muted">Only products set to Published appear on the customer site preview after publishing.</p>
      <p>${pill(`${visibility.published || 0} Published`, "success")} ${pill(`${visibility.draft || 0} Draft`, "neutral")} ${pill(`${visibility.not_ready || 0} Not ready`, "warning")} ${pill(`${visibility.archived || 0} Archived`, "disabled")}</p>
      ${visibilityMessages.length ? `<div class="warning-list compact-warning-list">${visibilityMessages.map((message, index) => `
        <button class="warning-row" type="button" data-visibility-message-index="${index}">
          <span>${escapeHtml(message.message)}</span>
          <strong>Review</strong>
        </button>
      `).join("")}</div>` : "<p class='muted'>Published products are ready for the customer site preview.</p>"}
    </div>
    <div class="item">
      <h3>Warnings</h3>
      <p class="muted">Warnings are content quality checks. They are separate from whether saved changes still need publishing.</p>
      ${warnings.length ? `<div class="warning-list">${warnings.map((warning, index) => `
        <button class="warning-row" type="button" data-warning-index="${index}">
          <span>${escapeHtml(warning.message)}</span>
          <strong>Fix</strong>
        </button>
      `).join("")}</div>` : "<p class='muted'>No blocking warnings found.</p>"}
    </div>
    <div class="item">
      <h3>Last publish events</h3>
      ${events.map((event) => {
        const summary = parseBuildSummary(event.message || "");
        return `
          <div class="publish-event publish-event-${escapeHtml(semanticType(event.status))}">
            <p>${pill(event.status)} <span class="muted">${escapeHtml(event.created_at)}</span> ${escapeHtml(cleanPublishMessage(event))}</p>
            ${summary.pages || summary.duration ? `<p class="muted">${summary.pages ? `${escapeHtml(summary.pages)} page(s) built` : ""}${summary.pages && summary.duration ? " · " : ""}${summary.duration ? `Duration ${escapeHtml(summary.duration)}` : ""}</p>` : ""}
            ${buildLogDetails(event.message || "")}
          </div>
        `;
      }).join("") || "<p class='muted'>No publish events yet.</p>"}
    </div>
  `;
  target.querySelectorAll("[data-warning-index]").forEach((button) => {
    button.addEventListener("click", () => openWarningTarget(warnings[Number(button.dataset.warningIndex)]).catch((error) => setStatus(error.message, true)));
  });
  target.querySelectorAll("[data-visibility-message-index]").forEach((button) => {
    button.addEventListener("click", () => openWarningTarget(visibilityMessages[Number(button.dataset.visibilityMessageIndex)]).catch((error) => setStatus(error.message, true)));
  });
}

function bindTabEvents(content) {
  const handlers = {
    sampleBtn: async () => {
      const result = await api("/api/sample-data", { method: "POST", body: {} });
      markUnpublishedChanges("Products");
      await loadData();
      renderAdmin();
      const counts = result.counts || {};
      setStatus(`Added Demo Batch ${result.batchNumber}: ${counts.products || 0} products, ${counts.downloads || 0} downloads, ${counts.bundles || 0} bundles.`);
    },
    publishBtn: async () => {
      const output = document.querySelector("#publishOutput");
      output.innerHTML = `<p class="muted">Publishing...</p>`;
      try {
        const result = await api("/api/publish", { method: "POST", body: {} });
        const summary = parseBuildSummary(result.output || "");
        output.innerHTML = `
          <p class="publish-success">Published successfully.</p>
          ${summary.pages || summary.duration ? `<p class="muted">${summary.pages ? `${escapeHtml(summary.pages)} page(s) built` : ""}${summary.pages && summary.duration ? " · " : ""}${summary.duration ? `Duration ${escapeHtml(summary.duration)}` : ""}</p>` : ""}
          ${buildLogDetails(result.output || result.message || "")}
        `;
        clearUnpublishedChanges();
        state.me = { ...(state.me || {}), hasPublishedSite: true };
        document.querySelectorAll("[data-open-publish]").forEach((notice) => notice.remove());
        refreshPreviewLinks();
        await renderPublishReview();
      } catch (error) {
        output.innerHTML = `<p class="error">Publish failed.</p><p class="muted">${escapeHtml(error.message)}</p>`;
        throw error;
      }
    },
    loadAnalyticsBtn: async () => {
      const range = document.querySelector("#analyticsRange")?.value || "7d";
      const analytics = await api(`/api/analytics?range=${encodeURIComponent(range)}`);
      const totalFor = (type) => analytics.totals.find((item) => item.event_type === type)?.count || 0;
      const table = (title, rows, label = "name") => `<div class="item"><h3>${title}</h3>${rows.length ? `<table class="data-table"><tbody>${rows.map((row) => `<tr><td>${escapeHtml(row[label] || row.path || "Unknown")}</td><td>${row.count}</td></tr>`).join("")}</tbody></table>` : "<p class='muted'>No data yet.</p>"}</div>`;
      document.querySelector("#analyticsOutput").innerHTML = `
        <div class="summary-grid">
          <div class="item"><h3>${totalFor("page_view")}</h3><p>Page views</p></div>
          <div class="item"><h3>${totalFor("product_view")}</h3><p>Product views</p></div>
          <div class="item"><h3>${totalFor("download_click")}</h3><p>Download clicks</p></div>
          <div class="item"><h3>${totalFor("marketplace_click")}</h3><p>Marketplace clicks</p></div>
          <div class="item"><h3>${totalFor("qr_opened")}</h3><p>QR opens</p></div>
        </div>
        ${table("Top pages", analytics.topPages || [], "path")}
        ${table("Top products", analytics.topProducts || [])}
        ${table("Top downloads", analytics.topDownloads || [])}
        ${table("Marketplace clicks", analytics.marketplaceClicks || [])}
        <div class="item"><h3>Recent activity</h3>${(analytics.recent || []).map((event) => `<p>${pill(event.event_type, "neutral")} ${escapeHtml(event.path || "")} <span class="muted">${escapeHtml(event.created_at)}</span></p>`).join("") || "<p class='muted'>No events yet.</p>"}</div>
      `;
    },
    loadAuditBtn: async () => {
      const audit = await api("/api/audit-events");
      document.querySelector("#auditOutput").innerHTML = (audit.events || []).map((event) => `
        <div class="item">
          <h3>${escapeHtml(event.event_type)} ${event.username ? pill(event.username, "neutral") : ""}</h3>
          <p>${escapeHtml(event.message || "")}</p>
          <p class="muted">${escapeHtml(event.created_at)} ${event.entity_type ? `- ${escapeHtml(event.entity_type)} #${escapeHtml(event.entity_id || "")}` : ""}</p>
        </div>
      `).join("") || "<p class='muted'>No audit events yet.</p>";
    }
  };
  for (const [id, handler] of Object.entries(handlers)) {
    const element = content.querySelector(`#${id}`);
    if (element) element.addEventListener("click", () => handler().catch((error) => setStatus(error.message, true)));
  }

  bindCopyButtons(content);

  content.addEventListener("click", (event) => {
    const button = event.target.closest("[data-preview-image]");
    if (!button || !content.contains(button)) return;
    event.preventDefault();
    event.stopPropagation();
    openImagePreview(button.dataset.previewImage || "", button.dataset.previewTitle || "");
  });

  content.querySelectorAll("[data-open-publish]").forEach((button) => {
    button.addEventListener("click", () => openPublishReview());
  });

  content.querySelectorAll("[data-rich-source]").forEach((checkbox) => {
    const textarea = content.querySelector(`textarea[name="${checkbox.dataset.richSource}"]`);
    if (!textarea) return;
    checkbox.addEventListener("change", () => {
      textarea.value = checkbox.checked
        ? textarea.dataset.richOriginalHtml || textarea.value
        : textarea.dataset.richPlainText || richHtmlToPlainText(textarea.value);
    });
  });

  content.querySelectorAll("form").forEach((form) => {
    const dirtyState = form.querySelector("[data-form-dirty-state]");
    if (!dirtyState) return;
    const markDirty = () => {
      dirtyState.textContent = "Unsaved changes.";
    };
    form.addEventListener("input", markDirty);
    form.addEventListener("change", markDirty);
  });

  content.querySelectorAll("[data-picker]").forEach((pickerEl) => {
    const search = pickerEl.querySelector("[data-picker-search]");
    const count = pickerEl.querySelector("[data-picker-count]");
    const single = pickerEl.dataset.pickerMode === "single";
    const ordered = pickerEl.dataset.pickerMode === "ordered";
    const kind = pickerEl.dataset.pickerKind || "items";
    const pickerName = pickerEl.dataset.picker || "";
    const valueField = pickerEl.dataset.pickerValueField || "id";
    const hidden = pickerEl.querySelector("[data-picker-hidden]");
    const orderList = pickerEl.querySelector("[data-picker-order]");
    const uploadInput = pickerEl.querySelector("[data-picker-upload]");
    const uploadResults = pickerEl.querySelector("[data-picker-upload-results]");
    let selectedOrder = [];
    if (ordered && hidden?.value) {
      try {
        const parsed = JSON.parse(hidden.value);
        if (Array.isArray(parsed)) selectedOrder = parsed.map(String).filter(Boolean);
      } catch {
        selectedOrder = [hidden.value].filter(Boolean);
      }
    }
    const rowsByValue = () => new Map([...pickerEl.querySelectorAll("[data-picker-row]")].map((row) => {
      const input = row.querySelector("input[type='checkbox']");
      return [String(input?.dataset.pickerValue || ""), row];
    }).filter(([value]) => value));
    const renderOrder = () => {
      if (!ordered || !orderList) return;
      const byValue = rowsByValue();
      selectedOrder = selectedOrder.filter((value) => byValue.get(value)?.querySelector("input[type='checkbox']")?.checked);
      if (hidden) hidden.value = JSON.stringify(selectedOrder);
      orderList.innerHTML = selectedOrder.map((value, index) => {
        const row = byValue.get(value);
        const title = row?.dataset.pickerTitle || value;
        return `
          <div class="picker-order-row" data-picker-order-row="${escapeHtml(value)}" title="${escapeHtml(title)}">
            <span class="picker-order-index">${index + 1}</span>
            <span class="picker-order-title">${escapeHtml(title)}</span>
            <button class="secondary mini-action" type="button" data-picker-move="up" ${index === 0 ? "disabled" : ""} aria-label="Move ${escapeHtml(title)} up">Up</button>
            <button class="secondary mini-action" type="button" data-picker-move="down" ${index === selectedOrder.length - 1 ? "disabled" : ""} aria-label="Move ${escapeHtml(title)} down">Down</button>
            <button class="secondary mini-action" type="button" data-picker-remove-order aria-label="Remove ${escapeHtml(title)}">Remove</button>
          </div>
        `;
      }).join("") || "<p class='muted'>No block images selected.</p>";
    };
    const update = () => {
      const query = String(search?.value || "").trim().toLowerCase();
      let selected = 0;
      let selectedValue = "";
      let selectedTitle = "";
      pickerEl.querySelectorAll("[data-picker-row]").forEach((row) => {
        const input = row.querySelector("input[type='checkbox']");
        const checked = input?.checked;
        if (checked) selected += 1;
        if (checked) {
          selectedValue = input?.dataset.pickerValue || "";
          selectedTitle = row.querySelector(".picker-main strong")?.textContent || "";
        }
        const matches = String(row.dataset.search || "").toLowerCase().includes(query);
        row.classList.toggle("hidden", Boolean(query) && !matches && !checked);
        row.classList.toggle("picker-selected", Boolean(checked));
      });
      if (hidden) hidden.value = selected ? selectedValue : hidden.dataset.pickerInitial || "";
      if (ordered) renderOrder();
      if (count) {
        if (!single) count.textContent = `${ordered ? selectedOrder.length : selected} selected`;
        else if (selectedTitle) count.textContent = `Selected: ${selectedTitle}`;
        else if (hidden?.dataset.pickerInitial) count.textContent = "Selected file is missing";
        else count.textContent = "No image selected";
      }
    };
    search?.addEventListener("input", update);
    pickerEl.addEventListener("change", (event) => {
      if (single && event.target.matches("input[type='checkbox']") && event.target.checked) {
        if (hidden) hidden.dataset.pickerInitial = "";
        pickerEl.querySelectorAll("input[type='checkbox']").forEach((input) => {
          if (input !== event.target) input.checked = false;
        });
      }
      if (ordered && event.target.matches("input[type='checkbox']")) {
        const value = String(event.target.dataset.pickerValue || "");
        selectedOrder = selectedOrder.filter((item) => item !== value);
        if (event.target.checked && value) selectedOrder.push(value);
      }
      update();
    });
    pickerEl.querySelector("[data-picker-select-visible]")?.addEventListener("click", () => {
      pickerEl.querySelectorAll("[data-picker-row]:not(.hidden) input[type='checkbox']").forEach((input) => {
        input.checked = true;
        if (ordered) {
          const value = String(input.dataset.pickerValue || "");
          if (value && !selectedOrder.includes(value)) selectedOrder.push(value);
        }
      });
      update();
      pickerEl.dispatchEvent(new Event("change", { bubbles: true }));
    });
    pickerEl.querySelector("[data-picker-clear]")?.addEventListener("click", () => {
      if (hidden) hidden.dataset.pickerInitial = "";
      selectedOrder = [];
      pickerEl.querySelectorAll("input[type='checkbox']").forEach((input) => {
        input.checked = false;
      });
      update();
      pickerEl.dispatchEvent(new Event("change", { bubbles: true }));
    });
    orderList?.addEventListener("click", (event) => {
      const row = event.target.closest("[data-picker-order-row]");
      if (!row) return;
      const value = row.dataset.pickerOrderRow || "";
      const index = selectedOrder.indexOf(value);
      if (index === -1) return;
      if (event.target.matches("[data-picker-remove-order]")) {
        selectedOrder.splice(index, 1);
        const sourceRow = rowsByValue().get(value);
        const input = sourceRow?.querySelector("input[type='checkbox']");
        if (input) input.checked = false;
      } else if (event.target.matches("[data-picker-move='up']") && index > 0) {
        [selectedOrder[index - 1], selectedOrder[index]] = [selectedOrder[index], selectedOrder[index - 1]];
      } else if (event.target.matches("[data-picker-move='down']") && index < selectedOrder.length - 1) {
        [selectedOrder[index], selectedOrder[index + 1]] = [selectedOrder[index + 1], selectedOrder[index]];
      } else {
        return;
      }
      update();
      pickerEl.dispatchEvent(new Event("change", { bubbles: true }));
    });
    uploadInput?.addEventListener("change", async (event) => {
      const pickedFiles = [...(event.target.files || [])];
      const messages = [];
      const uploadable = pickedFiles.filter((file) => {
        if (pickerEl.dataset.pickerUploadImages === "true" && !isImageFile(file)) {
          messages.push(`Failed: ${file.name} - image files only`);
          return false;
        }
        return true;
      });
      if (!uploadable.length) {
        if (uploadResults) uploadResults.innerHTML = messages.map((message) => `<p>${escapeHtml(message)}</p>`).join("");
        event.target.value = "";
        return;
      }
      try {
        const formData = new FormData();
        uploadable.forEach((file) => formData.append("files", file));
        const response = await api("/api/files/upload", { method: "POST", body: formData });
        const results = response.results || (response.files || []).map((file) => ({ file, reused: false, message: `Uploaded: ${file.originalName || file.original_name || "file"}` }));
        const list = pickerEl.querySelector(".picker-list");
        list?.querySelector("p.muted")?.remove();
        results.forEach((result) => {
          const file = result.file;
          if (!file) return;
          const existingIndex = state.files.findIndex((item) => Number(item.id) === Number(file.id));
          if (existingIndex === -1) state.files.unshift(file);
          else state.files[existingIndex] = file;
          const rowValue = String(pickerValue(file, valueField));
          let row = [...pickerEl.querySelectorAll("[data-picker-row]")].find((candidate) => {
            const input = candidate.querySelector("input[type='checkbox']");
            return String(input?.dataset.pickerValue || "") === rowValue;
          });
          if (!row && list) {
            list.insertAdjacentHTML("afterbegin", pickerRowMarkup(pickerName, file, kind, true, { single, ordered, valueField }));
            row = list.querySelector("[data-picker-row]");
          }
          const checkbox = row?.querySelector("input[type='checkbox']");
          if (checkbox) {
            checkbox.checked = true;
            if (ordered && rowValue && !selectedOrder.includes(rowValue)) selectedOrder.push(rowValue);
          }
          messages.push(result.message || `${result.reused ? "Reused existing file" : "Uploaded"}: ${file.originalName || file.original_name || "file"}`);
        });
        if (uploadResults) uploadResults.innerHTML = messages.map((message) => `<p>${escapeHtml(message)}</p>`).join("");
        update();
        pickerEl.dispatchEvent(new Event("change", { bubbles: true }));
        const dirtyState = pickerEl.closest("form")?.querySelector("[data-form-dirty-state]");
        if (dirtyState) dirtyState.textContent = "Unsaved changes.";
        setStatus(messages[0] || "Upload complete.");
      } catch (error) {
        if (uploadResults) uploadResults.innerHTML = `<p>Failed: upload - ${escapeHtml(error.message)}</p>`;
        setStatus(error.message, true);
      } finally {
        event.target.value = "";
      }
    });
    update();
  });

  content.querySelectorAll("[data-tab-jump]").forEach((button) => {
    button.addEventListener("click", () => {
      state.tab = button.dataset.tabJump;
      saveNavigation();
      renderAdmin();
    });
  });

  const contactMethodForm = content.querySelector("#contactMethodForm");
  if (contactMethodForm) contactMethodForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = formValues(contactMethodForm);
    values.sortOrder = Number(values.sortOrder || 0);
    await api("/api/contact-methods", { method: "POST", body: values });
    markUnpublishedChanges("Settings/support/contact");
    await loadData();
    renderAdmin();
    setStatus("Contact row added.");
  });

  content.querySelectorAll("[data-edit-contact-method]").forEach((button) => {
    button.addEventListener("click", () => {
      state.editingContactMethodId = Number(button.dataset.editContactMethod);
      renderAdmin();
    });
  });

  content.querySelectorAll("[data-cancel-contact-edit]").forEach((button) => {
    button.addEventListener("click", () => {
      state.editingContactMethodId = null;
      renderAdmin();
    });
  });

  content.querySelectorAll("[data-contact-edit-form]").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const values = formValues(form);
      values.sortOrder = Number(values.sortOrder || 0);
      await api(`/api/contact-methods/${form.dataset.contactEditForm}`, { method: "PUT", body: values });
      state.editingContactMethodId = null;
      markUnpublishedChanges("Settings/support/contact");
      await loadData();
      renderAdmin();
      setStatus("Contact row updated.");
    });
  });

  content.querySelectorAll("[data-delete-contact-method]").forEach((button) => {
    button.addEventListener("click", async () => {
      await api(`/api/contact-methods/${button.dataset.deleteContactMethod}`, { method: "DELETE", body: {} });
      if (Number(state.editingContactMethodId) === Number(button.dataset.deleteContactMethod)) state.editingContactMethodId = null;
      markUnpublishedChanges("Settings/support/contact");
      await loadData();
      renderAdmin();
      setStatus("Contact row hidden.");
    });
  });

  const aliexpressSettingsForm = content.querySelector("#aliexpressSettingsForm");
  if (aliexpressSettingsForm) aliexpressSettingsForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = formValues(aliexpressSettingsForm);
    values.enabled = Boolean(aliexpressSettingsForm.querySelector("[name='enabled']").checked);
    await api("/api/integrations/aliexpress/settings", { method: "PUT", body: values });
    const status = await api("/api/integrations/aliexpress/status");
    state.aliexpress = status.connection;
    renderAdmin();
    setStatus("AliExpress settings saved.");
  });

  const aliexpressConnectBtn = content.querySelector("#aliexpressConnectBtn");
  if (aliexpressConnectBtn) aliexpressConnectBtn.addEventListener("click", async () => {
    const result = await api("/api/integrations/aliexpress/connect", { method: "POST", body: {} });
    const output = document.querySelector("#aliexpressOutput");
    if (output) output.innerHTML = linkResult("AliExpress authorization URL", result.authUrl);
    output?.querySelectorAll("[data-copy-value]").forEach((button) => {
      button.addEventListener("click", async () => {
        await navigator.clipboard.writeText(button.dataset.copyValue || "");
        setStatus("Link copied.");
      });
    });
  });

  const aliexpressTestBtn = content.querySelector("#aliexpressTestBtn");
  if (aliexpressTestBtn) aliexpressTestBtn.addEventListener("click", async () => {
    await api("/api/integrations/aliexpress/test", { method: "POST", body: {} });
    const status = await api("/api/integrations/aliexpress/status");
    state.aliexpress = status.connection;
    renderAdmin();
    setStatus("AliExpress connection tested.");
  });

  const aliexpressDisconnectBtn = content.querySelector("#aliexpressDisconnectBtn");
  if (aliexpressDisconnectBtn) aliexpressDisconnectBtn.addEventListener("click", async () => {
    const result = await api("/api/integrations/aliexpress/disconnect", { method: "POST", body: {} });
    state.aliexpress = result.connection;
    renderAdmin();
    setStatus("AliExpress disconnected.");
  });

  const aliexpressFetchBtn = content.querySelector("#aliexpressFetchBtn");
  if (aliexpressFetchBtn) aliexpressFetchBtn.addEventListener("click", async () => {
    const output = document.querySelector("#aliexpressOutput");
    const result = await api("/api/integrations/aliexpress/fetch-products", { method: "POST", body: {} });
    if (output) output.innerHTML = renderAliExpressCandidates(result.candidates || []);
  });

  const aliexpressOutput = content.querySelector("#aliexpressOutput");
  if (aliexpressOutput) aliexpressOutput.addEventListener("submit", async (event) => {
    if (event.target.id !== "aliexpressImportForm") return;
    event.preventDefault();
    const candidateIds = checkedNumbers(event.target, "candidateIds");
    if (!candidateIds.length) return setStatus("Select at least one candidate.", true);
    await api("/api/integrations/aliexpress/import", { method: "POST", body: { candidateIds } });
    await loadData();
    renderAdmin();
    setStatus("AliExpress candidates imported as draft products.");
  });

  const csvPreviewForm = content.querySelector("#csvPreviewForm");
  if (csvPreviewForm) csvPreviewForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    state.csvPreview = await api("/api/import-export/csv/preview", { method: "POST", body: formValues(csvPreviewForm) });
    const output = document.querySelector("#csvPreviewOutput");
    if (output) output.innerHTML = renderCsvPreview(state.csvPreview);
  });

  const createBackupBtn = content.querySelector("#createBackupBtn");
  if (createBackupBtn) createBackupBtn.addEventListener("click", async () => {
    await api("/api/backups", { method: "POST", body: {} });
    await loadBackups();
    setStatus("Backup created.");
  });

  const loadBackupsBtn = content.querySelector("#loadBackupsBtn");
  if (loadBackupsBtn) loadBackupsBtn.addEventListener("click", () => loadBackups().catch((error) => setStatus(error.message, true)));

  content.querySelectorAll("[data-inspect-backup]").forEach((button) => {
    button.addEventListener("click", async () => {
      const data = await api(`/api/backups/${encodeURIComponent(button.dataset.inspectBackup)}/inspect`);
      const output = document.querySelector("#backupOutput");
      if (output) output.insertAdjacentHTML("afterbegin", `<div class="item"><h3>Backup manifest</h3><pre>${escapeHtml(JSON.stringify(data.backup.manifest || {}, null, 2))}</pre></div>`);
    });
  });

  if (content.querySelector("#backupOutput")) loadBackups().catch((error) => setStatus(error.message, true));

  const settingsForm = content.querySelector("#settingsForm");
  if (settingsForm) settingsForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    settingsForm.querySelectorAll("[data-generated-hidden]").forEach((input) => input.remove());
    settingsForm.querySelectorAll("input[type='checkbox'][name]").forEach((checkbox) => {
      if (checkbox.checked) return;
      const hidden = document.createElement("input");
      hidden.type = "hidden";
      hidden.name = checkbox.name;
      hidden.value = "false";
      hidden.dataset.generatedHidden = "true";
      settingsForm.append(hidden);
    });
    await api("/api/settings", { method: "PUT", body: new FormData(settingsForm) });
    markUnpublishedChanges(settingsForm.dataset.settingsArea || "Settings/support/contact");
    await loadData();
    renderAdmin();
    setStatus("Settings saved.");
  });

  if (content.querySelector("#publishReview")) renderPublishReview().catch((error) => setStatus(error.message, true));

  const contactSubmissions = content.querySelector("#contactSubmissions");
  if (contactSubmissions) {
    api("/api/contact-submissions").then((data) => {
      contactSubmissions.innerHTML = `
        <h3>Recent contact form submissions</h3>
        ${(data.submissions || []).map((item) => `<div class="item"><h3>${escapeHtml(item.name)} <span class="pill">${escapeHtml(item.status)}</span></h3><p>${escapeHtml(item.email)}${item.product_name ? ` - ${escapeHtml(item.product_name)}` : ""}</p><p>${escapeHtml(item.message)}</p><p class="muted">${escapeHtml(item.created_at)}</p></div>`).join("") || "<p class='muted'>No submissions yet.</p>"}
      `;
    }).catch((error) => {
      contactSubmissions.innerHTML = `<p class="error">${escapeHtml(error.message)}</p>`;
    });
  }

  content.querySelectorAll("[data-settings-section]").forEach((button) => {
    button.addEventListener("click", () => {
      state.settingsSection = button.dataset.settingsSection;
      saveNavigation();
      renderAdmin();
    });
  });

  const productSearch = content.querySelector("#productSearch");
  if (productSearch) productSearch.addEventListener("input", (event) => {
    state.productSearch = event.target.value;
  });
  bindLiveFilter(productSearch, content.querySelector("#productList"));
  content.querySelector("[data-show-archived-products]")?.addEventListener("change", (event) => {
    state.showArchivedProducts = Boolean(event.target.checked);
    renderAdmin();
  });

  const downloadSearch = content.querySelector("#downloadSearch");
  if (downloadSearch) downloadSearch.addEventListener("input", (event) => {
    state.downloadSearch = event.target.value;
  });
  bindLiveFilter(downloadSearch, content.querySelector("#downloadList"));

  const mediaSearch = content.querySelector("#mediaSearch");
  if (mediaSearch) mediaSearch.addEventListener("input", (event) => {
    state.mediaSearch = event.target.value;
  });
  const applyMediaFilter = () => {
    const list = content.querySelector("#mediaList");
    const query = String(mediaSearch?.value || "").trim().toLowerCase();
    list?.querySelectorAll("[data-filter-row]").forEach((row) => {
      const matchesText = !query || String(row.dataset.search || "").toLowerCase().includes(query);
      const matchesKind = state.mediaFilter === "all" || row.dataset.kind === state.mediaFilter;
      row.classList.toggle("hidden", !matchesText || !matchesKind);
    });
  };
  content.querySelectorAll("[data-media-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.mediaFilter = button.dataset.mediaFilter;
      content.querySelectorAll("[data-media-filter]").forEach((item) => item.classList.toggle("active", item === button));
      applyMediaFilter();
    });
  });
  mediaSearch?.addEventListener("input", applyMediaFilter);
  applyMediaFilter();

  const bundleSearch = content.querySelector("#bundleSearch");
  if (bundleSearch) bundleSearch.addEventListener("input", (event) => {
    state.bundleSearch = event.target.value;
  });
  bindLiveFilter(bundleSearch, content.querySelector("#bundleList"));

  const userSearch = content.querySelector("#userSearch");
  if (userSearch) userSearch.addEventListener("input", (event) => {
    state.userSearch = event.target.value;
    filterRows(content.querySelector("#usersOutput") || content, userSearch);
    filterRows(content.querySelector("#invitesOutput") || content, userSearch);
  });
  if (userSearch) {
    filterRows(content.querySelector("#usersOutput") || content, userSearch);
    filterRows(content.querySelector("#invitesOutput") || content, userSearch);
  }

  const openDownloadEditor = (id = null) => {
    state.selectedDownloadId = id ? Number(id) : null;
    state.showDownloadEditor = true;
    renderAdmin();
  };
  const newDownloadBtn = content.querySelector("#newDownloadBtn");
  if (newDownloadBtn) newDownloadBtn.addEventListener("click", () => openDownloadEditor(null));
  const closeDownloadEditorBtn = content.querySelector("#closeDownloadEditorBtn");
  if (closeDownloadEditorBtn) closeDownloadEditorBtn.addEventListener("click", () => {
    state.showDownloadEditor = false;
    state.selectedDownloadId = null;
    renderAdmin();
  });
  content.querySelectorAll("[data-edit-download]").forEach((element) => {
    element.addEventListener("click", (event) => {
      if (event.target.closest("a") || event.target.closest("[data-add-version]") || event.target.closest("[data-archive-download]")) return;
      openDownloadEditor(element.dataset.editDownload);
    });
  });
  content.querySelectorAll("[data-add-version]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      openDownloadEditor(button.dataset.addVersion);
    });
  });
  content.querySelectorAll("[data-archive-download]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      await api(`/api/downloads/${button.dataset.archiveDownload}/archive`, { method: "POST", body: {} });
      markUnpublishedChanges("Downloads");
      if (Number(state.selectedDownloadId) === Number(button.dataset.archiveDownload)) {
        state.selectedDownloadId = null;
        state.showDownloadEditor = false;
      }
      await loadData();
      renderAdmin();
      setStatus("Download archived.");
    });
  });

  const newProductBtn = content.querySelector("#newProductBtn");
  if (newProductBtn) newProductBtn.addEventListener("click", () => {
    state.showProductForm = true;
    state.editingProductId = null;
    state.editingProduct = null;
    renderAdmin();
  });

  const closeProductEditorBtn = content.querySelector("#closeProductEditorBtn");
  if (closeProductEditorBtn) closeProductEditorBtn.addEventListener("click", () => {
    state.showProductForm = false;
    state.editingProductId = null;
    state.editingProduct = null;
    renderAdmin();
  });

  content.querySelectorAll("[data-edit-product]").forEach((button) => {
    button.addEventListener("click", async () => {
      state.tab = "products";
      state.editingProductId = Number(button.dataset.editProduct);
      state.editingProduct = await api(`/api/products/${state.editingProductId}`);
      state.showProductForm = true;
      renderAdmin();
    });
  });

  content.querySelectorAll("[data-duplicate-product]").forEach((button) => {
    button.addEventListener("click", async () => {
      await api(`/api/products/${button.dataset.duplicateProduct}/duplicate`, { method: "POST", body: {} });
      await loadData();
      renderAdmin();
      setStatus("Product duplicated.");
    });
  });

  content.querySelectorAll("[data-detach-aliexpress]").forEach((button) => {
    button.addEventListener("click", async () => {
      await api(`/api/integrations/aliexpress/detach-product/${button.dataset.detachAliexpress}`, { method: "POST", body: {} });
      await loadData();
      renderAdmin();
      setStatus("AliExpress link detached.");
    });
  });

  const categoryForm = content.querySelector("#categoryForm");
  if (categoryForm) categoryForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await api("/api/categories", { method: "POST", body: formValues(categoryForm) });
    markUnpublishedChanges("Products");
    await loadData();
    renderAdmin();
    setStatus("Category created.");
  });

  const fileForm = content.querySelector("#fileForm");
  if (fileForm) fileForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const result = await api("/api/files/upload", { method: "POST", body: new FormData(fileForm) });
    const messages = (result.results || []).map((item) => item.message || `${item.reused ? "Reused existing file" : "Uploaded"}: ${item.file?.originalName || item.originalUploadName || "file"}`);
    markUnpublishedChanges("Media/files");
    await loadData();
    renderAdmin();
    const uploadResults = document.querySelector("#fileUploadResults");
    if (uploadResults) uploadResults.innerHTML = messages.map((message) => `<p>${escapeHtml(message)}</p>`).join("");
    setStatus(messages[0] || "Upload complete.");
  });

  content.querySelectorAll("[data-delete-file]").forEach((button) => {
    button.addEventListener("click", async () => {
      const fileName = button.dataset.fileName || "this file";
      if (!window.confirm(`Delete ${fileName}? This cannot be undone.`)) return;
      try {
        await api(`/api/files/${button.dataset.deleteFile}`, { method: "DELETE", body: {} });
        markUnpublishedChanges("Media/files");
        await loadData();
        renderAdmin();
        setStatus("File deleted.");
      } catch (error) {
        if (error.status === 409) {
          const usages = error.data?.usages || [];
          window.alert(`This file cannot be deleted because it is being used.${usages.length ? `\n\n${usages.join("\n")}` : ""}`);
          return;
        }
        throw error;
      }
    });
  });

  const downloadForm = content.querySelector("#downloadForm");
  if (downloadForm) downloadForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = formValues(downloadForm);
    values.sortOrder = values.sortOrder === "" ? 0 : Number(values.sortOrder || 0);
    const wasEditing = Boolean(state.selectedDownloadId);
    const result = await api(state.selectedDownloadId ? `/api/downloads/${state.selectedDownloadId}` : "/api/downloads", {
      method: state.selectedDownloadId ? "PUT" : "POST",
      body: values
    });
    if (result.download?.id) state.selectedDownloadId = result.download.id;
    state.showDownloadEditor = true;
    markUnpublishedChanges("Downloads");
    await loadData();
    renderAdmin();
    setStatus(wasEditing ? "Download saved." : "Download object created.");
  });

  const versionForm = content.querySelector("#versionForm");
  if (versionForm) versionForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = formValues(versionForm);
    const downloadId = Number(versionForm.dataset.downloadId || state.selectedDownloadId);
    values.fileId = values.fileId ? Number(values.fileId) : null;
    values.isLatest = Boolean(versionForm.querySelector("[name='isLatest']").checked);
    values.deprecated = Boolean(versionForm.querySelector("[name='deprecated']").checked);
    values.releaseNotesMode = versionForm.querySelector("[name='releaseNotesSource']")?.checked ? "html" : "plain";
    await api(`/api/downloads/${downloadId}/versions`, { method: "POST", body: values });
    markUnpublishedChanges("Downloads");
    await loadData();
    renderAdmin();
    setStatus("Version added.");
  });

  const packForm = content.querySelector("#packForm");
  if (packForm) packForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = formValues(packForm);
    values.downloadIds = checkedNumbers(packForm, "downloadIds");
    values.autoGenerateZip = Boolean(packForm.querySelector("[name='autoGenerateZip']").checked);
    await api("/api/software-bundles", { method: "POST", body: values });
    markUnpublishedChanges("Software Bundles");
    await loadData();
    renderAdmin();
    setStatus("Software Bundle created.");
  });

  const productForm = content.querySelector("#productForm");
  if (productForm) {
    const dirtyState = content.querySelector("#productDirtyState");
    const categoryNameInput = productForm.querySelector("[name='categoryName']");
    const categoryIdInput = productForm.querySelector("[name='categoryId']");
    const categoryHint = productForm.querySelector("[data-category-hint]");
    const updateCategoryHint = () => {
      const name = String(categoryNameInput?.value || "").trim();
      const existing = findCategoryByName(name);
      if (categoryIdInput) categoryIdInput.value = existing?.id || "";
      if (!categoryHint) return;
      if (!name) categoryHint.textContent = "Choose an existing category or type a new one.";
      else if (existing) categoryHint.textContent = `Existing category: ${existing.name}`;
      else categoryHint.textContent = `Create category: ${name}`;
    };
    categoryNameInput?.addEventListener("input", updateCategoryHint);
    categoryNameInput?.addEventListener("change", updateCategoryHint);
    updateCategoryHint();
    productForm.addEventListener("input", () => {
      if (dirtyState) dirtyState.textContent = "Unsaved changes.";
    });
    productForm.addEventListener("change", () => {
      if (dirtyState) dirtyState.textContent = "Unsaved changes.";
    });
    productForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = formValues(productForm);
    const typedCategoryName = String(values.categoryName || "").trim();
    let categoryId = values.categoryId ? Number(values.categoryId) : null;
    if (typedCategoryName) {
      const existing = findCategoryByName(typedCategoryName);
      if (existing) categoryId = Number(existing.id);
      else {
        const created = await api("/api/categories", { method: "POST", body: { name: typedCategoryName, description: "" } });
        categoryId = Number(created.category.id);
        state.categories = [...state.categories, created.category].sort((a, b) => String(a.name).localeCompare(String(b.name)));
      }
    }
    values.categoryId = categoryId;
    delete values.categoryName;
    values.featured = Boolean(productForm.querySelector("[name='featured']").checked);
    values.stockTracking = values.stockTracking === "1";
    values.stockCount = values.stockCount === "" ? null : Number(values.stockCount);
    values.stockLowThreshold = values.stockLowThreshold === "" ? 5 : Number(values.stockLowThreshold);
    values.sortOrder = values.sortOrder === "" ? 0 : Number(values.sortOrder);
    values.status = values.publishState === "published" ? "published" : "draft";
    values.galleryFileIds = checkedNumbers(productForm, "galleryFileIds");
    values.descriptionFileIds = checkedNumbers(productForm, "descriptionFileIds");
    values.setupFileIds = checkedNumbers(productForm, "setupFileIds");
    values.supportPackIds = checkedNumbers(productForm, "supportPackIds");
    values.relatedProductIds = checkedNumbers(productForm, "relatedProductIds");
    values.longDescriptionMode = productForm.querySelector("[name='longDescriptionSource']")?.checked ? "html" : "plain";
    const path = state.editingProductId ? `/api/products/${state.editingProductId}` : "/api/products";
    await api(path, { method: state.editingProductId ? "PUT" : "POST", body: values });
    markUnpublishedChanges("Products");
    state.showProductForm = false;
    state.editingProductId = null;
    state.editingProduct = null;
    await loadData();
    renderAdmin();
    setStatus("Product saved.");
    });
  }

  const inviteCreateForm = content.querySelector("#inviteCreateForm");
  if (inviteCreateForm) inviteCreateForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = formValues(inviteCreateForm);
    values.expiresHours = Number(values.expiresHours || 48);
    values.requiresApproval = Boolean(inviteCreateForm.querySelector("[name='requiresApproval']").checked);
    const invite = await api("/api/invites", { method: "POST", body: values });
    const target = document.querySelector("#inviteResult");
    target.innerHTML = linkResult("Invite URL", invite.inviteUrl);
    bindCopyButtons(target);
    await loadUsersAndInvites();
  });

  const supportAccessForm = content.querySelector("#supportAccessForm");
  if (supportAccessForm) supportAccessForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = formValues(supportAccessForm);
    values.expiresHours = Number(values.expiresHours || 24);
    values.accessHours = Number(values.accessHours || 24);
    values.requiresApproval = Boolean(supportAccessForm.querySelector("[name='requiresApproval']").checked);
    const invite = await api("/api/support-access", { method: "POST", body: values });
    const target = document.querySelector("#supportAccessResult");
    target.innerHTML = linkResult("Temporary support link", invite.inviteUrl);
    bindCopyButtons(target);
    await loadUsersAndInvites();
  });

  const userCreateForm = content.querySelector("#userCreateForm");
  if (userCreateForm) userCreateForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = formValues(userCreateForm);
    values.active = Boolean(userCreateForm.querySelector("[name='active']").checked);
    await api("/api/users", { method: "POST", body: values });
    userCreateForm.reset();
    await loadUsersAndInvites();
    setStatus("User created.");
  });

  const reloadUsersBtn = content.querySelector("#reloadUsersBtn");
  if (reloadUsersBtn) reloadUsersBtn.addEventListener("click", () => loadUsersAndInvites().catch((error) => setStatus(error.message, true)));
  if (content.querySelector("#usersOutput")) loadUsersAndInvites().catch((error) => setStatus(error.message, true));
}

logoutBtn.addEventListener("click", async () => {
  await api("/api/logout", { method: "POST", body: {} });
  state.me = null;
  await refresh();
});

applyStoredNavigation();
refresh().catch((error) => {
  app.innerHTML = `<section class="panel"><h2>Unable to start admin UI</h2><p class="error">${escapeHtml(error.message)}</p></section>`;
});
