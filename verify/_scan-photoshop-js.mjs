// dsh scratch: scan Adobe's UXP photoshop.js for background-layer handling and `set` descriptor spellings.
import fs from "node:fs";

const p = "D:\\software\\Adobe Photoshop 2026\\Required\\UXP\\photoshop.js";
const s = fs.readFileSync(p, "utf8");
console.log("bytes", s.length);

function count(pat) {
  let n = 0, i = -1;
  while ((i = s.indexOf(pat, i + 1)) >= 0) n++;
  return n;
}
function show(pat, before = 220, after = 220, max = 3) {
  console.log("\n=== " + pat + "  occurrences=" + count(pat));
  let i = -1, c = 0;
  while ((i = s.indexOf(pat, i + 1)) >= 0 && c < max) {
    console.log("--- @" + i);
    console.log(s.slice(Math.max(0, i - before), i + after).replace(/\n/g, " "));
    c++;
  }
}

show("backgroundLayer");
show("isBackgroundLayer");
show("_obj:\"set\"", 200, 200, 4);
show("_obj: \"set\"", 200, 200, 4);
show("\"set\"", 120, 160, 4);
