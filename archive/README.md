# archive/ — komponen yang sudah tidak dipakai

Isi folder ini adalah komponen yang dulunya dirender di menu Plugin tapi
sudah digantikan oleh `src/pages/PluginPage.tsx` + hook baru
(`useAgentManager`, `useOAuthApproval`, `services/agentSession`).

## File di sini

* `PluginPanel.tsx` (1600+ baris) — implementasi Plugin lama. Sudah
  di-deprecate (lihat header file). Disimpan supaya:
  - fitur yang belum di-port bisa dilihat sebagai referensi
    (credentials, spending limits, card linking, pending-tx signing),
  - bug yang dulu terjadi (commented-out destructuring) mudah di-debug.

  JANGAN dipanggil dari App.tsx: merender PluginPanel dan PluginPage
  bersamaan akan menjalankan dua passkey/session flow yang bersaing di
  halaman yang sama.

* `pluginPanelHandlers.test.ts` — dulu, regression test untuk handler
  MSCA di PluginPanel. Dihapus saat PluginPanel pensiun: tidak ada
  kode yang dilindungi, dan ia gagal dengan `ENOENT` ketika PluginPanel
  pindah ke sini.

## Cara memindahkan PluginPanel kembali

```bash
git mv archive/PluginPanel.tsx src/components/PluginPanel.tsx
```

Setelah itu, komponen ini TIDAK otomatis dirender. Untuk benar-benar
memakainya, lihat catatan di header file.
