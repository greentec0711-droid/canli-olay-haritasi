// Sitenin odak bölgesi: Doğu Akdeniz, Türkiye, Kafkasya, Orta Doğu, Körfez, İran, Yemen.
// GDELT olayları ve yeşil alarmlı afetler sadece bu kutunun içinden alınır.
export const REGION = { minLat: 12, maxLat: 43.5, minLon: 25, maxLon: 63 };

export const inRegion = (lat, lon) =>
  lat >= REGION.minLat && lat <= REGION.maxLat && lon >= REGION.minLon && lon <= REGION.maxLon;
