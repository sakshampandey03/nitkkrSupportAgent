const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');

const visitedUrls = new Set();
const allLinks = []; // Store extracted links
const maxDepth = 0; // Set max depth

async function scrapePage(url, depth = 0) {
    if (depth > maxDepth || visitedUrls.has(url) || url.length > 50) return;
    if (!url.startsWith('https://nitkkr.ac.in/') || url.includes('/hi')) {
        console.log(`Skipping non-HTTP URL: ${url}`);
        return;
    }
    visitedUrls.add(url);

    console.log(`Scraping (Depth ${depth}): ${url}`);

    try {
        const { data } = await axios.get(url);
        const $ = cheerio.load(data);

        const links = [];
        $('a').each((_, element) => {
            const link = $(element).attr('href');
            if (link && link.startsWith('https://nitkkr.ac.in/') && !visitedUrls.has(link) && 
        link.length < 50) {
                links.push(link);
                allLinks.push(link);
            }
        });

        if (depth < maxDepth) {
            for (const link of links) {
                await scrapePage(link, depth + 1);
            }
        }
    } catch (error) {
        console.error(`Error scraping ${url}:`, error.message);
    }
}

async function execute() {
    const startUrls = [
        'https://nitkkr.ac.in/',
        'https://nitkkr.ac.in/faculty/',
        'https://nitkkr.ac.in/technobyte/'
    ];

    for (const url of startUrls) {
        await scrapePage(url, 0);
    }

    // Save extracted links
    fs.writeFileSync('linkD0.json', JSON.stringify(allLinks, null, 2));
    console.log('Scraping completed! Links saved to links.json');
}

execute();
