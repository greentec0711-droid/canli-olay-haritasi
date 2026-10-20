# Canlı Olay Haritası

Türkiye, Kürdistan ve Orta Doğu'daki çatışma, saldırı, protesto, siyasi gelişme ve depremleri harita üzerinde gösteren, **tamamen ücretsiz** çalışan web sitesi.
Arayüz 5 dilde: **Türkçe, Kurmancî, Soranî, English, العربية** (Soranî ve Arapça sağdan sola).

## Ne ücretsiz, nasıl?

| Parça | Kullanılan | Ücret |
|---|---|---|
| Harita kütüphanesi | Leaflet + MapLibre (açık kaynak) | 0 |
| Harita altlığı | OpenFreeMap (OpenStreetMap verisi) | 0 (anahtar ve limit yok) |
| Dünya basını | GDELT 2.0 — İngilizce + 65 dilden çeviri, 15 dakikada bir | 0 (anahtar yok) |
| Bölge basını | ~40 RSS akışı: Türkçe, Kurmancî, Soranî, Arapça, Farsça, İngilizce | 0 |
| Telegram | ~20 herkese açık kanal (t.me/s/… sayfası) | 0 (hesap gerekmez) |
| Depremler | USGS (M4.5+, son 24 saat) | 0 |
| Veri işleme | GitHub Actions, her 15 dk | 0 (public depo) |
| Barındırma | GitHub Pages | 0 |

Sunucu, veritabanı veya API anahtarı yok. Veri `data/` klasörüne yazılır, site o dosyaları okur.

## Konum nasıl bulunuyor?

RSS ve Telegram haberlerinde konum yoktur. `scripts/lib/places.mjs` içindeki çok dilli yer adı listesi metindeki yer adını bulur.
Aynı yerin farklı yazımları tek konuma gider: **Hakkari = Çölemerik = Colemêrg = جۆلەمێرگ = هكاري**, **Diyarbakır = Amed = ئامەد**,
**Erbil = Hewlêr = هەولێر = أربيل**, **Kamışlı = Qamişlo = القامشلي** gibi. Ekli yazımlar da tanınır: "Hakkari'de", "Amedê", "هەولێرەوە", "بالموصل".

Bir yer eksikse aynı biçimde bir satır eklemeniz yeterli.

## Bilgisayarda deneme

En kolayı: **`baslat.bat`** dosyasına çift tıklayın. Haberleri çeker, siteyi tarayıcıda açar ve pencere açık kaldıkça 5 dakikada bir haberleri yeniler.

Elle çalıştırmak için (Node.js 18+ gerekir):

```bash
node scripts/fetch.mjs
```

```bash
node scripts/serve.mjs
```

Sonra tarayıcıda http://localhost:8080 adresini açın.

## İnternette yayınlama (ücretsiz)

1. GitHub'da **public** bir depo açın ve bu klasördeki tüm dosyaları yükleyin.
2. Depoda **Settings → Pages → Source: GitHub Actions** seçin.
3. **Actions** sekmesinde "Verileri güncelle ve yayınla" iş akışını bir kez **Run workflow** ile çalıştırın. Site `https://KULLANICI.github.io/DEPO/` adresinde açılır ve her 15 dakikada bir kendiliğinden güncellenir.

## Paylaşılabilir bağlantılar

Adresin sonuna parametre ekleyerek siteyi belli bir dilde ve bölgede açabilirsiniz:

- `?lang=` — `tr`, `ku`, `ckb`, `en`, `ar`
- `?region=` — `all`, `tr`, `kurdistan`, `sy`, `iq`, `ir`, `il`, `cy`

Örnek: `https://KULLANICI.github.io/DEPO/?lang=ckb&region=kurdistan`

## Kaynak ekleme / çıkarma

`scripts/sources.json` dosyasını düzenleyin. RSS için adres, Telegram için sadece kanal adı (`t.me/KANAL` → `KANAL`) yazılır. `lang`: tr, ku, ckb, ar, fa, en.

## Elle olay ekleme

`data/manual.json` dosyasına kayıt ekleyin (başlık, yer, enlem/boylam, zaman, kaynak). Bunlar 📌 işaretiyle görünür.

## Dosyalar

- `index.html`, `app.js`, `style.css` — site
- `i18n.js` — arayüz metinleri (5 dil)
- `scripts/fetch.mjs` — veri toplayıcı; `scripts/lib/` altında GDELT, RSS/Telegram, yer adı listesi ve kategori kuralları
- `scripts/sources.json` — haber kaynakları
- `scripts/serve.mjs`, `baslat.bat` — bilgisayarda çalıştırma

## Ayarlar

- `HOURS` — ilk çalıştırmada kaç saat geriye gidilsin (varsayılan 6)
- `KEEP_HOURS` — kaç saatlik olay saklansın (varsayılan 48)
- `MAX_EVENTS` — en fazla olay sayısı (varsayılan 6000)
- `UPDATE_MIN` — `serve.mjs` kaç dakikada bir yenilesin (varsayılan 5)
- Kategori kelimeleri: `scripts/lib/classify.mjs`

## Bilinmesi gerekenler

- Sistem tamamen otomatiktir; insan editör yoktur. Bazı haberler yanlış yere düşebilir ya da yanlış kategoriye girebilir. Önemli olaylar için `manual.json` kullanın.
- GDELT başlık vermez; başlık haber adresinden üretilir (genelde İngilizce).
- Haberler kendi dillerinde gösterilir; "Çevir" bağlantısı haberi Google Çeviri'de seçili arayüz dilinde açar.
- Telegram okuma resmi bir API değildir; Telegram sayfa yapısını değiştirirse ya da çok sık istekleri engellerse o kaynaklar geçici olarak boş gelebilir.
- Herkese açık Soranî Telegram kanalı bulunamadı; Soranî haberler şimdilik Kurdistan24 Soranî RSS'inden geliyor.
