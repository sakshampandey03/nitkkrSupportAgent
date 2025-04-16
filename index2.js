import puppeteer from "puppeteer";
import dotenv from "dotenv";
dotenv.config();
const key = process.env.GEMINI_API_KEY;
import { pipeline } from "@xenova/transformers";
import fs from "fs";
import { links } from "./linkD0.js";
import { ChromaClient } from "chromadb";
import { GoogleGenerativeAI } from "@google/generative-ai";
import express from 'express';

const visitedUrls = new Set();
const scrapedData = [];

if (!process.env.CHROMA_DB_AUTH_TOKEN) {
  console.error("❌ CHROMA_DB_AUTH_TOKEN is missing from .env!");
  process.exit(1);
}

// Initialize ChromaDB client with authentication
const chromaClient = new ChromaClient({
  path:  "http://chromadb:8000",
  auth: {
    provider: 'token',
    credentials: process.env.CHROMA_DB_AUTH_TOKEN || 'your-secret-token-here',
    headerType: 'AUTHORIZATION' 
  }
});
console.log('ChromaDB connection configured with:',
  `Endpoint: http://chromadb:8000`,
  `Auth Token: ${process.env.CHROMA_DB_AUTH_TOKEN ? '*****' + process.env.CHROMA_DB_AUTH_TOKEN.slice(-4) : 'NOT SET'}`
);
// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

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



// --------------create embeddings-------------------------------------------------------------------
let extractor;

async function initializeEmbeddingModel() {
  extractor = await pipeline(
    "feature-extraction",
    "Xenova/all-MiniLM-L6-v2"
  );
}

// Function to generate embeddings
async function generateEmbeddings(text) {
  if (!extractor) await initializeEmbeddingModel();
  const output = await extractor(text, { pooling: "mean", normalize: true });
  return Array.from(output.data);
}


async function createEmbeddings() {
  // Load the embedding model

  // Load the scraped data
  try{const Data = JSON.parse(fs.readFileSync("scraped_data1.json", "utf8"));

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
  console.log("Embeddings generated and saved to embeddings.json");}
  catch(error){
    console.log("error in create embeddings", error);
  }
}

// --------------------------store embeddings--------------------------------------------------------
// Load embeddings
const embeddings = JSON.parse(fs.readFileSync("embeddings.json", "utf8"));

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
      let collection;
      try {
        collection = await chromaClient.getOrCreateCollection({ name: "website_data" });
        console.log("Collection is ready.");
      } catch (err) {
        console.error("Error getting/creating collection:", err);
      }
  
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
async function queryChromaDB(query) {
  try {
    const queryEmbedding = await generateEmbeddings(query);
    const collection = await chromaClient.getCollection({ name: "website_data" });
    
    const results = await collection.query({
      queryEmbeddings: [queryEmbedding],
      nResults: 3,
    });

    return results;
  } catch (error) {
    console.error("Error querying Chroma DB:", error);
    throw error;
  }
}

async function generateResponse(query) {
  try {
    const results = await queryChromaDB(query);
    if (!results) {
      return "Sorry, I could not find any relevant information.";
    }

    const context = results.metadatas[0]
      .map((metadata, index) => {
        if (metadata && metadata.url && metadata.content) {
          return `Source: ${metadata.url}\n${metadata.content}`;
        }
        return null;
      })
      .filter(Boolean)
      .join("\n\n");

    if (!context) {
      return "I couldn't find the exact details, but you might check these official pages:\n- [NIT Kurukshetra Admissions](https://nitkkr.ac.in)\n- [Academic Programs](https://nitkkr.ac.in/academics.php)";
    }

    const prompt = `You are an AI assistant for NIT Kurukshetra. Provide helpful responses based on the context.Your goal is to assist users by utilizing the given context while maintaining clarity, conciseness, and helpfulness.  

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

Answer concisely and professionally, using emoticons where appropriate:`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text();
  } catch (error) {
    console.error("Error generating response:", error);
    return "Sorry, an error occurred in generateResponse function. Please try again later.";
  }
}
async function ex(){
  const res = await generateResponse("what is NIT Kurukshetra");
  console.log("your response is ------------------------------------------------------------------------------------------------------------------------\n\n", res);
}
// ex();
// -----------------------server setup------------------------------------------------------
const app = express();
app.use(express.json());

// Initialize endpoint
app.post('/initialize', async (req, res) => {
  try {
    await createEmbeddings();
    await storeEmbeddings();
    res.status(200).send("Database initialized successfully!");
  } catch (error) {
    res.status(500).send("Initialization failed: " + error.message);
  }
});

// Query endpoint
app.post('/query', async (req, res) => {
  try {
    const { question } = req.body;
    if (!question) {
      return res.status(400).send("Please provide a question");
    }
    const response = await generateResponse(question);
    console.log("the response is \n", response);
    res.json({ response });
  } catch (error) {
    res.status(500).send("Query failed: " + error.message);
  }
});


app.get('/health', (req, res) => {
  try {
    // Optional: Check ChromaDB connection
    // await chromaClient.heartbeat();
    res.status(200).json({ status: 'healthy' });
  } catch (error) {
    res.status(500).json({ status: 'unhealthy', error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  // Optional: Auto-initialize on startup (not recommended for production)
  if (process.env.AUTO_INITIALIZE) {
    try {
      await createEmbeddings();
      await storeEmbeddings();
    } catch (error) {
      console.error("Auto-initialization failed:", error);
    }
  }
});