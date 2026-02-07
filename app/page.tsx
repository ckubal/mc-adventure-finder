import { Header } from "@/components/Header";
import { AgendaList } from "@/components/AgendaList";

export default function Home() {
  return (
    <div className="min-h-screen" style={{
      background: "linear-gradient(135deg, #ff00ff 0%, #00ffff 50%, #ffff00 100%)",
      backgroundSize: "200% 200%",
      animation: "rainbow 15s ease infinite"
    }}>
      <Header />
      <main className="mx-auto max-w-2xl px-4 py-6">
        <AgendaList />
      </main>
    </div>
  );
}
