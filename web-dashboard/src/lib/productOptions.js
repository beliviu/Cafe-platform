/*
 * Varian & add-on produk (tabel product_option_groups & product_options, file usulan 04).
 * cafe_id diisi database dari produk induk — klien tidak mengirimnya.
 */
import { friendlyError } from './db.js'

const GROUP_COLUMNS = 'id, product_id, name, selection_type, is_required, max_select, sort_order'
const OPTION_COLUMNS = 'id, group_id, name, price_delta, is_available, is_default, sort_order'

/** Map product_id → jumlah grup (untuk badge di daftar produk). */
export async function fetchOptionCounts(supabase, cafeId) {
  const { data, error } = await supabase.from('product_option_groups').select('product_id').eq('cafe_id', cafeId)
  if (error) return new Map()
  const counts = new Map()
  for (const row of data || []) counts.set(row.product_id, (counts.get(row.product_id) || 0) + 1)
  return counts
}

export async function fetchProductOptions(supabase, productId) {
  const groups = await supabase.from('product_option_groups').select(GROUP_COLUMNS).eq('product_id', productId).order('sort_order')
  if (groups.error) throw new Error(friendlyError(groups.error))
  const ids = (groups.data || []).map((group) => group.id)
  let options = []
  if (ids.length) {
    const result = await supabase.from('product_options').select(OPTION_COLUMNS).in('group_id', ids).order('sort_order')
    if (result.error) throw new Error(friendlyError(result.error))
    options = result.data || []
  }
  return (groups.data || []).map((group) => ({
    ...group,
    options: options.filter((option) => option.group_id === group.id),
  }))
}

/** Validasi di klien (database juga memvalidasi). Mengembalikan pesan error pertama atau ''. */
export function validateGroups(groups) {
  for (const group of groups) {
    if (!group.name.trim()) return 'Setiap grup butuh nama, mis. "Ukuran" atau "Topping".'
    if (!group.options.length) return `Grup "${group.name}" belum punya pilihan.`
    for (const option of group.options) {
      if (!option.name.trim()) return `Ada pilihan tanpa nama di grup "${group.name}".`
      if (!(Number(option.price_delta) >= 0)) return `Harga tambahan di grup "${group.name}" tidak valid.`
    }
    if (group.selection_type === 'single' && group.options.filter((option) => option.is_default).length > 1) {
      return `Grup "${group.name}" hanya boleh punya satu pilihan bawaan.`
    }
  }
  return ''
}

/**
 * Simpan seluruh varian satu produk: hapus yang dibuang, upsert sisanya (urutan = posisi di layar).
 * `original` = data saat dibuka, untuk mengetahui apa yang dihapus.
 */
export async function saveProductOptions(supabase, productId, groups, original) {
  const keptGroupIds = new Set(groups.map((group) => group.id))
  const keptOptionIds = new Set(groups.flatMap((group) => group.options.map((option) => option.id)))
  const removedGroups = original.filter((group) => !keptGroupIds.has(group.id)).map((group) => group.id)
  const removedOptions = original
    .filter((group) => keptGroupIds.has(group.id))
    .flatMap((group) => group.options)
    .filter((option) => !keptOptionIds.has(option.id))
    .map((option) => option.id)

  if (removedOptions.length) {
    const { error } = await supabase.from('product_options').delete().in('id', removedOptions)
    if (error) throw new Error(friendlyError(error))
  }
  if (removedGroups.length) {
    const { error } = await supabase.from('product_option_groups').delete().in('id', removedGroups)
    if (error) throw new Error(friendlyError(error))
  }

  if (groups.length) {
    const groupRows = groups.map((group, index) => ({
      id: group.id,
      product_id: productId,
      name: group.name.trim(),
      selection_type: group.selection_type,
      is_required: group.is_required,
      max_select: group.selection_type === 'multiple' && group.max_select ? Number(group.max_select) : null,
      sort_order: index,
    }))
    const { error } = await supabase.from('product_option_groups').upsert(groupRows)
    if (error) throw new Error(friendlyError(error))

    const optionRows = groups.flatMap((group) => group.options.map((option, index) => ({
      id: option.id,
      group_id: group.id,
      name: option.name.trim(),
      price_delta: Number(option.price_delta) || 0,
      is_available: option.is_available,
      is_default: option.is_default,
      sort_order: index,
    })))
    if (optionRows.length) {
      const result = await supabase.from('product_options').upsert(optionRows)
      if (result.error) throw new Error(friendlyError(result.error))
    }
  }
  return fetchProductOptions(supabase, productId)
}

export function newGroup() {
  return {
    id: crypto.randomUUID(),
    name: '',
    selection_type: 'single',
    is_required: true,
    max_select: null,
    options: [newOption()],
  }
}

export function newOption() {
  return { id: crypto.randomUUID(), name: '', price_delta: 0, is_available: true, is_default: false }
}
