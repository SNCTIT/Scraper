import { chromium } from "playwright";
import * as cheerio from "cheerio";
import fs from "fs";
import crypto from "crypto";

const URLS = {
  fr: "https://snct.lu/catalogue-des-sanctions/",
  en: "https://snct.lu/en/catalog-of-sanctions/",
  de: "https://snct.lu/de/katalog-der-sanktionspunkte/",
};

const SEVERITY_BY_COLUMN = {
  "column-3": "minor",
  "column-4": "major",
  "column-5": "critical",
};

function detectSeverity($row) {
  let severity = null;
  for (const col of Object.keys(SEVERITY_BY_COLUMN)) {
    const hasImg = $row.find(`td.${col} img`).length > 0;
    if (hasImg) severity = SEVERITY_BY_COLUMN[col];
  }
  return severity;
}

async function scrapeLanguage(language, url) {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  try {
    await page.goto(url, { waitUntil: "load", timeout: 60000 });
    await page.waitForTimeout(3000);

    const accordionToggles = await page
      .locator(".elementor-tab-title, .accordion-title, [data-tab], summary")
      .all();
    for (const toggle of accordionToggles) {
      try {
        await toggle.click({ timeout: 2000 });
        await page.waitForTimeout(200);
      } catch (e) {}
    }

    await page.waitForTimeout(2000);

    const tableCount = await page.locator('table[id^="tablepress-"]').count();
    console.log(`  ${language}: ${tableCount} tables found in DOM`);

    const html = await page.content();
    const $ = cheerio.load(html);
    const results = [];

    $('table[id^="tablepress-"]').each((tableIndex, table) => {
      const $table = $(table);
      let currentSubsection = "";

      $table.find("tbody tr").each((i, row) => {
        const $row = $(row);

        if (
          $row.hasClass("dtrg-group") ||
          $row.find("th[colspan]").length > 0
        ) {
          currentSubsection = $row.find("th").text().trim();
          return;
        }

        const description = $row.find("td.column-2").text().trim();
        if (!description) return;

        const severity = detectSeverity($row);

        const id = crypto
          .createHash("md5")
          .update(`${language}-${currentSubsection}-${description}`)
          .digest("hex");

        results.push({
          id,
          language,
          subsection: currentSubsection,
          description,
          severity,
        });
      });
    });

    return results;
  } finally {
    await browser.close();
  }
}

async function scrapeAll() {
  let all = [];

  for (const [language, url] of Object.entries(URLS)) {
    console.log(`Processing ${language}...`);
    try {
      const results = await scrapeLanguage(language, url);
      console.log(`  Found ${results.length} items`);
      all = all.concat(results);
    } catch (err) {
      console.error(`  Error in ${language}:`, err.message);
    }
  }

  fs.writeFileSync("./data/catalog.json", JSON.stringify(all, null, 2));
  console.log(`\nSaved ${all.length} items total to data/catalog.json`);
}

scrapeAll();
