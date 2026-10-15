/**
 * Bölüm 2 (Miller gezegeni) metinleri. Hepsi özgün Türkçe; filmden alıntı yoktur.
 */

/** Zaman genişlemesi: gezegende geçen 1 sn ≈ Dünya'da 0,7 gün (1 saat ≈ 7 yıl) */
export const EARTH_DAYS_PER_SEC = 0.7;
/** Dönüşte Dünya'da geçmiş olması gereken en az süre (gün) */
export const MIN_RETURN_DAYS = Math.round(23 * 365.25 + 140);

/** Gün → "3 yıl 2 ay 11 gün" */
export function fmtEarth(days) {
  const d = Math.max(0, days);
  const y = Math.floor(d / 365.25);
  let rest = d - y * 365.25;
  const m = Math.floor(rest / 30.44);
  rest -= m * 30.44;
  const g = Math.floor(rest);
  const parts = [];
  if (y > 0) parts.push(`${y} yıl`);
  if (y > 0 || m > 0) parts.push(`${m} ay`);
  parts.push(`${g} gün`);
  return `Dünya’da geçen: ${parts.join(' ')}`;
}

/** Ranger'a binmeden önce (hava kilidi) */
export const BOARD = {
  ela: 'Kemerler hazır. Miller’da bir saat, Dünya’da yedi yıl demek. Oyalanmayalım.',
  doruk: 'Ranger’ın motorları ısındı. Sen de gel.',
  elaTalk: 'Gelmeden önce son kez düşün. Ama çok düşünme, saat işliyor.',
  dorukTalk: 'Ben hazırım. Sen hazır olduğunda Ranger’a bin.',
};

/** İniş sinematiği altyazıları (ekran karardıktan sonra) */
export const LAUNCH_SUBS = [
  ['SİSTEM', 'Ranger ayrılıyor…', 2600],
  ['SİSTEM', 'Atmosfere giriş. Gövde sarsılıyor.', 2400],
  ['SİSTEM', 'Buradaki her saat Dünya’da yedi yıl.', 3200],
];

export const LANDED = {
  ela: 'Su dizimize kadar… Hiç kıyı yok. Kaydedici şu yönde, ben önden bakıyorum!',
  doruk: 'Gözünüzü zamandan ayırmayın. Sayaç işliyor.',
  tars: [
    'İniş tamam. Dikkat: burada her adım, Dünya’da birinin bir günü. Adımlarını bilerek at.',
    'İniş tamam. Yer çekimi 1,3 g; ağır hissetmen normal. Moralin ayrı bir konu.',
  ],
};

export const ELA_AHEAD = 'Enkaz burada! Kaydedici hâlâ yanıyor, yetişin!';

export const ELA_WAIT = 'Kaydedici şuradaki enkazda. Elimi sürmedim, sen al.';
export const DORUK_WAIT = 'Ben ufku gözetliyorum. Bu su fazla sakin.';

/** Kaydedici alınınca */
export const BEACON = [
  ['Dr. Ela Yıldız', 'Hâlâ ılık… Üzerindeki ışık yanıyor. Bunu götürürsek bütün hesaplar değişir.', 3800],
  ['TARS', 'Ufuktaki dağlar… Bir önceki bakışımda yoktular. Ve büyüyorlar.', 3800],
  ['TARS', 'Dağ değil. Dalga. Yüksekliği kilometre mertebesinde.', 3200],
  ['Doruk Aral', 'Herkes Ranger’a! Şimdi!', 2200],
];
export const BEACON_TARS_DRY = [
  ['Dr. Ela Yıldız', 'Hâlâ ılık… Işığı yanıyor. Bunu götürürsek bütün hesaplar değişir.', 3600],
  ['TARS', 'Ufuktaki dağlar yaklaşıyor. Bu bir dalga.', 3000],
  ['Doruk Aral', 'Herkes Ranger’a! Şimdi!', 2200],
];
export const BEACON_SKIP_TEXT = 'Kaydediciyi enkazdan sökmek tam bir saat sürdü…';

export const ELA_TRAPPED = 'Ayağım! Kiriş ayağıma bastı, çekemiyorum! Beni bırakma!';
export const RESCUE = {
  start: 'Kirişi kaldırıyoruz! TARS, sen sağdan!',
  tars: 'Kaldıraç hesaplandı. Üç, iki, bir. Şimdi kaldır.',
  done: 'Oldu! Yürüyebiliyorum… hayır, koşabiliyorum!',
  go: 'Ranger’a koş! Geriye bakma!',
};

export const RAMP_EARLY_BEACON = 'Kaydedici olmadan dönmek yok. Önce enkaza!';
export const RAMP_EARLY_ELA = 'Ela’yı bırakamayız! Önce ona yardım et!';

export const WAVE_HIT = [
  ['SİSTEM', 'Dalga sizi yakaladı…', 2800],
  ['SİSTEM', 'Su geri çekilirken tutundunuz. Hâlâ vaktiniz var — yeniden deneyin.', 3200],
];

export const TAKEOFF_SUBS = [
  ['SİSTEM', 'Rampa kilitlendi. Motorlar ateşleniyor…', 2600],
  ['SİSTEM', 'Kalkış. Dalga alt tarafta kükrüyor.', 2600],
];
export const RETURN_SUBS = [
  ['SİSTEM', 'Yörüngede AZİM ile kenetlenme…', 2400],
  ['SİSTEM', 'Gemide geçen süre: birkaç saat. Dünya’da geçen: yirmi üç yıldan fazla.', 3600],
];

export const RETURN_CREW = {
  ela: 'Yirmi üç yıl… Rami’ye bak. Bizi hiç görmediği kadar yaşlanmış.',
  doruk: 'Ben dalgayı bir daha asla unutmayacağım.',
  tars: [
    'Kenetlenme tamam. Rami seni bekliyor; yaşlanmış ama merak etme, mizah ayarın benden iyi çalışıyor.',
    'Kenetlenme tamam. Rami hava kilidinde. Yirmi üç yıl geçti.',
  ],
};

/** Gezegende TARS repliği (rastgele, nadiren) */
export const TARS_PLANET_IDLE = [
  'Sayaç işliyor. Konuşmak güzel ama her cümlem bir iki gün tutuyor.',
  'Zemin yok denecek kadar sığ. Yürürken dalgaya değil, ufka bak.',
  'Bu gezegen bizim için sıradan. Biz ise onun için bir misafir; ağırlanıp ağırlanmayacağımızı göreceğiz.',
  'Su sakin. Çok sakin. Sakin sular benim kuyruk işlemcimi hiç rahatlatmıyor.',
];

/** Yaşlanmış Rami ile diyalog sayfaları */
export const RAMI_TALK = [
  'Geldiniz… Gözlerime inanamıyorum. Saçlarım beyazladı, biliyorum; öyle bakma.',
  'Yirmi üç yıl. Uyumadım, uyuyamadım. Her sabah aynı pencereden aynı karanlığa baktım ve sizi bekledim.',
  'Boş durmadım. Gargantua’nın çevresindeki zaman farkını satır satır çıkardım. Dolap dolusu defter oldu. Yalnızken sayılar bile arkadaş oluyor.',
  'Bir şey daha: Dünya’dan gelen mesajlar birikti. Hiçbirini dinlemedim. Sana saklamak, bu yıllardaki tek inadım oldu. İletişim modülüne uğra.',
];
export const RAMI_REPLY = 'Teşekkürler, Rami. Seni yalnız bırakmak istemezdim.';
export const RAMI_BEFORE = 'Önce bir nefes al. Sonra iletişim modülüne git. Mesajlar uzun zamandır bekliyor.';

export const ELA_SHIP = 'Rami nasıl yaşlanmış değil mi? Biz bir gün gitmişiz, o ömür geçirmiş.';
export const DORUK_SHIP = 'Ranger’ı kontrol etmem lazım. Biraz tek başıma kalmak da iyi gelir.';

/** 23 yıl sonra gelen aile mesajları (toplam ~ 5; kısa ve duygusal) */
export const MESSAGES_23Y = [
  {
    when: '27 yıl 1 ay sonra',
    from: 'Cem (torunun)',
    text:
      'Merhaba büyükbaba. Ben Cem, on yedi yaşındayım. Babam bu kaydı yapmamı istedi; elim titriyor. ' +
      'Ben seni hiç görmedim ama evin duvarında bir fotoğrafın var, sürekli başımın üstünde dönüp duran bir gemi gibi. ' +
      'Okulda öğretmen senin adını andı. Bu kez gülmedim, dik oturdum.',
  },
  {
    when: '31 yıl 6 ay sonra',
    from: 'Deniz',
    text:
      'Baba, senin yaşını çoktan geçtim. Sana kızgın olmayı bıraktım. Bunu sana yazmak yetmiyor ama başka yolum yok. ' +
      'Kitaplığın bir rafını boş bıraktım. Dönersen oraya bir şey koyarsın diye. Ne koyacağını bilmiyorum, kendin seç.',
  },
  {
    when: '36 yıl 2 ay sonra',
    from: 'Emre',
    text:
      'Baba, benim saçım senden önce beyazladı. Garip, değil mi? Cem mühendis oldu, evlenmeye hazırlanıyor. ' +
      'Hatırlıyor musun, mısır tarlasında bana ağaç gölgesini nasıl öğretmiştin? Hâlâ bir gölge buldum mu hemen ona gidiyorum. ' +
      'Yaşlandım ama hâlâ senin oğlunum.',
  },
  {
    when: '41 yıl 9 ay sonra',
    from: 'Cem',
    text:
      'Büyükbaba, halka istasyonlarında çalışıyorum. Yapay yer çekimini ben ayarlıyorum, düşünebiliyor musun? ' +
      'Her devir sayısında seni düşünüyorum. Dönersen sana odayı ben göstereceğim; yolu ezbere biliyorum.',
  },
  {
    when: '46 yıl 4 ay sonra',
    from: 'Deniz',
    text:
      'Bu son kayıt olabilir. Hat kapanıyor, Merkez’in de gücü yetmiyor. Ama bil ki bu kayıtlar boşluğa gitmedi. ' +
      'Ben her biri için ayrı bir sabah bekledim. Eve dön, baba. Kapı açık. Ben hâlâ buradayım.',
  },
];

export const MESSAGES_23Y_HEADER = [
  'DÜNYA — BİRİKMİŞ MESAJLAR',
  '────────────────────────────────────────────',
  'Yirmi üç yıl boyunca birikmiş kayıtlar.',
  'Çocukların büyümüş; torunların konuşuyor.',
  '',
];
export const MESSAGES_23Y_DONE_SUB = 'Çocuklarım benden yaşlı. Torunumun sesini ilk kez duydum. Yine de… eve dönmem gerek.';
export const MESSAGES_23Y_PARTIAL_SUB = 'Hepsini dinlemeden bırakamam. Sıra bekliyor.';

/** Görev sonu */
export const ENDING_TEXT = [
  'Dalga geçti; zaman geçmedi — yalnızca senden geçti.',
  'AZİM’in kapısından girdiğinde yirmi üç yıl, sırtında görünmeyen bir yük gibi duruyordu. Rami’nin gözlerinde, çocuklarının sesinde onu gördün.',
  'Ama elinde bir kaydedici var. İçinde, belki yeni bir ev; belki yalnızca yeni bir soru.',
  'Çünkü bazı yolculuklar, varılacak yer bulunduğunda değil; vazgeçilmediğinde sürer.',
  'Ve sen vazgeçmedin.',
].join('\n\n');
