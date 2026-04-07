const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());

const PORT = process.env.PORT || 10000;

// TEST DATA (şimdilik dummy)
app.get("/api/scanner", (req, res) => {
  res.json([
    { symbol: "NVDA", change: "+5.2%", price: 920 },
    { symbol: "TSLA", change: "+3.8%", price: 180 },
    { symbol: "AMD", change: "+4.1%", price: 162 }
  ]);
});

app.get("/api/whales", (req, res) => {
  res.json([
    { symbol: "AAPL", size: "$12M", type: "CALL" },
    { symbol: "MSFT", size: "$8M", type: "PUT" }
  ]);
});

app.get("/api/breakouts", (req, res) => {
  res.json([
    { symbol: "META", breakout: "Resistance Break" },
    { symbol: "AMZN", breakout: "Volume Spike" }
  ]);
});

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
