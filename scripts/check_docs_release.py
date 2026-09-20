"""Deploy release documentation only after both package versions are public."""

from collections.abc import Callable
import json
import os
from pathlib import Path
from urllib.error import URLError
from urllib.parse import quote
from urllib.request import urlopen


def fetch_json(url: str) -> object:
    with urlopen(url, timeout=15) as response:
        return json.load(response)


def packages_available(
    npm_version: str, python_version: str, fetch: Callable[[str], object] = fetch_json
) -> bool:
    """Require exact metadata matches from both public registries."""
    try:
        npm = fetch(f"https://registry.npmjs.org/tywrap/{quote(npm_version, safe='')}")
        python = fetch(
            f"https://pypi.org/pypi/tywrap-ir/{quote(python_version, safe='')}/json"
        )
    except (URLError, TimeoutError, ValueError, OSError):
        return False
    return (
        isinstance(npm, dict)
        and npm.get("version") == npm_version
        and isinstance(npm.get("dist"), dict)
        and isinstance(npm["dist"].get("tarball"), str)
        and bool(npm["dist"]["tarball"])
        and isinstance(python, dict)
        and isinstance(python.get("info"), dict)
        and python["info"].get("version") == python_version
        and isinstance(python.get("urls"), list)
        and any(
            isinstance(file, dict)
            and file.get("yanked") is False
            and file.get("packagetype") in {"bdist_wheel", "sdist"}
            and isinstance(file.get("url"), str)
            and bool(file["url"])
            for file in python["urls"]
        )
    )


def main() -> None:
    import tomllib

    root = Path(__file__).resolve().parent.parent
    npm_version = json.loads((root / "package.json").read_text())["version"]
    python_project = tomllib.loads((root / "tywrap_ir/pyproject.toml").read_text())
    python_version = python_project["project"]["version"]
    available = packages_available(npm_version, python_version)
    result = f"available={str(available).lower()}\n"
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
            output.write(result)
    print(result.strip())
    if not available:
        print("Docs deployment waits for both public packages.")
        print("Run the docs workflow after publication.")


if __name__ == "__main__":
    main()
