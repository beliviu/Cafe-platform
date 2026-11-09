import { Pressable, TextInput, View } from 'react-native'
import { Minus, Plus, Search, X } from 'lucide-react-native'
import { tapLight } from '../../lib/haptics.js'
import { FONTS, RADIUS, TAP_TARGET, TYPE } from '../../theme/tokens.js'
import { Text } from './Text.jsx'
import { makeStyles, useTheme } from '../../theme/useTheme.js'

export function Field({ label, hint, error, value, onChangeText, placeholder, secureTextEntry, keyboardType = 'default', multiline = false, autoCapitalize = 'sentences', maxLength, autoComplete, textContentType }) {
  const styles = useStyles()
  const { COLORS } = useTheme()
  return (
    <View style={styles.field}>
      {label ? <Text weight="600" size="sm">{label}</Text> : null}
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={COLORS.placeholder}
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        multiline={multiline}
        autoCapitalize={autoCapitalize}
        autoComplete={autoComplete}
        textContentType={textContentType}
        maxLength={maxLength}
        accessibilityLabel={label}
        style={[styles.input, multiline && styles.multiline, error && styles.inputError]}
      />
      {error ? <Text size="xs" weight="600" tone="danger">{error}</Text> : hint ? <Text size="xs" tone="muted">{hint}</Text> : null}
    </View>
  )
}

export function SearchInput({ value, onChangeText, placeholder = 'Cari menu…', label = 'Cari' }) {
  const styles = useStyles()
  const { COLORS } = useTheme()
  return (
    <View style={styles.search}>
      <Search size={18} color={COLORS.textMuted} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={COLORS.placeholder}
        accessibilityLabel={label}
        returnKeyType="search"
        style={styles.searchInput}
      />
      {value ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Hapus pencarian" onPress={() => onChangeText('')} hitSlop={10} style={styles.searchClear}>
          <X size={16} color={COLORS.textMuted} />
        </Pressable>
      ) : null}
    </View>
  )
}

/**
 * Pilihan tunggal: tab Aktif/Riwayat, Dine-in/Takeaway, dsb.
 * options: [{ value, label, count? }]
 */
export function SegmentedControl({ options, value, onChange, style }) {
  const styles = useStyles()
  const { COLORS } = useTheme()
  return (
    <View style={[styles.segmented, style]} accessibilityRole="tablist">
      {options.map((option) => {
        const selected = option.value === value
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(option.value)}
            style={[styles.segment, selected && styles.segmentSelected]}
          >
            <Text weight={selected ? '700' : '600'} size="sm" style={{ color: selected ? COLORS.primaryPressed : COLORS.textSecondary }}>{option.label}</Text>
            {option.count !== undefined ? (
              <View style={[styles.count, selected && styles.countSelected]}>
                <Text size={11} weight="700" tabular style={{ color: selected ? COLORS.textOnPrimary : COLORS.textSecondary }}>{option.count}</Text>
              </View>
            ) : null}
          </Pressable>
        )
      })}
    </View>
  )
}

/** Stepper − qty +. Jika qty turun ke 0, onChange(0) — pemanggil memutuskan menghapus item. */
export function QuantityStepper({ value, onChange, min = 0, max = 99, size = 'md', itemName = 'item' }) {
  const styles = useStyles()
  const { COLORS } = useTheme()
  const box = size === 'sm' ? 34 : TAP_TARGET
  function change(next) {
    if (next < min || next > max) return
    tapLight()
    onChange(next)
  }
  return (
    <View style={[styles.stepper, { height: box }]}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Kurangi ${itemName}`} onPress={() => change(value - 1)} hitSlop={6} style={[styles.stepButton, { width: box, height: box }]}>
        <Minus size={16} color={COLORS.primaryPressed} strokeWidth={2.4} />
      </Pressable>
      <Text weight="700" tabular style={styles.stepValue} accessibilityLabel={`Jumlah ${value}`}>{value}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Tambah ${itemName}`}
        accessibilityState={{ disabled: value >= max }}
        onPress={() => change(value + 1)}
        hitSlop={6}
        style={[styles.stepButton, styles.stepPlus, { width: box, height: box }, value >= max && styles.disabled]}
      >
        <Plus size={16} color={COLORS.textOnPrimary} strokeWidth={2.4} />
      </Pressable>
    </View>
  )
}

const useStyles = makeStyles(({ COLORS }) => ({
  field: { gap: 8 },
  input: { minHeight: 50, paddingHorizontal: 14, color: COLORS.text, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.borderStrong, borderRadius: RADIUS.md, fontFamily: FONTS.sans, fontSize: TYPE.base },
  inputError: { borderColor: '#D0705F' },
  multiline: { height: 96, paddingTop: 13, textAlignVertical: 'top' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, paddingLeft: 14, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md },
  searchInput: { flex: 1, minHeight: 46, color: COLORS.text, fontFamily: FONTS.sans, fontSize: TYPE.base },
  searchClear: { width: TAP_TARGET, height: TAP_TARGET, alignItems: 'center', justifyContent: 'center' },
  segmented: { flexDirection: 'row', padding: 4, gap: 4, backgroundColor: COLORS.sunken, borderRadius: RADIUS.md },
  segment: { flex: 1, minHeight: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: RADIUS.sm },
  segmentSelected: { backgroundColor: COLORS.card, shadowColor: '#31281E', shadowOpacity: 0.08, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  count: { minWidth: 20, paddingHorizontal: 6, paddingVertical: 1, alignItems: 'center', backgroundColor: COLORS.canvas, borderRadius: 10 },
  countSelected: { backgroundColor: COLORS.primary },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 4, padding: 2, backgroundColor: COLORS.primaryTint, borderRadius: RADIUS.full },
  stepButton: { alignItems: 'center', justifyContent: 'center', borderRadius: RADIUS.full },
  stepPlus: { backgroundColor: COLORS.primary },
  stepValue: { minWidth: 22, textAlign: 'center' },
  disabled: { opacity: 0.45 },
}))
