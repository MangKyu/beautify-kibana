# Kibana Beautify

A Chrome extension that automatically formats and syntax-highlights JSON fields on the Kibana Discover page.

## Features

- **JSON Pretty Print** — Automatically converts single-line JSON fields into indented, readable format
- **Syntax Highlighting** — Color-coded keys, strings, numbers, booleans, and null values
- **Truncated JSON Repair** — Optionally repairs incomplete JSON that Kibana has truncated
- **URL Pattern Matching** — Configure specific Kibana URLs where the extension should be active
- **Field Name Targeting** — Specify exactly which JSON fields to beautify
- **Dark Mode Support** — Detects Kibana dark theme and system dark mode automatically
- **Live Updates** — Settings take effect immediately; DOM mutations are detected in real time

## Installation

1. Clone or download this repository.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode** in the top-right corner.
4. Click **Load unpacked**.
5. Select the project folder.

## Usage

1. Click the extension icon to open the popup.
2. Add a Kibana URL pattern under **URL Patterns** (e.g., `kibana.example.com`).
3. Add the field names you want to beautify under **Field Names** (e.g., `message`, `status.paramsstring`).
4. Navigate to a Kibana Discover page — matching JSON fields will be formatted automatically.

### Truncated JSON Repair

When Kibana truncates long JSON values, enable the **Repair truncated JSON** toggle to automatically reconstruct incomplete JSON. Repaired fields are marked with a "Truncated JSON — Repaired" badge.

## Project Structure

```
kibana-beautify/
├── manifest.json          # Chrome Extension Manifest V3
├── content/
│   ├── content.js         # JSON detection and beautification logic
│   └── content.css        # Syntax highlighting styles (light/dark theme)
├── popup/
│   ├── popup.html         # Settings popup UI
│   ├── popup.js           # Popup logic (configuration management)
│   └── popup.css          # Popup styles
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## Compatibility

- Chrome Manifest V3
- Supports multiple Kibana DOM structures (EuiDataGrid, UnifiedDataTable, Document Viewer, HTML Table)
