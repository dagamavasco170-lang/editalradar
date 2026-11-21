import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";

class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error("Erro ao renderizar o EditalRadar:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <main style={{ maxWidth: 600, margin: "10vh auto", padding: 24, fontFamily: "Arial, sans-serif", color: "#18344d" }}>
          <h1>Não foi possível abrir o EditalRadar.</h1>
          <p>Ocorreu um erro ao carregar a tela. Atualize a página para tentar novamente.</p>
          <button onClick={() => window.location.reload()} style={{ padding: "10px 16px", border: 0, borderRadius: 8, background: "#219773", color: "#fff", cursor: "pointer" }}>
            Atualizar página
          </button>
        </main>
      );
    }
    return this.props.children;
  }
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Elemento #root não encontrado no index.html");
}

document.documentElement.dataset.appCommit = __EDITALRADAR_COMMIT__;

createRoot(rootElement).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>
);
