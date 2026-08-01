# Panduan Publikasi, Bundle & Pemeliharaan — jsrunner

Tool ini **zero-dependency** (murni Node.js built-in, native ESM). Karena itu **tidak ada build step** — "bundle" yang di-publish ke npm adalah source code asli yang di-whitelist lewat `files` di `package.json`. Update = edit source → tag → publish. Sederhana dan aman.

---

## 1. Arsitektur Bundle

| Item | Nilai |
|---|---|
| Nama package | `jsrunner` (bin: `lsr` / `localsr`) |
| Entry | `server/server.mjs` — dipanggil via bin `lsr` |
| Build step | ❌ Tidak ada (source langsung dikirim) |
| Dependency | ❌ Nol (`npm audit` trivially clean) |
| Isi tarball | `server/`, `api/`, `utils/`, `public/`, `README.md` (dari `files`) |
| **TIDAK ikut** | `config/` (data lokal user!), `.omo/`, `.github/`, `docs/`, `.git/` |

> ⚠️ **PENTING — `config/projects.json` adalah data USER (daftar project lokal).**
> `files` whitelist otomatis mengecualikannya. Saat first run di mesin user,
> `utils/config.mjs` membuat folder `config/` sendiri (sudah ada `mkdirSync`).
> Jangan pernah menambahkan `config/` ke `files`.

---

## 2. Prasyarat (sekali saja)

1. Akun npm: https://www.npmjs.com/signup — **aktifkan 2FA (wajib untuk publish)**
2. Node.js ≥ 18 lokal (untuk verifikasi `npm pack`, bukan untuk user install)
3. Login CLI:
   ```bash
   npm login
   ```

---

## 3. Keputusan SEBELUM publish pertama

| Keputusan | Opsi | Catatan |
|---|---|---|
| **Nama** | `jsrunner` | Cek: `npm view jsrunner` — kalau dipakai, ganti nama/scope |
| **Lisensi** | `"license": "MIT"` (sudah di-set) | File `LICENSE` sudah ada; ganti copyright holder jika bukan "Neuronworks" |
| **Privat vs publik** | `"private": false` untuk publish | Kalau cuma internal: `"private": true` + publish ke registry privat (GitHub Packages / Verdaccio) |

---

## 4. Publikasi Manual (first time / tanpa CI)

```bash
# 1. Bump versi (semver)
npm version patch   # 0.1.0 -> 0.1.1 (bugfix)
npm version minor   # 0.1.0 -> 0.2.0 (fitur baru, non-breaking)
npm version major   # 0.1.0 -> 1.0.0 (breaking change)

# 2. Periksa isi tarball SEBELUM publish
npm pack --dry-run
#   -> cek daftar file: config/ TIDAK boleh muncul, semua yang perlu ADA

# 3. Publish
npm publish
#   (2FA prompt)

# 4. Verifikasi dari sisi pembeli
npm view jsrunner version
npm i -g jsrunner
lsr --help
lsr --port 9876
```

---

## 5. Workflow Pemeliharaan — "update tinggal push"

Alur rilis otomatis (`.github/workflows/publish.yml` sudah disiapkan):

```
fix/feature → commit → npm version patch|minor|major
                  → git push && git push --tags
                  → GitHub Actions: syntax gate → npm publish --provenance
```

**Aturan semver:**
| Bump | Kapan |
|---|---|
| `patch` (x.y.1) | Bugfix, tidak mengubah perilaku |
| `minor` (x.1.z) | Fitur baru, backward-compatible |
| `major` (1.y.z) | Breaking change (mis. ganti format config, ubah default port) |

**Rilis bermasalah:** pakai `npm deprecate jsrunner@0.1.2 "kritikal — pakai 0.1.3"`.
**JANGAN unpublish** (hanya bisa ≤72 jam, dan bisa bikin install user lain rusak karena
cache/registry hilang).

**Housekeeping tiap rilis:**
- Update `README.md` (default port sekarang **9999** — README lama masih tulis 3000)
- Catat perubahan di `CHANGELOG.md` (buat jika belum ada)
- Pastikan `npm run check` hijau (syntax gate)

**Test otomatis (future):** project belum punya test framework. Sebelum tool di-pakai
banyak orang, tambahkan minimal smoke test di CI (start server → `GET /api/projects` → 200).

---

## 6. Keamanan

### Sudah diterapkan
- ✅ **Bind 127.0.0.1 default** (`server/server.mjs`) — tool tanpa auth; sebelum ini bind
  ke semua interface (0.0.0.0) = dashboard bisa diakses dari LAN siapa pun. Expose LAN
  hanya lewat `--host 0.0.0.0` secara eksplisit.
- ✅ **Zero dependency** — permukaan supply-chain minimal, `npm audit` selalu bersih,
  tidak ada transitive dependency yang bisa disusupi.
- ✅ **`files` whitelist** — `config/projects.json` (path project lokal user), `.env`,
  `.omo/`, skrip pribadi, dsb. TIDAK pernah ikut ke tarball.
- ✅ **`prepack` syntax gate** — versi rusak tidak akan lolos ke publish.
- ✅ **Provenance** (CI) — `npm publish --provenance` menempelkan bukti build dari
  GitHub Actions; pembeli bisa verifikasi asal-usul paket.
- ✅ **Config auto-create** — user tidak perlu setup manual; folder `config/` dibuat
  saat first write.

### Kewajiban maintainer
- 🔒 **2FA wajib** di akun npm (npm menolak publish tanpa 2FA saat ini).
- 🔒 `NPM_TOKEN` disimpan sebagai **GitHub secret**, jangan pernah di-commit.
- 🔒 Jangan publish dengan akun yang terhubung ke email/registry lain yang tidak dikenal.
- ⚠️ **Peringatan penggunaan (tulis di README):** tool ini **menjalankan script dari
  `package.json` project yang ditambahkan user** (`dev`, `build`, dsb). Itu by-design
  untuk dev lokal. User hanya boleh menambahkan **project yang dipercaya**. Jangan
  pernah expose dashboard (`--host 0.0.0.0` / port-forward) ke jaringan publik —
  tidak ada autentikasi, dan endpoint `/api/project/script` bisa menjalankan perintah
  arbitrary di mesin host.
- 📦 Setiap rilis: jalankan `npm pack --dry-run` dan pastikan isi tarball bersih.

### Checklist sebelum publish pertama
- [ ] Nama package unik (`npm view jsrunner` kosong)
- [ ] Lisensi MIT + `LICENSE` berisi copyright holder yang benar
- [ ] `npm pack --dry-run` — `config/` tidak ada, `server/` ada
- [ ] `lsr --help` jalan
- [ ] Instal di direktori kosong: `npm i -g .` atau dari tarball → first run sukses,
      `config/projects.json` ter-create otomatis
- [ ] README diperbaiki (port default 9999)
