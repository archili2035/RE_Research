import { feelFields, feelGroups, field, isObject } from './json-viewer-data';
import type { Json } from './json-viewer-data';
import { button, element } from './json-viewer-tree';

const missing = '未记录';
const stages = [
  ['extraction', '提取'], ['decode', '解码'], ['binding', '绑定'], ['readback', '回读'],
] as const;

function display(value: Json | undefined): string {
  if (value === undefined) return missing;
  if (typeof value === 'string') return value || '""';
  return JSON.stringify(value);
}

function list(value: Json | undefined): Json[] {
  return Array.isArray(value) ? value : [];
}

function table(headers: string[]) {
  const wrapper = element('div');
  wrapper.className = 'table-scroll';
  const grid = element('table');
  const head = grid.createTHead().insertRow();
  for (const name of headers) {
    const th = element('th', name);
    th.scope = 'col';
    head.append(th);
  }
  wrapper.append(grid);
  return { wrapper, body: grid.createTBody() };
}

export function renderFeel(value: Json): HTMLElement {
  const view = element('div');
  for (const [key, title] of feelGroups) {
    const section = element('section');
    section.className = 'feel-group';
    section.append(element('h3', title));
    const group = field(value, key);
    if (!isObject(group) || !Object.keys(group).length) {
      section.append(element('p', missing));
    } else {
      const { wrapper, body } = table(['参数', '值', '来源', '证据等级', '条件']);
      for (const [name, parameter] of Object.entries(group)) {
        const row = body.insertRow();
        const th = element('th', name);
        th.scope = 'row';
        row.append(th);
        for (const name of feelFields) {
          const cell = name === 'value' && !isObject(parameter) ? parameter : field(parameter, name);
          row.insertCell().textContent = display(cell);
        }
      }
      section.append(wrapper);
    }
    view.append(section);
  }
  return view;
}

function evidence(value: Json | undefined) {
  if (!isObject(value)) return element('p', display(value));
  const list = element('dl');
  for (const [key, detail] of Object.entries(value)) {
    list.append(element('dt', key), element('dd', display(detail)));
  }
  if (!list.childElementCount) return element('p', missing);
  return list;
}

function auditDetails(game: Json, sample: Json): HTMLElement {
  const content = element('div');
  content.className = 'audit-evidence';
  content.append(element('h4', '来源文件'));
  const sources = field(game, 'sources');
  const paths = list(field(sample, 'sourcePaths'));
  if (!paths.length) content.append(element('p', missing));
  for (const path of paths) {
    const detail = element('details');
    const summary = element('summary');
    summary.append(element('code', display(path)));
    detail.append(summary, evidence(typeof path === 'string' ? field(sources, path) : undefined));
    content.append(detail);
  }
  const columns = element('div');
  columns.className = 'stage-grid';
  for (const [key, label] of stages) {
    const stage = element('section');
    stage.append(element('h4', label), evidence(field(field(sample, 'stages'), key)));
    columns.append(stage);
  }
  content.append(columns);
  const results = list(field(sample, 'resultFiles'));
  if (results.length) {
    const files = element('ul');
    for (const result of results) files.append(element('li', display(result)));
    content.append(element('h4', '结果文件'), files);
  }
  return content;
}

export function renderAudit(value: Json): HTMLElement {
  const view = element('div');
  const rows = list(field(value, 'games')).flatMap(game =>
    list(field(game, 'samples')).filter(isObject).map(sample => {
      const fields = [field(game, 'game'), field(sample, 'purpose'), field(sample, 'verificationStatus')];
      return { game, sample, fields: fields.map(display) };
    }));
  const filters = element('div');
  filters.className = 'filters';
  const headers = ['游戏', '资源用途', '验证状态'];
  const selects = headers.map((header, index) => {
    const control = element('div');
    const label = element('label', header);
    const select = element('select');
    select.id = 'audit-filter-' + index;
    label.htmlFor = select.id;
    select.add(new Option('全部', ''));
    const choices = Array.from(new Set(rows.map(row => row.fields[index]))).sort();
    for (const choice of choices) select.add(new Option(choice, choice));
    control.append(label, select);
    filters.append(control);
    select.addEventListener('change', update);
    return select;
  });
  const count = element('p');
  count.className = 'result-count';
  count.setAttribute('role', 'status');
  const { wrapper, body } = table([...headers, '样本证据']);
  const empty = element('p', '没有符合筛选条件的样本。');
  view.append(filters, count, wrapper, empty);
  update();
  return view;

  function update() {
    const matches = rows.filter(row => selects.every((select, i) => !select.value || row.fields[i] === select.value));
    count.textContent = matches.length + ' / ' + rows.length + ' 项';
    body.replaceChildren();
    wrapper.hidden = matches.length === 0;
    empty.hidden = matches.length > 0;
    for (const { game, sample, fields } of matches) {
      const row = body.insertRow();
      for (const value of fields) row.insertCell().textContent = value;
      const name = field(sample, 'sourceName') ?? field(sample, 'role') ?? field(sample, 'purpose');
      const detailRow = body.insertRow();
      detailRow.hidden = true;
      const detailCell = detailRow.insertCell();
      detailCell.colSpan = headers.length + 1;
      const toggle = button(display(name), () => {
        detailRow.hidden = !detailRow.hidden;
        toggle.setAttribute('aria-expanded', String(!detailRow.hidden));
        if (!detailRow.hidden && !detailCell.firstChild) detailCell.append(auditDetails(game, sample));
      });
      toggle.setAttribute('aria-expanded', 'false');
      row.insertCell().append(toggle);
    }
  }
}
