export type Json = null | boolean | number | string | Json[] | JsonObject;
export type JsonObject = { [key: string]: Json | undefined };
export type Path = readonly (string | number)[];
export type SearchScope = 'both' | 'key' | 'value';

export const feelGroups = [
  ['movement', '运动'], ['camera', '镜头'], ['actions', '动作'],
] as const;
export const feelFields = ['value', 'source', 'evidence', 'conditions'] as const;

export function isObject(value: Json | undefined): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function field(value: Json | undefined, key: string): Json | undefined {
  return isObject(value) && Object.hasOwn(value, key) ? value[key] : undefined;
}

export function detectView(value: Json): 'feel' | 'audit' | 'tree' {
  const games = field(value, 'games');
  if (Array.isArray(games) && games.some(game => {
    const samples = field(game, 'samples');
    return Array.isArray(samples) && samples.some(sample =>
      (typeof field(sample, 'purpose') === 'string' && typeof field(game, 'game') === 'string') ||
      (isObject(field(sample, 'stages')) &&
        (typeof field(sample, 'verificationStatus') === 'string' || Array.isArray(field(sample, 'sourcePaths')))));
  })) return 'audit';

  if (feelGroups.some(([key]) => {
    const group = field(value, key);
    return isObject(group) && Object.values(group).some(parameter =>
      isObject(parameter) && feelFields.slice(1).some(name => Object.hasOwn(parameter, name)));
  })) return 'feel';

  return 'tree';
}

export function pathLabel(path: Path): string {
  return '$' + path.map(key => {
    if (typeof key === 'number') return '[' + key + ']';
    return /^[A-Za-z_$][\w$]*$/.test(key) ? '.' + key : '[' + JSON.stringify(key) + ']';
  }).join('');
}

export function childKeys(value: Json): (string | number)[] {
  if (Array.isArray(value)) return value.map((_, i) => i);
  return isObject(value) ? Object.keys(value) : [];
}

export function childValue(value: Json, key: string | number): Json {
  return Array.isArray(value) ? value[Number(key)] : (value as JsonObject)[key]!;
}

export type Match = { path: Path; value: Json };

export function search(value: Json, query: string, scope: SearchScope): Match[] {
  const needle = query.toLowerCase();
  const matches: Match[] = [];
  const path: (string | number)[] = [];
  const stack = [{ value, keys: childKeys(value), next: 0 }];

  function record(node: Json, key?: string | number) {
    const keyMatches = scope !== 'value' && typeof key === 'string' && key.toLowerCase().includes(needle);
    const valueMatches = scope !== 'key' && (node === null || typeof node !== 'object') &&
      String(node).toLowerCase().includes(needle);
    if (keyMatches || valueMatches) {
      matches.push({ path: path.slice(), value: node });
    }
  }

  record(value);
  while (stack.length) {
    const frame = stack[stack.length - 1];
    if (frame.next === frame.keys.length) {
      stack.pop();
      path.pop();
      continue;
    }
    const key = frame.keys[frame.next++];
    const node = childValue(frame.value, key);
    path.push(key);
    record(node, key);
    if (node !== null && typeof node === 'object') {
      stack.push({ value: node, keys: childKeys(node), next: 0 });
    } else {
      path.pop();
    }
  }
  return matches;
}

// The document has already passed JSON.parse. Scan the selected branch only when
// copying, so spaces, escapes and numeric precision come from the original text.
export function rawValue(source: string, path: Path): string {
  const tokens = /"(?:\\[\s\S]|[^"\\])*"|[{}\[\],:]|[^"{}\[\],:\t\r\n ]+/g;
  const first = tokens.exec(source)!;
  let start = first.index;
  let end = source.trimEnd().length;

  function skipValue(token: string) {
    let depth = token === '{' || token === '[' ? 1 : 0;
    while (depth > 0) {
      const next = tokens.exec(source)![0];
      if (next === '{' || next === '[') depth++;
      if (next === '}' || next === ']') depth--;
    }
  }

  for (const segment of path) {
    tokens.lastIndex = start + 1;
    let next = tokens.exec(source)!;
    for (let index = 0; next[0] !== ']' && next[0] !== '}'; index++) {
      let key: string | number = index;
      if (typeof segment === 'string') {
        key = JSON.parse(next[0]) as string;
        tokens.exec(source); // colon
        next = tokens.exec(source)!;
      }
      skipValue(next[0]);
      if (key === segment) {
        start = next.index;
        end = tokens.lastIndex;
        if (typeof segment === 'number') break;
      }
      if (tokens.exec(source)![0] !== ',') break;
      next = tokens.exec(source)!;
    }
  }
  return source.slice(start, end);
}

export function parseError(error: unknown, source: string): string {
  const message = error instanceof Error ? error.message : String(error);
  if (!source.trim()) return '没有可解析的 JSON 内容。';
  const location = /line (\d+)\s+column (\d+)/i.exec(message);
  const position = /position (\d+)/i.exec(message);
  let where = '';
  if (location) {
    where = '（第 ' + location[1] + ' 行，第 ' + location[2] + ' 列）';
  } else if (position || /unexpected end/i.test(message)) {
    const lines = source.slice(0, position ? Number(position[1]) : source.length).split(/\r\n|\n|\r/);
    where = '（第 ' + lines.length + ' 行，第 ' + (lines[lines.length - 1].length + 1) + ' 列）';
  }
  return '无法解析 JSON' + where + '。请检查引号、逗号和括号。' + message;
}
