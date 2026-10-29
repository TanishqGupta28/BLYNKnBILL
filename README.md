# BLYNKnBILL

A small web app for making **Bills of Supply** and **GST Tax Invoices** in the browser, then printing them or saving them as PDF.

Built with plain **HTML, CSS and JavaScript**. There is no framework and no server, and all data is stored in the browser.

## How to run

1. Put `index.html`, `style.css` and `script.js` in the same folder.
2. Double-click `index.html` to open it in Chrome, Edge or Firefox. (Or use the VS Code "Live Server" extension.)
3. An internet connection is needed only for PDF download and the UPI QR code (they load small libraries from a CDN).

## Features

- Several companies, each with its own bill type (Bill of Supply or GST Tax Invoice), serial numbers, products and saved bills
- Items with automatic unit conversion (Kg/g, L/ml) and your own units
- Automatic GST: CGST + SGST for the same state, IGST for another state, rounded totals, amount in words
- Live preview of the bill while you type
- Print one or more copy types (Original, Duplicate, Triplicate, Extra)
- Download or share as PDF, named like `Bill-334_08.07.2026_Shop Name.pdf`
- Saved customers and saved products (with safe two-tap delete)
- Saved bills are kept for 30 days; a starred bill is kept until you delete it
- UPI QR code on the tax invoice

## Project structure

| File | What it does |
|---|---|
| `index.html` | The page structure: forms, buttons and the preview area |
| `style.css` | The look: layout, colours, bill sheet design and print rules |
| `script.js` | The logic: calculations, building the bills, saving data, printing, PDF |

Every file has numbered sections (for example `SECTION 5: GST CALCULATION`) so you can search and jump straight to a topic.

## How it works, in short

1. **You type** into the form. Every key press calls `update()` in `script.js`.
2. `update()` reads all the fields, calculates the amounts (`items()` and `calcGST()`), and builds the bill as an HTML string (`billHTML()` / `gstHTML()`).
3. That HTML is placed in the preview panel, so you see the bill change live.
4. **Saving** stores the data in the browser's `localStorage` (see the `ls` helper).
5. **Printing** copies the bill pages into a hidden area and calls `window.print()`. The `@media print` rules in `style.css` hide everything except the bills.
6. **PDF**: `html2canvas` takes a picture of each page and `jsPDF` puts the pictures into a PDF file.

## Concepts used (good to mention in a viva)

- DOM manipulation (`getElementById`, `innerHTML`, event listeners)
- `localStorage` for saving data without a server
- CSS Grid and Flexbox for the two-column layout and the bill tables
- Responsive design with media queries (two columns on desktop, one on mobile)
- Print-specific CSS (`@media print`, `@page`, millimetre sizes for A4)
- Array methods: `map`, `filter`, `reduce`, `find`
- Escaping text before putting it in HTML (the `esc()` function)
- Using third-party libraries from a CDN (html2canvas, jsPDF, qrcode-generator)

## Limitations and ideas for the next version

- Data lives only in one browser on one device. Clearing the browser data deletes it.
- Next step: add a login and a database so many users can share data.
- Other ideas: an offline mode that works without internet, sales reports, and import/export of data.
