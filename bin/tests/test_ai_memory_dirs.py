from __future__ import annotations

import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

TOOL = Path(__file__).resolve().parents[1] / "ai-memory"


class DirOpsTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "ai-root"
        self.work = Path(self.temp.name) / "work"
        self.work.mkdir()
        self.env = {**os.environ, "AI_MEMORY_ROOT": str(self.root)}
        self.cli("register", "--project-id", "one", "--canonical-path", str(self.work))
        self.cli("update-state", "--project", "one", "--slug", "a", "--text", "# A\nnext_action: x\n")
        self.cli("write", "--project", "one", "--file", "memory/designs/a/notes/n.md", "--text", "note")
        self.proj = self.root / "projects" / "one"

    def cli(self, *args: str, check: bool = True) -> subprocess.CompletedProcess:
        return subprocess.run(["python3", str(TOOL), *args], env=self.env, text=True, capture_output=True, check=check)

    def test_version_3(self) -> None:
        self.assertGreaterEqual(json.loads(self.cli("version").stdout)["version"], 3)

    def test_retire_restore_purge_roundtrip(self) -> None:
        src = self.proj / "memory" / "designs" / "a"
        out = json.loads(self.cli("retire-dir", "--project", "one", "--dir", "memory/designs/a", "--dest", "m1").stdout)
        self.assertEqual(out["files"], 2)
        self.assertFalse(src.exists())
        moved = self.proj / "inbox" / "retired" / "m1" / "a"
        self.assertEqual((moved / "notes" / "n.md").read_text(), "note\n")
        self.cli("validate")
        # 目标位置被占用时不能恢复
        self.cli("update-state", "--project", "one", "--slug", "a", "--text", "# new\nnext_action: y\n")
        busy = self.cli("restore-dir", "--project", "one", "--src", "m1/a", "--dir", "memory/designs/a", check=False)
        self.assertEqual(busy.returncode, 6)
        self.cli("retire-dir", "--project", "one", "--dir", "memory/designs/a", "--dest", "undo1")
        self.cli("restore-dir", "--project", "one", "--src", "m1/a", "--dir", "memory/designs/a")
        self.assertIn("# A", (src / "STATE.md").read_text())
        self.cli("validate")
        # 恢复后可以照常写（journal 记了 hash_after）
        h = json.loads(self.cli("hash", "--project", "one", "memory/designs/a/STATE.md").stdout)["hash"]
        self.cli("update-state", "--project", "one", "--slug", "a", "--expected-hash", h, "--text", "# A2\nnext_action: z\n")
        p = json.loads(self.cli("purge-retired", "--project", "one", "--path", "undo1").stdout)
        self.assertTrue(p["existed"])
        self.assertFalse((self.proj / "inbox" / "retired" / "undo1").exists())
        self.cli("validate")

    def test_guards(self) -> None:
        for bad in ["memory/designs", "memory/designs/a/notes", "memory/x/a", "memory/designs/../a"]:
            self.assertEqual(self.cli("retire-dir", "--project", "one", "--dir", bad, "--dest", "m", check=False).returncode, 2, bad)
        for bad in ["", "..", "../x", "a/../../x", ".hidden"]:
            self.assertNotEqual(self.cli("purge-retired", "--project", "one", "--path", bad, check=False).returncode, 0, bad)
        wrong = self.cli("retire-dir", "--project", "one", "--dir", "memory/designs/a", "--dest", "m", "--expected-hash", "0" * 64, check=False)
        self.assertEqual(wrong.returncode, 6)
        self.assertTrue((self.proj / "memory" / "designs" / "a" / "STATE.md").exists())


if __name__ == "__main__":
    unittest.main()
