import sanitizeHtml from "sanitize-html";
import QRCode from "qrcode";
import { db, getSettings } from "../db.js";
import { config } from "../config.js";

const textTags = [];
const richTags = ["p", "br", "strong", "b", "em", "i", "ul", "ol", "li", "a", "h2", "h3", "blockquote", "code", "pre"];

function clean(value, rich = false) {
  return sanitizeHtml(value || "", {
    allowedTags: rich ? richTags : textTags,
    allowedAttributes: {
      a: ["href", "target", "rel"]
    },
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", { rel: "nofollow noopener", target: "_blank" })
    }
  });
}

function fileUrl(file) {
  if (!file) return null;
  return `/uploads/${file.stored_name}`;
}

function sitePath(value) {
  if (!value) return "";
  const base = String(config.publicSiteBasePath || "").trim().replace(/\/+$/, "");
  const path = String(value).startsWith("/") ? String(value) : `/${value}`;
  if (!base) return path;
  if (path === "/") return `${base}/`;
  return `${base}${path}`.replace(/\/{2,}/g, "/");
}

async function qrDataUrl(value) {
  if (!value) return null;
  return QRCode.toDataURL(value, { margin: 1, width: 220 });
}

function latestVersion(downloadId) {
  return db.prepare(`
    SELECT v.*, f.stored_name, f.original_name, f.mime_type, f.size
    FROM download_versions v
    LEFT JOIN files f ON f.id = v.file_id
    WHERE v.download_id = ?
    ORDER BY v.is_latest DESC, date(v.release_date) DESC, v.id DESC
    LIMIT 1
  `).get(downloadId);
}

export async function buildExportData() {
  const settings = getSettings();
  const categories = db.prepare("SELECT * FROM categories ORDER BY name").all();
  const files = db.prepare("SELECT * FROM files").all();
  const filesById = new Map(files.map((file) => [file.id, file]));

  const downloads = db.prepare("SELECT * FROM download_objects ORDER BY type, name").all().map((download) => {
    const versions = db.prepare(`
      SELECT v.*, f.stored_name, f.original_name, f.mime_type, f.size
      FROM download_versions v
      LEFT JOIN files f ON f.id = v.file_id
      WHERE v.download_id = ?
      ORDER BY v.is_latest DESC, date(v.release_date) DESC, v.id DESC
    `).all(download.id).map((version) => ({
      ...version,
      release_notes: clean(version.release_notes, true),
      download_url: version.external_url || (version.stored_name ? `/uploads/${version.stored_name}` : null)
    }));
    return {
      ...download,
      short_description: clean(download.short_description),
      versions,
      latest: versions[0] || null
    };
  });
  const downloadsById = new Map(downloads.map((download) => [download.id, download]));

  const supportPacks = db.prepare("SELECT * FROM support_packs ORDER BY name").all().map((pack) => {
    const packDownloads = db.prepare(`
      SELECT d.id FROM download_objects d
      JOIN support_pack_downloads spd ON spd.download_id = d.id
      WHERE spd.support_pack_id = ?
      ORDER BY d.type, d.name
    `).all(pack.id).map((row) => downloadsById.get(row.id)).filter(Boolean);
    return { ...pack, description: clean(pack.description), downloads: packDownloads };
  });
  const supportPacksById = new Map(supportPacks.map((pack) => [pack.id, pack]));

  const productRows = db.prepare(`
    SELECT p.*, c.name AS category_name, c.slug AS category_slug
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.status = 'published'
    ORDER BY p.featured DESC, p.updated_at DESC
  `).all();

  const products = [];
  for (const product of productRows) {
    const imageRows = db.prepare(`
      SELECT pi.kind, pi.sort_order, f.*
      FROM product_images pi
      JOIN files f ON f.id = pi.file_id
      WHERE pi.product_id = ?
      ORDER BY pi.kind, pi.sort_order, pi.id
    `).all(product.id);
    const gallery = imageRows.filter((row) => row.kind === "gallery").map(fileUrl).filter(Boolean);
    const descriptionImages = imageRows.filter((row) => row.kind === "description").map(fileUrl).filter(Boolean);
    const setupImages = imageRows.filter((row) => row.kind === "setup").map(fileUrl).filter(Boolean);
    const packRows = db.prepare("SELECT support_pack_id FROM product_support_packs WHERE product_id = ?").all(product.id);
    const packs = packRows.map((row) => supportPacksById.get(row.support_pack_id)).filter(Boolean);
    const directLocks = db.prepare("SELECT * FROM product_download_locks WHERE product_id = ?").all(product.id);
    const lockedDownloads = directLocks.map((lock) => {
      const download = downloadsById.get(lock.download_id);
      if (!download) return null;
      if (!lock.version_id) return { ...download, locked_version: null };
      const version = download.versions.find((item) => item.id === lock.version_id) || null;
      return { ...download, latest: version || download.latest, locked_version: version };
    }).filter(Boolean);
    const packDownloads = packs.flatMap((pack) => pack.downloads || []);
    const relatedManual = db.prepare(`
      SELECT rp.related_product_id
      FROM related_products rp
      WHERE rp.product_id = ?
      ORDER BY rp.sort_order, rp.related_product_id
    `).all(product.id).map((row) => productRows.find((candidate) => candidate.id === row.related_product_id)).filter(Boolean);
    const relatedAuto = productRows
      .filter((candidate) => candidate.id !== product.id && candidate.category_id === product.category_id)
      .slice(0, 4);
    const related = [...relatedManual, ...relatedAuto.filter((auto) => !relatedManual.some((manual) => manual.id === auto.id))]
      .slice(0, 6)
      .map((item) => ({
        id: item.id,
        name: item.name,
        slug: item.slug,
        sku: item.sku,
        short_description: clean(item.short_description),
        image: fileUrl(filesById.get(db.prepare("SELECT file_id FROM product_images WHERE product_id = ? ORDER BY sort_order LIMIT 1").get(item.id)?.file_id))
      }));

    const productUrl = `${config.publicBaseUrl.replace(/\/$/, "")}${sitePath(`/products/${product.slug}/`)}`;
    products.push({
      ...product,
      short_description: clean(product.short_description),
      long_description: clean(product.long_description, true),
      image: gallery[0] || null,
      gallery,
      descriptionImages,
      setupImages,
      supportPacks: packs,
      downloads: [...lockedDownloads, ...packDownloads.filter((download) => !lockedDownloads.some((locked) => locked.id === download.id))],
      related,
      public_url: productUrl,
      support_qr: await qrDataUrl(productUrl),
      marketplace_qr: await qrDataUrl(product.marketplace_url)
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    publicBaseUrl: config.publicBaseUrl,
    siteBasePath: config.publicSiteBasePath,
    adminBaseUrl: config.adminBaseUrl,
    settings: {
      brandName: settings.brandName || "Kairix Support",
      logo: settings.logo || "",
      marketplaceUrl: settings.marketplaceUrl || "",
      introText: clean(settings.introText || "Find product information, manuals, apps, firmware and support downloads."),
      supportEmail: settings.supportEmail || "",
      supportLink: settings.supportLink || "",
      theme: settings.theme || "clean-light",
      defaultMarketplaceLabel: settings.defaultMarketplaceLabel || "Buy on AliExpress",
      footerText: clean(settings.footerText || "")
    },
    categories: categories.map((category) => ({
      ...category,
      description: clean(category.description),
      products: products.filter((product) => product.category_id === category.id)
    })),
    products,
    downloads,
    supportPacks
  };
}
