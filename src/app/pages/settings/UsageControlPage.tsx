import React from 'react';
import { Activity, Clock3, ExternalLink, KeyRound, Loader2, RefreshCw, RotateCcw, Save, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';

import { Alert, AlertDescription, AlertTitle } from '@/app/components/ui/alert';
import { Badge } from '@/app/components/ui/badge';
import { Button } from '@/app/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/app/components/ui/card';
import { Input } from '@/app/components/ui/input';
import { Label } from '@/app/components/ui/label';
import { useMasterData } from '@/app/pages/master-data/context';
import { isOwnerLikeRole } from '@/app/data/roleHelpers';
import {
  DEFAULT_USAGE_CONTROL_SETTINGS,
  USAGE_CONTROL_SETTING_LIMITS,
  fetchUsageControlSettings,
  saveUsageControlSettingsLocally,
  saveUsageControlSettings,
  sanitizeUsageControlSettings,
  type UsageControlSettings,
} from '@/app/services/usageControlSettings';
import {
  exchangeGoogleAdsAuthorizationCode,
  fetchGoogleAdsAuthorizeUrl,
  fetchGoogleAdsTokenHealth,
  type GoogleAdsTokenHealthResponse,
} from '@/app/services/googleAdsLiveService';
import {
  exchangeTikTokAdsAuthorizationCode,
  fetchTikTokAdsAuthorizeUrl,
  fetchTikTokAdsTokenHealth,
  type TikTokAdsTokenHealthResponse,
} from '@/app/services/tiktokAdsLiveService';

type SettingField = {
  key: keyof Omit<UsageControlSettings, 'updatedAt' | 'updatedBy'>;
  label: string;
  description: string;
};

const SETTING_FIELDS: SettingField[] = [
  {
    key: 'permissionResumeRefreshMinutes',
    label: 'Permission refresh',
    description: 'Cek ulang hak akses saat tab kembali aktif atau koneksi online.',
  },
  {
    key: 'conversationOverviewRefreshMinutes',
    label: 'Live inbox overview',
    description: 'Refresh daftar percakapan live di Pusat Percakapan.',
  },
  {
    key: 'conversationMessageRefreshMinutes',
    label: 'Isi pesan live inbox',
    description: 'Refresh isi chat percakapan yang sedang dibuka.',
  },
  {
    key: 'monitoringShiftRefreshMinutes',
    label: 'Aktivitas teknisi',
    description: 'Refresh status absensi/shift di halaman Aktivitas Teknisi.',
  },
  {
    key: 'adsTodayLiveRefreshMinutes',
    label: 'Live ads hari ini',
    description: 'Sinkronisasi snapshot iklan hari ini dari Meta, Google, dan TikTok.',
  },
];

function formatHealthDate(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export function UsageControlPage() {
  const { currentRole, currentUser } = useMasterData();
  const canManage = isOwnerLikeRole(currentRole);
  const [settings, setSettings] = React.useState<UsageControlSettings>(DEFAULT_USAGE_CONTROL_SETTINGS);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [adsHealthLoading, setAdsHealthLoading] = React.useState(false);
  const [googleHealth, setGoogleHealth] = React.useState<GoogleAdsTokenHealthResponse | null>(null);
  const [tiktokHealth, setTikTokHealth] = React.useState<TikTokAdsTokenHealthResponse | null>(null);
  const [googleCode, setGoogleCode] = React.useState('');
  const [tiktokCode, setTikTokCode] = React.useState('');
  const [googleRedirectUri, setGoogleRedirectUri] = React.useState('');
  const [googleReconnectLoading, setGoogleReconnectLoading] = React.useState(false);
  const [tiktokReconnectLoading, setTikTokReconnectLoading] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;

    fetchUsageControlSettings({ force: true })
      .then((payload) => {
        if (!cancelled) setSettings(payload);
      })
      .catch((error) => {
        console.error('[UsageControl] Failed to load settings', error);
        toast.error('Pengaturan usage belum berhasil dimuat');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;

    const params = new URLSearchParams(window.location.search);
    const code = params.get('code') || params.get('auth_code') || '';
    const state = (params.get('state') || '').toLowerCase();

    if (!code) return;

    if (state.includes('tiktok')) {
      setTikTokCode(code);
      return;
    }

    setGoogleCode(code);
  }, []);

  const loadAdsHealth = React.useCallback(async () => {
    setAdsHealthLoading(true);
    try {
      const [google, tiktok] = await Promise.allSettled([
        fetchGoogleAdsTokenHealth(),
        fetchTikTokAdsTokenHealth(),
      ]);

      if (google.status === 'fulfilled') {
        setGoogleHealth(google.value);
      } else {
        setGoogleHealth({
          ok: false,
          checkedAt: new Date().toISOString(),
          apiVersion: '-',
          error: google.reason instanceof Error ? google.reason.message : 'Google Ads token health gagal.',
          configured: {
            developerToken: false,
            clientId: false,
            clientSecret: false,
            refreshToken: false,
            loginCustomerId: null,
            scopedCustomerIds: [],
          },
        });
      }

      if (tiktok.status === 'fulfilled') {
        setTikTokHealth(tiktok.value);
      } else {
        setTikTokHealth({
          ok: false,
          checkedAt: new Date().toISOString(),
          apiVersion: '-',
          error: tiktok.reason instanceof Error ? tiktok.reason.message : 'TikTok token health gagal.',
          configured: {
            appId: false,
            appSecret: false,
            redirectUri: null,
          },
          token: null,
        });
      }
    } finally {
      setAdsHealthLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (!canManage) return;
    void loadAdsHealth();
  }, [canManage, loadAdsHealth]);

  const updateSetting = (key: SettingField['key'], value: string) => {
    setSettings(prev => sanitizeUsageControlSettings({
      ...prev,
      [key]: value,
    }));
  };

  const handleSave = async () => {
    if (!canManage) return;

    setSaving(true);
    try {
      const payload = await saveUsageControlSettings({
        ...settings,
        updatedAt: new Date().toISOString(),
        updatedBy: currentUser?.email || currentUser?.name || currentUser?.id,
      });

      setSettings(payload);
      toast.success('Pengaturan usage berhasil disimpan');
    } catch (error) {
      console.error('[UsageControl] Failed to save settings', error);
      const localPayload = saveUsageControlSettingsLocally({
        ...settings,
        updatedAt: new Date().toISOString(),
        updatedBy: currentUser?.email || currentUser?.name || currentUser?.id,
      });

      setSettings(localPayload);
      toast.warning('Pengaturan disimpan lokal', {
        description: 'Supabase masih membatasi server, jadi setting berlaku di browser ini dulu. Simpan ulang setelah billing normal agar berlaku untuk semua user.',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setSettings(DEFAULT_USAGE_CONTROL_SETTINGS);
  };

  const handleOpenGoogleAuthorize = async () => {
    setGoogleReconnectLoading(true);
    try {
      const payload = await fetchGoogleAdsAuthorizeUrl();
      setGoogleRedirectUri(payload.configured.redirectUri);
      window.open(payload.authorizeUrl, '_blank', 'noopener,noreferrer');
      toast.info('Google Ads authorize dibuka', {
        description: 'Setelah approve, paste authorization code ke kolom Google Ads.',
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Gagal membuka authorize Google Ads');
    } finally {
      setGoogleReconnectLoading(false);
    }
  };

  const handleExchangeGoogleCode = async () => {
    if (!googleCode.trim()) {
      toast.error('Authorization code Google Ads wajib diisi');
      return;
    }

    setGoogleReconnectLoading(true);
    try {
      await exchangeGoogleAdsAuthorizationCode({
        code: googleCode.trim(),
        redirectUri: googleRedirectUri || undefined,
      });
      setGoogleCode('');
      toast.success('Google Ads berhasil reconnect');
      await loadAdsHealth();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Gagal reconnect Google Ads');
    } finally {
      setGoogleReconnectLoading(false);
    }
  };

  const handleOpenTikTokAuthorize = async () => {
    setTikTokReconnectLoading(true);
    try {
      const payload = await fetchTikTokAdsAuthorizeUrl();
      window.open(payload.authorizeUrl, '_blank', 'noopener,noreferrer');
      toast.info('TikTok Ads authorize dibuka', {
        description: 'Setelah approve, paste authorization code ke kolom TikTok Ads.',
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Gagal membuka authorize TikTok Ads');
    } finally {
      setTikTokReconnectLoading(false);
    }
  };

  const handleExchangeTikTokCode = async () => {
    if (!tiktokCode.trim()) {
      toast.error('Authorization code TikTok Ads wajib diisi');
      return;
    }

    setTikTokReconnectLoading(true);
    try {
      await exchangeTikTokAdsAuthorizationCode(tiktokCode.trim());
      setTikTokCode('');
      toast.success('TikTok Ads berhasil reconnect');
      await loadAdsHealth();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Gagal reconnect TikTok Ads');
    } finally {
      setTikTokReconnectLoading(false);
    }
  };

  if (!canManage) {
    return (
      <div className="mx-auto w-full max-w-5xl p-6">
        <Alert className="border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>Akses khusus Owner</AlertTitle>
          <AlertDescription>Pengaturan pembatasan refresh hanya bisa diubah oleh Owner atau Super Admin.</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-blue-600" />
            <h1 className="text-xl font-semibold text-slate-950 dark:text-slate-50">Kontrol Pemakaian</h1>
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Atur jeda refresh otomatis agar pemakaian Supabase lebih terkendali.
          </p>
        </div>
        <Badge variant="outline" className="w-fit border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/40 dark:bg-blue-950/30 dark:text-blue-200">
          Edge function friendly
        </Badge>
      </div>

      <Alert className="border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <Clock3 className="h-4 w-4" />
        <AlertTitle>Rekomendasi hemat</AlertTitle>
        <AlertDescription>
          Untuk kondisi normal, 15-30 menit cukup aman. Angka kecil membuat data lebih real-time, tapi request lebih sering.
        </AlertDescription>
      </Alert>

      <Card className="border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <CardHeader className="border-b border-slate-100 dark:border-slate-800">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle className="text-base">Koneksi API Iklan</CardTitle>
              <CardDescription>Reconnect Google Ads dan TikTok Ads dari token OAuth server.</CardDescription>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={loadAdsHealth} disabled={adsHealthLoading}>
              {adsHealthLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Cek status
            </Button>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 p-4 lg:grid-cols-2">
          <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                  <KeyRound className="h-4 w-4 text-blue-600" />
                  Google Ads
                </div>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Terakhir dicek {formatHealthDate(googleHealth?.checkedAt)}
                </p>
              </div>
              <Badge className={googleHealth?.ok ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'}>
                {googleHealth?.ok ? 'Tersambung' : 'Reconnect'}
              </Badge>
            </div>

            <div className="mt-3 space-y-1 text-xs text-slate-500 dark:text-slate-400">
              <div>API: {googleHealth?.apiVersion || '-'}</div>
              <div>Refresh token: {googleHealth?.configured.refreshToken ? 'ada' : 'belum ada'}</div>
              <div>Source: {googleHealth?.metadata?.refreshTokenSource || '-'}</div>
              <div>Akun accessible: {googleHealth?.accessibleCustomerCount ?? '-'}</div>
              {googleHealth?.error ? <div className="text-rose-600 dark:text-rose-300">{googleHealth.error}</div> : null}
            </div>

            <div className="mt-4 space-y-2">
              <Button type="button" variant="outline" onClick={handleOpenGoogleAuthorize} disabled={googleReconnectLoading}>
                {googleReconnectLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ExternalLink className="mr-2 h-4 w-4" />}
                Buka authorize
              </Button>
              <Input
                value={googleCode}
                onChange={(event) => setGoogleCode(event.target.value)}
                placeholder="Paste code Google Ads"
                autoComplete="off"
              />
              <Button type="button" onClick={handleExchangeGoogleCode} disabled={googleReconnectLoading || !googleCode.trim()}>
                Simpan token Google
              </Button>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                  <KeyRound className="h-4 w-4 text-slate-700 dark:text-slate-200" />
                  TikTok Ads
                </div>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Terakhir dicek {formatHealthDate(tiktokHealth?.checkedAt)}
                </p>
              </div>
              <Badge className={tiktokHealth?.ok ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'}>
                {tiktokHealth?.ok ? 'Tersambung' : 'Reconnect'}
              </Badge>
            </div>

            <div className="mt-3 space-y-1 text-xs text-slate-500 dark:text-slate-400">
              <div>API: {tiktokHealth?.apiVersion || '-'}</div>
              <div>Access token: {tiktokHealth?.token?.accessTokenAvailable ? 'ada' : 'belum ada'}</div>
              <div>Advertiser cache: {tiktokHealth?.cached?.advertiserCount ?? '-'}</div>
              <div>Business center cache: {tiktokHealth?.cached?.businessCenterCount ?? '-'}</div>
              {tiktokHealth?.error ? <div className="text-rose-600 dark:text-rose-300">{tiktokHealth.error}</div> : null}
            </div>

            <div className="mt-4 space-y-2">
              <Button type="button" variant="outline" onClick={handleOpenTikTokAuthorize} disabled={tiktokReconnectLoading}>
                {tiktokReconnectLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ExternalLink className="mr-2 h-4 w-4" />}
                Buka authorize
              </Button>
              <Input
                value={tiktokCode}
                onChange={(event) => setTikTokCode(event.target.value)}
                placeholder="Paste code TikTok Ads"
                autoComplete="off"
              />
              <Button type="button" onClick={handleExchangeTikTokCode} disabled={tiktokReconnectLoading || !tiktokCode.trim()}>
                Simpan token TikTok
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <CardHeader className="border-b border-slate-100 dark:border-slate-800">
          <CardTitle className="text-base">Interval Refresh Otomatis</CardTitle>
          <CardDescription>Semua nilai dalam menit dan berlaku untuk seluruh user setelah tersimpan.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex min-h-60 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {SETTING_FIELDS.map((field) => {
                const limits = USAGE_CONTROL_SETTING_LIMITS[field.key];

                return (
                  <div key={field.key} className="grid gap-3 p-4 sm:grid-cols-[1fr_180px] sm:items-center">
                    <div>
                      <Label htmlFor={field.key} className="text-sm font-medium text-slate-900 dark:text-slate-100">
                        {field.label}
                      </Label>
                      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{field.description}</p>
                      <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                        Min {limits.min} menit, maks {limits.max} menit.
                      </p>
                    </div>
                    <Input
                      id={field.key}
                      type="number"
                      min={limits.min}
                      max={limits.max}
                      step={limits.step}
                      value={settings[field.key]}
                      onChange={(event) => updateSetting(field.key, event.target.value)}
                      className="h-10"
                    />
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={handleReset} disabled={loading || saving}>
          <RotateCcw className="mr-2 h-4 w-4" />
          Reset default
        </Button>
        <Button type="button" onClick={handleSave} disabled={loading || saving}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Simpan pengaturan
        </Button>
      </div>
    </div>
  );
}
