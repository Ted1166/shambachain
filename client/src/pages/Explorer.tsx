import { useState, useEffect } from 'react';
import axios from 'axios';
import { MIRROR_NODE, HCS_TOPIC_ID } from '../config/contracts';
import { Loader } from '../components/ui/Loader';
import '../styles/explorer.css';

interface HCSMessage {
  sequenceNumber: number;
  consensusTimestamp: string;
  message: string;
  parsed: any;
}

export function Explorer() {
  const [messages, setMessages] = useState<HCSMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<HCSMessage | null>(null);

  useEffect(() => {
    async function fetch() {
      setLoading(true);
      try {
        const res = await axios.get(
          `${MIRROR_NODE}/api/v1/topics/${HCS_TOPIC_ID}/messages?limit=25&order=desc`
        );
        const msgs: HCSMessage[] = (res.data?.messages ?? []).map((m: any) => {
          let parsed: any = null;
          try {
            const decoded = atob(m.message);
            parsed = JSON.parse(decoded);
          } catch {}
          return {
            sequenceNumber: m.sequence_number,
            consensusTimestamp: m.consensus_timestamp,
            message: m.message,
            parsed,
          };
        });
        setMessages(msgs);
      } finally {
        setLoading(false);
      }
    }
    fetch();
    const id = setInterval(fetch, 30_000);
    return () => clearInterval(id);
  }, []);

  function formatTs(ts: string) {
    const d = new Date(parseFloat(ts) * 1000);
    return d.toLocaleString('en-KE');
  }

  function msgType(parsed: any): string {
    if (!parsed) return 'RAW';
    return parsed.type ?? parsed.event ?? parsed.action ?? 'MSG';
  }

  function msgColor(type: string): string {
    if (type.includes('DEPOSIT') || type.includes('MINT')) return 'badge-green';
    if (type.includes('LOAN') || type.includes('COLLATERAL'))  return 'badge-amber';
    if (type.includes('RISK') || type.includes('LIQUIDAT'))    return 'badge-red';
    return 'badge-muted';
  }

  return (
    <div className="explorer-page animate-in">
      <div className="page-header">
        <h1 className="page-title">HCS Explorer</h1>
        <p className="page-subtitle">
          Hedera Consensus Service audit trail ·{' '}
          <a
            href={`https://hashscan.io/testnet/topic/${HCS_TOPIC_ID}`}
            target="_blank" rel="noreferrer"
          >
            Topic {HCS_TOPIC_ID} ↗
          </a>
        </p>
      </div>

      <div className="explorer-layout animate-in-2">
        {/* Message list */}
        <div className="card explorer-list-card">
          <div className="card-header-row">
            <h2 className="card-title">Consensus Messages</h2>
            <span className="badge badge-green">
              <span className="pulse-dot" /> Live
            </span>
          </div>

          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-10)' }}>
              <Loader size={32} label="Fetching HCS messages..." />
            </div>
          ) : messages.length === 0 ? (
            <div className="empty-state">No messages yet on this topic</div>
          ) : (
            <div className="message-list">
              {messages.map(msg => (
                <div
                  key={msg.sequenceNumber}
                  className={`message-row ${selected?.sequenceNumber === msg.sequenceNumber ? 'selected' : ''}`}
                  onClick={() => setSelected(msg)}
                >
                  <div className="message-seq">#{msg.sequenceNumber}</div>
                  <div className="message-body">
                    <div className="message-top">
                      <span className={`badge ${msgColor(msgType(msg.parsed))}`}>
                        {msgType(msg.parsed)}
                      </span>
                      <span className="message-ts">{formatTs(msg.consensusTimestamp)}</span>
                    </div>
                    {msg.parsed && (
                      <div className="message-preview">
                        {msg.parsed.mpesaRef && `MPESA: ${msg.parsed.mpesaRef} · `}
                        {msg.parsed.commodityType && `${msg.parsed.commodityType} `}
                        {msg.parsed.weightKg && `${msg.parsed.weightKg}kg `}
                        {msg.parsed.warehouseId && `· ${msg.parsed.warehouseId}`}
                        {!msg.parsed.commodityType && JSON.stringify(msg.parsed).slice(0, 80)}
                      </div>
                    )}
                    {!msg.parsed && (
                      <div className="message-preview raw">{atob(msg.message).slice(0, 80)}</div>
                    )}
                  </div>
                  <div className="message-arrow">›</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Detail pane */}
        <div className="card explorer-detail-card">
          {selected ? (
            <>
              <div className="card-header-row">
                <h2 className="card-title">Message #{selected.sequenceNumber}</h2>
                <span className={`badge ${msgColor(msgType(selected.parsed))}`}>
                  {msgType(selected.parsed)}
                </span>
              </div>
              <div className="detail-field">
                <span className="stat-label">Consensus Timestamp</span>
                <span className="detail-value">{formatTs(selected.consensusTimestamp)}</span>
              </div>
              <div className="divider" />
              <div className="detail-field">
                <span className="stat-label">Raw (Base64)</span>
                <code className="detail-raw">{selected.message}</code>
              </div>
              <div className="divider" />
              <div className="detail-field">
                <span className="stat-label">Decoded JSON</span>
                <pre className="detail-json">
                  {selected.parsed
                    ? JSON.stringify(selected.parsed, null, 2)
                    : atob(selected.message)}
                </pre>
              </div>
            </>
          ) : (
            <div className="explorer-empty">
              <div className="explorer-empty-icon">≡</div>
              <div className="explorer-empty-text">Select a message to inspect</div>
              <div className="explorer-empty-sub">
                All deposits, mints, and risk events are written to HCS<br/>
                providing an immutable tamper-proof audit trail.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}