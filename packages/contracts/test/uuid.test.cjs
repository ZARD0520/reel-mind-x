const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { randomFillSync } = require('node:crypto');
const ts = require('typescript');

const uuidSource = path.resolve(__dirname, '../src/uuid.ts');
const compiled = ts.transpileModule(fs.readFileSync(uuidSource, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function load(crypto) {
  const exports = {};
  vm.runInNewContext(compiled, { exports, crypto });
  return exports.uuid;
}
const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test('shared UUID preserves native crypto method binding', () => {
  const crypto = { randomUUID() { assert.equal(this, crypto); return '0708613f-4d39-4a75-891e-1501739859f0'; } };
  assert.equal(load(crypto)(), '0708613f-4d39-4a75-891e-1501739859f0');
});

test('HTTP environments without native randomUUID still produce distinct v4 IDs', () => {
  let calls = 0;
  const crypto = { getRandomValues(bytes) { assert.equal(this, crypto); calls++; return randomFillSync(bytes); } };
  const uuid = load(crypto);
  const ids = Array.from({ length: 64 }, () => uuid());
  assert.equal(calls, 64);
  assert(ids.every(id => uuidV4.test(id)));
  assert.equal(new Set(ids).size, ids.length);
});

test('UUID fallback tolerates non-function native APIs and missing crypto', () => {
  for (const crypto of [undefined, {}, { randomUUID: true, getRandomValues: true }]) {
    assert.match(load(crypto)(), uuidV4);
  }
});

test('browser business code does not call randomUUID directly or import Node crypto', () => {
  const repo = path.resolve(__dirname, '../../..');
  const violations = [];
  function scan(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) { scan(filename); continue; }
      if (!/\.tsx?$/.test(filename)) continue;
      const source = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true);
      function visit(node) {
        const expression = ts.isCallExpression(node) ? node.expression : undefined;
        const direct = expression && (
          ts.isPropertyAccessExpression(expression) && expression.name.text === 'randomUUID' ||
          ts.isElementAccessExpression(expression) && ts.isStringLiteral(expression.argumentExpression) && expression.argumentExpression.text === 'randomUUID'
        );
        const nodeCrypto = ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && ['crypto', 'node:crypto'].includes(node.moduleSpecifier.text);
        if (direct || nodeCrypto) violations.push(path.relative(repo, filename) + ':' + (source.getLineAndCharacterOfPosition(node.getStart()).line + 1));
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
  }
  for (const directory of ['apps/web/src', 'apps/admin/src', 'packages/api-client/src']) scan(path.join(repo, directory));
  assert.deepEqual(violations, [], 'Use the shared uuid() helper in browser code');
});
