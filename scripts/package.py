"""Package only reviewed extension assets; never package the parent workspace."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json

ROOT = Path(__file__).resolve().parents[1]
manifest = json.loads((ROOT / "extension" / "manifest.json").read_text())
FILES = ("manifest.json", "data.js", "network.js", "content.js", "content.css", *sorted(set(manifest["icons"].values())))
version = manifest["version"]
output = ROOT / "dist" / f"x-follower-count-{version}.zip"
output.parent.mkdir(exist_ok=True)
with ZipFile(output, "w", ZIP_DEFLATED) as archive:
    for name in FILES:
        archive.write(ROOT / "extension" / name, f"x-follower-count/{name}")
    guide = (ROOT / "README.md").read_text().replace('src="extension/icons/', 'src="icons/')
    archive.writestr("x-follower-count/安装说明.md", guide.encode("utf-8"))
    archive.write(ROOT / "LICENSE", "x-follower-count/LICENSE")
print(output)
