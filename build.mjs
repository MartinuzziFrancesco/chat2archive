import * as esbuild from "esbuild";
import { mkdirSync, copyFileSync, rmSync, chmodSync, readFileSync, writeFileSync, watch } from "node:fs";
import { marked } from "marked";

const serve = process.argv.includes("--serve");

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist/web", { recursive: true });

const webOptions = {
  entryPoints: ["src/web/main.ts"],
  outfile: "dist/web/bundle.js",
  platform: "browser",
  format: "esm",
  target: "es2022",
  bundle: true,
  sourcemap: true,
};

await esbuild.build({
  entryPoints: ["src/cli/index.ts", "src/core/index.ts"],
  outdir: "dist",
  outbase: "src",
  platform: "node",
  format: "esm",
  target: "node18",
  bundle: true,
  packages: "external",
});
chmodSync("dist/cli/index.js", 0o755);

const assets = ["index.html", "style.css", "logo.svg"];
for (const asset of assets) copyFileSync(`src/web/${asset}`, `dist/web/${asset}`);

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// Renders docs/AIR-0.1.md into a standalone page at the same URL depth as
// index.html, styled with the site's own stylesheet, with a generated
// table of contents — so the format spec is something people can browse
// and link into directly, not just a file they have to find in the repo.
function buildSpecPage() {
  const source = readFileSync("docs/AIR-0.1.md", "utf-8");
  let body = marked.parse(source);

  const toc = [];
  body = body.replace(/<h([1-3])>(.*?)<\/h\1>/g, (match, level, inner) => {
    const text = inner.replace(/<[^>]+>/g, "");
    const slug = slugify(text);
    if (level !== "1") toc.push({ level: Number(level), slug, text });
    return `<h${level} id="${slug}">${inner}</h${level}>`;
  });

  const tocHtml = toc
    .map((h) => `<li class="toc-level-${h.level}"><a href="#${h.slug}">${h.text}</a></li>`)
    .join("\n");

  const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AIR 0.1 format specification — chat2archive</title>
<meta name="description" content="The AIR (AI Interaction Record) 0.1 protocol: an RO-Crate profile for archiving one AI conversation as a provider-neutral, citable research object.">
<link rel="icon" href="logo.svg" type="image/svg+xml">
<link rel="stylesheet" href="style.css">
</head>
<body>
<main class="page spec-page">
  <a class="back-link" href="index.html">← chat2archive</a>
  <div class="spec-layout">
    <nav class="toc" aria-label="Sections">
      <span class="toc-heading">Contents</span>
      <ul>${tocHtml}</ul>
    </nav>
    <article class="prose">
${body}
    </article>
  </div>
  <footer>
    <nav aria-label="Project resources">
    <a href="index.html">chat2archive</a> ·
    <a href="https://github.com/MartinuzziFrancesco/chat2archive/blob/main/docs/AIR-0.1.md">view source on GitHub</a> ·
    <a href="https://github.com/MartinuzziFrancesco/chat2archive">GitHub</a>
    </nav>
  </footer>
</main>
</body>
</html>
`;
  writeFileSync("dist/web/spec.html", page);
}

buildSpecPage();

if (serve) {
  watch("src/web", (_, filename) => {
    if (assets.includes(filename)) copyFileSync(`src/web/${filename}`, `dist/web/${filename}`);
  });
  watch("docs/AIR-0.1.md", () => buildSpecPage());
  const ctx = await esbuild.context(webOptions);
  await ctx.watch();
  const { host, port } = await ctx.serve({ servedir: "dist/web", port: 8080 });
  console.log(`Serving chat2archive web UI at http://${host === "0.0.0.0" ? "localhost" : host}:${port}`);
} else {
  await esbuild.build(webOptions);
  console.log("Built dist/cli/, dist/core/, and dist/web/");
}
