/// <reference types="vite/client" />
import './json-viewer.css';
import feelUrl from './feel.json?url&no-inline';
import auditUrl from '../../reports/web-3c/asset-audit.json?url&no-inline';
import routeUrl from '../fixtures/route.replay.json?url&no-inline';
import motionsUrl from '../../docs/player/motions.json?url&no-inline';
import { detectView, parseError, pathLabel, rawValue, search } from './json-viewer-data';
import type { Json, Match, Path, SearchScope } from './json-viewer-data';
import { button, element, pagination, preview, renderTree } from './json-viewer-tree';
import { renderAudit, renderFeel } from './json-viewer-tables';

const samples = new Map([
  ['feel.json', { label: '手感参数', url: feelUrl }],
  ['asset-audit.json', { label: '资源审计', url: auditUrl }],
  ['route.replay.json', { label: '路线回放', url: routeUrl }],
  ['motions.json', { label: '角色动作', url: motionsUrl }],
]);
const sampleSelect = document.querySelector<HTMLSelectElement>('#sample-select')!;
const sampleStatus = document.querySelector<HTMLElement>('#sample-status')!;
const fileInput = document.querySelector<HTMLInputElement>('#file-input')!;
const dropZone = document.querySelector<HTMLElement>('#drop-zone')!;
const pasteForm = document.querySelector<HTMLFormElement>('#paste-form')!;
const pasteInput = document.querySelector<HTMLTextAreaElement>('#paste-input')!;
const errorMessage = document.querySelector<HTMLElement>('#import-error')!;
const documentView = document.querySelector<HTMLElement>('#document-view')!;
const title = document.querySelector<HTMLElement>('#document-title')!;
const viewer = document.querySelector<HTMLElement>('#viewer')!;
const tableButton = document.querySelector<HTMLButtonElement>('#table-view')!;
const treeButton = document.querySelector<HTMLButtonElement>('#tree-view')!;
const query = document.querySelector<HTMLInputElement>('#search-query')!;
const scope = document.querySelector<HTMLSelectElement>('#search-scope')!;
const results = document.querySelector<HTMLElement>('#search-results')!;
const copyStatus = document.querySelector<HTMLElement>('#copy-status')!;

let importId = 0;
let searchTimer: number | undefined;
let current: {
  value: Json;
  tree: ReturnType<typeof renderTree>;
  table: HTMLElement | undefined;
} | undefined;

function showError(message: string) {
  errorMessage.textContent = message;
  errorMessage.hidden = !message;
}

function beginImport() {
  showError('');
  sampleStatus.textContent = '';
  return ++importId;
}

function open(source: string, name: string) {
  source = source.replace(/^\uFEFF/, '');
  let value: Json;
  try {
    value = JSON.parse(source) as Json;
  } catch (error) {
    showError(parseError(error, source));
    return;
  }

  const type = detectView(value);
  const table = type === 'feel' ? renderFeel(value) : type === 'audit' ? renderAudit(value) : undefined;
  current = { value, table, tree: renderTree(value, (path, raw) => {
    void copy(raw ? rawValue(source, path) : pathLabel(path), raw ? '原始值' : '字段路径');
  }) };
  showError('');
  title.textContent = name;
  documentView.hidden = false;
  tableButton.hidden = !table;
  tableButton.textContent = type === 'feel' ? '手感参数表' : '资源审计表';
  query.value = '';
  refreshSearch();
  showView(Boolean(table));
}

async function loadFile(file: File) {
  sampleSelect.value = '';
  const id = beginImport();
  try {
    const source = await file.text();
    if (id === importId) open(source, file.name);
  } catch {
    if (id === importId) showError('无法读取文件「' + file.name + '」。请重新选择。');
  }
}

async function loadSample(name: string, url: string) {
  const id = beginImport();
  sampleStatus.textContent = '正在加载 ' + name + '…';
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(String(response.status));
    const source = await response.text();
    if (id === importId) {
      open(source, name);
      if (!errorMessage.hidden) sampleSelect.value = '';
    }
  } catch {
    if (id === importId) {
      sampleSelect.value = '';
      showError('无法加载站内样本「' + name + '」。请重新选择。');
    }
  } finally {
    if (id === importId) sampleStatus.textContent = '';
  }
}

function showView(table: boolean) {
  if (!current) return;
  const view = table && current.table ? current.table : current.tree.node;
  if (viewer.firstChild !== view) viewer.replaceChildren(view);
  tableButton.setAttribute('aria-pressed', String(view === current.table));
  treeButton.setAttribute('aria-pressed', String(view === current.tree.node));
}

function refreshSearch() {
  window.clearTimeout(searchTimer);
  const needle = query.value.trim();
  results.hidden = !needle;
  results.replaceChildren();
  if (!current || !needle) return;
  const feedback = element('p', '正在搜索…');
  feedback.className = 'result-count';
  feedback.setAttribute('role', 'status');
  results.append(feedback);
  searchTimer = window.setTimeout(() => {
    const matches = search(current!.value, needle, scope.value as SearchScope);
    const list = element('div');
    results.append(list);
    feedback.textContent = matches.length ? matches.length + ' 个匹配' : '没有匹配的字段名或值。';
    if (matches.length) showMatches(matches, list, 0);
  }, 120);
}

function showMatches(matches: Match[], list: HTMLElement, page: number) {
  const size = 12;
  const rows = element('ul');
  rows.className = 'matches';
  for (const match of matches.slice(page * size, (page + 1) * size)) {
    const item = element('li');
    const jump = button('', () => {
      showView(false);
      current?.tree.jump(match);
    });
    jump.append(element('code', pathLabel(match.path)), element('span', preview(match.value)));
    item.append(jump);
    rows.append(item);
  }
  list.replaceChildren(rows);
  if (matches.length > size) list.append(pagination(page, size, matches.length, next => showMatches(matches, list, next)));
}

async function copy(text: string, label: string) {
  copyStatus.textContent = '';
  try {
    await navigator.clipboard.writeText(text);
    copyStatus.textContent = '已复制' + label;
  } catch {
    const dialog = element('dialog');
    const heading = element('h2', '手动复制' + label);
    const input = element('textarea');
    input.value = text;
    input.rows = 5;
    input.readOnly = true;
    input.setAttribute('aria-label', label);
    dialog.append(heading, input, button('关闭', () => dialog.close()));
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    document.body.append(dialog);
    dialog.showModal();
    input.select();
  }
}

for (const [name, { label }] of samples) {
  sampleSelect.add(new Option(label + ' · ' + name, name));
}
sampleSelect.addEventListener('change', () => {
  const sample = samples.get(sampleSelect.value);
  if (sample) void loadSample(sampleSelect.value, sample.url);
});

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file) void loadFile(file);
  fileInput.value = '';
});

for (const event of ['dragenter', 'dragover'] as const) {
  dropZone.addEventListener(event, e => {
    e.preventDefault();
    dropZone.classList.add('dragging');
  });
}
dropZone.addEventListener('dragleave', e => {
  if (!(e.relatedTarget instanceof Node && dropZone.contains(e.relatedTarget))) dropZone.classList.remove('dragging');
});
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('dragging');
  const file = e.dataTransfer?.files[0];
  if (file) void loadFile(file);
});
pasteForm.addEventListener('submit', e => {
  e.preventDefault();
  sampleSelect.value = '';
  beginImport();
  open(pasteInput.value, '粘贴的 JSON');
});
tableButton.addEventListener('click', () => showView(true));
treeButton.addEventListener('click', () => showView(false));
query.addEventListener('input', refreshSearch);
scope.addEventListener('change', refreshSearch);
