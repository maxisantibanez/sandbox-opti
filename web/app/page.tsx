import { Sandbox } from "@/components/sandbox";

export default function Home() {
  return (
    <main className="page">
      <header className="masthead">
        <p className="eyebrow">Sandbox de modelamiento matemático para optimización</p>
        <h1>Optimization Sandbox</h1>
        <p className="lede">
          Un modelo matemático, el sistema que representa y la solución que
          produce. Sin cajas negras: la matemática es la interfaz.
        </p>
      </header>

      <Sandbox />

      <footer className="page-footer">
        <span>Optimization Sandbox · M5</span>
        <span>Un modelo · matemática, geometría, escenario y solución</span>
      </footer>
    </main>
  );
}
