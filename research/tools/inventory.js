// Research helper: inventory media refs + image coverage in the captured menu.
const fs = require("fs");
const path = require("path");
const DIR = path.join(__dirname, "..");

const src = fs.readFileSync(path.join(DIR, "menu-structured.json"), "utf8");
const re = /public\/(?:menu-photos|restaurant-photos)\/[^"\\\s]+\.(?:jpg|jpeg|png|webp|avif|mp4)/gi;
const refs = [...new Set([...src.matchAll(re)].map((m) => m[0]))];
const byBucket = {};
for (const r of refs) {
  const b = r.includes("restaurant-photos") ? "restaurant-photos" : "menu-photos";
  byBucket[b] = (byBucket[b] || 0) + 1;
}
console.log("unique media refs:", refs.length, JSON.stringify(byBucket));
console.log("restaurant-photos:");
for (const r of refs.filter((x) => x.includes("restaurant-photos"))) console.log("  " + r.split("/").pop());

const d = JSON.parse(JSON.parse(src));
let total = 0;
let withImg = 0;
let oos = 0;
let withDesc = 0;
const prices = [];
for (const s of d.data) {
  for (const i of s.items) {
    total++;
    if (i.img) withImg++;
    if (i.oos) oos++;
    if (i.desc && i.desc.length > 12) withDesc++;
    const n = parseInt(String(i.price || "").replace(/[^0-9]/g, ""), 10);
    if (Number.isFinite(n)) prices.push(n);
  }
}
prices.sort((a, b) => a - b);
console.log("items:", total, "| with image:", withImg, "| with description:", withDesc, "| out of stock:", oos);
console.log(
  "price KES min:",
  prices[0],
  "median:",
  prices[Math.floor(prices.length / 2)],
  "max:",
  prices[prices.length - 1]
);

const sub = {};
for (const s of d.data) sub[s.heading] = s.items.length;
console.log("sections captured from menu.or.ke:", JSON.stringify(sub));
