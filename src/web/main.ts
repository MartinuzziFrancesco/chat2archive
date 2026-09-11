import { importAny } from "../importers/detect.js";
import { buildPackage, zipPackage } from "../core/package.js";
import type { AirRecord, ImportResult } from "../core/model.js";

// The Worker that fetches public ChatGPT share pages (GitHub Pages can't do
// this itself — no server, and the browser can't read a cross-origin fetch
// of chatgpt.com directly). Deploy src/worker/ with wrangler, then replace
// this with the URL it prints. See README.md "Share-link support".
const SHARE_API_URL = "https://chat2archive-share.martinuzzi-francesco.workers.dev/api/share";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const form = $<HTMLFormElement>("convert-form");
const pasteInput = $<HTMLTextAreaElement>("paste-input");
const fileInput = $<HTMLInputElement>("file-input");
const dropzone = $<HTMLLabelElement>("dropzone");
const dropzoneFilename = $<HTMLSpanElement>("dropzone-filename");
const clearFileBtn = $<HTMLButtonElement>("clear-file-btn");
const createBtn = $<HTMLButtonElement>("create-btn");
const errorBox = $<HTMLParagraphElement>("error-box");
const result = $<HTMLElement>("result");
const downloadLink = $<HTMLAnchorElement>("download-link");
const copyHashBtn = $<HTMLButtonElement>("copy-hash-btn");

let lastDownloadUrl: string | null = null;

function updateDropzoneFilename(): void {
  const file = fileInput.files?.[0];
  dropzoneFilename.hidden = !file;
  clearFileBtn.hidden = !file;
  dropzoneFilename.textContent = file ? file.name : "";
}

fileInput.addEventListener("change", updateDropzoneFilename);
clearFileBtn.addEventListener("click", () => {
  fileInput.value = "";
  updateDropzoneFilename();
  fileInput.focus();
});

for (const eventName of ["dragenter", "dragover"]) {
  dropzone.addEventListener(eventName, (e) => {
    e.preventDefault();
    dropzone.classList.add("drag-active");
  });
}
for (const eventName of ["dragleave", "dragend"]) {
  dropzone.addEventListener(eventName, () => dropzone.classList.remove("drag-active"));
}
dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropzone.classList.remove("drag-active");
  const dropped = e.dataTransfer?.files;
  if (dropped && dropped.length > 0) {
    fileInput.files = dropped;
    updateDropzoneFilename();
  }
});

copyHashBtn.addEventListener("click", async () => {
  const hash = $<HTMLElement>("meta-hash").dataset.fullHash;
  if (!hash) return;
  try {
    await navigator.clipboard.writeText(hash);
    copyHashBtn.textContent = "Copied";
    setTimeout(() => (copyHashBtn.textContent = "Copy"), 1500);
  } catch {
    $<HTMLElement>("meta-hash").textContent = hash;
    copyHashBtn.textContent = "Select hash to copy";
  }
});

function showError(message: string): void {
  errorBox.textContent = message;
  errorBox.hidden = false;
}

function collectMetadataOverrides(record: AirRecord): AirRecord {
  const title = $<HTMLInputElement>("meta-title").value.trim();
  const creator = $<HTMLInputElement>("meta-creator").value.trim();
  const orcid = $<HTMLInputElement>("meta-orcid").value.trim();
  const license = $<HTMLInputElement>("meta-license").value.trim();
  const keywords = $<HTMLInputElement>("meta-keywords").value.trim();
  const relatedDoi = $<HTMLInputElement>("meta-related-doi").value.trim();
  const description = $<HTMLTextAreaElement>("meta-description").value.trim();

  return {
    ...record,
    title: title || record.title,
    license: license || record.license,
    description: description || record.description,
    keywords: keywords ? keywords.split(",").map((k) => k.trim()).filter(Boolean) : record.keywords,
    creator: creator ? [{ name: creator, orcid: orcid || null }] : record.creator,
    related: relatedDoi
      ? [...record.related, { relation: "relatedPublication" as const, identifier: relatedDoi }]
      : record.related,
  };
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorBox.hidden = true;
  errorBox.textContent = "";
  result.hidden = true;
  if (lastDownloadUrl) URL.revokeObjectURL(lastDownloadUrl);
  lastDownloadUrl = null;
  form.setAttribute("aria-busy", "true");

  createBtn.disabled = true;
  createBtn.textContent = "Creating…";
  try {
    const file = fileInput.files?.[0] ?? null;
    const pasted = pasteInput.value.trim();

    let imported;
    if ((fileInput.files?.length ?? 0) > 1) {
      throw new Error("Choose one export file at a time.");
    }
    if (file && pasted) {
      throw new Error("Choose one source: remove the selected file or clear the pasted transcript.");
    }
    if (file) {
      imported = importAny(new Uint8Array(await file.arrayBuffer()));
    } else if (/^https?:\/\//i.test(pasted)) {
      let response: Response;
      try {
        response = await fetch(
          `${SHARE_API_URL}?url=${encodeURIComponent(pasted)}`,
          { signal: AbortSignal.timeout(35_000) }
        );
      } catch {
        throw new Error("Could not reach the share-link service. Check your connection, or use an official export instead.");
      }
      if (!response.headers.get("content-type")?.includes("application/json")) {
        throw new Error("The share-link service is unavailable right now. Use an official export instead.");
      }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not fetch the shared conversation.");
      imported = data as ImportResult;
    } else if (pasted) {
      imported = importAny(pasted, { sourceUri: null });
    } else {
      throw new Error("Paste a transcript or choose an export file first.");
    }

    const record = collectMetadataOverrides(imported.record);
    const built = await buildPackage(record);
    const zipBytes = zipPackage(built);

    const blob = new Blob([zipBytes as BlobPart], { type: "application/zip" });
    lastDownloadUrl = URL.createObjectURL(blob);
    downloadLink.href = lastDownloadUrl;
    const slug = built.record.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60) || "air-record";
    downloadLink.download = `${slug}.zip`;

    $("archive-title").textContent = built.record.title;
    const warnings = [...imported.warnings.map((warning) => warning.message), ...built.warnings];
    $("warnings").hidden = warnings.length === 0;
    $("warning-list").replaceChildren(...warnings.map((warning) => {
      const item = document.createElement("li");
      item.textContent = warning;
      return item;
    }));
    copyHashBtn.textContent = "Copy";
    $("stat-messages").textContent = String(built.stats.messageCount);
    $("stat-branches").textContent = String(built.stats.branchCount);
    $("stat-attachments").textContent = String(built.stats.attachmentCount);
    $("meta-provider").textContent = built.record.provider ?? "unknown";
    $("meta-model").textContent = built.record.agents[0]?.model.name ?? "unknown";
    $("meta-evidence").textContent = built.record.agents[0]?.model.evidence ?? "unknown";
    $("meta-capture").textContent = `${built.record.capture.class} — ${captureLabel(built.record.capture.class)}`;
    const hashEl = $<HTMLElement>("meta-hash");
    hashEl.textContent = `${built.record.canonical_sha256?.slice(0, 16)}…`;
    hashEl.dataset.fullHash = built.record.canonical_sha256 ?? "";

    result.hidden = false;
    result.focus({ preventScroll: true });
    result.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" });
  } catch (err) {
    showError(err instanceof Error ? err.message : String(err));
  } finally {
    createBtn.disabled = false;
    createBtn.innerHTML = 'Create archive <span aria-hidden="true">↗</span>';
    form.removeAttribute("aria-busy");
  }
});

function captureLabel(cls: string): string {
  const labels: Record<string, string> = {
    "AIR-C0": "pasted transcript",
    "AIR-C1": "public share URL",
    "AIR-C2": "official provider export",
    "AIR-C3": "authenticated API/provider record",
    "AIR-C4": "signed record",
  };
  return labels[cls] ?? "unknown";
}
