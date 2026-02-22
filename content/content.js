(function () {
  'use strict';

  let config = {
    enabled: true,
    urlPatterns: [],
    fieldNames: [],
    repairTruncatedJson: false,
  };

  let debounceTimer = null;

  function loadConfig() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(
        { enabled: true, urlPatterns: [], fieldNames: [], repairTruncatedJson: false },
        (result) => {
          config = result;
          resolve(config);
        }
      );
    });
  }

  function matchesUrl() {
    if (config.urlPatterns.length === 0) return false;
    const urls = [window.location.href];
    try {
      if (window.top !== window) {
        urls.push(window.top.location.href);
      }
    } catch (e) {
      // Cross-origin iframe on a Kibana domain — assume it matches
      return true;
    }
    return urls.some((url) =>
      config.urlPatterns.some((pattern) => url.includes(pattern))
    );
  }

  // --- JSON Tree Rendering (Collapsible) ---

  function createValueSpan(value) {
    const span = document.createElement('span');
    if (value === null) {
      span.className = 'json-null';
      span.textContent = 'null';
    } else if (typeof value === 'string') {
      span.className = 'json-string';
      span.textContent = '"' + value + '"';
    } else if (typeof value === 'number') {
      span.className = 'json-number';
      span.textContent = String(value);
    } else if (typeof value === 'boolean') {
      span.className = 'json-boolean';
      span.textContent = String(value);
    }
    return span;
  }

  function appendKeySpan(parent, key) {
    const keySpan = document.createElement('span');
    keySpan.className = 'json-key';
    keySpan.textContent = '"' + key + '"';
    parent.appendChild(keySpan);
    parent.appendChild(document.createTextNode(': '));
  }

  function renderJsonTree(value, depth) {
    const root = document.createElement('div');
    root.className = 'json-tree-root';
    buildNode(root, null, value, depth, false);
    return root;
  }

  function buildNode(container, key, value, depth, addComma) {
    const commaStr = addComma ? ',' : '';

    // Primitive values (including null)
    if (value === null || typeof value !== 'object') {
      const line = document.createElement('div');
      line.className = 'json-line';
      if (key !== null) appendKeySpan(line, key);
      line.appendChild(createValueSpan(value));
      if (commaStr) line.appendChild(document.createTextNode(commaStr));
      container.appendChild(line);
      return;
    }

    const isArray = Array.isArray(value);
    const entries = isArray
      ? value.map(function (v, i) { return [i, v]; })
      : Object.entries(value);
    const count = entries.length;
    const openChar = isArray ? '[' : '{';
    const closeChar = isArray ? ']' : '}';
    const braceClass = isArray ? 'json-bracket' : 'json-brace';

    // Empty object/array
    if (count === 0) {
      const line = document.createElement('div');
      line.className = 'json-line';
      if (key !== null) appendKeySpan(line, key);
      const span = document.createElement('span');
      span.className = braceClass;
      span.textContent = openChar + closeChar + commaStr;
      line.appendChild(span);
      container.appendChild(line);
      return;
    }

    const expanded = depth < 2;
    const entry = document.createElement('div');
    entry.className = 'json-entry';

    // Opening line: [key: ] toggle open_brace [placeholder close_brace]
    const openLine = document.createElement('div');
    openLine.className = 'json-line';
    if (key !== null) appendKeySpan(openLine, key);

    const toggle = document.createElement('span');
    toggle.className = 'json-toggle';
    toggle.textContent = expanded ? '▼ ' : '▶ ';
    openLine.appendChild(toggle);

    const openBrace = document.createElement('span');
    openBrace.className = braceClass;
    openBrace.textContent = openChar;
    openLine.appendChild(openBrace);

    // Collapsed placeholder: shown when collapsed
    const placeholder = document.createElement('span');
    placeholder.className = 'json-collapsed-placeholder';
    placeholder.textContent = isArray
      ? '...' + count + ' items'
      : '...' + count + ' keys';
    placeholder.style.display = expanded ? 'none' : 'inline';
    openLine.appendChild(placeholder);

    // Collapsed close brace: shown when collapsed (inline)
    const closedBrace = document.createElement('span');
    closedBrace.className = braceClass;
    closedBrace.textContent = closeChar + commaStr;
    closedBrace.style.display = expanded ? 'none' : 'inline';
    openLine.appendChild(closedBrace);

    entry.appendChild(openLine);

    // Children content
    const content = document.createElement('div');
    content.className = 'json-collapsible-content';
    content.style.paddingLeft = '16px';
    content.style.display = expanded ? 'block' : 'none';

    entries.forEach(function (pair, i) {
      var k = pair[0];
      var v = pair[1];
      buildNode(content, isArray ? null : k, v, depth + 1, i < count - 1);
    });

    entry.appendChild(content);

    // Closing line: shown when expanded
    const closeLine = document.createElement('div');
    closeLine.className = 'json-line';
    const closeSpan = document.createElement('span');
    closeSpan.className = braceClass;
    closeSpan.textContent = closeChar + commaStr;
    closeLine.appendChild(closeSpan);
    closeLine.style.display = expanded ? 'block' : 'none';
    entry.appendChild(closeLine);

    // Toggle click handler
    toggle.addEventListener('click', function (e) {
      e.stopPropagation();
      var isExp = content.style.display !== 'none';
      content.style.display = isExp ? 'none' : 'block';
      closeLine.style.display = isExp ? 'none' : 'block';
      placeholder.style.display = isExp ? 'inline' : 'none';
      closedBrace.style.display = isExp ? 'inline' : 'none';
      toggle.textContent = isExp ? '▶ ' : '▼ ';
    });

    container.appendChild(entry);
  }

  // --- JSON Parsing ---

  function tryParseJson(text) {
    const trimmed = text.trim();
    if (
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))
    ) {
      try {
        return JSON.parse(trimmed);
      } catch (e) {
        return null;
      }
    }
    return null;
  }

  function tryRepairJson(text) {
    if (!text.startsWith('{') && !text.startsWith('[')) return null;

    // Strip trailing ellipsis markers added by Kibana truncation
    let cleaned = text.replace(/\.{2,}$|\u2026$/g, '');

    // If truncated mid-string, close the dangling quote
    let inString = false;
    let escape = false;
    for (let i = 0; i < cleaned.length; i++) {
      const c = cleaned[i];
      if (escape) { escape = false; continue; }
      if (c === '\\') { escape = true; continue; }
      if (c === '"') inString = !inString;
    }
    if (inString) {
      cleaned += '"';
    }

    let lastValidIndex = -1;
    inString = false;
    escape = false;
    let depth = 0;

    for (let i = 0; i < cleaned.length; i++) {
      const c = cleaned[i];
      if (escape) { escape = false; continue; }
      switch (c) {
        case '\\': escape = true; break;
        case '"': inString = !inString; break;
        case '{': if (!inString) depth++; break;
        case '}': if (!inString) depth--; break;
        case '[': if (!inString) depth++; break;
        case ']': if (!inString) depth--; break;
        case ',': if (!inString && depth > 0) lastValidIndex = i; break;
      }
      if (!inString && (c === '{' || c === '[')) {
        lastValidIndex = i;
      }
    }

    let trimmed;
    if (lastValidIndex > 0) {
      trimmed = cleaned.substring(0, lastValidIndex).replace(/[, ]+$/, '');
    } else {
      trimmed = cleaned;
    }

    // Strip trailing incomplete key-value pairs (e.g. "key":)
    trimmed = trimmed.replace(/,?\s*"[^"]*"\s*:\s*$/, '');

    // Track nesting order to close brackets in correct reverse order
    const stack = [];
    inString = false;
    escape = false;
    for (const c of trimmed) {
      if (escape) { escape = false; continue; }
      switch (c) {
        case '\\': escape = true; break;
        case '"': inString = !inString; break;
        case '{': if (!inString) stack.push('}'); break;
        case '}': if (!inString) stack.pop(); break;
        case '[': if (!inString) stack.push(']'); break;
        case ']': if (!inString) stack.pop(); break;
      }
    }

    const repaired = trimmed + stack.reverse().join('');
    try {
      return JSON.parse(repaired);
    } catch (e) {
      return null;
    }
  }

  // --- UI Components ---

  function showCopyToast(message) {
    let toast = document.getElementById('kibana-beautified-copy-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'kibana-beautified-copy-toast';
      toast.className = 'kibana-beautified-copy-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = message || 'JSON copied!';
    toast.classList.remove('show');
    void toast.offsetWidth;
    toast.classList.add('show');
    setTimeout(function () { toast.classList.remove('show'); }, 1500);
  }

  function createCopyButton(json) {
    const jsonStr = JSON.stringify(json, null, 2);
    const btn = document.createElement('button');
    btn.className = 'kibana-beautified-copy-btn';
    btn.textContent = 'Copy';
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      navigator.clipboard.writeText(jsonStr).then(function () {
        showCopyToast('JSON copied!');
      });
    });
    return btn;
  }


  // --- Beautify Logic ---

  function beautifyElement(element) {
    if (element.getAttribute('data-kibana-beautified')) return;

    const text = element.textContent;
    if (!text) return;

    let parsed = tryParseJson(text);
    let repaired = false;

    if (!parsed && config.repairTruncatedJson) {
      parsed = tryRepairJson(text.trim());
      if (parsed) repaired = true;
    }

    if (!parsed) return;

    // Skip empty objects/arrays — nothing useful to beautify
    if (typeof parsed === 'object' && Object.keys(parsed).length === 0) return;

    element.setAttribute('data-kibana-beautified', 'true');

    const pre = document.createElement('pre');
    pre.className = 'kibana-beautified-json';

    const treeEl = renderJsonTree(parsed, 0);
    pre.appendChild(treeEl);

    // Wrap with hover container + buttons
    const wrap = document.createElement('div');
    wrap.className = 'kibana-beautified-json-wrap';

    const btnGroup = document.createElement('div');
    btnGroup.className = 'kibana-beautified-btn-group';
    btnGroup.appendChild(createCopyButton(parsed));
    wrap.appendChild(btnGroup);

    element.textContent = '';

    if (repaired) {
      const badge = document.createElement('span');
      badge.className = 'kibana-beautified-repaired-badge';
      badge.textContent = 'Truncated JSON \u2014 Repaired';
      wrap.appendChild(badge);
      pre.classList.add('kibana-beautified-repaired');
    }

    wrap.appendChild(pre);
    element.appendChild(wrap);
  }

  // --- Cell / Field Scanning ---

  // Build a set of column IDs that match configured field names
  function getMatchingColumnIds() {
    const matchingIds = new Set();

    // Strategy 1: Check header cells for matching field names
    const headers = document.querySelectorAll(
      '[data-gridcell-column-id], [role="columnheader"]'
    );
    headers.forEach(function (header) {
      const columnId = header.getAttribute('data-gridcell-column-id') || '';
      const headerText = header.textContent.trim();

      for (const fieldName of config.fieldNames) {
        if (
          columnId === fieldName ||
          columnId.endsWith(fieldName) ||
          headerText === fieldName ||
          headerText.includes(fieldName)
        ) {
          if (columnId) {
            matchingIds.add(columnId);
          }
        }
      }
    });

    // Strategy 2: Add exact field names (in case headers haven't loaded yet)
    config.fieldNames.forEach(function (name) { matchingIds.add(name); });

    return matchingIds;
  }

  function beautifyCellContent(cell) {
    // Try various content wrapper selectors used across Kibana versions
    const contentSelectors = [
      '.euiDataGridRowCell__content',
      '.unifiedDataTable__cellValue',
      '.euiDataGridRowCell__truncate',
      '.dscDiscoverGrid__cellValue',
      '.kbnDocViewer__value',
      '.truncate-by-height',
      '[class*="cellValue"]',
      '[class*="cellContent"]',
    ];

    let contentEl = null;
    for (const selector of contentSelectors) {
      contentEl = cell.querySelector(selector);
      if (contentEl) break;
    }

    // If no wrapper found, try the deepest text-containing element
    if (!contentEl) {
      const candidates = cell.querySelectorAll('span, div');
      for (const el of candidates) {
        const text = el.textContent.trim();
        if (text && (text.startsWith('{') || text.startsWith('['))) {
          // Prefer the deepest element that contains the full JSON
          if (!el.querySelector('span, div') || el.children.length === 0) {
            contentEl = el;
            break;
          }
        }
      }
    }

    if (!contentEl) {
      contentEl = cell;
    }

    beautifyElement(contentEl);
  }

  function findAndBeautify() {
    if (!config.enabled || !matchesUrl()) return;
    if (config.fieldNames.length === 0) return;

    // Feature 2: "all" keyword → auto-detect all JSON cells
    var autoDetectAll = config.fieldNames.some(function (name) {
      return name.toLowerCase() === 'all';
    });

    if (autoDetectAll) {
      // Scan all grid cells
      document.querySelectorAll('[role="gridcell"]').forEach(function (cell) {
        beautifyCellContent(cell);
      });
      // Scan all HTML table cells
      document.querySelectorAll('table td').forEach(function (cell) {
        beautifyCellContent(cell);
      });
      // Scan document viewer values
      document.querySelectorAll('.kbnDocViewer__value').forEach(function (el) {
        beautifyElement(el);
      });
      return;
    }

    const matchingColumnIds = getMatchingColumnIds();

    // Strategy 1: Find cells by data-gridcell-column-id (EuiDataGrid / UnifiedDataTable)
    matchingColumnIds.forEach(function (columnId) {
      const cells = document.querySelectorAll(
        '[data-gridcell-column-id="' + CSS.escape(columnId) + '"]'
      );
      cells.forEach(function (cell) {
        // Skip header cells
        if (cell.getAttribute('role') === 'columnheader') return;
        beautifyCellContent(cell);
      });
    });

    // Strategy 2: Document Viewer / Flyout panel
    for (const fieldName of config.fieldNames) {
      const docViewerCells = document.querySelectorAll(
        '[data-test-subj*="tableDocViewRow-' + fieldName + '"]'
      );
      docViewerCells.forEach(function (row) {
        const valueEl = row.querySelector(
          '.kbnDocViewer__value, [class*="value"]'
        );
        if (valueEl) {
          beautifyElement(valueEl);
        } else {
          beautifyElement(row);
        }
      });
    }

    // Strategy 3: Scan all grid cells and match by column position
    scanGridByColumnPosition();

    // Strategy 4: HTML <table> based views (older Kibana / classic table)
    scanHtmlTables();
  }

  function scanGridByColumnPosition() {
    // Find column indices that match field names from header row
    const headerRow = document.querySelector(
      '[role="row"]:has([role="columnheader"]), .euiDataGridHeader'
    );
    if (!headerRow) return;

    const headerCells = headerRow.querySelectorAll(
      '[role="columnheader"], .euiDataGridHeaderCell'
    );
    const targetIndices = new Set();

    headerCells.forEach(function (header, index) {
      const text = header.textContent.trim();
      for (const fieldName of config.fieldNames) {
        if (text === fieldName || text.includes(fieldName)) {
          targetIndices.add(index);
        }
      }
    });

    if (targetIndices.size === 0) return;

    // Find all data rows and beautify cells at matching indices
    const dataRows = document.querySelectorAll(
      '[role="row"]:not(:has([role="columnheader"])), .euiDataGridRow'
    );
    dataRows.forEach(function (row) {
      const cells = row.querySelectorAll(
        '[role="gridcell"], .euiDataGridRowCell'
      );
      targetIndices.forEach(function (idx) {
        if (cells[idx]) {
          beautifyCellContent(cells[idx]);
        }
      });
    });
  }

  function scanHtmlTables() {
    const tables = document.querySelectorAll('table');
    tables.forEach(function (table) {
      const headerRow = table.querySelector('thead tr, tr:first-child');
      if (!headerRow) return;

      const headers = headerRow.querySelectorAll('th, td');
      const targetIndices = new Set();

      headers.forEach(function (header, index) {
        const text = header.textContent.trim();
        for (const fieldName of config.fieldNames) {
          if (text === fieldName || text.includes(fieldName)) {
            targetIndices.add(index);
          }
        }
      });

      if (targetIndices.size === 0) return;

      const dataRows = table.querySelectorAll('tbody tr');
      if (dataRows.length === 0) {
        // No tbody — skip the header row
        const allRows = table.querySelectorAll('tr');
        allRows.forEach(function (row, rowIdx) {
          if (rowIdx === 0) return;
          const cells = row.querySelectorAll('td');
          targetIndices.forEach(function (idx) {
            if (cells[idx]) {
              beautifyCellContent(cells[idx]);
            }
          });
        });
      } else {
        dataRows.forEach(function (row) {
          const cells = row.querySelectorAll('td');
          targetIndices.forEach(function (idx) {
            if (cells[idx]) {
              beautifyCellContent(cells[idx]);
            }
          });
        });
      }
    });
  }

  // --- Initialization ---

  function debouncedFindAndBeautify() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(findAndBeautify, 100);
  }

  function init() {
    loadConfig().then(function () {
      if (!config.enabled || !matchesUrl()) return;

      findAndBeautify();

      const observer = new MutationObserver(function () {
        debouncedFindAndBeautify();
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
      });
    });

    chrome.storage.onChanged.addListener(function (changes) {
      if (changes.enabled) config.enabled = changes.enabled.newValue;
      if (changes.urlPatterns)
        config.urlPatterns = changes.urlPatterns.newValue;
      if (changes.fieldNames) config.fieldNames = changes.fieldNames.newValue;
      if (changes.repairTruncatedJson)
        config.repairTruncatedJson = changes.repairTruncatedJson.newValue;

      // Re-process: remove existing beautification and re-apply
      document.querySelectorAll('[data-kibana-beautified]').forEach(function (el) {
        el.removeAttribute('data-kibana-beautified');
      });
      findAndBeautify();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
