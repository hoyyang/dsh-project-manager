from __future__ import annotations

import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

TOOL = Path(__file__).resolve().parents[1] / "ai-memory"


class ImportTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "ai-root"
        self.work = Path(self.temp.name) / "work"
        self.work.mkdir()
        self.env = {**os.environ, "AI_MEMORY_ROOT": str(self.root)}
        self.cli("register", "--project-id", "one", "--canonical-path", str(self.work))

    def cli(self, *args: str, check: bool = True) -> subprocess.CompletedProcess:
        return subprocess.run(["python3", str(TOOL), *args], env=self.env, text=True, capture_output=True, check=check)

    def test_version(self) -> None:
        self.assertGreaterEqual(json.loads(self.cli("version").stdout)["version"], 2)

    def test_import_binary_bytes_identical_and_journaled(self) -> None:
        src = Path(self.temp.name) / "shot.png"
        data = bytes(range(256)) * 40 + b"\x00\x01"
        src.write_bytes(data)
        out = json.loads(self.cli("import", "--project", "one", "--file", "memory/designs/s/evidence/shot.png", "--src", str(src)).stdout)
        target = Path(out["file"])
        self.assertEqual(target.read_bytes(), data)
        self.assertEqual(oct(target.stat().st_mode & 0o777), "0o444")
        self.cli("validate")
        journal = (self.root / "projects" / "one" / "log" / "events.jsonl").read_text().splitlines()
        self.assertEqual(json.loads(journal[-1])["op"], "import")
        again = self.cli("import", "--project", "one", "--file", "memory/designs/s/evidence/shot.png", "--src", str(src), check=False)
        self.assertEqual(again.returncode, 6)
        bad = self.cli("import", "--project", "one", "--file", "memory/../../x", "--src", str(src), check=False)
        self.assertNotEqual(bad.returncode, 0)


if __name__ == "__main__":
    unittest.main()
