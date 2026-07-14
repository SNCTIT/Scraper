import fs from "fs";
import crypto from "crypto";

const SITE = "https://snct.lu";
const POST_TYPES = ["pages"];
const OUTPUT_PATH = "./data/catalog.json";

// Slugs to skip entirely (test pages, drafts left public, interactive
// widgets with no real static content, etc.) — the slug is the last part
// of the URL, e.g. "test" for https://snct.lu/de/test/
const EXCLUDE_SLUGS = [
  "test",
  "addresses-and-opening-hours-map",
  "adressen-und-offnungszeiten-map",
  "adresses-et-horaires-map",
  "catalog-of-sanctions",
  "katalog-der-sanktionspunkte",
  "catalogue-des-sanctions",
];

function stripHtml(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#8217;/g, "'")
    .replace(/&#8220;|&#8221;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function detectLanguageFromUrl(link) {
  try {
    const path = new URL(link).pathname;
    if (path.startsWith("/en/")) return "en";
    if (path.startsWith("/de/")) return "de";
    return "fr"; // French has no URL prefix on this site
  } catch {
    return "fr";
  }
}

async function fetchAllForType(type) {
  const results = [];
  let page = 1;

  while (true) {
    // NOTE: we deliberately do NOT pass ?lang=... here — on this site it
    // does not actually filter results (confirmed: querying with lang=en,
    // fr, and de each returned the same full 54-page set). Instead we
    // fetch everything once and detect the language from the URL prefix.
    const url = `${SITE}/wp-json/wp/v2/${type}?per_page=100&page=${page}&_fields=id,slug,title,content,link`;
    const res = await fetch(url);

    if (!res.ok) {
      break;
    }

    const items = await res.json();
    if (!Array.isArray(items) || items.length === 0) break;

    for (const item of items) {
      if (EXCLUDE_SLUGS.includes(item.slug)) continue;

      const title = stripHtml(item.title?.rendered || "");
      const content = stripHtml(item.content?.rendered || "");
      if (!content) continue;

      const lang = detectLanguageFromUrl(item.link);

      results.push({
        id: crypto
          .createHash("md5")
          .update(`site-${type}-${item.id}`)
          .digest("hex"),
        language: lang,
        type: type === "pages" ? "page" : "post",
        title,
        description: title ? `${title}. ${content}` : content,
        url: item.link,
        severity: null,
      });
    }

    page++;
  }

  return results;
}

async function main() {
  let siteContent = [];

  for (const type of POST_TYPES) {
    console.log(`Fetching ${type}...`);
    const items = await fetchAllForType(type);
    console.log(`  Found ${items.length} ${type}`);
    siteContent = siteContent.concat(items);
  }

  let existing = [];
  if (fs.existsSync(OUTPUT_PATH)) {
    existing = JSON.parse(fs.readFileSync(OUTPUT_PATH, "utf-8"));
  }

  const currentSiteIds = new Set(siteContent.map((entry) => entry.id));
  const keptExisting = existing.filter((entry) =>
    entry.type !== "page" && entry.type !== "post"
      ? true
      : currentSiteIds.has(entry.id),
  );

  const merged = [...keptExisting, ...siteContent];

  fs.mkdirSync("./data", { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(merged, null, 2));

  console.log(`\nSaved ${merged.length} total entries to ${OUTPUT_PATH}`);
  console.log(
    `  (${siteContent.length} from site pages/posts, ${keptExisting.length} carried over from other sources)`,
  );
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
