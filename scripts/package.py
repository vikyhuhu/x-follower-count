"""Build local-install and Chrome Web Store archives from an explicit allowlist."""
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
for store in (False, True):
    output = ROOT / "dist" / f"x-follower-count-{version}{'-webstore' if store else ''}.zip"
    prefix = "" if store else "x-follower-count/"
    with ZipFile(output, "w") as archive:
        for name in FILES:
            put(archive, prefix + name, (ROOT / "extension" / name).read_bytes())
        put(archive, prefix + "LICENSE", (ROOT / "LICENSE").read_bytes())
        if not store:
            guide = (ROOT / "README.md").read_text().replace('src="extension/icons/', 'src="icons/')
            put(archive, prefix + "安装说明.md", guide.encode())
            put(archive, prefix + "PRIVACY.md", (ROOT / "PRIVACY.md").read_bytes())
    with ZipFile(output) as archive:
        assert archive.testzip() is None
        assert prefix + "manifest.json" in archive.namelist()
    print(output)
