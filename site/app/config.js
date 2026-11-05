// Configuração pública do Contrapeso (Firebase).
// Estes valores ficam visíveis no site por natureza: quem protege os dados de cada empresa
// são as regras do Firestore (firebase/firestore.rules), não o segredo desta configuração.
// Com "firebase" vazio, as ferramentas funcionam sem login, com dados só no navegador.
window.CONTRAPESO_CONFIG = {
  firebase: {
    apiKey: "",
    authDomain: "",
    projectId: "",
    appId: ""
  }
};
