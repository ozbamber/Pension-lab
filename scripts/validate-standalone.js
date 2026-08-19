const fs = require('fs');
const path = require('path');
const vm = require('vm');

const filePath = path.resolve(__dirname, '..', 'dist', 'pension-lab-he-standalone.html');
const html = fs.readFileSync(filePath, 'utf8');
const blocks = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
let checked = 0;
for (let index = 0; index < blocks.length; index += 1) {
  const source = blocks[index][1];
  if (!source.trim()) continue;
  try {
    new vm.Script(source, { filename: `standalone-script-${index + 1}.js` });
    checked += 1;
  } catch (error) {
    console.error(`Standalone script block ${index + 1} failed syntax validation.`);
    throw error;
  }
}
console.log(`Validated ${checked} inline standalone script blocks.`);
