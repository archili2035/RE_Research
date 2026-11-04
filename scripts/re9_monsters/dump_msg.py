import sys
from msg_parse import parse_msg

def dump(path, langs=(13, 1, 0)):
    r = parse_msg(path, 0)
    print(f"### {path.split('/')[-1]}  entries={r['entry_count']}")
    for name, content, h in r['entries']:
        # 重新解析各语言
        pass
    # 逐个语言输出
    for li in langs:
        rl = parse_msg(path, li)
        print(f"\n== lang {li} ==")
        for name, content, h in rl['entries']:
            if content.strip():
                print(f"  [{name}] {content}")

if __name__ == '__main__':
    dump(sys.argv[1])
