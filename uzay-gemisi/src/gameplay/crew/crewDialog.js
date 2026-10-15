/**
 * Mürettebat diyalogları (özgün metinler). Oyun bayraklarına göre değişir.
 *
 * Düğüm biçimi:
 *   { text, options?: [{ label, reply?: 'metin', next?: Düğüm | () => Düğüm, action?: fn }], back?: boolean }
 *   - `reply` verilirse kısa bir cevap düğümü açılır (altında "Başka bir şey…" ve "Görüşürüz").
 *   - `next` bir düğüme / işleve gider; ikisi de yoksa diyalog kapanır.
 *   - Kök düğümün altına otomatik "Görüşürüz" eklenir.
 */

const R = (label, reply) => ({ label, reply });

/** Her karakter için bayraklara göre kök düğüm üretir. */
const BUILDERS = {
  // ------------------------------------------------------------------ ELA (kararlı, idealist)
  ela(S, planet) {
    if (S('returned_to_ship')) {
      return {
        text:
          'Döndük. Ama “döndük” demek ne kadar doğru, emin değilim. Rami yirmi üç yıl bekledi; bizim için birkaç saat geçti. ' +
          'Yine de Miller’dan veri getirdik ve bunu ben bile bir mucize sayarım.',
        options: [
          R('Rami nasıl?', 'Gülümseyip “geç kaldınız” dedi. Şakasını yirmi üç yıldır hazırladığına eminim. Ama gözlerindeki yorgunluk gerçek; onunla konuşmanı isterim.'),
          R('Veriler ne işe yarayacak?', 'Su, dalga mekaniği, canlılığın sınırları... Miller bize “yaşanabilir” demedi ama “öğrenilebilir” dedi. Ölçümleri Dünya’ya iletmem gerek. İletişimde de seni yıllık bir mesaj yığını bekliyor.'),
          R('Sen nasılsın?', 'Dizim sızlıyor, kafam daha çok. Ama durmak şu an lüks. Çalışmak bana iyi geliyor.'),
        ],
      };
    }
    if (planet || S('miller_landed')) {
      if (S('wave_escaped')) {
        return {
          text: 'Dalga... Peşimizden gelen o duvarın sesi hâlâ kulağımda. Ranger’a bir adım geç kalsaydık bu konuşmayı yapamazdık. Teşekkür ederim.',
          options: [
            R('İyi misin?', 'Dizim kanıyor ama ayaktayım. Önemli olan kayıt cihazının bizimle olması.'),
            R('Dalga ne kadar büyüktü?', 'Bir apartman kadar. Hayır, iki. Sayamadım; koşarken saymak aklıma gelmedi.'),
          ],
        };
      }
      if (S('ela_rescued')) {
        return {
          text: 'Beni oradan çıkardığın için sana borçluyum. Ama şimdi konuşma zamanı değil, dalga geliyor! Ranger’a doğru koş, ben arkandayım.',
          options: [
            R('Hadi gidelim!', 'İşte bu ruh. Ayağını suya takma, ben seni bekleyemem.'),
            R('Bacağın nasıl?', 'Sorma. Koşacak kadar iyi, o kadar.'),
          ],
        };
      }
      if (S('beacon_found')) {
        return {
          text: 'Kayıt cihazını bulmuşsun, aferin. Ama bacağım kirişin altında sıkıştı. Kaldıracı sen yönet, kasımı ben veririm.',
          options: [
            R('Seni çıkaracağım.', 'Acele et ama sakin kal. Panik, dalgadan önce bizi bitirir.'),
            R('Çok mu acıyor?', 'Bilimsel olarak ifade edeyim: evet.'),
          ],
        };
      }
      return {
        text: 'Burada zaman başka akıyor: bir saat kalırsak gemide Rami için yedi yıl geçer. Enkazdaki veri kaydedicisini bulalım, sonra çekilelim.',
        options: [
          R('Burada yaşam var mı?', 'Su var; ama dalga her şeyi sürüklüyor. Yaşam dinginlik ister. Biyolog olarak umutlu değilim, ama umutsuz da değilim.'),
          R('Zaman genişlemesi nasıl işliyor?', 'Gargantua zamanı yavaşlatıyor. Biz burada nefes alırken uzakta çocuklar büyüyor. Oyalanmak yok.'),
          R('Peki, hadi.', 'Gözünü sudan ayırma. Altı sığ, ama yüzeyi sakin değil.'),
        ],
      };
    }
    if (S('blackhole_observed')) {
      return {
        text: 'Gargantua’yı gördün. Şimdi Miller’a inme vakti yaklaşıyor. Orada bir ekibin izi, bir kayıt cihazı var. O veriyi alırsak insanlığa gerçek bir şans verebiliriz.',
        options: [
          R('Miller güvenli mi?', 'Hayır. Ama güvenli olan bir yere gidebilecek durumda değiliz. Hazır olduğunda hava kilidinde buluşalım.'),
          R('Neden bu kadar kararlısın?', 'Çünkü bu kültürler, bu gemi, bu yolculuk bir hayalin parçaları. Biz bırakırsak kimse devam ettirmez.'),
        ],
      };
    }
    if (S('ring_spinning')) {
      return {
        text: 'Halka dönüyor, ayaklarımın altında yer var, mikroskop yerinde duruyor. Çok şükür! Sırada gözlem güvertesi var; Rami teleskopu hazırlamıştır.',
        options: [
          R('Kültürler nasıl?', 'Bu kadar titreşime rağmen sağlamlar. Biyolojik direnç, bence insanlıktan fazla.'),
          R('Rami neyin peşinde?', 'Kara delik. Her zaman kara delik. Ona “hava nasıl?” desen diskin sıcaklığını anlatır.'),
        ],
      };
    }
    if (S('power_restored')) {
      return {
        text: 'Işıklar geldi! Kültürleri son anda kurtardık. Şimdi Doruk kumandada, halkanın dönmesini bekliyor; yer çekimi olmadan buradaki iş yarım.',
        options: [
          R('Numuneler iyi mi?', 'Isı dengesi toparlandı. Sağ yanda yeşil parlayanlar benim en sevdiklerim; karanlıkta bile kendi ışığını üretiyorlar.'),
          R('Doruk nasıl biri?', 'Alaycı, pratik, tehlikede işe yarar. Bunlar çelişkili gibi görünür ama değil.'),
          R('Kumandaya gidiyorum.', 'Teşekkürler. İki eksik parça daha var; hepsi sırayla.'),
        ],
      };
    }
    return {
      text: 'Yedek hatta çalışıyorum. Kültürlerin ısısı düşerse hepsini kaybederiz. Motor modülündeki sigorta panelini sıfırlayabilir misin?',
      options: [
        R('Ne oldu böyle?', 'Hiper-uykudan çıkarken sistemler zincirleme çöktü. Nedenini ben de bilmiyorum; onu mühendislere sor.'),
        R('Hemen gidiyorum.', 'Sağ ol. Yürürken panel etiketlerini dikkatli oku, bazıları yanıltıcı yazılmış.'),
        R('Burada ne yapıyorsun?', 'Numunelerin kaydını tutuyorum. Kayıt tutmak, bir şeyin hâlâ var olduğunu hatırlatır.'),
      ],
    };
  },

  // ------------------------------------------------------------------ DORUK (alaycı, pratik)
  doruk(S, planet) {
    if (S('returned_to_ship')) {
      return {
        text: 'Kalkış bile bana kolay geldi, bunu bir köşeye yaz. Ama Rami’nin sakalına bakınca... evet, bir şeyler olmuş.',
        options: [
          R('Rami’yi gördün mü?', 'Gördüm. Yirmi üç yıl geçmiş ve adam hâlâ kara delik anlatıyor. Bence bu bir tür dayanıklılık.'),
          R('Şimdi ne yapacağız?', 'Ben mi? Kahve arayacağım. Sen mi? İletişimde seni bekleyen mesajlara bak. Bu işin ağır kısmı o.'),
          R('Peki ya sen?', 'Ben iyiyim. Fazla iyiyim, hatta. Kendimden şüphelenmeye başladım.'),
        ],
      };
    }
    if (planet || S('miller_landed')) {
      if (S('wave_escaped')) {
        return {
          text: 'O dalganın boyunu gördün mü? Ben gördüm ve şimdi unutmaya çalışıyorum. Motorlar çalışıyor, çabuk kalkalım.',
          options: [
            R('Hepimiz buradayız.', 'Evet. Bu, en iyi plan olmasa da en iyi sonuçtu. Bir de bu ayağımdaki su... yani artık ayağım yok sayılır.'),
            R('Kalkış hazır mı?', 'Hazırım. Sen de hazırsan kemerlerini bağla; bu sefer sarsıntılı olacak.'),
          ],
        };
      }
      if (S('ela_rescued')) {
        return {
          text: 'Ela yürüyor, bu iyi haber. Kötü haber de şu: dalga ile aramızda yalnızca sen ve diz hizası su var. Koş!',
          options: [R('Geliyorum!', 'Ranger’ı çalışır tutuyorum. Yetiş, yoksa kalkışı ben yapmak zorunda kalırım.')],
        };
      }
      return {
        text: 'Ayakkabım suya battı, moralim de. Ama Ranger sağlam. Kayıt cihazı enkazın yakınında; fazla oyalanma, burada saat farklı çalışıyor.',
        options: [
          R('Burası nasıl bir yer?', 'Düz, ıslak ve sinir bozucu. Ufuk çizgisinin bu kadar boş olabileceğini bilmiyordum.'),
          R('Dalga ne zaman gelir?', 'Sorun şu: haber vermiyor. O yüzden bana değil, gözlerine güven.'),
          R('Tamam, devam.', 'Arkanı kolla. Ben de burada Ranger’ı koruyacağım. İyi bir iş bölümü, bence.'),
        ],
      };
    }
    if (S('blackhole_observed')) {
      return {
        text: 'Ranger’ı hazırlıyorum. Miller’da bir saat, uzakta yedi yıl, biliyorsun. Oyalanırsak Dünya’daki torunumuz bizden yaşlı olur.',
        options: [
          R('Uçuşu sen mi yapacaksın?', 'Elbette. Sen sadece kemerini bağla. İnişte bağırmak serbest, ama kimse seni suçlamaz.'),
          R('Ya inecek yer yoksa?', 'O zaman yer yaparız. Bir yere inmek, yer bulmaktan çok iradeye bağlıdır.'),
        ],
      };
    }
    if (S('ring_spinning')) {
      return {
        text: 'Halka dönüyor. Yer çekimi denen şeyle yeniden tanıştık; kahve de yere dökülüyor, yani her şey normale döndü.',
        options: [
          R('Sırada ne var?', 'Gözlem güvertesi. Rami’nin teleskopuna bak. Adam o aletle konuşuyor, bu yüzden biraz çekin.'),
          R('Kokpit nasıl?', 'İki koltuk, çok düğme, sıfır kullanım kılavuzu. Hayal ettiğim işin tam tersi.'),
        ],
      };
    }
    if (S('power_restored')) {
      return {
        text: 'Ana enerji geldi. Konsolları tek tek uyandırıyorum. Halkayı döndürmek için konsoldaki kolu çekmen yeterli; çekerken “sorun olur” diye düşünme, sorun zaten oldu.',
        options: [
          R('Halkayı döndüreyim mi?', 'Dönsün. Biz de görelim bu geminin sağlam olup olmadığını. Yalnız önce bir yere tutun.'),
          R('Sen ne zamandır buradasın?', 'Bilmiyorum. Hiper-uykudan çıkınca saat bozuk. Kahve makinesi hâlâ ölü, yani en kötüsü bu.'),
          R('Ela’yı gördüm.', 'Laboratuvarda mıdır? Tabii ki. Onu oradan çıkarmak, kaplumbağayı kabuğundan çıkarmaya benzer.'),
        ],
      };
    }
    return {
      text: 'Kumanda lamba gibi sönük, kahve makinesi de. Enerji gelmeden bir şey uçuramam. Beni suçlama, ben sadece pilotum.',
      options: [
        R('Ne yapmalıyız?', 'Motor modülünde sigorta paneli var. Sıfırla, ışıklar yansın, sonra konuşuruz.'),
        R('Rahatsın galiba.', 'Panik etmenin yararı yok. Panik, enerji harcar; enerjiyse şu an kıt.'),
      ],
    };
  },

  // ------------------------------------------------------------------ RAMI (düşünceli, kara delik takıntılı)
  rami(S, planet, npc) {
    if (S('returned_to_ship') || npc.aged) {
      if (S('messages_23y_read')) {
        return {
          text: 'Mesajları dinledin... Zaman kimseye acımıyor, ama bazı sesler hâlâ dimdik duruyor. Bu, bana yeniden hatırladı.',
          options: [
            R('Ne hissediyorsun?', 'Yirmi üç yıl, saatin tik takından daha fazlası. Ama sizi görünce onu bile unuttum.'),
            R('Gargantua hakkında yeni bir şey?', 'Evet. O kadar uzun baktım ki bir şey fark ettim: karanlık, ışığı yutmuyor. Işık, karanlığa ev sahipliği yapıyor.'),
          ],
        };
      }
      return {
        text: 'Yirmi üç yıl. Teleskopun başında sayısız doğuş ve batış izledim — hepsi tek bir yıldız, tek bir kara delik. İyi ki döndünüz. Sizi yeniden görmek...',
        options: [
          R('Bu kadar yıl nasıl geçti?', 'İlk yıllar sayarak, sonraki yıllar susarak. Sonunda Gargantua’yla sohbet etmeye başladım. Cevap vermedi ama dinledi.'),
          R('Neler öğrendin?', 'Zamanın bir nehir değil bir manzara olduğunu. Şimdi hangi kıyıda durduğuna bağlı.'),
          R('Mesajlar var, dinledin mi?', 'İletişim modülüne uğradım. Dinlemeye cesaret edemedim; sen dinle, bana anlatırsın.'),
        ],
      };
    }
    if (S('blackhole_observed')) {
      return {
        text: 'Gördün... Diskin gölgesi, ışığın kendi etrafında bükülmesi. Hesaplarım doğruydu. Miller gezegeni kıyıda; zaman orada ağır akıyor. Dikkatli ol.',
        options: [
          R('Yaklaşmak ne kadar tehlikeli?', 'Tehlike mesafeyle ölçülür. Ama merak, mesafeyle azalmaz, tam tersine artar. Sana bunu uyarı olarak söylüyorum.'),
          R('Gargantua’yı nasıl anlatırsın?', 'Sessiz bir boşluk, etrafında aydınlık bir tören. Biz o törene davetsiz konuğuz.'),
          R('Teşekkürler Rami.', 'Teşekkürü ışığa et; o her şeyi gösterdi, ben sadece baktım.'),
        ],
      };
    }
    if (S('ring_spinning')) {
      return {
        text: 'Teleskop senin; pencereye yaklaş. Sağ alt köşeye bak, ışık orada kendi etrafında dönüyor. Gargantua henüz tam görünmüyor ama hissediyorum.',
        options: [
          R('Neyi arıyorum?', 'Bir halka. Parlak, ince, kendi üzerine kıvrılan bir halka. Onu bir kez görürsen unutamazsın.'),
          R('Neden bu kadar takıntılısın?', 'Takıntı değil, merak. Ama merak ile takıntı arasındaki çizgi, olay ufku kadar ince.'),
        ],
      };
    }
    if (S('power_restored')) {
      return {
        text: 'Gökyüzü yine görünür. Teleskopu uyandırdım ama halka dönmeden hedefi tutmuyor. Kumandadan halkayı başlatmayı dene.',
        options: [
          R('Neden dönmesi gerekiyor?', 'Dönen bir halka hem yer çekimi yaratır hem de pencereyi sabitler. Fizik bazen kullanışlıdır.'),
          R('Kara delik nasıl bir şey?', 'Uzayın kendine dönüp baktığı yer. İçine kimse bakamaz, ama dışından çok şey öğrenilir.'),
        ],
      };
    }
    return {
      text: 'Karanlıkta bile Gargantua’yı hissediyorum. Teleskopa enerji gelmeden bir şey göremem. Motor modülü senin işin, sanırım.',
      options: [
        R('Ne zamandır buradasın?', 'Hiper-uykudan sonra saatim bozuldu. Ama kara delik hâlâ orada; onun için ne değişir ki?'),
        R('Pencereden ne görüyorsun?', 'Yıldız çok az, gökyüzü sessiz. Sessizlik de bir veridir.'),
      ],
    };
  },
};

/** Karakter için kök düğümü üretir. */
export function buildRoot(id, ctx, npc) {
  const S = (k) => ctx.state?.is?.(k);
  const planet = !!ctx.world?.isPlanet?.();
  const fn = BUILDERS[id];
  if (!fn) return { text: 'Şimdilik meşgulüm.', options: [] };
  return fn(S, planet, npc);
}
