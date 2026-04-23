#!/usr/bin/env python3
"""
Vault Integrity Diagnostic Tool
================================
Checks all vaults in ssh-vault-tauri storage for structural integrity.
Run with: python3 scripts/vault-diagnostic.py

Exit codes:
  0 = all vaults OK
  1 = corrupted vaults found (run with --fix to delete them)
  2 = error accessing vault store
"""

import json
import base64
import sys
import os
from pathlib import Path

VAULT_PATH = Path.home() / "Library/Application Support/com.sshvault.desktop/vaults.db"


def get_vaults() -> list:
    if not VAULT_PATH.exists():
        print(f"ERROR: Vault store not found at {VAULT_PATH}")
        print("       Has the app ever been started?")
        sys.exit(2)

    with open(VAULT_PATH) as f:
        d = json.load(f)

    vaults = d.get("vaults", [])
    if not vaults:
        print("No vaults found.")
        sys.exit(0)

    return vaults


def analyze_vault(vault: dict) -> dict:
    """Return structural analysis of a vault's ciphertext."""
    ct = vault.get("ciphertext", "")
    result = {
        "id": vault.get("id", "?"),
        "name": vault.get("name", "?"),
        "base64_len": len(ct),
        "raw_bytes": None,
        "raw_len": None,
        "is_valid_base64": True,
        "is_too_small": False,
        "note": "",
    }

    # Test base64 decoding
    try:
        raw = base64.b64decode(ct)
        result["raw_bytes"] = raw
        result["raw_len"] = len(raw)
        result["is_valid_base64"] = True
    except Exception:
        result["is_valid_base64"] = False
        result["raw_len"] = 0
        result["note"] = "INVALID BASE64 — data is corrupted or truncated"
        return result

    # Check structural validity
    # AES-256-GCM: 12-byte nonce + N-byte ciphertext + 16-byte auth tag
    # Minimum valid: 12 + 0 + 16 = 28 bytes (theoretically — practically at least 29)
    ABSOLUTE_MIN = 28

    if result["raw_len"] < ABSOLUTE_MIN:
        result["is_too_small"] = True
        result["note"] = (
            f"CIPHERTEXT TOO SHORT: {result['raw_len']} bytes "
            f"(minimum {ABSOLUTE_MIN} = 12-nonce + 0-ct + 16-tag)"
        )
    elif result["raw_len"] < 50:
        # Suspiciously small — likely truncated but not technically invalid
        result["note"] = (
            f"SUSPICIOUSLY SMALL: {result['raw_len']} bytes "
            "(valid but unusually small — possible early truncation)"
        )
    else:
        result["note"] = f"OK — {result['raw_len']} bytes"

    return result


def print_report(results: list):
    ok = [r for r in results if r["is_valid_base64"] and not r["is_too_small"]]
    corrupt = [r for r in results if not r["is_valid_base64"] or r["is_too_small"]]
    suspicious = [
        r
        for r in results
        if r["is_valid_base64"]
        and not r["is_too_small"]
        and "SUSPICIOUSLY" in r["note"]
    ]

    print("=" * 60)
    print("SSH-VAULT TAURI — Vault Integrity Report")
    print("=" * 60)
    print(f"Store: {VAULT_PATH}")
    print(f"Total vaults: {len(results)}")
    print()

    for r in results:
        status = "OK" if (r["is_valid_base64"] and not r["is_too_small"]) else "CORRUPT"
        mark = "✓" if status == "OK" else "✗"
        print(f"  [{mark}] {r['name']!r}")
        print(f"       id:    {r['id']}")
        print(f"       b64:   {r['base64_len']} chars → {r['raw_len']} bytes")
        print(f"       note:  {r['note']}")
        print()

    print("-" * 60)
    print(f"  OK:         {len(ok)}")
    print(f"  CORRUPT:    {len(corrupt)}")
    print(f"  SUSPICIOUS: {len(suspicious)}")
    print("-" * 60)

    if corrupt:
        print()
        print("⚠️  CORRUPTED VAULTS DETECTED")
        print("   These vaults have unreadable or truncated ciphertext.")
        print("   They CANNOT be decrypted — the stored data is invalid.")
        print()
        print("   To fix: Close the app, then run:")
        print(f"            python3 scripts/vault-diagnostic.py --fix")
        print()
        print("   Or manually edit: ~/Library/Application Support/com.sshvault.desktop/vaults.db")
        return 1
    elif suspicious:
        print("\nℹ️  All vaults are technically valid, but some are suspiciously small.")
        return 0
    else:
        print("\n✓ All vaults are structurally valid.")
        return 0


def fix_corrupted():
    """Delete all vaults with invalid or truncated ciphertext."""
    vaults = get_vaults()
    bad = []

    for v in vaults:
        ct = v.get("ciphertext", "")
        try:
            raw = base64.b64decode(ct)
            if len(raw) < 28:
                bad.append(v)
            else:
                # Valid base64 and large enough
                pass
        except Exception:
            bad.append(v)

    if not bad:
        print("No corrupted vaults found — nothing to fix.")
        sys.exit(0)

    print(f"Deleting {len(bad)} corrupted vault(s):")
    for v in bad:
        print(f"  ✗ {v.get('name', '?')!r} ({v.get('id', '?')})")

    # Rewrite vaults.db without the bad ones
    with open(VAULT_PATH) as f:
        d = json.load(f)

    bad_ids = {v["id"] for v in bad}
    d["vaults"] = [v for v in d.get("vaults", []) if v.get("id") not in bad_ids]

    bak_path = VAULT_PATH.with_suffix(".db.bak")
    with open(bak_path, "w") as f:
        json.dump(d, f, indent=2)

    with open(VAULT_PATH, "w") as f:
        json.dump(d, f, indent=2)

    print(f"\n✓ Removed {len(bad)} vault(s). Backup: {bak_path}")
    print("✓ Vault store updated. Restart the app.")


if __name__ == "__main__":
    if "--fix" in sys.argv:
        fix_corrupted()
    else:
        vaults = get_vaults()
        results = [analyze_vault(v) for v in vaults]
        exit_code = print_report(results)
        sys.exit(exit_code)
