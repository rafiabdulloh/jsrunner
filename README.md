# 🚀 Local Service Runner

> Jalankan banyak project JavaScript/TypeScript sekaligus dari satu dashboard — tanpa perlu membuka belasan terminal.

**Local Service Runner** adalah aplikasi ringan untuk menggantikan banyak terminal saat kamu mengembangkan banyak project sekaligus. Cukup pilih `package.json`, dan semua service (frontend, backend, gateway, worker) berjalan dari satu dashboard yang rapi.

> ⚠️ **Catatan:** Tools ini khusus untuk **komputer lokal / development** — bukan deployment manager, bukan Docker manager, dan bukan process manager untuk production.

---

## ✨ Fitur Unggulan

| | Fitur | Deskripsi |
|---|---|---|
| 🖥️ | **Dashboard Card** | Setiap project jadi kartu: nama, framework, package manager, folder, port, PID, status, uptime, group |
| ⚙️ | **Auto Scan** | Pilih `package.json`, backend otomatis mendeteksi framework, package manager, port, dan sub-project |
| 📜 | **Dynamic Script** | Semua script di `package.json` muncul otomatis — tanpa hardcode |
| ▶️ | **Control Penuh** | Start, Stop, Restart, Install, Build, dan Custom Script per project |
| 📊 | **Realtime Log** | Log per process, polling ringan tanpa websocket — copy, clear, pause auto-scroll |
| 🔎 | **Search** | Cari realtime berdasarkan nama, folder, port, framework, atau group |
| 🗂️ | **Group** | Kelompokkan project, bisa collapse, plus aksi Start/Stop/Restart All per group |
| 💥 | **Crash Detection** | Status otomatis jadi `Crashed` saat process error — plus Auto Restart per project |
| 🔌 | **Port Manager** | Ganti port project langsung dari UI, hindari konflik port antar service |
| 📌 | **Recent Projects** | Project terakhir dijalankan tampil di strip atas, bisa dihapus |
| 🌙 | **Dark Mode** | UI gelap, responsive, card layout murni CSS Variables — tanpa framework CSS |

---

## 🧱 Teknologi

| Lapisan | Teknologi |
|---|---|
| **Backend** | Node.js — Native ES Module (`.mjs`) |
| **Frontend** | HTML + CSS + Vanilla JavaScript |
| **Database** | ❌ Tidak ada — semua data di `config/projects.json` |
| **Dependency** | ❌ **Nol package npm** — murni built-in Node.js |

Tanpa Express, React, Vue, Electron, SQLite, MongoDB, Socket.io. Ringan dan portable.

---

## 📦 Persyaratan

- **Node.js** (versi yang mendukung ES Module, disarankan v18+)
- Tidak perlu `npm install` sama sekali ✅

---

## 🚀 Cara Menjalankan

```bash
# 1. Clone repository
git clone https://github.com/<username>/service-runner.git
cd service-runner

# 2. Jalankan server
node server/server.mjs

# 3. Buka dashboard
# Browser otomatis terbuka di:
http://localhost:3000
```

### Konfigurasi Environment

| Variable | Default | Fungsi |
|---|---|---|
| `PORT` | `3000` | Port dashboard |
| `WORKDIR` | direktori sekarang | Lokasi root untuk melayani file statis |

```bash
# Contoh: jalankan di port lain
PORT=8080 node server/server.mjs
```

---

## 📖 Panduan Penggunaan

### 1️⃣ Menambahkan Project

1. Klik tombol **➕ Add Project** di kanan atas.
2. Pilih file **`package.json`** milik project kamu.
3. Backend otomatis melakukan scan:
   - Nama & versi
   - Semua script (`dev`, `build`, `test`, dll)
   - Framework & package manager
   - Port & working directory
   - Sub-project (jika ada, misal `backend/` + `frontend/`)
4. Project muncul sebagai card di dashboard. ✅

> 🔁 **Duplicate Protection:** Project dengan `package.json` yang sama tidak bisa ditambahkan dua kali.

### 2️⃣ Menjalankan & Mengontrol Project

Setiap card punya tombol aksi:

| Tombol | Fungsi |
|---|---|
| ▶️ **Start** | Menjalankan process |
| ⏹️ **Stop** | Menghentikan process |
| 🔄 **Restart** | Menjalankan ulang process |
| ⬇️ **Install** | `npm/yarn/pnpm/bun install` |
| 🏗️ **Build** | Menjalankan script `build` |
| 🧪 **Custom Script** | Menjalankan script lain dari `package.json` |

Setiap process berjalan independen dengan **PID sendiri** — banyak service jalan bersamaan tanpa saling mengganggu.

### 3️⃣ Melihat Log

Klik card untuk membuka panel **Realtime Log**:

- 📋 **Copy Log** — salin seluruh output
- 🧹 **Clear Log** — bersihkan log
- ⏸️ **Pause Auto Scroll** — berhenti mengikuti output
- 📜 **Auto Scroll** — ikuti output terbaru otomatis

### 4️⃣ Mengelompokkan Project

Kelola project dalam group, misalnya:

```
TMF
├── Gateway
├── Product
└── Inventory

POS
├── Backend
└── Frontend
```

- Buat / rename / hapus group lewat UI
- Group bisa **collapse** agar dashboard rapi
- Aksi **Start All / Stop All / Restart All** per group

### 5️⃣ Mencari Project

Gunakan kolom search di header. Pencarian **realtime** berdasarkan:

- Nama project
- Folder
- Port
- Framework
- Group

### 6️⃣ Ganti Port (Port Manager)

Cegah konflik port antar service:

1. Klik tombol **Change Port** pada card.
2. Masukkan port baru (rentang valid: `1` – `65535`).
3. Backend otomatis **rewrite file konfigurasi** (bukan `.env`), lalu rescan & update UI.

File yang didukung: `.env.local`, `.env.development`, `vite.config.js/ts`, `next.config.js/mjs`, `package.json` script, `angular.json`, `nest-cli.json`.

> ⛔ Jika port sudah dipakai → muncul pesan **"Port already in use."**
> ⛔ Jika file tidak didukung → **"Port configuration not supported."**

### 7️⃣ Fitur Tambahan

- **Start All / Stop All** — kontrol semua project dari header (tombol **Stop All**).
- **Auto Restart** — aktifkan per project; jika crash, process dijalankan ulang otomatis.
- **Crash Detection** — status berubah jadi `Crashed` + notifikasi toast saat process error.
- **Recent Projects** — project terakhir muncul di strip atas; ada tombol hapus per item.
- **Edit Path** — ubah lokasi `package.json` dari dialog; backend otomatis validasi → rescan → update config.
- **Rescan** — baca ulang `package.json`; UI ikut berubah jika script/nama/framework/port berubah.
- **Auto Save** — semua perubahan tersimpan otomatis, tanpa tombol Save. 💾

---

## 🔍 Deteksi Otomatis

### Framework

React · Vite · Next · Node · Express · NestJS · Nuxt · Vue · Angular · Astro

Jika tidak dikenal → `Unknown`.

### Package Manager

Prioritas deteksi dari lockfile:

```
bun.lockb      → bun
pnpm-lock.yaml → pnpm
yarn.lock      → yarn
package-lock.json → npm
```

Semua perintah mengikuti package manager project, misal `pnpm dev`, `bun dev`, `npm run dev`, atau `yarn dev`.

---

## 📡 REST API

| Method | Endpoint | Fungsi |
|---|---|---|
| `GET` | `/api/projects` | Daftar semua project |
| `POST` | `/api/project` | Tambah project |
| `POST` | `/api/project/start` | Start project |
| `POST` | `/api/project/stop` | Stop project |
| `POST` | `/api/project/restart` | Restart project |
| `POST` | `/api/project/script` | Jalankan script / custom script |
| `POST` | `/api/project/script/cancel` | Batalkan script berjalan |
| `POST` | `/api/project/rescan` | Scan ulang `package.json` |
| `POST` | `/api/project/path` | Ubah lokasi `package.json` |
| `POST` | `/api/project/port` | Ganti port project |
| `POST` | `/api/project/group` | Set group project |
| `POST` | `/api/group/rename` | Rename group |
| `POST` | `/api/group/delete` | Hapus group |
| `GET` | `/api/project/:id/logs` | Ambil log project |
| `POST` | `/api/project/:id/logs/clear` | Bersihkan log |
| `DELETE` | `/api/project/:id` | Hapus project dari config |

---

## 📁 Struktur Folder

```
service-runner/
├── server/          # HTTP server, router, static file
│   ├── server.mjs   # Entry point
│   ├── router.mjs   # Router minimalis (tanpa framework)
│   └── static.mjs   # Static file server
├── api/             # Route handlers per domain
│   ├── projects.mjs
│   ├── control.mjs  # start / stop / restart
│   ├── script.mjs   # dynamic & custom script
│   ├── logs.mjs
│   ├── port.mjs     # port manager
│   ├── path.mjs     # edit path
│   └── group.mjs
├── utils/           # Logic inti (modular, terpisah)
│   ├── config.mjs   # baca/tulis config/projects.json
│   ├── scanner.mjs  # scan & deteksi framework/pm/port
│   ├── process.mjs  # process manager (spawn, kill, crash)
│   ├── script-runner.mjs
│   ├── logger.mjs   # buffer log per process
│   ├── port.mjs     # rewrite konfigurasi port
├── public/          # Frontend vanilla JS
│   ├── index.html
│   ├── css/
│   └── js/          # cards, groups, logs, search, dialogs, recent...
└── config/
    └── projects.json  # Satu-satunya "database"
```

---

## ⚙️ Konfigurasi

Semua data tersimpan di **`config/projects.json`** — tidak ada database. Backup semudah menyalin satu file.

```json
{
  "id": "p_abc123",
  "name": "my-app",
  "group": "POS",
  "framework": "React",
  "pm": "npm",
  "folder": "D:/project/my-app",
  "path": "D:/project/my-app/package.json",
  "port": 5173,
  "scripts": ["dev", "build", "test"],
  "favorite": false,
  "autoRestart": false,
  "status": "stopped",
  "pid": null
}
```

---

## 🛠️ Status Implementasi

| Fitur | Status |
|---|---|
| HTTP Server + Router (tanpa framework) | ✅ Selesai |
| Config Manager (`projects.json`) | ✅ Selesai |
| Scanner (framework, PM, port, sub-project) | ✅ Selesai |
| REST API | ✅ Selesai |
| Process Manager (multi-process, PID) | ✅ Selesai |
| Dashboard + Dynamic Script | ✅ Selesai |
| Realtime Log (copy, clear, pause scroll) | ✅ Selesai |
| Search | ✅ Selesai |
| Group + Group Action | ✅ Selesai |
| Port Manager | ✅ Selesai |
| Crash Detection + Auto Restart | ✅ Selesai |
| Recent Projects | ✅ Selesai |

---

## 🧑‍💻 Development

Struktur modular dengan separation of concern. Beberapa prinsip yang dipegang:

- ✅ Modular & mudah dibaca
- ✅ Async/Await, tanpa kode duplikat
- ✅ Error handling lengkap
- ✅ Tanpa dependency eksternal
- ✅ Setiap modul kecil, fokus satu tanggung jawab

---

## 📄 Lisensi

Belum ditentukan. Dibuat untuk keperluan internal / personal development.
