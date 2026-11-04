import os, sys
from msg_parse import parse_msg

# 搜索所有 msg 文件的中文内容，匹配关键词
KEYWORDS = ['丧尸', '僵尸', '舔食', '女孩', '巨蛛', '维克多', '电锯', '厨师', '肥硕', '变异', '生物武器', '感染者', '怪物', '触手', 'Boss', 'BOSS']
base = "G:/re9_research/extract/natives/stm/message"

def main():
    hits = {}
    for root, dirs, files in os.walk(base):
        for fn in files:
            if not fn.endswith('.msg.23'):
                continue
            path = os.path.join(root, fn)
            try:
                r = parse_msg(path, 13)  # 简体中文
            except Exception as e:
                continue
            for name, content, h in r['entries']:
                if not content:
                    continue
                for kw in KEYWORDS:
                    if kw in content:
                        rel = os.path.relpath(path, base)
                        hits.setdefault(kw, []).append((rel, name, content.strip()))
                        break
    # 输出
    for kw in KEYWORDS:
        arr = hits.get(kw, [])
        if not arr:
            continue
        print(f"\n===== 关键词【{kw}】 {len(arr)} 处 =====")
        for rel, name, content in arr[:30]:
            print(f"  [{rel} / {name}] {content[:80]}")

if __name__ == '__main__':
    main()
