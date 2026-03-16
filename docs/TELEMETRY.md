# Telemetry Sistemi - Kullanım Kılavuzu

> **Version:** 1.0.0  
> **Son Güncelleme:** 16 Mart 2026  
> **Amaç:** Her tenant container'ından mağaza bilgileri, kullanım verileri ve komisyon verilerini merkezi billing paneline gönderme

---

## Mimari

```
┌─────────────────────┐     ┌─────────────────────┐
│  us-eagledtfprint    │     │  us-customprintaz    │
│  ┌─────────────────┐ │     │  ┌─────────────────┐ │
│  │telemetry.worker │─┼──┐  │  │telemetry.worker │─┼──┐
│  └─────────────────┘ │  │  │  └─────────────────┘ │  │
│  ┌─────────────────┐ │  │  │  ┌─────────────────┐ │  │
│  │ /api/internal/  │ │  │  │  │ /api/internal/  │ │  │
│  │  telemetry      │◄┼──┼──│  │  telemetry      │◄┼──┼──┐
│  └─────────────────┘ │  │  │  └─────────────────┘ │  │  │
└─────────────────────┘  │  └─────────────────────┘  │  │
    ... × 9 tenant       │                            │  │
                         ▼                            ▼  │
              ┌──────────────────────┐                   │
              │   Billing Panel      │                   │
              │   (POST alıcı)       │───────────────────┘
              │   (GET çeker)        │  ← PULL modu
              └──────────────────────┘
```

---

## 2 Erişim Modu

| Mod | Yön | Açıklama |
|-----|-----|----------|
| **PUSH** | Container → Panel | Worker her 60 saniyede bir POST yapar |
| **PULL** | Panel → Container | Panel istediği zaman GET çeker |

---

## 1. PUSH Modu (Worker)

Her container otomatik olarak 60 saniyede bir JSON gönderir.

### Gerekli ENV (her tenant .env dosyasına ekle)

```env
BILLING_PANEL_URL=https://panel.techifyboost.com/api/telemetry
BILLING_PANEL_KEY=gizli-api-anahtari-buraya
```

> **Not:** `BILLING_PANEL_URL` yoksa worker sadece console'a özet loglar, hata vermez.

### Gelen HTTP İsteği

```
POST https://panel.techifyboost.com/api/telemetry
Headers:
  Content-Type: application/json
  X-Tenant-Slug: eagledtfprint
  X-Api-Key: gizli-api-anahtari-buraya
Body: { ... TelemetryPayload JSON ... }
```

### Worker Davranışı

- İlk push: container başladıktan 10 saniye sonra
- Sonraki pushlar: her 60 saniyede bir
- 10 ardışık hata → 5 dakika bekleme (back-off)
- Graceful shutdown: SIGTERM/SIGINT → prisma disconnect → clean exit

---

## 2. PULL Modu (API Endpoint)

Panel her container'a doğrudan istek atabilir.

### Gerekli ENV

```env
INTERNAL_SECRET=gizli-internal-token
# veya CRON_SECRET (zaten mevcut olabilir)
```

### Tek Container İsteği

```bash
curl -s http://127.0.0.1:4006/api/internal/telemetry \
  -H "x-internal-secret: gizli-internal-token" | jq .
```

### Tüm Container'lardan Toplu Çekme

```bash
for port in 4002 4003 4004 4005 4006 4007 4008 4009 4010; do
  echo "=== Port $port ==="
  curl -s http://127.0.0.1:$port/api/internal/telemetry \
    -H "x-internal-secret: TOKEN" | jq '.tenant.slug, .usage.uploads.total'
done
```

---

## JSON Payload Yapısı

```jsonc
{
  "tenant": {
    "slug": "eagledtfprint",           // Container kimliği (TENANT_SLUG env)
    "shopDomain": "eagle-dtf-print.myshopify.com",
    "plan": "free",                     // free | starter | pro | enterprise
    "billingStatus": "active",
    "storageProvider": "bunny",         // bunny | local | r2
    "installedAt": "2024-06-15T...",
    "paymentMethod": "paypal",          // paypal | stripe | both | none
    "autoCharge": true,
    "paypalEmail": "merchant@...",
    "stripeEmail": null,
    "stripeCustomerId": null,
    "onboardingCompleted": true,
    "onboardingStep": 5,
    "appUrl": "https://eagledtfprint.uploadstudio.app.techifyboost.com"
  },
  "usage": {
    "periodStart": "2026-03-01T00:00:00Z",  // Ayın ilk günü
    "periodEnd": "2026-03-16T12:00:00Z",    // Şu an
    "uploads": {
      "total": 1523,                    // Tüm zamanlar toplam upload
      "thisMonth": 187,                 // Bu ay
      "byStatus": {                     // Status dağılımı
        "draft": 5,
        "uploaded": 12,
        "processing": 2,
        "approved": 1200,
        "printed": 300,
        "rejected": 4
      },
      "byMode": {                       // Upload modu dağılımı
        "dtf": 1400,
        "quick": 100,
        "builder": 23
      }
    },
    "storage": {
      "totalBytes": 5368709120,         // Toplam dosya boyutu (5 GB)
      "totalFiles": 3200,              // Toplam dosya sayısı
      "averageFileSizeBytes": 1677722   // Ortalama dosya boyutu (~1.6 MB)
    },
    "orders": {
      "total": 890,                     // Toplam sipariş
      "thisMonth": 45,                  // Bu ay sipariş
      "totalRevenue": 42500.00,         // Toplam gelir
      "thisMonthRevenue": 3200.00,      // Bu ay gelir
      "currency": "USD"
    },
    "exports": {
      "total": 156,
      "byStatus": { "completed": 140, "failed": 6, "pending": 10 }
    },
    "visitors": {
      "unique": 2340,                   // Tekil ziyaretçi
      "thisMonth": 380,                 // Bu ay yeni ziyaretçi
      "totalSessions": 8920,            // Toplam oturum
      "thisMonthSessions": 1200         // Bu ay oturum
    },
    "apiCalls": {
      "totalKeys": 2,                   // Aktif API key sayısı
      "totalUsage": 15600               // Toplam API çağrısı
    },
    "flowTriggers": {
      "total": 3400,
      "thisMonth": 200,
      "byStatus": { "sent": 3300, "failed": 50, "pending": 50 }
    },
    "supportTickets": {
      "total": 12,
      "open": 2                         // Açık + in_progress
    }
  },
  "commissions": {
    "pending":   { "count": 15, "total": 63.75 },   // Bekleyen komisyon
    "paid":      { "count": 70, "total": 297.50 },   // Ödenmiş komisyon
    "waived":    { "count": 3,  "total": 12.00 },    // Muaf komisyon
    "thisMonth": { "count": 8,  "total": 34.00 },    // Bu ay komisyon
    "commissionRate": 0.015                           // %1.5
  },
  "config": {
    "productsConfigured": 5,            // Konfigüre edilmiş ürün sayısı
    "uploadEnabled": 5,                 // Upload açık ürün sayısı
    "tshirtEnabled": 2,                 // T-Shirt addon açık
    "builderEnabled": 1,                // Builder modal açık
    "assetSets": 3,                     // Aktif 3D model seti
    "teamMembers": {
      "total": 3,
      "byRole": { "owner": 1, "admin": 1, "viewer": 1 }
    },
    "whiteLabel": false,                // White label aktif mi
    "apiKeysActive": 2                  // Aktif API key sayısı
  },
  "health": {
    "containerUptime": 86400,           // Saniye cinsinden (24 saat)
    "nodeVersion": "v20.18.0",
    "memoryUsage": {
      "rss": 167772160,                 // 160 MB - Resident Set Size
      "heapUsed": 89128960,            // 85 MB - Kullanılan heap
      "heapTotal": 134217728            // 128 MB - Toplam heap
    },
    "lastUploadAt": "2026-03-16T11:45:00Z",   // Son upload zamanı
    "lastOrderAt": "2026-03-16T10:30:00Z",     // Son sipariş zamanı
    "lastExportAt": "2026-03-15T22:00:00Z"     // Son export zamanı
  },
  "timestamp": "2026-03-16T12:00:00Z"          // Snapshot zamanı
}
```

---

## Dosya Yapısı

| Dosya | Satır | Rol |
|-------|-------|-----|
| `app/lib/telemetry.server.ts` | ~450 | Veri toplama motoru - 21 paralel DB sorgusu |
| `app/routes/api.internal.telemetry.tsx` | ~40 | On-demand PULL endpoint (GET) |
| `workers/telemetry.worker.ts` | ~140 | 60s interval PUSH worker |
| `docker-entrypoint.sh` | ~70 | 5. worker olarak eklendi |

---

## Toplanan Veri Kaynakları (DB Sorguları)

| # | Veri | Tablo | Sorgu Tipi |
|---|------|-------|-----------|
| 1 | Mağaza bilgileri | `shops` | `findFirst` |
| 2 | Toplam upload | `uploads` | `count` |
| 3 | Bu ay upload | `uploads` | `count (gte monthStart)` |
| 4 | Upload by status | `uploads` | `groupBy status` |
| 5 | Upload by mode | `uploads` | `groupBy mode` |
| 6 | Storage boyut | `upload_items` | `aggregate sum(fileSize)` |
| 7 | Dosya sayısı | `upload_items` | `count` |
| 8 | Toplam sipariş | `orders_link` | `count` |
| 9 | Bu ay sipariş | `orders_link` | `count (gte monthStart)` |
| 10 | Toplam gelir | `uploads` | `aggregate sum(orderTotal)` |
| 11 | Bu ay gelir | `uploads` | `aggregate sum(orderTotal) gte monthStart` |
| 12 | Export durumu | `export_jobs` | `groupBy status` |
| 13 | Tekil ziyaretçi | `visitors` | `count` |
| 14 | Bu ay ziyaretçi | `visitors` | `count (gte monthStart)` |
| 15 | Toplam oturum | `visitor_sessions` | `count` |
| 16 | Bu ay oturum | `visitor_sessions` | `count (gte monthStart)` |
| 17 | API kullanım | `api_keys` | `aggregate count + sum(usageCount)` |
| 18 | Flow triggers | `flow_triggers` | `count + groupBy status` |
| 19 | Destek talepleri | `support_tickets` | `count` |
| 20 | Komisyon detay | `commissions` | `aggregate (pending/paid/waived/thisMonth)` |
| 21 | Config özet | `products_config` + `asset_sets` + `team_members` + `white_label_config` | Çoklu count |

> Tüm sorgular `Promise.all` ile paralel çalışır — tipik süre < 200ms.

---

## Konfigürasyon

### Henüz Panel Hazır Değilse

`BILLING_PANEL_URL` eklemeden deploy et. Worker sadece console'a loglar:

```
[Telemetry:eagledtfprint] Collected: uploads=1523, orders=890, storage=5.0 GB, commission_pending=$63.75
```

### Panel Hazır Olduğunda

Tüm tenant env dosyalarına 2 satır ekle:

```bash
# Sunucuda toplu ekleme
for env in /opt/apps/custom/customizerapp/upload-studio/envs/.env.*; do
  echo "" >> "$env"
  echo "BILLING_PANEL_URL=https://panel.techifyboost.com/api/telemetry" >> "$env"
  echo "BILLING_PANEL_KEY=senin-gizli-anahtarin" >> "$env"
done

# Container'ları restart et
cd /opt/apps/custom/customizerapp/upload-studio
docker compose restart
```

### PULL Endpoint İçin

```bash
# INTERNAL_SECRET veya CRON_SECRET env'i gerekli
for env in /opt/apps/custom/customizerapp/upload-studio/envs/.env.*; do
  echo "INTERNAL_SECRET=senin-internal-tokenin" >> "$env"
done
```

---

## Panel Tarafı (Alıcı) Gereksinimleri

Panel'in implement etmesi gereken endpoint:

```
POST /api/telemetry
Headers:
  Content-Type: application/json
  X-Tenant-Slug: {tenant_slug}
  X-Api-Key: {billing_panel_key}
Body: TelemetryPayload (yukarıdaki JSON yapısı)
Response: 200 OK
```

Bu veriyle panel şunları yapabilir:

- **Tenant Dashboard:** Her mağazanın detaylı kullanım görünümü
- **Fatura Hesaplama:** Upload sayısı, storage, sipariş bazlı aylık fatura
- **Komisyon Takibi:** Pending/paid komisyon, otocharge durumu
- **Sağlık Monitörü:** Uptime, memory, son aktivite zamanları
- **Plan Karşılaştırma:** Hangi plan ne kadar kullanılıyor
- **Uyarı Sistemi:** lastUploadAt > 24h → alarm

---

## Güvenlik

| Katman | Koruma |
|--------|--------|
| PUSH modu | `X-Api-Key` header ile auth |
| PULL modu | `x-internal-secret` header ile auth |
| Network | Container'lar sadece `127.0.0.1` üzerinden erişilebilir |
| Payload | Hassas veri yok (access token, API key GÖNDERİLMEZ) |

---

## Troubleshooting

### Worker loglarını kontrol et

```bash
docker logs us-eagledtfprint 2>&1 | grep Telemetry
```

### Endpoint'i test et

```bash
curl -s http://127.0.0.1:4006/api/internal/telemetry \
  -H "x-internal-secret: TOKEN" | jq '.tenant.slug'
```

### Worker çalışmıyor

```bash
# Container içinde process kontrol
docker exec us-eagledtfprint ps aux | grep telemetry
```

### DB bağlantı hatası

Worker kendi PrismaClient instance'ını oluşturur. `DATABASE_URL` env doğru olmalı.
