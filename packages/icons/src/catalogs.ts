// The icon catalogs Grafito knows about. The only place that names them: everyone else asks here.
import { AWS_SERVICES } from "./aws/services";

export interface CatalogService {
  /** Short id, unique inside its catalog (`lambda`). */
  id: string;
  /** Dictation words Claude should understand as this service. */
  synonyms?: string[];
}

export interface IconCatalog {
  id: string;
  label: string;
  services: readonly CatalogService[];
  /** Service ids shown as a preview on the option tile. */
  samples: readonly string[];
}

export const CATALOGS: readonly IconCatalog[] = [
  { id: "aws", label: "AWS", services: AWS_SERVICES, samples: ["lambda", "s3", "dynamodb"] },
];

export const CATALOG_IDS: readonly string[] = CATALOGS.map((c) => c.id);

export const isCatalogId = (id: unknown): id is string => CATALOG_IDS.includes(id as string);

/** Every service id offered by the given catalogs; unknown catalog ids are ignored. */
export function catalogServiceIds(catalogs: readonly string[]): string[] {
  return CATALOGS.filter((c) => catalogs.includes(c.id)).flatMap((c) => c.services.map((s) => s.id));
}

/** Known service id (`lambda` or `aws:lambda`) -> stored value (`aws:lambda`); null if no catalog has it. */
export function qualifyService(raw: string): string | null {
  const [head, ...rest] = raw.split(":");
  const named = rest.length > 0 ? CATALOGS.find((c) => c.id === head) : undefined;
  const id = named ? rest.join(":") : raw;
  const catalog = named ?? CATALOGS.find((c) => c.services.some((s) => s.id === id));
  return catalog && catalog.services.some((s) => s.id === id) ? `${catalog.id}:${id}` : null;
}

/** `aws:lambda` or `lambda` -> `lambda`. */
export const serviceIdOf = (service: string) => service.replace(/^[^:]*:/, "");
