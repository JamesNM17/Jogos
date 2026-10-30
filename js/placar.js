import { getSupabase, isSupabaseConfigured } from "./supabase.js";

const $ = (selector) => document.querySelector(selector);
const liveHost = $("#live-matches");
const upcomingHost = $("#upcoming-matches");
const resultsHost = $("#recent-results");
const statusEl = $("#scoreboard-status");
const updatedEl = $("#scoreboard-updated");
const messageEl = $("#scoreboard-message");
const shell = $(".scoreboard-main");
let refreshing = false;
let supabase = null;
let lastSnapshot = "";
let selectedMatchId = null;
let latestMatches = [];

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}
function parsePayload(value) {
  if (typeof value === "string") { try { return JSON.parse(value); } catch (_) { return {}; } }
  return value && typeof value === "object" ? value : {};
}
function phaseLabel(tournament, match) {
  if (match.phase === "groups") return `${match.group_name || "Fase de grupos"} · Jogo ${match.match_number}`;
  const rounds = (tournament.matches || []).filter((item) => item.phase === "knockout");
  const max = Math.max(1, ...rounds.map((item) => Number(item.round_number) || 1));
  const round = Number(match.round_number) || 1;
  const name = round === max ? "Final" : round === max - 1 ? "Semifinal" : round === max - 2 && max >= 3 ? "Quartas de final" : round === max - 3 && max >= 4 ? "Oitavas de final" : `Rodada ${round}`;
  return `${name} · Jogo ${match.match_number}`;
}
function teamName(match, side) {
  return match[`${side}_team_name`] || (side === "home" ? "Equipe A" : "Equipe B");
}
function teamClass(match, side) {
  return match[`${side}_classroom`] || "Turma não informada";
}
function boardMarkup(tournament, match) {
  const home = teamName(match, "home");
  const away = teamName(match, "away");
  return `<article class="live-score-card" data-match="${esc(match.id)}" role="button" tabindex="0" aria-label="Abrir placar em tela cheia: ${esc(home)} contra ${esc(away)}">
    <header class="live-score-card__top"><span class="live-score-card__modality">${esc(tournament.modality_name || "Jogos")}</span><span class="live-badge"><i></i> AO VIVO</span></header>
    <p class="live-score-card__phase">${esc(phaseLabel(tournament, match))}</p>
    <div class="live-score-versus">
      <div class="live-score-team"><span class="live-score-team__tag">EQUIPE A</span><h3>${esc(home)}</h3><p>${esc(teamClass(match, "home"))}</p></div>
      <strong class="live-score-number">${match.home_score == null ? 0 : esc(match.home_score)}</strong>
      <span class="live-score-divider">×</span>
      <strong class="live-score-number">${match.away_score == null ? 0 : esc(match.away_score)}</strong>
      <div class="live-score-team live-score-team--away"><span class="live-score-team__tag">EQUIPE B</span><h3>${esc(away)}</h3><p>${esc(teamClass(match, "away"))}</p></div>
    </div>
    <footer class="live-score-card__footer"><span><i class="live-pulse"></i> Placar atualizado pela organização</span><span class="live-score-card__expand">⛶ Clique para ampliar</span></footer>
  </article>`;
}
function singleMatchMarkup(tournament, match) {
  const finished = match.status === "completed";
  return `<div class="single-match-screen__inner">
    <header class="single-match-screen__header"><div class="single-match-brand"><img src="assets/brasao-escola.png" alt=""><span><strong>JOGOS</strong><small>${esc(tournament.modality_name || "Modalidade")}</small></span></div><button type="button" class="single-match-screen__close" data-close-single-match aria-label="Fechar tela cheia">${document.fullscreenElement === singleMatchScreen ? "⤢ Sair da tela cheia" : "✕ Fechar placar"}</button></header>
    <div class="single-match-screen__content">
      <span class="single-match-screen__eyebrow">${finished ? "RESULTADO FINAL" : "ACOMPANHAMENTO AO VIVO"}</span>
      <h1>${esc(phaseLabel(tournament, match))}</h1>
      <div class="single-match-screen__scoreboard">
        <section class="single-match-team"><span class="single-match-team__label">EQUIPE A</span><h2>${esc(teamName(match, "home"))}</h2><p>${esc(teamClass(match, "home"))}</p><strong class="single-match-score">${match.home_score == null ? 0 : esc(match.home_score)}</strong></section>
        <div class="single-match-versus">×</div>
        <section class="single-match-team single-match-team--away"><span class="single-match-team__label">EQUIPE B</span><h2>${esc(teamName(match, "away"))}</h2><p>${esc(teamClass(match, "away"))}</p><strong class="single-match-score">${match.away_score == null ? 0 : esc(match.away_score)}</strong></section>
      </div>
      <div class="single-match-screen__status ${finished ? "is-finished" : ""}"><i></i>${finished ? "Partida finalizada" : "Placar atualizado automaticamente"}</div>
      <p class="single-match-screen__footer">ESCOLA ESTADUAL BRIGADEIRO GAVIÃO PEIXOTO · 2026</p>
    </div>
  </div>`;
}
function upcomingMarkup(tournament, match) {
  const hasBoth = match.home_team_name && match.away_team_name;
  return `<article class="upcoming-match"><div class="upcoming-match__meta"><strong>${esc(tournament.modality_name || "Modalidade")}</strong><span>${esc(phaseLabel(tournament, match))}</span></div><div class="upcoming-match__teams"><div><strong>${esc(teamName(match, "home"))}</strong><small>${esc(teamClass(match, "home"))}</small></div><span>×</span><div><strong>${esc(teamName(match, "away"))}</strong><small>${esc(teamClass(match, "away"))}</small></div></div><span class="upcoming-match__state">${hasBoth ? "Aguardando início" : "Aguardando classificação"}</span></article>`;
}
function resultMarkup(tournament, match) {
  return `<article class="recent-result"><span class="recent-result__modality">${esc(tournament.modality_name || "Modalidade")}</span><div class="recent-result__teams"><div><strong>${esc(teamName(match, "home"))}</strong><small>${esc(teamClass(match, "home"))}</small></div><b>${match.home_score == null ? "–" : esc(match.home_score)}</b><span>×</span><b>${match.away_score == null ? "–" : esc(match.away_score)}</b><div><strong>${esc(teamName(match, "away"))}</strong><small>${esc(teamClass(match, "away"))}</small></div></div><span class="recent-result__state">Finalizado</span></article>`;
}
function emptyMarkup(icon, title, description) {
  return `<article class="scoreboard-empty"><span class="scoreboard-empty__icon">${icon}</span><h3>${title}</h3><p>${description}</p></article>`;
}

const singleMatchScreen = document.createElement("section");
singleMatchScreen.id = "single-match-screen";
singleMatchScreen.className = "single-match-screen";
singleMatchScreen.hidden = true;
singleMatchScreen.setAttribute("role", "dialog");
singleMatchScreen.setAttribute("aria-modal", "true");
singleMatchScreen.setAttribute("aria-label", "Placar individual em tela cheia");
document.body.append(singleMatchScreen);
function openSingleMatch(matchId) {
  const found = latestMatches.find(({ match }) => String(match.id) === String(matchId));
  if (!found) return;
  selectedMatchId = String(matchId);
  singleMatchScreen.innerHTML = singleMatchMarkup(found.tournament, found.match);
  singleMatchScreen.hidden = false;
  document.body.classList.add("single-match-open");
  // Solicitar tela cheia diretamente na interação do usuário para compatibilidade com o navegador.
  try {
    const request = singleMatchScreen.requestFullscreen?.();
    if (request && typeof request.catch === "function") request.catch(() => {});
  } catch (_) { /* A camada continua ocupando a janela inteira se fullscreen não estiver disponível. */ }
}
function closeSingleMatch(exitFullscreen = true) {
  selectedMatchId = null;
  singleMatchScreen.hidden = true;
  document.body.classList.remove("single-match-open");
  if (exitFullscreen && document.fullscreenElement === singleMatchScreen) {
    const request = document.exitFullscreen?.();
    if (request && typeof request.catch === "function") request.catch(() => {});
  }
}
singleMatchScreen.addEventListener("click", (event) => {
  if (event.target.closest("[data-close-single-match]")) closeSingleMatch();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !singleMatchScreen.hidden) closeSingleMatch();
  if (!singleMatchScreen.hidden && (event.key === "Enter" || event.key === " ") && event.target.closest?.(".single-match-screen")) {
    if (event.target.closest("[data-close-single-match]")) { event.preventDefault(); closeSingleMatch(); }
  }
});
document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement && !singleMatchScreen.hidden) closeSingleMatch(false);
});

function render(payload) {
  const tournaments = Array.isArray(payload.tournaments) ? payload.tournaments : [];
  const allMatches = tournaments.flatMap((tournament) => (tournament.matches || []).map((match) => ({ tournament, match })));
  latestMatches = allMatches;
  const live = allMatches.filter(({ match }) => match.status === "in_progress").sort((a, b) => (a.tournament.modality_name || "").localeCompare(b.tournament.modality_name || "", "pt-BR"));
  const upcoming = allMatches.filter(({ match }) => match.status === "pending" && match.home_team_id && match.away_team_id).sort((a, b) => (a.tournament.modality_name || "").localeCompare(b.tournament.modality_name || "", "pt-BR") || a.match.round_number - b.match.round_number || a.match.match_number - b.match.match_number).slice(0, 8);
  const completed = allMatches.filter(({ match }) => match.status === "completed").sort((a, b) => new Date(b.match.updated_at || 0).getTime() - new Date(a.match.updated_at || 0).getTime()).slice(0, 6);
  statusEl.textContent = live.length ? `${live.length} ${live.length === 1 ? "jogo acontecendo" : "jogos acontecendo"} agora` : "Nenhum jogo em andamento neste momento";
  statusEl.classList.toggle("has-live", live.length > 0);
  liveHost.innerHTML = live.length ? live.map(({ tournament, match }) => boardMarkup(tournament, match)).join("") : emptyMarkup("◷", "Nenhum jogo ao vivo agora", payload.registration_open ? "Quando a organização iniciar uma partida, o placar aparecerá automaticamente aqui." : "Os jogos aguardam o início pela organização. Confira os próximos confrontos abaixo.");
  upcomingHost.innerHTML = upcoming.length ? upcoming.map(({ tournament, match }) => upcomingMarkup(tournament, match)).join("") : `<p class="scoreboard-muted">Não há próximos confrontos prontos para iniciar.</p>`;
  resultsHost.innerHTML = completed.length ? completed.map(({ tournament, match }) => resultMarkup(tournament, match)).join("") : `<p class="scoreboard-muted">Nenhum jogo finalizado foi publicado ainda.</p>`;
  if (selectedMatchId) {
    const selected = allMatches.find(({ match }) => String(match.id) === selectedMatchId);
    if (selected) {
      const markup = singleMatchMarkup(selected.tournament, selected.match);
      if (singleMatchScreen.innerHTML !== markup) singleMatchScreen.innerHTML = markup;
    } else closeSingleMatch(false);
  }
  const snapshot = JSON.stringify([live.map(({ match }) => [match.id, match.home_score, match.away_score]), upcoming.map(({ match }) => match.id), completed.map(({ match }) => [match.id, match.home_score, match.away_score])]);
  if (snapshot !== lastSnapshot) {
    lastSnapshot = snapshot;
    liveHost.classList.remove("scores-refreshed");
    requestAnimationFrame(() => liveHost.classList.add("scores-refreshed"));
  }
  updatedEl.textContent = `Atualizado às ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
}
liveHost.addEventListener("click", (event) => {
  const card = event.target.closest(".live-score-card[data-match]");
  if (card) openSingleMatch(card.dataset.match);
});
liveHost.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const card = event.target.closest(".live-score-card[data-match]");
  if (!card) return;
  event.preventDefault();
  openSingleMatch(card.dataset.match);
});
async function refresh() {
  if (refreshing || document.visibilityState === "hidden") return;
  refreshing = true;
  try {
    if (!isSupabaseConfigured()) {
      statusEl.textContent = "Placar ainda não conectado";
      liveHost.innerHTML = emptyMarkup("⚙", "Configuração pendente", "Conecte o projeto ao Supabase para publicar as inscrições e acompanhar os placares reais.");
      upcomingHost.innerHTML = "";
      resultsHost.innerHTML = "";
      return;
    }
    if (!supabase) supabase = await getSupabase();
    const { data, error } = await supabase.rpc("get_public_tournaments");
    if (error) throw error;
    messageEl.hidden = true;
    render(parsePayload(data));
  } catch (error) {
    console.error("Erro ao buscar os placares:", error);
    messageEl.textContent = "Não foi possível atualizar os placares. Verifique a conexão ou a instalação do módulo de campeonato no Supabase.";
    messageEl.className = "form-message form-message--error";
    messageEl.hidden = false;
    statusEl.textContent = "Reconectando ao placar…";
  } finally {
    refreshing = false;
  }
}

$("#scoreboard-fullscreen")?.addEventListener("click", async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await shell.requestFullscreen();
  } catch (error) { console.warn("Tela cheia indisponível:", error); }
});
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refresh(); });
refresh();
window.setInterval(refresh, 2500);
