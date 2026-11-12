// Salinan dari web-dashboard/src/lib/resilientFetch.js — sinkronkan manual bila aslinya berubah.
/*
 * fetch dengan coba ulang untuk permintaan BACA (GET/HEAD) yang gagal karena jaringan
 * (sinyal putus sesaat, Wi-Fi kafe). Penulisan (POST/PATCH/DELETE) TIDAK diulang agar tidak dobel —
 * keamanan penulisan dijaga kunci anti-dobel di database.
 */
const DELAYS = [400, 1200]

export function resilientFetch(input, init = {}) {
  const method = String(init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase()
  if (method !== 'GET' && method !== 'HEAD') return fetch(input, init)
  return (async () => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        const response = await fetch(input, init)
        // 502/503/504 = gangguan sementara di jalur server
        if (attempt < DELAYS.length && [502, 503, 504].includes(response.status)) throw new TypeError(`HTTP ${response.status}`)
        return response
      } catch (error) {
        if (init.signal?.aborted || attempt >= DELAYS.length || !(error instanceof TypeError)) throw error
        await new Promise((resolve) => setTimeout(resolve, DELAYS[attempt]))
      }
    }
  })()
}
