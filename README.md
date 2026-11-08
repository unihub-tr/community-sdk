<div align="center">
  <h1>🚀 UniHub Community SDK</h1>
  <p>Official JavaScript / TypeScript SDK for UniHub community websites.</p>
</div>

> **English summary.** `unihub-community-sdk` connects a university club's own website to
> UniHub: list the club's public events, let visitors sign in with UniHub (on UniHub's page,
> popup or redirect), and join, leave, apply to and get tickets for events. It runs in the
> browser, has no runtime dependencies, and ships ESM, CommonJS and a `<script>` build.
> The guide below is in Turkish; the code samples read the same in any language.

## 📌 Nedir Bu Paket?
Bu kütüphane, üniversite topluluklarının (Google Developer Groups, IEEE vb.) kendi geliştirdikleri bağımsız web sitelerini **UniHub**'a bağlar: kulübün herkese açık etkinliklerini listeler, ziyaretçinin "UniHub ile giriş" yapmasını sağlar ve etkinliğe katılım, ayrılma, başvuru formu ve bilet işlemlerini yapar.

## 📖 Geliştirici Kılavuzu
Bu README, SDK'nın kılavuzudur. Güncel sürümü her zaman npm sayfasındadır:

👉 **[unihub-community-sdk — npm](https://www.npmjs.com/package/unihub-community-sdk)**

Sürüm notları paketteki `CHANGELOG.md` dosyasındadır. Anahtar alma, barındırma ve koşullar için
UniHub'ın geliştirici sayfası: **[unihub.tr/gelistiriciler](https://www.unihub.tr/gelistiriciler)**.

## 🛠️ Kurulum

NPM kullanan projeler için:

```bash
npm install unihub-community-sdk
```

Derleme adımı olmayan sayfalar için (`<script>` etiketi, `window.UniHub`):

```html
<script
  src="https://cdn.jsdelivr.net/npm/unihub-community-sdk@0.1.4/dist/index.global.js"
  integrity="sha384-45g68YBfqzPT0Ua8NhzkZH1CN1/TunN4MV2yPMwGZI7Co5bkLbSjJgDHasMldT7q"
  crossorigin="anonymous"></script>
<script>
  const unihub = UniHub.createUniHub({ key: "uhpk_live_sizin_topluluk_anahtariniz" });
  unihub.events.list({ when: "upcoming" }).then((page) => console.log(page.items));
</script>
```

- Adresteki sürümü (`@0.1.4`) **sabit** tutun; `@latest` ya da `@0` kullanmayın. `integrity`
  değeri yalnızca o sürümün dosyasına uyar: dosya değişirse tarayıcı betiği çalıştırmaz.
- Sürüm yükseltirken adresi ve `integrity` değerini birlikte, bu README'nin o sürümdeki
  hâlinden alın.

## 🧩 Hazır site şablonu

> **Geliştiriciniz yok mu?** Kendi alan adınız ve tasarımınızla sitenizi UniHub barındırsın:
> [unihubtrdeu@gmail.com](mailto:unihubtrdeu@gmail.com).

Kod yazmadan başlamak için: **tek bir `index.html`**, derleme adımı ve sunucu kodu yok. Kulübünüzün
etkinliklerini listeler, ayrıntılarını gösterir, "UniHub ile giriş" yaptırır; ziyaretçi katılır,
başvuru formunu doldurur ve biletini (QR) görür. Arayüz Türkçedir.

👉 **[Şablonu indirin](https://cdn.jsdelivr.net/npm/unihub-community-sdk@0.1.4/starter/index.html)**
(sayfayı "Farklı kaydet" ile `index.html` olarak kaydedin; pakette `starter/index.html`).

1. **Ayarlayın.** Dosyanın başındaki `CONFIG.key` alanına yayınlanabilir anahtarınızı
   (`uhpk_live_…`), `CONFIG.clubName` alanına kulübünüzün adını yazın. Renkler, köşe yuvarlaklığı
   ve logo `<style>` başındaki `--club-*` değişkenleridir. Ana anahtarı (master key) asla yazmayın.
2. **Yerelde deneyin, çift tıklayarak değil.** Dosyadan açılan sayfanın (`file://`) adresi yoktur
   ve UniHub onu reddeder. Klasörü 5173 portunda sunun: `npx serve -l 5173` ya da
   `python -m http.server 5173`, sonra `http://localhost:5173`. Anahtarlar yerel test için
   `http://localhost:5173` ile birlikte verilir.
3. **Yayınlayın.** Her statik barındırma çalışır:
   - **Netlify / Vercel:** klasörü yükleyin. Önizleme (preview) adreslerini değil, asıl
     (production) adresi kullanın.
   - **Kendi alan adınız:** `https://kulubunuz.org` ile `https://www.kulubunuz.org` iki ayrı adrestir.
   - **GitHub Pages yalnızca özel alan adıyla ya da kulübün kurum (organization) hesabıyla**
     (`https://<kulup-org>.github.io`). Kişisel `https://<kullanici>.github.io` adresi o kişinin
     bütün depolarınca paylaşılır.
4. **Adresinizi bize gönderin.** Sitenin tam adresini (şema + alan adı, yol olmadan; ör.
   `https://kulubunuz.org`) ve kulübünüzün adını **[unihubtrdeu@gmail.com](mailto:unihubtrdeu@gmail.com)**
   adresine yazın. Adres anahtarınıza eklenince giriş orada da çalışır.

Şablon iki betik yükler, ikisi de sabit sürüm ve `integrity` ile: bu SDK ve QR çizimi için
[`qrcode-generator`](https://www.npmjs.com/package/qrcode-generator). Sunucudan gelen metni yalnızca
metin olarak yazar; bilet içeriğini loglamaz, saklamaz, yalnızca bilet penceresi açıkken tutar.
Oturum sekme kapanana kadar `sessionStorage`'da kalır. SDK'yı yükseltirken iki betik etiketinden
SDK olanı, yeni sürümün README'sindeki etiketle değiştirin.

## 🚀 Hızlı Başlangıç
```javascript
import { createUniHub, UniHubError } from 'unihub-community-sdk';

// 1. Topluluk anahtarınızla kurun. Yayınlanabilir anahtar (uhpk_…) UniHub yöneticileri
//    tarafından verilir ve sitenizin adreslerine (origin) bağlıdır; sayfada durması güvenlidir.
//    Ana anahtarı (master key) asla bir web sayfasına koymayın — SDK onu reddeder.
//    Varsayılan sunucu: https://api.unihub.tr/api/v1/community
const unihub = createUniHub({
  key: "uhpk_live_sizin_topluluk_anahtariniz",
  locale: "tr" // hata mesajlarının dili: "tr" (varsayılan) veya "en"
});

// 2. Kulübünüzün herkese açık etkinliklerini listeleyin (sayfa 0'dan başlar, en fazla 50)
const page = await unihub.events.list({ when: "upcoming", page: 0, size: 20 });
for (const e of page.items) {
  console.log(e.title, e.startsAt, e.location); // startsAt: "2026-11-01T19:00:00+03:00" veya null
}

// 3. Tek bir etkinliğin ayrıntıları
const detail = await unihub.events.get(page.items[0].id);
// detail.membersOnly: yalnızca kulübün onaylı üyeleri KATILABİLİR (etkinliği herkes görür)
// detail.requiresForm, detail.verifiedOnly, detail.approvalRequired
```

Özel (private) etkinlikler ve özel kulüplerin etkinlikleri listelenmez; `get` onlar için
`EVENT_NOT_FOUND` döner. SDK, bir sayfadaki istekleri sırayla ve aralarında en az 210 ms
bırakarak gönderir: sunucu aynı anahtar ve ziyaretçiden 200 ms içinde gelen ikinci isteği
reddediyor. Aynı anda birkaç çağrı yapmak (`Promise.all`) güvenlidir.

## 🗝️ Anahtar ve izinli adresler (origin)

- **Anahtarı UniHub yöneticileri verir.** Her kulüp sitesi bir yayınlanabilir anahtar
  (`uhpk_live_…`) alır. Anahtar kulübünüze ve sitenizin adreslerine bağlıdır; sayfada
  durması güvenlidir. Anahtarla birlikte verilen **ana anahtarı** (master key) hiçbir web
  sayfasına, depoya veya sohbete koymayın: SDK onu zaten reddeder.
- **İzinli adresler** tam olarak `şema://alan[:port]` biçimindedir ve her biri ayrıca
  yazılır: `https://kulubunuz.org` ile `https://www.kulubunuz.org` iki ayrı adrestir.
  Anahtarlar yerel test için `http://localhost:5173` ile birlikte verilir; başka bir yerel
  adres gerekirse isteyin.
- **Anahtar istemek ya da adres ekletmek için:** kulübünüzün adı ve sitenizin tam adresleriyle
  [unihubtrdeu@gmail.com](mailto:unihubtrdeu@gmail.com) adresine yazın. Adımlar
  [geliştirici sayfasında](https://www.unihub.tr/gelistiriciler) anlatılır.
- Listede olmayan bir adresten gelen istek `ORIGIN_NOT_ALLOWED` ile reddedilir. Adres
  listesi boş olan bir anahtar hiçbir tarayıcıdan çalışmaz.
- Sunucu tarafında (SSR) yapılan okumalar `Origin` başlığı göndermediği için kabul edilir;
  **giriş ise yalnızca izinli bir adresteki sayfadan** yapılabilir.
- Sunucu, aynı anahtar ve ziyaretçiden 200 ms içinde gelen ikinci isteği reddeder; SDK
  istekleri bu yüzden sıraya koyar (bkz. Hızlı Başlangıç).

## 🔑 UniHub ile giriş

Ziyaretçi, UniHub'ın kendi sayfasında (`https://www.unihub.tr/connect`) giriş yapar ya da
kayıt olur; siteniz şifreyi veya e-postayı hiç görmez. Siteniz yalnızca şunu öğrenir:
`userId`, `displayName`, `avatarUrl`, `emailVerified`.

```javascript
const unihub = createUniHub({ key: "uhpk_live_sizin_topluluk_anahtariniz" });

// Sayfa her açıldığında bir kez (redirect ile dönüldüyse girişi tamamlar, yoksa null)
await unihub.auth.handleRedirect();

// Ekrandaki "UniHub ile giriş" düğmesi — signIn() bir tıklamanın içinde çağrılmalı,
// yoksa tarayıcı açılır pencereyi engeller (POPUP_BLOCKED).
button.onclick = async () => {
  try {
    const visitor = await unihub.auth.signIn();          // popup (varsayılan)
    console.log(visitor.displayName);
  } catch (err) {
    if (err.code === "POPUP_BLOCKED") unihub.auth.signIn({ mode: "redirect" }); // sayfadan çıkar, geri döner
    else if (err.code !== "SIGN_IN_CANCELLED") showMessage(err.message);      // pencereyi kapattıysa sessiz geçin
  }
};

unihub.auth.onChange((visitor) => render(visitor)); // giriş, çıkış, süre dolması; visitor ya da null
unihub.auth.current();                              // şu anki ziyaretçi ya da null
await unihub.auth.register();                       // aynı sayfa, "Kayıt Ol" sekmesi orada
await unihub.auth.signOut();

// Giriş yapmış ziyaretçiyi etkinliğe katın
try {
  const { status } = await unihub.attendance.join(eventId); // "JOINED" | "PENDING_APPROVAL" | "ALREADY_JOINED"
} catch (err) {
  // "NOT_SIGNED_IN" (giriş yok ya da oturum bitti), "EMAIL_NOT_VERIFIED", "VERIFIED_MEMBERS_ONLY",
  // "MEMBERS_ONLY", "EVENT_CLOSED", "FORM_REQUIRED", "EVENT_NOT_FOUND"
}
```

- **Oturum 1 saat sürer** ve sessizce yenilenmez. Süre dolunca `onChange(null)` çağrılır ve
  `join` `NOT_SIGNED_IN` döner; ziyaretçi UniHub'da hâlâ girişliyse tek tıkla yeniden girer.
- **Oturum nerede tutulur:** varsayılan `session: "memory"` — sayfa yenilenince biter.
  `createUniHub({ key, session: "sessionStorage" })` (sekme açık kaldıkça) ya da
  `"localStorage"` (sekmeler arası, 1 saate kadar) yenilemeden sonra da korur. Bilerek seçin:
  sayfanızdaki **her** betik tarayıcı deposunu okuyabilir.
- **Redirect:** `signIn({ mode: "redirect", returnUrl })` sayfadan ayrılır; dönüşte
  `handleRedirect()` adres çubuğundaki `unihub_code` / `state` parametrelerini hemen siler ve
  girişi tamamlar. `returnUrl` sitenizle aynı origin'de olmalıdır (varsayılan: bulunduğunuz sayfa).
- Anahtarın izinli origin'leri arasında sitenizin adresi olmalıdır (yerel geliştirme için
  ör. `http://localhost:5173`). Giriş, Web Crypto ister: `https` ya da `http://localhost`.
- Oturum belirteci (`uhct_…`) dışarı verilmez ve hiçbir URL'ye yazılmaz.
- Örnek sayfa: `npm run build && node examples/serve.mjs` → `http://localhost:5173/?key=uhpk_…`

## 🎟️ Katılım: durum, ayrılma, bilet, başvuru formu

Hepsi giriş yapmış ziyaretçinin oturumuyla çalışır; oturum yoksa istek gönderilmeden
`NOT_SIGNED_IN` döner, oturum sunucuda bittiyse temizlenir ve `onChange(null)` çağrılır.

```javascript
const { status } = await unihub.attendance.status(eventId); // "NOT_JOINED" | "PENDING_APPROVAL" | "JOINED"
await unihub.attendance.leave(eventId);                     // katılmıyorsa da sorunsuz biter

// Başvuru formu olan etkinlikler (join → FORM_REQUIRED)
const form = await unihub.attendance.form(eventId);         // { questions: [...], appRequired }
if (form.appRequired) {
  // Form belge istiyor: başvuru yalnızca UniHub uygulamasından yapılabilir (apply → APP_REQUIRED).
} else {
  const answers = form.questions.map((q) => ({ questionId: q.id, answer: valueOf(q) })); // en çok 1024 karakter
  const { status } = await unihub.attendance.apply(eventId, answers); // "JOINED" | "PENDING_APPROVAL"
  // Zaten katılmışsa ALREADY_JOINED ile reddedilir (cevaplar kaydedilmez).
}
```

- Soru tipleri: `TEXT`, `BOOLEAN` (cevap `"true"` ya da `"false"`, `options` içinde), `PHONE`,
  `EMAIL`, `DOCUMENT`. `required` bugün hep `false`: sunucu boş cevabı da kabul eder.

### Bilet (QR)

`ticket()` yalnızca onaylı katılım için `{ qrPayload }` döner (yoksa `TICKET_UNAVAILABLE`).
`qrPayload`, UniHub uygulamasının gösterdiği QR'ın içeriğidir: girişte bir kez okutulur,
etkinlikten 1 saat önce ile 24 saat sonrası arasında geçerlidir. SDK bunu çizmez; istediğiniz
QR kütüphanesiyle çizin, örneğin [`qrcode`](https://www.npmjs.com/package/qrcode):

```javascript
import QRCode from "qrcode";

const { qrPayload } = await unihub.attendance.ticket(eventId);
await QRCode.toCanvas(document.querySelector("#ticket"), qrPayload, { errorCorrectionLevel: "M" });
```

Derleme adımı olmayan bir sayfada `qrcode` yüklenemez (tarayıcı sürümü yok); orada
[`qrcode-generator`](https://www.npmjs.com/package/qrcode-generator) kullanın (hazır site şablonu
onu kullanır: `qrcode(0, "M")`, `addData(qrPayload)`, `make()`, `createDataURL()`).

- **`qrPayload`'ı loglamayın, saklamayın, başka bir yere göndermeyin**; yalnızca ekranda
  gösterildiği sürece tutun. SDK da onu hiçbir yere yazmaz ve önbelleğe almaz: her çağrı
  sunucudan yeniden ister (`cache: "no-store"`).

## 🛡️ KVKK ve geliştirici koşulları

- **Anahtar verilmeden önce** kulübünüzün sahibi (OWNER) ya da yöneticisi (MANAGER),
  UniHub'ın sürümlü **geliştirici koşullarını** kabul eder ve sitenizin **gizlilik
  politikası adresini** verir. Koşulların metni anahtarla birlikte size iletilir; koşullar
  güncellendiğinde yeni sürümün yeniden kabul edilmesi gerekebilir. Ayrıntılar
  [geliştirici sayfasındadır](https://www.unihub.tr/gelistiriciler).
- **Siteniz UniHub'da barındırılıyorsa** sitenizdeki ziyaretçi verilerinin **veri sorumlusu
  kulübünüzdür**; UniHub barındırma hizmeti sağlayıcısı olarak **veri işleyen** konumundadır.
- **Ziyaretçinin girişi, kaydı ve açık rızası UniHub'ın sayfasında** olur
  (`https://www.unihub.tr/connect`). Bu sayfa kulübünüzün adını ve verdiğiniz gizlilik
  politikası adresini gösterir. Siteniz şifreyi, e-postayı, telefonu veya öğrenci
  numarasını hiç görmez.
- Sitenize yalnızca şu bilgiler gelir: `userId`, `displayName`, `avatarUrl`,
  `emailVerified`. Bunları kendi gizlilik politikanızda anlattığınız amaçla kullanın.
- **Bilet içeriğini (`qrPayload`) saklamayın, loglamayın, başka bir yere göndermeyin.**
  Oturum varsayılan olarak bellekte tutulur; tarayıcı deposunu (`sessionStorage`,
  `localStorage`) bilerek seçin.

## ⚠️ Hatalar

Her hata bir `UniHubError`'dır: `code` (kararlı, programın dallanacağı alan), `status`
(HTTP durumu; yanıt gelmediyse ya da SDK isteği hiç göndermediyse `0`), `message` (seçilen
dilde, ziyaretçiye gösterilebilir) ve `details.backendMessage` (sunucunun ham metni).
`message` metnine göre değil, `code` alanına göre karar verin. Eski `UniHubApiError` adı
aynı sınıfı gösterir.

| `code` | Ne zaman | Siteniz ne yapmalı |
|:---|:---|:---|
| `INVALID_ARGUMENT` | geçersiz parametre (`id`, `when`, `page`, `size`, form cevapları, `baseUrl`, yabancı `returnUrl`; tarayıcı dışında giriş). Çoğu istek gönderilmeden | kodunuzu düzeltin |
| `KEY_INVALID` | anahtar yanlış, devre dışı ya da koşulları kabul edilmemiş | anahtarı kontrol edin; UniHub yöneticilerine başvurun |
| `ORIGIN_NOT_ALLOWED` | sayfanın adresi anahtarın izinli adreslerinde yok | adresi ekletin (bkz. Anahtar ve izinli adresler) |
| `RATE_LIMITED` | çok sık istek | biraz bekleyip yeniden deneyin |
| `NETWORK` | sunucuya ulaşılamadı | bağlantı mesajı gösterin, sonra yeniden deneyin |
| `NOT_SIGNED_IN` | giriş yok ya da oturum bitti (SDK oturumu temizler, `onChange(null)`) | "UniHub ile giriş" düğmesini gösterin |
| `NOT_REGISTERED` | hesabın UniHub profili yok | `auth.register()` ile kayda yönlendirin |
| `SIGN_IN_CANCELLED` | ziyaretçi giriş penceresini kapattı ya da vazgeçti | sessiz geçin |
| `POPUP_BLOCKED` | tarayıcı giriş penceresini engelledi | `signIn({ mode: "redirect" })` |
| `EVENT_NOT_FOUND` | etkinlik yok, özel ya da başka bir kulübün | listeyi yenileyin |
| `EMAIL_NOT_VERIFIED` | katılım e-posta doğrulaması istiyor | ziyaretçiden e-postasını doğrulamasını isteyin |
| `VERIFIED_MEMBERS_ONLY` | kulüp yalnızca e-postası doğrulanmış üyeleri kabul ediyor | `message` metnini gösterin |
| `MEMBERS_ONLY` | etkinlik yalnızca kulübün onaylı üyeleri için | üyelik için UniHub uygulamasına yönlendirin |
| `EVENT_CLOSED` | son katılım tarihi geçti | katılım düğmesini kapatın |
| `EVENT_FULL` | kontenjan dolu (bugün sunucu göndermiyor; ileride gelebilir) | katılım düğmesini kapatın |
| `FORM_REQUIRED` | `join`: etkinliğin başvuru formu var | `attendance.form()` + `apply()` |
| `ALREADY_JOINED` | `apply`: ziyaretçi zaten katılmış (cevaplar kaydedilmedi) | durumu `status()` ile gösterin |
| `APP_REQUIRED` | `apply`: form belge istiyor | başvuruyu UniHub uygulamasından yapmasını söyleyin |
| `TICKET_UNAVAILABLE` | `ticket`: katılım yok ya da onay bekliyor | bileti onaydan sonra gösterin |
| `UNKNOWN` | beklenmeyen bir yanıt | `message` metnini gösterin; `details` ile bize bildirin |

`join` için `ALREADY_JOINED` bir hata değil, sonuçtur: `{ status: "ALREADY_JOINED" }`.

## 🔍 Kaynak kod ve doğrulama

Kaynak kod herkese açıktır: **[github.com/unihub-tr/community-sdk](https://github.com/unihub-tr/community-sdk)**.
Sorunları oradaki *Issues* bölümüne yazabilirsiniz. Depo bir sürüm aynasıdır: pull request'leri
okuyup değişikliği kaynakta yaparız, doğrudan birleştirmeyiz. İletişim: `unihubtrdeu@gmail.com`.

`0.1.3` ve sonraki her sürüm GitHub Actions'ta derlenip npm'e **provenance** ile yayımlanır:
npm sayfasındaki "Provenance" bölümü, paketin hangi açık commit'ten derlendiğini gösterir.
Kendi projenizde doğrulamak için:

```bash
npm audit signatures
```

Çıktıda `unihub-community-sdk` "verified attestations" arasında görünür. `0.1.2` ve öncesi
provenance olmadan yayımlandı.

## 🔢 Sürümler

SDK [Semantic Versioning](https://semver.org/) izler. Sürüm `0.x` iken bir ara sürüm
(`0.2.0`) uyumu bozan değişiklik içerebilir; her biri `CHANGELOG.md` dosyasında yazılıdır.
SDK, sürümünü her istekte `X-SDK-Version` başlığıyla gönderir.

<div align="center">
  <i>Developed and Secured by the UniHub Core Team.</i>
</div>
