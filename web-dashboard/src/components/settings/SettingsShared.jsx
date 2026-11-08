/* Bagian bersama halaman Pengaturan owner. */
import { Button } from '../ui/index.js'

export function SectionFooter({ dirty, saving, onReset, children }) {
  return (
    <footer className="settings-footer">
      <span className="settings-footer-note">{dirty ? 'Ada perubahan yang belum disimpan.' : 'Semua perubahan tersimpan.'}</span>
      {dirty && <Button variant="ghost" onClick={onReset} disabled={saving}>Batalkan</Button>}
      {children}
    </footer>
  )
}
