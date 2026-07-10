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
  bundleSearch: "",
  userSearch: "",
  selectedDownloadId: null,
  showDownloadEditor: false,
  showProductForm: false,
  editingProductId: null,
  editingProduct: null
};

const tabs = [
  ["dashboard", "Dashboard"],
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
  if (!response.ok) throw new Error(json.error || json.details || "Request failed");
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

function formatBytes(size) {
  const bytes = Number(size || 0);
  if (!bytes) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function isImageFile(file) {
  const mime = String(file.mimeType || file.mime_type || "").toLowerCase();
  const name = String(file.originalName || file.original_name || file.url || "").toLowerCase();
  return mime.startsWith("image/") || /\.(svg|png|jpe?g|webp|gif)$/i.test(name);
}

function mediaKind(file) {
  const mime = String(file.mimeType || file.mime_type || "");
  const name = String(file.originalName || file.original_name || "").toLowerCase();
  if (mime.startsWith("image/")) return "images";
  if (mime.includes("pdf") || name.endsWith(".txt")) return "documents";
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
  if (kind === "files") {
    const title = row.originalName || row.original_name || `File ${row.id}`;
    return `${mediaThumb(row)}${pickerBody(inputId, title, `${row.mimeType || row.mime_type || ""} · ${formatBytes(row.size)}`)}<a class="action-link mini-action" href="${escapeHtml(row.url || "#")}" target="_blank" rel="noopener noreferrer">Open</a>`;
  }
  if (kind === "products") return `${pickerIcon("PRD")}${pickerBody(inputId, row.name, `${row.sku || "No SKU"} · ${row.category_name || "No category"} · ${row.import_sync_status ? "Synced" : "Local"}`)}<span></span>`;
  if (kind === "downloads") return `${pickerIcon("DLD")}${pickerBody(inputId, row.name, `${row.type} · ${latestVersionLabel(row)}`)}<span></span>`;
  if (kind === "bundles") return `${pickerIcon("BND")}${pickerBody(inputId, row.name, `${Number(row.downloadIds?.length || 0)} download(s) · ${row.bundle_file_id ? "ZIP generated" : row.auto_generate_zip ? "ZIP on publish" : "No ZIP"}`)}<span></span>`;
  return `${pickerIcon("ITM")}${pickerBody(inputId, row.name || row.originalName || `Item ${row.id}`)}<span></span>`;
}

function pickerSearchText(row, kind) {
  if (kind === "files") return dataText(row.originalName, row.mimeType, row.size);
  if (kind === "products") return dataText(row.name, row.sku, row.category_name, row.import_sync_status);
  if (kind === "downloads") return dataText(row.name, row.type, latestVersionLabel(row));
  if (kind === "bundles") return dataText(row.name, row.description);
  return dataText(row.name, row.originalName);
}

function picker(name, rows, selected = [], kind = "items") {
  const selectedSet = new Set((selected || []).map(Number));
  return `
    <div class="picker" data-picker="${name}">
      <div class="picker-toolbar">
        <input data-picker-search placeholder="Search ${kind}" aria-label="Search ${kind}">
        <span class="muted" data-picker-count>${selectedSet.size} selected</span>
        <button class="secondary" type="button" data-picker-select-visible>Select all visible</button>
        <button class="secondary" type="button" data-picker-clear>Clear selected</button>
      </div>
      <div class="picker-list">
        ${rows.map((row) => {
          const checked = selectedSet.has(Number(row.id));
          const inputId = `picker-${name}-${row.id}`;
          return `
            <div class="picker-row ${checked ? "picker-selected" : ""}" data-picker-row data-search="${escapeHtml(pickerSearchText(row, kind))}">
              <input id="${escapeHtml(inputId)}" type="checkbox" name="${name}" value="${row.id}" ${checked ? "checked" : ""}>
              ${pickerMeta(row, kind, inputId)}
            </div>
          `;
        }).join("") || "<p class='muted'>No items yet.</p>"}
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

function unpublishedNotice() {
  return hasUnpublishedChanges() ? `<button class="notice notice-action" type="button" data-open-publish>Unpublished changes - publish needed.</button>` : "";
}

function markUnpublishedChanges() {
  localStorage.setItem("kairixUnpublishedChanges", "1");
}

function clearUnpublishedChanges() {
  localStorage.removeItem("kairixUnpublishedChanges");
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
    api("/api/products"),
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
  return `
    <section class="panel">
      <h2>Page Manager overview</h2>
      ${unpublishedNotice()}
      <p class="muted">Create products, group downloads into Software Bundles, publish the static customer support site, and review basic analytics.</p>
      <div class="actions">
        <button id="sampleBtn" type="button">Create rich sample data</button>
        <a class="action-link" href="/preview/" target="_blank">Open last published preview</a>
      </div>
      <div class="list">
        <div class="item"><h3>${state.categories.length}</h3><p>Categories</p></div>
        <div class="item"><h3>${state.products.length}</h3><p>Products</p></div>
        <div class="item"><h3>${state.downloads.length}</h3><p>Downloads</p></div>
        <div class="item"><h3>${state.packs.length}</h3><p>Software Bundles</p></div>
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
      <form id="settingsForm" class="form-grid">
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
      <form id="settingsForm" class="form-grid">
        <label>Support email<input name="supportEmail" type="email" value="${escapeHtml(s.supportEmail || "")}"></label>
        <label>Support link<input name="supportLink" value="${escapeHtml(s.supportLink || "")}"></label>
        <label>Marketplace/store link<input name="marketplaceUrl" value="${escapeHtml(s.marketplaceUrl || "")}"></label>
        <label class="check-row"><input name="contactFormEnabled" type="checkbox" ${s.contactFormEnabled === "on" || s.contactFormEnabled === "true" ? "checked" : ""}> Enable public contact form</label>
        <button type="submit">Save support info</button>
      </form>
      <div class="item">
        <h3>Public contact rows</h3>
        <p class="muted">Add the seller-facing support options that should appear on the public support portal.</p>
        <form id="contactMethodForm" class="form-grid">
          <label>Label<input name="label" placeholder="WhatsApp support" required></label>
          <label>Type<select name="type"><option value="link">Link</option><option value="email">Email</option><option value="phone">Phone</option><option value="marketplace">Marketplace</option></select></label>
          <label class="wide">Value<input name="value" placeholder="https:// or email/phone" required></label>
          <label>Sort order<input name="sortOrder" type="number" value="0"></label>
          <button type="submit">Add contact row</button>
        </form>
        <div class="list compact-list-ui">
          ${state.contactMethods.map((method) => `
            <div class="item mini-row">
              <div><strong>${escapeHtml(method.label)}</strong> <span class="pill">${escapeHtml(method.type)}</span><p class="muted">${escapeHtml(method.value)}</p></div>
              <button class="secondary" type="button" data-delete-contact-method="${method.id}">Hide</button>
            </div>
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
      <div class="list">${state.categories.map((cat) => `<div class="item"><h3>${escapeHtml(cat.name)}</h3><p>${escapeHtml(cat.description || "")}</p><span class="pill">${escapeHtml(cat.slug)}</span></div>`).join("")}</div>
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
      <form id="fileForm" class="form-grid">
        <label class="wide">Upload files<input name="files" type="file" multiple></label>
        <button type="submit">Upload</button>
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
            <h3>${escapeHtml(download.name)} <span class="pill">${escapeHtml(download.type)}</span></h3>
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
          <button class="secondary" id="closeDownloadEditorBtn" type="button">Close</button>
        </div>
        <form id="downloadForm" class="form-grid">
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
            <label class="wide">External URL<input name="externalUrl"></label>
            <label class="wide">Release notes<textarea name="releaseNotes"></textarea></label>
            <label class="check-row"><input name="isLatest" type="checkbox" checked> Latest</label>
            <label class="check-row"><input name="deprecated" type="checkbox"> Deprecated</label>
            <label>Warning text<input name="warningText"></label>
            <label>File size<input name="fileSize"></label>
            <label>Checksum<input name="checksum"></label>
            <button type="submit">Add version</button>
          </form>
          <div class="list">
            ${(editorDownload.versions || []).map((version) => `<div class="item mini-row"><div><strong>${escapeHtml(version.version_number)}</strong> ${version.is_latest ? "<span class='pill'>Latest</span>" : ""}<p class="muted">${escapeHtml(version.release_date || "No date")} ${version.deprecated ? "· Deprecated" : ""}</p></div></div>`).join("") || "<p class='muted'>No versions yet.</p>"}
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
  const editSupportPackIds = state.editingProduct?.supportPackIds || [];
  const editRelatedProductIds = state.editingProduct?.relatedProductIds || [];
  const editImages = state.editingProduct?.images || [];
  const editFileIds = (kind) => editImages.filter((image) => image.kind === kind).map((image) => image.file_id);
  const products = state.products.filter((product) => {
    const q = state.productSearch.toLowerCase();
    return !q || product.name.toLowerCase().includes(q) || String(product.sku || "").toLowerCase().includes(q) || String(product.category_name || "").toLowerCase().includes(q);
  });
  return `
    <section class="panel">
      <div class="section-heading">
        <h2>Products</h2>
        <button id="newProductBtn" type="button">Add product</button>
      </div>
      <div class="toolbar">
        <input id="productSearch" placeholder="Search products by name, SKU, or category" value="${escapeHtml(state.productSearch)}">
      </div>
      <div id="productList" class="list">${products.map((product) => `
        <div class="item product-row ${product.import_sync_status ? "marketplace-synced" : ""}" data-filter-row data-search="${escapeHtml(dataText(product.name, product.sku, product.category_name, product.short_description, stockLabel(product), product.import_sync_status))}">
          <div>
            <h3>${escapeHtml(product.name)} <span class="pill">${escapeHtml(product.publish_state || product.status)}</span>${product.import_sync_status ? ` <span class="pill">AliExpress ${escapeHtml(product.import_sync_status)}</span>` : ""}</h3>
            <p>${escapeHtml(product.short_description || "")}</p>
            <p class="muted">${escapeHtml(product.category_name || "No category")} ${product.sku ? `- ${escapeHtml(product.sku)}` : ""} - ${escapeHtml(stockLabel(product))}${product.last_imported_at ? ` - Synced ${escapeHtml(product.last_imported_at)}` : ""}</p>
          </div>
          <div class="actions"><button type="button" data-edit-product="${product.id}">Edit</button><button class="secondary" type="button" data-duplicate-product="${product.id}">Duplicate</button>${product.import_sync_status ? `<button class="secondary" type="button" data-detach-aliexpress="${product.id}">Detach</button>` : ""}</div>
        </div>`).join("")}</div>
    </section>
    <section class="panel ${state.showProductForm ? "" : "hidden"}" id="productEditor" tabindex="-1">
      <h2>${state.editingProductId ? "Edit product" : "Create product"}</h2>
      <form id="productForm" class="form-grid">
        <fieldset class="wide form-section">
          <legend>Basics</legend>
          <div class="form-grid">
            <label>Name<input name="name" required value="${escapeHtml(edit.name || "")}"></label>
            <label>SKU<input name="sku" value="${escapeHtml(edit.sku || "")}"></label>
            <label>Version indicator<input name="versionLabel" value="${escapeHtml(edit.version_label || "")}"></label>
            <label>Category<select name="categoryId"><option value="">None</option>${optionList(state.categories, edit.category_id ? [edit.category_id] : [])}</select></label>
            <label>Sort order<input name="sortOrder" type="number" value="${escapeHtml(edit.sort_order ?? 0)}"></label>
            <label>Publish state<select name="publishState">${[
              ["draft", "Draft"],
              ["ready", "Ready"],
              ["published", "Published"],
              ["needs_review", "Needs review"],
              ["archived", "Archived"]
            ].map(([value, label]) => `<option value="${value}" ${(edit.publish_state || "draft") === value ? "selected" : ""}>${label}</option>`).join("")}</select></label>
          </div>
        </fieldset>
        <fieldset class="wide form-section">
          <legend>Public display</legend>
          <div class="form-grid">
            <label class="check-row"><input name="featured" type="checkbox" ${edit.featured ? "checked" : ""}> Featured</label>
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
          <div><strong>Product gallery images</strong>${picker("galleryFileIds", state.files, editFileIds("gallery"), "files")}</div>
          <div><strong>Description images</strong>${picker("descriptionFileIds", state.files, editFileIds("description"), "files")}</div>
          <div><strong>App/setup screenshots</strong>${picker("setupFileIds", state.files, editFileIds("setup"), "files")}</div>
        </fieldset>
        <fieldset class="wide form-section">
          <legend>Description</legend>
          <label>Long description<textarea name="longDescription">${escapeHtml(edit.long_description || "")}</textarea></label>
        </fieldset>
        <fieldset class="wide form-section">
          <legend>Downloads and Software Bundles</legend>
          ${picker("supportPackIds", state.packs, editSupportPackIds, "bundles")}
        </fieldset>
        <fieldset class="wide form-section">
          <legend>Related products</legend>
          ${picker("relatedProductIds", state.products.filter((product) => product.id !== edit.id), editRelatedProductIds, "products")}
        </fieldset>
        <button type="submit">${state.editingProductId ? "Save product" : "Create product"}</button>
      </form>
    </section>
  `;
}

function publishView() {
  return `
    <section class="panel">
      <h2>Publish Review ${helpIcon("Review warnings, preview the site, then publish the static customer support site.")}</h2>
      ${unpublishedNotice()}
      <p class="muted">Review warnings, open the current preview, then publish the static customer support site.</p>
      <div id="publishReview" class="list" tabindex="-1"></div>
      <div class="actions">
        <button id="publishBtn" type="button">Publish</button>
        <a class="action-link" href="/preview/" target="_blank">Open last published preview</a>
      </div>
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
            <span class="pill">${escapeHtml(status)}</span>
          </div>
          <p class="muted">Credentials stay in the Page Manager database and are not exported to the public site. Configure official Open Platform endpoints before connecting.</p>
          <form id="aliexpressSettingsForm" class="form-grid">
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
        <h3>${escapeHtml(user.username)} <span class="pill">${escapeHtml(user.role)}</span> <span class="pill">${escapeHtml(user.status || "active")}</span></h3>
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
      <h3>${escapeHtml(invite.label || invite.email || "Invite")} <span class="pill">${escapeHtml(invite.role)}</span> <span class="pill">${escapeHtml(invite.status || "open")}</span></h3>
      <p class="muted">${escapeHtml(invite.email || "No email")} - Expires ${escapeHtml(invite.expires_at)}</p>
      <p class="muted">Created ${escapeHtml(invite.created_at)}${invite.created_by_username ? ` by ${escapeHtml(invite.created_by_username)}` : ""}${invite.accepted_username ? ` - Accepted by ${escapeHtml(invite.accepted_username)}` : ""}</p>
      ${invite.requires_approval ? "<span class='pill'>Approval required</span>" : ""}
      ${invite.support_access_hours ? `<span class="pill">${escapeHtml(invite.support_access_hours)}h support access</span>` : ""}
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
  const warnings = review.warnings || [];
  const events = review.recentPublishEvents || [];
  target.innerHTML = `
    <div class="summary-grid">
      <div class="item"><h3>${review.counts.products}</h3><p>Products</p></div>
      <div class="item"><h3>${review.counts.downloads}</h3><p>Downloads</p></div>
      <div class="item"><h3>${review.counts.softwareBundles}</h3><p>Software Bundles</p></div>
      <div class="item"><h3>${warnings.length}</h3><p>Warnings</p></div>
    </div>
    <div class="item">
      <h3>Warnings</h3>
      ${warnings.length ? `<div class="warning-list">${warnings.map((warning, index) => `
        <button class="warning-row" type="button" data-warning-index="${index}">
          <span>${escapeHtml(warning.message)}</span>
          <strong>Fix</strong>
        </button>
      `).join("")}</div>` : "<p class='muted'>No warnings found.</p>"}
    </div>
    <div class="item">
      <h3>Last publish events</h3>
      ${events.map((event) => {
        const summary = parseBuildSummary(event.message || "");
        return `
          <div class="publish-event">
            <p><span class="pill">${escapeHtml(event.status)}</span> <span class="muted">${escapeHtml(event.created_at)}</span> ${escapeHtml(cleanPublishMessage(event))}</p>
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
}

function bindTabEvents(content) {
  const handlers = {
    sampleBtn: async () => {
      await api("/api/sample-data", { method: "POST", body: {} });
      markUnpublishedChanges();
      await loadData();
      renderAdmin();
      setStatus("Sample data created.");
    },
    publishBtn: async () => {
      const output = document.querySelector("#publishOutput");
      output.innerHTML = `<p class="muted">Publishing...</p>`;
      const result = await api("/api/publish", { method: "POST", body: {} });
      const summary = parseBuildSummary(result.output || "");
      output.innerHTML = `
        <p class="publish-success">Published successfully.</p>
        ${summary.pages || summary.duration ? `<p class="muted">${summary.pages ? `${escapeHtml(summary.pages)} page(s) built` : ""}${summary.pages && summary.duration ? " · " : ""}${summary.duration ? `Duration ${escapeHtml(summary.duration)}` : ""}</p>` : ""}
        ${buildLogDetails(result.output || result.message || "")}
      `;
      clearUnpublishedChanges();
      await renderPublishReview();
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
        <div class="item"><h3>Recent activity</h3>${(analytics.recent || []).map((event) => `<p><span class="pill">${escapeHtml(event.event_type)}</span> ${escapeHtml(event.path || "")} <span class="muted">${escapeHtml(event.created_at)}</span></p>`).join("") || "<p class='muted'>No events yet.</p>"}</div>
      `;
    },
    loadAuditBtn: async () => {
      const audit = await api("/api/audit-events");
      document.querySelector("#auditOutput").innerHTML = (audit.events || []).map((event) => `
        <div class="item">
          <h3>${escapeHtml(event.event_type)} ${event.username ? `<span class="pill">${escapeHtml(event.username)}</span>` : ""}</h3>
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

  content.querySelectorAll("[data-preview-image]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openImagePreview(button.dataset.previewImage || "", button.dataset.previewTitle || "");
    });
  });

  content.querySelectorAll("[data-open-publish]").forEach((button) => {
    button.addEventListener("click", () => openPublishReview());
  });

  content.querySelectorAll("[data-picker]").forEach((pickerEl) => {
    const search = pickerEl.querySelector("[data-picker-search]");
    const count = pickerEl.querySelector("[data-picker-count]");
    const update = () => {
      const query = String(search?.value || "").trim().toLowerCase();
      let selected = 0;
      pickerEl.querySelectorAll("[data-picker-row]").forEach((row) => {
        const checked = row.querySelector("input[type='checkbox']")?.checked;
        if (checked) selected += 1;
        const matches = String(row.dataset.search || "").toLowerCase().includes(query);
        row.classList.toggle("hidden", Boolean(query) && !matches && !checked);
        row.classList.toggle("picker-selected", Boolean(checked));
      });
      if (count) count.textContent = `${selected} selected`;
    };
    search?.addEventListener("input", update);
    pickerEl.addEventListener("change", update);
    pickerEl.querySelector("[data-picker-select-visible]")?.addEventListener("click", () => {
      pickerEl.querySelectorAll("[data-picker-row]:not(.hidden) input[type='checkbox']").forEach((input) => {
        input.checked = true;
      });
      update();
    });
    pickerEl.querySelector("[data-picker-clear]")?.addEventListener("click", () => {
      pickerEl.querySelectorAll("input[type='checkbox']").forEach((input) => {
        input.checked = false;
      });
      update();
    });
    update();
  });

  const contactMethodForm = content.querySelector("#contactMethodForm");
  if (contactMethodForm) contactMethodForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = formValues(contactMethodForm);
    values.sortOrder = Number(values.sortOrder || 0);
    await api("/api/contact-methods", { method: "POST", body: values });
    await loadData();
    renderAdmin();
    setStatus("Contact row added.");
  });

  content.querySelectorAll("[data-delete-contact-method]").forEach((button) => {
    button.addEventListener("click", async () => {
      await api(`/api/contact-methods/${button.dataset.deleteContactMethod}`, { method: "DELETE", body: {} });
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
    if (settingsForm.querySelector("[name='contactFormEnabled']") && !settingsForm.querySelector("[name='contactFormEnabled']").checked) {
      const hidden = document.createElement("input");
      hidden.type = "hidden";
      hidden.name = "contactFormEnabled";
      hidden.value = "false";
      hidden.dataset.generatedHidden = "true";
      settingsForm.append(hidden);
    }
    await api("/api/settings", { method: "PUT", body: new FormData(settingsForm) });
    markUnpublishedChanges();
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
      markUnpublishedChanges();
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

  content.querySelectorAll("[data-edit-product]").forEach((button) => {
    button.addEventListener("click", async () => {
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
    markUnpublishedChanges();
    await loadData();
    renderAdmin();
    setStatus("Category created.");
  });

  const fileForm = content.querySelector("#fileForm");
  if (fileForm) fileForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await api("/api/files/upload", { method: "POST", body: new FormData(fileForm) });
    markUnpublishedChanges();
    await loadData();
    renderAdmin();
    setStatus("File uploaded.");
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
    markUnpublishedChanges();
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
    await api(`/api/downloads/${downloadId}/versions`, { method: "POST", body: values });
    markUnpublishedChanges();
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
    markUnpublishedChanges();
    await loadData();
    renderAdmin();
    setStatus("Software Bundle created.");
  });

  const productForm = content.querySelector("#productForm");
  if (productForm) productForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = formValues(productForm);
    values.categoryId = values.categoryId ? Number(values.categoryId) : null;
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
    const path = state.editingProductId ? `/api/products/${state.editingProductId}` : "/api/products";
    await api(path, { method: state.editingProductId ? "PUT" : "POST", body: values });
    markUnpublishedChanges();
    state.showProductForm = false;
    state.editingProductId = null;
    state.editingProduct = null;
    await loadData();
    renderAdmin();
    setStatus("Product saved.");
  });

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
