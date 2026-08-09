import { VALID_STATUSES } from "../services/store";

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
  .map(([genre, value]) => {
    const avg = value.total / value.count;
    const count = value.count;

    const score = avg * Math.log(count + 1);

    return {
      genre,
      average: avg,
      count,
      score
    };
  })
  .sort((a, b) => b.score - a.score)
  .slice(0, 5)
  };
}

export function computeCollectionValue(games = [], backlog = [], subscriptions = []) {
  const sumPrice = (list) =>
    list.reduce((sum, item) => sum + (Number(item.price) > 0 ? Number(item.price) : 0), 0);
  const countPaid = (list) => list.filter((item) => Number(item.price) > 0).length;

  const playedValue = sumPrice(games);
  const backlogValue = sumPrice(backlog);
  const totalValue = playedValue + backlogValue;

  const playedPaid = countPaid(games);
  const backlogPaid = countPaid(backlog);
  const totalPaid = playedPaid + backlogPaid;

  const subscriptionMonthly = subscriptions.reduce((sum, sub) => {
    const cost = Number(sub.cost) > 0 ? Number(sub.cost) : 0;
    return sum + (sub.cycle === "Yearly" ? cost / 12 : cost);
  }, 0);

  return {
    playedValue,
    backlogValue,
    totalValue,
    playedPaid,
    backlogPaid,
    totalPaid,
    avgPlayed: playedPaid ? playedValue / playedPaid : 0,
    avgBacklog: backlogPaid ? backlogValue / backlogPaid : 0,
    avgGame: totalPaid ? totalValue / totalPaid : 0,
    subscriptionMonthly,
    subscriptionYearly: subscriptionMonthly * 12,
    subscriptionCount: subscriptions.length
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
