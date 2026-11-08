/*
 * Tab Stok opname: hitung fisik banyak bahan, selisih diposting sekaligus (RPC inventory_post_count).
 * Draf hitungan disimpan di browser ini agar tidak hilang saat halaman tertutup.
 */
import { useCallback, useMemo, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { ClipboardCheck, Equal } from 'lucide-react'
import { useAuth } from '../../auth/useAuth.js'
import {
  Badge, Button, Card, CardHeader, ConfirmDialog, Drawer, EmptyState, ErrorState, IconButton, SearchInput, SkeletonRows, Switch, TextField, useToast,
} from '../../components/ui/index.js'
import { formatDateTime, formatNumber, formatRupiah } from '../../lib/format.js'
import { callRpc, formatQty, inventoryError, parseDecimal, UNITS, useLoader } from '../../lib/inventory.js'

const draftKey = (cafeId) => `dailybrew.opname.${cafeId}`

function readDraft(cafeId) {
  try {
    return JSON.parse(window.localStorage.getItem(draftKey(cafeId)) || 'null')
  } catch {
    return null
  }
}

function writeDraft(cafeId, draft) {
  try {
    if (draft) window.localStorage.setItem(draftKey(cafeId), JSON.stringify(draft))
    else window.localStorage.removeItem(draftKey(cafeId))
  } catch {
    // mode privat: draf tidak disimpan
  }
}

export function StockCountPage() {
  const { cafe, inventory } = useOutletContext()
  const { supabase } = useAuth()
  const [draft, setDraft] = useState(() => readDraft(cafe.id))
  const [openCount, setOpenCount] = useState(null)
  const byId = useMemo(() => new Map(inventory.data.ingredients.map((item) => [item.id, item])), [inventory.data.ingredients])

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('stock_counts').select('id, note, line_count, difference_value, created_at')
      .eq('cafe_id', cafe.id).order('created_at', { ascending: false }).limit(60)
    if (error) throw new Error(inventoryError(error))
    return data || []
  }, [cafe.id, supabase])
  const history = useLoader(load)

  function updateDraft(next) {
    setDraft(next)
    writeDraft(cafe.id, next)
  }

  if (draft) {
    return (
      <CountForm
        cafeId={cafe.id}
        ingredients={inventory.data.ingredients.filter((item) => item.is_active)}
        draft={draft}
        onChange={updateDraft}
        onCancel={() => updateDraft(null)}
        onPosted={() => { updateDraft(null); inventory.reload(); history.reload() }}
      />
    )
  }

  return (
    <div className="inv-page">
      <Card padding="none">
        <div className="table-card-head">
          <CardHeader
            title="Riwayat opname"
            description="Hitung fisik semua bahan secara berkala (mis. tiap minggu). Selisih otomatis menjadi mutasi opname."
            actions={<Button icon={ClipboardCheck} onClick={() => updateDraft({ startedAt: new Date().toISOString(), counts: {}, note: '' })}>Mulai opname</Button>}
          />
        </div>
        {history.error ? <div className="table-card-body"><ErrorState compact message={history.error} onRetry={history.reload} /></div>
          : !history.data ? <div className="table-card-body"><SkeletonRows rows={4} label="Memuat riwayat" /></div>
            : !history.data.length ? (
              <div className="table-card-body">
                <EmptyState compact icon={ClipboardCheck} title="Belum pernah opname" description="Opname pertama sekaligus menjadi titik awal stok yang akurat." />
              </div>
            ) : (
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr><th scope="col">Waktu</th><th scope="col" className="num">Bahan dihitung</th><th scope="col" className="num">Nilai selisih</th><th scope="col">Catatan</th></tr>
                  </thead>
                  <tbody>
                    {history.data.map((count) => (
                      <tr key={count.id} className="is-clickable" onClick={() => setOpenCount(count)}>
                        <td className="tabular">{formatDateTime(count.created_at)}</td>
                        <td className="num tabular">{formatNumber(count.line_count)}</td>
                        <td className={`num tabular inv-qty${Number(count.difference_value) < 0 ? ' is-out' : ''}`}>
                          {Number(count.difference_value) > 0 ? '+' : ''}{formatRupiah(count.difference_value)}
                        </td>
                        <td>{count.note || <span className="text-muted">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
      </Card>
      {openCount && <CountDetailDrawer count={openCount} byId={byId} onClose={() => setOpenCount(null)} />}
    </div>
  )
}

function CountForm({ cafeId, ingredients, draft, onChange, onCancel, onPosted }) {
  const { supabase } = useAuth()
  const { toast } = useToast()
  const [query, setQuery] = useState('')
  const [onlyFilled, setOnlyFilled] = useState(false)
  const [confirm, setConfirm] = useState(null)

  const lines = useMemo(() => ingredients.map((item) => {
    const raw = draft.counts[item.id] ?? ''
    const counted = parseDecimal(raw)
    const system = Number(item.on_hand) || 0
    const diff = counted === null ? null : counted - system
    return { item, raw, counted, system, diff, value: diff === null ? 0 : diff * (Number(item.avg_cost) || 0) }
  }), [draft.counts, ingredients])
  const filled = lines.filter((line) => line.counted !== null)
  const invalid = filled.filter((line) => line.counted < 0)
  const changed = filled.filter((line) => Math.abs(line.diff) >= 0.0005)
  const totalValue = changed.reduce((sum, line) => sum + line.value, 0)

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('id')
    return lines.filter((line) => (!onlyFilled || line.counted !== null)
      && (!needle || [line.item.name, line.item.category, line.item.sku].filter(Boolean).join(' ').toLocaleLowerCase('id').includes(needle)))
  }, [lines, onlyFilled, query])
  const groups = useMemo(() => {
    const map = new Map()
    for (const line of visible) {
      const key = line.item.category || 'Tanpa kategori'
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(line)
    }
    return [...map.entries()]
  }, [visible])

  function setCount(id, value) {
    onChange({ ...draft, counts: { ...draft.counts, [id]: value } })
  }

  async function post() {
    const id = await callRpc(supabase, 'inventory_post_count', {
      p_cafe_id: cafeId,
      p_lines: filled.map((line) => ({ ingredient_id: line.item.id, counted: Number(line.counted.toFixed(3)) })),
      p_note: draft.note?.trim() || null,
    })
    toast({ tone: 'success', title: 'Opname diposting', description: `${filled.length} bahan dihitung · ${changed.length} berubah` })
    onPosted(id)
  }

  return (
    <div className="inv-page">
      <Card className="inv-count-head">
        <CardHeader
          title="Opname berjalan"
          description={`Dimulai ${formatDateTime(draft.startedAt)}. Isi jumlah fisik; bahan yang dikosongkan tidak diubah. Draf tersimpan di browser ini.`}
          actions={<Button variant="ghost" size="sm" onClick={() => setConfirm('discard')}>Buang draf</Button>}
        />
        <div className="toolbar inv-count-tools">
          <SearchInput value={query} onChange={setQuery} placeholder="Cari bahan…" label="Cari bahan" className="toolbar-search" />
          <Switch checked={onlyFilled} onChange={setOnlyFilled} label="Hanya yang sudah diisi" onLabel="Hanya yang diisi" offLabel="Semua bahan" />
        </div>
      </Card>

      {!ingredients.length ? (
        <Card><EmptyState compact title="Belum ada bahan aktif" description="Tambahkan bahan dulu di tab Bahan." /></Card>
      ) : groups.map(([category, list]) => (
        <Card key={category} padding="none" className="inv-count-group">
          <h3 className="inv-count-title">{category}</h3>
          <div className="table-scroll">
            <table className="data-table inv-count-table">
              <thead>
                <tr><th scope="col">Bahan</th><th scope="col" className="num">Sistem</th><th scope="col">Hitungan fisik</th><th scope="col" className="num">Selisih</th><th scope="col" className="num">Nilai</th></tr>
              </thead>
              <tbody>
                {list.map((line) => {
                  const unit = UNITS[line.item.unit]?.short || line.item.unit
                  return (
                    <tr key={line.item.id} className={line.counted !== null && Math.abs(line.diff) >= 0.0005 ? 'is-changed' : ''}>
                      <th scope="row"><strong>{line.item.name}</strong></th>
                      <td className="num tabular">{formatQty(line.system, line.item.unit, { scale: false })}</td>
                      <td>
                        <span className="inv-count-input">
                          <TextField hideLabel label={`Hitungan ${line.item.name}`} value={line.raw} suffix={unit} inputMode="decimal" autoComplete="off"
                            error={line.counted !== null && line.counted < 0 ? 'Tidak boleh minus' : undefined}
                            onChange={(event) => setCount(line.item.id, event.target.value)} />
                          <IconButton icon={Equal} size="sm" label={`Sama dengan sistem (${formatQty(Math.max(line.system, 0), line.item.unit, { scale: false })})`}
                            onClick={() => setCount(line.item.id, String(Math.max(line.system, 0)))} />
                        </span>
                      </td>
                      <td className={`num tabular inv-qty${line.diff < 0 ? ' is-out' : ''}`}>
                        {line.diff === null ? <span className="text-muted">—</span> : Math.abs(line.diff) < 0.0005 ? 'Sesuai' : formatQty(line.diff, line.item.unit, { signed: true, scale: false })}
                      </td>
                      <td className="num tabular">{line.diff === null || Math.abs(line.diff) < 0.0005 ? '' : formatRupiah(line.value)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ))}

      <div className="inv-count-bar" role="region" aria-label="Ringkasan opname">
        <span><strong className="tabular">{formatNumber(filled.length)}</strong> dari {formatNumber(ingredients.length)} bahan diisi</span>
        <span><strong className="tabular">{formatNumber(changed.length)}</strong> berubah</span>
        <span>Nilai selisih <strong className={`tabular inv-qty${totalValue < 0 ? ' is-out' : ''}`}>{totalValue > 0 ? '+' : ''}{formatRupiah(totalValue)}</strong></span>
        <TextField hideLabel label="Catatan opname" placeholder="Catatan, mis. opname mingguan" value={draft.note || ''} maxLength={300}
          onChange={(event) => onChange({ ...draft, note: event.target.value })} className="inv-count-note" />
        <Button onClick={() => setConfirm('post')} disabled={!filled.length || invalid.length > 0}>Posting opname</Button>
      </div>

      {confirm === 'post' && (
        <ConfirmDialog tone="primary" title="Posting hasil opname?" confirmLabel="Posting"
          description={`${filled.length} bahan dihitung, ${changed.length} berubah dengan nilai selisih ${formatRupiah(totalValue)}. Stok sistem diganti dengan hitungan fisik dan tidak bisa dibatalkan (koreksi lewat opname berikutnya).`}
          onConfirm={post} onClose={() => setConfirm(null)} />
      )}
      {confirm === 'discard' && (
        <ConfirmDialog title="Buang draf opname?" confirmLabel="Buang draf" description="Hitungan yang sudah diisi akan hilang. Stok tidak berubah."
          onConfirm={() => { onCancel() }} onClose={() => setConfirm(null)} />
      )}
    </div>
  )
}

function CountDetailDrawer({ count, byId, onClose }) {
  const { supabase } = useAuth()
  const load = useCallback(async () => {
    const { data, error } = await supabase.from('stock_count_lines').select('id, ingredient_id, system_qty, counted_qty, difference, unit_cost').eq('stock_count_id', count.id)
    if (error) throw new Error(inventoryError(error))
    return (data || []).sort((a, b) => Math.abs(Number(b.difference) * Number(b.unit_cost)) - Math.abs(Number(a.difference) * Number(a.unit_cost)))
  }, [count.id, supabase])
  const { data, error, reload } = useLoader(load)
  return (
    <Drawer title={`Opname ${formatDateTime(count.created_at)}`} description={count.note || `${count.line_count} bahan dihitung`} onClose={onClose}>
      {error ? <ErrorState compact message={error} onRetry={reload} />
        : !data ? <SkeletonRows rows={5} label="Memuat baris opname" />
          : (
            <table className="data-table">
              <thead><tr><th scope="col">Bahan</th><th scope="col" className="num">Sistem</th><th scope="col" className="num">Fisik</th><th scope="col" className="num">Selisih</th></tr></thead>
              <tbody>
                {data.map((line) => {
                  const item = byId.get(line.ingredient_id)
                  const unit = item?.unit || ''
                  const diff = Number(line.difference)
                  return (
                    <tr key={line.id}>
                      <th scope="row">{item?.name || 'Bahan terhapus'}</th>
                      <td className="num tabular">{formatQty(line.system_qty, unit, { scale: false })}</td>
                      <td className="num tabular">{formatQty(line.counted_qty, unit, { scale: false })}</td>
                      <td className="num">
                        {Math.abs(diff) < 0.0005 ? <Badge tone="green" size="sm" dot={false}>Sesuai</Badge>
                          : <span className={`tabular inv-qty${diff < 0 ? ' is-out' : ''}`}>{formatQty(diff, unit, { signed: true, scale: false })}<small> · {formatRupiah(diff * Number(line.unit_cost))}</small></span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
    </Drawer>
  )
}
