import { CreateTableForm } from "@/components/CreateTableForm";
import { HeroBoard } from "@/components/HeroBoard";
import { HeroParticles } from "@/components/HeroParticles";
import { HomeInvites } from "@/components/HomeInvites";
import { JoinByCode } from "@/components/JoinByCode";
import { PublicTables } from "@/components/PublicTables";

export default function HomePage() {
  return (
    <main className="page home">
      <section className="hero">
        <HeroParticles />
        <div className="hero-copy">
          <h1>
            Turn over two tiles. <span className="hero-mark">Find the pair.</span>
          </h1>
          <p>
            Set up a table, send the code to up to three friends, and take turns. Find a pair and you go
            again. Most pairs wins.
          </p>
        </div>
        <HeroBoard />
      </section>
      <div className="home-forms">
        <CreateTableForm />
        <JoinByCode />
      </div>
      <HomeInvites />
      <PublicTables />
    </main>
  );
}
