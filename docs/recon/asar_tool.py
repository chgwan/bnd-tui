#!/usr/bin/env python3
"""Minimal ASAR archive tool: list / extract. Read-only w.r.t. the archive."""
import struct, json, os, sys

def read_header(path):
    with open(path, 'rb') as f:
        f0, A, B, C = struct.unpack('<4I', f.read(16))
        tree = json.loads(f.read(C).decode('utf-8', 'replace'))
        data_base = 8 + A  # == 16 + C + padding to 4-byte alignment
    return tree, data_base

def files_under(node, prefix=''):
    """Yield (path, offset, size) for every file."""
    files = node.get('files', {})
    for name, ent in files.items():
        p = prefix + '/' + name if prefix else name
        if 'files' in ent:
            yield from files_under(ent, p)
        else:
            yield p, int(ent.get('offset', 0)), int(ent.get('size', 0))

def cmd_list(path, pattern=None):
    tree, base = read_header(path)
    total = 0
    for p, off, size in files_under(tree):
        total += 1
        if pattern is None or pattern.lower() in p.lower():
            print(f'{size:>12}  {p}')
    print(f'-- {total} files total', file=sys.stderr)

def cmd_extract(path, pattern, outdir):
    tree, base = read_header(path)
    n = 0
    with open(path, 'rb') as f:
        for p, off, size in files_under(tree):
            if pattern.lower() not in p.lower():
                continue
            dest = os.path.join(outdir, p)
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            f.seek(base + off)
            blob = f.read(size)
            with open(dest, 'wb') as g:
                g.write(blob)
            n += 1
    print(f'extracted {n} files matching {pattern!r} -> {outdir}')

if __name__ == '__main__':
    cmd = sys.argv[1]
    if cmd == 'list':
        cmd_list(sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else None)
    elif cmd == 'extract':
        cmd_extract(sys.argv[2], sys.argv[3], sys.argv[4])
    else:
        sys.exit('usage: asar_tool.py list <asar> [pattern] | extract <asar> <pattern> <outdir>')
