/* =====================================================================
   BLYNKnBILL - script.js

   What this file does
   -------------------
   Reads the form -> calculates the bill -> draws it in the preview ->
   lets you save, print or download it as PDF.

   Table of contents
   -----------------
    1. Settings and constants
    2. Small helper functions
    3. Saved data (loaded from the browser)
    4. Companies
    5. Items (rows), amounts and saved products
    6. Customers
    7. GST calculation
    8. Building the bill (HTML text)
    9. Live preview
   10. Printing
   11. PDF download and share
   12. Saved bills
   13. Company form
   14. States, custom units and other buttons
   15. Start-up (runs once when the page opens)
   ===================================================================== */


/* =====================================================================
   1. SETTINGS AND CONSTANTS
   ===================================================================== */

const ITEMS_PER_PAGE_SUPPLY = 15;   // Bill of Supply: items on one page
const ITEMS_PER_PAGE_GST = 12;      // Tax Invoice: items on one page
const BLANK_ROWS_AT_START = 15;     // empty item rows shown in the form
const GST_TABLE_ROWS = 21;          // fixed height of the GST items table
const SAVE_DAYS_MS = 30 * 24 * 60 * 60 * 1000;   // saved bills live 30 days

// Size of one bill in pixels (used to shrink the preview to fit)
const SUPPLY_WIDTH_PX = 529;
const SUPPLY_HEIGHT_PX = 745;
const GST_WIDTH_PX = 748;
const GST_HEIGHT_PX = 1074;

// Units that always exist. Users can add more (Dozen, Box ...)
const BASE_UNITS = ['Kg', 'g', 'L', 'ml', 'pcs'];

// Units we can convert between: Kg <-> g and L <-> ml
const UNIT_FACTORS = {
  Kg: { kind: 'weight', size: 1000 },
  g:  { kind: 'weight', size: 1 },
  L:  { kind: 'volume', size: 1000 },
  ml: { kind: 'volume', size: 1 },
};

// Fields shown only on a GST Tax Invoice: [id, label, input type]
const EXTRA_FIELDS = [
  ['cph', 'Customer phone', 'tel'],
  ['chn', 'Challan No'],
  ['chd', 'Challan date', 'date'],
  ['ewb', 'E-Way Bill No.'],
  ['trn', 'Transport'],
  ['tid', 'Transport ID'],
];

// Print copy types: [id, tick-box text, label on GST bill, label on Bill of Supply]
const COPY_TYPES = [
  ['o', 'Original',   'ORIGINAL FOR RECIPIENT',    'ORIGINAL'],
  ['d', 'Duplicate',  'DUPLICATE FOR TRANSPORTER', 'DUPLICATE'],
  ['t', 'Triplicate', 'TRIPLICATE FOR SUPPLIER',   'TRIPLICATE'],
  ['x', 'Extra copy', 'EXTRA COPY',                'EXTRA COPY'],
];

// Company form fields: [key, label, takes full width?]
const COMPANY_FIELDS = [
  ['firm',   'Firm name *', true],
  ['nick',   'Nickname (optional, e.g. shop name)', true],
  ['gstin',  'GSTIN *'],
  ['fssai',  'FSSAI Licence no.'],
  ['ph1',    'Mobile number 1'],
  ['ph2',    'Mobile number 2 (optional)'],
  ['email',  'Email (optional)'],
  ['adr',    'Address line', true],
  ['city',   'City (used in Terms, e.g. Moradabad) *'],
  ['state',  'State *'],
  ['scode',  'State code'],
  ['bank',   'Bank name (optional)', true],
  ['branch', 'Branch name', true],
  ['acc',    'Account number'],
  ['ifsc',   'IFSC code'],
  ['upi',    'UPI ID (optional)'],
];

// Indian states and their GST codes, written as "code name"
const STATES = (
  '01 Jammu and Kashmir,02 Himachal Pradesh,03 Punjab,04 Chandigarh,05 Uttarakhand,' +
  '06 Haryana,07 Delhi,08 Rajasthan,09 Uttar Pradesh,10 Bihar,11 Sikkim,' +
  '12 Arunachal Pradesh,13 Nagaland,14 Manipur,15 Mizoram,16 Tripura,17 Meghalaya,' +
  '18 Assam,19 West Bengal,20 Jharkhand,21 Odisha,22 Chhattisgarh,23 Madhya Pradesh,' +
  '24 Gujarat,26 Dadra and Nagar Haveli and Daman and Diu,27 Maharashtra,29 Karnataka,' +
  '30 Goa,31 Lakshadweep,32 Kerala,33 Tamil Nadu,34 Puducherry,' +
  '35 Andaman and Nicobar Islands,36 Telangana,37 Andhra Pradesh,38 Ladakh'
)
  .split(',')
  .map(text => [text.slice(0, 2), text.slice(3)]);   // -> [['01','Jammu and Kashmir'], ...]

// Used when no company exists yet, so the code never meets "undefined"
const EMPTY_COMPANY = {
  id: '', firm: '', nick: '', gstin: '', fssai: '', ph1: '', ph2: '', email: '',
  adr: '', city: '', state: '', scode: '', bank: '', branch: '', acc: '', ifsc: '', upi: '',
};

// Placeholder text that is replaced by the copy label ("ORIGINAL", ...)
const COPY_MARKER = '@@CP@@';


/* =====================================================================
   2. SMALL HELPER FUNCTIONS
   ===================================================================== */

// Short name for document.getElementById
const $ = id => document.getElementById(id);

// Makes text safe to put inside HTML (so "<" cannot break the page)
function escapeHtml(text) {
  const replacements = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
  return String(text).replace(/[&<>"]/g, ch => replacements[ch]);
}

// Saving and loading in the browser (localStorage), without crashing on errors
const storage = {
  get(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value == null ? fallback : JSON.parse(value);
    } catch (error) {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      /* storage full or blocked: ignore */
    }
  },
};

// Rounds to 2 decimals (rupees and paise)
const round2 = n => Math.round(n * 100) / 100;

// 1234567.5 -> "12,34,567.50" (Indian digit grouping)
const formatMoney = n =>
  Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// 3 -> "3", 2.5 -> "2.50"
const formatQty = n => (Number.isInteger(n) ? String(n) : n.toFixed(2));

// "9" -> "09" (state codes are always two digits)
function padStateCode(code) {
  code = String(code || '').trim();
  return code ? code.padStart(2, '0') : '';
}

// Today as "2026-07-08" (the format of <input type="date">)
function todayISO() {
  const d = new Date();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

// "2026-07-08" -> "08/07/2026"
const formatDate = iso => (iso ? iso.split('-').reverse().join('/') : '');

// "2026-07-08" -> "08.07.2026" (used in file and bill names)
const formatDateDots = iso => (iso ? iso.split('-').reverse().join('.') : 'no date');

// Amount for one line = quantity x price, converting units when needed.
// Example: 500 g at Rs.100 per Kg -> 50. Returns null if units cannot be matched.
function lineAmount(qty, unit, price, priceUnit) {
  if (unit === priceUnit) return qty * price;
  const from = UNIT_FACTORS[unit];
  const to = UNIT_FACTORS[priceUnit];
  if (from && to && from.kind === to.kind) {
    return (qty * from.size / to.size) * price;
  }
  return null;
}

// Number to words in the Indian system.
// gstStyle true  -> "FOUR THOUSAND AND NINETY RUPEES ONLY"
// gstStyle false -> "Four thousand ninety rupees only."
function amountInWords(amount, gstStyle) {
  const ones = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
    'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
    'seventeen', 'eighteen', 'nineteen'];
  const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

  const belowHundred = n => {
    if (n < 20) return ones[n];
    const joiner = gstStyle ? '-' : ' ';
    return tens[Math.floor(n / 10)] + (n % 10 ? joiner + ones[n % 10] : '');
  };

  const belowThousand = n => {
    let text = '';
    if (n > 99) text += ones[Math.floor(n / 100)] + ' hundred' + (n % 100 ? ' ' : '');
    if (n % 100) text += belowHundred(n % 100);
    return text;
  };

  // Indian groups: crore, lakh, thousand, rest
  const wholeNumberInWords = number => {
    const parts = [];
    const groups = [[1e7, 'crore'], [1e5, 'lakh'], [1e3, 'thousand'], [1, '']];
    for (const [size, name] of groups) {
      const count = Math.floor(number / size);
      number %= size;
      if (!count) continue;
      if (size === 1) parts.push(belowThousand(count));
      else parts.push((count > 99 ? belowThousand(count) : belowHundred(count)) + ' ' + name);
    }
    return parts.join(' ');
  };

  const rupees = Math.floor(amount);
  const paise = Math.round((amount - rupees) * 100);

  let text;
  if (gstStyle && rupees > 99 && rupees % 100) {
    // GST style puts "and" before the last two digits
    text = wholeNumberInWords(rupees - (rupees % 100)) + ' and ' + belowHundred(rupees % 100);
  } else {
    text = wholeNumberInWords(rupees);
  }
  text = (text || 'zero') + ' rupees';
  if (paise) text += ' and ' + belowHundred(paise) + (gstStyle ? ' paisa' : ' paise');

  return gstStyle
    ? text.toUpperCase() + ' ONLY'
    : text[0].toUpperCase() + text.slice(1) + ' only.';
}

// Small message at the bottom of the screen
function showToast(message) {
  const box = $('toast');
  box.textContent = message;
  box.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { box.hidden = true; }, 3000);
}

// Makes a button ask "Tap again to confirm" before running a risky action
function makeTwoTapButton(button, action) {
  const originalText = button.textContent;
  let waiting = false;
  let timer;

  button.onclick = () => {
    if (waiting) {                       // second tap: do it
      clearTimeout(timer);
      button.textContent = originalText;
      waiting = false;
      action();
      return;
    }
    waiting = true;                      // first tap: ask
    button.textContent = 'Tap again to confirm';
    timer = setTimeout(() => {           // no second tap in 3 seconds: cancel
      waiting = false;
      button.textContent = originalText;
    }, 3000);
  };
}

// Same idea for small delete buttons inside lists.
// First tap shows "Delete?", second tap (within 3 s) runs onConfirm.
let pendingDeleteKey = null;
function confirmDelete(button, key, onConfirm, onCancel) {
  if (pendingDeleteKey === key) {
    pendingDeleteKey = null;
    onConfirm();
    return;
  }
  pendingDeleteKey = key;
  button.textContent = 'Delete?';
  setTimeout(() => {
    if (pendingDeleteKey === key) {
      pendingDeleteKey = null;
      onCancel();
    }
  }, 3000);
}


/* =====================================================================
   3. SAVED DATA (loaded from the browser when the page opens)
   ===================================================================== */

let savedProducts = storage.get('products', []);   // {cid, n, u, hsn, gr}
let customers     = storage.get('customers', {});  // { "Name": {adr, gst, ph} }
let customUnits   = storage.get('units', []);      // ["Dozen", "Box", ...]
let savedBills    = storage.get('bills', []);      // all saved bills
let companies     = storage.get('companies', []);  // all companies
if (!Array.isArray(companies)) companies = [];

// The company that is selected right now
let company =
  companies.find(c => c.id === storage.get('coId', '')) ||
  companies[0] ||
  EMPTY_COMPANY;

let currentBillId = null;     // id of the saved bill being edited (null = new bill)
let pageHtmlList = [];        // HTML of each bill page (with the copy marker)
let lastState = null;         // result of the latest calculation
let editingCompanyId = null;  // company being edited in the form (null = adding)

// Older saved products had no company: give them to the current company
(function assignOldProductsToCompany() {
  let changed = false;
  savedProducts.forEach(product => {
    if (!product.cid && company.id) {
      product.cid = company.id;
      changed = true;
    }
  });
  if (changed) storage.set('products', savedProducts);
})();

// Products that belong to the selected company only
const productsOfCompany = () => savedProducts.filter(p => p.cid === company.id);

// All units: built-in + the ones the user added
const allUnits = () => BASE_UNITS.concat(customUnits);


/* =====================================================================
   4. COMPANIES
   ===================================================================== */

// 'gst' (Tax Invoice) or 'sup' (Bill of Supply) for a company
function billTypeOf(c) {
  return c.bt || (c.reg === 'Regular' ? 'gst' : 'sup');
}

const isGstBill = () => billTypeOf(company) === 'gst';
const itemsPerPage = () => (isGstBill() ? ITEMS_PER_PAGE_GST : ITEMS_PER_PAGE_SUPPLY);

// Each company remembers its own last serial number
const serialFor = c => storage.get('sno_' + c.id, '') || '';

// "Rampur, Uttar Pradesh" for the Terms line
function jurisdictionOf(c) {
  return [c.city || '', c.state].filter(Boolean).join(', ') || 'local';
}

// Small warning under the company box
function showCompanyNote() {
  if (!company.id) {
    $('conote').textContent = 'No company yet. Tap + Add company to start.';
  } else if (!company.city) {
    $('conote').textContent =
      'City is missing for this company, so Terms shows only the state. Tap Edit and add the city.';
  } else {
    $('conote').textContent = '';
  }
}

// Fills the company dropdown
function fillCompanyDropdown() {
  $('cosel').innerHTML = companies.map(c => {
    const selected = c.id === company.id ? ' selected' : '';
    const label = c.firm + (c.nick ? ` (${c.nick})` : '');
    return `<option value="${escapeHtml(c.id)}"${selected}>${escapeHtml(label)}</option>`;
  }).join('');
}

// Switch to another company
function switchCompany(c) {
  company = c;
  storage.set('coId', company.id);
  currentBillId = null;
  $('sno').value = serialFor(company);
  fillCompanyDropdown();
  selectDefaultState();
  updatePreview();
  renderSavedBills();
  renderProductChips();
}


/* =====================================================================
   5. ITEMS (ROWS), AMOUNTS AND SAVED PRODUCTS
   ===================================================================== */

// <option> list for the "Quantity unit" dropdown
const unitOptions = selected =>
  allUnits()
    .map(u => `<option${u === selected ? ' selected' : ''}>${escapeHtml(u)}</option>`)
    .join('');

// <option> list for the "Price is given" dropdown
const priceUnitOptions = selected =>
  '<option value="">Same as unit</option>' +
  allUnits()
    .map(u => `<option value="${escapeHtml(u)}"${u === selected ? ' selected' : ''}>per ${escapeHtml(u)}</option>`)
    .join('');

// Builds one item row and adds it to the form.
// "data" (optional) pre-fills the row: {n, q, u, r, pu, hsn, gr}
function addItemRow(data = {}) {
  const row = document.createElement('div');
  row.className = 'row';

  row.innerHTML = `
    <div class="top">
      <span class="no"></span>
      <div class="dd">
        <input class="nm" autocomplete="off" placeholder="Name of product" value="${escapeHtml(data.n || '')}">
        <div class="dl pl" hidden></div>
      </div>
      <button class="x" title="Remove item" aria-label="Remove item">×</button>
    </div>

    <div>
      <label>Quantity</label>
      <input class="q" type="number" inputmode="decimal" step="any" min="0" placeholder="0" value="${escapeHtml(data.q || '')}">
    </div>
    <div>
      <label>Quantity unit</label>
      <select class="u">${unitOptions(data.u || 'Kg')}</select>
    </div>
    <div>
      <label>Price (₹)</label>
      <input class="r" type="number" inputmode="decimal" step="any" min="0" placeholder="0" value="${escapeHtml(data.r || '')}">
    </div>
    <div>
      <label>Price is given</label>
      <select class="pu">${priceUnitOptions(data.pu || '')}</select>
    </div>

    <div class="gstf">
      <label>HSN / SAC</label>
      <input class="hsn" value="${escapeHtml(data.hsn || '')}">
    </div>
    <div class="gstf">
      <label>GST %</label>
      <input class="gr" list="rates" type="number" inputmode="decimal" step="any" min="0" placeholder="0" value="${escapeHtml(data.gr || '')}">
    </div>

    <div class="ab">
      <button class="sp2" title="Save this product name, unit, HSN and GST % for later">Save product</button>
      <div class="amt"></div>
    </div>
  `;

  // Remove this row
  row.querySelector('.x').onclick = () => {
    row.remove();
    renumberRows();
    updatePreview();
  };

  // Any typing in the row recalculates the bill
  row.oninput = updatePreview;

  // Saved-products dropdown under the name box
  const nameInput = row.querySelector('.nm');
  const productList = row.querySelector('.pl');

  nameInput.addEventListener('focus', () => showProductDropdown(row));
  nameInput.addEventListener('input', () => showProductDropdown(row));
  nameInput.addEventListener('keydown', e => {
    if (e.key === 'Escape') productList.hidden = true;
  });

  productList.addEventListener('click', e => {
    // Delete button inside the dropdown?
    const deleteButton = e.target.closest('[data-dp]');
    if (deleteButton) {
      const name = deleteButton.dataset.dp;
      confirmDelete(
        deleteButton,
        'p:' + name,
        () => {
          savedProducts = savedProducts.filter(p => !(p.n === name && p.cid === company.id));
          storage.set('products', savedProducts);
          renderProductChips();
          showProductDropdown(row);
          showToast('Deleted ' + name);
        },
        () => showProductDropdown(row)
      );
      return;
    }
    // Otherwise: pick the product
    const pick = e.target.closest('[data-p]');
    if (!pick) return;
    const product = productsOfCompany().find(p => p.n === pick.dataset.p);
    if (product) fillRowFromProduct(row, product);
    productList.hidden = true;
  });

  row.querySelector('.sp2').onclick = () => saveProductFromRow(row);

  $('rows').appendChild(row);
}

// Puts the numbers 1, 2, 3 ... in front of the rows
function renumberRows() {
  [...$('rows').children].forEach((row, index) => {
    row.querySelector('.no').textContent = index + 1;
  });
}

// Reads every row and returns a clean list with the amounts calculated.
// Also writes "Amount: ..." under each row.
function readItems() {
  const items = [];

  [...$('rows').children].forEach(row => {
    const name = row.querySelector('.nm').value.trim();
    const qty = parseFloat(row.querySelector('.q').value);
    const price = parseFloat(row.querySelector('.r').value);
    const unit = row.querySelector('.u').value;
    const priceUnit = row.querySelector('.pu').value || unit;   // empty = same as unit
    const hsn = row.querySelector('.hsn').value.trim();
    const gstRate = parseFloat(row.querySelector('.gr').value) || 0;

    const hasQty = !isNaN(qty);
    const hasPrice = !isNaN(price);

    let amount = 0;
    let warning = '';

    if (hasPrice) {
      if (!hasQty) {
        amount = price;               // no quantity: price is the full amount (e.g. Freight)
      } else {
        const result = lineAmount(qty, unit, price, priceUnit);
        if (result == null) {
          warning = `Units don't match (${unit} vs ${priceUnit}). Choose a matching price unit.`;
        } else {
          amount = result;
        }
      }
    }
    amount = round2(amount);

    const rowHasData = name || hasQty || hasPrice;
    row.querySelector('.amt').textContent =
      warning || (rowHasData ? 'Amount: ₹' + formatMoney(amount) : '');

    if (rowHasData) {
      items.push({
        name,
        qty: hasQty ? qty : null,
        unit,
        price: hasPrice ? price : null,
        priceUnit,
        amount,
        hsn,
        gstRate,
      });
    }
  });

  return items;
}

/* ---------- saved products ---------- */

// Shows the dropdown of saved products under a row's name box
function showProductDropdown(row) {
  const typed = row.querySelector('.nm').value.trim().toLowerCase();
  const list = row.querySelector('.pl');
  const matches = productsOfCompany().filter(p => p.n.toLowerCase().includes(typed));

  if (matches.length) {
    list.innerHTML = matches.map(p => {
      const details = [p.u, p.hsn && 'HSN ' + p.hsn, p.gr && 'GST ' + p.gr + '%']
        .filter(Boolean)
        .join(' · ');
      return `
        <div class="ri" data-p="${escapeHtml(p.n)}">
          <span>${escapeHtml(p.n)}<small>${escapeHtml(details)}</small></span>
          <button class="dx" data-dp="${escapeHtml(p.n)}" aria-label="Delete saved product">×</button>
        </div>`;
    }).join('');
  } else {
    const message = productsOfCompany().length
      ? 'No saved product matches'
      : 'No saved products yet. Type a name and tap Save product.';
    list.innerHTML = `<div class="em">${message}</div>`;
  }
  list.hidden = false;
}

// Fills a row from a saved product (name, unit, HSN, GST %). Rate and quantity stay empty.
function fillRowFromProduct(row, product) {
  row.querySelector('.nm').value = product.n;
  const unitSelect = row.querySelector('.u');
  if (product.u && allUnits().includes(product.u)) unitSelect.value = product.u;
  row.querySelector('.hsn').value = product.hsn || '';
  row.querySelector('.gr').value = product.gr || '';
  updatePreview();
}

// "Save product" button: remembers name + unit + HSN + GST % (never rate or quantity)
function saveProductFromRow(row) {
  if (!company.id) {
    showToast('Add a company first');
    return;
  }
  const name = row.querySelector('.nm').value.trim();
  if (!name) {
    showToast('Type the product name first');
    return;
  }

  const product = {
    cid: company.id,
    n: name,
    u: row.querySelector('.u').value,
    hsn: row.querySelector('.hsn').value.trim(),
    gr: row.querySelector('.gr').value.trim(),
  };

  const existingIndex = savedProducts.findIndex(
    p => p.cid === company.id && p.n.toLowerCase() === name.toLowerCase()
  );
  if (existingIndex >= 0) savedProducts[existingIndex] = product;   // update
  else savedProducts.push(product);                                   // new

  savedProducts.sort((a, b) => a.n.localeCompare(b.n));
  storage.set('products', savedProducts);
  renderProductChips();
  showToast((existingIndex >= 0 ? 'Updated ' : 'Saved ') + name + ' in your products');
}

// Adds a saved product to the first empty row (or a new row)
function addProductToBill(product) {
  let row = [...$('rows').children].find(r =>
    !r.querySelector('.nm').value.trim() &&
    !r.querySelector('.q').value &&
    !r.querySelector('.r').value
  );
  if (!row) {
    addItemRow();
    renumberRows();
    row = $('rows').lastChild;
  }
  fillRowFromProduct(row, product);
}

// The "Saved products" list under the items
function renderProductChips() {
  const list = productsOfCompany();
  if (!list.length) {
    $('plist').textContent = 'No saved products for this company yet. Type a name in an item and tap Save product.';
    return;
  }
  $('plist').innerHTML = list.map((p, index) => `
    <span class="pchip">
      <button data-pa="${index}">${escapeHtml(p.n)}</button>
      <button data-pd="${index}" aria-label="Remove product">×</button>
    </span>`).join('');
}


/* =====================================================================
   6. CUSTOMERS
   ===================================================================== */

// Shows the dropdown of saved customers
function showCustomerDropdown() {
  const typed = $('cname').value.trim().toLowerCase();
  const names = Object.keys(customers);
  const matches = names.filter(name => name.toLowerCase().includes(typed));
  const list = $('cl');

  if (matches.length) {
    list.innerHTML = matches.map(name => `
      <div class="ri" data-k="${escapeHtml(name)}">
        <span>${escapeHtml(name)}<small>${escapeHtml(customers[name].adr || '')}</small></span>
        <button class="dx" data-dk="${escapeHtml(name)}" aria-label="Delete saved customer">×</button>
      </div>`).join('');
  } else {
    const message = names.length
      ? 'No saved customer matches'
      : 'No saved customers yet. Fill the details and tap Save customer.';
    list.innerHTML = `<div class="em">${message}</div>`;
  }
  list.hidden = false;
}

// Reads the first two digits of the customer GSTIN and selects that state
function syncStateFromGstin() {
  const code = $('cgst').value.trim().slice(0, 2);
  if (STATES.some(state => state[0] === code)) $('cstate').value = code;
}


/* =====================================================================
   7. GST CALCULATION
   ===================================================================== */

// items            : list from readItems()
// sameState        : true -> CGST + SGST, false -> IGST
// pricesIncludeGst : true if the prices already contain GST
function calculateGst(items, sameState, pricesIncludeGst) {
  // Step 1: taxable value of each item, grouped by HSN code + GST rate
  const groups = {};
  items.forEach(item => {
    const taxable = pricesIncludeGst
      ? item.amount / (1 + item.gstRate / 100)
      : item.amount;
    item.taxable = round2(taxable);

    const key = (item.hsn || '-') + '|' + item.gstRate;
    if (!groups[key]) groups[key] = { hsn: item.hsn || '-', rate: item.gstRate, taxable: 0 };
    groups[key].taxable += item.taxable;
  });

  // Step 2: tax of each group
  const rows = Object.values(groups).map(group => {
    group.taxable = round2(group.taxable);
    if (sameState) {
      group.cgst = group.sgst = Math.round(group.taxable * group.rate / 2) / 100;
      group.igst = 0;
    } else {
      group.igst = Math.round(group.taxable * group.rate) / 100;
      group.cgst = group.sgst = 0;
    }
    group.tax = round2(group.cgst + group.sgst + group.igst);
    return group;
  });

  // Step 3: tax added up per GST rate (shown under the items)
  const byRate = {};
  rows.forEach(group => {
    const entry = byRate[group.rate] || (byRate[group.rate] = { rate: group.rate, cgst: 0, sgst: 0, igst: 0 });
    entry.cgst = round2(entry.cgst + group.cgst);
    entry.sgst = round2(entry.sgst + group.sgst);
    entry.igst = round2(entry.igst + group.igst);
  });

  // Step 4: totals and round-off
  const taxable = round2(rows.reduce((sum, g) => sum + g.taxable, 0));
  const tax = round2(rows.reduce((sum, g) => sum + g.tax, 0));
  const grand = round2(taxable + tax);
  const total = Math.round(grand);

  return {
    rows,                                                   // one line per HSN + rate
    rates: Object.values(byRate).filter(r => r.rate > 0),   // one line per GST rate
    taxable,
    tax,
    grand,
    roundOff: round2(total - grand),
    total,
  };
}


/* =====================================================================
   8. BUILDING THE BILL (returns HTML text)
   ===================================================================== */

// Lines of the "Bank Details" block on the Bill of Supply
function supplyBankHtml(c) {
  const lines = [
    c.bank && 'Bank Name: ' + c.bank,
    c.branch && 'Branch Name: ' + c.branch,
    c.acc && 'Account Number: ' + c.acc,
    c.ifsc && 'IFSC Code: ' + c.ifsc,
  ].filter(Boolean);

  if (!lines.length) return '';
  return `<div class="bk">Bank Details:-<br>${lines.map(escapeHtml).join('<br>')}</div>`;
}

// Font size for the firm name: long names get a smaller font
const firmNameSize = name => Math.max(9, Math.min(16, 16 * 30 / Math.max(1, name.length)));

// Picks the right builder for one page of the bill
function buildPage(pageIndex, pageCount, items, total, meta) {
  return meta.type === 'gst'
    ? buildGstPage(pageIndex, pageCount, items, meta)
    : buildSupplyPage(pageIndex, pageCount, items, total, meta);
}

/* ---------- Bill of Supply (no tax) ---------- */

function buildSupplyPage(pageIndex, pageCount, items, total, meta) {
  const c = company;
  const phones = [c.ph1, c.ph2].filter(Boolean).join(' , ');
  const pageItems = items.slice(pageIndex * ITEMS_PER_PAGE_SUPPLY, (pageIndex + 1) * ITEMS_PER_PAGE_SUPPLY);
  const isLastPage = pageIndex === pageCount - 1;

  // Always draw the full number of rows, so every page has the same height
  let rowsHtml = '';
  for (let i = 0; i < ITEMS_PER_PAGE_SUPPLY; i++) {
    const item = pageItems[i];
    if (!item) {
      rowsHtml += '<tr><td></td><td></td><td></td><td></td><td></td></tr>';
      continue;
    }
    const qtyText = item.qty != null ? `${formatQty(item.qty)} ${escapeHtml(item.unit)}` : '';
    const rateText = item.qty != null && item.price != null
      ? `${formatMoney(item.price)}/${escapeHtml(item.priceUnit)}` : '';
    const valueText = item.price != null ? formatMoney(item.amount) : '';
    rowsHtml += `<tr>
      <td>${pageIndex * ITEMS_PER_PAGE_SUPPLY + i + 1}</td>
      <td>${escapeHtml(item.name)}</td>
      <td>${qtyText}</td>
      <td>${rateText}</td>
      <td>${valueText}</td>
    </tr>`;
  }

  const serialText = meta.sno + (pageCount > 1 ? '&nbsp; Page-' + (pageIndex + 1) : '');
  const totalText = isLastPage && items.length ? '₹ ' + formatMoney(total) : '';
  const wordsText = isLastPage
    ? (items.length ? amountInWords(total) : '')
    : 'Continue on Page ' + (pageIndex + 2);

  return `
  <div class="bill">
    <div class="t">
      <span>GSTIN : ${escapeHtml(c.gstin)}${c.fssai ? '<br>FSSAI License No. : ' + escapeHtml(c.fssai) : ''}</span>
      <span style="margin-top:3mm">${COPY_MARKER}</span>
    </div>

    <div class="c" style="margin-top:3mm">
      <b><u>BILL OF SUPPLY</u>${c.nick ? '<br>(' + escapeHtml(c.nick.toUpperCase()) + ')' : ''}</b>
    </div>
    <div class="nmx" style="font-size:${firmNameSize(c.firm)}pt">${escapeHtml(c.firm.toUpperCase())}</div>
    <div class="c sm">
      (Composition Taxable Person, Not Eligible to Collect Tax on Supply)
      ${c.adr ? '<br>' + escapeHtml(c.adr) : ''}
      ${phones ? '<br>Mob.: ' + escapeHtml(phones) : ''}
    </div>

    <div class="t" style="margin-top:2mm">
      <span>S.No.: ${serialText}</span>
      <span>Date of Issue: ${escapeHtml(formatDate(meta.date))}</span>
    </div>
    <div>Name : ${escapeHtml(meta.name)}</div>
    <div>Address: ${escapeHtml(meta.address)}</div>
    <div class="t">
      <span>GSTIN/UIN: ${escapeHtml(meta.gstin)}</span>
      <span>State: ${escapeHtml(c.state)} &nbsp;&nbsp; State Code: ${escapeHtml(c.scode)}</span>
    </div>

    <table>
      <colgroup>
        <col style="width:8%"><col style="width:35%"><col style="width:22%"><col style="width:19%"><col style="width:16%">
      </colgroup>
      <tr><th>S no.</th><th>Name of the Product</th><th>Net Wt./Qty.</th><th>Rate</th><th>Value(Rs)</th></tr>
      ${rowsHtml}
      <tr>
        <td class="r" colspan="4">TOTAL:-</td>
        <td style="border-top:1px solid #000"><b>${totalText}</b></td>
      </tr>
    </table>

    <div class="wd"><div>Total amount (in words):-</div><div>${wordsText}</div></div>

    ${supplyBankHtml(c)}

    <div class="ft">
      <div>
        Terms &amp; Conditions:<br>
        1. All subjects to ${escapeHtml(jurisdictionOf(c))} jurisdiction only.<br>
        2. Goods once sold cannot be taken back.
      </div>
      <div class="s">${escapeHtml(c.firm.toUpperCase())}<br><br>Authorised Signatory</div>
    </div>
  </div>`;
}

/* ---------- GST Tax Invoice ---------- */

function buildGstPage(pageIndex, pageCount, items, meta) {
  const c = company;
  const gst = meta.gst;
  const extra = meta.extra;
  const isLastPage = pageIndex === pageCount - 1;
  const perPage = ITEMS_PER_PAGE_GST;
  const pageItems = items.slice(pageIndex * perPage, (pageIndex + 1) * perPage);
  const phones = [c.ph1, c.ph2].filter(Boolean).join(' , ');
  const pan = (c.gstin || '').slice(2, 12);   // PAN = characters 3 to 12 of the GSTIN
  const serialText = meta.sno + (pageCount > 1 ? '  Page-' + (pageIndex + 1) : '');

  // --- small builders for table cells and lines ---
  const cell = (content, cssClass = '') =>
    `<td${cssClass ? ` class="${cssClass}"` : ''}>${content}</td>`;

  // A line under the items: label in the name column, amount in the last column
  const taxLine = (label, amount, bold = false) => `
    <tr><td></td><td class="tr">${label}</td><td></td><td></td><td></td>
    <td class="tr">${bold ? '<b>' + formatMoney(amount) + '</b>' : formatMoney(amount)}</td></tr>`;

  // One "label : value" line in the customer / invoice boxes
  const detail = (label, value, boldLabel = false, boldValue = false) => {
    const text = escapeHtml(value || '');
    return `<div class="kv">
      <span>${boldLabel ? '<b>' + label + '</b>' : label}</span>
      <span>${boldValue ? '<b>' + text + '</b>' : text}</span>
    </div>`;
  };

  // --- item rows ---
  const bodyRows = pageItems.map((item, i) => {
    const qtyText = item.qty != null ? `${formatQty(item.qty)} ${escapeHtml(item.unit)}` : '';
    const rateText = item.qty != null && item.price != null
      ? `${formatMoney(item.price)}/${escapeHtml(item.priceUnit)}` : '';
    const taxableText = item.price != null ? formatMoney(item.taxable) : '';
    return '<tr>' +
      cell(pageIndex * perPage + i + 1, 'c') +
      cell('<b>' + escapeHtml(item.name) + '</b>', 'tl') +
      cell(escapeHtml(item.hsn), 'c') +
      cell(qtyText, 'c') +
      cell(rateText, 'tr') +
      cell(taxableText, 'tr') +
      '</tr>';
  });

  // --- parts that appear only on the last page ---
  let totalQtyText = '';
  let wordsBox = '';
  let hsnSummary = '';

  if (isLastPage) {
    // taxable total, then CGST/SGST or IGST per rate, then round-off
    bodyRows.push(taxLine('', gst.taxable, true));
    gst.rates.forEach(r => {
      if (meta.sameState) {
        bodyRows.push(taxLine(`CGST (${formatMoney(r.rate / 2)} %)`, r.cgst));
        bodyRows.push(taxLine(`SGST (${formatMoney(r.rate / 2)} %)`, r.sgst));
      } else {
        bodyRows.push(taxLine(`IGST (${formatMoney(r.rate)} %)`, r.igst));
      }
    });
    if (gst.roundOff) bodyRows.push(taxLine('Round off', gst.roundOff));

    // total quantity, one figure per unit, e.g. "2 NOS, 5 Kg"
    const quantityByUnit = {};
    items.forEach(item => {
      if (item.qty != null) quantityByUnit[item.unit] = (quantityByUnit[item.unit] || 0) + item.qty;
    });
    totalQtyText = Object.keys(quantityByUnit)
      .map(unit => formatQty(round2(quantityByUnit[unit])) + ' ' + escapeHtml(unit))
      .join(', ');

    wordsBox = `
      <div class="w">
        <div class="ww"><span>Total in words</span><span>(E &amp; O.E.)</span></div>
        <b>${escapeHtml(amountInWords(gst.total, true))}</b>
      </div>`;

    hsnSummary = buildHsnSummary(gst, meta.sameState, cell);
  } else {
    bodyRows.push(
      `<tr><td></td><td class="c">Continue on Page ${pageIndex + 2}</td><td></td><td></td><td></td><td></td></tr>`
    );
  }

  // pad with empty rows so the table always has the same height
  const emptyCells = '<td></td>'.repeat(6);
  while (bodyRows.length < GST_TABLE_ROWS) bodyRows.push(`<tr>${emptyCells}</tr>`);

  const totalRow = isLastPage
    ? `<tr class="ts"><td></td><td class="tr"><b>Total</b></td><td></td>
         <td class="c"><b>${totalQtyText}</b></td><td></td>
         <td class="tr"><b>₹ ${formatMoney(gst.total)}</b></td></tr>`
    : `<tr class="ts">${emptyCells}</tr>`;

  // --- bank details and UPI QR code ---
  const bankLines = [
    ['Name', c.bank], ['Branch', c.branch], ['Acc. Number', c.acc], ['IFSC', c.ifsc], ['UPI ID', c.upi],
  ]
    .filter(line => line[1])
    .map(line => `<div class="kb"><b>${line[0]}</b><span>${escapeHtml(line[1])}</span></div>`)
    .join('');

  const qrHtml = buildUpiQr(c, gst.total);

  // --- the whole page ---
  return `
  <div class="bill g">

    <div class="hd">
      <div>
        <div class="fn">${escapeHtml(c.firm)}</div>
        ${c.nick ? `<div class="tag">${escapeHtml(c.nick)}</div>` : ''}
        <div>${escapeHtml(c.adr || '')}</div>
      </div>
      <div class="rt">
        ${phones ? 'Tel : ' + escapeHtml(phones) + '<br>' : ''}
        ${c.email ? 'Email : ' + escapeHtml(c.email) + '<br>' : ''}
        GSTIN : ${escapeHtml(c.gstin)}
        ${c.fssai ? '<br>FSSAI Lic. No. : ' + escapeHtml(c.fssai) : ''}
      </div>
    </div>

    <div class="tt">
      <b>PAN : ${escapeHtml(pan)}</b>
      <span class="t">TAX INVOICE</span>
      <b class="orc">${COPY_MARKER}</b>
    </div>

    <div class="cb2">
      <div>
        <div class="ch">Customer Detail</div>
        ${detail('M/S', meta.name, true)}
        ${detail('Address', meta.address, true)}
        ${detail('Phone', extra.cph, true)}
        ${detail('GSTIN', meta.gstin, true)}
        ${detail('Place of Supply', meta.placeOfSupply, true)}
      </div>
      <div>
        <div class="ch">&nbsp;</div>
        <div class="iv">
          <div>
            ${detail('Invoice No.', serialText, false, true)}
            ${detail('Challan No', extra.chn)}
            ${detail('E-Way Bill No.', extra.ewb)}
            ${detail('Transport', extra.trn)}
            ${detail('Transport ID', extra.tid)}
          </div>
          <div>
            ${detail('Invoice Date', formatDate(meta.date))}
            ${detail('Challan Date', formatDate(extra.chd))}
          </div>
        </div>
      </div>
    </div>

    <table class="it">
      <colgroup>
        <col style="width:6%"><col style="width:38%"><col style="width:12%">
        <col style="width:12%"><col style="width:15%"><col style="width:17%">
      </colgroup>
      <tr>
        <th>Sr. No.</th><th>Name of Product / Service</th><th>HSN / SAC</th>
        <th>Qty</th><th>Rate</th><th>Taxable Value</th>
      </tr>
      ${bodyRows.join('')}
      ${totalRow}
    </table>

    ${wordsBox}
    ${hsnSummary}

    <div class="ftg">
      <div class="bk2">
        <div class="bnk">
          <div class="gh">Bank Details</div>
          <div class="bkw"><div class="bkl">${bankLines}</div>${qrHtml}</div>
        </div>
        <div class="sgn">
          <div class="cert">Certified that the particulars given above are true and correct.</div>
          <div class="fo">For ${escapeHtml(c.firm)}</div>
          <div class="sp"></div>
          <div class="as">Authorised Signatory</div>
        </div>
      </div>

      <div class="gh" style="border-top:1px solid #000">Terms and Conditions</div>
      <div class="tcx">
        Subject to ${escapeHtml(jurisdictionOf(c))} Jurisdiction.<br>
        Our Responsibility Ceases as soon as goods leave our Premises.<br>
        Goods once sold will not be taken back.<br>
        Delivery Ex-Premises.
      </div>
      <div class="csg"><b>Customer Signature</b></div>
      <div class="thx">Thank you for shopping with us!</div>
    </div>

  </div>`;
}

// The small tax summary table (HSN wise) under the amount in words
function buildHsnSummary(gst, sameState, cell) {
  const sum = key => gst.rows.reduce((total, row) => total + row[key], 0);
  let header, body, totalRow;

  if (sameState) {
    header = `
      <tr><th rowspan="2">HSN / SAC</th><th rowspan="2">Taxable Value</th>
          <th colspan="2">CGST</th><th colspan="2">SGST</th><th rowspan="2">Total</th></tr>
      <tr><th>%</th><th>Amount</th><th>%</th><th>Amount</th></tr>`;
    body = gst.rows.map(r => '<tr>' +
      cell(escapeHtml(r.hsn), 'c') + cell(formatMoney(r.taxable), 'tr') +
      cell(formatMoney(r.rate / 2), 'c') + cell(formatMoney(r.cgst), 'tr') +
      cell(formatMoney(r.rate / 2), 'c') + cell(formatMoney(r.sgst), 'tr') +
      cell(formatMoney(r.tax), 'tr') + '</tr>').join('');
    totalRow = '<tr class="ts">' +
      cell('<b>Total</b>', 'c') + cell('<b>' + formatMoney(sum('taxable')) + '</b>', 'tr') +
      cell('') + cell('<b>' + formatMoney(sum('cgst')) + '</b>', 'tr') +
      cell('') + cell('<b>' + formatMoney(sum('sgst')) + '</b>', 'tr') +
      cell('<b>' + formatMoney(gst.tax) + '</b>', 'tr') + '</tr>';
  } else {
    header = `
      <tr><th rowspan="2">HSN / SAC</th><th rowspan="2">Taxable Value</th>
          <th colspan="2">IGST</th><th rowspan="2">Total</th></tr>
      <tr><th>%</th><th>Amount</th></tr>`;
    body = gst.rows.map(r => '<tr>' +
      cell(escapeHtml(r.hsn), 'c') + cell(formatMoney(r.taxable), 'tr') +
      cell(formatMoney(r.rate), 'c') + cell(formatMoney(r.igst), 'tr') +
      cell(formatMoney(r.tax), 'tr') + '</tr>').join('');
    totalRow = '<tr class="ts">' +
      cell('<b>Total</b>', 'c') + cell('<b>' + formatMoney(sum('taxable')) + '</b>', 'tr') +
      cell('') + cell('<b>' + formatMoney(sum('igst')) + '</b>', 'tr') +
      cell('<b>' + formatMoney(gst.tax) + '</b>', 'tr') + '</tr>';
  }

  return `
    <table class="hs" style="table-layout:auto">${header}${body}${totalRow}</table>
    <div class="w">Total Tax in words: <b>${escapeHtml(amountInWords(gst.tax, true))}</b></div>`;
}

// UPI QR code (needs the qrcode library from index.html). Returns '' if not possible.
function buildUpiQr(c, amount) {
  if (!c.upi || !window.qrcode) return '';
  try {
    const link =
      'upi://pay?pa=' + c.upi.trim() +
      '&pn=' + encodeURIComponent(c.firm) +
      '&cu=INR' +
      (amount ? '&am=' + amount.toFixed(2) : '');
    const qr = qrcode(0, 'M');
    qr.addData(link);
    qr.make();
    return `<div class="qrb">${qr.createSvgTag(2, 0)}<b>Pay using UPI</b></div>`;
  } catch (error) {
    return '';
  }
}


/* =====================================================================
   9. LIVE PREVIEW
   ===================================================================== */

// Ticked copy types (Original, Duplicate ...)
function selectedCopyTypes() {
  const ticked = [...document.querySelectorAll('#cps input:checked')].map(box => box.value);
  return COPY_TYPES.filter(type => ticked.includes(type[0]));
}

// Replaces the copy marker with the label of the given copy type
function withCopyLabel(html, copyType) {
  const type = copyType || COPY_TYPES[0];
  const label = isGstBill() ? type[2] : type[3];
  return html.split(COPY_MARKER).join(label);
}

// Shows or hides GST-only fields and sets the page title
function applyBillType() {
  $('form').classList.toggle('nogst', !isGstBill());
  $('ttl').textContent = isGstBill() ? 'Tax Invoice' : 'Bill of Supply';
}

// Shrinks the preview so a whole bill fits in its panel
function fitPreview() {
  const availableWidth = $('preview').clientWidth;
  const gst = isGstBill();
  let zoom = Math.min(1, (availableWidth - 2) / (gst ? GST_WIDTH_PX : SUPPLY_WIDTH_PX));

  // On desktop the preview also has to fit the window height
  if (matchMedia('(min-width:861px)').matches) {
    zoom = Math.min(zoom, (innerHeight - 40) / (gst ? GST_HEIGHT_PX : SUPPLY_HEIGHT_PX));
  }
  $('sheets').style.zoom = zoom;
}

// Values of the extra GST fields as an object {cph, chn, ...}
function readExtraFields() {
  const values = {};
  EXTRA_FIELDS.forEach(([id]) => { values[id] = $(id).value; });
  return values;
}

// Selects the company's own state in the "Place of supply" dropdown
function selectDefaultState() {
  const code = padStateCode(company.scode);
  if (STATES.some(state => state[0] === code)) $('cstate').value = code;
}

// Text under the copy tick-boxes: "Prints 2 copies of each page: ..."
function showCopySummary() {
  const copies = selectedCopyTypes();
  const labelIndex = isGstBill() ? 2 : 3;
  $('cpi').textContent = copies.length
    ? `Prints ${copies.length} cop${copies.length === 1 ? 'y' : 'ies'} of each page: ` +
      copies.map(type => type[labelIndex]).join(', ')
    : 'Tick at least one copy type to print.';
}

// Runs on every key press: reads the form, recalculates, redraws the bill
function updatePreview() {
  applyBillType();

  const items = readItems();
  const pageCount = Math.max(1, Math.ceil(items.length / itemsPerPage()));
  const isGst = isGstBill();

  const subtotal = round2(items.reduce((sum, item) => sum + item.amount, 0));
  const customerStateCode = $('cstate').value || padStateCode(company.scode);
  const sameState = customerStateCode === padStateCode(company.scode);
  const gst = isGst ? calculateGst(items, sameState, $('incl').checked) : null;
  const total = isGst ? gst.total : subtotal;
  const state = STATES.find(s => s[0] === customerStateCode);

  // everything the bill needs, in one object
  const meta = {
    type: isGst ? 'gst' : 'sup',
    sno: $('sno').value,
    date: $('date').value,
    name: $('cname').value,
    address: $('cadr').value,
    gstin: $('cgst').value,
    extra: readExtraFields(),
    placeOfSupply: state ? `${state[1]} (${state[0]})` : '',
    sameState,
    gst,
  };

  lastState = { items, total, pageCount, meta };

  pageHtmlList = [];
  for (let page = 0; page < pageCount; page++) {
    pageHtmlList.push(buildPage(page, pageCount, items, total, meta));
  }

  // preview shows the first ticked copy type
  const firstCopy = selectedCopyTypes()[0];
  $('sheets').innerHTML = pageHtmlList.map(html => withCopyLabel(html, firstCopy)).join('');

  showCopySummary();
  $('gt').textContent =
    (isGst ? 'Invoice total: ₹' : 'Total: ₹') + formatMoney(total) +
    (isGst ? (sameState ? ' (CGST + SGST)' : ' (IGST)') : '');
  $('info').textContent =
    `${items.length} item${items.length === 1 ? '' : 's'} · ${pageCount} page${pageCount > 1 ? 's' : ''} ` +
    `(${itemsPerPage()} items per page)`;

  fitPreview();
  if (!currentBillId) storage.set('sno_' + company.id, $('sno').value);
  showEditingLabel();
  showCompanyNote();
}


/* =====================================================================
   10. PRINTING
   ===================================================================== */

// Fills the hidden print area: every page once per ticked copy type
function buildPrintArea() {
  saveBill(true);   // silently save before printing

  $('pgstyle').textContent =
    '@page{size:A4 ' + (isGstBill() ? 'portrait' : 'landscape') + ';margin:6mm}';

  let copies = selectedCopyTypes();
  if (!copies.length) copies = [COPY_TYPES[0]];   // nothing ticked: print the original

  $('printArea').innerHTML = pageHtmlList
    .map(html => copies.map(copy => withCopyLabel(html, copy)).join(''))
    .join('');
}

$('print').onclick = () => {
  if (!company.id) {
    showToast('Add a company first');
    return;
  }
  if (!selectedCopyTypes().length) {
    showToast('Tick at least one copy type first');
    return;
  }
  buildPrintArea();
  print();
};

// Also fills the print area if the user presses Ctrl+P
addEventListener('beforeprint', buildPrintArea);


/* =====================================================================
   11. PDF DOWNLOAD AND SHARE
   html2canvas takes a picture of each page, jsPDF puts the pictures in a PDF
   ===================================================================== */

// File name, for example: Bill-334_08.07.2026_Mahaveer Traders.pdf
function pdfFileName() {
  const name =
    'Bill-' + ($('sno').value || 'new') +
    '_' + formatDateDots($('date').value) +
    '_' + (company.nick || company.firm || 'Company');
  return name.replace(/[\\/:*?"<>|]/g, '').trim() + '.pdf';   // remove characters files cannot have
}

// Makes the PDF (every page, once per ticked copy type). Returns a File.
async function makePdf() {
  if (!(window.html2canvas && window.jspdf)) {
    showToast('PDF tools did not load. Check internet and retry');
    return null;
  }

  updatePreview();
  saveBill(true);
  showToast('Making PDF...');

  let copies = selectedCopyTypes();
  if (!copies.length) copies = [COPY_TYPES[0]];

  // draw the pages off-screen so we can take pictures of them
  const offscreen = document.createElement('div');
  offscreen.style.cssText = 'position:fixed;left:-10000px;top:0';
  offscreen.innerHTML = pageHtmlList
    .map(html => copies.map(copy => withCopyLabel(html, copy)).join(''))
    .join('');
  document.body.appendChild(offscreen);

  try {
    const { jsPDF } = window.jspdf;
    const pageSize = isGstBill() ? [198, 284] : [140, 196];   // millimetres
    let pdf = null;

    for (const pageElement of [...offscreen.children]) {
      const picture = await html2canvas(pageElement, { scale: 2.5, backgroundColor: '#ffffff' });
      if (!pdf) pdf = new jsPDF({ unit: 'mm', format: pageSize });
      else pdf.addPage(pageSize);
      pdf.addImage(picture.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, pageSize[0], pageSize[1]);
    }
    return new File([pdf.output('blob')], pdfFileName(), { type: 'application/pdf' });
  } finally {
    offscreen.remove();   // always clean up
  }
}

// Starts the browser download of a file
function downloadFile(file) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(file);
  link.download = file.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

async function downloadPdf() {
  const file = await makePdf();
  if (file) downloadFile(file);
}

// Opens the phone's share sheet (WhatsApp etc.). Falls back to a download.
async function sharePdf() {
  const file = await makePdf();
  if (!file) return;

  const title = (isGstBill() ? 'Tax Invoice ' : 'Bill of Supply ') + ($('sno').value || '');
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title, text: title });
      return;
    }
  } catch (error) {
    if (error && error.name === 'AbortError') return;   // user closed the share sheet
  }
  showToast('Direct sharing is not available here. Save the PDF, then attach it in WhatsApp');
  downloadFile(file);
}

$('pdf').onclick = () => downloadPdf().catch(() => showToast('Could not make the PDF'));
$('share').onclick = () => sharePdf().catch(() => showToast('Could not share the PDF'));


/* =====================================================================
   12. SAVED BILLS
   Bills are kept for 30 days. Starred bills are kept until you delete them.
   ===================================================================== */

// "Bill No. 112_ 01.02.2026" (+ " (updated)" for later versions)
function billTitle(bill) {
  const version = bill.ver || 1;
  let title = `Bill No. ${bill.sno}_ ${formatDateDots(bill.date)}`;
  if (version === 2) title += ' (updated)';
  else if (version > 2) title += ` (updated ${version - 1})`;
  return title;
}

// Removes bills older than 30 days (starred bills stay)
function removeExpiredBills() {
  savedBills = savedBills.filter(bill => bill.star || Date.now() - bill.t < SAVE_DAYS_MS);
}

// Raw values of every filled row, exactly as typed (this is what gets saved)
function readRawRows() {
  return [...$('rows').children]
    .map(row => ({
      n: row.querySelector('.nm').value,
      q: row.querySelector('.q').value,
      u: row.querySelector('.u').value,
      r: row.querySelector('.r').value,
      pu: row.querySelector('.pu').value,
      hsn: row.querySelector('.hsn').value,
      gr: row.querySelector('.gr').value,
    }))
    .filter(row => row.n.trim() || row.q || row.r);
}

// Fingerprint of a bill, used to detect "nothing changed since last save"
function billFingerprint(bill) {
  return JSON.stringify([
    bill.sno, bill.date, bill.cname, bill.cadr, bill.cgst, bill.rows, bill.x || 0,
    bill.btype || 'sup',
    bill.btype === 'gst' ? [bill.cstate, !!bill.incl] : 0,
  ]);
}

// Saves the bill. silent = true -> no pop-up messages (used before printing).
// Returns true if the bill is saved.
function saveBill(silent) {
  const serial = $('sno').value.trim();
  const rows = readRawRows();

  if (!company.id) {
    if (!silent) showToast('Add a company first');
    return false;
  }
  if (!serial) {
    if (!silent) showToast('Enter the serial number first');
    return false;
  }
  if (!rows.length) {
    if (!silent) showToast('Add at least one item first');
    return false;
  }

  removeExpiredBills();

  const record = {
    btype: isGstBill() ? 'gst' : 'sup',
    x: readExtraFields(),
    cstate: $('cstate').value,
    incl: $('incl').checked,
    cid: company.id,
    co: Object.assign({}, company),        // copy of the company details at save time
    sno: serial,
    date: $('date').value,
    cname: $('cname').value,
    cadr: $('cadr').value,
    cgst: $('cgst').value,
    rows,
  };

  // earlier saves of the same serial number for this company
  const sameSerial = savedBills.filter(b => b.sno === serial && (b.cid || '') === company.id);

  // nothing changed -> do not create a duplicate
  if (sameSerial.length && billFingerprint(sameSerial[0]) === billFingerprint(record)) {
    currentBillId = sameSerial[0].id;
    renderSavedBills();
    showEditingLabel();
    if (!silent) showToast('No changes since the last save of this bill');
    return true;
  }

  // changed -> save as a new version
  const version = sameSerial.length ? Math.max(...sameSerial.map(b => b.ver || 1)) + 1 : 1;
  updatePreview();   // make sure the total is up to date

  const bill = Object.assign(
    {
      id: Date.now() + Math.random().toString(36).slice(2, 6),
      ver: version,
      total: lastState.total,
      t: Date.now(),
    },
    record
  );

  savedBills.unshift(bill);          // newest first
  currentBillId = bill.id;
  storage.set('bills', savedBills);
  renderSavedBills();
  showEditingLabel();
  if (!silent) showToast('Saved ' + billTitle(bill));
  return true;
}

// Draws the "Saved bills" list (only the selected company's bills)
function renderSavedBills() {
  const mine = savedBills.filter(bill => (bill.cid || '') === company.id);

  if (!mine.length) {
    $('bl').innerHTML = '<div class="pg">No saved bills for this company yet.</div>';
  } else {
    $('bl').innerHTML = mine.map(bill => {
      const companyName = (bill.co && (bill.co.nick || bill.co.firm)) || company.nick || company.firm;
      const customer = bill.cname || bill.cgst || 'No customer';
      const daysLeft = Math.max(1, Math.ceil((bill.t + SAVE_DAYS_MS - Date.now()) / 86400000));
      const status = bill.star ? 'Starred, kept until you delete it' : daysLeft + ' days left';

      return `
        <div class="bi" data-id="${bill.id}">
          <div class="bo">
            <b>${escapeHtml(billTitle(bill))}</b>
            <small>${escapeHtml(companyName + ' | ' + customer)}</small>
            <small>₹${formatQty(bill.total || 0)} · ${status}</small>
          </div>
          <button class="bd" data-star="${bill.id}" style="${bill.star ? 'color:#e0a800' : ''}"
                  aria-label="${bill.star ? 'Remove star' : 'Star this bill'}">${bill.star ? '★' : '☆'}</button>
          <button class="bd" data-del="${bill.id}" aria-label="Delete saved bill">×</button>
        </div>`;
    }).join('');
  }
  $('bc').textContent = `(${mine.length})`;
}

// "Saved as: Bill No. ..." line above the serial number
function showEditingLabel() {
  const bill = savedBills.find(b => b.id === currentBillId);
  $('ed').textContent = bill ? 'Saved as: ' + billTitle(bill) : '';
}

// Loads a saved bill back into the form
function openSavedBill(id) {
  const bill = savedBills.find(b => b.id === id);
  if (!bill) return;

  // switch to the bill's company (add it back if it was deleted)
  let owner = companies.find(c => c.id === (bill.cid || ''));
  if (!owner && bill.co) {
    owner = bill.co;
    companies.push(owner);
    storage.set('companies', companies);
  }
  if (owner) {
    company = owner;
    storage.set('coId', company.id);
    fillCompanyDropdown();
  }

  currentBillId = id;
  $('sno').value = bill.sno;
  $('date').value = bill.date || todayISO();
  $('cname').value = bill.cname || '';
  $('cadr').value = bill.cadr || '';
  $('cgst').value = bill.cgst || '';
  EXTRA_FIELDS.forEach(([fieldId]) => { $(fieldId).value = (bill.x || {})[fieldId] || ''; });
  $('cstate').value = bill.cstate || padStateCode(company.scode);
  $('incl').checked = !!bill.incl;

  $('rows').innerHTML = '';
  bill.rows.forEach(rowData => addItemRow(rowData));
  for (let i = bill.rows.length; i < BLANK_ROWS_AT_START; i++) addItemRow();

  renumberRows();
  updatePreview();
  scrollTo(0, 0);
  renderSavedBills();
  renderProductChips();
  showToast('Opened ' + billTitle(bill));
}

// Clicks inside the saved bills list: star, delete, or open
$('bl').onclick = event => {
  // star / unstar
  const starButton = event.target.closest('[data-star]');
  if (starButton) {
    const bill = savedBills.find(b => b.id === starButton.dataset.star);
    if (bill) {
      bill.star = !bill.star;
      storage.set('bills', savedBills);
      renderSavedBills();
      showToast(bill.star
        ? 'Starred. It is kept until you delete it'
        : 'Star removed. It can expire 30 days after it was saved');
    }
    return;
  }

  // delete (two taps)
  const deleteButton = event.target.closest('[data-del]');
  if (deleteButton) {
    const id = deleteButton.dataset.del;
    confirmDelete(
      deleteButton,
      'b:' + id,
      () => {
        savedBills = savedBills.filter(b => b.id !== id);
        if (currentBillId === id) currentBillId = null;
        storage.set('bills', savedBills);
        renderSavedBills();
        showEditingLabel();
        showToast('Bill deleted');
      },
      renderSavedBills
    );
    return;
  }

  // open the bill
  const row = event.target.closest('[data-id]');
  if (row) openSavedBill(row.dataset.id);
};

$('sv').onclick = () => saveBill(false);


/* =====================================================================
   13. COMPANY FORM (add / edit / delete)
   ===================================================================== */

// Opens the form. Pass a company to edit it, or null to add a new one.
function openCompanyForm(c) {
  editingCompanyId = c ? c.id : null;
  COMPANY_FIELDS.forEach(([key]) => { $('f_' + key).value = c ? (c[key] || '') : ''; });
  $('f_bt').value = c ? billTypeOf(c) : 'sup';
  $('coform').hidden = false;
  $('f_firm').focus();
}

// Save button of the company form
$('cosave').onclick = () => {
  const data = {};
  COMPANY_FIELDS.forEach(([key]) => { data[key] = $('f_' + key).value.trim(); });

  if (!data.firm || !data.gstin || !data.city || !data.state) {
    showToast('Firm name, GSTIN, City and State are required');
    return;
  }

  data.bt = $('f_bt').value;
  data.reg = data.bt === 'gst' ? 'Regular' : 'Composition';
  data.gstin = data.gstin.toUpperCase();
  data.ifsc = data.ifsc.toUpperCase();
  $('coform').hidden = true;

  if (editingCompanyId) {
    // edit: update the stored company in place
    Object.assign(companies.find(c => c.id === editingCompanyId), data);
    storage.set('companies', companies);
    fillCompanyDropdown();
    updatePreview();
    renderSavedBills();
    renderProductChips();
  } else {
    // add: give it a new id and switch to it
    data.id = 'c' + Date.now();
    companies.push(data);
    storage.set('companies', companies);
    switchCompany(data);
  }
  showToast('Company saved');
};

$('cosel').onchange = () =>
  switchCompany(companies.find(c => c.id === $('cosel').value) || companies[0]);
$('coadd').onclick = () => openCompanyForm(null);
$('coedit').onclick = () => openCompanyForm(company.id ? company : null);
$('cocancel').onclick = () => { $('coform').hidden = true; };

// Delete company (two taps). Its products are deleted too.
makeTwoTapButton($('codel'), () => {
  if (!company.id) {
    showToast('No company to delete');
    return;
  }
  savedProducts = savedProducts.filter(p => p.cid !== company.id);
  storage.set('products', savedProducts);
  companies = companies.filter(c => c.id !== company.id);
  storage.set('companies', companies);
  $('coform').hidden = true;
  switchCompany(companies[0] || EMPTY_COMPANY);
  showToast('Company deleted');
});


/* =====================================================================
   14. STATES, CUSTOM UNITS AND OTHER BUTTONS
   ===================================================================== */

/* ---------- fields that are created by JavaScript ---------- */

// Company form fields
$('cofields').innerHTML = COMPANY_FIELDS.map(([key, label, wide]) => `
  <div${wide ? ' style="grid-column:1/-1"' : ''}>
    <label for="f_${key}">${label}</label>
    <input id="f_${key}"${key === 'ph1' || key === 'ph2' ? ' type="tel" inputmode="tel"' : ''}>
  </div>`).join('');

// "Place of supply" dropdown
$('cstate').innerHTML = STATES
  .map(([code, name]) => `<option value="${code}">${name} (${code})</option>`)
  .join('');

// Extra GST fields (challan, e-way bill ...)
$('xf').innerHTML = EXTRA_FIELDS.map(([id, label, type]) => `
  <div class="f">
    <label for="${id}">${label}</label>
    <input id="${id}"${type ? ` type="${type}"` : ''}>
  </div>`).join('');

// Print copy tick-boxes (the choice is remembered; first visit: Original + Duplicate)
const rememberedCopies = storage.get('cps', ['o', 'd']);

$('cps').innerHTML = COPY_TYPES.map(([id, label]) => `
  <label class="check-label" style="margin:0">
    <input type="checkbox" value="${id}"${rememberedCopies.includes(id) ? ' checked' : ''}>
    ${label}
  </label>`).join('');

$('cps').onchange = () => {
  storage.set('cps', selectedCopyTypes().map(type => type[0]));
  updatePreview();
};

/* ---------- recalculate when the basic fields change ---------- */

// GSTIN first: it also picks the state, which the preview needs
$('cgst').addEventListener('input', syncStateFromGstin);

['sno', 'date', 'cname', 'cadr', 'cgst', ...EXTRA_FIELDS.map(f => f[0])]
  .forEach(id => $(id).addEventListener('input', updatePreview));

['cstate', 'incl'].forEach(id => $(id).addEventListener('change', updatePreview));
addEventListener('resize', fitPreview);

/* ---------- customers (save / delete / pick) ---------- */

$('cname').addEventListener('focus', showCustomerDropdown);
$('cname').addEventListener('input', showCustomerDropdown);
$('cname').addEventListener('keydown', e => {
  if (e.key === 'Escape') $('cl').hidden = true;
});

$('cl').addEventListener('click', event => {
  // delete button inside the dropdown
  const deleteButton = event.target.closest('[data-dk]');
  if (deleteButton) {
    const name = deleteButton.dataset.dk;
    confirmDelete(
      deleteButton,
      'c:' + name,
      () => {
        delete customers[name];
        storage.set('customers', customers);
        showCustomerDropdown();
        showToast('Deleted ' + name);
      },
      showCustomerDropdown
    );
    return;
  }

  // pick a customer: fill name, address, GSTIN, phone
  const pick = event.target.closest('[data-k]');
  if (!pick) return;
  const customer = customers[pick.dataset.k];
  $('cname').value = pick.dataset.k;
  $('cadr').value = customer.adr || '';
  $('cgst').value = customer.gst || '';
  $('cph').value = customer.ph || '';
  syncStateFromGstin();
  $('cl').hidden = true;
  updatePreview();
});

// Close any open dropdown when the user clicks somewhere else
document.addEventListener('pointerdown', event => {
  document.querySelectorAll('.dl').forEach(list => {
    if (!list.parentElement.contains(event.target)) list.hidden = true;
  });
});

$('savec').onclick = () => {
  const name = $('cname').value.trim();
  if (!name) {
    showToast('Enter the customer name first');
    return;
  }
  customers[name] = { adr: $('cadr').value, gst: $('cgst').value, ph: $('cph').value };
  storage.set('customers', customers);
  showToast('Saved ' + name + '. It now shows in the customer list');
};

makeTwoTapButton($('delc'), () => {
  const name = $('cname').value.trim();
  if (customers[name]) {
    delete customers[name];
    storage.set('customers', customers);
    showToast('Deleted ' + name);
  } else {
    showToast('Pick a saved customer first');
  }
});

/* ---------- saved products list (chips under the items) ---------- */

let pendingChipDelete = null;

$('plist').onclick = event => {
  // add the product to the bill
  const addButton = event.target.closest('[data-pa]');
  if (addButton) {
    addProductToBill(productsOfCompany()[Number(addButton.dataset.pa)]);
    return;
  }

  // delete the product (two taps)
  const deleteButton = event.target.closest('[data-pd]');
  if (!deleteButton) return;
  const index = Number(deleteButton.dataset.pd);

  if (pendingChipDelete === index) {
    const product = productsOfCompany()[index];
    savedProducts = savedProducts.filter(p => p !== product);
    storage.set('products', savedProducts);
    pendingChipDelete = null;
    renderProductChips();
    showToast('Product removed');
  } else {
    pendingChipDelete = index;
    deleteButton.textContent = 'Delete?';
    setTimeout(() => {
      if (pendingChipDelete === index) {
        pendingChipDelete = null;
        renderProductChips();
      }
    }, 3000);
  }
};

/* ---------- add item, new bill ---------- */

$('add').onclick = () => {
  addItemRow();
  renumberRows();
  updatePreview();
};

// "New bill": saves the current bill, clears the form, next serial number
makeTwoTapButton($('next'), () => {
  saveBill(true);
  currentBillId = null;

  const highestSaved = Math.max(
    0,
    ...savedBills.filter(b => (b.cid || '') === company.id).map(b => parseInt(b.sno) || 0)
  );
  $('sno').value = Math.max(parseInt($('sno').value) || 0, highestSaved) + 1;

  $('rows').innerHTML = '';
  for (let i = 0; i < BLANK_ROWS_AT_START; i++) addItemRow();

  ['cname', 'cadr', 'cgst', ...EXTRA_FIELDS.map(f => f[0])].forEach(id => { $(id).value = ''; });
  selectDefaultState();
  $('incl').checked = false;

  renumberRows();
  updatePreview();
  scrollTo(0, 0);
});

/* ---------- custom units (Dozen, Box, Packet ...) ---------- */

// Updates the unit dropdowns in all rows and the "Your units" chips
function refreshUnitLists() {
  document.querySelectorAll('#rows .row').forEach(row => {
    const unitSelect = row.querySelector('.u');
    const priceUnitSelect = row.querySelector('.pu');
    const chosenUnit = unitSelect.value;
    const chosenPriceUnit = priceUnitSelect.value;
    unitSelect.innerHTML = unitOptions(chosenUnit);
    priceUnitSelect.innerHTML = priceUnitOptions(chosenPriceUnit);
  });

  $('chips').innerHTML = customUnits.length
    ? 'Your units (tap to remove): ' +
      customUnits.map(u => `<button class="chip" data-u="${escapeHtml(u)}">${escapeHtml(u)} ×</button>`).join('')
    : '';

  updatePreview();
}

$('addu').onclick = () => {
  const unit = $('nu').value.trim();
  if (!unit) return;
  if (allUnits().some(u => u.toLowerCase() === unit.toLowerCase())) {
    showToast('That unit already exists');
    return;
  }
  customUnits.push(unit);
  storage.set('units', customUnits);
  $('nu').value = '';
  refreshUnitLists();
  showToast('Added unit ' + unit);
};

$('chips').onclick = event => {
  const chip = event.target.closest('[data-u]');
  if (!chip) return;
  customUnits = customUnits.filter(u => u !== chip.dataset.u);
  storage.set('units', customUnits);
  refreshUnitLists();
};


/* =====================================================================
   15. START-UP (runs once when the page opens)
   ===================================================================== */

removeExpiredBills();
storage.set('bills', savedBills);

fillCompanyDropdown();
$('sno').value = serialFor(company);
selectDefaultState();
$('date').value = todayISO();

// empty item rows
for (let i = 0; i < BLANK_ROWS_AT_START; i++) addItemRow();
renumberRows();

renderSavedBills();
renderProductChips();
refreshUnitLists();   // also draws the first preview

// First visit: ask for the company details straight away
if (!company.id) {
  openCompanyForm(null);
  showToast('Add your company details to begin');
}