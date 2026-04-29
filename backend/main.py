import os
import sys
import shutil
import threading
import json
import time
import base64
import html
import io
import re
import uuid
import urllib.parse
import urllib.error
import urllib.request
import zipfile
import xml.etree.ElementTree as ET
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Lazy loading - PyTorch ve Transformers'i en basta import ETMEYECEGIZ
# Bu sayede EXE acilisinda yasanan WinError 1114 (c10.dll) hatasinin onune gecmis olacagiz.
# Bu moduller sadece ve sadece cevir butonuna ilk kez basildiginda yuklenecek.

# --- MODEL INDIRME DIZININI DEGISTIRME ---
if getattr(sys, 'frozen', False):
    # PyInstaller ile calisiyorsa, exe'nin oldugu klasorde "models" klasoru olustur
    exe_dir = os.path.dirname(sys.executable)
    custom_cache_dir = os.path.join(exe_dir, "models")
else:
    # Dev modunda backend/models icine at
    custom_cache_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models")
    
os.makedirs(custom_cache_dir, exist_ok=True)
os.environ["HF_HOME"] = custom_cache_dir
os.environ["HUGGINGFACE_HUB_CACHE"] = os.path.join(custom_cache_dir, "hub")
os.environ["TRANSFORMERS_CACHE"] = os.path.join(custom_cache_dir, "hub")
os.environ["HF_XET_CACHE"] = os.path.join(custom_cache_dir, "xet")
# ------------------------------------------

app = FastAPI(title="LexiCore Local Translation API")

# Enable CORS for React frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

hf_download_lock = threading.Lock()
hf_download_jobs = {}

def _validate_hf_repo_id(repo_id: str):
    repo_id = repo_id.strip()
    if not repo_id or len(repo_id) > 200:
        raise ValueError("Gecersiz repo_id.")
    if "/" not in repo_id:
        raise ValueError("repo_id 'owner/name' formatinda olmali.")
    if ".." in repo_id or repo_id.startswith("/") or repo_id.endswith("/"):
        raise ValueError("Gecersiz repo_id.")
    return repo_id

def _validate_hf_filename(filename: str):
    filename = filename.strip().lstrip("/")
    if not filename or len(filename) > 400:
        raise ValueError("Gecersiz dosya adi.")
    if ".." in filename:
        raise ValueError("Gecersiz dosya adi.")
    return filename

def _hf_resolve_url(repo_id: str, filename: str, revision: str):
    repo_id = urllib.parse.quote(repo_id, safe="/")
    filename = urllib.parse.quote(filename, safe="/")
    revision = urllib.parse.quote(revision or "main", safe="")
    return f"https://huggingface.co/{repo_id}/resolve/{revision}/{filename}"

class TranslationRequest(BaseModel):
    text: str
    source_lang: str
    target_lang: str
    quality: str = "fast" # "fast" (Opus-MT), "high" (NLLB) veya "ultra" (Aya-23)

class CloudTranslationRequest(BaseModel):
    text: str
    source_lang: str
    target_lang: str
    provider: str
    api_key: str

class WordAlternativesRequest(BaseModel):
    word: str
    sentence: str = ""
    source_text: str = ""
    token_index: int = -1
    source_lang: str = ""
    target_lang: str
    quality: str = "fast"
    provider: str = ""
    api_key: str = ""

class HFRepoFilesRequest(BaseModel):
    repo_id: str
    revision: str = "main"

class HFDownloadRequest(BaseModel):
    repo_id: str
    filename: str
    revision: str = "main"

class DetectLanguageRequest(BaseModel):
    text: str

class FileTextRequest(BaseModel):
    filename: str
    content_base64: str

class ClipboardWriteRequest(BaseModel):
    text: str

class ClipboardShortcutRequest(BaseModel):
    shortcut: str

VALID_CLIPBOARD_SHORTCUTS = {"ctrl_c_c", "ctrl_shift_c", "ctrl_alt_c", "disabled"}
clipboard_shortcut = "ctrl_c_c"
clipboard_shortcut_lock = threading.Lock()
clipboard_capture_lock = threading.Lock()
clipboard_capture_state = {
    "version": 0,
    "text": "",
    "updatedAt": 0.0,
    "error": "",
}
keyboard_hook_started = False
keyboard_hook_proc = None

DEEPL_TARGET_MAP = {
    "en": "EN-US",
    "pt": "PT-PT",
    "zh": "ZH-HANS",
}

DEEPL_SOURCE_MAP = {
    "zh": "ZH",
}

TEXT_FILE_EXTENSIONS = {
    ".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".jsonl", ".xml", ".html", ".htm",
    ".log", ".srt", ".vtt", ".yaml", ".yml", ".ini", ".cfg", ".conf", ".py", ".js", ".jsx",
    ".ts", ".tsx", ".css", ".scss", ".less", ".sql", ".toml", ".po", ".properties",
}

ARCHIVE_TEXT_EXTENSIONS = {".docx", ".pptx", ".xlsx", ".odt", ".ods", ".odp"}
RICH_TEXT_EXTENSIONS = {".rtf"}
PDF_EXTENSIONS = {".pdf"}
SUPPORTED_FILE_EXTENSIONS = TEXT_FILE_EXTENSIONS | ARCHIVE_TEXT_EXTENSIONS | RICH_TEXT_EXTENSIONS | PDF_EXTENSIONS

FALLBACK_ALTERNATIVES = {
    "tr": {
        "merhaba": ["selam", "hey", "esenlikler"],
        "dünya": ["alem", "yeryüzü", "gezegen"],
        "iyi": ["güzel", "olumlu", "uygun"],
        "kötü": ["olumsuz", "fena", "zayıf"],
        "güzel": ["hoş", "iyi", "zarif"],
        "büyük": ["geniş", "iri", "önemli"],
        "küçük": ["ufak", "minik", "az"],
        "hızlı": ["çabuk", "süratli", "seri"],
        "yavaş": ["ağır", "sakin", "düşük tempolu"],
        "doğru": ["uygun", "isabetli", "gerçek"],
        "yanlış": ["hatalı", "kusurlu", "isabetsiz"],
        "önemli": ["kritik", "değerli", "öncelikli"],
        "metin": ["yazı", "içerik", "paragraf"],
        "sonuç": ["çıktı", "netice", "cevap"],
        "çeviri": ["tercüme", "aktarim", "dil aktarımı"],
        "kullan": ["uygula", "çalıştır", "değerlendir"],
        "gönder": ["ilet", "yolla", "aktar"],
        "al": ["edin", "çek", "kabul et"],
        "ver": ["sun", "sağla", "ilet"],
        "bak": ["incele", "göz at", "kontrol et"],
    },
    "en": {
        "hello": ["hi", "hey", "greetings"],
        "world": ["earth", "globe", "realm"],
        "good": ["great", "fine", "positive"],
        "bad": ["poor", "negative", "wrong"],
        "fast": ["quick", "rapid", "swift"],
        "slow": ["gradual", "delayed", "unhurried"],
        "important": ["critical", "key", "essential"],
        "text": ["copy", "content", "passage"],
        "result": ["output", "answer", "outcome"],
        "translate": ["render", "convert", "interpret"],
        "use": ["apply", "run", "employ"],
        "send": ["submit", "deliver", "forward"],
    },
}

def post_json(url: str, payload: dict, headers: dict, timeout: int = 45):
    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        headers={**headers, "Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            response_body = response.read().decode("utf-8")
            return response.status, json.loads(response_body)
    except urllib.error.HTTPError as error:
        error_body = error.read().decode("utf-8", errors="replace")
        try:
            parsed_error = json.loads(error_body)
        except json.JSONDecodeError:
            parsed_error = {"message": error_body}
        return error.code, parsed_error
    except urllib.error.URLError as error:
        raise HTTPException(status_code=502, detail=f"Dis ceviri servisine baglanilamadi: {error.reason}")

def format_bytes(size: int):
    units = ["B", "KB", "MB", "GB", "TB"]
    value = float(size)
    for unit in units:
        if value < 1024 or unit == units[-1]:
            return f"{value:.1f} {unit}" if unit != "B" else f"{int(value)} B"
        value /= 1024

def get_directory_stats(path: str):
    total_size = 0
    file_count = 0

    if not os.path.exists(path):
        return total_size, file_count

    for root, _, files in os.walk(path):
        for file_name in files:
            file_path = os.path.join(root, file_name)
            try:
                total_size += os.path.getsize(file_path)
                file_count += 1
            except OSError:
                continue

    return total_size, file_count

def parse_openai_alternatives(content: str):
    cleaned = content.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        cleaned = cleaned.removeprefix("json").strip()

    try:
        parsed = json.loads(cleaned)
        alternatives = parsed.get("alternatives", [])
        return [str(item).strip() for item in alternatives if str(item).strip()]
    except json.JSONDecodeError:
        return [
            item.strip(" -•\t")
            for item in cleaned.replace("\n", ",").split(",")
            if item.strip(" -•\t")
        ]

def fallback_alternatives(word: str, target_lang: str):
    normalized = word.strip(".,;:!?()[]{}\"'’").lower()
    return FALLBACK_ALTERNATIVES.get(target_lang, {}).get(normalized, [])

def detect_language(text: str):
    sample = text.strip()[:4000]
    if not sample:
        return {"language": "en", "confidence": 0.0}

    script_checks = [
        ("ja", r"[\u3040-\u30ff]"),
        ("ko", r"[\uac00-\ud7af]"),
        ("zh", r"[\u4e00-\u9fff]"),
        ("ar", r"[\u0600-\u06ff]"),
        ("ru", r"[\u0400-\u04ff]"),
        ("el", r"[\u0370-\u03ff]"),
        ("hi", r"[\u0900-\u097f]"),
    ]
    for language, pattern in script_checks:
        if re.search(pattern, sample):
            return {"language": language, "confidence": 0.98}

    lowered = sample.lower()
    words = re.findall(r"[a-zA-ZÇĞİÖŞÜçğıiöşüáéíóúñäöüßæøå]+", lowered)

    if re.search(r"[çğıöşü]", lowered):
        return {"language": "tr", "confidence": 0.92}

    language_markers = {
        "tr": {"ve", "bir", "bu", "için", "ile", "de", "da", "olarak", "çok", "daha", "ben", "sen"},
        "en": {"the", "and", "is", "are", "this", "that", "with", "for", "you", "your", "not", "have"},
        "de": {"der", "die", "das", "und", "ist", "nicht", "mit", "für", "ein", "eine", "ich", "sie"},
        "fr": {"le", "la", "les", "des", "une", "est", "avec", "pour", "que", "dans", "vous", "pas"},
        "es": {"el", "la", "los", "las", "una", "que", "con", "para", "por", "como", "está", "usted"},
        "it": {"il", "la", "gli", "che", "con", "per", "non", "sono", "come", "una", "del", "della"},
        "pt": {"o", "a", "os", "as", "que", "com", "para", "por", "não", "uma", "você", "está"},
        "nl": {"de", "het", "een", "en", "van", "voor", "met", "niet", "dat", "zijn", "jij", "u"},
        "pl": {"i", "w", "na", "nie", "jest", "się", "to", "dla", "oraz", "jak", "czy", "po"},
        "sv": {"och", "det", "att", "inte", "som", "för", "med", "jag", "du", "en", "ett", "är"},
        "da": {"og", "det", "at", "ikke", "som", "for", "med", "jeg", "du", "en", "et", "er"},
        "fi": {"ja", "on", "ei", "se", "että", "kun", "minä", "sinä", "kanssa", "tämä", "ovat"},
    }

    scores = {language: 0 for language in language_markers}
    for word in words:
        for language, markers in language_markers.items():
            if word in markers:
                scores[language] += 1

    best_language, best_score = max(scores.items(), key=lambda item: item[1])
    if best_score > 0:
        confidence = min(0.95, 0.45 + (best_score / max(6, len(words))) * 2)
        return {"language": best_language, "confidence": confidence}

    return {"language": "en", "confidence": 0.25}

def decode_text_bytes(content: bytes):
    for encoding in ("utf-8-sig", "utf-8", "cp1254", "iso-8859-9", "latin-1"):
        try:
            return content.decode(encoding)
        except UnicodeDecodeError:
            continue
    return content.decode("utf-8", errors="replace")

def xml_text_from_bytes(content: bytes):
    root = ET.fromstring(content)
    parts = []
    for element in root.iter():
        if element.text:
            parts.append(element.text)
        tag = element.tag.split("}", 1)[-1]
        if tag in {"p", "tr", "br"}:
            parts.append("\n")
    return " ".join(part.strip() for part in parts if part and part.strip())

def extract_docx_text(archive: zipfile.ZipFile):
    names = [
        name for name in archive.namelist()
        if name == "word/document.xml" or name.startswith("word/header") or name.startswith("word/footer")
    ]
    return "\n".join(xml_text_from_bytes(archive.read(name)) for name in names)

def extract_pptx_text(archive: zipfile.ZipFile):
    slide_names = sorted(name for name in archive.namelist() if re.match(r"ppt/slides/slide\d+\.xml$", name))
    return "\n\n".join(xml_text_from_bytes(archive.read(name)) for name in slide_names)

def extract_xlsx_text(archive: zipfile.ZipFile):
    shared_strings = []
    if "xl/sharedStrings.xml" in archive.namelist():
        shared_root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
        for item in shared_root.iter():
            if item.tag.split("}", 1)[-1] == "si":
                texts = [node.text for node in item.iter() if node.tag.split("}", 1)[-1] == "t" and node.text]
                shared_strings.append("".join(texts))

    rows = []
    sheet_names = sorted(name for name in archive.namelist() if re.match(r"xl/worksheets/sheet\d+\.xml$", name))
    for sheet_name in sheet_names:
        root = ET.fromstring(archive.read(sheet_name))
        for row in root.iter():
            if row.tag.split("}", 1)[-1] != "row":
                continue
            values = []
            for cell in row:
                if cell.tag.split("}", 1)[-1] != "c":
                    continue
                cell_type = cell.attrib.get("t")
                value = ""
                for child in cell:
                    child_tag = child.tag.split("}", 1)[-1]
                    if child_tag == "v" and child.text:
                        value = child.text
                    elif child_tag == "is":
                        value = "".join(node.text or "" for node in child.iter() if node.tag.split("}", 1)[-1] == "t")
                if cell_type == "s" and value.isdigit() and int(value) < len(shared_strings):
                    value = shared_strings[int(value)]
                if value:
                    values.append(value)
            if values:
                rows.append("\t".join(values))
    return "\n".join(rows)

def extract_opendocument_text(archive: zipfile.ZipFile):
    if "content.xml" not in archive.namelist():
        return ""
    return xml_text_from_bytes(archive.read("content.xml"))

def strip_rtf(content: str):
    content = re.sub(r"\\u(-?\d+)\??", lambda match: chr(int(match.group(1)) % 65536), content)
    content = re.sub(r"{\\\*[^{}]*}", " ", content)
    content = re.sub(r"\\'[0-9a-fA-F]{2}", " ", content)
    content = re.sub(r"\\[a-zA-Z]+\d* ?", " ", content)
    content = content.replace("{", " ").replace("}", " ")
    return re.sub(r"\s+", " ", content).strip()

def strip_html(content: str):
    content = re.sub(r"(?is)<(script|style).*?>.*?</\1>", " ", content)
    content = re.sub(r"(?s)<[^>]+>", " ", content)
    return re.sub(r"\s+", " ", html.unescape(content)).strip()

def extract_pdf_text_basic(content: bytes):
    try:
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(content))
        return "\n".join(page.extract_text() or "" for page in reader.pages).strip()
    except Exception:
        pass

    decoded = content.decode("latin-1", errors="ignore")
    chunks = re.findall(r"\(([^()]*)\)\s*Tj", decoded)
    chunks += [
        part
        for array in re.findall(r"\[(.*?)\]\s*TJ", decoded, flags=re.S)
        for part in re.findall(r"\(([^()]*)\)", array)
    ]
    text = " ".join(chunk.replace(r"\)", ")").replace(r"\(", "(").replace(r"\\", "\\") for chunk in chunks)
    return re.sub(r"\s+", " ", text).strip()

def extract_text_from_file(filename: str, content: bytes):
    extension = os.path.splitext(filename.lower())[1]
    if extension not in SUPPORTED_FILE_EXTENSIONS:
        supported = ", ".join(sorted(SUPPORTED_FILE_EXTENSIONS))
        raise ValueError(f"Desteklenmeyen dosya uzantisi. Desteklenenler: {supported}")

    if extension in TEXT_FILE_EXTENSIONS:
        text = decode_text_bytes(content)
        if extension in {".html", ".htm"}:
            return strip_html(text)
        return text

    if extension in RICH_TEXT_EXTENSIONS:
        return strip_rtf(decode_text_bytes(content))

    if extension in PDF_EXTENSIONS:
        text = extract_pdf_text_basic(content)
        if not text:
            raise ValueError("PDF metni cikarilamadi. Taranmis veya sifreli PDF olabilir.")
        return text

    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        if extension == ".docx":
            return extract_docx_text(archive)
        if extension == ".pptx":
            return extract_pptx_text(archive)
        if extension == ".xlsx":
            return extract_xlsx_text(archive)
        if extension in {".odt", ".ods", ".odp"}:
            return extract_opendocument_text(archive)

    return ""

def read_windows_clipboard_text():
    if not sys.platform.startswith("win"):
        raise RuntimeError("Sistem panosu yalnizca Windows uzerinde destekleniyor.")

    import ctypes
    import time
    from ctypes import wintypes

    user32 = ctypes.windll.user32
    kernel32 = ctypes.windll.kernel32
    user32.OpenClipboard.argtypes = [wintypes.HWND]
    user32.OpenClipboard.restype = wintypes.BOOL
    user32.CloseClipboard.argtypes = []
    user32.CloseClipboard.restype = wintypes.BOOL
    user32.GetClipboardData.argtypes = [wintypes.UINT]
    user32.GetClipboardData.restype = wintypes.HANDLE
    kernel32.GlobalLock.argtypes = [wintypes.HGLOBAL]
    kernel32.GlobalLock.restype = ctypes.c_void_p
    kernel32.GlobalUnlock.argtypes = [wintypes.HGLOBAL]
    kernel32.GlobalUnlock.restype = wintypes.BOOL

    CF_UNICODETEXT = 13

    opened = False
    for _ in range(8):
        if user32.OpenClipboard(None):
            opened = True
            break
        time.sleep(0.04)

    if not opened:
        raise RuntimeError("Pano baska bir uygulama tarafindan kilitli.")

    try:
        handle = user32.GetClipboardData(CF_UNICODETEXT)
        if not handle:
            return ""

        locked_handle = kernel32.GlobalLock(handle)
        if not locked_handle:
            return ""

        try:
            return ctypes.wstring_at(locked_handle)
        finally:
            kernel32.GlobalUnlock(handle)
    finally:
        user32.CloseClipboard()

def write_windows_clipboard_text(text: str):
    if not sys.platform.startswith("win"):
        raise RuntimeError("Sistem panosu yalnizca Windows uzerinde destekleniyor.")

    import ctypes
    import time
    from ctypes import wintypes

    user32 = ctypes.windll.user32
    kernel32 = ctypes.windll.kernel32

    user32.OpenClipboard.argtypes = [wintypes.HWND]
    user32.OpenClipboard.restype = wintypes.BOOL
    user32.EmptyClipboard.argtypes = []
    user32.EmptyClipboard.restype = wintypes.BOOL
    user32.SetClipboardData.argtypes = [wintypes.UINT, wintypes.HANDLE]
    user32.SetClipboardData.restype = wintypes.HANDLE
    user32.CloseClipboard.argtypes = []
    user32.CloseClipboard.restype = wintypes.BOOL
    kernel32.GlobalAlloc.argtypes = [wintypes.UINT, ctypes.c_size_t]
    kernel32.GlobalAlloc.restype = wintypes.HGLOBAL
    kernel32.GlobalLock.argtypes = [wintypes.HGLOBAL]
    kernel32.GlobalLock.restype = ctypes.c_void_p
    kernel32.GlobalUnlock.argtypes = [wintypes.HGLOBAL]
    kernel32.GlobalUnlock.restype = wintypes.BOOL
    kernel32.GlobalFree.argtypes = [wintypes.HGLOBAL]
    kernel32.GlobalFree.restype = wintypes.HGLOBAL

    CF_UNICODETEXT = 13
    GMEM_MOVEABLE = 0x0002
    encoded = text.encode("utf-16-le") + b"\x00\x00"

    opened = False
    for _ in range(8):
        if user32.OpenClipboard(None):
            opened = True
            break
        time.sleep(0.04)

    if not opened:
        raise RuntimeError("Pano baska bir uygulama tarafindan kilitli.")

    memory_handle = None
    transferred = False
    try:
        if not user32.EmptyClipboard():
            raise RuntimeError("Pano temizlenemedi.")

        memory_handle = kernel32.GlobalAlloc(GMEM_MOVEABLE, len(encoded))
        if not memory_handle:
            raise RuntimeError("Pano bellegi ayrilamadi.")

        locked_handle = kernel32.GlobalLock(memory_handle)
        if not locked_handle:
            raise RuntimeError("Pano bellegi kilitlenemedi.")

        try:
            ctypes.memmove(locked_handle, encoded, len(encoded))
        finally:
            kernel32.GlobalUnlock(memory_handle)

        if not user32.SetClipboardData(CF_UNICODETEXT, memory_handle):
            raise RuntimeError("Pano verisi yazilamadi.")

        transferred = True
    finally:
        user32.CloseClipboard()
        if memory_handle and not transferred:
            kernel32.GlobalFree(memory_handle)

def set_clipboard_capture(text: str, error: str = ""):
    with clipboard_capture_lock:
        clipboard_capture_state["version"] += 1
        clipboard_capture_state["text"] = text
        clipboard_capture_state["updatedAt"] = time.time()
        clipboard_capture_state["error"] = error

def bring_app_window_to_front():
    if not sys.platform.startswith("win"):
        return

    import ctypes
    from ctypes import wintypes

    user32 = ctypes.windll.user32
    current_pid = os.getpid()
    target_hwnd = wintypes.HWND()

    EnumWindowsProc = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    user32.EnumWindows.argtypes = [EnumWindowsProc, wintypes.LPARAM]
    user32.IsWindowVisible.argtypes = [wintypes.HWND]
    user32.IsWindowVisible.restype = wintypes.BOOL
    user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
    user32.GetWindowTextLengthW.argtypes = [wintypes.HWND]
    user32.GetWindowTextLengthW.restype = ctypes.c_int
    user32.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
    user32.ShowWindow.argtypes = [wintypes.HWND, ctypes.c_int]
    user32.SetForegroundWindow.argtypes = [wintypes.HWND]
    user32.BringWindowToTop.argtypes = [wintypes.HWND]

    def enum_windows(hwnd, _):
        nonlocal target_hwnd
        if not user32.IsWindowVisible(hwnd):
            return True

        pid = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        if pid.value != current_pid:
            return True

        length = user32.GetWindowTextLengthW(hwnd)
        buffer = ctypes.create_unicode_buffer(length + 1)
        user32.GetWindowTextW(hwnd, buffer, length + 1)
        title = buffer.value
        if "LexiCore" in title:
            target_hwnd = hwnd
            return False

        return True

    user32.EnumWindows(EnumWindowsProc(enum_windows), 0)
    if target_hwnd:
        SW_RESTORE = 9
        user32.ShowWindow(target_hwnd, SW_RESTORE)
        user32.BringWindowToTop(target_hwnd)
        user32.SetForegroundWindow(target_hwnd)

def capture_clipboard_after_shortcut():
    import time

    time.sleep(0.18)
    try:
        set_clipboard_capture(read_windows_clipboard_text(), "")
        bring_app_window_to_front()
    except Exception as error:
        set_clipboard_capture("", str(error))

def get_clipboard_shortcut():
    with clipboard_shortcut_lock:
        return clipboard_shortcut

def start_global_clipboard_shortcut_listener():
    global keyboard_hook_started

    if not sys.platform.startswith("win"):
        return

    if keyboard_hook_started:
        return

    keyboard_hook_started = True
    thread = threading.Thread(target=run_windows_keyboard_hook, daemon=True)
    thread.start()

def run_windows_keyboard_hook():
    global keyboard_hook_proc

    import ctypes
    import time
    from ctypes import wintypes

    user32 = ctypes.windll.user32
    kernel32 = ctypes.windll.kernel32

    WH_KEYBOARD_LL = 13
    WM_KEYDOWN = 0x0100
    WM_KEYUP = 0x0101
    WM_SYSKEYDOWN = 0x0104
    WM_SYSKEYUP = 0x0105
    VK_C = 0x43
    VK_CONTROL = 0x11
    VK_SHIFT = 0x10
    VK_MENU = 0x12

    class KBDLLHOOKSTRUCT(ctypes.Structure):
        _fields_ = [
            ("vkCode", wintypes.DWORD),
            ("scanCode", wintypes.DWORD),
            ("flags", wintypes.DWORD),
            ("time", wintypes.DWORD),
            ("dwExtraInfo", ctypes.POINTER(ctypes.c_ulong)),
        ]

    HOOKPROC = ctypes.WINFUNCTYPE(ctypes.c_long, ctypes.c_int, wintypes.WPARAM, wintypes.LPARAM)
    user32.SetWindowsHookExW.argtypes = [ctypes.c_int, HOOKPROC, wintypes.HINSTANCE, wintypes.DWORD]
    user32.SetWindowsHookExW.restype = wintypes.HHOOK
    user32.CallNextHookEx.argtypes = [wintypes.HHOOK, ctypes.c_int, wintypes.WPARAM, wintypes.LPARAM]
    user32.CallNextHookEx.restype = ctypes.c_long
    user32.GetAsyncKeyState.argtypes = [ctypes.c_int]
    user32.GetAsyncKeyState.restype = ctypes.c_short
    user32.GetMessageW.argtypes = [ctypes.POINTER(wintypes.MSG), wintypes.HWND, wintypes.UINT, wintypes.UINT]
    user32.GetMessageW.restype = wintypes.BOOL
    user32.TranslateMessage.argtypes = [ctypes.POINTER(wintypes.MSG)]
    user32.DispatchMessageW.argtypes = [ctypes.POINTER(wintypes.MSG)]
    kernel32.GetModuleHandleW.argtypes = [wintypes.LPCWSTR]
    kernel32.GetModuleHandleW.restype = wintypes.HMODULE

    last_c_press_time = 0.0
    c_is_down = False

    def modifier_down(vk_code: int):
        return bool(user32.GetAsyncKeyState(vk_code) & 0x8000)

    def queue_clipboard_capture():
        threading.Thread(target=capture_clipboard_after_shortcut, daemon=True).start()

    def handle_c_press(ctrl_down: bool, shift_down: bool, alt_down: bool):
        nonlocal last_c_press_time

        shortcut = get_clipboard_shortcut()
        if shortcut == "disabled":
            return

        if shortcut == "ctrl_shift_c" and ctrl_down and shift_down and not alt_down:
            queue_clipboard_capture()
            return

        if shortcut == "ctrl_alt_c" and ctrl_down and alt_down and not shift_down:
            queue_clipboard_capture()
            return

        if shortcut != "ctrl_c_c" or not ctrl_down or shift_down or alt_down:
            return

        now = time.monotonic()
        if now - last_c_press_time <= 0.75:
            last_c_press_time = 0.0
            queue_clipboard_capture()
        else:
            last_c_press_time = now

    def low_level_keyboard_proc(n_code, w_param, l_param):
        nonlocal c_is_down

        if n_code == 0:
            keyboard = ctypes.cast(l_param, ctypes.POINTER(KBDLLHOOKSTRUCT)).contents

            if keyboard.vkCode == VK_C and w_param in (WM_KEYUP, WM_SYSKEYUP):
                c_is_down = False
            elif keyboard.vkCode == VK_C and w_param in (WM_KEYDOWN, WM_SYSKEYDOWN) and not c_is_down:
                c_is_down = True
                handle_c_press(
                    modifier_down(VK_CONTROL),
                    modifier_down(VK_SHIFT),
                    modifier_down(VK_MENU),
                )

        return user32.CallNextHookEx(None, n_code, w_param, l_param)

    keyboard_hook_proc = HOOKPROC(low_level_keyboard_proc)
    hook_handle = user32.SetWindowsHookExW(
        WH_KEYBOARD_LL,
        keyboard_hook_proc,
        kernel32.GetModuleHandleW(None),
        0,
    )

    if not hook_handle:
        return

    msg = wintypes.MSG()
    while user32.GetMessageW(ctypes.byref(msg), None, 0, 0) != 0:
        user32.TranslateMessage(ctypes.byref(msg))
        user32.DispatchMessageW(ctypes.byref(msg))

# Aya-23 modeli ayarlari
AYA_REPO = "bartowski/aya-23-8B-GGUF"
AYA_FILE = "aya-23-8B-Q4_K_M.gguf" # Fiyat/Performans orani en iyi olan 4-bit versiyon (~4.8GB)

# NLLB Modeli icin FLORES-200 dil kodlari haritasi
FLORES_MAP = {
    "en": "eng_Latn",
    "tr": "tur_Latn",
    "de": "deu_Latn",
    "fr": "fra_Latn",
    "es": "spa_Latn",
    "it": "ita_Latn",
    "zh": "zho_Hans",
    "ja": "jpn_Jpan",
    "ko": "kor_Hang",
    "ru": "rus_Cyrl",
    "ar": "arb_Arab",
    "pt": "por_Latn",
    "nl": "nld_Latn",
    "pl": "pol_Latn",
    "el": "ell_Grek",
    "hi": "hin_Deva",
    "sv": "swe_Latn",
    "da": "dan_Latn",
    "fi": "fin_Latn"
}

# Aya-23 Modeli Prompt (Istem) icin Dil Isimleri (LLM'ler tam isim sever)
LANGUAGE_NAMES = {
    "en": "English",
    "tr": "Turkish",
    "de": "German",
    "fr": "French",
    "es": "Spanish",
    "it": "Italian",
    "zh": "Chinese",
    "ja": "Japanese",
    "ko": "Korean",
    "ru": "Russian",
    "ar": "Arabic",
    "pt": "Portuguese",
    "nl": "Dutch",
    "pl": "Polish",
    "el": "Greek",
    "hi": "Hindi",
    "sv": "Swedish",
    "da": "Danish",
    "fi": "Finnish"
}

def resolve_source_lang(text: str, source_lang: str):
    if source_lang == "auto":
        return detect_language(text)["language"]
    return source_lang

# Global dictionary to store loaded models to avoid reloading
loaded_models = {}

# Serve frontend if exists
frontend_dir = None

if getattr(sys, 'frozen', False):
    # PyInstaller _internal mantigi
    base_dir = os.path.dirname(sys.executable)
    
    # 1. Ihtimal: arayuz klasoru _internal icinde
    if os.path.exists(os.path.join(base_dir, "_internal", "frontend_dist", "assets")):
        frontend_dir = os.path.join(base_dir, "_internal", "frontend_dist")
    # 2. Ihtimal: arayuz klasoru direkt exe ile ayni yerde
    elif os.path.exists(os.path.join(base_dir, "frontend_dist", "assets")):
        frontend_dir = os.path.join(base_dir, "frontend_dist")
    # 3. Ihtimal: sys._MEIPASS icinde
    elif hasattr(sys, '_MEIPASS') and os.path.exists(os.path.join(sys._MEIPASS, "frontend_dist", "assets")):
        frontend_dir = os.path.join(sys._MEIPASS, "frontend_dist")
else:
    # In dev mode, we are in backend folder, dist is in parent folder
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    frontend_dir = os.path.join(base_dir, "dist") # React tarafinda ismi hala dist

print(f"Checking for frontend folder at: {frontend_dir}")

# SADECE VE SADECE dizin gercekten varsa ve icinde assets varsa FastAPI'ye mount et.
# Yoksa FastAPI aninda cokuyor.
if frontend_dir and os.path.exists(frontend_dir) and os.path.exists(os.path.join(frontend_dir, "assets")):
    app.mount("/assets", StaticFiles(directory=os.path.join(frontend_dir, "assets")), name="assets")

    @app.get("/")
    def serve_frontend():
        return FileResponse(os.path.join(frontend_dir, "index.html"))



def get_aya_model():
    """
    Ultra kaliteli (LLM) Aya-23 modelini (GGUF formatinda) indirir ve yukler.
    Ayrica onbellekte (cache) eski versiyon varsa otomatik temizler.
    """
    if "aya" in loaded_models:
        return loaded_models["aya"]
        
    print(f"Loading ULTRA QUALITY model: {AYA_REPO} ({AYA_FILE})...")
    
    try:
        if getattr(sys, "frozen", False):
            internal_dir = getattr(sys, "_MEIPASS", os.path.join(os.path.dirname(sys.executable), "_internal"))
            llama_lib_dir = os.path.join(internal_dir, "llama_cpp", "lib")
            if os.path.isdir(llama_lib_dir):
                os.add_dll_directory(llama_lib_dir)

        from llama_cpp import Llama
        from huggingface_hub import hf_hub_download
        
        # Guncelleme kontrolu ile indirme: force_download=False sayesinde 
        # sadece yeni bir versiyon varsa indirir. Eger cache cok siserse
        # hf_hub_download icerisindeki cache mantigi eski symlinkleri temizleyebilir, 
        # ancak biz elle de bir kontrol yapabiliriz.
        
        model_path = hf_hub_download(
            repo_id=AYA_REPO,
            filename=AYA_FILE,
            cache_dir=custom_cache_dir,
            local_dir_use_symlinks=False # Disk alanindan tasarruf icin
        )
        
        # LLM yuklemesi (n_ctx=2048 ceviri icin yeterli bir baglam penceresi)
        # n_gpu_layers=-1 ise modelin tamamini mumkunse GPU'ya yukler.
        llm = Llama(
            model_path=model_path,
            n_ctx=2048,
            n_gpu_layers=-1, 
            verbose=False
        )
        
        loaded_models["aya"] = {"model": llm}
        return loaded_models["aya"]
    except ImportError:
        print("llama-cpp-python kutuphanesi eksik. Lutfen 'pip install llama-cpp-python' komutunu calistirin.")
        return None
    except Exception as e:
        print(f"Failed to load Aya-23 model: {e}")
        return None

def get_nllb_model():
    """
    Yuksek kaliteli (High Quality) NLLB-200 modelini yukler.
    """
    model_name = "facebook/nllb-200-distilled-600M"
    
    if model_name in loaded_models:
        return loaded_models[model_name]
        
    print(f"Loading HIGH QUALITY model: {model_name}...")
    
    try:
        import transformers
        import sentencepiece
        tokenizer = transformers.AutoTokenizer.from_pretrained(model_name, use_fast=False)
        model = transformers.AutoModelForSeq2SeqLM.from_pretrained(model_name)
        loaded_models[model_name] = {"tokenizer": tokenizer, "model": model}
        return loaded_models[model_name]
    except Exception as e:
        print(f"Failed to load NLLB model: {e}")
        return None

def get_model(source_lang: str, target_lang: str):
    """
    Downloads (if not exists) and loads the requested translation model.
    We are using Helsinki-NLP/opus-mt models which are extremely fast and lightweight.
    """
    model_name = f"Helsinki-NLP/opus-mt-{source_lang}-{target_lang}"
    
    if model_name in loaded_models:
        return loaded_models[model_name]
        
    print(f"Loading model: {model_name}...")
    
    try:
        import transformers
        import sentencepiece
        # Load tokenizer
        tokenizer = transformers.AutoTokenizer.from_pretrained(model_name, use_fast=False)
        
        # Load translation model
        model = transformers.AutoModelForSeq2SeqLM.from_pretrained(model_name)
        
        loaded_models[model_name] = {"tokenizer": tokenizer, "model": model}
        return loaded_models[model_name]
    except Exception as e:
        print(f"Direct model {model_name} failed: {e}")
        
        # English to Turkish specifically sometimes uses different naming convention or requires sentencepiece
        # Let's add a fallback mechanism for common languages
        if source_lang == "en" and target_lang == "tr":
            try:
                import transformers
                # Sometimes Helsinki-NLP models need explicit sentencepiece
                import sentencepiece
                model_name = "Helsinki-NLP/opus-mt-tc-big-en-tr"
                tokenizer = transformers.AutoTokenizer.from_pretrained(model_name, use_fast=False)
                model = transformers.AutoModelForSeq2SeqLM.from_pretrained(model_name)
                loaded_models[model_name] = {"tokenizer": tokenizer, "model": model}
                return loaded_models[model_name]
            except Exception as e2:
                print(f"Fallback model failed: {e2}")
                return None
                
        return None

@app.get("/api/health")
def health_check():
    return {"status": "running", "message": "LexiCore Local Translation API is active."}

@app.get("/api/model-status")
def model_status():
    total_size, file_count = get_directory_stats(custom_cache_dir)
    aya_ready = False

    for root, _, files in os.walk(custom_cache_dir):
        if AYA_FILE in files:
            aya_ready = True
            break

    return {
        "cacheDir": custom_cache_dir,
        "fileCount": file_count,
        "totalSizeBytes": total_size,
        "totalSizeLabel": format_bytes(total_size),
        "ayaModelReady": aya_ready,
    }

@app.post("/api/hf/repo-files")
def hf_repo_files(req: HFRepoFilesRequest):
    try:
        repo_id = _validate_hf_repo_id(req.repo_id)
        revision = (req.revision or "main").strip()[:120]
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))

    try:
        from huggingface_hub import HfApi

        api = HfApi()
        files = api.list_repo_files(repo_id=repo_id, revision=revision)
        return {"repoId": repo_id, "revision": revision, "files": files}
    except Exception as error:
        raise HTTPException(status_code=502, detail=f"HuggingFace listesi alinmadi: {str(error)}")

@app.post("/api/hf/download")
def hf_download(req: HFDownloadRequest):
    try:
        repo_id = _validate_hf_repo_id(req.repo_id)
        filename = _validate_hf_filename(req.filename)
        revision = (req.revision or "main").strip()[:120]
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))

    job_id = uuid.uuid4().hex
    target_dir = os.path.join(custom_cache_dir, "hf_models", repo_id.replace("/", os.sep))
    os.makedirs(target_dir, exist_ok=True)
    target_path = os.path.join(target_dir, os.path.basename(filename))
    tmp_path = target_path + ".part"
    url = _hf_resolve_url(repo_id, filename, revision)

    with hf_download_lock:
        hf_download_jobs[job_id] = {
            "status": "running",
            "repoId": repo_id,
            "filename": filename,
            "revision": revision,
            "url": url,
            "targetPath": target_path,
            "downloadedBytes": 0,
            "totalBytes": 0,
            "error": "",
            "startedAt": time.time(),
            "finishedAt": 0.0,
        }

    def run():
        total_bytes = 0
        try:
            head_req = urllib.request.Request(url, method="HEAD")
            with urllib.request.urlopen(head_req, timeout=45) as head_res:
                total_bytes = int(head_res.headers.get("Content-Length") or 0)
        except Exception:
            total_bytes = 0

        with hf_download_lock:
            if job_id in hf_download_jobs:
                hf_download_jobs[job_id]["totalBytes"] = total_bytes

        try:
            request = urllib.request.Request(url, method="GET")
            with urllib.request.urlopen(request, timeout=120) as response, open(tmp_path, "wb") as out:
                while True:
                    chunk = response.read(1024 * 256)
                    if not chunk:
                        break
                    out.write(chunk)
                    with hf_download_lock:
                        if job_id in hf_download_jobs:
                            hf_download_jobs[job_id]["downloadedBytes"] += len(chunk)

            os.replace(tmp_path, target_path)
            with hf_download_lock:
                if job_id in hf_download_jobs:
                    hf_download_jobs[job_id]["status"] = "done"
                    hf_download_jobs[job_id]["finishedAt"] = time.time()
        except Exception as error:
            try:
                if os.path.exists(tmp_path):
                    os.remove(tmp_path)
            except OSError:
                pass
            with hf_download_lock:
                if job_id in hf_download_jobs:
                    hf_download_jobs[job_id]["status"] = "error"
                    hf_download_jobs[job_id]["error"] = str(error)
                    hf_download_jobs[job_id]["finishedAt"] = time.time()

    threading.Thread(target=run, daemon=True).start()
    return {"jobId": job_id, "targetPath": target_path}

@app.get("/api/hf/download-status")
def hf_download_status(jobId: str):
    with hf_download_lock:
        job = hf_download_jobs.get(jobId)
        if not job:
            raise HTTPException(status_code=404, detail="Indirme bulunamadi.")
        return dict(job)

@app.on_event("startup")
def startup_event():
    start_global_clipboard_shortcut_listener()

@app.get("/api/clipboard-text")
def clipboard_text():
    try:
        return {"text": read_windows_clipboard_text()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Pano okunamadi: {str(e)}")

@app.post("/api/clipboard-text")
def write_clipboard_text(req: ClipboardWriteRequest):
    try:
        write_windows_clipboard_text(req.text)
        return {"ok": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Pano yazilamadi: {str(e)}")

@app.get("/api/clipboard-capture")
def clipboard_capture(since: int = 0):
    with clipboard_capture_lock:
        state = dict(clipboard_capture_state)

    has_update = state["version"] > since
    return {
        "version": state["version"],
        "text": state["text"] if has_update else "",
        "updatedAt": state["updatedAt"],
        "error": state["error"] if has_update else "",
        "hasUpdate": has_update,
        "shortcut": get_clipboard_shortcut(),
    }

@app.post("/api/clipboard-shortcut")
def update_clipboard_shortcut(req: ClipboardShortcutRequest):
    global clipboard_shortcut

    if req.shortcut not in VALID_CLIPBOARD_SHORTCUTS:
        raise HTTPException(status_code=400, detail="Gecersiz pano kisayolu.")

    with clipboard_shortcut_lock:
        clipboard_shortcut = req.shortcut

    return {"shortcut": clipboard_shortcut}

@app.post("/api/detect-language")
def detect_language_endpoint(req: DetectLanguageRequest):
    result = detect_language(req.text)
    return {
        "language": result["language"],
        "confidence": result["confidence"],
        "languageName": LANGUAGE_NAMES.get(result["language"], result["language"]),
    }

@app.post("/api/extract-file-text")
def extract_file_text_endpoint(req: FileTextRequest):
    try:
        content = base64.b64decode(req.content_base64, validate=True)
        text = extract_text_from_file(req.filename, content).strip()
        if not text:
            raise ValueError("Dosyadan metin cikarilamadi.")
        return {"text": text}
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))
    except zipfile.BadZipFile:
        raise HTTPException(status_code=400, detail="Dosya okunamadi veya gecersiz arsiv formati.")
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Dosya okunamadi: {str(error)}")

def _split_translation_tokens(text: str):
    return re.split(r"(\s+)", text or "")

def _normalize_word_token(token: str):
    return re.sub(r"^[^\w]+|[^\w]+$", "", token or "", flags=re.UNICODE).lower()

def _local_nbest_translations(source_text: str, source_lang: str, target_lang: str, quality: str, n_best: int = 6):
    source_lang_code = resolve_source_lang(source_text, source_lang or "auto")

    if quality == "high":
        model_data = get_nllb_model()
        if not model_data:
            return []
        tokenizer = model_data["tokenizer"]
        model = model_data["model"]
        src_lang_code = FLORES_MAP.get(source_lang_code, "eng_Latn")
        tgt_lang_code = FLORES_MAP.get(target_lang, "eng_Latn")
        tokenizer.src_lang = src_lang_code
        inputs = tokenizer(source_text, return_tensors="pt", padding=True, truncation=True)
        lang_code_to_id = getattr(tokenizer, "lang_code_to_id", {})
        forced_bos_token_id = lang_code_to_id.get(tgt_lang_code)
        if forced_bos_token_id is None:
            forced_bos_token_id = tokenizer.convert_tokens_to_ids(tgt_lang_code)
        outputs = model.generate(
            **inputs,
            forced_bos_token_id=forced_bos_token_id,
            max_length=512,
            num_beams=max(2, n_best),
            num_return_sequences=max(1, min(n_best, 8)),
            do_sample=False,
        )
        return [tokenizer.decode(output, skip_special_tokens=True) for output in outputs]

    model_data = get_model(source_lang_code, target_lang)
    if not model_data:
        return []
    tokenizer = model_data["tokenizer"]
    model = model_data["model"]
    inputs = tokenizer(source_text, return_tensors="pt", padding=True, truncation=True)
    outputs = model.generate(
        **inputs,
        max_length=512,
        num_beams=max(2, n_best),
        num_return_sequences=max(1, min(n_best, 8)),
        do_sample=False,
    )
    return [tokenizer.decode(output, skip_special_tokens=True) for output in outputs]

@app.post("/api/word-alternatives")
def word_alternatives(req: WordAlternativesRequest):
    word = req.word.strip()
    if not word:
        return {"alternatives": []}

    if req.provider.lower() == "local" and req.source_text.strip() and req.token_index >= 0:
        quality = (req.quality or "fast").lower()
        base_tokens = _split_translation_tokens(req.sentence)
        target_token = base_tokens[req.token_index] if req.token_index < len(base_tokens) else ""
        target_norm = _normalize_word_token(target_token) or _normalize_word_token(word)

        candidates = _local_nbest_translations(req.source_text, req.source_lang, req.target_lang, quality, n_best=6)
        alternatives = []
        seen = set()
        for candidate in candidates:
            tokens = _split_translation_tokens(candidate)
            if req.token_index >= len(tokens):
                continue
            cand_norm = _normalize_word_token(tokens[req.token_index])
            if not cand_norm or cand_norm == target_norm:
                continue
            if cand_norm in seen:
                continue
            seen.add(cand_norm)
            alternatives.append(tokens[req.token_index].strip())
            if len(alternatives) >= 6:
                break
        if alternatives:
            return {"alternatives": alternatives}

    if req.provider.lower() == "openai" and req.api_key.strip():
        target_lang_name = LANGUAGE_NAMES.get(req.target_lang, req.target_lang)
        status, data = post_json(
            "https://api.openai.com/v1/chat/completions",
            {
                "model": "gpt-4o-mini",
                "messages": [
                    {
                        "role": "system",
                        "content": (
                            "Return JSON only. Provide up to 6 natural same-language alternatives "
                            "for the selected word in the translated sentence. Preserve meaning and tone. "
                            'Schema: {"alternatives":["..."]}'
                        ),
                    },
                    {
                        "role": "user",
                        "content": f"Language: {target_lang_name}\nWord: {word}\nSentence: {req.sentence}",
                    },
                ],
                "temperature": 0.2,
            },
            {"Authorization": f"Bearer {req.api_key}"},
        )

        if status < 400:
            choices = data.get("choices", [])
            if choices:
                alternatives = parse_openai_alternatives(choices[0]["message"]["content"])
                if alternatives:
                    return {"alternatives": alternatives[:6]}

    return {"alternatives": fallback_alternatives(word, req.target_lang)[:6]}

@app.post("/api/cloud-translate")
def cloud_translate(req: CloudTranslationRequest):
    if not req.text.strip():
        return {"translatedText": ""}

    if not req.api_key.strip():
        raise HTTPException(status_code=400, detail="API anahtari gerekli.")

    provider = req.provider.lower()
    source_lang_code = resolve_source_lang(req.text, req.source_lang)

    if provider == "deepl":
        target_lang = DEEPL_TARGET_MAP.get(req.target_lang, req.target_lang.upper())
        source_lang = DEEPL_SOURCE_MAP.get(source_lang_code, source_lang_code.upper())
        is_free_key = req.api_key.endswith(":fx")
        url = "https://api-free.deepl.com/v2/translate" if is_free_key else "https://api.deepl.com/v2/translate"
        payload = {
            "text": [req.text],
            "target_lang": target_lang,
            "source_lang": source_lang,
        }

        status, data = post_json(url, payload, {"Authorization": f"DeepL-Auth-Key {req.api_key}"})

        if status >= 400:
            message = data.get("message") or data.get("detail") or "DeepL API istegi basarisiz oldu."
            raise HTTPException(status_code=status, detail=message)

        translations = data.get("translations", [])
        if not translations:
            raise HTTPException(status_code=502, detail="DeepL bos ceviri yaniti dondu.")

        return {"translatedText": translations[0].get("text", "")}

    if provider == "openai":
        source_lang_name = LANGUAGE_NAMES.get(source_lang_code, source_lang_code)
        target_lang_name = LANGUAGE_NAMES.get(req.target_lang, req.target_lang)

        status, data = post_json(
            "https://api.openai.com/v1/chat/completions",
            {
                "model": "gpt-4o-mini",
                "messages": [
                    {
                        "role": "system",
                        "content": f"Sen uzman bir cevirmen yapay zekasin. Gelen metni {source_lang_name} dilinden {target_lang_name} diline cevir. Asla yorum yapma, sadece ceviriyi ver.",
                    },
                    {"role": "user", "content": req.text},
                ],
                "temperature": 0.3,
            },
            {"Authorization": f"Bearer {req.api_key}"},
        )

        if status >= 400:
            error = data.get("error", {})
            message = error.get("message") or data.get("message") or "OpenAI API istegi basarisiz oldu."
            raise HTTPException(status_code=status, detail=message)

        choices = data.get("choices", [])
        if not choices:
            raise HTTPException(status_code=502, detail="OpenAI bos ceviri yaniti dondu.")

        return {"translatedText": choices[0]["message"]["content"]}

    raise HTTPException(status_code=400, detail="Desteklenmeyen bulut ceviri saglayicisi.")

@app.post("/api/translate")
def translate(req: TranslationRequest):
    if not req.text.strip():
        return {"translatedText": ""}

    source_lang_code = resolve_source_lang(req.text, req.source_lang)
        
    if req.quality == "ultra":
        # Ultra Kalite Model (Aya-23 LLM) kullanimi
        model_data = get_aya_model()
        if not model_data:
            raise HTTPException(status_code=500, detail="Aya-23 LLM yuklenemedi. Lutfen llama-cpp-python kutuphanesini kontrol edin.")
            
        try:
            llm = model_data["model"]
            
            source_lang_name = LANGUAGE_NAMES.get(source_lang_code, source_lang_code)
            target_lang_name = LANGUAGE_NAMES.get(req.target_lang, req.target_lang)
            
            # Aya-23 Prompt (Istem) Yapisi: Command-R/Aya-23 standardidir.
            system_prompt = f"Sen uzman bir cevirmen yapay zekasin. Gelen metni {source_lang_name} dilinden {target_lang_name} diline cevir. Asla yorum yapma, sadece ceviriyi ver."
            
            messages = [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": req.text}
            ]
            
            # Chat Completion (Benzer OpenAI API formati)
            response = llm.create_chat_completion(
                messages=messages,
                max_tokens=1024,
                temperature=0.1 # Ceviride halusinasyon olmamasi icin dusuk sicaklik
            )
            
            translated_text = response['choices'][0]['message']['content'].strip()
            return {"translatedText": translated_text}
            
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Aya-23 Çeviri hatasi: {str(e)}")
            
    elif req.quality == "high":
        # En Kaliteli Model (NLLB-200) kullanimi
        model_data = get_nllb_model()
        if not model_data:
            raise HTTPException(status_code=500, detail="Yuksek kaliteli model yuklenemedi.")
            
        try:
            tokenizer = model_data["tokenizer"]
            model = model_data["model"]
            
            src_lang_code = FLORES_MAP.get(source_lang_code, "eng_Latn")
            tgt_lang_code = FLORES_MAP.get(req.target_lang, "eng_Latn")
            
            # NLLB icin kaynak dil ayarlanir
            tokenizer.src_lang = src_lang_code
            inputs = tokenizer(req.text, return_tensors="pt", padding=True, truncation=True)
            
            # Hedef dil icin forced_bos_token_id ayarlanir
            lang_code_to_id = getattr(tokenizer, "lang_code_to_id", {})
            forced_bos_token_id = lang_code_to_id.get(tgt_lang_code)
            if forced_bos_token_id is None:
                forced_bos_token_id = tokenizer.convert_tokens_to_ids(tgt_lang_code)
            
            outputs = model.generate(**inputs, forced_bos_token_id=forced_bos_token_id, max_length=512)
            translated_text = tokenizer.decode(outputs[0], skip_special_tokens=True)
            return {"translatedText": translated_text}
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"NLLB Çeviri hatasi: {str(e)}")
            
    else:
        # Hizli Model (Opus-MT) kullanimi
        model_data = get_model(source_lang_code, req.target_lang)
        
        if not model_data:
            raise HTTPException(
                status_code=400, 
                detail=f"Local model for {source_lang_code} to {req.target_lang} is not available. Please use a cloud provider or try English."
            )
            
        try:
            tokenizer = model_data["tokenizer"]
            model = model_data["model"]
            
            inputs = tokenizer(req.text, return_tensors="pt", padding=True, truncation=True)
            outputs = model.generate(**inputs, max_length=512)
            translated_text = tokenizer.decode(outputs[0], skip_special_tokens=True)
            
            return {"translatedText": translated_text}
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

@app.get("/{file_path:path}")
def serve_static(file_path: str):
    # Don't intercept API calls
    if file_path.startswith("api/"):
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="API route not found")
        
    if not frontend_dir:
        return {"error": "Frontend not built or directory missing. (frontend_dir is None)"}
        
    full_path = os.path.join(frontend_dir, file_path)
    if os.path.exists(full_path) and os.path.isfile(full_path):
        return FileResponse(full_path)
        
    # Default to index.html for SPA routing
    if os.path.exists(os.path.join(frontend_dir, "index.html")):
        return FileResponse(os.path.join(frontend_dir, "index.html"))
    return {"error": "Frontend not built or dist directory missing."}

def run_server():
    import uvicorn
    try:
        # uvicorn logs might be annoying in exe, so log_level="warning" could be better
        uvicorn.run(app, host="127.0.0.1", port=8000, log_level="warning")
    except Exception as e:
        import traceback
        print("\n=== UVICORN ERROR ===")
        traceback.print_exc()
        print("======================\n")

def run_native_window():
    """
    webview kutuphanesi PyInstaller ile uyumsuzluk yarattigi icin
    dogrudan PyQt6 (Chromium tabanli) kullanarak native pencere aciyoruz.
    """
    from PyQt6.QtWidgets import QApplication, QMainWindow
    from PyQt6.QtWebEngineWidgets import QWebEngineView
    from PyQt6.QtCore import QUrl
    import time
    
    # Sunucunun baslamasi icin 1.5 saniye ver
    time.sleep(1.5)
    
    app_qt = QApplication(sys.argv)
    window = QMainWindow()
    window.setWindowTitle("LexiCore Translator")
    window.resize(1280, 800)
    
    # Pencereyi merkeze al
    qr = window.frameGeometry()
    cp = window.screen().availableGeometry().center()
    qr.moveCenter(cp)
    window.move(qr.topLeft())
    
    # WebEngine (Tarayici Motoru) kullanarak yerel sunucumuzu (localhost) goster
    browser = QWebEngineView()
    browser.setUrl(QUrl("http://127.0.0.1:8000"))
    
    window.setCentralWidget(browser)
    window.show()
    
    # Pencere kapatilana kadar ana donguyu surdur
    sys.exit(app_qt.exec())

if __name__ == "__main__":
    try:
        print("Starting LexiCore Server...")
        # FastAPI sunucusunu baslat
        server_thread = threading.Thread(target=run_server, daemon=True)
        server_thread.start()
        
        print("Opening LexiCore Native Window (PyQt6)...")
        # Ana thread uzerinde PyQt6 uygulamasini baslat (Cunku GUI her zaman ana thread'de olmalidir)
        run_native_window()
        
    except Exception as e:
        import traceback
        print("\n=== FATAL ERROR OCCURRED ===")
        traceback.print_exc()
        print("============================\n")
        input("Press Enter to exit...")
    except KeyboardInterrupt:
        pass
