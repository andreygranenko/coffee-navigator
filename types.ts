export type DistrictId = string;

export const CLUSTER_LV: Record<string, string> = {
  "Business Hub": "Biznesa centrs",
  "Tourist Center": "Tūristu zona",
  "Student / Hipster": "Studentu rajons",
  "Mixed Urban": "Jaukts rajons",
  "Green / Parks": "Zaļā zona",
  "Suburban": "Piepilsēta",
};
export const clusterLv = (c: string): string => CLUSTER_LV[c] ?? c;

export type Cluster =
  | "Business Hub"
  | "Tourist Center"
  | "Student / Hipster"
  | "Mixed Urban"
  | "Green / Parks"
  | "Suburban"
  | string;

export interface PoiBreakdown {
  universities: number;
  parks: number;
  tourist_attractions: number;
  transport_hubs: number;
}

export interface DistrictSummary {
  id: DistrictId;
  name: string;
  cluster: Cluster;
  lowConfidence: boolean;       // true when venueCount < 5 (too few OSM venues to trust scores)
  lowQualitySample: boolean;    // true when rated Google cafes < 3 (quality score uncertain)
  areaKm2: number;
  cafeCount: number;
  avgRating: number | null;
  totalReviews: number;
  cafesPerKm2: number;
  poiTotal: number;
  poiPerKm2: number;
  poiBreakdown: PoiBreakdown;
  officeCount: number;
  officesPerKm2: number;
  venueCount: number;           // OSM cafe+restaurant+fast_food (broad competition)
  venuesPerKm2: number;
  qualitySampleSize: number;    // Google Places rated cafes used for quality score
  transitCount: number;
  transitPerKm2: number;
  mallCount: number;
  ratingStdDev: number | null;
  avgPriceLevel: number | null;
  clusterId: number;
  competitionScore: number;   // 0-10
  demandScore: number;        // 0-10
  qualityScore: number;       // 0-10
  opportunityScore: number;   // 0-10
}

export interface CafeMarker {
  id: string;
  name: string;
  lat: number;
  lng: number;
  rating: number | null;
  reviews: number;
  priceLevel: number | null;
  address: string;
  website: string | null;
  googleMapsUrl: string | null;
  districtId: DistrictId | null;
  districtName: string | null;
}

export interface VenueMarker {
  id: string;
  name: string | null;
  lat: number;
  lng: number;
  amenity: "cafe" | "restaurant" | "fast_food" | string;
  districtId: string | null;
}

export type ColorMode = "opportunity" | "competition" | "demand";
