import { VALID_STATUSES } from "../services/sheet";

export const CHART_COLORS = ["#0f8b8d", "#f25c54", "#f6aa1c", "#3563a8", "#5b8c3a", "#8d5a97"];

export function computeAnalytics(games, enrichments = {}) {
  const statusCounts = Object.fromEntries(VALID_STATUSES.map((status) => [status, 0]));
  const platformCounts = {};
  const genreCounts = {};
  const genreRatings = {};

  games.forEach((game) => {
    statusCounts[game.status] = (statusCounts[game.status] ?? 0) + 1;
    platformCounts[game.platform] = (platformCounts[game.platform] ?? 0) + 1;

    const genres = enrichments[game.id]?.genres ?? [];
    genres.forEach((genre) => {
      genreCounts[genre] = (genreCounts[genre] ?? 0) + 1;

      if (!genreRatings[genre]) {
        genreRatings[genre] = { total: 0, count: 0 };
      }

      genreRatings[genre].total += game.rating;
      genreRatings[genre].count += 1;
    });
  });

  return {
    total: games.length,
    statusDistribution: toChartData(statusCounts),
    platformDistribution: toChartData(platformCounts),
    genreDistribution: toChartData(genreCounts),
    topLikedGenres: Object.entries(genreRatings)
      .map(([genre, value]) => ({
        genre,
        average: value.total / value.count,
        count: value.count
      }))
      .sort((a, b) => b.average - a.average || b.count - a.count || a.genre.localeCompare(b.genre))
      .slice(0, 5)
  };
}

export function ratingToStars(rating) {
  return Number(rating) / 2;
}

function toChartData(counts) {
  return Object.entries(counts)
    .filter(([, value]) => value > 0)
    .map(([label, value], index) => ({
      label,
      value,
      color: CHART_COLORS[index % CHART_COLORS.length]
    }));
}
