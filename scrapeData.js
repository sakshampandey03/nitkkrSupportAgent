import puppeteer from "puppeteer";
import fs from "fs";
import { links } from "./linkD0.js";

const visitedUrls = new Set();
const scrapedData = [];


async function scrapePage(browser, url) {
    if (visitedUrls.has(url)) return;
  
    visitedUrls.add(url);
  
    if (!url.startsWith("https://nitkkr.ac.in/")) {
      console.log(`Skipping non-HTTP URL: ${url}`);
      return;
    }
  
    console.log(`Scraping : ${url}`);
  
    const page = await browser.newPage();
    try {
      await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
  
      // Scrape sections
      const sections = await page.evaluate(() => {
        const results = [];
        const headings = document.querySelectorAll("h1, h2, h3, h4, h5, h6");
  
        headings.forEach((heading) => {
          const headingText = heading.innerText.trim();
          if (!headingText) return;
  
          const section = { heading: headingText, content: [] };
  
          let nextElement = heading.nextElementSibling;
          while (nextElement && !nextElement.matches("h1, h2, h3, h4, h5, h6")) {
            if (nextElement.matches("p, ul, ol")) {
              const text = nextElement.innerText.trim();
              if (text) section.content.push(text);
            }
            nextElement = nextElement.nextElementSibling;
          }
          // commented out this section so that all the links could be included as well
          // if (section.content.length > 0) {
          //   results.push(section);
          // }
        });
  
        return results;
      });
  
      scrapedData.push({ url, sections });
    } catch (error) {
      console.error(`Error scraping ${url}:`, error.message);
    } finally {
      await page.close();
    }
  }
  
  async function execute() {
    const browser = await puppeteer.launch({ headless: true });
    for (const url of links) {
      await scrapePage(browser, url);
    }
    await browser.close();
  
    fs.writeFileSync("scraped_data.json", JSON.stringify(scrapedData, null, 2));
    console.log("Scraping completed! Data saved to scraped_data.json");
  }

