const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

function buildPatterns() {
  return Array.isArray(packageJson.build?.files) ? packageJson.build.files : [];
}

test('electron package includes extracted main-process modules', () => {
  assert.ok(buildPatterns().includes('main/**/*.js'));
  const mainDir = path.join(root, 'main');
  for (const name of fs.readdirSync(mainDir)) {
    if (!name.endsWith('.js')) continue;
    assert.ok(fs.statSync(path.join(mainDir, name)).isFile(), `main/${name} must be a file`);
  }
});

test('main process imports resolve from the working tree', () => {
  const source = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  const imports = [...source.matchAll(/require\(['"](\.\/main\/[^'"]+)['"]\)/g)].map((match) => match[1]);
  assert.ok(imports.length > 0);
  for (const importPath of imports) {
    assert.equal(fs.existsSync(path.join(root, `${importPath}.js`)), true, `${importPath} must resolve`);
  }
});
