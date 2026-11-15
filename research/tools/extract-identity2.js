// Widen the identity extraction: full Facebook "about" paragraph, Instagram
// counters + post captions, from the already-saved page dumps.
const fs = require("fs");
const path = require("path");
const DIR = "C:/Users/USER/.qoder/tmp/C--Users-USER-Documents-Qoder-2026-11-14-355d3de8/tool-outputs/session-355d3de8-9282-4bad-a760-212ffc122ab0";
const OUT = path.resolve(__dirname, "..", "research");
const unesc = (s) => s.replace(/\\\\u([0-9a-f]{4})/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/\\\\n/g, "\n").replace(/\\\\/g, "\\");

const fb = fs.readFileSync(path.join(DIR, "webfetch-5dec0b33-9c2a-4e45-af14-c48f0a79bb6f.md"), "utf8");
const ig = fs.readFileSync(path.join(DIR, "webfetch-b6f497c5-7f17-40bb-a8a6-60057e9d6672.md"), "utf8");

const out = {};

// Facebook about: capture until the JSON string closes.
const aboutRe = /Habibi Haven is a modern[^"]*?(?:"|\\")/g;
const abouts = [];
let m;
while ((m = aboutRe.exec(fb)) && abouts.length < 3) abouts.push(unesc(m[0]));
out.facebookAbout = abouts;

// Any other long descriptive text on the FB page.
out.facebookDesc = [...new Set([...fb.matchAll(/"(?:description|about|bio)":"((?:[^"\\]|\\.){40,900})"/g)].map((x) => unesc(x[1])))].slice(0, 8);
out.facebookCounts = [...new Set([...fb.matchAll(/"(?:followers|likeCount|total_count|checkins|rating_count|reviews)\\"?":\s*\{?\\"?(?:count|value)?\\?"?:?\s*(\d{2,9})/g)].map((x) => x[0]))].slice(0, 20);
out.facebookButtons = [...new Set([...fb.matchAll(/"(?:Call|Message|Directions|Website|Menu|Order|Book|See plans|Share|Like)["]/g)].map((x) => x[1]))];
out.facebookPhones = [...new Set([...fb.matchAll(/\+?254[0-9\s-]{7,14}/g)].map((x) => x[0]))].slice(0, 6);
out.facebookLinks = [...new Set([...fb.matchAll(/https?:\/\/(?:www\.)?(?:instagram\.com|tiktok\.com|menu\.or\.ke|ubereats\.com|habibi[^/]*)[^"\\ ]{0,80}/g)].map((x) => x[0]))].slice(0, 12);

// Instagram: counters live in the GraphQL-ish blob.
out.igCounters = [...new Set([...ig.matchAll(/"(?:edge_followed_by|edge_follow|edge_owner_to_timeline_media|followed_by|follower_count|following_count|media_count)\\?":\s*\{?\s*\\?"count\\?"\s*:\s*(\d+)/g)].map((x) => x[0]))].slice(0, 12);
out.igCountersLoose = [...new Set([...ig.matchAll(/(follower_count|following_count|media_count|edge_followed_by)\\?"\s*:\s*\\?"?(\d+)/g)].map((x) => x[0]))].slice(0, 12);
out.igPimgs = [...new Set([...ig.matchAll(/"profile_pic_url":"((?:[^"\\]|\\.)*)"/g)].map((x) => x[1].slice(0, 120)))].slice(0, 2);

// Post captions.
const capRe = /"edge_media_to_caption\\?":\s*\{\\?"edges\\?":\s*\[?\{?\\?"node\\?":\s*\{\\?"text\\?":\\?"((?:[^"\\]|\\.){10,600})/g;
out.igCaptions = [...ig.matchAll(capRe)].map((x) => unesc(x[1])).slice(0, 12);
// Alternative shape used by the newer web data.
const cap2 = /"caption":\{"text":"((?:[^"\\]|\\.){10,600})/g;
out.igCaptions2 = [...ig.matchAll(cap2)].map((x) => unesc(x[1])).slice(0, 12);
out.igShortcodes = [...new Set([...ig.matchAll(/"shortcode":"(\w{8,12})"/g)].map((x) => x[1]))].slice(0, 24);
out.igTypenames = [...new Set([...ig.matchAll(/"__typename":"([^"]+)"/g)].map((x) => x[1]))].slice(0, 12);

fs.writeFileSync(path.join(OUT, "identity-raw.json"), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1).slice(0, 7000));
