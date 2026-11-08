import { useState } from 'react'
import Cropper from 'react-easy-crop'
import { ZoomIn, ZoomOut } from 'lucide-react'
import { Button, Dialog } from '../ui/index.js'
import { cropToFile } from '../../lib/imageCrop.js'

/** Crop rasio 1:1 tetap — sama dengan kartu produk di aplikasi customer. */
export function ImageCropDialog({ src, onCancel, onDone }) {
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [area, setArea] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function handleDone() {
    if (!area) return
    setBusy(true)
    setError('')
    try {
      onDone(await cropToFile(src, area))
    } catch (caught) {
      setError(caught.message)
      setBusy(false)
    }
  }

  return (
    <Dialog
      title="Atur foto produk"
      description="Geser dan perbesar foto. Hasilnya persegi, sama seperti di menu customer."
      size="md"
      onClose={busy ? undefined : onCancel}
      dismissible={!busy}
      footer={(
        <>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>Batal</Button>
          <Button onClick={handleDone} loading={busy} disabled={!area}>Pakai foto ini</Button>
        </>
      )}
    >
      <div className="crop-area">
        <Cropper
          image={src}
          crop={crop}
          zoom={zoom}
          aspect={1}
          minZoom={1}
          maxZoom={4}
          objectFit="cover"
          showGrid
          onCropChange={setCrop}
          onZoomChange={setZoom}
          onCropComplete={(_, pixels) => setArea(pixels)}
        />
      </div>
      <div className="crop-zoom">
        <ZoomOut size={16} aria-hidden="true" />
        <input
          type="range"
          min={1}
          max={4}
          step={0.01}
          value={zoom}
          aria-label="Perbesar foto"
          onChange={(event) => setZoom(Number(event.target.value))}
        />
        <ZoomIn size={16} aria-hidden="true" />
      </div>
      {error && <p className="ui-field-error" role="alert">{error}</p>}
    </Dialog>
  )
}
