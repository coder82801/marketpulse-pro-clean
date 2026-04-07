const express = require("express");
const cors = require("cors");
const path = require("path");
const fetch = require("node-fetch");

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const PORT = process.env.PORT || 10000;

const ALPACA_API_KEY = process.env.ALPACA_API_KEY || "";
const ALPACA_SECRET_KEY = process.env.ALPACA_SECRET_KEY || "";
const ALPACA_FEED = process.env.ALPACA_FEED || "iex";

const INDEX_SYMBOLS = ["SPY", "QQQ", "IWM", "DIA"];
const VIX_PROXY_SYMBOL = "UVXY";

/**
 * V1 için genişletilmiş aktif evren.
 * Bu hâlâ "tüm ABD piyasası" değil ama önceki sürümden çok daha geniş.
 * Sonraki aşamada Alpaca assets endpoint ile tam evren kurabiliriz.
 */
const STOCK_UNIVERSE = [
  "AAPL","MSFT","NVDA","AMD","TSLA","META","AMZN","GOOGL","AVGO","NFLX",
  "PLTR","ARM","SMCI","MU","INTC","QCOM","ADBE","CRM","NOW","SHOP",
  "SNOW","NET","DDOG","MDB","ZS","CRWD","PANW","S","PATH","APP",
  "UPST","AFRM","SOFI","HOOD","COIN","MSTR","MARA","RIOT","CLSK","HUT",
  "IONQ","RGTI","QBTS","QUBT","SOUN","BBAI","AI","SERV","TEM","RXRX",
  "LUNR","RKLB","ASTS","PL","ACHR","JOBY","NNE","OKLO","SMR","ENVX",
  "QS","EOSE","KULR","MVIS","LIDR","LCID","RIVN","NIO","FUBO","CAVA",
  "CELH","HIMS","VKTX","CLOV","PLUG","RR","CTMX","SOPA","BKSY","OPEN",
  "INTA","GTLB","DUOL","ABNB","UBER","DASH","PYPL","SQ","ROKU","TTD",
  "DOCU","MRVL","ANET","VRT","ASML","TSM","NVO","LLY","PFE","MRNA",
  "JNJ","XOM","CVX","SLB","HAL","FCX","NEM","GOLD","U","RBLX",
  "BITF","CIFR","IREN","CFLT","ESTC","MNDY","ONON","DKNG","PINS","ETSY",
  "FSLR","ENPH","SEDG","RUN","ARRY","BE","CHPT","BLNK","QS","ENVX",
  "WULF","MIGI","CAN","BTBT","CORZ","IREN","BITF","CIFR","HIMS","OSCR",
  "GME","AMC","BB","PLTR","SOUN","BBAI","AI","SMR","OKLO","NNE"
];

let dashboardCache = {
  generatedAt: null,
  source: "none",
  index: [],
  broadMovers: [],
  movers5: [],
  whales: [],
  breakouts: [],
  accumulation: [],
  counts: {
    totalQuotes: 0,
    movers3: 0,
    movers5: 0
  },
  error: null
};

let refreshInProgress = false;

function hasAlpacaKeys() {
  return Boolean(ALPACA_API_KEY && ALPACA_SECRET_KEY);
}

function getAlpacaHeaders() {
  return {
    accept: "application/json",
    "APCA-API-KEY-ID": ALPACA_API_KEY,
    "APCA-API-SECRET-KEY": ALPACA_SECRET_KEY
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function toNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

async function safeFetchJson(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
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

async function fetchAlpacaSnapshots(symbols) {
  if (!hasAlpacaKeys() || !symbols.length) return {};

  const output = {};

  for (const batch of chunk(symbols, 200)) {
    const url =
      `https://data.alpaca.markets/v2/stocks/snapshots?symbols=${encodeURIComponent(batch.join(","))}` +
      `&feed=${encodeURIComponent(ALPACA_FEED)}`;

    const data = await safeFetchJson(url, {
      headers: getAlpacaHeaders()
    });

    const snapshots = data?.snapshots || {};
    for (const [symbol, snap] of Object.entries(snapshots)) {
      output[symbol] = snap;
    }

    await sleep(40);
  }

  return output;
}

async function fetchAlpacaDailyBars(symbols, days = 12) {
  if (!hasAlpacaKeys() || !symbols.length) return {};

  const output = {};
  const now = new Date();
  const end = now.toISOString();
  const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();

  for (const batch of chunk(symbols, 100)) {
    const url =
      `https://data.alpaca.markets/v2/stocks/bars?symbols=${encodeURIComponent(batch.join(","))}` +
      `&timeframe=1Day&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}` +
      `&adjustment=raw&feed=${encodeURIComponent(ALPACA_FEED)}&sort=asc&limit=10000`;

    const data = await safeFetchJson(url, {
      headers: getAlpacaHeaders()
    });

    const barsMap = data?.bars || {};
    for (const [symbol, bars] of Object.entries(barsMap)) {
      output[symbol] = Array.isArray(bars) ? bars : [];
    }

    await sleep(40);
  }

  return output;
}

function averageVolumeFromBars(bars = []) {
  const vols = bars.map((b) => toNumber(b.v, 0)).filter((x) => x > 0);
  if (!vols.length) return 0;
  return vols.reduce((a, b) => a + b, 0) / vols.length;
}

function normalizeSnapshot(symbol, snapshot, barsMap) {
  const latestTrade = snapshot?.latestTrade || {};
  const minuteBar = snapshot?.minuteBar || {};
  const dailyBar = snapshot?.dailyBar || {};
  const prevDailyBar = snapshot?.prevDailyBar || {};
  const bars = barsMap[symbol] || [];

  const price =
    toNumber(latestTrade.p, null) ??
    toNumber(minuteBar.c, null) ??
    toNumber(dailyBar.c, null);

  const prevClose = toNumber(prevDailyBar.c, null);

  const changePercent =
    price != null && prevClose != null && prevClose !== 0
      ? ((price - prevClose) / prevClose) * 100
      : 0;

  return {
    symbol,
    shortName: symbol,
    price,
    changePercent,
    open: toNumber(dailyBar.o, null),
    high: toNumber(dailyBar.h, null),
    low: toNumber(dailyBar.l, null),
    prevClose,
    volume: toNumber(dailyBar.v, 0),
    avgVolume: averageVolumeFromBars(bars),
    latestTrade,
    minuteBar,
    dailyBar,
    prevDailyBar
  };
}

function getVolumeRatio(q) {
  const vol = Number(q.volume || 0);
  const avg = Number(q.avgVolume || 0);
  if (!avg) return 0;
  return vol / avg;
}

function getDayRangePercent(q) {
  const high = Number(q.high || 0);
  const low = Number(q.low || 0);
  const prevClose = Number(q.prevClose || 0);
  if (!high || !low || !prevClose || high <= low) return 0;
  return ((high - low) / prevClose) * 100;
}

function getCloseLocation(q) {
  const high = Number(q.high || 0);
  const low = Number(q.low || 0);
  const price = Number(q.price || 0);
  if (!high || !low || !price || high <= low) return 0;
  return (price - low) / (high - low);
}

function getMinuteImpulse(q) {
  const minuteOpen = toNumber(q.minuteBar?.o, null);
  const minuteClose = toNumber(q.minuteBar?.c, null);
  if (minuteOpen == null || minuteClose == null || minuteOpen === 0) return 0;
  return ((minuteClose - minuteOpen) / minuteOpen) * 100;
}

function getPrevDailyBreak(q) {
  const prevHigh = toNumber(q.prevDailyBar?.h, null);
  const price = Number(q.price || 0);
  if (prevHigh == null || !price) return false;
  return price > prevHigh;
}

function calcWhaleScore(q) {
  const changePct = Number(q.changePercent || 0);
  const volRatio = getVolumeRatio(q);
  const rangePct = getDayRangePercent(q);
  const closeLoc = getCloseLocation(q);
  const minuteImpulse = getMinuteImpulse(q);

  let score = 0;
  if (changePct >= 5) score += 14;
  if (changePct >= 8) score += 10;
  if (changePct >= 12) score += 8;
  if (volRatio >= 1.2) score += 10;
  if (volRatio >= 1.8) score += 12;
  if (volRatio >= 2.5) score += 12;
  if (rangePct >= 4) score += 10;
  if (rangePct >= 7) score += 8;
  if (closeLoc >= 0.65) score += 10;
  if (closeLoc >= 0.8) score += 8;
  if (minuteImpulse >= 0.2) score += 4;
  if (minuteImpulse >= 0.5) score += 4;

  return Math.max(0, Math.min(100, Math.round(score)));
}

function calcBreakoutScore(q) {
  const changePct = Number(q.changePercent || 0);
  const volRatio = getVolumeRatio(q);
  const rangePct = getDayRangePercent(q);
  const closeLoc = getCloseLocation(q);
  const brokePrevDaily = getPrevDailyBreak(q);

  let score = 0;
  if (changePct >= 5) score += 14;
  if (changePct >= 8) score += 10;
  if (changePct >= 12) score += 8;
  if (volRatio >= 1.2) score += 10;
  if (volRatio >= 1.8) score += 12;
  if (rangePct >= 4) score += 10;
  if (rangePct >= 7) score += 10;
  if (closeLoc >= 0.72) score += 14;
  if (closeLoc >= 0.85) score += 10;
  if (brokePrevDaily) score += 12;

  return Math.max(0, Math.min(100, Math.round(score)));
}

function calcAccumulationScore(q) {
  const changePct = Number(q.changePercent || 0);
  const volRatio = getVolumeRatio(q);
  const rangePct = getDayRangePercent(q);
  const closeLoc = getCloseLocation(q);

  let score = 0;
  if (changePct >= 3 && changePct <= 9) score += 18;
  if (changePct > 9 && changePct <= 13) score += 8;
  if (volRatio >= 1.2) score += 12;
  if (volRatio >= 1.7) score += 12;
  if (volRatio >= 2.2) score += 8;
  if (rangePct >= 2.5 && rangePct <= 8.5) score += 12;
  if (rangePct > 8.5 && rangePct <= 12) score += 6;
  if (closeLoc >= 0.7) score += 16;
  if (closeLoc >= 0.85) score += 10;

  return Math.max(0, Math.min(100, Math.round(score)));
}

function buildBroadMovers(quotes) {
  return quotes
    .filter((q) => Number(q.price || 0) > 0.3)
    .filter((q) => Number(q.changePercent || 0) >= 3)
    .sort((a, b) => Number(b.changePercent || 0) - Number(a.changePercent || 0))
    .slice(0, 50)
    .map((q) => ({
      symbol: q.symbol,
      shortName: q.shortName,
      price: q.price,
      changePercent: q.changePercent,
      volumeRatio: getVolumeRatio(q),
      rangePercent: getDayRangePercent(q)
    }));
}

function buildMovers5(quotes) {
  return quotes
    .filter((q) => Number(q.price || 0) > 0.3)
    .filter((q) => Number(q.changePercent || 0) >= 5)
    .sort((a, b) => Number(b.changePercent || 0) - Number(a.changePercent || 0))
    .slice(0, 50)
    .map((q) => ({
      symbol: q.symbol,
      shortName: q.shortName,
      price: q.price,
      changePercent: q.changePercent,
      volumeRatio: getVolumeRatio(q),
      rangePercent: getDayRangePercent(q)
    }));
}

function buildWhales(quotes) {
  return quotes
    .filter((q) => Number(q.price || 0) > 0.3)
    .filter((q) => Number(q.changePercent || 0) >= 5)
    .map((q) => ({ ...q, whaleScore: calcWhaleScore(q) }))
    .filter((q) => q.whaleScore >= 52)
    .sort((a, b) => b.whaleScore - a.whaleScore)
    .slice(0, 25)
    .map((q) => ({
      symbol: q.symbol,
      shortName: q.shortName,
      price: q.price,
      changePercent: q.changePercent,
      volumeRatio: getVolumeRatio(q),
      rangePercent: getDayRangePercent(q),
      whaleScore: q.whaleScore
    }));
}

function buildBreakouts(quotes) {
  return quotes
    .filter((q) => Number(q.price || 0) > 0.3)
    .filter((q) => Number(q.changePercent || 0) >= 5)
    .map((q) => ({ ...q, breakoutScore: calcBreakoutScore(q) }))
    .filter((q) => q.breakoutScore >= 54)
    .sort((a, b) => b.breakoutScore - a.breakoutScore)
    .slice(0, 25)
    .map((q) => ({
      symbol: q.symbol,
      shortName: q.shortName,
      price: q.price,
      changePercent: q.changePercent,
      volumeRatio: getVolumeRatio(q),
      rangePercent: getDayRangePercent(q),
      breakoutScore: q.breakoutScore
    }));
}

function buildAccumulation(quotes) {
  return quotes
    .filter((q) => Number(q.price || 0) > 0.3)
    .filter((q) => Number(q.changePercent || 0) >= 3)
    .map((q) => ({ ...q, accumulationScore: calcAccumulationScore(q) }))
    .filter((q) => q.accumulationScore >= 52)
    .sort((a, b) => b.accumulationScore - a.accumulationScore)
    .slice(0, 25)
    .map((q) => ({
      symbol: q.symbol,
      shortName: q.shortName,
      price: q.price,
      changePercent: q.changePercent,
      volumeRatio: getVolumeRatio(q),
      rangePercent: getDayRangePercent(q),
      accumulationScore: q.accumulationScore
    }));
}

async function buildDashboard() {
  if (!hasAlpacaKeys()) {
    throw new Error("ALPACA_API_KEY / ALPACA_SECRET_KEY eksik");
  }

  const symbolsForAll = [...new Set([...STOCK_UNIVERSE, ...INDEX_SYMBOLS, VIX_PROXY_SYMBOL])];
  const snapshots = await fetchAlpacaSnapshots(symbolsForAll);
  const barsMap = await fetchAlpacaDailyBars(symbolsForAll, 12);

  const allQuotes = symbolsForAll
    .map((symbol) => {
      const snap = snapshots[symbol];
      if (!snap) return null;
      return normalizeSnapshot(symbol, snap, barsMap);
    })
    .filter((x) => x && x.price != null);

  const quoteMap = Object.fromEntries(allQuotes.map((q) => [q.symbol, q]));

  const index = [];
  for (const sym of INDEX_SYMBOLS) {
    const q = quoteMap[sym];
    if (q) {
      index.push({
        symbol: q.symbol,
        price: q.price,
        changePercent: q.changePercent
      });
    }
  }

  const vixProxy = quoteMap[VIX_PROXY_SYMBOL];
  if (vixProxy) {
    index.push({
      symbol: "VIX*",
      price: vixProxy.price,
      changePercent: vixProxy.changePercent
    });
  }

  const tradeQuotes = allQuotes.filter((q) => STOCK_UNIVERSE.includes(q.symbol));

  const broadMovers = buildBroadMovers(tradeQuotes);
  const movers5 = buildMovers5(tradeQuotes);
  const whales = buildWhales(tradeQuotes);
  const breakouts = buildBreakouts(tradeQuotes);
  const accumulation = buildAccumulation(tradeQuotes);

  return {
    generatedAt: new Date().toISOString(),
    source: `alpaca-${ALPACA_FEED}`,
    index,
    broadMovers,
    movers5,
    whales,
    breakouts,
    accumulation,
    counts: {
      totalQuotes: tradeQuotes.length,
      movers3: broadMovers.length,
      movers5: movers5.length
    },
    error: null
  };
}

async function refreshDashboardCache() {
  if (refreshInProgress) return;
  refreshInProgress = true;

  try {
    dashboardCache = await buildDashboard();
    console.log("Dashboard cache refreshed:", dashboardCache.generatedAt);
  } catch (error) {
    console.error("Dashboard refresh error:", error.message);
    dashboardCache = {
      ...dashboardCache,
      generatedAt: new Date().toISOString(),
      error: error.message
    };
  } finally {
    refreshInProgress = false;
  }
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/health", (req, res) => {
  res.json({
    ok: !dashboardCache.error,
    alpacaConfigured: hasAlpacaKeys(),
    feed: ALPACA_FEED,
    generatedAt: dashboardCache.generatedAt,
    error: dashboardCache.error
  });
});

app.get("/api/dashboard", (req, res) => {
  res.json({
    ok: !dashboardCache.error,
    ...dashboardCache
  });
});

refreshDashboardCache();
setInterval(refreshDashboardCache, 2500);

app.listen(PORT, () => {
  console.log(`MarketPulse Pro running on port ${PORT}`);
});
