const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.static(__dirname)); // index.html serve

const PORT = process.env.PORT || 10000;

/* =========================
   ALPACA CONFIG
========================= */

const API_KEY = process.env.ALPACA_API_KEY;
const SECRET_KEY = process.env.ALPACA_SECRET_KEY;

const WS_URL = "wss://stream.data.alpaca.markets/v2/iex";

/* =========================
   CACHE
========================= */

let marketData = {};
let lastUpdate = Date.now();

/* =========================
   SYMBOLS
========================= */

const SYMBOLS = [
  "AAPL","TSLA","NVDA","AMD","META","AMZN","PLTR","IONQ","SOFI","RGTI",
  "QBTS","BBAI","SMCI","COIN","MARA","RIOT","RKLB","ASTS","ACHR","JOBY",
  "SOUN","ENVX","QS","LCID","RIVN","NIO","FUBO","CLOV","AFRM","UPST"
];

/* =========================
   WEBSOCKET
========================= */

function connectAlpaca() {
  const WebSocket = require("ws");
  const ws = new WebSocket(WS_URL);

  ws.on("open", () => {
    console.log("WS connected");

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
          price: item.p
        };
      }
    });

    lastUpdate = Date.now();
  });

  ws.on("close", () => {
    console.log("reconnecting...");
    setTimeout(connectAlpaca, 2000);
  });

  ws.on("error", (err) => {
    console.log("WS error", err.message);
  });
}

connectAlpaca();

/* =========================
   DATA MODEL
========================= */

function buildData() {
  return Object.keys(marketData).map(symbol => {
    return {
      symbol,
      price: marketData[symbol].price,
      changePercent: (Math.random() * 10), // geçici
      volumeRatio: (Math.random() * 5)
    };
  });
}

function scanner(data) {
  return data.filter(x => x.changePercent >= 5);
}

function whales(data) {
  return data.map(x => ({
    ...x,
    score: x.volumeRatio * 20 + x.changePercent * 3
  })).filter(x => x.score > 40);
}

function breakout(data) {
  return data.map(x => ({
    ...x,
    score: x.changePercent * 5 + x.volumeRatio * 10
  })).filter(x => x.score > 50);
}

function accumulation(data) {
  return data.map(x => ({
    ...x,
    score: x.volumeRatio * 10 - x.changePercent
  })).filter(x => x.score > 10);
}

/* =========================
   ROUTES
========================= */

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/api/all", (req, res) => {
  const data = buildData();

  res.json({
    scanner: scanner(data),
    whales: whales(data),
    breakout: breakout(data),
    accumulation: accumulation(data),
    lastUpdate
  });
});

/* ========================= */

app.listen(PORT, () => {
  console.log("Server running on", PORT);
});
