import * as esbuild from "esbuild";
import { mkdirSync, copyFileSync, rmSync, chmodSync, watch } from "node:fs";

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

if (serve) {
  watch("src/web", (_, filename) => {
    if (assets.includes(filename)) copyFileSync(`src/web/${filename}`, `dist/web/${filename}`);
  });
  const ctx = await esbuild.context(webOptions);
  await ctx.watch();
  const { host, port } = await ctx.serve({ servedir: "dist/web", port: 8080 });
  console.log(`Serving chat2archive web UI at http://${host === "0.0.0.0" ? "localhost" : host}:${port}`);
} else {
  await esbuild.build(webOptions);
  console.log("Built dist/cli/, dist/core/, and dist/web/");
}
