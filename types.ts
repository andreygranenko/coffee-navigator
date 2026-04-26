export type DistrictId = string;

export type Cluster =
  | "Business Hub"
  | "Tourist Center"
  | "Residential"
  | "Mixed"
  | "Student / Hipster";

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
  lowConfidence: boolean;
  areaKm2: number;
  cafeCount: number;
  avgRating: number | null;
  totalReviews: number;
  cafesPerKm2: number;
  poiTotal: number;
  poiPerKm2: number;
  poiBreakdown: PoiBreakdown;
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

export type ColorMode = "opportunity" | "competition" | "demand";
