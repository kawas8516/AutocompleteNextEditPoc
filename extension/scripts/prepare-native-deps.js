// vsce's automatic node_modules dependency-walk gets confused by this repo's
// npm workspace hoisting (it tries to include the whole hoisted root
// node_modules via "../node_modules/..." paths, plus unrelated root-level
// repo files - verified empirically). We package with
// `vsce package --no-dependencies` (see package.json's "package" script),
// which excludes node_modules unconditionally (also verified empirically -
// .vscodeignore negation patterns cannot override this), and instead
// manually inject exactly the files sqlite3 needs at runtime directly into
// the produced .vsix afterward (see scripts/inject-native-deps.ps1).
//
// This script prepares that curated file set under extension/node_modules,
// copying ONLY what's actually required() at runtime - not sqlite3's build
// tooling (node-addon-api headers, the bundled SQLite C source tarball,
// minipass/tar/prebuild-install used only during `npm install`). Verified
// by reading sqlite3's own require() chain directly:
//   lib/sqlite3.js -> path, events, ./sqlite3-binding.js, ./trace
//   lib/sqlite3-binding.js -> require('bindings')('node_sqlite3.node')
//   bindings -> fs, path, (own package code, no further deps)
//   file-uri-to-path -> used internally by bindings for file:// URIs
const fs = require("fs");
const path = require("path");

const ROOT_NODE_MODULES = path.resolve(__dirname, "..", "..", "node_modules");
const LOCAL_NODE_MODULES = path.resolve(__dirname, "..", "node_modules");

function copyPath(pkg, relPath) {
  const src = path.join(ROOT_NODE_MODULES, pkg, relPath);
  const dest = path.join(LOCAL_NODE_MODULES, pkg, relPath);
  if (!fs.existsSync(src)) {
    throw new Error(
      `prepare-native-deps: expected ${src} to exist (run "npm install" at the repo root first).`,
    );
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
}

function copyWholePackage(pkg) {
  const src = path.join(ROOT_NODE_MODULES, pkg);
  const dest = path.join(LOCAL_NODE_MODULES, pkg);
  if (!fs.existsSync(src)) {
    throw new Error(
      `prepare-native-deps: expected ${src} to exist (run "npm install" at the repo root first).`,
    );
  }
  fs.cpSync(src, dest, { recursive: true });
}

for (const pkg of ["sqlite3", "bindings", "file-uri-to-path"]) {
  fs.rmSync(path.join(LOCAL_NODE_MODULES, pkg), {
    recursive: true,
    force: true,
  });
}

// sqlite3: only the JS entry points, package.json (needed for module
// resolution), LICENSE, and the prebuilt native binary for this platform -
// not the C source tarball / build tooling under deps/ and
// node_modules/{node-addon-api,minipass} that sqlite3's own package.json
// declares as "dependencies" (npm doesn't distinguish install-time-only
// tooling from runtime deps in that field) but which are never require()'d
// once a binary is compiled.
copyPath("sqlite3", "package.json");
copyPath("sqlite3", "LICENSE");
copyPath("sqlite3", "lib");
copyPath("sqlite3", "build/Release/node_sqlite3.node");

// bindings + file-uri-to-path: small pure-JS packages, nothing to trim.
copyWholePackage("bindings");
copyWholePackage("file-uri-to-path");

console.log(
  "prepare-native-deps: copied sqlite3 (runtime files only), bindings, file-uri-to-path",
);
