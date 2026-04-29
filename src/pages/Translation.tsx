import { useState, useEffect, useRef } from 'react';
import { useStore, type ApiKeys, type LocalModelQuality, type Provider } from '@/store';
import { ArrowRightLeft, Volume2, Copy, Star, Check, Wand2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { motion, AnimatePresence } from 'framer-motion';

const LANGUAGES = {
  // En çok kullanılanlar
  en: 'İngilizce',
  tr: 'Türkçe',
  de: 'Almanca',
  fr: 'Fransızca',
  es: 'İspanyolca',
  it: 'İtalyanca',
  // Asya dilleri
  zh: 'Çince (Basit)',
  ja: 'Japonca',
  ko: 'Korece',
  // Diğer Avrupa & Orta Doğu
  ru: 'Rusça',
  ar: 'Arapça',
  pt: 'Portekizce',
  nl: 'Felemenkçe',
  pl: 'Lehçe',
  el: 'Yunanca',
  hi: 'Hintçe',
  // İskandinav
  sv: 'İsveççe',
  da: 'Danca',
  fi: 'Fince',
};

const SOURCE_LANGUAGES = {
  auto: 'Dili algıla',
  ...LANGUAGES,
};

const SUPPORTED_TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'jsonl', 'xml', 'html', 'htm',
  'log', 'srt', 'vtt', 'yaml', 'yml', 'ini', 'cfg', 'conf', 'py', 'js', 'jsx',
  'ts', 'tsx', 'css', 'scss', 'less', 'sql', 'toml', 'po', 'properties',
]);

const SUPPORTED_BACKEND_EXTENSIONS = new Set(['docx', 'pptx', 'xlsx', 'odt', 'ods', 'odp', 'rtf', 'pdf']);

interface MyMemoryResponse {
  responseStatus: number;
  responseDetails?: string;
  responseData: {
    translatedText: string;
  };
}

interface LocalTranslationResponse {
  translatedText: string;
}

interface CloudTranslationResponse {
  translatedText: string;
}

interface ApiErrorResponse {
  detail?: string;
}

interface WordAlternativesResponse {
  alternatives: string[];
}

interface ClipboardTextResponse {
  text?: string;
}

interface ClipboardCaptureResponse {
  version: number;
  text?: string;
  error?: string;
  hasUpdate?: boolean;
}

interface DetectLanguageResponse {
  language: string;
  confidence: number;
  languageName?: string;
}

interface ExtractFileTextResponse {
  text: string;
}

const hasWordCharacter = (token: string) => /[\p{L}\p{N}]/u.test(token);

const extractWord = (token: string) => {
  const match = token.match(/[\p{L}\p{N}'’.-]+/u);
  return match?.[0] ?? '';
};

const replaceWordInToken = (token: string, replacement: string) => {
  const match = token.match(/^([^\p{L}\p{N}]*)([\p{L}\p{N}'’.-]+)([^\p{L}\p{N}]*)$/u);
  if (!match) return replacement;
  return `${match[1]}${replacement}${match[3]}`;
};

const writeClipboardText = async (text: string) => {
  let backendError: unknown;

  try {
    const res = await fetch('/api/clipboard-text', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text }),
    });

    if (res.ok) return;

    const errorData = await res.json().catch(() => ({})) as ApiErrorResponse;
    backendError = new Error(errorData.detail || 'Sistem panosuna yazilamadi.');
  } catch (error) {
    backendError = error;
  }

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // PyQt WebEngine can reject navigator.clipboard; fall back below.
    }
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  document.body.appendChild(textarea);
  textarea.select();

  const copied = document.execCommand('copy');
  document.body.removeChild(textarea);

  if (!copied) {
    if (backendError instanceof Error) {
      throw backendError;
    }
    throw new Error('Pano erişimi reddedildi.');
  }
};

// Gerçek Çeviri API Mantığı
const readClipboardText = async () => {
  let browserClipboardError: unknown;

  if (navigator.clipboard?.readText) {
    try {
      const browserClipboardText = await navigator.clipboard.readText();
      if (browserClipboardText) return browserClipboardText;
    } catch (error) {
      browserClipboardError = error;
    }
  }

  try {
    const res = await fetch('/api/clipboard-text', {
      cache: 'no-store',
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({})) as ApiErrorResponse;
      throw new Error(errorData.detail || 'Sistem panosu okunamadÄ±.');
    }

    const data = await res.json() as ClipboardTextResponse;
    return data.text ?? '';
  } catch (fallbackError) {
    if (fallbackError instanceof Error) {
      throw fallbackError;
    }
    if (browserClipboardError instanceof Error) {
      throw browserClipboardError;
    }
    throw new Error('Pano okunamadÄ±.');
  }
};

const detectLanguage = async (text: string) => {
  const res = await fetch('/api/detect-language', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text }),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({})) as ApiErrorResponse;
    throw new Error(errorData.detail || 'Dil algılanamadı.');
  }

  const data = await res.json() as DetectLanguageResponse;
  return data.language || 'en';
};

const getFileExtension = (filename: string) => filename.split('.').pop()?.toLowerCase() ?? '';

const readFileAsText = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = (event) => {
    const content = event.target?.result;
    if (typeof content === 'string') resolve(content);
    else reject(new Error('Dosya metin olarak okunamadı.'));
  };
  reader.onerror = () => reject(new Error('Dosya okunamadı.'));
  reader.readAsText(file);
});

const readFileAsBase64 = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => {
    const result = reader.result;
    if (typeof result !== 'string') {
      reject(new Error('Dosya okunamadı.'));
      return;
    }
    resolve(result.split(',')[1] ?? '');
  };
  reader.onerror = () => reject(new Error('Dosya okunamadı.'));
  reader.readAsDataURL(file);
});

const extractFileText = async (file: File) => {
  const extension = getFileExtension(file.name);
  if (file.type.startsWith('text/') || SUPPORTED_TEXT_EXTENSIONS.has(extension)) {
    return readFileAsText(file);
  }

  if (!SUPPORTED_BACKEND_EXTENSIONS.has(extension)) {
    throw new Error('Bu dosya türü desteklenmiyor.');
  }

  const contentBase64 = await readFileAsBase64(file);
  const res = await fetch('/api/extract-file-text', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      filename: file.name,
      content_base64: contentBase64,
    }),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({})) as ApiErrorResponse;
    throw new Error(errorData.detail || 'Dosyadan metin çıkarılamadı.');
  }

  const data = await res.json() as ExtractFileTextResponse;
  return data.text;
};

const translateText = async (
  text: string,
  from: string,
  to: string,
  provider: Provider,
  apiKeys: ApiKeys,
  localQuality: LocalModelQuality,
  modelId: string
) => {
  if (!text.trim()) return '';
  if (from === to) return text;
  
  try {
    if (provider === 'mymemory') {
      // MyMemory API (Ücretsiz, limitsiz kayıt olmadan günde 500 kelime)
      const res = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${from}|${to}`);
      if (!res.ok) throw new Error('API Hatası');
      const data = await res.json() as MyMemoryResponse;
      if (data.responseStatus !== 200) return `[Hata]: ${data.responseDetails}`;
      return data.responseData.translatedText;
    } 
    else if (provider === 'deepl') {
      if (!apiKeys.deepl) return '[Hata]: Lütfen Ayarlar kısmından DeepL API Anahtarınızı girin.';
      
      const res = await fetch('/api/cloud-translate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text,
          source_lang: from,
          target_lang: to,
          provider: 'deepl',
          api_key: apiKeys.deepl
        })
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({})) as ApiErrorResponse;
        throw new Error(errorData.detail || 'DeepL API Hatası. Anahtarınızı kontrol edin.');
      }
      const data = await res.json() as CloudTranslationResponse;
      return data.translatedText;
    }
    else if (provider === 'openai') {
      if (!apiKeys.openai) return '[Hata]: Lütfen Ayarlar kısmından OpenAI API Anahtarınızı girin.';
      
      const res = await fetch('/api/cloud-translate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text,
          source_lang: from,
          target_lang: to,
          provider: 'openai',
          api_key: apiKeys.openai
        })
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({})) as ApiErrorResponse;
        throw new Error(errorData.detail || 'OpenAI API Hatası. Anahtarınızı kontrol edin.');
      }
      const data = await res.json() as CloudTranslationResponse;
      return data.translatedText;
    }
    else if (provider === 'local') {
      // Yerel Python Sunucusu (FastAPI + Opus-MT)
      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text: text,
          source_lang: from,
          target_lang: to,
          quality: localQuality,
          model_id: modelId
        })
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({})) as ApiErrorResponse;
        throw new Error(errorData.detail || 'Yerel sunucuya bağlanılamadı. Python backend\'inin (localhost:8000) çalıştığından emin olun.');
      }
      const data = await res.json() as LocalTranslationResponse;
      return data.translatedText;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Bilinmeyen hata';
    return `[Bağlantı Hatası]: ${message}`;
  }
  
  return '';
};

export default function Translation() {
  const {
    sourceLang,
    targetLang,
    setSourceLang,
    setTargetLang,
    addHistoryItem,
    provider,
    apiKeys,
    localModelQuality,
    localOnlyProcessing,
    clipboardShortcut,
    selectedModelId,
  } = useStore();
  const [sourceText, setSourceText] = useState('');
  const [translatedText, setTranslatedText] = useState('');
  const [isTranslating, setIsTranslating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [copyError, setCopyError] = useState('');
  const [fileError, setFileError] = useState('');
  const [detectedSourceLang, setDetectedSourceLang] = useState('');
  const [wordMenu, setWordMenu] = useState<{
    index: number;
    word: string;
    alternatives: string[];
    loading: boolean;
    error?: string;
  } | null>(null);
  const wordMenuRef = useRef<HTMLSpanElement | null>(null);
  const clipboardCaptureVersionRef = useRef(0);
  const lastManualSourceLangRef = useRef<string>('');
  const autoSwapGuardRef = useRef<string>('');
  const swapPipelineRef = useRef<{ phase: 'idle' | 'detect' | 'swap' | 'translate'; key: string }>({ phase: 'idle', key: '' });
  const effectiveProvider = localOnlyProcessing ? 'local' : provider;
  const activeSourceLang = sourceLang === 'auto' ? detectedSourceLang || 'en' : sourceLang;

  // Gelişmiş istatistik hesaplama
  const getStats = () => {
    if (!sourceText.trim()) return null;
    const words = sourceText.trim().split(/\s+/).length;
    const chars = sourceText.length;
    const readingTime = Math.max(1, Math.ceil(words / 200)); // Ortalama 200 kelime/dk
    return { words, chars, readingTime };
  };
  const stats = getStats();

  useEffect(() => {
    if (sourceLang !== 'auto') {
      lastManualSourceLangRef.current = sourceLang;
    }
  }, [sourceLang]);

  useEffect(() => {
    const timer = setTimeout(async () => {
      const DEBUG = true;
      if (sourceText.trim()) {
        setIsTranslating(true);
        swapPipelineRef.current.phase = 'detect';
        let resolvedSourceLang = sourceLang;
        if (sourceLang === 'auto') {
          try {
            if (DEBUG) console.debug('[lexicore:auto-swap]', 'detect:start', { sourceLang, targetLang });
            resolvedSourceLang = await detectLanguage(sourceText);
            setDetectedSourceLang(resolvedSourceLang);
            if (DEBUG) console.debug('[lexicore:auto-swap]', 'detect:done', { resolvedSourceLang });
          } catch {
            resolvedSourceLang = 'en';
            setDetectedSourceLang('en');
            if (DEBUG) console.debug('[lexicore:auto-swap]', 'detect:error->fallback', { resolvedSourceLang });
          }
        } else {
          setDetectedSourceLang('');
        }

        const swapKey = `${resolvedSourceLang}:${targetLang}:${sourceText.slice(0, 64)}`;
        const swapTarget = lastManualSourceLangRef.current;
        if (
          sourceLang === 'auto' &&
          resolvedSourceLang === targetLang &&
          swapTarget &&
          swapTarget !== targetLang &&
          autoSwapGuardRef.current !== swapKey
        ) {
          swapPipelineRef.current.phase = 'swap';
          autoSwapGuardRef.current = swapKey;
          swapPipelineRef.current.key = swapKey;
          if (DEBUG) console.debug('[lexicore:auto-swap]', 'swap:apply', { from: targetLang, to: swapTarget, swapKey });
          setTranslatedText('');
          setWordMenu(null);
          setTargetLang(swapTarget);
          setIsTranslating(false);
          return;
        }

        swapPipelineRef.current.phase = 'translate';
        if (DEBUG) console.debug('[lexicore:auto-swap]', 'translate:start', { resolvedSourceLang, targetLang, provider: effectiveProvider, modelId: selectedModelId || '' });
        const result = await translateText(sourceText, resolvedSourceLang, targetLang, effectiveProvider, apiKeys, localModelQuality, selectedModelId);
        setTranslatedText(result);
        setWordMenu(null);
        setIsTranslating(false);
        swapPipelineRef.current.phase = 'idle';
      } else {
        setTranslatedText('');
        setWordMenu(null);
        setDetectedSourceLang('');
        autoSwapGuardRef.current = '';
        swapPipelineRef.current.phase = 'idle';
        swapPipelineRef.current.key = '';
      }
    }, 600); // Debounce

    return () => clearTimeout(timer);
  }, [sourceText, sourceLang, targetLang, effectiveProvider, apiKeys, localModelQuality, selectedModelId]);

  // Global clipboard shortcut listener
  useEffect(() => {
    let lastCPressTime = 0;

    const applyClipboardText = async () => {
      try {
        const clipboardText = await readClipboardText();
        if (clipboardText) setSourceText(clipboardText);
      } catch (err) {
        console.error("Panodan okuma başarısız oldu. Lütfen tarayıcı izinlerini kontrol edin.", err);
      }
    };
    
    const handleGlobalKeyDown = async (e: KeyboardEvent) => {
      if (clipboardShortcut === 'disabled') return;

      const isCopyKey = (e.ctrlKey || e.metaKey) && (e.code === 'KeyC' || e.key.toLowerCase() === 'c');
      const shouldReadClipboard =
        (clipboardShortcut === 'ctrl_shift_c' && isCopyKey && e.shiftKey && !e.altKey) ||
        (clipboardShortcut === 'ctrl_alt_c' && isCopyKey && e.altKey && !e.shiftKey);

      if (shouldReadClipboard) {
        e.preventDefault();
        try {
          await applyClipboardText();
        } catch (err) {
          console.error("Panodan okuma başarısız oldu. Lütfen tarayıcı izinlerini kontrol edin.", err);
        }
        return;
      }

      if (clipboardShortcut === 'ctrl_c_c' && isCopyKey && !e.shiftKey && !e.altKey) {
        const now = Date.now();
        if (now - lastCPressTime < 700) {
          e.preventDefault();
          try {
            await applyClipboardText();
          } catch (err) {
            console.error("Panodan okuma başarısız oldu. Lütfen tarayıcı izinlerini kontrol edin.", err);
          }
          lastCPressTime = 0;
        } else {
          lastCPressTime = now;
        }
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown, true);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown, true);
  }, [clipboardShortcut]);

  useEffect(() => {
    void fetch('/api/clipboard-shortcut', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ shortcut: clipboardShortcut }),
    }).catch(() => undefined);
  }, [clipboardShortcut]);

  useEffect(() => {
    if (clipboardShortcut === 'disabled') return;

    let stopped = false;

    const pollClipboardCapture = async () => {
      try {
        const res = await fetch(`/api/clipboard-capture?since=${clipboardCaptureVersionRef.current}`, {
          cache: 'no-store',
        });

        if (!res.ok) return;

        const data = await res.json() as ClipboardCaptureResponse;
        if (stopped || data.version <= clipboardCaptureVersionRef.current) return;

        clipboardCaptureVersionRef.current = data.version;
        if (data.hasUpdate && data.text) {
          setSourceText(data.text);
        }
      } catch {
        // The local backend may be unavailable in pure browser preview.
      }
    };

    void pollClipboardCapture();
    const intervalId = window.setInterval(() => {
      void pollClipboardCapture();
    }, 350);

    return () => {
      stopped = true;
      window.clearInterval(intervalId);
    };
  }, [clipboardShortcut]);

  useEffect(() => {
    if (!wordMenu) return;

    const handleOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && wordMenuRef.current?.contains(target)) return;
      setWordMenu(null);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setWordMenu(null);
    };

    window.addEventListener('pointerdown', handleOutsidePointerDown, true);
    window.addEventListener('keydown', handleEscape, true);

    return () => {
      window.removeEventListener('pointerdown', handleOutsidePointerDown, true);
      window.removeEventListener('keydown', handleEscape, true);
    };
  }, [wordMenu]);

  const handleCleanText = () => {
    if (!sourceText) return;
    const cleaned = sourceText
      .replace(/-\n/g, '') // Remove hyphenation at end of lines
      .replace(/\n+/g, ' ') // Replace newlines with spaces
      .replace(/\s{2,}/g, ' ') // Replace multiple spaces with single space
      .trim();
    setSourceText(cleaned);
  };

  const handleSpeak = (text: string, lang: string) => {
    if (!text) return;
    
    // Stop any ongoing speech
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    // Simple language mapping for Web Speech API
    const langMap: Record<string, string> = {
      en: 'en-US',
      tr: 'tr-TR',
      de: 'de-DE',
      fr: 'fr-FR',
      es: 'es-ES',
      it: 'it-IT',
      zh: 'zh-CN',
      ja: 'ja-JP',
      ko: 'ko-KR',
      ru: 'ru-RU',
      ar: 'ar-SA',
      pt: 'pt-PT',
      nl: 'nl-NL',
      pl: 'pl-PL',
      el: 'el-GR',
      hi: 'hi-IN',
      sv: 'sv-SE',
      da: 'da-DK',
      fi: 'fi-FI',
    };
    utterance.lang = langMap[lang] || lang;
    
    window.speechSynthesis.speak(utterance);
  };

  const handleSwap = () => {
    const resolvedSourceLang = sourceLang === 'auto' ? detectedSourceLang || 'en' : sourceLang;
    setSourceLang(targetLang);
    setTargetLang(resolvedSourceLang);
    setSourceText(translatedText);
    setTranslatedText('');
    setDetectedSourceLang('');
  };

  const handleCopy = async () => {
    if (!translatedText) return;
    try {
      await writeClipboardText(translatedText);
      setCopyError('');
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      setCopyError(error instanceof Error ? error.message : 'Kopyalama başarısız oldu.');
      setTimeout(() => setCopyError(''), 3000);
    }
  };

  const handleSave = () => {
    if (!sourceText || !translatedText) return;
    addHistoryItem({
      sourceText,
      translatedText,
      sourceLang: activeSourceLang,
      targetLang,
      isFavorite: true,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleWordClick = async (token: string, index: number) => {
    const word = extractWord(token);
    if (!word) return;

    setWordMenu({ index, word, alternatives: [], loading: true });

    try {
      const res = await fetch('/api/word-alternatives', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          word,
          sentence: translatedText,
          source_text: sourceText,
          token_index: index,
          source_lang: activeSourceLang,
          target_lang: targetLang,
          quality: localModelQuality,
          provider: effectiveProvider,
          api_key: effectiveProvider === 'openai' ? apiKeys.openai : '',
        }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({})) as ApiErrorResponse;
        throw new Error(errorData.detail || 'Alternatifler alınamadı.');
      }

      const data = await res.json() as WordAlternativesResponse;
      setWordMenu({
        index,
        word,
        alternatives: data.alternatives.filter((item) => item.toLowerCase() !== word.toLowerCase()).slice(0, 6),
        loading: false,
      });
    } catch (error) {
      setWordMenu({
        index,
        word,
        alternatives: [],
        loading: false,
        error: error instanceof Error ? error.message : 'Alternatifler alınamadı.',
      });
    }
  };

  const handleAlternativeSelect = (index: number, alternative: string) => {
    const tokens = translatedText.split(/(\s+)/);
    tokens[index] = replaceWordInToken(tokens[index] ?? '', alternative);
    setTranslatedText(tokens.join(''));
    setWordMenu(null);
  };

  const handleFileDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    setFileError('');

    const droppedText = e.dataTransfer.getData('text/plain');
    if (droppedText.trim()) {
      setSourceText(droppedText);
      return;
    }
    
    const file = e.dataTransfer.files[0];
    if (!file) return;

    try {
      const text = await extractFileText(file);
      setSourceText(text);
    } catch (error) {
      setFileError(error instanceof Error ? error.message : 'Dosya okunamadı.');
      setTimeout(() => setFileError(''), 4000);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  return (
    <div className="flex-1 flex flex-col h-full max-w-6xl mx-auto w-full p-6">
      <div className="hidden items-center justify-between mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">LexiCore Çeviri</h1>
        
        <div className="flex items-center gap-2 bg-card rounded-full p-1 border border-border/50 shadow-sm">
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" className="rounded-full px-6 hover:bg-muted font-medium" />}>
              {sourceLang === 'auto' && detectedSourceLang
                ? `Dili algıla: ${LANGUAGES[detectedSourceLang as keyof typeof LANGUAGES] ?? detectedSourceLang}`
                : SOURCE_LANGUAGES[sourceLang as keyof typeof SOURCE_LANGUAGES]}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48 max-h-[300px] overflow-y-auto">
              {Object.entries(SOURCE_LANGUAGES).map(([code, name]) => (
                <DropdownMenuItem key={code} onClick={() => setSourceLang(code)}>
                  {name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <Button 
            variant="ghost" 
            size="icon" 
            className="rounded-full text-muted-foreground hover:text-foreground"
            onClick={handleSwap}
          >
            <ArrowRightLeft className="w-4 h-4" />
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" className="rounded-full px-6 hover:bg-muted font-medium" />}>
              {LANGUAGES[targetLang as keyof typeof LANGUAGES]}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48 max-h-[300px] overflow-y-auto">
              {Object.entries(LANGUAGES).map(([code, name]) => (
                <DropdownMenuItem key={code} onClick={() => setTargetLang(code)}>
                  {name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        
        <div className="w-[120px]" /> {/* Spacer for centering */}
      </div>

      <div className="flex-1 flex gap-6 min-h-[400px]">
        {/* Source Panel */}
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className={`flex-1 bg-card rounded-3xl border ${isDragging ? 'border-primary border-2 bg-primary/5 border-dashed' : 'border-border/50'} shadow-sm overflow-hidden flex flex-col group focus-within:ring-1 focus-within:ring-primary/20 transition-all relative`}
          onDrop={handleFileDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
        >
          {isDragging && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80 backdrop-blur-sm">
              <div className="flex flex-col items-center gap-3 text-primary">
                <Wand2 className="w-10 h-10 animate-bounce" />
                <span className="text-xl font-medium">Metni veya dosyayı bırakın</span>
              </div>
            </div>
          )}
          {sourceText && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-3 top-3 z-20 h-8 w-8 rounded-full text-muted-foreground hover:text-foreground"
              onClick={() => {
                setSourceText('');
                setTranslatedText('');
                setWordMenu(null);
                setDetectedSourceLang('');
              }}
              title="Kaynak metni temizle"
              aria-label="Kaynak metni temizle"
            >
              <X className="w-4 h-4" />
              <span className="sr-only">Kaynak metni temizle</span>
            </Button>
          )}
          <Textarea
            value={sourceText}
            onChange={(e) => setSourceText(e.target.value)}
            placeholder="Çevirmek istediğiniz metni yazın..."
            className="flex-1 resize-none border-0 focus-visible:ring-0 text-lg p-6 pr-14 bg-transparent placeholder:text-muted-foreground/60 leading-relaxed"
          />
          <div className="h-14 px-4 flex items-center justify-between border-t border-border/10 bg-muted/20">
            <div className="flex items-center gap-1 text-muted-foreground">
              <Button 
                variant="ghost" 
                size="icon" 
                className="rounded-full h-8 w-8 hover:text-foreground"
                onClick={() => handleSpeak(sourceText, activeSourceLang)}
                disabled={!sourceText}
              >
                <Volume2 className="w-4 h-4" />
              </Button>
              <Button 
                variant="ghost" 
                size="icon" 
                className="rounded-full h-8 w-8 hover:text-foreground"
                onClick={handleCleanText}
                disabled={!sourceText}
                title="Gereksiz satır atlamalarını ve PDF kırılmalarını temizle"
              >
                <Wand2 className="w-4 h-4" />
              </Button>
            </div>
            <div className="text-xs text-muted-foreground font-medium px-2 flex gap-3">
              {fileError ? (
                <span className="text-destructive">{fileError}</span>
              ) : stats && (
                <>
                  <span>{stats.chars} karakter</span>
                  <span className="w-1 h-1 rounded-full bg-border/50 self-center" />
                  <span>{stats.words} kelime</span>
                  <span className="w-1 h-1 rounded-full bg-border/50 self-center" />
                  <span>~{stats.readingTime} dk okuma</span>
                </>
              )}
            </div>
          </div>
        </motion.div>

        {/* Target Panel */}
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.1 }}
          className="flex-1 bg-card/60 backdrop-blur-sm rounded-3xl border border-border/50 shadow-sm overflow-hidden flex flex-col relative"
        >
          <AnimatePresence>
            {isTranslating && (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute top-6 left-6 flex gap-1"
              >
                <div className="w-2 h-2 rounded-full bg-primary/40 animate-pulse" />
                <div className="w-2 h-2 rounded-full bg-primary/40 animate-pulse delay-75" />
                <div className="w-2 h-2 rounded-full bg-primary/40 animate-pulse delay-150" />
              </motion.div>
            )}
          </AnimatePresence>
          {translatedText && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-3 top-3 z-20 h-8 w-8 rounded-full text-muted-foreground hover:text-foreground"
              onClick={() => {
                setTranslatedText('');
                setWordMenu(null);
              }}
              title="Çeviri sonucunu temizle"
              aria-label="Çeviri sonucunu temizle"
            >
              <X className="w-4 h-4" />
              <span className="sr-only">Çeviri sonucunu temizle</span>
            </Button>
          )}
          
          <div className="flex-1 p-6 pr-14 text-lg text-foreground leading-relaxed overflow-y-auto font-medium">
            {translatedText ? (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="whitespace-pre-wrap">
                {translatedText.split(/(\s+)/).map((token, index) => {
                  if (!hasWordCharacter(token)) return token;

                  const isSelected = wordMenu?.index === index;

                  return (
                    <span key={`${token}-${index}`} ref={isSelected ? wordMenuRef : undefined} className="relative inline-block">
                      <button
                        type="button"
                        onClick={() => handleWordClick(token, index)}
                        className="rounded-sm px-0.5 underline decoration-primary/30 decoration-dotted underline-offset-4 transition-colors hover:bg-primary/10 hover:text-primary"
                      >
                        {token}
                      </button>
                      {isSelected && (
                        <div className="absolute left-0 top-full z-30 mt-2 min-w-40 rounded-xl border border-border bg-popover p-2 text-sm text-popover-foreground shadow-lg">
                          <p className="px-2 pb-1 text-xs font-medium text-muted-foreground">{wordMenu.word}</p>
                          {wordMenu.loading ? (
                            <p className="px-2 py-1 text-muted-foreground">Yükleniyor...</p>
                          ) : wordMenu.error ? (
                            <p className="px-2 py-1 text-destructive">{wordMenu.error}</p>
                          ) : wordMenu.alternatives.length > 0 ? (
                            <div className="flex flex-col">
                              {wordMenu.alternatives.map((alternative) => (
                                <button
                                  key={alternative}
                                  type="button"
                                  onClick={() => handleAlternativeSelect(index, alternative)}
                                  className="rounded-lg px-2 py-1.5 text-left hover:bg-muted"
                                >
                                  {alternative}
                                </button>
                              ))}
                            </div>
                          ) : (
                            <p className="px-2 py-1 text-muted-foreground">Alternatif yok.</p>
                          )}
                        </div>
                      )}
                    </span>
                  );
                })}
              </motion.div>
            ) : (
              <span className="text-muted-foreground/40 font-normal">Çeviri burada görünecek...</span>
            )}
          </div>
          
          <div className="h-14 px-4 flex items-center justify-between border-t border-border/10 bg-muted/20">
            <div className="flex items-center gap-1 text-muted-foreground">
              <Button 
                variant="ghost" 
                size="icon" 
                className="rounded-full h-8 w-8 hover:text-foreground"
                onClick={() => handleSpeak(translatedText, targetLang)}
                disabled={!translatedText}
              >
                <Volume2 className="w-4 h-4" />
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={handleSave}
                disabled={!translatedText}
                className="rounded-full text-muted-foreground hover:text-amber-500 gap-2 h-8 px-3"
              >
                {saved ? <Check className="w-4 h-4 text-emerald-500" /> : <Star className="w-4 h-4" />}
                <span className="text-xs">Kaydet</span>
              </Button>
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={handleCopy}
                disabled={!translatedText}
                className="rounded-full text-muted-foreground hover:text-foreground gap-2 h-8 px-3"
              >
                {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                <span className="text-xs">{copyError || (copied ? 'Kopyalandı' : 'Kopyala')}</span>
              </Button>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
