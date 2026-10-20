#!/usr/bin/env python3
"""Merge hook event arrays without replacing unrelated registrations."""
import copy
import json
from pathlib import Path
import sys


def merge_hooks(existing, snippet):
    if not isinstance(existing, dict) or not isinstance(snippet, dict):
        raise ValueError('Hook settings must be JSON objects')
    result = copy.deepcopy(existing)
    for key, value in snippet.items():
        if key != 'hooks':
            if key in result and result[key] != value:
                raise ValueError('Refusing to overwrite non-hook setting: ' + key)
            result[key] = value
            continue
        if not isinstance(value, dict) or not isinstance(result.setdefault('hooks', {}), dict):
            raise ValueError('hooks must be an object')
        for event, groups in value.items():
            current = result['hooks'].setdefault(event, [])
            if not isinstance(groups, list) or not isinstance(current, list):
                raise ValueError('Hook events must be arrays')
            for group in groups:
                if group not in current:
                    current.append(copy.deepcopy(group))
    return result


if __name__ == '__main__':
    try:
        snippet, target = map(Path, sys.argv[1:])
        old = json.loads(target.read_text()) if target.exists() else {}
        merged = merge_hooks(old, json.loads(snippet.read_text()))
        text = json.dumps(merged, ensure_ascii=False, indent=2) + '\n'
        if not target.exists() or target.read_text() != text:
            target.parent.mkdir(parents=True, exist_ok=True)
            if target.is_symlink():
                raise ValueError('Refusing linked hook settings')
            import os
            import tempfile
            with tempfile.NamedTemporaryFile(mode='w', dir=target.parent, delete=False) as temporary:
                temporary.write(text)
                temporary_path = Path(temporary.name)
            try:
                temporary_path.chmod(target.stat().st_mode & 0o777 if target.exists() else 0o644)
                os.replace(temporary_path, target)
            finally:
                temporary_path.unlink(missing_ok=True)
    except (OSError, ValueError) as error:
        print('HOOK MERGE FAILED: ' + str(error), file=sys.stderr)
        raise SystemExit(1)
