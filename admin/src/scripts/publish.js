import { publishSite } from "../services/publish.js";

publishSite()
  .then((result) => {
    console.log(result.message);
    console.log(`Output: ${result.outputDir}`);
  })
  .catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
