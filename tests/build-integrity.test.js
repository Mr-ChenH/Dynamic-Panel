const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

function buildPatterns() {
  return Array.isArray(packageJson.build?.files) ? packageJson.build.files : [];
}

function javascriptFilesUnder(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...javascriptFilesUnder(absolute));
    else if (entry.isFile() && entry.name.endsWith('.js')) files.push(absolute);
  }
  return files;
}

test('electron package includes extracted main-process modules', () => {
  assert.ok(buildPatterns().includes('main/**/*.js'));
  for (const file of javascriptFilesUnder(path.join(root, 'main'))) {
    assert.equal(fs.statSync(file).isFile(), true, `${path.relative(root, file)} must be a file`);
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
