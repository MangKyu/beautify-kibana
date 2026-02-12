document.addEventListener('DOMContentLoaded', () => {
  const enableToggle = document.getElementById('enableToggle');
  const urlInput = document.getElementById('urlInput');
  const addUrlBtn = document.getElementById('addUrlBtn');
  const urlList = document.getElementById('urlList');
  const fieldInput = document.getElementById('fieldInput');
  const addFieldBtn = document.getElementById('addFieldBtn');
  const fieldList = document.getElementById('fieldList');
  const repairToggle = document.getElementById('repairToggle');

  let config = { enabled: true, urlPatterns: [], fieldNames: [], repairTruncatedJson: false };

  function loadConfig() {
    chrome.storage.sync.get(
      { enabled: true, urlPatterns: [], fieldNames: [], repairTruncatedJson: false },
      (result) => {
        config = result;
        enableToggle.checked = config.enabled;
        repairToggle.checked = config.repairTruncatedJson;
        renderList(urlList, config.urlPatterns, 'urlPatterns');
        renderList(fieldList, config.fieldNames, 'fieldNames');
      }
    );
  }

  function saveConfig() {
    chrome.storage.sync.set(config);
  }

  function renderList(ul, items, key) {
    ul.innerHTML = '';
    if (items.length === 0) {
      const li = document.createElement('li');
      li.className = 'empty-msg';
      li.textContent = key === 'urlPatterns' ? 'Add a URL pattern' : 'Add a field name';
      ul.appendChild(li);
      return;
    }
    items.forEach((item, index) => {
      const li = document.createElement('li');

      const span = document.createElement('span');
      span.textContent = item;
      span.style.overflow = 'hidden';
      span.style.textOverflow = 'ellipsis';
      span.style.whiteSpace = 'nowrap';

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'delete-btn';
      deleteBtn.textContent = '\u00d7';
      deleteBtn.addEventListener('click', () => {
        config[key].splice(index, 1);
        saveConfig();
        renderList(ul, config[key], key);
      });

      li.appendChild(span);
      li.appendChild(deleteBtn);
      ul.appendChild(li);
    });
  }

  function addItem(input, key, listEl) {
    const value = input.value.trim();
    if (!value) return;
    if (config[key].includes(value)) {
      input.value = '';
      return;
    }
    config[key].push(value);
    saveConfig();
    renderList(listEl, config[key], key);
    input.value = '';
  }

  enableToggle.addEventListener('change', () => {
    config.enabled = enableToggle.checked;
    saveConfig();
  });

  repairToggle.addEventListener('change', () => {
    config.repairTruncatedJson = repairToggle.checked;
    saveConfig();
  });

  addUrlBtn.addEventListener('click', () => addItem(urlInput, 'urlPatterns', urlList));
  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addItem(urlInput, 'urlPatterns', urlList);
  });

  addFieldBtn.addEventListener('click', () => addItem(fieldInput, 'fieldNames', fieldList));
  fieldInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addItem(fieldInput, 'fieldNames', fieldList);
  });

  loadConfig();
});
