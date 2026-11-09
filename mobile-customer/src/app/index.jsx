import { useEffect, useState } from 'react'
import { ActivityIndicator, View } from 'react-native'
import { Redirect } from 'expo-router'
import { BrandMark } from '../brand/BrandMark.jsx'
import { useBrand } from '../brand/useBrand.js'
import { Text } from '../components/ui/Text.jsx'
import { makeStyles } from '../theme/useTheme.js'

export default function AppIndex() {
  const styles = useStyles()
  const [ready, setReady] = useState(false)
  const { brand, loading } = useBrand()

  useEffect(() => {
    const timer = setTimeout(() => setReady(true), 650)
    return () => clearTimeout(timer)
  }, [])

  if (ready && !loading) return <Redirect href="/(tabs)" />
  return (
    <View style={styles.container}>
      <BrandMark size={72} />
      {!loading && <Text style={styles.brand}>{brand.name}</Text>}
      {!loading && brand.tagline ? <Text style={styles.tagline}>{brand.tagline}</Text> : null}
      <ActivityIndicator color={brand.colors.primary} style={styles.loading} />
    </View>
  )
}

const useStyles = makeStyles(({ COLORS }) => ({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.background },
  brand: { marginTop: 16, paddingHorizontal: 24, color: COLORS.ink, fontFamily: 'Fraunces', fontSize: 28, fontWeight: '700', letterSpacing: -0.5, textAlign: 'center' },
  tagline: { marginTop: 6, paddingHorizontal: 32, color: COLORS.textMuted, fontSize: 13, textAlign: 'center' },
  loading: { marginTop: 26 },
}))
