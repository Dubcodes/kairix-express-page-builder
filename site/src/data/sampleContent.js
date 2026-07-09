export const sampleContent = {
  generatedAt: new Date().toISOString(),
  publicBaseUrl: "http://localhost:4321",
  siteBasePath: "/preview",
  adminBaseUrl: "http://localhost:8080",
  settings: {
    brandName: "Kairix Demo Support",
    logo: "",
    marketplaceUrl: "https://example.com/store",
    introText: "Find product information, manuals, apps, firmware and support downloads.",
    supportEmail: "support@example.com",
    supportLink: "https://example.com/support",
    theme: "clean-light",
    defaultMarketplaceLabel: "Buy on AliExpress",
    footerText: "Demo content. Replace from the admin panel."
  },
  categories: [
    {
      id: 1,
      name: "Smart Controllers",
      slug: "smart-controllers",
      description: "Sample category for local testing.",
      products: []
    }
  ],
  products: [
    {
      id: 1,
      name: "Demo Bluetooth Controller",
      slug: "demo-bluetooth-controller",
      sku: "KX-CTRL-001",
      version_label: "v1 hardware",
      category_id: 1,
      category_name: "Smart Controllers",
      category_slug: "smart-controllers",
      marketplace_url: "https://example.com/listing",
      short_description: "A fake product used to test the support portal workflow.",
      long_description: "<p>This static page was generated from structured content.</p>",
      featured: 1,
      image: "",
      gallery: [],
      descriptionImages: [],
      setupImages: [],
      downloads: [
        {
          id: 1,
          name: "Controller Mobile App",
          slug: "controller-mobile-app",
          type: "Android",
          short_description: "Sample Android app link.",
          latest: {
            version_number: "1.0.0",
            release_date: "2026-01-01",
            download_url: "https://example.com/app",
            release_notes: "Initial demo release."
          }
        }
      ],
      related: [],
      support_qr: "",
      marketplace_qr: ""
    }
  ],
  downloads: [
    {
      id: 1,
      name: "Controller Mobile App",
      slug: "controller-mobile-app",
      type: "Android",
      short_description: "Sample Android app link.",
      latest: {
        version_number: "1.0.0",
        release_date: "2026-01-01",
        download_url: "https://example.com/app",
        release_notes: "Initial demo release."
      },
      versions: [
        {
          id: 1,
          version_number: "1.0.0",
          release_date: "2026-01-01",
          platform: "Android",
          download_url: "https://example.com/app",
          release_notes: "Initial demo release.",
          deprecated: 0
        }
      ]
    }
  ],
  supportPacks: []
};

sampleContent.categories[0].products = sampleContent.products;
