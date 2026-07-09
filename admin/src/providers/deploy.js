import fs from "fs-extra";
import { config } from "../config.js";

export class LocalDeployProvider {
  async deploy() {
    await fs.ensureDir(config.generatedSiteDir);
    return {
      provider: "local",
      outputDir: config.generatedSiteDir,
      message: "Static site generated locally."
    };
  }
}

export class CloudflarePagesDeployProvider {
  async deploy() {
    throw new Error("Cloudflare Pages Direct Upload is a placeholder for a later iteration.");
  }
}
