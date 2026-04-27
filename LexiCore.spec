# -*- mode: python ; coding: utf-8 -*-
import os
import sys

from PyInstaller.utils.hooks import collect_data_files, collect_dynamic_libs, copy_metadata


project_dir = os.path.dirname(os.path.abspath(SPEC))
backend_dir = os.path.join(project_dir, "backend")
main_py = os.path.join(backend_dir, "main.py")
frontend_dist_dir = os.path.join(project_dir, "dist")
dlls_path = os.path.join(os.path.dirname(sys.executable), "DLLs")

datas = []
if os.path.exists(frontend_dist_dir):
    datas.append((frontend_dist_dir, "frontend_dist"))
if os.path.exists(dlls_path):
    datas.append((dlls_path, "DLLs"))

for package_name in ("transformers", "torch", "huggingface_hub", "regex", "sentencepiece", "tokenizers", "llama_cpp", "hf_xet"):
    try:
        datas += copy_metadata(package_name)
    except Exception:
        pass

binaries = []
for package_name in ("llama_cpp", "sentencepiece", "hf_xet"):
    try:
        datas += collect_data_files(package_name)
        binaries += collect_dynamic_libs(package_name)
    except Exception:
        pass

hiddenimports = [
    "uvicorn",
    "fastapi",
    "pydantic",
    "_ssl",
    "ssl",
    "ctranslate2",
    "transformers",
    "sentencepiece",
    "torch",
    "llama_cpp",
    "hf_xet",
    "PyQt6",
    "PyQt6.QtCore",
    "PyQt6.QtGui",
    "PyQt6.QtWidgets",
    "PyQt6.QtWebEngineWidgets",
    "PyQt6.QtWebEngineCore",
]


a = Analysis(
    [main_py],
    pathex=[backend_dir],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="LexiCore",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="LexiCore",
)
