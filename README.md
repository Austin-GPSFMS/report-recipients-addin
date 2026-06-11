# Report Recipients — MyGeotab Add-In (GPSFMS)

A faster replacement for Geotab's "Show All Recipients" add-in. Lists **every emailed report** in the database and **all of its resolved recipients** — including users added individually and users who receive the report through group membership (with sub-group expansion).

Built with React + [Geotab Zenith](https://developers.geotab.com/zenith/introduction/) components, bundled into a single `dist/addin.js`.

## Why it's fast on large databases

The legacy add-in resolves recipients with a separate user lookup **per report** (N+1 calls). On databases with hundreds of emailed reports and thousands of users it stalls or times out.

This add-in makes **one `multiCall` with 4 `Get` requests** (CustomReportSchedule, User, Group, ReportTemplate), uses `propertySelector` to fetch only the user/group fields it needs, and joins everything client-side in memory. Group hierarchy expansion is cached. Typical load on a large database is a few seconds.

## Features

- Every emailed report (PDF/Excel destinations) with format, frequency, and recipient count
- Per-recipient "Added via" (individually selected vs. which group, incl. or excl. sub-groups)
- Flags: recipients who are **archived**, have **email reports turned off**, or no longer exist; reports with **zero recipients**; **paused** schedules; **redirected** reports
- Search by report name, recipient name, or email
- **Export to Excel** (native-style formatting: styled header, frozen row, autofilter, Recipients sheet + Reports Summary sheet)
- Two ways in: a **Show All Recipients button** on the report pages, and a standalone **Report Recipients** page under the Reports menu (fallback if the button hook isn't available on your MyGeotab version)

## Deploy with GitHub Pages

1. Create a GitHub repo named `report-recipients-addin` and push this folder to it
   (`dist/` is included on purpose — do not gitignore it).
2. In the repo: **Settings → Pages → Build and deployment → Deploy from a branch**, pick `main` and `/ (root)`, save.
3. Wait a minute, then confirm `https://<your-username>.github.io/report-recipients-addin/addin.js` loads in a browser.

## Install in MyGeotab

1. Edit `config.json`: replace `YOUR-GITHUB-USERNAME` (3 places).
2. In MyGeotab: **Administration → System… → System Settings → Add-Ins → New Add-In**, paste the contents of `config.json`, save, and allow unverified add-ins if prompted.
3. Refresh MyGeotab. You'll find:
   - a **Show All Recipients** button on the All Available Reports / report edit pages, and
   - **Reports → Report Recipients** in the left menu.

Updating later = push a new commit to GitHub (Pages redeploys automatically). Users may need a hard refresh (Ctrl+F5) to pick up the new bundle.

## Rebuild from source

```bash
npm install --legacy-peer-deps   # zenith declares react 19 as peer; react 18 works
npm run build                    # -> dist/addin.js + dist/index.html
npm test                         # recipient-resolution unit tests (no API needed)
```

## How recipients are resolved

For each `CustomReportSchedule` with destination `EmailPdf`/`EmailExcel`:

1. **Individually selected** users (detected across the property names different MyGeotab versions use).
2. **Group recipient lists**: `includeAllChildrenGroups` (group + all descendants) and `includeDirectChildrenOnlyGroups` (group + direct children). A user matches if any of their `companyGroups` or `reportGroups` fall in the expanded set.
3. **Redirects** are shown as a warning on the report.

A user with **Receive email reports** turned off (System Communications tab) still appears in the list but is flagged "Email reports off" — MyGeotab will not actually deliver to them.

## Troubleshooting

- **Counts look off / recipients missing**: open the **Diagnostics** link at the bottom of the panel. It lists any `CustomReportSchedule` properties this version doesn't recognize. Send that list to austin@gpsfms.com and the property map in `src/data.js` (the `*_KEYS` arrays) can be extended in minutes.
- **Button doesn't appear**: page-name hooks vary by MyGeotab release; use the standalone **Reports → Report Recipients** menu entry instead — same tool.
- **Nothing loads**: the signed-in user needs clearance to view users, groups, and report schedules (Administrator or a clearance with dashboard/report security).
