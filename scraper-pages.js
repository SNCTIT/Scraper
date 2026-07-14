// scrape-pages.js
//
// Pulls all published Pages (and optionally Posts) from the SNCT WordPress
// site via its native REST API, in all three languages (Polylang), strips
// the HTML down to plain text, and merges the result into the same
// data/catalog.json already produced by scraper.js — so the WordPress
// plugin only ever needs to sync from one URL.
//
// Usage: node scrape-pages.js

import fs from "fs";
import crypto from "crypto";

const SITE = "https://snct.lu";
const POST_TYPES = ["pages"]; // add "posts" here too if the site has a blog you want included
const OUTPUT_PATH = "./data/catalog.json";

// Slugs to skip entirely (test pages, drafts left public, interactive
// widgets with no real static content, etc.) — the slug is the last part
// of the URL, e.g. "test" for https://snct.lu/de/test/
const EXCLUDE_SLUGS = [
  "test",
  // Interactive map widgets — their real content (addresses) loads via
  // JavaScript/AJAX after page load, so the REST API only returns UI
  // chrome (buttons, "Loading...", filters) with no useful information.
  // The plain-list address pages below cover the same information as
  // real text instead.
  "addresses-and-opening-hours-map",
  "adressen-und-offnungszeiten-map",
  "adresses-et-horaires-map",
  // Full sanctions catalog pages — this is the entire regulation
  // nomenclature as one giant block of text per language. It's already
  // covered, far more usefully, by the granular entries from scraper.js
  // (one row per defect). Including it here duplicates that data AND
  // is large enough to exceed the embeddings API's per-input token
  // limit (~8,191 tokens), which can cause the whole embedding request
  // to fail.
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

// Removes hardcoded "prices in force as of <date>" boilerplate that the site
// embeds directly in the page text (not tied to WordPress's own "last
// modified" date, so it silently goes stale whenever prices change without
// someone remembering to also edit this sentence). We strip it entirely
// rather than trust it, since the chatbot should never surface a possibly
// wrong date — the system prompt also has a backup instruction for this,
// but removing it at the source is the reliable fix.
function stripStaleDateStamps(text) {
  const patterns = [
    /PRICES IN FORCE on \d{1,2}\s+[A-Z]+\s+\d{4}\s+AT SNCT VEHICLE INSPECTION STATIONS/gi,
    /PR[EÉ]IS?E?\s*G[ÜU]LTIG\s+ab\s+dem\s+\d{1,2}\.?\s*[A-ZÄÖÜ]+\s+\d{4}\s+IN\s+DEN\s+PR[ÜU]FSTELLEN\s+DER\s+SNCT/gi,
    /PRIX APPLICABLES au \d{1,2}\s+[A-ZÉÈÀ]+\s+\d{4}\s+DANS LES STATIONS DE CONTR[ÔO]LE TECHNIQUE SNCT/gi,
  ];
  let cleaned = text;
  for (const pattern of patterns) {
    cleaned = cleaned.replace(pattern, "");
  }
  return cleaned.replace(/\s+/g, " ").trim();
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
      // WordPress returns 400 once you page past the last page — that's
      // the normal "no more results" signal, not a real error.
      break;
    }

    const items = await res.json();
    if (!Array.isArray(items) || items.length === 0) break;

    for (const item of items) {
      if (EXCLUDE_SLUGS.includes(item.slug)) continue;

      const title = stripHtml(item.title?.rendered || "");
      const content = stripStaleDateStamps(
        stripHtml(item.content?.rendered || ""),
      );
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

  // Merge with whatever scraper.js already produced (the sanctions
  // catalog), keyed by id so re-running this never creates duplicates.
  let existing = [];
  if (fs.existsSync(OUTPUT_PATH)) {
    existing = JSON.parse(fs.readFileSync(OUTPUT_PATH, "utf-8"));
  }

  // Drop any previously-saved site content whose id no longer
  // appears (page deleted/unpublished since last run).
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
