#!/usr/bin/env python3
"""Read a VS Code JSONC object, retaining strings and rejecting invalid input."""
import json
import re
import sys
from pathlib import Path


def read_jsonc(text):
    # Match strings before comments so URL and comment-like string content survives.
    token = re.compile(r'"(?:[^"\\]|\\.)*"|//[^\r\n]*|/\*[\s\S]*?\*/')
    clean = token.sub(lambda m: m[0] if m[0].startswith('"') else ' ', text)
    clean = re.sub(r'"(?:[^"\\]|\\.)*"|,(\s*[}\]])',
                   lambda m: m[0] if m[0].startswith('"') else m[1], clean)
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError(f'Duplicate setting: {key}')
            result[key] = value
        return result
    result = json.loads(clean, object_pairs_hook=unique)
    if not isinstance(result, dict):
        raise ValueError('Settings must be a JSON object')
    return result


if __name__ == '__main__':
    try:
        print(json.dumps(read_jsonc(Path(sys.argv[1]).read_text(encoding='utf-8-sig')), indent=2))
    except (ValueError, OSError, IndexError) as error:
        sys.exit(f'Cannot parse settings; no settings changed: {error}')
