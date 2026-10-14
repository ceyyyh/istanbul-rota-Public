/**
 * Mürettebat modüllerinin oyun içi metinleri (özgün Türkçe — filmden alıntı yoktur).
 */

/** Hiper-uyku mürettebatı (kapsül sırası: 1–3 dış duvar, 4–6 iç duvar) */
export const CREW = [
  { pod: 1, name: 'GÖREV PİLOTU', role: 'Pilot', occupied: false, player: true },
  { pod: 2, name: 'DR. AYLİN YAVUZ', role: 'Biyolog', occupied: true, bpm: 13, temp: 31.4 },
  { pod: 3, name: '—', role: 'Yedek kapsül', occupied: false },
  { pod: 4, name: 'SAVAŞ ERGİN', role: 'Mühendis', occupied: true, bpm: 11, temp: 30.9 },
  { pod: 5, name: '—', role: 'Yedek kapsül', occupied: false },
  { pod: 6, name: 'DR. METİN KORAY', role: 'Fizikçi', occupied: true, bpm: 12, temp: 31.1 },
];

/** Dünya'dan gelen mesajlar (zaman genişlemesi yüzünden yıllar geçmiş) */
export const EARTH_MESSAGES = [
  {
    when: '2 yıl 4 ay sonra',
    from: 'Emre (oğlun)',
    text:
      'Baba, merhaba. Merkezdekiler bu kaydın sana "eninde sonunda" ulaşacağını söylüyor, ben de konuşuyorum işte. ' +
      'Hasadı bitirdik. Kuzey tarlasındaki mısırlar ilk kez tozdan önce olgunlaştı. Dedem traktörün sağ tekerini ' +
      'yine kendi yamadı; görsen gülerdin. Deniz konuşmak istemedi. Sana kızgın değil bence… yani, kızgın. ' +
      'Geçer. Kendine iyi bak, tamam mı?',
  },
  {
    when: '5 yıl 1 ay sonra',
    from: 'Deniz (kızın)',
    text:
      'Bu benim ilk mesajım. Emre her ay kayıt yapıyor, ben yapmıyordum çünkü sana çok kızgındım. Hâlâ biraz kızgınım. ' +
      'Ama bugün fizik dersinde dönen istasyonlarda yapay yerçekimini anlattılar; öğretmen tahtaya senin gemini çizdi. ' +
      'Herkes bana döndü. İlk defa utanmadım. Bir şey daha: Odamdaki kitaplığa kimse dokunmuyor. Kitapları sen ' +
      'nasıl dizdiysen öyle duruyor.',
  },
  {
    when: '9 yıl 7 ay sonra',
    from: 'Emre',
    text:
      'Baba, evlendim. Adı Aslı; komşu çiftlikten, hep bisikletle yoldan geçen kız, hatırlarsın belki. Düğünde ' +
      'masada bir sandalyeyi boş bıraktık, dedemin fikriydi. Tozlar kötüleşiyor. Geceleri pencereleri ıslak ' +
      'bezlerle kapatıyoruz, sabahları yine de yastıkta toz oluyor. Ama iyiyiz. Gerçekten iyiyiz.',
  },
  {
    when: '14 yıl 2 ay sonra',
    from: 'Emre',
    text:
      'Dedem geçen kış öldü. Son günlerinde seni sordu; "Onun takvimi bizimkinden yavaş akıyor, telaş etmeyin" ' +
      'deyip duruyordu. Ceviz ağacının altına gömdük. Oğlum dört yaşında oldu. Adını koyarken sana soramadık, ' +
      'kusura bakma: Adı Cem. Gülünce sana benziyor. Ona her akşam gökyüzünde nereye bakması gerektiğini gösteriyorum.',
  },
  {
    when: '21 yıl 3 ay sonra',
    from: 'Deniz',
    text:
      'Artık senin yaşındayım baba. Bunu yazmak bile tuhaf. Merkezde çalışıyorum; dönüşünün hesapları masamın ' +
      'üstünde, her gün o denklemlerle uğraşıyorum. Toplantılarda herkes umutlu konuşuyor, ben de öyle yapıyorum. ' +
      'Ama eve dönünce eski kitaplığın önüne oturuyorum. Bir işaret bekler gibi. Saçma, biliyorum. Yine de oturuyorum.',
  },
  {
    when: '23 yıl 8 ay sonra',
    from: 'Emre',
    text:
      'Bu son kaydım olabilir baba. Ailemi kuzeye götürüyorum; burada artık nefes alınmıyor. Cevap vermediğin için ' +
      'sana hiç kızmadım, mesafe bu, anlıyorum. Sadece bilmeni istedim: İyi bir hayat yaşadım. Seni hiç unutmadık. ' +
      'Verandanın ışığını açık bırakıyorum. Bir gün dönersen, kapı açık.',
  },
];

/** Teleskop gözlem altyazıları */
export const TELESCOPE_LINES = [
  ['GÖZLEM', 'Gargantua. Çevresindeki ince parlak disk, kara deliğe doğru sarmallanan sıcak gaz.'],
  ['GÖZLEM', "Kütlesi Güneş'in yaklaşık 100 milyon katı. Olay ufku, Dünya'nın yörüngesinden daha geniş."],
  ['GÖZLEM', 'Üstteki ve alttaki ışık yayı diskin arka yüzü: kütleçekim, ışığı kara deliğin etrafından büküp bize getiriyor.'],
  ['GÖZLEM', "Ona yaklaştıkça zaman yavaşlar. Burada geçen her saat, Dünya'da yıllar demek olabilir."],
];

export const MORSE = {
  word: 'KAL',
  letters: [
    { ch: 'K', code: '−·−' },
    { ch: 'A', code: '·−' },
    { ch: 'L', code: '·−··' },
  ],
};
