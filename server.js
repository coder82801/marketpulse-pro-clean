
const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.static(__dirname));

const PORT = process.env.PORT || 3000;

// 🔹 YAHOO QUOTE
async function fetchQuotes(symbols) {
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbols.join(",")}`;
  const res = await fetch(url);
  const data = await res.json();
  return data.quoteResponse.result || [];
}

// 🔹 SCANNER (TOP MOVERS)
app.get("/api/scanner", async (req, res) => {
  try {
    const symbols = [
      "AAPL","TSLA","NVDA","AMD","PLTR","SOUN","RGTI","IONQ","META","AMZN"
    ];

    const data = await fetchQuotes(symbols);

    const sorted = data
      .filter(x => x.regularMarketPrice)
      .sort((a, b) => b.regularMarketChangePercent - a.regularMarketChangePercent);

    res.json(sorted);
  } catch (e) {
    res.status(500).json({ error: "scanner error" });
  }
});

// 🔹 QUOTES
app.get("/api/quotes", async (req, res) => {
  try {
    const symbols = req.query.symbols?.split(",") || [];
    const data = await fetchQuotes(symbols);
    res.json(data);
  } catch {
    res.status(500).json([]);
  }
});

// 🔹 WHALE (basit volume spike)
app.get("/api/whales", async (req, res) => {
  const symbols = ["TSLA","NVDA","AMD","PLTR","SOUN"];
  const data = await fetchQuotes(symbols);

  const whales = data.filter(x =>
    x.regularMarketVolume > 10000000 &&
    Math.abs(x.regularMarketChangePercent) > 2
  );

  res.json(whales);
});

// 🔹 NEXT MOVE
app.get("/api/breakouts", async (req, res) => {
  const symbols = ["IONQ","RGTI","QBTS","PLTR","SOUN"];
  const data = await fetchQuotes(symbols);

  const breakout = data.filter(x =>
    x.regularMarketChangePercent > 3
  );

  res.json(breakout);
});

// 🔹 MARKET INDEX
app.get("/api/index", async (req, res) => {
  const symbols = ["SPY","QQQ","IWM","^VIX"];
  const data = await fetchQuotes(symbols);
  res.json(data);
});

app.listen(PORT, () => console.log("MarketPulse Pro running"));
