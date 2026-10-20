// RSS ve Telegram haberlerini anahtar kelimelerle kategorilere ayırır (6 dilde).
// Kelimeler kelime başından eşleşir: "saldırı" -> "saldırıda", "saldırıya" da yakalanır.
import { tokenize } from './geo.mjs';

// Sıra önemli: ilk eşleşen kategori kazanır.
const RULES = {
  massviolence: ['katliam', 'massacre', 'qetlîam', 'komkujî', 'مجزرة', 'مذبحة', 'کۆمەڵکوژی', 'قتل عام'],
  airstrike: ['hava saldırı', 'hava harekat', 'hava bombardıman', 'siha', 'insansız hava', 'airstrike', 'air strike', 'drone strike', 'drone attack',
    'warplane', 'savaş uçağı', 'savaş uçakları', 'bombebaran', 'balafir', 'firokeyên şer', 'êrîşa asmanî', 'êrîşa dronan', 'êrîşa dron$', 'غارة', 'غارات', 'طائرة مسيرة',
    'طائرات مسيرة', 'قصف جوي', 'هێرشی ئاسمانی', 'هێرشی درۆن', 'فڕۆکەی جەنگی', 'حمله هوایی', 'پهپاد', 'missile', 'füze', 'موشك', 'صاروخ', 'مووشەک'],
  bombing: ['patlama', 'bombalı', 'bomba yüklü', 'el yapımı patlayıcı', 'intihar saldırı', 'explosion', 'blast', 'car bomb', 'suicide bomb', 'teqîn', 'bombe',
    'انفجار', 'تفجير', 'عبوة ناسفة', 'مفخخة', 'تەقینەوە', 'ته قینه وه'],
  artillery: ['topçu', 'obüs', 'havan', 'top atışı', 'artillery', 'shelling', 'shelled', 'mortar', 'topbaran', 'qesef', 'قصف مدفعي', 'مدفعية', 'قذائف', 'هاون',
    'تۆپباران', 'تۆپبارانی'],
  clash: ['çatışma', 'çatıştı', 'silahlı', 'clash', 'gunfire', 'firefight', 'fighting', 'pevçûn', 'şer û pevçûn', 'اشتباك', 'اشتباكات', 'معارك', 'پێکدادان', 'درگیری'],
  attack: ['saldırı', 'saldırdı', 'kurşunlandı', 'silahlı saldırı', 'attack', 'gunman', 'shooting', 'shot dead', 'êrîş$', 'êrîşa$', 'êrîşê$', 'êrîşek$', 'êrîşan$', 'هجوم', 'استهداف', 'هێرش', 'حمله'],
  earthquake: ['deprem', 'earthquake', 'erdhej', 'زلزال', 'هزة أرضية', 'بوومەلەرزە', 'زلزله'],
  protest: ['protesto', 'eylem', 'yürüyüş', 'gösteri yürüyüşü', 'gösterici', 'miting', 'boykot', 'protest', 'demonstrat', 'rally', 'xwepêşandan', 'çalakî', 'احتجاج', 'مظاهرة',
    'تظاهرة', 'اعتصام', 'خۆپیشاندان', 'ناڕەزایی', 'تجمع اعتراضی'],
  security: ['gözaltı', 'tutuklan', 'tutuklama', 'operasyon', 'polis', 'jandarma', 'arrest', 'detain', 'raid', 'police', 'binçav', 'hate girtin', 'girtin', 'polîs',
    'اعتقال', 'اعتقل', 'مداهمة', 'الشرطة', 'دەستگیر', 'گرتن', 'پۆلیس', 'بازداشت', 'دستگیر', 'اعدام', 'idam', 'execution', 'darvekirin', 'لەسێدارەدان'],
  military: ['asker', 'askeri', 'tsk', 'ordusu', 'military', 'troops', 'army', 'soldier', 'leşker', 'artêş', 'jiyş', 'جيش', 'عسكري', 'قوات', 'سەرباز', 'سوپا',
    'ارتش', 'سپاه', 'نظامی', 'irgc', 'idf', 'sdg', 'sdf', 'hsd', 'pkk', 'ypg', 'hpg', 'peshmerga', 'peşmerge', 'pêşmerge', 'پێشمەرگە', 'البيشمركة'],
  politics: ['meclis', 'bakan', 'cumhurbaşkan', 'başbakan', 'seçim', 'hükümet', 'parti', 'kayyum', 'tbmm', 'parliament', 'minister', 'president', 'election',
    'government', 'sanction', 'ceasefire', 'ateşkes', 'müzakere', 'parlement', 'wezîr', 'serok', 'hilbijartin', 'hikûmet', 'agirbest', 'حكومة', 'برلمان', 'وزير',
    'رئيس', 'انتخابات', 'وقف إطلاق النار', 'پەرلەمان', 'وەزیر', 'سەرۆک', 'هەڵبژاردن', 'حکومەت', 'ئاگربەست', 'مجلس', 'دولت', 'وزیر', 'رئیس جمهور'],
};

// Bu kelimeleri içeren haberler haritaya konmaz (spor, magazin vb.).
const EXCLUDE = ['spor', 'futbol', 'maç', 'basketbol', 'voleybol', 'süper lig', 'transfer', 'teknik direktör', 'sport', 'football', 'soccer', 'match', 'league',
  'champions', 'fifa', 'uefa', 'werziş', 'لیگ', 'رياضة', 'مباراة', 'كرة القدم', 'الدوري', 'وەرزش', 'یاری', 'فوتبال', 'magazin', 'dizi', 'konser', 'burç',
  'horoscope', 'recipe', 'tarif', 'fashion', 'styles', 'gown', 'outfit', 'celebrity', 'netflix', 'youtube', 'hava durumu', 'weather forecast', 'borsa', 'dolar', 'altın fiyat', 'bitcoin'];
const URL_EXCLUDE = /\/(spor|sport|sports|futbol|football|magazin|yasam|lifestyle|entertainment|kultur-sanat|culture|ekonomi|economy|business|teknoloji|tech|health|saglik|varzesh|riyada)\//i;

// Sonunda $ olan kelime sadece tam kelime olarak eşleşir (ör. Kürtçe 'êrîş' Türkçe 'erişim'i yakalamasın).
const prep = (list) => list.map((k) => ' ' + tokenize(k).norm.join(' ') + (k.endsWith('$') ? ' ' : ''));
const RULES_N = Object.entries(RULES).map(([cat, words]) => [cat, prep(words)]);
const EXCLUDE_N = prep(EXCLUDE);

const hay = (text) => ' ' + tokenize(text).norm.join(' ') + ' ';

export function isExcluded(text, url = '') {
  if (URL_EXCLUDE.test(url)) return true;
  const h = hay(text);
  return EXCLUDE_N.some((k) => h.includes(k + ' '));
}

export function classify(text) {
  const h = hay(text);
  for (const [cat, words] of RULES_N) if (words.some((k) => h.includes(k))) return cat;
  return 'news';
}
