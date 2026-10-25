// Kürdistan'ın yaklaşık sınırı: Kürt nüfusun çoğunlukta olduğu bölgeler (Bakur, Başûr, Rojava, Rojhilat).
// Resmî bir sınır yoktur; bu çizim yaklaşıktır ve sadece haritada bölgeyi göstermek ve haberleri süzmek içindir.
// Koordinatlar [boylam, enlem]. Değiştirmek için noktaları düzenleyin, sonra: node scripts/build-regions.mjs
export const KURDISTAN = [
  // Ana bölge: Türkiye'nin doğusu ve güneydoğusu, Irak'ın kuzeyi, Suriye'nin kuzeydoğusu, İran'ın batısı
  [
    [37.55, 38.45], [38.2, 39.05], [38.9, 39.35], [39.6, 39.55], [40.6, 39.75], [41.6, 39.95], [42.7, 40.3],
    [43.5, 40.25], [44.25, 39.95], [44.6, 39.45], [44.95, 38.7], [45.35, 38.1], [45.75, 37.55], [46.15, 37.05],
    [46.9, 36.75], [47.6, 36.2], [48.15, 35.3], [48.2, 34.35], [47.85, 33.55], [47.3, 32.85], [46.45, 32.75],
    [45.75, 33.45], [45.2, 34.05], [44.55, 34.65], [44.05, 35.2], [43.45, 35.6], [42.85, 35.95], [42.0, 36.05],
    [41.3, 36.05], [40.65, 36.3], [39.8, 36.45], [38.75, 36.45], [38.0, 36.5], [37.65, 36.75], [37.35, 37.05],
    [37.2, 37.45], [37.25, 37.9], [37.4, 38.2], [37.55, 38.45],
  ],
  // Efrîn (Afrin) çevresi
  [[36.55, 36.35], [37.1, 36.35], [37.1, 36.85], [36.6, 36.85], [36.55, 36.35]],
];
