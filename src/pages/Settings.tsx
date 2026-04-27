import { useEffect, useState } from 'react';
import { useStore, type ClipboardShortcut, type LocalModelQuality, type Provider, type Theme } from '@/store';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Moon, Sun, Monitor, HardDrive, Shield, Globe, Keyboard, RefreshCw } from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

interface ModelStatus {
  cacheDir: string;
  fileCount: number;
  totalSizeLabel: string;
  ayaModelReady: boolean;
}

export default function Settings() {
  const {
    theme,
    setTheme,
    provider,
    setProvider,
    apiKeys,
    setApiKeys,
    localModelQuality,
    setLocalModelQuality,
    localOnlyProcessing,
    setLocalOnlyProcessing,
    clipboardShortcut,
    setClipboardShortcut,
    resetAllData,
  } = useStore();
  const [modelStatus, setModelStatus] = useState<ModelStatus | null>(null);

  const refreshModelStatus = async () => {
    try {
      const response = await fetch('/api/model-status');
      if (response.ok) {
        setModelStatus(await response.json() as ModelStatus);
      }
    } catch {
      setModelStatus(null);
    }
  };

  useEffect(() => {
    void refreshModelStatus();
  }, []);

  const handleResetAllData = () => {
    if (window.confirm('Geçmiş, API anahtarları ve tüm ayarlar sıfırlansın mı?')) {
      resetAllData();
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full max-w-3xl mx-auto w-full p-8 overflow-y-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">Ayarlar</h1>
        <p className="text-muted-foreground mt-1">Uygulama tercihlerinizi ve yerel modellerinizi yönetin.</p>
      </div>

      <div className="space-y-6">
        <Card className="rounded-3xl border-border/50 shadow-sm overflow-hidden">
          <CardHeader className="bg-muted/30 pb-4">
            <CardTitle className="text-lg flex items-center gap-2">
              <Globe className="w-5 h-5 text-primary" /> Çeviri Sağlayıcısı & API
            </CardTitle>
            <CardDescription>Bulut tabanlı çeviri motorlarını ve API anahtarlarınızı yapılandırın.</CardDescription>
          </CardHeader>
          <CardContent className="p-6 space-y-6">
            <div className="flex flex-col gap-3">
              <div className="space-y-0.5">
                <Label className="text-base">Aktif Çeviri Motoru</Label>
                <p className="text-sm text-muted-foreground">İşlemleri hangi servisin yapacağını seçin.</p>
              </div>
              <Select value={provider} onValueChange={(value) => setProvider(value as Provider)}>
                <SelectTrigger className="w-full rounded-xl h-12 bg-background border-border/50 focus:ring-primary/20 transition-all">
                  <SelectValue placeholder="Çeviri Servisi Seç" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mymemory">MyMemory (Ücretsiz Sınırlı, Anahtarsız)</SelectItem>
                  <SelectItem value="deepl">DeepL API (Ücretsiz/Pro Anahtar Gerektirir)</SelectItem>
                  <SelectItem value="openai">OpenAI (Fiyat/Performans, Anahtar Gerektirir)</SelectItem>
                  <SelectItem value="local">Yerel Motor (Opus-MT, Cihazınızda Çalışır)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {provider === 'local' && (
              <div className="space-y-6 animate-in fade-in zoom-in-95 duration-200">
                <div className="p-4 bg-primary/10 rounded-xl border border-primary/20">
                  <p className="text-sm font-medium text-primary mb-1">Yerel Motor Aktif</p>
                  <p className="text-xs text-muted-foreground">Bu seçenek seçildiğinde, çeviriler bilgisayarınızdaki (localhost:8000) Python sunucusunda çalışır. Çeviri tamamen çevrimdışı ve gizlidir.</p>
                </div>
                
                <div className="space-y-3">
                  <Label className="text-base">Model Kalitesi (Local Quality)</Label>
                  <Select value={localModelQuality} onValueChange={(value) => setLocalModelQuality(value as LocalModelQuality)}>
                    <SelectTrigger className="w-full rounded-xl h-12 bg-background border-border/50 focus:ring-primary/20 transition-all">
                      <SelectValue placeholder="Kalite Seçin" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="fast">Hızlı Mod (Opus-MT) - ~300MB, Çok Hızlı</SelectItem>
                      <SelectItem value="high">Yüksek Kalite (NLLB-200) - ~2.5GB, Derin Bağlam</SelectItem>
                      <SelectItem value="ultra">Ultra Kalite (Aya-23 LLM) - ~4.8GB, Akıl Yürütme ve Doğallık</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">Ultra Kalite (Aya-23) devasa bir modeldir (8 Milyar Parametre). İlk çeviride modeli indirirken internet hızınıza bağlı olarak bekletebilir ve cihazınızda en az 6-8 GB RAM gerektirir. Model güncellemeleri otomatik yapılır.</p>
                </div>
              </div>
            )}

            {provider === 'deepl' && (
              <div className="space-y-3 animate-in fade-in zoom-in-95 duration-200">
                <Label className="text-base">DeepL Auth Key</Label>
                <Input 
                  type="password" 
                  value={apiKeys.deepl}
                  onChange={(e) => setApiKeys({ deepl: e.target.value })}
                  placeholder="DeepL API anahtarınızı girin..."
                  className="rounded-xl h-12 bg-background border-border/50 focus-visible:ring-primary/20"
                />
                <p className="text-xs text-muted-foreground">Anahtarınız bu cihazda localStorage içinde saklanır ve çeviri isteği sırasında yalnızca yerel LexiCore backend'ine gönderilir.</p>
              </div>
            )}

            {provider === 'openai' && (
              <div className="space-y-3 animate-in fade-in zoom-in-95 duration-200">
                <Label className="text-base">OpenAI API Key</Label>
                <Input 
                  type="password" 
                  value={apiKeys.openai}
                  onChange={(e) => setApiKeys({ openai: e.target.value })}
                  placeholder="sk-..."
                  className="rounded-xl h-12 bg-background border-border/50 focus-visible:ring-primary/20"
                />
                <p className="text-xs text-muted-foreground">GPT-4o-mini modeli yerel backend üzerinden çağrılır. Anahtarınız bu cihazda localStorage içinde saklanır.</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-3xl border-border/50 shadow-sm overflow-hidden">
          <CardHeader className="bg-muted/30 pb-4">
            <CardTitle className="text-lg flex items-center gap-2">
              <Keyboard className="w-5 h-5 text-primary" /> Kısayollar
            </CardTitle>
            <CardDescription>Panodan hızlı metin alma davranışını seçin.</CardDescription>
          </CardHeader>
          <CardContent className="p-6 space-y-4">
            <div className="flex flex-col gap-3">
              <div className="space-y-0.5">
                <Label className="text-base">Pano Kısayolu</Label>
                <p className="text-sm text-muted-foreground">Seçilen kısayol panodaki metni kaynak alana taşır.</p>
              </div>
              <Select value={clipboardShortcut} onValueChange={(value) => setClipboardShortcut(value as ClipboardShortcut)}>
                <SelectTrigger className="w-full rounded-xl h-12 bg-background border-border/50 focus:ring-primary/20 transition-all">
                  <SelectValue placeholder="Kısayol seç" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ctrl_c_c">Ctrl/Cmd + C, C</SelectItem>
                  <SelectItem value="ctrl_shift_c">Ctrl/Cmd + Shift + C</SelectItem>
                  <SelectItem value="ctrl_alt_c">Ctrl/Cmd + Alt + C</SelectItem>
                  <SelectItem value="disabled">Kapalı</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-3xl border-border/50 shadow-sm overflow-hidden">
          <CardHeader className="bg-muted/30 pb-4">
            <CardTitle className="text-lg flex items-center gap-2">
              <Monitor className="w-5 h-5 text-primary" /> Görünüm
            </CardTitle>
            <CardDescription>Tema ve arayüz tercihlerini yapılandırın.</CardDescription>
          </CardHeader>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-base">Tema</Label>
                <p className="text-sm text-muted-foreground">Uygulama temasını seçin.</p>
              </div>
              <Select value={theme} onValueChange={(value) => setTheme(value as Theme)}>
                <SelectTrigger className="w-[180px] rounded-xl h-10">
                  <SelectValue placeholder="Tema seç" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="light">Aydınlık <Sun className="w-4 h-4 ml-2 inline" /></SelectItem>
                  <SelectItem value="dark">Karanlık <Moon className="w-4 h-4 ml-2 inline" /></SelectItem>
                  <SelectItem value="system">Sistem <Monitor className="w-4 h-4 ml-2 inline" /></SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-3xl border-border/50 shadow-sm overflow-hidden">
          <CardHeader className="bg-muted/30 pb-4">
            <CardTitle className="text-lg flex items-center gap-2">
              <HardDrive className="w-5 h-5 text-primary" /> Çevrimdışı Modeller
            </CardTitle>
            <CardDescription>Yerel model önbelleğini ve yalnızca yerel işleme tercihlerini yönetin.</CardDescription>
          </CardHeader>
          <CardContent className="p-6 space-y-6">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-base">Model Önbelleği</Label>
                <p className="text-sm text-muted-foreground">
                  {modelStatus
                    ? `${modelStatus.fileCount} dosya • ${modelStatus.totalSizeLabel}`
                    : 'Model durumu okunamadı.'}
                </p>
                {modelStatus && (
                  <p className="text-xs text-muted-foreground max-w-md truncate">
                    {modelStatus.cacheDir}
                  </p>
                )}
              </div>
              <Button variant="outline" size="sm" onClick={refreshModelStatus} className="rounded-full gap-2">
                <RefreshCw className="w-3.5 h-3.5" />
                Yenile
              </Button>
            </div>
            
            <Separator className="bg-border/50" />

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-base">Aya-23 Ultra Model</Label>
                <p className="text-sm text-muted-foreground">
                  {modelStatus?.ayaModelReady ? 'GGUF model dosyası önbellekte.' : 'Henüz indirilmemiş; ultra mod ilk kullanımda indirir.'}
                </p>
              </div>
              <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-medium">
                {modelStatus?.ayaModelReady ? 'Hazır' : 'Yok'}
              </span>
            </div>

            <Separator className="bg-border/50" />
            
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-base">Sadece Yerel İşleme</Label>
                <p className="text-sm text-muted-foreground max-w-md">
                  Açıkken çeviri ekranı bulut sağlayıcı yerine yerel modeli kullanır.
                </p>
              </div>
              <Switch checked={localOnlyProcessing} onCheckedChange={setLocalOnlyProcessing} />
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-3xl border-border/50 shadow-sm overflow-hidden">
          <CardHeader className="bg-muted/30 pb-4">
            <CardTitle className="text-lg flex items-center gap-2">
              <Shield className="w-5 h-5 text-primary" /> Gizlilik & Güvenlik
            </CardTitle>
            <CardDescription>Yerel verileri ve kayıtlı tercihleri yönetin.</CardDescription>
          </CardHeader>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-base text-destructive">Tüm Verileri Sil</Label>
                <p className="text-sm text-muted-foreground">Geçmiş, favoriler, API anahtarları ve ayarları sıfırla.</p>
              </div>
              <Button variant="destructive" onClick={handleResetAllData} className="rounded-xl">
                Sıfırla
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
