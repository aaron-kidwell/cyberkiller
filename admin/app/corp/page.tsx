'use client'

import { useCallback, useEffect, useState } from 'react'
import { adminFetch } from '../../lib/api'
import { ScenarioMachines, SMachine } from '../../components/ScenarioMachines'

type CorpMachine = {
  name: string; display: string; role: string; arena_ip: string; tier: string
  status: string; healthy: boolean; king_handle: string
  user_flag_captured: boolean; root_flag_captured: boolean; user_flag_by?: string
}

export default function CorpPage() {
  const [raw, setRaw] = useState<CorpMachine[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const data = await adminFetch('/admin/corp/machines')
      setRaw(data ?? []); setError('')
    } catch (e: any) { setError(e.message) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const enabled = raw.length > 0
  const machines: SMachine[] = raw.map(m => ({
    key: m.arena_ip, name: m.name, subtitle: m.display || m.role, arena_ip: m.arena_ip, tier: m.tier,
    healthy: m.healthy, king_handle: m.king_handle, user_flag_by: m.user_flag_by, badge: 'Linux',
    userCap: m.user_flag_captured, rootCap: m.root_flag_captured,
  }))

  return (
    <ScenarioMachines
      title="MERIDIAN - Example Corporate Network"
      live={enabled}
      liveNote={enabled
        ? 'MERIDIAN is online: a fixed 10-box Linux breach chain, always on.'
        : 'MERIDIAN is not enabled. Set CORP_ORCHESTRATION=true and restart the API to ship it as an example scenario.'}
      machines={machines}
      loading={loading}
      error={error}
      emptyHint={<>No MERIDIAN machines registered. Set <code>CORP_ORCHESTRATION=true</code>, then restart the API.</>}
      onRefresh={load}
      headerActions={[
        { label: '⟲ Re-Provision All', color: 'var(--red)', disabled: !enabled,
          confirm: 'Respawn every MERIDIAN box? Re-seeds flags and clears captures on all 10.',
          run: async () => {
            for (const m of raw) {
              await adminFetch(`/admin/corp/${m.arena_ip}/reset`, { method: 'POST' }).catch(() => {})
            }
            return { status: `respawning ${raw.length} machines` }
          } },
      ]}
      rowActions={[
        { label: 'Test', color: 'var(--txt-dim)',
          run: (m) => adminFetch(`/admin/corp/${m.arena_ip}/test`, { method: 'POST' }) },
        { label: 'Reset', color: 'var(--cyan)',
          confirm: (m) => `Respawn ${m.name}? Re-seeds its flags and clears captures.`,
          run: (m) => adminFetch(`/admin/corp/${m.arena_ip}/reset`, { method: 'POST' }) },
        { label: 'Clear Holder', color: 'var(--amber)', disabled: (m) => !m.king_handle,
          confirm: (m) => `Clear the current holder on ${m.name}?`,
          run: (m) => adminFetch(`/admin/corp/${m.arena_ip}/clear-king`, { method: 'POST' }) },
      ]}
      footer={<>
        <div style={{ fontWeight: 600, color: 'var(--txt)', marginBottom: 8 }}>MERIDIAN Breach Chain</div>
        <div>A 10-box corporate Linux network at 10.66.20.50-59. Only the DMZ web portal (.50) is meant as the entry point; every internal box is reached with creds or keys looted from an earlier hop, then privesc&apos;d to root.</div>
        <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 24px' }}>
          {['Apache path traversal (CVE-2021-41773)', 'Struts2 OGNL (CVE-2017-5638)',
            'MySQL FILE-priv -> OUTFILE', 'Unauth Redis -> SSH key write', 'Jenkins script-console RCE',
            'Log4Shell (CVE-2021-44228)', 'Credential reuse / looted keys', 'GTFOBins sudo (mysql/tar/vi/find)',
            'SUID binaries (find/env/python)', 'Writable cron / capability privesc']
            .map(v => <div key={v}>· {v}</div>)}
        </div>
      </>}
    />
  )
}
