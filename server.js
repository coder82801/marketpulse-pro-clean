const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const PORT = process.env.PORT || 10000;

const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json,text/plain,*/*",
  "Accept-Language": "en-US,en;q=0.9,tr;q=0.8",
  Referer: "https://finance.yahoo.com/",
  Origin: "https://finance.yahoo.com"
};

const SYMBOL_MAP = {
  VIX: "^VIX",
  NASDAQ: "^IXIC",
  SP500: "^GSPC"
};

const REVERSE_SYMBOL_MAP = {
  "^VIX": "VIX",
  "^IXIC": "NASDAQ",
  "^GSPC": "SP500"
};

const MARKET_SYMBOLS = [
  "AAPL","MSFT","NVDA","AMD","TSLA","META","AMZN","GOOGL","PLTR","IONQ",
  "SOUN","SOFI","RGTI","QBTS","BBAI","SMCI","MSTR","COIN","MARA","RIOT",
  "LUNR","ASTS","RKLB","ACHR","JOBY","SOPA","EOSE","CTMX","RR","TEM",
  "SERV","ARM","AVGO","NFLX","CRWD","PANW","HIMS","HOOD","UPST","AFRM",
  "OKLO","NNE","VKTX","CELH","CLOV","LCID","RIVN","NIO","FUBO","CAVA",
  "APP","AI","S","PATH","SNOW","NET","DDOG","ZS","MDB","ROKU",
  "INTC","MU","QUBT","VRT","ENVX","QS","KULR","LIDR","MVIS","PLUG"
];

const HEADER_SYMBOLS = ["SPY", "QQQ", "IWM", "^VIX"];

const FUNDAMENTAL_DB = {
  PLTR: { theme: "AI / GovTech", quality: 92, notes: "High-quality AI platform with strong enterprise and government narrative." },
  NVDA: { theme: "AI Infra", quality: 96, notes: "AI infrastructure leader." },
  AMD: { theme: "AI / Semis", quality: 88, notes: "Strong semiconductor and AI exposure." },
  IONQ: { theme: "Quantum", quality: 82, notes: "Quantum narrative, high upside, higher risk." },
  RGTI: { theme: "Quantum", quality: 73, notes: "Speculative quantum candidate." },
  QBTS: { theme: "Quantum", quality: 70, notes: "Quantum theme exposure." },
  ASTS: { theme: "Space / Telecom", quality: 84, notes: "Massive TAM, still execution-sensitive." },
  RKLB: { theme: "Space", quality: 87, notes: "Stronger execution profile in space theme." },
  LUNR: { theme: "Space", quality: 78, notes: "Strong catalyst-driven lunar theme." },
  ACHR: { theme: "eVTOL", quality: 71, notes: "eVTOL upside with execution risk." },
  JOBY: { theme: "eVTOL", quality: 74, notes: "Large TAM, commercialization pending." },
  SOUN: { theme: "Voice AI", quality: 74, notes: "Voice AI narrative with volatility." },
  BBAI: { theme: "AI", quality: 69, notes: "Speculative AI / public sector theme." },
  ENVX: { theme: "Battery", quality: 70, notes: "Battery innovation and growth story." },
  QS: { theme: "Battery", quality: 66, notes: "Big narrative, long commercialization path." },
  EOSE: { theme: "Energy Storage", quality: 68, notes: "Storage theme with financing risk." },
  OKLO: { theme: "Advanced Nuclear", quality: 73, notes: "Nuclear / energy innovation theme." },
  NNE: { theme: "Nuclear", quality: 67, notes: "Speculative nuclear theme." },
  NET: { theme: "Cloud Security", quality: 86, notes: "Cloud and security theme." },
  SNOW: { theme: "Data Cloud", quality: 84, notes: "Data infrastructure growth platform." },
  DDOG: { theme: "Observability", quality: 85, notes: "High-quality software monitoring name." }
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function sanitizeSymbol(symbol) {
  const s = String(symbol || "").trim().toUpperCase();
  const mapped = SYMBOL_MAP[s] || s;
  return mapped.replace(/[^A-Z0-9.^-]/g, "");
}

function parseSymbols(raw) {
  return String(raw || "")
    .split(",")
    .map(sanitizeSymbol)
    .filter(Boolean)
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .slice(0, 300);
}

function displaySymbol(symbol) {
  return REVERSE_SYMBOL_MAP[symbol] || symbol;
}

async function safeFetchJson(url, headers = DEFAULT_HEADERS, timeoutMs = 12000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers,
      signal: controller.signal
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`HTTP ${response.status}${text ? ` - ${text}` : ""}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeYahooQuote(q = {}) {
  const rawSymbol = q.symbol || "";
  const shownSymbol = displaySymbol(rawSymbol);

  return {
    symbol: shownSymbol,
    originalSymbol: rawSymbol,
    shortName: q.shortName || q.longName || q.displayName || shownSymbol,
    regularMarketPrice: toNumber(q.regularMarketPrice, null),
    regularMarketChange: toNumber(q.regularMarketChange, 0),
    regularMarketChangePercent: toNumber(q.regularMarketChangePercent, 0),
    regularMarketOpen: toNumber(q.regularMarketOpen, null),
    regularMarketDayHigh: toNumber(q.regularMarketDayHigh, null),
    regularMarketDayLow: toNumber(q.regularMarketDayLow, null),
    regularMarketPreviousClose: toNumber(q.regularMarketPreviousClose, null),
    regularMarketVolume: toNumber(q.regularMarketVolume, 0),
    averageVolume: toNumber(q.averageVolume || q.averageDailyVolume3Month, 0),
    marketCap: toNumber(q.marketCap, 0),
    fiftyTwoWeekHigh: toNumber(q.fiftyTwoWeekHigh, null),
    fiftyTwoWeekLow: toNumber(q.fiftyTwoWeekLow, null),
    exchange: q.fullExchangeName || q.exchange || "",
    currency: q.currency || "USD"
  };
}

async function fetchYahooQuotes(symbols) {
  if (!symbols.length) return [];
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols.join(","))}`;
  const data = await safeFetchJson(url);
  const result = data?.quoteResponse?.result || [];
  return Array.isArray(result) ? result.map(normalizeYahooQuote) : [];
}

async function fetchYahooChart(symbol, interval = "5m", range = "1d", includePrePost = true) {
  const safeInterval = ["1m", "2m", "5m", "15m", "30m", "60m"].includes(interval) ? interval : "5m";
  const safeRange = ["1d", "5d", "1mo"].includes(range) ? range : "1d";

  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?range=${encodeURIComponent(safeRange)}` +
    `&interval=${encodeURIComponent(safeInterval)}` +
    `&includePrePost=${includePrePost ? "true" : "false"}`;

  const data = await safeFetchJson(url);
  const result = data?.chart?.result?.[0];

  if (!result) {
    return {
      symbol: displaySymbol(symbol),
      originalSymbol: symbol,
      bars: []
    };
  }

  const timestamps = Array.isArray(result.timestamp) ? result.timestamp : [];
  const quote = result?.indicators?.quote?.[0] || {};

  const opens = quote.open || [];
  const highs = quote.high || [];
  const lows = quote.low || [];
  const closes = quote.close || [];
  const volumes = quote.volume || [];

  const bars = [];

  for (let i = 0; i < timestamps.length; i++) {
    const t = timestamps[i] ? new Date(timestamps[i] * 1000).toISOString() : null;
    const o = toNumber(opens[i], null);
    const h = toNumber(highs[i], null);
    const l = toNumber(lows[i], null);
    const c = toNumber(closes[i], null);
    const v = toNumber(volumes[i], 0);

    if (t && c != null) {
      bars.push({ t, o, h, l, c, v });
    }
  }

  return {
    symbol: displaySymbol(symbol),
    originalSymbol: symbol,
    bars
  };
}

async function fetchIntradayForSymbols(symbols, interval = "5m", range = "1d", includePrePost = true) {
  const out = [];
  for (const symbol of symbols) {
    try {
      const item = await fetchYahooChart(symbol, interval, range, includePrePost);
      out.push(item);
    } catch (error) {
      out.push({
        symbol: displaySymbol(symbol),
        originalSymbol: symbol,
        bars: []
      });
    }
    await sleep(60);
  }
  return out;
}

function getVolumeRatio(q) {
  const vol = Number(q.regularMarketVolume || 0);
  const avg = Number(q.averageVolume || 0);
  if (!avg) return 0;
  return vol / avg;
}

function getDayRangePercent(q) {
  const h = Number(q.regularMarketDayHigh || 0);
  const l = Number(q.regularMarketDayLow || 0);
  if (!h || !l || h <= l) return 0;
  return ((h - l) / l) * 100;
}

function getCloseNearHigh(q) {
  const high = Number(q.regularMarketDayHigh || 0);
  const low = Number(q.regularMarketDayLow || 0);
  const price = Number(q.regularMarketPrice || 0);
  if (!high || !low || !price || high <= low) return false;
  return price >= low + (high - low) * 0.68;
}

function getRangePosition(q) {
  const low = Number(q.fiftyTwoWeekLow || 0);
  const high = Number(q.fiftyTwoWeekHigh || 0);
  const price = Number(q.regularMarketPrice || 0);
  if (!low || !high || !price || high <= low) return null;
  return ((price - low) / (high - low)) * 100;
}

function getFundamental(symbol) {
  return FUNDAMENTAL_DB[String(symbol || "").toUpperCase()] || null;
}

function getAccumulationScore(q) {
  const volx = getVolumeRatio(q);
  const absChg = Math.abs(Number(q.regularMarketChangePercent || 0));
  const dayRange = getDayRangePercent(q);
  const rangePos = getRangePosition(q);
  const f = getFundamental(q.symbol);
  const fundamentalQuality = Number(f?.quality || 0);

  let score = 0;
  if (volx >= 0.9 && volx <= 5.5) score += 18;
  if (volx >= 1.4 && volx <= 6.0) score += 12;
  if (absChg <= 7) score += 14;
  if (absChg >= 0.3 && absChg <= 8) score += 10;
  if (dayRange <= 8) score += 12;
  if (rangePos != null && rangePos < 75) score += 12;
  if (getCloseNearHigh(q)) score += 12;
  if (Number(q.regularMarketPrice || 0) > 0.2) score += 8;
  if (fundamentalQuality >= 60) score += 8;
  if (fundamentalQuality >= 80) score += 8;

  return Math.max(0, Math.min(100, Math.round(score)));
}

function getWhaleScore(q) {
  const volx = getVolumeRatio(q);
  const chg = Number(q.regularMarketChangePercent || 0);
  const rangePct = getDayRangePercent(q);
  const marketCap = Number(q.marketCap || 0);
  const f = getFundamental(q.symbol);
  const fundamentalQuality = Number(f?.quality || 0);

  let score = 0;
  if (volx >= 1.2) score += 10;
  if (volx >= 1.8) score += 12;
  if (volx >= 2.5) score += 14;
  if (volx >= 4.0) score += 10;
  if (chg >= 1.5) score += 8;
  if (chg >= 3) score += 8;
  if (chg >= 6) score += 10;
  if (chg >= 10) score += 12;
  if (getCloseNearHigh(q)) score += 12;
  if (rangePct >= 4) score += 10;
  if (rangePct >= 7) score += 10;
  if (Number(q.regularMarketPrice || 0) > 0 && Number(q.regularMarketPrice || 0) <= 35) score += 8;

  if (marketCap > 0) {
    if (marketCap < 2e9) score += 12;
    else if (marketCap < 10e9) score += 8;
    else if (marketCap > 100e9) score -= 6;
  }

  if (fundamentalQuality >= 60) score += 8;
  if (fundamentalQuality >= 80) score += 8;

  return Math.max(0, Math.min(100, Math.round(score)));
}

function getBreakoutScore(q) {
  const volx = getVolumeRatio(q);
  const chg = Number(q.regularMarketChangePercent || 0);
  const dayRange = getDayRangePercent(q);
  const closeNearHigh = getCloseNearHigh(q);

  let score = 0;
  if (volx >= 1.2) score += 14;
  if (volx >= 2.0) score += 12;
  if (chg >= 2) score += 12;
  if (chg >= 5) score += 12;
  if (closeNearHigh) score += 18;
  if (dayRange >= 3.5) score += 12;
  if (dayRange >= 6) score += 10;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function buildScanner(quotes) {
  return [...quotes]
    .filter(q => q.regularMarketPrice != null)
    .filter(q => Math.abs(Number(q.regularMarketChangePercent || 0)) >= 2.5)
    .sort((a, b) => Number(b.regularMarketChangePercent || 0) - Number(a.regularMarketChangePercent || 0))
    .slice(0, 20)
    .map(q => ({
      symbol: q.symbol,
      shortName: q.shortName,
      price: q.regularMarketPrice,
      changePercent: q.regularMarketChangePercent,
      volumeRatio: getVolumeRatio(q),
      marketCap: q.marketCap
    }));
}

function buildWhales(quotes) {
  return [...quotes]
    .filter(q => q.regularMarketPrice != null)
    .map(q => ({
      ...q,
      whaleScore: getWhaleScore(q)
    }))
    .filter(q => q.whaleScore >= 52 && getVolumeRatio(q) >= 1.0 && Number(q.regularMarketChangePercent || 0) >= 1.2)
    .sort((a, b) => b.whaleScore - a.whaleScore)
    .slice(0, 20)
    .map(q => ({
      symbol: q.symbol,
      shortName: q.shortName,
      price: q.regularMarketPrice,
      changePercent: q.regularMarketChangePercent,
      volumeRatio: getVolumeRatio(q),
      whaleScore: q.whaleScore
    }));
}

function buildBreakouts(quotes) {
  return [...quotes]
    .filter(q => q.regularMarketPrice != null)
    .map(q => ({
      ...q,
      breakoutScore: getBreakoutScore(q)
    }))
    .filter(q => q.breakoutScore >= 50 && getVolumeRatio(q) >= 1.0 && Number(q.regularMarketChangePercent || 0) >= 1.8)
    .sort((a, b) => b.breakoutScore - a.breakoutScore)
    .slice(0, 20)
    .map(q => ({
      symbol: q.symbol,
      shortName: q.shortName,
      price: q.regularMarketPrice,
      changePercent: q.regularMarketChangePercent,
      volumeRatio: getVolumeRatio(q),
      breakoutScore: q.breakoutScore
    }));
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "marketpulse-pro-clean",
    timestamp: new Date().toISOString()
  });
});

app.get("/api/index", async (req, res) => {
  try {
    const quotes = await fetchYahooQuotes(HEADER_SYMBOLS);
    res.json({
      ok: true,
      data: quotes
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      data: [],
      error: error.message
    });
  }
});

app.get("/api/quotes", async (req, res) => {
  try {
    const symbols = parseSymbols(req.query.symbols || "");
    const finalSymbols = symbols.length ? symbols : MARKET_SYMBOLS;
    const quotes = await fetchYahooQuotes(finalSymbols);
    res.json({
      ok: true,
      data: quotes
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      data: [],
      error: error.message
    });
  }
});

app.get("/api/intraday", async (req, res) => {
  try {
    const symbols = parseSymbols(req.query.symbols || "");
    const finalSymbols = symbols.length ? symbols : MARKET_SYMBOLS.slice(0, 20);
    const interval = String(req.query.interval || "5m");
    const range = String(req.query.range || "1d");
    const includePrePost = String(req.query.includePrePost || "true") !== "false";
    const data = await fetchIntradayForSymbols(finalSymbols, interval, range, includePrePost);

    res.json({
      ok: true,
      data
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      data: [],
      error: error.message
    });
  }
});

app.get("/api/fundamentals", (req, res) => {
  const symbols = parseSymbols(req.query.symbols || "");
  const data = symbols.length
    ? symbols.map((s) => ({ symbol: s, ...(getFundamental(s) || {}) })).filter((x) => x.theme)
    : Object.entries(FUNDAMENTAL_DB).map(([symbol, item]) => ({ symbol, ...item }));

  res.json({
    ok: true,
    data
  });
});

app.get("/api/scanner", async (req, res) => {
  try {
    const quotes = await fetchYahooQuotes(MARKET_SYMBOLS);
    res.json({
      ok: true,
      data: buildScanner(quotes)
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      data: [],
      error: error.message
    });
  }
});

app.get("/api/whales", async (req, res) => {
  try {
    const quotes = await fetchYahooQuotes(MARKET_SYMBOLS);
    res.json({
      ok: true,
      data: buildWhales(quotes)
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      data: [],
      error: error.message
    });
  }
});

app.get("/api/breakouts", async (req, res) => {
  try {
    const quotes = await fetchYahooQuotes(MARKET_SYMBOLS);
    res.json({
      ok: true,
      data: buildBreakouts(quotes)
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      data: [],
      error: error.message
    });
  }
});

app.use((req, res) => {
  res.status(404).json({
    ok: false,
    error: "Not found"
  });
});

app.listen(PORT, () => {
  console.log(`MarketPulse Pro Clean running on port ${PORT}`);
});
