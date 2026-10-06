import { CreateTableForm } from "@/components/CreateTableForm";
import { HomeInvites } from "@/components/HomeInvites";
import { JoinByCode } from "@/components/JoinByCode";
import { PublicTables } from "@/components/PublicTables";

const HERO_FACES = [3, 17, 0, 9, 0, 17, 26, 0, 41, 0, 3, 33];

export default function HomePage() {
  return (
    <main className="page home">
      <section className="hero">
        <div className="hero-copy">
          <h1>Turn over two tiles. Find the pair.</h1>
          <p>
            Set up a table, send the code to up to three friends, and take turns. Find a pair and you go
            again. Most pairs wins.
          </p>
        </div>
        <div className="hero-board" aria-hidden>
          {HERO_FACES.map((face, i) => (
            <span
              key={i}
              className="hero-tile"
              data-face={face || undefined}
              style={{ "--i": i } as React.CSSProperties}
            >
              <span className="tile-inner">
                <span className="tile-back" />
                {face ? (
                  // eslint-disable-next-line @next/next/no-img-element -- decorative static image
                  <img className="tile-face" src={`/hero/${face}.webp`} alt="" />
                ) : null}
              </span>
            </span>
          ))}
        </div>
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
