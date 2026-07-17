# SNCT Catalog Scraper

Automated scraper suite that extracts content from the SNCT (Société Nationale
de Contrôle Technique) website ([snct.lu](https://snct.lu)) in French, English,
and German, and outputs it as a single structured `catalog.json`. This file is
consumed by a WordPress RAG chatbot plugin to keep its knowledge base in sync
automatically.

Two scrapers write to the same output file, covering two different kinds of
content:

- **`scraper.js`** — the sanctions/defects catalog (the technical inspection
  point-by-point nomenclature), scraped from the site's accordion/table UI
  using a headless browser.
- **`scrape-pages.js`** — all other static pages on the site (prices, FAQ,
  checklist, contact, careers, legal pages, etc.), pulled directly from
  WordPress's built-in REST API — no browser needed for this part, since it's
  just structured JSON straight from the CMS.

## What each script does

### `scraper.js` (sanctions catalog)

- Uses [Playwright](https://playwright.dev/) to load the catalog pages and
  expand any accordion/table sections that require JS interaction.
- Parses the resulting HTML with [Cheerio](https://cheerio.js.org/) to extract
  each sanction entry: language, subsection, description, and severity.
- Writes to `data/catalog.json`.

### `scrape-pages.js` (general site content)

- Fetches every published **Page** from `snct.lu`'s WordPress REST API
  (`/wp-json/wp/v2/pages`), across all three languages.
- Detects the language from the URL prefix (`/en/` → English, `/de/` → German,
  no prefix → French) rather than the API's `?lang=` parameter, which was
  found not to actually filter results on this site.
- Strips HTML down to plain text, and removes known stale date-stamp
  boilerplate (e.g. "PRICES IN FORCE on 02 MAY 2025") that the site embeds
  directly in page text and doesn't reliably keep updated — this text isn't
  tied to WordPress's own "last modified" date, so it's stripped at the
  source rather than trusted.
- **Excludes** certain pages, defined in `EXCLUDE_SLUGS`:
  - `test` — a leftover test page with no real content.
  - `addresses-and-opening-hours-map` / `adressen-und-offnungszeiten-map` /
    `adresses-et-horaires-map` — interactive map widgets whose real content
    (addresses) loads via client-side JavaScript/AJAX after page load, so the
    REST API only returns UI chrome (buttons, "Loading...", filters) with no
    useful information. The plain-list address pages cover the same
    information as real, scrapeable text instead.
  - `catalog-of-sanctions` / `katalog-der-sanktionspunkte` /
    `catalogue-des-sanctions` — the full sanctions catalog as a single giant
    page of text. This duplicates what `scraper.js` already extracts far more
    usefully as one entry per defect, and is large enough to exceed the
    embeddings API's per-input token limit (~8,191 tokens), which can cause
    the whole embedding request to fail.
- Merges the result into the same `data/catalog.json`, matching by `id` so
  re-running never creates duplicates, and drops previously-saved page
  entries whose `id` no longer appears (e.g. a page was deleted on the site).
- There is no blog/news section on the site currently (confirmed via
  `/wp-json/wp/v2/posts`), so only Pages are scraped. If SNCT adds one later,
  add `"posts"` to the `POST_TYPES` array to include it.

## Running locally

```bash
npm install
npx playwright install chromium
node scraper.js
node scrape-pages.js
```

Output is written to `data/catalog.json` (both scripts write to/merge into
the same file — always run `scraper.js` before `scrape-pages.js`, or run both
before committing, so the file reflects both sources).

## Output format

`data/catalog.json` is a single array mixing two entry shapes:

**Sanctions catalog entries** (from `scraper.js`):

```json
{
  "id": "a1b2c3d4e5f6...",
  "language": "fr",
  "subsection": "Freinage",
  "description": "Description of the inspection point...",
  "severity": "major"
}
```

**Site page entries** (from `scrape-pages.js`):

```json
{
  "id": "3ea67b53f5a3bdd3b2d002d47a8786a4",
  "language": "en",
  "type": "page",
  "title": "FAQ",
  "description": "FAQ. Do you have questions about the vehicle inspection?...",
  "url": "https://snct.lu/en/faq-2/",
  "severity": null
}
```

- `id`: stable hash, used by the consuming plugin to detect additions,
  changes, and removals without re-processing unchanged entries.
- `description`: the field both scrapers write the actual text content into
  — this is what the WordPress plugin embeds, regardless of entry type.
- `url` (page entries only): the plugin surfaces this as a source link in
  chatbot answers when relevant (e.g. "book here: [link]").
- `severity`: one of `minor`, `major`, `critical`, or `null` for site pages.

## Automated scraping (GitHub Actions)

The workflow in `.github/workflows/scrape.yml` runs on a schedule (see the
`cron` expression there — adjust as needed) and can also be triggered manually
from the **Actions** tab (`workflow_dispatch`). On each run it:

1. Installs dependencies and Chromium.
2. Runs `node scraper.js` then `node scrape-pages.js`.
3. Commits and pushes `data/catalog.json` if it changed.

## Consuming this data

The `data/catalog.json` file is publicly readable at:

```
https://raw.githubusercontent.com/AlexandreMns/Scraper/main/data/catalog.json
```

Paste this URL into the WordPress AI Chatbot plugin's "Catalog URL" setting
to enable automatic RAG sync. The plugin's "ID field" and "Content field"
settings should be `id` and `description` respectively, matching the output
format above.
