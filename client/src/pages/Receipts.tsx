import { useState } from 'react';
import { useReceipts, type Receipt } from '../hooks/useReceipts';
import '../styles/receipts.css';
import { ReceiptCard } from '../components/cards/ReceiptCard';

const COMMODITY_ICON: Record<string, string> = {
  MAIZE:  '🌽',
  COFFEE: '☕',
  WHEAT:  '🌾',
  RICE:   '🍚',
};

export function Receipts() {
  const { receipts, loading } = useReceipts();
  const [selected, setSelected] = useState<Receipt | null>(null);
  const [filter, setFilter] = useState<'all' | 'active' | 'locked' | 'redeemed'>('all');

  const filtered = receipts.filter(r => {
    if (filter === 'all')     return true;
    if (filter === 'active')  return r.status === 0;
    if (filter === 'locked')  return r.status === 1;
    if (filter === 'redeemed')return r.status === 2;
    return true;
  });

  return (
    <div className="receipts-page animate-in">
      <div className="page-header">
        <h1 className="page-title">Commodity Receipts</h1>
        <p className="page-subtitle">On-chain grain receipts (oCR) · ERC-721 NFTs on Hedera EVM</p>
      </div>

      {/* Filter tabs */}
      <div className="filter-tabs animate-in-2">
        {(['all', 'active', 'locked', 'redeemed'] as const).map(f => (
          <button
            key={f}
            className={`filter-tab ${filter === f ? 'active' : ''}`}
            onClick={() => setFilter(f)}
          >
            {f.toUpperCase()}
            <span className="filter-count">
              {f === 'all' ? receipts.length
                : receipts.filter(r =>
                    f === 'active' ? r.status === 0
                    : f === 'locked' ? r.status === 1
                    : r.status === 2
                  ).length}
            </span>
          </button>
        ))}
      </div>

      {/* Grid */}
      {loading ? (
        <div className="grid-auto animate-in-3">
          {[1,2,3,4,5,6].map(i => (
            <div key={i} className="skeleton" style={{height: 220}} />
          ))}
        </div>
      ) : (
        <div className="grid-auto animate-in-3">
          {filtered.map(r => (
            <ReceiptCard
              key={r.tokenId}
              receipt={r}
              onClick={() => setSelected(r)}
            />
          ))}
        </div>
      )}

      {/* Detail modal */}
      {selected && (
        <ReceiptModal receipt={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

// function ReceiptCard({ receipt: r, onClick }: { receipt: Receipt; onClick: () => void }) {
//   const icon = COMMODITY_ICON[r.commodityType] ?? '📦';
//   const isExpired = r.expiryTimestamp < new Date();

//   return (
//     <div className="receipt-card card" onClick={onClick}>
//       <div className="receipt-card-top">
//         <div className="receipt-icon">{icon}</div>
//         <div className="receipt-id">oCR #{r.tokenId}</div>
//         <span className={`badge ${STATUS_CLASS[r.status]}`}>{STATUS_LABEL[r.status]}</span>
//       </div>

//       <div className="receipt-commodity">{r.commodityType}</div>

//       <div className="receipt-metrics">
//         <div className="receipt-metric">
//           <span className="stat-label">Weight</span>
//           <span className="receipt-metric-value">{r.weightKg.toLocaleString()} kg</span>
//         </div>
//         <div className="receipt-metric">
//           <span className="stat-label">Grade</span>
//           <span className="receipt-metric-value grade-{r.grade}">
//             Grade {GRADE_LABEL[r.grade]}
//           </span>
//         </div>
//         <div className="receipt-metric">
//           <span className="stat-label">Valuation</span>
//           <span className="receipt-metric-value green">
//             KES {r.valuationKes.toLocaleString('en-KE', { maximumFractionDigits: 0 })}
//           </span>
//         </div>
//       </div>

//       <div className="receipt-warehouse">
//         <span className="receipt-warehouse-icon">⬡</span>
//         {r.warehouseId}
//       </div>

//       <div className="receipt-footer">
//         <span className="receipt-mpesa">{r.mpesaRef}</span>
//         {isExpired && <span className="badge badge-red">EXPIRED</span>}
//       </div>
//     </div>
//   );
// }

function ReceiptModal({ receipt: r, onClose }: { receipt: Receipt; onClose: () => void }) {
  const icon = COMMODITY_ICON[r.commodityType] ?? '📦';
  const daysLeft = Math.max(0, Math.floor((r.expiryTimestamp.getTime() - Date.now()) / 86_400_000));

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-row">
            <span className="modal-icon">{icon}</span>
            <div>
              <h2 className="modal-title">oCR #{r.tokenId}</h2>
              <p className="modal-sub">{r.commodityType} · Hedera Testnet</p>
            </div>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          <div className="modal-grid">
            {/* <ModalField label="Status"       value={<span className={`badge ${STATUS_CLASS[r.status]}`}>{STATUS_LABEL[r.status]}</span>} /> */}
            {/* <ModalField label="Grade"        value={`Grade ${GRADE_LABEL[r.grade]}`} /> */}
            <ModalField label="Weight"       value={`${r.weightKg.toLocaleString()} kg`} />
            <ModalField label="Valuation"    value={`KES ${r.valuationKes.toLocaleString('en-KE',{maximumFractionDigits:0})}`} green />
            <ModalField label="Warehouse"    value={r.warehouseId} />
            <ModalField label="MPESA Ref"    value={r.mpesaRef} />
            <ModalField label="Issued"       value={r.issuedAt.toLocaleDateString()} />
            <ModalField label="Expires"      value={`${r.expiryTimestamp.toLocaleDateString()} (${daysLeft}d left)`} />
          </div>

          <div className="divider" />

          <div className="modal-field">
            <span className="stat-label">Custodian</span>
            <code className="modal-address">{r.custodian}</code>
          </div>
          <div className="modal-field" style={{marginTop:'var(--space-3)'}}>
            <span className="stat-label">Farmer</span>
            <code className="modal-address">{r.farmer}</code>
          </div>

          <div className="modal-actions">
            <a
              className="btn btn-outline"
              href={`https://hashscan.io/testnet/contract/${r.tokenId}`}
              target="_blank"
              rel="noreferrer"
            >
              View on HashScan ↗
            </a>
            {r.status === 0 && (
              <button className="btn btn-primary">Lock as Collateral →</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ModalField({ label, value, green }: { label: string; value: any; green?: boolean }) {
  return (
    <div className="modal-field">
      <span className="stat-label">{label}</span>
      <span style={{ color: green ? 'var(--green-bright)' : 'var(--text-primary)', fontSize: '0.85rem', fontWeight: 600 }}>
        {value}
      </span>
    </div>
  );
}