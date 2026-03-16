import type { Receipt } from '../../hooks/useReceipts';
import { GRADE_LABEL, STATUS_LABEL, STATUS_CLASS } from '../../hooks/useReceipts';

const COMMODITY_ICON: Record<string, string> = {
  MAIZE: '🌽', COFFEE: '☕', WHEAT: '🌾', RICE: '🍚',
};

interface Props {
  receipt: Receipt;
  onClick?: () => void;
  compact?: boolean;
}

export function ReceiptCard({ receipt: r, onClick, compact }: Props) {
  const icon = COMMODITY_ICON[r.commodityType] ?? '📦';
  const isExpired = r.expiryTimestamp < new Date();
  const valuationFmt = r.valuationKes.toLocaleString('en-KE', { maximumFractionDigits: 0 });

  if (compact) {
    return (
      <div className="receipt-card-compact" onClick={onClick} style={{ cursor: onClick ? 'pointer' : 'default' }}>
        <span className="rc-compact-icon">{icon}</span>
        <div className="rc-compact-body">
          <span className="rc-compact-id">oCR #{r.tokenId}</span>
          <span className="rc-compact-detail">{r.weightKg}kg {r.commodityType} · Grade {GRADE_LABEL[r.grade]}</span>
        </div>
        <div className="rc-compact-right">
          <span className="rc-compact-value">KES {valuationFmt}</span>
          <span className={`badge ${STATUS_CLASS[r.status]}`}>{STATUS_LABEL[r.status]}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="receipt-card card" onClick={onClick} style={{ cursor: onClick ? 'pointer' : 'default' }}>
      <div className="receipt-card-top">
        <div className="receipt-icon">{icon}</div>
        <div className="receipt-id">oCR #{r.tokenId}</div>
        <span className={`badge ${STATUS_CLASS[r.status]}`}>{STATUS_LABEL[r.status]}</span>
      </div>

      <div className="receipt-commodity">{r.commodityType}</div>

      <div className="receipt-metrics">
        <div className="receipt-metric">
          <span className="stat-label">Weight</span>
          <span className="receipt-metric-value">{r.weightKg.toLocaleString()} kg</span>
        </div>
        <div className="receipt-metric">
          <span className="stat-label">Grade</span>
          <span className="receipt-metric-value">Grade {GRADE_LABEL[r.grade]}</span>
        </div>
        <div className="receipt-metric">
          <span className="stat-label">Valuation</span>
          <span className="receipt-metric-value" style={{ color: 'var(--green-bright)' }}>
            KES {valuationFmt}
          </span>
        </div>
      </div>

      <div className="receipt-warehouse">
        <span style={{ color: 'var(--green-dim)' }}>⬡</span>
        {r.warehouseId}
      </div>

      <div className="receipt-footer">
        <span className="receipt-mpesa">{r.mpesaRef}</span>
        {isExpired && <span className="badge badge-red">EXPIRED</span>}
      </div>
    </div>
  );
}