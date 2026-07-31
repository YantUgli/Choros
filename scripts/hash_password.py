"""Buat bcrypt hash untuk CHOROS_ADMIN_PASSWORD_HASH.

    python -m scripts.hash_password 'passwordmu'
"""

from __future__ import annotations

import sys

from app.security import hash_password


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 1
    print(hash_password(sys.argv[1]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
