# Release runbook

Pension Lab is released as a static Cloudflare Pages site. `app/` is the only source tree; `dist/` is generated and must never be edited by hand or committed.

## Preconditions

- Use Node.js 22 or newer (`.nvmrc` and `package.json` record this requirement).
- Start from the exact reviewed commit with a clean tracked worktree. Unrelated untracked private or dataset material must remain outside the release artifact.
- Confirm that `app/document-extraction.js` and `app/pension-report-parser.js` still match the reviewed extraction baseline when a simulator-only release is intended. If OCR orchestration changes intentionally, keep parser/financial rules unchanged and require the full local-browser benchmark plus exact prediction comparison to the last accepted artifact.
- Confirm the active Cloudflare account and the `pension-lab` Pages project before writing any deployment.

## Release gate

Run the complete suites documented in `docs/QA.md`, then build twice and compare the SHA256 of `dist/pension-lab-he-standalone.html`. A release is blocked by any failed suite, non-deterministic standalone hash, tracked worktree change created by the build, browser console/runtime error, unexpected interaction request, or horizontal overflow at desktop and 390px mobile widths.

```powershell
npm run test:core
npm run test:dataset
npm run dataset:validate
npm run dataset:benchmark:text
npm run dataset:benchmark:browser
npm run test:browser:ocr
npm run test:browser:standalone
npm run test:browser:smoke
npm run test:browser:simulator
npm run test:browser:demo

git diff --exit-code f7978fe1a15c8e2f738ec0de629e77ff736ceabb -- app/pension-report-parser.js
git diff --check
npm run build
$hash1 = (Get-FileHash dist/pension-lab-he-standalone.html -Algorithm SHA256).Hash
npm run build
$hash2 = (Get-FileHash dist/pension-lab-he-standalone.html -Algorithm SHA256).Hash
if ($hash1 -ne $hash2) { throw 'Non-deterministic standalone build' }
npm run check:standalone
if (-not (Test-Path dist/_headers) -or -not (Test-Path dist/_redirects) -or -not (Test-Path dist/404.html)) { throw 'Cloudflare release files are missing from dist' }
```

## Preview deployment

Build after committing the reviewed changes, then deploy that exact generated directory to a non-production branch. Replace the placeholders with the real values; never invent a SHA or project name.

```powershell
$releaseBranch = git branch --show-current
git diff --quiet
if ($LASTEXITCODE -ne 0) { throw 'Tracked worktree changes remain' }
git diff --cached --quiet
if ($LASTEXITCODE -ne 0) { throw 'Staged changes remain' }
$untrackedAppFiles = @(git ls-files --others --exclude-standard -- app)
if ($untrackedAppFiles.Count -gt 0) { throw "Untracked app files could enter dist: $($untrackedAppFiles -join ', ')" }
git fetch --prune origin
$releaseSha = git rev-parse HEAD
if ((git rev-parse "origin/$releaseBranch") -ne $releaseSha) { throw 'HEAD does not match the pushed remote branch' }
npx --yes wrangler pages deploy dist --project-name pension-lab --branch codex/pr2-interactive-simulator --commit-hash $releaseSha --commit-dirty=false
```

Validate the immutable preview URL before promoting it. At minimum verify:

- `/` returns HTML containing the expected versioned application assets.
- `/?demo=1` enters the labeled synthetic flow and the normal route stays unchanged.
- `/demo-fixture.js` returns JavaScript, not an HTML fallback.
- An unknown asset returns HTTP 404 and the custom Hebrew 404 page.
- Security headers from `app/_headers` are present.
- Key deployed asset hashes match the files in the tested `dist/` directory.
- Chromium completes the normal and demo smoke flows at desktop and 390px without console/runtime errors, unexpected interaction requests, or horizontal overflow.

The repeatable HTTP/MIME/header/404/hash checks are implemented by:

```powershell
npm run verify:live -- https://immutable-deployment.example.pages.dev/
```

## Production deployment

Promote the same tested `dist/` bytes; do not rebuild or edit them between preview verification and production deployment.

```powershell
npx --yes wrangler pages deploy dist --project-name pension-lab --branch main --commit-hash $releaseSha --commit-dirty=false
npm run verify:live -- https://pension-lab-5yh.pages.dev/
```

Repeat the preview checks against `https://pension-lab-5yh.pages.dev/`. Record the Git SHA, Cloudflare deployment identifier, immutable deployment URL, canonical URL, asset hashes, and verification time in the release evidence or handoff.

## Rollback

Use the Cloudflare Pages deployment history to promote the last known-good production deployment, then repeat the live checks. Do not rebuild an old source tree and call it the same artifact: the rollback target must be the previously verified deployment or bytes whose hashes are known.

## Known release limitations

- The standalone HTML intentionally contains inline scripts, so a strict nonce/hash Content Security Policy is not yet enabled. The current release still sends `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, and a restrictive `Permissions-Policy`.
- GitHub-hosted CI and branch protection are repository-governance controls, not Cloudflare runtime controls; they require a separate owner decision.
