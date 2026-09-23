import json
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

# 从脚本所在位置找到项目根目录
root = Path(__file__).resolve().parent.parent

# 版本号以扩展的 manifest.json 为准
manifest = json.loads(
    (root / "manifest.json").read_text(encoding="utf-8")
)
version = manifest["version"]

# 只打包扩展运行需要的文件和使用说明
files = [
    "manifest.json",
    "background.js",
    "app.html",
    "app.css",
    "app.js",
    "browser.js",
    "page.js",
    "weeks.js",
    "store.js",
    "demo.js",
    "README.md",
]

output = root / "dist" / "attendance-helper.zip"
output.parent.mkdir(exist_ok=True)

with ZipFile(output, "w", ZIP_DEFLATED) as archive:
    for name in files:
        archive.write(root / name, arcname=name)

print(f"版本：{version}")
print(f"打包完成：{output}")