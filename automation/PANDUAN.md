# Akuruna Media — otomasi berita, ilustrasi, dan Instagram

Versi awal siap dipasang. Kode lokal sudah diuji dengan layanan tiruan; akun Cloudflare, OpenAI, WordPress, dan Instagram kamu belum digunakan untuk menguji versi ini. Jadwal belum aktif.

## Apa yang dibuat

Sistem mengambil berita baru dari RSS yang diizinkan, membaca artikel, menulis artikel Indonesia dan caption Instagram tersendiri, memeriksa kesesuaian tulisan dengan sumber, membuat ilustrasi melalui OpenAI, lalu menempelkan logo AM dan judul dengan template. Hasil gambar berupa JPG 1080 × 1080 dengan warna hitam–hijau seperti referensimu.

WordPress menyimpan artikel dan gambar. Saat mode publikasi aktif, sistem meminta Jetpack membagikannya ke layanan Instagram yang kamu pilih. Token WordPress tetap tersimpan terenkripsi di D1. GitHub tidak menerima token WordPress atau kunci admin Cloudflare.

Satu proses menangani maksimal satu artikel. Default dua jadwal sehari, sekitar **08.17 dan 18.17 WIB**, dengan batas dua percobaan per hari. Percobaan gagal atau berita yang ditolak pemeriksa tetap dihitung. Berita lama, sumber tidak lengkap, dan judul yang tidak muat dilewati. Tidak ada kewajiban memenuhi kuota jika sumber tidak layak.

## 1. Tambahkan kode ke GitHub

Ekstrak ZIP paket ini. Folder `akurunamedia-main` berisi kode situs lama dan tambahan berikut. Kamu cukup menambahkan file baru ini, sehingga tidak perlu menimpa situs atau koneksi lama:

| Letak di repository | Kegunaan |
|---|---|
| `functions/api/auto.js` | Bridge WordPress dan pencatatan D1 |
| `functions/agent-auto.js` | Halaman status admin |
| Folder `automation/` | Pengambil berita, penulis, ilustrasi, panduan, tes |
| `.github/workflows/akuruna-auto.yml` | Jadwal dan tombol uji |
| `.gitignore` | Mencegah hasil sementara dan secret lokal masuk repo |

Di repo `akurunaginting-star/akurunamedia`, gunakan **Add file → Upload files** untuk folder `automation`. Untuk dua file JavaScript, buka folder tujuan di GitHub lalu unggah file yang sesuai. Pastikan letaknya persis seperti tabel; jangan membuat folder `akurunamedia-main` lagi di dalam repo.

Untuk workflow tersembunyi: di halaman utama repo pilih **Add file → Create new file**. Isi nama `.github/workflows/akuruna-auto.yml`, lalu salin isi file workflow dari paket. Pada Mac, **Command + Shift + titik** menampilkan folder `.github` di Finder. Simpan perubahan dengan Commit changes. Jadwal tetap tidak berjalan sebelum `AUTO_ENABLED=true`.

Cloudflare Pages yang terhubung ke branch `main` perlu menyelesaikan deployment perubahan. Jangan memilih upload ZIP statis untuk menggantikan deployment Pages Functions.

## 2. Tambahkan konfigurasi Cloudflare

Pada proyek Pages **akurunamedia**, buka pengaturan variabel/secrets untuk **Production**. Pertahankan `AGENT_DB`, `AGENT_ADMIN_KEY`, dan seluruh konfigurasi OAuth yang sudah bekerja.

| Nama | Jenis | Nilai |
|---|---|---|
| `AUTO_RUN_KEY` | Secret | Kunci acak baru minimal 32 karakter, khusus runner |
| `AUTO_MODE` | Text | `draft` untuk mulai menguji |
| `AUTO_MAX_DAILY` | Text | `2` |
| `AUTO_INSTAGRAM_SERVICE` | Text | Diisi setelah melihat status pada langkah berikut |

Buat kunci dengan generator password atau di Terminal Mac: `openssl rand -hex 32`. Masukkan hasilnya langsung ke tempat secrets. Jangan menempelkannya di chat, file repo, atau screenshot. Gunakan nilai `AUTO_RUN_KEY` yang sama di Cloudflare dan GitHub. **Jangan mengganti `AGENT_ADMIN_KEY`: token WordPress lama dienkripsi dengan kunci tersebut.**

Lakukan deployment baru setelah mengubah variabel. Tabel `agent_auto_jobs` dibuat otomatis dalam D1 `AGENT_DB`; tidak perlu menjalankan SQL manual.

## 3. Periksa koneksi Instagram

Buka **https://akurunamedia.id/agent-auto**. Masukkan kunci admin yang selama ini kamu gunakan di formulir WordPress. Halaman ini hanya membaca status.

Pada bagian Koneksi sosial, temukan baris Instagram, lalu salin nilai **Service** persis ke variabel Cloudflare `AUTO_INSTAGRAM_SERVICE`. Jangan menebak dari username: nama service bisa berbeda dengan nama akun. Pastikan hanya satu koneksi untuk service tersebut dan akunnya memang milik Akuruna Media. Sistem menolak mode publikasi jika service tidak mengandung `instagram` atau terdapat lebih dari satu koneksi cocok.

Jika tidak ada Instagram, periksa ulang koneksinya di WordPress → Jetpack → Share to social media. Hubungan Facebook–Instagram saja belum cukup jika koneksi WordPress terputus.

## 4. Tambahkan GitHub Secrets

Di repo: **Settings → Secrets and variables → Actions → Secrets → New repository secret**.

| Secret | Nilai |
|---|---|
| `AUTO_RUN_KEY` | Sama dengan secret baru di Cloudflare |
| `OPENAI_API_KEY` | API key OpenAI dengan izin Responses dan Images |

Kunci OpenAI lama yang hanya mengizinkan Responses perlu juga mendapat izin pembuatan gambar, atau gunakan kunci terpisah yang memiliki keduanya. Akses model dan saldo API harus tersedia. Paket berlangganan ChatGPT tidak menjadi saldo API untuk runner ini.

Biarkan variabel repository `AUTO_ENABLED` kosong/`false` selama pengujian. Jangan menyimpan token WordPress, password Instagram, password Facebook, maupun kunci admin di GitHub.

## 5. Uji koneksi tanpa membuat konten

GitHub → **Actions → Akuruna Auto → Run workflow → mode `inspect` → Run workflow**.

Hasil run berisi mode, koneksi, pekerjaan terakhir, dan `source_checks`. Setiap feed harus menghasilkan `readable: true`. Mode ini tidak memanggil AI, mengunggah media, atau menerbitkan artikel. Bila feed diblokir, ubah daftar sumber yang memang boleh diakses pada `automation/config.json`; jangan melewati paywall atau pembatasan akses.

## 6. Uji satu draf lengkap

Jalankan workflow dengan mode **`draft`**. Langkah ini memakai API berbayar untuk tulisan dan satu ilustrasi, lalu menyimpan draf WordPress dengan gambar. Tidak mengirim ke Instagram.

Di halaman run, unduh artifact `akuruna-result-…`. Isinya:

- `instagram.jpg`: ilustrasi AI dengan logo dan judul.
- `caption.txt`: caption tersendiri yang akan dikirim ke Instagram.
- `report.json`: sumber, cuplikan bukti, catatan pemeriksaan, dan hasil WordPress.

Buka draf dari `/agent-auto` dan periksa gambar, judul, fakta, serta caption. Jika berita ditolak sebelum gambar dibuat, artifact hanya berisi laporan. Jika tidak ada berita baru layak, run selesai tanpa membuat konten.

Repo ini publik: log dan artifact GitHub dapat diakses sesuai izin pembaca repo. Gunakan hanya bahan berita publik. Program tidak mencetak API key atau token.

## 7. Uji satu publikasi ke Instagram

Setelah hasil draf sesuai, ubah Cloudflare `AUTO_MODE=publish`, isi service Instagram yang benar, lalu deploy ulang. Biarkan `AUTO_ENABLED=false` agar belum ada jadwal rutin.

Periksa pengaturan **Jetpack → Social → Enable Social Image Generator**. Matikan generator gambar Jetpack jika aktif, karena gambar dari runner sudah memiliki judul. Ini mencegah template Jetpack menambahkan judul kedua. Pertahankan koneksi sosial dan pembagian otomatis. Periksa preview gambar featured image ketika menguji.

Jalankan workflow sekali dengan mode **`auto`**. Ini memilih berita baru; berita yang sebelumnya sudah diproses sebagai draf tidak diterbitkan ulang oleh runner. Jika batas harian habis, tunggu hari berikutnya WIB. Jangan menaikkan batas semata-mata untuk mengulang request yang statusnya belum jelas.

Periksa dua hasil:

1. WordPress: artikel berstatus terbit dan gambar benar.
2. Instagram: gambar berlogo dan caption ringkasan benar-benar muncul.

Status `published_wp` **bukan bukti Instagram berhasil**. WordPress menerima permintaan berbagi; Jetpack/Meta mengurus pengiriman berikutnya. Versi ini belum mengonfirmasi ID posting Instagram secara otomatis. Jika tidak muncul, periksa status/error berbagi Jetpack. Jangan membuat ulang artikel untuk memaksa kirim karena dapat menghasilkan duplikasi.

Publikasi WordPress juga dapat menjalankan newsletter dan integrasi lain yang sudah kamu aktifkan di situs. Periksa pengaturan newsletter sebelum uji jika kamu memiliki pelanggan.

## 8. Aktifkan jadwal

Setelah satu uji publikasi benar-benar berhasil:

- Cloudflare: `AUTO_MODE=publish`.
- GitHub: Settings → Secrets and variables → Actions → **Variables** → New repository variable → `AUTO_ENABLED` = `true`.

Workflow mengambil berita sekitar dua kali sehari. Komputer kamu tidak perlu menyala. Ini program yang berjalan di GitHub dan layanan API, bukan chat ini yang terus aktif di latar belakang.

Untuk jeda, ubah `AUTO_ENABLED=false`. Untuk menghentikan juga pengiriman dari proses yang sedang berjalan, set `AUTO_MODE=off` di Cloudflare dan deploy. Pengiriman yang sudah diterima WordPress tidak dapat ditarik kembali dengan tombol jeda. Mengaktifkan `draft` menyimpan pekerjaan berikutnya sebagai draf.

## Sumber, biaya, dan batas versi awal

- Default sumber: CoinDesk RSS, tema BTC/kripto/ekonomi. Sumber dapat ditambah melalui `feeds` dan `source_hosts` pada config. Host redirect juga harus diizinkan. Sumber yang tidak bisa dibaca dilewati.
- Sistem membandingkan tulisan dengan teks sumber, memeriksa cuplikan bukti, dan meminta pemeriksaan AI kedua. Ini **bukan verifikasi independen atas kebenaran sumber**. Berita sensitif/rumor atau klaim yang meragukan diminta untuk ditolak. Pemeriksaan otomatis tetap bisa salah.
- Model default: `gpt-4.1-mini` untuk tulisan dan pemeriksaan, `gpt-image-1-mini` kualitas medium untuk gambar. Satu pekerjaan lolos memanggil teks dua kali dan gambar satu kali. Harga mengikuti layanan; periksa Usage OpenAI setelah beberapa uji sebelum menetapkan anggaran bulanan. Batas harian membatasi jumlah percobaan, bukan menjamin nominal biaya rupiah.
- Caption hasil akhir dibatasi 1.800 karakter agar ringkas dan menyisakan ruang jika Jetpack menambahkan tautan. Artikel web dan caption sengaja berbeda. Sumber lengkap tetap di artikel.
- Gambar berupa ilustrasi simbolis; versi awal tidak otomatis membuat wajah tokoh nyata atau adegan kontroversial yang tampak seperti foto kejadian.
- Anti-duplikasi berdasarkan URL sumber yang dinormalisasi. Dua URL berbeda tentang peristiwa sama masih mungkin dianggap berita berbeda.
- Jadwal GitHub dapat terlambat. Pada repo publik, jadwal dapat dinonaktifkan GitHub setelah 60 hari tanpa aktivitas repo. Periksa Actions berkala.
- Koneksi Instagram bisa kedaluwarsa/dicabut dan kuota Jetpack mengikuti akunmu. Perubahan koneksi atau layanan membutuhkan pemeriksaan ulang.

## Jika status berhenti

| Status | Tindakan |
|---|---|
| `draft` | Buka draf WordPress dan periksa |
| `published_wp` | Verifikasi kiriman Instagram |
| `skipped` | Baca alasan pemeriksa; tidak diposting |
| `reserved` terlalu lama | AI/runner mungkin terputus; baca artifact. Sumber tidak diulang otomatis |
| `uploading` / `upload_uncertain` | Periksa Media Library WordPress; jangan unggah ulang secara paksa |
| `saving` / `save_uncertain` | Cari slug `akuruna-auto-…` atau judul di WordPress; jangan membuat duplikat |
| `daily_limit_or_duplicate` | Batas WIB habis atau sumber sudah diambil proses lain |
| `configure_exactly_one_instagram_connection` | Isi service yang tepat dan periksa koneksi Instagram |

Versi ini memilih berhenti saat hasil upload/publikasi belum pasti. Tidak ada retry otomatis yang bisa menimbulkan posting ganda. Pemulihan job yang macet memerlukan pemeriksaan WordPress terlebih dahulu.

## Catatan pengembang dan validasi

Kode tambahan tidak mengubah formulir `/agent-write`, OAuth, halaman depan, atau isi artikel lama. `/agent-auto` memerlukan kunci admin; `/api/auto` memerlukan secret bearer khusus. Draft secara eksplisit memakai `publicize=false`; publikasi memilih service Instagram tertentu dan mengirim `publicize_message`. Semua paragraf di-escape sebelum menjadi HTML.

Pengujian lokal:

```sh
python -m pip install -r automation/requirements.txt
python -m unittest discover -s automation -p 'test_*.py' -v
node automation/test_bridge.mjs
```

Node 24 diperlukan untuk tes SQLite lokal. Runner GitHub menggunakan Python 3.12. Tes memakai jaringan/AI/WordPress tiruan; tidak membuktikan keberhasilan layanan live. Pengambilan RSS live dari lingkungan pengembangan ini belum berhasil diverifikasi karena akses jaringan dibatasi; workflow inspect disediakan untuk memeriksanya dari GitHub.

Dokumentasi resmi yang menjadi acuan:

- [WordPress: membuat post, featured image dan publicize_message](https://developer.wordpress.com/docs/api/1.1/post/sites/$site/posts/new/)
- [WordPress: daftar koneksi sosial](https://developer.wordpress.com/docs/api/1.1/get/sites/$site/publicize-connections/)
- [WordPress: upload media](https://developer.wordpress.com/docs/api/1.1/post/sites/$site/media/new/)
- [Jetpack: Social Image Generator](https://jetpack.com/support/jetpack-social/jetpack-social-image-generator/)
- [OpenAI: image generation](https://developers.openai.com/api/docs/guides/image-generation)
- [GitHub: mengaktifkan dan menonaktifkan workflow](https://docs.github.com/actions/managing-workflow-runs/disabling-and-enabling-a-workflow)
