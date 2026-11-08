/*
 * Editor resep satu produk: bahan per 1 porsi + bahan tambahan per varian.
 * HPP dihitung langsung dari harga rata-rata bahan; disimpan atomik lewat RPC recipe_save.
 */
import { useCallback, useId, useMemo, useState } from 'react'
import { ChevronDown, Plus, Trash2 } from 'lucide-react'
import { useAuth } from '../../auth/useAuth.js'
import { Badge, Button, Drawer, ErrorState, IconButton, SkeletonRows, TextField, useToast } from '../ui/index.js'
import { formatRupiah } from '../../lib/format.js'
import {
  callRpc, formatUnitCost, ingredientOptionGroups, inventoryError, parseDecimal, UNITS, useLoader,
} from '../../lib/inventory.js'

let rowSeed = 0
const newRow = (optionId = null, values = {}) => ({ key: `row-${(rowSeed += 1)}`, option_id: optionId, ingredient_id: '', quantity: '', ...values })

function IngredientSelect({ value, onChange, ingredients, label }) {
  const id = useId()
  const groups = useMemo(() => ingredientOptionGroups(ingredients.filter((item) => item.is_active || item.id === value)), [ingredients, value])
  return (
    <span className="ui-select-wrap">
      <label htmlFor={id} className="sr-only">{label}</label>
      <select id={id} className="ui-select" value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Pilih bahan…</option>
        {groups.map(([group, list]) => (
          <optgroup key={group} label={group}>
            {list.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </optgroup>
        ))}
      </select>
      <ChevronDown size={16} className="ui-select-chevron" aria-hidden="true" />
    </span>
  )
}

export function RecipeDrawer({ product, ingredients, onClose, onSaved }) {
  const { supabase } = useAuth()
  const load = useCallback(async () => {
    const [recipeResult, groupResult] = await Promise.all([
      supabase.from('recipe_items').select('id, option_id, ingredient_id, quantity').eq('product_id', product.id),
      supabase.from('product_option_groups').select('id, name, sort_order').eq('product_id', product.id).order('sort_order'),
    ])
    const failure = recipeResult.error || groupResult.error
    if (failure) throw new Error(inventoryError(failure))
    const groupIds = (groupResult.data || []).map((group) => group.id)
    let options = []
    if (groupIds.length) {
      const optionResult = await supabase.from('product_options').select('id, group_id, name, price_delta, sort_order').in('group_id', groupIds).order('sort_order')
      if (optionResult.error) throw new Error(inventoryError(optionResult.error))
      options = optionResult.data || []
    }
    return { recipe: recipeResult.data || [], groups: groupResult.data || [], options }
  }, [product.id, supabase])
  const { data, error, reload } = useLoader(load)

  return (
    <Drawer title={`Resep ${product.name}`} description={`Takaran untuk 1 porsi · harga jual ${formatRupiah(product.price)}`} onClose={onClose} size="lg">
      {error ? <ErrorState compact message={error} onRetry={reload} />
        : !data ? <SkeletonRows rows={5} label="Memuat resep" />
          : <RecipeEditor product={product} ingredients={ingredients} initial={data} onClose={onClose} onSaved={onSaved} />}
    </Drawer>
  )
}

function RecipeEditor({ product, ingredients, initial, onClose, onSaved }) {
  const { supabase } = useAuth()
  const { toast } = useToast()
  const byId = useMemo(() => new Map(ingredients.map((item) => [item.id, item])), [ingredients])
  const [rows, setRows] = useState(() => {
    const existing = initial.recipe.map((line) => newRow(line.option_id, { ingredient_id: line.ingredient_id, quantity: String(Number(line.quantity)) }))
    return existing.some((row) => !row.option_id) ? existing : [newRow(), ...existing]
  })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const costOf = (row) => {
    const item = byId.get(row.ingredient_id)
    const qty = parseDecimal(row.quantity)
    return item && qty > 0 ? qty * (Number(item.avg_cost) || 0) : 0
  }
  const baseRows = rows.filter((row) => !row.option_id)
  const baseCost = baseRows.reduce((sum, row) => sum + costOf(row), 0)
  const price = Number(product.price) || 0
  const margin = price > 0 ? ((price - baseCost) / price) * 100 : null
  const uncosted = rows.filter((row) => row.ingredient_id && !Number(byId.get(row.ingredient_id)?.avg_cost))

  function update(key, patch) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)))
    setError('')
  }
  function remove(key) {
    setRows((current) => current.filter((row) => row.key !== key))
  }
  function add(optionId = null) {
    setRows((current) => [...current, newRow(optionId)])
  }

  async function save() {
    const filled = rows.filter((row) => row.ingredient_id || row.quantity)
    for (const row of filled) {
      const qty = parseDecimal(row.quantity)
      if (!row.ingredient_id) return setError('Pilih bahan di setiap baris, atau hapus baris kosong')
      if (!(qty > 0)) return setError(`Isi takaran ${byId.get(row.ingredient_id)?.name || 'bahan'} lebih dari 0`)
    }
    const keys = filled.map((row) => `${row.option_id || 'base'}:${row.ingredient_id}`)
    if (new Set(keys).size !== keys.length) return setError('Ada bahan yang sama dua kali di bagian yang sama. Gabungkan takarannya.')
    setSaving(true)
    try {
      await callRpc(supabase, 'recipe_save', {
        p_product_id: product.id,
        p_items: filled.map((row) => ({ ingredient_id: row.ingredient_id, quantity: Number(parseDecimal(row.quantity).toFixed(3)), option_id: row.option_id })),
      })
      toast({ tone: 'success', title: `Resep ${product.name} disimpan`, description: `HPP ${formatRupiah(baseCost)} per porsi` })
      onSaved?.()
      onClose()
    } catch (caught) {
      setError(caught.message)
      setSaving(false)
    }
    return undefined
  }

  const renderRows = (list) => list.map((row) => {
    const item = byId.get(row.ingredient_id)
    const unit = item ? UNITS[item.unit]?.short || item.unit : ''
    return (
      <div key={row.key} className="recipe-row">
        <IngredientSelect value={row.ingredient_id} onChange={(value) => update(row.key, { ingredient_id: value })} ingredients={ingredients} label="Bahan" />
        <TextField hideLabel label="Takaran" value={row.quantity} onChange={(event) => update(row.key, { quantity: event.target.value })}
          suffix={unit || ' '} inputMode="decimal" autoComplete="off" placeholder="0" className="recipe-qty" />
        <span className="recipe-cost tabular">
          {item && !Number(item.avg_cost) ? <Badge tone="amber" size="sm" dot={false}>Belum ada harga</Badge> : formatRupiah(costOf(row))}
          {item && Number(item.avg_cost) > 0 && <small>{formatUnitCost(item.avg_cost, item.unit)}</small>}
        </span>
        <IconButton icon={Trash2} size="sm" variant="danger" label="Hapus baris" onClick={() => remove(row.key)} />
      </div>
    )
  })

  return (
    <div className="recipe-editor">
      <section className="recipe-section">
        <div className="recipe-section-head">
          <h3>Resep dasar · 1 porsi</h3>
          <Button size="sm" variant="ghost" icon={Plus} onClick={() => add()}>Tambah bahan</Button>
        </div>
        {!ingredients.length && <p className="ui-field-hint">Belum ada bahan. Tambahkan bahan di menu Stok bahan dulu.</p>}
        {renderRows(baseRows)}
      </section>

      {initial.groups.map((group) => {
        const options = initial.options.filter((option) => option.group_id === group.id)
        if (!options.length) return null
        return (
          <section key={group.id} className="recipe-section">
            <div className="recipe-section-head">
              <h3>Varian {group.name}</h3>
              <small className="text-muted">Bahan tambahan saat varian dipilih</small>
            </div>
            {options.map((option) => {
              const optionRows = rows.filter((row) => row.option_id === option.id)
              const extraCost = optionRows.reduce((sum, row) => sum + costOf(row), 0)
              return (
                <div key={option.id} className="recipe-option">
                  <div className="recipe-option-head">
                    <strong>{option.name}</strong>
                    <span className="text-muted tabular">
                      {Number(option.price_delta) ? `+${formatRupiah(option.price_delta)} harga` : 'Tanpa tambahan harga'}
                      {extraCost > 0 ? ` · +${formatRupiah(extraCost)} HPP` : ''}
                    </span>
                    <Button size="sm" variant="ghost" icon={Plus} onClick={() => add(option.id)}>Tambah bahan</Button>
                  </div>
                  {renderRows(optionRows)}
                </div>
              )
            })}
          </section>
        )
      })}

      <footer className="recipe-summary">
        <dl>
          <div><dt>HPP per porsi</dt><dd className="tabular">{formatRupiah(baseCost)}</dd></div>
          <div><dt>Laba kotor</dt><dd className="tabular">{formatRupiah(price - baseCost)}</dd></div>
          <div><dt>Margin</dt><dd className={`tabular${margin !== null && margin < 50 ? ' is-low' : ''}`}>{margin === null ? '—' : `${margin.toFixed(1).replace('.', ',')}%`}</dd></div>
        </dl>
        {uncosted.length > 0 && <p className="ui-field-hint">{uncosted.length} bahan belum punya harga — catat stok masuk atau pembelian agar HPP akurat.</p>}
        {error && <p className="ui-field-error" role="alert">{error}</p>}
        <div className="recipe-actions">
          <Button variant="ghost" onClick={onClose} disabled={saving}>Batal</Button>
          <Button onClick={save} loading={saving}>Simpan resep</Button>
        </div>
      </footer>
    </div>
  )
}
