const app = document.querySelector("#app");
const adminTitle = document.querySelector("#adminTitle");
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
  users: [],
  invites: [],
  tab: "dashboard",
  settingsSection: "branding",
  productSearch: "",
  downloadSearch: "",
  bundleSearch: "",
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
  ["advanced", "Advanced"]
];

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

function checkboxes(name, rows, selected = []) {
  const selectedSet = new Set((selected || []).map(Number));
  return `<div class="checkbox-grid">${rows.map((row) => `
    <label class="check-row">
      <input type="checkbox" name="${name}" value="${row.id}" ${selectedSet.has(Number(row.id)) ? "checked" : ""}>
      <span>${escapeHtml(row.name || row.originalName || row.original_name || `File ${row.id}`)}</span>
    </label>`).join("") || "<p class='muted'>No items yet.</p>"}</div>`;
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
  document.title = title;
}

async function refresh() {
  const me = await api("/api/me");
  state.me = me;
  state.csrfToken = me.csrfToken;
  sessionLabel.textContent = me.user ? `${me.user.username} (${me.user.role})` : "";
  logoutBtn.classList.toggle("hidden", !me.user);
  if (me.needsSetup) return renderSetup();
  if (!me.user) return renderLogin();
  await loadData();
  renderAdmin();
}

async function loadData() {
  const [settings, categories, products, files, downloads, packs] = await Promise.all([
    api("/api/settings"),
    api("/api/categories"),
    api("/api/products"),
    api("/api/files"),
    api("/api/downloads"),
    api("/api/software-bundles")
  ]);
  state.settings = settings;
  updateAdminTitle(settings);
  state.categories = categories.categories;
  state.products = products.products;
  state.files = files.files;
  state.downloads = downloads.downloads;
  state.packs = packs.bundles || packs.packs;
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
      await refresh();
    } catch (error) {
      setStatus(error.message, true);
    }
  });
}

function renderAdmin() {
  app.innerHTML = `
    <nav class="tabs">${tabs.map(([id, label]) => `<button type="button" data-tab="${id}" class="${state.tab === id ? "active" : ""}">${label}</button>`).join("")}</nav>
    <div id="tabContent"></div>
  `;
  app.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.tab = button.dataset.tab;
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
      <p class="muted">Create products, group downloads into Software Bundles, publish the static customer support site, and review basic analytics.</p>
      <div class="actions">
        <button id="sampleBtn" type="button">Create rich sample data</button>
        <a class="action-link" href="/preview/" target="_blank">Open generated preview</a>
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
    advanced: advancedSettingsView
  }[state.settingsSection] || brandingSettingsView;
  return `
    <nav class="subtabs">${settingsSections.map(([id, label]) => `<button type="button" data-settings-section="${id}" class="${state.settingsSection === id ? "active" : ""}">${label}</button>`).join("")}</nav>
    ${active()}
    ${developerSupportCard()}
  `;
}

function developerSupportCard() {
  return `
    <section class="support-card">
      <div>
        <h2>Support this tool</h2>
        <p>If this page manager helps your business, you can support the developer here.</p>
      </div>
      <a class="action-link coffee-link" href="https://buymeacoffee.com/dubcodes" target="_blank" rel="noopener noreferrer">☕ Buy me a coffee</a>
    </section>
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
    <section class="panel">
      <h2>Support/contact info</h2>
      <p class="muted">Show customers where to get product help. For order or payment issues, direct them back to the marketplace order page.</p>
      <form id="settingsForm" class="form-grid">
        <label>Support email<input name="supportEmail" type="email" value="${escapeHtml(s.supportEmail || "")}"></label>
        <label>Support link<input name="supportLink" value="${escapeHtml(s.supportLink || "")}"></label>
        <label>Marketplace/store link<input name="marketplaceUrl" value="${escapeHtml(s.marketplaceUrl || "")}"></label>
        <label class="check-row"><input name="contactFormEnabled" type="checkbox" ${s.contactFormEnabled === "on" || s.contactFormEnabled === "true" ? "checked" : ""}> Enable public contact form</label>
        <button type="submit">Save support info</button>
      </form>
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
  return `
    <section class="panel">
      <h2>Media Library</h2>
      <p class="muted">Upload product images, manuals, firmware, installers and demo files. Risky software file types are allowed for downloads but are never executed by this app.</p>
      <form id="fileForm" class="form-grid">
        <label class="wide">Upload files<input name="files" type="file" multiple></label>
        <button type="submit">Upload</button>
      </form>
      <div class="list">${state.files.map((file) => `<div class="item"><h3>${escapeHtml(file.originalName)}</h3><p>${escapeHtml(file.mimeType)} - ${Math.round(file.size / 1024)} KB</p><a href="${file.url}" target="_blank">${file.url}</a></div>`).join("")}</div>
    </section>
  `;
}

function downloadsView() {
  return `
    <section class="panel">
      <h2>Downloads</h2>
      <div class="toolbar"><input id="downloadSearch" placeholder="Search downloads" value="${escapeHtml(state.downloadSearch)}"></div>
    </section>
    <div class="grid-two">
      <section class="panel">
        <h2>Create download</h2>
        <form id="downloadForm" class="form-grid">
          <label>Name<input name="name" required></label>
          <label>Type<select name="type">${["Android", "iOS", "Windows", "Mac", "Firmware", "Manual", "Other"].map((type) => `<option>${type}</option>`).join("")}</select></label>
          <label class="wide">Short description<textarea name="shortDescription"></textarea></label>
          <label class="wide">External URL<input name="externalUrl" placeholder="https://"></label>
          <button type="submit">Create download</button>
        </form>
      </section>
      <section class="panel">
        <h2>Add version</h2>
        <form id="versionForm" class="form-grid">
          <label>Download<select name="downloadId">${optionList(state.downloads)}</select></label>
          <label>Version number<input name="versionNumber" required></label>
          <label>Release date<input name="releaseDate" type="date"></label>
          <label>Uploaded file<select name="fileId"><option value="">None</option>${optionList(state.files)}</select></label>
          <label class="wide">External URL<input name="externalUrl"></label>
          <label class="wide">Release notes<textarea name="releaseNotes"></textarea></label>
          <label class="check-row"><input name="isLatest" type="checkbox" checked> Latest</label>
          <label class="check-row"><input name="deprecated" type="checkbox"> Deprecated</label>
          <label>Warning text<input name="warningText"></label>
          <label>File size<input name="fileSize"></label>
          <label>Checksum placeholder<input name="checksum"></label>
          <button type="submit">Add version</button>
        </form>
      </section>
    </div>
    <section class="panel">
      <h2>Existing downloads</h2>
      <div class="list">${state.downloads.filter((download) => !state.downloadSearch || download.name.toLowerCase().includes(state.downloadSearch.toLowerCase()) || download.type.toLowerCase().includes(state.downloadSearch.toLowerCase())).map((download) => `
        <div class="item">
          <h3>${escapeHtml(download.name)} <span class="pill">${escapeHtml(download.type)}</span></h3>
          <p>${escapeHtml(download.short_description || "")}</p>
          <p class="muted">${download.versions.length} version(s)</p>
        </div>`).join("")}</div>
    </section>
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
        <div class="wide"><strong>Downloads included in this Software Bundle</strong>${checkboxes("downloadIds", state.downloads)}</div>
        <label class="check-row"><input name="autoGenerateZip" type="checkbox" checked> Auto-generate ZIP during publish</label>
        <button type="submit">Create Software Bundle</button>
      </form>
      <div class="list">${state.packs.filter((pack) => !state.bundleSearch || pack.name.toLowerCase().includes(state.bundleSearch.toLowerCase())).map((pack) => `<div class="item"><h3>${escapeHtml(pack.name)}</h3><p>${escapeHtml(pack.description || "")}</p>${supportPackIncludes(pack)}<p class="muted">ZIP: ${pack.bundle_file_id ? "Generated" : pack.auto_generate_zip ? "Will generate on publish when local files exist" : "Disabled"}</p></div>`).join("")}</div>
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
      <div class="list">${products.map((product) => `
        <div class="item product-row">
          <div>
            <h3>${escapeHtml(product.name)} <span class="pill">${escapeHtml(product.publish_state || product.status)}</span></h3>
            <p>${escapeHtml(product.short_description || "")}</p>
            <p class="muted">${escapeHtml(product.category_name || "No category")} ${product.sku ? `- ${escapeHtml(product.sku)}` : ""} - ${escapeHtml(stockLabel(product))}</p>
          </div>
          <div class="actions"><button type="button" data-edit-product="${product.id}">Edit</button><button class="secondary" type="button" data-duplicate-product="${product.id}">Duplicate</button></div>
        </div>`).join("")}</div>
    </section>
    <section class="panel ${state.showProductForm ? "" : "hidden"}" id="productEditor">
      <h2>${state.editingProductId ? "Edit product" : "Create product"}</h2>
      <form id="productForm" class="form-grid">
        <label>Name<input name="name" required value="${escapeHtml(edit.name || "")}"></label>
        <label>SKU<input name="sku" value="${escapeHtml(edit.sku || "")}"></label>
        <label>Version indicator<input name="versionLabel" value="${escapeHtml(edit.version_label || "")}"></label>
        <label>Category<select name="categoryId"><option value="">None</option>${optionList(state.categories, edit.category_id ? [edit.category_id] : [])}</select></label>
        <label>Publish state<select name="publishState">${["draft", "ready", "published", "needs_review"].map((value) => `<option value="${value}" ${(edit.publish_state || "draft") === value ? "selected" : ""}>${value.replace("_", " ")}</option>`).join("")}</select></label>
        <label>Sort order<input name="sortOrder" type="number" value="${escapeHtml(edit.sort_order ?? 0)}"></label>
        <label class="wide">Marketplace product URL ${helpIcon("Link to this product's AliExpress, Alibaba, eBay, or other marketplace listing.")}<input name="marketplaceUrl" value="${escapeHtml(edit.marketplace_url || "")}"></label>
        <label>Stock tracking<select name="stockTracking"><option value="0" ${edit.stock_tracking ? "" : "selected"}>Off</option><option value="1" ${edit.stock_tracking ? "selected" : ""}>On</option></select></label>
        <label>Exact stock count<input name="stockCount" type="number" value="${escapeHtml(edit.stock_count ?? "")}"></label>
        <label>Low stock threshold<input name="stockLowThreshold" type="number" value="${escapeHtml(edit.stock_low_threshold ?? 5)}"></label>
        <label>Stock display mode ${helpIcon("The exact stock count is stored privately. Customers can see a friendly availability message instead.")}<select name="stockDisplayMode">${["friendly", "hidden", "exact"].map((value) => `<option value="${value}" ${(edit.stock_display_mode || "friendly") === value ? "selected" : ""}>${value}</option>`).join("")}</select></label>
        <label>Stock source<select name="stockSource">${["manual", "marketplace", "unknown"].map((value) => `<option value="${value}" ${(edit.stock_source || "manual") === value ? "selected" : ""}>${value}</option>`).join("")}</select></label>
        <label>Color options<input name="colorOptions" value="${escapeHtml(edit.color_options || "")}"></label>
        <label class="wide">Option notes<textarea name="optionNotes">${escapeHtml(edit.option_notes || "")}</textarea></label>
        <label class="wide">Short description<textarea name="shortDescription">${escapeHtml(edit.short_description || "")}</textarea></label>
        <label class="wide">Long description<textarea name="longDescription">${escapeHtml(edit.long_description || "")}</textarea></label>
        <label>Status<select name="status"><option value="draft" ${edit.status !== "published" ? "selected" : ""}>Draft</option><option value="published" ${edit.status === "published" ? "selected" : ""}>Published</option></select></label>
        <label class="check-row"><input name="featured" type="checkbox" ${edit.featured ? "checked" : ""}> Featured</label>
        <div class="wide"><strong>Product gallery images</strong>${checkboxes("galleryFileIds", state.files, editFileIds("gallery"))}</div>
        <div class="wide"><strong>Description images</strong>${checkboxes("descriptionFileIds", state.files, editFileIds("description"))}</div>
        <div class="wide"><strong>App/setup screenshots</strong>${checkboxes("setupFileIds", state.files, editFileIds("setup"))}</div>
        <div class="wide"><strong>Software Bundles</strong>${checkboxes("supportPackIds", state.packs, editSupportPackIds)}</div>
        <div class="wide"><strong>Manual related products</strong>${checkboxes("relatedProductIds", state.products.filter((product) => product.id !== edit.id), editRelatedProductIds)}</div>
        <button type="submit">${state.editingProductId ? "Save product" : "Create product"}</button>
      </form>
    </section>
  `;
}

function publishView() {
  return `
    <section class="panel">
      <h2>Publish Review ${helpIcon("Review warnings, preview the site, then publish the static customer support site.")}</h2>
      <p class="muted">Review warnings, open the current preview, then publish the static customer support site.</p>
      <div id="publishReview" class="list"></div>
      <div class="actions">
        <button id="publishBtn" type="button">Publish</button>
        <a class="action-link" href="/preview/" target="_blank">Open preview</a>
      </div>
      <pre id="publishOutput"></pre>
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
  return `
    <section class="panel">
      <h2>Marketplace integrations</h2>
      <p class="muted">Placeholders for future import flows. API credentials are intentionally not required in v1.</p>
      <div class="list">
        ${["AliExpress", "Alibaba", "eBay", "Amazon", "Shopify"].map((name) => `
          <div class="item"><h3>${name}</h3><p>Select marketplace, enter API token, choose listings to import, then clean generated content. Future imports will never overwrite edited content without confirmation.</p><span class="pill">Placeholder</span></div>
        `).join("")}
      </div>
    </section>
  `;
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
          <label>Label<input name="label" placeholder="Optional note"></label>
          <label>Role<select name="role">${roleOptions()}</select></label>
          <label>Expires in hours<input name="expiresHours" type="number" value="48" min="1"></label>
          <label class="check-row"><input name="requiresApproval" type="checkbox"> Require admin approval after signup</label>
          <button type="submit">Create invite</button>
          <div id="inviteResult" class="wide status"></div>
        </form>
        <form id="supportAccessForm" class="form-grid item">
          <h3 class="wide">Temporary support access</h3>
          <label>Email<input name="email" type="email"></label>
          <label>Label<input name="label" value="Temporary support access"></label>
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
  return state.users.map((user) => `
    <div class="item user-row">
      <div>
        <h3>${escapeHtml(user.username)} <span class="pill">${escapeHtml(user.role)}</span> <span class="pill">${escapeHtml(user.status || "active")}</span></h3>
        <p class="muted">${escapeHtml(user.email || "No email")} - Last login: ${escapeHtml(user.last_login_at || "Never")}</p>
        ${user.support_access_expires_at ? `<p class="muted">Temporary support access expires ${escapeHtml(user.support_access_expires_at)}</p>` : ""}
      </div>
      <div class="actions">
        ${user.status === "pending" ? `<button type="button" data-approve-user="${user.id}">Approve</button>` : ""}
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
    <div class="item">
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
  bindUserActionButtons();
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
      setStatus("Password reset link generated.");
    });
  });
}

async function renderPublishReview() {
  const target = document.querySelector("#publishReview");
  if (!target) return;
  const review = await api("/api/publish/preview");
  target.innerHTML = `
    <div class="summary-grid">
      <div class="item"><h3>${review.counts.products}</h3><p>Products</p></div>
      <div class="item"><h3>${review.counts.downloads}</h3><p>Downloads</p></div>
      <div class="item"><h3>${review.counts.softwareBundles}</h3><p>Software Bundles</p></div>
      <div class="item"><h3>${review.warnings.length}</h3><p>Warnings</p></div>
    </div>
    <div class="item">
      <h3>Warnings</h3>
      ${review.warnings.length ? `<ul class="compact-list">${review.warnings.map((warning) => `<li>${escapeHtml(warning.message)}</li>`).join("")}</ul>` : "<p class='muted'>No warnings found.</p>"}
    </div>
    <div class="item">
      <h3>Last publish events</h3>
      ${(review.recentPublishEvents || []).map((event) => `<p><span class="pill">${escapeHtml(event.status)}</span> ${escapeHtml(event.created_at)} ${escapeHtml(event.message || "").slice(0, 160)}</p>`).join("") || "<p class='muted'>No publish events yet.</p>"}
    </div>
  `;
}

function bindTabEvents(content) {
  const handlers = {
    sampleBtn: async () => {
      await api("/api/sample-data", { method: "POST", body: {} });
      await loadData();
      renderAdmin();
      setStatus("Sample data created.");
    },
    publishBtn: async () => {
      const output = document.querySelector("#publishOutput");
      output.textContent = "Publishing...";
      const result = await api("/api/publish", { method: "POST", body: {} });
      output.textContent = result.output || result.message || "Published.";
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
      renderAdmin();
    });
  });

  const productSearch = content.querySelector("#productSearch");
  if (productSearch) productSearch.addEventListener("input", (event) => {
    state.productSearch = event.target.value;
    renderAdmin();
  });

  const downloadSearch = content.querySelector("#downloadSearch");
  if (downloadSearch) downloadSearch.addEventListener("input", (event) => {
    state.downloadSearch = event.target.value;
    renderAdmin();
  });

  const bundleSearch = content.querySelector("#bundleSearch");
  if (bundleSearch) bundleSearch.addEventListener("input", (event) => {
    state.bundleSearch = event.target.value;
    renderAdmin();
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

  const categoryForm = content.querySelector("#categoryForm");
  if (categoryForm) categoryForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await api("/api/categories", { method: "POST", body: formValues(categoryForm) });
    await loadData();
    renderAdmin();
    setStatus("Category created.");
  });

  const fileForm = content.querySelector("#fileForm");
  if (fileForm) fileForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await api("/api/files/upload", { method: "POST", body: new FormData(fileForm) });
    await loadData();
    renderAdmin();
    setStatus("File uploaded.");
  });

  const downloadForm = content.querySelector("#downloadForm");
  if (downloadForm) downloadForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await api("/api/downloads", { method: "POST", body: formValues(downloadForm) });
    await loadData();
    renderAdmin();
    setStatus("Download object created.");
  });

  const versionForm = content.querySelector("#versionForm");
  if (versionForm) versionForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = formValues(versionForm);
    const downloadId = Number(values.downloadId);
    delete values.downloadId;
    values.fileId = values.fileId ? Number(values.fileId) : null;
    values.isLatest = Boolean(versionForm.querySelector("[name='isLatest']").checked);
    values.deprecated = Boolean(versionForm.querySelector("[name='deprecated']").checked);
    await api(`/api/downloads/${downloadId}/versions`, { method: "POST", body: values });
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
    values.galleryFileIds = checkedNumbers(productForm, "galleryFileIds");
    values.descriptionFileIds = checkedNumbers(productForm, "descriptionFileIds");
    values.setupFileIds = checkedNumbers(productForm, "setupFileIds");
    values.supportPackIds = checkedNumbers(productForm, "supportPackIds");
    values.relatedProductIds = checkedNumbers(productForm, "relatedProductIds");
    const path = state.editingProductId ? `/api/products/${state.editingProductId}` : "/api/products";
    await api(path, { method: state.editingProductId ? "PUT" : "POST", body: values });
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
    document.querySelector("#inviteResult").innerHTML = linkResult("Invite URL", invite.inviteUrl);
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
    document.querySelector("#supportAccessResult").innerHTML = linkResult("Temporary support link", invite.inviteUrl);
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

refresh().catch((error) => {
  app.innerHTML = `<section class="panel"><h2>Unable to start admin UI</h2><p class="error">${escapeHtml(error.message)}</p></section>`;
});
