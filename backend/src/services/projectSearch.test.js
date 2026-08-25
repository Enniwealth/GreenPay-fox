"use strict";

const { DEFAULT_RANKING, loadRankingConfig } = require("../config/searchRanking");
const {
  sanitizeSearchTerm,
  parseFilters,
  buildWhereClause,
  buildListingQuery,
} = require("../services/projectSearch");

describe("projectSearch", () => {
  describe("sanitizeSearchTerm", () => {
    it("strips SQL wildcard characters", () => {
      expect(sanitizeSearchTerm("re%fore_station")).toBe("reforestation");
      expect(sanitizeSearchTerm("50% match")).toBe("50 match");
    });

    it("trims and caps length", () => {
      expect(sanitizeSearchTerm("  solar  ")).toBe("solar");
      expect(sanitizeSearchTerm("x".repeat(300)).length).toBe(200);
    });
  });

  describe("parseFilters", () => {
    it("accepts valid filters and rejects invalid ones", () => {
      const filters = parseFilters({
        category: "Reforestation",
        status: "active",
        verified: "true",
        search: "trees",
        limit: "25",
      });
      expect(filters.category).toBe("Reforestation");
      expect(filters.status).toBe("active");
      expect(filters.verified).toBe(true);
      expect(filters.search).toBe("trees");
      expect(filters.limit).toBe(25);
    });

    it("ignores invalid category and negative limit", () => {
      const filters = parseFilters({
        category: "Not A Category",
        status: "rejected",
        limit: "-5",
      });
      expect(filters.category).toBeNull();
      expect(filters.status).toBeNull();
      expect(filters.limit).toBe(50);
    });

    it("supports verified=false", () => {
      expect(parseFilters({ verified: "false" }).verified).toBe(false);
    });
  });

  describe("buildWhereClause", () => {
    it("uses indexed english+simple full-text and trigram, not ILIKE wildcards", () => {
      const filters = parseFilters({ search: "reforestation" });
      const { whereSql, values } = buildWhereClause(filters);
      expect(whereSql).toContain("plainto_tsquery('english'");
      expect(whereSql).toContain("plainto_tsquery('simple'");
      expect(whereSql).toContain("similarity(p.name");
      expect(whereSql).not.toContain("ILIKE");
      expect(values).toEqual(["reforestation"]);
    });
  });

  describe("buildListingQuery", () => {
    it("orders by rank_score when search is present", () => {
      const filters = parseFilters({ search: "solar", limit: 10 });
      const { sql } = buildListingQuery(filters, DEFAULT_RANKING);
      expect(sql).toContain("rank_score DESC");
      expect(sql).toContain("ts_rank_cd");
    });

    it("falls back to created_at when no search term", () => {
      const filters = parseFilters({ limit: 10 });
      const { sql } = buildListingQuery(filters, DEFAULT_RANKING);
      expect(sql).toContain("ORDER BY p.created_at DESC");
      expect(sql).not.toContain("ts_rank_cd");
    });
  });

  describe("loadRankingConfig", () => {
    const original = process.env.PROJECT_SEARCH_RANKING;

    afterEach(() => {
      if (original === undefined) {
        delete process.env.PROJECT_SEARCH_RANKING;
      } else {
        process.env.PROJECT_SEARCH_RANKING = original;
      }
    });

    it("merges env overrides with defaults", () => {
      process.env.PROJECT_SEARCH_RANKING = JSON.stringify({ verifiedBoost: 0.5 });
      const config = loadRankingConfig();
      expect(config.verifiedBoost).toBe(0.5);
      expect(config.textRelevance).toBe(DEFAULT_RANKING.textRelevance);
    });
  });
});
