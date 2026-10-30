# Frost Price Manager

A compact React / TypeScript administration app for Frost Optical equipment prices. All business data stays in IndexedDB in the visitor’s browser. There is no backend, login, analytics, live FX service or runtime CDN. The public GitHub Pages deployment contains application code only and starts with an empty catalogue.

**Saved in this browser only — export a confidential backup to protect your changes.** Data does not sync across devices, browsers, profiles, ports or domains. Clearing site storage, private browsing, losing a device, or changing the site’s origin can lose access to it. Local snapshots are recovery aids, not independent backups. Anyone who can use the browser profile can access its data.

## Run locally

Requires Node.js 22.12+ (Node 24 also supported) and npm. In PowerShell:

```powershell
npm.cmd ci
npm.cmd run dev
```

Open the local URL shown by Vite. On macOS/Linux, use `npm` instead of `npm.cmd`. The first dependency installation needs network access. SheetJS CE 0.20.3 is installed from its official distribution, locked in `package-lock.json` and bundled locally; the running app never loads it from a CDN.

## Verify

```powershell
npm.cmd test
npm.cmd run build
npm.cmd run check:privacy
npx.cmd playwright install chromium
npm.cmd run test:e2e
```

If Google Chrome is already installed, the browser tests can use it instead:

```powershell
$env:PLAYWRIGHT_CHANNEL = 'chrome'
npm.cmd run test:e2e
```

Unit tests cover exact sheet mappings, invalid input, variants, pricing precision, unknown freight, approval, local persistence, concurrency protection, atomic recovery snapshots, backup validation and round-trip, export field allow-lists, CSV formula injection, XLSX XML/metadata and isolated print content. End-to-end tests cover import, two-step replacement, edit/reload, FX confirmation, approval, sales downloads, print preview, full backup/reset/restore, CRUD/archive/delete/undo, mobile layout and project-subpath refresh. Every committed test record is synthetic.

To inspect the real supplied workbook locally, without copying it or writing any of its contents:

```powershell
npm.cmd run validate:workbook -- 'C:\Users\RicardoH\Downloads\Frost_Optical_Master_Price_List_2026.xlsx'
```

This check prints counts and pass/fail summaries only. It uses the application importer, checks the acceptance search keys, keeps every product in Draft, checks demo tiers, unknown freight, backup round-trip and sales output privacy. The supplied workbook was validated as **135 products, 132 offers, 15 review issues and 9 settings**. This is a validation result, not a fixed import row limit. No real price values or workbook-derived fixtures belong in this repository.

## Use the app

1. **Import workbook:** select the master `.xlsx`. Inspect counts, detected sheets, variants and warnings. Continue, type `REPLACE`, then confirm. The current dataset is snapshotted automatically. Imports replace rather than merge. All imported products are Draft.
2. **Settings & Backup:** verify GBP-per-currency rates, protection, default margin and source. Explicitly confirm the assumptions. Foreign FX is considered stale after 30 days; unconfirmed/stale conversion leaves derived costs unknown and blocks new foreign-currency approvals. GBP always uses conversion factor 1 and no FX protection, matching the workbook’s non-GBP protection instruction. Changing assumptions returns approved products to Draft.
3. **Catalogue:** search brand/model/name/category. Filters include manufacturer, category, approval, pricing issues and sales visibility. Sort via column headings or toolbar. Select rows across pages. Click a model to open the side drawer. The pencil beside a price allows a quick validated edit; changed approved records return to Draft.
4. **Product details:** maintain General, Selling Price, Supplier Costs, Supplier Offers and Notes & History. Unknown cost/freight stays blank; explicit zero is valid. New products and copies require Save. Review warnings, acknowledge them, then use **Save & approve for sales**. A positive selling price and current foreign FX are required. An unknown landed cost can be acknowledged; its margin remains unknown. Archive excludes a record from sales; unarchive returns it to Draft. Permanent deletion requires typing `DELETE` and creates a recovery snapshot.
5. **Supplier Offers:** search tiers, terms and source references. Unambiguous brand/model matches are linked; ambiguous variants remain separate until manually matched. Source and demo/expiry remarks stay visible. Offers never modify product cost automatically and never become sales products.
6. **Review Queue:** inspect priority, evidence, action and provenance; resolve/reopen manually. Unscoped workbook issues remain visible in the review queue; they are not guessed onto products. Product-specific import warnings also appear in the drawer.
7. **Export Sales List:** choose all approved/active, current filtered catalogue, or selected records. All scopes still enforce approval, visibility and a finite positive sale price. Inspect the exact live preview and exclusions. Download `.xlsx` / `.csv`, or open the isolated print document and choose **Print / Save as PDF**. PDF uses the browser’s print dialog; enable landscape A4 if your browser overrides the document’s page settings. Printing the administrator app is intentionally suppressed.
8. **Protect changes:** download a **confidential JSON backup** after edits. This includes all products, offers, issues, FX, history, UUIDs and timestamps, including confidential costs. Store it securely. The backup banner tracks the last requested download; the app cannot verify you saved the file. Restore validates schema/version/IDs/links and requires typing `RESTORE`. Reset requires typing `RESET`. Both snapshot the previous state. Settings lists the 10 most recent recovery snapshots; recovery also snapshots current data. Portable backups do not contain the snapshot archive. Undo is available immediately after destructive operations.

## Import contract

Required sheets are found by name, independently of order: `Master Price List`, `Supplier Offers`, `FX & Settings`, `Review Queue`. Headers must match row 5; data starts row 6. Informational sheets are ignored. The importer checks actual populated cells as well as sheet dimensions so trailing settings are retained. Workbook names can vary. Only `.xlsx` is accepted; macros are not supported.

Master A–V maps the source inputs and provenance. Columns I/K/M/O/P (derived cached prices/margins) are ignored and recalculated. Target margin L is retained when a valid cached input exists; otherwise the explicit default setting is used. Currency is never silently defaulted. Invalid numeric cells become unknown with review issues; missing brand/description or malformed headers reject the file. Source row metadata is preserved; every record receives an immutable UUID, with no SKU deduplication. Supplier Offers A–N preserves tiers and terms; its cached FX column I is ignored. Imported FX remains unconfirmed. Blank rows do not impose a fixed record count. The import limit is 20 MB and 50,000 sheet rows; backup restore is limited to 50 MB with bounded schema arrays.

Calculations use unrounded GBP values, excluding VAT. Supplier GBP = original cost × GBP-per-currency × (1 + protection for non-GBP). Landed = converted cost + known freight. Gross profit = sale − landed; gross margin = profit / positive sale. Suggested sale = landed / (1 − valid target margin). Only display is rounded. Gross margin is never markup.

## Safe sales exports

The export projection explicitly constructs only Category, Brand, Model / SKU, Product Name, optional Sales Description, Frost Selling Price (£ ex VAT), and optional general Sales Notes. Never put confidential information in these customer-facing fields or the export heading. Supplier unit costs, source files, supplier quote terms, currencies/FX, freight, landed cost, profit/margin, approval notes and history are never passed to the exporter.

XLSX is a new workbook with one visible sales sheet and generic sales metadata; there are no hidden sheets, original formulas, raw source objects or attachments. Text is written as string cells. CSV protects formula-leading text and correctly quotes separators/newlines; values remain numeric in XLSX. The print/PDF source is built only from the same sales projection, escapes HTML, has a restrictive content policy, and is isolated in a sandboxed iframe. It contains no administrator UI.

## Deploy free on GitHub Pages

The workflow `.github/workflows/deploy.yml` runs unit tests, builds, checks artifact privacy and runs synthetic browser tests before deploying `dist` using the official Pages actions. PRs validate without deploying. `main` pushes and manual runs deploy. Vite receives `/<repository-name>/` in Actions; local builds use relative asset paths. Hash navigation supports refresh on project paths. No backend or paid services are required.

1. Authenticate GitHub CLI (`gh auth login`) or use GitHub’s web interface to create an empty repository named `frost-price-manager`.
2. **Inspect public access and every staged file before committing/pushing.** Review `.gitignore`, `git status`, and `git diff --cached`. Only source, documentation, dependency lockfile and synthetic tests should be present. A public Pages site can be read by anyone even if its source repository is private. Never copy real workbook files, pricing JSON, backups or supplier documents into the source tree or `public/`.
3. Initialise and publish the code (replace `YOUR_ACCOUNT`):

```powershell
git init -b main
git add .gitignore .github src tests scripts index.html package.json package-lock.json tsconfig.json vite.config.ts playwright.config.ts README.md .prettierrc.json
git diff --cached --stat
npm.cmd run check:privacy
git commit -m "Build local Frost Price Manager with synthetic tests"
gh repo create YOUR_ACCOUNT/frost-price-manager --public --source . --remote origin
```

4. On GitHub, open repository **Settings → Pages → Build and deployment → Source: GitHub Actions**. Then push `main`:

```powershell
git push -u origin main
```

5. Follow the **Validate and deploy GitHub Pages** Actions run. Its `github-pages` environment links to `https://YOUR_ACCOUNT.github.io/frost-price-manager/`. Check the deployed empty state, then import the confidential workbook in your own browser.

For an account site (`YOUR_ACCOUNT.github.io` repository) or custom domain, set workflow `VITE_BASE_PATH` to `/`. For a local explicit project-path build:

```powershell
$env:VITE_BASE_PATH = '/frost-price-manager/'
npm.cmd run build
npm.cmd run preview
```

`dist` is the entire deployable artifact. Do not add data to it. No credentials belong in client code. The artifact checker is a guard against accidental file inclusion, not proof that arbitrary source text is confidential-data-free; human diff review remains required. GitHub deployment requires valid authentication and a repository; a successful local build does not mean the site has been published.

## Technical notes

- React 19, TypeScript, Vite, Dexie, Zod, SheetJS CE, Lucide; system fonts. Compact native semantic tables and controls keep the interface modest and accessible without an additional component/table framework.
- IndexedDB uses a versioned whole-workspace record, recovery snapshot table and backup metadata table. Writes and snapshots share an atomic transaction. Revision checks reject stale saves from another tab; reload before reapplying the edit. Local history is not tamper-proof. Snapshots are capped at 10.
- No request uploads workbook contents. The production content policy disallows third-party network access and executable inline code. Static hosting serves bundled assets. No service worker is installed; refresh requires access to the static app assets. Once loaded, calculations and file operations work locally.
- Formatting: `npm run format` / `npm run format:check`. Tests use synthetic builders in `tests/fixtures.ts`; browser screenshots/traces/downloads are ignored. The confidential local validator never writes its input or outputs to the repository.
- Source workbook/spec stay outside the project in Downloads. `.gitignore` excludes spreadsheets, CSV/PDF outputs, backup/pricing JSON, private folders and generated artifacts. Avoid bypassing ignores with `git add -f`.

The supplied build specification is treated as the product/technical reference. The user’s explicit confidentiality and GitHub Pages requirements govern publication.
