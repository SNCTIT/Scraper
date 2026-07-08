# SNCT Catalog Scraper

Automated scraper that extracts the SNCT (Société Nationale de Contrôle Technique)
sanctions catalog from [snct.lu](https://snct.lu) in French, English, and German,
and outputs it as a structured `catalog.json`. This file is consumed by a
WordPress RAG chatbot plugin to keep its knowledge base in sync automatically.

## What it does

- Uses [Playwright](https://playwright.dev/) to load the catalog pages and
  expand any accordion/table sections that require JS interaction.
- Parses the resulting HTML with [Cheerio](https://cheerio.js.org/) to extract
  each sanction entry: language, subsection, description, and severity.
- Writes the result to `data/catalog.json`.
- Runs automatically on a schedule via GitHub Actions (see
  `.github/workflows/scrape.yml`), committing the updated file back to this
  repository so it's always available at a stable public URL.

## Running locally

```bash
npm install
node scrape.js
```

Output is written to `data/catalog.json`.

## Output format

Each entry in `catalog.json` looks like this:

```json
{
  "id": "a1b2c3d4e5f6...",
  "language": "fr",
  "subsection": "Freinage",
  "description": "Description of the inspection point...",
  "severity": "major"
}
```

- `id`: stable hash derived from language + subsection + description, used by
  the consuming plugin to detect additions, changes, and removals without
  re-processing unchanged entries.
- `severity`: one of `minor`, `major`, or `critical`, detected from the
  presence of a marker image in the corresponding table column.

## Automated scraping (GitHub Actions)

The workflow in `.github/workflows/scrape.yml` runs on a schedule (see the
`cron` expression there — adjust as needed) and can also be triggered manually
from the **Actions** tab (`workflow_dispatch`). On each run it:

1. Installs dependencies and Chromium.
2. Runs `node scrape.js`.
3. Commits and pushes `data/catalog.json` if it changed.

## Consuming this data

The `data/catalog.json` file is publicly readable at:

```
https://raw.githubusercontent.com/<your-username>/<this-repo>/main/data/catalog.json
```

## Notes

- This repository should stay **public** (or the consuming plugin needs an
  authenticated fetch) so the raw JSON URL is reachable without credentials.
- Scraping frequency should be reasonable — avoid overly aggressive schedules
  that could put unnecessary load on snct.lu.
