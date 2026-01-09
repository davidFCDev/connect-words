// Custom build script that disables property mangling
// This prevents minification from breaking class method references

import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Import the build function from remix-dev
const buildServicePath = path.join(
  __dirname,
  "node_modules/@insidethesim/remix-dev/dist/cli/build-service.js"
);

async function main() {
  try {
    // Convert Windows path to file:// URL for ESM import
    const buildServiceUrl = pathToFileURL(buildServicePath).href;
    const { buildGame } = await import(buildServiceUrl);

    console.log("Building with property mangling disabled...\n");

    const result = await buildGame({
      minification: true, // Keep minification for smaller bundle
      mangling: false, // Disable property mangling to preserve method names
    });

    if (!result.success) {
      console.error("Build failed:", result.error);
      if (result.details) {
        for (const detail of result.details) {
          console.error("  -", detail.text);
        }
      }
      process.exit(1);
    }

    console.log(`Build completed in ${result.buildTime}ms`);

    if (result.fileSize) {
      const sizeKB = (result.fileSize / 1024).toFixed(2);
      console.log(`Output: dist/index.html (${sizeKB} KB)`);
    }

    if (result.sdkIntegration) {
      const status = result.sdkIntegration.integrated
        ? "Integrated"
        : "Not integrated";
      console.log(
        `SDK: ${status} (${result.sdkIntegration.passedChecks}/${result.sdkIntegration.totalChecks} checks)`
      );
    }
  } catch (error) {
    console.error("Build error:", error);
    process.exit(1);
  }
}

main();
