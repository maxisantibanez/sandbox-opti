import { Sandbox } from "@/components/sandbox";

export default function Home() {
  return (
    <main className="page">
      <header className="masthead">
        <p className="eyebrow">Laboratorio de optimización lineal</p>
        <h1>Optimization Sandbox</h1>
        <p className="lede">
          Un modelo matemático, su solución y las restricciones que la
          determinan. Sin cajas negras: la matemática es la interfaz.
        </p>
      </header>

      <Sandbox />

      <footer className="page-footer">
        <span>Optimization Sandbox · M4</span>
        <span>Un modelo · matemática, geometría y solución</span>
      </footer>
    </main>
  );
}
