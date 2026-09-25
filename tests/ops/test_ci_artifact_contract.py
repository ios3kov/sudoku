"""Regression contract for cross-job artifacts in GitHub Actions."""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


class CiArtifactContract(unittest.TestCase):
    def test_openmls_artifact_survives_targeted_job_reruns(self):
        workflow = (ROOT / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8")
        names = re.findall(r"name: (mls-wasm-[^\\n]+)", workflow)
        self.assertEqual(names, ["mls-wasm-${{ github.run_id }}"] * 3)
        self.assertNotIn(
            "mls-wasm-${{ github.run_id }}-${{ github.run_attempt }}",
            workflow,
        )
        upload_start = workflow.index("- name: Retain generated OpenMLS browser package")
        upload_end = workflow.index("- name: Rust dependency audit", upload_start)
        upload = workflow[upload_start:upload_end]
        self.assertIn("overwrite: true", upload)


if __name__ == "__main__":
    unittest.main()
