export interface ExtractedAnswer {
  question: string;
  fullAnswer: string;
  extractedValue: any;
  valueType: string;
  timestamp: Date;
  metadata?: {
    details?: string;
    rawText?: string;
    amountOwed?: number | null;
    daysEstimate?: number | null;
    realtorName?: string;
  };
}

export interface AnalysisResult {
  success: boolean;
  data: ExtractedAnswer;
  error?: string;
}

// Structured data for room counts
export interface RoomCount {
  bedrooms: number;
  bathrooms: number;
  garages: number;
}

// Structured data for HVAC/plumbing info
export interface SystemsInfo {
  hvacAge: number | null;
  waterHeaterAge: number | null;
  plumbingUpdated: boolean | null;
}

// Interest level type
export type InterestLevel = "high" | "medium" | "low" | "negative";

// Listing status type
export type ListingStatus = "listed" | "off_market" | "fsbo";

// Occupancy type
export type OccupancyType = "owner" | "tenant" | "vacant";

// Lease type
export type LeaseType = "monthly" | "annual" | "other";

// Mortgage status
export type MortgageStatus = "free_and_clear" | "has_mortgage";

// Repair level
export type RepairLevel = "none" | "cosmetic" | "minor" | "major";

// Selling reason categories
export type SellingReason =
  | "relocation"
  | "downsizing"
  | "upsizing"
  | "financial"
  | "inheritance"
  | "divorce"
  | "retirement"
  | "investment"
  | "other";
