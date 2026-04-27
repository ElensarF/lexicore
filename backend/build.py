# Bu dosya LexiCore uygulamasini Windows icin paketler.
# Kullanim: python backend/build.py

import os

import PyInstaller.__main__


backend_dir = os.path.dirname(os.path.abspath(__file__))
project_dir = os.path.dirname(backend_dir)
spec_file = os.path.join(project_dir, "LexiCore.spec")
pyinstaller_dist_dir = os.path.join(backend_dir, "backend_dist")
pyinstaller_work_dir = os.path.join(backend_dir, "pyinstaller_build")

print(f"Building with spec: {spec_file}")
print(f"Output directory: {pyinstaller_dist_dir}")

PyInstaller.__main__.run(
    [
        spec_file,
        f"--distpath={pyinstaller_dist_dir}",
        f"--workpath={pyinstaller_work_dir}",
        "--clean",
        "--noconfirm",
    ]
)
