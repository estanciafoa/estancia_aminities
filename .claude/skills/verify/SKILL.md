---
name: verify
description: Verify changes to admin.html (the browser admin console) by driving it in real Chrome.
---

# Verifying admin.html

`admin.html` is a standalone, no-build browser page (SheetJS from CDN). Its
surface is a browser, so verification means driving it in Chrome — not running
tests.

## Handle

There is no Playwright dependency in the repo and no cached Playwright browsers,
but system Chrome works with `playwright-core`:

```bash
cd <scratchpad> && npm install playwright-core --silent
```

```js
import { chromium } from 'playwright-core';
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
```

Serve over HTTP rather than `file://` (the gas tab uses `localStorage`):

```bash
cd <scratchpad> && python3 -m http.server 8977 &
```

## Never touch the live sheets

The page posts to two **live** Apps Script deployments that write to real Google
Sheets. Always intercept before driving:

```js
await ctx.route('**://script.google.com/**', async (route) => {
  const url = route.request().url();
  if (url.includes('AKfycbzI8_uAZ')) {          // gas deployment
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, result: { baseRate: 64.91, grossRate: 68.16 } }) });
  }
  return route.abort();                          // subscription pushes — never let through
});
```

Never click `PUSH`, `PUSH ALL TO SHEET`, or `Save rate` against an unmocked
endpoint. `get_config` is read-only; `set_config` and `insert_rows` write.

## Gotchas

- **The gas tab prompts for a token** on first open (`prompt()` blocks the
  driver). Pre-seed it: `ctx.addInitScript(() => localStorage.setItem('gasAdminToken', 'X'))`,
  or attach a `page.on('dialog', d => d.accept('X'))` handler.
- `#gasBaseRate` is `input[type=number]` — `page.fill(el, 'abc')` throws. Use
  `page.keyboard.type()` to test non-numeric input.
- The uploader needs a real workbook. The repo root has usable samples
  (`Gym Paid Llist.xlsx`, `Tennis.xlsx`); wait on
  `.card .preview table tbody tr` after `setInputFiles('#fileInput', ...)`.

## Flows worth driving

1. Tab switch both ways; assert `#panel-subs`/`#panel-gas` `hidden`, the active
   `.tab-btn`, and that `#headerSub` + `#sheetLink` swap to the right sheet.
2. Upload a sample xlsx → preview table renders → uploader state survives a tab
   round-trip.
3. Gas rate loads into `#gasBaseRate` and `#gasGrossOut` shows `base × 1.05`.
4. **Regression guard for CSS scoping:** the gas panel's styles are scoped under
   `#panel-gas` precisely because that page styles bare `button`/`label`/
   `input`/`.card`/`.msg`. To prove nothing leaked, diff `getComputedStyle` of
   the uploader's elements (`#dropzone`, `#pushAll`, `.card`, `.push`, `thead th`,
   `#log`) against the pre-change file (`git show HEAD:admin.html`) rendered
   side by side. Expect identical — except `#sheetLink`'s resolved `margin-left`,
   which is `auto` and shifts with the `<h1>` text length.
