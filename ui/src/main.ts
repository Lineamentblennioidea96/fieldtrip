import './styles/main.css';
import * as monaco from 'monaco-editor';
import * as d3 from 'd3';

import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';

self.MonacoEnvironment = {
  getWorker(_: any, label: string) {
    if (label === 'json') return new jsonWorker();
    return new editorWorker();
  },
};

// ─── Types ───

interface Property {
  id: string;
  name: string;
  type: string;
  description: string;
  schemaPath: string;
  filePath: string;
  schemaType: string;
  parentName: string;
  required: boolean;
  format?: string;
  ref?: string;
  score?: number;
}

interface SchemaInfo { filePath: string; schemaType: string; count: number; }
interface Stats { totalProperties: number; totalFiles: number; schemaTypes: Record<string, number>; }

interface GraphNode extends d3.SimulationNodeDatum {
  id: string;
  label: string;
  nodeType: 'schema' | 'property';
  schemaType?: string;
  filePath?: string;
  propertyName?: string;
  propertyType?: string;
  parentName?: string;
  count?: number;
}

interface GraphLink extends d3.SimulationLinkDatum<GraphNode> {
  linkType: 'belongs-to' | 'shared-name';
}

// ─── Constants ───

const TYPE_COLORS: Record<string, string> = {
  openapi: '#3b82f6', asyncapi: '#8b5cf6', protobuf: '#10b981',
  avro: '#f59e0b', jsonschema: '#6366f1',
};

const TYPE_LABELS: Record<string, string> = {
  openapi: 'OPENAPI', asyncapi: 'ASYNCAPI', protobuf: 'PROTO',
  avro: 'AVRO', jsonschema: 'JSON',
};

const TYPE_BG: Record<string, string> = {
  openapi: 'rgba(59,130,246,0.15)', asyncapi: 'rgba(139,92,246,0.15)',
  protobuf: 'rgba(16,185,129,0.15)', avro: 'rgba(245,158,11,0.15)',
  jsonschema: 'rgba(99,102,241,0.15)',
};

const DATA_TYPE_COLORS: Record<string, string> = {
  string: '#22d3ee', integer: '#a78bfa', int32: '#a78bfa', int64: '#a78bfa',
  number: '#a78bfa', double: '#f472b6', float: '#f472b6',
  boolean: '#fb923c', object: '#94a3b8', array: '#34d399',
};

const FILE_LANGUAGES: Record<string, string> = {
  '.yaml': 'yaml', '.yml': 'yaml', '.json': 'json', '.avsc': 'json', '.proto': 'protobuf',
};

// ─── State ───

let allProperties: Property[] = [];
let filteredProperties: Property[] = [];
let schemas: SchemaInfo[] = [];
let activeSchemaFilters: Set<string> = new Set();
let activeTypeFilter: string | null = null;
let sortField: 'name' | 'schema' | 'type' = 'name';
let sortAsc = true;
let searchQuery = '';
let debounceTimer: ReturnType<typeof setTimeout>;
let activeView: 'table' | 'graph' | 'matrix' = 'table';

// Monaco state
let editorInstance: monaco.editor.IStandaloneCodeEditor | null = null;
let currentDecorations: monaco.editor.IEditorDecorationsCollection | null = null;
let currentFilePath: string | null = null;
let showingDetail = false;

// Graph state
let simulation: d3.Simulation<GraphNode, GraphLink> | null = null;
let graphOnlyShared = true;

// Matrix state
let matrixSortField: 'alpha' | 'count' | 'required' = 'count';
let matrixSortAsc = false;

const app = document.getElementById('app')!;

// ─── Init ───

async function init() {
  const [stats, propsData, schemasData] = await Promise.all([
    fetch('/api/stats').then(r => r.json()) as Promise<Stats>,
    fetch('/api/properties').then(r => r.json()),
    fetch('/api/schemas').then(r => r.json()),
  ]);

  allProperties = propsData.properties;
  filteredProperties = [...allProperties];
  schemas = schemasData.schemas;
  sortProperties();

  app.innerHTML = `
    <nav class="topbar">
      <div class="topbar-left">
        <div class="logo">
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none"><rect width="32" height="32" rx="8" fill="#3b82f6"/><path d="M10 12h12M10 16h8M10 20h10" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>
        </div>
        <div class="topbar-title">
          <h1>FieldTrip</h1>
          <span class="topbar-stats">${stats.totalFiles} SCHEMAS &middot; ${stats.totalProperties} PROPERTIES</span>
        </div>
      </div>
      <div class="view-tabs" id="view-tabs">
        <button class="view-tab active" data-view="table">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
          Table
        </button>
        <button class="view-tab" data-view="matrix">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="4" height="4"/><rect x="10" y="3" width="4" height="4"/><rect x="17" y="3" width="4" height="4"/><rect x="3" y="10" width="4" height="4"/><rect x="10" y="10" width="4" height="4"/><rect x="3" y="17" width="4" height="4"/><rect x="17" y="17" width="4" height="4"/></svg>
          Matrix
        </button>
        <button class="view-tab" data-view="graph">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="5" cy="6" r="2"/><circle cx="19" cy="6" r="2"/><circle cx="12" cy="18" r="2"/><line x1="7" y1="6" x2="17" y2="6"/><line x1="6" y1="8" x2="11" y2="16"/><line x1="18" y1="8" x2="13" y2="16"/></svg>
          Graph
        </button>
      </div>
    </nav>

    <div class="main-layout">
      <aside class="sidebar" id="sidebar">
        <div class="sidebar-section">
          <div class="sidebar-heading">SCHEMAS<button class="clear-btn" id="clear-schemas">clear all</button></div>
          <div class="schema-list" id="schema-list"></div>
        </div>
      </aside>

      <main class="content" id="content">
        <div class="content-top">
          <div class="search-bar">
            <svg class="search-icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
            <input type="text" id="search-input" placeholder="Search properties, types, descriptions..." autofocus />
          </div>
          <div class="type-filters" id="type-filters"></div>
        </div>

        <div id="table-view">
          <div class="table-toolbar" id="table-toolbar"></div>
          <div class="table-wrapper" id="table-wrapper"></div>
        </div>

        <div id="detail-view" class="detail-view hidden">
          <button class="back-btn" id="back-btn">&larr; Back to results</button>
          <div class="detail-header" id="detail-header"></div>
          <div class="detail-editor" id="editor-container"></div>
        </div>

        <div id="matrix-view" class="matrix-view hidden">
          <div class="matrix-toolbar" id="matrix-toolbar"></div>
          <div class="matrix-container" id="matrix-container"></div>
        </div>

        <div id="graph-view" class="graph-view hidden">
          <div class="graph-toolbar" id="graph-toolbar"></div>
          <div class="graph-container" id="graph-container"></div>
        </div>
      </main>
    </div>
  `;

  // Create Monaco (hidden initially)
  editorInstance = monaco.editor.create(document.getElementById('editor-container')!, {
    value: '', language: 'yaml', theme: 'vs-dark', readOnly: true,
    minimap: { enabled: false }, scrollBeyondLastLine: false, fontSize: 13,
    lineNumbers: 'on', renderLineHighlight: 'none', automaticLayout: true,
    padding: { top: 12 }, scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
  });

  renderSidebar();
  renderTable();
  bindEvents();
}

// ─── Sidebar ───

function renderSidebar() {
  document.getElementById('schema-list')!.innerHTML = schemas.map(s => {
    const color = TYPE_COLORS[s.schemaType] || '#666';
    const label = TYPE_LABELS[s.schemaType] || s.schemaType.toUpperCase();
    const active = activeSchemaFilters.has(s.filePath);
    const name = s.filePath.replace(/\.[^.]+$/, '');
    return `
      <div class="schema-item${active ? ' active' : ''}" data-file="${esc(s.filePath)}">
        <span class="schema-badge" style="background:${TYPE_BG[s.schemaType]};color:${color}">${label}</span>
        <div class="schema-info">
          <span class="schema-name">${esc(name)}</span>
          <span class="schema-filepath">${esc(s.filePath)}</span>
        </div>
        <span class="schema-count">${s.count}</span>
      </div>
    `;
  }).join('');

  const allTypes = ['all types', ...Object.keys(TYPE_LABELS)];
  document.getElementById('type-filters')!.innerHTML = allTypes.map(t => {
    const isAll = t === 'all types';
    const active = isAll ? !activeTypeFilter : activeTypeFilter === t;
    const label = isAll ? 'all types' : TYPE_LABELS[t]?.toLowerCase() || t;
    return `<button class="type-chip${active ? ' active' : ''}" data-type="${t}">${label}</button>`;
  }).join('');
}

// ─── View Switching ───

function switchView(view: 'table' | 'graph' | 'matrix') {
  if (activeView === view) return;
  activeView = view;

  if (showingDetail) hideDetail();

  document.getElementById('table-view')!.classList.toggle('hidden', view !== 'table');
  document.getElementById('graph-view')!.classList.toggle('hidden', view !== 'graph');
  document.getElementById('matrix-view')!.classList.toggle('hidden', view !== 'matrix');

  document.querySelectorAll('.view-tab').forEach(tab => {
    tab.classList.toggle('active', (tab as HTMLElement).dataset.view === view);
  });

  if (view === 'graph') {
    renderGraph();
  } else if (view === 'matrix') {
    if (simulation) { simulation.stop(); simulation = null; }
    renderMatrix();
  } else {
    if (simulation) { simulation.stop(); simulation = null; }
    renderTable();
  }
}

// ─── Table ───

function renderTable() {
  const toolbar = document.getElementById('table-toolbar')!;
  const wrapper = document.getElementById('table-wrapper')!;

  toolbar.innerHTML = `
    <span class="table-count"><strong>${filteredProperties.length}</strong> of ${allProperties.length} properties</span>
    <div class="sort-controls">
      <button class="sort-btn${sortField === 'name' ? ' active' : ''}" data-sort="name">name ${sortField === 'name' ? (sortAsc ? '&uarr;' : '&darr;') : ''}</button>
      <button class="sort-btn${sortField === 'schema' ? ' active' : ''}" data-sort="schema">schema ${sortField === 'schema' ? (sortAsc ? '&uarr;' : '&darr;') : ''}</button>
      <button class="sort-btn${sortField === 'type' ? ' active' : ''}" data-sort="type">type ${sortField === 'type' ? (sortAsc ? '&uarr;' : '&darr;') : ''}</button>
    </div>
  `;

  if (filteredProperties.length === 0) {
    wrapper.innerHTML = '<div class="table-empty">No properties match your filters</div>';
    return;
  }

  wrapper.innerHTML = `
    <table class="prop-table">
      <thead><tr><th>PROPERTY</th><th>TYPE</th><th>SCHEMA</th><th>REQUIRED</th><th>DESCRIPTION</th></tr></thead>
      <tbody>${filteredProperties.map(p => renderRow(p)).join('')}</tbody>
    </table>
  `;
}

function renderRow(p: Property): string {
  const typeColor = getDataTypeColor(p.type);
  const schemaColor = TYPE_COLORS[p.schemaType] || '#666';
  const schemaLabel = TYPE_LABELS[p.schemaType] || p.schemaType.toUpperCase();
  const schemaBg = TYPE_BG[p.schemaType] || 'rgba(100,100,100,0.15)';
  const schemaName = p.filePath.replace(/\.[^.]+$/, '');
  const reqText = p.required
    ? '<span class="req-yes"><span class="req-dot"></span>required</span>'
    : '<span class="req-no">optional</span>';

  return `
    <tr class="prop-row" data-id="${esc(p.id)}" data-file="${esc(p.filePath)}">
      <td class="col-property"><span class="prop-name">${esc(p.name)}</span><span class="prop-parent">${esc(p.parentName)}</span></td>
      <td class="col-type"><span class="type-badge" style="color:${typeColor};background:${typeColor}15">${esc(p.type)}</span></td>
      <td class="col-schema"><span class="schema-badge-sm" style="background:${schemaBg};color:${schemaColor}">${schemaLabel}</span><span class="schema-file">${esc(schemaName)}</span></td>
      <td class="col-required">${reqText}</td>
      <td class="col-desc">${p.description ? esc(p.description) : '<span class="no-desc">&mdash;</span>'}</td>
    </tr>
  `;
}

function getDataTypeColor(type: string): string {
  return DATA_TYPE_COLORS[type.replace(/\[\]$/, '').toLowerCase()] || '#94a3b8';
}

// ─── Detail View (Monaco) ───

async function showDetail(property: Property) {
  showingDetail = true;
  document.getElementById('table-view')!.classList.add('hidden');
  document.getElementById('detail-view')!.classList.remove('hidden');

  const color = TYPE_COLORS[property.schemaType] || '#666';
  const label = TYPE_LABELS[property.schemaType] || property.schemaType.toUpperCase();
  const bg = TYPE_BG[property.schemaType] || 'rgba(100,100,100,0.15)';
  const typeColor = getDataTypeColor(property.type);

  document.getElementById('detail-header')!.innerHTML = `
    <div class="detail-title-row">
      <span class="detail-name">${esc(property.name)}</span>
      <span class="type-badge" style="color:${typeColor};background:${typeColor}15">${esc(property.type)}</span>
      ${property.required ? '<span class="req-yes"><span class="req-dot"></span>required</span>' : ''}
      ${property.format ? `<span class="detail-format">${esc(property.format)}</span>` : ''}
      <span class="schema-badge-sm" style="background:${bg};color:${color}">${label}</span>
    </div>
    ${property.description ? `<p class="detail-desc">${esc(property.description)}</p>` : ''}
    <div class="detail-path">${esc(property.filePath)} &middot; ${esc(property.schemaPath)}</div>
  `;

  if (currentFilePath !== property.filePath) {
    try {
      const data = await fetch(`/api/file?path=${encodeURIComponent(property.filePath)}`).then(r => r.json());
      currentFilePath = property.filePath;
      const ext = '.' + property.filePath.split('.').pop()?.toLowerCase();
      const model = editorInstance!.getModel()!;
      monaco.editor.setModelLanguage(model, FILE_LANGUAGES[ext] || 'plaintext');
      model.setValue(data.content);
    } catch {
      editorInstance!.getModel()!.setValue('// Failed to load file');
      currentFilePath = null;
    }
  }

  editorInstance!.layout();
  highlightProperty(property);
}

function hideDetail() {
  showingDetail = false;
  document.getElementById('detail-view')!.classList.add('hidden');
  document.getElementById('table-view')!.classList.remove('hidden');
}

function highlightProperty(property: Property) {
  if (!editorInstance) return;
  const model = editorInstance.getModel();
  if (!model) return;

  const lines = model.getLinesContent();
  const matchLines = findPropertyLines(lines, property);
  if (currentDecorations) currentDecorations.clear();
  if (matchLines.length > 0) {
    currentDecorations = editorInstance.createDecorationsCollection(
      matchLines.map(i => ({ range: new monaco.Range(i + 1, 1, i + 1, 1), options: { isWholeLine: true, className: 'highlighted-line' } }))
    );
    editorInstance.revealLineInCenter(matchLines[0] + 1);
  }
}

function findPropertyLines(lines: string[], result: Property): number[] {
  const matches: number[] = [];
  const propName = result.name;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (result.schemaType === 'protobuf') {
      if (new RegExp(`\\b${escRegex(propName)}\\s*=\\s*\\d+`).test(line)) matches.push(i);
    } else {
      if (new RegExp(`^\\s*${escRegex(propName)}\\s*:`).test(line) ||
          new RegExp(`"${escRegex(propName)}"\\s*:`).test(line)) matches.push(i);
    }
  }
  return matches;
}

// ─── Matrix View ───

interface MatrixRow {
  name: string;
  primaryType: string;
  occurrences: Map<string, { required: boolean; type: string; property: Property }>;
  totalSchemas: number;
  requiredCount: number;
}

function buildMatrixData(properties: Property[]): { rows: MatrixRow[]; schemaColumns: SchemaInfo[] } {
  // Group properties by lowercase name
  const nameMap = new Map<string, MatrixRow>();
  for (const p of properties) {
    const key = p.name.toLowerCase();
    if (!nameMap.has(key)) {
      nameMap.set(key, { name: p.name, primaryType: p.type, occurrences: new Map(), totalSchemas: 0, requiredCount: 0 });
    }
    const row = nameMap.get(key)!;
    // Prefer the casing from first occurrence
    if (!row.occurrences.has(p.filePath)) {
      row.occurrences.set(p.filePath, { required: p.required, type: p.type, property: p });
    }
  }

  // Compute counts
  for (const row of nameMap.values()) {
    row.totalSchemas = row.occurrences.size;
    row.requiredCount = Array.from(row.occurrences.values()).filter(o => o.required).length;
  }

  let rows = Array.from(nameMap.values());

  // Sort rows
  rows.sort((a, b) => {
    let cmp: number;
    switch (matrixSortField) {
      case 'alpha': cmp = a.name.localeCompare(b.name); break;
      case 'count': cmp = b.totalSchemas - a.totalSchemas; break;
      case 'required': cmp = b.requiredCount - a.requiredCount; break;
      default: cmp = 0;
    }
    return matrixSortAsc ? -cmp : cmp;
  });

  // Only include schemas that appear in the filtered properties
  const schemaFileSet = new Set(properties.map(p => p.filePath));
  const schemaColumns = schemas.filter(s => schemaFileSet.has(s.filePath));

  return { rows, schemaColumns };
}

function renderMatrix() {
  const toolbar = document.getElementById('matrix-toolbar')!;
  const container = document.getElementById('matrix-container')!;

  const { rows, schemaColumns } = buildMatrixData(filteredProperties);

  // Filter to only rows that appear in 2+ schemas by default (can show all)
  const sharedRows = rows.filter(r => r.totalSchemas >= 2);
  const displayRows = sharedRows.length > 0 ? sharedRows : rows;

  const sortBtns = (['alpha', 'count', 'required'] as const).map(f => {
    const labels: Record<string, string> = { alpha: 'A-Z', count: 'frequency', required: 'required' };
    const active = matrixSortField === f;
    return `<button class="sort-btn${active ? ' active' : ''}" data-msort="${f}">${labels[f]}</button>`;
  }).join('');

  toolbar.innerHTML = `
    <span class="matrix-stats"><strong>${displayRows.length}</strong> properties &times; <strong>${schemaColumns.length}</strong> schemas</span>
    <div class="matrix-controls">
      <span class="matrix-sort-label">Sort:</span>
      <div class="sort-controls">${sortBtns}</div>
      <div class="matrix-legend">
        <span class="legend-item"><span class="legend-dot" style="background:#22c55e"></span>required</span>
        <span class="legend-item"><span class="legend-dot" style="background:#3b82f6"></span>optional</span>
        <span class="legend-item"><span class="legend-dot" style="background:transparent;border:1px solid var(--border)"></span>absent</span>
      </div>
    </div>
  `;

  if (displayRows.length === 0 || schemaColumns.length === 0) {
    container.innerHTML = '<div class="matrix-empty">No data to display in the matrix</div>';
    return;
  }

  // Build the matrix grid using a scrollable div with sticky headers
  const CELL_SIZE = 28;
  const PROP_COL_WIDTH = 180;
  const COUNT_COL_WIDTH = 50;
  const HEADER_HEIGHT = 120;

  // We'll render a virtualized approach: render all rows but use CSS grid
  let html = `<div class="matrix-grid" style="grid-template-columns: ${PROP_COL_WIDTH}px ${COUNT_COL_WIDTH}px repeat(${schemaColumns.length}, ${CELL_SIZE}px);">`;

  // Header row — property label + count + schema names (rotated)
  html += `<div class="matrix-header-cell matrix-corner">Property</div>`;
  html += `<div class="matrix-header-cell matrix-count-header">#</div>`;
  for (let ci = 0; ci < schemaColumns.length; ci++) {
    const s = schemaColumns[ci];
    const color = TYPE_COLORS[s.schemaType] || '#666';
    const name = s.filePath.replace(/\.[^.]+$/, '').split('/').pop()!;
    html += `<div class="matrix-header-cell matrix-schema-header" data-col="${ci}" data-file="${esc(s.filePath)}" title="${esc(s.filePath)}"><span class="matrix-schema-label" style="color:${color}">${esc(name)}</span></div>`;
  }

  // Data rows
  for (let ri = 0; ri < displayRows.length; ri++) {
    const row = displayRows[ri];
    const isShared = row.totalSchemas >= 2;

    const typeColor = getDataTypeColor(row.primaryType);
    html += `<div class="matrix-prop-cell" data-row="${ri}" data-name="${esc(row.name)}">${esc(row.name)} <span class="matrix-prop-type" style="color:${typeColor}">(${esc(row.primaryType)})</span>${isShared ? `<span class="matrix-shared-badge">${row.totalSchemas}</span>` : ''}</div>`;
    html += `<div class="matrix-count-cell" data-row="${ri}">${row.totalSchemas}</div>`;

    for (let ci = 0; ci < schemaColumns.length; ci++) {
      const s = schemaColumns[ci];
      const occ = row.occurrences.get(s.filePath);
      let cls = 'matrix-cell';
      let title = '';
      if (occ) {
        cls += occ.required ? ' matrix-cell-required' : ' matrix-cell-optional';
        title = `${row.name} (${occ.type}) in ${s.filePath.replace(/\.[^.]+$/, '').split('/').pop()} — ${occ.required ? 'required' : 'optional'}`;
      } else {
        cls += ' matrix-cell-empty';
      }
      html += `<div class="${cls}" data-row="${ri}" data-col="${ci}" data-name="${esc(row.name)}" data-file="${esc(s.filePath)}" title="${esc(title)}"></div>`;
    }
  }

  html += '</div>';
  container.innerHTML = html;

  // ─── Matrix interactions ───
  const grid = container.querySelector('.matrix-grid') as HTMLElement;

  // Tooltip
  let matrixTooltip = container.querySelector('.matrix-tooltip') as HTMLElement;
  if (!matrixTooltip) {
    matrixTooltip = document.createElement('div');
    matrixTooltip.className = 'matrix-tooltip';
    container.appendChild(matrixTooltip);
  }

  // Hover cells — show tooltip + highlight row/col
  grid.addEventListener('mouseover', (e) => {
    const cell = (e.target as HTMLElement).closest('.matrix-cell, .matrix-prop-cell, .matrix-schema-header') as HTMLElement | null;
    if (!cell) return;

    const rowIdx = cell.dataset.row;
    const colIdx = cell.dataset.col;
    const propName = cell.dataset.name;
    const filePath = cell.dataset.file;

    // Highlight row
    if (rowIdx !== undefined) {
      grid.querySelectorAll(`[data-row="${rowIdx}"]`).forEach(el => el.classList.add('matrix-highlight-row'));
    }
    // Highlight column
    if (colIdx !== undefined) {
      grid.querySelectorAll(`[data-col="${colIdx}"]`).forEach(el => el.classList.add('matrix-highlight-col'));
    }

    // Show tooltip for data cells
    if (cell.classList.contains('matrix-cell') && !cell.classList.contains('matrix-cell-empty')) {
      const row = displayRows[Number(rowIdx)];
      const schema = schemaColumns[Number(colIdx)];
      if (row && schema) {
        const occ = row.occurrences.get(schema.filePath);
        if (occ) {
          const schemaName = schema.filePath.replace(/\.[^.]+$/, '').split('/').pop()!;
          const schemaColor = TYPE_COLORS[schema.schemaType] || '#666';
          matrixTooltip.innerHTML = `
            <div class="tt-label">${esc(row.name)}</div>
            <div class="tt-detail">Type: <span style="color:${getDataTypeColor(occ.type)}">${esc(occ.type)}</span></div>
            <div class="tt-detail">Schema: <span style="color:${schemaColor}">${esc(schemaName)}</span></div>
            <div class="tt-detail">${occ.required ? '<span style="color:#22c55e">required</span>' : '<span style="color:#3b82f6">optional</span>'}</div>
          `;
          const rect = container.getBoundingClientRect();
          const cellRect = cell.getBoundingClientRect();
          matrixTooltip.style.left = (cellRect.left - rect.left + cellRect.width + 8) + 'px';
          matrixTooltip.style.top = (cellRect.top - rect.top - 10) + 'px';
          matrixTooltip.style.opacity = '1';
        }
      }
    }

    // Hovering a property row header — highlight all schemas containing it
    if (cell.classList.contains('matrix-prop-cell') && propName) {
      const row = displayRows[Number(rowIdx)];
      if (row) {
        for (let ci = 0; ci < schemaColumns.length; ci++) {
          if (row.occurrences.has(schemaColumns[ci].filePath)) {
            grid.querySelectorAll(`[data-col="${ci}"]`).forEach(el => el.classList.add('matrix-highlight-col'));
          }
        }
      }
    }

    // Hovering a schema column header — highlight all properties in it
    if (cell.classList.contains('matrix-schema-header') && filePath) {
      for (let ri = 0; ri < displayRows.length; ri++) {
        if (displayRows[ri].occurrences.has(filePath)) {
          grid.querySelectorAll(`[data-row="${ri}"]`).forEach(el => el.classList.add('matrix-highlight-row'));
        }
      }
    }
  });

  grid.addEventListener('mouseout', (e) => {
    const cell = (e.target as HTMLElement).closest('.matrix-cell, .matrix-prop-cell, .matrix-schema-header') as HTMLElement | null;
    if (!cell) return;
    grid.querySelectorAll('.matrix-highlight-row').forEach(el => el.classList.remove('matrix-highlight-row'));
    grid.querySelectorAll('.matrix-highlight-col').forEach(el => el.classList.remove('matrix-highlight-col'));
    matrixTooltip.style.opacity = '0';
  });

  // Click a property row — show detail for first occurrence
  grid.addEventListener('click', (e) => {
    const cell = (e.target as HTMLElement).closest('.matrix-prop-cell') as HTMLElement | null;
    if (cell) {
      const row = displayRows[Number(cell.dataset.row)];
      if (row) {
        const firstOcc = Array.from(row.occurrences.values())[0];
        if (firstOcc) showDetail(firstOcc.property);
      }
      return;
    }

    // Click a schema column header — filter sidebar to that schema
    const header = (e.target as HTMLElement).closest('.matrix-schema-header') as HTMLElement | null;
    if (header && header.dataset.file) {
      const file = header.dataset.file;
      activeSchemaFilters.clear();
      activeSchemaFilters.add(file);
      renderSidebar();
      applyFilters();
    }
  });
}

// ─── Graph View ───

function buildGraphData(properties: Property[]): { nodes: GraphNode[]; links: GraphLink[] } {
  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];

  // Find shared property names (appear in 2+ different files)
  const nameGroups = new Map<string, Property[]>();
  for (const p of properties) {
    const key = p.name.toLowerCase();
    if (!nameGroups.has(key)) nameGroups.set(key, []);
    nameGroups.get(key)!.push(p);
  }

  const sharedNames = new Set<string>();
  for (const [key, group] of nameGroups) {
    const uniqueFiles = new Set(group.map(p => p.filePath));
    if (uniqueFiles.size >= 2) sharedNames.add(key);
  }

  // Filter properties to only shared if toggle is on
  const graphProperties = graphOnlyShared
    ? properties.filter(p => sharedNames.has(p.name.toLowerCase()))
    : properties;

  // Schema nodes (only include schemas that have properties in the graph)
  const schemaMap = new Map<string, Property[]>();
  for (const p of graphProperties) {
    if (!schemaMap.has(p.filePath)) schemaMap.set(p.filePath, []);
    schemaMap.get(p.filePath)!.push(p);
  }

  for (const [filePath, props] of schemaMap) {
    nodes.push({
      id: `schema:${filePath}`,
      label: filePath.replace(/\.[^.]+$/, '').split('/').pop()!,
      nodeType: 'schema',
      schemaType: props[0].schemaType,
      filePath,
      count: props.length,
    });
  }

  // Property nodes + belongs-to links
  for (const p of graphProperties) {
    nodes.push({
      id: `prop:${p.id}`,
      label: p.name,
      nodeType: 'property',
      schemaType: p.schemaType,
      propertyName: p.name,
      propertyType: p.type,
      parentName: p.parentName,
      filePath: p.filePath,
    });
    links.push({
      source: `prop:${p.id}`,
      target: `schema:${p.filePath}`,
      linkType: 'belongs-to',
    });
  }

  // Shared-name links — connect properties with same name across different schemas
  for (const [, group] of nameGroups) {
    const crossFile = group.filter(p => graphProperties.includes(p));
    const uniqueFiles = new Set(crossFile.map(p => p.filePath));
    if (uniqueFiles.size < 2) continue;

    // Chain pattern to avoid O(n^2) links
    for (let i = 1; i < crossFile.length; i++) {
      if (crossFile[i].filePath !== crossFile[i - 1].filePath) {
        links.push({
          source: `prop:${crossFile[i - 1].id}`,
          target: `prop:${crossFile[i].id}`,
          linkType: 'shared-name',
        });
      }
    }
  }

  return { nodes, links };
}

function renderGraph() {
  const container = document.getElementById('graph-container')!;
  const toolbar = document.getElementById('graph-toolbar')!;
  container.innerHTML = '';

  if (simulation) { simulation.stop(); simulation = null; }

  const props = filteredProperties;
  const { nodes, links } = buildGraphData(props);

  // Stats for toolbar
  const nameGroups = new Map<string, Set<string>>();
  for (const p of props) {
    const key = p.name.toLowerCase();
    if (!nameGroups.has(key)) nameGroups.set(key, new Set());
    nameGroups.get(key)!.add(p.filePath);
  }
  let sharedCount = 0;
  for (const [, files] of nameGroups) { if (files.size >= 2) sharedCount++; }

  const schemaNodes = nodes.filter(n => n.nodeType === 'schema').length;
  const propNodes = nodes.filter(n => n.nodeType === 'property').length;
  const sharedLinks = links.filter(l => l.linkType === 'shared-name').length;

  toolbar.innerHTML = `
    <span class="graph-stats"><strong>${propNodes}</strong> properties &middot; <strong>${schemaNodes}</strong> schemas &middot; <strong>${sharedCount}</strong> shared names &middot; <strong>${sharedLinks}</strong> connections</span>
    <div class="graph-controls">
      <label class="graph-toggle">
        <input type="checkbox" id="shared-toggle" ${graphOnlyShared ? 'checked' : ''} />
        Shared only
      </label>
      <div class="graph-legend">
        ${Object.entries(TYPE_COLORS).map(([k, c]) => `<span class="legend-item"><span class="legend-dot" style="background:${c}"></span>${TYPE_LABELS[k]}</span>`).join('')}
        <span class="legend-item"><span class="legend-dot" style="background:#f59e0b;border-radius:0;width:16px;height:2px"></span>shared link</span>
      </div>
    </div>
  `;

  if (nodes.length === 0) {
    container.innerHTML = '<div class="graph-empty">No shared properties to display. Uncheck "Shared only" to see all properties.</div>';
    return;
  }

  let width = container.clientWidth || 800;
  let height = container.clientHeight || 600;

  const svg = d3.select(container)
    .append('svg')
    .attr('width', width)
    .attr('height', height)
    .attr('viewBox', `0 0 ${width} ${height}`);

  const g = svg.append('g');

  const zoom = d3.zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.1, 8])
    .on('zoom', (event) => g.attr('transform', event.transform));
  svg.call(zoom);

  // Tooltip
  const tooltip = d3.select(container)
    .append('div')
    .attr('class', 'graph-tooltip');

  // Force simulation
  simulation = d3.forceSimulation<GraphNode, GraphLink>(nodes)
    .force('link', d3.forceLink<GraphNode, GraphLink>(links)
      .id(d => d.id)
      .distance(d => d.linkType === 'belongs-to' ? 15 : 140)
      .strength(d => d.linkType === 'belongs-to' ? 1.8 : 0.06))
    .force('charge', d3.forceManyBody<GraphNode>()
      .strength(d => d.nodeType === 'schema' ? -700 : -5))
    .force('center', d3.forceCenter(width / 2, height / 2))
    .force('collision', d3.forceCollide<GraphNode>()
      .radius(d => d.nodeType === 'schema' ? 35 : 8))
    .force('x', d3.forceX(width / 2).strength(0.03))
    .force('y', d3.forceY(height / 2).strength(0.03))
    .alphaDecay(0.02);

  // Links
  const link = g.append('g')
    .attr('class', 'graph-links')
    .selectAll('line')
    .data(links)
    .join('line')
    .attr('stroke', d => d.linkType === 'shared-name' ? '#f59e0b' : '#2a2f42')
    .attr('stroke-width', d => d.linkType === 'shared-name' ? 2 : 0.8)
    .attr('stroke-opacity', d => d.linkType === 'shared-name' ? 0.7 : 0.25)
    .attr('stroke-dasharray', d => d.linkType === 'shared-name' ? '6,3' : 'none');

  // Node groups (circle + label together for dragging)
  const nodeGroup = g.append('g')
    .attr('class', 'graph-nodes')
    .selectAll<SVGGElement, GraphNode>('g')
    .data(nodes)
    .join('g')
    .attr('cursor', 'pointer')
    .call(d3.drag<SVGGElement, GraphNode>()
      .on('start', (event, d) => {
        if (!event.active) simulation!.alphaTarget(0.3).restart();
        d.fx = d.x; d.fy = d.y;
      })
      .on('drag', (event, d) => { d.fx = event.x; d.fy = event.y; })
      .on('end', (event, d) => {
        if (!event.active) simulation!.alphaTarget(0);
        d.fx = null; d.fy = null;
      }));

  // Circles within node groups
  nodeGroup.append('circle')
    .attr('r', d => d.nodeType === 'schema' ? 22 : 6)
    .attr('fill', d => {
      const color = TYPE_COLORS[d.schemaType!] || '#666';
      return d.nodeType === 'schema' ? color : color;
    })
    .attr('fill-opacity', d => d.nodeType === 'schema' ? 0.85 : 0.65)
    .attr('stroke', d => d.nodeType === 'schema' ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.1)')
    .attr('stroke-width', d => d.nodeType === 'schema' ? 2.5 : 1);

  // Labels for ALL nodes
  nodeGroup.append('text')
    .text(d => d.label)
    .attr('font-size', d => d.nodeType === 'schema' ? '11px' : '8px')
    .attr('font-weight', d => d.nodeType === 'schema' ? '600' : '400')
    .attr('fill', d => d.nodeType === 'schema' ? '#c8d0e0' : '#6b7280')
    .attr('text-anchor', 'middle')
    .attr('dy', d => d.nodeType === 'schema' ? -28 : -10)
    .attr('pointer-events', 'none')
    .attr('class', d => `node-label node-label-${d.nodeType}`);

  // Hover — show tooltip
  nodeGroup.on('mouseenter', (event, d) => {
    const color = TYPE_COLORS[d.schemaType!] || '#666';
    const typeLabel = TYPE_LABELS[d.schemaType!] || d.schemaType || '';
    let content: string;
    if (d.nodeType === 'schema') {
      content = `<div class="tt-label">${esc(d.label)}</div><div class="tt-detail"><span style="color:${color}">${typeLabel}</span> &middot; ${d.count} properties</div><div class="tt-detail">${esc(d.filePath || '')}</div>`;
    } else {
      content = `<div class="tt-label">${esc(d.label)} <span style="color:${getDataTypeColor(d.propertyType || 'string')}">${esc(d.propertyType || '')}</span></div><div class="tt-detail">${esc(d.parentName || '')} &middot; <span style="color:${color}">${typeLabel}</span></div>`;
    }

    // Position relative to the container
    const rect = container.getBoundingClientRect();
    tooltip.html(content)
      .style('left', (event.clientX - rect.left + 14) + 'px')
      .style('top', (event.clientY - rect.top - 14) + 'px')
      .style('opacity', '1');

    // Subtle hover glow
    d3.select(event.currentTarget).select('circle')
      .attr('stroke', 'rgba(255,255,255,0.6)')
      .attr('stroke-width', d.nodeType === 'schema' ? 3 : 2);
  })
  .on('mousemove', (event) => {
    const rect = container.getBoundingClientRect();
    tooltip
      .style('left', (event.clientX - rect.left + 14) + 'px')
      .style('top', (event.clientY - rect.top - 14) + 'px');
  })
  .on('mouseleave', (event, d) => {
    tooltip.style('opacity', '0');
    d3.select(event.currentTarget).select('circle')
      .attr('stroke', d.nodeType === 'schema' ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.1)')
      .attr('stroke-width', d.nodeType === 'schema' ? 2.5 : 1);
  });

  // Click to highlight shared properties
  nodeGroup.on('click', (event, d) => {
    event.stopPropagation();
    if (d.nodeType === 'property') {
      const name = d.propertyName!.toLowerCase();
      // Find connected schemas
      const connectedSchemas = new Set<string>();
      links.forEach(l => {
        const s = l.source as GraphNode;
        const t = l.target as GraphNode;
        if (s.propertyName?.toLowerCase() === name && t.nodeType === 'schema') connectedSchemas.add(t.id);
        if (t.propertyName?.toLowerCase() === name && s.nodeType === 'schema') connectedSchemas.add(s.id);
      });

      nodeGroup.attr('opacity', n =>
        n.propertyName?.toLowerCase() === name || connectedSchemas.has(n.id) ? 1 : 0.06);
      nodeGroup.selectAll('.node-label').attr('opacity', function() {
        const n = d3.select(this.parentNode as SVGGElement).datum() as GraphNode;
        return n.propertyName?.toLowerCase() === name || connectedSchemas.has(n.id) ? 1 : 0.06;
      });
      link.attr('opacity', l => {
        const s = l.source as GraphNode;
        const t = l.target as GraphNode;
        return (s.propertyName?.toLowerCase() === name || t.propertyName?.toLowerCase() === name) ? 0.9 : 0.02;
      });
    } else if (d.nodeType === 'schema') {
      // Highlight all properties belonging to this schema
      const schemaProps = new Set<string>();
      links.forEach(l => {
        const s = l.source as GraphNode;
        const t = l.target as GraphNode;
        if (t.id === d.id && s.nodeType === 'property') schemaProps.add(s.id);
        if (s.id === d.id && t.nodeType === 'property') schemaProps.add(t.id);
      });

      nodeGroup.attr('opacity', n =>
        n.id === d.id || schemaProps.has(n.id) ? 1 : 0.06);
      nodeGroup.selectAll('.node-label').attr('opacity', function() {
        const n = d3.select(this.parentNode as SVGGElement).datum() as GraphNode;
        return n.id === d.id || schemaProps.has(n.id) ? 1 : 0.06;
      });
      link.attr('opacity', l => {
        const s = l.source as GraphNode;
        const t = l.target as GraphNode;
        return (s.id === d.id || t.id === d.id || schemaProps.has(s.id) || schemaProps.has(t.id)) ? 0.9 : 0.02;
      });
    }
  });

  // Click background to reset
  svg.on('click', () => {
    nodeGroup.attr('opacity', 1);
    nodeGroup.selectAll('.node-label').attr('opacity', 1);
    link.attr('opacity', d => (d as GraphLink).linkType === 'shared-name' ? 0.7 : 0.25);
  });

  // Tick — update positions
  simulation.on('tick', () => {
    link
      .attr('x1', d => (d.source as GraphNode).x!)
      .attr('y1', d => (d.source as GraphNode).y!)
      .attr('x2', d => (d.target as GraphNode).x!)
      .attr('y2', d => (d.target as GraphNode).y!);
    nodeGroup
      .attr('transform', d => `translate(${d.x},${d.y})`);
  });

  // Responsive: resize on window resize
  const resizeObserver = new ResizeObserver(() => {
    if (activeView !== 'graph') return;
    const newW = container.clientWidth;
    const newH = container.clientHeight;
    if (newW === width && newH === height) return;
    width = newW;
    height = newH;
    svg.attr('width', width).attr('height', height).attr('viewBox', `0 0 ${width} ${height}`);
    simulation?.force('center', d3.forceCenter(width / 2, height / 2));
    simulation?.force('x', d3.forceX(width / 2).strength(0.03));
    simulation?.force('y', d3.forceY(height / 2).strength(0.03));
    simulation?.alpha(0.3).restart();
  });
  resizeObserver.observe(container);
}

// ─── Filtering & Sorting ───

function applyFilters() {
  if (searchQuery) {
    const params = new URLSearchParams({ q: searchQuery });
    if (activeTypeFilter) params.set('schemaType', activeTypeFilter);
    fetch(`/api/search?${params}`).then(r => r.json()).then(data => {
      let results: Property[] = data.results;
      if (activeSchemaFilters.size > 0) {
        results = results.filter(r => activeSchemaFilters.has(r.filePath));
      }
      filteredProperties = results;
      if (activeView === 'table') renderTable();
      else if (activeView === 'matrix') renderMatrix();
      else renderGraph();
    });
  } else {
    filteredProperties = allProperties.filter(p => {
      if (activeTypeFilter && p.schemaType !== activeTypeFilter) return false;
      if (activeSchemaFilters.size > 0 && !activeSchemaFilters.has(p.filePath)) return false;
      return true;
    });
    sortProperties();
    if (activeView === 'table') renderTable();
    else if (activeView === 'matrix') renderMatrix();
    else renderGraph();
  }
}

function sortProperties() {
  filteredProperties.sort((a, b) => {
    let va: string, vb: string;
    switch (sortField) {
      case 'name': va = a.name; vb = b.name; break;
      case 'schema': va = a.filePath; vb = b.filePath; break;
      case 'type': va = a.type; vb = b.type; break;
      default: va = a.name; vb = b.name;
    }
    return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
  });
}

// ─── Events ───

function bindEvents() {
  const input = document.getElementById('search-input') as HTMLInputElement;
  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => { searchQuery = input.value.trim(); applyFilters(); }, 200);
  });

  // View tabs
  document.getElementById('view-tabs')!.addEventListener('click', (e) => {
    const tab = (e.target as HTMLElement).closest('.view-tab') as HTMLElement | null;
    if (!tab) return;
    switchView(tab.dataset.view as 'table' | 'graph' | 'matrix');
  });

  // Schema list clicks
  document.getElementById('schema-list')!.addEventListener('click', (e) => {
    const item = (e.target as HTMLElement).closest('.schema-item') as HTMLElement | null;
    if (!item) return;
    const file = item.dataset.file!;
    if (activeSchemaFilters.has(file)) activeSchemaFilters.delete(file);
    else activeSchemaFilters.add(file);
    renderSidebar();
    applyFilters();
  });

  document.getElementById('clear-schemas')!.addEventListener('click', () => {
    activeSchemaFilters.clear();
    renderSidebar();
    applyFilters();
  });

  document.getElementById('type-filters')!.addEventListener('click', (e) => {
    const chip = (e.target as HTMLElement).closest('.type-chip') as HTMLElement | null;
    if (!chip) return;
    activeTypeFilter = chip.dataset.type === 'all types' ? null : chip.dataset.type!;
    renderSidebar();
    applyFilters();
  });

  document.getElementById('table-toolbar')!.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('.sort-btn') as HTMLElement | null;
    if (!btn) return;
    const field = btn.dataset.sort as 'name' | 'schema' | 'type';
    if (sortField === field) sortAsc = !sortAsc;
    else { sortField = field; sortAsc = true; }
    sortProperties();
    renderTable();
  });

  document.getElementById('table-wrapper')!.addEventListener('click', (e) => {
    const row = (e.target as HTMLElement).closest('.prop-row') as HTMLElement | null;
    if (!row) return;
    const id = row.dataset.id!;
    const prop = filteredProperties.find(p => p.id === id) || allProperties.find(p => p.id === id);
    if (prop) showDetail(prop);
  });

  document.getElementById('back-btn')!.addEventListener('click', hideDetail);

  // Matrix sort
  document.getElementById('matrix-toolbar')!.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('[data-msort]') as HTMLElement | null;
    if (!btn) return;
    const field = btn.dataset.msort as 'alpha' | 'count' | 'required';
    if (matrixSortField === field) matrixSortAsc = !matrixSortAsc;
    else { matrixSortField = field; matrixSortAsc = field === 'alpha'; }
    renderMatrix();
  });

  // Graph shared toggle
  document.getElementById('graph-toolbar')!.addEventListener('change', (e) => {
    const target = e.target as HTMLInputElement;
    if (target.id === 'shared-toggle') {
      graphOnlyShared = target.checked;
      renderGraph();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && showingDetail) hideDetail();
  });
}

// ─── Helpers ───

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

init();
