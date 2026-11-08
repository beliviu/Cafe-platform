/*
 * Identitas platform (white-label).
 * - VITE_PLATFORM_NAME: nama bawaan sebelum kafe dikenali (mis. di halaman login).
 * - VITE_CAFE_ID (opsional): kunci web ini ke satu kafe, sehingga halaman login
 *   langsung tampil dengan logo & nama kafe itu. Kosong = mode multi-kafe.
 */
export const PLATFORM_NAME = import.meta.env.VITE_PLATFORM_NAME?.trim() || 'dailybrew'
export const TENANT_CAFE_ID = import.meta.env.VITE_CAFE_ID?.trim() || null
