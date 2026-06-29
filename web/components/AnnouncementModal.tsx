'use client'

export function AnnouncementModal({ title, body, onClose }: { title: string; body: string; onClose: () => void }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1100,
        background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(3px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          maxWidth: 560, width: '100%', background: 'var(--bg2, #0e0a18)',
          border: '1px solid var(--mag)', boxShadow: '0 0 40px rgba(232,52,198,0.3)',
          padding: 24, position: 'relative', maxHeight: '85vh', overflowY: 'auto',
        }}
      >
        <button onClick={onClose} aria-label="close" style={{
          position: 'absolute', top: 10, right: 14, background: 'none', border: 'none',
          color: 'var(--txt-dim)', fontSize: '1.3rem', cursor: 'pointer',
        }}>×</button>
        <div style={{ fontSize: '0.65rem', letterSpacing: '0.2em', color: 'var(--cyan)', marginBottom: 8 }}>
          ANNOUNCEMENTS
        </div>
        <h2 style={{ fontFamily: 'var(--hud)', fontSize: '1.4rem', color: 'var(--mag)', marginBottom: 14 }}>
          {title || 'CyberKiller'}
        </h2>
        <div style={{ fontFamily: 'var(--body)', color: 'var(--txt-bright)', fontSize: '0.9rem', lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>
          {body || 'No announcements right now. Check back soon.'}
        </div>
      </div>
    </div>
  )
}
