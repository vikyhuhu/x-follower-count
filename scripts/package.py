"""Package only reviewed extension assets; never package the parent workspace."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json

ROOT = Path(__file__).resolve().parents[1]
FILES = ("manifest.json", "data.js", "network.js", "content.js", "content.css")
version = json.loads((ROOT / "extension" / "manifest.json").read_text())["version"]
output = ROOT / "dist" / f"x-follower-count-{version}.zip"
output.parent.mkdir(exist_ok=True)
with ZipFile(output, "w", ZIP_DEFLATED) as archive:
    for name in FILES:
        archive.write(ROOT / "extension" / name, f"x-follower-count/{name}")
    archive.write(ROOT / "README.md", "x-follower-count/安装说明.md")
    archive.write(ROOT / "LICENSE", "x-follower-count/LICENSE")
print(output)
