from __future__ import annotations

import hashlib
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

TOOL = Path(__file__).resolve().parents[1] / "ai-memory"


class ProjectAliasesTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "ai-root"
        self.work = Path(self.temp.name) / "work"
        self.work.mkdir()
        self.env = {**os.environ, "AI_MEMORY_ROOT": str(self.root)}
        self.cli(
            "register",
            "--project-id",
            "one",
            "--canonical-path",
            str(self.work / "one"),
            "--aliases",
            "existing",
        )
        self.cli(
            "register",
            "--project-id",
            "two",
            "--canonical-path",
            str(self.work / "two"),
            "--aliases",
            "owned",
        )

    def cli(self, *args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
        result = subprocess.run(
            [str(TOOL), *args],
            text=True,
            capture_output=True,
            env=self.env,
            check=False,
            timeout=10,
        )
        if check and result.returncode != 0:
            self.fail(f"command failed: {args}\nstdout={result.stdout}\nstderr={result.stderr}")
        return result

    def registry_hash(self) -> str:
        data = (self.root / "projects" / "REGISTRY.md").read_bytes()
        return hashlib.sha256(data).hexdigest()

    def test_aliases_merge_deduplicate_and_resolve(self) -> None:
        result = self.cli(
            "aliases",
            "--project-id",
            "one",
            "--add-aliases",
            "Name With Space,existing,名称",
            "--expected-hash",
            self.registry_hash(),
        )
        payload = json.loads(result.stdout)
        self.assertEqual(payload["aliases"], ["existing", "Name With Space", "名称"])
        for alias in ("Name With Space", "existing", "名称"):
            resolved = self.cli(
                "hash",
                "--project",
                alias,
                "memory/MEMORY_INDEX.md",
            )
            self.assertTrue(json.loads(resolved.stdout)["exists"])
        self.cli("validate")

    def test_stale_registry_hash_is_rejected(self) -> None:
        result = self.cli(
            "aliases",
            "--project-id",
            "one",
            "--add-aliases",
            "new",
            "--expected-hash",
            "0" * 64,
            check=False,
        )
        self.assertEqual(result.returncode, 6)
        self.assertIn("CAS mismatch", result.stderr)

    def test_alias_owned_by_other_project_is_rejected(self) -> None:
        result = self.cli(
            "aliases",
            "--project-id",
            "one",
            "--add-aliases",
            "owned",
            "--expected-hash",
            self.registry_hash(),
            check=False,
        )
        self.assertEqual(result.returncode, 2)
        self.assertIn("already belongs to two", result.stderr)

    def test_registry_metacharacters_are_rejected(self) -> None:
        result = self.cli(
            "aliases",
            "--project-id",
            "one",
            "--add-aliases",
            "bad|alias",
            "--expected-hash",
            self.registry_hash(),
            check=False,
        )
        self.assertEqual(result.returncode, 2)
        self.assertIn("invalid project alias", result.stderr)


if __name__ == "__main__":
    unittest.main(verbosity=1)
