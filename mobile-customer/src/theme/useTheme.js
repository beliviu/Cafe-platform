import { useContext, useMemo } from 'react'
import { StyleSheet } from 'react-native'
import { ThemeContext } from './ThemeContext.js'

/** { mode, dark, COLORS, STATUS_TONES, PALETTE, SHADOW, gradient, isGradient, preference, setPreference } */
export function useTheme() {
  return useContext(ThemeContext)
}

/**
 * Gaya yang ikut tema aktif. Pakai di level modul:
 *   const useStyles = makeStyles(({ COLORS }) => ({ card: { backgroundColor: COLORS.card } }))
 * lalu di komponen: const styles = useStyles()
 */
export function makeStyles(factory) {
  const cache = new WeakMap()
  return function useStyles() {
    const theme = useContext(ThemeContext)
    let styles = cache.get(theme.COLORS)
    if (!styles) {
      styles = StyleSheet.create(factory(theme))
      cache.set(theme.COLORS, styles)
    }
    return useMemo(() => styles, [styles])
  }
}
