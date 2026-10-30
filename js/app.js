import { getSupabase, isSupabaseConfigured } from "./supabase.js";

const config = window.APP_CONFIG || {};
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const form = $("#registration-form");
const modalitySelect = $("#modality-id");
const participantsFields = $("#participants-fields");
const teamNameGroup = $("#team-name-group");
const teamNameInput = $("#team-name");
const teamNameLabel = $("#team-name-label");
const teamNameHelp = $("#team-name-help");
const participantCount = $("#participant-count");
const submitButton = $("#submit-registration");
const formMessage = $("#form-message");
const modalitiesGrid = $("#modalities-grid");
const modalitiesEmpty = $("#modalities-empty");
const toast = $("#toast");
let activeModalities = [];
let registrationOpen = true;
let toastTimer;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}
function setMessage(element, text, type = "info") {
  element.textContent = text;
  element.className = `form-message form-message--${type}`;
  element.hidden = false;
}
function hideMessage(element) { element.hidden = true; element.textContent = ""; }
function showToast(text) {
  if (!toast) return;
  toast.textContent = text;
  toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 3200);
}
function symbolFor(modality) {
  const name = `${modality.name || ""} ${modality.description || ""}`.toLowerCase();
  if (name.includes("fut") || name.includes("futebol")) return "⚽";
  if (name.includes("vôlei") || name.includes("volei")) return "🏐";
  if (name.includes("basquete")) return "🏀";
  if (name.includes("xadrez")) return "♟";
  if (name.includes("queimada")) return "🔥";
  if (Number(modality.participants_per_team) === 1) return "⚡";
  if (Number(modality.participants_per_team) === 2) return "👟";
  return "🏆";
}
function participantWord(count) { return Number(count) === 1 ? "participante" : "participantes"; }
function renderModalityOptions(modalities) {
  modalitySelect.replaceChildren();
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = modalities.length ? "Selecione uma modalidade" : "Nenhuma modalidade disponível";
  modalitySelect.append(placeholder);
  modalities.forEach((modality) => {
    const option = document.createElement("option");
    option.value = modality.id;
    option.textContent = `${modality.name} · ${modality.participants_per_team} ${participantWord(modality.participants_per_team)}`;
    option.dataset.size = String(modality.participants_per_team);
    modalitySelect.append(option);
  });
  modalitySelect.disabled = modalities.length === 0;
}
function renderModalityCards(modalities) {
  modalitiesGrid.replaceChildren();
  modalitiesEmpty.hidden = modalities.length !== 0;
  if (!modalities.length) return;
  modalities.forEach((modality, index) => {
    const card = document.createElement("article");
    card.className = "modality-card";
    const top = document.createElement("div");
    top.className = "modality-card__top";
    const symbol = document.createElement("div");
    symbol.className = "modality-card__symbol";
    symbol.textContent = symbolFor(modality);
    const type = document.createElement("span");
    type.className = "modality-card__type";
    type.textContent = Number(modality.participants_per_team) === 1 ? "INDIVIDUAL" : Number(modality.participants_per_team) === 2 ? "DUPLA" : "EQUIPE";
    top.append(symbol, type);
    const heading = document.createElement("h3");
    heading.textContent = modality.name;
    const description = document.createElement("p");
    description.textContent = modality.description || "Reúna os participantes e faça a inscrição para esta modalidade.";
    const bottom = document.createElement("div");
    bottom.className = "modality-card__bottom";
    const count = document.createElement("span");
    count.className = "participant-pill";
    count.innerHTML = `<span>♟</span> ${Number(modality.participants_per_team)} ${participantWord(modality.participants_per_team)}`;
    const link = document.createElement("a");
    link.className = "modality-card__join";
    link.href = registrationOpen ? "#inscricao" : "placar.html";
    link.textContent = registrationOpen ? "Inscrever-se ↗" : "Inscrições encerradas";
    if (!registrationOpen) {
      link.classList.add("is-disabled");
      link.setAttribute("aria-disabled", "true");
    } else {
      link.addEventListener("click", () => {
        modalitySelect.value = modality.id;
        updateParticipantFields();
      });
    }
    bottom.append(count, link);
    card.append(top, heading, description, bottom);
    modalitiesGrid.append(card);
  });
}
function renderParticipantInputs(size, existingNames = []) {
  participantsFields.replaceChildren();
  for (let index = 0; index < size; index += 1) {
    const wrapper = document.createElement("div");
    wrapper.className = "participant-field";
    const label = document.createElement("label");
    label.className = "participant-label";
    label.htmlFor = `participant-${index + 1}`;
    const number = document.createElement("span");
    number.className = "participant-num";
    number.textContent = String(index + 1).padStart(2, "0");
    label.append(number, document.createTextNode(size === 1 ? " Nome completo do competidor *" : ` Participante ${index + 1} *`));
    const input = document.createElement("input");
    input.id = `participant-${index + 1}`;
    input.name = `participant_${index + 1}`;
    input.type = "text";
    input.maxLength = 100;
    input.placeholder = size === 1 ? "Nome completo do competidor" : index === 0 ? "Nome completo" : "Nome completo do participante";
    input.autocomplete = "off";
    input.required = true;
    input.value = existingNames[index] || "";
    wrapper.append(label, input);
    participantsFields.append(wrapper);
  }
}
function selectedModality() {
  return activeModalities.find((item) => String(item.id) === modalitySelect.value) || null;
}
function updateParticipantFields() {
  const modality = selectedModality();
  if (!modality) {
    participantCount.textContent = "Selecione a modalidade";
    participantsFields.innerHTML = '<div class="empty-participants"><span>👥</span><p>Escolha uma modalidade para abrir a lista de participantes.</p></div>';
    teamNameGroup.hidden = false;
    teamNameLabel.innerHTML = 'Nome da equipe <span>*</span>';
    teamNameInput.required = true;
    teamNameHelp.textContent = "O nome da equipe e a sala serão exibidos nos confrontos.";
    return;
  }
  const count = Number(modality.participants_per_team);
  participantCount.textContent = `${count} ${participantWord(count)}`;
  if (count === 1) {
    teamNameGroup.hidden = true;
    teamNameInput.required = false;
    teamNameInput.value = "";
  } else {
    teamNameGroup.hidden = false;
    teamNameLabel.innerHTML = 'Nome da equipe <span>*</span>';
    teamNameInput.required = true;
    teamNameHelp.textContent = "O nome da equipe e a sala serão exibidos nos confrontos.";
  }
  renderParticipantInputs(count);
}

// Atualiza os campos de participantes sempre que a pessoa troca a modalidade no seletor.
modalitySelect.addEventListener("change", updateParticipantFields);

async function loadModalities() {
  let modalities = [];
  if (isSupabaseConfigured()) {
    try {
      const supabase = await getSupabase();
      const { data, error } = await supabase.from("modalities").select("id,name,description,participants_per_team,is_active").eq("is_active", true).order("name");
      if (error) throw error;
      modalities = data || [];
    } catch (error) {
      console.error("Falha ao carregar modalidades:", error);
      setMessage(formMessage, "Não foi possível carregar as modalidades. Atualize a página ou avise a organização.", "error");
    }
  } else {
    $("#setup-banner").hidden = false;
    modalities = (config.demoModalities || []).filter((item) => item.is_active);
  }
  if (isSupabaseConfigured()) {
    try {
      const supabase = await getSupabase();
      const { data, error } = await supabase.rpc("get_public_tournaments");
      if (!error) {
        const payload = typeof data === "string" ? JSON.parse(data) : data;
        registrationOpen = payload?.registration_open !== false;
      }
    } catch (error) {
      console.warn("Não foi possível consultar o período de inscrições:", error);
    }
  }
  activeModalities = registrationOpen ? modalities : [];
  renderModalityOptions(activeModalities);
  renderModalityCards(modalities);
  updateParticipantFields();
  if (!registrationOpen) {
    modalitySelect.disabled = true;
    submitButton.disabled = true;
    form.querySelectorAll("input, select, textarea").forEach((field) => { field.disabled = true; });
    setMessage(formMessage, "As inscrições foram encerradas pela organização. Acompanhe os jogos na página do Placar ao vivo.", "info");
  } else if (!modalities.length && isSupabaseConfigured()) {
    setMessage(formMessage, "Ainda não há modalidades abertas para inscrição. Consulte a organização.", "info");
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  hideMessage(formMessage);
  const modality = selectedModality();
  if (!modality) {
    setMessage(formMessage, "Escolha uma modalidade antes de enviar.", "error");
    modalitySelect.focus();
    return;
  }
  if (!form.reportValidity()) return;
  const members = $$("#participants-fields input", form).map((input) => ({ name: input.value.trim() }));
  if (members.some((member) => !member.name)) {
    setMessage(formMessage, "Preencha o nome de todos os participantes.", "error");
    return;
  }
  if (members.length !== Number(modality.participants_per_team)) {
    setMessage(formMessage, "A quantidade de participantes não corresponde à modalidade escolhida.", "error");
    return;
  }
  if (!isSupabaseConfigured()) {
    setMessage(formMessage, "A prévia está funcionando, mas as inscrições ainda não são salvas. Configure a URL e a chave pública do Supabase em js/config.js e execute supabase/schema.sql.", "info");
    return;
  }
  const originalText = submitButton.innerHTML;
  submitButton.disabled = true;
  submitButton.innerHTML = "Enviando inscrição <span aria-hidden=\"true\">…</span>";
  try {
    const supabase = await getSupabase();
    const { error } = await supabase.rpc("register_team", {
      p_modality_id: modality.id,
      p_team_name: Number(modality.participants_per_team) === 1 ? null : teamNameInput.value.trim(),
      p_classroom: $("#classroom").value.trim(),
      p_members: members
    });
    if (error) throw error;
    setMessage(formMessage, "Inscrição enviada com sucesso! Confiram os avisos da organização para os próximos passos.", "success");
    form.reset();
    updateParticipantFields();
    formMessage.scrollIntoView({ behavior: "smooth", block: "center" });
    showToast("Equipe inscrita! Boa sorte nos Jogos. ✦");
  } catch (error) {
    console.error("Erro ao registrar equipe:", error);
    const message = String(error?.message || "");
    let friendly = "Não foi possível enviar a inscrição. Tente novamente ou avise a organização.";
    if (/Já existe uma equipe com esse nome/i.test(message)) friendly = "Já existe uma equipe com esse nome nesta modalidade. Escolha outro nome.";
    else if (/modalidade não está recebendo inscrições|inscrições foram encerradas/i.test(message)) friendly = "As inscrições foram encerradas pela organização. Acompanhe o placar ao vivo no site.";
    else if (/participantes/i.test(message) && /quantidade|exatamente|informados/i.test(message)) friendly = "Confira a quantidade e os nomes dos participantes.";
    else if (message) friendly = message;
    setMessage(formMessage, friendly, "error");
  } finally {
    submitButton.disabled = !registrationOpen;
    submitButton.innerHTML = originalText;
  }
});

const menuToggle = $("#menu-toggle");
const mainNav = $("#main-navigation") || $(".main-nav");
if (menuToggle && mainNav) {
  const setMenuOpen = (open) => {
    mainNav.classList.toggle("is-open", open);
    document.body.classList.toggle("menu-open", open);
    menuToggle.setAttribute("aria-expanded", String(open));
    menuToggle.setAttribute("aria-label", open ? "Fechar menu" : "Abrir menu");
  };
  menuToggle.addEventListener("click", () => setMenuOpen(!mainNav.classList.contains("is-open")));
  $$(".main-nav a").forEach((link) => link.addEventListener("click", () => setMenuOpen(false)));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setMenuOpen(false);
  });
  document.addEventListener("click", (event) => {
    if (window.matchMedia("(max-width: 860px)").matches && mainNav.classList.contains("is-open") &&
        !mainNav.contains(event.target) && !menuToggle.contains(event.target)) setMenuOpen(false);
  });
}

loadModalities();
