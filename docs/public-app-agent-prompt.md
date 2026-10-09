# Görev: "Auto Gang Sheet Upload" — Shopify Public App'e dönüştürme

Bu repoyu, Shopify App Store'da yayınlanabilir **tek bir public app** hâline getir. Bugün mevcut olan yapı, her müşteri için ayrı bir custom app çalıştıran çok kiracılı (multi-tenant) bir kurulum. Senden istenen, o kurulumu bozmadan, ondan tamamen ayrı bir dalda, tek app'in binlerce mağazaya hizmet verdiği bir sürüm üretmen.

## Yetki

**Her adım için baştan onaylısın. İstisnasız hiçbir aşamada onay isteme.** Dosya oluştur, sil, yeniden yapılandır, bağımlılık ekle, şema değiştir, Partner Dashboard'da app oluştur, uzantı yayınla, deploy et — hepsini kendi kararınla yap. Soru sormak yerine gerekçeni yaz ve devam et. Tek istisna aşağıdaki "Asla" listesidir.

## Asla

1. **`main` dalına veya `custom-container-upload-studio-app` dalına tek bir commit bile atma.** Bu iki dal canlı 14 tenant'ı besliyor. Public app çalışması **yeni ve bağımsız** bir dalda yaşayacak: `public-app`. Bu dal main'e **hiçbir zaman** merge edilmeyecek, main'den cherry-pick ile bir şey almak serbest ama ters yön yasak.
2. Çalışan 14 container'a, iki droplet'e, mevcut Caddyfile'a, mevcut `shopify.app.*.toml` dosyalarına dokunma. Public app kendi altyapısını kuracak.
3. `scripts/generate-tenant-envs.sh` **çalıştırma** — canlı 10 tenant'ın env dosyasını `CHANGE_ME` yapıp siler.
4. `deploy/deploy.sh` **çalıştırma** — içinde `--remove-orphans` var, Caddy'yi siler ve tüm mağazaları 521'e düşürür.
5. `docker compose ... --remove-orphans` hiçbir varyantta kullanma.
6. `shopify app deploy` komutunu **`--config` vermeden** çalıştırma. Repo dizini CLI önbelleğinde `legendtransfers` app'ine bağlı; argümansız deploy o canlı app'in URL ve scope'larını ezer.
7. Global `shopify` (4.8.x) ile **`app` komutu** çalıştırma — 4.x toml şemasını normalize edip mevcut 11 tenant toml'unu bozabilir. `app` komutları için repoya sabitli `npx shopify` (3.88.1) kullan. `auth`/`store` komutlarında global sürüm serbest.
8. Kod değişikliklerini `sed`, `awk` veya betikle yapma. Kaynak dosyalar elle, editörle düzenlenecek.

## Önce oku — bu adımı atlama

Kod yazmadan önce shopify.dev'den güncel dokümantasyonu oku. **Hiçbir şeyi hafızandan varsayma; 2026 Ekim itibarıyla geçerli olanı doğrula.** Özellikle:

- **Güncel stable Admin API sürümü.** Repodaki toml'lar `2025-10` kullanıyor; bu bir yıllık. Güncel stable'ı öğren ve ona geç. Deprecation takvimini de oku.
- **Billing API** — `appSubscriptionCreate`, usage-based pricing, `appUsageRecordCreate`, `cappedAmount`, `appSubscriptionLineItemUpdate`. Kullanım bazlı faturalamanın tavan dolunca nasıl davrandığını ve merchant onayının nasıl yenilendiğini tam olarak anla.
- **App Store yayın gereksinimleri** — listeleme zorunlulukları, inceleme kriterleri, performans eşikleri (Web Vitals / Lighthouse), erişilebilirlik, kurulum akışı kuralları.
- **Zorunlu uyumluluk webhook'ları** — `customers/data_request`, `customers/redact`, `shop/redact`. HMAC doğrulaması ve yanıt süresi şartları.
- **Protected customer data** — hangi seviyeye başvurulacağı, sipariş webhook'ları için ne gerektiği, veri saklama ve minimizasyon taahhütleri.
- **OAuth / token exchange / session token** akışının güncel hâli, embedded app + App Bridge gereksinimleri.
- **App proxy**, theme app extension ve checkout UI extension'ın güncel kuralları.
- **Webhook teslim garantileri**, yeniden deneme davranışı, `eventId` ile idempotency.

Okuduklarından, mevcut koddaki hangi varsayımların eskidiğini listele ve `docs/public-app/upstream-notes.md` dosyasına yaz. Bu liste sonraki kararlarının dayanağı olacak.

## Mevcut mimarinin yer gerçeği

Bunları yeniden keşfetmek zorunda değilsin; doğrula ve üstüne kur.

**Yığın:** Remix 2.15 · `@shopify/shopify-app-remix` 4.1.0 · Polaris 13.9.5 · App Bridge React 4.1.3 · Prisma 5.22 + PostgreSQL · BullMQ 5.30 + Redis · Node ≥20 · Shopify CLI 3.88.1 (repoda sabitli).

**Boyut:** 108 route, 96 `app/lib` modülü, 11 worker, 10 theme extension bloğu, 1 checkout UI extension, 24 adet `app.*` Polaris admin sayfası.

**Bugünkü çok kiracılılık — public app'te hepsi değişecek:**
- Her tenant için **ayrı bir Shopify app** (11 adet `shopify.app.<slug>.toml`, 11 farklı `client_id`).
- Her tenant için **ayrı container** (`us-<slug>` web, `usw-<slug>` worker), ayrı env dosyası.
- Her tenant için **ayrı Postgres şeması** (`DATABASE_URL?schema=<slug>`).
- Her tenant için **ayrı Redis DB index** (0–15 arası; 16 sınırı var, bu mimari 16 tenant'ta tıkanıyor).
- Hostname başına Caddy bloğu, DigitalOcean üzerinde iki droplet, Depot → GHCR → `docker compose` ile deploy.
- Oturum deposu: `app/shopify.server.ts` içinde `redisSessionStorage` — tek mağaza varsayımıyla.

**Bugünkü faturalama — tamamen değişecek:**
- `app/lib/billing.server.ts`: `COMMISSION_PERCENT = 0.04`, `COMMISSION_CAP_USD = 6`.
- Tahsilat Shopify üzerinden **değil**: merchant'ın kendi kartı Stripe'ta saklanıyor, `app/lib/billingRunner.server.ts` atomik claim + idempotency key ile çekim yapıyor. PayPal vault alternatifi de var.
- **Shopify Billing API hiç kullanılmıyor** — kodda tek bir `appSubscriptionCreate` yok.
- Komisyon hesabı: sipariş tutarının yüzdesi, sipariş başına 6 USD tavan. Tavan nedeniyle efektif oran %4 değil ~%3,14 çıkıyor; son 7 günde 43 sipariş tavana çarptı.

**Kritik eksik:** Zorunlu uyumluluk webhook'larının **hiçbiri yok**. `customers/data_request`, `customers/redact`, `shop/redact` ne toml'da ne de route olarak mevcut. Public app bu olmadan incelemeyi geçemez.

**Depolama:** Cloudflare R2, tek paylaşımlı bucket, mağaza başına prefix (`<domain_alt_cizgili>/prod/<uploadId>/<itemId>/<dosya>`). Bunny alternatif sağlayıcı olarak kodda duruyor.

**Ölçüm hattı:** Ghostscript + ImageMagick + poppler. `measure-preflight` ve `preview-render` worker'ları. Yön seçimi `app/lib/finishedSheetMeasurement.ts` içindeki `chooseFinishedSheetOrientation` ile yapılıyor (ruloya iki yönden de sığan sayfa, kısa kenarı faturalanacak şekilde çevriliyor). Bu mantığın bir kopyası tema uzantısı JS'inde de var — ikisi senkron kalmalı.

## Yapılacaklar

### 1. Dal ve izolasyon

`main`'den `public-app` dalını aç. İlk commit'te bir `PUBLIC-APP.md` yaz: bu dalın ne olduğu, main ile ilişkisinin tek yönlü olduğu, hangi altyapıya deploy edildiği. Public app'in Shopify config dosyası `shopify.app.auto-gang-sheet-upload.toml` adını alsın — mevcut 11 toml'dan ayırt edilsin.

CI/dal koruması ekle: public-app dalından main'e PR açılmasını engelleyen bir kontrol ya da en azından `PUBLIC-APP.md` içinde ve PR şablonunda bariz bir uyarı.

### 2. Tek app, çok mağaza

Mimariyi "tenant başına container" modelinden "tek dağıtım, mağaza başına kayıt" modeline taşı.

- **Oturum deposu:** tüm mağazaların oturumunu tutan tek bir kalıcı depo. Prisma tabanlı session storage tercih et; Redis'i önbellek olarak bırak. Mağaza sayısı 16 ile sınırlanmamalı.
- **Veri izolasyonu:** şema-başına-tenant yerine `shop_id` ile satır bazlı izolasyon. Her sorguda `shopId` zorunlu olsun. Repoda `STRICT_TENANT_GUARD` adında bir koruma var ama hiçbir env'de açık değil — public app'te bunu **varsayılan açık** yap ve ihlalde uyarı değil **hata** fırlat.
- **Kuyruklar:** tek Redis, mağaza başına ayrı DB index yerine iş verisinde `shopId`. Bir mağazanın ağır işinin diğerlerini aç bırakmaması için adil sıralama (fair scheduling) veya mağaza başına eşzamanlılık tavanı kur.
- **Kaynak sınırları:** bugün 4 GB bellek tavanı bir kez OOM'a ve 20 saatlik kesintiye yol açtı. Public app'te tek bir büyük dosyanın tüm mağazaları etkilememesi için iş başına bellek ve süre bütçesi uygula. `MEASURE_JOB_BUDGET_MS` ve `withHardTimeout` örüntüsü repoda mevcut, oradan devam et.
- **Onboarding:** kurulumdan sonra merchant'ın ürün seçmesi, rulo genişliğini ve fiyatlandırmayı ayarlaması için bir kurulum akışı. Bugün bu değerler elle `products_config` satırına yazılıyor; public app'te kendi kendine yetmeli.

### 3. Faturalama — %3,5 ve 6 USD tavan

Yeni oran: **sipariş tutarının %3,5'i, sipariş başına en fazla 6 USD.**

Shopify Billing API üzerinden kur. Doğrudan Stripe/PayPal ile merchant kartı çekme yolunu public app'te **kullanma** — App Store kuralları buna izin vermez.

Tasarımda şunları çöz ve kararlarını `docs/public-app/billing.md` içinde gerekçelendir:

- Kullanım bazlı abonelik (`appSubscriptionCreate` + usage pricing) kur, sipariş başına `appUsageRecordCreate` yaz. Her kayıt hangi siparişe ait olduğunu taşısın.
- **Aylık `cappedAmount`** seç. Düşük seçersen tavan dolunca faturalama durur ve gelir kaybedersin; yüksek seçersen merchant kurulumda ürker. Mağaza hacmine göre kademeli bir başlangıç değeri ve tavan dolmadan önce merchant'tan artış onayı isteyen bir akış kur.
- **Idempotency.** Bugünkü `billingRunner` atomik claim + idempotency key kullanıyor; 15 Eylül 2026'da bu koruma yokken dtfprinthouse 10 kat çekildi ve 9 iade yapıldı. Aynı hatayı tekrarlama: her usage record tam bir kez yazılmalı, webhook yeniden teslimleri ve worker yeniden denemeleri buna dahil.
- **İptal ve iade.** Sipariş iptal edilir veya iade alınırsa ne olacak? Shopify usage record'ları geri alınamaz; politikanı belirle ve kodla.
- **Deneme süresi ve ücretsiz kademe** olacak mı, karar ver.
- **Shopify'ın gelir payını** hesaba kat ve `billing.md` içinde net rakamla yaz — merchant'tan alınan %3,5'in ne kadarı bize kalıyor.
- Tavan hesabında **para birimi**: tüm mağazalar USD değil. 6 USD tavanı çoklu para biriminde nasıl uygulanacak, karar ver.

Mevcut `COMMISSION_PERCENT` / `COMMISSION_CAP_USD` sabitlerini tek bir yerden yönetilebilir hâle getir ve testlerini yaz. Tavanın efektif oranı nasıl düşürdüğünü gösteren bir test ekle.

### 4. App Store uyumluluğu

- **Üç zorunlu webhook'u sıfırdan yaz:** `customers/data_request`, `customers/redact`, `shop/redact`. HMAC doğrula, süre sınırında yanıt ver, gerçekten sil/dışa aktar — boş 200 dönme. `shop/redact` müşterinin tüm yüklemelerini ve R2 nesnelerini temizlemeli.
- **`app/uninstalled`** bugün soft-delete yapıyor; veri saklama politikanı yaz ve 48 saat içinde gerçek silmeyi planla.
- **Protected customer data** başvurusunu hazırla: hangi alanları neden okuduğumuzu gerekçelendir, veri minimizasyonu ve saklama sürelerini belgele. Sipariş webhook'ları bu onay olmadan çalışmaz — repoda bu yüzden düşen deploy'lar var.
- **Gizlilik politikası, kullanım şartları, destek kanalı, GDPR sayfası.** Repoda `app.legal.*` sayfaları var ama custom app'e göre yazılmış; public app için gözden geçir.
- **Performans ve erişilebilirlik:** admin arayüzü Polaris ile tutarlı, klavyeyle gezilebilir, Lighthouse eşiklerini geçen hâlde olsun. Theme extension'ın storefront'a eklediği yük ölçülsün — bugün tek üründe 78 kez geçen bir CSS ön eki ve birkaç yüz KB JS var.
- **Kurulum akışı:** izinsiz veri toplama yok, kurulumda gereksiz scope isteme yok. Bugünkü scope listesi custom app'e göre geniş; public app için minimuma indir ve her birini gerekçelendir.

### 5. Yayın

- Partner hesabı: **info@actualscope.com**. Chrome'da `actualscope` profili açık, oradan ilerle.
- App adı: **Auto Gang Sheet Upload**.
- Uygulama kaydını bu hesapta oluştur, mevcut Growth Sheriff organizasyonundaki hiçbir app'e dokunma.
- Listeleme metinleri, görseller, demo mağaza, inceleme notları — hepsini hazırla.
- Bir **demo/deneme mağazası** kur ve uçtan uca gerçek bir sipariş geçir: yükleme → ölçüm → sepet → checkout → webhook → usage record. Ekran görüntüleriyle belgele.

### 6. Doğrulama — "bitti" ne demek

Aşağıdakilerin hepsi kanıtlanmadan bitmiş sayma. Her maddenin kanıtını `docs/public-app/verification.md` içine komut çıktısı veya ekran görüntüsüyle yaz.

1. `public-app` dalı main'den tamamen ayrı; main'e tek commit gitmemiş (`git log origin/main..` ile göster).
2. Canlı 14 container ve iki droplet etkilenmemiş: deploy öncesi/sonrası `docker ps` uptime'ları değişmemiş.
3. Tek dağıtım, en az **üç farklı mağazaya** aynı anda hizmet veriyor; verileri birbirine sızmıyor (çapraz sorgu testi yaz).
4. Üç zorunlu webhook gerçek HMAC'li istekle test edilmiş, gerçekten veri siliyor/döndürüyor.
5. Billing: bir test mağazasında abonelik kurulmuş, sipariş geçilmiş, usage record oluşmuş, tutar **%3,5 ve 6 USD tavanıyla** birebir uyuşuyor. Aynı siparişin webhook'u iki kez gelirse **tek** usage record oluştuğu kanıtlanmış.
6. Tavan dolduğunda davranış test edilmiş.
7. `npx vitest run` tamamen yeşil; yeni iş kurallarının her biri için test var.
8. Typecheck, değiştirilen dosyalarda sıfır hata.
9. Theme extension ve checkout extension yeni app'e basılmış, storefront'ta render olduğu canlı sayfadan doğrulanmış.
10. Lighthouse/Web Vitals ölçümü alınmış ve eşikleri geçiyor.

## Çalışma biçimi

- İşe başlamadan `docs/public-app/plan.md` yaz: ne yapacağın, hangi sırayla, hangi kararı neden verdiğin. İlerledikçe güncelle.
- Her anlamlı adımda commit at, mesajlar **neden**'i anlatsın.
- Bir şeyi doğrulayamıyorsan uydurma — `docs/public-app/open-questions.md` içine yaz ve o varsayımla devam ettiğini belirt.
- Mevcut koddan öğrenebileceğini yeniden icat etme: ölçüm hattı, yön seçimi, cart identity, sipariş eşleştirme, komisyon uygunluk kapıları zaten çalışıyor ve çok sayıda canlı olaydan geçmiş. Public app'e uyarla, sıfırdan yazma.
- Bir yerde canlı sistemi riske atacak bir şey fark edersen dur, `docs/public-app/open-questions.md` içine yaz, o parçayı atla, geri kalanı tamamla.
