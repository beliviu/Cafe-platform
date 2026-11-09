import { createContext } from 'react'
import { appTheme } from './palette.js'

/** Nilai bawaan (di luar provider): tema gelap warna bawaan. */
export const ThemeContext = createContext({ ...appTheme({ mode: 'dark' }), preference: 'dark', setPreference: () => {} })
