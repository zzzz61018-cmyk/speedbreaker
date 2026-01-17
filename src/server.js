import express from "express";
import path from "path";
import { fileURLToPath } from "url";

import bot from "./bot.js";
import first from "./first.js";
import final from "./final.js";


const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve public files
app.use(express.static(path.join(__dirname, "../public")));

// API routes
app.use("/api/bot", bot);
app.use("/api/first", first);
app.use("/api/final", final);

app.get("/api/hello", (req, res) => {
  res.json({ message: "Express with ES Modules works on Vercel 🚀" });
});

// 🚨 DO NOT LISTEN
export default app;
