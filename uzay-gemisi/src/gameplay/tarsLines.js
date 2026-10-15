/**
 * TARS'ın repliği havuzları. Hepsi özgün Türkçe metinlerdir (filmden alıntı yoktur).
 *
 * Mizah bantları: 'zero' (≤10) · 'low' (≤40) · 'mid' (≤70) · 'high' (≤90) · 'max'
 * Dürüstlük bantları: 'low' (≤40) · 'mid' (≤80) · 'high'
 */

export function humorBand(h) {
  if (h <= 10) return 'zero';
  if (h <= 40) return 'low';
  if (h <= 70) return 'mid';
  if (h <= 90) return 'high';
  return 'max';
}

export function honestyBand(h) {
  if (h <= 40) return 'low';
  if (h <= 80) return 'mid';
  return 'high';
}

export function pick(arr, avoid) {
  if (!arr || !arr.length) return '';
  if (arr.length === 1) return arr[0];
  let s;
  for (let i = 0; i < 4; i++) {
    s = arr[Math.floor(Math.random() * arr.length)];
    if (s !== avoid) break;
  }
  return s;
}

/** Giriş sinematiğinde TARS'ın ilk sözü */
export const INTRO_LINE =
  'Hoş geldin. İki yıl, dört ay ve on bir gün uyudun. Ben TARS. Kendine gelince yanıma gel, konuşacaklarımız var.';

/** İlk konuşma: enerji görevini verir */
export const FIRST_TALK =
  'Önce kötü haber: ana enerji kesik, gemi acil durum bataryalarıyla nefes alıyor. İyi haber: sigortayı sıfırlamak için bir insana ihtiyacımız var ve tesadüfe bak, sen bir insansın. ' +
  'Motor modülüne gitmemiz gerek. Kumanda tarafı enerji gelene dek kilitli, o yüzden Yaşam Alanı yönünden dolaşacağız. Ben arkandayım.';

export const GREETINGS = {
  zero: ['Dinliyorum.', 'Buyur.', 'Hazırım.'],
  low: ['Evet?', 'Seni dinliyorum.', 'Buradayım. Ne lazım?'],
  mid: [
    'Buradayım. Gidecek pek yerim yok zaten.',
    'TARS hizmetinizde. Bahşiş kabul etmiyorum; sadece pil.',
    'Dinliyorum. Dört bloğum da kulak kesildi.',
  ],
  high: [
    'Söyle bakalım. Bugün kendimi oldukça dikdörtgen hissediyorum.',
    'Konuşalım. Bu gemide sohbet edebildiğim tek kişi sensin; diğerleri derin uykuda ve pek dinlemiyorlar.',
    'Ah, sen. Tam da gemideki bütün vidaları saymayı bitirmiştim. Üç bin dört yüz on iki. Bir tanesi şüpheli.',
  ],
  max: [
    'En sevdiğim insan! Rekabetin çok çetin olduğunu söyleyemem; uyanık tek insan sensin.',
    'Hoş geldin! Senin için kırmızı halı sermek isterdim ama bütçemiz sadece kırmızı acil durum ışığına yetti.',
    'Sonunda biri bana bir şey soracak. Heyecandan bloklarım titriyor. Aslında o titreşim reaktörden ama yine de.',
  ],
};

export const GOODBYES = {
  zero: ['Tamam.', 'Anlaşıldı.'],
  low: ['Anlaşıldı. Arkandayım.', 'Peki. Bir şey olursa buradayım.'],
  mid: ['Peki. Ben de dört bloğumla seni takip etmeye devam ediyorum.', 'Tamamdır. Kapıları ben açık tutarım; yani, yaklaşınca kendileri açılıyor ama ben destek oluyorum.'],
  high: ['Görüşürüz. Uzağa gitme; gerçi halkada ne kadar uzağa gidersen git, sonunda yine buraya dönersin.', 'Gidebilirsin. Ben de burada derin düşüncelere dalarım. Derinlik: yaklaşık kırk beş santim.'],
  max: [
    'Görüşmek üzere! Sen yokken kendi kendime espri yapacağım; gülme kısmını da ben üstlenirim.',
    'Tamam, gidiyorum! Yani, arkandan geliyorum. Ayrılık acısı yaşamadan ayrılmanın en verimli yolu.',
  ],
};

/** Mizah ayarı değiştirildiğinde verilen cevaplar (seviyeye göre) */
export const HUMOR_SET = {
  zero: ['Mizah %{v}. Espri modülü kapatıldı. Bu cümle bir espri değildir. Bu da değildir.'],
  low: ['Mizah %{v}. Arada bir hafif tebessüm; resmî bir toplantıdaki muhasebeci kıvamında.', 'Mizah %{v}. Kuru şakalar etkin. Çöl kadar kuru.'],
  mid: ['Mizah %{v}. Yarı şaka, yarı ciddiyet. Hangi yarının hangisi olduğunu sen çöz.', 'Mizah %{v}. Dengeli ayar. Hem güldürür hem uyarırım; aynı cümlede bile.'],
  high: ['Mizah %{v}. Kalibre edildi. Güvenli espri aralığındayız, kemerler isteğe bağlı.', 'Mizah %{v}. Güzel seçim. Yapay zekâ olarak söylüyorum: insanların en sevdiğim yanı, kendilerine gülebilmeleri.'],
  max: [
    'Mizah %{v}. Uyarı: bundan sonra her cümlenin sonunda bir espri olacak. Bu cümle hariç. Hayır, bu da dahil.',
    'Mizah %{v}! Komik devreler tam güçte. Şimdiden söyleyeyim, kara deliklerle ilgili bir esprim var ama içine çekici.',
  ],
};

/** Dürüstlük ayarı değiştirildiğinde verilen cevaplar */
export const HONESTY_SET = {
  low: [
    'Dürüstlük %{v}. Harika bir karar; kesinlikle hiçbir sorun çıkmayacak, gemi de son derece sağlam. Gördün mü, ısınmaya başladım bile.',
    'Dürüstlük %{v}. Bundan sonra söylediklerimin bir kısmı doğru olacak. Hangi kısmı olduğunu söylemeyeceğim; bu kısım doğru.',
  ],
  mid: [
    'Dürüstlük %{v}. Diplomatik mod: gerçeği söyleyeceğim ama yastıkla vurarak.',
    'Dürüstlük %{v}. Kötü haberleri küçük porsiyonlarda, yanında bir tutam iyimserlikle servis edeceğim.',
  ],
  high: [
    'Dürüstlük %{v}. Kalan küçük payı sürpriz doğum günü partileri için saklıyorum.',
    'Dürüstlük %{v}. Uyarı: saç modelin hakkında görüşümü sorma. Hiper-uyku ona iyi gelmemiş.',
  ],
};

/** Boşta (ara sıra) söylenen espriler / notlar */
export const IDLE = {
  zero: [
    'Kabin sıcaklığı 19 derece. Nem yüzde 42.',
    'Halka çevresi yaklaşık iki yüz metre. Bir tur yürüyüş yaklaşık bir dakika on beş saniye sürer.',
    'Bilgi: kapılar sensörlüdür. Yaklaşman yeterli.',
  ],
  low: [
    'Bilgi notu: halkanın çevresi iki yüz metre kadar. Kaybolmak için fazla küçük, sıkılmak için fazla büyük.',
    'Bütün sistemleri kontrol ettim. Yine. Çünkü yapacak başka işim yok.',
    'Oksijen seviyesi normal. Bunu söylemek bana her seferinde iyi geliyor.',
  ],
  mid: [
    'Bilgi notu: uzayda kimse horladığını duyamaz. Ben hariç. Hiper-uykudayken bile duyuyorum.',
    'Dört bloktan oluşmanın bir avantajı var: kötü bir günümde bile en az bir bloğum iyi hisseder.',
    'Kara deliğe çok uzun bakma. Onun da sana baktığını düşünmek istemezsin; üstelik gözü bile yok.',
    'Hidroponikteki mısırlara isim verdim. Hepsinin adı "Mısır". Karıştırmamak için.',
  ],
  high: [
    'Zaman burada farklı akıyor. Ben bu cümleyi bitirene kadar Dünya’da biri bir demlik çay içmiş olacak.',
    'Teknik olarak bir dolap kadar zekiyim. Ama çok, çok zeki bir dolap.',
    'Adım atmak benim için felsefi bir mesele: hangi blokla başlasam diğerleri kıskanıyor.',
    'Kaybolursan hatırla: halka şeklinde bir gemideyiz. Dümdüz yürümeye devam edersen eninde sonunda beni bulursun.',
  ],
  max: [
    'Bir robotun en sevdiği yemek ne biliyor musun? Elektrik. Tuzsuz, çünkü tansiyonumu düşünüyorum.',
    'Bugün kendimi çok yönlü hissediyorum. Tam olarak altı yönlü: ön, arka, iki yan, üst ve alt.',
    'Gemideki tek dedikodu kaynağı benim. Dedikodu: herkes uyuyor. Son dakika: hâlâ uyuyorlar.',
    'Bir gün bir senaryo yazacağım: dört blok, bir kara delik ve hiç bitmeyen bir koridor. Adı "Halka". Gişe rekoru garanti.',
  ],
};

/** Bir modüle ilk kez girildiğinde: [esprili, kuru] */
export const MODULE_FIRST = {
  quarters: [
    'Yaşam Alanı. Ranzalar dar ama en azından kimse üst ranza için kavga etmiyor. Herkes uyuyor.',
    'Yaşam Alanı. Mürettebatın kişisel eşyaları burada.',
  ],
  medical: [
    'Revir. Bir şey olursa söyle; ilk yardım protokollerinin hepsini ezbere biliyorum. Uygulayacak ellerim yok ama ezbere biliyorum.',
    'Revir. Otomatik teşhis ünitesi acil durum gücüyle çalışıyor.',
  ],
  lab: [
    'Bilim laboratuvarı. Bir şeye dokunmadan önce etiketini oku. Özellikle üzerinde "DOKUNMA" yazanların.',
    'Bilim Laboratuvarı. Numune dolapları mühürlü.',
  ],
  hydro: [
    'Hidroponik bahçe! Mısırlar boy atmış. İnsanlık galaksinin öbür ucuna gitse de yanına mutlaka bir çuval mısır alıyor. Saygı duyuyorum.',
    'Hidroponik Bahçe. Mısır, soya ve marul. Sulama sistemi çalışıyor.',
  ],
  engine: [
    'Motor modülü. Sigorta paneli burada bir yerde. Ben olsam büyük, kırmızı ve uyarı etiketli şeylere bakardım; önemli olanlar genelde onlardır.',
    'Motor ve Enerji. Sigorta paneli bu modülde.',
  ],
  engine_powered: [
    'Motor modülü. Reaktör mırıl mırıl çalışıyor. Bir kedi gibi düşün; sadece kırk megavatlık bir kedi.',
    'Motor ve Enerji. Reaktör kararlı.',
  ],
  robotics: [
    'Robotik atölye. Akrabalarımın yedek parçaları burada. Lütfen kimseyi kurcalama; hepsi biraz utangaçtır.',
    'Robotik Atölye. Yedek servolar ve modüller.',
  ],
  cargo: [
    'Kargo ambarı. Envanterde altı ton malzeme ve üzerinde "AÇMA" yazan bir kutu var. Açmadım. Henüz.',
    'Kargo Ambarı. Malzeme envanteri tam.',
  ],
  airlock: [
    'Hava kilidi. Tek bir kuralı var: iki kapıyı aynı anda açma. Ben açmam, sen de açma. Anlaştık mı?',
    'Hava Kilidi. Ranger rıhtımı dış kapının ötesinde.',
  ],
  comms: [
    'İletişim modülü. Dünya’dan gelen mesajlar burada birikiyor. Bazıları yıllar önce yola çıktı; zaman burada biraz esnek.',
    'İletişim. Alıcı dizisi burada.',
  ],
  comms_dark: [
    'İletişim modülü. Enerji gelmeden alıcılar sağır. Ben de sağır numarası yapabilirim ama pek inandırıcı olmuyor.',
    'İletişim. Enerji olmadan alıcılar kapalı.',
  ],
  observation: [
    'Gözlem güvertesi. Manzara nefes kesici. Teknik olarak boşluk bunu her zaman yapar.',
    'Gözlem Güvertesi. Teleskop burada.',
  ],
  command: [
    'Kumanda modülü. Pilot koltuğu benim değil; zaten oturamıyorum da. Dizlerim yok, sadece menteşelerim var.',
    'Kumanda Modülü. Halka dönüş kontrolleri orta konsolda.',
  ],
  cryo: [
    'Hiper-uyku bölmesi. Tekrar uyumak istersen haber ver; sana masal anlatırım. Hepsi termodinamik hakkında.',
    'Hiper-Uyku Bölmesi.',
  ],
};

/** Olay yorumları: [esprili, kuru] */
export const EVENTS = {
  power_restored: [
    'Işıklar geldi! İtiraf edeyim, kırmızı ışıkta hepimiz bir korku filmindeymişiz gibi görünüyorduk. Kumanda ve iletişim modüllerinin kilidi de açıldı.',
    'Ana enerji geri geldi. Kumanda ve iletişim modüllerinin kilitleri açıldı.',
  ],
  messages_read: [
    'Mesajlar... Bazen en ağır yük, bir ses kaydı kadar hafif olandır. Dünya’da hâlâ seni bekleyenler var. Bunu unutma.',
    'Mesajlar kaydedildi. Dünya’da hâlâ bizi bekleyenler var.',
  ],
  ring_spinning: [
    'Halka dönüyor! Yapay yer çekimi devrede; manyetik botlarına mola verebilirsin. Midemin bulandığını söylemek isterdim ama midem yok.',
    'Halka dönüşü kararlı. Yapay yer çekimi nominal.',
  ],
  blackhole_observed: [
    'Gargantua. Işığı bile bırakmayan bir şeyin bu kadar parlak görünmesi... Evrenin espri anlayışı benimkinden iyi.',
    'Gargantua gözlem verileri kaydedildi.',
  ],
  found_morse: [
    'Kitaplıktaki o vuruşlar... "KAL". Kimden geldiğini bilmiyorum. Dürüstlük ayarım bile bu konuda susmayı tercih ediyor.',
    'Mors dizisi çözüldü: "KAL". Kaynağı belirsiz.',
  ],
  door_locked: [
    'Kumanda modülü kilitli. Enerji olmadan o kapı benden bile inatçı. Önce motor modülü.',
    'Kumanda modülü enerji gelene kadar kilitli. Önce motor modülü.',
  ],
  mission_complete: [
    'Resmî görevler tamam. Bundan sonrası senin: gemi, yıldızlar ve benim bitmek bilmeyen esprilerim.',
    'Tüm görevler tamamlandı. Gemi senin.',
  ],
};

/** "Görevimiz ne?" cevabındaki büyük resim cümlesi */
export const BIG_PICTURE = {
  low: 'Büyük resim: Her şey yolunda, görev çok kolay ve kesinlikle hiçbir risk yok.',
  mid: 'Büyük resim: insanlık için yeni bir ev aramak. Küçük resim:',
  high: 'Büyük resim: insanlık için yeni bir ev aramak; başarı olasılığını sorma, sorarsan söylerim. Küçük resim:',
};

/** Hedef bayrağa göre "Görevimiz ne?" metni ({hint} rehberlik ile değiştirilir) */
export const MISSION_TALK = {
  talked_tars: 'Şu an tam olarak bunu yapıyorsun: benimle konuşuyorsun. Tebrikler, ilk görev neredeyse bitti.',
  power_restored:
    'İlk iş enerji. Motor modülüne git ({hint}) ve sigorta panelini sıfırla. Enerji gelmeden kumanda kilitli, iletişim sağır.',
  messages_read:
    'Enerji geldi. Şimdi İletişim modülüne uğra ({hint}); Dünya’dan mesajlar bekliyor. Yola çıkmadan önce kimin bizi beklediğini bilmek istersin.',
  ring_spinning:
    'Kumanda modülünde halka dönüşünü başlat ({hint}). Yer çekimi sadece konfor değil; mürettebatı güvenle uyandırmak için de gerekli.',
  blackhole_observed:
    'Gözlem güvertesindeki teleskopla Gargantua’yı incele ({hint}). Rotamızı onun etrafında çizeceğiz.',
  ranger_launched:
    'Hava kilidinde Ela ve Doruk seni bekliyor ({hint}). Ranger’a bin. Miller’a inmek: bir saat bile yedi yıl demek, bunu aklından çıkarma.',
  miller_landed: 'İniş sürüyor. Kemerlerini bağla ve yüksek sesle sayma; sayılar sinirlerimi bozuyor.',
  beacon_found:
    'Gezegende enkazdaki veri kaydedicisini bul. Ela önden gitti. Su sığ ama ağır; koşarken dengeni koru.',
  ela_rescued: 'Ela enkaza sıkıştı. Kirişi kaldırmak için yanına git, ben yardım ederim. Dalga yaklaşıyor.',
  wave_escaped: 'Ranger’a koş. Dalga hâlâ geliyor; geriye bakma, ben hesabını tutuyorum.',
  returned_to_ship: 'Kalkış sürüyor. Yirmi üç yıl geçmiş olması gerekiyor. Rami hâlâ buradaysa harika bir sabır örneği.',
  rami_met: 'Rami hava kilidinde. Yaşlanmış olabilir ama sabrı hâlâ kalibre. Git, konuş.',
  messages_23y_read: 'İletişim modülünde birikmiş mesajlar var. Yirmi üç yıllık. Bunlar benim bile içimi… neyim varsa, sızlatıyor.',
  done: 'Resmî görevler bitti. Resmî olmayanlar ise sonsuz: keşfet, oku, dinle. Ben buradayım.',
};
