// Pull the identity fields out of the saved Instagram / Facebook / Google-Maps
// page dumps. Reads only the local captured HTML; nothing is re-fetched.
const fs = require("fs");
const path = require("path");

const DIR = "C:/Users/USER/.qoder/tmp/C--Users-USER-Documents-Qoder-2026-11-14-355d3de8/tool-outputs/session-355d3de8-9282-4bad-a760-212ffc122ab0";
const OUT = path.resolve(__dirname, "..", "research");

function read(f) { return fs.readFileSync(path.join(DIR, f), "utf8"); }

function findAll(re, s, limit = 40) {
  const out = [];
  let m;
  while ((m = re.exec(s)) && out.length < limit) out.push(m[0]);
  return out;
}

const report = {};

// --- Instagram -----------------------------------------------------------
const ig = read("webfetch-b6f497c5-7f17-40bb-a8a6-60057e9d6672.md");
report.instagram = {
  bio: findAll(/"biography":"(?:[^"\\]|\\.)*"/g, ig, 3),
  fullName: findAll(/"full_name":"(?:[^"\\]|\\.)*"/g, ig, 3),
  externalUrl: findAll(/"external_url":"(?:[^"\\]|\\.)*"/g, ig, 3),
  followerCount: findAll(/"follower_count":\d+/g, ig, 3),
  followingCount: findAll(/"following_count":\d+/g, ig, 3),
  mediaCount: findAll(/"media_count":\d+/g, ig, 3),
  timelineCount: findAll(/edge_owner_to_timeline_media\\?":\{\\?"count\\?":\d+/g, ig, 3),
  isPrivate: findAll(/"is_private":(true|false)/g, ig, 3),
  verified: findAll(/"is_verified":(true|false)/g, ig, 3),
  postCaptions: findAll(/"is_pinned":(?:true|false),"product_type":"[^"]*"[^]{0,40}/g, ig, 2),
  captionTexts: findAll(/"caption":"(?:[^"\\]|\\.){0,300}/g, ig, 12),
  edgeCaptions: findAll(/"edge_media_to_caption\\?":\{\\?"edges\\?":\[\{\\?"node\\?":\{\\?"text\\?":"(?:[^"\\]|\\.){0,400}/g, ig, 12),
};

// --- Facebook ------------------------------------------------------------
const fb = read("webfetch-5dec0b33-9c2a-4e45-af14-c48f0a79bb6f.md");
report.facebook = {
  about: findAll(/Habibi Haven is a modern[^"]{0,600}/g, fb, 2),
  names: findAll(/"name":"Habibi[^"]{0,60}"/g, fb, 5),
  category: findAll(/"category":\{"name":"(?:[^"\\]|\\.)*"\}/g, fb, 3),
  priceRange: findAll(/"price_range":"(?:[^"\\]|\\.)*"/g, fb, 2),
  ratingCount: findAll(/"rating_count":\d+/g, fb, 3),
  recommendCount: findAll(/"recommendation_count":\d+/g, fb, 3),
  followers: findAll(/"followers(?:_count)?\\?":\s*\{?"?count"?:?\d+|"follower_count":\d+/g, fb, 5),
  phone: findAll(/"phone":"(?:[^"\\]|\\.)*"|"\+254[0-9 ]{6,15}"/g, fb, 4),
  address: findAll(/Koinange[^"]{0,120}/g, fb, 4),
  website: findAll(/"link":"https:\/\/[^"]*habibi[^"]*"/gi, fb, 5),
  urls: findAll(/menu\.or\.ke[^"'\\ ]{0,60}/g, fb, 5),
};

// --- Google Maps ---------------------------------------------------------
const gm = read("webfetch-6da74d58-8b63-4629-8e03-a05463ebf48b.md");
report.maps = {
  title: findAll(/"title":"Habibi[^"]{0,80}"/g, gm, 3),
  rating: findAll(/"rating":[0-9.]+/g, gm, 5),
  reviews: findAll(/"reviews":\{?"?count"?:?\d+|"review_count":\d+|\d+\s+reviews/g, gm, 8),
  address: findAll(/D[0-9,"]{2,8}Koinange[^"]{0,80}|Koinange Street[^"]{0,80}/g, gm, 6),
  hours: findAll(/(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[^"]{0,60}(?:am|pm)[^"]{0,40}/g, gm, 12),
  phone: findAll(/\+254\s?1[0-9][0-9 ]{5,12}/g, gm, 4),
  category: findAll(/"type":"[^"]{3,40}"|Restaurant/g, gm, 6),
  attributeHits: findAll(/"name":"(?:Dine-in|Takeaway|No delivery|Outdoor seating|Full delivery|Delivery|Reservations|Good for kids|Wheelchair accessible[^"]*)"[^]{0,60}/g, gm, 20),
};

fs.writeFileSync(path.join(OUT, "identity-raw.json"), JSON.stringify(report, null, 1));
console.log(JSON.stringify(report, null, 1).slice(0, 6000));
