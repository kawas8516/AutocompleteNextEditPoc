// Minimal esbuild bundle script for the extension entry point.
// Bundles extension/src/extension.ts (plus everything it imports from
// core/) into a single CommonJS file the VS Code extension host can load,
// external-izing the `vscode` module which only exists inside the host.
const esbuild = require("esbuild");

// `npm run build` (dev/F5) keeps sourcemaps for debugging and skips
// minification for fast, readable builds. `npm run build:prod` (used ahead
// of `vsce package`) drops the sourcemap entirely (no reason to ship a
// 10MB+ .map in a VSIX) and minifies, shrinking the packaged bundle.
const isProd =
  process.env.NODE_ENV === "production" || process.argv.includes("--production");

esbuild
  .build({
    entryPoints: ["src/extension.ts"],
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    outfile: "dist/extension.js",
    // "vscode" only exists inside the extension host. The AWS/Google SDKs
    // are pulled in transitively by core/llm/openai-adapters' Bedrock/VertexAI
    // adapters, which this extension's runtime can never reach (it always
    // constructs OpenRouter with providerName "openrouter" - see
    // core/llm/openai-adapters/index.ts's lazy require() for those two
    // cases). Marking them external keeps them out of the bundle entirely
    // without risk: the require() calls that would need them are
    // structurally unreachable here.
    //
    // "sqlite3" is external for a different, correctness reason: it's a
    // native addon whose "bindings" loader locates its prebuilt .node binary
    // via stack-trace-based caller-file detection. esbuild's single-file
    // bundle output collapses every module's __filename into one, which
    // defeats that detection and breaks the autocomplete result cache at
    // runtime. Leaving it external (a real require() resolved against the
    // physically-shipped node_modules/sqlite3 - see extension/package.json's
    // own "sqlite3" dependency) keeps its native-binding resolution intact.
    external: [
      "vscode",
      "@aws-sdk/client-bedrock-runtime",
      "@aws-sdk/credential-providers",
      "google-auth-library",
      "sqlite3",
    ],
    sourcemap: !isProd,
    minify: isProd,
    logLevel: "info",
  })
  .catch(() => process.exit(1));
