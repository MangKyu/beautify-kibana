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

  function syntaxHighlight(json) {
    const str = JSON.stringify(json, null, 2);
    return str.replace(
      /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g,
      (match) => {
        let cls = 'json-number';
        if (/^"/.test(match)) {
          if (/:$/.test(match)) {
            cls = 'json-key';
          } else {
            cls = 'json-string';
          }
        } else if (/true|false/.test(match)) {
          cls = 'json-boolean';
        } else if (/null/.test(match)) {
          cls = 'json-null';
        }
        return '<span class="' + cls + '">' + escapeHtml(match) + '</span>';
      }
    );
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(text));
    return div.innerHTML;
  }

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
    const cleaned = text.replace(/\.{2,}$|\u2026$/g, '');

    let lastValidIndex = -1;
    let inString = false;
    let escape = false;
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

    element.setAttribute('data-kibana-beautified', 'true');

    const pre = document.createElement('pre');
    pre.className = 'kibana-beautified-json';
    pre.innerHTML = syntaxHighlight(parsed);

    element.textContent = '';

    if (repaired) {
      const wrapper = document.createElement('div');
      wrapper.className = 'kibana-beautified-wrapper';

      const badge = document.createElement('span');
      badge.className = 'kibana-beautified-repaired-badge';
      badge.textContent = 'Truncated JSON — Repaired';
      wrapper.appendChild(badge);

      pre.classList.add('kibana-beautified-repaired');
      wrapper.appendChild(pre);
      element.appendChild(wrapper);
    } else {
      element.appendChild(pre);
    }
  }

  // Build a set of column IDs that match configured field names
  function getMatchingColumnIds() {
    const matchingIds = new Set();

    // Strategy 1: Check header cells for matching field names
    const headers = document.querySelectorAll(
      '[data-gridcell-column-id], [role="columnheader"]'
    );
    headers.forEach((header) => {
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
    config.fieldNames.forEach((name) => matchingIds.add(name));

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

    const matchingColumnIds = getMatchingColumnIds();

    // Strategy 1: Find cells by data-gridcell-column-id (EuiDataGrid / UnifiedDataTable)
    matchingColumnIds.forEach((columnId) => {
      const cells = document.querySelectorAll(
        '[data-gridcell-column-id="' + CSS.escape(columnId) + '"]'
      );
      cells.forEach((cell) => {
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
      docViewerCells.forEach((row) => {
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

    headerCells.forEach((header, index) => {
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
    dataRows.forEach((row) => {
      const cells = row.querySelectorAll(
        '[role="gridcell"], .euiDataGridRowCell'
      );
      targetIndices.forEach((idx) => {
        if (cells[idx]) {
          beautifyCellContent(cells[idx]);
        }
      });
    });
  }

  function scanHtmlTables() {
    const tables = document.querySelectorAll('table');
    tables.forEach((table) => {
      const headerRow = table.querySelector('thead tr, tr:first-child');
      if (!headerRow) return;

      const headers = headerRow.querySelectorAll('th, td');
      const targetIndices = new Set();

      headers.forEach((header, index) => {
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
        allRows.forEach((row, rowIdx) => {
          if (rowIdx === 0) return;
          const cells = row.querySelectorAll('td');
          targetIndices.forEach((idx) => {
            if (cells[idx]) {
              beautifyCellContent(cells[idx]);
            }
          });
        });
      } else {
        dataRows.forEach((row) => {
          const cells = row.querySelectorAll('td');
          targetIndices.forEach((idx) => {
            if (cells[idx]) {
              beautifyCellContent(cells[idx]);
            }
          });
        });
      }
    });
  }

  function debouncedFindAndBeautify() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(findAndBeautify, 100);
  }

  function init() {
    loadConfig().then(() => {
      if (!config.enabled || !matchesUrl()) return;

      findAndBeautify();

      const observer = new MutationObserver(() => {
        debouncedFindAndBeautify();
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
      });
    });

    chrome.storage.onChanged.addListener((changes) => {
      if (changes.enabled) config.enabled = changes.enabled.newValue;
      if (changes.urlPatterns)
        config.urlPatterns = changes.urlPatterns.newValue;
      if (changes.fieldNames) config.fieldNames = changes.fieldNames.newValue;
      if (changes.repairTruncatedJson)
        config.repairTruncatedJson = changes.repairTruncatedJson.newValue;

      // Re-process: remove existing beautification and re-apply
      document.querySelectorAll('[data-kibana-beautified]').forEach((el) => {
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
