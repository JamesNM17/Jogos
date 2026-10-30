/*
 * CONFIGURAÇÃO DOS JOGOS
 * 1. Crie um projeto no Supabase.
 * 2. Copie a Project URL e a Publishable key para os campos abaixo.
 *    Projetos antigos também podem usar a chave anon.
 * 3. Nunca coloque uma service_role/secret key neste arquivo.
 */
window.APP_CONFIG = {
  supabaseUrl: "https://wytwhqzgxjynbrbszfjs.supabase.co",
  supabaseKey: "sb_publishable_jpIWgb2-UBv3-nxIOXZj1A_uIe_P2XF",
  schoolName: "Escola Estadual Brigadeiro Gavião Peixoto",
  demoModalities: [
    { id: "demo-futsal", name: "Futsal", description: "Monte sua equipe, combine a estratégia e entre em quadra.", participants_per_team: 5, is_active: true },
    { id: "demo-volei", name: "Vôlei", description: "Jogo coletivo, comunicação e muita energia.", participants_per_team: 6, is_active: true },
    { id: "demo-xadrez", name: "Xadrez", description: "Uma disputa individual para quem pensa várias jogadas à frente.", participants_per_team: 1, is_active: true },
    { id: "demo-dupla", name: "Desafio em dupla", description: "Dois participantes, uma estratégia e parceria total.", participants_per_team: 2, is_active: true }
  ]
};
