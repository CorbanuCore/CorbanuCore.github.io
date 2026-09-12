import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
const html=readFileSync(new URL("../indexes/index.html",import.meta.url),"utf8");
const source=readFileSync(new URL("../assets/js/corbanu-index-builder.js",import.meta.url),"utf8");
for (const id of ["builder-api-key","model-choice","prompt-choice","reasoning-effort","deterministic","external-funds","weighting-choice","accept-disclosure","lock-index"]) assert.ok(html.includes(`id="${id}"`));
assert.ok(html.includes('value="market_cap"'));
assert.ok(html.includes('value="market_cap_rank"'));
assert.ok(!html.includes('value="fundamental"'));
assert.ok(!html.includes('rebalance-frequency'));
assert.ok(!html.includes('H200'));
assert.ok(!html.includes('corbanu-index-config.js'));
assert.ok(!html.includes('corbanu-index-contract.js'));
assert.ok(!source.includes('localStorage'));
assert.ok(!source.includes('sessionStorage'));
assert.ok(!source.includes('innerHTML'));
const syntax=ts.createSourceFile("builder.js",source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
function visit(node) {
  assert.notEqual(node.kind,ts.SyntaxKind.RegularExpressionLiteral,"No regex on the model request path");
  if (ts.isNewExpression(node) || ts.isCallExpression(node)) assert.notEqual(node.expression.getText(syntax),"RegExp");
  ts.forEachChild(node,visit);
}
visit(syntax);
