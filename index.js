import puppeteer from "puppeteer";

import { pipeline } from "@xenova/transformers";
import fs from "fs";
import { links } from "./linkD0.js";
import { ChromaClient } from "chromadb";

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

        if (section.content.length > 0) {
          results.push(section);
        }
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

// --------------create embeddings-------------------------------------------------------------------

const extractor = await pipeline(
  "feature-extraction",
  "Xenova/all-MiniLM-L6-v2"
);
// Function to generate embeddings
async function generateEmbeddings(text) {
  const output = await extractor(text, { pooling: "mean", normalize: true });
  return Array.from(output.data);
}

async function createEmbeddings() {
  // Load the embedding model

  // Load the scraped data
  const Data = JSON.parse(fs.readFileSync("scraped_data1.json", "utf8"));

  // Process the scraped data
  const embeddings = [];
  for (const item of Data) {
    for (const section of item.sections) {
      const text = `${section.heading}\n${section.content.join("\n")}`;
      const embedding = await generateEmbeddings(text);
      embeddings.push({
        url: item.url,
        section: section.heading,
        content: text,
        embedding: embedding,
      });
    }
  }

  // Save embeddings to a file
  fs.writeFileSync("embeddings.json", JSON.stringify(embeddings, null, 2));
  console.log("Embeddings generated and saved to embeddings.json");
}

// createEmbeddings();

// --------------------------store embeddings--------------------------------------------------------

// Load embeddings
const embeddings = JSON.parse(fs.readFileSync("embeddings.json", "utf8"));

// Connect to Chroma DB
const chromaClient = new ChromaClient("http://localhost:8000");

async function storeEmbeddings() {
  try {
    // Delete the existing collection (if it exists)
    try {
      await chromaClient.deleteCollection({ name: "website_data" });
      console.log("Deleted existing collection.");
    } catch (error) {
      console.log("No existing collection to delete.");
    }

    // Create a new collection
    const collection = await chromaClient.createCollection({
      name: "website_data", // Provide a name for the collection
    });

    // Add embeddings to the collection
    for (const item of embeddings) {
      if (!item || !item.embedding) {
        console.error("Embedding is undefined for item:", item.url);
        continue; // Skip items with undefined embeddings
      }

      await collection.add({
        ids: [item.url], // Unique ID for each embedding (e.g., URL)
        embeddings: [item.embedding], // The embedding vector
        metadatas: [
          {
            url: item.url,
            section: item.section,
            content: item.content,
          },
        ],
      });
    }

    console.log("Embeddings stored in Chroma DB!");
  } catch (error) {
    console.error("Error storing embeddings:", error);
  }
}

// -----------------------query using gemini------------------------------------------------------

import { GoogleGenerativeAI } from "@google/generative-ai";

// Initialize Gemini
const genAI = new GoogleGenerativeAI("AIzaSyCb-e-G-c6t-GLLe-S9gQKMSF8OAEbCphg"); // Replace with your Gemini API key
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

async function queryChromaDB(query) {
  try {
    // Convert the query to an embedding
    const queryEmbedding = await generateEmbeddings(query);

    // Query Chroma DB
    const collection = await chromaClient.getCollection({
      name: "website_data",
    });
    const results = await collection.query({
      queryEmbeddings: [queryEmbedding],
      nResults: 3, // Number of results to return
    });

    return results;
  } catch (error) {
    console.error("Error querying Chroma DB:", error);
    return null;
  }
}

async function generateResponse(query) {
  try {
    // Query Chroma DB for relevant data
    const results = await queryChromaDB(query);

    if (!results) {
      return "Sorry, I could not find any relevant information.";
    }

    // Print metadata associated with each URL (ID)
    // console.log("Metadata for each URL:");
    // results.metadatas[0].forEach((metadata, index) => {
    //   console.log(`\nURL: ${results.ids[0][index]}`);
    //   console.log("Metadata:", metadata);
    // });

    // Extract metadata from the query results
    const context = results.metadatas[0]
      .map((metadata, index) => {
        if (metadata && metadata.url && metadata.content) {
          console.log("printing meta data \n", typeof(metadata), "\n", metadata.url);
          return `Source: ${metadata.url}\n${metadata.content}`;
        }
        return null;
      })
      .filter(Boolean) // Remove null or undefined values
      .join("\n\n");

    // If no context is available, return a default response
    // console.log(
    //   `heres the context i received of type ${typeof context} \n\n ${context}`
    // );
    if (!context) {
      return "I don't have enough information to answer that question.";
    }

    // Generate a response using Gemini
    const prompt = `You are an AI assistant providing accurate and relevant support on behalf of the NIT Kurukshetra website. Your goal is to assist users by utilizing the given context while maintaining clarity, conciseness, and helpfulness.  

**Guidelines for Response Generation:**  
1. **If the context contains a direct answer:** Provide a precise and structured response, ensuring clarity and relevance.  
2. **If the context provides partial or related information:**  
   - Use the available details to give the most relevant response.  
   - Clearly indicate any limitations in the data while ensuring the response is still useful.  
3. **If no relevant context is found:**  
   - Suggest alternative ways the user might find the required information.  
   - Provide official NIT Kurukshetra website links related to the topic.  
   - Avoid saying *"I don't have enough information"*. Instead, guide the user towards a possible solution.  
4. ** Use emoticons in the response to make it more attractive
**Example Structure:**  

> *"I couldn't find the exact details for [query], but you might find relevant information on the following pages:"*  
> - **[Related Page Name]**: [URL]  
> - **[Another Relevant Page]**: [URL]  

Maintain a professional and helpful tone in all responses. If any official resources are available, prioritize sharing those.  

    

Context:
${context}

Question: ${query}

Answer:`;
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    return text;
  } catch (error) {
    console.error("Error generating response:", error);
    return "Sorry, an error occurred while generating the response.";
  }
}

// Example usage
(async () => {
  const query = "priyanka-ahlawat";
  const response = await generateResponse(query);
  console.log(response);
})();
