import assert from "node:assert/strict";
import fs from "node:fs";

const page = fs.readFileSync(new URL("../indexes/library/index.html", import.meta.url), "utf8");
const script = fs.readFileSync(new URL("../assets/js/corbanu-index-library.js", import.meta.url), "utf8");
const builder = fs.readFileSync(new URL("../indexes/index.html", import.meta.url), "utf8");

assert.match(page, /id="index-library-grid"/);
assert.match(page, /Download.*replay recipe/i);
assert.match(page, /licensed transcript bodies are not embedded/i);
assert.match(page, /corbanu-index-library\.js\?v=2/);
assert.match(script, /fetchJson\("\/v1\/indexes"\)/);
assert.match(script, /row\.replay_recipe_path/);
assert.match(script, /row\.artifact_path/);
assert.match(script, /Strict replay/);
assert.doesNotMatch(script, /Prior profile/);
assert.doesNotMatch(script, /innerHTML/);
assert.match(builder, /href="\/indexes\/library\/"/);
