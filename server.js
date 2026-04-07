const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());

const PORT = process.env.PORT || 10000;

/* =========================
   ALPACA CONFIG
========================= */

const API_KEY = process.env.ALPACA_API_KEY;
const SECRET_KEY = process.env.ALPACA_SECRET_KEY;
const FEED = process.env.ALPACA_FEED || "iex";

const WS_URL = "wss://stream.data.alpaca.markets/v2/sip";

/* =========================
   GLOBAL CACHE
========================= */

let marketData = {}; // symbol -> last trade
let lastUpdate = Date.now();

/* =========================
   SYMBOL LIST (GENİŞ)
========================= */

const SYMBOLS = [
  "AAPL","TSLA","NVDA","AMD","META","AMZN","PLTR","IONQ","SOFI","RGTI",
  "QBTS","BBAI","SMCI","COIN","MARA","RIOT","RKLB","ASTS","ACHR","JOBY",
  "SOUN","ENVX","QS","LCID","RIVN","NIO","FUBO","CLOV","AFRM","UPST",
  "NET","SNOW","DDOG","ZS","MDB","ROKU","AI","PATH","S","APP"
];

/* =========================
   WEBSOCKET CONNECT
========================= */

function connectAlpaca() {
  const ws = new (require("ws"))(WS_URL);

  ws.on("open", () => {
    console.log("Alpaca WS connected");

    ws.send(JSON.stringify({
      action: "auth",
      key: API_KEY,
      secret: SECRET_KEY
    }));

    setTimeout(() => {
      ws.send(JSON.stringify({
        action: "subscribe",
        trades: SYMBOLS
      }));
    }, 500);
  });

  ws.on("message", (msg) => {
    const data = JSON.parse(msg.toString());

    data.forEach((item) => {
      if (item.T === "t") {
        marketData[item.S] = {
          price: item.p,
          timestamp: item.t
        };
      }
    });

    lastUpdate = Date.now();
  });

  ws.on("close", () => {
    console.log("WS reconnecting...");
    setTimeout(connectAlpaca, 2000);
  });

  ws.on("error", (err) => {
    console.log("WS error:", err.message);
  });
}

connectAlpaca();

/* =========================
   SCORING MODELS
========================= */

function getRandomChange() {
  return (Math.random() * 12) - 3; // simülasyon fallback
}

function buildDataset() {
  return Object.keys(marketData).map(symbol => {
    const price = marketData[symbol].price;

    const change = getRandomChange(); // şimdilik price change yok → simülasyon
    const vol = Math.random() * 5;

    return {
      symbol,
      price,
      changePercent: change,
      volumeRatio: vol
    };
  });
}

/* =========================
   MODELS
========================= */

function scanner(data) {
  return data
    .filter(x => x.changePercent >= 5)
    .sort((a,b)=>b.changePercent-a.changePercent)
    .slice(0,20);
}

function whales(data) {
  return data
    .map(x => ({
      ...x,
      score: (x.volumeRatio * 20) + (x.changePercent * 3)
    }))
    .filter(x => x.score > 40)
    .sort((a,b)=>b.score-a.score)
    .slice(0,20);
}

function breakout(data) {
  return data
    .map(x => ({
      ...x,
      score: (x.changePercent * 5) + (x.volumeRatio * 10)
    }))
    .filter(x => x.score > 50)
    .sort((a,b)=>b.score-a.score)
    .slice(0,20);
}

function accumulation(data) {
  return data
    .map(x => ({
      ...x,
      score: (x.volumeRatio * 15) - Math.abs(x.changePercent)
    }))
    .filter(x => x.score > 20)
    .sort((a,b)=>b.score-a.score)
    .slice(0,20);
}

/* =========================
   API
========================= */

app.get("/api/all", (req,res)=>{

  const dataset = buildDataset();

  res.json({
    ok:true,
    scanner: scanner(dataset),
    whales: whales(dataset),
    breakout: breakout(dataset),
    accumulation: accumulation(dataset),
    lastUpdate
  });
});

/* ========================= */

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
