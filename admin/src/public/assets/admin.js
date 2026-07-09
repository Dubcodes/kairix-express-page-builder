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
  tab: "overview"
};

const tabs = [
  ["overview", "Overview"],
  ["settings", "Settings"],
  ["categories", "Categories"],
  ["files", "Files"],
  ["downloads", "Downloads"],
  ["packs", "Support packs"],
  ["products", "Products"],
  ["publish", "Publish"],
  ["analytics", "Analytics"],
  ["integrations", "Integrations"],
  ["users", "Users"]
];

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: options.body instanceof FormData ? undefined : { "Content-Type": "application/json" },
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

function downloadLabel(download) {
  return `${download.name} · ${download.type}`;
}

function supportPackIncludes(pack) {
  const ids = new Set((pack.downloadIds || []).map(Number));
  const included = state.downloads.filter((download) => ids.has(Number(download.id)));
  if (!included.length) return "<p class='muted'>No downloads included yet.</p>";
  return `<p class="muted">Includes:</p><ul class="compact-list">${included.map((download) => `<li>${escapeHtml(downloadLabel(download))}</li>`).join("")}</ul>`;
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
    api("/api/support-packs")
  ]);
  state.settings = settings;
  updateAdminTitle(settings);
  state.categories = categories.categories;
  state.products = products.products;
  state.files = files.files;
  state.downloads = downloads.downloads;
  state.packs = packs.packs;
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
    overview: overviewView,
    settings: settingsView,
    categories: categoriesView,
    files: filesView,
    downloads: downloadsView,
    packs: packsView,
    products: productsView,
    publish: publishView,
    analytics: analyticsView,
    integrations: integrationsView,
    users: usersView
  }[state.tab];
  content.innerHTML = view();
  bindTabEvents(content);
}

function overviewView() {
  return `
    <section class="panel">
      <h2>Page Manager overview</h2>
      <p class="muted">Create products, group downloads into support packs, publish the static customer support site, and review basic analytics.</p>
      <div class="actions">
        <button id="sampleBtn" type="button">Create rich sample data</button>
        <a class="action-link" href="/preview/" target="_blank">Open generated preview</a>
      </div>
      <div class="list">
        <div class="item"><h3>${state.categories.length}</h3><p>Categories</p></div>
        <div class="item"><h3>${state.products.length}</h3><p>Products</p></div>
        <div class="item"><h3>${state.downloads.length}</h3><p>Download objects</p></div>
        <div class="item"><h3>${state.packs.length}</h3><p>Support packs</p></div>
      </div>
    </section>
  `;
}

function settingsView() {
  const s = state.settings;
  return `
    <section class="panel">
      <div class="section-heading">
        <h2>Store settings</h2>
        <a class="coffee-icon-link" href="https://buymeacoffee.com/dubcodes" target="_blank" rel="noopener noreferrer" title="Support the developer" aria-label="Support the developer">☕</a>
      </div>
      <form id="settingsForm" class="form-grid">
        <label>Store/brand name<input name="brandName" value="${escapeHtml(s.brandName || "")}"></label>
        <label>Logo<input name="logo" type="file" accept="image/*"></label>
        <label>Main marketplace/store link<input name="marketplaceUrl" value="${escapeHtml(s.marketplaceUrl || "")}"></label>
        <label>Support email<input name="supportEmail" type="email" value="${escapeHtml(s.supportEmail || "")}"></label>
        <label>Support link<input name="supportLink" value="${escapeHtml(s.supportLink || "")}"></label>
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
      <h2>Files</h2>
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
    <div class="grid-two">
      <section class="panel">
        <h2>Download object</h2>
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
      <div class="list">${state.downloads.map((download) => `
        <div class="item">
          <h3>${escapeHtml(download.name)} <span class="pill">${escapeHtml(download.type)}</span></h3>
          <p>${escapeHtml(download.short_description || "")}</p>
          <p class="muted">${download.versions.length} version(s)</p>
        </div>`).join("")}</div>
    </section>
  `;
}

function packsView() {
  return `
    <section class="panel">
      <h2>Support packs</h2>
      <p class="muted">Support packs bundle related downloads together, such as an Android app, Windows software, firmware, manuals, and quick start guides. Products can link to a support pack so customers always see the latest related files.</p>
      <form id="packForm" class="form-grid">
        <label>Name<input name="name" required></label>
        <label class="wide">Description<textarea name="description"></textarea></label>
        <div class="wide"><strong>Downloads included in this support pack</strong>${checkboxes("downloadIds", state.downloads)}</div>
        <button type="submit">Create support pack</button>
      </form>
      <div class="list">${state.packs.map((pack) => `<div class="item"><h3>${escapeHtml(pack.name)}</h3><p>${escapeHtml(pack.description || "")}</p>${supportPackIncludes(pack)}</div>`).join("")}</div>
    </section>
  `;
}

function productsView() {
  return `
    <section class="panel">
      <h2>Create product</h2>
      <form id="productForm" class="form-grid">
        <label>Name<input name="name" required></label>
        <label>SKU<input name="sku"></label>
        <label>Version indicator<input name="versionLabel"></label>
        <label>Category<select name="categoryId"><option value="">None</option>${optionList(state.categories)}</select></label>
        <label class="wide">Marketplace product URL<input name="marketplaceUrl"></label>
        <label class="wide">Short description<textarea name="shortDescription"></textarea></label>
        <label class="wide">Long description<textarea name="longDescription"></textarea></label>
        <label>Status<select name="status"><option value="draft">Draft</option><option value="published">Published</option></select></label>
        <label class="check-row"><input name="featured" type="checkbox"> Featured</label>
        <div class="wide"><strong>Product gallery images</strong>${checkboxes("galleryFileIds", state.files)}</div>
        <div class="wide"><strong>Description images</strong>${checkboxes("descriptionFileIds", state.files)}</div>
        <div class="wide"><strong>App/setup screenshots</strong>${checkboxes("setupFileIds", state.files)}</div>
        <div class="wide"><strong>Support packs</strong>${checkboxes("supportPackIds", state.packs)}</div>
        <div class="wide"><strong>Manual related products</strong>${checkboxes("relatedProductIds", state.products)}</div>
        <button type="submit">Create product</button>
      </form>
    </section>
    <section class="panel">
      <h2>Products</h2>
      <div class="list">${state.products.map((product) => `
        <div class="item">
          <h3>${escapeHtml(product.name)} <span class="pill">${escapeHtml(product.status)}</span></h3>
          <p>${escapeHtml(product.short_description || "")}</p>
          <p class="muted">${escapeHtml(product.category_name || "No category")} ${product.sku ? `- ${escapeHtml(product.sku)}` : ""}</p>
        </div>`).join("")}</div>
    </section>
  `;
}

function publishView() {
  return `
    <section class="panel">
      <h2>Publish static site</h2>
      <p class="muted">Publishing validates structured content, exports build data, copies uploaded files, runs Astro, and writes static files to <code>generated-site</code>.</p>
      <div class="actions">
        <button id="publishBtn" type="button">Publish</button>
        <a class="pill" href="/preview/" target="_blank">Open preview</a>
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
      <h2>Invite user</h2>
      <form id="inviteCreateForm" class="form-grid">
        <label>Email<input name="email" type="email"></label>
        <label>Role<select name="role">${["Read Only", "Analytics Viewer", "File Manager", "Editor", "Publisher", "Admin"].map((role) => `<option>${role}</option>`).join("")}</select></label>
        <label>Expires in hours<input name="expiresHours" type="number" value="48" min="1"></label>
        <button type="submit">Create invite</button>
      </form>
      <p id="inviteResult" class="status"></p>
    </section>
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
    },
    loadAnalyticsBtn: async () => {
      const analytics = await api("/api/analytics");
      document.querySelector("#analyticsOutput").innerHTML = `
        <div class="item"><h3>Totals</h3><pre>${escapeHtml(JSON.stringify(analytics.totals, null, 2))}</pre></div>
        <div class="item"><h3>Recent events</h3><pre>${escapeHtml(JSON.stringify(analytics.recent, null, 2))}</pre></div>
      `;
    }
  };
  for (const [id, handler] of Object.entries(handlers)) {
    const element = content.querySelector(`#${id}`);
    if (element) element.addEventListener("click", () => handler().catch((error) => setStatus(error.message, true)));
  }

  const settingsForm = content.querySelector("#settingsForm");
  if (settingsForm) settingsForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await api("/api/settings", { method: "PUT", body: new FormData(settingsForm) });
    await loadData();
    renderAdmin();
    setStatus("Settings saved.");
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
    await api("/api/support-packs", { method: "POST", body: values });
    await loadData();
    renderAdmin();
    setStatus("Support pack created.");
  });

  const productForm = content.querySelector("#productForm");
  if (productForm) productForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = formValues(productForm);
    values.categoryId = values.categoryId ? Number(values.categoryId) : null;
    values.featured = Boolean(productForm.querySelector("[name='featured']").checked);
    values.galleryFileIds = checkedNumbers(productForm, "galleryFileIds");
    values.descriptionFileIds = checkedNumbers(productForm, "descriptionFileIds");
    values.setupFileIds = checkedNumbers(productForm, "setupFileIds");
    values.supportPackIds = checkedNumbers(productForm, "supportPackIds");
    values.relatedProductIds = checkedNumbers(productForm, "relatedProductIds");
    await api("/api/products", { method: "POST", body: values });
    await loadData();
    renderAdmin();
    setStatus("Product created.");
  });

  const inviteCreateForm = content.querySelector("#inviteCreateForm");
  if (inviteCreateForm) inviteCreateForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = formValues(inviteCreateForm);
    values.expiresHours = Number(values.expiresHours || 48);
    const invite = await api("/api/invites", { method: "POST", body: values });
    document.querySelector("#inviteResult").innerHTML = `Invite URL: <a href="${invite.inviteUrl}">${invite.inviteUrl}</a>`;
  });
}

logoutBtn.addEventListener("click", async () => {
  await api("/api/logout", { method: "POST", body: {} });
  state.me = null;
  await refresh();
});

refresh().catch((error) => {
  app.innerHTML = `<section class="panel"><h2>Unable to start admin UI</h2><p class="error">${escapeHtml(error.message)}</p></section>`;
});
