import { useEffect, useId, useState } from 'react';
import { ChevronDown, Clock3 } from 'lucide-react';
import {
  ADS_DAILY_SYNC_HISTORY_UPDATED_EVENT,
  fetchAdsDailySyncUpdateHistory,
  formatAdsSyncHistoryTime,
  getAdsSyncHistoryOutcome,
  type AdsDailySyncUpdateHistory,
} from '@/app/services/adsDailySyncService';
import './ads-sync-history.css';

export function AdsSyncHistory({ isSyncing = false }: { isSyncing?: boolean }) {
  const [history, setHistory] = useState<AdsDailySyncUpdateHistory | null>(null);
  const [expanded, setExpanded] = useState(false);
  const historyId = useId();

  useEffect(() => {
    let disposed = false;
    let requestId = 0;
    const refresh = async () => {
      const currentRequest = ++requestId;
      const result = await fetchAdsDailySyncUpdateHistory();
      if (!disposed && currentRequest === requestId) setHistory(result);
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    void refresh();
    window.addEventListener(ADS_DAILY_SYNC_HISTORY_UPDATED_EVENT, refreshWhenVisible);
    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    const interval = window.setInterval(refreshWhenVisible, 60_000);
    return () => {
      disposed = true;
      window.clearInterval(interval);
      window.removeEventListener(ADS_DAILY_SYNC_HISTORY_UPDATED_EVENT, refreshWhenVisible);
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [isSyncing]);

  const lastUpdate = history?.lastUpdate;

  return (
    <section className="adsSyncHistory" aria-label="Pembaruan terakhir data iklan">
      <div className="adsSyncHistoryBar">
        <div className="adsSyncHistoryLatest" role="status">
          <Clock3 size={16} aria-hidden="true" />
          <div className="adsSyncHistoryCopy">
            <p>
              <span>Data diperbarui: </span>
              {!history ? 'Memuat...' : lastUpdate ? (
                <time dateTime={lastUpdate.createdAt}>{formatAdsSyncHistoryTime(lastUpdate.createdAt)}</time>
              ) : 'Belum ada pembaruan tercatat'}
              <span className="adsSyncHistorySchedule">Otomatis tiap 15 menit</span>
            </p>
          </div>
        </div>
        {lastUpdate && (
          <button
            type="button"
            className="adsSyncHistoryToggle"
            aria-expanded={expanded}
            aria-controls={historyId}
            onClick={() => setExpanded((value) => !value)}
            title="Detail pembaruan terakhir"
          >
            Detail <ChevronDown size={14} aria-hidden="true" />
          </button>
        )}
      </div>
      {history?.source === 'local' && (
        <p className="adsSyncHistoryWarning">Riwayat database belum tersedia. Menampilkan catatan lokal.</p>
      )}
      {lastUpdate && (
        <div className="adsSyncHistoryDetails" id={historyId} hidden={!expanded}>
          <p>
            {lastUpdate.actorName || 'Pengguna tidak tercatat'}
            {' / Periode '}{lastUpdate.range.from}{' s/d '}{lastUpdate.range.to}
            {' / '}{getAdsSyncHistoryOutcome(lastUpdate)}
            {' / '}{lastUpdate.counts.inserted} ditambah, {lastUpdate.counts.updated} diperbarui
          </p>
        </div>
      )}
    </section>
  );
}
