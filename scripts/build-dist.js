const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const appRoot = path.join(projectRoot, 'app');
const distRoot = path.join(projectRoot, 'dist');

if (!fs.existsSync(path.join(appRoot, 'index.html'))) throw new Error('Canonical app/index.html is missing.');
if (distRoot === projectRoot || !distRoot.startsWith(`${projectRoot}${path.sep}`)) throw new Error('Unsafe dist path.');

fs.rmSync(distRoot, { recursive: true, force: true });
fs.mkdirSync(distRoot, { recursive: true });
fs.cpSync(appRoot, distRoot, { recursive: true, preserveTimestamps: false });

const standalone = spawnSync(process.execPath, [path.join(__dirname, 'build-standalone.js')], {
  cwd: projectRoot,
  encoding: 'utf8',
});
if (standalone.stdout) process.stdout.write(standalone.stdout);
if (standalone.stderr) process.stderr.write(standalone.stderr);
if (standalone.status !== 0) process.exit(standalone.status || 1);

const files = [];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(absolute);
    else files.push(path.relative(distRoot, absolute).replace(/\\/g, '/'));
  }
}
walk(distRoot);
console.log(`Built dist/ from app/ (${files.length} files).`);
