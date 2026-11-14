# Design system Dailybrew — "Warm Luxury"

Hangat, premium, tenang, mudah dibaca. Dipakai oleh `platform-admin/` (admin platform) dan `web-dashboard/` (owner di `/`, staff di `/staff`).

Sumbernya satu: folder [`shared/ui/`](shared/ui/). Kedua aplikasi mengimpornya lewat alias Vite:

```js
import { Button, Card, KpiCard, useToast } from '@dailybrew/ui'   // komponen, grafik, kerangka, tema
import '@dailybrew/ui/styles.css'                                  // sekali saja, di main.jsx
```

Di dalam aplikasi, impor tetap dari `components/ui/index.js` (meneruskan semua isi `@dailybrew/ui` plus tambahan khusus aplikasi itu).

> **Hosting:** karena `shared/ui/` ada di luar folder aplikasi, build harus bisa membaca root repo. Di Vercel: Project Settings → Root Directory → centang "Include files outside the Root Directory". Di Cloudflare Pages: root = repo, build command `cd web-dashboard && npm ci && npm run build`.

## 1. Aturan utama

1. **Jangan menulis warna hex** di komponen, halaman, atau CSS halaman. Selalu pakai token.
2. **Status selalu disertai kata**, bukan warna saja (`<Badge tone="red">Berisiko</Badge>`, bukan titik merah).
3. **Bayangan hanya saat hover atau di overlay** (dialog, menu, tooltip, toast). Kartu diam tidak berbayang.
4. **Tidak ada**: gradien selain kartu KPI utama, emoji, kartu dengan garis tepi kiri berwarna, kotak ikon di judul kartu, titik di akhir judul.
5. **Fraunces hanya untuk judul halaman dan angka besar.** Semua teks lain Plus Jakarta Sans.
6. **Angka memakai `tabular-nums`** (kelas `.tabular`; tabel dan KPI sudah otomatis).
7. **Teks minimal 12px.** Ukuran hanya dari skala token.
8. Semua teks Bahasa Indonesia, ramah, singkat. Istilah bisnis yang sudah ada tidak diganti.

## 2. Token

Skala ada di [`shared/ui/styles/tokens.css`](shared/ui/styles/tokens.css). Warna dihitung oleh [`shared/ui/theme/theme.js`](shared/ui/theme/theme.js); nilai bawaannya dicetak ke `tokens.generated.css` (jangan diubah manual, jalankan `node shared/ui/scripts/build-tokens.mjs` setelah mengubah `theme.js`).

### Warna dasar (tetap per mode)

| Token | Gelap | Terang | Untuk |
|---|---|---|---|
| `--bg` | `#120E0B` | `#F5EFE6` | latar halaman |
| `--sidebar` | `#17120F` | `#EFE6DA` | sidebar, bar atas HP |
| `--panel` | `#1D1714` | `#FFFCF7` | kartu, dialog |
| `--panel-2` | `#272019` | `#F3EADF` | isi di dalam kartu, menu, tooltip grafik |
| `--text` | `#F4ECE1` | `#2A1E17` | teks utama |
| `--text-2` | `#BCAB9B` | `#5E4C3D` | teks sekunder |
| `--text-3` | `#9C8A7A` | `#74604E` | teks redup, label |
| `--line` / `--line-strong` | | | garis halus / garis kontrol |
| `--good` / `--good-soft` | `#7FC79A` | `#2E7A4A` | berhasil, sehat, lunas |
| `--warn` / `--warn-soft` | `#E2B45A` | `#8E600F` | perlu dicek |
| `--bad` / `--bad-soft` | `#F08C7B` | `#B4432F` | gagal, telat, berisiko |
| `--info` / `--info-soft` | `#8DB7E6` | `#2F5F96` | informasi, sedang diproses |

Semua pasangan teks/latar di atas sudah diuji ≥ 4,5:1.

### Aksen (dinamis)

Bawaan **Terakota `#C8734A`**. Pilihan: Emas `#C9963B`, Sage `#6E9A78`, Samudra `#4F86C6`, Plum `#9A6BB5`, atau warna bebas. Dari satu warna, `deriveAccent()` menghitung:

| Token | Isi |
|---|---|
| `--accent` | isian tombol utama (dijaga ≥ 3:1 terhadap panel) |
| `--accent-deep` | lebih gelap: hover, ujung gradien kartu KPI utama |
| `--accent-soft` | 14% alpha: menu aktif, chip, tombol lembut |
| `--accent-mid` | 40% alpha: garis hover, seleksi teks |
| `--accent-ink` | versi teks, lolos 4,5:1 terhadap panel dan latar lembut |
| `--on-accent` | teks di atas aksen: gelap atau terang, mana yang kontrasnya lebih tinggi |

- Web owner: aksen = warna brand kafe (`cafes.brand_color`), bawaan Terakota.
- Dashboard platform: aksen = `platform_settings.theme_color`.
- Warna grafik `--chart-1…5` = satu hue aksen dengan lightness berjenjang.

```js
import { applyTheme, deriveAccent } from '@dailybrew/ui'
applyTheme({ color: '#6E9A78', mode: 'dark' })   // memasang semua token ke <html>
deriveAccent('#6E9A78', 'light')                 // { accent, deep, soft, mid, ink, on }
```

### Skala

| Jenis | Nilai |
|---|---|
| Teks | `--text-xs` 12 · `--text-sm` 13 · `--text-base` 14 · `--text-md` 16 · `--text-lg` 20 · `--text-xl` 28 · `--text-2xl` 44 |
| Spasi | `--space-1` 4 · `-2` 8 · `-3` 12 · `-4` 16 · `-5` 20 · `-6` 24 · `-8` 32 · `-10` 40 · `-14` 56 |
| Radius | `--radius-sm` 8 (badge, chip) · `--radius-md` 12 (tombol, input, baris) · `--radius-lg` 20 (kartu, overlay) · `--radius-full` |
| Sudut "tegas" | `data-radius="sharp"` → 4 / 6 / 10 |
| Target sentuh | `--tap-target` 44px; di web staff (`.is-staff`) 48px |

Nama lama (`--surface-*`, `--brand-*`, `--status-*`, `--text-primary`…) masih diisi supaya halaman lama ikut tema. **Kode baru memakai nama baru.**

## 3. Animasi

| Token | Nilai | Untuk |
|---|---|---|
| `--ease-out` | `cubic-bezier(.22,1,.36,1)` | elemen masuk, transisi warna |
| `--ease-spring` | `cubic-bezier(.34,1.56,.64,1)` | indikator, tombol, dropdown |
| `--dur-1…4` | 150 · 250 · 400 · 550 ms | cepat → lambat |

Yang sudah ada:

- Tombol mengecil saat ditekan (`scale(.97)`), kartu terangkat 2px saat hover.
- Indikator menu aktif di sidebar dan indikator `SegmentedControl`/`Tabs` meluncur dengan pegas (`useSlidingIndicator`).
- Ikon menu sedikit bergerak saat hover.
- Angka KPI menghitung naik (`CountUp`, `useCountUp`); kartu KPI utama punya kilau berjalan pelan.
- Grafik: garis tergambar dari kiri (`.chart-reveal`), batang tumbuh berurutan (`.chart-grow` + `--i`), donut tergambar dan menyorot bagian saat legenda di-hover; tooltip mengikuti kursor.
- Dialog "pop", drawer meluncur dari kanan, dropdown "pop", latar blur.
- Toast di pojok kanan bawah dengan bar waktu (berhenti saat di-hover).
- `CheckMark` (centang tergambar) dan `.ui-leave` + `.is-leaving` (item daftar keluar).

**Wajib:** semua animasi bisa dimatikan.

- Tombol petir di kaki sidebar, perintah "Matikan animasi" di Ctrl/Cmd+K, dan sakelar di Pengaturan → Tampilan. Ketiganya mengatur `<html data-motion="off">`.
- `prefers-reduced-motion` selalu dihormati.
- Animasi CSS mati otomatis lewat `base.css`. **Animasi berbasis JS harus memeriksa** `useAppearance().animate` (di komponen) atau `motionEnabled()` (di luar React).
- Web staff: animasi minimal. Jangan menambah animasi dekoratif di papan pesanan atau kasir.

## 4. Komponen

| Komponen | Catatan |
|---|---|
| `Button` | `variant`: primary · secondary · ghost · soft · danger · danger-soft. `size`: sm 36 · md 44 · lg 52. `loading`, `icon`, `iconRight`, `block`, `as={Link}` |
| `IconButton` | `label` wajib (jadi `aria-label` dan tooltip). `tooltipSide`: right · bottom |
| `Card`, `CardHeader` | `padding`: none · sm · md · lg. `interactive` untuk kartu yang bisa ditekan |
| `KpiCard` | `value` angka (menghitung naik, `format`) atau teks. `hero` = kartu utama, **satu per halaman**. `delta`, `deltaInverse`, `trend`, `loading`, `onClick` |
| `Badge`, `Tag` | `tone`: green · amber · red · blue · neutral · brand. Selalu berisi kata |
| `TextField` (`Input`), `Select`, `SearchInput`, `Switch`, `RupiahInput` | `label`, `hint`, `error` |
| `SegmentedControl`, `Tabs` | pilihan tunggal; panah kiri/kanan untuk keyboard |
| `Table` | `columns`, `rows`, `onRowClick`; otomatis bisa digeser horizontal di HP |
| `Dialog`, `Drawer`, `ConfirmDialog` | `ConfirmDialog` tidak menutup sendiri: `onConfirm` yang menutup |
| `ToastProvider`, `useToast` | `toast({ title, description, tone, action })` |
| `Tooltip` | untuk elemen selain tombol ikon |
| `Skeleton`, `SkeletonRows`, `SkeletonText` | loading isi halaman memakai skeleton, **bukan spinner** |
| `EmptyState`, `ErrorState` | kosong = ikon + kalimat + tombol aksi; error = pesan + "Coba lagi" |
| `Progress`, `CheckMark`, `Menu`, `Pagination`, `PageHeader` | |
| `AppShell` | sidebar + bar atas + palet perintah. `grouped` (grup buka-tutup, untuk menu banyak), `mobileNav="bottom"` (menu bawah di HP), `search` (pencarian data di Ctrl/Cmd+K), `actions`, `extraCrumbs` |
| `CommandPalette`, `AppearancePanel` | |
| `LineChart`, `BarChart`, `StackedBarChart`, `DonutChart`, `Sparkline` | SVG buatan sendiri, warna dari token, bisa dibaca dengan keyboard dan pembaca layar |

Setiap komponen interaktif punya: hover, fokus (outline `--accent-ink` 2px), disabled, dan loading.

### Contoh

```jsx
// KPI
<div className="ui-kpi-grid">
  <KpiCard hero label="MRR" value={1196000} format={formatRupiah} delta={4.5} deltaLabel="vs bulan lalu" trend={[5, 7, 8, 10, 12]} />
  <KpiCard label="Kafe aktif" value={4} caption="1 dalam masa tenggang" onClick={() => navigate('/kafe')} />
</div>

// Empat keadaan sebuah daftar
{error ? <ErrorState message={error} onRetry={reload} />
  : !data ? <SkeletonRows rows={5} label="Memuat tagihan" />
    : data.length === 0 ? <EmptyState icon={Receipt} title="Belum ada tagihan" description="Tagihan muncul 7 hari sebelum jatuh tempo." action={<Button size="sm">Buat tagihan</Button>} />
      : <Table columns={columns} rows={data} onRowClick={open} caption="Daftar tagihan" />}

// Grafik
<LineChart points={[{ label: 'November 2026', short: 'Nov', value: 1196000 }]} label="MRR" format={formatRupiah} formatAxis={formatRupiahCompact} />
<DonutChart segments={[{ key: 'pro', label: 'Pro', value: 3, color: 'var(--chart-1)' }]} centerValue="5" centerLabel="kafe" ariaLabel="Kafe per paket" />

// Feedback aksi
const { toast } = useToast()
toast({ title: 'Tagihan ditandai lunas', tone: 'success' })
```

## 5. Aturan per aplikasi

- **platform-admin** — padat data tapi lega. Beranda: KPI → angka kecil → "Perlu tindakan" (dengan Chat WA) + kafe per paket → grafik 12 bulan → progres setup + kesehatan kafe.
- **web owner** — menjawab "hari ini untung berapa, apa yang perlu diurus". Dashboard: sapaan → "Perlu perhatian" → KPI → grafik.
- **web staff** (`.is-staff`) — kecepatan di atas keindahan. Target sentuh ≥ 48px, teks besar, kontras tinggi, animasi minimal, nyaman di tablet 10 inci landscape. Papan pesanan: kolom berwarna lembut per status, timer berubah warna (netral → kuning → merah) dan tetap menyebut lama tunggu.

## 6. Aksesibilitas dan responsif

- Kontras teks ≥ 4,5:1 (dijamin mesin tema untuk aksen apa pun).
- Semua aksi bisa dengan keyboard; tombol ikon memakai `IconButton` (otomatis ber-`aria-label`).
- Lebar yang diuji: 1440, 1280, 1024, 390. Di HP sidebar menjadi drawer (owner, admin) atau menu bawah (staff); tabel digeser horizontal, halaman tidak.

## 7. Memeriksa perubahan tampilan

```bash
# terminal 1 dan 2
cd web-dashboard && npx vite --port 5173
cd platform-admin && VITE_MOCK=1 npx vite --port 5174

# terminal 3 — screenshot data tiruan ke tools/screenshots/out/<label>/
cd tools/screenshots && npm install && node shot.mjs sesudah        # 4 halaman utama, gelap & terang
node shot.mjs sesudah lain                                           # sapuan halaman lain
node interaksi.mjs                                                   # 30 uji: Ctrl+K, keyboard, saklar animasi, target sentuh, teks < 12px

# wajib lulus
cd web-dashboard && npm run lint && npm run build
cd platform-admin && npm run lint && npm run build
```

`npm run lint` di kedua aplikasi juga memeriksa `shared/ui/`.
