"""Build one archive for local installation and Chrome Web Store upload from an explicit allowlist."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED, ZipInfo
import json

ROOT = Path(__file__).resolve().parents[1]
manifest = json.loads((ROOT / "extension" / "manifest.json").read_text())
FILES = ("manifest.json", "runtime.js", "data.js", "network.js", "content.js", "content.css", "history.js", "card.js", "background.js", "popup.html", "popup.js", "popup.css", "privacy.html", *sorted(set(manifest["icons"].values())))
version = manifest["version"]
(ROOT / "dist").mkdir(exist_ok=True)
def put(archive, name, content):
    info = ZipInfo(name, (2026, 10, 10, 0, 0, 0))
    info.compress_type = ZIP_DEFLATED
    info.external_attr = 0o644 << 16
    archive.writestr(info, content)
output = ROOT / "dist" / f"x-follower-count-{version}.zip"
with ZipFile(output, "w") as archive:
    for name in FILES:
        put(archive, name, (ROOT / "extension" / name).read_bytes())
    put(archive, "LICENSE", (ROOT / "LICENSE").read_bytes())
with ZipFile(output) as archive:
    assert archive.testzip() is None
    assert set(archive.namelist()) == {*FILES, "LICENSE"}
    assert "manifest.json" in archive.namelist()
print(output)
