import { execSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { extname, join } from "node:path";

const siteDirectory = "site";

function copyDir(src, dest) {
  if (!existsSync(dest)) {
    mkdirSync(dest, { recursive: true });
  }
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}

// Copy non-markdown directories from docs/ into site/ (mkdocs only processes .md files)
for (const dir of ["examples", "dist", "viewer"]) {
  const src = join("docs", dir);
  const dest = join(siteDirectory, dir);
  if (existsSync(src)) {
    copyDir(src, dest);
    console.log(`Copied ${src} → ${dest}`);
  }
}

const oldAssets = join(siteDirectory, "assets");
const newAssets = join(siteDirectory, "static");

// Rename assets directory
console.log(`Renaming ${oldAssets} → ${newAssets}...`);
renameSync(oldAssets, newAssets);
replaceInHtmlFiles(siteDirectory);

function replaceInHtmlFiles(dir) {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      replaceInHtmlFiles(fullPath);
    } else if (stat.isFile() && extname(fullPath) === ".html") {
      const html = readFileSync(fullPath, "utf-8");

      // Replace relative/local asset references ONLY (exclude external URLs like https://sparkjs.dev/..)
      const updated = html.replace(
        /(["'(=])((?:\.\.\/)*|\.\/|\/)assets\//g,
        (_, prefix, rel) => `${prefix}${rel}static/`,
      );
      if (updated !== html) {
        writeFileSync(fullPath, updated);
      }
    }
  }
}

// Copy Azure Static Web Apps config if it exists
const swaConfig = "staticwebapp.config.json";
try {
  copyFileSync(swaConfig, join(siteDirectory, swaConfig));
  console.log(`Copied ${swaConfig} to ${siteDirectory}/`);
} catch {
  // Config file is optional - skip if not present
}
