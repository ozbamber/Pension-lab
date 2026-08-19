const fs = require('fs');
const path = require('path');

const root = __dirname;
const outputPath = path.resolve(root, '..', 'pension-lab-he-standalone.html');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const engine = fs.readFileSync(path.join(root, 'engine.js'), 'utf8');
const financial = fs.readFileSync(path.join(root, 'financial-normalizer.js'), 'utf8');
const payslip = fs.readFileSync(path.join(root, 'payslip-parser.js'), 'utf8');
const pensionReport = fs.readFileSync(path.join(root, 'pension-report-parser.js'), 'utf8');
const reconciler = fs.readFileSync(path.join(root, 'pension-input-reconciler.js'), 'utf8');
const localDocuments = fs.readFileSync(path.join(root, 'local-document-pipeline.js'), 'utf8');
const documents = fs.readFileSync(path.join(root, 'document-extraction.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

const stylesheetTag = '  <link rel="stylesheet" href="styles.css" />';
const scriptsBlock = '  <script src="engine.js?v=20260819-docs2"></script>\n  <script src="financial-normalizer.js?v=20260819-docs2"></script>\n  <script src="payslip-parser.js?v=20260819-docs2"></script>\n  <script src="pension-report-parser.js?v=20260819-docs2"></script>\n  <script src="pension-input-reconciler.js?v=20260819-docs2"></script>\n  <script src="local-document-pipeline.js?v=20260819-docs2"></script>\n  <script src="document-extraction.js?v=20260819-docs2"></script>\n  <script src="app.js?v=20260819-docs2"></script>';

if (!html.includes(stylesheetTag) || !html.includes(scriptsBlock)) {
  throw new Error('index.html structure changed; standalone build markers were not found.');
}

const standalone = html
  .replace(stylesheetTag, `  <style>\n${css}\n  </style>`)
  .replace(scriptsBlock, `  <script>\n${engine}\n  </script>\n  <script>\n${financial}\n  </script>\n  <script>\n${payslip}\n  </script>\n  <script>\n${pensionReport}\n  </script>\n  <script>\n${reconciler}\n  </script>\n  <script>\n${localDocuments}\n  </script>\n  <script>\n${documents}\n  </script>\n  <script>\n${app}\n  </script>`);

fs.writeFileSync(outputPath, standalone, 'utf8');
console.log(`Built ${outputPath}`);
