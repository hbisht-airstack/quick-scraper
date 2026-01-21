const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");

const {
  navigateToSearch,
  ensureContentLoaded,
  extractProductInformation,
} = require("./searchHelpers");
const { setBlinkitLocation } = require("./set-location");

const DEFAULT_OUTPUT_DIR = path.join(__dirname, "..", "output");

const BROWSER_LAUNCH_OPTS = {
  headless: "new",
  args: ["--disable-setuid-sandbox", "--no-sandbox", "--single-process", "--no-zygote"],
  executablePath: process.env.PUPPETEER_EXEC_PATH,
};

async function runBlinkitSearchWithMeta(page, searchTerm) {
  let responseHandler;
  let sourceUrl = null;
  let requestHeaders = null;
  let responseHeaders = null;
  const productJsonPromise = new Promise((resolve) => {
    responseHandler = async (response) => {
      const url = response.url();
      if (
        response.request().resourceType() === "xhr" ||
        response.request().resourceType() === "fetch"
      ) {
        try {
          const json = await response.json();
          if (
            json &&
            json.response &&
            Array.isArray(json.response.snippets) &&
            json.response.snippets.some((s) => s.data && s.data.identity) &&
            !url.includes("empty_search")
          ) {
            sourceUrl = url;
            requestHeaders = response.request().headers();
            responseHeaders = response.headers();
            if (page && typeof page.off === "function") {
              page.off("response", responseHandler);
            }
            resolve(json);
          }
        } catch (e) {
          // Ignore non-JSON responses
        }
      }
    };

    page.on("response", responseHandler);

    setTimeout(() => {
      if (page && typeof page.off === "function") {
        page.off("response", responseHandler);
      }
      resolve({ useHtmlExtraction: true, page });
    }, 30000);
  });

  const navigationSuccess = await navigateToSearch(page, searchTerm);
  if (!navigationSuccess) {
    if (page && typeof page.off === "function" && responseHandler) {
      page.off("response", responseHandler);
    }
    return [];
  }

  await ensureContentLoaded(page);

  const productJsonResponse = await productJsonPromise;
  if (productJsonResponse?.useHtmlExtraction) {
    productJsonResponse.page = page;
  }

  const products = await extractProductInformation(productJsonResponse);
  return {
    products: Array.isArray(products) ? products : [],
    sourceUrl,
    requestHeaders,
    responseHeaders,
  };
}

async function runBlinkitSearch(page, searchTerm) {
  const result = await runBlinkitSearchWithMeta(page, searchTerm);
  return result.products;
}

// Check if product is processed/preserved (not fresh produce)
function isProcessedProduct(productName) {
  const processedKeywords = [
    /sun[-\s]?dried/i,
    /dried\s+(tomato|fruit|vegetable)/i,
    /\bin\s+oil/i,
    /\bin\s+brine/i,
    /pickle/i,
    /preserved/i,
    /canned/i,
    /jarred/i,
    /frozen\s+(and\s+)?dried/i,
    /dehydrated/i,
  ];
  
  const name = String(productName || "").toLowerCase();
  return processedKeywords.some(pattern => pattern.test(name));
}

function isTomatoSearch(term) {
  return /\btomato(es)?\b/i.test(String(term || ""));
}

function normalizeToken(token) {
  if (!token) {
    return "";
  }
  const t = token.toLowerCase();
  if (t.length > 4 && t.endsWith("ies")) {
    return t.slice(0, -3) + "y";
  }
  if (t.length > 4 && t.endsWith("es")) {
    return t.slice(0, -2);
  }
  if (t.length > 3 && t.endsWith("s") && !t.endsWith("ss")) {
    return t.slice(0, -1);
  }
  return t;
}

function extractCoreTokens(term) {
  const stopwords = new Set([
    "kg",
    "g",
    "gm",
    "gram",
    "grams",
    "kilogram",
    "kilograms",
    "pack",
    "packet",
    "combo",
    "x",
    "of",
    "and",
    "with",
    "fresh",
  ]);

  return String(term || "")
    .toLowerCase()
    .split(/[\s,-]+/)
    .map((t) => t.trim())
    .filter((t) => t && !stopwords.has(t))
    .filter((t) => !/^\d+(\.\d+)?$/.test(t))
    .filter(
      (t) =>
        !/^\d+(\.\d+)?(kg|g|gm|gram|grams|kilogram|kilograms|mg|l|lt|ltr|liter|litre|liters|litres|ml|pc|pcs|piece|pieces|pack|packs)$/.test(t)
    )
    .map((t) => normalizeToken(t))
    .filter(Boolean);
}

function matchesSearchTerm(productName, term) {
  const nameTokens = String(productName || "")
    .toLowerCase()
    .split(/[\s,-]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => normalizeToken(t))
    .filter(Boolean);

  const nameTokenSet = new Set(nameTokens);
  const tokens = extractCoreTokens(term);
  if (tokens.length === 0) {
    return true;
  }
  return tokens.every((token) => nameTokenSet.has(token));
}

const WEIGHT_UNITS = new Set(["kg", "g", "gm", "gram", "grams", "kilogram", "kilograms", "mg"]);
const VOLUME_UNITS = new Set(["l", "lt", "ltr", "liter", "litre", "liters", "litres", "ml"]);
const COUNT_UNITS = new Set(["pc", "pcs", "piece", "pieces", "pack", "packs"]);

function normalizeUnit(unit) {
  const u = unit.toLowerCase();
  if (u === "gm") return "g";
  if (u === "gram" || u === "grams") return "g";
  if (u === "kilogram" || u === "kilograms") return "kg";
  if (u === "lt" || u === "ltr") return "l";
  if (u === "liter" || u === "litre" || u === "liters" || u === "litres") return "l";
  if (u === "piece" || u === "pieces") return "pc";
  if (u === "packs") return "pack";
  return u;
}

function unitCategory(unit) {
  const u = normalizeUnit(unit);
  if (WEIGHT_UNITS.has(u)) return "weight";
  if (VOLUME_UNITS.has(u)) return "volume";
  if (COUNT_UNITS.has(u)) return "count";
  return "unknown";
}

function normalizeQuantity(value, unit) {
  const u = normalizeUnit(unit);
  const category = unitCategory(u);
  if (category === "weight") {
    if (u === "kg") return { value: value * 1000, unit: "g", category };
    if (u === "mg") return { value: value / 1000, unit: "g", category };
    return { value, unit: "g", category };
  }
  if (category === "volume") {
    if (u === "l") return { value: value * 1000, unit: "ml", category };
    return { value, unit: "ml", category };
  }
  if (category === "count") {
    return { value, unit: "pc", category };
  }
  return { value, unit: u, category: "unknown" };
}

function parseQuantityToken(str) {
  const qtyMatch = String(str).match(/\b(\d+(?:\.\d+)?)\s*([a-zA-Z]+)\b/);
  if (!qtyMatch) return null;
  const value = parseFloat(qtyMatch[1]);
  const unit = qtyMatch[2];
  if (Number.isNaN(value)) return null;
  return normalizeQuantity(value, unit);
}

// Extract quantity from search term (e.g., "tomato 1kg" -> {value, unit, category})
function extractQuantityFromTerm(term) {
  const match = term.match(/\b(\d+(?:\.\d+)?)\s*([a-zA-Z]+)\b/);
  if (!match) return null;
  const value = parseFloat(match[1]);
  const unit = match[2];
  if (Number.isNaN(value)) return null;
  return normalizeQuantity(value, unit);
}

// Normalize product quantity for comparison
function normalizeQuantityValue(qtyStr) {
  if (!qtyStr || qtyStr === "N/A") return null;

  const str = String(qtyStr).toLowerCase().trim();

  // Handle "2x500g" or "2 x 500g" format
  const multiMatch = str.match(/(\d+)\s*x\s*(\d+(?:\.\d+)?)\s*([a-zA-Z]+)/i);
  if (multiMatch) {
    const multiplier = parseFloat(multiMatch[1]);
    const value = parseFloat(multiMatch[2]);
    const unit = multiMatch[3];
    const normalized = normalizeQuantity(value, unit);
    return {
      value: normalized.value * multiplier,
      unit: normalized.unit,
      category: normalized.category,
    };
  }

  return parseQuantityToken(str);
}

// Check if product quantity matches requested quantity (with 10% tolerance)
function matchesQuantity(productQty, requestedQty) {
  if (!requestedQty) return true; // No quantity filter

  const productQtyNormalized = normalizeQuantityValue(productQty);
  if (!productQtyNormalized) return true; // Can't determine, include it

  if (requestedQty.category !== productQtyNormalized.category) {
    return false;
  }

  // 10% tolerance for matching
  const tolerance = requestedQty.value * 0.1;
  const diff = Math.abs(productQtyNormalized.value - requestedQty.value);
  return diff <= tolerance;
}

function toCsvValue(value) {
  if (value === null || value === undefined) {
    return "";
  }
  const str = String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function buildCsv(rows) {
  const headers = [
    "pincode",
    "searchTerm",
    "service",
    "id",
    "name",
    "price",
    "originalPrice",
    "savings",
    "quantity",
    "deliveryTime",
    "discount",
    "imageUrl",
    "available",
  ];

  const lines = [headers.join(",")];
  for (const row of rows) {
    const line = headers.map((h) => toCsvValue(row[h])).join(",");
    lines.push(line);
  }
  return lines.join("\n");
}

async function runBlinkitBatchCsv({ pincodes, searchTerms, quantities = [], outputDir = DEFAULT_OUTPUT_DIR }) {
  if (!Array.isArray(pincodes) || pincodes.length === 0) {
    throw new Error("pincodes must be a non-empty array");
  }
  if (!Array.isArray(searchTerms) || searchTerms.length === 0) {
    throw new Error("searchTerms must be a non-empty array");
  }
  if (!Array.isArray(quantities)) {
    throw new Error("quantities must be an array");
  }

  // Combine search terms with quantities if provided
  const expandedSearchTerms = [];
  if (quantities.length > 0) {
    for (const term of searchTerms) {
      for (const qty of quantities) {
        expandedSearchTerms.push(`${term} ${qty}`.trim());
      }
    }
  } else {
    expandedSearchTerms.push(...searchTerms);
  }

  fs.mkdirSync(outputDir, { recursive: true });

  const rows = [];
  let browser;
  try {
    browser = await puppeteer.launch(BROWSER_LAUNCH_OPTS);
    for (const pincode of pincodes) {
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 800 });
      await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
      );

      const locationTitle = await setBlinkitLocation(page, pincode);
      if (!locationTitle) {
        await page.close().catch(() => {});
        continue;
      }

      for (const term of expandedSearchTerms) {
        const products = await runBlinkitSearch(page, term);
        
        // Extract requested quantity from search term
        const requestedQty = extractQuantityFromTerm(term);
        
        for (const product of products) {
          // Filter out processed/preserved products (e.g., "Sun Dried Tomatoes in Oil")
          if (isTomatoSearch(term) && isProcessedProduct(product.name)) {
            console.log(`Filtering out processed product: ${product.name}`);
            continue;
          }
          
          // Filter out out-of-stock products
          if (product.available === false) {
            console.log(`Filtering out out-of-stock product: ${product.name}`);
            continue;
          }

          // Filter out items with missing delivery time (often out of stock)
          if (!product.deliveryTime || String(product.deliveryTime).toLowerCase() === "n/a") {
            console.log(`Filtering out product with no delivery time: ${product.name}`);
            continue;
          }

          // Filter by quantity if requested
          if (requestedQty && !matchesQuantity(product.quantity, requestedQty)) {
            console.log(`Filtering out product - quantity mismatch: ${product.name} (${product.quantity}) vs requested (${requestedQty.value}${requestedQty.unit})`);
            continue;
          }

          // Filter by search term keywords to avoid unrelated items (e.g., potato in onion search)
          if (!matchesSearchTerm(product.name, term)) {
            console.log(`Filtering out product - term mismatch: ${product.name} for "${term}"`);
            continue;
          }
          
          rows.push({
            pincode,
            searchTerm: term,
            service: "blinkit",
            id: product.id,
            name: product.name,
            price: product.price,
            originalPrice: product.originalPrice,
            savings: product.savings,
            quantity: product.quantity,
            deliveryTime: product.deliveryTime,
            discount: product.discount,
            imageUrl: product.imageUrl,
            available: product.available,
          });
        }
      }
      await page.close().catch(() => {});
    }
  } finally {
    if (browser) {
      await browser.close();
    }
  }

  const csv = buildCsv(rows);
  const filename = `blinkit-search-${Date.now()}.csv`;
  const csvPath = path.join(outputDir, filename);
  fs.writeFileSync(csvPath, csv, "utf8");

  return {
    file: csvPath,
    filename,
    rowCount: rows.length,
    pincodes,
    searchTerms,
    quantities: quantities.length > 0 ? quantities : undefined,
    expandedSearchTerms: expandedSearchTerms,
    items: rows,
  };
}

async function probeBlinkitSearch({ pincode, searchTerm }) {
  if (!pincode || !searchTerm) {
    throw new Error("pincode and searchTerm are required");
  }

  let browser;
  try {
    browser = await puppeteer.launch(BROWSER_LAUNCH_OPTS);
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
    );

    const locationTitle = await setBlinkitLocation(page, pincode);
    if (!locationTitle) {
      throw new Error("Failed to set location");
    }

    const result = await runBlinkitSearchWithMeta(page, searchTerm);
    const cookies = await page.cookies();
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");

    return {
      locationTitle,
      sourceUrl: result.sourceUrl,
      requestHeaders: result.requestHeaders,
      responseHeaders: result.responseHeaders,
      cookieHeader,
      sampleProducts: result.products.slice(0, 5),
    };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

module.exports = {
  runBlinkitBatchCsv,
  probeBlinkitSearch,
};

