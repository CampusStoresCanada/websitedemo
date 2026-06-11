import type { Tables } from "@/lib/database.types";

export type Organization = Tables<"organizations">;
export type Contact = Tables<"contacts">;
export type BrandColor = Tables<"brand_colors">;
export type Benchmarking = Tables<"benchmarking">;
export type BenchmarkingSurvey = Tables<"benchmarking_surveys">;
export type DeltaFlag = Tables<"delta_flags">;
export type SiteContent = Tables<"site_content">;
export type PendingContentChange = Tables<"pending_content_changes">;
