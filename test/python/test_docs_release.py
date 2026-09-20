"""Check that missing or invalid registry metadata cannot permit deployment."""

import importlib.util
from pathlib import Path
import unittest
from urllib.error import HTTPError, URLError

_script = Path(__file__).resolve().parents[2] / "scripts/check_docs_release.py"
_spec = importlib.util.spec_from_file_location("check_docs_release", _script)
assert _spec is not None and _spec.loader is not None
gate = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(gate)


NPM = {
    "version": "0.11.0",
    "dist": {"tarball": "https://registry.npmjs.org/tywrap/-/tywrap-0.11.0.tgz"},
}
PYPI = {"info": {"version": "0.3.1"}, "urls": [{
    "yanked": False,
    "packagetype": "bdist_wheel",
    "url": "https://files.pythonhosted.org/package.whl",
}]}


class DocsReleaseTests(unittest.TestCase):
    def test_requires_both_exact_versions(self) -> None:
        calls = []

        def fetch(url: str) -> object:
            calls.append(url)
            return NPM if len(calls) == 1 else PYPI

        self.assertTrue(gate.packages_available("0.11.0", "0.3.1", fetch))
        self.assertEqual(calls, [
            "https://registry.npmjs.org/tywrap/0.11.0",
            "https://pypi.org/pypi/tywrap-ir/0.3.1/json",
        ])

    def test_missing_either_package_blocks(self) -> None:
        for missing in ("npmjs", "pypi"):
            with self.subTest(missing=missing):
                def fetch(url: str) -> object:
                    if missing in url:
                        raise HTTPError(url, 404, "Not Found", {}, None)
                    return NPM if "npmjs" in url else PYPI

                self.assertFalse(gate.packages_available("0.11.0", "0.3.1", fetch))

    def test_wrong_or_malformed_metadata_blocks(self) -> None:
        for npm, python in [
            ({**NPM, "version": "0.10.0"}, PYPI),
            (NPM, {**PYPI, "info": {"version": "0.3.0"}}),
            ([], PYPI),
            (NPM, {"info": []}),
            ({"version": "0.11.0"}, PYPI),
            (NPM, {**PYPI, "urls": []}),
            (NPM, {**PYPI, "urls": [{**PYPI["urls"][0], "yanked": True}]}),
        ]:
            with self.subTest(npm=npm, python=python):
                responses = iter([npm, python])
                self.assertFalse(
                    gate.packages_available("0.11.0", "0.3.1", lambda _: next(responses))
                )

    def test_registry_failure_blocks(self) -> None:
        errors = (URLError("unavailable"), TimeoutError(), ValueError("invalid JSON"))
        for error in errors:
            with self.subTest(error=error):
                def fetch(_: str) -> object:
                    raise error

                self.assertFalse(gate.packages_available("0.11.0", "0.3.1", fetch))


if __name__ == "__main__":
    unittest.main()
