/*
 * Filevine structure inventory — paste into the browser console.
 *
 * Zero permissions needed. If you can see it on screen, this can capture it.
 * Run it once per section: open the section, paste, press Enter. The result is
 * copied to your clipboard automatically — paste it into a text file in
 * /imports/ and move to the next section.
 *
 * Captures NO client data by default: field VALUES are replaced with a type
 * hint (e.g. "<date>", "<text:42chars>") rather than their contents. We need
 * the shape of the sections, not anyone's medical history. Set
 * INCLUDE_VALUES = true only if you specifically want a populated example.
 *
 * HOW TO OPEN THE CONSOLE
 *   Chrome/Edge: F12 (or Cmd+Option+I on Mac) -> "Console" tab
 *   If it warns you about pasting, type "allow pasting" and press Enter first.
 */

(() => {
  const INCLUDE_VALUES = false;

  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();

  // ---- The left section rail: whatever the app is using for nav ----
  const railItems = [...document.querySelectorAll('nav a, nav button, [role="navigation"] a, aside a, aside button')]
    .map((el) => clean(el.innerText))
    .filter((t) => t && t.length < 40);

  // ---- Form controls in the main content area ----
  const scope =
    document.querySelector('main, [role="main"], .content, #content') || document.body;

  const describe = (el) => {
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase();

    if (tag === 'select') {
      return {
        control: 'select',
        options: [...el.options].map((o) => clean(o.text)).filter(Boolean),
      };
    }
    if (type === 'checkbox' || type === 'radio') return { control: type };
    if (tag === 'textarea') return { control: 'textarea' };

    const v = el.value || '';
    let hint = `<${type || 'text'}>`;
    if (INCLUDE_VALUES) hint = v;
    else if (v) hint = `<${type || 'text'}:${v.length}chars>`;
    return { control: type || 'text', sample: hint };
  };

  // Best-effort label resolution, in decreasing order of reliability.
  //
  // Step 4 is the one that actually earns its keep: most real apps (Filevine
  // and ours both) render the label as a SIBLING div rather than a <label for>,
  // so a parent-text-node walk alone returns "(unlabeled)" for nearly
  // everything. Verified against our own form -- 21 fields went from 2 labeled
  // to 21 labeled once sibling lookup was added.
  const looksLikeLabel = (t) => t && t.length > 0 && t.length < 60;

  const labelFor = (el) => {
    // 1. Proper association
    if (el.id) {
      const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (l) return clean(l.innerText);
    }

    // 2. Wrapping <label>
    const wrapping = el.closest('label');
    if (wrapping) {
      const t = clean(wrapping.innerText);
      if (looksLikeLabel(t)) return t;
    }

    // 3. ARIA / placeholder
    const aria = el.getAttribute('aria-label') || el.getAttribute('placeholder');
    if (looksLikeLabel(clean(aria))) return clean(aria);

    // 4. Preceding sibling element, walking up a few levels.
    let n = el;
    for (let up = 0; up < 4 && n; up++, n = n.parentElement) {
      let sib = n.previousElementSibling;
      let across = 0;
      while (sib && across < 3) {
        const t = clean(sib.innerText);
        if (looksLikeLabel(t)) return t;
        sib = sib.previousElementSibling;
        across++;
      }
    }

    // 5. First element child of an ancestor, when it isn't the control itself.
    n = el.parentElement;
    for (let up = 0; up < 3 && n; up++, n = n.parentElement) {
      const first = n.firstElementChild;
      if (first && first !== el && !first.contains(el)) {
        const t = clean(first.innerText);
        if (looksLikeLabel(t)) return t;
      }
    }

    // 6. Bare text nodes on an ancestor.
    n = el.parentElement;
    for (let up = 0; up < 4 && n; up++, n = n.parentElement) {
      const own = [...n.childNodes]
        .filter((c) => c.nodeType === 3)
        .map((c) => clean(c.textContent))
        .filter(looksLikeLabel)
        .join(' ');
      if (own) return own;
    }

    return '(unlabeled)';
  };

  const fields = [...scope.querySelectorAll('input, select, textarea')]
    .filter((el) => el.type !== 'hidden' && el.offsetParent !== null)
    .map((el) => ({ label: labelFor(el), ...describe(el) }));

  // ---- Repeating collections: tables are how most sections show rows ----
  const tables = [...scope.querySelectorAll('table')].map((t) => ({
    headers: [...t.querySelectorAll('thead th, tr:first-child th')]
      .map((th) => clean(th.innerText))
      .filter(Boolean),
    rowCount: t.querySelectorAll('tbody tr').length,
  })).filter((t) => t.headers.length);

  // ---- Column headers rendered as divs rather than tables ----
  const headingTexts = [...scope.querySelectorAll('h1,h2,h3,h4,h5,legend')]
    .map((h) => clean(h.innerText))
    .filter((t) => t && t.length < 80);

  const out = {
    capturedAt: new Date().toISOString(),
    url: location.href,
    pageTitle: document.title,
    sectionRail: [...new Set(railItems)],
    headings: [...new Set(headingTexts)],
    fields,
    tables,
    valuesIncluded: INCLUDE_VALUES,
  };

  const json = JSON.stringify(out, null, 2);
  console.log(out);

  if (navigator.clipboard) {
    navigator.clipboard
      .writeText(json)
      .then(() => console.log('%c✓ Copied to clipboard — paste into a file in /imports/', 'color:green;font-weight:bold'))
      .catch(() => console.log('Clipboard blocked. Right-click the object above -> "Copy object".'));
  }
  return `captured ${fields.length} fields, ${tables.length} tables`;
})();
