import { childValue, isObject, pathLabel } from './json-viewer-data';
import type { Json, Match, Path } from './json-viewer-data';

const pageSize = 50;

export function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
}

export function button(text: string, action: () => void): HTMLButtonElement {
  const node = element('button', text);
  node.type = 'button';
  node.addEventListener('click', action);
  return node;
}

export function preview(value: Json): string {
  if (Array.isArray(value)) return '数组 · ' + value.length + ' 项';
  if (isObject(value)) return '对象 · ' + Object.keys(value).length + ' 个字段';
  const text = typeof value === 'string' ? JSON.stringify(value) : String(value);
  return text.length > 140 ? text.slice(0, 140) + '…' : text;
}

export function pagination(page: number, size: number, total: number, go: (page: number) => void) {
  const pager = element('div');
  pager.className = 'pager';
  const previous = button('上一页', () => go(page - 1));
  const next = button('下一页', () => go(page + 1));
  previous.disabled = page === 0;
  next.disabled = (page + 1) * size >= total;
  pager.append(previous, element('span', (page * size + 1) + '–' + Math.min(total, (page + 1) * size) + ' / ' + total), next);
  return pager;
}

type Branch = {
  node: HTMLElement;
  select: () => void;
  reveal: (key: string | number) => Branch;
};

export function renderTree(value: Json, copy: (path: Path, raw: boolean) => void) {
  const tree = element('section');
  tree.setAttribute('aria-label', 'JSON 树');
  const toolbar = element('div');
  toolbar.className = 'node-toolbar';
  const currentPath = element('code');
  let activePath: Path = [];
  let activeRow: HTMLButtonElement | undefined;
  toolbar.append(currentPath, button('复制路径', () => copy(activePath, false)), button('复制原始值', () => copy(activePath, true)));

  function branch(value: Json, path: Path): Branch {
    const node = element('div');
    node.className = 'branch';
    const row = element('div');
    row.className = 'node-row';
    const key = path[path.length - 1];
    const title = key === undefined ? '$' : typeof key === 'number' ? '[' + key + ']' : key || '""';
    const label = button('', select);
    label.className = 'node-label';
    label.append(element('code', title), element('span', preview(value)));
    const keys = isObject(value) ? Object.keys(value) : [];
    const count = Array.isArray(value) ? value.length : keys.length;
    const children = element('div');
    children.className = 'children';
    children.hidden = true;
    let page = -1;
    let visible = new Map<string | number, Branch>();
    const toggle = button('▸', () => {
      if (children.hidden) show(page < 0 ? 0 : page);
      else setOpen(false);
    });
    toggle.className = 'node-toggle';
    setOpen(false);
    row.append(count ? toggle : element('span'), label);
    node.append(row, children);
    if (path.length === 0 && isObject(value) && count) show(0);

    function select() {
      activeRow?.removeAttribute('aria-current');
      activeRow = label;
      label.setAttribute('aria-current', 'true');
      activePath = path;
      currentPath.textContent = pathLabel(path);
    }

    function setOpen(open: boolean) {
      children.hidden = !open;
      toggle.textContent = open ? '▾' : '▸';
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', (open ? '收起 ' : '展开 ') + title);
    }

    function show(next: number) {
      setOpen(true);
      if (page === next) return;
      page = next;
      visible = new Map();
      const content = document.createDocumentFragment();
      const limit = Math.min(count, (page + 1) * pageSize);
      for (let i = page * pageSize; i < limit; i++) {
        const key = Array.isArray(value) ? i : keys[i];
        const child = branch(childValue(value, key), [...path, key]);
        visible.set(key, child);
        content.append(child.node);
      }
      if (count > pageSize) content.append(pagination(page, pageSize, count, show));
      children.replaceChildren(content);
    }

    return {
      node,
      select() {
        select();
        label.focus({ preventScroll: true });
        label.scrollIntoView({ block: 'nearest' });
      },
      reveal(key) {
        const index = typeof key === 'number' ? key : keys.indexOf(key);
        show(Math.floor(index / pageSize));
        return visible.get(key)!;
      },
    };
  }

  const root = branch(value, []);
  currentPath.textContent = '$';
  const branches = element('div');
  branches.className = 'tree-branches';
  branches.append(root.node);
  tree.append(toolbar, branches);
  return {
    node: tree,
    jump(match: Match) {
      let target = root;
      for (const key of match.path) target = target.reveal(key);
      target.select();
    },
  };
}
