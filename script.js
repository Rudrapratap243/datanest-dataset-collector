const $ = (id) => document.getElementById(id);
const fileInput = $('fileInput');
let datasets = [];
let activeDatasetId = null;
let toastTimer;

function notify(message) {
  const toast = $('toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
}
function formatBytes(bytes) {
  if (!bytes) return '0 KB';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
function parseCSV(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (c === ',' && !quoted) {
      row.push(cell); cell = '';
    } else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some(v => v.trim() !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some(v => v.trim() !== '')) rows.push(row);
  return rows;
}
function parseFileContent(file, text) {
  const extension = file.name.toLowerCase().split('.').pop();
  if (extension === 'json') {
    const parsed = JSON.parse(text);
    const data = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.data) ? parsed.data : [parsed]);
    if (!data.length) return { headers: [], rows: [], type: 'json' };
    if (typeof data[0] !== 'object' || data[0] === null) return { headers: ['value'], rows: data.map(v => [String(v)]), type: 'json' };
    const headers = [...new Set(data.flatMap(item => Object.keys(item)))];
    return { headers, rows: data.map(item => headers.map(h => item[h] == null ? '' : String(item[h]))), type: 'json' };
  }
  const raw = parseCSV(text);
  if (!raw.length) return { headers: [], rows: [], type: 'csv' };
  const headers = raw[0].map((h, i) => h.trim() || `Column ${i + 1}`);
  return { headers, rows: raw.slice(1), type: 'csv' };
}
function openPicker() { fileInput.click(); }
['uploadTop', 'emptyUpload', 'helpUpload'].forEach(id => $(id).addEventListener('click', openPicker));
fileInput.addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  const ext = file.name.toLowerCase().split('.').pop();
  if (!['csv', 'json'].includes(ext)) { notify('Please choose a CSV or JSON file.'); fileInput.value = ''; return; }
  try {
    const text = await file.text();
    const parsed = parseFileContent(file, text);
    if (!parsed.headers.length) { notify('This file does not contain any data.'); return; }
    const dataset = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name: file.name, type: parsed.type, headers: parsed.headers, rows: parsed.rows,
      size: file.size, createdAt: new Date(), rawText: text
    };
    datasets.unshift(dataset);
    activeDatasetId = dataset.id;
    render();
    showPreview(dataset);
    notify(`Added ${file.name} to your workspace.`);
  } catch (error) {
    notify('Could not read this file. Check its format and try again.');
  } finally { fileInput.value = ''; }
});
function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
function render() {
  const query = $('searchInput').value.toLowerCase().trim();
  const filter = $('typeFilter').value;
  const visible = datasets.filter(d => d.name.toLowerCase().includes(query) && (filter === 'all' || d.type === filter));
  $('totalDatasets').textContent = datasets.length;
  $('totalRecords').textContent = datasets.reduce((sum, d) => sum + d.rows.length, 0).toLocaleString();
  $('totalColumns').textContent = new Set(datasets.flatMap(d => d.headers)).size.toLocaleString();
  $('storageUsed').textContent = formatBytes(datasets.reduce((sum, d) => sum + d.size, 0));
  $('navCount').textContent = datasets.length;
  const list = $('datasetList');
  if (!visible.length) {
    list.innerHTML = datasets.length ? '<div class="empty-state"><div class="empty-illustration">⌕</div><h3>No matching datasets</h3><p>Try a different search or file type filter.</p></div>' : '<div class="empty-state"><div class="empty-illustration">⇧</div><h3>Your workspace is waiting</h3><p>Upload a CSV file or try a sample dataset to see your data come to life.</p><div class="empty-actions"><button class="primary-btn" id="emptyUpload">Upload a dataset</button><button class="secondary-btn" id="sampleBtn">Try sample data</button></div></div>';
    $('emptyUpload')?.addEventListener('click', openPicker);
    $('sampleBtn')?.addEventListener('click', addSample);
    return;
  }
  list.innerHTML = visible.map(d => `<div class="dataset-row">
    <div class="file-icon ${d.type === 'json' ? 'json' : ''}">${d.type.toUpperCase()}</div>
    <div class="dataset-info"><strong title="${escapeHTML(d.name)}">${escapeHTML(d.name)}</strong><small>${d.rows.length.toLocaleString()} records · ${d.headers.length} columns · ${d.createdAt.toLocaleDateString()}</small></div>
    <span class="dataset-size">${formatBytes(d.size)}</span>
    <div class="row-actions"><button data-action="preview" data-id="${d.id}">Preview</button><button data-action="delete" data-id="${d.id}" aria-label="Delete ${escapeHTML(d.name)}">×</button></div>
  </div>`).join('');
}
$('datasetList').addEventListener('click', e => {
  const button = e.target.closest('button[data-action]');
  if (!button) return;
  const d = datasets.find(item => item.id === button.dataset.id);
  if (button.dataset.action === 'preview' && d) { activeDatasetId = d.id; showPreview(d); }
  if (button.dataset.action === 'delete' && d) {
    datasets = datasets.filter(item => item.id !== d.id);
    if (activeDatasetId === d.id) { activeDatasetId = null; $('previewPanel').hidden = true; $('analyticsPanel').hidden = true; }
    render(); notify('Dataset removed from this browser workspace.');
  }
});
function showPreview(d) {
  $('previewPanel').hidden = false;
  $('analyticsPanel').hidden = true;
  $('previewTitle').textContent = d.name;
  $('previewMeta').textContent = `${d.rows.length.toLocaleString()} records · ${d.headers.length} columns · ${d.type.toUpperCase()} file`;
  const table = $('previewTable');
  const head = `<thead><tr>${d.headers.map(h => `<th>${escapeHTML(h)}</th>`).join('')}</tr></thead>`;
  const bodyRows = d.rows.slice(0, 10);
  const body = `<tbody>${bodyRows.map(row => `<tr>${d.headers.map((_, i) => `<td>${escapeHTML(row[i] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody>`;
  table.innerHTML = head + body;
  $('previewFooter').textContent = `Showing ${Math.min(10, d.rows.length)} of ${d.rows.length.toLocaleString()} records.`;
  $('previewPanel').scrollIntoView({behavior:'smooth', block:'start'});
}
$('closePreview').addEventListener('click', () => $('previewPanel').hidden = true);
$('downloadBtn').addEventListener('click', () => {
  const d = datasets.find(item => item.id === activeDatasetId);
  if (!d) return notify('Choose a dataset to download.');
  const csvCell = value => {
    const s = String(value ?? '');
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [d.headers, ...d.rows].map(row => row.map(csvCell).join(',')).join('\r\n');
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `${d.name.replace(/\.[^.]+$/, '')}-export.csv`; a.click();
  URL.revokeObjectURL(url);
  notify('Dataset export started.');
});
function addSample() {
  const headers = ['Date','Product','Category','Units Sold','Revenue'];
  const rows = [
    ['2026-10-01','Notebook','Stationery','42','8400'],
    ['2026-10-02','Wireless Mouse','Electronics','18','13500'],
    ['2026-10-03','Water Bottle','Lifestyle','25','6250'],
    ['2026-10-04','Notebook','Stationery','31','6200'],
    ['2026-10-05','USB-C Hub','Electronics','12','10800'],
    ['2026-10-06','Water Bottle','Lifestyle','29','7250'],
    ['2026-10-07','Wireless Mouse','Electronics','21','15750'],
    ['2026-10-08','Notebook','Stationery','37','7400']
  ];
  const rawText = [headers, ...rows].map(r => r.join(',')).join('\n');
  const d = {id:`sample-${Date.now()}`,name:'sample_sales_dataset.csv',type:'csv',headers,rows,size:new Blob([rawText]).size,createdAt:new Date(),rawText};
  datasets.unshift(d); activeDatasetId = d.id; render(); showPreview(d); notify('Sample sales dataset added.');
}
$('sampleBtn')?.addEventListener('click', addSample);
$('searchInput').addEventListener('input', render);
$('typeFilter').addEventListener('change', render);
$('viewAll').addEventListener('click', () => { $('searchInput').focus(); $('datasetList').scrollIntoView({behavior:'smooth',block:'center'}); });
$('navDatasets').addEventListener('click', () => $('datasetList').scrollIntoView({behavior:'smooth',block:'center'}));
$('navAnalytics').addEventListener('click', showAnalytics);
function showAnalytics() {
  const d = datasets.find(item => item.id === activeDatasetId) || datasets[0];
  if (!d) { notify('Upload or add a sample dataset to view insights.'); return; }
  activeDatasetId = d.id;
  $('analyticsPanel').hidden = false;
  $('previewPanel').hidden = true;
  const missing = d.rows.reduce((sum, row) => sum + d.headers.reduce((n, _, i) => n + (String(row[i] ?? '').trim() === '' ? 1 : 0), 0), 0);
  const numeric = d.headers.map((header, i) => ({header, values:d.rows.map(row => Number(row[i])).filter(v => Number.isFinite(v) && String(v).trim() !== '')})).filter(col => col.values.length > 0);
  const numericSummary = numeric.length ? `${numeric.length} numeric field${numeric.length === 1 ? '' : 's'}` : 'No numeric fields detected';
  const cards = [
    ['Records',d.rows.length.toLocaleString(),'Data rows available'],
    ['Columns',d.headers.length.toLocaleString(),'Fields in this dataset'],
    ['Missing cells',missing.toLocaleString(),d.rows.length && d.headers.length ? `${((missing/(d.rows.length*d.headers.length))*100).toFixed(1)}% of all cells` : 'No cells to check'],
    ['Numeric fields',numeric.length.toLocaleString(),numericSummary],
    ['Duplicate rows',countDuplicates(d).toLocaleString(),'Exact row matches'],
    ['File size',formatBytes(d.size),'Original upload size']
  ];
  $('insightsContent').innerHTML = cards.map(c => `<div class="insight"><span>${escapeHTML(c[0])}</span><strong>${escapeHTML(c[1])}</strong><p>${escapeHTML(c[2])}</p></div>`).join('');
  $('analyticsPanel').scrollIntoView({behavior:'smooth',block:'start'});
}
function countDuplicates(d) {
  const seen = new Set(); let duplicates = 0;
  d.rows.forEach(row => { const key = JSON.stringify(row); if (seen.has(key)) duplicates++; else seen.add(key); });
  return duplicates;
}
render();
