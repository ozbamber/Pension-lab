const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const appRoot = path.join(projectRoot, 'app');
const distRoot = path.join(projectRoot, 'dist');
const outputPath = path.join(distRoot, 'pension-lab-he-standalone.html');
const scriptNames = [
  'engine.js',
  'financial-normalizer.js',
  'payslip-parser.js',
  'pension-report-parser.js',
  'pension-input-reconciler.js',
  'local-document-pipeline.js',
  'document-extraction.js',
  'app.js',
];

const html = fs.readFileSync(path.join(appRoot, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(appRoot, 'styles.css'), 'utf8');
const stylesheetPattern = /  <link rel="stylesheet" href="styles\.css"\s*\/>/;

let standalone = html.replace(stylesheetPattern, () => `  <style>\n${css}\n  </style>`);
if (standalone === html) throw new Error('index.html stylesheet marker was not found.');

for (const scriptName of scriptNames) {
  const source = fs.readFileSync(path.join(appRoot, scriptName), 'utf8');
  const escaped = scriptName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`  <script src="${escaped}(?:\\?[^"\\s]*)?"></script>`);
  const next = standalone.replace(pattern, () => `  <script>\n${source}\n  </script>`);
  if (next === standalone) throw new Error(`index.html script marker was not found: ${scriptName}`);
  standalone = next;
}

fs.mkdirSync(distRoot, { recursive: true });
fs.writeFileSync(outputPath, standalone, 'utf8');
console.log(`Built ${path.relative(projectRoot, outputPath)}`);
